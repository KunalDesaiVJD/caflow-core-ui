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
import { findSeedRate } from "@/lib/tdsRateSeed";
import { assessmentYearToFinancialYear, financialYearToAssessmentYear } from "@/lib/tdsQuarter";
import { getRateForSection, type RateEntry } from "@/lib/tds/rateEngine";

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
  /** 24Q only, keyed by uppercased PAN. Empty when Annex-II has no real rows. */
  salaryDetails: Map<string, ParsedSalaryDetail>;
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

/** 24Q-only: per-employee annual salary break-up, when the file's Annex-II sheet
 *  actually carries it (typically only a Q4/annual return — Q1-Q3 files commonly
 *  leave this sheet as a blank template, since the figures aren't final yet). */
export interface ParsedSalaryDetail {
  pan: string;
  designation: string;
  grossSalary: number;
  standardDeduction: number;
  totalTaxableIncome: number;
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

/** Strip Genius's internal numeric prefix from a section code: "1023-194C" → "194C".
 *
 *  Deliberately does NOT force a case. It used to `.toUpperCase()` the whole cell,
 *  which silently corrupted every section carrying a parenthetical sub-code —
 *  "194J(b)" (Technical Services, 2%) became "194J(B)", matching NOTHING already in
 *  Rate Master (the app's established convention everywhere — Rate Master's own seed
 *  data, section393.ts, every prior rate-master migration — is a LOWERCASE letter
 *  inside the parens; zero uppercase-paren occurrences exist anywhere in the
 *  codebase). Plain codes (194A, 194C, 194H…) were unaffected, since they have no
 *  lowercase letters to corrupt — which is exactly why the Section field went
 *  missing "sometimes" rather than always. Genius already writes the correct
 *  convention; preserving its text verbatim is simpler and safer than re-deriving
 *  casing rules here. ensureRateMasterSections() below still canonicalises
 *  case-insensitively against Rate Master / the standard seed table, so an oddly
 *  cased file is corrected rather than left to manufacture a duplicate section. */
export function cleanSection(raw: string | number | null | undefined): string {
  const s = String(raw ?? "").trim();
  const m = s.match(/^\d+-(.+)$/);
  return (m ? m[1] : s).trim();
}

/**
 * Resolve the file's declared Assessment Year from its own period LABEL and
 * value cell — Genius exports are NOT consistent about what this field means.
 * Some genuinely state an Assessment Year ("A.Y. 2025-26" = FY 2024-25 — see
 * validateFinancialYearMatch's own comment for the real incident this whole
 * check exists to catch). Others state the Financial Year itself directly
 * under a label like "T.Y." ("Tax/Transaction Year") or "F.Y.". Assuming every
 * file is the former is exactly a real reported bug: a file honestly stating
 * "T.Y. 2026-27" (i.e. Financial Year 2026-27) was read as if it said "A.Y.
 * 2026-27", silently shifting it back a year to FY 2025-26 and failing an
 * import into the SAME financial year it was actually for.
 *
 * Only the LITERAL-financial-year case is pre-converted here (to an assessment
 * year, so it round-trips back to the original value through
 * validateFinancialYearMatch's unchanged -1 conversion) — a blank label or a
 * genuine "A.Y." keeps the original, already-correct behaviour exactly as
 * before, so this can never regress the incident the check was built for. */
export function resolveDeclaredAssessmentYear(periodLabel: string, rawPeriodValue: string): string {
  const isLiteralFinancialYearLabel = /\bT\.?\s*Y\.?\b|\bF\.?\s*Y\.?\b|FINANCIAL\s*YEAR/i.test(periodLabel);
  return isLiteralFinancialYearLabel ? financialYearToAssessmentYear(rawPeriodValue) : rawPeriodValue;
}

/**
 * Throw if the Genius file's own Assessment Year doesn't correspond to the
 * SELECTED filing's Financial Year. A hard stop, unlike the Form/Quarter
 * checks in importGeniusXls (which warn and continue) — there is no
 * legitimate reason to import one financial year's challan into a different
 * financial year's filing.
 *
 * A Genius file states its period as an ASSESSMENT YEAR ("A.Y. 2025-26"),
 * never a Financial Year, and the ±1 offset is easy to misread: a file for
 * FY 2024-25 literally shows "2025-26" on screen, which looks like it should
 * mean FY 2025-26 unless the offset is applied. Traced to a real incident: a
 * client's challan (deposit date 07/08/2024 — unambiguously FY 2024-25) was
 * already sitting in the database tagged financial_year "2025-26", and a
 * later import of the same challan for a different quarter would have
 * silently carried the SAME wrong year forward without this check, because
 * client + FY scoping (resolveExistingChallansByNumber) can't tell a
 * consistently-wrong FY from a correct one — only comparing against the
 * file itself can. A malformed/blank Assessment Year is not validated —
 * fails open, matching how Form/Quarter behave on an empty field.
 */
export function validateFinancialYearMatch(assessmentYear: string, financialYear: string): void {
  if (!/^\d{4}-\d{2}$/.test(assessmentYear)) return;
  const fileFinancialYear = assessmentYearToFinancialYear(assessmentYear);
  if (fileFinancialYear !== financialYear) {
    throw new Error(
      `Financial Year mismatch: this file is for Financial Year ${fileFinancialYear} ` +
      `(shown in the file as Assessment Year ${assessmentYear}), but the selected filing is for ` +
      `Financial Year ${financialYear}. A challan deposited for one financial year cannot be imported into a ` +
      `different one — select Financial Year ${fileFinancialYear} before importing this file.`
    );
  }
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
 * failing. First unclaimed header match wins; a claimed column is never reused.
 *
 * `skipFallback` excludes specific fields from the fallback step entirely — for a
 * form whose real column ORDER genuinely differs from the canonical FVU order the
 * fallback numbers assume (24Q's Annex-I has no rate/surcharge-rate/cess-rate/
 * surcharge-amount/cess-amount columns at all, unlike 26Q/27Q), applying a 26Q-shaped
 * fallback position to a 24Q file silently reads whatever unrelated column happens
 * to sit at that index (e.g. the Email column) instead of leaving the field
 * correctly unmapped. Only used where the field's fallback index is KNOWN wrong for
 * that form — 26Q/27Q are unaffected since their headers already match by text. */
function buildColMap(headerRow: unknown[], spec: ColSpec[], skipFallback?: Set<string>): Record<string, number> {
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
    if (map[field] === undefined && fallback !== undefined && !claimed.has(fallback) && !skipFallback?.has(field)) {
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
  // "taxable amount" is 24Q's own phrasing for this same concept — Annex-I for
  // salary returns has no "Amount Paid/Credited" column at all, it's labelled
  // "Taxable amount on which Tax Deducted" instead. Without this alternative the
  // header never matches for 24Q, and the 26Q-shaped fallback (12) lands on a
  // completely unrelated column in 24Q's shorter layout — see skipFallback below.
  { field: "amountPaid",       match: (h) => /amount of payment|amount paid|amount credited|taxable amount/.test(h), fallback: 12 },
  { field: "datePaid",         match: (h) => /date on which amount|date of payment|date.*paid.*credit/.test(h), fallback: 13 },
  { field: "rateOfTds",        match: (h) => /rate at which tax|rate of tds/.test(h) || h === "rate", fallback: 14 },
  { field: "surchargeRate",    match: (h) => /surcharge rate/.test(h),                       fallback: 15 },
  { field: "cessRate",         match: (h) => /cess rate/.test(h),                            fallback: 16 },
  // 24Q's TDS column is headed bare "TDS" (no "amount"/"deducted" qualifier) —
  // the exact-match alternative catches it without loosening the regex enough to
  // false-match some unrelated column elsewhere.
  { field: "tdsAmount",        match: (h) => /amount of tax deducted|tds amount|amount of tax/.test(h) || h === "tds", fallback: 17 },
  { field: "surchargeAmount",  match: (h) => /surcharge amount/.test(h),                     fallback: 18 },
  { field: "cessAmount",       match: (h) => /cess amount/.test(h),                          fallback: 19 },
  { field: "totalTaxDeducted", match: (h) => /total tax deposited|total tax deducted/.test(h), fallback: 20 },
  { field: "dateOfDeduction",  match: (h) => /date on which tax deducted|date of deduction/.test(h), fallback: 21 },
  { field: "reason",           match: (h) => /reason/.test(h),                               fallback: 22 },
  { field: "certificateNo",    match: (h) => /certificate/.test(h),                          fallback: 23 },
];

/** Header→field matchers for 24Q's Annex-II salary annexure. This sheet's header
 *  row carries two near-duplicate columns for Standard Deduction ("...Manual Edit
 *  Flag" vs "...Amount") — the matcher requires the trailing "amount" token and
 *  explicitly excludes "flag" so the right one of the pair is picked. */
const SALARY_COLS: ColSpec[] = [
  { field: "pan",                match: (h) => /employee pan|^pan$/.test(h) },
  { field: "name",               match: (h) => /name of employee/.test(h) },
  { field: "designation",        match: (h) => h === "designation" },
  { field: "grossSalary",        match: (h) => /gross salary/.test(h) && /17\s*\(\s*1\s*\)|provisions/.test(h) },
  { field: "standardDeduction",  match: (h) => /standard deduction/.test(h) && /\bamount\b/.test(h) && !/flag/.test(h) },
  { field: "totalTaxableIncome", match: (h) => /total taxable income/.test(h) },
];

/**
 * Parse 24Q's Annex-II (per-employee annual salary break-up) sheet, when present
 * and actually populated. Genius/most TDS-prep tools leave this sheet as a blank
 * 1000-row template for Q1-Q3 filings (the full-year figures aren't final until
 * Q4), so an empty result here is the COMMON case, not a parse failure — callers
 * should treat it as "nothing to auto-fill", not an error.
 *
 * Keyed by PAN (uppercased) rather than row position: Annex-I and Annex-II are
 * independent sheets with independent row ordering, and PAN is the only reliable
 * join key common to both.
 */
export function parseAnnexIISalaryDetails(ws: XLSX.WorkSheet): Map<string, ParsedSalaryDetail> {
  const result = new Map<string, ParsedSalaryDetail>();
  const map = buildColMap(readHeaderRow(ws), SALARY_COLS);
  if (map.pan === undefined || map.name === undefined) return result;
  const range = XLSX.utils.decode_range(ws["!ref"] || "A1:A1");
  for (let r = 2; r <= range.e.r; r++) {
    const pan = strAt(ws, r, map.pan);
    const name = strAt(ws, r, map.name);
    if (!pan || !name) continue; // blank template row — Annex-II not filled in for this employee
    result.set(pan.toUpperCase(), {
      pan: pan.toUpperCase(),
      designation: strAt(ws, r, map.designation),
      grossSalary: numAt(ws, r, map.grossSalary),
      standardDeduction: numAt(ws, r, map.standardDeduction),
      totalTaxableIncome: numAt(ws, r, map.totalTaxableIncome),
    });
  }
  return result;
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
  // Genius writes the form as "140 (26Q)" / "27EQ" etc. — extract the bare form
  // token so the downstream form-match check compares "26Q" to "26Q", not to
  // "140 (26Q)" (which would raise a spurious mismatch warning).
  const rawForm = cellStr(detailSheet, "C6");
  const formTok = rawForm.match(/\b(24Q|26Q|27Q|27EQ)\b/i);
  const deductor = {
    tan:            cellStr(detailSheet, "B1"),
    pan:            cellStr(detailSheet, "B2"),
    name:           cellStr(detailSheet, "B3"),
    assessmentYear: resolveDeclaredAssessmentYear(cellStr(detailSheet, "C1"), cellStr(detailSheet, "C2")),
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
  // 24Q's Annex-I has no rate/surcharge-rate/cess-rate/surcharge-amount/cess-amount
  // columns at all, unlike 26Q/27Q — the 26Q-shaped fallback positions for those
  // fields would otherwise silently read whatever unrelated column sits there
  // (e.g. the Email column) instead of correctly staying unmapped. See buildColMap.
  // EVERY field after "name" is skipped, not just the five columns 24Q lacks.
  // The fallback indices encode the 26Q layout; 24Q's Annex-I is a SHORTER,
  // DIFFERENTLY-ORDERED sheet, so applying any of them to a 24Q file reads a
  // column that means something else entirely. That is not hypothetical: a
  // real client's Q1 imported with amount_paid_credited = 0 for every employee
  // because "Taxable amount on which Tax Deducted" did not match the header
  // matcher of the day, and fallback 12 — the Amount column in 26Q — is the
  // "Reason for Non-deduction" TEXT column in 24Q. It read text as money,
  // stored 0, and reported success. A field left UNMAPPED is recoverable and
  // is reported below; a field silently bound to the wrong column is not.
  const is24Q = deductor.formNo.toUpperCase() === "24Q";
  const deSkipFallback = is24Q
    ? new Set([
        "deducteeType", "rateOfTds", "surchargeRate", "cessRate", "surchargeAmount", "cessAmount",
        "amountPaid", "datePaid", "tdsAmount", "totalTaxDeducted", "dateOfDeduction", "reason", "certificateNo",
      ])
    : undefined;
  const deductees: ParsedDeductee[] = [];
  const deMap = buildColMap(readHeaderRow(deducteeSheet), DEDUCTEE_COLS, deSkipFallback);

  // VALIDATE THE MAPPING BEFORE READING A SINGLE ROW. On 24Q the taxable
  // figure is the return's core number; importing without it produces a file
  // full of blanks that reads as "the software lost my data". Failing loudly
  // here, naming the headers actually present, is always better than importing
  // zeros — and it is how a genuinely new Genius layout announces itself
  // instead of silently corrupting a filing.
  if (is24Q && deMap.amountPaid === undefined) {
    const headers = readHeaderRow(deducteeSheet)
      .map((h) => (h == null ? "" : String(h).replace(/\s+/g, " ").trim()))
      .filter(Boolean);
    throw new Error(
      `Could not identify the Taxable Amount column in this file's Annex-I sheet, so the import was stopped ` +
      `rather than storing zeros. Expected a header like "Taxable amount on which Tax Deducted" or ` +
      `"Amount of Payment". Headers found: ${headers.join(" | ")}`
    );
  }
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

  // ── 24Q only: Annex-II per-employee salary break-up, when actually filled in ──
  let salaryDetails = new Map<string, ParsedSalaryDetail>();
  if (is24Q) {
    const salarySheetName = wb.SheetNames.find((n) => /annex.*ii.*salary/i.test(n));
    if (salarySheetName) salaryDetails = parseAnnexIISalaryDetails(wb.Sheets[salarySheetName]);
  }

  return { deductor, challans, deductees, salaryDetails };
}

// ─── Importer: parse + insert into DB ────────────────────────────────────────

export interface ImportResult {
  parsed: ParsedGeniusFile;
  challansInserted: number;    // newly-created challans
  challansReused: number;      // pre-existing challans whose deductees were attached as carry-forward utilisation
  deducteesInserted: number;
  warnings: string[];
  /** Detail on each pre-existing challan this import newly attached deductees
   *  to (the combined-payment / cross-form-and-quarter reuse feature — see
   *  resolveExistingChallansByNumber below). Empty when nothing was reused.
   *  Consumed by callers (e.g. TdsDataEntry.tsx) to write one audit-log entry
   *  per reused challan naming which form/quarter its balance is shared FROM. */
  reused: { challanNumber: string; fromForm: string; fromQuarter: string; fromFy: string }[];
}

export interface ExistingChallanRef {
  id: string;
  quarter: string;
  financial_year: string;
  form_type: string;
  bsr_code?: string | null;
  deposit_date?: string | null;
}

export interface ChallanLookupResult {
  /** Safe to reuse: same client, same financial year. */
  reusable: Map<string, ExistingChallanRef>;
  /** Every same-client, same-FY challan per Bank Challan Number — a short
   *  serial number repeats across banks and dates, so the importer picks the
   *  one whose BSR code and deposit date also match (see pickReusableChallan). */
  candidates: Map<string, ExistingChallanRef[]>;
  /** Same client, same Bank Challan Number, but a DIFFERENT financial year —
   *  never reused (a challan cannot legitimately fund a different FY's
   *  return), but worth explaining rather than silently creating a new
   *  challan with no comment. */
  yearMismatched: { challanNumber: string; ref: ExistingChallanRef }[];
}

/**
 * Resolve which of this file's Bank Challan Numbers already exist as a
 * challan for THIS CLIENT, in THIS FINANCIAL YEAR — so importGeniusXls can
 * decide reuse (carry forward) vs. insert a new challan.
 *
 * Scoped to client_id, not merely firm_id — the client scope is load-bearing,
 * not defensive. A Bank Challan Number is a short, often-sequential integer
 * with no cross-client uniqueness guarantee at all (OLTAS numbers it per TAN,
 * never firm-wide), so a firm running 100+ clients WILL see coincidental
 * collisions between unrelated clients. Without this filter, importing
 * client B's genuinely first-ever challan can match client A's unrelated
 * challan number, silently attach B's deductee to A's challan (a real
 * cross-client data-integrity break — B's deductee then points at a challan
 * under a DIFFERENT filing_id, so it vanishes from B's own Challans list,
 * which is exactly what "0 challans added" with an empty Challans list looks
 * like on screen), and report a false "carried forward" success. RLS only
 * scopes tds_challans reads to the FIRM, never the client, so this filter
 * cannot be left to the database to enforce.
 *
 * Also scoped to financial_year — a challan deposit is tied to ONE return
 * period; it cannot legitimately fund a DIFFERENT financial year's filing.
 * A same-client, same-number match in a different FY is reported via
 * `yearMismatched` (so the caller can explain it) rather than silently
 * reused or silently ignored.
 *
 * A client's own Bank Challan Number IS meant to repeat ACROSS QUARTERS of
 * the SAME financial year — a big lump-sum challan can be carried forward
 * and its balance allocated to deductees across several quarters. That
 * legitimate reuse is exactly what `reusable` still enables, just never
 * across two different clients (TANs) or two different financial years.
 */
export async function resolveExistingChallansByNumber(
  bankChallanNumbers: (string | null | undefined)[],
  clientId: string,
  financialYear: string,
): Promise<ChallanLookupResult> {
  const reusable = new Map<string, ExistingChallanRef>();
  const candidates = new Map<string, ExistingChallanRef[]>();
  const yearMismatched: { challanNumber: string; ref: ExistingChallanRef }[] = [];
  const numList = Array.from(new Set(bankChallanNumbers.filter((n): n is string => !!n)));
  if (numList.length === 0) return { reusable, candidates, yearMismatched };

  const { data } = await supabase
    .from("tds_challans")
    .select("id, challan_serial_no, bsr_code, deposit_date, quarter, financial_year, form_type")
    .eq("client_id", clientId)
    .in("challan_serial_no", numList);
  for (const row of (data || []) as any[]) {
    const key = String(row.challan_serial_no ?? "");
    if (!key) continue;
    const ref: ExistingChallanRef = {
      id: String(row.id), quarter: row.quarter, financial_year: row.financial_year, form_type: row.form_type,
      bsr_code: row.bsr_code ?? null, deposit_date: row.deposit_date ?? null,
    };
    if (row.financial_year === financialYear) {
      if (!reusable.has(key)) reusable.set(key, ref);
      const list = candidates.get(key); if (list) list.push(ref); else candidates.set(key, [ref]);
    } else if (!reusable.has(key)) {
      yearMismatched.push({ challanNumber: key, ref });
    }
  }
  return { reusable, candidates, yearMismatched };
}

/**
 * The existing challan that really IS this file's challan. A bank challan is
 * identified by BSR code + deposit date + serial number together — the serial
 * alone is a short number that restarts per bank per day, so two different
 * challans of the same client can share it. Matching on the serial alone
 * attached a 24Q Q1 return's 99 salary entries (₹8,45,043) to an unrelated
 * ₹26,464 challan that happened to also be "00006", which then read as
 * hugely over-applied. A field missing on either side is not compared, so
 * an older row without a BSR or date still matches as before.
 */
export function pickReusableChallan(
  candidates: ExistingChallanRef[] | undefined, bsrCode: string | null | undefined, depositDate: string | null | undefined,
): ExistingChallanRef | undefined {
  const norm = (v: string | null | undefined) => String(v ?? "").trim();
  return (candidates || []).find((ref) =>
    (!norm(bsrCode) || !norm(ref.bsr_code) || norm(ref.bsr_code) === norm(bsrCode)) &&
    (!norm(depositDate) || !norm(ref.deposit_date) || norm(ref.deposit_date).slice(0, 10) === norm(depositDate).slice(0, 10)));
}

/**
 * Ensure every section code this import references exists in the firm's Rate
 * Master, and return a REWRITE MAP so the parsed records use whichever exact
 * casing Rate Master actually has — an existing row's casing if one already
 * matches case-insensitively, else the standard seed table's casing, else the
 * file's own text verbatim for a section CAFlow has never seen. Never a
 * manufactured duplicate: the DB's (assessment_year, form_type, section_code,
 * firm_id) uniqueness is case-SENSITIVE plain text, so two differently-cased
 * spellings of "the same" section would otherwise sit side by side forever,
 * each with its own empty Section dropdown.
 *
 * Generic by construction — this replaced logic that only ever auto-created
 * "194C". Any section a Genius file carries (194J(a), 194J(b), 206C(1G)(a), a
 * code CAFlow has genuinely never seen before) is handled the same way, so a
 * fix here applies to every section and every future client, not one file.
 */
export async function ensureRateMasterSections(
  sectionCodes: string[],
  firmId: string,
  formType: string,
  financialYear: string,
): Promise<{ rewrite: Map<string, string>; warnings: string[] }> {
  const rewrite = new Map<string, string>();
  const warnings: string[] = [];
  const distinct = Array.from(new Set(sectionCodes.map((s) => s.trim()).filter(Boolean)));
  if (distinct.length === 0) return { rewrite, warnings };

  // AY is derived from the financial year: "2025-26" -> "2026-27".
  const fyParts = (financialYear || "").split("-");
  const ay = fyParts.length === 2
    ? `${parseInt(fyParts[0]) + 1}-${String(parseInt(fyParts[0]) + 2).slice(2)}`
    : "2026-27";
  const fyStart = fyParts.length === 2 ? fyParts[0] : "2025";

  // is_active=true only — a DEACTIVATED row (e.g. a mistyped/superseded code
  // fixed by a data-hygiene migration) must never be treated as "the"
  // canonical existing entry for a code, or a repeat import would keep
  // reusing the retired code forever instead of falling through to the seed
  // table / alias resolution below.
  const { data: existing } = await supabase
    .from("tds_rate_master")
    .select("section_code")
    .eq("firm_id", firmId)
    .eq("assessment_year", ay)
    .eq("form_type", formType)
    .eq("is_active", true);
  const existingByUpper = new Map<string, string>();
  for (const row of existing || []) {
    const code = String((row as any)?.section_code ?? "");
    if (code) existingByUpper.set(code.toUpperCase(), code);
  }

  const toInsert: Record<string, unknown>[] = [];
  const queuedCanonical = new Set<string>(); // de-dup within this one insert batch
  for (const raw of distinct) {
    const already = existingByUpper.get(raw.toUpperCase());
    if (already) { rewrite.set(raw, already); continue; }

    const seed = findSeedRate(raw, formType);
    const canonical = seed ? seed.section_code : raw;
    rewrite.set(raw, canonical);
    if (queuedCanonical.has(canonical)) continue;
    queuedCanonical.add(canonical);

    if (seed) {
      toInsert.push({
        assessment_year: ay, financial_year: financialYear, form_type: formType,
        section_code: seed.section_code, section_description: seed.section_description,
        nature_of_payment: seed.nature_of_payment,
        threshold_individual: seed.threshold_individual, threshold_company: seed.threshold_company,
        rate_individual: seed.rate_individual, rate_company: seed.rate_company, rate_no_pan: seed.rate_no_pan,
        surcharge_applicable: seed.surcharge_applicable, cess_applicable: seed.cess_applicable,
        is_active: true, effective_from: seed.effective_from, effective_to: seed.effective_to,
        notes: seed.notes, firm_id: firmId,
      });
      warnings.push(`Added ${seed.section_code} (${seed.nature_of_payment || "—"}) to Rate Master using CAflow's standard rate table.`);
    } else {
      // A code CAFlow has no standard rate for. Create it anyway — the section
      // must be SELECTABLE and the record must never be silently unfileable —
      // but with rate 0 and a note, so the CA is told to verify it rather than
      // the software guessing a rate it doesn't actually know.
      toInsert.push({
        assessment_year: ay, financial_year: financialYear, form_type: formType,
        section_code: raw, section_description: null, nature_of_payment: null,
        threshold_individual: 0, threshold_company: 0,
        rate_individual: 0, rate_company: 0, rate_no_pan: 20,
        surcharge_applicable: false, cess_applicable: false,
        is_active: true, effective_from: `${fyStart}-04-01`, effective_to: null,
        notes: "Auto-created from Genius import — rate/threshold not in CAflow's standard table. Please verify in Rate Master.",
        firm_id: firmId,
      });
      warnings.push(`Added ${raw} to Rate Master as a placeholder (rate 0%) — it isn't in CAflow's standard table. Please verify its rate and threshold in Rate Master.`);
    }
  }

  if (toInsert.length > 0) {
    const { error } = await supabase.from("tds_rate_master")
      .upsert(toInsert as any[], { onConflict: "assessment_year,form_type,section_code,firm_id" });
    if (error) {
      console.warn("[GeniusImport] Failed to auto-create Rate Master section(s):", error.message);
      warnings.push(`Could not add some section(s) to Rate Master automatically: ${error.message}. Add them manually in Rate Master.`);
    }
  }

  return { rewrite, warnings };
}

export interface RepairResult {
  challansFixed: number;
  deducteesFixed: number;
  warnings: string[];
}

/**
 * Repair a filing's ALREADY-STORED challan/deductee rows whose section_code
 * was corrupted by a past bug, or whose section still has no Rate Master row
 * — WITHOUT re-importing or duplicating a single record.
 *
 * Fixing the importer (ensureRateMasterSections above) stops NEW corruption.
 * It does nothing for rows a firm already imported before the fix — those
 * stay broken (blank Section dropdown, "Differs from challan") forever
 * unless something goes back and repairs the text actually sitting in the
 * database. Re-importing the same file is not that something: challans dedupe
 * by Challan Number, but deductees do not, so a second import of an
 * already-imported file DOUBLES the deductee rows instead of correcting them.
 *
 * Safe to call on every filing load: reuses the same canonicalisation
 * ensureRateMasterSections uses for a fresh import, then rewrites in place
 * only the rows whose stored text doesn't already match the canonical form —
 * a filing with nothing to fix costs two reads and zero writes.
 */
export async function repairFilingSectionCodes(
  filingId: string,
  firmId: string,
  formType: string,
  financialYear: string,
): Promise<RepairResult> {
  const [{ data: challans }, { data: deductees }] = await Promise.all([
    supabase.from("tds_challans").select("id, section_code").eq("filing_id", filingId),
    supabase.from("tds_deductees").select("id, section_code").eq("filing_id", filingId),
  ]);

  const allCodes = [
    ...(challans || []).map((c: any) => String(c.section_code ?? "")),
    ...(deductees || []).map((d: any) => String(d.section_code ?? "")),
  ];
  const { rewrite, warnings } = await ensureRateMasterSections(allCodes, firmId, formType, financialYear);

  // Group by the TARGET canonical value, so every row sharing one wrong
  // spelling is corrected in a single UPDATE instead of one call per row.
  const groupByCanonical = (rows: { id: string; section_code: string }[]) => {
    const groups = new Map<string, string[]>();
    for (const r of rows) {
      const raw = String(r.section_code ?? "");
      const canonical = rewrite.get(raw);
      if (canonical && canonical !== raw) {
        const ids = groups.get(canonical) ?? [];
        ids.push(r.id);
        groups.set(canonical, ids);
      }
    }
    return groups;
  };

  let challansFixed = 0;
  for (const [canonical, ids] of groupByCanonical((challans || []) as any[])) {
    const { error } = await supabase.from("tds_challans")
      .update({ section_code: canonical }).eq("firm_id", firmId).in("id", ids);
    if (!error) challansFixed += ids.length;
  }

  let deducteesFixed = 0;
  for (const [canonical, ids] of groupByCanonical((deductees || []) as any[])) {
    const { error } = await supabase.from("tds_deductees")
      .update({ section_code: canonical }).eq("firm_id", firmId).in("id", ids);
    if (!error) deducteesFixed += ids.length;
  }

  return { challansFixed, deducteesFixed, warnings };
}

/**
 * Finds every imported deductee row whose Section is Individual/HUF-only
 * (e.g. 194C(a)) but whose own deducteeType is literally "Company" — a
 * combination that can never be legitimate (see getRateForSection's
 * sectionRestrictedToIndividual for the same guard, and the doc comment on
 * its call site in importGeniusXls for the real-world incident this closes).
 * Returns one human-readable, row-numbered message per violation; an empty
 * array means the file is clean. Pure and independently testable on purpose —
 * importGeniusXls only wires it to a rate-master fetch and a throw.
 */
export function findCompanySectionViolations(
  deductees: ParsedDeductee[], rateMaster: RateEntry[],
): string[] {
  const violations: string[] = [];
  deductees.forEach((d, idx) => {
    const { sectionRestrictedToIndividual } = getRateForSection(rateMaster, d.sectionCode, d.deducteeType, d.datePaid);
    if (sectionRestrictedToIndividual) {
      violations.push(
        `Row ${idx + 2}: "${d.name || "—"}" is a Company but is entered under ${d.sectionCode}, which is Individual/HUF-only ` +
        `(rate ${d.rateOfTds}%). Companies must use the "Others" variant of this section instead.`
      );
    }
  });
  return violations;
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
  validateFinancialYearMatch(parsed.deductor.assessmentYear, financialYear);
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

  // ── Legacy data migration: 194C-A / 194C-S → 194C ────────────────────────
  // Genius uses plain "194C"; older CAFlow seeds split this into 194C-A
  // (Aggregate) / 194C-S (Single transaction) — the same rate, a CAflow-only
  // schema quirk from before Genius round-trips existed, not something any
  // Genius file itself would emit. Unrelated to section auto-creation below;
  // this only cleans up any of THIS firm's already-imported historical rows.
  const firmId = resolvedFirmId || filing.firm_id || null;
  if (firmId) {
    try {
      await supabase.from("tds_challans")
        .update({ section_code: "194C" })
        .in("section_code", ["194C-A", "194C-S"]);
      await supabase.from("tds_deductees")
        .update({ section_code: "194C" })
        .in("section_code", ["194C-A", "194C-S"]);
      const { data: deletedLegacy } = await supabase.from("tds_rate_master")
        .delete()
        .eq("firm_id", firmId)
        .in("section_code", ["194C-A", "194C-S"])
        .select("id");
      if (deletedLegacy && deletedLegacy.length > 0) {
        warnings.push(`Merged ${deletedLegacy.length} legacy 194C-A/194C-S rate master row(s) into 194C.`);
      }
    } catch (mErr: any) {
      console.warn("[GeniusImport] 194C-A/194C-S legacy migration skipped:", mErr);
    }

    // ── Ensure every section THIS FILE references is usable in dropdowns ────
    // Generic — covers 194C exactly the way it covers 194J(a), 194J(b),
    // 206C(1G)(a), or a code CAFlow has never seen. See
    // ensureRateMasterSections() for why this replaced a 194C-only special case.
    try {
      const codesInFile = [
        ...parsed.challans.map((c) => c.sectionCode),
        ...parsed.deductees.map((d) => d.sectionCode),
      ];
      const { rewrite, warnings: sectionWarnings } =
        await ensureRateMasterSections(codesInFile, firmId, formType, financialYear);
      warnings.push(...sectionWarnings);
      // Apply the rewrite so every inserted record uses the EXACT casing Rate
      // Master now has for its section — never the file's own casing verbatim,
      // which is what let a correctly-existing-but-differently-cased Rate
      // Master row still fail to match.
      for (const c of parsed.challans) {
        const mapped = rewrite.get(c.sectionCode);
        if (mapped) c.sectionCode = mapped;
      }
      for (const d of parsed.deductees) {
        const mapped = rewrite.get(d.sectionCode);
        if (mapped) d.sectionCode = mapped;
      }
    } catch (sErr: any) {
      console.warn("[GeniusImport] Section auto-creation skipped:", sErr);
    }
  }

  // ── Validation: a deductee row's own type/section combination must be a
  // real one ─────────────────────────────────────────────────────────────
  // Section 393 split some sections into an Individual/HUF-only variant and
  // an "Others" variant at a DIFFERENT rate (194C(a) 1% vs 194C(b) 2%) — a
  // "Company" deductee can never legitimately fall under the Individual/HUF
  // variant, no matter what rate the file itself claims. This exact
  // combination (a Ltd company imported under 194C(a) at 1% instead of
  // 194C(b) at 2%) previously imported silently, with the rate then LOCKED
  // in Data Entry as "auto-computed" so the wrong deduction was never even
  // visible to correct — see getRateForSection in rateEngine.ts for the same
  // guard applied there. Checked here too so the bad row is rejected AT
  // IMPORT, before any challan or deductee is written, rather than caught
  // only after it's already live on the return.
  //
  // Deliberately checked against getRateForSection's own
  // sectionRestrictedToIndividual flag — NOT a broader "rate doesn't match
  // rate master" check — to stay exactly as narrowly scoped as the Data
  // Entry fix: "Non-Company" is the file format's own valid status code for
  // the Individual/HUF rate and must never be flagged.
  if (firmId) {
    try {
      const { data: rmRows } = await supabase.from("tds_rate_master")
        .select("section_code, nature_of_payment, rate_individual, rate_company, rate_no_pan, threshold_individual, threshold_company, effective_from, effective_to, payment_code, new_section_code, new_section_description")
        .eq("form_type", formType).eq("financial_year", financialYear).eq("is_active", true);
      const rateMaster = (rmRows || []) as RateEntry[];
      const violations = findCompanySectionViolations(parsed.deductees, rateMaster);
      if (violations.length > 0) {
        throw new Error(
          `Import rejected — ${violations.length} row(s) have an invalid Company/Section combination:\n` +
          violations.slice(0, 10).join("\n") +
          (violations.length > 10 ? `\n…and ${violations.length - 10} more.` : "") +
          `\n\nFix these row(s) in the Genius file (use the correct section for a company) and re-import.`
        );
      }
    } catch (e: any) {
      // A genuine validation failure (the throw above) must propagate and
      // block the import — only a lookup/infra error (rate master fetch
      // itself failing) is swallowed, matching every other best-effort
      // enrichment step in this function.
      if (e instanceof Error && e.message.startsWith("Import rejected")) throw e;
      console.warn("[GeniusImport] Company/section validation skipped:", e);
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

  // Build map: Challan Number (from file) -> existing challan's UUID, scoped
  // to THIS client AND this financial year. See resolveExistingChallansByNumber()
  // for why both scopes are load-bearing rather than defensive.
  const { candidates: existingChallansByNum, yearMismatched } = await resolveExistingChallansByNumber(
    parsed.challans.map((c) => c.bankChallanNo), filing.client_id, financialYear,
  );
  const existingChallanFor = (c: { bankChallanNo: string; bsrCode: string; depositDate: string | null }) =>
    c.bankChallanNo ? pickReusableChallan(existingChallansByNum.get(c.bankChallanNo), c.bsrCode, c.depositDate) : undefined;

  if (yearMismatched.length > 0) {
    const sample = yearMismatched.slice(0, 3)
      .map((m) => `${m.challanNumber} (already exists for FY ${m.ref.financial_year})`)
      .join("; ");
    warnings.push(
      `Challan Number${yearMismatched.length > 1 ? "s" : ""} already exist for this client under a DIFFERENT financial year — ` +
      `a challan cannot be carried across financial years, so a NEW challan was created for FY ${financialYear} instead: ` +
      `${sample}${yearMismatched.length > 3 ? "…" : ""}.`
    );
  }

  const reusedChallans: { fileSerial: number; challanNum: string; from: string; fromForm: string; fromQuarter: string; fromFy: string }[] = [];
  const newChallans: typeof parsed.challans = [];
  parsed.challans.forEach(c => {
    const existingRec = existingChallanFor(c);
    if (existingRec) {
      reusedChallans.push({
        fileSerial: c.serialNo,
        challanNum: c.bankChallanNo,
        from: `${existingRec.form_type} ${existingRec.quarter} ${existingRec.financial_year}`,
        fromForm: existingRec.form_type,
        fromQuarter: existingRec.quarter,
        fromFy: existingRec.financial_year,
      });
    } else {
      newChallans.push(c);
    }
  });
  // Structured (non-string) form for callers that need to log per-challan
  // audit entries rather than parse the human-readable `from` sentence above.
  const reusedForCaller = () => reusedChallans.map(r => ({
    challanNumber: r.challanNum, fromForm: r.fromForm, fromQuarter: r.fromQuarter, fromFy: r.fromFy,
  }));

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
      reused: [],
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
    const existingRec = existingChallanFor(c);
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
      reused: reusedForCaller(),
    };
  }

  const deducteePayloads: any[] = [];
  const orphanDeductees: number[] = [];
  const salaryMatchedPans = new Set<string>();
  parsed.deductees.forEach((d, idx) => {
    const challanId = serialToId.get(d.challanSerialNo);
    if (!challanId) {
      orphanDeductees.push(idx + 2); // row number in Excel (1-indexed + header)
      return;
    }
    const salary = d.pan ? parsed.salaryDetails.get(d.pan.toUpperCase()) : undefined;
    if (salary) salaryMatchedPans.add(salary.pan);
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
      // 24Q only. Designation/Gross Salary/Standard Deduction have NO source
      // anywhere in a Q1-Q3 file — Annex-II (the only sheet that would carry
      // them) is a blank 1000-row template until the return's final quarter,
      // confirmed against two real clients' files this session — so these stay
      // undefined (manual entry via Salary Computation) unless Annex-II actually
      // has the employee's row.
      //
      // net_taxable_salary is different: Annex-I's "Taxable amount on which Tax
      // Deducted" (d.amountPaid, now correctly parsed — see amountPaid's header
      // matcher above) IS that same figure under Rule 31A/section 192 — the
      // employer's own running Total Taxable Income estimate for this employee,
      // which is exactly what this column means. Falling back to it (when
      // Annex-II hasn't supplied a more authoritative one) means the Taxable
      // column shows the return's own real number for every 24Q import, instead
      // of a blank the CA must re-key from the same file by hand.
      ...(formType === "24Q" ? {
        designation: salary?.designation || undefined,
        gross_salary: salary?.grossSalary || undefined,
        standard_deduction_allowed: salary?.standardDeduction || undefined,
        net_taxable_salary: salary?.totalTaxableIncome || d.amountPaid || undefined,
      } : {}),
    });
  });

  if (orphanDeductees.length > 0) {
    warnings.push(
      `Skipped ${orphanDeductees.length} deductee row(s) that reference a Challan Serial No. ` +
      `not present in the Challan Details sheet (excel rows: ${orphanDeductees.slice(0, 5).join(", ")}${orphanDeductees.length > 5 ? "…" : ""}).`
    );
  }
  if (formType.toUpperCase() === "24Q") {
    if (salaryMatchedPans.size > 0) {
      warnings.push(
        `Auto-filled Gross Salary / Standard Deduction / Taxable Income for ${salaryMatchedPans.size} ` +
        `employee(s) from this file's Annex-II salary details.`
      );
    } else {
      warnings.push(
        `This file's Annex-II (salary break-up) sheet has no employee data, so Taxable Income was filled in ` +
        `from Annex-I's own "Taxable amount on which Tax Deducted" figure — but Gross Salary and Standard ` +
        `Deduction have no source in this file and need manual entry via each employee's Salary Computation. ` +
        `This is normal for Q1-Q3 filings; a Q4/annual return with Annex-II filled in will auto-fill all three.`
      );
    }
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
    reused: reusedForCaller(),
  };
}
