/**
 * PROJECT_CONTRACT.md section 2 — the ONLY place bucket boundaries are defined in the frontend.
 * No component may re-derive a threshold or hardcode a colour for a risk state.
 *
 * Contract delta (logged in docs/CONTRACT_DELTAS.md): section 2's UI note says HIGH and MEDIUM
 * share one accent because the old palette had three. The Phase 2 palette has four risk
 * colours, so HIGH now renders its own orange. The *boundaries* are unchanged — only the
 * colour assignment.
 */

import type { RiskLevel, Severity, SegmentStatus, DeliveryStatus, CargoPriority } from './types';

// ---------------------------------------------------------------------------
// Buckets
// ---------------------------------------------------------------------------

/** riskScore: integer 0-100. Applies to segments, route candidates, anywhere a score appears. */
export function riskLevelForScore(score: number): RiskLevel {
  if (score >= 85) return 'CRITICAL';
  if (score >= 70) return 'HIGH';
  if (score >= 40) return 'MEDIUM';
  return 'LOW';
}

/** failureProbability: float 0-1. Same boundaries, different scale. */
export function riskLevelForProbability(p: number): RiskLevel {
  return riskLevelForScore(Math.round(p * 100));
}

export type StockoutUrgency = 'CRITICAL' | 'WARNING' | 'NORMAL';

/** predictedStockoutHours: <48 critical, 48-96 warning, >=96 normal. Null = no projection. */
export function stockoutUrgency(hours: number | null): StockoutUrgency | null {
  if (hours === null) return null;
  if (hours < 48) return 'CRITICAL';
  if (hours < 96) return 'WARNING';
  return 'NORMAL';
}

/** Stockout urgency mapped onto the risk scale, so one chip component serves both. */
export function stockoutAsRiskLevel(hours: number | null): RiskLevel | null {
  const urgency = stockoutUrgency(hours);
  if (urgency === null) return null;
  return urgency === 'CRITICAL' ? 'CRITICAL' : urgency === 'WARNING' ? 'MEDIUM' : 'LOW';
}

/** Severity and RiskLevel are the same four values; this makes the intent explicit at usage. */
export function severityAsRiskLevel(severity: Severity): RiskLevel {
  return severity;
}

// ---------------------------------------------------------------------------
// Tone — the single bridge from a domain state to a design token
// ---------------------------------------------------------------------------

/**
 * Class fragments per risk level. Components compose these rather than writing colour
 * utilities inline, which is what keeps the four risk colours from leaking into ad-hoc greens
 * and reds across features.
 */
export interface RiskTone {
  /** Solid fill, e.g. a gauge arc or a filled chip. */
  bg: string;
  /** Tinted wash behind a chip or alert row. */
  wash: string;
  /** Foreground text at readable contrast on `wash` or on panel white. */
  text: string;
  /** Border for a chip sitting on `wash`. */
  border: string;
  /** Left accent rail on an alert row. */
  rail: string;
  /** Raw CSS colour, for canvas/SVG/Leaflet where a class cannot be used. */
  cssVar: string;
}

export const RISK_TONE: Record<RiskLevel, RiskTone> = {
  CRITICAL: {
    bg: 'bg-risk-critical',
    wash: 'bg-risk-wash-critical',
    text: 'text-risk-critical',
    border: 'border-risk-critical/25',
    rail: 'bg-risk-critical',
    cssVar: 'rgb(var(--risk-critical))',
  },
  HIGH: {
    bg: 'bg-risk-high',
    wash: 'bg-risk-wash-high',
    text: 'text-risk-high',
    border: 'border-risk-high/25',
    rail: 'bg-risk-high',
    cssVar: 'rgb(var(--risk-high))',
  },
  MEDIUM: {
    bg: 'bg-risk-medium',
    wash: 'bg-risk-wash-medium',
    text: 'text-risk-medium',
    border: 'border-risk-medium/30',
    rail: 'bg-risk-medium',
    cssVar: 'rgb(var(--risk-medium))',
  },
  LOW: {
    bg: 'bg-risk-low',
    wash: 'bg-risk-wash-low',
    text: 'text-risk-low',
    border: 'border-risk-low/25',
    rail: 'bg-risk-low',
    cssVar: 'rgb(var(--risk-low))',
  },
};

export const toneForScore = (score: number): RiskTone => RISK_TONE[riskLevelForScore(score)];
export const toneForSeverity = (severity: Severity): RiskTone => RISK_TONE[severity];

// ---------------------------------------------------------------------------
// Status → tone, for the states that are not themselves risk buckets
// ---------------------------------------------------------------------------

export const SEGMENT_STATUS_LEVEL: Record<SegmentStatus, RiskLevel> = {
  BLOCKED: 'CRITICAL',
  PARTIAL: 'MEDIUM',
  OPEN: 'LOW',
};

export const DELIVERY_STATUS_LEVEL: Record<DeliveryStatus, RiskLevel> = {
  FAILED: 'CRITICAL',
  AT_RISK: 'HIGH',
  PENDING: 'MEDIUM',
  IN_TRANSIT: 'LOW',
  DELIVERED: 'LOW',
};

export const PRIORITY_LEVEL: Record<CargoPriority, RiskLevel> = {
  CRITICAL: 'CRITICAL',
  HIGH: 'HIGH',
  MEDIUM: 'MEDIUM',
  LOW: 'LOW',
};

/**
 * Contract 6.12: a vehicle below 40% of its expected speed is the same condition that raises a
 * GPS-anomaly alert. Reused here so the map's vehicle colouring and the alert agree.
 */
export const GPS_ANOMALY_SPEED_RATIO = 0.4;

export function vehicleToneLevel(speedKmh: number, expectedSpeedKmh: number, stopped: boolean) {
  if (stopped) return 'CRITICAL' as RiskLevel;
  if (expectedSpeedKmh > 0 && speedKmh < expectedSpeedKmh * GPS_ANOMALY_SPEED_RATIO) {
    return 'HIGH' as RiskLevel;
  }
  return 'LOW' as RiskLevel;
}
