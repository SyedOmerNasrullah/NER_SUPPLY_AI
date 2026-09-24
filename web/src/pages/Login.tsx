/**
 * Login — a split composition: the corridor on the left, the form on the right.
 *
 * The photograph is not decoration. It is the road the demo delivery actually travels, with a
 * loaded supply vehicle on it, and it sets the subject before a single number appears. The four
 * demo accounts are listed on the form because a presenter under pressure should not have to
 * remember which address maps to which role.
 */

import { useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/app/auth';
import { landingPathForRole } from '@/app/modules';
import { DataError, dataSource } from '@/data';
import { useResource } from '@/data/hooks';
import { humanizeEnum } from '@/domain/format';
import { cn } from '@/lib/cn';
import { Button, Icon } from '@/design/primitives';
import { BrandLockup } from '@/shell/BrandMark';
import ridgeline from '@/assets/ner-ridgeline.jpg';
import corridorRoad from '@/assets/ner-corridor-road.jpg';

export function Login() {
  const { user, signIn, restoring } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  // Demo accounts come through the data source, so this page holds no fixture import and the
  // panel disappears on its own once the app talks to a real backend.
  const demo = useResource(() => dataSource.getDemoAccounts(), []);
  const demoPassword = demo.data?.password ?? '';

  const [email, setEmail] = useState('admin@ner.local');
  const [password, setPassword] = useState('demo123');
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});
  const [pending, setPending] = useState(false);

  if (!restoring && user) {
    const from = (location.state as { from?: string } | null)?.from;
    return <Navigate to={from ?? landingPathForRole(user.role)} replace />;
  }

  /**
   * Client-side checks answer the two mistakes that do not need a round trip — an empty field
   * and a malformed address — inline and beside the field that caused them. Anything else is
   * the server's answer and is shown as one message above the button; the client never guesses
   * at why a credential was rejected.
   */
  function validate(): boolean {
    const next: { email?: string; password?: string } = {};
    const trimmed = email.trim();
    if (!trimmed) next.email = 'Enter your official email address.';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      next.email = 'That does not look like an email address.';
    }
    if (!password) next.password = 'Enter your password.';
    setFieldErrors(next);
    return Object.keys(next).length === 0;
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!validate()) return;

    setPending(true);
    try {
      const signedIn = await signIn(email, password);
      navigate(landingPathForRole(signedIn.role), { replace: true });
    } catch (err) {
      setError(err instanceof DataError ? err.message : 'Sign-in failed. Try again.');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="grid h-full min-h-0 grid-cols-1 bg-ground lg:grid-cols-[1.15fr_minmax(440px,0.85fr)]">
      {/* ---------------------------------------------------------------- Left */}
      <section className="relative isolate hidden overflow-hidden lg:flex lg:flex-col lg:justify-between">
        <img
          src={ridgeline}
          alt=""
          aria-hidden
          className="absolute inset-0 -z-20 h-full w-full object-cover"
          style={{ objectPosition: 'center 55%' }}
        />
        <div
          className="absolute inset-0 -z-10"
          style={{
            background:
              'linear-gradient(158deg, rgb(var(--brand-900) / 0.92) 0%, rgb(var(--brand-900) / 0.72) 45%, rgb(var(--brand-700) / 0.52) 100%)',
          }}
          aria-hidden
        />

        <div className="flex flex-col gap-2 p-8">
          <BrandLockup onNavy />
          <p className="max-w-[46ch] text-[12.5px] leading-snug text-white/60">
            AI-powered logistics and accessibility intelligence for the North Eastern Region.
          </p>
        </div>

        <div className="flex flex-col gap-5 p-8 pb-10">
          <p className="max-w-[22ch] font-display text-[40px] font-semibold leading-[1.08] tracking-[-0.03em] text-white">
            Predict the disruption before the road closes.
          </p>

          <p className="max-w-[52ch] text-[14px] leading-relaxed text-white/75">
            NER-SupplyAI is not a navigation system that tells you where a vehicle is. It predicts
            when an essential delivery is likely to fail, recommends what to do before it does, and
            makes sure the right officer is actually notified.
          </p>

          <div className="mt-1 flex flex-wrap items-center gap-x-6 gap-y-3">
            {[
              { icon: 'model' as const, label: 'XGBoost risk models' },
              { icon: 'explanation' as const, label: 'SHAP explanations' },
              { icon: 'notify' as const, label: 'SMS / voice escalation' },
            ].map((f) => (
              <span key={f.label} className="flex items-center gap-2 text-[12.5px] text-white/70">
                <Icon name={f.icon} size="md" className="text-white/50" />
                {f.label}
              </span>
            ))}
          </div>

          <div className="mt-2 flex items-center gap-3 border-t border-white/15 pt-4">
            <img
              src={corridorRoad}
              alt=""
              aria-hidden
              className="h-11 w-16 shrink-0 rounded-[7px] object-cover ring-1 ring-white/20"
            />
            <p className="text-[11px] leading-snug text-white/55">
              NH-13 on the approach to Sela Pass, 4 170 m — one of fifteen segments on the
              Guwahati → Tawang corridor this system monitors.
            </p>
          </div>
        </div>

        <span className="pointer-events-none absolute bottom-2 right-3 text-[9.5px] text-white/30">
          Photo: Kingshuk Mondal, CC BY 4.0
        </span>
      </section>

      {/* --------------------------------------------------------------- Right */}
      <section className="flex min-h-0 items-center justify-center overflow-y-auto scroll-thin bg-panel px-6 py-10">
        <div className="w-full max-w-[368px]">
          <div className="lg:hidden">
            <BrandLockup className="mb-8" />
          </div>

          <p className="t-label">Government of India · NER Logistics</p>
          <h1 className="mt-1.5 font-display text-[26px] font-semibold tracking-[-0.02em] text-ink">
            Sign in to the console
          </h1>
          <p className="mt-1 text-body text-ink-2">
            Access is role-based. You will land on the modules your role is cleared for.
          </p>

          {/* noValidate: the browser's own constraint bubble blocks submit before React sees it,
              so the styled inline errors below would never appear and the user would get a
              native tooltip that belongs to no design system. Validation is ours. */}
          <form noValidate onSubmit={onSubmit} className="mt-7 flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="email" className="t-label">
                Official email
              </label>
              <input
                id="email"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  if (fieldErrors.email) setFieldErrors((f) => ({ ...f, email: undefined }));
                }}
                aria-invalid={Boolean(fieldErrors.email)}
                aria-describedby={fieldErrors.email ? 'email-error' : undefined}
                className={cn('field', fieldErrors.email && 'border-risk-critical/60')}
                placeholder="officer@ner.local"
              />
              {fieldErrors.email ? (
                <p id="email-error" className="text-meta text-risk-critical">
                  {fieldErrors.email}
                </p>
              ) : null}
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="password" className="t-label">
                Password
              </label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (fieldErrors.password) setFieldErrors((f) => ({ ...f, password: undefined }));
                }}
                aria-invalid={Boolean(fieldErrors.password)}
                aria-describedby={fieldErrors.password ? 'password-error' : undefined}
                className={cn('field', fieldErrors.password && 'border-risk-critical/60')}
                placeholder="••••••••"
              />
              {fieldErrors.password ? (
                <p id="password-error" className="text-meta text-risk-critical">
                  {fieldErrors.password}
                </p>
              ) : null}
            </div>

            {error ? (
              <p
                role="alert"
                className="flex items-center gap-2 rounded-control border border-risk-critical/20 bg-risk-wash-critical px-3 py-2 text-meta text-risk-critical"
              >
                <Icon name="warning" size="sm" />
                {error}
              </p>
            ) : null}

            <Button type="submit" variant="primary" pending={pending} iconRight="arrowRight" className="mt-1 w-full">
              {pending ? 'Signing in' : 'Sign in'}
            </Button>
          </form>

          {/* Demo accounts. Present because the runbook says a presenter should never have to
              recall these under pressure — and because the password is public in any case.
              Absent entirely when the data source has no such list, i.e. against a real API. */}
          {demo.data && demo.data.accounts.length > 0 ? (
          <div className="mt-8 rounded-panel border border-line bg-panel-alt p-3.5">
            <div className="mb-2 flex items-center gap-1.5">
              <Icon name="info" size="sm" className="text-ink-3" />
              <span className="t-label">Demo accounts · password {demoPassword}</span>
            </div>
            <ul className="flex flex-col divide-y divide-line-soft">
              {demo.data.accounts.map((u) => (
                <li key={u.email}>
                  <button
                    type="button"
                    onClick={() => {
                      setEmail(u.email);
                      setPassword(demoPassword);
                      setError(null);
                      setFieldErrors({});
                    }}
                    className="group flex w-full items-center gap-2 py-1.5 text-left transition-colors"
                  >
                    <span className="tnum w-[128px] shrink-0 truncate text-meta text-ink-2 group-hover:text-brand-700">
                      {u.email}
                    </span>
                    <span className="truncate text-meta text-ink-3">{humanizeEnum(u.role)}</span>
                    <Icon
                      name="arrowRight"
                      size="sm"
                      className="ml-auto shrink-0 text-transparent transition-colors group-hover:text-brand-500"
                    />
                  </button>
                </li>
              ))}
            </ul>
          </div>
          ) : null}

          <p className="mt-6 text-[10.5px] leading-relaxed text-ink-3">
            SIH 2026 · Problem statement SIH26002. This console runs on deterministic demonstration
            data; figures shown are synthetic and are labelled as such throughout.
          </p>
        </div>
      </section>
    </div>
  );
}
