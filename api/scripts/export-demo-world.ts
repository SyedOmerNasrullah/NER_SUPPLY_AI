/**
 * Snapshot the frozen frontend's baseline demo world into JSON for the database seed.
 *
 * The point of this script is that the seed does not get to *invent* a baseline. Phases 2-3F
 * settled every number in the demo — Route A at 21%, NE-102's 5h05 ETA, Tawang's 2.1 days —
 * and those values live in `web/src/data/demo/`. Re-typing them into a seed file would create a
 * second copy that drifts the first time either side is edited, which is precisely the failure
 * this project's contract-delta discipline exists to prevent.
 *
 * So the exporter calls the demo adapter's own read methods and writes down what they return.
 * Whatever the frontend shows at baseline is, by construction, what lands in PostgreSQL.
 *
 * It is a build-time tool, not a runtime dependency: the API never imports from `web/`.
 *
 *   npm run export:world     # regenerate prisma/seed-data/world.json
 *
 * Re-run it only when the demo baseline deliberately changes. The output is committed so the
 * seed works on a machine that has not built the frontend.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import Module from 'node:module';
import { basename, dirname, resolve } from 'node:path';
import type { DataSource } from '@web/data/source';

// The fixtures import two field photographs, which Vite turns into URLs and Node cannot parse
// at all. Teaching require() to hand back a path string instead lets the demo modules load
// unmodified — the alternative is editing the frozen frontend to suit a build script.
for (const ext of ['.jpg', '.jpeg', '.png', '.webp', '.svg']) {
  (Module as unknown as { _extensions: Record<string, unknown> })._extensions[ext] = (
    m: NodeModule,
    filename: string,
  ) => {
    m.exports = `/assets/${basename(filename)}`;
  };
}

/* eslint-disable @typescript-eslint/no-var-requires */
// Required, not imported: the extension hook above has to be installed before these modules
// load, and `import` is hoisted above it.
const { demoSource } = require('@web/data/demo') as { demoSource: DataSource };
const {
  DELIVERY_SUCCESS_HISTORY,
  DEMO_SEGMENT_ID,
  DEMO_DELIVERY_ID,
  DEMO_DISTRICT_ID,
  DEMO_PASSWORD,
  DISTRICT_STATE,
  ROUTE_SPECS,
} = require('@web/data/demo/fixtures') as typeof import('@web/data/demo/fixtures');
const { DEMO_NOW_ISO } = require('@web/data/demo/clock') as typeof import('@web/data/demo/clock');
const { CORRIDOR_WAYPOINTS, haversineKm } = require('@web/domain/geo') as typeof import('@web/domain/geo');
const { ELEVATION_PROFILES, ROUTE_PROFILES } =
  require('@web/data/demo/routeProfiles') as typeof import('@web/data/demo/routeProfiles');

const OUT = resolve(__dirname, '../prisma/seed-data/world.json');

