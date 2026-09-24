/**
 * Shared domain types — a transcription of PROJECT_CONTRACT.md section 3.
 *
 * This file is the frontend half of the contract with the Node API. It is edited ONLY after
 * `docs/CONTRACT_DELTAS.md` records the change and the contract itself is amended. Renaming,
 * widening or restructuring anything here without that step is exactly the drift that broke
 * the previous integration.
 *
 * Conventions the contract fixes (section 10):
 *   - `riskScore` is an integer 0-100.
 *   - `failureProbability` / `confidence` are floats 0-1. Conversion is round(p * 100).
 *   - Any risk bucket is the strict union RiskLevel, never a bare string.
 *   - Dates are ISO strings on the wire.
 *   - Every list response is `{ resourceName: [...] }`, never a bare array.
 */

// ---------------------------------------------------------------------------
// Enums / unions
// ---------------------------------------------------------------------------

export type Role = 'ADMIN' | 'LOGISTICS_OFFICER' | 'FIELD_OFFICER' | 'DISTRICT_OFFICER';
export type CargoPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type DeliveryStatus = 'PENDING' | 'IN_TRANSIT' | 'AT_RISK' | 'DELIVERED' | 'FAILED';
export type SegmentStatus = 'OPEN' | 'PARTIAL' | 'BLOCKED';
export type Severity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type VehicleStatus = 'IDLE' | 'IN_TRANSIT' | 'STOPPED';
export type BlockageLevel = 'NONE' | 'PARTIAL' | 'SEVERE';
export type SupplyCategory = 'medicine' | 'food' | 'fuel';
export type RoadCondition = 'GOOD' | 'FAIR' | 'POOR';
export type NotificationChannel = 'SMS' | 'CALL' | 'DASHBOARD';
export type NotificationStatus = 'QUEUED' | 'SENT' | 'DELIVERED' | 'FAILED';

export type IncidentType =
  | 'LANDSLIDE'
  | 'FLOOD'
  | 'DEBRIS'
  | 'DAMAGED_ROAD'
  | 'BLOCKED_ROAD'
  | 'NORMAL';

export type RecommendationType = 'REROUTE' | 'PRE_POSITION' | 'ALERT' | 'NONE';

/**
 * Where a rendered value came from. This is a UI-layer concept, not a wire field — the demo
 * adapter tags its fixtures and the http adapter derives the tag from which endpoint answered.
 * Required by the project reference: synthetic data must never be presented as a live
 * measurement.
 */
export type Provenance =
  | 'SYNTHETIC_HISTORICAL'
  | 'SYNTHETIC_OPERATIONAL'
  | 'SIMULATION_EVENT'
  | 'ML_PREDICTION'
  | 'LLM_EXPLANATION'
  | 'EXTERNAL_API';

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  phone?: string;
  districtId?: string;
}

/**
 * A vehicle behaving unlike the corridor expects. Contract delta D22.
 *
 * Contract 6.12 already defines the rule — sustained speed below 40% of expected — and §1
 * stores `speedHistory` to evaluate it. The determination belongs on the server, because the
 * same rule raises the alert; this shape is what it should return alongside the vehicle.
 */
export interface GpsAnomaly {
  /** Observed speed as a fraction of expected. Below 0.4 is the contract's threshold. */
  speedRatio: number;
  /** Distance from the assigned corridor, where a route is assigned. */
  deviationKm?: number;
  severity: Severity;
  /** Plain-language statement of what triggered it. */
  reason: string;
}

export interface Vehicle {
  id: string;
  code: string;
  driverName: string;
  currentLat: number;
  currentLng: number;
  speedKmh: number;
  expectedSpeedKmh: number;
  status: VehicleStatus;
  currentDeliveryId?: string;
  /** Nearest corridor waypoint, for the "Recent Movements" readout. */
  nearestPlace?: string;
  /** Present only when the rule actually fires. Absent means "behaving normally". */
  anomaly?: GpsAnomaly;
}

/** One SHAP contribution, normalised for display. Top factors need not sum to 100. */
export interface RiskFactor {
  factor: string;
  contributionPct: number;
}

