/**
 * Field Operations — what needs doing, right now, by whom.
 *
 * The other pages analyse; this one is a worklist. So it is ordered by urgency rather than by
 * entity, every row states the action rather than the finding, and the detail panel ends in a
 * button rather than a chart.
 *
 * The honesty rule that shapes this page: **an action with no endpoint behind it must not look
 * like it succeeded.** Reroute is wired to the real typed seam and genuinely changes state.
 * Pre-positioning has no endpoint yet, so it renders as READY FOR DISPATCH with the reason
 * stated — never a fake success toast.
 *
 * Role-aware by usefulness, not by permission: the role matrix in `app/modules.ts` already
 * decides who reaches this page. What changes here is which queue is on top for whom.
 */

import { useCallback, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { cn } from '@/lib/cn';
import { useAuth } from '@/app/auth';
import { capabilitiesFor, reachableTarget } from '@/app/modules';
import { dataSource, isDemoMode } from '@/data';
import { appNow } from '@/data/clock';
import {
  useAction,
  useAlerts,
  useDeliveries,
  useDistricts,
  useFieldOfficers,
  useIncidents,
  useNotifications,
  useResource,
  useRouteCandidates,
  useVehicles,
} from '@/data/hooks';
import { formatAge, formatDuration, formatStockout, humanizeEnum, initials } from '@/domain/format';
import { RISK_TONE, severityAsRiskLevel, stockoutAsRiskLevel } from '@/domain/thresholds';
import type {
  Alert,
  FieldOfficer,
  RecommendationType,
  SendSmsResponse,
  Severity,
} from '@/domain/types';
import {
  Async,
  Button,
  Callout,
  Chip,
  EmptyState,
  Icon,
  PanelFrame,
  PanelHeader,
  ProvenanceTag,
  SectionLabel,
  SkeletonRows,
  SkeletonTile,
  StatRow,
  StatTile,
  StatusDot,
  type IconName,
} from '@/design/primitives';
import { HeroBand } from '@/shell/HeroBand';
import { useShellRailNote } from '@/shell/AppShell';
import ridgeline from '@/assets/ner-ridgeline.jpg';
import { supplyLinePath } from '../shared/supplyLink';
import { CausalChain, type ChainStep } from '../shared/CausalChain';
import { NotificationStatus } from '../delivery-intelligence/SupplyConsequence';
import { featuredDelivery, shortRouteName } from '../shared/delivery';

type ActionKind = RecommendationType | 'INSPECT';

interface FieldAction {
  id: string;
  kind: ActionKind;
  title: string;
  location: string;
  asset: string;
  reason: string;
  severity: Severity;
  /** Whether a typed action seam exists for this yet. */
  executable: boolean;
  status: 'OPEN' | 'READY' | 'DONE';
  target?: string;
}

const KIND_ICON: Record<ActionKind, IconName> = {
  REROUTE: 'navigate',
  PRE_POSITION: 'warehouse',
  ALERT: 'alert',
  INSPECT: 'incidents',
  NONE: 'ok',
};

const SEVERITY_ORDER: Record<Severity, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

export function FieldOperations() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const role = user?.role ?? 'FIELD_OFFICER';
  const capabilities = capabilitiesFor(role);

  const officers = useFieldOfficers();
  const incidents = useIncidents();
  const deliveries = useDeliveries();
  const districts = useDistricts();
  const alerts = useAlerts();
  const notifications = useNotifications();
  const vehicles = useVehicles();

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
  const assigned = routeList.find((r) => r.id === delivery?.assignedRouteId);
  const recommended = routeList.find((r) => r.isRecommended);

  const detail = useResource(
    async () =>
      delivery
        ? await dataSource.getDeliveryById(delivery.id)
        : { delivery: undefined, recommendation: undefined, decision: undefined },
    [delivery?.id],
  );

  const criticalDistrict = useMemo(
    () =>
      (districts.data?.districts ?? []).find(
        (d) =>
          d.stock.medicine.predictedStockoutHours !== null &&
          d.stock.medicine.predictedStockoutHours < 48,
      ),
    [districts.data],
  );

  const districtDetail = useResource(
    async () =>
      criticalDistrict
        ? await dataSource.getDistrictById(criticalDistrict.id)
        : { district: undefined, recommendation: undefined, projections: undefined },
    [criticalDistrict?.id],
  );

  const [rerouteDone, setRerouteDone] = useState(false);
  const reroute = useAction(async () => {
    if (!delivery || !recommended) return;
    await dataSource.rerouteDelivery({ deliveryId: delivery.id, routeId: recommended.id });
    setRerouteDone(true);
  });

  // --- The queue ------------------------------------------------------------
  const actions = useMemo<FieldAction[]>(() => {
    const out: FieldAction[] = [];

    // Reroute — the one action with a real seam behind it.
    if (detail.data?.recommendation?.type === 'REROUTE' && recommended && assigned) {
      out.push({
        id: 'reroute',
        kind: 'REROUTE',
        title: `Reroute ${delivery?.code} to ${shortRouteName(recommended.name)}`,
        location: `${delivery?.originName} → ${delivery?.destName}`,
        asset: delivery?.code ?? '—',
        reason: `${shortRouteName(assigned.name)} is at ${assigned.riskScore}%; ${shortRouteName(recommended.name)} scores ${recommended.riskScore}%.`,
        severity: 'CRITICAL',
        executable: true,
        status: rerouteDone ? 'DONE' : 'OPEN',
        target: delivery ? `/deliveries/${delivery.code}` : undefined,
      });
    }

    // Pre-position — no endpoint yet.
    if (districtDetail.data?.recommendation?.type === 'PRE_POSITION' && criticalDistrict) {
      out.push({
        id: 'preposition',
        kind: 'PRE_POSITION',
        title: `Pre-position medicine to ${criticalDistrict.name}`,
        location: criticalDistrict.name,
        asset: 'Medicine',
        reason: districtDetail.data.recommendation.recommendationText,
        severity: 'CRITICAL',
        executable: false,
        status: 'READY',
        target: supplyLinePath(criticalDistrict.id, 'medicine'),
      });
    }

    // Inspections raised by open field reports.
    for (const incident of (incidents.data?.incidents ?? []).filter(
      (i) => i.type !== 'NORMAL' && (i.severity === 'HIGH' || i.severity === 'CRITICAL'),
    )) {
      out.push({
        id: `inspect-${incident.id}`,
        kind: 'INSPECT',
        title: `Inspect ${humanizeEnum(incident.type).toLowerCase()} on ${incident.segmentName ?? 'the corridor'}`,
        location: incident.segmentName ?? 'Corridor',
        asset: incident.segmentName ?? '—',
        reason:
          incident.description ??
          `Reported ${formatAge(incident.createdAt, appNow())} with ${humanizeEnum(incident.cvEstimatedBlockage ?? 'NONE').toLowerCase()} obstruction.`,
        severity: incident.severity,
        executable: false,
        status: 'OPEN',
        target: `/incidents?incident=${incident.id}`,
      });
    }

    // Vehicles the anomaly rule has flagged.
    for (const v of (vehicles.data?.vehicles ?? []).filter((x) => x.anomaly)) {
      out.push({
        id: `anomaly-${v.id}`,
        kind: 'ALERT',
        title: `Contact driver of ${v.code}`,
        location: 'On corridor',
        asset: v.code,
        reason: v.anomaly!.reason,
        severity: v.anomaly!.severity,
        executable: false,
        status: 'OPEN',
        target: `/map?vehicle=${v.id}`,
      });
    }

    // Same rule as the chain: a queued action may point at a page this role cannot open, and a
    // link that bounces is worse than a card that simply does not offer one.
    return out
      .map((a) => ({ ...a, target: reachableTarget(role, a.target) }))
      .sort(
        (a, b) =>
          SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
          Number(b.executable) - Number(a.executable),
      );
  }, [
    role,
    detail.data,
    districtDetail.data,
    incidents.data,
    vehicles.data,
    delivery,
    assigned,
    recommended,
    criticalDistrict,
    rerouteDone,
  ]);

  const [searchParams, setSearchParams] = useSearchParams();
  const requestedId = searchParams.get('action') ?? undefined;
  const selected = actions.find((a) => a.id === requestedId) ?? actions[0];
  const onSelect = useCallback(
    (id: string) => setSearchParams({ action: id }, { replace: true }),
    [setSearchParams],
  );

  const onDuty = useMemo(
    () => (officers.data?.officers ?? []).filter((o) => o.status === 'ACTIVE'),
    [officers.data],
  );

  const delayed = useMemo(
    () =>
      (deliveries.data?.deliveries ?? []).filter((d) => (d.expectedDelayMinutes ?? 0) > 0).length,
    [deliveries.data],
  );

  const relevantNotifications = useMemo(
    () => (notifications.data?.notifications ?? []).slice(0, 4),
    [notifications.data],
  );

  useShellRailNote(
    <span className="flex items-center gap-1.5">
      <Icon name="operations" size="sm" className="opacity-60" />
      <span className="hidden lg:inline">Queue</span>
      <span className="font-semibold text-ink-2">{actions.length} actions</span>
    </span>,
    [actions.length],
  );

  const chain = useMemo<ChainStep[]>(() => {
    if (!selected) return [];
    const steps: ChainStep[] = [];
    if (assigned) {
      steps.push({
        id: 'route',
        label: `${shortRouteName(assigned.name)} at ${assigned.riskScore}%`,
        detail: 'Corridor risk from the route model',
        tone: assigned.riskLevel === 'CRITICAL' ? 'critical' : 'warning',
        icon: 'routes',
        target: `/routes?route=${assigned.id}`,
      });
    }
    if (delivery) {
      steps.push({
        id: 'delivery',
        label: `${delivery.code} ${(delivery.expectedDelayMinutes ?? 0) > 0 ? `delayed ${formatDuration(delivery.expectedDelayMinutes ?? 0)}` : 'on schedule'}`,
        detail: `${delivery.cargoType} to ${delivery.destName}`,
        tone: (delivery.expectedDelayMinutes ?? 0) > 0 ? 'critical' : 'neutral',
        icon: 'deliveries',
        target: `/deliveries/${delivery.code}`,
      });
    }
    if (criticalDistrict) {
      const hours = criticalDistrict.stock.medicine.predictedStockoutHours;
      steps.push({
        id: 'supply',
        label: `${criticalDistrict.name} cover ${formatStockout(hours)}`,
        detail: 'Delay-adjusted projection',
        tone: stockoutAsRiskLevel(hours) === 'CRITICAL' ? 'critical' : 'warning',
        icon: 'supply',
        target: supplyLinePath(criticalDistrict.id, 'medicine'),
      });
    }
    return steps.map((s) => ({ ...s, target: reachableTarget(role, s.target) }));
  }, [selected, assigned, delivery, criticalDistrict, role]);

  const loading = incidents.loading || deliveries.loading;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto scroll-thin">
      {/* ============================================================= HERO === */}
      <HeroBand
        image={ridgeline}
        size="sm"
        eyebrow="Field Operations"
        eyebrowIcon="operations"
        title="What needs doing in the field, right now."
        subtitle="Recommendations from the decision engine, open field reports, and the officers on duty to act on them."
        credit="Photo: Kingshuk Mondal, CC BY 4.0"
        right={
          <div className="flex items-center gap-3">
            <div className="hidden flex-col items-end gap-1 border-r border-white/15 pr-3 xl:flex">
              <span className="text-[10px] uppercase tracking-[0.06em] text-white/55">
                Signed in as
              </span>
              <span className="text-[13px] font-semibold text-white">{humanizeEnum(role)}</span>
            </div>
            <div className="flex flex-col items-end gap-1.5">
              <Chip
                tone="navy"
                size="sm"
                icon={actions.length > 0 ? 'warning' : 'ok'}
              >
                {actions.length} pending
              </Chip>
              <ProvenanceTag kind="SYNTHETIC_OPERATIONAL" onNavy />
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
              label="Pending Actions"
              value={actions.filter((a) => a.status !== 'DONE').length}
              icon="operations"
              tone={actions.length > 0 ? 'critical' : 'low'}
              accent={actions.some((a) => a.severity === 'CRITICAL') ? 'critical' : undefined}
              footnote={`${actions.filter((a) => a.executable).length} can be executed now`}
            />
            <StatTile
              label="Delayed Vehicles"
              value={delayed}
              icon="vehicle"
              tone={delayed > 0 ? 'high' : 'low'}
              footnote="deliveries running behind"
            />
            <StatTile
              label="Critical Incidents"
              value={
                (incidents.data?.incidents ?? []).filter(
                  (i) => i.severity === 'CRITICAL' || i.severity === 'HIGH',
                ).length
              }
              icon="incidents"
              tone="medium"
              footnote="open field reports"
            />
            <StatTile
              label="Officers On Duty"
              value={onDuty.length}
              icon="officer"
              tone="brand"
              footnote={`of ${officers.data?.officers.length ?? 0} assigned`}
            />
          </div>
        )}
      </div>

      {/* ================================================= QUEUE + DETAIL === */}
      <div className="grid shrink-0 grid-cols-1 gap-3 p-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <PanelFrame
          className="min-h-[420px]"
          flushBody
          scroll
          header={
            <PanelHeader
              title="Priority Action Queue"
              subtitle="Ordered by urgency, then by what can actually be executed"
              icon="operations"
              badge={
                <Chip tone="neutral" size="sm">
                  {actions.length}
                </Chip>
              }
            />
          }
        >
          <Async
            state={incidents}
            skeleton={<SkeletonRows rows={5} />}
            isEmpty={() => actions.length === 0}
            empty={
              <EmptyState
                tone="positive"
                icon="ok"
                size="sm"
                title="Nothing outstanding"
                description="No recommendation, open report or flagged vehicle needs field action."
              />
            }
          >
            {() => (
              <ul className="flex flex-col">
                {actions.map((a) => (
                  <ActionRow
                    key={a.id}
                    action={a}
                    active={a.id === selected?.id}
                    onSelect={() => onSelect(a.id)}
                  />
                ))}
              </ul>
            )}
          </Async>
        </PanelFrame>

        {/* --- Selected action --------------------------------------------- */}
        <PanelFrame
          className="min-h-[420px]"
          scroll
          header={
            <PanelHeader
              title={selected ? selected.title : 'Action'}
              subtitle={selected?.location}
              icon={selected ? KIND_ICON[selected.kind] : 'operations'}
              badge={
                selected ? (
                  <Chip
                    tone="outline"
                    size="sm"
                    className={cn(RISK_TONE[severityAsRiskLevel(selected.severity)].text)}
                  >
                    {selected.severity}
                  </Chip>
                ) : undefined
              }
            />
          }
        >
          {loading || !selected ? (
            <SkeletonRows rows={5} />
          ) : (
            <div className="flex flex-col gap-4">
              <SectionLabel rule>Situation</SectionLabel>
              <p className="text-body leading-relaxed text-ink-2">{selected.reason}</p>

              <div className="flex flex-col divide-y divide-line-soft">
                <StatRow label="Affected asset" icon="deliveries" value={selected.asset} emphasis />
                <StatRow label="Location" icon="destination" value={selected.location} />
                <StatRow
                  label="Status"
                  icon="live"
                  value={
                    <span
                      className={cn(
                        'font-semibold',
                        selected.status === 'DONE'
                          ? 'text-risk-low'
                          : selected.status === 'READY'
                            ? 'text-risk-medium'
                            : 'text-ink',
                      )}
                    >
                      {selected.status === 'READY' ? 'Ready for dispatch' : humanizeEnum(selected.status)}
                    </span>
                  }
                />
              </div>

              {chain.length > 0 ? (
                <>
                  <SectionLabel rule>Why it matters</SectionLabel>
                  <CausalChain steps={chain} onNavigate={(t) => navigate(t)} />
                </>
              ) : null}

              <SectionLabel rule>Recommended action</SectionLabel>
              {selected.executable ? (
                selected.status === 'DONE' ? (
                  <Callout tone="low" icon="ok" title="Applied">
                    The reroute has been applied and the recommendation retired. The delivery,
                    supply and alert state have all been updated.
                  </Callout>
                ) : (
                  <div className="flex flex-col gap-2">
                    <Button
                      variant="primary"
                      icon="navigate"
                      pending={reroute.pending}
                      disabled={!capabilities.createDelivery}
                      onClick={reroute.run}
                    >
                      {reroute.pending ? 'Applying…' : 'Reroute delivery'}
                    </Button>
                    {!capabilities.createDelivery ? (
                      <p className="text-[10.5px] leading-snug text-ink-3">
                        Your role can view this recommendation but cannot apply it. A Logistics
                        Officer or Admin must action the reroute.
                      </p>
                    ) : null}
                    {reroute.error ? (
                      <p role="alert" className="text-meta text-risk-critical">
                        {reroute.error.message}
                      </p>
                    ) : null}
                  </div>
                )
              ) : (
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-2.5 rounded-panel border border-risk-medium/30 bg-risk-wash-medium px-3.5 py-2.5">
                    <Icon name="warning" size="lg" className="text-risk-medium" />
                    <div className="flex min-w-0 flex-col">
                      <span className="text-body font-semibold text-ink">Ready for dispatch</span>
                      <span className="text-meta text-ink-2">
                        No execution endpoint is connected for this action yet.
                      </span>
                    </div>
                  </div>
                  <p className="text-[10px] leading-relaxed text-ink-3">
                    This build deliberately does not present an unexecuted action as completed.
                    The {humanizeEnum(selected.kind).toLowerCase()} endpoint is connected during
                    backend integration; until then the recommendation stands and the operator
                    acts on it outside the system.
                  </p>
                </div>
              )}

              {selected.target ? (
                <Button
                  variant="secondary"
                  size="sm"
                  iconRight="arrowRight"
                  onClick={() => navigate(selected.target!)}
                >
                  Open in context
                </Button>
              ) : null}
            </div>
          )}
        </PanelFrame>
      </div>

      {/* ============================================= OFFICERS + ALERTS === */}
      <div className="grid shrink-0 grid-cols-1 gap-3 px-3 pb-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <PanelFrame
          className="min-h-[260px]"
          flushBody
          scroll
          header={
            <PanelHeader
              title="Officers On Duty"
              icon="officer"
              badge={
                <Chip tone="neutral" size="sm">
                  {onDuty.length}/{officers.data?.officers.length ?? 0}
                </Chip>
              }
            />
          }
        >
          <Async state={officers} skeleton={<SkeletonRows rows={5} />}>
            {(d) => (
              <ul className="flex flex-col">
                {[...d.officers]
                  .sort((a, b) => a.status.localeCompare(b.status) || a.name.localeCompare(b.name))
                  .map((o) => {
                    const district = (districts.data?.districts ?? []).find(
                      (x) => x.id === o.districtId,
                    );
                    return (
                      <li
                        key={o.id}
                        className="flex items-center gap-3 border-b border-line-soft px-3 py-2 last:border-b-0"
                      >
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px] bg-panel-sunk text-[10.5px] font-bold text-ink-2">
                          {initials(o.name)}
                        </span>
                        <div className="flex min-w-0 flex-1 flex-col leading-tight">
                          <span className="truncate text-body text-ink">{o.name}</span>
                          <span className="truncate text-meta text-ink-3">
                            {district?.name ?? 'Unassigned'}
                          </span>
                        </div>
                        <StatusDot
                          level={o.status === 'ACTIVE' ? 'LOW' : 'CRITICAL'}
                          pulse={o.status === 'ACTIVE'}
                          size="sm"
                          label={humanizeEnum(o.status)}
                        />
                      </li>
                    );
                  })}
              </ul>
            )}
          </Async>
        </PanelFrame>

        <PanelFrame
          className="min-h-[260px]"
          flushBody
          scroll
          header={<PanelHeader title="Field Alerts" icon="alert" />}
        >
          <Async state={alerts} skeleton={<SkeletonRows rows={4} />}>
            {(d) =>
              d.alerts.length === 0 ? (
                <EmptyState
                  tone="positive"
                  icon="ok"
                  size="sm"
                  title="No alerts"
                  description="Nothing has crossed an alert threshold."
                />
              ) : (
                <ul className="flex flex-col">
                  {d.alerts.slice(0, 5).map((a) => (
                    <li
                      key={a.id}
                      className="flex items-start gap-2.5 border-b border-line-soft px-3 py-2 last:border-b-0"
                    >
                      <span
                        className={cn(
                          'mt-[5px] h-2 w-2 shrink-0 rounded-full',
                          RISK_TONE[severityAsRiskLevel(a.severity)].rail,
                        )}
                      />
                      <div className="flex min-w-0 flex-1 flex-col leading-tight">
                        <span className="truncate text-body text-ink">{a.title}</span>
                        <span className="text-[10px] text-ink-3">
                          {formatAge(a.createdAt, appNow())}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              )
            }
          </Async>
        </PanelFrame>

        <PanelFrame
          className="min-h-[260px]"
          scroll
          header={
            <PanelHeader
              title="Notification Log"
              subtitle="Escalation attempts and their outcome"
              icon="notify"
            />
          }
        >
          <SmsComposer
            officers={officers.data?.officers ?? []}
            alerts={alerts.data?.alerts ?? []}
            canSend={role === 'ADMIN' || role === 'LOGISTICS_OFFICER'}
          />
          <Async state={notifications} skeleton={<SkeletonRows rows={3} />}>
            {() => <NotificationStatus notifications={relevantNotifications} now={appNow()} />}
          </Async>
        </PanelFrame>
      </div>

      <div className="flex shrink-0 items-center justify-between gap-3 px-4 pb-3">
        <p className="text-[10px] leading-relaxed text-ink-3">
          Reroute is wired to a real typed action and changes state. Pre-positioning, inspection
          dispatch and driver contact have no execution endpoint yet — they are shown as ready,
          never as done.
        </p>
        <ProvenanceTag kind="SYNTHETIC_OPERATIONAL" />
      </div>
    </div>
  );
}

/**
 * SMS one officer about one alert (Phase 6A). The operator picks both; the server looks up the
 * number and writes the text, so neither is editable here. In demo mode the send is simulated
 * and labelled as such.
 */
function SmsComposer({
  officers,
  alerts,
  canSend,
}: {
  officers: FieldOfficer[];
  alerts: Alert[];
  canSend: boolean;
}) {
  const [officerId, setOfficerId] = useState('');
  const [alertId, setAlertId] = useState('');
  const [result, setResult] = useState<SendSmsResponse>();
  const chosenOfficer = officers.find((o) => o.id === officerId) ?? officers[0];
  const chosenAlert = alerts.find((a) => a.id === alertId) ?? alerts[0];

  const send = useAction(async () => {
    setResult(undefined);
    if (!chosenOfficer || !chosenAlert) return;
    setResult(await dataSource.sendSms({ officerId: chosenOfficer.id, alertId: chosenAlert.id }));
  });

  if (!canSend || officers.length === 0 || alerts.length === 0) return null;

  return (
    <div className="mb-3 flex flex-col gap-2 rounded-panel border border-line bg-panel-alt px-3 py-2.5">
      <SectionLabel>Send SMS to officer</SectionLabel>
      <div className="grid grid-cols-2 gap-2">
        <select
          className="field"
          aria-label="Officer"
          value={chosenOfficer?.id}
          onChange={(e) => setOfficerId(e.target.value)}
        >
          {officers.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
              {o.status === 'OFFLINE' ? ' (offline)' : ''}
            </option>
          ))}
        </select>
        <select
          className="field"
          aria-label="Alert"
          value={chosenAlert?.id}
          onChange={(e) => setAlertId(e.target.value)}
        >
          {alerts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.severity} · {a.title}
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10.5px] leading-snug text-ink-3">
          {isDemoMode
            ? 'Demo mode: the SMS is simulated, nothing is sent.'
            : `An SMS about this alert will be sent to ${chosenOfficer?.name}'s phone on file.`}
        </p>
        <Button variant="primary" size="sm" icon="notify" pending={send.pending} onClick={send.run}>
          Send SMS
        </Button>
      </div>
      {send.error ? (
        <p className="text-[11px] font-medium text-risk-critical">{send.error.message}</p>
      ) : result ? (
        <p className="text-[11px] font-medium text-risk-low">
          {result.sms.simulated
            ? `Simulated SMS logged for ${result.notification.recipientName} (DEMO — not sent).`
            : `SMS sent to ${result.notification.recipientName} (${result.sms.to}${result.sms.redirected ? ', delivered to the configured test number' : ''}) · ${result.sms.sid}`}
        </p>
      ) : null}
    </div>
  );
}

