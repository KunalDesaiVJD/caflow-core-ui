/**
 * tds-recon-import
 *
 * Reads a client-supplied TDS file (Excel/CSV rows, or a PDF) and normalises it
 * into canonical deductee rows stored as an import batch (Dataset 2), ready to be
 * compared against the manually-entered Office Data (tds_deductees).
 *
 * The client parses Excel/CSV to raw row objects and posts them here; PDFs are
 * posted as base64 and read by a multimodal model. In both cases an LLM
 * (OpenRouter) maps whatever columns/layout the file uses onto the canonical
 * fields, so any client format works.
 *
 * Input (POST, Bearer auth):
 *   { filing_id, form_type?, file_name?, file_type: "xlsx"|"csv"|"pdf",
 *     rows?: Record<string,unknown>[],   // for xlsx/csv
 *     pdf_base64?: string }              // for pdf
 * Output: { batch_id, row_count, rows }
 *
 * Requires the OPENROUTER_API_KEY secret:
 *   npx supabase secrets set OPENROUTER_API_KEY=<key>
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

// Reflect the browser's requested headers on the preflight. Newer supabase-js
// (v2.98+) attaches x-supabase-client-* headers to every functions.invoke call;
// a STATIC allow-list that omits them fails the CORS preflight and the browser
// reports "Failed to send a request to the Edge Function" before our code runs.
const corsFor = (req: Request) => ({
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    req.headers.get("access-control-request-headers") ??
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
});

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

interface CanonicalRow {
  deductee_name: string | null;
  pan: string | null;
  section_code: string | null;
  amount_paid: number | null;
  tds_amount: number | null;
  interest: number | null;
  rate: number | null;
  date_of_payment: string | null;
  date_of_deduction: string | null;
  challan_bsr: string | null;
  challan_no: string | null;
}

const CANONICAL_INSTRUCTION = `You normalise a client's TDS statement into canonical rows.
Client files use WILDLY different column headers, capitalisation, spacing,
abbreviations, wording and column order — you must identify each field by its
MEANING, not by matching exact header text. Use the header's wording, its
position relative to other recognised columns, AND the data pattern in that
column (e.g. a column of values like "AJKPM0355R" is a PAN regardless of what
its header says; a column of dd/mm/yyyy-style values is a date even under an
unfamiliar header) to decide what each column represents. A file will rarely
use the exact synonym wording below verbatim — that's expected; match by
meaning, don't require an exact string match.

Return STRICT JSON only: {"rows":[{...}]} — no prose, no markdown fences.
Each row object MUST have exactly these keys (use null when a value is genuinely absent):
  deductee_name   : string — the party/deductee/payee the payment was made to.
      Common headers: Deductee Name, Party Name, Vendor Name, Customer Name,
      Beneficiary Name, Payee Name, Name, Party, Vendor.
  pan             : string — 10-char PAN, uppercase, or null.
      Common headers: PAN, PAN No., PAN Number, Permanent Account Number,
      Deductee PAN, Party PAN. Data pattern: 5 letters + 4 digits + 1 letter.
  section_code    : string — TDS section / nature of payment (strip any prefix
      words). Common headers: Section, TDS Section, Section Code, Nature of
      Payment, Payment Section, U/S. PREFERENCE when a file has more than one
      section-like column: a plain-language descriptor (e.g. "TDS - Purchase",
      "TDS - Contract", "TDS - Professional Fees", "Rent", "Commission") is far
      more useful than a bare legal clause citation (e.g. "393(1) 8(ii)",
      "194Q(2)") — prefer the descriptive column when both exist in the same
      file. If only a legal-citation-style column exists, extract it as-is;
      never invent or translate a code you cannot read directly from the file.
  amount_paid     : number — amount paid/credited (plain number, no commas/₹).
      Common headers: Amount, Payment Amount, Gross Amount, Invoice Amount,
      Taxable Amount, Credit Amount, Amount Paid/Credited.
  tds_amount      : number — TDS deducted (plain number).
      Common headers: TDS, TDS Amount, Tax Deducted, Deducted Tax, Tax Amount.
  interest        : number — interest amount (plain number), or null if absent.
      Common headers: Interest, Interest Amount, Late Interest, Int.
  rate            : number — TDS rate % (plain number, e.g. 0.1, 1, 10)
  date_of_payment : string — the date the DEDUCTEE was paid/credited (the
      transaction date), keep the original date text exactly as printed, do
      not reformat it. Common headers: Date of Credit, Date of Payment, Payment
      Date, Credit Date, Voucher Date, Transaction Date, Deduction Date, Date,
      Value Date, Entry Date. IMPORTANT: if the file only has ONE date-like
      column (most client files do), use it here — do not leave this null just
      because the header doesn't literally contain the word "payment".
      DISAMBIGUATION: some files have TWO separate date columns — one for the
      deductee's transaction (e.g. "Date of Credit", populated on every row)
      and a DIFFERENT one that is actually the challan/bank deposit date (even
      if its header also says "Date of Payment"), recognisable because it is
      only populated on rows that ALSO have a Bank Name/BSR Code/Challan
      No./CIN value and is blank elsewhere. When both exist, use the
      always-populated transaction-date column ("Date of Credit" or
      equivalent) for date_of_payment — NEVER the sparse challan-deposit
      column. We have no field for the challan deposit date; leave it unused.
  date_of_deduction : string — same matching rules as date_of_payment. If the
      file has a SEPARATE, distinctly-labelled deduction date column, use that;
      otherwise reuse the same single date column used for date_of_payment.
  challan_bsr     : string — 7-digit BSR/receipt number of the challan, or null
  challan_no      : string — challan serial number, or null

Rules: never invent rows or values; one object per deductee line item; ignore
totals/header/footer/subtotal lines; convert Indian-format numbers
("12,34,567.00") to plain numbers.`;

// ── Deterministic HEADER→FIELD mapper (tabular xlsx/csv/json) ────────────────
// The tabular path is normalised entirely in code — the AI never reads rows.
// Each DISTINCT source column header is classified to a canonical field by its
// wording (synonyms) and, for PAN/date/section, its data pattern. A header→field
// map (rather than field→header) is deliberate: real client workbooks merge
// several sheets whose columns are named differently ("PAN" on one sheet,
// "PAN No." on another; "BILL AMT" vs "amount"), so MULTIPLE headers may feed
// one field and buildCanonicalFromMap takes the first non-empty value per field
// per row. This is what makes heterogeneous multi-sheet files import correctly.
const HEADER_SYNONYMS: Record<keyof CanonicalRow, string[]> = {
  // "particulars"/"particular" = the party column in Tally ledger exports;
  // "nameofdeductee"/"assesseename"/"firmname"/"partnersname" seen across real files.
  deductee_name: ["deducteename", "partyname", "partysname", "vendorname", "suppliername", "customername", "beneficiaryname", "payeename", "nameofdeductee", "nameofparty", "assesseename", "firmname", "partnername", "partnersname", "ledgername", "accountname", "particulars", "particular", "name", "party", "vendor", "deductee"],
  pan: ["pan", "panno", "pannumber", "permanentaccountnumber", "deducteepan", "partypan", "vendorpan", "panofdeductee", "panofparty"],
  // "nature" alone is deliberately EXCLUDED — it substring-matches "Signature".
  section_code: ["section", "tdssection", "sectioncode", "natureofpayment", "natureofpymt", "paymentsection", "us", "u/s"],
  // Money-column synonyms are SPECIFIC (no bare "amt") so "BILL AMT" resolves to
  // amount_paid and "TDS AMT" to tds_amount without colliding — both are real,
  // very common client headers (verified against actual files).
  amount_paid: ["amount", "paymentamount", "grossamount", "invoiceamount", "taxableamount", "creditamount", "amountcredited", "amountpaidcredited", "amountpaid", "netamount", "billamt", "billamount", "billvalue", "invoiceamt", "grossamt", "taxableamt", "invoicevalue", "paidamount"],
  // "amountoftds" handles "Amount of TDS"; "tdsamt" handles "TDS AMT".
  // "tdspaid"/"tdspayable" are the DOMINANT TDS-column labels in many working files
  // ("TDS PAID" alone appears 1365× across the client corpus). Without them the tax
  // column normalises to "tdspaid", matches no synonym (the 3-char "tds" core is
  // skipped by the ≥4 substring rule), maps to NULL, and every row fabricates a "TDS
  // differs" mismatch. The `paid && date` guard above still nulls "TDS Paid Date".
  tds_amount: ["tds", "tdsamount", "amountoftds", "taxdeducted", "deductedtax", "taxamount", "tdsdeducted", "tdsamt", "tdspaid", "tdspayable", "tdsdeposited", "incometax"],
  interest: ["interest", "interestamount", "lateinterest", "int"],
  rate: ["rate", "tdsrate", "rateoftds", "oftds", "percentoftds"],
  date_of_payment: ["dateofcredit", "creditdate", "dateofpaymentcredit", "voucherdate", "transactiondate", "date", "valuedate", "entrydate", "postingdate", "invoicedate", "dateofinvoice", "billdate", "billdt", "dateofpayment", "paymentdate", "deductiondate"],
  date_of_deduction: ["dateofdeduction", "tdsdeductiondate"],
  challan_bsr: ["bsr", "bsrcode", "challanbsr"],
  challan_no: ["challanno", "challannumber", "challanserialno", "challan"],
};

/** lowercase, strip everything but letters/digits, so "Date of Credit" and "date_of_credit " and "DATE-OF-CREDIT" all normalise identically. */
const normaliseHeader = (h: string): string => h.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Classify ONE source column header to its best canonical field, or null if it
 * doesn't correspond to any. Exact synonym match wins over substring; a couple
 * of structural guards keep challan/paid-deposit columns from being read as the
 * deductee's payment date (a real client file has a "Paid Date & BSR" column
 * that is the challan deposit, NOT the transaction date).
 */
