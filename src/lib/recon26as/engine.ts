// 26AS vs Books — the matching engine. Pure and deterministic: the same
// inputs and the same reviewer decisions always give the same result, so the
// page recomputes from scratch on every change instead of patching state.
//
// Two levels, as an auditor works:
//
//   1. PARTY: which books party is which 26AS deductor. TAN when the ledger
//      has it, then names (with proprietor / firm aliases), then — for names
//      that share nothing, the proprietor-vs-trade-name case — equal TDS
//      totals, then the AI pass, and always the reviewer's own link.
//
//   2. ENTRY: inside each linked party, lines are paired in passes from the
//      strictest to the loosest, so a loose rule can never take a line a
//      strict one would have matched:
//         exact → same amount, near date → rounding → one-to-many →
//         month / quarter totals → same amount, far date → amount differs
//      then lines still open are tried against OTHER parties (TDS booked
//      under the wrong customer).
//
// Reviewer decisions — manual matches, force matches, links — are inputs,
// re-applied on every run.

import type {
  ManualMatch, MatchPair, MatchType, PartyGroup, PartyLink, ReconOptions,
  ReconOverrides, ReconResult, TdsEntry,
} from './types';
import { nameSimilarity, partyKey } from './names';
import { daysBetween, monthOf, quarterOf, round2 } from './parseUtils';

const AMT_EPS = 0.005;

/** Give every entry a stable id — call once per side after parsing. */
export function indexEntries(entries: TdsEntry[], side: 'books' | '26as'): TdsEntry[] {
  const p = side === 'books' ? 'B' : 'A';
  return entries.map((e, i) => ({ ...e, side, id: `${p}${i + 1}` }));
}

export const deductorKeyOf = (e: TdsEntry) => e.tan || `N:${partyKey(e.party)}`;
export const bookKeyOf = (e: TdsEntry) => partyKey(e.party);

export interface PartySummary {
  key: string;
  name: string;
  tan?: string;
  total: number;
  count: number;
}

function summarise(entries: TdsEntry[], keyOf: (e: TdsEntry) => string): Map<string, PartySummary> {
  const m = new Map<string, PartySummary>();
  for (const e of entries) {
    const k = keyOf(e);
    const s = m.get(k) ?? { key: k, name: e.party, tan: e.tan, total: 0, count: 0 };
    s.total = round2(s.total + e.tds);
    s.count++;
    if (!s.tan && e.tan) s.tan = e.tan;
    m.set(k, s);
  }
  return m;
}

export const bookParties = (books: TdsEntry[]) => summarise(books, bookKeyOf);
export const deductors = (as26: TdsEntry[]) => summarise(as26, deductorKeyOf);

const totalsAgree = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

/**
 * Automatic party links. Deterministic; the AI and the reviewer only ever
 * fill or override what this leaves.
 */
