import { useEffect, useRef, useState } from 'react';

/**
 * Eases a number toward a new target over `durationMs`.
 *
 * A risk score jumping 43 -> 87 the instant a cascade lands reads as a re-render. The same
 * change counted up over 700 ms reads as a measurement — and, more usefully, draws the eye to
 * the one tile that moved on a screen with twelve of them.
 *
 * Honesty rule: this animates the *display* of a value that has already arrived. It never
 * interpolates toward a value the data layer has not returned, and **the target is always
 * reached** — see the guarantees below. A tween that can leave a stale number on screen is
 * worse than no tween at all, because the figure is then simply wrong.
 *
 * Two ways the animation can fail to run, both handled:
 *   - `prefers-reduced-motion`, where it must not run;
 *   - a hidden or unpainted tab, where `requestAnimationFrame` is throttled to nothing. This
 *     one is not hypothetical: switch away mid-cascade and every tweened figure on the page
 *     freezes at its previous value and stays there. Both cases snap straight to the target,
 *     and a timeout backstops the frame loop if it stalls part-way.
 */
export function useTweenedNumber(target: number, durationMs = 700): number {
  const [value, setValue] = useState(target);

  const fromRef = useRef(target);
  /** The latest rendered value, so cleanup resumes from where the eye actually is. */
  const latestRef = useRef(target);
  latestRef.current = value;

  const frameRef = useRef<number>();
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    const reduced =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const hidden = typeof document !== 'undefined' && document.hidden;

    const snap = () => {
      fromRef.current = target;
      setValue(target);
    };

    const from = fromRef.current;
    if (reduced || hidden || from === target || durationMs <= 0) {
      snap();
      return;
    }

    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      // easeOutCubic: fast departure, settled arrival — matches the UI motion curve.
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(from + (target - from) * eased);
      if (t < 1) {
        frameRef.current = requestAnimationFrame(step);
      } else {
        snap();
      }
    };
    frameRef.current = requestAnimationFrame(step);

    // Backstop. If the frame loop is throttled or never runs, the target still lands.
    timeoutRef.current = setTimeout(snap, durationMs + 120);

    return () => {
      if (frameRef.current !== undefined) cancelAnimationFrame(frameRef.current);
      if (timeoutRef.current !== undefined) clearTimeout(timeoutRef.current);
      fromRef.current = latestRef.current;
    };
  }, [target, durationMs]);

  return value;
}