function bestFieldForHeader(header: string): keyof CanonicalRow | null {
  const norm = normaliseHeader(header);
  if (!norm) return null;
  if (norm.includes("bsr")) return "challan_bsr";                       // "Paid Date & BSR", "BSR Code" → challan, never date
  if (norm.includes("paid") && norm.includes("date")) return null;      // challan/bank DEPOSIT date — we have no field for it; must not become date_of_payment
  if (norm.includes("bank") || norm.includes("branch")) return null;    // "Bank Name"/"Branch" → challan bank, NOT the deductee ("name" synonym would otherwise grab it)
  const fields = Object.keys(HEADER_SYNONYMS) as (keyof CanonicalRow)[];
  for (const f of fields) if (HEADER_SYNONYMS[f].some(s => s === norm)) return f;                     // exact match (any length)
  // Substring match, but BOTH sides must be long enough to be meaningful: a
  // 2–3 char header like "NO." or "CO" or "S.R" must NEVER match because a
  // synonym happens to CONTAIN it (e.g. "panno" contains "no" → serial column
  // wrongly read as PAN). Only match a synonym contained in the header, or a
  // header (≥4 chars) contained in a synonym.
  for (const f of fields) if (HEADER_SYNONYMS[f].some(s => s.length >= 4 && (norm.includes(s) || (norm.length >= 4 && s.includes(norm))))) return f;
  return null;
}

/** Coerce a raw cell for a given canonical field (same rules coerceRow uses).
 * Returns undefined for an empty/absent cell. */
