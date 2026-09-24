/**
 * Alerting an officer about an alert, by SMS or by phone (Phase 6A, extended in 6D).
 *
 *   POST /api/notifications/sms    { officerId, alertId }       ADMIN, LOGISTICS_OFFICER
 *   POST /api/notifications/call   { officerId, alertId }       ADMIN, LOGISTICS_OFFICER
 *
 *   alert ─► officer (by id) ─► phone on file (server-side) ─► Twilio ─► Notification row
 *
 * The browser names an officer and an alert; it never supplies a phone number or the words. The
 * number is read from the officer's record and the text is built from the alert's own stored
 * fields, so a notification can only ever say what the backend already holds.
 *
 * Every real send attempt leaves a row in the existing `Notification` log: QUEUED before the
 * provider is called, then SENT or FAILED with Twilio's reason. A failure is never reported as
 * sent. A request refused before any send (bad officer, no phone, channel not configured) leaves
 * no row, because nothing was attempted.
 *
 * Both channels are idempotent within `DEDUPE_WINDOW_MINUTES` — see `recentDuplicate`.
 */

import { Router } from 'express';
import { z } from 'zod';
import type { Alert } from '@prisma/client';
import { env } from '../config/env';
import { prisma } from '../lib/prisma';
import { requireAuth, requireRole, type AuthedRequest } from '../middleware/auth';
import { ApiError, asyncRoute } from '../middleware/errors';
import { toNotification } from '../services/mappers';
import {
  TwilioError,
  callConfigured,
  maskPhone,
  normalizePhone,
  placeCall,
  sendSms,
  smsConfigured,
} from '../services/twilio';

export const notifications = Router();

const body = z.object({
  officerId: z.string().min(1).max(64),
  alertId: z.string().min(1).max(64),
});

/** Who can receive an alert SMS: the officers the contract gives phones to (schema, `User.phone`). */
const RECIPIENT_ROLES = new Set(['FIELD_OFFICER', 'DISTRICT_OFFICER']);

/** Two SMS segments at most. Operational, not a report. */
const SMS_MAX = 320;

/** About twenty seconds of speech. A phone alert says the one thing and stops. */
const CALL_MAX = 480;

/**
 * How long the same alert to the same officer on the same channel is treated as already handled.
 *
 * The cases this exists for are a double-submit, a React re-render firing the action twice, and a
 * client retry after a response was lost — all of which arrive within seconds and all of which
 * mean one notification, not two. Five minutes is long enough to cover a retry and short enough
 * that a genuine second escalation is never silently swallowed.
 *
 * Only QUEUED and SENT rows count. A FAILED attempt is not a notification the officer received,
 * so re-sending after a failure is allowed immediately — which is also what an operator would
 * expect from a button that just told them it did not work.
 */
const DEDUPE_WINDOW_MINUTES = 5;

/**
 * The message, from stored fields only: severity, title and text of the alert, plus the pending
 * recommendation for the same delivery or district when there is one. No model writes any of it.
 */
export function composeAlertSms(alert: Pick<Alert, 'severity' | 'title' | 'message'>, action?: string): string {
  const head = `NER-SupplyAI ${alert.severity} ALERT: ${alert.title.replace(/\.$/, '')}.`;
  const tail = `${action ? ` Recommended action: ${action.replace(/_/g, '-')}.` : ''} Check the NER-SupplyAI dashboard.`;
  const room = SMS_MAX - head.length - tail.length - 1;
  const text = alert.message.trim();
  const detail = room <= 0 ? '' : text.length <= room ? ` ${text}` : ` ${text.slice(0, room - 1).trimEnd()}…`;
  return `${head}${detail}${tail}`;
}

/**
 * The same facts, said out loud.
 *
 * Only two things are changed rather than reported: the product name is spaced so a synthetic
 * voice says "N E R Supply A I" instead of "ner", and the en dash in a segment name is read as
 * "to", so "Dirang – Sela Pass" becomes "Dirang to Sela Pass". Both are pronunciation, not new
 * information — every fact still comes from the alert row and the pending recommendation.
 */
