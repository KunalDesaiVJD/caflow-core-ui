import { describe, it, expect } from "vitest";
import {
  reconcileTallyFull, mergeDualLedgerResults, aggregateTaxableByEmployeeMonth, oneSidedLabel, SPLIT_FOLD_CONFIDENCE,
  type OfficeTxn, type TallyRow, type TallyReconRow, type PartyMap,
} from "./tallyRecon";
import { normalizeName } from "./match";

/**
 * 24Q DUAL-LEDGER RECONCILIATION — pinned against the real MICROCIRCUITS
 * INNOVATION PVT LTD Q1 FY2026-27 filing, whose Tally data is split across the
 * two ledgers this whole feature exists for:
 *
 *   • "Staff Salary Expense"  (salary expense.pdf) — books the TAXABLE INCOME
 *     figure per employee per month. Parsed rows carry amountKind:"taxable_income".
 *   • "TDS 192 B"             (24q.pdf)            — books the TDS AMOUNT only,
 *     for the two directors who actually had tax deducted. Plain credit rows.
 *
 * Office Data (24Q) carries BOTH figures per employee. The single-ledger engine
 * tries one ledger credit against EITHER office figure, so fed a salary-ledger
 * row it reported a fabricated "Credit Amount Mismatch" for every employee.
 *
 * `dualRecon` below reproduces TdsTallyRecon.tsx's runAudit() dual-pass exactly:
 * TWO independent, UNCHANGED reconcileTallyFull() runs merged externally. The
 * salary pass sees a COPY of the office array with tds/section forced null so
 * its credits can only ever be judged against office.amount.
 */
function dualRecon(office: OfficeTxn[], tally: TallyRow[], maps: PartyMap = {}) {
  const salaryLedgerRows = tally.filter((t) => t.amountKind === "taxable_income");
  const tdsLedgerRows = tally.filter((t) => t.amountKind !== "taxable_income");
  const officeForAmount: OfficeTxn[] = office.map((o) => ({ ...o, tds: null, section: null }));
  const tdsResult = reconcileTallyFull(office, tdsLedgerRows, null, maps);
  const salaryResult = reconcileTallyFull(officeForAmount, salaryLedgerRows, null, maps);
  return {
    rows: mergeDualLedgerResults(tdsResult.rows, salaryResult.rows),
    surplus: [...tdsResult.surplusLedger, ...salaryResult.surplusLedger],
  };
}

const byName = (rows: TallyReconRow[]) => Object.fromEntries(rows.map((r) => [r.office_name!, r]));

// ── The real April-2026 slice of the Microcircuits filing ────────────────────
// Two directors WITH tax deducted (both ledgers), two staff on zero TDS (salary
// ledger only) — the exact mix that made the old single-ledger model misfire.
const OFFICE: OfficeTxn[] = [
  { deductee_id: "o1", name: "Madhukant Kanjibhai Patel", date_iso: "2026-04-30", amount: 300000, tds: 19800, section: "192B", pan: "ABCPP1111A" },
  { deductee_id: "o2", name: "Nirmitkumar Madhukant Patel", date_iso: "2026-04-30", amount: 500000, tds: 34800, section: "192B", pan: "ABCPP2222B" },
  { deductee_id: "o3", name: "Devansiben Mukeshbhai Panchal", date_iso: "2026-04-30", amount: 23038, tds: 0, section: "192B", pan: "DTMPP2980Q" },
  { deductee_id: "o4", name: "Nevil Thummar", date_iso: "2026-04-30", amount: 49372, tds: 0, section: "192B", pan: "BZDPT4273P" },
];

/** A "Staff Salary Expense" ledger row — TAXABLE INCOME, never TDS. */
const sal = (row_index: number, party: string, credit: number, iso = "2026-04-30"): TallyRow => ({
  row_index, date: iso.split("-").reverse().join("-"), iso, party,
  debit: null, credit, vch_no: String(row_index), vch_type: "Journal",
  section: null, amountKind: "taxable_income",
});

/** A "TDS 192 B" liability-ledger row — the TDS amount. */
const tds = (row_index: number, party: string, credit: number, iso = "2026-04-30"): TallyRow => ({
  row_index, date: iso.split("-").reverse().join("-"), iso, party,
  debit: null, credit, vch_no: String(row_index), vch_type: "Journal",
  section: "192B",
});

