/**
 * MapCanvas — the reusable map foundation.
 *
 * One component serves four pages with four different compositions:
 *
 *   Command Center     corridor + routes + vehicles + incidents, callouts on, compact controls
 *   Live Logistics Map full-bleed, every layer, floating layer panel
 *   Route Intelligence three route ribbons with callouts, no vehicles
 *   Incident Center    a single incident with its affected segment highlighted
 *
 * Layers are declarative props rather than children, so a page describes what it wants on the
 * map instead of assembling Leaflet primitives — and so the layer set can be toggled from a
 * floating panel without every page reimplementing the toggling.
 *
 * The overlay chrome (controls, legend, layer panel) is rendered as siblings of the Leaflet
 * container at a higher z-index, never as Leaflet controls: Leaflet's own control DOM cannot be
 * styled to this standard, and its z-index behaviour fights modals.
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  CircleMarker,
  MapContainer,
  Marker,
  Polyline,
  Popup,
  TileLayer,
  useMap,
  useMapEvents,
} from 'react-leaflet';
import type { Map as LeafletMap } from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { cn } from '@/lib/cn';
import { formatDuration } from '@/domain/format';
import {
  CORRIDOR_BOUNDS,
  CORRIDOR_CENTER,
  CORRIDOR_ZOOM,
  bearingAlongPath,
  pathMidpoint,
  pointAlongPath,
  type LatLng,
} from '@/domain/geo';
import { RISK_TONE, riskLevelForScore, vehicleToneLevel } from '@/domain/thresholds';
import type { Incident, RiskLevel, Vehicle, Warehouse } from '@/domain/types';
import { Icon, IconButton, Legend, SegmentedControl, type LegendItem } from '@/design/primitives';
import {
  BASEMAPS,
  BASEMAP_OPTIONS,
  DEFAULT_BASEMAP,
  MAP_LAYERS,
  type BasemapId,
  type MapLayerId,
} from './basemaps';
import {
  facilityIcon,
  incidentIcon,
  pickIcon,
  placeLabelIcon,
  routeCalloutIcon,
  routeStyle,
  vehicleIcon,
  type RouteKey,
} from './markers';

// ---------------------------------------------------------------------------
// Layer descriptions — what a page hands to the map
// ---------------------------------------------------------------------------

export interface MapRoute {
  id: string;
  key: RouteKey;
  name: string;
  geometry: LatLng[];
  riskScore: number;
  etaMinutes: number;
  recommended: boolean;
  /** Draws the callout chip on the route. */
  showCallout?: boolean;
  /**
   * Where along the route (0-1) the callout is anchored. Candidate routes are near-parallel by
   * construction, so anchoring every one at its midpoint stacks all three chips on top of each
   * other; MapCanvas spreads them by index unless a page pins one deliberately.
   */
  calloutAt?: number;
  /** Animates the dash — for a route that has just been recalculated. */
  flowing?: boolean;
  /** The route currently open in the intelligence panel. */
  selected?: boolean;
}

export interface MapRiskZone {
  id: string;
  center: LatLng;
  radiusM: number;
  level: RiskLevel;
  label: string;
}

export interface MapPlace {
  name: string;
  position: LatLng;
}

export interface MapCanvasProps {
  center?: LatLng;
  zoom?: number;
  /** Fits these bounds on mount instead of using center/zoom. */
  fitTo?: LatLng[];
  /** Ceiling for the fit, so a tight cluster does not zoom past usable imagery. */
  fitMaxZoom?: number;

  routes?: MapRoute[];
  vehicles?: Vehicle[];
  incidents?: Incident[];
  warehouses?: Warehouse[];
  destinations?: { id: string; name: string; position: LatLng }[];
  origins?: { id: string; name: string; position: LatLng }[];
  riskZones?: MapRiskZone[];
  places?: MapPlace[];

  /** Which layers render. Omit for "everything that was passed". */
  layers?: Partial<Record<MapLayerId, boolean>>;
  /** Shows the floating layer-toggle panel. */
  showLayerPanel?: boolean;
  /** Shows the basemap switch. */
  showBasemapSwitch?: boolean;
  showLegend?: boolean;
  /** Start expanded. Off where the map shares the screen with other panels. */
  legendDefaultOpen?: boolean;
  legendItems?: LegendItem[];
  /** Arbitrary chrome floated over the map, e.g. a search field or a summary card. */
  overlay?: ReactNode;
  /** Bottom-left slot, e.g. a scale note or provenance tag. */
  footnote?: ReactNode;

