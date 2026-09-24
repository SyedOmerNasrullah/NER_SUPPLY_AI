/**
 * Authentication — password hashing and session tokens.
 *
 * Deliberately small. The product needs four roles and a signed token; it does not need a
 * framework, refresh-token rotation or a session store, and adding them now would be inventing
 * requirements. What it does need is for every rule below to be enforced on the server, because
 * the frontend's role-based navigation is a convenience, not a boundary — a hidden tab is one
 * `curl` away from being visited.
 */

import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { Role } from '@prisma/client';
import { env } from '../config/env';

/**
 * bcrypt work factor.
 *
 * 10 is the library default and takes roughly 60-80 ms per hash here. That cost is the point:
 * it is what makes a leaked hash table expensive to attack. It also means the seed takes a
 * second or two to hash sixteen accounts, which is fine — it runs once.
 */
const BCRYPT_ROUNDS = 10;

/** Tokens last a working day. Long enough for a demo and a shift; short enough to expire. */
const TOKEN_TTL = '12h';

export interface TokenPayload {
  sub: string;
  role: Role;
}

export const hashPassword = (plain: string): Promise<string> => bcrypt.hash(plain, BCRYPT_ROUNDS);

/**
 * Constant-time-ish comparison via bcrypt.
 *
 * Returns false rather than throwing on a malformed stored hash — the Phase 4A seed wrote a
 * marker string into `passwordHash`, and a row never re-seeded would otherwise make bcrypt throw
 * and turn a failed login into a 500.
 */
export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  try {
    return await bcrypt.compare(plain, hash);
  } catch {
    return false;
  }
}

export function signToken(payload: TokenPayload): string {
  return jwt.sign(payload, env.jwtSecret, { expiresIn: TOKEN_TTL });
}

/** Returns the payload, or undefined for anything not currently valid. No distinction is made
 *  between expired, tampered and malformed: the caller gets 401 either way, and saying which
 *  only helps someone probing. */
export function verifyToken(token: string): TokenPayload | undefined {
  try {
    const decoded = jwt.verify(token, env.jwtSecret);
    if (typeof decoded === 'string' || !decoded.sub || !('role' in decoded)) return undefined;
    return { sub: String(decoded.sub), role: decoded.role as Role };
  } catch {
    return undefined;
  }
}
