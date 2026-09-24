/**
 * The six headline figures.
 *
 * Every value comes from `getSummary()` — the component knows nothing about what the numbers
 * are, only how to present them. Tiles whose figure moved as a result of the cascade carry a
 * coloured accent rule, so on a screen with six numbers the eye lands on the ones that changed.
 *
 * `MetricValue` tweens on change, so the transition from 3 at-risk deliveries to 6 reads as a
 * measurement moving rather than a re-render.
 */

import { cn } from '@/lib/cn';
import { formatDuration } from '@/domain/format';
import type { OperationalSummary } from '@/domain/types';
import { MetricValue, SkeletonTile, StatTile } from '@/design/primitives';

export function KpiStrip({
  summary,
  loading,
  className,
}: {
  summary: OperationalSummary | undefined;
  loading: boolean;
  className?: string;
}) {
  // Six across from 1280 up. Below that, three across on two rows — two rows of three reads
  // as an instrument strip; two rows of three *stretched* tiles reads as wasted space, which is
  // what happens if the six-column break is left at 1536.
  const grid = cn('grid grid-cols-2 gap-2.5 md:grid-cols-3 xl:grid-cols-6', className);

  if (loading || !summary) {
    return (
      <div className={grid}>
        {Array.from({ length: 6 }).map((_, i) => (
          <SkeletonTile key={i} />
        ))}
      </div>
    );
  }

  const { activeDeliveries, atRiskDeliveries, roadBlockages, criticalSupplyAlerts, fieldOfficers, averageDelayMinutes } =
    summary;

  const officerPct = fieldOfficers.total
    ? Math.round((fieldOfficers.active / fieldOfficers.total) * 100)
    : 0;

  return (
    <div className={grid}>
      <StatTile
        label="Active Deliveries"
        value={activeDeliveries.value}
        icon="deliveries"
        tone="brand"
        delta={{ value: activeDeliveries.deltaPct, goodDirection: 'up' }}
        footnote={`${activeDeliveries.atRisk} at risk`}
      />

      <StatTile
        label="At-Risk Deliveries"
        value={atRiskDeliveries.value}
        icon="warning"
        tone={atRiskDeliveries.critical > 0 ? 'critical' : 'medium'}
        accent={atRiskDeliveries.critical > 0 ? 'critical' : undefined}
        delta={{ value: atRiskDeliveries.deltaPct, goodDirection: 'down' }}
        footnote={
          atRiskDeliveries.critical > 0 ? `${atRiskDeliveries.critical} critical` : 'none critical'
        }
      />

      <StatTile
        label="Road Blockages"
        value={roadBlockages.value}
        icon="blockage"
        tone={roadBlockages.major > 0 ? 'high' : 'neutral'}
        accent={roadBlockages.major > 0 ? 'high' : undefined}
        footnote={`${roadBlockages.major} major · ${roadBlockages.minor} minor`}
      />

      <StatTile
        label="Critical Supply Alerts"
        value={criticalSupplyAlerts.value}
        icon="supply"
        tone={criticalSupplyAlerts.value > 1 ? 'medium' : 'neutral'}
        accent={criticalSupplyAlerts.value > 1 ? 'medium' : undefined}
        footnote={`${criticalSupplyAlerts.districts} district${criticalSupplyAlerts.districts === 1 ? '' : 's'}`}
      />

      <StatTile
        label="Field Officers Active"
        value={fieldOfficers.active}
        icon="operations"
        tone="low"
        valueNode={
          <span className="flex items-baseline gap-1">
            <MetricValue value={fieldOfficers.active} />
            <span className="tnum text-metric-sm font-medium text-ink-3">
              / {fieldOfficers.total}
            </span>
          </span>
        }
        footnote={`${officerPct}% in field`}
      />

      <StatTile
        label="Avg Delay (Today)"
        value={averageDelayMinutes.value}
        icon="prediction"
        tone={averageDelayMinutes.value > 90 ? 'high' : 'neutral'}
        valueNode={
          <span className="t-metric whitespace-nowrap">
            {formatDuration(averageDelayMinutes.value)}
          </span>
        }
        delta={{ value: averageDelayMinutes.deltaPct, goodDirection: 'down' }}
        footnote="against yesterday"
      />
    </div>
  );
}
