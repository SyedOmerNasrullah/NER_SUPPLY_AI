/**
 * The full intelligence cascade, end to end — Phase 6C.
 *
 *   npm run test:cascade      (needs the API on :4000, the database, and the ML service live)
 *
 * This is the only suite that deliberately moves the world: it simulates the storm, lets the
 * models re-score, checks that each layer consumed the one above it, and then resets. The reset
 * is asserted, not assumed — a cascade test that left the demo dirty would be worse than no test.
 *
 * Every number checked here is read back from the API, never computed in the test. The one
 * arithmetic assertion is the ETA identity the product promises: adjusted = current + delay.
 */

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { prisma } from '../src/lib/prisma';

const API = process.env.API_URL ?? 'http://127.0.0.1:4000';

let token = '';
let tawangId = '';
let seg010 = '';

interface Snapshot {
  routes: { name: string; risk: number }[];
  delivery: { status: string; failureProbability: number | null; delayMinutes: number | null; etaIso: string; routeId: string | null };
  coverHours: number | null;
  simulated: boolean;
}

async function login(): Promise<string> {
  const res = await fetch(`${API}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@ner.local', password: process.env.DEMO_ACCOUNT_PASSWORD ?? 'demo123' }),
  });
  assert.equal(res.status, 200, 'admin login');
  return ((await res.json()) as { token: string }).token;
}

async function snapshot(): Promise<Snapshot> {
  const [candidates, deliveries, districts, weather] = await Promise.all([
    fetch(`${API}/api/routes/comparison`).then((r) => r.json()) as Promise<any>,
    fetch(`${API}/api/deliveries`).then((r) => r.json()) as Promise<any>,
    fetch(`${API}/api/districts`).then((r) => r.json()) as Promise<any>,
    fetch(`${API}/api/weather`).then((r) => r.json()) as Promise<any>,
  ]);
  const d = deliveries.deliveries.find((x: any) => x.code === 'NE-102');
  const tawang = districts.districts.find((x: any) => x.name.startsWith('Tawang'));
  return {
    routes: candidates.comparison.candidates.map((c: any) => ({ name: c.name, risk: c.riskScore })),
    delivery: {
      status: d.status,
      failureProbability: d.failureProbability ?? null,
      delayMinutes: d.expectedDelayMinutes ?? null,
      etaIso: d.currentEta,
      routeId: d.assignedRouteId ?? null,
    },
    coverHours: tawang.stock.medicine.predictedStockoutHours,
    simulated: weather.weather.simulated,
  };
}

const post = (path: string, body?: unknown) =>
  fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

before(async () => {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await prisma.$queryRaw`SELECT 1`;
      break;
    } catch (err) {
      if (attempt >= 4) throw err;
    }
  }
  token = await login();
  const segments = (await (await fetch(`${API}/api/risk/segments`)).json()) as any;
  seg010 = segments.segments.find((s: any) => s.code === 'SEG-010').id;
  const districts = (await (await fetch(`${API}/api/districts`)).json()) as any;
  tawangId = districts.districts.find((d: any) => d.name.startsWith('Tawang')).id;

  // Always start from the baseline, whatever the previous run left behind.
  await post('/api/demo/reset');
});

after(async () => {
  await post('/api/demo/reset');
  await prisma.$disconnect();
});

describe('cascade: weather -> route -> delivery -> ETA -> supply -> decision', () => {
  let baseline: Snapshot;
  let afterRain: Snapshot;
  let afterMl: Snapshot;
  let scored: any;

  before(async () => {
    baseline = await snapshot();
    assert.equal((await post('/api/demo/simulate-rain', { segmentId: seg010 })).status, 200);
    afterRain = await snapshot();

    const res = await post('/api/ml/delivery-risk/score', { apply: true });
    assert.equal(res.status, 201, 'delivery scoring');
    scored = await res.json();
    afterMl = await snapshot();
  });

  test('baseline is the documented demo state', () => {
    assert.deepEqual(
      baseline.routes,
      [
        { name: 'Route A', risk: 21 },
        { name: 'Route B', risk: 28 },
        { name: 'Route C', risk: 41 },
      ],
    );
    assert.equal(baseline.delivery.failureProbability, 0.18);
    assert.equal(baseline.coverHours, 51);
    assert.equal(baseline.simulated, false);
  });

  test('1. weather moves segment and route risk', () => {
    assert.equal(afterRain.simulated, true);
    const risk = Object.fromEntries(afterRain.routes.map((r) => [r.name, r.risk]));
    assert.equal(risk['Route A'], 87);
    assert.equal(risk['Route B'], 32);
    assert.equal(risk['Route C'], 64);
  });

  test('2. route risk is what the delivery model is fed', () => {
    const ne102 = scored.scored.find((s: any) => s.code === 'NE-102');
    assert.ok(ne102, 'NE-102 was not scored');
    const assignedRisk = afterRain.routes.find((r) => r.name === 'Route A')!.risk;
    assert.equal(ne102.features.routeRiskScore, assignedRisk);
    assert.equal(ne102.features.weatherSeverity, 'SEVERE');
  });

  test('3. the delivery numbers written are the model’s own', () => {
    assert.equal(scored.modelVersion, 'delivery-risk-xgb-v1');
    assert.equal(scored.applied, true);
    const ne102 = scored.scored.find((s: any) => s.code === 'NE-102');
    assert.equal(afterMl.delivery.failureProbability, ne102.failureProbability);
    assert.equal(afterMl.delivery.delayMinutes, ne102.predictedDelayMinutes);
  });

  test('4. the ETA is the previous ETA plus the predicted delay, exactly', () => {
    const ne102 = scored.scored.find((s: any) => s.code === 'NE-102');
    const delta = (Date.parse(ne102.adjustedEta) - Date.parse(ne102.currentEta)) / 60_000;
    assert.equal(delta, ne102.predictedDelayMinutes);
    assert.equal(afterMl.delivery.etaIso, ne102.adjustedEta);
  });

  test('5. supply cover follows the delivery, and the projection explains itself', async () => {
    assert.ok(
      (afterMl.coverHours ?? 0) <= (afterRain.coverHours ?? 0),
      'cover should not improve while the delivery is later',
    );
    const detail = (await (await fetch(`${API}/api/districts/${tawangId}`)).json()) as any;
    const medicine = detail.projections.find((p: any) => p.category === 'medicine');
    assert.ok(medicine.projection.explanation.length > 0);
    assert.equal(medicine.projection.safetyThresholdHours, 48);
    assert.ok(medicine.projection.stockoutAt);
  });

  test('6. the Decision Engine ran on those numbers and matched a documented rule', () => {
    const ne102 = scored.scored.find((s: any) => s.code === 'NE-102');
    assert.ok(['REROUTE', 'PRE_POSITION', 'ALERT', 'NONE'].includes(ne102.decision?.outcome));
    // With Route A at 87 and Route B at 32, rule one is the one that should fire.
    assert.equal(ne102.decision.outcome, 'REROUTE');
    assert.equal(ne102.decision.confidence, 0.87);
  });

  test('7. the comparison names the same safer route the engine used', async () => {
    const { comparison } = (await (await fetch(`${API}/api/routes/comparison?deliveryId=NE-102`)).json()) as any;
    assert.equal(comparison.rerouteAdvised, true);
    const safer = comparison.candidates.find((c: any) => c.routeId === comparison.saferCandidateId);
    assert.equal(safer.name, 'Route B');
    assert.equal(safer.riskDelta, 87 - 32);
  });

  test('8. every ML prediction persisted carries provenance and a model version', async () => {
    const rows = await prisma.riskPrediction.findMany({
      where: { provenance: 'ML_PREDICTION', scenario: 'heavy_rain' },
      take: 20,
    });
    assert.ok(rows.length > 0);
    for (const r of rows) {
      assert.match(r.modelVersion, /-xgb-v1$/);
      assert.ok(r.featureValues, 'a stored prediction must keep its inputs');
    }
  });

  test('9. reset restores the baseline and drops predictions of the undone world', async () => {
    assert.equal((await post('/api/demo/reset')).status, 200);
    const restored = await snapshot();
    assert.deepEqual(restored.routes, baseline.routes);
    assert.equal(restored.delivery.failureProbability, baseline.delivery.failureProbability);
    assert.equal(restored.delivery.delayMinutes, baseline.delivery.delayMinutes);
    assert.equal(restored.delivery.etaIso, baseline.delivery.etaIso);
    assert.equal(restored.coverHours, baseline.coverHours);
    assert.equal(restored.simulated, false);

    const stale = await prisma.riskPrediction.count({
      where: { provenance: 'ML_PREDICTION', scenario: 'heavy_rain' },
    });
    assert.equal(stale, 0, 'predictions describing the simulated world should not survive a reset');
  });
});
