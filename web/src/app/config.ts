/**
 * Runtime configuration.
 *
 * The Command Center's simulate control has to name a segment, and a presenter must never have
 * to pick one from a list under pressure. That id is *configuration*, not fixture data — the
 * frozen backend carries the same value in its own `DEMO_SEGMENT_ID` env var — so it lives here
 * rather than being imported from `data/demo`, which pages are not allowed to touch.
 *
 * The default is the tuned demo segment: SEG-010, Bhalukpong → Tenga Valley, the leg whose
 * ground-truth risk sits at 43 at rest and crosses to 87 under simulated rainfall.
 */

export const DEMO_SEGMENT_ID: string =
  import.meta.env.VITE_DEMO_SEGMENT_ID ?? 'd0000000-0000-4000-8000-000000000010';

/** Human-readable name of that segment, for the simulate control's supporting copy. */
export const DEMO_SEGMENT_LABEL = 'Bhalukpong – Tenga Valley';
