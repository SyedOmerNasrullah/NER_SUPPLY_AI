/**
 * The three operations that change the world: simulate, reroute, reset.
 *
 * Each runs inside one Prisma transaction. A cascade that updated the weather and the segments
 * and then failed on the supply projection would leave the console showing heavy rainfall over
 * a corridor whose medicine is still comfortable — internally contradictory state, and the kind
 * that is very hard to notice and very embarrassing to present. All or nothing.
 *
 * On where the numbers come from:
 *
 *   simulate   replays the frozen demo's own recorded cascade output (`world.afterRain`), which
 *              the exporter captured by *running* the frozen implementation. The alternative —
 *              reimplementing the cascade against Prisma rows — is how the two halves of this
 *              project would start disagreeing about whether Route A scores 87 or 86.
 *
 *   reroute    is implemented properly, because it has to work for any candidate route rather
 *              than the one the demo scripts. Its formulas are the frozen `applyReroute` and
 *              `reprojectMedicineCover`, carried over rule for rule.
 *
 *   reset      restores the seeded baseline for demo-owned state and deletes exactly the rows a
 *              demonstration created. It does not truncate anything.
 */

import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import world from '../../prisma/seed-data/world.json';
import { CASCADE_TX, prisma } from '../lib/prisma';
import { ApiError } from '../middleware/errors';
import { decide, type Decision } from './decision';

type Tx = Prisma.TransactionClient | PrismaClient;

/** The demo world's fixed instant. Every ETA is derived from it, never from the wall clock. */
const DEMO_NOW = new Date(world.meta.demoNow).getTime();

/**
 * Additional draw-down while a resupply is late: consumption keeps running against a stock level
 * that was already short, so an hour of delay costs more than an hour of cover. Carried over
 * from the frozen demo unchanged — changing it here would change Tawang's 32 hours.
 */
const CONSUMPTION_DRAG_HOURS = 16.7;

const pick = <T>(record: object, key: string): T | undefined =>
  (record as Record<string, unknown>)[key] as T | undefined;

// ---------------------------------------------------------------------------
// Supply reprojection — the frozen `reprojectMedicineCover`, rule for rule
// ---------------------------------------------------------------------------

/**
 * Re-derive a district's medicine cover from its inbound delivery's CURRENT delay.
 *
 * Absolute, never incremental: it always starts from the seeded baseline, so "rain, then
 * reroute" lands on exactly the number a world that had never rained would show. Subtracting on
 * the way in and adding back on the way out drifts a little further from the truth with every
 * action, which is the sort of thing nobody notices until a judge does.
 */
/** Exported for the delivery-risk path (Phase 6B), which reprojects cover from an ML delay. */
export async function reprojectMedicineCover(tx: Tx, districtId: string | null): Promise<void> {
  if (!districtId) return;

  const seeded = world.districts.find((d) => d.id === districtId);
  const baseline = seeded?.stock.medicine.predictedStockoutHours;
  if (baseline === undefined || baseline === null) return;

  const inbound = await tx.delivery.findFirst({
    where: { destDistrictId: districtId, status: { in: ['IN_TRANSIT', 'AT_RISK', 'PENDING'] } },
    orderBy: { currentEta: 'asc' },
  });
  const delayMinutes = inbound?.expectedDelayMinutes ?? 0;

  await tx.inventoryItem.updateMany({
    where: { ownerType: 'DISTRICT', ownerId: districtId, itemType: 'medicine' },
    data: {
      predictedStockoutHours:
        delayMinutes > 0
          ? Math.round(baseline - delayMinutes / 60 - CONSUMPTION_DRAG_HOURS)
          : baseline,
    },
  });
}

// ---------------------------------------------------------------------------
// Decision engine, run against live rows
// ---------------------------------------------------------------------------

/**
 * Re-evaluate the ladder for a delivery and reconcile its recommendation row.
 *
 * "Reconcile" rather than "insert": when the engine now says NONE, the outstanding
 * recommendation has to go, or the Field Operations queue keeps offering an action the world no
 * longer justifies. That retirement is what makes the reroute feel like it did something.
 */
