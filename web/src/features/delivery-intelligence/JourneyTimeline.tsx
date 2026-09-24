/**
 * The delivery's journey along its corridor.
 *
 * Not a progress bar. A progress bar says "68%"; this says *where* the vehicle is, which towns
 * it has cleared, which stretch ahead the model has flagged, and how far the destination still
 * is. That is what an operator actually asks.
 *
 * Progress is derived geometrically: the vehicle's real reported position projected onto the
 * route's real geometry. Both values come from the data source; the projection is presentation
 * arithmetic, the same kind the map does to draw the marker.
 */

import { useMemo } from 'react';
import { cn } from '@/lib/cn';
import { formatDistance, formatDuration } from '@/domain/format';
import { haversineKm, pathLengthKm, type LatLng } from '@/domain/geo';
import { RISK_TONE } from '@/domain/thresholds';
import type { Incident, RouteCandidate, Vehicle } from '@/domain/types';
import { Icon, ProgressBar } from '@/design/primitives';

export interface JourneyStop {
  name: string;
  position: LatLng;
  /** Fraction along the route, 0-1. */
  at: number;
  state: 'passed' | 'current' | 'ahead';
  /** A flagged hazard on the approach to this stop. */
  hazard?: { level: 'MEDIUM' | 'HIGH' | 'CRITICAL'; label: string };
  isOrigin?: boolean;
  isDestination?: boolean;
}

/**
 * Where along `path` the given point lies, as a fraction of total length.
 *
 * Walks the polyline and takes the vertex closest to the vehicle, then interpolates within that
 * leg. Good enough at corridor scale, and it degrades sensibly if the vehicle has strayed.
 */
export function progressAlongPath(path: LatLng[], point: LatLng): number {
  if (path.length < 2) return 0;

  let best = { index: 1, distance: Infinity };
  for (let i = 1; i < path.length; i += 1) {
    const d = haversineKm(path[i], point);
    if (d < best.distance) best = { index: i, distance: d };
  }

  let travelled = 0;
  for (let i = 1; i <= best.index; i += 1) travelled += haversineKm(path[i - 1], path[i]);

  const total = pathLengthKm(path);
  return total > 0 ? Math.min(1, Math.max(0, travelled / total)) : 0;
}

export function buildStops(
  route: RouteCandidate,
  waypoints: { name: string; lat: number; lng: number }[],
  progress: number,
  incidents: Incident[],
): JourneyStop[] {
  const path = route.geometry;

  // Only the towns that matter at this scale: origin, destination, and the ones spaced far
  // enough apart to be legible.
  const chosen = waypoints.filter((_, i) => i === 0 || i === waypoints.length - 1 || i % 3 === 0);

  return chosen.map((w, i) => {
    const at = progressAlongPath(path, [w.lat, w.lng]);
    const state: JourneyStop['state'] =
      at < progress - 0.02 ? 'passed' : at <= progress + 0.06 ? 'current' : 'ahead';

    // A hazard is only worth flagging on the road AHEAD, and only when it is genuinely at this
    // town — 12 km, not 28. At the wider radius almost every stop on a corridor this dense
    // inherits a neighbour's incident, and a timeline where everything is flagged tells the
    // operator nothing.
    const nearby =
      state === 'passed'
        ? undefined
        : incidents.find(
            (inc) =>
              inc.type !== 'NORMAL' &&
              (inc.severity === 'HIGH' || inc.severity === 'CRITICAL') &&
              haversineKm([inc.lat, inc.lng], [w.lat, w.lng]) < 12,
          );

    return {
      name: w.name,
      position: [w.lat, w.lng] as LatLng,
      at,
      state,
      hazard: nearby
        ? {
            level: nearby.severity === 'HIGH' ? 'HIGH' : 'CRITICAL',
            label: `${nearby.type.replace('_', ' ').toLowerCase()} reported`,
          }
        : undefined,
      isOrigin: i === 0,
      isDestination: i === chosen.length - 1,
    } satisfies JourneyStop;
  });
}

