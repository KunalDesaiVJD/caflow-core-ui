/**
 * TDS validation reports → a FORMATTED Excel workbook (ExcelJS).
 *
 * Written with ExcelJS, not SheetJS: the `xlsx` community build cannot write cell
 * styles at all, so the previous export came out as bare unstyled rows — no
 * headings, no colours, no borders, no column widths. Anything meant to go to a
 * client, a partner or an auditor has to be presentable, so the whole workbook is
 * built here instead.
 *
 * Layout, per sheet:
 *   ┌ title banner (merged, brand fill)
 *   ├ client / return block (label→value, bordered)
 *   ├ summary strip (Total · Matched · Mismatched · …) with per-metric colour
 *   ├ notes, when the stage has any
 *   └ one bordered, filtered, frozen table per section, with the mismatch reason
 *
 * buildWorkbook() is PURE (no DOM) so the exact workbook the user downloads can be
 * generated and inspected in Node — see scratchpad/xlsxcheck.mjs.
 */

import ExcelJS from "exceljs";
import type { StageReport, ReportMeta, OverviewReport } from "./tdsReport";
import { reportStamp } from "./tdsReport";

const BRAND = "FF1F3864";      // deep navy — title banners
const HEAD = "FF2F5496";       // table header fill
const LABEL = "FFF2F2F2";      // label cells
const OK = "FF107C41";         // green
const BAD = "FFC00000";        // red
const WARN = "FFBF8F00";       // amber
const INFO = "FF2F5496";       // blue
const BORDER: Partial<ExcelJS.Borders> = {
  top: { style: "thin", color: { argb: "FFBFBFBF" } },
  left: { style: "thin", color: { argb: "FFBFBFBF" } },
  bottom: { style: "thin", color: { argb: "FFBFBFBF" } },
  right: { style: "thin", color: { argb: "FFBFBFBF" } },
};

/** Colour a summary metric by what it MEANS, so a reader sees the exceptions
 *  without reading the labels. */
function metricColour(label: string, value: string | number): string {
  const n = typeof value === "number" ? value : Number(value);
  const l = label.toLowerCase();
  if (/matched$|^verified/.test(l) && !/mis/.test(l)) return OK;
  if (/mismatch|issue|missing|extra|unresolved/.test(l)) return Number.isFinite(n) && n > 0 ? BAD : OK;
  if (/overrid|mapped/.test(l)) return INFO;
  return "FF000000";
}

const fill = (argb: string): ExcelJS.Fill => ({ type: "pattern", pattern: "solid", fgColor: { argb } });

/** Title banner across `width` columns. */
function titleBanner(ws: ExcelJS.Worksheet, row: number, width: number, title: string, subtitle?: string): number {
  ws.mergeCells(row, 1, row, width);
  const c = ws.getCell(row, 1);
  c.value = title;
  c.font = { bold: true, size: 14, color: { argb: "FFFFFFFF" } };
  c.fill = fill(BRAND);
  c.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
  ws.getRow(row).height = 24;
  if (subtitle) {
    ws.mergeCells(row + 1, 1, row + 1, width);
    const s = ws.getCell(row + 1, 1);
    s.value = subtitle;
    s.font = { size: 9, italic: true, color: { argb: "FF595959" } };
    s.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
    return row + 2;
  }
  return row + 1;
}

/** Client / return identification — every sheet carries it, so a single printed
 *  page is never ambiguous about which return it describes. */
function metaBlock(ws: ExcelJS.Worksheet, row: number, meta: ReportMeta, generatedAt: string): number {
  const pairs: [string, string][] = [
    ["Client", meta.client],
    ...(meta.tan ? [["TAN", meta.tan] as [string, string]] : []),
    ["Form", meta.form],
    ["Quarter", meta.quarter],
    ["Financial Year", meta.fy],
    ...(meta.status ? [["Filing Status", meta.status] as [string, string]] : []),
    ["Report Generated", generatedAt],
  ];
  let r = row + 1;
  for (const [k, v] of pairs) {
    const kc = ws.getCell(r, 1), vc = ws.getCell(r, 2);
    kc.value = k; kc.font = { bold: true, size: 9 }; kc.fill = fill(LABEL); kc.border = BORDER;
    vc.value = v; vc.font = { size: 9 }; vc.border = BORDER;
    r++;
  }
  return r + 1;
}

/** Total · Matched · Mismatched … as a labelled strip. */
function summaryStrip(ws: ExcelJS.Worksheet, row: number, summary: { label: string; value: string | number }[]): number {
  summary.forEach((s, i) => {
    const c = i + 1;
    const lc = ws.getCell(row, c);
    lc.value = s.label.toUpperCase();
    lc.font = { bold: true, size: 8, color: { argb: "FFFFFFFF" } };
    lc.fill = fill(HEAD);
    lc.alignment = { horizontal: "center" };
    lc.border = BORDER;
    const vc = ws.getCell(row + 1, c);
    vc.value = s.value;
    vc.font = { bold: true, size: 13, color: { argb: metricColour(s.label, s.value) } };
    vc.alignment = { horizontal: "center" };
    vc.border = BORDER;
  });
  ws.getRow(row + 1).height = 20;
  return row + 3;
}

