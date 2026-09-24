/**
 * Controls — buttons, toolbars, tabs, segmented switches.
 *
 * The `.btn` classes live in index.css so a plain `<button className="btn btn-primary">` works
 * anywhere; `Button` wraps them with icon and pending handling for the common case.
 */

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import { cn } from '@/lib/cn';
import { Icon, type IconName } from '../icons';

// ---------------------------------------------------------------------------
// Button
// ---------------------------------------------------------------------------

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'on-navy';

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: 'btn-primary',
  secondary: 'btn-secondary',
  ghost: 'btn-ghost',
  danger: 'btn-danger',
  'on-navy': 'btn-on-navy',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: 'sm' | 'md';
  icon?: IconName;
  iconRight?: IconName;
  /** Swaps the leading icon for a spinner and disables the control. */
  pending?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', icon, iconRight, pending, disabled, children, className, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      disabled={disabled || pending}
      className={cn('btn', VARIANT_CLASS[variant], size === 'sm' && 'btn-sm', className)}
      {...rest}
    >
      {pending ? (
        <Icon name="spinner" size={size === 'sm' ? 'sm' : 'md'} className="animate-spin" />
      ) : icon ? (
        <Icon name={icon} size={size === 'sm' ? 'sm' : 'md'} />
      ) : null}
      {children}
      {iconRight && !pending ? (
        <Icon name={iconRight} size={size === 'sm' ? 'sm' : 'md'} />
      ) : null}
    </button>
  );
});

// ---------------------------------------------------------------------------
// IconButton
// ---------------------------------------------------------------------------

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  name: IconName;
  /** Required: an icon-only control must still name itself for assistive tech and tooltips. */
  label: string;
  variant?: 'ghost' | 'secondary' | 'on-navy' | 'float';
  size?: 'sm' | 'md' | 'lg';
  active?: boolean;
}

const ICON_BUTTON_SIZE = { sm: 'h-6 w-6', md: 'h-8 w-8', lg: 'h-9 w-9' } as const;

const ICON_BUTTON_VARIANT = {
  ghost: 'border-transparent bg-transparent text-ink-2 hover:bg-ink/[0.06] hover:text-ink',
  secondary: 'border-line bg-panel text-ink-2 hover:border-ink-3/50 hover:text-ink',
  'on-navy': 'border-white/20 bg-white/10 text-white/85 hover:bg-white/20 hover:text-white',
  float: 'border-white/60 bg-panel/95 text-ink-2 shadow-float backdrop-blur-md hover:text-ink',
} as const;

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { name, label, variant = 'ghost', size = 'md', active = false, className, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active || undefined}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-control border transition-colors duration-150 ease-ui',
        'disabled:pointer-events-none disabled:opacity-45',
        ICON_BUTTON_SIZE[size],
        ICON_BUTTON_VARIANT[variant],
        active && 'border-brand-500/25 bg-brand-50 text-brand-700',
        className,
      )}
      {...rest}
    >
      <Icon name={name} size={size === 'sm' ? 'sm' : 'md'} />
    </button>
  );
});

// ---------------------------------------------------------------------------
// Toolbar
// ---------------------------------------------------------------------------

/**
 * A horizontal control strip above a table or map. Sits on `panel-alt` with a bottom hairline
 * so it reads as chrome attached to the content, not as another floating card.
 */
export function Toolbar({
  children,
  right,
  className,
}: {
  children?: ReactNode;
  right?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex h-[42px] shrink-0 items-center gap-2 border-b border-line-soft bg-panel-alt px-3',
        className,
      )}
    >
      {children}
      {right ? <div className="ml-auto flex items-center gap-2">{right}</div> : null}
    </div>
  );
}

/** A vertical hairline between toolbar groups. */
export function ToolbarDivider({ className }: { className?: string }) {
  return <span className={cn('h-4 w-px shrink-0 bg-line', className)} aria-hidden />;
}

// ---------------------------------------------------------------------------
// SegmentedControl
// ---------------------------------------------------------------------------

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  icon?: IconName;
}

/**
 * The basemap switch, the date-range switch, the map/table switch. A recessed track with a
 * raised active pill — the one place in the product where a control reads as physical.
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  size = 'md',
  onNavy = false,
  className,
}: {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  size?: 'sm' | 'md';
  onNavy?: boolean;
  className?: string;
}) {
  return (
    <div
      role="radiogroup"
      className={cn(
        'inline-flex shrink-0 items-center gap-0.5 rounded-control p-0.5',
        onNavy ? 'bg-white/12 backdrop-blur-sm' : 'bg-panel-sunk',
        className,
      )}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(opt.value)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-[6px] font-semibold transition-all duration-150 ease-ui',
              size === 'sm' ? 'px-2 py-[3px] text-[11px]' : 'px-2.5 py-[5px] text-meta',
              active
                ? onNavy
                  ? 'bg-white text-brand-900 shadow-panel'
                  : 'bg-panel text-ink shadow-panel'
                : onNavy
                  ? 'text-white/70 hover:text-white'
                  : 'text-ink-2 hover:text-ink',
            )}
          >
            {opt.icon ? <Icon name={opt.icon} size="sm" /> : null}
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tabs — Radix, styled as an underlined rail
// ---------------------------------------------------------------------------

export interface TabItem {
  value: string;
  label: string;
  icon?: IconName;
  badge?: ReactNode;
}

export function Tabs({
  items,
  value,
  onValueChange,
  children,
  className,
}: {
  items: TabItem[];
  value: string;
  onValueChange: (value: string) => void;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <TabsPrimitive.Root
      value={value}
      onValueChange={onValueChange}
      className={cn('flex min-h-0 flex-col', className)}
    >
      <TabsPrimitive.List className="flex shrink-0 items-center gap-1 border-b border-line px-1">
        {items.map((item) => (
          <TabsPrimitive.Trigger
            key={item.value}
            value={item.value}
            className={cn(
              'relative inline-flex items-center gap-1.5 px-3 py-2 text-body font-medium',
              'text-ink-2 transition-colors duration-150 ease-ui hover:text-ink',
              'data-[state=active]:text-brand-700',
              // The active underline overlaps the list's own border rather than sitting under it.
              'after:absolute after:inset-x-2 after:-bottom-px after:h-[2px] after:rounded-full',
              'after:bg-transparent data-[state=active]:after:bg-brand-500',
            )}
          >
            {item.icon ? <Icon name={item.icon} size="sm" /> : null}
            {item.label}
            {item.badge}
          </TabsPrimitive.Trigger>
        ))}
      </TabsPrimitive.List>
      {children}
    </TabsPrimitive.Root>
  );
}

export const TabPanel = TabsPrimitive.Content;
