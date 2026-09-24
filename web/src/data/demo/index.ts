/**
 * The demo DataSource — deterministic fixtures plus a working cascade.
 *
 * Every method returns exactly the envelope PROJECT_CONTRACT.md section 4 specifies, including
 * the orderings the backend guarantees, so a page written against this adapter needs no changes
 * when Phase 6 swaps in `data/http`.
 *
 * Latency is deliberate and fixed. Reads settle in ~180 ms so skeletons are exercised rather
 * than flashing; the cascade takes ~1.4 s because the real one genuinely does that work, and a
 * button that resolves instantly here would hide a pending state that matters later.
 */

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
  NotificationRecord,
  NotificationsResponse,
  RouteComparisonResponse,
  ResetDemoResponse,
  PlaceCallRequest,
  PlaceCallResponse,
  SendSmsRequest,
  SendSmsResponse,
  RiskSegmentsResponse,
  RouteCandidatesRequest,
  RouteCandidatesResponse,
  RerouteDeliveryRequest,
  RerouteDeliveryResponse,
  SimulateRainResponse,
  SegmentMatch,
  SubmitIncidentResponse,
  SummaryResponse,
  VehiclesResponse,
  WarehousesResponse,
  WeatherResponse,
} from '@/domain/types';
import { minutesAhead } from './clock';
import {
  MAX_ROUTE_DISTANCE_KM,
  MAX_SEGMENT_DISTANCE_KM,
  distanceToPathKm,
  distanceToSegmentKm,
} from '@/domain/geo';
import {
  DEMO_PASSWORD,
  FIELD_OFFICERS,
  INCIDENTS,
  USERS,
  WAREHOUSES,
} from './fixtures';
import {
  analyticsHistory,
  applyReroute,
  currentRouteCandidates,
  getWorld,
  resetWorld,
  decisionTraceForDelivery,
  projectionsForDistrict,
  runRainCascade,
  sortedAlerts,
  deriveSummary,
  sortedSegments,
  vehiclesWithAnomalies,
} from './world';

/** Simulated SMS in this session — a counter, so ids are deterministic. */
let simulatedSmsCount = 0;

/**
 * What the officer would hear, mirroring the server's `composeAlertCall`. Demo mode cannot
 * import the server module, so the shape is repeated here — and nothing is invented: it reads
 * the alert row and nothing else.
 */
function demoCallScript(alert: { severity: string; title: string; message: string }): string {
  const speak = (t: string) => t.replace(/[\u2013\u2014]/g, ' to ').replace(/\s+/g, ' ').trim();
  return [
    'This is an N E R Supply A I alert.',
    `${alert.severity.toLowerCase()} severity.`,
    `${speak(alert.title.replace(/\.$/, ''))}.`,
    speak(alert.message),
    'Please check the N E R Supply A I dashboard for operational impact and recommended response.',
  ].join(' ');
}

let simulatedCallCount = 0;

/**
 * The Decision Engine's own thresholds, mirrored from PROJECT_CONTRACT §6. The demo adapter runs
 * in the browser and cannot import the server module that owns them, so they are repeated here
 * with this note rather than silently re-invented.
 */
const REROUTE_RISK_THRESHOLD = 70;
const SAFER_ROUTE_MARGIN = 15;

const READ_MS = 180;
const CASCADE_MS = 1_400;

const delay = <T>(value: T, ms = READ_MS): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(value), ms));

/**
 * Deep copy, so a caller mutating a response cannot reach back into the world.
 *
 * The undefined guard is load-bearing: `JSON.stringify(undefined)` returns the VALUE undefined
 * rather than a string, and `JSON.parse(undefined)` then throws a SyntaxError. Optional fields
 * like an absent recommendation are the normal case, so without this every endpoint that can
 * return one blows up exactly when there is nothing to report.
 */
const clone = <T>(value: T): T =>
  value === undefined ? (undefined as T) : (JSON.parse(JSON.stringify(value)) as T);

