/**
 * The right column: everything the operator needs to decide about one delivery.
 *
 * Reads top to bottom as an argument:
 *   what is moving → which route it is on → how bad that is → what to do instead → why.
 *
 * Every number is rendered from the data source. The panel derives exactly two things itself,
 * both of which are presentation rather than data: the shared display scale for the SHAP bars,
 * and the "↑ +66" delta, which is a genuine observation of how far the value moved since the
 * component last rendered it (`usePrevious`) rather than a figure the client invented.
 */

import { cn } from '@/lib/cn';
import { formatDuration, formatProbability } from '@/domain/format';
import { RISK_TONE, riskLevelForScore } from '@/domain/thresholds';
import type { AIRecommendation, Delivery, RouteCandidate } from '@/domain/types';
import { usePrevious } from '@/lib/usePrevious';
import { shortRouteName } from '../shared/delivery';
import {
  Button,
  Chip,
  Icon,
  IconBadge,
  MetricValue,
  PanelFrame,
  PanelHeader,
  PriorityChip,
  ProvenanceTag,
  SectionLabel,
  Skeleton,
} from '@/design/primitives';
import { RiskFactors } from '../shared/RiskFactors';

export interface DeliveryIntelligencePanelProps {
  delivery: Delivery | undefined;
  recommendation: AIRecommendation | undefined;
  candidates: RouteCandidate[];
  selectedRouteId: string | undefined;
  onSelectRoute: (routeId: string) => void;
  loading: boolean;
  className?: string;
}

