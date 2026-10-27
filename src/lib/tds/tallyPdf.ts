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
 *     A pure EXPENSE ledger (e.g. "Staff Salary Expense") books the SAME
 *     "(as per details)" Journal shape, but the voucher is a DEBIT (there is
 *     no TDS credit to key on — this ledger doesn't record deductions, it
 *     records what was paid/expensed). There, the deductee is whichever Cr
 *     breakdown line's own text contains "- Salary" (e.g. "Nevil Thummar -
 *     Salary … Cr"), told apart from the OTHER Cr lines on the same voucher
 *     (PF Employee, Professional Tax, VPF, Labour Welfare Fund, …) purely by
 *     that suffix — and the voucher's own debit total (not that Cr line's
 *     amount, which is a net-payable figure) is copied into `credit` so the
 *     rest of the pipeline reads it exactly like a normal deduction row.
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
  credit: number | null;      // the TDS amount for a "By" deduction row, OR
                               // (for a pure expense ledger like "Staff Salary
                               // Expense", which only ever books a Dr) the
                               // voucher's own debit total, copied across —
                               // see the "- Salary" breakdown-line branch in
                               // parseTallyPdfPages below
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
  // Set ONLY for the expense-ledger case above (credit copied from debit) —
  // this row's credit is a TAXABLE INCOME / gross-salary figure, never a TDS
  // amount, structurally guaranteed by WHICH branch captured it (not a guess
  // from section text, which a client's own Tally naming convention can't be
  // relied on for — e.g. "TDS 192 B" vs a salary ledger both existing for the
  // same 24Q client). undefined for every other row (liability-ledger "By"
  // entries, simple rows) — those are untouched and keep behaving exactly as
  // before this field existed (see tallyRecon.ts's use of it for why a
  // SEPARATE reconciliation pass, not a section guess, is what this enables).
  amountKind?: "taxable_income";
  // The total tax-line Cr amount (Professional Tax, TDS Payable, Education
  // Cess — see isTaxLine) actually subtracted out of THIS row's own `credit`
  // (0/undefined if none was seen on the voucher). Named for its original,
  // narrower case (Professional Tax alone); kept rather than renamed since
  // every caller already reads it by this name — see the taxCr accumulator's
  // own doc in parseTallyPdfPages for the full exclusion set. Only ever set
  // alongside amountKind:"taxable_income". Kept as its own field (rather than
  // folded silently into credit) because whether that exclusion is the right
  // reading is a per-CLIENT convention, not a universal fact — some offices
  // report Taxable Income net of it (matches credit as-is), others report it
  // gross (credit + ptExcluded). tallyRecon.ts's resolveTaxableIncomeReading()
  // decides which reading a given file's own Office Data actually supports,
  // instead of this parser guessing once for every client.
  ptExcluded?: number;
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

/**
 * Is this ledger an EMPLOYEE-COST head — salary, bonus, reimbursement — rather
 * than a TDS liability ledger?
 *
 * It matters because the two read a "To … Debit" row in opposite ways. In a
 * TDS-liability ledger ("TDS 192 B") that row is the CHALLAN PAYMENT to the
 * bank and must stay excluded. In an expense ledger it is the pay itself:
 *
 *   3-Apr-26  To  Seema Sharma-Salary   Journal 156    5,000.00
 *
 * — a real "Bonus Expense" ledger, where five of six entries are that shape.
 * Dropping them as payments left the file with one row and the whole Bonus
 * and Reimbursement ledgers reading as empty.
 */
function isEmployeeCostLedger(ledgerName: string | null): boolean {
  const s = (ledgerName ?? "").toLowerCase();
  if (!s) return false;
  if (/\bt\.?\s*d\.?\s*s\.?\b|\btax\b|payable|duties|liabilit/i.test(s)) return false;
  return /salar|wage|bonus|reimburse?ment|remunerat|incentive|allowance|arrear|ex-?gratia|perquisite|stipend|\bctc\b/i.test(s);
}

/** A ledger's counterparty that is NOT a person being paid — the bank/cash side
 *  of a payment, or a balance line. Never an employee. */
const NON_EMPLOYEE_PARTY_RE =
  /\bbank\b|\bcash\b|\bhdfc\b|\bicici\b|\baxis\b|\bkotak\b|\bsbi\b|\bidbi\b|\byes\b\s*bank|\bimprest\b|suspense|\bpayable\b|\bprovision\b/i;