/**
 * Exported for the delivery-risk path (Phase 6B): the same ladder, run over ML numbers instead
 * of replayed ones. It returns the Decision now as well as reconciling the recommendation row,
 * so a caller can report what the engine concluded; the existing callers ignore it.
 */
export async function reconcileDeliveryDecision(
  tx: Tx,
  deliveryId: string,
  // Passed in rather than fetched. Called once per delivery, and re-reading the same three
  // route rows eight times was a meaningful share of a cascade that took twenty-four seconds.
  preloadedRoutes?: { id: string; name: string; riskScore: number }[],
): Promise<Decision | undefined> {
  const delivery = await tx.delivery.findUnique({ where: { id: deliveryId } });
  if (!delivery) return undefined;

  const routes = preloadedRoutes ?? (await tx.route.findMany());
  const assigned = routes.find((r) => r.id === delivery.assignedRouteId);

  const district = delivery.destDistrictId
    ? await tx.inventoryItem.findFirst({
        where: { ownerType: 'DISTRICT', ownerId: delivery.destDistrictId, itemType: 'medicine' },
      })
    : null;

  const decision = decide({
    assignedRouteRisk: assigned?.riskScore,
    candidateRisks: routes.filter((r) => r.id !== assigned?.id).map((r) => r.riskScore),
    adjustedStockoutHours: district?.predictedStockoutHours,
    failureProbability: delivery.failureProbability,
  });

  // Clear what the engine no longer stands behind, then write what it does. Only
  // demo-generated recommendations are removed — a seeded one is part of the baseline.
  await tx.aIRecommendation.deleteMany({
    where: { targetType: 'DELIVERY', targetId: delivery.id, demoGenerated: true },
  });

  if (decision.outcome === 'NONE') return decision;

  const safer = routes
    .filter((r) => r.id !== assigned?.id && (assigned?.riskScore ?? 0) - r.riskScore >= 15)
    .sort((a, b) => a.riskScore - b.riskScore)[0];

  const text =
    decision.outcome === 'REROUTE' && safer && assigned
      ? `Reroute ${delivery.code} through ${safer.name.split('—')[0].trim()}. Risk falls from ${assigned.riskScore}% to ${safer.riskScore}%.`
      : decision.outcome === 'PRE_POSITION'
        ? `Pre-position medicine ahead of ${delivery.code}. Destination cover is below the ${48}-hour line.`
        : `${delivery.code} is predicted to fail. Escalate to the corridor controller.`;

  await tx.aIRecommendation.create({
    data: {
      type: decision.outcome,
      targetType: 'DELIVERY',
      targetId: delivery.id,
      recommendationText: text,
      confidence: decision.confidence,
      status: 'PENDING',
      demoGenerated: true,
    },
  });

  return decision;
}

// ---------------------------------------------------------------------------
// Simulate heavy rainfall
// ---------------------------------------------------------------------------