export function JourneyTimeline({
  route,
  vehicle,
  stops,
  progress,
  className,
}: {
  route: RouteCandidate;
  vehicle: Vehicle | undefined;
  stops: JourneyStop[];
  progress: number;
  className?: string;
}) {
  const totalKm = useMemo(() => pathLengthKm(route.geometry), [route.geometry]);
  const remainingKm = totalKm * (1 - progress);
  const remainingMinutes = Math.round(route.etaMinutes * (1 - progress));

  return (
    <div className={cn('flex min-w-0 flex-col gap-3', className)}>
      {/* --- Readouts ----------------------------------------------------- */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <Readout icon="vehicle" label="Vehicle" value={vehicle?.code ?? '—'} sub={vehicle?.driverName} />
        <Readout
          icon="live"
          label="Speed"
          value={vehicle ? `${vehicle.speedKmh} km/h` : '—'}
          sub={vehicle ? `expected ${vehicle.expectedSpeedKmh}` : undefined}
          tone={
            vehicle && vehicle.speedKmh < vehicle.expectedSpeedKmh * 0.4
              ? 'text-risk-high'
              : undefined
          }
        />
        <Readout icon="routes" label="Distance remaining" value={formatDistance(remainingKm)} />
        <Readout icon="prediction" label="Time remaining" value={formatDuration(remainingMinutes)} />
        <span className="ml-auto text-meta text-ink-3">
          {Math.round(progress * 100)}% of corridor covered
        </span>
      </div>

      {/* --- The track ----------------------------------------------------- */}
      <div className="relative pb-1 pt-7">
        {/* Vehicle marker, sitting above the line at its real position */}
        <div
          className="absolute top-0 z-10 -translate-x-1/2 transition-[left] duration-700 ease-ui"
          style={{ left: `${Math.min(97, Math.max(3, progress * 100))}%` }}
        >
          <div className="flex flex-col items-center gap-0.5">
            <span className="whitespace-nowrap rounded-chip border border-brand-500/25 bg-brand-50 px-1.5 py-[1px] text-[10px] font-semibold text-brand-700">
              {vehicle?.code ?? 'In transit'}
            </span>
            <Icon name="chevronDown" size="sm" className="-mt-0.5 text-brand-500" />
          </div>
        </div>

        {/* Track */}
        <div className="relative h-[6px] w-full rounded-full bg-panel-sunk">
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-brand-500 transition-[width] duration-700 ease-ui"
            style={{ width: `${progress * 100}%` }}
          />
          {/* The stretch ahead that the model has flagged */}
          {route.riskLevel === 'CRITICAL' || route.riskLevel === 'HIGH' ? (
            <div
              className={cn(
                'absolute inset-y-0 rounded-full opacity-55',
                RISK_TONE[route.riskLevel].rail,
              )}
              style={{
                left: `${Math.min(96, progress * 100)}%`,
                right: '4%',
              }}
              title={`Elevated risk ahead on ${route.name}`}
            />
          ) : null}

          {/* Stops */}
          {stops.map((s) => (
            <span
              key={s.name}
              className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2"
              style={{ left: `${s.at * 100}%` }}
            >
              <StopDot stop={s} />
            </span>
          ))}
        </div>

        {/* Labels */}
        <div className="relative mt-2 h-[30px]">
          {stops.map((s) => (
            <span
              key={s.name}
              className={cn(
                'absolute flex -translate-x-1/2 flex-col items-center gap-0.5 whitespace-nowrap',
                s.isOrigin && 'translate-x-0 items-start',
                s.isDestination && '-translate-x-full items-end',
              )}
              style={{ left: `${s.at * 100}%` }}
            >
              <span
                className={cn(
                  'text-[11px] font-medium',
                  s.state === 'current'
                    ? 'text-brand-700'
                    : s.state === 'passed'
                      ? 'text-ink-2'
                      : 'text-ink-3',
                )}
              >
                {s.name}
              </span>
              <span
                className={cn(
                  'text-[9.5px]',
                  s.hazard ? RISK_TONE[s.hazard.level].text : 'text-ink-3',
                )}
              >
                {s.hazard
                  ? s.hazard.label
                  : s.state === 'passed'
                    ? 'passed'
                    : s.state === 'current'
                      ? 'current'
                      : s.isDestination
                        ? 'destination'
                        : 'ahead'}
              </span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function StopDot({ stop }: { stop: JourneyStop }) {
  if (stop.hazard) {
    const tone = RISK_TONE[stop.hazard.level];
    return (
      <span
        className={cn(
          'flex h-[18px] w-[18px] items-center justify-center rounded-full border-2 border-panel',
          tone.rail,
        )}
        title={stop.hazard.label}
      >
        <Icon name="warning" size="sm" className="scale-[0.62] text-white" />
      </span>
    );
  }
  if (stop.state === 'passed') {
    return (
      <span className="flex h-[14px] w-[14px] items-center justify-center rounded-full border-2 border-panel bg-brand-500">
        <Icon name="check" size="sm" className="scale-[0.55] text-white" />
      </span>
    );
  }
  return (
    <span
      className={cn(
        'block h-[12px] w-[12px] rounded-full border-2 border-panel',
        stop.state === 'current' ? 'bg-brand-500' : 'bg-ink-3/50',
      )}
    />
  );
}

function Readout({
  icon,
  label,
  value,
  sub,
  tone,
}: {
  icon: Parameters<typeof Icon>[0]['name'];
  label: string;
  value: string;
  sub?: string;
  tone?: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <Icon name={icon} size="sm" className="text-ink-3" />
      <div className="flex flex-col leading-none">
        <span className="text-[10px] uppercase tracking-[0.05em] text-ink-3">{label}</span>
        <span className={cn('tnum mt-1 text-body font-semibold', tone ?? 'text-ink')}>
          {value}
          {sub ? <span className="ml-1.5 text-meta font-normal text-ink-3">{sub}</span> : null}
        </span>
      </div>
    </div>
  );
}

/**
 * Required vs predicted arrival.
 *
 * Lateness has to be readable in one glance, so both arrivals sit on one shared time axis with
 * the overrun drawn as the gap between them rather than stated as a number to be compared.
 */
export function EtaComparison({
  requiredMinutes,
  predictedMinutes,
  className,
}: {
  requiredMinutes: number;
  predictedMinutes: number;
  className?: string;
}) {
  const scale = Math.max(requiredMinutes, predictedMinutes) * 1.08 || 1;
  const late = predictedMinutes > requiredMinutes;
  const overrun = predictedMinutes - requiredMinutes;

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <Bar
        label="Required arrival"
        minutes={requiredMinutes}
        pct={(requiredMinutes / scale) * 100}
        level="brand"
      />
      <Bar
        label="Predicted arrival"
        minutes={predictedMinutes}
        pct={(predictedMinutes / scale) * 100}
        level={late ? 'CRITICAL' : 'LOW'}
      />

      <div
        className={cn(
          'flex items-center justify-between gap-3 rounded-control border px-3 py-2',
          late
            ? 'border-risk-critical/20 bg-risk-wash-critical'
            : 'border-risk-low/20 bg-risk-wash-low',
        )}
      >
        <span className="flex items-center gap-1.5 text-meta font-medium text-ink-2">
          <Icon name={late ? 'up' : 'ok'} size="sm" className={late ? 'text-risk-critical' : 'text-risk-low'} />
          {late ? 'Arriving late by' : 'Arriving with margin of'}
        </span>
        <span
          className={cn(
            'tnum text-[17px] font-semibold',
            late ? 'text-risk-critical' : 'text-risk-low',
          )}
        >
          {formatDuration(Math.abs(overrun))}
        </span>
      </div>
    </div>
  );
}

function Bar({
  label,
  minutes,
  pct,
  level,
}: {
  label: string;
  minutes: number;
  pct: number;
  level: 'brand' | 'CRITICAL' | 'LOW';
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-2">
        <span className="t-label">{label}</span>
        <span className="tnum text-body font-semibold text-ink">{formatDuration(minutes)}</span>
      </div>
      <ProgressBar value={pct} level={level} size="lg" />
    </div>
  );
}
