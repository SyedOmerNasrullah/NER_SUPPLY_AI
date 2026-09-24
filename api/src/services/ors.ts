/**
 * OpenRouteService — the only file that talks to ORS.
 *
 * One call, `directions()`, turning a list of towns into a driven road: the polyline a vehicle
 * would actually follow, its length, how long it takes, the elevation along it, and where each
 * requested town falls on it.
 *
 * Three rules shape this file:
 *
 *   * it runs on the server only. The browser never sees ORS, and the API key exists here and in
 *     the environment, never in a response, a log line or an error message;
 *   * it never guesses. A missing key, a timeout, a refusal or a malformed body all raise
 *     `OrsError` with a kind the caller can act on. Nothing falls back to a straight line and
 *     calls it a road;
 *   * it is called by generation, not by rendering. Route geometry is generated once and
 *     persisted; no request path calls this on a page load.
 *
 * ORS speaks [lng, lat]; this project speaks [lat, lng] everywhere else (contract 6.2). The
 * conversion happens here and nowhere else.
 */

import { env } from '../config/env';

export type OrsErrorKind =
  /** No API key configured — a server setup problem, not a routing failure. */
  | 'NOT_CONFIGURED'
  /** ORS could not be reached, or did not answer in time. */
  | 'UNAVAILABLE'
  /** ORS answered and refused: bad coordinates, quota exhausted, no route between the points. */
  | 'REJECTED'
  /** ORS answered with something outside its own documented shape. */
  | 'INVALID_RESPONSE';

export class OrsError extends Error {
  readonly kind: OrsErrorKind;

  constructor(kind: OrsErrorKind, message: string) {
    super(message);
    this.name = 'OrsError';
    this.kind = kind;
  }
}

/** [lat, lng] — app-internal order. */
export type LatLng = [number, number];

export interface OrsLeg {
  /** Index into `geometry` where this leg starts and ends. */
  startIndex: number;
  endIndex: number;
  distanceKm: number;
  durationMin: number;
}

export interface OrsRoute {
  /** The driven line, [lat, lng], in order. */
  geometry: LatLng[];
  /** Metres above sea level at each point of `geometry`, when elevation was requested. */
  elevations: number[];
  distanceKm: number;
  durationMin: number;
  /** One per consecutive pair of requested waypoints, in order. */
  legs: OrsLeg[];
  /** Index into `geometry` of each requested waypoint. */
  waypointIndices: number[];
}

const ENDPOINT = 'https://api.openrouteservice.org/v2/directions/driving-car/geojson';

/** Metres. How far ORS may look for a road when snapping a requested town. */
const SNAP_RADIUS_M = 5000;

export const orsConfigured = (): boolean => Boolean(env.ors.apiKey);

/**
 * Drive through the given points, in order.
 *
 * `points` are [lat, lng] and must be at least two. Elevation is requested, because the
 * route-risk feature contract needs `elevationM` and `terrainSlopeDeg` and a measured height is
 * worth more than an authored one.
 */
export async function directions(points: LatLng[]): Promise<OrsRoute> {
  if (!env.ors.apiKey) {
    throw new OrsError('NOT_CONFIGURED', 'ORS_API_KEY is not configured on this server.');
  }
  if (points.length < 2) {
    throw new OrsError('REJECTED', 'A route needs at least two points.');
  }

  let res: Response;
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: env.ors.apiKey,
        'Content-Type': 'application/json',
        Accept: 'application/geo+json',
      },
      body: JSON.stringify({
        coordinates: points.map(([lat, lng]) => [lng, lat]),
        elevation: true,
        // ORS only returns the per-leg `segments` array when instructions are requested, and the
        // legs are the whole point here: they are what becomes one route-owned segment per
        // town-to-town stretch. The turn-by-turn text itself is ignored.
        instructions: true,
        // Snap each town to the nearest road within this radius. The seeded coordinates are town
        // centres, not junctions — Tangla's sits about a kilometre off the highway — and ORS's
        // 350 m default refuses them outright. Five kilometres is wide enough to find the road
        // through a small town and tight enough that it cannot snap to a different one.
        radiuses: points.map(() => SNAP_RADIUS_M),
      }),
      signal: AbortSignal.timeout(env.ors.timeoutMs),
    });
  } catch (err) {
    const timedOut = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
    throw new OrsError(
      'UNAVAILABLE',
      timedOut ? 'OpenRouteService did not respond in time.' : 'OpenRouteService could not be reached.',
    );
  }

  if (!res.ok) {
    // ORS error bodies describe the request (bad coordinate, quota, no route found). The status
    // and ORS's own message travel onward; the Authorization header never does.
    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } | string };
    const detail = typeof body.error === 'string' ? body.error : body.error?.message;
    throw new OrsError(
      res.status === 401 || res.status === 403 ? 'NOT_CONFIGURED' : 'REJECTED',
      `OpenRouteService returned HTTP ${res.status}${detail ? `: ${String(detail).slice(0, 200)}` : ''}`,
    );
  }

  const body = (await res.json().catch(() => null)) as {
    features?: {
      geometry?: { coordinates?: number[][] };
      properties?: {
        summary?: { distance?: number; duration?: number };
        segments?: { distance?: number; duration?: number }[];
        way_points?: number[];
      };
    }[];
  } | null;

  const feature = body?.features?.[0];
  const coordinates = feature?.geometry?.coordinates;
  const properties = feature?.properties;
  if (!Array.isArray(coordinates) || coordinates.length < 2 || !properties?.summary) {
    throw new OrsError('INVALID_RESPONSE', 'OpenRouteService returned no usable route geometry.');
  }

  const geometry: LatLng[] = [];
  const elevations: number[] = [];
  for (const point of coordinates) {
    // [lng, lat, elevation?] -> [lat, lng] plus the height alongside.
    geometry.push([point[1], point[0]]);
    elevations.push(typeof point[2] === 'number' ? point[2] : 0);
  }

  const waypointIndices = Array.isArray(properties.way_points)
    ? properties.way_points
    : [0, geometry.length - 1];

  const legs: OrsLeg[] = (properties.segments ?? []).map((leg, i) => ({
    startIndex: waypointIndices[i] ?? 0,
    endIndex: waypointIndices[i + 1] ?? geometry.length - 1,
    distanceKm: Number(((leg.distance ?? 0) / 1000).toFixed(2)),
    durationMin: Math.round((leg.duration ?? 0) / 60),
  }));

  return {
    geometry,
    elevations,
    distanceKm: Number(((properties.summary.distance ?? 0) / 1000).toFixed(2)),
    durationMin: Math.round((properties.summary.duration ?? 0) / 60),
    legs,
    waypointIndices,
  };
}
