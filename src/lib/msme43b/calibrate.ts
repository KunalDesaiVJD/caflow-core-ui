// MSME 43B(h) — rule calibration: learn the firm's interpretation from a
// working paper the reviewer says is right.
//
// ─────────────────────────────────────────────────────────────────────────────
//  HOW IT WORKS, AND WHY IT CANNOT CHEAT
// ─────────────────────────────────────────────────────────────────────────────
// Given (a) the same ledgers the tool already read and (b) the reviewer's own
// figures, this searches the RULE SPACE — the closed set of legal positions in
// rules.ts — for the interpretation that best reproduces the reviewer's answer.
//
// The search is a plain coordinate descent: try changing one rule at a time,
// keep the change that fixes the most vendors, repeat. Every candidate is
// scored by RE-RUNNING THE REAL ENGINE over the real ledgers. Nothing is
// back-solved and no figure is ever written into a result.
//
// Four properties make the outcome trustworthy rather than merely agreeable:
//
//   • The only output is a config — a set of enumerated legal positions. There
//     is no representation in which "vendor X should be ₹84,105" can be stored,
//     so the tool cannot memorise an answer. (rules.ts, fences #1–#2.)
//
//   • A rule applies to EVERY vendor. A change that fixes one vendor and breaks
//     three is reported as exactly that and loses the search. Agreement has to
//     be earned across the whole population.
//
//   • The pass/fail bar is FIXED. matchTolerance is set by the preparer once and
//     is never touched by the search — otherwise the calibrator could "agree" by
//     widening what counts as agreement. The engine's own materiality rule is a
//     separate thing and cannot move the bar.
//
//   • Previously signed-off runs are re-run under every candidate. A rule that
//     would change an answer the firm has already blessed is disqualified,
//     whatever it does for today's file. (Regression guard.)
//
// When the search runs out of legal positions and differences remain, they are
// returned as UNEXPLAINED — plainly, with the amount. That is the honest end of
// the process: the tool is saying "no interpretation I am permitted to hold
// produces your number; one of us is wrong and a human must look." Forcing
// agreement there would be the cheat this design exists to prevent.

import type { VendorLedger, Msme43bReport } from './types';
import { DEFAULT_CONFIG, type Msme43bConfig } from './config';
import { buildReport, normVendor } from './engine';
import { PERMITTED_GST_RATES } from './config';
import {
  RULE_SPACE, type RuleValue, type RuleProfile, type RuleChange,
  type VendorWindowDeclaration, type VendorGstDeclaration, emptyProfile, validateProfile,
} from './rules';
import { diffAgainstExpected, type DiffResult } from './diff';
import type { ExpectedWorking } from './expected';

/** A run the firm has already signed off, replayed to catch regressions. */
export interface GoldenCase {
  id?: string;
  label: string;
  cyLabel: string;
  cyLedgers: VendorLedger[];
  fyLedgers: VendorLedger[];
  /** blessed disallowance by normalised vendor name */
  blessed: Record<string, number>;
  vendorWindows?: Record<string, number>;
  vendorGstRates?: Record<string, number>;
}

export interface RuleProposal {
  kind: 'rule';
  key: string;
  title: string;
  question: string;
  from: RuleValue;
  to: RuleValue;
  fromLabel: string;
  toLabel: string;
  basis: string;
  matchedBefore: number;
  matchedAfter: number;
  absDeltaBefore: number;
  absDeltaAfter: number;
  /** vendors this change brought into agreement */
  fixes: string[];
  /** vendors it pushed out of agreement (accepted only because it nets positive) */
  breaks: string[];
}

/**
 * A per-vendor s.15 window. NOT a tuning knob — a statement of fact about the
 * vendor that the preparer must confirm (is there a written agreement or not?).
 * Only ever 15 or 45, and printed on the workpaper.
 */
export interface VendorWindowProposal {
  kind: 'vendor-window';
  vendorName: string;
  key: string;
  windowDays: number;
  currentWindowDays: number;
  /** the difference this would resolve */
  resolvesDelta: number;
  requiresDeclaration: true;
  basis: string;
}

