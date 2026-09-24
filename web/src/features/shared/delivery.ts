/**
 * Delivery selection, shared by every page that features one.
 *
 * A rule, not an id. The console features the most consequential thing currently moving:
 * a delivery the routing and decision pipeline has actually reasoned about (it has an assigned
 * route), then by priority, then by predicted failure, then by the tightest deadline.
 *
 * Keeping this in one place means Command Center, Route Intelligence and Delivery Intelligence
 * all land on the SAME delivery — so navigating between them feels like following one story
 * rather than three pages that happen to share a database.
 */

import type { Delivery } from '@/domain/types';

const PRIORITY_RANK: Record<Delivery['priority'], number> = {
  CRITICAL: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
};

/** Deliveries still in play — anything that has not already arrived or failed. */
export function liveDeliveries(deliveries: Delivery[]): Delivery[] {
  return deliveries.filter(
    (d) => d.status === 'IN_TRANSIT' || d.status === 'AT_RISK' || d.status === 'PENDING',
  );
}

export function rankDeliveries(deliveries: Delivery[]): Delivery[] {
  return [...deliveries].sort(
    (a, b) =>
      Number(Boolean(b.assignedRouteId)) - Number(Boolean(a.assignedRouteId)) ||
      PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
      (b.failureProbability ?? 0) - (a.failureProbability ?? 0) ||
      new Date(a.requiredEta).getTime() - new Date(b.requiredEta).getTime(),
  );
}

export function featuredDelivery(deliveries: Delivery[]): Delivery | undefined {
  return rankDeliveries(liveDeliveries(deliveries))[0];
}

/**
 * Resolves the delivery a page should show: the one named in the URL if it is still live,
 * otherwise whichever the ranking picks.
 */
export function resolveDelivery(
  deliveries: Delivery[],
  requestedIdOrCode: string | undefined,
): Delivery | undefined {
  if (requestedIdOrCode) {
    const match = deliveries.find(
      (d) => d.id === requestedIdOrCode || d.code === requestedIdOrCode,
    );
    if (match) return match;
  }
  return featuredDelivery(deliveries);
}

/** "Route B — Tezpur bypass via Kalaktang" -> "Route B". */
export function shortRouteName(name: string): string {
  return name.split('—')[0].split('·')[0].trim();
}

/** Minutes a delivery is running late against its requirement. Negative means early. */
export function overrunMinutes(delivery: Delivery): number {
  return Math.round(
    (new Date(delivery.currentEta).getTime() - new Date(delivery.requiredEta).getTime()) / 60_000,
  );
}