function coerceField(field: keyof CanonicalRow, v: unknown): string | number | undefined {
  if (v === null || v === undefined || String(v).trim() === "") return undefined;
  if (field === "pan") return String(v).trim().toUpperCase();
  if (field === "amount_paid" || field === "tds_amount" || field === "interest" || field === "rate") {
    const n = toNum(v);
    return n === null ? undefined : n;
  }
  return String(v).trim();
}

// ── Deterministic section-column picker ─────────────────────────────────────
// The single biggest source of false "Section Mismatch"es was the LLM
// inconsistently choosing WHICH column is the TDS section when a client file has
// several section-ish columns at once — a clean code column ("194J"), a
// descriptive one ("TDS - Professional Fees"), AND a raw legal-clause column
// ("393(1) 6(iii) D(b)"). Re-importing the very SAME file could yield "194J" one
// day and "393(1)..." the next (observed in production: batch 1 captured
// "194C/194J", a re-import of the identical file captured "393(1)..." garbage).
// This resolves the section column deterministically FROM THE DATA: score every
// column by how many of its values look like a genuine TDS section (a 192–206
// statutory code, or a standard nature-of-payment word) and pick the best —
// strongly preferring a column of actual codes, then descriptive text, and never
// an unmappable clause-citation column. The result overrides the LLM's guess.
const SEC_CODE_RE = /\b(19[2-9][A-Z]{0,2}|20[0-9][A-Z]{0,2})\b/;
const SEC_KEYWORDS = ["contract", "professional", "technical", "rent", "commission", "brokerage", "salary", "interest", "purchase", "goods", "dividend", "royalty", "insurance", "transport", "advertis"];
function classifySectionCell(v: unknown): "code" | "keyword" | "none" {
  const s = v == null ? "" : String(v).trim();
  if (!s) return "none";
  if (SEC_CODE_RE.test(s.toUpperCase().replace(/\s+/g, ""))) return "code";
  const low = s.toLowerCase();
  return SEC_KEYWORDS.some(k => low.includes(k)) ? "keyword" : "none";
}
/** Best section column by data pattern, or null if no column reads as sections. */
function pickSectionColumn(allRows: Record<string, unknown>[]): string | null {
  const headers = new Set<string>();
  for (const r of allRows) if (r && typeof r === "object") for (const k of Object.keys(r)) headers.add(k);
  let best: { header: string; code: number; kw: number; frac: number } | null = null;
  for (const h of headers) {
    let nonEmpty = 0, code = 0, kw = 0;
    for (const r of allRows) {
      const s = r?.[h] == null ? "" : String(r[h]).trim();
      if (!s) continue;
      nonEmpty++;
      const c = classifySectionCell(s);
      if (c === "code") code++; else if (c === "keyword") kw++;
    }
    if (nonEmpty === 0) continue;
    const frac = (code + kw) / nonEmpty;
    if (frac < 0.5) continue; // at least half the column's values must read as sections
    // Prefer most real CODES, then keyword hits, then coverage.
    if (!best || code > best.code || (code === best.code && kw > best.kw) || (code === best.code && kw === best.kw && frac > best.frac)) {
      best = { header: h, code, kw, frac };
    }
  }
  return best ? best.header : null;
}

// ── Data-pattern column detection (deterministic, no LLM) ────────────────────
// Fills the gaps header-name matching leaves: a PAN column and a date column are
// identifiable from their VALUES alone, regardless of how the header is worded.
// Together with the header synonyms and pickSectionColumn this lets the
// overwhelming majority of real client files map with ZERO AI calls — the file
// is parsed to structured rows and normalised entirely in code.
const PAN_VALUE_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const DATE_VALUE_RE = /^(\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4}|\d{4}[/\-.]\d{1,2}[/\-.]\d{1,2})/;
// Textual-month dates ("6-Oct-25", "6 Oct 2025", "Oct 6, 2025") are common in
// exported client files; recognise them so a date column is still detected by
// VALUE when its header isn't a known synonym.
const DATE_TEXT_RE = /^(\d{1,2}[\s\-][A-Za-z]{3,9}[\s\-,]+\d{2,4}|[A-Za-z]{3,9}\s+\d{1,2},?\s+\d{2,4})$/;
function looksLikePan(v: unknown): boolean {
  const s = v == null ? "" : String(v).trim().toUpperCase().replace(/\s+/g, "");
  return PAN_VALUE_RE.test(s);
}
function looksLikeDate(v: unknown): boolean {
  if (v instanceof Date) return true;
  const s = v == null ? "" : String(v).trim();
  return DATE_VALUE_RE.test(s) || DATE_TEXT_RE.test(s);
}
/** A deductee-NAME-looking value: mostly letters, multi-char, and NOT a PAN /
 * date / pure number / section code. Used only as a LAST-RESORT column detector
 * when no header matched a name synonym (e.g. an unlabelled or oddly-named party
 * column). Section/challan columns are claimed before this runs. */
function looksLikeName(v: unknown): boolean {
  const s = v == null ? "" : String(v).trim();
  if (s.length < 4) return false;
  if (PAN_VALUE_RE.test(s.toUpperCase().replace(/\s+/g, ""))) return false;
  if (looksLikeDate(s)) return false;
  if (/^[\d.,\-₹%()\s/]+$/.test(s)) return false;                       // pure number / money
  if (SEC_CODE_RE.test(s.toUpperCase().replace(/\s+/g, ""))) return false; // a section code
  const letters = (s.match(/[A-Za-z]/g) || []).length;
  return letters >= 3 && letters / s.length >= 0.5;                     // predominantly alphabetic
}
/** Pick the (unclaimed) column whose non-empty VALUES best satisfy `pred`
 * (≥60%). Used to resolve pan/date columns when their headers didn't match a
 * synonym. Returns null if no column fits. */