export function composeAlertCall(alert: Pick<Alert, 'severity' | 'title' | 'message'>, action?: string): string {
  const speak = (s: string) => s.replace(/[–—]/g, ' to ').replace(/\s+/g, ' ').trim();
  const parts = [
    'This is an N E R Supply A I alert.',
    `${alert.severity.toLowerCase()} severity.`,
    `${speak(alert.title.replace(/\.$/, ''))}.`,
    speak(alert.message),
    action ? `Recommended action: ${action.replace(/_/g, ' ').toLowerCase()}.` : '',
    'Please check the N E R Supply A I dashboard for operational impact and recommended response.',
  ].filter(Boolean);
  return parts.join(' ').slice(0, CALL_MAX);
}

/**
 * Everything both routes need, or the error that stops them.
 *
 * Ordered so that nothing is written and nothing is sent until the request is known to be good:
 * officer, then their number, then the alert, then whether the channel can even run.
 */
async function resolveTarget(officerId: string, alertId: string, configured: boolean, channelLabel: string) {
  const officer = await prisma.user.findUnique({ where: { id: officerId } });
  if (!officer || !RECIPIENT_ROLES.has(officer.role)) throw ApiError.notFound('Officer');
  if (!officer.phone) throw new ApiError(422, `${officer.name} has no phone number on file.`);
  const officerPhone = normalizePhone(officer.phone);
  if (!officerPhone) throw new ApiError(422, `The phone number on file for ${officer.name} is not a valid number.`);

  const alert = await prisma.alert.findUnique({ where: { id: alertId } });
  if (!alert) throw ApiError.notFound('Alert');

  // Before any row is written: a server that cannot send must not log an attempt it never made.
  if (!configured) throw new ApiError(503, `${channelLabel} is not configured on this server.`);
  const override = env.twilio.deliveryOverride ? normalizePhone(env.twilio.deliveryOverride) : undefined;
  if (env.twilio.deliveryOverride && !override) {
    throw new ApiError(503, `${channelLabel} is misconfigured on this server (delivery override is not a valid number).`);
  }

  const recommendation = alert.relatedId
    ? await prisma.aIRecommendation.findFirst({
        where: { targetId: alert.relatedId, status: 'PENDING', type: { not: 'NONE' } },
        orderBy: { createdAt: 'desc' },
      })
    : null;

  return { officer, alert, officerPhone, destination: override ?? officerPhone, override, recommendation };
}

/** A QUEUED or SENT row for this exact alert, officer and channel inside the window. */
async function recentDuplicate(alertId: string, officerId: string, channel: 'SMS' | 'CALL') {
  return prisma.notification.findFirst({
    where: {
      alertId,
      recipientId: officerId,
      channel,
      status: { in: ['QUEUED', 'SENT'] },
      sentAt: { gte: new Date(Date.now() - DEDUPE_WINDOW_MINUTES * 60_000) },
    },
    orderBy: { sentAt: 'desc' },
  });
}

/** Maps a provider failure onto the status a client should see. */
function statusFor(err: TwilioError): number {
  return err.kind === 'NOT_CONFIGURED' ? 503 : err.kind === 'INVALID_NUMBER' ? 422 : 502;
}

