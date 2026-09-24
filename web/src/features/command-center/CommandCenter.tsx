/**
 * The Command Center — the primary judging screen.
 *
 * It answers six questions, in this reading order:
 *
 *   what is happening        hero band + KPI strip
 *   what is at risk          priority alerts (left) + the corridor map (centre)
 *   why is it at risk        SHAP factor breakdown (right)
 *   what should we do        AI recommendation block (right)
 *   what happens to supply   supply status (bottom left)
 *   who is being notified    the alert feed's notification badges + alert detail
 *
 * Architecture: this file owns composition and selection state only. Every value it renders
 * arrives through `data/hooks`, which read `dataSource` — no fixture is imported here, and no
 * risk score, ETA or contribution is computed in the UI. Clicking "Simulate Heavy Rainfall"
 * calls `dataSource.simulateRain(...)`, which runs the real cascade; `useAction` then bumps the
 * cascade version and every mounted resource on the page refetches. There is no front-end
 * animation standing in for that work.
 */

import { useCallback, useMemo, useState } from 'react';
import { useAuth } from '@/app/auth';
import { capabilitiesFor } from '@/app/modules';
import { DEMO_SEGMENT_ID } from '@/app/config';
import { dataSource, isDemoMode } from '@/data';
import { appNow, appNowIso } from '@/data/clock';
import {
  useAction,
  useAlerts,
  useResource,
  useDeliveries,
  useDistricts,
  useIncidents,
  useRecentMovements,
  useRouteCandidates,
  useSummary,
  useVehicles,
  useWarehouses,
  useWeather,
} from '@/data/hooks';
import { formatTime } from '@/domain/format';
import { featuredDelivery } from '../shared/delivery';
import { Chip, Icon, ProvenanceTag } from '@/design/primitives';
import { HeroBand, ImagePanel } from '@/shell/HeroBand';
import { useShellRailNote } from '@/shell/AppShell';
import ridgeline from '@/assets/ner-ridgeline.jpg';
import corridorRoad from '@/assets/ner-corridor-road.jpg';
import { ConditionsPanel } from './ConditionsPanel';
import { CorridorMapPanel } from './CorridorMapPanel';
import { DeliveryIntelligencePanel } from './DeliveryIntelligencePanel';
import { KpiStrip } from './KpiStrip';
import { PriorityAlertsPanel } from './PriorityAlertsPanel';
import { RecentMovementsPanel } from './RecentMovementsPanel';
import { SupplyStatusPanel } from './SupplyStatusPanel';

