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

/** Read a cell by row/column INDEX ("" / 0 / null when the column is absent). */
const strAt = (ws: XLSX.WorkSheet, r: number, c: number | undefined): string =>
  (c === undefined || c < 0) ? "" : cellStr(ws, XLSX.utils.encode_cell({ r, c }));
const numAt = (ws: XLSX.WorkSheet, r: number, c: number | undefined): number =>
  (c === undefined || c < 0) ? 0 : cellNum(ws, XLSX.utils.encode_cell({ r, c }));
const dateAt = (ws: XLSX.WorkSheet, r: number, c: number | undefined): string | null =>
  (c === undefined || c < 0) ? null : parseDdmmyyyy(ws[XLSX.utils.encode_cell({ r, c })]?.v as string | number | undefined);

/** Read a sheet's header row (row 0) across its used width, for column matching. */
function readHeaderRow(ws: XLSX.WorkSheet): unknown[] {
  const range = XLSX.utils.decode_range(ws["!ref"] || "A1:A1");
  const out: unknown[] = [];
  for (let c = 0; c <= Math.min(range.e.c, 300); c++) out.push(ws[XLSX.utils.encode_cell({ r: 0, c })]?.v ?? null);
  return out;
}

/** Map Genius deductee code ("01-Companies", "02-Other than Companies") → app value. */
function parseDeducteeType(raw: string): string {
  const s = (raw || "").trim();
  if (s.startsWith("01")) return "Company";
  if (s.startsWith("02")) return "Non-Company";
  return s; // leave as-is if non-standard
}

/** Strip Genius's internal numeric prefix from a section code: "1023-194C" → "194C". */
function cleanSection(raw: string | number | null | undefined): string {
  const s = String(raw ?? "").trim();
  const m = s.match(/^\d+-(.+)$/);
  return (m ? m[1] : s).trim().toUpperCase();
}

/** Normalise a header cell for matching: lowercase, collapse whitespace + newlines. */
const normHeader = (s: unknown): string => String(s ?? "").toLowerCase().replace(/\s+/g, " ").trim();

interface ColSpec { field: string; match: (h: string) => boolean; fallback?: number; }

/**
 * Resolve each field's COLUMN INDEX from the sheet's header row by matching the
 * header TEXT — not a hard-coded position. Genius / TRACES emit the same fields in
 * more than one layout: some files carry a "Deductee Ref No" column (shifting every
 * later column by one), the cess column is split into a rate and an amount, etc. A
 * fixed-index reader silently mis-reads whichever layout it wasn't written for —
 * the Name lands on an Address column, the Amount on a date (this is exactly why
 * SWASTIK BUILDCON imported blank amounts/TDS). Matching by header makes the parser
 * layout-agnostic. `fallback` (the canonical FVU order) is used ONLY when a header
 * can't be matched, so an unfamiliar variant degrades gracefully instead of
 * failing. First unclaimed header match wins; a claimed column is never reused. */
function buildColMap(headerRow: unknown[], spec: ColSpec[]): Record<string, number> {
  const hs = headerRow.map(normHeader);
  const claimed = new Set<number>();
  const map: Record<string, number> = {};
  for (const { field, match } of spec) {
    for (let c = 0; c < hs.length; c++) {
      if (claimed.has(c) || !hs[c]) continue;
      if (match(hs[c])) { map[field] = c; claimed.add(c); break; }
    }
  }
  for (const { field, fallback } of spec) {
    if (map[field] === undefined && fallback !== undefined && !claimed.has(fallback)) {
      map[field] = fallback; claimed.add(fallback);
    }
  }
  return map;
}

