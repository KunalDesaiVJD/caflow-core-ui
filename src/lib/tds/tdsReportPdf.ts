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
  type StageReport, type ReportSection, type ReportMeta, type OverviewReport,
} from "./tdsReport";

function tableHtml(rows: Record<string, unknown>[], emptyNote?: string): string {
  if (!rows.length) return `<p class="empty">${esc(emptyNote || "None")}</p>`;
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  return `<table><thead><tr>${cols.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead><tbody>${
    rows.map((r) => `<tr>${cols.map((c) => `<td>${esc(r[c])}</td>`).join("")}</tr>`).join("")
  }</tbody></table>`;
}

/** The base field names Stage 1 compares — recognised STRUCTURALLY from a row's
 *  own keys (an "Office {x}" with a matching "Imported {x}"), never hardcoded,
 *  so a future field Stage 1 adds or renames still gets the compact layout
 *  below with no change here. Stage 2/3's rows carry no such pair and are
 *  unaffected — they already fit a normal table at their own column count. */
function pairedFieldsOf(row: Record<string, unknown>): string[] {
  return Object.keys(row)
    .filter((k) => k.startsWith("Office ") && `Imported ${k.slice(7)}` in row)
    .map((k) => k.slice(7));
}

const RESULT_COLOUR: Record<string, string> = {
  Matched: "#107C41", Mismatched: "#C00000",
  "Missing in Imported File": "#C00000", "Extra in Imported File": "#C00000",
};

/** Which of a row's paired fields to actually show as a diff — driven by the
 *  row's OWN pre-computed "Mismatched Fields" list (the same one Stage 1's own
 *  screen and the Excel export already show), never re-derived by comparing
 *  Office/Imported values here. That comparison is already field-aware
 *  upstream (case-insensitive names, format-tolerant dates, …) — redoing it as
 *  a raw string compare would flag e.g. "JATIN PATEL" vs "Jatin Patel" as a
 *  spurious diff even though nothing about this record is actually wrong. */
const mismatchedFieldsOf = (r: Record<string, unknown>): Set<string> =>
  new Set(String(r["Mismatched Fields"] ?? "").split(",").map((s) => s.trim()).filter(Boolean));

/** An em dash for a genuinely absent value (e.g. the Office side of a record
 *  that exists only in the imported file) — an empty printed cell reads as a
 *  rendering bug, not "no data on this side". */
const dashIfBlank = (v: unknown): string => (v === null || v === undefined || v === "" ? "—" : esc(v));

/** One compact card per record, in place of a table row wide enough (up to 7
 *  Office/Imported field-pairs, 19 columns total) that every cell wrapped onto
 *  several lines — a single mismatch could run 4-5 printed pages on its own.
 *  Shows ONLY the fields actually listed as mismatched, as a tight 3-column
 *  table, so a card is only ever as tall as what it has to explain. */
function pairedRowsHtml(rows: Record<string, unknown>[], fields: string[]): string {
  return rows.map((r) => {
    const mismatched = mismatchedFieldsOf(r);
    const diffFields = fields.filter((f) => mismatched.has(f));
    const result = String(r.Result ?? "");
    const colour = RESULT_COLOUR[result] || "#555";
    return `
      <div class="rec-card">
        <div class="rec-head">
          <b>${esc(r.Record)}</b>
          <span class="badge" style="color:${colour};border-color:${colour};">${esc(result)}</span>
          ${r.Overridden === "Yes" ? `<span class="ov-tag">Overridden</span>` : ""}
        </div>
        ${r.Remarks ? `<p class="remarks">${esc(r.Remarks)}</p>` : ""}
        ${diffFields.length ? `
          <table class="diff">
            <thead><tr><th>Field</th><th>Office</th><th>Imported</th></tr></thead>
            <tbody>${diffFields.map((f) => `<tr><td>${esc(f)}</td><td>${dashIfBlank(r[`Office ${f}`])}</td><td>${dashIfBlank(r[`Imported ${f}`])}</td></tr>`).join("")}</tbody>
          </table>` : ""}
      </div>`;
  }).join("");
}

/** Records where nothing is listed as mismatched (Stage 1's "Matched" section)
 *  need no explanation at all — one row each in a single small table, not one
 *  card each with a "Matched" badge and every field repeated twice for no
 *  reason. */
