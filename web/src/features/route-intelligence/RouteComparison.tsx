/**
 * The route comparison.
 *
 * Deliberately not three cards side by side. Three cards force the eye to travel to compare a
 * single attribute, which is exactly the task this table exists to make easy: an operator wants
 * to read *down* the risk column, then down the ETA column. So it is a table — but one where the
 * risk column carries a bar, the selected row is a real selection, and the recommended row
 * carries a restrained left rail rather than a coloured background that would shout over the
 * risk colours.
 */

import { cn } from '@/lib/cn';
import { formatDistance, formatDuration, humanizeEnum } from '@/domain/format';
import { RISK_TONE } from '@/domain/thresholds';
import type { RouteCandidate } from '@/domain/types';
import {
  Chip,
  DataTable,
  Icon,
  RiskBarCell,
  RiskChip,
  type Column,
} from '@/design/primitives';
import { shortRouteName } from '../shared/delivery';

const ROAD_TONE = {
  GOOD: 'text-risk-low',
  FAIR: 'text-risk-medium',
  POOR: 'text-risk-critical',
} as const;

const ROUTE_ACCENT = ['bg-route-a', 'bg-route-b', 'bg-route-c'];

export function RouteComparison({
  candidates,
  selectedId,
  assignedId,
  onSelect,
  className,
}: {
  candidates: RouteCandidate[];
  selectedId: string | undefined;
  assignedId: string | undefined;
  onSelect: (id: string) => void;
  className?: string;
}) {
  const columns: Column<RouteCandidate>[] = [
    {
      key: 'route',
      header: 'Route',
      render: (c, i) => (
        <div className="flex min-w-0 flex-col leading-tight">
          <span className="flex items-center gap-2">
            <span
              className={cn('h-2.5 w-2.5 shrink-0 rounded-full', ROUTE_ACCENT[i] ?? 'bg-route-c')}
            />
            <span className="text-body font-semibold text-ink">{shortRouteName(c.name)}</span>
          </span>
          <span className="truncate pl-[18px] text-meta text-ink-3" title={c.name}>
            {c.name.split('—')[1]?.trim() ?? '—'}
          </span>
        </div>
      ),
    },
    {
      key: 'risk',
      header: 'Risk',
      width: '190px',
      render: (c) => <RiskBarCell score={c.riskScore} width={90} />,
    },
    {
      key: 'level',
      header: 'Level',
      width: '116px',
      render: (c) => <RiskChip level={c.riskLevel} size="sm" />,
    },
    {
      key: 'eta',
      header: 'ETA',
      numeric: true,
      width: '92px',
      render: (c) => <span className="font-semibold text-ink">{formatDuration(c.etaMinutes)}</span>,
    },
    {
      key: 'distance',
      header: 'Distance',
      numeric: true,
      width: '96px',
      render: (c) => <span className="text-ink-2">{formatDistance(c.distanceKm)}</span>,
    },
    {
      key: 'road',
      header: 'Road Condition',
      width: '132px',
      render: (c) =>
        c.profile ? (
          <span className={cn('font-medium', ROAD_TONE[c.profile.roadCondition])}>
            {humanizeEnum(c.profile.roadCondition)}
          </span>
        ) : (
          <span className="text-ink-3">—</span>
        ),
    },
    {
      key: 'terrain',
      header: 'Max Climb',
      numeric: true,
      width: '106px',
      render: (c) =>
        c.profile ? (
          <span className="text-ink-2">
            {c.profile.maxElevationM.toLocaleString('en-IN')} m
          </span>
        ) : (
          <span className="text-ink-3">—</span>
        ),
    },
    {
      key: 'status',
      header: 'Status',
      align: 'right',
      width: '146px',
      render: (c) => (
        <div className="flex items-center justify-end gap-1.5">
          {c.id === assignedId ? (
            <Chip tone="outline" size="sm" icon="vehicle">
              Current
            </Chip>
          ) : null}
          {c.isRecommended ? (
            <Chip tone="brand" size="sm" icon="ai">
              Recommended
            </Chip>
          ) : null}
          {c.id !== assignedId && !c.isRecommended ? (
            <span className="text-meta text-ink-3">Alternative</span>
          ) : null}
        </div>
      ),
    },
  ];

  return (
    <DataTable
      className={className}
      columns={columns}
      rows={candidates}
      rowKey={(c) => c.id}
      onRowClick={(c) => onSelect(c.id)}
      isRowActive={(c) => c.id === selectedId}
      rowAccent={(c) =>
        c.isRecommended
          ? 'bg-brand-500'
          : c.riskLevel === 'CRITICAL'
            ? RISK_TONE.CRITICAL.rail
            : undefined
      }
    />
  );
}

/**
 * The compact three-up strip used where a full table will not fit — the Delivery Intelligence
 * rail, and Route Intelligence below 1280.
 */
export function RouteStrip({
  candidates,
  selectedId,
  assignedId,
  onSelect,
  className,
}: {
  candidates: RouteCandidate[];
  selectedId: string | undefined;
  assignedId?: string;
  onSelect: (id: string) => void;
  className?: string;
}) {
  return (
    <div className={cn('grid grid-cols-3 gap-1.5', className)}>
      {candidates.map((c, i) => {
        const tone = RISK_TONE[c.riskLevel];
        const active = c.id === selectedId;
        return (
          <button
            key={c.id}
            type="button"
            onClick={() => onSelect(c.id)}
            aria-pressed={active}
            title={`${c.name} · ${formatDistance(c.distanceKm)}`}
            className={cn(
              'group relative flex flex-col items-start gap-1 overflow-hidden rounded-control border px-2 py-1.5 text-left',
              'transition-all duration-150 ease-ui',
              active
                ? 'border-ink/25 bg-panel-alt shadow-inset'
                : 'border-line bg-panel hover:border-ink-3/50 hover:bg-panel-alt',
            )}
          >
            <span
              className={cn('absolute inset-y-0 left-0 w-[3px]', ROUTE_ACCENT[i] ?? 'bg-route-c')}
            />
            {c.isRecommended ? (
              <Icon
                name="ai"
                size="sm"
                className="absolute right-1.5 top-1.5 text-brand-500"
                label="Recommended"
              />
            ) : c.id === assignedId ? (
              <Icon
                name="vehicle"
                size="sm"
                className="absolute right-1.5 top-1.5 text-ink-3"
                label="Current route"
              />
            ) : null}

            <span className="pl-1.5 text-[10px] font-semibold uppercase tracking-[0.05em] text-ink-3">
              {shortRouteName(c.name)}
            </span>
            <span className={cn('tnum pl-1.5 text-[15px] font-semibold leading-none', tone.text)}>
              {c.riskScore}%
            </span>
            <span className="tnum pl-1.5 text-[10px] text-ink-3">
              {formatDuration(c.etaMinutes)}
            </span>
          </button>
        );
      })}
    </div>
  );
}
