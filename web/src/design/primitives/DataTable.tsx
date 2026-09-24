/**
 * DataTable — the dense tabular readout.
 *
 * Generic over the row type so a column's `render` receives a fully typed row rather than
 * `any`. Rows are 40px, headers are 11px uppercase, numeric columns are right-aligned and
 * tabular, and the whole thing scrolls inside its own container so a wide table never makes
 * the page scroll sideways.
 */

import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Icon } from '../icons';

export interface Column<T> {
  /** Stable key; also the default header label if `header` is omitted. */
  key: string;
  header?: ReactNode;
  render: (row: T, index: number) => ReactNode;
  align?: 'left' | 'right' | 'center';
  /** A fixed width, e.g. '120px' or '20%'. Omit to let the column size itself. */
  width?: string;
  /** Numeric columns get tabular figures and right alignment by default. */
  numeric?: boolean;
  className?: string;
  headerClassName?: string;
}

export interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T, index: number) => string;
  onRowClick?: (row: T, index: number) => void;
  /** Adds a subtle tint to alternating rows. Off by default — hairlines usually suffice. */
  striped?: boolean;
  /** Highlights a row, e.g. the district a side panel is showing. */
  isRowActive?: (row: T, index: number) => boolean;
  /** A left accent rail per row, for risk-coded lists. */
  rowAccent?: (row: T, index: number) => string | undefined;
  /** Rendered in place of the body when `rows` is empty. */
  empty?: ReactNode;
  /** Sticky header — for tables inside a scrolling panel. */
  stickyHeader?: boolean;
  className?: string;
  density?: 'comfortable' | 'compact';
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  striped = false,
  isRowActive,
  rowAccent,
  empty,
  stickyHeader = false,
  className,
  density = 'comfortable',
}: DataTableProps<T>) {
  const rowH = density === 'compact' ? 'h-9' : 'h-10';

  if (rows.length === 0 && empty) {
    return <div className={cn('flex flex-1 items-center justify-center', className)}>{empty}</div>;
  }

  return (
    <div className={cn('w-full overflow-x-pane', className)}>
      <table className="w-full border-collapse text-body">
        <thead>
          <tr
            className={cn(
              'border-b border-line',
              stickyHeader && 'sticky top-0 z-10 bg-panel',
            )}
          >
            {columns.map((col) => (
              <th
                key={col.key}
                style={{ width: col.width }}
                className={cn(
                  'h-8 whitespace-nowrap px-3 text-label uppercase text-ink-3',
                  col.numeric || col.align === 'right'
                    ? 'text-right'
                    : col.align === 'center'
                      ? 'text-center'
                      : 'text-left',
                  col.headerClassName,
                )}
              >
                {col.header ?? col.key}
              </th>
            ))}
          </tr>
        </thead>

        <tbody>
          {rows.map((row, i) => {
            const active = isRowActive?.(row, i) ?? false;
            const accent = rowAccent?.(row, i);
            return (
              <tr
                key={rowKey(row, i)}
                onClick={onRowClick ? () => onRowClick(row, i) : undefined}
                className={cn(
                  'border-b border-line-soft transition-colors duration-100 ease-ui last:border-b-0',
                  rowH,
                  striped && i % 2 === 1 && 'bg-panel-alt',
                  active && 'bg-brand-50',
                  onRowClick && 'cursor-pointer hover:bg-panel-alt',
                  active && onRowClick && 'hover:bg-brand-50',
                )}
              >
                {columns.map((col, ci) => (
                  <td
                    key={col.key}
                    className={cn(
                      'relative px-3 align-middle',
                      col.numeric && 'tnum',
                      col.numeric || col.align === 'right'
                        ? 'text-right'
                        : col.align === 'center'
                          ? 'text-center'
                          : 'text-left',
                      col.className,
                    )}
                  >
                    {ci === 0 && accent ? (
                      <span
                        className={cn('absolute inset-y-0 left-0 w-[3px]', accent)}
                        aria-hidden
                      />
                    ) : null}
                    {col.render(row, i)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cell helpers — the shapes tables need often enough to standardise
// ---------------------------------------------------------------------------

/** A primary value with a quiet second line under it. */
export function CellStack({
  primary,
  secondary,
  className,
}: {
  primary: ReactNode;
  secondary?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex min-w-0 flex-col leading-tight', className)}>
      <span className="truncate text-body text-ink">{primary}</span>
      {secondary ? <span className="truncate text-meta text-ink-3">{secondary}</span> : null}
    </div>
  );
}

/** A monospaced-feeling code cell: vehicle codes, delivery codes, segment codes. */
export function CellCode({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cn('tnum text-body font-semibold tracking-[0.01em] text-ink', className)}>
      {children}
    </span>
  );
}

/** The "open this row" affordance, right-aligned. */
export function CellChevron({ open = false }: { open?: boolean }) {
  return (
    <Icon
      name={open ? 'chevronUp' : 'chevronRight'}
      size="sm"
      className="text-ink-3 transition-colors group-hover:text-ink-2"
    />
  );
}
