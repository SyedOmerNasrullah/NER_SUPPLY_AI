/**
 * The demonstration panel — delta D60.
 *
 * A docked rail that runs beside the real application rather than on top of it. Every page
 * underneath stays live and interactive; this only narrates, drives the existing actions, and
 * shows the numbers it observed at each stage.
 *
 * Three rules it keeps:
 *
 *   1. It never renders a value it did not receive. An absent score renders as absent.
 *   2. It never claims a service is up. Step 1 shows whatever `/api/ml/status` reported, which
 *      in demo mode is "fixtures" and in an outage is "unreachable".
 *   3. It sends nothing on its own. The Twilio step points at the existing buttons; it does not
 *      press them.
 */

import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { cn } from '@/lib/cn';
import { Button, Icon } from '@/design/primitives';
import { DEMO_STEPS, STEP_ROUTE, type RouteScore } from './useAiDemo';
import { useAiDemoCtx } from './context';

const DEMO_SEGMENT_ID = import.meta.env.VITE_DEMO_SEGMENT_ID ?? '';

function ScoreRow({ label, risk, lowest }: { label: string; risk: number; lowest?: boolean }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="w-[54px] shrink-0 truncate text-meta text-ink-2">{label}</span>
      <span className="tnum text-meta font-bold text-ink">{risk}</span>
      {lowest ? (
        <span className="rounded-chip bg-risk-low/15 px-1.5 text-[9px] font-bold uppercase tracking-[0.05em] text-risk-low">
          lowest
        </span>
      ) : null}
    </div>
  );
}

