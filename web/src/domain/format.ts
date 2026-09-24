/**
 * Presentation helpers. Every number a user reads passes through here, so a duration, a
 * percentage or a timestamp is formatted identically on all ten pages.
 *
 * Nothing here rounds a value in a way that changes its meaning: `riskScore` arrives as an
 * integer and is printed as one; a float probability is converted with the contract's own rule
 * (round(p * 100)) and nowhere else.
 */

/** 440 -> "7h 20m", 55 -> "55m", 0 -> "0m". Negative durations keep their sign. */
export function formatDuration(minutes: number): string {
  const sign = minutes < 0 ? '-' : '';
  const total = Math.abs(Math.round(minutes));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${sign}${m}m`;
  if (m === 0) return `${sign}${h}h`;
  return `${sign}${h}h ${m}m`;
}

/** 47.1 -> "47h", 4.5 -> "4.5h" for sub-day values, null -> "—". */
export function formatHours(hours: number | null): string {
  if (hours === null) return '—';
  if (hours < 10) return `${hours.toFixed(1)}h`;
  return `${Math.round(hours)}h`;
}

/** Stockout countdown in the units an operator thinks in: "32h", "5.4d". */
export function formatStockout(hours: number | null): string {
  if (hours === null) return '—';
  if (hours < 48) return `${Math.round(hours)}h`;
  return `${(hours / 24).toFixed(1)}d`;
}

/** Contract section 10: riskScore = round(riskProbability * 100). The only conversion. */
export function probabilityToScore(p: number): number {
  return Math.round(p * 100);
}

export function formatPercent(value: number, digits = 0): string {
  return `${value.toFixed(digits)}%`;
}

/** A 0-1 float rendered as a percentage. Used for failureProbability and confidence. */
export function formatProbability(p: number, digits = 0): string {
  return `${(p * 100).toFixed(digits)}%`;
}

/** 1200 -> "1,200". Indian grouping is deliberately not used — the UI is English-numeric. */
export function formatNumber(value: number, digits = 0): string {
  return value.toLocaleString('en-IN', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function formatDistance(km: number): string {
  return `${km.toFixed(km < 100 ? 1 : 0)} km`;
}

/**
 * Relative age: "just now", "18 min ago", "2 hours ago", "9d ago".
 *
 * `now` is REQUIRED, and that is the point. It used to default to `Date.now()`, which meant a
 * single call site that forgot to pass the clock would silently read wall-clock time and make
 * `resetDemo()` non-reproducible — with nothing failing to announce it. Making the parameter
 * mandatory turns that into a compile error. Callers pass `appNow()` from `@/data/clock`.
 */
export function formatAge(iso: string, now: number): string {
  const ms = now - new Date(iso).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

/** "10:24 AM" */
export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

/** "Mon, 18 Nov 2024" */
export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

/** "LOGISTICS_OFFICER" -> "Logistics Officer". Used for every enum shown to a human. */
export function humanizeEnum(value: string): string {
  return value
    .toLowerCase()
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/** "Anjali Bora" -> "AB", for avatars. */
export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
}

/** A signed delta for a Delta chip: 8 -> "+8%", -23 -> "-23%". */
export function formatDelta(value: number, unit = '%'): string {
  const sign = value > 0 ? '+' : '';
  return `${sign}${value}${unit}`;
}
