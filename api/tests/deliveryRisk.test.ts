/**
 * Delivery risk — the Phase 6B acceptance tests.
 *
 *   npm run test:delivery-risk      (needs the API on :4000, the database, and the ML service)
 *
 * Two halves. The pure half checks the feature mapping — the one place database rows become
 * model inputs — without touching the network. The wired half goes over HTTP exactly as the
 * frontend would, and scores WITHOUT `apply`, so the demo world is never mutated: the only rows
 * these tests create are prediction-log rows, which are deleted afterwards.
 */

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import type { Delivery, Route, Vehicle, WeatherSnapshot } from '@prisma/client';
import { prisma } from '../src/lib/prisma';
import { deliveryFeatures, istClock, weatherSeverityFor } from '../src/services/deliveryRiskFeatures';

const API = process.env.API_URL ?? 'http://127.0.0.1:4000';

let adminToken = '';
let districtToken = '';
const startedAt = new Date();

async function login(email: string): Promise<string> {
  const res = await fetch(`${API}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: process.env.DEMO_ACCOUNT_PASSWORD ?? 'demo123' }),
  });
  assert.equal(res.status, 200, `login ${email}`);
  return ((await res.json()) as { token: string }).token;
}

async function score(body: unknown, token = adminToken) {
  const res = await fetch(`${API}/api/ml/delivery-risk/score`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as any };
}

const weather = (over: Partial<WeatherSnapshot> = {}) =>
  ({
    id: 'w', segmentId: 's', rainfall1h: 0, rainfall3h: 0, rainfall6h: 0, rainfall24h: 0,
    windSpeedKmh: 5, visibility: 'good', isSimulated: false, createdAt: new Date(), ...over,
  }) as WeatherSnapshot;

before(async () => {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await prisma.$queryRaw`SELECT 1`;
      break;
    } catch (err) {
      if (attempt >= 4) throw err;
    }
  }
  adminToken = await login('admin@ner.local');
  districtToken = await login('district@ner.local');
});

after(async () => {
  await prisma.riskPrediction.deleteMany({
    where: { entityType: 'DELIVERY', createdAt: { gte: startedAt } },
  });
  await prisma.$disconnect();
});

// ---------------------------------------------------------------------------

describe('feature mapping', () => {
  const delivery = { code: 'NE-999', destLat: 27.5859, destLng: 91.859, priority: 'CRITICAL' } as Delivery;
  const vehicle = { id: 'v', currentLat: 26.6, currentLng: 92.33, speedKmh: 34 } as Vehicle;
  const route = { id: 'r', riskScore: 41 } as Route;

  test('every value comes from the rows, none is invented', () => {
    const result = deliveryFeatures(delivery, vehicle, route, weather({ rainfall24h: 18 }), new Date('2024-11-18T04:54:00Z'));
    assert.ok(result.ok);
    assert.equal(result.features.routeRiskScore, 41);
    assert.equal(result.features.currentSpeedKmh, 34);
    assert.equal(result.features.cargoPriority, 'CRITICAL');
    // Orang -> Tawang, great circle. ~120 km, and fixed for these coordinates.
    assert.ok(result.features.distanceRemainingKm > 110 && result.features.distanceRemainingKm < 130);
    // 04:54 UTC is 10:24 IST on a Monday.
    assert.equal(result.features.hourOfDay, 10);
    assert.equal(result.features.dayOfWeek, 0);
  });

  test('a missing input skips the delivery rather than defaulting it', () => {
    for (const [label, args] of [
      ['route', [delivery, vehicle, undefined, weather(), new Date()]],
      ['vehicle', [delivery, undefined, route, weather(), new Date()]],
      ['weather', [delivery, vehicle, route, undefined, new Date()]],
    ] as const) {
      const result = (deliveryFeatures as any)(...args);
      assert.equal(result.ok, false, `${label} should have been required`);
      assert.match(result.reason, /NE-999/);
    }
  });

  test('weather severity bands agree with the label GET /api/weather already shows', () => {
    assert.equal(weatherSeverityFor(weather()), 'NORMAL');
    assert.equal(weatherSeverityFor(weather({ rainfall24h: 18 })), 'MODERATE');
    // 60 mm/24h is where the weather endpoint starts saying "Heavy Rainfall".
    assert.equal(weatherSeverityFor(weather({ rainfall24h: 60 })), 'HEAVY');
    assert.equal(weatherSeverityFor(weather({ rainfall24h: 140 })), 'SEVERE');
    assert.equal(weatherSeverityFor(weather({ rainfall1h: 30 })), 'SEVERE');
  });

  test('the clock is IST, and Monday is 0', () => {
    assert.deepEqual(istClock(new Date('2024-11-18T04:54:00Z')), { hourOfDay: 10, dayOfWeek: 0 });
    // 20:00 UTC Sunday is 01:30 IST Monday.
    assert.deepEqual(istClock(new Date('2024-11-17T20:00:00Z')), { hourOfDay: 1, dayOfWeek: 0 });
  });
});

describe('POST /api/ml/delivery-risk/score', () => {
  let result: Awaited<ReturnType<typeof score>>;

  before(async () => {
    result = await score({});
  });

  test('scores the assigned delivery from real rows', () => {
    assert.equal(result.status, 201, result.body.error);
    assert.equal(result.body.modelVersion, 'delivery-risk-xgb-v1');
    assert.equal(result.body.applied, false);
    const ne102 = result.body.scored.find((s: any) => s.code === 'NE-102');
    assert.ok(ne102, 'NE-102 was not scored');
    assert.ok(ne102.failureProbability >= 0 && ne102.failureProbability <= 1);
    assert.ok(Number.isInteger(ne102.predictedDelayMinutes) && ne102.predictedDelayMinutes >= 0);
    // The features carry the route risk from the layer above — that is the cascade.
    assert.equal(typeof ne102.features.routeRiskScore, 'number');
  });

  test('adjusted ETA is exactly current ETA plus the predicted delay', () => {
    const s = result.body.scored.find((x: any) => x.code === 'NE-102');
    const delta = (Date.parse(s.adjustedEta) - Date.parse(s.currentEta)) / 60_000;
    assert.equal(delta, s.predictedDelayMinutes);
  });

  test('SHAP factors come back for both heads, with their units', () => {
    const s = result.body.scored.find((x: any) => x.code === 'NE-102');
    assert.equal(s.topFactors.length, 5);
    assert.equal(s.delayFactors.length, 5);
    assert.equal(s.topFactors[0].shapUnit, 'log_odds');
    assert.equal(s.delayFactors[0].shapUnit, 'log1p_minutes');
    assert.ok(s.topFactors[0].contributionPct >= s.topFactors[4].contributionPct);
  });

  test('a delivery with no assigned route is skipped with a reason, not scored on a guess', () => {
    assert.ok(result.body.skipped.length > 0);
    for (const s of result.body.skipped) assert.match(s.reason, /has no assigned (route|vehicle)|weather/);
  });

  test('each prediction is persisted with ML provenance and its own model version', async () => {
    const rows = await prisma.riskPrediction.findMany({
      where: { entityType: 'DELIVERY', createdAt: { gte: startedAt } },
    });
    assert.ok(rows.length >= 1);
    for (const row of rows) {
      assert.equal(row.provenance, 'ML_PREDICTION');
      assert.equal(row.modelVersion, 'delivery-risk-xgb-v1');
      assert.ok(row.deliveryId);
      assert.equal(row.predictedDelayMinutes !== null, true);
      assert.ok(row.featureValues, 'inputs must be stored or the score cannot be reproduced');
      assert.ok(['baseline', 'heavy_rain'].includes(row.scenario ?? ''));
    }
  });

  test('scoring without apply leaves the delivery untouched', async () => {
    const ne102 = await prisma.delivery.findFirstOrThrow({ where: { code: 'NE-102' } });
    assert.equal(ne102.failureProbability, 0.18);
    assert.equal(ne102.expectedDelayMinutes, 0);
  });

  test('roles: a District Officer may not score (403), no token is 401', async () => {
    assert.equal((await score({}, districtToken)).status, 403);
    assert.equal((await score({}, '')).status, 401);
  });

  test('a malformed apply flag is a 400', async () => {
    assert.equal((await score({ apply: 'yes' })).status, 400);
  });
});
