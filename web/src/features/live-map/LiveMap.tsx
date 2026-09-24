/**
 * Live Logistics Map — where everything is right now.
 *
 * Deliberately not a second Command Center. The Command Center asks "what is at risk and what
 * should we do"; this asks "where is everything, and which movement needs attention". So the
 * map is full-bleed rather than a panel, the fleet is the subject rather than one delivery, and
 * the rail is a movement list you work down rather than an analysis of a single corridor.
 *
 * Selection lives in the URL as `?vehicle=<id>`, matching the convention the other pages use.
 */

import { useCallback, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { cn } from '@/lib/cn';
import { useAuth } from '@/app/auth';
import { capabilitiesFor } from '@/app/modules';
import { appNow } from '@/data/clock';
import {
  useDeliveries,
  useIncidents,
  useRouteCandidates,
  useVehicles,
  useWarehouses,
  useWeather,
} from '@/data/hooks';
import { formatDistance, formatTime, humanizeEnum } from '@/domain/format';
import { CORRIDOR_WAYPOINTS, haversineKm, type LatLng } from '@/domain/geo';
import { RISK_TONE, severityAsRiskLevel, vehicleToneLevel } from '@/domain/thresholds';
import type { Vehicle } from '@/domain/types';
import {
  Async,
  Button,
  Callout,
  Chip,
  DeliveryStatusChip,
  Icon,
  PanelFrame,
  PanelHeader,
  ProvenanceTag,
  SkeletonPane,
  SkeletonRows,
  StatRow,
  StatusDot,
} from '@/design/primitives';
import { MapCanvas, type MapRiskZone, type MapRoute } from '@/map/MapCanvas';
import { HeroBand } from '@/shell/HeroBand';
import { useShellRailNote } from '@/shell/AppShell';
import ridgeline from '@/assets/ner-ridgeline.jpg';
import { featuredDelivery, shortRouteName } from '../shared/delivery';
import { ReportIncidentButton, useIncidentReport } from '../shared/ReportIncident';

const ROUTE_KEYS = ['a', 'b', 'c'] as const;
const LABELLED = [0, 7, 9, 11, 13, 15];

export function LiveMap() {
  const navigate = useNavigate();
  const vehicles = useVehicles();
  const deliveries = useDeliveries();
  const incidents = useIncidents();
  const warehouses = useWarehouses();
  const weather = useWeather();
  const { user } = useAuth();
  const canReport = capabilitiesFor(user?.role ?? 'DISTRICT_OFFICER').reportIncident;

  // Report straight from the map. The new marker is not drawn here: after the POST, the data
  // layer refetches incidents and the marker comes back from the server at the stored point.
  const report = useIncidentReport();

  const fleet = useMemo(() => vehicles.data?.vehicles ?? [], [vehicles.data]);
  const moving = useMemo(() => fleet.filter((v) => v.status === 'IN_TRANSIT'), [fleet]);
  const anomalies = useMemo(() => fleet.filter((v) => v.anomaly), [fleet]);

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

  // --- Selection ------------------------------------------------------------
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedId = searchParams.get('vehicle') ?? undefined;
  const selected =
    fleet.find((v) => v.id === requestedId || v.code === requestedId) ?? moving[0] ?? fleet[0];

  const onSelect = useCallback(
    (id: string) => setSearchParams({ vehicle: id }, { replace: true }),
    [setSearchParams],
  );

  const selectedDelivery = useMemo(
    () =>
      (deliveries.data?.deliveries ?? []).find(
        (d) => d.id === selected?.currentDeliveryId || d.assignedVehicleId === selected?.id,
      ),
    [deliveries.data, selected],
  );

  const nearestPlace = useMemo(() => {
    if (!selected) return undefined;
    let best = CORRIDOR_WAYPOINTS[0];
    let bestKm = Infinity;
    for (const w of CORRIDOR_WAYPOINTS) {
      const km = haversineKm([selected.currentLat, selected.currentLng], [w.lat, w.lng]);
      if (km < bestKm) {
        bestKm = km;
        best = w;
      }
    }
    return { name: best.name, km: bestKm };
  }, [selected]);

  useShellRailNote(
    <span className="flex items-center gap-1.5">
      <Icon name="vehicle" size="sm" className="opacity-60" />
      <span className="hidden lg:inline">Fleet</span>
      <span className="font-semibold text-ink-2">
        {moving.length} moving
        {anomalies.length > 0 ? ` · ${anomalies.length} flagged` : ''}
      </span>
    </span>,
    [moving.length, anomalies.length],
  );

  // --- Map layers -----------------------------------------------------------
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
        selected: c.id === assigned?.id,
        // Only the assigned corridor gets a callout here — this page is about movement, and
        // three route chips would compete with the vehicles for attention.
        showCallout: c.id === assigned?.id,
      })),
    [routeList, assigned],
  );

  const riskZones = useMemo<MapRiskZone[]>(
    () =>
      (incidents.data?.incidents ?? [])
        .filter((i) => i.type !== 'NORMAL' && i.severity !== 'LOW')
        .map((i) => ({
          id: i.id,
          center: [i.lat, i.lng] as LatLng,
          radiusM:
            i.cvEstimatedBlockage === 'SEVERE'
              ? 18_000
              : i.cvEstimatedBlockage === 'PARTIAL'
                ? 12_000
                : 7_000,
          level: severityAsRiskLevel(i.severity),
          label: `${humanizeEnum(i.type)} · ${i.severity}`,
        })),
    [incidents.data],
  );

  const places = useMemo(
    () =>
      LABELLED.map((i) => ({
        name: CORRIDOR_WAYPOINTS[i].name,
        position: [CORRIDOR_WAYPOINTS[i].lat, CORRIDOR_WAYPOINTS[i].lng] as LatLng,
      })),
    [],
  );

  // Skeleton on first load only. Every write (a filed report included) triggers an app-wide
  // refetch; blanking the map for each one remounted Leaflet, reset the viewport, and flashed
  // every marker off and on — the opposite of watching a new incident appear.
  const loading = (vehicles.loading && !vehicles.data) || (candidates.loading && !candidates.data);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto scroll-thin">
      {/* ============================================================= HERO === */}
      <HeroBand
        image={ridgeline}
        size="sm"
        eyebrow="Live Logistics Map"
        eyebrowIcon="liveMap"
        title="Real-time movement and corridor visibility"
        subtitle="Every vehicle, route and reported hazard across the North Eastern Region."
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
              <div className="flex items-center gap-1.5">
                <Chip tone="navy" size="sm" icon="vehicle">
                  {moving.length} moving
                </Chip>
                {anomalies.length > 0 ? (
                  <Chip tone="navy" size="sm" icon="warning">
                    {anomalies.length} flagged
                  </Chip>
                ) : null}
              </div>
              <ProvenanceTag kind="SYNTHETIC_OPERATIONAL" onNavy />
            </div>
          </div>
        }
      />

      {report.notice || incidents.error ? (
        <div className="flex shrink-0 flex-col gap-2 px-3 pt-3">
          {report.notice}
          {incidents.error ? (
            // Said out loud rather than drawn as an empty layer: a map with no hazard markers
            // because the request failed looks exactly like a map with no hazards.
            <Callout
              tone="critical"
              icon="warning"
              title="Incidents could not be loaded"
              action={
                <Button size="sm" variant="secondary" icon="refresh" onClick={incidents.reload}>
                  Retry
                </Button>
              }
            >
              {incidents.error.message} Hazard markers on this map may be missing or out of date.
            </Callout>
          ) : null}
        </div>
      ) : null}

      {/* ======================================================= MAP + RAIL === */}
      <div
        className={[
          'grid min-h-0 shrink-0 gap-3 p-3',
          'grid-cols-1 lg:grid-cols-[minmax(0,1fr)_340px] 2xl:grid-cols-[minmax(0,1fr)_392px]',
          'h-[min(720px,calc(100vh-300px))] min-h-[520px]',
        ].join(' ')}
      >
        <PanelFrame
          variant="bare"
          className="min-h-0 border border-line shadow-panel"
          flushBody
          header={
            <PanelHeader
              title="Guwahati → Tawang corridor"
              subtitle="Fleet positions, assigned route and reported hazards"
              icon="liveMap"
              badge={
                <Chip tone="neutral" size="sm">
                  {fleet.length} vehicles
                </Chip>
              }
              actions={
                <div className="flex items-center gap-2">
                  {canReport ? <ReportIncidentButton report={report} /> : null}
                  <ProvenanceTag kind="SYNTHETIC_OPERATIONAL" />
                </div>
              }
            />
          }
        >
          {loading ? (
            <SkeletonPane className="m-3" />
          ) : (
            <MapCanvas
              routes={mapRoutes}
              vehicles={fleet}
              incidents={incidents.data?.incidents ?? []}
              pick={report.pick}
              warehouses={warehouses.data?.warehouses ?? []}
              riskZones={riskZones}
              places={places}
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
              selectedVehicleId={selected?.id}
              onSelectVehicle={(v) => onSelect(v.id)}
              onSelectRoute={(r) => navigate(`/routes?route=${r.id}`)}
              fitTo={assigned?.geometry}
              showLayerPanel
              showLegend
              legendDefaultOpen={false}
            />
          )}
        </PanelFrame>

        {/* --- Movement rail ------------------------------------------------ */}
        <div className="flex min-h-0 flex-col gap-3">
          {/* Selected movement */}
          <PanelFrame
            className="min-h-0 shrink-0"
            header={
              <PanelHeader
                title={selected ? selected.code : 'Movement'}
                subtitle={selected?.driverName}
                icon="vehicle"
                badge={
                  selected ? (
                    <StatusDot
                      level={vehicleToneLevel(
                        selected.speedKmh,
                        selected.expectedSpeedKmh,
                        selected.status === 'STOPPED',
                      )}
                      pulse={selected.status === 'IN_TRANSIT'}
                      size="sm"
                      label={humanizeEnum(selected.status)}
                    />
                  ) : undefined
                }
              />
            }
          >
            {loading || !selected ? (
              <SkeletonRows rows={4} />
            ) : (
              <div className="flex flex-col gap-3">
                <div className="flex flex-col divide-y divide-line-soft">
                  <StatRow
                    label="Delivery"
                    icon="deliveries"
                    emphasis
                    value={
                      selectedDelivery ? (
                        <button
                          type="button"
                          onClick={() => navigate(`/deliveries/${selectedDelivery.code}`)}
                          className="font-semibold text-brand-700 underline-offset-2 hover:underline"
                        >
                          {selectedDelivery.code}
                        </button>
                      ) : (
                        <span className="text-ink-3">Unassigned</span>
                      )
                    }
                  />
                  {selectedDelivery ? (
                    <StatRow
                      label="Destination"
                      icon="hospital"
                      value={selectedDelivery.destName ?? '—'}
                    />
                  ) : null}
                  <StatRow
                    label="Near"
                    icon="destination"
                    value={
                      nearestPlace
                        ? `${nearestPlace.name} · ${formatDistance(nearestPlace.km)}`
                        : '—'
                    }
                  />
                  <StatRow
                    label="Speed"
                    icon="live"
                    value={
                      <span
                        className={
                          selected.anomaly ? 'font-semibold text-risk-high' : undefined
                        }
                      >
                        {selected.speedKmh} km/h
                        <span className="ml-1.5 text-meta font-normal text-ink-3">
                          exp. {selected.expectedSpeedKmh}
                        </span>
                      </span>
                    }
                  />
                  {selectedDelivery ? (
                    <StatRow
                      label="ETA"
                      icon="prediction"
                      value={formatTime(selectedDelivery.currentEta)}
                    />
                  ) : null}
                  {assigned ? (
                    <StatRow
                      label="Route risk"
                      icon="routes"
                      emphasis
                      value={
                        <button
                          type="button"
                          onClick={() => navigate(`/routes?route=${assigned.id}`)}
                          className={cn(
                            'font-semibold underline-offset-2 hover:underline',
                            RISK_TONE[assigned.riskLevel].text,
                          )}
                        >
                          {assigned.riskScore}% · {assigned.riskLevel}
                        </button>
                      }
                    />
                  ) : null}
                  {selectedDelivery ? (
                    <StatRow
                      label="Delivery status"
                      icon="deliveries"
                      value={<DeliveryStatusChip status={selectedDelivery.status} />}
                    />
                  ) : null}
                </div>

                {/* GPS anomaly — only when the rule has actually fired. */}
                {selected.anomaly ? (
                  <div className="rounded-panel border border-risk-high/25 bg-risk-wash-high px-3 py-2.5">
                    <div className="mb-1 flex items-center gap-1.5">
                      <Icon name="warning" size="sm" className="text-risk-high" />
                      <span className="text-[11px] font-bold uppercase tracking-[0.05em] text-risk-high">
                        GPS anomaly
                      </span>
                      <Chip tone="outline" size="sm" className="ml-auto">
                        {selected.anomaly.severity}
                      </Chip>
                    </div>
                    <p className="text-meta leading-snug text-ink-2">{selected.anomaly.reason}</p>
                    <dl className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-[10.5px] text-ink-2">
                      <span>
                        <span className="text-ink-3">Observed </span>
                        <span className="tnum font-semibold">
                          {Math.round(selected.anomaly.speedRatio * 100)}% of expected
                        </span>
                      </span>
                      {selected.anomaly.deviationKm !== undefined ? (
                        <span>
                          <span className="text-ink-3">From corridor </span>
                          <span className="tnum font-semibold">
                            {formatDistance(selected.anomaly.deviationKm)}
                          </span>
                        </span>
                      ) : null}
                    </dl>
                    <p className="mt-1.5 text-[10px] leading-snug text-ink-3">
                      Rule: sustained speed below 40% of expected. Recommended response — contact
                      the driver and confirm the corridor is passable.
                    </p>
                  </div>
                ) : null}

                <div className="flex items-center gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    icon="routes"
                    onClick={() => navigate(assigned ? `/routes?route=${assigned.id}` : '/routes')}
                  >
                    Route analysis
                  </Button>
                  {selectedDelivery ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      iconRight="arrowRight"
                      onClick={() => navigate(`/deliveries/${selectedDelivery.code}`)}
                    >
                      Delivery
                    </Button>
                  ) : null}
                </div>
              </div>
            )}
          </PanelFrame>

          {/* Fleet list */}
          <PanelFrame
            className="min-h-0 flex-1"
            flushBody
            scroll
            header={
              <PanelHeader
                title="Movements"
                icon="live"
                badge={
                  anomalies.length > 0 ? (
                    <Chip tone="neutral" size="sm" className="bg-risk-wash-high text-risk-high">
                      {anomalies.length} flagged
                    </Chip>
                  ) : undefined
                }
              />
            }
          >
            <Async state={vehicles} skeleton={<SkeletonRows rows={6} />}>
              {() => (
                <ul className="flex flex-col">
                  {/* Flagged vehicles first — this rail is a worklist, not a roster. */}
                  {[...fleet]
                    .sort(
                      (a, b) =>
                        Number(Boolean(b.anomaly)) - Number(Boolean(a.anomaly)) ||
                        Number(b.status === 'IN_TRANSIT') - Number(a.status === 'IN_TRANSIT') ||
                        a.code.localeCompare(b.code),
                    )
                    .map((v) => (
                      <FleetRow
                        key={v.id}
                        vehicle={v}
                        active={v.id === selected?.id}
                        onSelect={() => onSelect(v.id)}
                      />
                    ))}
                </ul>
              )}
            </Async>
          </PanelFrame>
        </div>
      </div>

      <div className="flex shrink-0 items-center justify-between gap-3 px-4 pb-3">
        <p className="text-[10px] leading-relaxed text-ink-3">
          Positions are seeded demonstration records, not GPS telemetry — live movement arrives
          with the Socket.IO feed at backend integration. The anomaly rule shown is the
          contract&rsquo;s own: sustained speed below 40% of expected.
        </p>
        <span className="tnum shrink-0 text-[10px] text-ink-3">
          Snapshot {formatTime(new Date(appNow()).toISOString())}
        </span>
      </div>
      {report.dialog}
    </div>
  );
}

