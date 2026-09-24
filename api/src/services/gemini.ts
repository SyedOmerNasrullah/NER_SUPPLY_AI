/**
 * Gemini — the only file that talks to a language model.
 *
 * Two jobs, and a hard line between them and everything else in this system:
 *
 *   explainRisk()             turns numbers the models already produced into a sentence
 *   classifyIncidentImage()   reads a photograph and returns structured evidence
 *
 * What Gemini may never do here: produce a risk score, a failure probability, a delay, a
 * stockout figure, or a decision. Those come from XGBoost and from the deterministic engine, and
 * they reach this file as inputs. The prompt says so, and — because a prompt is a request rather
 * than a guarantee — `containsOnlyKnownNumbers()` checks the reply and discards it if a number
 * appears that was not in the data. A discarded reply falls back to a template built from the
 * same figures, so the operator always gets an explanation and the numbers are always ours.
 *
 * The same rule shapes the vision path: a classification is EVIDENCE, stored beside the
 * reporter's own classification (`cvDetectedClass`), never over it. The reporter's `type` and the
 * reported coordinates are untouched by anything in this file.
 *
 * The API key lives in the environment, is sent only in the request URL to Google, and never
 * appears in a log line, an error, or a response.
 */

import { createHash } from 'node:crypto';
import { env } from '../config/env';

export type ExplanationSource = 'LLM_EXPLANATION' | 'DETERMINISTIC_TEMPLATE';

export interface ExplainFactor {
  factor: string;
  contributionPct: number;
  direction?: string;
}

export interface ExplainInput {
  kind: 'ROUTE' | 'DELIVERY' | 'DECISION';
  /** What is being explained: "Route A", "NE-102", "REROUTE". */
  subject: string;
  /** The numbers. Every figure the sentence may mention has to be in here. */
  figures: Record<string, number | string>;
  factors?: ExplainFactor[];
}

export interface Explanation {
  text: string;
  source: ExplanationSource;
  /** The model that wrote it, when one did. */
  model: string | null;
  cached: boolean;
  /** Present when Gemini was tried and did not produce a usable answer. */
  fallbackReason?: string;
}

// ---------------------------------------------------------------------------
// Cache — one explanation per distinct set of figures
// ---------------------------------------------------------------------------

const CACHE_MAX = 200;
const cache = new Map<string, Explanation>();

const cacheKey = (input: ExplainInput): string =>
  createHash('sha256').update(JSON.stringify(input)).digest('hex');

/** Tests only. */
export const clearExplanationCache = (): void => cache.clear();

// ---------------------------------------------------------------------------
// The honesty guard
// ---------------------------------------------------------------------------

/** Every number mentioned in the figures and factors, plus their rounded forms. */
function allowedNumbers(input: ExplainInput): number[] {
  const values: number[] = [];
  const add = (n: number) => {
    values.push(n, Math.round(n), Math.round(n * 10) / 10, Math.round(n * 100));
  };
  // The subject counts as data: a delivery is called NE-102, and a note that names it is
  // repeating an identifier, not inventing a figure.
  for (const match of input.subject.matchAll(/-?\d+(?:\.\d+)?/g)) add(Number(match[0]));
  for (const value of Object.values(input.figures)) {
    if (typeof value === 'number') add(value);
    else for (const match of value.matchAll(/-?\d+(?:\.\d+)?/g)) add(Number(match[0]));
  }
  for (const f of input.factors ?? []) add(f.contributionPct);
  return values;
}

/**
 * True when every number in the text corresponds to one we supplied.
 *
 * Deliberately a little generous — a model writing "2 days" from 50.9 hours is reasoning from
 * our figure, not inventing one — so a number also passes if it is within 1 of an allowed value,
 * or is an allowed value divided by 24 (hours to days) or by 60 (minutes to hours), rounded.
 */
