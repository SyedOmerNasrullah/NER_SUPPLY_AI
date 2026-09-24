/**
 * Server entry point.
 *
 * Startup verifies the database before announcing itself. A process that logs "listening on
 * 4000" while every request will 500 is worse than one that refuses to start — the whole point
 * of the check is that the failure is visible at the moment you run the command, not twenty
 * minutes later in front of an audience.
 */

import { createApp } from './app';
import { env, redactedDatabaseUrl } from './config/env';
import { checkDatabase, prisma } from './lib/prisma';

async function main(): Promise<void> {
  console.log(`NER-SupplyAI API — phase 4A — ${env.nodeEnv}`);
  console.log(`  database  ${redactedDatabaseUrl()}`);

  const db = await checkDatabase();
  if (!db.ok) {
    console.error(`\n  Database unreachable: ${db.error}`);
    console.error('  Check DATABASE_URL in api/.env, then start again.\n');
    process.exit(1);
  }
  console.log(`  connected in ${db.latencyMs}ms`);

  const server = createApp().listen(env.port, () => {
    console.log(`  listening  http://localhost:${env.port}`);
    console.log(`  health     http://localhost:${env.port}/health\n`);
  });

  /**
   * Graceful shutdown: stop accepting connections, let in-flight requests finish, release the
   * connection pool. Without the pool release, a watch-mode restart leaks a Postgres connection
   * every time — which on a pooled host runs out faster than anyone expects.
   */
  const shutdown = (signal: string) => {
    console.log(`\n${signal} — shutting down`);
    server.close(() => {
      void prisma.$disconnect().then(() => {
        console.log('closed cleanly');
        process.exit(0);
      });
    });
    // Never hang forever on a stuck connection.
    setTimeout(() => {
      console.error('forced exit after 10s');
      process.exit(1);
    }, 10_000).unref();
  };

  /**
   * Stay up through a transient failure.
   *
   * The default behaviour for an unhandled rejection in modern Node is to terminate, which for a
   * demonstration server means a database hiccup ends the demo. Every route already funnels its
   * errors through `errorHandler`; anything reaching here is a bug worth logging loudly, but not
   * worth taking the process down for while someone is presenting.
   */
  process.on('unhandledRejection', (reason) => {
    console.error('[unhandledRejection]', reason instanceof Error ? reason.message : reason);
  });
  process.on('uncaughtException', (err) => {
    console.error('[uncaughtException]', err.message);
  });

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err: unknown) => {
  console.error('Startup failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
