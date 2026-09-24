/**
 * The causal chain — the product's whole argument as one graphic.
 *
 * Deliberately not a generic vertical timeline. A timeline says "these things happened in this
 * order"; this says "each of these CAUSED the next", which is a different claim and the only
 * one worth making here. The difference is drawn: every link carries an arrow and a stated
 * consequence, the rail is colour-graded by severity as the chain deepens, and a step that
 * points at another page is a real affordance rather than a label.
 *
 * `compact` is the inline form used inside an analysis panel; `full` is the wide operational
 * form the Incident Center uses as its centrepiece.
 */

import { cn } from '@/lib/cn';
import { Icon, type IconName } from '@/design/primitives';

export type ChainTone = 'critical' | 'warning' | 'neutral' | 'brand';

export interface ChainStep {
  id: string;
  /** The stage: "Route risk increased". */
  label: string;
  /** What it did: "Assigned corridor re-scored by the risk model". */
  detail?: string;
  /** The figure that moved, e.g. "43 → 87". */
  value?: string;
  tone: ChainTone;
  icon?: IconName;
  /** Where this stage lives in the product. Makes the step clickable. */
  target?: string;
}

const TONE: Record<ChainTone, { node: string; rail: string; text: string; wash: string; border: string }> = {
  critical: {
    node: 'bg-risk-critical text-white',
    rail: 'bg-risk-critical/35',
    text: 'text-risk-critical',
    wash: 'bg-risk-wash-critical',
    border: 'border-risk-critical/25',
  },
  warning: {
    node: 'bg-risk-medium text-white',
    rail: 'bg-risk-medium/35',
    text: 'text-risk-medium',
    wash: 'bg-risk-wash-medium',
    border: 'border-risk-medium/30',
  },
  brand: {
    node: 'bg-brand-500 text-white',
    rail: 'bg-brand-500/35',
    text: 'text-brand-700',
    wash: 'bg-brand-50',
    border: 'border-brand-500/25',
  },
  neutral: {
    node: 'bg-panel border-2 border-line text-ink-3',
    rail: 'bg-line',
    text: 'text-ink-2',
    wash: 'bg-panel-alt',
    border: 'border-line',
  },
};

const DEFAULT_ICON: Record<ChainTone, IconName> = {
  critical: 'critical',
  warning: 'warning',
  brand: 'ai',
  neutral: 'dot',
};

// ---------------------------------------------------------------------------
// Compact — vertical, for a panel rail
// ---------------------------------------------------------------------------

export function CausalChain({
  steps,
  onNavigate,
  className,
}: {
  steps: ChainStep[];
  onNavigate?: (target: string) => void;
  className?: string;
}) {
  return (
    <ol className={cn('flex flex-col', className)}>
      {steps.map((step, i) => {
        const tone = TONE[step.tone];
        const last = i === steps.length - 1;
        const clickable = Boolean(step.target && onNavigate);

        const body = (
          <>
            <span
              className={cn(
                'relative z-10 mt-[1px] flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full',
                tone.node,
              )}
            >
              <Icon
                name={step.icon ?? DEFAULT_ICON[step.tone]}
                size="sm"
                className={cn('scale-[0.8]', step.tone === 'neutral' && 'scale-[0.45]')}
              />
            </span>

            <span className="flex min-w-0 flex-1 flex-col gap-0.5 pt-[1px] text-left">
              <span className="flex items-baseline gap-2">
                <span className={cn('text-body font-medium leading-snug', tone.text)}>
                  {step.label}
                </span>
                {step.value ? (
                  <span className="tnum ml-auto shrink-0 text-meta font-semibold text-ink">
                    {step.value}
                  </span>
                ) : null}
                {clickable ? (
                  <Icon
                    name="arrowRight"
                    size="sm"
                    className="ml-auto shrink-0 text-ink-3 transition-transform duration-150 ease-ui group-hover:translate-x-0.5 group-hover:text-brand-500"
                  />
                ) : null}
              </span>
              {step.detail ? (
                <span className="text-meta leading-snug text-ink-2">{step.detail}</span>
              ) : null}
            </span>
          </>
        );

        return (
          <li key={step.id} className="relative flex gap-3 pb-3 last:pb-0">
            {!last ? (
              <span
                className={cn('absolute left-[10px] top-6 h-[calc(100%-14px)] w-[2px]', tone.rail)}
                aria-hidden
              />
            ) : null}

            {clickable ? (
              <button
                type="button"
                onClick={() => onNavigate!(step.target!)}
                className="group -mx-1.5 flex flex-1 items-start gap-3 rounded-control px-1.5 py-1 transition-colors duration-150 ease-ui hover:bg-panel-alt"
              >
                {body}
              </button>
            ) : (
              <span className="flex flex-1 items-start gap-3 px-1.5 py-1">{body}</span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

// ---------------------------------------------------------------------------
// Full — horizontal, as an operational dependency graphic
// ---------------------------------------------------------------------------

/**
 * The wide form: stages as connected blocks with arrows between them, so the propagation is
 * read left to right the way a judge scans. Wraps to two rows below 1280 rather than shrinking
 * the blocks to unreadable widths.
 */
export function CausalChainWide({
  steps,
  onNavigate,
  className,
}: {
  steps: ChainStep[];
  onNavigate?: (target: string) => void;
  className?: string;
}) {
  return (
    <ol className={cn('flex flex-wrap items-stretch gap-x-1 gap-y-3', className)}>
      {steps.map((step, i) => {
        const tone = TONE[step.tone];
        const last = i === steps.length - 1;
        const clickable = Boolean(step.target && onNavigate);
        const Wrapper = clickable ? 'button' : 'div';

        return (
          <li key={step.id} className="flex min-w-[150px] flex-1 items-stretch">
            <Wrapper
              type={clickable ? 'button' : undefined}
              onClick={clickable ? () => onNavigate!(step.target!) : undefined}
              className={cn(
                'group flex min-w-0 flex-1 flex-col gap-1.5 rounded-panel border px-3 py-2.5 text-left',
                'transition-all duration-150 ease-ui',
                tone.wash,
                tone.border,
                clickable && 'hover:shadow-panel',
              )}
            >
              <span className="flex items-center gap-1.5">
                <span
                  className={cn(
                    'flex h-[19px] w-[19px] shrink-0 items-center justify-center rounded-full',
                    tone.node,
                  )}
                >
                  <Icon
                    name={step.icon ?? DEFAULT_ICON[step.tone]}
                    size="sm"
                    className={cn('scale-[0.72]', step.tone === 'neutral' && 'scale-[0.42]')}
                  />
                </span>
                <span className="text-[10px] font-bold uppercase tracking-[0.06em] text-ink-3">
                  Stage {i + 1}
                </span>
                {clickable ? (
                  <Icon
                    name="arrowRight"
                    size="sm"
                    className="ml-auto shrink-0 text-ink-3 opacity-0 transition-opacity duration-150 group-hover:opacity-100"
                  />
                ) : null}
              </span>

              <span className={cn('text-body font-semibold leading-snug', tone.text)}>
                {step.label}
              </span>

              {step.value ? (
                <span className="tnum text-[15px] font-semibold leading-none text-ink">
                  {step.value}
                </span>
              ) : null}

              {step.detail ? (
                <span className="text-[10.5px] leading-snug text-ink-2">{step.detail}</span>
              ) : null}
            </Wrapper>

            {/* The arrow that makes this a chain rather than a row of cards. */}
            {!last ? (
              <span
                className="flex w-4 shrink-0 items-center justify-center text-ink-3"
                aria-hidden
              >
                <Icon name="chevronRight" size="sm" />
              </span>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
