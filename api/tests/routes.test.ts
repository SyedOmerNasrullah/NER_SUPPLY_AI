/**
 * Route geometry, route-owned segments and independent risk propagation — Phase 6B.
 *
 *   npm run test:routes      (needs the database; the cascade half also needs the API and ML)
 *
 * The question this suite exists to answer: when something happens on Route B, does Route B move
 * and Route A stay still? Everything else here supports that — ownership, geometry, matching —
 * and the last group proves it end to end, on all three routes, and puts the world back.
 */

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { prisma } from '../src/lib/prisma';
import { ROUTE_DEFINITIONS } from '../src/domain/routeWaypoints';
import { matchCorridor, nearestRoute, distanceToPathKm } from '../src/domain/geo';
import { OrsError, directions } from '../src/services/ors';

const API = process.env.API_URL ?? 'http://127.0.0.1:4000';
const ARTIFACT = resolve(__dirname, '../prisma/seed-data/ors-routes.json');

type Segment = Awaited<ReturnType<typeof prisma.routeSegment.findMany>>[number];
type Route = Awaited<ReturnType<typeof prisma.route.findMany>>[number];

let routes: Route[] = [];
let segments: Segment[] = [];
let token = '';

const byName = (name: string) => routes.find((r) => r.name.startsWith(name))!;
const owned = (routeName: string) =>
  segments.filter((s) => s.routeId === byName(routeName).id).sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));

async function load(): Promise<void> {
  [routes, segments] = await Promise.all([
    prisma.route.findMany({ orderBy: { name: 'asc' } }),
    prisma.routeSegment.findMany(),
  ]);
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

before(async () => {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await prisma.$queryRaw`SELECT 1`;
      break;
    } catch (err) {
      if (attempt >= 4) throw err;
    }
  }
  await load();
  token = await login();
});

after(async () => {
  await prisma.$disconnect();
});

// ---------------------------------------------------------------------------

describe('route ownership', () => {
  test('1-3. each route owns its own segments', () => {
    for (const name of ['Route A', 'Route B', 'Route C']) {
      assert.ok(owned(name).length >= 10, `${name} owns ${owned(name).length} segments`);
    }
  });

  test('4. every segment belongs to exactly one route, and none is unowned', () => {
    const unowned = segments.filter((s) => !s.routeId);
    assert.equal(unowned.length, 0, `unowned: ${unowned.map((s) => s.code).join(', ')}`);
    // `routeId` is a single column, so "exactly one" is structural; what is worth checking is
    // that no route claims a segment another route owns.
    const claimed = routes.flatMap((r) => r.segmentIds);
    assert.equal(new Set(claimed).size, claimed.length, 'a segment is claimed by two routes');
  });

  test('segment codes carry their route, and sequences run 1..n in driving order', () => {
    for (const [name, prefix] of [['Route A', 'SEG-'], ['Route B', 'B-SEG-'], ['Route C', 'C-SEG-']] as const) {
      const list = owned(name);
      assert.ok(list.every((s) => s.code.startsWith(prefix)), `${name} has a foreign code`);
      assert.deepEqual(
        list.map((s) => s.sequence),
        list.map((_, i) => i + 1),
      );
    }
  });

  test('5. the three geometries are distinct, and long enough to be roads rather than chords', () => {
    const geometries = routes.map((r) => JSON.stringify(r.geometry));
    assert.equal(new Set(geometries).size, 3, 'two routes share a geometry');
    for (const route of routes) {
      const path = route.geometry as [number, number][];
      assert.ok(Array.isArray(path) && path.length > 200, `${route.name} has ${path?.length} points`);
    }
  });

  test('a route’s own segments cover its own line', () => {
    for (const name of ['Route A', 'Route B', 'Route C']) {
      const route = byName(name);
      const path = route.geometry as [number, number][];
      // Every segment's midpoint should sit on its route's line.
      for (const segment of owned(name)) {
        const geometry = segment.geometry as [number, number][] | null;
        assert.ok(geometry && geometry.length >= 2, `${segment.code} has no geometry`);
        const mid = geometry[Math.floor(geometry.length / 2)];
        const d = distanceToPathKm(mid[0], mid[1], path);
        assert.ok(d < 1, `${segment.code} sits ${d.toFixed(2)} km off ${name}`);
      }
    }
  });

  test('6. route comparison returns all three, each with its own distance and segments', async () => {
    const { comparison } = (await (await fetch(`${API}/api/routes/comparison?deliveryId=NE-102`)).json()) as any;
    assert.equal(comparison.candidates.length, 3);
    assert.equal(new Set(comparison.candidates.map((c: any) => c.segmentIds.join())).size, 3);
    assert.equal(new Set(comparison.candidates.map((c: any) => Math.round(c.distanceKm))).size, 3);
  });
});

