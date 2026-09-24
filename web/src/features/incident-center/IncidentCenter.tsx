/**
 * Incident Center — what happened, and what it does to everything downstream.
 *
 * The page exists to answer one question a map cannot: an officer photographs a landslide, and
 * then what? Its centrepiece is the cascade graphic, which shows the single reported event
 * propagating through segment risk, route risk, delivery risk and supply risk into a
 * recommendation — the product's whole thesis in one row.
 *
 * Everything is read through the normal hooks. Route impact reuses `MapCanvas`; the cascade
 * graphic and the classification block are feature components over existing domain types.
 */

import { useCallback, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { cn } from '@/lib/cn';
import { useAuth } from '@/app/auth';
import { capabilitiesFor, reachableTarget } from '@/app/modules';
import { dataSource } from '@/data';
import { appNow } from '@/data/clock';
import {
  useAlerts,
  useDeliveries,
  useDistricts,
  useIncidents,
  useResource,
  useRiskSegments,
  useRouteCandidates,
  useWeather,
} from '@/data/hooks';
import { formatAge, formatDuration, formatStockout, formatTime, humanizeEnum } from '@/domain/format';
import { RISK_TONE, riskLevelForScore, severityAsRiskLevel } from '@/domain/thresholds';
import type { Incident } from '@/domain/types';
import { MAX_SEGMENT_DISTANCE_KM, localFocus, pathNearPointKm } from '@/domain/geo';
import type { LatLng } from '@/domain/geo';
import {
  Async,
  Button,
  CellStack,
  Chip,
  Column,
  DataTable,
  EmptyState,
  Icon,
  PanelFrame,
  PanelHeader,
  ProvenanceTag,
  SeverityChip,
  SkeletonPane,
  SkeletonRows,
  StatRow,
  StatusDot,
} from '@/design/primitives';
import { MapCanvas, type MapRiskZone, type MapRoute } from '@/map/MapCanvas';
import { HeroBand } from '@/shell/HeroBand';
import { useShellRailNote } from '@/shell/AppShell';
import ridgeline from '@/assets/ner-ridgeline.jpg';
import { supplyLinePath } from '../shared/supplyLink';
import { CausalChainWide, type ChainStep } from '../shared/CausalChain';
import { featuredDelivery, shortRouteName } from '../shared/delivery';
import { ReportIncidentButton, useIncidentReport } from '../shared/ReportIncident';
import { IncidentClassification } from './IncidentClassification';

const ROUTE_KEYS = ['a', 'b', 'c'] as const;

/**
 * The narrowest the Route Impact map may frame, across the view.
 *
 * Wide enough that the incident is read in context — the road, the valley it sits in, the town
 * the segment is named after — and not so wide that the corridor takes over. Twelve kilometres
 * against a 450 km corridor is the difference between "where is it" and "there it is".
 */
const MIN_FOCUS_SPAN_KM = 12;

/**
 * How much of a route's line to keep in view around an incident that matched the route but no
 * segment. Roughly a segment's worth of road either side, so the corridor reads as a corridor.
 */
const ROUTE_CONTEXT_RADIUS_KM = 12;

export function IncidentCenter() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const role = user?.role ?? 'DISTRICT_OFFICER';
  const capabilities = capabilitiesFor(role);

  const incidents = useIncidents();
  const segments = useRiskSegments();
  const deliveries = useDeliveries();
  const districts = useDistricts();
  const alerts = useAlerts();
  const weather = useWeather();

  const list = useMemo(() => incidents.data?.incidents ?? [], [incidents.data]);

  // Selection in the URL, matching Route Intelligence and Supply Intelligence, so an alert or
  // another page can deep-link to one incident.
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedId = searchParams.get('incident') ?? undefined;
  /**
   * Selection is the row whose database id the URL names — never an index, never "the first one".
   *
   * The old fallback (`?? list[0]`) was the reason a freshly filed report opened the wrong
   * incident: the URL is set the moment the POST returns, a beat before the refetched list
   * contains it, so `find` missed and the panel silently showed the top seeded row instead —
   * detail, Route Impact and cascade all describing a different incident than the URL claimed.
   * A requested id that is not in the list yet now resolves to nothing, and the panel says it is
   * loading rather than showing someone else's landslide.
   */
  const selected = requestedId ? list.find((i) => i.id === requestedId) : list[0];
  const awaitingRequested = Boolean(requestedId) && !selected && incidents.loading;
  const requestedMissing = Boolean(requestedId) && !selected && !incidents.loading;
  const onSelect = useCallback(
    (id: string) => setSearchParams({ incident: id }, { replace: true }),
    [setSearchParams],
  );

  // --- Context the selected incident touches --------------------------------
  const segment = useMemo(
    () => (segments.data?.segments ?? []).find((s) => s.id === selected?.segmentId),
    [segments.data, selected],
  );

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
  const assigned = routeList.find((r) => r.id === delivery?.assignedRouteId) ?? routeList[0];
  const recommended = routeList.find((r) => r.isRecommended);

  const district = useMemo(
    () => (districts.data?.districts ?? []).find((d) => d.id === delivery?.destDistrictId),
    [districts.data, delivery],
  );

  const detail = useResource(
    async () =>
      delivery
        ? await dataSource.getDeliveryById(delivery.id)
        : { delivery: undefined, recommendation: undefined },
    [delivery?.id],
  );

  const relatedAlerts = useMemo(
    () =>
      (alerts.data?.alerts ?? []).filter(
        (a) =>
          (a.relatedType === 'INCIDENT' && a.relatedId === selected?.id) ||
          (a.relatedType === 'DELIVERY' && a.relatedId === delivery?.id) ||
          (a.relatedType === 'DISTRICT' && a.relatedId === district?.id),
      ),
    [alerts.data, selected, delivery, district],
  );

  const simulated = weather.data?.weather.simulated ?? false;

  useShellRailNote(
    selected ? (
      <span className="flex items-center gap-1.5">
        <Icon name="incidents" size="sm" className="opacity-60" />
        <span className="hidden lg:inline">Incident</span>
        <span className="font-semibold text-ink-2">{humanizeEnum(selected.type)}</span>
      </span>
    ) : null,
    [selected?.id],
  );

  // --- Report intake --------------------------------------------------------
  // The shared creation path. The old intake here filed every report at the coordinates of
  // whichever incident happened to be selected (or a hardcoded point in Bhalukpong), so a new
  // landslide always landed on top of an existing marker. The location now comes from the map.
  // On success the new incident is selected, which frames the map on the persisted point.
  const report = useIncidentReport({ onCreated: (r) => onSelect(r.incident.id) });

  // --- The cascade ----------------------------------------------------------
  const chain = useMemo<ChainStep[]>(() => {
    if (!selected) return [];

    const steps: ChainStep[] = [
      {
        id: 'incident',
        label: humanizeEnum(selected.type),
        detail: `Reported ${formatAge(selected.createdAt, appNow())} · ${
          selected.segmentName ??
          (selected.routeImpact ? `on ${selected.routeImpact.name}, no segment match` : 'unmatched location')
        }`,
        value: selected.severity,
        tone: selected.severity === 'CRITICAL' || selected.severity === 'HIGH' ? 'critical' : 'warning',
        icon: 'incidents',
      },
    ];

    if (segment) {
      steps.push({
        id: 'segment',
        label: 'Segment risk',
        detail: `${segment.code} now ${segment.currentStatus.toLowerCase()}`,
        // A segment nobody has scored yet reports no score. Printing 0 would read as "no risk".
        value: segment.lastRiskScore > 0 ? `${segment.lastRiskScore}` : 'Unscored',
        tone:
          segment.lastRiskScore >= 70 ? 'critical' : segment.lastRiskScore >= 40 ? 'warning' : 'neutral',
        icon: 'risk',
        target: '/risk',
      });
    } else {
      // No segment matched, so nothing downstream was re-scored. The chain says that outright
      // rather than showing the corridor's standing figures as if this report had caused them.
      steps.push({
        id: 'segment',
        label: 'Segment risk',
        detail: selected.routeImpact
          ? `No segment within ${MAX_SEGMENT_DISTANCE_KM} km — ${selected.routeImpact.name} carries no scored segment here`
          : `No corridor segment within ${MAX_SEGMENT_DISTANCE_KM} km`,
        value: 'Unchanged',
        tone: 'neutral',
        icon: 'risk',
      });
    }

    // The route the INCIDENT is on — which is not always the one the delivery is driving. Each
    // route owns its segments now (delta D50), so naming the delivery's route here would credit a
    // Route B landslide to Route A.
    const affectedRoute = selected.routeImpact
      ? routeList.find((r) => r.id === selected.routeImpact!.routeId)
      : undefined;
    const routeForStage = affectedRoute ?? assigned;
    if (routeForStage) {
      const isAssigned = routeForStage.id === assigned?.id;
      steps.push({
        id: 'route',
        label: 'Route risk',
        detail: segment
          ? `${shortRouteName(routeForStage.name)} re-scored${isAssigned ? '' : ' — not the delivery’s route'}`
          : `${shortRouteName(routeForStage.name)} unchanged by this report`,
        value: `${routeForStage.riskScore}%`,
        tone:
          routeForStage.riskLevel === 'CRITICAL'
            ? 'critical'
            : routeForStage.riskLevel === 'LOW'
              ? 'neutral'
              : 'warning',
        icon: 'routes',
        target: `/routes?route=${routeForStage.id}`,
      });
    }

    if (delivery) {
      const late = (delivery.expectedDelayMinutes ?? 0) > 0;
      const sharesRoad = !affectedRoute || affectedRoute.id === assigned?.id;
      steps.push({
        id: 'delivery',
        label: 'Delivery risk',
        detail: !sharesRoad
          ? `${delivery.code} runs on ${shortRouteName(assigned?.name ?? '')} — not the road reported`
          : late
            ? `${delivery.code} delayed by ${formatDuration(delivery.expectedDelayMinutes ?? 0)}`
            : `${delivery.code} running to schedule`,
        value: delivery.failureProbability
          ? `${Math.round(delivery.failureProbability * 100)}%`
          : undefined,
        tone: late ? 'critical' : 'neutral',
        icon: 'deliveries',
        target: `/deliveries/${delivery.code}`,
      });
    }

    if (district) {
      const hours = district.stock.medicine.predictedStockoutHours;
      steps.push({
        id: 'supply',
        label: 'Supply risk',
        detail: `${district.name} medicine cover`,
        value: formatStockout(hours),
        tone: hours !== null && hours < 48 ? 'critical' : 'warning',
        icon: 'supply',
        target: supplyLinePath(district.id, 'medicine'),
      });
    }

    steps.push({
      id: 'decision',
      label: detail.data?.recommendation ? 'Recommendation issued' : 'No action outstanding',
      detail: detail.data?.recommendation
        ? detail.data.recommendation.type.replace('_', ' ')
        : 'Corridor monitored; nothing to act on',
      tone: detail.data?.recommendation ? 'brand' : 'neutral',
      icon: 'ai',
    });

    // A Field Officer can open Incidents and Operations and nothing else. Offering them the
    // Risk, Routes, Deliveries and Supply stages as links would bounce them straight back here.
    return steps.map((s) => ({ ...s, target: reachableTarget(role, s.target) }));
  }, [selected, segment, assigned, delivery, district, detail.data, role]);

  /**
   * The candidate route this incident affects, and how we know — delta D52.
   *
   * Two associations exist, and they are not the same question. They stay separate here because
   * they answer differently and the UI says which one spoke:
   *
   *   1. `routeImpact` — the backend matched the reported point to a candidate's line within
   *      `MAX_ROUTE_DISTANCE_KM` (delta D49). It is the only one that can answer for a point
   *      that matched no segment at all, and it carries its own off-the-line distance.
   *   2. the route that carries the matched segment — if a segment scored, the route travelling
   *      it is affected by definition. `segmentIds` is the existing association (delta D39),
   *      computed by `routeSegmentIds`; reading it is a lookup, not a new rule.
   *
   * The second matters because only the first is populated for freshly reported incidents. The
   * seeded ones carry a segment and no `routeImpact`, so the panel used to announce "No corridor
   * affected" over an incident sitting on SEG-013, which Route A travels.
   *
   * Undefined still means what it always meant: off every corridor.
   */
  const affectedRoute = useMemo(() => {
    if (!selected) return undefined;
    if (selected.routeImpact) {
      return routeList.find((r) => r.id === selected.routeImpact!.routeId);
    }
    if (selected.segmentId) {
      return routeList.find((r) => r.segmentIds?.includes(selected.segmentId!));
    }
    return undefined;
  }, [selected, routeList]);

  // --- Map ------------------------------------------------------------------
  const mapRoutes = useMemo<MapRoute[]>(
    () =>
      routeList.map((c, i) => ({
        id: c.id,
        key: ROUTE_KEYS[i] ?? 'c',
        name: shortRouteName(c.name),
        geometry: c.geometry,
        riskScore: c.riskScore,
        etaMinutes: c.etaMinutes,
        recommended: c.isRecommended,
        // The route this incident sits on — not the delivery's assigned route, which made every
        // incident look like it happened on Route A.
        //
        // No fallback. An incident off every corridor highlights nothing: the header says "No
        // corridor affected", and lighting up the assigned route underneath that sentence
        // asserted the opposite. Nothing selected means the map makes no claim.
        selected: c.id === affectedRoute?.id,
        showCallout: true,
      })),
    [routeList, affectedRoute],
  );

  /**
   * What the Route Impact map frames — delta D52.
   *
   * This panel answers "what is happening here", and it used to answer it at `fitMaxZoom={9}`.
   * The corridor's bounding box is only about 110 km by 160 km, so a zoom-9 ceiling frames
   * essentially the whole Guwahati → Tawang corridor whatever it is handed: the incident became
   * a speck somewhere along three route ribbons, and a judge had to search the map to find it.
   *
   * The three cases below are ordered by how much the data actually knows, and each one says
   * something different. None of them widens to the full corridor.
   */
  const focus = useMemo<LatLng[]>(() => {
    if (!selected) return [];
    const at: LatLng = [selected.lat, selected.lng];

    // A — the incident matched a scored segment. Frame the incident with that segment's extent,
    // because the segment is the thing the cascade degraded.
    if (segment) {
      return localFocus(
        at,
        [
          [segment.startLat, segment.startLng],
          [segment.endLat, segment.endLng],
        ],
        MIN_FOCUS_SPAN_KM,
      );
    }

    // B — no segment, but the point is on a candidate corridor. Frame the stretch of that
    // route's own line running past the incident. Real ORS geometry in API mode, the demo
    // line in demo mode; either way its own vertices, and no claim that a segment was scored.
    if (affectedRoute) {
      const nearby = pathNearPointKm(affectedRoute.geometry, at, ROUTE_CONTEXT_RADIUS_KM);
      if (nearby.length > 0) return localFocus(at, nearby, MIN_FOCUS_SPAN_KM);
    }

    // C — off every corridor. Centre on where it was reported and show nothing else.
    return localFocus(at, [], MIN_FOCUS_SPAN_KM);
  }, [selected, segment, affectedRoute]);

  const riskZones = useMemo<MapRiskZone[]>(() => {
    if (!selected) return [];
    return [
      {
        id: selected.id,
        center: [selected.lat, selected.lng],
        radiusM:
          selected.cvEstimatedBlockage === 'SEVERE'
            ? 18_000
            : selected.cvEstimatedBlockage === 'PARTIAL'
              ? 12_000
              : 7_000,
        level: severityAsRiskLevel(selected.severity),
        label: `${humanizeEnum(selected.type)} · ${selected.severity}`,
      },
    ];
  }, [selected]);

  const columns: Column<Incident>[] = [
    {
      key: 'type',
      header: 'Incident',
      render: (i) => (
        <CellStack
          primary={
            <span className="flex items-center gap-1.5">
              <Icon
                name="incidents"
                size="sm"
                className={RISK_TONE[severityAsRiskLevel(i.severity)].text}
              />
              {humanizeEnum(i.type)}
            </span>
          }
          // Never blank: the segment when one matched, the corridor when the point is on a
          // road but off every stored segment, and the coordinates when it is off both.
          secondary={
            i.segmentName ??
            (i.routeImpact
              ? `On ${i.routeImpact.name} · no segment match`
              : `Unmatched location · ${i.lat.toFixed(3)}, ${i.lng.toFixed(3)}`)
          }
        />
      ),
    },
    {
      key: 'severity',
      header: 'Severity',
      width: '108px',
      render: (i) => <SeverityChip severity={i.severity} size="sm" />,
    },
    {
      key: 'detected',
      header: 'Detected',
      numeric: true,
      width: '104px',
      render: (i) => <span className="text-ink-2">{formatAge(i.createdAt, appNow())}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      align: 'right',
      width: '112px',
      render: (i) => (
        <StatusDot
          level={severityAsRiskLevel(i.severity)}
          size="sm"
          label={i.type === 'NORMAL' ? 'Cleared' : 'Open'}
        />
      ),
    },
  ];

  const loading = incidents.loading;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto scroll-thin">
      {/* ============================================================= HERO === */}
      <HeroBand
        image={ridgeline}
        eyebrow="Incident Center"
        eyebrowIcon="incidents"
        title="Report an incident. Watch what it does to everything downstream."
        subtitle="Field reports are classified, matched to a corridor segment, and traced through route, delivery and supply risk."
        credit="Photo: Kingshuk Mondal, CC BY 4.0"
        right={
          <div className="flex items-center gap-3">
            <div className="hidden flex-col items-end gap-1 border-r border-white/15 pr-3 xl:flex">
              <span className="text-[10px] uppercase tracking-[0.06em] text-white/55">
                Open reports
              </span>
              <span className="tnum text-[13px] font-semibold text-white">
                {list.filter((i) => i.type !== 'NORMAL').length}
              </span>
              <span className="text-[11px] text-white/60">
                {list.filter((i) => i.severity === 'CRITICAL' || i.severity === 'HIGH').length}{' '}
                high or critical
              </span>
            </div>
            {capabilities.reportIncident ? (
              <ReportIncidentButton report={report} variant="on-navy" />
            ) : (
              <ProvenanceTag kind="SYNTHETIC_OPERATIONAL" onNavy />
            )}
          </div>
        }
      />

      {/* =========================================================== CASCADE === */}
      <div className="shrink-0 p-3">
        <PanelFrame
          header={
            <PanelHeader
              title="Incident Cascade"
              subtitle="One reported event, traced through every layer it touches"
              icon="simulate"
              badge={
                simulated ? (
                  <Chip tone="neutral" size="sm" className="bg-risk-wash-critical text-risk-critical">
                    Event active
                  </Chip>
                ) : undefined
              }
              actions={<ProvenanceTag kind="ML_PREDICTION" />}
            />
          }
        >
          {loading || chain.length === 0 ? (
            <SkeletonRows rows={2} />
          ) : (
            <>
              <CausalChainWide steps={chain} onNavigate={(t) => navigate(t)} />
              <p className="mt-3 text-[10px] leading-relaxed text-ink-3">
                Each stage is the input to the next. Segment and route risk are model output;
                the stockout projection is delay-adjusted arithmetic; the recommendation is a
                deterministic rule over all three. Select any stage to open it.
              </p>
            </>
          )}
        </PanelFrame>
      </div>

      {report.notice ? <div className="shrink-0 px-3 pt-3">{report.notice}</div> : null}

      {/* ============================================ QUEUE · DETAIL · MAP === */}
      <div className="grid shrink-0 grid-cols-1 gap-3 px-3 pb-3 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,0.9fr)_minmax(0,1.05fr)]">
        {/* --- Queue -------------------------------------------------------- */}
        <PanelFrame
          className="min-h-[420px]"
          flushBody
          scroll
          header={
            <PanelHeader
              title="Incident Queue"
              icon="incidents"
              badge={
                <Chip tone="neutral" size="sm">
                  {list.length}
                </Chip>
              }
              actions={<ProvenanceTag kind="SYNTHETIC_OPERATIONAL" subtle />}
            />
          }
        >
          <Async
            state={incidents}
            skeleton={<SkeletonRows rows={6} />}
            isEmpty={(d) => d.incidents.length === 0}
            empty={
              <EmptyState
                tone="positive"
                icon="ok"
                size="sm"
                title="No incidents reported"
                description="No field officer has filed a road condition report on the corridor."
              />
            }
          >
            {(d) => (
              <DataTable
                columns={columns}
                rows={d.incidents}
                rowKey={(i) => i.id}
                density="compact"
                stickyHeader
                onRowClick={(i) => onSelect(i.id)}
                isRowActive={(i) => i.id === selected?.id}
                rowAccent={(i) => RISK_TONE[severityAsRiskLevel(i.severity)].rail}
              />
            )}
          </Async>
        </PanelFrame>

        {/* --- Detail ------------------------------------------------------- */}
        <PanelFrame
          className="min-h-[420px]"
          scroll
          header={
            <PanelHeader
              title={selected ? humanizeEnum(selected.type) : 'Incident'}
              subtitle={selected?.segmentName}
              icon="explanation"
              badge={selected ? <SeverityChip severity={selected.severity} size="sm" /> : undefined}
            />
          }
        >
          {requestedMissing ? (
            // The URL names an incident the list does not have — deleted, or reset away. Saying
            // so beats rendering a different incident under its id.
            <EmptyState
              icon="incidents"
              title="That incident is no longer in the queue"
              description="It may have been cleared by a demo reset. Choose another from the list."
            />
          ) : loading || awaitingRequested || !selected ? (
            <SkeletonRows rows={5} />
          ) : (
            <div className="flex flex-col gap-3">
              <div className="flex flex-col divide-y divide-line-soft">
                <StatRow
                  label="Detected"
                  icon="live"
                  value={`${formatTime(selected.createdAt)} · ${formatAge(selected.createdAt, appNow())}`}
                />
                <StatRow
                  label="Location"
                  icon="destination"
                  value={`${selected.lat.toFixed(3)}, ${selected.lng.toFixed(3)}`}
                />
                {segment ? (
                  <StatRow
                    label="Affected segment"
                    icon="routes"
                    emphasis
                    value={
                      // A segment that has never been scored says so. "· 0" would read as
                      // "no risk", which is a claim nobody made.
                      segment.lastRiskScore > 0 ? (
                        <span className={RISK_TONE[riskLevelForScore(segment.lastRiskScore)].text}>
                          {segment.code} · {segment.lastRiskScore}
                        </span>
                      ) : (
                        <span className="text-ink-2">
                          {segment.code} <span className="text-ink-3">· unscored</span>
                        </span>
                      )
                    }
                  />
                ) : (
                  // Unmatched is a legitimate outcome, not a gap: say so, and say why.
                  <StatRow
                    label="Affected segment"
                    icon="routes"
                    value={
                      <span className="text-ink-3">
                        Unmatched · no corridor segment within {MAX_SEGMENT_DISTANCE_KM} km
                      </span>
                    }
                  />
                )}
                <StatRow
                  label="Corridor"
                  icon="navigate"
                  value={
                    selected.routeImpact ? (
                      <span className={RISK_TONE[selected.routeImpact.riskLevel].text}>
                        {selected.routeImpact.name} · {selected.routeImpact.riskScore}%
                        <span className="text-ink-3"> · {selected.routeImpact.distanceKm} km off the line</span>
                      </span>
                    ) : affectedRoute ? (
                      // Derived from the matched segment rather than from a line match, so it
                      // says what it knows: which route carries the segment, not how far off
                      // the line the report was.
                      <span className={RISK_TONE[riskLevelForScore(affectedRoute.riskScore)].text}>
                        {shortRouteName(affectedRoute.name)} · {affectedRoute.riskScore}%
                        {selected.segmentName ? (
                          <span className="text-ink-3"> · carries {selected.segmentName}</span>
                        ) : null}
                      </span>
                    ) : (
                      <span className="text-ink-3">No corridor affected</span>
                    )
                  }
                />
              </div>

              {selected.description ? (
                <p className="rounded-panel border border-line bg-panel-alt px-3 py-2.5 text-meta leading-relaxed text-ink-2">
                  {selected.description}
                </p>
              ) : null}

              <IncidentClassification incident={selected} />
            </div>
          )}
        </PanelFrame>

        {/* --- Route impact -------------------------------------------------- */}
        <PanelFrame
          variant="bare"
          className="min-h-[420px] border border-line shadow-panel"
          flushBody
          header={
            <PanelHeader
              title="Route Impact"
              // The corridor this incident is on, with its current risk. Previously this read
              // the delivery's assigned route, so every incident — wherever it was — claimed to
              // affect Route A.
              subtitle={
                selected?.routeImpact
                  ? `${selected.routeImpact.name} · risk ${selected.routeImpact.riskScore}%`
                  : affectedRoute
                    ? `${shortRouteName(affectedRoute.name)} · risk ${affectedRoute.riskScore}%`
                    : selected
                      ? 'No corridor affected — outside every candidate route'
                      : 'Affected corridor'
              }
              icon="liveMap"
              actions={
                affectedRoute || assigned ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    iconRight="arrowRight"
                    onClick={() => navigate(`/routes?route=${affectedRoute?.id ?? assigned!.id}`)}
                  >
                    Analyse
                  </Button>
                ) : undefined
              }
            />
          }
        >
          {loading || routeList.length === 0 || !selected ? (
            <SkeletonPane className="m-3" />
          ) : (
            <MapCanvas
              routes={mapRoutes}
              // While reporting, show every incident, so the officer can see what is already
              // reported nearby. Otherwise just the one this panel is about.
              incidents={report.stage === 'idle' ? [selected] : list}
              pick={report.pick}
              riskZones={riskZones}
              places={[]}
              layers={{ vehicles: false, facilities: false }}
              // Local to the incident — see `focus` above for what each case frames.
              fitTo={focus}
              // The ceiling only bites on an incident with no route context at all, and
              // `MIN_FOCUS_SPAN_KM` already stops the fit before it gets there. It stays as a
              // guard so a degenerate extent cannot zoom into imagery that has no detail left.
              fitMaxZoom={12}
              onSelectRoute={(r) => navigate(`/routes?route=${r.id}`)}
              showBasemapSwitch={false}
              showLegend
              legendDefaultOpen={false}
            />
          )}
        </PanelFrame>
      </div>

      {/* ================================================= ALERTS + IMPACT === */}
      <div className="grid shrink-0 grid-cols-1 gap-3 px-3 pb-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <PanelFrame
          header={
            <PanelHeader
              title="Alerts Raised"
              subtitle="Generated by the decision engine from this cascade"
              icon="alert"
              badge={
                relatedAlerts.length > 0 ? (
                  <Chip tone="neutral" size="sm">
                    {relatedAlerts.length}
                  </Chip>
                ) : undefined
              }
            />
          }
        >
          {relatedAlerts.length === 0 ? (
            <EmptyState
              tone="positive"
              icon="ok"
              size="sm"
              title="No alerts raised"
              description="This incident has not crossed a threshold that warrants an alert."
            />
          ) : (
            <ul className="flex flex-col divide-y divide-line-soft">
              {relatedAlerts.map((a) => (
                <li key={a.id} className="flex items-start gap-3 py-2.5">
                  <span
                    className={cn(
                      'mt-[2px] h-2 w-2 shrink-0 rounded-full',
                      RISK_TONE[severityAsRiskLevel(a.severity)].rail,
                    )}
                  />
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-body font-medium text-ink">{a.title}</span>
                      <SeverityChip severity={a.severity} size="sm" className="ml-auto shrink-0" />
                    </span>
                    <span className="text-meta text-ink-2">{a.message}</span>
                    <span className="flex items-center gap-2 text-[10px] text-ink-3">
                      {formatAge(a.createdAt, appNow())}
                      {a.notifiedViaTwilio ? (
                        <span className="flex items-center gap-1 text-brand-700">
                          <Icon name="notify" size="sm" />
                          Officer notified
                        </span>
                      ) : (
                        <span className="text-ink-3">Dashboard only</span>
                      )}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </PanelFrame>

        <PanelFrame
          header={
            <PanelHeader
              title="Downstream Consequence"
              subtitle="What this incident is costing"
              icon="supply"
            />
          }
        >
          <div className="flex flex-col gap-3">
            <div className="flex flex-col divide-y divide-line-soft">
              {delivery ? (
                <StatRow
                  label="Affected delivery"
                  icon="deliveries"
                  emphasis
                  value={
                    <button
                      type="button"
                      onClick={() => navigate(`/deliveries/${delivery.code}`)}
                      className="font-semibold text-brand-700 underline-offset-2 hover:underline"
                    >
                      {delivery.code}
                    </button>
                  }
                />
              ) : null}
              {delivery?.expectedDelayMinutes ? (
                <StatRow
                  label="Predicted delay"
                  icon="prediction"
                  value={
                    <span className="text-risk-critical">
                      +{formatDuration(delivery.expectedDelayMinutes)}
                    </span>
                  }
                />
              ) : null}
              {district ? (
                <StatRow
                  label={`${district.name} medicine cover`}
                  icon="supply"
                  emphasis
                  value={
                    <button
                      type="button"
                      onClick={() => navigate(supplyLinePath(district.id, 'medicine'))}
                      className="font-semibold text-brand-700 underline-offset-2 hover:underline"
                    >
                      {formatStockout(district.stock.medicine.predictedStockoutHours)}
                    </button>
                  }
                />
              ) : null}
              {recommended && assigned && recommended.id !== assigned.id ? (
                <StatRow
                  label="Safer candidate"
                  icon="ai"
                  value={
                    <button
                      type="button"
                      onClick={() => navigate(`/routes?route=${recommended.id}`)}
                      className="font-semibold text-brand-700 underline-offset-2 hover:underline"
                    >
                      {shortRouteName(recommended.name)} · {recommended.riskScore}%
                    </button>
                  }
                />
              ) : null}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button variant="secondary" size="sm" icon="routes" onClick={() => navigate('/routes')}>
                Route Intelligence
              </Button>
              <Button variant="secondary" size="sm" icon="supply" onClick={() => navigate('/supply')}>
                Supply Intelligence
              </Button>
            </div>
          </div>
        </PanelFrame>
      </div>

      <div className="flex shrink-0 items-center justify-between gap-3 px-4 pb-3">
        <p className="text-[10px] leading-relaxed text-ink-3">
          Photo classification in this build is a seeded demonstration value, not a live vision
          model call. The cascade it feeds is real: the same segment, route, delivery and supply
          state the rest of the product reads.
        </p>
        <ProvenanceTag kind="SYNTHETIC_OPERATIONAL" />
      </div>

      {/* ============================================================ INTAKE === */}
      {report.dialog}
    </div>
  );
}
