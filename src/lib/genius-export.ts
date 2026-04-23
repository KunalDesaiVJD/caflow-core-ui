/**
 * Genius XLS Export — writes TDS return data into Genius-compatible Excel templates.
 *
 * Output is BIFF8 (.xls) because Genius VBA uses Workbooks.Open which cannot
 * read OOXML (.xlsx) — giving Genius a .xlsx produces "Unable to get the Open
 * property of the Workbooks class" etc.
 *
 * Architecture:
 *  1. Load .xls template (Supabase Storage → public folder fallback → error if missing)
 *  2. Convert .xls → .xlsx buffer via SheetJS (ExcelJS only supports xlsx)
 *  3. Load .xlsx into ExcelJS for structured row-by-row writing
 *  4. Rename worksheets to Genius-expected names
 *  5. ExcelJS → xlsx buffer → SheetJS round-trip → BIFF8 (.xls) buffer
 *  6. Download as .xls with application/vnd.ms-excel mime type
 *
 * Template sheet names (internal → Genius import expected):
 *   DeductorDetails / EmployerDetails / CollectorDetails  → Deductor/Employer/Collector Details
 *   ChallanDetails                                        → Challan Details
 *   Annex-I_DeducteeDetails                              → Deductee Details
 *   Annex-I_PartyDetails                                 → Party Details
 */

import * as XLSX from "xlsx";
import ExcelJS from "exceljs";
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

