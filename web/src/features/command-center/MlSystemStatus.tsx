/**
 * What the intelligence layer is actually doing right now — delta D57.
 *
 * Four rows, and every one of them reports a fact rather than an aspiration:
 *
 *   - the two models come from `GET /api/ml/status`, which asks the model service itself.
 *     If it does not answer, this says so; it never shows LIVE because a build was configured
 *     as if a model existed.
 *   - SHAP is reported as enabled only when the service reports a loaded route model, because
 *     the explainer is built over that model and cannot run without it.
 *   - the decision engine is always active, and is labelled RULES rather than LIVE, because it
 *     is not a model and must never read as one.
 *
 * In demo mode all four read as fixtures. That is the honest answer, and it is also the answer
 * that makes the API-backed build worth showing.
 */

import { cn } from '@/lib/cn';
import type { MlStatus } from '@/domain/types';
import { Icon } from '@/design/primitives';

type Tone = 'live' | 'rules' | 'down' | 'demo' | 'checking' | 'ready' | 'absent';

const TONE: Record<Tone, { dot: string; text: string; label: string }> = {
  live: { dot: 'bg-risk-low', text: 'text-risk-low', label: 'LIVE' },
  rules: { dot: 'bg-brand-500', text: 'text-brand-700', label: 'ACTIVE' },
  down: { dot: 'bg-risk-critical', text: 'text-risk-critical', label: 'DOWN' },
  demo: { dot: 'bg-ink-3', text: 'text-ink-3', label: 'FIXTURES' },
  // Not FIXTURES. "We have not asked yet" and "there is no model here" are different answers,
  // and showing the second while the first is true reads as a claim the build cannot support —
  // on camera it appeared beside a live model version, which is the worst of both.
  checking: { dot: 'bg-ink-3 animate-pulse', text: 'text-ink-3', label: 'CHECKING' },
  // Configured and callable, but nothing has been sent. "READY" claims less than "LIVE" on
  // purpose: the server holds credentials for these, which is not the same as having used them.
  ready: { dot: 'bg-risk-low', text: 'text-risk-low', label: 'READY' },
  absent: { dot: 'bg-ink-3', text: 'text-ink-3', label: 'NOT CONFIGURED' },
};

function Row({ name, detail, tone }: { name: string; detail: string; tone: Tone }) {
  const t = TONE[tone];
  return (
    <div className="flex items-center justify-between gap-3 py-1">
      <div className="flex min-w-0 flex-col leading-tight">
        <span className="truncate text-[11px] font-semibold text-white/90">{name}</span>
        <span className="truncate text-[9.5px] text-white/50">{detail}</span>
      </div>
      <span className={cn('flex shrink-0 items-center gap-1.5 text-[9.5px] font-bold tracking-[0.05em]', t.text)}>
        <span aria-hidden className={cn('h-1.5 w-1.5 rounded-full', t.dot)} />
        {t.label}
      </span>
    </div>
  );
}

export function MlSystemStatus({
  status,
  loading,
  className,
}: {
  status?: MlStatus;
  loading?: boolean;
  className?: string;
}) {
  const demo = status?.mode === 'demo';
  const service = status?.service;
  const reachable = Boolean(service?.reachable);

  const pending = !demo && (loading || !status);
  const routeTone: Tone = demo
    ? 'demo'
    : pending
      ? 'checking'
      : reachable && service?.modelLoaded
        ? 'live'
        : 'down';
  // An explicit `true`, not "anything other than false". The field used to be stripped before
  // it reached here, so an absent value quietly rendered as LIVE — a claim nothing had checked.
  const deliveryTone: Tone = demo
    ? 'demo'
    : pending
      ? 'checking'
      : reachable && service?.deliveryModelLoaded === true
        ? 'live'
        : 'down';
  const shapTone: Tone = demo
    ? 'demo'
    : pending
      ? 'checking'
      : reachable && service?.modelLoaded
        ? 'live'
        : 'down';

  return (
    <div
      className={cn(
        'flex w-[236px] shrink-0 flex-col rounded-panel border border-white/12 bg-white/[0.06] px-3 py-2 backdrop-blur-sm',
        className,
      )}
    >
      <div className="mb-1 flex items-center gap-1.5">
        <Icon name="model" size="sm" className="text-white/60" />
        <span className="text-[9.5px] font-bold uppercase tracking-[0.08em] text-white/60">
          AI / ML status
        </span>
      </div>

      <div className="divide-y divide-white/8">
        <Row
          name="Route risk"
          detail={demo ? 'no model called' : (service?.modelVersion ?? 'route-risk-xgb-v1')}
          tone={routeTone}
        />
        <Row
          name="Delivery risk"
          detail={demo ? 'no model called' : (service?.deliveryModelVersion ?? 'delivery-risk-xgb-v1')}
          tone={deliveryTone}
        />
        <Row name="SHAP" detail="TreeExplainer attribution" tone={shapTone} />
        <Row name="Decision engine" detail="Deterministic rules, not a model" tone="rules" />
        <Row
          name="ORS routing"
          detail={demo ? 'committed geometry artifact' : 'road geometry + elevation'}
          tone={demo ? 'demo' : pending ? 'checking' : status?.services?.ors ? 'ready' : 'absent'}
        />
        <Row
          name="Twilio"
          detail="SMS / voice to officers"
          tone={demo ? 'demo' : pending ? 'checking' : status?.services?.twilio ? 'ready' : 'absent'}
        />
      </div>

      {!demo && !reachable && !pending ? (
        <p className="mt-1 text-[9px] leading-snug text-risk-critical">
          Showing the last stored predictions, not fresh ones.
        </p>
      ) : null}
    </div>
  );
}
