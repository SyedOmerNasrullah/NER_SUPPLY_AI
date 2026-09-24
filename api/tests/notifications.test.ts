/**
 * Officer SMS — Phase 6A.
 *
 *   npm run test:sms      (needs the database; NOT the running API, and never Twilio)
 *
 * The app runs in-process on a throwaway port with the Twilio transport replaced by a recorder,
 * and fake credentials, so no test can send a real message whatever the local .env holds.
 * Assertions compare phone numbers without printing them.
 *
 * Rows this file creates (two temporary officers, the notifications it triggers) are deleted
 * afterwards.
 */

import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { after, before, beforeEach, describe, test } from 'node:test';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { signToken } from '../src/services/auth';
import {
  SmsError,
  normalizePhone,
  smsTesting,
  twimlFor,
  type CallTransport,
  type SmsTransport,
} from '../src/services/twilio';
import { composeAlertCall } from '../src/routes/notifications';
import { env } from '../src/config/env';

const EN_DASH = String.fromCharCode(0x2013);
const APOS = String.fromCharCode(0x27);

const FAKE_CREDS = { accountSid: 'ACtest', authToken: 'test-token', fromNumber: '+15005550006', timeoutMs: 1000 };

let server: Server;
let base = '';
let adminToken = '';
let districtToken = '';
let officerId = '';
let officerPhone = '';
let alertId = '';
let highAlertId = '';
let criticalAlertId = '';
let alertsTouched: string[] = [];
let alertBaseline: {
  id: string;
  notifiedViaTwilio: boolean;
  twilioSid: string | null;
  smsStatus: string;
  callStatus: string;
  twilioCallSid: string | null;
}[] = [];
const tempUsers: string[] = [];
const startedAt = new Date();

let calls: { to: string; body: string }[] = [];
let next: 'ok' | 'reject' = 'ok';
const recorder: SmsTransport = async (_creds, message) => {
  calls.push(message);
  if (next === 'reject') throw new SmsError('REJECTED', 'The number is unverified. Trial accounts cannot send to it (Twilio 21608)');
  return { sid: 'SMtest0000000000000000000000000001', status: 'queued' };
};

let placed: { to: string; message: string }[] = [];
let nextCall: 'ok' | 'reject' = 'ok';
const callRecorder: CallTransport = async (_creds, call) => {
  placed.push(call);
  if (nextCall === 'reject') throw new SmsError('REJECTED', 'The number is unverified. Trial accounts cannot call it (Twilio 21215)');
  return { sid: 'CAtest0000000000000000000000000001', status: 'queued' };
};

