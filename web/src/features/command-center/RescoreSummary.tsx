/**
 * What the storm did to the model's mind — delta D58.
 *
 * The simulation was already honest and already worked: it changes the weather, asks
 * `route-risk-xgb-v1` again, and stores the new predictions. What it never did was *show* that,
 * so the strongest moment in the demonstration — an environmental input moving a model output —
 * happened entirely off screen and the operator saw a spinner and then the same page.
 *
 * Both columns are real and come from different places, which is the point:
 *
 *   - BEFORE is what the page was already displaying, captured at the instant the button was
 *     pressed. It is the previous stored prediction.
 *   - AFTER is `rescored` from the simulation's own response — predictions made after the
 *     rainfall was written, by the model, in that request.
 *
 * There is deliberately no "rainfall before -> after" row. `GET /api/weather` reports REGIONAL
 * weather (31 mm), while the model reads the per-segment snapshot for each route (148 mm on the
 * simulated segment). Putting the regional figure under a "model input" label would caption the
 * wrong number as the model's input, which is the exact failure this whole phase removed. The
 * per-feature rainfall the model actually used is visible where it is provably correct: in the
 * SHAP breakdown and the model trace on the route itself.
 *
 * Nothing is interpolated and no delta is computed from a guess. If the model service did not
 * answer, `rescored` is absent and this says the weather changed without a re-scoring rather
 * than implying the numbers on screen are new.
 */

import { cn } from '@/lib/cn';
import { Icon } from '@/design/primitives';

export interface RescoreRow {
  label: string;
  before: number;
  after: number;
}

export function RescoreSummary({
  rows,
  modelVersion,
  className,
}: {
  /** One per route, in display order. Empty when nothing could be compared. */
  rows: RescoreRow[];
  /** Absent when the model service did not answer — see the note above. */
  modelVersion?: string | null;
  className?: string;
}) {
  if (!modelVersion) {
    return (
      <div
        className={cn(
          'rounded-panel border border-risk-high/30 bg-risk-wash-high px-3 py-2 text-[11px] leading-snug text-ink-2',
          className,
        )}
      >
        <span className="font-semibold">Weather changed, nothing re-scored.</span> The model
        service did not answer, so the risk scores on screen are the previous predictions — not
        predictions of the new conditions.
      </div>
    );
  }

  const moved = rows.filter((r) => r.after !== r.before);

  return (
    <div className={cn('rounded-panel border border-line bg-panel px-3 py-2.5', className)}>
      <div className="mb-2 flex items-center gap-1.5">
        <Icon name="model" size="sm" className="text-brand-700" />
        <span className="text-[10px] font-bold uppercase tracking-[0.06em] text-ink-2">
          Model re-scored
        </span>
        <span className="ml-auto truncate text-[9.5px] text-ink-3">{modelVersion}</span>
      </div>


      <div className="flex flex-col gap-1">
        {rows.map((r) => {
          const delta = r.after - r.before;
          return (
            <div key={r.label} className="flex items-baseline gap-2">
              <span className="w-[58px] shrink-0 truncate text-meta text-ink-2">{r.label}</span>
              <span className="tnum text-meta font-semibold text-ink-3">{r.before}</span>
              <Icon name="arrowRight" size="sm" className="shrink-0 text-ink-3" />
              <span className="tnum text-meta font-bold text-ink">{r.after}</span>
              <span
                className={cn(
                  'tnum ml-auto text-[10px] font-semibold',
                  delta > 0 ? 'text-risk-high' : delta < 0 ? 'text-risk-low' : 'text-ink-3',
                )}
              >
                {delta === 0 ? 'no change' : `${delta > 0 ? '+' : '−'}${Math.abs(delta)} pts`}
              </span>
            </div>
          );
        })}
      </div>

      <p className="mt-2 text-[9.5px] leading-snug text-ink-3">
        {moved.length === 0
          ? 'The model returned the same scores: the features it reads did not move far enough to change its answer.'
          : `Re-predicted from the new rainfall by ${modelVersion}. Open a route to see which features moved.`}
      </p>
    </div>
  );
}
