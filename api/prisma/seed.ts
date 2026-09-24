/**
 * Deterministic seed — the demo world, in PostgreSQL.
 *
 * Every value comes from `prisma/seed-data/world.json`, which is a snapshot of what the frozen
 * frontend's demo adapter returns at baseline (see `scripts/export-demo-world.ts`). Nothing is
 * invented here and nothing is randomised: run it twice and the database is identical, run it
 * against a live database and it converges rather than duplicating.
 *
 * Idempotency is by `upsert` on stable ids, not by truncating first. That matters: a destructive
 * seed is one mistyped connection string away from wiping something real, and this seed will be
 * run against the same database the demo runs on.
 *
 * The data is SYNTHETIC. It models a real corridor — Guwahati to Tawang along NH-15/NH-13 — with
 * real place names and plausible geography, but no figure in it came from an actual logistics
 * operation. `DemoState.seedVersion` records which snapshot produced the current rows.
 *
 *   npm run seed
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaClient, type Prisma } from '@prisma/client';
import world from './seed-data/world.json';
import { env } from '../src/config/env';
import { hashPassword } from '../src/services/auth';

const prisma = new PrismaClient();

/** The seed's own instant. Fixed, so re-running does not churn `createdAt` columns. */
const SEEDED_AT = new Date(world.meta.demoNow);

/**
 * Passwords, as of Phase 4B.
 *
 * Two kinds of row, and the difference matters:
 *
 *   - the four demonstration accounts get a real bcrypt hash of `env.demoPassword`, so they can
 *     actually sign in;
 *   - the remaining eleven officers are staff records — addressable for notifications, with no
 *     way in. They get a marker that is not a bcrypt hash of anything, so `bcrypt.compare`
 *     cannot match it under any input. Not a password nobody knows: no password at all.
 *
 * Plaintext is never stored, and no hash is ever returned by the API.
 */
const NO_LOGIN = 'NO_LOGIN_ACCOUNT';

/**
 * The JSON import widens every string literal to `string`, so the enum-typed columns need
 * narrowing. One helper rather than a cast per field: the values were produced by the frontend
 * from the same unions Prisma declares, so this is restating a fact the type system lost on the
 * way through JSON, not asserting something new.
 */
const asEnum = <T extends string>(value: string): T => value as T;

/**
 * Read an optional field off a snapshot record.
 *
 * TypeScript infers the JSON's array element types as a union of exactly the shapes present, so
 * a field that only some records carry — `nearestPlace`, a delivery's `recommendation` — is not
 * on the union at all. That is the type system describing this particular file rather than the
 * contract, and the contract says these are optional. Reading them through here says so once.
 */
const pick = <T>(record: object, key: string): T | undefined =>
  (record as Record<string, unknown>)[key] as T | undefined;

/**
 * Remove seed-owned rows the current snapshot no longer produces.
 *
 * Upserts alone make the seed convergent for rows it writes, not idempotent for the table: a row
 * written by an earlier snapshot under a different id just sits there forever. Not hypothetical
 * — an id-derivation bug in this file left orphaned inventory and snapshot rows behind, and the
 * row counts were the only thing that noticed.
 *
 * Scoped deliberately: only the three tables whose ids this seed derives, and only ids outside
 * the set it just wrote. Tables holding rows a running system creates — incidents filed by
 * users, alerts raised by the cascade — are never touched.
 */
async function prune(
  table: 'inventoryItem' | 'weatherSnapshot' | 'riskPrediction',
  keptIds: string[],
): Promise<void> {
  // Switched rather than indexed: `prisma[table].deleteMany` unions three delegate types and
  // TypeScript cannot find one call signature that satisfies all of them.
  const where = { id: { notIn: keptIds } };
  const { count } =
    table === 'inventoryItem'
      ? await prisma.inventoryItem.deleteMany({ where })
      : table === 'weatherSnapshot'
        ? await prisma.weatherSnapshot.deleteMany({ where })
        : // RiskPrediction is shared: the seed writes one baseline row per segment, but the ML
          // service appends ML_PREDICTION rows and the demo cascade appends its own. Pruning by
          // "not an id the seed just wrote" deleted all of those too — a re-seed in Phase 5A.2
          // wiped 108 prediction rows, including the whole ML regression log. Only rows the seed
          // itself produces (its model version) are ever candidates for pruning.
          await prisma.riskPrediction.deleteMany({
            where: { ...where, modelVersion: 'seed-baseline-no-model' },
          });

  if (count > 0) console.log(`  pruned ${count} stale ${table} row(s) from an earlier snapshot`);
}

