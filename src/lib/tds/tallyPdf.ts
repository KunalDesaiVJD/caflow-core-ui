/**
 * STAGE-3 · GENERIC Tally Ledger PDF parser — pure logic (no I/O, no AI).
 *
 * Reads the STANDARD Tally "Ledger Account" print, which is the same for every
 * client and every section (194A / 194C / 194J / 194T / …). Nothing here is keyed
 * to a client: the column geometry is DERIVED from each PDF's own header row, so
 * the parser adapts to a client's margins, fonts and paper size on its own.
 *
 * The Tally ledger layout, as it actually comes out of pdfjs (verified against
 * real 194A/194C/194J/194T prints):
 *
 *   SWASTIK BUILDCON                <- company block, centred
 *   …address…  PAN: ADXFS7893R
 *   TDS Payable-194C 25-26          <- LEDGER NAME  (the section lives here)
 *   Ledger Account                  <- the anchor that identifies the ledger name
 *   1-Apr-25 to 31-Mar-26           <- period
 *   Date | Particulars | Vch Type | Vch No. | Debit | Credit    <- COLUMN HEADER
 *
 * and each logical entry is drawn as SEVERAL text lines a pixel or two apart:
 *
 *   y=612            [237]Journal                       <- Vch Type
 *   y=611  [56]18-Aug-25 [119]Barima Ranjitsing [397]38 <- Date, Party, Vch No.
 *   y=610  [102]By                    [533]4,243.00     <- marker + Credit
 *
 * Four things about this format bite, and all four are handled here:
 *
 *  1. A row is NOT one text line. The three lines above are one entry, so items
 *     are grouped into BANDS by y (tolerance a few px), not by exact y.
 *  2. A DATE IS PRINTED ONLY WHEN IT CHANGES. In the real 194A print only the
 *     first of eight entries carries "31-Mar-26"; the rest inherit it. A parser
 *     that reads dates literally silently mis-dates most of the ledger.
 *  3. PARTY NAMES WRAP onto their own following line(s), in the Particulars
 *     column and nowhere else — "Arvindkumar S" + "Prajapati - 8.34%" is ONE
 *     party. A continuation line carries nothing but Particulars text.
 *  4. The ledger holds BOTH the deductions (By … Credit) and the challan
 *     payments (To Axis Bank … Debit), plus Closing Balance and totals. Only the
 *     CREDIT entries are TDS deductions; everything else must be dropped or the
 *     bank payment reconciles against a deductee.
 *  5. A COMPOUND (multi-ledger) Journal — the standard way Tally books "TDS on
 *     Interest/Rent/Fees" — prints "(as per details)" as the row's own
 *     particulars instead of a party name, e.g.:
 *
 *       20-May-26 By (as per details)         Journal   32   2,959.00
 *                 Interest on Unsecured Loan  29,590.00 Dr
 *                 Nikhilbhai Bhikhabhai Patel  2,959.00 Dr
 *                 Nikhilbhai Bhikhabhai Patel 29,590.00 Cr
 *                 BEING THE INTEREST PAID @ 6% (...) (29590@10%)
 *
 *     The real deductee is on the indented breakdown lines below, printed
 *     TWICE (once against the TDS amount as "Dr", once against the gross as
 *     "Cr") — never in the row itself. pdfjs also glues these indented
 *     amounts to their trailing "Dr"/"Cr" into ONE text run ("2,959.00 Dr"),
 *     which is too far left to be real Debit/Credit money and lands wherever
 *     readBand's nearest-column fallback puts it — so without special
 *     handling, "(as per details)" is taken literally as the party, and the
 *     breakdown lines are dropped as if they were unrelated blank rows. This
 *     is resolved (see `awaitingCompoundParty` below) by matching the
 *     breakdown line whose Dr-side amount equals the row's own credit — that
 *     is always the deductee, never the generic expense head above it,
 *     regardless of what that head is called for a given section.
 *
 * Amount columns are told apart by RIGHT EDGE (Tally right-aligns figures), using
 * the Debit/Credit header labels as the reference — not a hard-coded x.
 */

import { canonicalSection, makeDateNormaliser } from "./match";
import { toNum } from "./columnEngine";

/** One positioned text run, as pdfjs reports it (see pdfText.ts). */
export interface PdfTextItem {
  x: number;      // left edge
  y: number;      // baseline (larger = higher up the page)
  w: number;      // rendered width
  str: string;
}

