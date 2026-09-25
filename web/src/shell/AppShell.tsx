/**
 * AppShell — the frame every authenticated page renders inside.
 *
 *   TopBar        54px   identity, clock, live status, alerts, user
 *   ModuleTabs    44px   visible navigation + a page-mounted action slot
 *   <Outlet>      1fr    the page, which owns its own scrolling
 *   StatusRail    30px   data source, connection, demo state
 *
 * Two rows of chrome rather than the single combined header in the visual reference: nine
 * labelled tabs plus the identity block plus the right cluster do not fit on one row at the
 * 1280px width this product has to support, and truncating tab labels to force it would cost
 * more than the row costs.
 *
 * Pages mount their own toolbar controls through `useShellActions`, so page-level actions land
 * on one consistent rail instead of floating into whatever corner each page picks.
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
import { Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '@/app/auth';
import { ErrorBoundary } from '@/app/ErrorBoundary';
import { capabilitiesFor } from '@/app/modules';
import { dataSource, isDemoMode } from '@/data';
import { appNowIso } from '@/data/clock';
import { useAction, useAlerts, useResource } from '@/data/hooks';
import { TopBar } from './TopBar';
import { ModuleTabs } from './ModuleTabs';
import { StatusRail } from './StatusRail';
import { AiDemoPanel, StartAiDemoButton } from '@/features/ai-demo/AiDemoPanel';
import { AiDemoProvider } from '@/features/ai-demo/context';

interface ShellState {
  /** A page mounts controls into the tab bar's right slot for as long as it is on screen. */
  setActions: (node: ReactNode) => void;
  /** Extra readouts a page contributes to the status rail. */
  setRailNote: (node: ReactNode) => void;
}

const ShellCtx = createContext<ShellState | undefined>(undefined);

function useShell(): ShellState {
  const ctx = useContext(ShellCtx);
  if (!ctx) throw new Error('useShell must be used inside <AppShell>');
  return ctx;
}

/**
 * Mount controls into the tab bar for the lifetime of the calling page.
 *
 * `deps` decides when the node is rebuilt — the caller knows what actually changes its control,
 * and rebuilding on every render would remount the buttons continuously.
 */
