/**
 * Cross-check an attached ACK receipt's own printed fields (Name / Financial
 * Year / Quarter / TAN / Form No. — extracted by ackPdf.ts) against the
 * filing row it's being attached to, and decide REJECT vs WARN per field.
 *
 * Split deliberately by field:
 *   - Form Type / Financial Year / Quarter / Client Name — HARD BLOCK. All
 *     four are printed verbatim on the government receipt as closed,
 *     unambiguous values (Form is one of 24Q/26Q/27Q/27EQ, FY is "YYYY-YY",
 *     Quarter is exactly Q1-Q4, Name is compared via the same nameCompare()
 *     every other TDS stage in this app already trusts for real
 *     reconciliation decisions). There is no realistic way for a
 *     genuinely-extracted "24Q"/"Q4" to be confused with a genuinely-filed
 *     "26Q"/"Q1" — a definite mismatch on any of these four is always a real
 *     data error (wrong receipt attached to the wrong filing), never a false
 *     positive from OCR noise. Regression history: a Q4 acknowledgement was
 *     once attached to a Q1 filing, and separately a 24Q acknowledgement was
 *     attached to a 26Q filing, both accepted with no effective block (each
 *     was only a soft warning, easy to miss/overwrite) — this module exists
 *     so none of these four fields can ever again result in a successful,
 *     un-blocked attach when they genuinely disagree.
 *
 * Extraction failure is NOT a mismatch: every check below only fires when
 * `fields.<x>` was actually extracted from the PDF's text layer. A
 * scanned/image-only receipt (all fields null) has nothing to compare against
 * and must never reject or warn — that would make this feature unusable for
 * exactly the documents most likely to need a human's eyes anyway. This is
 * field-by-field, not all-or-nothing: e.g. if only Financial Year was
 * readable and it mismatches, that alone rejects even though Quarter
 * extraction failed and contributes nothing.
 */
import type { AckFields } from "./ackPdf";
import { nameCompare, normalizePan } from "./match";

/** The subset of a tds_filings row this module needs — kept structural
 *  (not imported from the component) so this stays a dependency-free leaf
 *  module, importable from a plain vitest file with no React/Supabase. */
export interface AckFilingIdentity {
  financial_year: string;
  quarter: string;
  tan?: string | null;
  tds_forms?: string[] | null;
}

export interface AckClientIdentity {
  name?: string | null;
  tan_number?: string | null;
}

export interface AckMismatchResult {
  /** Financial Year / Quarter mismatches — a non-empty array here means the
   *  attach MUST be blocked: no storage upload, no tds_ack_files insert, no
   *  acknowledgment_number update. */
  rejectReasons: string[];
  /** Name / TAN / Form No. mismatches — informational only, never blocks. */
  warnReasons: string[];
}

// Financial year strings appear as either "2025-26" (this app's own format,
// matching the real ACK receipt's own printed format) or occasionally
// "2025-2026" — normalise both to "2025-26" before comparing so a harmless
// 2 vs 4-digit end-year difference is never reported as a real mismatch.
export const normalizeFy = (v: string | null | undefined): string => {
  const s = (v ?? "").trim();
  const m = s.match(/^(\d{4})[-/](\d{2,4})$/);
  if (!m) return s.toUpperCase();
  return `${m[1]}-${m[2].length === 4 ? m[2].slice(2) : m[2]}`;
};

const normalizeQuarter = (v: string | null | undefined): string => (v ?? "").trim().toUpperCase();

/** Evaluate every cross-check field. Pure function — no I/O, no React,
 *  directly unit-testable with a synthetic AckFields + filing row. */
