// 360° issue finder for 26AS vs Books.
//
// Matching answers "which lines agree". An auditor also needs to know what the
// disagreement MEANS and what else the two documents reveal: credit at risk
// under s.199, income that 26AS shows but the books may not, deductor
// defaults, PAN-related higher rates, duplicates, cut-off, and links that only
// a human should accept. Each check here is deterministic and cites the lines
// it is about, so the reviewer can jump straight to them.

import type { MatchPair, ReconOptions, ReconResult, TdsEntry } from './types';
import { daysBetween, fyOf, round2 } from './parseUtils';
import { deductorKeyOf } from './engine';

export type IssueSeverity = 'high' | 'medium' | 'low' | 'info';

export type IssueCategory =
  | 'credit_at_risk' | 'income' | 'deductor_default' | 'rate' | 'duplicate' | 'cut_off'
  | 'timing' | 'link' | 'data' | 'section';

export interface Issue {
  id: string;
  severity: IssueSeverity;
  category: IssueCategory;
  title: string;
  detail: string;
  /** ₹ affected, where one figure makes sense */
  amount?: number;
  /** what to do about it */
  action: string;
  entryIds?: string[];
  groupKey?: string;
}

export const CATEGORY_LABEL: Record<IssueCategory, string> = {
  credit_at_risk: 'TDS credit at risk',
  income: 'Income / turnover',
  deductor_default: 'Deductor default',
  rate: 'Rate / PAN',
  duplicate: 'Duplicate',
  cut_off: 'Cut-off / year',
  timing: 'Timing',
  link: 'Party link',
  data: 'Data quality',
  section: 'Section',
};

/**
 * Usual TDS rates by section (%, with PAN). 206AA (no / inoperative PAN)
 * pushes most of these to 20%. Only used to flag the unusual — never to
 * compute a liability.
 */
const NORMAL_RATES: Array<[RegExp, number[]]> = [
  [/^194C/i, [1, 2]],
  [/^194J/i, [2, 10]],
  [/^194I/i, [2, 10]],
  [/^194H/i, [2, 5]],
  [/^194A/i, [10]],
  [/^194Q/i, [0.1]],
  [/^194O/i, [0.1, 1]],
  [/^194D/i, [2, 5]],
  [/^194G/i, [2, 5]],
  [/^194R/i, [10]],
  [/^194T/i, [10]],
  [/^194M/i, [2, 5]],
  [/^194N/i, [2, 5]],
  [/^194LA/i, [10]],
  [/^194IA/i, [1]],
  [/^194IB/i, [2, 5]],
  [/^192/i, []],
];

const inr = (v: number) => new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(v);
const sum = (xs: TdsEntry[]) => round2(xs.reduce((s, e) => s + e.tds, 0));

