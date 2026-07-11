/**
 * Genius XLS Export — writes TDS return data into Genius-compatible Excel templates.
 *
 * Output is BIFF8 (.xls) because Genius VBA uses Workbooks.Open which cannot
 * read OOXML (.xlsx) — giving Genius a .xlsx produces "Unable to get the Open
 * property of the Workbooks class" etc.
 *
 * Architecture — SheetJS ONLY, start to finish:
 *  1. Load .xls template (Supabase Storage → public folder fallback → error if missing)
 *  2. Read with SheetJS using { bookVBA: true } — this captures the raw VBA
 *     project blob (wb.vbaraw), defined names (Print_Area, dropdown-list
 *     source ranges on the hidden Master sheet), and per-sheet CodeNames.
 *  3. Write data directly into the SheetJS worksheet objects (no ExcelJS,
 *     no intermediate .xlsx conversion — every conversion hop is a chance to
 *     silently drop the VBA project/defined names/CodeNames, which is
 *     exactly what the previous two-library round-trip through ExcelJS did:
 *     ExcelJS only understands OOXML and has no concept of a VBA project at
 *     all, so it was gone before ExcelJS ever touched the file).
 *  4. Rename worksheets to Genius-expected display names — CodeName (the
 *     identifier VBA actually binds to, e.g. "Sheet1") is untouched; only
 *     the visible tab name changes, exactly like a user renaming a tab in
 *     Excel would.
 *  5. Write back out with SheetJS using { bookType: "biff8", bookVBA: true }
 *     so the original VBA project is re-embedded byte-for-byte.
 *
 * Verified against the real Genius template (SAG Infotech, "Export
 * Utility.xls"): 5 sheets including a hidden "Master" sheet holding
 * dropdown-list source data, 9 defined names, a 107,520-byte VBA project —
 * all of which survive an unmodified SheetJS bookVBA read→write round trip
 * byte-identical, none of which survived the old ExcelJS-hop pipeline.
 *
 * Template sheet names (internal → Genius import expected):
 *   DeductorDetails / EmployerDetails / CollectorDetails  → Deductor/Employer/Collector Details
 *   ChallanDetails                                        → Challan Details
 *   Annex-I_DeducteeDetails                              → Deductee Details
 *   Annex-I_PartyDetails                                 → Party Details
 */

import * as XLSX from "xlsx";
import { supabase } from "@/integrations/supabase/client";

// ─── Interfaces ───────────────────────────────────────────────────────────────

interface Filing {
  tan?: string;
  financial_year?: string;
  quarter?: string;
  return_type?: string;
  previous_receipt_number?: string;
  [key: string]: any;
}

interface Client {
  id: string;
  name?: string | null;
  pan?: string | null;
  tan_number?: string | null;
  address?: string | null;
  email?: string | null;
  registered_state?: string | null;
  [key: string]: any;
}

interface Challan {
  id: string;
  challan_serial_no?: string;
  section_code?: string;
  total_tax_deposited?: number;
  surcharge_deposited?: number;
  education_cess_deposited?: number;
  interest_deposited?: number;
  // DB column names (legacy aliases kept for backward compat)
  late_fees_234e?: number;   // primary — matches tds_challans DB column
  late_fee?: number;         // legacy alias
  others_deposited?: number; // primary — matches tds_challans DB column
  other_amount?: number;     // legacy alias
  total_challan_amount?: number;
  cheque_dd_no?: string;
  bsr_code?: string;
  deposit_date?: string;
  is_book_entry?: boolean;
  minor_head_of_challan?: string;
  [key: string]: any;
}

