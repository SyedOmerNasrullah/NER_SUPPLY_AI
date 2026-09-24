/**
 * Timeline — the cascade, drawn as a chain.
 *
 * This is how the Incident Center and Command Center will show that one event produced five
 * consequences in order. Each step carries its own state, so a cascade that is still running,
 * or that failed at the notification stage, is legible rather than hidden.
 *
 * `variant="chain"` is the vertical cascade; `variant="track"` is the horizontal progress a
 * delivery makes along its route.
 */

import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Icon, type IconName } from '../icons';

export type StepState = 'pending' | 'active' | 'done' | 'failed' | 'skipped';

export interface TimelineStep {
  id: string;
  title: string;
  detail?: ReactNode;
  /** Right-aligned: a timestamp, a score change, a confidence. */
  meta?: ReactNode;
  state: StepState;
  icon?: IconName;
}

const STATE_STYLE: Record<
  StepState,
  { node: string; icon: IconName; iconClass: string; title: string; connector: string }
> = {
  done: {
    node: 'bg-risk-low border-risk-low text-white',
    icon: 'check',
    iconClass: 'text-white',
    title: 'text-ink',
    connector: 'bg-risk-low/35',
  },
  active: {
    node: 'bg-brand-500 border-brand-500 text-white',
    icon: 'spinner',
    iconClass: 'text-white animate-spin',
    title: 'text-ink font-semibold',
    connector: 'bg-line',
  },
  failed: {
    node: 'bg-risk-critical border-risk-critical text-white',
    icon: 'close',
    iconClass: 'text-white',
    title: 'text-risk-critical',
    connector: 'bg-line',
  },
  skipped: {
    node: 'bg-panel border-line text-ink-3',
    icon: 'dot',
    iconClass: 'text-ink-3',
    title: 'text-ink-3',
    connector: 'bg-line',
  },
  pending: {
    node: 'bg-panel border-line text-ink-3',
    icon: 'dot',
    iconClass: 'text-ink-3 opacity-50',
    title: 'text-ink-3',
    connector: 'bg-line',
  },
};

export interface TimelineProps {
  steps: TimelineStep[];
  variant?: 'chain' | 'track';
  className?: string;
}

export function Timeline({ steps, variant = 'chain', className }: TimelineProps) {
  if (variant === 'track') return <TimelineTrack steps={steps} className={className} />;

  return (
    <ol className={cn('flex flex-col', className)}>
      {steps.map((step, i) => {
        const style = STATE_STYLE[step.state];
        const last = i === steps.length - 1;

        return (
          <li key={step.id} className="relative flex gap-3 pb-4 last:pb-0">
            {/* Connector, drawn behind the node */}
            {!last ? (
              <span
                className={cn('absolute left-[11px] top-6 h-[calc(100%-16px)] w-[2px]', style.connector)}
                aria-hidden
              />
            ) : null}

            <span
              className={cn(
                'relative z-10 mt-[1px] flex h-[23px] w-[23px] shrink-0 items-center justify-center rounded-full border-2',
                style.node,
              )}
            >
              <Icon
                name={step.icon && step.state === 'done' ? step.icon : style.icon}
                size="sm"
                className={cn(style.iconClass, style.icon === 'dot' && 'scale-[0.45]')}
              />
            </span>

            <div className="flex min-w-0 flex-1 flex-col gap-0.5 pt-[2px]">
              <div className="flex items-baseline gap-2">
                <span className={cn('text-body leading-snug', style.title)}>{step.title}</span>
                {step.meta ? (
                  <span className="tnum ml-auto shrink-0 text-meta text-ink-3">{step.meta}</span>
                ) : null}
              </div>
              {step.detail ? (
                <div className="text-meta leading-snug text-ink-2">{step.detail}</div>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** The horizontal variant: origin -> waypoints -> destination. */
function TimelineTrack({ steps, className }: { steps: TimelineStep[]; className?: string }) {
  return (
    <ol className={cn('flex w-full items-start', className)}>
      {steps.map((step, i) => {
        const style = STATE_STYLE[step.state];
        const last = i === steps.length - 1;

        return (
          <li
            key={step.id}
            className={cn('relative flex min-w-0 flex-col items-center gap-1.5', !last && 'flex-1')}
          >
            <div className="flex w-full items-center">
              <span
                className={cn(
                  'z-10 flex h-[19px] w-[19px] shrink-0 items-center justify-center rounded-full border-2',
                  style.node,
                )}
              >
                <Icon
                  name={style.icon}
                  size="sm"
                  className={cn(style.iconClass, style.icon === 'dot' && 'scale-[0.4]')}
                />
              </span>
              {!last ? <span className={cn('h-[2px] flex-1', style.connector)} aria-hidden /> : null}
            </div>

            <div
              className={cn(
                'flex w-full min-w-0 flex-col',
                last ? 'items-end text-right' : 'items-start',
              )}
            >
              <span className={cn('truncate text-meta leading-tight', style.title)}>
                {step.title}
              </span>
              {step.meta ? (
                <span className="tnum truncate text-[10.5px] text-ink-3">{step.meta}</span>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
