/**
 * The corridor's elevation profile.
 *
 * This is an information graphic, not decoration. It shows the thing that actually makes this
 * road difficult and that no risk score on its own conveys: the climb out of the Assam plains,
 * the drop back down into the Dirang valley, and Sela Pass at 4 170 m before the descent into
 * Tawang. Gradient is what the terrain factor in the model is measuring, so the steepest legs
 * are shaded by their slope rather than drawn as a plain silhouette.
 *
 * Every value is rendered from `RouteCandidate.elevationProfile`. The component computes the
 * drawing scale and nothing else.
 */

import { useMemo, useState } from 'react';
import { cn } from '@/lib/cn';
import { formatNumber } from '@/domain/format';
import type { ElevationPoint } from '@/domain/types';
import { Icon } from '@/design/primitives';

/** Slope bands, in degrees, and the colour each is drawn in. */
const SLOPE_BANDS = [
  { max: 6, color: 'rgb(var(--risk-low))', label: 'Gentle · under 6°' },
  { max: 15, color: 'rgb(var(--risk-medium))', label: 'Moderate · 6–15°' },
  { max: 25, color: 'rgb(var(--risk-high))', label: 'Steep · 15–25°' },
  { max: Infinity, color: 'rgb(var(--risk-critical))', label: 'Severe · over 25°' },
] as const;

function slopeColor(slopeDeg: number): string {
  return (SLOPE_BANDS.find((b) => slopeDeg < b.max) ?? SLOPE_BANDS[3]).color;
}

export interface ElevationProfileProps {
  points: ElevationPoint[];
  /**
   * The route's real road distance.
   *
   * The sample positions are computed from straight-line hops between towns, which is always
   * shorter than the road. Scaling the axis to the route's own distance keeps this chart from
   * contradicting the figure the comparison table shows for the same route.
   */
  totalDistanceKm?: number;
  /** Where the vehicle currently is, as a fraction of total distance. */
  progress?: number;
  height?: number;
  className?: string;
}

