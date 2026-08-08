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
import { canonicalSection, rank, normalizeName, amountsMatch, salaryBareCompatible } from "./match";
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
  // Display-only context (a compound-Journal's "BEING THE INTEREST PAID @ 6%
  // …" narration line) — never read by assign()/render() below. Carried on
  // this row purely so the UI can show it next to a ledger entry; adding it
  // did not touch the matching engine's own logic at all (see tallyPdf.ts's
  // own doc on the field for why narration is deliberately NOT a matching
  // signal).
  narration?: string | null;
  // The TDS section this row belongs to, taken from ITS OWN sheet/ledger title.
  // Carried PER ROW (not per file) because a client's Tally dataset is normally
  // one ledger PER SECTION — spread across several sheets AND several files — and
  // an office 194A record must only ever be reconciled against 194A ledger rows.
  section: string | null;
  // Set ONLY for a 24Q expense-ledger row (tallyPdf.ts's "Staff Salary
  // Expense" case) whose credit is a TAXABLE INCOME figure, never TDS —
  // structurally guaranteed at parse time, not inferred from section text.
  // The caller (TdsTallyRecon.tsx) uses this to run a SEPARATE reconciliation
  // pass for the Salary/Remuneration ledger against office.amount, alongside
  // the unchanged pass for the TDS-liability ledger against office.tds — see
  // that file's runAudit() for the combined-verdict merge. Every row without
  // this tag (every 26Q/27EQ row, every plain liability-ledger "By" row)
  // behaves EXACTLY as before this field existed.
  amountKind?: "taxable_income";
  // The total tax-line amount tallyPdf.ts subtracted out of THIS row's own
  // credit — Professional Tax, TDS Payable, Education Cess, whatever isTaxLine
  // recognised on the voucher — 0/undefined if none was on it. Named for its
  // original, narrower case (PT alone); see TallyPdfRow's own doc on the
  // field. Only ever read by resolveTaxableIncomeReading() below.
  ptExcluded?: number;
}

/**
 * TAX LINES: NET OR GROSS? IT DEPENDS WHICH OFFICE YOU ASK.
 *
 * tallyPdf.ts excludes a voucher's tax-line Cr amounts (Professional Tax, and
 * — for a high-earner crossing the TDS threshold — TDS Payable/Education Cess
 * too) from the parsed Taxable Income by default (see isTaxLine) — confirmed
 * against a real client whose own Office Data recorded Taxable Income NET of
 * these, so the unexcluded (gross) reading sat above every record by exactly
 * their sum.
 *
 * A second real client (Clear Quant Technologies) does the opposite: their
 * Office Data records the GROSS voucher debit (tax lines included) as
 * Taxable Income, so the default NET reading now sits exactly that amount
 * BELOW every record — the same bug, mirrored.
 *
 * Both are real, and neither convention is "correct" — it is just how each
 * office's own working file happens to enter the figure, and tallyPdf.ts
 * parses one Tally PDF with no idea which office produced the Office Data it
 * will later be reconciled against. So the choice is deferred to here, where
 * both sides are available: for the whole ledger, count how many rows the
 * NET reading (credit as tallyPdf.ts computed it) explains against Office
 * Data's amount, versus how many the GROSS reading (credit + ptExcluded)
 * explains, and use whichever reading the file's own data actually supports.
 * A tie (including "no evidence either way") keeps the NET reading — today's
 * behaviour, unaffected for every ledger that never subtracted a tax line.
 *
 * Deliberately NOT a per-row decision: the ANY-gap-is-shown promise renders
 * elsewhere in tallyRecon.ts depends on a mismatch being real, never chased
 * away row-by-row. Voting once for the whole ledger (exactly like
 * assignment.ts's own per-section tds/amount vote) makes the SUBSTITUTED
 * credit value itself accurate, so a genuine mismatch on some other row
 * still shows in full — it is not a tolerance layered on top of the verdict.
 */
