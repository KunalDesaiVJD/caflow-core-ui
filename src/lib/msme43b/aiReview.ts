// MSME 43B(h) — the AI second opinion on a calibration.
//
// Sends the DETERMINISTIC comparison (what differs, and which permitted legal
// positions the search found) to Claude and asks a professional question:
// is this a defensible reading, and what explains what's left?
//
// The model sees a summary, not the ledgers, and returns opinions, not figures.
// Nothing it says changes a number: accepting a rule is a human click, and the
// figures then move only because the engine is re-run under that rule.

import { supabase } from '@/integrations/supabase/client';
import type { CalibrationResult } from './calibrate';
import { describeFunctionError } from './invokeError';

export interface AiRuleVerdict {
  rule: string;
  defensible: boolean;
  comment: string;
}

export interface AiUnexplainedCause {
  vendor: string;
  likelyCause: string;
  whatToCheck: string;
}

export interface AiReview {
  verdicts: AiRuleVerdict[];
  unexplainedCauses: AiUnexplainedCause[];
  overall: string;
  truncated?: boolean;
}

/** Compact, figure-light summary of the calibration for the reviewer model. */
function summarise(result: CalibrationResult, ctx: { cyLabel: string; fyLabel: string }) {
  return {
    period: ctx,
    agreementBefore: { vendorsAgreeing: result.before.matched, vendorsDiffering: result.before.differing },
    agreementAfter: { vendorsAgreeing: result.after.matched, vendorsDiffering: result.after.differing },
    matchToleranceRupees: result.matchTolerance,
    candidateRuleChanges: result.proposals.map((p) =>
      p.kind === 'rule'
        ? {
            type: 'rule',
            rule: p.title,
            question: p.question,
            from: p.fromLabel,
            to: p.toLabel,
            statedBasis: p.basis,
            vendorsFixed: p.fixes.length,
            vendorsBroken: p.breaks.length,
          }
        : {
            type: 'vendor-window-declaration',
            rule: `s.15 window for ${p.vendorName}`,
            question: 'Is there a written agreement with this vendor?',
            from: `${p.currentWindowDays} days`,
            to: `${p.windowDays} days`,
            statedBasis: p.basis,
            vendorsFixed: 1,
            vendorsBroken: 0,
          },
    ),
    rulesDiscardedForChangingSignedOffRuns: result.rejectedForRegression,
    stillUnexplained: result.unexplained.slice(0, 40).map((v) => ({
      vendor: v.vendorName,
      status: v.status,
      toolFigure: v.ours?.disallowed ?? null,
      reviewerFigure: v.theirs?.disallowed ?? null,
      difference: v.delta,
      reviewerNote: v.note ?? null,
    })),
  };
}

export async function reviewDifference(
  result: CalibrationResult,
  ctx: { cyLabel: string; fyLabel: string },
): Promise<AiReview> {
  const { data, error } = await supabase.functions.invoke('msme-calibrate', {
    body: { mode: 'review-difference', summary: summarise(result, ctx) },
  });
  if (error) {
    const described = await describeFunctionError(error, 'msme-calibrate', 'The AI review');
    throw new Error(described.message);
  }
  if (data?.error) throw new Error(data.error);

  return {
    verdicts: Array.isArray(data?.verdicts) ? data.verdicts : [],
    unexplainedCauses: Array.isArray(data?.unexplainedCauses) ? data.unexplainedCauses : [],
    overall: typeof data?.overall === 'string' ? data.overall : '',
    truncated: !!data?.truncated,
  };
}
