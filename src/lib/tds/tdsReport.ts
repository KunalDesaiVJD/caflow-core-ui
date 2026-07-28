/**
 * TDS validation reports — the ONE report SHAPE, plus its pure helpers.
 *
 * Every stage (1 data reconciliation, 2 PAN verification, 3 Tally ledger) and the
 * combined Overview describe themselves as a `StageReport`: a summary strip plus a
 * set of titled row-sets. Each renderer then draws that same structure, so a stage
 * only says WHAT its records are — never how to draw a spreadsheet or a PDF — and a
 * fix to either format lands for all of them at once.
 *
 *   tdsReportExcel.ts → formatted .xlsx (ExcelJS)
 *   tdsReportPdf.ts   → .pdf (html2pdf)
 *
 * This module is deliberately DEPENDENCY-FREE. It used to import exportUtils, which
 * pulls in html2pdf → html2canvas; that dragged the whole PDF engine into the Excel
 * path's chunk and made the shape untestable outside a browser (html2canvas touches
 * window.document at module load). Keep it free of I/O and of renderer imports.
 */

// ── Stage 1 shared helpers ────────────────────────────────────────────────────
// Extracted out of TdsValidateFinalise.tsx (the only place Stage 1 used to
// define them) so the new standalone multi-quarter Overview fetch
// (tdsOverviewFetch.ts) can shape Stage 1 rows identically instead of forking
// a second copy of this label/reason/error-type vocabulary. Pure refactor —
// behavior is byte-identical to the original module-local versions.

export const FIELD_LABELS: Record<string, string> = {
  name: "Name", pan: "PAN", date: "Date", amount: "Amount",
  tds: "TDS", interest: "Interest", section: "Section",
};

/** The one field-diff shape reasonFor() needs — structurally compatible with
 *  TdsValidateFinalise.tsx's own (fuller) FieldDiff, so a real FieldDiff can be
 *  passed here with no cast. */
export interface ReconFieldDiffLike {
  field: string;
  matched: boolean;
}

/** The one ReconResult shape reasonFor()/errorTypeFor() need — structurally
 *  compatible with TdsValidateFinalise.tsx's own (fuller) ReconResult, so a
 *  real ReconResult can be passed here with no cast. */
export interface ReconResultLike {
  match_status: "matched" | "mismatched" | "office_only" | "imported_only";
  field_diffs: ReconFieldDiffLike[] | null;
}

/** One-line reason a record is not a clean match, naming the exact field(s). */
export function reasonFor(r: ReconResultLike): string {
  if (r.match_status === "matched") return "All 7 fields match.";
  if (r.match_status === "office_only") return "In Office Data only — no matching row in the imported client file.";
  if (r.match_status === "imported_only") return "In the imported client file only — no matching Office Data record.";
  const diffs = (r.field_diffs || []).filter(f => f.matched === false);
  const labels = diffs.map(f => FIELD_LABELS[f.field] || f.field).join(", ") || "some fields";
  return `Mismatch — ${labels} ${diffs.length > 1 ? "differ" : "difference"}.`;
}

/**
 * Readable error-TYPE label for the ErrorTypeBreakdown chips — Stage 1's
 * equivalent of Stage 3's single "result" verdict.
 *
 * NAMES THE FIGURE THAT ACTUALLY DIFFERS. This used to collapse every paired
 * mismatch to a bare "Field Mismatch", even though Stage 1 already knows
 * exactly which of the seven fields disagreed (comparePair emits a per-field
 * diff with the exact amounts). Every dispute therefore landed in one
 * undifferentiated bucket: a checker could not see, or filter by, whether the
 * problem was the gross figure, the TDS figure, the name or the date — the
 * generic verdict the engine had the evidence to avoid.
 *
 * Both 24Q and 26Q carry TWO independent money figures per record (24Q:
 * Taxable Income + TDS; 26Q: Amount Paid + TDS), and each is compared
 * separately, so each gets its own named category — the same vocabulary Stage 3
 * reports for the two-ledger case.
 *
 * PRECEDENCE when several fields differ mirrors Stage 3's: identity first (PAN,
 * then name — nothing below it means anything if the parties differ), then the
 * money figures (gross before TDS), then date, then the softer classification
 * fields. The FULL field list is never lost — it stays in field_diffs and in
 * reasonFor()'s sentence; this is only which bucket the record is filed under.
 */
