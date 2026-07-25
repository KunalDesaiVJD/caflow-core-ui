/**
 * STAGE-3 · Tally Ledger Reconciliation — the ADAPTER. All matching logic lives in
 * ./assignment.ts (pure, testable, no strings); this file resolves sections, shapes
 * the rows, and turns an assignment Outcome into a VERDICT and a reason a CA can act
 * on under a filing deadline.
 *
 * Office Data is the MASTER. A section-wise Tally ledger (194C / 194J / …) is
 * imported; its CREDIT entries ("By" rows) are the deductions. The credit amount may
 * be the TDS amount (a TDS-liability ledger) OR the principal (an expense ledger) —
 * the engine AUTO-DETECTS which by voting per section, so it works for any client's
 * ledger without a fixed assumption.
 *
 * Column IDENTIFICATION, NAME/DATE/AMOUNT normalisation and MATCHING all come from
 * the SHARED engine (columnEngine + match + assignment) so a fix there benefits every
 * stage. Only the Tally-specific STRUCTURE (title strip, By/To, Debit/Credit, no PAN)
 * is handled here.
 *
 * ── THE RULE THIS FILE ENFORCES ─────────────────────────────────────────────
 * EXCLUSIVITY BUYS THE COUNTERPART. ONLY CORROBORATION BUYS THE VERDICT.
 * The tier decides WHICH ledger entry we are confident enough to show. It never
 * decides whether the two records AGREE. A name-exact, amount-exact pair booked three
 * days out is a Date Mismatch to REPORT, not a Match to absorb: date_of_payment moves
 * the due date and the interest, so absorbing it files a defective return.
 */

// (the Excel/CSV ledger parser that needed columnEngine's value sniffers is gone —
//  Stage-3 reads Tally ledger PDFs only; see ./tallyPdf.ts)
import { canonicalSection, rank, normalizeName } from "./match";
import { assign, AUTO_MATCH_MAX_RANK, type AsgLedger, type AsgOffice, type Evidence, type Outcome } from "./assignment";

export interface TallyRow {
  row_index: number;
  date: string | null;        // raw date text
  iso: string | null;         // normalised yyyy-mm-dd
  party: string | null;       // ledger party name
  debit: number | null;
  credit: number | null;      // the deduction amount (TDS or principal — see amount_basis)
  vch_no: string | null;
  vch_type: string | null;
  // The TDS section this row belongs to, taken from ITS OWN sheet/ledger title.
  // Carried PER ROW (not per file) because a client's Tally dataset is normally
  // one ledger PER SECTION — spread across several sheets AND several files — and
  // an office 194A record must only ever be reconciled against 194A ledger rows.
  section: string | null;
}

// ── Reconciliation ───────────────────────────────────────────────────────────
export interface OfficeTxn {
  deductee_id: string; name: string | null; date_iso: string | null;
  amount: number | null; tds: number | null; section: string | null; pan?: string | null;
}
export type TallyResult =
  | "Matched" | "Date Mismatch" | "Credit Amount Mismatch" | "Party Name Mismatch"
  | "Section Mismatch" | "Ledger Entry Not Found" | "Multiple Possible Matches"
  // LEGACY — no longer produced. Identical ledger entries now pair 1:1 with the
  // identical office records instead of asking the user "which is correct?" for a
  // choice that cannot be got wrong. Kept only so results stored by an earlier run
  // still type-check when read back; a re-run clears them.
  | "Duplicate Ledger Entries"
  // No ledger for this office record's section was imported AT ALL. Distinct from
  // "Ledger Entry Not Found" (which means: we have that section's ledger, and the
  // entry isn't in it). Without this, importing only the 194C ledger reported every
  // 194A/194T office record as a missing entry — sending the user hunting for rows
  // that were never in scope, when the real action is "import the 194A ledger too".
  | "No Ledger for Section"
  // The mirror image of "Ledger Entry Not Found": a ledger CREDIT no office record
  // claimed (assignment.ts's `surplus`/reconcileTallyFull's `surplusLedger`) — a
  // deduction sitting in Tally with no line on the return. NOT produced by
  // reconcileTally()/reconcileTallyFull() themselves (both stay OFFICE-anchored,
  // one row per office record) — the adapter (TdsTallyRecon.tsx) assigns this label
  // when it turns a surplusLedger entry into its own displayed/persisted row, so
  // the checker can review and map a ledger-side record with no office counterpart
  // the same way an unmatched office record is reviewed and mapped today.
  | "Office Data Not Found";

