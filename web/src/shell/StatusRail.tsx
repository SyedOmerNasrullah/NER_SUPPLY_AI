/**
 * StatusRail — the 30px strip along the bottom of every page.
 *
 * Carries the things an operator must be able to check without navigating: which data source is
 * answering, whether the socket is connected, which segment the simulation targets, and when
 * the world was last reset. It is also where the demo's honesty lives — in demo mode it says so,
 * in plain language, permanently on screen.
 *
 * Modelled on the status bar of a professional tool rather than a footer: hairline top, tinted
 * ground, 11px, no links.
 */

import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Icon, LiveDot, type IconName } from '@/design/primitives';

export function StatusRail({
  live,
  demoMode,
  segments,
  right,
  className,
}: {
  live: boolean;
  demoMode: boolean;
  /** Left-to-right readouts. Each is icon + label + value. */
  segments: { icon: IconName; label: string; value: ReactNode; title?: string }[];
  right?: ReactNode;
  className?: string;
}) {
  return (
    <footer
      className={cn(
        'flex h-rail shrink-0 items-center gap-3 border-t border-line bg-panel-alt px-3 text-[11px] text-ink-3',
        className,
      )}
    >
      <LiveDot live={live} />

      <Divider />

      {demoMode ? (
        <>
          <span
            title="Every value on screen comes from the deterministic demo fixtures, not from a live feed or a trained model. Phase 6 switches this to the Node API."
            className="inline-flex cursor-help items-center gap-1.5 rounded-chip bg-brand-50 px-2 py-[2px] font-semibold uppercase tracking-[0.05em] text-brand-700"
          >
            <Icon name="database" size="sm" />
            Demo data
          </span>
          <Divider />
        </>
      ) : null}

      {segments.map((s, i) => (
        <span key={s.label} className="contents">
          <span className="inline-flex items-center gap-1.5" title={s.title}>
            <Icon name={s.icon} size="sm" className="opacity-60" />
            <span className="hidden lg:inline">{s.label}</span>
            <span className="tnum font-semibold text-ink-2">{s.value}</span>
          </span>
          {i < segments.length - 1 ? <Divider /> : null}
        </span>
      ))}

      <div className="ml-auto flex items-center gap-3">{right}</div>
    </footer>
  );
}

function Divider() {
  return <span className="h-3 w-px shrink-0 bg-line" aria-hidden />;
}
