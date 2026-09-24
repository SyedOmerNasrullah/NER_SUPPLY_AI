/**
 * SMS to an officer about an alert (Phase 6A).
 *
 *   POST /api/notifications/sms   { officerId, alertId }        ADMIN, LOGISTICS_OFFICER
 *
 *   alert ─► officer (by id) ─► phone on file (server-side) ─► Twilio ─► Notification row
 *
 * The browser names an officer and an alert; it never supplies a phone number or the message.
 * The number is read from the officer's record and the text is built from the alert's own stored
 * fields, so an SMS can only ever say what the backend already holds.
 *
 * Every real send attempt leaves a row in the existing `Notification` log: QUEUED before the
 * provider is called, then SENT or FAILED with Twilio's reason. A failure is never reported as
 * sent. A request refused before any send (bad officer, no phone, SMS not configured) leaves no
 * row, because nothing was attempted.
 */

import { Router } from 'express';
import { z } from 'zod';
import type { Alert } from '@prisma/client';
import { env } from '../config/env';
import { prisma } from '../lib/prisma';
import { requireAuth, requireRole, type AuthedRequest } from '../middleware/auth';
import { ApiError, asyncRoute } from '../middleware/errors';
import { toNotification } from '../services/mappers';
import { SmsError, maskPhone, normalizePhone, sendSms, smsConfigured } from '../services/twilio';

export const notifications = Router();

const body = z.object({
  officerId: z.string().min(1).max(64),
  alertId: z.string().min(1).max(64),
});

/** Who can receive an alert SMS: the officers the contract gives phones to (schema, `User.phone`). */
const RECIPIENT_ROLES = new Set(['FIELD_OFFICER', 'DISTRICT_OFFICER']);

/** Two SMS segments at most. Operational, not a report. */
const SMS_MAX = 320;

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

notifications.post(
  '/notifications/sms',
  requireAuth,
  requireRole('ADMIN', 'LOGISTICS_OFFICER'),
  asyncRoute(async (req: AuthedRequest, res) => {
    const parsed = body.safeParse(req.body);
    if (!parsed.success) throw ApiError.badRequest('Send officerId and alertId.');
    const { officerId, alertId } = parsed.data;

    const officer = await prisma.user.findUnique({ where: { id: officerId } });
    if (!officer || !RECIPIENT_ROLES.has(officer.role)) throw ApiError.notFound('Officer');
    if (!officer.phone) throw new ApiError(422, `${officer.name} has no phone number on file.`);
    const officerPhone = normalizePhone(officer.phone);
    if (!officerPhone) throw new ApiError(422, `The phone number on file for ${officer.name} is not a valid number.`);

    const alert = await prisma.alert.findUnique({ where: { id: alertId } });
    if (!alert) throw ApiError.notFound('Alert');

    // Before any row is written: a server that cannot send must not log an attempt it never made.
    if (!smsConfigured()) throw new ApiError(503, 'SMS is not configured on this server.');
    const override = env.twilio.deliveryOverride ? normalizePhone(env.twilio.deliveryOverride) : undefined;
    if (env.twilio.deliveryOverride && !override) {
      throw new ApiError(503, 'SMS is misconfigured on this server (delivery override is not a valid number).');
    }
    const destination = override ?? officerPhone;

    const recommendation = alert.relatedId
      ? await prisma.aIRecommendation.findFirst({
          where: { targetId: alert.relatedId, status: 'PENDING', type: { not: 'NONE' } },
          orderBy: { createdAt: 'desc' },
        })
      : null;
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
      console.log(`[sms] SENT alert=${alert.id} officer=${officer.id} to=${maskPhone(destination)} sid=${sms.sid}`);
      res.status(201).json({
        notification: toNotification(saved),
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
      const reason = err instanceof SmsError ? err.message : 'The SMS could not be sent.';
      await prisma.notification.update({ where: { id: row.id }, data: { status: 'FAILED', failureReason: reason } });
      console.error(`[sms] FAILED alert=${alert.id} officer=${officer.id} — ${reason}`);
      if (err instanceof SmsError) {
        const status = err.kind === 'NOT_CONFIGURED' ? 503 : err.kind === 'INVALID_NUMBER' ? 422 : 502;
        throw new ApiError(status, `SMS not sent: ${reason}`);
      }
      throw err;
    }
  }),
);