type Counts = Record<string, number>;
const counts: Counts = {};
const tally = (key: string, n: number) => {
  counts[key] = n;
};

// ---------------------------------------------------------------------------
// Users — officers and demo accounts are one table
// ---------------------------------------------------------------------------

/**
 * An officer IS a user with role FIELD_OFFICER; there is no second officers table, so
 * `GET /api/field-officers` is a filter rather than a competing store.
 *
 * The demo's `field@ner.local` account and its first officer are the same person (Tenzin
 * Norbu), so they are one row — the officer's id wins, because that is the id Field Operations
 * renders. The other three demo accounts are separate people with no officer record.
 */
async function seedUsers(): Promise<void> {
  const accounts = world.accounts.accounts;
  const fieldAccount = accounts.find((a) => a.role === 'FIELD_OFFICER');

  // Hashed once and reused: bcrypt is deliberately slow, and hashing the same string four
  // separate times would quadruple the seed's runtime for no benefit. Each account still gets
  // its own salt, because `hash` generates one per call — reusing the digest across the four
  // demo accounts is safe only because they genuinely share one password by design.
  const demoHash = await hashPassword(env.demoPassword);

  const officerRows: Prisma.UserCreateInput[] = world.officers.map((officer, i) => {
    const isLoginAccount = Boolean(fieldAccount && officer.name === fieldAccount.name && i === 0);
    return {
      id: officer.id,
      name: officer.name,
      email: isLoginAccount && fieldAccount ? fieldAccount.email : `officer.${officer.id.slice(-4)}@ner.invalid`,
      passwordHash: isLoginAccount ? demoHash : NO_LOGIN,
      role: 'FIELD_OFFICER' as const,
      phone: officer.phone ?? null,
      districtId: officer.districtId ?? null,
      status: officer.status,
      createdAt: SEEDED_AT,
    };
  });

  const accountRows: Prisma.UserCreateInput[] = accounts
    .filter((a) => a.role !== 'FIELD_OFFICER')
    .map((account, i) => ({
      id: `a0000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
      name: account.name,
      email: account.email,
      passwordHash: demoHash,
      role: asEnum<Prisma.UserCreateInput['role']>(account.role),
      status: 'ACTIVE',
      createdAt: SEEDED_AT,
    }));

  for (const row of [...officerRows, ...accountRows]) {
    const { id, ...rest } = row;
    await prisma.user.upsert({ where: { id }, create: row, update: rest });
  }
  tally('User', officerRows.length + accountRows.length);
}

// ---------------------------------------------------------------------------
// Geography and supply
// ---------------------------------------------------------------------------

async function seedDistricts(): Promise<void> {
  const states = world.districtStates as Record<string, string>;
  for (const d of world.districts) {
    const data = {
      name: d.name,
      state: states[d.id] ?? 'Assam',
      lat: d.lat,
      lng: d.lng,
      createdAt: SEEDED_AT,
    };
    await prisma.district.upsert({ where: { id: d.id }, create: { id: d.id, ...data }, update: data });
  }
  tally('District', world.districts.length);
}

async function seedWarehouses(): Promise<void> {
  for (const w of world.warehouses) {
    // The demo's warehouses carry no district link; nearest district by straight-line distance
    // is a deterministic, defensible stand-in until the contract adds the column.
    const nearest = world.districts.reduce((best, d) =>
      (d.lat - w.lat) ** 2 + (d.lng - w.lng) ** 2 < (best.lat - w.lat) ** 2 + (best.lng - w.lng) ** 2
        ? d
        : best,
    );
    const data = { name: w.name, districtId: nearest.id, lat: w.lat, lng: w.lng };
    await prisma.warehouse.upsert({ where: { id: w.id }, create: { id: w.id, ...data }, update: data });
  }
  tally('Warehouse', world.warehouses.length);
}

/**
 * One row per district x category. Ids are derived from the district id and the category name
 * so the same district always produces the same three rows — `upsert` needs a stable key, and
 * inventing uuids here would make the seed create 45 new rows on every run.
 */
async function seedInventory(): Promise<void> {
  const ids: string[] = [];
  let n = 0;
  for (const district of world.districts) {
    for (const [category, line] of Object.entries(district.stock)) {
      // Suffixed, not spliced. An earlier version replaced the id's last three characters —
      // which are exactly the ones that differ between districts — so all fifteen collapsed
      // onto three rows. Appending keeps the parent id intact and visible.
      const id = `${district.id}:${category}`;
      const data = {
        ownerType: 'DISTRICT',
        ownerId: district.id,
        itemType: category,
        currentStock: line.currentStock,
        dailyConsumption: line.dailyConsumption,
        predictedStockoutHours: line.predictedStockoutHours,
      };
      await prisma.inventoryItem.upsert({ where: { id }, create: { id, ...data }, update: data });
      ids.push(id);
      n += 1;
    }
  }
  await prune('inventoryItem', ids);
  tally('InventoryItem', n);
}

// ---------------------------------------------------------------------------
// Corridor
// ---------------------------------------------------------------------------

async function seedSegments(): Promise<void> {
  const physicals = new Map(world.segmentPhysicals.map((p) => [p.id, p]));

  for (const seg of world.segments) {
    const phys = physicals.get(seg.id);
    if (!phys) throw new Error(`No physical characteristics exported for ${seg.code}`);

    const data = {
      code: seg.code,
      name: seg.name,
      startLat: seg.startLat,
      startLng: seg.startLng,
      endLat: seg.endLat,
      endLng: seg.endLng,
      terrainSlopeDeg: phys.terrainSlopeDeg,
      elevationM: phys.elevationM,
      roadCondition: phys.roadCondition as 'GOOD' | 'FAIR' | 'POOR',
      roadType: phys.roadType,
      distanceToRiverKm: phys.distanceToRiverKm,
      historicalLandslides: phys.historicalLandslides,
      historicalFloods: phys.historicalFloods,
      previousClosureFrequencyPct: phys.previousClosureFrequencyPct,
      trafficLevel: phys.trafficLevel,
      currentStatus: asEnum<'OPEN' | 'PARTIAL' | 'BLOCKED'>(seg.currentStatus),
      lastRiskScore: seg.lastRiskScore,
      lastRiskFactors: seg.lastRiskFactors as Prisma.InputJsonValue,
    };
    await prisma.routeSegment.upsert({ where: { id: seg.id }, create: { id: seg.id, ...data }, update: data });
  }
  tally('RouteSegment', world.segments.length);
}

async function seedRoutes(): Promise<void> {
  const featured = world.deliveries.find((d) => d.id === world.meta.demoDeliveryId);
  if (!featured) throw new Error('Featured delivery missing from the export');

  for (const c of world.routeCandidates) {
    // Which corridor segments this candidate travels. Taken from the export, which computed it
    // with `routeSegmentIds` in web/src/domain/geo.ts — the rule the demo adapter uses at
    // runtime — so both data sources name the same segments for the same route. The older
    // 0.12-degree box (~13 km) counted every segment for all three routes once B and C were
    // offsets of A; it is kept only as a fallback for a snapshot without the field.
    const exported = pick<string[]>(c, 'segmentIds');
    const segmentIds =
      exported ??
      world.segments
        .filter((seg) => {
          const midLat = (seg.startLat + seg.endLat) / 2;
          const midLng = (seg.startLng + seg.endLng) / 2;
          return c.geometry.some(
            ([lat, lng]) => Math.abs(lat - midLat) < 0.12 && Math.abs(lng - midLng) < 0.12,
          );
        })
        .map((seg) => seg.id);

    const data = {
      name: c.name,
      originLat: featured.originLat,
      originLng: featured.originLng,
      destLat: featured.destLat,
      destLng: featured.destLng,
      distanceKm: c.distanceKm,
      etaMinutes: c.etaMinutes,
      geometry: c.geometry as Prisma.InputJsonValue,
      segmentIds,
      riskScore: c.riskScore,
      riskLevel: asEnum<'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'>(c.riskLevel),
      isRecommended: c.isRecommended,
      topFactors: (c.topFactors ?? null) as Prisma.InputJsonValue,
      explanationText: c.explanationText ?? null,
      profile: (c.profile ?? null) as Prisma.InputJsonValue,
      elevationProfile: (c.elevationProfile ?? null) as Prisma.InputJsonValue,
      createdAt: SEEDED_AT,
    };
    await prisma.route.upsert({ where: { id: c.id }, create: { id: c.id, ...data }, update: data });
  }
  tally('Route', world.routeCandidates.length);
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

async function seedVehicles(): Promise<void> {
  for (const v of world.vehicles) {
    const delivery = world.deliveries.find((d) => d.id === v.currentDeliveryId);
    const data = {
      code: v.code,
      driverName: v.driverName,
      driverPhone: null,
      currentLat: v.currentLat,
      currentLng: v.currentLng,
      speedKmh: v.speedKmh,
      expectedSpeedKmh: v.expectedSpeedKmh,
      status: v.status,
      nearestPlace: pick<string>(v, 'nearestPlace') ?? null,
      currentDeliveryId: v.currentDeliveryId ?? null,
      currentRouteId: delivery?.assignedRouteId ?? null,
    };
    await prisma.vehicle.upsert({ where: { id: v.id }, create: { id: v.id, ...data }, update: data });
  }
  tally('Vehicle', world.vehicles.length);
}

async function seedDeliveries(): Promise<void> {
  for (const d of world.deliveries) {
    const data = {
      code: d.code,
      cargoType: d.cargoType,
      priority: asEnum<'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'>(d.priority),
      originLat: d.originLat,
      originLng: d.originLng,
      destLat: d.destLat,
      destLng: d.destLng,
      originName: d.originName ?? null,
      destName: d.destName ?? null,
      cargoUnits: d.cargoUnits ?? null,
      destDistrictId: d.destDistrictId ?? null,
      assignedVehicleId: d.assignedVehicleId ?? null,
      assignedRouteId: d.assignedRouteId ?? null,
      requiredEta: new Date(d.requiredEta),
      currentEta: new Date(d.currentEta),
      failureProbability: d.failureProbability ?? null,
      expectedDelayMinutes: d.expectedDelayMinutes ?? null,
      status: asEnum<'PENDING' | 'IN_TRANSIT' | 'AT_RISK' | 'DELIVERED' | 'FAILED'>(d.status),
      createdAt: SEEDED_AT,
    };
    await prisma.delivery.upsert({ where: { id: d.id }, create: { id: d.id, ...data }, update: data });
  }
  tally('Delivery', world.deliveries.length);
}

async function seedIncidents(): Promise<void> {
  // Reporters are the seeded field officers, assigned round-robin so every incident has a real
  // foreign key rather than a placeholder.
  const officers = world.officers;
  let i = 0;
  for (const inc of world.incidents) {
    const reporter = officers[i % officers.length];
    i += 1;
    const data = {
      reporterId: reporter.id,
      segmentId: inc.segmentId ?? null,
      type: asEnum<'LANDSLIDE' | 'FLOOD' | 'DEBRIS' | 'DAMAGED_ROAD' | 'BLOCKED_ROAD' | 'NORMAL'>(inc.type),
      severity: asEnum<'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'>(inc.severity),
      description: inc.description ?? null,
      imageUrl: inc.imageUrl ?? null,
      cvDetectedClass: inc.cvDetectedClass ?? null,
      cvConfidence: inc.cvConfidence ?? null,
      cvEstimatedBlockage: inc.cvEstimatedBlockage
        ? asEnum<'NONE' | 'PARTIAL' | 'SEVERE'>(inc.cvEstimatedBlockage)
        : null,
      lat: inc.lat,
      lng: inc.lng,
      createdAt: new Date(inc.createdAt),
    };
    await prisma.incident.upsert({ where: { id: inc.id }, create: { id: inc.id, ...data }, update: data });
  }
  tally('Incident', world.incidents.length);
}

async function seedAlerts(): Promise<void> {
  for (const a of world.alerts) {
    const data = {
      severity: asEnum<'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'>(a.severity),
      title: a.title,
      message: a.message,
      relatedType: a.relatedType ?? null,
      relatedId: a.relatedId ?? null,
      notifiedViaTwilio: a.notifiedViaTwilio,
      createdAt: new Date(a.createdAt),
    };
    await prisma.alert.upsert({ where: { id: a.id }, create: { id: a.id, ...data }, update: data });
  }
  tally('Alert', world.alerts.length);
}

interface RecommendationRow {
  id: string;
  type: string;
  targetType: string;
  targetId: string;
  recommendationText: string;
  confidence: number;
}

async function seedRecommendations(): Promise<void> {
  // Baseline has no outstanding recommendation for most deliveries; whatever the demo's decision
  // engine produced at rest is what goes in.
  const rows = [
    ...world.deliveryDetails.map((d) => pick<RecommendationRow>(d.detail, 'recommendation')),
    ...world.districtDetails.map((d) => pick<RecommendationRow>(d.detail, 'recommendation')),
  ].filter((r): r is NonNullable<typeof r> => Boolean(r));

  const seen = new Set<string>();
  let n = 0;
  for (const r of rows) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    const data = {
      type: asEnum<'REROUTE' | 'PRE_POSITION' | 'ALERT' | 'NONE'>(r.type),
      targetType: r.targetType,
      targetId: r.targetId,
      recommendationText: r.recommendationText,
      confidence: r.confidence,
      status: 'PENDING',
      createdAt: SEEDED_AT,
    };
    await prisma.aIRecommendation.upsert({ where: { id: r.id }, create: { id: r.id, ...data }, update: data });
    n += 1;
  }
  tally('AIRecommendation', n);
}

async function seedMovements(): Promise<void> {
  for (const m of world.movements) {
    const vehicle = world.vehicles.find((v) => v.code === m.vehicleCode);
    const delivery = world.deliveries.find((d) => d.code === m.deliveryCode);
    const data = {
      vehicleId: vehicle?.id ?? m.id,
      vehicleCode: m.vehicleCode,
      deliveryId: delivery?.id ?? null,
      deliveryCode: m.deliveryCode,
      place: m.place,
      status: m.status,
      delayMinutes: m.delayMinutes ?? null,
      lat: vehicle?.currentLat ?? 0,
      lng: vehicle?.currentLng ?? 0,
      createdAt: SEEDED_AT,
    };
    await prisma.vehicleMovement.upsert({ where: { id: m.id }, create: { id: m.id, ...data }, update: data });
  }
  tally('VehicleMovement', world.movements.length);
}

async function seedNotifications(): Promise<void> {
  for (const n of world.notifications) {
    const recipient = world.officers.find((o) => o.name === n.recipientName);
    const data = {
      alertId: n.alertId,
      alertTitle: n.alertTitle,
      channel: n.channel,
      status: n.status,
      recipientId: recipient?.id ?? null,
      recipientName: n.recipientName,
      recipientRole: asEnum<Prisma.UserCreateInput['role']>(n.recipientRole),
      recipientPhone: n.recipientPhone ?? null,
      failureReason: pick<string>(n, 'failureReason') ?? null,
      relatedId: pick<string>(n, 'relatedId') ?? null,
      sentAt: new Date(n.sentAt),
    };
    await prisma.notification.upsert({ where: { id: n.id }, create: { id: n.id, ...data }, update: data });
  }
  tally('Notification', world.notifications.length);
}

/** Weather is per segment; the baseline snapshot is applied uniformly across the corridor. */
async function seedWeather(): Promise<void> {
  const ids: string[] = [];
  const w = world.weather;
  for (const seg of world.segments) {
    const id = `${seg.id}:weather`;
    const data = {
      segmentId: seg.id,
      rainfall1h: w.rainfall1hMm,
      rainfall3h: Number((w.rainfall1hMm * 2.4).toFixed(1)),
      rainfall6h: Number((w.rainfall1hMm * 4.1).toFixed(1)),
      rainfall24h: w.rainfall24hMm,
      windSpeedKmh: w.windKmh,
      visibility: w.visibilityKm >= 8 ? 'good' : w.visibilityKm >= 3 ? 'moderate' : 'low',
      isSimulated: w.simulated,
      createdAt: SEEDED_AT,
    };
    await prisma.weatherSnapshot.upsert({ where: { id }, create: { id, ...data }, update: data });
    ids.push(id);
  }
  await prune('weatherSnapshot', ids);
  tally('WeatherSnapshot', world.segments.length);
}

async function seedRiskPredictions(): Promise<void> {
  const ids: string[] = [];
  // One baseline prediction per segment, so Analytics has a log to aggregate from day one.
  // Marked with the stand-in model version: no model has run, and the row says so.
  for (const seg of world.segments) {
    const id = `${seg.id}:baseline-risk`;
    const data = {
      segmentId: seg.id,
      riskScore: seg.lastRiskScore,
      riskProbability: seg.lastRiskScore / 100,
      riskLevel:
        seg.lastRiskScore >= 85
          ? 'CRITICAL'
          : seg.lastRiskScore >= 70
            ? 'HIGH'
            : seg.lastRiskScore >= 40
              ? 'MEDIUM'
              : 'LOW',
      predictedDisruption: seg.lastRiskScore >= 70,
      topFactors: (seg.lastRiskFactors ?? []) as Prisma.InputJsonValue,
      explanationText: `Baseline corridor assessment for ${seg.code}.`,
      modelVersion: 'seed-baseline-no-model',
      createdAt: SEEDED_AT,
    } as const;
    await prisma.riskPrediction.upsert({ where: { id }, create: { id, ...data }, update: data });
    ids.push(id);
  }
  await prune('riskPrediction', ids);
  tally('RiskPrediction', world.segments.length);
}

async function seedDailyPerformance(): Promise<void> {
  for (const point of world.history) {
    const date = new Date(point.date);
    date.setUTCHours(0, 0, 0, 0);
    const data = {
      successRatePct: point.successRatePct,
      avgDelayMin: point.avgDelayMin,
      // Recorded totals behind each day's rate, kept consistent with it.
      deliveriesTotal: 40,
      deliveriesLate: Math.round((40 * (100 - point.successRatePct)) / 100),
    };
    await prisma.dailyPerformance.upsert({ where: { date }, create: { date, ...data }, update: data });
  }
  tally('DailyPerformance', world.history.length);
}

async function seedDemoState(): Promise<void> {
  await prisma.demoState.upsert({
    where: { id: 'singleton' },
    create: { id: 'singleton', simulated: false, seededAt: SEEDED_AT, seedVersion: world.meta.seedVersion },
    update: { simulated: false, seededAt: SEEDED_AT, seedVersion: world.meta.seedVersion },
  });
  tally('DemoState', 1);
}

// ---------------------------------------------------------------------------

/**
 * Apply `seed-data/ors-routes.json` if it is present: route geometry, road distance, and one
 * owned segment per town-to-town leg.
 *
 * Absent artifact is not an error. A clone that has never generated routes seeds the schematic
 * world and says so; nothing downstream requires the geometry to exist.
 */
async function applyRouteArtifact(): Promise<void> {
  const path = resolve(__dirname, 'seed-data/ors-routes.json');
  if (!existsSync(path)) {
    console.log('\nNo ORS route artifact — routes keep their schematic geometry.');
    return;
  }
  const artifact = JSON.parse(readFileSync(path, 'utf-8')) as {
    generatedAt: string;
    provenance: string;
    routes: {
      key: string;
      label: string;
      distanceKm: number;
      durationMin: number;
      geometry: [number, number][];
      segments: {
        code: string;
        name: string;
        sequence: number;
        startLat: number;
        startLng: number;
        endLat: number;
        endLng: number;
        distanceKm: number;
        geometry: [number, number][];
        elevationM: number;
        terrainSlopeDeg: number;
        hazards?: {
          roadCondition: 'GOOD' | 'FAIR' | 'POOR';
          roadType: string;
          historicalLandslides: number;
          historicalFloods: number;
          previousClosureFrequencyPct: number;
          trafficLevel: number;
          distanceToRiverKm: number;
        };
      }[];
    }[];
  };

  const routes = await prisma.route.findMany();
  let segmentCount = 0;

  for (const generated of artifact.routes) {
    const route = routes.find((r) => r.name.startsWith(generated.label));
    if (!route) continue;

    await prisma.route.update({
      where: { id: route.id },
      data: {
        geometry: generated.geometry as unknown as Prisma.InputJsonValue,
        distanceKm: generated.distanceKm,
        orsDistanceKm: generated.distanceKm,
        orsDurationMin: generated.durationMin,
        geometryProvenance: artifact.provenance,
        geometryUpdatedAt: new Date(artifact.generatedAt),
      },
    });

    const owned: string[] = [];
    for (const segment of generated.segments) {
      const common = {
        name: segment.name,
        startLat: segment.startLat,
        startLng: segment.startLng,
        endLat: segment.endLat,
        endLng: segment.endLng,
        elevationM: segment.elevationM,
        terrainSlopeDeg: segment.terrainSlopeDeg,
        routeId: route.id,
        sequence: segment.sequence,
        geometry: segment.geometry as unknown as Prisma.InputJsonValue,
        distanceKm: segment.distanceKm,
        geometryProvenance: artifact.provenance,
      };
      const row = segment.hazards
        ? await prisma.routeSegment.upsert({
            where: { code: segment.code },
            update: common,
            create: { code: segment.code, ...common, ...segment.hazards, currentStatus: 'OPEN', lastRiskScore: null },
          })
        : // Route A's fifteen already exist from world.json with their own hazard history and
          // risk state; they gain geometry and ownership only.
          await prisma.routeSegment.update({ where: { code: segment.code }, data: common });
      owned.push(row.id);
      segmentCount += 1;
    }
    await prisma.route.update({ where: { id: route.id }, data: { segmentIds: owned } });
  }


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

  console.log(
    `\nRoute geometry applied (${artifact.provenance}, generated ${artifact.generatedAt.slice(0, 10)}): ` +
      `${artifact.routes.length} routes, ${segmentCount} owned segments.`,
  );
}

async function main(): Promise<void> {
  console.log(`Seeding — ${world.meta.seedVersion} (${world.meta.note})`);

  // Order matters only for readability; every write is an upsert on a stable id and the
  // schema uses application-managed references rather than Prisma relations, so there is no
  // foreign-key ordering constraint to satisfy.
  await seedUsers();
  await seedDistricts();
  await seedWarehouses();
  await seedInventory();
  await seedSegments();
  await seedRoutes();
  await seedVehicles();
  await seedDeliveries();
  await seedIncidents();
  await seedAlerts();
  await seedRecommendations();
  await seedMovements();
  await seedNotifications();
  await seedWeather();
  await seedRiskPredictions();
  await seedDailyPerformance();
  await seedDemoState();

  // Counted from the database, not from the loops above. A tally of intended writes reported 45
  // inventory rows while three existed — the loop ran 45 times and 42 of those upserted the same
  // colliding id. Only a real count catches that.
  const actual: Record<string, number> = {
    User: await prisma.user.count(),
    District: await prisma.district.count(),
    Warehouse: await prisma.warehouse.count(),
    InventoryItem: await prisma.inventoryItem.count(),
    RouteSegment: await prisma.routeSegment.count(),
    Route: await prisma.route.count(),
    Vehicle: await prisma.vehicle.count(),
    Delivery: await prisma.delivery.count(),
    Incident: await prisma.incident.count(),
    Alert: await prisma.alert.count(),
    AIRecommendation: await prisma.aIRecommendation.count(),
    VehicleMovement: await prisma.vehicleMovement.count(),
    Notification: await prisma.notification.count(),
    WeatherSnapshot: await prisma.weatherSnapshot.count(),
    RiskPrediction: await prisma.riskPrediction.count(),
    DailyPerformance: await prisma.dailyPerformance.count(),
    DemoState: await prisma.demoState.count(),
  };

  // Route geometry and route-owned segments (Phase 6B). The committed artifact is applied
  // here so a freshly seeded database has real road geometry without anyone needing an ORS
  // key — the generator is what calls ORS, and it runs when someone decides roads change.
  await applyRouteArtifact();

  console.log('\nSeeded (rows counted in the database):');
  for (const [table, n] of Object.entries(actual)) {
    const wrote = counts[table];
    const flag = wrote !== undefined && wrote !== n ? `   (wrote ${wrote})` : '';
    console.log(`  ${table.padEnd(18)} ${String(n).padStart(3)}${flag}`);
  }
  console.log(`\nTotal rows: ${Object.values(actual).reduce((a, b) => a + b, 0)}`);
}

main()
  .catch((err: unknown) => {
    console.error('Seed failed:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
