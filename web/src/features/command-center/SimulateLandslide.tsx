/**
 * The demonstration trigger — one landslide, the whole chain (Phase 6E, delta D56).
 *
 * This does not move a number in the browser. It files a real incident through
 * `dataSource.submitIncident`, the same call the Report Incident dialog makes, at the
 * Dirang – Sela Pass coordinates the seeded world already uses. In API mode that request runs
 * the backend cascade: the segment is degraded, `route-risk-xgb-v1` re-scores every route from
 * its own segments, `delivery-risk-xgb-v1` re-scores the deliveries on the affected routes, the
 * stockout projection is re-run against the new ETA, and the decision ladder produces whatever
 * it produces. Everything this panel then shows is read back from that.
 *
 * The stage list is a progress indicator and nothing more. It is driven by a timer while the
 * request is genuinely in flight, because one HTTP round trip cannot report its own internal
 * phases — but it never runs past the request: "Analysis complete" appears when the server has
 * actually answered, and the stages stop wherever they had got to. It is an affordance, not a
 * claim about what the backend is doing at that instant.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { cn } from '@/lib/cn';
import { dataSource, isDemoMode } from '@/data';
import { Icon, ProvenanceTag } from '@/design/primitives';

/**
 * Where the demonstration landslide is filed.
 *
 * The seeded Dirang – Sela Pass incident sits here, on SEG-013 — the highest-risk segment on
 * Route A and the one the corridor narrative is built around. Reusing its coordinates means the
 * simulation lands on a segment the rest of the world already has history and weather for.
 */
const DIRANG_SELA_PASS = { lat: 27.359, lng: 92.241 } as const;

/** What the operator sees while the request is in flight. Display only. */
const STAGES = [
  'Detecting incident…',
  'Mapping affected segment…',
  'Running risk model…',
  'Updating routes…',
  'Calculating delivery impact…',
  'Evaluating supply…',
  'Generating recommendation…',
] as const;

const STAGE_MS = 620;

export function SimulateLandslide({ className }: { className?: string }) {
  const navigate = useNavigate();
  const [pending, setPending] = useState(false);
  const [stage, setStage] = useState(0);
  const [done, setDone] = useState<{ incidentId: string; segment?: string } | null>(null);
  const [error, setError] = useState<string>();
  const timer = useRef<ReturnType<typeof setInterval>>();

  useEffect(() => () => clearInterval(timer.current), []);

  const run = useCallback(async () => {
    if (pending) return; // a second press during the request would file a second landslide
    setPending(true);
    setError(undefined);
    setDone(null);
    setStage(0);
    // Advance while we wait, and stop at the last stage rather than looping — a progress
    // indicator that cycles forever reads as a hang.
    timer.current = setInterval(
      () => setStage((s) => Math.min(s + 1, STAGES.length - 1)),
      STAGE_MS,
    );

    try {
      const form = new FormData();
      form.append('type', 'LANDSLIDE');
      form.append('severity', 'HIGH');
      form.append('lat', String(DIRANG_SELA_PASS.lat));
      form.append('lng', String(DIRANG_SELA_PASS.lng));
      form.append(
        'description',
        'Simulated slope failure on the Dirang approach, filed by the demonstration control.',
      );
      const result = await dataSource.submitIncident(form);
      setDone({
        incidentId: result.incident.id,
        segment: result.segmentMatch?.code ?? undefined,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The simulation could not be filed.');
    } finally {
      clearInterval(timer.current);
      setPending(false);
    }
  }, [pending]);

  const label = pending
    ? STAGES[stage]
    : done
      ? 'Analysis complete'
      : error
        ? 'Simulation failed'
        : 'Simulate Landslide';

  const sub = pending
    ? 'Dirang – Sela Pass · running the full cascade'
    : done
      ? `${done.segment ? `${done.segment} re-scored · ` : ''}open the incident to trace it`
      : error
        ? error
        : isDemoMode
          ? 'Demo Event · fixtures, no model called'
          : 'Demo Event · runs XGBoost + SHAP end to end';

  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      <button
        type="button"
        onClick={done ? () => navigate(`/incidents?incident=${done.incidentId}`) : run}
        disabled={pending}
        title={
          isDemoMode
            ? 'Files a landslide at Dirang – Sela Pass against the demo fixtures. No model is called in this build.'
            : 'Files a real landslide at Dirang – Sela Pass and runs the backend cascade: segment, route risk, delivery risk, supply and the decision engine.'
        }
        className={cn(
          'group flex flex-1 items-center gap-2.5 rounded-panel border px-4 py-2.5 text-left',
          'transition-all duration-200 ease-ui disabled:cursor-not-allowed',
          done
            ? 'border-white/20 bg-white/10 text-white/70 hover:bg-white/15'
            : error
              ? 'border-risk-critical bg-risk-critical/15 text-white'
              : 'border-brand-500 bg-brand-500 text-white shadow-[0_2px_12px_rgb(18_118_184/0.45)] hover:border-brand-700 hover:bg-brand-700',
          pending && 'opacity-80',
        )}
      >
        <Icon
          name={pending ? 'spinner' : done ? 'check' : error ? 'warning' : 'incidents'}
          size="lg"
          className={cn(pending && 'animate-spin')}
        />
        <span className="flex min-w-0 flex-col leading-none">
          <span className="text-[13.5px] font-semibold">{label}</span>
          <span className={cn('mt-1 truncate text-[10.5px]', done ? 'text-white/45' : 'text-white/75')}>
            {sub}
          </span>
        </span>
      </button>

      <ProvenanceTag kind={done || pending ? 'SIMULATION_EVENT' : 'SYNTHETIC_OPERATIONAL'} subtle />
    </div>
  );
}
