// MSME 43B(h) Analyser — canonical data model
// Source-agnostic representation shared by the Tally and Expert PDF parsers,
// the settlement classifier, the FIFO matcher and the 43B(h) computation engine.

/** A positioned text token extracted from a PDF page (pdfjs text item). */
export interface TextToken {
  /** left x of the token (PDF user space, origin top-left after normalisation) */
  x: number;
  /** right x of the token */
  x1: number;
  /** baseline y of the token */
  y: number;
  text: string;
}

/** One reconstructed physical line of a PDF page (tokens sharing a y-band). */
export interface TextLine {
  y: number;
  tokens: TextToken[];
  /** full line text joined left-to-right */
  text: string;
}

/** Canonical settlement / entry classification. */
export type SettlementType =
  | 'PURCHASE'        // credit to party — origination of a payable (a "bill")
  | 'OPENING'         // opening payable balance carried in
  | 'PAYMENT'         // bank / cash / UPI settlement (debit to party)
  | 'TDS'             // TDS deducted (debit to party, credited to TDS payable)
  | 'KASAR_VATAV'     // kasar / vatav / discount / rebate / write-off
  | 'ROUND_OFF'       // round-off (immaterial)
  | 'DEBIT_NOTE'      // debit note / purchase return (reduces payable)
  | 'CREDIT_NOTE'     // credit note issued by supplier (reduces payable)
  | 'CONTRA_JV'       // journal set-off / netting / contra
  | 'ADVANCE_ADJ'     // advance adjusted against bill
  | 'OTHER_CREDIT'    // a credit to party that is not a purchase (rare)
  | 'UNKNOWN';

/** A contra breakup line under a Tally "as per details" voucher. */
export interface LedgerDetailLine {
  name: string;
  amount: number;
  drcr: 'Dr' | 'Cr';
}

/**
 * A single canonical ledger transaction in the party (creditor) ledger.
 * Sign convention: this is a CREDITOR ledger, so a credit balance = amount payable.
 *   credit > 0  → increases the payable (a purchase / bill)
 *   debit  > 0  → decreases the payable (a payment / adjustment)
 */
export interface LedgerTxn {
  /** ISO date yyyy-mm-dd */
  date: string;
  /** narration / contra ledger name as printed */
  particulars: string;
  vchType?: string;
  vchNo?: string;
  debit: number;
  credit: number;
  // ── GST split, when the source document actually shows it ──
  // s.43B(h) disallows a DEDUCTION. For a registered buyer taking input credit,
  // GST is not claimed as a deduction, so only the taxable value can be
  // disallowed. These are populated only when the document states them; they
  // are never inferred here (see gstSource on MatchedBill).
  /** taxable value of the invoice, exclusive of GST */
  taxableValue?: number;
  /** total GST charged (CGST + SGST + IGST + cess) */
  gstAmount?: number;
  /** GST rate as a percentage, e.g. 18 */
  gstRate?: number;
  /** running balance as printed by the software, if available (for validation) */
  printedBalance?: number;
  /** 'C' = credit (payable) balance, 'D' = debit balance */
  printedBalanceSide?: 'C' | 'D';
  /** Tally contra breakup lines, kept as classification metadata (not balance-affecting) */
  details?: LedgerDetailLine[];
  /** classifier output */
  type?: SettlementType;
  /** low-confidence classification flagged for human review */
  needsReview?: boolean;
  /** raw source text for the audit trail */
  raw?: string;
}

/** A parsed vendor ledger for one financial year. */
export interface VendorLedger {
  vendorName: string;
  companyName?: string;
  /** ISO */
  periodFrom?: string;
  periodTo?: string;
  /** e.g. "2025-26" */
  financialYear?: string;
  /** opening payable (credit-positive: +ve = we owe the vendor) */
  openingBalance: number;
  /** closing payable as printed (credit-positive) */
  closingBalance: number;
  txns: LedgerTxn[];
  format: LedgerFormat;
  sourceFile?: string;
  // ── self-validation (reconstructed vs printed) ──
  reconstructedClosing?: number;
  balanceReconciled?: boolean;
  reconDrift?: number;
  /** non-fatal parser notes / warnings */
  warnings?: string[];
}

export type LedgerFormat = 'tally' | 'expert' | 'ai' | 'unknown';

// ────────────────────────────────────────────────────────────────────────────
//  Matching + computation model
// ────────────────────────────────────────────────────────────────────────────

