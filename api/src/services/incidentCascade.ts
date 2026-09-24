/**
 * What a reported incident does to the road it happened on (Phase 6B, delta D51).
 *
 * Before route-owned segments existed, every HIGH or CRITICAL report replayed the frozen storm —
 * the same segment, the same route, the same delivery, whatever had actually been reported and
 * wherever it was. That was defensible while one corridor was the only thing the database could
 * describe. It is not defensible now: a landslide on Route B must change Route B.
 *
 * The chain here is short and each step is a fact rather than a lookup:
 *
 *   1. the reported segment's road state degrades. A blocked road is BLOCKED and its condition is
 *      POOR; a partial blockage is PARTIAL. This is the one thing the incident itself asserts.
 *   2. every route is re-scored by `route-risk-xgb-v1` from its OWN segments. The owning route's
 *      features changed, so its score moves; the others' features did not, so theirs do not.
 *   3. deliveries are re-scored by `delivery-risk-xgb-v1` and applied, carrying the new route risk
 *      into failure probability, delay, adjusted ETA, the destination's cover and the Decision
 *      Engine.
 *
 * Nothing here invents a risk number. Step 1 sets a road condition, which is a description of the
 * road; steps 2 and 3 are the models. The Decision Engine is untouched.
 *
 * `POST /api/demo/reset` restores segment state, so a demonstration can run this repeatedly.
 */

import type { Severity } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { env } from '../config/env';
import { scoreCorridor } from './routeRiskScoring';
import { scoreDeliveries } from './deliveryRiskScoring';

export interface CascadeResult {
  /** The segment whose road state the incident changed. */
  segmentId: string;
  segmentCode: string;
  /** Segments on other routes covering the same road, degraded with it. */
  alsoDegradedCodes: string[];
  routeId: string | null;
  routeName: string | null;
  statusBefore: string;
  statusAfter: string;
  /** Route scores after re-scoring, by route name. */
  routeRisk: { name: string; riskScore: number; modelVersion: string }[];
  deliveries: { code: string; failureProbability: number; predictedDelayMinutes: number; decision?: string }[];
  modelVersions: string[];
}

/** What a report of this severity says about the road. */
function roadStateFor(severity: Severity): { status: 'PARTIAL' | 'BLOCKED'; condition: 'FAIR' | 'POOR' } {
  return severity === 'CRITICAL'
    ? { status: 'BLOCKED', condition: 'POOR' }
    : { status: 'PARTIAL', condition: 'POOR' };
}

/**
 * Run the cascade for an incident that matched a segment.
 *
 * Returns null when live ML is not configured — the caller then falls back to the deterministic
 * replay, which is what a demo-only machine has always done.
 */
export async function cascadeFromIncident(
  segmentId: string,
  severity: Severity,
  /**
   * Segments on OTHER routes covering the same stretch of road. A landslide on tarmac two routes
   * share blocks it for both, and each route owns its own row for that road.
   */
  alsoAffectedSegmentIds: string[] = [],
): Promise<CascadeResult | null> {
  if (env.ml.mode !== 'live') return null;

  const segment = await prisma.routeSegment.findUnique({ where: { id: segmentId } });
  if (!segment) return null;

  const route = segment.routeId
    ? await prisma.route.findUnique({ where: { id: segment.routeId } })
    : null;

  // 1 — the road itself. Only this segment, and only the fields an incident actually reports on.
  const { status, condition } = roadStateFor(severity);
  const statusBefore = segment.currentStatus;
  const degraded = [segment.id, ...alsoAffectedSegmentIds.filter((id) => id !== segment.id)];
  await prisma.routeSegment.updateMany({
    where: { id: { in: degraded } },
    data: { currentStatus: status, roadCondition: condition },
  });

  // 2 — every route re-scored from its own segments. Routes that do not own this segment are
  // scored too, from unchanged features, which is what proves they did not move.
  const corridor = await scoreCorridor();

  // 3 — deliveries, applied: the model's numbers become the world's, and the ladder runs on them.
  //
  // Only deliveries ON the affected roads. A landslide on Route B changes nothing for a delivery
  // driving Route A, and re-scoring it here would put its new numbers directly beneath this
  // incident in the causal chain — a claim of cause that is not true. Deliveries elsewhere are
  // re-scored by the scoring endpoint, where nothing implies this report moved them.
  const affectedRouteIds = [
    ...new Set(
      (await prisma.routeSegment.findMany({
        where: { id: { in: degraded } },
        select: { routeId: true },
      }))
        .map((s) => s.routeId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const onAffectedRoutes = await prisma.delivery.findMany({
    where: { assignedRouteId: { in: affectedRouteIds }, status: { in: ['PENDING', 'IN_TRANSIT', 'AT_RISK'] } },
    select: { id: true },
  });
  const deliveries = onAffectedRoutes.length
    ? await scoreDeliveries({ apply: true, onlyDeliveryIds: onAffectedRoutes.map((d) => d.id) })
    : { scored: [] as Awaited<ReturnType<typeof scoreDeliveries>>['scored'] };

  const routeRisk = corridor.scored
    .filter((s) => s.entityType === 'ROUTE')
    .map((s) => ({
      name: s.label,
      riskScore: s.prediction.riskScore,
      modelVersion: s.prediction.modelVersion,
    }));

  const alsoDegraded = await prisma.routeSegment.findMany({
    where: { id: { in: degraded.slice(1) } },
    select: { code: true },
  });

  return {
    segmentId: segment.id,
    segmentCode: segment.code,
    alsoDegradedCodes: alsoDegraded.map((s) => s.code),
    routeId: route?.id ?? null,
    routeName: route ? route.name.split('—')[0].trim() : null,
    statusBefore,
    statusAfter: status,
    routeRisk,
    deliveries: deliveries.scored.map((s) => ({
      code: s.code,
      failureProbability: s.prediction.failureProbability,
      predictedDelayMinutes: s.prediction.predictedDelayMinutes,
      decision: s.decision?.outcome,
    })),
    modelVersions: [
      ...new Set([
        ...corridor.scored.map((s) => s.prediction.modelVersion),
        ...deliveries.scored.map((s) => s.prediction.modelVersion),
      ]),
    ],
  };
}