/** Trigger a browser download from an ArrayBuffer */
const triggerDownload = (buffer: ArrayBuffer, fileName: string, mimeType: string): void => {
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

  // ── Convert .xls → .xlsx (ExcelJS does not support legacy .xls/BIFF8 format) ─
  // SheetJS reads .xls perfectly and can write a .xlsx buffer for ExcelJS to consume.
  const xlsWb = XLSX.read(templateBuffer, { type: "array", cellStyles: true });
  console.log("[GeniusExport] SheetJS sheets after reading .xls:", xlsWb.SheetNames);
  const xlsxArray = XLSX.write(xlsWb, { type: "array", bookType: "xlsx" }) as number[];
  const xlsxBuffer = new Uint8Array(xlsxArray).buffer;

  // ── Load into ExcelJS workbook ────────────────────────────────────────────
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(xlsxBuffer);

  const sheetNames = workbook.worksheets.map(ws => ws.name);
  console.log("[GeniusExport] ExcelJS sheets found:", sheetNames);

  if (workbook.worksheets.length === 0) {
    throw new Error("Template loaded but contains no worksheets — file may be corrupt.");
  }

  // ── B: Sheet resolver — finds a worksheet by any of the given candidate names ─
  const findSheet = (...candidateNames: string[]): ExcelJS.Worksheet | null => {
    for (const name of candidateNames) {
      const ws = workbook.worksheets.find(w => w.name.trim() === name.trim());
      if (ws) return ws;
    }
    return null;
  };

  // ── Helper: set a cell value (ExcelJS is 1-indexed) ──────────────────────
  const setCell = (ws: ExcelJS.Worksheet, row1: number, col1: number, value: ExcelJS.CellValue): void => {
    ws.getCell(row1, col1).value = value;
  };

  // ── Helper: clear data rows (row 2 onward) in a sheet ────────────────────
  const clearDataRows = (ws: ExcelJS.Worksheet): void => {
    const lastRow = ws.lastRow?.number ?? 1;
    for (let r = 2; r <= lastRow; r++) {
      ws.getRow(r).values = [];
    }
  };

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
  const detailSheet = findSheet("DeductorDetails", "EmployerDetails", "CollectorDetails",
                                "Deductor Details", "Employer Details", "Collector Details");
  if (!detailSheet) {
    throw new Error(
      `Detail sheet not found in template. ` +
      `Expected one of: DeductorDetails, EmployerDetails, CollectorDetails. ` +
      `Sheets in template: ${sheetNames.join(", ")}`
    );
  }
  console.log("[GeniusExport] Detail sheet:", detailSheet.name);

  // Row 1 (SheetJS row 0): TAN of Deductor | <value> | A.Y. | <value>
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

  // ── B: Sheet access — find ChallanDetails (strict) ───────────────────────
  let challanSheet = findSheet("ChallanDetails", "Challan Details");
  if (!challanSheet) {
    throw new Error(
      `Sheet 'ChallanDetails' not found in template. ` +
      `Sheets in template: ${sheetNames.join(", ")}`
    );
  }
  console.log("[GeniusExport] Challan sheet:", challanSheet.name);

  // Clear existing data rows before writing
  clearDataRows(challanSheet);

  // ── D: Write challan data rows ─────────────────────────────────────────
  // Column mapping (1-indexed, matches template headers verified above):
  // C1=Serial, C2=Section, C3=IncomeTax, C4=Surcharge, C5=Cess, C6=Interest,
  // C7=LateFee234E, C8=Others, C9=TotalDeposited, C10=ChequeDD, C11=BSRCode,
  // C12=DepositDate, C13=BankChallanNo, C14=BookEntry, C15=MinorHead,
  // C16=InterestAsPerDeductee, C17=OthersAsPerDeductee
  let challanRowsWritten = 0;
  challans.forEach((ch, i) => {
    const rowNum = i + 2; // row 2 = first data row (row 1 = headers)
    const row = challanSheet!.getRow(rowNum);
    row.getCell(1).value = i + 1;
    row.getCell(2).value = ch.section_code || "";
    row.getCell(3).value = ch.total_tax_deposited || 0;
    row.getCell(4).value = ch.surcharge_deposited || 0;
    row.getCell(5).value = ch.education_cess_deposited || 0;
    row.getCell(6).value = ch.interest_deposited || 0;
    // DB columns: late_fees_234e / others_deposited (legacy: late_fee / other_amount)
    row.getCell(7).value = ch.late_fees_234e ?? ch.late_fee ?? 0;
    row.getCell(8).value = ch.others_deposited ?? ch.other_amount ?? 0;
    row.getCell(9).value = ch.total_challan_amount || ch.total_tax_deposited || 0;
    row.getCell(10).value = ch.cheque_dd_no || "";
    row.getCell(11).value = ch.bsr_code || "";
    row.getCell(12).value = fmtDateGenius(ch.deposit_date);
    row.getCell(13).value = ch.challan_serial_no || "";
    row.getCell(14).value = ch.is_book_entry ? "Yes" : "No";
    row.getCell(15).value = ch.minor_head_of_challan || "200";
    row.getCell(16).value = 0; // Interest as per deductee annexure
    row.getCell(17).value = 0; // Others as per deductee annexure
    row.commit(); // CRITICAL: flush row to workbook buffer
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

  const annexSheet = findSheet(annexSheetTemplateName, annexSheetExportName);
  if (!annexSheet) {
    throw new Error(
      `Sheet '${annexSheetTemplateName}' not found in template. ` +
      `Sheets in template: ${sheetNames.join(", ")}`
    );
  }
  console.log("[GeniusExport] Annex sheet:", annexSheet.name);

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
      const row = annexSheet!.getRow(rowNum);
      const challanSr = challanIndexMap.get(d.challan_id) || 1;
      const cessRate = 4;
      const cessAmt = d.cess_amount ||
        Math.round(((d.tds_amount || 0) + (d.surcharge_amount || 0)) * 0.04 * 100) / 100;

      row.getCell(1).value = challanSr;
      row.getCell(2).value = d.section_code || "";
      row.getCell(3).value = d.deductee_type === "Company" ? "01" : "02";
      row.getCell(4).value = d.deductee_pan || "";
      row.getCell(5).value = d.deductee_ref_no || "";
      row.getCell(6).value = d.deductee_name || "";
      // Address cols 7-13: blank
      for (let c = 7; c <= 13; c++) row.getCell(c).value = "";
      row.getCell(14).value = d.amount_paid_credited || 0;
      row.getCell(15).value = fmtDateGenius(d.date_of_payment);
      row.getCell(16).value = d.rate_of_tds || 0;
      row.getCell(17).value = d.surcharge_rate || 0;
      row.getCell(18).value = cessRate;
      row.getCell(19).value = Math.round(d.tds_amount || 0);
      row.getCell(20).value = d.surcharge_amount || 0;
      row.getCell(21).value = cessAmt;
      row.getCell(22).value = d.total_tax_deducted || d.tds_amount || 0;
      row.getCell(23).value = fmtDateGenius(d.date_of_deduction || d.date_of_payment);
      row.getCell(24).value = d.reason_for_lower_or_nil_deduction || "";
      row.getCell(25).value = d.lower_deduction_certificate_no || "";

      if (formType === "26Q") {
        // 26Q has extra cash-withdrawal columns 26-29
        row.getCell(26).value = "";
        row.getCell(27).value = "";
        row.getCell(28).value = "";
        row.getCell(29).value = "";
      } else {
        // 27Q has DTAA/remittance/country columns 26-38
        row.getCell(26).value = "";  // Grossing Up
        row.getCell(27).value = "";  // DTAA flag
        row.getCell(28).value = "";  // Nature of Remittance
        row.getCell(29).value = "";  // Form 15CA Ack No.
        row.getCell(30).value = d.country_of_residence || "";
        row.getCell(31).value = "";  // Email
        row.getCell(32).value = "";  // Contact No.
        row.getCell(33).value = "";  // Address in country of residence
        row.getCell(34).value = "";  // TIN
        row.getCell(35).value = "";
        row.getCell(36).value = "";
        row.getCell(37).value = "";
        row.getCell(38).value = "";
      }

      row.commit();
      deducteeRowsWritten++;
    });

  } else if (formType === "24Q") {
    // 24Q: Employee (salary) annexure
    // C1=ChallanSerial, C2=Section, C3=EmpRef, C4=PAN, C5=PANRef, C6=Name,
    // C7=DateOfPayment, C8=TaxableAmount, C9=TDS, C10=Surcharge, C11=Cess,
    // C12=TotalTax, C13=DateOfDeduction, C14=Reason, C15=Certificate, C16=Email
    deductees.forEach((d, i) => {
      const rowNum = i + 2;
      const row = annexSheet!.getRow(rowNum);
      const challanSr = challanIndexMap.get(d.challan_id) || 1;

      row.getCell(1).value = challanSr;
      row.getCell(2).value = d.section_code || "192";
      row.getCell(3).value = d.deductee_ref_no || "";
      row.getCell(4).value = d.deductee_pan || "";
      row.getCell(5).value = "";  // PAN Ref. No.
      row.getCell(6).value = d.deductee_name || "";
      row.getCell(7).value = fmtDateGenius(d.date_of_payment);
      row.getCell(8).value = d.amount_paid_credited || 0;
      row.getCell(9).value = Math.round(d.tds_amount || 0);
      row.getCell(10).value = d.surcharge_amount || 0;
      row.getCell(11).value = d.cess_amount || 0;
      row.getCell(12).value = d.total_tax_deducted || d.tds_amount || 0;
      row.getCell(13).value = fmtDateGenius(d.date_of_deduction || d.date_of_payment);
      row.getCell(14).value = d.reason_for_lower_or_nil_deduction || "";
      row.getCell(15).value = d.lower_deduction_certificate_no || "";
      row.getCell(16).value = "";  // Email

      row.commit();
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
      const row = annexSheet!.getRow(rowNum);
      const challanSr = challanIndexMap.get(d.challan_id) || 1;
      const cessRate = 4;
      const cessAmt = d.cess_amount ||
        Math.round(((d.tds_amount || 0) + (d.surcharge_amount || 0)) * 0.04 * 100) / 100;

      row.getCell(1).value = challanSr;
      row.getCell(2).value = d.section_code || "";
      row.getCell(3).value = d.deductee_type === "Company" ? "01" : "02";
      row.getCell(4).value = d.deductee_pan || "";
      row.getCell(5).value = d.deductee_ref_no || "";
      row.getCell(6).value = d.deductee_name || "";
      for (let c = 7; c <= 13; c++) row.getCell(c).value = "";
      row.getCell(14).value = d.amount_paid_credited || 0;  // Total value of purchases
      row.getCell(15).value = d.amount_paid_credited || 0;  // Amount paid
      row.getCell(16).value = fmtDateGenius(d.date_of_payment);
      row.getCell(17).value = d.rate_of_tds || 0;
      row.getCell(18).value = d.surcharge_rate || 0;
      row.getCell(19).value = cessRate;
      row.getCell(20).value = d.tds_amount || 0;
      row.getCell(21).value = d.surcharge_amount || 0;
      row.getCell(22).value = cessAmt;
      row.getCell(23).value = d.total_tax_deducted || d.tds_amount || 0;
      row.getCell(24).value = fmtDateGenius(d.date_of_deduction || d.date_of_payment);
      row.getCell(25).value = d.reason_for_lower_or_nil_deduction || "";
      row.getCell(26).value = d.lower_deduction_certificate_no || "";
      for (let c = 27; c <= 33; c++) row.getCell(c).value = "";

      row.commit();
      deducteeRowsWritten++;
    });
  }

  console.log("[GeniusExport] Deductee rows written:", deducteeRowsWritten);

  // ═════════════════════════════════════════════════════════════════════════
  // SECTION 4: Rename worksheets to Genius-expected names
  // Genius importer looks for exact names with spaces.
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

  workbook.worksheets.forEach(ws => {
    const newName = sheetRenameMap[ws.name.trim()];
    if (newName) {
      console.log(`[GeniusExport] Renaming sheet: "${ws.name}" → "${newName}"`);
      ws.name = newName;
    }
  });

  console.log("[GeniusExport] Final sheet names:", workbook.worksheets.map(ws => ws.name));

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
  // So we:
  //   1. Have ExcelJS write to .xlsx buffer (ExcelJS cannot write .xls)
  //   2. Round-trip through SheetJS to re-encode as BIFF8 (.xls)
  //   3. Download with .xls extension and application/vnd.ms-excel mime type
  // ═════════════════════════════════════════════════════════════════════════
  const writtenXlsxBuffer = await workbook.xlsx.writeBuffer();
  console.log("[GeniusExport] Intermediate xlsx buffer size:", writtenXlsxBuffer.byteLength, "bytes");

  if (writtenXlsxBuffer.byteLength < 1000) {
    throw new Error(
      `Export failed: generated file is only ${writtenXlsxBuffer.byteLength} bytes (expected > 1000). ` +
      `Workbook appears empty — check template and data.`
    );
  }

  // Round-trip: .xlsx buffer → SheetJS workbook → .xls (BIFF8) buffer
  const finalWb = XLSX.read(writtenXlsxBuffer, { type: "array", cellStyles: true });
  console.log("[GeniusExport] Round-trip sheets:", finalWb.SheetNames);
  const xlsArray = XLSX.write(finalWb, { type: "array", bookType: "biff8" }) as ArrayBuffer;
  console.log("[GeniusExport] Final .xls buffer size:", xlsArray.byteLength, "bytes");

  // Verify BIFF8 magic bytes (D0 CF 11 E0 = OLE Compound Document)
  const header = new Uint8Array(xlsArray.slice(0, 4));
  const magic = Array.from(header).map(b => b.toString(16).padStart(2, "0")).join("");
  if (magic !== "d0cf11e0") {
    console.warn("[GeniusExport] WARNING: Output is not BIFF8 format. Magic:", magic);
  } else {
    console.log("[GeniusExport] ✓ Verified BIFF8 (.xls) format — Genius-compatible");
  }

  const safeClientName = (client.name || "Client").replace(/[^a-zA-Z0-9]/g, "_");
  const fileName = `Genius_${formType}_${safeClientName}_${filing.financial_year || "FY"}_${quarter}.xls`;

  triggerDownload(
    xlsArray,
    fileName,
    "application/vnd.ms-excel"
  );

  console.log("[GeniusExport] Export complete:", fileName);
}
