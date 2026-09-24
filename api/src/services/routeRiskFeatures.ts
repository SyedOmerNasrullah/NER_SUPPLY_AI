/**
 * Database rows -> the twelve route-risk features the model takes.
 *
 * The only place that mapping exists. Every value comes from PostgreSQL; nothing is defaulted,
 * because a default for a missing rainfall reading would be a guess presented as a measurement.
 * If an input is absent the entity is skipped and the reason is returned.
 *
 * Two kinds of entity, scored differently because they are described differently:
 *
 *   SEGMENT   RouteSegment's own physical columns — they ARE the contract's feature names —
 *             plus that segment's WeatherSnapshot.
 *
 *   ROUTE     Route.profile (delta D12), the route-level rollup the frontend already shows for
 *             A, B and C, plus corridor weather. The mapping, field by field:
 *
 *               roadCondition              profile.roadCondition     (worst on the route)
 *               terrainSlopeDeg            profile.maxSlopeDeg
 *               elevationM                 profile.maxElevationM
 *               historicalLandslides       profile.history.landslides
 *               historicalFloods           profile.history.floods
 *               previousClosureFrequencyPct  profile.history.previousClosures / 52 × 100
 *               trafficLevel               profile.trafficLevel      (mean over segments)
 *
 *             The closure conversion is the one derivation: the profile counts closures recorded
 *             in the last twelve months, and the feature is a frequency, so it becomes "the share
 *             of weeks in the past year with a closure". Documented rather than hidden.
 */

import type { Route, RouteSegment, WeatherSnapshot } from '@prisma/client';
import type { RouteRiskFeatures } from './mlClient';

export type FeatureResult =
  | { ok: true; features: RouteRiskFeatures }
  | { ok: false; reason: string };

const WEEKS_PER_YEAR = 52;

function weatherPart(w: WeatherSnapshot) {
  return {
    rainfall1h: w.rainfall1h,
    rainfall3h: w.rainfall3h,
    rainfall6h: w.rainfall6h,
    rainfall24h: w.rainfall24h,
    windSpeedKmh: w.windSpeedKmh,
  };
}

export function segmentFeatures(segment: RouteSegment, weather: WeatherSnapshot | undefined): FeatureResult {
  if (!weather) return { ok: false, reason: `${segment.code} has no weather snapshot.` };
  return {
    ok: true,
    features: {
      ...weatherPart(weather),
      roadCondition: segment.roadCondition,
      terrainSlopeDeg: segment.terrainSlopeDeg,
      elevationM: segment.elevationM,
      historicalLandslides: segment.historicalLandslides,
      historicalFloods: segment.historicalFloods,
      previousClosureFrequencyPct: segment.previousClosureFrequencyPct,
      trafficLevel: segment.trafficLevel,
    },
  };
}

interface RouteProfileJson {
  roadCondition?: 'GOOD' | 'FAIR' | 'POOR';
  trafficLevel?: number;
  maxSlopeDeg?: number;
  maxElevationM?: number;
  history?: { previousClosures?: number; landslides?: number; floods?: number };
}

/**
 * Corridor weather for a route: the mean of the snapshots on the segments it covers. Today every
 * snapshot carries the same corridor-wide values, so this equals any one of them — but taking
 * the mean is what stays correct once weather varies by segment.
 */
export function corridorWeather(route: Route, snapshots: WeatherSnapshot[]): WeatherSnapshot | undefined {
  const covered = snapshots.filter((s) => route.segmentIds.includes(s.segmentId));
  const pool = covered.length ? covered : snapshots;
  if (!pool.length) return undefined;
  const mean = (pick: (s: WeatherSnapshot) => number) =>
    Number((pool.reduce((sum, s) => sum + pick(s), 0) / pool.length).toFixed(2));
  return {
    ...pool[0],
    rainfall1h: mean((s) => s.rainfall1h),
    rainfall3h: mean((s) => s.rainfall3h),
    rainfall6h: mean((s) => s.rainfall6h),
    rainfall24h: mean((s) => s.rainfall24h),
    windSpeedKmh: mean((s) => s.windSpeedKmh),
  };
}

