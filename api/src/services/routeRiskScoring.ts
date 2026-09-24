/**
 * Score the corridor with the real model, persist, and compare against the frozen demo.
 *
 * What this deliberately does NOT do: write the model's scores into `RouteSegment.lastRiskScore`
 * or `Route.riskScore`. Those are what the product displays, and replacing them is the step AFTER
 * this one. Phase 5A establishes the comparison first: every ML prediction lands in the
 * append-only `RiskPrediction` log with `provenance = ML_PREDICTION`, alongside the demo's
 * scores, so the gap between the two is measured before anyone decides what to do about it.
 *
 * `explanationText` is a fixed template over the SHAP values — "Rainfall (24h) +12.4 pts, …" —
 * not narration. No language model is involved at any point.
 */

import world from '../../prisma/seed-data/world.json';
import { riskLevelForScore } from '../domain/riskThresholds';
import { prisma } from '../lib/prisma';
import { predictRouteRisk, type RouteRiskFeatures, type RouteRiskPrediction } from './mlClient';
import {
  corridorWeather,
  routeFeatures,
  routeFeaturesFromSegments,
  segmentFeatures,
} from './routeRiskFeatures';

export type Scenario = 'baseline' | 'heavy_rain';

export interface ScoredEntity {
  entityType: 'ROUTE' | 'SEGMENT';
  id: string;
  label: string;
  features: RouteRiskFeatures;
  prediction: RouteRiskPrediction;
}

export interface SkippedEntity {
  entityType: 'ROUTE' | 'SEGMENT';
  id: string;
  reason: string;
}

/** Which world the database is currently showing — the scenario a prediction is filed under. */
export async function currentScenario(): Promise<Scenario> {
  const state = await prisma.demoState.findUnique({ where: { id: 'singleton' } });
  return state?.simulated ? 'heavy_rain' : 'baseline';
}

const routeLabel = (name: string) => name.split('—')[0].trim();

function explanation(p: RouteRiskPrediction): string {
  const parts = p.topFactors
    .slice(0, 3)
    .map((f) => `${f.factor} ${f.shapValue >= 0 ? '+' : '−'}${Math.abs(f.shapValue).toFixed(1)} pts`);
  return `SHAP (${p.modelVersion}, synthetic-trained): ${parts.join(', ')} against a base of ${p.shapBaseValue.toFixed(1)}.`;
}

export async function scoreCorridor(): Promise<{
  scenario: Scenario;
  scored: ScoredEntity[];
  skipped: SkippedEntity[];
}> {
  const [scenario, segments, routes, snapshots] = await Promise.all([
    currentScenario(),
    prisma.routeSegment.findMany({ orderBy: { code: 'asc' } }),
    prisma.route.findMany({ orderBy: { name: 'asc' } }),
    prisma.weatherSnapshot.findMany(),
  ]);

  const jobs: { entityType: 'ROUTE' | 'SEGMENT'; id: string; label: string; result: ReturnType<typeof segmentFeatures> }[] = [
    ...routes.map((r) => {
      // Owned segments first (delta D50): a route is described by its own road, so a segment
      // degraded by an incident changes that route's features and nobody else's. The authored
      // profile is the fallback for a database whose routes own no segments.
      const owned = segments.filter((s) => s.routeId === r.id).sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
      return {
        entityType: 'ROUTE' as const,
        id: r.id,
        label: routeLabel(r.name),
        result: owned.length
          ? routeFeaturesFromSegments(owned, corridorWeather(r, snapshots), routeLabel(r.name))
          : routeFeatures(r, corridorWeather(r, snapshots)),
      };
    }),
    ...segments.map((s) => ({
      entityType: 'SEGMENT' as const,
      id: s.id,
      label: s.code,
      result: segmentFeatures(s, snapshots.find((w) => w.segmentId === s.id)),
    })),
  ];

  const skipped: SkippedEntity[] = [];
  const scored: ScoredEntity[] = [];

  // Sequential on purpose. Each call is a few milliseconds against a local service, and a burst
  // of eighteen concurrent requests buys nothing but a harder-to-read log when one fails.
  for (const job of jobs) {
    if (!job.result.ok) {
      skipped.push({ entityType: job.entityType, id: job.id, reason: job.result.reason });
      continue;
    }
    const prediction = await predictRouteRisk(job.result.features, job.label);
    scored.push({ entityType: job.entityType, id: job.id, label: job.label, features: job.result.features, prediction });
  }

  // One round trip for the whole batch — against a remote database, eighteen inserts would
  // cost eighteen times the latency of one.
  await prisma.riskPrediction.createMany({
    data: scored.map((s) => ({
      entityType: s.entityType,
      segmentId: s.entityType === 'SEGMENT' ? s.id : null,
      routeId: s.entityType === 'ROUTE' ? s.id : null,
      riskScore: s.prediction.riskScore,
      riskProbability: s.prediction.riskProbability,
      riskLevel: s.prediction.riskLevel,
      predictedDisruption: s.prediction.riskScore >= 70,
      topFactors: s.prediction.topFactors,
      explanationText: explanation(s.prediction),
      modelVersion: s.prediction.modelVersion,
      provenance: 'ML_PREDICTION',
      scenario,
      featureValues: s.prediction.featureValues,
      shapBaseValue: s.prediction.shapBaseValue,
    })),
  });

  return { scenario, scored, skipped };
}

