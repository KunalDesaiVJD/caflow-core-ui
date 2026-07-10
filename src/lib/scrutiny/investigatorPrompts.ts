/**
 * Suggested-investigation quick prompts (Phase 4, Ticket 4.2 — behind VITE_SCRUTINY_V2).
 *
 * Context-aware starter questions for the NL investigator (Ticket 4.1): a prompt only appears
 * when the current scrutiny state makes it relevant, so the auditor gets a useful one-click
 * question instead of a blank command bar. Reuses the 4.1 investigator — no gateway change.
 *
 * Pure + dependency-free → unit-testable without a DB.
 */

export interface PromptContext {
  findingCount: number;
  hasTds: boolean;
  missingFactsCount: number;
  recurringCount: number;
}

export interface SuggestedPrompt {
  label: string;
  question: string;
}

/** Return the relevant quick prompts for the current context (a "partner summary" always shows). */
export function suggestedPrompts(ctx: PromptContext): SuggestedPrompt[] {
  const out: SuggestedPrompt[] = [];

  if (ctx.findingCount > 0) {
    out.push({ label: "Top risks", question: "Summarise the highest-risk findings and what to tackle first." });
    out.push({ label: "Ledgers to query", question: "Which ledgers carry the most findings and should be queried to the client first?" });
  }
  if (ctx.hasTds) {
    out.push({ label: "TDS exposure", question: "What is the TDS exposure this year and which sections likely apply?" });
  }
  if (ctx.missingFactsCount > 0) {
    out.push({ label: "Missing facts", question: "Which required judgment facts are missing, and why do they matter for this audit?" });
  }
  if (ctx.recurringCount > 0) {
    out.push({ label: "Recurring items", question: "Which findings recur from a prior-year waiver and could be dismissed quickly?" });
  }
  out.push({ label: "Partner summary", question: "Draft a short partner summary of this engagement's scrutiny status." });

  return out;
}