export interface TallyReconRow {
  office_deductee_id: string;
  office_name: string | null; office_date: string | null; office_amount: number | null; office_tds: number | null; office_section: string | null;
  tally_row_index: number | null; tally_party: string | null; tally_date: string | null; tally_credit: number | null;
  result: TallyResult;
  amount_basis: "tds" | "amount" | null;   // which office figure the credit matched
  reason: string;
  confidence: number;                       // 0..100
  suggested_party?: string;                 // for Party Name Mismatch → possible mapping
  mapped?: boolean;                         // a saved party mapping was used
}

/** Saved per-client party mappings: normalised office name → tally party name. */
export type PartyMap = Record<string, string>;

const inr = (v: number | null | undefined) => (v == null ? "—" : `₹${Math.round(v).toLocaleString("en-IN")}`);
const days = (n: number) => `${n} day${n === 1 ? "" : "s"}`;

/**
 * Reconcile every OFFICE record against the imported Tally ledger.
 *
 * SIGNATURE UNCHANGED — the production call site (TdsTallyRecon.tsx) and the pinned
 * tests bind to exactly this. `ledgerSection` is vestigial in production (the call
 * site always passes null; sections ride per row) but is kept for the tests and as
 * the fallback for rows imported before per-row section existed.
 */
export function reconcileTally(office: OfficeTxn[], tally: TallyRow[], ledgerSection: string | null, partyMap: PartyMap = {}): TallyReconRow[] {
  return reconcileTallyFull(office, tally, ledgerSection, partyMap).rows;
}

/**
 * ADDITIVE — so surplus ships without touching reconcileTally's signature, the call
 * site, the DB schema or the UI.
 *
 * `surplusLedger` is every in-window ledger credit that NO office record claimed: a
 * deduction sitting in Tally with no line on the return. That is real liability and
 * it is invisible today, because the old engine only ever walked the office side.
 * Reconciliation is symmetric or it is not reconciliation. UI/schema in phase 2.
 */
