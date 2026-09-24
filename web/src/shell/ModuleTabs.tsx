/**
 * The module tab bar — the product's visible navigation.
 *
 * Nine labelled icon tabs, filtered to what the signed-in role can actually open. The active
 * tab carries a brand wash and a 2px underline that meets the bar's own bottom hairline, so it
 * reads as attached to the page below rather than as a highlighted button.
 *
 * The right-hand slot is where a page mounts its own controls (+ New Delivery, layer toggles,
 * a date range), keeping page-level actions on one consistent rail instead of floating into
 * whatever corner each page chooses.
 */

import { NavLink } from 'react-router-dom';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import type { Role } from '@/domain/types';
import { Icon } from '@/design/primitives';
import { modulesForRole } from '@/app/modules';

export function ModuleTabs({
  role,
  actions,
  className,
}: {
  role: Role;
  actions?: ReactNode;
  className?: string;
}) {
  const modules = modulesForRole(role);

  return (
    <nav
      aria-label="Modules"
      className={cn(
        'flex h-tabs shrink-0 items-stretch gap-0.5 border-b border-line bg-panel px-2',
        'shadow-[0_1px_3px_rgb(14_27_42/0.05)]',
        className,
      )}
    >
      <div className="flex min-w-0 flex-1 items-stretch gap-0.5 overflow-x-auto scroll-thin">
        {modules.map((m) => (
          <NavLink
            key={m.id}
            to={m.path}
            end={m.path === '/'}
            title={m.hint}
            className={({ isActive }) =>
              cn(
                'group relative inline-flex shrink-0 items-center gap-1.5 rounded-t-[7px] px-3 text-[12.5px] font-medium',
                'transition-colors duration-150 ease-ui',
                isActive
                  ? 'bg-brand-50 text-brand-700'
                  : 'text-ink-2 hover:bg-panel-alt hover:text-ink',
              )
            }
          >
            {({ isActive }) => (
              <>
                <Icon
                  name={m.icon}
                  size="md"
                  className={isActive ? 'text-brand-500' : 'text-ink-3 group-hover:text-ink-2'}
                />
                <span className="whitespace-nowrap">{m.name}</span>
                <span
                  aria-hidden
                  className={cn(
                    'absolute inset-x-0 -bottom-px h-[2px] rounded-t-full transition-colors duration-150 ease-ui',
                    isActive ? 'bg-brand-500' : 'bg-transparent',
                  )}
                />
              </>
            )}
          </NavLink>
        ))}
      </div>

      {actions ? (
        <div className="flex shrink-0 items-center gap-2 border-l border-line-soft pl-3">
          {actions}
        </div>
      ) : null}
    </nav>
  );
}