/**
 * A per-vendor GST rate. Also a declaration, not a dial: only the statutory
 * rates are offered, it is used solely where the ledger does not show the tax
 * split, and it must be confirmed by a human.
 */
export interface VendorGstProposal {
  kind: 'vendor-gst';
  vendorName: string;
  key: string;
  gstRate: number;
  resolvesDelta: number;
  requiresDeclaration: true;
  basis: string;
}

export type Proposal = RuleProposal | VendorWindowProposal | VendorGstProposal;

export interface CalibrationInput {
  cyLedgers: VendorLedger[];
  fyLedgers: VendorLedger[];
  expected: ExpectedWorking;
  baseConfig?: Msme43bConfig;
  clientName?: string;
  /** already-declared per-vendor windows carried in from the saved profile */
  vendorWindows?: Record<string, number>;
  /** already-declared per-vendor GST rates carried in from the saved profile */
  vendorGstRates?: Record<string, number>;
  /** runs the firm has already blessed — a proposal may not change these */
  goldens?: GoldenCase[];
  /**
   * The bar for "agrees", in rupees. Set once by the preparer and held constant
   * for the whole search — see the header.
   */
  matchTolerance?: number;
  /** cap on descent rounds (each round changes at most one rule) */
  maxRounds?: number;
}

export interface CalibrationResult {
  before: DiffResult;
  after: DiffResult;
  proposals: Proposal[];
  /** the configuration reached if every rule proposal is accepted */
  proposedConfig: Msme43bConfig;
  /** differences no permitted interpretation could explain */
  unexplained: DiffResult['vendors'];
  unexplainedAmount: number;
  /** candidate configurations actually evaluated */
  variantsEvaluated: number;
  /** rules that would have helped but change a signed-off run */
  rejectedForRegression: Array<{ title: string; toLabel: string; goldens: string[] }>;
  /** plain statements of what this exercise did and did not establish */
  honestNotes: string[];
  matchTolerance: number;
}

interface Score { matched: number; absDelta: number }

const r2 = (n: number) => Math.round(n * 100) / 100;

function scoreOf(d: DiffResult): Score {
  return { matched: d.matched, absDelta: d.totalAbsDelta };
}

/** Strictly better = more vendors agreeing, or the same number but materially closer. */
function isBetter(a: Score, b: Score): boolean {
  if (a.matched !== b.matched) return a.matched > b.matched;
  // No extra vendor agrees: adopt the position only if it closes a MATERIAL
  // part of the remaining gap. Chasing rounding noise would let the search take
  // a legal position on evidence that does not support it.
  const gain = b.absDelta - a.absDelta;
  return gain > 100 && gain > b.absDelta * 0.05;
}

/**
 * The regression guard's own tolerance — deliberately a CONSTANT, and deliberately
 * NOT the preparer's matchTolerance.
 *
 * Those two numbers answer different questions. matchTolerance is "how close must
 * we be to the reviewer's figure to call it agreement", and the preparer sets it.
 * This one is "did a signed-off answer change", and nobody gets to set it: wiring
 * the preparer's field into the guard meant typing 100000 into the Agreement bar
 * silently disabled protection of every signed-off run, while the UI and the
 * workpaper both went on saying those runs were protected.
 *
 * ₹1 is the smallest figure that ignores paise noise without ignoring anything a
 * reviewer would recognise as a change.
 */
const GOLDEN_GUARD_TOLERANCE = 1;

/** Does this configuration change an answer the firm already signed off? */
function goldensBroken(cfg: Msme43bConfig, goldens: GoldenCase[]): string[] {
  const broken: string[] = [];
  for (const g of goldens) {
    const rep = buildReport(g.cyLedgers, g.fyLedgers, cfg, undefined, {
      verify: false, vendorWindowDays: g.vendorWindows, vendorGstRate: g.vendorGstRates,
    });
    const changed = rep.vendors.some((v) => {
      const blessed = g.blessed[normVendor(v.vendorName)];
      return blessed !== undefined && Math.abs(v.totalDisallowedCY - blessed) > GOLDEN_GUARD_TOLERANCE;
    });
    if (changed) broken.push(g.label);
  }
  return broken;
}

