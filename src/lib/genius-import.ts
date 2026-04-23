/**
 * Genius XLS Import — reads a Genius-format .xls (or .xlsx) file and loads
 * its challan + deductee data into CAFlow's Supabase DB for the currently
 * selected filing.
 *
 * This is the reverse of genius-export.ts. Same sheet names and column
 * layout; we just read where export writes.
 *
 * Flow:
 *   1. Parse workbook via SheetJS (handles both .xls BIFF8 and .xlsx)
 *   2. Read DeductorDetails key/value layout and extract TAN / PAN / Form / Quarter
 *   3. Validate the file matches the currently selected filing (TAN match)
 *   4. Bulk-insert tds_challans — collect the generated UUIDs keyed by the
 *      Genius "Challan Serial No." (1-based index from the file)
 *   5. Bulk-insert tds_deductees, each row's challan_id resolved from the map
 */
import * as XLSX from "xlsx";
import { supabase } from "@/integrations/supabase/client";

// ─── Interfaces ──────────────────────────────────────────────────────────────

interface Filing {
  id: string;
  client_id: string;
  firm_id?: string | null;
  tan?: string | null;
  [key: string]: any;
}

interface Client {
  id: string;
  name?: string | null;
  tan_number?: string | null;
  [key: string]: any;
}

/** Shape returned by parseGeniusXls — what we extract from the file. */
export interface ParsedGeniusFile {
  deductor: {
    tan: string;
    pan: string;
    name: string;
    assessmentYear: string;
    quarter: string;      // e.g. "Q1", "Q2", "Q3", "Q4"
    formNo: string;       // "26Q", "24Q", "27Q", "27EQ"
  };
  challans: ParsedChallan[];
  deductees: ParsedDeductee[];
}

export interface ParsedChallan {
  serialNo: number;                 // 1-based as per Genius "Challan Serial No." col
  sectionCode: string;
  incomeTax: number;
  surcharge: number;
  cess: number;
  interest: number;
  lateFee234E: number;
  others: number;
  totalDeposited: number;
  chequeDdNo: string;
  bsrCode: string;
  depositDate: string | null;       // ISO yyyy-mm-dd
  bankChallanNo: string;            // 5-digit serial
  isBookEntry: boolean;
  minorHead: string;
}

export interface ParsedDeductee {
  challanSerialNo: number;          // links back to ParsedChallan.serialNo
  sectionCode: string;
  deducteeType: string;             // "Company" | "Non-Company"
  pan: string;
  refNo: string;
  name: string;
  amountPaid: number;
  datePaid: string | null;
  rateOfTds: number;
  surchargeRate: number;
  cessRate: number;
  tdsAmount: number;
  surchargeAmount: number;
  cessAmount: number;
  totalTaxDeducted: number;
  dateOfDeduction: string | null;
  reason: string;
  certificateNo: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Parse a DD/MM/YYYY date string into ISO yyyy-mm-dd. Returns null on failure. */
function parseDdmmyyyy(s: string | number | null | undefined): string | null {
  if (s === null || s === undefined || s === "") return null;
  const str = String(s).trim();
  // Already ISO?
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
  // DD/MM/YYYY or DD-MM-YYYY
  const m = /^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})$/.exec(str);
  if (m) {
    const dd = m[1].padStart(2, "0");
    const mm = m[2].padStart(2, "0");
    let yy = m[3];
    if (yy.length === 2) yy = (parseInt(yy) > 50 ? "19" : "20") + yy;
    // Sanity check
    const dn = parseInt(dd), mn = parseInt(mm), yn = parseInt(yy);
    if (dn < 1 || dn > 31 || mn < 1 || mn > 12 || yn < 1900 || yn > 2100) return null;
    return `${yy}-${mm}-${dd}`;
  }
  // Excel serial number (number of days since 1900)
  if (typeof s === "number" && s > 25569 && s < 60000) {
    const date = new Date((s - 25569) * 86400 * 1000);
    if (!isNaN(date.getTime())) return date.toISOString().slice(0, 10);
  }
  return null;
}

/** Safely read a cell value as string. */
function cellStr(ws: XLSX.WorkSheet, addr: string): string {
  const c = ws[addr];
  if (!c || c.v === null || c.v === undefined) return "";
  return String(c.v).trim();
}

/** Safely read a cell value as number. */
function cellNum(ws: XLSX.WorkSheet, addr: string): number {
  const c = ws[addr];
  if (!c || c.v === null || c.v === undefined || c.v === "") return 0;
  const n = typeof c.v === "number" ? c.v : parseFloat(String(c.v).replace(/,/g, ""));
  return isNaN(n) ? 0 : n;
}