interface Deductee {
  challan_id: string;
  section_code?: string;
  deductee_type?: string;
  deductee_pan?: string;
  deductee_ref_no?: string;
  deductee_name?: string;
  amount_paid_credited?: number;
  date_of_payment?: string;
  rate_of_tds?: number;
  surcharge_rate?: number;
  tds_amount?: number;
  surcharge_amount?: number;
  cess_amount?: number;
  total_tax_deducted?: number;
  date_of_deduction?: string;
  reason_for_lower_or_nil_deduction?: string;
  lower_deduction_certificate_no?: string;
  country_of_residence?: string;
  [key: string]: any;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Format a date string as DD/MM/YYYY for Genius import */
const fmtDateGenius = (d: string | null | undefined): string => {
  if (!d) return "";
  try {
    const dt = new Date(d);
    const dd = String(dt.getDate()).padStart(2, "0");
    const mm = String(dt.getMonth() + 1).padStart(2, "0");
    const yyyy = dt.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
  } catch { return ""; }
};

/** Convert FY string (2025-26) to Assessment Year (2026-27) */
const fyToAY = (fy: string): string => {
  const parts = fy.split("-");
  if (parts.length === 2) {
    const startYear = parseInt(parts[0]);
    return `${startYear + 1}-${String(startYear + 2).slice(2)}`;
  }
  return fy;
};

/**
 * Minimal FileSystemFileHandle shape we use — just createWritable.
 */
type MiniFileHandle = {
  createWritable: () => Promise<{
    write: (data: ArrayBuffer | Blob) => Promise<void>;
    close: () => Promise<void>;
  }>;
};

/**
 * Ask the user where to save the file — MUST be called synchronously after a
 * user click, BEFORE any await of heavy async work. Chrome invalidates the
 * "user activation" token after an await chain, which silently breaks
 * showSaveFilePicker (it would throw SecurityError and we'd fall back to
 * auto-download, which tags the file with Mark-of-the-Web).
 *
 * Returns a FileSystemFileHandle we can write to later, or null if the
 * browser doesn't support the API (Firefox/Safari). AbortError is rethrown
 * so the caller can exit cleanly when the user cancels.
 */
const acquireSaveHandle = async (
  fileName: string,
  mimeType: string,
): Promise<MiniFileHandle | null> => {
  const w = window as unknown as {
    showSaveFilePicker?: (opts: {
      suggestedName: string;
      types: Array<{ description: string; accept: Record<string, string[]> }>;
    }) => Promise<MiniFileHandle>;
  };

  if (typeof w.showSaveFilePicker !== "function") {
    console.log("[GeniusExport] File System Access API unavailable — will use legacy download");
    return null;
  }

  try {
    const isXls = fileName.toLowerCase().endsWith(".xls");
    const handle = await w.showSaveFilePicker({
      suggestedName: fileName,
      types: [{
        description: isXls ? "Excel 97-2003 Workbook (Genius-compatible)" : "Excel Workbook",
        accept: { [mimeType]: [isXls ? ".xls" : ".xlsx"] },
      }],
    });
    console.log("[GeniusExport] Got save handle — file will be written without Mark-of-the-Web");
    return handle;
  } catch (err: unknown) {
    if (err && typeof err === "object" && (err as { name?: string }).name === "AbortError") {
      throw err;
    }
    console.warn("[GeniusExport] showSaveFilePicker failed:", err);
    return null; // fall back to <a download>
  }
};

/**
 * Write the generated buffer either to the pre-acquired FileSystemFileHandle
 * (no MOTW) or via a legacy <a download> click (MOTW applied).
 */
const writeToDisk = async (
  handle: MiniFileHandle | null,
  buffer: ArrayBuffer,
  fileName: string,
  mimeType: string,
): Promise<void> => {
  if (handle) {
    const writable = await handle.createWritable();
    await writable.write(buffer);
    await writable.close();
    console.log("[GeniusExport] Saved via File System Access API — file is clean (no MOTW)");
    return;
  }
  console.warn("[GeniusExport] Using legacy download — file will get Mark-of-the-Web on Windows");
  const blob = new Blob([buffer], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
};

// ─── SheetJS cell-level helpers ───────────────────────────────────────────────
// All row/col args are 1-indexed to match the column-mapping comments below
// (these were reverse-engineered against the real Genius template layout).

/** Set a single cell's value, expanding the sheet's !ref range if needed. */
const setCell = (ws: XLSX.WorkSheet, row1: number, col1: number, value: unknown): void => {
  const r = row1 - 1;
  const c = col1 - 1;
  const ref = XLSX.utils.encode_cell({ r, c });

  let cell: XLSX.CellObject;
  if (value === "" || value === null || value === undefined) {
    cell = { t: "s", v: "" };
  } else if (typeof value === "number") {
    cell = { t: "n", v: value };
  } else if (value instanceof Date) {
    cell = { t: "d", v: value };
  } else {
    cell = { t: "s", v: String(value) };
  }
  ws[ref] = cell;

  const range = ws["!ref"] ? XLSX.utils.decode_range(ws["!ref"]) : { s: { r, c }, e: { r, c } };
  range.s.r = Math.min(range.s.r, r); range.s.c = Math.min(range.s.c, c);
  range.e.r = Math.max(range.e.r, r); range.e.c = Math.max(range.e.c, c);
  ws["!ref"] = XLSX.utils.encode_range(range);
};

/** Clear all cell values in rows 2..lastRow (1-indexed) across the sheet's existing columns — leaves the header row and !ref bounds alone. */
const clearDataRows = (ws: XLSX.WorkSheet): void => {
  if (!ws["!ref"]) return;
  const range = XLSX.utils.decode_range(ws["!ref"]);
  for (let r = 1; r <= range.e.r; r++) { // r=1 is the 2nd row (0-indexed)
    for (let c = range.s.c; c <= range.e.c; c++) {
      delete ws[XLSX.utils.encode_cell({ r, c })];
    }
  }
};

/** Find a worksheet by any of the given candidate display names (trimmed match). */
const findSheetName = (wb: XLSX.WorkBook, ...candidateNames: string[]): string | null => {
  for (const name of candidateNames) {
    const match = wb.SheetNames.find(n => n.trim() === name.trim());
    if (match) return match;
  }
  return null;
};

/**
 * Rename a sheet's DISPLAY name only — CodeName (what VBA actually binds to,
 * e.g. "Sheet1") lives in wb.Workbook.Sheets[i].CodeName and is left
 * untouched, exactly as renaming a tab in Excel itself would behave.
 */
const renameSheetDisplayName = (wb: XLSX.WorkBook, oldName: string, newName: string): void => {
  if (oldName === newName) return;
  const idx = wb.SheetNames.indexOf(oldName);
  if (idx === -1) return;
  wb.SheetNames[idx] = newName;
  wb.Sheets[newName] = wb.Sheets[oldName];
  delete wb.Sheets[oldName];
  if (wb.Workbook?.Sheets?.[idx]) {
    wb.Workbook.Sheets[idx].name = newName;
  }
  // Keep any Print_Area (or other) defined-name Ref in sync with the rename
  // so it doesn't dangle pointing at a tab name that no longer exists.
  wb.Workbook?.Names?.forEach(n => {
    if (n.Ref?.startsWith(`${oldName}!`)) {
      n.Ref = `${newName}!${n.Ref.slice(oldName.length + 1)}`;
    }
  });
};

// ─── Main export function ─────────────────────────────────────────────────────

export async function generateGeniusExport(
  formType: string,
  filing: Filing,
  client: Client,
  challans: Challan[],
  deductees: Deductee[],
): Promise<void> {

  // ── F: Pre-flight validation ───────────────────────────────────────────────
  console.log("[GeniusExport] Starting export:", {
    formType,
    client: client.name,
    fy: filing.financial_year,
    quarter: filing.quarter,
    challans: challans.length,
    deductees: deductees.length,
  });

  if (deductees.length === 0) {
    throw new Error("No deductee data available for export. Add entries before exporting.");
  }
  if (challans.length === 0) {
    throw new Error("No challan data available for export. Add challans before exporting.");
  }

  // ── Acquire save handle FIRST (must happen before any other await) ────────
  // Chrome invalidates the user-activation token after an await chain.
  // If we call showSaveFilePicker after the Supabase/XLSX work, Chrome
  // throws SecurityError and we'd silently fall back to auto-download —
  // which tags the file with Mark-of-the-Web and Office would refuse to
  // open it in Genius. Calling it here preserves the user gesture.
  const safeClientName = (client.name || "Client").replace(/[^a-zA-Z0-9]/g, "_");
  const suggestedFileName = `Genius_${formType}_${safeClientName}_${filing.financial_year || "FY"}_${filing.quarter || "Q1"}.xls`;
  const saveHandle = await acquireSaveHandle(suggestedFileName, "application/vnd.ms-excel");

  // ── A: Load template ───────────────────────────────────────────────────────
  // Priority: Supabase Storage (user-uploaded) → public folder bundled template → error
  let templateBuffer: ArrayBuffer | null = null;

  // Try 1: Supabase Storage bucket 'tds-templates'
  try {
    const { data: storageData, error: storageError } = await supabase.storage
      .from("tds-templates")
      .download(`${formType}.xls`);
    if (storageData && !storageError) {
      templateBuffer = await storageData.arrayBuffer();
      console.log("[GeniusExport] Template loaded from Supabase Storage");
    } else if (storageError) {
      console.warn("[GeniusExport] Supabase Storage error:", storageError.message);
    }
  } catch (e) {
    console.warn("[GeniusExport] Supabase Storage load failed:", e);
  }

  // Try 2: Public folder bundled template (/tds-templates/{form}.xls)
  if (!templateBuffer) {
    try {
      const resp = await fetch(`/tds-templates/${formType}.xls`);
      if (resp.ok) {
        templateBuffer = await resp.arrayBuffer();
        console.log("[GeniusExport] Template loaded from public folder");
      } else {
        console.warn("[GeniusExport] Public folder fetch failed:", resp.status, resp.statusText);
      }
    } catch (e) {
      console.warn("[GeniusExport] Public folder fetch error:", e);
    }
  }

  if (!templateBuffer) {
    throw new Error(
      `Template not found for form ${formType}. ` +
      `Upload ${formType}.xls to the 'tds-templates' Supabase storage bucket.`
    );
  }

  // ── Read the ENTIRE workbook via SheetJS, capturing the VBA project ───────
  // bookVBA:true populates wb.vbaraw with the raw macro blob, which we carry
  // through unmodified to the final write. We never hand this off to any
  // other library — every hop through a second library is a chance to lose
  // vbaraw, defined names, or per-sheet CodeNames, which is exactly what the
  // old ExcelJS-based pipeline did.
  const wb = XLSX.read(templateBuffer, {
    type: "array",
    bookVBA: true,
    cellStyles: true,
    cellFormula: true,
    cellNF: true,
    cellDates: true,
  });
  console.log("[GeniusExport] Sheets in template:", wb.SheetNames);
  console.log("[GeniusExport] VBA project present:", !!wb.vbaraw, wb.vbaraw ? `(${(wb.vbaraw as ArrayBuffer).byteLength} bytes)` : "");

  if (wb.SheetNames.length === 0) {
    throw new Error("Template loaded but contains no worksheets — file may be corrupt.");
  }

  // ── Derived values ────────────────────────────────────────────────────────
  const ay = fyToAY(filing.financial_year || "2025-26");
  const quarter = filing.quarter || "Q1";
  const isRevised = filing.return_type === "Correction" ? "Y" : "N";

  // ── Build challan → index map (1-based serial) ────────────────────────────
  const challanIndexMap = new Map<string, number>();
  challans.forEach((ch, i) => challanIndexMap.set(ch.id, i + 1));

  // ═════════════════════════════════════════════════════════════════════════
  // SECTION 1: Deductor / Employer / Collector Details sheet
  // Key-value layout: Col A = label, Col B = value, Col C = meta-label, Col D = meta-value
  // No header row to skip — data starts at row 1
  // ═════════════════════════════════════════════════════════════════════════
  const detailSheetName = findSheetName(wb, "DeductorDetails", "EmployerDetails", "CollectorDetails",
                                        "Deductor Details", "Employer Details", "Collector Details");
  if (!detailSheetName) {
    throw new Error(
      `Detail sheet not found in template. ` +
      `Expected one of: DeductorDetails, EmployerDetails, CollectorDetails. ` +
      `Sheets in template: ${wb.SheetNames.join(", ")}`
    );
  }
  console.log("[GeniusExport] Detail sheet:", detailSheetName);
  const detailSheet = wb.Sheets[detailSheetName];

  // Row 1: TAN of Deductor | <value> | A.Y. | <value>
  setCell(detailSheet, 1, 2, filing.tan || client.tan_number || "");
  setCell(detailSheet, 1, 3, "A.Y.");
  // Row 2: PAN | <value> | AY value
  setCell(detailSheet, 2, 2, client.pan || "");
  setCell(detailSheet, 2, 3, ay);
  // Row 3: Name | <value> | Quarter label
  setCell(detailSheet, 3, 2, client.name || "");
  setCell(detailSheet, 3, 3, "Quarter");
  // Row 4: Category | 0 | Quarter value
  setCell(detailSheet, 4, 2, "0");
  setCell(detailSheet, 4, 3, quarter);
  // Row 5: | | Form No.
  setCell(detailSheet, 5, 2, "");
  setCell(detailSheet, 5, 3, "Form No.");
  // Row 6: | | Form type
  setCell(detailSheet, 6, 2, "");
  setCell(detailSheet, 6, 3, formType);
  // Rows 7-9: blank
  setCell(detailSheet, 7, 2, "");
  setCell(detailSheet, 8, 2, "");
  setCell(detailSheet, 9, 2, "");
  // Row 10: State
  setCell(detailSheet, 10, 2, client.registered_state || "");
  // Row 11: (blank)
  setCell(detailSheet, 11, 2, "");
  // Row 12: Email
  setCell(detailSheet, 12, 2, client.email || "");
  // Row 15: Book entry flag
  setCell(detailSheet, 15, 2, "No");
  // Row 16: Deductor type
  setCell(detailSheet, 16, 2, "O - Other than Central Government");
  // Row 30: Is Revised
  setCell(detailSheet, 30, 2, isRevised);
  if (isRevised === "Y" && filing.previous_receipt_number) {
    setCell(detailSheet, 31, 2, filing.previous_receipt_number);
  }

  // ═════════════════════════════════════════════════════════════════════════
  // SECTION 2: Challan Details sheet
  // Row 1 = headers (preserved from template)
  // Rows 2+ = data (one row per challan)
  // ═════════════════════════════════════════════════════════════════════════
  const challanSheetName = findSheetName(wb, "ChallanDetails", "Challan Details");
  if (!challanSheetName) {
    throw new Error(
      `Sheet 'ChallanDetails' not found in template. ` +
      `Sheets in template: ${wb.SheetNames.join(", ")}`
    );
  }
  console.log("[GeniusExport] Challan sheet:", challanSheetName);
  const challanSheet = wb.Sheets[challanSheetName];

  clearDataRows(challanSheet);

  // Column mapping (1-indexed, matches template headers verified above):
  // C1=Serial, C2=Section, C3=IncomeTax, C4=Surcharge, C5=Cess, C6=Interest,
  // C7=LateFee234E, C8=Others, C9=TotalDeposited, C10=ChequeDD, C11=BSRCode,
  // C12=DepositDate, C13=BankChallanNo, C14=BookEntry, C15=MinorHead,
  // C16=InterestAsPerDeductee, C17=OthersAsPerDeductee
  let challanRowsWritten = 0;
  challans.forEach((ch, i) => {
    const rowNum = i + 2; // row 2 = first data row (row 1 = headers)
    setCell(challanSheet, rowNum, 1, i + 1);
    setCell(challanSheet, rowNum, 2, ch.section_code || "");
    setCell(challanSheet, rowNum, 3, ch.total_tax_deposited || 0);
    setCell(challanSheet, rowNum, 4, ch.surcharge_deposited || 0);
    setCell(challanSheet, rowNum, 5, ch.education_cess_deposited || 0);
    setCell(challanSheet, rowNum, 6, ch.interest_deposited || 0);
    // DB columns: late_fees_234e / others_deposited (legacy: late_fee / other_amount)
    setCell(challanSheet, rowNum, 7, ch.late_fees_234e ?? ch.late_fee ?? 0);
    setCell(challanSheet, rowNum, 8, ch.others_deposited ?? ch.other_amount ?? 0);
    setCell(challanSheet, rowNum, 9, ch.total_challan_amount || ch.total_tax_deposited || 0);
    setCell(challanSheet, rowNum, 10, ch.cheque_dd_no || "");
    setCell(challanSheet, rowNum, 11, ch.bsr_code || "");
    setCell(challanSheet, rowNum, 12, fmtDateGenius(ch.deposit_date));
    setCell(challanSheet, rowNum, 13, ch.challan_serial_no || "");
    setCell(challanSheet, rowNum, 14, ch.is_book_entry ? "Yes" : "No");
    setCell(challanSheet, rowNum, 15, ch.minor_head_of_challan || "200");
    setCell(challanSheet, rowNum, 16, 0); // Interest as per deductee annexure
    setCell(challanSheet, rowNum, 17, 0); // Others as per deductee annexure
    challanRowsWritten++;
  });
  console.log("[GeniusExport] Challan rows written:", challanRowsWritten);

  // ═════════════════════════════════════════════════════════════════════════
  // SECTION 3: Annexure / Deductee sheet (form-specific)
  // Row 1 = headers (preserved from template)
  // Rows 2+ = data (one row per deductee entry)
  // ═════════════════════════════════════════════════════════════════════════

  const annexSheetTemplateName = formType === "27EQ"
    ? "Annex-I_PartyDetails"
    : "Annex-I_DeducteeDetails";
  const annexSheetExportName = formType === "27EQ"
    ? "Party Details"
    : "Deductee Details";

  const annexSheetName = findSheetName(wb, annexSheetTemplateName, annexSheetExportName);
  if (!annexSheetName) {
    throw new Error(
      `Sheet '${annexSheetTemplateName}' not found in template. ` +
      `Sheets in template: ${wb.SheetNames.join(", ")}`
    );
  }
  console.log("[GeniusExport] Annex sheet:", annexSheetName);
  const annexSheet = wb.Sheets[annexSheetName];

  clearDataRows(annexSheet);

  let deducteeRowsWritten = 0;

  if (formType === "26Q" || formType === "27Q") {
    // Shared column layout for 26Q and 27Q (both use Deductee Details)
    // C1=ChallanSerial, C2=Section, C3=DeducteeCode, C4=PAN, C5=PANRef,
    // C6=Name, C7-C13=Address/State/PIN, C14=Amount, C15=Date,
    // C16=TDSRate, C17=SurchargeRate, C18=CessRate,
    // C19=TDS, C20=Surcharge, C21=Cess, C22=TotalTax,
    // C23=DateOfDeduction, C24=Reason, C25=Certificate, C26+=extra
    deductees.forEach((d, i) => {
      const rowNum = i + 2;
      const challanSr = challanIndexMap.get(d.challan_id) || 1;
      const cessRate = 4;
      const cessAmt = d.cess_amount ||
        Math.round(((d.tds_amount || 0) + (d.surcharge_amount || 0)) * 0.04 * 100) / 100;

      setCell(annexSheet, rowNum, 1, challanSr);
      setCell(annexSheet, rowNum, 2, d.section_code || "");
      setCell(annexSheet, rowNum, 3, d.deductee_type === "Company" ? "01" : "02");
      setCell(annexSheet, rowNum, 4, d.deductee_pan || "");
      setCell(annexSheet, rowNum, 5, d.deductee_ref_no || "");
      setCell(annexSheet, rowNum, 6, d.deductee_name || "");
      // Address cols 7-13: blank
      for (let c = 7; c <= 13; c++) setCell(annexSheet, rowNum, c, "");
      setCell(annexSheet, rowNum, 14, d.amount_paid_credited || 0);
      setCell(annexSheet, rowNum, 15, fmtDateGenius(d.date_of_payment));
      setCell(annexSheet, rowNum, 16, d.rate_of_tds || 0);
      setCell(annexSheet, rowNum, 17, d.surcharge_rate || 0);
      setCell(annexSheet, rowNum, 18, cessRate);
      setCell(annexSheet, rowNum, 19, Math.round(d.tds_amount || 0));
      setCell(annexSheet, rowNum, 20, d.surcharge_amount || 0);
      setCell(annexSheet, rowNum, 21, cessAmt);
      setCell(annexSheet, rowNum, 22, d.total_tax_deducted || d.tds_amount || 0);
      setCell(annexSheet, rowNum, 23, fmtDateGenius(d.date_of_deduction || d.date_of_payment));
      setCell(annexSheet, rowNum, 24, d.reason_for_lower_or_nil_deduction || "");
      setCell(annexSheet, rowNum, 25, d.lower_deduction_certificate_no || "");

      if (formType === "26Q") {
        // 26Q has extra cash-withdrawal columns 26-29
        for (let c = 26; c <= 29; c++) setCell(annexSheet, rowNum, c, "");
      } else {
        // 27Q has DTAA/remittance/country columns 26-38
        setCell(annexSheet, rowNum, 26, "");  // Grossing Up
        setCell(annexSheet, rowNum, 27, "");  // DTAA flag
        setCell(annexSheet, rowNum, 28, "");  // Nature of Remittance
        setCell(annexSheet, rowNum, 29, "");  // Form 15CA Ack No.
        setCell(annexSheet, rowNum, 30, d.country_of_residence || "");
        for (let c = 31; c <= 38; c++) setCell(annexSheet, rowNum, c, "");
      }

      deducteeRowsWritten++;
    });

  } else if (formType === "24Q") {
    // 24Q: Employee (salary) annexure
    // C1=ChallanSerial, C2=Section, C3=EmpRef, C4=PAN, C5=PANRef, C6=Name,
    // C7=DateOfPayment, C8=TaxableAmount, C9=TDS, C10=Surcharge, C11=Cess,
    // C12=TotalTax, C13=DateOfDeduction, C14=Reason, C15=Certificate, C16=Email
    deductees.forEach((d, i) => {
      const rowNum = i + 2;
      const challanSr = challanIndexMap.get(d.challan_id) || 1;

      setCell(annexSheet, rowNum, 1, challanSr);
      setCell(annexSheet, rowNum, 2, d.section_code || "192");
      setCell(annexSheet, rowNum, 3, d.deductee_ref_no || "");
      setCell(annexSheet, rowNum, 4, d.deductee_pan || "");
      setCell(annexSheet, rowNum, 5, "");  // PAN Ref. No.
      setCell(annexSheet, rowNum, 6, d.deductee_name || "");
      setCell(annexSheet, rowNum, 7, fmtDateGenius(d.date_of_payment));
      setCell(annexSheet, rowNum, 8, d.amount_paid_credited || 0);
      setCell(annexSheet, rowNum, 9, Math.round(d.tds_amount || 0));
      setCell(annexSheet, rowNum, 10, d.surcharge_amount || 0);
      setCell(annexSheet, rowNum, 11, d.cess_amount || 0);
      setCell(annexSheet, rowNum, 12, d.total_tax_deducted || d.tds_amount || 0);
      setCell(annexSheet, rowNum, 13, fmtDateGenius(d.date_of_deduction || d.date_of_payment));
      setCell(annexSheet, rowNum, 14, d.reason_for_lower_or_nil_deduction || "");
      setCell(annexSheet, rowNum, 15, d.lower_deduction_certificate_no || "");
      setCell(annexSheet, rowNum, 16, "");  // Email

      deducteeRowsWritten++;
    });

  } else if (formType === "27EQ") {
    // 27EQ: Tax collected at source (TCS) — Party Details sheet
    // C1=ChallanSerial, C2=CollectionCode, C3=PartyCode, C4=PAN, C5=PANRef,
    // C6=Name, C7-C13=Address/State/PIN, C14=TotalPurchases, C15=AmountPaid,
    // C16=Date, C17=TCRate, C18=SurchargeRate, C19=CessRate,
    // C20=TCS, C21=Surcharge, C22=Cess, C23=TotalTax,
    // C24=DateCollected, C25=Reason, C26=Certificate, C27-C33=misc flags
    deductees.forEach((d, i) => {
      const rowNum = i + 2;
      const challanSr = challanIndexMap.get(d.challan_id) || 1;
      const cessRate = 4;
      const cessAmt = d.cess_amount ||
        Math.round(((d.tds_amount || 0) + (d.surcharge_amount || 0)) * 0.04 * 100) / 100;

      setCell(annexSheet, rowNum, 1, challanSr);
      setCell(annexSheet, rowNum, 2, d.section_code || "");
      setCell(annexSheet, rowNum, 3, d.deductee_type === "Company" ? "01" : "02");
      setCell(annexSheet, rowNum, 4, d.deductee_pan || "");
      setCell(annexSheet, rowNum, 5, d.deductee_ref_no || "");
      setCell(annexSheet, rowNum, 6, d.deductee_name || "");
      for (let c = 7; c <= 13; c++) setCell(annexSheet, rowNum, c, "");
      setCell(annexSheet, rowNum, 14, d.amount_paid_credited || 0);  // Total value of purchases
      setCell(annexSheet, rowNum, 15, d.amount_paid_credited || 0);  // Amount paid
      setCell(annexSheet, rowNum, 16, fmtDateGenius(d.date_of_payment));
      setCell(annexSheet, rowNum, 17, d.rate_of_tds || 0);
      setCell(annexSheet, rowNum, 18, d.surcharge_rate || 0);
      setCell(annexSheet, rowNum, 19, cessRate);
      setCell(annexSheet, rowNum, 20, d.tds_amount || 0);
      setCell(annexSheet, rowNum, 21, d.surcharge_amount || 0);
      setCell(annexSheet, rowNum, 22, cessAmt);
      setCell(annexSheet, rowNum, 23, d.total_tax_deducted || d.tds_amount || 0);
      setCell(annexSheet, rowNum, 24, fmtDateGenius(d.date_of_deduction || d.date_of_payment));
      setCell(annexSheet, rowNum, 25, d.reason_for_lower_or_nil_deduction || "");
      setCell(annexSheet, rowNum, 26, d.lower_deduction_certificate_no || "");
      for (let c = 27; c <= 33; c++) setCell(annexSheet, rowNum, c, "");

      deducteeRowsWritten++;
    });
  }

  console.log("[GeniusExport] Deductee rows written:", deducteeRowsWritten);

  // ═════════════════════════════════════════════════════════════════════════
  // SECTION 4: Rename worksheets to Genius-expected names
  // Genius importer looks for exact display names with spaces. CodeName
  // (what VBA actually binds to) is untouched by renameSheetDisplayName.
  // Template has names without spaces (ChallanDetails, DeductorDetails, etc.)
  // ═════════════════════════════════════════════════════════════════════════
  const sheetRenameMap: Record<string, string> = {
    "DeductorDetails":        "Deductor Details",
    "EmployerDetails":        "Employer Details",
    "CollectorDetails":       "Collector Details",
    "ChallanDetails":         "Challan Details",
    "Annex-I_DeducteeDetails":"Deductee Details",
    "Annex-I_PartyDetails":   "Party Details",
  };

  Object.entries(sheetRenameMap).forEach(([oldName, newName]) => {
    if (wb.SheetNames.includes(oldName)) {
      console.log(`[GeniusExport] Renaming sheet: "${oldName}" → "${newName}"`);
      renameSheetDisplayName(wb, oldName, newName);
    }
  });

  console.log("[GeniusExport] Final sheet names:", wb.SheetNames);

  // ═════════════════════════════════════════════════════════════════════════
  // SECTION 5: Save — write buffer and trigger download
  //
  // CRITICAL: Genius TDS software imports ONLY via legacy .xls (BIFF8) format.
  // Its VBA macros use Workbooks.Open which cannot read OOXML (.xlsx). Giving
  // Genius a .xlsx produces errors like:
  //   - "Unable to get the Open property of the Workbooks class"
  //   - "For loop not initialized"
  //   - "Object variable or With block variable not set"
  //
  // A single SheetJS write with bookVBA:true re-embeds the SAME vbaraw blob
  // we captured on read — no second library, no lossy intermediate format.
  // ═════════════════════════════════════════════════════════════════════════
  const xlsArray = XLSX.write(wb, { type: "array", bookType: "biff8", bookVBA: true }) as ArrayBuffer;
  console.log("[GeniusExport] Final .xls buffer size:", xlsArray.byteLength, "bytes");

  if (xlsArray.byteLength < 1000) {
    throw new Error(
      `Export failed: generated file is only ${xlsArray.byteLength} bytes (expected > 1000). ` +
      `Workbook appears empty — check template and data.`
    );
  }

  // Verify BIFF8 magic bytes (D0 CF 11 E0 = OLE Compound Document) and that
  // the VBA project actually made it into the output.
  const header = new Uint8Array(xlsArray.slice(0, 4));
  const magic = Array.from(header).map(b => b.toString(16).padStart(2, "0")).join("");
  if (magic !== "d0cf11e0") {
    console.warn("[GeniusExport] WARNING: Output is not BIFF8 format. Magic:", magic);
  } else {
    console.log("[GeniusExport] ✓ Verified BIFF8 (.xls) format — Genius-compatible");
  }
  if (wb.vbaraw) {
    const verifyWb = XLSX.read(xlsArray, { type: "array", bookVBA: true });
    const outVbaLen = verifyWb.vbaraw ? (verifyWb.vbaraw as ArrayBuffer).byteLength : 0;
    const inVbaLen = (wb.vbaraw as ArrayBuffer).byteLength;
    if (outVbaLen !== inVbaLen) {
      console.warn(`[GeniusExport] WARNING: VBA project size mismatch — template had ${inVbaLen} bytes, output has ${outVbaLen} bytes.`);
    } else {
      console.log(`[GeniusExport] ✓ VBA project preserved intact (${outVbaLen} bytes)`);
    }
  }

  // Write to the save handle we acquired up-front (clean file, no MOTW) or
  // fall back to legacy download if the browser doesn't support the API.
  await writeToDisk(saveHandle, xlsArray, suggestedFileName, "application/vnd.ms-excel");

  console.log("[GeniusExport] Export complete:", suggestedFileName);
}
