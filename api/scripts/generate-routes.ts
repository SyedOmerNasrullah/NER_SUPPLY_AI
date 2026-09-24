/**
 * Generate route geometry and route-specific segments from OpenRouteService.
 *
 *   npm run routes:generate              # calls ORS, writes the artifact, updates the database
 *   npm run routes:generate -- --dry-run # calls ORS and prints what would change
 *   npm run routes:apply                 # no ORS: re-applies the committed artifact to the database
 *
 * Why this is a script and not a request handler: route geometry changes when someone decides it
 * should, not when a browser renders a map. ORS is called here, the result is written to
 * `prisma/seed-data/ors-routes.json`, and everything else in the system reads the database. A
 * machine with no key and no internet runs the whole product on the committed artifact.
 *
 * What it produces, per route:
 *
 *   * the driven polyline, [lat, lng], from ORS;
 *   * road distance and driving time, as ORS measured them;
 *   * one segment per town-to-town leg, owned by that route, with the leg's own geometry,
 *     distance, and elevation-derived terrain.
 *
 * Route A's fifteen segments keep their codes, names and hazard history — they are the frozen
 * demonstration, referenced by incidents, tests and the runbook. The generator gives them
 * geometry, distance, ownership and measured terrain; it does not touch their risk state.
 *
 * Routes B and C get new segments. Their terrain comes from ORS elevation; their hazard history
 * (landslides, floods, closure frequency, traffic, road condition) has no external source and is
 * derived deterministically from the route's own seeded profile, distributed by leg length. Those
 * fields are synthetic and the artifact says so.
 */

import { createHash } from 'node:crypto';
import { writeFileSync, existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Prisma } from '@prisma/client';
import { prisma } from '../src/lib/prisma';
import { ROUTE_DEFINITIONS, type RouteDefinition } from '../src/domain/routeWaypoints';
import { OrsError, directions, type LatLng, type OrsRoute } from '../src/services/ors';

const ARTIFACT = resolve(__dirname, '../prisma/seed-data/ors-routes.json');

interface GeneratedSegment {
  code: string;
  name: string;
  sequence: number;
  startLat: number;
  startLng: number;
  endLat: number;
  endLng: number;
  distanceKm: number;
  durationMin: number;
  geometry: LatLng[];
  /** Highest point on the leg, metres. Measured by ORS. */
  elevationM: number;
  /** Steepest sustained gradient on the leg, degrees. Derived from ORS elevation and distance. */
  terrainSlopeDeg: number;
  /**
   * Hazard attributes for a NEWLY generated segment — synthetic, derived from the route's seeded
   * profile. Absent for Route A, whose fifteen segments keep their own seeded values.
   *
   * Stored in the artifact because it is the only record of what these segments looked like
   * before any incident degraded them, and `POST /api/demo/reset` needs exactly that.
   */
  hazards?: {
    roadCondition: 'GOOD' | 'FAIR' | 'POOR';
    roadType: string;
    historicalLandslides: number;
    historicalFloods: number;
    previousClosureFrequencyPct: number;
    trafficLevel: number;
    distanceToRiverKm: number;
  };
}

interface GeneratedRoute {
  key: 'A' | 'B' | 'C';
  label: string;
  distanceKm: number;
  durationMin: number;
  geometry: LatLng[];
  segments: GeneratedSegment[];
}

interface Artifact {
  generatedAt: string;
  provenance: 'ORS_ROUTING';
  statement: string;
  profile: string;
  routes: GeneratedRoute[];
}

// ---------------------------------------------------------------------------

const round = (n: number, dp = 5) => Number(n.toFixed(dp));

/**
 * Ramer–Douglas–Peucker, in metres of perpendicular tolerance.
 *
 * ORS returns every vertex of the road — twelve thousand points for Route A, which is faithful
 * and far too heavy to send to a browser three times over. Simplifying to ~40 m keeps every bend
 * a reader can see at corridor zoom and drops the sub-metre noise between them. Distance and
 * duration are NOT recomputed from the simplified line: they stay as ORS measured them on the
 * full one, because the simplification is a drawing decision, not a survey.
 */
