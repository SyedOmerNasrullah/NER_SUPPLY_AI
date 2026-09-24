/**
 * Corridor geography and geodesy helpers.
 *
 * The waypoints below are lifted verbatim from the frozen backend seed
 * (`ner-supplyai-backend/src/seed/corridor.ts`) so the demo adapter and the real database
 * describe the SAME 16 towns on the real NH-15 / NH-13 corridor. When Phase 6 swaps the data
 * source, the map does not move.
 *
 * Coordinate order is [lat, lng] throughout — app-internal order, per contract 6.2. GeoJSON's
 * [lng, lat] appears only at the ORS boundary, which the frontend never touches.
 */

export type LatLng = [number, number];

export interface Waypoint {
  name: string;
  lat: number;
  lng: number;
}

/** Guwahati (plains, 55 m) -> Tawang (alpine, 2 700 m). 16 towns, 15 legs. */
export const CORRIDOR_WAYPOINTS: Waypoint[] = [
  { name: 'Guwahati', lat: 26.1445, lng: 91.7362 },
  { name: 'Baihata Chariali', lat: 26.3475, lng: 91.6669 },
  { name: 'Mangaldoi', lat: 26.4392, lng: 92.03 },
  { name: 'Kharupetia', lat: 26.523, lng: 92.145 },
  { name: 'Tangla', lat: 26.618, lng: 92.165 },
  { name: 'Orang', lat: 26.6, lng: 92.33 },
  { name: 'Dhekiajuli', lat: 26.7015, lng: 92.478 },
  { name: 'Tezpur', lat: 26.6528, lng: 92.7926 },
  { name: 'Balipara', lat: 26.839, lng: 92.769 },
  { name: 'Bhalukpong', lat: 27.0128, lng: 92.6394 },
  { name: 'Tenga Valley', lat: 27.18, lng: 92.47 },
  { name: 'Bomdila', lat: 27.265, lng: 92.4241 },
  { name: 'Dirang', lat: 27.3592, lng: 92.2411 },
  { name: 'Sela Pass', lat: 27.5044, lng: 92.1064 },
  { name: 'Jang', lat: 27.5333, lng: 91.95 },
  { name: 'Tawang', lat: 27.5859, lng: 91.859 },
];

/**
 * A waypoint on one of the alternate candidates. `name` is the town the line passes through, or
 * '' for a shaping point between towns. `onProfile: false` keeps a town off the terrain chart's
 * labels where the authored demo elevation at that index is not the town's real height — the
 * geometry passes through it, but the chart does not claim an altitude it does not have.
 */
export interface RouteWaypoint extends Waypoint {
  onProfile?: boolean;
}

/**
 * Route B — "Tezpur bypass via Kalaktang". Leaves the corridor at Mangaldoi, runs north through
 * Udalguri and Bhairabkunda into the hills at Kalaktang, over Shergaon and Rupa to Bomdila, then
 * through the Sela Tunnel to Tawang. It never touches Tezpur, Balipara or Bhalukpong — which is
 * the whole point of it: SEG-010, Bhalukpong – Tenga Valley, is where the simulated storm lands.
 *
 * Deterministic MVP geometry through real town coordinates. OpenRouteService replaces all three
 * candidates with road-network geometry in the external-integration phase.
 */
export const ROUTE_B_WAYPOINTS: RouteWaypoint[] = [
  { name: 'Guwahati', lat: 26.1445, lng: 91.7362 },
  { name: 'Baihata Chariali', lat: 26.3475, lng: 91.6669 },
  { name: '', lat: 26.4, lng: 91.85 },
  { name: 'Mangaldoi', lat: 26.4392, lng: 92.03 },
  { name: '', lat: 26.6, lng: 92.07 },
  { name: 'Udalguri', lat: 26.7536, lng: 92.102 },
  { name: '', lat: 26.82, lng: 92.107 },
  { name: 'Bhairabkunda', lat: 26.89, lng: 92.11 },
  { name: '', lat: 26.96, lng: 92.105 },
  { name: '', lat: 27.03, lng: 92.1 },
  { name: 'Kalaktang', lat: 27.099, lng: 92.096 },
  { name: 'Shergaon', lat: 27.13, lng: 92.27 },
  { name: 'Rupa', lat: 27.2031, lng: 92.3978, onProfile: false },
  { name: 'Bomdila', lat: 27.265, lng: 92.4241 },
  { name: 'Sela Tunnel', lat: 27.47, lng: 92.15 },
  { name: 'Tawang', lat: 27.5859, lng: 91.859 },
];