export function resolveTaxableIncomeReading(office: OfficeTxn[], ledger: TallyRow[]): TallyRow[] {
  if (!ledger.some((t) => (t.ptExcluded ?? 0) > 0)) return ledger;

  const byIso = new Map<string, TallyRow[]>();
  for (const t of ledger) if (t.iso) { const a = byIso.get(t.iso) ?? []; a.push(t); byIso.set(t.iso, a); }

  let netVotes = 0, grossVotes = 0;
  for (const o of office) {
    if (!o.date_iso || o.amount == null) continue;
    for (const t of byIso.get(o.date_iso) ?? []) {
      if (t.credit == null) continue;
      if (amountsMatch(t.credit, o.amount)) netVotes++;
      if ((t.ptExcluded ?? 0) > 0 && amountsMatch(t.credit + (t.ptExcluded ?? 0), o.amount)) grossVotes++;
    }
  }
  if (grossVotes <= netVotes) return ledger;
  return ledger.map((t) => ((t.ptExcluded ?? 0) > 0 ? { ...t, credit: (t.credit ?? 0) + (t.ptExcluded ?? 0) } : t));
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
  | "Office Data Not Found"
  // ── 24Q DUAL-LEDGER combined verdicts (mergeDualLedgerResults below) ───────
  // Produced ONLY when a filing's Tally rows include at least one
  // amountKind:"taxable_income" row (a Salary/Remuneration ledger was
  // imported alongside a TDS Deducted ledger) — a single-ledger client
  // (every 26Q/27EQ filing, and any 24Q client with only one combined
  // ledger) never sees these; its results stay exactly the categories above.
  | "Name Mismatch"
  | "Taxable Income Missing from Salary Ledger" | "Taxable Income Missing from Office Data" | "Taxable Income Amount Mismatch"
  | "TDS Missing from TDS Ledger" | "TDS Missing from Office Data" | "TDS Amount Mismatch";

/** Per-figure sub-verdict for ONE side of a dual-ledger comparison — what a
 *  checker sees next to "Taxable Income" or "TDS" specifically, independent
 *  of which one the OVERALL combined result names (see mergeDualLedgerResults). */
export type SubStatus = "Matched" | "Missing from Ledger" | "Missing from Office Data" | "Amount Mismatch" | "Date Mismatch" | "Name Mismatch" | "Needs Review";

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
  // ── 24Q DUAL-LEDGER fields — undefined for every single-ledger row ─────────
  // The existing tally_* fields above hold the TDS-ledger side in dual-ledger
  // mode (matching amount_basis:"tds" convention); these hold the SEPARATE
  // Salary/Remuneration ledger side. See mergeDualLedgerResults.
  salary_tally_row_index?: number | null;
  salary_tally_party?: string | null;
  salary_tally_date?: string | null;
  salary_tally_credit?: number | null;
  taxable_income_status?: SubStatus | null;
  tds_status?: SubStatus | null;
}

/** Saved per-client party mappings: normalised office name → tally party name. */
export type PartyMap = Record<string, string>;

/**
 * The audit-facing label for an APPROVED one-sided override — a record the
 * checker has accepted as legitimately existing on ONE side only.
 *
 * EXPORTED and shared deliberately. This used to be duplicated verbatim in
 * TdsTallyRecon.tsx and again in tdsOverviewFetch.ts (which also kept its own
 * stale copy of the TallyResult union, so new members never failed to
 * compile). The copies drifted the moment dual-ledger added its one-sided
 * results, and the SAME overridden row then read "Salary Ledger Only" on the
 * Stage-3 tab but "Taxable Income Missing from Office Data" in the Overview
 * Report and Stage-4 audit — one of which reads as an open problem. One
 * definition, imported by both.
 */
export function oneSidedLabel(r: { result: TallyResult }): string {
  switch (r.result) {
    case "Ledger Entry Not Found": return "Office Data Only";
    case "Office Data Not Found": return "Tally Ledger Only";
    case "Taxable Income Missing from Office Data": return "Expense Ledger Only";
    case "TDS Missing from Office Data": return "TDS Ledger Only";
    default: return r.result;
  }
}

