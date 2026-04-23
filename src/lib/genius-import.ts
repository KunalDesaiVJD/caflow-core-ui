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

  // ── Auto-migration: ensure plain "194C" is usable in dropdowns ───────────
  // Genius uses "194C"; older CAFlow seeds split this into 194C-A / 194C-S.
  // Three jobs (all idempotent):
  //   1. Convert any existing challans/deductees with 194C-A or 194C-S to 194C
  //   2. Delete legacy 194C-A / 194C-S rows from rate_master
  //   3. Ensure a 194C rate_master row exists for this firm + AY + form_type
  //      so the dropdown actually has "194C" as a selectable option after import
  const firmId = resolvedFirmId || filing.firm_id || null;
  if (firmId) {
    try {
      // 1. Normalise existing challan/deductee section codes
      await supabase.from("tds_challans")
        .update({ section_code: "194C" })
        .in("section_code", ["194C-A", "194C-S"]);
      await supabase.from("tds_deductees")
        .update({ section_code: "194C" })
        .in("section_code", ["194C-A", "194C-S"]);

      // 2. Drop legacy rate master rows for this firm
      const { data: deletedLegacy } = await supabase.from("tds_rate_master")
        .delete()
        .eq("firm_id", firmId)
        .in("section_code", ["194C-A", "194C-S"])
        .select("id");
      if (deletedLegacy && deletedLegacy.length > 0) {
        warnings.push(`Merged ${deletedLegacy.length} legacy 194C-A/194C-S rate master row(s) into 194C.`);
      }

      // 3. Ensure 194C exists for this AY + form_type. AY is derived from
      //    the financial year: "2025-26" -> "2026-27".
      const fyParts = (financialYear || "").split("-");
      const ay = fyParts.length === 2
        ? `${parseInt(fyParts[0]) + 1}-${String(parseInt(fyParts[0]) + 2).slice(2)}`
        : "2026-27";
      const { data: existing194C } = await supabase
        .from("tds_rate_master")
        .select("id")
        .eq("firm_id", firmId)
        .eq("assessment_year", ay)
        .eq("form_type", formType)
        .eq("section_code", "194C")
        .limit(1);
      if (!existing194C || existing194C.length === 0) {
        const newRow: any = {
          assessment_year: ay,
          financial_year: financialYear,
          form_type: formType,
          section_code: "194C",
          nature_of_payment: "Contractor / Sub-contractor",
          threshold_individual: 30000,
          threshold_company: 30000,
          rate_individual: 1,
          rate_company: 2,
          rate_no_pan: 20,
          surcharge_applicable: false,
          cess_applicable: false,
          is_active: true,
          effective_from: "2025-04-01",
          effective_to: null,
          notes: "1% for Ind/HUF, 2% for Others. Threshold: ₹30,000 per single transaction OR ₹1,00,000 aggregate in FY.",
          firm_id: firmId,
        };
        const insertRes = await supabase.from("tds_rate_master").insert(newRow as any);
        if (insertRes.error) {
          console.warn("[GeniusImport] Failed to seed 194C rate master row:", insertRes.error.message);
          warnings.push(`Could not add 194C to rate master: ${insertRes.error.message}. Add it manually in Rate Master.`);
        } else {
          warnings.push("Added 194C (Contractor / Sub-contractor) to Rate Master so dropdowns can match it.");
        }
      }
    } catch (mErr: any) {
      console.warn("[GeniusImport] 194C auto-migration skipped:", mErr);
    }
  }

  // ── Resolve bank names from prior challans (Genius file has no bank name col) ──
  // For each unique BSR code in the file, check if this firm has a previous
  // challan with the same BSR that has a VALID bank_name filled in, and reuse
  // it. A valid bank name is any non-empty string that isn't purely numeric
  // (e.g. "30,000" or "5000" — those are amounts accidentally entered in the
  // bank field, not bank names).
  const isValidBankName = (s: string | null | undefined): boolean => {
    if (!s) return false;
    const v = String(s).trim();
    if (!v) return false;
    // Reject values that are only digits/commas/periods/spaces (amounts)
    if (/^[\d,.\s]+$/.test(v)) return false;
    return true;
  };

  const bankByBsr = new Map<string, string>();
  const uniqueBsrs = Array.from(new Set(parsed.challans.map(c => c.bsrCode).filter(Boolean)));
  if (firmId && uniqueBsrs.length > 0) {
    try {
      const { data: priorChallans } = await supabase
        .from("tds_challans")
        .select("id, bsr_code, bank_name")
        .eq("firm_id", firmId)
        .in("bsr_code", uniqueBsrs)
        .not("bank_name", "is", null);

      // One-time data cleanup: any prior challans whose bank_name is purely
      // numeric got there by mistake (amount typed into wrong field OR was
      // propagated from a previous buggy import). Reset them to null so they
      // don't keep propagating on every future import.
      const badIds = (priorChallans || [])
        .filter((r: any) => r.bank_name && !isValidBankName(r.bank_name))
        .map((r: any) => r.id);
      if (badIds.length > 0) {
        await supabase.from("tds_challans")
          .update({ bank_name: null })
          .in("id", badIds);
        warnings.push(`Cleared ${badIds.length} challan(s) that had a numeric value stored in Bank Name (likely an accidental amount entry). Re-enter the actual bank name via Edit Challan if needed.`);
      }

      (priorChallans || []).forEach((row: any) => {
        if (isValidBankName(row.bank_name) && !bankByBsr.has(row.bsr_code)) {
          bankByBsr.set(row.bsr_code, String(row.bank_name).trim());
        }
      });
    } catch (e) {
      console.warn("[GeniusImport] Bank-name BSR lookup failed:", e);
    }
  }
  const missingBankBsrs = uniqueBsrs.filter(b => !bankByBsr.has(b));
  if (missingBankBsrs.length > 0) {
    warnings.push(
      `Bank name not set for BSR ${missingBankBsrs.slice(0, 3).join(", ")}${missingBankBsrs.length > 3 ? "…" : ""}. ` +
      `Genius files don't carry the bank name — edit each challan once to fill it; future imports with the same BSR will auto-populate.`
    );
  }

  // ── Duplicate detection: Challan Number must be globally unique ──────────
  // BSR code may legitimately repeat (same bank branch handles many deposits)
  // but each Challan Number assigned by the bank is unique. Skip any challan
  // whose Challan Number already exists anywhere in tds_challans. Carry-
  // forward is the correct way to use a prior-quarter challan's unused
  // balance — re-adding it would double-count.
  const existingNums = new Set<string>();
  const numList = Array.from(new Set(parsed.challans.map(c => c.bankChallanNo).filter(Boolean)));
  if (numList.length > 0) {
    const { data: existing } = await supabase
      .from("tds_challans")
      .select("challan_serial_no, bsr_code, quarter, financial_year, form_type")
      .in("challan_serial_no", numList);
    (existing || []).forEach((row: any) => {
      if (row.challan_serial_no) existingNums.add(String(row.challan_serial_no));
    });
  }

  const dupChallans: number[] = [];
  const newChallans: typeof parsed.challans = [];
  parsed.challans.forEach(c => {
    if (c.bankChallanNo && existingNums.has(c.bankChallanNo)) {
      dupChallans.push(c.serialNo);
    } else {
      newChallans.push(c);
    }
  });

  if (dupChallans.length > 0) {
    warnings.push(
      `Skipped ${dupChallans.length} duplicate challan(s) with Challan Numbers that already exist in another filing: ` +
      `file row${dupChallans.length > 1 ? "s" : ""} ${dupChallans.slice(0, 5).join(", ")}${dupChallans.length > 5 ? "…" : ""}. ` +
      `Each Challan Number is globally unique — unused balance flows to later quarters via Carry-Forward.`
    );
  }
  if (newChallans.length === 0) {
    return {
      parsed,
      challansInserted: 0,
      deducteesInserted: 0,
      warnings: [
        ...warnings,
        "All challans in this file already exist in another filing — nothing new was imported.",
      ],
    };
  }

  // ── Insert challans ──────────────────────────────────────────────────────
  const challanPayloads = newChallans.map(c => {
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
      bank_name: bankByBsr.get(c.bsrCode) || null,
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

  if (!insertedChallans || insertedChallans.length !== newChallans.length) {
    throw new Error(
      `Inserted ${insertedChallans?.length ?? 0} challans but expected ${newChallans.length}`
    );
  }

  // Build map: Genius serial no (1,2,3…) → new DB UUID.
  // Insert order matches the FILTERED list (newChallans). Skipped duplicates
  // are NOT in this map — deductees that reference a skipped challan will be
  // caught as orphans below.
  const serialToId = new Map<number, string>();
  newChallans.forEach((ch, i) => {
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
  const skippedForDupChallan: number[] = [];
  const dupChallanSet = new Set(dupChallans); // serials of challans skipped as duplicates
  parsed.deductees.forEach((d, idx) => {
    const challanId = serialToId.get(d.challanSerialNo);
    if (!challanId) {
      if (dupChallanSet.has(d.challanSerialNo)) {
        skippedForDupChallan.push(idx + 2);
      } else {
        orphanDeductees.push(idx + 2); // row number in Excel (1-indexed + header)
      }
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
  if (skippedForDupChallan.length > 0) {
    warnings.push(
      `Skipped ${skippedForDupChallan.length} deductee row(s) whose challan was rejected as a duplicate — ` +
      `those deductees already exist under the original challan in its own filing.`
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
