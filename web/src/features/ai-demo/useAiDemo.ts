/**
 * The guided demonstration, as a state machine — delta D60.
 *
 * This orchestrates the application; it does not reimplement it. Every step either calls a
 * `dataSource` method the normal UI already calls, or sends the operator to the page that
 * already shows the thing. There is no second cascade, no second scorer, and nothing here
 * computes a risk, a contribution or an ETA.
 *
 * What it adds is sequence and evidence: it captures the real numbers at each stage so the
 * panel can show "44 before, 66 after" from two genuine observations rather than from a
 * transition effect. Where a value is not available it stays absent, and the panel says so.
 *
 * Step state lives in `sessionStorage` because the demonstration walks across pages and a
 * reload mid-recording must not lose the thread. It is per-tab and disappears with the tab.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { dataSource, isDemoMode } from '@/data';
import type { MlStatus, RouteCandidate } from '@/domain/types';

export const DEMO_STEPS = [
  { id: 'status', title: 'System status', blurb: 'Which models and services are actually answering.' },
  { id: 'baseline', title: 'Baseline risk', blurb: 'Reset to the known state and read the current predictions.' },
  { id: 'why', title: 'Why the model predicted this', blurb: 'The SHAP attribution behind one score.' },
  { id: 'weather', title: 'Weather event', blurb: 'Change an input the model actually reads.' },
  { id: 'rescore', title: 'Model re-scoring', blurb: 'The same model, asked again, under the new conditions.' },
  { id: 'incident', title: 'Incident reported', blurb: 'A real report, matched to a corridor and a segment.' },
  { id: 'delivery', title: 'Delivery impact', blurb: 'Failure probability and delay from the delivery model.' },
  { id: 'supply', title: 'Supply impact', blurb: 'Deterministic cover arithmetic against the new ETA.' },
  { id: 'decision', title: 'Decision', blurb: 'Rules, not a model, choose the operational action.' },
  { id: 'notify', title: 'Officer notification', blurb: 'Twilio SMS or voice, sent only when you press send.' },
] as const;

export type DemoStepId = (typeof DEMO_STEPS)[number]['id'];

/** Where each step is best watched. Absent means "stay where you are". */
export const STEP_ROUTE: Partial<Record<DemoStepId, string>> = {
  status: '/',
  baseline: '/routes',
  why: '/routes',
  weather: '/',
  rescore: '/',
  incident: '/incidents',
  delivery: '/deliveries',
  supply: '/supply',
  decision: '/routes',
  notify: '/operations',
};

export interface RouteScore {
  id: string;
  label: string;
  risk: number;
  source?: string;
  modelVersion?: string;
}

interface DemoState {
  active: boolean;
  step: number;
  /** Scores read straight after the reset, before anything was simulated. */
  baseline?: RouteScore[];
  /** Scores the model returned after the weather changed. */
  rescored?: RouteScore[];
  rescoreModel?: string | null;
  /** True once the simulation ran but the model service did not answer. */
  rescoreUnavailable?: boolean;
}

const KEY = 'ner-supplyai.ai-demo';
const EMPTY: DemoState = { active: false, step: 0 };

function read(): DemoState {
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? { ...EMPTY, ...(JSON.parse(raw) as DemoState) } : EMPTY;
  } catch {
    // A private window, or storage the browser refused. The demo still runs, it just will not
    // survive a reload — which is strictly better than failing to start.
    return EMPTY;
  }
}

function write(state: DemoState) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* see read() */
  }
}

const shortName = (name: string) => name.split('—')[0].trim();