/**
 * Route C — "Eastern approach via Seppa". Follows the corridor to Tezpur and Balipara, then turns
 * north-east through Seijosa and the Pakke valley to Seppa in East Kameng, before crossing back
 * west over the Kameng ranges to Dirang and the final climb to Tawang.
 */
export const ROUTE_C_WAYPOINTS: RouteWaypoint[] = [
  { name: 'Guwahati', lat: 26.1445, lng: 91.7362 },
  { name: 'Baihata Chariali', lat: 26.3475, lng: 91.6669 },
  { name: 'Mangaldoi', lat: 26.4392, lng: 92.03 },
  { name: 'Dhekiajuli', lat: 26.7015, lng: 92.478 },
  { name: 'Tezpur', lat: 26.6528, lng: 92.7926 },
  { name: 'Balipara', lat: 26.839, lng: 92.769 },
  { name: 'Seijosa', lat: 26.95, lng: 92.99, onProfile: false },
  { name: '', lat: 27.06, lng: 93.02 },
  { name: '', lat: 27.18, lng: 93.03 },
  { name: 'Seppa', lat: 27.33, lng: 93.04, onProfile: false },
  { name: '', lat: 27.36, lng: 92.82 },
  { name: '', lat: 27.37, lng: 92.6 },
  { name: 'Dirang', lat: 27.3592, lng: 92.2411, onProfile: false },
  { name: '', lat: 27.5044, lng: 92.1064 },
  { name: 'Jang', lat: 27.5333, lng: 91.95 },
  { name: 'Tawang', lat: 27.5859, lng: 91.859 },
];

export const ORIGIN = CORRIDOR_WAYPOINTS[0];
export const DESTINATION = CORRIDOR_WAYPOINTS[CORRIDOR_WAYPOINTS.length - 1];

/** The whole corridor as a polyline, for the base route ribbon. */
export const CORRIDOR_PATH: LatLng[] = CORRIDOR_WAYPOINTS.map((w) => [w.lat, w.lng]);

/** Centre and default zoom that frame Guwahati -> Tawang on a 16:9 panel. */
export const CORRIDOR_CENTER: LatLng = [26.92, 92.32];
export const CORRIDOR_ZOOM = 8;

/**
 * How far the map may be panned: the North Eastern Region plus a margin, so it cannot be dragged
 * into the Bay of Bengal.
 *
 * This must be WIDER than the visible map at the zoom a route is framed at. Leaflet's
 * `setView` clamps the centre so the viewport stays inside these bounds, and when the viewport is
 * the larger of the two it pins the centre to the middle of the bounds. The old corridor-only box
 * (4° wide) was narrower than a wide panel at zoom 7 (~11°), so every `fitBounds` to a single
 * route landed on the same centre and selecting a route never moved the map (Phase 5A.2).
 */
export const CORRIDOR_BOUNDS: [LatLng, LatLng] = [
  [21.5, 86.5],
  [30.0, 99.5],
];

// ---------------------------------------------------------------------------
// Geodesy
// ---------------------------------------------------------------------------

const R_EARTH_KM = 6371;
const toRad = (deg: number) => (deg * Math.PI) / 180;
const toDeg = (rad: number) => (rad * 180) / Math.PI;

/** Great-circle distance in km. Contract-sanctioned: plenty accurate at corridor scale. */
export function haversineKm(a: LatLng, b: LatLng): number {
  const dLat = toRad(b[0] - a[0]);
  const dLng = toRad(b[1] - a[1]);
  const lat1 = toRad(a[0]);
  const lat2 = toRad(b[0]);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R_EARTH_KM * Math.asin(Math.sqrt(h));
}

/** Summed length of a polyline, in km. */
export function pathLengthKm(path: LatLng[]): number {
  let total = 0;
  for (let i = 1; i < path.length; i += 1) total += haversineKm(path[i - 1], path[i]);
  return total;
}

