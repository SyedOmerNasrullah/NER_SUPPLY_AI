/**
 * The towns each candidate route runs through.
 *
 * These mirror `web/src/domain/geo.ts` exactly — same names, same coordinates, same order. Two
 * languages cannot share one constant, and the frontend's copy is the frozen one the demo draws;
 * this copy is what the route generator hands to OpenRouteService. `tests/routes.test.ts` checks
 * the two agree, so a town moved on one side fails the build rather than quietly producing a
 * different road on the other.
 *
 * Only NAMED towns are listed. The frontend's shaping points exist to bend a schematic line
 * toward the right valleys; ORS follows the actual road network and does not need them, and
 * feeding it invented midpoints would drag the route off the highway.
 *
 * The three routes and what they mean, unchanged from the product:
 *
 *   A  the corridor itself — NH-15 / NH-13 via Tezpur, Bhalukpong and Bomdila
 *   B  the western bypass — leaves at Mangaldoi for Udalguri, Kalaktang and the Sela tunnel,
 *      touching neither Tezpur nor Bhalukpong
 *   C  the eastern approach — out to Seppa through the Pakke valley, then west to Dirang
 */

export interface RouteWaypoint {
  name: string;
  lat: number;
  lng: number;
}

export interface RouteDefinition {
  /** Matches the seeded `Route.name` prefix, which is how the generator finds the row. */
  key: 'A' | 'B' | 'C';
  label: string;
  /** Prefix for generated segment codes: A-SEG-001, B-SEG-001, ... */
  codePrefix: string;
  waypoints: RouteWaypoint[];
}

const CORRIDOR: RouteWaypoint[] = [
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

const ROUTE_B: RouteWaypoint[] = [
  { name: 'Guwahati', lat: 26.1445, lng: 91.7362 },
  { name: 'Baihata Chariali', lat: 26.3475, lng: 91.6669 },
  { name: 'Mangaldoi', lat: 26.4392, lng: 92.03 },
  { name: 'Udalguri', lat: 26.7536, lng: 92.102 },
  { name: 'Bhairabkunda', lat: 26.89, lng: 92.11 },
  { name: 'Kalaktang', lat: 27.099, lng: 92.096 },
  { name: 'Shergaon', lat: 27.13, lng: 92.27 },
  { name: 'Rupa', lat: 27.2031, lng: 92.3978 },
  { name: 'Bomdila', lat: 27.265, lng: 92.4241 },
  { name: 'Sela Tunnel', lat: 27.47, lng: 92.15 },
  { name: 'Tawang', lat: 27.5859, lng: 91.859 },
];

const ROUTE_C: RouteWaypoint[] = [
  { name: 'Guwahati', lat: 26.1445, lng: 91.7362 },
  { name: 'Baihata Chariali', lat: 26.3475, lng: 91.6669 },
  { name: 'Mangaldoi', lat: 26.4392, lng: 92.03 },
  { name: 'Dhekiajuli', lat: 26.7015, lng: 92.478 },
  { name: 'Tezpur', lat: 26.6528, lng: 92.7926 },
  { name: 'Balipara', lat: 26.839, lng: 92.769 },
  { name: 'Seijosa', lat: 26.95, lng: 92.99 },
  { name: 'Seppa', lat: 27.33, lng: 93.04 },
  { name: 'Dirang', lat: 27.3592, lng: 92.2411 },
  { name: 'Jang', lat: 27.5333, lng: 91.95 },
  { name: 'Tawang', lat: 27.5859, lng: 91.859 },
];

export const ROUTE_DEFINITIONS: RouteDefinition[] = [
  { key: 'A', label: 'Route A', codePrefix: 'SEG', waypoints: CORRIDOR },
  { key: 'B', label: 'Route B', codePrefix: 'B-SEG', waypoints: ROUTE_B },
  { key: 'C', label: 'Route C', codePrefix: 'C-SEG', waypoints: ROUTE_C },
];

/**
 * Route A keeps the plain `SEG-001` codes it has always had.
 *
 * Fifteen seeded segments carry those codes, and they are referenced by incidents, risk
 * predictions, the frozen cascade, the runbook and the regression suites. Renaming them to
 * `A-SEG-001` would buy symmetry and cost every one of those references; ownership is expressed
 * by `RouteSegment.routeId`, which is the thing that actually matters.
 */
export const ROUTE_A_KEEPS_LEGACY_CODES = true;