/**
 * The physical character of a route, aggregated across the segments it covers.
 *
 * Every field already exists per-segment in contract §1 (`route_segments`); this is the
 * route-level rollup Route Intelligence needs so an operator can see *why* a corridor scores
 * the way it does without opening fifteen segment records. Contract delta D12.
 */
export interface RouteProfile {
  /** Worst condition on any segment — a route is as good as its poorest stretch. */
  roadCondition: RoadCondition;
  /** 0-3, mean across segments. */
  trafficLevel: number;
  /** Steepest gradient on the route, in degrees. */
  maxSlopeDeg: number;
  /** Highest point, in metres. */
  maxElevationM: number;
  /** Plain-language summary of the current weather load on this corridor. */
  weatherSeverity: 'CLEAR' | 'MODERATE' | 'HEAVY' | 'SEVERE';
  /** Historical disruption record for the segments this route covers. */
  history: {
    previousClosures: number;
    landslides: number;
    floods: number;
    avgClosureHours: number;
  };
}

/** One sample along a route's elevation profile. Contract delta D13. */
export interface ElevationPoint {
  distanceKm: number;
  elevationM: number;
  slopeDeg: number;
  /** Nearest named place, for axis labelling. */
  place?: string;
}

export interface RouteCandidate {
  id: string;
  name: string;
  distanceKm: number;
  etaMinutes: number;
  /** [lat, lng] pairs — app-internal order, per contract 6.2. */
  geometry: [number, number][];
  riskScore: number;
  riskLevel: RiskLevel;
  /**
   * Where `riskScore` and `topFactors` actually came from (delta D55).
   *
   * `ML_PREDICTION` — the newest stored prediction from `route-risk-xgb-v1`, with real SHAP.
   * `SEEDED`        — the fixture column, because no model prediction exists for this route.
   *
   * The UI labels these differently. Absent from a source that cannot say, which the demo
   * adapter is: it has no model and says so.
   */
  riskSource?: 'ML_PREDICTION' | 'SEEDED';
  /** Present only when `riskSource` is `ML_PREDICTION`, e.g. `route-risk-xgb-v1`. */
  modelVersion?: string;
  /** SHAP expected value: riskScore = shapBaseValue + the contributions. */
  shapBaseValue?: number;
  /** When the model produced this answer. */
  scoredAt?: string;
  isRecommended: boolean;
  /**
   * SHAP contributions for THIS candidate.
   *
   * Contract delta D8, resolved in Phase 3C: every candidate the operator can select carries
   * its own factor breakdown, not just the recommended one. Route Intelligence lets the
   * operator select A, B or C and asks "why is this route risky?" about whichever is selected;
   * a contract where only the recommendation is explainable would make two of the three
   * selections dead ends. Never empty for a scored candidate.
   */
  topFactors: RiskFactor[];
  /** Narration of `topFactors`. Also per-candidate, for the same reason. */
  explanationText: string;
  /** Contract delta D12. */
  profile?: RouteProfile;
  /** Contract delta D13. */
  elevationProfile?: ElevationPoint[];
  /**
   * The corridor segments this route actually travels, in segment order. Contract delta D39.
   * Absent when the source cannot say — never an empty list standing in for "unknown".
   */
  segmentIds?: string[];
}

export interface Delivery {
  id: string;
  code: string;
  cargoType: string;
  priority: CargoPriority;
  originLat: number;
  originLng: number;
  destLat: number;
  destLng: number;
  originName?: string;
  destName?: string;
  /** Units of cargo carried. Contract delta D15. */
  cargoUnits?: number;
  /** The district the destination sits in, so Delivery Intelligence can show supply impact
   *  without reverse-geocoding on the client. Contract delta D15. */
  destDistrictId?: string;
  assignedVehicleId?: string;
  assignedRouteId?: string;
  requiredEta: string;
  currentEta: string;
  failureProbability?: number;
  expectedDelayMinutes?: number;
  status: DeliveryStatus;
}

