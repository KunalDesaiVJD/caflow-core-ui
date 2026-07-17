/**
 * TDS validation reports — ONE report shape, exported to Excel or PDF.
 *
 * Every stage (1 data reconciliation, 2 PAN verification, 3 Tally ledger) and the
 * combined Overview describe themselves as a `StageReport`: a summary strip plus a
 * set of titled row-sets. The two exporters then render that same structure, so a
 * stage only has to say WHAT its records are — never how to draw a spreadsheet or
 * a PDF, and a fix to either format lands for all of them at once.
 *
 * Excel: one worksheet per section (Summary, Matched, Mismatched, …).
 * PDF:   the same sections as headed tables, printed off-screen via html2pdf.
 */

import { exportToExcel, exportToPdf } from "@/lib/exportUtils";

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

const esc = (v: unknown): string =>
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
function metaRows(meta: ReportMeta, generatedAt: string): Record<string, unknown>[] {
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

/** Excel: Summary sheet (client block + counts) then one sheet per section. */
export function exportStageExcel(report: StageReport, meta: ReportMeta): void {
  const generatedAt = reportStamp();
  const summarySheet = [
    ...metaRows(meta, generatedAt),
    { Field: "", Value: "" },
    ...report.summary.map((s) => ({ Field: s.label, Value: s.value })),
    ...(report.notes?.length ? [{ Field: "", Value: "" }, ...report.notes.map((n, i) => ({ Field: i === 0 ? "Notes" : "", Value: n }))] : []),
  ];
  const sheets = [
    { sheetName: "Summary", rows: summarySheet },
    // A section with no rows still gets a sheet, carrying its note — an absent
    // "Mismatched" sheet is ambiguous (none? or not exported?); an explicit
    // "No mismatched records" is not.
    ...report.sections.map((sec) => ({
      sheetName: sec.title,
      rows: sec.rows.length ? sec.rows : [{ Result: sec.emptyNote || `No ${sec.title.toLowerCase()} records` }],
    })),
  ];
  exportToExcel(sheets, reportFileName(meta, report.title, "xlsx"));
}

function tableHtml(rows: Record<string, unknown>[], emptyNote?: string): string {
  if (!rows.length) return `<p class="empty">${esc(emptyNote || "None")}</p>`;
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  return `<table><thead><tr>${cols.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead><tbody>${
    rows.map((r) => `<tr>${cols.map((c) => `<td>${esc(r[c])}</td>`).join("")}</tr>`).join("")
  }</tbody></table>`;
}

/** Build the printable HTML for a report (also used by the Overview). */
export function stageReportHtml(report: StageReport, meta: ReportMeta, generatedAt: string): string {
  return `
    <div class="doc">
      <h1>${esc(report.title)}</h1>
      ${report.subtitle ? `<p class="sub">${esc(report.subtitle)}</p>` : ""}
      <table class="meta">${metaRows(meta, generatedAt).map((m) => `<tr><th>${esc(m.Field)}</th><td>${esc(m.Value)}</td></tr>`).join("")}</table>
      <div class="cards">${report.summary.map((s) => `<div class="card"><div class="v">${esc(s.value)}</div><div class="l">${esc(s.label)}</div></div>`).join("")}</div>
      ${report.notes?.length ? `<div class="notes"><b>Notes</b><ul>${report.notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul></div>` : ""}
      ${report.sections.map((sec) => `<h2>${esc(sec.title)} <span class="count">(${sec.rows.length})</span></h2>${tableHtml(sec.rows, sec.emptyNote)}`).join("")}
    </div>`;
}

const REPORT_CSS = `
  .doc { font-family: Arial, Helvetica, sans-serif; color: #111; font-size: 10px; }
  h1 { font-size: 16px; margin: 0 0 2px; }
  .sub { color: #666; margin: 0 0 8px; font-size: 10px; }
  table { border-collapse: collapse; width: 100%; margin: 4px 0 10px; }
  th, td { border: 1px solid #ccc; padding: 3px 5px; text-align: left; vertical-align: top; word-break: break-word; }
  th { background: #f3f4f6; font-weight: bold; }
  table.meta { width: auto; margin-bottom: 8px; }
  table.meta th { background: #fafafa; width: 120px; }
  h2 { font-size: 12px; margin: 12px 0 2px; border-bottom: 1px solid #333; padding-bottom: 2px; }
  h2 .count { color: #777; font-weight: normal; font-size: 10px; }
  .cards { display: flex; gap: 6px; margin: 6px 0 10px; flex-wrap: wrap; }
  .card { border: 1px solid #ddd; border-radius: 4px; padding: 5px 10px; min-width: 74px; text-align: center; }
  .card .v { font-size: 15px; font-weight: bold; }
  .card .l { font-size: 8px; color: #666; text-transform: uppercase; }
  .empty { color: #777; font-style: italic; margin: 2px 0 8px; }
  .notes ul { margin: 2px 0 8px 16px; padding: 0; }
  .stage-block { page-break-inside: avoid; }
`;

/** Render HTML off-screen and hand the real element to html2pdf, which needs a
 *  laid-out node (it rasterises via html2canvas). Always removed afterwards. */
async function printHtml(html: string, filename: string): Promise<void> {
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;left:-10000px;top:0;width:1100px;background:#fff;padding:16px;";
  host.innerHTML = `<style>${REPORT_CSS}</style>${html}`;
  document.body.appendChild(host);
  try {
    await exportToPdf(host, filename, { orientation: "landscape", format: "a4" });
  } finally {
    host.remove();
  }
}

export async function exportStagePdf(report: StageReport, meta: ReportMeta): Promise<void> {
  await printHtml(stageReportHtml(report, meta, reportStamp()), reportFileName(meta, report.title, "pdf"));
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

const overviewSections = (o: OverviewReport): ReportSection[] => [
  {
    title: "Stage Summary",
    rows: o.stages.map((s) => ({
      Stage: s.title,
      Applicable: s.applicable ? "Yes" : "No",
      Run: s.ran ? "Yes" : "No",
      Status: s.status,
      ...Object.fromEntries(s.summary.map((x) => [x.label, x.value])),
    })),
  },
];

export function exportOverviewExcel(o: OverviewReport, meta: ReportMeta): void {
  exportStageExcel({
    title: "Validation Overview",
    subtitle: "Stage 1 · Stage 2 · Stage 3 — combined validation status",
    summary: [...o.overall, { label: "Final Status", value: o.finalStatus }],
    sections: overviewSections(o),
  }, meta);
}

export async function exportOverviewPdf(o: OverviewReport, meta: ReportMeta): Promise<void> {
  const generatedAt = reportStamp();
  const html = `
    <div class="doc">
      <h1>TDS Validation — Overview Report</h1>
      <p class="sub">Stage 1 (data reconciliation) · Stage 2 (PAN verification) · Stage 3 (Tally ledger)</p>
      <table class="meta">${metaRows(meta, generatedAt).map((m) => `<tr><th>${esc(m.Field)}</th><td>${esc(m.Value)}</td></tr>`).join("")}</table>
      <div class="cards">${o.overall.map((s) => `<div class="card"><div class="v">${esc(s.value)}</div><div class="l">${esc(s.label)}</div></div>`).join("")}</div>
      <h2>Final Validation Status</h2>
      <p style="font-size:13px;font-weight:bold;color:${o.ready ? "#047857" : "#b45309"};margin:2px 0 10px;">${esc(o.finalStatus)}</p>
      ${o.stages.map((s) => `
        <div class="stage-block">
          <h2>${esc(s.title)} <span class="count">— ${esc(s.status)}</span></h2>
          ${s.applicable
            ? `<div class="cards">${s.summary.map((x) => `<div class="card"><div class="v">${esc(x.value)}</div><div class="l">${esc(x.label)}</div></div>`).join("")}</div>`
            : `<p class="empty">Not applicable for this return — no file imported for this stage.</p>`}
        </div>`).join("")}
    </div>`;
  await printHtml(html, reportFileName(meta, "Validation Overview", "pdf"));
}
