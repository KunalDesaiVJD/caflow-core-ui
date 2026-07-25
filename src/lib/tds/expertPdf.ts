/**
 * STAGE-3 · GENERIC "Expert" ledger PDF parser — pure logic (no I/O, no AI).
 *
 * "Expert" is a second accounting package some clients keep their books in
 * instead of Tally. Its ledger print is structurally its OWN thing — a
 * different column layout, different party/narration conventions, no Vch
 * Type/Vch No columns at all — so this file is a wholly independent sibling
 * of ./tallyPdf.ts, not a variant of it: nothing here is imported from, or
 * imported by, tallyPdf.ts, and tallyPdf.ts is not touched by this file.
 * Only genuinely source-agnostic helpers (canonicalSection/makeDateNormaliser
 * from ./match, toNum from ./columnEngine) are shared, the same way any two
 * unrelated parsers in this codebase would share a date-parsing utility.
 *
 * The Expert ledger layout, as it actually comes out of pdfjs (verified
 * against four real client prints — 194H/194J/194Q/194C, one section per
 * file):
 *
 *   POINT PACKERS                          <- company, centred
 *   TDS 194 C                              <- SECTION lives here (one per file)
 *   From 01/04/2026 To 30/06/2026           <- period
 *   Date | Particulars | Dr.Amount | Cr.Amount | Balance   <- COLUMN HEADER
 *
 * and one logical entry is drawn as ONE OR MORE text lines:
 *
 *   09/04/2026 MELT SEAL                                       79.00
 *            BEING THE TDS 7906.25@1%
 *            B NO. 17                                       2,891.00C
 *
 * Four things about this format bite, and all four are handled here:
 *
 *  1. pdfjs GLUES the Date and the whole Particulars text into ONE run when
 *     they sit close together on the same baseline — "09/04/2026" +
 *     "MELT SEAL" arrives as the single string "09/04/2026 MELT SEAL", not
 *     as two runs. Unlike Tally (where dates are only printed when they
 *     change), Expert reprints the date on every entry, so this glued form
 *     is the common case, not an edge case — every date-leading token is
 *     tried against a `DD/MM/YYYY <rest>` split before anything else.
 *  2. Narration is FREE-FORM and can run one, two or three lines
 *     ("BEING THE TDS 7906.25@1%", "B NO. 17", or for 194Q a purchase-total
 *     formula wrapped mid-number across three lines). None of it is parsed
 *     for figures — Office Data already carries the gross/rate separately,
 *     and 194Q's word-wrap literally SPLITS numbers mid-digit across lines,
 *     so trying to reconstruct a number from narration text would be
 *     fragile by construction. Only a "B NO. ####" bill reference is lifted
 *     out, for display only, never reconciled on.
 *  3. The running Balance is printed SPARSELY — sometimes on the entry's own
 *     line, sometimes deferred to whatever line happens to close out the
 *     next entry, sometimes not printed at all before a same-day payment
 *     entry. It is cosmetic only (same conclusion Tally's parser reaches
 *     about its own ledger) and is never used to decide where one entry
 *     ends and the next begins — that boundary is decided purely by the
 *     next DATE-leading token (or the Closing Balance marker), never by
 *     "does this line show a balance".
 *  4. The ledger holds BOTH deductions (Cr.Amount) and challan
 *     payments/bank-clearing entries ("Journal", "ICICI-C/C …") which print
 *     under Dr.Amount only. Only Cr.Amount rows are TDS deductions — exactly
 *     Tally's own Debit/Credit convention, just without the By/To markers to
 *     tell them apart, so here they're told apart purely by WHICH amount
 *     column is populated.
 *
 * Amount columns are told apart by RIGHT EDGE, using the Dr.Amount/Cr.Amount
 * header labels as the reference — not a hard-coded x. Verified across all
 * four sample files: Dr.Amount and Cr.Amount right-edges are pixel-exact for
 * every real figure, so a TIGHT tolerance is used (not Tally's looser
 * bound), which is what keeps a bare reference number printed in the
 * Particulars column (e.g. "1798" inside "Ch:GIB Dt: / / 1798") from ever
 * being misread as an amount — Expert has no Vch No column to derive a
 * coarser bound from the way Tally does.
 */

import { canonicalSection, makeDateNormaliser } from "./match";
import { toNum } from "./columnEngine";

/** One positioned text run, as pdfjs reports it. Structurally identical to
 *  tallyPdf.ts's own PdfTextItem (same pdfjs shape) but declared locally, on
 *  purpose, so this file has zero import from tallyPdf.ts — TypeScript's
 *  structural typing means pdfText.ts's output is still assignable here
 *  without a cast. */
export interface ExpertPdfTextItem {
  x: number;      // left edge
  y: number;      // baseline (larger = higher up the page)
  w: number;      // rendered width
  str: string;
}

