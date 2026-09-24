/**
 * Route risk analysis — the "why" rail.
 *
 * The gauge is not a standalone widget parked in a card: it sits inside the composition beside
 * the score and level it describes, and the conditions that produced that score are listed
 * directly under it. Reading top to bottom you get the number, the bucket, the physical
 * conditions, then the model's factor attribution, then the narration.
 */

import { ModelTrace } from '../shared/ModelTrace';
import { cn } from '@/lib/cn';
import { formatNumber, humanizeEnum } from '@/domain/format';
import { RISK_TONE } from '@/domain/thresholds';
import type { RouteCandidate, RouteSegment } from '@/domain/types';
import {
  Icon,
  MetricValue,
  RadialGauge,
  SectionLabel,
  type IconName,
} from '@/design/primitives';
import { RiskFactors } from '../shared/RiskFactors';

const ROAD_TONE = {
  GOOD: 'text-risk-low',
  FAIR: 'text-risk-medium',
  POOR: 'text-risk-critical',
} as const;

const WEATHER_TONE = {
  CLEAR: 'text-risk-low',
  MODERATE: 'text-risk-medium',
  HEAVY: 'text-risk-high',
  SEVERE: 'text-risk-critical',
} as const;

function trafficLabel(level: number): string {
  if (level < 0.7) return 'Light';
  if (level < 1.5) return 'Moderate';
  if (level < 2.3) return 'Heavy';
  return 'Congested';
}

export function RouteRiskAnalysis({
  route,
  segments = [],
  decisionNote,
  className,
}: {
  route: RouteCandidate;
  /** Corridor segments, to name the ones this route travels (contract delta D39). */
  segments?: RouteSegment[];
  /** What the deterministic engine did with this score, passed down for the model trace. */
  decisionNote?: string;
  className?: string;
}) {
  const tone = RISK_TONE[route.riskLevel];
  const profile = route.profile;

  return (
    <div className={cn('flex min-w-0 flex-col gap-4', className)}>
      {/* --- Score + gauge, one composition ------------------------------- */}
      <section className="flex shrink-0 items-center gap-4">
        <RadialGauge value={route.riskScore} level={route.riskLevel} size={116} thickness={10} />

        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="flex flex-col gap-0.5">
            <span className="t-label">Risk Score</span>
            <span className="flex items-baseline gap-1">
              <MetricValue value={route.riskScore} size="md" className={tone.text} />
              <span className="text-metric-sm font-medium text-ink-3">/ 100</span>
            </span>
          </div>

          <div className="flex flex-col gap-1">
            <span className="t-label">Risk Level</span>
            <span
              className={cn(
                'inline-flex w-fit items-center rounded-chip border px-2 py-[3px] text-[12.5px] font-bold uppercase tracking-[0.04em]',
                tone.wash,
                tone.text,
                tone.border,
              )}
            >
              {route.riskLevel}
            </span>
          </div>
        </div>
      </section>

      {/* --- The physical conditions behind the score --------------------- */}
      {profile ? (
        <section className="flex shrink-0 flex-col gap-2">
          <SectionLabel rule>Corridor conditions</SectionLabel>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-0">
            <Condition
              icon="weather"
              label="Weather"
              value={humanizeEnum(profile.weatherSeverity)}
              valueClass={WEATHER_TONE[profile.weatherSeverity]}
            />
            <Condition
              icon="roadblock"
              label="Road condition"
              value={humanizeEnum(profile.roadCondition)}
              valueClass={ROAD_TONE[profile.roadCondition]}
            />
            <Condition
              icon="terrain"
              label="Peak gradient"
              value={`${profile.maxSlopeDeg}°`}
            />
            <Condition
              icon="vehicle"
              label="Traffic"
              value={trafficLabel(profile.trafficLevel)}
            />
          </dl>
        </section>
      ) : null}

      {/* --- The model's attribution -------------------------------------- */}
      <RiskFactors
        factors={route.topFactors}
        level={route.riskLevel}
        explanation={route.explanationText}
        // When the score came from the model, so did this sentence: `scoreCorridor` narrates
        // the factors it actually used and stores that beside the prediction. Labelling it
        // "Seeded text" underneath real SHAP was the same kind of untruth this phase exists
        // to remove.
        explanationSource={
          route.riskSource === 'ML_PREDICTION' ? 'DETERMINISTIC_TEMPLATE' : 'SYNTHETIC_OPERATIONAL'
        }
        routeName={route.name}
        heading="Why is this route risky?"
      />

      {/* --- The arithmetic behind the score -------------------------------- */}
      <ModelTrace route={route} decisionNote={decisionNote} />

      {/* --- The corridor this route actually travels ------------------------ */}
      {route.segmentIds ? (
        <RouteSegments ids={route.segmentIds} segments={segments} />
      ) : null}
    </div>
  );
}

