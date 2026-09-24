/**
 * Route Intelligence — the page that shows the model's reasoning about a corridor.
 *
 * It answers, in reading order:
 *   which routes exist  → the map
 *   how risky is this   → the analysis rail (gauge, conditions, SHAP, narration)
 *   what should we do   → the decision banner
 *   how do they compare → the comparison table
 *   why is it hard      → the elevation profile and the disruption record
 *
 * Architecture: composition and selection state only. Every figure comes through `data/hooks`;
 * nothing is computed in the UI except the drawing scales inside the graphics and the risk
 * delta in the decision banner, which is arithmetic on two values that both arrived from the
 * data source.
 */

import { useCallback, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/app/auth';
import { capabilitiesFor } from '@/app/modules';
import { dataSource } from '@/data';
import {
  useAction,
  useDeliveries,
  useIncidents,
  useRiskSegments,
  useResource,
  useRouteCandidates,
  useWarehouses,
} from '@/data/hooks';
import { formatDistance, formatDuration } from '@/domain/format';
import { CORRIDOR_WAYPOINTS, type LatLng } from '@/domain/geo';
import { severityAsRiskLevel } from '@/domain/thresholds';
import type { RouteCandidate } from '@/domain/types';
import {
  Async,
  Button,
  Chip,
  ErrorState,
  Icon,
  PanelFrame,
  PanelHeader,
  ProvenanceTag,
  SkeletonPane,
  SkeletonRows,
} from '@/design/primitives';
import { MapCanvas, type MapRiskZone, type MapRoute } from '@/map/MapCanvas';
import { HeroBand } from '@/shell/HeroBand';
import { useShellRailNote } from '@/shell/AppShell';
import ridgeline from '@/assets/ner-ridgeline.jpg';
import { ElevationProfile } from '../shared/ElevationProfile';
import { RecommendationBanner } from '../shared/RecommendationBanner';
import { featuredDelivery, shortRouteName } from '../shared/delivery';
import { RouteComparison, RouteStrip } from './RouteComparison';
import { HistoricalContext, RouteRiskAnalysis } from './RouteRiskAnalysis';

const ROUTE_KEYS = ['a', 'b', 'c'] as const;
const LABELLED = [0, 7, 9, 11, 13, 15];

export function RouteIntelligence() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const capabilities = capabilitiesFor(user?.role ?? 'DISTRICT_OFFICER');

  const deliveries = useDeliveries();
  const incidents = useIncidents();
  const segments = useRiskSegments();
  const warehouses = useWarehouses();

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
        : { delivery: undefined, recommendation: undefined },
    [delivery?.id],
  );

  // --- Selection ------------------------------------------------------------
  //
  // Which route is under analysis lives in the URL as `?route=<id>` rather than in component
  // state or a store. Three reasons, in order of weight:
  //   - another page can link straight to a specific route's analysis, which is what makes
  //     "Route analysis" from the Incident Center and Delivery Intelligence land somewhere
  //     useful instead of resetting to the assigned route;
  //   - the browser back button behaves the way the operator expects;
  //   - it needs no global state machinery, which for one string would be all cost.
  // An unrecognised or absent id falls through to the assigned route, then the recommendation,
  // so a stale link degrades instead of breaking.
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedId = searchParams.get('route') ?? undefined;

  const effectiveId =
    (requestedId && routeList.some((r) => r.id === requestedId) && requestedId) ||
    (delivery?.assignedRouteId &&
      routeList.some((r) => r.id === delivery.assignedRouteId) &&
      delivery.assignedRouteId) ||
    routeList.find((r) => r.isRecommended)?.id;

  const selected = routeList.find((r) => r.id === effectiveId);
  const assigned = routeList.find((r) => r.id === delivery?.assignedRouteId);
  const recommended = routeList.find((r) => r.isRecommended);

  const onSelect = useCallback(
    (id: string) => {
      // `replace` so selecting three routes in a row does not bury the previous page under
      // three history entries.
      setSearchParams({ route: id }, { replace: true });
    },
    [setSearchParams],
  );

  // --- The reroute action -------------------------------------------------
  // Calls the typed seam (contract delta D14). In demo mode it genuinely reassigns the
  // delivery and retires the recommendation; there is no fabricated success state.
  // Whether THIS session accepted a reroute. Distinct from "the assigned route happens to be
  // the recommended one", which is simply the healthy baseline and must not be reported as an
  // action the operator took.
  const [rerouteApplied, setRerouteApplied] = useState(false);
  const reroute = useAction(async () => {
    if (!delivery || !recommended) return;
    await dataSource.rerouteDelivery({ deliveryId: delivery.id, routeId: recommended.id });
    onSelect(recommended.id);
    setRerouteApplied(true);
  });

  useShellRailNote(
    selected ? (
      <span className="flex items-center gap-1.5">
        <Icon name="routes" size="sm" className="opacity-60" />
        <span className="hidden lg:inline">Assessing</span>
        <span className="font-semibold text-ink-2">{shortRouteName(selected.name)}</span>
      </span>
    ) : null,
    [selected?.id],
  );

  // --- Map layers ---------------------------------------------------------
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
        flowing: c.riskLevel === 'CRITICAL',
      })),
    [routeList, effectiveId],
  );

  const riskZones = useMemo<MapRiskZone[]>(
    () =>
      (incidents.data?.incidents ?? [])
        .filter((i) => i.type !== 'NORMAL' && i.severity !== 'LOW')
        .slice(0, 4)
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
          label: `${i.type.replace('_', ' ')} · ${i.severity}`,
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

  // Frame the route under analysis, not all three at once. Each candidate now has its own
  // corridor, so selecting B or C moves the map to it; with nothing selected yet, frame all.
  const fitTo = useMemo(
    () => (selected ? selected.geometry : routeList.flatMap((c) => c.geometry)),
    [selected, routeList],
  );
  const loading = deliveries.loading || candidates.loading;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto scroll-thin">
      {/* ============================================================ HERO === */}
      <HeroBand
        image={ridgeline}
        eyebrow="Route Intelligence"
        eyebrowIcon="routes"
        title="Compare routes. Understand risk. Choose the safer corridor."
        subtitle="AI-assisted route risk analysis for emergency logistics across the North Eastern Region."
        credit="Photo: Kingshuk Mondal, CC BY 4.0"
        right={
          delivery ? (
            <div className="flex items-center gap-3">
              <div className="hidden flex-col items-end gap-1 border-r border-white/15 pr-3 xl:flex">
                <span className="text-[10px] uppercase tracking-[0.06em] text-white/55">
                  Analysing for
                </span>
                <span className="text-[13px] font-semibold text-white">{delivery.code}</span>
                <span className="text-[11px] text-white/60">
                  {delivery.originName} → {delivery.destName}
                </span>
              </div>
              <div className="flex flex-col items-end gap-1.5">
                <Chip tone="navy" icon="model" size="sm">
                  {routeList.length} candidates scored
                </Chip>
                <ProvenanceTag kind="ML_PREDICTION" onNavy />
              </div>
            </div>
          ) : null
        }
      />

      {candidates.error ? (
        <div className="p-3">
          <PanelFrame header={<PanelHeader title="Route candidates" icon="routes" />}>
            <ErrorState
              title="Routing service unavailable"
              message={candidates.error.message}
              status={candidates.error.status}
              onRetry={candidates.reload}
            />
          </PanelFrame>
        </div>
      ) : (
        <>
          {/* ================================================ MAP + ANALYSIS === */}
          <div
            className={[
              'grid min-h-0 shrink-0 gap-3 p-3',
              'grid-cols-1 lg:grid-cols-[minmax(0,1fr)_372px] 2xl:grid-cols-[minmax(0,1fr)_412px]',
              'h-[min(560px,calc(100vh-560px))] min-h-[440px]',
            ].join(' ')}
          >
            <PanelFrame
              variant="bare"
              className="min-h-0 border border-line shadow-panel"
              flushBody
              header={
                <PanelHeader
                  title={
                    delivery
                      ? `${delivery.originName} → ${delivery.destName}`
                      : 'Candidate corridors'
                  }
                  subtitle="Three scored candidates over the live corridor"
                  icon="liveMap"
                  badge={
                    selected ? (
                      <Chip tone="neutral" size="sm">
                        {formatDistance(selected.distanceKm)} · {formatDuration(selected.etaMinutes)}
                      </Chip>
                    ) : undefined
                  }
                  actions={<ProvenanceTag kind="EXTERNAL_API" />}
                />
              }
            >
              {loading ? (
                <SkeletonPane className="m-3" />
              ) : (
                <MapCanvas
                  routes={mapRoutes}
                  incidents={incidents.data?.incidents ?? []}
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
                  layers={{ vehicles: false }}
                  fitTo={fitTo}
                  onSelectRoute={(r) => onSelect(r.id)}
                  showLayerPanel
                  showLegend
                  legendDefaultOpen={false}
                />
              )}
            </PanelFrame>

            <PanelFrame
              className="min-h-0"
              scroll
              header={
                <PanelHeader
                  title="Route Risk Analysis"
                  subtitle={selected ? selected.name : undefined}
                  icon="risk"
                  actions={
                    selected && selected.id === assigned?.id ? (
                      <Chip tone="outline" size="sm" icon="vehicle">
                        Current
                      </Chip>
                    ) : selected?.isRecommended ? (
                      <Chip tone="brand" size="sm" icon="ai">
                        Recommended
                      </Chip>
                    ) : undefined
                  }
                />
              }
            >
              {loading || !selected ? (
                <SkeletonRows rows={6} />
              ) : (
                <RouteRiskAnalysis route={selected} segments={segments.data?.segments ?? []} />
              )}
            </PanelFrame>
          </div>

          {/* ======================================================= DECISION === */}
          <div className="shrink-0 px-3 pb-3">
            <RecommendationBanner
              recommendation={detail.data?.recommendation}
              current={assigned ?? selected}
              recommended={recommended}
              layout="banner"
              accepted={rerouteApplied}
              onAccept={capabilities.createDelivery ? reroute.run : undefined}
              accepting={reroute.pending}
              acceptLabel="Reroute delivery"
              secondaryAction={
                delivery ? (
                  <Button
                    variant="secondary"
                    iconRight="arrowRight"
                    onClick={() => navigate(`/deliveries/${delivery.code}`)}
                  >
                    View delivery impact
                  </Button>
                ) : undefined
              }
            />
            {reroute.error ? (
              <p role="alert" className="mt-2 text-meta text-risk-critical">
                {reroute.error.message}
              </p>
            ) : null}
          </div>

          {/* ===================================================== COMPARISON === */}
          <div className="shrink-0 px-3 pb-3">
            <PanelFrame
              flushBody
              header={
                <PanelHeader
                  title="Route Comparison"
                  subtitle="Select a route to analyse it"
                  icon="routes"
                  actions={<ProvenanceTag kind="ML_PREDICTION" />}
                />
              }
            >
              <Async state={candidates} skeleton={<SkeletonRows rows={3} />}>
                {(d) => (
                  <>
                    <RouteComparison
                      className="hidden xl:block"
                      candidates={d.candidates}
                      selectedId={effectiveId}
                      assignedId={delivery?.assignedRouteId}
                      onSelect={onSelect}
                    />
                    <RouteStrip
                      className="p-3 xl:hidden"
                      candidates={d.candidates}
                      selectedId={effectiveId}
                      assignedId={delivery?.assignedRouteId}
                      onSelect={onSelect}
                    />
                  </>
                )}
              </Async>
            </PanelFrame>
          </div>

          {/* ================================================ TERRAIN + HISTORY === */}
          <div className="grid shrink-0 grid-cols-1 gap-3 px-3 pb-3 xl:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)]">
            <PanelFrame
              header={
                <PanelHeader
                  title="Terrain Profile"
                  subtitle={selected ? shortRouteName(selected.name) : undefined}
                  icon="terrain"
                  actions={<ProvenanceTag kind="SYNTHETIC_HISTORICAL" />}
                />
              }
            >
              {selected?.elevationProfile ? (
                <ElevationProfile points={selected.elevationProfile} totalDistanceKm={selected.distanceKm} />
              ) : (
                <SkeletonRows rows={3} />
              )}
            </PanelFrame>

            <PanelFrame
              header={
                <PanelHeader
                  title="Historical Disruption"
                  subtitle="Recorded on this corridor in the last 12 months"
                  icon="database"
                  actions={<ProvenanceTag kind="SYNTHETIC_HISTORICAL" />}
                />
              }
            >
              {selected ? <HistoricalContext route={selected} /> : <SkeletonRows rows={3} />}
            </PanelFrame>
          </div>

          <FootNote selected={selected} />
        </>
      )}
    </div>
  );
}

function FootNote({ selected }: { selected: RouteCandidate | undefined }) {
  return (
    <div className="flex shrink-0 items-center justify-between gap-3 px-4 pb-3">
      <p className="text-[10px] leading-relaxed text-ink-3">
        Route geometry comes from the routing provider; risk scores are model output and factor
        contributions are SHAP values. The explanatory sentence narrates those factors — it does
        not produce the score, and it does not make the recommendation.
      </p>
      {selected ? (
        <div className="flex shrink-0 items-center gap-3">
          <ProvenanceTag kind="ML_PREDICTION" />
          <ProvenanceTag kind="LLM_EXPLANATION" />
        </div>
      ) : null}
    </div>
  );
}
