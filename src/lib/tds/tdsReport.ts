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
