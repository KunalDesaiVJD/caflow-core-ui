/**
 * CENTRALISED normalisation + record-matching primitives — shared by every TDS
 * stage so name/amount/date/section comparison behaves IDENTICALLY everywhere.
 * Fix a matching bug here (e.g. "Jayant Kantilal Jagani" == "Jayant Jagani
 * Kantilal") and Stage-1, Stage-2 and Stage-3 all get it.
 *
 * Name logic is the version proven in Stage-2 (order-independent token sets,
 * initials, compound Indian suffixes, distinctive-token weighting). Amount/date/
 * section logic mirrors the Stage-1 compare engine (rate-aware, dd/mm-vs-mm/dd
 * auto-detection, section-code canonicalisation).
 */

import { looksLikePan } from "./columnEngine";

// ── PAN ──────────────────────────────────────────────────────────────────────
export const normalizePan = (pan: string | null | undefined): string => (pan ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

// ── Entity-name normalisation + intelligent comparison ───────────────────────
export const normalizeName = (v: string | null | undefined): string => {
  let s = (v ?? "").toUpperCase();
  s = s.replace(/&/g, " AND ");
  s = s.replace(/[^A-Z0-9 ]/g, " ");
  s = ` ${s.replace(/\s+/g, " ").trim()} `;
  s = s.replace(/ CO OPERATIVE /g, " COOPERATIVE ").replace(/ CO OP /g, " COOPERATIVE ");
  s = s.replace(/ PVT /g, " PRIVATE ").replace(/ LTD /g, " LIMITED ");
  s = s.replace(/ P LIMITED /g, " PRIVATE LIMITED ").replace(/ CORPN /g, " CORPORATION ").replace(/ CO /g, " COMPANY ");
  s = s.replace(/^ (M S|MESSRS|MESSER?S|THE) /, " ");
  return s.replace(/\s+/g, " ").trim();
};

const NAME_COMPOUND_SUFFIXES = new Set(["KUMAR", "BHAI", "BHAII", "BEN", "BHEN", "KUMARI", "LAL", "DAS", "CHANDRA", "PRASAD", "DEVI", "RAJ", "NATH", "SINH", "BABU", "RAO"]);
const NAME_STOPWORDS = new Set(["PRIVATE", "LIMITED", "COMPANY", "CORPORATION", "LLP", "LLC", "INC", "AND", "THE", "MESSRS", "SHREE", "SHRI", "SRI", "SHREEJI", "ENTERPRISE", "ENTERPRISES", "TRADERS", "INDUSTRIES"]);

/** First letter + the consonants after it, repeats collapsed. Folds the VOWEL noise
 *  that dominates Indian transliteration variants — "KATHARANI"/"KATHRANI" and
 *  "KRISHNA"/"KRISHAN" both reduce to the same skeleton — while keeping genuinely
 *  different names apart: "RAMESH"→RMSH vs "RAJESH"→RJSH. */
function skeleton(w: string): string {
  return (w[0] + w.slice(1).replace(/[AEIOU]/g, "")).replace(/(.)\1+/g, "$1");
}

/** The word's vowels, in order — the signal skeleton() throws away. */
const vowelsOf = (w: string) => w.replace(/[^AEIOU]/g, "");

/** Is every character of `s` present in `l`, in order? */
function isSubsequence(s: string, l: string): boolean {
  let i = 0;
  for (const c of l) if (i < s.length && s[i] === c) i++;
  return i === s.length;
}

/** Levenshtein distance, abandoned once it provably exceeds `max`. */
function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (cur[j] < best) best = cur[j];
    }
    if (best > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

function tokensCompatible(x: string, y: string): boolean {
  if (x === y) return true;
  if (x.length === 1 && y.length >= 2 && y[0] === x) return true;
  if (y.length === 1 && x.length >= 2 && x[0] === y) return true;
  const [s, l] = x.length <= y.length ? [x, y] : [y, x];
  if (s.length >= 3 && l.startsWith(s) && NAME_COMPOUND_SUFFIXES.has(l.slice(s.length))) return true;
  // Spelling variants of the SAME word — deliberately NARROW: vowel ELISION only,
  // in a LONG word. Accepts KATHARANI/KATHRANI, KRISHNA/KRISHAN, MOHAMMED/MOHAMED.
  //
  // It must NEVER accept a vowel SUBSTITUTION. Indian vowels are phonemic and often
  // mark gender or community, so a single substituted vowel routinely separates two
  // real, different deductees who share a surname, a family and an address:
  // PATEL/PATIL, KAMAL/KAMLA, VIMAL/VIMLA, DIPAK/DIPIKA, KIRAN/KARAN, HIRALAL/
  // HARILAL. A false match files the return against the WRONG PAN and says nothing;
  // a miss merely asks the user to map the party once. The 35 adversarial pairs that
  // forced this shape are pinned as negatives in match.test.ts.
  //
  // Hence all three guards, none of which is redundant:
  //   length >= 7   — below this an edit is too large a share of the word, and every
  //                   short pair above collides.
  //   skeleton      — rejects CONSONANT differences (RAMESH/RAJESH → RMSH vs RJSH).
  //   vowel subsequence — rejects vowel SUBSTITUTION and REORDERING, which the
  //                   skeleton cannot see at all (it deletes the vowels). This is
  //                   what separates KATHRANI ⊂ KATHARANI from HIRALAL vs HARILAL.
  if (s.length >= 7 && skeleton(x) === skeleton(y) && editDistance(x, y, 2) <= 2) {
    const [vx, vy] = [vowelsOf(x), vowelsOf(y)];
    const [vShort, vLong] = vx.length <= vy.length ? [vx, vy] : [vy, vx];
    if (isSubsequence(vShort, vLong)) return true;
  }
  return false;
}

/** Order-independent, initial/compound-tolerant name comparison. */
export function nameCompare(a: string | null | undefined, b: string | null | undefined): "match" | "different" | "mismatch" | "unknown" {
  const na = normalizeName(a), nb = normalizeName(b);
  if (!na || !nb) return "unknown";
  if (na === nb) return "match";
  const allA = na.split(" ").filter(Boolean);
  const allB = nb.split(" ").filter(Boolean);
  const hasReal = (ws: string[]) => ws.some((w) => w.length >= 2);
  if (!hasReal(allA) || !hasReal(allB)) return "unknown";
  let ta = allA.filter((w) => !NAME_STOPWORDS.has(w));
  let tb = allB.filter((w) => !NAME_STOPWORDS.has(w));
  if (!hasReal(ta) || !hasReal(tb)) { ta = allA; tb = allB; }
  const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  const used = new Set<number>();
  let hits = 0, fullHits = 0;
  for (const s of short) {
    const idx = long.findIndex((l, i) => !used.has(i) && tokensCompatible(s, l));
    if (idx >= 0) { hits++; used.add(idx); if (s.length >= 2 && long[idx].length >= 2) fullHits++; }
  }
  if (short.length >= 2 && hits === short.length && fullHits >= 1) return "match";
  const union = short.length + long.length - hits;
  if (fullHits >= 1 && hits / union >= 0.6) return "match";
  if (hits === 0) return "different";
  return "mismatch";
}

// ── Amount ───────────────────────────────────────────────────────────────────
/** Two amounts match within ₹1 or 0.5% (nulls treated as 0). */
export function amountsMatch(a: number | null | undefined, b: number | null | undefined): boolean {
  const x = Number(a) || 0, y = Number(b) || 0;
  return Math.abs(x - y) <= Math.max(1, Math.max(Math.abs(x), Math.abs(y)) * 0.005);
}

// ── Date ─────────────────────────────────────────────────────────────────────
const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
/** Parse a date cell (dd-Mon-yy, dd/mm/yyyy, dd.mm.yy, ISO, Date, Excel serial-ish)
 * to {d,m,y} parts, or null. `order` disambiguates numeric d/m ('dmy'|'mdy'). */
function dateParts(v: unknown): { d: number; m: number; y: number } | null {
  if (v instanceof Date) return { d: v.getDate(), m: v.getMonth() + 1, y: v.getFullYear() };
  const s = String(v ?? "").trim().replace(/\s+00:00:00.*$/, "");
  if (!s) return null;
  let m = s.match(/^(\d{1,2})[\s\-.]+([A-Za-z]{3,9})[\s\-.,]+(\d{2,4})$/); // 1-Apr-24
  if (m) { const mo = MONTHS[m[2].slice(0, 3).toLowerCase()]; if (mo) return { d: +m[1], m: mo, y: normYear(+m[3]) }; }
  m = s.match(/^(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})/); // ISO
  if (m) return { d: +m[3], m: +m[2], y: +m[1] };
  return null; // numeric d/m/y handled by toIso with an order
}
const normYear = (y: number) => (y < 100 ? 2000 + y : y);
/** Whole-column numeric-date convention: a part >12 must be the DAY. */
function detectOrder(values: unknown[]): "dmy" | "mdy" {
  let d1 = false, d2 = false;
  for (const v of values) {
    const s = String(v ?? "").trim();
    const m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.]\d{2,4}/);
    if (!m) continue;
    if (+m[1] > 12) d1 = true; if (+m[2] > 12) d2 = true;
  }
  if (d2 && !d1) return "mdy";
  return "dmy"; // Indian default
}
/** Normalise a date to ISO yyyy-mm-dd using the column's inferred order. */
export function toIso(v: unknown, order: "dmy" | "mdy"): string | null {
  const p = dateParts(v);
  if (p) return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
  const s = String(v ?? "").trim().replace(/\s+00:00:00.*$/, "");
  const m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})/);
  if (!m) return null;
  const a = +m[1], b = +m[2], y = normYear(+m[3]);
  const [d, mo] = order === "mdy" ? [b, a] : [a, b];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
