/**
 * How the model reached one number — delta D57.
 *
 * Everything here is read off the prediction the backend returned. Nothing is derived, rounded
 * into shape or filled in when it is missing: if the candidate carries no `modelVersion` the
 * component renders nothing at all, because the only thing worse than an unexplained score is a
 * fabricated explanation of one.
 *
 * The arithmetic is the point. SHAP is additive — the prediction is the model's base value plus
 * every feature's contribution — so the panel adds them up in front of the reader and shows the
 * remainder that the features outside the top five account for. A viewer can check it:
 *
 *     base 35.0  +  road condition 14.56  +  … +  other features  =  59
 *
 * A number that closes like that is visibly not hardcoded, which is the whole reason this panel
 * exists. If it did not close we would be showing that too.
 */

import { useState } from 'react';
import { cn } from '@/lib/cn';
import type { RouteCandidate } from '@/domain/types';
import { Icon } from '@/design/primitives';

/** How many features the route model takes. Stated in the model card and the feature contract. */
const ROUTE_FEATURE_COUNT = 12;

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[9.5px] font-semibold uppercase tracking-[0.06em] text-ink-3">
        {label}
      </span>
      <span className={cn('text-meta font-semibold text-ink', mono && 'tnum')}>{value}</span>
    </div>
  );
}

export function ModelTrace({
  route,
  decisionNote,
  className,
}: {
  route: RouteCandidate;
  /**
   * What the deterministic engine did with this score, in its own words. Passed in rather than
   * recomputed here — the rules live in one place and this panel only reports them.
   */
  decisionNote?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);

  // No model, no trace. A seeded fixture has nothing to explain and must not borrow this frame.
  if (route.riskSource !== 'ML_PREDICTION' || !route.modelVersion) return null;

  const base = route.shapBaseValue;
  const shown = route.topFactors.filter((f) => typeof f.shapValue === 'number');
  const shownSum = shown.reduce((t, f) => t + (f.shapValue ?? 0), 0);
  // What the features outside the top list contributed. Real: it is whatever is left over.
  const remainder = base !== undefined ? route.riskScore - base - shownSum : undefined;

  return (
    <section className={cn('shrink-0 rounded-panel border border-line bg-panel-alt', className)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-panel-sunk"
      >
        <Icon name="model" size="sm" className="text-brand-700" />
        <span className="flex-1 text-[11px] font-bold uppercase tracking-[0.05em] text-ink-2">
          How did the model reach this prediction?
        </span>
        <span className="tnum text-meta font-semibold text-ink-3">{route.riskScore}/100</span>
        <Icon name={open ? 'chevronUp' : 'chevronDown'} size="sm" className="text-ink-3" />
      </button>

      {open ? (
        <div className="flex flex-col gap-3 border-t border-line-soft px-3 py-3">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Field label="Model" value={route.modelVersion} />
            <Field label="Type" value="XGBoost Regressor" />
            <Field label="Input features" value={String(ROUTE_FEATURE_COUNT)} mono />
            <Field
              label="Scored"
              value={
                route.scoredAt
                  ? new Date(route.scoredAt).toLocaleTimeString('en-IN', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })
                  : '—'
              }
              mono
            />
          </div>

          {/* The additive chain, laid out so it can be checked by eye. */}
          {base !== undefined ? (
            <div className="rounded-panel border border-line-soft bg-panel px-3 py-2.5">
              <div className="mb-1.5 text-[9.5px] font-semibold uppercase tracking-[0.06em] text-ink-3">
                Base value + contributions = prediction
              </div>
              <dl className="flex flex-col gap-1">
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-meta text-ink-2">
                    Base value
                    <span className="ml-1 text-ink-3">(mean prediction over training data)</span>
                  </dt>
                  <dd className="tnum text-meta font-semibold text-ink">{base.toFixed(2)}</dd>
                </div>

                {shown.map((f) => (
                  <div key={f.factor} className="flex items-baseline justify-between gap-3">
                    <dt className="truncate text-meta text-ink-2">
                      {f.factor}
                      {f.value !== undefined ? (
                        <span className="ml-1 text-ink-3">= {String(f.value)}</span>
                      ) : null}
                    </dt>
                    <dd
                      className={cn(
                        'tnum shrink-0 text-meta font-semibold',
                        (f.shapValue ?? 0) >= 0 ? 'text-risk-high' : 'text-risk-low',
                      )}
                    >
                      {(f.shapValue ?? 0) >= 0 ? '+' : '−'}
                      {Math.abs(f.shapValue ?? 0).toFixed(2)}
                    </dd>
                  </div>
                ))}

                {remainder !== undefined ? (
                  <div className="flex items-baseline justify-between gap-3">
                    <dt className="text-meta text-ink-3">
                      Remaining {Math.max(0, ROUTE_FEATURE_COUNT - shown.length)} features
                    </dt>
                    <dd className="tnum shrink-0 text-meta font-semibold text-ink-3">
                      {remainder >= 0 ? '+' : '−'}
                      {Math.abs(remainder).toFixed(2)}
                    </dd>
                  </div>
                ) : null}

                <div className="mt-1 flex items-baseline justify-between gap-3 border-t border-line-soft pt-1.5">
                  <dt className="text-meta font-semibold text-ink">Prediction</dt>
                  <dd className="tnum text-body font-bold text-ink">{route.riskScore}</dd>
                </div>
              </dl>
            </div>
          ) : null}

          {decisionNote ? (
            <div className="rounded-panel border border-line-soft bg-panel px-3 py-2">
              <div className="mb-0.5 text-[9.5px] font-semibold uppercase tracking-[0.06em] text-ink-3">
                Decision
              </div>
              <p className="text-meta leading-relaxed text-ink-2">{decisionNote}</p>
              <p className="mt-1 text-[9.5px] leading-snug text-ink-3">
                The model predicts risk. A deterministic rule, not the model, decides what happens
                next.
              </p>
            </div>
          ) : null}

          <p className="text-[9.5px] leading-snug text-ink-3">
            {route.modelVersion} is an XGBoost regressor trained on logistics scenarios this
            project generated. The score is a real prediction over the corridor's current stored
            conditions; the conditions themselves are synthetic.
          </p>
        </div>
      ) : null}
    </section>
  );
}
