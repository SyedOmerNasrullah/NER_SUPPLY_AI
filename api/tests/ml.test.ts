/**
 * Express <-> ML service tests.
 *
 *   npm run test:ml        (needs the ML service on ML_SERVICE_URL and the database)
 *
 * Failure modes are exercised against real sockets — a server that never answers, a port with
 * nothing on it, a server that answers off-contract — not against mocked fetch. A mock would
 * test that the client calls fetch; these test that it survives the network.
 *
 * Nothing here mutates the demo world. Persistence is checked against whatever scenario the
 * database is in; heavy rain is checked by building the storm's features from the frozen
 * after-rain snapshot and scoring them directly.
 */

// Force live mode for this process only, before config loads. dotenv does not override values
// already in process.env, so the developer's api/.env is left as it is.
process.env.ML_MODE = 'live';

import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, test } from 'node:test';
import type { Route, WeatherSnapshot } from '@prisma/client';
import world from '../prisma/seed-data/world.json';
import { prisma } from '../src/lib/prisma';
import { MlError, mlHealthCheck, predictRouteRisk, type RouteRiskFeatures } from '../src/services/mlClient';
import { routeFeatures } from '../src/services/routeRiskFeatures';
import { compare, scoreCorridor } from '../src/services/routeRiskScoring';

const ROUTE_A_BASELINE: RouteRiskFeatures = {
  rainfall1h: 4.2,
  rainfall3h: 10.1,
  rainfall6h: 17.2,
  rainfall24h: 31,
  windSpeedKmh: 12,
  roadCondition: 'FAIR',
  terrainSlopeDeg: 31,
  elevationM: 4170,
  historicalLandslides: 5,
  historicalFloods: 2,
  previousClosureFrequencyPct: 15.4,
  trafficLevel: 1.2,
};

async function stub(handler: http.RequestListener): Promise<{ url: string; close: () => Promise<void> }> {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

async function expectMlError(kind: MlError['kind'], run: () => Promise<unknown>) {
  await assert.rejects(run, (err: unknown) => {
    assert.ok(err instanceof MlError, `expected MlError, got ${String(err)}`);
    assert.equal(err.kind, kind);
    return true;
  });
}

/**
 * Wake the database before anything times against it. Neon's free tier suspends when idle and
 * the first connection after that can exceed Prisma's 5-second connect timeout — which made the
 * first run of this suite report five failures that had nothing to do with the code under test.
 * Retrying the connection here keeps "the database was asleep" from reading as "the ML
 * persistence is broken". A database that stays unreachable still fails the suite.
 */
before(async () => {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return;
    } catch (err) {
      if (attempt >= 4) throw err;
    }
  }
});

after(async () => {
  await prisma.$disconnect();
});

// 11 — Express -> FastAPI --------------------------------------------------------------------

describe('Express -> FastAPI', () => {
  test('health check reaches the model', async () => {
    const health = await mlHealthCheck();
    assert.equal(health.modelLoaded, true);
    assert.equal(health.modelVersion, 'route-risk-xgb-v1');
  });

  test('prediction round-trips with a validated contract', async () => {
    const p = await predictRouteRisk(ROUTE_A_BASELINE, 'test-route-a');
    assert.equal(p.modelVersion, 'route-risk-xgb-v1');
    assert.equal(p.reference, 'test-route-a');
    assert.ok(p.riskScore >= 0 && p.riskScore <= 100);
    assert.equal(p.topFactors.length, 5);
    assert.equal(p.provenance.source, 'ML_PREDICTION');
    assert.equal(p.provenance.trainedOn, 'synthetic');
  });

  test('the same input gives the same prediction', async () => {
    const [a, b] = [await predictRouteRisk(ROUTE_A_BASELINE), await predictRouteRisk(ROUTE_A_BASELINE)];
    assert.equal(a.rawPrediction, b.rawPrediction);
  });
});

// 12 — timeout and error handling ------------------------------------------------------------

