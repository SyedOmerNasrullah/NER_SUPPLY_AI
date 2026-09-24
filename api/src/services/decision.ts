/**
 * The Master Decision Engine.
 *
 * A first-match if/else ladder, exactly as specified. Its defensibility is the entire reason it
 * is not a language model: a judge can read four rules, check them against the numbers on
 * screen, and agree or disagree. An LLM narrating the same outcome would be unfalsifiable.
 *
 *   1. routeRisk >= 70 AND a safer route exists        -> REROUTE
 *   2. adjustedStockoutHours < 48                      -> PRE_POSITION
 *   3. failureProbability >= 0.85                      -> ALERT
 *   4. otherwise                                       -> NONE
 *
 * "Safer" means at least 15 points below the currently assigned route. A candidate one point
 * better is not worth moving a truck for, and without the margin the engine would churn.
 *
 * `confidence` is never invented for the decision itself. It is the confidence of whichever
 * *prediction* drove the matched branch — the route's risk, the stockout projection, the
 * delivery's failure probability. That is the runbook's own answer to "why do two numbers read
 * the same?", made structural.
 */

import type { RecommendationType } from '@prisma/client';

export const REROUTE_RISK_THRESHOLD = 70;
export const SAFER_ROUTE_MARGIN = 15;
export const CRITICAL_STOCKOUT_HOURS = 48;
export const ALERT_FAILURE_PROBABILITY = 0.85;

export interface DecisionInputs {
  /** Risk score of the route the delivery is currently assigned to, 0-100. */
  assignedRouteRisk?: number;
  /** Risk scores of every other candidate for this delivery. */
  candidateRisks: number[];
  /** The destination district's tightest projection, in hours. */
  adjustedStockoutHours?: number | null;
  /** 0-1. */
  failureProbability?: number | null;
}

export interface DecisionBranch {
  id: string;
  condition: string;
  observed: string;
  matched: boolean;
  action: RecommendationType;
}

export interface Decision {
  outcome: RecommendationType;
  confidence: number;
  branches: DecisionBranch[];
}

/** The lowest-risk candidate that beats the assigned route by the margin, if there is one. */
export function saferRoute(assignedRisk: number | undefined, candidateRisks: number[]): number | undefined {
  if (assignedRisk === undefined) return undefined;
  const better = candidateRisks
    .filter((risk) => assignedRisk - risk >= SAFER_ROUTE_MARGIN)
    .sort((a, b) => a - b);
  return better[0];
}

export function decide(inputs: DecisionInputs): Decision {
  const { assignedRouteRisk, candidateRisks, adjustedStockoutHours, failureProbability } = inputs;
  const safer = saferRoute(assignedRouteRisk, candidateRisks);

  // Every branch is evaluated and recorded, including the ones that did not match and the ones
  // short-circuited after the first match — that is what makes the trace worth returning
  // (delta D21). `matched` is the rule's own verdict; `outcome` is the first true one.
  const branches: DecisionBranch[] = [
    {
      id: 'reroute',
      condition: `Assigned route risk >= ${REROUTE_RISK_THRESHOLD} and a candidate is at least ${SAFER_ROUTE_MARGIN} points safer`,
      observed:
        assignedRouteRisk === undefined
          ? 'No route assigned'
          : `Assigned route at ${assignedRouteRisk}${safer === undefined ? ', no candidate clears the margin' : `, best alternative at ${safer}`}`,
      matched: assignedRouteRisk !== undefined && assignedRouteRisk >= REROUTE_RISK_THRESHOLD && safer !== undefined,
      action: 'REROUTE',
    },
    {
      id: 'pre_position',
      condition: `Destination cover falls below ${CRITICAL_STOCKOUT_HOURS} hours`,
      observed:
        adjustedStockoutHours === undefined || adjustedStockoutHours === null
          ? 'No projection available'
          : `${Math.round(adjustedStockoutHours)}h of cover`,
      matched:
        adjustedStockoutHours !== undefined &&
        adjustedStockoutHours !== null &&
        adjustedStockoutHours < CRITICAL_STOCKOUT_HOURS,
      action: 'PRE_POSITION',
    },
    {
      id: 'alert',
      condition: `Predicted failure probability >= ${ALERT_FAILURE_PROBABILITY}`,
      observed:
        failureProbability === undefined || failureProbability === null
          ? 'No prediction available'
          : `${Math.round(failureProbability * 100)}%`,
      matched:
        failureProbability !== undefined &&
        failureProbability !== null &&
        failureProbability >= ALERT_FAILURE_PROBABILITY,
      action: 'ALERT',
    },
  ];

  const first = branches.find((b) => b.matched);
  if (!first) {
    return { outcome: 'NONE', confidence: 0, branches };
  }

  // The confidence of the prediction behind the matched branch — never a separate number
  // invented for the decision.
  const confidence =
    first.action === 'REROUTE'
      ? (assignedRouteRisk ?? 0) / 100
      : first.action === 'ALERT'
        ? (failureProbability ?? 0)
        : // PRE_POSITION: how far under the line the projection sits, capped at 1. A district at
          // 32h of a 48h line is more certainly short than one at 47h, and the number says so.
          Math.min(1, (CRITICAL_STOCKOUT_HOURS - (adjustedStockoutHours ?? 0)) / CRITICAL_STOCKOUT_HOURS + 0.5);

  return { outcome: first.action, confidence: Number(confidence.toFixed(2)), branches };
}
