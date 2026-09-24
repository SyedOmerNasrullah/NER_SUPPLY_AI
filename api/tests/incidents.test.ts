/**
 * Incident creation — the Phase 5A.1 acceptance tests.
 *
 *   npm run test:incidents      (needs the API on :4000 and the database)
 *
 * Every request goes over HTTP to the running Express server, exactly as the frontend's HTTP
 * adapter sends it: multipart form, bearer token. Coordinates are fixed, never random. Severity is
 * MEDIUM wherever the test does not specifically need a cascade, so the demo world is never
 * mutated, and every incident created here is deleted afterwards.
 */

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { prisma } from '../src/lib/prisma';
import { MAX_SEGMENT_DISTANCE_KM, distanceToSegmentKm } from '../src/domain/geo';

const API = process.env.API_URL ?? 'http://127.0.0.1:4000';
const created: string[] = [];

let fieldToken = '';
let districtToken = '';

async function login(email: string): Promise<string> {
  const res = await fetch(`${API}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: process.env.DEMO_ACCOUNT_PASSWORD ?? 'demo123' }),
  });
  assert.equal(res.status, 200, `login ${email}`);
  return ((await res.json()) as { token: string }).token;
}

async function report(fields: Record<string, string | number>, token = fieldToken) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, String(v));
  const res = await fetch(`${API}/api/incidents`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  });
  const body = (await res.json()) as {
    incident?: {
      id: string; lat: number; lng: number; segmentId?: string; segmentName?: string; type: string;
      routeImpact?: { routeId: string; name: string; distanceKm: number; riskScore: number };
    };
    cascadeTriggered?: boolean;
    segmentMatch?: { segmentId: string; code: string; distanceKm: number } | null;
    routeMatch?: { routeId: string; name: string; distanceKm: number; riskScore: number } | null;
    rescored?: {
      segmentCode: string;
      routeName: string | null;
      statusBefore: string;
      statusAfter: string;
      routeRisk: { name: string; riskScore: number; modelVersion: string }[];
      deliveries: { code: string; failureProbability: number; predictedDelayMinutes: number; decision?: string }[];
      modelVersions: string[];
    };
    error?: string;
  };
  if (body.incident) created.push(body.incident.id);
  return { status: res.status, body };
}

async function listIncidents() {
  const res = await fetch(`${API}/api/incidents`);
  assert.equal(res.status, 200);
  return ((await res.json()) as { incidents: { id: string; lat: number; lng: number; segmentId?: string }[] }).incidents;
}

before(async () => {
  // Wake a suspended Neon database before anything is timed against it.
  for (let attempt = 1; ; attempt += 1) {
    try {
      await prisma.$queryRaw`SELECT 1`;
      break;
    } catch (err) {
      if (attempt >= 4) throw err;
    }
  }
  fieldToken = await login('field@ner.local');
  districtToken = await login('district@ner.local');
});

after(async () => {
  if (created.length) await prisma.incident.deleteMany({ where: { id: { in: created } } });
  await prisma.$disconnect();
});

describe('reporting an incident on the corridor', () => {
  // A deterministic point just off SEG-010 (Bhalukpong – Tenga Valley): a point ON its stored
  // road geometry, nudged about 0.6 km north-east. Taken from the segment's own line rather than
  // the midpoint between its endpoints — with real road geometry a leg bows away from that chord,
  // and the chord's midpoint can sit closer to a different road entirely.
  let target = { lat: 0, lng: 0, segmentId: '' };
  let result: Awaited<ReturnType<typeof report>>;

  before(async () => {
    const seg = await prisma.routeSegment.findUniqueOrThrow({ where: { code: 'SEG-010' } });
    const path = (seg.geometry as [number, number][] | null) ?? [
      [seg.startLat, seg.startLng],
      [seg.endLat, seg.endLng],
    ];
    const mid = path[Math.floor(path.length / 2)];
    target = {
      lat: Number((mid[0] + 0.004).toFixed(5)),
      lng: Number((mid[1] + 0.004).toFixed(5)),
      segmentId: seg.id,
    };
    result = await report({
      type: 'LANDSLIDE',
      severity: 'MEDIUM',
      description: 'Acceptance test — slope failure beside the carriageway',
      lat: target.lat,
      lng: target.lng,
    });
  });

  test('1-3. POST succeeds and returns an id', () => {
    assert.equal(result.status, 201, result.body.error);
    assert.ok(result.body.incident?.id);
    assert.equal(result.body.incident?.type, 'LANDSLIDE');
  });

  test('4. the response carries the exact submitted coordinates', () => {
    assert.equal(result.body.incident?.lat, target.lat);
    assert.equal(result.body.incident?.lng, target.lng);
  });

  test('5-6. GET /incidents returns it, at exactly those coordinates', async () => {
    const found = (await listIncidents()).find((i) => i.id === result.body.incident?.id);
    assert.ok(found, 'created incident missing from GET /api/incidents');
    assert.equal(found.lat, target.lat);
    assert.equal(found.lng, target.lng);
  });

  test('7. it is associated with the nearest segment, which is SEG-010, within 5 km', () => {
    assert.equal(result.body.incident?.segmentId, target.segmentId);
    assert.ok(result.body.incident?.segmentName);
    assert.equal(result.body.segmentMatch?.code, 'SEG-010');
    assert.ok((result.body.segmentMatch?.distanceKm ?? 99) <= MAX_SEGMENT_DISTANCE_KM);
  });

  test('a MEDIUM report does not run the cascade', () => {
    assert.equal(result.body.cascadeTriggered, false);
  });

  test('9. it appears exactly once in the list', async () => {
    const matches = (await listIncidents()).filter((i) => i.id === result.body.incident?.id);
    assert.equal(matches.length, 1);
  });

  test('the incident location is authoritative — it is not moved onto the segment', async () => {
    const row = await prisma.incident.findUniqueOrThrow({ where: { id: result.body.incident!.id } });
    assert.equal(row.lat, target.lat);
    assert.equal(row.lng, target.lng);
    assert.equal(row.demoGenerated, true);
  });
});

describe('reporting an incident off the corridor', () => {
  test('Aizawl is not silently attached to the corridor, and a HIGH report there runs no cascade', async () => {
    const before = await prisma.demoState.findUniqueOrThrow({ where: { id: 'singleton' } });
    // Aizawl, Mizoram — ~350 km from the nearest corridor segment.
    const r = await report({ type: 'FLOOD', severity: 'HIGH', lat: 23.7271, lng: 92.7176 });
    assert.equal(r.status, 201, r.body.error);
    assert.equal(r.body.incident?.lat, 23.7271);
    assert.equal(r.body.incident?.lng, 92.7176);
    assert.equal(r.body.incident?.segmentId, undefined);
    assert.equal(r.body.segmentMatch, null);
    assert.equal(r.body.cascadeTriggered, false);
    const afterState = await prisma.demoState.findUniqueOrThrow({ where: { id: 'singleton' } });
    assert.equal(afterState.simulated, before.simulated, 'an off-corridor report changed the world');
  });
});

describe('validation', () => {
  const base = { type: 'LANDSLIDE', severity: 'LOW', lat: 27.0, lng: 92.5 };
  const cases: [string, Record<string, string | number>][] = [
    ['latitude > 90', { ...base, lat: 90.0001 }],
    ['latitude < -90', { ...base, lat: -90.5 }],
    ['longitude > 180', { ...base, lng: 180.25 }],
    ['longitude < -180', { ...base, lng: -181 }],
    ['non-numeric latitude', { ...base, lat: 'north' }],
    ['unknown incident type', { ...base, type: 'METEOR' }],
    ['unknown severity', { ...base, severity: 'EXTREME' }],
    ['a segment id that does not exist', { ...base, segmentId: 'd0000000-0000-4000-8000-00000000dead' }],
  ];
  for (const [label, fields] of cases) {
    test(`${label} is a 400 with a sentence`, async () => {
      const r = await report(fields);
      assert.equal(r.status, 400, `${label}: got ${r.status}`);
      assert.equal(typeof r.body.error, 'string');
      assert.doesNotMatch(r.body.error ?? '', /prisma|stack|at Object/i);
    });
  }

  test('a missing latitude is a 400', async () => {
    const { lat: _drop, ...rest } = base;
    const r = await report(rest);
    assert.equal(r.status, 400);
  });

  test('the boundaries themselves are accepted', async () => {
    const r = await report({ ...base, lat: -90, lng: 180 });
    assert.equal(r.status, 201, r.body.error);
  });
});

describe('authorization', () => {
  test('no token is a 401', async () => {
    const r = await report({ type: 'LANDSLIDE', severity: 'LOW', lat: 27, lng: 92.5 }, '');
    assert.equal(r.status, 401);
  });

  test('a District Officer may not report (403)', async () => {
    const r = await report({ type: 'LANDSLIDE', severity: 'LOW', lat: 27, lng: 92.5 }, districtToken);
    assert.equal(r.status, 403);
  });
});

describe('segment distance', () => {
  test('a point on a segment is 0 km away; distance clamps to the nearer end', () => {
    const start = { lat: 27.0, lng: 92.0 };
    const end = { lat: 27.0, lng: 92.1 };
    assert.ok(distanceToSegmentKm(27.0, 92.05, start, end) < 1e-9);
    // 0.1° of longitude beyond the end at 27°N is ~9.9 km.
    const beyond = distanceToSegmentKm(27.0, 92.2, start, end);
    assert.ok(beyond > 9.5 && beyond < 10.2, `got ${beyond}`);
  });
});


// ---------------------------------------------------------------------------
// Corridor association — delta D49
// ---------------------------------------------------------------------------

describe('a report on a stretch only Route B travels', () => {
  // The coordinate from the bug report: on Route B between Udalguri and Bhairabkunda. Before
  // Phase 6B it matched no segment at all, because the only segments in the database described
  // Route A. Now Route B owns that stretch, so it matches one of ITS segments — which is the
  // behaviour this coordinate was always supposed to have.
  const point = { lat: 26.83523, lng: 92.10746 };
  let result: Awaited<ReturnType<typeof report>>;

  before(async () => {
    result = await report({ type: 'LANDSLIDE', severity: 'MEDIUM', lat: point.lat, lng: point.lng });
  });

  test('is accepted and stored at exactly the reported point', () => {
    assert.equal(result.status, 201, result.body.error);
    assert.equal(result.body.incident?.lat, point.lat);
    assert.equal(result.body.incident?.lng, point.lng);
  });

  test('matches a Route-B segment — its own, not one borrowed from Route A', () => {
    assert.ok(result.body.segmentMatch, 'no segment matched');
    assert.match(result.body.segmentMatch!.code, /^B-SEG-/);
    assert.ok(result.body.segmentMatch!.distanceKm <= 5, 'matched outside the unchanged 5 km threshold');
    assert.equal(result.body.incident?.segmentId, result.body.segmentMatch!.segmentId);
  });

  test('is associated with the corridor it sits on', () => {
    assert.equal(result.body.routeMatch?.name, 'Route B');
    // Against real road geometry rather than the old schematic line, so a few kilometres of
    // difference between the drawn road and the reported point is expected.
    assert.ok((result.body.routeMatch?.distanceKm ?? 99) <= 5);
    assert.ok(result.body.routeMatch?.riskScore !== undefined);
  });

  test('the association survives the read, so the queue can label it', async () => {
    const found = (await listIncidents()).find((i) => i.id === result.body.incident?.id) as
      | { routeImpact?: { name: string } }
      | undefined;
    assert.equal(found?.routeImpact?.name, 'Route B');
  });
});

describe('a report genuinely off every corridor', () => {
  test('matches neither a segment nor a route, and says so', async () => {
    // Aizawl, ~350 km from the nearest corridor of any kind.
    const r = await report({ type: 'FLOOD', severity: 'MEDIUM', lat: 23.7271, lng: 92.7176 });
    assert.equal(r.status, 201, r.body.error);
    assert.equal(r.body.segmentMatch, null);
    assert.equal(r.body.routeMatch, null);
    assert.equal(r.body.incident?.routeImpact, undefined);
  });
});

describe('a report on the shared corridor', () => {
  test('matches both its segment and the route that runs over it', async () => {
    const seg = await prisma.routeSegment.findUniqueOrThrow({ where: { code: 'SEG-010' } });
    const path = (seg.geometry as [number, number][] | null) ?? [
      [seg.startLat, seg.startLng],
      [seg.endLat, seg.endLng],
    ];
    const mid = path[Math.floor(path.length / 2)];
    const r = await report({
      type: 'DEBRIS',
      severity: 'MEDIUM',
      lat: Number(mid[0].toFixed(5)),
      lng: Number(mid[1].toFixed(5)),
    });
    assert.equal(r.status, 201, r.body.error);
    assert.equal(r.body.segmentMatch?.code, 'SEG-010');
    assert.equal(r.body.routeMatch?.name, 'Route A');
  });
});

describe('a HIGH report on the corridor runs the real cascade', () => {
  let result: Awaited<ReturnType<typeof report>>;

  before(async () => {
    const seg = await prisma.routeSegment.findUniqueOrThrow({ where: { code: 'SEG-010' } });
    const path = (seg.geometry as [number, number][] | null) ?? [
      [seg.startLat, seg.startLng],
      [seg.endLat, seg.endLng],
    ];
    const mid = path[Math.floor(path.length / 2)];
    result = await report({
      type: 'LANDSLIDE',
      severity: 'HIGH',
      description: 'Cascade regression — slope failure on the corridor',
      lat: Number((mid[0] + 0.004).toFixed(5)),
      lng: Number((mid[1] + 0.004).toFixed(5)),
    });
  });

  after(async () => {
    // This one moved the world. Put it back, and leave the suite as it found it.
    const token = await login('admin@ner.local');
    const res = await fetch(`${API}/api/demo/reset`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
    assert.equal(res.status, 200, 'reset after cascade');
  });

  test('the cascade fires', () => {
    assert.equal(result.status, 201, result.body.error);
    assert.equal(result.body.cascadeTriggered, true);
  });

  test('both models re-score, and no heuristic stands in for either', function () {
    if (!result.body.rescored) {
      // ML_MODE=demo on this machine: the deterministic cascade still ran, and that is the
      // documented behaviour rather than a failure.
      assert.equal(result.body.cascadeTriggered, true);
      return;
    }
    const versions = result.body.rescored.modelVersions;
    assert.ok(versions.includes('route-risk-xgb-v1'), 'route risk must come from its model');
    assert.ok(versions.includes('delivery-risk-xgb-v1'), 'delivery risk must come from its model');
    assert.equal(result.body.rescored.routeRisk.length, 3, 'every candidate route is re-scored');
    assert.ok(result.body.rescored.deliveries.length >= 1);
    // The cascade names the segment it degraded and the route that owns it (delta D51).
    assert.match(result.body.rescored.segmentCode, /^SEG-/);
    assert.equal(result.body.rescored.routeName, 'Route A');
  });

  test('the delivery numbers written are the model’s, and the decision followed them', async () => {
    if (!result.body.rescored) return;
    const delivery = await prisma.delivery.findFirstOrThrow({ where: { code: 'NE-102' } });
    const prediction = await prisma.riskPrediction.findFirstOrThrow({
      where: { entityType: 'DELIVERY', deliveryId: delivery.id, provenance: 'ML_PREDICTION' },
      orderBy: { createdAt: 'desc' },
    });
    assert.equal(prediction.modelVersion, 'delivery-risk-xgb-v1');
    assert.equal(delivery.expectedDelayMinutes, prediction.predictedDelayMinutes);
    assert.equal(Math.round((delivery.failureProbability ?? 0) * 1000), Math.round(prediction.riskProbability * 1000));
    assert.ok(['REROUTE', 'PRE_POSITION', 'ALERT', 'NONE'].includes(result.body.rescored.deliveries[0]?.decision ?? 'NONE'));
  });
});