export async function simulateRain(_segmentId: string): Promise<string[]> {
  // The segment is validated by the caller; the recorded cascade covers the whole corridor it
  // affects, so the id selects *when* to run rather than *what* changes. It will matter again
  // when Phase 5 scores segments individually.
  const state = await prisma.demoState.findUnique({ where: { id: 'singleton' } });
  if (state?.simulated) {
    // Idempotent rather than an error: the frozen demo returns the same affected segments on a
    // second click, and a presenter double-clicking should not see a failure.
    return world.afterRain.segments
      .filter((s) => s.lastRiskScore !== world.segments.find((b) => b.id === s.id)?.lastRiskScore)
      .map((s) => s.id);
  }

  const after = world.afterRain;

  return prisma.$transaction(async (tx) => {
    // 1 — weather inputs are overwritten. This is the SIMULATION EVENT.
    await tx.weatherSnapshot.updateMany({
      data: {
        rainfall1h: after.weather.rainfall1hMm,
        rainfall3h: Number((after.weather.rainfall1hMm * 2.4).toFixed(1)),
        rainfall6h: Number((after.weather.rainfall1hMm * 4.1).toFixed(1)),
        rainfall24h: after.weather.rainfall24hMm,
        windSpeedKmh: after.weather.windKmh,
        visibility:
          after.weather.visibilityKm >= 8 ? 'good' : after.weather.visibilityKm >= 3 ? 'moderate' : 'low',
        isSimulated: true,
      },
    });
    await tx.demoState.update({ where: { id: 'singleton' }, data: { simulated: true } });

    // 2 — segment risk is recalculated on the affected segments.
    const affected: string[] = [];
    const segmentWrites: Prisma.PrismaPromise<unknown>[] = [];
    for (const seg of after.segments) {
      const baseline = world.segments.find((b) => b.id === seg.id);
      if (!baseline || baseline.lastRiskScore === seg.lastRiskScore) continue;
      segmentWrites.push(tx.routeSegment.update({
        where: { id: seg.id },
        data: {
          lastRiskScore: seg.lastRiskScore,
          currentStatus: seg.currentStatus as 'OPEN' | 'PARTIAL' | 'BLOCKED',
          lastRiskFactors: (seg.lastRiskFactors ?? []) as Prisma.InputJsonValue,
        },
      }));
      affected.push(seg.id);

      // Append to the prediction log rather than overwriting it — Analytics reads history.
      segmentWrites.push(tx.riskPrediction.create({
        data: {
          segmentId: seg.id,
          riskScore: seg.lastRiskScore,
          riskProbability: seg.lastRiskScore / 100,
          riskLevel:
            seg.lastRiskScore >= 85 ? 'CRITICAL' : seg.lastRiskScore >= 70 ? 'HIGH' : seg.lastRiskScore >= 40 ? 'MEDIUM' : 'LOW',
          predictedDisruption: seg.lastRiskScore >= 70,
          topFactors: (seg.lastRiskFactors ?? []) as Prisma.InputJsonValue,
          explanationText: `Recalculated after simulated heavy rainfall on ${seg.code}.`,
          modelVersion: 'demo-cascade-no-model',
        },
      }));
    }
    await Promise.all(segmentWrites);

    // 3 — candidate route risks and ETAs update.
    await Promise.all(after.routeCandidates.map((candidate) =>
      tx.route.update({
        where: { id: candidate.id },
        data: {
          riskScore: candidate.riskScore,
          riskLevel: candidate.riskLevel as 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL',
          etaMinutes: candidate.etaMinutes,
          isRecommended: candidate.isRecommended,
          topFactors: (candidate.topFactors ?? []) as Prisma.InputJsonValue,
          explanationText: candidate.explanationText ?? null,
          profile: (candidate.profile ?? null) as Prisma.InputJsonValue,
        },
      }),
    ));

    // 4 — delivery risk and ETA follow the road they are on.
    const deliveryWrites: Prisma.PrismaPromise<unknown>[] = [];
    for (const delivery of after.deliveries) {
      const baseline = world.deliveries.find((b) => b.id === delivery.id);
      if (!baseline) continue;
      const changed =
        baseline.status !== delivery.status ||
        baseline.failureProbability !== delivery.failureProbability ||
        baseline.expectedDelayMinutes !== delivery.expectedDelayMinutes;
      if (!changed) continue;

      deliveryWrites.push(tx.delivery.update({
        where: { id: delivery.id },
        data: {
          status: delivery.status as 'PENDING' | 'IN_TRANSIT' | 'AT_RISK' | 'DELIVERED' | 'FAILED',
          currentEta: new Date(delivery.currentEta),
          failureProbability: delivery.failureProbability ?? null,
          expectedDelayMinutes: delivery.expectedDelayMinutes ?? null,
        },
      }));
    }
    await Promise.all(deliveryWrites);

    // 5 — supply projections, derived from the delays just written.
    for (const district of after.districts) {
      const baseline = world.districts.find((b) => b.id === district.id);
      if (baseline?.stock.medicine.predictedStockoutHours === district.stock.medicine.predictedStockoutHours) {
        continue;
      }
      await reprojectMedicineCover(tx, district.id);
    }

    // 6 — alerts raised by the cascade.
    const feedWrites: Prisma.PrismaPromise<unknown>[] = [];
    for (const alert of after.alerts) {
      if (world.alerts.some((b) => b.id === alert.id)) continue;
      feedWrites.push(tx.alert.create({
        data: {
          id: alert.id,
          severity: alert.severity as 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL',
          title: alert.title,
          message: alert.message,
          relatedType: alert.relatedType ?? null,
          relatedId: alert.relatedId ?? null,
          notifiedViaTwilio: false, // Twilio is not wired; the row says so rather than implying a send.
          createdAt: new Date(alert.createdAt),
          demoGenerated: true,
        },
      }));
    }

    // 7 — notification records for those alerts.
    for (const n of after.notifications) {
      if (world.notifications.some((b) => b.id === n.id)) continue;
      const recipient = world.officers.find((o) => o.name === n.recipientName);
      feedWrites.push(tx.notification.create({
        data: {
          id: n.id,
          alertId: n.alertId,
          alertTitle: n.alertTitle,
          channel: n.channel,
          status: n.status,
          recipientId: recipient?.id ?? null,
          recipientName: n.recipientName,
          recipientRole: n.recipientRole as 'ADMIN' | 'LOGISTICS_OFFICER' | 'FIELD_OFFICER' | 'DISTRICT_OFFICER',
          recipientPhone: n.recipientPhone ?? null,
          failureReason: pick<string>(n, 'failureReason') ?? null,
          relatedId: pick<string>(n, 'relatedId') ?? null,
          sentAt: new Date(n.sentAt),
          demoGenerated: true,
        },
      }));
    }

    // 8 — movement statuses follow the delays.
    for (const m of after.movements) {
      feedWrites.push(tx.vehicleMovement.updateMany({
        where: { id: m.id },
        data: { status: m.status, delayMinutes: m.delayMinutes ?? null },
      }));
    }
    await Promise.all(feedWrites);

    // 9 — the decision engine runs last, over the world the cascade just produced. Only for
    // deliveries the cascade actually moved: re-deciding the seven it did not touch cannot
    // change their outcome, and each evaluation is several round trips.
    const routesNow = await tx.route.findMany({ select: { id: true, name: true, riskScore: true } });
    const touched = after.deliveries.filter((d) => {
      const baseline = world.deliveries.find((b) => b.id === d.id);
      return (
        baseline &&
        (baseline.status !== d.status ||
          baseline.failureProbability !== d.failureProbability ||
          baseline.expectedDelayMinutes !== d.expectedDelayMinutes)
      );
    });
    for (const delivery of touched) {
      await reconcileDeliveryDecision(tx, delivery.id, routesNow);
    }

    // District-level pre-positioning, for districts now under the line.
    const short = await tx.inventoryItem.findMany({
      where: { ownerType: 'DISTRICT', itemType: 'medicine', predictedStockoutHours: { lt: 48, not: null } },
    });
    for (const item of short) {
      const district = await tx.district.findUnique({ where: { id: item.ownerId } });
      if (!district) continue;
      const existing = await tx.aIRecommendation.findFirst({
        where: { targetType: 'DISTRICT', targetId: district.id, status: 'PENDING' },
      });
      if (existing) continue;
      await tx.aIRecommendation.create({
        data: {
          type: 'PRE_POSITION',
          targetType: 'DISTRICT',
          targetId: district.id,
          recommendationText: `Pre-position medicine to ${district.name}. Cover is projected at ${Math.round(item.predictedStockoutHours ?? 0)} hours, below the 48-hour line.`,
          confidence: 0.88,
          status: 'PENDING',
          demoGenerated: true,
        },
      });
    }

    return affected;
  }, CASCADE_TX);
}

