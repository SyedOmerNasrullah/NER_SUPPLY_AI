/**
 * The read API.
 *
 * One route per `DataSource` method in `web/src/data/source.ts`, at the paths
 * `web/src/data/http/index.ts` already calls. That adapter was written in Phase 2 and has been
 * compiling unused ever since; it is the specification here, not a client to be accommodated.
 *
 * Phase 4A is reads only. The six write endpoints are registered but answer 501 with a sentence
 * saying so — an honest "not built yet" that the frontend surfaces as a real error message,
 * rather than a 404 that looks like a typo or, worse, a fabricated success.
 */

import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { latestRoutePredictions } from '../services/routeRiskScoring';
import { ApiError, asyncRoute } from '../middleware/errors';
import {
  toAlert,
  toDelivery,
  toDistrict,
  toFieldOfficer,
  toIncident,
  toMovement,
  toNotification,
  toRecommendation,
  toRouteCandidate,
  toSegment,
  toVehicle,
  toWarehouse,
} from '../services/mappers';
import { buildSummary } from '../services/summary';
import { compareRoutes } from '../services/routeComparison';
import { nearestRoute } from '../domain/geo';
import { buildProjections } from '../services/projections';

export const api = Router();

// --- Fleet & field ---------------------------------------------------------

api.get(
  '/vehicles',
  asyncRoute(async (_req, res) => {
    const vehicles = await prisma.vehicle.findMany({ orderBy: { code: 'asc' } });
    res.json({ vehicles: vehicles.map(toVehicle) });
  }),
);

api.get(
  '/field-officers',
  asyncRoute(async (_req, res) => {
    // An officer is a user with role FIELD_OFFICER — there is no second store to disagree.
    const officers = await prisma.user.findMany({
      where: { role: 'FIELD_OFFICER' },
      orderBy: { name: 'asc' },
    });
    res.json({ officers: officers.map(toFieldOfficer) });
  }),
);

// --- Deliveries ------------------------------------------------------------

api.get(
  '/deliveries',
  asyncRoute(async (_req, res) => {
    const deliveries = await prisma.delivery.findMany({ orderBy: { code: 'asc' } });
    res.json({ deliveries: deliveries.map(toDelivery) });
  }),
);

api.get(
  '/deliveries/:id',
  asyncRoute(async (req, res) => {
    // The frontend links by code (`/deliveries/NE-102`) and fetches by id. Accepting either
    // means one endpoint instead of two that could drift.
    const key = req.params.id;
    const delivery = await prisma.delivery.findFirst({
      where: { OR: [{ id: key }, { code: key }] },
    });
    if (!delivery) throw ApiError.notFound('Delivery');

    const recommendation = await prisma.aIRecommendation.findFirst({
      where: { targetType: 'DELIVERY', targetId: delivery.id, status: 'PENDING' },
      orderBy: { createdAt: 'desc' },
    });

    res.json({
      delivery: toDelivery(delivery),
      recommendation: recommendation ? toRecommendation(recommendation) : undefined,
      // `decision` (delta D21) is absent until the decision engine runs server-side. The UI
      // already renders the recommendation without its trace.
    });
  }),
);

// --- Routes ----------------------------------------------------------------

api.post(
  '/routes/candidates',
  asyncRoute(async (_req, res) => {
    // Phase 4A returns the seeded corridor candidates. Generating routes for arbitrary
    // coordinates is OpenRouteService's job and belongs to a later phase — so this deliberately
    // ignores the request body rather than pretending to have routed anything.
    //
    // Phase 6E: the score and its factors now come from the newest ML prediction for each route
    // when one exists. Every candidate carries `riskSource`, so a seeded fallback is visible as
    // a seeded fallback rather than passing for model output.
    const routes = await prisma.route.findMany({ orderBy: { name: 'asc' } });
    const predictions = await latestRoutePredictions(routes.map((r) => r.id));
    const candidates = routes.map((r) => toRouteCandidate(r, predictions.get(r.id)));

    // `isRecommended` is the seeded "BEST" flag, and it means one thing: the lowest-risk
    // candidate. Once the scores on the row are the model's, the seeded flag can contradict
    // them outright — Route A carrying BEST at risk 59 while Route B sits at 44. So when every
    // candidate has been scored by the model, the flag follows the scores it is labelling.
    //
    // This is not the decision engine and does not touch it. REROUTE still requires risk >= 70
    // AND a candidate at least 15 points safer; that ladder is untouched and still lives in
    // `decision.ts`. This only decides which candidate wears the chip.
    if (candidates.length > 0 && candidates.every((c) => c.riskSource === 'ML_PREDICTION')) {
      const best = candidates.reduce((a, b) => (b.riskScore < a.riskScore ? b : a));
      for (const c of candidates) c.isRecommended = c.id === best.id;
    }

    res.json({ candidates });
  }),
);