export function DeliveryIntelligencePanel({
  delivery,
  recommendation,
  candidates,
  selectedRouteId,
  onSelectRoute,
  loading,
  className,
}: DeliveryIntelligencePanelProps) {
  const selected =
    candidates.find((c) => c.id === selectedRouteId) ??
    candidates.find((c) => c.isRecommended) ??
    candidates[0];
  const recommended = candidates.find((c) => c.isRecommended);

  const riskScore = selected?.riskScore ?? 0;
  const level = selected ? selected.riskLevel : 'LOW';
  const tone = RISK_TONE[level];

  // How far these two moved since this panel last rendered them — the cascade made them move.
  // Fed `undefined` until a route is actually selected, so a freshly loaded panel does not
  // report the first real value as a rise from nothing.
  const prevRouteId = usePrevious(selected?.id);
  const prevRisk = usePrevious(selected?.riskScore);
  const prevEta = usePrevious(selected?.etaMinutes);

  // A delta is only meaningful when it is the SAME route re-scored. Switching from Route A to
  // Route B is not "risk rose by 11" — it is a different road, and reporting it as a change
  // would be a lie the operator has no way to catch.
  const sameRoute = selected !== undefined && prevRouteId === selected.id;
  const isAssignedRoute = selected !== undefined && selected.id === delivery?.assignedRouteId;
  const riskDelta =
    sameRoute && prevRisk !== undefined ? selected.riskScore - prevRisk : undefined;
  const etaDelta =
    sameRoute && prevEta !== undefined ? selected.etaMinutes - prevEta : undefined;

  return (
    <PanelFrame
      className={cn('min-h-0', className)}
      scroll
      bodyClassName="gap-4"
      header={
        <PanelHeader
          title={delivery ? `Delivery ${delivery.code}` : 'Delivery'}
          icon="deliveries"
          badge={delivery ? <PriorityChip priority={delivery.priority} /> : undefined}
          actions={
            <Button variant="ghost" size="sm" iconRight="arrowRight">
              View Details
            </Button>
          }
        />
      }
    >
      {loading || !delivery || !selected ? (
        <LoadingBody />
      ) : (
        <>
          {/* --- What is moving ------------------------------------------- */}
          <div className="flex shrink-0 items-start gap-3">
            <IconBadge name="vehicle" tone="neutral" size="lg" />
            <div className="flex min-w-0 flex-col gap-0.5">
              <p className="flex items-center gap-1.5 text-body-lg font-semibold leading-tight text-ink">
                <span className="truncate">{delivery.originName ?? 'Origin'}</span>
                <Icon name="arrowRight" size="sm" className="shrink-0 text-ink-3" />
                <span className="truncate">{delivery.destName ?? 'Destination'}</span>
              </p>
              <p className="text-meta text-ink-2">{delivery.cargoType}</p>
            </div>
          </div>

          {/* --- Which route ---------------------------------------------- */}
          <section className="flex shrink-0 flex-col gap-2">
            <SectionLabel rule>Route under assessment</SectionLabel>
            <div className="grid grid-cols-3 gap-1.5">
              {candidates.map((c) => {
                const cTone = RISK_TONE[c.riskLevel];
                const active = c.id === selected.id;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => onSelectRoute(c.id)}
                    aria-pressed={active}
                    title={`${c.name} · ${c.distanceKm.toFixed(0)} km`}
                    className={cn(
                      'group relative flex flex-col items-start gap-1 rounded-control border px-2 py-1.5',
                      'transition-all duration-150 ease-ui',
                      active
                        ? 'border-ink/25 bg-panel-alt shadow-inset'
                        : 'border-line bg-panel hover:border-ink-3/50 hover:bg-panel-alt',
                    )}
                  >
                    {c.isRecommended ? (
                      <span className="absolute right-1.5 top-1.5 text-[8.5px] font-bold uppercase tracking-[0.06em] text-brand-500">
                        Best
                      </span>
                    ) : null}
                    <span className="text-[10px] font-semibold uppercase tracking-[0.05em] text-ink-3">
                      {shortRouteName(c.name)}
                    </span>
                    <span className="flex items-baseline gap-1">
                      <span className={cn('tnum text-[15px] font-semibold leading-none', cTone.text)}>
                        {c.riskScore}%
                      </span>
                    </span>
                    <span className="tnum text-[10px] text-ink-3">
                      {formatDuration(c.etaMinutes)}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          {/* --- How bad -------------------------------------------------- */}
          <section className="grid shrink-0 grid-cols-3 gap-2 rounded-panel border border-line bg-panel-alt p-3">
            <Readout
              label="Disruption Risk"
              value={
                <MetricValue value={riskScore} unit="%" size="md" className={tone.text} />
              }
              delta={
                riskDelta && riskDelta !== 0
                  ? { text: `${riskDelta > 0 ? '+' : ''}${riskDelta}`, bad: riskDelta > 0 }
                  : undefined
              }
            />
            <Readout
              label="Current ETA"
              value={
                <span className="t-metric whitespace-nowrap text-[22px]">
                  {formatDuration(selected.etaMinutes)}
                </span>
              }
              delta={
                etaDelta && etaDelta !== 0
                  ? {
                      text: `${etaDelta > 0 ? '+' : ''}${formatDuration(etaDelta)}`,
                      bad: etaDelta > 0,
                    }
                  : // The delivery's own predicted delay only describes the route it is actually
                    // assigned to. Showing it beside a different candidate's ETA would attribute
                    // Route A's delay to Route B.
                    isAssignedRoute && delivery.expectedDelayMinutes
                    ? { text: `+${formatDuration(delivery.expectedDelayMinutes)}`, bad: true }
                    : undefined
              }
            />
            <Readout
              label="Risk Level"
              value={
                <span
                  className={cn(
                    'inline-flex items-center rounded-chip border px-2 py-1 text-[12.5px] font-bold uppercase tracking-[0.04em]',
                    tone.wash,
                    tone.text,
                    tone.border,
                  )}
                >
                  {level}
                </span>
              }
            />
          </section>

          {/* --- What to do ----------------------------------------------- */}
          <RecommendationBlock
            recommendation={recommendation}
            recommended={recommended}
            selected={selected}
            onUseRoute={onSelectRoute}
          />

          {/* --- Context -------------------------------------------------- */}
          {/* Priority already appears as the panel header badge, so it is not repeated here —
              two facts at half width read better than three that all truncate. */}
          <section className="grid shrink-0 grid-cols-2 gap-2">
            <Fact icon="medicine" label="Cargo" value={delivery.cargoType} />
            <Fact icon="hospital" label="Destination" value={delivery.destName ?? '—'} />
          </section>

          {/* --- Why ------------------------------------------------------ */}
          <RiskFactors
            factors={selected.topFactors}
            level={level}
            explanation={selected.explanationText}
            routeName={selected.name}
          />
        </>
      )}
    </PanelFrame>
  );
}

// ---------------------------------------------------------------------------
// Recommendation
// ---------------------------------------------------------------------------

function RecommendationBlock({
  recommendation,
  recommended,
  selected,
  onUseRoute,
}: {
  recommendation: AIRecommendation | undefined;
  recommended: RouteCandidate | undefined;
  selected: RouteCandidate;
  onUseRoute: (id: string) => void;
}) {
  const rerouteAvailable = recommended && recommended.id !== selected.id;

  // The decision comes from the deterministic decision engine, not from this component. When no
  // recommendation has been issued, the panel says exactly that rather than inventing one.
  const headline = recommendation
    ? recommendation.type === 'REROUTE' && recommended
      ? `Use ${shortRouteName(recommended.name)}`
      : recommendation.type.replace('_', ' ')
    : rerouteAvailable
      ? `Use ${shortRouteName(recommended.name)}`
      : 'No action required';

  const body = recommendation
    ? recommendation.recommendationText
    : rerouteAvailable
      ? `${shortRouteName(recommended.name)} currently scores lower on the same model. No reroute has been issued — the delivery is inside tolerance.`
      : 'The assigned route is the lowest-risk candidate. The corridor is being monitored; no action is outstanding.';

  const active = Boolean(recommendation);

  return (
    <section
      className={cn(
        // `shrink-0` is load-bearing: this section is a flex item in the panel's scrolling
        // column, and `overflow-hidden` sets its min-height to 0, so without it the whole
        // recommendation is silently crushed to nothing while still measuring as present.
        'shrink-0 overflow-hidden rounded-panel border',
        active ? 'border-brand-500/30 bg-brand-50' : 'border-line bg-panel-alt',
      )}
    >
      <header
        className={cn(
          'flex items-center gap-2 border-b px-3 py-2',
          active ? 'border-brand-500/15 bg-brand-500/[0.07]' : 'border-line-soft',
        )}
      >
        <Icon name="ai" size="sm" className={active ? 'text-brand-700' : 'text-ink-3'} />
        <span
          className={cn(
            'text-[11px] font-bold uppercase tracking-[0.06em]',
            active ? 'text-brand-900' : 'text-ink-3',
          )}
        >
          AI Recommendation
        </span>
        {active ? (
          <Chip tone="brand" size="sm" className="ml-auto">
            {formatProbability(recommendation!.confidence)} confidence
          </Chip>
        ) : (
          <Chip tone="outline" size="sm" className="ml-auto">
            Monitoring
          </Chip>
        )}
      </header>

      <div className="flex items-start gap-3 px-3 py-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <p
            className={cn(
              'font-display text-[19px] font-semibold uppercase leading-none tracking-[-0.01em]',
              active ? 'text-brand-900' : 'text-ink-2',
            )}
          >
            {headline}
          </p>
          <p className="text-meta leading-relaxed text-ink-2">{body}</p>

          {rerouteAvailable ? (
            <div className="mt-1 flex items-center gap-3 text-[11px]">
              <span className="tnum flex items-center gap-1 text-ink-2">
                <span className="text-ink-3">Risk</span>
                <span className={cn('font-semibold', RISK_TONE[riskLevelForScore(recommended.riskScore)].text)}>
                  {recommended.riskScore}%
                </span>
              </span>
              <span className="h-3 w-px bg-line" />
              <span className="tnum flex items-center gap-1 text-ink-2">
                <span className="text-ink-3">ETA</span>
                <span className="font-semibold text-ink">
                  {formatDuration(recommended.etaMinutes)}
                </span>
              </span>
            </div>
          ) : null}
        </div>

        {rerouteAvailable ? (
          <Button
            variant="primary"
            size="sm"
            iconRight="arrowRight"
            onClick={() => onUseRoute(recommended.id)}
            className="shrink-0 whitespace-nowrap"
          >
            {shortRouteName(recommended.name).toUpperCase()}
          </Button>
        ) : null}
      </div>

      <footer className="flex items-center justify-between gap-2 border-t border-line-soft px-3 py-1.5">
        <span className="text-[10px] text-ink-3">
          Deterministic decision engine · not a language-model output
        </span>
        <ProvenanceTag kind="ML_PREDICTION" subtle />
      </footer>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Small parts
// ---------------------------------------------------------------------------

function Readout({
  label,
  value,
  delta,
}: {
  label: string;
  value: React.ReactNode;
  delta?: { text: string; bad: boolean };
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-label uppercase leading-[13px] text-ink-3">{label}</span>
      <div className="flex min-w-0 items-baseline gap-1.5">{value}</div>
      {delta ? (
        <span
          className={cn(
            'tnum inline-flex items-center gap-0.5 text-[11px] font-semibold',
            delta.bad ? 'text-risk-critical' : 'text-risk-low',
          )}
        >
          <Icon name={delta.bad ? 'up' : 'down'} size="sm" />
          {delta.text}
        </span>
      ) : (
        <span className="h-[14px]" />
      )}
    </div>
  );
}

function Fact({
  icon,
  label,
  value,
}: {
  icon: Parameters<typeof Icon>[0]['name'];
  label: string;
  value: string;
}) {
  return (
    <div className="flex min-w-0 items-start gap-2 rounded-control border border-line bg-panel px-2 py-1.5">
      <Icon name={icon} size="sm" className="mt-[2px] shrink-0 text-ink-3" />
      <div className="flex min-w-0 flex-col">
        <span className="text-[10px] font-semibold uppercase tracking-[0.05em] text-ink-3">
          {label}
        </span>
        <span className="truncate text-[11.5px] font-medium text-ink" title={value}>
          {value}
        </span>
      </div>
    </div>
  );
}

function LoadingBody() {
  return (
    <div className="flex flex-col gap-4" aria-busy>
      <div className="flex items-start gap-3">
        <Skeleton className="h-11 w-11" />
        <div className="flex flex-1 flex-col gap-2 pt-1">
          <Skeleton className="h-3 w-3/4" rounded="sm" />
          <Skeleton className="h-2.5 w-1/2" rounded="sm" />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-14" />
        ))}
      </div>
      <Skeleton className="h-24" />
      <Skeleton className="h-32" />
    </div>
  );
}


