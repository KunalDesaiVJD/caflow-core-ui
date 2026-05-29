/**
 * excel — per-clause Excel round-trip for Form 3CD table clauses.
 *
 * Export writes a clause table to an .xlsx the CA can edit offline; import
 * validates the edited sheet back against the clause's column schema and
 * returns clean rows + a diff summary the UI shows before committing.
 *
 * 100% client-side (SheetJS, already a dependency). Does NOT touch the
 * protected `export_tax_audit` edge function.
 */

import * as XLSX from "xlsx";
import type { AnnexureColumn } from "@/data/form3cd-master";
import { DROPDOWN_LIBRARY, BUSINESS_SECTORS, BUSINESS_SUBSECTORS } from "@/data/form3cd-dropdowns";

const SCHEMA_VERSION = 1;

/** Header text: human label plus a machine-stable [key] suffix for re-import. */
function headerFor(col: AnnexureColumn): string {
  return `${col.label} [${col.key}]`;
}

/** Extract the [key] from a header cell, falling back to label match. */
function keyFromHeader(header: string, columns: AnnexureColumn[]): string | null {
  const m = String(header || "").match(/\[([a-zA-Z0-9_]+)\]\s*$/);
  if (m && columns.some((c) => c.key === m[1])) return m[1];
  const byLabel = columns.find((c) => c.label.trim().toLowerCase() === String(header || "").trim().toLowerCase());
  return byLabel ? byLabel.key : null;
}

function dropdownValues(col: AnnexureColumn): Set<string> | null {
  if (col.type !== "dropdown") return null;
  let opts: { value: string }[] = [];
  if (col.dropdownRef && DROPDOWN_LIBRARY[col.dropdownRef]) opts = DROPDOWN_LIBRARY[col.dropdownRef];
  else if (col.options) opts = col.options;
  else if (col.key === "sector") opts = BUSINESS_SECTORS;
  else if (col.key === "sub_sector") {
    // sub_sector options are sector-dependent; accept any known sub-sector value
    const all = Object.values(BUSINESS_SUBSECTORS).flat();
    return new Set(all.map((o) => o.value));
  }
  if (!opts.length) return null;
  return new Set(opts.map((o) => o.value));
}