// Money verdicts below (EXACT_EPS, see moneyEq) flag ANY gap of ₹0.005 or
// more — deliberately tighter than whole-rupee rounding, so a genuine
// sub-rupee difference (Tally often carries paise; office TDS is entered
// rounded to the whole rupee — see TdsDataEntry.tsx) is never silently
// absorbed into "Matched". But Math.round()-ing BOTH figures for display
// then contradicted that verdict: two numbers that differ by, say, ₹0.03
// rounded to the identical whole-rupee string on both sides, while the
// reason sentence still said they "differ" — with the stated difference
// itself rounding to "₹0". Showing 2 decimals whenever the value actually
// carries a fractional rupee (matching EXACT_EPS's own threshold) makes the
// displayed numbers agree with the verdict that flagged them, without
// cluttering the overwhelmingly common whole-rupee case with ".00".
const inr = (v: number | null | undefined) => {
  if (v == null) return "—";
  const hasPaise = Math.abs(v - Math.round(v)) >= 0.005;
  return hasPaise
    ? `₹${v.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : `₹${Math.round(v).toLocaleString("en-IN")}`;
};
const days = (n: number) => `${n} day${n === 1 ? "" : "s"}`;

/**
 * Reconcile every OFFICE record against the imported Tally ledger.
 *
 * SIGNATURE UNCHANGED — the production call site (TdsTallyRecon.tsx) and the pinned
 * tests bind to exactly this. `ledgerSection` is vestigial in production (the call
 * site always passes null; sections ride per row) but is kept for the tests and as
 * the fallback for rows imported before per-row section existed.
 */
export function reconcileTally(
  office: OfficeTxn[], tally: TallyRow[], ledgerSection: string | null, partyMap: PartyMap = {},
  formType?: string | null,
): TallyReconRow[] {
  return reconcileTallyFull(office, tally, ledgerSection, partyMap, formType).rows;
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
  // The FORM this reconciliation run is FOR ("24Q"/"26Q"/"27Q"/"27EQ") —
  // optional and, when omitted, changes nothing (every existing caller/test
  // keeps behaving exactly as before this parameter existed).
  //
  // Section 192 (Salary, and its 192A/192B/192C sub-codes) is 24Q's ALONE;
  // every other TDS section is 26Q/27Q/27EQ's. A single uploaded ledger PDF
  // can legitimately interleave both — a client's combined "Provision
  // Ledger" prints "UNPAID TDS-26/27-194 C" and "UNPAID TDS-26/27-SALARY" as
  // two blocks of ONE file (see expertPdf.ts's own doc on the real M J
  // Surgical print this was built against) — so importing it into a 26Q
  // filing stored the Salary block's rows there too. Nothing before this
  // parameter existed ever excluded them from THIS filing's matching: each
  // one was a real credit with no 26Q office record able to claim it (a
  // salaried employee is never entered as 26Q Office Data), so every single
  // one surfaced as "Office Data Not Found" — a wall of false mismatches for
  // deductions that simply aren't this return's business. A row whose
  // section cannot be identified at all is deliberately left IN SCOPE (never
  // excluded on absence of evidence) — same fallback philosophy as
  // `sectionScoped` below.
  formType?: string | null,
): { rows: TallyReconRow[]; surplusLedger: TallyRow[] } {
  const isSalaryCanon = (s: string | null) => !!s && /^192[ABC]?$/.test(s);
  const inScopeForForm = (t: TallyRow): boolean => {
    const sec = canonicalSection(t.section) ?? canonicalSection(ledgerSection);
    if (!sec) return true;
    return formType === "24Q" ? isSalaryCanon(sec) : !isSalaryCanon(sec);
  };
  const scoped = formType ? tally.filter(inScopeForForm) : tally;

  // Each ledger entry may be claimed by at most ONE office record. The engine keys on
  // POSITION IN THIS ARRAY, never row_index — see AsgLedger.pos for the bug that
  // caused (row_index is unique only within its own file). `scoped`, not the raw
  // `tally` param, is that array from here on — rowAt below must read from the
  // SAME array credits/k was built from, or a position would resolve to the
  // wrong (unfiltered-index) row.
  const credits = scoped
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
  // A bare-lettered covered section counts too — see salaryBareCompatible's own
  // doc: a Tally salary ledger titled just "192" never claimed to be anything
  // other than a lettered sub-code, so it still covers a 192A/192B/192C record.
  const sectionCovered = (s: string) => covered.has(s) || [...covered].some((c) => salaryBareCompatible(c, s));
  const unassignable = (o: OfficeTxn): string | null => {
    const oSec = canonicalSection(o.section);
    return sectionScoped && oSec && !sectionCovered(oSec) ? oSec : null;
  };

  const asgOffice: AsgOffice[] = office.map((o) => ({
    id: o.deductee_id, name: o.name, dateIso: o.date_iso,
    amount: o.amount, tds: o.tds, section: canonicalSection(o.section), pan: o.pan ?? null,
    assignable: !unassignable(o),
  }));
  const asgLedger: AsgLedger[] = credits.map(({ t, k }) => ({
    pos: k, party: t.party, iso: t.iso, credit: t.credit, section: sectionOf(t),
  }));
  const rowAt = (pos: number) => scoped[pos];

  const { outcomes, surplus, basisFor } = assign(asgOffice, asgLedger, partyMap);

  const rows = office.map((o, i) => {
    const missing = unassignable(o);
    if (missing) {
      return {
        ...base(o), ...nullTally, result: "No Ledger for Section" as const, amount_basis: null,
        reason: `No Tally ledger for section ${missing} has been imported (imported: ${[...covered].sort().join(", ")}). Import that section's ledger to reconcile this record.`,
        confidence: 0,
      };
    }
    return render(o, outcomes[i], rowAt, ledgerSection, sectionOf, basisFor, partyMap);
  });

  return { rows: applySplitEntryGrouping(rows, office), surplusLedger: surplus.map(rowAt) };
}

