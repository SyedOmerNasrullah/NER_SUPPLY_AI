/**
 * Request de-duplication for the data layer.
 *
 * The problem it solves: five pages independently ask for the same delivery, and every page
 * asks for route candidates with identical parameters. In demo mode that is merely wasteful; in
 * Phase 6 `getRouteCandidates` is a POST that re-runs OpenRouteService, so the same corridor
 * would be re-routed once per mounted panel.
 *
 * The design is deliberately small — a Map, not a query library:
 *
 *   - Identical concurrent calls share one promise.
 *   - A settled result is reused until the world changes.
 *   - "The world changes" means a mutation ran, which is exactly what `bumpCascadeVersion`
 *     already signals. So the cache is cleared there rather than expiring on a timer, which
 *     also means **no clock is consulted anywhere in the data layer** — the demo stays
 *     byte-reproducible and the no-`Date.now()` rule holds without an exception.
 *   - A rejected promise is evicted immediately, so a retry genuinely retries rather than
 *     replaying the failure forever.
 *
 * Nothing here changes what a caller receives. Pages remain unaware that caching exists.
 */

const entries = new Map<string, Promise<unknown>>();

/**
 * Drop everything. Called whenever a mutation runs, so the next read reflects the new world.
 * Cheap: the map holds at most one entry per distinct read.
 */
export function invalidateRequestCache(): void {
  entries.clear();
}

/** Visible in the status rail during development; also handy in tests. */
export function requestCacheSize(): number {
  return entries.size;
}

export function deduped<T>(key: string, run: () => Promise<T>): Promise<T> {
  const existing = entries.get(key);
  if (existing) return existing as Promise<T>;

  const promise = run().catch((err: unknown) => {
    // Evicting on failure is the important half. Caching a rejection would make every retry
    // button in the product a no-op.
    entries.delete(key);
    throw err;
  });

  entries.set(key, promise);
  return promise;
}

/** Stable key for a call. Argument order is fixed by the call site, so JSON is deterministic. */
export function cacheKey(method: string, ...args: unknown[]): string {
  return args.length === 0 ? method : `${method}:${JSON.stringify(args)}`;
}
