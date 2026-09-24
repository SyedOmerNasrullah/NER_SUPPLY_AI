/**
 * The write API and authentication.
 *
 * Every route here is authorised server-side against PROJECT_CONTRACT.md section 4's capability
 * matrix. The frontend hides controls a role cannot use; this is what makes that true rather
 * than decorative.
 *
 *   create delivery    ADMIN, LOGISTICS_OFFICER
 *   report incident    ADMIN, LOGISTICS_OFFICER, FIELD_OFFICER
 *   reroute            ADMIN, LOGISTICS_OFFICER
 *   simulate rainfall  ADMIN, LOGISTICS_OFFICER
 *   reset demo         ADMIN
 *
 * Request bodies go through zod before they reach Prisma. Not for the type safety — TypeScript
 * already believes the body is whatever we say it is, which is exactly the problem — but so
 * that a malformed request is a 400 with a sentence rather than a 500 from the database.
 */

import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { ApiError, asyncRoute } from '../middleware/errors';
import { requireAuth, requireRole, type AuthedRequest } from '../middleware/auth';
import { signToken, verifyPassword } from '../services/auth';
import { resetDemo, rerouteDelivery, simulateRain } from '../services/demoState';
import { toDelivery, toIncident, toRecommendation, toUser } from '../services/mappers';
import { distanceToSegmentKm, matchCorridor, type SegmentMatch } from '../domain/geo';
import { classifyIncidentImage } from '../services/gemini';
import { cascadeFromIncident } from '../services/incidentCascade';

export const writes = Router();

/**
 * Incident submission is multipart — the frontend sends a FormData so a photograph can ride
 * along once vision classification exists. Held in memory and discarded: contract §6.8 says the
 * image is not persisted for the MVP, and storing a file nothing reads would be worse than not
 * accepting one. See delta D28.
 */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 1 },
});

/** Turns a zod failure into the contract's `{ error }` envelope with the first real problem. */
function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    const first = result.error.issues[0];
    const path = first.path.join('.');
    throw ApiError.badRequest(path ? `${path}: ${first.message}` : first.message);
  }
  return result.data;
}

// ---------------------------------------------------------------------------
// Authentication
// ---------------------------------------------------------------------------

const loginSchema = z.object({
  email: z.string().trim().min(1, 'Email is required').email('Enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
});

writes.post(
  '/auth/login',
  asyncRoute(async (req, res) => {
    const { email, password } = parse(loginSchema, req.body);

    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });

    // One message for "no such user" and "wrong password", and the password is still verified
    // against something when the user does not exist — otherwise the response time tells an
    // attacker which addresses are real.
    const ok = user
      ? await verifyPassword(password, user.passwordHash)
      : await verifyPassword(password, '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinv');

    if (!user || !ok) throw new ApiError(401, 'Invalid email or password.');

    // `toUser` has no `passwordHash` field to leak — the mapper decides the wire shape, so a
    // hash cannot escape by someone spreading a Prisma row into a response.
    res.json({ token: signToken({ sub: user.id, role: user.role }), user: toUser(user) });
  }),
);

writes.get(
  '/auth/me',
  requireAuth,
  asyncRoute(async (req: AuthedRequest, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.auth?.userId } });
    if (!user) throw new ApiError(401, 'Your session is not valid. Sign in again.');
    res.json({ user: toUser(user) });
  }),
);

// ---------------------------------------------------------------------------
// Deliveries
// ---------------------------------------------------------------------------

const createDeliverySchema = z.object({
  cargoType: z.string().trim().min(1, 'Cargo type is required'),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),
  originLat: z.number().min(-90).max(90),
  originLng: z.number().min(-180).max(180),
  destLat: z.number().min(-90).max(90),
  destLng: z.number().min(-180).max(180),
  requiredEta: z.string().datetime({ offset: true }).or(z.string().datetime()),
});