export interface TallyPdfRow {
  row_index: number;
  date: string | null;        // raw as printed, e.g. "18-Aug-25"
  iso: string | null;         // normalised yyyy-mm-dd
  party: string | null;       // full party, continuation lines joined
  debit: number | null;
  credit: number | null;      // the TDS amount for a "By" deduction row
  vch_type: string | null;    // captured for display only — NEVER reconciled on
  vch_no: string | null;      // captured for display only — NEVER reconciled on
  section: string | null;     // from this ledger's name
  // The compound-Journal narration line ("BEING THE INTEREST PAID @ 6% …"),
  // when present — captured for DISPLAY only, same as vch_type/vch_no, never
  // reconciled on. Stage 3's matching (assignment.ts/match.ts) already
  // resolves the real deductee from the breakdown lines by amount alone
  // (see awaitingCompoundParty below), scoped per-row so it can't cross-
  // contaminate between rows even when amounts are similar — narration adds
  // no matching signal there. It exists purely so a reviewer looking at a
  // Stage 3 card can read the rate/period without reopening the source PDF.
  // null for a simple (non-compound) row: those don't reach this capture path.
  narration: string | null;
}

export interface TallyPdfParse {
  rows: TallyPdfRow[];        // CREDIT (deduction) rows only
  section: string | null;
  ledgerName: string | null;
  period: string | null;
  company: string | null;
  pages: number;
  creditCount: number;
  skipped: { payments: number; balances: number; totals: number };
  issues: string[];
}

const BAND_TOL = 4;             // px: lines this close vertically are one entry
const MARKER_RE = /^(by|to|dr|cr)$/i;
const SKIP_PARTY_RE = /^(opening|closing)\s*balance$|^(grand\s*)?total$|carried\s*(over|forward)|brought\s*forward/i;
const AS_PER_DETAILS_RE = /^\(as per details\)$/i;
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

// pdfjs frequently merges a token with the marker printed right after it on
// the same baseline into ONE text run — "20-May-26" + "By" arrives as the
// single string "20-May-26 By", and every compound-journal breakdown amount
// arrives as "2,959.00 Dr" rather than "2,959.00" + "Dr". Peel that trailing
// marker off before classifying the rest of the token, so the date column
// never has to swallow a stray "By"/"To".
const TRAILING_MARKER_RE = /^(.*\S)\s+(by|to|dr|cr)$/i;
function stripTrailingMarker(s: string): { base: string; marker: string | null } {
  const m = s.match(TRAILING_MARKER_RE);
  return m ? { base: m[1], marker: m[2] } : { base: s, marker: null };
}

interface Anchors { date: number; particulars: number; vchType: number; vchNo: number; debitR: number; creditR: number; headerY: number; }

/** Locate the ledger's column header and record where each column sits.
 *  Tally splits the header across two baselines a pixel apart, so we accept any
 *  header labels found within a small y window of each other. */
function findAnchors(items: PdfTextItem[]): Anchors | null {
  const want = (re: RegExp) => items.filter((i) => re.test(norm(i.str)));
  const date = want(/^date$/)[0];
  const particulars = want(/^particulars?$/)[0];
  const debit = want(/^debit$/)[0];
  const credit = want(/^credit$/)[0];
  if (!particulars || !credit) return null;   // not a Tally ledger print
  const vchType = want(/^vchtype$|^vouchertype$/)[0];
  const vchNo = want(/^vchno$|^voucherno$/)[0];
  // The header baseline = the lowest of the header labels; data lives below it.
  const headerY = Math.min(...[date, particulars, debit, credit, vchType, vchNo].filter(Boolean).map((i) => i!.y));
  return {
    date: date ? date.x : particulars.x - 50,
    particulars: particulars.x,
    vchType: vchType ? vchType.x : particulars.x + 120,
    vchNo: vchNo ? vchNo.x : particulars.x + 250,
    // right edges — Tally right-aligns figures under these labels
    debitR: debit ? debit.x + debit.w : credit.x + credit.w - 80,
    creditR: credit.x + credit.w,
    headerY,
  };
}

/** The ledger NAME — the line directly above the "Ledger Account" caption. The
 *  section is read from it, so a wrong pick means a whole ledger reconciles under
 *  the wrong section. Falls back to the nearest "TDS Payable…"-ish line. */
function findLedgerName(items: PdfTextItem[], headerY: number): string | null {
  const above = items.filter((i) => i.y > headerY);
  const caption = above.find((i) => /^ledgeraccount$/.test(norm(i.str)));
  if (caption) {
    const candidates = above.filter((i) => i.y > caption.y).sort((a, b) => a.y - b.y);
    if (candidates.length) return candidates[0].str.trim();
  }
  const tds = above.filter((i) => /tdspayable|tds|ledger/.test(norm(i.str)) && canonicalSection(i.str));
  return tds.length ? tds[0].str.trim() : null;
}

