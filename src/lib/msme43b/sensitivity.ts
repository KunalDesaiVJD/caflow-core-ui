// MSME 43B(h) — classification sensitivity.
//
// WHY THIS EXISTS
//
// The cross-check in crosscheck.ts re-derives the figures by a different route,
// but it calls the SAME classifyTxn and the SAME treatmentOf as the primary
// engine. That makes it a genuine check on the arithmetic — allocation order,
// day-count boundaries, phase gating — and NO check at all on the
// classification. If a debit is put in the wrong bucket, both engines put it in
// the same wrong bucket and agree perfectly on a wrong answer.
//
// The concrete failure: a payment narrated "Bill Discounting" matches the
// keyword "discount", is typed KASAR_VATAV, and under the standard
// interpretation a kasar entry extinguishes the payable with no date test at
// all. A late payment therefore produces zero disallowance, and the cross-check
// confirms it.
//
// Duplicating the keyword lists into a second module would not fix that — it
// would only make the shared assumption look independent. What actually helps
// is to VARY the assumption and price it: re-run the figures with every
// narration-driven non-cash reduction treated instead as a dated payment, and
// report the difference. That difference is the amount of disallowance that
// rests on believing the narrations, stated as a number the reviewer can look
// at rather than a claim of independence they have to take on trust.

import type { VendorLedger, SettlementType } from './types';
import { DEFAULT_CONFIG, Msme43bConfig } from './config';
import { classifyTxn } from './classify';
import { crossCheckVendor } from './crosscheck';

/** A debit whose exclusion from the timing test depends on how it is narrated. */
export interface NarrationDependentEntry {
  date: string;
  particulars: string;
  amount: number;
  type: SettlementType;
  /** the keyword that produced the classification, when there was one */
  matchedKeyword?: string;
}

export interface SensitivityComponent {
  /** which assumption was varied */
  label: string;
  /** the assumption as it stands */
  assumption: string;
  /** disallowance if these entries were date-tested like any other payment */
  ifDateTested: number;
  /** ifDateTested − base: the disallowance that rests on this assumption */
  swing: number;
  entries: NarrationDependentEntry[];
}

export interface SensitivityResult {
  /** disallowance under the interpretation actually in force */
  base: number;
  components: SensitivityComponent[];
  /** the largest single swing — the headline exposure to a misread narration */
  maxSwing: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Debit entries of the given types, with the keyword that classified them. */
function entriesOfType(
  ledgers: Array<VendorLedger | null>,
  types: SettlementType[],
  cfg: Msme43bConfig,
): NarrationDependentEntry[] {
  const want = new Set(types);
  const out: NarrationDependentEntry[] = [];
  for (const led of ledgers) {
    if (!led) continue;
    for (const t of led.txns) {
      if (!(t.debit > cfg.toleranceRupees)) continue;
      const c = classifyTxn(t);
      if (!want.has(c.type)) continue;
      out.push({
        date: t.date,
        particulars: t.particulars,
        amount: r2(t.debit),
        type: c.type,
        matchedKeyword: c.matchedKeyword,
      });
    }
  }
  return out;
}

/**
 * Price the classification assumptions for one vendor.
 *
 * Two are varied separately, because they carry different risk and lumping them
 * together would bury the interesting one:
 *
 *   • write-offs (kasar/vatav, discount, round-off, credit and debit notes) —
 *     matched purely on narration keywords, and a false match DELETES a
 *     disallowance outright. This is the one that matters.
 *   • TDS netting — a legal position rather than a narration risk (the amount is
 *     corroborated by being a statutory rate of the bill), but it too removes
 *     value from the base, so it is quantified rather than assumed away.
 *
 * Each figure is produced by re-running the real computation under the varied
 * config, so a swing is a swing in the number that would actually be reported.
 */
export function classificationSensitivity(
  cy: VendorLedger,
  fy: VendorLedger | null,
  cfg: Msme43bConfig = DEFAULT_CONFIG,
  declaredGstRate?: number,
): SensitivityResult {
  const base = crossCheckVendor(cy, fy, cfg, declaredGstRate).disallowedCY;
  const led = [cy, fy];
  const components: SensitivityComponent[] = [];

  const writeOffEntries = entriesOfType(led, ['KASAR_VATAV', 'ROUND_OFF', 'DEBIT_NOTE', 'CREDIT_NOTE'], cfg);
  if (writeOffEntries.length) {
    const alt = crossCheckVendor(
      cy, fy,
      { ...cfg, kasarTreatment: 'cashTiming', roundOffTreatment: 'cashTiming', notesTreatment: 'cashTiming' },
      declaredGstRate,
    ).disallowedCY;
    components.push({
      label: 'Write-offs, discounts and notes',
      assumption: 'these extinguish the payable without a payment, so no date test applies',
      ifDateTested: r2(alt),
      swing: r2(alt - base),
      entries: writeOffEntries,
    });
  }

  if (cfg.netOfTds) {
    const tdsEntries = entriesOfType(led, ['TDS'], cfg);
    if (tdsEntries.length) {
      const alt = crossCheckVendor(cy, fy, { ...cfg, netOfTds: false }, declaredGstRate).disallowedCY;
      components.push({
        label: 'TDS netting',
        assumption: 'TDS discharges to the government, so it is not a sum payable to the vendor',
        ifDateTested: r2(alt),
        swing: r2(alt - base),
        entries: tdsEntries,
      });
    }
  }

  return {
    base: r2(base),
    components,
    maxSwing: components.length ? r2(Math.max(...components.map((c) => c.swing))) : 0,
  };
}

/**
 * The sensitivity stated as workpaper warnings. Only material swings are
 * reported: a component that moves the figure by less than the materiality
 * tolerance is noise, and printing it would train the reviewer to skip the
 * section that matters.
 */
export function sensitivityWarnings(s: SensitivityResult, cfg: Msme43bConfig): string[] {
  const out: string[] = [];
  for (const c of s.components) {
    if (c.swing <= cfg.toleranceRupees) continue;
    const sample = c.entries
      .slice(0, 3)
      .map((e) => `${e.date} "${e.particulars}" ₹${e.amount.toLocaleString('en-IN')}`)
      .join('; ');
    const more = c.entries.length > 3 ? ` (+${c.entries.length - 3} more)` : '';
    out.push(
      `Classification sensitivity — ${c.label}: ₹${c.swing.toLocaleString('en-IN')} of disallowance ` +
      `depends on the assumption that ${c.assumption}. Date-tested like ordinary payments, the ` +
      `disallowance would be ₹${c.ifDateTested.toLocaleString('en-IN')} instead of ` +
      `₹${s.base.toLocaleString('en-IN')}. Entries relied on: ${sample}${more}. ` +
      'The cross-check cannot detect a misread narration here — it classifies these the same way.',
    );
  }
  return out;
}
