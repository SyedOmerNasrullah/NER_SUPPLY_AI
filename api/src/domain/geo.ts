/**
 * Incident → road-segment association.
 *
 * Method (MVP, documented in docs/BACKEND_ARCHITECTURE.md):
 *
 *   1. Each RouteSegment is modelled as the straight line between its start and end points —
 *      the only geometry the schema holds for a segment.
 *   2. The incident's distance to each line is measured in a local equirectangular projection
 *      centred on the incident (accurate to well under 1% at these distances), projecting the
 *      point onto the line and clamping to its ends.
 *   3. The closest segment is associated ONLY if it is within MAX_SEGMENT_DISTANCE_KM.
 *      Otherwise the incident is stored with no segment. An incident reported in Aizawl is not
 *      "on" the Guwahati–Tawang corridor just because that corridor is the nearest one we have,
 *      and silently attaching it would trigger a cascade on a road it never touched.
 *
 * Known limitation: roads are not straight. A mountain road can wander several kilometres from
 * the chord between its endpoints, which is why the threshold is 5 km rather than something
 * tighter. Real road geometry (OpenRouteService, a later phase) replaces the chords.
 *
 * The incident's own latitude/longitude is always the authoritative location. The segment is a
 * derived association and never moves the incident.
 *
 * Mirrors `distanceToSegmentKm` in web/src/domain/geo.ts, which the demo adapter uses so both
 * data sources associate identically.
 */

export const MAX_SEGMENT_DISTANCE_KM = 5;

const KM_PER_DEG_LAT = 110.574;
const KM_PER_DEG_LNG_EQUATOR = 111.32;

export function distanceToSegmentKm(
  lat: number,
  lng: number,
  start: { lat: number; lng: number },
  end: { lat: number; lng: number },
): number {
  const kx = Math.cos((lat * Math.PI) / 180) * KM_PER_DEG_LNG_EQUATOR;
  const ky = KM_PER_DEG_LAT;

  // Local planar coordinates, incident at the origin.
  const ax = (start.lng - lng) * kx;
  const ay = (start.lat - lat) * ky;
  const bx = (end.lng - lng) * kx;
  const by = (end.lat - lat) * ky;

  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  // Degenerate segment: distance to its single point.
  const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / lengthSq));

  const px = ax + t * dx;
  const py = ay + t * dy;
  return Math.sqrt(px * px + py * py);
}

export interface SegmentLike {
  id: string;
  code: string;
  name: string;
  startLat: number;
  startLng: number;
  endLat: number;
  endLng: number;
}

export interface SegmentMatch {
  segmentId: string;
  code: string;
  name: string;
  distanceKm: number;
}

/** The nearest segment within the threshold, or null if none is close enough. */
export function nearestSegment(
  segments: SegmentLike[],
  lat: number,
  lng: number,
  maxKm = MAX_SEGMENT_DISTANCE_KM,
): SegmentMatch | null {
  let best: SegmentMatch | null = null;
  for (const s of segments) {
    const d = distanceToSegmentKm(lat, lng, { lat: s.startLat, lng: s.startLng }, { lat: s.endLat, lng: s.endLng });
    if (!best || d < best.distanceKm) {
      best = { segmentId: s.id, code: s.code, name: s.name, distanceKm: d };
    }
  }
  if (!best || best.distanceKm > maxKm) return null;
  return { ...best, distanceKm: Number(best.distanceKm.toFixed(2)) };
}

/**
 * Great-circle distance between two points, in kilometres.
 *
 * Added for the delivery-risk feature builder, which needs "how far is this vehicle from its
 * destination". `distanceToSegmentKm` above stays equirectangular because it works over a few
 * kilometres where the difference is nil; this one can span the whole corridor, where it is not.
 */
export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

// ---------------------------------------------------------------------------
// Which corridor an incident sits on
// ---------------------------------------------------------------------------

/**
 * The corridor segments describe ONE road: Route A, Guwahati -> Tawang via NH-15/NH-13. Routes B
 * and C have their own geometry and borrow A's segments where they overlap, so a point on the
 * stretch that only Route B travels — Udalguri to Bhairabkunda, say — is genuinely 25 km from
 * every stored segment.
 *
 * Segment matching is therefore right to refuse it, and the incident is right to stay unmatched.
 * But "no segment" is not the same as "no corridor", and reporting nothing at all left an
 * operator looking at a landslide sitting exactly on Route B with the interface saying only that
 * it matched nothing. This answers the second, weaker question: which candidate route does this
 * point lie on, and how far from its line?
 */
export const MAX_ROUTE_DISTANCE_KM = 5;

export interface RouteLike {
  id: string;
  name: string;
  geometry: unknown;
  riskScore: number;
  riskLevel: string;
}

export interface RouteMatch {
  routeId: string;
  name: string;
  distanceKm: number;
  riskScore: number;
  riskLevel: string;
}

/** Perpendicular distance from a point to a polyline, in kilometres. */
export function distanceToPathKm(lat: number, lng: number, path: [number, number][]): number {
  let best = Number.POSITIVE_INFINITY;
  for (let i = 1; i < path.length; i += 1) {
    const d = distanceToSegmentKm(
      lat,
      lng,
      { lat: path[i - 1][0], lng: path[i - 1][1] },
      { lat: path[i][0], lng: path[i][1] },
    );
    if (d < best) best = d;
  }
  return best;
}

