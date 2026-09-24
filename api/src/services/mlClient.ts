/**
 * Server-side client for the internal ML service.
 *
 * The only code in the project that talks to FastAPI. The browser never does — it cannot: the
 * service binds to loopback, sends no CORS headers, and wants a token the frontend never sees.
 *
 * Four ways a call can fail, each reported distinctly because each means something different
 * to whoever reads the log:
 *
 *   UNAVAILABLE       nothing answered — the service is not running
 *   TIMEOUT           it answered too slowly — running, but stuck or overloaded
 *   REJECTED          it refused the request — a 4xx, which means WE sent bad features
 *   INVALID_RESPONSE  it answered with something off-contract — it must not be trusted
 *
 * None of those messages, and nothing from Python, ever reaches the browser verbatim: the route
 * layer maps an `MlError` to a sentence and a status, and the detail stays in the server log.
 */

import { z } from 'zod';
import { env } from '../config/env';

export type MlErrorKind = 'DISABLED' | 'UNAVAILABLE' | 'TIMEOUT' | 'REJECTED' | 'INVALID_RESPONSE';

export class MlError extends Error {
  readonly kind: MlErrorKind;
  /** Server-log detail. Never sent to a client. */
  readonly detail?: string;

  constructor(kind: MlErrorKind, message: string, detail?: string) {
    super(message);
    this.name = 'MlError';
    this.kind = kind;
    this.detail = detail;
  }
}

// ---------------------------------------------------------------------------
// Contract — mirrors ml/app/schemas.py
// ---------------------------------------------------------------------------

export interface RouteRiskFeatures {
  rainfall1h: number;
  rainfall3h: number;
  rainfall6h: number;
  rainfall24h: number;
  windSpeedKmh: number;
  roadCondition: 'GOOD' | 'FAIR' | 'POOR';
  terrainSlopeDeg: number;
  elevationM: number;
  historicalLandslides: number;
  historicalFloods: number;
  previousClosureFrequencyPct: number;
  trafficLevel: number;
}

const topFactor = z.object({
  factor: z.string(),
  feature: z.string(),
  value: z.union([z.number(), z.string()]),
  shapValue: z.number(),
  // Nullish: the field is optional in the contract and a model that predicts in the
  // target's own units may leave it unset.
  shapUnit: z.string().nullish(),
  contributionPct: z.number().min(0).max(100),
  direction: z.enum(['increases_risk', 'decreases_risk']),
});

/**
 * Every field the persistence layer relies on is checked, not assumed. A response that parsed
 * as JSON but carried `riskScore: "high"` or an empty factor list would otherwise be written to
 * PostgreSQL as if it were a prediction.
 */
const routeRiskResponse = z.object({
  modelVersion: z.string().min(1),
  reference: z.string().nullable(),
  riskScore: z.number().int().min(0).max(100),
  riskProbability: z.number().min(0).max(1),
  riskLevel: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),
  rawPrediction: z.number(),
  featureValues: z.record(z.string(), z.union([z.number(), z.string()])),
  encodedFeatures: z.record(z.string(), z.number()),
  topFactors: z.array(topFactor).min(1),
  shapBaseValue: z.number(),
  provenance: z.object({
    source: z.literal('ML_PREDICTION'),
    modelVersion: z.string(),
    modelType: z.string(),
    trainedOn: z.literal('synthetic'),
    datasetSha256: z.string(),
    artifactSha256: z.string(),
    explanationMethod: z.string(),
  }),
  warnings: z.array(z.string()),
});

export type RouteRiskPrediction = z.infer<typeof routeRiskResponse>;
export type TopFactor = z.infer<typeof topFactor>;

const mlHealth = z.object({
  status: z.enum(['ok', 'degraded']),
  modelVersion: z.string(),
  modelLoaded: z.boolean(),
  authConfigured: z.boolean(),
});

export type MlHealth = z.infer<typeof mlHealth>;

// ---------------------------------------------------------------------------

interface CallOptions {
  /** Override for tests; production uses env. */
  baseUrl?: string;
  token?: string;
  timeoutMs?: number;
}