// ---------------------------------------------------------------------------
// Reroute — delta D14
// ---------------------------------------------------------------------------

export async function rerouteDelivery(deliveryId: string, routeId: string) {
  return prisma.$transaction(async (tx) => {
    const delivery = await tx.delivery.findFirst({
      where: { OR: [{ id: deliveryId }, { code: deliveryId }] },
    });
    if (!delivery) throw ApiError.notFound('Delivery');

    const candidate = await tx.route.findUnique({ where: { id: routeId } });
    // 409, not 404: the route may exist but not be a candidate for this delivery, and the
    // frontend's HTTP adapter already has a sentence for exactly that case.
    if (!candidate) {
      throw new ApiError(409, 'That route is no longer a candidate for this delivery.');
    }
    if (candidate.id === delivery.assignedRouteId) {
      throw new ApiError(409, `${delivery.code} is already assigned to that route.`);
    }

    // The frozen `applyReroute`, rule for rule: the delivery inherits the ETA and the risk of
    // the road it is actually on, and its delay is measured against what was required.
    const requiredMinutes = (delivery.requiredEta.getTime() - DEMO_NOW) / 60_000;
    const delayMinutes = Math.max(0, Math.round(candidate.etaMinutes - requiredMinutes));

    const updated = await tx.delivery.update({
      where: { id: delivery.id },
      data: {
        assignedRouteId: candidate.id,
        currentEta: new Date(DEMO_NOW + candidate.etaMinutes * 60_000),
        expectedDelayMinutes: delayMinutes,
        failureProbability: candidate.riskScore / 100,
        status: delayMinutes > 0 || candidate.riskLevel === 'CRITICAL' ? 'AT_RISK' : 'IN_TRANSIT',
      },
    });

    // The vehicle is on the new road too.
    if (delivery.assignedVehicleId) {
      await tx.vehicle.updateMany({
        where: { id: delivery.assignedVehicleId },
        data: { currentRouteId: candidate.id },
      });
    }

    // The reroute's whole claim is that it protects the destination's supply, so the projection
    // has to hear about it. Without this the cause chain contradicts itself: "running to
    // schedule" sitting directly above hours of drag charged to this delivery being late.
    await reprojectMedicineCover(tx, delivery.destDistrictId);

    // Movements follow.
    await tx.vehicleMovement.updateMany({
      where: { deliveryCode: delivery.code },
      data: {
        status: delayMinutes > 0 ? 'DELAYED' : 'ON_ROUTE',
        delayMinutes: delayMinutes > 0 ? delayMinutes : null,
      },
    });

    // Re-run the ladder. The REROUTE recommendation retires here, because the condition that
    // produced it is no longer true — not because this endpoint deletes it by name.
    await reconcileDeliveryDecision(tx, delivery.id);

    // Any district recommendation whose projection has recovered retires with it.
    if (delivery.destDistrictId) {
      const item = await tx.inventoryItem.findFirst({
        where: { ownerType: 'DISTRICT', ownerId: delivery.destDistrictId, itemType: 'medicine' },
      });
      if ((item?.predictedStockoutHours ?? 0) >= 48) {
        await tx.aIRecommendation.deleteMany({
          where: { targetType: 'DISTRICT', targetId: delivery.destDistrictId, demoGenerated: true },
        });
      }
    }

    const remaining = await tx.aIRecommendation.findFirst({
      where: { targetType: 'DELIVERY', targetId: delivery.id, status: 'PENDING' },
      orderBy: { createdAt: 'desc' },
    });

    return { delivery: updated, recommendation: remaining };
  }, CASCADE_TX);
}

