/**
 * Recent Movements — the fleet's last position reports.
 *
 * Labelled as a synthetic operational feed, because that is what it is: in demo mode these are
 * seeded records, and in Phase 6 they become Socket.IO position updates. The "Live" chip
 * describes the *feed*, not the provenance of the data, and the provenance marker in the footer
 * keeps that distinction honest.
 */

import { cn } from '@/lib/cn';
import { formatDuration } from '@/domain/format';
import type { MovementsResponse, VehicleMovement } from '@/domain/types';
import type { ResourceState } from '@/data/hooks';
import {
  Async,
  EmptyState,
  Icon,
  PanelFrame,
  PanelHeader,
  ProvenanceTag,
  SkeletonRows,
  StatusDot,
} from '@/design/primitives';

const STATUS_META: Record<
  VehicleMovement['status'],
  { level: 'LOW' | 'HIGH' | 'CRITICAL'; label: string }
> = {
  ON_ROUTE: { level: 'LOW', label: 'On Route' },
  DELAYED: { level: 'HIGH', label: 'Delayed' },
  STOPPED: { level: 'CRITICAL', label: 'Stopped' },
};

export function RecentMovementsPanel({
  movements,
  live,
  className,
}: {
  movements: ResourceState<MovementsResponse>;
  live: boolean;
  className?: string;
}) {
  return (
    <PanelFrame
      className={cn('min-h-0', className)}
      flushBody
      scroll
      header={
        <PanelHeader
          title="Recent Movements"
          icon="vehicle"
          actions={
            <span
              className={cn(
                'inline-flex items-center gap-1.5 rounded-chip px-2 py-[2px] text-[10.5px] font-semibold',
                live ? 'bg-risk-wash-low text-risk-low' : 'bg-panel-sunk text-ink-3',
              )}
              title={
                live
                  ? 'The position feed is connected. Records shown are synthetic operational data.'
                  : 'The position feed is not connected.'
              }
            >
              <StatusDot level={live ? 'LOW' : 'CRITICAL'} pulse={live} size="sm" />
              {live ? 'Live' : 'Offline'}
            </span>
          }
        />
      }
    >
      <Async
        state={movements}
        skeleton={<SkeletonRows rows={4} />}
        isEmpty={(d) => d.movements.length === 0}
        empty={
          <EmptyState
            icon="vehicle"
            size="sm"
            title="No recent movements"
            description="No vehicle has reported a position in the current window."
          />
        }
      >
        {(d) => (
          <>
            <ul className="flex flex-col">
              {d.movements.map((m) => {
                const meta = STATUS_META[m.status];
                return (
                  <li
                    key={m.id}
                    className="flex items-center gap-3 border-b border-line-soft px-3 py-2 transition-colors duration-100 ease-ui last:border-b-0 hover:bg-panel-alt"
                  >
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px] bg-panel-sunk text-ink-2">
                      <Icon name="vehicle" size="sm" />
                    </span>

                    <span className="tnum w-[52px] shrink-0 text-body font-semibold text-ink">
                      {m.vehicleCode}
                    </span>

                    <span className="tnum w-[58px] shrink-0 text-meta text-ink-2">
                      {m.deliveryCode}
                    </span>

                    <span className="flex min-w-0 flex-1 items-center gap-1.5">
                      <Icon name="destination" size="sm" className="shrink-0 text-ink-3" />
                      <span className="truncate text-meta text-ink-2">{m.place}</span>
                    </span>

                    <span className="flex shrink-0 items-center gap-1.5">
                      {m.delayMinutes ? (
                        <span className="tnum text-[10.5px] font-semibold text-risk-high">
                          +{formatDuration(m.delayMinutes)}
                        </span>
                      ) : null}
                      <StatusDot
                        level={meta.level}
                        pulse={m.status === 'ON_ROUTE'}
                        label={meta.label}
                        size="sm"
                      />
                    </span>
                  </li>
                );
              })}
            </ul>

            <div className="flex items-center justify-between gap-2 border-t border-line-soft bg-panel-alt px-3 py-1.5">
              <span className="text-[10px] text-ink-3">
                Positions are seeded demo records, not GPS telemetry.
              </span>
              <ProvenanceTag kind="SYNTHETIC_OPERATIONAL" subtle />
            </div>
          </>
        )}
      </Async>
    </PanelFrame>
  );
}
