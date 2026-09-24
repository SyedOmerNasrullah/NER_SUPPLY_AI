import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { App } from './app/App';
import { ErrorBoundary } from './app/ErrorBoundary';

/**
 * Two boundaries, deliberately.
 *
 * The inner one (in `AppShell`) catches a page and keeps navigation alive — the case that
 * matters in practice. This outer one catches the rest: the shell chrome itself, the login
 * screen, the router. It cannot offer navigation as a recovery, only a reload, but it is what
 * stands between a throw in `TopBar` and a blank browser tab.
 */
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