/** Header→field matchers for the ChallanDetails sheet (fallbacks = canonical FVU order). */
const CHALLAN_COLS: ColSpec[] = [
  { field: "serialNo",       match: (h) => /challan serial/.test(h),                         fallback: 0 },
  { field: "sectionCode",    match: (h) => /section code/.test(h),                           fallback: 1 },
  { field: "incomeTax",      match: (h) => /income tax/.test(h),                             fallback: 2 },
  { field: "surcharge",      match: (h) => /^surcharge$/.test(h),                            fallback: 3 },
  { field: "cess",           match: (h) => /^(health and education )?cess$|education cess$/.test(h), fallback: 4 },
  { field: "interest",       match: (h) => /interest/.test(h),                               fallback: 5 },
  { field: "lateFee234E",    match: (h) => /late fee|fee.*234e/.test(h),                      fallback: 6 },
  { field: "others",         match: (h) => /^others?$/.test(h),                              fallback: 7 },
  { field: "totalDeposited", match: (h) => /total tax deposited/.test(h),                    fallback: 8 },
  { field: "chequeDdNo",     match: (h) => /cheque|dd no/.test(h),                           fallback: 9 },
  { field: "bsrCode",        match: (h) => /bsr/.test(h),                                    fallback: 10 },
  { field: "depositDate",    match: (h) => /date on which tax deposited|deposit date/.test(h), fallback: 11 },
  { field: "bankChallanNo",  match: (h) => /bank challan|transfer vouch/.test(h),            fallback: 12 },
  { field: "isBookEntry",    match: (h) => /book entry/.test(h),                             fallback: 13 },
  { field: "minorHead",      match: (h) => /minor head/.test(h),                             fallback: 14 },
];

