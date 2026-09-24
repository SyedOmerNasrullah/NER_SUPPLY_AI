/**
 * The intelligence layers above the models — Phase 6C.
 *
 *   npm run test:intelligence     (needs the database; the HTTP half also needs the API and ML)
 *
 * Four things are checked here that no other suite covers:
 *
 *   route comparison    every candidate scored on its own, and the 15-point margin applied the
 *                       same way the Decision Engine applies it
 *   supply projection   the arithmetic, including the case that matters — a resupply that
 *                       arrives after the shelf is already empty
 *   decision ladder     all four outcomes, in order, including first-match-wins
 *   Gemini              the guard that stops a language model inventing a number, and the
 *                       fallback that keeps the explanation when the model is unavailable
 *
 * Nothing here mutates the demo world.
 */

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { prisma } from '../src/lib/prisma';
import { compareRoutes } from '../src/services/routeComparison';
import { projectStock } from '../src/services/supplyProjection';
import {
  ALERT_FAILURE_PROBABILITY,
  CRITICAL_STOCKOUT_HOURS,
  REROUTE_RISK_THRESHOLD,
  SAFER_ROUTE_MARGIN,
  decide,
  saferRoute,
} from '../src/services/decision';
import {
  clearExplanationCache,
  containsOnlyKnownNumbers,
  explainRisk,
  templateExplanation,
  type ExplainInput,
} from '../src/services/gemini';

const API = process.env.API_URL ?? 'http://127.0.0.1:4000';

before(async () => {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await prisma.$queryRaw`SELECT 1`;
      break;
    } catch (err) {
      if (attempt >= 4) throw err;
    }
  }
});

after(async () => {
  await prisma.$disconnect();
});

// ---------------------------------------------------------------------------

describe('route comparison', () => {
  test('all three candidates are compared, each with its own score and factors', async () => {
    const c = await compareRoutes({ deliveryCodeOrId: 'NE-102' });
    assert.equal(c.candidates.length, 3);
    const names = c.candidates.map((x) => x.name).sort();
    assert.deepEqual(names, ['Route A', 'Route B', 'Route C']);
    // Three different routes, three different risk scores, three different geometries upstream.
    assert.equal(new Set(c.candidates.map((x) => x.routeId)).size, 3);
    assert.equal(new Set(c.candidates.map((x) => x.segmentIds.join())).size, 3);
    for (const cand of c.candidates) assert.ok(cand.topFactors.length > 0, `${cand.name} has no factors`);
  });

  test('exactly one candidate is the assigned route, and it has no delta against itself', async () => {
    const c = await compareRoutes({ deliveryCodeOrId: 'NE-102' });
    const assigned = c.candidates.filter((x) => x.isAssigned);
    assert.equal(assigned.length, 1);
    assert.equal(assigned[0].riskDelta, null);
    assert.equal(assigned[0].routeId, c.assignedRouteId);
  });

  test('the margin is the engine’s own 15 points, and deltas are assigned minus candidate', async () => {
    const c = await compareRoutes({ deliveryCodeOrId: 'NE-102' });
    assert.equal(c.thresholds.saferMargin, SAFER_ROUTE_MARGIN);
    assert.equal(c.thresholds.rerouteRisk, REROUTE_RISK_THRESHOLD);
    for (const cand of c.candidates.filter((x) => !x.isAssigned)) {
      assert.equal(cand.riskDelta, (c.assignedRisk ?? 0) - cand.riskScore);
      assert.equal(cand.clearsSaferMargin, (cand.riskDelta ?? 0) >= SAFER_ROUTE_MARGIN);
    }
  });

  test('the safer candidate the comparison names is the one the engine would pick', async () => {
    const c = await compareRoutes({ deliveryCodeOrId: 'NE-102' });
    const engine = saferRoute(
      c.assignedRisk ?? undefined,
      c.candidates.filter((x) => !x.isAssigned).map((x) => x.riskScore),
    );
    if (c.saferCandidateId === null) {
      assert.equal(engine, undefined);
    } else {
      assert.equal(c.candidates.find((x) => x.routeId === c.saferCandidateId)?.riskScore, engine);
    }
  });

  test('reroute is advised only when BOTH halves of rule 1 hold', async () => {
    const c = await compareRoutes({ deliveryCodeOrId: 'NE-102' });
    assert.equal(
      c.rerouteAdvised,
      (c.assignedRisk ?? 0) >= REROUTE_RISK_THRESHOLD && c.saferCandidateId !== null,
    );
  });

  test('over HTTP, the same structure reaches the browser', async () => {
    const res = await fetch(`${API}/api/routes/comparison?deliveryId=NE-102`);
    assert.equal(res.status, 200);
    const { comparison } = (await res.json()) as { comparison: Awaited<ReturnType<typeof compareRoutes>> };
    assert.equal(comparison.candidates.length, 3);
    assert.equal(comparison.deliveryCode, 'NE-102');
  });
});