/**
 * TAX IS NOT INCOME. True for a breakdown line that books a TAX, not a
 * taxable component — "TDS 192 B", "T.D.S. on Salary", "Income Tax Payable",
 * or Professional Tax.
 *
 * A director-remuneration voucher commonly books the remuneration AND its TDS
 * in the same voucher, so summing the debit side without this test added the
 * tax to the very income it was deducted from (₹2,00,000 + ₹19,800 =
 * ₹2,19,800 against Office Data's ₹2,00,000 — a false mismatch of exactly the
 * TDS). TDS reconciles against the TDS ledger as its own figure; it must
 * never inflate Taxable Income.
 *
 * Professional Tax matches here too (explicit instruction, 2026-07-30): a
 * section 16(iii) deduction from salary, never part of Taxable Income. It
 * normally shows up as a CREDIT line on the voucher, not a Dr line this
 * function is asked about — the Cr-side case is handled separately in
 * `tryMatchBreakdown` below, where the amount is explicitly subtracted rather
 * than relying on this Dr-only test.
 */
function isTaxLine(label: string): boolean {
  const s = label.toLowerCase();
  return /\bt\.?\s*d\.?\s*s\.?\b/.test(s)
    || /\btax\s*deducted\b/.test(s)
    || /\bincome\s*tax\b/.test(s)
    || PROFESSIONAL_TAX_RE.test(s);
}
/**
 * The STATUTORY / RECOVERY heads a salary voucher credits alongside the
 * employee's own account. Everything on the credit side of a salary voucher is
 * either the employee's net pay or one of these — which is what lets the
 * employee's line be identified without relying on how a particular client
 * happens to name it.
 */
/**
 * PROFESSIONAL TAX IS NOT TAXABLE INCOME.
 *
 * It is a section 16(iii) deduction, so it forms no part of the figure a 24Q
 * return reports as Taxable Income. A salary voucher's DEBIT total is the
 * employer's gross cost and therefore includes it, which left the parsed figure
 * ₹200 above Office Data on a real GROWQ employee — the exact difference of the
 * Professional Tax credited on that voucher.
 *
 * Deliberately narrow: Professional Tax ONLY. PF and ESIC are also credited on
 * the same vouchers but are Chapter VI-A deductions, not section 16 ones — they
 * stay inside the taxable figure, and excluding them would understate income.
 */
const PROFESSIONAL_TAX_RE = /\bprofession(al)?\s*tax\b|\bp\.?\s*tax\b|\bptax\b/i;

const SALARY_DEDUCTION_HEAD =
  /\bp\.?\s*f\b|provident|\bepf\b|\bvpf\b|\besic?\b|profession(al)?\s*tax|\bp\.?\s*tax\b|labour\s*welfare|\blwf\b|gratuity|\badvance\b|\bloan\b|recovery|canteen|insurance|\bmess\b|\bround(ing)?\s*off\b/i
  ;

/**
 * Is this credit line the EMPLOYEE, rather than a deduction head?
 *
 * The first version of this required the literal word "Salary" in the line,
 * because the ledger it was built from wrote "Nevil Thummar - Salary". That is
 * one client's naming convention, not a rule: a real Kwikteam ledger writes the
 * employee line as plain "Krunal Rajendrakumar Nayak", so every voucher in the
 * file failed to resolve a deductee and all 15 were dropped as payments —
 * reported to the user as "No credit (deduction) entries were found in this
 * ledger" for a ledger that is nothing but salary entries.
 *
 * Two signals, neither of which depends on naming style:
 *  - the line is NOT one of the statutory/recovery heads above, and
 *  - it carries the BULK of the voucher. Net pay dominates by construction —
 *    on the real files it is 91-99.8% of the voucher, while PT/PF/ESIC are a
 *    rounding error beside it — so a majority share identifies the employee
 *    even in a ledger whose deduction heads this list has never seen.
 * The "- Salary" suffix is still accepted directly, for a voucher whose net pay
 * happens to be split so far that no single line reaches a majority.
 */
/** Could this text-only line be the tail of a wrapped LEDGER NAME, rather than
 *  the voucher's narration? A narration is a sentence — it announces itself
 *  ("BEING THE INTEREST PAID @ 6% …") and runs long; a wrapped name fragment is
 *  a few words. Deliberately conservative: when in doubt this returns false and
 *  the line is treated as narration, which is the recoverable mistake. */
