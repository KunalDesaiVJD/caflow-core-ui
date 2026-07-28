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

export interface Msme43bConfig {
  /** permitted days u/s 15 MSMED Act: 15 (no agreement) or 45 (with agreement) */
  windowDays: number;
  /**
   * Materiality tolerance in ₹ for balance reconciliation and for ignoring
   * immaterial round-off style entries in the disallowance base.
   */
  toleranceRupees: number;
  /** treat opening-balance payables as bills dated at period start */
  includeOpeningBalance: boolean;
  /**
   * Whether the disallowance base is net of TDS (the sum actually "payable" to
   * the supplier). Standard view = true.
   */
  netOfTds: boolean;
  /** first assessment year the section applies from (guards against pre-FY24 runs) */
  firstApplicableFy: string; // "2023-24"
}

export const DEFAULT_CONFIG: Msme43bConfig = {
  windowDays: 45,
  toleranceRupees: 5,
  includeOpeningBalance: true,
  netOfTds: true,
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
    keywords: [
      'kasar', 'vatav', 'vatti', 'kasar vatav', 'kasar-vatav', 'kasar/vatav',
      'discount', 'cash discount', 'trade discount', 'rebate', 'kasar & vatav',
      'sundry balance', 'balance written', 'write off', 'write-off', 'w/off',
      'w.off', 'short', 'excess', 'diff', 'difference', 'rate diff', 'less',
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
