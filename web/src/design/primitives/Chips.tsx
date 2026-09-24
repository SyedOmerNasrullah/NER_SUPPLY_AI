/**
 * Chips and status indicators.
 *
 * Every one of these resolves its colour through `domain/thresholds`, never from a literal
 * passed at the call site. A feature says "this is CRITICAL"; the design system decides what
 * critical looks like. That is the rule that keeps four risk colours from becoming eleven.
 */

import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { humanizeEnum } from '@/domain/format';
import {
  DELIVERY_STATUS_LEVEL,
  PRIORITY_LEVEL,
  RISK_TONE,
  SEGMENT_STATUS_LEVEL,
  riskLevelForScore,
  stockoutAsRiskLevel,
} from '@/domain/thresholds';
import type {
  CargoPriority,
  DeliveryStatus,
  Provenance,
  RiskLevel,
  SegmentStatus,
  Severity,
} from '@/domain/types';
import { Icon, type IconName } from '../icons';

// ---------------------------------------------------------------------------
// Chip — the neutral base every labelled pill is built from
// ---------------------------------------------------------------------------

export interface ChipProps {
  children: ReactNode;
  icon?: IconName;
  tone?: 'neutral' | 'brand' | 'outline' | 'navy';
  size?: 'sm' | 'md';
  className?: string;
}

const CHIP_TONE = {
  neutral: 'bg-panel-sunk text-ink-2 border-transparent',
  brand: 'bg-brand-50 text-brand-700 border-brand-500/15',
  outline: 'bg-transparent text-ink-2 border-line',
  navy: 'bg-white/12 text-white border-white/20 backdrop-blur-sm',
} as const;

export function Chip({ children, icon, tone = 'neutral', size = 'md', className }: ChipProps) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-chip border font-semibold',
        size === 'sm' ? 'px-1.5 py-[1px] text-[10.5px]' : 'px-2 py-[2px] text-[11px]',
        CHIP_TONE[tone],
        className,
      )}
    >
      {icon ? <Icon name={icon} size="sm" /> : null}
      {children}
    </span>
  );
}

// ---------------------------------------------------------------------------
// RiskChip / SeverityChip
// ---------------------------------------------------------------------------

export interface RiskChipProps {
  level: RiskLevel;
  /** Shows the score alongside the word: "87 · CRITICAL". */
  score?: number;
  /** `solid` for the one chip that must dominate; `wash` everywhere else. */
  emphasis?: 'wash' | 'solid';
  size?: 'sm' | 'md';
  className?: string;
}

export function RiskChip({
  level,
  score,
  emphasis = 'wash',
  size = 'md',
  className,
}: RiskChipProps) {
  const tone = RISK_TONE[level];
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-chip border font-semibold uppercase tracking-[0.04em]',
        size === 'sm' ? 'px-1.5 py-[1px] text-[10.5px]' : 'px-2 py-[2px] text-[11px]',
        emphasis === 'solid'
          ? cn(tone.bg, 'border-transparent text-white')
          : cn(tone.wash, tone.text, tone.border),
        className,
      )}
    >
      {score !== undefined ? <span className="tnum tabular-nums">{score}</span> : null}
      {score !== undefined ? <span className="opacity-40">·</span> : null}
      {level}
    </span>
  );
}

/** Severity and RiskLevel share four values; this names the intent at the call site. */
export function SeverityChip({
  severity,
  emphasis = 'wash',
  size = 'md',
  className,
}: {
  severity: Severity;
  emphasis?: 'wash' | 'solid';
  size?: 'sm' | 'md';
  className?: string;
}) {
  return <RiskChip level={severity} emphasis={emphasis} size={size} className={className} />;
}

/** Derives the level from a raw 0-100 score so callers never bucket it themselves. */
export function ScoreChip({
  score,
  emphasis = 'wash',
  size = 'md',
  className,
}: {
  score: number;
  emphasis?: 'wash' | 'solid';
  size?: 'sm' | 'md';
  className?: string;
}) {
  return (
    <RiskChip
      level={riskLevelForScore(score)}
      score={score}
      emphasis={emphasis}
      size={size}
      className={className}
    />
  );
}

/** Stockout urgency, bucketed by the contract's <48h / 48-96h / >=96h rule. */
export function StockoutChip({
  hours,
  className,
}: {
  hours: number | null;
  className?: string;
}) {
  const level = stockoutAsRiskLevel(hours);
  if (level === null) return <Chip tone="outline" className={className}>No projection</Chip>;
  const label = level === 'CRITICAL' ? 'CRITICAL' : level === 'MEDIUM' ? 'WARNING' : 'STABLE';
  const tone = RISK_TONE[level];
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded-chip border px-2 py-[2px] text-[11px] font-semibold uppercase tracking-[0.04em]',
        tone.wash,
        tone.text,
        tone.border,
        className,
      )}
    >
      {label}
    </span>
  );
}