export function evaluateAckMismatch(
  fields: AckFields,
  filing: AckFilingIdentity,
  client: AckClientIdentity | undefined,
): AckMismatchResult {
  const rejectReasons: string[] = [];
  const warnReasons: string[] = [];

  // ── Financial Year — REJECT ────────────────────────────────────────────
  if (fields.financialYear && normalizeFy(fields.financialYear) !== normalizeFy(filing.financial_year)) {
    rejectReasons.push(`Financial Year (${fields.financialYear} vs ${filing.financial_year})`);
  }

  // ── Quarter — REJECT ────────────────────────────────────────────────────
  if (fields.quarter && normalizeQuarter(fields.quarter) !== normalizeQuarter(filing.quarter)) {
    rejectReasons.push(`Quarter (${fields.quarter} vs ${filing.quarter})`);
  }

  // ── Name — REJECT. Uses the same nameCompare() every other TDS stage
  // relies on for real reconciliation decisions elsewhere in this system, so
  // its "match" verdict is already trusted at that level of confidence — a
  // "mismatch"/"different" verdict is a real, actionable signal, not OCR
  // noise. "unknown" (blank/unusable on one side) is deliberately NOT a
  // mismatch, since there's nothing to compare. ──────────────────────────
  const clientName = client?.name || "";
  if (fields.name && clientName) {
    const cmp = nameCompare(clientName, fields.name);
    if (cmp === "mismatch" || cmp === "different") {
      rejectReasons.push(`Client Name ("${fields.name}" vs "${clientName}")`);
    }
  }

  // ── TAN — WARN. Not part of the required Form/Client/FY/Quarter set; kept
  // as a bonus, non-blocking signal. ─────────────────────────────────────
  const clientTan = client?.tan_number || filing.tan || "";
  if (fields.tan && clientTan && normalizePan(fields.tan) !== normalizePan(clientTan)) {
    warnReasons.push(`TAN (${fields.tan} vs ${clientTan})`);
  }

  // ── Form Type (24Q/26Q/27Q/27EQ) — REJECT. Exactly as unambiguous and
  // structured as Financial Year/Quarter — a receipt printed "Form 24Q" can
  // never legitimately be misread as "26Q". filing.tds_forms holds bare
  // codes ("24Q"), never the receipt's "Form 24Q" prefix (already stripped
  // by extractAckFields). Regression: a 24Q acknowledgement was attached to
  // a 26Q filing and accepted with no block — this was a soft warning only,
  // easy to miss, exactly the same class of gap FY/Quarter closed earlier. ─
  if (fields.formNo && filing.tds_forms?.[0] && fields.formNo.toUpperCase() !== filing.tds_forms[0].toUpperCase()) {
    rejectReasons.push(`Form Type (${fields.formNo} vs ${filing.tds_forms[0]})`);
  }

  return { rejectReasons, warnReasons };
}

/** Blocking, destructive-toast message for a REJECT decision (rejectReasons
 *  non-empty). States exactly what's wrong and what to do about it. */
export function buildAckRejectMessage(
  fields: AckFields,
  filing: AckFilingIdentity,
  client: AckClientIdentity | undefined,
  rejectReasons: string[],
): string {
  const clientName = client?.name || "this client";
  return (
    `This acknowledgement is for ${fields.name || "a different deductor"}`
    + `${fields.financialYear ? `, FY ${fields.financialYear}` : ""}${fields.quarter ? ` ${fields.quarter}` : ""}`
    + `, but this filing is ${clientName}, FY ${filing.financial_year} ${filing.quarter}.`
    + ` Attach the correct file, or contact support if this is expected.`
    + ` (Mismatch: ${rejectReasons.join("; ")})`
  );
}

/** Non-blocking warning message for a WARN decision (warnReasons non-empty).
 *  Returns null when there's nothing to warn about, so callers can treat a
 *  null return as "append nothing" without a separate length check. */
export function buildAckWarningMessage(
  fields: AckFields,
  filing: AckFilingIdentity,
  client: AckClientIdentity | undefined,
  warnReasons: string[],
): string | null {
  if (warnReasons.length === 0) return null;
  const clientName = client?.name || "this client";
  return (
    `This acknowledgement is for ${fields.name || "a different deductor"}`
    + `${fields.financialYear ? `, FY ${fields.financialYear}` : ""}${fields.quarter ? ` ${fields.quarter}` : ""}`
    + ` — but you're attaching it to ${clientName}, FY ${filing.financial_year} ${filing.quarter}.`
    + ` Please verify this is the correct file. (Mismatch: ${warnReasons.join("; ")})`
  );
}
