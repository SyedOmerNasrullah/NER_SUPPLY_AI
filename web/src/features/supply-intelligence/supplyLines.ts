/**
 * Supply lines — one district-and-category pair, which is the unit an operator actually works
 * in. "Tawang" is not at risk; Tawang's *medicine* is.
 *
 * Everything here is derivation over data the API already returns (districts, deliveries).
 * There is no new endpoint and no fixture: the page asks for districts and deliveries through
 * the normal hooks and this module reshapes them into rows and totals.
 */

import { formatStockout } from '@/domain/format';
import { stockoutUrgency, type StockoutUrgency } from '@/domain/thresholds';
import type { Delivery, District, SupplyCategory } from '@/domain/types';
import type { IconName } from '@/design/primitives';
import { supplyLineId } from '../shared/supplyLink';

export const CATEGORY_ICON: Record<SupplyCategory, IconName> = {
  medicine: 'medicine',
  food: 'food',
  fuel: 'fuel',
};

export const CATEGORIES: SupplyCategory[] = ['medicine', 'food', 'fuel'];

export interface SupplyLine {
  id: string;
  districtId: string;
  district: string;
  category: SupplyCategory;
  currentStock: number;
  dailyConsumption: number;
  stockoutHours: number | null;
  urgency: StockoutUrgency | null;
  /** The inbound delivery this line is waiting on, if any. */
  inbound?: Delivery;
  /**
   * Why this line is where it is. Derived from what the data says, never asserted: a line with
   * a delayed inbound delivery is short because of the delay; one with no inbound at all is
   * short because nothing is coming.
   */
  cause: string;
}

/** Which of a delivery's cargo types lands on which supply line. */
export function categoryForCargo(cargoType: string): SupplyCategory {
  const t = cargoType.toLowerCase();
  if (t.includes('fuel')) return 'fuel';
  if (t.includes('food')) return 'food';
  return 'medicine';
}

function describeCause(
  urgency: StockoutUrgency | null,
  inbound: Delivery | undefined,
): string {
  if (urgency === null) return 'No projection';
  if (urgency === 'NORMAL') return 'Holding above safety stock';

  if (inbound) {
    const delay = inbound.expectedDelayMinutes ?? 0;
    if (delay > 0) {
      return `${inbound.code} delayed — resupply lands later than planned`;
    }
    return `Awaiting ${inbound.code}; consumption outpacing cover`;
  }
  return 'No resupply scheduled at current consumption';
}

/** Every district × category pair, ranked by urgency. */
export function buildSupplyLines(districts: District[], deliveries: Delivery[]): SupplyLine[] {
  const live = deliveries.filter(
    (d) => d.status === 'IN_TRANSIT' || d.status === 'AT_RISK' || d.status === 'PENDING',
  );

  const lines: SupplyLine[] = [];
  for (const district of districts) {
    for (const category of CATEGORIES) {
      const stock = district.stock[category];
      const urgency = stockoutUrgency(stock.predictedStockoutHours);
      const inbound = live.find(
        (d) => d.destDistrictId === district.id && categoryForCargo(d.cargoType) === category,
      );

      lines.push({
        id: supplyLineId(district.id, category),
        districtId: district.id,
        district: district.name,
        category,
        currentStock: stock.currentStock,
        dailyConsumption: stock.dailyConsumption,
        stockoutHours: stock.predictedStockoutHours,
        urgency,
        inbound,
        cause: describeCause(urgency, inbound),
      });
    }
  }

  return lines.sort(
    (a, b) => (a.stockoutHours ?? Infinity) - (b.stockoutHours ?? Infinity),
  );
}

export interface SupplyTotals {
  critical: number;
  warning: number;
  /** Lines projected to run out inside the visible horizon. */
  projectedStockouts: number;
  districtsAffected: number;
  /** The tightest line in the region, for the headline. */
  tightest?: SupplyLine;
}

export function summarise(lines: SupplyLine[]): SupplyTotals {
  const critical = lines.filter((l) => l.urgency === 'CRITICAL');
  const warning = lines.filter((l) => l.urgency === 'WARNING');
  const affected = new Set([...critical, ...warning].map((l) => l.districtId));

  return {
    critical: critical.length,
    warning: warning.length,
    projectedStockouts: critical.length + warning.length,
    districtsAffected: affected.size,
    tightest: lines[0],
  };
}

/** Days-of-cover, the unit a storekeeper thinks in. */
export function daysRemaining(stockoutHours: number | null): string {
  if (stockoutHours === null) return '—';
  return `${(stockoutHours / 24).toFixed(1)}d`;
}

export { formatStockout };
