/**
 * The operational decision, presented as the output of the decision pipeline.
 *
 * Two shapes, one component: a wide `banner` for Route Intelligence, where the decision is the
 * hinge of the page, and a `stacked` column for Delivery Intelligence's rail.
 *
 * What this component must never do is *make* the decision. It renders an `AIRecommendation`
 * produced by the deterministic decision engine and the candidate the engine pointed at. The
 * only figure it derives is the risk reduction — the arithmetic difference between two scores
 * that both arrived from the data source — and the footer says plainly where the decision came
 * from, because "an LLM decided this" is the claim this project has to avoid.
 */

import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { formatDuration, formatProbability } from '@/domain/format';
import { RISK_TONE } from '@/domain/thresholds';
import type { AIRecommendation, RouteCandidate } from '@/domain/types';
import { Button, Chip, Icon, ProvenanceTag } from '@/design/primitives';
import { shortRouteName } from './delivery';

export interface RecommendationBannerProps {
  recommendation: AIRecommendation | undefined;
  /** The route the operator is currently on / assessing. */
  current: RouteCandidate | undefined;
  /** The route the engine points at. */
  recommended: RouteCandidate | undefined;
  layout?: 'banner' | 'stacked';
  /** Primary action. Omitted for roles that cannot act. */
  onAccept?: () => void;
  acceptLabel?: string;
  accepting?: boolean;
  /** Rendered next to the primary action. */
  secondaryAction?: ReactNode;
  /** Shown when the action has already been taken. */
  accepted?: boolean;
  className?: string;
}

