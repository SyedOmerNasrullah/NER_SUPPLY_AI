/**
 * Radial and trend graphics.
 *
 * Both are hand-drawn SVG rather than Recharts. Recharts earns its place on the Analytics page
 * where axes, tooltips and legends matter; for a single 96px dial or a 40px sparkline it brings
 * a wrapper, a ResponsiveContainer and a re-render on every resize, and gives back less control
 * over stroke, cap and gradient than writing the twelve lines directly.
 */

import { cn } from '@/lib/cn';
import { RISK_TONE, riskLevelForScore } from '@/domain/thresholds';
import type { RiskLevel } from '@/domain/types';
import { useTweenedNumber } from '@/lib/useTweenedNumber';

// ---------------------------------------------------------------------------
// RadialGauge
// ---------------------------------------------------------------------------

export interface RadialGaugeProps {
  /** 0-100. */
  value: number;
  /** Explicit level, or derived from the value with the contract's thresholds. */
  level?: RiskLevel;
  size?: number;
  /** Ring thickness in px. */
  thickness?: number;
  label?: string;
  sublabel?: string;
  /** Renders "%" after the figure. */
  unit?: string;
  className?: string;
}

/**
 * A 270° arc dial. Open at the bottom so the gap reads as a scale that starts and ends
 * somewhere, rather than a full ring that looks like a loading spinner.
 */
export function RadialGauge({
  value,
  level,
  size = 128,
  thickness = 10,
  label,
  sublabel,
  unit = '%',
  className,
}: RadialGaugeProps) {
  const tweened = useTweenedNumber(value, 800);
  const pct = Math.max(0, Math.min(100, tweened));
  const tone = RISK_TONE[level ?? riskLevelForScore(Math.round(pct))];

  const r = (size - thickness) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const sweep = 270;
  const circumference = 2 * Math.PI * r;
  const arcLength = (sweep / 360) * circumference;
  const filled = (pct / 100) * arcLength;

  return (
    <div
      className={cn('relative inline-flex shrink-0 items-center justify-center', className)}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} className="-rotate-[225deg]" aria-hidden>
        <circle
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke="rgb(var(--panel-sunk))"
          strokeWidth={thickness}
          strokeLinecap="round"
          strokeDasharray={`${arcLength} ${circumference}`}
        />
        <circle
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke={tone.cssVar}
          strokeWidth={thickness}
          strokeLinecap="round"
          strokeDasharray={`${filled} ${circumference}`}
        />
      </svg>

      <div className="absolute inset-0 flex flex-col items-center justify-center gap-0">
        <span
          className={cn('tnum font-semibold leading-none', tone.text)}
          style={{ fontSize: size * 0.26, letterSpacing: '-0.02em' }}
        >
          {Math.round(pct)}
          {unit ? (
            <span className="font-medium opacity-65" style={{ fontSize: size * 0.15 }}>
              {unit}
            </span>
          ) : null}
        </span>
        {label ? (
          <span
            className="mt-1 text-center text-[10.5px] font-semibold uppercase tracking-[0.06em] text-ink-3"
            style={{ maxWidth: size - thickness * 2 }}
          >
            {label}
          </span>
        ) : null}
        {sublabel ? <span className="text-[10.5px] text-ink-3">{sublabel}</span> : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sparkline
// ---------------------------------------------------------------------------

export interface SparklineProps {
  values: number[];
  width?: number;
  height?: number;
  /** Raw CSS colour. Defaults to brand blue. */
  color?: string;
  /** Fills the area under the line with a fading gradient. */
  fill?: boolean;
  /** Marks the final point with a dot — "this is where we are now". */
  showLast?: boolean;
  className?: string;
}

export function Sparkline({
  values,
  width = 120,
  height = 34,
  color = 'rgb(var(--brand-500))',
  fill = true,
  showLast = true,
  className,
}: SparklineProps) {
  if (values.length < 2) {
    return <div style={{ width, height }} className={className} />;
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pad = 3;

  const points = values.map((v, i) => {
    const x = pad + (i / (values.length - 1)) * (width - pad * 2);
    const y = height - pad - ((v - min) / span) * (height - pad * 2);
    return [x, y] as const;
  });

  const line = points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  const area = `${line} L${points[points.length - 1][0].toFixed(1)} ${height} L${points[0][0].toFixed(1)} ${height} Z`;
  const gradientId = `spark-${Math.abs(values[0] * 1000 + values.length).toFixed(0)}`;
  const last = points[points.length - 1];

  return (
    <svg width={width} height={height} className={cn('overflow-visible', className)} aria-hidden>
      {fill ? (
        <>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.20" />
              <stop offset="100%" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={area} fill={`url(#${gradientId})`} />
        </>
      ) : null}
      <path
        d={line}
        fill="none"
        stroke={color}
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {showLast ? (
        <circle cx={last[0]} cy={last[1]} r={2.5} fill={color} stroke="white" strokeWidth={1.5} />
      ) : null}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// RiskBarCell — the inline bar a risk-ranked table row carries
// ---------------------------------------------------------------------------

export function RiskBarCell({
  score,
  width = 96,
  className,
}: {
  score: number;
  width?: number;
  className?: string;
}) {
  const tone = RISK_TONE[riskLevelForScore(score)];
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div
        className="h-1.5 shrink-0 overflow-hidden rounded-full bg-panel-sunk"
        style={{ width }}
      >
        <div
          className={cn('h-full rounded-full transition-[width] duration-700 ease-ui', tone.rail)}
          style={{ width: `${Math.max(2, Math.min(100, score))}%` }}
        />
      </div>
      <span className={cn('tnum w-6 text-right text-body font-semibold', tone.text)}>{score}</span>
    </div>
  );
}