function cleanRowsHtml(rows: Record<string, unknown>[]): string {
  if (!rows.length) return "";
  return `<table class="clean"><thead><tr><th>Record</th><th>Result</th></tr></thead><tbody>${
    rows.map((r) => `<tr><td>${esc(r.Record)}</td><td>${esc(r.Result)}</td></tr>`).join("")
  }</tbody></table>`;
}

function sectionHtml(sec: ReportSection): string {
  const head = `<h2>${esc(sec.title)} <span class="count">(${sec.rows.length})</span></h2>`;
  if (!sec.rows.length) return `${head}<p class="empty">${esc(sec.emptyNote || "None")}</p>`;
  const fields = pairedFieldsOf(sec.rows[0]);
  if (!fields.length) return `${head}${tableHtml(sec.rows)}`;
  const withDiffs: Record<string, unknown>[] = [];
  const clean: Record<string, unknown>[] = [];
  for (const r of sec.rows) {
    (mismatchedFieldsOf(r).size ? withDiffs : clean).push(r);
  }
  return `${head}${pairedRowsHtml(withDiffs, fields)}${cleanRowsHtml(clean)}`;
}

/** Colour a summary metric BY MEANING — the same rule tdsReportExcel.ts uses
 *  (metricColour there), so a metric never looks "fine" in one export and
 *  "failing" in the other. Matched/Verified green; Mismatched/Issues/Missing
 *  red ONLY when non-zero (a clean "0" is good news, not a warning); Overridden/
 *  Mapped blue (a decision was made, not an error); anything else plain. */
function metricColour(label: string, value: string | number): string {
  const n = typeof value === "number" ? value : Number(value);
  const l = label.toLowerCase();
  if (/matched$|^verified/.test(l) && !/mis/.test(l)) return "#107C41";
  if (/mismatch|issue|missing|extra|unresolved/.test(l)) return Number.isFinite(n) && n > 0 ? "#C00000" : "#107C41";
  if (/overrid|mapped/.test(l)) return "#2F5496";
  return "#111";
}

function cardsHtml(summary: { label: string; value: string | number }[]): string {
  return `<div class="cards">${summary.map((s) =>
    `<div class="card"><div class="v" style="color:${metricColour(s.label, s.value)};">${esc(s.value)}</div><div class="l">${esc(s.label)}</div></div>`,
  ).join("")}</div>`;
}

/** A report's detail tables — one titled block per section. Shared by the
 *  single-stage PDF and the combined Overview PDF so a section never renders
 *  differently (or goes missing) depending on which button produced it. */
function sectionsHtml(report: StageReport): string {
  return report.sections.map(sectionHtml).join("");
}

function notesHtml(notes?: string[]): string {
  return notes?.length ? `<div class="notes"><b>Notes</b><ul>${notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul></div>` : "";
}