async function main(): Promise<void> {
  // Every read the DataSource offers, at baseline. No simulate, no reroute — the world is
  // untouched, which is exactly the state the database should start in.
  const [
    vehicles,
    officers,
    deliveries,
    districts,
    warehouses,
    segments,
    incidents,
    alerts,
    weather,
    movements,
    notifications,
    analytics,
    accounts,
  ] = await Promise.all([
    demoSource.getVehicles(),
    demoSource.getFieldOfficers(),
    demoSource.getDeliveries(),
    demoSource.getDistricts(),
    demoSource.getWarehouses(),
    demoSource.getRiskSegments(),
    demoSource.getIncidents(),
    demoSource.getAlerts(),
    demoSource.getWeather(),
    demoSource.getRecentMovements(),
    demoSource.getNotifications(),
    demoSource.getAnalyticsSummary(),
    demoSource.getDemoAccounts(),
  ]);

  // Route candidates are requested per delivery. The demo corridor's three candidates are the
  // ones the product is built around, so they are exported against the featured delivery.
  const featured = deliveries.deliveries.find((d) => d.id === DEMO_DELIVERY_ID);
  if (!featured) throw new Error('Featured delivery NE-102 missing from the demo world');

  const candidates = await demoSource.getRouteCandidates({
    originLat: featured.originLat,
    originLng: featured.originLng,
    destLat: featured.destLat,
    destLng: featured.destLng,
    cargoPriority: featured.priority,
    deliveryId: featured.id,
  });

  // Per-delivery detail carries the recommendation the decision engine reached at baseline.
  const details = await Promise.all(
    deliveries.deliveries.map(async (d) => ({
      deliveryId: d.id,
      detail: await demoSource.getDeliveryById(d.id),
    })),
  );

  const districtDetails = await Promise.all(
    districts.districts.map(async (d) => ({
      districtId: d.id,
      detail: await demoSource.getDistrictById(d.id),
    })),
  );

  // Freeze the baseline before touching the world.
  //
  // `getRiskSegments()` returns `[...world.segments]` — a copy of the array, holding the SAME
  // objects. Running the cascade below mutates those objects in place, which retroactively
  // rewrote the "baseline" captured above: SEG-010 came out of the exporter at 87 instead of 43,
  // and the seed dutifully wrote a simulated corridor into the database as its resting state.
  // Deep-copying here is what makes "before" actually mean before.
  const frozen = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

  const baselineSegments = frozen(segments.segments);
  const baselineDeliveries = frozen(deliveries.deliveries);
  const baselineDistricts = frozen(districts.districts);
  const baselineAlerts = frozen(alerts.alerts);
  const baselineNotifications = frozen(notifications.notifications);
  const baselineMovements = frozen(movements.movements);
  const baselineWeather = frozen(weather.weather);
  const baselineCandidates = frozen(candidates.candidates);
  const baselineDetails = frozen(details);
  const baselineDistrictDetails = frozen(districtDetails);
  const baselineVehicles = frozen(vehicles.vehicles);
  const baselineIncidents = frozen(incidents.incidents);

  // --- The cascade, as the frozen demo actually produces it ----------------
  //
  // Phase 4B moves the simulation server-side. The temptation is to reimplement it against
  // Prisma rows — and that is exactly how the two halves of this project would start disagreeing
  // about whether Route A scores 87 or 86.
  //
  // Instead the exporter *runs* the frozen cascade and records its output. The API then applies
  // this recorded delta to the database. The numbers still have one author: the demo world that
  // Phases 2-3F settled and froze. Nothing is retyped, so nothing can drift.
  //
  // What the API does NOT replay is reroute — that has to work for any candidate route, not
  // just the demo's, so its formulas are implemented properly server-side. This covers the one
  // scripted event the demo fires.
  await demoSource.simulateRain(DEMO_SEGMENT_ID);

  const [
    rainWeather,
    rainSegments,
    rainDeliveries,
    rainDistricts,
    rainAlerts,
    rainNotifications,
    rainMovements,
  ] = await Promise.all([
    demoSource.getWeather(),
    demoSource.getRiskSegments(),
    demoSource.getDeliveries(),
    demoSource.getDistricts(),
    demoSource.getAlerts(),
    demoSource.getNotifications(),
    demoSource.getRecentMovements(),
  ]);

  const rainCandidates = await demoSource.getRouteCandidates({
    originLat: featured.originLat,
    originLng: featured.originLng,
    destLat: featured.destLat,
    destLng: featured.destLng,
    cargoPriority: featured.priority,
    deliveryId: featured.id,
  });

  const rainDetails = await Promise.all(
    rainDeliveries.deliveries.map(async (d) => ({
      deliveryId: d.id,
      detail: await demoSource.getDeliveryById(d.id),
    })),
  );
  const rainDistrictDetails = await Promise.all(
    rainDistricts.districts.map(async (d) => ({
      districtId: d.id,
      detail: await demoSource.getDistrictById(d.id),
    })),
  );

  const afterRain = {
    weather: rainWeather.weather,
    segments: rainSegments.segments,
    deliveries: rainDeliveries.deliveries,
    deliveryDetails: rainDetails,
    routeCandidates: rainCandidates.candidates,
    districts: rainDistricts.districts,
    districtDetails: rainDistrictDetails,
    alerts: rainAlerts.alerts,
    notifications: rainNotifications.notifications,
    movements: rainMovements.movements,
  };

  // Put the demo world back, so a later addition to this script cannot accidentally snapshot a
  // simulated baseline.
  await demoSource.resetDemo();

  // --- Per-segment physical characteristics -------------------------------
  //
  // The frontend never shows these, so the demo world does not carry them — but the contract's
  // `route_segments` table does, because they are the feature vector the Phase 5 model trains
  // on. They are derived here rather than typed by hand wherever the demo already implies them:
  //
  //   elevationM / terrainSlopeDeg   sampled from the corridor's real elevation profile at the
  //                                  segment's midpoint — the same profile Route Intelligence
  //                                  already draws, so the numbers on screen and the numbers in
  //                                  the database describe one mountain range
  //   historical counts              route A's recorded twelve-month totals, distributed across
  //                                  its segments in proportion to baseline risk, so they sum
  //                                  back to the route-level figures the UI shows
  //   roadCondition / roadType       from elevation band: alpine stretches are POOR rural road,
  //                                  the foothills FAIR state_road, the plains GOOD highway
  //
  // Everything here is synthetic and labelled as such in meta. Nothing pretends to be survey data.
  const profileA = ELEVATION_PROFILES.a;
  const totalRisk = baselineSegments.reduce((sum, seg) => sum + seg.lastRiskScore, 0);
  const routeAHistory = ROUTE_PROFILES.a.baseline.history;

  const cumulativeKm: number[] = [0];
  for (let i = 1; i < CORRIDOR_WAYPOINTS.length; i += 1) {
    const a = CORRIDOR_WAYPOINTS[i - 1];
    const b = CORRIDOR_WAYPOINTS[i];
    // LatLng is a [lat, lng] tuple, not an object — passing objects here silently yields NaN.
    cumulativeKm.push(cumulativeKm[i - 1] + haversineKm([a.lat, a.lng], [b.lat, b.lng]));
  }

  const sampleProfile = (km: number) => {
    let best = profileA[0];
    for (const point of profileA) {
      if (Math.abs(point.distanceKm - km) < Math.abs(best.distanceKm - km)) best = point;
    }
    return best;
  };

  const segmentPhysicals = baselineSegments.map((seg) => {
    const index = Number(seg.code.slice(-3)) - 1; // SEG-007 -> 6
    const midKm = (cumulativeKm[index] + cumulativeKm[index + 1]) / 2;
    const sample = sampleProfile(midKm);
    const share = totalRisk > 0 ? seg.lastRiskScore / totalRisk : 0;
    const alpine = sample.elevationM >= 2000;
    const foothill = sample.elevationM >= 500;

    return {
      id: seg.id,
      code: seg.code,
      distanceKm: Number((cumulativeKm[index + 1] - cumulativeKm[index]).toFixed(2)),
      elevationM: Math.round(sample.elevationM),
      terrainSlopeDeg: Number(sample.slopeDeg.toFixed(1)),
      roadCondition: alpine ? 'POOR' : foothill ? 'FAIR' : 'GOOD',
      roadType: alpine ? 'rural' : foothill ? 'state_road' : 'highway',
      // Rivers run through the valleys; the high passes are far from them.
      distanceToRiverKm: Number((alpine ? 8 + share * 20 : 1.5 + share * 6).toFixed(1)),
      historicalLandslides: Math.round(routeAHistory.landslides * share * baselineSegments.length),
      historicalFloods: Math.round(routeAHistory.floods * share * baselineSegments.length),
      previousClosureFrequencyPct: Number((share * 100).toFixed(1)),
      trafficLevel: alpine ? 0 : foothill ? 1 : 2,
    };
  });

  const world = {
    /** Provenance, written into the file so nobody has to guess where these numbers came from. */
    meta: {
      source: 'web/src/data/demo — the frozen frontend demo world, at baseline',
      generatedBy: 'api/scripts/export-demo-world.ts',
      demoNow: DEMO_NOW_ISO,
      seedVersion: 'phase-4a-baseline-1',
      demoSegmentId: DEMO_SEGMENT_ID,
      demoDeliveryId: DEMO_DELIVERY_ID,
      demoDistrictId: DEMO_DISTRICT_ID,
      demoPassword: DEMO_PASSWORD,
      synthetic: true,
      note: 'Synthetic demonstration data. Not derived from any real logistics operation.',
    },
    districtStates: DISTRICT_STATE,
    segmentPhysicals,
    routeSpecs: ROUTE_SPECS.map((r) => ({
      id: r.id,
      name: r.name,
      distanceKm: r.distanceKm,
      baselineEtaMinutes: r.baseline.etaMinutes,
      baselineRiskScore: r.baseline.riskScore,
    })),
    history: DELIVERY_SUCCESS_HISTORY,
    accounts,
    vehicles: baselineVehicles,
    officers: officers.officers,
    deliveries: baselineDeliveries,
    deliveryDetails: baselineDetails,
    routeCandidates: baselineCandidates,
    districts: baselineDistricts,
    districtDetails: baselineDistrictDetails,
    warehouses: warehouses.warehouses,
    segments: baselineSegments,
    incidents: baselineIncidents,
    alerts: baselineAlerts,
    weather: baselineWeather,
    movements: baselineMovements,
    notifications: baselineNotifications,
    analytics,
    afterRain,
  };

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, `${JSON.stringify(world, null, 2)}\n`, 'utf8');

  console.log(`world.json written: ${OUT}`);
  console.log(
    [
      `  districts ${world.districts.length}`,
      `segments ${world.segments.length}`,
      `deliveries ${world.deliveries.length}`,
      `routes ${world.routeCandidates.length}`,
      `vehicles ${world.vehicles.length}`,
      `officers ${world.officers.length}`,
      `incidents ${world.incidents.length}`,
      `alerts ${world.alerts.length}`,
      `movements ${world.movements.length}`,
      `notifications ${world.notifications.length}`,
      `warehouses ${world.warehouses.length}`,
      `history ${world.history.length}`,
    ].join(' · '),
  );
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
