/**
 * derive — the Form 3CD auto-fill engine.
 *
 * Design principle: a tax-audit report is a legal document, so the engine is
 * deliberately CONSERVATIVE. It only produces an *applyable* figure when that
 * figure is genuinely derivable from the trial balance + COA mapping
 * (e.g. clause 40 ratios, clause 44 total expenditure). For clauses that need
 * transaction- or challan-level data the engine returns a *reference* figure
 * (patch is empty → the panel shows it but disables "Apply") and the CA uses
 * the manual ledger-mapping tool instead. Nothing is ever written silently.
 */

import {
  type Form3cdContext,
  sumCodesCY,
  sumCodesPY,
  presentBySide,
  ledgersByKeyword,
} from "./context";
import {
  TURNOVER_CODES,
  OTHER_INCOME_CODES,
  COGS_CODES,
  EXPENSE_CODES,
  INVENTORY_CODES,
  DEPRECIATION_CODES,
} from "./fsCatalog";
import type { ClauseSuggestion } from "./apply";

const round2 = (n: number) => Math.round(n * 100) / 100;
const pct = (num: number, den: number) => (den ? round2((num / den) * 100) : 0);
const ratio = (num: number, den: number) => (den ? round2(num / den) : 0);

type CodeSet = { corporate: string[]; nce: string[] };
const pick = (ctx: Form3cdContext, cs: CodeSet) => (ctx.isNCE ? cs.nce : cs.corporate);

/** Positive CY ₹ figure for a credit/debit code-set. */
function posCY(ctx: Form3cdContext, cs: CodeSet, side: "credit" | "debit"): number {
  return presentBySide(sumCodesCY(ctx, pick(ctx, cs)), side);
}
function posPY(ctx: Form3cdContext, cs: CodeSet, side: "credit" | "debit"): number {
  return presentBySide(sumCodesPY(ctx, pick(ctx, cs)), side);
}

// ── Clause 40 — Turnover, gross profit, net profit & stock ratios ──────────
function derive40(ctx: Form3cdContext): ClauseSuggestion {
  const turnoverCY = posCY(ctx, TURNOVER_CODES, "credit");
  const turnoverPY = posPY(ctx, TURNOVER_CODES, "credit");
  const otherIncCY = posCY(ctx, OTHER_INCOME_CODES, "credit");
  const otherIncPY = posPY(ctx, OTHER_INCOME_CODES, "credit");
  const cogsCY = posCY(ctx, COGS_CODES, "debit");
  const cogsPY = posPY(ctx, COGS_CODES, "debit");
  const expCY = posCY(ctx, EXPENSE_CODES, "debit");
  const expPY = posPY(ctx, EXPENSE_CODES, "debit");
  const stockCY = posCY(ctx, INVENTORY_CODES, "debit");
  const stockPY = posPY(ctx, INVENTORY_CODES, "debit");

  const gpCY = round2(turnoverCY - cogsCY);
  const gpPY = round2(turnoverPY - cogsPY);
  const npCY = round2(turnoverCY + otherIncCY - expCY);
  const npPY = round2(turnoverPY + otherIncPY - expPY);

  const patch: Record<string, any> = {
    r1_prev: round2(turnoverCY), r1_prec: round2(turnoverPY),
    r2_prev: pct(gpCY, turnoverCY), r2_prec: pct(gpPY, turnoverPY),
    r3_prev: pct(npCY, turnoverCY), r3_prec: pct(npPY, turnoverPY),
    r4_prev: ratio(stockCY, turnoverCY), r4_prec: ratio(stockPY, turnoverPY),
  };

  return {
    clauseNo: "40",
    confidence: turnoverCY > 0 ? "high" : "low",
    summary: "Turnover, GP%, NP% & stock ratio from Financial Statements",
    fields: [
      { label: "Total turnover (CY)", value: round2(turnoverCY), provenance: `Revenue from operations — ${pick(ctx, TURNOVER_CODES).join(", ")}` },
      { label: "Gross profit / turnover %", value: pct(gpCY, turnoverCY), provenance: `GP = turnover − COGS (${pick(ctx, COGS_CODES).join(", ")})` },
      { label: "Net profit / turnover %", value: pct(npCY, turnoverCY), provenance: "NP = total revenue − total expenses" },
      { label: "Stock-in-trade / turnover", value: ratio(stockCY, turnoverCY), provenance: `Closing stock — ${pick(ctx, INVENTORY_CODES).join(", ")}` },
    ],
    patch,
    notes: "Row 5 (material consumed / finished goods produced) needs manufacturing quantities and is left for manual entry.",
  };
}