/** Header→field matchers for the Annex-I Deductee sheet (fallbacks = canonical FVU order, no Ref-No column). */
const DEDUCTEE_COLS: ColSpec[] = [
  { field: "challanSerialNo",  match: (h) => /challan serial/.test(h),                       fallback: 0 },
  { field: "sectionCode",      match: (h) => /section code/.test(h),                         fallback: 1 },
  { field: "deducteeType",     match: (h) => /deductee code/.test(h),                        fallback: 2 },
  { field: "pan",              match: (h) => /permanent account number|\bpan\b/.test(h),     fallback: 3 },
  { field: "name",             match: (h) => /name of (the )?deductee|deductee name/.test(h), fallback: 4 },
  { field: "refNo",            match: (h) => /(deductee|party).*\bref|ref(erence)?\.?\s*(no|number)/.test(h) },
  { field: "amountPaid",       match: (h) => /amount of payment|amount paid|amount credited/.test(h), fallback: 12 },
  { field: "datePaid",         match: (h) => /date on which amount|date of payment|date.*paid.*credit/.test(h), fallback: 13 },
  { field: "rateOfTds",        match: (h) => /rate at which tax|rate of tds/.test(h) || h === "rate", fallback: 14 },
  { field: "surchargeRate",    match: (h) => /surcharge rate/.test(h),                       fallback: 15 },
  { field: "cessRate",         match: (h) => /cess rate/.test(h),                            fallback: 16 },
  { field: "tdsAmount",        match: (h) => /amount of tax deducted|tds amount|amount of tax/.test(h), fallback: 17 },
  { field: "surchargeAmount",  match: (h) => /surcharge amount/.test(h),                     fallback: 18 },
  { field: "cessAmount",       match: (h) => /cess amount/.test(h),                          fallback: 19 },
  { field: "totalTaxDeducted", match: (h) => /total tax deposited|total tax deducted/.test(h), fallback: 20 },
  { field: "dateOfDeduction",  match: (h) => /date on which tax deducted|date of deduction/.test(h), fallback: 21 },
  { field: "reason",           match: (h) => /reason/.test(h),                               fallback: 22 },
  { field: "certificateNo",    match: (h) => /certificate/.test(h),                          fallback: 23 },
];

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
  // Genius writes the form as "140 (26Q)" / "27EQ" etc. — extract the bare form
  // token so the downstream form-match check compares "26Q" to "26Q", not to
  // "140 (26Q)" (which would raise a spurious mismatch warning).
  const rawForm = cellStr(detailSheet, "C6");
  const formTok = rawForm.match(/\b(24Q|26Q|27Q|27EQ)\b/i);
  const deductor = {
    tan:            cellStr(detailSheet, "B1"),
    pan:            cellStr(detailSheet, "B2"),
    name:           cellStr(detailSheet, "B3"),
    assessmentYear: cellStr(detailSheet, "C2"),
    quarter:        cellStr(detailSheet, "C4") || "Q1",
    formNo:         (formTok ? formTok[1].toUpperCase() : rawForm) || "26Q",
  };

  // ── Challans (row 2+) — columns resolved by HEADER TEXT, not position ─────
  const challans: ParsedChallan[] = [];
  const chMap = buildColMap(readHeaderRow(challanSheet), CHALLAN_COLS);
  const chRange = XLSX.utils.decode_range(challanSheet["!ref"] || "A1:Q1");
  for (let r = 1; r <= chRange.e.r; r++) {
    // Stop at the first row with neither a serial nor a section (end of the list;
    // also shrugs off a bloated !ref that claims tens of thousands of empty rows).
    const serial = strAt(challanSheet, r, chMap.serialNo);
    const section = strAt(challanSheet, r, chMap.sectionCode);
    if (!serial && !section) break;
    challans.push({
      serialNo:       numAt(challanSheet, r, chMap.serialNo),
      sectionCode:    cleanSection(strAt(challanSheet, r, chMap.sectionCode)),
      incomeTax:      numAt(challanSheet, r, chMap.incomeTax),
      surcharge:      numAt(challanSheet, r, chMap.surcharge),
      cess:           numAt(challanSheet, r, chMap.cess),
      interest:       numAt(challanSheet, r, chMap.interest),
      lateFee234E:    numAt(challanSheet, r, chMap.lateFee234E),
      others:         numAt(challanSheet, r, chMap.others),
      totalDeposited: numAt(challanSheet, r, chMap.totalDeposited),
      chequeDdNo:     strAt(challanSheet, r, chMap.chequeDdNo),
      bsrCode:        strAt(challanSheet, r, chMap.bsrCode),
      depositDate:    dateAt(challanSheet, r, chMap.depositDate),
      bankChallanNo:  strAt(challanSheet, r, chMap.bankChallanNo),
      isBookEntry:    /yes|true|y/i.test(strAt(challanSheet, r, chMap.isBookEntry)),
      minorHead:      strAt(challanSheet, r, chMap.minorHead) || "200",
    });
  }

  // ── Deductees (row 2+) — columns resolved by HEADER TEXT, not position ────
  const deductees: ParsedDeductee[] = [];
  const deMap = buildColMap(readHeaderRow(deducteeSheet), DEDUCTEE_COLS);
  const deRange = XLSX.utils.decode_range(deducteeSheet["!ref"] || "A1:Z1");
  for (let r = 1; r <= deRange.e.r; r++) {
    // Stop at the first FULLY-empty deductee row (no serial, PAN or name).
    const serial = strAt(deducteeSheet, r, deMap.challanSerialNo);
    const pan = strAt(deducteeSheet, r, deMap.pan);
    const name = strAt(deducteeSheet, r, deMap.name);
    if (!serial && !pan && !name) break;
    deductees.push({
      challanSerialNo:   numAt(deducteeSheet, r, deMap.challanSerialNo),
      sectionCode:       cleanSection(strAt(deducteeSheet, r, deMap.sectionCode)),
      deducteeType:      parseDeducteeType(strAt(deducteeSheet, r, deMap.deducteeType)),
      pan:               pan.toUpperCase(),
      refNo:             strAt(deducteeSheet, r, deMap.refNo),
      name,
      amountPaid:        numAt(deducteeSheet, r, deMap.amountPaid),
      datePaid:          dateAt(deducteeSheet, r, deMap.datePaid),
      rateOfTds:         numAt(deducteeSheet, r, deMap.rateOfTds),
      surchargeRate:     numAt(deducteeSheet, r, deMap.surchargeRate),
      cessRate:          numAt(deducteeSheet, r, deMap.cessRate),
      tdsAmount:         numAt(deducteeSheet, r, deMap.tdsAmount),
      surchargeAmount:   numAt(deducteeSheet, r, deMap.surchargeAmount),
      cessAmount:        numAt(deducteeSheet, r, deMap.cessAmount),
      totalTaxDeducted:  numAt(deducteeSheet, r, deMap.totalTaxDeducted),
      dateOfDeduction:   dateAt(deducteeSheet, r, deMap.dateOfDeduction),
      reason:            strAt(deducteeSheet, r, deMap.reason),
      certificateNo:     strAt(deducteeSheet, r, deMap.certificateNo),
    });
  }

  return { deductor, challans, deductees };
}

// ─── Importer: parse + insert into DB ────────────────────────────────────────