describe('failure handling', () => {
  test('a service that never answers is a TIMEOUT', async () => {
    const hang = await stub(() => {
      /* accept the connection, never respond */
    });
    try {
      await expectMlError('TIMEOUT', () =>
        predictRouteRisk(ROUTE_A_BASELINE, undefined, { baseUrl: hang.url, token: 't', timeoutMs: 300 }),
      );
    } finally {
      await hang.close();
    }
  });

  test('nothing listening is UNAVAILABLE', async () => {
    const gone = await stub(() => {});
    const { url } = gone;
    await gone.close(); // the port is now free and refuses connections
    await expectMlError('UNAVAILABLE', () =>
      predictRouteRisk(ROUTE_A_BASELINE, undefined, { baseUrl: url, token: 't', timeoutMs: 1000 }),
    );
  });

  test('an off-contract answer is INVALID_RESPONSE, never persisted as a prediction', async () => {
    const liar = await stub((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ modelVersion: 'x', riskScore: 'very high', topFactors: [] }));
    });
    try {
      await expectMlError('INVALID_RESPONSE', () =>
        predictRouteRisk(ROUTE_A_BASELINE, undefined, { baseUrl: liar.url, token: 't' }),
      );
    } finally {
      await liar.close();
    }
  });

  test('a non-JSON answer is INVALID_RESPONSE', async () => {
    const html = await stub((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<h1>proxy error</h1>');
    });
    try {
      await expectMlError('INVALID_RESPONSE', () =>
        predictRouteRisk(ROUTE_A_BASELINE, undefined, { baseUrl: html.url, token: 't' }),
      );
    } finally {
      await html.close();
    }
  });

  test('features the model rejects are REJECTED', async () => {
    await expectMlError('REJECTED', () =>
      predictRouteRisk({ ...ROUTE_A_BASELINE, rainfall1h: -5 }),
    );
  });

  test('a wrong internal token is REJECTED', async () => {
    await expectMlError('REJECTED', () =>
      predictRouteRisk(ROUTE_A_BASELINE, undefined, { baseUrl: process.env.ML_SERVICE_URL ?? 'http://127.0.0.1:8000', token: 'wrong' }),
    );
  });

  test('ML error messages carry no Python detail', async () => {
    try {
      await predictRouteRisk({ ...ROUTE_A_BASELINE, rainfall1h: -5 });
      assert.fail('expected rejection');
    } catch (err) {
      assert.ok(err instanceof MlError);
      assert.doesNotMatch(err.message, /Traceback|rainfall1h|pydantic/i);
    }
  });
});

// 13 — PostgreSQL persistence ----------------------------------------------------------------

describe('persistence', () => {
  let before_count = 0;
  let result: Awaited<ReturnType<typeof scoreCorridor>>;

  before(async () => {
    before_count = await prisma.riskPrediction.count({ where: { provenance: 'ML_PREDICTION' } });
    result = await scoreCorridor();
  });

  test('every route and segment is scored, none skipped', async () => {
    // Counts come from the database rather than a literal: Phase 6B gave Routes B and C their own
    // segments, so "every segment" is now thirty-five rather than fifteen, and hard-coding it
    // again would just move the same staleness one phase along.
    const segmentCount = await prisma.routeSegment.count();
    const routeCount = await prisma.route.count();
    assert.equal(result.skipped.length, 0, `skipped: ${result.skipped.map((s) => s.reason).join('; ')}`);
    assert.equal(result.scored.filter((s) => s.entityType === 'ROUTE').length, routeCount);
    assert.equal(result.scored.filter((s) => s.entityType === 'SEGMENT').length, segmentCount);
  });

  test('predictions are written with inputs, SHAP and provenance', async () => {
    const after_count = await prisma.riskPrediction.count({ where: { provenance: 'ML_PREDICTION' } });
    assert.equal(after_count - before_count, result.scored.length);

    const row = await prisma.riskPrediction.findFirst({
      where: { provenance: 'ML_PREDICTION', entityType: 'ROUTE' },
      orderBy: { createdAt: 'desc' },
    });
    assert.ok(row);
    assert.equal(row.modelVersion, 'route-risk-xgb-v1');
    assert.equal(row.scenario, result.scenario);
    assert.ok(row.routeId);
    assert.equal(row.segmentId, null);
    assert.ok(row.featureValues && typeof row.featureValues === 'object');
    assert.equal(Object.keys(row.featureValues as object).length, 12);
    assert.ok(Array.isArray(row.topFactors) && row.topFactors.length === 5);
    assert.equal(typeof row.shapBaseValue, 'number');
  });

  test('scoring never overwrites the displayed demo scores', async () => {
    const source = result.scenario === 'heavy_rain' ? world.afterRain : world;
    const routes = await prisma.route.findMany();
    for (const r of routes) {
      const frozen = source.routeCandidates.find((c) => c.id === r.id);
      assert.equal(r.riskScore, frozen?.riskScore, `${r.name} display score changed`);
    }
  });
});

// 14 — baseline regression -------------------------------------------------------------------

