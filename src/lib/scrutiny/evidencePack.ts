/**
 * Evidence pack / NFRA export (Phase 8, Ticket 8.1 — behind VITE_SCRUTINY_V2).
 *
 * Assembles one comprehensive, downloadable working-paper evidence document — coverage, findings,
 * judgment facts, the 3CD clause mapping, client queries and a conclusion — suitable for peer
 * review / NFRA. Deterministic, no AI. Pure + dependency-free → unit-testable without a DB.
 */

import type { Finding } from "./scrutinyUi";
import { riskByCategory } from "./commandCenter";

const sevU = (f: Finding) => (f.severity ?? "").toUpperCase();

export interface EvidencePackInputs {
  financialYear: string;
  findings: Finding[];
  coverageAuto: number;
  coverageTotal: number;
  requiredCaptured: number;
  requiredTotal: number;
  missingFacts: string[];
  relatedParties: string[];
  raisedCount: number;
  clauseGroups: { code: string; label: string; count: number }[];
}

export function evidencePackText(inp: EvidencePackInputs): string {
  const f = inp.findings;
  const high = f.filter((x) => sevU(x) === "HIGH").length;
  const medium = f.filter((x) => sevU(x) === "MEDIUM").length;
  const low = f.length - high - medium;
  const cats = riskByCategory(f);

  const L: string[] = [];
  L.push(`CAFLOW LEDGER SCRUTINY — EVIDENCE PACK (FY ${inp.financialYear})`);
  L.push("Advisory working-paper evidence for review / NFRA. Not a substitute for the auditor's judgment.");
  L.push("");
  L.push("1. COVERAGE");
  L.push(`   ${inp.coverageAuto} of ${inp.coverageTotal} checks auto-verified by the engine; ${Math.max(0, inp.coverageTotal - inp.coverageAuto)} advisory (manual review). Coverage is advisory and never blocks sign-off / UDIN.`);
  L.push("");
  L.push("2. FINDINGS");
  L.push(`   ${f.length} findings — ${high} high, ${medium} medium, ${low} low.`);
  for (const c of cats.slice(0, 10)) L.push(`   • ${c.category}: ${c.total} (${c.high}H / ${c.medium}M / ${c.low}L)`);
  L.push("");
  L.push("3. JUDGMENT FACTS");
  L.push(`   ${inp.requiredCaptured} of ${inp.requiredTotal} required judgment facts captured.`);
  if (inp.missingFacts.length) L.push(`   Outstanding: ${inp.missingFacts.slice(0, 15).join("; ")}.`);
  L.push(`   Related parties nominated: ${inp.relatedParties.length ? inp.relatedParties.join(", ") : "captured in the Facts & Judgment tab"}.`);
  L.push("");
  L.push("4. FORM 3CD MAPPING (read-only — does not write the live Form 3CD)");
  if (inp.clauseGroups.length === 0) L.push("   No findings mapped to the 3CD clause set.");
  else for (const g of inp.clauseGroups) L.push(`   • Clause ${g.code} — ${g.label}: ${g.count}`);
  L.push("");
  L.push("5. CLIENT QUERIES");
  L.push(`   ${inp.raisedCount} finding${inp.raisedCount !== 1 ? "s" : ""} raised as client queries (maker-checker; a second reviewer approves before sending).`);
  L.push("");
  L.push("6. CONCLUSION");
  L.push(
    f.length === 0
      ? "   No exceptions noted by the deterministic checks; advisory checks to be reviewed manually."
      : `   ${f.length} exceptions noted; ${high} high-risk require attention. Queries raised where applicable; advisory checks flagged for manual review.`,
  );
  L.push("");
  L.push("Advisory only — coverage never blocks sign-off / UDIN (decision #8); the 3CD mapping does not write the live Form 3CD (§8).");
  return L.join("\n");
}