/**
 * SUM AN EMPLOYEE'S TAXABLE PAY ACROSS EVERY EXPENSE LEDGER FOR THAT MONTH.
 *
 * Taxable Income is Salary + Bonus + Reimbursement + any other pay head, and a
 * client keeps each of those in its OWN Tally ledger — one PDF per head. Office
 * Data holds the TOTAL for the employee for the month, so reconciling the
 * ledger rows individually can never match it: a bonus of ₹5,000 and a salary
 * of ₹30,000 are two rows the engine (deliberately 1:1) pairs one-at-a-time
 * against a single ₹35,000 office figure, and BOTH report a false mismatch.
 *
 * Grouping is by employee AND CALENDAR MONTH, not by exact date, because the
 * heads are booked on their own days — the bonus on the 3rd, the salary on the
 * 30th — while Office Data carries one line per employee per month. The
 * month-end row is kept as the representative (the latest date in the group,
 * which is what the return reports), and every contributing row is named in
 * `narration` so a checker can see how the total was built.
 *
 * Only ever applied to taxable-income rows: TDS is a separate figure that
 * reconciles against the TDS ledger on its own and is never aggregated here.
 */
export function aggregateTaxableByEmployeeMonth(rows: TallyRow[]): TallyRow[] {
  const groups = new Map<string, TallyRow[]>();
  for (const r of rows) {
    const month = (r.iso ?? "").slice(0, 7);          // yyyy-mm
    const key = `${normalizeName(r.party)}|${month}`;
    const g = groups.get(key);
    if (g) g.push(r); else groups.set(key, [r]);
  }
  const out: TallyRow[] = [];
  for (const g of groups.values()) {
    if (g.length === 1) { out.push(g[0]); continue; }
    const total = g.reduce((sum, r) => sum + (r.credit ?? 0), 0);
    // The latest-dated row represents the group: that is the month-end salary
    // entry, whose date is the one Office Data carries.
    const anchor = g.reduce((a, b) => ((b.iso ?? "") > (a.iso ?? "") ? b : a));
    const parts = g.map((r) => `${r.date ?? "—"} ${inr(r.credit)}`).join(" + ");
    out.push({
      ...anchor,
      credit: total,
      narration: `Combined from ${g.length} ledger entries for this employee in the month: ${parts} = ${inr(total)}.`,
    });
  }
  return out;
}

/** Reduce ONE single-ledger TallyReconRow (from a dual-ledger PASS — either
 *  the TDS-ledger call or the Salary-ledger call, both unchanged
 *  reconcileTallyFull() runs) to the sub-verdict that pass's own result
 *  implies. "Needs Review" covers the rare escalations (Section Mismatch /
 *  Multiple Possible Matches) rather than force-fitting them into one of the
 *  six ordinary buckets — those are surfaced as-is by mergeDualLedgerResults.
 *
 *  `officeFigure` is THIS side's own office field (office_tds for the TDS
 *  pass, office_amount for the Salary pass) — a 24Q filing lists EVERY
 *  employee for EVERY month regardless of whether TDS was actually deducted
 *  that month (unlike 26Q/27EQ, which only ever list real transactions), so
 *  an office_tds of 0/null is completely routine, not a data gap. Without
 *  this check, "Missing from Ledger" would fire for every zero-TDS employee
 *  on every 24Q filing that has a Salary ledger — a FALSE mismatch on a
 *  colossal scale, worse than the one this whole feature exists to fix.
 *  "No ledger row, and nothing was expected" is the SAME as "Matched": both
 *  sides genuinely agree there is nothing to reconcile here. */
function subStatusFor(r: TallyReconRow, officeFigure: number | null): SubStatus {
  if (r.result === "Ledger Entry Not Found" || r.result === "No Ledger for Section") {
    // Only an AFFIRMATIVE zero certifies "nothing was due here". A NULL is the
    // ABSENCE of a figure — an import gap or a blank data-entry cell (note
    // TdsDataEntry writes `parseFloat(...) || null`, so even a typed 0 can land
    // as NULL) — and must never be reported as agreement, or the return
    // certifies "no TDS was deducted" on the strength of a missing value while
    // a real ledger credit for that employee sits unclaimed in surplus.
    if (officeFigure === 0) return "Matched";
    return officeFigure == null ? "Needs Review" : "Missing from Ledger";
  }
  switch (r.result) {
    case "Matched": return "Matched";
    case "Credit Amount Mismatch": return "Amount Mismatch";
    case "Date Mismatch": return "Date Mismatch";
    case "Party Name Mismatch": return "Name Mismatch";
    default: return "Needs Review";
  }
}