function notesBlock(ws: ExcelJS.Worksheet, row: number, width: number, notes?: string[]): number {
  if (!notes?.length) return row;
  ws.mergeCells(row, 1, row, width);
  const h = ws.getCell(row, 1);
  h.value = "Notes"; h.font = { bold: true, size: 10 };
  let r = row + 1;
  for (const n of notes) {
    ws.mergeCells(r, 1, r, width);
    const c = ws.getCell(r, 1);
    c.value = `• ${n}`;
    c.font = { size: 9, color: { argb: "FF595959" } };
    c.alignment = { wrapText: true, vertical: "top" };
    ws.getRow(r).height = 26;
    r++;
  }
  return r + 1;
}

/** A bordered, auto-filtered table. Returns the next free row. */
function sectionTable(ws: ExcelJS.Worksheet, row: number, title: string, rows: Record<string, unknown>[], emptyNote: string | undefined, width: number): number {
  ws.mergeCells(row, 1, row, width);
  const h = ws.getCell(row, 1);
  h.value = `${title}  (${rows.length})`;
  h.font = { bold: true, size: 11, color: { argb: "FFFFFFFF" } };
  h.fill = fill(rows.length ? HEAD : "FF808080");
  h.alignment = { vertical: "middle", indent: 1 };
  ws.getRow(row).height = 18;
  let r = row + 1;

  if (!rows.length) {
    // An ABSENT section is ambiguous ("none? or not exported?"); an explicit note
    // is not. Always say it plainly.
    ws.mergeCells(r, 1, r, width);
    const c = ws.getCell(r, 1);
    c.value = emptyNote || `No ${title.toLowerCase()} records.`;
    c.font = { size: 9, italic: true, color: { argb: "FF595959" } };
    return r + 2;
  }

  const cols = [...new Set(rows.flatMap((x) => Object.keys(x)))];
  cols.forEach((name, i) => {
    const c = ws.getCell(r, i + 1);
    c.value = name;
    c.font = { bold: true, size: 9, color: { argb: "FFFFFFFF" } };
    c.fill = fill(HEAD);
    c.border = BORDER;
    c.alignment = { vertical: "middle", wrapText: true };
  });
  const headRow = r;
  r++;
  for (const rec of rows) {
    cols.forEach((name, i) => {
      const c = ws.getCell(r, i + 1);
      const v = rec[name];
      c.value = (v === null || v === undefined || v === "") ? "" : (v as ExcelJS.CellValue);
      c.font = { size: 9 };
      c.border = BORDER;
      c.alignment = { vertical: "top", wrapText: /remark|reason|action|note/i.test(name) };
      if (/^result$/i.test(name)) {
        const s = String(v ?? "");
        c.font = { size: 9, bold: true, color: { argb: /^matched$|verified/i.test(s) ? OK : /not found|invalid|inoperative|amount/i.test(s) ? BAD : WARN } };
      }
    });
    r++;
  }
  ws.autoFilter = { from: { row: headRow, column: 1 }, to: { row: r - 1, column: cols.length } };
  return r + 1;
}

/**
 * Width per column, from the CELLS THAT ACTUALLY SIT IN IT.
 *
 * Merged cells are skipped: a banner merged across every column carries the whole
 * title string in each of them, so measuring it made every column as wide as the
 * title — which is how the first cut came out with nine identical 46-char columns.
 */
function autoWidth(ws: ExcelJS.Worksheet, max = 60): void {
  ws.columns.forEach((col) => {
    let w = 10;
    col.eachCell?.({ includeEmpty: false }, (cell) => {
      if (cell.isMerged) return;
      // A wrapped cell doesn't need a column as wide as its text.
      const raw = String(cell.value ?? "");
      const len = cell.alignment?.wrapText ? Math.min(raw.length, 48) : raw.length;
      if (len > w) w = len;
    });
    col.width = Math.min(Math.max(w + 2, 10), max);
  });
}

function writeStageSheet(wb: ExcelJS.Workbook, report: StageReport, meta: ReportMeta, generatedAt: string, sheetName: string): void {
  const ws = wb.addWorksheet(sheetName.slice(0, 31), { views: [{ showGridLines: false }] });
  const width = Math.max(6, ...report.sections.map((s) => [...new Set(s.rows.flatMap((x) => Object.keys(x)))].length));
  let r = titleBanner(ws, 1, width, report.title, report.subtitle);
  r = metaBlock(ws, r, meta, generatedAt);
  r = summaryStrip(ws, r, report.summary);
  r = notesBlock(ws, r, width, report.notes);
  for (const sec of report.sections) r = sectionTable(ws, r, sec.title, sec.rows, sec.emptyNote, width);
  autoWidth(ws);
  ws.views = [{ state: "frozen", ySplit: 0, showGridLines: false }];
}