export interface RouteSegment {
  id: string;
  code: string;
  name: string;
  /**
   * The route that owns this segment — delta D50. Exactly one: two routes running over the same
   * tarmac still get their own rows, because their risk state has to move independently.
   * Absent on a database seeded before route generation ran.
   */
  routeId?: string;
  /** Position along its route, 1-based. */
  sequence?: number;
  /** Road distance of this leg, km. */
  distanceKm?: number;
  startLat: number;
  startLng: number;
  endLat: number;
  endLng: number;
  currentStatus: SegmentStatus;
  lastRiskScore: number;
  lastRiskFactors?: RiskFactor[];
}

export interface StockLine {
  currentStock: number;
  dailyConsumption: number;
  predictedStockoutHours: number | null;
}

/**
 * How a district's stock projection was arrived at. Contract delta D17.
 *
 * `StockLine.predictedStockoutHours` gives the answer but not the reasoning, and Supply
 * Intelligence has to show the reasoning: this is the panel that carries the product's core
 * argument — a delayed truck becomes a hospital running out of medicine. Without the baseline
 * and the drag, the page can only assert the 32 hours; with them it can show the subtraction.
 */
export interface SupplyProjection {
  category: SupplyCategory;
  currentStock: number;
  dailyConsumption: number;
  /** Projection assuming the inbound delivery arrives as originally scheduled. */
  baselineStockoutHours: number | null;
  /** Projection including the delay currently predicted on that delivery. */
  adjustedStockoutHours: number | null;
  /** Hours removed from the runway by the disruption: baseline - adjusted. */
  disruptionHours: number;
  /** The inbound delivery this projection depends on, when there is one. */
  inboundDeliveryCode?: string;
  inboundDeliveryId?: string;
  /** Minutes that delivery is predicted to run late. */
  inboundDelayMinutes?: number;
}

export interface District {
  id: string;
  name: string;
  lat: number;
  lng: number;
  stock: Record<SupplyCategory, StockLine>;
}

export interface Warehouse {
  id: string;
  name: string;
  lat: number;
  lng: number;
}

export interface Incident {
  id: string;
  type: IncidentType;
  severity: Severity;
  description?: string;
  /**
   * The corridor segment this incident sits on. Contract delta D18 — the column already exists
   * in §1's `incidents` table; exposing it means the Incident Center can show route impact
   * without the client re-deriving it from coordinates.
   */
  segmentId?: string;
  /** Human label for that segment, so a list row does not need a second lookup. */
  segmentName?: string;
  imageUrl?: string;
  cvDetectedClass?: string;
  cvConfidence?: number;
  cvEstimatedBlockage?: BlockageLevel;
  /**
   * The candidate route this incident sits on, when it sits on one — delta D49.
   *
   * Separate from `segmentId`, and not a fallback for it. The stored corridor segments describe
   * Route A only, so a report on the stretch that only Route B travels legitimately matches no
   * segment while still being on a road the system runs. Absent means the point is off every
   * corridor, which is a real state and not an error.
   */
  routeImpact?: {
    routeId: string;
    name: string;
    distanceKm: number;
    riskScore: number;
    riskLevel: RiskLevel;
  };
  lat: number;
  lng: number;
  createdAt: string;
}

export interface AIRecommendation {
  id: string;
  type: RecommendationType;
  targetType: 'DELIVERY' | 'DISTRICT' | 'ROUTE';
  targetId: string;
  recommendationText: string;
  /** 0-1. The UI formats the percentage; the backend never pre-formats. */
  confidence: number;
}

/**
 * One branch of the Master Decision Engine, as evaluated. Contract delta D21.
 *
 * The engine is a documented if/else ladder (project reference §4.3) and its defensibility is
 * the whole reason it is not an LLM. Returning the branches it actually walked lets the UI show
 * the reasoning — inputs, the rule, the outcome — instead of asserting a recommendation and
 * asking the operator to trust it.
 */
export interface DecisionBranch {
  id: string;
  /** The rule, as written: "Route risk >= 70 and a lower-risk candidate exists". */
  condition: string;
  /** What the inputs actually were: "87, Route B at 32". */
  observed: string;
  matched: boolean;
  /** What this branch fires when it matches. */
  action: RecommendationType;
}

export interface DecisionTrace {
  /** Evaluated in order; first match wins. */
  branches: DecisionBranch[];
  outcome: RecommendationType;
  /** 0-1, the confidence of whichever prediction drove the matched branch. */
  confidence: number;
}