/** A settlement event applied against a bill by the FIFO matcher. */
export interface Settlement {
  date: string;
  amount: number;
  type: SettlementType;
  particulars: string;
  vchNo?: string;
  /** which financial year the settlement fell in ('CY' | 'FY') */
  yearBucket?: 'CY' | 'FY';
}

/** A payable "bill" (origination) after matching, with its settlements. */
export interface MatchedBill {
  id: string;
  vendorName: string;
  billDate: string;
  /** gross amount of the payable as booked (credit to party) */
  grossAmount: number;
  /** amount attributable to TDS that discharges to govt (net-out of 43B base) */
  tdsAmount: number;
  /** credit notes / debit notes / returns reducing the payable */
  noteReductions: number;
  /** kasar / vatav / discount / write-off extinguishing the payable */
  kasarAmount: number;
  /** 43B(h) base = gross − tds − noteReductions (the sum "payable" to the MSME) */
  base: number;
  isOpening: boolean;
  settlements: Settlement[];
  vchNo?: string;
  vchType?: string;
  // ── GST split ──
  /** GST included in grossAmount (0 when none / not identified) */
  gstAmount: number;
  /** taxable value = grossAmount − gstAmount */
  taxableValue: number;
  /**
   * Proportion of the gross that is the taxable value. Settlements are made in
   * GROSS rupees, so matching runs on gross and this ratio is applied at the
   * point the disallowance is stated — which keeps
   * disallowed = allowedFY + stillOutstanding intact.
   */
  taxableRatio: number;
  /** where the GST split came from — never guessed silently */
  gstSource: 'ledger' | 'declared-rate' | 'no-gst' | 'unavailable';
  /** applied GST rate %, when derived from a declaration */
  gstRate?: number;
}

/** 43B(h) verdict for a single bill. */
export interface Bill43bResult {
  bill: MatchedBill;
  dueDate: string;
  /** days allowed under s.15 MSMED Act for this bill */
  windowDays: number;
  /** base outstanding as at CY year-end (31-Mar), GROSS */
  outstandingAtYearEnd: number;
  /** portion settled after year-end but within the due date (allowed in CY) */
  settledWithinWindowAfterYE: number;
  /** disallowed in CY (added back) — on the taxable value unless the rule says gross */
  disallowedCY: number;
  /** of the CY-disallowed amount, the part actually paid in FY (allowed in FY) */
  allowedInFY: number;
  /** still outstanding beyond due date at end of FY */
  stillOutstanding: number;
  /** the same three figures before the GST split, for the audit trail */
  grossDisallowedCY: number;
  /** date of the settlement that cleared this bill (latest allocation), if any */
  clearedOn?: string;
  /** calendar days from bill date to the clearing settlement */
  daysTaken?: number;
  reason: string;
}

export interface VendorResult {
  vendorName: string;
  format: LedgerFormat;
  cyReconciled: boolean;
  fyReconciled: boolean;
  cyClosing: number;
  fyOpening: number;
  /** FY opening must equal CY closing — continuity check */
  continuityOk: boolean;
  bills: Bill43bResult[];
  totalDisallowedCY: number;
  totalAllowedFY: number;
  totalStillOutstanding: number;
  warnings: string[];
  /** entries the classifier could not confidently type */
  reviewCount: number;
  /** true when the independent cross-check agrees and all invariants hold */
  verified?: boolean;
  /** cross-check / invariant discrepancies, if any */
  verifyNotes?: string[];
  // ── GST ──
  /** total GST excluded from the disallowance across this vendor's bills */
  gstExcluded: number;
  /**
   * Gross value of bills where the GST split could NOT be established — their
   * disallowance is stated on gross and is therefore overstated by the tax.
   * Declaring the vendor's GST rate resolves it.
   */
  gstUnidentifiedValue: number;
  /** the GST rate declared for this vendor, if any */
  declaredGstRate?: number;
}

export interface Msme43bReport {
  clientName?: string;
  cyLabel: string;   // "2025-26"
  fyLabel: string;   // "2026-27"
  windowDays: number;
  generatedAt?: string;
  vendors: VendorResult[];
  totalDisallowedCY: number;
  totalAllowedFY: number;
  totalStillOutstanding: number;
  /** total GST excluded from the disallowance (not deductible, so not disallowable) */
  totalGstExcluded: number;
  /** gross value of bills whose GST split could not be established */
  totalGstUnidentified: number;
  /** true when every ledger reconciled and there are no review items blocking */
  clean: boolean;
}