function detectColumnByValue(
  allRows: Record<string, unknown>[], claimed: Set<string>, pred: (v: unknown) => boolean,
): string | null {
  const headers = new Set<string>();
  for (const r of allRows) if (r && typeof r === "object") for (const k of Object.keys(r)) headers.add(k);
  let best: { header: string; frac: number } | null = null;
  for (const h of headers) {
    if (claimed.has(h)) continue;
    let nonEmpty = 0, hit = 0;
    for (const r of allRows) {
      const v = r?.[h];
      if (v === null || v === undefined || String(v).trim() === "") continue;
      nonEmpty++; if (pred(v)) hit++;
    }
    if (nonEmpty === 0) continue;
    const frac = hit / nonEmpty;
    if (frac >= 0.6 && (!best || frac > best.frac)) best = { header: h, frac };
  }
  return best ? best.header : null;
}

/** A resolved header→field map: each source column header points at the
 * canonical field it feeds. Several headers may map to the SAME field. */
type HeaderMap = Record<string, keyof CanonicalRow>;

/**
 * Resolve the header→field map for a whole tabular file, deterministically:
 *   1. classify every distinct source header by wording (bestFieldForHeader);
 *   2. value-based section column (pickSectionColumn) — the most reliable way to
 *      identify the section, and what stops the re-import section flip-flop;
 *   3. value-based PAN / date columns when no header matched by name.
 * `aiMap` (from resolveMappingWithAI) is merged in as a LAST resort for fields
 * still unresolved — deterministic assignments are never overwritten.
 */
function resolveColumnMapping(allRows: Record<string, unknown>[], aiMap?: Partial<Record<keyof CanonicalRow, string>>): HeaderMap {
  const headers = new Set<string>();
  for (const r of allRows) if (r && typeof r === "object") for (const k of Object.keys(r)) headers.add(k);

  const map: HeaderMap = {};
  for (const h of headers) { const f = bestFieldForHeader(h); if (f) map[h] = f; }

  const mappedFields = () => new Set(Object.values(map));
  const secCol = pickSectionColumn(allRows);
  if (secCol && !map[secCol]) map[secCol] = "section_code";
  if (!mappedFields().has("pan")) { const c = detectColumnByValue(allRows, new Set(Object.keys(map)), looksLikePan); if (c) map[c] = "pan"; }
  if (!mappedFields().has("date_of_payment")) { const c = detectColumnByValue(allRows, new Set(Object.keys(map)), looksLikeDate); if (c) map[c] = "date_of_payment"; }
  // Last-resort NAME by value — only when no header matched a name synonym. Runs
  // AFTER section/pan/date are claimed so it can't steal them; picks the unclaimed
  // column whose values are most name-like (the party column even under an
  // unlabelled/odd header). Without this, a file with an exotic name header yields
  // no name → nothing for the compare engine to pair on.
  if (!mappedFields().has("deductee_name")) {
    // Exclude challan/bank/narration-ish columns from value-based name detection —
    // they contain name-like text ("HDFC BANK LTD", narration) but are NOT the
    // deductee, and their header returned null from bestFieldForHeader so they'd
    // otherwise be unclaimed and eligible.
    const blocked = new Set(Object.keys(map));
    for (const h of headers) { if (/bank|branch|narration|challan|deposit|remark|address|particularsofpayment/.test(normaliseHeader(h))) blocked.add(h); }
    const c = detectColumnByValue(allRows, blocked, looksLikeName); if (c) map[c] = "deductee_name";
  }

  if (aiMap) {
    const have = mappedFields();
    for (const [f, h] of Object.entries(aiMap) as [keyof CanonicalRow, string][]) {
      if (h && !have.has(f) && !map[h]) map[h] = f;
    }
  }
  return map;
}

/** Build a canonical row PURELY from the header→field map — no AI, no per-row
 * model call. For each field the FIRST non-empty mapped column (in map order)
 * wins, so heterogeneous sheets (one uses "PAN", another "PAN No.") both feed
 * the same field. This is the deterministic normaliser that replaces the old
 * per-batch LLM extraction for tabular files. */
function buildCanonicalFromMap(row: Record<string, unknown>, map: HeaderMap): CanonicalRow {
  const out: CanonicalRow = {
    deductee_name: null, pan: null, section_code: null, amount_paid: null, tds_amount: null,
    interest: null, rate: null, date_of_payment: null, date_of_deduction: null, challan_bsr: null, challan_no: null,
  };
  for (const [header, field] of Object.entries(map)) {
    if (out[field] !== null) continue;                 // first non-empty mapped column wins
    const v = coerceField(field, row[header]);
    if (v !== undefined) (out as Record<string, unknown>)[field] = v;
  }
  return out;
}

function extractJson(text: string): any {
  if (!text) return null;
  let s = text.trim();
  // Strip ```json ... ``` fences if present
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  try { return JSON.parse(s); } catch { /* fall through */ }
  // Last resort: grab the outermost {...}
  const first = s.indexOf("{");
  const last = s.lastIndexOf("}");
  if (first >= 0 && last > first) {
    try { return JSON.parse(s.slice(first, last + 1)); } catch { /* ignore */ }
  }
  return null;
}

// Robust money parser — mirrors the compare engine's normAmount so a value the
// importer stores is read back identically at compare time. Handles ₹/Rs, Indian
// grouping ("1,22,340"), accounting negatives "(1,234)", a trailing sign "170.94-"
// or "/-", unicode minus, Cr/Dr suffixes, hidden chars and numbers-stored-as-text.
function toNum(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return isFinite(v) ? v : null;
  let s = String(v).trim().replace(/−/g, "-");
  const paren = /^\(.+\)$/.test(s);
  const leadingMinus = /^-/.test(s);                            // standard negative "-1234"
  // A minus AFTER a digit ("1,234-") is an accounting negative; but "170/-" is
  // the Indian rupee terminator (positive), so exclude the "/-" form.
  const trailingMinus = /[0-9)]\s*-\s*$/.test(s) && !/\/-\s*$/.test(s);
  const neg = paren || leadingMinus || trailingMinus;
  s = s.replace(/[^0-9.]/g, "");                 // drop everything incl. minus; sign is decided above
  const m = s.match(/\d+(?:\.\d+)?/);            // first numeric token (ignores stray extra dots)
  if (!m) return null;
  const n = Number((neg ? "-" : "") + m[0]);
  return isFinite(n) ? n : null;
}