export function autoLinkParties(books: TdsEntry[], as26: TdsEntry[], tol = 1): PartyLink[] {
  const bp = [...bookParties(books).values()];
  const dd = [...deductors(as26).values()];
  const links: PartyLink[] = [];
  const linkedBook = new Set<string>();
  const linkedDed = new Map<string, number>(); // deductor → best score that took it

  // TAN, when the ledger carries it
  const byTan = new Map(dd.filter((d) => d.tan).map((d) => [d.tan!, d]));
  for (const b of bp) {
    const d = b.tan ? byTan.get(b.tan) : undefined;
    if (d) {
      links.push({ bookKey: b.key, deductorKey: d.key, method: 'tan', confidence: 100, reason: `Same TAN ${d.tan}` });
      linkedBook.add(b.key);
      linkedDed.set(d.key, 1);
    }
  }

  // names
  type Cand = { b: PartySummary; d: PartySummary; score: number; via: string | null; agree: boolean };
  const cands: Cand[] = [];
  for (const b of bp) {
    if (linkedBook.has(b.key)) continue;
    for (const d of dd) {
      const { score, via } = nameSimilarity(b.name, d.name);
      const agree = totalsAgree(b.total, d.total, Math.max(tol, Math.abs(d.total) * 0.02));
      if (score >= 0.75 || (score >= 0.55 && agree)) cands.push({ b, d, score: score + (agree ? 0.05 : 0), via, agree });
    }
  }
  cands.sort((x, y) => y.score - x.score);
  for (const c of cands) {
    if (linkedBook.has(c.b.key)) continue;
    const prev = linkedDed.get(c.d.key);
    // a deductor may carry several books parties only on near-identical names
    if (prev !== undefined && (prev < 0.92 || c.score < 0.92)) continue;
    const strong = c.score >= 0.92;
    links.push({
      bookKey: c.b.key,
      deductorKey: c.d.key,
      method: strong ? (c.via ? 'alias' : 'exact') : 'fuzzy',
      confidence: Math.min(99, Math.round(c.score * 100)),
      reason: strong
        ? (c.via ? `Name matches via ${c.via}` : 'Same name')
        : `Similar names (${Math.round(c.score * 100)}%)${c.agree ? ', TDS totals agree' : ''}${c.via ? ` via ${c.via}` : ''}`,
    });
    linkedBook.add(c.b.key);
    linkedDed.set(c.d.key, Math.max(prev ?? 0, c.score));
  }

  // equal totals, names unrelated — proprietor vs trade name
  const openB = bp.filter((b) => !linkedBook.has(b.key) && Math.abs(b.total) > tol);
  const openD = dd.filter((d) => !linkedDed.has(d.key) && Math.abs(d.total) > tol);
  for (const b of openB) {
    const hits = openD.filter((d) => totalsAgree(b.total, d.total, tol));
    if (hits.length !== 1) continue;
    const d = hits[0];
    const rivals = openB.filter((x) => totalsAgree(x.total, d.total, tol));
    if (rivals.length !== 1 || linkedDed.has(d.key)) continue;
    links.push({
      bookKey: b.key,
      deductorKey: d.key,
      method: 'total',
      confidence: 60,
      reason: `Names differ but TDS totals agree exactly (₹${d.total.toLocaleString('en-IN')}) — typical of a proprietor in 26AS against the firm name in the books. Please verify.`,
    });
    linkedBook.add(b.key);
    linkedDed.set(d.key, 0.6);
  }
  return links;
}

/** Auto links, then AI links for what is still open, then the reviewer's own. */
export function resolveLinks(auto: PartyLink[], ai: PartyLink[], manual: Record<string, string>, as26: TdsEntry[]): PartyLink[] {
  const dedKeys = new Set(as26.map(deductorKeyOf));
  const out = new Map<string, PartyLink>();
  for (const l of auto) out.set(l.bookKey, l);
  for (const l of ai) if (!out.has(l.bookKey) && dedKeys.has(l.deductorKey)) out.set(l.bookKey, l);
  for (const [bookKey, dedKey] of Object.entries(manual)) {
    if (!dedKey) { out.delete(bookKey); continue; }
    if (dedKeys.has(dedKey)) out.set(bookKey, { bookKey, deductorKey: dedKey, method: 'manual', confidence: 100, reason: 'Linked by reviewer' });
  }
  return [...out.values()];
}

// ── entry matching ──────────────────────────────────────────────────────────

interface Pools { b: TdsEntry[]; a: TdsEntry[] }

const sum = (xs: TdsEntry[]) => round2(xs.reduce((s, e) => s + e.tds, 0));

function makePair(type: MatchType, bs: TdsEntry[], as: TdsEntry[], groupKey: string, note?: string): MatchPair {
  let gap: number | null = null;
  for (const b of bs) for (const a of as) {
    const g = daysBetween(b.date, a.date);
    if (g !== null) gap = Math.max(gap ?? 0, g);
  }
  const booksAmount = sum(bs), asAmount = sum(as);
  return {
    id: `${type}:${bs.map((e) => e.id).join(',')}|${as.map((e) => e.id).join(',')}`,
    type,
    bookIds: bs.map((e) => e.id),
    asIds: as.map((e) => e.id),
    booksAmount,
    asAmount,
    diff: round2(booksAmount - asAmount),
    dayGap: gap,
    groupKey,
    note,
  };
}

/** Greedy one-to-one pairing by lowest cost. */
function pairOneToOne(
  pools: Pools,
  cost: (b: TdsEntry, a: TdsEntry) => number | null,
  type: MatchType,
  groupKey: string,
  out: MatchPair[],
) {
  const cands: Array<{ b: TdsEntry; a: TdsEntry; c: number }> = [];
  for (const b of pools.b) for (const a of pools.a) {
    const c = cost(b, a);
    if (c !== null) cands.push({ b, a, c });
  }
  cands.sort((x, y) => x.c - y.c || x.b.id.localeCompare(y.b.id) || x.a.id.localeCompare(y.a.id));
  const usedB = new Set<string>(), usedA = new Set<string>();
  for (const { b, a } of cands) {
    if (usedB.has(b.id) || usedA.has(a.id)) continue;
    usedB.add(b.id); usedA.add(a.id);
    out.push(makePair(type, [b], [a], groupKey));
  }
  pools.b = pools.b.filter((e) => !usedB.has(e.id));
  pools.a = pools.a.filter((e) => !usedA.has(e.id));
}