export function calibrate(input: CalibrationInput): CalibrationResult {
  const base = input.baseConfig ?? DEFAULT_CONFIG;
  const goldens = input.goldens ?? [];
  const tol = input.matchTolerance ?? 1;
  const maxRounds = input.maxRounds ?? 6;
  const vendorWindows = { ...(input.vendorWindows ?? {}) };
  const vendorGstRates = { ...(input.vendorGstRates ?? {}) };

  let variants = 0;
  const run = (cfg: Msme43bConfig): Msme43bReport => {
    variants++;
    // verify:false — the cross-check is run once at the end on the winning
    // configuration, not on every one of the hundred candidates.
    return buildReport(input.cyLedgers, input.fyLedgers, cfg, input.clientName, {
      verify: false, vendorWindowDays: vendorWindows, vendorGstRate: vendorGstRates,
    });
  };
  const diffOf = (cfg: Msme43bConfig) => diffAgainstExpected(run(cfg), input.expected, tol);

  const before = diffOf(base);
  let cur = base;
  let curDiff = before;
  let curScore = scoreOf(before);

  const proposals: Proposal[] = [];
  const rejectedForRegression: CalibrationResult['rejectedForRegression'] = [];
  const changedKeys = new Set<string>();

  for (let round = 0; round < maxRounds; round++) {
    let best: { cfg: Msme43bConfig; diff: DiffResult; score: Score; proposal: RuleProposal } | null = null;

    for (const rule of RULE_SPACE) {
      if (changedKeys.has(rule.key)) continue; // one position per rule per session
      const from = cur[rule.key] as RuleValue;

      for (const opt of rule.options) {
        if (opt.value === from) continue;
        const cand = { ...cur, [rule.key]: opt.value } as Msme43bConfig;

        const broken = goldens.length ? goldensBroken(cand, goldens) : [];
        if (broken.length) {
          const d = diffOf(cand);
          if (isBetter(scoreOf(d), curScore)) {
            rejectedForRegression.push({ title: rule.title, toLabel: opt.label, goldens: broken });
          }
          continue;
        }

        const d = diffOf(cand);
        const s = scoreOf(d);
        if (!isBetter(s, curScore)) continue;
        if (best && !isBetter(s, best.score)) continue;

        const wasMatching = new Set(curDiff.vendors.filter((v) => v.status === 'match').map((v) => v.vendorName));
        const nowMatching = new Set(d.vendors.filter((v) => v.status === 'match').map((v) => v.vendorName));
        const fromOpt = rule.options.find((o) => o.value === from);

        best = {
          cfg: cand, diff: d, score: s,
          proposal: {
            kind: 'rule',
            key: rule.key as string,
            title: rule.title,
            question: rule.question,
            from, to: opt.value,
            fromLabel: fromOpt?.label ?? String(from),
            toLabel: opt.label,
            basis: opt.basis,
            matchedBefore: curScore.matched,
            matchedAfter: s.matched,
            absDeltaBefore: r2(curScore.absDelta),
            absDeltaAfter: r2(s.absDelta),
            fixes: [...nowMatching].filter((n) => !wasMatching.has(n)),
            breaks: [...wasMatching].filter((n) => !nowMatching.has(n)),
          },
        };
      }
    }

    if (!best) break;
    proposals.push(best.proposal);
    changedKeys.add(best.proposal.key);
    cur = best.cfg;
    curDiff = best.diff;
    curScore = best.score;
  }

  // ── Per-vendor window declarations for what the global rules could not fix ──
  // Offered only where the vendor's whole difference disappears at the OTHER
  // statutory window, which is a real question about that vendor's contract
  // rather than a number to be tuned.
  const windowProposals: VendorWindowProposal[] = [];
  const stillOff = curDiff.vendors.filter((v) => v.status === 'differs');
  const alternate = cur.windowDays === 45 ? 15 : 45;

  for (const v of stillOff) {
    const key = normVendor(v.vendorName);
    if (vendorWindows[key]) continue;
    const trial = { ...vendorWindows, [key]: alternate };
    variants++;
    const rep = buildReport(input.cyLedgers, input.fyLedgers, cur, input.clientName, {
      verify: false, vendorWindowDays: trial, vendorGstRate: vendorGstRates,
    });
    const row = rep.vendors.find((x) => normVendor(x.vendorName) === key);
    if (!row || !v.theirs) continue;
    if (Math.abs(row.totalDisallowedCY - v.theirs.disallowed) <= tol) {
      windowProposals.push({
        kind: 'vendor-window',
        vendorName: v.vendorName,
        key,
        windowDays: alternate,
        currentWindowDays: cur.windowDays,
        resolvesDelta: v.delta,
        requiresDeclaration: true,
        basis: alternate === 45
          ? 'Your figure matches a 45-day window for this vendor — confirm a written agreement is on file (s.15 MSMED Act).'
          : 'Your figure matches a 15-day window for this vendor — confirm there is NO written agreement (s.15 MSMED Act).',
      });
    }
  }

  // ── Per-vendor GST rate declarations ──
  // Offered where the ledger did not show the tax split and the reviewer's
  // figure lands exactly on one of the statutory rates. That is strong evidence
  // of the rate the vendor charges — but it is still a fact about the vendor, so
  // the preparer confirms it rather than the tool assuming it.
  const gstProposals: VendorGstProposal[] = [];
  if (cur.disallowanceBase === 'taxableValue') {
    for (const v of stillOff) {
      const key = normVendor(v.vendorName);
      if (vendorGstRates[key] !== undefined) continue;
      if (windowProposals.some((w) => w.key === key)) continue; // already explained
      if (!v.theirs) continue;

      for (const rate of PERMITTED_GST_RATES) {
        if (rate === 0) continue; // 0% is the same as no split
        const trial = { ...vendorGstRates, [key]: rate as number };
        variants++;
        const rep = buildReport(input.cyLedgers, input.fyLedgers, cur, input.clientName, {
          verify: false, vendorWindowDays: vendorWindows, vendorGstRate: trial,
        });
        const row = rep.vendors.find((x) => normVendor(x.vendorName) === key);
        if (row && Math.abs(row.totalDisallowedCY - v.theirs.disallowed) <= tol) {
          gstProposals.push({
            kind: 'vendor-gst',
            vendorName: v.vendorName,
            key,
            gstRate: rate,
            resolvesDelta: v.delta,
            requiresDeclaration: true,
            basis:
              `Your figure matches this vendor's invoices carrying GST at ${rate}%. The ledger does not show the tax ` +
              'split, so confirm this is the rate the vendor charges — the taxable value is then derived from it.',
          });
          break;
        }
      }
    }
  }

  const after = curDiff;
  const unexplained = after.vendors.filter((v) => {
    if (v.status === 'match') return false;
    if (windowProposals.some((w) => w.vendorName === v.vendorName)) return false;
    return !gstProposals.some((g) => g.vendorName === v.vendorName);
  });
  const unexplainedAmount = r2(unexplained.reduce((a, v) => a + Math.abs(v.delta), 0));

  const honestNotes: string[] = [];
  honestNotes.push(
    `Searched ${variants} configurations drawn only from the ${RULE_SPACE.length} legal positions in the rule space. ` +
    'Each was scored by re-running the engine over your ledgers — no figure was back-solved.',
  );
  honestNotes.push(
    `The bar for agreement (₹${tol}) was fixed before the search and was not changed by it.`,
  );
  if (goldens.length) {
    const blessedCounts = goldens.map((g) => Object.keys(g.blessed || {}).length);
    const totalBlessed = blessedCounts.reduce((a, b) => a + b, 0);
    honestNotes.push(
      `${goldens.length} previously signed-off run(s) covering ${totalBlessed} vendor(s) were replayed under ` +
      `every candidate at a fixed ₹${GOLDEN_GUARD_TOLERANCE} tolerance; any rule that would have changed them ` +
      'was discarded. The guard checks the disallowance figure of the vendors recorded in each signed-off run — ' +
      'a vendor absent from that record is not protected.',
    );
    if (goldens.some((g) => !g.blessed || Object.keys(g.blessed).length === 0)) {
      honestNotes.push('WARNING: at least one signed-off run recorded no vendor figures, so it protects nothing.');
    }
  } else {
    honestNotes.push('No previously signed-off runs were available to replay, so no regression guard was applied. Sign off a run to enable it.');
  }
  if (proposals.length === 0 && windowProposals.length === 0) {
    honestNotes.push('No permitted interpretation improved the agreement. The difference is not a matter of rule choice — it is a data or judgement question.');
  }
  if (unexplained.length) {
    honestNotes.push(
      `${unexplained.length} vendor(s), ₹${Math.round(unexplainedAmount).toLocaleString('en-IN')} in total, cannot be reconciled by any position ` +
      'the tool is permitted to take. These are shown as unexplained rather than forced to agree.',
    );
  }
  if (after.onlyTheirs) {
    honestNotes.push(`${after.onlyTheirs} vendor(s) in your working have no uploaded ledger, so nothing could be computed for them.`);
  }
  honestNotes.push(
    'Agreeing with your working is evidence the tool now applies your interpretation — not proof that either working is correct in law.',
  );

  return {
    before, after,
    proposals: [...proposals, ...windowProposals, ...gstProposals],
    proposedConfig: cur,
    unexplained, unexplainedAmount,
    variantsEvaluated: variants,
    rejectedForRegression,
    honestNotes,
    matchTolerance: tol,
  };
}

