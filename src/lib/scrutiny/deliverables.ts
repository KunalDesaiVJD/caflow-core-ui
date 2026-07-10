/**
 * Auto-drafted deliverables (Phase 6, Ticket 6.3 — behind VITE_SCRUTINY_V2).
 *
 * Deterministic text generators for a working-paper summary and a client query letter, from the
 * scrutiny state already loaded on the page. No AI, no network — pure, downloadable text.
 * Pure + dependency-free → unit-testable without a DB.
 */

import type { Finding } from "./scrutinyUi";
import { riskByCategory } from "./commandCenter";

const sevU = (f: Finding) => (f.severity ?? "").toUpperCase();

export interface WorkpaperInputs {
  financialYear: string;
  totalRules: number;
  autoChecked: number;
  findings: Finding[];
  requiredCaptured: number;
  requiredTotal: number;
  missingFacts: string[];
  raisedCount: number;
}

/** A plain-text working-paper summary of the scrutiny. */
export function workpaperText(inp: WorkpaperInputs): string {
  const f = inp.findings;
  const high = f.filter((x) => sevU(x) === "HIGH").length;
  const medium = f.filter((x) => sevU(x) === "MEDIUM").length;
  const low = f.length - high - medium;
  const cats = riskByCategory(f);

  const L: string[] = [];
  L.push(`LEDGER SCRUTINY — WORKING PAPER (FY ${inp.financialYear})`);
  L.push("");
  L.push("1. Scope & coverage");
  L.push(`   ${inp.autoChecked} of ${inp.totalRules} checks auto-verified by the engine; the remainder are advisory (manual review). Coverage is advisory and does not affect sign-off / UDIN.`);
  L.push("");
  L.push("2. Findings summary");
  L.push(`   ${f.length} findings — ${high} high, ${medium} medium, ${low} low.`);
  for (const c of cats.slice(0, 8)) L.push(`   • ${c.category}: ${c.total} (${c.high}H / ${c.medium}M / ${c.low}L)`);
  L.push("");
  L.push("3. Client queries");
  L.push(`   ${inp.raisedCount} finding${inp.raisedCount !== 1 ? "s" : ""} raised as client queries (maker-checker; a second reviewer approves before sending).`);
  L.push("");
  L.push("4. Judgment facts");
  L.push(`   ${inp.requiredCaptured} of ${inp.requiredTotal} required judgment facts captured.`);
  if (inp.missingFacts.length) L.push(`   Outstanding: ${inp.missingFacts.slice(0, 10).join("; ")}.`);
  L.push("");
  L.push("5. Conclusion");
  L.push(
    f.length === 0
      ? "   No exceptions noted by the deterministic checks; advisory checks to be reviewed manually."
      : `   ${f.length} exceptions noted; ${high} high-risk require attention. Queries raised where applicable; advisory checks flagged for manual review.`,
  );
  L.push("   Coverage is advisory and never blocks sign-off / UDIN (canonical decision #8).");
  return L.join("\n");
}

export interface QueryLetterItem {
  label: string;
  text: string;
}

/** A formal client query letter compiling the raised queries. */
export function queryLetterText(items: QueryLetterItem[], financialYear: string): string {
  const L: string[] = [];
  L.push(`Subject: Audit queries — FY ${financialYear}`);
  L.push("");
  L.push("Dear Sir/Madam,");
  L.push("");
  L.push("In the course of our scrutiny of the books of account, we request your explanation and supporting documents in respect of the following:");
  L.push("");
  if (items.length === 0) {
    L.push("(No queries have been raised yet.)");
  } else {
    items.forEach((it, i) => L.push(`${i + 1}. ${it.text}${it.label ? `  [${it.label}]` : ""}`));
  }
  L.push("");
  L.push("Kindly provide the above at the earliest to enable us to complete the audit.");
  L.push("");
  L.push("Yours faithfully,");
  L.push("For the Auditors");
  return L.join("\n");
}
