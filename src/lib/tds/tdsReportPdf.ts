/**
 * StageReport / OverviewReport → PDF, via the existing html2pdf helper.
 *
 * Split out of tdsReport.ts so the SHAPE stays dependency-free: html2pdf pulls in
 * html2canvas, which touches window.document at module load, so importing it from
 * the shape module dragged the PDF engine into the Excel path and made the shape
 * impossible to unit-test outside a browser.
 */

import { exportToPdf } from "@/lib/exportUtils";
import {
  reportStamp, reportFileName, metaRows, esc,
  type StageReport, type ReportMeta, type OverviewReport,
} from "./tdsReport";

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

