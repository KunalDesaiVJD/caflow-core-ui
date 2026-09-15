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
/**
 * ACCOUNTING NUMBERS ARE NOT PLAIN NUMBERS. Indian accounting exports write a
 * money value with its SIDE attached — "563.00 Dr", "563.00 Cr", "1,234 DR",
 * "Cr 500" — and Excel does this through a CUSTOM CELL FORMAT, so the cell is
 * a real number on screen but arrives as that formatted STRING once the sheet
 * is read for display text (which the importer must do, to preserve the
 * client's own formatting of dates and ids).
 *
 * Every "is this column money?" test in this file used to reject such a value
 * outright, because a bare `/[A-Za-z]{2,}/` test sees the "Dr" and calls the
 * whole column text. On a real 26Q file whose Amount and TDS columns are BOTH
 * formatted that way, that made both columns invisible as money: the
 * amount/TDS pairing had nothing to pair, the narration rescue exited before
 * it began, and all 87 records reported a false mismatch.
 *
 * Stripping the marker here — not at each call site — means every downstream
 * test (column profiling, the money-pair search, the rescue) understands the
 * notation automatically. Dr/Cr is a SIDE, not a sign: the engine's fields are
 * magnitudes, and negation stays driven by the existing paren/minus rules.
 */
export function stripAccountingMarker(s: string): string {
  let out = s.trim();
  // The marker must be a STANDALONE token, never a word's first two letters —
  // otherwise "Credit Note" would be shortened to "edit Note", turning a real
  // text cell into something that looks parseable.
  const lead = out.match(/^(?:dr|cr)\.?\s+(.*)$/i);
  if (lead) out = lead[1].trim();
  const trail = out.match(/^(.*?[\d)])\s*(?:dr|cr)\.?$/i);
  if (trail) out = trail[1].trim();
  return out === "" ? s : out;
}

/** True when a cell is a MONEY value once its Dr/Cr side-marker is set aside —
 *  i.e. no residual words, not a date, and numerically parseable. */
export function looksLikeMoneyCell(v: unknown): boolean {
  if (typeof v === "number") return isFinite(v);
  const bare = stripAccountingMarker(String(v ?? "").trim());
  return !/[A-Za-z]{2,}/.test(bare) && !looksLikeDate(v) && toNum(bare) != null;
}

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
/** True for a header gridToRows/extractSheetRows SYNTHESISED ("Column7") because
 *  the source cell was blank — never a header a client actually wrote. Confirmed
 *  against a real client file: two UNRELATED tables pasted side-by-side on one
 *  sheet (a real PAN/name table for one set of employees at columns A-C, a
 *  SECOND, disjoint PAN/name table for entirely DIFFERENT people at columns J-K,
 *  offset a few rows down) get flattened into ONE set of row objects keyed by
 *  physical row — so an employee from table 1 whose OWN "PAN" cell is blank can
 *  end up sharing a row with table 2's unrelated PAN in an auto-named "Column11"
 *  slot purely by row-position coincidence. That auto-named column then has a
 *  HIGHER fracPan than the real (but empty, for this file) "PAN" column and
 *  wins the value-based pan/name pick — silently grafting a stranger's PAN onto
 *  the wrong employee. See its use in resolveMapping's pan/deductee_name
 *  detection: an auto-generated header is deprioritised below ANY genuinely-
 *  named column (even an empty one), and used only as a last resort when no
 *  named column exists at all — never excluded outright, since plenty of real
 *  files have no header row and rely entirely on this positional fallback. */
export const isAutoColumnHeader = (h: string): boolean => /^column\d+$/i.test(h.trim());
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
/** Internal bookkeeping keys the extractor attaches to a row. They are NOT client
 *  columns and must never be profiled or mapped: "__sheet" holds the source sheet
 *  name, which for a per-section workbook looks exactly like a section code
 *  ("194C") and would otherwise be a very convincing section column. */
const INTERNAL_KEYS = new Set(["__sheet"]);