// --- Supply ----------------------------------------------------------------

api.get(
  '/districts',
  asyncRoute(async (_req, res) => {
    const [districts, items] = await Promise.all([
      prisma.district.findMany({ orderBy: { name: 'asc' } }),
      prisma.inventoryItem.findMany({ where: { ownerType: 'DISTRICT' } }),
    ]);
    res.json({
      districts: districts.map((d) =>
        toDistrict(
          d,
          items.filter((i) => i.ownerId === d.id),
        ),
      ),
    });
  }),
);

api.get(
  '/districts/:id',
  asyncRoute(async (req, res) => {
    const district = await prisma.district.findUnique({ where: { id: req.params.id } });
    if (!district) throw ApiError.notFound('District');

    const [items, recommendation] = await Promise.all([
      prisma.inventoryItem.findMany({ where: { ownerType: 'DISTRICT', ownerId: district.id } }),
      prisma.aIRecommendation.findFirst({
        where: { targetType: 'DISTRICT', targetId: district.id, status: 'PENDING' },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    res.json({
      district: toDistrict(district, items),
      recommendation: recommendation ? toRecommendation(recommendation) : undefined,
      projections: await buildProjections(district.id, items),
    });
  }),
);

api.get(
  '/warehouses',
  asyncRoute(async (_req, res) => {
    const warehouses = await prisma.warehouse.findMany({ orderBy: { name: 'asc' } });
    res.json({ warehouses: warehouses.map(toWarehouse) });
  }),
);

// --- Risk ------------------------------------------------------------------

api.get(
  '/risk/segments',
  asyncRoute(async (_req, res) => {
    // Sorted here, not on the client: the contract says the wire order is what renders, so a
    // client-side re-sort would hide a server-side ordering bug.
    const segments = await prisma.routeSegment.findMany({
      orderBy: [{ lastRiskScore: 'desc' }, { code: 'asc' }],
    });
    res.json({ segments: segments.map(toSegment) });
  }),
);

// --- Incidents -------------------------------------------------------------

api.get(
  '/incidents',
  asyncRoute(async (_req, res) => {
    // Three queries, not three per incident: the routes are fetched once and the corridor
    // association is computed in memory.
    const [incidents, segments, routes] = await Promise.all([
      prisma.incident.findMany({ orderBy: { createdAt: 'desc' } }),
      prisma.routeSegment.findMany({ select: { id: true, name: true } }),
      prisma.route.findMany({ select: { id: true, name: true, geometry: true, riskScore: true, riskLevel: true } }),
    ]);
    const names = new Map(segments.map((s) => [s.id, s.name]));
    res.json({
      incidents: incidents.map((i) =>
        toIncident(
          i,
          i.segmentId ? names.get(i.segmentId) : undefined,
          // Delta D49. Computed on read rather than stored: a route's geometry can change (ORS
          // will change all three), and a column written once would then describe a road that no
          // longer runs there.
          nearestRoute(routes, i.lat, i.lng),
        ),
      ),
    });
  }),
);

// --- Alerts ----------------------------------------------------------------

const SEVERITY_RANK: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

api.get(
  '/alerts',
  asyncRoute(async (_req, res) => {
    const alerts = await prisma.alert.findMany({ orderBy: { createdAt: 'desc' } });
    // Severity order is not lexical, so it cannot be expressed as a Prisma `orderBy` over the
    // enum without relying on its declaration order. Sorting here makes the rule explicit.
    alerts.sort(
      (a, b) =>
        (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9) ||
        b.createdAt.getTime() - a.createdAt.getTime(),
    );
    res.json({ alerts: alerts.map(toAlert) });
  }),
);

// --- Conditions ------------------------------------------------------------

api.get(
  '/weather',
  asyncRoute(async (_req, res) => {
    const [snapshot, state] = await Promise.all([
      prisma.weatherSnapshot.findFirst({ orderBy: { createdAt: 'desc' } }),
      prisma.demoState.findUnique({ where: { id: 'singleton' } }),
    ]);
    if (!snapshot) throw ApiError.notFound('Weather snapshot');

    res.json({
      weather: {
        label: snapshot.rainfall24h >= 60 ? 'Heavy Rainfall' : 'Moderate Rainfall',
        rainfall1hMm: snapshot.rainfall1h,
        rainfall24hMm: snapshot.rainfall24h,
        windKmh: snapshot.windSpeedKmh,
        visibilityKm:
          snapshot.visibility === 'good' ? 10 : snapshot.visibility === 'moderate' ? 5 : 1.5,
        simulated: state?.simulated ?? snapshot.isSimulated,
      },
    });
  }),
);

/**
 * Structured route comparison (Phase 6C): every candidate's own risk, the delta against the
 * route a delivery is on, and which candidate clears the Decision Engine's 15-point margin.
 *
 *   ?deliveryId=NE-102   compare against that delivery's assigned route
 *   ?preferMl=true       use the latest stored ML score per route where one exists
 */
api.get(
  '/routes/comparison',
  asyncRoute(async (req, res) => {
    const deliveryCodeOrId = typeof req.query.deliveryId === 'string' ? req.query.deliveryId : undefined;
    const preferMl = req.query.preferMl === 'true';
    res.json({ comparison: await compareRoutes({ deliveryCodeOrId, preferMl }) });
  }),
);

// --- Command Center --------------------------------------------------------

api.get(
  '/summary',
  asyncRoute(async (_req, res) => {
    res.json({ summary: await buildSummary() });
  }),
);

api.get(
  '/movements',
  asyncRoute(async (_req, res) => {
    const movements = await prisma.vehicleMovement.findMany({
      orderBy: { createdAt: 'desc' },
      take: 25,
    });
    res.json({ movements: movements.map(toMovement) });
  }),
);

api.get(
  '/notifications',
  asyncRoute(async (_req, res) => {
    const notifications = await prisma.notification.findMany({
      orderBy: { sentAt: 'desc' },
      take: 50,
    });
    res.json({ notifications: notifications.map(toNotification) });
  }),
);

// --- Analytics -------------------------------------------------------------

api.get(
  '/analytics/summary',
  asyncRoute(async (_req, res) => {
    const [history, segments, stockouts, districts] = await Promise.all([
      prisma.dailyPerformance.findMany({ orderBy: { date: 'asc' } }),
      prisma.routeSegment.findMany({ orderBy: { lastRiskScore: 'desc' }, take: 5 }),
      prisma.stockoutEvent.groupBy({ by: ['districtId'], _count: { _all: true } }),
      prisma.district.findMany({ select: { id: true, name: true } }),
    ]);

    const names = new Map(districts.map((d) => [d.id, d.name]));
    const latest = history[history.length - 1];

    res.json({
      deliverySuccessRatePct: latest?.successRatePct ?? 0,
      avgDelayMinutes: latest?.avgDelayMin ?? 0,
      topRiskySegments: segments.map((s) => ({
        segmentId: s.id,
        name: s.name,
        avgRisk: s.lastRiskScore ?? 0,
      })),
      districtShortageEvents: stockouts.map((row) => ({
        districtId: row.districtId,
        name: names.get(row.districtId) ?? 'Unknown district',
        count: row._count._all,
      })),
      history: history.length
        ? history.map((h) => ({
            date: h.date.toISOString(),
            successRatePct: h.successRatePct,
            avgDelayMin: h.avgDelayMin,
          }))
        : undefined,
    });
  }),
);

// --- Writes -----------------------------------------------------------------
//
// Registered in `routes/writes.ts`, which owns authentication and the capability matrix. They
// are mounted alongside this router in `app.ts` rather than here, so that reads and writes stay
// visibly separate: everything in this file is safe to call without a token, and nothing in
// that file is.
