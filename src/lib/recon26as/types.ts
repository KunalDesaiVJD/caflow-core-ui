// 26AS vs Books — shared types.
//
// One shape for a TDS line whichever side it comes from, so the matching
// engine never has to know whether a row was read from a TRACES text file, a
// Tally ledger export, a PDF via the AI reader, or typed in by hand.

export type Side = 'books' | '26as';

export interface TdsEntry {
  /** stable within a run: side prefix + running number */
  id: string;
  side: Side;
  /** party as printed — the customer in the books, the deductor in 26AS */
  party: string;
  /** deductor TAN (26AS always; books only when the ledger carries it) */
  tan?: string;
  section?: string;
  /** ISO yyyy-mm-dd, or null when the row had no readable date */
  date: string | null;
  /** gross amount paid / credited, when known */
  amountPaid?: number;
  /** tax deducted — the figure that is reconciled */
  tds: number;
  /** 26AS only: TDS actually deposited by the deductor */
  tdsDeposited?: number;
  /** 26AS only: booking status F / U / P / O / M */
  bookingStatus?: string;
  /** voucher no., narration or remark, for the auditor's eye */
  ref?: string;
  /** file the row came from */
  file?: string;
}

/** A row the reader deliberately left out, kept so nothing disappears silently. */
export interface ExcludedRow {
  file: string;
  text: string;
  reason: string;
}

export interface ParseResult {
  entries: TdsEntry[];
  excluded: ExcludedRow[];
  warnings: string[];
  /** how the file was read */
  method: 'traces-text' | 'traces-pdf' | 'tabular' | 'ai';
  /** 26AS header details, when the file carried them */
  assessee?: { name?: string; pan?: string; fy?: string };
  /**
   * 26AS only: per-deductor totals printed by TRACES, used as an oracle for
   * the line items read under them.
   */
  printedTotals?: Record<string, number>;
}

export type LinkMethod = 'tan' | 'exact' | 'alias' | 'fuzzy' | 'total' | 'ai' | 'manual';

/** Books party → 26AS deductor. One deductor may carry several books parties. */
export interface PartyLink {
  /** normalised books party key */
  bookKey: string;
  /** 26AS deductor key (TAN, or normalised name when TAN is missing) */
  deductorKey: string;
  method: LinkMethod;
  /** 0..100 */
  confidence: number;
  reason: string;
}

export type MatchType =
  | 'exact'          // same amount, same date
  | 'date_diff'      // same amount, date within the window
  | 'rounding'       // amount within the rounding tolerance, date within the window
  | 'amount_diff'    // one-to-one pair, amount differs beyond rounding
  | 'grouped'        // several lines on one side = one or more on the other
  | 'amount_only'    // same amount, date outside the window
  | 'cross_party'    // same amount and date, booked under another party
  | 'manual'         // matched by the reviewer
  | 'forced';        // force-matched because the party totals agree

export interface MatchPair {
  id: string;
  type: MatchType;
  bookIds: string[];
  asIds: string[];
  booksAmount: number;
  asAmount: number;
  /** books − 26AS */
  diff: number;
  /** largest gap in days between the two sides' dates, when both have dates */
  dayGap: number | null;
  /** group the pair belongs to */
  groupKey: string;
  note?: string;
}

export type PartyStatus =
  | 'matched'       // every line matched and totals agree
  | 'total_match'   // totals agree, some lines still open — force match available
  | 'forced'        // reviewer force-matched on totals
  | 'difference'    // totals differ
  | 'books_only'    // party in books, nothing in 26AS
  | 'as_only';      // deductor in 26AS, nothing in books

export interface PartyGroup {
  /** deductor key for linked/26AS groups, `B:<bookKey>` for books-only */
  key: string;
  deductorName: string | null;
  tan: string | null;
  bookParties: string[];
  link: PartyLink | null;
  booksTotal: number;
  asTotal: number;
  /** books − 26AS */
  diff: number;
  booksCount: number;
  asCount: number;
  matchedBooks: number;
  matchedAs: number;
  openBookIds: string[];
  openAsIds: string[];
  status: PartyStatus;
  /** 26AS lines with booking status other than F */
  unbookedAs: number;
}

export interface ReconOptions {
  /** match dates up to this many days apart */
  dateWindowDays: number;
  /** rounding tolerance, ₹ */
  roundingTolerance: number;
  /** pair one-to-one lines whose amounts differ by up to this % */
  amountDiffPct: number;
  /** party totals within this many ₹ are treated as agreeing */
  totalTolerance: number;
}

export const DEFAULT_OPTIONS: ReconOptions = {
  dateWindowDays: 30,
  roundingTolerance: 1,
  amountDiffPct: 10,
  totalTolerance: 1,
};

export interface ManualMatch {
  id: string;
  bookIds: string[];
  asIds: string[];
  note?: string;
}

/** Everything the reviewer decided. Re-applied on every recompute. */
export interface ReconOverrides {
  /** group keys force-matched on totals */
  forced: string[];
  manual: ManualMatch[];
  /** reviewer's own links; a link to '' unlinks a party */
  links: Record<string, string>;
}

export interface ReconResult {
  groups: PartyGroup[];
  pairs: MatchPair[];
  books: TdsEntry[];
  as26: TdsEntry[];
  links: PartyLink[];
  totals: {
    books: number;
    as26: number;
    diff: number;
    matchedBooks: number;
    matchedAs: number;
    openBooks: number;
    openAs: number;
  };
}