function ActionRow({
  action,
  active,
  onSelect,
}: {
  action: FieldAction;
  active: boolean;
  onSelect: () => void;
}) {
  const tone = RISK_TONE[severityAsRiskLevel(action.severity)];

  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={active}
        className={cn(
          'relative flex w-full items-start gap-3 border-b border-line-soft py-2.5 pl-4 pr-3 text-left',
          'transition-colors duration-100 ease-ui last:border-b-0 hover:bg-panel-alt',
          active && 'bg-brand-50 hover:bg-brand-50',
        )}
      >
        <span className={cn('absolute inset-y-0 left-0 w-[3px]', tone.rail)} aria-hidden />

        <span
          className={cn(
            'mt-[1px] flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px] ring-1',
            tone.wash,
            tone.text,
            'ring-current/12',
          )}
        >
          <Icon name={KIND_ICON[action.kind]} size="sm" />
        </span>

        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                'rounded-chip px-1.5 py-[1px] text-[10px] font-bold uppercase tracking-[0.05em]',
                tone.wash,
                tone.text,
              )}
            >
              {action.kind.replace('_', ' ')}
            </span>
            {action.status === 'DONE' ? (
              <Chip tone="outline" size="sm" icon="ok" className="text-risk-low">
                Applied
              </Chip>
            ) : action.executable ? (
              <Chip tone="brand" size="sm">
                Executable
              </Chip>
            ) : (
              <span className="text-[10px] text-ink-3">Ready for dispatch</span>
            )}
          </div>

          <span className="truncate text-body font-medium text-ink">{action.title}</span>
          <span className="truncate text-meta text-ink-3">{action.location}</span>
        </div>

        <Icon name="chevronRight" size="sm" className="mt-2 shrink-0 text-ink-3" />
      </button>
    </li>
  );
}
