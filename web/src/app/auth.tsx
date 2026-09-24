/**
 * Frontend session handling.
 *
 * NOT a security system. The real authority is the Node API's JWT verification, arriving in
 * Phase 6; this layer decides which tabs render and which controls appear, and nothing more.
 * Anyone can edit sessionStorage — that is fine, because the backend will reject the request
 * regardless of what the client believes about itself.
 *
 * The session lives in `sessionStorage`, deliberately. The previous build held the token in
 * memory only, so pressing F5 signed the presenter out mid-demo; sessionStorage survives a
 * refresh and still clears when the tab closes, which is the right trade for a demo console.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { Role, User } from '@/domain/types';
import { dataSource } from '@/data';
import { setAuthToken } from '@/data/http';
import { capabilitiesFor, type Capabilities } from './modules';

const STORAGE_KEY = 'ner-supplyai.session';

interface StoredSession {
  token: string;
  user: User;
}

interface AuthState {
  user: User | null;
  token: string | null;
  /** True until the stored session has been read — prevents a login-page flash on refresh. */
  restoring: boolean;
  capabilities: Capabilities;
  signIn: (email: string, password: string) => Promise<User>;
  signOut: () => void;
}

const AuthCtx = createContext<AuthState | undefined>(undefined);

function readStored(): StoredSession | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredSession;
    if (!parsed?.token || !parsed?.user?.role) return null;
    return parsed;
  } catch {
    // Private-mode browsers can throw on access rather than returning null.
    return null;
  }
}

function writeStored(session: StoredSession | null): void {
  try {
    if (session) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage being unavailable degrades to memory-only; it must never break sign-in.
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<StoredSession | null>(null);
  const [restoring, setRestoring] = useState(true);

  // Restore once on boot, before the router decides what to render.
  useEffect(() => {
    const stored = readStored();
    if (stored) {
      setSession(stored);
      setAuthToken(stored.token);
    }
    setRestoring(false);
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const { token, user } = await dataSource.login(email, password);
    const next = { token, user };
    setSession(next);
    writeStored(next);
    setAuthToken(token);
    return user;
  }, []);

  const signOut = useCallback(() => {
    setSession(null);
    writeStored(null);
    setAuthToken(null);
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      user: session?.user ?? null,
      token: session?.token ?? null,
      restoring,
      capabilities: capabilitiesFor(session?.user?.role ?? 'DISTRICT_OFFICER'),
      signIn,
      signOut,
    }),
    [session, restoring, signIn, signOut],
  );

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

/** Convenience for components that only need to branch on the role. */
export function useRole(): Role | null {
  return useAuth().user?.role ?? null;
}