export function useAiDemo() {
  const [state, setState] = useState<DemoState>(read);
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const [status, setStatus] = useState<MlStatus>();

  useEffect(() => write(state), [state]);

  const patch = useCallback((next: Partial<DemoState>) => setState((s) => ({ ...s, ...next })), []);

  /** The candidates for the corridor, as the Routes page asks for them. */
  const readScores = useCallback(async (): Promise<RouteScore[]> => {
    const deliveries = await dataSource.getDeliveries();
    const d = deliveries.deliveries[0];
    if (!d) return [];
    const res = await dataSource.getRouteCandidates({
      originLat: d.originLat,
      originLng: d.originLng,
      destLat: d.destLat,
      destLng: d.destLng,
      cargoPriority: d.priority,
      deliveryId: d.id,
    });
    return res.candidates.map((c: RouteCandidate) => ({
      id: c.id,
      label: shortName(c.name),
      risk: c.riskScore,
      source: c.riskSource,
      modelVersion: c.modelVersion,
    }));
  }, []);

  const start = useCallback(async () => {
    setError(undefined);
    setBusy('Checking which services are answering…');
    try {
      const s = await dataSource.getMlStatus();
      setStatus(s);
      setState({ active: true, step: 0 });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not reach the API.');
    } finally {
      setBusy(undefined);
    }
  }, []);

  const exit = useCallback(() => {
    setState(EMPTY);
    setError(undefined);
  }, []);

  /** Reset to the deterministic baseline and record what the model says about it. */
  const establishBaseline = useCallback(async () => {
    setError(undefined);
    setBusy('Restoring the baseline…');
    try {
      await dataSource.resetDemo();
      setBusy('Reading the current predictions…');
      const baseline = await readScores();
      patch({ baseline, rescored: undefined, rescoreModel: undefined, rescoreUnavailable: false });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The reset did not complete.');
    } finally {
      setBusy(undefined);
    }
  }, [patch, readScores]);

  /**
   * The storm. `simulateRain` changes the weather AND re-scores server-side, so `rescored` on
   * the response is the model's answer under the new conditions — not a refetch that might have
   * raced the write.
   */
  const runWeatherEvent = useCallback(
    async (segmentId: string) => {
      setError(undefined);
      setBusy('Writing the new weather and re-running route-risk-xgb-v1…');
      try {
        const result = await dataSource.simulateRain(segmentId);
        if (!result.rescored || !result.modelVersion) {
          // The weather changed and nothing re-scored. Say that; do not refetch and present
          // stale predictions as if they were new ones.
          patch({ rescoreUnavailable: true, rescored: undefined, rescoreModel: null });
          return;
        }
        const byLabel = new Map(result.rescored.map((r) => [r.label, r.riskScore]));
        const current = await readScores();
        patch({
          rescored: current.map((c) => ({ ...c, risk: byLabel.get(c.label) ?? c.risk })),
          rescoreModel: result.modelVersion,
          rescoreUnavailable: false,
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : 'The simulation did not complete.');
      } finally {
        setBusy(undefined);
      }
    },
    [patch, readScores],
  );

  const next = useCallback(
    () => setState((s) => ({ ...s, step: Math.min(s.step + 1, DEMO_STEPS.length - 1) })),
    [],
  );
  const back = useCallback(() => setState((s) => ({ ...s, step: Math.max(s.step - 1, 0) })), []);
  const goTo = useCallback(
    (i: number) => setState((s) => ({ ...s, step: Math.min(Math.max(i, 0), DEMO_STEPS.length - 1) })),
    [],
  );

  /** Lowest current model risk. Derived, never assumed — and absent when nothing is scored. */
  const lowest = useMemo(() => {
    const scores = state.rescored ?? state.baseline;
    if (!scores || scores.length === 0) return undefined;
    return scores.reduce((a, b) => (b.risk < a.risk ? b : a));
  }, [state.rescored, state.baseline]);

  return {
    ...state,
    steps: DEMO_STEPS,
    current: DEMO_STEPS[state.step],
    busy,
    error,
    status,
    lowest,
    isDemoMode,
    start,
    exit,
    next,
    back,
    goTo,
    establishBaseline,
    runWeatherEvent,
  };
}
