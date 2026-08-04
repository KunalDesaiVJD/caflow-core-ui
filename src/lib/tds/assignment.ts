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

// NOTE the ".ts" extension: this file is copied BYTE-IDENTICALLY to
// supabase/functions/_shared/assignment.ts, where Deno requires an explicit
// extension on relative imports. Vite/TS resolve "./match.ts" fine
// (allowImportingTsExtensions + bundler resolution), so the SAME text is valid in
// both runtimes and the byte-identity guard in sharedSync.test.ts can hold.
import {
  rank, nameEvidence, type NameTier, type NameEvidence,
  normalizeName, normalizePan, amountsMatch, canonicalSection, salaryBareCompatible,
} from "./match.ts";

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
  /** The counterpart's PAN, when this side HAS one. A Stage-3 Tally ledger row has NO
   *  PAN, so this is undefined there and every PAN-dependent rule below is inert. A
   *  Stage-1 imported client row DOES carry a PAN, so both sides do — and PAN then
   *  becomes the strongest evidence tier (see the APAN rung) and a PAN DIFFERENCE
   *  blocks a pairing outright (see the edge loop). One engine, two data shapes. */
  pan?: string | null;
}

// ── Evidence ─────────────────────────────────────────────────────────────────
export interface Evidence {
  /** Both sides carry a PAN and they are EQUAL. PAN is the legal identity on a TDS
   *  return, so this is the strongest identity signal there is — stronger than any
   *  name (two different people can share a name; they cannot share a PAN). Always
   *  false in Stage 3 (a Tally ledger row has no PAN), so it changes nothing there. */
  panEq: boolean;
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
  `${e.panEq ? 1 : 0}|${e.mapped ? 1 : 0}|${e.nameTier}|${Math.abs(e.dateDelta ?? 9999)}|${e.basis ? 1 : 0}|${e.amountExact ? 1 : 0}|${e.sectionEq ? 1 : 0}`;

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
    (a.panEq ? 0 : 1) <= (b.panEq ? 0 : 1) &&
    rank(a.nameTier) <= rank(b.nameTier) &&
    dd(a) <= dd(b) &&
    (a.basis ? 0 : 1) <= (b.basis ? 0 : 1) &&
    (a.amountExact ? 0 : 1) <= (b.amountExact ? 0 : 1) &&
    (a.sectionEq ? 0 : 1) <= (b.sectionEq ? 0 : 1) &&
    (a.mapped ? 0 : 1) <= (b.mapped ? 0 : 1);
  return noWorse && sigOf(a) !== sigOf(b);
}

// ── The tier ladder ─────────────────────────────────────────────────────────
export type TierId = "APAN" | "A0" | "A1" | "A2" | "A3" | "A4" | "RESIDUE";