/**
 * Route features aggregated from the segments the route OWNS (Phase 6B, delta D50).
 *
 * This is what makes the three candidates independent. Before route-owned segments existed, every
 * route's features came from its authored `profile` rollup, so a landslide that degraded a
 * segment changed no route's inputs at all — and B and C had no segments of their own to degrade.
 * Now each route is described by its own road: the worst condition on it, its steepest climb, its
 * highest point, its own hazard history.
 *
 * The twelve-feature contract is untouched. Only where the values come from has changed, and
 * every aggregation is the same one the authored profile used:
 *
 *   roadCondition               the WORST on the route — a corridor is as passable as its
 *                               poorest stretch
 *   terrainSlopeDeg             the steepest leg
 *   elevationM                  the highest point
 *   historicalLandslides/Floods the route's totals
 *   previousClosureFrequencyPct the mean across legs, weighted by nothing: each leg's own
 *                               recorded frequency, averaged
 *   trafficLevel                the mean across legs
 */
export function routeFeaturesFromSegments(
  segments: RouteSegment[],
  weather: WeatherSnapshot | undefined,
  label: string,
): FeatureResult {
  if (!weather) return { ok: false, reason: `${label} has no corridor weather.` };
  if (segments.length === 0) return { ok: false, reason: `${label} owns no segments to describe it.` };

  const worstCondition = segments.some((s) => s.roadCondition === 'POOR')
    ? 'POOR'
    : segments.some((s) => s.roadCondition === 'FAIR')
      ? 'FAIR'
      : 'GOOD';
  const mean = (pick: (s: RouteSegment) => number) =>
    segments.reduce((total, s) => total + pick(s), 0) / segments.length;

  return {
    ok: true,
    features: {
      ...weatherPart(weather),
      roadCondition: worstCondition,
      terrainSlopeDeg: Math.max(...segments.map((s) => s.terrainSlopeDeg)),
      elevationM: Math.max(...segments.map((s) => s.elevationM)),
      historicalLandslides: segments.reduce((total, s) => total + s.historicalLandslides, 0),
      historicalFloods: segments.reduce((total, s) => total + s.historicalFloods, 0),
      previousClosureFrequencyPct: Number(mean((s) => s.previousClosureFrequencyPct).toFixed(1)),
      trafficLevel: Number(mean((s) => s.trafficLevel).toFixed(2)),
    },
  };
}

/** The authored rollup, used when a route owns no segments (a demo-only database). */
export function routeFeatures(route: Route, weather: WeatherSnapshot | undefined): FeatureResult {
  const profile = route.profile as RouteProfileJson | null;
  const label = route.name.split('—')[0].trim();
  if (!weather) return { ok: false, reason: `${label} has no corridor weather.` };
  if (!profile) return { ok: false, reason: `${label} has no route profile to derive features from.` };

  const missing = (
    [
      ['roadCondition', profile.roadCondition],
      ['trafficLevel', profile.trafficLevel],
      ['maxSlopeDeg', profile.maxSlopeDeg],
      ['maxElevationM', profile.maxElevationM],
      ['history.landslides', profile.history?.landslides],
      ['history.floods', profile.history?.floods],
      ['history.previousClosures', profile.history?.previousClosures],
    ] as const
  ).filter(([, v]) => v === undefined || v === null);
  if (missing.length) {
    return { ok: false, reason: `${label} profile is missing ${missing.map(([k]) => k).join(', ')}.` };
  }

  return {
    ok: true,
    features: {
      ...weatherPart(weather),
      roadCondition: profile.roadCondition!,
      terrainSlopeDeg: profile.maxSlopeDeg!,
      elevationM: profile.maxElevationM!,
      historicalLandslides: profile.history!.landslides!,
      historicalFloods: profile.history!.floods!,
      previousClosureFrequencyPct: Number(
        ((profile.history!.previousClosures! / WEEKS_PER_YEAR) * 100).toFixed(1),
      ),
      trafficLevel: profile.trafficLevel!,
    },
  };
}
