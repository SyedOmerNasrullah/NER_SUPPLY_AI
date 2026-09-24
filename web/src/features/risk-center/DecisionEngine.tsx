/**
 * The Master Decision Engine, shown as what it is: an if/else ladder.
 *
 * This is the most important honesty surface in the product. The project's defensibility rests
 * on the decision being a documented rule over model outputs — not a language model's opinion —
 * and the only way to make that credible to a judge is to show the ladder, the inputs each
 * branch was tested against, and which one matched first.
 *
 * So: branches in evaluation order, each with its condition and the observed values, matched
 * ones marked, everything after the first match visibly short-circuited. The footer states
 * plainly where the number came from.
 */

import { cn } from '@/lib/cn';
import { formatProbability } from '@/domain/format';
import type { DecisionTrace } from '@/domain/types';
import { Chip, Icon, ProvenanceTag, SectionLabel } from '@/design/primitives';

const ACTION_COPY: Record<string, string> = {
  REROUTE: 'Reroute the delivery to the lower-risk candidate',
  PRE_POSITION: 'Pre-position stock from the nearest depot',
  ALERT: 'Raise a critical alert to the responsible officer',
  NONE: 'No action',
};

export function DecisionEngine({
  trace,
  className,
}: {
  trace: DecisionTrace | undefined;
  className?: string;
}) {
  if (!trace) {
    return (
      <p className={cn('text-meta text-ink-3', className)}>
        No decision has been evaluated for this entity.
      </p>
    );
  }

  const firstMatch = trace.branches.findIndex((b) => b.matched);

  return (
    <div className={cn('flex min-w-0 flex-col gap-3', className)}>
      <SectionLabel rule actions={<ProvenanceTag kind="ML_PREDICTION" subtle />}>
        Rules, in evaluation order
      </SectionLabel>

      <ol className="flex flex-col gap-1.5">
        {trace.branches.map((branch, i) => {
          const shortCircuited = firstMatch !== -1 && i > firstMatch;
          const won = i === firstMatch;

          return (
            <li
              key={branch.id}
              className={cn(
                'flex items-start gap-3 rounded-panel border px-3 py-2.5 transition-opacity',
                won
                  ? 'border-brand-500/30 bg-brand-50'
                  : branch.matched
                    ? 'border-line bg-panel-alt'
                    : 'border-line bg-panel',
                shortCircuited && 'opacity-45',
              )}
            >
              {/* Outcome mark */}
              <span
                className={cn(
                  'mt-[1px] flex h-[19px] w-[19px] shrink-0 items-center justify-center rounded-full',
                  won
                    ? 'bg-brand-500 text-white'
                    : branch.matched
                      ? 'bg-ink-3 text-white'
                      : 'border-2 border-line bg-panel text-ink-3',
                )}
              >
                <Icon
                  name={branch.matched ? 'check' : 'close'}
                  size="sm"
                  className={cn('scale-[0.72]', !branch.matched && 'opacity-55')}
                />
              </span>

              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span className="text-[10px] font-bold uppercase tracking-[0.06em] text-ink-3">
                    IF
                  </span>
                  <span className="text-body leading-snug text-ink">{branch.condition}</span>
                </div>

                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span className="text-[10px] font-bold uppercase tracking-[0.06em] text-ink-3">
                    Observed
                  </span>
                  <span className="tnum text-meta font-semibold text-ink-2">
                    {branch.observed}
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-[10px] font-bold uppercase tracking-[0.06em] text-ink-3">
                    Then
                  </span>
                  <span
                    className={cn(
                      'text-meta font-semibold',
                      won ? 'text-brand-900' : 'text-ink-3',
                    )}
                  >
                    {branch.action.replace('_', ' ')}
                  </span>
                  {won ? (
                    <Chip tone="brand" size="sm" className="ml-auto">
                      Matched first
                    </Chip>
                  ) : shortCircuited ? (
                    <span className="ml-auto text-[10px] text-ink-3">not evaluated</span>
                  ) : null}
                </div>
              </div>
            </li>
          );
        })}
      </ol>

      {/* --- Outcome ------------------------------------------------------- */}
      <div
        className={cn(
          'flex flex-wrap items-center gap-3 rounded-panel border px-3.5 py-3',
          trace.outcome === 'NONE'
            ? 'border-line bg-panel-alt'
            : 'border-brand-500/30 bg-brand-50',
        )}
      >
        <Icon
          name={trace.outcome === 'NONE' ? 'ok' : 'ai'}
          size="lg"
          className={trace.outcome === 'NONE' ? 'text-ink-3' : 'text-brand-700'}
        />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-[10px] font-bold uppercase tracking-[0.06em] text-ink-3">
            Action
          </span>
          <span
            className={cn(
              'font-display text-[19px] font-semibold uppercase leading-none tracking-[-0.015em]',
              trace.outcome === 'NONE' ? 'text-ink-2' : 'text-brand-900',
            )}
          >
            {trace.outcome.replace('_', ' ')}
          </span>
          <span className="mt-1 text-meta text-ink-2">
            {ACTION_COPY[trace.outcome] ?? ACTION_COPY.NONE}
          </span>
        </div>
        {trace.outcome !== 'NONE' ? (
          <div className="flex shrink-0 flex-col items-end">
            <span className="tnum text-[19px] font-semibold text-brand-900">
              {formatProbability(trace.confidence)}
            </span>
            <span className="text-[10px] uppercase tracking-[0.05em] text-ink-3">Confidence</span>
          </div>
        ) : null}
      </div>

      <p className="text-[10px] leading-relaxed text-ink-3">
        Branches are evaluated top to bottom and the first match wins. The confidence is the
        confidence of whichever <em>prediction</em> drove the matched branch — it is not a
        separate score for the decision, and no language model participates in choosing it.
      </p>
    </div>
  );
}
