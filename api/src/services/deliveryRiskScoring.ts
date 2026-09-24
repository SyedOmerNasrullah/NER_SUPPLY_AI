/**
 * Delivery risk, scored by the model and carried through the rest of the cascade.
 *
 *   score()          predict for every live delivery, persist the predictions, report them
 *   score({apply})   the same, and then let the predictions move the world:
 *
 *                      predicted delay -> Delivery.expectedDelayMinutes and currentEta
 *                      failure probability -> Delivery.failureProbability
 *                      the new ETA -> the destination's medicine cover (existing projection)
 *                      the new numbers -> the Decision Engine, unchanged
 *
 * Why `apply` is a choice rather than the default:
 *
 * The demonstration is a deterministic replay — `simulateRain` writes the frozen cascade, and the
 * runbook's numbers depend on it. A model that rewrote those rows on every call would make the
 * demo non-reproducible, and the phase brief is explicit that the demo harness stays
 * deterministic while the ML system is free to disagree with it. So scoring is read-only by
 * default and observable in the prediction log; applying is an explicit act that says "use the
 * model's answer as the world's answer". `POST /api/demo/reset` restores the baseline either way.
 *
 * Nothing here computes a risk number itself. Every figure comes from the ML service, and the
 * arithmetic that remains is the one honest piece the brief asks for:
 *
 *     adjusted ETA = current ETA + predicted delay
 */

import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { ApiError } from '../middleware/errors';
import { riskLevelForScore } from '../domain/riskThresholds';
import type { Decision } from './decision';
import { deliveryFeatures } from './deliveryRiskFeatures';
import { predictDeliveryRisk, type DeliveryRiskFeatures, type DeliveryRiskPrediction } from './mlClient';
import { currentScenario, type Scenario } from './routeRiskScoring';

/** The statuses a delivery has to be in for a prediction about its arrival to mean anything. */
const LIVE_STATUSES = ['PENDING', 'IN_TRANSIT', 'AT_RISK'] as const;

export interface ScoredDelivery {
  id: string;
  code: string;
  features: DeliveryRiskFeatures;
  prediction: DeliveryRiskPrediction;
  /** The ETA held in the database when this prediction was made. */
  currentEta: string;
  /** currentEta + predictedDelayMinutes. */
  adjustedEta: string;
  /** Present only when `apply` was set: what the decision ladder said afterwards. */
  decision?: Decision;
}

export interface SkippedDelivery {
  id: string;
  code: string;
  reason: string;
}

export interface DeliveryScoringResult {
  scenario: Scenario;
  modelVersion: string | null;
  applied: boolean;
  scored: ScoredDelivery[];
  skipped: SkippedDelivery[];
}

/** One sentence, from the model's own top factor. Never a language model's sentence. */
function explanation(prediction: DeliveryRiskPrediction): string {
  const top = prediction.topFactors[0];
  return (
    `Predicted ${Math.round(prediction.failureProbability * 100)}% chance of missing the required window, ` +
    `${prediction.predictedDelayMinutes} min late. Strongest factor: ${top.factor}.`
  );
}

export async function scoreDeliveries(
  { apply = false, at = new Date(), onlyDeliveryIds }: { apply?: boolean; at?: Date; onlyDeliveryIds?: string[] } = {},
): Promise<DeliveryScoringResult> {
  const [scenario, deliveries, vehicles, routes, snapshots] = await Promise.all([
    currentScenario(),
    prisma.delivery.findMany({
      where: {
        status: { in: [...LIVE_STATUSES] },
        ...(onlyDeliveryIds ? { id: { in: onlyDeliveryIds } } : {}),
      },
      orderBy: { code: 'asc' },
    }),
    prisma.vehicle.findMany(),
    prisma.route.findMany(),
    prisma.weatherSnapshot.findMany({ orderBy: { createdAt: 'desc' } }),
  ]);

  // One snapshot for the corridor: the simulate control writes the same weather to every
  // segment, and a delivery spans the whole corridor rather than sitting on one segment.
  const weather = snapshots[0];

  const scored: ScoredDelivery[] = [];
  const skipped: SkippedDelivery[] = [];

  // Sequential, like route scoring: a handful of calls against a local service, and a burst
  // buys nothing but a harder-to-read log when one fails.
  for (const delivery of deliveries) {
    const result = deliveryFeatures(
      delivery,
      vehicles.find((v) => v.currentDeliveryId === delivery.id || v.id === delivery.assignedVehicleId),
      routes.find((r) => r.id === delivery.assignedRouteId),
      weather,
      at,
    );
    if (!result.ok) {
      skipped.push({ id: delivery.id, code: delivery.code, reason: result.reason });
      continue;
    }

    const prediction = await predictDeliveryRisk(result.features, delivery.code);
    const adjusted = new Date(delivery.currentEta.getTime() + prediction.predictedDelayMinutes * 60_000);
    scored.push({
      id: delivery.id,
      code: delivery.code,
      features: result.features,
      prediction,
      currentEta: delivery.currentEta.toISOString(),
      adjustedEta: adjusted.toISOString(),
    });
  }

  // The append-only prediction log, one row per scored delivery. `riskScore` carries the failure
  // probability as an integer percentage so every row on this table stays on one 0-100 scale;
  // the minutes have their own column.
  if (scored.length) {
    await prisma.riskPrediction.createMany({
      data: scored.map((s) => ({
        entityType: 'DELIVERY',
        deliveryId: s.id,
        riskScore: Math.round(s.prediction.failureProbability * 100),
        riskProbability: s.prediction.failureProbability,
        riskLevel: riskLevelForScore(Math.round(s.prediction.failureProbability * 100)),
        predictedDisruption: s.prediction.predictedDelayMinutes > 0,
        predictedDelayMinutes: s.prediction.predictedDelayMinutes,
        topFactors: s.prediction.topFactors as unknown as Prisma.InputJsonValue,
        explanationText: explanation(s.prediction),
        modelVersion: s.prediction.modelVersion,
        provenance: 'ML_PREDICTION',
        scenario,
        featureValues: s.features as unknown as Prisma.InputJsonValue,
        shapBaseValue: s.prediction.shapBaseValue,
      })),
    });
  }

  if (apply && scored.length) {
    await applyPredictions(scored);
  }

  return {
    scenario,
    modelVersion: scored[0]?.prediction.modelVersion ?? null,
    applied: apply && scored.length > 0,
    scored,
    skipped,
  };
}