/** Initial bearing a -> b, in degrees clockwise from north. Rotates the vehicle chevron. */
export function bearingDeg(a: LatLng, b: LatLng): number {
  const lat1 = toRad(a[0]);
  const lat2 = toRad(b[0]);
  const dLng = toRad(b[1] - a[1]);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** Linear interpolation between two points. `t` is clamped to [0, 1]. */
export function lerpLatLng(a: LatLng, b: LatLng, t: number): LatLng {
  const k = Math.min(1, Math.max(0, t));
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
}

/**
 * The point `fraction` of the way along a polyline, measured by real distance rather than by
 * vertex count — so a vehicle at 0.5 is genuinely halfway, not at the middle vertex.
 */
export function pointAlongPath(path: LatLng[], fraction: number): LatLng {
  if (path.length === 0) return CORRIDOR_CENTER;
  if (path.length === 1) return path[0];

  const target = pathLengthKm(path) * Math.min(1, Math.max(0, fraction));
  let travelled = 0;
  for (let i = 1; i < path.length; i += 1) {
    const legKm = haversineKm(path[i - 1], path[i]);
    if (travelled + legKm >= target) {
      return lerpLatLng(path[i - 1], path[i], legKm === 0 ? 0 : (target - travelled) / legKm);
    }
    travelled += legKm;
  }
  return path[path.length - 1];
}

/** Bearing of the polyline at `fraction`, so a marker points the way it is travelling. */
export function bearingAlongPath(path: LatLng[], fraction: number): number {
  const here = pointAlongPath(path, fraction);
  const ahead = pointAlongPath(path, Math.min(1, fraction + 0.02));
  return bearingDeg(here, ahead);
}

/** Midpoint by distance — where a route's callout chip is anchored. */
export function pathMidpoint(path: LatLng[]): LatLng {
  return pointAlongPath(path, 0.5);
}

/** Nearest corridor town to a coordinate, for "Near Bhalukpong" readouts. */
export function nearestWaypoint(point: LatLng): Waypoint {
  let best = CORRIDOR_WAYPOINTS[0];
  let bestKm = Infinity;
  for (const w of CORRIDOR_WAYPOINTS) {
    const km = haversineKm(point, [w.lat, w.lng]);
    if (km < bestKm) {
      bestKm = km;
      best = w;
    }
  }
  return best;
}

/**
 * Smooths a sparse polyline into something that reads like a road rather than a set of
 * straight hops between towns, by inserting Catmull-Rom interpolated points.
 *
 * This is presentation only — it never changes a distance or an ETA, both of which come from
 * the data layer. Phase 6 replaces these polylines with real OpenRouteService geometry and
 * this function stops being used for routes (it stays useful for risk-zone outlines).
 */
export function smoothPath(path: LatLng[], perSegment = 6): LatLng[] {
  if (path.length < 3) return path;
  const pts = [path[0], ...path, path[path.length - 1]];
  const out: LatLng[] = [];

  for (let i = 1; i < pts.length - 2; i += 1) {
    const [p0, p1, p2, p3] = [pts[i - 1], pts[i], pts[i + 1], pts[i + 2]];
    for (let s = 0; s < perSegment; s += 1) {
      const t = s / perSegment;
      const t2 = t * t;
      const t3 = t2 * t;
      const axis = (a: number, b: number, c: number, d: number) =>
        0.5 *
        (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([axis(p0[0], p1[0], p2[0], p3[0]), axis(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  out.push(path[path.length - 1]);
  return out;
}

// ---------------------------------------------------------------------------
// Incident → segment association — mirrors api/src/domain/geo.ts
// ---------------------------------------------------------------------------

/**
 * Beyond this distance an incident is not associated with any corridor segment. Segments are
 * stored as straight chords between their end points and real mountain roads wander from the
 * chord, hence 5 km rather than something tighter. The incident's own coordinates are always
 * the authoritative location; the segment is a derived association.
 */
export const MAX_SEGMENT_DISTANCE_KM = 5;

/** Distance in km from a point to the straight segment start→end (local equirectangular). */
export function distanceToSegmentKm(point: LatLng, start: LatLng, end: LatLng): number {
  const kx = Math.cos(toRad(point[0])) * 111.32;
  const ky = 110.574;
  const ax = (start[1] - point[1]) * kx;
  const ay = (start[0] - point[0]) * ky;
  const bx = (end[1] - point[1]) * kx;
  const by = (end[0] - point[0]) * ky;
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / lengthSq));
  return Math.hypot(ax + t * dx, ay + t * dy);
}


// ---------------------------------------------------------------------------
// Which corridor segments a route actually travels
// ---------------------------------------------------------------------------

/**
 * A route covers a segment when the segment's midpoint lies within this distance of the route's
 * line. Tight enough that Route B, which leaves the corridor at Mangaldoi, does not count the
 * Bhalukpong stretch it bypasses; loose enough to absorb the smoothing on the drawn line.
 *
 * The contract's rule (section 6.7) says 5 km, written for road-network geometry. Against these
 * schematic alternates, which run close beside the corridor before they leave it, 5 km claims
 * stretches a route does not drive: SEG-003 for Route B (3.3 km off its line) and SEG-005 and
 * SEG-012 for Route C (3.2 and 4.4 km). Contract delta D39.
 */
export const ROUTE_SEGMENT_TOLERANCE_KM = 3;

/**
 * The ids of the segments a route passes along, in the order the route reaches them (contract
 * section 6.7). One rule for both data sources: the demo adapter calls it at runtime, and the
 * world exporter calls it so the database seed stores exactly the same association.
 */
export function routeSegmentIds(
  geometry: LatLng[],
  segments: { id: string; startLat: number; startLng: number; endLat: number; endLng: number }[],
): string[] {
  const matched: { id: string; leg: number }[] = [];
  for (const seg of segments) {
    const mid: LatLng = [(seg.startLat + seg.endLat) / 2, (seg.startLng + seg.endLng) / 2];
    for (let i = 1; i < geometry.length; i += 1) {
      if (distanceToSegmentKm(mid, geometry[i - 1], geometry[i]) <= ROUTE_SEGMENT_TOLERANCE_KM) {
        matched.push({ id: seg.id, leg: i });
        break;
      }
    }
  }
  // Ordered by the first leg of the route that passes the segment, not by the order the caller
  // happened to list the segments in (the risk list, for instance, is sorted by score).
  return matched.sort((a, b) => a.leg - b.leg).map((m) => m.id);
}

/**
 * How close a point must be to a candidate route's line to count as "on that corridor".
 *
 * The stored segments describe Route A only, so a report on the stretch only Route B travels
 * matches no segment and is still on a road the system runs. This is the second, weaker
 * question — mirrors `MAX_ROUTE_DISTANCE_KM` in api/src/domain/geo.ts (delta D49).
 */
export const MAX_ROUTE_DISTANCE_KM = 5;

/** Perpendicular distance from a point to a polyline, in kilometres. */
export function distanceToPathKm(point: LatLng, path: LatLng[]): number {
  let best = Number.POSITIVE_INFINITY;
  for (let i = 1; i < path.length; i += 1) {
    const d = distanceToSegmentKm(point, path[i - 1], path[i]);
    if (d < best) best = d;
  }
  return best;
}

// ---------------------------------------------------------------------------
// Framing a local view
// ---------------------------------------------------------------------------

/**
 * The stretch of a route that runs past a point, as vertices already in its geometry.
 *
 * Used to frame a map on an incident without losing the road it happened on. Returns a
 * contiguous window — every vertex within `radiusKm`, plus one either side so the line enters
 * and leaves the frame rather than stopping dead at the radius — so the caller can fit to
 * "the incident and the road around it" instead of the whole corridor.
 *
 * These are the route's own points, whatever produced them: real OpenRouteService geometry in
 * API mode, the schematic demo line in demo mode. Nothing here interpolates or invents a
 * coordinate. Empty when the route never comes within `radiusKm`, which is a real answer and
 * the caller's cue to frame the incident alone.
 */
export function pathNearPointKm(path: LatLng[], point: LatLng, radiusKm: number): LatLng[] {
  let first = -1;
  let last = -1;
  for (let i = 0; i < path.length; i += 1) {
    if (haversineKm(path[i], point) <= radiusKm) {
      if (first === -1) first = i;
      last = i;
    }
  }
  if (first === -1) return [];
  return path.slice(Math.max(0, first - 1), Math.min(path.length, last + 2));
}

/**
 * Points that frame `center` locally, with `context` kept in view and a floor on how tight the
 * result can be.
 *
 * `fitBounds` on a single coordinate zooms to its ceiling, which over these passes is a blurred
 * field with a marker in the middle; on an incident plus a short segment it can still land
 * closer than the surrounding road is legible. The two corners returned here put a minimum span
 * across the view so neither happens.
 *
 * The corners are viewport padding. They are never drawn, never stored, and never described as
 * geometry — the only thing they do is widen a bounding box.
 */
export function localFocus(center: LatLng, context: LatLng[], minSpanKm: number): LatLng[] {
  const halfLat = minSpanKm / 2 / 110.574;
  const halfLng = minSpanKm / 2 / (Math.cos(toRad(center[0])) * 111.32);
  return [
    [center[0] - halfLat, center[1] - halfLng],
    [center[0] + halfLat, center[1] + halfLng],
    ...context,
  ];
}
