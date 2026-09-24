/**
 * AlertRow — one entry in the priority feed.
 *
 * The composition follows the visual reference: a severity rail down the left edge, the
 * severity word and an age on one line, the headline in primary ink, one line of context in
 * secondary, and a chevron. Critical rows carry a tinted ground so the feed's top is legible
 * from across a room, which is the entire point of a priority feed.
 *
 * The Twilio badge is deliberately honest: it says "SMS sent" only when the notification
 * actually left, because contract 6.11 requires a failed downstream notification to be
 * reported as failed rather than assumed.
 */

import { cn } from '@/lib/cn';
import { formatAge } from '@/domain/format';
import { RISK_TONE } from '@/domain/thresholds';
import type { Alert } from '@/domain/types';
import { appNow } from '@/data/clock';
import { Icon, type IconName } from '../icons';

const SEVERITY_ICON: Record<Alert['severity'], IconName> = {
  CRITICAL: 'critical',
  HIGH: 'warning',
  MEDIUM: 'warning',
  LOW: 'info',
};

/** The reference labels these WARNING / INFO rather than by their enum name. */
const SEVERITY_WORD: Record<Alert['severity'], string> = {
  CRITICAL: 'CRITICAL',
  HIGH: 'WARNING',
  MEDIUM: 'WARNING',
  LOW: 'INFO',
};

export interface AlertRowProps {
  alert: Alert;
  onClick?: () => void;
  /** The demo clock, so ages stay deterministic. Defaults to the fixed demo instant. */
  now?: number;
  className?: string;
}

export function AlertRow({ alert, onClick, now = appNow(), className }: AlertRowProps) {
  const tone = RISK_TONE[alert.severity];
  const isCritical = alert.severity === 'CRITICAL';
  const Wrapper = onClick ? 'button' : 'div';

  return (
    <Wrapper
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={cn(
        'group relative flex w-full items-start gap-3 border-b border-line-soft py-2.5 pl-4 pr-3 text-left',
        'transition-colors duration-100 ease-ui last:border-b-0',
        isCritical ? tone.wash : 'bg-panel',
        onClick && 'hover:bg-panel-alt',
        onClick && isCritical && 'hover:brightness-[0.985]',
        className,
      )}
    >
      {/* Severity rail */}
      <span className={cn('absolute inset-y-0 left-0 w-[3px]', tone.rail)} aria-hidden />

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              'inline-flex items-center gap-1 rounded-chip px-1.5 py-[1px] text-[10.5px] font-bold uppercase tracking-[0.05em]',
              isCritical ? cn(tone.bg, 'text-white') : cn(tone.wash, tone.text),
            )}
          >
            <Icon name={SEVERITY_ICON[alert.severity]} size="sm" />
            {SEVERITY_WORD[alert.severity]}
          </span>

          <span className="text-meta text-ink-3">{formatAge(alert.createdAt, now)}</span>

          {alert.notifiedViaTwilio ? (
            <span
              className="ml-auto inline-flex items-center gap-1 text-[10.5px] font-semibold text-brand-700"
              title="A Twilio SMS was dispatched for this alert and accepted by the provider."
            >
              <Icon name="notify" size="sm" />
              SMS sent
            </span>
          ) : null}
        </div>

        <p
          className={cn(
            'text-body-lg font-semibold leading-snug',
            isCritical ? tone.text : 'text-ink',
          )}
        >
          {alert.title}
        </p>

        <p className="text-meta leading-snug text-ink-2">{alert.message}</p>
      </div>

      {onClick ? (
        <Icon
          name="chevronRight"
          size="md"
          className="mt-1 shrink-0 text-ink-3 transition-transform duration-150 ease-ui group-hover:translate-x-0.5 group-hover:text-ink-2"
        />
      ) : null}
    </Wrapper>
  );
}
