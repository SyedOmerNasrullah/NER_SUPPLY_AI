/**
 * The stockout forecast.
 *
 * This is the graphic that carries the product's argument. It draws cover running down to the
 * moment the model projects, marks where the inbound resupply was supposed to land and where it
 * is now predicted to land, and draws a second, dashed line for the cover the district would
 * have had if that delivery were on time. The gap between the two lines is the entire cost of
 * the disruption — drawn, not asserted.
 *
 * The slope is anchored to `adjustedStockoutHours`, not to `currentStock / dailyConsumption`.
 * At rest the two agree, because the seed keeps stock, consumption and projection consistent;
 * once a delayed resupply is priced in they diverge, and drawing the flat division would put
 * the zero-crossing somewhere the headline figure disagrees with.
 *
 * Everything is rendered from `SupplyProjection`. The component computes drawing scales and
 * nothing else.
 */

import { useMemo } from 'react';
import { cn } from '@/lib/cn';
import { formatNumber, formatStockout } from '@/domain/format';
import { RISK_TONE, stockoutAsRiskLevel } from '@/domain/thresholds';
import type { SupplyProjection } from '@/domain/types';
import { Icon } from '@/design/primitives';

export interface StockoutForecastProps {
  projection: SupplyProjection;
  /** Units the inbound delivery is carrying, when known. */
  inboundUnits?: number;
  /** Minutes from now until the inbound delivery is predicted to arrive. */
  inboundEtaMinutes?: number;
  height?: number;
  className?: string;
}

/** The safety line every stockout projection is judged against (contract §2). */
const SAFETY_HOURS = 48;

