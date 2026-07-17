/**
 * CENTRALISED intelligent column-mapping engine — the SINGLE source of truth for
 * "which column is which field", shared by every TDS stage (Stage-1 import,
 * Stage-2 TRACES, Stage-3 Tally). Fix a mapping bug here and all stages benefit.
 *
 * Every column is PROFILED by the SHAPE OF ITS VALUES (how often each reads as a
 * PAN / date / name / section / number). Fields are assigned by combined
 * header+value confidence, amount vs TDS is resolved by the statutory RATE
 * RELATIONSHIP (not header text), heterogeneous multi-block files are handled by
 * mapping SECONDARY value-consistent columns, and every decision is validated.
 *
 * This is a verbatim TypeScript port of the engine proven in tds-recon-import
 * against 5 diverse real client files + 16 adversarial synthetics + the multi-
 * sheet M J SURGICAL file (33→285 rows). Do NOT fork it per stage.
 */

/** The universal canonical fields the engine can identify. Every stage speaks
 * this vocabulary; a stage simply ignores the fields it doesn't need. */
export type CanonField =
  | "deductee_name" | "pan" | "section_code" | "amount_paid" | "tds_amount"
  | "interest" | "rate" | "date_of_payment" | "date_of_deduction" | "challan_bsr" | "challan_no";

export interface CanonicalRow {
  deductee_name: string | null; pan: string | null; section_code: string | null;
  amount_paid: number | null; tds_amount: number | null; interest: number | null; rate: number | null;
  date_of_payment: string | null; date_of_deduction: string | null; challan_bsr: string | null; challan_no: string | null;
}

/** A resolved header→field map: each source header points at its canonical field. */
export type HeaderMap = Record<string, CanonField>;

// ── Value parsers ────────────────────────────────────────────────────────────
/** Robust money parser: ₹/Rs, Indian grouping, accounting negatives "(1,234)",
 * trailing sign "170-", "/-", unicode minus, Cr/Dr, numbers-stored-as-text. */
export function toNum(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return isFinite(v) ? v : null;
  let s = String(v).trim().replace(/−/g, "-");
  const paren = /^\(.+\)$/.test(s);
  const leadingMinus = /^-/.test(s);
  const trailingMinus = /[0-9)]\s*-\s*$/.test(s) && !/\/-\s*$/.test(s);
  const neg = paren || leadingMinus || trailingMinus;
  s = s.replace(/[^0-9.]/g, "");
  const m = s.match(/\d+(?:\.\d+)?/);
  if (!m) return null;
  const n = Number((neg ? "-" : "") + m[0]);
  return isFinite(n) ? n : null;
}

const SEC_CODE_RE = /\b(19[2-9][A-Z]{0,2}|20[0-9][A-Z]{0,2})\b/;
const SEC_KEYWORDS = ["contract", "professional", "technical", "rent", "commission", "brokerage", "salary", "interest", "purchase", "goods", "dividend", "royalty", "insurance", "transport", "advertis"];
function classifySectionCell(v: unknown): "code" | "keyword" | "none" {
  const s = v == null ? "" : String(v).trim();
  if (!s) return "none";
  if (SEC_CODE_RE.test(s.toUpperCase().replace(/\s+/g, ""))) return "code";
  const low = s.toLowerCase();
  return SEC_KEYWORDS.some(k => low.includes(k)) ? "keyword" : "none";
}

const PAN_VALUE_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const DATE_VALUE_RE = /^(\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4}|\d{4}[/\-.]\d{1,2}[/\-.]\d{1,2})/;
const DATE_TEXT_RE = /^(\d{1,2}[\s\-][A-Za-z]{3,9}[\s\-,]+\d{2,4}|[A-Za-z]{3,9}\s+\d{1,2},?\s+\d{2,4})$/;
export const looksLikePan = (v: unknown): boolean => PAN_VALUE_RE.test(String(v ?? "").trim().toUpperCase().replace(/\s+/g, ""));
export function looksLikeDate(v: unknown): boolean {
  if (v instanceof Date) return true;
  const s = v == null ? "" : String(v).trim();
  return DATE_VALUE_RE.test(s) || DATE_TEXT_RE.test(s);
}
export function looksLikeName(v: unknown): boolean {
  const s = v == null ? "" : String(v).trim();
  if (s.length < 4) return false;
  if (PAN_VALUE_RE.test(s.toUpperCase().replace(/\s+/g, ""))) return false;
  if (looksLikeDate(s)) return false;
  if (/^[\d.,\-₹%()\s/]+$/.test(s)) return false;
  if (SEC_CODE_RE.test(s.toUpperCase().replace(/\s+/g, ""))) return false;
  const letters = (s.match(/[A-Za-z]/g) || []).length;
  return letters >= 3 && letters / s.length >= 0.5;
}

