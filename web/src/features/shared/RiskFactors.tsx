/**
 * The SHAP breakdown, and the sentence that narrates it.
 *
 * This is the most important graphic on the page: it is what makes the risk score defensible
 * rather than a number a model asserted. Two things it is strict about:
 *
 *   1. **Nothing here computes a contribution.** The factors arrive on `RouteCandidate.topFactors`
 *      and are rendered as received. `FactorBreakdown` derives only the shared display scale.
 *
 *   2. **The two provenances are separated on screen.** The bars are `ML PREDICTION` — XGBoost
 *      plus SHAP. The sentence is `LLM EXPLANATION` — a language model narrating that output.
 *      The model decides; the language model explains. Showing them as one block is exactly the
 *      claim this project must not make.
 */

import { cn } from '@/lib/cn';
import type { RiskFactor, RiskLevel } from '@/domain/types';
import { FactorBreakdown, Icon, ProvenanceTag, SectionLabel } from '@/design/primitives';

export function RiskFactors({
  factors,
  level,
  explanation,
  explanationSource = 'SYNTHETIC_OPERATIONAL',
  explanationNote,
  routeName,
  heading = 'Risk Factors (SHAP)',
  className,
}: {
  factors: RiskFactor[];
  level: RiskLevel;
  explanation: string;
  /**
   * Who wrote the sentence. The factors above it are always the model's; the words are not, and
   * the tag has to say which. Defaults to the seeded narration the fixtures carry — labelling
   * that as an AI explanation would be a provenance claim the build cannot support.
   */
  explanationSource?: 'LLM_EXPLANATION' | 'DETERMINISTIC_TEMPLATE' | 'SYNTHETIC_OPERATIONAL';
  /** Why the template was used, when it was. Shown quietly beside the tag. */
  explanationNote?: string;
  routeName: string;
  /** Section heading. Route Intelligence asks the question outright. */
  heading?: string;
  className?: string;
}) {
  if (factors.length === 0) return null;

  return (
    <section className={cn('flex shrink-0 flex-col gap-2.5', className)}>
      <SectionLabel rule actions={<ProvenanceTag kind="ML_PREDICTION" />}>
        {heading}
      </SectionLabel>

      <FactorBreakdown factors={factors} level={level} />

      <div className="mt-1 rounded-panel border border-brand-500/15 bg-brand-50/70 px-3 py-2.5">
        <div className="mb-1 flex items-center gap-1.5">
          <Icon name="explanation" size="sm" className="text-brand-700" />
          <span className="text-[11px] font-bold uppercase tracking-[0.05em] text-brand-900">
            Why this route is risky
          </span>
        </div>
        <p className="text-meta leading-relaxed text-ink-2">
          <span className="text-ink-3">“</span>
          {explanation}
          <span className="text-ink-3">”</span>
        </p>
        <div className="mt-1.5 flex items-center justify-between gap-2">
          <span className="truncate text-[10px] text-ink-3">{explanationNote ?? routeName}</span>
          {explanationSource === 'LLM_EXPLANATION' ? (
            <ProvenanceTag kind="LLM_EXPLANATION" />
          ) : (
            <span className="shrink-0 rounded-chip border border-line px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-[0.05em] text-ink-3">
              {explanationSource === 'DETERMINISTIC_TEMPLATE' ? 'Template' : 'Seeded text'}
            </span>
          )}
        </div>
      </div>
    </section>
  );
}
