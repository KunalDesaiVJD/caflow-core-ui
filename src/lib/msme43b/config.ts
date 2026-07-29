// MSME 43B(h) Analyser — Phase 0: the legal ruleset encoded as configuration.
//
// Section 43B(h), Income Tax Act 1961 (inserted by Finance Act 2023, w.e.f.
// AY 2024-25): a sum payable to a MICRO or SMALL enterprise, if not paid within
// the time limit specified in section 15 of the MSMED Act 2006, is allowed as a
// deduction only in the year of ACTUAL PAYMENT. The first proviso to s.43B
// ("paid before the due date u/s 139(1)") does NOT extend to clause (h) — the
// only permissible window is 15/45 days.
//
// Section 15, MSMED Act 2006 — time limit for payment:
//   • written agreement    → as agreed, capped at 45 days from acceptance
//   • no written agreement → 15 days from acceptance
//
// NOTE: Employees pre-filter and upload ONLY ledgers of registered micro/small
// vendors, so this tool does not determine MSME status — it trusts the uploaded
// set and computes the disallowance.

import type { SettlementType } from './types';

/**
 * How a settlement entry behaves in the 43B(h) test:
 *   nonCash     — extinguishes the payable without a payment; compliant whatever
 *                 its date (TDS, credit/debit notes, kasar under the "it was
 *                 never payable" view).
 *   cashTiming  — a real discharge whose DATE decides compliance.
 *   ignore      — not a discharge at all; left out of the matching entirely.
 */
export type Treatment = 'nonCash' | 'cashTiming' | 'ignore';

/** Whether the invoice date itself counts as day 1 of the s.15 window. */
export type DayCountBasis = 'exclusive' | 'inclusive';

/** Which open bill a settlement is taken to clear (no bill-wise refs in exports). */
export type AllocationMethod = 'FIFO' | 'LIFO' | 'PRO_RATA';

export interface Msme43bConfig {
  /** permitted days u/s 15 MSMED Act: 15 (no agreement) or 45 (with agreement) */
  windowDays: number;
  /**
   * Day-count basis. 'exclusive' (default, firm-blessed): the invoice date is
   * day 0, so bill + windowDays is the last compliant day. 'inclusive': the
   * invoice date is day 1, so the window closes a day earlier.
   */
  dayCountBasis: DayCountBasis;
  /**
   * Days between the invoice date and the "day of acceptance" u/s 2(b) MSMED
   * Act, when the client's agreed terms run from acceptance/goods receipt
   * rather than the invoice. 0 = the clock starts on the invoice date.
   */
  acceptanceGraceDays: number;
  /**
   * Materiality tolerance in ₹ for balance reconciliation and for ignoring
   * immaterial round-off style entries in the disallowance base.
   */
  toleranceRupees: number;
  /** treat opening-balance payables as bills dated at period start */
  includeOpeningBalance: boolean;
  /**
   * Whether an opening (prior-year) payable can itself be disallowed in CY.
   * 'exclude' (default): it accrued in an earlier year, so it is that year's
   * item. 'include': test it in CY too.
   */
  openingDisallowance: 'exclude' | 'include';
  /** which open bill a settlement clears */
  allocation: AllocationMethod;
  /**
   * Whether the disallowance base is net of TDS (the sum actually "payable" to
   * the supplier). Standard view = true.
   */
  netOfTds: boolean;
  /** kasar / vatav / discount / write-off */
  kasarTreatment: Treatment;
  /** credit notes / debit notes / returns */
  notesTreatment: Treatment;
  /** round-off entries */
  roundOffTreatment: Treatment;
  /** advance adjusted against a bill */
  advanceTreatment: Treatment;
  /** journal set-off / contra / netting against another ledger */
  contraTreatment: Treatment;
  /** first assessment year the section applies from (guards against pre-FY24 runs) */
  firstApplicableFy: string; // "2023-24"
}

export const DEFAULT_CONFIG: Msme43bConfig = {
  windowDays: 45,
  dayCountBasis: 'exclusive',
  acceptanceGraceDays: 0,
  toleranceRupees: 5,
  includeOpeningBalance: true,
  openingDisallowance: 'exclude',
  allocation: 'FIFO',
  netOfTds: true,
  kasarTreatment: 'nonCash',
  notesTreatment: 'nonCash',
  roundOffTreatment: 'nonCash',
  advanceTreatment: 'cashTiming',
  contraTreatment: 'cashTiming',
  firstApplicableFy: '2023-24',
};

/**
 * Settlement-type synonym dictionary. Different clients use different
 * terminology (esp. Gujarati/Hindi trade terms). Matched case-insensitively as
 * substrings against the transaction particulars / contra ledger names.
 *
 * Order matters: the classifier tests these in priority order so that specific
 * types (TDS, notes, kasar) win over the generic PAYMENT/PURCHASE fallback.
 */