// ── Header synonyms ──────────────────────────────────────────────────────────
export const HEADER_SYNONYMS: Record<CanonField, string[]> = {
  deductee_name: ["deducteename", "partyname", "partysname", "vendorname", "suppliername", "customername", "beneficiaryname", "payeename", "nameofdeductee", "nameofparty", "assesseename", "firmname", "partnername", "partnersname", "ledgername", "accountname", "particulars", "particular", "name", "party", "vendor", "deductee"],
  pan: ["pan", "panno", "pannumber", "permanentaccountnumber", "deducteepan", "partypan", "vendorpan", "panofdeductee", "panofparty"],
  section_code: ["section", "tdssection", "sectioncode", "natureofpayment", "natureofpymt", "paymentsection", "us", "u/s"],
  // CAUTION: bestFieldForHeader's substring pass returns the FIRST field (in the
  // key order of this object) with a matching synonym, and amount_paid is declared
  // BEFORE date_of_payment. So a SHORT, generic synonym here silently hijacks any
  // header that merely contains it. A bare "credit" did exactly that: "Date of
  // payment / credit (dd/mm/yyyy)" normalises to "dateofpaymentcreditddmmyyyy",
  // which contains "credit" → the column was tagged amount_paid, the real payment
  // date was never eligible as date_of_payment, and the mapper silently fell back
  // to "Date of deduction" (diverging from the edge fn on ~30% of real client
  // files). Do NOT re-add "credit": a bare "Credit" header (Tally) still resolves
  // here via the reverse-containment rule ("creditamount".includes("credit")), and
  // tallyRecon.ts finds its own Credit column anyway. Keep this list IDENTICAL to
  // the tds-recon-import edge function's — this file is a verbatim port of it.
  amount_paid: ["amount", "paymentamount", "grossamount", "invoiceamount", "taxableamount", "creditamount", "amountcredited", "amountpaidcredited", "amountpaid", "netamount", "billamt", "billamount", "billvalue", "invoiceamt", "grossamt", "taxableamt", "invoicevalue", "paidamount"],
  tds_amount: ["tds", "tdsamount", "amountoftds", "taxdeducted", "deductedtax", "taxamount", "tdsdeducted", "tdsamt", "tdspaid", "tdspayable", "tdsdeposited", "incometax"],
  interest: ["interest", "interestamount", "lateinterest", "int"],
  rate: ["rate", "tdsrate", "rateoftds", "oftds", "percentoftds"],
  date_of_payment: ["dateofcredit", "creditdate", "dateofpaymentcredit", "voucherdate", "transactiondate", "date", "valuedate", "entrydate", "postingdate", "invoicedate", "dateofinvoice", "billdate", "billdt", "dateofpayment", "paymentdate", "deductiondate"],
  date_of_deduction: ["dateofdeduction", "tdsdeductiondate"],
  challan_bsr: ["bsr", "bsrcode", "challanbsr"],
  // Kept identical to the edge fn (see the amount_paid note). Tally's "Vch No."
  // is NOT listed here on purpose — tallyRecon.ts locates that column itself, and
  // challan_no is never compared, so an extra synonym here would be pure drift.
  challan_no: ["challanno", "challannumber", "challanserialno", "challan"],
};
export const normaliseHeader = (h: string): string => h.toLowerCase().replace(/[^a-z0-9]/g, "");
function bestFieldForHeader(header: string): CanonField | null {
  const norm = normaliseHeader(header);
  if (!norm) return null;
  if (norm.includes("bsr")) return "challan_bsr";
  if (norm.includes("paid") && norm.includes("date")) return null;
  if (norm.includes("bank") || norm.includes("branch")) return null;
  const fields = Object.keys(HEADER_SYNONYMS) as CanonField[];
  for (const f of fields) if (HEADER_SYNONYMS[f].some(s => s === norm)) return f;
  for (const f of fields) if (HEADER_SYNONYMS[f].some(s => s.length >= 4 && (norm.includes(s) || (norm.length >= 4 && s.includes(norm))))) return f;
  return null;
}
const TDS_RATES = [0.001, 0.005, 0.0075, 0.01, 0.02, 0.025, 0.05, 0.075, 0.10, 0.20, 0.30, 0.375];
const nearTdsRate = (x: number) => TDS_RATES.some((r) => Math.abs(x - r) <= Math.max(0.0005, r * 0.15));
function headerFieldTagged(header: string): CanonField | "__bank__" | null {
  const norm = normaliseHeader(header);
  if (norm.includes("bank") || norm.includes("branch")) return "__bank__";
  return bestFieldForHeader(header);
}