export function reconcileTallyFull(
  office: OfficeTxn[], tally: TallyRow[], ledgerSection: string | null, partyMap: PartyMap = {},
): { rows: TallyReconRow[]; surplusLedger: TallyRow[] } {
  // Each ledger entry may be claimed by at most ONE office record. The engine keys on
  // POSITION IN THIS ARRAY, never row_index — see AsgLedger.pos for the bug that
  // caused (row_index is unique only within its own file).
  const credits = tally
    .map((t, i) => ({ t, k: i }))
    .filter((c) => c.t.credit != null && c.t.credit !== 0);

  // Which sections the imported ledgers actually cover. A row with no section of
  // its own falls back to `ledgerSection` (a single-section file whose title said
  // so). If NOTHING carries a section we can't scope by section at all, so every
  // row stays eligible (old behaviour) rather than wrongly excluding everything.
  const sectionOf = (t: TallyRow) => canonicalSection(t.section) ?? canonicalSection(ledgerSection);
  const covered = new Set<string>();
  for (const { t } of credits) { const s = sectionOf(t); if (s) covered.add(s); }
  const sectionScoped = covered.size > 0;

  const base = (o: OfficeTxn) => ({
    office_deductee_id: o.deductee_id, office_name: o.name, office_date: o.date_iso,
    office_amount: o.amount, office_tds: o.tds, office_section: o.section,
  });
  const nullTally = { tally_row_index: null, tally_party: null, tally_date: null, tally_credit: null };

  // An office record whose section was never imported is NOT a matching question — the
  // action is "import that ledger", not "hunt for a row". So it is marked UNASSIGNABLE:
  // it gets no edges and can never consume a ledger row (otherwise the residue closer,
  // which relaxes section deliberately, would pair it cross-section and cry "Section
  // Mismatch" when the true answer is that the ledger is missing).
  //
  // It is still PASSED to the engine, because it is still a deductee in this client's
  // books and the distinctness witness must see it. Ledger coverage must not erase a
  // deductee — see AsgOffice.assignable for the wrong mapping that caused.
  const unassignable = (o: OfficeTxn): string | null => {
    const oSec = canonicalSection(o.section);
    return sectionScoped && oSec && !covered.has(oSec) ? oSec : null;
  };

  const asgOffice: AsgOffice[] = office.map((o) => ({
    id: o.deductee_id, name: o.name, dateIso: o.date_iso,
    amount: o.amount, tds: o.tds, section: canonicalSection(o.section), pan: o.pan ?? null,
    assignable: !unassignable(o),
  }));
  const asgLedger: AsgLedger[] = credits.map(({ t, k }) => ({
    pos: k, party: t.party, iso: t.iso, credit: t.credit, section: sectionOf(t),
  }));
  const rowAt = (pos: number) => tally[pos];

  const { outcomes, surplus } = assign(asgOffice, asgLedger, partyMap);

  const rows = office.map((o, i) => {
    const missing = unassignable(o);
    if (missing) {
      return {
        ...base(o), ...nullTally, result: "No Ledger for Section" as const, amount_basis: null,
        reason: `No Tally ledger for section ${missing} has been imported (imported: ${[...covered].sort().join(", ")}). Import that section's ledger to reconcile this record.`,
        confidence: 0,
      };
    }
    return render(o, outcomes[i], rowAt, ledgerSection, sectionOf);
  });

  return { rows: applySplitEntryGrouping(rows, office), surplusLedger: surplus.map(rowAt) };
}

// A flat ₹1 floor — never a percentage of the transaction — because this is
// verifying a SUM of otherwise-unrelated rows against a target, not comparing
// two readings of the SAME figure. amountsMatch()'s sliding tolerance (up to
// 0.5%, capped by AMOUNT_ROUNDING_MAX) exists for the latter; reusing it here
// let a leftover as large as several tens of rupees fold onto an ALREADY
// fully-matched anchor merely for being "small enough", which is exactly how
// a genuinely separate, unrelated deduction gets silently hidden. ₹1 covers a
// single-rupee rounding artefact and nothing more.
const SPLIT_FOLD_TOLERANCE = 1;

