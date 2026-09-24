/**
 * Twilio SMS — the only file in the project that talks to Twilio.
 *
 *   sendSms({ to, body })  ->  { sid, status }    or throws SmsError
 *
 * It calls Twilio's REST API directly (one form-encoded POST) rather than pulling in the SDK:
 * the SDK is a wrapper around exactly this request, and one `fetch` is easier to read, to time
 * out and to replace in tests.
 *
 * Credentials never leave this module. They go into the Authorization header and nowhere else —
 * not into an error, not into a log line, not into a response. Provider errors are reduced to
 * Twilio's numeric code and message, which describe the request and never contain the key.
 */

import { env } from '../config/env';

export type SmsErrorKind =
  /** One of the three Twilio keys is missing — a server configuration problem. */
  | 'NOT_CONFIGURED'
  /** The destination is not a usable phone number. Nothing was sent. */
  | 'INVALID_NUMBER'
  /** Twilio answered and refused (unverified trial destination, bad sender, and so on). */
  | 'REJECTED'
  /** Twilio could not be reached, or did not answer in time. */
  | 'UNAVAILABLE';

export class SmsError extends Error {
  readonly kind: SmsErrorKind;

  constructor(kind: SmsErrorKind, message: string) {
    super(message);
    this.name = 'SmsError';
    this.kind = kind;
  }
}

export interface SmsResult {
  /** Twilio's message SID, e.g. `SM…`. Not a secret. */
  sid: string;
  /** Twilio's own status at acceptance: usually `queued` or `accepted`. */
  status: string;
}

export interface TwilioCredentials {
  accountSid: string;
  authToken: string;
  fromNumber: string;
  timeoutMs: number;
}

/** The one network call. Swappable so tests never reach Twilio. */
export type SmsTransport = (
  creds: TwilioCredentials,
  message: { to: string; body: string },
) => Promise<SmsResult>;

// ---------------------------------------------------------------------------
// Phone numbers
// ---------------------------------------------------------------------------

/**
 * E.164, or undefined. Spaces, dashes and brackets are dropped (the seed stores
 * `+91 98xxx xxxxx`); what remains must be `+`, a non-zero country digit and 7-14 more digits.
 * A number without a country code is refused rather than guessed.
 */
export function normalizePhone(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  const compact = raw.replace(/[\s\-().]/g, '');
  return /^\+[1-9]\d{7,14}$/.test(compact) ? compact : undefined;
}

/** `+91••••••••74` — enough to recognise a number, not enough to use it. */
export function maskPhone(e164: string): string {
  return `${e164.slice(0, 3)}${'•'.repeat(Math.max(0, e164.length - 5))}${e164.slice(-2)}`;
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

const restTransport: SmsTransport = async (creds, { to, body }) => {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(creds.accountSid)}/Messages.json`;
  const auth = Buffer.from(`${creds.accountSid}:${creds.authToken}`).toString('base64');

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ To: to, From: creds.fromNumber, Body: body }),
      signal: AbortSignal.timeout(creds.timeoutMs),
    });
  } catch (err) {
    const timedOut = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
    throw new SmsError('UNAVAILABLE', timedOut ? 'Twilio did not respond in time.' : 'Twilio could not be reached.');
  }

  const payload = (await res.json().catch(() => ({}))) as {
    sid?: string;
    status?: string;
    code?: number;
    message?: string;
  };
  if (!res.ok || !payload.sid) {
    // Twilio's error body is `{ code, message, more_info, status }` — about the request, never
    // the credentials. 401 is the exception worth rewording: it means the keys are wrong.
    if (res.status === 401) throw new SmsError('NOT_CONFIGURED', 'Twilio rejected the account credentials.');
    const code = payload.code ? ` (Twilio ${payload.code})` : '';
    throw new SmsError('REJECTED', `${payload.message ?? `Twilio returned HTTP ${res.status}`}${code}`.slice(0, 300));
  }
  return { sid: payload.sid, status: payload.status ?? 'queued' };
};

let transport: SmsTransport = restTransport;
let credentialsOverride: TwilioCredentials | null | undefined;

/** Tests only: replace the network call and/or the credentials. `undefined` restores the default. */
export const smsTesting = {
  setTransport(t?: SmsTransport): void {
    transport = t ?? restTransport;
  },
  /** `null` simulates missing credentials; `undefined` goes back to the environment. */
  setCredentials(c?: TwilioCredentials | null): void {
    credentialsOverride = c;
  },
};

function credentials(): TwilioCredentials | undefined {
  if (credentialsOverride !== undefined) return credentialsOverride ?? undefined;
  const t = env.twilio;
  if (!t.accountSid || !t.authToken || !t.fromNumber) return undefined;
  return { accountSid: t.accountSid, authToken: t.authToken, fromNumber: t.fromNumber, timeoutMs: t.timeoutMs };
}

export const smsConfigured = (): boolean => credentials() !== undefined;

// ---------------------------------------------------------------------------

export async function sendSms({ to, body }: { to: string; body: string }): Promise<SmsResult> {
  const creds = credentials();
  if (!creds) throw new SmsError('NOT_CONFIGURED', 'SMS is not configured on this server.');
  const destination = normalizePhone(to);
  if (!destination) throw new SmsError('INVALID_NUMBER', 'The destination is not a valid phone number.');
  if (!body.trim()) throw new SmsError('REJECTED', 'An SMS needs a message.');
  return transport(creds, { to: destination, body });
}
