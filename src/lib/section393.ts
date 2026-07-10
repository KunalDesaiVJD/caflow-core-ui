/**
 * Section 393 (Income-tax Act, 2025) — TDS consolidation reference layer.
 * =====================================================================
 *
 * The Income-tax Act, 2025 (effective 1 April 2026, i.e. from Tax Year
 * 2026-27) replaces the scattered 1961-Act TDS/TCS sections with three
 * consolidated provisions:
 *
 *   • Section 392 — TDS on salary            (old §192)
 *   • Section 393 — TDS on all other payments (old §193, 194, 194A … 194T,
 *                   195, 196A-D), organised by payee category:
 *                     393(1) → residents
 *                     393(2) → non-residents
 *                     393(3) → "any person" / universal (winnings, cash
 *                              withdrawal, partner remuneration, etc.)
 *   • Section 394 — TCS                       (old §206C)
 *
 * The old 1961-Act section numbers are retained ONLY as reference labels;
 * rates and thresholds are UNCHANGED by the recodification (confirmed by the
 * official incometax.gov.in TDS-compliance FAQ).
 *
 * ── Provenance & confidence ──────────────────────────────────────────
 * Two layers of data live here, deliberately kept apart:
 *
 *   1. category / newSection (393(1)/(2)/(3), 392, 394)  → RELIABLE.
 *      The payee-category split is corroborated by the official IT-Dept
 *      FAQ + indiankanoon statutory text + multiple publishers.
 *
 *   2. paymentCode + tableRef (e.g. "1031", "Sl. No. 8(ii)")  → INDICATIVE.
 *      The 4-digit "payment codes" are NOT in the gazetted Act — they are
 *      filing-utility / vendor artefacts. A 107-agent deep-research pass
 *      (Jul 2026) could corroborate only a handful across independent
 *      vendors, and REFUTED several (notably 1023 → §194C, the code shown
 *      in the Genius screenshot). So codes/refs are attached ONLY where
 *      medium-confidence cross-vendor agreement existed, always marked
 *      `codeStatus: "indicative"`, and the UI shows SECTION_393_DISCLAIMER.
 *      Everything else is `codeStatus: "unmapped"` (paymentCode/tableRef
 *      null) rather than guessed.
 *
 * NOTE (pre-existing data caveat): the app's tds_rate_master rows label
 * 194J(a) as "Professional Services" @10% and 194J(b) as "Technical
 * Services" @2% — the reverse of the official utility (194J(a)=technical
 * @2%, 194J(b)=professional @10%). Because of that inconsistency we do NOT
 * attach the vendor 1026/1027 codes to §194J here; they are left unmapped
 * pending correction of the underlying rate rows.
 */

export type Section393Category =
  | "salary"
  | "resident"
  | "non-resident"
  | "any-person"
  | "tcs";

export type Section393CodeStatus = "indicative" | "unmapped";

export interface Section393Info {
  /** New-Act section reference, e.g. "393(1)", "392", "394". */
  newSection: string;
  /** Payee-category bucket. */
  category: Section393Category;
  /** Human label for the category, e.g. "Residents". */
  categoryLabel: string;
  /** Table Sl. No. reference within the section — INDICATIVE, may be null. */
  tableRef: string | null;
  /** Filing-utility 4-digit payment code — INDICATIVE, may be null. */
  paymentCode: string | null;
  /** Provenance of paymentCode/tableRef. "unmapped" ⇒ both null. */
  codeStatus: Section393CodeStatus;
}

/** IT Act 2025 (incl. the §393 TDS consolidation) takes effect from Tax Year 2026-27. */
export const IT_ACT_2025_EFFECTIVE_FY = "2026-27";

/**
 * Whether a given Tax Year (financial_year, e.g. "2026-27") falls under the
 * Income-tax Act, 2025 regime. Relies on the zero-padded 4-digit-prefix
 * format sorting lexicographically the same as chronologically.
 */
export function isItAct2025Regime(financialYear: string | null | undefined): boolean {
  if (!financialYear) return false;
  return financialYear >= IT_ACT_2025_EFFECTIVE_FY;
}

export const SECTION_393_DISCLAIMER =
  "Under the Income-tax Act, 2025 (effective 1 Apr 2026) TDS/TCS provisions are consolidated into Sections 392 (salary), 393 (other payments) and 394 (TCS); the old section numbers are kept only for reference and the rates/thresholds are unchanged. Payment codes and table Sl. No. references shown here are INDICATIVE — compiled from filing-utility/vendor sources, not an official CBDT list — and must be verified against your TDS return utility before filing.";

const CATEGORY_LABEL: Record<Section393Category, string> = {
  salary: "Salary",
  resident: "Residents",
  "non-resident": "Non-residents",
  "any-person": "Any person",
  tcs: "TCS",
};

interface RawEntry {
  /** Exact tds_rate_master.section_code values this entry applies to. */
  codes: string[];
  newSection: string;
  category: Section393Category;
  tableRef?: string;
  paymentCode?: string;
}