function toDateString(v: any): string {
  if (v == null || v === "") return "";
  if (v instanceof Date && !isNaN(v.getTime())) {
    const y = v.getFullYear();
    const m = String(v.getMonth() + 1).padStart(2, "0");
    const d = String(v.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  const s = String(v).trim();
  // already ISO-ish
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  // dd/mm/yyyy or dd-mm-yyyy
  const m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return s;
}

export interface ExportTableSpec {
  sheetName: string;
  columns: AnnexureColumn[];
  rows: Record<string, any>[];
}

/** Export one or more clause tables to a downloadable .xlsx. */
export function exportClauseToXlsx(opts: {
  fileName: string;
  clauseNo: string;
  engagementId: string;
  tables: ExportTableSpec[];
}): void {
  const wb = XLSX.utils.book_new();

  // Hidden meta sheet for re-import validation.
  const meta = {
    schemaVersion: SCHEMA_VERSION,
    clauseNo: opts.clauseNo,
    engagementId: opts.engagementId,
    exportedAt: new Date().toISOString(),
    tables: opts.tables.map((t) => ({ sheetName: t.sheetName, keys: t.columns.map((c) => c.key) })),
  };
  const metaWs = XLSX.utils.aoa_to_sheet([["__FORM3CD_META__"], [JSON.stringify(meta)]]);
  XLSX.utils.book_append_sheet(wb, metaWs, "_meta");

  const usedNames = new Set<string>(["_meta"]);
  /** Excel sheet names: max 31 chars, no \/?*[]: , and must be unique. */
  function uniqueSheetName(raw: string, idx: number): string {
    let base = (raw || `Sheet ${idx + 1}`).replace(/[\\/?*[\]:]/g, " ").slice(0, 31).trim() || `Sheet ${idx + 1}`;
    if (!usedNames.has(base)) { usedNames.add(base); return base; }
    for (let n = 2; n < 1000; n++) {
      const suffix = ` (${n})`;
      const candidate = base.slice(0, 31 - suffix.length) + suffix;
      if (!usedNames.has(candidate)) { usedNames.add(candidate); return candidate; }
    }
    return base.slice(0, 27) + ` ${idx}`;
  }

  opts.tables.forEach((t, idx) => {
    const header = t.columns.map(headerFor);
    const body = t.rows.map((r) => t.columns.map((c) => {
      const v = r[c.key];
      return v == null ? "" : v;
    }));
    const ws = XLSX.utils.aoa_to_sheet([header, ...body]);
    ws["!cols"] = t.columns.map((c) => ({ wch: Math.max(12, Math.min(48, Math.round((c.minWidth || c.width || 120) / 7))) }));
    XLSX.utils.book_append_sheet(wb, ws, uniqueSheetName(t.sheetName, idx));
  });

  XLSX.writeFile(wb, opts.fileName.endsWith(".xlsx") ? opts.fileName : `${opts.fileName}.xlsx`);
}

export interface ParseResult {
  rows: Record<string, any>[];
  errors: string[];
  warnings: string[];
  /** clauseNo recorded in the file's _meta sheet, if present */
  metaClauseNo?: string;
}

/**
 * Parse the first data sheet of an uploaded workbook into validated rows for a
 * given column schema. Auto_calc and readonly(except sr_no) columns are
 * ignored on import — the renderer recomputes them.
 */
export async function parseClauseXlsx(file: File, columns: AnnexureColumn[]): Promise<ParseResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array", cellDates: true });

  let metaClauseNo: string | undefined;
  if (wb.SheetNames.includes("_meta")) {
    try {
      const metaAoa = XLSX.utils.sheet_to_json<any[]>(wb.Sheets["_meta"], { header: 1, raw: true });
      const json = JSON.parse(String(metaAoa?.[1]?.[0] ?? "{}"));
      metaClauseNo = json?.clauseNo;
    } catch { /* ignore malformed meta */ }
  }

  // Pick the sheet whose header row best matches THIS clause table's columns
  // (a multi-table export has several sheets — import the right one).
  let bestSheet: string | null = null;
  let bestScore = 0;
  let bestAoa: any[][] = [];
  for (const name of wb.SheetNames) {
    if (name === "_meta") continue;
    const aoa = XLSX.utils.sheet_to_json<any[]>(wb.Sheets[name], { header: 1, raw: true, defval: "" });
    if (!aoa.length) continue;
    const hdr = aoa[0] as any[];
    const score = hdr.map((h) => keyFromHeader(String(h), columns)).filter(Boolean).length;
    if (score > bestScore) { bestScore = score; bestSheet = name; bestAoa = aoa; }
  }
  if (!bestSheet) {
    return { rows: [], errors: ["No data sheet found in the workbook."], warnings, metaClauseNo };
  }
  if (bestScore === 0) {
    return { rows: [], errors: ["No column headers matched this clause. Did you upload the exported template for this table?"], warnings, metaClauseNo };
  }
  const aoa = bestAoa;
  const headerRow = aoa[0] as any[];
  const colByIndex: (string | null)[] = headerRow.map((h) => keyFromHeader(String(h), columns));

  const colByKey = new Map(columns.map((c) => [c.key, c]));
  const importableKeys = new Set(
    columns
      .filter((c) => c.type !== "auto_calc" && !(c.type === "readonly" && c.key !== "sr_no"))
      .map((c) => c.key),
  );

  const rows: Record<string, any>[] = [];
  for (let r = 1; r < aoa.length; r++) {
    const raw = aoa[r] as any[];
    if (!raw || raw.every((v) => v == null || String(v).trim() === "")) continue; // skip blank lines
    const out: Record<string, any> = {};
    let hasValue = false;

    colByIndex.forEach((key, idx) => {
      if (!key || !importableKeys.has(key)) return;
      const col = colByKey.get(key)!;
      let val: any = raw[idx];
      if (val == null) val = "";

      switch (col.type) {
        case "numeric": {
          if (val === "" || val == null) { out[key] = ""; break; }
          const num = typeof val === "number" ? val : Number(String(val).replace(/[, ₹]/g, ""));
          if (isNaN(num)) {
            errors.push(`Row ${r + 1}, "${col.label}": "${val}" is not a number.`);
            out[key] = "";
          } else {
            out[key] = num;
            hasValue = true;
          }
          break;
        }
        case "date": {
          out[key] = toDateString(val);
          if (out[key]) hasValue = true;
          break;
        }
        case "pan": {
          const pan = String(val).toUpperCase().trim();
          out[key] = pan;
          if (pan && !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan)) {
            warnings.push(`Row ${r + 1}, "${col.label}": "${pan}" is not a valid PAN format.`);
          }
          if (pan) hasValue = true;
          break;
        }
        case "dropdown": {
          const s = String(val).trim();
          out[key] = s;
          const allowed = dropdownValues(col);
          if (s && allowed && !allowed.has(s)) {
            warnings.push(`Row ${r + 1}, "${col.label}": "${s}" is not in the allowed list — kept as-is, please verify.`);
          }
          if (s) hasValue = true;
          break;
        }
        case "yes_no_dropdown": {
          const s = String(val).trim().toUpperCase();
          out[key] = s === "YES" || s === "Y" ? "Y" : s === "NO" || s === "N" ? "N" : s;
          if (out[key]) hasValue = true;
          break;
        }
        default: {
          const s = typeof val === "number" ? String(val) : String(val).trim();
          out[key] = s;
          if (s) hasValue = true;
        }
      }
    });

    if (!hasValue) continue;
    rows.push(out);
  }

  // Renumber sr_no readonly column if present.
  const srCol = columns.find((c) => c.key === "sr_no" && c.type === "readonly");
  if (srCol) rows.forEach((row, i) => { row.sr_no = String(i + 1); });

  return { rows, errors, warnings, metaClauseNo };
}
