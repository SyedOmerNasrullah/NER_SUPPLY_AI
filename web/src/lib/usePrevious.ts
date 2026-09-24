import { useEffect, useRef } from 'react';

/**
 * The value this component rendered before the current one.
 *
 * Used to show "↑ +66" beside a risk score after the cascade lands. That delta is a genuine
 * observation — "this number moved by 66 since you were last looking at it" — not a figure
 * derived from data the client does not have, so it stays truthful when Phase 6 swaps the demo
 * adapter for the real API.
 *
 * Returns `undefined` until the value has actually changed once, which is what callers should
 * use to hide the delta entirely rather than showing a spurious "+87 from nothing".
 */
export function usePrevious<T>(value: T | undefined): T | undefined {
  const current = useRef<T>();
  const previous = useRef<T>();

  useEffect(() => {
    // `undefined` means "not known yet" — a resource that has not resolved. Recording it would
    // make the first real value look like a change from nothing, which is how a freshly loaded
    // panel ends up claiming risk rose by 21 points before anything happened.
    if (value === undefined) return;
    if (current.current !== value) {
      previous.current = current.current;
      current.current = value;
    }
  }, [value]);

  if (value === undefined) return undefined;
  // During the render in which `value` changes, `current` still holds the previous one.
  return current.current === value ? previous.current : current.current;
}
