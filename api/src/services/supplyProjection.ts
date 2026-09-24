/**
 * Supply projection — arithmetic, stated in full.
 *
 * This layer is deliberately NOT a model. Every figure is one division or one subtraction over
 * numbers the database already holds, which means an operator can check it on a phone calculator
 * and a judge can be told exactly how "2.1 days of medicine" was produced. A regression here
 * would add opacity and no accuracy: there is no historical stockout data to fit, and the
 * quantity being predicted (stock ÷ consumption) is not statistical.
 *
 * What it consumes, per the intended architecture:
 *
 *   current stock            InventoryItem.currentStock
 *   consumption rate         InventoryItem.dailyConsumption
 *   predicted delivery delay Delivery.expectedDelayMinutes — which, after an ML-applied run, is
 *                            the delay `delivery-risk-xgb-v1` predicted
 *   route disruption         reaches this through that delay and the delivery's own ETA
 *   cargo quantity           Delivery.cargoUnits, the resupply this district is waiting on
 *   safety threshold         the Decision Engine's 48-hour line, imported rather than repeated
 *
 * The headline `coverHours` deliberately excludes the inbound resupply: it answers "how long
 * does what is on the shelf last", which is the number the product has always shown and the
 * runbook quotes. What the resupply would add is reported separately, as
 * `coverWithResupplyHours`, so the two questions are never conflated.
 */

import { CRITICAL_STOCKOUT_HOURS } from './decision';

export interface ResupplyInput {
  deliveryCode: string;
  /** Units arriving. */
  units: number;
  /** When it is now expected — the ETA already carries any predicted delay. */
  etaIso: string;
  /** Minutes behind plan, as predicted or recorded. */
  delayMinutes: number;
}

export interface StockProjectionInput {
  itemType: string;
  currentStock: number;
  dailyConsumption: number;
  resupply?: ResupplyInput;
  /** The clock this world runs on. */
  now: Date;
  safetyThresholdHours?: number;
}

export interface StockProjection {
  itemType: string;
  currentStock: number;
  dailyConsumption: number;
  hourlyConsumption: number;
  /** Hours until the shelf is empty at the current rate, ignoring anything inbound. */
  coverHours: number | null;
  /** The moment that happens, ISO. */
  stockoutAt: string | null;
  safetyThresholdHours: number;
  /** When cover falls below the threshold — already past, or a future instant. */
  crossesThresholdAt: string | null;
  belowThreshold: boolean;
  resupply:
    | (ResupplyInput & {
        hoursAway: number;
        /** Hours of cover the cargo adds: units ÷ hourly consumption. */
        coverAddedHours: number;
        /** True when the shelf empties before it arrives — the case that matters. */
        arrivesAfterStockout: boolean;
      })
    | null;
  /** Cover once the resupply lands, when it lands in time. */
  coverWithResupplyHours: number | null;
  /** Plain sentence, built from these numbers. Never written by a language model. */
  explanation: string;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export function projectStock({
  itemType,
  currentStock,
  dailyConsumption,
  resupply,
  now,
  safetyThresholdHours = CRITICAL_STOCKOUT_HOURS,
}: StockProjectionInput): StockProjection {
  const hourly = dailyConsumption / 24;

  // A district that consumes nothing has no stockout to project. Reporting null is the honest
  // answer; reporting Infinity as a number would be arithmetic pretending to be a forecast.
  if (hourly <= 0) {
    return {
      itemType,
      currentStock,
      dailyConsumption,
      hourlyConsumption: 0,
      coverHours: null,
      stockoutAt: null,
      safetyThresholdHours,
      crossesThresholdAt: null,
      belowThreshold: false,
      resupply: null,
      coverWithResupplyHours: null,
      explanation: `No recorded consumption of ${itemType}, so no stockout can be projected.`,
    };
  }

  const coverHours = round1(currentStock / hourly);
  const stockoutAt = new Date(now.getTime() + coverHours * 3_600_000).toISOString();
  const crossesThresholdAt =
    coverHours <= safetyThresholdHours
      ? now.toISOString()
      : new Date(now.getTime() + (coverHours - safetyThresholdHours) * 3_600_000).toISOString();

  let resupplyOut: StockProjection['resupply'] = null;
  let coverWithResupplyHours: number | null = null;

  if (resupply) {
    const hoursAway = round1((Date.parse(resupply.etaIso) - now.getTime()) / 3_600_000);
    const coverAddedHours = round1(resupply.units / hourly);
    const arrivesAfterStockout = hoursAway > coverHours;
    resupplyOut = { ...resupply, hoursAway, coverAddedHours, arrivesAfterStockout };
    // Arriving late does not retroactively cover the gap: the shelf was empty in between, and
    // adding the hours anyway would hide exactly the failure this system exists to predict.
    coverWithResupplyHours = arrivesAfterStockout ? coverHours : round1(coverHours + coverAddedHours);
  }

  const days = round1(coverHours / 24);
  const parts = [
    `${currentStock} units of ${itemType} at ${dailyConsumption}/day is ${coverHours} h of cover (${days} days).`,
  ];
  if (coverHours <= safetyThresholdHours) {
    parts.push(`That is already inside the ${safetyThresholdHours} h safety threshold.`);
  } else {
    parts.push(`Cover crosses the ${safetyThresholdHours} h threshold in ${round1(coverHours - safetyThresholdHours)} h.`);
  }
  if (resupplyOut) {
    parts.push(
      resupplyOut.arrivesAfterStockout
        ? `${resupplyOut.deliveryCode} arrives in ${resupplyOut.hoursAway} h, ${round1(resupplyOut.hoursAway - coverHours)} h after the shelf empties` +
          `${resupplyOut.delayMinutes > 0 ? `, having lost ${resupplyOut.delayMinutes} min to disruption` : ''}.`
        : `${resupplyOut.deliveryCode} arrives in ${resupplyOut.hoursAway} h with ${resupplyOut.units} units, adding ${resupplyOut.coverAddedHours} h` +
          `${resupplyOut.delayMinutes > 0 ? `, ${resupplyOut.delayMinutes} min later than planned` : ''}.`,
    );
  }

  return {
    itemType,
    currentStock,
    dailyConsumption,
    hourlyConsumption: round1(hourly),
    coverHours,
    stockoutAt,
    safetyThresholdHours,
    crossesThresholdAt,
    belowThreshold: coverHours < safetyThresholdHours,
    resupply: resupplyOut,
    coverWithResupplyHours,
    explanation: parts.join(' '),
  };
}