/** Subset of `cands` (≤ maxSize items) whose TDS sums to target within tol. */
function findSubset(cands: TdsEntry[], target: number, tol: number, maxSize = 4): TdsEntry[] | null {
  const xs = cands.slice(0, 16);
  let found: TdsEntry[] | null = null;
  const walk = (start: number, picked: TdsEntry[], total: number) => {
    if (found) return;
    if (picked.length >= 2 && Math.abs(total - target) <= tol) { found = [...picked]; return; }
    if (picked.length === maxSize) return;
    for (let i = start; i < xs.length && !found; i++) {
      picked.push(xs[i]);
      walk(i + 1, picked, total + xs[i].tds);
      picked.pop();
    }
  };
  walk(0, [], 0);
  return found;
}

function pairOneToMany(pools: Pools, opt: ReconOptions, groupKey: string, out: MatchPair[]) {
  const near = (x: TdsEntry, y: TdsEntry) => {
    const g = daysBetween(x.date, y.date);
    return g === null || g <= opt.dateWindowDays;
  };
  const byGap = (x: TdsEntry) => (y: TdsEntry, z: TdsEntry) =>
    (daysBetween(x.date, y.date) ?? 0) - (daysBetween(x.date, z.date) ?? 0);

  // one books line = several 26AS lines (a quarter's TDS booked once), and the reverse
  for (const dir of ['b', 'a'] as const) {
    const ones = [...(dir === 'b' ? pools.b : pools.a)].sort((x, y) => Math.abs(y.tds) - Math.abs(x.tds));
    for (const one of ones) {
      const others = dir === 'b' ? pools.a : pools.b;
      if (!(dir === 'b' ? pools.b : pools.a).some((e) => e.id === one.id)) continue;
      const cands = others.filter((o) => near(one, o) && Math.sign(o.tds) === Math.sign(one.tds) && Math.abs(o.tds) <= Math.abs(one.tds) + opt.roundingTolerance).sort(byGap(one));
      const sub = findSubset(cands, one.tds, opt.roundingTolerance);
      if (!sub) continue;
      const ids = new Set(sub.map((e) => e.id));
      if (dir === 'b') {
        out.push(makePair('grouped', [one], sub, groupKey, `1 books line = ${sub.length} 26AS lines`));
        pools.b = pools.b.filter((e) => e.id !== one.id);
        pools.a = pools.a.filter((e) => !ids.has(e.id));
      } else {
        out.push(makePair('grouped', sub, [one], groupKey, `${sub.length} books lines = 1 26AS line`));
        pools.a = pools.a.filter((e) => e.id !== one.id);
        pools.b = pools.b.filter((e) => !ids.has(e.id));
      }
    }
  }
}

function pairByPeriod(pools: Pools, period: (d: string | null) => string, label: string, opt: ReconOptions, groupKey: string, out: MatchPair[]) {
  const keys = new Set([...pools.b, ...pools.a].map((e) => period(e.date)));
  for (const k of keys) {
    if (k === 'nodate') continue;
    const bs = pools.b.filter((e) => period(e.date) === k);
    const as = pools.a.filter((e) => period(e.date) === k);
    if (!bs.length || !as.length || bs.length + as.length < 3) continue;
    if (Math.abs(sum(bs) - sum(as)) > opt.roundingTolerance) continue;
    out.push(makePair('grouped', bs, as, groupKey, `${label} ${k} totals agree`));
    const bi = new Set(bs.map((e) => e.id)), ai = new Set(as.map((e) => e.id));
    pools.b = pools.b.filter((e) => !bi.has(e.id));
    pools.a = pools.a.filter((e) => !ai.has(e.id));
  }
}