const findPeriod = (items: PdfTextItem[], headerY: number): string | null =>
  items.filter((i) => i.y > headerY).find((i) => /\bto\b/i.test(i.str) && /\d{1,2}-[A-Za-z]{3}-\d{2,4}/.test(i.str))?.str.trim() ?? null;

/** Group text runs into vertical BANDS. One Tally entry paints its Vch Type,
 *  its Date/Party/Vch No. and its marker+amount on three baselines ~1px apart,
 *  so a band — not a line — is the unit of an entry. */
function toBands(items: PdfTextItem[]): PdfTextItem[][] {
  const sorted = [...items].sort((a, b) => b.y - a.y);
  const bands: PdfTextItem[][] = [];
  for (const it of sorted) {
    const last = bands[bands.length - 1];
    if (last && Math.abs(last[0].y - it.y) <= BAND_TOL) last.push(it);
    else bands.push([it]);
  }
  for (const b of bands) b.sort((a, b2) => a.x - b2.x);
  return bands;
}

interface BandFields { date?: string; party?: string; vchType?: string; vchNo?: string; debit?: number; credit?: number; marker?: string; onlyParticulars: boolean; }

/** Split one band into its columns using the header geometry. */
function readBand(band: PdfTextItem[], a: Anchors): BandFields {
  const out: BandFields = { onlyParticulars: false };
  const partyParts: string[] = [];
  let sawNonParticulars = false;
  // A figure only counts as MONEY if it is actually printed under the Debit or
  // Credit columns. The Vch No. is numeric too ("129"), and treating every number
  // as money both loses the voucher number and pollutes Debit with it. The bound
  // is derived from THIS pdf's geometry — midway between the Vch No. column and
  // the Debit right edge — so it holds for any client's margins.
  const moneyLeftBound = (a.vchNo + Math.min(a.debitR, a.creditR)) / 2;
  for (const it of band) {
    const raw = it.str.trim();
    if (!raw) continue;
    // Peel off a marker pdfjs glued onto this run ("20-May-26 By", "2,959.00
    // Dr") before classifying what's left — see stripTrailingMarker's own doc.
    const { base, marker: trailingMarker } = stripTrailingMarker(raw);
    if (trailingMarker) { out.marker = trailingMarker; sawNonParticulars = true; }
    const s = base;
    if (!s) continue;    // the whole run WAS just the marker
    const n = toNum(s);
    const right = it.x + it.w;
    const isMoney = n != null && /[\d]/.test(s) && /^[\d,.\s()-]+$/.test(s) && right >= moneyLeftBound;
    if (isMoney) {
      // Right-aligned: decide Debit vs Credit by which header the RIGHT edge sits under.
      if (Math.abs(right - a.creditR) <= Math.abs(right - a.debitR)) out.credit = n!;
      else out.debit = n!;
      sawNonParticulars = true;
      continue;
    }
    if (MARKER_RE.test(s)) { out.marker = s; sawNonParticulars = true; continue; }
    // Non-numeric text → nearest text column by left edge.
    const d = (x: number) => Math.abs(it.x - x);
    const best = [
      { k: "date", v: d(a.date) }, { k: "particulars", v: d(a.particulars) },
      { k: "vchType", v: d(a.vchType) }, { k: "vchNo", v: d(a.vchNo) },
    ].sort((p, q) => p.v - q.v)[0].k;
    if (best === "date") { out.date = s; sawNonParticulars = true; }
    else if (best === "vchType") { out.vchType = s; sawNonParticulars = true; }
    else if (best === "vchNo") { out.vchNo = s; sawNonParticulars = true; }
    else partyParts.push(s);
  }
  // A Vch No. is numeric and would have been eaten as money above if it sat under
  // an amount column; it does not — it is far left of Debit — so recover it here.
  if (partyParts.length) out.party = partyParts.join(" ").replace(/\s+/g, " ").trim();
  out.onlyParticulars = !sawNonParticulars && partyParts.length > 0;
  return out;
}

/**
 * Parse the text runs of a whole Tally ledger PDF (one array per page) into TDS
 * deduction rows. Generic: the geometry comes from each PDF's own header.
 */
