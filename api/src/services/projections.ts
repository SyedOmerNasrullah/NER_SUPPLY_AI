/**
 * Supply projections — contract delta D17.
 *
 * Supply Intelligence does not just show that Tawang has 32 hours of medicine left; it shows
 * the subtraction that produced 32. That needs three numbers, and only one of them is stored:
 *
 *   baseline   what the runway would be if the inbound delivery arrived as scheduled
 *   adjusted   what it actually is, which is `InventoryItem.predictedStockoutHours`
 *   drag       baseline - adjusted, i.e. what the disruption cost
 *
 * `baseline` is derived, not stored: stock / consumption-per-day * 24. The seeded consumption
 * rates were chosen so that this arithmetic reproduces the stored projection exactly when
 * nothing is delayed — which is why the drag reads 0 at baseline rather than some small
 * rounding artefact, and why an operator can check the figure on screen with a calculator.
 */

import type { InventoryItem } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { projectStock } from './supplyProjection';
import world from '../../prisma/seed-data/world.json';

const LIVE_STATUSES = ['IN_TRANSIT', 'AT_RISK', 'PENDING'] as const;

export async function buildProjections(districtId: string, items: InventoryItem[]) {
  // The one inbound delivery this district is waiting on, if any.
  const inbound = await prisma.delivery.findFirst({
    where: { destDistrictId: districtId, status: { in: [...LIVE_STATUSES] } },
    orderBy: { currentEta: 'asc' },
  });

  return (['medicine', 'food', 'fuel'] as const).map((category) => {
    const item = items.find((i) => i.itemType === category);
    const currentStock = item?.currentStock ?? 0;
    const dailyConsumption = item?.dailyConsumption ?? 0;
    const adjusted = item?.predictedStockoutHours ?? null;

    // `baseline` is defined as "the projection assuming the inbound delivery arrives as
    // scheduled". When that delivery is not running late, it arrives as scheduled — so the
    // baseline IS the stored projection, by definition, and there is nothing to recompute.
    //
    // Recomputing it anyway was wrong in a way worth recording: stock / consumption * 24 does
    // not always land on the stored value, because the seeded projections were not all rounded
    // the same direction. Tawang's food read 1227 derived against 1226 stored, so the page
    // reported one hour of "disruption drag" on a delivery that was perfectly on time. A
    // fabricated hour is a small number and a large credibility problem.
    //
    // Once a delay exists, the difference is the cascade's to compute — Phase 4B — and this
    // returns the stored value until then rather than guessing at the arithmetic.
    const delayed = (inbound?.expectedDelayMinutes ?? 0) > 0;
    const baseline =
      !delayed || dailyConsumption <= 0
        ? adjusted
        : Math.round((currentStock / dailyConsumption) * 24);

    return {
      category,
      currentStock,
      dailyConsumption,
      baselineStockoutHours: baseline,
      adjustedStockoutHours: adjusted,
      disruptionHours:
        baseline !== null && adjusted !== null ? Math.max(0, Math.round(baseline - adjusted)) : 0,
      inboundDeliveryCode: inbound?.code,
      inboundDeliveryId: inbound?.id,
      inboundDelayMinutes: inbound?.expectedDelayMinutes ?? undefined,
      // The same figures, with the arithmetic shown: cover, the moment it runs out, when it
      // crosses the 48-hour line, and what the inbound cargo adds. Additive — the fields above
      // keep their meaning, and this is the layer Supply Intelligence can explain from.
      projection: projectStock({
        itemType: category,
        currentStock,
        dailyConsumption,
        now: new Date(world.meta.demoNow),
        resupply:
          inbound && inbound.cargoUnits
            ? {
                deliveryCode: inbound.code,
                units: inbound.cargoUnits,
                etaIso: inbound.currentEta.toISOString(),
                delayMinutes: inbound.expectedDelayMinutes ?? 0,
              }
            : undefined,
      }),
    };
  });
}