  selectedVehicleId?: string;
  onSelectRoute?: (route: MapRoute) => void;
  onSelectVehicle?: (vehicle: Vehicle) => void;
  onSelectIncident?: (incident: Incident) => void;

  /**
   * Location picking. While `active`, a click anywhere on the map calls `onPick` with the
   * clicked [lat, lng] and the cursor becomes a crosshair; `location`, when set, is drawn as a
   * provisional pin whether or not picking is still active, so the user can see what they chose
   * while filling in the rest of the report.
   */
  pick?: {
    active: boolean;
    location?: LatLng;
    onPick: (location: LatLng) => void;
    /** Shown on the map while picking. */
    hint?: string;
  };

  interactive?: boolean;
  className?: string;
}

// ---------------------------------------------------------------------------
// Imperative helpers
// ---------------------------------------------------------------------------

/**
 * Where a route's callout chip sits.
 *
 * Candidate routes share both endpoints and run near-parallel, so their midpoints land within a
 * few dozen pixels of each other and the chips pile up. Spreading the anchors across the middle
 * 60% of each route separates them without pushing any chip off the visible corridor.
 */
function calloutAnchor(route: MapRoute, index: number, total: number): LatLng {
  if (route.calloutAt !== undefined) return pointAlongPath(route.geometry, route.calloutAt);
  if (total <= 1) return pathMidpoint(route.geometry);
  const spread = 0.3 + (index / (total - 1)) * 0.4; // 0.30 → 0.70
  return pointAlongPath(route.geometry, spread);
}

/**
 * Fits the map to a set of points once, after mount.
 *
 *  is capped: a tight cluster — an incident and the two ends of its segment — would
 * otherwise zoom past the level where satellite imagery over the high passes still has detail,
 * leaving a blurry field with two enormous route ribbons across it.
 */
function FitBounds({ points, maxZoom = 11 }: { points: LatLng[]; maxZoom?: number }) {
  const map = useMap();
  // The extent, rounded to ~100 m, identifies WHAT is being framed. Refitting on this key rather
  // than on the array means a new selection moves the map, while an app-wide refetch that
  // returns the same geometry (a fresh array, identical content) leaves the operator's own pan
  // and zoom alone.
  //
  // This used to fit exactly once and ignore every later change, so selecting Route B or C
  // could never move the viewport — whatever a page asked for, the map stayed where it began.
  const key = useMemo(() => {
    if (points.length === 0) return '';
    let s = 90, w = 180, n = -90, e = -180;
    for (const [lat, lng] of points) {
      if (lat < s) s = lat;
      if (lat > n) n = lat;
      if (lng < w) w = lng;
      if (lng > e) e = lng;
    }
    return [s, w, n, e].map((v) => v.toFixed(3)).join(',');
  }, [points]);
  const pointsRef = useRef(points);
  pointsRef.current = points;

  useEffect(() => {
    if (!key) return;
    // Not animated, deliberately. While a Leaflet zoom animation is running, a second animated
    // `fitBounds` is dropped (`_tryAnimatedZoom` returns early), so clicking B then C quickly
    // left the map framed on B with C selected. The animation also never runs in a hidden tab.
    // Snapping always lands on the route that is selected now.
    map.stop();
    map.fitBounds(pointsRef.current as [number, number][], { padding: [42, 42], maxZoom, animate: false });
  }, [map, key, maxZoom]);
  return null;
}

/**
 * Makes wheel zoom opt-in.
 *
 * Click the map and the wheel zooms it; move the pointer away and the wheel scrolls the page
 * again. This is the behaviour every embedded map needs and Leaflet does not provide: without
 * it, scrolling a page that contains a map is a coin toss.
 *
 * `onArmedChange` lets the canvas show a hint, so the rule is discoverable rather than folklore.
 */
function WheelZoomOnFocus({
  enabled,
  onArmedChange,
}: {
  enabled: boolean;
  onArmedChange: (armed: boolean) => void;
}) {
  const map = useMap();

  useEffect(() => {
    if (!enabled) return;
    const container = map.getContainer();

    const arm = () => {
      map.scrollWheelZoom.enable();
      onArmedChange(true);
    };
    const disarm = () => {
      map.scrollWheelZoom.disable();
      onArmedChange(false);
    };

    container.addEventListener('mousedown', arm);
    container.addEventListener('mouseleave', disarm);
    return () => {
      container.removeEventListener('mousedown', arm);
      container.removeEventListener('mouseleave', disarm);
      map.scrollWheelZoom.disable();
    };
  }, [map, enabled, onArmedChange]);

  return null;
}

