/**
 * The Prisma client, as a single shared instance.
 *
 * One connection pool per process. Creating a client per request exhausts Postgres connections
 * under any real load, and on a pooled host like Neon it exhausts them quickly.
 */

import { PrismaClient } from '@prisma/client';
import { env } from '../config/env';

export const prisma = new PrismaClient({
  log: env.isDev ? ['warn', 'error'] : ['error'],
});

/** Round-trips a trivial query. Used by `/health` to prove the database is actually reachable. */
export async function checkDatabase(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const started = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { ok: true, latencyMs: Date.now() - started };
  } catch (err) {
    return {
      ok: false,
      latencyMs: Date.now() - started,
      // The message is for the operator reading the health endpoint, not for a browser: it is
      // only ever returned by /health, never by a data route.
      error: err instanceof Error ? err.message : 'Unknown database error',
    };
  }
}

/**
 * Options for the cascade transactions.
 *
 * Prisma's default interactive-transaction budget is five seconds. That is generous against a
 * local database and nowhere near enough against a pooled remote one: the cascade and the reset
 * each touch fifteen segments, three routes, eight deliveries and forty-five inventory rows, and
 * at ~100ms per round trip to Neon the default expires halfway through — which surfaces as
 * "Transaction not found" rather than "too slow", and cost an hour to recognise.
 *
 * Raising it does not weaken the guarantee; the transaction is still all-or-nothing. It just
 * stops a slow network from being reported as a corrupted one.
 */
export const CASCADE_TX = { timeout: 60_000, maxWait: 15_000 } as const;
