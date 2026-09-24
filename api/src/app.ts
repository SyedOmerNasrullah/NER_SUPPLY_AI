/**
 * The Express application — routes and middleware, no listener.
 *
 * Kept separate from `index.ts` so the app can be imported and exercised without binding a port.
 */

import cors from 'cors';
import express, { type Express } from 'express';
import { env } from './config/env';
import { checkDatabase } from './lib/prisma';
import { errorHandler, notFoundHandler } from './middleware/errors';
import { requestLogger } from './middleware/logging';
import { api } from './routes';
import { writes } from './routes/writes';
import { ml } from './routes/ml';
import { notifications } from './routes/notifications';
import { ai } from './routes/ai';

export function createApp(): Express {
  const app = express();

  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));
  app.use(
    cors({
      // An allowlist, not `*`: once Phase 4B issues cookies or bearer tokens, a permissive
      // origin becomes a real problem, and it is cheaper to be strict from the start.
      origin: env.corsOrigins,
      credentials: true,
    }),
  );

  if (env.isDev) app.use(requestLogger);

  /**
   * Liveness and database reachability in one call.
   *
   * 503 when the database is unreachable, so a monitor sees a failure rather than a cheerful
   * 200 from a process that cannot answer a single data request. The database error message is
   * included **here only** — this endpoint exists for whoever is operating the service.
   */
  app.get('/health', async (_req, res) => {
    const db = await checkDatabase();
    res.status(db.ok ? 200 : 503).json({
      status: db.ok ? 'ok' : 'degraded',
      service: 'ner-supplyai-api',
      phase: '4A',
      env: env.nodeEnv,
      database: db.ok
        ? { status: 'ok', latencyMs: db.latencyMs }
        : { status: 'unreachable', latencyMs: db.latencyMs, error: db.error },
      // The ML service is an optional dependency: its absence degrades one feature, it does not
      // make this process unhealthy, so it never turns this endpoint into a 503.
      ml: { mode: env.ml.mode },
      uptimeSeconds: Math.round(process.uptime()),
    });
  });

  // Writes first: both routers are mounted at /api and Express matches in order, so the
  // authenticated handlers get the chance to answer before the open read router does.
  app.use('/api', writes);
  app.use('/api', ml);
  app.use('/api', notifications);
  app.use('/api', ai);
  app.use('/api', api);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