/** Build the printable HTML for a report (also used by the Overview). */
export function stageReportHtml(report: StageReport, meta: ReportMeta, generatedAt: string): string {
  return `
    <div class="doc">
      <h1>${esc(report.title)}</h1>
      ${report.subtitle ? `<p class="sub">${esc(report.subtitle)}</p>` : ""}
      <table class="meta">${metaRows(meta, generatedAt).map((m) => `<tr><th>${esc(m.Field)}</th><td>${esc(m.Value)}</td></tr>`).join("")}</table>
      ${cardsHtml(report.summary)}
      ${notesHtml(report.notes)}
      ${sectionsHtml(report)}
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
  .rec-card { border: 1px solid #ddd; border-radius: 4px; padding: 5px 8px; margin: 0 0 5px; page-break-inside: avoid; }
  .rec-head { display: flex; align-items: center; gap: 6px; }
  .rec-head b { font-size: 10px; }
  .badge { font-size: 8px; font-weight: bold; border: 1px solid; border-radius: 8px; padding: 1px 6px; }
  .ov-tag { font-size: 8px; color: #2F5496; background: #eaf0fb; border-radius: 8px; padding: 1px 6px; }
  .remarks { margin: 3px 0; color: #444; font-size: 9px; }
  table.diff { margin: 3px 0 0; }
  table.diff th, table.diff td { padding: 2px 5px; }
  table.diff th:first-child, table.diff td:first-child { width: 90px; }
  table.clean { margin: 4px 0 10px; }
  table.clean td, table.clean th { padding: 2px 5px; }
  .stage-block { page-break-inside: avoid; }
`;

/** Render HTML off-screen and hand the real element to html2pdf, which needs a
 *  laid-out node (it rasterises via html2canvas). Always removed afterwards.
 *
 *  The element passed to html2pdf must NOT itself be `position:fixed` (or
 *  `absolute`). html2pdf.js clones exactly that node and re-parents the clone
 *  inside its OWN wrapper `<div>` (`height:auto`, normal flow) to rasterise it —
 *  cloneNode preserves inline styles, so a fixed/absolute host stays out of that
 *  wrapper's flow and contributes nothing to its height. The wrapper then
 *  measures 0px tall, html2canvas rasterises a 0-height canvas, and jsPDF embeds
 *  no image at all — a "blank"/near-empty PDF (confirmed: an empty `/XObject`
 *  dict, no `Do`/`Tj` operators, ~3KB regardless of the report's real content).
 *  The Excel export is unaffected because it never goes through html2canvas.
 *
 *  Fix: keep `host` itself in normal flow (`position: static`, the default) and
 *  hide it off-screen via a SEPARATE outer `hider` element that is never passed
 *  to html2pdf and therefore never cloned into its wrapper. */
async function printHtml(html: string, filename: string): Promise<void> {
  const hider = document.createElement("div");
  hider.style.cssText = "position:fixed;left:-10000px;top:0;";
  const host = document.createElement("div");
  host.style.cssText = "width:1100px;background:#fff;padding:16px;";
  host.innerHTML = `<style>${REPORT_CSS}</style>${html}`;
  hider.appendChild(host);
  document.body.appendChild(hider);
  try {
    await exportToPdf(host, filename, { orientation: "landscape", format: "a4" });
  } finally {
    hider.remove();
  }
}

export async function exportStagePdf(report: StageReport, meta: ReportMeta): Promise<void> {
  await printHtml(stageReportHtml(report, meta, reportStamp()), reportFileName(meta, report.title, "pdf"));
}

// ── Overview — all three stages in one document ──────────────────────────────

/**
 * `stageReports` carries each RUN stage's real records/reasons — exactly what
 * `buildOverviewWorkbook` receives as its detail sheets (one per stage that ran).
 * Without it the PDF only ever showed the at-a-glance counts, never the actual
 * mismatched/issue rows a CA needs to act on — the Excel export always had both,
 * so the two files disagreed on content, not just layout.
 */
export async function exportOverviewPdf(o: OverviewReport, meta: ReportMeta, stageReports: StageReport[]): Promise<void> {
  const generatedAt = reportStamp();
  const html = `
    <div class="doc">
      <h1>TDS Validation — Overview Report</h1>
      <p class="sub">Stage 1 (data reconciliation) · Stage 2 (PAN verification) · Stage 3 (Tally ledger) · Stage 4 (checker review)</p>
      <table class="meta">${metaRows(meta, generatedAt).map((m) => `<tr><th>${esc(m.Field)}</th><td>${esc(m.Value)}</td></tr>`).join("")}</table>
      ${cardsHtml(o.overall)}
      <h2>Final Validation Status</h2>
      <p style="font-size:13px;font-weight:bold;color:${o.ready ? "#047857" : "#b45309"};margin:2px 0 10px;">${esc(o.finalStatus)}</p>
      ${o.stages.map((s) => `
        <div class="stage-block">
          <h2>${esc(s.title)} <span class="count">— ${esc(s.status)}</span></h2>
          ${s.applicable ? cardsHtml(s.summary) : `<p class="empty">Not applicable for this return — no file imported for this stage.</p>`}
        </div>`).join("")}
      ${stageReports.map((report) => `
        <div class="stage-block">
          <h1 style="font-size:13px;margin-top:18px;padding-top:10px;border-top:2px solid #333;">${esc(report.title)}</h1>
          ${report.subtitle ? `<p class="sub">${esc(report.subtitle)}</p>` : ""}
          ${notesHtml(report.notes)}
          ${sectionsHtml(report)}
        </div>`).join("")}
    </div>`;
  await printHtml(html, reportFileName(meta, "Validation Overview", "pdf"));
}