/**
 * Turns map clicks into picked locations while picking is active.
 *
 * Leaflet reports the click in geographic coordinates already, so there is no pixel maths here —
 * `e.latlng` IS the point under the cursor at the current zoom and projection. Rounded to five
 * decimal places (~1 m): more precision than that is noise from the pointer, and a stable value
 * keeps a picked point identical between the pin, the form and the stored incident.
 */
function PickOnClick({ onPick }: { onPick: (location: LatLng) => void }) {
  useMapEvents({
    click(e) {
      onPick([Number(e.latlng.lat.toFixed(5)), Number(e.latlng.lng.toFixed(5))]);
    },
  });
  return null;
}

/** Exposes the Leaflet instance so the overlay controls can drive zoom without Leaflet's own UI. */
function CaptureMap({ onReady }: { onReady: (map: LeafletMap) => void }) {
  const map = useMap();

  useEffect(() => {
    onReady(map);

    // Leaflet mis-measures its container when it mounts inside a flex child that is still
    // settling. One invalidateSize after paint fixes the grey-band-on-the-right symptom.
    const t = setTimeout(() => map.invalidateSize(), 60);

    // And it never re-measures on its own when the container changes size. The Command Center's
    // map row is sized from the viewport height, so a window resize — or a projector at a
    // different resolution — leaves half the tiles unrendered until something else forces a
    // redraw. Observing the container closes that off.
    const container = map.getContainer();
    const observer = new ResizeObserver(() => map.invalidateSize({ animate: false }));
    observer.observe(container);

    return () => {
      clearTimeout(t);
      observer.disconnect();
    };
  }, [map, onReady]);

  return null;
}

// ---------------------------------------------------------------------------
// MapCanvas
// ---------------------------------------------------------------------------