/**
 * Let the predictions move the world: ETA, delay, failure probability, the supply projection
 * downstream of them, and the Decision Engine on top.
 *
 * The engine's rules are untouched — it is handed ML numbers instead of replayed ones and
 * evaluates exactly the same ladder.
 */
async function applyPredictions(scored: ScoredDelivery[]): Promise<void> {
  const { reprojectMedicineCover, reconcileDeliveryDecision } = await import('./demoState');

  for (const s of scored) {
    await prisma.delivery.update({
      where: { id: s.id },
      data: {
        expectedDelayMinutes: s.prediction.predictedDelayMinutes,
        failureProbability: s.prediction.failureProbability,
        currentEta: new Date(s.adjustedEta),
        // A delivery the model expects to miss its window is at risk, and saying so is the
        // whole point of predicting it. Delivered and failed deliveries are never scored.
        status: s.prediction.failureProbability >= 0.5 ? 'AT_RISK' : undefined,
      },
    });
  }

  // Supply next: the destination's cover depends on when the medicine actually arrives.
  const deliveryIds = scored.map((s) => s.id);
  const rows = await prisma.delivery.findMany({
    where: { id: { in: deliveryIds } },
    select: { id: true, destDistrictId: true },
  });
  for (const districtId of new Set(rows.map((r) => r.destDistrictId).filter(Boolean) as string[])) {
    await reprojectMedicineCover(prisma, districtId);
  }

  // Then the ladder, on the numbers that now exist.
  for (const s of scored) {
    s.decision = await reconcileDeliveryDecision(prisma, s.id);
  }
}


/**
 * What-if: score one delivery as if it were on a given candidate route.
 *
 * This is what makes a reroute defensible before anyone commits to it — "on Route B this
 * delivery is 12% likely to miss its window instead of 98%" — and it is the same model, on the
 * same seven features, with only `routeRiskScore` swapped for the candidate's own.
 *
 * Deliberately NOT persisted. A preview is a question, not an observation, and a prediction log
 * full of hypotheticals stops being a record of what the system believed about the world.
 */
export async function previewDeliveryOnRoute(
  deliveryCodeOrId: string,
  routeId: string,
  at: Date = new Date(),
): Promise<{
  deliveryId: string;
  code: string;
  routeId: string;
  routeName: string;
  features: DeliveryRiskFeatures;
  prediction: DeliveryRiskPrediction;
  currentEta: string;
  adjustedEta: string;
}> {
  const delivery = await prisma.delivery.findFirst({
    where: { OR: [{ id: deliveryCodeOrId }, { code: deliveryCodeOrId }] },
  });
  if (!delivery) throw ApiError.notFound('Delivery');

  const route = await prisma.route.findUnique({ where: { id: routeId } });
  if (!route) throw ApiError.notFound('Route');

  const [vehicles, snapshots] = await Promise.all([
    prisma.vehicle.findMany({
      where: { OR: [{ currentDeliveryId: delivery.id }, { id: delivery.assignedVehicleId ?? '' }] },
    }),
    prisma.weatherSnapshot.findMany({ orderBy: { createdAt: 'desc' }, take: 1 }),
  ]);

  const result = deliveryFeatures(delivery, vehicles[0], route, snapshots[0], at);
  if (!result.ok) throw new ApiError(422, result.reason);

  const prediction = await predictDeliveryRisk(result.features, `${delivery.code} on ${route.name.split('—')[0].trim()}`);
  return {
    deliveryId: delivery.id,
    code: delivery.code,
    routeId: route.id,
    routeName: route.name.split('—')[0].trim(),
    features: result.features,
    prediction,
    currentEta: delivery.currentEta.toISOString(),
    adjustedEta: new Date(delivery.currentEta.getTime() + prediction.predictedDelayMinutes * 60_000).toISOString(),
  };
}

/**
 * Re-score ONE delivery and apply the result — the path a reroute takes.
 *
 * After a delivery moves to a different road, every number downstream of the road is stale: the
 * risk it inherits, the delay that follows from it, the ETA, the cover at the destination and
 * the recommendation on top. This recomputes them in that order, from the model.
 */
export async function rescoreDelivery(deliveryId: string, at: Date = new Date()): Promise<ScoredDelivery | undefined> {
  const result = await scoreDeliveries({ apply: true, at, onlyDeliveryIds: [deliveryId] });
  return result.scored[0];
}