/**
 * SPLIT-ENTRY GROUPING — an office-side data-quality pattern, not a matching
 * rule: a single real payment sometimes lands in Office Data as TWO (or more)
 * rows for the exact same party/date/section — e.g. a rounding top-up entered
 * as its own line rather than editing the original row. `assign()` above is
 * deliberately 1:1 (see assignment.ts's own header on why THAT is correct: no
 * threshold, no score, pure exclusivity), so only ONE such row can claim the
 * ledger's single credit; the rest correctly come back "Ledger Entry Not
 * Found" even though nothing is actually missing.
 *
 * This is intentionally NOT a change to assign()'s exclusivity algorithm —
 * it runs strictly AFTER it, over rows the engine already committed. Two
 * independent guards keep it from becoming a second, uncontrolled matching
 * path of its own:
 *
 *  1. PAN. `assign()` treats a PAN difference as PROOF of non-identity (see
 *     its own "PAN SPLIT" handling) — but that proof only fires when two
 *     office records are EVIDENTIARILY TIED for one ledger row. When one
 *     record's evidence instead DOMINATES another's (the exact shape here:
 *     the anchor is a clean Match, the leftover a clean non-match), the
 *     loser never enters that tied comparison and the PAN check never runs
 *     on it — so this pass must re-apply the same rule itself: a leftover
 *     whose PAN provably differs from the anchor's is never folded in,
 *     full stop, even if the arithmetic lines up (see SPLIT_FOLD_TOLERANCE
 *     doc for why "the arithmetic lines up" is not by itself sufficient).
 *  2. AN EXACT SUM, not a tolerant one. The anchor is only ever "Matched"
 *     because its own figure ALREADY satisfies amountsMatch against the
 *     credit — so re-applying that same generous, size-scaled tolerance to
 *     the GROUP sum would accept almost any small, wholly unrelated entry
 *     riding along on a large anchor. Requiring the fold to land within
 *     SPLIT_FOLD_TOLERANCE (a flat ₹1) of the credit means a leftover is
 *     only ever absorbed when it is the thing that makes the total land
 *     exactly right — real structural corroboration, not coincidence.
 *
 * Deliberately narrow beyond that too: only touches "Ledger Entry Not Found"
 * rows sitting next to exactly one already-"Matched" sibling for the
 * identical (name, date, section) key. A group with no such anchor, more
 * than one, or whose (PAN-admissible) sum doesn't land on the anchor's own
 * credit, is left completely untouched — no fabricated mapping to a surplus
 * ledger row, no partial/subset search across the group. If a future case
 * needs that, it should be evidenced first, the same way this one was.
 */
function applySplitEntryGrouping(rows: TallyReconRow[], office: OfficeTxn[]): TallyReconRow[] {
  const panOf = new Map<string, string | null>();
  for (const o of office) panOf.set(o.deductee_id, o.pan ? o.pan.trim().toUpperCase() : null);

  const groupKey = (r: TallyReconRow) =>
    `${normalizeName(r.office_name)}|${r.office_date ?? ""}|${canonicalSection(r.office_section) ?? ""}`;

  const groups = new Map<string, number[]>();
  rows.forEach((r, i) => {
    if (r.result !== "Ledger Entry Not Found" && r.result !== "Matched") return;
    const k = groupKey(r);
    const g = groups.get(k);
    if (g) g.push(i); else groups.set(k, [i]);
  });

  const patched = [...rows];
  for (const idxs of groups.values()) {
    if (idxs.length < 2) continue;
    const anchors = idxs.filter((i) => rows[i].result === "Matched");
    const allLeftovers = idxs.filter((i) => rows[i].result === "Ledger Entry Not Found");
    if (anchors.length !== 1 || allLeftovers.length === 0) continue;   // ambiguous or nothing to fold in
    const anchor = rows[anchors[0]];
    if (anchor.tally_credit == null || !anchor.amount_basis) continue;
    const anchorPan = panOf.get(anchor.office_deductee_id) ?? null;

    // PAN GATE — a leftover whose PAN is present and DIFFERS from the
    // anchor's is proof it is a different deductee, never grouped in. A
    // blank PAN on either side is not evidence of anything either way (most
    // Stage-3 office data has no PAN at all), so it does not block folding
    // — same asymmetry assignment.ts itself uses for its PAN rules.
    const leftovers = allLeftovers.filter((i) => {
      const p = panOf.get(rows[i].office_deductee_id) ?? null;
      return !(anchorPan && p && anchorPan !== p);
    });
    if (!leftovers.length) continue;

    const figureOf = (r: TallyReconRow) => (anchor.amount_basis === "tds" ? r.office_tds : r.office_amount);
    const anchorFigure = figureOf(anchor);
    if (anchorFigure == null) continue;
    if (leftovers.some((i) => figureOf(rows[i]) == null)) continue; // an ungrounded member — don't guess
    const leftoverSum = leftovers.reduce((sum, i) => sum + (figureOf(rows[i]) ?? 0), 0);
    if (Math.abs(anchor.tally_credit - (anchorFigure + leftoverSum)) > SPLIT_FOLD_TOLERANCE) continue;

    const foldReason = `Office Data splits this payment to "${anchor.office_name ?? "—"}" (${anchor.office_date ?? "—"}) across multiple rows; `
      + `together they total ${inr(anchorFigure + leftoverSum)}, matching the single Tally ledger entry "${anchor.tally_party ?? "—"}" `
      + `${anchor.tally_date ?? "—"} ${inr(anchor.tally_credit)} exactly.`;

    for (const i of leftovers) {
      const o = rows[i];
      patched[i] = {
        ...o, tally_row_index: anchor.tally_row_index, tally_party: anchor.tally_party,
        tally_date: anchor.tally_date, tally_credit: anchor.tally_credit,
        result: "Matched", amount_basis: anchor.amount_basis, confidence: 85,
        mapped: anchor.mapped, reason: foldReason,
      };
    }
    // The anchor's own card must disclose the fold too — otherwise a checker
    // reading it in isolation sees an ordinary single-record match and has
    // no signal this credit is shared with another office row.
    patched[anchors[0]] = { ...anchor, reason: `${anchor.reason} ${foldReason}` };
  }
  return patched;
}

