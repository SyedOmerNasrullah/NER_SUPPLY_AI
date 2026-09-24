/**
 * The incident photograph and what the vision model made of it.
 *
 * The chain the project reference asks for — image → classification → operational impact →
 * action — drawn as one connected block rather than four separate cards, because it is one
 * inference and reads as one.
 *
 * Honesty rules this component enforces:
 *   - the classification is labelled as coming from the vision model, separately from the
 *     reporter's own selection, and the two are shown side by side when they disagree
 *     (contract §3: the detected class NEVER overwrites `type`);
 *   - in demo mode the confidence is a seeded value, and the provenance marker says so —
 *     no Gemini call is made in this phase;
 *   - an incident with no photograph says so plainly instead of showing a placeholder that
 *     implies one was analysed.
 */

import { cn } from '@/lib/cn';
import { formatProbability, humanizeEnum } from '@/domain/format';
import { RISK_TONE, severityAsRiskLevel } from '@/domain/thresholds';
import type { Incident } from '@/domain/types';
import { Chip, Icon, ProgressBar, ProvenanceTag, SectionLabel } from '@/design/primitives';

const BLOCKAGE_COPY: Record<string, { label: string; impact: string; tone: 'critical' | 'warning' | 'ok' }> = {
  SEVERE: {
    label: 'Severe obstruction',
    impact: 'Carriageway impassable to heavy vehicles',
    tone: 'critical',
  },
  PARTIAL: {
    label: 'Partial obstruction',
    impact: 'Single lane passable with escort',
    tone: 'warning',
  },
  NONE: { label: 'No obstruction', impact: 'Carriageway clear', tone: 'ok' },
};

/** The response the operations rulebook calls for at each blockage level. */
const RESPONSE: Record<string, string[]> = {
  SEVERE: ['Restrict', 'Reroute', 'Dispatch inspection'],
  PARTIAL: ['Inspect', 'Escort', 'Advise reroute'],
  NONE: ['Log', 'Monitor'],
};

export function IncidentClassification({
  incident,
  className,
}: {
  incident: Incident;
  className?: string;
}) {
  const blockage = incident.cvEstimatedBlockage ?? 'NONE';
  const copy = BLOCKAGE_COPY[blockage] ?? BLOCKAGE_COPY.NONE;
  const tone = RISK_TONE[severityAsRiskLevel(incident.severity)];
  const classified = Boolean(incident.cvDetectedClass) && (incident.cvConfidence ?? 0) > 0;
  const disagrees =
    classified &&
    incident.cvDetectedClass?.replace(/\s+/g, '_').toUpperCase() !== incident.type;

  return (
    <div className={cn('flex min-w-0 flex-col gap-3', className)}>
      {/* --- The photograph ----------------------------------------------- */}
      {incident.imageUrl ? (
        <figure className="relative overflow-hidden rounded-panel border border-line">
          <img
            src={incident.imageUrl}
            alt={`Field photograph of the reported ${humanizeEnum(incident.type).toLowerCase()}`}
            className="h-[168px] w-full object-cover"
          />
          <figcaption className="absolute inset-x-0 bottom-0 flex items-center gap-2 bg-gradient-to-t from-ink/85 to-transparent px-3 pb-2 pt-6">
            <Icon name="incidents" size="sm" className="text-white/80" />
            <span className="text-[10.5px] text-white/85">
              Field photograph submitted with the report
            </span>
          </figcaption>
        </figure>
      ) : (
        <div className="flex items-center gap-3 rounded-panel border border-dashed border-line bg-panel-alt px-3.5 py-3">
          <Icon name="upload" size="lg" className="text-ink-3" />
          <p className="text-meta leading-snug text-ink-2">
            No photograph was attached to this report, so no visual classification was run. The
            severity below is the reporter&rsquo;s own assessment.
          </p>
        </div>
      )}

      {/* --- The inference ------------------------------------------------- */}
      <SectionLabel
        rule
        actions={<ProvenanceTag kind={classified ? 'LLM_EXPLANATION' : 'SYNTHETIC_OPERATIONAL'} />}
      >
        Classification
      </SectionLabel>

      {classified ? (
        <div className="flex flex-col gap-2.5">
          <div className="flex items-center gap-3">
            <span
              className={cn(
                'flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] ring-1',
                tone.wash,
                tone.text,
                'ring-current/15',
              )}
            >
              <Icon name="incidents" size="lg" />
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-[17px] font-semibold capitalize leading-none text-ink">
                {incident.cvDetectedClass}
              </span>
              <span className="text-meta text-ink-3">Detected hazard class</span>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              <span className="tnum text-[17px] font-semibold text-ink">
                {formatProbability(incident.cvConfidence ?? 0)}
              </span>
              <span className="text-[10px] uppercase tracking-[0.05em] text-ink-3">
                Confidence
              </span>
            </div>
          </div>

          <ProgressBar
            value={(incident.cvConfidence ?? 0) * 100}
            level={severityAsRiskLevel(incident.severity)}
            size="md"
          />

          {disagrees ? (
            <p className="rounded-[5px] bg-panel-alt px-2.5 py-1.5 text-[10.5px] leading-snug text-ink-2">
              The model&rsquo;s class differs from the reporter&rsquo;s selection
              (<span className="font-semibold">{humanizeEnum(incident.type)}</span>). Both are
              kept — a vision result never overwrites what the officer on the ground recorded.
            </p>
          ) : null}
        </div>
      ) : (
        <p className="rounded-panel border border-line bg-panel-alt px-3 py-2.5 text-meta leading-relaxed text-ink-2">
          No classification is available for this report. When the vision service does not return
          a result the incident is still filed and still carries its reported severity — an
          unavailable classifier does not silently downgrade a hazard.
        </p>
      )}

      {/* --- What it means operationally ----------------------------------- */}
      <SectionLabel rule>Operational impact</SectionLabel>
      <div
        className={cn(
          'flex items-center gap-3 rounded-panel border px-3.5 py-2.5',
          copy.tone === 'critical'
            ? 'border-risk-critical/25 bg-risk-wash-critical'
            : copy.tone === 'warning'
              ? 'border-risk-medium/30 bg-risk-wash-medium'
              : 'border-risk-low/25 bg-risk-wash-low',
        )}
      >
        <Icon
          name={copy.tone === 'ok' ? 'ok' : 'blockage'}
          size="lg"
          className={
            copy.tone === 'critical'
              ? 'text-risk-critical'
              : copy.tone === 'warning'
                ? 'text-risk-medium'
                : 'text-risk-low'
          }
        />
        <div className="flex min-w-0 flex-col">
          <span className="text-body font-semibold text-ink">{copy.label}</span>
          <span className="text-meta text-ink-2">{copy.impact}</span>
        </div>
      </div>

      {/* --- Recommended response ------------------------------------------ */}
      <SectionLabel rule>Recommended response</SectionLabel>
      <div className="flex flex-wrap items-center gap-1.5">
        {(RESPONSE[blockage] ?? RESPONSE.NONE).map((action) => (
          <Chip key={action} tone="outline" icon="check">
            {action}
          </Chip>
        ))}
      </div>
      <p className="text-[10px] leading-relaxed text-ink-3">
        The response set is a fixed rule over the estimated blockage level, not a generated
        suggestion.
      </p>
    </div>
  );
}