const FULL_SALARY = [
  sal(10, "Madhukant Kanjibhai Patel - Salary", 300000),
  sal(11, "Nirmitkumar Madhukant Patel - Salary", 500000),
  sal(12, "Devansiben Mukeshbhai Panchal - Salary", 23038),
  sal(13, "Nevil Thummar - Salary", 49372),
];
const FULL_TDS = [
  tds(20, "Madhukant Kanjibhai Patel", 19800),
  tds(21, "Nirmitkumar Madhukant Patel", 34800),
];

describe("dual-ledger — the clean case: both ledgers agree with Office Data", () => {
  it("reports Matched for every employee, including the zero-TDS staff", () => {
    const { rows, surplus } = dualRecon(OFFICE, [...FULL_SALARY, ...FULL_TDS]);
    const r = byName(rows);

    for (const n of Object.keys(r)) expect(r[n].result).toBe("Matched");
    expect(surplus).toHaveLength(0);
  });

  it("carries BOTH ledgers' own party/date/credit on the same row, in their own fields", () => {
    const { rows } = dualRecon(OFFICE, [...FULL_SALARY, ...FULL_TDS]);
    const madhukant = byName(rows)["Madhukant Kanjibhai Patel"];

    // TDS-ledger side keeps the EXISTING tally_* fields (unchanged convention).
    expect(madhukant.tally_party).toBe("Madhukant Kanjibhai Patel");
    expect(madhukant.tally_credit).toBe(19800);
    // Salary-ledger side lands in the NEW salary_tally_* fields.
    expect(madhukant.salary_tally_party).toBe("Madhukant Kanjibhai Patel - Salary");
    expect(madhukant.salary_tally_credit).toBe(300000);

    expect(madhukant.taxable_income_status).toBe("Matched");
    expect(madhukant.tds_status).toBe("Matched");
  });

  // THE REGRESSION THIS FEATURE COULD MOST EASILY HAVE CAUSED. A 24Q return
  // lists EVERY employee EVERY month whether or not tax was deducted — unlike
  // 26Q/27EQ, which only ever list real deductions. So "no row in the TDS
  // ledger" is the NORMAL, CORRECT state for most 24Q employees. Reporting it
  // as a gap would have fired a false mismatch on nearly every employee of
  // every dual-ledger 24Q client — far worse than the bug being fixed.
  it("a zero-TDS employee absent from the TDS ledger is Matched, NOT 'TDS Missing from TDS Ledger'", () => {
    const { rows } = dualRecon(OFFICE, [...FULL_SALARY, ...FULL_TDS]);
    const devansiben = byName(rows)["Devansiben Mukeshbhai Panchal"];

    expect(devansiben.result).toBe("Matched");
    expect(devansiben.tds_status).toBe("Matched");
    expect(devansiben.tally_party).toBeNull();               // genuinely no TDS-ledger row
    expect(devansiben.taxable_income_status).toBe("Matched");
    expect(devansiben.salary_tally_credit).toBe(23038);
    expect(devansiben.reason).toContain("no TDS was expected in the TDS ledger");
  });
});