export function errorTypeFor(r: ReconResultLike, form?: string | null): string {
  if (r.match_status === "office_only") return "Office Data Only";
  if (r.match_status === "imported_only") return "Imported Data Only";
  if (r.match_status === "matched") return "Matched";

  const bad = new Set((r.field_diffs || []).filter((f) => f.matched === false).map((f) => f.field));
  // 24Q's gross figure is the employee's TAXABLE INCOME; 26Q's is the amount
  // paid to the deductee. Same comparison, different word on the return.
  const gross = form === "24Q" ? "Taxable Income" : "Amount";

  if (bad.has("pan")) return "PAN Mismatch";
  if (bad.has("name")) return "Name Mismatch";
  if (bad.has("amount")) return `${gross} Mismatch`;
  if (bad.has("tds")) return "TDS Amount Mismatch";
  if (bad.has("date")) return "Date Mismatch";
  if (bad.has("section")) return "Section Mismatch";
  if (bad.has("interest")) return "Interest Mismatch";
  // Mismatched, but no field carries a diff — only reachable from a result
  // stored before field_diffs existed. Keep the old generic label for those.
  return "Field Mismatch";
}

export interface ReportMeta {
  client: string;
  tan?: string | null;
  form: string;
  quarter: string;
  fy: string;
  status?: string | null;
}

export interface ReportSection {
  title: string;
  rows: Record<string, unknown>[];
  /** Shown instead of an empty table (e.g. "No mismatches — all records matched"). */
  emptyNote?: string;
}

export interface StageReport {
  /** "Stage 1 · Data Validation" — heads the PDF and names the file. */
  title: string;
  subtitle?: string;
  summary: { label: string; value: string | number }[];
  sections: ReportSection[];
  /** Plain-language notes (diagnostics, why a count is low). */
  notes?: string[];
}

export const esc = (v: unknown): string =>
  String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** dd-MM-yyyy HH:mm — every report is stamped so a printed copy is traceable. */
export function reportStamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

const safe = (s: string) => s.replace(/[^\w.-]+/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");

/** `SWASTIK_BUILDCON_26Q_Q4_2025-26_Stage_1.xlsx` */
export function reportFileName(meta: ReportMeta, title: string, ext: "xlsx" | "pdf"): string {
  return `${safe(meta.client)}_${safe(meta.form)}_${safe(meta.quarter)}_${safe(meta.fy)}_${safe(title)}.${ext}`;
}

/** The header block both formats share. */
export function metaRows(meta: ReportMeta, generatedAt: string): Record<string, unknown>[] {
  return [
    { Field: "Client", Value: meta.client },
    ...(meta.tan ? [{ Field: "TAN", Value: meta.tan }] : []),
    { Field: "Form", Value: meta.form },
    { Field: "Quarter", Value: meta.quarter },
    { Field: "Financial Year", Value: meta.fy },
    ...(meta.status ? [{ Field: "Filing Status", Value: meta.status }] : []),
    { Field: "Report Generated", Value: generatedAt },
  ];
}

// ── Overview — all three stages in one document ──────────────────────────────

export interface OverviewStage {
  title: string;
  applicable: boolean;
  ran: boolean;
  summary: { label: string; value: string | number }[];
  /** "Complete" | "3 unresolved" | "Not run" | "Not applicable" */
  status: string;
}

export interface OverviewReport {
  stages: OverviewStage[];
  overall: { label: string; value: string | number }[];
  finalStatus: string;
  ready: boolean;
}

// ── Checker Review (Stage 4) — one row per exception, across all 3 stages ────

/**
 * One exception record for the Stage-4 Checker Review. Each stage produces its
 * OWN rows (from its own already-loaded results — no new fetch), so a fix to
 * a stage's reason/status text lands here automatically.
 *
 *   Unresolved — still an open issue, nothing has been done about it yet.
 *   Overridden — a user manually accepted the exception; `reason` IS the
 *                override reason, shown inline so the checker sees why.
 *   Resolved   — reconciled by a mechanism OTHER than an override (currently
 *                only Stage 3's saved party mapping — "Auto Match (Mapped)").
 */
export interface AuditRow {
  stage: "Stage 1" | "Stage 2" | "Stage 3";
  record: string;
  errorType: string;
  status: "Unresolved" | "Resolved" | "Overridden";
  reason: string;
}
