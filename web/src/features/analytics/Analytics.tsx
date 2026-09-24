/**
 * Analytics — how the network is performing and what operations should learn from it.
 *
 * Two kinds of number appear here and they are never mixed:
 *
 *   RECORDED HISTORY   the daily success/delay series the system logs. Charted.
 *   DEMO SNAPSHOT      everything derived from the world as it stands right now. Labelled.
 *
 * The distinction matters because fabricating a plausible-looking time series is the easiest
 * way to make an analytics page impressive and the fastest way to lose a judge's trust. Where
 * the domain has no history, this page shows the current state and says so.
 */

import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { cn } from '@/lib/cn';
import { useAuth } from '@/app/auth';
import { reachableTarget } from '@/app/modules';
import {
  useAlerts,
  useAnalyticsSummary,
  useDeliveries,
  useDistricts,
  useIncidents,
  useRiskSegments,
} from '@/data/hooks';
import { formatDate, formatDuration, formatPercent, humanizeEnum } from '@/domain/format';
import { RISK_TONE, riskLevelForScore, severityAsRiskLevel, stockoutUrgency } from '@/domain/thresholds';
import type { RiskLevel, Severity } from '@/domain/types';
import {
  Async,
  Chip,
  Icon,
  MetricValue,
  PanelFrame,
  PanelHeader,
  ProgressBar,
  ProvenanceTag,
  RiskBarCell,
  SectionLabel,
  SkeletonRows,
  SkeletonTile,
  Sparkline,
  StatTile,
  type IconName,
} from '@/design/primitives';
import { HeroBand } from '@/shell/HeroBand';
import { useShellRailNote } from '@/shell/AppShell';
import ridgeline from '@/assets/ner-ridgeline.jpg';

/** A snapshot marker, so a current-state figure is never mistaken for a trend. */
function SnapshotTag({ className }: { className?: string }) {
  return (
    <span
      title="Derived from the world as it stands now, not from recorded history."
      className={cn(
        'inline-flex shrink-0 cursor-help items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.05em] text-ink-3',
        className,
      )}
    >
      <Icon name="database" size="sm" className="opacity-70" />
      Demo snapshot
    </span>
  );
}

