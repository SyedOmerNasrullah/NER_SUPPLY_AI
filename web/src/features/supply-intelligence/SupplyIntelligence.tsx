/**
 * Supply Intelligence — which essential supplies are about to run out, where, and why.
 *
 * Reads as one argument:
 *   what is at risk      → the KPI strip and the ranked table
 *   when does it run out → the stockout forecast
 *   why                  → the causal chain from weather to shelf
 *   what do we do        → the pre-positioning recommendation
 *   who does it hurt     → the destination facility
 *
 * A supply line is a district AND a category — Tawang is not at risk, Tawang's *medicine* is.
 * Every figure comes from `getDistricts` / `getDistrictById` / `getDeliveries`; the KPI totals
 * and the ranking are derivations over those, in `supplyLines.ts`, not a separate endpoint.
 */

import { useCallback, useEffect, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { cn } from '@/lib/cn';
import { useAuth } from '@/app/auth';
import { reachableTarget } from '@/app/modules';
import { dataSource } from '@/data';
import { appNow } from '@/data/clock';
import { useDeliveries, useDistricts, useResource, useWeather } from '@/data/hooks';
import { formatDuration, formatNumber, formatStockout, humanizeEnum } from '@/domain/format';
import { RISK_TONE, stockoutAsRiskLevel } from '@/domain/thresholds';
import type { Role, SupplyProjection } from '@/domain/types';
import {
  Async,
  Button,
  Callout,
  CellStack,
  Chip,
  Column,
  DataTable,
  EmptyState,
  Icon,
  MetricValue,
  PanelFrame,
  PanelHeader,
  ProvenanceTag,
  SectionLabel,
  SkeletonRows,
  SkeletonTile,
  StatRow,
  StatTile,
  StockoutChip,
} from '@/design/primitives';
import { HeroBand } from '@/shell/HeroBand';
import { useShellRailNote } from '@/shell/AppShell';
import ridgeline from '@/assets/ner-ridgeline.jpg';
import { CausalChain } from '../shared/CausalChain';
import { parseSupplyLineId } from '../shared/supplyLink';
import { StockoutForecast } from './StockoutForecast';
import {
  CATEGORY_ICON,
  buildSupplyLines,
  daysRemaining,
  summarise,
  type SupplyLine,
} from './supplyLines';

export function SupplyIntelligence() {
  const navigate = useNavigate();
  // A District Officer sees only Supply and Analytics, so the cause chain's Routes and
  // Deliveries stages stay readable but stop offering a link that would bounce them back.
  const { user } = useAuth();
  const role = user?.role ?? 'DISTRICT_OFFICER';
  const districts = useDistricts();
  const deliveries = useDeliveries();
  const weather = useWeather();

  const lines = useMemo(
    () => buildSupplyLines(districts.data?.districts ?? [], deliveries.data?.deliveries ?? []),
    [districts.data, deliveries.data],
  );
  const totals = useMemo(() => summarise(lines), [lines]);

  // Selection lives in the URL for the same reasons Route Intelligence's does: another page can
  // link straight to a supply line, and back navigation behaves.
  // Resolved through `parseSupplyLineId` rather than by comparing the raw string: it splits the
  // composite from the right and validates the category against its union, so no district id —
  // colons and all — can resolve to the wrong line. Anything unparseable falls through to the
  // tightest line, which is what an operator arriving with a stale link should be shown anyway.
  const [searchParams, setSearchParams] = useSearchParams();
  const requested = parseSupplyLineId(searchParams.get('line'));
  const selected =
    (requested &&
      lines.find(
        (l) => l.districtId === requested.districtId && l.category === requested.category,
      )) ??
    totals.tightest ??
    lines[0];

  const onSelect = useCallback(
    (id: string) => setSearchParams({ line: id }, { replace: true }),
    [setSearchParams],
  );

  // Same honesty rule as Delivery Intelligence: if `line=` named something this world does not
  // contain, the page falls back to the tightest line — so correct the address bar to the line
  // actually shown instead of leaving it asserting one that is not there.
  useEffect(() => {
    if (searchParams.has('line') && selected && searchParams.get('line') !== selected.id) {
      setSearchParams({ line: selected.id }, { replace: true });
    }
  }, [searchParams, selected, setSearchParams]);

  // District detail carries the recommendation and the projection arithmetic (delta D17).
  const detail = useResource(
    async () =>
      selected
        ? await dataSource.getDistrictById(selected.districtId)
        : { district: undefined, recommendation: undefined, projections: undefined },
    [selected?.districtId],
  );

  const projection: SupplyProjection | undefined = detail.data?.projections?.find(
    (p) => p.category === selected?.category,
  );

  const simulated = weather.data?.weather.simulated ?? false;

  useShellRailNote(
    selected ? (
      <span className="flex items-center gap-1.5">
        <Icon name="supply" size="sm" className="opacity-60" />
        <span className="hidden lg:inline">Supply</span>
        <span className="font-semibold text-ink-2">
          {selected.district} · {humanizeEnum(selected.category)}
        </span>
      </span>
    ) : null,
    [selected?.id],
  );

  const loading = districts.loading || deliveries.loading;

  const columns: Column<SupplyLine>[] = [
    {
      key: 'supply',
      header: 'Supply',
      render: (l) => (
        <span className="flex items-center gap-2">
          <Icon name={CATEGORY_ICON[l.category]} size="sm" className="shrink-0 text-ink-3" />
          <span className="text-body font-medium text-ink">{humanizeEnum(l.category)}</span>
        </span>
      ),
    },
    {
      key: 'district',
      header: 'District',
      render: (l) => <CellStack primary={l.district} />,
    },
    {
      key: 'stock',
      header: 'Current Stock',
      numeric: true,
      width: '116px',
      render: (l) => formatNumber(l.currentStock),
    },
    {
      key: 'consumption',
      header: 'Consumption',
      numeric: true,
      width: '116px',
      render: (l) => <span className="text-ink-2">{l.dailyConsumption}/day</span>,
    },
    {
      key: 'days',
      header: 'Days Left',
      numeric: true,
      width: '92px',
      render: (l) => <span className="text-ink-2">{daysRemaining(l.stockoutHours)}</span>,
    },
    {
      key: 'stockout',
      header: 'Projected Stockout',
      numeric: true,
      width: '138px',
      render: (l) => (
        <span
          className={cn(
            'font-semibold',
            l.urgency === 'CRITICAL' ? 'text-risk-critical' : 'text-ink',
          )}
        >
          {formatStockout(l.stockoutHours)}
        </span>
      ),
    },
    {
      key: 'risk',
      header: 'Risk',
      width: '104px',
      render: (l) => <StockoutChip hours={l.stockoutHours} />,
    },
    {
      key: 'cause',
      header: 'Cause',
      render: (l) => (
        <span className="truncate text-meta text-ink-2" title={l.cause}>
          {l.cause}
        </span>
      ),
    },
    {
      key: 'action',
      header: 'Action',
      align: 'right',
      width: '128px',
      render: (l) =>
        l.urgency === 'CRITICAL' ? (
          <Chip tone="brand" size="sm" icon="ai">
            Pre-position
          </Chip>
        ) : l.urgency === 'WARNING' ? (
          <span className="text-meta text-ink-3">Monitor</span>
        ) : (
          <span className="text-meta text-ink-3">—</span>
        ),
    },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto scroll-thin">
      {/* ============================================================= HERO === */}
      <HeroBand
        image={ridgeline}
        eyebrow="Supply Intelligence"
        eyebrowIcon="supply"
        title="Which essential supplies run out, where, and when."
        subtitle="Delay-adjusted stockout projection for medicine, food and fuel across the North Eastern Region."
        credit="Photo: Kingshuk Mondal, CC BY 4.0"
        right={
          <div className="flex items-center gap-3">
            <div className="hidden flex-col items-end gap-1 border-r border-white/15 pr-3 xl:flex">
              <span className="text-[10px] uppercase tracking-[0.06em] text-white/55">
                Region conditions
              </span>
              <span className="text-[13px] font-semibold text-white">
                {weather.data?.weather.label ?? '—'}
              </span>
              <span className="text-[11px] text-white/60">
                {totals.districtsAffected} district{totals.districtsAffected === 1 ? '' : 's'} affected
              </span>
            </div>
            <div className="flex flex-col items-end gap-1.5">
              <Chip
                tone="navy"
                size="sm"
                icon={totals.critical > 0 ? 'critical' : 'ok'}
              >
                {totals.critical} below 48h
              </Chip>
              <ProvenanceTag
                kind={simulated ? 'SIMULATION_EVENT' : 'SYNTHETIC_OPERATIONAL'}
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
              label="Critical Supplies"
              value={totals.critical}
              icon="critical"
              tone={totals.critical > 0 ? 'critical' : 'low'}
              accent={totals.critical > 0 ? 'critical' : undefined}
              footnote="below the 48-hour line"
            />
            <StatTile
              label="At-Risk Supplies"
              value={totals.warning}
              icon="warning"
              tone={totals.warning > 0 ? 'medium' : 'neutral'}
              footnote="48–96 hours of cover"
            />
            <StatTile
              label="Projected Stockouts"
              value={totals.projectedStockouts}
              icon="supply"
              tone="high"
              footnote="lines needing action"
            />
            <StatTile
              label="Districts Affected"
              value={totals.districtsAffected}
              icon="operations"
              tone="brand"
              footnote={`of ${districts.data?.districts.length ?? 0} monitored`}
            />
          </div>
        )}
      </div>

      {/* ================================================= FORECAST + CAUSE === */}
      <div className="grid shrink-0 grid-cols-1 gap-3 p-3 xl:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
        <PanelFrame
          className="min-h-[300px]"
          header={
            <PanelHeader
              title="Stockout Forecast"
              subtitle={
                selected
                  ? `${selected.district} · ${humanizeEnum(selected.category)}`
                  : undefined
              }
              icon="analytics"
              badge={selected ? <StockoutChip hours={selected.stockoutHours} /> : undefined}
              actions={<ProvenanceTag kind="SYNTHETIC_OPERATIONAL" />}
            />
          }
        >
          {loading || !projection ? (
            <SkeletonRows rows={4} />
          ) : (
            <StockoutForecast
              projection={projection}
              inboundUnits={selected?.inbound?.cargoUnits}
              inboundEtaMinutes={
                selected?.inbound
                  ? Math.max(
                      0,
                      Math.round(
                        (Date.parse(selected.inbound.currentEta) - appNow()) / 60_000,
                      ),
                    )
                  : undefined
              }
            />
          )}
        </PanelFrame>

        {/* --- Why -------------------------------------------------------- */}
        <PanelFrame
          className="min-h-[300px]"
          scroll
          header={
            <PanelHeader
              title="Supply Risk Analysis"
              subtitle="How this line got here"
              icon="explanation"
            />
          }
        >
          {loading || !selected ? (
            <SkeletonRows rows={5} />
          ) : (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col divide-y divide-line-soft">
                <StatRow
                  label="Current stock"
                  icon="supply"
                  value={`${formatNumber(selected.currentStock)} units`}
                />
                <StatRow
                  label="Consumption rate"
                  icon="analytics"
                  value={`${selected.dailyConsumption} / day`}
                />
                <StatRow
                  label="Incoming delivery"
                  icon="deliveries"
                  value={
                    selected.inbound ? (
                      <button
                        type="button"
                        onClick={() => navigate(`/deliveries/${selected.inbound!.code}`)}
                        className="font-semibold text-brand-700 underline-offset-2 hover:underline"
                      >
                        {selected.inbound.code}
                      </button>
                    ) : (
                      <span className="text-ink-3">None scheduled</span>
                    )
                  }
                />
                {projection && projection.disruptionHours > 0 ? (
                  <StatRow
                    label="Disruption drag"
                    icon="weather"
                    emphasis
                    value={
                      <span className="text-risk-critical">
                        −{projection.disruptionHours}h of cover
                      </span>
                    }
                  />
                ) : null}
                <StatRow
                  label="Projected stockout"
                  icon="prediction"
                  emphasis
                  value={
                    <span
                      className={
                        RISK_TONE[stockoutAsRiskLevel(selected.stockoutHours) ?? 'LOW'].text
                      }
                    >
                      {formatStockout(selected.stockoutHours)}
                    </span>
                  }
                />
              </div>

              <SectionLabel rule>Cause</SectionLabel>
              <CausalChain
                steps={causeChain(selected, projection, simulated, role)}
                onNavigate={(target) => navigate(target)}
              />
            </div>
          )}
        </PanelFrame>
      </div>

      {/* =============================================== RECOMMENDATION ROW === */}
      <div className="grid shrink-0 grid-cols-1 gap-3 px-3 pb-3 xl:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
        <PanelFrame
          header={
            <PanelHeader
              title="Recommended Action"
              subtitle="Issued by the decision engine when cover falls below 48 hours"
              icon="ai"
              actions={<ProvenanceTag kind="ML_PREDICTION" subtle />}
            />
          }
        >
          {detail.data?.recommendation ? (
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-3">
                <span className="rounded-chip bg-brand-500 px-2 py-[3px] text-[10px] font-bold uppercase tracking-[0.06em] text-white">
                  {detail.data.recommendation.type.replace('_', ' ')}
                </span>
                <p className="font-display text-[19px] font-semibold uppercase leading-none tracking-[-0.015em] text-brand-900">
                  {selected?.district} · {humanizeEnum(selected?.category ?? 'medicine')}
                </p>
                <Chip tone="brand" size="sm" className="ml-auto">
                  {Math.round(detail.data.recommendation.confidence * 100)}% confidence
                </Chip>
              </div>
              <p className="text-body leading-relaxed text-ink-2">
                {detail.data.recommendation.recommendationText}
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="primary"
                  icon="warehouse"
                  onClick={() => navigate('/operations')}
                >
                  Dispatch pre-positioning
                </Button>
                {selected?.inbound ? (
                  <Button
                    variant="secondary"
                    iconRight="arrowRight"
                    onClick={() => navigate(`/deliveries/${selected.inbound!.code}`)}
                  >
                    View affected delivery
                  </Button>
                ) : null}
              </div>
              <p className="text-[10px] leading-relaxed text-ink-3">
                The decision is a deterministic rule over the projection — stock cover under the
                48-hour line with a viable donor depot. The sentence above narrates that rule; it
                does not produce it.
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <EmptyState
                tone="positive"
                icon="ok"
                size="sm"
                title="No pre-positioning required"
                description={
                  selected
                    ? `${selected.district} is holding above its safety threshold for ${humanizeEnum(selected.category).toLowerCase()}.`
                    : undefined
                }
              />

              {/* What WOULD trigger a recommendation. An empty panel that explains the rule it
                  is waiting on is more useful than one that only says nothing is wrong — and it
                  is the same threshold table the whole product is bound to. */}
              <SectionLabel rule>What triggers an action</SectionLabel>
              <dl className="flex flex-col">
                {[
                  { band: 'Under 48h', tone: 'text-risk-critical', rule: 'Pre-position from the nearest depot' },
                  { band: '48 – 96h', tone: 'text-risk-medium', rule: 'Monitor; confirm the inbound delivery' },
                  { band: '96h or more', tone: 'text-risk-low', rule: 'No action' },
                ].map((r) => (
                  <div
                    key={r.band}
                    className="flex items-center justify-between gap-3 border-b border-line-soft py-[7px] last:border-b-0"
                  >
                    <dt className={cn('tnum shrink-0 text-meta font-semibold', r.tone)}>{r.band}</dt>
                    <dd className="truncate text-meta text-ink-2">{r.rule}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
        </PanelFrame>

        {/* --- Downstream --------------------------------------------------- */}
        <PanelFrame
          header={
            <PanelHeader
              title="Downstream Impact"
              subtitle="Who feels it"
              icon="hospital"
            />
          }
        >
          {selected ? (
            <div className="flex flex-col gap-3">
              <div
                className={cn(
                  'flex items-center gap-3 rounded-panel border px-3.5 py-3',
                  selected.urgency === 'CRITICAL'
                    ? 'border-risk-critical/25 bg-risk-wash-critical'
                    : 'border-line bg-panel-alt',
                )}
              >
                <Icon
                  name="hospital"
                  size="lg"
                  className={
                    selected.urgency === 'CRITICAL' ? 'text-risk-critical' : 'text-ink-3'
                  }
                />
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-body font-semibold text-ink">
                    {selected.inbound?.destName ?? `${selected.district} district stores`}
                  </span>
                  <span className="text-meta text-ink-2">
                    {humanizeEnum(selected.category)} ·{' '}
                    {formatNumber(selected.currentStock)} units on hand
                  </span>
                </div>
                <div className="flex shrink-0 flex-col items-end">
                  <MetricValue
                    value={selected.stockoutHours ?? 0}
                    unit="h"
                    size="sm"
                    className={
                      RISK_TONE[stockoutAsRiskLevel(selected.stockoutHours) ?? 'LOW'].text
                    }
                  />
                  <StockoutChip hours={selected.stockoutHours} />
                </div>
              </div>

              <Callout
                tone={selected.urgency === 'CRITICAL' ? 'critical' : 'neutral'}
                icon={selected.urgency === 'CRITICAL' ? 'critical' : 'info'}
                title="Operational next step"
              >
                {selected.urgency === 'CRITICAL'
                  ? 'Release stock from the nearest depot now. Waiting for the inbound delivery leaves no margin if it is delayed further.'
                  : 'Continue monitoring. The inbound delivery covers the projected consumption at current rates.'}
              </Callout>

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  icon="routes"
                  onClick={() => navigate('/routes')}
                >
                  Route context
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  icon="incidents"
                  onClick={() => navigate('/incidents')}
                >
                  Related incidents
                </Button>
              </div>
            </div>
          ) : (
            <SkeletonRows rows={3} />
          )}
        </PanelFrame>
      </div>

      {/* ============================================================ TABLE === */}
      <div className="shrink-0 px-3 pb-3">
        <PanelFrame
          flushBody
          header={
            <PanelHeader
              title="Critical Supply Lines"
              subtitle="Every district and category, ranked by projected stockout"
              icon="supply"
              badge={
                <Chip tone="neutral" size="sm">
                  {lines.length}
                </Chip>
              }
              actions={<ProvenanceTag kind="SYNTHETIC_OPERATIONAL" />}
            />
          }
        >
          <Async
            state={districts}
            skeleton={<SkeletonRows rows={6} />}
            isEmpty={() => lines.length === 0}
            empty={
              <EmptyState
                icon="supply"
                size="sm"
                title="No supply lines"
                description="No district is reporting stock levels."
              />
            }
          >
            {() => (
              <div className="max-h-[340px] overflow-y-auto scroll-thin">
                <DataTable
                  columns={columns}
                  rows={lines.slice(0, 12)}
                  rowKey={(l) => l.id}
                  density="compact"
                  stickyHeader
                  onRowClick={(l) => onSelect(l.id)}
                  isRowActive={(l) => l.id === selected?.id}
                  rowAccent={(l) =>
                    l.urgency === 'CRITICAL'
                      ? 'bg-risk-critical'
                      : l.urgency === 'WARNING'
                        ? 'bg-risk-medium'
                        : undefined
                  }
                />
              </div>
            )}
          </Async>
        </PanelFrame>
      </div>

      <div className="flex shrink-0 items-center justify-between gap-3 px-4 pb-3">
        <p className="text-[10px] leading-relaxed text-ink-3">
          Projections are stock divided by consumption, adjusted for the predicted delay on the
          inbound delivery. The 48-hour safety line is the threshold defined in the project
          contract, applied identically everywhere in this product.
        </p>
        <ProvenanceTag kind="ML_PREDICTION" />
      </div>
    </div>
  );
}

/**
 * The chain that explains this line's position, built from what the data actually says rather
 * than from a script. A line with no delayed inbound delivery gets a shorter, truthful chain.
 */
function causeChain(
  line: SupplyLine,
  projection: SupplyProjection | undefined,
  simulated: boolean,
  role: Role,
) {
  const steps: { id: string; label: string; detail: string; tone: 'critical' | 'warning' | 'neutral'; target?: string }[] = [];

  if (simulated) {
    steps.push({
      id: 'weather',
      label: 'Heavy rainfall',
      detail: 'Simulated weather event applied to the corridor',
      tone: 'critical',
    });
  }

  if (line.inbound && (line.inbound.expectedDelayMinutes ?? 0) > 0) {
    steps.push({
      id: 'route',
      label: 'Route risk increased',
      detail: 'Assigned corridor re-scored by the risk model',
      tone: 'critical',
      target: '/routes',
    });
    steps.push({
      id: 'delivery',
      label: `${line.inbound.code} delayed`,
      detail: `Arrival pushed back by ${formatDuration(line.inbound.expectedDelayMinutes ?? 0)}`,
      tone: 'critical',
      target: `/deliveries/${line.inbound.code}`,
    });
  } else if (line.inbound) {
    steps.push({
      id: 'delivery',
      label: `${line.inbound.code} inbound`,
      detail: 'Running to schedule',
      tone: 'neutral',
      target: `/deliveries/${line.inbound.code}`,
    });
  } else {
    steps.push({
      id: 'nodelivery',
      label: 'No resupply scheduled',
      detail: 'Cover depends entirely on stock on hand',
      tone: 'warning',
    });
  }

  steps.push({
    id: 'supply',
    label: `Cover now ${formatStockout(line.stockoutHours)}`,
    detail:
      projection && projection.disruptionHours > 0
        ? `${projection.disruptionHours} hours shorter than the on-time projection`
        : 'At the current consumption rate',
    tone: line.urgency === 'CRITICAL' ? 'critical' : line.urgency === 'WARNING' ? 'warning' : 'neutral',
  });

  return steps.map((s) => ({ ...s, target: reachableTarget(role, s.target) }));
}