function isNameContinuation(text: string): boolean {
  const t = text.trim();
  if (!t || t.length > 40) return false;
  if (/^being\b|^narration\b|\brs\.?\s*\d/i.test(t)) return false;
  // Prose gives itself away with a lowercase joining word ("Marriage Gift FROM
  // office", "Full AND Final amount"); a wrapped ledger name does not have one.
  return !/\b(from|and|for|with|of|to|on|as|being|towards|against|paid|payable)\b/i.test(t);
}

/** How long a party must be before a following text-only line can be more of
 *  its NAME rather than the voucher's narration — i.e. long enough to have
 *  filled the Particulars column and forced Tally to wrap. Calibrated on real
 *  ledgers: the longest party that did NOT wrap is 27 chars, the shortest that
 *  DID is 37. */
const WRAP_MIN_PARTY_LEN = 32;

function isDeducteeCreditLine(label: string, credit: number, voucherTotal: number): boolean {
  if (SALARY_DEDUCTION_HEAD.test(label) || isTaxLine(label)) return false;
  if (/\bsalary\b/i.test(label)) return true;
  return voucherTotal > 0 && credit >= voucherTotal * 0.5;
}

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
    // Non-numeric text → nearest text column by left edge. "particulars" is
    // listed FIRST so a TIE resolves to it, never to "date": confirmed on a
    // real ledger (Microcircuits "salary expense.pdf") where the Date/
    // Particulars header anchors sat exactly 56px apart (66 and 122) and
    // every breakdown line's indented text printed at their exact midpoint
    // (94) — an equal-distance tie that used to resolve to "date" (listed
    // first there), silently swallowing the employee's own name as a
    // garbage date value. That corrupted `lastDate` for every row for the
    // REST of the ledger and derailed awaitingCompoundParty's state machine,
    // cascading into total parse failure from that voucher on. A genuine
    // date value never needs this tiebreak in practice — it prints at (or
    // very near) the Date header's own x, not at the midpoint between it and
    // Particulars — so preferring particulars on an exact tie is safe.
    const d = (x: number) => Math.abs(it.x - x);
    const best = [
      { k: "particulars", v: d(a.particulars) }, { k: "date", v: d(a.date) },
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
    // A long breakdown-line label WRAPS onto a SECOND baseline below it, but
    // (confirmed on a real salary-expense ledger) the AMOUNT stays pinned to
    // the FIRST baseline, printed alongside only the first half of the text
    // — e.g. "Keshviben Hasmukhbhau  23,000.00 Cr" on one line, "Gami -
    // Salary" alone on the next (the same shape hits "Professional Tax -
    // (AMC) -" / "Employee" too, on lines that don't need matching so it's
    // invisible there). Trying the match on the first line's own fragment
    // alone would wrongly fail (no "- Salary" in "Keshviben Hasmukhbhau"),
    // permanently losing the amount as if it were an unrecognised breakdown
    // line — so a failed attempt is buffered here and RETRIED once the next,
    // text-only continuation line completes the label.
    let pendingAmount: { amount: number; marker: string | null; text: string } | null = null;
    // TAXABLE INCOME IS SPLIT ACROSS SEVERAL DEBIT LINES on a real salary
    // voucher. Confirmed against a real one:
    //
    //   To (as per details)          Journal 11   Debit 31,372.00
    //     Bonus Expense                20,000.00 Dr
    //     Nevil Thummar - Salary       49,372.00 Cr
    //     PF Employee                   1,800.00 Cr
    //     Professional Tax - (AMC)        200.00 Cr
    //
    // Dr 31,372 + 20,000 = Cr 49,372 + 1,800 + 200 = 51,372. The voucher's
    // own debit is only the SALARY-expense share; the bonus is booked to its
    // own expense head on a separate Dr line. Reading the voucher debit alone
    // reported 31,372 against Office Data's 51,372 — a false mismatch of
    // exactly the bonus.
    //
    // Summing the Dr side is not a special case for "Bonus": on an expense
    // voucher the DEBITS are the employer's total cost for that employee,
    // which IS the gross taxable figure, and the CREDITS split it into net
    // pay plus the employee's own statutory deductions (PF, PT, …). So this
    // picks up any other taxable component a client books separately —
    // arrears, incentive, leave encashment — with no list to maintain.
    // Held as LABELLED components, not a running total, because whether a debit
    // counts depends on WHOSE account it is — and the deciding line (the
    // employee's own "- Salary" credit) is printed AFTER them.
    let extraDr: { label: string; amount: number }[] = [];
    // STATUTORY/TAX LINES ON THE VOUCHER'S CREDIT SIDE. The taxable total below
    // is computed from the Dr side (current.debit + extraDr) and, by double-
    // entry, that always equals the FULL Cr side — net pay + PF + PT + TDS +
    // Cess + … — so a Cr line naming any of these bakes its amount straight
    // into the figure even though nothing ever reads that line directly.
    //
    // Originally tracked Professional Tax alone. A real Accurate PMS Pvt Ltd
    // voucher (a high-earner crossing the TDS threshold) showed the SAME bug
    // one line wider: the voucher also credits "192B - TDS Payable" and
    // "Education Cess TDS" alongside PT, and neither was being excluded —
    // Taxable Income came out ₹8,525 (TDS + Cess) above the employee's own
    // salary line, for the exact reason PT was already excluded (TAX IS NOT
    // INCOME — see isTaxLine's own doc). isTaxLine() already recognised both
    // as tax lines (it gates isDeducteeCreditLine so neither is ever mistaken
    // for the employee), so this now excludes anything isTaxLine agrees is a
    // tax line, not just the Professional Tax subset of it.
    //
    // Held separately from extraDr (which is Dr-only) and subtracted
    // explicitly wherever the taxable credit is set — see the two subtraction
    // sites below. Accumulated rather than applied immediately because a tax
    // line can print BEFORE the employee's own "- Salary" line, i.e. before
    // `current.credit` exists yet.
    let taxCr = 0;
    // TDS-LIABILITY VOUCHER, NO Dr-SIDE RESTATEMENT OF THE TDS AMOUNT — some
    // works-contract-style vouchers never repeat the TDS figure on the Dr
    // side at all (unlike the "interest"/"director remuneration" shape the
    // branch below handles): Dr is purely the gross expense + its GST input
    // lines, and the vendor is named ONLY on a single Cr line for the net
    // payable. Real Bindra Construction voucher: Works Contract 8,29,104.21
    // Dr + SGST/CGST Input 74,619.38 Dr each = Elite Infraspace 9,70,051.93
    // Cr + this row's own 8,291.04 TDS credit (double-entry: Dr total = Cr
    // total). Holds the first non-tax/non-statutory Cr line seen as a
    // fallback CANDIDATE only — never committed to current.party directly —
    // so a genuine Dr-side match arriving later in read order always wins;
    // only applied by finalizeCompoundFallback() once the whole voucher ends
    // with no Dr-side match ever found. Reset per-voucher below.
    let compoundCrFallback: { text: string } | null = null;
    // A TDS-LIABILITY VOUCHER SHARED BY SEVERAL EMPLOYEES — one payroll run's
    // worth of TDS booked in ONE Journal, e.g.:
    //
    //   By (as per details)        Journal 101   Credit 52,000.00
    //     ZALAK P. KAPOPARA (SALARY)   30,000.00 Dr
    //     Umang P Kapopara (Salary)     9,000.00 Dr
    //     KARISHMA HIREN PATOLIYA      13,000.00 Dr
    //     TDS FOR THE MONTH OF APR26
    //
    // 30,000 + 9,000 + 13,000 = 52,000 — the voucher's own credit — but NO
    // single Dr line matches it alone, so the exact-amount match above never
    // fires and the row was left as the literal, unmatchable party
    // "(as per details)" (real Unity Organics Pvt Ltd case: every one of its
    // 192B vouchers has this shape, so NOTHING in the ledger ever resolved a
    // real name and every office record read as "TDS Missing from TDS
    // Ledger"). Collected here alongside (never instead of) the existing
    // single-line match — the moment a voucher's block ends still holding
    // "(as per details)", finalizeMultiDeducteeSplit() checks whether the Dr
    // lines seen SUM to the voucher's credit and, if so, explodes the one row
    // into N real rows, one per employee. Reset per voucher below, same as
    // extraDr/taxCr/compoundCrFallback.
    let compoundDrBreakdown: { party: string; amount: number }[] = [];
    // True for exactly one line after the deductee's name was committed, so a
    // wrapped name can absorb its own continuation — see its use below.
    let justNamedDeductee = false;
    const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
    const tryMatchBreakdown = (amount: number, marker: string | null | undefined, partyText: string): boolean => {
      if (
        current && marker && /^cr$/i.test(marker) && amount > 0 && isTaxLine(partyText)
      ) {
        if (current.amountKind === "taxable_income" && current.credit != null) {
          current.credit -= amount;
          current.ptExcluded = (current.ptExcluded ?? 0) + amount;
        } else taxCr += amount;
        // Not "the deductee" and never the start of a wrapped name — see
        // justNamedDeductee's own doc for why this must stay false here.
        return false;
      }
      if (
        current && current.party && AS_PER_DETAILS_RE.test(current.party) &&
        marker && /^dr$/i.test(marker) &&
        current.credit != null && Math.abs(amount - current.credit) < 0.005
      ) {
        current.party = partyText; return true;
      }
      if (
        current && current.party && AS_PER_DETAILS_RE.test(current.party) &&
        current.credit != null && marker && /^cr$/i.test(marker) && amount > 0 &&
        !isTaxLine(partyText) && !NON_EMPLOYEE_PARTY_RE.test(partyText) && !SALARY_DEDUCTION_HEAD.test(partyText)
      ) {
        if (!compoundCrFallback) compoundCrFallback = { text: partyText };
        return false;   // a candidate, not a commit — see the variable's own doc
      }
      if (
        // A pure EXPENSE ledger (e.g. "Staff Salary Expense") books every
        // voucher as a DEBIT — there is no credit for the amount-match above
        // to key on, so the row would otherwise be dropped as a "payment"
        // (see the credit==null filter below). Here the deductee instead has
        // to be told apart from the OTHER Cr breakdown lines on the same
        // voucher (PF Employee, Professional Tax, VPF, Labour Welfare Fund,
        // …) by the ledger name itself always containing "- Salary" for the
        // employee's own line — the one signal invariant across clients —
        // and once found, the voucher's TOTAL taxable debit (its own debit
        // PLUS every other Dr component on the voucher, see extraTaxableDr)
        // is copied into credit so the rest of the pipeline (which reads
        // only `credit`) treats it exactly like a normal row.
        // Scoped to an actual employee-cost ledger — without this, the SAME
        // shape (a compound voucher with no Cr-side match yet, and only a Dr
        // printed) also matches a TDS-LIABILITY ledger's own CHALLAN PAYMENT
        // voucher ("To (as per details) Payment … HDFC Bank C.C A/c … Cr"),
        // and isDeducteeCreditLine has no way to tell a bank/cash account
        // apart from a real employee by majority-share alone once the tax
        // lines above it (excluded from extraDr, see isTaxLine's own note on
        // that accumulator) leave `voucherTotal` too small — a real Unity
        // Organics Pvt Ltd 192B ledger mistagged its own challan payment as
        // "taxable income" this way. A challan payment has nothing to do
        // with this branch's actual purpose in the first place.
        isEmployeeCostLedger(ledgerName) &&
        current && current.party && AS_PER_DETAILS_RE.test(current.party) &&
        current.credit == null && current.debit != null &&
        marker && /^cr$/i.test(marker) &&
        isDeducteeCreditLine(partyText, amount, current.debit + extraDr.reduce((s, d) => s + d.amount, 0))
      ) {
        current.party = partyText;
        // A debit posted to the DEDUCTEE'S OWN account is a contra entry —
        // settling part of what is owed to them (the real voucher debits the
        // employee's own "- Salary" account with the TDS, then credits
        // "TDS 192 B" with the same figure). It is not additional income, so
        // it is excluded here; only debits to OTHER heads (Bonus Expense,
        // arrears, incentive) are further taxable components. Every tax line
        // (Professional Tax, TDS Payable, Education Cess — taxCr, subtracted
        // here) is excluded for the opposite reason: each IS a real Cr-side
        // component of this voucher, just never taxable.
        current.credit = current.debit + extraDr
          .filter((d) => norm(d.label) !== norm(partyText))
          .reduce((sum, d) => sum + d.amount, 0) - taxCr;
        current.amountKind = "taxable_income";
        current.ptExcluded = taxCr;
        return true;
      }
      // Any OTHER Dr line on a still-unresolved expense voucher is a further
      // TAXABLE component for the employee this voucher is about (Bonus
      // Expense, arrears, incentive). Accumulate it so the salary line above
      // can add it in — and, if it prints AFTER the salary line, fold it
      // straight into the figure already committed. Only ever reached on an
      // expense voucher (credit == null); a TDS-liability voucher's own
      // expense-head Dr line is consumed by the deductee match above, and
      // its credit is non-null so the salary branch can never fire.
      //
      // TAX IS NEVER A TAXABLE COMPONENT. A director-remuneration voucher
      // books the TDS in the SAME voucher, so a blanket sum of the debits
      // silently added the tax to the income it was deducted from
      // (₹2,00,000 + ₹19,800 = ₹2,19,800 against Office Data's ₹2,00,000 —
      // a false mismatch of exactly the TDS). TDS is a separate figure that
      // reconciles against the TDS ledger on its own; it must never inflate
      // Taxable Income.
      if (
        current && current.party && current.credit == null && current.debit != null &&
        marker && /^dr$/i.test(marker) && amount > 0 && !isTaxLine(partyText)
      ) {
        // Recorded WITH its label — the deductee isn't known yet, so whether
        // this is a contra entry can only be decided once the salary line
        // names them (see the filter above).
        extraDr.push({ label: partyText, amount });
        return false;   // not the deductee — keep searching for the salary line
      }
      if (
        current && current.amountKind === "taxable_income" && current.credit != null &&
        marker && /^dr$/i.test(marker) && amount > 0 && !isTaxLine(partyText) &&
        norm(partyText) !== norm(current.party ?? "")
      ) {
        current.credit += amount;
        return true;    // consumed: a taxable component booked after the salary line
      }
      return false;
    };
    /** Applies compoundCrFallback to the CURRENTLY-ending voucher, only if it
     *  never got a real Dr-side match (still literally "(as per details)").
     *  Must run at every point a compound voucher's breakdown block can end —
     *  a new proper row starting mid-page, OR the page's bands simply running
     *  out while the LAST voucher on the page is still awaiting one (the real
     *  Bindra Construction case: the target voucher was the only/last row on
     *  its page, so it never reached a "new row starts" transition at all). */
    const finalizeCompoundFallback = () => {
      if (current && current.party && AS_PER_DETAILS_RE.test(current.party) && compoundCrFallback) {
        current.party = compoundCrFallback.text;
      }
      compoundCrFallback = null;
    };
    /** Explodes a still-unresolved "(as per details)" voucher into one row per
     *  employee when its Dr breakdown lines SUM to the voucher's own credit
     *  (compoundDrBreakdown's own doc has the real Unity Organics case this
     *  came from). Deliberately exact-sum, not "best guess" — double-entry
     *  bookkeeping guarantees a genuine multi-employee split sums exactly;
     *  anything else (a stray extra Dr line, one employee's amount alone)
     *  fails the sum check and falls through to finalizeCompoundFallback /
     *  the unresolved-literal-party outcome exactly as before this existed.
     *  Runs BEFORE finalizeCompoundFallback at both call sites — a confident
     *  exact-sum match should never be pre-empted by the single Cr fallback
     *  candidate, and mutating the (by then orphaned) `current` afterward is
     *  harmless once it has been spliced out of `all`. */
    const finalizeMultiDeducteeSplit = () => {
      if (
        current && current.party && AS_PER_DETAILS_RE.test(current.party) &&
        current.credit != null && compoundDrBreakdown.length >= 2
      ) {
        const sum = compoundDrBreakdown.reduce((s, d) => s + d.amount, 0);
        if (Math.abs(sum - current.credit) < 0.005) {
          const pos = all.indexOf(current);
          if (pos !== -1) {
            // Each split-off row is its own entry from here on (matching,
            // display, everything downstream reads row_index as if it were
            // its own line in the ledger) — sharing the parent's row_index
            // across all of them would make them indistinguishable wherever
            // that's used as a key, so each gets a fresh one off the SAME
            // counter real rows use, not a derived/fractional value.
            const split: TallyPdfRow[] = compoundDrBreakdown.map((d) => ({
              ...current!, party: d.party, credit: d.amount, row_index: pageNo * 100_000 + idx++,
            }));
            all.splice(pos, 1, ...split);
          }
        }
      }
      compoundDrBreakdown = [];
    };
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
          const matched = tryMatchBreakdown(breakdownAmount, f.marker, f.party ?? "");
          // Only worth buffering while the deductee is STILL unresolved — a
          // failed match after it's already been found (e.g. the duplicate
          // Cr-gross line that repeats a non-"- Salary" deductee name) has
          // nothing left to complete, and must not survive to wrongly
          // intercept the narration lines that follow it as a retry attempt.
          const stillSearching = !matched && current && current.party && AS_PER_DETAILS_RE.test(current.party);
          // Observed alongside tryMatchBreakdown, never instead of it — every
          // Dr line seen while the party is still unresolved is a candidate
          // for the multi-deductee split (see compoundDrBreakdown's own doc).
          // A voucher that DOES resolve via the single-line exact match above
          // never needs this; finalizeMultiDeducteeSplit only acts when that
          // path found nothing at all.
          if (stillSearching && f.marker && /^dr$/i.test(f.marker) && f.party && breakdownAmount > 0) {
            compoundDrBreakdown.push({ party: f.party, amount: breakdownAmount });
          }
          pendingAmount = stillSearching ? { amount: breakdownAmount, marker: f.marker ?? null, text: f.party ?? "" } : null;
          // Another amount-bearing line means the deductee's own label is
          // finished — anything text-only after this belongs to the narration,
          // not to the name (see justNamedDeductee).
          justNamedDeductee = matched;
          continue;   // breakdown line either way — never a new row
        }
        if (f.onlyParticulars) {
          if (justNamedDeductee && current && f.party && isNameContinuation(f.party)) {
            // A WRAPPED deductee name, resolved on its first fragment. The
            // amount sits with that first line, so the match now commits
            // before the rest of the name has even been read
            // ("Keshviben Hasmukhbhau" / "Gami - Salary"). Only the line
            // IMMEDIATELY after the match can be a continuation, and only if
            // it doesn't read as narration — so the real narration that
            // follows a fully-named deductee is never glued onto the name.
            current.party = `${current.party ?? ""} ${f.party}`.replace(/\s+/g, " ").trim();
            justNamedDeductee = false;
            continue;
          }
          justNamedDeductee = false;
          if (pendingAmount && f.party) {
            // Completes a wrapped label whose amount sat with its FIRST
            // line — retry with the two fragments joined, using the SAME
            // amount/marker seen back then (this line carries neither).
            tryMatchBreakdown(pendingAmount.amount, pendingAmount.marker, `${pendingAmount.text} ${f.party}`.trim());
            pendingAmount = null;
          } else if (current && current.party && !AS_PER_DETAILS_RE.test(current.party) && f.party) {
            // The narration line ("BEING THE INTEREST PAID @ 6% …") — only
            // once the deductee is ALREADY resolved (see the field's own doc
            // on TallyPdfRow for why this is captured for display only,
            // never for matching); before that, an orphan text-only line
            // with no pending amount to complete has nothing to attach to.
            current.narration = current.narration ? `${current.narration} ${f.party}` : f.party;
          }
          continue;
        }
        awaitingCompoundParty = false;     // anything else starts the NEXT real entry
        pendingAmount = null;               // and any unconsumed amount belonged to nothing
        finalizeMultiDeducteeSplit();         // the ending voucher's last chance to split by Dr-sum
        finalizeCompoundFallback();          // then its last chance to use its Cr fallback
      }

      if (f.onlyParticulars) {
        // A text-only line under a COMPLETE row is that voucher's narration,
        // not more of its party name. "Complete" means the row already carried
        // its own amount and voucher number, so Tally had no reason to wrap:
        //
        //   3-Apr-26 To  Seema Sharma-Salary  Journal 156  5,000.00
        //                Marriage Gift from office            <- narration
        //
        // Appending it produced the party "Seema Sharma-Salary Marriage Gift
        // from office", which matches no employee in Office Data. A row still
        // MISSING its amount is a genuinely wrapped name, and keeps the old
        // append.
        if (current && f.party) {
          // Tally only wraps a name that FILLED the Particulars column, so a
          // short party had room to spare and whatever follows it is the
          // voucher's narration:
          //   "Hero Fincorp Ltd - Tranche 01 - 78143" (37) + "84206@10%"  -> one name
          //   "Seema Sharma-Salary" (19) + "Marriage Gift from office"    -> narration
          // Length alone is not enough (a two-word narration like "Client
          // Bonus" reads like a name fragment), so the continuation must also
          // not look like prose.
          //
          // Once the narration has started, the name is finished: Tally prints
          // the whole ledger name first and the narration under it, so a later
          // short line is the narration WRAPPING, not more of the name:
          //   "Ketan Parmar (BH Parmar Electrician)" (36)
          //   "BEING TDS DEDUCT INV NO. 144 AMT-"   <- narration
          //   "105448/-@ 1%"                        <- still narration
          // Appending that last line made every invoice its own "party"
          // ("Ketan Parmar (BH Parmar Electrician) 105448/-@ 1%"), so none of
          // them could match the deductee or share one saved party mapping.
          const partyFilledColumn = (current.party ?? "").length >= WRAP_MIN_PARTY_LEN;
          if (partyFilledColumn && !current.narration && isNameContinuation(f.party)) {
            current.party = `${current.party ?? ""} ${f.party}`.replace(/\s+/g, " ").trim();
          } else {
            current.narration = current.narration ? `${current.narration} ${f.party}` : f.party;
          }
        }
        continue;
      }
      if (f.date) lastDate = f.date;
      // A NEW voucher starts here — its taxable components are its own, so
      // the previous voucher's extra Dr lines (and any tax lines seen on it)
      // must never leak into it.
      extraDr = [];
      taxCr = 0;
      compoundCrFallback = null;
      compoundDrBreakdown = [];
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
    // The page's bands can run out while the LAST voucher is still awaiting
    // its split/Cr fallback (see finalizeMultiDeducteeSplit's and
    // finalizeCompoundFallback's own docs) — the real Bindra Construction
    // case, where the target voucher was the only row on its page and so
    // never reached the mid-loop "new row starts" call above.
    finalizeMultiDeducteeSplit();
    finalizeCompoundFallback();
  });

  const section = canonicalSection(ledgerName);
  // Normalise every date with ONE convention inferred from the whole ledger.
  const toIso = makeDateNormaliser(all.map((r) => r.date));
  for (const r of all) { r.iso = toIso(r.date); r.section = section; }

  // Keep only the DEDUCTIONS: a named party, a credit, and Tally's "By" side.
  //
  // …EXCEPT in an employee-cost ledger, where the pay is booked as a plain
  // DEBIT against the employee by name and there is no credit to key on:
  //   3-Apr-26  To  Seema Sharma-Salary  Journal 156  5,000.00
  // Those rows were being counted as challan payments and dropped, which is
  // what made a whole Bonus / Reimbursement ledger read as empty. The debit is
  // that employee's taxable pay, so it is promoted to `credit` exactly as the
  // compound-voucher branch already does, and tagged taxable_income so it
  // reconciles against Office Data's Taxable Income and never its TDS.
  const employeeCostLedger = isEmployeeCostLedger(ledgerName);
  const rows: TallyPdfRow[] = [];
  for (const r of all) {
    const party = (r.party ?? "").trim();
    if (party && SKIP_PARTY_RE.test(party)) { skipped.balances++; continue; }
    if (!party) { skipped.totals++; continue; }              // totals carry figures but no party
    if (r.credit == null || r.credit === 0) {
      // A row still literally holding "(as per details)" here means no real
      // Cr-side deductee was EVER resolved for it (every candidate was a
      // deduction head / tax line / bank line) — promoting the literal
      // placeholder text to `party` would file a return with a garbage
      // deductee name instead of correctly treating the voucher as
      // unclaimed. Caught by the "all deduction heads, no employee at all"
      // fixture once SALARY_HEADER made isEmployeeCostLedger genuinely true
      // for it — this branch was unreachable before that (see this file's
      // own test for the real case).
      const directCost = employeeCostLedger && r.debit != null && r.debit > 0
        && !AS_PER_DETAILS_RE.test(party)
        && !NON_EMPLOYEE_PARTY_RE.test(party) && !isTaxLine(party) && !SALARY_DEDUCTION_HEAD.test(party);
      if (!directCost) { skipped.payments++; continue; }     // "To … Axis Bank" challan payment
      rows.push({ ...r, credit: r.debit, amountKind: "taxable_income" });
      continue;
    }
    rows.push(r);
  }

  if (!section) issues.push(`Could not read the TDS section from the ledger name${ledgerName ? ` ("${ledgerName}")` : ""} — set it on the imported file.`);
  if (!rows.length) issues.push("No credit (deduction) entries were found in this ledger.");
  return { rows, section, ledgerName, period, company, pages: pages.length, creditCount: rows.length, skipped, issues };
}
