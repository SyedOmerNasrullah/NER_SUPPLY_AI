/**
 * The public face of the ML layer — the only way the browser reaches a model.
 *
 *   GET  /api/ml/status                  mode, and (live mode only) whether the model answers
 *   POST /api/ml/route-risk/score        score every route and segment under current weather,
 *                                        persist to RiskPrediction          ADMIN, LOGISTICS
 *   GET  /api/ml/route-risk/comparison   frozen demo score vs latest ML score, per entity
 *   POST /api/ml/delivery-risk/score     score every live delivery from route risk, vehicle,
 *                                        weather and cargo; persist. `apply` also writes the
 *                                        predicted delay into the delivery's ETA, reprojects the
 *                                        destination's cover and re-runs the Decision Engine
 *                                                                          ADMIN, LOGISTICS
 *
 * Scoring does not change what the product displays. `Route.riskScore` and
 * `RouteSegment.lastRiskScore` stay on the frozen demo values; ML predictions go to the
 * append-only log with provenance ML_PREDICTION. Phase 5A measures the gap; it does not yet
 * act on it.
 */

import { Router } from 'express';
import { z } from 'zod';
import { env } from '../config/env';
import { orsConfigured } from '../services/ors';
import { smsConfigured } from '../services/twilio';
import { requireAuth, requireRole } from '../middleware/auth';
import { ApiError, asyncRoute } from '../middleware/errors';
import { MlError, mlHealthCheck } from '../services/mlClient';
import { compare, currentScenario, scoreCorridor, type Scenario } from '../services/routeRiskScoring';
import { previewDeliveryOnRoute, scoreDeliveries } from '../services/deliveryRiskScoring';

export const ml = Router();

ml.get(
  '/ml/status',
  asyncRoute(async (_req, res) => {
    // Whether the two outbound integrations are configured on THIS server. Booleans only: no
    // key, no account id, no number, nothing that could identify a credential. A status panel
    // needs to know that ORS and Twilio can be reached; it never needs to know with what.
    const services = { ors: orsConfigured(), twilio: smsConfigured() };

    if (env.ml.mode === 'demo') {
      res.json({ mode: 'demo', service: null, services });
      return;
    }
    try {
      const health = await mlHealthCheck();
      res.json({ mode: 'live', service: { reachable: true, ...health }, services });
    } catch (err) {
      // Status reports the outage rather than failing: "the model is down" is an answer.
      res.json({
        mode: 'live',
        service: { reachable: false, reason: err instanceof MlError ? err.kind : 'UNAVAILABLE' },
        services,
      });
    }
  }),
);

ml.post(
  '/ml/route-risk/score',
  requireAuth,
  requireRole('ADMIN', 'LOGISTICS_OFFICER'),
  asyncRoute(async (_req, res) => {
    const { scenario, scored, skipped } = await scoreCorridor();
    res.status(201).json({
      scenario,
      modelVersion: scored[0]?.prediction.modelVersion ?? null,
      scored: scored.map((s) => ({
        entityType: s.entityType,
        id: s.id,
        label: s.label,
        riskScore: s.prediction.riskScore,
        riskLevel: s.prediction.riskLevel,
        topFactors: s.prediction.topFactors,
        shapBaseValue: s.prediction.shapBaseValue,
        warnings: s.prediction.warnings,
      })),
      skipped,
    });
  }),
);

const comparisonQuery = z.object({
  scenario: z.enum(['baseline', 'heavy_rain']).optional(),
});

ml.get(
  '/ml/route-risk/comparison',
  asyncRoute(async (req, res) => {
    const parsed = comparisonQuery.safeParse(req.query);
    if (!parsed.success) throw ApiError.badRequest('scenario must be "baseline" or "heavy_rain".');
    const scenario: Scenario = parsed.data.scenario ?? (await currentScenario());
    const rows = await compare(scenario);
    res.json({
      scenario,
      reference: 'Frozen demo scores (web/src/data/demo, exported to world.json). Regression reference only.',
      rows,
    });
  }),
);

// ---------------------------------------------------------------------------
// Delivery risk (Phase 6B)
// ---------------------------------------------------------------------------

const deliveryScoreBody = z.object({
  /**
   * Write the predictions into the world — ETA, delay, failure probability — then reproject
   * supply cover and re-run the Decision Engine on the result.
   *
   * Off by default: the demonstration is a deterministic replay, and scoring must be observable
   * without silently rewriting the numbers the runbook depends on. `POST /api/demo/reset`
   * restores the baseline after an applied run.
   */
  apply: z.boolean().optional(),
});

ml.post(
  '/ml/delivery-risk/score',
  requireAuth,
  requireRole('ADMIN', 'LOGISTICS_OFFICER'),
  asyncRoute(async (req, res) => {
    const parsed = deliveryScoreBody.safeParse(req.body ?? {});
    if (!parsed.success) throw ApiError.badRequest('apply must be true or false.');

    const result = await scoreDeliveries({ apply: parsed.data.apply ?? false });
    res.status(201).json({
      scenario: result.scenario,
      modelVersion: result.modelVersion,
      applied: result.applied,
      scored: result.scored.map((s) => ({
        deliveryId: s.id,
        code: s.code,
        failureProbability: s.prediction.failureProbability,
        predictedDelayMinutes: s.prediction.predictedDelayMinutes,
        currentEta: s.currentEta,
        adjustedEta: s.adjustedEta,
        topFactors: s.prediction.topFactors,
        delayFactors: s.prediction.delayFactors,
        shapBaseValue: s.prediction.shapBaseValue,
        features: s.features,
        warnings: s.prediction.warnings,
        decision: s.decision ? { outcome: s.decision.outcome, confidence: s.decision.confidence } : undefined,
      })),
      skipped: result.skipped,
    });
  }),
);

const previewBody = z.object({
  deliveryId: z.string().trim().min(1),
  routeId: z.string().trim().min(1),
});

/**
 * What-if, not a commitment: score a delivery as if it were on another candidate route. Nothing
 * is written — neither the delivery nor the prediction log — because a question is not an
 * observation.
 */
ml.post(
  '/ml/delivery-risk/preview',
  requireAuth,
  requireRole('ADMIN', 'LOGISTICS_OFFICER'),
  asyncRoute(async (req, res) => {
    const parsed = previewBody.safeParse(req.body);
    if (!parsed.success) throw ApiError.badRequest('Send deliveryId and routeId.');

    const p = await previewDeliveryOnRoute(parsed.data.deliveryId, parsed.data.routeId);
    res.json({
      deliveryId: p.deliveryId,
      code: p.code,
      routeId: p.routeId,
      routeName: p.routeName,
      modelVersion: p.prediction.modelVersion,
      failureProbability: p.prediction.failureProbability,
      predictedDelayMinutes: p.prediction.predictedDelayMinutes,
      currentEta: p.currentEta,
      adjustedEta: p.adjustedEta,
      features: p.features,
      topFactors: p.prediction.topFactors,
      delayFactors: p.prediction.delayFactors,
      persisted: false,
    });
  }),
);