// ---------------------------------------------------------------------------
// Demo vs ML — the Phase 5A regression checkpoint
// ---------------------------------------------------------------------------

export interface ComparisonRow {
  entityType: 'ROUTE' | 'SEGMENT';
  id: string;
  label: string;
  demoScore: number | null;
  mlScore: number | null;
  difference: number | null;
  demoLevel: string | null;
  mlLevel: string | null;
  predictedAt: string | null;
  topFactors: { factor: string; contributionPct: number; direction: string }[];
}

/**
 * The frozen demo's score for an entity in a scenario — read from the exported snapshot, not
 * from the database. The snapshot IS the regression reference; the database could have been
 * rerouted or half-reset, and a comparison against a moving target is not a checkpoint.
 */
function frozenDemoScore(entityType: 'ROUTE' | 'SEGMENT', id: string, scenario: Scenario): number | null {
  const source = scenario === 'heavy_rain' ? world.afterRain : world;
  if (entityType === 'ROUTE') {
    return source.routeCandidates.find((r) => r.id === id)?.riskScore ?? null;
  }
  return source.segments.find((s) => s.id === id)?.lastRiskScore ?? null;
}

export async function compare(scenario: Scenario, modelVersion = 'route-risk-xgb-v1'): Promise<ComparisonRow[]> {
  const [routes, segments, predictions] = await Promise.all([
    prisma.route.findMany({ orderBy: { name: 'asc' } }),
    prisma.routeSegment.findMany({ orderBy: { code: 'asc' } }),
    prisma.riskPrediction.findMany({
      where: { provenance: 'ML_PREDICTION', modelVersion, scenario },
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  const latest = (entityType: 'ROUTE' | 'SEGMENT', id: string) =>
    predictions.find((p) => p.entityType === entityType && (entityType === 'ROUTE' ? p.routeId : p.segmentId) === id);

  const row = (entityType: 'ROUTE' | 'SEGMENT', id: string, label: string): ComparisonRow => {
    const demo = frozenDemoScore(entityType, id, scenario);
    const ml = latest(entityType, id);
    const factors = (ml?.topFactors as { factor: string; contributionPct: number; direction: string }[] | null) ?? [];
    return {
      entityType,
      id,
      label,
      demoScore: demo,
      mlScore: ml?.riskScore ?? null,
      difference: demo !== null && ml ? ml.riskScore - demo : null,
      demoLevel: demo !== null ? riskLevelForScore(demo) : null,
      mlLevel: ml?.riskLevel ?? null,
      predictedAt: ml?.createdAt.toISOString() ?? null,
      topFactors: factors.map((f) => ({ factor: f.factor, contributionPct: f.contributionPct, direction: f.direction })),
    };
  };

  return [
    ...routes.map((r) => row('ROUTE', r.id, routeLabel(r.name))),
    ...segments.map((s) => row('SEGMENT', s.id, s.code)),
  ];
}