export interface Alert {
  id: string;
  severity: Severity;
  title: string;
  message: string;
  notifiedViaTwilio: boolean;
  createdAt: string;
  /**
   * What the alert is about. Contract delta D18 — §1's `alerts.relatedEntityId` exists but is
   * not exposed, so today an incident page can only match alerts by reading their prose.
   */
  relatedType?: 'DELIVERY' | 'DISTRICT' | 'SEGMENT' | 'INCIDENT';
  relatedId?: string;
}

/**
 * One dispatched notification. Contract §1 already has a `notifications` table; this exposes it
 * so the UI can report what was actually sent rather than inferring it from a boolean.
 * Contract delta D16.
 */
export interface NotificationRecord {
  id: string;
  alertId: string;
  alertTitle: string;
  channel: NotificationChannel;
  status: NotificationStatus;
  recipientName: string;
  recipientRole: Role;
  recipientPhone?: string;
  /** Present when the provider rejected the send. */
  failureReason?: string;
  sentAt: string;
  /** The delivery or district this notification concerns. */
  relatedId?: string;
}

export interface FieldOfficer {
  id: string;
  name: string;
  phone?: string;
  districtId?: string;
  status: 'ACTIVE' | 'OFFLINE';
}

/**
 * One vehicle's latest position report, as shown in the Command Center's movements feed.
 * `place` is the nearest seeded corridor town, resolved server-side (contract delta D6).
 */
export interface VehicleMovement {
  id: string;
  vehicleCode: string;
  deliveryCode: string;
  place: string;
  status: 'ON_ROUTE' | 'DELAYED' | 'STOPPED';
  /** Minutes behind the required arrival. Absent when the delivery is running to plan. */
  delayMinutes?: number;
}

/**
 * The Command Center's headline figures (contract delta D7).
 *
 * Every one is derivable from the list endpoints, but computing them client-side means six
 * list fetches to render six numbers, and the day-over-day deltas need yesterday's values that
 * the client does not have.
 */
export interface OperationalSummary {
  activeDeliveries: { value: number; deltaPct: number; atRisk: number };
  atRiskDeliveries: { value: number; deltaPct: number; critical: number };
  roadBlockages: { value: number; major: number; minor: number };
  criticalSupplyAlerts: { value: number; districts: number };
  fieldOfficers: { active: number; total: number };
  averageDelayMinutes: { value: number; deltaPct: number };
}

/** Current corridor weather, as shown in the Command Center hero band. */
export interface WeatherConditions {
  label: string;
  rainfall1hMm: number;
  rainfall24hMm: number;
  windKmh: number;
  visibilityKm: number;
  /** True once the simulate-rainfall control has overwritten the inputs. */
  simulated: boolean;
}

// ---------------------------------------------------------------------------
// Request / response envelopes (contract section 4)
// ---------------------------------------------------------------------------

export interface LoginRequest {
  email: string;
  password: string;
}
export interface LoginResponse {
  token: string;
  user: User;
}

/**
 * The demo accounts the login page offers as one-click fills.
 *
 * A demonstration affordance, not part of the production API: the HTTP adapter returns an empty
 * list, so the panel disappears the moment the app is pointed at a real backend. Listing
 * credentials is only acceptable because these are published demo accounts on a seeded
 * database — the shape deliberately makes it impossible to reuse for anything else.
 */
export interface DemoAccount {
  email: string;
  role: Role;
  name: string;
}

export interface DemoAccountsResponse {
  accounts: DemoAccount[];
  /** The shared demo password, or undefined when the source has no such concept. */
  password?: string;
}

export interface VehiclesResponse {
  vehicles: Vehicle[];
}
export interface FieldOfficersResponse {
  officers: FieldOfficer[];
}
export interface DeliveriesResponse {
  deliveries: Delivery[];
}
export interface DeliveryDetailResponse {
  delivery: Delivery;
  recommendation?: AIRecommendation;
  /** Contract delta D21 — how the engine reached that recommendation. */
  decision?: DecisionTrace;
}