export function StockoutForecast({
  projection,
  inboundUnits,
  inboundEtaMinutes,
  height = 190,
  className,
}: StockoutForecastProps) {
  const geometry = useMemo(() => {
    const adjusted = projection.adjustedStockoutHours;
    const baseline = projection.baselineStockoutHours;
    if (adjusted === null) return null;

    const padL = 48;
    const padR = 16;
    const padT = 16;
    const padB = 30;
    const width = 1000;
    const plotW = width - padL - padR;
    const plotH = height - padT - padB;

    // Horizon: far enough past the later of the two projections to show what happens after.
    const horizonH = Math.max(72, Math.ceil((Math.max(adjusted, baseline ?? 0) * 1.35) / 12) * 12);
    const ceilingUnits = Math.max(projection.currentStock * 1.12, projection.currentStock + 40);

    const x = (h: number) => padL + (h / horizonH) * plotW;
    const y = (u: number) => padT + plotH - (u / ceilingUnits) * plotH;

    // Cover running down to zero at the moment the model projects.
    //
    // The slope is anchored to the PROJECTION, not to `currentStock / dailyConsumption`. At
    // rest the two are the same — the seed keeps them consistent — but once a delayed resupply
    // is priced in they diverge, and that divergence is the whole point of this graphic. Drawing
    // the flat division here would put the zero-crossing somewhere the headline figure does not
    // agree with, which is worse than useless.
    const depletionTo = (zeroAt: number) => ({
      zeroAt,
      d: `M${x(0)} ${y(projection.currentStock)} L${x(zeroAt)} ${y(0)}`,
    });

    const current = depletionTo(adjusted);
    const onTime = baseline !== null && baseline !== adjusted ? depletionTo(baseline) : undefined;

    // Where the inbound resupply lands, on each of the two schedules.
    const arrivalAdjusted = inboundEtaMinutes !== undefined ? inboundEtaMinutes / 60 : undefined;
    const arrivalBaseline =
      arrivalAdjusted !== undefined && projection.inboundDelayMinutes
        ? arrivalAdjusted - projection.inboundDelayMinutes / 60
        : arrivalAdjusted;

    const gridUnits = [0, 0.5, 1].map((f) => ({
      y: y(ceilingUnits * f),
      label: formatNumber(Math.round(ceilingUnits * f)),
    }));

    const gridHours = [0, 0.25, 0.5, 0.75, 1].map((f) => ({
      x: x(horizonH * f),
      label: `${Math.round(horizonH * f)}h`,
    }));

    return {
      width, padL, padR, padT, padB, plotW, plotH,
      x, y, horizonH, ceilingUnits, current, onTime,
      arrivalAdjusted, arrivalBaseline, gridUnits, gridHours,
      adjusted, baseline,
    };
  }, [projection, inboundEtaMinutes, height]);

  if (!geometry) {
    return (
      <p className={cn('text-meta text-ink-3', className)}>
        No stockout projection is available for this supply line.
      </p>
    );
  }

  const {
    width, padT, plotH, x, y, current, onTime, arrivalAdjusted, arrivalBaseline,
    gridUnits, gridHours, adjusted, baseline,
  } = geometry;

  const level = stockoutAsRiskLevel(adjusted) ?? 'LOW';
  const tone = RISK_TONE[level];
  const breached = adjusted < SAFETY_HOURS;
  const safetyX = x(SAFETY_HOURS);

  return (
    <div className={cn('flex min-w-0 flex-col gap-2.5', className)}>
      {/* --- The two projections, side by side ---------------------------- */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        {baseline !== null && projection.disruptionHours > 0 ? (
          <Readout
            icon="ok"
            label="If the delivery lands on time"
            value={formatStockout(baseline)}
            tone="text-ink-2"
          />
        ) : null}
        <Readout
          icon={breached ? 'critical' : 'prediction'}
          label="Projected stockout"
          value={formatStockout(adjusted)}
          tone={tone.text}
        />
        {projection.disruptionHours > 0 ? (
          <Readout
            icon="down"
            label="Cost of the delay"
            value={`−${projection.disruptionHours}h of cover`}
            tone="text-risk-critical"
          />
        ) : null}
      </div>

      {/* --- The graphic --------------------------------------------------- */}
      <div className="relative">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="none"
          style={{ height }}
          className="w-full"
          role="img"
          aria-label={`Stock depletion forecast: projected stockout in ${Math.round(adjusted)} hours`}
        >
          {/* Grid */}
          {gridUnits.map((g) => (
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

          {/* The 48-hour safety window, as a band rather than a line — it is a zone of
              concern, not an instant. */}
          <rect
            x={geometry.padL}
            y={padT}
            width={Math.max(0, safetyX - geometry.padL)}
            height={plotH}
            fill="rgb(var(--risk-critical))"
            fillOpacity={breached ? 0.07 : 0.04}
          />
          <line
            x1={safetyX}
            x2={safetyX}
            y1={padT}
            y2={padT + plotH}
            stroke="rgb(var(--risk-critical))"
            strokeWidth={1.5}
            strokeDasharray="5 4"
            vectorEffect="non-scaling-stroke"
          />

          {/* Where cover would have run out had the resupply landed on schedule. The gap
              between this line and the solid one is what the delay cost. */}
          {onTime ? (
            <path
              d={onTime.d}
              fill="none"
              stroke="rgb(var(--ink-3))"
              strokeWidth={1.5}
              strokeDasharray="5 4"
              vectorEffect="non-scaling-stroke"
            />
          ) : null}

          {/* Cover running down */}
          <path
            d={`${current.d} L${x(current.zeroAt)} ${padT + plotH} L${x(0)} ${padT + plotH} Z`}
            fill={tone.cssVar}
            fillOpacity={0.14}
          />
          <path
            d={current.d}
            fill="none"
            stroke={tone.cssVar}
            strokeWidth={2.25}
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />

          {/* Where the resupply was meant to land, and where it now will */}
          {arrivalBaseline !== undefined && arrivalBaseline !== arrivalAdjusted ? (
            <line
              x1={x(arrivalBaseline)}
              x2={x(arrivalBaseline)}
              y1={padT}
              y2={padT + plotH}
              stroke="rgb(var(--ink-3))"
              strokeWidth={1.25}
              strokeDasharray="3 3"
              vectorEffect="non-scaling-stroke"
            />
          ) : null}
          {arrivalAdjusted !== undefined ? (
            <>
              <line
                x1={x(arrivalAdjusted)}
                x2={x(arrivalAdjusted)}
                y1={padT}
                y2={padT + plotH}
                stroke="rgb(var(--brand-500))"
                strokeWidth={1.75}
                vectorEffect="non-scaling-stroke"
              />
              <circle cx={x(arrivalAdjusted)} cy={padT + 5} r={4} fill="rgb(var(--brand-500))" />
            </>
          ) : null}

          {/* The stockout moment itself */}
          <circle
            cx={x(current.zeroAt)}
            cy={y(0)}
            r={5}
            fill={tone.cssVar}
            stroke="white"
            strokeWidth={2}
          />
        </svg>

        {/* Axis labels, kept as HTML so they carry real typography */}
        <div className="pointer-events-none absolute inset-0">
          {gridUnits.map((g) => (
            <span
              key={g.label}
              className="tnum absolute left-0 -translate-y-1/2 text-[9.5px] text-ink-3"
              style={{ top: `${(g.y / height) * 100}%` }}
            >
              {g.label}
            </span>
          ))}

          {arrivalAdjusted !== undefined ? (
            <span
              className="absolute -translate-x-1/2 whitespace-nowrap rounded-chip border border-brand-500/25 bg-brand-50 px-1.5 py-[1px] text-[9.5px] font-semibold text-brand-700"
              style={{ left: `${(x(arrivalAdjusted) / width) * 100}%`, top: 0 }}
            >
              {projection.inboundDeliveryCode ?? 'Resupply'} arrives
              {inboundUnits ? ` · ${formatNumber(inboundUnits)} units` : ''}
            </span>
          ) : null}

          <span
            className="absolute -translate-x-1/2 whitespace-nowrap text-[9.5px] font-semibold text-risk-critical"
            style={{ left: `${(safetyX / width) * 100}%`, bottom: 12 }}
          >
            48h safety line
          </span>
        </div>

        <div className="relative mt-1 h-[13px]">
          {gridHours.map((g) => (
            <span
              key={g.label}
              className="tnum absolute -translate-x-1/2 text-[9.5px] text-ink-3"
              style={{ left: `${(g.x / width) * 100}%` }}
            >
              {g.label}
            </span>
          ))}
        </div>
      </div>

      {/* --- Legend -------------------------------------------------------- */}
      <ul className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <LegendItem color={tone.cssVar} label="Projected cover" />
        {projection.disruptionHours > 0 ? (
          <LegendItem color="rgb(var(--ink-3))" dashed label="Cover if delivery is on time" />
        ) : null}
        <LegendItem color="rgb(var(--brand-500))" label="Predicted resupply" />
        <LegendItem color="rgb(var(--risk-critical))" dashed label="48h safety line" />
      </ul>
    </div>
  );
}

function LegendItem({
  color,
  label,
  dashed = false,
}: {
  color: string;
  label: string;
  dashed?: boolean;
}) {
  return (
    <li className="flex items-center gap-1.5">
      <span
        className="h-0 w-4 shrink-0"
        style={{ borderTop: `${dashed ? '2px dashed' : '3px solid'} ${color}` }}
      />
      <span className="text-[10px] text-ink-3">{label}</span>
    </li>
  );
}

function Readout({
  icon,
  label,
  value,
  tone,
}: {
  icon: Parameters<typeof Icon>[0]['name'];
  label: string;
  value: string;
  tone: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <Icon name={icon} size="sm" className="text-ink-3" />
      <div className="flex flex-col leading-none">
        <span className="text-[10px] uppercase tracking-[0.05em] text-ink-3">{label}</span>
        <span className={cn('tnum mt-1 text-body font-semibold', tone)}>{value}</span>
      </div>
    </div>
  );
}
