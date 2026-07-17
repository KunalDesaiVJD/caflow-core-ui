/**
 * STAGE-3 · ASSIGNMENT — the pure matching core. No I/O, no AI, no React, no dates
 * parsed, no strings rendered. tallyRecon.ts adapts this to TallyReconRow.
 *
 * ── WHY THIS MODULE EXISTS ──────────────────────────────────────────────────
 * The engine this replaced made a LOCAL decision per office record against a FIXED
 * similarity threshold. No threshold is correct:
 *   tight → "TARUBEN SURESHBHAI KATHARANI" vs "Taruben S Kathrani" is a FALSE
 *           MISMATCH (the user reported this; they are the same person).
 *   loose → "RAMESH PATEL" vs "RAMESH PATIL" is a FALSE MATCH (an adversarial audit
 *           found 35 such pairs of genuinely different deductees).
 *
 * The resolution: THE CORRECT VERDICT IS NOT A PROPERTY OF THE NAME PAIR. It is a
 * property of the CANDIDATE SET. A fuzzy match is safe when nothing else competes
 * for it and unsafe when a competitor exists — so decide by EXCLUSIVITY, never by a
 * similarity cutoff. There is no threshold, and no scalar score, anywhere below.
 *
 * ── THE COST ASYMMETRY THAT GOVERNS EVERY TRADE-OFF ─────────────────────────
 * A FALSE MATCH files a TDS return against the WRONG PAN: a wrong 26AS credit, a
 * defective return, real liability, and it says nothing. A FALSE MISMATCH asks the
 * user to map a party ONCE (the mapping is saved per client and auto-applies for
 * ever). False matches are MUCH worse — but false mismatches at scale are the thing
 * the user is furious about, so "escalate everything" is not an answer either.
 *
 * ── THE LADDER ──────────────────────────────────────────────────────────────
 * Match in tiers of DECREASING evidence. At each tier, commit only pairings that are
 * mutually exclusive (uniquely best for the office record AND for the ledger row),
 * then CONSUME both endpoints so every weaker tier sees a smaller board. Escalate
 * only on genuine competition.
 *
 * This is why PATEL and PATIL never compete WHEN BOTH ARE PRESENT: each is an exact
 * match to its own ledger row, so both are consumed at A1 — before any risky rule is
 * ever consulted. The dangerous pairing is not rejected; it is NEVER REACHABLE.
 *
 * ── COUPLING TO IMPORT — INVISIBLE AND LOAD-BEARING ─────────────────────────
 * importPipeline.ts de-dups on the row signature PLUS its occurrence index WITHIN
 * ITS SHEET. That is what makes the class collapse below CORRECT. Had content-only
 * dedup collapsed KONE's four identical bills to one, the block would be 4x1 and
 * this engine would confidently emit three FALSE shortfalls — reasoning about a
 * graph the importer had already destroyed. Both mechanisms must hold; a regression
 * in either silently corrupts the other.
 */

import {
  rank, nameEvidence, type NameTier, type NameEvidence,
  normalizeName, normalizePan, amountsMatch, canonicalSection,
} from "./match";

// ── Inputs (already canonicalised by the adapter) ────────────────────────────
export interface AsgOffice {
  id: string;
  name: string | null;
  dateIso: string | null;
  amount: number | null;
  tds: number | null;
  section: string | null;   // canonical, or null
  pan?: string | null;
  /** False ⇒ this record takes part in NO pairing (it gets no edges, so it can never
   *  consume a ledger row), but it STILL counts as a deductee in this client's books
   *  for the distinctness witness.
   *
   *  The distinction is load-bearing. A record whose section was never imported is not
   *  a matching question — but it is still PROOF that this client's books contain that
   *  deductee. Dropping such records from the universe let the witness go blind: with
   *  only the 194C ledger imported, the separate 194J deductee "RAMESH PATIL"
   *  disappeared, and the engine offered a one-click merge of "RAMESH PATEL" onto the
   *  194C row spelled "Ramesh Patil" — a permanent wrong mapping caused purely by which
   *  ledger the user happened to import. Ledger COVERAGE must never erase a DEDUCTEE. */
  assignable?: boolean;
}
export interface AsgLedger {
  /** POSITION in the credits array — NEVER row_index.
   *
   *  row_index is unique only within its OWN file: every imported ledger numbers
   *  from 0, so keying on it made the first 194A entry and the first 194C entry the
   *  same key. The 194A record consumed "0" and thereby blocked an unrelated 194C
   *  entry, reporting a byte-exact record as "Ledger Entry Not Found". Position is
   *  unique across the union by construction, so no caller can reintroduce that. */
  pos: number;
  party: string | null;
  iso: string | null;
  credit: number | null;
  section: string | null;   // canonical, or null
}