async function post(payload: unknown, token = adminToken, path = 'sms') {
  const res = await fetch(`${base}/api/notifications/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(payload),
  });
  return { status: res.status, body: (await res.json()) as Record<string, any> };
}

const postCall = (payload: unknown, token = adminToken) => post(payload, token, 'call');

const rowsFor = (recipientId: string) =>
  prisma.notification.findMany({ where: { recipientId }, orderBy: { sentAt: 'desc' } });

before(async () => {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await prisma.$queryRaw`SELECT 1`;
      break;
    } catch (err) {
      if (attempt >= 4) throw err;
    }
  }
  smsTesting.setTransport(recorder);
  smsTesting.setCallTransport(callRecorder);
  smsTesting.setCredentials(FAKE_CREDS);

  const admin = await prisma.user.findFirstOrThrow({ where: { role: 'ADMIN' } });
  const district = await prisma.user.findFirstOrThrow({ where: { role: 'DISTRICT_OFFICER' } });
  adminToken = signToken({ sub: admin.id, role: admin.role });
  districtToken = signToken({ sub: district.id, role: district.role });

  const officer = await prisma.user.findFirstOrThrow({
    where: { role: 'FIELD_OFFICER', phone: { not: null } },
    orderBy: { name: 'asc' },
  });
  officerId = officer.id;
  officerPhone = normalizePhone(officer.phone)!;
  alertId = (await prisma.alert.findFirstOrThrow({ orderBy: { createdAt: 'asc' } })).id;
  highAlertId = (await prisma.alert.findFirst({ where: { severity: 'HIGH' } }))?.id ?? alertId;
  criticalAlertId = (await prisma.alert.findFirst({ where: { severity: 'CRITICAL' } }))?.id ?? alertId;

  // These routes now write the alert's own Twilio columns, so the rows this run touches are
  // captured here and put back in `after`. A test must not leave the seeded world changed —
  // `npm run verify` reads it straight afterwards.
  alertsTouched = [...new Set([alertId, highAlertId, criticalAlertId])];
  alertBaseline = await prisma.alert.findMany({
    where: { id: { in: alertsTouched } },
    select: { id: true, notifiedViaTwilio: true, twilioSid: true, smsStatus: true, callStatus: true, twilioCallSid: true },
  });

  server = createApp().listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

beforeEach(async () => {
  calls = [];
  placed = [];
  next = 'ok';
  nextCall = 'ok';
  smsTesting.setCredentials(FAKE_CREDS);
  // Both channels are now idempotent for five minutes, and these tests deliberately send the
  // same alert to the same officer over and over. Clearing this run's rows between tests keeps
  // each one asking its own question; duplicate protection gets its own tests below, which do
  // not clear anything.
  await prisma.notification.deleteMany({
    where: { recipientId: { in: [officerId, ...tempUsers] }, sentAt: { gte: startedAt } },
  });
});

after(async () => {
  smsTesting.setTransport();
  smsTesting.setCallTransport();
  smsTesting.setCredentials();
  // Only the rows this run wrote — never a cascade notification that happens to share the officer.
  await prisma.notification.deleteMany({
    where: {
      recipientId: { in: [officerId, ...tempUsers] },
      channel: { in: ['SMS', 'CALL'] },
      sentAt: { gte: startedAt },
    },
  });
  for (const a of alertBaseline) {
    await prisma.alert.update({
      where: { id: a.id },
      data: {
        notifiedViaTwilio: a.notifiedViaTwilio,
        twilioSid: a.twilioSid,
        smsStatus: a.smsStatus,
        callStatus: a.callStatus,
        twilioCallSid: a.twilioCallSid,
      },
    });
  }
  if (tempUsers.length) await prisma.user.deleteMany({ where: { id: { in: tempUsers } } });
  server?.close();
  await prisma.$disconnect();
});

async function tempOfficer(phone: string | null) {
  const u = await prisma.user.create({
    data: {
      name: `SMS test officer ${tempUsers.length + 1}`,
      email: `sms-test-${Date.parse('2026-01-01')}-${tempUsers.length + 1}@test.invalid`,
      passwordHash: 'not-a-bcrypt-hash',
      role: 'FIELD_OFFICER',
      phone,
    },
  });
  tempUsers.push(u.id);
  return u.id;
}

describe('POST /api/notifications/sms', () => {
  test('1. an unknown officer is a 404, and nothing is sent', async () => {
    const r = await post({ officerId: 'd0000000-0000-4000-8000-00000000dead', alertId });
    assert.equal(r.status, 404);
    assert.equal(calls.length, 0);
  });

  test('2. an officer with no phone on file is refused safely (422), nothing sent, nothing logged', async () => {
    const id = await tempOfficer(null);
    const r = await post({ officerId: id, alertId });
    assert.equal(r.status, 422);
    assert.match(r.body.error, /no phone number/);
    assert.equal(calls.length, 0);
    assert.equal((await rowsFor(id)).length, 0);
  });

  test('3. an invalid phone number is refused (422), nothing sent', async () => {
    const id = await tempOfficer('98765 43210'); // no country code — refused, not guessed
    const r = await post({ officerId: id, alertId });
    assert.equal(r.status, 422);
    assert.match(r.body.error, /not a valid number/);
    assert.equal(calls.length, 0);
  });

  test('4-5. a valid request calls Twilio once and the notification is SENT', async () => {
    const r = await post({ officerId, alertId });
    assert.equal(r.status, 201, r.body.error);
    assert.equal(calls.length, 1);
    const expected = env.twilio.deliveryOverride ? normalizePhone(env.twilio.deliveryOverride) : officerPhone;
    assert.ok(calls[0].to === expected, 'SMS went to the wrong destination');
    assert.match(calls[0].body, /^NER-SupplyAI (LOW|MEDIUM|HIGH|CRITICAL) ALERT: /);
    assert.ok(calls[0].body.length <= 320);
    assert.equal(r.body.sms.sid, 'SMtest0000000000000000000000000001');
    assert.equal(r.body.notification.status, 'SENT');
    assert.equal(r.body.notification.channel, 'SMS');
    const [row] = await rowsFor(officerId);
    assert.equal(row.status, 'SENT');
    assert.equal(row.alertId, alertId);
    // The log never holds the full number.
    assert.ok(!row.recipientPhone?.includes(officerPhone.slice(3, -2)), 'full phone number stored in the log');
  });

  test('6. a Twilio failure marks the notification FAILED and is not reported as sent', async () => {
    next = 'reject';
    const r = await post({ officerId, alertId });
    assert.equal(r.status, 502);
    assert.match(r.body.error, /^SMS not sent: /);
    assert.equal(r.body.notification, undefined);
    const [row] = await rowsFor(officerId);
    assert.equal(row.status, 'FAILED');
    assert.match(row.failureReason ?? '', /21608/);
  });

  test('7. roles that may not send are refused; no token is a 401', async () => {
    assert.equal((await post({ officerId, alertId }, districtToken)).status, 403);
    assert.equal((await post({ officerId, alertId }, '')).status, 401);
    assert.equal(calls.length, 0);
  });

  test('8. missing credentials: 503, no send, no row, no success', async () => {
    smsTesting.setCredentials(null);
    const before = (await rowsFor(officerId)).length;
    const r = await post({ officerId, alertId });
    assert.equal(r.status, 503);
    assert.match(r.body.error, /not configured/);
    assert.equal(calls.length, 0);
    assert.equal((await rowsFor(officerId)).length, before);
  });

  test('the browser cannot choose the number: a `to` field is ignored', async () => {
    const r = await post({ officerId, alertId, to: '+15555550100' });
    assert.equal(r.status, 201, r.body.error);
    assert.ok(calls[0].to !== '+15555550100');
  });

  test('a malformed body is a 400', async () => {
    assert.equal((await post({ officerId })).status, 400);
  });
});

describe('POST /api/notifications/call', () => {
  test('9. a valid request places one call and the notification is SENT on the CALL channel', async () => {
    const r = await postCall({ officerId, alertId });
    assert.equal(r.status, 201, r.body.error);
    assert.equal(placed.length, 1, 'expected exactly one call');
    assert.equal(calls.length, 0, 'a call must not also send an SMS');
    const expected = env.twilio.deliveryOverride ? normalizePhone(env.twilio.deliveryOverride) : officerPhone;
    assert.ok(placed[0].to === expected, 'call went to the wrong destination');
    assert.equal(r.body.call.sid, 'CAtest0000000000000000000000000001');
    assert.equal(r.body.notification.status, 'SENT');
    assert.equal(r.body.notification.channel, 'CALL');
    const [row] = await rowsFor(officerId);
    assert.equal(row.channel, 'CALL');
    assert.ok(!row.recipientPhone?.includes(officerPhone.slice(3, -2)), 'full phone number stored in the log');
  });

  test('10. the spoken script is built from the alert and carries the dashboard instruction', async () => {
    const r = await postCall({ officerId, alertId });
    assert.equal(r.status, 201, r.body.error);
    const script = placed[0].message;
    assert.match(script, /N E R Supply A I alert/);
    assert.match(script, /(low|medium|high|critical) severity/);
    assert.match(script, /check the N E R Supply A I dashboard/i);
    assert.ok(script.length <= 480, 'script is longer than one short voice alert');
    // Said out loud, an en dash is the word "to" — it is never left as a dash.
    assert.ok(!script.includes(EN_DASH), 'en dash survived into the spoken script');
    assert.equal(r.body.call.script, script);
  });

  test('11. an officer with no phone, and an unusable number, are refused before any call', async () => {
    const noPhone = await tempOfficer(null);
    const r1 = await postCall({ officerId: noPhone, alertId });
    assert.equal(r1.status, 422);
    assert.match(r1.body.error, /no phone number/);

    const badPhone = await tempOfficer('98765 43210');
    const r2 = await postCall({ officerId: badPhone, alertId });
    assert.equal(r2.status, 422);
    assert.match(r2.body.error, /not a valid number/);

    assert.equal(placed.length, 0);
    assert.equal((await rowsFor(noPhone)).length, 0);
    assert.equal((await rowsFor(badPhone)).length, 0);
  });

  test('12. a Twilio failure marks the call FAILED and is not reported as placed', async () => {
    nextCall = 'reject';
    const r = await postCall({ officerId, alertId });
    assert.equal(r.status, 502);
    assert.match(r.body.error, /^Call not placed: /);
    assert.equal(r.body.notification, undefined);
    const [row] = await rowsFor(officerId);
    assert.equal(row.status, 'FAILED');
    assert.equal(row.channel, 'CALL');
    assert.match(row.failureReason ?? '', /21215/);
  });

  test('13. missing credentials: 503, no call, no row', async () => {
    smsTesting.setCredentials(null);
    const r = await postCall({ officerId, alertId });
    assert.equal(r.status, 503);
    assert.match(r.body.error, /not configured/);
    assert.equal(placed.length, 0);
    assert.equal((await rowsFor(officerId)).length, 0);
  });

  test('14. the same role rules apply as for SMS', async () => {
    assert.equal((await postCall({ officerId, alertId }, districtToken)).status, 403);
    assert.equal((await postCall({ officerId, alertId }, '')).status, 401);
    assert.equal(placed.length, 0);
  });
});

describe('duplicate protection', () => {
  test('15. sending the same alert twice reaches Twilio once and returns the first notification', async () => {
    const first = await post({ officerId, alertId });
    assert.equal(first.status, 201, first.body.error);
    assert.equal(first.body.duplicate, false);

    const second = await post({ officerId, alertId });
    assert.equal(second.status, 200, 'a repeat is not an error, it is already done');
    assert.equal(second.body.duplicate, true);
    assert.equal(second.body.notification.id, first.body.notification.id);
    assert.equal(calls.length, 1, 'Twilio was called twice for one alert');
    assert.equal((await rowsFor(officerId)).length, 1, 'a duplicate wrote a second row');
  });

  test('16. a concurrent double-submit still reaches Twilio once', async () => {
    const [a, b] = await Promise.all([post({ officerId, alertId }), post({ officerId, alertId })]);
    const statuses = [a.status, b.status].sort();
    assert.deepEqual(statuses, [200, 201], 'expected one send and one already-done');
    assert.equal(calls.length, 1);
    assert.equal((await rowsFor(officerId)).length, 1);
  });

  test('17. the two channels do not block each other', async () => {
    assert.equal((await post({ officerId, alertId })).status, 201);
    const call = await postCall({ officerId, alertId });
    assert.equal(call.status, 201, 'an SMS must not suppress the call');
    assert.equal(calls.length, 1);
    assert.equal(placed.length, 1);
  });

  test('18. a failed send may be retried immediately', async () => {
    next = 'reject';
    assert.equal((await post({ officerId, alertId })).status, 502);
    next = 'ok';
    const retry = await post({ officerId, alertId });
    assert.equal(retry.status, 201, 'a FAILED attempt must not block the retry');
    assert.equal(retry.body.duplicate, false);
  });
});

describe('HIGH and CRITICAL alerts', () => {
  test('19. a HIGH alert sends, and records itself on the alert row', async () => {
    const r = await post({ officerId, alertId: highAlertId });
    assert.equal(r.status, 201, r.body.error);
    const alert = await prisma.alert.findUniqueOrThrow({ where: { id: highAlertId } });
    assert.equal(alert.smsStatus, 'SENT');
    assert.equal(alert.twilioSid, 'SMtest0000000000000000000000000001');
    assert.equal(alert.notifiedViaTwilio, true);
    if (alert.severity === 'HIGH') assert.match(calls[0].body, /NER-SupplyAI HIGH ALERT: /);
  });

  test('20. a CRITICAL alert can be escalated to a voice call, and records itself', async () => {
    const r = await postCall({ officerId, alertId: criticalAlertId });
    assert.equal(r.status, 201, r.body.error);
    const alert = await prisma.alert.findUniqueOrThrow({ where: { id: criticalAlertId } });
    assert.equal(alert.callStatus, 'SENT');
    assert.equal(alert.twilioCallSid, 'CAtest0000000000000000000000000001');
    assert.equal(alert.notifiedViaTwilio, true);
    if (alert.severity === 'CRITICAL') assert.match(placed[0].message, /critical severity/);
  });

  test('21. a failed send records FAILED on the alert without claiming it was notified', async () => {
    const before = await prisma.alert.findUniqueOrThrow({ where: { id: highAlertId } });
    next = 'reject';
    assert.equal((await post({ officerId, alertId: highAlertId })).status, 502);
    const updated = await prisma.alert.findUniqueOrThrow({ where: { id: highAlertId } });
    assert.equal(updated.smsStatus, 'FAILED');
    assert.equal(updated.notifiedViaTwilio, before.notifiedViaTwilio, 'a failure must not claim a notification');
  });
});

describe('spoken script', () => {
  test('22. TwiML escapes the alert text and never interpolates raw markup', () => {
    const xml = twimlFor('Landslide <b>& "danger" at ' + APOS + 'Brien</b>');
    assert.ok(!xml.includes('<b>'), 'raw markup reached the TwiML');
    assert.match(xml, /&lt;b&gt;/);
    assert.match(xml, /&amp;/);
    assert.match(xml, /&quot;/);
    assert.match(xml, /&apos;/);
    assert.ok(xml.startsWith('<Response><Say'), 'unexpected TwiML opening');
    assert.ok(xml.endsWith('</Say></Response>'), 'unexpected TwiML ending');
    assert.ok(xml.includes('<Pause length="1"/>'), 'the alert is not repeated');
  });

  test('23. composeAlertCall uses only stored fields and the pending action', () => {
    const script = composeAlertCall(
      { severity: 'HIGH', title: 'Landslide reported on NH-13', message: 'Near Seppa. Single lane passable.' },
      'REROUTE',
    );
    assert.match(script, /high severity/);
    assert.match(script, /Landslide reported on NH-13/);
    assert.match(script, /Near Seppa/);
    assert.match(script, /Recommended action: reroute/);
  });
});

describe('phone numbers', () => {
  test('normalizePhone accepts spaced E.164 and refuses the rest', () => {
    assert.equal(normalizePhone('+91 98765 43210'), '+919876543210');
    assert.equal(normalizePhone('98765 43210'), undefined);
    assert.equal(normalizePhone('+0 123'), undefined);
    assert.equal(normalizePhone(''), undefined);
  });
});
