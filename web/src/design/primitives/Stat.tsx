/**
 * Metrics — the numbers that carry the operational story.
 *
 * MetricValue is the one component allowed to render a large number. It is always tabular, it
 * tweens on change so a cascade is visible rather than instantaneous, and it keeps its unit
 * optically subordinate to the figure.
 */

import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { useTweenedNumber } from '@/lib/useTweenedNumber';
import { Icon, IconBadge, type IconBadgeTone, type IconName } from '../icons';

// ---------------------------------------------------------------------------
// MetricValue
// ---------------------------------------------------------------------------

const METRIC_SIZE = {
  sm: 'text-metric-sm',
  md: 'text-metric',
  lg: 'text-metric-lg',
} as const;

export interface MetricValueProps {
  value: number;
  /** Decimal places. The tween rounds to this, so 87.3 never flickers to 87.31. */
  decimals?: number;
  /** Rendered at 0.62em beside the figure: "%", "km", "h", "units". */
  unit?: string;
  /** Prefix glyph, e.g. an arrow or a currency mark. */
  prefix?: string;
  size?: keyof typeof METRIC_SIZE;
  /** Colour override. Defaults to primary ink; risk states pass a tone class. */
  className?: string;
  /** Disable the count-up, e.g. for a static reference figure. */
  animate?: boolean;
}

export function MetricValue({
  value,
  decimals = 0,
  unit,
  prefix,
  size = 'md',
  className,
  animate = true,
}: MetricValueProps) {
  const tweened = useTweenedNumber(value, animate ? 700 : 0);
  const shown = animate ? tweened : value;

  return (
    <span className={cn('tnum inline-flex items-baseline leading-none', METRIC_SIZE[size], className)}>
      {prefix ? <span className="mr-0.5 text-[0.7em] font-medium opacity-70">{prefix}</span> : null}
      {shown.toLocaleString('en-IN', {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      })}
      {unit ? <span className="ml-[3px] text-[0.62em] font-medium opacity-65">{unit}</span> : null}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Delta
// ---------------------------------------------------------------------------

export interface DeltaProps {
  value: number;
  unit?: string;
  /**
   * Which direction is good. For "at-risk deliveries" a rise is bad; for "success rate" a rise
   * is good; for "average delay" a fall is good. Without this the arrows lie.
   */
  goodDirection?: 'up' | 'down' | 'none';
  className?: string;
}

/** A signed change with an arrow, coloured by whether the movement is good or bad. */
export function Delta({ value, unit = '%', goodDirection = 'up', className }: DeltaProps) {
  if (value === 0) {
    return (
      <span className={cn('inline-flex items-center gap-0.5 text-meta text-ink-3', className)}>
        <span className="tnum">—</span>
      </span>
    );
  }

  const rising = value > 0;
  const good =
    goodDirection === 'none' ? null : goodDirection === 'up' ? rising : !rising;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-0.5 text-meta font-semibold',
        good === null ? 'text-ink-2' : good ? 'text-risk-low' : 'text-risk-critical',
        className,
      )}
    >
      <Icon name={rising ? 'up' : 'down'} size="sm" />
      <span className="tnum">
        {rising ? '+' : ''}
        {value}
        {unit}
      </span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// StatTile
// ---------------------------------------------------------------------------

export interface StatTileProps {
  label: string;
  value: number;
  decimals?: number;
  unit?: string;
  /** Replaces the numeric value entirely, for ratios like "18 / 24". */
  valueNode?: ReactNode;
  icon: IconName;
  tone?: IconBadgeTone;
  delta?: { value: number; goodDirection?: DeltaProps['goodDirection'] };
  /** One short line of context under the value: "3 at risk", "1 major | 2 minor". */
  footnote?: ReactNode;
  /** Draws a coloured top rule — used to flag the tile the cascade just changed. */
  accent?: 'critical' | 'high' | 'medium' | 'low' | 'brand';
  onClick?: () => void;
  className?: string;
}

const ACCENT_RULE = {
  critical: 'bg-risk-critical',
  high: 'bg-risk-high',
  medium: 'bg-risk-medium',
  low: 'bg-risk-low',
  brand: 'bg-brand-500',
} as const;

/**
 * The top-strip tile. Deliberately NOT a bordered card with a shadow at every level — it is a
 * white surface with a hairline and a 2px accent rule, so a row of six reads as one instrument
 * strip rather than six floating boxes.
 */
export function StatTile({
  label,
  value,
  decimals,
  unit,
  valueNode,
  icon,
  tone = 'neutral',
  delta,
  footnote,
  accent,
  onClick,
  className,
}: StatTileProps) {
  const Wrapper = onClick ? 'button' : 'div';

  return (
    <Wrapper
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={cn(
        'relative flex min-w-0 items-start gap-3 overflow-hidden rounded-panel border border-line',
        'bg-panel p-3.5 text-left shadow-panel transition-shadow duration-150 ease-ui',
        onClick && 'hover:border-ink-3/40 hover:shadow-raised',
        className,
      )}
    >
      {accent ? (
        <span className={cn('absolute inset-x-0 top-0 h-[2px]', ACCENT_RULE[accent])} />
      ) : null}

      <IconBadge name={icon} tone={tone} size="md" className="mt-[2px]" />

      <div className="flex min-w-0 flex-col gap-[3px]">
        {/* Wraps rather than truncates. At six tiles across 1280px there is not room for
            "Critical Supply Alerts" on one line, and a truncated label reads as a bug. */}
        <span className="text-label uppercase leading-[13px] text-ink-3">{label}</span>

        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 whitespace-nowrap">
          {valueNode ?? <MetricValue value={value} decimals={decimals} unit={unit} size="md" />}
          {delta ? <Delta value={delta.value} goodDirection={delta.goodDirection} /> : null}
        </div>

        {footnote ? (
          <div className="truncate text-meta text-ink-3">{footnote}</div>
        ) : null}
      </div>
    </Wrapper>
  );
}

// ---------------------------------------------------------------------------
// StatRow — a compact label/value line for dense panels
// ---------------------------------------------------------------------------

export function StatRow({
  label,
  value,
  icon,
  emphasis = false,
  className,
}: {
  label: string;
  value: ReactNode;
  icon?: IconName;
  emphasis?: boolean;
  className?: string;
}) {
  return (
    <div className={cn('flex items-center justify-between gap-3 py-1.5', className)}>
      <span className="flex min-w-0 items-center gap-1.5 text-body text-ink-2">
        {icon ? <Icon name={icon} size="sm" className="text-ink-3" /> : null}
        <span className="truncate">{label}</span>
      </span>
      <span
        className={cn(
          'tnum shrink-0 text-body',
          emphasis ? 'font-semibold text-ink' : 'text-ink',
        )}
      >
        {value}
      </span>
    </div>
  );
}