export interface ExpertPdfRow {
  row_index: number;
  date: string | null;        // raw as printed, e.g. "09/04/2026"
  iso: string | null;         // normalised yyyy-mm-dd
  party: string | null;       // the deductee/payee name
  debit: number | null;       // challan payment / bank-clearing amount — never a deduction
  credit: number | null;      // the TDS credit for a real deduction row
  vch_no: string | null;      // "B NO. ####" bill reference, if present — display only, NEVER reconciled on
  vch_type: string | null;    // Expert has no such column — always null; kept so the shape lines up with Tally's row for the shared adapter
  section: string | null;     // from this ledger's own page title
}

export interface ExpertPdfParse {
  rows: ExpertPdfRow[];        // CREDIT (deduction) rows only
  section: string | null;
  period: string | null;
  company: string | null;
  pages: number;
  creditCount: number;
  skipped: { payments: number; balances: number; totals: number };
  issues: string[];
}

const BAND_TOL = 4;             // px: lines this close vertically are one entry
const SKIP_PARTY_RE = /^\*{3}\s*(opening|closing)\s*balance\s*\*{3}$/i;
const DATE_LEAD_RE = /^(\d{2}\/\d{2}\/\d{4})(?:\s+(.*))?$/;
const BILL_REF_RE = /\bB\s*NO\.?\s*([\w./-]+)/i;
// Expert right-aligns Dr.Amount/Cr.Amount EXACTLY under their header's own
// right edge in every real sample (zero variance across four files) — a
// tight tolerance is what tells a genuine amount apart from an unrelated
// bare number sitting in the Particulars column (see class comment, point
// on "1798").
const MONEY_TOL = 15;
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

interface Anchors { date: number; particulars: number; drR: number; crR: number; balR: number; headerY: number; }

/** Locate the ledger's column header and record where each column sits. */
function findAnchors(items: ExpertPdfTextItem[]): Anchors | null {
  const want = (re: RegExp) => items.filter((i) => re.test(norm(i.str)));
  const date = want(/^date$/)[0];
  const particulars = want(/^particulars?$/)[0];
  const dr = want(/^dramount$/)[0];
  const cr = want(/^cramount$/)[0];
  if (!particulars || !dr || !cr) return null;   // not an Expert ledger print
  const bal = want(/^balance$/)[0];
  const headerY = Math.min(...[date, particulars, dr, cr, bal].filter(Boolean).map((i) => i!.y));
  return {
    date: date ? date.x : particulars.x - 66,
    particulars: particulars.x,
    drR: dr.x + dr.w,
    crR: cr.x + cr.w,
    balR: bal ? bal.x + bal.w : cr.x + cr.w + 80,
    headerY,
  };
}

/** The TDS section lives on its own short line above the column header
 *  ("TDS 194 C") — scanned top-down so the company name line (which matches
 *  nothing) is skipped and the first real hit wins. */
function findSection(items: ExpertPdfTextItem[], headerY: number): string | null {
  const above = items.filter((i) => i.y > headerY).sort((a, b) => b.y - a.y);
  for (const i of above) {
    const sec = canonicalSection(i.str);
    if (sec) return sec;
  }
  return null;
}

const findPeriod = (items: ExpertPdfTextItem[], headerY: number): string | null =>
  items.filter((i) => i.y > headerY).find((i) => /\bto\b/i.test(i.str) && /\d{1,2}\/\d{1,2}\/\d{2,4}/.test(i.str))?.str.trim() ?? null;

/** Group text runs into vertical BANDS — one printed line per band in this
 *  format (unlike Tally, Expert doesn't spread one entry across baselines a
 *  pixel apart), but the same tolerant grouping is used regardless so a
 *  minor per-client rendering difference can't silently misalign columns. */
function toBands(items: ExpertPdfTextItem[]): ExpertPdfTextItem[][] {
  const sorted = [...items].sort((a, b) => b.y - a.y);
  const bands: ExpertPdfTextItem[][] = [];
  for (const it of sorted) {
    const last = bands[bands.length - 1];
    if (last && Math.abs(last[0].y - it.y) <= BAND_TOL) last.push(it);
    else bands.push([it]);
  }
  for (const b of bands) b.sort((a, b2) => a.x - b2.x);
  return bands;
}

interface BandFields { date?: string; party?: string; debit?: number; credit?: number; billRef?: string; }

/** Split one band into its fields. A band with a `date` starts a new entry;
 *  a band without one is a continuation line (narration) — Expert never
 *  wraps a PARTY name onto a second line in any sample seen (the combined
 *  Date+Particulars span comfortably fits every real name), so, unlike
 *  Tally, a continuation line here is narration to skip, not party text to
 *  append; only a bill reference is worth lifting out of it. */