function Delta({ before, after }: { before: RouteScore[]; after: RouteScore[] }) {
  return (
    <div className="flex flex-col gap-1">
      {after.map((a) => {
        const b = before.find((x) => x.label === a.label);
        const d = b ? a.risk - b.risk : undefined;
        return (
          <div key={a.label} className="flex items-baseline gap-2">
            <span className="w-[54px] shrink-0 truncate text-meta text-ink-2">{a.label}</span>
            <span className="tnum text-meta text-ink-3">{b ? b.risk : '—'}</span>
            <Icon name="arrowRight" size="sm" className="shrink-0 text-ink-3" />
            <span className="tnum text-meta font-bold text-ink">{a.risk}</span>
            {d !== undefined ? (
              <span
                className={cn(
                  'tnum ml-auto text-[10px] font-semibold',
                  d > 0 ? 'text-risk-high' : d < 0 ? 'text-risk-low' : 'text-ink-3',
                )}
              >
                {d === 0 ? 'no change' : `${d > 0 ? '+' : '−'}${Math.abs(d)}`}
              </span>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

export function AiDemoPanel() {
  const demo = useAiDemoCtx();
  const navigate = useNavigate();
  const { pathname } = useLocation();

  // Each step is watched on the page that already shows it. Navigation is one-way and only on
  // a step change, so the operator can still click anywhere without being dragged back.
  const target = STEP_ROUTE[demo.current.id];
  useEffect(() => {
    if (demo.active && target && pathname !== target) navigate(target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demo.active, demo.step]);

  if (!demo.active) return null;

  const { status, baseline, rescored, lowest } = demo;
  const service = status?.service;
  const id = demo.current.id;

  return (
    <aside className="flex w-[300px] shrink-0 flex-col border-l border-line bg-panel">
      <header className="flex items-center gap-2 border-b border-line px-3 py-2.5">
        <Icon name="ai" size="sm" className="text-brand-700" />
        <span className="flex-1 text-[11px] font-bold uppercase tracking-[0.06em] text-ink-2">
          AI demo
        </span>
        <span className="tnum text-[10px] font-semibold text-ink-3">
          {String(demo.step + 1).padStart(2, '0')} / {DEMO_STEPS.length}
        </span>
        <button
          type="button"
          onClick={demo.exit}
          title="Exit the demonstration and return to normal use"
          className="text-ink-3 transition-colors hover:text-ink"
        >
          <Icon name="close" size="sm" />
        </button>
      </header>

      {/* Stepper */}
      <ol className="flex shrink-0 flex-col gap-0.5 border-b border-line-soft px-2 py-2">
        {DEMO_STEPS.map((s, i) => {
          const done = i < demo.step;
          const here = i === demo.step;
          return (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => demo.goTo(i)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-[5px] px-1.5 py-1 text-left transition-colors',
                  here ? 'bg-brand-50' : 'hover:bg-panel-alt',
                )}
              >
                <span
                  className={cn(
                    'tnum w-[18px] shrink-0 text-[9.5px] font-bold',
                    here ? 'text-brand-700' : done ? 'text-risk-low' : 'text-ink-3',
                  )}
                >
                  {done ? '✓' : String(i + 1).padStart(2, '0')}
                </span>
                <span
                  className={cn(
                    'truncate text-[11px]',
                    here ? 'font-semibold text-ink' : done ? 'text-ink-2' : 'text-ink-3',
                  )}
                >
                  {s.title}
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      {/* Current step */}
      <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto scroll-thin px-3 py-3">
        <div>
          <h3 className="text-body font-bold text-ink">{demo.current.title}</h3>
          <p className="mt-0.5 text-meta leading-relaxed text-ink-2">{demo.current.blurb}</p>
        </div>

        {demo.error ? (
          <div className="rounded-panel border border-risk-critical/30 bg-risk-wash-critical px-2.5 py-2 text-[11px] leading-snug text-ink-2">
            <span className="font-semibold">Service unavailable.</span> {demo.error}
          </div>
        ) : null}

        {demo.busy ? (
          <div className="flex items-center gap-2 rounded-panel border border-line bg-panel-alt px-2.5 py-2">
            <Icon name="spinner" size="sm" className="animate-spin text-brand-700" />
            <span className="text-[11px] text-ink-2">{demo.busy}</span>
          </div>
        ) : null}

        {/* --- Step bodies. Each shows only what it actually has. ----------- */}

        {id === 'status' ? (
          <div className="flex flex-col gap-1 rounded-panel border border-line bg-panel-alt px-2.5 py-2 text-[11px]">
            {demo.isDemoMode ? (
              <p className="leading-snug text-ink-2">
                This build is running on <span className="font-semibold">demo fixtures</span>. No
                model is called and nothing on screen is a prediction. Start the API-backed build
                to demonstrate the models.
              </p>
            ) : service?.reachable ? (
              <>
                <p className="text-ink-2">
                  Route model{' '}
                  <span className="font-semibold text-ink">{service.modelVersion ?? '—'}</span>
                  {service.modelLoaded ? ' · loaded' : ' · not loaded'}
                </p>
                <p className="text-ink-2">
                  Delivery model{' '}
                  <span className="font-semibold text-ink">
                    {service.deliveryModelVersion ?? 'unknown'}
                  </span>
                  {service.deliveryModelLoaded === true ? ' · loaded' : ' · unconfirmed'}
                </p>
                <p className="text-ink-2">
                  ORS {status?.services?.ors ? 'configured' : 'not configured'} · Twilio{' '}
                  {status?.services?.twilio ? 'configured' : 'not configured'}
                </p>
              </>
            ) : (
              <p className="leading-snug text-risk-critical">
                The model service is not answering
                {service?.reason ? ` (${service.reason})` : ''}. Scores on screen are the last
                stored predictions.
              </p>
            )}
          </div>
        ) : null}

        {id === 'baseline' ? (
          <div className="flex flex-col gap-2">
            <Button variant="primary" size="sm" icon="refresh" onClick={demo.establishBaseline}>
              Reset and read predictions
            </Button>
            {baseline?.length ? (
              <div className="flex flex-col gap-1 rounded-panel border border-line bg-panel-alt px-2.5 py-2">
                {baseline.map((b) => (
                  <ScoreRow key={b.id} label={b.label} risk={b.risk} lowest={b.id === lowest?.id} />
                ))}
                <p className="mt-1 text-[9.5px] leading-snug text-ink-3">
                  {baseline[0]?.source === 'ML_PREDICTION'
                    ? `Model prediction · ${baseline[0]?.modelVersion ?? ''}`
                    : 'Seeded fixture — no model produced these.'}
                </p>
              </div>
            ) : null}
          </div>
        ) : null}

        {id === 'why' ? (
          <p className="text-meta leading-relaxed text-ink-2">
            On the route panel, open{' '}
            <span className="font-semibold text-ink">“How did the model reach this prediction?”</span>{' '}
            The base value plus each feature's SHAP contribution adds up to the score on screen.
          </p>
        ) : null}

        {id === 'weather' ? (
          <div className="flex flex-col gap-2">
            <Button
              variant="primary"
              size="sm"
              icon="simulate"
              disabled={!DEMO_SEGMENT_ID || Boolean(demo.busy)}
              onClick={() => demo.runWeatherEvent(DEMO_SEGMENT_ID)}
            >
              Run the weather event
            </Button>
            <p className="text-[9.5px] leading-snug text-ink-3">
              Writes heavy rainfall to the demo segment, then asks the same model again in the
              same request.
            </p>
          </div>
        ) : null}

        {id === 'rescore' ? (
          demo.rescoreUnavailable ? (
            <div className="rounded-panel border border-risk-high/30 bg-risk-wash-high px-2.5 py-2 text-[11px] leading-snug text-ink-2">
              The weather changed but nothing re-scored — the model service did not answer. The
              scores on screen are the previous predictions.
            </div>
          ) : baseline && rescored ? (
            <div className="rounded-panel border border-line bg-panel-alt px-2.5 py-2">
              <Delta before={baseline} after={rescored} />
              <p className="mt-1.5 text-[9.5px] leading-snug text-ink-3">
                Re-predicted by {demo.rescoreModel}. Open a route to see which features moved.
              </p>
            </div>
          ) : (
            <p className="text-meta text-ink-3">Run the weather event first.</p>
          )
        ) : null}

        {id === 'incident' ? (
          <p className="text-meta leading-relaxed text-ink-2">
            Use <span className="font-semibold text-ink">Report incident</span>, pick a point on
            the map, file it as a HIGH landslide. The corridor and segment shown afterwards are
            whatever the matcher returned — if nothing is within 5 km it says so.
          </p>
        ) : null}

        {id === 'delivery' ? (
          <p className="text-meta leading-relaxed text-ink-2">
            Failure probability and predicted delay come from{' '}
            <span className="font-semibold text-ink">delivery-risk-xgb-v1</span>, with its own
            SHAP attribution over seven features.
          </p>
        ) : null}

        {id === 'supply' ? (
          <p className="text-meta leading-relaxed text-ink-2">
            Cover is stock ÷ consumption, adjusted by the predicted delay. This is arithmetic, not
            a model, and the page labels it that way.
          </p>
        ) : null}

        {id === 'decision' ? (
          <div className="rounded-panel border border-line bg-panel-alt px-2.5 py-2 text-[11px] leading-snug text-ink-2">
            <p className="mb-1">
              <span className="font-semibold text-ink">The model</span> supplies route risk,
              failure probability and delay.
            </p>
            <p>
              <span className="font-semibold text-ink">The rules</span> choose the action: reroute
              needs risk at or above threshold <em>and</em> a candidate sufficiently safer;
              pre-position needs cover under 48 hours; otherwise alert or monitor.
            </p>
          </div>
        ) : null}

        {id === 'notify' ? (
          <p className="text-meta leading-relaxed text-ink-2">
            Use <span className="font-semibold text-ink">Send SMS</span> or{' '}
            <span className="font-semibold text-ink">Call officer</span>. Nothing is sent until you
            press one, and a repeat inside five minutes is refused rather than sent twice.
          </p>
        ) : null}
      </div>

      <footer className="flex shrink-0 items-center gap-2 border-t border-line px-3 py-2.5">
        <Button variant="ghost" size="sm" onClick={demo.back} disabled={demo.step === 0}>
          Back
        </Button>
        <Button
          variant="primary"
          size="sm"
          className="flex-1"
          iconRight="arrowRight"
          onClick={demo.next}
          disabled={demo.step === DEMO_STEPS.length - 1}
        >
          Continue
        </Button>
      </footer>
    </aside>
  );
}

/** The control that opens the demonstration. Rendered in the shell, off by default. */
export function StartAiDemoButton({ className }: { className?: string }) {
  const demo = useAiDemoCtx();
  if (demo.active) return null;
  return (
    <Button variant="secondary" size="sm" icon="ai" onClick={demo.start} className={className}>
      Start AI demo
    </Button>
  );
}