/**
 * Fold accepted proposals into the client's rule profile. Validated on the way
 * in, so a profile that would not pass the guard rails is never written.
 */
export function applyProposals(
  profile: RuleProfile | null,
  accepted: Proposal[],
  meta: { by?: string; at?: string; reason?: string; matchedBefore?: number; matchedAfter?: number } = {},
): { profile: RuleProfile; errors: string[] } {
  const next: RuleProfile = profile
    ? {
        ...profile,
        overrides: { ...profile.overrides },
        vendorWindows: [...(profile.vendorWindows ?? [])],
        vendorGstRates: [...(profile.vendorGstRates ?? [])],
        history: [...(profile.history ?? [])],
      }
    : emptyProfile();
  const at = meta.at ?? new Date().toISOString();

  for (const p of accepted) {
    if (p.kind === 'vendor-gst') {
      const decl: VendorGstDeclaration = {
        key: p.key, vendorName: p.vendorName, gstRate: p.gstRate, declaredBy: meta.by, at,
      };
      next.vendorGstRates = next.vendorGstRates.filter((d) => d.key !== decl.key).concat(decl);
      next.history.push({
        key: `vendorGstRate:${p.vendorName}`,
        from: 'not declared', to: `${p.gstRate}%`,
        reason: meta.reason || p.basis,
        at, by: meta.by,
      });
    } else if (p.kind === 'rule') {
      (next.overrides as Record<string, RuleValue>)[p.key] = p.to;
      const change: RuleChange = {
        key: p.key, from: p.from, to: p.to,
        reason: meta.reason || p.basis,
        at, by: meta.by,
        matchedBefore: p.matchedBefore,
        matchedAfter: p.matchedAfter,
      };
      next.history.push(change);
    } else {
      const decl: VendorWindowDeclaration = {
        key: p.key,
        vendorName: p.vendorName,
        windowDays: p.windowDays,
        basis: p.windowDays === 45 ? 'agreement' : 'none',
        declaredBy: meta.by,
        at,
      };
      next.vendorWindows = next.vendorWindows.filter((d) => d.key !== decl.key).concat(decl);
      next.history.push({
        key: `vendorWindow:${p.vendorName}`,
        from: p.currentWindowDays, to: p.windowDays,
        reason: meta.reason || p.basis,
        at, by: meta.by,
      });
    }
  }

  next.revision = (profile?.revision ?? 0) + 1;
  const errors = validateProfile(next);
  return { profile: next, errors };
}