export function MapCanvas({
  center = CORRIDOR_CENTER,
  zoom = CORRIDOR_ZOOM,
  fitTo,
  fitMaxZoom,
  routes = [],
  vehicles = [],
  incidents = [],
  warehouses = [],
  destinations = [],
  origins = [],
  riskZones = [],
  places = [],
  layers,
  showLayerPanel = false,
  showBasemapSwitch = true,
  showLegend = false,
  legendDefaultOpen = true,
  legendItems,
  overlay,
  footnote,
  selectedVehicleId,
  onSelectRoute: onSelectRouteProp,
  onSelectVehicle: onSelectVehicleProp,
  onSelectIncident: onSelectIncidentProp,
  pick,
  interactive = true,
  className,
}: MapCanvasProps) {
  const [basemap, setBasemap] = useState<BasemapId>(DEFAULT_BASEMAP);
  const [panelOpen, setPanelOpen] = useState(false);
  const [legendOpen, setLegendOpen] = useState(legendDefaultOpen);
  const [wheelArmed, setWheelArmed] = useState(false);
  const [visible, setVisible] = useState<Record<MapLayerId, boolean>>({
    routes: layers?.routes ?? true,
    vehicles: layers?.vehicles ?? true,
    incidents: layers?.incidents ?? true,
    riskZones: layers?.riskZones ?? true,
    facilities: layers?.facilities ?? true,
    weather: layers?.weather ?? false,
  });
  const mapRef = useRef<LeafletMap | null>(null);
  // One icon instance: a fresh one per render would make react-leaflet swap the marker's DOM
  // on every re-render of the page around it.
  const pinIcon = useMemo(() => pickIcon(), []);

  // Paint order decides both what is seen and what is clicked: Leaflet stacks later layers on
  // top, and the three candidates share Guwahati and Tawang, so wherever they overlap the
  // last-drawn line both covers the others and catches the click. Routes used to be drawn in
  // list order, so Route C always won — a selected A or B sat underneath C, and a click near the
  // shared ends selected C whichever line the operator aimed at. The selected route now paints
  // last, the recommendation just below it.
  const anySelected = routes.some((r) => r.selected);
  const drawOrder = useMemo(
    () =>
      [...routes].sort(
        (a, b) => Number(a.selected) - Number(b.selected) || Number(a.recommended) - Number(b.recommended),
      ),
    [routes],
  );

  // While picking, every click belongs to the pick. A route line is clickable and navigates to
  // Route Intelligence, so a pick that landed on the corridor — the most likely place for a road
  // incident — would leave the page instead of placing the pin. The selection handlers stand
  // down until picking ends; markers still render, they just stop being buttons.
  const picking = Boolean(pick?.active);
  const onSelectRoute = picking ? undefined : onSelectRouteProp;
  const onSelectVehicle = picking ? undefined : onSelectVehicleProp;
  const onSelectIncident = picking ? undefined : onSelectIncidentProp;

  const base = BASEMAPS[basemap];
  const onDark = base.overlayTheme === 'onDark';

  const defaultLegend = useMemo<LegendItem[]>(
    () => [
      { label: 'Recommended route', color: 'rgb(var(--route-b))', style: 'solid' },
      { label: 'High-risk route', color: 'rgb(var(--route-a))', style: 'dashed' },
      { label: 'Alternative', color: 'rgb(var(--route-c))', style: 'dashed' },
      { label: 'Vehicle', color: 'rgb(var(--risk-low))', style: 'dot' },
      { label: 'Incident', color: 'rgb(var(--risk-critical))', style: 'dot' },
      { label: 'Warehouse', color: 'rgb(var(--brand-900))', style: 'dot' },
    ],
    [],
  );

  return (
    <div
      className={cn(
        'relative isolate h-full min-h-0 w-full overflow-hidden',
        pick?.active && 'map-picking',
        className,
      )}
    >
      <MapContainer
        center={center}
        zoom={zoom}
        minZoom={6}
        maxZoom={base.maxZoom}
        // Quarter-step zoom so `fitBounds` can frame a single route tightly. With whole steps a
        // route on a wide, short panel is framed at the next zoom down and fills ~40% of it.
        zoomSnap={0.25}
        maxBounds={CORRIDOR_BOUNDS}
        maxBoundsViscosity={0.6}
        zoomControl={false}
        attributionControl
        dragging={interactive}
        // Wheel zoom is OFF until the map is clicked. These maps live inside pages that scroll,
        // and a map that grabs the wheel means an operator scrolling past it silently zooms out
        // to Nepal instead of reaching the panel below. `WheelZoomOnFocus` enables it once the
        // map has been clicked and releases it when the pointer leaves.
        scrollWheelZoom={false}
        doubleClickZoom={interactive}
        className={cn('h-full w-full', base.className)}
      >
        <CaptureMap onReady={(m) => (mapRef.current = m)} />
        <WheelZoomOnFocus enabled={interactive} onArmedChange={setWheelArmed} />
        {pick?.active ? <PickOnClick onPick={pick.onPick} /> : null}
        {fitTo && fitTo.length > 0 ? <FitBounds points={fitTo} maxZoom={fitMaxZoom} /> : null}

        <TileLayer url={base.url} attribution={base.attribution} maxZoom={base.maxZoom} />
        {base.labelsUrl ? <TileLayer url={base.labelsUrl} maxZoom={base.maxZoom} /> : null}

        {/* --- Risk zones. Drawn first so everything else sits above them. ---------- */}
        {visible.riskZones
          ? riskZones.map((z) => {
              const tone = RISK_TONE[z.level];
              return (
                <CircleMarker
                  key={z.id}
                  center={z.center}
                  radius={Math.max(14, z.radiusM / 900)}
                  pathOptions={{
                    color: tone.cssVar,
                    fillColor: tone.cssVar,
                    fillOpacity: 0.16,
                    weight: 1.5,
                    opacity: 0.55,
                  }}
                >
                  <Popup>
                    <MapPopup title={z.label} rows={[['Zone risk', z.level]]} />
                  </Popup>
                </CircleMarker>
              );
            })
          : null}

        {/* --- Routes: casing, then core. ------------------------------------------ */}
        {visible.routes
          ? drawOrder.map((r) => {
              const style = routeStyle(r.key, r.recommended, r.selected, anySelected && !r.selected);
              const handlers = onSelectRoute ? { click: () => onSelectRoute(r) } : undefined;
              return (
                // Keyed on selection as well as id. react-leaflet never re-orders layers that are
                // already on the map — sorting the JSX alone changed nothing in the SVG, and the
                // browser check caught Route A still painted on top with B selected. Remounting a
                // route when its selection flips re-adds its layers, and because the selected
                // route renders last it is added last, so it lands on top.
                <div key={`${r.id}:${r.selected ? 'selected' : 'idle'}`}>
                  <Polyline positions={r.geometry} pathOptions={style.casing} />
                  <Polyline
                    positions={r.geometry}
                    pathOptions={style.core}
                    className={r.flowing ? 'route-flow' : undefined}
                  />
                  {/* A wide transparent line on top, so the route is clickable without
                      pixel-hunting a 3.5px stroke. */}
                  {onSelectRoute ? (
                    <Polyline
                      positions={r.geometry}
                      pathOptions={style.hit}
                      interactive
                      eventHandlers={handlers}
                    />
                  ) : null}
                </div>
              );
            })
          : null}

        {/* --- Route callouts ------------------------------------------------------- */}
        {visible.routes
          ? routes
              .filter((r) => r.showCallout)
              .map((r, i, shown) => (
                <Marker
                  key={`${r.id}-callout`}
                  position={calloutAnchor(r, i, shown.length)}
                  icon={routeCalloutIcon({
                    title: r.name,
                    riskScore: r.riskScore,
                    etaLabel: formatDuration(r.etaMinutes),
                    level: riskLevelForScore(r.riskScore),
                    recommended: r.recommended,
                    selected: r.selected,
                    // 50px apart vertically — just clear of the 44px chip height — and spread
                    // symmetrically around the anchor rather than stacked upward, so the top
                    // chip is not pushed off the canvas when the map panel is short.
                    offsetY: 52 + (i - (shown.length - 1) / 2) * 50,
                  })}
                  interactive={Boolean(onSelectRoute)}
                  eventHandlers={onSelectRoute ? { click: () => onSelectRoute(r) } : undefined}
                  // The chips are how a route is chosen from the map, so every chip stacks above
                  // the point markers (vehicles, depots, incidents), and the selected route's chip
                  // above the others where they overlap. With no offset an unselected chip sank
                  // under whatever vehicle sat beside the corridor and the click went to the
                  // vehicle. The pick pin (2000) still stays on top of everything.
                  zIndexOffset={r.selected ? 1500 : 1000}
                />
              ))
          : null}

        {/* --- Facilities ----------------------------------------------------------- */}
        {visible.facilities ? (
          <>
            {warehouses.map((w) => (
              <Marker key={w.id} position={[w.lat, w.lng]} icon={facilityIcon('warehouse')}>
                <Popup>
                  <MapPopup title={w.name} eyebrow="Warehouse" rows={[]} />
                </Popup>
              </Marker>
            ))}
            {origins.map((o) => (
              <Marker key={o.id} position={o.position} icon={facilityIcon('origin')}>
                <Popup>
                  <MapPopup title={o.name} eyebrow="Origin" rows={[]} />
                </Popup>
              </Marker>
            ))}
            {destinations.map((d) => (
              <Marker key={d.id} position={d.position} icon={facilityIcon('hospital')}>
                <Popup>
                  <MapPopup title={d.name} eyebrow="Destination" rows={[]} />
                </Popup>
              </Marker>
            ))}
          </>
        ) : null}

        {/* --- Incidents ------------------------------------------------------------ */}
        {visible.incidents
          ? incidents.map((i) => (
              <Marker
                key={i.id}
                position={[i.lat, i.lng]}
                icon={incidentIcon(i.severity, i.severity === 'CRITICAL')}
                eventHandlers={
                  onSelectIncident ? { click: () => onSelectIncident(i) } : undefined
                }
              >
                <Popup>
                  <MapPopup
                    eyebrow="Incident"
                    title={i.type.replace('_', ' ')}
                    rows={[
                      ['Severity', i.severity],
                      ['Detected', i.cvDetectedClass ?? '—'],
                      [
                        'Confidence',
                        i.cvConfidence !== undefined ? `${Math.round(i.cvConfidence * 100)}%` : '—',
                      ],
                      ['Blockage', i.cvEstimatedBlockage ?? '—'],
                    ]}
                  />
                </Popup>
              </Marker>
            ))
          : null}

        {/* --- Picked location ------------------------------------------------------- */}
        {/* Provisional: a report has not been filed yet. It is non-interactive so a second
            click lands on the map (re-picking) rather than on the pin. */}
        {pick?.location ? (
          <Marker
            position={pick.location}
            icon={pinIcon}
            interactive={false}
            keyboard={false}
            zIndexOffset={2000}
          />
        ) : null}

        {/* --- Vehicles ------------------------------------------------------------- */}
        {visible.vehicles
          ? vehicles.map((v) => {
              const level = vehicleToneLevel(v.speedKmh, v.expectedSpeedKmh, v.status === 'STOPPED');
              const route = routes.find((r) => r.recommended) ?? routes[0];
              const bearing = route ? bearingAlongPath(route.geometry, 0.5) : 0;
              return (
                <Marker
                  key={v.id}
                  position={[v.currentLat, v.currentLng]}
                  icon={vehicleIcon(level, bearing, v.id === selectedVehicleId)}
                  eventHandlers={onSelectVehicle ? { click: () => onSelectVehicle(v) } : undefined}
                >
                  <Popup>
                    <MapPopup
                      eyebrow="Vehicle"
                      title={v.code}
                      rows={[
                        ['Driver', v.driverName],
                        ['Speed', `${v.speedKmh} km/h`],
                        ['Expected', `${v.expectedSpeedKmh} km/h`],
                        ['Status', v.status.replace('_', ' ')],
                      ]}
                    />
                  </Popup>
                </Marker>
              );
            })
          : null}

        {/* --- Place labels --------------------------------------------------------- */}
        {places.map((p) => (
          <Marker
            key={p.name}
            position={p.position}
            icon={placeLabelIcon(p.name)}
            interactive={false}
          />
        ))}
      </MapContainer>

      {/* ------------------------------------------------------------------------- */}
      {/* Overlay chrome. Siblings of the Leaflet container, above it in z-order.     */}
      {/* ------------------------------------------------------------------------- */}

      <div className="pointer-events-none absolute inset-0 z-[5]">
        {/* Top-left: layer panel */}
        {showLayerPanel ? (
          <div className="pointer-events-auto absolute left-3 top-3">
            <LayerPanel
              open={panelOpen}
              onToggle={() => setPanelOpen((v) => !v)}
              visible={visible}
              onChange={(id, on) => setVisible((prev) => ({ ...prev, [id]: on }))}
            />
          </div>
        ) : null}

        {/* Top-right: basemap switch + zoom */}
        <div className="pointer-events-auto absolute right-3 top-3 flex flex-col items-end gap-2">
          {showBasemapSwitch ? (
            <div className="rounded-control bg-panel/92 p-0.5 shadow-float backdrop-blur-md">
              <SegmentedControl
                options={BASEMAP_OPTIONS}
                value={basemap}
                onChange={setBasemap}
                size="sm"
              />
            </div>
          ) : null}

          <div className="flex flex-col overflow-hidden rounded-control border border-white/60 bg-panel/92 shadow-float backdrop-blur-md">
            <button
              type="button"
              aria-label="Zoom in"
              onClick={() => mapRef.current?.zoomIn()}
              className="flex h-8 w-8 items-center justify-center border-b border-line-soft text-ink-2 transition-colors hover:bg-panel-alt hover:text-ink"
            >
              <Icon name="add" size="md" />
            </button>
            <button
              type="button"
              aria-label="Zoom out"
              onClick={() => mapRef.current?.zoomOut()}
              className="flex h-8 w-8 items-center justify-center border-b border-line-soft text-ink-2 transition-colors hover:bg-panel-alt hover:text-ink"
            >
              <span className="text-[15px] leading-none">−</span>
            </button>
            <button
              type="button"
              aria-label="Reset view"
              onClick={() => mapRef.current?.setView(center, zoom)}
              className="flex h-8 w-8 items-center justify-center text-ink-2 transition-colors hover:bg-panel-alt hover:text-ink"
            >
              <Icon name="locate" size="md" />
            </button>
          </div>
        </div>

        {/* Bottom-left: legend + footnote */}
        {showLegend || footnote ? (
          <div className="pointer-events-auto absolute bottom-3 left-3 flex flex-col gap-2">
            {showLegend ? (
              legendOpen ? (
                <div className="rounded-panel border border-white/60 bg-panel/92 px-3 py-2.5 shadow-float backdrop-blur-md">
                  <div className="mb-1.5 flex items-center gap-2">
                    <span className="t-label">Legend</span>
                    <button
                      type="button"
                      onClick={() => setLegendOpen(false)}
                      aria-label="Hide legend"
                      className="ml-auto text-ink-3 transition-colors hover:text-ink"
                    >
                      <Icon name="close" size="sm" />
                    </button>
                  </div>
                  <Legend items={legendItems ?? defaultLegend} direction="column" />
                </div>
              ) : (
                <IconButton
                  name="info"
                  label="Show legend"
                  variant="float"
                  size="lg"
                  onClick={() => setLegendOpen(true)}
                />
              )
            ) : null}
            {footnote ? (
              <div className="rounded-chip bg-panel/92 px-2 py-1 shadow-float backdrop-blur-md">
                {footnote}
              </div>
            ) : null}
          </div>
        ) : null}

        {/* Wheel-zoom state, so the interaction is discoverable. Only shown once the map is
            armed — an unarmed map behaves exactly as a reader expects and needs no explanation. */}
        {interactive && wheelArmed ? (
          <div className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2">
            <span className="flex items-center gap-1.5 rounded-chip bg-ink/80 px-2 py-1 text-[10px] font-medium text-white backdrop-blur-sm">
              <Icon name="locate" size="sm" />
              Scroll to zoom · move away to scroll the page
            </span>
          </div>
        ) : null}

        {pick?.active ? (
          <div className="pointer-events-none absolute left-1/2 top-3 z-[500] -translate-x-1/2">
            <span
              role="status"
              className="flex items-center gap-1.5 rounded-chip bg-brand-700/90 px-2.5 py-1.5 text-[11px] font-semibold text-white shadow-float backdrop-blur-sm"
            >
              <Icon name="locate" size="sm" />
              {pick.hint ?? 'Click the map to choose a location'}
            </span>
          </div>
        ) : null}

        {overlay ? <div className="pointer-events-auto absolute inset-0">{overlay}</div> : null}
      </div>

      {/* A hairline vignette: stops satellite imagery from bleeding into the panel edge. */}
      <div
        className={cn(
          'pointer-events-none absolute inset-0 z-[6]',
          onDark ? 'shadow-[inset_0_0_0_1px_rgb(14_27_42/0.10)]' : '',
        )}
        aria-hidden
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Popup content
// ---------------------------------------------------------------------------

function MapPopup({
  eyebrow,
  title,
  rows,
}: {
  eyebrow?: string;
  title: string;
  rows: [string, string][];
}) {
  return (
    <div className="min-w-[168px] p-3">
      {eyebrow ? <p className="t-label mb-0.5">{eyebrow}</p> : null}
      <p className="mb-2 text-body font-semibold capitalize text-ink">{title.toLowerCase()}</p>
      {rows.length > 0 ? (
        <dl className="flex flex-col gap-1">
          {rows.map(([k, v]) => (
            <div key={k} className="flex items-baseline justify-between gap-3">
              <dt className="text-meta text-ink-3">{k}</dt>
              <dd className="tnum text-meta font-semibold capitalize text-ink">{v.toLowerCase()}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// LayerPanel
// ---------------------------------------------------------------------------

function LayerPanel({
  open,
  onToggle,
  visible,
  onChange,
}: {
  open: boolean;
  onToggle: () => void;
  visible: Record<MapLayerId, boolean>;
  onChange: (id: MapLayerId, on: boolean) => void;
}) {
  if (!open) {
    return <IconButton name="layers" label="Show map layers" variant="float" size="lg" onClick={onToggle} />;
  }

  return (
    <div className="w-[178px] overflow-hidden rounded-panel border border-white/60 bg-panel/94 shadow-float backdrop-blur-md">
      <div className="flex items-center gap-2 border-b border-line-soft px-2.5 py-2">
        <Icon name="layers" size="sm" className="text-ink-3" />
        <span className="t-label">Layers</span>
        <button
          type="button"
          onClick={onToggle}
          aria-label="Hide map layers"
          className="ml-auto text-ink-3 transition-colors hover:text-ink"
        >
          <Icon name="close" size="sm" />
        </button>
      </div>

      <ul className="p-1">
        {MAP_LAYERS.map((layer) => (
          <li key={layer.id}>
            <label className="flex cursor-pointer items-center gap-2 rounded-[6px] px-1.5 py-1.5 transition-colors hover:bg-panel-alt">
              <input
                type="checkbox"
                checked={visible[layer.id]}
                onChange={(e) => onChange(layer.id, e.target.checked)}
                className="h-3.5 w-3.5 shrink-0 accent-[rgb(18,118,184)]"
              />
              <Icon name={layer.icon} size="sm" className="text-ink-3" />
              <span className="text-meta text-ink-2">{layer.label}</span>
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}
