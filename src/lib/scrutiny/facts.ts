/**
 * Knowledge & Judgment facts model (Phase 3 — behind VITE_SCRUTINY_V2).
 *
 * The engine cannot derive certain audit facts from Tally data — whether related parties exist,
 * MSME status, whether assets were physically verified, whether management representations were
 * obtained, etc. This catalogue is the set of ~30 "human facts" the auditor records once per
 * engagement; the engine and the working paper reference them.
 *
 * Gate-4 (Ticket 3.4) is ADVISORY only (canonical decision #8): missing required facts are
 * surfaced to the auditor but NEVER block sign-off / UDIN.
 *
 * Pure + dependency-free → unit-testable without a DB.
 */

export type FactType = "boolean" | "text" | "select";

export type FactCategory =
  | "Related Parties"
  | "MSME & Vendors"
  | "Loans & Deposits"
  | "Verification"
  | "Statutory & Compliance"
  | "Representations & Disclosures";

export interface FactDef {
  key: string;
  label: string;
  category: FactCategory;
  type: FactType;
  options?: string[];
  /** required for Gate-4 (advisory completeness) */
  required?: boolean;
  help?: string;
}

/** The ~30 human facts, grouped by category. Order defines display order within a category. */
export const FACT_CATALOGUE: FactDef[] = [
  // Related Parties
  { key: "rp_exist", label: "Are there any related parties?", category: "Related Parties", type: "boolean", required: true, help: "Nominate the parties below so RP-transaction checks can run." },
  { key: "rp_transactions", label: "Any related-party transactions during the year?", category: "Related Parties", type: "boolean", required: true },
  { key: "rp_arms_length", label: "Are related-party transactions at arm's length?", category: "Related Parties", type: "boolean" },
  { key: "rp_40A2b", label: "Any payments to persons covered by s.40A(2)(b)?", category: "Related Parties", type: "boolean" },
  { key: "rp_guarantees", label: "Any guarantees given/taken for related parties?", category: "Related Parties", type: "boolean" },
  { key: "deemed_dividend", label: "Any deemed dividend u/s 2(22)(e)?", category: "Related Parties", type: "boolean" },

  // MSME & Vendors
  { key: "msme_client_registered", label: "Is the client itself MSME-registered?", category: "MSME & Vendors", type: "boolean", required: true },
  { key: "msme_udyam_no", label: "Udyam registration number (if any)", category: "MSME & Vendors", type: "text" },
  { key: "msme_vendors_identified", label: "Are MSME vendors identified in the ledgers?", category: "MSME & Vendors", type: "boolean", required: true, help: "Needed for s.43B(h) / MSMED 45-day payment checks." },
  { key: "msme_dues_beyond_45", label: "Any MSME dues outstanding beyond 45 days?", category: "MSME & Vendors", type: "boolean" },

  // Loans & Deposits
  { key: "loans_directors", label: "Any loans to/from directors or partners?", category: "Loans & Deposits", type: "boolean", required: true, help: "Drives 269SS / 269T / 186 checks." },
  { key: "unsecured_loans_confirmed", label: "Unsecured loans confirmed with lenders?", category: "Loans & Deposits", type: "boolean" },
  { key: "loans_269ss", label: "Any loan/deposit accepted in cash ≥ ₹20,000 (269SS)?", category: "Loans & Deposits", type: "boolean" },
  { key: "loans_269t", label: "Any loan/deposit repaid in cash ≥ ₹20,000 (269T)?", category: "Loans & Deposits", type: "boolean" },

  // Verification
  { key: "cash_verified", label: "Cash-in-hand physically verified?", category: "Verification", type: "boolean", required: true },
  { key: "inventory_verified", label: "Inventory physically verified / valued?", category: "Verification", type: "boolean", required: true },
  { key: "fixed_assets_verified", label: "Fixed assets physically verified?", category: "Verification", type: "boolean" },
  { key: "bank_brs", label: "Bank balances confirmed (BRS obtained)?", category: "Verification", type: "boolean", required: true },
  { key: "debtors_confirmed", label: "Material debtor/creditor balances confirmed?", category: "Verification", type: "boolean" },

  // Statutory & Compliance
  { key: "tds_returns_filed", label: "TDS returns filed for all quarters?", category: "Statutory & Compliance", type: "boolean", required: true },
  { key: "gst_reconciled", label: "GST returns reconciled with books (2B / 3B)?", category: "Statutory & Compliance", type: "boolean", required: true },
  { key: "statutory_dues_timely", label: "Statutory dues (PF/ESI/GST/TDS) paid before due date?", category: "Statutory & Compliance", type: "boolean" },
  { key: "cash_269st", label: "Any single cash receipt ≥ ₹2,00,000 (269ST) explained?", category: "Statutory & Compliance", type: "boolean" },
  { key: "fema_transactions", label: "Any foreign / FEMA transactions?", category: "Statutory & Compliance", type: "boolean" },
  { key: "udin_generated", label: "UDIN generated for this report?", category: "Statutory & Compliance", type: "boolean", help: "Advisory only — never blocks sign-off (decision #8)." },

  // Representations & Disclosures
  { key: "mgmt_rep_letter", label: "Management representation letter obtained?", category: "Representations & Disclosures", type: "boolean", required: true },
  { key: "contingent_liabilities", label: "Any contingent liabilities / capital commitments?", category: "Representations & Disclosures", type: "boolean" },
  { key: "litigation_pending", label: "Any litigation / tax demands pending?", category: "Representations & Disclosures", type: "boolean" },
  { key: "prior_period_items", label: "Any prior-period items?", category: "Representations & Disclosures", type: "boolean" },
  { key: "accounting_policy_change", label: "Any change in accounting policy vs PY?", category: "Representations & Disclosures", type: "boolean" },
  { key: "going_concern", label: "Any going-concern indicators?", category: "Representations & Disclosures", type: "boolean" },
];

/** fact_key -> captured value ("yes"/"no"/free text). */
export type CapturedFacts = Record<string, string>;

export function isCaptured(v: string | undefined | null): boolean {
  return typeof v === "string" && v.trim() !== "";
}

export interface FactGate {
  total: number;
  captured: number;
  requiredTotal: number;
  requiredCaptured: number;
  /** required facts not yet captured (Gate-4, advisory) */
  missing: FactDef[];
}

/** Gate-4 completeness — advisory only, never blocks anything. */
export function factGateStatus(catalogue: FactDef[], captured: CapturedFacts): FactGate {
  const required = catalogue.filter((f) => f.required);
  const missing = required.filter((f) => !isCaptured(captured[f.key]));
  return {
    total: catalogue.length,
    captured: catalogue.filter((f) => isCaptured(captured[f.key])).length,
    requiredTotal: required.length,
    requiredCaptured: required.length - missing.length,
    missing,
  };
}

export interface FactCategoryGroup {
  category: FactCategory;
  facts: FactDef[];
}

/** Group the catalogue by category, preserving first-seen category order. */
export function groupFactsByCategory(catalogue: FactDef[]): FactCategoryGroup[] {
  const order: FactCategory[] = [];
  const byCat = new Map<FactCategory, FactDef[]>();
  for (const f of catalogue) {
    if (!byCat.has(f.category)) { byCat.set(f.category, []); order.push(f.category); }
    byCat.get(f.category)!.push(f);
  }
  return order.map((category) => ({ category, facts: byCat.get(category)! }));
}
