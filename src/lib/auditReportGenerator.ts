/**
 * auditReportGenerator
 * ────────────────────────────────────────────────────────────────────────────
 * Pure (no I/O, no React) function that emits the conditional fragments of
 * the Independent Auditor's Report under the Companies Act, 2013, based on
 * the three Stage 1 Block C flags:
 *
 *   - caroApplicable      → toggles the CARO 2020 Annexure-A reference
 *                            paragraph (with vs without text from word file)
 *   - ifcApplicable       → toggles Point (g) of the Other Legal &
 *                            Regulatory paragraph (Annexure-B reference vs
 *                            "not applicable" sentence)
 *   - cashFlowApplicable  → toggles three locations:
 *                              1. Opening sentence of the Opinion section
 *                              2. Point (d) of Other Legal & Regulatory
 *                              3. Closing sentence of the Opinion section
 *
 * Returned fragments are plain strings (no JSX) so they can be persisted to
 * `audit_engagements.form_3ca_paragraphs` JSONB, edited by the auditor, and
 * exported to PDF/Word without further processing.
 *
 * Tokens like `[Company Name]` and `March 31, 20XX` are replaced when the
 * caller passes engagement data — see `generateAuditReport()`.
 */

export interface AuditReportInput {
  caroApplicable:     boolean;
  ifcApplicable:      boolean;
  cashFlowApplicable: boolean;

  clientName?:    string | null;
  pan?:           string | null;
  firmName?:      string | null;
  frn?:           string | null;
  partnerName?:   string | null;
  membershipNo?:  string | null;
  udin?:          string | null;
  place?:         string | null;
  financialYear?: string | null; // "YYYY-YY"
}

export interface AuditReportFragments {
  /** Opening sentence of the Opinion section (with/without "and Cash Flow Statement"). */
  opinionPara: string;
  /** Closing sentence of the Opinion section (with/without "and its cash flows"). */
  opinionConclusion: string;
  /** Point (d) of "Report on Other Legal and Regulatory Requirements". */
  pointD: string;
  /** Point (g) of "Report on Other Legal and Regulatory Requirements". */
  pointG: string;
  /** CARO 2020 Annexure-A reference paragraph (or exemption paragraph). */
  caroAnnexure: string;
  /** Resolved metadata used for token replacement (echoed for caller convenience). */
  meta: {
    companyName: string;
    fyEndDate:   string; // e.g. "March 31, 2026"
  };
}

// FY end formatter — "2025-26" → "March 31, 2026"
export function fyEndDate(fy?: string | null): string {
  if (!fy) return 'March 31, 20XX';
  const m = String(fy).match(/^(\d{4})-(\d{2})$/);
  if (!m) return 'March 31, 20XX';
  return `March 31, ${parseInt(m[1]) + 1}`;
}

export function generateAuditReport(input: AuditReportInput): AuditReportFragments {
  const company = input.clientName?.trim() || '[Company Name]';
  const fyEnd   = fyEndDate(input.financialYear);

  // ─── Opinion: opening sentence ─────────────────────────────────────────
  // WITH cash flow → "...Balance Sheet as at March 31, 20XX, the statement
  //                  of Profit and Loss AND CASH FLOW STATEMENT for the year
  //                  then ended..."
  // WITHOUT        → "...Balance Sheet as at March 31, 20XX, and the
  //                  statement of Profit and Loss for the year then ended..."
  const opinionPara = input.cashFlowApplicable
    ? `We have audited the accompanying financial statements of ${company} ('the Company'), which comprise the Balance Sheet as at ${fyEnd}, the statement of Profit and Loss and Cash Flow Statement for the year then ended, and notes to the financial statements, including a summary of significant accounting policies and other explanatory information.`
    : `We have audited the accompanying financial statements of ${company} ('the Company'), which comprise the Balance Sheet as at ${fyEnd}, and the statement of Profit and Loss for the year then ended, and notes to the financial statements, including a summary of significant accounting policies and other explanatory information.`;

  // ─── Opinion: closing sentence ────────────────────────────────────────
  // WITH cash flow → "...Profit AND ITS CASH FLOWS for the year ended..."
  // WITHOUT        → "...Profit for the year ended on that date."
  const opinionConclusion = input.cashFlowApplicable
    ? `In our opinion and to the best of our information and according to the explanations given to us, the aforesaid financial statements give the information required by the Companies Act, 2013 in the manner so required and give a true and fair view in conformity with the accounting principles generally accepted in India, of the state of affairs of the Company as at ${fyEnd}, and Profit and its cash flows for the year ended on that date.`
    : `In our opinion and to the best of our information and according to the explanations given to us, the aforesaid financial statements give the information required by the Companies Act, 2013 in the manner so required and give a true and fair view in conformity with the accounting principles generally accepted in India, of the state of affairs of the Company as at ${fyEnd}, and Profit for the year ended on that date.`;

  // ─── Point (d) — books-of-account agreement ──────────────────────────
  const pointD = input.cashFlowApplicable
    ? `(d) The Balance Sheet, the Statement of Profit and Loss and the Cash Flow Statement dealt with by this Report are in agreement with the books of account;`
    : `(d) The Balance Sheet and the Statement of Profit and Loss dealt with by this Report are in agreement with the books of account;`;

  // ─── Point (g) — IFC reference ───────────────────────────────────────
  const pointG = input.ifcApplicable
    ? `(g) With respect to the adequacy of the internal financial control over financial reporting of the Company and the operating effectiveness of such controls, refer to our separate report in Annexure-B.`
    : `(g) The report on adequacy of the internal financial control over financial reporting is not applicable as the company falls within the exemptions specified under sub-section 3(1) of section 143 of the Act.`;

  // ─── CARO Annexure-A reference paragraph ─────────────────────────────
  const caroAnnexure = input.caroApplicable
    ? `As required by the Companies (Auditors Report) Order, 2020 (the Order) issued by the Central Government in terms of Section 143(11) of the Act, we give in the Annexure-A, a statement on the matters specified in paragraphs 3 and 4 of the Order, to the extent applicable.`
    : `The Company is a private limited and falls within exemptions specified under paragraph 2(iv) of the Companies (Auditors Report) Order, 2020. Hence matters specified in paragraph 3 and 4 of the said order are not enclosed.`;

  return {
    opinionPara,
    opinionConclusion,
    pointD,
    pointG,
    caroAnnexure,
    meta: { companyName: company, fyEndDate: fyEnd },
  };
}

/**
 * Convenience: applicability triple from an `audit_engagements` row.
 * Treats `null`/`undefined` as `true` (legacy engagements default to the
 * fully-included template — matches Block C visibility semantics).
 */
export function flagsFromEngagement(eng: any): {
  caroApplicable: boolean;
  ifcApplicable: boolean;
  cashFlowApplicable: boolean;
} {
  return {
    caroApplicable:     eng?.caro_applicable      !== false,
    ifcApplicable:      eng?.ifc_applicable       !== false,
    cashFlowApplicable: eng?.cash_flow_applicable !== false,
  };
}
