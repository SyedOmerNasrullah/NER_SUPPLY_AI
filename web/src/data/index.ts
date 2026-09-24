/**
 * The data-source selector, and the one place caching is applied.
 *
 * Components import hooks; hooks import `dataSource` from here. Nothing else in `src/` may
 * import `data/demo` or `data/http` directly — that rule is what makes Phase 6 a config change.
 *
 * Flip with VITE_DATA_SOURCE in `.env`:
 *   demo  deterministic fixtures + a working cascade (Phases 2-5)
 *   http  the real Node API                          (Phase 6+)
 */

import { demoSource } from './demo';
import { httpSource } from './http';
import { cacheKey, deduped, invalidateRequestCache } from './requestCache';
import type { DataSource } from './source';

const configured = (import.meta.env.VITE_DATA_SOURCE ?? 'demo').toLowerCase();

const selected: DataSource = configured === 'http' ? httpSource : demoSource;

/**
 * The adapter, with reads de-duplicated and writes invalidating the cache.
 *
 * Wrapping here rather than in the hooks means every caller benefits — including the handful of
 * pages that call `dataSource.getDeliveryById(...)` directly inside a `useResource` — and no
 * page becomes responsible for caching. The `DataSource` contract is unchanged, so neither
 * adapter knows this exists.
 *
 * Reads are cached until a write happens. Writes clear the cache before returning, so the
 * refetch that `useAction` triggers immediately afterwards sees the new world rather than the
 * result that was cached a moment earlier — the ordering here is the whole correctness argument.
 */
export const dataSource: DataSource = {
  kind: selected.kind,

  // --- Writes: pass through, then invalidate --------------------------------
  login: async (email, password) => {
    const result = await selected.login(email, password);
    invalidateRequestCache();
    return result;
  },
  createDelivery: async (body) => {
    const result = await selected.createDelivery(body);
    invalidateRequestCache();
    return result;
  },
  rerouteDelivery: async (body) => {
    const result = await selected.rerouteDelivery(body);
    invalidateRequestCache();
    return result;
  },
  submitIncident: async (form) => {
    const result = await selected.submitIncident(form);
    invalidateRequestCache();
    return result;
  },
  simulateRain: async (segmentId) => {
    const result = await selected.simulateRain(segmentId);
    invalidateRequestCache();
    return result;
  },
  getMlStatus: () => deduped(cacheKey('getMlStatus'), () => selected.getMlStatus()),
  sendSms: async (body) => {
    const result = await selected.sendSms(body);
    invalidateRequestCache();
    return result;
  },
  placeCall: async (body) => {
    const result = await selected.placeCall(body);
    invalidateRequestCache();
    return result;
  },
  resetDemo: async () => {
    const result = await selected.resetDemo();
    invalidateRequestCache();
    return result;
  },

  // --- Reads: de-duplicated -------------------------------------------------
  getDemoAccounts: () => deduped(cacheKey('getDemoAccounts'), () => selected.getDemoAccounts()),
  getVehicles: () => deduped(cacheKey('getVehicles'), () => selected.getVehicles()),
  getFieldOfficers: () => deduped(cacheKey('getFieldOfficers'), () => selected.getFieldOfficers()),
  getDeliveries: () => deduped(cacheKey('getDeliveries'), () => selected.getDeliveries()),
  getDeliveryById: (id) =>
    deduped(cacheKey('getDeliveryById', id), () => selected.getDeliveryById(id)),
  getRouteCandidates: (params) =>
    // Keyed on the whole parameter object: two pages asking for the same corridor share one
    // call, and this is the request that becomes an OpenRouteService round trip in Phase 6.
    deduped(cacheKey('getRouteCandidates', params), () => selected.getRouteCandidates(params)),
  getDistricts: () => deduped(cacheKey('getDistricts'), () => selected.getDistricts()),
  getDistrictById: (id) =>
    deduped(cacheKey('getDistrictById', id), () => selected.getDistrictById(id)),
  getWarehouses: () => deduped(cacheKey('getWarehouses'), () => selected.getWarehouses()),
  getRiskSegments: () => deduped(cacheKey('getRiskSegments'), () => selected.getRiskSegments()),
  getIncidents: () => deduped(cacheKey('getIncidents'), () => selected.getIncidents()),
  getAlerts: () => deduped(cacheKey('getAlerts'), () => selected.getAlerts()),
  getWeather: () => deduped(cacheKey('getWeather'), () => selected.getWeather()),
  getSummary: () => deduped(cacheKey('getSummary'), () => selected.getSummary()),
  getRecentMovements: () =>
    deduped(cacheKey('getRecentMovements'), () => selected.getRecentMovements()),
  getNotifications: () => deduped(cacheKey('getNotifications'), () => selected.getNotifications()),
  getRouteComparison: (deliveryId) =>
    deduped(cacheKey('getRouteComparison', deliveryId ?? ''), () => selected.getRouteComparison(deliveryId)),
  // Not deduped by the request cache: the explanation service does its own caching, keyed on the
  // figures rather than on the call, which is the thing that actually should not be repeated.
  explain: (body) => selected.explain(body),
  getAnalyticsSummary: () =>
    deduped(cacheKey('getAnalyticsSummary'), () => selected.getAnalyticsSummary()),
};

export const isDemoMode = dataSource.kind === 'demo';

export { invalidateRequestCache, requestCacheSize } from './requestCache';
export { DataError } from './source';
export type { DataSource } from './source';