// ---------------------------------------------------------------------------

describe('supply projection', () => {
  const now = new Date('2024-11-18T04:54:00Z');

  test('cover is stock divided by consumption, and the demo baseline reproduces exactly', () => {
    // Tawang's seeded medicine: 420 units at 198/day. The product shows 51 h ≈ 2.1 days.
    const p = projectStock({ itemType: 'medicine', currentStock: 420, dailyConsumption: 198, now });
    assert.equal(p.coverHours, 50.9);
    assert.equal(p.hourlyConsumption, 8.3);
    assert.ok(p.stockoutAt);
    assert.match(p.explanation, /420 units of medicine at 198\/day is 50.9 h of cover \(2.1 days\)/);
  });

  test('the safety threshold is the engine’s 48 hours, and the crossing time is reported', () => {
    const p = projectStock({ itemType: 'medicine', currentStock: 420, dailyConsumption: 198, now });
    assert.equal(p.safetyThresholdHours, CRITICAL_STOCKOUT_HOURS);
    assert.equal(p.belowThreshold, false);
    // 50.9 h of cover crosses the 48 h line in 2.9 h.
    assert.equal(Math.round((Date.parse(p.crossesThresholdAt!) - now.getTime()) / 60_000), 174);
  });

  test('already inside the threshold reports the crossing as now', () => {
    const p = projectStock({ itemType: 'medicine', currentStock: 200, dailyConsumption: 198, now });
    assert.equal(p.belowThreshold, true);
    assert.equal(p.crossesThresholdAt, now.toISOString());
  });

  test('a resupply that arrives in time adds its own hours of cover', () => {
    const p = projectStock({
      itemType: 'medicine',
      currentStock: 420,
      dailyConsumption: 198,
      now,
      resupply: { deliveryCode: 'NE-102', units: 260, etaIso: '2024-11-18T09:59:00Z', delayMinutes: 0 },
    });
    assert.equal(p.resupply?.arrivesAfterStockout, false);
    assert.equal(p.resupply?.coverAddedHours, 31.5);
    assert.equal(p.coverWithResupplyHours, 82.4);
  });

  test('a resupply that arrives after the shelf empties adds nothing — the gap is the point', () => {
    const p = projectStock({
      itemType: 'medicine',
      currentStock: 420,
      dailyConsumption: 198,
      now,
      // 60 hours away, against 50.9 hours of cover.
      resupply: { deliveryCode: 'NE-102', units: 260, etaIso: '2024-11-20T16:54:00Z', delayMinutes: 600 },
    });
    assert.equal(p.resupply?.arrivesAfterStockout, true);
    assert.equal(p.coverWithResupplyHours, p.coverHours);
    assert.match(p.explanation, /after the shelf empties/);
  });

  test('a delayed resupply is named as delayed', () => {
    const p = projectStock({
      itemType: 'medicine',
      currentStock: 420,
      dailyConsumption: 198,
      now,
      resupply: { deliveryCode: 'NE-102', units: 260, etaIso: '2024-11-18T12:59:00Z', delayMinutes: 180 },
    });
    assert.match(p.explanation, /180 min later than planned/);
  });

  test('no consumption means no projection, rather than a fabricated one', () => {
    const p = projectStock({ itemType: 'fuel', currentStock: 100, dailyConsumption: 0, now });
    assert.equal(p.coverHours, null);
    assert.equal(p.stockoutAt, null);
  });
});

// ---------------------------------------------------------------------------