writes.post(
  '/deliveries',
  requireAuth,
  requireRole('ADMIN', 'LOGISTICS_OFFICER'),
  asyncRoute(async (req, res) => {
    const body = parse(createDeliverySchema, req.body);

    // Codes are sequential and readable, because operators say them out loud. Derived from the
    // current maximum rather than a counter, so it survives a restart.
    const last = await prisma.delivery.findFirst({
      where: { code: { startsWith: 'NE-' } },
      orderBy: { code: 'desc' },
      select: { code: true },
    });
    const nextNumber = Math.max(200, Number(last?.code.slice(3) ?? 0) + 1);

    // Nearest seeded district to the destination, so the delivery joins a supply line without
    // the client reverse-geocoding.
    const districts = await prisma.district.findMany();
    const nearest = districts.reduce((best, d) =>
      (d.lat - body.destLat) ** 2 + (d.lng - body.destLng) ** 2 <
      (best.lat - body.destLat) ** 2 + (best.lng - body.destLng) ** 2
        ? d
        : best,
    );

    const delivery = await prisma.delivery.create({
      data: {
        code: `NE-${nextNumber}`,
        cargoType: body.cargoType,
        priority: body.priority,
        originLat: body.originLat,
        originLng: body.originLng,
        destLat: body.destLat,
        destLng: body.destLng,
        destDistrictId: nearest.id,
        destName: nearest.name,
        requiredEta: new Date(body.requiredEta),
        // No route is assigned and no risk is predicted yet — routing and scoring are their own
        // steps. `currentEta` starts at the requirement rather than a guess nobody computed.
        currentEta: new Date(body.requiredEta),
        status: 'PENDING',
        // No `demoGenerated` flag: a delivery someone created is an operational record, and
        // reset must not delete it. Only incidents, alerts, recommendations and notifications
        // carry that flag, because only those are raised by the demonstration itself.
      },
    });

    res.status(201).json({ delivery: toDelivery(delivery) });
  }),
);

const rerouteSchema = z.object({
  routeId: z.string().trim().min(1, 'A route id is required'),
  /**
   * Recompute this delivery's risk, delay and ETA with the model after the move, instead of
   * inheriting the new route's deterministic figures.
   *
   * Off by default so the demonstration stays the deterministic replay the runbook describes;
   * on, the numbers after a reroute come from `delivery-risk-xgb-v1` scored against the road the
   * delivery is now actually on, and the destination's cover and the recommendation follow.
   * Requires ML_MODE=live.
   */
  rescore: z.boolean().optional(),
});

