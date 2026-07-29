// MSME 43B(h) — the RULE SPACE: every interpretation the engine is allowed to
// hold, and the guard rails that stop calibration turning into fudging.
//
// ─────────────────────────────────────────────────────────────────────────────
//  WHY THIS FILE EXISTS
// ─────────────────────────────────────────────────────────────────────────────
// The calibrator (calibrate.ts) is allowed to change how the tool interprets a
// ledger until its answer matches the reviewer's answer. That power is only
// safe if it is FENCED. Without a fence, "learning" degenerates into writing
// the expected number down and calling it a result.
//
// The fence has four parts, all enforced in code, not by convention:
//
//   1. CLOSED SET. A rule is one of the entries below and nothing else. Each
//      has a fixed, enumerated set of permitted values with a stated legal
//      basis. There is no free-form numeric knob anywhere in the space, so
//      there is no way to express "add ₹84,105 to this vendor".
//
//   2. NO AMOUNTS. Every value is a boolean, an enum string, or a day count
//      from a whitelist. assertNoAmountValued() proves this at test time. An
//      amount can therefore never enter the config, and the config is the ONLY
//      thing calibration produces.
//
//   3. GLOBAL, NOT PER-VENDOR. Rules apply to every vendor of the client. The
//      single exception is the s.15 window itself, which genuinely differs by
//      vendor in law (written agreement → up to 45 days, otherwise 15). That is
//      modelled as a DECLARATION about the vendor — binary, 15 or 45, confirmed
//      by a human, and printed on the workpaper — not as a free parameter.
//
//   4. NO ORACLE ACCESS. analyzeVendor()/buildReport() take ledgers and a
//      config. They never receive the reviewer's figures. Calibration searches
//      configs and reports which one fits best; it cannot reach into a result
//      and write a number.
//
// What this buys: when the tool is finally made to agree with the reviewer, the
// agreement is the consequence of a stated legal position applied to every
// vendor, which either holds up on the next client's data or visibly fails. It
// is not a memorised answer.

import { DEFAULT_CONFIG, PERMITTED_GST_RATES, type Msme43bConfig } from './config';

export type RuleValue = string | number | boolean;

export interface RuleOption {
  value: RuleValue;
  label: string;
  /** why a professional might take this position */
  basis: string;
}

export interface RuleDef {
  key: keyof Msme43bConfig;
  title: string;
  /** the statutory / practice question this rule answers */
  question: string;
  legalBasis: string;
  options: RuleOption[];
}

/**
 * The complete, closed set of interpretations the engine can hold.
 * Adding a rule here is a deliberate, reviewable act — the calibrator can only
 * ever propose what is listed.
 */