/** Map Genius deductee code ("01-Companies", "02-Other than Companies") → app value. */
function parseDeducteeType(raw: string): string {
  const s = (raw || "").trim();
  if (s.startsWith("01")) return "Company";
  if (s.startsWith("02")) return "Non-Company";
  return s; // leave as-is if non-standard
}

// ─── Parser ──────────────────────────────────────────────────────────────────

/**
 * Parse a .xls/.xlsx file and extract deductor / challans / deductees.
 * Throws a user-readable Error if the file isn't a recognised Genius format.
 */
export async function parseGeniusXls(file: File): Promise<ParsedGeniusFile> {
  const buffer = await file.arrayBuffer();
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(buffer, { type: "array", cellDates: false });
  } catch (err: any) {
    throw new Error(`Could not read Excel file: ${err?.message || err}`);
  }

  const findSheet = (...candidates: string[]): XLSX.WorkSheet | null => {
    for (const name of candidates) {
      const match = wb.SheetNames.find(n => n.trim() === name.trim());
      if (match) return wb.Sheets[match];
    }
    return null;
  };

  const detailSheet = findSheet(
    "DeductorDetails", "EmployerDetails", "CollectorDetails",
    "Deductor Details", "Employer Details", "Collector Details",
  );
  if (!detailSheet) {
    throw new Error(
      `Not a Genius-format file. Missing Deductor/Employer/Collector sheet. ` +
      `Sheets found: ${wb.SheetNames.join(", ")}`
    );
  }

  const challanSheet = findSheet("ChallanDetails", "Challan Details");
  if (!challanSheet) {
    throw new Error(
      `Not a Genius-format file. Missing ChallanDetails sheet. ` +
      `Sheets found: ${wb.SheetNames.join(", ")}`
    );
  }

  const deducteeSheet = findSheet(
    "Annex-I_DeducteeDetails", "Annex-I_PartyDetails",
    "Deductee Details", "Party Details",
  );
  if (!deducteeSheet) {
    throw new Error(
      `Not a Genius-format file. Missing Deductee/Party Details sheet. ` +
      `Sheets found: ${wb.SheetNames.join(", ")}`
    );
  }

  // ── Deductor details (key/value layout) ──────────────────────────────────
  const deductor = {
    tan:            cellStr(detailSheet, "B1"),
    pan:            cellStr(detailSheet, "B2"),
    name:           cellStr(detailSheet, "B3"),
    assessmentYear: cellStr(detailSheet, "C2"),
    quarter:        cellStr(detailSheet, "C4") || "Q1",
    formNo:         cellStr(detailSheet, "C6") || "26Q",
  };

  // ── Challans (row 2+) ────────────────────────────────────────────────────
  const challans: ParsedChallan[] = [];
  const chRange = XLSX.utils.decode_range(challanSheet["!ref"] || "A1:Q1");
  for (let r = 1; r <= chRange.e.r; r++) {
    // Stop at first fully-empty row (col A blank means no more challans)
    const serialAddr = XLSX.utils.encode_cell({ r, c: 0 });
    const serialCell = challanSheet[serialAddr];
    if (!serialCell || serialCell.v === null || serialCell.v === undefined || serialCell.v === "") break;

    const row = (col: number) => XLSX.utils.encode_cell({ r, c: col });
    challans.push({
      serialNo:       cellNum(challanSheet, row(0)),
      sectionCode:    cellStr(challanSheet, row(1)),
      incomeTax:      cellNum(challanSheet, row(2)),
      surcharge:      cellNum(challanSheet, row(3)),
      cess:           cellNum(challanSheet, row(4)),
      interest:       cellNum(challanSheet, row(5)),
      lateFee234E:    cellNum(challanSheet, row(6)),
      others:         cellNum(challanSheet, row(7)),
      totalDeposited: cellNum(challanSheet, row(8)),
      chequeDdNo:     cellStr(challanSheet, row(9)),
      bsrCode:        cellStr(challanSheet, row(10)),
      depositDate:    parseDdmmyyyy(challanSheet[row(11)]?.v),
      bankChallanNo:  cellStr(challanSheet, row(12)),
      isBookEntry:    /yes|true|y/i.test(cellStr(challanSheet, row(13))),
      minorHead:      cellStr(challanSheet, row(14)) || "200",
    });
  }

  // ── Deductees (row 2+) ───────────────────────────────────────────────────
  const deductees: ParsedDeductee[] = [];
  const deRange = XLSX.utils.decode_range(deducteeSheet["!ref"] || "A1:Z1");
  for (let r = 1; r <= deRange.e.r; r++) {
    const serialAddr = XLSX.utils.encode_cell({ r, c: 0 });
    const serialCell = deducteeSheet[serialAddr];
    if (!serialCell || serialCell.v === null || serialCell.v === undefined || serialCell.v === "") break;

    const row = (col: number) => XLSX.utils.encode_cell({ r, c: col });
    deductees.push({
      challanSerialNo:   cellNum(deducteeSheet, row(0)),
      sectionCode:       cellStr(deducteeSheet, row(1)),
      deducteeType:      parseDeducteeType(cellStr(deducteeSheet, row(2))),
      pan:               cellStr(deducteeSheet, row(3)).toUpperCase(),
      refNo:             cellStr(deducteeSheet, row(4)),
      name:              cellStr(deducteeSheet, row(5)),
      amountPaid:        cellNum(deducteeSheet, row(13)),
      datePaid:          parseDdmmyyyy(deducteeSheet[row(14)]?.v),
      rateOfTds:         cellNum(deducteeSheet, row(15)),
      surchargeRate:     cellNum(deducteeSheet, row(16)),
      cessRate:          cellNum(deducteeSheet, row(17)),
      tdsAmount:         cellNum(deducteeSheet, row(18)),
      surchargeAmount:   cellNum(deducteeSheet, row(19)),
      cessAmount:        cellNum(deducteeSheet, row(20)),
      totalTaxDeducted:  cellNum(deducteeSheet, row(21)),
      dateOfDeduction:   parseDdmmyyyy(deducteeSheet[row(22)]?.v),
      reason:            cellStr(deducteeSheet, row(23)),
      certificateNo:     cellStr(deducteeSheet, row(24)),
    });
  }

  return { deductor, challans, deductees };
}

