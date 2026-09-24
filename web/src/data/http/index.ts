/**
 * The HTTP DataSource — the real Node/Express API.
 *
 * Not exercised in Phase 2 (VITE_DATA_SOURCE=demo), but written now and kept compiling so that
 * Phase 6 is an env-var flip plus whatever the reconciliation turns up, not a new module.
 * Every call maps to one endpoint from PROJECT_CONTRACT.md section 4.
 *
 * Orderings the backend already guarantees (alerts by severity, segments by score) are NOT
 * re-applied here — the wire order is what renders, so a mismatch shows up as a visible bug
 * rather than being silently papered over on the client.
 */

import axios, { type AxiosInstance } from 'axios';
import type { DataSource } from '../source';
import { DataError } from '../source';
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
  ExplainRequest,
  ExplainResponse,
  NotificationsResponse,
  RouteComparisonResponse,
  PlaceCallRequest,
  PlaceCallResponse,
  SendSmsRequest,
  SendSmsResponse,
  ResetDemoResponse,
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

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4000';

/**
 * Endpoints that run the full cascade — vision classification, model inference, Twilio — take
 * far longer than a read. The previous build aborted incident submission client-side at 15 s
 * while the server was still working, which looked like a silent failure.
 */
const CASCADE_TIMEOUT_MS = 120_000;

export const http: AxiosInstance = axios.create({ baseURL: API_BASE_URL, timeout: 15_000 });

let authToken: string | null = null;

export function setAuthToken(token: string | null): void {
  authToken = token;
  if (token) http.defaults.headers.common.Authorization = `Bearer ${token}`;
  else delete http.defaults.headers.common.Authorization;
}

export const getAuthToken = (): string | null => authToken;

type StatusMessages = Record<number, string>;

/** Every backend failure is `{ error: string }` with a real status (contract section 10); a
 *  network failure has no response at all. Both become the same DataError the pages handle. */
function toDataError(err: unknown, messages?: StatusMessages): DataError {
  if (axios.isAxiosError(err)) {
    const status = err.response?.status ?? 0;
    if (status === 0) {
      return new DataError(0, 'Cannot reach the server. Check that the API is running.');
    }
    const body = err.response?.data as { error?: string } | undefined;
    return new DataError(status, messages?.[status] ?? body?.error ?? err.message);
  }
  return new DataError(0, err instanceof Error ? err.message : 'Unexpected error');
}

async function request<T>(fn: () => Promise<{ data: T }>, messages?: StatusMessages): Promise<T> {
  try {
    return (await fn()).data;
  } catch (err) {
    throw toDataError(err, messages);
  }
}

export const httpSource: DataSource = {
  kind: 'http',

  login: (email, password) =>
    request<LoginResponse>(
      () => http.post('/api/auth/login', { email: email.trim(), password }),
      { 401: 'Invalid email or password.' },
    ),

  // Deliberately not an endpoint. A real deployment has no list of shareable credentials,
  // so this resolves empty and the login page simply stops offering the shortcut panel.
  getDemoAccounts: async (): Promise<DemoAccountsResponse> => ({ accounts: [] }),

  getVehicles: () => request<VehiclesResponse>(() => http.get('/api/vehicles')),
  getFieldOfficers: () => request<FieldOfficersResponse>(() => http.get('/api/field-officers')),

  getDeliveries: () => request<DeliveriesResponse>(() => http.get('/api/deliveries')),
  getDeliveryById: (id) =>
    request<DeliveryDetailResponse>(() => http.get(`/api/deliveries/${id}`), {
      404: 'Delivery not found.',
    }),
  createDelivery: (body: CreateDeliveryRequest) =>
    request<CreateDeliveryResponse>(() => http.post('/api/deliveries', body)),

  // Contract delta D14. Runs the decision engine again server-side, so it gets the cascade
  // timeout rather than the read timeout.
  rerouteDelivery: (body: RerouteDeliveryRequest) =>
    request<RerouteDeliveryResponse>(
      () =>
        http.post(
          `/api/deliveries/${body.deliveryId}/reroute`,
          { routeId: body.routeId },
          { timeout: CASCADE_TIMEOUT_MS },
        ),
      { 404: 'Delivery not found.', 409: 'That route is no longer a candidate for this delivery.' },
    ),

  // Contract section 4: when deliveryId is supplied the backend marks the lowest-risk candidate
  // recommended and persists the assignment itself. 503 is ORS being unavailable — the contract
  // is explicit that no geometry is fabricated, so the message says so rather than rendering an
  // empty list as if it were a real "no routes found".
  getRouteCandidates: (params: RouteCandidatesRequest) =>
    request<RouteCandidatesResponse>(() => http.post('/api/routes/candidates', params), {
      503: 'Routing service unavailable — no candidate routes could be generated.',
    }),

  getDistricts: () => request<DistrictsResponse>(() => http.get('/api/districts')),
  getDistrictById: (id) =>
    request<DistrictDetailResponse>(() => http.get(`/api/districts/${id}`), {
      404: 'District not found.',
    }),
  getWarehouses: () => request<WarehousesResponse>(() => http.get('/api/warehouses')),

  getRiskSegments: () => request<RiskSegmentsResponse>(() => http.get('/api/risk/segments')),

  getIncidents: () => request<IncidentsResponse>(() => http.get('/api/incidents')),
  // No Content-Type is set deliberately: axios must generate the multipart boundary itself, and
  // the backend's multer parser needs that boundary to read the body.
  submitIncident: (form: FormData) =>
    request<SubmitIncidentResponse>(() =>
      http.post('/api/incidents', form, { timeout: CASCADE_TIMEOUT_MS }),
    ),

  getAlerts: () => request<AlertsResponse>(() => http.get('/api/alerts')),

  getWeather: () => request<WeatherResponse>(() => http.get('/api/weather')),

  getSummary: () => request<SummaryResponse>(() => http.get('/api/summary')),
  getRecentMovements: () => request<MovementsResponse>(() => http.get('/api/movements')),
  getNotifications: () => request<NotificationsResponse>(() => http.get('/api/notifications')),
  sendSms: (body: SendSmsRequest) =>
    request<SendSmsResponse>(() => http.post('/api/notifications/sms', body, { timeout: 30_000 })),
  placeCall: (body: PlaceCallRequest) =>
    request<PlaceCallResponse>(() => http.post('/api/notifications/call', body, { timeout: 30_000 })),

  getRouteComparison: (deliveryId?: string) =>
    request<RouteComparisonResponse>(() =>
      http.get('/api/routes/comparison', { params: deliveryId ? { deliveryId } : undefined }),
    ),

  // A language model is slower than a database read, and the server retries a busy one once.
  explain: (body: ExplainRequest) =>
    request<ExplainResponse>(() => http.post('/api/ai/explain', body, { timeout: 40_000 })),

  simulateRain: (segmentId) =>
    request<SimulateRainResponse>(() =>
      http.post('/api/demo/simulate-rain', { segmentId }, { timeout: CASCADE_TIMEOUT_MS }),
    ),
  resetDemo: () =>
    request<ResetDemoResponse>(() =>
      http.post('/api/demo/reset', undefined, { timeout: CASCADE_TIMEOUT_MS }),
    ),

  getAnalyticsSummary: () =>
    request<AnalyticsSummaryResponse>(() => http.get('/api/analytics/summary')),
};
