/**
 * Route guards.
 *
 * The frontend hides tabs a role cannot open. That is a courtesy to the operator, not a
 * boundary — `app/modules.ts` says so in its own comment ("Neither is a security boundary — the
 * API is"). This file is the API keeping that promise.
 *
 * Two levels, matching PROJECT_CONTRACT.md section 4's matrix:
 *
 *   requireAuth   a valid, unexpired token, and the user still exists
 *   requireRole   that user holds one of the listed roles
 *
 * Read endpoints are open in Phase 4B. Writes are not: every one of them changes shared
 * operational state, and the capability matrix already says which roles may.
 */

import type { NextFunction, Request, Response } from 'express';
import type { Role } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { ApiError } from './errors';
import { verifyToken } from '../services/auth';

export interface AuthedRequest extends Request {
  auth?: { userId: string; role: Role; name: string };
}

function bearer(req: Request): string | undefined {
  const header = req.header('authorization');
  if (!header) return undefined;
  const [scheme, token] = header.split(' ');
  return scheme?.toLowerCase() === 'bearer' && token ? token : undefined;
}

/**
 * Express 4 does not await middleware, so an async guard that rejects produces an *unhandled*
 * rejection rather than a 500 — and Node kills the process. That is not theoretical: a transient
 * database blip took this server down mid-test, because a `findUnique` in here threw and nothing
 * caught it. `requireAuth` below is the exported wrapper; this is the body it calls.
 */
async function resolveAuth(
  req: AuthedRequest,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  const token = bearer(req);
  if (!token) return next(new ApiError(401, 'Sign in to continue.'));

  const payload = verifyToken(token);
  if (!payload) return next(new ApiError(401, 'Your session is not valid. Sign in again.'));

  // The token says who they were when it was issued; the database says who they are now. A
  // deleted user, or one whose role changed, must not keep acting on a token minted earlier.
  const user = await prisma.user.findUnique({
    where: { id: payload.sub },
    select: { id: true, role: true, name: true },
  });
  if (!user) return next(new ApiError(401, 'Your session is not valid. Sign in again.'));

  req.auth = { userId: user.id, role: user.role, name: user.name };
  next();
}

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction): void {
  resolveAuth(req, res, next).catch(next);
}

/** 403, not 404: they are authenticated, the thing exists, and they may not do it. */
export function requireRole(...roles: Role[]) {
  return (req: AuthedRequest, _res: Response, next: NextFunction): void => {
    if (!req.auth) return next(new ApiError(401, 'Sign in to continue.'));
    if (!roles.includes(req.auth.role)) {
      return next(new ApiError(403, 'Your role does not permit this action.'));
    }
    next();
  };
}