function profileColumns(allRows: Record<string, unknown>[]): ColProfile[] {
  const headers = new Set<string>();
  for (const r of allRows) if (r && typeof r === "object") for (const k of Object.keys(r)) if (!INTERNAL_KEYS.has(k)) headers.add(k);
  return [...headers].map((h) => {
    let ne = 0, pan = 0, date = 0, name = 0, scode = 0, skw = 0;
    const nums: number[] = [];
    for (const r of allRows) {
      const v = r?.[h]; const s = v == null ? "" : String(v).trim();
      if (!s) continue; ne++;
      if (looksLikePan(s)) pan++;
      // Pass the RAW value, not the pre-stringified s: a cellDates:true XLSX
      // read hands profileColumns a real Date object, and looksLikeDate's own
      // `v instanceof Date` check only fires on that raw value — stringifying
      // first (String(dateObj) → "Sun Apr 05 2026 18:29:50 GMT+0000 (…)")
      // matches neither date regex, so date_of_payment silently failed to
      // resolve on every real client file read with cellDates (confirmed on
      // the same Sarjeet Construction 26Q file as the amount/TDS mirroring
      // bug above — a separate, independent defect this happened to surface).
      if (looksLikeDate(v)) date++;
      if (looksLikeName(s)) name++;
      const sk = classifySectionCell(s); if (sk === "code") scode++; else if (sk === "keyword") skw++;
      // A Dr/Cr-suffixed accounting value IS money — see looksLikeMoneyCell.
      if (looksLikeMoneyCell(v)) { const n = toNum(v); if (n != null) nums.push(n); }
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
  // A column whose name was SYNTHESISED ("Column11") because its header cell was
  // blank is deprioritised below any genuinely-named column, even an empty one —
  // see isAutoColumnHeader's doc for the real cross-table contamination this
  // guards against — and used only when no named column exists at all.
  { const v = bestUnclaimed((c) => c.fracPan >= 0.6 && !isAutoColumnHeader(c.header) ? c.fracPan : 0);
    if (v) put("pan", v.header, "value");
    else {
      const h = cols.find((c) => !claimed.has(c.header) && c.hfield === "pan");
      if (h) put("pan", h.header, "header");
      else { const v2 = bestUnclaimed((c) => c.fracPan >= 0.6 ? c.fracPan : 0); if (v2) put("pan", v2.header, "value-fallback"); }
    } }
  { const h = cols.find((c) => !claimed.has(c.header) && c.hfield === "date_of_payment" && c.fracDate >= 0.3);
    if (h) put("date_of_payment", h.header, "header"); else { const v = bestUnclaimed((c) => c.fracDate >= 0.5 ? c.fracDate : 0); if (v) put("date_of_payment", v.header, "value"); } }
  { const codeCol = bestUnclaimed((c) => c.fracSecCode >= 0.5 ? c.fracSecCode : 0);
    if (codeCol) put("section_code", codeCol.header, "value-code");
    else { const h = cols.find((c) => !claimed.has(c.header) && c.hfield === "section_code"); if (h) put("section_code", h.header, "header"); } }
  { const h = cols.find((c) => !claimed.has(c.header) && c.hfield === "deductee_name" && c.fracName >= 0.4);
    if (h) put("deductee_name", h.header, "header");
    else {
      const nameScore = (c: ColProfile) => (c.hfield === "__bank__" || /bank|branch|narration|challan|remark|address|description|nature|payment/.test(normaliseHeader(c.header))) ? 0 : (c.fracName >= 0.6 ? c.fracName : 0);
      const v = bestUnclaimed((c) => !isAutoColumnHeader(c.header) ? nameScore(c) : 0);
      if (v) put("deductee_name", v.header, "value");
      else { const v2 = bestUnclaimed(nameScore); if (v2) put("deductee_name", v2.header, "value-fallback"); }
    } }
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
      // Same guard as the primary pan/deductee_name detection above: an
      // auto-generated "ColumnN" header must not become a value source for a
      // field just because a genuinely-named primary column is EMPTY in this
      // file — that is exactly the disjoint-side-by-side-table contamination
      // this whole mechanism must not fall into via a second path.
      if (claimed.has(c.header) || !isType(c) || isAutoColumnHeader(c.header)) continue;
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

// ── Mirrored amount/TDS columns — the "Amount" column IS the TDS column ─────
// Some clients export a ledger where the "Amount"/"Gross Total" column was
// mistakenly populated with the TDS figure itself — IDENTICAL to the real TDS
// column on every row. Confirmed on a real client file (Sarjeet Construction,
// 26Q Q1): "Gross Total" and "TDS on Contractors" held the exact same value
// on every single row (e.g. both 563, for what was really a ₹56,295 payment
// at 1% — 563 ≈ 56295 × 0.01). resolveMapping's ratio-based amount/TDS
// pairing correctly REFUSES to treat two identical columns as a valid pair —
// no real TDS rate is ~100%, so its `ratio <= 0.40` gate rejects it — leaving
// BOTH fields unmapped, which upstream then has nothing better to fall back
// on than misreading the TDS-duplicate column as Amount.
//
// The true gross amount there survived only in a free-text column, either as
// prose ("BEING 1% TDS ON AMT RS 41415") or as a bare number outright (a few
// rows had the narration column hold just the number, no prose). This runs
// BEFORE resolveMapping and adds a literal "amount_paid" key to each row —
// already an exact HEADER_SYNONYMS match — so resolveMapping's OWN ratio-
// based pairing picks it up naturally against the TDS-like column with no
// special-casing needed downstream. A no-op unless this exact anomaly (two
// near-identical numeric columns AND a recoverable free-text column) is
// actually present, so it can only recover an otherwise-unreconcilable file.
const NARRATION_AMOUNT_RE = /\bRs\.?\s*([\d,]+(?:\.\d+)?)/i;

function extractNarrationAmount(raw: unknown): number | null {
  if (typeof raw === "number") return isFinite(raw) ? raw : null;
  const s = String(raw ?? "").trim();
  const m = s.match(NARRATION_AMOUNT_RE);
  if (m) return toNum(m[1]);
  // Some rows state the taxable amount as a BARE figure with no prose at all
  // — and, read as display text, it arrives carrying its accounting side
  // ("19038.00 Dr"). Accept it only when the WHOLE cell is that one number,
  // so a sentence that merely happens to contain digits is never mistaken
  // for an amount.
  const bare = stripAccountingMarker(s);
  return /^[\d,]+(?:\.\d+)?$/.test(bare) ? toNum(bare) : null;
}

// The same narration that hides the taxable amount usually states the RATE too
// ("BEING 1% TDS ON AMT RS 56295"). Capturing it means the record carries the
// deduction rate the client actually applied, so a reviewer can see the basis
// of the figure — and a wrong rate becomes visible — instead of having to
// re-read the source file. Deliberately conservative: a plain percentage
// token only, and only a statutorily plausible one, so a stray "100%" or a
// year fragment is never mistaken for a rate.
const NARRATION_RATE_RE = /(\d{1,2}(?:\.\d{1,2})?)\s*%/;
function extractNarrationRate(raw: unknown): number | null {
  const m = String(raw ?? "").match(NARRATION_RATE_RE);
  if (!m) return null;
  const v = toNum(m[1]);
  return v != null && v > 0 && v <= 30 ? v : null;
}

export function rescueMirroredAmountFromNarration(allRows: Record<string, unknown>[]): Record<string, unknown>[] {
  const headers = new Set<string>();
  for (const r of allRows) if (r && typeof r === "object") for (const k of Object.keys(r)) if (!INTERNAL_KEYS.has(k)) headers.add(k);
  const hs = [...headers];

  // Columns that look like pure numbers (money), the same shape check
  // profileColumns uses elsewhere in this file.
  const numeric: string[] = [];
  for (const h of hs) {
    let ne = 0, nums = 0;
    for (const r of allRows) {
      const v = r?.[h]; const s = v == null ? "" : String(v).trim(); if (!s) continue;
      ne++; if (looksLikeMoneyCell(v)) nums++;
    }
    if (ne > 0 && nums / ne >= 0.6) numeric.push(h);
  }
  if (numeric.length < 2) return allRows;

  // Do any two numeric columns MIRROR each other (near-identical) on most rows?
  let mirrorTds: string | null = null;
  outer: for (let i = 0; i < numeric.length; i++) for (let j = i + 1; j < numeric.length; j++) {
    const [a, b] = [numeric[i], numeric[j]];
    let both = 0, same = 0;
    for (const r of allRows) {
      const av = toNum(r[a]), bv = toNum(r[b]);
      if (av == null || bv == null || av <= 0 || bv <= 0) continue;
      both++; if (Math.abs(av - bv) < 0.01) same++;
    }
    if (both >= Math.max(3, allRows.length * 0.5) && same / both >= 0.9) {
      mirrorTds = normaliseHeader(a).includes("tds") ? a : normaliseHeader(b).includes("tds") ? b : a;
      break outer;
    }
  }
  if (!mirrorTds) return allRows;

  // Is there a free-text column that yields a LARGER, rate-plausible figure
  // (vs the mirrored TDS-like value) for most of the same rows?
  for (const h of hs) {
    if (h === mirrorTds) continue;
    let checked = 0, ok = 0, rateOk = 0;
    for (const r of allRows) {
      const tv = toNum(r[mirrorTds]);
      if (tv == null || tv <= 0) continue;
      const amt = extractNarrationAmount(r[h]);
      if (amt == null || amt <= 0) continue;
      checked++;
      const ratio = tv / amt;
      if (ratio > 0 && ratio <= 0.40) { ok++; if (nearTdsRate(ratio)) rateOk++; }
    }
    if (checked >= Math.max(3, allRows.length * 0.5) && ok / checked >= 0.8 && rateOk / checked >= 0.5) {
      return allRows.map((r) => {
        const tv = toNum(r?.[mirrorTds as string]);
        const amt = tv != null && tv > 0 ? extractNarrationAmount(r?.[h]) : null;
        if (tv == null || amt == null || amt <= 0) return r;
        // Carry the RATE the narration states, and the narration text itself,
        // alongside the recovered amount: the row's own words are the evidence
        // for the figure the engine just reconstructed, so a reviewer can see
        // WHY it reads 56,295 rather than the 563 printed in the column.
        // Prefer the stated rate; fall back to the one the two figures imply.
        const stated = extractNarrationRate(r?.[h]);
        const implied = Math.round((tv / amt) * 10000) / 100;
        const rate = stated ?? (implied > 0 && implied <= 30 ? implied : null);
        const out: Record<string, unknown> = { ...r, amount_paid: amt };
        if (rate != null) out.rate = rate;
        if (typeof r?.[h] === "string" && r[h]) out.narration = r[h];
        return out;
      });
    }
  }
  return allRows;
}

// ── Repeating-month ("wide") layout — a common real-world CA-office format ──
// Some clients hand over ONE ROW PER EMPLOYEE with a repeating group of
// columns per calendar month ("APRIL","APRIL - BONUS","APRIL-TDS","MAY",...)
// spanning the whole financial year, rather than one row per transaction.
// resolveMapping's engine (above) is fundamentally row-per-transaction: it
// picks ONE amount column and ONE tds column for the WHOLE file. Confirmed
// against a real client file (MICROCIRCUITS INNOVATIONS, 24Q Q1): with no
// header synonym for "APRIL-TDS" etc., every month's columns look equally
// numeric, so the ratio-based fallback locks onto whichever month happens to
// score marginally highest — SILENTLY discarding the other 1-2 months of the
// filing's own quarter for every single employee, guaranteeing 0 clean
// matches against Office Data (which holds one row per employee PER MONTH).
//
// explodeMonthlyColumns runs BEFORE resolveMapping and turns each employee's
// wide row into up to 3 row-per-month rows (one per calendar month in the
// filing's quarter) with already-canonical field names — "amount_paid" /
// "tds_amount" / "date_of_payment" normalise to exact entries in
// HEADER_SYNONYMS (see amountpaid/tdsamount/dateofpayment above), so they are
// picked up by resolveMapping's existing exact-match path with no further
// changes needed there. A row from a DIFFERENT sheet with no month-prefixed
// columns is returned completely untouched.
const MONTH_TOKENS: Record<string, number> = {
  january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3,
  april: 4, apr: 4, may: 5, june: 6, jun: 6, july: 7, jul: 7,
  august: 8, aug: 8, september: 9, sept: 9, sep: 9,
  october: 10, oct: 10, november: 11, nov: 11, december: 12, dec: 12,
};
const MONTH_PREFIX_RE = new RegExp(`^(${Object.keys(MONTH_TOKENS).sort((a, b) => b.length - a.length).join("|")})`);
/** Indian FY quarters: Q1 = Apr-Jun, Q2 = Jul-Sep, Q3 = Oct-Dec, Q4 = Jan-Mar. */
const QUARTER_MONTHS: Record<string, number[]> = { Q1: [4, 5, 6], Q2: [7, 8, 9], Q3: [10, 11, 12], Q4: [1, 2, 3] };

function isoDateForMonth(monthNum: number, financialYear: string): string | null {
  const startYear = parseInt(String(financialYear).split("-")[0], 10);
  if (!Number.isFinite(startYear)) return null;
  const year = monthNum >= 4 ? startYear : startYear + 1;
  const lastDay = new Date(year, monthNum, 0).getDate(); // day 0 of next month = last day of this one
  return `${year}-${String(monthNum).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
}

export function explodeMonthlyColumns(
  allRows: Record<string, unknown>[], quarter: string | null | undefined, financialYear: string | null | undefined,
): Record<string, unknown>[] {
  const quarterMonths = quarter ? QUARTER_MONTHS[quarter.toUpperCase()] : undefined;
  if (!quarterMonths) return allRows;

  const headers = new Set<string>();
  for (const r of allRows) if (r && typeof r === "object") for (const k of Object.keys(r)) if (!INTERNAL_KEYS.has(k)) headers.add(k);

  const monthCols = new Map<number, { base?: string; bonus?: string; tds?: string }>();
  for (const h of headers) {
    const norm = normaliseHeader(h);
    const m = MONTH_PREFIX_RE.exec(norm);
    if (!m) continue;
    const monthNum = MONTH_TOKENS[m[1]];
    // EXACT suffix match only ("", "tds", "bonus") — not .includes(). A real
    // per-transaction file's multi-row header merge (extractSheetRows) can
    // legitimately produce a header like "Feb-26 … TDS PAID DATE CHALLAN BSR"
    // (normalises to "feb26tdspaiddatechallanbsr"), which still starts with a
    // month token and still .includes("tds") — that used to be enough to
    // count as a real month/TDS column group and (combined with ≥2 such
    // headers) wrongly explode a normal 26Q file, stripping its own "Total"
    // amount column and leaving the TDS column to be misread as Amount.
    const rest = norm.slice(m[1].length);
    const kind = rest === "" ? "base" : rest === "tds" ? "tds" : rest === "bonus" ? "bonus" : null;
    if (!kind) continue; // an unrecognised/merged suffix on a month-prefixed header — leave it alone rather than guess
    const g = monthCols.get(monthNum) ?? {};
    g[kind] = h;
    monthCols.set(monthNum, g);
  }

  // Require at least TWO distinct months to actually carry a BASE ("APRIL",
  // not just "APRIL-TDS") column before treating this as a wide-monthly
  // layout — a genuine per-employee-per-month salary sheet always has a base
  // pay column per month; requiring it (rather than accepting a lone "-TDS"
  // group on its own) is a second, independent guard against the same
  // false-trigger the exact-suffix-match above already closes, and a single
  // stray column that happens to start with a month name (e.g. "March
  // closing balance" on an unrelated sheet) still never trips this either way.
  const monthsWithData = [...monthCols.entries()].filter(([, g]) => g.base);
  if (monthsWithData.length < 2) return allRows;

  const relevantMonths = monthsWithData.filter(([m]) => quarterMonths.includes(m));
  if (relevantMonths.length === 0) return allRows; // the layout is real but doesn't cover this filing's quarter at all

  const monthHeaders = new Set<string>();
  for (const [, g] of monthCols) for (const h of [g.base, g.bonus, g.tds]) if (h) monthHeaders.add(h);

  const out: Record<string, unknown>[] = [];
  for (const row of allRows) {
    const rowKeys = new Set(Object.keys(row));
    const isWideRow = [...monthHeaders].some((h) => rowKeys.has(h));
    if (!isWideRow) { out.push(row); continue; } // a different sheet/shape — untouched

    const passthrough: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row)) {
      if (monthHeaders.has(k)) continue;
      // Annual TOTAL SALARY/TOTAL TDS/TOTAL BONUS columns are the whole-year
      // figure, not this quarter's — dropping them avoids them competing as a
      // spurious extra money candidate against the quarter figures below.
      if (/^total/.test(normaliseHeader(k))) continue;
      passthrough[k] = v;
    }

    let anyExploded = false;
    for (const [monthNum, g] of relevantMonths) {
      const base = g.base ? toNum(row[g.base]) : null;
      const bonus = g.bonus ? toNum(row[g.bonus]) : null;
      const tds = g.tds ? toNum(row[g.tds]) : null;
      const amount = (base ?? 0) + (bonus ?? 0);
      if (amount <= 0 && (tds ?? 0) <= 0) continue; // nothing paid this employee this month — skip, matching Office Data's own convention of no row for an unpaid month
      anyExploded = true;
      out.push({ ...passthrough, amount_paid: amount || null, tds_amount: tds, date_of_payment: isoDateForMonth(monthNum, financialYear || "") });
    }
    if (!anyExploded) out.push(row); // no activity in the relevant months — keep the original row visible rather than silently dropping the employee
  }
  return out;
}

function coerceField(field: CanonField, v: unknown): string | number | undefined {
  if (v === null || v === undefined || String(v).trim() === "") return undefined;
  if (field === "pan") return String(v).trim().toUpperCase();
  if (field === "amount_paid" || field === "tds_amount" || field === "interest" || field === "rate") {
    const n = toNum(v); return n === null ? undefined : n;
  }
  // A cellDates:true XLSX read hands this a real Date object (see profileColumns'
  // own matching fix) — String(dateObj) is a verbose non-ISO string ("Sun Apr 05
  // 2026 18:29:50 GMT+0000 (…)") that no downstream date parser expects, so format
  // it as a clean yyyy-mm-dd instead of falling through to the generic stringify.
  if ((field === "date_of_payment" || field === "date_of_deduction") && v instanceof Date && !isNaN(v.getTime())) {
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}`;
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
    if (v !== undefined) (out as Record<CanonField, unknown>)[field] = v;
  }
  // A key that is ALREADY the canonical field name needs no mapping — it was
  // put there by a pre-processing pass that had evidence the header engine
  // cannot see (explodeMonthlyColumns' per-month split, or the narration
  // rescue's recovered amount/rate). Those passes should not have to also win
  // a column-profiling contest against the client's own columns to be
  // believed: resolveMapping is a heuristic over UNKNOWN headers, and a
  // synthesized field is not unknown. Only fills a field the map left empty,
  // so a real mapped column always wins.
  for (const field of Object.keys(out) as CanonField[]) {
    if (out[field] !== null || !(field in row)) continue;
    const v = coerceField(field, row[field]);
    if (v !== undefined) (out as Record<CanonField, unknown>)[field] = v;
  }
  return out;
}
