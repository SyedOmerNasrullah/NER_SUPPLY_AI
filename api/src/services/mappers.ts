/**
 * Database rows -> the shapes `web/src/domain/types.ts` declares.
 *
 * These are not cosmetic. The frontend is frozen and typed against those interfaces, so this
 * file is where the contract is actually honoured: a field renamed here is a blank panel there.
 *
 * Two habits worth keeping:
 *
 *   - `null` becomes `undefined`. Prisma returns null for an absent column; the frontend's
 *     types use optional properties, and several of its panels distinguish "absent" from
 *     "present and zero" (an absent `delayMinutes` means running to plan; a zero one means
 *     something measured it as zero). Passing null through would make `'delayMinutes' in row`
 *     true for a delivery that is on time.
 *   - Nothing is invented. If the database does not have it, the field is left off and the
 *     frontend renders its documented reduced state.
 */

import type {
  Alert as PrismaAlert,
  AIRecommendation as PrismaRecommendation,
  Delivery as PrismaDelivery,
  District as PrismaDistrict,
  Incident as PrismaIncident,
  InventoryItem,
  Notification as PrismaNotification,
  Route as PrismaRoute,
  RouteSegment as PrismaSegment,
  User,
  Vehicle as PrismaVehicle,
  VehicleMovement as PrismaMovement,
  Warehouse as PrismaWarehouse,
} from '@prisma/client';

/** Prisma's `null` -> the contract's `undefined`. */
const opt = <T>(value: T | null): T | undefined => (value === null ? undefined : value);

/** A Json column the contract types as a concrete array. Absent and malformed both become undefined. */
function jsonArray<T>(value: unknown): T[] | undefined {
  return Array.isArray(value) ? (value as T[]) : undefined;
}

// ---------------------------------------------------------------------------

export const toUser = (u: User) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  role: u.role,
  phone: opt(u.phone),
  districtId: opt(u.districtId),
});

export const toFieldOfficer = (u: User) => ({
  id: u.id,
  name: u.name,
  phone: opt(u.phone),
  districtId: opt(u.districtId),
  status: u.status === 'OFFLINE' ? ('OFFLINE' as const) : ('ACTIVE' as const),
});

export const toVehicle = (v: PrismaVehicle) => ({
  id: v.id,
  code: v.code,
  driverName: v.driverName,
  currentLat: v.currentLat,
  currentLng: v.currentLng,
  speedKmh: v.speedKmh,
  expectedSpeedKmh: v.expectedSpeedKmh,
  status: v.status as 'IDLE' | 'IN_TRANSIT' | 'STOPPED',
  currentDeliveryId: opt(v.currentDeliveryId),
  nearestPlace: opt(v.nearestPlace),
  // `anomaly` (delta D22) is deliberately absent: the GPS-anomaly rule is a later phase, and an
  // absent field means "behaving normally", which is the truth until that rule runs.
});

export const toDelivery = (d: PrismaDelivery) => ({
  id: d.id,
  code: d.code,
  cargoType: d.cargoType,
  priority: d.priority,
  originLat: d.originLat,
  originLng: d.originLng,
  destLat: d.destLat,
  destLng: d.destLng,
  originName: opt(d.originName),
  destName: opt(d.destName),
  cargoUnits: opt(d.cargoUnits),
  destDistrictId: opt(d.destDistrictId),
  assignedVehicleId: opt(d.assignedVehicleId),
  assignedRouteId: opt(d.assignedRouteId),
  requiredEta: d.requiredEta.toISOString(),
  currentEta: d.currentEta.toISOString(),
  failureProbability: opt(d.failureProbability),
  expectedDelayMinutes: opt(d.expectedDelayMinutes),
  status: d.status,
});

export const toSegment = (s: PrismaSegment) => ({
  id: s.id,
  code: s.code,
  name: s.name,
  startLat: s.startLat,
  startLng: s.startLng,
  endLat: s.endLat,
  endLng: s.endLng,
  currentStatus: s.currentStatus,
  // The contract types this as non-optional; a segment that has never been scored reports 0
  // rather than omitting the field, so the risk list can always sort.
  lastRiskScore: s.lastRiskScore ?? 0,
  lastRiskFactors: jsonArray<{ factor: string; contributionPct: number }>(s.lastRiskFactors),
  // Delta D50 — which route owns this segment, and where it falls along it.
  routeId: opt(s.routeId),
  sequence: opt(s.sequence),
  distanceKm: opt(s.distanceKm),
});

export const toWarehouse = (w: PrismaWarehouse) => ({
  id: w.id,
  name: w.name,
  lat: w.lat,
  lng: w.lng,
});