function coerceRow(r: any): CanonicalRow {
  return {
    deductee_name: r?.deductee_name != null ? String(r.deductee_name).trim() : null,
    pan: r?.pan != null ? String(r.pan).trim().toUpperCase() : null,
    section_code: r?.section_code != null ? String(r.section_code).trim() : null,
    amount_paid: toNum(r?.amount_paid),
    tds_amount: toNum(r?.tds_amount),
    interest: toNum(r?.interest),
    rate: toNum(r?.rate),
    date_of_payment: r?.date_of_payment != null ? String(r.date_of_payment).trim() : null,
    date_of_deduction: r?.date_of_deduction != null ? String(r.date_of_deduction).trim() : null,
    challan_bsr: r?.challan_bsr != null ? String(r.challan_bsr).trim() : null,
    challan_no: r?.challan_no != null ? String(r.challan_no).trim() : null,
  };
}

type AIResult = { ok: boolean; status: number; errText: string; content: string; truncated: boolean };

// Graceful multi-provider LLM call. Tries each CONFIGURED provider in order and
// FALLS THROUGH on failure — so e.g. Anthropic returning "credit balance too low"
// (400) transparently drops to the Lovable AI gateway. Order: OpenRouter (if the
// firm set their own key) → Lovable (the app's provisioned Gemini gateway) →
// Anthropic (last resort). Mirrors claude-gateway's fallback philosophy. All
// paths read PDFs. Returns text content + a `truncated` flag.
// Bound every provider fetch: a slow/hung AI provider must not make the whole
// edge function sit until Supabase's wall-clock limit kills it (a body-less
// non-2xx). On timeout the provider call returns ok:false and callAI falls
// through to the next provider.
async function fetchWithTimeout(url: string, init: RequestInit, ms = 60000): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try { return await fetch(url, { ...init, signal: ctrl.signal }); }
  finally { clearTimeout(t); }
}

async function callAI(opts: {
  system: string; userText: string; maxTokens: number;
  pdf?: { base64: string; filename: string };
  image?: { base64: string; mediaType: string };   // scanned docs / photos (jpg, png, webp, …)
}): Promise<AIResult> {
  const dataUrl = opts.pdf ? `data:application/pdf;base64,${opts.pdf.base64}`
    : opts.image ? `data:${opts.image.mediaType};base64,${opts.image.base64}` : "";

  // OpenAI-compatible providers (OpenRouter, Lovable). extractJson downstream
  // tolerates ```json fences, so we skip response_format for portability.
  const openAICompat = async (url: string, key: string, model: string, pdfMode: "file" | "image_url", extra: Record<string, string>): Promise<AIResult> => {
    let userContent: any = opts.userText;
    if (opts.pdf) {
      userContent = pdfMode === "file"
        ? [{ type: "text", text: opts.userText }, { type: "file", file: { filename: opts.pdf.filename, file_data: dataUrl } }]
        : [{ type: "text", text: opts.userText }, { type: "image_url", image_url: { url: dataUrl } }];
    } else if (opts.image) {
      userContent = [{ type: "text", text: opts.userText }, { type: "image_url", image_url: { url: dataUrl } }];
    }
    const body: any = { model, temperature: 0, max_tokens: opts.maxTokens, messages: [{ role: "system", content: opts.system }, { role: "user", content: userContent }] };
    if (opts.pdf && pdfMode === "file") body.plugins = [{ id: "file-parser", pdf: { engine: Deno.env.get("OPENROUTER_PDF_ENGINE") || "pdf-text" } }];
    let res: Response;
    try { res = await fetchWithTimeout(url, { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...extra }, body: JSON.stringify(body) }); }
    catch (e) { return { ok: false, status: 504, errText: `Provider request timed out/failed: ${e instanceof Error ? e.message : String(e)}`, content: "", truncated: false }; }
    if (!res.ok) return { ok: false, status: res.status, errText: await res.text(), content: "", truncated: false };
    const j = await res.json();
    return { ok: true, status: 200, errText: "", content: j?.choices?.[0]?.message?.content ?? "", truncated: j?.choices?.[0]?.finish_reason === "length" };
  };

  const anthropic = async (key: string): Promise<AIResult> => {
    const model = Deno.env.get("ANTHROPIC_MODEL") || "claude-sonnet-4-20250514";
    const userContent: any = opts.pdf
      ? [{ type: "text", text: opts.userText }, { type: "document", source: { type: "base64", media_type: "application/pdf", data: opts.pdf.base64 } }]
      : opts.image
      ? [{ type: "text", text: opts.userText }, { type: "image", source: { type: "base64", media_type: opts.image.mediaType, data: opts.image.base64 } }]
      : [{ type: "text", text: opts.userText }];
    let res: Response;
    try {
      res = await fetchWithTimeout("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json", ...(opts.pdf ? { "anthropic-beta": "pdfs-2024-09-25" } : {}) },
        body: JSON.stringify({ model, max_tokens: Math.min(opts.maxTokens, 8000), system: opts.system, messages: [{ role: "user", content: userContent }] }),
      });
    } catch (e) { return { ok: false, status: 504, errText: `Provider request timed out/failed: ${e instanceof Error ? e.message : String(e)}`, content: "", truncated: false }; }
    if (!res.ok) return { ok: false, status: res.status, errText: await res.text(), content: "", truncated: false };
    const j = await res.json();
    const text = Array.isArray(j?.content) ? j.content.filter((b: any) => b?.type === "text").map((b: any) => b.text).join("") : "";
    return { ok: true, status: 200, errText: "", content: text, truncated: j?.stop_reason === "max_tokens" };
  };

  const OPENROUTER = Deno.env.get("OPENROUTER_API_KEY");
  const LOVABLE = Deno.env.get("LOVABLE_API_KEY");
  const ANTHROPIC = Deno.env.get("ANTHROPIC_API_KEY");
  let last: AIResult = { ok: false, status: 503, errText: "No AI provider configured. Set OPENROUTER_API_KEY, LOVABLE_API_KEY or ANTHROPIC_API_KEY.", content: "", truncated: false };

  if (OPENROUTER) {
    const r = await openAICompat("https://openrouter.ai/api/v1/chat/completions", OPENROUTER, Deno.env.get("OPENROUTER_MODEL") || "google/gemini-2.5-flash", "file", { "HTTP-Referer": "https://caflow.app", "X-Title": "CAFlow TDS Recon" });
    if (r.ok) return r; last = r; console.error("callAI: OpenRouter failed", r.status, r.errText.slice(0, 160));
  }
  if (LOVABLE) {
    const r = await openAICompat("https://ai.gateway.lovable.dev/v1/chat/completions", LOVABLE, Deno.env.get("LOVABLE_MODEL") || "google/gemini-2.5-flash", "image_url", {});
    if (r.ok) return r; last = r; console.error("callAI: Lovable failed", r.status, r.errText.slice(0, 160));
  }
  if (ANTHROPIC) {
    const r = await anthropic(ANTHROPIC);
    if (r.ok) return r; last = r; console.error("callAI: Anthropic failed", r.status, r.errText.slice(0, 160));
  }
  return last;
}

