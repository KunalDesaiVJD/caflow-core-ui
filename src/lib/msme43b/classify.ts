// MSME 43B(h) — Phase 2: settlement-type classifier.
//
// Maps each ledger transaction to a canonical SettlementType using the
// configurable synonym dictionary. Deterministic and explainable — the matched
// keyword is the audit reason. Low-confidence debits are flagged for review.

import type { LedgerTxn, SettlementType } from './types';
import { SETTLEMENT_SYNONYMS } from './config';

export interface Classification {
  type: SettlementType;
  needsReview: boolean;
  matchedKeyword?: string;
}

/**
 * @param includeDetails whether to fold the contra breakup lines (a Tally "as
 *   per details" voucher) into the search text. See classifyTxn for why this
 *   is not always safe to do.
 */
function haystack(txn: LedgerTxn, includeDetails: boolean): string {
  const parts = [txn.particulars, txn.vchType || ''];
  if (includeDetails) parts.push(...(txn.details || []).map((d) => d.name));
  return parts.join(' ').toLowerCase();
}

export function classifyTxn(txn: LedgerTxn): Classification {
  const primary = haystack(txn, false);

  // A credit to the party increases the payable → it is a purchase/expense (a
  // bill) UNLESS it is a book provision, which is not an invoice from the
  // supplier and so never originates a payable at all — checked first so a
  // "Provision for expenses" credit isn't swept into PURCHASE by default.
  if (txn.credit > 0 && txn.debit === 0) {
    for (const { type, keywords } of SETTLEMENT_SYNONYMS) {
      if (type !== 'PROVISION' && type !== 'PURCHASE') continue;
      const kw = keywords.find((k) => primary.includes(k));
      if (kw) return { type, needsReview: false, matchedKeyword: kw };
    }
    return { type: 'PURCHASE', needsReview: false };
  }

  // A debit to the party reduces the payable → a settlement/adjustment. Matched
  // against the PRIMARY narration first (particulars + voucher type) — the text
  // that is actually about THIS transaction.
  for (const { type, keywords } of SETTLEMENT_SYNONYMS) {
    if (type === 'PURCHASE') continue;
    const kw = keywords.find((k) => primary.includes(k));
    if (kw) return { type, needsReview: false, matchedKeyword: kw };
  }

  // Nothing on the primary narration. A multi-ledger journal voucher (more than
  // one contra breakup line — several DIFFERENT ledgers touched by the same JV)
  // can still carry a settlement keyword on a line that has nothing to do with
  // THIS vendor's payable — e.g. "TDS Payable" as one of several contra legs,
  // which nets a vendor's bill for a TDS deduction that was never actually made
  // against that vendor's own bill. A single detail line (a plain 1:1 JV) does
  // not have that ambiguity, so it is still trusted outright.
  const details = txn.details || [];
  if (details.length > 1) {
    const withDetails = haystack(txn, true);
    for (const { type, keywords } of SETTLEMENT_SYNONYMS) {
      if (type === 'PURCHASE') continue;
      const kw = keywords.find((k) => withDetails.includes(k));
      if (kw) return { type, needsReview: true, matchedKeyword: kw };
    }
  } else if (details.length === 1) {
    const withDetails = haystack(txn, true);
    for (const { type, keywords } of SETTLEMENT_SYNONYMS) {
      if (type === 'PURCHASE') continue;
      const kw = keywords.find((k) => withDetails.includes(k));
      if (kw) return { type, needsReview: false, matchedKeyword: kw };
    }
  }

  // Debit we could not confidently type — treat as a payment but flag it.
  if (txn.debit > 0) return { type: 'PAYMENT', needsReview: true };
  return { type: 'UNKNOWN', needsReview: true };
}

/** Cash-timing settlements (their DATE matters for the window test) vs
 *  non-cash reductions (net-out of the base, never a delayed-payment concern). */
export function isCashTiming(type: SettlementType): boolean {
  return type === 'PAYMENT' || type === 'ADVANCE_ADJ' || type === 'CONTRA_JV';
}

export function isNonCashReduction(type: SettlementType): boolean {
  return type === 'TDS' || type === 'ROUND_OFF' || type === 'KASAR_VATAV' ||
    type === 'DEBIT_NOTE' || type === 'CREDIT_NOTE';
}