export const RULE_SPACE: RuleDef[] = [
  {
    key: 'windowDays',
    title: 'Payment window',
    question: 'How many days does s.15 allow before the sum becomes overdue?',
    legalBasis: 'S.15 MSMED Act 2006 — as agreed in writing, capped at 45 days; 15 days where there is no written agreement.',
    options: [
      { value: 45, label: '45 days', basis: 'Written agreement with the supplier (the statutory maximum).' },
      { value: 15, label: '15 days', basis: 'No written agreement — the default limit u/s 15.' },
    ],
  },
  {
    key: 'dayCountBasis',
    title: 'Day count',
    question: 'Does the invoice date itself count as the first day of the window?',
    legalBasis: 'S.15 read with s.9 General Clauses Act 1897 — the day from which a period runs is ordinarily excluded.',
    options: [
      { value: 'exclusive', label: 'Exclusive of invoice date', basis: 'Invoice date is day 0; bill + window is the last compliant day.' },
      { value: 'inclusive', label: 'Inclusive of invoice date', basis: 'Invoice date is day 1; the window closes one day earlier.' },
    ],
  },
  {
    key: 'acceptanceGraceDays',
    title: 'Clock start',
    question: 'Does the window run from the invoice date or from acceptance of the goods?',
    legalBasis: 'S.2(b) + s.15 MSMED Act — the period runs from the "day of acceptance"; deemed acceptance applies where no objection is raised within 15 days of delivery.',
    options: [
      { value: 0, label: 'From invoice date', basis: 'Invoice date taken as the day of acceptance (the usual position where no GRN data exists).' },
      { value: 7, label: 'Acceptance + 7 days', basis: 'Client\'s terms run from goods receipt, ordinarily about a week after invoice.' },
      { value: 15, label: 'Acceptance + 15 days', basis: 'Deemed acceptance under the proviso to s.2(b) where objection may be raised within 15 days.' },
    ],
  },
  {
    key: 'disallowanceBase',
    title: 'GST on the invoice',
    question: 'Is the disallowance stated on the taxable value, or on the whole invoice including GST?',
    legalBasis: 'S.43B(h) disallows a DEDUCTION. A registered buyer taking input tax credit never claims GST as a deduction — it sits in the input-tax ledger, not the profit and loss account — so there is nothing in the tax component for the section to disallow.',
    options: [
      { value: 'taxableValue', label: 'Taxable value only (exclude GST)', basis: 'Input credit is available, so GST was never claimed as a deduction and cannot be disallowed.' },
      { value: 'grossInvoice', label: 'Whole invoice including GST', basis: 'Credit is blocked u/s 17(5) CGST Act, or the buyer is unregistered / under composition, so the tax forms part of the cost and IS claimed as a deduction.' },
    ],
  },
  {
    key: 'netOfTds',
    title: 'TDS',
    question: 'Is the sum "payable" to the supplier taken net of tax deducted at source?',
    legalBasis: 'S.43B(h) applies to "any sum payable… to a micro or small enterprise". TDS is discharged to the Government, not withheld from the supplier.',
    options: [
      { value: true, label: 'Net of TDS', basis: 'Only the amount actually due to the supplier can be paid late.' },
      { value: false, label: 'Gross of TDS', basis: 'The whole invoice is the sum payable; TDS must clear within the window too.' },
    ],
  },
  {
    key: 'kasarTreatment',
    title: 'Kasar / vatav / discount',
    question: 'Is a kasar/vatav write-off a settlement whose date matters, or was that amount never payable?',
    legalBasis: 'Where the amount is waived or written back it ceases to be a "sum payable" — s.43B(h) has nothing to bite on.',
    options: [
      { value: 'nonCash', label: 'Never payable (compliant, any date)', basis: 'A waiver extinguishes the liability rather than discharging it late.' },
      { value: 'cashTiming', label: 'Settlement — date matters', basis: 'Treated like a payment: only compliant if booked within the window.' },
      { value: 'ignore', label: 'Not a settlement at all', basis: 'The write-off is left outstanding for 43B(h) until actually paid.' },
    ],
  },
  {
    key: 'notesTreatment',
    title: 'Credit / debit notes',
    question: 'Does a note reducing the payable count as compliant regardless of its date?',
    legalBasis: 'A return or rate adjustment reduces the sum payable at source rather than paying it late.',
    options: [
      { value: 'nonCash', label: 'Reduces the payable (compliant)', basis: 'The liability never crystallised to that extent.' },
      { value: 'cashTiming', label: 'Settlement — date matters', basis: 'The note is treated as discharging an existing liability on its date.' },
    ],
  },
  {
    key: 'roundOffTreatment',
    title: 'Round-off',
    question: 'How are round-off entries treated?',
    legalBasis: 'Materiality — immaterial residues are not a "sum payable" in any meaningful sense.',
    options: [
      { value: 'nonCash', label: 'Reduces the payable (compliant)', basis: 'Immaterial residue written off.' },
      { value: 'cashTiming', label: 'Settlement — date matters', basis: 'Treated like any other discharge.' },
      { value: 'ignore', label: 'Ignored entirely', basis: 'Left out of the matching altogether.' },
    ],
  },
  {
    key: 'advanceTreatment',
    title: 'Advances adjusted',
    question: 'Is an advance adjusted against a bill a payment on the adjustment date?',
    legalBasis: 'The money left the payer earlier; the entry records its appropriation to a bill.',
    options: [
      { value: 'cashTiming', label: 'Payment on the adjustment date', basis: 'The bill is discharged when the advance is appropriated to it.' },
      { value: 'nonCash', label: 'Always compliant', basis: 'Funds were with the supplier before the bill arose, so no delay is possible.' },
    ],
  },
  {
    key: 'contraTreatment',
    title: 'Journal set-off / contra',
    question: 'Does netting the payable against another ledger discharge it?',
    legalBasis: 'Set-off against a mutual debt discharges the liability on the date of the journal.',
    options: [
      { value: 'cashTiming', label: 'Discharge on the journal date', basis: 'Compliant only if the journal falls within the window.' },
      { value: 'nonCash', label: 'Always compliant', basis: 'Mutual set-off is not a payment obligation the section addresses.' },
      { value: 'ignore', label: 'Not a discharge', basis: 'The payable stands until settled in cash.' },
    ],
  },
  {
    key: 'allocation',
    title: 'Which bill a payment clears',
    question: 'The exports carry no bill-wise references — which open bill does a payment settle?',
    legalBasis: 'Interpretive. S.60 Indian Contract Act 1872 appropriates an unspecified payment to the earliest debt.',
    options: [
      { value: 'FIFO', label: 'Oldest bill first (FIFO)', basis: 'S.60 Contract Act default and ordinary trade practice.' },
      { value: 'LIFO', label: 'Newest bill first (LIFO)', basis: 'Where the client settles current bills and lets old ones run.' },
      { value: 'PRO_RATA', label: 'Proportionately across open bills', basis: 'Where payments are made on account against the running balance.' },
    ],
  },
  {
    key: 'includeOpeningBalance',
    title: 'Opening balance',
    question: 'Does the opening payable take part in the matching at all?',
    legalBasis: 'Practice — whether prior-year bills absorb this year\'s payments before current bills do.',
    options: [
      { value: true, label: 'Include in matching', basis: 'Payments clear the oldest outstanding first, including brought-forward bills.' },
      { value: false, label: 'Exclude from matching', basis: 'Only current-year bills are matched; opening is dealt with separately.' },
    ],
  },
  {
    key: 'openingDisallowance',
    title: 'Opening balance disallowance',
    question: 'Can a brought-forward payable be disallowed again in the current year?',
    legalBasis: 'S.43B(h) disallows a deduction claimed in the year of accrual; a prior-year accrual belongs to that year.',
    options: [
      { value: 'exclude', label: 'No — prior-year item', basis: 'The deduction was claimed in an earlier year, so the add-back belongs there.' },
      { value: 'include', label: 'Yes — test it again in CY', basis: 'Where the opening balance was never disallowed in the earlier year.' },
    ],
  },
  {
    key: 'toleranceRupees',
    title: 'Materiality',
    question: 'Below what value is a difference ignored?',
    legalBasis: 'Audit materiality — not a statutory concept.',
    options: [
      { value: 1, label: '₹1', basis: 'Near-exact.' },
      { value: 5, label: '₹5', basis: 'Ignores rounding noise only.' },
      { value: 100, label: '₹100', basis: 'Ignores small paise/round-off adjustments.' },
      { value: 1000, label: '₹1,000', basis: 'Client-level materiality for a large ledger.' },
    ],
  },
];