notifications.post(
  '/notifications/sms',
  requireAuth,
  requireRole('ADMIN', 'LOGISTICS_OFFICER'),
  asyncRoute(async (req: AuthedRequest, res) => {
    const parsed = body.safeParse(req.body);
    if (!parsed.success) throw ApiError.badRequest('Send officerId and alertId.');
    const { officerId, alertId } = parsed.data;

    const { officer, alert, officerPhone, destination, override, recommendation } = await resolveTarget(
      officerId,
      alertId,
      smsConfigured(),
      'SMS',
    );

    const already = await recentDuplicate(alert.id, officer.id, 'SMS');
    if (already) {
      res.status(200).json({ notification: toNotification(already), duplicate: true });
      return;
    }

    const text = composeAlertSms(alert, recommendation?.type);

    const row = await prisma.notification.create({
      data: {
        alertId: alert.id,
        alertTitle: alert.title,
        channel: 'SMS',
        status: 'QUEUED',
        recipientId: officer.id,
        recipientName: officer.name,
        recipientRole: officer.role,
        // Masked. The log is readable by anyone who can open the app; the full number stays on
        // the officer's record and is read only here, server-side.
        recipientPhone: maskPhone(officerPhone),
        relatedId: alert.relatedId,
        // Everything on this database is demonstration data, and reset should return the log to
        // its baseline. A production deployment would log these as operational history.
        demoGenerated: true,
      },
    });

    try {
      const sms = await sendSms({ to: destination, body: text });
      const saved = await prisma.notification.update({ where: { id: row.id }, data: { status: 'SENT' } });
      // The alert's own Twilio columns, which the schema has carried since the Phase 4A baseline
      // and nothing has written until now. `notifiedViaTwilio` means "at least one channel got
      // through", so it is only ever set true here, never cleared by the other channel failing.
      await prisma.alert.update({
        where: { id: alert.id },
        data: { smsStatus: 'SENT', twilioSid: sms.sid, notifiedViaTwilio: true },
      });
      console.log(`[sms] SENT alert=${alert.id} officer=${officer.id} to=${maskPhone(destination)} sid=${sms.sid}`);
      res.status(201).json({
        notification: toNotification(saved),
        duplicate: false,
        sms: {
          sid: sms.sid,
          providerStatus: sms.status,
          to: maskPhone(destination),
          // True when TWILIO_TO_NUMBER redirected delivery away from the officer's own number.
          redirected: Boolean(override),
          body: text,
        },
      });
    } catch (err) {
      const reason = err instanceof TwilioError ? err.message : 'The SMS could not be sent.';
      await prisma.notification.update({ where: { id: row.id }, data: { status: 'FAILED', failureReason: reason } });
      await prisma.alert.update({ where: { id: alert.id }, data: { smsStatus: 'FAILED' } });
      console.error(`[sms] FAILED alert=${alert.id} officer=${officer.id} — ${reason}`);
      if (err instanceof TwilioError) throw new ApiError(statusFor(err), `SMS not sent: ${reason}`);
      throw err;
    }
  }),
);

notifications.post(
  '/notifications/call',
  requireAuth,
  requireRole('ADMIN', 'LOGISTICS_OFFICER'),
  asyncRoute(async (req: AuthedRequest, res) => {
    const parsed = body.safeParse(req.body);
    if (!parsed.success) throw ApiError.badRequest('Send officerId and alertId.');
    const { officerId, alertId } = parsed.data;

    const { officer, alert, officerPhone, destination, override, recommendation } = await resolveTarget(
      officerId,
      alertId,
      callConfigured(),
      'Voice calling',
    );

    const already = await recentDuplicate(alert.id, officer.id, 'CALL');
    if (already) {
      res.status(200).json({ notification: toNotification(already), duplicate: true });
      return;
    }

    const script = composeAlertCall(alert, recommendation?.type);

    const row = await prisma.notification.create({
      data: {
        alertId: alert.id,
        alertTitle: alert.title,
        channel: 'CALL',
        status: 'QUEUED',
        recipientId: officer.id,
        recipientName: officer.name,
        recipientRole: officer.role,
        recipientPhone: maskPhone(officerPhone),
        relatedId: alert.relatedId,
        demoGenerated: true,
      },
    });

    try {
      const call = await placeCall({ to: destination, message: script });
      const saved = await prisma.notification.update({ where: { id: row.id }, data: { status: 'SENT' } });
      await prisma.alert.update({
        where: { id: alert.id },
        data: { callStatus: 'SENT', twilioCallSid: call.sid, notifiedViaTwilio: true },
      });
      console.log(`[call] PLACED alert=${alert.id} officer=${officer.id} to=${maskPhone(destination)} sid=${call.sid}`);
      res.status(201).json({
        notification: toNotification(saved),
        duplicate: false,
        call: {
          sid: call.sid,
          providerStatus: call.status,
          to: maskPhone(destination),
          redirected: Boolean(override),
          script,
        },
      });
    } catch (err) {
      const reason = err instanceof TwilioError ? err.message : 'The call could not be placed.';
      await prisma.notification.update({ where: { id: row.id }, data: { status: 'FAILED', failureReason: reason } });
      await prisma.alert.update({ where: { id: alert.id }, data: { callStatus: 'FAILED' } });
      console.error(`[call] FAILED alert=${alert.id} officer=${officer.id} — ${reason}`);
      if (err instanceof TwilioError) throw new ApiError(statusFor(err), `Call not placed: ${reason}`);
      throw err;
    }
  }),
);