/**
 * DUAL-LEDGER MERGE — combines TWO INDEPENDENT, UNCHANGED reconcileTallyFull()
 * runs (one against the TDS-liability ledger exactly as today, one against
 * the Salary/Remuneration ledger with office.tds/office.section forced null
 * so it can only ever match on office.amount — see TdsTallyRecon.tsx's
 * runAudit for how each is built) into ONE verdict per office record.
 *
 * Deliberately NOT a change to assign()/render()/reconcileTallyFull() — every
 * one of THOSE stays pure single-ledger and fully unchanged, so a
 * single-ledger client (every 26Q/27EQ filing, and any 24Q client with only
 * one combined ledger) is provably unaffected: this function is never even
 * called for them. `tdsRows`/`salaryRows` must be the SAME LENGTH, in the
 * SAME office order, as both came from reconcileTallyFull() calls over the
 * identical office array.
 *
 * PRECEDENCE (worst-first, generalising render()'s own "escalation → name →
 * money → date" ordering across two figures): an escalation on EITHER side
 * wins outright; then a name problem on either side (reported as its own
 * "Name Mismatch", per instruction — each pass already applied the SAME
 * name-mapping/partyMap logic render() always has); then a missing
 * counterpart (Taxable Income before TDS); then an amount mismatch (Taxable
 * Income before TDS); then a date mismatch on either side; only once ALL of
 * that is clean is the combined verdict Matched.
 */