/** Build a date→ISO normaliser for a whole column of values (auto-detects order). */
export function makeDateNormaliser(values: unknown[]): (v: unknown) => string | null {
  const order = detectOrder(values);
  return (v: unknown) => toIso(v, order);
}
export const datesMatch = (isoA: string | null, isoB: string | null): boolean => !!isoA && !!isoB && isoA === isoB;

// ── Section ──────────────────────────────────────────────────────────────────
const SECTION_KEYWORD_CODES: Array<[RegExp, string]> = [
  [/contract|transport|freight|labour|job\s*work/i, "194C"], [/professional|technical|consult/i, "194J"],
  [/rent/i, "194I"], [/commission|brokerage/i, "194H"], [/interest/i, "194A"], [/salary/i, "192"],
  [/purchase|goods/i, "194Q"], [/dividend/i, "194"], [/commission.*lottery/i, "194G"],
];
/** Canonical section code from a raw section/nature string, or null. */
export function canonicalSection(v: string | null | undefined): string | null {
  const s = (v ?? "").toUpperCase().replace(/\s+/g, " ").trim();
  if (!s) return null;
  const code = s.match(/\b(19[2-9][A-Z]{0,2}|20[0-9][A-Z]{0,2})\b/);
  if (code) return code[1].replace(/\s+/g, "");
  for (const [re, c] of SECTION_KEYWORD_CODES) if (re.test(s)) return c;
  return null;
}
export function sectionsMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const ca = canonicalSection(a), cb = canonicalSection(b);
  if (ca && cb) return ca === cb;
  return true; // if either is unrecognisable, don't manufacture a mismatch
}

export { looksLikePan };