export function findIssues(r: ReconResult, opt: ReconOptions, fy: string): Issue[] {
  const issues: Issue[] = [];
  const add = (i: Omit<Issue, 'id'>) => issues.push({ ...i, id: `${i.category}:${issues.length}` });
  const byId = new Map([...r.books, ...r.as26].map((e) => [e.id, e]));
  const matched = new Set(r.pairs.flatMap((p) => [...p.bookIds, ...p.asIds]));
  const tol = opt.totalTolerance;

  // ── party-level differences ────────────────────────────────────────────────
  for (const g of r.groups) {
    const name = g.deductorName ?? g.bookParties.join(', ');
    if (g.status === 'forced') continue;
    if (g.status === 'books_only') {
      add({
        severity: 'high', category: 'credit_at_risk', groupKey: g.key, amount: g.booksTotal,
        title: `${name}: TDS in books but deductor not in 26AS`,
        detail: `₹${inr(g.booksTotal)} booked in ${g.booksCount} line(s); nothing from this party appears in 26AS. Credit under s.199 is allowed only for TDS reflected in 26AS.`,
        action: 'Check whether the party deducted under another name / TAN (link it in Party mapping); otherwise ask the party for its TAN and to file or revise its TDS return quoting the correct PAN.',
        entryIds: g.openBookIds,
      });
      continue;
    }
    if (g.status === 'as_only') {
      add({
        severity: g.asTotal > 10000 ? 'high' : 'medium', category: 'income', groupKey: g.key, amount: g.asTotal,
        title: `${name}: in 26AS but not in the books`,
        detail: `${g.asCount} line(s), TDS ₹${inr(g.asTotal)} on ₹${inr(round2(r.as26.filter((e) => deductorKeyOf(e) === g.key).reduce((s, e) => s + (e.amountPaid ?? 0), 0)))} credited. The department sees this receipt; if it is not in the books it may be treated as unrecorded income.`,
        action: 'Confirm whether the income is booked under another party name (link it). If not, verify with the deductor: genuine income not recorded, or TDS wrongly quoted against this PAN (ask for a correction).',
        entryIds: g.openAsIds,
      });
      continue;
    }
    if (g.status === 'difference') {
      const books = g.diff > 0;
      add({
        severity: Math.abs(g.diff) > 5000 ? 'high' : 'medium',
        category: books ? 'credit_at_risk' : 'income',
        groupKey: g.key, amount: Math.abs(g.diff),
        title: `${name}: ${books ? 'books higher' : '26AS higher'} by ₹${inr(Math.abs(g.diff))}`,
        detail: `Books ₹${inr(g.booksTotal)} vs 26AS ₹${inr(g.asTotal)}; ${g.openBookIds.length} books and ${g.openAsIds.length} 26AS line(s) still open.`,
        action: books
          ? 'The excess cannot be claimed until it reflects in 26AS — follow up with the deductor (short filing, wrong PAN, pending quarter) or reverse the excess in the books.'
          : 'TDS reported exceeds what is booked: check for unbooked income / bills, or TDS booked to another ledger; book the difference or get the deductor to correct its return.',
        entryIds: [...g.openBookIds, ...g.openAsIds],
      });
    }
  }

  // ── deductor-side defaults ─────────────────────────────────────────────────
  const unbooked = r.as26.filter((e) => e.bookingStatus && e.bookingStatus !== 'F');
  if (unbooked.length) {
    add({
      severity: 'high', category: 'deductor_default', amount: sum(unbooked),
      title: `${unbooked.length} 26AS line(s) not finally booked (status U / P / O)`,
      detail: 'U = deductor\'s challan unmatched, P = provisional (government deductor), O = over-booked challan. Credit for these may be withheld at processing.',
      action: 'Ask each deductor to correct its challan details / file a correction statement before the return is processed.',
      entryIds: unbooked.map((e) => e.id),
    });
  }
  const shortDeposit = r.as26.filter((e) => e.tdsDeposited !== undefined && e.tdsDeposited + 0.5 < e.tds);
  if (shortDeposit.length) {
    const amt = round2(shortDeposit.reduce((s, e) => s + (e.tds - (e.tdsDeposited ?? 0)), 0));
    add({
      severity: 'high', category: 'deductor_default', amount: amt,
      title: `Deductor deposited less than it deducted on ${shortDeposit.length} line(s)`,
      detail: `Tax deducted exceeds TDS deposited by ₹${inr(amt)} in total.`,
      action: 'Credit is restricted to the amount deposited; take it up with the deductor(s).',
      entryIds: shortDeposit.map((e) => e.id),
    });
  }

  // ── rate / PAN ─────────────────────────────────────────────────────────────
  const highRate: TdsEntry[] = [];
  const oddRate: TdsEntry[] = [];
  for (const e of r.as26) {
    if (!e.amountPaid || e.amountPaid <= 0 || e.tds <= 0 || !e.section) continue;
    const rate = (e.tds / e.amountPaid) * 100;
    if (rate >= 19.5) { highRate.push(e); continue; }
    const rule = NORMAL_RATES.find(([re]) => re.test(e.section!.replace(/\s+/g, '')));
    if (!rule || !rule[1].length) continue;
    if (!rule[1].some((x) => Math.abs(rate - x) <= Math.max(0.05, x * 0.08))) oddRate.push(e);
  }
  if (highRate.length) {
    add({
      severity: 'high', category: 'rate', amount: sum(highRate),
      title: `${highRate.length} 26AS line(s) deducted at 20% or more`,
      detail: 'A rate of 20% usually means s.206AA was applied — the deductor did not have a valid PAN, or the PAN is inoperative (not linked with Aadhaar).',
      action: 'Check the PAN–Aadhaar link and that customers have the correct PAN on record; ask for refunds via the return and for future deductions at the normal rate.',
      entryIds: highRate.map((e) => e.id),
    });
  }
  if (oddRate.length) {
    add({
      severity: 'low', category: 'rate',
      title: `${oddRate.length} 26AS line(s) at an unusual rate for their section`,
      detail: oddRate.slice(0, 5).map((e) => `${e.party} ${e.section} ${((e.tds / (e.amountPaid || 1)) * 100).toFixed(2)}%`).join('; ') + (oddRate.length > 5 ? '…' : ''),
      action: 'Could be a lower-deduction certificate (s.197), a wrong section, or a partial-amount deduction — verify with the deductor where material.',
      entryIds: oddRate.map((e) => e.id),
    });
  }

  // ── sections ───────────────────────────────────────────────────────────────
  const sectionTotals = new Map<string, { paid: number; tds: number; n: number }>();
  for (const e of r.as26) {
    const s = (e.section || 'Unknown').toUpperCase();
    const t = sectionTotals.get(s) ?? { paid: 0, tds: 0, n: 0 };
    t.paid += e.amountPaid ?? 0; t.tds += e.tds; t.n++;
    sectionTotals.set(s, t);
  }
  if (sectionTotals.size) {
    add({
      severity: 'info', category: 'income', amount: round2([...sectionTotals.values()].reduce((s, t) => s + t.paid, 0)),
      title: 'Receipts reported in 26AS, by section — compare with books turnover',
      detail: [...sectionTotals.entries()].sort((a, b) => b[1].paid - a[1].paid)
        .map(([s, t]) => `${s}: ₹${inr(round2(t.paid))} credited, TDS ₹${inr(round2(t.tds))} (${t.n})`).join('; '),
      action: 'The gross amounts credited should not exceed the corresponding income (sales / professional fees / rent / interest) in the books; a shortfall indicates income not recorded or recorded in another year.',
    });
  }
  const multiSection = r.groups.filter((g) => new Set(r.as26.filter((e) => deductorKeyOf(e) === g.key).map((e) => e.section)).size > 1);
  if (multiSection.length) {
    add({
      severity: 'info', category: 'section',
      title: `${multiSection.length} deductor(s) deducted under more than one section`,
      detail: multiSection.slice(0, 6).map((g) => g.deductorName).join(', ') + (multiSection.length > 6 ? '…' : ''),
      action: 'Make sure each income stream (e.g. contract vs professional vs rent) is booked to the right head.',
    });
  }

  // ── duplicates ─────────────────────────────────────────────────────────────
  const dupes = (xs: TdsEntry[], key: (e: TdsEntry) => string) => {
    const seen = new Map<string, TdsEntry[]>();
    for (const e of xs) {
      if (!e.date) continue;
      const k = `${key(e)}|${e.tds.toFixed(2)}`;
      const list = seen.get(k) ?? [];
      list.push(e);
      seen.set(k, list);
    }
    const out: TdsEntry[][] = [];
    for (const list of seen.values()) {
      if (list.length < 2) continue;
      const sorted = [...list].sort((a, b) => (a.date! < b.date! ? -1 : 1));
      for (let i = 1; i < sorted.length; i++) {
        if ((daysBetween(sorted[i - 1].date, sorted[i].date) ?? 99) <= 3) out.push([sorted[i - 1], sorted[i]]);
      }
    }
    return out;
  };
  const bookDupes = dupes(r.books, (e) => e.party.toUpperCase());
  if (bookDupes.length) {
    add({
      severity: 'medium', category: 'duplicate', amount: round2(bookDupes.reduce((s, d) => s + d[1].tds, 0)),
      title: `${bookDupes.length} possible double booking(s) in the books`,
      detail: bookDupes.slice(0, 5).map(([a, b]) => `${a.party} ₹${inr(a.tds)} on ${a.date} and ${b.date}`).join('; ') + (bookDupes.length > 5 ? '…' : ''),
      action: 'Same party, same TDS within 3 days — check whether the TDS entry was passed twice (e.g. at invoice and again at receipt).',
      entryIds: bookDupes.flat().map((e) => e.id),
    });
  }
  const asDupes = dupes(r.as26, (e) => `${e.tan}|${e.section}`);
  if (asDupes.length) {
    add({
      severity: 'low', category: 'duplicate',
      title: `${asDupes.length} repeated line(s) in 26AS`,
      detail: 'Same deductor, section and TDS within 3 days. Often genuine (separate bills), sometimes a deductor filing the same deduction twice.',
      action: 'If the books show only one, confirm with the deductor; a duplicate in its return would otherwise be taxed as your income.',
      entryIds: asDupes.flat().map((e) => e.id),
    });
  }

  // ── cut-off / year ─────────────────────────────────────────────────────────
  const outB = r.books.filter((e) => e.date && fyOf(e.date) !== fy);
  const outA = r.as26.filter((e) => e.date && fyOf(e.date) !== fy);
  if (outB.length) {
    add({
      severity: 'medium', category: 'cut_off', amount: sum(outB),
      title: `${outB.length} books line(s) dated outside FY ${fy}`,
      detail: 'Usually the ledger export covered a wider period, or entries were back / forward dated.',
      action: 'Export the ledger for the FY only, or confirm these belong to this year\'s claim.',
      entryIds: outB.map((e) => e.id),
    });
  }
  if (outA.length) {
    add({
      severity: 'medium', category: 'cut_off', amount: sum(outA),
      title: `${outA.length} 26AS line(s) dated outside FY ${fy}`,
      detail: 'Check that the 26AS downloaded is for the same FY as the ledger.',
      action: 'Download 26AS for the right assessment year.',
      entryIds: outA.map((e) => e.id),
    });
  }
  const crossYear = r.pairs.filter((p) => {
    const fyB = new Set(p.bookIds.map((id) => fyOf(byId.get(id)?.date ?? null)));
    const fyA = new Set(p.asIds.map((id) => fyOf(byId.get(id)?.date ?? null)));
    return [...fyB].some((x) => x && ![...fyA].includes(x));
  });
  if (crossYear.length) {
    add({
      severity: 'medium', category: 'cut_off', amount: round2(crossYear.reduce((s, p) => s + p.asAmount, 0)),
      title: `${crossYear.length} match(es) straddle the year end`,
      detail: 'The books and 26AS put the same TDS in different financial years — the income may be in the wrong year on one side.',
      action: 'Verify the year of the underlying income; TDS credit follows the year in which the income is offered (Rule 37BA).',
      entryIds: crossYear.flatMap((p) => [...p.bookIds, ...p.asIds]),
    });
  }
  const q4Open = r.books.filter((e) => !matched.has(e.id) && e.date && +e.date.slice(5, 7) <= 3 && fyOf(e.date) === fy);
  if (q4Open.length) {
    add({
      severity: 'low', category: 'timing', amount: sum(q4Open),
      title: `${q4Open.length} open books line(s) from Q4 (Jan–Mar)`,
      detail: 'Q4 TDS returns are due by 31 May; if 26AS was downloaded before deductors filed, these will appear later.',
      action: 'Re-download 26AS after mid-June and re-run before claiming.',
      entryIds: q4Open.map((e) => e.id),
    });
  }
  const farDates = r.pairs.filter((p) => (p.dayGap ?? 0) > 60 && p.type !== 'forced' && p.type !== 'grouped');
  if (farDates.length) {
    add({
      severity: 'low', category: 'timing',
      title: `${farDates.length} match(es) more than 60 days apart`,
      detail: 'Same amount, but the books and 26AS dates are far apart — possibly a different transaction with the same TDS.',
      action: 'Review these pairs in the Entry-wise tab; unmatch manually if they are different transactions.',
      entryIds: farDates.flatMap((p) => [...p.bookIds, ...p.asIds]),
    });
  }

  // ── links that need a human ────────────────────────────────────────────────
  const weak = r.links.filter((l) => l.method === 'total' || l.method === 'ai' || (l.method === 'fuzzy' && l.confidence < 85));
  if (weak.length) {
    add({
      severity: 'medium', category: 'link',
      title: `${weak.length} party link(s) need your confirmation`,
      detail: weak.slice(0, 5).map((l) => l.reason).join(' | ') + (weak.length > 5 ? '…' : ''),
      action: 'Open Party mapping and confirm or change each link — a wrong link moves TDS from one party to another.',
    });
  }
  const crossParty = r.pairs.filter((p) => p.type === 'cross_party');
  if (crossParty.length) {
    add({
      severity: 'medium', category: 'link', amount: round2(crossParty.reduce((s, p) => s + p.booksAmount, 0)),
      title: `${crossParty.length} TDS line(s) booked under a different party`,
      detail: crossParty.slice(0, 4).map((p) => p.note).join(' | '),
      action: 'Correct the party in the books (or link the two names) so the party-wise ledger and confirmations agree.',
      entryIds: crossParty.flatMap((p) => [...p.bookIds, ...p.asIds]),
    });
  }
  const bigDiff = r.pairs.filter((p: MatchPair) => p.type === 'amount_diff');
  if (bigDiff.length) {
    add({
      severity: 'low', category: 'credit_at_risk', amount: round2(bigDiff.reduce((s, p) => s + Math.abs(p.diff), 0)),
      title: `${bigDiff.length} line(s) paired with a different amount`,
      detail: 'Books and 26AS agree on party and date but not the amount — rate difference, partial deduction or a typing error.',
      action: 'Correct the books to the 26AS figure, or obtain the deductor\'s working.',
      entryIds: bigDiff.flatMap((p) => [...p.bookIds, ...p.asIds]),
    });
  }

  // ── data quality ───────────────────────────────────────────────────────────
  const noDate = [...r.books, ...r.as26].filter((e) => !e.date);
  if (noDate.length) {
    add({
      severity: 'low', category: 'data', title: `${noDate.length} line(s) without a readable date`,
      detail: 'These can only be matched on amount and period totals.', action: 'Check the export\'s date column.',
      entryIds: noDate.map((e) => e.id),
    });
  }
  const negB = r.books.filter((e) => e.tds < 0 && !matched.has(e.id));
  if (negB.length) {
    add({
      severity: 'low', category: 'data', amount: sum(negB),
      title: `${negB.length} unmatched reversal(s) in the books`,
      detail: 'Credit entries reducing TDS that pair with nothing in 26AS.',
      action: 'Confirm the reversal is correct (credit note / bill cancelled) and that the deductor also revised its return.',
      entryIds: negB.map((e) => e.id),
    });
  }
  const roundOpen = r.books.filter((e) => !matched.has(e.id) && e.tds >= 1000 && e.tds % 1000 === 0);
  if (roundOpen.length >= 2) {
    add({
      severity: 'low', category: 'data', amount: sum(roundOpen),
      title: `${roundOpen.length} open books line(s) in round thousands`,
      detail: 'Round TDS figures that match nothing often mean an estimate or provision rather than an actual deduction.',
      action: 'Obtain the TDS certificate (Form 16A) or reverse the estimate.',
      entryIds: roundOpen.map((e) => e.id),
    });
  }

  // concentration: which parties explain the difference
  const diffParties = r.groups.filter((g) => Math.abs(g.diff) > tol && g.status !== 'forced').sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
  if (diffParties.length > 3) {
    const totalAbs = diffParties.reduce((s, g) => s + Math.abs(g.diff), 0);
    let acc = 0; const top: string[] = [];
    for (const g of diffParties) { acc += Math.abs(g.diff); top.push(g.deductorName ?? g.bookParties[0]); if (acc >= totalAbs * 0.8) break; }
    add({
      severity: 'info', category: 'credit_at_risk',
      title: `${top.length} of ${diffParties.length} parties explain 80% of the differences`,
      detail: top.join(', '),
      action: 'Start the follow-up with these parties.',
    });
  }

  const rank: Record<IssueSeverity, number> = { high: 0, medium: 1, low: 2, info: 3 };
  return issues.sort((a, b) => rank[a.severity] - rank[b.severity] || (b.amount ?? 0) - (a.amount ?? 0));
}

/** Compact facts for the AI reviewer — no line-level personal data beyond names and totals. */
export function reviewPayload(r: ReconResult, issues: Issue[], fy: string) {
  return {
    fy,
    totals: r.totals,
    parties: r.groups.slice(0, 60).map((g) => ({
      deductor: g.deductorName, tan: g.tan, books_parties: g.bookParties, books: g.booksTotal, as26: g.asTotal, diff: g.diff,
      status: g.status, open_books: g.openBookIds.length, open_26as: g.openAsIds.length, link: g.link?.method, unbooked: g.unbookedAs,
    })),
    match_types: Object.entries(r.pairs.reduce<Record<string, number>>((m, p) => { m[p.type] = (m[p.type] || 0) + 1; return m; }, {})),
    issues: issues.map((i) => ({ severity: i.severity, category: i.category, title: i.title, detail: i.detail.slice(0, 400), amount: i.amount })),
  };
}