// ── Evidence ─────────────────────────────────────────────────────────────────
export interface Evidence {
  nameTier: NameTier;
  /** RAW integer days (ledger − office), never bucketed: bucketing would make two
   *  genuinely different dates look identical and merge their evidence classes. */
  dateDelta: number | null;
  basis: "tds" | "amount" | null;   // which office figure the credit matched; null ⇒ neither
  amountExact: boolean;             // matched on the section's VOTED basis
  sectionEq: boolean;
  mapped: boolean;                  // a saved party map asserts this identity
}

export interface Edge { oi: number; ti: number; ev: Evidence; ne: NameEvidence }

/**
 * The dominance-visible projection of an Evidence. Two evidences share a signature
 * IFF they are equally strong, so a signature IS an evidence class.
 *
 * ── RULE 1: ONLY SIGNALS PRESENT ON BOTH SIDES MAY ENTER. ───────────────────
 * vch_no and vch_type are ledger-only identities with no office counterpart. The
 * KONE fixture gives its four identical rows vch_no 0..3; admitting that field would
 * shatter the 4x4 block into four singleton classes, make every pairing "unique",
 * and resurrect exactly the user prompt this design exists to remove. A signal only
 * one side carries cannot distinguish a PAIR — it can only fake distinctness.
 * Load-bearing, and it has its own test.
 *
 * ── RULE 2: THIS MUST STAY EXACTLY THE FIELD SET dominates() READS. ─────────
 * Every field here is projected the way dominates() compares it: |dateDelta| (a day
 * early and a day late are equally far), and basis as a BOOLEAN (whether any office
 * figure matched at all — the "tds"/"amount" string is a reporting detail carried on
 * the row, not a difference in evidence STRENGTH).
 *
 * If the two ever drift apart, dominance stops being a partial order: two evidences
 * get different signatures yet are each "no worse" than the other, so they MUTUALLY
 * dominate, the maximal set comes back EMPTY, and the record escalates as "Multiple
 * Possible Matches" for no reason at all. That is not hypothetical — the merged spec
 * specified raw signed dateDelta plus the basis string here against |dateDelta| and
 * no basis in dominates(), and one office record with a row one day early and one day
 * late escalated, with a reason line that claimed the amounts differed when they were
 * identical. Executed and confirmed before this was tightened. Keeping the projection
 * identical makes that failure UNREACHABLE rather than merely unlikely: differing
 * signatures now guarantee a strictly comparable or genuinely incomparable pair, so
 * the maximal set is never empty.
 */
const sigOf = (e: Evidence) =>
  `${e.mapped ? 1 : 0}|${e.nameTier}|${Math.abs(e.dateDelta ?? 9999)}|${e.basis ? 1 : 0}|${e.amountExact ? 1 : 0}|${e.sectionEq ? 1 : 0}`;

/**
 * Pareto dominance. NO scalar score, NO weights, NO cutoff.
 *
 * `a` dominates `b` iff it is no worse on EVERY signal and differs somewhere. If two
 * candidates are INCOMPARABLE the signals genuinely disagree (one matches the date,
 * the other the amount) — that is not a tie to break by weight, it is a question for
 * a human. Collapsing it with a weighted score is precisely how the old engine
 * manufactured false confidence.
 */
function dominates(a: Evidence, b: Evidence): boolean {
  const dd = (e: Evidence) => Math.abs(e.dateDelta ?? 9999);
  const noWorse =
    rank(a.nameTier) <= rank(b.nameTier) &&
    dd(a) <= dd(b) &&
    (a.basis ? 0 : 1) <= (b.basis ? 0 : 1) &&
    (a.amountExact ? 0 : 1) <= (b.amountExact ? 0 : 1) &&
    (a.sectionEq ? 0 : 1) <= (b.sectionEq ? 0 : 1) &&
    (a.mapped ? 0 : 1) <= (b.mapped ? 0 : 1);
  return noWorse && sigOf(a) !== sigOf(b);
}

// ── The tier ladder ─────────────────────────────────────────────────────────
export type TierId = "A0" | "A1" | "A2" | "A3" | "A4" | "RESIDUE";