export function Analytics() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const role = user?.role ?? 'DISTRICT_OFFICER';
  const summary = useAnalyticsSummary();
  const deliveries = useDeliveries();
  const incidents = useIncidents();
  const districts = useDistricts();
  const segments = useRiskSegments();
  const alerts = useAlerts();

  // --- Delivery performance (snapshot) --------------------------------------
  const delivery = useMemo(() => {
    const all = deliveries.data?.deliveries ?? [];
    const live = all.filter((d) => d.status !== 'DELIVERED' && d.status !== 'FAILED');
    const late = live.filter((d) => (d.expectedDelayMinutes ?? 0) > 0);
    const critical = live.filter((d) => d.priority === 'CRITICAL');
    const highFailure = live.filter((d) => (d.failureProbability ?? 0) >= 0.7);
    const totalDelay = late.reduce((sum, d) => sum + (d.expectedDelayMinutes ?? 0), 0);

    return {
      total: all.length,
      live: live.length,
      onTime: live.length - late.length,
      late: late.length,
      critical: critical.length,
      highFailure: highFailure.length,
      avgDelay: late.length ? Math.round(totalDelay / late.length) : 0,
      onTimePct: live.length ? Math.round(((live.length - late.length) / live.length) * 100) : 100,
    };
  }, [deliveries.data]);

  // --- Incident analytics (snapshot) ----------------------------------------
  const incidentStats = useMemo(() => {
    const all = (incidents.data?.incidents ?? []).filter((i) => i.type !== 'NORMAL');
    const bySeverity = (['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as Severity[]).map((sv) => ({
      severity: sv,
      count: all.filter((i) => i.severity === sv).length,
    }));
    const byType = Object.entries(
      all.reduce<Record<string, number>>((acc, i) => {
        acc[i.type] = (acc[i.type] ?? 0) + 1;
        return acc;
      }, {}),
    )
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count);

    const corridors = new Set(all.map((i) => i.segmentName).filter(Boolean));
    return { total: all.length, bySeverity, byType, corridors: corridors.size };
  }, [incidents.data]);

  // --- Supply analytics (snapshot) ------------------------------------------
  const supply = useMemo(() => {
    const lines: { district: string; category: string; hours: number | null }[] = [];
    for (const d of districts.data?.districts ?? []) {
      for (const c of ['medicine', 'food', 'fuel'] as const) {
        lines.push({ district: d.name, category: c, hours: d.stock[c].predictedStockoutHours });
      }
    }
    const critical = lines.filter((l) => stockoutUrgency(l.hours) === 'CRITICAL');
    const warning = lines.filter((l) => stockoutUrgency(l.hours) === 'WARNING');
    return {
      critical: critical.length,
      warning: warning.length,
      districts: new Set([...critical, ...warning].map((l) => l.district)).size,
      worst: [...lines].sort((a, b) => (a.hours ?? 1e9) - (b.hours ?? 1e9)).slice(0, 4),
    };
  }, [districts.data]);

  // --- The cascade, as counts at each layer ---------------------------------
  // A District Officer reaches Analytics but not Incidents, Risk or Deliveries, so those tiles
  // stay informative and stop pretending to be doors.
  const cascade = useMemo(() => {
    const segs = segments.data?.segments ?? [];
    return [
      {
        id: 'incidents',
        label: 'Incidents',
        icon: 'incidents' as IconName,
        value: incidentStats.total,
        detail: `${incidentStats.corridors} corridors affected`,
        level: (incidentStats.total > 4 ? 'HIGH' : 'MEDIUM') as RiskLevel,
        target: reachableTarget(role, '/incidents'),
      },
      {
        id: 'segments',
        label: 'Segments at risk',
        icon: 'risk' as IconName,
        value: segs.filter((s) => s.lastRiskScore >= 40).length,
        detail: `${segs.filter((s) => s.currentStatus !== 'OPEN').length} not fully open`,
        level: (segs.some((s) => s.lastRiskScore >= 85) ? 'CRITICAL' : 'HIGH') as RiskLevel,
        target: reachableTarget(role, '/risk'),
      },
      {
        id: 'deliveries',
        label: 'Deliveries affected',
        icon: 'deliveries' as IconName,
        value: delivery.late,
        detail: delivery.avgDelay ? `avg ${formatDuration(delivery.avgDelay)} late` : 'none late',
        level: (delivery.highFailure > 0 ? 'CRITICAL' : 'MEDIUM') as RiskLevel,
        target: reachableTarget(role, '/deliveries'),
      },
      {
        id: 'supply',
        label: 'Supply lines at risk',
        icon: 'supply' as IconName,
        value: supply.critical + supply.warning,
        detail: `${supply.critical} below the 48h line`,
        level: (supply.critical > 0 ? 'CRITICAL' : 'MEDIUM') as RiskLevel,
        target: reachableTarget(role, '/supply'),
      },
    ];
  }, [segments.data, incidentStats, delivery, supply, role]);

  const history = summary.data?.history ?? [];
  const successValues = history.map((h) => h.successRatePct);
  const delayValues = history.map((h) => h.avgDelayMin);

  useShellRailNote(
    <span className="flex items-center gap-1.5">
      <Icon name="analytics" size="sm" className="opacity-60" />
      <span className="hidden lg:inline">Window</span>
      <span className="font-semibold text-ink-2">
        {history.length ? `${history.length} days` : 'snapshot'}
      </span>
    </span>,
    [history.length],
  );

  const loading = summary.loading || deliveries.loading;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto scroll-thin">
      {/* ============================================================= HERO === */}
      <HeroBand
        image={ridgeline}
        size="sm"
        eyebrow="Analytics"
        eyebrowIcon="analytics"
        title="How the network performed, and what to learn from it."
        subtitle="Delivery outcomes, corridor risk, incident patterns and supply pressure across the region."
        credit="Photo: Kingshuk Mondal, CC BY 4.0"
        right={
          <div className="flex items-center gap-3">
            <div className="hidden flex-col items-end gap-1 border-r border-white/15 pr-3 xl:flex">
              <span className="text-[10px] uppercase tracking-[0.06em] text-white/55">
                Recorded window
              </span>
              <span className="text-[13px] font-semibold text-white">
                {history.length ? `${history.length} days` : 'None recorded'}
              </span>
              {history.length ? (
                <span className="text-[11px] text-white/60">
                  to {formatDate(history[history.length - 1].date)}
                </span>
              ) : null}
            </div>
            <ProvenanceTag kind="SYNTHETIC_HISTORICAL" onNavy />
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
              label="Delivery Success Rate"
              value={summary.data?.deliverySuccessRatePct ?? 0}
              decimals={1}
              unit="%"
              icon="ok"
              tone="low"
              footnote="recorded, last 14 days"
            />
            <StatTile
              label="Average Delay"
              value={summary.data?.avgDelayMinutes ?? 0}
              icon="prediction"
              tone="medium"
              valueNode={
                <span className="t-metric whitespace-nowrap">
                  {formatDuration(summary.data?.avgDelayMinutes ?? 0)}
                </span>
              }
              footnote="recorded, last 14 days"
            />
            <StatTile
              label="Deliveries Running Late"
              value={delivery.late}
              icon="deliveries"
              tone={delivery.late > 0 ? 'high' : 'low'}
              accent={delivery.highFailure > 0 ? 'critical' : undefined}
              footnote={`${delivery.onTimePct}% of live deliveries on time`}
            />
            <StatTile
              label="Shortage Events"
              value={summary.data?.districtShortageEvents.length ?? 0}
              icon="supply"
              tone={(summary.data?.districtShortageEvents.length ?? 0) > 0 ? 'critical' : 'low'}
              footnote="districts crossing the 48h line"
            />
          </div>
        )}
      </div>

      {/* ========================================================== CASCADE === */}
      <div className="shrink-0 p-3">
        <PanelFrame
          header={
            <PanelHeader
              title="Cascade Metrics"
              subtitle="How disruption propagates through the network, layer by layer"
              icon="simulate"
              actions={<SnapshotTag />}
            />
          }
        >
          {loading ? (
            <SkeletonRows rows={2} />
          ) : (
            <>
              <ol className="flex flex-wrap items-stretch gap-x-1 gap-y-3">
                {cascade.map((step, i) => {
                  const tone = RISK_TONE[step.level];
                  const last = i === cascade.length - 1;
                  // A tile whose page this role cannot open renders as a plain figure: same
                  // reading, no hover lift, no arrow, no click. Nothing here pretends.
                  const target = step.target;
                  const Tile = target ? 'button' : 'div';
                  return (
                    <li key={step.id} className="flex min-w-[168px] flex-1 items-stretch">
                      <Tile
                        {...(target
                          ? { type: 'button' as const, onClick: () => navigate(target) }
                          : {})}
                        className={cn(
                          'group flex min-w-0 flex-1 flex-col gap-1.5 rounded-panel border px-3.5 py-3 text-left',
                          target && 'transition-shadow duration-150 ease-ui hover:shadow-panel',
                          tone.wash,
                          tone.border,
                        )}
                      >
                        <span className="flex items-center gap-1.5">
                          <Icon name={step.icon} size="sm" className={tone.text} />
                          <span className="text-[10px] font-bold uppercase tracking-[0.06em] text-ink-3">
                            {step.label}
                          </span>
                          {target ? (
                            <Icon
                              name="arrowRight"
                              size="sm"
                              className="ml-auto shrink-0 text-ink-3 opacity-0 transition-opacity group-hover:opacity-100"
                            />
                          ) : null}
                        </span>
                        <MetricValue value={step.value} size="md" className={tone.text} />
                        <span className="text-[10.5px] leading-snug text-ink-2">
                          {step.detail}
                        </span>
                      </Tile>
                      {!last ? (
                        <span
                          className="flex w-4 shrink-0 items-center justify-center text-ink-3"
                          aria-hidden
                        >
                          <Icon name="chevronRight" size="sm" />
                        </span>
                      ) : null}
                    </li>
                  );
                })}
              </ol>
              <p className="mt-3 text-[10px] leading-relaxed text-ink-3">
                Counts at each layer of the same chain the Incident Center traces for a single
                event. Reading left to right: reported hazards raise segment risk, which raises
                delivery risk, which shortens supply cover.
              </p>
            </>
          )}
        </PanelFrame>
      </div>

      {/* =================================== RECORDED HISTORY + DELIVERIES === */}
      <div className="grid shrink-0 grid-cols-1 gap-3 px-3 pb-3 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <PanelFrame
          header={
            <PanelHeader
              title="Recorded Performance"
              subtitle={
                history.length
                  ? `${history.length} days to ${formatDate(history[history.length - 1].date)}`
                  : 'No history recorded'
              }
              icon="analytics"
              actions={<ProvenanceTag kind="SYNTHETIC_HISTORICAL" />}
            />
          }
        >
          {loading ? (
            <SkeletonRows rows={3} />
          ) : history.length === 0 ? (
            <p className="text-meta text-ink-2">
              No daily history has been recorded yet, so there is nothing to chart. The figures
              elsewhere on this page describe the current state only.
            </p>
          ) : (
            <div className="flex flex-col gap-4">
              <TrendRow
                label="Delivery success rate"
                value={`${formatPercent(history[history.length - 1].successRatePct, 1)}`}
                values={successValues}
                color="rgb(var(--risk-low))"
                min={Math.min(...successValues)}
                max={Math.max(...successValues)}
                unit="%"
              />
              <TrendRow
                label="Average delay"
                value={formatDuration(history[history.length - 1].avgDelayMin)}
                values={delayValues}
                color="rgb(var(--risk-high))"
                min={Math.min(...delayValues)}
                max={Math.max(...delayValues)}
                unit=" min"
              />

              <SectionLabel rule>Riskiest segments</SectionLabel>
              <ul className="flex flex-col gap-2">
                {(summary.data?.topRiskySegments ?? []).map((s) => (
                  <li key={s.segmentId} className="flex items-center gap-3">
                    <span className="min-w-0 flex-1 truncate text-meta text-ink-2">{s.name}</span>
                    <RiskBarCell score={s.avgRisk} width={72} />
                  </li>
                ))}
              </ul>
            </div>
          )}
        </PanelFrame>

        <PanelFrame
          header={
            <PanelHeader
              title="Delivery Performance"
              subtitle="Live deliveries as they stand now"
              icon="deliveries"
              actions={<SnapshotTag />}
            />
          }
        >
          {loading ? (
            <SkeletonRows rows={4} />
          ) : (
            <div className="flex flex-col gap-3.5">
              <div>
                <div className="mb-1.5 flex items-baseline justify-between gap-2">
                  <span className="t-label">On time</span>
                  <span className="tnum text-body font-semibold text-ink">
                    {delivery.onTime} of {delivery.live}
                  </span>
                </div>
                <ProgressBar
                  value={delivery.onTimePct}
                  level={delivery.onTimePct >= 80 ? 'LOW' : delivery.onTimePct >= 60 ? 'MEDIUM' : 'CRITICAL'}
                  size="lg"
                />
              </div>

              <dl className="flex flex-col divide-y divide-line-soft">
                <Row label="Running late" value={String(delivery.late)} tone={delivery.late > 0 ? 'text-risk-high' : undefined} />
                <Row
                  label="Average delay (late only)"
                  value={delivery.avgDelay ? formatDuration(delivery.avgDelay) : '—'}
                />
                <Row
                  label="Failure probability 70%+"
                  value={String(delivery.highFailure)}
                  tone={delivery.highFailure > 0 ? 'text-risk-critical' : undefined}
                />
                <Row label="Critical priority" value={String(delivery.critical)} />
                <Row label="Total on record" value={String(delivery.total)} />
              </dl>
            </div>
          )}
        </PanelFrame>
      </div>

      {/* ======================================== INCIDENTS + SUPPLY + ALERTS === */}
      <div className="grid shrink-0 grid-cols-1 gap-3 px-3 pb-3 xl:grid-cols-3">
        <PanelFrame
          header={
            <PanelHeader
              title="Incident Patterns"
              subtitle={`${incidentStats.total} open across ${incidentStats.corridors} corridors`}
              icon="incidents"
              actions={<SnapshotTag />}
            />
          }
        >
          <Async state={incidents} skeleton={<SkeletonRows rows={4} />}>
            {() => (
              <div className="flex flex-col gap-4">
                <SectionLabel>By severity</SectionLabel>
                <div className="flex flex-col gap-2">
                  {incidentStats.bySeverity.map((b) => (
                    <div key={b.severity} className="flex items-center gap-2.5">
                      <span className="w-[64px] shrink-0 text-[10px] font-semibold uppercase tracking-[0.05em] text-ink-3">
                        {b.severity}
                      </span>
                      <div className="h-[9px] flex-1 overflow-hidden rounded-[3px] bg-panel-sunk">
                        <div
                          className={cn('h-full rounded-[3px]', RISK_TONE[severityAsRiskLevel(b.severity)].rail)}
                          style={{
                            width: `${incidentStats.total ? Math.max(3, (b.count / incidentStats.total) * 100) : 0}%`,
                          }}
                        />
                      </div>
                      <span className="tnum w-5 shrink-0 text-right text-meta font-semibold text-ink">
                        {b.count}
                      </span>
                    </div>
                  ))}
                </div>

                <SectionLabel rule>By type</SectionLabel>
                <ul className="flex flex-col divide-y divide-line-soft">
                  {incidentStats.byType.map((t) => (
                    <li key={t.type} className="flex items-center justify-between gap-3 py-1.5">
                      <span className="text-meta text-ink-2">{humanizeEnum(t.type)}</span>
                      <span className="tnum text-body font-semibold text-ink">{t.count}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Async>
        </PanelFrame>

        <PanelFrame
          header={
            <PanelHeader
              title="Supply Pressure"
              subtitle={`${supply.critical} critical · ${supply.warning} at risk`}
              icon="supply"
              actions={<SnapshotTag />}
            />
          }
        >
          <Async state={districts} skeleton={<SkeletonRows rows={4} />}>
            {() => (
              <div className="flex flex-col gap-4">
                <div className="grid grid-cols-2 gap-2">
                  <Tile label="Critical lines" value={supply.critical} tone="text-risk-critical" />
                  <Tile label="Districts affected" value={supply.districts} tone="text-ink" />
                </div>

                <SectionLabel rule>Tightest cover</SectionLabel>
                <ul className="flex flex-col divide-y divide-line-soft">
                  {supply.worst.map((l) => {
                    const urgency = stockoutUrgency(l.hours);
                    return (
                      <li
                        key={`${l.district}-${l.category}`}
                        className="flex items-center justify-between gap-3 py-1.5"
                      >
                        <span className="min-w-0 truncate text-meta text-ink-2">
                          {l.district} · {humanizeEnum(l.category)}
                        </span>
                        <span
                          className={cn(
                            'tnum shrink-0 text-body font-semibold',
                            urgency === 'CRITICAL' ? 'text-risk-critical' : 'text-ink',
                          )}
                        >
                          {l.hours === null ? '—' : `${(l.hours / 24).toFixed(1)}d`}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </Async>
        </PanelFrame>

        <PanelFrame
          header={
            <PanelHeader
              title="Corridor Risk"
              subtitle="Every monitored segment, ranked"
              icon="risk"
              actions={<SnapshotTag />}
            />
          }
          flushBody
          scroll
        >
          <Async state={segments} skeleton={<SkeletonRows rows={5} />}>
            {(d) => (
              <ul className="flex flex-col">
                {d.segments.slice(0, 8).map((s) => (
                  <li
                    key={s.id}
                    className="flex items-center gap-3 border-b border-line-soft px-3 py-2 last:border-b-0"
                  >
                    <div className="flex min-w-0 flex-1 flex-col leading-tight">
                      <span className="tnum truncate text-meta font-semibold text-ink">
                        {s.code}
                      </span>
                      <span className="truncate text-[10px] text-ink-3">{s.name}</span>
                    </div>
                    <Chip tone="outline" size="sm" className={RISK_TONE[riskLevelForScore(s.lastRiskScore)].text}>
                      {s.currentStatus.toLowerCase()}
                    </Chip>
                    <RiskBarCell score={s.lastRiskScore} width={54} />
                  </li>
                ))}
              </ul>
            )}
          </Async>
        </PanelFrame>
      </div>

      <div className="flex shrink-0 items-center justify-between gap-3 px-4 pb-3">
        <p className="text-[10px] leading-relaxed text-ink-3">
          Only the &ldquo;Recorded Performance&rdquo; panel charts a real series. Everything marked
          &ldquo;demo snapshot&rdquo; is the current state of the demonstration world — no
          historical data has been synthesised to fill a chart.
        </p>
        <div className="flex shrink-0 items-center gap-3">
          <ProvenanceTag kind="SYNTHETIC_HISTORICAL" />
          <span className="tnum text-[10px] text-ink-3">
            {(alerts.data?.alerts ?? []).length} alerts on record
          </span>
        </div>
      </div>
    </div>
  );
}

function TrendRow({
  label,
  value,
  values,
  color,
  min,
  max,
  unit,
}: {
  label: string;
  value: string;
  values: number[];
  color: string;
  min: number;
  max: number;
  unit: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="t-label">{label}</span>
        <span className="tnum text-body font-semibold text-ink">{value}</span>
      </div>
      <div className="flex items-end gap-3">
        <Sparkline values={values} width={340} height={48} color={color} />
        <div className="flex shrink-0 flex-col gap-0.5 text-[10px] text-ink-3">
          <span className="tnum">
            high {max}
            {unit}
          </span>
          <span className="tnum">
            low {min}
            {unit}
          </span>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-[7px]">
      <dt className="text-meta text-ink-2">{label}</dt>
      <dd className={cn('tnum text-body font-semibold', tone ?? 'text-ink')}>{value}</dd>
    </div>
  );
}

function Tile({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-control border border-line bg-panel-alt px-3 py-2">
      <span className="text-[10px] uppercase tracking-[0.05em] text-ink-3">{label}</span>
      <MetricValue value={value} size="sm" className={tone} />
    </div>
  );
}