describe("dual-ledger — each figure's own gap is named exactly, never generically", () => {
  it("Taxable Income Missing from Salary Ledger — the salary row is absent but TDS is fine", () => {
    const salary = FULL_SALARY.filter((s) => !s.party!.startsWith("Madhukant"));
    const { rows } = dualRecon(OFFICE, [...salary, ...FULL_TDS]);
    const madhukant = byName(rows)["Madhukant Kanjibhai Patel"];

    expect(madhukant.result).toBe("Taxable Income Missing from Salary Ledger");
    expect(madhukant.taxable_income_status).toBe("Missing from Ledger");
    expect(madhukant.tds_status).toBe("Matched");
    expect(madhukant.tally_credit).toBe(19800);              // TDS side still paired
    expect(madhukant.salary_tally_party).toBeNull();
  });

  it("TDS Missing from TDS Ledger — office says tax WAS deducted, the TDS ledger has no such entry", () => {
    const tdsOnly = FULL_TDS.filter((t) => !t.party!.startsWith("Madhukant"));
    const { rows } = dualRecon(OFFICE, [...FULL_SALARY, ...tdsOnly]);
    const madhukant = byName(rows)["Madhukant Kanjibhai Patel"];

    expect(madhukant.result).toBe("TDS Missing from TDS Ledger");
    expect(madhukant.tds_status).toBe("Missing from Ledger");
    expect(madhukant.taxable_income_status).toBe("Matched");
    expect(madhukant.salary_tally_credit).toBe(300000);      // salary side still paired
  });

  it("Taxable Income Amount Mismatch — the salary credit differs from the office taxable figure", () => {
    const salary = FULL_SALARY.map((s) => (s.party!.startsWith("Nevil") ? { ...s, credit: 49500 } : s));
    const { rows } = dualRecon(OFFICE, [...salary, ...FULL_TDS]);
    const nevil = byName(rows)["Nevil Thummar"];

    expect(nevil.result).toBe("Taxable Income Amount Mismatch");
    expect(nevil.taxable_income_status).toBe("Amount Mismatch");
    expect(nevil.amount_basis).toBe("amount");
    expect(nevil.salary_tally_credit).toBe(49500);
    expect(nevil.reason).toContain("Salary ledger");
  });

  it("TDS Amount Mismatch — the TDS credit differs from the office TDS figure", () => {
    const tdsRows = FULL_TDS.map((t) => (t.party!.startsWith("Nirmit") ? { ...t, credit: 34900 } : t));
    const { rows } = dualRecon(OFFICE, [...FULL_SALARY, ...tdsRows]);
    const nirmit = byName(rows)["Nirmitkumar Madhukant Patel"];

    expect(nirmit.result).toBe("TDS Amount Mismatch");
    expect(nirmit.tds_status).toBe("Amount Mismatch");
    expect(nirmit.amount_basis).toBe("tds");
    expect(nirmit.tally_credit).toBe(34900);
    expect(nirmit.taxable_income_status).toBe("Matched");    // the OTHER figure is fine
  });

  it("Date Mismatch — party and both amounts agree, one ledger booked a different day", () => {
    const salary = FULL_SALARY.map((s) => (s.party!.startsWith("Nevil") ? sal(13, s.party!, 49372, "2026-05-02") : s));
    const { rows } = dualRecon(OFFICE, [...salary, ...FULL_TDS]);
    const nevil = byName(rows)["Nevil Thummar"];

    expect(nevil.result).toBe("Date Mismatch");
    expect(nevil.taxable_income_status).toBe("Date Mismatch");
    expect(nevil.salary_tally_credit).toBe(49372);
  });

  // Per instruction, a name problem is its OWN category and must not be
  // absorbed into a money/date verdict — the existing name-mapping engine
  // (match.ts + the saved partyMap) still runs first inside each pass, so only
  // a name it genuinely cannot resolve reaches here.
  it("Name Mismatch — surfaced as its own category, not folded into another verdict", () => {
    const salary = FULL_SALARY.map((s) =>
      s.party!.startsWith("Nevil") ? sal(13, "Staff Adv A/c settlement", 49372) : s);
    const { rows } = dualRecon(OFFICE, [...salary, ...FULL_TDS]);
    const nevil = byName(rows)["Nevil Thummar"];

    expect(nevil.result).toBe("Name Mismatch");
    expect(nevil.taxable_income_status).toBe("Name Mismatch");
  });

  it("a confirmed party mapping resolves the Name Mismatch, exactly as it does single-ledger", () => {
    const salary = FULL_SALARY.map((s) =>
      s.party!.startsWith("Nevil") ? sal(13, "Staff Adv A/c settlement", 49372) : s);
    const maps: PartyMap = { [normalizeName("Nevil Thummar")]: "Staff Adv A/c settlement" };
    const { rows } = dualRecon(OFFICE, [...salary, ...FULL_TDS], maps);
    const nevil = byName(rows)["Nevil Thummar"];

    expect(nevil.result).toBe("Matched");
    expect(nevil.mapped).toBe(true);
  });
});

