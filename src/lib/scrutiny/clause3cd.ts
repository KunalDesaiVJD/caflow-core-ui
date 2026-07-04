/**
 * 3CD clause-fill (Phase 6, Ticket 6.2 — behind VITE_SCRUTINY_V2).
 *
 * Maps scrutiny findings to the Form 3CD clause set from handoff §8 (21(a)/(b)/(d), 22,
 * 31(a)/(b)/(ba), 34) and produces a READ-ONLY export. Per §8 this must NOT write into the live
 * Form 3CD module — it is advisory only.
 *
 * A finding's clause is taken from its linked clause_3cd (if in the set), else inferred from the
 * rule/legal-reference/finding keywords. Pure + dependency-free → unit-testable without a DB.
 */

import type { Finding } from "./scrutinyUi";

export interface ClauseDef {
  code: string;
  label: string;
}

/** The §8 clause set, in display order. */
export const CLAUSE_3CD_SET: ClauseDef[] = [
  { code: "21(a)", label: "Capital / personal / inadmissible expenditure debited to P&L" },
  { code: "21(b)", label: "Amounts inadmissible u/s 40(a) — TDS default" },
  { code: "21(d)", label: "Cash payments inadmissible u/s 40A(3)/(3A)" },
  { code: "22", label: "Interest inadmissible u/s 23 of the MSMED Act" },
  { code: "31(a)", label: "Loans / deposits accepted (s.269SS)" },
  { code: "31(b)", label: "Loans / deposits repaid (s.269T)" },
  { code: "31(ba)", label: "Receipts (s.269ST)" },
  { code: "34", label: "TDS / TCS compliance" },
];

const CODES = new Set(CLAUSE_3CD_SET.map((c) => c.code));

export interface ClauseContext {
  clause_3cd?: string | null;
  rule_id?: string | null;
  ruleName?: string | null;
  legalReference?: string | null;
  flagMessage?: string | null;
}

/** Determine the 3CD clause for a finding: explicit link first, else keyword inference. */
export function inferClause(ctx: ClauseContext): string | null {
  const explicit = (ctx.clause_3cd ?? "").trim();
  if (explicit && CODES.has(explicit)) return explicit;

  const text = `${ctx.rule_id ?? ""} ${ctx.ruleName ?? ""} ${ctx.legalReference ?? ""} ${ctx.flagMessage ?? ""}`.toLowerCase();
  const has = (...kw: string[]) => kw.some((k) => text.includes(k));

  if (has("269st")) return "31(ba)";
  if (has("269t")) return "31(b)";
  if (has("269ss")) return "31(a)";
  if (has("40a(3)", "40a (3)", "cash payment")) return "21(d)";
  if (has("40(a)", "tds not deducted", "tds disallow", "disallowance of tds", "non-deduction")) return "21(b)";
  if (has("msme", "43b(h)", "msmed")) return "22";
  if (has("tds", "tcs", "194", "195")) return "34";
  if (has("capital expenditure", "personal expense", "capital in expense", "capitalis")) return "21(a)";
  return null;
}

export interface ClauseGroup {
  code: string;
  label: string;
  findings: Finding[];
  count: number;
}

export interface ClauseFillResult {
  groups: ClauseGroup[];
  mapped: number;
  unmapped: number;
}

/** Group findings by inferred 3CD clause. `contextFor` builds the inference context per finding. */
export function clauseFill(findings: Finding[], contextFor: (f: Finding) => ClauseContext): ClauseFillResult {
  const byCode = new Map<string, Finding[]>();
  let mapped = 0;
  for (const f of findings) {
    const code = inferClause(contextFor(f));
    if (!code) continue;
    mapped++;
    const arr = byCode.get(code);
    if (arr) arr.push(f);
    else byCode.set(code, [f]);
  }
  const groups: ClauseGroup[] = CLAUSE_3CD_SET.filter((c) => byCode.has(c.code)).map((c) => ({
    code: c.code,
    label: c.label,
    findings: byCode.get(c.code)!,
    count: byCode.get(c.code)!.length,
  }));
  return { groups, mapped, unmapped: findings.length - mapped };
}

/** Plain-text export of the clause mapping (read-only; does not touch the live Form 3CD). */
export function clause3cdExportText(result: ClauseFillResult): string {
  const lines: string[] = ["FORM 3CD — SCRUTINY FINDINGS MAPPING (read-only, advisory)", ""];
  for (const g of result.groups) {
    lines.push(`Clause ${g.code} — ${g.label}  (${g.count})`);
    for (const f of g.findings) lines.push(`   • ${f.flag_message ?? f.rule_id ?? ""}`);
    lines.push("");
  }
  lines.push(`Mapped ${result.mapped} of ${result.mapped + result.unmapped} findings.`);
  lines.push("Advisory only — this does NOT write into the live Form 3CD module.");
  return lines.join("\n");
}