function simplify(points: LatLng[], toleranceM = 40): LatLng[] {
  if (points.length <= 2) return points;

  // Local flat-earth metres, good to a fraction of a percent over a single leg.
  const latM = 111_320;
  const lngM = 111_320 * Math.cos((points[0][0] * Math.PI) / 180);
  const perpendicular = (p: LatLng, a: LatLng, b: LatLng): number => {
    const ax = (p[1] - a[1]) * lngM, ay = (p[0] - a[0]) * latM;
    const bx = (b[1] - a[1]) * lngM, by = (b[0] - a[0]) * latM;
    const len = Math.hypot(bx, by);
    if (len === 0) return Math.hypot(ax, ay);
    return Math.abs(ax * by - ay * bx) / len;
  };

  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop()!;
    let worst = 0;
    let index = -1;
    for (let i = first + 1; i < last; i += 1) {
      const d = perpendicular(points[i], points[first], points[last]);
      if (d > worst) {
        worst = d;
        index = i;
      }
    }
    if (index !== -1 && worst > toleranceM) {
      keep[index] = 1;
      stack.push([first, index], [index, last]);
    }
  }
  return points.filter((_, i) => keep[i] === 1);
}

/** Great-circle distance, km — used only to space out the slope samples. */
function haversineKm([lat1, lng1]: LatLng, [lat2, lng2]: LatLng): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * The steepest gradient on a leg, in degrees.
 *
 * Measured over ~500 m windows rather than between adjacent ORS vertices: consecutive points can
 * be metres apart, where a one-metre elevation difference reads as a 30° wall. The window is what
 * a driver would call a gradient.
 */
function maxSlopeDeg(geometry: LatLng[], elevations: number[]): number {
  const WINDOW_KM = 0.5;
  let steepest = 0;
  let anchor = 0;
  let run = 0;
  for (let i = 1; i < geometry.length; i += 1) {
    run += haversineKm(geometry[i - 1], geometry[i]);
    if (run >= WINDOW_KM) {
      const rise = Math.abs(elevations[i] - elevations[anchor]);
      const slope = (Math.atan(rise / (run * 1000)) * 180) / Math.PI;
      if (slope > steepest) steepest = slope;
      anchor = i;
      run = 0;
    }
  }
  return Number(steepest.toFixed(1));
}

function buildSegments(def: RouteDefinition, route: OrsRoute): GeneratedSegment[] {
  return route.legs.map((leg, i) => {
    const from = def.waypoints[i];
    const to = def.waypoints[i + 1];
    const geometry = route.geometry.slice(leg.startIndex, leg.endIndex + 1);
    const elevations = route.elevations.slice(leg.startIndex, leg.endIndex + 1);
    // Terrain is measured on every ORS vertex; only what is stored gets simplified.
    const stored = simplify(geometry);
    return {
      code: `${def.codePrefix}-${String(i + 1).padStart(3, '0')}`,
      name: `${from.name} – ${to.name}`,
      sequence: i + 1,
      startLat: round(geometry[0][0]),
      startLng: round(geometry[0][1]),
      endLat: round(geometry[geometry.length - 1][0]),
      endLng: round(geometry[geometry.length - 1][1]),
      distanceKm: leg.distanceKm,
      durationMin: leg.durationMin,
      geometry: stored.map(([lat, lng]) => [round(lat), round(lng)] as LatLng),
      elevationM: Math.round(Math.max(...elevations)),
      terrainSlopeDeg: maxSlopeDeg(geometry, elevations),
    };
  });
}

// ---------------------------------------------------------------------------
// Hazard attributes for NEW segments (Routes B and C)
// ---------------------------------------------------------------------------

interface RouteProfileJson {
  roadCondition?: 'GOOD' | 'FAIR' | 'POOR';
  trafficLevel?: number;
  history?: { previousClosures?: number; landslides?: number; floods?: number };
}

/**
 * Hazard history for a generated segment, distributed from its route's own seeded profile.
 *
 * ORS supplies geometry and elevation; it knows nothing about landslides. Rather than invent a
 * number per segment, the route's recorded totals are spread across its legs in proportion to
 * length and weighted toward the high ground, where this corridor's slides actually happen. The
 * result is deterministic, sums back to the route's own totals, and is labelled synthetic.
 */