describe('baseline regression checkpoint', () => {
  test('every entity has an ML score, and the frozen ones have a demo reference', async () => {
    const rows = await compare('baseline');
    assert.equal(rows.length, (await prisma.routeSegment.count()) + (await prisma.route.count()));

    for (const r of rows) {
      assert.notEqual(r.mlScore, null, `${r.label} has no ML score`);
    }

    // The frozen world describes the corridor and the three routes. Segments generated for Routes
    // B and C in Phase 6B are not in it, so they have no demo reference to compare against — and
    // reporting null there is the honest answer, not a gap to paper over.
    const frozen = rows.filter((r) => r.entityType === 'ROUTE' || /^SEG-/.test(r.label));
    assert.equal(frozen.length, 18);
    for (const r of frozen) {
      assert.notEqual(r.demoScore, null, `${r.label} has no frozen demo score`);
      assert.equal(r.difference, (r.mlScore ?? 0) - (r.demoScore ?? 0));
    }
    for (const r of rows.filter((x) => /^[BC]-SEG-/.test(x.label))) {
      assert.equal(r.demoScore, null, `${r.label} claims a frozen demo score it cannot have`);
    }
  });

  test('the demo reference is the frozen snapshot, not live state', async () => {
    const rows = await compare('baseline');
    const byLabel = Object.fromEntries(rows.map((r) => [r.label, r.demoScore]));
    assert.deepEqual([byLabel['Route A'], byLabel['Route B'], byLabel['Route C']], [21, 28, 41]);
  });
});

// 15 — heavy-rain regression -----------------------------------------------------------------

/** Route features exactly as Express would build them after the demo's simulated storm. */
function heavyRainRouteFeatures(routeId: string): RouteRiskFeatures {
  const after = world.afterRain.routeCandidates.find((r) => r.id === routeId);
  assert.ok(after, `no after-rain snapshot for ${routeId}`);
  const w = world.afterRain.weather;
  const weather = {
    rainfall1h: w.rainfall1hMm,
    rainfall3h: Number((w.rainfall1hMm * 2.4).toFixed(1)),
    rainfall6h: Number((w.rainfall1hMm * 4.1).toFixed(1)),
    rainfall24h: w.rainfall24hMm,
    windSpeedKmh: w.windKmh,
  } as WeatherSnapshot;
  const route = { name: after.name, segmentIds: [], profile: after.profile } as unknown as Route;
  const built = routeFeatures(route, weather);
  assert.ok(built.ok, built.ok ? '' : built.reason);
  return built.features;
}

function baselineRouteFeatures(routeId: string): RouteRiskFeatures {
  const base = world.routeCandidates.find((r) => r.id === routeId);
  assert.ok(base);
  const w = world.weather;
  const weather = {
    rainfall1h: w.rainfall1hMm,
    rainfall3h: Number((w.rainfall1hMm * 2.4).toFixed(1)),
    rainfall6h: Number((w.rainfall1hMm * 4.1).toFixed(1)),
    rainfall24h: w.rainfall24hMm,
    windSpeedKmh: w.windKmh,
  } as WeatherSnapshot;
  const route = { name: base.name, segmentIds: [], profile: base.profile } as unknown as Route;
  const built = routeFeatures(route, weather);
  assert.ok(built.ok);
  return built.features;
}

describe('heavy-rain regression', () => {
  const ids = world.routeCandidates.map((r) => r.id);

  test('heavy rain raises every route’s risk', async () => {
    for (const id of ids) {
      const base = await predictRouteRisk(baselineRouteFeatures(id));
      const heavy = await predictRouteRisk(heavyRainRouteFeatures(id));
      assert.ok(heavy.riskScore > base.riskScore + 10, `${id}: ${base.riskScore} -> ${heavy.riskScore}`);
    }
  });

  test('rainfall appears among the drivers and pushes risk up', async () => {
    const heavy = await predictRouteRisk(heavyRainRouteFeatures(ids[0]));
    const rain = heavy.topFactors.filter((f) => f.feature.startsWith('rainfall'));
    assert.ok(rain.length >= 1);
    assert.ok(rain.every((f) => f.direction === 'increases_risk'));
  });

  test('the model independently reaches the demo’s reroute: A >= 70 and B at least 15 lower', async () => {
    const [a, b] = await Promise.all([
      predictRouteRisk(heavyRainRouteFeatures(ids[0])),
      predictRouteRisk(heavyRainRouteFeatures(ids[1])),
    ]);
    assert.ok(a.riskScore >= 70, `Route A ${a.riskScore}`);
    assert.ok(a.riskScore - b.riskScore >= 15, `A ${a.riskScore} vs B ${b.riskScore}`);
  });
});