interface TierDef {
  id: TierId;
  label: string;
  /** DECISION 1, the load-bearing knob. Tier >= 4 (RISKY: PATEL/PATIL) does not
   *  auto-commit a pairing here — it falls to the residue closer, which pairs it
   *  only when FORCED BY ELIMINATION, and the verdict rule below independently
   *  withholds "Matched" from it in every case.
   *
   *  Flipping A4 to true would let an exclusively-best risky pair commit in the
   *  ladder instead of the residue. It would NOT make it a Match: that is governed
   *  by AUTO_MATCH_MAX_RANK, deliberately a SECOND, independent gate, so no single
   *  edit to this table can turn a spelling guess into a filed return. */
  autoCommit: boolean;
  /** A0 only. The user's assertion IS the corroboration, so a mapped party whose
   *  date AND amount are both wrong must still be FOUND and reported — otherwise the
   *  mapping silently does nothing and the record comes back "Ledger Entry Not
   *  Found", which is the exact bug the old engine's mapping branch was written to
   *  fix. Every other tier requires a fact to corroborate the name. */
  needsCorroboration: boolean;
  admits: (ev: Evidence) => boolean;
}

/**
 * ORDER IS LOAD-BEARING AND SILENTLY BREAKABLE — reordering these rows changes which
 * pairing wins with no test failing unless one asserts the order itself. Two do.
 */
export const TIERS: TierDef[] = [
  // The user asserted this identity. Not exclusive across parties — it is a fact,
  // not an inference — but still a sub-ladder among that party's own rows.
  { id: "A0", label: "ASSERTED", autoCommit: true, needsCorroboration: false, admits: (ev) => ev.mapped },
  // Same string, or the same tokens reordered. PATEL and PATIL are both consumed
  // here when both are present, which is what makes the risky tier unreachable.
  { id: "A1", label: "EXACT", autoCommit: true, needsCorroboration: true, admits: (ev) => rank(ev.nameTier) <= 1 },
  // Abbreviation and vowel ELISION — TARUBEN/Taruben S, KATHARANI/KATHRANI.
  { id: "A2", label: "CANONICAL", autoCommit: true, needsCorroboration: true, admits: (ev) => rank(ev.nameTier) <= 3 },
  // No name to compare on one side. STRICT: with no name to tell two rows apart, a
  // rival is a real ambiguity, so demand every other fact exactly.
  {
    id: "A3", label: "FACTS_ONLY", autoCommit: true, needsCorroboration: true,
    admits: (ev) => ev.nameTier === "unknown" && ev.dateDelta === 0 && ev.amountExact,
  },
  // See TierDef.autoCommit. Present so the decision is one reversible line of data.
  { id: "A4", label: "RISKY", autoCommit: false, needsCorroboration: true, admits: (ev) => rank(ev.nameTier) === 4 },
];

/** EXCLUSIVITY BUYS THE COUNTERPART. ONLY CORROBORATION BUYS THE VERDICT.
 *
 *  The tier decides WHICH counterpart we are confident enough to show. It never
 *  decides whether the records AGREE. Names at rank > 3.5 are never "Matched"
 *  however exclusive the pairing — that is DECISION 1's real teeth, and it is
 *  deliberately a separate gate from the TIERS table above. */
export const AUTO_MATCH_MAX_RANK = 3.5;

// ── Small helpers ────────────────────────────────────────────────────────────
const dayNum = (iso: string | null): number | null => {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? Math.floor(Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000) : null;
};
const push = <K, V>(m: Map<K, V[]>, k: K, v: V) => { const a = m.get(k); if (a) a.push(v); else m.set(k, [v]); };

/** Kuhn's augmenting-path matching. NOT Hungarian, NOT min-cost-flow, NOT
 *  Hopcroft–Karp — all three are overkill here, and the first two cannot even arise:
 *  within one evidence class every edge has IDENTICAL evidence, so all costs are
 *  equal and min-cost assignment DEGENERATES to max-cardinality bipartite matching.
 *  Degeneracy is the proof, not the problem.
 *
 *  A class is NOT always complete bipartite (dateDelta is raw and relative, so two
 *  office records with different dates can both carry delta 0 to different rows).
 *  `zip` would pair across an edge that does not exist. Kuhn cannot — which is why
 *  there is no `zip` special case and one code path serves both.
 *
 *  THE GREEDY PRE-PASS IS NOT AN OPTIMISATION — it is what makes the output match
 *  the reason line. Plain Kuhn augments the FIRST office off its row to make room
 *  for the second, so a complete 4x4 block resolves in REVERSE (office 0 -> row 3).
 *  Executed and confirmed. The rows are identical so no verdict changes, but the
 *  pinned wording promises the entries pair "in ledger order", and an engine whose
 *  explanation does not describe what it did is how trust in it dies. Seeding with
 *  the first FREE row in position order yields office i -> row i; the augmenting
 *  phase still runs for anyone who cannot grab one, so maximum cardinality — and
 *  therefore the shortfall count — is unchanged. */