export function containsOnlyKnownNumbers(text: string, input: ExplainInput): boolean {
  const allowed = allowedNumbers(input);
  // Unit conversions a reader would recognise as the same fact: hours from minutes, days from
  // hours. Held to a tighter tolerance than the figures themselves, because a loose one lets a
  // genuinely invented small number ("3 vehicles") land near some derived value by accident.
  const derived = allowed.flatMap((n) => [n / 24, n / 60]).map((n) => Math.round(n * 10) / 10);

  for (const match of text.matchAll(/-?\d+(?:\.\d+)?/g)) {
    const n = Number(match[0]);
    const known = allowed.some((c) => Math.abs(c - n) <= 1);
    const converted = derived.some((c) => Math.abs(c - n) <= 0.5);
    if (!known && !converted) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// The deterministic fallback — always available, never wrong
// ---------------------------------------------------------------------------

export function templateExplanation(input: ExplainInput): string {
  const figures = Object.entries(input.figures)
    .map(([k, v]) => `${k.replace(/([A-Z])/g, ' $1').toLowerCase().trim()} ${v}`)
    .join(', ');
  const drivers = (input.factors ?? [])
    .slice(0, 3)
    .map((f) => `${f.factor} (${Math.round(f.contributionPct * 10) / 10}%${f.direction === 'decreases_risk' ? ', lowering risk' : ''})`)
    .join(', ');

  if (input.kind === 'DECISION') {
    return `${input.subject}: ${figures}.${drivers ? ` Strongest drivers: ${drivers}.` : ''}`;
  }
  return (
    `${input.subject} — ${figures}.` +
    (drivers ? ` The model attributes most of this to ${drivers}.` : '')
  );
}

// ---------------------------------------------------------------------------
// The call
// ---------------------------------------------------------------------------

function prompt(input: ExplainInput): string {
  const lines = [
    'You are writing one short operational note for a logistics controller in the North Eastern Region of India.',
    '',
    'RULES, absolute:',
    '- Use ONLY the numbers given below. Never introduce, estimate, round differently, or infer any other number.',
    '- Do not contradict the figures. Do not add causes that are not in the factor list.',
    '- Two or three sentences, under 55 words, plain English, no bullet points, no headings, no markdown.',
    '- Reply with the note only. Do not repeat the subject line, do not add a title.',
    '- Say what is happening and what it means operationally. Do not recommend an action unless one is given.',
    '',
    `SUBJECT: ${input.subject} (${input.kind.toLowerCase()})`,
    'FIGURES:',
    ...Object.entries(input.figures).map(([k, v]) => `- ${k}: ${v}`),
  ];
  if (input.factors?.length) {
    lines.push('CONTRIBUTING FACTORS (from SHAP, strongest first):');
    for (const f of input.factors) {
      lines.push(`- ${f.factor}: ${f.contributionPct}% of the shown attribution${f.direction ? ` (${f.direction.replace(/_/g, ' ')})` : ''}`);
    }
  }
  return lines.join('\n');
}

/** Statuses worth one retry: the model is busy, not wrong. */
const TRANSIENT = new Set([429, 500, 502, 503, 504]);

async function callGemini(text: string, attempt = 1): Promise<string> {
  const { apiKey, model, timeoutMs } = env.gemini;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text }] }],
      // Generous enough for a thinking model to reason and still answer: a small budget
      // comes back with an empty body rather than a short note.
      generationConfig: { temperature: 0.2, maxOutputTokens: 800 },
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    // A busy model is worth one more try; a rejected request is not.
    if (TRANSIENT.has(res.status) && attempt === 1) {
      await new Promise((r) => setTimeout(r, 900));
      return callGemini(text, 2);
    }
    // Google's error body can echo the request; only the status travels onward.
    throw new Error(`Gemini returned HTTP ${res.status}`);
  }
  const body = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const reply = body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('').trim();
  if (!reply) throw new Error('Gemini returned no text');
  return reply;
}

/**
 * A sentence about numbers that already exist.
 *
 * Never throws: every failure path — not configured, timeout, HTTP error, a reply that invents a
 * number — ends in the deterministic template, because losing the explanation is a worse outcome
 * than losing the prose.
 */
export async function explainRisk(input: ExplainInput): Promise<Explanation> {
  const key = cacheKey(input);
  const hit = cache.get(key);
  if (hit) return { ...hit, cached: true };

  const template = (source: ExplanationSource, reason?: string): Explanation => ({
    text: templateExplanation(input),
    source,
    model: null,
    cached: false,
    fallbackReason: reason,
  });

  if (!env.gemini.configured) {
    return template('DETERMINISTIC_TEMPLATE', 'Gemini is not configured on this server.');
  }

  let explanation: Explanation;
  try {
    const text = await callGemini(prompt(input));
    explanation = containsOnlyKnownNumbers(text, input)
      ? { text, source: 'LLM_EXPLANATION', model: env.gemini.model, cached: false }
      : template('DETERMINISTIC_TEMPLATE', 'The model introduced a number that is not in the data.');
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'Gemini was unreachable.';
    console.error(`[gemini] explanation failed — ${reason}`);
    explanation = template('DETERMINISTIC_TEMPLATE', reason);
  }

  // Only a real explanation is cached. Caching the fallback would turn one busy minute at the
  // provider into an outage that never ends, because every later request would be served the
  // stored failure instead of trying again.
  if (explanation.source === 'LLM_EXPLANATION') {
    if (cache.size >= CACHE_MAX) cache.clear();
    cache.set(key, explanation);
  }
  return explanation;
}

