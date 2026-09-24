/**
 * Route guards.
 *
 * `RequireAuth` gates the shell; `RequireModuleAccess` enforces the contract's per-role page
 * matrix. Neither is a security boundary — the API is — but they keep a role from landing on a
 * page whose data it would only be refused anyway, which is a worse experience than not being
 * offered the tab.
 */

import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from './auth';
import { canAccess, landingPathForRole } from './modules';

/** Shown while the stored session is being read, so a refresh does not flash the login page. */
function BootScreen() {
  return (
    <div className="flex h-full items-center justify-center bg-ground">
      <div className="flex flex-col items-center gap-3">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-line border-t-brand-500" />
        <p className="text-meta text-ink-3">Restoring session…</p>
      </div>
    </div>
  );
}

export function RequireAuth() {
  const { user, restoring } = useAuth();
  const location = useLocation();

  if (restoring) return <BootScreen />;
  if (!user) return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  return <Outlet />;
}

/** Bounces a role to its own landing page rather than showing it a 403. */
export function RequireModuleAccess() {
  const { user } = useAuth();
  const location = useLocation();

  if (!user) return <Navigate to="/login" replace />;
  if (!canAccess(user.role, location.pathname)) {
    return <Navigate to={landingPathForRole(user.role)} replace />;
  }
  return <Outlet />;
}