/** One stage → a formatted single-sheet workbook. */
export function buildStageWorkbook(report: StageReport, meta: ReportMeta): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  wb.creator = "CAFlow";
  wb.created = new Date();
  writeStageSheet(wb, report, meta, reportStamp(), report.title);
  return wb;
}

/**
 * The full Overview: an Overview sheet PLUS a detail sheet per stage.
 *
 * `stageReports` carries each stage's real rows. Without them the overview could
 * only restate counts — which is what made the first version useless: it had no
 * records and no mismatch reasons, so nothing in it could be acted on.
 */
export function buildOverviewWorkbook(o: OverviewReport, meta: ReportMeta, stageReports: StageReport[]): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  wb.creator = "CAFlow";
  wb.created = new Date();
  const generatedAt = reportStamp();
  const ws = wb.addWorksheet("Overview", { views: [{ showGridLines: false }] });
  const W = 9;

  let r = titleBanner(ws, 1, W, "TDS Validation — Overview Report",
    "Stage 1 (data reconciliation) · Stage 2 (PAN verification) · Stage 3 (Tally ledger reconciliation)");
  r = metaBlock(ws, r, meta, generatedAt);
  r = summaryStrip(ws, r, o.overall);

  // Final status — the one line a partner or auditor reads first.
  ws.mergeCells(r, 1, r, W);
  const fs = ws.getCell(r, 1);
  fs.value = `Final Validation Status:  ${o.finalStatus}`;
  fs.font = { bold: true, size: 11, color: { argb: "FFFFFFFF" } };
  fs.fill = fill(o.ready ? OK : WARN);
  fs.alignment = { vertical: "middle", indent: 1 };
  ws.getRow(r).height = 20;
  r += 2;

  // Stage-wise summary — FIXED columns. The first version unioned each stage's own
  // labels, so every row had blanks under the other stages' metrics.
  const cols = ["Stage", "Applicable", "Run", "Total", "Matched / Verified", "Mismatched / Issues", "Overridden", "Status"];
  cols.forEach((name, i) => {
    const c = ws.getCell(r, i + 1);
    c.value = name;
    c.font = { bold: true, size: 9, color: { argb: "FFFFFFFF" } };
    c.fill = fill(HEAD); c.border = BORDER; c.alignment = { vertical: "middle", wrapText: true };
  });
  const headRow = r;
  r++;
  // NB: `pick` returns undefined when the metric is absent — NOT "". A count of 0
  // is a real, meaningful value ("nothing mismatched"), and `a || b` treats it as
  // falsy, which blanked every zero — precisely the all-clear case a reader most
  // wants to see stated.
  const pick = (s: OverviewStageLike, re: RegExp): string | number | undefined =>
    s.summary.find((x) => re.test(x.label.toLowerCase()))?.value;
  const firstOf = (...vals: (string | number | undefined)[]): string | number =>
    vals.find((v) => v !== undefined && v !== "") ?? "";
  for (const s of o.stages) {
    const vals: (string | number)[] = [
      s.title,
      s.applicable ? "Yes" : "No",
      s.ran ? "Yes" : "No",
      s.applicable ? firstOf(pick(s, /^total$/)) : "—",
      s.applicable ? firstOf(pick(s, /^matched$/), pick(s, /^verified$/)) : "—",
      s.applicable ? firstOf(pick(s, /^mismatched$/), pick(s, /^issues$/)) : "—",
      s.applicable ? firstOf(pick(s, /^overrid/)) : "—",
      s.status,
    ];
    vals.forEach((v, i) => {
      const c = ws.getCell(r, i + 1);
      c.value = v as ExcelJS.CellValue;
      c.font = { size: 9, bold: i === 0 };
      c.border = BORDER;
      c.alignment = { vertical: "middle", wrapText: i === 0 || i === 7 };
      if (i === 7) c.font = { size: 9, bold: true, color: { argb: /complete/i.test(String(v)) ? OK : /not applicable/i.test(String(v)) ? "FF808080" : /not run/i.test(String(v)) ? WARN : BAD } };
      if (i === 5 && Number(v) > 0) c.font = { size: 9, bold: true, color: { argb: BAD } };
    });
    r++;
  }
  ws.autoFilter = { from: { row: headRow, column: 1 }, to: { row: r - 1, column: cols.length } };
  autoWidth(ws, 46);

  // Detail sheet per stage — where the actual records and reasons live.
  for (const sr of stageReports) writeStageSheet(wb, sr, meta, generatedAt, sr.title.replace(/^Stage (\d).*/, "Stage $1 Detail"));
  return wb;
}

type OverviewStageLike = { summary: { label: string; value: string | number }[] };

/** Push an ExcelJS workbook to the browser as a download. */
export async function downloadWorkbook(wb: ExcelJS.Workbook, filename: string): Promise<void> {
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}