function FleetRow({
  vehicle,
  active,
  onSelect,
}: {
  vehicle: Vehicle;
  active: boolean;
  onSelect: () => void;
}) {
  const level = vehicleToneLevel(
    vehicle.speedKmh,
    vehicle.expectedSpeedKmh,
    vehicle.status === 'STOPPED',
  );

  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={active}
        className={cn(
          'flex w-full items-center gap-2.5 border-b border-line-soft px-3 py-2 text-left',
          'transition-colors duration-100 ease-ui last:border-b-0 hover:bg-panel-alt',
          active && 'bg-brand-50 hover:bg-brand-50',
        )}
      >
        <StatusDot level={level} pulse={vehicle.status === 'IN_TRANSIT'} size="sm" />
        <span className="tnum w-[52px] shrink-0 text-body font-semibold text-ink">
          {vehicle.code}
        </span>
        <span className="min-w-0 flex-1 truncate text-meta text-ink-2">{vehicle.driverName}</span>
        {vehicle.anomaly ? (
          <Icon name="warning" size="sm" className="shrink-0 text-risk-high" label="GPS anomaly" />
        ) : null}
        <span className="tnum shrink-0 text-meta text-ink-3">{vehicle.speedKmh} km/h</span>
      </button>
    </li>
  );
}