describe("dual-ledger — a ledger entry with no office counterpart is reported per LEDGER, not merged away", () => {
  // The UI labels these "Taxable Income Missing from Office Data" /
  // "TDS Missing from Office Data" by reading each surplus row's OWN
  // amountKind, so the two ledgers' orphans never get confused for each other.
  it("keeps each pass's surplus separable by amountKind", () => {
    const salary = [...FULL_SALARY, sal(14, "Jaydip Patel - Salary", 31000)];
    const tdsRows = [...FULL_TDS, tds(22, "Ramesh Contractor", 5000)];
    const { rows, surplus } = dualRecon(OFFICE, [...salary, ...tdsRows]);

    expect(rows).toHaveLength(OFFICE.length);               // still office-anchored, 1 row each
    expect(surplus.map((t) => t.party).sort()).toEqual(["Jaydip Patel - Salary", "Ramesh Contractor"]);

    const salaryOrphans = surplus.filter((t) => t.amountKind === "taxable_income");
    const tdsOrphans = surplus.filter((t) => t.amountKind !== "taxable_income");
    expect(salaryOrphans.map((t) => t.party)).toEqual(["Jaydip Patel - Salary"]);
    expect(tdsOrphans.map((t) => t.party)).toEqual(["Ramesh Contractor"]);
  });
});

// A real, likely operator mistake: the Salary ledger is imported but the TDS
// ledger is forgotten. Dual-ledger mode still engages (a taxable_income row
// exists), and the TDS pass runs against an EMPTY ledger — the answer must
// stay honest on BOTH sides rather than collapsing to a blanket failure.
describe("dual-ledger — only the Salary ledger was imported, the TDS ledger is missing", () => {
  it("flags TDS only for employees who actually had tax deducted, and still Matches the zero-TDS staff", () => {
    const { rows } = dualRecon(OFFICE, FULL_SALARY);
    const r = byName(rows);

    // Directors WITH real TDS: the figure genuinely cannot be verified.
    expect(r["Madhukant Kanjibhai Patel"].result).toBe("TDS Missing from TDS Ledger");
    expect(r["Nirmitkumar Madhukant Patel"].result).toBe("TDS Missing from TDS Ledger");
    // …but their Taxable Income side is confirmed against the Salary ledger.
    expect(r["Madhukant Kanjibhai Patel"].taxable_income_status).toBe("Matched");
    expect(r["Madhukant Kanjibhai Patel"].salary_tally_credit).toBe(300000);

    // Zero-TDS staff are NOT dragged into a false mismatch by the missing ledger.
    expect(r["Devansiben Mukeshbhai Panchal"].result).toBe("Matched");
    expect(r["Nevil Thummar"].result).toBe("Matched");
  });
});

describe("dual-ledger — precedence when BOTH figures are wrong at once", () => {
  it("names the Taxable Income gap first, and still records the TDS sub-status on the same row", () => {
    const salary = FULL_SALARY.filter((s) => !s.party!.startsWith("Nirmit"));
    const tdsRows = FULL_TDS.map((t) => (t.party!.startsWith("Nirmit") ? { ...t, credit: 34900 } : t));
    const { rows } = dualRecon(OFFICE, [...salary, ...tdsRows]);
    const nirmit = byName(rows)["Nirmitkumar Madhukant Patel"];

    expect(nirmit.result).toBe("Taxable Income Missing from Salary Ledger");
    // The second problem is NOT lost — a checker still sees it on the same row.
    expect(nirmit.tds_status).toBe("Amount Mismatch");
    expect(nirmit.taxable_income_status).toBe("Missing from Ledger");
  });
});

