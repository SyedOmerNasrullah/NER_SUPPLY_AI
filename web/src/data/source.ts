/**
 * The single seam between the UI and its data.
 *
 * One interface, two implementations: `data/demo` (deterministic fixtures, Phase 2-5) and
 * `data/http` (the real Node API, Phase 6). `data/index.ts` picks one from VITE_DATA_SOURCE.
 * No component may import either implementation directly — they import hooks, which import
 * the selected source. That is what makes Phase 6 an env-var flip rather than a rewrite.
 *
 * Every method mirrors one endpoint from PROJECT_CONTRACT.md section 4, with the same request
 * body and the same response envelope. Adding a method here means adding an endpoint there.
 */

import type {
  AlertsResponse,
  AnalyticsSummaryResponse,
  CreateDeliveryRequest,
  CreateDeliveryResponse,
  DeliveriesResponse,
  DeliveryDetailResponse,
  DemoAccountsResponse,
  DistrictDetailResponse,
  DistrictsResponse,
  FieldOfficersResponse,
  IncidentsResponse,
  LoginResponse,
  MovementsResponse,
  NotificationsResponse,
  ExplainRequest,
  ExplainResponse,
  ResetDemoResponse,
  RouteComparisonResponse,
  SendSmsRequest,
  SendSmsResponse,
  RiskSegmentsResponse,
  RouteCandidatesRequest,
  RouteCandidatesResponse,
  RerouteDeliveryRequest,
  RerouteDeliveryResponse,
  SimulateRainResponse,
  SubmitIncidentResponse,
  SummaryResponse,
  VehiclesResponse,
  WarehousesResponse,
  WeatherResponse,
} from '@/domain/types';

export interface DataSource {
  /** Which implementation answered. Rendered in the StatusRail so the mode is never a guess. */
  readonly kind: 'demo' | 'http';

  // --- Auth ---------------------------------------------------------------
  login(email: string, password: string): Promise<LoginResponse>;
  /**
   * Sign-in shortcuts for the demonstration. The HTTP adapter answers with an empty list, so
   * the login page's account panel vanishes against a real backend rather than needing a
   * build flag.
   */
  getDemoAccounts(): Promise<DemoAccountsResponse>;

  // --- Fleet & field ------------------------------------------------------
  getVehicles(): Promise<VehiclesResponse>;
  getFieldOfficers(): Promise<FieldOfficersResponse>;

  // --- Deliveries ---------------------------------------------------------
  getDeliveries(): Promise<DeliveriesResponse>;
  getDeliveryById(id: string): Promise<DeliveryDetailResponse>;
  createDelivery(body: CreateDeliveryRequest): Promise<CreateDeliveryResponse>;
  /**
   * Accepts a reroute recommendation: reassigns the delivery to `routeId` and lets the decision
   * engine re-evaluate. Contract delta D14 — the endpoint does not exist yet, so this seam is
   * what Phase 4 must implement rather than the UI faking a success state.
   */
  rerouteDelivery(body: RerouteDeliveryRequest): Promise<RerouteDeliveryResponse>;

  // --- Routes -------------------------------------------------------------
  getRouteCandidates(params: RouteCandidatesRequest): Promise<RouteCandidatesResponse>;

  // --- Supply -------------------------------------------------------------
  getDistricts(): Promise<DistrictsResponse>;
  getDistrictById(id: string): Promise<DistrictDetailResponse>;
  getWarehouses(): Promise<WarehousesResponse>;

  // --- Risk ---------------------------------------------------------------
  /** Sorted by lastRiskScore desc. The wire order is what renders. */
  getRiskSegments(): Promise<RiskSegmentsResponse>;

  // --- Incidents ----------------------------------------------------------
  getIncidents(): Promise<IncidentsResponse>;
  submitIncident(form: FormData): Promise<SubmitIncidentResponse>;

  // --- Alerts -------------------------------------------------------------
  /** Sorted by severity, then recency. */
  getAlerts(): Promise<AlertsResponse>;

  // --- Conditions ---------------------------------------------------------
  getWeather(): Promise<WeatherResponse>;

  // --- Command Center ------------------------------------------------------
  /** The six headline figures with day-over-day deltas (contract delta D7). */
  getSummary(): Promise<SummaryResponse>;
  /** Latest vehicle position reports, newest first (contract delta D11). */
  getRecentMovements(): Promise<MovementsResponse>;
  /** Dispatched notifications, newest first (contract delta D16). */
  getNotifications(): Promise<NotificationsResponse>;
  /** SMS one officer about one alert (Phase 6A). Demo mode simulates; it never sends. */
  sendSms(body: SendSmsRequest): Promise<SendSmsResponse>;

  // --- Intelligence (Phase 6C) --------------------------------------------
  /** Candidate risks, deltas against the assigned route, and the safer-route verdict. */
  getRouteComparison(deliveryId?: string): Promise<RouteComparisonResponse>;
  /**
   * A sentence about numbers that already exist. Demo mode composes it locally from the same
   * figures — no network, no key — and labels it as the deterministic template.
   */
  explain(body: ExplainRequest): Promise<ExplainResponse>;

  // --- Demo controls ------------------------------------------------------
  /** Runs the whole cascade: route risk -> delivery delay -> stockout -> decision -> alert. */
  simulateRain(segmentId: string): Promise<SimulateRainResponse>;
  resetDemo(): Promise<ResetDemoResponse>;

  // --- Analytics ----------------------------------------------------------
  getAnalyticsSummary(): Promise<AnalyticsSummaryResponse>;
}

/**
 * Every failure — demo or http — surfaces as this one shape, so a page's error handling is
 * written once and keeps working across the Phase 6 swap.
 */
export class DataError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'DataError';
    this.status = status;
  }
}
