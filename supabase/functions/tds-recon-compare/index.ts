/**
 * tds-recon-compare  (deterministic — no LLM)
 *
 * Reconciles Office Data (manually-entered tds_deductees for a filing) against the
 * latest Imported Client Data batch (tds_imported_rows), record-by-record and
 * field-by-field, using DETERMINISTIC rules — not an LLM (bar the one section
 * adjudication below). The previous LLM approach mis-PAIRED rows (matching an office
 * row to the wrong transaction of the same party), producing false "Section
 * Mismatch"es. This engine:
 *
 *   1. PAIRS with the ONE SHARED EXCLUSIVITY ENGINE (../_shared/assignment.ts) — the
 *      same code Stage 3 runs. No score, no threshold: it commits a pairing only when
 *      it is uniquely best for BOTH sides. Because BOTH sides here carry a PAN, PAN
 *      equality is the strongest tier and a PAN difference blocks a pairing outright —
 *      Issue 2, multi-transaction parties resolved by identity, not position.
 *   2. Canonicalises SECTION through the SHARED canonicalSection, with the configurable
 *      tds_section_aliases table resolved on top (e.g. "TDS - Contract" → 194C) — Issue 3.
 *   3. Emits a full, human-readable per-field diff (Office vs Imported + reason)
 *      for all 7 fields — Issues 1 & 4.
 *   4. All name/amount/date comparison uses the SHARED match.ts primitives, so a fix
 *      lands in Stage 1, 2 and 3 at once — the three stages can never diverge again.
 *
 * Compares EXACTLY seven fields: name, pan, date, amount, tds, interest, section.
 * Existing override decisions are preserved across re-runs.
 *
 * Input (POST, Bearer auth): { filing_id, batch_id? }   (defaults to latest batch)
 * Output: { batch_id, summary: { total, matched, mismatched, office_only, imported_only, overridden, pending, ... } }
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { callClaudeCliText, isProviderError } from "../_shared/aiProvider.ts";

// ── THE ONE SHARED ENGINE ─────────────────────────────────────────────────────
// Every TDS stage compares with the SAME primitives and pairs with the SAME
// exclusivity engine, so a fix lands everywhere at once and can never again be
// stage-specific. These files are BYTE-IDENTICAL copies of src/lib/tds/{match,
// assignment}.ts (guarded by src/lib/tds/sharedSync.test.ts) — the app cannot import
// from supabase/, and the edge function cannot import from src/, so the proven
// pattern is a guarded copy (same as ../_shared/tdsColumnEngine.ts). Stage 1's own
// divergent amountsMatch / canonicalSection / name logic / greedy pairScore are GONE.
import {
  amountsMatch, normalizeName, nameCompare, normalizePan,
  canonicalSection, makeDateNormaliser,
} from "../_shared/match.ts";
import { assign, type AsgOffice, type AsgLedger } from "../_shared/assignment.ts";

// Everything the firm routes through OpenRouter runs on Claude Haiku, by
// standing instruction. One model across every function keeps the spend
// predictable and the behaviour comparable between them.
const OPENROUTER_DEFAULT_MODEL = "anthropic/claude-haiku-4.5";

// Reflect the browser's requested headers on the preflight (supabase-js v2.98+
// attaches x-supabase-client-* headers; a static allow-list that omits them fails
// the CORS preflight → "Failed to send a request to the Edge Function").
const corsFor = (req: Request) => ({
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    req.headers.get("access-control-request-headers") ??
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
});

const FIELD_ORDER = ["name", "pan", "date", "amount", "tds", "interest", "section"] as const;
type FieldKey = (typeof FIELD_ORDER)[number];

interface FieldDiff { field: string; office: unknown; imported: unknown; matched: boolean; difference: string; }
interface Alias { pattern: string; code: string; priority: number; firm: boolean; }

// ── Normalisers ──────────────────────────────────────────────────────────────
// normPan → the shared normalizePan; amountsMatch → the shared rounding-aware
// amountsMatch (0.5% capped at ₹10); normName → the shared normalizeName. All three
// were Stage-1-local forks that had drifted from the other stages — deleted here.
const normAmount = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return isFinite(v) ? v : null;
  let s = String(v).trim().replace(/−/g, "-");   // unicode minus (−) → ASCII
  const paren = /^\(.+\)$/.test(s);                    // (1,234) = accounting negative
  // Strip EVERYTHING that isn't a digit / dot / minus — handles "₹1,839.00",
  // "Rs. 170", "170.94/-", "1234 Cr"/"Dr", non-breaking & hidden chars, numbers
  // stored as text, "1,22,340" Indian grouping. Decimal precision ("170.9" vs
  // "170.90") and thousands separators fall out for free.
  s = s.replace(/[^0-9.\-]/g, "");
  if (paren && s) s = "-" + s.replace(/-/g, "");
  if (s === "" || s === "-" || s === ".") return null;
  const n = Number(s);
  return isFinite(n) ? n : null;
};
const amt = (v: unknown): number => normAmount(v) ?? 0;
/** Whether a money value is effectively "not recorded" (blank / zero). */
const isBlankOrZero = (v: unknown): boolean => { const n = normAmount(v); return n === null || n === 0; };

/** Name equivalence for a PAIRED record, decided by the SHARED name engine so it
 * behaves identically to Stage 2/3. A matching PAN is the legal identifier (the return
 * is filed by PAN) — so a same-PAN pair is the SAME party and a name spelling/word-
 * order/honorific/abbreviation difference must NOT hard-fail it. Otherwise the name
 * field is OK only when the shared tiered comparison returns "match" (tier ≤ 3 —
 * exact/permutation/abbreviation/vowel-elision), which is exactly the line above which
 * a name may auto-match everywhere else. `unknown` (a name missing on one side) is NOT
 * a match on its own, matching the previous behaviour (blank names never equated). */
function namesEquivalent(oName: unknown, iName: unknown, panMatched: boolean): boolean {
  if (panMatched) return true;                              // same PAN ⇒ same deductee
  return nameCompare(oName == null ? null : String(oName), iName == null ? null : String(iName)) === "match";
}