function kuhnMatch(offices: number[], adj: Map<number, number[]>): Map<number, number> {
  const matchT = new Map<number, number>();  // ti -> oi
  const tryOne = (oi: number, seen: Set<number>): boolean => {
    for (const ti of adj.get(oi) ?? []) {
      if (seen.has(ti)) continue;
      seen.add(ti);
      const cur = matchT.get(ti);
      if (cur === undefined || tryOne(cur, seen)) { matchT.set(ti, oi); return true; }
    }
    return false;
  };
  for (const oi of offices) {
    const free = (adj.get(oi) ?? []).find((ti) => !matchT.has(ti));
    if (free !== undefined) matchT.set(free, oi);
    else tryOne(oi, new Set());
  }
  return matchT;
}

// ── Outcomes ────────────────────────────────────────────────────────────────
export type Escalation =
  | { why: "pan-split"; pans: string[]; officeCount: number }
  | { why: "ambiguous"; rivalTis: number[] }
  | { why: "better-claimant"; rivalOfficeName: string; rivalPan: string | null };

export interface Outcome {
  oi: number;
  ti: number | null;
  ev: Evidence | null;
  ne: NameEvidence | null;
  tier: TierId | null;
  /** Ledger rows in the committed evidence class — drives the "they pair 1:1"
   *  explanation for legitimately identical bills. */
  classSize: number;
  /** The committed block held 2+ office records but only some carry a PAN. A blank
   *  PAN is a data-quality defect (PAN is mandatory on a TDS return), so we say so
   *  rather than silently assuming one party. */
  panBlankMixed: boolean;
  suggest: boolean;
  escalation: Escalation | null;
  nearest: { ti: number; consumed: boolean; ev: Evidence } | null;
  exhaustion: { ledgerCount: number; officeCount: number } | null;
}

export interface AssignmentResult {
  outcomes: Outcome[];          // one per office, in input order
  surplus: number[];            // unconsumed in-window ledger positions
  basisFor: (section: string | null) => "tds" | "amount";
}

