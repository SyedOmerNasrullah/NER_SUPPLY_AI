/**
 * Error handling.
 *
 * Two rules, both from PROJECT_CONTRACT.md section 10:
 *
 *   1. Every failure is `{ error: string }` with a real HTTP status. The frontend's DataError
 *      reads exactly that shape, so any other envelope becomes "Unexpected error" on screen.
 *   2. A database error never reaches the browser. Prisma messages carry table names, column
 *      names and sometimes the failing values — a stack trace of the schema, handed to whoever
 *      asked. The client gets a sentence; the server log gets everything.
 */

import type { NextFunction, Request, Response } from 'express';
import { env } from '../config/env';
import { MlError, type MlErrorKind } from '../services/mlClient';

/**
 *   409  ML_MODE is demo — the request is valid, the server is configured not to serve it
 *   503  the ML service is down or too slow — try again
 *   502  the ML service answered wrongly — an upstream fault, not the caller's
 */
const ML_STATUS: Record<MlErrorKind, number> = {
  DISABLED: 409,
  UNAVAILABLE: 503,
  TIMEOUT: 503,
  REJECTED: 502,
  INVALID_RESPONSE: 502,
};

const ML_MESSAGE: Record<MlErrorKind, string> = {
  DISABLED: 'Live ML is not enabled on this server (ML_MODE is "demo").',
  UNAVAILABLE: 'The risk model is temporarily unavailable. Try again shortly.',
  TIMEOUT: 'The risk model did not respond in time. Try again shortly.',
  REJECTED: 'The risk model could not score this request.',
  INVALID_RESPONSE: 'The risk model returned an unusable result.',
};

/** An error whose message IS safe to show the caller, because we wrote it. */
export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }

  static notFound(what: string): ApiError {
    return new ApiError(404, `${what} not found.`);
  }

  static badRequest(message: string): ApiError {
    return new ApiError(400, message);
  }
}

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({ error: `No route matches ${req.method} ${req.path}.` });
}

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  // Express identifies an error handler by its arity, so this stays even though it is unused.
  _next: NextFunction,
): void {
  if (err instanceof ApiError) {
    res.status(err.status).json({ error: err.message });
    return;
  }

  // The ML service's failures. The client gets a status that says whose problem it is and one
  // sentence; the Python-side detail (HTTP status, validation messages) goes to the log only.
  if (err instanceof MlError) {
    const status = ML_STATUS[err.kind];
    console.error(`[ml] ${req.method} ${req.originalUrl} — ${err.kind}${err.detail ? `: ${err.detail}` : ''}`);
    res.status(status).json({ error: ML_MESSAGE[err.kind] });
    return;
  }

  // Prisma's connection errors carry the database host in both the message and `meta`. They are
  // also the one class of failure where the caller genuinely benefits from knowing it is not
  // their request's fault — so they become 503 with a sentence, and the host stays server-side.
  const code = (err as { code?: string } | undefined)?.code;
  if (code === 'P1001' || code === 'P1002' || code === 'P1017') {
    console.error(`[error] ${req.method} ${req.originalUrl} — database unreachable (${code})`);
    res.status(503).json({ error: 'The database is temporarily unreachable. Try again shortly.' });
    return;
  }

  const detail = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  console.error(`[error] ${req.method} ${req.originalUrl} — ${detail}`);
  if (env.isDev && err instanceof Error && err.stack) console.error(err.stack);

  // Deliberately generic. Whatever went wrong, the caller learns only that something did.
  res.status(500).json({ error: 'Something went wrong handling this request.' });
}

/**
 * Wraps an async handler so a rejected promise reaches `errorHandler`.
 *
 * Express 4 does not await handlers, so without this an async throw becomes an unhandled
 * rejection and the request hangs until the client times out.
 */
export function asyncRoute<T extends Request>(
  fn: (req: T, res: Response) => Promise<unknown>,
): (req: T, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    fn(req, res).catch(next);
  };
}
