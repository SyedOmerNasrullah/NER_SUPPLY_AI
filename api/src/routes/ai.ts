/**
 * Natural-language explanation of numbers this system already computed.
 *
 *   POST /api/ai/explain   { kind: "ROUTE" | "DELIVERY" | "DECISION", targetId }
 *
 * The request names a thing, not a number. Express looks the figures up — the latest stored
 * prediction, the delivery's own row, the decision ladder's inputs — and hands them to Gemini,
 * which is asked for prose and nothing else. The response returns the figures alongside the
 * sentence, so a reader can check the words against the data, and carries the provenance of each:
 * the numbers are ML_PREDICTION or DETERMINISTIC_DEMO, the sentence is LLM_EXPLANATION or the
 * deterministic template.
 *
 * Authenticated: an open endpoint that forwards text to a paid model is an open relay.
 */

import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth } from '../middleware/auth';
import { ApiError, asyncRoute } from '../middleware/errors';
import { riskLevelForScore } from '../domain/riskThresholds';
import { decide } from '../services/decision';
import { explainRisk, type ExplainFactor, type ExplainInput } from '../services/gemini';

export const ai = Router();

const body = z.object({
  kind: z.enum(['ROUTE', 'DELIVERY', 'DECISION']),
  targetId: z.string().trim().min(1).max(64),
});

type StoredFactor = { factor: string; contributionPct: number; direction?: string };

const asFactors = (value: unknown): ExplainFactor[] =>
  Array.isArray(value)
    ? (value as StoredFactor[]).slice(0, 5).map((f) => ({
        factor: f.factor,
        contributionPct: f.contributionPct,
        direction: f.direction,
      }))
    : [];

/** The latest ML prediction for an entity, if one exists for the world as it stands now. */
async function latestPrediction(entityType: 'ROUTE' | 'DELIVERY', id: string) {
  const { currentScenario } = await import('../services/routeRiskScoring');
  const scenario = await currentScenario();
  return prisma.riskPrediction.findFirst({
    where: {
      entityType,
      provenance: 'ML_PREDICTION',
      scenario,
      ...(entityType === 'ROUTE' ? { routeId: id } : { deliveryId: id }),
    },
    orderBy: { createdAt: 'desc' },
  });
}