interface ColProfile {
  header: string; ne: number;
  fracPan: number; fracDate: number; fracName: number; fracSec: number; fracSecCode: number;
  nums: number[]; fracNum: number; median: number | null; isSerial: boolean; hfield: CanonField | "__bank__" | null;
}
function profileColumns(allRows: Record<string, unknown>[]): ColProfile[] {
  const headers = new Set<string>();
  for (const r of allRows) if (r && typeof r === "object") for (const k of Object.keys(r)) headers.add(k);
  return [...headers].map((h) => {
    let ne = 0, pan = 0, date = 0, name = 0, scode = 0, skw = 0;
    const nums: number[] = [];
    for (const r of allRows) {
      const v = r?.[h]; const s = v == null ? "" : String(v).trim();
      if (!s) continue; ne++;
      if (looksLikePan(s)) pan++;
      if (looksLikeDate(s)) date++;
      if (looksLikeName(s)) name++;
      const sk = classifySectionCell(s); if (sk === "code") scode++; else if (sk === "keyword") skw++;
      if (!/[A-Za-z]{2,}/.test(s) && !looksLikeDate(s)) { const n = toNum(v); if (n != null) nums.push(n); }
    }
    const sorted = [...nums].sort((a, b) => a - b);
    const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
    const isSerial = nums.length >= 3 && nums.length === ne && Math.min(...nums) >= 0 && Math.max(...nums) <= ne + 2 && nums.every((x) => Number.isInteger(x));
    return {
      header: h, ne,
      fracPan: ne ? pan / ne : 0, fracDate: ne ? date / ne : 0, fracName: ne ? name / ne : 0,
      fracSec: ne ? (scode + skw) / ne : 0, fracSecCode: ne ? scode / ne : 0,
      nums, fracNum: ne ? nums.length / ne : 0, median, isSerial, hfield: headerFieldTagged(h),
    };
  });
}

export interface MappingResult { map: HeaderMap; report: Record<string, { header: string; method: string }>; issues: string[]; notes: string[]; }

/** Resolve the header→field map for a whole tabular dataset. `aiMap` (from an AI
 * mapper) seeds fields still unresolved after the deterministic pass. */