export interface CreateDeliveryRequest {
  cargoType: string;
  priority: CargoPriority;
  originLat: number;
  originLng: number;
  destLat: number;
  destLng: number;
  requiredEta: string;
}
export interface CreateDeliveryResponse {
  delivery: Delivery;
}

export interface RouteCandidatesRequest {
  originLat: number;
  originLng: number;
  destLat: number;
  destLng: number;
  cargoPriority: CargoPriority;
  deliveryId?: string;
}
export interface RouteCandidatesResponse {
  candidates: RouteCandidate[];
}

export interface DistrictsResponse {
  districts: District[];
}
export interface DistrictDetailResponse {
  district: District;
  recommendation?: AIRecommendation;
  /** Contract delta D17 — one per supply category. */
  projections?: SupplyProjection[];
  /** Contract delta D21. */
  decision?: DecisionTrace;
}
export interface WarehousesResponse {
  warehouses: Warehouse[];
}

/** Sorted by lastRiskScore desc — the wire order is what renders. */
export interface RiskSegmentsResponse {
  segments: RouteSegment[];
}

/**
 * How a reported incident was tied to a corridor segment. Delta D36. `null` means no segment was
 * within 5 km of the reported point — the incident is still stored at exactly that point, just
 * not attributed to the corridor.
 */
export interface SegmentMatch {
  segmentId: string;
  code: string;
  name: string;
  distanceKm: number;
}

export interface IncidentRouteMatch {
  routeId: string;
  name: string;
  distanceKm: number;
  riskScore: number;
  riskLevel: RiskLevel;
}

export interface SubmitIncidentResponse {
  incident: Incident;
  cascadeTriggered: boolean;
  /** Delta D36. Optional so an older server that omits it still satisfies the type. */
  segmentMatch?: SegmentMatch | null;
  /** Delta D49 — the corridor the point lies on, independent of segment matching. */
  routeMatch?: IncidentRouteMatch | null;
}
export interface IncidentsResponse {
  incidents: Incident[];
}

/** Sorted by severity, then recency. */
export interface AlertsResponse {
  alerts: Alert[];
}

export interface SimulateRainResponse {
  updated: true;
  affectedSegmentIds: string[];
}
export interface ResetDemoResponse {
  reset: true;
}
export interface WeatherResponse {
  weather: WeatherConditions;
}
export interface SummaryResponse {
  summary: OperationalSummary;
}
export interface MovementsResponse {
  movements: VehicleMovement[];
}
export interface NotificationsResponse {
  notifications: NotificationRecord[];
}


/**
 * Phase 6C — a natural-language explanation of numbers the models already produced.
 *
 * The figures travel WITH the sentence so a reader can check the words against the data, and
 * `provenance` says where each half came from: the numbers are a model prediction or a demo
 * value, the words are Gemini or the deterministic template. They are never conflated.
 */
export interface ExplainRequest {
  kind: 'ROUTE' | 'DELIVERY' | 'DECISION';
  targetId: string;
}
export interface ExplainResponse {
  kind: ExplainRequest['kind'];
  subject: string;
  figures: Record<string, number | string>;
  factors: { factor: string; contributionPct: number; direction?: string }[];
  explanation: {
    text: string;
    source: 'LLM_EXPLANATION' | 'DETERMINISTIC_TEMPLATE';
    model: string | null;
    cached: boolean;
    fallbackReason?: string;
  };
  provenance: {
    figures: 'ML_PREDICTION' | 'DETERMINISTIC_DEMO';
    modelVersion: string | null;
    explanation: 'LLM_EXPLANATION' | 'DETERMINISTIC_TEMPLATE';
  };
}