export interface ImportResult {
  parsed: ParsedGeniusFile;
  challansInserted: number;    // newly-created challans
  challansReused: number;      // pre-existing challans whose deductees were attached as carry-forward utilisation
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

  // ── Duplicate detection: Challan Number is globally unique ───────────────
  // BSR code may legitimately repeat (same bank branch handles many deposits)
  // but each Challan Number is unique. If a Challan Number already exists in
  // the DB we DON'T create a new challan — instead we re-use the existing one
  // and link any deductees from this file under Serial N to the existing
  // challan's UUID (but inserted with the CURRENT filing_id so they count as
  // this quarter's utilisation of carry-forward balance).
  //
  // Build map: Challan Number (from file) -> existing challan's UUID
  const existingChallanByNum = new Map<string, { id: string; quarter: string; financial_year: string; form_type: string }>();
  const numList = Array.from(new Set(parsed.challans.map(c => c.bankChallanNo).filter(Boolean)));
  if (numList.length > 0) {
    const { data: existing } = await supabase
      .from("tds_challans")
      .select("id, challan_serial_no, bsr_code, quarter, financial_year, form_type")
      .in("challan_serial_no", numList);
    (existing || []).forEach((row: any) => {
      if (row.challan_serial_no && !existingChallanByNum.has(row.challan_serial_no)) {
        existingChallanByNum.set(String(row.challan_serial_no), {
          id: String(row.id),
          quarter: row.quarter,
          financial_year: row.financial_year,
          form_type: row.form_type,
        });
      }
    });
  }

  const reusedChallans: { fileSerial: number; challanNum: string; from: string }[] = [];
  const newChallans: typeof parsed.challans = [];
  parsed.challans.forEach(c => {
    const existingRec = c.bankChallanNo ? existingChallanByNum.get(c.bankChallanNo) : undefined;
    if (existingRec) {
      reusedChallans.push({
        fileSerial: c.serialNo,
        challanNum: c.bankChallanNo,
        from: `${existingRec.form_type} ${existingRec.quarter} ${existingRec.financial_year}`,
      });
    } else {
      newChallans.push(c);
    }
  });

  if (reusedChallans.length > 0) {
    const sample = reusedChallans.slice(0, 3)
      .map(r => `${r.challanNum} (from ${r.from})`)
      .join("; ");
    warnings.push(
      `Re-using ${reusedChallans.length} existing challan(s) — their deductees in this file will be added ` +
      `as this quarter's utilisation of carry-forward balance: ${sample}${reusedChallans.length > 3 ? "…" : ""}.`
    );
  }
  if (newChallans.length === 0 && reusedChallans.length === 0) {
    return {
      parsed,
      challansInserted: 0,
      challansReused: 0,
      deducteesInserted: 0,
      warnings: [
        ...warnings,
        "Nothing to import — no challans in the file.",
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
  let insertedChallans: any[] = [];
  if (newChallans.length > 0) {
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

    if (insertedChallans.length !== newChallans.length) {
      throw new Error(
        `Inserted ${insertedChallans.length} challans but expected ${newChallans.length}`
      );
    }
  }

  // Build map: Genius serial no (1,2,3…) → challan UUID.
  // Covers BOTH (a) newly-inserted challans and (b) pre-existing challans
  // re-used from prior quarters (so their deductees in this file get linked
  // to the existing UUID but inserted under the current filing_id).
  const serialToId = new Map<number, string>();
  newChallans.forEach((ch, i) => {
    serialToId.set(ch.serialNo, insertedChallans[i].id as string);
  });
  parsed.challans.forEach(c => {
    if (serialToId.has(c.serialNo)) return; // already mapped as new
    const existingRec = c.bankChallanNo ? existingChallanByNum.get(c.bankChallanNo) : undefined;
    if (existingRec) serialToId.set(c.serialNo, existingRec.id);
  });

  // ── Insert deductees ─────────────────────────────────────────────────────
  if (parsed.deductees.length === 0) {
    return {
      parsed,
      challansInserted: insertedChallans.length,
      challansReused: reusedChallans.length,
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
    challansReused: reusedChallans.length,
    deducteesInserted: insertedDeductees,
    warnings,
  };
}
