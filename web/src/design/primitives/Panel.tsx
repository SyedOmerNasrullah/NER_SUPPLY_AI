/**
 * Panel — the product's surface vocabulary.
 *
 * The rule that produces visual coherence across twelve dissimilar blocks: every panel has the
 * same 38px header, the same uppercase label, and the same optional right-aligned action.
 *
 * The rule that stops the result being a field of identical white cards: `variant`. A panel can
 * be a plain surface, a flush section inside a larger frame, a sunk well, a navy institutional
 * block, or a control floating on top of the map. Features pick a variant for a reason —
 * "everything is `default`" is the failure mode this exists to prevent.
 */

import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Icon, type IconName } from '../icons';

export type PanelVariant = 'default' | 'flush' | 'sunk' | 'navy' | 'float' | 'bare';

const VARIANT: Record<PanelVariant, string> = {
  /** The standard raised white surface. */
  default: 'bg-panel border border-line rounded-panel shadow-panel',
  /** No border or radius — a section inside an already-bordered frame. */
  flush: 'bg-panel',
  /** A recessed well: charts, map wells, code-like readouts. */
  sunk: 'bg-panel-alt border border-line rounded-panel',
  /** Institutional navy — identity blocks, hero-adjacent panels, map side rails. */
  navy: 'surface-navy texture-contour rounded-panel shadow-raised',
  /** Floats above the map. Heavier shadow, translucent, blurred. */
  float: 'bg-panel/95 backdrop-blur-md border border-white/60 rounded-panel shadow-float',
  /** Structure only. For panels whose child paints its own ground (map, image). */
  bare: 'rounded-panel overflow-hidden',
};

export interface PanelProps {
  children?: ReactNode;
  variant?: PanelVariant;
  className?: string;
  /** Content area scrolls instead of growing the panel. */
  scroll?: boolean;
  /** Removes the default padding — for tables and maps that go edge to edge. */
  flushBody?: boolean;
}

export function Panel({
  children,
  variant = 'default',
  className,
  scroll = false,
  flushBody = false,
}: PanelProps) {
  return (
    <section
      className={cn(
        'flex min-h-0 min-w-0 flex-col',
        VARIANT[variant],
        variant === 'default' || variant === 'sunk' ? 'overflow-hidden' : undefined,
        className,
      )}
    >
      <div
        className={cn(
          'flex min-h-0 flex-1 flex-col',
          !flushBody && 'p-4',
          scroll && 'overflow-y-auto scroll-thin',
        )}
      >
        {children}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// PanelHeader
// ---------------------------------------------------------------------------

export interface PanelHeaderProps {
  title: string;
  /** Sits under the title in metadata grey. One short line. */
  subtitle?: string;
  icon?: IconName;
  /** Right-aligned controls: a "View all" link, a filter, a segmented switch. */
  actions?: ReactNode;
  /** A count or status chip immediately after the title. */
  badge?: ReactNode;
  /** Renders on a navy panel. */
  onNavy?: boolean;
  className?: string;
}

/**
 * The header every panel shares. Fixed height so a row of panels aligns on the first pixel of
 * body content regardless of whether one of them has a subtitle.
 */
export function PanelHeader({
  title,
  subtitle,
  icon,
  actions,
  badge,
  onNavy = false,
  className,
}: PanelHeaderProps) {
  return (
    <header
      className={cn(
        'flex shrink-0 items-center gap-2.5 border-b px-4',
        subtitle ? 'h-[52px]' : 'h-[38px]',
        onNavy ? 'border-white/12' : 'border-line-soft',
        className,
      )}
    >
      {icon ? (
        <Icon name={icon} size="md" className={onNavy ? 'text-white/60' : 'text-ink-3'} />
      ) : null}

      <div className="flex min-w-0 flex-col justify-center">
        <div className="flex items-center gap-2">
          <h2
            title={title}
            className={cn(
              'truncate text-section',
              onNavy ? 'text-white' : 'text-ink',
            )}
          >
            {title}
          </h2>
          {badge}
        </div>
        {subtitle ? (
          <p
            title={subtitle}
            className={cn('truncate text-meta', onNavy ? 'text-white/55' : 'text-ink-3')}
          >
            {subtitle}
          </p>
        ) : null}
      </div>

      {actions ? <div className="ml-auto flex shrink-0 items-center gap-1.5">{actions}</div> : null}
    </header>
  );
}

// ---------------------------------------------------------------------------
// Composition helpers
// ---------------------------------------------------------------------------

/**
 * A panel with a header. Kept separate from `Panel` so a header-less panel does not carry an
 * empty header slot, and so a map panel can put its header *over* the map if it wants to.
 */
export function PanelFrame({
  header,
  children,
  variant = 'default',
  className,
  bodyClassName,
  scroll = false,
  flushBody = false,
}: {
  header: ReactNode;
  children?: ReactNode;
  variant?: PanelVariant;
  className?: string;
  bodyClassName?: string;
  scroll?: boolean;
  flushBody?: boolean;
}) {
  return (
    <section
      className={cn(
        'flex min-h-0 min-w-0 flex-col overflow-hidden',
        VARIANT[variant],
        className,
      )}
    >
      {header}
      <div
        className={cn(
          'flex min-h-0 flex-1 flex-col',
          !flushBody && 'p-4',
          scroll && 'overflow-y-auto scroll-thin',
          bodyClassName,
        )}
      >
        {children}
      </div>
    </section>
  );
}

/** A hairline-separated strip at the bottom of a panel — totals, provenance, a single action. */
export function PanelFooter({
  children,
  onNavy = false,
  className,
}: {
  children: ReactNode;
  onNavy?: boolean;
  className?: string;
}) {
  return (
    <footer
      className={cn(
        'flex shrink-0 items-center gap-2 border-t px-4 py-2',
        onNavy ? 'border-white/12 text-white/60' : 'border-line-soft bg-panel-alt text-ink-3',
        'text-meta',
        className,
      )}
    >
      {children}
    </footer>
  );
}

/** A labelled band inside a panel body — groups rows without adding another card. */
export function PanelSection({
  label,
  actions,
  children,
  className,
}: {
  label?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-2', className)}>
      {label || actions ? (
        <div className="flex items-center justify-between gap-2">
          {label ? <span className="t-label">{label}</span> : <span />}
          {actions}
        </div>
      ) : null}
      {children}
    </div>
  );
}
