/**
 * The last line of defence.
 *
 * Without a boundary, a single render throw blanks the whole browser tab — during a live
 * demonstration that is unrecoverable without a reload, and the operator gets a white page with
 * no explanation. This catches it, keeps the shell usable, and offers two escapes.
 *
 * What it is NOT: a substitute for error handling. `useResource` and `useAction` already carry
 * real failures into `ErrorState` with the underlying message intact; this only catches what
 * they cannot — an exception thrown while rendering. It deliberately re-throws nothing and
 * hides nothing: every caught error is logged to the console in full, so a genuine bug is still
 * visible to whoever is looking, while the person in front of the screen sees a recovery UI
 * rather than a stack trace.
 */

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button, Icon, IconBadge } from '@/design/primitives';

interface Props {
  children: ReactNode;
  /** Changing this resets the boundary — the router passes the pathname, so navigating recovers. */
  resetKey?: string;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidUpdate(prev: Props) {
    // Navigating away from a view that threw should clear it, otherwise the operator is stuck
    // on the error panel for the rest of the session.
    if (this.state.error && prev.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Full detail to the console — the boundary must never make a bug harder to find.
    console.error('[ErrorBoundary] render failed', error, info.componentStack);
  }

  private retry = () => this.setState({ error: null });

  private reload = () => window.location.reload();

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div
        role="alert"
        className="flex h-full min-h-0 w-full flex-1 items-center justify-center bg-ground p-6"
      >
        <section className="flex w-full max-w-[520px] flex-col items-center gap-3 rounded-panel border border-line bg-panel px-6 py-8 text-center shadow-panel">
          <IconBadge name="warning" tone="critical" size="lg" />

          <h1 className="mt-1 font-display text-title text-ink">
            This operational view could not be rendered
          </h1>

          <p className="max-w-[46ch] text-body leading-relaxed text-ink-2">
            Something went wrong drawing this screen. Your session is intact and the rest of the
            console is still usable — try the view again, or reload if it keeps failing.
          </p>

          <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
            <Button variant="primary" icon="refresh" onClick={this.retry}>
              Try again
            </Button>
            <Button variant="secondary" icon="commandCenter" onClick={this.reload}>
              Reload the console
            </Button>
          </div>

          {/* One line of technical context, not a stack trace. Enough for a presenter to relay
              to whoever is debugging; not enough to alarm anyone else. */}
          <p className="mt-3 flex items-center gap-1.5 border-t border-line-soft pt-3 text-[10.5px] text-ink-3">
            <Icon name="info" size="sm" />
            Technical detail: {error.message || error.name}. Full diagnostics are in the browser
            console.
          </p>
        </section>
      </div>
    );
  }
}
