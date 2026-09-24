/**
 * Risk bands — PROJECT_CONTRACT §2, for the backend.
 *
 * The same boundaries as `riskLevelForScore` in web/src/domain/thresholds.ts and `RISK_BANDS` in
 * ml/app/domain.py. Three languages' worth of copies is two too many, but a TypeScript backend
 * cannot import from the frontend bundle, and Python cannot import either; the ML test suite
 * reads the TypeScript file and fails if its bands drift.
 *
 * New backend code uses this module. Two older sites (`services/demoState.ts`, `prisma/seed.ts`)
 * still inline the numbers; they replay frozen demo values and are left untouched in Phase 5A.
 */

export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export const RISK_BANDS = [
  { floor: 85, level: 'CRITICAL' },
  { floor: 70, level: 'HIGH' },
  { floor: 40, level: 'MEDIUM' },
] as const satisfies readonly { floor: number; level: RiskLevel }[];

export function riskLevelForScore(score: number): RiskLevel {
  return RISK_BANDS.find((b) => score >= b.floor)?.level ?? 'LOW';
}
