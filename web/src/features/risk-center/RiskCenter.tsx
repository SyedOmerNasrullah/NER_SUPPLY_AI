/**
 * AI Risk Center — where risk is rising, why, and what the engine does about it.
 *
 * The analytical surface of the product, and the one that has to survive the sharpest question a
 * judge can ask: *does the language model decide anything?* It does not, and this page is built
 * to make that legible — model output and narration are separated everywhere they appear, and
 * the decision engine is shown as the if/else ladder it is.
 *
 * One ranked list across three entity kinds (segment, route, delivery, supply), because an
 * operator's question is "what is worst right now", not "what is the worst route".
 */

import { useCallback, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { cn } from '@/lib/cn';
import { dataSource } from '@/data';
import {
  useAlerts,
  useDeliveries,
  useDistricts,
  useResource,
  useRiskSegments,
  useRouteCandidates,
  useWeather,
} from '@/data/hooks';
import { formatStockout, humanizeEnum } from '@/domain/format';
import {
  RISK_TONE,
  riskLevelForProbability,
  riskLevelForScore,
  stockoutAsRiskLevel,
} from '@/domain/thresholds';
import type { RiskLevel } from '@/domain/types';
import {
  Async,
  Button,
  Chip,
  Column,
  DataTable,
  EmptyState,
  Icon,
  PanelFrame,
  PanelHeader,
  ProvenanceTag,
  RadialGauge,
  RiskBarCell,
  RiskChip,
  SectionLabel,
  SkeletonRows,
  SkeletonTile,
  StatTile,
  type IconName,
} from '@/design/primitives';
import { HeroBand } from '@/shell/HeroBand';
import { useShellRailNote } from '@/shell/AppShell';
import ridgeline from '@/assets/ner-ridgeline.jpg';
import { supplyLinePath } from '../shared/supplyLink';
import { RiskFactors } from '../shared/RiskFactors';
import { featuredDelivery, shortRouteName } from '../shared/delivery';
import { DecisionEngine } from './DecisionEngine';

type EntityKind = 'ROUTE' | 'SEGMENT' | 'DELIVERY' | 'SUPPLY';

interface RiskEntity {
  id: string;
  kind: EntityKind;
  name: string;
  context: string;
  /** 0-100, on one scale so a mixed list can be ranked honestly. */
  score: number;
  level: RiskLevel;
  /** The largest single contributor, where the entity carries a factor breakdown. */
  driver: string;
  action: string;
  target: string;
}

const KIND_ICON: Record<EntityKind, IconName> = {
  ROUTE: 'routes',
  SEGMENT: 'risk',
  DELIVERY: 'deliveries',
  SUPPLY: 'supply',
};

export function RiskCenter() {
  const navigate = useNavigate();
  const segments = useRiskSegments();
  const deliveries = useDeliveries();
  const districts = useDistricts();
  const alerts = useAlerts();
  const weather = useWeather();

  const delivery = useMemo(
    () => featuredDelivery(deliveries.data?.deliveries ?? []),
    [deliveries.data],
  );

  const routeParams = useMemo(
    () => ({
      originLat: delivery?.originLat ?? 0,
      originLng: delivery?.originLng ?? 0,
      destLat: delivery?.destLat ?? 0,
      destLng: delivery?.destLng ?? 0,
      cargoPriority: delivery?.priority ?? ('MEDIUM' as const),
      deliveryId: delivery?.id,
    }),
    [delivery],
  );
  const candidates = useRouteCandidates(routeParams);
  const routeList = candidates.data?.candidates ?? [];

  const detail = useResource(
    async () =>
      delivery
        ? await dataSource.getDeliveryById(delivery.id)
        : { delivery: undefined, recommendation: undefined, decision: undefined },
    [delivery?.id],
  );

  // --- One ranked list across every kind of risk ----------------------------
  const entities = useMemo<RiskEntity[]>(() => {
    const out: RiskEntity[] = [];

    for (const c of routeList) {
      const top = [...c.topFactors].sort((a, b) => b.contributionPct - a.contributionPct)[0];
      out.push({
        id: c.id,
        kind: 'ROUTE',
        name: shortRouteName(c.name),
        context: c.name.split('—')[1]?.trim() ?? 'Candidate corridor',
        score: c.riskScore,
        level: c.riskLevel,
        driver: top ? top.factor : '—',
        action: c.isRecommended ? 'Recommended' : c.riskScore >= 70 ? 'Reroute away' : 'Monitor',
        target: `/routes?route=${c.id}`,
      });
    }

    for (const s of (segments.data?.segments ?? []).slice(0, 6)) {
      out.push({
        id: s.id,
        kind: 'SEGMENT',
        name: s.code,
        context: s.name,
        score: s.lastRiskScore,
        level: riskLevelForScore(s.lastRiskScore),
        driver:
          [...(s.lastRiskFactors ?? [])].sort(
            (a, b) => b.contributionPct - a.contributionPct,
          )[0]?.factor ?? '—',
        action: s.currentStatus === 'BLOCKED' ? 'Closed to heavy vehicles' : 'Monitor',
        target: `/incidents`,
      });
    }

    for (const d of deliveries.data?.deliveries ?? []) {
      if (d.status === 'DELIVERED' || d.failureProbability === undefined) continue;
      const score = Math.round(d.failureProbability * 100);
      out.push({
        id: d.id,
        kind: 'DELIVERY',
        name: d.code,
        context: `${d.originName} → ${d.destName}`,
        score,
        level: riskLevelForProbability(d.failureProbability),
        driver: d.expectedDelayMinutes ? 'Predicted delay' : 'Route risk',
        action: score >= 70 ? 'Reroute or escalate' : 'Monitor',
        target: `/deliveries/${d.code}`,
      });
    }

    for (const dist of districts.data?.districts ?? []) {
      for (const category of ['medicine', 'food', 'fuel'] as const) {
        const hours = dist.stock[category].predictedStockoutHours;
        const level = stockoutAsRiskLevel(hours);
        if (hours === null || level === null || level === 'LOW') continue;
        // Map hours onto the same 0-100 scale the rest of the list uses: at the 96-hour
        // warning boundary a line reads 40, at zero cover it reads 100.
        const score = Math.max(0, Math.min(100, Math.round(100 - (hours / 96) * 60)));
        out.push({
          id: `${dist.id}:${category}`,
          kind: 'SUPPLY',
          name: `${dist.name} · ${humanizeEnum(category)}`,
          context: `Cover ${formatStockout(hours)}`,
          score,
          level,
          driver: 'Delay-adjusted consumption',
          action: level === 'CRITICAL' ? 'Pre-position' : 'Monitor',
          target: supplyLinePath(dist.id, category),
        });
      }
    }

    return out.sort((a, b) => b.score - a.score);
  }, [routeList, segments.data, deliveries.data, districts.data]);

  // --- Selection ------------------------------------------------------------
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedId = searchParams.get('entity') ?? undefined;
  const selected = entities.find((e) => e.id === requestedId) ?? entities[0];
  /**
   * A sentence about the numbers on screen, asked for only when an entity is open.
   *
   * The figures are never taken from the answer — they are already rendered above it from the
   * model's own output. This adds words, and the tag beneath says whether a language model or
   * the deterministic template wrote them.
   */
  const narrativeTarget = useMemo(() => {
    if (!selected) return null;
    if (selected.kind === 'ROUTE') return { kind: 'ROUTE' as const, targetId: selected.id };
    if (selected.kind === 'DELIVERY') return { kind: 'DELIVERY' as const, targetId: selected.id };
    return null;
  }, [selected]);

  const narrative = useResource(
    async () => (narrativeTarget ? await dataSource.explain(narrativeTarget) : undefined),
    [narrativeTarget?.kind, narrativeTarget?.targetId],
  );

  const onSelect = useCallback(
    (id: string) => setSearchParams({ entity: id }, { replace: true }),
    [setSearchParams],
  );

  /** The route whose explainability the "why" panel shows for the current selection. */
  const explained = useMemo(() => {
    if (selected?.kind === 'ROUTE') return routeList.find((r) => r.id === selected.id);
    // Every other kind inherits its risk from the corridor the delivery is on, so that is the
    // breakdown worth showing — labelled as such rather than pretending it is the entity's own.
    return routeList.find((r) => r.id === delivery?.assignedRouteId) ?? routeList[0];
  }, [selected, routeList, delivery]);

  const totals = useMemo(() => {
    const bad = (e: RiskEntity) => e.level === 'CRITICAL' || e.level === 'HIGH';
    return {
      routes: entities.filter((e) => e.kind === 'ROUTE' && bad(e)).length,
      deliveries: entities.filter((e) => e.kind === 'DELIVERY' && bad(e)).length,
      supply: entities.filter((e) => e.kind === 'SUPPLY' && bad(e)).length,
      alerts: (alerts.data?.alerts ?? []).filter(
        (a) => a.severity === 'CRITICAL' || a.severity === 'HIGH',
      ).length,
    };
  }, [entities, alerts.data]);

  const simulated = weather.data?.weather.simulated ?? false;

  useShellRailNote(
    selected ? (
      <span className="flex items-center gap-1.5">
        <Icon name="risk" size="sm" className="opacity-60" />
        <span className="hidden lg:inline">Assessing</span>
        <span className="font-semibold text-ink-2">{selected.name}</span>
      </span>
    ) : null,
    [selected?.id],
  );

  const loading = segments.loading || candidates.loading;

  const columns: Column<RiskEntity>[] = [
    {
      key: 'entity',
      header: 'Entity',
      render: (e) => (
        <div className="flex min-w-0 items-center gap-2">
          <Icon name={KIND_ICON[e.kind]} size="sm" className="shrink-0 text-ink-3" />
          <div className="flex min-w-0 flex-col leading-tight">
            <span className="truncate text-body font-medium text-ink">{e.name}</span>
            <span className="truncate text-meta text-ink-3">{e.context}</span>
          </div>
        </div>
      ),
    },
    {
      key: 'kind',
      header: 'Type',
      width: '104px',
      render: (e) => (
        <Chip tone="outline" size="sm">
          {humanizeEnum(e.kind)}
        </Chip>
      ),
    },
    {
      key: 'risk',
      header: 'Risk',
      width: '170px',
      render: (e) => <RiskBarCell score={e.score} width={84} />,
    },
    {
      key: 'level',
      header: 'Severity',
      width: '112px',
      render: (e) => <RiskChip level={e.level} size="sm" />,
    },
    {
      key: 'driver',
      header: 'Primary driver',
      render: (e) => (
        <span className="truncate text-meta text-ink-2" title={e.driver}>
          {e.driver}
        </span>
      ),
    },
    {
      key: 'action',
      header: 'Recommended',
      align: 'right',
      width: '160px',
      render: (e) => (
        <span
          className={cn(
            'text-meta',
            e.level === 'CRITICAL' ? 'font-semibold text-risk-critical' : 'text-ink-2',
          )}
        >
          {e.action}
        </span>
      ),
    },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto scroll-thin">
      {/* ============================================================= HERO === */}
      <HeroBand
        image={ridgeline}
        size="sm"
        eyebrow="AI Risk Center"
        eyebrowIcon="model"
        title="Where risk is rising, why, and what the engine does about it."
        subtitle="XGBoost route and delivery risk, SHAP attribution, and the deterministic decision rules that act on them."
        credit="Photo: Kingshuk Mondal, CC BY 4.0"
        right={
          <div className="flex items-center gap-3">
            <div className="hidden flex-col items-end gap-1 border-r border-white/15 pr-3 xl:flex">
              <span className="text-[10px] uppercase tracking-[0.06em] text-white/55">
                Corridor conditions
              </span>
              <span className="text-[13px] font-semibold text-white">
                {weather.data?.weather.label ?? '—'}
              </span>
            </div>
            <div className="flex flex-col items-end gap-1.5">
              <Chip tone="navy" size="sm" icon="model">
                {entities.length} entities scored
              </Chip>
              <ProvenanceTag
                kind={simulated ? 'SIMULATION_EVENT' : 'ML_PREDICTION'}
                onNavy
              />
            </div>
          </div>
        }
      />

      {/* ============================================================== KPI === */}
      <div className="shrink-0 px-3 pt-3">
        {loading ? (
          <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <SkeletonTile key={i} />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
            <StatTile
              label="Routes at High Risk"
              value={totals.routes}
              icon="routes"
              tone={totals.routes > 0 ? 'critical' : 'low'}
              accent={totals.routes > 0 ? 'critical' : undefined}
              footnote="of the scored candidates"
            />
            <StatTile
              label="Deliveries at High Risk"
              value={totals.deliveries}
              icon="deliveries"
              tone={totals.deliveries > 0 ? 'high' : 'low'}
              footnote="failure probability 70% or above"
            />
            <StatTile
              label="Supply Lines at Risk"
              value={totals.supply}
              icon="supply"
              tone={totals.supply > 0 ? 'medium' : 'low'}
              footnote="below the 96-hour line"
            />
            <StatTile
              label="Active Alerts"
              value={totals.alerts}
              icon="alert"
              tone={totals.alerts > 0 ? 'critical' : 'neutral'}
              footnote="high or critical"
            />
          </div>
        )}
      </div>

      {/* ================================================ EXPLAIN + DECIDE === */}
      <div className="grid shrink-0 grid-cols-1 gap-3 p-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {/* --- Model output, then narration ------------------------------- */}
        <PanelFrame
          className="min-h-[380px]"
          scroll
          header={
            <PanelHeader
              title="Risk Explanation"
              subtitle={selected ? `${selected.name} · ${selected.context}` : undefined}
              icon="explanation"
              badge={selected ? <RiskChip level={selected.level} score={selected.score} size="sm" /> : undefined}
            />
          }
        >
          {loading || !selected || !explained ? (
            <SkeletonRows rows={5} />
          ) : (
            <div className="flex flex-col gap-4">
              <section className="flex items-center gap-4">
                <RadialGauge
                  value={selected.score}
                  level={selected.level}
                  size={112}
                  thickness={10}
                  label="Model output"
                />
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  <div className="flex flex-col gap-0.5">
                    <span className="t-label">Risk score</span>
                    <span
                      className={cn(
                        'tnum text-[27px] font-semibold leading-none',
                        RISK_TONE[selected.level].text,
                      )}
                    >
                      {selected.score}
                      <span className="ml-1 text-[17px] font-medium text-ink-3">/ 100</span>
                    </span>
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="t-label">Risk level</span>
                    <RiskChip level={selected.level} />
                  </div>
                </div>
              </section>

              {selected.kind !== 'ROUTE' ? (
                <p className="rounded-panel border border-line bg-panel-alt px-3 py-2 text-[10.5px] leading-relaxed text-ink-2">
                  Factor attribution below is for{' '}
                  <span className="font-semibold text-ink">{shortRouteName(explained.name)}</span>
                  {selected.kind === 'SEGMENT'
                    ? ', the corridor that runs over this segment. Segment scores are inputs to the route score, so the route breakdown is where the drivers are named.'
                    : `, the corridor this ${humanizeEnum(selected.kind).toLowerCase()} depends on. A delivery and a supply line inherit their risk from the road, so that is the breakdown worth reading.`}
                </p>
              ) : null}

              <RiskFactors
                factors={explained.topFactors}
                level={explained.riskLevel}
                // The live explanation when the service produced one, the seeded narration
                // until then. Either way the label below it says which.
                explanation={narrative.data?.explanation.text ?? explained.explanationText}
                explanationSource={
                  narrative.data ? narrative.data.explanation.source : 'SYNTHETIC_OPERATIONAL'
                }
                explanationNote={
                  narrative.loading
                    ? 'Generating explanation…'
                    : narrative.data?.explanation.fallbackReason ?? explained.name
                }
                routeName={explained.name}
                heading="Top contributing factors"
              />

              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  iconRight="arrowRight"
                  onClick={() => navigate(selected.target)}
                >
                  Open {humanizeEnum(selected.kind).toLowerCase()}
                </Button>
              </div>
            </div>
          )}
        </PanelFrame>

        {/* --- The decision ladder ---------------------------------------- */}
        <PanelFrame
          className="min-h-[380px]"
          scroll
          header={
            <PanelHeader
              title="Master Decision Engine"
              subtitle={delivery ? `Evaluated for ${delivery.code}` : undefined}
              icon="ai"
              actions={<ProvenanceTag kind="ML_PREDICTION" />}
            />
          }
        >
          {detail.loading ? (
            <SkeletonRows rows={5} />
          ) : (
            <DecisionEngine trace={detail.data?.decision} />
          )}
        </PanelFrame>
      </div>

      {/* ========================================================== RANKING === */}
      <div className="shrink-0 px-3 pb-3">
        <PanelFrame
          flushBody
          header={
            <PanelHeader
              title="Risk Ranking"
              subtitle="Every scored entity on one scale — routes, segments, deliveries and supply lines"
              icon="risk"
              badge={
                <Chip tone="neutral" size="sm">
                  {entities.length}
                </Chip>
              }
              actions={<ProvenanceTag kind="ML_PREDICTION" />}
            />
          }
        >
          <Async
            state={segments}
            skeleton={<SkeletonRows rows={8} />}
            isEmpty={() => entities.length === 0}
            empty={
              <EmptyState
                tone="positive"
                icon="ok"
                size="sm"
                title="Nothing scored above threshold"
                description="No route, delivery or supply line is currently flagged."
              />
            }
          >
            {() => (
              <div className="max-h-[380px] overflow-y-auto scroll-thin">
                <DataTable
                  columns={columns}
                  rows={entities}
                  rowKey={(e) => e.id}
                  density="compact"
                  stickyHeader
                  onRowClick={(e) => onSelect(e.id)}
                  isRowActive={(e) => e.id === selected?.id}
                  rowAccent={(e) => RISK_TONE[e.level].rail}
                />
              </div>
            )}
          </Async>
        </PanelFrame>
      </div>

      {/* =================================================== ROUTE COMPARE === */}
      <div className="shrink-0 px-3 pb-3">
        <PanelFrame
          header={
            <PanelHeader
              title="Candidate Comparison"
              subtitle="Every scored candidate carries its own attribution — not only the recommendation"
              icon="routes"
              actions={<ProvenanceTag kind="ML_PREDICTION" />}
            />
          }
        >
          {loading ? (
            <SkeletonRows rows={3} />
          ) : (
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
              {routeList.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => onSelect(c.id)}
                  aria-pressed={selected?.id === c.id}
                  className={cn(
                    'flex min-w-0 flex-col gap-2.5 rounded-panel border px-3.5 py-3 text-left',
                    'transition-all duration-150 ease-ui',
                    selected?.id === c.id
                      ? 'border-ink/25 bg-panel-alt shadow-inset'
                      : 'border-line bg-panel hover:border-ink-3/50 hover:bg-panel-alt',
                  )}
                >
                  <div className="flex items-baseline gap-2">
                    <span className="text-body font-semibold text-ink">
                      {shortRouteName(c.name)}
                    </span>
                    {c.isRecommended ? (
                      <Chip tone="brand" size="sm" icon="ai" className="ml-auto">
                        Recommended
                      </Chip>
                    ) : null}
                  </div>

                  <div className="flex items-baseline gap-2">
                    <span
                      className={cn(
                        'tnum text-[24px] font-semibold leading-none',
                        RISK_TONE[c.riskLevel].text,
                      )}
                    >
                      {c.riskScore}%
                    </span>
                    <RiskChip level={c.riskLevel} size="sm" />
                  </div>

                  <SectionLabel>Contributions</SectionLabel>
                  <ul className="flex flex-col gap-1">
                    {[...c.topFactors]
                      .sort((a, b) => b.contributionPct - a.contributionPct)
                      .slice(0, 3)
                      .map((f) => (
                        <li key={f.factor} className="flex items-center gap-2">
                          <span className="min-w-0 flex-1 truncate text-meta text-ink-2">
                            {f.factor}
                          </span>
                          <span
                            className={cn(
                              'tnum shrink-0 text-meta font-semibold',
                              RISK_TONE[c.riskLevel].text,
                            )}
                          >
                            +{f.contributionPct}%
                          </span>
                        </li>
                      ))}
                  </ul>
                </button>
              ))}
            </div>
          )}
        </PanelFrame>
      </div>

      <div className="flex shrink-0 items-center justify-between gap-3 px-4 pb-3">
        <p className="text-[10px] leading-relaxed text-ink-3">
          Risk scores are model output and factor contributions are SHAP values. The decision is a
          deterministic rule over those outputs. The explanatory sentence narrates the factors — it
          cannot change a score, and it does not choose the action.
        </p>
        <div className="flex shrink-0 items-center gap-3">
          <ProvenanceTag kind="ML_PREDICTION" />
          <ProvenanceTag kind="LLM_EXPLANATION" />
        </div>
      </div>
    </div>
  );
}