export const RULE_BY_KEY: Record<string, RuleDef> =
  Object.fromEntries(RULE_SPACE.map((r) => [r.key, r]));

/** The only per-vendor window values the law contemplates. */
export const PERMITTED_VENDOR_WINDOWS = [15, 45] as const;

// ────────────────────────────────────────────────────────────────────────────
//  Rule profile — the persisted interpretation for a client
// ────────────────────────────────────────────────────────────────────────────

export interface RuleChange {
  key: string;
  from: RuleValue;
  to: RuleValue;
  /** the professional reason recorded when the change was accepted */
  reason: string;
  at: string;
  by?: string;
  /** what the change did to agreement with the reviewer's working */
  matchedBefore?: number;
  matchedAfter?: number;
}

export interface VendorWindowDeclaration {
  /** normalised vendor name */
  key: string;
  vendorName: string;
  windowDays: number;
  /** 'agreement' = written agreement on file, 'none' = no agreement */
  basis: 'agreement' | 'none';
  declaredBy?: string;
  at: string;
}

/**
 * The GST rate a vendor charges. Used ONLY where the ledger does not show the
 * tax split, so the taxable value can be derived instead of the disallowance
 * being overstated by the tax. Like the window declaration this is a statement
 * of fact about the vendor, confirmed by a human and printed on the workpaper —
 * and it is constrained to the statutory rates so it cannot become a dial.
 */
export interface VendorGstDeclaration {
  key: string;
  vendorName: string;
  /** percentage: one of PERMITTED_GST_RATES */
  gstRate: number;
  declaredBy?: string;
  at: string;
}

export interface RuleProfile {
  clientId?: string;
  /** interpretations that differ from DEFAULT_CONFIG */
  overrides: Partial<Msme43bConfig>;
  /** declared per-vendor s.15 windows (see fence #3) */
  vendorWindows: VendorWindowDeclaration[];
  /** declared per-vendor GST rates (see fence #3) */
  vendorGstRates: VendorGstDeclaration[];
  revision: number;
  history: RuleChange[];
}

export function emptyProfile(clientId?: string): RuleProfile {
  return { clientId, overrides: {}, vendorWindows: [], vendorGstRates: [], revision: 0, history: [] };
}

/** Resolve a profile to the config the engine runs with. */
export function configFromProfile(profile: RuleProfile | null, base: Msme43bConfig = DEFAULT_CONFIG): Msme43bConfig {
  if (!profile) return base;
  return { ...base, ...profile.overrides };
}

/** Per-vendor window map in the shape buildReport expects. */
export function vendorWindowMap(profile: RuleProfile | null): Record<string, number> {
  if (!profile) return {};
  return Object.fromEntries(profile.vendorWindows.map((d) => [d.key, d.windowDays]));
}

