/**
 * The application header.
 *
 * White, 54px, with a hairline and a soft shadow that separates the whole header block from
 * the ground. Identity on the left, the institutional positioning line in the middle, live
 * status and identity on the right.
 *
 * The middle line is not decoration: "Logistics Intelligence for the North Eastern Region"
 * states what the product is for a judge who has been looking at eleven other dashboards.
 */

import { cn } from '@/lib/cn';
import { formatDate, formatTime } from '@/domain/format';
import type { User } from '@/domain/types';
import { Button, Icon, LiveDot } from '@/design/primitives';
import { BrandLockup } from './BrandMark';
import { UserMenu } from './UserMenu';

export interface TopBarProps {
  user: User;
  onSignOut: () => void;
  /** ISO instant shown in the clock. The demo clock, so it never drifts mid-rehearsal. */
  nowIso: string;
  /** Real socket connection state once Phase 6 wires it; the demo adapter reports connected. */
  live: boolean;
  /** Unacknowledged critical + high alerts. */
  alertCount: number;
  onOpenAlerts?: () => void;
  /**
   * Restores the seeded demo world. ADMIN only, and only while the demo adapter is in use —
   * there is no such thing as resetting a real deployment, so the control simply is not there.
   */
  canResetDemo?: boolean;
  onResetDemo?: () => void;
  resettingDemo?: boolean;
  className?: string;
}

export function TopBar({
  user,
  onSignOut,
  nowIso,
  live,
  alertCount,
  onOpenAlerts,
  canResetDemo,
  onResetDemo,
  resettingDemo,
  className,
}: TopBarProps) {
  return (
    <header
      className={cn(
        'flex h-chrome shrink-0 items-center gap-4 border-b border-line bg-panel px-4',
        className,
      )}
    >
      <BrandLockup />

      <span className="h-7 w-px shrink-0 bg-line" aria-hidden />

      {/* Positioning line. Hidden below 1280 where the tab bar needs the room more. */}
      <div className="hidden min-w-0 flex-col leading-none xl:flex">
        <span className="truncate text-[12.5px] font-semibold text-ink">
          Logistics Intelligence for the North Eastern Region
        </span>
        <span className="mt-[3px] truncate text-[10.5px] text-ink-3">
          Safer Roads. Stronger Communities. Resilient Tomorrow.
        </span>
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-3">
        {/* Clock — reads from the demo instant, not the wall clock. */}
        <div className="hidden flex-col items-end leading-none md:flex">
          <span className="tnum text-[12.5px] font-semibold text-ink">{formatTime(nowIso)}</span>
          <span className="tnum mt-[3px] text-[10.5px] text-ink-3">{formatDate(nowIso)}</span>
        </div>

        <span className="hidden h-7 w-px shrink-0 bg-line md:block" aria-hidden />

        <LiveDot live={live} className="hidden sm:inline-flex" />

        <button
          type="button"
          onClick={onOpenAlerts}
          aria-label={`${alertCount} active alerts`}
          className="relative inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-control border border-transparent text-ink-2 transition-colors duration-150 ease-ui hover:border-line hover:bg-panel-alt hover:text-ink"
        >
          <Icon name="alert" size="md" />
          {alertCount > 0 ? (
            <span className="tnum absolute -right-0.5 -top-0.5 flex h-[16px] min-w-[16px] items-center justify-center rounded-full border-2 border-panel bg-risk-critical px-[3px] text-[9.5px] font-bold leading-none text-white">
              {alertCount > 9 ? '9+' : alertCount}
            </span>
          ) : null}
        </button>

        {canResetDemo ? (
          <>
            <span className="h-7 w-px shrink-0 bg-line" aria-hidden />
            <Button
              size="sm"
              variant="secondary"
              icon="refresh"
              onClick={onResetDemo}
              pending={resettingDemo}
              // Says plainly what it touches. The runbook calls resetting immediately before
              // presenting "the one non-negotiable step", so the control is on every page
              // rather than buried on one.
              title="Restore the seeded demo world to its documented baseline. Demo data only — no live system is affected."
            >
              <span className="hidden lg:inline">Reset Demo</span>
              <span className="lg:hidden">Reset</span>
            </Button>
          </>
        ) : null}

        <span className="h-7 w-px shrink-0 bg-line" aria-hidden />

        <UserMenu user={user} onSignOut={onSignOut} />
      </div>
    </header>
  );
}
