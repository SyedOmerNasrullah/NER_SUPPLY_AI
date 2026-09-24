/**
 * Post-seed verification.
 *
 * Counts every table and checks the handful of values the demo's whole narrative rests on. If
 * the database and the frozen frontend ever disagree about Route A's risk score or Tawang's
 * medicine cover, this is where it shows up — before a judge finds it.
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const counts: Record<string, number> = {
    User: await prisma.user.count(),
    District: await prisma.district.count(),
    Warehouse: await prisma.warehouse.count(),
    InventoryItem: await prisma.inventoryItem.count(),
    RouteSegment: await prisma.routeSegment.count(),
    Route: await prisma.route.count(),
    Vehicle: await prisma.vehicle.count(),
    Delivery: await prisma.delivery.count(),
    Incident: await prisma.incident.count(),
    Alert: await prisma.alert.count(),
    AIRecommendation: await prisma.aIRecommendation.count(),
    VehicleMovement: await prisma.vehicleMovement.count(),
    Notification: await prisma.notification.count(),
    WeatherSnapshot: await prisma.weatherSnapshot.count(),
    RiskPrediction: await prisma.riskPrediction.count(),
    StockoutEvent: await prisma.stockoutEvent.count(),
    DailyPerformance: await prisma.dailyPerformance.count(),
    DemoState: await prisma.demoState.count(),
  };

  console.log('Row counts');
  for (const [table, n] of Object.entries(counts)) console.log(`  ${table.padEnd(18)} ${n}`);
  console.log(`  ${'TOTAL'.padEnd(18)} ${Object.values(counts).reduce((a, b) => a + b, 0)}\n`);

  const routes = await prisma.route.findMany({ orderBy: { name: 'asc' } });
  const ne102 = await prisma.delivery.findUnique({ where: { code: 'NE-102' } });
  const tawang = await prisma.district.findFirst({ where: { name: 'Tawang' } });
  const medicine = tawang
    ? await prisma.inventoryItem.findFirst({
        where: { ownerId: tawang.id, itemType: 'medicine' },
      })
    : null;
  const seg010 = await prisma.routeSegment.findUnique({ where: { code: 'SEG-010' } });
  const officers = await prisma.user.count({ where: { role: 'FIELD_OFFICER' } });
  const blocked = await prisma.routeSegment.count({ where: { currentStatus: { not: 'OPEN' } } });

  const checks: [string, unknown, unknown][] = [
    ['Route A risk', routes.find((r) => r.name.startsWith('Route A'))?.riskScore, 21],
    ['Route B risk', routes.find((r) => r.name.startsWith('Route B'))?.riskScore, 28],
    ['Route C risk', routes.find((r) => r.name.startsWith('Route C'))?.riskScore, 41],
    ['Route A ETA (min)', routes.find((r) => r.name.startsWith('Route A'))?.etaMinutes, 305],
    ['NE-102 status', ne102?.status, 'IN_TRANSIT'],
    ['NE-102 failure probability', ne102?.failureProbability, 0.18],
    ['NE-102 delay', ne102?.expectedDelayMinutes, 0],
    ['NE-102 route = Route A', ne102?.assignedRouteId, routes.find((r) => r.name.startsWith('Route A'))?.id],
    ['Tawang medicine cover (h)', medicine?.predictedStockoutHours, 51],
    ['Tawang medicine stock', medicine?.currentStock, 420],
    ['SEG-010 risk', seg010?.lastRiskScore, 43],
    ['SEG-010 status', seg010?.currentStatus, 'OPEN'],
    ['Field officers', officers, 12],
    ['Segments not fully open', blocked, 2],
    ['Simulation active', (await prisma.demoState.findUnique({ where: { id: 'singleton' } }))?.simulated, false],
  ];

  console.log('Baseline checks (database vs the frozen frontend)');
  let failures = 0;
  for (const [label, actual, expected] of checks) {
    const ok = actual === expected;
    if (!ok) failures += 1;
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label.padEnd(28)} ${String(actual)}${ok ? '' : `  (expected ${String(expected)})`}`);
  }

  console.log(failures === 0 ? '\nAll baseline checks passed.' : `\n${failures} check(s) FAILED.`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().finally(() => prisma.$disconnect());