// ---------------------------------------------------------------------------
// Reset
// ---------------------------------------------------------------------------

/**
 * Restore the seeded baseline.
 *
 * Two different operations, and conflating them would be the mistake:
 *
 *   restore   demo-owned *state* — weather, risk scores, ETAs, projections — is written back to
 *             the seeded values. These rows always existed; only their values moved.
 *
 *   delete    rows a demonstration *created* — a filed incident, a cascade alert, a generated
 *             recommendation. Identified by `demoGenerated`, never by "created recently" or by
 *             truncating the table, so genuine operational history is untouched.
 */
export async function resetDemo(): Promise<void> {
  await prisma.$transaction(async (tx) => {
    // --- delete what a demonstration created ------------------------------
    await tx.aIRecommendation.deleteMany({ where: { demoGenerated: true } });
    await tx.notification.deleteMany({ where: { demoGenerated: true } });
    await tx.alert.deleteMany({ where: { demoGenerated: true } });
    await tx.incident.deleteMany({ where: { demoGenerated: true } });
    await tx.riskPrediction.deleteMany({ where: { modelVersion: 'demo-cascade-no-model' } });
    // ML rows made DURING the simulated episode describe a world this reset has just undone, so
    // they would be stale the moment it finishes. Baseline rows survive: they describe the world
    // being restored, and the prediction log is how Analytics and the demo-vs-ML comparison see
    // history. Delivery predictions go with them — every one was scored under that episode.
    await tx.riskPrediction.deleteMany({
      where: { provenance: 'ML_PREDICTION', scenario: 'heavy_rain' },
    });
    await tx.stockoutEvent.deleteMany({ where: { triggeredBy: 'SIMULATE_RAIN' } });

    // --- restore demo-owned state ----------------------------------------
    //
    // Only what actually differs. The first version wrote every seeded row back unconditionally:
    // fifteen segments, eight deliveries, forty-five inventory rows, twenty vehicles. Correct,
    // and it took **33 seconds** against a pooled remote database, because Prisma serialises a
    // transaction's queries over one connection and every one of those ninety writes paid a full
    // round trip. A cascade touches five or six rows, so restoring the other eighty-five is
    // ninety percent waste.
    //
    // Reading current state first costs five queries and turns the write set into just the rows
    // that moved.
    const [curSegments, curDeliveries, curInventory, curVehicles, curMovements] = await Promise.all([
      tx.routeSegment.findMany(),
      tx.delivery.findMany(),
      tx.inventoryItem.findMany({ where: { ownerType: 'DISTRICT' } }),
      tx.vehicle.findMany(),
      tx.vehicleMovement.findMany(),
    ]);

    const writes: Prisma.PrismaPromise<unknown>[] = [];

    // Segments generated from route geometry (Routes B and C — delta D50) are not in world.json,
    // so the diff-restore below cannot see them. An incident degrades their road state, and reset
    // has to put it back or the next demonstration starts on a blocked road.
    writes.push(
      ...generatedSegmentBaseline().map((seg) =>
        tx.routeSegment.updateMany({
          where: { code: seg.code },
          data: {
            currentStatus: 'OPEN',
            roadCondition: seg.roadCondition,
            lastRiskScore: null,
            lastRiskFactors: Prisma.DbNull,
          },
        }),
      ),
    );

    await tx.weatherSnapshot.updateMany({
      data: {
        rainfall1h: world.weather.rainfall1hMm,
        rainfall3h: Number((world.weather.rainfall1hMm * 2.4).toFixed(1)),
        rainfall6h: Number((world.weather.rainfall1hMm * 4.1).toFixed(1)),
        rainfall24h: world.weather.rainfall24hMm,
        windSpeedKmh: world.weather.windKmh,
        visibility: world.weather.visibilityKm >= 8 ? 'good' : 'moderate',
        isSimulated: false,
      },
    });

    // `roadCondition` is restored as well as risk and status. Until Phase 6B nothing ever wrote
    // it, so leaving it out of the diff was harmless; now an incident degrades the road it was
    // reported on, and a reset that skipped the condition left the corridor permanently POOR —
    // invisible in the demo's headline numbers and wrong in every feature vector after it.
    const physicals = new Map(
      world.segmentPhysicals.map((p) => [p.id, p.roadCondition as 'GOOD' | 'FAIR' | 'POOR']),
    );
    for (const seg of world.segments) {
      const current = curSegments.find((c) => c.id === seg.id);
      if (!current) continue;
      const roadCondition = physicals.get(seg.id) ?? current.roadCondition;
      if (
        current.lastRiskScore === seg.lastRiskScore &&
        current.currentStatus === seg.currentStatus &&
        current.roadCondition === roadCondition
      ) {
        continue;
      }
      writes.push(
        tx.routeSegment.update({
          where: { id: seg.id },
          data: {
            lastRiskScore: seg.lastRiskScore,
            currentStatus: seg.currentStatus as 'OPEN' | 'PARTIAL' | 'BLOCKED',
            lastRiskFactors: (seg.lastRiskFactors ?? []) as Prisma.InputJsonValue,
            roadCondition,
          },
        }),
      );
    }

    // Routes are only three rows and all three move together in the cascade, so they are
    // written unconditionally rather than diffed.
    for (const c of world.routeCandidates) {
      writes.push(
        tx.route.update({
          where: { id: c.id },
          data: {
            riskScore: c.riskScore,
            riskLevel: c.riskLevel as 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL',
            etaMinutes: c.etaMinutes,
            isRecommended: c.isRecommended,
            topFactors: (c.topFactors ?? []) as Prisma.InputJsonValue,
            explanationText: c.explanationText ?? null,
            profile: (c.profile ?? null) as Prisma.InputJsonValue,
          },
        }),
      );
    }

    for (const d of world.deliveries) {
      const current = curDeliveries.find((c) => c.id === d.id);
      if (!current) continue;
      const same =
        current.assignedRouteId === (d.assignedRouteId ?? null) &&
        current.status === d.status &&
        current.failureProbability === (d.failureProbability ?? null) &&
        current.expectedDelayMinutes === (d.expectedDelayMinutes ?? null) &&
        current.currentEta.toISOString() === new Date(d.currentEta).toISOString();
      if (same) continue;
      writes.push(
        tx.delivery.update({
          where: { id: d.id },
          data: {
            assignedRouteId: d.assignedRouteId ?? null,
            currentEta: new Date(d.currentEta),
            failureProbability: d.failureProbability ?? null,
            expectedDelayMinutes: d.expectedDelayMinutes ?? null,
            status: d.status as 'PENDING' | 'IN_TRANSIT' | 'AT_RISK' | 'DELIVERED' | 'FAILED',
          },
        }),
      );
    }

    for (const district of world.districts) {
      for (const [category, line] of Object.entries(district.stock)) {
        const current = curInventory.find((c) => c.ownerId === district.id && c.itemType === category);
        if (!current) continue;
        const same =
          current.currentStock === line.currentStock &&
          current.dailyConsumption === line.dailyConsumption &&
          current.predictedStockoutHours === line.predictedStockoutHours;
        if (same) continue;
        writes.push(
          tx.inventoryItem.update({
            where: { id: current.id },
            data: {
              currentStock: line.currentStock,
              dailyConsumption: line.dailyConsumption,
              predictedStockoutHours: line.predictedStockoutHours,
            },
          }),
        );
      }
    }

    for (const v of world.vehicles) {
      const current = curVehicles.find((c) => c.id === v.id);
      if (!current) continue;
      const delivery = world.deliveries.find((d) => d.id === v.currentDeliveryId);
      const routeId = delivery?.assignedRouteId ?? null;
      if (current.currentRouteId === routeId) continue;
      writes.push(tx.vehicle.update({ where: { id: v.id }, data: { currentRouteId: routeId } }));
    }

    for (const m of world.movements) {
      const current = curMovements.find((c) => c.id === m.id);
      if (!current) continue;
      if (current.status === m.status && current.delayMinutes === (m.delayMinutes ?? null)) continue;
      writes.push(
        tx.vehicleMovement.update({
          where: { id: m.id },
          data: { status: m.status, delayMinutes: m.delayMinutes ?? null },
        }),
      );
    }

    await Promise.all(writes);

    await tx.demoState.update({ where: { id: 'singleton' }, data: { simulated: false } });
  }, CASCADE_TX);
}