export function mergeDualLedgerResults(tdsRows: TallyReconRow[], salaryRows: TallyReconRow[]): TallyReconRow[] {
  // "No Ledger for Section" escalates rather than collapsing into "Missing from
  // Ledger": the action is "import that section's ledger", not "hunt for a row
  // that was never in scope". Folding it in told a 24Q client whose TDS ledger
  // is titled without the sub-letter (canonicalising to 192 against an office
  // 192B) that TDS was missing for every director, when nothing is missing at all.
  const ESCALATIONS: TallyResult[] = ["Multiple Possible Matches", "Section Mismatch", "No Ledger for Section"];

  /** State the figure THIS pass is actually about, with the exact gap.
   *
   *  render() writes its reason for a SINGLE-ledger client, where one credit is
   *  weighed against whichever office figure the section's basis vote chose. In
   *  the salary pass that vote has no usable input (office.tds is forced null,
   *  so the "tds" default survives) and the sentence comes out naming "the
   *  office TDS (—)" for what is really a TAXABLE INCOME discrepancy — the
   *  exact "generic mismatch when we can name the precise reason" this feature
   *  exists to eliminate. The merge knows which figure each pass compared, so
   *  it states it here instead of forwarding render's wording. */
  const amountReason = (ledger: "Salary" | "TDS", officeFigure: number | null, credit: number | null): string => {
    const label = ledger === "Salary" ? "Taxable Income" : "TDS";
    const source = ledger === "Salary" ? "Salary/Remuneration ledger" : "TDS Deducted ledger";
    const diff = officeFigure != null && credit != null ? Math.abs(credit - officeFigure) : null;
    return `${ledger} ledger: the ${source} shows ${inr(credit)} but Office Data's ${label} is ${inr(officeFigure)}`
      + `${diff != null ? ` — a difference of ${inr(diff)}` : ""}.`;
  };
  return tdsRows.map((tdsRow, i) => {
    const salaryRow = salaryRows[i];
    const taxableStatus = subStatusFor(salaryRow, salaryRow.office_amount);
    const tdsStatus = subStatusFor(tdsRow, tdsRow.office_tds);
    const base: TallyReconRow = {
      ...tdsRow,
      salary_tally_row_index: salaryRow.tally_row_index,
      salary_tally_party: salaryRow.tally_party,
      salary_tally_date: salaryRow.tally_date,
      salary_tally_credit: salaryRow.tally_credit,
      taxable_income_status: taxableStatus,
      tds_status: tdsStatus,
    };
    if (ESCALATIONS.includes(tdsRow.result)) {
      return { ...base, result: tdsRow.result, reason: `TDS ledger: ${tdsRow.reason}`, confidence: tdsRow.confidence, suggested_party: tdsRow.suggested_party };
    }
    if (ESCALATIONS.includes(salaryRow.result)) {
      return { ...base, result: salaryRow.result, reason: `Salary ledger: ${salaryRow.reason}`, confidence: salaryRow.confidence, suggested_party: salaryRow.suggested_party };
    }
    if (taxableStatus === "Name Mismatch" || tdsStatus === "Name Mismatch") {
      const src = taxableStatus === "Name Mismatch" ? salaryRow : tdsRow;
      const label = taxableStatus === "Name Mismatch" ? "Salary ledger" : "TDS ledger";
      return { ...base, result: "Name Mismatch", reason: `${label}: ${src.reason}`, confidence: src.confidence, suggested_party: src.suggested_party, mapped: src.mapped };
    }
    if (taxableStatus === "Missing from Ledger") {
      return { ...base, result: "Taxable Income Missing from Salary Ledger", reason: `Salary ledger: ${salaryRow.reason}`, confidence: salaryRow.confidence };
    }
    if (tdsStatus === "Missing from Ledger") {
      return { ...base, result: "TDS Missing from TDS Ledger", reason: `TDS ledger: ${tdsRow.reason}`, confidence: tdsRow.confidence };
    }
    // Office Data carries NO figure at all for this side (a blank cell, or an
    // import that never populated it). That is not agreement and it is not a
    // missing LEDGER entry — the figure is missing from OFFICE DATA, which is
    // its own category. Without these two branches a "Needs Review" sub-status
    // fell through the whole chain and the row was reported "Matched",
    // certifying a figure nobody ever supplied.
    if (taxableStatus === "Needs Review") {
      return {
        ...base, result: "Taxable Income Missing from Office Data",
        reason: `Office Data has no Taxable Income figure for this record, so it cannot be reconciled against the Salary/Remuneration ledger. Enter the figure (or confirm it is genuinely nil) and re-run.`,
        confidence: 0,
      };
    }
    if (tdsStatus === "Needs Review") {
      return {
        ...base, result: "TDS Missing from Office Data",
        reason: `Office Data has no TDS figure for this record, so it cannot be reconciled against the TDS Deducted ledger. Enter the figure (or confirm it is genuinely nil) and re-run.`,
        confidence: 0,
      };
    }
    if (taxableStatus === "Amount Mismatch") {
      return {
        ...base, result: "Taxable Income Amount Mismatch",
        reason: amountReason("Salary", salaryRow.office_amount, salaryRow.tally_credit),
        confidence: salaryRow.confidence, amount_basis: "amount",
      };
    }
    if (tdsStatus === "Amount Mismatch") {
      return {
        ...base, result: "TDS Amount Mismatch",
        reason: amountReason("TDS", tdsRow.office_tds, tdsRow.tally_credit),
        confidence: tdsRow.confidence, amount_basis: "tds",
      };
    }
    if (taxableStatus === "Date Mismatch" || tdsStatus === "Date Mismatch") {
      const src = taxableStatus === "Date Mismatch" ? salaryRow : tdsRow;
      const label = taxableStatus === "Date Mismatch" ? "Salary ledger" : "TDS ledger";
      return { ...base, result: "Date Mismatch", reason: `${label}: ${src.reason}`, confidence: src.confidence };
    }
    // Both sides clean — which may mean a genuine ledger match on BOTH, or
    // (routinely, for a zero-TDS 24Q employee) that one side had nothing to
    // reconcile at all and subStatusFor already called that "Matched" too;
    // word the reason to reflect whichever actually happened on each side.
    const taxableClause = salaryRow.tally_party ? `Taxable Income matches the Salary/Remuneration ledger ("${salaryRow.tally_party}")` : "no Taxable Income was expected in the Salary ledger";
    const tdsClause = tdsRow.tally_party ? `TDS matches the TDS Deducted ledger ("${tdsRow.tally_party}")` : "no TDS was expected in the TDS ledger";
    // Average ONLY over the sides that actually paired. render() stamps 0 on
    // every unmatched branch, so a plain min() reported "Matched · 0%" for the
    // routine zero-TDS employee (no TDS-ledger row to pair) — i.e. most of a
    // 24Q roster reading as no-confidence matches. A side with nothing to
    // reconcile is not evidence AGAINST the match, so it must not drag the
    // score down; if neither side paired, both figures were genuinely nil and
    // the agreement is exact.
    const scores = [
      salaryRow.tally_party ? salaryRow.confidence : null,
      tdsRow.tally_party ? tdsRow.confidence : null,
    ].filter((c): c is number => c != null);
    const merged = scores.length ? Math.min(...scores) : 96;
    return {
      ...base, result: "Matched",
      reason: `${taxableClause} and ${tdsClause}.`,
      // Never emit SPLIT_FOLD_CONFIDENCE by coincidence: the picker's
      // claim-counting reads that exact value as the signature for "this row
      // shares one physical ledger credit with its siblings", so a merged row
      // landing on it would make distinct office rows count as a single claim.
      confidence: merged === SPLIT_FOLD_CONFIDENCE ? merged - 1 : merged,
      mapped: tdsRow.mapped || salaryRow.mapped,
    };
  });
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

// The confidence value applySplitEntryGrouping stamps on every row it folds
// (both the anchor and its leftover siblings) — EXPORTED so a consumer can
// recognise "this Matched row shares its ledger credit with sibling rows"
// without re-parsing the reason text. No other Matched path in render()
// below ever produces exactly this value (its tiers use 96/95/92/75/55), so
// it doubles as a safe, explicit signature rather than a coincidence.
export const SPLIT_FOLD_CONFIDENCE = 85;

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
    if (r.result !== "Ledger Entry Not Found" && r.result !== "Matched" && r.result !== "Credit Amount Mismatch") return;
    const k = groupKey(r);
    const g = groups.get(k);
    if (g) g.push(i); else groups.set(k, [i]);
  });

  const patched = [...rows];
  for (const idxs of groups.values()) {
    if (idxs.length < 2) continue;
    // A "Credit Amount Mismatch" row (paired to a ledger row, but its own
    // figure isn't exact) is just as valid an anchor as "Matched" — since
    // Stage 3 now shows ANY non-zero gap as a mismatch (no rounding
    // tolerance), the anchor for a real split is expected to land here, not
    // as "Matched" — its own individual gap is exactly what the leftover(s)
    // are expected to close.
    const anchors = idxs.filter((i) => rows[i].result === "Matched" || rows[i].result === "Credit Amount Mismatch");
    const allLeftovers = idxs.filter((i) => rows[i].result === "Ledger Entry Not Found");
    if (anchors.length !== 1 || allLeftovers.length === 0) continue;   // ambiguous or nothing to fold in
    const anchor = rows[anchors[0]];
    if (anchor.tally_credit == null) continue;
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

    // A "Matched" anchor already names its own basis (amount_basis); a
    // "Credit Amount Mismatch" anchor's amount_basis is null (render() never
    // commits to a basis it didn't actually match on) — try both office
    // figures and use whichever one, once the leftovers are folded in,
    // lands exactly on the credit.
    const candidateBases = anchor.amount_basis ? [anchor.amount_basis] : (["tds", "amount"] as const);
    for (const basis of candidateBases) {
      const figureOf = (r: TallyReconRow) => (basis === "tds" ? r.office_tds : r.office_amount);
      const anchorFigure = figureOf(anchor);
      if (anchorFigure == null) continue;
      if (leftovers.some((i) => figureOf(rows[i]) == null)) continue; // an ungrounded member — don't guess
      const leftoverSum = leftovers.reduce((sum, i) => sum + (figureOf(rows[i]) ?? 0), 0);
      const foldTotal = anchorFigure + leftoverSum;
      const foldGap = anchor.tally_credit - foldTotal;
      if (Math.abs(foldGap) > SPLIT_FOLD_TOLERANCE) continue;

      // SPLIT_FOLD_TOLERANCE is a flat ±₹1 slack, not an exact-equality check
      // (see its own doc above) — so foldGap can be a genuine few paise, which
      // inr() now displays rather than silently rounding away. Saying the two
      // figures match "exactly" while showing two different numbers would be
      // the same self-contradiction the paisa-aware inr() exists to eliminate
      // elsewhere; state the real relationship instead.
      const foldGapExact = Math.abs(foldGap) < 0.005; // same float-safety floor as EXACT_EPS
      const foldReason = `Office Data splits this payment to "${anchor.office_name ?? "—"}" (${anchor.office_date ?? "—"}) across multiple rows; `
        + `together they total ${inr(foldTotal)}, matching the single Tally ledger entry "${anchor.tally_party ?? "—"}" `
        + (foldGapExact
          ? `${anchor.tally_date ?? "—"} ${inr(anchor.tally_credit)} exactly.`
          : `${anchor.tally_date ?? "—"} ${inr(anchor.tally_credit)} — a ${inr(Math.abs(foldGap))} rounding gap, within the split-fold tolerance.`);

      for (const i of leftovers) {
        const o = rows[i];
        patched[i] = {
          ...o, tally_row_index: anchor.tally_row_index, tally_party: anchor.tally_party,
          tally_date: anchor.tally_date, tally_credit: anchor.tally_credit,
          result: "Matched", amount_basis: basis, confidence: SPLIT_FOLD_CONFIDENCE,
          mapped: anchor.mapped, reason: foldReason,
        };
      }
      // The anchor's own card must disclose the fold too — otherwise a
      // checker reading it in isolation sees an ordinary single-record
      // verdict with no signal this credit is shared with another office
      // row. Also stamped with SPLIT_FOLD_CONFIDENCE (not just the
      // leftovers) so a consumer that needs to recognise "every row in this
      // fold shares one physical ledger credit" — e.g. the manual picker's
      // claim-counting in TdsTallyRecon.tsx — can identify the WHOLE group,
      // anchor included, not just its leftovers.
      patched[anchors[0]] = {
        ...anchor, result: "Matched", amount_basis: basis, confidence: SPLIT_FOLD_CONFIDENCE,
        reason: `${anchor.reason} ${foldReason}`,
      };
      break;
    }
  }
  return patched;
}

