/**
 * The product mark.
 *
 * A ridge line with a route threading through it — the two things the product is about,
 * terrain and a supply route, in one 28px glyph. Drawn as SVG rather than shipped as a PNG so
 * it stays crisp at any size and can be recoloured for the navy and white contexts.
 */

import { cn } from '@/lib/cn';

export function BrandMark({
  size = 30,
  className,
  onNavy = false,
}: {
  size?: number;
  className?: string;
  onNavy?: boolean;
}) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center overflow-hidden rounded-[8px]',
        onNavy ? 'bg-white/12 ring-1 ring-white/20' : 'shadow-[0_1px_2px_rgb(14_27_42/0.18)]',
        className,
      )}
      style={{ width: size, height: size }}
      aria-hidden
    >
      <svg width={size} height={size} viewBox="0 0 32 32" fill="none">
        {!onNavy ? (
          <>
            <defs>
              <linearGradient id="brandmark-bg" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="rgb(var(--brand-700))" />
                <stop offset="100%" stopColor="rgb(var(--brand-900))" />
              </linearGradient>
            </defs>
            <rect width="32" height="32" rx="8" fill="url(#brandmark-bg)" />
          </>
        ) : null}

        {/* Ridge line — the terrain */}
        <path
          d="M4 23.5 L11 12 L15.5 18.5 L21 8.5 L28 23.5 Z"
          fill="rgb(255 255 255 / 0.16)"
          stroke="rgb(255 255 255 / 0.55)"
          strokeWidth="1.1"
          strokeLinejoin="round"
        />
        {/* Snow cap on the higher peak */}
        <path d="M21 8.5 L23.4 13.6 L21 12.4 L18.9 13.4 Z" fill="rgb(255 255 255 / 0.9)" />
        {/* The route */}
        <path
          d="M3 26.5 C9 26.5, 10 21.5, 16 21.5 C22 21.5, 23 26.5, 29 26.5"
          stroke="rgb(255 255 255 / 0.95)"
          strokeWidth="1.9"
          strokeLinecap="round"
          fill="none"
        />
        <circle cx="16" cy="21.5" r="2.1" fill="rgb(var(--risk-medium))" stroke="white" strokeWidth="1.1" />
      </svg>
    </span>
  );
}

/** Mark plus wordmark plus positioning line — the header's identity block. */
export function BrandLockup({
  onNavy = false,
  compact = false,
  className,
}: {
  onNavy?: boolean;
  compact?: boolean;
  className?: string;
}) {
  return (
    <div className={cn('flex shrink-0 items-center gap-2.5', className)}>
      <BrandMark onNavy={onNavy} size={compact ? 26 : 30} />
      <div className="flex flex-col leading-none">
        <span
          className={cn(
            'font-display font-bold tracking-[-0.02em]',
            compact ? 'text-[14px]' : 'text-[16px]',
            onNavy ? 'text-white' : 'text-ink',
          )}
        >
          NER-<span className={onNavy ? 'text-white/75' : 'text-brand-500'}>SupplyAI</span>
        </span>
        {!compact ? (
          <span
            className={cn(
              'mt-[3px] text-[10.5px] font-medium tracking-[0.01em]',
              onNavy ? 'text-white/55' : 'text-ink-3',
            )}
          >
            Predict Disruption. Protect Supply.
          </span>
        ) : null}
      </div>
    </div>
  );
}
