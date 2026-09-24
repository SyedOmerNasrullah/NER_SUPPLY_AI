/**
 * The Command Center's six headline figures — contract delta D7.
 *
 * Derived from the same rows the other pages read, for the reason Phase 3F established the hard
 * way: the strip used to be hand-authored constants and it disagreed with the pages underneath
 * it. A judge comparing two screens found that in about a minute. Nothing here is stored.
 *
 * The 48-hour boundary is the contract's stockout threshold and is the same number Supply
 * Intelligence uses, so the two counts cannot drift.
 */

import { prisma } from '../lib/prisma';

const CRITICAL_STOCKOUT_HOURS = 48;
const LIVE_STATUSES = ['IN_TRANSIT', 'AT_RISK', 'PENDING'] as const;

/** Percentage change, with the zero-denominator case answered rather than NaN. */
const changePct = (now: number, before: number): number =>
  before === 0 ? 0 : Math.round(((now - before) / before) * 100);

export async function buildSummary() {
  const [live, atRisk, criticalAtRisk, segments, criticalStock, officers, history] =
    await Promise.all([
      prisma.delivery.count({ where: { status: { in: [...LIVE_STATUSES] } } }),
      prisma.delivery.count({ where: { status: 'AT_RISK' } }),
      prisma.delivery.count({ where: { status: 'AT_RISK', priority: 'CRITICAL' } }),
      prisma.routeSegment.findMany({
        where: { currentStatus: { not: 'OPEN' } },
        select: { currentStatus: true },
      }),
      prisma.inventoryItem.findMany({
        where: {
          ownerType: 'DISTRICT',
          predictedStockoutHours: { lt: CRITICAL_STOCKOUT_HOURS, not: null },
        },
        select: { ownerId: true },
      }),
      prisma.user.findMany({ where: { role: 'FIELD_OFFICER' }, select: { status: true } }),
      prisma.dailyPerformance.findMany({ orderBy: { date: 'desc' }, take: 2 }),
    ]);

  // "Today" and "yesterday" exist only in the recorded history — the live delivery list cannot
  // say what the average delay was across a day that is still running.
  const [today, yesterday] = history;

  return {
    // Deliveries have no stored yesterday-count, so their deltas report 0 and the UI renders a
    // dash. An invented percentage would be worse than an absent one.
    activeDeliveries: { value: live, deltaPct: 0, atRisk },
    atRiskDeliveries: { value: atRisk, deltaPct: 0, critical: criticalAtRisk },
    roadBlockages: {
      value: segments.length,
      major: segments.filter((s) => s.currentStatus === 'BLOCKED').length,
      minor: segments.filter((s) => s.currentStatus === 'PARTIAL').length,
    },
    criticalSupplyAlerts: {
      value: criticalStock.length,
      districts: new Set(criticalStock.map((i) => i.ownerId)).size,
    },
    fieldOfficers: {
      active: officers.filter((o) => o.status === 'ACTIVE').length,
      total: officers.length,
    },
    averageDelayMinutes: {
      value: today?.avgDelayMin ?? 0,
      deltaPct: today && yesterday ? changePct(today.avgDelayMin, yesterday.avgDelayMin) : 0,
    },
  };
}