export const SETTLEMENT_SYNONYMS: Array<{ type: SettlementType; keywords: string[] }> = [
  {
    type: 'TDS',
    keywords: ['tds', 'tax deducted', 't.d.s', 'tds payable', 'tds receivable', 'wct', 'tcs'],
  },
  {
    type: 'ROUND_OFF',
    keywords: ['round off', 'round-off', 'roundoff', 'r/off', 'r off', 'rounding'],
  },
  {
    type: 'KASAR_VATAV',
    // Specific discount/write-off terms only. Bare words like "less", "diff",
    // "short", "excess" were removed — they false-match bank/payment narrations
    // and wrongly treat a payment as a non-cash discount (surfaced by the
    // independent cross-check on a real kasar/vatav vendor).
    keywords: [
      'kasar', 'vatav', 'vatti', 'kasar vatav', 'kasar-vatav', 'kasar/vatav',
      'kasar & vatav', 'discount', 'cash discount', 'trade discount', 'rebate',
      'sundry balance', 'balance written', 'written off', 'write off', 'write-off',
      'w/off', 'w.off', 'rate difference', 'rate diff',
    ],
  },
  {
    type: 'DEBIT_NOTE',
    keywords: ['debit note', 'dr note', 'd/note', 'purchase return', 'goods return', 'return outward'],
  },
  {
    type: 'CREDIT_NOTE',
    keywords: ['credit note', 'cr note', 'c/note', 'sales return', 'return inward'],
  },
  {
    type: 'PURCHASE',
    keywords: ['purchase', 'purc', 'purchse', 'purchase a/c', 'goods', 'expense', 'job work', 'labour', 'service'],
  },
  {
    type: 'CONTRA_JV',
    keywords: ['journal', 'contra', 'set off', 'set-off', 'adjust', 'jv', 'transfer'],
  },
  {
    type: 'ADVANCE_ADJ',
    keywords: ['advance', 'adv.', 'on account', 'against advance'],
  },
  {
    // Payment is the widest bank/cash catch — kept LAST among debit types so
    // more specific debit adjustments win first.
    type: 'PAYMENT',
    keywords: [
      'bank', 'cash', 'upi', 'neft', 'rtgs', 'imps', 'cheque', 'chq', 'paid',
      'payment', 'hdfc', 'kotak', 'icici', 'sbi', 'axis', 'idbi', 'yes bank',
      'c.c a/c', 'cc a/c', 'od a/c', 'current a/c', 'c/a', 'o/d',
    ],
  },
];

/** FY label helpers (Indian April–March financial year). */
export function fyLabelFromDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth(); // 0 = Jan
  const startYear = m >= 3 ? y : y - 1; // Apr (3) onwards belongs to that year
  const end = (startYear + 1) % 100;
  return `${startYear}-${String(end).padStart(2, '0')}`;
}

/** 31-March (year-end) ISO date for a given FY label like "2025-26". */
export function fyEndDate(fyLabel: string): string {
  const start = parseInt(fyLabel.slice(0, 4), 10);
  return `${start + 1}-03-31`;
}

/** 1-April (year-start) ISO date for a given FY label like "2025-26". */
export function fyStartDate(fyLabel: string): string {
  const start = parseInt(fyLabel.slice(0, 4), 10);
  return `${start}-04-01`;
}

/** add N calendar days to an ISO date, returning ISO. */
export function addDays(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * The s.15 MSMED Act due date for a bill — the last day on which payment is
 * still within time. Single source of truth for the day count: both the primary
 * engine and the independent cross-check call this, so the two can never drift
 * apart on the boundary.
 */
export function dueDateFor(billDate: string, cfg: Msme43bConfig): string {
  const clockStart = cfg.acceptanceGraceDays ? addDays(billDate, cfg.acceptanceGraceDays) : billDate;
  return addDays(clockStart, cfg.dayCountBasis === 'inclusive' ? cfg.windowDays - 1 : cfg.windowDays);
}

/**
 * How a settlement of a given type behaves under the current interpretation.
 * Every timing decision in the engine routes through here, so a rule change is
 * a data change — not an edit in two places that can fall out of step.
 */
export function treatmentOf(type: SettlementType, cfg: Msme43bConfig): Treatment {
  switch (type) {
    case 'TDS': return cfg.netOfTds ? 'nonCash' : 'cashTiming';
    case 'KASAR_VATAV': return cfg.kasarTreatment;
    case 'ROUND_OFF': return cfg.roundOffTreatment;
    case 'DEBIT_NOTE':
    case 'CREDIT_NOTE': return cfg.notesTreatment;
    case 'ADVANCE_ADJ': return cfg.advanceTreatment;
    case 'CONTRA_JV': return cfg.contraTreatment;
    default: return 'cashTiming'; // PAYMENT and anything unclassified
  }
}