export function RecommendationBanner({
  recommendation,
  current,
  recommended,
  layout = 'banner',
  onAccept,
  acceptLabel = 'Reroute delivery',
  accepting = false,
  secondaryAction,
  accepted = false,
  className,
}: RecommendationBannerProps) {
  const switchable = Boolean(recommended && current && recommended.id !== current.id);
  const active = Boolean(recommendation) && switchable;

  const riskReduction =
    switchable && recommended && current ? current.riskScore - recommended.riskScore : 0;
  const timeChange =
    switchable && recommended && current ? recommended.etaMinutes - current.etaMinutes : 0;

  const headline = active
    ? recommendation!.type === 'REROUTE' && recommended
      ? `Use ${shortRouteName(recommended.name)}`
      : recommendation!.type.replace('_', ' ')
    : accepted
      ? 'Reroute applied'
      : 'No action required';

  const body = active
    ? recommendation!.recommendationText
    : accepted
      ? `The delivery is now assigned to ${current ? shortRouteName(current.name) : 'the recommended route'}. No further routing action is outstanding.`
      : // Not "the assigned route is the lowest-risk candidate" — it often is not, and saying so
        // in front of a route strip showing otherwise is simply false. Once the scores are the
        // model's, the assigned route can sit above a safer one without the engine firing,
        // because REROUTE needs BOTH halves of its rule: risk at or over the threshold AND a
        // candidate clearing the margin. When that is the situation, say that.
        switchable && recommended && current && recommended.riskScore < current.riskScore
        ? `${shortRouteName(recommended.name)} is ${current.riskScore - recommended.riskScore} points safer, which is not on its own a reason to move: rerouting also needs the assigned route at or above the risk threshold. The corridor is being monitored.`
        : 'The assigned route is the lowest-risk candidate available. The corridor is being monitored; no routing action is outstanding.';

  const tone = active ? 'active' : accepted ? 'done' : 'idle';

  const TONE_SHELL = {
    active: 'border-brand-500/30 bg-brand-50',
    done: 'border-risk-low/30 bg-risk-wash-low',
    idle: 'border-line bg-panel-alt',
  } as const;

  const TONE_HEADER = {
    active: 'border-brand-500/15 bg-brand-500/[0.07] text-brand-900',
    done: 'border-risk-low/15 bg-risk-low/[0.07] text-risk-low',
    idle: 'border-line-soft text-ink-3',
  } as const;

  const TONE_HEADLINE = {
    active: 'text-brand-900',
    done: 'text-risk-low',
    idle: 'text-ink-2',
  } as const;

  return (
    <section
      className={cn(
        'shrink-0 overflow-hidden rounded-panel border',
        TONE_SHELL[tone],
        className,
      )}
    >
      <header
        className={cn('flex items-center gap-2 border-b px-3.5 py-2', TONE_HEADER[tone])}
      >
        <Icon name={accepted ? 'ok' : 'ai'} size="sm" />
        <span className="text-[11px] font-bold uppercase tracking-[0.06em]">
          Recommended Action
        </span>
        {active ? (
          <Chip tone="brand" size="sm" className="ml-auto">
            {formatProbability(recommendation!.confidence)} confidence
          </Chip>
        ) : (
          <Chip tone="outline" size="sm" className="ml-auto">
            {accepted ? 'Applied' : 'Monitoring'}
          </Chip>
        )}
      </header>

      <div
        className={cn(
          'gap-4 px-3.5 py-3',
          layout === 'banner' ? 'flex flex-wrap items-center' : 'flex flex-col',
        )}
      >
        {/* --- The decision ------------------------------------------------ */}
        <div className={cn('flex min-w-0 flex-col gap-1', layout === 'banner' && 'flex-1')}>
          <div className="flex items-baseline gap-2.5">
            {active ? (
              <span className="rounded-chip bg-brand-500 px-1.5 py-[2px] text-[10px] font-bold uppercase tracking-[0.06em] text-white">
                {recommendation!.type.replace('_', ' ')}
              </span>
            ) : null}
            <p
              className={cn(
                'font-display text-[21px] font-semibold uppercase leading-none tracking-[-0.015em]',
                TONE_HEADLINE[tone],
              )}
            >
              {headline}
            </p>
          </div>
          <p className="max-w-[68ch] text-meta leading-relaxed text-ink-2">{body}</p>
        </div>

        {/* --- The numbers behind it --------------------------------------- */}
        {switchable && recommended ? (
          <dl
            className={cn(
              'flex shrink-0 items-stretch divide-x divide-ink/10 rounded-control border border-ink/10 bg-panel/70',
              layout === 'stacked' && 'w-full',
            )}
          >
            <Figure
              label="Risk"
              value={`${recommended.riskScore}%`}
              valueClass={RISK_TONE[recommended.riskLevel].text}
            />
            <Figure label="ETA" value={formatDuration(recommended.etaMinutes)} />
            <Figure
              label="Risk change"
              value={`${riskReduction > 0 ? '−' : '+'}${Math.abs(riskReduction)} pts`}
              valueClass={riskReduction > 0 ? 'text-risk-low' : 'text-risk-critical'}
            />
            <Figure
              label="Time change"
              value={`${timeChange > 0 ? '+' : timeChange < 0 ? '−' : ''}${formatDuration(Math.abs(timeChange))}`}
              valueClass={timeChange <= 0 ? 'text-risk-low' : 'text-risk-high'}
            />
          </dl>
        ) : null}

        {/* --- Act --------------------------------------------------------- */}
        {(onAccept && switchable) || secondaryAction ? (
          <div
            className={cn(
              'flex shrink-0 items-center gap-2',
              layout === 'stacked' && 'w-full',
            )}
          >
            {onAccept && switchable ? (
              <Button
                variant="primary"
                icon="navigate"
                pending={accepting}
                onClick={onAccept}
                className={cn(layout === 'stacked' && 'flex-1')}
              >
                {accepting ? 'Applying…' : acceptLabel}
              </Button>
            ) : null}
            {secondaryAction}
          </div>
        ) : null}
      </div>

      <footer className="flex items-center justify-between gap-2 border-t border-ink/[0.07] px-3.5 py-1.5">
        <span className="text-[10px] text-ink-3">
          Deterministic decision engine · combines route risk, delivery delay and supply impact
        </span>
        <ProvenanceTag kind="ML_PREDICTION" subtle />
      </footer>
    </section>
  );
}

function Figure({
  label,
  value,
  valueClass,
}: {
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div className="flex min-w-[74px] flex-1 flex-col items-center justify-center gap-0.5 px-3 py-1.5">
      <dt className="whitespace-nowrap text-[9.5px] uppercase tracking-[0.05em] text-ink-3">
        {label}
      </dt>
      <dd className={cn('tnum whitespace-nowrap text-[15px] font-semibold', valueClass ?? 'text-ink')}>
        {value}
      </dd>
    </div>
  );
}
