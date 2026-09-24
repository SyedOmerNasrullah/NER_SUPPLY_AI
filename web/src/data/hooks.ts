/**
 * Data-access hooks.
 *
 * Two problems this solves, both of which made the previous frontend thin and repetitive:
 *
 *   1. Every page re-implemented the same `Promise.all` / loading / error triad by hand.
 *      `useResource` does it once, returns a discriminated state, and cancels correctly on
 *      unmount so a slow response cannot set state on a dead component.
 *
 *   2. One cascade updates six panels across the app. `bumpCascadeVersion()` publishes a single
 *      counter that every mounted resource subscribes to, so simulate-rainfall / incident
 *      submission / reset refresh the whole product without prop-drilling a refetch callback.
 *
 * No external query library: the contract's stack list is deliberate, and this is ~60 lines.
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { RouteCandidatesRequest, RouteCandidatesResponse } from '@/domain/types';
import { dataSource } from './index';
import { invalidateRequestCache } from './requestCache';
import { DataError } from './source';

// ---------------------------------------------------------------------------
// Cascade version — the app-wide "something changed, refetch" signal
// ---------------------------------------------------------------------------

let cascadeVersion = 0;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Call after any action that changes server state. Every live resource refetches.
 *
 * Clearing the request cache first is load-bearing: the listeners below trigger refetches
 * synchronously, and a stale cached read would answer them instantly with the old world.
 * `dataSource` also invalidates on every write, so this is a second guard for anything that
 * changes state outside a mutation call.
 */
export function bumpCascadeVersion(): void {
  invalidateRequestCache();
  cascadeVersion += 1;
  listeners.forEach((l) => l());
}

export function useCascadeVersion(): number {
  return useSyncExternalStore(
    subscribe,
    () => cascadeVersion,
    () => cascadeVersion,
  );
}

// ---------------------------------------------------------------------------
// useResource
// ---------------------------------------------------------------------------

export interface ResourceState<T> {
  data: T | undefined;
  loading: boolean;
  error: DataError | undefined;
  /** Refetch on demand, e.g. from an ErrorState's retry button. */
  reload: () => void;
}

/**
 * Runs `fetcher` on mount, whenever `deps` change, and whenever the cascade version bumps.
 *
 * `fetcher` is held in a ref so an inline arrow at the call site does not retrigger the effect
 * on every render — `deps` alone decides when the request is reissued.
 */
export function useResource<T>(fetcher: () => Promise<T>, deps: unknown[] = []): ResourceState<T> {
  const [data, setData] = useState<T>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<DataError>();
  const [nonce, setNonce] = useState(0);
  const version = useCascadeVersion();

  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(undefined);

    fetcherRef
      .current()
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof DataError) {
          setError(err);
        } else {
          const message = err instanceof Error ? err.message : String(err);
          console.error('[useResource] fetch failed', err);
          setError(new DataError(0, `Something went wrong loading this: ${message}`));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce, version]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  return { data, loading, error, reload };
}

// ---------------------------------------------------------------------------
// Named resources — one per endpoint, so a page never spells a fetch out itself
// ---------------------------------------------------------------------------

export const useVehicles = () => useResource(() => dataSource.getVehicles(), []);
export const useFieldOfficers = () => useResource(() => dataSource.getFieldOfficers(), []);
export const useDeliveries = () => useResource(() => dataSource.getDeliveries(), []);
export const useDelivery = (id: string) =>
  useResource(() => dataSource.getDeliveryById(id), [id]);
export const useDistricts = () => useResource(() => dataSource.getDistricts(), []);
export const useDistrict = (id: string) => useResource(() => dataSource.getDistrictById(id), [id]);
export const useWarehouses = () => useResource(() => dataSource.getWarehouses(), []);
export const useRiskSegments = () => useResource(() => dataSource.getRiskSegments(), []);
export const useIncidents = () => useResource(() => dataSource.getIncidents(), []);
export const useAlerts = () => useResource(() => dataSource.getAlerts(), []);
export const useWeather = () => useResource(() => dataSource.getWeather(), []);
export const useSummary = () => useResource(() => dataSource.getSummary(), []);
export const useRecentMovements = () => useResource(() => dataSource.getRecentMovements(), []);
export const useNotifications = () => useResource(() => dataSource.getNotifications(), []);
/**
 * Route candidates for a delivery — with one guard that matters more in Phase 6 than it does now.
 *
 * All seven callers build their params from a delivery that may still be loading, falling back
 * to 0/0 for the coordinates. Asking for a route from (0, 0) is asking for a corridor in the
 * Gulf of Guinea: in demo mode that is one wasted call, but this request becomes a live
 * OpenRouteService round trip, so it would be a real bill and a real latency hit on every page
 * load, for coordinates nobody asked about. Waiting for a real origin costs nothing — the page
 * is already rendering its skeleton while the delivery loads.
 */
export const useRouteCandidates = (params: RouteCandidatesRequest) =>
  useResource(
    () =>
      params.originLat === 0 && params.originLng === 0
        ? Promise.resolve<RouteCandidatesResponse>({ candidates: [] })
        : dataSource.getRouteCandidates(params),
    [params.originLat, params.originLng, params.destLat, params.destLng, params.deliveryId],
  );
export const useAnalyticsSummary = () => useResource(() => dataSource.getAnalyticsSummary(), []);

// ---------------------------------------------------------------------------
// Actions — mutations that end with a cascade bump
// ---------------------------------------------------------------------------

export interface ActionState {
  run: () => Promise<void>;
  pending: boolean;
  error: DataError | undefined;
}

/** Wraps a mutation so callers get a pending flag and an app-wide refresh for free. */
export function useAction(fn: () => Promise<unknown>): ActionState {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<DataError>();
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const run = useCallback(async () => {
    setPending(true);
    setError(undefined);
    try {
      await fnRef.current();
      bumpCascadeVersion();
    } catch (err) {
      // A non-DataError means the failure came from inside the adapter rather than from the
      // wire — a bug, not a server response. Swallowing it into a generic sentence is how such
      // a bug hides in plain sight, so the real message is kept and also logged.
      if (err instanceof DataError) {
        setError(err);
      } else {
        const message = err instanceof Error ? err.message : String(err);
        console.error('[useAction] action failed', err);
        setError(new DataError(0, `The action could not complete: ${message}`));
      }
    } finally {
      setPending(false);
    }
  }, []);

  return { run, pending, error };
}
