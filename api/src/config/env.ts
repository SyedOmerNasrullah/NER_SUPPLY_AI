/**
 * Environment configuration, validated once at startup.
 *
 * Reading `process.env` at the point of use means a missing variable surfaces as a confusing
 * runtime failure somewhere deep in a request. Reading it here means the process refuses to
 * start and says which key is missing — which is the only useful moment to find out.
 */

import { config as loadDotenv } from 'dotenv';
import { resolve } from 'node:path';

loadDotenv({ path: resolve(__dirname, '../../.env') });

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    throw new Error(
      `Missing required environment variable ${name}. ` +
        `Copy api/.env.example to api/.env and fill it in. ` +
        `(.env is gitignored — never commit it.)`,
    );
  }
  return value.trim();
}

export const env = {
  databaseUrl: required('DATABASE_URL'),
  jwtSecret: required('JWT_SECRET'),
  /**
   * The password the seeded demonstration accounts are given.
   *
   * Read from the environment rather than written into the seed, so the value is not in the
   * repository — and never reaches the frontend, which learns demo credentials from the demo
   * adapter's own fixtures and is told nothing by the API (`getDemoAccounts` resolves empty in
   * http mode, by design; delta D23).
   *
   * It defaults to the demo adapter's published password so a fresh clone can sign in without
   * extra setup. That is acceptable precisely because these accounts only ever exist on a
   * seeded demonstration database.
   */
  demoPassword: process.env.DEMO_ACCOUNT_PASSWORD?.trim() || 'demo123',
  port: Number(process.env.PORT ?? 4000),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  get isDev(): boolean {
    return this.nodeEnv !== 'production';
  },
  corsOrigins: (process.env.CORS_ORIGIN ?? 'http://localhost:5173')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),
  ml: mlConfig(),
  twilio: twilioConfig(),
  gemini: geminiConfig(),
  ors: orsConfig(),
} as const;

/**
 * OpenRouteService. Optional, and deliberately so: the key is needed only to REGENERATE route
 * geometry. Serving, matching and scoring all read the persisted result, so a machine with no key
 * — or no internet — runs the whole product on the geometry already in the database.
 */
function orsConfig() {
  const apiKey = process.env.ORS_API_KEY?.trim() || undefined;
  return {
    apiKey,
    timeoutMs: Number(process.env.ORS_TIMEOUT_MS ?? 20_000),
    get configured(): boolean {
      return Boolean(apiKey);
    },
  };
}

/**
 * Gemini — explanation and vision only, never a number.
 *
 * Optional: without a key the server runs exactly as before and every explanation comes from the
 * deterministic template. The key is read here and used only in `services/gemini.ts`.
 */
function geminiConfig() {
  const apiKey = process.env.GEMINI_API_KEY?.trim() || undefined;
  // Default chosen against the live key: the 2.x flash names are closed to new keys, and the
  // "latest" alias is a thinking model that returns an empty body under a small token budget.
  // Override with GEMINI_MODEL when the account has something better.
  return {
    apiKey,
    model: process.env.GEMINI_MODEL?.trim() || 'gemini-3.1-flash-lite',
    visionModel: process.env.GEMINI_VISION_MODEL?.trim() || process.env.GEMINI_MODEL?.trim() || 'gemini-3.1-flash-lite',
    timeoutMs: Number(process.env.GEMINI_TIMEOUT_MS ?? 12_000),
    get configured(): boolean {
      return Boolean(apiKey);
    },
  };
}

/**
 * Twilio SMS. Optional: a machine without these keys runs everything except SMS, and the SMS
 * endpoint says plainly that it is not configured rather than refusing to start the server.
 *
 * Names follow the contract (section 8): `TWILIO_FROM_NUMBER` is the sender.
 * `TWILIO_TO_NUMBER`, when set, is the delivery override for a trial account or a demo: every SMS
 * still goes through officer lookup and phone validation, but is delivered to this one verified
 * number instead of the officer's. The seeded officer numbers are fictitious, and sending to a
 * made-up number could text a real stranger.
 */
function twilioConfig() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID?.trim() || undefined;
  const authToken = process.env.TWILIO_AUTH_TOKEN?.trim() || undefined;
  const fromNumber = process.env.TWILIO_FROM_NUMBER?.trim() || undefined;
  return {
    accountSid,
    authToken,
    fromNumber,
    deliveryOverride: process.env.TWILIO_TO_NUMBER?.trim() || undefined,
    timeoutMs: Number(process.env.TWILIO_TIMEOUT_MS ?? 12_000),
    get configured(): boolean {
      return Boolean(accountSid && authToken && fromNumber);
    },
  };
}

/**
 * ML mode — an explicit switch, never an inference.
 *
 *   demo   the frozen deterministic scores only. Express never contacts the ML service; the
 *          demonstration behaves exactly as it did at the end of Phase 4B.
 *   live   Express may call the internal FastAPI service for route-risk predictions.
 *
 * An unrecognised value stops the process rather than defaulting to either: a typo that
 * silently turned live ML on (or off) in front of an audience is the failure this prevents.
 * The internal token is required only in live mode, so a demo-only machine needs no ML setup.
 */
function mlConfig() {
  const mode = (process.env.ML_MODE ?? 'demo').trim().toLowerCase();
  if (mode !== 'demo' && mode !== 'live') {
    throw new Error(`ML_MODE must be "demo" or "live" (got "${mode}").`);
  }
  return {
    mode: mode as 'demo' | 'live',
    serviceUrl: (process.env.ML_SERVICE_URL ?? 'http://127.0.0.1:8000').replace(/\/+$/, ''),
    internalToken: mode === 'live' ? required('ML_INTERNAL_TOKEN') : process.env.ML_INTERNAL_TOKEN?.trim(),
    timeoutMs: Number(process.env.ML_TIMEOUT_MS ?? 5000),
  };
}

/**
 * The connection string with its password removed, for logs.
 *
 * A DSN in a log file is a leaked credential, and startup logs are the most-copied text in any
 * project. Everything identifying stays; only the secret goes.
 */
export function redactedDatabaseUrl(): string {
  try {
    const url = new URL(env.databaseUrl);
    if (url.password) url.password = '***';
    return url.toString();
  } catch {
    return '<unparseable DATABASE_URL>';
  }
}