export function assign(offices: AsgOffice[], ledger: AsgLedger[], partyMap: Record<string, string> = {}): AssignmentResult {
  const norm = (s: string | null | undefined) => normalizeName(s);

  // nameEvidence is the expensive primitive (token alignment + edit distance) and
  // the same name pairs recur constantly across a ledger. Memoise once, here.
  const neCache = new Map<string, NameEvidence>();
  const ne = (a: string | null, b: string | null): NameEvidence => {
    const k = `${a ?? ""} ${b ?? ""}`;
    let v = neCache.get(k);
    if (!v) { v = nameEvidence(a, b); neCache.set(k, v); }
    return v;
  };

  // ── Run context: everything below is DERIVED FROM THE DATA. No parameters, no
  //    hardcoded quarters, no FY boundaries, no client-specific anything.

  /** Per-SECTION amount-basis vote. The credit in a Tally ledger may be the TDS
   *  amount (a TDS-liability ledger) or the principal (an expense ledger). The old
   *  engine guessed PER ROW, so a single coincidence flipped it. A Tally ledger is
   *  one account per section, so per-section is the right granularity (a file-wide
   *  vote would smear a 194C expense ledger together with a 194A TDS ledger).
   *  Ties resolve to "tds", preserving today's behaviour. */
  const basisBySection = new Map<string, "tds" | "amount">();
  {
    const byIso = new Map<string, AsgLedger[]>();
    for (const t of ledger) if (t.iso) push(byIso, t.iso, t);
    const tally = new Map<string, { tds: number; amt: number }>();
    for (const o of offices) {
      if (!o.dateIso) continue;
      const key = o.section ?? "";
      const acc = tally.get(key) ?? { tds: 0, amt: 0 };
      for (const t of byIso.get(o.dateIso) ?? []) {
        if ((t.section ?? "") !== key) continue;
        if (amountsMatch(t.credit, o.tds)) acc.tds++;
        if (amountsMatch(t.credit, o.amount)) acc.amt++;
      }
      tally.set(key, acc);
    }
    for (const [k, v] of tally) basisBySection.set(k, v.amt > v.tds ? "amount" : "tds");
  }
  const basisFor = (section: string | null): "tds" | "amount" => basisBySection.get(section ?? "") ?? "tds";

  /** The filing window, derived from the OFFICE RECORDS' OWN DATE SPAN — so there is
   *  no quarter parameter, no hardcoded FY boundary and no 31-Mar/2-Apr argument.
   *  Applied ONLY to date-relaxed edges; exact-date edges are self-bounding. This is
   *  what stops an August credit pairing with a Q4 record in the residue closer. */
  const officeDays = offices.map((o) => dayNum(o.dateIso)).filter((d): d is number => d !== null);
  const winLo = officeDays.length ? Math.min(...officeDays) - 15 : null;
  const winHi = officeDays.length ? Math.max(...officeDays) + 15 : null;
  const inWindow = (t: AsgLedger): boolean => {
    if (winLo === null || winHi === null) return true;
    const d = dayNum(t.iso);
    if (d === null) return true;         // cannot prove it is out of window
    return d >= winLo && d <= winHi;
  };

  const sectionEqOf = (a: string | null, b: string | null) => (a && b ? a === b : true);

  const evidenceFor = (o: AsgOffice, t: AsgLedger): { ev: Evidence; ne: NameEvidence } => {
    const nev = ne(o.name, t.party);
    const od = dayNum(o.dateIso), td = dayNum(t.iso);
    const tdsOk = amountsMatch(t.credit, o.tds);
    const amtOk = amountsMatch(t.credit, o.amount);
    const secBasis = basisFor(o.section);
    const amountExact = secBasis === "tds" ? tdsOk : amtOk;
    const mappedTo = partyMap[norm(o.name)];
    return {
      ne: nev,
      ev: {
        nameTier: nev.tier,
        dateDelta: od !== null && td !== null ? td - od : null,
        basis: amountExact ? secBasis : tdsOk ? "tds" : amtOk ? "amount" : null,
        amountExact,
        sectionEq: sectionEqOf(o.section, t.section),
        mapped: !!mappedTo && norm(t.party) === norm(mappedTo),
      },
    };
  };

  // ── Edges. Built only where SOME corroboration exists, so nameEvidence is never
  //    called on the full O x T cross product. A mapped pair always gets an edge
  //    even with no corroboration (see TierDef.needsCorroboration).
  const edges: Edge[] = [];
  for (let oi = 0; oi < offices.length; oi++) {
    const o = offices[oi];
    if (o.assignable === false) continue;   // in the universe, out of the assignment
    const mappedTo = partyMap[norm(o.name)];
    for (let ti = 0; ti < ledger.length; ti++) {
      const t = ledger[ti];
      const dateEq = !!o.dateIso && !!t.iso && o.dateIso === t.iso;
      const moneyEq = amountsMatch(t.credit, o.tds) || amountsMatch(t.credit, o.amount);
      const isMapped = !!mappedTo && norm(t.party) === norm(mappedTo);
      if (!dateEq && !moneyEq && !isMapped) continue;
      const { ev, ne: nev } = evidenceFor(o, t);
      edges.push({ oi, ti, ev, ne: nev });
    }
  }
  // Index once. Scanning the whole edge list per office to build a reason is
  // O(offices x edges) and dominated everything: 2000x2000 took 14.1s before this,
  // and this engine runs in the browser on the user's click.
  const edgesByO = new Map<number, Edge[]>();
  for (const e of edges) push(edgesByO, e.oi, e);

  const usedO = new Set<number>();
  const usedT = new Set<number>();
  const committed = new Map<number, { ti: number; ev: Evidence; ne: NameEvidence; tier: TierId; classSize: number; panBlankMixed: boolean }>();
  const escalated = new Map<number, Escalation>();

  const corroborated = (ev: Evidence) => ev.dateDelta === 0 || ev.basis !== null;

  /** The filing window, applied to DATE-RELAXED edges at EVERY tier — not just in the
   *  residue closer.
   *
   *  The merged spec bounded only the residue. That leaves a hole: an A-tier edge
   *  needs the name plus EITHER the date or the money, so a name-exact, amount-exact
   *  credit with an unbounded date is admissible at A1. Executed: an office record
   *  dated 05-Mar-26 paired at A1 with a byte-identical KONE credit from 11-Aug-25 —
   *  a different quarter's bill for the same recurring amount, which is exactly how a
   *  monthly contract looks — and reported "Date Mismatch by 206 days". That drags an
   *  out-of-period credit into the filing and hides the fact that THIS quarter's entry
   *  is genuinely missing. The spec's own rationale for the window ("what stops an
   *  August credit pairing with a Q4 record") applies here verbatim; it just named the
   *  wrong pass. Exact-date edges are self-bounding and are never window-checked. */
  const inScope = (e: Edge) => e.ev.dateDelta === 0 || inWindow(ledger[e.ti]);

  const admissible = (tier: TierDef, e: Edge) =>
    e.ev.sectionEq                                      // HARD at every A-tier: a 194C
                                                        // deduction cannot legally be a
                                                        // 194J one. Relaxed ONLY in the
                                                        // residue closer, which reports
                                                        // "Section Mismatch" rather than
                                                        // ever producing a silent Match.
    && inScope(e)
    && (!tier.needsCorroboration || corroborated(e.ev))
    && tier.admits(e.ev);

  /** The unique Pareto-best signature among a node's live edges, or null if two are
   *  INCOMPARABLE (genuine competition — a human question, not a tie to break).
   *
   *  Because sigOf() is exactly dominance's field projection, `maximal` is provably
   *  non-empty: a finite strict partial order always has a maximal element. So a null
   *  here always means "2+ genuinely incomparable candidates" and never the empty-set
   *  accident described on sigOf(). The length check still reads `!== 1` so that a
   *  future drift fails CLOSED (escalate) rather than silently picking. */
  const uniqueBestSig = (es: Edge[]): string | null => {
    const sigs = new Map<string, Evidence>();
    for (const e of es) sigs.set(sigOf(e.ev), e.ev);
    const entries = [...sigs.entries()];
    const maximal = entries.filter(([s, ev]) => !entries.some(([s2, ev2]) => s2 !== s && dominates(ev2, ev)));
    return maximal.length === 1 ? maximal[0][0] : null;
  };

  /** One pass of one tier, run to a FIXPOINT: committing a pair consumes a rival's
   *  competitor, which can resolve an ambiguity that existed a moment ago. Iterating
   *  is how "exhaust all comparison methods before reporting a mismatch" is actually
   *  delivered rather than merely claimed. */
  function runTier(tier: TierDef): void {
    // Admissibility does not change as the pass runs, only consumption does — so test
    // it ONCE and then whittle the surviving pool, instead of re-filtering every edge
    // in the run on every fixpoint iteration.
    let pool = edges.filter((e) => admissible(tier, e));
    for (;;) {
      pool = pool.filter((e) => !usedO.has(e.oi) && !usedT.has(e.ti));
      const live = pool;
      if (!live.length) return;

      const byO = new Map<number, Edge[]>(), byT = new Map<number, Edge[]>();
      for (const e of live) { push(byO, e.oi, e); push(byT, e.ti, e); }

      const oBest = new Map<number, string>(), tBest = new Map<number, string>();
      for (const [oi, es] of byO) {
        const s = uniqueBestSig(es);
        if (s) oBest.set(oi, s);
        else escalated.set(oi, { why: "ambiguous", rivalTis: [...new Set(es.map((e) => e.ti))].sort((a, b) => a - b) });
      }
      for (const [ti, es] of byT) { const s = uniqueBestSig(es); if (s) tBest.set(ti, s); }

      // MUTUALLY best — uniquely best for the office record AND for the ledger row.
      // Every edge in a connected component of this graph provably shares ONE
      // signature (an edge's sig equals both endpoints' best), so each component IS
      // an evidence class. The class collapse falls out; nothing computes it.
      const mutual = live.filter((e) => oBest.get(e.oi) === sigOf(e.ev) && tBest.get(e.ti) === sigOf(e.ev));
      if (!mutual.length) return;

      // Connected components over the mutually-best graph. Union-find on "o<i>"/"t<i>"
      // node keys — offices and ledger rows share one namespace, so the prefix is what
      // keeps office 3 and ledger row 3 from being merged into one node.
      const parent = new Map<string, string>();
      const find = (x: string): string => { const p = parent.get(x); if (!p || p === x) return x; const r = find(p); parent.set(x, r); return r; };
      const union = (a: string, b: string) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); };
      for (const e of mutual) { const a = `o${e.oi}`, b = `t${e.ti}`; if (!parent.has(a)) parent.set(a, a); if (!parent.has(b)) parent.set(b, b); union(a, b); }
      const blocks = new Map<string, Edge[]>();
      for (const e of mutual) push(blocks, find(`o${e.oi}`), e);

      let progress = false;
      for (const [, es] of blocks) {
        const os = [...new Set(es.map((e) => e.oi))].sort((a, b) => a - b);
        const ts = [...new Set(es.map((e) => e.ti))].sort((a, b) => a - b);

        // THE PAN SPLIT. Indistinguishable office records are ONE deductee only if
        // they are one PARTY. Two different Ramesh Patels with different PANs sharing
        // a date and an amount is a genuine 50/50 that only the user's invoice can
        // settle. A choice among TRUE indistinguishables cannot be got wrong; a
        // choice between two real people can.
        const panList = os.map((oi) => normalizePan(offices[oi].pan));
        const pans = new Set(panList.filter(Boolean));
        if (os.length >= 2 && pans.size >= 2) {
          for (const oi of os) escalated.set(oi, { why: "pan-split", pans: [...pans].sort(), officeCount: os.length });
          continue;   // consume nothing: the rows stay available and the user decides
        }
        const panBlankMixed = os.length >= 2 && pans.size === 1 && panList.some((p) => !p);

        const adj = new Map<number, number[]>();
        for (const oi of os) adj.set(oi, es.filter((e) => e.oi === oi).map((e) => e.ti).sort((a, b) => a - b));
        const matchT = kuhnMatch(os, adj);
        for (const [ti, oi] of matchT) {
          const e = es.find((x) => x.oi === oi && x.ti === ti)!;
          usedO.add(oi); usedT.add(ti);
          escalated.delete(oi);
          committed.set(oi, { ti, ev: e.ev, ne: e.ne, tier: tier.id, classSize: ts.length, panBlankMixed });
          progress = true;
        }
      }
      if (!progress) return;
    }
  }

  for (const tier of TIERS) if (tier.autoCommit) runTier(tier);

  // ── RESIDUE CLOSER — forced by elimination. Commits a PAIRING, never a "Matched".
  //
  // In a connected component of what the ladder left, if exactly ONE unmatched office
  // record and ONE unmatched ledger row remain and each is the other's only remaining
  // possibility, THE PAIRING IS FORCED — no alternative hypothesis exists. This is
  // the mechanism that delivers "make every reasonable attempt to find the correct
  // match; only report a mismatch when all methods are exhausted". Without it the
  // engine emits a bare "not found" while the answer sits there unclaimed.
  //
  // Cross-section edges are admitted HERE ONLY, which revives "Section Mismatch" as a
  // real verdict for a genuinely misclassified booking without ever letting a section
  // disagreement produce a silent Match.
  let resPool = edges.filter((e) => corroborated(e.ev) && inScope(e));
  for (;;) {
    resPool = resPool.filter((e) => !usedO.has(e.oi) && !usedT.has(e.ti));
    const live = resPool;
    if (!live.length) break;

    const byO = new Map<number, Edge[]>(), byT = new Map<number, Edge[]>();
    for (const e of live) { push(byO, e.oi, e); push(byT, e.ti, e); }

    let progress = false;
    for (const [oi, es] of byO) {
      if (es.length !== 1) continue;                 // this office has a choice
      const e = es[0];
      if ((byT.get(e.ti) ?? []).length !== 1) continue;  // that row has other suitors
      usedO.add(oi); usedT.add(e.ti);
      escalated.delete(oi);
      committed.set(oi, { ti: e.ti, ev: e.ev, ne: e.ne, tier: "RESIDUE", classSize: 1, panBlankMixed: false });
      progress = true;
    }
    if (!progress) break;
  }

  // ── THE DISTINCTNESS WITNESS (suggestion quality) ───────────────────────────
  //
  // A SUGGESTION is nearly as dangerous as an auto-match, because it is ONE CLICK
  // from becoming an asserted identity that silently auto-matches for ever. So it is
  // exclusivity-gated exactly like a match.
  //
  // Grounded ENTIRELY in this client's own data — nothing about PATEL/PATIL is
  // written down anywhere. Authority: two office deductees with DIFFERENT PANs ARE
  // different parties (proof, not heuristic); two distinct ledger accounts are
  // presumed different parties; same PAN ⇒ same party ⇒ not a rival.
  //
  // Evaluated over the WHOLE universe — every office record and every ledger row,
  // ignoring section, date, amount and consumption — deliberately WIDER than the live
  // pool, because a rival absent from the pool is still proof that this client's books
  // keep the two spellings apart.
  // Indexed by DISTINCT NAME, not by record: the witness asks "does this client's book
  // keep another spelling apart from this one?", which is a question about names. A
  // client with 2000 deductees has a couple of hundred distinct names at most, so this
  // is the difference between a scan per record and a scan per spelling.
  const officeNames = new Map<string, { name: string | null; pans: Set<string> }>();
  for (const o of offices) {
    const k = norm(o.name);
    let v = officeNames.get(k);
    if (!v) { v = { name: o.name, pans: new Set<string>() }; officeNames.set(k, v); }
    const p = normalizePan(o.pan);
    if (p) v.pans.add(p);
  }
  const ledgerNames = new Map<string, string | null>();
  for (const t of ledger) { const k = norm(t.party); if (!ledgerNames.has(k)) ledgerNames.set(k, t.party); }

  const betterClaimant = (oi: number, ti: number, baseTier: NameTier): Escalation | null => {
    const t = ledger[ti], o = offices[oi];
    const mine = rank(baseTier);
    const myPan = normalizePan(o.pan);
    const myKey = norm(o.name);
    for (const [k, v] of officeNames) {
      if (k === myKey) continue;                          // not a distinct spelling
      // Same PAN ⇒ same party ⇒ not a rival. Only skip when every record carrying the
      // rival spelling is attested under MY pan; a single unattributed one leaves it
      // a genuine rival.
      if (myPan && v.pans.size > 0 && [...v.pans].every((p) => p === myPan)) continue;
      if (rank(ne(v.name, t.party).tier) < mine) {
        return { why: "better-claimant", rivalOfficeName: v.name ?? "—", rivalPan: [...v.pans][0] ?? null };
      }
    }
    const tKey = norm(t.party);
    for (const [k, nm] of ledgerNames) {
      if (k === tKey) continue;                           // same ledger account
      if (rank(ne(o.name, nm).tier) < mine) {
        return { why: "better-claimant", rivalOfficeName: nm ?? "—", rivalPan: null };
      }
    }
    return null;
  };

  // ── Assemble ────────────────────────────────────────────────────────────────
  const outcomes: Outcome[] = offices.map((o, oi) => {
    const c = committed.get(oi);
    if (c) {
      const nameOk = c.ev.mapped || rank(c.ev.nameTier) <= AUTO_MATCH_MAX_RANK;
      let suggest = false;
      let escalation: Escalation | null = null;
      if (!nameOk) {
        // THE SUGGESTION GATE. Offer a one-click identity only when the names are at
        // least phonetically related (a), OR every fact corroborates despite an
        // unrelated name (b) — the trade-name / proprietor-name case, which is real
        // and which the user asserts once. Never on amount-only evidence: that is
        // exactly what produced XRAY ENTERPRISE -> "Yankee Enterprise", and a
        // confirmed mapping is for ever.
        const related = rank(c.ev.nameTier) <= 4;
        const fullyCorroborated = c.ev.dateDelta === 0 && c.ev.basis !== null && c.ev.sectionEq;
        if (related || fullyCorroborated) {
          const rival = betterClaimant(oi, c.ti, c.ev.nameTier);
          if (rival) escalation = rival; else suggest = true;
        }
      }
      return {
        oi, ti: c.ti, ev: c.ev, ne: c.ne, tier: c.tier, classSize: c.classSize,
        panBlankMixed: c.panBlankMixed, suggest, escalation, nearest: null, exhaustion: null,
      };
    }

    // Unmatched. Build the material for a reason that is never a bare shrug.
    const esc = escalated.get(oi) ?? null;

    // NEAR MISS: the closest row we can point at, consumed or not, so the user learns
    // WHY rather than being sent hunting.
    const mine = edgesByO.get(oi) ?? [];
    let nearest: Outcome["nearest"] = null;
    {
      const cands = mine
        .filter((e) => e.ev.sectionEq && inScope(e))
        .sort((a, b) =>
          rank(a.ev.nameTier) - rank(b.ev.nameTier)
          || Math.abs(a.ev.dateDelta ?? 9999) - Math.abs(b.ev.dateDelta ?? 9999)
          || (a.ev.amountExact ? 0 : 1) - (b.ev.amountExact ? 0 : 1)
          || a.ti - b.ti);
      if (cands.length) nearest = { ti: cands[0].ti, consumed: usedT.has(cands[0].ti), ev: cands[0].ev };
    }

    // CARDINALITY EXHAUSTION is a real audit finding, not a shrug: the ledger holds
    // N entries for this party/date/amount and Office Data holds N+1, so the ledger
    // appears short by one entry.
    let exhaustion: Outcome["exhaustion"] = null;
    {
      const strong = mine.filter((e) =>
        e.ev.sectionEq && e.ev.dateDelta === 0
        && e.ev.basis !== null && rank(e.ev.nameTier) <= AUTO_MATCH_MAX_RANK);
      if (strong.length && strong.every((e) => usedT.has(e.ti))) {
        const twins = offices.filter((p, pi) =>
          pi === oi || (p.dateIso === o.dateIso
            && (p.section ?? "") === (o.section ?? "")
            && amountsMatch(p.tds, o.tds) && amountsMatch(p.amount, o.amount)
            && rank(ne(p.name, o.name).tier) <= 1)).length;
        if (twins > strong.length) exhaustion = { ledgerCount: strong.length, officeCount: twins };
      }
    }

    return {
      oi, ti: null, ev: null, ne: null, tier: null, classSize: 0, panBlankMixed: false,
      suggest: false, escalation: esc, nearest, exhaustion,
    };
  });

  // A ledger credit no office record claimed is a deduction in Tally with NO RETURN
  // LINE: real liability, invisible today. Reconciliation is symmetric or it is not
  // reconciliation.
  const surplus = ledger.filter((t, ti) => !usedT.has(ti) && inWindow(t)).map((t) => t.pos);

  return { outcomes, surplus, basisFor };
}