export function useShellActions(node: ReactNode, deps: unknown[]): void {
  const { setActions } = useShell();
  useEffect(() => {
    setActions(node);
    return () => setActions(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

export function useShellRailNote(node: ReactNode, deps: unknown[]): void {
  const { setRailNote } = useShell();
  useEffect(() => {
    setRailNote(node);
    return () => setRailNote(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

export function AppShell() {
  const { user, signOut } = useAuth();
  const { pathname } = useLocation();
  const [actions, setActions] = useState<ReactNode>(null);
  const [railNote, setRailNote] = useState<ReactNode>(null);

  const alerts = useAlerts();

  // The runbook's "reset demo button, top right, ADMIN only". It goes through the existing
  // `resetDemo` seam, and `useAction` bumps the cascade version afterwards so all nine pages
  // refetch from the restored world — no reload, no second mechanism.
  const resetDemo = useAction(() => dataSource.resetDemo());

  const value = useMemo<ShellState>(() => ({ setActions, setRailNote }), []);

  // Socket.IO arrives in Phase 6. The demo adapter is, correctly, always "connected" — there is
  // no transport to lose — and this becomes the real connection state then.
  const live = true;

  const mlStatus = useResource(() => dataSource.getMlStatus(), []);

  const alertCount = useMemo(
    () =>
      (alerts.data?.alerts ?? []).filter((a) => a.severity === 'CRITICAL' || a.severity === 'HIGH')
        .length,
    [alerts.data],
  );

  const scrollToAlerts = useCallback(() => {
    document.getElementById('priority-alerts')?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  if (!user) return null;

  /**
   * What the rail says about the models — delta D55.
   *
   * This used to be inferred from the data source alone, so it announced `route-risk-xgb-v1`
   * in API mode whether or not the service was answering, and said "not connected" in demo mode
   * without distinguishing "there is no model here" from "the model is down". Three different
   * situations, two labels, and the one that mattered most during a demonstration — the service
   * has fallen over — looked exactly like the healthy case.
   *
   * It now reports what `GET /api/ml/status` actually said.
   */
  const modelStatus = useMemo(() => {
    if (isDemoMode) {
      return {
        value: 'demo fixtures',
        tone: 'muted' as const,
        title:
          'This build calls no model service. Risk values are seeded fixtures standing in for XGBoost output, and every panel is labelled accordingly.',
      };
    }
    if (mlStatus.loading) {
      return { value: 'checking…', tone: 'muted' as const, title: 'Asking the model service whether it is up.' };
    }
    const service = mlStatus.data?.service;
    if (!service?.reachable) {
      return {
        value: 'unreachable',
        tone: 'bad' as const,
        title: `The model service is configured but not answering${service?.reason ? ` (${service.reason})` : ''}. Scores on screen are the last ones stored, not fresh predictions.`,
      };
    }
    return {
      value: `${service.modelVersion ?? 'model'} · XGBoost + SHAP`,
      tone: 'good' as const,
      title: `Connected. ${service.modelVersion ?? 'Route risk'} and ${service.deliveryModelVersion ?? 'delivery risk'} are loaded and serving predictions, explained by SHAP.`,
    };
  }, [mlStatus.loading, mlStatus.data]);

  return (
    <ShellCtx.Provider value={value}>
      <AiDemoProvider>
      <div className="flex h-full min-h-0 flex-col bg-ground">
        <TopBar
          user={user}
          onSignOut={signOut}
          nowIso={appNowIso()}
          live={live}
          alertCount={alertCount}
          onOpenAlerts={scrollToAlerts}
          // Phase 3F also required `isDemoMode`, on the reasoning that a real deployment has
          // nothing to reset. Phase 4B made that false: the API implements `POST /api/demo/reset`
          // against the seeded demonstration database and enforces ADMIN itself, returning 403
          // to anyone else. Gating on the demo adapter here hid a control the server was
          // offering — the kind of mismatch no amount of backend mapping can fix. Delta D29.
          canResetDemo={capabilitiesFor(user.role).resetDemo}
          onResetDemo={resetDemo.run}
          resettingDemo={resetDemo.pending}
        />

        <ModuleTabs role={user.role} actions={actions} />

        {/* The page owns its own scrolling; the shell never scrolls.

            The boundary sits *inside* the shell on purpose: a page that fails to render leaves
            navigation, alerts and the status rail intact, so the operator moves to another
            module instead of losing the console. Keying it on the pathname means that move
            also clears the error. */}
        {/* The page and the demonstration rail share this row. The rail renders nothing at all
            unless a demonstration is running, so normal use is byte-for-byte what it was. */}
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <main className="min-h-0 flex-1 overflow-hidden">
            <ErrorBoundary resetKey={pathname}>
              <Outlet />
            </ErrorBoundary>
          </main>
          <AiDemoPanel />
        </div>

        <StatusRail
          live={live}
          demoMode={isDemoMode}
          segments={[
            {
              icon: 'routes',
              label: 'Corridor',
              value: 'Guwahati → Tawang',
              title: 'The seeded demo corridor: 16 towns, 15 segments along NH-15 / NH-13.',
            },
            {
              icon: 'model',
              label: 'Models',
              value: modelStatus.value,
              title: modelStatus.title,
              tone: modelStatus.tone,
            },
            {
              icon: 'weather',
              label: 'Conditions',
              value: 'synthetic',
              title: 'Weather inputs come from the seeded snapshot, overwritten by the simulate control.',
            },
          ]}
          // The demonstration is opt-in and lives in the persistent chrome, so it is reachable
          // from any page and absent from none — and it disappears entirely once running.
          right={
            <div className="flex items-center gap-3">
              <StartAiDemoButton />
              {railNote}
            </div>
          }
        />
      </div>
      </AiDemoProvider>
    </ShellCtx.Provider>
  );
}