// Keyed by the EXACT section_code strings the app already stores (see
// SEED_DATA / the FY-2026-27 migrations). Grouped by category for auditability.
const RAW_ENTRIES: RawEntry[] = [
  // ── Section 392 — Salary ───────────────────────────────────────────
  { codes: ["192"], newSection: "392", category: "salary" },

  // ── Section 393(2) — Non-residents (Form 27Q) ──────────────────────
  { codes: ["194E"], newSection: "393(2)", category: "non-resident", tableRef: "Sl. No. 1", paymentCode: "1039" },
  { codes: ["194LB-NR"], newSection: "393(2)", category: "non-resident" },
  { codes: ["194LC"], newSection: "393(2)", category: "non-resident" },
  { codes: ["194LD"], newSection: "393(2)", category: "non-resident" },
  { codes: ["195"], newSection: "393(2)", category: "non-resident" },
  { codes: ["196A"], newSection: "393(2)", category: "non-resident" },
  { codes: ["196B"], newSection: "393(2)", category: "non-resident" },
  { codes: ["196C"], newSection: "393(2)", category: "non-resident" },
  { codes: ["196D"], newSection: "393(2)", category: "non-resident" },

  // ── Section 393(3) — Any person / universal ────────────────────────
  { codes: ["192A"], newSection: "393(3)", category: "any-person" },
  { codes: ["194B"], newSection: "393(3)", category: "any-person", tableRef: "Sl. No. 1", paymentCode: "1058" },
  { codes: ["194BB"], newSection: "393(3)", category: "any-person" },
  { codes: ["194BA"], newSection: "393(3)", category: "any-person" },
  { codes: ["194G"], newSection: "393(3)", category: "any-person" },
  { codes: ["194N-F", "194N-NF"], newSection: "393(3)", category: "any-person" },
  { codes: ["194T"], newSection: "393(3)", category: "any-person", tableRef: "Sl. No. 7", paymentCode: "1067" },

  // ── Section 394 — TCS (Form 27EQ) ──────────────────────────────────
  {
    codes: ["206C(1)", "206C(1C)", "206C(1G)(a)", "206C(1G)(b)", "206C(1H)"],
    newSection: "394",
    category: "tcs",
  },

  // ── Section 393(1) — Residents (Form 26Q, the default bucket) ───────
  { codes: ["193"], newSection: "393(1)", category: "resident" },
  { codes: ["194"], newSection: "393(1)", category: "resident" },
  { codes: ["194A", "194A-SC", "194A- Other than Bank"], newSection: "393(1)", category: "resident" },
  { codes: ["194C"], newSection: "393(1)", category: "resident" },
  { codes: ["194D"], newSection: "393(1)", category: "resident", tableRef: "Sl. No. 1(i)", paymentCode: "1005" },
  { codes: ["194DA"], newSection: "393(1)", category: "resident" },
  { codes: ["194F"], newSection: "393(1)", category: "resident" },
  { codes: ["194H"], newSection: "393(1)", category: "resident" },
  { codes: ["194I(a)", "194I(b)"], newSection: "393(1)", category: "resident" },
  { codes: ["194IA"], newSection: "393(1)", category: "resident" },
  { codes: ["194IB"], newSection: "393(1)", category: "resident" },
  { codes: ["194IC"], newSection: "393(1)", category: "resident" },
  // 194J codes 1026/1027 deliberately omitted — see file header note on the
  // (a)/(b) label swap in the underlying rate rows.
  { codes: ["194J(a)", "194J(b)"], newSection: "393(1)", category: "resident" },
  { codes: ["194K"], newSection: "393(1)", category: "resident" },
  { codes: ["194LA"], newSection: "393(1)", category: "resident" },
  { codes: ["194LB"], newSection: "393(1)", category: "resident" },
  { codes: ["194LBC"], newSection: "393(1)", category: "resident" },
  { codes: ["194M"], newSection: "393(1)", category: "resident" },
  { codes: ["194O"], newSection: "393(1)", category: "resident" },
  { codes: ["194Q"], newSection: "393(1)", category: "resident", tableRef: "Sl. No. 8(ii)", paymentCode: "1031" },
  { codes: ["194R"], newSection: "393(1)", category: "resident" },
  { codes: ["194S"], newSection: "393(1)", category: "resident" },
];

function toInfo(e: RawEntry): Section393Info {
  const hasCode = e.paymentCode != null || e.tableRef != null;
  return {
    newSection: e.newSection,
    category: e.category,
    categoryLabel: CATEGORY_LABEL[e.category],
    tableRef: e.tableRef ?? null,
    paymentCode: e.paymentCode ?? null,
    codeStatus: hasCode ? "indicative" : "unmapped",
  };
}

const EXACT_LOOKUP: Record<string, Section393Info> = (() => {
  const m: Record<string, Section393Info> = {};
  for (const e of RAW_ENTRIES) {
    const info = toInfo(e);
    for (const code of e.codes) m[code] = info;
  }
  return m;
})();

/**
 * Resolve the Section 393 mapping for an app section_code. Falls back to a
 * conservative category guess for codes not explicitly listed (e.g. a new
 * variant a firm adds via "Add Section") so the UI degrades gracefully
 * rather than dropping the enrichment entirely.
 */
export function resolveSection393(sectionCode: string | null | undefined): Section393Info | null {
  if (!sectionCode) return null;
  const code = sectionCode.trim();
  const exact = EXACT_LOOKUP[code];
  if (exact) return exact;

  // Fallback for unknown codes — classify by prefix, never fabricate a code/ref.
  if (/^206C/i.test(code)) return toInfo({ codes: [], newSection: "394", category: "tcs" });
  if (/^192A/i.test(code)) return toInfo({ codes: [], newSection: "393(3)", category: "any-person" });
  if (/^192/i.test(code)) return toInfo({ codes: [], newSection: "392", category: "salary" });
  if (/^19[45]/i.test(code) || /^196/i.test(code)) {
    // 195 / 196x are non-resident; other 194/195 default to resident 393(1).
    const nonResident = /^19[56]/i.test(code);
    return toInfo({
      codes: [],
      newSection: nonResident ? "393(2)" : "393(1)",
      category: nonResident ? "non-resident" : "resident",
    });
  }
  return null;
}
