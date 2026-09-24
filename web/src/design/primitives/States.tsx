/**
 * Empty, loading and error states.
 *
 * These are the states that decide whether a product feels finished. Every one of them is a
 * designed composition here, not a centred sentence in grey — because in an operational tool
 * "nothing to show" is itself information ("no alerts on the corridor" is good news) and a
 * failure needs to say what failed and offer the one action that helps.
 */

import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Icon, IconBadge, type IconBadgeTone, type IconName } from '../icons';

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

export function Skeleton({
  className,
  rounded = 'md',
}: {
  className?: string;
  rounded?: 'sm' | 'md' | 'full';
}) {
  return (
    <div
      className={cn(
        'shimmer animate-shimmer',
        rounded === 'full' ? 'rounded-full' : rounded === 'sm' ? 'rounded-[4px]' : 'rounded-chip',
        className,
      )}
      aria-hidden
    />
  );
}

/** A skeleton shaped like a text line, at a given width. */
export function SkeletonText({ width = '100%', className }: { width?: string; className?: string }) {
  return (
    <div style={{ width }}>
      <Skeleton className={cn('h-3 w-full', className)} rounded="sm" />
    </div>
  );
}

/** N rows shaped like table rows — the standard list placeholder. */
export function SkeletonRows({ rows = 5, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn('flex flex-col', className)} aria-busy="true" aria-live="polite">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex h-10 items-center gap-3 border-b border-line-soft px-3 last:border-b-0">
          <Skeleton className="h-3 w-3 shrink-0" rounded="full" />
          <Skeleton className="h-3 flex-1" rounded="sm" />
          <Skeleton className="h-3 w-16 shrink-0" rounded="sm" />
          <Skeleton className="h-3 w-10 shrink-0" rounded="sm" />
        </div>
      ))}
    </div>
  );
}

/** A skeleton shaped like a StatTile, so the top strip does not reflow when data lands. */
export function SkeletonTile({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'flex items-start gap-3 rounded-panel border border-line bg-panel p-3.5 shadow-panel',
        className,
      )}
      aria-busy="true"
    >
      <Skeleton className="h-9 w-9 shrink-0" />
      <div className="flex flex-1 flex-col gap-2 pt-0.5">
        <Skeleton className="h-2.5 w-24" rounded="sm" />
        <Skeleton className="h-6 w-16" rounded="sm" />
        <Skeleton className="h-2.5 w-20" rounded="sm" />
      </div>
    </div>
  );
}

/** A well-shaped placeholder for a map or chart panel. */
export function SkeletonPane({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'texture-grid flex min-h-[160px] flex-1 items-center justify-center rounded-panel bg-panel-alt',
        className,
      )}
      aria-busy="true"
    >
      <span className="flex items-center gap-2 rounded-chip bg-panel/90 px-2.5 py-1.5 text-meta text-ink-3 shadow-panel">
        <Icon name="spinner" size="sm" className="animate-spin" />
        Loading
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// EmptyState
// ---------------------------------------------------------------------------

export interface EmptyStateProps {
  icon?: IconName;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  /** `positive` for empties that are good news — no alerts, no blockages. */
  tone?: 'neutral' | 'positive';
  size?: 'sm' | 'md';
  className?: string;
}

export function EmptyState({
  icon = 'ok',
  title,
  description,
  action,
  tone = 'neutral',
  size = 'md',
  className,
}: EmptyStateProps) {
  const badgeTone: IconBadgeTone = tone === 'positive' ? 'low' : 'neutral';

  return (
    <div
      className={cn(
        'flex flex-1 flex-col items-center justify-center gap-2 text-center',
        size === 'sm' ? 'px-4 py-6' : 'px-6 py-10',
        className,
      )}
    >
      <IconBadge name={icon} tone={badgeTone} size={size === 'sm' ? 'md' : 'lg'} />
      <p className={cn('mt-1 font-semibold text-ink', size === 'sm' ? 'text-body' : 'text-title')}>
        {title}
      </p>
      {description ? (
        <p className="max-w-[36ch] text-meta leading-relaxed text-ink-2">{description}</p>
      ) : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ErrorState
// ---------------------------------------------------------------------------

export interface ErrorStateProps {
  title?: string;
  message: string;
  /** HTTP status, shown quietly. A 503 tells a different story from a 500. */
  status?: number;
  onRetry?: () => void;
  size?: 'sm' | 'md';
  className?: string;
}

/**
 * The previous build showed "… is unavailable. Retry in a moment." with no retry button, so the
 * only recovery was navigating away and back. This one always offers the action.
 */
export function ErrorState({
  title = 'This panel could not load',
  message,
  status,
  onRetry,
  size = 'md',
  className,
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-1 flex-col items-center justify-center gap-2 text-center',
        size === 'sm' ? 'px-4 py-6' : 'px-6 py-10',
        className,
      )}
    >
      <IconBadge name="warning" tone="critical" size={size === 'sm' ? 'md' : 'lg'} />
      <p className={cn('mt-1 font-semibold text-ink', size === 'sm' ? 'text-body' : 'text-title')}>
        {title}
      </p>
      <p className="max-w-[40ch] text-meta leading-relaxed text-ink-2">{message}</p>
      {status ? (
        <span className="tnum text-[10.5px] uppercase tracking-[0.06em] text-ink-3">
          HTTP {status}
        </span>
      ) : null}
      {onRetry ? (
        <button type="button" onClick={onRetry} className="btn btn-secondary btn-sm mt-2">
          <Icon name="refresh" size="sm" />
          Try again
        </button>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Async — one place that renders the right state
// ---------------------------------------------------------------------------

/**
 * Renders loading, error, empty or content from a `useResource` result, so a page never spells
 * the four-branch conditional out again. The skeleton is a prop because the right placeholder
 * for a table is not the right placeholder for a map.
 */
export function Async<T>({
  state,
  skeleton,
  empty,
  isEmpty,
  children,
}: {
  state: { data: T | undefined; loading: boolean; error?: { message: string; status: number }; reload: () => void };
  skeleton: ReactNode;
  empty?: ReactNode;
  isEmpty?: (data: T) => boolean;
  children: (data: T) => ReactNode;
}) {
  if (state.error) {
    return (
      <ErrorState message={state.error.message} status={state.error.status} onRetry={state.reload} />
    );
  }
  if (state.loading || state.data === undefined) return <>{skeleton}</>;
  if (empty && isEmpty?.(state.data)) return <>{empty}</>;
  return <>{children(state.data)}</>;
}