/**
 * Which corridor segments this route travels, and which it bypasses. The second list is the
 * useful one: Route B's case is that it never touches Bhalukpong – Tenga Valley, and saying so
 * is more direct than leaving the reader to spot an absence in a list of fifteen codes.
 */
/**
 * The legs this route is made of.
 *
 * Every route now owns its segments (delta D50), so this is a description of one road rather than
 * a comparison against a shared corridor. It used to read "travels 7 of 15, bypasses SEG-003…",
 * which made sense while all three candidates borrowed Route A's fifteen segments and stopped
 * making sense the moment they stopped.
 */
function RouteSegments({ ids, segments }: { ids: string[]; segments: RouteSegment[] }) {
  const owned = segments
    .filter((s) => ids.includes(s.id))
    .sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0) || a.code.localeCompare(b.code));
  if (owned.length === 0) return null;

  const scored = owned.filter((s) => s.lastRiskScore > 0);
  const hottest = [...scored].sort((a, b) => b.lastRiskScore - a.lastRiskScore)[0];
  const disrupted = owned.filter((s) => s.currentStatus !== 'OPEN');
  const roadKm = owned.reduce((total, s) => total + (s.distanceKm ?? 0), 0);

  return (
    <div className="flex flex-col gap-2">
      <SectionLabel rule>Road segments</SectionLabel>
      <p className="text-meta leading-relaxed text-ink-2">
        <span className="font-semibold text-ink">{owned.length}</span> legs
        {roadKm > 0 ? <> over {Math.round(roadKm)} km</> : null}
        {': '}
        <span className="tnum">{owned.map((s) => s.name).join(' · ')}</span>
        {hottest ? (
          <>
            {'. Highest risk: '}
            <span className="font-semibold text-ink">
              {hottest.code} {hottest.name}
            </span>{' '}
            at {hottest.lastRiskScore}.
          </>
        ) : null}
      </p>
      {disrupted.length ? (
        <p className="text-meta leading-relaxed text-risk-critical">
          {disrupted.map((s) => `${s.code} ${s.currentStatus.toLowerCase()}`).join(', ')}.
        </p>
      ) : null}
    </div>
  );
}

function Condition({
  icon,
  label,
  value,
  valueClass,
}: {
  icon: IconName;
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-2 border-b border-line-soft py-[7px] last:border-b-0">
      <dt className="flex min-w-0 items-center gap-1.5 text-meta text-ink-2">
        <Icon name={icon} size="sm" className="shrink-0 text-ink-3" />
        <span className="truncate">{label}</span>
      </dt>
      <dd className={cn('tnum shrink-0 text-meta font-semibold', valueClass ?? 'text-ink')}>
        {value}
      </dd>
    </div>
  );
}

/**
 * Historical disruption on this corridor.
 *
 * Four counts, but not four cards: a single bordered block with the dominant figure — recorded
 * closures — given the weight, and the rest as supporting rows. Row-of-identical-cards is the
 * pattern this design system exists to avoid.
 */
export function HistoricalContext({
  route,
  className,
}: {
  route: RouteCandidate;
  className?: string;
}) {
  const history = route.profile?.history;
  if (!history) return null;

  const rows: { icon: IconName; label: string; value: string }[] = [
    { icon: 'terrain', label: 'Landslides', value: formatNumber(history.landslides) },
    { icon: 'rainfall', label: 'Flood events', value: formatNumber(history.floods) },
    {
      icon: 'prediction',
      label: 'Average closure',
      value: `${history.avgClosureHours}h`,
    },
  ];

  return (
    <div className={cn('flex min-w-0 items-stretch gap-4', className)}>
      <div className="flex shrink-0 flex-col justify-center rounded-panel border border-line bg-panel-alt px-4 py-3">
        <span className="t-label whitespace-nowrap">Recorded closures</span>
        <span className="mt-1 flex items-baseline gap-1.5">
          <MetricValue value={history.previousClosures} size="md" />
          <span className="text-meta text-ink-3">in 12 months</span>
        </span>
      </div>

      <dl className="flex min-w-0 flex-1 flex-col justify-center">
        {rows.map((r) => (
          <div
            key={r.label}
            className="flex items-center justify-between gap-3 border-b border-line-soft py-[7px] last:border-b-0"
          >
            <dt className="flex items-center gap-1.5 text-meta text-ink-2">
              <Icon name={r.icon} size="sm" className="text-ink-3" />
              {r.label}
            </dt>
            <dd className="tnum text-body font-semibold text-ink">{r.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
