/**
 * Development request logging.
 *
 * One line per request, written when the response finishes so it can carry the status and the
 * duration. Not enabled in production: this is a demo-and-development aid, not an audit log,
 * and a real deployment wants structured logs shipped somewhere rather than stdout prose.
 */

import type { NextFunction, Request, Response } from 'express';

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const started = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - started;
    const status = res.statusCode;
    const mark = status >= 500 ? '!!' : status >= 400 ? ' !' : '  ';
    console.log(`${mark} ${String(status)} ${req.method.padEnd(4)} ${req.originalUrl} ${ms}ms`);
  });
  next();
}