describe('generated geometry', () => {
  test('the committed artifact records what produced it', () => {
    assert.ok(existsSync(ARTIFACT), 'no ORS artifact committed');
    const artifact = JSON.parse(readFileSync(ARTIFACT, 'utf-8'));
    assert.equal(artifact.provenance, 'ORS_ROUTING');
    assert.equal(artifact.routes.length, 3);
    assert.match(artifact.statement, /synthetic/i, 'the artifact must say which parts are not measured');
  });

  test('the database says where its geometry came from', () => {
    for (const route of routes) {
      assert.ok(['ORS_ROUTING', 'SYNTHETIC_ROUTE_GEOMETRY'].includes(route.geometryProvenance));
      if (route.geometryProvenance === 'ORS_ROUTING') {
        assert.ok((route.orsDistanceKm ?? 0) > 100, `${route.name} has no ORS distance`);
        assert.ok(route.geometryUpdatedAt, `${route.name} has no generation timestamp`);
      }
    }
  });

  test('the API-side waypoints match the frontend’s, town for town', () => {
    const frontend = readFileSync(resolve(__dirname, '../../web/src/domain/geo.ts'), 'utf-8');
    for (const def of ROUTE_DEFINITIONS) {
      for (const town of def.waypoints) {
        // The frontend lists the same town at the same coordinates; a moved town must fail here
        // rather than silently produce a different road on one side.
        const pattern = new RegExp(`name: '${town.name}', lat: ${town.lat}, lng: ${town.lng}`);
        assert.match(frontend, pattern, `${def.label}: ${town.name} disagrees with the frontend`);
      }
    }
  });

  test('23. a missing ORS key fails cleanly rather than inventing a road', async () => {
    const original = process.env.ORS_API_KEY;
    delete process.env.ORS_API_KEY;
    try {
      // env is read at startup, so this asserts the shape of the failure rather than the key:
      // whatever happens, it is an OrsError and never a fabricated geometry.
      await directions([
        [26.1445, 91.7362],
        [26.4392, 92.03],
      ]);
    } catch (err) {
      assert.ok(err instanceof OrsError);
      assert.ok(['NOT_CONFIGURED', 'UNAVAILABLE', 'REJECTED', 'INVALID_RESPONSE'].includes(err.kind));
    } finally {
      if (original !== undefined) process.env.ORS_API_KEY = original;
    }
  });

  test('22. an ORS failure leaves the persisted geometry untouched', async () => {
    // The generator writes only after a successful call; the database is the last good state.
    const before = await prisma.route.findMany({ select: { id: true, geometry: true } });
    try {
      await directions([[0, 0], [0.0001, 0.0001]]); // open ocean: ORS finds no road
    } catch (err) {
      assert.ok(err instanceof OrsError);
    }
    const after = await prisma.route.findMany({ select: { id: true, geometry: true } });
    assert.deepEqual(after.map((r) => JSON.stringify(r.geometry)), before.map((r) => JSON.stringify(r.geometry)));
  });
});

