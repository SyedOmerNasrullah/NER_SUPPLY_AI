/**
 * The signed-in identity block, and the menu behind it.
 *
 * Deliberately reads as a government tool rather than a SaaS avatar: initials in a navy square,
 * the person's name, and — the detail that sells it — the issuing authority under the role.
 */

import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/cn';
import { humanizeEnum, initials } from '@/domain/format';
import type { User } from '@/domain/types';
import { Icon } from '@/design/primitives';

export function UserMenu({
  user,
  onSignOut,
  className,
}: {
  user: User;
  onSignOut: () => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // A plain popover rather than a Radix dropdown: this menu has two items and no submenus, and
  // the click-outside plus Escape behaviour below is the whole of what Radix would add.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className={cn('relative shrink-0', className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className={cn(
          'flex items-center gap-2.5 rounded-control border border-transparent py-1 pl-1 pr-1.5',
          'transition-colors duration-150 ease-ui hover:border-line hover:bg-panel-alt',
          open && 'border-line bg-panel-alt',
        )}
      >
        <span
          className={cn(
            'flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px]',
            'bg-gradient-to-br from-brand-700 to-brand-900 text-[12px] font-bold tracking-[0.02em] text-white',
          )}
        >
          {initials(user.name)}
        </span>

        <span className="hidden flex-col items-start leading-none lg:flex">
          <span className="text-[12.5px] font-semibold text-ink">{humanizeEnum(user.role)}</span>
          <span className="mt-[3px] text-[10.5px] text-ink-3">Govt. of India · NER Logistics</span>
        </span>

        <Icon
          name="chevronDown"
          size="sm"
          className={cn('text-ink-3 transition-transform duration-150 ease-ui', open && 'rotate-180')}
        />
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-[calc(100%+6px)] z-50 w-64 animate-scale-in overflow-hidden rounded-panel border border-line bg-panel shadow-overlay"
        >
          <div className="flex items-center gap-3 border-b border-line-soft bg-panel-alt px-3.5 py-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] bg-gradient-to-br from-brand-700 to-brand-900 text-[13px] font-bold text-white">
              {initials(user.name)}
            </span>
            <div className="flex min-w-0 flex-col leading-tight">
              <span className="truncate text-body font-semibold text-ink">{user.name}</span>
              <span className="truncate text-meta text-ink-3">{user.email}</span>
            </div>
          </div>

          <dl className="px-3.5 py-2.5 text-meta">
            <div className="flex items-center justify-between py-1">
              <dt className="text-ink-3">Role</dt>
              <dd className="font-semibold text-ink">{humanizeEnum(user.role)}</dd>
            </div>
            {user.phone ? (
              <div className="flex items-center justify-between py-1">
                <dt className="text-ink-3">Alert number</dt>
                <dd className="tnum text-ink">{user.phone}</dd>
              </div>
            ) : null}
          </dl>

          <div className="border-t border-line-soft p-1.5">
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onSignOut();
              }}
              className="flex w-full items-center gap-2 rounded-[6px] px-2 py-1.5 text-body text-ink-2 transition-colors duration-150 ease-ui hover:bg-risk-wash-critical hover:text-risk-critical"
            >
              <Icon name="logout" size="sm" />
              Sign out
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
