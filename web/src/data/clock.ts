/**
 * The console's current instant — the one every page should ask.
 *
 * Eight product files previously imported `DEMO_NOW` straight from `data/demo/clock`, which was
 * wrong twice over: it reached into the demo fixtures from page code, and it hard-wired the
 * whole product to 18 Nov 2024. Pointed at a real backend, every "18 min ago" and every ETA
 * countdown on every screen would have been computed against a date two years in the past.
 *
 * So "now" becomes part of the data layer's surface, selected the same way the adapter is:
 *
 *   demo  DEMO_NOW — fixed, so `resetDemo()` is byte-reproducible and a rehearsal still matches
 *         the demo an hour later (docs/DEMO_RUNBOOK.md, "80-90 minute shelf life")
 *   http  the wall clock, read per call so a session left open overnight still ages correctly
 *
 * A function rather than a constant on purpose: a constant captured at module load would freeze
 * the clock for the lifetime of the tab, which is exactly the bug this replaces.
 *
 * Nothing outside `src/data/` may import `data/demo/clock` — `@/data/clock` is the way in.
 */

import { DEMO_NOW } from './demo/clock';

const isDemo = (import.meta.env.VITE_DATA_SOURCE ?? 'demo').toLowerCase() !== 'http';

/** Epoch milliseconds. Constant in demo mode, live otherwise. */
export function appNow(): number {
  return isDemo ? DEMO_NOW : Date.now();
}

/** The same instant as an ISO string, for the formatters that take one. */
export function appNowIso(): string {
  return new Date(appNow()).toISOString();
}
