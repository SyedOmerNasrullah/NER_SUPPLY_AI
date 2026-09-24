/**
 * The hero band's right-hand cluster: current corridor conditions, and the control that drives
 * the entire demonstration.
 *
 * Two things this component is careful about:
 *
 *   1. **The weather is synthetic and says so.** It is labelled "Current Conditions (Demo)" with
 *      a provenance marker, and the marker changes from SYNTHETIC OPERATIONAL to SIMULATION
 *      EVENT the moment the control runs. Nothing here implies a live feed.
 *
 *   2. **The button runs the real cascade.** It calls `dataSource.simulateRain(...)`, which
 *      re-scores the segment, re-predicts the delivery delay, re-projects the district stockout,
 *      runs the decision engine and writes the alerts — then every mounted resource on the page
 *      refetches. There is no front-end animation standing in for that work.
 */

import { cn } from '@/lib/cn';
import { SimulateLandslide } from './SimulateLandslide';
import { formatNumber } from '@/domain/format';
import type { WeatherConditions } from '@/domain/types';
import { Icon, ProvenanceTag } from '@/design/primitives';
import { DEMO_SEGMENT_LABEL } from '@/app/config';

export interface ConditionsPanelProps {
  weather: WeatherConditions | undefined;
  onSimulate: () => void;
  pending: boolean;
  /** Hidden entirely for roles the contract does not clear for the control. */
  canSimulate: boolean;
  className?: string;
}

export function ConditionsPanel({
  weather,
  onSimulate,
  pending,
  canSimulate,
  className,
}: ConditionsPanelProps) {
  const simulated = weather?.simulated ?? false;

  return (
    <div className={cn('flex items-stretch gap-2.5', className)}>
      {/* --- Conditions readout ------------------------------------------- */}
      <div
        className={cn(
          'flex items-center gap-3 rounded-panel border px-3.5 py-2.5 backdrop-blur-sm transition-colors duration-300 ease-ui',
          simulated
            ? 'border-risk-critical/45 bg-risk-critical/18'
            : 'border-white/18 bg-white/10',
        )}
      >
        <Icon
          name={simulated ? 'rainfall' : 'weather'}
          size="xl"
          className={simulated ? 'text-white' : 'text-white/70'}
        />

        <div className="flex flex-col leading-none">
          <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-white/55">
            Current Conditions (Demo)
          </span>

          <span className="mt-1.5 text-[15px] font-semibold text-white">
            {weather ? weather.label : '—'}
          </span>

          <span className="mt-1 text-[11px] text-white/60">NER Region</span>
        </div>

        {/* The numbers that actually changed, so the cascade is visible here first. */}
        {weather ? (
          <dl className="ml-1 hidden flex-col gap-[3px] border-l border-white/15 pl-3 2xl:flex">
            <Reading label="Rain 1h" value={`${formatNumber(weather.rainfall1hMm, 1)} mm`} />
            <Reading label="Rain 24h" value={`${formatNumber(weather.rainfall24hMm, 0)} mm`} />
            <Reading label="Vis." value={`${formatNumber(weather.visibilityKm, 1)} km`} />
          </dl>
        ) : null}
      </div>

      {/* --- The demo control --------------------------------------------- */}
      {canSimulate ? (
        <div className="flex flex-col items-stretch gap-1">
          <button
            type="button"
            onClick={onSimulate}
            disabled={pending || simulated}
            title={
              simulated
                ? 'The cascade has already run. Use “reset demo” to return to the baseline.'
                : `Overwrites the weather inputs on ${DEMO_SEGMENT_LABEL} and runs the full cascade.`
            }
            className={cn(
              'group flex flex-1 items-center gap-2.5 rounded-panel border px-4 text-left',
              'transition-all duration-200 ease-ui disabled:cursor-not-allowed',
              simulated
                ? 'border-white/20 bg-white/10 text-white/55'
                : 'border-brand-500 bg-brand-500 text-white shadow-[0_2px_12px_rgb(18_118_184/0.45)] hover:border-brand-700 hover:bg-brand-700',
              pending && 'opacity-80',
            )}
          >
            <Icon
              name={pending ? 'spinner' : simulated ? 'check' : 'simulate'}
              size="lg"
              className={cn(pending && 'animate-spin')}
            />
            <span className="flex flex-col leading-none">
              <span className="text-[13.5px] font-semibold">
                {pending
                  ? 'Running cascade…'
                  : simulated
                    ? 'Cascade complete'
                    : 'Simulate Heavy Rainfall'}
              </span>
              <span
                className={cn(
                  'mt-1 text-[10.5px]',
                  simulated ? 'text-white/45' : 'text-white/75',
                )}
              >
                {pending
                  ? 'Re-scoring route, delivery and supply'
                  : simulated
                    ? `${DEMO_SEGMENT_LABEL} re-scored`
                    : 'Demo Event · For SIH presentation'}
              </span>
            </span>
          </button>

          <ProvenanceTag
            kind={simulated ? 'SIMULATION_EVENT' : 'SYNTHETIC_OPERATIONAL'}
            onNavy
            className="justify-end px-1"
          />

          {/* The second demonstration trigger: one landslide, the whole chain. Same panel and
              the same styling as the rainfall control, because it is the same kind of thing. */}
          <SimulateLandslide />
        </div>
      ) : (
        <div className="flex items-end pb-1">
          <ProvenanceTag kind="SYNTHETIC_OPERATIONAL" onNavy />
        </div>
      )}
    </div>
  );
}

function Reading({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <dt className="w-[46px] text-[10px] uppercase tracking-[0.05em] text-white/45">{label}</dt>
      <dd className="tnum text-[11.5px] font-semibold text-white/90">{value}</dd>
    </div>
  );
}
