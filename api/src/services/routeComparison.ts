/**
 * Route comparison — the layer between "every candidate has a risk score" and "the Decision
 * Engine matched a rule".
 *
 * It answers one question with data rather than adjectives: for the route this delivery is
 * actually on, which candidates are safer, and by how much?
 *
 * Three rules it follows, all of them existing ones:
 *
 *   * the margin is `SAFER_ROUTE_MARGIN` from `decision.ts` — the same 15 points the engine uses,
 *     imported rather than repeated, so the comparison can never disagree with the decision;
 *   * a candidate's risk is its OWN score. Every route is scored independently from its own
 *     features, and nothing here derives B or C from A;
 *   * `source` says where each score came from — the model or the stored demo value — because
 *     they can legitimately differ and a comparison that hid the difference would be a claim
 *     rather than a measurement.
 */

import type { Route } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { riskLevelForScore } from '../domain/riskThresholds';
import { REROUTE_RISK_THRESHOLD, SAFER_ROUTE_MARGIN } from './decision';
import type { TopFactor } from './mlClient';

export interface CandidateComparison {
  routeId: string;
  name: string;
  riskScore: number;
  riskLevel: string;
  etaMinutes: number;
  distanceKm: number;
  segmentIds: string[];
  isAssigned: boolean;
  isRecommended: boolean;
  /** assignedRisk - thisRisk. Positive means safer than the route in use. */
  riskDelta: number | null;
  /** riskDelta >= 15, the Decision Engine's own margin. */
  clearsSaferMargin: boolean;
  /** 'ML_PREDICTION' when a stored model score was used, 'DETERMINISTIC_DEMO' when the route row's own. */
  source: 'ML_PREDICTION' | 'DETERMINISTIC_DEMO';
  modelVersion: string | null;
  predictedAt: string | null;
  topFactors: TopFactor[];
}

export interface RouteComparison {
  deliveryId: string | null;
  deliveryCode: string | null;
  assignedRouteId: string | null;
  assignedRisk: number | null;
  /** True when the assigned route is at or above the reroute threshold. */
  assignedAtOrAboveThreshold: boolean;
  thresholds: { rerouteRisk: number; saferMargin: number };
  candidates: CandidateComparison[];
  /**
   * The lowest-risk candidate that clears the margin, or null. This is the same selection the
   * Decision Engine makes; it is surfaced here so the UI can name the route without re-deriving
   * the rule.
   */
  saferCandidateId: string | null;
  /** True only when BOTH engine conditions hold: threshold reached and a safer route exists. */
  rerouteAdvised: boolean;
}

const shortName = (name: string) => name.split('—')[0].trim();

/**
 * Compare every candidate for one delivery (or, with no delivery, for the corridor).
 *
 * `preferMl` uses the latest stored ML score per route where one exists for the current
 * scenario, falling back to the route row. Off by default, because the product's displayed
 * numbers are the route rows and a comparison that silently mixed the two would be unreadable.
 */
export async function compareRoutes(
  { deliveryCodeOrId, preferMl = false }: { deliveryCodeOrId?: string; preferMl?: boolean } = {},
): Promise<RouteComparison> {
  const delivery = deliveryCodeOrId
    ? await prisma.delivery.findFirst({
        where: { OR: [{ id: deliveryCodeOrId }, { code: deliveryCodeOrId }] },
      })
    : null;

  const routes = await prisma.route.findMany({ orderBy: { name: 'asc' } });

  // Latest ML score per route, for the scenario the world is in now.
  const mlByRoute = new Map<string, { riskScore: number; modelVersion: string; createdAt: Date; topFactors: TopFactor[] }>();
  if (preferMl && routes.length) {
    const { currentScenario } = await import('./routeRiskScoring');
    const scenario = await currentScenario();
    const rows = await prisma.riskPrediction.findMany({
      where: {
        entityType: 'ROUTE',
        provenance: 'ML_PREDICTION',
        scenario,
        routeId: { in: routes.map((r) => r.id) },
      },
      orderBy: { createdAt: 'desc' },
    });
    for (const row of rows) {
      if (row.routeId && !mlByRoute.has(row.routeId)) {
        mlByRoute.set(row.routeId, {
          riskScore: row.riskScore,
          modelVersion: row.modelVersion,
          createdAt: row.createdAt,
          topFactors: (row.topFactors ?? []) as unknown as TopFactor[],
        });
      }
    }
  }

  const riskOf = (route: Route) => {
    const ml = mlByRoute.get(route.id);
    return ml
      ? { score: ml.riskScore, source: 'ML_PREDICTION' as const, modelVersion: ml.modelVersion, at: ml.createdAt.toISOString(), factors: ml.topFactors }
      : {
          score: route.riskScore,
          source: 'DETERMINISTIC_DEMO' as const,
          modelVersion: null,
          at: null,
          factors: ((route.topFactors ?? []) as unknown as TopFactor[]) ?? [],
        };
  };

  const assigned = routes.find((r) => r.id === delivery?.assignedRouteId);
  const assignedRisk = assigned ? riskOf(assigned).score : null;

  const candidates: CandidateComparison[] = routes.map((route) => {
    const risk = riskOf(route);
    const delta = assignedRisk === null || route.id === assigned?.id ? null : assignedRisk - risk.score;
    return {
      routeId: route.id,
      name: shortName(route.name),
      riskScore: risk.score,
      riskLevel: riskLevelForScore(risk.score),
      etaMinutes: route.etaMinutes,
      distanceKm: route.distanceKm,
      segmentIds: route.segmentIds,
      isAssigned: route.id === assigned?.id,
      isRecommended: route.isRecommended,
      riskDelta: delta,
      clearsSaferMargin: delta !== null && delta >= SAFER_ROUTE_MARGIN,
      source: risk.source,
      modelVersion: risk.modelVersion,
      predictedAt: risk.at,
      topFactors: risk.factors,
    };
  });

  const safer = candidates
    .filter((c) => c.clearsSaferMargin)
    .sort((a, b) => a.riskScore - b.riskScore)[0];

  return {
    deliveryId: delivery?.id ?? null,
    deliveryCode: delivery?.code ?? null,
    assignedRouteId: assigned?.id ?? null,
    assignedRisk,
    assignedAtOrAboveThreshold: assignedRisk !== null && assignedRisk >= REROUTE_RISK_THRESHOLD,
    thresholds: { rerouteRisk: REROUTE_RISK_THRESHOLD, saferMargin: SAFER_ROUTE_MARGIN },
    candidates,
    saferCandidateId: safer?.routeId ?? null,
    // Both halves of the engine's first rule. A safer route existing is not on its own a reason
    // to move a truck; the assigned route also has to be bad enough to matter.
    rerouteAdvised: assignedRisk !== null && assignedRisk >= REROUTE_RISK_THRESHOLD && Boolean(safer),
  };
}
