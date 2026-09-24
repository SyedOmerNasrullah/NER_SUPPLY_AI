/**
 * Database rows -> the seven delivery-risk features the model takes.
 *
 * The same rule as `routeRiskFeatures.ts`: every value comes from PostgreSQL, nothing is
 * defaulted, and a delivery missing an input is skipped with the reason rather than scored on a
 * guess. Field by field:
 *
 *   distanceRemainingKm   great-circle distance from the assigned vehicle's last reported
 *                         position to the delivery's destination. Straight-line, not along the
 *                         road: the corridor geometry is schematic until OpenRouteService lands,
 *                         and a road distance derived from a schematic line would be a more
 *                         precise-looking number that is no more true.
 *   currentSpeedKmh       Vehicle.speedKmh, the last reported speed.
 *   routeRiskScore        Route.riskScore of the route the delivery is assigned to — the output
 *                         of the layer above this one, which is what makes the cascade a cascade.
 *   weatherSeverity       derived from the corridor WeatherSnapshot, banded below.
 *   cargoPriority         Delivery.priority, the Prisma enum, sent by name.
 *   hourOfDay / dayOfWeek the moment the prediction is made, in India Standard Time — the clock
 *                         the corridor actually runs on. Passed in rather than read from the
 *                         system clock so a caller can score a fixed instant reproducibly.
 */

import type { Delivery, Route, Vehicle, WeatherSnapshot } from '@prisma/client';
import type { DeliveryRiskFeatures } from './mlClient';
import { haversineKm } from '../domain/geo';

export type DeliveryFeatureResult =
  | { ok: true; features: DeliveryRiskFeatures }
  | { ok: false; reason: string };

/** IST. The corridor is in Assam and Arunachal Pradesh; UTC would mislabel every night shift. */
const IST_OFFSET_MINUTES = 5 * 60 + 30;

/**
 * Rainfall -> the model's four-level severity.
 *
 * The 60 mm/24h line is not invented here: it is the same threshold `GET /api/weather` already
 * uses to call the corridor "Heavy Rainfall", so the label an operator reads on screen and the
 * feature the model receives can never disagree.
 */
export function weatherSeverityFor(w: WeatherSnapshot): DeliveryRiskFeatures['weatherSeverity'] {
  if (w.rainfall24h >= 120 || w.rainfall1h >= 25) return 'SEVERE';
  if (w.rainfall24h >= 60 || w.rainfall1h >= 12) return 'HEAVY';
  if (w.rainfall24h >= 10 || w.rainfall1h >= 2.5) return 'MODERATE';
  return 'NORMAL';
}

/** Hour (0-23) and weekday (0 = Monday) in IST for an instant. */
export function istClock(at: Date): { hourOfDay: number; dayOfWeek: number } {
  const ist = new Date(at.getTime() + IST_OFFSET_MINUTES * 60_000);
  return {
    hourOfDay: ist.getUTCHours(),
    // getUTCDay() is 0 = Sunday; the contract is 0 = Monday.
    dayOfWeek: (ist.getUTCDay() + 6) % 7,
  };
}

export function deliveryFeatures(
  delivery: Delivery,
  vehicle: Vehicle | undefined,
  route: Route | undefined,
  weather: WeatherSnapshot | undefined,
  at: Date,
): DeliveryFeatureResult {
  if (!route) return { ok: false, reason: `${delivery.code} has no assigned route to take a risk score from.` };
  if (!vehicle) return { ok: false, reason: `${delivery.code} has no assigned vehicle reporting position and speed.` };
  if (!weather) return { ok: false, reason: `${delivery.code} has no corridor weather snapshot.` };

  const distanceRemainingKm = Number(
    haversineKm(vehicle.currentLat, vehicle.currentLng, delivery.destLat, delivery.destLng).toFixed(2),
  );

  return {
    ok: true,
    features: {
      distanceRemainingKm,
      currentSpeedKmh: vehicle.speedKmh,
      routeRiskScore: route.riskScore,
      weatherSeverity: weatherSeverityFor(weather),
      cargoPriority: delivery.priority,
      ...istClock(at),
    },
  };
}
