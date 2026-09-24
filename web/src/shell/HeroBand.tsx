/**
 * HeroBand — the operational page header.
 *
 * A photographic band with a navy gradient over it: eyebrow, title, subtitle on the left, and a
 * free-form right slot for live conditions and the primary control. The Command Center uses it
 * with the corridor ridgeline; other pages can use the same component with no image, in which
 * case it falls back to the navy gradient and stays a plain institutional header.
 *
 * Deliberately not tall. 132px at `md` — enough to carry a photograph and establish place,
 * short enough that the map and the alert feed still own the screen. A hero that eats a third
 * of an operational console is a marketing page, not a command center.
 */

import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Icon, type IconName } from '@/design/primitives';

export interface HeroBandProps {
  /** Imported image URL. Omit for a plain navy band. */
  image?: string;
  /** Alt text is empty by design: the image is atmosphere, and the title carries the meaning. */
  imagePosition?: string;
  eyebrow?: string;
  eyebrowIcon?: IconName;
  title: string;
  subtitle?: string;
  /** Live conditions, a primary action, a status readout. */
  right?: ReactNode;
  /** A quiet quotation or positioning line between title and right slot. */
  centre?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  /** Photographer credit, rendered small in the corner. Required for CC BY imagery. */
  credit?: string;
  className?: string;
}

const HEIGHT = { sm: 'min-h-[92px]', md: 'min-h-[132px]', lg: 'min-h-[168px]' } as const;

export function HeroBand({
  image,
  // The band is short and wide, so the crop matters: 72% puts the layered ridgelines in frame
  // rather than the empty sky above them.
  imagePosition = 'center 72%',
  eyebrow,
  eyebrowIcon,
  title,
  subtitle,
  right,
  centre,
  size = 'md',
  credit,
  className,
}: HeroBandProps) {
  return (
    <section
      className={cn(
        'relative isolate flex shrink-0 items-center overflow-hidden border-b border-brand-900/25',
        HEIGHT[size],
        className,
      )}
    >
      {/* Photograph */}
      {image ? (
        <img
          src={image}
          alt=""
          aria-hidden
          className="absolute inset-0 -z-20 h-full w-full object-cover"
          style={{ objectPosition: imagePosition }}
        />
      ) : null}

      {/* Navy wash. Two layers: a horizontal gradient that keeps the left text legible over any
          photograph, and a flat tint that unifies the whole band with the brand. */}
      <div
        className="absolute inset-0 -z-10"
        style={{
          background: image
            ? 'linear-gradient(96deg, rgb(var(--brand-900) / 0.94) 0%, rgb(var(--brand-900) / 0.80) 38%, rgb(var(--brand-800) / 0.58) 66%, rgb(var(--brand-700) / 0.42) 100%)'
            : 'linear-gradient(160deg, rgb(var(--brand-900)) 0%, rgb(var(--brand-800)) 62%, rgb(var(--brand-700)) 100%)',
        }}
        aria-hidden
      />
      {/* Contour texture, so a band with no photograph still has surface. */}
      {!image ? <div className="texture-contour absolute inset-0 -z-10" aria-hidden /> : null}

      <div className="flex w-full items-center gap-6 px-5 py-4">
        <div className="flex min-w-0 flex-col gap-1">
          {eyebrow ? (
            <span className="flex items-center gap-1.5 text-label uppercase text-white/60">
              {eyebrowIcon ? <Icon name={eyebrowIcon} size="sm" /> : null}
              {eyebrow}
            </span>
          ) : null}

          <h1
            className={cn(
              'font-display font-semibold tracking-[-0.025em] text-white',
              size === 'lg' ? 'text-[34px] leading-[39px]' : 'text-[27px] leading-[32px]',
            )}
          >
            {title}
          </h1>

          {subtitle ? (
            <p className="text-[13px] leading-tight text-white/70">{subtitle}</p>
          ) : null}
        </div>

        {centre ? (
          <div className="hidden min-w-0 flex-1 justify-center 2xl:flex">{centre}</div>
        ) : (
          <div className="flex-1" />
        )}

        {right ? <div className="flex shrink-0 items-center gap-3">{right}</div> : null}
      </div>

      {credit ? (
        <span className="pointer-events-none absolute bottom-1 right-2 text-[9.5px] text-white/35">
          {credit}
        </span>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------
// ImagePanel — the photographic block that is not a page header
// ---------------------------------------------------------------------------

/**
 * The brand card in the Command Center's bottom row: a photograph with a headline over it, used
 * to give a dense grid of tables and charts one place to breathe. Same treatment as the hero so
 * the two read as one system.
 */
export function ImagePanel({
  image,
  imagePosition = 'center 60%',
  title,
  subtitle,
  footer,
  credit,
  className,
}: {
  image: string;
  imagePosition?: string;
  title: string;
  subtitle?: string;
  footer?: ReactNode;
  credit?: string;
  className?: string;
}) {
  return (
    <section
      className={cn(
        'relative isolate flex min-h-0 flex-col justify-end overflow-hidden rounded-panel shadow-panel',
        className,
      )}
    >
      <img
        src={image}
        alt=""
        aria-hidden
        className="absolute inset-0 -z-20 h-full w-full object-cover"
        style={{ objectPosition: imagePosition }}
      />
      <div
        className="absolute inset-0 -z-10"
        style={{
          background:
            'linear-gradient(180deg, rgb(var(--brand-900) / 0.18) 0%, rgb(var(--brand-900) / 0.55) 52%, rgb(var(--brand-900) / 0.90) 100%)',
        }}
        aria-hidden
      />

      <div className="flex flex-col gap-1 p-4">
        <h3 className="font-display text-[19px] font-semibold leading-tight tracking-[-0.02em] text-white">
          {title}
        </h3>
        {subtitle ? <p className="text-[13px] text-white/75">{subtitle}</p> : null}
        {footer ? <div className="mt-2 flex items-center gap-2">{footer}</div> : null}
      </div>

      {credit ? (
        <span className="pointer-events-none absolute right-2 top-1.5 text-[9.5px] text-white/40">
          {credit}
        </span>
      ) : null}
    </section>
  );
}
