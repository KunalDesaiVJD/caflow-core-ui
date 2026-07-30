// MSME 43B(h) — the Claude ↔ GPT review panel.
//
// Builds the evidence pack (deterministically, from the computed report) and
// runs the four-turn debate in the msme-panel-review edge function:
//
//   Claude opinion → GPT challenge → Claude response → GPT final verdict
//
// Two models from different families arguing catches reasoning errors that
// either alone would state confidently. Where they still disagree, the UI shows
// the disagreement — an unresolved point is the thing worth a partner's time,
// and averaging it into a consensus would destroy the only useful signal.
//
// The panel reviews REASONING. It never produces a figure, and its output
// cannot change one: adopting an interpretation remains a deterministic rule
// change that a human clicks. See the edge function header for why.

import { supabase } from '@/integrations/supabase/client';
import type { Msme43bReport } from './types';
import type { Msme43bConfig } from './config';
import { disclosedAssumptions, type RuleProfile } from './rules';
import type { CalibrationResult } from './calibrate';
import { describeFunctionError } from './invokeError';

export interface PanelPosition { topic: string; assessment: 'sound' | 'arguable' | 'wrong'; reasoning: string }
export interface PanelChallenge { topic: string; agree: boolean; objection: string; authority: string }
export interface PanelResponse { topic: string; outcome: 'conceded' | 'maintained' | 'partly'; reasoning: string }
export interface PanelUnresolved { topic: string; claudeView: string; gptView: string; whoDecides: string }

export interface PanelReview {
  claudeOpinion: { positions: PanelPosition[]; risks: string[]; overall: string };
  gptCritique: { challenges: PanelChallenge[]; missed: string[]; overall: string };
  claudeResponse: { responses: PanelResponse[]; revisedPositions: string[]; overall: string };
  gptFinal: {
    consensus: boolean;
    agreed: string[];
    unresolved: PanelUnresolved[];
    recommendedActions: string[];
    overall: string;
  };
  models: { claude: string; gpt: string };
}

export interface PanelEvidenceInput {
  report: Msme43bReport;
  config: Msme43bConfig;
  profile?: RuleProfile | null;
  /** included when the panel is run after comparing against a reviewer's working */
  calibration?: CalibrationResult | null;
}

/**
 * The evidence pack. Figures are included as CONTEXT for judging the reasoning —
 * the panel is told not to recompute them, and nothing it returns is used as a
 * number. Vendor-level detail is capped so the pack stays within one request.
 */
export function buildEvidence(input: PanelEvidenceInput) {
  const { report, config, profile, calibration } = input;

  const flagged = report.vendors.filter((v) => v.verified === false);
  const unreconciled = report.vendors.filter((v) => !v.cyReconciled);

  return {
    period: { currentYear: report.cyLabel, followingYear: report.fyLabel },
    interpretationApplied: disclosedAssumptions(config).map((a) => ({
      question: a.question,
      positionTaken: a.position,
      statedBasis: a.basis,
      source: a.isDefault ? 'standard position' : 'learned from a working paper this firm confirmed',
    })),
    perVendorDeclarations: (profile?.vendorWindows ?? []).map((d) => ({
      vendor: d.vendorName,
      window: `${d.windowDays} days`,
      basis: d.basis === 'agreement' ? 'written agreement declared on file' : 'no written agreement declared',
    })),
    computedResult: {
      vendorsAnalysed: report.vendors.length,
      totalDisallowedCurrentYear: report.totalDisallowedCY,
      totalAllowedOnPaymentFollowingYear: report.totalAllowedFY,
      totalStillOutstandingAtFollowingYearEnd: report.totalStillOutstanding,
      reportedUnder: 'Form 3CD Clause 26 (sums covered u/s 43B)',
    },
    assuranceAlreadyPerformed: {
      allLedgersReconciledToPrintedClosingBalance: unreconciled.length === 0,
      ledgersNotReconciled: unreconciled.map((v) => v.vendorName),
      independentCrossCheckAgreed: report.vendors.length - flagged.length,
      independentCrossCheckFlagged: flagged.map((v) => ({
        vendor: v.vendorName,
        notes: v.verifyNotes ?? [],
      })),
    },
    ...(calibration
      ? {
          comparisonWithReviewersWorking: {
            vendorsAgreeingBefore: calibration.before.matched,
            vendorsAgreeingAfter: calibration.after.matched,
            vendorsCompared: calibration.after.vendors.length,
            candidateRuleChanges: calibration.proposals.map((p) =>
              p.kind === 'rule'
                ? { rule: p.title, from: p.fromLabel, to: p.toLabel, statedBasis: p.basis, vendorsFixed: p.fixes.length, vendorsBroken: p.breaks.length }
                : { rule: `s.15 window for ${p.vendorName}`, from: `${p.currentWindowDays} days`, to: `${p.windowDays} days`, statedBasis: p.basis, vendorsFixed: 1, vendorsBroken: 0 },
            ),
            differencesNoRuleCouldExplain: calibration.unexplained.slice(0, 25).map((v) => ({
              vendor: v.vendorName,
              toolFigure: v.ours?.disallowed ?? null,
              reviewerFigure: v.theirs?.disallowed ?? null,
              status: v.status,
            })),
          },
        }
      : {}),
    methodNotes: [
      'Settlements are matched to bills by the allocation rule stated above; the source exports carry no bill-wise references.',
      'TDS, credit/debit notes, kasar/vatav and round-off are classified by narration keywords and treated per the rules above.',
      'Only bills accrued in the current year attract a current-year disallowance; the opening payable is treated per the rule above.',
      'The firm uploads only registered micro and small enterprise vendors — the tool does not determine MSME status.',
      'Section 23 MSMED Act interest (Form 3CD Clause 22) is out of scope and is not computed.',
    ],
  };
}

export async function runPanelReview(input: PanelEvidenceInput): Promise<PanelReview> {
  const { data, error } = await supabase.functions.invoke('msme-panel-review', {
    body: { evidence: buildEvidence(input) },
  });
  if (error) {
    // Not error.message: that is the opaque "non-2xx status code" for every
    // failure. The reason is in the response body — read it out.
    const described = await describeFunctionError(error, 'msme-panel-review', 'The review panel');
    throw new Error(described.message);
  }
  if (data?.error) throw new Error(data.error);

  // Defensive shaping — a model that returns a partial object should degrade to
  // an empty section, not crash the page.
  return {
    claudeOpinion: {
      positions: data?.claudeOpinion?.positions ?? [],
      risks: data?.claudeOpinion?.risks ?? [],
      overall: data?.claudeOpinion?.overall ?? '',
    },
    gptCritique: {
      challenges: data?.gptCritique?.challenges ?? [],
      missed: data?.gptCritique?.missed ?? [],
      overall: data?.gptCritique?.overall ?? '',
    },
    claudeResponse: {
      responses: data?.claudeResponse?.responses ?? [],
      revisedPositions: data?.claudeResponse?.revisedPositions ?? [],
      overall: data?.claudeResponse?.overall ?? '',
    },
    gptFinal: {
      consensus: !!data?.gptFinal?.consensus,
      agreed: data?.gptFinal?.agreed ?? [],
      unresolved: data?.gptFinal?.unresolved ?? [],
      recommendedActions: data?.gptFinal?.recommendedActions ?? [],
      overall: data?.gptFinal?.overall ?? '',
    },
    models: data?.models ?? { claude: 'claude', gpt: 'gpt' },
  };
}
