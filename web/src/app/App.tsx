/**
 * Routing.
 *
 * Every one of the nine modules resolves to a built page — there are no placeholders and no
 * dead navigation entries. `PAGES` is keyed by module id so the tab bar in `app/modules.ts` and
 * the route table cannot drift apart: a module with no entry here would fail to build rather
 * than silently render nothing.
 *
 * `/kitchen-sink` is a development route, deliberately outside the module list so it never
 * appears in navigation.
 */

import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './auth';
import { RequireAuth, RequireModuleAccess } from './RequireAuth';
import { MODULES, type ModuleId } from './modules';
import { AppShell } from '@/shell/AppShell';
import { Login } from '@/pages/Login';
import { CommandCenter } from '@/features/command-center/CommandCenter';
import { RouteIntelligence } from '@/features/route-intelligence/RouteIntelligence';
import { DeliveryIntelligence } from '@/features/delivery-intelligence/DeliveryIntelligence';
import { SupplyIntelligence } from '@/features/supply-intelligence/SupplyIntelligence';
import { IncidentCenter } from '@/features/incident-center/IncidentCenter';
import { LiveMap } from '@/features/live-map/LiveMap';
import { RiskCenter } from '@/features/risk-center/RiskCenter';
import { FieldOperations } from '@/features/field-operations/FieldOperations';
import { Analytics } from '@/features/analytics/Analytics';
import { KitchenSink } from '@/pages/KitchenSink';

/**
 * One entry per module id in `app/modules.ts`. Typed as a total record over those ids so that
 * adding a module without a page is a compile error, not a blank screen.
 */
const PAGES: Record<ModuleId, JSX.Element> = {
  'command-center': <CommandCenter />,
  routes: <RouteIntelligence />,
  deliveries: <DeliveryIntelligence />,
  supply: <SupplyIntelligence />,
  incidents: <IncidentCenter />,
  'live-map': <LiveMap />,
  risk: <RiskCenter />,
  operations: <FieldOperations />,
  analytics: <Analytics />,
};

export function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />

          {/* The design-system reference. Outside the shell so it can be reviewed full-bleed,
              and outside the module list so it never shows up in the tab bar. */}
          <Route path="/kitchen-sink" element={<KitchenSink />} />

          <Route element={<RequireAuth />}>
            <Route element={<AppShell />}>
              <Route element={<RequireModuleAccess />}>
                {MODULES.map((m) => (
                  <Route key={m.id} path={m.path} element={PAGES[m.id]} />
                ))}
                {/* Delivery Intelligence also answers on a specific delivery code, so the
                    Command Center and Route Intelligence can link straight to one. */}
                <Route path="/deliveries/:code" element={<DeliveryIntelligence />} />
              </Route>
            </Route>
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