ai.post(
  '/ai/explain',
  requireAuth,
  asyncRoute(async (req, res) => {
    const parsed = body.safeParse(req.body);
    if (!parsed.success) throw ApiError.badRequest('Send kind (ROUTE, DELIVERY or DECISION) and targetId.');
    const { kind, targetId } = parsed.data;

    let input: ExplainInput;
    let numbersFrom: 'ML_PREDICTION' | 'DETERMINISTIC_DEMO' = 'DETERMINISTIC_DEMO';
    let modelVersion: string | null = null;

    if (kind === 'ROUTE') {
      const route = await prisma.route.findUnique({ where: { id: targetId } });
      if (!route) throw ApiError.notFound('Route');

      // The figures are the ones the product DISPLAYS — the route row — never a different
      // number from the prediction log. A sentence reading "risk 49" beside a panel showing 41
      // is worse than no sentence: the reader cannot tell which to believe. The stored ML score
      // is used only to decide the provenance label, by checking whether it IS the displayed
      // number, and its factors are preferred when it is.
      const ml = await latestPrediction('ROUTE', route.id);
      const mlIsDisplayed = ml?.riskScore === route.riskScore;
      if (mlIsDisplayed) {
        numbersFrom = 'ML_PREDICTION';
        modelVersion = ml!.modelVersion;
      }
      input = {
        kind,
        subject: route.name.split('—')[0].trim(),
        figures: {
          riskScore: route.riskScore,
          riskLevel: riskLevelForScore(route.riskScore),
          distanceKm: Math.round(route.distanceKm),
          etaMinutes: route.etaMinutes,
        },
        factors: asFactors(mlIsDisplayed ? ml!.topFactors : route.topFactors),
      };
    } else if (kind === 'DELIVERY') {
      const delivery = await prisma.delivery.findFirst({
        where: { OR: [{ id: targetId }, { code: targetId }] },
      });
      if (!delivery) throw ApiError.notFound('Delivery');
      // Same rule as routes: explain what the delivery row says, because that is what the page
      // renders. After an applied ML run those numbers ARE the model's, and the label follows
      // the numbers rather than the other way round.
      const ml = await latestPrediction('DELIVERY', delivery.id);
      const mlIsDisplayed =
        ml !== null &&
        ml.predictedDelayMinutes === (delivery.expectedDelayMinutes ?? null) &&
        Math.round(ml.riskProbability * 1000) === Math.round((delivery.failureProbability ?? 0) * 1000);
      if (mlIsDisplayed) {
        numbersFrom = 'ML_PREDICTION';
        modelVersion = ml!.modelVersion;
      }
      const route = delivery.assignedRouteId
        ? await prisma.route.findUnique({ where: { id: delivery.assignedRouteId } })
        : null;
      input = {
        kind,
        subject: delivery.code,
        figures: {
          failureProbabilityPct: Math.round((delivery.failureProbability ?? 0) * 100),
          predictedDelayMinutes: delivery.expectedDelayMinutes ?? 0,
          // Only when there is one. Sending 0 for an unassigned delivery produced "despite a
          // route risk score of 0" — a model narrating an absent value as a measured one.
          ...(route ? { routeRiskScore: route.riskScore } : {}),
          cargoPriority: delivery.priority,
        },
        factors: asFactors(mlIsDisplayed ? ml!.topFactors : undefined),
      };
    } else {
      // DECISION: re-evaluate the ladder for a delivery and explain the rule that matched.
      const delivery = await prisma.delivery.findFirst({
        where: { OR: [{ id: targetId }, { code: targetId }] },
      });
      if (!delivery) throw ApiError.notFound('Delivery');
      const [routes, cover] = await Promise.all([
        prisma.route.findMany(),
        delivery.destDistrictId
          ? prisma.inventoryItem.findFirst({
              where: { ownerType: 'DISTRICT', ownerId: delivery.destDistrictId, itemType: 'medicine' },
            })
          : null,
      ]);
      const assigned = routes.find((r) => r.id === delivery.assignedRouteId);
      const alternatives = routes.filter((r) => r.id !== assigned?.id).map((r) => r.riskScore);
      const decision = decide({
        assignedRouteRisk: assigned?.riskScore,
        candidateRisks: routes.filter((r) => r.id !== assigned?.id).map((r) => r.riskScore),
        adjustedStockoutHours: cover?.predictedStockoutHours,
        failureProbability: delivery.failureProbability,
      });
      const matched = decision.branches.find((b) => b.matched);
      input = {
        kind,
        subject: `${decision.outcome} for ${delivery.code}`,
        figures: {
          // Absent stays absent here too: a delivery with no route assigned, or a district with
          // no projection, must not appear as a zero the model can reason from.
          ...(assigned ? { assignedRouteRisk: assigned.riskScore } : {}),
          ...(alternatives.length ? { bestAlternativeRisk: Math.min(...alternatives) } : {}),
          ...(cover?.predictedStockoutHours != null
            ? { destinationCoverHours: cover.predictedStockoutHours }
            : {}),
          ...(delivery.failureProbability != null
            ? { failureProbabilityPct: Math.round(delivery.failureProbability * 100) }
            : {}),
          ruleMatched: matched?.condition ?? 'none of the rules matched',
        },
      };
    }

    const explanation = await explainRisk(input);
    res.json({
      kind,
      subject: input.subject,
      figures: input.figures,
      factors: input.factors ?? [],
      explanation,
      provenance: {
        // The two halves, never conflated: where the numbers came from, and who wrote the words.
        figures: numbersFrom,
        modelVersion,
        explanation: explanation.source,
      },
    });
  }),
);