/** Phase 6C — every candidate's own risk, and how it compares with the route in use. */
export interface RouteComparisonCandidate {
  routeId: string;
  name: string;
  riskScore: number;
  riskLevel: RiskLevel;
  etaMinutes: number;
  distanceKm: number;
  segmentIds: string[];
  isAssigned: boolean;
  isRecommended: boolean;
  /** assignedRisk - thisRisk. Positive means safer than the route in use. */
  riskDelta: number | null;
  clearsSaferMargin: boolean;
  source: 'ML_PREDICTION' | 'DETERMINISTIC_DEMO';
  modelVersion: string | null;
  predictedAt: string | null;
  topFactors: RiskFactor[];
}
export interface RouteComparisonResponse {
  comparison: {
    deliveryId: string | null;
    deliveryCode: string | null;
    assignedRouteId: string | null;
    assignedRisk: number | null;
    assignedAtOrAboveThreshold: boolean;
    thresholds: { rerouteRisk: number; saferMargin: number };
    candidates: RouteComparisonCandidate[];
    saferCandidateId: string | null;
    rerouteAdvised: boolean;
  };
}

/**
 * Phase 6A — SMS one officer about one alert. The browser names both; the server reads the
 * officer's phone and builds the text from the alert. There is deliberately no phone or message
 * field here.
 */
/**
 * Whether the model service is actually answering — delta D55.
 *
 * The status rail used to infer this from the data source alone, so it announced
 * `route-risk-xgb-v1` in API mode whether or not the service was reachable, and "not connected"
 * in demo mode without distinguishing "no model here" from "the model is down". This is the
 * real answer, from `GET /api/ml/status`.
 */
export interface MlStatus {
  /** `demo` — this build has no model service at all. `live` — one is configured. */
  mode: 'demo' | 'live';
  /** Null in demo mode. */
  service: {
    reachable: boolean;
    status?: string;
    modelVersion?: string;
    modelLoaded?: boolean;
    deliveryModelVersion?: string;
    deliveryModelLoaded?: boolean;
    /** Why it could not be reached, when it could not. */
    reason?: string;
  } | null;
}

export interface SendSmsRequest {
  officerId: string;
  alertId: string;
}

/** A voice call carries the same two ids: the browser never names a number or writes the words. */
export type PlaceCallRequest = SendSmsRequest;

export interface PlaceCallResponse {
  notification: NotificationRecord;
  duplicate?: boolean;
  call: {
    /** Twilio's call SID. Absent when simulated. */
    sid?: string;
    providerStatus: string;
    /** Masked destination, e.g. `+91••••••••74`. */
    to: string;
    redirected: boolean;
    /** What the officer hears, composed server-side from the alert. */
    script: string;
    /** True in demo mode: nothing left the browser, no call was placed. */
    simulated?: boolean;
  };
}
export interface SendSmsResponse {
  notification: NotificationRecord;
  /**
   * True when the server recognised this as the same alert to the same officer on the same
   * channel it already handled, and did NOT contact Twilio again. Nothing new was sent.
   */
  duplicate?: boolean;
  sms: {
    /** Twilio's message SID. Absent when simulated. */
    sid?: string;
    providerStatus: string;
    /** Masked destination, e.g. `+91••••••••74`. */
    to: string;
    /** True when the server's configured override received it instead of the officer. */
    redirected: boolean;
    body: string;
    /** True in demo mode: nothing left the browser, no SMS was sent. */
    simulated?: boolean;
  };
}

/** Contract delta D14 — accepting a reroute recommendation. */
export interface RerouteDeliveryRequest {
  deliveryId: string;
  routeId: string;
}
export interface RerouteDeliveryResponse {
  delivery: Delivery;
  /** The recommendation that remains outstanding, if any. */
  recommendation?: AIRecommendation;
}

/** One day of recorded network performance. Contract delta D20. */
export interface AnalyticsHistoryPoint {
  date: string;
  successRatePct: number;
  avgDelayMin: number;
}

export interface AnalyticsSummaryResponse {
  deliverySuccessRatePct: number;
  avgDelayMinutes: number;
  topRiskySegments: { segmentId: string; name: string; avgRisk: number }[];
  districtShortageEvents: { districtId: string; name: string; count: number }[];
  /**
   * Recorded daily performance. Contract delta D20 — the Analytics page needs a real series to
   * chart, and `risk_predictions` / `ai_recommendations` are already append-only logs, so this
   * is an aggregation over data the system keeps rather than a new store.
   *
   * Absent means "no history recorded", which the UI must render as a labelled snapshot rather
   * than an empty chart.
   */
  history?: AnalyticsHistoryPoint[];
}