// Findings from the adversarial review of this feature. Each one was a real
// defect reproduced against the engine before it was fixed; these pin the fix.
describe("dual-ledger — adversarial-review regressions", () => {
  it("an Amount Mismatch names ITS OWN figure and the exact gap, never 'office TDS (—)'", () => {
    const salary = FULL_SALARY.map((s) => (s.party!.startsWith("Nevil") ? { ...s, credit: 49500 } : s));
    const { rows } = dualRecon(OFFICE, [...salary, ...FULL_TDS]);
    const nevil = byName(rows)["Nevil Thummar"];

    expect(nevil.result).toBe("Taxable Income Amount Mismatch");
    // render()'s single-ledger wording weighed the credit against whichever
    // figure the section's basis vote chose — in the salary pass that vote has
    // no usable input, so it named "the office TDS (—)" for a TAXABLE INCOME
    // discrepancy and computed no difference at all.
    expect(nevil.reason).not.toContain("office TDS");
    expect(nevil.reason).toContain("Taxable Income");
    expect(nevil.reason).toContain("49,500");   // the ledger figure
    expect(nevil.reason).toContain("49,372");   // the office figure
    expect(nevil.reason).toContain("128");      // the exact difference
  });

  it("the TDS side names the TDS figure and its own exact gap", () => {
    const tdsRows = FULL_TDS.map((t) => (t.party!.startsWith("Nirmit") ? { ...t, credit: 34900 } : t));
    const { rows } = dualRecon(OFFICE, [...FULL_SALARY, ...tdsRows]);
    const nirmit = byName(rows)["Nirmitkumar Madhukant Patel"];

    expect(nirmit.result).toBe("TDS Amount Mismatch");
    expect(nirmit.reason).toContain("34,900");
    expect(nirmit.reason).toContain("34,800");
    expect(nirmit.reason).toContain("100");
  });

  // A NULL office figure is the ABSENCE of a figure, not an assertion of zero.
  // Treating the two alike let a return certify "no TDS was deducted" on the
  // strength of a blank cell while a real ledger credit sat unclaimed.
  it("a NULL office figure is Needs Review, never a silent 'Matched'", () => {
    const office: OfficeTxn[] = [
      { ...OFFICE[0], tds: null },                    // unknown, not zero
      { ...OFFICE[2] },                               // an affirmative 0
    ];
    const { rows } = dualRecon(office, [...FULL_SALARY, ...FULL_TDS.filter((t) => !t.party!.startsWith("Madhukant"))]);
    const r = byName(rows);

    expect(r["Madhukant Kanjibhai Patel"].tds_status).toBe("Needs Review");
    expect(r["Madhukant Kanjibhai Patel"].result).not.toBe("Matched");
    // …while a genuine zero still reads as agreement.
    expect(r["Devansiben Mukeshbhai Panchal"].tds_status).toBe("Matched");
    expect(r["Devansiben Mukeshbhai Panchal"].result).toBe("Matched");
  });

  it("a zero-TDS Matched employee is not reported at 0% confidence", () => {
    const { rows } = dualRecon(OFFICE, [...FULL_SALARY, ...FULL_TDS]);
    const devansiben = byName(rows)["Devansiben Mukeshbhai Panchal"];

    expect(devansiben.result).toBe("Matched");
    // The TDS side had nothing to reconcile, so it must not drag the score to
    // zero — that read as "no-confidence match" across most of a 24Q roster.
    expect(devansiben.confidence).toBeGreaterThan(50);
  });

  // The picker's claim-counting treats this exact value as the signature for
  // "this row shares one physical ledger credit with its siblings".
  it("a merged Matched row never lands on SPLIT_FOLD_CONFIDENCE by coincidence", () => {
    const { rows } = dualRecon(OFFICE, [...FULL_SALARY, ...FULL_TDS]);
    for (const r of rows) expect(r.confidence).not.toBe(SPLIT_FOLD_CONFIDENCE);
  });

  // The Stage-3 tab, the Overview Report export and the Stage-4 audit all read
  // ONE oneSidedLabel. Duplicated copies drifted the moment dual-ledger added
  // its one-sided results, so the same overridden row read as resolved on one
  // surface and as an open problem on another.
  it("one-sided labels are defined once and cover the dual-ledger results", () => {
    expect(oneSidedLabel({ result: "Ledger Entry Not Found" })).toBe("Office Data Only");
    expect(oneSidedLabel({ result: "Office Data Not Found" })).toBe("Tally Ledger Only");
    expect(oneSidedLabel({ result: "Taxable Income Missing from Office Data" })).toBe("Expense Ledger Only");
    expect(oneSidedLabel({ result: "TDS Missing from Office Data" })).toBe("TDS Ledger Only");
    // Anything that is not a one-sided acceptance keeps its own name.
    expect(oneSidedLabel({ result: "Date Mismatch" })).toBe("Date Mismatch");
  });

  it("'No Ledger for Section' escalates instead of masquerading as a missing entry", () => {
    // The office records are 192B; the TDS ledger was titled without the
    // sub-letter and canonicalises to 192, so its section was never imported.
    const tdsRows = FULL_TDS.map((t) => ({ ...t, section: "192" }));
    const { rows } = dualRecon(OFFICE, [...FULL_SALARY, ...tdsRows]);
    const madhukant = byName(rows)["Madhukant Kanjibhai Patel"];

    expect(madhukant.result).toBe("No Ledger for Section");
    expect(madhukant.reason).toContain("Import that section's ledger");
  });
});