interface TierDef {
  id: TierId;
  label: string;
  /** Whether this tier commits its mutually-exclusive pairings in the ladder. ALL
   *  tiers now do, including A4 (RISKY: PATEL/PATIL), and here is why that is safe:
   *
   *  A committed pairing is NOT a Match. Whether a committed pair is reported "Matched"
   *  is governed by AUTO_MATCH_MAX_RANK — a SECOND, independent gate — so a rank-4
   *  spelling guess commits a PAIRING but is reported "Party Name Mismatch" with a
   *  suggestion, never a filed return. Two edits to two different places would be
   *  needed to turn a guess into a match; no single one can.
   *
   *  A4 used to be autoCommit:false, deferring risky names to the residue closer. That
   *  closer only commits a pair when the office record has exactly ONE edge AND its row
   *  has exactly ONE suitor. Real deductions bunch on month-end, so on any 31-Mar block
   *  every uncommitted record is adjacent to every unclaimed row, both degree tests
   *  fail, and the closer commits NOTHING — a tier-4 name like TARUBEN/Taruben S paired
   *  in a 1×1 unit test but never on a real Q4 ledger. Running A4 through the tier's own
   *  EVIDENCE-DOMINANCE (uniquely-best-for-both) picks the counterpart correctly on a
   *  crowded block, where degree-1 exclusivity cannot. Degree-1 is not exclusivity;
   *  evidence-dominance is. For a genuinely 1×1 case the two paths give the identical
   *  outcome, so this only ever ADDS resolutions, never changes an existing one. */
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
 *
 * A1 (EXACT) PRECEDES A0 (ASSERTED) on purpose. A saved mapping is the user's stored
 * assertion that a differently-spelled office name refers to a ledger party; it must
 * beat every weaker INFERENCE (A2/A3/A4) for its row, but it must YIELD to a direct,
 * corroborated EXACT-name claim from a different office record. Running A0 first let a
 * stale or over-broad mapping steal a row from the record whose name IS that party
 * verbatim — a silent wrong-PAN filing. With A1 first, the verbatim owner takes its row
 * and the mapping, denied it, is reported rather than silently mis-committed. A0 still
 * precedes A2/A3/A4, so the user's assertion still outranks every inferred match.
 */
export const TIERS: TierDef[] = [
  // PAN EQUALITY — the legal identity, and therefore the STRONGEST rung, above even an
  // exact name. Two records that both carry a PAN and agree on it ARE the same deductee;
  // WHICH of that party's several transactions pairs with which is then settled by
  // evidence-dominance (date/amount) within the block, exactly as identical names are.
  // needsCorroboration:false for the same reason A0 is exempt — the PAN IS the
  // corroboration, so a same-PAN pair whose date AND amount are both wrong must still be
  // FOUND and reported (as a Date/Amount mismatch), never left as a phantom "not found".
  // Inert in Stage 3: a Tally ledger row has no PAN, so ev.panEq is always false and this
  // rung never admits an edge there — the ladder behaves byte-identically to before.
  { id: "APAN", label: "PAN", autoCommit: true, needsCorroboration: false, admits: (ev) => ev.panEq },
  // Same string, or the same tokens reordered. PATEL and PATIL are both consumed here
  // when both are present, which is what makes the risky tier unreachable. Runs BEFORE
  // A0 so a verbatim-name record is never out-competed by a saved mapping for its row.
  { id: "A1", label: "EXACT", autoCommit: true, needsCorroboration: true, admits: (ev) => rank(ev.nameTier) <= 1 },
  // The user asserted this identity. Not exclusive across parties — it is a fact, not an
  // inference — but still a sub-ladder among that party's own rows. Beats A2/A3/A4.
  { id: "A0", label: "ASSERTED", autoCommit: true, needsCorroboration: false, admits: (ev) => ev.mapped },
  // Abbreviation and vowel ELISION — TARUBEN/Taruben S, KATHARANI/KATHRANI.
  { id: "A2", label: "CANONICAL", autoCommit: true, needsCorroboration: true, admits: (ev) => rank(ev.nameTier) <= 3 },
  // No name to compare on one side. STRICT: with no name to tell two rows apart, a
  // rival is a real ambiguity, so demand every other fact exactly.
  {
    id: "A3", label: "FACTS_ONLY", autoCommit: true, needsCorroboration: true,
    admits: (ev) => ev.nameTier === "unknown" && ev.dateDelta === 0 && ev.amountExact,
  },
  // RISKY (rank 4: PATEL/PATIL). Commits its mutually-best pairing so tier-4 names
  // resolve on crowded month-end blocks — but AUTO_MATCH_MAX_RANK still withholds
  // "Matched", so this yields a suggestion, never a filed return. See TierDef.autoCommit.
  { id: "A4", label: "RISKY", autoCommit: true, needsCorroboration: true, admits: (ev) => rank(ev.nameTier) === 4 },
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

  // ── NO DATE WINDOW. Deliberate, and it replaced one. ────────────────────────
  //
  // A previous version bounded date-relaxed edges to the office records' own date
  // SPAN ± 15 days. That was the SAME bug this module exists to kill, moved from the
  // name axis to the date axis: it discarded a uniquely-best, name-exact, amount-exact
  // pairing by a fixed cutoff, and because the span is a property of how many records a
  // client happens to have, the SAME (office, ledger) pair got DIFFERENT verdicts for
  // different clients — the client-specific behaviour the user has demanded be removed.
  // Concretely it turned an ordinary year-end provision (deduction dated 31-Mar, ledger
  // booked 10-Apr) into a phantom "Ledger Entry Not Found" instead of a material,
  // actionable "Date Mismatch by 10 days", and it silently voided saved mappings whose
  // date was out of range.
  //
  // The window's ONE legitimate job — stop a recurring monthly amount on an
  // out-of-period credit (an Aug-25 bill) being dragged into a Q4 filing — is already
  // done by EXCLUSIVITY, not a cutoff: when this quarter's entry is present it carries
  // dateDelta 0 and strictly dominates the stale one, so the near entry wins and the
  // stale one is left as surplus. Only when this quarter's entry is genuinely ABSENT
  // does the stale credit pair, and it is then reported as a large "Date Mismatch" —
  // never a silent Match (the verdict is driven by dateDelta, and AUTO_MATCH_MAX_RANK
  // is a name gate) — which correctly tells the CA the current entry is missing.
  // Widening the candidate set this way also makes the RISKY rung LESS likely to fire,
  // not more, because a rival that a window would have hidden is now visible to compete.

  const sectionEqOf = (a: string | null, b: string | null) => (a && b ? a === b || salaryBareCompatible(a, b) : true);

  const evidenceFor = (o: AsgOffice, t: AsgLedger): { ev: Evidence; ne: NameEvidence } => {
    const nev = ne(o.name, t.party);
    const od = dayNum(o.dateIso), td = dayNum(t.iso);
    const tdsOk = amountsMatch(t.credit, o.tds);
    const amtOk = amountsMatch(t.credit, o.amount);
    const secBasis = basisFor(o.section);
    const amountExact = secBasis === "tds" ? tdsOk : amtOk;
    const mappedTo = partyMap[norm(o.name)];
    const oPan = normalizePan(o.pan), tPan = normalizePan(t.pan);
    return {
      ne: nev,
      ev: {
        panEq: !!oPan && !!tPan && oPan === tPan,
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
    const oPan = normalizePan(o.pan);
    for (let ti = 0; ti < ledger.length; ti++) {
      const t = ledger[ti];
      // A PAN DIFFERENCE is proof of NON-identity: when BOTH sides carry a PAN and the
      // two disagree, they are different parties and must NEVER pair — no edge, so no
      // tier and no residue closer can ever join them (this is the cross-side twin of
      // the pan-split rule below). Inert in Stage 3, where the ledger side has no PAN.
      const tPan = normalizePan(t.pan);
      if (oPan && tPan && oPan !== tPan) continue;
      const panEq = !!oPan && !!tPan && oPan === tPan;
      const dateEq = !!o.dateIso && !!t.iso && o.dateIso === t.iso;
      // A NULL imported credit must never manufacture an edge on its own: amountsMatch
      // coalesces null to 0, so without this guard a completely blank/garbage ledger
      // row (credit=null) spuriously "matches" any office record whose own tds/amount
      // is genuinely 0 (e.g. a low-salary employee under the 192B threshold) — and once
      // that's the only surviving candidate for a PAN, the RESIDUE closer force-pairs it
      // (no sectionEq required), producing a fabricated "Name/PAN/Date/Amount differ"
      // report instead of correctly falling through to office_only. A genuinely-zero
      // credit (t.credit === 0, not null) must still be free to match a zero office
      // figure — only null is excluded here.
      const moneyEq = t.credit != null && (amountsMatch(t.credit, o.tds) || amountsMatch(t.credit, o.amount));
      const isMapped = !!mappedTo && norm(t.party) === norm(mappedTo);
      // PAN equality is proof of identity, so — like a saved mapping — it earns an edge
      // on its own even with no date/amount corroboration (the figures are then compared
      // and any difference REPORTED, never used to withhold the pairing).
      if (!dateEq && !moneyEq && !isMapped && !panEq) continue;
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

  const admissible = (tier: TierDef, e: Edge) =>
    (e.ev.sectionEq || e.ev.panEq)                      // sectionEq is HARD at every
                                                        // A-tier: a 194C deduction cannot
                                                        // legally be a 194J one, so with
                                                        // NO PAN the section is the only
                                                        // thing keeping two same-name
                                                        // parties apart. But a PAN EQUALITY
                                                        // already PROVES identity, so the
                                                        // section is then just a field to
                                                        // compare (via rate/AI downstream),
                                                        // not a gate — else a same-PAN pair
                                                        // with a mislabelled section would
                                                        // fail to pair at all. Inert in
                                                        // Stage 3 (panEq always false).
                                                        // Cross-section is still relaxed
                                                        // ONLY in the residue closer, which
                                                        // reports "Section Mismatch" rather
                                                        // than ever a silent Match.
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
  let resPool = edges.filter((e) => corroborated(e.ev));
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
  //
  // EVERY `ti` LEAVING THIS FUNCTION MUST BE ledger[ti].pos, NEVER THE RAW LOOP
  // INDEX. Internally, `ti` means "position within the `ledger` PARAMETER array"
  // (edges are built via `for (let ti = 0; ti < ledger.length; ti++)`) — but a
  // caller resolves an outgoing `ti` against its OWN original array via
  // `pos`-indexed lookup (tallyRecon.ts's `rowAt = (pos) => tally[pos]`), because
  // `ledger` here is USUALLY a FILTERED view of that original array (Stage 3
  // filters to non-zero credits) and `pos` is exactly the field AsgLedger.pos
  // documents as existing FOR THIS REASON — "position in the credits array...
  // Position is unique across the union by construction, so no caller can
  // reintroduce" the row_index collision. `surplus` below already does this
  // (`.map((t) => t.pos)`) — every `ti` produced in an Outcome must match that
  // same contract, or the moment the filter above ACTUALLY drops a row (a
  // genuine ₹0 credit entry, or any row preceding the first non-zero credit in
  // a multi-batch-combined ledger), every SUBSEQUENT pairing silently resolves
  // to the WRONG physical row — the office record's OWN evidence (name/date/
  // amount) is computed correctly, but the row rendered next to it is some
  // other entry entirely, shifted by however many rows were filtered ahead of
  // it. This reproduced BYTE-FOR-BYTE against a real client ledger (a payment
  // row before four deduction rows put every one of the four Credit Amount
  // Mismatch reasons next to a UNRELATED party — "Party and date match" text
  // beside a name that shares neither).
  const posOf = (ti: number) => ledger[ti].pos;

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
        oi, ti: posOf(c.ti), ev: c.ev, ne: c.ne, tier: c.tier, classSize: c.classSize,
        panBlankMixed: c.panBlankMixed, suggest, escalation, nearest: null, exhaustion: null,
      };
    }

    // Unmatched. Build the material for a reason that is never a bare shrug.
    const escRaw = escalated.get(oi) ?? null;
    const esc: Escalation | null = escRaw && escRaw.why === "ambiguous"
      ? { why: "ambiguous", rivalTis: escRaw.rivalTis.map(posOf) }
      : escRaw;

    // NEAR MISS: the closest row we can point at, consumed or not, so the user learns
    // WHY rather than being sent hunting.
    const mine = edgesByO.get(oi) ?? [];
    let nearest: Outcome["nearest"] = null;
    {
      const cands = mine
        .filter((e) => e.ev.sectionEq)
        // Tie-break on the ledger row's own CONTENT, never its array position: two
        // evidence-tied rows must name the same "closest" entry no matter what order
        // the ledger was imported in (verdicts are already order-independent; this
        // keeps the EXPLANATION order-independent too).
        .sort((a, b) =>
          rank(a.ev.nameTier) - rank(b.ev.nameTier)
          || Math.abs(a.ev.dateDelta ?? 9999) - Math.abs(b.ev.dateDelta ?? 9999)
          || (a.ev.amountExact ? 0 : 1) - (b.ev.amountExact ? 0 : 1)
          || (ledger[a.ti].party ?? "").localeCompare(ledger[b.ti].party ?? "")
          || (ledger[a.ti].credit ?? 0) - (ledger[b.ti].credit ?? 0)
          || (ledger[a.ti].iso ?? "").localeCompare(ledger[b.ti].iso ?? ""));
      if (cands.length) nearest = { ti: posOf(cands[0].ti), consumed: usedT.has(cands[0].ti), ev: cands[0].ev };
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
  // reconciliation. Reported WITHOUT a date filter — hiding an unclaimed credit because
  // it fell outside a date window is how a real deduction goes unreconciled on both
  // sides at once.
  const surplus = ledger.filter((t, ti) => !usedT.has(ti)).map((t) => t.pos);

  return { outcomes, surplus, basisFor };
}