// ---------------------------------------------------------------------------
// Generated segments (Phase 6B)
// ---------------------------------------------------------------------------

interface GeneratedSegmentBaseline {
  code: string;
  roadCondition: 'GOOD' | 'FAIR' | 'POOR';
}

let generatedBaseline: GeneratedSegmentBaseline[] | null = null;

/**
 * The as-generated road condition of every segment Routes B and C own.
 *
 * Read once from the committed ORS artifact. An incident degrades a segment's condition to POOR;
 * reset has to know what it was before, and the artifact is the only record of that — world.json
 * describes Route A's fifteen segments and nothing else.
 *
 * A machine without the artifact gets an empty list and simply restores nothing extra, which is
 * correct: it has no generated segments either.
 */
function generatedSegmentBaseline(): GeneratedSegmentBaseline[] {
  if (generatedBaseline) return generatedBaseline;
  try {
    // Required lazily so a database that has never been through route generation still starts.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const artifact = require('../../prisma/seed-data/ors-routes.json') as {
      routes: { key: string; segments: { code: string; hazards?: { roadCondition: 'GOOD' | 'FAIR' | 'POOR' } }[] }[];
    };
    generatedBaseline = artifact.routes
      .filter((r) => r.key !== 'A') // Route A's fifteen are restored from world.json already
      .flatMap((r) =>
        r.segments.map((s) => ({ code: s.code, roadCondition: s.hazards?.roadCondition ?? ('FAIR' as const) })),
      );
  } catch {
    generatedBaseline = [];
  }
  return generatedBaseline;
}
