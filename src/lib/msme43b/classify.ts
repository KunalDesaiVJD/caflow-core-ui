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

function haystack(txn: LedgerTxn): string {
  const parts = [txn.particulars, txn.vchType || '', ...(txn.details || []).map((d) => d.name)];
  return parts.join(' ').toLowerCase();
}

export function classifyTxn(txn: LedgerTxn): Classification {
  const text = haystack(txn);

  // A credit to the party increases the payable → it is a purchase/expense (a bill).
  if (txn.credit > 0 && txn.debit === 0) {
    for (const { type, keywords } of SETTLEMENT_SYNONYMS) {
      if (type !== 'PURCHASE') continue;
      const kw = keywords.find((k) => text.includes(k));
      if (kw) return { type: 'PURCHASE', needsReview: false, matchedKeyword: kw };
    }
    return { type: 'PURCHASE', needsReview: false };
  }

  // A debit to the party reduces the payable → a settlement/adjustment.
  for (const { type, keywords } of SETTLEMENT_SYNONYMS) {
    if (type === 'PURCHASE') continue;
    const kw = keywords.find((k) => text.includes(k));
    if (kw) return { type, needsReview: false, matchedKeyword: kw };
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