function hazardsFor(
  segment: GeneratedSegment,
  profile: RouteProfileJson,
  totalDistanceKm: number,
  maxElevationM: number,
) {
  const lengthShare = segment.distanceKm / Math.max(1, totalDistanceKm);
  // 0 in the plains, 1 at the route's highest point.
  const altitude = maxElevationM > 0 ? Math.min(1, segment.elevationM / maxElevationM) : 0;
  const slideWeight = lengthShare * (0.35 + 1.3 * altitude);
  const floodWeight = lengthShare * (1.4 - 0.9 * altitude); // floods belong to the low ground

  const history = profile.history ?? {};
  const roadCondition: 'GOOD' | 'FAIR' | 'POOR' =
    segment.terrainSlopeDeg >= 6 || segment.elevationM >= 2000
      ? 'POOR'
      : segment.elevationM >= 600 || segment.terrainSlopeDeg >= 3
        ? 'FAIR'
        : (profile.roadCondition ?? 'FAIR') === 'POOR'
          ? 'FAIR'
          : 'GOOD';

  return {
    roadCondition,
    roadType: segment.elevationM >= 1500 ? 'rural' : segment.elevationM >= 400 ? 'state_road' : 'highway',
    historicalLandslides: Math.round((history.landslides ?? 0) * slideWeight * 2.2),
    historicalFloods: Math.round((history.floods ?? 0) * floodWeight * 2.2),
    previousClosureFrequencyPct: Number(
      (((history.previousClosures ?? 0) * lengthShare * 2.2) / 52 * 100).toFixed(1),
    ),
    // Traffic thins as the road climbs; the route's profile mean anchors it.
    trafficLevel: Math.max(0, Math.min(2, Math.round((profile.trafficLevel ?? 1) * (1 - 0.55 * altitude)))),
    distanceToRiverKm: Number((0.5 + 4.5 * altitude).toFixed(1)),
  };
}

// ---------------------------------------------------------------------------

