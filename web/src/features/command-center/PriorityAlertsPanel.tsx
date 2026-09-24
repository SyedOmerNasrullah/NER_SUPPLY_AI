/**
 * The priority alert feed — the left column.
 *
 * Ordering is the backend's (severity, then recency) and is rendered as received; the client
 * does not re-sort, so a mismatch between the two adapters shows up as a visible bug rather
 * than being papered over here.
 *
 * Selecting an alert opens a detail panel rather than navigating: an operator reading the feed
 * is watching the map at the same time, and the side panel keeps both on screen.
 */

import { useState } from 'react';
import { cn } from '@/lib/cn';
import { formatAge, formatDate, formatTime } from '@/domain/format';
import { RISK_TONE } from '@/domain/thresholds';
import type { Alert } from '@/domain/types';
import type { ResourceState } from '@/data/hooks';
import type { AlertsResponse } from '@/domain/types';
import {
  AlertRow,
  Async,
  Button,
  Chip,
  EmptyState,
  Icon,
  IconBadge,
  PanelFrame,
  PanelHeader,
  ProvenanceTag,
  SidePanel,
  SkeletonRows,
  StatRow,
} from '@/design/primitives';

export function PriorityAlertsPanel({
  alerts,
  now,
  className,
}: {
  alerts: ResourceState<AlertsResponse>;
  now: number;
  className?: string;
}) {
  const [selected, setSelected] = useState<Alert | null>(null);

  const criticalCount = (alerts.data?.alerts ?? []).filter((a) => a.severity === 'CRITICAL').length;

  return (
    <>
      <PanelFrame
        className={cn('min-h-0', className)}
        flushBody
        scroll
        header={
          <PanelHeader
            title="Priority Alerts"
            icon="alert"
            badge={
              criticalCount > 0 ? (
                <Chip tone="neutral" size="sm" className="bg-risk-wash-critical text-risk-critical">
                  {criticalCount} critical
                </Chip>
              ) : undefined
            }
            actions={
              <Button variant="ghost" size="sm" iconRight="arrowRight">
                View All
              </Button>
            }
          />
        }
      >
        <div id="priority-alerts">
          <Async
            state={alerts}
            skeleton={<SkeletonRows rows={5} />}
            isEmpty={(d) => d.alerts.length === 0}
            empty={
              <EmptyState
                tone="positive"
                icon="ok"
                size="sm"
                title="No alerts on the corridor"
                description="Every monitored segment is open and no delivery is currently flagged at risk."
              />
            }
          >
            {(d) =>
              d.alerts.map((alert) => (
                <AlertRow
                  key={alert.id}
                  alert={alert}
                  now={now}
                  onClick={() => setSelected(alert)}
                  className={cn(
                    selected?.id === alert.id && 'ring-1 ring-inset ring-brand-500/40',
                  )}
                />
              ))
            }
          </Async>
        </div>
      </PanelFrame>

      <AlertDetail alert={selected} now={now} onClose={() => setSelected(null)} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Detail
// ---------------------------------------------------------------------------

function AlertDetail({
  alert,
  now,
  onClose,
}: {
  alert: Alert | null;
  now: number;
  onClose: () => void;
}) {
  if (!alert) return null;
  const tone = RISK_TONE[alert.severity];

  return (
    <SidePanel
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={alert.title}
      subtitle={`Raised ${formatAge(alert.createdAt, now)} · ${formatTime(alert.createdAt)}`}
      width={420}
      headerAccessory={
        <span
          className={cn(
            'inline-flex shrink-0 items-center rounded-chip border px-2 py-[2px] text-[11px] font-bold uppercase tracking-[0.05em]',
            tone.wash,
            tone.text,
            tone.border,
          )}
        >
          {alert.severity}
        </span>
      }
      footer={
        <>
          <ProvenanceTag kind="SYNTHETIC_OPERATIONAL" />
          <Button variant="secondary" size="sm" icon="check" className="ml-auto" onClick={onClose}>
            Acknowledge
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4 p-5">
        <div className={cn('flex items-start gap-3 rounded-panel border px-3.5 py-3', tone.wash, tone.border)}>
          <IconBadge
            name={alert.severity === 'CRITICAL' ? 'critical' : alert.severity === 'LOW' ? 'info' : 'warning'}
            tone={
              alert.severity === 'CRITICAL'
                ? 'critical'
                : alert.severity === 'HIGH'
                  ? 'high'
                  : alert.severity === 'MEDIUM'
                    ? 'medium'
                    : 'neutral'
            }
          />
          <p className="text-body leading-relaxed text-ink">{alert.message}</p>
        </div>

        <div className="flex flex-col divide-y divide-line-soft">
          <StatRow label="Severity" value={alert.severity} emphasis icon="risk" />
          <StatRow label="Raised" value={formatTime(alert.createdAt)} icon="live" />
          <StatRow label="Date" value={formatDate(alert.createdAt)} icon="analytics" />
          <StatRow
            label="Officer notified"
            icon="notify"
            emphasis
            value={
              alert.notifiedViaTwilio ? (
                <span className="inline-flex items-center gap-1 text-risk-low">
                  <Icon name="ok" size="sm" />
                  SMS sent
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-ink-3">
                  <Icon name="close" size="sm" />
                  Not sent
                </span>
              )
            }
          />
        </div>

        {!alert.notifiedViaTwilio ? (
          <p className="rounded-panel border border-line bg-panel-alt px-3 py-2.5 text-meta leading-relaxed text-ink-2">
            No notification was dispatched for this alert. When a dispatch is attempted and the
            provider rejects it, the alert is still created and the cascade still completes — the
            interface reports the notification as failed rather than claiming success.
          </p>
        ) : null}
      </div>
    </SidePanel>
  );
}