writes.post(
  '/deliveries/:id/reroute',
  requireAuth,
  requireRole('ADMIN', 'LOGISTICS_OFFICER'),
  asyncRoute(async (req, res) => {
    const { routeId, rescore } = parse(rerouteSchema, req.body);
    const { delivery, recommendation } = await rerouteDelivery(req.params.id, routeId);

    if (!rescore) {
      res.json({
        delivery: toDelivery(delivery),
        recommendation: recommendation ? toRecommendation(recommendation) : undefined,
      });
      return;
    }

    // The road changed, so everything downstream of the road is stale. Re-score from the model,
    // which also reprojects the destination's cover and re-runs the Decision Engine.
    const { rescoreDelivery } = await import('../services/deliveryRiskScoring');
    const scored = await rescoreDelivery(delivery.id);
    const [fresh, latestRecommendation] = await Promise.all([
      prisma.delivery.findUniqueOrThrow({ where: { id: delivery.id } }),
      prisma.aIRecommendation.findFirst({
        where: { targetType: 'DELIVERY', targetId: delivery.id },
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    res.json({
      delivery: toDelivery(fresh),
      recommendation: latestRecommendation ? toRecommendation(latestRecommendation) : undefined,
      rescored: scored
        ? {
            modelVersion: scored.prediction.modelVersion,
            failureProbability: scored.prediction.failureProbability,
            predictedDelayMinutes: scored.prediction.predictedDelayMinutes,
            currentEta: scored.currentEta,
            adjustedEta: scored.adjustedEta,
            topFactors: scored.prediction.topFactors,
            decision: scored.decision ? { outcome: scored.decision.outcome, confidence: scored.decision.confidence } : undefined,
          }
        : undefined,
    });
  }),
);

// ---------------------------------------------------------------------------
// Incidents
// ---------------------------------------------------------------------------

const incidentSchema = z.object({
  type: z.enum(['LANDSLIDE', 'FLOOD', 'DEBRIS', 'DAMAGED_ROAD', 'BLOCKED_ROAD', 'NORMAL']),
  severity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),
  description: z.string().trim().max(2000).optional(),
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  segmentId: z.string().trim().optional(),
});

writes.post(
  '/incidents',
  requireAuth,
  requireRole('ADMIN', 'LOGISTICS_OFFICER', 'FIELD_OFFICER'),
  upload.single('photo'),
  asyncRoute(async (req: AuthedRequest, res) => {
    // multipart puts everything in `req.body` as strings, which is why the numeric fields are
    // coerced in the schema rather than trusted.
    const body = parse(incidentSchema, req.body);

    // One query for every segment's geometry — fifteen rows, needed for the distance test —
    // and one for the candidate routes, for the corridor association below.
    const [segments, routes] = await Promise.all([
      prisma.routeSegment.findMany({
        select: {
          id: true, code: true, name: true, startLat: true, startLng: true, endLat: true, endLng: true,
          routeId: true, sequence: true, geometry: true,
        },
      }),
      prisma.route.findMany({ select: { id: true, name: true, geometry: true, riskScore: true, riskLevel: true } }),
    ]);

    // The reported latitude/longitude is authoritative. The segment is derived from it: the
    // nearest corridor segment by point-to-line distance, and only if it is within 5 km (see
    // domain/geo.ts). An explicit segmentId is honoured only if it names a real segment — it
    // used to be stored verbatim, so a mistyped id became a dangling reference.
    // Route first, then that route's own segments (delta D50). Asking for the nearest segment
    // anywhere would let a report on Route B attach to a Route A leg passing nearby and re-score
    // the wrong corridor.
    const corridor = matchCorridor(routes, segments, body.lat, body.lng);

    let match: SegmentMatch | null;
    if (body.segmentId) {
      const named = segments.find((s) => s.id === body.segmentId);
      if (!named) throw ApiError.badRequest('segmentId: no such road segment.');
      match = {
        segmentId: named.id,
        code: named.code,
        name: named.name,
        distanceKm: Number(
          distanceToSegmentKm(body.lat, body.lng, { lat: named.startLat, lng: named.startLng }, { lat: named.endLat, lng: named.endLng }).toFixed(2),
        ),
      };
    } else {
      match = corridor.segment;
    }

    // The corridor the point lies on. With route-owned segments this is normally the owner of
    // `match`; it is still reported separately, because a point can be on a road while no leg of
    // it is within the segment threshold (delta D49).
    const routeMatch = corridor.route;

    // Gemini Vision, when a photograph rode along and a key is configured. It is EVIDENCE: it
    // fills `cvDetectedClass` / `cvConfidence` / `cvEstimatedBlockage`, which sit beside the
    // reporter's own classification and never replace it. A failure returns null, and the report
    // is filed exactly as the officer typed it — image intelligence must never fail a report.
    const vision = req.file ? await classifyIncidentImage(req.file.buffer, req.file.mimetype) : null;

    const incident = await prisma.incident.create({
      data: {
        reporterId: req.auth?.userId ?? '',
        segmentId: match?.segmentId ?? null,
        // The reporter's classification, never overwritten by a model. Gemini Vision writes
        // `cvDetectedClass`, a separate column for exactly this reason — the two claims stay
        // distinguishable, and the operator can see when they disagree.
        type: body.type,
        severity: body.severity,
        description: body.description ?? null,
        // Delta D28: no image is persisted. The file is classified in memory and discarded, and
        // the field is null rather than a URL to something that does not exist.
        imageUrl: null,
        cvDetectedClass: vision?.incidentType ?? null,
        cvConfidence: vision?.confidence ?? null,
        cvEstimatedBlockage: vision?.estimatedBlockage ?? null,
        lat: body.lat,
        lng: body.lng,
        demoGenerated: true,
      },
    });

    // A HIGH or CRITICAL report on a road the system knows runs the cascade. Off every corridor
    // it runs nothing: a landslide 300 km away does not re-score this network, and pretending it
    // did would put a false cause at the top of the Incident Center's causal chain.
    const shouldCascade = body.severity === 'HIGH' || body.severity === 'CRITICAL';
    let cascadeTriggered = false;
    let rescored: Awaited<ReturnType<typeof cascadeFromIncident>> = null;

    if (shouldCascade && match) {
      // The real thing first (delta D51): degrade the reported segment, re-score every route from
      // its own segments, then deliveries, supply and the ladder. This changes the corridor the
      // incident is actually on — which the frozen replay could not do, because it only ever had
      // one story to tell.
      try {
        rescored = await cascadeFromIncident(
          match.segmentId,
          body.severity,
          // Other routes running over the same road: each degrades its own segment row.
          corridor.alsoAffected.map((a) => a.segment?.segmentId).filter((id): id is string => Boolean(id)),
        );
      } catch (err) {
        // Best effort: the incident is filed either way, and an ML outage must not fail a report.
        console.error(`[incident] ML cascade failed — ${err instanceof Error ? err.message : 'unknown'}`);
      }

      if (rescored) {
        cascadeTriggered = true;
      } else {
        // No live ML on this machine. The deterministic replay is the documented fallback.
        const affected = await simulateRain(match.segmentId);
        cascadeTriggered = affected.length > 0;
      }
    }

    res.status(201).json({
      incident: toIncident(incident, match?.name, routeMatch),
      cascadeTriggered,
      // Delta D49: the corridor the incident sits on, or null. An unmatched segment with a
      // matched route is a real and common state, not an error.
      routeMatch,
      // Delta D50: every other route whose own road passes within the threshold, with the segment
      // of theirs that covers it. Empty where the stretch belongs to one route alone.
      alsoAffected: corridor.alsoAffected,
      rescored,
      // Gemini Vision's reading of the photograph, when there was one. Evidence beside the
      // report, never a replacement for it.
      visionEvidence: vision
        ? {
            incidentType: vision.incidentType,
            confidence: vision.confidence,
            observedEvidence: vision.observedEvidence,
            recommendedSeverity: vision.recommendedSeverity,
            estimatedBlockage: vision.estimatedBlockage,
            model: vision.model,
            agreesWithReporter: vision.incidentType === body.type,
            provenance: 'LLM_VISION',
          }
        : undefined,
      // Delta D36: how the segment was associated, so the UI can say "matched to SEG-010,
      // 0.8 km away" — or, honestly, that no corridor segment was close enough.
      segmentMatch: match,
    });
  }),
);

// ---------------------------------------------------------------------------
// Demo controls
// ---------------------------------------------------------------------------

const simulateSchema = z.object({ segmentId: z.string().trim().min(1, 'A segment id is required') });

writes.post(
  '/demo/simulate-rain',
  requireAuth,
  requireRole('ADMIN', 'LOGISTICS_OFFICER'),
  asyncRoute(async (req, res) => {
    const { segmentId } = parse(simulateSchema, req.body);
    const segment = await prisma.routeSegment.findUnique({ where: { id: segmentId } });
    if (!segment) throw ApiError.notFound('Segment');

    const affectedSegmentIds = await simulateRain(segmentId);
    res.json({ updated: true, affectedSegmentIds });
  }),
);

writes.post(
  '/demo/reset',
  requireAuth,
  requireRole('ADMIN'),
  asyncRoute(async (_req, res) => {
    await resetDemo();
    res.json({ reset: true });
  }),
);
