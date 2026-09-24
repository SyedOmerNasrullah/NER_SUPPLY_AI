/**
 * Supply Status — the downstream consequence.
 *
 * A district's headline supply problem is whichever of its three categories is closest to
 * running out, so the panel reduces each district to that one line and ranks the whole region
 * by urgency. That ranking is what makes the cascade visible here: when Tawang's medicine
 * projection crosses the 48-hour line it rises to the top of this table on its own, without the
 * component knowing anything about the demo scenario.
 *
 * Every status chip resolves through `stockoutUrgency` in `domain/thresholds` — the contract's
 * own <48h / 48-96h / >=96h rule, defined once.
 */

import { useMemo } from 'react';
import { cn } from '@/lib/cn';
import { formatNumber, formatStockout, humanizeEnum } from '@/domain/format';
import { stockoutUrgency } from '@/domain/thresholds';
import type { District, DistrictsResponse, SupplyCategory } from '@/domain/types';
import type { ResourceState } from '@/data/hooks';
import {
  Async,
  Button,
  CellStack,
  DataTable,
  EmptyState,
  Icon,
  PanelFrame,
  PanelHeader,
  ProvenanceTag,
  SkeletonRows,
  StockoutChip,
  type Column,
  type IconName,
} from '@/design/primitives';

interface SupplyLine {
  districtId: string;
  district: string;
  category: SupplyCategory;
  currentStock: number;
  dailyConsumption: number;
  stockoutHours: number | null;
}

const CATEGORY_ICON: Record<SupplyCategory, IconName> = {
  medicine: 'medicine',
  food: 'food',
  fuel: 'fuel',
};

/** The category closest to running out. Districts with no projection at all are dropped. */
function mostUrgentLine(district: District): SupplyLine | null {
  const categories: SupplyCategory[] = ['medicine', 'food', 'fuel'];
  let worst: SupplyLine | null = null;

  for (const category of categories) {
    const line = district.stock[category];
    if (line.predictedStockoutHours === null) continue;
    if (worst === null || line.predictedStockoutHours < (worst.stockoutHours ?? Infinity)) {
      worst = {
        districtId: district.id,
        district: district.name,
        category,
        currentStock: line.currentStock,
        dailyConsumption: line.dailyConsumption,
        stockoutHours: line.predictedStockoutHours,
      };
    }
  }
  return worst;
}

export function SupplyStatusPanel({
  districts,
  limit = 4,
  onSelectDistrict,
  className,
}: {
  districts: ResourceState<DistrictsResponse>;
  limit?: number;
  onSelectDistrict?: (districtId: string) => void;
  className?: string;
}) {
  const rows = useMemo<SupplyLine[]>(() => {
    const all = (districts.data?.districts ?? [])
      .map(mostUrgentLine)
      .filter((l): l is SupplyLine => l !== null);
    all.sort((a, b) => (a.stockoutHours ?? Infinity) - (b.stockoutHours ?? Infinity));
    return all.slice(0, limit);
  }, [districts.data, limit]);

  const criticalCount = rows.filter((r) => stockoutUrgency(r.stockoutHours) === 'CRITICAL').length;

  const columns: Column<SupplyLine>[] = [
    {
      key: 'district',
      header: 'District',
      render: (r) => <CellStack primary={r.district} />,
    },
    {
      key: 'category',
      header: 'Category',
      width: '116px',
      render: (r) => (
        <span className="flex items-center gap-1.5 text-ink-2">
          <Icon name={CATEGORY_ICON[r.category]} size="sm" className="text-ink-3" />
          {humanizeEnum(r.category)}
        </span>
      ),
    },
    {
      key: 'stock',
      header: 'Current Stock',
      numeric: true,
      render: (r) => formatNumber(r.currentStock),
    },
    {
      key: 'consumption',
      header: 'Consumption',
      numeric: true,
      render: (r) => <span className="text-ink-2">{r.dailyConsumption}/day</span>,
    },
    {
      key: 'stockout',
      header: 'Stockout In',
      numeric: true,
      width: '104px',
      render: (r) => {
        const urgency = stockoutUrgency(r.stockoutHours);
        return (
          <span
            className={cn(
              'font-semibold',
              urgency === 'CRITICAL' ? 'text-risk-critical' : 'text-ink',
            )}
          >
            {formatStockout(r.stockoutHours)}
          </span>
        );
      },
    },
    {
      key: 'status',
      header: 'Status',
      align: 'right',
      width: '104px',
      render: (r) => <StockoutChip hours={r.stockoutHours} />,
    },
  ];

  return (
    <PanelFrame
      className={cn('min-h-0', className)}
      flushBody
      scroll
      header={
        <PanelHeader
          title="Supply Status"
          subtitle={
            criticalCount > 0
              ? `${criticalCount} district${criticalCount === 1 ? '' : 's'} below the 48-hour safety line`
              : 'Critical districts, ranked by projected stockout'
          }
          icon="supply"
          actions={
            <Button variant="ghost" size="sm" iconRight="arrowRight">
              View All
            </Button>
          }
        />
      }
    >
      <Async
        state={districts}
        skeleton={<SkeletonRows rows={4} />}
        isEmpty={() => rows.length === 0}
        empty={
          <EmptyState
            tone="positive"
            icon="ok"
            size="sm"
            title="No stockout projections"
            description="Every district is holding above its safety threshold."
          />
        }
      >
        {() => (
          <>
            <DataTable
              columns={columns}
              rows={rows}
              rowKey={(r) => `${r.districtId}-${r.category}`}
              density="compact"
              onRowClick={onSelectDistrict ? (r) => onSelectDistrict(r.districtId) : undefined}
              rowAccent={(r) => {
                const urgency = stockoutUrgency(r.stockoutHours);
                return urgency === 'CRITICAL'
                  ? 'bg-risk-critical'
                  : urgency === 'WARNING'
                    ? 'bg-risk-medium'
                    : undefined;
              }}
            />
            <div className="flex items-center justify-between gap-2 border-t border-line-soft bg-panel-alt px-3 py-1.5">
              <span className="text-[10px] text-ink-3">
                Projection is delay-adjusted: a late delivery shortens the runway.
              </span>
              <ProvenanceTag kind="SYNTHETIC_OPERATIONAL" subtle />
            </div>
          </>
        )}
      </Async>
    </PanelFrame>
  );
}
