/**
 * The centre column: the corridor itself.
 *
 * The map is the page's centre of gravity, so it gets the panel with no padding, the satellite
 * basemap and every operational layer. It is fed entirely from the data source — route geometry
 * from the candidates endpoint, positions from the vehicles endpoint, hazards from incidents —
 * and owns no data of its own.
 *
 * Risk zones are derived from reported incidents, which are the only public shape carrying both
 * a coordinate and a severity: contract §3's `RouteSegment` exposes endpoints but no hazard
 * radius. The radius comes from the vision classifier's own blockage estimate, so the circle is
 * describing something real rather than being a decorative halo.
 */

import { useMemo } from 'react';
import { cn } from '@/lib/cn';
import { CORRIDOR_WAYPOINTS, type LatLng } from '@/domain/geo';
import { severityAsRiskLevel } from '@/domain/thresholds';
import type {
  Delivery,
  Incident,
  RouteCandidate,
  Vehicle,
  Warehouse,
} from '@/domain/types';
import {
  Chip,
  PanelFrame,
  PanelHeader,
  ProvenanceTag,
  SkeletonPane,
} from '@/design/primitives';
import { MapCanvas, type MapRiskZone, type MapRoute } from '@/map/MapCanvas';

/** Towns worth naming on a corridor-scale view. More than this and the map becomes an atlas. */
const LABELLED = [0, 7, 9, 11, 13, 15];

const ROUTE_KEYS = ['a', 'b', 'c'] as const;

export interface CorridorMapPanelProps {
  delivery: Delivery | undefined;
  candidates: RouteCandidate[];
  vehicles: Vehicle[];
  incidents: Incident[];
  warehouses: Warehouse[];
  selectedRouteId: string | undefined;
  onSelectRoute: (routeId: string) => void;
  onSelectVehicle?: (vehicle: Vehicle) => void;
  /** True once the cascade has run — animates the route whose risk was recalculated. */
  simulated: boolean;
  loading: boolean;
  className?: string;
}

export function CorridorMapPanel({
  delivery,
  candidates,
  vehicles,
  incidents,
  warehouses,
  selectedRouteId,
  onSelectRoute,
  onSelectVehicle,
  simulated,
  loading,
  className,
}: CorridorMapPanelProps) {
  const routes = useMemo<MapRoute[]>(
    () =>
      candidates.map((c, i) => ({
        id: c.id,
        key: ROUTE_KEYS[i] ?? 'c',
        name: c.name.split('—')[0].trim(),
        geometry: c.geometry,
        riskScore: c.riskScore,
        etaMinutes: c.etaMinutes,
        recommended: c.isRecommended,
        selected: c.id === selectedRouteId,
        showCallout: true,
        // Only the route the cascade actually re-scored gets the flow animation.
        flowing: simulated && c.riskLevel === 'CRITICAL',
      })),
    [candidates, selectedRouteId, simulated],
  );

  const riskZones = useMemo<MapRiskZone[]>(
    () =>
      incidents
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
    [incidents],
  );

  const places = useMemo(
    () =>
      LABELLED.map((i) => ({
        name: CORRIDOR_WAYPOINTS[i].name,
        position: [CORRIDOR_WAYPOINTS[i].lat, CORRIDOR_WAYPOINTS[i].lng] as LatLng,
      })),
    [],
  );

  const inTransit = useMemo(() => vehicles.filter((v) => v.status === 'IN_TRANSIT'), [vehicles]);

  // Frame the route the panel is assessing, so choosing B or C moves the map to it; all
  // candidates only until one is chosen.
  const fitTo = useMemo(() => {
    const chosen = candidates.find((c) => c.id === selectedRouteId);
    return chosen ? chosen.geometry : candidates.flatMap((c) => c.geometry);
  }, [candidates, selectedRouteId]);

  return (
    <PanelFrame
      variant="bare"
      className={cn('min-h-0 border border-line shadow-panel', className)}
      flushBody
      header={
        <PanelHeader
          title={
            delivery
              ? `${delivery.originName ?? 'Origin'} → ${delivery.destName ?? 'Destination'}`
              : 'Corridor'
          }
          subtitle="Route candidates, live fleet, reported incidents and forward depots"
          icon="liveMap"
          badge={
            <Chip tone="neutral" size="sm">
              {inTransit.length} in transit
            </Chip>
          }
          actions={<ProvenanceTag kind="SYNTHETIC_OPERATIONAL" />}
        />
      }
    >
      {loading || candidates.length === 0 ? (
        <SkeletonPane className="m-3" />
      ) : (
        <MapCanvas
          routes={routes}
          vehicles={inTransit}
          incidents={incidents}
          warehouses={warehouses}
          riskZones={riskZones}
          places={places}
          origins={
            delivery
              ? [
                  {
                    id: 'origin',
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
                    id: 'destination',
                    name: delivery.destName ?? 'Destination',
                    position: [delivery.destLat, delivery.destLng],
                  },
                ]
              : []
          }
          fitTo={fitTo}
          onSelectRoute={(r) => onSelectRoute(r.id)}
          onSelectVehicle={onSelectVehicle}
          showLayerPanel
          showLegend
          legendDefaultOpen={false}
          footnote={<ProvenanceTag kind={simulated ? 'SIMULATION_EVENT' : 'SYNTHETIC_OPERATIONAL'} />}
        />
      )}
    </PanelFrame>
  );
}