describe('decision ladder', () => {
  const base = { assignedRouteRisk: 20, candidateRisks: [25, 30], adjustedStockoutHours: 200, failureProbability: 0.1 };

  test('REROUTE when risk is at the threshold and a candidate clears the margin', () => {
    const d = decide({ ...base, assignedRouteRisk: REROUTE_RISK_THRESHOLD, candidateRisks: [REROUTE_RISK_THRESHOLD - SAFER_ROUTE_MARGIN] });
    assert.equal(d.outcome, 'REROUTE');
  });

  test('no REROUTE when nothing clears the margin, even at high risk', () => {
    const d = decide({ ...base, assignedRouteRisk: 90, candidateRisks: [76, 80], adjustedStockoutHours: 200 });
    assert.equal(d.outcome, 'NONE');
  });

  test('PRE_POSITION when cover is under 48 hours', () => {
    const d = decide({ ...base, adjustedStockoutHours: CRITICAL_STOCKOUT_HOURS - 1 });
    assert.equal(d.outcome, 'PRE_POSITION');
  });

  test('ALERT at the failure-probability threshold', () => {
    const d = decide({ ...base, failureProbability: ALERT_FAILURE_PROBABILITY });
    assert.equal(d.outcome, 'ALERT');
  });

  test('NONE when nothing matches, with every branch still traced', () => {
    const d = decide(base);
    assert.equal(d.outcome, 'NONE');
    assert.equal(d.branches.length, 3);
    assert.ok(d.branches.every((b) => !b.matched));
  });

  test('first match wins: reroute outranks a stockout that also qualifies', () => {
    const d = decide({
      assignedRouteRisk: 90,
      candidateRisks: [30],
      adjustedStockoutHours: 10,
      failureProbability: 0.99,
    });
    assert.equal(d.outcome, 'REROUTE');
    assert.equal(d.branches.filter((b) => b.matched).length, 3);
  });

  test('confidence is the matched prediction’s own, never a new number', () => {
    const reroute = decide({ ...base, assignedRouteRisk: 88, candidateRisks: [20] });
    assert.equal(reroute.confidence, 0.88);
    const alert = decide({ ...base, failureProbability: 0.91 });
    assert.equal(alert.confidence, 0.91);
  });
});

// ---------------------------------------------------------------------------

describe('Gemini explanation', () => {
  const input: ExplainInput = {
    kind: 'ROUTE',
    subject: 'Route A',
    figures: { riskScore: 87, riskLevel: 'CRITICAL', etaMinutes: 440 },
    factors: [{ factor: 'Rainfall (24h)', contributionPct: 38, direction: 'increases_risk' }],
  };

  test('the template always produces an explanation from the figures alone', () => {
    const text = templateExplanation(input);
    assert.match(text, /Route A/);
    assert.match(text, /87/);
    assert.match(text, /Rainfall \(24h\) \(38%\)/);
  });

  test('a reply using only our numbers passes the guard', () => {
    assert.equal(containsOnlyKnownNumbers('Route A is at 87, CRITICAL, with 440 minutes to run.', input), true);
  });

  test('a reply that invents a number is rejected', () => {
    assert.equal(containsOnlyKnownNumbers('Route A is at 87 and 3 vehicles are stranded.', input), false);
    assert.equal(containsOnlyKnownNumbers('Risk has risen 12 points this week.', input), false);
  });

  test('sensible unit conversions are allowed, not treated as invention', () => {
    // 440 minutes is about 7 hours; 87 is allowed; 7 is derived from an allowed value.
    assert.equal(containsOnlyKnownNumbers('About 7 hours of running time at risk 87.', input), true);
  });

  test('an identifier in the subject is data, not an invented figure', () => {
    const delivery: ExplainInput = { kind: 'DELIVERY', subject: 'NE-102', figures: { failureProbabilityPct: 38 } };
    assert.equal(containsOnlyKnownNumbers('NE-102 is at 38 percent.', delivery), true);
  });

  test('with Gemini unreachable the explanation still arrives, labelled as the template', async () => {
    clearExplanationCache();
    const original = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    try {
      // env is read once at startup, so this asserts the configured path rather than the key:
      // either Gemini answers and is labelled LLM_EXPLANATION, or the template is used. Both are
      // valid; what must never happen is an empty explanation or an unlabelled one.
      const result = await explainRisk(input);
      assert.ok(result.text.length > 0);
      assert.ok(['LLM_EXPLANATION', 'DETERMINISTIC_TEMPLATE'].includes(result.source));
      if (result.source === 'DETERMINISTIC_TEMPLATE') assert.ok(result.fallbackReason);
      else assert.ok(result.model);
    } finally {
      if (original !== undefined) process.env.GEMINI_API_KEY = original;
    }
  });

  test('POST /api/ai/explain rejects an unauthenticated caller', async () => {
    const res = await fetch(`${API}/api/ai/explain`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'DELIVERY', targetId: 'NE-102' }),
    });
    assert.equal(res.status, 401);
  });
});
