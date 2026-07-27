/**
 * Cross-check an attached ACK receipt's own printed fields (Name / Financial
 * Year / Quarter / TAN / Form No. — extracted by ackPdf.ts) against the
 * filing row it's being attached to, and decide REJECT vs WARN per field.
 *
 * Split deliberately by field:
 *   - Financial Year / Quarter — HARD BLOCK. Both are closed, unambiguous,
 *     structured value sets (FY is "YYYY-YY", Quarter is exactly Q1-Q4)
 *     printed verbatim on the government receipt. There is no realistic way
 *     for a genuinely-extracted "Q4" to be confused with a genuinely-filed
 *     "Q1" — a definite mismatch here is always a real data error (wrong
 *     receipt attached to the wrong filing), never a false positive from OCR
 *     noise or entity-naming variance. Regression: a Q4 acknowledgement was
 *     once attached to a Q1 filing with no visible warning and the mismatch
 *     was silently accepted — this module exists so that specific class of
 *     error can never again result in a successful, un-blocked attach.
 *   - Name — WARN ONLY. Legal-entity-name text can legitimately vary in ways
 *     nameCompare() might call "different" in edge cases (OCR quality on a
 *     scanned receipt, unusual punctuation/spacing, a trade name vs legal
 *     name) — hard-blocking on it risks locking out a correct upload, so it's
 *     surfaced for human judgement instead, exactly like this module's own
 *     TAN/Form No. checks (unchanged, pre-existing warn-only behaviour).
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

  // ── Name — WARN (fuzzy/equivalent match via the same nameCompare() every
  // other TDS stage uses; "unknown" i.e. blank/unusable on one side is
  // deliberately NOT a mismatch) ──────────────────────────────────────────
  const clientName = client?.name || "";
  if (fields.name && clientName) {
    const cmp = nameCompare(clientName, fields.name);
    if (cmp === "mismatch" || cmp === "different") {
      warnReasons.push(`name ("${fields.name}" vs "${clientName}")`);
    }
  }

  // ── TAN — WARN (unchanged pre-existing behaviour) ──────────────────────
  const clientTan = client?.tan_number || filing.tan || "";
  if (fields.tan && clientTan && normalizePan(fields.tan) !== normalizePan(clientTan)) {
    warnReasons.push(`TAN (${fields.tan} vs ${clientTan})`);
  }

  // ── Form No. — WARN (unchanged pre-existing behaviour). filing.tds_forms
  // holds bare codes ("24Q"), never the receipt's "Form 24Q" (already
  // stripped by extractAckFields). ───────────────────────────────────────
  if (fields.formNo && filing.tds_forms?.[0] && fields.formNo.toUpperCase() !== filing.tds_forms[0].toUpperCase()) {
    warnReasons.push(`Form (${fields.formNo} vs ${filing.tds_forms[0]})`);
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