/** Per-vendor GST rate map in the shape buildReport expects. */
export function vendorGstMap(profile: RuleProfile | null): Record<string, number> {
  if (!profile) return {};
  return Object.fromEntries((profile.vendorGstRates ?? []).map((d) => [d.key, d.gstRate]));
}

// ────────────────────────────────────────────────────────────────────────────
//  Guard rails
// ────────────────────────────────────────────────────────────────────────────

/**
 * Reject anything that is not a listed interpretation. Called before a profile
 * is saved AND before it is applied, so a hand-edited or tampered profile row
 * cannot smuggle a value the rule space never offered.
 */
export function validateProfile(profile: RuleProfile): string[] {
  const errors: string[] = [];

  for (const [key, value] of Object.entries(profile.overrides)) {
    const def = RULE_BY_KEY[key];
    if (!def) {
      errors.push(`"${key}" is not a rule in the rule space — refusing to apply it.`);
      continue;
    }
    if (!def.options.some((o) => o.value === value)) {
      errors.push(
        `${def.title}: "${String(value)}" is not one of the permitted positions ` +
        `(${def.options.map((o) => String(o.value)).join(', ')}) — refusing to apply it.`,
      );
    }
  }

  for (const d of profile.vendorGstRates ?? []) {
    if (!PERMITTED_GST_RATES.includes(d.gstRate as 0 | 5 | 12 | 18 | 28)) {
      errors.push(
        `${d.vendorName}: a declared GST rate of ${d.gstRate}% is not a statutory rate ` +
        `(${PERMITTED_GST_RATES.join(', ')}) — refusing to apply it.`,
      );
    }
  }

  for (const d of profile.vendorWindows) {
    if (!PERMITTED_VENDOR_WINDOWS.includes(d.windowDays as 15 | 45)) {
      errors.push(`${d.vendorName}: a declared window of ${d.windowDays} days is not permitted (only 15 or 45 u/s 15).`);
    }
    if (d.basis === 'agreement' && d.windowDays !== 45) {
      errors.push(`${d.vendorName}: a written agreement supports 45 days, not ${d.windowDays}.`);
    }
    if (d.basis === 'none' && d.windowDays !== 15) {
      errors.push(`${d.vendorName}: with no written agreement the limit is 15 days, not ${d.windowDays}.`);
    }
  }

  return errors;
}

/**
 * Structural proof that no rule can carry a monetary amount — the property that
 * makes "learning" incapable of memorising an answer. Asserted by the test
 * suite; also callable at runtime.
 *
 * Permitted value shapes: booleans, enumerated strings, and day counts /
 * materiality thresholds drawn from the whitelist below. Anything else — in
 * particular an arbitrary rupee figure — fails.
 */
const NUMERIC_WHITELIST: Record<string, number[]> = {
  windowDays: [15, 45],
  acceptanceGraceDays: [0, 7, 15],
  toleranceRupees: [1, 5, 100, 1000],
};

export function assertNoAmountValued(): string[] {
  const problems: string[] = [];
  for (const rule of RULE_SPACE) {
    if (rule.options.length === 0) problems.push(`${rule.key}: no options — an open-ended rule is not permitted.`);
    for (const opt of rule.options) {
      const t = typeof opt.value;
      if (t === 'boolean' || t === 'string') continue;
      if (t !== 'number') { problems.push(`${rule.key}: value of type ${t} is not a permitted rule shape.`); continue; }
      const allowed = NUMERIC_WHITELIST[rule.key as string];
      if (!allowed) problems.push(`${rule.key}: numeric rule is not on the whitelist — an unbounded number could encode an amount.`);
      else if (!allowed.includes(opt.value as number)) problems.push(`${rule.key}: ${opt.value} is outside the whitelisted values [${allowed.join(', ')}].`);
    }
  }
  return problems;
}

/** Human-readable description of a rule position, for the workpaper and the UI. */
export function describeRule(key: string, value: RuleValue): { title: string; position: string; basis: string } {
  const def = RULE_BY_KEY[key];
  if (!def) return { title: key, position: String(value), basis: '' };
  const opt = def.options.find((o) => o.value === value);
  return { title: def.title, position: opt?.label ?? String(value), basis: opt?.basis ?? '' };
}

/**
 * Every interpretation currently in force, defaults included — the assumptions
 * disclosure a reviewer signs off against.
 */
export function disclosedAssumptions(cfg: Msme43bConfig): Array<{ title: string; position: string; basis: string; question: string; isDefault: boolean }> {
  return RULE_SPACE.map((r) => {
    const value = cfg[r.key] as RuleValue;
    const opt = r.options.find((o) => o.value === value);
    return {
      title: r.title,
      question: r.question,
      position: opt?.label ?? String(value),
      basis: opt?.basis ?? r.legalBasis,
      isDefault: DEFAULT_CONFIG[r.key] === value,
    };
  });
}