/** Incidents submitted during the session, newest first, ahead of the seeded ones. */
const submitted: typeof INCIDENTS = [];
let submittedCount = 0;

export const demoSource: DataSource = {
  kind: 'demo',

  // --- Auth ---------------------------------------------------------------

  async login(email, password): Promise<LoginResponse> {
    const user = USERS.find((u) => u.email.toLowerCase() === email.trim().toLowerCase());
    if (!user || password !== DEMO_PASSWORD) {
      await delay(null, 320);
      throw new DataError(401, 'Invalid email or password.');
    }
    // Not a security boundary — a demo-mode stand-in for the JWT the API will issue. Real
    // authentication arrives with the backend in Phase 6; nothing here is validated.
    return delay({ token: `demo.${user.id}`, user: clone(user) }, 420);
  },

  async getDemoAccounts(): Promise<DemoAccountsResponse> {
    return delay({
      accounts: USERS.map((u) => ({ email: u.email, role: u.role, name: u.name })),
      password: DEMO_PASSWORD,
    });
  },

  // --- Fleet & field ------------------------------------------------------

  async getVehicles(): Promise<VehiclesResponse> {
    // Anomaly determination belongs to the server (contract 6.12), so the demo makes it here
    // rather than leaving every page to re-derive it.
    return delay({ vehicles: vehiclesWithAnomalies() });
  },

  async getFieldOfficers(): Promise<FieldOfficersResponse> {
    return delay({ officers: clone(FIELD_OFFICERS) });
  },

  // --- Deliveries ---------------------------------------------------------

  async getDeliveries(): Promise<DeliveriesResponse> {
    return delay({ deliveries: clone(getWorld().deliveries) });
  },

  async getDeliveryById(id): Promise<DeliveryDetailResponse> {
    const world = getWorld();
    const delivery = world.deliveries.find((d) => d.id === id || d.code === id);
    if (!delivery) throw new DataError(404, 'Delivery not found.');
    const recommendation = world.recommendations.find(
      (r) => r.targetType === 'DELIVERY' && r.targetId === delivery.id,
    );
    return delay({
      delivery: clone(delivery),
      recommendation: clone(recommendation),
      decision: decisionTraceForDelivery(delivery.id),
    });
  },

  async createDelivery(body: CreateDeliveryRequest): Promise<CreateDeliveryResponse> {
    const world = getWorld();
    const n = world.deliveries.length + 1;
    const delivery = {
      id: `1000000-0000-4000-8000-${String(900 + n).padStart(12, '0')}`,
      code: `NE-${200 + n}`,
      cargoType: body.cargoType,
      priority: body.priority,
      originLat: body.originLat,
      originLng: body.originLng,
      destLat: body.destLat,
      destLng: body.destLng,
      requiredEta: body.requiredEta,
      currentEta: minutesAhead(340),
      status: 'PENDING' as const,
    };
    world.deliveries = [delivery, ...world.deliveries];
    return delay({ delivery: clone(delivery) }, 480);
  },

  async rerouteDelivery(body: RerouteDeliveryRequest): Promise<RerouteDeliveryResponse> {
    const delivery = applyReroute(body.deliveryId, body.routeId);
    if (!delivery) {
      await delay(null, 300);
      throw new DataError(409, 'That route is no longer a candidate for this delivery.');
    }
    const recommendation = getWorld().recommendations.find(
      (r) => r.targetType === 'DELIVERY' && r.targetId === delivery.id,
    );
    // Slower than a read: the real endpoint re-runs the decision engine before answering.
    return delay({ delivery: clone(delivery), recommendation: clone(recommendation) }, 900);
  },

  // --- Routes -------------------------------------------------------------

  async getRouteCandidates(_params: RouteCandidatesRequest): Promise<RouteCandidatesResponse> {
    return delay({ candidates: currentRouteCandidates() }, 520);
  },

  // --- Supply -------------------------------------------------------------

  async getDistricts(): Promise<DistrictsResponse> {
    return delay({ districts: clone(getWorld().districts) });
  },

  async getDistrictById(id): Promise<DistrictDetailResponse> {
    const world = getWorld();
    const district = world.districts.find((d) => d.id === id);
    if (!district) throw new DataError(404, 'District not found.');
    const recommendation = world.recommendations.find(
      (r) => r.targetType === 'DISTRICT' && r.targetId === district.id,
    );
    return delay({
      district: clone(district),
      recommendation: clone(recommendation),
      projections: projectionsForDistrict(district.id),
      decision: undefined,
    });
  },

  async getWarehouses(): Promise<WarehousesResponse> {
    return delay({ warehouses: clone(WAREHOUSES) });
  },

  // --- Risk ---------------------------------------------------------------

  async getRiskSegments(): Promise<RiskSegmentsResponse> {
    return delay({ segments: sortedSegments() });
  },

  // --- Incidents ----------------------------------------------------------

  async getIncidents(): Promise<IncidentsResponse> {
    return delay({ incidents: [...clone(submitted), ...clone(INCIDENTS)] });
  },

  async submitIncident(form: FormData): Promise<SubmitIncidentResponse> {
    const type = (form.get('type') as string | null) ?? 'LANDSLIDE';
    const severity = (form.get('severity') as string | null) ?? 'HIGH';
    const lat = Number(form.get('lat'));
    const lng = Number(form.get('lng'));

    // The same validation the API applies, so demo mode cannot accept a report the real
    // backend would reject. There is deliberately no default location: a report without one
    // used to land on a hardcoded point in Bhalukpong, on top of an existing marker.
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
      throw new DataError(400, 'lat: must be a latitude between -90 and 90.');
    }
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
      throw new DataError(400, 'lng: must be a longitude between -180 and 180.');
    }

    // Nearest corridor segment within 5 km, by the same method as api/src/domain/geo.ts.
    let segmentMatch: SegmentMatch | null = null;
    for (const seg of getWorld().segments) {
      const d = distanceToSegmentKm([lat, lng], [seg.startLat, seg.startLng], [seg.endLat, seg.endLng]);
      if (!segmentMatch || d < segmentMatch.distanceKm) {
        segmentMatch = { segmentId: seg.id, code: seg.code, name: seg.name, distanceKm: d };
      }
    }
    if (segmentMatch && segmentMatch.distanceKm > MAX_SEGMENT_DISTANCE_KM) segmentMatch = null;
    if (segmentMatch) segmentMatch = { ...segmentMatch, distanceKm: Number(segmentMatch.distanceKm.toFixed(2)) };

    // Which candidate route the point lies on, by the same rule the API applies (delta D49).
    // A point can be on Route B's own stretch and 25 km from every stored segment; reporting
    // only "unmatched" there told the operator less than the data knows.
    let routeMatch: SubmitIncidentResponse['routeMatch'] = null;
    for (const candidate of currentRouteCandidates()) {
      const d = distanceToPathKm([lat, lng], candidate.geometry);
      if (!routeMatch || d < routeMatch.distanceKm) {
        routeMatch = {
          routeId: candidate.id,
          name: candidate.name.split('—')[0].trim(),
          distanceKm: d,
          riskScore: candidate.riskScore,
          riskLevel: candidate.riskLevel,
        };
      }
    }
    if (routeMatch && routeMatch.distanceKm > MAX_ROUTE_DISTANCE_KM) routeMatch = null;
    if (routeMatch) routeMatch = { ...routeMatch, distanceKm: Number(routeMatch.distanceKm.toFixed(2)) };

    submittedCount += 1;
    const incident = {
      id: `4000000-0000-4000-8000-${String(900 + submittedCount).padStart(12, '0')}`,
      type: type as (typeof INCIDENTS)[number]['type'],
      severity: severity as (typeof INCIDENTS)[number]['severity'],
      description: (form.get('description') as string | null) || undefined,
      segmentId: segmentMatch?.segmentId,
      segmentName: segmentMatch?.name,
      // Mirrors the real vision classifier's structured output. In demo mode the class agrees
      // with the reporter's own selection; the live Gemini call may disagree, and the contract
      // is explicit that it never overwrites `type`.
      cvDetectedClass: type.toLowerCase().replace('_', ' '),
      cvConfidence: 0.89,
      cvEstimatedBlockage: severity === 'CRITICAL' ? ('SEVERE' as const) : ('PARTIAL' as const),
      lat,
      lng,
      routeImpact: routeMatch ?? undefined,
      createdAt: minutesAhead(0),
    };
    submitted.unshift(incident);

    // A high-severity report ON the corridor triggers the same cascade simulated rainfall does.
    // Off the corridor it triggers nothing — the same rule the API enforces.
    const cascadeTriggered = (severity === 'HIGH' || severity === 'CRITICAL') && segmentMatch !== null;
    if (cascadeTriggered && segmentMatch) runRainCascade(segmentMatch.segmentId);

    return delay({ incident: clone(incident), cascadeTriggered, segmentMatch }, CASCADE_MS);
  },

  // --- Alerts -------------------------------------------------------------

  async getAlerts(): Promise<AlertsResponse> {
    return delay({ alerts: sortedAlerts() });
  },

  // --- Conditions ---------------------------------------------------------

  async getWeather(): Promise<WeatherResponse> {
    return delay({ weather: clone(getWorld().weather) });
  },

  // --- Command Center ------------------------------------------------------

  async getSummary(): Promise<SummaryResponse> {
    return delay({ summary: deriveSummary() });
  },

  async getRecentMovements(): Promise<MovementsResponse> {
    return delay({ movements: clone(getWorld().movements) });
  },

  async getNotifications(): Promise<NotificationsResponse> {
    return delay({ notifications: clone(getWorld().notifications) });
  },

  /**
   * Simulated, and says so. Demo mode has no server and no Twilio, so nothing is sent: the
   * notification is logged as SENT with `simulated: true`, and the same checks the API makes
   * (officer exists, has a valid phone) still apply, so the flow behaves the same.
   */
  async sendSms(body: SendSmsRequest): Promise<SendSmsResponse> {
    const world = getWorld();
    const officer = FIELD_OFFICERS.find((o) => o.id === body.officerId);
    const alert = world.alerts.find((a) => a.id === body.alertId);
    if (!officer) throw new DataError(404, 'Officer not found.');
    if (!alert) throw new DataError(404, 'Alert not found.');
    const phone = officer.phone?.replace(/[\s\-().]/g, '');
    if (!phone || !/^\+[1-9]\d{7,14}$/.test(phone)) {
      throw new DataError(422, `${officer.name} has no valid phone number on file.`);
    }
    simulatedSmsCount += 1;
    const masked = `${phone.slice(0, 3)}${'•'.repeat(phone.length - 5)}${phone.slice(-2)}`;
    const notification: NotificationRecord = {
      id: `demo-sms-${simulatedSmsCount}`,
      alertId: alert.id,
      alertTitle: alert.title,
      channel: 'SMS',
      status: 'SENT',
      recipientName: officer.name,
      recipientRole: 'FIELD_OFFICER',
      recipientPhone: masked,
      sentAt: minutesAhead(0),
      relatedId: alert.relatedId,
    };
    world.notifications = [notification, ...world.notifications];
    return delay(
      {
        notification: clone(notification),
        sms: {
          providerStatus: 'simulated',
          to: masked,
          redirected: false,
          body: `NER-SupplyAI ${alert.severity} ALERT: ${alert.title}. Check the NER-SupplyAI dashboard.`,
          simulated: true,
        },
      },
      600,
    );
  },

  /**
   * Simulated, and says so — the voice half of the same story as `sendSms`.
   *
   * Demo mode has no server and no Twilio, so no phone rings. The same checks the API makes
   * (officer exists, alert exists, the number on file is usable) still run, and the row is
   * logged on the CALL channel, so the flow and the notification log behave the same.
   */
  async placeCall(body: PlaceCallRequest): Promise<PlaceCallResponse> {
    const world = getWorld();
    const officer = FIELD_OFFICERS.find((o) => o.id === body.officerId);
    const alert = world.alerts.find((a) => a.id === body.alertId);
    if (!officer) throw new DataError(404, 'Officer not found.');
    if (!alert) throw new DataError(404, 'Alert not found.');
    const phone = officer.phone?.replace(/[\s\-().]/g, '');
    if (!phone || !/^\+[1-9]\d{7,14}$/.test(phone)) {
      throw new DataError(422, `${officer.name} has no valid phone number on file.`);
    }

    // The same idempotency the API enforces, so a double-click behaves the same in a rehearsal
    // as it does against the real server: one alert to one officer on one channel, once.
    const already = world.notifications.find(
      (n) => n.alertId === alert.id && n.channel === 'CALL' && n.recipientName === officer.name,
    );
    if (already) {
      return delay(
        {
          notification: clone(already),
          duplicate: true,
          call: {
            providerStatus: 'simulated',
            to: already.recipientPhone ?? '',
            redirected: false,
            script: demoCallScript(alert),
            simulated: true,
          },
        },
        300,
      );
    }

    simulatedCallCount += 1;
    const masked = `${phone.slice(0, 3)}${'•'.repeat(phone.length - 5)}${phone.slice(-2)}`;
    const notification: NotificationRecord = {
      id: `demo-call-${simulatedCallCount}`,
      alertId: alert.id,
      alertTitle: alert.title,
      channel: 'CALL',
      status: 'SENT',
      recipientName: officer.name,
      recipientRole: 'FIELD_OFFICER',
      recipientPhone: masked,
      sentAt: minutesAhead(0),
      relatedId: alert.relatedId,
    };
    world.notifications = [notification, ...world.notifications];
    return delay(
      {
        notification: clone(notification),
        duplicate: false,
        call: {
          providerStatus: 'simulated',
          to: masked,
          redirected: false,
          script: demoCallScript(alert),
          simulated: true,
        },
      },
      600,
    );
  },


  // --- Intelligence (Phase 6C) ---------------------------------------------

  /**
   * The same comparison the API computes, over the demo world. The margin and the threshold are
   * the contract's own (15 points, 70), repeated here only because the demo adapter cannot
   * import the server's decision module.
   */
  async getRouteComparison(deliveryId?: string): Promise<RouteComparisonResponse> {
    const world = getWorld();
    const candidates = currentRouteCandidates();
    const delivery = deliveryId
      ? world.deliveries.find((d) => d.id === deliveryId || d.code === deliveryId)
      : undefined;
    const assigned = candidates.find((c) => c.id === delivery?.assignedRouteId);
    const assignedRisk = assigned?.riskScore ?? null;

    const rows = candidates.map((c) => {
      const delta = assignedRisk === null || c.id === assigned?.id ? null : assignedRisk - c.riskScore;
      return {
        routeId: c.id,
        name: c.name.split('—')[0].trim(),
        riskScore: c.riskScore,
        riskLevel: c.riskLevel,
        etaMinutes: c.etaMinutes,
        distanceKm: c.distanceKm,
        segmentIds: c.segmentIds ?? [],
        isAssigned: c.id === assigned?.id,
        isRecommended: c.isRecommended,
        riskDelta: delta,
        clearsSaferMargin: delta !== null && delta >= SAFER_ROUTE_MARGIN,
        source: 'DETERMINISTIC_DEMO' as const,
        modelVersion: null,
        predictedAt: null,
        topFactors: clone(c.topFactors),
      };
    });
    const safer = rows.filter((r) => r.clearsSaferMargin).sort((a, b) => a.riskScore - b.riskScore)[0];

    return delay({
      comparison: {
        deliveryId: delivery?.id ?? null,
        deliveryCode: delivery?.code ?? null,
        assignedRouteId: assigned?.id ?? null,
        assignedRisk,
        assignedAtOrAboveThreshold: assignedRisk !== null && assignedRisk >= REROUTE_RISK_THRESHOLD,
        thresholds: { rerouteRisk: REROUTE_RISK_THRESHOLD, saferMargin: SAFER_ROUTE_MARGIN },
        candidates: rows,
        saferCandidateId: safer?.routeId ?? null,
        rerouteAdvised: assignedRisk !== null && assignedRisk >= REROUTE_RISK_THRESHOLD && Boolean(safer),
      },
    });
  },

  /**
   * Demo mode never calls a language model — there is no server and no key — so the sentence is
   * composed from the same figures and labelled DETERMINISTIC_TEMPLATE. That label is the point:
   * the interface shows exactly what produced the words, and in demo mode it was not an AI.
   */
  async explain(body: ExplainRequest): Promise<ExplainResponse> {
    const world = getWorld();
    const candidates = currentRouteCandidates();
    let subject = body.targetId;
    let figures: Record<string, number | string> = {};
    let factors: { factor: string; contributionPct: number }[] = [];

    if (body.kind === 'ROUTE') {
      const route = candidates.find((c) => c.id === body.targetId);
      if (!route) throw new DataError(404, 'Route not found.');
      subject = route.name.split('—')[0].trim();
      figures = {
        riskScore: route.riskScore,
        riskLevel: route.riskLevel,
        distanceKm: Math.round(route.distanceKm),
        etaMinutes: route.etaMinutes,
      };
      factors = clone(route.topFactors);
    } else {
      const d = world.deliveries.find((x) => x.id === body.targetId || x.code === body.targetId);
      if (!d) throw new DataError(404, 'Delivery not found.');
      const route = candidates.find((c) => c.id === d.assignedRouteId);
      subject = body.kind === 'DECISION' ? `Decision for ${d.code}` : d.code;
      figures = {
        failureProbabilityPct: Math.round((d.failureProbability ?? 0) * 100),
        predictedDelayMinutes: d.expectedDelayMinutes ?? 0,
        routeRiskScore: route?.riskScore ?? 0,
        cargoPriority: d.priority,
      };
      factors = clone(route?.topFactors ?? []);
    }

    const drivers = factors
      .slice(0, 3)
      .map((f) => `${f.factor} (${Math.round(f.contributionPct * 10) / 10}%)`)
      .join(', ');
    const figureText = Object.entries(figures)
      .map(([k, v]) => `${k.replace(/([A-Z])/g, ' $1').toLowerCase().trim()} ${v}`)
      .join(', ');

    return delay(
      {
        kind: body.kind,
        subject,
        figures,
        factors,
        explanation: {
          text: `${subject} — ${figureText}.${drivers ? ` The model attributes most of this to ${drivers}.` : ''}`,
          source: 'DETERMINISTIC_TEMPLATE' as const,
          model: null,
          cached: false,
          fallbackReason: 'Demo mode composes explanations locally; no language model is called.',
        },
        provenance: {
          figures: 'DETERMINISTIC_DEMO' as const,
          modelVersion: null,
          explanation: 'DETERMINISTIC_TEMPLATE' as const,
        },
      },
      420,
    );
  },

  // --- Demo controls ------------------------------------------------------

  async simulateRain(segmentId): Promise<SimulateRainResponse> {
    const affectedSegmentIds = runRainCascade(segmentId);
    return delay({ updated: true as const, affectedSegmentIds }, CASCADE_MS);
  },

  async resetDemo(): Promise<ResetDemoResponse> {
    resetWorld();
    submitted.length = 0;
    submittedCount = 0;
    return delay({ reset: true as const }, 700);
  },

  // --- Analytics ----------------------------------------------------------

  async getAnalyticsSummary(): Promise<AnalyticsSummaryResponse> {
    return delay({ ...clone(getWorld().analytics), history: analyticsHistory() });
  },
};