export function parseTallyPdfPages(pages: PdfTextItem[][]): TallyPdfParse {
  const issues: string[] = [];
  const skipped = { payments: 0, balances: 0, totals: 0 };
  const all: TallyPdfRow[] = [];
  let ledgerName: string | null = null;
  let period: string | null = null;
  let company: string | null = null;
  let lastDate: string | null = null;   // dates carry across pages too
  let idx = 0;

  pages.forEach((items, pageNo) => {
    const a = findAnchors(items);
    if (!a) { issues.push(`Page ${pageNo + 1}: no Tally ledger column header (Particulars / Credit) — skipped.`); return; }
    if (!ledgerName) ledgerName = findLedgerName(items, a.headerY);
    if (!period) period = findPeriod(items, a.headerY);
    if (!company) {
      const top = items.filter((i) => i.y > a.headerY).sort((x, y2) => y2.y - x.y)[0];
      company = top ? top.str.trim() : null;
    }

    const bands = toBands(items.filter((i) => i.y < a.headerY - 1));
    let current: TallyPdfRow | null = null;
    // True while `current` is a compound-Journal row still literally holding
    // "(as per details)" as its party — see the class comment (point 5) for
    // why the real deductee has to be recovered from the breakdown lines
    // that follow, rather than treating the header row's own text as final.
    let awaitingCompoundParty = false;
    for (const band of bands) {
      const f = readBand(band, a);

      if (awaitingCompoundParty) {
        // readBand's nearest-column fallback has nowhere sensible to put a
        // breakdown line's amount (it sits well left of the real Debit/
        // Credit columns), so it lands in the Vch Type slot — a real Vch
        // Type is always a word ("Journal"/"Payment"), never a number, so a
        // numeric value there reliably marks this as a breakdown line, not
        // a new entry.
        const breakdownAmount = f.vchType != null ? toNum(f.vchType) : null;
        if (breakdownAmount != null) {
          // The deductee is whichever line repeats this row's own credit
          // (the TDS amount) on its Dr side — the expense head above it
          // (e.g. "Interest on Unsecured Loan") carries the GROSS amount
          // instead, and the duplicate Cr line repeats the gross again, so
          // matching on the row's own credit is what tells the two apart,
          // for any expense head or section, not just this one client's.
          if (
            current && current.party && AS_PER_DETAILS_RE.test(current.party) &&
            f.party && f.marker && /^dr$/i.test(f.marker) &&
            current.credit != null && Math.abs(breakdownAmount - current.credit) < 0.005
          ) {
            current.party = f.party;
          }
          continue;   // breakdown line either way — never a new row
        }
        if (f.onlyParticulars) {
          // The narration line ("BEING THE INTEREST PAID @ 6% …") — not a
          // party continuation here (see the field's own doc on TallyPdfRow
          // for why this is captured for display only, never for matching).
          if (current && f.party) current.narration = current.narration ? `${current.narration} ${f.party}` : f.party;
          continue;
        }
        awaitingCompoundParty = false;     // anything else starts the NEXT real entry
      }

      if (f.onlyParticulars) {
        // A wrapped party name — belongs to the entry above it.
        if (current && f.party) current.party = `${current.party ?? ""} ${f.party}`.replace(/\s+/g, " ").trim();
        continue;
      }
      if (f.date) lastDate = f.date;
      current = {
        row_index: pageNo * 100_000 + idx++,
        date: f.date ?? lastDate,          // inherit — Tally prints a date only when it changes
        iso: null,
        party: f.party ?? null,
        debit: f.debit ?? null,
        credit: f.credit ?? null,
        vch_type: f.vchType ?? null,
        vch_no: f.vchNo ?? null,
        section: null,
        narration: null,
      };
      all.push(current);
      awaitingCompoundParty = !!(current.party && AS_PER_DETAILS_RE.test(current.party));
    }
  });

  const section = canonicalSection(ledgerName);
  // Normalise every date with ONE convention inferred from the whole ledger.
  const toIso = makeDateNormaliser(all.map((r) => r.date));
  for (const r of all) { r.iso = toIso(r.date); r.section = section; }

  // Keep only the DEDUCTIONS: a named party, a credit, and Tally's "By" side.
  const rows: TallyPdfRow[] = [];
  for (const r of all) {
    const party = (r.party ?? "").trim();
    if (party && SKIP_PARTY_RE.test(party)) { skipped.balances++; continue; }
    if (!party) { skipped.totals++; continue; }              // totals carry figures but no party
    if (r.credit == null || r.credit === 0) { skipped.payments++; continue; } // "To … Axis Bank" challan payment
    rows.push(r);
  }

  if (!section) issues.push(`Could not read the TDS section from the ledger name${ledgerName ? ` ("${ledgerName}")` : ""} — set it on the imported file.`);
  if (!rows.length) issues.push("No credit (deduction) entries were found in this ledger.");
  return { rows, section, ledgerName, period, company, pages: pages.length, creditCount: rows.length, skipped, issues };
}
