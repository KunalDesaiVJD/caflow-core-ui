/**
 * resolveTdsMgmtHints — Phase 1 of the TDS Management -> TDS Analytics
 * integration.
 *
 * Pure, read-only, side-effect-free.
 *
 * Consumed by runAiMapper() in ./tdsEngine.ts — the ACTUAL live "Run AI
 * Mapper" code path (the old supabase/functions/tds-ai-mapper Deno edge
 * function was fully superseded by a client-side TS port some time ago;
 * see tdsEngine.ts's own header comment — nothing invokes that edge
 * function anymore, so this file deliberately has no Deno copy).
 *
 * Input:
 *   - tds_tally_party_maps rows (TDS Management's own confirmed
 *     office-deductee <-> Tally-party mappings — client-scoped, NOT
 *     financial-year-scoped, already reused across quarters by that
 *     module).
 *   - the CURRENT financial year's live Trial Balance ledger names
 *     (tally_trial_balance, kept fresh by Tally Sync).
 *
 * Job: for each TDS-Management-confirmed tally_party string, find which (if
 * any) CURRENT live TB ledger it corresponds to.
 *
 * Deliberately NOT re-deriving whether office_name and tally_party are the
 * same real party — TDS Management's own Stage-3 reconciliation already did
 * that work (with human confirmation), often for pairs whose names don't
 * resemble each other at all (multiple individuals booked under one shared
 * Tally ledger — e.g. several site labourers under one contractor's
 * ledger). Re-deriving that here would be both redundant and wrong: name
 * similarity cannot and must not second-guess an already-confirmed human
 * decision. The only question this file answers is "does that confirmed
 * ledger identity still exist, under what name, in THIS year's live TB" —
 * a resolution problem, not a re-matching problem.
 *
 * Reuses the SAME name-comparison primitives TDS Management's own Stage 1-3
 * engine uses (./match.ts) — not a new heuristic, not a copy.
 * tds_tally_party_maps.tally_party is free text from a manually uploaded
 * ledger export and often carries rate/amount annotations ("HPC Corporation
 * @2% OF 16000/-") that a plain string-equality check would miss but
 * nameEvidence's trailing-clause + annotation handling is already built to
 * tolerate.
 */
import { nameEvidence, normalizeName, type NameEvidence, type NameTier } from "./match";

export interface TallyPartyMapRow {
  office_name: string;
  tally_party: string;
}

export interface TbLedgerRow {
  ledger_name: string;
  parent_group?: string | null;
}

export type ResolutionOutcome = "exact" | "fuzzy" | "ambiguous" | "unresolved";

export interface ResolvedHint {
  officeName: string;
  tallyPartyRaw: string;
  outcome: ResolutionOutcome;
  /** The live TB ledger this resolved to, or null if unresolved/ambiguous. */
  resolvedLedgerName: string | null;
  /** nameEvidence's tier for the winning candidate (0-6), or null. */
  nameTier: NameTier | null;
  /** 0-100, same scale as tds_tb_party_mappings.match_confidence. */
  confidence: number;
  /** Populated only when outcome === "ambiguous" — every tied candidate. */
  candidates?: string[];
}

/** tier -> confidence, matching the file's own documented boundary: tiers
 *  0-3 are the tiers nameCompare() treats as "match", tier 4 is the
 *  non-auto-matching "risky" rung it deliberately never promotes on its
 *  own. Confidence values chosen to line up with tds-ai-mapper's existing
 *  confirmed/pending/needs_review bands (80 / 60 / 40) rather than invent a
 *  new scale. */
const TIER_CONFIDENCE: Record<Exclude<NameTier, "unknown">, number> = {
  0: 100, // identical after normalisation
  1: 95,  // same tokens, different order
  2: 85,  // abbreviation / compound-suffix / dropped token
  3: 75,  // vowel elision in a long word
  4: 55,  // risky — never auto-applied, always surfaced for review
  5: 25,
  6: 0,
};

function confidenceFor(tier: NameTier): number {
  return tier === "unknown" ? 30 : TIER_CONFIDENCE[tier];
}

/**
 * Resolve every TDS-Management-confirmed party map against the current
 * year's live TB ledger list.
 *
 * No I/O. Callers fetch `partyMaps` (client-scoped, once) and `tbLedgers`
 * (this FY's TB, once) and pass them in.
 */
export function resolveTdsMgmtHints(
  partyMaps: TallyPartyMapRow[],
  tbLedgers: TbLedgerRow[],
): ResolvedHint[] {
  // Exact-match index, built once — normalizeName is idempotent and cheap,
  // but there's no reason to recompute it per party-map row.
  const exactIndex = new Map<string, string>(); // normalized -> original ledger_name
  for (const l of tbLedgers) {
    const key = normalizeName(l.ledger_name);
    if (key && !exactIndex.has(key)) exactIndex.set(key, l.ledger_name);
  }

  return partyMaps.map((pm): ResolvedHint => {
    if (!pm.tally_party?.trim()) {
      return { officeName: pm.office_name, tallyPartyRaw: pm.tally_party, outcome: "unresolved", resolvedLedgerName: null, nameTier: null, confidence: 0 };
    }

    const exactKey = normalizeName(pm.tally_party);
    const exactHit = exactIndex.get(exactKey);
    if (exactHit) {
      return {
        officeName: pm.office_name, tallyPartyRaw: pm.tally_party,
        outcome: "exact", resolvedLedgerName: exactHit, nameTier: 0, confidence: 100,
      };
    }

    // No exact hit — score every TB ledger via the shared name-evidence
    // engine and keep the best (lowest tier = strongest evidence).
    let best: { ledger: string; ev: NameEvidence } | null = null;
    let bestTierRank = Infinity;
    const tied: string[] = [];
    for (const l of tbLedgers) {
      const ev = nameEvidence(pm.tally_party, l.ledger_name);
      if (ev.tier === "unknown") continue;
      const r = ev.tier as number;
      if (r < bestTierRank) {
        bestTierRank = r; best = { ledger: l.ledger_name, ev }; tied.length = 0; tied.push(l.ledger_name);
      } else if (r === bestTierRank) {
        tied.push(l.ledger_name);
      }
    }

    if (!best || bestTierRank > 4) {
      // Nothing scored at tier <=4 (the documented auto-match / risky-review
      // boundary in match.ts) — no usable signal.
      return { officeName: pm.office_name, tallyPartyRaw: pm.tally_party, outcome: "unresolved", resolvedLedgerName: null, nameTier: null, confidence: 0 };
    }

    if (tied.length > 1) {
      // Two or more TB ledgers are equally good candidates — this is
      // exactly the situation manual mapping exists for. Never guess.
      return {
        officeName: pm.office_name, tallyPartyRaw: pm.tally_party,
        outcome: "ambiguous", resolvedLedgerName: null, nameTier: best.ev.tier, confidence: 0,
        candidates: tied,
      };
    }

    return {
      officeName: pm.office_name, tallyPartyRaw: pm.tally_party,
      outcome: "fuzzy", resolvedLedgerName: best.ledger, nameTier: best.ev.tier,
      confidence: confidenceFor(best.ev.tier),
    };
  });
}