// ─── Importer: parse + insert into DB ────────────────────────────────────────

export interface ImportResult {
  parsed: ParsedGeniusFile;
  challansInserted: number;
  deducteesInserted: number;
  warnings: string[];
}

/**
 * Full import: parse → validate → bulk-insert.
 * Does NOT delete existing challans/deductees — only adds new ones. If the
 * caller wants replace semantics they should clear existing rows first.
 */
export async function importGeniusXls(
  file: File,
  filing: Filing,
  client: Client,
  formType: string,
  financialYear: string,
  quarter: string,
  resolvedFirmId: string | null,
): Promise<ImportResult> {
  const parsed = await parseGeniusXls(file);
  const warnings: string[] = [];

  // ── Validation: file vs. selected filing ─────────────────────────────────
  const expectedTan = (filing.tan || client.tan_number || "").trim().toUpperCase();
  const fileTan = parsed.deductor.tan.toUpperCase();
  if (expectedTan && fileTan && expectedTan !== fileTan) {
    throw new Error(
      `TAN mismatch: file is for ${fileTan} but the selected filing is for ${expectedTan}. ` +
      `Please select the correct client/filing before importing.`
    );
  }
  if (parsed.deductor.formNo && parsed.deductor.formNo.toUpperCase() !== formType.toUpperCase()) {
    warnings.push(
      `Form mismatch: file is for ${parsed.deductor.formNo} but filing is for ${formType}. Importing anyway.`
    );
  }
  if (parsed.deductor.quarter && parsed.deductor.quarter.toUpperCase() !== quarter.toUpperCase()) {
    warnings.push(
      `Quarter mismatch: file is for ${parsed.deductor.quarter} but filing is for ${quarter}. Importing anyway.`
    );
  }
  if (parsed.challans.length === 0) {
    throw new Error("No challans found in the file. Nothing to import.");
  }

  // ── Insert challans ──────────────────────────────────────────────────────
  const firmId = resolvedFirmId || filing.firm_id || null;
  const challanPayloads = parsed.challans.map(c => {
    const p: any = {
      filing_id: filing.id,
      client_id: filing.client_id,
      firm_id: firmId,
      form_type: formType,
      financial_year: financialYear,
      quarter: quarter,
      bsr_code: c.bsrCode,
      challan_serial_no: c.bankChallanNo,
      deposit_date: c.depositDate,
      total_tax_deposited: c.incomeTax,
      surcharge_deposited: c.surcharge,
      education_cess_deposited: c.cess,
      interest_deposited: c.interest,
      others_deposited: c.others,
      total_challan_amount: c.totalDeposited,
      minor_head_of_challan: c.minorHead || "200",
      is_book_entry: c.isBookEntry,
      transfer_voucher_no: c.isBookEntry ? c.bankChallanNo : null,
      section_code: c.sectionCode || null,
      late_fees_234e: c.lateFee234E,
      cheque_dd_no: c.chequeDdNo || null,
    };
    return p;
  });

  // Try insert WITH late_fees_234e; fall back if column missing in DB
  let insertedChallans: any[] | null = null;
  {
    const { data, error } = await supabase
      .from("tds_challans")
      .insert(challanPayloads as any)
      .select("*");
    if (error && (error.message?.includes("late_fees_234e") || error.message?.includes("schema cache"))) {
      warnings.push("late_fees_234e column missing in DB — imported without it (apply migration).");
      const stripped = challanPayloads.map(({ late_fees_234e: _, ...rest }) => rest);
      const retry = await supabase
        .from("tds_challans")
        .insert(stripped as any)
        .select("*");
      if (retry.error) throw new Error(`Failed to insert challans: ${retry.error.message}`);
      insertedChallans = (retry.data as any[]) || [];
    } else if (error) {
      throw new Error(`Failed to insert challans: ${error.message}`);
    } else {
      insertedChallans = (data as any[]) || [];
    }
  }

  if (!insertedChallans || insertedChallans.length !== parsed.challans.length) {
    throw new Error(
      `Inserted ${insertedChallans?.length ?? 0} challans but expected ${parsed.challans.length}`
    );
  }

  // Build map: Genius serial no (1,2,3…) → new DB UUID.
  // Insert order matches parsed order, so index i → parsed.challans[i].serialNo.
  const serialToId = new Map<number, string>();
  parsed.challans.forEach((ch, i) => {
    serialToId.set(ch.serialNo, insertedChallans![i].id as string);
  });

  // ── Insert deductees ─────────────────────────────────────────────────────
  if (parsed.deductees.length === 0) {
    return {
      parsed,
      challansInserted: insertedChallans.length,
      deducteesInserted: 0,
      warnings,
    };
  }

  const deducteePayloads: any[] = [];
  const orphanDeductees: number[] = [];
  parsed.deductees.forEach((d, idx) => {
    const challanId = serialToId.get(d.challanSerialNo);
    if (!challanId) {
      orphanDeductees.push(idx + 2); // row number in Excel (1-indexed + header)
      return;
    }
    deducteePayloads.push({
      challan_id: challanId,
      filing_id: filing.id,
      client_id: filing.client_id,
      firm_id: firmId,
      form_type: formType,
      financial_year: financialYear,
      quarter: quarter,
      deductee_name: d.name,
      deductee_pan: d.pan || null,
      deductee_ref_no: d.refNo || null,
      deductee_type: d.deducteeType || null,
      section_code: d.sectionCode,
      amount_paid_credited: d.amountPaid,
      date_of_payment: d.datePaid,
      date_of_deduction: d.dateOfDeduction || d.datePaid,
      rate_of_tds: d.rateOfTds,
      surcharge_rate: d.surchargeRate,
      tds_amount: d.tdsAmount,
      surcharge_amount: d.surchargeAmount,
      cess_amount: d.cessAmount,
      total_tax_deducted: d.totalTaxDeducted,
      reason_for_lower_or_nil_deduction: d.reason || null,
      lower_deduction_certificate_no: d.certificateNo || null,
    });
  });

  if (orphanDeductees.length > 0) {
    warnings.push(
      `Skipped ${orphanDeductees.length} deductee row(s) that reference a Challan Serial No. ` +
      `not present in the Challan Details sheet (excel rows: ${orphanDeductees.slice(0, 5).join(", ")}${orphanDeductees.length > 5 ? "…" : ""}).`
    );
  }

  let insertedDeductees = 0;
  if (deducteePayloads.length > 0) {
    const { data, error } = await supabase
      .from("tds_deductees")
      .insert(deducteePayloads as any)
      .select("id");
    if (error) {
      throw new Error(
        `Inserted ${insertedChallans.length} challans but failed to insert deductees: ${error.message}. ` +
        `You may want to delete the imported challans and try again.`
      );
    }
    insertedDeductees = (data as any[])?.length ?? 0;
  }

  return {
    parsed,
    challansInserted: insertedChallans.length,
    deducteesInserted: insertedDeductees,
    warnings,
  };
}