// ---------------------------------------------------------------------------
// Vision — evidence, not authority
// ---------------------------------------------------------------------------

export const INCIDENT_CLASSES = ['LANDSLIDE', 'FLOOD', 'DEBRIS', 'DAMAGED_ROAD', 'BLOCKED_ROAD', 'NORMAL'] as const;
export const BLOCKAGE_LEVELS = ['NONE', 'PARTIAL', 'SEVERE'] as const;
const SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;

export interface VisionEvidence {
  incidentType: (typeof INCIDENT_CLASSES)[number];
  confidence: number;
  observedEvidence: string;
  recommendedSeverity: (typeof SEVERITIES)[number];
  estimatedBlockage: (typeof BLOCKAGE_LEVELS)[number];
  model: string;
}

const VISION_PROMPT = [
  'You are looking at a photograph taken by a field officer on a mountain highway in the North Eastern Region of India.',
  'Classify what the ROAD condition in the image shows. Reply with JSON only, no markdown fence, exactly these keys:',
  '{"incidentType": one of ' + INCIDENT_CLASSES.join('|') + ',',
  ' "confidence": number between 0 and 1,',
  ' "observedEvidence": one sentence describing only what is visible,',
  ' "recommendedSeverity": one of ' + SEVERITIES.join('|') + ',',
  ' "estimatedBlockage": one of ' + BLOCKAGE_LEVELS.join('|') + '}',
  'Describe only what the image shows. Do not guess a location, a road name, coordinates, or a risk score.',
  'If the road looks passable and undamaged, use NORMAL with estimatedBlockage NONE.',
].join('\n');

/**
 * Classify an incident photograph.
 *
 * Returns `null` on every failure — unconfigured, unreachable, unparseable, or an answer outside
 * the project's own enums. A null means the incident is filed exactly as the officer reported it,
 * which is the deterministic fallback: image intelligence is additive, and its absence must never
 * fail a report.
 */
export async function classifyIncidentImage(image: Buffer, mimeType: string): Promise<VisionEvidence | null> {
  if (!env.gemini.configured) return null;

  try {
    const { apiKey, visionModel, timeoutMs } = env.gemini;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${visionModel}:generateContent?key=${apiKey}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: VISION_PROMPT },
              { inline_data: { mime_type: mimeType, data: image.toString('base64') } },
            ],
          },
        ],
        generationConfig: { temperature: 0, maxOutputTokens: 300, responseMimeType: 'application/json' },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`Gemini Vision returned HTTP ${res.status}`);

    const body = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const raw = body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('').trim();
    if (!raw) throw new Error('Gemini Vision returned no text');

    const parsed = JSON.parse(raw.replace(/^```(?:json)?|```$/g, '').trim()) as Record<string, unknown>;

    // Validated against the project's own enums. A class this system does not have is not a
    // classification, it is noise, and it is dropped rather than coerced into the nearest match.
    const incidentType = String(parsed.incidentType ?? '').toUpperCase();
    const recommendedSeverity = String(parsed.recommendedSeverity ?? '').toUpperCase();
    const estimatedBlockage = String(parsed.estimatedBlockage ?? '').toUpperCase();
    const confidence = Number(parsed.confidence);
    if (
      !INCIDENT_CLASSES.includes(incidentType as never) ||
      !SEVERITIES.includes(recommendedSeverity as never) ||
      !BLOCKAGE_LEVELS.includes(estimatedBlockage as never) ||
      !Number.isFinite(confidence) ||
      confidence < 0 ||
      confidence > 1
    ) {
      throw new Error('Gemini Vision returned a classification outside the project domain');
    }

    return {
      incidentType: incidentType as VisionEvidence['incidentType'],
      confidence: Math.round(confidence * 100) / 100,
      observedEvidence: String(parsed.observedEvidence ?? '').slice(0, 300),
      recommendedSeverity: recommendedSeverity as VisionEvidence['recommendedSeverity'],
      estimatedBlockage: estimatedBlockage as VisionEvidence['estimatedBlockage'],
      model: visionModel,
    };
  } catch (err) {
    console.error(`[gemini] vision classification failed — ${err instanceof Error ? err.message : 'unknown'}`);
    return null;
  }
}
