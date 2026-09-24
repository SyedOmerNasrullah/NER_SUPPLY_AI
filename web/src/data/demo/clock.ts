/**
 * The demo clock.
 *
 * Every timestamp in the demo world is derived from DEMO_NOW, never from `Date.now()`. A
 * fixture that reads wall-clock time makes `resetDemo()` non-reproducible and makes the
 * rehearsal you did an hour ago stop matching the demo you are giving — which is exactly the
 * "80-90 minute shelf life" failure recorded in docs/DEMO_RUNBOOK.md.
 *
 * The instant below is the one shown in the visual reference: Mon, 18 Nov 2024, 10:24 AM IST.
 */

/** Fixed reference instant, IST (+05:30). */
export const DEMO_NOW_ISO = '2024-11-18T10:24:00+05:30';
export const DEMO_NOW = new Date(DEMO_NOW_ISO).getTime();

/** An ISO timestamp `minutes` before the demo instant. */
export function minutesAgo(minutes: number): string {
  return new Date(DEMO_NOW - minutes * 60_000).toISOString();
}

/** An ISO timestamp `minutes` after the demo instant. */
export function minutesAhead(minutes: number): string {
  return new Date(DEMO_NOW + minutes * 60_000).toISOString();
}

export function hoursAgo(hours: number): string {
  return minutesAgo(hours * 60);
}

export function daysAgo(days: number): string {
  return minutesAgo(days * 24 * 60);
}

/**
 * mulberry32 — a small, fast, fully deterministic PRNG.
 *
 * Used ONLY for spreading background fleet positions and idle speeds, where the exact value
 * carries no meaning but must not change between reloads. Every value a judge actually reads
 * (risk scores, ETAs, stock levels, factor weights) is written out literally in fixtures.ts.
 * `Math.random()` appears nowhere in this project.
 */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A deterministic pick from a list. */
export function pick<T>(list: T[], rand: () => number): T {
  return list[Math.floor(rand() * list.length) % list.length];
}