// ── Clause 44 — Total expenditure (GST break-up) ───────────────────────────
function derive44(ctx: Form3cdContext): ClauseSuggestion {
  const totalExp = posCY(ctx, EXPENSE_CODES, "debit");
  return {
    clauseNo: "44",
    confidence: totalExp > 0 ? "medium" : "low",
    summary: "Total expenditure from Financial Statements",
    fields: [
      { label: "Total expenditure during the year", value: round2(totalExp), provenance: `Sum of all P&L expense heads (${pick(ctx, EXPENSE_CODES).join(", ")})` },
    ],
    patch: { _rows: [{ total_expenditure: round2(totalExp), exempt_gst: "", composition_gst: "", other_registered: "", not_registered: "" }] },
    setAnnexure: true,
    notes: "Only the total is auto-derived. The GST-registration split (exempt / composition / registered / unregistered) needs vendor GST status and must be entered manually.",
  };
}

// ── Clause 21(e) — Provision for gratuity not allowable u/s 40A(7) ─────────
function derive21e(ctx: Form3cdContext): ClauseSuggestion | null {
  const gratuity = ledgersByKeyword(ctx, ["gratuity"]).filter((l) => l.section !== "PL" || /provision/i.test(l.name));
  if (gratuity.length === 0) return null;
  // Provisions sit on the credit side (stored negative) → present positive.
  const amount = round2(gratuity.reduce((s, l) => s + presentBySide(l.balance, "credit"), 0));
  if (amount <= 0) return null;
  return {
    clauseNo: "21",
    confidence: "medium",
    summary: "Provision for gratuity from ledger(s)",
    fields: [
      { label: "Provision for gratuity (u/s 40A(7))", value: amount, provenance: gratuity.map((l) => l.name).join(", ") },
    ],
    patch: { cl_21e: { _value: amount, _remarks: `Auto from ledger(s): ${gratuity.map((l) => l.name).join(", ")}. Verify allowability u/s 40A(7).` } },
    notes: "Provision is disallowable unless paid to an approved gratuity fund — verify before finalising.",
  };
}

// ── Clause 18 — Depreciation (reference figure only; no auto-apply) ────────
function derive18(ctx: Form3cdContext): ClauseSuggestion | null {
  let bookDep = posCY(ctx, DEPRECIATION_CODES, "debit");
  if (bookDep <= 0) {
    const depLedgers = ledgersByKeyword(ctx, ["depreciation", "amortis", "amortiz"]);
    bookDep = round2(depLedgers.reduce((s, l) => s + presentBySide(l.balance, "debit"), 0));
  }
  if (bookDep <= 0) return null;
  return {
    clauseNo: "18",
    confidence: "low",
    summary: "Depreciation as per books (reference)",
    fields: [
      { label: "Depreciation debited to P&L (books)", value: bookDep, provenance: "Book depreciation — reconcile against IT-Act block-wise depreciation" },
    ],
    // Empty patch → the panel shows this as a reference figure and disables Apply,
    // because clause 18 needs block-of-assets WDV/rates that the TB cannot supply.
    patch: {},
    notes: "Clause 18 requires block-wise WDV and IT-Act rates. Use this book figure only to reconcile your block computation.",
  };
}

export type DeriveFn = (ctx: Form3cdContext) => ClauseSuggestion | null;

/** Registry of clauses the engine can produce a suggestion for. */
export const DERIVATIONS: Record<string, DeriveFn> = {
  "18": derive18,
  "21": derive21e,
  "40": derive40,
  "44": derive44,
};

/** Clauses with an applyable (non-empty patch) derivation — used by "Auto-fill all". */
export function deriveClause(clauseNo: string, ctx: Form3cdContext): ClauseSuggestion | null {
  const fn = DERIVATIONS[clauseNo];
  if (!fn) return null;
  try {
    return fn(ctx);
  } catch {
    return null;
  }
}

/** Run every registered derivation. Returns only non-null suggestions. */
export function deriveAll(ctx: Form3cdContext): ClauseSuggestion[] {
  const out: ClauseSuggestion[] = [];
  for (const clauseNo of Object.keys(DERIVATIONS)) {
    const s = deriveClause(clauseNo, ctx);
    if (s) out.push(s);
  }
  return out;
}

/** Does this clause have an applyable suggestion (non-empty patch)? */
export function hasApplyableSuggestion(s: ClauseSuggestion | null): boolean {
  return !!s && !!s.patch && Object.keys(s.patch).length > 0;
}