// Permissive multi-format date → ISO (yyyy-mm-dd). Office dates are ISO (<input
// type=date>), imported dates are free text in whatever the client's file used.
const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const normYear = (y: string): number => { const n = parseInt(y, 10); return n < 100 ? (n < 70 ? 2000 + n : 1900 + n) : n; };
const isoOf = (y: number, mo: number, d: number): string | null => (!y || mo < 1 || mo > 12 || d < 1 || d > 31) ? null : `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
/** Remove a trailing time component ("10/6/25 00:00:00", "2025-10-06T00:00",
 * "6-Oct-25 12:00 AM") so the $-anchored date regexes still match — exported
 * date columns very commonly carry a midnight time. */
const stripTime = (s: string): string => s.replace(/[ T]\d{1,2}:\d{2}(:\d{2})?(\.\d+)?\s*([AaPp]\.?[Mm]\.?)?\s*$/, "").trim();

/** All plausible ISO interpretations of a raw date string (dd/mm and mm/dd both). */
function dateCandidates(raw: unknown): string[] {
  if (raw == null) return [];
  const s = stripTime(String(raw).trim());
  const out: (string | null)[] = [];
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) out.push(isoOf(+m[1], +m[2], +m[3]));
  m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (m) {
    const y = normYear(m[3]);
    // Indian TDS files are dd/mm/yyyy — take that reading, and ONLY fall back to
    // mm/dd when dd/mm is impossible (e.g. "05/13/2026"). Emitting BOTH readings
    // let two genuinely different dates (e.g. 05/06 vs 06/05) match falsely.
    const ddmm = isoOf(y, +m[2], +m[1]);
    if (ddmm) out.push(ddmm); else { const mmdd = isoOf(y, +m[1], +m[2]); if (mmdd) out.push(mmdd); }
  }
  m = s.match(/^(\d{1,2})[\s\-]([a-zA-Z]{3,9})[\s\-,]+(\d{2,4})$/);
  if (m) { const mo = MONTHS[m[2].slice(0, 3).toLowerCase()]; if (mo) out.push(isoOf(normYear(m[3]), mo, +m[1])); }
  m = s.match(/^([a-zA-Z]{3,9})\s+(\d{1,2}),?\s+(\d{2,4})$/);
  if (m) { const mo = MONTHS[m[1].slice(0, 3).toLowerCase()]; if (mo) out.push(isoOf(normYear(m[3]), mo, +m[2])); }
  return [...new Set(out.filter((v): v is string => !!v))];
}
/** Two dates match if any ISO interpretation of one equals any of the other. */
function datesMatch(a: unknown, b: unknown): boolean {
  const ca = dateCandidates(a), cb = dateCandidates(b);
  if (ca.length && cb.length) return ca.some(x => cb.includes(x));
  // Neither parsed → fall back to literal string equality.
  const sa = a == null ? "" : String(a).trim().toLowerCase();
  const sb = b == null ? "" : String(b).trim().toLowerCase();
  return sa !== "" && sa === sb;
}
const primaryIso = (v: unknown): string | null => dateCandidates(v)[0] ?? null;

// ── Column-level date-ORDER detection ─────────────────────────────────────────
// Guessing dd/mm-vs-mm/dd per value misreads a whole file: a client's AMERICAN
// M/D/YY export ("10/6/25" = 6 Oct? no — 6 June under dd/mm) is systematically wrong.
// The SHARED makeDateNormaliser detects each column's convention from its WHOLE set of
// values (a value whose first part > 12 can only be M/D; whose second > 12 only D/M) and
// returns a normaliser using that fixed order — the same algorithm Stage 3 uses. Stage
// 1's own detectDateOrder/toIsoOrder forks are deleted. The local dateCandidates() is
// kept only as a FALLBACK for the extra textual formats ("Apr 5, 2024") that the shared
// primitive doesn't parse, so no client date that matched before stops matching.
function makeIsoNormaliser(values: unknown[]): (v: unknown) => string | null {
  const shared = makeDateNormaliser(values);
  return (v: unknown) => shared(v) ?? primaryIso(v);
}

/** First 4-digit year of an FY string ("2025-26" → 2025). */
function fyStartYear(fy: unknown): number | null {
  const m = String(fy ?? "").match(/(\d{4})/);
  return m ? +m[1] : null;
}
/** Filing quarter as "Q1".."Q4" from "Q3"/"3"/"Quarter 3"/etc. */
function normQuarter(q: unknown): "Q1" | "Q2" | "Q3" | "Q4" | null {
  const m = String(q ?? "").match(/[1-4]/);
  return m ? (("Q" + m[0]) as "Q1" | "Q2" | "Q3" | "Q4") : null;
}
/** Which TDS RETURN FORM a section belongs to. A client working file often
 * carries ALL of a party's TDS in ONE file — salary (192B → 24Q), non-salary
 * resident (194x → 26Q), non-resident (195/196 → 27Q) and TCS (206C → 27EQ) — so
 * a 26Q filing must not compare the 24Q salary rows (they reconcile under the
 * 24Q filing). Returns null for an unrecognised/blank section (kept, never
 * excluded). */
function formOfSection(code: string | null): "24Q" | "26Q" | "27Q" | "27EQ" | null {
  if (!code) return null;
  const c = code.toUpperCase().replace(/\s+/g, "");
  // Order matters — specific before the general 194x pattern.
  if (/^192/.test(c)) return "24Q";                     // salary
  if (/^206C/.test(c)) return "27EQ";                   // TCS
  if (/^195|^196/.test(c)) return "27Q";                // non-resident
  if (/^19[34]/.test(c)) return "26Q";                  // 193 + 194x resident non-salary
  return null;                                          // 197-199/other → unknown, keep
}
/** Filing form as "24Q"/"26Q"/"27Q"/"27EQ" from "26Q"/"26q"/etc. */
function normForm(f: unknown): string | null {
  const m = String(f ?? "").toUpperCase().match(/(24Q|26Q|27Q|27EQ|27EQ)/);
  return m ? m[1] : null;
}
/** Indian FY quarter of an ISO date within FY starting `fyStart` (Apr of that
 * year): Q1 Apr-Jun & Q2 Jul-Sep & Q3 Oct-Dec are in `fyStart`; Q4 Jan-Mar is in
 * `fyStart+1`. Returns null if the date is outside this FY (or unparseable). */
function quarterOfIso(iso: string | null, fyStart: number | null): "Q1" | "Q2" | "Q3" | "Q4" | null {
  if (!iso) return null;
  const m = iso.match(/^(\d{4})-(\d{2})/);
  if (!m) return null;
  const y = +m[1], mo = +m[2];
  if (fyStart != null) {
    if (y === fyStart) return mo >= 4 && mo <= 6 ? "Q1" : mo >= 7 && mo <= 9 ? "Q2" : mo >= 10 && mo <= 12 ? "Q3" : null;
    if (y === fyStart + 1) return mo >= 1 && mo <= 3 ? "Q4" : null;
    return null;
  }
  return mo >= 4 && mo <= 6 ? "Q1" : mo >= 7 && mo <= 9 ? "Q2" : mo >= 10 && mo <= 12 ? "Q3" : "Q4";
}

/**
 * Narrows the imported client-file rows to the ones this filing should compare
 * against — a client working file often holds a WHOLE financial year's data
 * (every section, every quarter) in one sheet, so rows belonging to a
 * different TDS return form or a different quarter are excluded here (they
 * reconcile under THEIR OWN filing, never counted as "imported_only" here).
 *
 * PAN RESCUE — the load-bearing rule of this function: a client row whose PAN
 * is already in Office Data unambiguously belongs to THIS filing, so it is
 * NEVER excluded by either filter below, regardless of its own (non-authoritative,
 * often mislabelled) section, or a possibly-misclassified date. Real reported
 * bug fixed by extending this rescue to the quarter filter: a client file's
 * date cell (Excel serial date / column-wide format detection / etc.) can
 * misclassify an in-quarter payment into a neighbouring quarter even though
 * the PAN proves it belongs here — that must be a Date Mismatch to REPORT
 * during pairing, never a gate that silently drops the row before pairing
 * even runs (which reads as "In Office Data Only" with the imported side
 * entirely blank — not a field mismatch, the counterpart never got there).
 */
function filterImportedRows(
  iRecsAll: any[],
  officePanSet: Set<string>,
  allowedForms: Set<string>,
  filingQ: "Q1" | "Q2" | "Q3" | "Q4" | null,
  fyStart: number | null,
  aliases: any[],
): { iRecs: any[]; excludedOtherForm: number; excludedOtherQuarter: number } {
  let excludedOtherForm = 0;
  let excludedOtherQuarter = 0;
  const iRecs = iRecsAll.filter((r) => {
    const panInOffice = r.panN !== "" && officePanSet.has(r.panN);
    // FORM filter — a 26Q filing must not compare a client file's salary
    // (192B/24Q), non-resident (27Q) or TCS (27EQ) rows; they reconcile under
    // their own form's filing. Unrecognised sections are kept.
    if (allowedForms.size && !panInOffice) {
      const secForm = formOfSection(resolveSection(r.section, aliases));
      if (secForm && !allowedForms.has(secForm)) { excludedOtherForm++; return false; }
    }
    // QUARTER + FY filter — keep only rows whose date is in THIS filing's
    // FY-quarter. A row with a PARSEABLE date that is another quarter OR
    // another financial year (e.g. a "06.02.2025" line in a FY2025-26 Q3 file
    // — that's FY2024-25) is excluded so it can't wrongly pair with a
    // same-PAN office row. Rows with an UNPARSEABLE date are kept (can't
    // classify → don't silently drop). The date uses the whole-COLUMN-detected
    // order (r.iso), more reliable than a per-value dd/mm-vs-mm/dd guess.
    if (filingQ && fyStart != null && r.iso && !panInOffice) {
      if (quarterOfIso(r.iso, fyStart) !== filingQ) { excludedOtherQuarter++; return false; }
    }
    return true;
  });
  return { iRecs, excludedOtherForm, excludedOtherQuarter };
}

// ── Section canonicalisation (configurable table + hard-coded fallback) ───────
// Fallback used only if the tds_section_aliases table can't be read; mirrors the
// migration seed so the engine still maps correctly out-of-box.
const DEFAULT_SECTION_ALIASES: Alias[] = [
  ["interest other than", "194A", 10], ["interest on", "194A", 15], ["interest", "194A", 60],
  ["sub contract", "194C", 10], ["sub-contract", "194C", 10], ["subcontract", "194C", 10],
  ["contractor", "194C", 15], ["contract", "194C", 20], ["advertis", "194C", 25], ["transport", "194C", 30],
  ["insurance commission", "194D", 10], ["commission", "194H", 25], ["brokerage", "194H", 25],
  ["rent of plant", "194I", 10], ["rent of machinery", "194I", 10], ["rent", "194I", 30],
  ["professional", "194J", 20], ["technical", "194J", 20], ["royalty", "194J", 20],
  ["purchase of goods", "194Q", 10], ["purchase", "194Q", 30], ["goods", "194Q", 40],
  ["salary", "192", 20], ["dividend", "194", 20],
  ["collected at source", "206C", 15], ["tcs", "206C", 20],
].map(([pattern, code, priority]) => ({ pattern: String(pattern), code: String(code), priority: Number(priority), firm: false }));

const SECTION_CODE_RE = /\b(19[2-9][A-Z]{0,2}|20[0-9][A-Z]{0,2})\b/;
/** Raw section text → canonical code, fed THROUGH the shared canonicalSection so the
 * code/keyword/separator-tolerance logic is IDENTICAL across all three stages (Stage 1's
 * own SECTION_CODE_RE fork is gone). The ONE Stage-1-specific layer preserved on top is
 * the configurable `tds_section_aliases` table — real, firm-editable domain knowledge:
 *
 *   1. An EXPLICIT statutory code in the text (194C, 194 Q, Section 194Q) is
 *      authoritative — take the shared canonicaliser's answer verbatim.
 *   2. Otherwise consult the firm/global alias table (whole-word match, pre-sorted
 *      specific-first) and canonicalise THAT code through the shared engine.
 *   3. Otherwise fall back to the shared engine's own keyword table, else the literal.
 *
 * This is "resolve aliases first, then canonicalise" — never a second, divergent
 * implementation of the code extraction. */
function resolveSection(raw: unknown, aliases: Alias[]): string | null {
  if (raw == null || String(raw).trim() === "") return null;
  const s = String(raw);
  const shared = canonicalSection(s);   // shared: explicit code OR built-in keyword
  const hasExplicitCode = SECTION_CODE_RE.test(s.toUpperCase())
    || SECTION_CODE_RE.test(s.toUpperCase().replace(/\s+/g, ""));
  if (hasExplicitCode && shared) return shared;
  // WHOLE-WORD alias match (not raw substring) so "current account interest" does not
  // match the "rent" alias inside "cur[rent]" and wrongly resolve to 194I.
  const norm = ` ${s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim()} `;
  for (const a of aliases) if (norm.includes(` ${a.pattern} `)) return canonicalSection(a.code) ?? a.code;
  return shared ?? s.toUpperCase().replace(/\s+/g, " ").trim();
}
function sectionsMatch(a: unknown, b: unknown, aliases: Alias[]): boolean {
  const ca = resolveSection(a, aliases), cb = resolveSection(b, aliases);
  if (ca === null && cb === null) return true;
  if (ca === null || cb === null) return false;
  return ca === cb;
}

// ── Business rule: the TDS RATE derives the section ──────────────────────────
// The applicable TDS rate is a hard signal for the nature of payment — e.g.
// 0.1% is UNIQUELY section 194Q (purchase of goods); a "Contract"/194C or
// "Professional Fees"/194J payment can never be deducted at 0.1%. So when the
// effective rate (TDS ÷ Amount) of a paired transaction is a valid rate for the
// OFFICE section code, the rate CONFIRMS the office section — the client's
// differing text label (e.g. "TDS - Contract") is just a mislabel, not a real
// discrepancy. Standard statutory rates per section (percent):
const SECTION_RATES: Record<string, number[]> = {
  "192A": [10], "194": [10], "194A": [10], "194B": [30], "194BA": [30], "194BB": [30],
  "194C": [1, 2], "194D": [5, 10], "194DA": [5], "194EE": [10], "194G": [5],
  "194H": [2, 5], "194I": [2, 10], "194IA": [1], "194IB": [5, 2], "194IC": [10],
  "194J": [2, 10], "194K": [10], "194LA": [10], "194LBA": [10], "194M": [5],
  "194N": [2, 5], "194O": [1], "194Q": [0.1], "194R": [10], "194S": [1], "194T": [10],
  "206C": [0.1, 1, 2.5, 5], "206CA": [1],
};
/** Does the effective rate (percent) match a statutory rate for `section`? */
function rateConfirmsSection(effRatePct: number | null, section: string | null): boolean {
  if (effRatePct == null || !section) return false;
  const rates = SECTION_RATES[section.toUpperCase()];
  if (!rates || rates.length === 0) return false; // slab-rate sections (192/195) — no derivation
  return rates.some(x => Math.abs(effRatePct - x) <= Math.max(0.02, x * 0.06));
}

// ── Records ──────────────────────────────────────────────────────────────────
interface Rec {
  id: string;
  name: unknown; pan: unknown; section: unknown;
  amount: unknown; tds: unknown; interest: unknown; date: unknown;
  panN: string; nameN: string; iso: string | null; amountN: number | null;
}
const toRec = (id: string, r: { name: unknown; pan: unknown; section: unknown; amount: unknown; tds: unknown; interest: unknown; date: unknown }): Rec => ({
  id, ...r, panN: normalizePan(r.pan == null ? null : String(r.pan)), nameN: normalizeName(r.name == null ? null : String(r.name)), iso: primaryIso(r.date), amountN: normAmount(r.amount),
});

/** Date match for a paired record: use the column-order-normalised ISO on both
 * sides when available (exact, unambiguous); fall back to the permissive
 * multi-format matcher only when a side's date couldn't be normalised. */
function recDatesMatch(o: Rec, i: Rec): boolean {
  if (o.iso && i.iso) return o.iso === i.iso;
  return datesMatch(o.date, i.date);
}

// The GREEDY, score-ranked pairScore that used to live here is GONE. A score is a
// threshold in disguise, and a threshold is precisely the thing the exclusivity rewrite
// replaced (tightening → false mismatches, loosening → wrong-PAN filings). Pairing is now
// the SHARED assign() engine: PAN equality is its strongest tier, a PAN difference blocks
// a pairing outright, and a fuzzy name pairs only when it is uniquely best for BOTH sides.
// See the pairing section in serve() below.

function fieldDiff(field: FieldKey, office: unknown, imported: unknown, matched: boolean, reason: string): FieldDiff {
  return { field, office, imported, matched, difference: matched ? "" : reason };
}
const show = (v: unknown): string => (v === null || v === undefined || v === "") ? "—" : String(v);

/** Full 7-field comparison for a paired office/imported record. */
function comparePair(o: Rec, i: Rec, aliases: Alias[]): { fields: FieldDiff[]; status: string; mismatchFields: string[]; reason: string } {
  const fields: FieldDiff[] = [];

  const panOk = o.panN !== "" && o.panN === i.panN;
  const nameOk = namesEquivalent(o.name, i.name, panOk);
  fields.push(fieldDiff("name", o.name, i.name, nameOk, `Different name: "${show(o.name)}" vs "${show(i.name)}"`));
  fields.push(fieldDiff("pan", o.pan, i.pan, panOk, `PAN differs: ${o.panN || "—"} vs ${i.panN || "—"}`));

  const dateOk = recDatesMatch(o, i);
  fields.push(fieldDiff("date", o.date, i.date, dateOk, `Different date: ${show(o.date)} vs ${show(i.date)}`));

  for (const f of ["amount", "tds", "interest"] as const) {
    const ov = (o as any)[f], iv = (i as any)[f];
    // Amount & TDS are core (a 0 there is meaningful). INTEREST is a soft field:
    // interest-on-late-deposit is tracked at the CHALLAN level, so the office's
    // per-deductee interest is almost always 0/blank while a client working file
    // may carry it on individual bills — a difference there is NOT a real
    // discrepancy when one side simply doesn't record it. So interest matches
    // when the values agree (±₹1) OR either side is blank/zero.
    const ok = f === "interest"
      ? (amountsMatch(ov, iv) || isBlankOrZero(ov) || isBlankOrZero(iv))
      : amountsMatch(ov, iv);
    const diff = Math.abs(amt(ov) - amt(iv));
    fields.push(fieldDiff(f, ov, iv, ok, `${f === "tds" ? "TDS" : f[0].toUpperCase() + f.slice(1)} differs by ₹${diff.toLocaleString("en-IN")}: ${amt(ov).toLocaleString("en-IN")} vs ${amt(iv).toLocaleString("en-IN")}`));
  }

  let secOk = sectionsMatch(o.section, i.section, aliases);
  const cs = resolveSection(o.section, aliases), ci = resolveSection(i.section, aliases);
  // Multi-factor section determination (office code is AUTHORITATIVE, and this
  // pair already matches on PAN+date+amount):
  // 1) RATE derives the section — if the effective rate (TDS ÷ Amount) is a
  //    statutory rate for the office section, the rate CONFIRMS it and a
  //    differing client text label (e.g. "TDS - Contract" at 0.1% ⇒ actually
  //    194Q) is a mislabel, not a real mismatch.
  // 2) Otherwise, an opaque client notation resolving to NO recognised section
  //    (e.g. "393(1) 6(i) D(b)") defers to the authoritative office code.
  // A client value that resolves to a DIFFERENT recognised section AND whose
  // rate does not fit the office section stays a mismatch (AI double-checks it).
  if (!secOk) {
    const effRate = amt(o.amount) > 0 ? (amt(o.tds) / amt(o.amount)) * 100 : null;
    if (rateConfirmsSection(effRate, cs)) secOk = true;
  }
  const importedRecognised = ci != null && SECTION_CODE_RE.test(ci);
  if (!secOk && !importedRecognised) secOk = true;
  fields.push(fieldDiff("section", o.section, i.section, secOk,
    `Different section: ${show(o.section)}${cs && String(o.section).toUpperCase() !== cs ? ` (${cs})` : ""} vs ${show(i.section)}${ci && String(i.section).toUpperCase() !== ci ? ` (${ci})` : ""}`));

  // Binary outcome (no intermediate "review" state): any of the 7 fields
  // differing => mismatched, and the exact differing field(s) are named in the
  // reason and shown field-by-field in field_diffs.
  const mismatchFields = fields.filter(f => !f.matched).map(f => f.field);
  const labels = mismatchFields.map(f => f === "tds" ? "TDS" : f[0].toUpperCase() + f.slice(1)).join(", ");
  const status = mismatchFields.length === 0 ? "matched" : "mismatched";
  const reason = mismatchFields.length === 0
    ? "All 7 fields match."
    : `${labels} ${mismatchFields.length > 1 ? "differ" : "differs"}.`;
  return { fields, status, mismatchFields, reason };
}

function oneSided(r: Rec, side: "office" | "imported"): FieldDiff[] {
  const vals: Record<FieldKey, unknown> = { name: r.name, pan: r.pan, date: r.date, amount: r.amount, tds: r.tds, interest: r.interest, section: r.section };
  return FIELD_ORDER.map(field => ({
    field,
    office: side === "office" ? vals[field] : null,
    imported: side === "imported" ? vals[field] : null,
    matched: false,
    difference: side === "office" ? "Present in Office Data but not found in the imported client file." : "Present in the imported client file but not in Office Data.",
  }));
}

// ── Pairing: the SHARED EXCLUSIVITY ENGINE (assign) — the same code Stage 3 runs ─
// No score, no threshold. assign() pairs in tiers of decreasing evidence and commits
// only a pairing that is uniquely best for BOTH sides, consuming both endpoints so a
// weaker tier sees a smaller board. What Stage 1 adds — because here BOTH sides carry a
// PAN — is proof-grade identity: PAN equality is assign()'s STRONGEST tier (APAN), and a
// PAN DIFFERENCE blocks a pairing outright (both encoded IN the shared engine, so Stage 3
// gets them too — its ledger just has no PAN, so they never fire). A committed pairing is
// only the COUNTERPART; comparePair still decides matched/mismatched (exclusivity buys the
// counterpart, corroboration buys the verdict). credit = the imported AMOUNT; assign votes
// per section whether a credit corroborates the office amount or TDS, and the office side
// carries both explicitly. Factored out of serve() so the Node test can EXECUTE the real
// pairing (PAN tier, PAN-diff block, exclusivity) without standing up Supabase.
function pairRecords(oRecs: Rec[], iRecs: Rec[], aliases: Alias[]): {
  pairs: { o: Rec; i: Rec }[]; oUsed: boolean[]; iUsed: boolean[];
} {
  const asgOffice: AsgOffice[] = oRecs.map((o) => ({
    id: o.id, name: o.name == null ? null : String(o.name), dateIso: o.iso,
    amount: o.amountN, tds: normAmount(o.tds), section: resolveSection(o.section, aliases),
    pan: o.panN || null, assignable: true,
  }));
  const asgLedger: AsgLedger[] = iRecs.map((i, ii) => ({
    pos: ii, party: i.name == null ? null : String(i.name), iso: i.iso,
    credit: i.amountN, section: resolveSection(i.section, aliases), pan: i.panN || null,
  }));
  const { outcomes } = assign(asgOffice, asgLedger);
  const oUsed = new Array(oRecs.length).fill(false);
  const iUsed = new Array(iRecs.length).fill(false);
  const pairs: { o: Rec; i: Rec }[] = [];
  // outcome.ti is the ledger array index, which we built === the iRecs index (=== pos).
  // A committed counterpart (ti != null) is a pair; everything assign left uncommitted —
  // whether unmatched or escalated (ambiguous / pan-split / better-claimant) — stays
  // one-sided, which in Stage-1 terms is office_only / imported_only. This is the cost
  // asymmetry in action: never pair against an unproven counterpart.
  for (const oc of outcomes) {
    if (oc.ti == null) continue;
    oUsed[oc.oi] = true; iUsed[oc.ti] = true;
    pairs.push({ o: oRecs[oc.oi], i: iRecs[oc.ti] });
  }
  return { pairs, oUsed, iUsed };
}

// ── AI section adjudication (the ONE genuinely fuzzy field) ──────────────────
// PAN / date / amount / tds / interest / name are compared deterministically.
// Section is the only field where a client file legitimately uses a different
// NOTATION for the same nature of payment — a code (194C), a description
// ("TDS - Contract"), or an opaque internal/legal-clause citation
// ("393(1) 6(i) D(b)") that no string rule can equate. For pairs whose section
// didn't match deterministically, the model judges equivalence — with the office
// code treated as authoritative and the record already confirmed (by PAN+date+
// amount) to be the SAME transaction. Graceful: a provider failure leaves the
// deterministic result untouched.
async function callAI(system: string, userText: string, maxTokens: number): Promise<string | null> {
  if ((Deno.env.get("CAFLOW_AI_BACKEND") ?? "claude-cli") !== "legacy-api") {
    const reply = await callClaudeCliText(system, userText, 120_000, "sonnet");
    if (isProviderError(reply)) {
      console.error("section Claude CLI failed", reply.status, reply.error);
      return null;
    }
    return reply.text;
  }
  const openAICompat = async (url: string, key: string, model: string, extra: Record<string, string>) => {
    try {
      const res = await fetch(url, {
        method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...extra },
        body: JSON.stringify({ model, temperature: 0, max_tokens: maxTokens, messages: [{ role: "system", content: system }, { role: "user", content: userText }] }),
      });
      if (!res.ok) { console.error("section AI provider failed", res.status, (await res.text()).slice(0, 150)); return null; }
      const j = await res.json(); return j?.choices?.[0]?.message?.content ?? null;
    } catch (e) { console.error("section AI provider error", String(e).slice(0, 120)); return null; }
  };
  const anthropic = async (key: string) => {
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST", headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({ model: Deno.env.get("ANTHROPIC_MODEL") || "claude-sonnet-4-20250514", max_tokens: maxTokens, system, messages: [{ role: "user", content: [{ type: "text", text: userText }] }] }),
      });
      if (!res.ok) { console.error("section AI anthropic failed", res.status); return null; }
      const j = await res.json(); return Array.isArray(j?.content) ? j.content.filter((b: any) => b?.type === "text").map((b: any) => b.text).join("") : null;
    } catch (e) { console.error("section AI anthropic error", String(e).slice(0, 120)); return null; }
  };
  const OR = Deno.env.get("OPENROUTER_API_KEY"), LV = Deno.env.get("LOVABLE_API_KEY"), AN = Deno.env.get("ANTHROPIC_API_KEY");
  if (OR) { const r = await openAICompat("https://openrouter.ai/api/v1/chat/completions", OR, Deno.env.get("OPENROUTER_MODEL") || OPENROUTER_DEFAULT_MODEL, { "HTTP-Referer": "https://caflow.app", "X-Title": "CAFlow TDS Recon" }); if (r) return r; }
  if (LV) { const r = await openAICompat("https://ai.gateway.lovable.dev/v1/chat/completions", LV, Deno.env.get("LOVABLE_MODEL") || "google/gemini-2.5-flash", {}); if (r) return r; }
  if (AN) { const r = await anthropic(AN); if (r) return r; }
  return null;
}
function extractJson(text: string): any {
  if (!text) return null;
  let s = text.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i); if (fence) s = fence[1].trim();
  try { return JSON.parse(s); } catch { /* fall through */ }
  const a = s.indexOf("{"), b = s.lastIndexOf("}"); if (a >= 0 && b > a) { try { return JSON.parse(s.slice(a, b + 1)); } catch { /* ignore */ } }
  return null;
}
const SECTION_ADJ_SYSTEM = `You reconcile Indian TDS "section / nature of payment" values between a firm's OFFICE record and a client's imported file.
Each item has the OFFICE value (the firm's authoritative TDS section code, e.g. 194C, 194Q, 194J, 194I, 194H, 192, 194A) and the CLIENT value from the client's file. The two are ALREADY confirmed to be the SAME transaction (PAN, date and amount match).
The CLIENT value may be: a section code; a plain-language nature ("TDS - Contract"/"Contractor"=194C, "TDS - Purchase"/"Purchase of goods"=194Q, "Professional/Technical Fees"=194J, "Rent"=194I, "Commission/Brokerage"=194H, "Salary"=192, "Interest"=194A); OR an opaque internal or legal-clause citation you may not be able to decode (e.g. "393(1) 6(i) D(b)", "393(1) 8(ii)").
Decide for each whether the CLIENT value denotes the SAME nature of payment as the OFFICE code.
Rules:
- Map any plain-language nature to its code, then compare to the office code.
- If the CLIENT value is an OPAQUE citation you cannot confidently decode, answer same=true — the office code is authoritative and the transaction already matches, so a code you cannot read is NOT evidence of a real discrepancy.
- Answer same=false ONLY when the client value CLEARLY and CONFIDENTLY names a DIFFERENT standard nature of payment than the office code (e.g. office 194C "Contract" but client clearly says "Professional Fees"/194J).
Return STRICT JSON only: {"results":[{"ref":"<ref>","same":true|false,"reason":"<short>"}]} — one object per item, no prose, no fences.`;

async function adjudicateSections(items: { ref: string; office: string; imported: string }[]): Promise<Map<string, { same: boolean; reason: string }>> {
  const out = new Map<string, { same: boolean; reason: string }>();
  if (items.length === 0) return out;
  const content = await callAI(SECTION_ADJ_SYSTEM, `Items:\n${JSON.stringify(items)}`, 4000);
  if (!content) return out; // provider down → caller keeps the deterministic result
  const parsed = extractJson(content);
  const arr = Array.isArray(parsed?.results) ? parsed.results : [];
  for (const r of arr) if (r?.ref != null) out.set(String(r.ref), { same: r.same === true, reason: r.reason ? String(r.reason) : "" });
  return out;
}

serve(async (req) => {
  const corsHeaders = corsFor(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "").trim();
    if (!token) return json({ error: "Unauthorized" }, 401);

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) return json({ error: "Unauthorized" }, 401);

    const { filing_id, batch_id: batchIdIn } = (await req.json()) ?? {};
    if (!filing_id) return json({ error: "filing_id is required" }, 400);

    const { data: filing, error: fErr } = await supabase
      .from("tds_filings").select("id, firm_id, quarter, financial_year, tds_forms").eq("id", filing_id).single();
    if (fErr || !filing) return json({ error: "Filing not found" }, 404);

    // AUTHORIZE — the service-role client bypasses RLS, so verify the caller
    // belongs to this filing's firm (or is a superadmin). Without this, any
    // authenticated user could reconcile / read / overwrite another firm's data.
    const { data: caller } = await supabase.from("users").select("firm_id, role").eq("id", user.id).single();
    if (!caller || (caller.firm_id !== filing.firm_id && caller.role !== "superadmin")) {
      return json({ error: "You are not authorised for this filing." }, 403);
    }

    // Latest batch unless a specific one is requested.
    let batchId = batchIdIn;
    if (!batchId) {
      const { data: b } = await supabase
        .from("tds_import_batches").select("id")
        .eq("filing_id", filing_id).order("imported_at", { ascending: false }).limit(1).maybeSingle();
      batchId = b?.id;
    }
    if (!batchId) return json({ error: "No imported client data found. Import a client file first." }, 409);

    // A caller-supplied batch_id must belong to THIS filing — otherwise one could
    // reconcile a filing against another (even same-firm) filing's imported rows.
    const { data: batchRow } = await supabase
      .from("tds_import_batches").select("id, filing_id, form_type").eq("id", batchId).maybeSingle();
    if (!batchRow || batchRow.filing_id !== filing_id) {
      return json({ error: "That import batch does not belong to this filing." }, 400);
    }

    // ── Office Data: deductees for this filing ───────────────────────────────
    // Scoped by the deductee's OWN filing_id, not by "attached to one of this
    // filing's challans" — a single challan payment is routinely reused across
    // a client's 24Q AND 26Q filings for the same TAN/quarter (one combined
    // bank deposit, allocated across both returns' deductees), so a deductee's
    // challan_id can legitimately point at a challan owned by a DIFFERENT
    // filing/form. Scoping by challan_id alone pulled that other filing's
    // entire deductee set into "Office Data" here — confirmed against a real
    // filing where a 24Q return's Office Data showed all 91 of its client's
    // 26Q deductees mixed in with its own 9, because both forms' challans
    // happened to be the same three challan rows.
    const { data: ded } = await supabase
      .from("tds_deductees")
      .select("id, deductee_name, deductee_pan, section_code, amount_paid_credited, total_tax_deducted, tds_amount, interest_amount, date_of_payment, challan_id")
      .eq("filing_id", filing_id);
    const office = ded ?? [];

    // ── Imported Data: ALL rows across EVERY batch for this filing ──────────────
    // Clients often keep TDS in SEPARATE files (e.g. 194Q in its own workbook,
    // or one file per section / month / branch). Each import is its own batch;
    // the reconciliation must run against the COMBINED dataset so a record that
    // lives in another file is not falsely reported as missing. (Re-importing the
    // SAME file replaces its batch on the import side, so this never double-counts
    // the same file.)
    const { data: imported } = await supabase
      .from("tds_imported_rows").select("*").eq("filing_id", filing_id).order("row_index", { ascending: true });

    if ((office?.length ?? 0) === 0 && (imported?.length ?? 0) === 0) {
      return json({ error: "Nothing to compare — both office and imported data are empty." }, 409);
    }

    // ── Section aliases: configurable table (global + this firm), sorted
    //    specific-first; firm rows win over global at the same priority. ────────
    let aliases = DEFAULT_SECTION_ALIASES;
    try {
      const { data: dbAliases } = await supabase
        .from("tds_section_aliases").select("pattern, section_code, priority, firm_id")
        .or(`firm_id.is.null,firm_id.eq.${filing.firm_id}`);
      if (dbAliases && dbAliases.length) {
        aliases = dbAliases.map((a: any) => ({
          pattern: String(a.pattern ?? "").toLowerCase().trim(),
          code: String(a.section_code ?? "").toUpperCase().trim(),
          priority: Number.isFinite(a.priority) ? Number(a.priority) : 100,
          firm: a.firm_id != null,
        })).filter((a: Alias) => a.pattern && a.code);
      }
    } catch (_e) { /* table missing / read blocked → hard-coded defaults */ }
    aliases = aliases.slice().sort((a, b) => (a.priority - b.priority) || ((b.firm ? 1 : 0) - (a.firm ? 1 : 0)));

    // ── Build records + normalise dates by DETECTED column order ────────────────
    // Detect each side's date convention from its whole column (office is ISO;
    // imported is whatever the client's file used — American M/D, Indian D/M, …)
    // and set each record's canonical ISO with that fixed order. This is what
    // makes date matching correct regardless of the client's format.
    const officeIso = makeIsoNormaliser(office.map((d: any) => d.date_of_payment));
    const importedIso = makeIsoNormaliser((imported ?? []).map((r: any) => r.date_of_payment));
    const oRecs = office.map((d: any) => toRec(d.id, {
      name: d.deductee_name ?? null, pan: d.deductee_pan ?? null, section: d.section_code ?? null,
      // Compare BASE TDS on both sides. `tds_amount` is the actual TDS deducted;
      // `total_tax_deducted` is base+surcharge+cess (aggregate) which the client
      // file's TDS column doesn't include — AND is often stored as a literal 0
      // when staff only fill tds_amount, which under the old `total ?? tds_amount`
      // made office TDS read 0 for every record → mass false "TDS differs".
      // Prefer a NON-ZERO tds_amount; fall back to total only when tds_amount is
      // absent or zero.
      amount: d.amount_paid_credited ?? null,
      tds: (normAmount(d.tds_amount) ?? 0) !== 0 ? d.tds_amount : (d.total_tax_deducted ?? d.tds_amount ?? null),
      interest: d.interest_amount ?? null, date: d.date_of_payment ?? null,
    }));
    oRecs.forEach((r) => { r.iso = officeIso(r.date) ?? r.iso; });
    const iRecsAll = (imported ?? []).map((r: any) => toRec(r.id, {
      name: r.deductee_name ?? null, pan: r.pan ?? null, section: r.section_code ?? null,
      amount: r.amount_paid ?? null, tds: r.tds_amount ?? null, interest: r.interest ?? null,
      date: r.date_of_payment ?? null,
    }));
    iRecsAll.forEach((r) => { r.iso = importedIso(r.date) ?? r.iso; });

    // ── Intelligent quarter detection ───────────────────────────────────────────
    // A client working file often holds the WHOLE financial year (one sheet per
    // month). The Office Data is a single quarter. So compare ONLY the imported
    // rows whose date falls in THIS filing's quarter; rows clearly belonging to a
    // DIFFERENT quarter of the same FY are excluded (they reconcile against their
    // own quarter's filing — never counted here as "imported_only"). Rows whose
    // date is unparseable or outside this FY are kept so nothing is silently lost.
    const fyStart = fyStartYear(filing.financial_year);
    const filingQ = normQuarter(filing.quarter);
    // ALLOWED FORMS = every form on the filing (NOT just [0] — a multi-form filing
    // like 26Q+27Q must not exclude the second form's rows). The batch form_type is
    // trusted ONLY when it is one of the filing's forms — the importer defaults it
    // to "26Q", which must never override, say, a 27Q filing.
    const allowedForms = new Set<string>();
    const rawForms = Array.isArray((filing as any).tds_forms) ? (filing as any).tds_forms : [(filing as any).tds_forms];
    for (const f of rawForms) { const nf = normForm(f); if (nf) allowedForms.add(nf); }
    const batchForm = normForm(batchRow.form_type);
    if (batchForm && allowedForms.has(batchForm)) { allowedForms.clear(); allowedForms.add(batchForm); }
    // Representative form for display in the summary/toast (the batch's, else the first allowed).
    const filingForm = batchForm && allowedForms.has(batchForm) ? batchForm : ([...allowedForms][0] ?? null);
    // A client row whose PAN is in the Office Data clearly belongs to THIS filing,
    // so it must NEVER be excluded by the form/quarter filters below on the
    // strength of a client-side section label or a possibly-misclassified date
    // (see filterImportedRows's own doc comment).
    const officePanSet = new Set(oRecs.map((r) => r.panN).filter(Boolean));
    const { iRecs, excludedOtherForm, excludedOtherQuarter } =
      filterImportedRows(iRecsAll, officePanSet, allowedForms, filingQ, fyStart, aliases);

    // ── Pairing: the SHARED EXCLUSIVITY ENGINE (see pairRecords above) ──────────
    const { pairs, oUsed, iUsed } = pairRecords(oRecs, iRecs, aliases);

    // ── Preserve prior overrides (keyed by office+imported pairing) ─────────────
    const { data: prior } = await supabase
      .from("tds_recon_results")
      .select("id, office_deductee_id, imported_row_id, overridden, overridden_by, overridden_at, override_note")
      .eq("filing_id", filing_id);
    const priorMap = new Map<string, any>();
    for (const p of prior ?? []) priorMap.set(`${p.office_deductee_id ?? ""}|${p.imported_row_id ?? ""}`, p);
    const priorIds = (prior ?? []).map((p: any) => p.id);

    const rowFor = (officeId: string | null, importedId: string | null, label: unknown, status: string, fields: FieldDiff[]) => {
      const carry = priorMap.get(`${officeId ?? ""}|${importedId ?? ""}`);
      const keep = !!carry?.overridden;
      return {
        filing_id, batch_id: batchId, firm_id: filing.firm_id,
        office_deductee_id: officeId, imported_row_id: importedId,
        record_label: label ? String(label).slice(0, 200) : null,
        match_status: status,
        mismatch_fields: fields.filter(f => !f.matched).map(f => f.field),
        field_diffs: fields,
        overridden: keep, overridden_by: keep ? carry.overridden_by : null,
        overridden_at: keep ? carry.overridden_at : null, override_note: keep ? carry.override_note : null,
      };
    };

    // Deterministic comparison for every pair first.
    const paired = pairs.map(({ o, i }) => ({ o, i, ...comparePair(o, i, aliases) }));

    // Then let the model adjudicate ONLY the section-field differences — the one
    // field where a client file legitimately uses different notation (code vs
    // description vs opaque citation) for the same nature of payment. Everything
    // else stays deterministic. Office code is authoritative; a paired record is
    // already the same transaction, so a section notation the model deems
    // equivalent is not a real mismatch. A section that stays mismatched here is
    // a genuine, confident different-nature call (the user can still override).
    const secItems: { ref: string; office: string; imported: string }[] = [];
    paired.forEach((p, idx) => {
      const sf = p.fields.find(f => f.field === "section");
      if (sf && !sf.matched) secItems.push({ ref: String(idx), office: String(sf.office ?? ""), imported: String(sf.imported ?? "") });
    });
    if (secItems.length) {
      const verdicts = await adjudicateSections(secItems);
      paired.forEach((p, idx) => {
        const v = verdicts.get(String(idx));
        if (!v || !v.same) return;
        const sf = p.fields.find(f => f.field === "section");
        if (sf && !sf.matched) {
          sf.matched = true;
          sf.difference = "";
          const mism = p.fields.filter(f => !f.matched).map(f => f.field);
          p.status = mism.length === 0 ? "matched" : "mismatched";
          p.mismatchFields = mism;
        }
      });
    }

    // ── Aggregation reconciliation (N:1 / 1:N by PAN) ───────────────────────────
    // Office TDS data often records ONE challan/deductee line per party = the SUM
    // of several client invoices (or the client splits one office line into many).
    // The strict 1:1 pairing then leaves a false amount-mismatch + phantom
    // one-sided rows for a party that actually reconciles IN AGGREGATE. So group
    // every in-comparison record by PAN: if the party's TOTAL amount AND total TDS
    // reconcile across all its office and imported rows AND the section is
    // consistent, the per-bill split is not a real discrepancy. Conservative:
    // tight tolerances + a TDS check + one canonical section, so genuinely
    // different transactions are not hidden.
    interface Agg { oAmt: number; iAmt: number; oTds: number; iTds: number; oCount: number; iCount: number; secs: Set<string>; }
    const byPan = new Map<string, Agg>();
    const bumpAgg = (pan: string, side: "o" | "i", a: number, t: number, sec: unknown) => {
      if (!pan) return;
      let g = byPan.get(pan);
      if (!g) { g = { oAmt: 0, iAmt: 0, oTds: 0, iTds: 0, oCount: 0, iCount: 0, secs: new Set() }; byPan.set(pan, g); }
      if (side === "o") { g.oAmt += a; g.oTds += t; g.oCount++; } else { g.iAmt += a; g.iTds += t; g.iCount++; }
      const cs = resolveSection(sec, aliases); if (cs && SECTION_CODE_RE.test(cs)) g.secs.add(cs);
    };
    for (const o of oRecs) bumpAgg(o.panN, "o", amt(o.amount), amt(o.tds), o.section);
    for (const i of iRecs) bumpAgg(i.panN, "i", amt(i.amount), amt(i.tds), i.section);
    const aggregatedPans = new Set<string>();
    for (const [pan, g] of byPan) {
      if (g.oCount === 0 || g.iCount === 0) continue;                 // one side absent → genuinely missing, not aggregation
      const amtOk = Math.abs(g.oAmt - g.iAmt) <= Math.max(1, Math.abs(g.oAmt) * 0.005);
      const tdsOk = Math.abs(g.oTds - g.iTds) <= Math.max(1, Math.abs(g.oTds) * 0.02);
      const secOk = g.secs.size <= 1;                                 // one nature of payment across the party
      if (amtOk && tdsOk && secOk) aggregatedPans.add(pan);
    }
    // A paired record is safe to upgrade to matched under aggregation only when
    // its ONLY differences are the amount/tds/date (which legitimately vary when
    // bills are split/aggregated) — never name/pan/section/interest.
    const AGG_OK_FIELDS = new Set(["amount", "tds", "date"]);

    const newRows: any[] = [];
    let aggregatedCount = 0;
    for (const p of paired) {
      let status = p.status, fields = p.fields;
      if (status === "mismatched" && aggregatedPans.has(p.o.panN) && p.mismatchFields.every(f => AGG_OK_FIELDS.has(f))) {
        status = "matched"; aggregatedCount++;
      }
      newRows.push(rowFor(p.o.id, p.i.id, p.o.name ?? p.i.name, status, fields));
    }
    for (let oi = 0; oi < oRecs.length; oi++) if (!oUsed[oi]) {
      const o = oRecs[oi];
      // A one-sided office row whose PAN reconciles in aggregate is a split bill,
      // not a missing record → matched (aggregated).
      const agg = aggregatedPans.has(o.panN);
      if (agg) aggregatedCount++;
      newRows.push(rowFor(o.id, null, o.name, agg ? "matched" : "office_only", oneSided(o, "office")));
    }
    for (let ii = 0; ii < iRecs.length; ii++) if (!iUsed[ii]) {
      const i = iRecs[ii];
      const agg = aggregatedPans.has(i.panN);
      if (agg) aggregatedCount++;
      newRows.push(rowFor(null, i.id, i.name, agg ? "matched" : "imported_only", oneSided(i, "imported")));
    }

    // Replace results safely: INSERT new rows first, then delete superseded ids.
    const { error: insErr } = await supabase.from("tds_recon_results").insert(newRows);
    if (insErr) return json({ error: `Result insert failed: ${insErr.message}` }, 500);
    if (priorIds.length) {
      const { error: delErr } = await supabase.from("tds_recon_results").delete().in("id", priorIds);
      if (delErr) console.error("tds-recon-compare: stale result cleanup failed (recoverable):", delErr.message);
    }

    // ── Diagnostics: explain WHY records didn't match (generic, informational) ──
    // Rather than only reporting a mismatch count, analyse the data to surface the
    // most likely ROOT CAUSE of low matching — period/quarter mismatch, missing
    // identifier columns, systematic date differences — so the user can act.
    const diagnostics: string[] = [];
    const matchedN = newRows.filter(r => r.match_status === "matched").length;
    // (a) Office Data period vs the filing's declared quarter.
    {
      const dist: Record<string, number> = {};
      let parseable = 0;
      for (const o of oRecs) { const q = quarterOfIso(o.iso, fyStart); if (q) { dist[q] = (dist[q] || 0) + 1; parseable++; } }
      if (parseable >= 3 && filingQ) {
        const top = Object.entries(dist).sort((a, b) => b[1] - a[1])[0];
        if (top && top[0] !== filingQ && top[1] / parseable >= 0.6) {
          diagnostics.push(`Office Data is dated mostly in ${top[0]} of FY ${filing.financial_year}, but this filing is ${filingQ}. Verify the filing's quarter or the Office Data period — ${filingQ} imported rows cannot match ${top[0]} office rows.`);
        }
      }
    }
    // (b) Systematic date-only mismatch across paired records.
    {
      const mm = newRows.filter(r => r.match_status === "mismatched");
      const dateOnly = mm.filter(r => (r.mismatch_fields?.length ?? 0) > 0 && r.mismatch_fields.every((f: string) => f === "date"));
      if (mm.length >= 3 && dateOnly.length / mm.length >= 0.6) {
        diagnostics.push(`${dateOnly.length} of ${mm.length} mismatches agree on PAN/amount/TDS and differ ONLY on the date — Office and imported data likely cover different periods, or the date was recorded differently on one side.`);
      }
    }
    // (c) Imported file has no usable PAN column.
    {
      const withPan = iRecs.filter(r => r.panN !== "").length;
      if (iRecs.length >= 5 && withPan / iRecs.length < 0.2) {
        diagnostics.push(`The imported file has almost no PAN values (${withPan}/${iRecs.length}) — matching relied on name + amount + date. Including PAN in the client file improves accuracy.`);
      }
    }
    // (d) Imported file's name column wasn't recognised.
    {
      const withName = iRecs.filter(r => r.nameN !== "").length;
      if (iRecs.length >= 5 && withName / iRecs.length < 0.3) {
        diagnostics.push(`The imported file's party-name column wasn't recognised (${withName}/${iRecs.length} rows have a name) — check the file's column headers.`);
      }
    }
    // (e) Everything was excluded by the quarter/form filter.
    if ((imported?.length ?? 0) > 0 && iRecs.length === 0) {
      diagnostics.push(`All ${imported?.length} imported rows fall outside ${filingQ ?? "this quarter"} ${filing.financial_year} (or belong to a different form) and were set aside — check you imported the correct quarter's file.`);
    }
    // (f) Office and imported overlap on PAN but rarely reconcile.
    if (matchedN === 0 && oRecs.length > 0 && iRecs.length > 0) {
      const oPans = new Set(oRecs.map(r => r.panN).filter(Boolean));
      const shared = iRecs.filter(r => r.panN && oPans.has(r.panN)).length;
      if (shared > 0) diagnostics.push(`Office and imported data share ${shared} PAN(s) but none reconciled cleanly — the amounts, TDS or dates differ. They may be different periods, or one side's figures need correcting.`);
      else if (oRecs.length > 0 && iRecs.length > 0) diagnostics.push(`Office and imported data share no PANs in this quarter — likely different parties, a wrong file, or a wrong quarter.`);
    }

    const summary = {
      total: newRows.length,
      matched: newRows.filter(r => r.match_status === "matched").length,
      mismatched: newRows.filter(r => r.match_status === "mismatched").length,
      office_only: newRows.filter(r => r.match_status === "office_only").length,
      imported_only: newRows.filter(r => r.match_status === "imported_only").length,
      overridden: newRows.filter(r => r.overridden).length,
      pending: newRows.filter(r => r.match_status !== "matched" && !r.overridden).length,
      // Imported rows that belong to OTHER quarters of the FY (excluded from this
      // quarter's reconciliation — they reconcile under their own quarter's filing).
      excluded_other_quarter: excludedOtherQuarter,
      // Client rows for a DIFFERENT form (e.g. 192B salary/24Q in a 26Q file).
      excluded_other_form: excludedOtherForm,
      filing_quarter: filingQ,
      filing_form: filingForm,
      // Records reconciled at the party level (office challan = Σ client bills).
      aggregated: aggregatedCount,
      // Plain-language explanations of the most likely cause(s) of non-matches.
      diagnostics,
    };
    return json({ batch_id: batchId, summary });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("tds-recon-compare fatal:", message);
    return json({ error: message }, 500);
  }
});