export function ElevationProfile({
  points,
  totalDistanceKm,
  progress,
  height = 168,
  className,
}: ElevationProfileProps) {
  const [hover, setHover] = useState<number | null>(null);

  const geometry = useMemo(() => {
    if (points.length < 2) return null;

    const padL = 42;
    const padR = 12;
    const padT = 14;
    const padB = 26;
    const width = 1000; // viewBox units; the SVG scales to its container
    const plotW = width - padL - padR;
    const plotH = height - padT - padB;

    const rawMax = points[points.length - 1].distanceKm || 1;
    const scale = totalDistanceKm ? totalDistanceKm / rawMax : 1;
    const maxDist = rawMax * scale;
    const maxEl = Math.max(...points.map((p) => p.elevationM));
    // Round the ceiling up to a clean 500 m so the axis labels are readable numbers.
    const ceiling = Math.max(500, Math.ceil(maxEl / 500) * 500);

    const x = (km: number) => padL + (km / maxDist) * plotW;
    const y = (m: number) => padT + plotH - (m / ceiling) * plotH;

    const xy = points.map((p) => ({
      ...p,
      distanceKm: Math.round(p.distanceKm * scale * 10) / 10,
      cx: x(p.distanceKm * scale),
      cy: y(p.elevationM),
    }));

    // One filled trapezoid per leg, coloured by that leg's gradient. Drawing the profile as
    // segments rather than a single path is what lets slope be visible at all.
    const legs = xy.slice(1).map((p, i) => {
      const a = xy[i];
      return {
        key: `${a.distanceKm}-${p.distanceKm}`,
        d: `M${a.cx} ${a.cy} L${p.cx} ${p.cy} L${p.cx} ${padT + plotH} L${a.cx} ${padT + plotH} Z`,
        color: slopeColor(p.slopeDeg),
        slopeDeg: p.slopeDeg,
      };
    });

    const line = xy.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.cx} ${p.cy}`).join(' ');

    const gridlines = [0, 0.25, 0.5, 0.75, 1].map((f) => ({
      y: padT + plotH - f * plotH,
      label: formatNumber(Math.round(ceiling * f)),
    }));

    // Label only the places worth naming: origin, destination, the high point, and the few
    // towns with room between them. More than that and the axis becomes unreadable.
    const peakIndex = xy.reduce((best, p, i) => (p.elevationM > xy[best].elevationM ? i : best), 0);
    const labelled = new Set<number>([0, xy.length - 1, peakIndex]);
    let lastX = -Infinity;
    xy.forEach((p, i) => {
      // Only named points compete for the spacing; a shaping point between towns has no label
      // and would otherwise use up the room a town next to it needs.
      if (p.place && p.cx - lastX > plotW / 7) {
        labelled.add(i);
        lastX = p.cx;
      }
    });

    return { width, padL, padR, padT, padB, plotW, plotH, xy, legs, line, gridlines, labelled, maxDist, x };
  }, [points, height, totalDistanceKm]);

  if (!geometry) return null;

  const { width, padT, plotH, xy, legs, line, gridlines, labelled, maxDist, x } = geometry;
  const hovered = hover !== null ? xy[hover] : null;
  const peak = xy.reduce((a, b) => (b.elevationM > a.elevationM ? b : a), xy[0]);
  const steepest = xy.reduce((a, b) => (b.slopeDeg > a.slopeDeg ? b : a), xy[0]);
  // `place` is optional in the contract. A profile point between towns carries none, and the
  // readouts then say where along the road it is rather than printing "approach to undefined".
  const atKm = (p: { distanceKm: number }) => `at km ${formatNumber(Math.round(p.distanceKm))}`;

  return (
    <div className={cn('flex min-w-0 flex-col gap-2', className)}>
      {/* Summary readouts — the two numbers that describe the terrain load. */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5">
        <Readout
          icon="terrain"
          label="Highest point"
          value={`${formatNumber(peak.elevationM)} m`}
          sub={peak.place ?? atKm(peak)}
        />
        <Readout
          icon="up"
          label="Steepest section"
          value={`${steepest.slopeDeg.toFixed(1)}° avg`}
          sub={steepest.place ? `approach to ${steepest.place}` : atKm(steepest)}
        />
        <Readout icon="routes" label="Road distance" value={`${maxDist.toFixed(0)} km`} />
      </div>

      <div className="relative">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="none"
          className="h-auto w-full"
          style={{ height }}
          role="img"
          aria-label={`Elevation profile: highest point ${peak.elevationM} metres ${peak.place ? `at ${peak.place}` : atKm(peak)}`}
          onMouseLeave={() => setHover(null)}
        >
          {/* Gridlines */}
          {gridlines.map((g) => (
            <line
              key={g.label}
              x1={geometry.padL}
              x2={width - geometry.padR}
              y1={g.y}
              y2={g.y}
              stroke="rgb(var(--line))"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
          ))}

          {/* Terrain, one leg at a time, coloured by gradient */}
          {legs.map((leg) => (
            <path key={leg.key} d={leg.d} fill={leg.color} fillOpacity={0.22} />
          ))}

          {/* Ridge line */}
          <path
            d={line}
            fill="none"
            stroke="rgb(var(--ink-2))"
            strokeWidth={1.75}
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />

          {/* Vehicle position */}
          {progress !== undefined ? (
            <g>
              <line
                x1={x(maxDist * progress)}
                x2={x(maxDist * progress)}
                y1={padT}
                y2={padT + plotH}
                stroke="rgb(var(--brand-500))"
                strokeWidth={1.5}
                strokeDasharray="4 3"
                vectorEffect="non-scaling-stroke"
              />
            </g>
          ) : null}

          {/* Hover targets — one invisible band per point */}
          {xy.map((p, i) => (
            <rect
              key={p.distanceKm}
              x={p.cx - width / (xy.length * 2)}
              y={padT}
              width={width / xy.length}
              height={plotH}
              fill="transparent"
              onMouseEnter={() => setHover(i)}
            />
          ))}

          {hovered ? (
            <g pointerEvents="none">
              <line
                x1={hovered.cx}
                x2={hovered.cx}
                y1={padT}
                y2={padT + plotH}
                stroke="rgb(var(--ink))"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
              <circle cx={hovered.cx} cy={hovered.cy} r={4} fill="rgb(var(--ink))" stroke="white" strokeWidth={2} />
            </g>
          ) : null}
        </svg>

        {/* Y axis labels, positioned over the SVG so they keep real typography */}
        <div className="pointer-events-none absolute inset-0">
          {gridlines.map((g) => (
            <span
              key={g.label}
              className="tnum absolute left-0 -translate-y-1/2 text-[9.5px] text-ink-3"
              style={{ top: `${(g.y / height) * 100}%` }}
            >
              {g.label} m
            </span>
          ))}
        </div>

        {/* Place labels along the bottom */}
        <div className="relative mt-1 h-[14px]">
          {xy.map((p, i) =>
            labelled.has(i) && p.place ? (
              <span
                key={p.place}
                className="absolute -translate-x-1/2 whitespace-nowrap text-[9.5px] text-ink-3"
                style={{ left: `${(p.cx / width) * 100}%` }}
              >
                {p.place}
              </span>
            ) : null,
          )}
        </div>

        {/* Hover readout */}
        {hovered ? (
          <div
            className="pointer-events-none absolute top-1 -translate-x-1/2 rounded-chip border border-line bg-panel/95 px-2 py-1 shadow-float backdrop-blur-sm"
            style={{ left: `${Math.min(88, Math.max(12, (hovered.cx / width) * 100))}%` }}
          >
            <p className="tnum text-[11px] font-semibold text-ink">
              {formatNumber(hovered.elevationM)} m
            </p>
            <p className="tnum text-[9.5px] text-ink-3">
              {hovered.place ? `${hovered.place} · ` : ''}
              {hovered.distanceKm} km · {hovered.slopeDeg.toFixed(1)}°
            </p>
          </div>
        ) : null}
      </div>

      {/* Gradient legend */}
      <ul className="flex flex-wrap items-center gap-x-4 gap-y-1">
        {SLOPE_BANDS.map((b) => (
          <li key={b.label} className="flex items-center gap-1.5">
            <span
              className="h-2 w-4 shrink-0 rounded-[2px]"
              style={{ background: b.color, opacity: 0.45 }}
            />
            <span className="text-[10px] text-ink-3">{b.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Readout({
  icon,
  label,
  value,
  sub,
}: {
  icon: Parameters<typeof Icon>[0]['name'];
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <Icon name={icon} size="sm" className="text-ink-3" />
      <div className="flex flex-col leading-none">
        <span className="text-[10px] uppercase tracking-[0.05em] text-ink-3">{label}</span>
        <span className="tnum mt-1 text-body font-semibold text-ink">
          {value}
          {sub ? <span className="ml-1.5 text-meta font-normal text-ink-3">{sub}</span> : null}
        </span>
      </div>
    </div>
  );
}