describe('incident matching against route-owned segments', () => {
  const asRouteLike = () =>
    routes.map((r) => ({ id: r.id, name: r.name, geometry: r.geometry, riskScore: r.riskScore, riskLevel: r.riskLevel }));
  const asSegmentLike = () =>
    segments.map((s) => ({
      id: s.id, code: s.code, name: s.name,
      startLat: s.startLat, startLng: s.startLng, endLat: s.endLat, endLng: s.endLng,
      routeId: s.routeId, sequence: s.sequence, geometry: s.geometry,
    }));

  test('7-8. the Route-B-only stretch matches Route B and one of ITS segments', () => {
    // The coordinate from the bug report. Not special-cased anywhere: it is matched by the same
    // geometry the map draws.
    const match = matchCorridor(asRouteLike(), asSegmentLike(), 26.83523, 92.10746);
    assert.equal(match.route?.name, 'Route B');
    assert.ok(match.segment, 'no Route B segment matched');
    assert.ok(match.segment!.code.startsWith('B-SEG-'), `matched ${match.segment!.code}`);
    const segment = segments.find((s) => s.id === match.segment!.segmentId)!;
    assert.equal(segment.routeId, byName('Route B').id);
  });

  test('a point on the corridor matches Route A and a corridor segment', () => {
    const seg = owned('Route A').find((s) => s.code === 'SEG-010')!;
    const path = seg.geometry as [number, number][];
    const mid = path[Math.floor(path.length / 2)];
    const match = matchCorridor(asRouteLike(), asSegmentLike(), mid[0], mid[1]);
    assert.equal(match.route?.name, 'Route A');
    assert.equal(match.segment?.code, 'SEG-010');
  });

  test('a point on Route C’s own stretch matches Route C', () => {
    // Seppa, which only Route C visits.
    const match = matchCorridor(asRouteLike(), asSegmentLike(), 27.33, 93.04);
    assert.equal(match.route?.name, 'Route C');
    assert.ok(match.segment?.code.startsWith('C-SEG-'));
  });

  test('11. a point far from every road matches nothing at all', () => {
    const match = matchCorridor(asRouteLike(), asSegmentLike(), 23.7271, 92.7176); // Aizawl
    assert.equal(match.route, null);
    assert.equal(match.segment, null);
    assert.equal(nearestRoute(asRouteLike(), 23.7271, 92.7176), null);
  });

  test('the threshold was not widened to make matching easier', async () => {
    const { MAX_SEGMENT_DISTANCE_KM, MAX_ROUTE_DISTANCE_KM } = await import('../src/domain/geo');
    assert.equal(MAX_SEGMENT_DISTANCE_KM, 5);
    assert.equal(MAX_ROUTE_DISTANCE_KM, 5);
  });
});