/** The nearest candidate route within the threshold, or null when the point is off every corridor. */
export function nearestRoute(
  routes: RouteLike[],
  lat: number,
  lng: number,
  maxKm = MAX_ROUTE_DISTANCE_KM,
): RouteMatch | null {
  let best: RouteMatch | null = null;
  for (const r of routes) {
    const path = r.geometry as [number, number][] | null;
    if (!Array.isArray(path) || path.length < 2) continue;
    const d = distanceToPathKm(lat, lng, path);
    if (!best || d < best.distanceKm) {
      best = {
        routeId: r.id,
        name: r.name.split('—')[0].trim(),
        distanceKm: d,
        riskScore: r.riskScore,
        riskLevel: r.riskLevel,
      };
    }
  }
  if (!best || best.distanceKm > maxKm) return null;
  return { ...best, distanceKm: Number(best.distanceKm.toFixed(2)) };
}


// ---------------------------------------------------------------------------
// Route-first matching (Phase 6B, delta D50)
// ---------------------------------------------------------------------------

/**
 * A segment with its own drawn line. Segments generated from road geometry carry a polyline;
 * seeded ones fall back to the straight line between their endpoints.
 */
export interface PathSegmentLike extends SegmentLike {
  routeId?: string | null;
  sequence?: number | null;
  geometry?: unknown;
}

const segmentPath = (s: PathSegmentLike): [number, number][] =>
  Array.isArray(s.geometry) && s.geometry.length >= 2
    ? (s.geometry as [number, number][])
    : [
        [s.startLat, s.startLng],
        [s.endLat, s.endLng],
      ];

/**
 * The nearest segment, measured against each segment's own driven line.
 *
 * `nearestSegment` above measures to the straight line between a segment's endpoints, which was
 * right when that WAS the geometry. With road geometry a leg can bow twenty kilometres away from
 * its own chord, so the distance has to be measured against the line the road actually takes.
 */
export function nearestSegmentOnPath(
  segments: PathSegmentLike[],
  lat: number,
  lng: number,
  maxKm = MAX_SEGMENT_DISTANCE_KM,
): SegmentMatch | null {
  let best: SegmentMatch | null = null;
  for (const s of segments) {
    const d = distanceToPathKm(lat, lng, segmentPath(s));
    if (!best || d < best.distanceKm) {
      best = { segmentId: s.id, code: s.code, name: s.name, distanceKm: d };
    }
  }
  if (!best || best.distanceKm > maxKm) return null;
  return { ...best, distanceKm: Number(best.distanceKm.toFixed(2)) };
}

export interface AffectedCorridor {
  route: RouteMatch;
  segment: SegmentMatch | null;
}

export interface CorridorMatch {
  route: RouteMatch | null;
  segment: SegmentMatch | null;
  /**
   * Every OTHER route whose own line passes within the threshold, with its own nearest segment.
   *
   * Routes share tarmac. Where Route C runs over the same road as Route A, a landslide there
   * blocks it for both, and each carries its own segment row for that stretch. Degrading only one
   * of them would leave the other claiming a clear road it cannot use. This is explicit shared
   * impact, not implicit shared state: two rows, both changed, each owned by its own route.
   */
  alsoAffected: AffectedCorridor[];
}

/**
 * Where an incident happened, in the product's terms: which candidate routes, and which of THEIR
 * segments.
 *
 * The primary match is the route whose own segment lies closest to the point — not merely whose
 * line does, because the segment is what carries risk. Exact ties break by route name, so the
 * answer is deterministic rather than dependent on row order.
 *
 * Four outcomes, all legitimate:
 *   route + segment (+ others)  the normal case, and on shared road more than one route
 *   route, no segment           on a corridor, but no leg of it within the segment threshold
 *   neither                     genuinely off every road the system knows
 */
export function matchCorridor(
  routes: RouteLike[],
  segments: PathSegmentLike[],
  lat: number,
  lng: number,
): CorridorMatch {
  const candidates: AffectedCorridor[] = [];
  for (const route of routes) {
    const path = route.geometry as [number, number][] | null;
    if (!Array.isArray(path) || path.length < 2) continue;
    const distance = distanceToPathKm(lat, lng, path);
    if (distance > MAX_ROUTE_DISTANCE_KM) continue;
    candidates.push({
      route: {
        routeId: route.id,
        name: route.name.split('—')[0].trim(),
        distanceKm: Number(distance.toFixed(2)),
        riskScore: route.riskScore,
        riskLevel: route.riskLevel,
      },
      segment: nearestSegmentOnPath(
        segments.filter((s) => s.routeId === route.id),
        lat,
        lng,
      ),
    });
  }

  if (candidates.length === 0) return { route: null, segment: null, alsoAffected: [] };

  candidates.sort((a, b) => {
    const da = a.segment?.distanceKm ?? Number.POSITIVE_INFINITY;
    const db = b.segment?.distanceKm ?? Number.POSITIVE_INFINITY;
    return da - db || a.route.distanceKm - b.route.distanceKm || a.route.name.localeCompare(b.route.name);
  });

  const [primary, ...rest] = candidates;
  return { route: primary.route, segment: primary.segment, alsoAffected: rest };
}
