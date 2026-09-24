/**
 * The deterministic demo world.
 *
 * Every value a judge reads is written out literally here. Nothing is randomised, nothing
 * reads the wall clock, and the ids match the frozen backend seed's deterministic UUID scheme
 * (`ner-supplyai-backend/src/seed/corridor.ts`) so Phase 6's swap to the real API does not
 * renumber anything.
 *
 * PROVENANCE. These are SYNTHETIC values representing the documented demo scenario from
 * docs/PROJECT_REFERENCE.md section 10 — they are not live measurements, and the UI labels
 * them as such. The risk scores below stand in for what XGBoost will actually emit once
 * Phase 5 tunes the synthetic training data; the frontend renders whatever the data source
 * returns and never hardcodes a score at the component level.
 *
 * The documented scenario, for reference:
 *   NE-102, emergency medicine, Guwahati -> Tawang District Hospital
 *   at rest      Route A  21% / 5h 05m   (recommended — fastest and safest)
 *   after rain   Route A  87% / 7h 20m   Route B 32% / 6h 55m (recommended)   Route C 64% / 8h 10m
 *   consequence  Tawang medicine stockout in 32h -> pre-position 100 units
 */

import type {
  Alert,
  AnalyticsSummaryResponse,
  Delivery,
  District,
  FieldOfficer,
  Incident,
  NotificationRecord,
  RiskFactor,
  RouteSegment,
  User,
  Vehicle,
  VehicleMovement,
  Warehouse,
  WeatherConditions,
} from '@/domain/types';
import {
  CORRIDOR_WAYPOINTS,
  ROUTE_B_WAYPOINTS,
  ROUTE_C_WAYPOINTS,
  pointAlongPath,
  smoothPath,
  type LatLng,
} from '@/domain/geo';
import { daysAgo, hoursAgo, minutesAgo, minutesAhead, seededRandom } from './clock';
// Field photographs for the two seeded incidents that carry one. Bundled rather than
// remote so the demo does not depend on the network; the real API returns a stored URL.
import incidentPhotoRoad from '@/assets/ner-mountain-road.jpg';
import incidentPhotoMountain from '@/assets/ner-valley.jpg';

// ---------------------------------------------------------------------------
// Deterministic ids — same scheme as the backend seed, so nothing is renumbered in Phase 6.
// ---------------------------------------------------------------------------