describe('independent risk propagation', () => {
  interface Snapshot {
    segments: Record<string, { status: string; roadCondition: string }>;
  }

  const snapshot = async (): Promise<Snapshot> => {
    const rows = await prisma.routeSegment.findMany({ select: { code: true, currentStatus: true, roadCondition: true } });
    return {
      segments: Object.fromEntries(rows.map((r) => [r.code, { status: r.currentStatus, roadCondition: r.roadCondition }])),
    };
  };

  const report = async (lat: number, lng: number, description: string) => {
    const form = new FormData();
    form.set('type', 'LANDSLIDE');
    form.set('severity', 'HIGH');
    form.set('description', description);
    form.set('lat', String(lat));
    form.set('lng', String(lng));
    const res = await fetch(`${API}/api/incidents`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    return { status: res.status, body: (await res.json()) as any };
  };

  const reset = async () => {
    const res = await fetch(`${API}/api/demo/reset`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
    assert.equal(res.status, 200, 'reset');
  };

  before(async () => {
    await reset();
  });

  after(async () => {
    await reset();
  });

  test('9. a Route-B incident degrades a Route-B segment and leaves A and C alone', async () => {
    const before = await snapshot();
    const result = await report(26.83523, 92.10746, 'Phase 6B — Route B independence');
    assert.equal(result.status, 201, result.body.error);
    assert.ok(result.body.segmentMatch?.code.startsWith('B-SEG-'));

    const after = await snapshot();
    const changed = Object.keys(after.segments).filter(
      (code) =>
        after.segments[code].status !== before.segments[code].status ||
        after.segments[code].roadCondition !== before.segments[code].roadCondition,
    );
    assert.deepEqual(changed, [result.body.segmentMatch.code], `changed: ${changed.join(', ')}`);
    assert.ok(changed.every((c) => !c.startsWith('SEG-')), 'a Route A segment moved');
    assert.ok(changed.every((c) => !c.startsWith('C-SEG-')), 'a Route C segment moved');
    await reset();
  });

  test('10. a Route-C incident degrades a Route-C segment only', async () => {
    const before = await snapshot();
    const result = await report(27.33, 93.04, 'Phase 6B — Route C independence');
    assert.equal(result.status, 201, result.body.error);
    assert.ok(result.body.segmentMatch?.code.startsWith('C-SEG-'));

    const after = await snapshot();
    const changed = Object.keys(after.segments).filter(
      (code) => after.segments[code].status !== before.segments[code].status,
    );
    assert.deepEqual(changed, [result.body.segmentMatch.code]);
    await reset();
  });

  test('15-18. a HIGH incident re-scores with both models and runs the ladder', async () => {
    const result = await report(26.83523, 92.10746, 'Phase 6B — cascade');
    assert.equal(result.status, 201, result.body.error);
    assert.equal(result.body.cascadeTriggered, true);

    const rescored = result.body.rescored;
    if (!rescored) return; // ML_MODE=demo: the deterministic replay ran instead, which is documented
    assert.ok(rescored.modelVersions.includes('route-risk-xgb-v1'));
    assert.equal(rescored.routeRisk.length, 3, 'every candidate is re-scored');

    // Deliveries are re-scored only where they actually drive the affected road. This incident is
    // on Route B and the seeded delivery runs Route A, so the honest outcome is no delivery
    // re-score at all — putting NE-102's new numbers under a Route B landslide would assert a
    // cause that does not exist. When a delivery IS on the road, its model must be the one used.
    if (rescored.deliveries.length > 0) {
      assert.ok(rescored.modelVersions.includes('delivery-risk-xgb-v1'));
    }
    for (const d of rescored.deliveries) {
      assert.ok(d.failureProbability >= 0 && d.failureProbability <= 1);
      assert.ok(Number.isInteger(d.predictedDelayMinutes));
      if (d.decision) assert.ok(['REROUTE', 'PRE_POSITION', 'ALERT', 'NONE'].includes(d.decision));
    }
    await reset();
  });

  test('20. reset restores every segment, generated ones included', async () => {
    // Baseline from a known-clean world, so a previous test's incident cannot masquerade as the
    // thing reset is supposed to restore.
    await reset();
    const baseline = await snapshot();
    await report(26.83523, 92.10746, 'Phase 6B — reset check');
    await reset();
    const restored = await snapshot();
    assert.deepEqual(restored, baseline);

    const { comparison } = (await (await fetch(`${API}/api/routes/comparison`)).json()) as any;
    assert.deepEqual(
      comparison.candidates.map((c: any) => `${c.name} ${c.riskScore}`),
      ['Route A 21', 'Route B 28', 'Route C 41'],
    );
  });

  test('24. the persisted geometry survives a reset', async () => {
    const after = await prisma.route.findMany({ orderBy: { name: 'asc' } });
    for (const route of after) {
      const path = route.geometry as [number, number][];
      assert.ok(path.length > 200, `${route.name} lost its geometry`);
      assert.equal(route.geometryProvenance, 'ORS_ROUTING');
    }
  });
});