// ── AI column-mapping resolver (fallback ONLY) ──────────────────────────────
// The AI never reads the file row-by-row anymore. When the deterministic passes
// (header synonyms + data patterns) can't identify a REQUIRED column, this makes
// ONE small call that sees only the column headers + a handful of sample rows
// and returns which source column maps to each canonical field. The mapping is
// then applied to every row in code. One bounded call per import — never scales
// with row count — so it can't overrun the edge-function time budget.
const MAPPING_INSTRUCTION = `You are given the COLUMN HEADERS and a few SAMPLE ROWS of a client's TDS statement (already parsed from Excel/CSV — you do NOT read a raw file). Identify which source column corresponds to each canonical TDS field, judging by the header's MEANING and the DATA PATTERN in the samples.

Canonical fields: deductee_name, pan, section_code, amount_paid, tds_amount, interest, rate, date_of_payment, date_of_deduction, challan_bsr, challan_no.

Guidance: a column of values like "AJKPM0355R" is pan; a column of dd/mm/yyyy values is a date; amount_paid is the gross / bill / invoice / paid amount (usually the largest money column) while tds_amount is the smaller tax-deducted column; section_code is the TDS section or nature of payment — prefer a descriptive column ("TDS - Contract", "Professional Fees") or a clean code ("194C", "194Q") over a raw legal-clause citation ("393(1)..."). If the file has BOTH a transaction date ("Date of Credit", populated on every row) and a challan / bank deposit date (only filled where there is a Bank/BSR/Challan value), map date_of_payment to the always-populated transaction date, never the sparse challan column.

Return STRICT JSON only, no prose: {"mapping": {"deductee_name": "<exact source column header or null>", "pan": "...", "section_code": "...", "amount_paid": "...", "tds_amount": "...", "interest": "...", "rate": "...", "date_of_payment": "...", "date_of_deduction": "...", "challan_bsr": "...", "challan_no": "..."}}`;

async function resolveMappingWithAI(allRows: Record<string, unknown>[]): Promise<Partial<Record<keyof CanonicalRow, string>>> {
  const headers = new Set<string>();
  for (const r of allRows.slice(0, 50)) if (r && typeof r === "object") for (const k of Object.keys(r)) headers.add(k);
  const cols = [...headers];
  if (!cols.length) return {};
  const r = await callAI({
    system: MAPPING_INSTRUCTION,
    userText: `Column headers: ${JSON.stringify(cols)}\n\nSample rows: ${JSON.stringify(allRows.slice(0, 5))}`,
    maxTokens: 1500,
  });
  if (!r.ok) { console.error("resolveMappingWithAI failed", r.status, r.errText.slice(0, 160)); return {}; }
  const parsed = extractJson(typeof r.content === "string" ? r.content : JSON.stringify(r.content));
  const m = parsed?.mapping && typeof parsed.mapping === "object" ? parsed.mapping : null;
  if (!m) return {};
  const out: Partial<Record<keyof CanonicalRow, string>> = {};
  const valid = new Set(cols);
  for (const f of Object.keys(HEADER_SYNONYMS) as (keyof CanonicalRow)[]) {
    if (typeof m[f] === "string" && valid.has(m[f])) out[f] = m[f];
  }
  return out;
}