export function CommandCenter() {
  const { user } = useAuth();
  const capabilities = capabilitiesFor(user?.role ?? 'DISTRICT_OFFICER');

  // --- Data ---------------------------------------------------------------
  const summary = useSummary();
  const weather = useWeather();
  const alerts = useAlerts();
  const deliveries = useDeliveries();
  const vehicles = useVehicles();
  const incidents = useIncidents();
  const warehouses = useWarehouses();
  const districts = useDistricts();
  const movements = useRecentMovements();

  const delivery = useMemo(
    () => featuredDelivery(deliveries.data?.deliveries ?? []),
    [deliveries.data],
  );

  // Candidate routes for whichever delivery is featured. The params are memoised so the hook
  // does not reissue the request on every render.
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

  // The delivery's recommendation comes from the decision engine via the detail endpoint.
  const deliveryDetail = useDeliveryDetail(delivery?.id);

  // --- Selection ----------------------------------------------------------
  const [selectedRouteId, setSelectedRouteId] = useState<string>();

  const routeList = candidates.data?.candidates ?? [];

  /**
   * Which route the intelligence panel is assessing.
   *
   * Defaults to the route the delivery is ACTUALLY ON, not the recommended one. That matters:
   * when the cascade moves the recommendation from A to B, a panel that follows the
   * recommendation silently stops showing the operator the risk they are currently carrying —
   * the 87% disappears and is replaced by the 32% of a route nobody has taken yet. The panel
   * shows the assigned route and the recommendation block argues for the alternative.
   */
  const effectiveRouteId =
    (selectedRouteId && routeList.some((r) => r.id === selectedRouteId) && selectedRouteId) ||
    (delivery?.assignedRouteId &&
      routeList.some((r) => r.id === delivery.assignedRouteId) &&
      delivery.assignedRouteId) ||
    routeList.find((r) => r.isRecommended)?.id;

  const onSelectRoute = useCallback((routeId: string) => setSelectedRouteId(routeId), []);

  // --- The demo control ---------------------------------------------------
  const simulate = useAction(() => dataSource.simulateRain(DEMO_SEGMENT_ID));
  const simulated = weather.data?.weather.simulated ?? false;

  // The status rail carries the cascade's own state, so it is legible from anywhere on the page.
  useShellRailNote(
    <span className="flex items-center gap-1.5">
      <Icon name={simulated ? 'simulate' : 'weather'} size="sm" className="opacity-60" />
      <span className="hidden lg:inline">Cascade</span>
      <span className={simulated ? 'font-semibold text-risk-critical' : 'font-semibold text-ink-2'}>
        {simulate.pending ? 'running' : simulated ? 'complete' : 'idle'}
      </span>
    </span>,
    [simulated, simulate.pending],
  );

  const loadingCore = deliveries.loading || candidates.loading;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto scroll-thin">
      {/* ============================================================ HERO === */}
      <HeroBand
        image={ridgeline}
        eyebrow="North Eastern Region"
        eyebrowIcon="terrain"
        title="Logistics Command Center"
        subtitle="Real-time intelligence. Predictive insights. Proactive action."
        credit="Photo: Kingshuk Mondal, CC BY 4.0"
        centre={
          <blockquote className="max-w-[22ch] text-center text-[12.5px] italic leading-snug text-white/60">
            “Connected supply chains for a resilient North East.”
          </blockquote>
        }
        right={
          <div className="flex items-stretch gap-3">
            <SystemStatus simulated={simulated} pending={simulate.pending} />
            <ConditionsPanel
              weather={weather.data?.weather}
              onSimulate={simulate.run}
              pending={simulate.pending}
              canSimulate={capabilities.simulateRainfall}
            />
          </div>
        }
      />

      {/* ============================================================= KPI === */}
      <div className="shrink-0 px-3 pt-3">
        <KpiStrip summary={summary.data?.summary} loading={summary.loading} />
      </div>

      {/* ===================================================== OPERATIONS === */}
      <div
        className={[
          'grid min-h-0 shrink-0 gap-3 p-3',
          // Three columns from 1280 up: the map keeps whatever the two rails do not need.
          'grid-cols-1',
          'lg:grid-cols-[292px_minmax(0,1fr)_340px]',
          'xl:grid-cols-[320px_minmax(0,1fr)_372px]',
          '2xl:grid-cols-[344px_minmax(0,1fr)_404px]',
          // The map is the centre of gravity and gets the height. At 1080 the bottom row is
          // deliberately left part-visible rather than squeezing the map to fit it: a partly
          // visible row reads as "there is more below", and a 340px map does not read as a
          // command centre. Capped at 560 so a tall display does not become a wall of imagery.
          'h-[min(560px,calc(100vh-560px))] min-h-[420px]',
        ].join(' ')}
      >
        <PriorityAlertsPanel alerts={alerts} now={appNow()} />

        <CorridorMapPanel
          delivery={delivery}
          candidates={routeList}
          vehicles={vehicles.data?.vehicles ?? []}
          incidents={incidents.data?.incidents ?? []}
          warehouses={warehouses.data?.warehouses ?? []}
          selectedRouteId={effectiveRouteId}
          onSelectRoute={onSelectRoute}
          simulated={simulated}
          loading={loadingCore}
        />

        <DeliveryIntelligencePanel
          delivery={delivery}
          recommendation={deliveryDetail.data?.recommendation}
          candidates={routeList}
          selectedRouteId={effectiveRouteId}
          onSelectRoute={onSelectRoute}
          loading={loadingCore}
        />
      </div>

      {/* ========================================================== BOTTOM === */}
      <div className="grid shrink-0 grid-cols-1 gap-3 px-3 pb-3 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] 2xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1.05fr)_minmax(0,0.7fr)]">
        <SupplyStatusPanel districts={districts} className="min-h-[244px]" />
        <RecentMovementsPanel movements={movements} live className="min-h-[244px]" />

        <ImagePanel
          image={corridorRoad}
          imagePosition="center 58%"
          title="Stronger Supply Chains"
          subtitle="A More Resilient North East"
          credit="Kingshuk Mondal, CC BY 4.0"
          className="hidden min-h-[244px] 2xl:flex"
          footer={
            <div className="flex items-center gap-2 text-[11px] text-white/75">
              <span>People</span>
              <span className="opacity-40">·</span>
              <span>Connectivity</span>
              <span className="opacity-40">·</span>
              <span>Opportunity</span>
            </div>
          }
        />
      </div>

      {/* A single honest footnote for the whole screen, rather than a tag on every number. */}
      <div className="flex shrink-0 items-center justify-between gap-3 px-4 pb-3 pt-0">
        <p className="text-[10px] leading-relaxed text-ink-3">
          {isDemoMode
            ? 'Figures on this screen come from the deterministic demonstration dataset. Risk scores stand in for XGBoost output until the model service is connected.'
            : 'Risk scores are XGBoost output; factor breakdowns are SHAP values; explanatory text is language-model narration of that output.'}
        </p>
        <div className="flex shrink-0 items-center gap-3">
          <ProvenanceTag kind="ML_PREDICTION" />
          <ProvenanceTag kind="LLM_EXPLANATION" />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Hero status cluster
// ---------------------------------------------------------------------------

function SystemStatus({ simulated, pending }: { simulated: boolean; pending: boolean }) {
  return (
    <div className="hidden flex-col justify-center gap-1.5 border-r border-white/15 pr-3 xl:flex">
      <span className="tnum text-[11px] font-semibold text-white/80">
        {formatTime(appNowIso())}
      </span>
      <Chip
        tone="navy"
        icon={pending ? 'spinner' : simulated ? 'simulate' : 'ok'}
        size="sm"
        className={pending ? '[&>svg]:animate-spin' : undefined}
      >
        {pending ? 'Cascade running' : simulated ? 'Event active' : 'System online'}
      </Chip>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Delivery detail
// ---------------------------------------------------------------------------

/**
 * The featured delivery's detail, including whatever recommendation the decision engine has
 * issued for it.
 *
 * Not `useDelivery` from the hooks module, because the id is only known once the deliveries
 * list resolves and hooks cannot be called conditionally — so the fetch resolves to an empty
 * detail until there is an id to ask about.
 */
function useDeliveryDetail(id: string | undefined) {
  return useResource(
    async () =>
      id
        ? await dataSource.getDeliveryById(id)
        : { delivery: undefined, recommendation: undefined },
    [id],
  );
}