/** InventoryItem rows for one district -> the contract's `stock` record. */
export function toStock(items: InventoryItem[]) {
  const empty = { currentStock: 0, dailyConsumption: 0, predictedStockoutHours: null };
  const find = (type: string) => {
    const item = items.find((i) => i.itemType === type);
    if (!item) return { ...empty };
    return {
      currentStock: item.currentStock,
      dailyConsumption: item.dailyConsumption,
      predictedStockoutHours: item.predictedStockoutHours,
    };
  };
  return { medicine: find('medicine'), food: find('food'), fuel: find('fuel') };
}

export const toDistrict = (d: PrismaDistrict, items: InventoryItem[]) => ({
  id: d.id,
  name: d.name,
  lat: d.lat,
  lng: d.lng,
  stock: toStock(items),
});

export interface IncidentRouteImpact {
  routeId: string;
  name: string;
  distanceKm: number;
  riskScore: number;
  riskLevel: string;
}

export const toIncident = (
  i: PrismaIncident,
  segmentName?: string,
  /**
   * The candidate route this incident sits on, when it sits on one. Distinct from `segmentId`:
   * the stored segments describe Route A only, so a point on Route B's own stretch matches no
   * segment and still belongs to a corridor. Delta D49.
   */
  routeImpact?: IncidentRouteImpact | null,
) => ({
  id: i.id,
  type: i.type,
  severity: i.severity,
  description: opt(i.description),
  segmentId: opt(i.segmentId),
  segmentName,
  imageUrl: opt(i.imageUrl),
  cvDetectedClass: opt(i.cvDetectedClass),
  cvConfidence: opt(i.cvConfidence),
  cvEstimatedBlockage: opt(i.cvEstimatedBlockage),
  lat: i.lat,
  lng: i.lng,
  routeImpact: routeImpact ?? undefined,
  createdAt: i.createdAt.toISOString(),
});

export const toAlert = (a: PrismaAlert) => ({
  id: a.id,
  severity: a.severity,
  title: a.title,
  message: a.message,
  notifiedViaTwilio: a.notifiedViaTwilio,
  createdAt: a.createdAt.toISOString(),
  relatedType: opt(a.relatedType) as
    | 'DELIVERY'
    | 'DISTRICT'
    | 'SEGMENT'
    | 'INCIDENT'
    | undefined,
  relatedId: opt(a.relatedId),
});

export const toRecommendation = (r: PrismaRecommendation) => ({
  id: r.id,
  type: r.type,
  targetType: r.targetType as 'DELIVERY' | 'DISTRICT' | 'ROUTE',
  targetId: r.targetId,
  recommendationText: r.recommendationText,
  confidence: r.confidence,
});

export const toRouteCandidate = (r: PrismaRoute) => ({
  id: r.id,
  name: r.name,
  distanceKm: r.distanceKm,
  etaMinutes: r.etaMinutes,
  geometry: (r.geometry ?? []) as [number, number][],
  riskScore: r.riskScore,
  riskLevel: r.riskLevel,
  isRecommended: r.isRecommended,
  // Per-candidate SHAP (delta D8). The contract says never empty for a scored candidate, so an
  // empty array here is a seeding bug rather than a legal state — it is passed through as-is so
  // it shows up rather than being masked.
  topFactors: jsonArray<{ factor: string; contributionPct: number }>(r.topFactors) ?? [],
  explanationText: r.explanationText ?? '',
  profile: (r.profile ?? undefined) as Record<string, unknown> | undefined,
  elevationProfile: jsonArray<Record<string, unknown>>(r.elevationProfile),
  // Delta D39 — the corridor segments this route travels, in segment order.
  segmentIds: r.segmentIds,
});

export const toMovement = (m: PrismaMovement) => ({
  id: m.id,
  vehicleCode: m.vehicleCode,
  deliveryCode: m.deliveryCode,
  place: m.place,
  status: m.status as 'ON_ROUTE' | 'DELAYED' | 'STOPPED',
  delayMinutes: opt(m.delayMinutes),
});

export const toNotification = (n: PrismaNotification) => ({
  id: n.id,
  alertId: n.alertId,
  alertTitle: n.alertTitle,
  channel: n.channel as 'SMS' | 'CALL' | 'DASHBOARD',
  status: n.status as 'QUEUED' | 'SENT' | 'DELIVERED' | 'FAILED',
  recipientName: n.recipientName,
  recipientRole: n.recipientRole,
  recipientPhone: opt(n.recipientPhone),
  failureReason: opt(n.failureReason),
  sentAt: n.sentAt.toISOString(),
  relatedId: opt(n.relatedId),
});