async function call(path: string, init: RequestInit, opts: CallOptions): Promise<unknown> {
  const baseUrl = opts.baseUrl ?? env.ml.serviceUrl;
  const timeoutMs = opts.timeoutMs ?? env.ml.timeoutMs;

  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      ...init,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const name = (err as { name?: string }).name;
    if (name === 'TimeoutError' || name === 'AbortError') {
      throw new MlError('TIMEOUT', `The ML service did not answer within ${timeoutMs} ms.`);
    }
    // undici reports a refused connection as a TypeError whose cause carries the code.
    const cause = (err as { cause?: { code?: string } }).cause?.code ?? (err as Error).message;
    throw new MlError('UNAVAILABLE', 'The ML service is not reachable.', String(cause));
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new MlError('INVALID_RESPONSE', 'The ML service returned a non-JSON response.', `HTTP ${response.status}`);
  }

  if (!response.ok) {
    const message = (body as { error?: string })?.error ?? `HTTP ${response.status}`;
    const kind: MlErrorKind = response.status >= 500 ? 'UNAVAILABLE' : 'REJECTED';
    throw new MlError(kind, 'The ML service refused the request.', `HTTP ${response.status}: ${message} ${JSON.stringify((body as { detail?: unknown })?.detail ?? '')}`);
  }
  return body;
}

/** Guard used by every public entry point: in demo mode the ML service is never contacted. */
function assertLive(opts: CallOptions): void {
  if (env.ml.mode !== 'live' && !opts.baseUrl) {
    throw new MlError('DISABLED', 'ML_MODE is "demo"; the ML service is not called.');
  }
}

export async function predictRouteRisk(
  features: RouteRiskFeatures,
  reference?: string,
  opts: CallOptions = {},
): Promise<RouteRiskPrediction> {
  assertLive(opts);
  const token = opts.token ?? env.ml.internalToken;
  if (!token) throw new MlError('DISABLED', 'ML_INTERNAL_TOKEN is not configured.');

  const body = await call(
    '/internal/predict-route-risk',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Internal-Token': token },
      body: JSON.stringify({ features, reference: reference ?? null }),
    },
    opts,
  );

  const parsed = routeRiskResponse.safeParse(body);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new MlError(
      'INVALID_RESPONSE',
      'The ML service returned a response outside its contract.',
      `${first.path.join('.')}: ${first.message}`,
    );
  }
  return parsed.data;
}

// ---------------------------------------------------------------------------
// Delivery risk (Phase 6B) — the second model pair on the same service
// ---------------------------------------------------------------------------

/** The seven contract features. Same rule as route risk: every one is required, none defaulted. */
export interface DeliveryRiskFeatures {
  distanceRemainingKm: number;
  currentSpeedKmh: number;
  routeRiskScore: number;
  weatherSeverity: 'NORMAL' | 'MODERATE' | 'HEAVY' | 'SEVERE';
  cargoPriority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  /** 0-23, local time at the moment of prediction. */
  hourOfDay: number;
  /** 0 = Monday ... 6 = Sunday. */
  dayOfWeek: number;
}

const deliveryRiskResponse = z.object({
  modelVersion: z.string(),
  reference: z.string().nullable(),
  failureProbability: z.number().min(0).max(1),
  predictedDelayMinutes: z.number().int().min(0),
  rawDelayMinutes: z.number(),
  featureValues: z.record(z.string(), z.union([z.number(), z.string()])),
  encodedFeatures: z.record(z.string(), z.number()),
  topFactors: z.array(topFactor).min(1),
  delayFactors: z.array(topFactor).min(1),
  shapBaseValue: z.number(),
  delayShapBaseValue: z.number(),
  provenance: z.object({
    source: z.literal('ML_PREDICTION'),
    modelVersion: z.string(),
    modelType: z.string(),
    trainedOn: z.string(),
    datasetSha256: z.string(),
    artifactSha256: z.string(),
    explanationMethod: z.string(),
  }),
  warnings: z.array(z.string()),
});

export type DeliveryRiskPrediction = z.infer<typeof deliveryRiskResponse>;

export async function predictDeliveryRisk(
  features: DeliveryRiskFeatures,
  reference?: string,
  opts: CallOptions = {},
): Promise<DeliveryRiskPrediction> {
  assertLive(opts);
  const token = opts.token ?? env.ml.internalToken;
  if (!token) throw new MlError('DISABLED', 'ML_INTERNAL_TOKEN is not configured.');

  const body = await call(
    '/internal/predict-delivery-risk',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Internal-Token': token },
      body: JSON.stringify({ features, reference: reference ?? null }),
    },
    opts,
  );

  const parsed = deliveryRiskResponse.safeParse(body);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new MlError(
      'INVALID_RESPONSE',
      'The ML service returned a response outside its contract.',
      `${first.path.join('.')}: ${first.message}`,
    );
  }
  return parsed.data;
}

export async function mlHealthCheck(opts: CallOptions = {}): Promise<MlHealth> {
  assertLive(opts);
  const body = await call('/health', { method: 'GET' }, { timeoutMs: 2000, ...opts });
  const parsed = mlHealth.safeParse(body);
  if (!parsed.success) {
    throw new MlError('INVALID_RESPONSE', 'The ML health response was malformed.');
  }
  return parsed.data;
}
