/**
 * The downstream consequence, and who was told about it.
 *
 * This is the panel that makes the product's argument: a delayed truck is not a logistics
 * inconvenience, it is a hospital running out of medicine in 32 hours. Putting it on the
 * delivery page — rather than leaving it on Supply Intelligence — is what turns two features
 * into one causal chain.
 */

import { cn } from '@/lib/cn';
import { formatAge, formatNumber, formatStockout, humanizeEnum } from '@/domain/format';
import { RISK_TONE, stockoutAsRiskLevel, stockoutUrgency } from '@/domain/thresholds';
import type { AIRecommendation, District, NotificationRecord, SupplyCategory } from '@/domain/types';
import {
  Button,
  Callout,
  Chip,
  Icon,
  Meter,
  ProvenanceTag,
  StatRow,
  StockoutChip,
  type IconName,
} from '@/design/primitives';

const CATEGORY_ICON: Record<SupplyCategory, IconName> = {
  medicine: 'medicine',
  food: 'food',
  fuel: 'fuel',
};

/** Which of a district's three lines this delivery actually affects. */
export function categoryForCargo(cargoType: string): SupplyCategory {
  const t = cargoType.toLowerCase();
  if (t.includes('fuel')) return 'fuel';
  if (t.includes('food')) return 'food';
  return 'medicine';
}

export function SupplyConsequence({
  district,
  category,
  recommendation,
  onViewSupply,
  className,
}: {
  district: District | undefined;
  category: SupplyCategory;
  recommendation: AIRecommendation | undefined;
  onViewSupply: () => void;
  className?: string;
}) {
  if (!district) {
    return (
      <p className={cn('text-meta text-ink-3', className)}>
        No destination district is linked to this delivery, so no supply impact can be projected.
      </p>
    );
  }

  const line = district.stock[category];
  const hours = line.predictedStockoutHours;
  const urgency = stockoutUrgency(hours);
  const level = stockoutAsRiskLevel(hours);
  const tone = level ? RISK_TONE[level] : RISK_TONE.LOW;

  // Days of cover the current stock represents, as the meter's capacity.
  const coverCeilingHours = Math.max(96, (hours ?? 0) * 1.6);

  return (
    <div className={cn('flex min-w-0 flex-col gap-3.5', className)}>
      {/* --- The headline consequence ------------------------------------- */}
      <div
        className={cn(
          'flex items-center gap-4 rounded-panel border px-3.5 py-3',
          urgency === 'CRITICAL' ? cn(tone.wash, tone.border) : 'border-line bg-panel-alt',
        )}
      >
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-ink-3">
            <Icon name={CATEGORY_ICON[category]} size="sm" />
            {district.name} · {humanizeEnum(category)}
          </span>
          <span className="text-meta text-ink-2">Projected stockout</span>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1">
          <span className={cn('tnum text-[28px] font-semibold leading-none', tone.text)}>
            {formatStockout(hours)}
          </span>
          <StockoutChip hours={hours} />
        </div>
      </div>

      {/* --- The arithmetic behind it -------------------------------------- */}
      <Meter
        label="Cover remaining against the 48-hour safety line"
        value={hours ?? 0}
        max={coverCeilingHours}
        unit="h"
        level={level ?? 'LOW'}
        marker={(48 / coverCeilingHours) * 100}
        markerLabel="48h safety line"
      />

      <div className="flex flex-col divide-y divide-line-soft">
        <StatRow label="Current stock" value={`${formatNumber(line.currentStock)} units`} icon="supply" />
        <StatRow
          label="Daily consumption"
          value={`${formatNumber(line.dailyConsumption)} / day`}
          icon="analytics"
        />
      </div>

      {/* --- What to do about it ------------------------------------------- */}
      {recommendation ? (
        <Callout tone="brand" icon="ai" title="Pre-positioning recommendation">
          {recommendation.recommendationText}
        </Callout>
      ) : (
        <Callout tone="neutral" icon="ok" title="No pre-positioning required">
          The destination is holding above its safety threshold at the current projection.
        </Callout>
      )}

      <Button variant="secondary" iconRight="arrowRight" onClick={onViewSupply} className="w-full">
        View supply impact
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

const STATUS_META: Record<
  NotificationRecord['status'],
  { tone: string; icon: IconName; label: string }
> = {
  DELIVERED: { tone: 'text-risk-low', icon: 'ok', label: 'Delivered' },
  SENT: { tone: 'text-risk-low', icon: 'ok', label: 'Sent' },
  QUEUED: { tone: 'text-ink-2', icon: 'spinner', label: 'Queued' },
  FAILED: { tone: 'text-risk-critical', icon: 'close', label: 'Failed' },
};

const CHANNEL_ICON: Record<NotificationRecord['channel'], IconName> = {
  SMS: 'notify',
  CALL: 'notify',
  DASHBOARD: 'alert',
};

/**
 * Who was told, on which channel, and whether it actually left.
 *
 * The failed row is deliberately kept and shown in full: contract 6.11 requires a downstream
 * notification failure to be reported as a failure rather than swallowed, and a console that
 * quietly hides the rejected voice call is exactly the dishonesty this project must not ship.
 */
export function NotificationStatus({
  notifications,
  now,
  className,
}: {
  notifications: NotificationRecord[];
  now: number;
  className?: string;
}) {
  if (notifications.length === 0) {
    return (
      <div className={cn('flex flex-col gap-2', className)}>
        <p className="text-meta text-ink-3">
          No notification has been dispatched for this delivery. Alerts are raised on the
          dashboard; escalation to SMS or voice happens only when the decision engine marks an
          alert critical.
        </p>
      </div>
    );
  }

  return (
    <div className={cn('flex min-w-0 flex-col gap-2', className)}>
      <ul className="flex flex-col divide-y divide-line-soft">
        {notifications.map((n) => {
          const meta = STATUS_META[n.status];
          return (
            <li key={n.id} className="flex items-start gap-3 py-2.5">
              <span
                className={cn(
                  'mt-[1px] flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px] ring-1',
                  n.status === 'FAILED'
                    ? 'bg-risk-wash-critical text-risk-critical ring-risk-critical/12'
                    : 'bg-risk-wash-low text-risk-low ring-risk-low/12',
                )}
              >
                <Icon name={CHANNEL_ICON[n.channel]} size="sm" />
              </span>

              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <div className="flex items-center gap-2">
                  <span className="text-body font-medium text-ink">{n.recipientName}</span>
                  <Chip tone="outline" size="sm">
                    {n.channel}
                  </Chip>
                  <span
                    className={cn(
                      'ml-auto flex shrink-0 items-center gap-1 text-[11px] font-semibold',
                      meta.tone,
                    )}
                  >
                    <Icon name={meta.icon} size="sm" />
                    {meta.label}
                  </span>
                </div>
                <p className="truncate text-meta text-ink-2" title={n.alertTitle}>
                  {n.alertTitle}
                </p>
                <p className="text-[10px] text-ink-3">
                  {humanizeEnum(n.recipientRole)} · {formatAge(n.sentAt, now)}
                </p>
                {n.failureReason ? (
                  <p className="mt-0.5 rounded-[5px] bg-risk-wash-critical px-2 py-1 text-[10.5px] leading-snug text-risk-critical">
                    {n.failureReason}
                  </p>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>

      <div className="flex items-center justify-between gap-2 border-t border-line-soft pt-2">
        <span className="text-[10px] leading-snug text-ink-3">
          A rejected notification does not fail the decision pipeline — the alert stands and the
          cascade completes regardless.
        </span>
        <ProvenanceTag kind="EXTERNAL_API" subtle />
      </div>
    </div>
  );
}