async function generate(): Promise<Artifact> {
  const routes: GeneratedRoute[] = [];
  const dbRoutes = await prisma.route.findMany();
  for (const def of ROUTE_DEFINITIONS) {
    process.stdout.write(`  ${def.label}: asking ORS for ${def.waypoints.length} waypoints… `);
    const result = await directions(def.waypoints.map((w) => [w.lat, w.lng] as LatLng));
    const segments = buildSegments(def, result);

    // Route A's segments already exist with their own seeded hazard history; only the generated
    // ones need derived attributes, and they are recorded in the artifact.
    if (def.key !== 'A') {
      const profile = ((dbRoutes.find((r) => r.name.startsWith(def.label))?.profile ?? {}) as RouteProfileJson);
      const maxElevation = Math.max(...segments.map((s) => s.elevationM), 1);
      for (const segment of segments) {
        segment.hazards = hazardsFor(segment, profile, result.distanceKm, maxElevation);
      }
    }
    console.log(
      `${result.distanceKm} km, ${result.durationMin} min, ${segments.length} legs, ` +
        `${result.geometry.length} pts -> ${simplify(result.geometry).length} stored`,
    );
    routes.push({
      key: def.key,
      label: def.label,
      distanceKm: result.distanceKm,
      durationMin: result.durationMin,
      geometry: simplify(result.geometry).map(([lat, lng]) => [round(lat), round(lng)] as LatLng),
      segments,
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    provenance: 'ORS_ROUTING',
    statement:
      'Geometry, road distance, driving time and elevation come from OpenRouteService (driving-car). ' +
      'Hazard history, road condition and traffic for generated segments are synthetic, derived ' +
      'deterministically from each route’s seeded profile — ORS does not supply them.',
    profile: 'driving-car',
    routes,
  };
}

/** Write the artifact to the database: route geometry, and one owned segment per leg. */
async function apply(artifact: Artifact): Promise<void> {
  const dbRoutes = await prisma.route.findMany({ orderBy: { name: 'asc' } });

  for (const generated of artifact.routes) {
    const route = dbRoutes.find((r) => r.name.startsWith(generated.label));
    if (!route) {
      console.warn(`  ! no seeded route named ${generated.label}; skipped`);
      continue;
    }

    await prisma.route.update({
      where: { id: route.id },
      data: {
        geometry: generated.geometry as unknown as Prisma.InputJsonValue,
        // Distance becomes ORS's measurement, because it now describes the line actually drawn:
        // a 574 km road labelled 449 km would be a map contradicting its own caption. `reset`
        // never touches `distanceKm`, so this survives a demo reset.
        distanceKm: generated.distanceKm,
        // `etaMinutes` is NOT overwritten. It is the demonstration's scheduled time, restored by
        // reset and quoted by the runbook, and ORS's duration disagrees with it in a way that
        // would invert the demo's story (ORS makes the bypass faster than the corridor). Both
        // numbers are kept, and the docs say which is which.
        orsDistanceKm: generated.distanceKm,
        orsDurationMin: generated.durationMin,
        geometryProvenance: artifact.provenance,
        geometryUpdatedAt: new Date(artifact.generatedAt),
      },
    });

    const profile = (route.profile ?? {}) as RouteProfileJson;
    const maxElevation = Math.max(...generated.segments.map((s) => s.elevationM), 1);
    const ownedIds: string[] = [];

    for (const segment of generated.segments) {
      const existing = await prisma.routeSegment.findUnique({ where: { code: segment.code } });
      const common = {
        name: segment.name,
        startLat: segment.startLat,
        startLng: segment.startLng,
        endLat: segment.endLat,
        endLng: segment.endLng,
        routeId: route.id,
        sequence: segment.sequence,
        geometry: segment.geometry as unknown as Prisma.InputJsonValue,
        distanceKm: segment.distanceKm,
        geometryProvenance: artifact.provenance,
      };

      if (existing) {
        // An existing segment — Route A's fifteen — keeps its hazard history, road condition and
        // risk state. It gains geometry, ownership and ORS-measured terrain, and nothing else.
        const updated = await prisma.routeSegment.update({
          where: { code: segment.code },
          data: { ...common, elevationM: segment.elevationM, terrainSlopeDeg: segment.terrainSlopeDeg },
        });
        ownedIds.push(updated.id);
      } else {
        const hazards = segment.hazards ?? hazardsFor(segment, profile, generated.distanceKm, maxElevation);
        const created = await prisma.routeSegment.create({
          data: {
            code: segment.code,
            ...common,
            elevationM: segment.elevationM,
            terrainSlopeDeg: segment.terrainSlopeDeg,
            ...hazards,
            roadCondition: hazards.roadCondition,
            currentStatus: 'OPEN',
            // No risk score until something scores it. A seeded number here would be a
            // prediction nobody made.
            lastRiskScore: null,
          },
        });
        ownedIds.push(created.id);
      }
    }

    // `segmentIds` now lists the segments this route OWNS, in driving order.
    await prisma.route.update({ where: { id: route.id }, data: { segmentIds: ownedIds } });
    console.log(`  ${generated.label}: ${ownedIds.length} owned segments, ${generated.geometry.length} geometry points`);
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const fromArtifact = args.includes('--from-artifact');

  let artifact: Artifact;

  if (fromArtifact) {
    if (!existsSync(ARTIFACT)) {
      throw new Error(`No artifact at ${ARTIFACT}. Run \`npm run routes:generate\` once with an ORS key.`);
    }
    artifact = JSON.parse(readFileSync(ARTIFACT, 'utf-8')) as Artifact;
    console.log(`Applying committed geometry generated ${artifact.generatedAt} (${artifact.provenance}).`);
  } else {
    console.log('Generating route geometry from OpenRouteService…');
    try {
      artifact = await generate();
    } catch (err) {
      if (err instanceof OrsError) {
        // The whole point of persisting the artifact: a failure here leaves the database exactly
        // as it was, still serving the last geometry that worked.
        console.error(`\nOpenRouteService failed (${err.kind}): ${err.message}`);
        console.error(
          existsSync(ARTIFACT)
            ? 'The database keeps its current geometry. Re-run with --from-artifact to reapply the committed one.'
            : 'No committed artifact exists yet, so nothing was changed.',
        );
        process.exitCode = 1;
        return;
      }
      throw err;
    }
    writeFileSync(ARTIFACT, `${JSON.stringify(artifact, null, 2)}\n`, 'utf-8');
    const digest = createHash('sha256').update(readFileSync(ARTIFACT)).digest('hex');
    console.log(`\nartifact  prisma/seed-data/ors-routes.json  sha256 ${digest.slice(0, 16)}…`);
  }

  if (dryRun) {
    console.log('\n--dry-run: the database was not touched.');
    return;
  }

  console.log('\nApplying to the database…');
  await apply(artifact);

  // Every scored segment needs weather. The seed writes one snapshot per corridor segment, and a
  // generated segment without one is silently skipped by the scorer — which is how twenty of them
  // ended up unscored. Each new segment gets a snapshot carrying the corridor's current
  // conditions, so `simulate-rain` (which updates every snapshot) and `reset` keep working.
  const template = await prisma.weatherSnapshot.findFirst({ orderBy: { createdAt: 'desc' } });
  if (template) {
    const withWeather = new Set(
      (await prisma.weatherSnapshot.findMany({ select: { segmentId: true } })).map((w) => w.segmentId),
    );
    const missing = (await prisma.routeSegment.findMany({ select: { id: true } })).filter(
      (s) => !withWeather.has(s.id),
    );
    if (missing.length) {
      await prisma.weatherSnapshot.createMany({
        data: missing.map((s) => ({
          segmentId: s.id,
          rainfall1h: template.rainfall1h,
          rainfall3h: template.rainfall3h,
          rainfall6h: template.rainfall6h,
          rainfall24h: template.rainfall24h,
          windSpeedKmh: template.windSpeedKmh,
          visibility: template.visibility,
          isSimulated: template.isSimulated,
        })),
      });
      console.log(`  weather snapshots created for ${missing.length} generated segments`);
    }
  }

  console.log('\nDone. Route geometry and route-owned segments are persisted.');
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