export function resolveMapping(allRows: Record<string, unknown>[], aiMap?: Partial<Record<CanonField, string>>): MappingResult {
  const cols = profileColumns(allRows);
  const byH: Record<string, ColProfile> = {}; for (const c of cols) byH[c.header] = c;
  const map: HeaderMap = {};
  const claimed = new Set<string>();
  const report: Record<string, { header: string; method: string }> = {};
  const put = (field: CanonField, header: string, method: string) => {
    if (!map[header]) map[header] = field; claimed.add(header);
    if (!report[field]) report[field] = { header, method };
  };
  const bestUnclaimed = (score: (c: ColProfile) => number): ColProfile | null => {
    let best: { c: ColProfile; v: number } | null = null;
    for (const c of cols) { if (claimed.has(c.header)) continue; const v = score(c); if (v > 0 && (!best || v > best.v)) best = { c, v }; }
    return best?.c ?? null;
  };
  { const v = bestUnclaimed((c) => c.fracPan >= 0.6 ? c.fracPan : 0);
    if (v) put("pan", v.header, "value"); else { const h = cols.find((c) => !claimed.has(c.header) && c.hfield === "pan"); if (h) put("pan", h.header, "header"); } }
  { const h = cols.find((c) => !claimed.has(c.header) && c.hfield === "date_of_payment" && c.fracDate >= 0.3);
    if (h) put("date_of_payment", h.header, "header"); else { const v = bestUnclaimed((c) => c.fracDate >= 0.5 ? c.fracDate : 0); if (v) put("date_of_payment", v.header, "value"); } }
  { const codeCol = bestUnclaimed((c) => c.fracSecCode >= 0.5 ? c.fracSecCode : 0);
    if (codeCol) put("section_code", codeCol.header, "value-code");
    else { const h = cols.find((c) => !claimed.has(c.header) && c.hfield === "section_code"); if (h) put("section_code", h.header, "header"); } }
  { const h = cols.find((c) => !claimed.has(c.header) && c.hfield === "deductee_name" && c.fracName >= 0.4);
    if (h) put("deductee_name", h.header, "header");
    else { const v = bestUnclaimed((c) => (c.hfield === "__bank__" || /bank|branch|narration|challan|remark|address|description|nature|payment/.test(normaliseHeader(c.header))) ? 0 : (c.fracName >= 0.6 ? c.fracName : 0)); if (v) put("deductee_name", v.header, "value"); } }
  for (const f of ["date_of_deduction", "challan_bsr", "challan_no"] as const) {
    const h = cols.find((c) => !claimed.has(c.header) && c.hfield === f); if (h) put(f, h.header, "header");
  }
  const money = cols.filter((c) => !claimed.has(c.header) && c.fracNum >= 0.6 && !c.isSerial && c.fracDate < 0.5
    && c.hfield !== "challan_bsr" && c.hfield !== "challan_no" && c.hfield !== "date_of_payment" && c.hfield !== "date_of_deduction" && c.hfield !== "__bank__"
    && !/bsr|cin|cheque|chalanno|challanno|srno|serialno/.test(normaliseHeader(c.header)));
  { const rc = money.find((c) => c.hfield === "rate" && c.median != null && c.median <= 40); if (rc) put("rate", rc.header, "header"); }
  { const ic = money.find((c) => !claimed.has(c.header) && c.hfield === "interest"); if (ic) put("interest", ic.header, "header"); }
  const cand = money.filter((c) => !claimed.has(c.header));
  let bestPair: { a: string; t: string; fit: number; score: number } | null = null;
  for (const a of cand) for (const t of cand) {
    if (a.header === t.header) continue;
    let both = 0, ok = 0, rateOk = 0;
    for (const r of allRows) {
      const av = toNum(r[a.header]), tv = toNum(r[t.header]);
      if (av == null || tv == null || av <= 0 || tv < 0) continue;
      both++; const ratio = tv / av;
      if (ratio > 0 && ratio <= 0.40) { ok++; if (nearTdsRate(ratio)) rateOk++; }
    }
    if (both < 1) continue;
    const fit = ok / both + (rateOk / both) * 0.5;
    const hb = (a.hfield === "amount_paid" ? 0.3 : 0) + (t.hfield === "tds_amount" ? 0.3 : 0) + (a.hfield === "tds_amount" ? -0.2 : 0);
    const score = fit + hb + ((a.median ?? 0) > (t.median ?? 0) ? 0.05 : 0);
    if (fit >= 0.5 && (!bestPair || score > bestPair.score)) bestPair = { a: a.header, t: t.header, fit, score };
  }
  if (bestPair) { put("amount_paid", bestPair.a, "relationship"); put("tds_amount", bestPair.t, "relationship"); }
  else {
    const ah = cand.find((c) => c.hfield === "amount_paid"), th = cand.find((c) => c.hfield === "tds_amount");
    if (ah) put("amount_paid", ah.header, "header-only");
    if (th && th.header !== report.amount_paid?.header) put("tds_amount", th.header, "header-only");
    if (!report.amount_paid && !report.tds_amount && cand.length === 1) put("amount_paid", cand[0].header, "single-numeric");
  }
  const overlapFrac = (h1: string, h2: string) => {
    let both = 0, either = 0;
    for (const r of allRows) { const a = toNum(r[h1]) != null, b = toNum(r[h2]) != null; if (a || b) either++; if (a && b) both++; }
    return either ? both / either : 0;
  };
  for (const field of ["amount_paid", "tds_amount"] as const) {
    const primary = report[field]?.header; if (!primary) continue;
    for (const c of cand) {
      if (claimed.has(c.header) || c.hfield !== field) continue;
      if (overlapFrac(primary, c.header) < 0.2) { map[c.header] = field; claimed.add(c.header); }
    }
  }
  const overlapNonEmpty = (h1: string, h2: string) => {
    let both = 0, either = 0;
    for (const r of allRows) { const a = r[h1] != null && String(r[h1]).trim() !== ""; const b = r[h2] != null && String(r[h2]).trim() !== ""; if (a || b) either++; if (a && b) both++; }
    return either ? both / either : 0;
  };
  const addSecondary = (field: CanonField, isType: (c: ColProfile) => boolean) => {
    const primary = report[field]?.header; if (!primary) return;
    for (const c of cols) {
      if (claimed.has(c.header) || !isType(c)) continue;
      if (overlapNonEmpty(primary, c.header) < 0.2) { map[c.header] = field; claimed.add(c.header); }
    }
  };
  addSecondary("pan", (c) => c.fracPan >= 0.6);
  addSecondary("deductee_name", (c) => c.fracName >= 0.6 && c.hfield !== "__bank__"
    && !/bank|branch|narration|challan|remark|address|description|nature|payment/.test(normaliseHeader(c.header)));
  addSecondary("section_code", (c) => c.fracSecCode >= 0.5);
  if (aiMap) {
    const have = new Set(Object.values(map));
    for (const [f, h] of Object.entries(aiMap) as [CanonField, string][]) {
      if (h && !have.has(f) && !map[h] && byH[h]) { map[h] = f; if (!report[f]) report[f] = { header: h, method: "ai" }; }
    }
  }
  const issues: string[] = [], notes: string[] = [];
  const amtH = report.amount_paid?.header, tdsH = report.tds_amount?.header;
  if (amtH && tdsH && amtH !== tdsH) {
    let inv = 0, tot = 0;
    for (const r of allRows) { const av = toNum(r[amtH]), tv = toNum(r[tdsH]); if (av == null || tv == null || av <= 0) continue; tot++; if (tv > av) inv++; }
    if (tot > 0 && inv / tot > 0.5) {
      notes.push("amount/TDS columns were swapped and auto-corrected");
      report.amount_paid.header = tdsH; report.tds_amount.header = amtH;
      for (const k of Object.keys(map)) { if (map[k] === "amount_paid") map[k] = "tds_amount"; else if (map[k] === "tds_amount") map[k] = "amount_paid"; }
    }
  }
  if (report.pan && (byH[report.pan.header]?.fracPan ?? 0) < 0.5) issues.push("PAN column has few valid PANs");
  if (report.date_of_payment && (byH[report.date_of_payment.header]?.fracDate ?? 0) < 0.4) issues.push("date column has few dates");
  if (report.deductee_name && (byH[report.deductee_name.header]?.fracName ?? 0) < 0.4) issues.push("name column doesn't look like names");
  if (!report.pan && !report.deductee_name) issues.push("no identity column (PAN/name)");
  if (!report.amount_paid && !report.tds_amount) issues.push("no money column (amount/TDS)");
  return { map, report, issues, notes };
}

function coerceField(field: CanonField, v: unknown): string | number | undefined {
  if (v === null || v === undefined || String(v).trim() === "") return undefined;
  if (field === "pan") return String(v).trim().toUpperCase();
  if (field === "amount_paid" || field === "tds_amount" || field === "interest" || field === "rate") {
    const n = toNum(v); return n === null ? undefined : n;
  }
  return String(v).trim();
}

/** Build one canonical row from the header→field map (first non-empty mapped
 * column per field wins, so heterogeneous multi-block sheets both feed a field). */
export function buildCanonicalRow(row: Record<string, unknown>, map: HeaderMap): CanonicalRow {
  const out: CanonicalRow = {
    deductee_name: null, pan: null, section_code: null, amount_paid: null, tds_amount: null,
    interest: null, rate: null, date_of_payment: null, date_of_deduction: null, challan_bsr: null, challan_no: null,
  };
  if (!row || typeof row !== "object") return out;
  for (const [header, field] of Object.entries(map)) {
    if (out[field] !== null) continue;
    const v = coerceField(field, row[header]);
    if (v !== undefined) (out as Record<string, unknown>)[field] = v;
  }
  return out;
}