// The whole point of merging EXTERNALLY rather than changing assign()/render():
// a client with one combined ledger must be bit-for-bit unaffected.
describe("dual-ledger — a SINGLE-ledger client never enters this path at all", () => {
  const office26Q: OfficeTxn[] = [
    { deductee_id: "p1", name: "DHANI CONSTRUCTION", date_iso: "2026-05-15", amount: 281475, tds: 5630, section: "194C", pan: "AAEFD1234M" },
    { deductee_id: "p2", name: "X HAWK MULTI SERVICES", date_iso: "2026-06-10", amount: 56295, tds: 563, section: "194C", pan: "AAFFX5678N" },
  ];
  const ledger26Q: TallyRow[] = [
    { row_index: 0, date: "15-May-26", iso: "2026-05-15", party: "Dhani Construction", debit: null, credit: 5630, vch_no: "1", vch_type: "Journal", section: "194C" },
    { row_index: 1, date: "10-Jun-26", iso: "2026-06-10", party: "X Hawk Multi Services", debit: null, credit: 563, vch_no: "2", vch_type: "Journal", section: "194C" },
  ];

  it("produces no amountKind rows, so runAudit's dualLedgerMode stays false", () => {
    expect(ledger26Q.some((t) => t.amountKind === "taxable_income")).toBe(false);
  });

  it("single-pass reconcileTallyFull output is untouched by any of this", () => {
    const { rows, surplusLedger } = reconcileTallyFull(office26Q, ledger26Q, null, {});
    expect(rows.map((r) => r.result)).toEqual(["Matched", "Matched"]);
    expect(surplusLedger).toHaveLength(0);
    // None of the dual-ledger fields are populated on a single-ledger row.
    for (const r of rows) {
      expect(r.salary_tally_party).toBeUndefined();
      expect(r.taxable_income_status).toBeUndefined();
      expect(r.tds_status).toBeUndefined();
    }
  });
});

// Taxable Income is Salary + Bonus + Reimbursement, and a client keeps each in
// its OWN Tally ledger. Office Data holds the month's TOTAL, so reconciling the
// heads individually can never match it — a ₹5,000 bonus and a ₹30,000 salary
// are two rows the 1:1 engine pairs one-at-a-time against one ₹35,000 office
// figure, and both report a false mismatch.
describe("aggregateTaxableByEmployeeMonth — one taxable figure per employee per month", () => {
  const row = (party: string, iso: string, credit: number): TallyRow => ({
    row_index: Math.round(credit), date: iso, iso, party, debit: null, credit,
    vch_no: null, vch_type: "Journal", section: "192", amountKind: "taxable_income",
  });

  it("sums the separate pay heads booked on their own days in one month", () => {
    const out = aggregateTaxableByEmployeeMonth([
      row("Seema Sharma-Salary", "2026-04-03", 5000),     // Bonus ledger, 3rd
      row("Seema Sharma-Salary", "2026-04-30", 30000),    // Salary ledger, month-end
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].credit).toBe(35000);
    // The month-end date is the one Office Data carries.
    expect(out[0].iso).toBe("2026-04-30");
    // …and the checker can see how the total was built.
    expect(out[0].narration).toContain("5,000");
    expect(out[0].narration).toContain("30,000");
    expect(out[0].narration).toContain("35,000");
  });

  it("never merges across employees or across months", () => {
    const out = aggregateTaxableByEmployeeMonth([
      row("Seema Sharma-Salary", "2026-04-30", 30000),
      row("Rashi Shah-Salary", "2026-04-30", 28000),      // different employee
      row("Seema Sharma-Salary", "2026-05-31", 30000),    // different month
    ]);
    expect(out).toHaveLength(3);
    expect(out.every((r) => r.credit === 30000 || r.credit === 28000)).toBe(true);
  });

  it("leaves a lone entry completely untouched", () => {
    const only = row("Rashi Shah-Salary", "2026-05-31", 2249);
    const out = aggregateTaxableByEmployeeMonth([only]);
    expect(out).toHaveLength(1);
    expect(out[0]).toBe(only);          // same object — no rewrite at all
    expect(out[0].narration).toBeUndefined();
  });
});
