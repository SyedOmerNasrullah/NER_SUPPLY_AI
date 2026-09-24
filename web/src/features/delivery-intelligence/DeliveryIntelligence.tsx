/**
 * Delivery Intelligence — one delivery, end to end.
 *
 * Reads as a single argument:
 *   what is moving      → hero + cargo
 *   where is it         → the journey timeline
 *   will it make it     → failure probability and the ETA comparison
 *   why not             → the route it is on, and that route's factors
 *   what should we do   → the recommendation
 *   who does it hurt    → the destination's supply projection
 *   who was told        → the notification log
 *
 * `/deliveries/:code` selects a specific delivery; `/deliveries` falls back to the ranking, so
 * this page always lands on the same delivery the Command Center features.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { cn } from '@/lib/cn';
import { useAuth } from '@/app/auth';
import { capabilitiesFor } from '@/app/modules';
import { dataSource } from '@/data';
import { appNow } from '@/data/clock';
import {
  useAction,
  useDeliveries,
  useDistricts,
  useIncidents,
  useNotifications,
  useResource,
  useRouteCandidates,
  useVehicles,
} from '@/data/hooks';
import { formatDuration, formatNumber, formatProbability, formatTime } from '@/domain/format';
import { CORRIDOR_WAYPOINTS } from '@/domain/geo';
import { RISK_TONE, riskLevelForProbability } from '@/domain/thresholds';
import {
  Async,
  Button,
  Chip,
  DeliveryStatusChip,
  Icon,
  PanelFrame,
  PanelHeader,
  PriorityChip,
  ProvenanceTag,
  RadialGauge,
  SectionLabel,
  SkeletonPane,
  SkeletonRows,
  StatRow,
} from '@/design/primitives';
import { MapCanvas, type MapRoute } from '@/map/MapCanvas';
import { HeroBand } from '@/shell/HeroBand';
import { useShellRailNote } from '@/shell/AppShell';
import ridgeline from '@/assets/ner-ridgeline.jpg';
import { RecommendationBanner } from '../shared/RecommendationBanner';
import { RiskFactors } from '../shared/RiskFactors';
import { overrunMinutes, resolveDelivery, shortRouteName } from '../shared/delivery';
import { RouteStrip } from '../route-intelligence/RouteComparison';
import { EtaComparison, JourneyTimeline, buildStops, progressAlongPath } from './JourneyTimeline';
import { NotificationStatus, SupplyConsequence, categoryForCargo } from './SupplyConsequence';

const ROUTE_KEYS = ['a', 'b', 'c'] as const;

export function DeliveryIntelligence() {
  const navigate = useNavigate();
  const { code } = useParams();
  const { user } = useAuth();
  const capabilities = capabilitiesFor(user?.role ?? 'DISTRICT_OFFICER');

  const deliveries = useDeliveries();
  const vehicles = useVehicles();
  const incidents = useIncidents();
  const districts = useDistricts();
  const notifications = useNotifications();

  const delivery = useMemo(
    () => resolveDelivery(deliveries.data?.deliveries ?? [], code),
    [deliveries.data, code],
  );

  // A stale or mistyped code falls back to the featured delivery rather than dead-ending — but
  // then the address bar says NE-201 while the page says NE-102, which is the kind of quiet
  // disagreement that costs you the room when someone notices it mid-demo. Rewriting the URL to
  // the delivery actually on screen keeps the two honest, and `replace` keeps the bad link out
  // of history so Back still goes where the operator came from.
  useEffect(() => {
    if (code && delivery && delivery.code !== code) {
      navigate(`/deliveries/${delivery.code}`, { replace: true });
    }
  }, [code, delivery, navigate]);

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
        : { delivery: undefined, recommendation: undefined },
    [delivery?.id],
  );

  // --- Selection ----------------------------------------------------------
  const [selectedId, setSelectedId] = useState<string>();
  const effectiveId =
    (selectedId && routeList.some((r) => r.id === selectedId) && selectedId) ||
    (delivery?.assignedRouteId &&
      routeList.some((r) => r.id === delivery.assignedRouteId) &&
      delivery.assignedRouteId) ||
    routeList.find((r) => r.isRecommended)?.id;

  const selected = routeList.find((r) => r.id === effectiveId);
  const assigned = routeList.find((r) => r.id === delivery?.assignedRouteId);
  const recommended = routeList.find((r) => r.isRecommended);
  const onSelect = useCallback((id: string) => setSelectedId(id), []);

  // Whether THIS session accepted a reroute. Distinct from "the assigned route happens to be
  // the recommended one", which is simply the healthy baseline and must not be reported as an
  // action the operator took.
  const [rerouteApplied, setRerouteApplied] = useState(false);
  const reroute = useAction(async () => {
    if (!delivery || !recommended) return;
    await dataSource.rerouteDelivery({ deliveryId: delivery.id, routeId: recommended.id });
    setSelectedId(recommended.id);
    setRerouteApplied(true);
  });

  // --- Derived context ----------------------------------------------------
  const vehicle = useMemo(
    () =>
      (vehicles.data?.vehicles ?? []).find(
        (v) => v.id === delivery?.assignedVehicleId || v.currentDeliveryId === delivery?.id,
      ),
    [vehicles.data, delivery],
  );

  const progress = useMemo(() => {
    if (!assigned || !vehicle) return 0;
    return progressAlongPath(assigned.geometry, [vehicle.currentLat, vehicle.currentLng]);
  }, [assigned, vehicle]);

  const stops = useMemo(() => {
    if (!assigned) return [];
    return buildStops(assigned, CORRIDOR_WAYPOINTS, progress, incidents.data?.incidents ?? []);
  }, [assigned, progress, incidents.data]);

  const district = useMemo(
    () => (districts.data?.districts ?? []).find((d) => d.id === delivery?.destDistrictId),
    [districts.data, delivery],
  );

  const supplyRecommendation = useResource(
    async () =>
      delivery?.destDistrictId
        ? await dataSource.getDistrictById(delivery.destDistrictId)
        : { district: undefined, recommendation: undefined },
    [delivery?.destDistrictId],
  );

  const deliveryNotifications = useMemo(
    () =>
      (notifications.data?.notifications ?? []).filter(
        (n) => n.relatedId === delivery?.id || n.relatedId === delivery?.destDistrictId,
      ),
    [notifications.data, delivery],
  );

  const failureProbability = delivery?.failureProbability ?? 0;
  const failureLevel = riskLevelForProbability(failureProbability);
  const overrun = delivery ? overrunMinutes(delivery) : 0;

  useShellRailNote(
    delivery ? (
      <span className="flex items-center gap-1.5">
        <Icon name="deliveries" size="sm" className="opacity-60" />
        <span className="hidden lg:inline">Delivery</span>
        <span className="font-semibold text-ink-2">{delivery.code}</span>
      </span>
    ) : null,
    [delivery?.code],
  );

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
        selected: c.id === effectiveId,
        showCallout: true,
      })),
    [routeList, effectiveId],
  );

  const loading = deliveries.loading || candidates.loading;

  if (!loading && !delivery) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <PanelFrame header={<PanelHeader title="Delivery" icon="deliveries" />} className="max-w-md">
          <p className="text-body text-ink-2">
            No delivery matches <span className="font-semibold text-ink">{code}</span>, and no
            other delivery is currently in play.
          </p>
        </PanelFrame>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto scroll-thin">
      {/* ============================================================ HERO === */}
      <HeroBand
        image={ridgeline}
        eyebrow="Delivery Intelligence"
        eyebrowIcon="deliveries"
        title={delivery ? `${delivery.code} · ${delivery.cargoType}` : 'Delivery'}
        subtitle={
          delivery ? `${delivery.originName} → ${delivery.destName}` : 'Loading delivery…'
        }
        credit="Photo: Kingshuk Mondal, CC BY 4.0"
        right={
          delivery ? (
            <div className="flex items-stretch gap-3">
              <div className="hidden flex-col justify-center gap-1.5 border-r border-white/15 pr-3 xl:flex">
                <span className="text-[10px] uppercase tracking-[0.06em] text-white/55">
                  Required by
                </span>
                <span className="tnum text-[13px] font-semibold text-white">
                  {formatTime(delivery.requiredEta)}
                </span>
                <span className="tnum text-[11px] text-white/60">
                  predicted {formatTime(delivery.currentEta)}
                </span>
              </div>

              <div className="flex flex-col items-end justify-center gap-1.5">
                <div className="flex items-center gap-1.5">
                  <Chip tone="navy" size="sm" icon="critical">
                    {delivery.priority}
                  </Chip>
                  <Chip tone="navy" size="sm" icon="vehicle">
                    {vehicle?.code ?? '—'}
                  </Chip>
                </div>
                <div className="flex items-center gap-1.5">
                  <Chip tone="navy" size="sm">
                    {delivery.status.replace('_', ' ')}
                  </Chip>
                  <span className="text-[11px] text-white/60">{vehicle?.driverName ?? ''}</span>
                </div>
              </div>
            </div>
          ) : null
        }
      />

      {/* ========================================================= JOURNEY === */}
      <div className="shrink-0 p-3">
        <PanelFrame
          header={
            <PanelHeader
              title="Journey"
              subtitle={assigned ? `On ${assigned.name}` : undefined}
              icon="navigate"
              badge={delivery ? <DeliveryStatusChip status={delivery.status} /> : undefined}
              actions={<ProvenanceTag kind="SYNTHETIC_OPERATIONAL" />}
            />
          }
        >
          {loading || !assigned ? (
            <SkeletonRows rows={3} />
          ) : (
            <JourneyTimeline
              route={assigned}
              vehicle={vehicle}
              stops={stops}
              progress={progress}
            />
          )}
        </PanelFrame>
      </div>

      {/* ================================================ RISK · ROUTE · ACT === */}
      <div className="grid shrink-0 grid-cols-1 gap-3 px-3 pb-3 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.25fr)_minmax(0,1fr)]">
        {/* --- Delivery risk --------------------------------------------- */}
        <PanelFrame
          className="min-h-[320px]"
          scroll
          header={
            <PanelHeader
              title="Delivery Risk"
              icon="prediction"
              actions={<ProvenanceTag kind="ML_PREDICTION" />}
            />
          }
        >
          {loading || !delivery ? (
            <SkeletonRows rows={5} />
          ) : (
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-4">
                <RadialGauge
                  value={Math.round(failureProbability * 100)}
                  level={failureLevel}
                  size={112}
                  thickness={10}
                  label="Failure"
                />
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  <div className="flex flex-col gap-0.5">
                    <span className="t-label">Failure probability</span>
                    <span
                      className={cn(
                        'tnum text-[26px] font-semibold leading-none',
                        RISK_TONE[failureLevel].text,
                      )}
                    >
                      {formatProbability(failureProbability)}
                    </span>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <span className="t-label">Expected delay</span>
                    <span className="tnum text-[17px] font-semibold text-ink">
                      {delivery.expectedDelayMinutes
                        ? `+${formatDuration(delivery.expectedDelayMinutes)}`
                        : 'None'}
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex flex-col divide-y divide-line-soft">
                <StatRow
                  label="Current route risk"
                  icon="routes"
                  emphasis
                  value={
                    selected ? (
                      <span className={RISK_TONE[selected.riskLevel].text}>
                        {selected.riskScore}% · {selected.riskLevel}
                      </span>
                    ) : (
                      '—'
                    )
                  }
                />
                <StatRow
                  label="Weather severity"
                  icon="weather"
                  value={selected?.profile ? selected.profile.weatherSeverity : '—'}
                />
                <StatRow
                  label="Cargo priority"
                  icon="critical"
                  value={<PriorityChip priority={delivery.priority} />}
                />
                <StatRow
                  label="Cargo"
                  icon="medicine"
                  value={
                    delivery.cargoUnits ? `${formatNumber(delivery.cargoUnits)} units` : '—'
                  }
                />
              </div>

              <SectionLabel rule>Required vs predicted arrival</SectionLabel>
              <EtaComparison
                requiredMinutes={Math.max(
                  0,
                  Math.round((new Date(delivery.requiredEta).getTime() - appNow()) / 60_000),
                )}
                predictedMinutes={Math.max(
                  0,
                  Math.round((new Date(delivery.currentEta).getTime() - appNow()) / 60_000),
                )}
              />
            </div>
          )}
        </PanelFrame>

        {/* --- Route context ---------------------------------------------- */}
        <PanelFrame
          variant="bare"
          className="min-h-[320px] border border-line shadow-panel"
          flushBody
          header={
            <PanelHeader
              title="Route Context"
              subtitle={
                assigned && recommended && assigned.id !== recommended.id
                  ? `Currently on ${shortRouteName(assigned.name)} · ${shortRouteName(recommended.name)} recommended`
                  : 'Current corridor and candidates'
              }
              icon="liveMap"
              actions={
                <Button
                  variant="ghost"
                  size="sm"
                  iconRight="arrowRight"
                  onClick={() => navigate('/routes')}
                >
                  Route analysis
                </Button>
              }
            />
          }
        >
          {loading || routeList.length === 0 ? (
            <SkeletonPane className="m-3" />
          ) : (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="min-h-0 flex-1">
                <MapCanvas
                  routes={mapRoutes}
                  vehicles={vehicle ? [vehicle] : []}
                  incidents={incidents.data?.incidents ?? []}
                  places={[]}
                  origins={
                    delivery
                      ? [
                          {
                            id: 'o',
                            name: delivery.originName ?? 'Origin',
                            position: [delivery.originLat, delivery.originLng],
                          },
                        ]
                      : []
                  }
                  destinations={
                    delivery
                      ? [
                          {
                            id: 'd',
                            name: delivery.destName ?? 'Destination',
                            position: [delivery.destLat, delivery.destLng],
                          },
                        ]
                      : []
                  }
                  layers={{ facilities: true, riskZones: false }}
                  // The selected route's corridor; all candidates only before one resolves.
                  fitTo={routeList.find((c) => c.id === effectiveId)?.geometry ?? routeList.flatMap((c) => c.geometry)}
                  onSelectRoute={(r) => onSelect(r.id)}
                  showBasemapSwitch={false}
                  selectedVehicleId={vehicle?.id}
                />
              </div>
              <div className="shrink-0 border-t border-line-soft p-3">
                <RouteStrip
                  candidates={routeList}
                  selectedId={effectiveId}
                  assignedId={delivery?.assignedRouteId}
                  onSelect={onSelect}
                />
              </div>
            </div>
          )}
        </PanelFrame>

        {/* --- Decision + why ---------------------------------------------- */}
        <div className="flex min-h-0 flex-col gap-3">
          <RecommendationBanner
            recommendation={detail.data?.recommendation}
            current={assigned ?? selected}
            recommended={recommended}
            layout="stacked"
            accepted={rerouteApplied}
            onAccept={capabilities.createDelivery ? reroute.run : undefined}
            accepting={reroute.pending}
            acceptLabel="Reroute delivery"
          />

          <PanelFrame
            className="min-h-0 flex-1"
            scroll
            header={
              <PanelHeader
                title="Why this delivery is at risk"
                subtitle={selected ? shortRouteName(selected.name) : undefined}
                icon="explanation"
              />
            }
          >
            {selected ? (
              <RiskFactors
                factors={selected.topFactors}
                level={selected.riskLevel}
                explanation={selected.explanationText}
                routeName={selected.name}
                heading="Contributing factors"
              />
            ) : (
              <SkeletonRows rows={4} />
            )}
          </PanelFrame>
        </div>
      </div>

      {/* ============================================ SUPPLY + NOTIFICATIONS === */}
      <div className="grid shrink-0 grid-cols-1 gap-3 px-3 pb-3 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <PanelFrame
          header={
            <PanelHeader
              title="Destination Supply Impact"
              subtitle={
                delivery
                  ? `What a late ${delivery.cargoType.toLowerCase()} delivery does downstream`
                  : undefined
              }
              icon="supply"
              actions={<ProvenanceTag kind="SYNTHETIC_OPERATIONAL" />}
            />
          }
        >
          <Async state={districts} skeleton={<SkeletonRows rows={4} />}>
            {() => (
              <SupplyConsequence
                district={district}
                category={categoryForCargo(delivery?.cargoType ?? 'medicine')}
                recommendation={supplyRecommendation.data?.recommendation}
                onViewSupply={() => navigate('/supply')}
              />
            )}
          </Async>
        </PanelFrame>

        <PanelFrame
          header={
            <PanelHeader
              title="Notifications"
              subtitle="Escalation raised by the decision engine"
              icon="notify"
              badge={
                deliveryNotifications.length > 0 ? (
                  <Chip tone="neutral" size="sm">
                    {deliveryNotifications.length}
                  </Chip>
                ) : undefined
              }
            />
          }
        >
          <Async state={notifications} skeleton={<SkeletonRows rows={3} />}>
            {() => <NotificationStatus notifications={deliveryNotifications} now={appNow()} />}
          </Async>
        </PanelFrame>
      </div>

      <div className="flex shrink-0 items-center justify-between gap-3 px-4 pb-3">
        <p className="text-[10px] leading-relaxed text-ink-3">
          Failure probability and expected delay are model output. The supply projection is
          delay-adjusted arithmetic on the destination&rsquo;s own consumption rate
          {overrun > 0 ? `, currently carrying a ${formatDuration(overrun)} overrun` : ''}.
        </p>
        <div className="flex shrink-0 items-center gap-3">
          <ProvenanceTag kind="ML_PREDICTION" />
          <ProvenanceTag kind="LLM_EXPLANATION" />
        </div>
      </div>
    </div>
  );
}