function matchGroup(pools: Pools, opt: ReconOptions, groupKey: string, out: MatchPair[]) {
  const gap = (b: TdsEntry, a: TdsEntry) => daysBetween(b.date, a.date);
  const sameAmt = (b: TdsEntry, a: TdsEntry) => Math.abs(b.tds - a.tds) <= AMT_EPS;

  pairOneToOne(pools, (b, a) => (sameAmt(b, a) && b.date && b.date === a.date ? 0 : null), 'exact', groupKey, out);
  pairOneToOne(pools, (b, a) => {
    const g = gap(b, a);
    return sameAmt(b, a) && (g === null || g <= opt.dateWindowDays) ? g ?? opt.dateWindowDays : null;
  }, 'date_diff', groupKey, out);
  pairOneToOne(pools, (b, a) => {
    const g = gap(b, a);
    const d = Math.abs(b.tds - a.tds);
    return d <= opt.roundingTolerance && (g === null || g <= opt.dateWindowDays) ? (g ?? opt.dateWindowDays) + d : null;
  }, 'rounding', groupKey, out);
  pairOneToMany(pools, opt, groupKey, out);
  pairByPeriod(pools, monthOf, 'Month', opt, groupKey, out);
  pairByPeriod(pools, quarterOf, 'Quarter', opt, groupKey, out);
  pairOneToOne(pools, (b, a) => (Math.abs(b.tds - a.tds) <= opt.roundingTolerance ? gap(b, a) ?? 9999 : null), 'amount_only', groupKey, out);
  pairOneToOne(pools, (b, a) => {
    const g = gap(b, a);
    const base = Math.max(Math.abs(b.tds), Math.abs(a.tds));
    const pct = base ? (Math.abs(b.tds - a.tds) / base) * 100 : 0;
    if (Math.sign(b.tds) !== Math.sign(a.tds) || pct > opt.amountDiffPct) return null;
    if (g !== null && g > opt.dateWindowDays) return null;
    return pct * 10 + (g ?? opt.dateWindowDays);
  }, 'amount_diff', groupKey, out);
}

