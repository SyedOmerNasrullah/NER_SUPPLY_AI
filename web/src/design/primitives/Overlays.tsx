/**
 * Modal and SidePanel — both on Radix Dialog.
 *
 * Radix handles what is tedious and easy to get subtly wrong: focus trapping, restoring focus
 * to the trigger, `Esc`, scroll locking, and `aria-modal` semantics. The styling is entirely
 * ours; nothing here is a shadcn default.
 *
 * SidePanel is the drill-down surface for Supply Intelligence and the Live Map — it slides from
 * the right and does not dim the whole screen as heavily as a modal, because the operator is
 * meant to keep reading the map behind it.
 */

import type { ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { cn } from '@/lib/cn';
import { Icon } from '../icons';
import { IconButton } from './Controls';

// ---------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------

export interface ModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  /** Pinned to the bottom, hairline-separated. Usually a cancel/confirm pair. */
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const MODAL_WIDTH = { sm: 'max-w-[420px]', md: 'max-w-[560px]', lg: 'max-w-[760px]' } as const;

export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  size = 'md',
  className,
}: ModalProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 animate-fade-in bg-brand-900/35 backdrop-blur-[2px]" />
        <Dialog.Content
          className={cn(
            'fixed left-1/2 top-1/2 z-50 flex max-h-[86vh] w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2',
            'animate-scale-in flex-col overflow-hidden rounded-pane border border-line bg-panel shadow-overlay',
            MODAL_WIDTH[size],
            className,
          )}
        >
          <header className="flex shrink-0 items-start gap-3 border-b border-line-soft px-5 py-3.5">
            <div className="flex min-w-0 flex-col gap-0.5">
              <Dialog.Title className="text-title text-ink">{title}</Dialog.Title>
              {description ? (
                <Dialog.Description className="text-meta text-ink-2">
                  {description}
                </Dialog.Description>
              ) : null}
            </div>
            <Dialog.Close asChild>
              <IconButton name="close" label="Close" className="ml-auto" />
            </Dialog.Close>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto scroll-thin px-5 py-4">{children}</div>

          {footer ? (
            <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-line-soft bg-panel-alt px-5 py-3">
              {footer}
            </footer>
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// ---------------------------------------------------------------------------
// SidePanel
// ---------------------------------------------------------------------------

export interface SidePanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** A second line under the title: a district's state, a delivery's cargo. */
  subtitle?: string;
  /** Chips or controls level with the title. */
  headerAccessory?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
  className?: string;
}

export function SidePanel({
  open,
  onOpenChange,
  title,
  subtitle,
  headerAccessory,
  children,
  footer,
  width = 460,
  className,
}: SidePanelProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        {/* Lighter than the modal scrim: the map behind must stay readable. */}
        <Dialog.Overlay className="fixed inset-0 z-50 animate-fade-in bg-brand-900/20" />
        <Dialog.Content
          style={{ width }}
          className={cn(
            'fixed inset-y-0 right-0 z-50 flex max-w-[calc(100vw-24px)] animate-slide-in-right',
            'flex-col border-l border-line bg-panel shadow-overlay',
            className,
          )}
        >
          <header className="flex shrink-0 items-start gap-3 border-b border-line px-5 py-3.5">
            <div className="flex min-w-0 flex-col gap-0.5">
              <div className="flex items-center gap-2">
                <Dialog.Title className="truncate text-title text-ink">{title}</Dialog.Title>
                {headerAccessory}
              </div>
              {subtitle ? (
                <Dialog.Description className="truncate text-meta text-ink-2">
                  {subtitle}
                </Dialog.Description>
              ) : null}
            </div>
            <Dialog.Close asChild>
              <IconButton name="close" label="Close panel" className="ml-auto" />
            </Dialog.Close>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto scroll-thin">{children}</div>

          {footer ? (
            <footer className="flex shrink-0 items-center gap-2 border-t border-line bg-panel-alt px-5 py-3">
              {footer}
            </footer>
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// ---------------------------------------------------------------------------
// Callout — an inline notice, not an overlay, but it belongs with these
// ---------------------------------------------------------------------------

const CALLOUT_TONE = {
  brand: 'bg-brand-50 border-brand-500/18 text-brand-900',
  critical: 'bg-risk-wash-critical border-risk-critical/20 text-ink',
  medium: 'bg-risk-wash-medium border-risk-medium/25 text-ink',
  low: 'bg-risk-wash-low border-risk-low/20 text-ink',
  neutral: 'bg-panel-alt border-line text-ink',
} as const;

/**
 * The AI-recommendation box. A tinted band with a leading icon — used for the one sentence on
 * a page that tells the operator what to do.
 */
export function Callout({
  tone = 'brand',
  icon = 'ai',
  title,
  children,
  action,
  className,
}: {
  tone?: keyof typeof CALLOUT_TONE;
  icon?: Parameters<typeof Icon>[0]['name'];
  title?: string;
  children: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex items-start gap-3 rounded-panel border px-3.5 py-3',
        CALLOUT_TONE[tone],
        className,
      )}
    >
      <Icon name={icon} size="md" className="mt-[1px] shrink-0 opacity-80" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {title ? <p className="text-body font-semibold">{title}</p> : null}
        <div className="text-meta leading-relaxed opacity-90">{children}</div>
      </div>
      {action ? <div className="ml-1 shrink-0">{action}</div> : null}
    </div>
  );
}