export function SegmentStatusChip({ status }: { status: SegmentStatus }) {
  const tone = RISK_TONE[SEGMENT_STATUS_LEVEL[status]];
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded-chip border px-2 py-[2px] text-[11px] font-semibold lowercase',
        tone.wash,
        tone.text,
        tone.border,
      )}
    >
      {status.toLowerCase()}
    </span>
  );
}

export function DeliveryStatusChip({ status }: { status: DeliveryStatus }) {
  const tone = RISK_TONE[DELIVERY_STATUS_LEVEL[status]];
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-chip border px-2 py-[2px] text-[11px] font-semibold',
        tone.wash,
        tone.text,
        tone.border,
      )}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', tone.rail)} />
      {humanizeEnum(status)}
    </span>
  );
}

export function PriorityChip({ priority }: { priority: CargoPriority }) {
  const tone = RISK_TONE[PRIORITY_LEVEL[priority]];
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded-chip border px-2 py-[2px] text-[11px] font-semibold uppercase tracking-[0.04em]',
        tone.wash,
        tone.text,
        tone.border,
      )}
    >
      {priority}
    </span>
  );
}

// ---------------------------------------------------------------------------
// StatusDot
// ---------------------------------------------------------------------------

export interface StatusDotProps {
  level: RiskLevel;
  /** Emits a slow expanding ring — for genuinely live things only. */
  pulse?: boolean;
  label?: string;
  size?: 'sm' | 'md';
  className?: string;
}

export function StatusDot({ level, pulse = false, label, size = 'md', className }: StatusDotProps) {
  const tone = RISK_TONE[level];
  const px = size === 'sm' ? 'h-1.5 w-1.5' : 'h-2 w-2';

  return (
    <span className={cn('inline-flex items-center gap-1.5', className)}>
      <span className="relative inline-flex">
        <span className={cn('rounded-full', px, tone.rail)} />
        {pulse ? (
          <span
            className={cn(
              'absolute inset-0 animate-pulse-ring rounded-full',
              tone.rail,
            )}
          />
        ) : null}
      </span>
      {label ? <span className="text-meta text-ink-2">{label}</span> : null}
    </span>
  );
}

/** The connection chip in the StatusRail. */
export function LiveDot({ live, className }: { live: boolean; className?: string }) {
  return (
    <StatusDot
      level={live ? 'LOW' : 'CRITICAL'}
      pulse={live}
      label={live ? 'live' : 'offline'}
      size="sm"
      className={className}
    />
  );
}

// ---------------------------------------------------------------------------
// ProvenanceTag
// ---------------------------------------------------------------------------

const PROVENANCE_META: Record<Provenance, { label: string; icon: IconName; hint: string }> = {
  SYNTHETIC_HISTORICAL: {
    label: 'Synthetic history',
    icon: 'database',
    hint: 'Generated historical record, not an observed measurement.',
  },
  SYNTHETIC_OPERATIONAL: {
    label: 'Synthetic operational',
    icon: 'database',
    hint: 'Seeded operational state standing in for a live feed.',
  },
  SIMULATION_EVENT: {
    label: 'Simulated event',
    icon: 'simulate',
    hint: 'Produced by the demo simulation control, not by real conditions.',
  },
  ML_PREDICTION: {
    label: 'Model prediction',
    icon: 'prediction',
    hint: 'XGBoost output. Explained by SHAP, never produced by a language model.',
  },
  LLM_EXPLANATION: {
    label: 'AI explanation',
    icon: 'explanation',
    hint: 'Language-model narration of the model output. It explains; it does not decide.',
  },
  EXTERNAL_API: {
    label: 'External source',
    icon: 'external',
    hint: 'Retrieved from a third-party service.',
  },
};

/**
 * The honesty marker required by the project reference: synthetic values must never be
 * presented as live measurements.
 *
 * Deliberately quiet — 10.5px, tertiary ink, no fill. It sits in a panel footer or beside a
 * section label, not on every value. `subtle` drops it to icon-only for dense contexts.
 */
export function ProvenanceTag({
  kind,
  subtle = false,
  onNavy = false,
  className,
}: {
  kind: Provenance;
  subtle?: boolean;
  onNavy?: boolean;
  className?: string;
}) {
  const meta = PROVENANCE_META[kind];
  return (
    <span
      title={meta.hint}
      className={cn(
        'inline-flex shrink-0 cursor-help items-center gap-1 text-[10.5px] font-medium uppercase tracking-[0.05em]',
        onNavy ? 'text-white/45' : 'text-ink-3',
        className,
      )}
    >
      <Icon name={meta.icon} size="sm" className="opacity-70" />
      {subtle ? null : meta.label}
    </span>
  );
}