serve(async (req) => {
  const corsHeaders = corsFor(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "").trim();
    if (!token) return json({ error: "Unauthorized" }, 401);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) return json({ error: "Unauthorized" }, 401);

    if (!Deno.env.get("OPENROUTER_API_KEY") && !Deno.env.get("LOVABLE_API_KEY") && !Deno.env.get("ANTHROPIC_API_KEY")) {
      return json({ error: "No AI provider configured. Set OPENROUTER_API_KEY, LOVABLE_API_KEY or ANTHROPIC_API_KEY in Supabase secrets." }, 503);
    }

    const body = await req.json();
    // Format-agnostic input. The engine accepts ANY source; the client sends the
    // most useful representation and the LLM normalises whatever it gets:
    //   • rows          — tabular (xlsx / xls / csv / json array of objects)
    //   • pdf_base64     — PDF (native/scanned; read by a multimodal model)
    //   • image_base64   — a scanned document or photo (png/jpg/webp/…)
    //   • raw_text       — free text / semi-structured (txt / xml / json object / html …)
    const { filing_id, form_type, file_name, file_type, rows, pdf_base64, image_base64, image_media_type, raw_text } = body ?? {};
    if (!filing_id) return json({ error: "filing_id is required" }, 400);
    const hasInput = Array.isArray(rows) || pdf_base64 || image_base64 || (typeof raw_text === "string" && raw_text.trim());
    if (!hasInput) {
      return json({ error: "Provide `rows` (tabular), `pdf_base64` (PDF), `image_base64` (image) or `raw_text` (text)." }, 400);
    }

    // Resolve filing scope (firm/client/period) — the batch inherits it.
    const { data: filing, error: fErr } = await supabase
      .from("tds_filings")
      .select("id, client_id, firm_id, financial_year, quarter, tds_forms")
      .eq("id", filing_id)
      .single();
    if (fErr || !filing) return json({ error: "Filing not found" }, 404);

    // AUTHORIZE — the service-role client above bypasses RLS, so we MUST verify
    // the authenticated caller actually belongs to this filing's firm (or is a
    // superadmin). Without this, any authenticated user could pass another
    // firm's filing_id and import into / read that firm's data (cross-firm IDOR).
    const { data: caller } = await supabase.from("users").select("firm_id, role").eq("id", user.id).single();
    if (!caller || (caller.firm_id !== filing.firm_id && caller.role !== "superadmin")) {
      return json({ error: "You are not authorised for this filing." }, 403);
    }

    const resolvedForm = form_type || (Array.isArray(filing.tds_forms) ? filing.tds_forms[0] : null) || "26Q";

    // ── Normalise ───────────────────────────────────────────────────────────────
    // Tabular files (xlsx/csv/json) are normalised DETERMINISTICALLY: resolve the
    // column→field mapping once (header synonyms + data patterns, with a single
    // bounded AI call only if a required column can't be identified) and build
    // every canonical row in code — the AI never reads rows batch-by-batch, so a
    // large file cannot overrun the edge-function time budget (the root cause of
    // the "non-2xx" failures). Only PDF/image/free-text, which genuinely need a
    // model to read them, use the single-pass LLM path below. IMPORT_MAX_TOKENS
    // is the generous output budget for that single pass.
    const IMPORT_MAX_TOKENS = 24000;
    const collected: CanonicalRow[] = [];

    const httpErr = (status: number, errText: string) => {
      console.error("AI import error:", status, errText);
      // Surface the provider's real reason (trimmed) instead of a bare code, so
      // an unsupported/invalid file gives an actionable message.
      let detail = "";
      try { const j = JSON.parse(errText); detail = j?.error?.message || j?.error || j?.message || ""; } catch { detail = errText; }
      detail = String(detail || "").slice(0, 240);
      const msg = status === 401 ? "AI provider authentication failed — check the configured API key."
        : status === 402 ? "AI provider payment required — add credits."
        : status === 429 ? "AI provider rate limit — try again shortly."
        : `AI import failed (${status})${detail ? `: ${detail}` : ""}`;
      return json({ error: msg }, status >= 500 ? 502 : status);
    };

    // Single-pass extraction helper (PDF / image / raw text share this).
    const singlePass = async (userText: string, media?: { pdf?: { base64: string; filename: string }; image?: { base64: string; mediaType: string } }) => {
      const r = await callAI({ system: CANONICAL_INSTRUCTION, userText, maxTokens: IMPORT_MAX_TOKENS, ...(media || {}) });
      if (!r.ok) return { err: httpErr(r.status, r.errText) };
      if (r.truncated) return { err: json({ error: "This document has more rows than can be read in one pass. Split it, or import the data as Excel/CSV." }, 422) };
      const parsed = extractJson(typeof r.content === "string" ? r.content : JSON.stringify(r.content));
      const raw: any[] = Array.isArray(parsed?.rows) ? parsed.rows : Array.isArray(parsed) ? parsed : [];
      return { rows: raw.map(coerceRow) };
    };

    if (pdf_base64) {
      const out = await singlePass(
        `Extract every deductee line item from this ${resolvedForm} TDS statement PDF into the canonical rows.`,
        { pdf: { base64: pdf_base64, filename: file_name || "client.pdf" } });
      if (out.err) return out.err;
      collected.push(...out.rows!);
    } else if (image_base64) {
      const out = await singlePass(
        `Read this scanned ${resolvedForm} TDS statement image and extract every deductee line item into the canonical rows.`,
        { image: { base64: image_base64, mediaType: image_media_type || "image/png" } });
      if (out.err) return out.err;
      collected.push(...out.rows!);
    } else if (typeof raw_text === "string" && raw_text.trim()) {
      // Free / semi-structured text (txt, xml, json object, html, …) — the model
      // reads the business meaning and normalises it. Large tabular data should
      // arrive as `rows`; text is truncated to keep the single pass within budget.
      const out = await singlePass(
        `The following is a ${resolvedForm} TDS statement in raw ${(file_type || "text").toUpperCase()} form. Extract every deductee line item into the canonical rows.\n\n${String(raw_text).slice(0, 200000)}`);
      if (out.err) return out.err;
      collected.push(...out.rows!);
    } else {
      // Excel/CSV/JSON tabular — DETERMINISTIC normalisation, no per-row AI.
      // The client already parsed the file into structured rows. We resolve the
      // column→field mapping once and build every canonical row in code. This is
      // O(rows) local work (milliseconds), not N sequential model calls, so it
      // NEVER overruns the edge-function time budget regardless of file size —
      // the fix for both the "non-2xx" timeouts and the redundant AI work (the
      // old path called the model per 100-row batch and then overwrote most of
      // its output with these very same deterministic column reads).
      const allRows = (rows as Record<string, unknown>[]).slice(0, 20000);

      // 1) Resolve the header→field map deterministically (synonyms + value-based
      //    section/PAN/date). Handles heterogeneous multi-sheet workbooks (many
      //    headers → one field).
      let map = resolveColumnMapping(allRows);
      const enough = (m: HeaderMap) => {
        const f = new Set(Object.values(m));
        return (f.has("pan") || f.has("deductee_name")) && (f.has("amount_paid") || f.has("tds_amount"));
      };

      // 2) Only if a REQUIRED field is still unidentified (need an identity —
      //    PAN or name — and a money column — amount or TDS) do we make ONE small
      //    AI call that maps columns from headers + 5 sample rows. It never scales
      //    with row count, so it can't overrun the time budget. Deterministic
      //    assignments are never overwritten.
      let mappingSource = "deterministic";
      if (!enough(map)) {
        const aiMap = await resolveMappingWithAI(allRows);
        if (Object.keys(aiMap).length) { map = resolveColumnMapping(allRows, aiMap); mappingSource = "ai-assisted"; }
      }

      if (!enough(map)) {
        return json({ error: "Could not identify the deductee columns — the file needs at least a Name/PAN column and an Amount/TDS column. Please check the column headers." }, 422);
      }

      // 3) Build every row from the map, in code (no per-row AI).
      for (const row of allRows) collected.push(buildCanonicalFromMap(row, map));
      console.log(`tds-recon-import: ${mappingSource} mapping over ${allRows.length} rows →`, JSON.stringify(map));
    }

    // drop wholly-empty rows the model may echo
    const canonical = collected.filter(r => r.deductee_name || r.pan || r.amount_paid != null || r.tds_amount != null);

    if (canonical.length === 0) {
      return json({ error: "No deductee rows could be read from the file. Check the file has recognisable columns/section." }, 422);
    }

    // ── Persist batch + rows ───────────────────────────────────────────────────
    // SEQUENTIAL MULTI-FILE support: a filing's imported dataset is the UNION of
    // all DISTINCT files imported for it (clients often keep 194Q — or each
    // section / month / branch — in a separate workbook). Re-importing the SAME
    // file must REPLACE its data, not add a duplicate, so first drop any earlier
    // batch(es) for this filing with the same file name. Different file names
    // accumulate and are all reconciled together by tds-recon-compare.
    let replaced = false;
    if (file_name) {
      const { data: dupBatches } = await supabase
        .from("tds_import_batches").select("id").eq("filing_id", filing_id).eq("file_name", file_name);
      const dupIds = (dupBatches ?? []).map((b: any) => b.id);
      if (dupIds.length) {
        await supabase.from("tds_imported_rows").delete().in("batch_id", dupIds);
        await supabase.from("tds_import_batches").delete().in("id", dupIds);
        replaced = true;
      }
    }

    const { data: batch, error: bErr } = await supabase
      .from("tds_import_batches")
      .insert({
        filing_id, client_id: filing.client_id, firm_id: filing.firm_id,
        financial_year: filing.financial_year, quarter: filing.quarter, form_type: resolvedForm,
        file_name: file_name ?? null, file_type: file_type ?? null,
        row_count: canonical.length, status: "imported", imported_by: user.id,
      })
      .select("id")
      .single();
    if (bErr || !batch) {
      // 23505 = the partial unique index (filing_id, file_name) fired — a
      // same-name batch slipped in between our delete above and this insert
      // (two imports of the same file racing). Safe to retry after a reload.
      const dup = (bErr as any)?.code === "23505";
      return json({ error: dup ? "That file is already being imported for this return — reload and try again." : `Batch insert failed: ${bErr?.message}` }, dup ? 409 : 500);
    }

    // Every field is already a first-class column, so we DON'T duplicate the
    // whole row into a `raw` jsonb — that just doubled the insert payload + DB
    // storage for no reader.
    const rowRecords = canonical.map((r, i) => ({
      batch_id: batch.id, filing_id, firm_id: filing.firm_id, row_index: i,
      deductee_name: r.deductee_name, pan: r.pan, section_code: r.section_code,
      amount_paid: r.amount_paid, tds_amount: r.tds_amount, interest: r.interest, rate: r.rate,
      date_of_payment: r.date_of_payment, date_of_deduction: r.date_of_deduction,
      challan_bsr: r.challan_bsr, challan_no: r.challan_no,
    }));
    // Chunked insert — a single 20k-row POST can exceed the request/statement
    // size limit or spike memory; 1000-row chunks keep each request small and
    // report exactly how far a mid-way failure got. On a mid-way failure, roll
    // back the batch so a re-import doesn't compare against a half-inserted one.
    const INSERT_CHUNK = 1000;
    for (let i = 0; i < rowRecords.length; i += INSERT_CHUNK) {
      const { error: rErr } = await supabase.from("tds_imported_rows").insert(rowRecords.slice(i, i + INSERT_CHUNK));
      if (rErr) {
        await supabase.from("tds_imported_rows").delete().eq("batch_id", batch.id);
        await supabase.from("tds_import_batches").delete().eq("id", batch.id);
        return json({ error: `Row insert failed at row ${i + 1} of ${rowRecords.length}: ${rErr.message}` }, 500);
      }
    }

    // NOTE: the client re-reads the batch via loadAll(), so we do NOT echo the
    // full rows array back (a 20k-row response is needless megabytes).
    return json({ batch_id: batch.id, row_count: canonical.length, replaced });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("tds-recon-import fatal:", message);
    return json({ error: message }, 500);
  }
});