/** Turn one Outcome into a TallyReconRow: the verdict, the confidence and a reason
 *  line that names the field that differs and says what to do about it. */
function render(
  o: OfficeTxn, out: Outcome, rowAt: (pos: number) => TallyRow,
  ledgerSection: string | null, sectionOf: (t: TallyRow) => string | null,
): TallyReconRow {
  const b = {
    office_deductee_id: o.deductee_id, office_name: o.name, office_date: o.date_iso,
    office_amount: o.amount, office_tds: o.tds, office_section: o.section,
  };
  const oSec = canonicalSection(o.section);
  const secLabel = oSec ?? canonicalSection(ledgerSection) ?? "";
  const secWord = secLabel ? `${secLabel} ` : "";

  // ── PAN SPLIT: indistinguishable records, different deductees ──────────────
  if (out.escalation?.why === "pan-split") {
    return {
      ...b, tally_row_index: null, tally_party: null, tally_date: null, tally_credit: null,
      result: "Multiple Possible Matches", amount_basis: null,
      reason: `${out.escalation.officeCount} office records are identical on name, date, amount and section but carry different PANs (${out.escalation.pans.join(", ")}). `
        + `Only your invoice can say which ledger entry belongs to which deductee.`,
      confidence: 0,
    };
  }

  // ── AMBIGUOUS: several entries compete and the signals disagree ────────────
  if (out.escalation?.why === "ambiguous" && out.ti === null) {
    const rivals = out.escalation.rivalTis.map((ti) => rowAt(ti)).slice(0, 3);
    return {
      ...b, tally_row_index: null, tally_party: null, tally_date: null, tally_credit: null,
      result: "Multiple Possible Matches", amount_basis: null,
      // Incomparable means each candidate BEATS the others on some signal and LOSES
      // on another (one matches the date, another the amount). Say only that — the
      // engine does not know which signal the user's invoice will vindicate, and a
      // reason that overstates what was found is how the last engine lost their trust.
      reason: `${out.escalation.rivalTis.length} ${secWord}ledger entries compete for this record and none is best on every signal — `
        + rivals.map((t) => `"${t.party ?? "—"}" ${t.date ?? "—"} ${inr(t.credit)}`).join("; ")
        + `. Each matches this record on something the others do not, so only your invoice can settle which entry is this one's.`,
      confidence: 0,
    };
  }

  // ── UNMATCHED ─────────────────────────────────────────────────────────────
  if (out.ti === null || !out.ev) {
    // Cardinality exhaustion is a REAL AUDIT FINDING, not a shrug.
    if (out.exhaustion) {
      return {
        ...b, tally_row_index: null, tally_party: null, tally_date: null, tally_credit: null,
        result: "Ledger Entry Not Found", amount_basis: null,
        reason: `The ${secWord}ledger holds ${out.exhaustion.ledgerCount} entr${out.exhaustion.ledgerCount === 1 ? "y" : "ies"} for this party/date/amount; Office Data holds ${out.exhaustion.officeCount}. `
          + `All ${out.exhaustion.ledgerCount === 1 ? "of it is" : `${out.exhaustion.ledgerCount} are`} matched to your other records, so the ledger appears short by ${out.exhaustion.officeCount - out.exhaustion.ledgerCount} entr${out.exhaustion.officeCount - out.exhaustion.ledgerCount === 1 ? "y" : "ies"}.`,
        confidence: 0,
      };
    }
    // NEVER a bare not-found: name the closest unclaimed row and say why it failed.
    if (out.nearest) {
      const t = rowAt(out.nearest.ti);
      const ev = out.nearest.ev;
      const why: string[] = [];
      if (ev.dateDelta !== null && ev.dateDelta !== 0) why.push(`${days(Math.abs(ev.dateDelta))} out`);
      if (ev.basis === null) why.push(`credit ${inr(t.credit)} matches neither the office TDS ${inr(o.tds)} nor the amount ${inr(o.amount)}`);
      if (rank(ev.nameTier) > AUTO_MATCH_MAX_RANK) why.push(`party name differs`);
      if (out.nearest.consumed) why.push(`already matched to another office record`);
      return {
        ...b, tally_row_index: null, tally_party: null, tally_date: null, tally_credit: null,
        result: "Ledger Entry Not Found", amount_basis: null,
        reason: `No unclaimed ${secWord}entry matches this office record. Closest: "${t.party ?? "—"}" ${t.date ?? "—"} ${inr(t.credit)} — ${why.join(", ")}.`,
        confidence: 0,
      };
    }
    return {
      ...b, tally_row_index: null, tally_party: null, tally_date: null, tally_credit: null,
      result: "Ledger Entry Not Found", amount_basis: null,
      reason: secLabel
        ? `No entry in the ${secLabel} ledger matches this office record's date or amount.`
        : `No ledger entry found matching this office record's date or amount.`,
      confidence: 0,
    };
  }

  // ── PAIRED ────────────────────────────────────────────────────────────────
  const t = rowAt(out.ti);
  const ev: Evidence = out.ev;
  const paired = { ...b, tally_row_index: t.row_index, tally_party: t.party, tally_date: t.date, tally_credit: t.credit };
  const dateEq = ev.dateDelta === 0;
  const moneyEq = ev.basis !== null;
  // A saved mapping settles the PARTY and nothing else — the user asserted this
  // identity, so the name is no longer a question, but the date and TDS are still
  // validated on it and a mapped record that fails them stays an exception carrying
  // `mapped: true`, so it shows under BOTH Mapped and Mismatched.
  const nameOk = ev.mapped || rank(ev.nameTier) <= AUTO_MATCH_MAX_RANK;
  const mapped = ev.mapped || undefined;
  const tSec = sectionOf(t);

  // ── The witness fired: a better claimant exists somewhere in this client's books
  if (out.escalation?.why === "better-claimant") {
    return {
      ...paired, result: "Multiple Possible Matches", amount_basis: ev.basis, mapped,
      reason: `The ledger entry "${t.party ?? "—"}" matches this record's date (${o.date_iso ?? "—"}) and TDS (${inr(o.tds)}) exactly, `
        + `but your Office Data lists a separate deductee "${out.escalation.rivalOfficeName}"${out.escalation.rivalPan ? ` (PAN ${out.escalation.rivalPan})` : ""} whose name matches that ledger entry more closely. `
        + `Two spellings your own records keep apart are two different parties, so I have not merged them.`,
      confidence: 0,
    };
  }

  const suggested = out.suggest ? (t.party ?? undefined) : undefined;

  // VERDICT precedence: section → party → money → date. Name the field a reviewer
  // must fix FIRST; the rest is noise until that one is right.
  if (!ev.sectionEq) {
    return {
      ...paired, result: "Section Mismatch", amount_basis: ev.basis, mapped, suggested_party: suggested,
      reason: `Party, date and amount match, but the entry is booked in the ${tSec ?? "—"} ledger while the office record is ${oSec ?? "—"}.`,
      confidence: 70,
    };
  }

  if (!nameOk) {
    const competes = out.tier === "RESIDUE"
      ? `nothing else in this client's books competes for either record`
      : `no other entry competes for either record`;
    const facts = [dateEq ? "Date" : null, moneyEq ? "amount" : null].filter(Boolean);
    return {
      ...paired, result: "Party Name Mismatch", amount_basis: ev.basis, mapped, suggested_party: suggested,
      reason: suggested
        ? `${facts.length === 2 ? "Date, amount and section all match" : `${facts.join(" and ")} match${facts.length > 1 ? "" : "es"}`} ledger entry "${t.party ?? "—"}", and ${competes}. `
          + `The office spells it "${o.name ?? "—"}". Confirm the mapping to match automatically in future.`
        // Gate refused: show the counterpart in the REASON but offer NO one-click
        // identity. A confirmed mapping is for ever, and amount-only evidence is not
        // enough to assert that two unrelated names are one deductee.
        : `This is the only ${secWord}entry left that could belong to this record — "${t.party ?? "—"}" ${t.date ?? "—"} ${inr(t.credit)} — but the party name is unrelated to "${o.name ?? "—"}" `
          + `and only the ${dateEq && moneyEq ? "date and amount" : dateEq ? "date" : "amount"} agree${dateEq && moneyEq ? "" : "s"}. Check the invoice before mapping these together.`,
      confidence: suggested ? 65 : 50,
    };
  }

  if (!moneyEq) {
    return {
      ...paired, result: "Credit Amount Mismatch", amount_basis: null, mapped,
      reason: ev.mapped
        ? `Party is mapped to "${t.party ?? "—"}", but the ledger credit (${inr(t.credit)}) differs from the office TDS (${inr(o.tds)}). Mapping resolves the party name only.`
        : `Party and date match, but the ledger credit (${inr(t.credit)}) differs from the office TDS (${inr(o.tds)}).`,
      confidence: 60,
    };
  }

  if (!dateEq) {
    const dd = ev.dateDelta;
    return {
      ...paired, result: "Date Mismatch", amount_basis: ev.basis, mapped,
      reason: `Party and amount match ledger entry "${t.party ?? "—"}", but the ledger date (${t.date ?? "—"}) differs from the office date (${o.date_iso ?? "—"})`
        + `${dd !== null ? ` by ${days(Math.abs(dd))}` : ""}. No other entry competes for either record.`,
      confidence: 55,
    };
  }

  // ── MATCHED — earned only by full corroboration, never by tier strength ────
  const twins = out.classSize >= 2
    ? ` ${out.classSize} ledger entries share this date, party and amount; each is used once, so they pair 1:1 with the matching office records in ledger order.`
    : ``;
  const panWarn = out.panBlankMixed
    ? ` Note: some of these office records have no PAN, which is mandatory on a TDS return — verify before filing.`
    : ``;
  const conf = out.tier === "A0" ? 96 : out.tier === "A1" ? 95 : out.tier === "A2" ? 92 : out.tier === "A3" ? 75 : 55;
  return {
    ...paired, result: "Matched", amount_basis: ev.basis, mapped,
    reason: (ev.mapped
      ? `Party matched via the saved mapping to "${t.party ?? "—"}"; date and TDS amount both match.`
      : ev.nameTier === "unknown"
        ? `Date, amount and section match; the party name could not be compared (missing on one side).`
        : `Date, amount, party and section all match.`) + twins + panWarn,
    confidence: conf,
  };
}