/** Turn one Outcome into a TallyReconRow: the verdict, the confidence and a reason
 *  line that names the field that differs and says what to do about it. */
function render(
  o: OfficeTxn, out: Outcome, rowAt: (pos: number) => TallyRow,
  ledgerSection: string | null, sectionOf: (t: TallyRow) => string | null,
  basisFor: (section: string | null) => "tds" | "amount",
  partyMap: PartyMap = {},
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
  // ev.basis (assignment.ts) only tells us WHICH office figure is close enough
  // to be worth pairing on — it is deliberately tolerant (±0.5%/₹10), because
  // that is the right question for FINDING the right ledger row (a genuine
  // rupee-rounding gap must not make the correct counterpart invisible). The
  // VERDICT is a different question — by explicit request, Stage 3 shows
  // ANY non-zero gap as a Credit Amount Mismatch with the exact amount,
  // never silently absorbing it into "Matched". EXACT_EPS is float-safety
  // only (sub-paisa), not a business tolerance.
  const EXACT_EPS = 0.005;
  const officeFigureOnBasis = ev.basis === "tds" ? o.tds : ev.basis === "amount" ? o.amount : null;
  const amountDiff = ev.basis !== null && officeFigureOnBasis != null && t.credit != null
    ? t.credit - officeFigureOnBasis : null;
  const moneyEq = ev.basis !== null && amountDiff != null && Math.abs(amountDiff) < EXACT_EPS;
  // A saved mapping settles the PARTY and nothing else — the user asserted this
  // identity, so the name is no longer a question, but the date and TDS are still
  // validated on it and a mapped record that fails them stays an exception carrying
  // `mapped: true`, so it shows under BOTH Mapped and Mismatched.
  //
  // ev.mapped (assignment.ts) requires the CANDIDATE ledger row's own party text to
  // equal the saved tally_party STRING exactly — correct and deliberately strict for
  // deciding tier admission / edge-building (a mapping must not spuriously widen which
  // ledger rows even compete). But some clients' Tally "party" field is really a
  // per-voucher NARRATION that bakes in that voucher's own amount/invoice number
  // ("Nimisha Shah being tds deduct rs .12000/- @ 2%"), so every transaction of the
  // SAME real party produces a DIFFERENT exact string — confirming one transaction's
  // mapping then never generalises to the party's other pending transactions, even
  // though `out.ti` was already independently selected for each of them by the
  // EXCLUSIVITY engine on date/amount/section evidence alone (that is what put them in
  // front of the CA as "Party Name Mismatch" with a suggestion in the first place, not
  // "Ledger Entry Not Found"). `officeConfirmed` recognises that broader case: once the
  // CA has confirmed ANY mapping for this OFFICE name, every OTHER candidate the
  // exclusivity engine independently committed to for this same office name is no
  // longer a name QUESTION either — nothing about which candidate gets chosen changes,
  // only whether the name portion of the verdict is treated as resolved.
  const officeConfirmed = !!partyMap[normalizeName(o.name)];
  const mappedResolved = ev.mapped || officeConfirmed;
  const nameOk = mappedResolved || rank(ev.nameTier) <= AUTO_MATCH_MAX_RANK;
  const mapped = mappedResolved || undefined;
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
    // ev.basis !== null means the figure was CLOSE (within the pairing
    // tolerance) but not exact. ev.basis === null means neither figure was
    // even close — but the section still has a VOTED basis (which office
    // figure this ledger's credits represent overall), so fall back to that
    // to still name a specific figure and an exact difference, rather than
    // the old bare "differs" with no computed amount.
    const basis = ev.basis ?? basisFor(oSec);
    const officeLabel = basis === "amount" ? "office amount" : "office TDS";
    const officeVal = basis === "amount" ? o.amount : o.tds;
    const diff = officeVal != null && t.credit != null ? t.credit - officeVal : null;
    const diffText = diff != null ? ` — a difference of ${inr(Math.abs(diff))}` : "";
    return {
      ...paired, result: "Credit Amount Mismatch", amount_basis: null, mapped,
      reason: mappedResolved
        ? `Party is mapped to "${t.party ?? "—"}", but the ledger credit (${inr(t.credit)}) differs from the ${officeLabel} (${inr(officeVal)})${diffText}. Mapping resolves the party name only.`
        : `Party and date match, but the ledger credit (${inr(t.credit)}) differs from the ${officeLabel} (${inr(officeVal)})${diffText}.`,
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
    reason: (mappedResolved
      ? `Party matched via the confirmed mapping to "${t.party ?? "—"}"; date and TDS amount both match.`
      : ev.nameTier === "unknown"
        ? `Date, amount and section match; the party name could not be compared (missing on one side).`
        : `Date, amount, party and section all match.`) + twins + panWarn,
    confidence: conf,
  };
}
