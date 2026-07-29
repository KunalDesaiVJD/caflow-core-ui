// MSME 43B(h) — compare the tool's answer with the reviewer's answer.
//
// Pure arithmetic and name matching. No interpretation happens here: this
// module only says WHERE the two workings disagree and by how much. Deciding
// WHY — and whether a stated legal position explains it — is calibrate.ts's job.

import type { Msme43bReport } from './types';
import type { ExpectedWorking, ExpectedVendorRow } from './expected';

export type DiffStatus = 'match' | 'differs' | 'only-ours' | 'only-theirs';

export interface VendorDiff {
  vendorName: string;
  /** the reviewer's spelling, when it differs from ours */
  theirName?: string;
  ours: { disallowed: number; allowed: number; outstanding: number } | null;
  theirs: { disallowed: number; allowed?: number; outstanding?: number } | null;
  /** theirs − ours on the disallowance (the figure that hits the return) */
  delta: number;
  status: DiffStatus;
  /** true when the names were matched by similarity rather than exactly */
  fuzzyMatched?: boolean;
  note?: string;
}

export interface DiffResult {
  vendors: VendorDiff[];
  matched: number;
  differing: number;
  onlyOurs: number;
  onlyTheirs: number;
  /** Σ|delta| over every vendor — the search's tie-breaker */
  totalAbsDelta: number;
  /** their total − our total */
  totalDelta: number;
  ourTotal: number;
  theirTotal: number;
  /** matched ÷ comparable */
  matchRate: number;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Drop the noise words that make the same vendor look like two vendors. */
const NOISE = new Set([
  'the', 'm', 's', 'ms', 'mr', 'shri', 'messrs',
  'pvt', 'private', 'ltd', 'limited', 'llp', 'inc', 'co', 'company', 'corp',
  'and', 'sons', 'bros', 'brothers', 'industries', 'enterprise', 'enterprises',
  'traders', 'trading', 'agency', 'agencies', 'india',
]);

function tokens(s: string): string[] {
  return s.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t && !NOISE.has(t));
}

/** Jaccard similarity over significant tokens. */
function similarity(a: string, b: string): number {
  const ta = new Set(tokens(a));
  const tb = new Set(tokens(b));
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / (ta.size + tb.size - inter);
}

const FUZZY_THRESHOLD = 0.6;

/**
 * Match the reviewer's rows to ours: exact normalised name first, then a
 * similarity pass over what's left. A fuzzy match is flagged so the preparer
 * can see it was a judgement, not an identity.
 */
function pairUp(
  ourNames: string[],
  theirRows: ExpectedVendorRow[],
): { pairs: Array<{ our: string; their: ExpectedVendorRow; fuzzy: boolean }>; ourLeft: string[]; theirLeft: ExpectedVendorRow[] } {
  const pairs: Array<{ our: string; their: ExpectedVendorRow; fuzzy: boolean }> = [];
  const ourLeft = [...ourNames];
  const theirLeft = [...theirRows];

  // exact (normalised)
  for (let i = ourLeft.length - 1; i >= 0; i--) {
    const key = norm(ourLeft[i]);
    const j = theirLeft.findIndex((t) => norm(t.vendorName) === key);
    if (j >= 0) {
      pairs.push({ our: ourLeft[i], their: theirLeft[j], fuzzy: false });
      ourLeft.splice(i, 1);
      theirLeft.splice(j, 1);
    }
  }

  // best-similarity, greedy, highest score first
  const cands: Array<{ oi: number; ti: number; score: number }> = [];
  for (let oi = 0; oi < ourLeft.length; oi++) {
    for (let ti = 0; ti < theirLeft.length; ti++) {
      const score = similarity(ourLeft[oi], theirLeft[ti].vendorName);
      if (score >= FUZZY_THRESHOLD) cands.push({ oi, ti, score });
    }
  }
  cands.sort((a, b) => b.score - a.score);
  const usedO = new Set<number>(), usedT = new Set<number>();
  for (const c of cands) {
    if (usedO.has(c.oi) || usedT.has(c.ti)) continue;
    usedO.add(c.oi); usedT.add(c.ti);
    pairs.push({ our: ourLeft[c.oi], their: theirLeft[c.ti], fuzzy: true });
  }

  return {
    pairs,
    ourLeft: ourLeft.filter((_, i) => !usedO.has(i)),
    theirLeft: theirLeft.filter((_, i) => !usedT.has(i)),
  };
}

export function diffAgainstExpected(
  report: Msme43bReport,
  expected: ExpectedWorking,
  toleranceRupees = 1,
): DiffResult {
  const byName = new Map(report.vendors.map((v) => [v.vendorName, v]));
  const { pairs, ourLeft, theirLeft } = pairUp([...byName.keys()], expected.rows);

  const vendors: VendorDiff[] = [];

  for (const { our, their, fuzzy } of pairs) {
    const v = byName.get(our)!;
    const delta = round2(their.disallowedCY - v.totalDisallowedCY);
    vendors.push({
      vendorName: v.vendorName,
      theirName: fuzzy || their.vendorName !== v.vendorName ? their.vendorName : undefined,
      ours: { disallowed: v.totalDisallowedCY, allowed: v.totalAllowedFY, outstanding: v.totalStillOutstanding },
      theirs: { disallowed: their.disallowedCY, allowed: their.allowedFY, outstanding: their.stillOutstanding },
      delta,
      status: Math.abs(delta) <= toleranceRupees ? 'match' : 'differs',
      fuzzyMatched: fuzzy || undefined,
      note: their.note,
    });
  }

  for (const name of ourLeft) {
    const v = byName.get(name)!;
    vendors.push({
      vendorName: name,
      ours: { disallowed: v.totalDisallowedCY, allowed: v.totalAllowedFY, outstanding: v.totalStillOutstanding },
      theirs: null,
      delta: round2(-v.totalDisallowedCY),
      status: 'only-ours',
      note: 'Not present in your working.',
    });
  }

  for (const row of theirLeft) {
    vendors.push({
      vendorName: row.vendorName,
      ours: null,
      theirs: { disallowed: row.disallowedCY, allowed: row.allowedFY, outstanding: row.stillOutstanding },
      delta: round2(row.disallowedCY),
      status: 'only-theirs',
      note: 'In your working but not in the uploaded ledgers.',
    });
  }

  vendors.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  const matched = vendors.filter((v) => v.status === 'match').length;
  const differing = vendors.filter((v) => v.status === 'differs').length;
  const onlyOurs = vendors.filter((v) => v.status === 'only-ours').length;
  const onlyTheirs = vendors.filter((v) => v.status === 'only-theirs').length;
  const comparable = matched + differing + onlyOurs + onlyTheirs;

  const ourTotal = round2(report.vendors.reduce((a, v) => a + v.totalDisallowedCY, 0));
  const theirTotal = round2(expected.rows.reduce((a, r) => a + r.disallowedCY, 0));

  return {
    vendors, matched, differing, onlyOurs, onlyTheirs,
    totalAbsDelta: round2(vendors.reduce((a, v) => a + Math.abs(v.delta), 0)),
    totalDelta: round2(theirTotal - ourTotal),
    ourTotal, theirTotal,
    matchRate: comparable ? matched / comparable : 1,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