export function reconcile(
  books: TdsEntry[],
  as26: TdsEntry[],
  links: PartyLink[],
  overrides: ReconOverrides,
  opt: ReconOptions,
): ReconResult {
  const ded = deductors(as26);
  const bp = bookParties(books);
  const linkOf = new Map(links.map((l) => [l.bookKey, l]));

  const groupKeyOfBook = (e: TdsEntry) => {
    const l = linkOf.get(bookKeyOf(e));
    return l ? l.deductorKey : `B:${bookKeyOf(e)}`;
  };
  const groupOf = new Map<string, string>();
  for (const e of books) groupOf.set(e.id, groupKeyOfBook(e));
  for (const e of as26) groupOf.set(e.id, deductorKeyOf(e));

  const pairs: MatchPair[] = [];
  const byId = new Map([...books, ...as26].map((e) => [e.id, e]));
  const taken = new Set<string>();

  // reviewer's manual matches first
  for (const m of overrides.manual as ManualMatch[]) {
    const bs = m.bookIds.map((id) => byId.get(id)).filter((e): e is TdsEntry => !!e && !taken.has(e.id));
    const as = m.asIds.map((id) => byId.get(id)).filter((e): e is TdsEntry => !!e && !taken.has(e.id));
    if (!bs.length && !as.length) continue;
    const gk = groupOf.get((bs[0] ?? as[0]).id)!;
    const p = makePair('manual', bs, as, gk, m.note);
    p.id = `manual:${m.id}`;
    pairs.push(p);
    [...bs, ...as].forEach((e) => taken.add(e.id));
  }

  // per group
  const groupKeys = new Set([...groupOf.values()]);
  const leftovers = new Map<string, Pools>();
  for (const gk of groupKeys) {
    const pools: Pools = {
      b: books.filter((e) => !taken.has(e.id) && groupOf.get(e.id) === gk),
      a: as26.filter((e) => !taken.has(e.id) && groupOf.get(e.id) === gk),
    };
    if (pools.b.length && pools.a.length) matchGroup(pools, opt, gk, pairs);
    leftovers.set(gk, pools);
  }

  // force matches on agreed totals
  const forced = new Set(overrides.forced);
  for (const gk of forced) {
    const pools = leftovers.get(gk);
    if (!pools || (!pools.b.length && !pools.a.length)) continue;
    pairs.push(makePair('forced', pools.b, pools.a, gk, 'Force matched — party totals agree'));
    leftovers.set(gk, { b: [], a: [] });
  }

  // TDS booked under another party: same amount, near date, across groups
  // (bucketed by amount so a large file does not compare every line with every line)
  const cents = (e: TdsEntry) => Math.round(e.tds * 100);
  const buckets = new Map<number, Pools>();
  for (const p of leftovers.values()) {
    for (const e of p.b) { const k = cents(e); if (!buckets.has(k)) buckets.set(k, { b: [], a: [] }); buckets.get(k)!.b.push(e); }
    for (const e of p.a) { const k = cents(e); if (!buckets.has(k)) buckets.set(k, { b: [], a: [] }); buckets.get(k)!.a.push(e); }
  }
  const crossPairs: MatchPair[] = [];
  for (const pools of buckets.values()) {
    if (!pools.b.length || !pools.a.length) continue;
    pairOneToOne(pools, (b, a) => {
      if (groupOf.get(b.id) === groupOf.get(a.id)) return null;
      const g = daysBetween(b.date, a.date);
      return g !== null && g <= Math.min(7, opt.dateWindowDays) ? g : null;
    }, 'cross_party', '', crossPairs);
  }
  for (const p of crossPairs) {
    const b = byId.get(p.bookIds[0])!, a = byId.get(p.asIds[0])!;
    p.groupKey = groupOf.get(a.id)!;
    p.note = `Booked under "${b.party}" in the books, deducted by "${a.party}" in 26AS`;
    pairs.push(p);
  }

  // groups
  const matched = new Set(pairs.flatMap((p) => [...p.bookIds, ...p.asIds]));
  const groups: PartyGroup[] = [];
  for (const gk of groupKeys) {
    const gb = books.filter((e) => groupOf.get(e.id) === gk);
    const ga = as26.filter((e) => groupOf.get(e.id) === gk);
    const d = ded.get(gk);
    const parties = [...new Set(gb.map((e) => bp.get(bookKeyOf(e))!.name))];
    const booksTotal = sum(gb), asTotal = sum(ga);
    const diff = round2(booksTotal - asTotal);
    const openBookIds = gb.filter((e) => !matched.has(e.id)).map((e) => e.id);
    const openAsIds = ga.filter((e) => !matched.has(e.id)).map((e) => e.id);
    const agree = Math.abs(diff) <= opt.totalTolerance;
    const isForced = forced.has(gk) && pairs.some((p) => p.type === 'forced' && p.groupKey === gk);
    const status: PartyGroup['status'] =
      isForced ? 'forced'
        : !ga.length && !d ? 'books_only'
          : !gb.length ? (agree ? 'matched' : 'as_only')
            : agree && !openBookIds.length && !openAsIds.length ? 'matched'
              : agree ? 'total_match' : 'difference';
    const firstBook = gb[0] ? linkOf.get(bookKeyOf(gb[0])) ?? null : null;
    groups.push({
      key: gk,
      deductorName: d?.name ?? null,
      tan: d?.tan ?? null,
      bookParties: parties,
      link: firstBook,
      booksTotal,
      asTotal,
      diff,
      booksCount: gb.length,
      asCount: ga.length,
      matchedBooks: gb.length - openBookIds.length,
      matchedAs: ga.length - openAsIds.length,
      openBookIds,
      openAsIds,
      status: status === 'matched' && !gb.length && !ga.length ? 'matched' : status,
      unbookedAs: ga.filter((e) => e.bookingStatus && e.bookingStatus !== 'F').length,
    });
  }
  const rank: Record<PartyGroup['status'], number> = { difference: 0, as_only: 1, books_only: 2, total_match: 3, forced: 4, matched: 5 };
  groups.sort((x, y) => rank[x.status] - rank[y.status] || Math.abs(y.diff) - Math.abs(x.diff) || (x.deductorName ?? x.bookParties[0] ?? '').localeCompare(y.deductorName ?? y.bookParties[0] ?? ''));

  const tb = sum(books), ta = sum(as26);
  return {
    groups,
    pairs,
    books,
    as26,
    links,
    totals: {
      books: tb,
      as26: ta,
      diff: round2(tb - ta),
      matchedBooks: books.filter((e) => matched.has(e.id)).length,
      matchedAs: as26.filter((e) => matched.has(e.id)).length,
      openBooks: books.filter((e) => !matched.has(e.id)).length,
      openAs: as26.filter((e) => !matched.has(e.id)).length,
    },
  };
}

export const MATCH_LABEL: Record<MatchType, string> = {
  exact: 'Exact',
  date_diff: 'Date differs',
  rounding: 'Rounding',
  amount_diff: 'Amount differs',
  grouped: 'Grouped',
  amount_only: 'Amount only (date far)',
  cross_party: 'Other party',
  manual: 'Manual',
  forced: 'Force matched',
};