const fixedId = (prefix: string, n: number): string =>
  `${prefix}0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const ID = {
  user: 'a',
  district: 'b',
  warehouse: 'c',
  segment: 'd',
  route: 'e',
  vehicle: 'f',
  delivery: '1',
  incident: '4',
  alert: '5',
  officer: '6',
  recommendation: '7',
  notification: '8',
  // Route-owned segments for the alternates (delta D50). Distinct prefixes so a B segment id can
  // never collide with a corridor one.
  segmentB: '9',
  segmentC: 'a1',
} as const;

/** The tuned demo segment: Bhalukpong -> Tenga Valley. Simulated rain lands here. */
export const DEMO_SEGMENT_ID = fixedId(ID.segment, 10);
export const DEMO_DELIVERY_ID = fixedId(ID.delivery, 1);
export const DEMO_DISTRICT_ID = fixedId(ID.district, 9);

// ---------------------------------------------------------------------------
// Accounts — the four roles, password `demo123` (see docs/DEMO_RUNBOOK.md section 2)
// ---------------------------------------------------------------------------

export const DEMO_PASSWORD = 'demo123';

export const USERS: User[] = [
  {
    id: fixedId(ID.user, 1),
    name: 'L. Kashyap',
    email: 'admin@ner.local',
    role: 'ADMIN',
    phone: '+91 98640 00001',
  },
  {
    id: fixedId(ID.user, 2),
    name: 'Anjali Bora',
    email: 'logistics@ner.local',
    role: 'LOGISTICS_OFFICER',
    phone: '+91 98640 00002',
  },
  {
    id: fixedId(ID.user, 3),
    name: 'Tenzin Norbu',
    email: 'field@ner.local',
    role: 'FIELD_OFFICER',
    phone: '+91 98640 00003',
    districtId: fixedId(ID.district, 9),
  },
  {
    id: fixedId(ID.user, 4),
    name: 'Rupa Sangma',
    email: 'district@ner.local',
    role: 'DISTRICT_OFFICER',
    phone: '+91 98640 00004',
    districtId: fixedId(ID.district, 9),
  },
];

// ---------------------------------------------------------------------------
// Districts
//
// 1-10 are the corridor districts carried over verbatim from the backend seed. 11-15 widen the
// picture to the rest of the North East so Supply Intelligence reads as a regional system
// rather than a single road — this matches the visual reference, which shows Kohima, Aizawl
// and Itanagar alongside Tawang. Logged in docs/CONTRACT_DELTAS.md as an additive seed change.
// ---------------------------------------------------------------------------

interface DistrictSeed {
  n: number;
  name: string;
  state: string;
  lat: number;
  lng: number;
  medicine: [number, number, number | null];
  food: [number, number, number | null];
  fuel: [number, number, number | null];
}

const DISTRICT_SEED: DistrictSeed[] = [
  // n  name                    state                lat      lng      [stock, perDay, stockoutH]
  //
  // perDay is DERIVED so that stock / perDay * 24 == stockoutH. The three numbers are shown
  // side by side in the supply table, so they have to agree; a hand-set projection that does
  // not match its own inputs is the first thing an attentive judge would find.
  // Rates are high because these are emergency draw-downs, not steady-state consumption —
  // which is precisely why the deliveries carrying them are CRITICAL priority.
  { n: 1, name: 'Kamrup Metropolitan', state: 'Assam', lat: 26.1445, lng: 91.7362, medicine: [4200, 62, 1626], food: [18400, 240, 1840], fuel: [9600, 180, 1280] },
  { n: 2, name: 'Kamrup', state: 'Assam', lat: 26.3475, lng: 91.6669, medicine: [1850, 34, 1306], food: [7200, 118, 1464], fuel: [3400, 74, 1103] },
  { n: 3, name: 'Darrang', state: 'Assam', lat: 26.4392, lng: 92.03, medicine: [1240, 29, 1026], food: [5100, 96, 1275], fuel: [2150, 58, 890] },
  { n: 4, name: 'Udalguri', state: 'Assam', lat: 26.618, lng: 92.165, medicine: [980, 26, 905], food: [4300, 88, 1173], fuel: [1780, 51, 838] },
  { n: 5, name: 'Sonitpur', state: 'Assam', lat: 26.6528, lng: 92.7926, medicine: [2100, 41, 1229], food: [8600, 142, 1454], fuel: [4200, 92, 1096] },
  { n: 6, name: 'Biswanath', state: 'Assam', lat: 26.728, lng: 93.15, medicine: [860, 24, 860], food: [3900, 79, 1185], fuel: [1620, 47, 828] },
  { n: 7, name: 'West Kameng', state: 'Arunachal Pradesh', lat: 27.265, lng: 92.4241, medicine: [640, 21, 731], food: [2800, 66, 1018], fuel: [1180, 39, 726] },
  { n: 8, name: 'East Kameng', state: 'Arunachal Pradesh', lat: 27.2833, lng: 92.9167, medicine: [520, 19, 657], food: [2400, 58, 993], fuel: [960, 34, 678] },
  // Tawang — the demo destination. Its MEDICINE line is the one that matters: it sits just
  // above the 48h line at rest and the cascade pushes it under. Food and fuel are deliberately
  // healthy here, because Supply Status ranks each district by its most urgent category and a
  // tighter fuel projection would hide the medicine story behind it.
  { n: 9, name: 'Tawang', state: 'Arunachal Pradesh', lat: 27.5859, lng: 91.859, medicine: [420, 198, 51], food: [2300, 45, 1226], fuel: [1180, 26, 1089] },
  { n: 10, name: 'Baksa', state: 'Assam', lat: 26.6161, lng: 91.317, medicine: [1120, 27, 995], food: [4800, 92, 1252], fuel: [1940, 54, 862] },
  // Wider North East — regional context for Supply Intelligence.
  { n: 11, name: 'Kohima', state: 'Nagaland', lat: 25.6751, lng: 94.1086, medicine: [1460, 31, 1131], food: [6100, 104, 1408], fuel: [1200, 465, 62] },
  { n: 12, name: 'Aizawl', state: 'Mizoram', lat: 23.7271, lng: 92.7176, medicine: [1680, 33, 1222], food: [2300, 425, 130], fuel: [3100, 68, 1094] },
  { n: 13, name: 'Itanagar', state: 'Arunachal Pradesh', lat: 27.0844, lng: 93.6053, medicine: [890, 235, 91], food: [5200, 98, 1273], fuel: [2400, 61, 944] },
  { n: 14, name: 'Imphal West', state: 'Manipur', lat: 24.817, lng: 93.9368, medicine: [2050, 39, 1262], food: [8900, 149, 1433], fuel: [4600, 96, 1150] },
  { n: 15, name: 'East Khasi Hills', state: 'Meghalaya', lat: 25.5788, lng: 91.8933, medicine: [2380, 44, 1298], food: [9800, 158, 1488], fuel: [5100, 102, 1200] },
];

export const DISTRICT_STATE: Record<string, string> = {};

export const DISTRICTS: District[] = DISTRICT_SEED.map((d) => {
  const id = fixedId(ID.district, d.n);
  DISTRICT_STATE[id] = d.state;
  return {
    id,
    name: d.name,
    lat: d.lat,
    lng: d.lng,
    stock: {
      medicine: {
        currentStock: d.medicine[0],
        dailyConsumption: d.medicine[1],
        predictedStockoutHours: d.medicine[2],
      },
      food: {
        currentStock: d.food[0],
        dailyConsumption: d.food[1],
        predictedStockoutHours: d.food[2],
      },
      fuel: {
        currentStock: d.fuel[0],
        dailyConsumption: d.fuel[1],
        predictedStockoutHours: d.fuel[2],
      },
    },
  };
});

// ---------------------------------------------------------------------------
// Warehouses — carried over from the backend seed, all on the corridor.
// ---------------------------------------------------------------------------

export const WAREHOUSES: Warehouse[] = [
  { id: fixedId(ID.warehouse, 1), name: 'Guwahati Central Medical Depot', lat: 26.158, lng: 91.75 },
  { id: fixedId(ID.warehouse, 2), name: 'Mangaldoi District Store', lat: 26.44, lng: 92.035 },
  { id: fixedId(ID.warehouse, 3), name: 'Tezpur Regional Warehouse', lat: 26.66, lng: 92.785 },
  { id: fixedId(ID.warehouse, 4), name: 'Bhalukpong Forward Depot', lat: 27.0128, lng: 92.6394 },
  { id: fixedId(ID.warehouse, 5), name: 'Bomdila Highland Depot', lat: 27.268, lng: 92.426 },
  { id: fixedId(ID.warehouse, 6), name: 'Dirang Transit Store', lat: 27.3592, lng: 92.2411 },
];

// ---------------------------------------------------------------------------
// Route segments — the 15 corridor legs.
//
// Baseline risk escalates with the real terrain: flat flood-prone Assam plains, then foothills,
// then landslide-prone alpine passes. Leg 10 (Bhalukpong -> Tenga Valley) sits at 43 — exactly
// the at-rest value the frozen backend produces from its ground-truth formula, and the value
// the runbook's demo script expects before simulated rain lifts it to 87.
// ---------------------------------------------------------------------------

const SEGMENT_BASELINE: { risk: number; status: RouteSegment['currentStatus'] }[] = [
  { risk: 12, status: 'OPEN' }, //  1 Guwahati -> Baihata Chariali
  { risk: 16, status: 'OPEN' }, //  2 Baihata Chariali -> Mangaldoi
  { risk: 24, status: 'OPEN' }, //  3 Mangaldoi -> Kharupetia
  { risk: 22, status: 'OPEN' }, //  4 Kharupetia -> Tangla
  { risk: 27, status: 'OPEN' }, //  5 Tangla -> Orang
  { risk: 21, status: 'OPEN' }, //  6 Orang -> Dhekiajuli
  { risk: 14, status: 'OPEN' }, //  7 Dhekiajuli -> Tezpur
  { risk: 26, status: 'OPEN' }, //  8 Tezpur -> Balipara
  { risk: 38, status: 'OPEN' }, //  9 Balipara -> Bhalukpong
  { risk: 43, status: 'OPEN' }, // 10 Bhalukpong -> Tenga Valley  <<< DEMO_SEGMENT_ID
  { risk: 51, status: 'OPEN' }, // 11 Tenga Valley -> Bomdila
  { risk: 58, status: 'PARTIAL' }, // 12 Bomdila -> Dirang
  { risk: 72, status: 'PARTIAL' }, // 13 Dirang -> Sela Pass
  { risk: 64, status: 'OPEN' }, // 14 Sela Pass -> Jang
  { risk: 41, status: 'OPEN' }, // 15 Jang -> Tawang
];

/** SHAP-shaped factor breakdowns. Ordering and weights follow the explicit risk formula
 *  (30% weather / 25% road / 20% history / 15% terrain / 10% traffic) that Phase 5's model
 *  is trained to refine. */
export const FACTORS_BASELINE: RiskFactor[] = [
  { factor: 'Rainfall (1h/24h)', contributionPct: 9 },
  { factor: 'Road Condition', contributionPct: 14 },
  { factor: 'Historical Risk', contributionPct: 11 },
  { factor: 'Terrain (Slope)', contributionPct: 7 },
  { factor: 'Traffic', contributionPct: 2 },
];

/** The post-simulation breakdown shown in the visual reference. */
export const FACTORS_AFTER_RAIN: RiskFactor[] = [
  { factor: 'Rainfall (1h/24h)', contributionPct: 31 },
  { factor: 'Road Condition', contributionPct: 24 },
  { factor: 'Historical Risk', contributionPct: 19 },
  { factor: 'Terrain (Slope)', contributionPct: 14 },
  { factor: 'Traffic', contributionPct: 8 },
];

export const SEGMENTS: RouteSegment[] = SEGMENT_BASELINE.map((base, i) => {
  const start = CORRIDOR_WAYPOINTS[i];
  const end = CORRIDOR_WAYPOINTS[i + 1];
  return {
    id: fixedId(ID.segment, i + 1),
    code: `SEG-${String(i + 1).padStart(3, '0')}`,
    name: `${start.name} – ${end.name}`,
    startLat: start.lat,
    startLng: start.lng,
    endLat: end.lat,
    endLng: end.lng,
    currentStatus: base.status,
    lastRiskScore: base.risk,
    lastRiskFactors: FACTORS_BASELINE,
  };
});

/**
 * Route-owned segments for the alternates — delta D50, demo mode's half of it.
 *
 * API mode gets these from OpenRouteService, generated once and persisted. Demo mode cannot call
 * ORS — the whole point of it is that it works on a laptop with no key and no internet — so the
 * same structure is built deterministically from the schematic waypoints the demo already draws:
 * one segment per town-to-town leg, owned by its route, in driving order.
 *
 * Their geometry is the project's own line, not a road survey, and every one is tagged
 * SYNTHETIC_ROUTE_GEOMETRY so nothing here can be mistaken for live routing.
 */
function alternateSegments(
  waypoints: { name: string; lat: number; lng: number }[],
  codePrefix: string,
  idBase: string,
  risks: number[],
): RouteSegment[] {
  const named = waypoints.filter((w) => w.name);
  return named.slice(0, -1).map((start, i) => {
    const end = named[i + 1];
    return {
      id: fixedId(idBase, i + 1),
      code: `${codePrefix}-${String(i + 1).padStart(3, '0')}`,
      name: `${start.name} – ${end.name}`,
      startLat: start.lat,
      startLng: start.lng,
      endLat: end.lat,
      endLng: end.lng,
      sequence: i + 1,
      currentStatus: 'OPEN' as const,
      // Deterministic, and deliberately modest: these are the quieter roads, and the demo's story
      // is that the corridor is the risky one.
      lastRiskScore: risks[i % risks.length],
      lastRiskFactors: FACTORS_BASELINE,
    };
  });
}

/** Route B's own legs — Mangaldoi, Udalguri, Kalaktang, the Sela tunnel. */
export const ROUTE_B_SEGMENTS: RouteSegment[] = alternateSegments(
  ROUTE_B_WAYPOINTS,
  'B-SEG',
  ID.segmentB,
  [14, 18, 22, 26, 31, 34, 29, 24, 20],
);

/** Route C's own legs — out to Seppa through the Pakke valley, then west to Dirang. */
export const ROUTE_C_SEGMENTS: RouteSegment[] = alternateSegments(
  ROUTE_C_WAYPOINTS,
  'C-SEG',
  ID.segmentC,
  [17, 21, 28, 33, 39, 44, 41, 36, 30],
);

/** Risk of DEMO_SEGMENT_ID once simulated rainfall is applied. */
export const DEMO_SEGMENT_RISK_AFTER_RAIN = 87;

// ---------------------------------------------------------------------------
// Routes — the three candidates from the documented scenario.
// ---------------------------------------------------------------------------

const PRIMARY_PATH: LatLng[] = smoothPath(CORRIDOR_WAYPOINTS.map((w) => [w.lat, w.lng]));

/**
 * Each alternate follows its own towns (domain/geo.ts). They used to be Route A's line pushed
 * 13 km west and 17 km east and tapered back onto it — so "via Kalaktang" and "via Seppa" were
 * drawn as the same road with a different label, hugging A the whole way and merging with it for
 * the first and last hundred kilometres. That is why selecting B or C barely changed the map.
 * The external-integration phase replaces all three with road-network geometry.
 */
const ROUTE_B_PATH: LatLng[] = smoothPath(ROUTE_B_WAYPOINTS.map((w) => [w.lat, w.lng]));
const ROUTE_C_PATH: LatLng[] = smoothPath(ROUTE_C_WAYPOINTS.map((w) => [w.lat, w.lng]));

export const ROUTE_IDS = {
  a: fixedId(ID.route, 1),
  b: fixedId(ID.route, 2),
  c: fixedId(ID.route, 3),
};

export const ROUTE_GEOMETRY: Record<string, LatLng[]> = {
  [ROUTE_IDS.a]: PRIMARY_PATH,
  [ROUTE_IDS.b]: ROUTE_B_PATH,
  [ROUTE_IDS.c]: ROUTE_C_PATH,
};

interface RouteSpec {
  id: string;
  name: string;
  distanceKm: number;
  geometry: LatLng[];
  baseline: { etaMinutes: number; riskScore: number; explanation: string };
  afterRain: { etaMinutes: number; riskScore: number; explanation: string };
}

export const ROUTE_SPECS: RouteSpec[] = [
  {
    id: ROUTE_IDS.a,
    name: 'Route A — NH-15 / NH-13 via Bomdila',
    distanceKm: 448.6,
    geometry: PRIMARY_PATH,
    baseline: {
      etaMinutes: 305,
      riskScore: 21,
      explanation:
        'The direct corridor is clear. Road condition is fair through the foothills and no rainfall is recorded on the alpine segments.',
    },
    afterRain: {
      etaMinutes: 440,
      riskScore: 87,
      explanation:
        'Heavy rainfall, poor road condition and historical landslide zones are the main contributors to the elevated risk for Route A.',
    },
  },
  {
    id: ROUTE_IDS.b,
    name: 'Route B — Tezpur bypass via Kalaktang',
    distanceKm: 471.2,
    geometry: ROUTE_B_PATH,
    baseline: {
      etaMinutes: 415,
      riskScore: 28,
      explanation:
        'A longer western approach with gentler gradients. Slower at rest, but it avoids the two highest-slope segments entirely.',
    },
    afterRain: {
      etaMinutes: 415,
      riskScore: 32,
      explanation:
        'Rainfall on this corridor is lighter and it avoids the landslide-prone Bhalukpong–Tenga stretch, so both risk and travel time hold steady.',
    },
  },
  {
    id: ROUTE_IDS.c,
    name: 'Route C — Eastern approach via Seppa',
    distanceKm: 512.4,
    geometry: ROUTE_C_PATH,
    baseline: {
      etaMinutes: 470,
      riskScore: 41,
      explanation:
        'The longest option, on state roads for much of its length. Usable, but slower and rougher than either western route.',
    },
    afterRain: {
      etaMinutes: 490,
      riskScore: 64,
      explanation:
        'Moderate rainfall and poor surface condition raise this route materially, though it stays below the disruption threshold.',
    },
  },
];

// ---------------------------------------------------------------------------
// Deliveries — NE-102 is the demonstration; the rest give the fleet a realistic shape.
// ---------------------------------------------------------------------------

interface DeliverySpec {
  n: number;
  code: string;
  cargoType: string;
  priority: Delivery['priority'];
  from: string;
  to: string;
  status: Delivery['status'];
  requiredInMin: number;
  etaMin: number;
  failureProbability?: number;
  expectedDelayMinutes?: number;
  /** Units carried, and the district the destination sits in (contract delta D15). */
  units: number;
  districtN: number;
}

const DELIVERY_SPECS: DeliverySpec[] = [
  { n: 1, code: 'NE-102', cargoType: 'Medicine (Emergency)', priority: 'CRITICAL', from: 'Guwahati', to: 'Tawang District Hospital', status: 'IN_TRANSIT', requiredInMin: 420, etaMin: 305, failureProbability: 0.18, expectedDelayMinutes: 0 , units: 260, districtN: 9 },
  { n: 2, code: 'NE-087', cargoType: 'Medicine', priority: 'HIGH', from: 'Guwahati', to: 'Itanagar General Hospital', status: 'AT_RISK', requiredInMin: 360, etaMin: 398, failureProbability: 0.61, expectedDelayMinutes: 38 , units: 180, districtN: 13 },
  { n: 3, code: 'NE-064', cargoType: 'Food Supplies', priority: 'MEDIUM', from: 'Guwahati', to: 'Silchar Relief Centre', status: 'IN_TRANSIT', requiredInMin: 540, etaMin: 470, failureProbability: 0.14, expectedDelayMinutes: 0 , units: 1400, districtN: 6 },
  { n: 4, code: 'NE-091', cargoType: 'Fuel', priority: 'HIGH', from: 'Tezpur', to: 'Kohima Fuel Depot', status: 'IN_TRANSIT', requiredInMin: 600, etaMin: 552, failureProbability: 0.22, expectedDelayMinutes: 0 , units: 900, districtN: 11 },
  { n: 5, code: 'NE-108', cargoType: 'Medicine', priority: 'HIGH', from: 'Guwahati', to: 'Aizawl Civil Hospital', status: 'PENDING', requiredInMin: 720, etaMin: 690, failureProbability: 0.19, expectedDelayMinutes: 0 , units: 320, districtN: 12 },
  { n: 6, code: 'NE-076', cargoType: 'Vaccines (Cold Chain)', priority: 'CRITICAL', from: 'Guwahati', to: 'Bomdila District Hospital', status: 'AT_RISK', requiredInMin: 300, etaMin: 341, failureProbability: 0.72, expectedDelayMinutes: 41 , units: 140, districtN: 7 },
  { n: 7, code: 'NE-055', cargoType: 'Food Supplies', priority: 'LOW', from: 'Mangaldoi', to: 'Udalguri Block Store', status: 'DELIVERED', requiredInMin: -180, etaMin: -212, failureProbability: 0.05, expectedDelayMinutes: 0 , units: 800, districtN: 4 },
  { n: 8, code: 'NE-049', cargoType: 'Medical Equipment', priority: 'MEDIUM', from: 'Tezpur', to: 'Seppa Community Health Centre', status: 'AT_RISK', requiredInMin: 260, etaMin: 318, failureProbability: 0.58, expectedDelayMinutes: 58 , units: 60, districtN: 8 },
];

const PLACE_COORD: Record<string, LatLng> = {
  Guwahati: [26.1445, 91.7362],
  Tezpur: [26.6528, 92.7926],
  Mangaldoi: [26.4392, 92.03],
  'Tawang District Hospital': [27.5859, 91.859],
  'Itanagar General Hospital': [27.0844, 93.6053],
  'Silchar Relief Centre': [24.8333, 92.7789],
  'Kohima Fuel Depot': [25.6751, 94.1086],
  'Aizawl Civil Hospital': [23.7271, 92.7176],
  'Bomdila District Hospital': [27.265, 92.4241],
  'Udalguri Block Store': [26.618, 92.165],
  'Seppa Community Health Centre': [27.1333, 92.9167],
};

export const DELIVERIES: Delivery[] = DELIVERY_SPECS.map((s) => {
  const origin = PLACE_COORD[s.from];
  const dest = PLACE_COORD[s.to];
  return {
    id: fixedId(ID.delivery, s.n),
    code: s.code,
    cargoType: s.cargoType,
    priority: s.priority,
    originLat: origin[0],
    originLng: origin[1],
    destLat: dest[0],
    destLng: dest[1],
    originName: s.from,
    destName: s.to,
    cargoUnits: s.units,
    destDistrictId: fixedId(ID.district, s.districtN),
    assignedVehicleId: fixedId(ID.vehicle, s.n),
    assignedRouteId: s.n === 1 ? ROUTE_IDS.a : undefined,
    requiredEta: minutesAhead(s.requiredInMin),
    currentEta: minutesAhead(s.etaMin),
    failureProbability: s.failureProbability,
    expectedDelayMinutes: s.expectedDelayMinutes,
    status: s.status,
  };
});

/** NE-102 after the cascade: the numbers in the visual reference. */
export const DEMO_DELIVERY_AFTER_RAIN = {
  etaMinutes: 440,
  addedDelayMinutes: 135,
  failureProbability: 0.87,
};

// ---------------------------------------------------------------------------
// Vehicles — 20 in the fleet, 8 visibly in transit along the corridor.
//
// The eight carrying a delivery are placed at a literal fraction along their route so their
// map position is meaningful. The remaining twelve are spread across the corridor with a
// seeded generator: their exact coordinates carry no operational meaning, but they must not
// change between reloads.
// ---------------------------------------------------------------------------

const DRIVERS = [
  'B. Rabha', 'K. Doley', 'T. Nyori', 'S. Basumatary', 'P. Tamang', 'M. Ering',
  'J. Sangma', 'R. Kalita', 'D. Chetri', 'A. Pegu', 'N. Lhamu', 'H. Deka',
  'G. Tayeng', 'V. Sharma', 'I. Marak', 'L. Bodo', 'C. Thapa', 'O. Wangchu',
  'F. Nath', 'U. Gogoi',
];

interface TransitSpec {
  n: number;
  code: string;
  deliveryIndex: number;
  progress: number;
  speedKmh: number;
  expectedSpeedKmh: number;
}

const IN_TRANSIT: TransitSpec[] = [
  { n: 1, code: 'V-201', deliveryIndex: 1, progress: 0.42, speedKmh: 38, expectedSpeedKmh: 45 },
  { n: 2, code: 'V-076', deliveryIndex: 2, progress: 0.61, speedKmh: 14, expectedSpeedKmh: 48 },
  { n: 3, code: 'V-064', deliveryIndex: 3, progress: 0.28, speedKmh: 52, expectedSpeedKmh: 55 },
  { n: 4, code: 'V-091', deliveryIndex: 4, progress: 0.55, speedKmh: 44, expectedSpeedKmh: 50 },
  { n: 6, code: 'V-118', deliveryIndex: 6, progress: 0.73, speedKmh: 21, expectedSpeedKmh: 45 },
  { n: 8, code: 'V-143', deliveryIndex: 8, progress: 0.36, speedKmh: 41, expectedSpeedKmh: 46 },
  { n: 9, code: 'V-157', deliveryIndex: 0, progress: 0.18, speedKmh: 49, expectedSpeedKmh: 52 },
  { n: 10, code: 'V-162', deliveryIndex: 0, progress: 0.86, speedKmh: 33, expectedSpeedKmh: 40 },
];

export const VEHICLES: Vehicle[] = (() => {
  const rand = seededRandom(26_1445);
  const out: Vehicle[] = [];

  for (const t of IN_TRANSIT) {
    const path = t.deliveryIndex === 2 ? ROUTE_C_PATH : t.deliveryIndex === 4 ? ROUTE_B_PATH : PRIMARY_PATH;
    const [lat, lng] = pointAlongPath(path, t.progress);
    out.push({
      id: fixedId(ID.vehicle, t.n),
      code: t.code,
      driverName: DRIVERS[t.n - 1],
      currentLat: lat,
      currentLng: lng,
      speedKmh: t.speedKmh,
      expectedSpeedKmh: t.expectedSpeedKmh,
      status: 'IN_TRANSIT',
      currentDeliveryId:
        t.deliveryIndex > 0 ? fixedId(ID.delivery, t.deliveryIndex) : undefined,
    });
  }

  const taken = new Set(IN_TRANSIT.map((t) => t.n));
  for (let n = 1; n <= 20; n += 1) {
    if (taken.has(n)) continue;
    const [lat, lng] = pointAlongPath(PRIMARY_PATH, rand());
    const stopped = n % 7 === 0;
    out.push({
      id: fixedId(ID.vehicle, n),
      code: `V-${String(200 + n * 3).padStart(3, '0')}`,
      driverName: DRIVERS[n - 1],
      currentLat: lat,
      currentLng: lng,
      speedKmh: stopped ? 0 : Math.round(18 + rand() * 26),
      expectedSpeedKmh: 45,
      status: stopped ? 'STOPPED' : 'IDLE',
    });
  }

  return out.sort((a, b) => a.code.localeCompare(b.code));
})();

/**
 * The "Recent Movements" feed. `place` is the nearest seeded corridor town, which the real API
 * resolves server-side by haversine against CORRIDOR_WAYPOINTS (contract delta D6).
 */
export const RECENT_MOVEMENTS: VehicleMovement[] = [
  { id: 'mv-1', vehicleCode: 'V-201', deliveryCode: 'NE-102', place: 'Near Bhalukpong', status: 'ON_ROUTE' },
  { id: 'mv-2', vehicleCode: 'V-076', deliveryCode: 'NE-087', place: 'Near Itanagar', status: 'DELAYED', delayMinutes: 38 },
  { id: 'mv-3', vehicleCode: 'V-064', deliveryCode: 'NE-064', place: 'Near Silchar', status: 'ON_ROUTE' },
  { id: 'mv-4', vehicleCode: 'V-091', deliveryCode: 'NE-091', place: 'Near Kohima', status: 'ON_ROUTE' },
  { id: 'mv-5', vehicleCode: 'V-118', deliveryCode: 'NE-076', place: 'Near Dirang', status: 'DELAYED', delayMinutes: 41 },
];

// ---------------------------------------------------------------------------
// Field officers
// ---------------------------------------------------------------------------

const OFFICER_NAMES: [string, number, FieldOfficer['status']][] = [
  ['Tenzin Norbu', 9, 'ACTIVE'],
  ['Dorjee Khandu', 9, 'ACTIVE'],
  ['Pema Wangmo', 7, 'ACTIVE'],
  ['Anil Basumatary', 5, 'ACTIVE'],
  ['Rekha Nath', 3, 'ACTIVE'],
  ['Jiten Boro', 4, 'OFFLINE'],
  ['Karma Tsering', 7, 'ACTIVE'],
  ['Bhaskar Saikia', 1, 'ACTIVE'],
  ['Mamoni Das', 2, 'OFFLINE'],
  ['Sanjay Pegu', 5, 'ACTIVE'],
  ['Lobsang Tashi', 9, 'ACTIVE'],
  ['Nabam Yaring', 8, 'OFFLINE'],
];

export const FIELD_OFFICERS: FieldOfficer[] = OFFICER_NAMES.map(([name, districtN, status], i) => ({
  id: fixedId(ID.officer, i + 1),
  name,
  phone: `+91 98${String(640_00010 + i).slice(0, 3)} ${String(10_000 + i * 137).slice(0, 5)}`,
  districtId: fixedId(ID.district, districtN),
  status,
}));

// ---------------------------------------------------------------------------
// Incidents — seeded field reports along the corridor.
// ---------------------------------------------------------------------------

interface IncidentSpec {
  n: number;
  type: Incident['type'];
  severity: Incident['severity'];
  waypointIndex: number;
  /**
   * The corridor leg this incident sits on (1-15), matching SEG-0NN. Contract delta D18 — the
   * real `incidents` table stores this, so the demo carries it rather than making the client
   * guess from coordinates.
   */
  segmentN: number;
  /** Field photograph, where the reporter attached one. */
  photo?: string;
  description: string;
  cvDetectedClass: string;
  cvConfidence: number;
  cvEstimatedBlockage: Incident['cvEstimatedBlockage'];
  ageMinutes: number;
}

const INCIDENT_SPECS: IncidentSpec[] = [
  { n: 1, type: 'LANDSLIDE', severity: 'HIGH', waypointIndex: 12, description: 'Slope failure on the Dirang approach; single lane passable with escort.', cvDetectedClass: 'landslide', cvConfidence: 0.91, cvEstimatedBlockage: 'PARTIAL', ageMinutes: 18 , segmentN: 13, photo: incidentPhotoRoad },
  { n: 2, type: 'DEBRIS', severity: 'MEDIUM', waypointIndex: 13, description: 'Rockfall debris across the carriageway below Sela Pass.', cvDetectedClass: 'debris', cvConfidence: 0.84, cvEstimatedBlockage: 'PARTIAL', ageMinutes: 96 , segmentN: 14 },
  { n: 3, type: 'FLOOD', severity: 'MEDIUM', waypointIndex: 5, description: 'Standing water at the Orang culvert after overnight rain.', cvDetectedClass: 'flood', cvConfidence: 0.78, cvEstimatedBlockage: 'PARTIAL', ageMinutes: 210 , segmentN: 6 },
  { n: 4, type: 'DAMAGED_ROAD', severity: 'LOW', waypointIndex: 8, description: 'Surface breaking up on the Balipara stretch.', cvDetectedClass: 'damaged road', cvConfidence: 0.69, cvEstimatedBlockage: 'NONE', ageMinutes: 1_450 , segmentN: 9 },
  { n: 5, type: 'BLOCKED_ROAD', severity: 'CRITICAL', waypointIndex: 11, description: 'Culvert washout north of Bomdila; road closed to heavy vehicles.', cvDetectedClass: 'landslide', cvConfidence: 0.93, cvEstimatedBlockage: 'SEVERE', ageMinutes: 2_880 , segmentN: 12, photo: incidentPhotoMountain },
  { n: 6, type: 'NORMAL', severity: 'LOW', waypointIndex: 3, description: 'Routine condition check — carriageway clear.', cvDetectedClass: 'normal', cvConfidence: 0.88, cvEstimatedBlockage: 'NONE', ageMinutes: 4_320 , segmentN: 4 },
  { n: 7, type: 'LANDSLIDE', severity: 'HIGH', waypointIndex: 10, description: 'Minor slip on the Tenga Valley bend; cleared to one lane.', cvDetectedClass: 'landslide', cvConfidence: 0.86, cvEstimatedBlockage: 'PARTIAL', ageMinutes: 12_960 , segmentN: 11 },
];

export const INCIDENTS: Incident[] = INCIDENT_SPECS.map((s) => {
  const w = CORRIDOR_WAYPOINTS[s.waypointIndex];
  return {
    id: fixedId(ID.incident, s.n),
    type: s.type,
    severity: s.severity,
    description: s.description,
    cvDetectedClass: s.cvDetectedClass,
    cvConfidence: s.cvConfidence,
    cvEstimatedBlockage: s.cvEstimatedBlockage,
    segmentId: fixedId(ID.segment, s.segmentN),
    segmentName: `${CORRIDOR_WAYPOINTS[s.segmentN - 1].name} – ${CORRIDOR_WAYPOINTS[s.segmentN].name}`,
    imageUrl: s.photo,
    lat: w.lat,
    lng: w.lng,
    createdAt: minutesAgo(s.ageMinutes),
  };
});

// ---------------------------------------------------------------------------
// Alerts
//
// BASELINE is what the feed shows at rest. The cascade prepends CASCADE_ALERTS when simulated
// rainfall runs — so the critical entries genuinely appear as a *consequence*, which is the
// whole point of the demonstration.
// ---------------------------------------------------------------------------

export const BASELINE_ALERTS: Alert[] = [
  {
    id: fixedId(ID.alert, 2),
    severity: 'HIGH',
    title: 'Landslide reported on NH-13',
    relatedType: 'INCIDENT' as const,
    relatedId: fixedId(ID.incident, 1),
    message: 'Near Seppa, Arunachal Pradesh. Single lane passable with escort.',
    notifiedViaTwilio: true,
    createdAt: minutesAgo(18),
  },
  {
    id: fixedId(ID.alert, 3),
    severity: 'MEDIUM',
    title: 'Supply level low: Medicine (Tawang)',
    relatedType: 'DISTRICT' as const,
    relatedId: fixedId(ID.district, 9),
    message: 'Projected stockout in 51 hours at current consumption.',
    notifiedViaTwilio: false,
    createdAt: minutesAgo(32),
  },
  {
    id: fixedId(ID.alert, 4),
    severity: 'LOW',
    title: 'Route cleared: NH-2',
    message: 'Normal traffic restored between Mangaldoi and Kharupetia.',
    notifiedViaTwilio: false,
    createdAt: minutesAgo(60),
  },
  {
    id: fixedId(ID.alert, 5),
    severity: 'LOW',
    title: 'New delivery assigned',
    message: 'NE-108: Guwahati to Aizawl Civil Hospital, medicine, high priority.',
    notifiedViaTwilio: false,
    createdAt: minutesAgo(120),
  },
];

export const CASCADE_ALERTS: Alert[] = [
  {
    id: fixedId(ID.alert, 1),
    severity: 'CRITICAL',
    title: 'Route disruption risk increased for NE-102',
    relatedType: 'DELIVERY' as const,
    relatedId: fixedId(ID.delivery, 1),
    message:
      'Heavy rainfall in the Tawang region lifted Bhalukpong–Tenga Valley from 43 to 87. Reroute to Route B recommended.',
    notifiedViaTwilio: true,
    createdAt: minutesAgo(5),
  },
  {
    id: fixedId(ID.alert, 6),
    severity: 'CRITICAL',
    title: 'Tawang medicine stock projected to run out',
    relatedType: 'DISTRICT' as const,
    relatedId: fixedId(ID.district, 9),
    message:
      'Delay on NE-102 pushes projected stockout to 32 hours, below the 48-hour safety line. Pre-positioning recommended.',
    notifiedViaTwilio: true,
    createdAt: minutesAgo(4),
  },
];

// ---------------------------------------------------------------------------
// Notifications (contract delta D16)
//
// Twilio's trial tier rejects sends to unverified numbers, and the runbook's answer to that
// depends on the interface reporting the failure rather than hiding it. So the fixtures carry
// both outcomes: the cascade's SMS notifications are delivered, and the escalation voice call
// is FAILED with the provider's actual rejection reason.
// ---------------------------------------------------------------------------

export const BASELINE_NOTIFICATIONS: NotificationRecord[] = [
  {
    id: fixedId(ID.notification, 1),
    alertId: fixedId(ID.alert, 2),
    alertTitle: 'Landslide reported on NH-13',
    channel: 'SMS',
    status: 'DELIVERED',
    recipientName: 'Anjali Bora',
    recipientRole: 'LOGISTICS_OFFICER',
    recipientPhone: '+91 98640 00002',
    sentAt: minutesAgo(18),
  },
];

export const CASCADE_NOTIFICATIONS: NotificationRecord[] = [
  {
    id: fixedId(ID.notification, 2),
    alertId: fixedId(ID.alert, 1),
    alertTitle: 'Route disruption risk increased for NE-102',
    channel: 'SMS',
    status: 'DELIVERED',
    recipientName: 'Anjali Bora',
    recipientRole: 'LOGISTICS_OFFICER',
    recipientPhone: '+91 98640 00002',
    sentAt: minutesAgo(5),
    relatedId: fixedId(ID.delivery, 1),
  },
  {
    id: fixedId(ID.notification, 3),
    alertId: fixedId(ID.alert, 6),
    alertTitle: 'Tawang medicine stock projected to run out',
    channel: 'SMS',
    status: 'DELIVERED',
    recipientName: 'Rupa Sangma',
    recipientRole: 'DISTRICT_OFFICER',
    recipientPhone: '+91 98640 00004',
    sentAt: minutesAgo(4),
    relatedId: fixedId(ID.district, 9),
  },
  {
    id: fixedId(ID.notification, 4),
    alertId: fixedId(ID.alert, 1),
    alertTitle: 'Route disruption risk increased for NE-102',
    channel: 'CALL',
    status: 'FAILED',
    recipientName: 'Anjali Bora',
    recipientRole: 'LOGISTICS_OFFICER',
    recipientPhone: '+91 98640 00002',
    failureReason: 'Trial account: voice call rejected at the provider.',
    sentAt: minutesAgo(5),
    relatedId: fixedId(ID.delivery, 1),
  },
];

// ---------------------------------------------------------------------------
// Recommendations
// ---------------------------------------------------------------------------

export const RECOMMENDATION_REROUTE = {
  id: fixedId(ID.recommendation, 1),
  type: 'REROUTE' as const,
  targetType: 'DELIVERY' as const,
  targetId: DEMO_DELIVERY_ID,
  recommendationText:
    'Reroute NE-102 through Route B. Risk falls from 87% to 32% and the arrival time improves by 25 minutes against the current Route A projection.',
  confidence: 0.91,
};

export const RECOMMENDATION_PREPOSITION = {
  id: fixedId(ID.recommendation, 2),
  type: 'PRE_POSITION' as const,
  targetType: 'DISTRICT' as const,
  targetId: DEMO_DISTRICT_ID,
  recommendationText:
    'Pre-position 100 units of medicine to Tawang from Bomdila Highland Depot. Transfer covers the projected 32-hour shortfall with 9 hours of margin.',
  confidence: 0.88,
};

// ---------------------------------------------------------------------------
// Weather
// ---------------------------------------------------------------------------

export const WEATHER_BASELINE: WeatherConditions = {
  label: 'Moderate Rainfall',
  rainfall1hMm: 4.2,
  rainfall24hMm: 31,
  windKmh: 12,
  visibilityKm: 8.4,
  simulated: false,
};

export const WEATHER_SIMULATED: WeatherConditions = {
  label: 'Heavy Rainfall',
  rainfall1hMm: 24.6,
  rainfall24hMm: 148,
  windKmh: 34,
  visibilityKm: 1.9,
  simulated: true,
};

// ---------------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------------

export const ANALYTICS_BASELINE: AnalyticsSummaryResponse = {
  deliverySuccessRatePct: 91.4,
  avgDelayMinutes: 72,
  topRiskySegments: [
    { segmentId: fixedId(ID.segment, 13), name: 'Dirang – Sela Pass', avgRisk: 72 },
    { segmentId: fixedId(ID.segment, 14), name: 'Sela Pass – Jang', avgRisk: 64 },
    { segmentId: fixedId(ID.segment, 12), name: 'Bomdila – Dirang', avgRisk: 58 },
    { segmentId: fixedId(ID.segment, 11), name: 'Tenga Valley – Bomdila', avgRisk: 51 },
    { segmentId: fixedId(ID.segment, 10), name: 'Bhalukpong – Tenga Valley', avgRisk: 43 },
  ],
  districtShortageEvents: [],
};

/** 14 days of history for the Analytics sparklines. Written out, not generated. */
export const DELIVERY_SUCCESS_HISTORY: { date: string; successRatePct: number; avgDelayMin: number }[] =
  [
    { date: daysAgo(13), successRatePct: 88.2, avgDelayMin: 94 },
    { date: daysAgo(12), successRatePct: 89.1, avgDelayMin: 88 },
    { date: daysAgo(11), successRatePct: 86.4, avgDelayMin: 102 },
    { date: daysAgo(10), successRatePct: 90.3, avgDelayMin: 81 },
    { date: daysAgo(9), successRatePct: 91.8, avgDelayMin: 76 },
    { date: daysAgo(8), successRatePct: 87.6, avgDelayMin: 97 },
    { date: daysAgo(7), successRatePct: 85.9, avgDelayMin: 111 },
    { date: daysAgo(6), successRatePct: 89.4, avgDelayMin: 86 },
    { date: daysAgo(5), successRatePct: 92.1, avgDelayMin: 69 },
    { date: daysAgo(4), successRatePct: 93.0, avgDelayMin: 64 },
    { date: daysAgo(3), successRatePct: 90.7, avgDelayMin: 78 },
    { date: daysAgo(2), successRatePct: 91.2, avgDelayMin: 74 },
    { date: daysAgo(1), successRatePct: 92.6, avgDelayMin: 68 },
    { date: hoursAgo(2), successRatePct: 91.4, avgDelayMin: 72 },
  ];

/** NE-102 falls behind once the cascade lands; every other movement is unchanged. */
export const MOVEMENTS_AFTER_RAIN: VehicleMovement[] = RECENT_MOVEMENTS.map((m) =>
  m.deliveryCode === 'NE-102'
    ? { ...m, status: 'DELAYED' as const, delayMinutes: DEMO_DELIVERY_AFTER_RAIN.addedDelayMinutes }
    : m,
);
