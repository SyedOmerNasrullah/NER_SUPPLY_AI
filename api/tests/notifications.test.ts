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
import { SmsError, normalizePhone, smsTesting, type SmsTransport } from '../src/services/twilio';
import { env } from '../src/config/env';

const FAKE_CREDS = { accountSid: 'ACtest', authToken: 'test-token', fromNumber: '+15005550006', timeoutMs: 1000 };

let server: Server;
let base = '';
let adminToken = '';
let districtToken = '';
let officerId = '';
let officerPhone = '';
let alertId = '';
const tempUsers: string[] = [];
const startedAt = new Date();

let calls: { to: string; body: string }[] = [];
let next: 'ok' | 'reject' = 'ok';
const recorder: SmsTransport = async (_creds, message) => {
  calls.push(message);
  if (next === 'reject') throw new SmsError('REJECTED', 'The number is unverified. Trial accounts cannot send to it (Twilio 21608)');
  return { sid: 'SMtest0000000000000000000000000001', status: 'queued' };
};

async function post(payload: unknown, token = adminToken) {
  const res = await fetch(`${base}/api/notifications/sms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(payload),
  });
  return { status: res.status, body: (await res.json()) as Record<string, any> };
}

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

  server = createApp().listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

beforeEach(() => {
  calls = [];
  next = 'ok';
  smsTesting.setCredentials(FAKE_CREDS);
});

after(async () => {
  smsTesting.setTransport();
  smsTesting.setCredentials();
  // Only the SMS rows this run wrote — never a cascade notification that happens to share the officer.
  await prisma.notification.deleteMany({
    where: { recipientId: { in: [officerId, ...tempUsers] }, channel: 'SMS', sentAt: { gte: startedAt } },
  });
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

describe('phone numbers', () => {
  test('normalizePhone accepts spaced E.164 and refuses the rest', () => {
    assert.equal(normalizePhone('+91 98765 43210'), '+919876543210');
    assert.equal(normalizePhone('98765 43210'), undefined);
    assert.equal(normalizePhone('+0 123'), undefined);
    assert.equal(normalizePhone(''), undefined);
  });
});
