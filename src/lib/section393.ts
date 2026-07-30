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
 *      filing-utility/vendor artefacts (confirmed directly: the Section 393
 *      statutory text itself, fetched from IndianKanoon, uses only Table
 *      Serial No. / sub-clause references, never a 4-digit number). Codes/
 *      refs are attached ONLY where 2+ independent, reputable sources
 *      converge (a real TDS-compliance vendor's production rate chart,
 *      TaxGuru, or the user's own CBDT-derived reference document), always
 *      marked `codeStatus: "indicative"`, and the UI shows
 *      SECTION_393_DISCLAIMER. Everything else is `codeStatus: "unmapped"`
 *      (paymentCode/tableRef null) rather than guessed.
 *
 * CORRECTION (2026-07-30): an earlier version of this file left 194C
 * deliberately unmapped, citing a "107-agent deep-research pass" that
 * "refuted" payment code 1023 for old §194C. A fresh, independent
 * adversarial re-verification (three blind researchers + a prosecution
 * agent + a defense agent + a judge, run after the user's own CBDT-derived
 * reference document also confirmed 1023/1024 for 194C) found the opposite:
 * 1023 (Individual/HUF, 1%, Table Sl. No. 6(i).D(a)) and 1024 (Others, 2%,
 * D(b)) are independently corroborated by TDSMAN's own post-launch,
 * revised (21-May-2026) production rate-chart PDF AND by TaxGuru, two
 * genuinely independent accountable sources whose surrounding table rows
 * (1006=194H, 1017=194LBB, etc.) are also internally consistent with every
 * other code already verified in this codebase. The rival numbers a defense
 * pass surfaced (1006, 1017 for 194C) turned out to already be occupied by
 * DIFFERENT sections in those same two high-quality sources — a signature
 * of low-quality/hallucinated content, not a genuine competing data point.
 * 1023/1024 are restored here. See the 194A/194C/194R bifurcation below —
 * this app's own section_code values split each of those into lettered
 * variants (194C(a)/(b) etc.) since the new Act's payment code, not just
 * deductee type, is now the operative distinction for these three.
 *
 * NOTE (resolved): an earlier version also left 194J(a)/(b) unmapped,
 * citing a label-swap concern (this app's rows call 194J(a)=Professional
 * Services @10% and 194J(b)=Technical Services @2%, opposite of some
 * vendors' lettering convention). This was resolved by keying the payment
 * code assignment off each row's ACTUAL nature_of_payment/rate (verified
 * directly against tds_rate_master before assigning), not the letter
 * itself — so 1027 (Professional) attaches to whichever row IS
 * Professional Services, correctly, regardless of vendor lettering
 * convention.
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
  // Same provision as "194LB" below, recorded under a different form_type
  // (27Q non-resident vs 26Q) — confirmed identical rate/citation/code
  // across two independent research passes, not a genuine collision.
  { codes: ["194LB-NR"], newSection: "393(2)", category: "non-resident", tableRef: "S.No. 5", paymentCode: "1044" },
  { codes: ["194LB"], newSection: "393(2)", category: "non-resident", tableRef: "S.No. 5", paymentCode: "1044" },
  // 194LC splits into 4 different payment codes (1040-1043) depending on
  // bond/loan sub-type, which this app's single section_code doesn't
  // capture — left unmapped rather than guess which sub-type applies.
  { codes: ["194LC"], newSection: "393(2)", category: "non-resident" },
  // Research traced the code some sources attribute to 194LD and found it
  // actually belongs to 194LC (near-identical phrasing, confirmed via bare
  // Act text) — genuinely no code found, not just low confidence.
  { codes: ["194LD"], newSection: "393(2)", category: "non-resident" },
  { codes: ["195"], newSection: "393(2)", category: "non-resident", tableRef: "Sl. No. 17", paymentCode: "1057" },
  { codes: ["196A"], newSection: "393(2)", category: "non-resident", paymentCode: "1050" },
  { codes: ["196B"], newSection: "393(2)", category: "non-resident", tableRef: "Sl. No. 11", paymentCode: "1051" },
  // 196C splits into 2 codes (1053 interest/dividend, 1054 LTCG) depending
  // on which limb of the old provision applies — left unmapped rather than
  // guess which one a given row represents.
  { codes: ["196C"], newSection: "393(2)", category: "non-resident" },
  { codes: ["196D"], newSection: "393(2)", category: "non-resident", tableRef: "Sl. No. 15", paymentCode: "1055" },

  // ── Section 393(3) — Any person / universal ────────────────────────
  { codes: ["192A"], newSection: "393(3)", category: "any-person", tableRef: "393(7)", paymentCode: "1004" },
  { codes: ["194B"], newSection: "393(3)", category: "any-person", tableRef: "Sl. No. 1", paymentCode: "1058" },
  { codes: ["194BB"], newSection: "393(3)", category: "any-person", tableRef: "S.No. 3", paymentCode: "1062" },
  { codes: ["194BA"], newSection: "393(3)", category: "any-person" },
  { codes: ["194G"], newSection: "393(3)", category: "any-person", tableRef: "S.No. 4", paymentCode: "1063" },
  { codes: ["194N-F", "194N-NF"], newSection: "393(3)", category: "any-person" },
  { codes: ["194T"], newSection: "393(3)", category: "any-person", tableRef: "Sl. No. 7", paymentCode: "1067" },

  // ── Section 394 — TCS (Form 27EQ) ──────────────────────────────────
  { codes: ["206C(1)"], newSection: "394", category: "tcs", tableRef: "394(1) [Table: S.N. 4]", paymentCode: "1073" },
  {
    // 206C(1H) omitted from this list deliberately: research indicates this
    // TCS-on-sale-of-goods provision was ABOLISHED by the Finance Act 2025
    // effective 1-Apr-2025 — a full year before the Section 393 reform even
    // took effect — so it has no new-Act mapping to attach at all, not
    // merely an unverified one. Kept selectable in the app (existing
    // is_active row) only for pre-abolition historical reference.
    //
    // 206C(1C) itself splits into 3 codes (parking lot/toll plaza/mining)
    // and 206C(1G)(a) splits into 2 (education-medical vs other purpose) —
    // both left unmapped since this app's single section_code per entry
    // doesn't capture which sub-type applies.
    codes: ["206C(1C)", "206C(1G)(a)", "206C(1G)(b)"],
    newSection: "394",
    category: "tcs",
  },

  // ── Section 393(1) — Residents (Form 26Q, the default bucket) ───────
  { codes: ["193"], newSection: "393(1)", category: "resident", tableRef: "Sl. No. 5(i)", paymentCode: "1019" },
  { codes: ["194"], newSection: "393(1)", category: "resident", tableRef: "Sl. No. 7", paymentCode: "1029" },
  // Legacy un-split "194A" family (kept selectable for existing entries
  // saved before the 194A(a)/(b)/(c) bifurcation) — genuinely ambiguous
  // which lettered variant applies, so no code attached to these.
  { codes: ["194A", "194A-SC", "194A- Other than Bank"], newSection: "393(1)", category: "resident" },
  { codes: ["194A(a)"], newSection: "393(1)", category: "resident", tableRef: "Sl. No. 5(ii).D(a)", paymentCode: "1020" },
  { codes: ["194A(b)"], newSection: "393(1)", category: "resident", tableRef: "Sl. No. 5(ii).D(b)", paymentCode: "1021" },
  { codes: ["194A(c)"], newSection: "393(1)", category: "resident", tableRef: "Sl. No. 5(iii)", paymentCode: "1022" },
  // Legacy un-split "194C" (same reasoning as 194A above).
  { codes: ["194C"], newSection: "393(1)", category: "resident" },
  { codes: ["194C(a)"], newSection: "393(1)", category: "resident", tableRef: "Sl. No. 6(i).D(a)", paymentCode: "1023" },
  { codes: ["194C(b)"], newSection: "393(1)", category: "resident", tableRef: "Sl. No. 6(i).D(b)", paymentCode: "1024" },
  { codes: ["194D"], newSection: "393(1)", category: "resident", tableRef: "S.No. 1(i)", paymentCode: "1005" },
  { codes: ["194DA"], newSection: "393(1)", category: "resident", tableRef: "Sl. No. 8(i)", paymentCode: "1030" },
  { codes: ["194F"], newSection: "393(1)", category: "resident" },
  { codes: ["194H"], newSection: "393(1)", category: "resident", tableRef: "Sl. No. 1(ii)", paymentCode: "1006" },
  { codes: ["194I(a)"], newSection: "393(1)", category: "resident", tableRef: "Sl. No. 2(ii).D(a)", paymentCode: "1008" },
  { codes: ["194I(b)"], newSection: "393(1)", category: "resident", tableRef: "Sl. No. 2(ii).D(b)", paymentCode: "1009" },
  { codes: ["194IA"], newSection: "393(1)", category: "resident", tableRef: "Sl. No. 3(i)" },
  { codes: ["194IB"], newSection: "393(1)", category: "resident", tableRef: "Sl. No. 2(i)" },
  { codes: ["194IC"], newSection: "393(1)", category: "resident", tableRef: "S.N. 3(ii)", paymentCode: "1011" },
  // Payment code keyed off each row's ACTUAL nature_of_payment (verified
  // against tds_rate_master directly), not the letter — this app's own
  // 194J(a)=Professional/10%, 194J(b)=Technical/2% (opposite of some
  // vendors' lettering convention, confirmed a non-issue once resolved this
  // way; see file header).
  { codes: ["194J(a)"], newSection: "393(1)", category: "resident", tableRef: "Sl. No. 6(iii).D(b)", paymentCode: "1027" },
  { codes: ["194J(b)"], newSection: "393(1)", category: "resident", tableRef: "Sl. No. 6(iii).D(a)", paymentCode: "1026" },
  { codes: ["194K"], newSection: "393(1)", category: "resident", tableRef: "Sl. No. 4(i)", paymentCode: "1013" },
  { codes: ["194LA"], newSection: "393(1)", category: "resident", tableRef: "S.No. 3(iii)", paymentCode: "1012" },
  { codes: ["194LBC"], newSection: "393(1)", category: "resident", tableRef: "Sl. No. 4(iv)", paymentCode: "1018" },
  { codes: ["194M"], newSection: "393(1)", category: "resident", tableRef: "S.No. 6(ii)" },
  {
    // 194O: a fresh research pass found code 1035, but that collides with
    // 194R(b) (already verified from the user's own PDF) — almost
    // certainly a mix-up between adjacent 393(1) table rows, not a real
    // competing data point. Left unmapped pending a cleaner source.
    codes: ["194O"], newSection: "393(1)", category: "resident",
  },
  { codes: ["194Q"], newSection: "393(1)", category: "resident", tableRef: "Sl. No. 8(ii)", paymentCode: "1031" },
  // Legacy un-split "194R" (same reasoning as 194A/194C above).
  { codes: ["194R"], newSection: "393(1)", category: "resident" },
  { codes: ["194R(a)"], newSection: "393(1)", category: "resident", tableRef: "Sl. No. 8(iv)", paymentCode: "1034" },
  { codes: ["194R(b)"], newSection: "393(1)", category: "resident", tableRef: "Sl. No. 8(iv) Note 6", paymentCode: "1035" },
  { codes: ["194S"], newSection: "393(1)", category: "resident", tableRef: "Sl. No. 8(vi)", paymentCode: "1037" },
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
