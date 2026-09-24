/**
 * Bars — the horizontal information graphics.
 *
 * FactorBar is the most important component in the product. It is how SHAP output becomes
 * something a judge can read in two seconds: which factor drove this score, and by how much.
 * It gets the care accordingly — aligned labels, a shared scale across a group, and a value
 * that is always legible against its own bar.
 */

import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { RISK_TONE, riskLevelForScore } from '@/domain/thresholds';
import type { RiskFactor, RiskLevel } from '@/domain/types';
import { Icon, type IconName } from '../icons';

// ---------------------------------------------------------------------------
// ProgressBar
// ---------------------------------------------------------------------------

export interface ProgressBarProps {
  /** 0-100. */
  value: number;
  /** Colour by risk bucket, by an explicit level, or brand blue for neutral quantities. */
  level?: RiskLevel | 'brand' | 'neutral';
  /** Derives the level from the value using the contract's own thresholds. */
  byScore?: boolean;
  size?: 'sm' | 'md' | 'lg';
  /** A dashed rule at this percentage — a safety line, a threshold, a target. */
  marker?: number;
  markerLabel?: string;
  className?: string;
}

const TRACK_H = { sm: 'h-1', md: 'h-1.5', lg: 'h-2.5' } as const;

export function ProgressBar({
  value,
  level,
  byScore = false,
  size = 'md',
  marker,
  markerLabel,
  className,
}: ProgressBarProps) {
  const pct = Math.max(0, Math.min(100, value));
  const resolved = byScore ? riskLevelForScore(pct) : level;

  const fill =
    resolved === 'brand' || resolved === undefined
      ? 'bg-brand-500'
      : resolved === 'neutral'
        ? 'bg-ink-3'
        : RISK_TONE[resolved].rail;

  return (
    <div className={cn('relative w-full', className)}>
      <div
        className={cn('w-full overflow-hidden rounded-full bg-panel-sunk', TRACK_H[size])}
        role="progressbar"
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className={cn('h-full rounded-full transition-[width] duration-700 ease-ui', fill)}
          style={{ width: `${pct}%` }}
        />
      </div>

      {marker !== undefined ? (
        <div
          className="pointer-events-none absolute -top-0.5 bottom-[-2px] w-px bg-ink/45"
          style={{ left: `${Math.max(0, Math.min(100, marker))}%` }}
          title={markerLabel}
        />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// FactorBar — one SHAP contribution
// ---------------------------------------------------------------------------

export interface FactorBarProps {
  factor: string;
  /** Normalised absolute contribution. Top factors need not sum to 100 (contract section 3). */
  contributionPct: number;
  /** The largest contribution in the group, so bars in a set share one scale. */
  scaleMax: number;
  /** Colours the bar by the overall risk level it contributed to. */
  level?: RiskLevel;
  className?: string;
}

export function FactorBar({
  factor,
  contributionPct,
  scaleMax,
  level = 'HIGH',
  className,
}: FactorBarProps) {
  const width = scaleMax > 0 ? (contributionPct / scaleMax) * 100 : 0;
  const tone = RISK_TONE[level];

  return (
    <div className={cn('grid grid-cols-[132px_1fr_44px] items-center gap-2.5', className)}>
      <span className="truncate text-meta text-ink-2" title={factor}>
        {factor}
      </span>

      <div className="h-[9px] w-full overflow-hidden rounded-[3px] bg-panel-sunk">
        <div
          className={cn('h-full rounded-[3px] transition-[width] duration-700 ease-ui', tone.rail)}
          style={{ width: `${Math.max(2, width)}%` }}
        />
      </div>

      <span className={cn('tnum text-right text-meta font-semibold', tone.text)}>
        +{contributionPct}%
      </span>
    </div>
  );
}

/**
 * One signed SHAP contribution, drawn from a centre line — delta D57.
 *
 * A left-anchored bar with a `+` in front of it cannot describe SHAP, because SHAP is signed:
 * the model regularly finds that light traffic or a low closure rate is pushing predicted risk
 * DOWN, and rendering that as "+5.05%" says the opposite of what the model found. Hiding the
 * negative rows would be worse still — they are half the explanation of why a score is not
 * higher than it is.
 *
 * So the axis sits in the middle. Right of it increases risk, left of it reduces risk, and the
 * number on the right is the model's own value with its own sign.
 */
function SignedFactorBar({
  factor,
  shapValue,
  unit,
  scaleMax,
  detail,
  className,
}: {
  factor: string;
  shapValue: number;
  unit?: string;
  scaleMax: number;
  detail?: string;
  className?: string;
}) {
  const magnitude = scaleMax > 0 ? (Math.abs(shapValue) / scaleMax) * 50 : 0;
  const increases = shapValue >= 0;
  return (
    <div className={cn('grid grid-cols-[132px_1fr_62px] items-center gap-2.5', className)}>
      <span className="truncate text-meta text-ink-2" title={detail ? `${factor} — ${detail}` : factor}>
        {factor}
      </span>

      <div className="relative h-[9px] w-full rounded-[3px] bg-panel-sunk">
        {/* The zero line. Everything is read against this. */}
        <span aria-hidden className="absolute inset-y-[-2px] left-1/2 w-px -translate-x-1/2 bg-line" />
        <div
          className={cn(
            'absolute top-0 h-full rounded-[3px] transition-[width,left,right] duration-700 ease-ui',
            increases ? 'bg-risk-high' : 'bg-risk-low',
          )}
          style={
            increases
              ? { left: '50%', width: `${Math.max(1.5, magnitude)}%` }
              : { right: '50%', width: `${Math.max(1.5, magnitude)}%` }
          }
        />
      </div>

      <span
        className={cn(
          'tnum text-right text-meta font-semibold',
          increases ? 'text-risk-high' : 'text-risk-low',
        )}
        title={unit ? `${shapValue} ${unit}` : String(shapValue)}
      >
        {increases ? '+' : '\u2212'}
        {Math.abs(shapValue).toFixed(2)}
      </span>
    </div>
  );
}

/**
 * A full SHAP breakdown. Computes the shared scale itself so a caller cannot accidentally
 * render two factor groups on different scales and make them look comparable when they are not.
 *
 * Two renderings, chosen by what the data actually carries:
 *
 *   - `shapValue` present — the factor came from the model. Signed bars around a centre line,
 *     labelled with the model's own value in risk points.
 *   - `shapValue` absent  — a seeded fixture. The original magnitude bar, unchanged, because
 *     there is no sign to show and inventing one would be a lie about a demo value.
 */
export function FactorBreakdown({
  factors,
  level = 'HIGH',
  className,
}: {
  factors: RiskFactor[];
  level?: RiskLevel;
  className?: string;
}) {
  const signed = factors.filter((f) => typeof f.shapValue === 'number');
  if (signed.length === factors.length && factors.length > 0) {
    const scaleMax = factors.reduce((m, f) => Math.max(m, Math.abs(f.shapValue!)), 0);
    return (
      <div className={cn('flex flex-col gap-2', className)}>
        {factors.map((f) => (
          <SignedFactorBar
            key={f.factor}
            factor={f.factor}
            shapValue={f.shapValue!}
            unit={f.shapUnit}
            scaleMax={scaleMax}
            detail={f.value !== undefined ? `model input: ${f.value}` : undefined}
          />
        ))}
        <p className="mt-0.5 text-[9.5px] leading-snug text-ink-3">
          SHAP values in risk points. Right of the axis raised the prediction, left of it lowered
          it.
        </p>
      </div>
    );
  }

  const scaleMax = factors.reduce((m, f) => Math.max(m, f.contributionPct), 0);
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      {factors.map((f) => (
        <FactorBar
          key={f.factor}
          factor={f.factor}
          contributionPct={f.contributionPct}
          scaleMax={scaleMax}
          level={level}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Meter — a labelled quantity against a capacity
// ---------------------------------------------------------------------------

export function Meter({
  label,
  value,
  max,
  unit,
  level,
  markerLabel,
  marker,
  className,
}: {
  label: string;
  value: number;
  max: number;
  unit?: string;
  level?: RiskLevel | 'brand';
  marker?: number;
  markerLabel?: string;
  className?: string;
}) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="t-label">{label}</span>
        <span className="tnum text-body font-semibold text-ink">
          {value.toLocaleString('en-IN')}
          {unit ? <span className="ml-0.5 text-meta font-medium text-ink-3">{unit}</span> : null}
        </span>
      </div>
      <ProgressBar
        value={pct}
        level={level ?? 'brand'}
        size="lg"
        marker={marker}
        markerLabel={markerLabel}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Legend
// ---------------------------------------------------------------------------

export interface LegendItem {
  label: string;
  /** A raw CSS colour — legends describe map and chart marks, which are not Tailwind classes. */
  color: string;
  /** Line style, for route ribbons and boundaries. */
  style?: 'solid' | 'dashed' | 'dot';
  icon?: IconName;
}

/**
 * Describes what the marks on a map or chart mean. Horizontal by default; `column` for the
 * map's floating legend panel.
 */
export function Legend({
  items,
  direction = 'row',
  onNavy = false,
  className,
}: {
  items: LegendItem[];
  direction?: 'row' | 'column';
  onNavy?: boolean;
  className?: string;
}) {
  return (
    <ul
      className={cn(
        'flex gap-x-4 gap-y-1.5',
        direction === 'row' ? 'flex-wrap items-center' : 'flex-col',
        className,
      )}
    >
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-2">
          {item.icon ? (
            <Icon
              name={item.icon}
              size="sm"
              className={onNavy ? 'text-white/70' : 'text-ink-2'}
            />
          ) : item.style === 'dot' ? (
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ background: item.color }}
            />
          ) : (
            <span
              className="h-0 w-5 shrink-0"
              style={{
                borderTop: `${item.style === 'dashed' ? '2px dashed' : '3px solid'} ${item.color}`,
              }}
            />
          )}
          <span className={cn('text-meta', onNavy ? 'text-white/75' : 'text-ink-2')}>
            {item.label}
          </span>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// SectionLabel
// ---------------------------------------------------------------------------

/**
 * The small uppercase heading that opens a band of content. Optionally carries a hairline rule
 * that fills the remaining width — a cheap way to structure a dense panel without adding
 * another bordered box.
 */
export function SectionLabel({
  children,
  rule = false,
  actions,
  onNavy = false,
  className,
}: {
  children: ReactNode;
  rule?: boolean;
  actions?: ReactNode;
  onNavy?: boolean;
  className?: string;
}) {
  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      <span
        className={cn(
          'shrink-0 text-label uppercase',
          onNavy ? 'text-white/55' : 'text-ink-3',
        )}
      >
        {children}
      </span>
      {rule ? (
        <span className={cn('h-px flex-1', onNavy ? 'bg-white/12' : 'bg-line')} />
      ) : (
        <span className="flex-1" />
      )}
      {actions}
    </div>
  );
}