function readBand(band: ExpertPdfTextItem[], a: Anchors): BandFields {
  const out: BandFields = {};
  const textParts: string[] = [];
  for (const item of band) {
    const raw = item.str.trim();
    if (!raw) continue;
    const right = item.x + item.w;
    const numericLooking = /\d/.test(raw) && /^[\d,.\s()-]+$/.test(raw);
    if (numericLooking) {
      const n = toNum(raw);
      if (n != null) {
        if (Math.abs(right - a.crR) <= MONEY_TOL) { out.credit = n; continue; }
        if (Math.abs(right - a.drR) <= MONEY_TOL) { out.debit = n; continue; }
      }
    }
    // The running Balance is cosmetic and never reconciled on (see class
    // doc) — but it is printed as "<number>C"/"<number>D" (a trailing
    // credit/debit-balance suffix), which fails the plain-numeric test just
    // above and would otherwise fall straight through into the party/
    // narration text — silently corrupting SKIP_PARTY_RE's match on
    // "*** OPENING/CLOSING BALANCE ***" (that regex is anchored at the end,
    // so ANY trailing text, even an unrelated Balance figure glued on by
    // this parser rather than the PDF, breaks it). Recognised purely by
    // POSITION (near the Balance header's own right edge) so it can be
    // discarded before that happens.
    if (/^[\d,.\s()-]+[cd]?$/i.test(raw) && Math.abs(right - a.balR) <= MONEY_TOL) continue;
    const m = DATE_LEAD_RE.exec(raw);
    if (m) {
      out.date = m[1];
      if (m[2]) textParts.push(m[2]);
      continue;
    }
    textParts.push(raw);
  }
  const joined = textParts.length ? textParts.join(" ").replace(/\s+/g, " ").trim() : "";
  if (out.date) {
    if (joined) out.party = joined;
  } else if (joined) {
    const bill = BILL_REF_RE.exec(joined);
    if (bill) out.billRef = bill[1];
  }
  return out;
}

/**
 * Parse the text runs of a whole Expert ledger PDF (one array per page) into
 * TDS deduction rows. Generic: the geometry comes from each PDF's own
 * header, and the section from each PDF's own title line.
 */
export function parseExpertPdfPages(pages: ExpertPdfTextItem[][]): ExpertPdfParse {
  const issues: string[] = [];
  const skipped = { payments: 0, balances: 0, totals: 0 };
  const all: ExpertPdfRow[] = [];
  let section: string | null = null;
  let period: string | null = null;
  let company: string | null = null;
  let idx = 0;

  pages.forEach((items, pageNo) => {
    const a = findAnchors(items);
    if (!a) { issues.push(`Page ${pageNo + 1}: no Expert ledger column header (Particulars / Dr.Amount / Cr.Amount) — skipped.`); return; }
    if (!section) section = findSection(items, a.headerY);
    if (!period) period = findPeriod(items, a.headerY);
    if (!company) {
      const top = items.filter((i) => i.y > a.headerY).sort((x, y2) => y2.y - x.y)[0];
      company = top ? top.str.trim() : null;
    }

    const bands = toBands(items.filter((i) => i.y < a.headerY - 1));
    let current: ExpertPdfRow | null = null;
    for (const band of bands) {
      const f = readBand(band, a);
      if (f.date == null) {
        // Continuation line — narration to skip, except a bill reference is
        // worth surfacing on the entry it belongs to.
        if (current && f.billRef && !current.vch_no) current.vch_no = f.billRef;
        continue;
      }
      current = {
        row_index: pageNo * 100_000 + idx++,
        date: f.date,
        iso: null,
        party: f.party ?? null,
        debit: f.debit ?? null,
        credit: f.credit ?? null,
        vch_no: null,
        vch_type: null,
        section: null,
      };
      all.push(current);
    }
  });

  // Normalise every date with ONE convention inferred from the whole ledger.
  const toIso = makeDateNormaliser(all.map((r) => r.date));
  for (const r of all) { r.iso = toIso(r.date); r.section = section; }

  // Keep only the DEDUCTIONS: a named party and a non-zero Cr.Amount. Rows
  // with no Cr.Amount at all (challan payments booked as "Journal", bank
  // clearing entries like "ICICI-C/C …") are dropped by this filter alone —
  // no separate check on the literal word "Journal" is needed, the same way
  // Tally's parser drops "To … Axis Bank" purely by its Debit/Credit split.
  const rows: ExpertPdfRow[] = [];
  for (const r of all) {
    const party = (r.party ?? "").trim();
    if (party && SKIP_PARTY_RE.test(party)) { skipped.balances++; continue; }
    if (!party) { skipped.totals++; continue; }
    if (r.credit == null || r.credit === 0) { skipped.payments++; continue; }
    rows.push(r);
  }

  if (!section) issues.push("Could not read the TDS section from this ledger's title line — set it on the imported file.");
  if (!rows.length) issues.push("No credit (deduction) entries were found in this ledger.");
  return { rows, section, period, company, pages: pages.length, creditCount: rows.length, skipped, issues };
}
