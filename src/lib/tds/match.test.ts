/**
 * Regression tests for the two matching behaviours the user reported from real
 * client data. Both are cases where the engine escalated to the user instead of
 * deciding — the complaint each time was "why are you asking me this?".
 */
import { describe, it, expect } from "vitest";
import { nameCompare, nameEvidence, rank, canonicalSection, amountsMatch, normalizeName } from "./match";
import { TIERS, AUTO_MATCH_MAX_RANK } from "./assignment";
import { reconcileTally, reconcileTallyFull, type OfficeTxn, type TallyRow, type PartyMap } from "./tallyRecon";

describe("nameCompare — spelling variants vs genuinely different names", () => {
  // The rule accepts a token pair only when the consonant skeleton is IDENTICAL
  // and the words are within 2 edits. Each test below pins one side of that line;
  // loosening either half breaks a case here.
  it("matches transliteration variants of the same person", () => {
    // Reported verbatim: "These names clearly refer to the same person."
    expect(nameCompare("TARUBEN SURESHBHAI KATHARANI", "Taruben S Kathrani")).toBe("match");
    expect(nameCompare("KRISHNA ENTERPRISE", "KRISHAN ENTERPRISE")).toBe("match");
    expect(nameCompare("MOHAMMED IQBAL SHAIKH", "MOHAMED IQBAL SHAIKH")).toBe("match");
  });

  it("does NOT match different people who are one edit apart", () => {
    // A false match files a return against the wrong deductee — strictly worse than
    // asking the user to map. These must never be auto-matched.
    expect(nameCompare("RAMESH PATEL", "RAJESH PATEL")).not.toBe("match");
    expect(nameCompare("SUNIL SHAH", "SUNIT SHAH")).not.toBe("match");
  });

  it("does NOT match different words sharing a consonant skeleton", () => {
    // MEHTA and MOHIT both reduce to MHT — the edit-distance half rejects them.
    expect(nameCompare("MEHTA TRADING", "MOHIT TRADING")).not.toBe("match");
  });

  // Every pair below is two DIFFERENT real people or firms, found by an adversarial
  // sweep against an earlier, looser version of this rule that matched all of them.
  // They are the population a deductee list is drawn from — same surname, same
  // family, often the same address — and most differ by a single VOWEL, which is
  // phonemic and frequently gender-marking in Indian names. Do not loosen the rule
  // until every one of these still returns something other than "match".
  it.each([
    ["RAMESH PATEL", "RAMESH PATIL", "two of the most common surnames in India"],
    ["KAMAL KANTILAL SHAH", "KAMLA KANTILAL SHAH", "male/female, commonly husband and wife"],
    ["VIMAL TRADING COMPANY", "VIMLA TRADING COMPANY", "different proprietors, different PANs"],
    ["DIPAK J MEHTA", "DIPIKA J MEHTA", "male/female, commonly siblings"],
    ["KIRAN PATEL", "KARAN PATEL", "unrelated common given names"],
    ["SUNIL KUMAR SHARMA", "SONAL KUMAR SHARMA", "male/female"],
    ["HIRALAL PATEL", "HARILAL PATEL", "distinct Gujarati names, both 7 letters"],
    ["JAYESH THAKKAR", "JAYESH THAKUR", "Gujarati vs North-Indian surname"],
    ["ANIL BHATT", "ANIL BHATIA", "unrelated surnames"],
    ["NITIN DESAI", "NUTAN DESAI", "male/female"],
    ["SAROJ DEVI", "SURAJ DEVI", "female/male"],
    ["PRAVIN SHARMA", "PARVIN SHARMA", "male/female"],
    ["DINESH PATEL", "DANISH PATEL", "separate names of different origin"],
    ["MANISH PATEL", "MUNISH PATEL", "distinct given names, 1 edit apart"],
    ["HARSH B SHAH", "HARISH B SHAH", "distinct names, commonly brothers"],
    ["BHARAT ENTERPRISE", "BHARTI ENTERPRISE", "unrelated firms"],
    ["KIRIT KUMAR SHAH", "KIRTI KUMAR SHAH", "male/female"],
    ["ASHOK PATEL", "ASHIK PATEL", "different communities"],
    ["JAYANT PATEL", "JAYANTI PATEL", "male/female"],
    ["HETAL PATEL", "HITUL PATEL", "female/male"],
    ["MITAL SHAH", "MITUL SHAH", "female/male"],
    ["RAMAN PATEL", "RAMANI PATEL", "given name vs a surname in its own right"],
    ["TARUN PATEL", "TARAN PATEL", "distinct given names"],
    ["NILAM PATEL", "NILIMA PATEL", "distinct female names"],
    ["RAMILA PATEL", "RAMOLA PATEL", "distinct female names"],
    ["HEMANT PATEL", "HIMANT PATEL", "distinct given names"],
    ["SAVITA PATEL", "SUVITA PATEL", "distinct female names"],
    ["PRATIK ENTERPRISE", "PRITIKA ENTERPRISE", "male/female proprietors"],
  ])("does NOT match %s with %s (%s)", (a, b) => {
    expect(nameCompare(a, b)).not.toBe("match");
  });

  it("leaves genuinely unrelated parties for the user to decide", () => {
    expect(nameCompare("SANGEETA DEVI", "Sangitadevi Khet Singh")).not.toBe("match");
    expect(nameCompare("HIRENKUMAR GOPALBHAI PATEL", "Krishna Construction")).not.toBe("match");
  });

  it("keeps the pre-existing order/abbreviation tolerance", () => {
    expect(nameCompare("Jayant Kantilal Jagani", "Jayant Jagani Kantilal")).toBe("match");
    expect(nameCompare("KONE ELEVATOR INDIA PRIVATE LIMITED", "Kone Elevator India Pvt Ltd")).toBe("match");
  });
});

describe("reconcileTally — identical entries pair 1:1 without asking the user", () => {
  // From ELENZA CALLISTA BUILDCON: KONE Elevator has four identical bills booked on
  // 01.03.2026. Every ledger entry is consumed at most once, so four office records
  // pair 1:1 with four ledger rows — there is no assignment that could be wrong, and
  // nothing for the user to confirm.
  const office = (n: number): OfficeTxn[] =>
    Array.from({ length: n }, (_, i) => ({
      deductee_id: `d${i}`, name: "KONE ELEVATOR INDIA PRIVATE LIMITED",
      date_iso: "2026-03-01", amount: 1011450, tds: 20229, section: "194C",
    }));
  const ledger = (n: number): TallyRow[] =>
    Array.from({ length: n }, (_, i) => ({
      row_index: i, date: "1-Mar-26", iso: "2026-03-01", party: "Kone Elevator India Pvt Ltd",
      credit: 20229, debit: null, vch_no: `${i}`, vch_type: "Journal", section: "194C",
    }));

  it("matches all four when four identical ledger entries exist", () => {
    const out = reconcileTally(office(4), ledger(4), "194C");
    expect(out).toHaveLength(4);
    expect(out.every((r) => r.result === "Matched")).toBe(true);
  });

  it("explains the 1:1 pairing rather than asking which is correct", () => {
    const out = reconcileTally(office(4), ledger(4), "194C");
    expect(out[0].reason).toMatch(/pair 1:1/);
    expect(out[0].reason).not.toMatch(/confirm which is correct/i);
  });

  it("still reports a shortfall when the ledger has fewer entries", () => {
    const out = reconcileTally(office(4), ledger(3), "194C");
    expect(out.filter((r) => r.result === "Matched")).toHaveLength(3);
    expect(out.filter((r) => r.result !== "Matched")).toHaveLength(1);
  });

  it("prefers the candidate whose section matches the office record", () => {
    // Same party, date and amount on two sections — the section is a real signal, so
    // it decides, instead of the pick falling to ledger order.
    const rows: TallyRow[] = [
      { ...ledger(1)[0], row_index: 0, section: "194J" },
      { ...ledger(1)[0], row_index: 1, section: "194C" },
    ];
    const out = reconcileTally(office(1), rows, null);
    expect(out[0].result).toBe("Matched");
    expect(out[0].tally_row_index).toBe(1);
  });

  it("does not let a LEDGER-ONLY field (vch_no) enter the evidence signature", () => {
    // ONLY SIGNALS PRESENT ON BOTH SIDES MAY DISTINGUISH A PAIR. vch_no and vch_type
    // exist in Tally and have no office counterpart, so they cannot tell us which of
    // four identical bills is which — they can only FAKE distinctness. Admit vch_no
    // to sigOf and this 4x4 block shatters into four singleton classes, every pairing
    // looks "unique", and the engine starts asking the user to choose between rows it
    // has itself made indistinguishable. The fixture below deliberately gives each row
    // a DIFFERENT vch_no and vch_type; all four must still bulk-pair 1:1, silently.
    const rows = ledger(4).map((r, i) => ({ ...r, vch_no: `INV-${900 + i}`, vch_type: i % 2 ? "Journal" : "Purchase" }));
    const out = reconcileTally(office(4), rows, "194C");
    expect(out.every((r) => r.result === "Matched")).toBe(true);
    expect(out[0].reason).toMatch(/pair 1:1/);
  });
});

describe("reconcileTallyFull — split-entry grouping (Office Data splits one payment into two rows)", () => {
  // Reported verbatim, from Skylark Corporation: Tally books ONE journal entry for
  // Shantilal Haribhai Malani (gross 10,000, TDS 1,000 @ 10%), but Office Data has
  // TWO rows for the identical party/date — TDS 999 (on a mistakenly-entered base of
  // 9,990) and a 1-rupee top-up row correcting it. 999 + 1 = 1,000, exactly the
  // ledger's own credit, but assign() is deliberately 1:1 so only the bigger row can
  // claim it — the small one used to come back a false "Ledger Entry Not Found".
  const bigRow: OfficeTxn = { deductee_id: "big", name: "Shantilal Haribhai Malani", date_iso: "2026-05-31", amount: 9990, tds: 999, section: "194A" };
  const smallRow: OfficeTxn = { deductee_id: "small", name: "Shantilal Haribhai Malani", date_iso: "2026-05-31", amount: 10, tds: 1, section: "194A" };
  const oneCredit: TallyRow[] = [
    { row_index: 0, date: "31-May-26", iso: "2026-05-31", party: "Shantilal Haribhai Malani", credit: 1000, debit: null, vch_no: "28", vch_type: "Journal", section: "194A" },
  ];

  it("folds the leftover row into the same Matched ledger entry when the split sums exactly", () => {
    const out = reconcileTally([bigRow, smallRow], oneCredit, "194A");
    const big = out.find((r) => r.office_deductee_id === "big")!;
    const small = out.find((r) => r.office_deductee_id === "small")!;
    expect(big.result).toBe("Matched");
    expect(small.result).toBe("Matched");
    expect(small.tally_row_index).toBe(big.tally_row_index);
    expect(small.tally_credit).toBe(1000);
    expect(small.reason).toMatch(/splits this payment/);
  });

  it("does NOT group when the split sum does not land on the ledger credit", () => {
    // Same shape, but 999 + 50 = 1049 — ₹49 off, well outside the flat ₹1 fold
    // tolerance — the office figures don't actually add up, so grouping must not
    // fabricate a match.
    const out = reconcileTally([bigRow, { ...smallRow, tds: 50, amount: 500 }], oneCredit, "194A");
    const small = out.find((r) => r.office_deductee_id === "small")!;
    expect(small.result).toBe("Ledger Entry Not Found");
  });

  it("does NOT swallow a genuinely separate, unrelated small entry riding an already-EXACT anchor", () => {
    // Adversarial-review finding: an anchor that matches its OWN credit exactly
    // (no gap to explain) must not absorb some other small, unrelated leftover
    // just because the total still lands "close enough" on a percentage-based
    // tolerance. Anchor 10,000 vs credit 10,000 (exact); an unrelated ₹8 entry
    // for the same party/date must stay unmatched, not get folded in.
    const anchorTxn: OfficeTxn = { deductee_id: "anchor", name: "Vendor One Pvt Ltd", date_iso: "2026-03-31", amount: 100000, tds: 10000, section: "194C" };
    const strayTxn: OfficeTxn = { deductee_id: "stray", name: "Vendor One Pvt Ltd", date_iso: "2026-03-31", amount: 80, tds: 8, section: "194C" };
    const credit: TallyRow[] = [{ row_index: 0, date: "31-Mar-26", iso: "2026-03-31", party: "Vendor One Pvt Ltd", credit: 10000, debit: null, vch_no: "1", vch_type: "Journal", section: "194C" }];
    const out = reconcileTally([anchorTxn, strayTxn], credit, "194C");
    expect(out.find((r) => r.office_deductee_id === "anchor")!.result).toBe("Matched");
    expect(out.find((r) => r.office_deductee_id === "stray")!.result).toBe("Ledger Entry Not Found");
  });

  it("does NOT fold a different taxpayer's entry across a PAN boundary, even when the arithmetic lines up", () => {
    // Adversarial-review finding: two DIFFERENT real people can share a name/date/
    // section (the same population match.test.ts's PATEL/PATIL corpus exists for).
    // Their TDS figures summing exactly to one ledger credit is a coincidence, not
    // proof of a split — a differing PAN is proof of the opposite, and must win.
    const personA: OfficeTxn = { deductee_id: "a", name: "Ramesh Patel", date_iso: "2026-03-31", amount: 99950, tds: 9995, section: "194C", pan: "AAAPP1111A" };
    const personB: OfficeTxn = { deductee_id: "b", name: "Ramesh Patel", date_iso: "2026-03-31", amount: 50, tds: 5, section: "194C", pan: "BBBPP2222B" };
    const credit: TallyRow[] = [{ row_index: 0, date: "31-Mar-26", iso: "2026-03-31", party: "Ramesh Patel", credit: 10000, debit: null, vch_no: "1", vch_type: "Journal", section: "194C" }];
    const out = reconcileTally([personA, personB], credit, "194C");
    const a = out.find((r) => r.office_deductee_id === "a")!;
    const b = out.find((r) => r.office_deductee_id === "b")!;
    // Stage 3 shows ANY gap, so A's own ₹5 shortfall is a real, visible
    // Credit Amount Mismatch on its own — it must STAY that way. B must NOT
    // be folded in to silently explain it away just because 9995 + 5 = 10000
    // lines up exactly — B is a different PAN, full stop.
    expect(a.result).toBe("Credit Amount Mismatch");
    expect(b.result).toBe("Ledger Entry Not Found");
    expect(b.tally_row_index).not.toBe(a.tally_row_index);
  });

  it("does NOT group rows for the same party on a DIFFERENT date", () => {
    const out = reconcileTally([bigRow, { ...smallRow, date_iso: "2026-06-01" }], oneCredit, "194A");
    const small = out.find((r) => r.office_deductee_id === "small")!;
    expect(small.result).toBe("Ledger Entry Not Found");
  });

  it("does NOT group when there is no already-Matched anchor in the group", () => {
    // Both rows unmatched (no ledger imported at all for this party/date) — nothing
    // to fold into, so both must stay "Ledger Entry Not Found" untouched.
    const out = reconcileTally([bigRow, smallRow], [], "194A");
    expect(out.every((r) => r.result === "Ledger Entry Not Found")).toBe(true);
  });

  it("inherits `mapped` onto the folded leftover, and discloses the fold on the ANCHOR's own reason too", () => {
    const partyMap: PartyMap = { [normalizeName("ABC Traders")]: "XYZ Enterprises" };
    const anchorTxn: OfficeTxn = { deductee_id: "am", name: "ABC Traders", date_iso: "2026-04-10", amount: 50000, tds: 4999, section: "194C" };
    const leftoverTxn: OfficeTxn = { deductee_id: "lm", name: "ABC Traders", date_iso: "2026-04-10", amount: 10, tds: 1, section: "194C" };
    const ledgerRow: TallyRow[] = [{ row_index: 0, date: "10-Apr-26", iso: "2026-04-10", party: "XYZ Enterprises", credit: 5000, debit: null, vch_no: "9", vch_type: "Journal", section: "194C" }];
    const out = reconcileTally([anchorTxn, leftoverTxn], ledgerRow, "194C", partyMap);
    const anchor = out.find((r) => r.office_deductee_id === "am")!;
    const leftover = out.find((r) => r.office_deductee_id === "lm")!;
    expect(anchor.result).toBe("Matched");
    expect(leftover.result).toBe("Matched");
    expect(leftover.mapped).toBe(anchor.mapped);
    expect(anchor.mapped).toBe(true);
    // The anchor's OWN card must also disclose that its credit is now shared —
    // a checker reading it in isolation must not see an ordinary single-record
    // match with no signal anything was folded in.
    expect(anchor.reason).toMatch(/splits this payment/);
  });

  it("leaves a normal, non-split single office record completely unaffected", () => {
    const solo: OfficeTxn = { deductee_id: "solo", name: "Priyanka Ketanbhai Malani", date_iso: "2026-05-31", amount: 5000, tds: 500, section: "194A" };
    const ledgerRow: TallyRow[] = [{ row_index: 0, date: "31-May-26", iso: "2026-05-31", party: "Priyanka Ketanbhai Malani", credit: 500, debit: null, vch_no: "27", vch_type: "Journal", section: "194A" }];
    const out = reconcileTally([solo], ledgerRow, "194A");
    expect(out[0].result).toBe("Matched");
    expect(out[0].reason).not.toMatch(/splits this payment/);
  });
});

describe("reconcileTally — Stage 3 verdict is ZERO-tolerance (any gap is a Mismatch, by user request)", () => {
  // Reported verbatim: "why can't it detect ₹1,000 vs. ₹999... regardless of
  // whether it is ₹1 or ₹1,000, the record should appear under Mismatched
  // with the correct mismatch amount." Scoped to Stage 3 only — Stage 1/2's
  // own comparison code (stage1Compare.ts etc.) doesn't call assignment.ts
  // and is untouched; amountsMatch() itself (match.ts) is untouched too, so
  // assign()'s PAIRING/exclusivity behaviour is unaffected — only Stage 3's
  // final VERDICT (tallyRecon.ts's render()) now requires exact equality.
  it("reports a standalone ₹1 gap as Credit Amount Mismatch, not a silently-tolerated Match", () => {
    const office: OfficeTxn = { deductee_id: "x", name: "Standalone Vendor", date_iso: "2026-03-31", amount: 9990, tds: 999, section: "194C" };
    const ledger: TallyRow[] = [{ row_index: 0, date: "31-Mar-26", iso: "2026-03-31", party: "Standalone Vendor", credit: 1000, debit: null, vch_no: "1", vch_type: "Journal", section: "194C" }];
    const out = reconcileTally([office], ledger, "194C");
    expect(out[0].result).toBe("Credit Amount Mismatch");
    expect(out[0].reason).toMatch(/₹1\b/); // the exact ₹ difference is shown, not just "differs"
  });

  it("still reports a genuinely EXACT match as Matched (zero tolerance ≠ no matches)", () => {
    const office: OfficeTxn = { deductee_id: "x", name: "Standalone Vendor", date_iso: "2026-03-31", amount: 10000, tds: 1000, section: "194C" };
    const ledger: TallyRow[] = [{ row_index: 0, date: "31-Mar-26", iso: "2026-03-31", party: "Standalone Vendor", credit: 1000, debit: null, vch_no: "1", vch_type: "Journal", section: "194C" }];
    const out = reconcileTally([office], ledger, "194C");
    expect(out[0].result).toBe("Matched");
  });

  it("shows the exact difference amount for a larger gap too, e.g. ₹1,000 vs ₹999 style discrepancies at scale", () => {
    const office: OfficeTxn = { deductee_id: "x", name: "Standalone Vendor", date_iso: "2026-03-31", amount: 90000, tds: 9000, section: "194C" };
    const ledger: TallyRow[] = [{ row_index: 0, date: "31-Mar-26", iso: "2026-03-31", party: "Standalone Vendor", credit: 9995, debit: null, vch_no: "1", vch_type: "Journal", section: "194C" }];
    const out = reconcileTally([office], ledger, "194C");
    expect(out[0].result).toBe("Credit Amount Mismatch");
    expect(out[0].reason).toMatch(/₹995\b/);
  });

  it("still surfaces the mismatch after a manual party mapping — mapping settles identity only, never the amount", () => {
    const partyMap: PartyMap = { [normalizeName("Office Spelling")]: "Ledger Spelling" };
    const office: OfficeTxn = { deductee_id: "x", name: "Office Spelling", date_iso: "2026-03-31", amount: 9990, tds: 999, section: "194C" };
    const ledger: TallyRow[] = [{ row_index: 0, date: "31-Mar-26", iso: "2026-03-31", party: "Ledger Spelling", credit: 1000, debit: null, vch_no: "1", vch_type: "Journal", section: "194C" }];
    const out = reconcileTally([office], ledger, "194C", partyMap);
    expect(out[0].result).toBe("Credit Amount Mismatch");
    expect(out[0].mapped).toBe(true);
    expect(out[0].reason).toMatch(/Mapping resolves the party name only/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The engine is an ASSIGNMENT, not a per-record decision. Everything below pins a
// property of the assignment that no pairwise name test can express.
// ─────────────────────────────────────────────────────────────────────────────

const row = (i: number, party: string, iso: string, credit: number, section = "194C"): TallyRow =>
  ({ row_index: i, date: iso, iso, party, credit, debit: null, vch_no: `${i}`, vch_type: "Journal", section });
const txn = (id: string, name: string, iso: string, tds: number, pan?: string): OfficeTxn =>
  ({ deductee_id: id, name, date_iso: iso, amount: tds * 50, tds, section: "194C", pan: pan ?? null });

describe("reconcileTally — the greedy engine's row stealing is gone", () => {
  // Two office records, two perfectly determinable ledger rows. The ONLY correct
  // answer is dY→row0 Matched and dX→row1 Date Mismatch.
  //
  // The old engine hard-filtered candidates on the DATE with no name check, so dX's
  // candidate set was Yankee's row purely because the dates coincided; it then
  // CONSUMED that row, starving the record that owned it, and offered the user a
  // one-click "XRAY ENTERPRISE ↔ Yankee Enterprise" mapping that would have silently
  // mis-filed every future quarter. Both outputs were wrong.
  const dX = txn("dX", "XRAY ENTERPRISE", "2026-03-05", 5000);
  const dY = txn("dY", "YANKEE ENTERPRISE", "2026-03-05", 5000);
  const rows = [row(0, "Yankee Enterprise", "2026-03-05", 5000), row(1, "Xray Enterprise", "2026-03-06", 5000)];
  const verdicts = (office: OfficeTxn[]) =>
    Object.fromEntries(reconcileTally(office, rows, null).map((r) => [r.office_deductee_id, `${r.result}@${r.tally_row_index}`]));

  it("pairs each record with ITS OWN entry rather than whichever the date hit first", () => {
    expect(verdicts([dX, dY])).toEqual({ dY: "Matched@0", dX: "Date Mismatch@1" });
  });

  it("gives the SAME answer with the office records fed in the opposite order", () => {
    // This is the cheapest possible proof the greedy loop is gone: on main, reversing
    // the array flipped the output from wrong to right, so today's correctness there
    // depended on the order rows happened to arrive from Supabase.
    expect(verdicts([dY, dX])).toEqual(verdicts([dX, dY]));
  });

  it("never offers a one-click mapping built on amount-only evidence", () => {
    // "XRAY ENTERPRISE ↔ Yankee Enterprise" with a Confirm button is a false-match
    // factory with a human rubber stamp: one click writes a permanent wrong mapping,
    // and a mapping is forever.
    const out = reconcileTally([txn("z", "XRAY ENTERPRISE", "2026-03-05", 5000)], [row(0, "Yankee Enterprise", "2026-03-09", 5000)], null);
    expect(out[0].suggested_party).toBeUndefined();
    expect(out[0].reason).toMatch(/Yankee Enterprise/);       // still NAMED, so the user can act
    expect(out[0].reason).toMatch(/invoice/i);
  });
});

describe("reconcileTally — exclusivity decides, not a similarity threshold", () => {
  // THE decisive pair of cases. The name pair is IDENTICAL in both; only the
  // candidate set differs. No threshold can distinguish them — that is the thesis.
  const patel = txn("p1", "RAMESH PATEL", "2026-03-05", 20229, "AAAPP1111A");

  it("(i) counterpart ABSENT: pairs and SUGGESTS, but never silently Matches", () => {
    // Constraint 2's note LICENSES auto-matching a lone PATEL/PATIL. We decline the
    // licence: exclusivity within ONE quarter's ledger is weak evidence of identity
    // (the real Patil may simply not have been paid this quarter), and the risky
    // auto-match buys one click, once, per party, forever — against the risk of a
    // wrong-PAN filing. So it is paired, explained and offered — never absorbed.
    const out = reconcileTally([patel], [row(0, "Ramesh Patil", "2026-03-05", 20229)], null);
    expect(out[0].result).toBe("Party Name Mismatch");
    expect(out[0].result).not.toBe("Matched");
    expect(out[0].suggested_party).toBe("Ramesh Patil");
    expect(out[0].reason).toMatch(/Confirm the mapping/);
  });

  it("(ii) counterpart PRESENT: picks the RIGHT row and never the risky one", () => {
    const out = reconcileTally([patel], [row(0, "Ramesh Patil", "2026-03-05", 20229), row(1, "Ramesh Patel", "2026-03-05", 20229)], null);
    expect(out[0].result).toBe("Matched");
    expect(out[0].tally_row_index).toBe(1);            // Patel, NOT Patil
    expect(out[0].suggested_party).toBeUndefined();
  });

  it("makes the risky pairing UNREACHABLE when both deductees are real", () => {
    // Not "rejected" — never reached. Both are exact matches to their own rows and
    // both are consumed at A1, before any risky rule is consulted. No witness, no
    // guard, no lexicon. This is the thesis paying for itself.
    const out = reconcileTally(
      [patel, txn("p2", "RAMESH PATIL", "2026-03-05", 20229, "BBBPP2222B")],
      [row(0, "Ramesh Patil", "2026-03-05", 20229), row(1, "Ramesh Patel", "2026-03-05", 20229)], null);
    expect(out.map((r) => `${r.office_deductee_id}:${r.result}@${r.tally_row_index}`))
      .toEqual(["p1:Matched@1", "p2:Matched@0"]);
    expect(out.some((r) => r.suggested_party)).toBe(false);
  });

  it("matches TARUBEN outright — the case the user reported", () => {
    // nameCompare already returned "match" for this pair on main; it failed in the
    // ENGINE. Fixing the engine is what recovers the bulk of the false mismatches.
    const out = reconcileTally(
      [txn("t1", "TARUBEN SURESHBHAI KATHARANI", "2026-03-05", 5000)],
      [row(0, "Taruben S Kathrani", "2026-03-05", 5000)], null);
    expect(out[0].result).toBe("Matched");
  });
});

describe("reconcileTally — the 35 adversarial pairs, BOTH configurations", () => {
  // The existing suite tests these at the nameCompare level only. The engine is where
  // they can actually hurt, and the danger is a property of the CANDIDATE SET, so each
  // pair has to be run through reconcileTally in both configurations.
  const PAIRS: [string, string][] = [
    ["RAMESH PATEL", "RAMESH PATIL"], ["KAMAL KANTILAL SHAH", "KAMLA KANTILAL SHAH"],
    ["VIMAL TRADING COMPANY", "VIMLA TRADING COMPANY"], ["DIPAK J MEHTA", "DIPIKA J MEHTA"],
    ["KIRAN PATEL", "KARAN PATEL"], ["SUNIL KUMAR SHARMA", "SONAL KUMAR SHARMA"],
    ["HIRALAL PATEL", "HARILAL PATEL"], ["JAYESH THAKKAR", "JAYESH THAKUR"],
    ["ANIL BHATT", "ANIL BHATIA"], ["NITIN DESAI", "NUTAN DESAI"],
    ["SAROJ DEVI", "SURAJ DEVI"], ["PRAVIN SHARMA", "PARVIN SHARMA"],
    ["DINESH PATEL", "DANISH PATEL"], ["MANISH PATEL", "MUNISH PATEL"],
    ["HARSH B SHAH", "HARISH B SHAH"], ["BHARAT ENTERPRISE", "BHARTI ENTERPRISE"],
    ["KIRIT KUMAR SHAH", "KIRTI KUMAR SHAH"], ["ASHOK PATEL", "ASHIK PATEL"],
    ["JAYANT PATEL", "JAYANTI PATEL"], ["HETAL PATEL", "HITUL PATEL"],
    ["MITAL SHAH", "MITUL SHAH"], ["RAMAN PATEL", "RAMANI PATEL"],
    ["TARUN PATEL", "TARAN PATEL"], ["NILAM PATEL", "NILIMA PATEL"],
    ["RAMILA PATEL", "RAMOLA PATEL"], ["HEMANT PATEL", "HIMANT PATEL"],
    ["SAVITA PATEL", "SUVITA PATEL"], ["PRATIK ENTERPRISE", "PRITIKA ENTERPRISE"],
    ["RAMESH PATEL", "RAJESH PATEL"], ["SUNIL SHAH", "SUNIT SHAH"],
    ["MEHTA TRADING", "MOHIT TRADING"],
  ];

  it.each(PAIRS)("COMPETING: %s and %s each match their OWN entry, with no prompt", (a, b) => {
    const out = reconcileTally(
      [txn("oa", a, "2026-03-05", 20229, "AAAPP1111A"), txn("ob", b, "2026-03-05", 20229, "BBBPP2222B")],
      [row(0, b, "2026-03-05", 20229), row(1, a, "2026-03-05", 20229)], null);
    expect(out.map((r) => `${r.office_deductee_id}:${r.result}@${r.tally_row_index}`))
      .toEqual(["oa:Matched@1", "ob:Matched@0"]);
    expect(out.some((r) => r.suggested_party)).toBe(false);
  });

  it.each(PAIRS)("ALONE: %s against only %s is SUGGESTED, never Matched", (a, b) => {
    // The risky tier auto-commits a PAIRING (so tier-4 names resolve on crowded
    // month-end blocks), but AUTO_MATCH_MAX_RANK — a separate gate — still withholds
    // "Matched" and routes to a suggestion. This block is the proof: it stays green
    // WITH A4 auto-committing. What must never happen is one of these 31 turning into
    // "Matched"; if AUTO_MATCH_MAX_RANK is ever raised past rank 4, they do, loudly.
    const out = reconcileTally([txn("oa", a, "2026-03-05", 20229, "AAAPP1111A")], [row(0, b, "2026-03-05", 20229)], null);
    expect(out[0].result).not.toBe("Matched");
    expect(out[0].result).toBe("Party Name Mismatch");
    expect(out[0].suggested_party).toBe(b);
  });
});

describe("reconcileTally — indistinguishable records are only ONE deductee if one PARTY", () => {
  it("escalates identical office records carrying DIFFERENT PANs", () => {
    // A choice among TRUE indistinguishables cannot be got wrong, so asking is noise.
    // A choice between two REAL PEOPLE can be got wrong, and different PANs are PROOF
    // they are two people — not a heuristic. Only the invoice can settle this.
    const out = reconcileTally(
      [txn("a", "RAMESH PATEL", "2026-03-05", 20229, "AAAPP1111A"), txn("b", "RAMESH PATEL", "2026-03-05", 20229, "BBBPP2222B")],
      [row(0, "Ramesh Patel", "2026-03-05", 20229), row(1, "Ramesh Patel", "2026-03-05", 20229)], null);
    expect(out.every((r) => r.result === "Multiple Possible Matches")).toBe(true);
    expect(out[0].reason).toMatch(/AAAPP1111A/);
    expect(out[0].reason).toMatch(/BBBPP2222B/);
    expect(out[0].reason).toMatch(/invoice/i);
  });

  it("still bulk-pairs identical records that share ONE PAN", () => {
    const out = reconcileTally(
      [txn("a", "RAMESH PATEL", "2026-03-05", 20229, "AAAPP1111A"), txn("b", "RAMESH PATEL", "2026-03-05", 20229, "AAAPP1111A")],
      [row(0, "Ramesh Patel", "2026-03-05", 20229), row(1, "Ramesh Patel", "2026-03-05", 20229)], null);
    expect(out.every((r) => r.result === "Matched")).toBe(true);
  });
});

describe("reconcileTally — the distinctness witness gates the SUGGESTION", () => {
  // A suggestion is nearly as dangerous as an auto-match: it is ONE CLICK from
  // becoming an asserted identity that auto-matches silently for ever. So it is
  // exclusivity-gated exactly like a match — and over the WHOLE universe, not just the
  // rows still in play, because a rival that cannot compete THIS quarter is still proof
  // that this client's books keep the two spellings apart.
  // The rival is booked under 194J, whose ledger was never imported. He therefore takes
  // NO part in the assignment — but he is still a deductee in this client's books, and
  // the witness must see him. If ledger coverage could erase a deductee, importing one
  // fewer ledger would silently BUY you a wrong mapping.
  const rival = { ...txn("b", "RAMESH PATIL", "2026-03-05", 20229, "BBBPP2222B"), section: "194J" };

  it("refuses to suggest a spelling its own Office Data keeps apart", () => {
    // "Ramesh Patil" is forced by elimination onto RAMESH PATEL — nothing else can take
    // it. Exclusivity alone would say "suggest it". But Office Data lists a SEPARATE
    // deductee spelled "RAMESH PATIL" under a different PAN, and different PANs are
    // PROOF of different parties, so the two spellings are two people.
    const out = reconcileTally(
      [txn("a", "RAMESH PATEL", "2026-03-05", 20229, "AAAPP1111A"), rival],
      [row(0, "Ramesh Patil", "2026-03-05", 20229, "194C")], null);
    const a = out.find((r) => r.office_deductee_id === "a")!;
    expect(a.result).toBe("Multiple Possible Matches");
    expect(a.suggested_party).toBeUndefined();
    expect(a.reason).toMatch(/RAMESH PATIL/);
    expect(a.reason).toMatch(/BBBPP2222B/);
    expect(a.reason).toMatch(/not merged/i);
    // The rival himself is a ledger-coverage problem, not a matching one.
    expect(out.find((r) => r.office_deductee_id === "b")!.result).toBe("No Ledger for Section");
  });

  it("DOES suggest the same pairing once the rival spelling is gone", () => {
    // Same name pair, same facts — only the candidate set differs. This is the whole
    // thesis in two assertions: the verdict is a property of the SET, not the pair.
    const out = reconcileTally([txn("a", "RAMESH PATEL", "2026-03-05", 20229, "AAAPP1111A")],
      [row(0, "Ramesh Patil", "2026-03-05", 20229, "194C")], null);
    expect(out[0].result).toBe("Party Name Mismatch");
    expect(out[0].suggested_party).toBe("Ramesh Patil");
  });
});

describe("assignment — the tier ladder", () => {
  it("pins the tier ORDER literally", () => {
    // The order is load-bearing and SILENTLY breakable: reorder these and a weaker
    // pairing wins with no other test failing. Hence a test that just says the order.
    //
    // APAN (PAN EQUALITY) is FIRST — the legal identity, stronger than any name (two
    // different people can share a name; they cannot share a PAN). It is inert in
    // Stage 3 (a Tally ledger row has no PAN) and only fires for Stage 1, where BOTH
    // sides carry a PAN.
    //
    // A1 (EXACT) PRECEDES A0 (ASSERTED) deliberately. A saved mapping must beat every
    // weaker INFERENCE for its row but YIELD to a direct verbatim-name claim. When A0
    // ran first, a stale mapping silently stole a row from the record whose name was
    // that party verbatim — a wrong-PAN filing (fixed; see the A0-vs-verbatim test).
    expect(TIERS.map((t) => t.id)).toEqual(["APAN", "A1", "A0", "A2", "A3", "A4"]);
  });

  it("pins that EVERY tier auto-commits, and safety rests on AUTO_MATCH_MAX_RANK", () => {
    // A4 (RISKY) now auto-commits its mutually-best PAIRING, so tier-4 names resolve on
    // crowded month-end blocks where the old degree-1 residue closer deadlocked and
    // committed nothing. Auto-commit is NOT a match: AUTO_MATCH_MAX_RANK (rank 3.5)
    // independently withholds "Matched" from rank-4 names. The 31 "ALONE" adversarial
    // pairs staying at "Party Name Mismatch" with A4 auto-committing is the live proof.
    expect(TIERS.every((t) => t.autoCommit)).toBe(true);
    expect(AUTO_MATCH_MAX_RANK).toBeLessThan(4);
  });

  it("pins that only the ASSERTED and PAN tiers are exempt from needing corroboration", () => {
    // A mapped party whose date AND amount are both wrong must still be FOUND and
    // reported, or the mapping silently does nothing and the record comes back
    // "Ledger Entry Not Found" — the exact bug the old mapping branch existed to fix.
    // A same-PAN pair (APAN) is exempt for the identical reason: the PAN IS the
    // corroboration, so a same-party pair whose figures both differ must still pair and
    // be reported as a mismatch rather than vanish as a phantom "not found".
    expect(TIERS.filter((t) => !t.needsCorroboration).map((t) => t.id)).toEqual(["APAN", "A0"]);
  });
});

describe("assignment — safety properties over a randomised corpus", () => {
  // A hand-picked fixture proves the case it was picked for. These properties must
  // hold for EVERY input, so they are asserted over a generated population drawn from
  // the same distribution the adversarial audit found: same surnames, same families,
  // one vowel apart, sharing dates and amounts.
  const mulberry = (seed: number) => () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const FIRST = ["RAMESH", "RAMESH", "KIRAN", "KARAN", "HIRALAL", "HARILAL", "DIPAK", "DIPIKA", "MANISH", "MUNISH", "TARUBEN", "KONE"];
  const LAST = ["PATEL", "PATIL", "SHAH", "MEHTA", "THAKKAR", "THAKUR", "KATHARANI", "KATHRANI"];
  const DATES = ["2026-03-01", "2026-03-02", "2026-03-05", "2026-03-06"];
  const AMTS = [5000, 20229, 20529];

  const corpus = (seed: number) => {
    const rnd = mulberry(seed);
    const pick = <T,>(xs: T[]) => xs[Math.floor(rnd() * xs.length) % xs.length];
    const nOff = 3 + Math.floor(rnd() * 6), nLed = 3 + Math.floor(rnd() * 6);
    const office: OfficeTxn[] = Array.from({ length: nOff }, (_, i) =>
      txn(`o${i}`, `${pick(FIRST)} ${pick(LAST)}`, pick(DATES), pick(AMTS), `AAAPP${1000 + i}A`));
    const ledger: TallyRow[] = Array.from({ length: nLed }, (_, i) =>
      row(i, `${pick(FIRST)} ${pick(LAST)}`, pick(DATES), pick(AMTS)));
    return { office, ledger };
  };

  const SEEDS = Array.from({ length: 250 }, (_, i) => i + 1);

  it("is ORDER-INDEPENDENT: reversing the office list yields the same verdicts", () => {
    // VERIFIED TO FAIL ON MAIN. The greedy loop committed on local information, so the
    // answer depended on the order Supabase happened to return rows in.
    for (const s of SEEDS) {
      const { office, ledger } = corpus(s);
      const fwd = reconcileTally(office, ledger, null);
      const rev = reconcileTally([...office].reverse(), ledger, null);
      const key = (rs: typeof fwd) => rs.map((r) => `${r.office_deductee_id}=${r.result}@${r.tally_row_index}`).sort().join("|");
      expect(key(rev), `seed ${s}`).toBe(key(fwd));
    }
  });

  it("never Matches on a name weaker than the auto-match line (DECISION 1)", () => {
    for (const s of SEEDS) {
      const { office, ledger } = corpus(s);
      for (const r of reconcileTally(office, ledger, null)) {
        if (r.result !== "Matched" || r.tally_row_index === null) continue;
        const t = ledger[r.tally_row_index];
        expect(rank(nameEvidence(r.office_name, t.party).tier), `seed ${s}: "${r.office_name}" vs "${t.party}"`)
          .toBeLessThanOrEqual(AUTO_MATCH_MAX_RANK);
      }
    }
  });

  it("SAFETY THEOREM: never Matches a record while a better-named entry sits unclaimed", () => {
    // If a strictly better-named row was left free, the stronger tier would have taken
    // it. A violation means a weaker tier committed while a stronger alternative was
    // still available — i.e. the ladder's consumption order broke.
    for (const s of SEEDS) {
      const { office, ledger } = corpus(s);
      const out = reconcileTally(office, ledger, null);
      const claimed = new Set(out.map((r) => r.tally_row_index).filter((x): x is number => x !== null));
      for (const r of out) {
        if (r.result !== "Matched" || r.tally_row_index === null) continue;
        const mine = rank(nameEvidence(r.office_name, ledger[r.tally_row_index].party).tier);
        for (let i = 0; i < ledger.length; i++) {
          if (claimed.has(i)) continue;
          expect(rank(nameEvidence(r.office_name, ledger[i].party).tier), `seed ${s}: "${r.office_name}" took "${ledger[r.tally_row_index!].party}" while "${ledger[i].party}" was free`)
            .toBeGreaterThanOrEqual(mine);
        }
      }
    }
  });

  it("claims every ledger entry AT MOST ONCE", () => {
    for (const s of SEEDS) {
      const { office, ledger } = corpus(s);
      const used = reconcileTally(office, ledger, null).map((r) => r.tally_row_index).filter((x): x is number => x !== null);
      expect(new Set(used).size, `seed ${s}`).toBe(used.length);
    }
  });

  it("accounts for every ledger entry: claimed, or reported as surplus", () => {
    // Reconciliation is symmetric or it is not reconciliation. A credit no office
    // record claimed is a deduction in Tally with no line on the return.
    for (const s of SEEDS) {
      const { office, ledger } = corpus(s);
      const { rows, surplusLedger } = reconcileTallyFull(office, ledger, null);
      const claimed = new Set(rows.map((r) => r.tally_row_index).filter((x): x is number => x !== null));
      const surplus = new Set(surplusLedger.map((t) => t.row_index));
      for (const t of ledger) {
        expect(claimed.has(t.row_index) || surplus.has(t.row_index), `seed ${s}: row ${t.row_index} vanished`).toBe(true);
      }
      expect([...claimed].some((c) => surplus.has(c)), `seed ${s}`).toBe(false);
    }
  });
});

describe("reconcileTally — no exception is ever a bare shrug", () => {
  it("names the closest entry and why it failed, instead of a bare not-found", () => {
    const out = reconcileTally([txn("a", "KONE ELEVATOR INDIA PRIVATE LIMITED", "2026-03-05", 20229)],
      [row(0, "Kone Elevator India Pvt Ltd", "2026-03-02", 20229)], null);
    // In window and forced by elimination, so it is PAIRED and reported honestly.
    expect(out[0].result).toBe("Date Mismatch");
    expect(out[0].reason).toMatch(/Kone Elevator India Pvt Ltd/);
    expect(out[0].reason).toMatch(/3 days/);
  });

  it("reports cardinality exhaustion as an audit finding, not a shrug", () => {
    const office = Array.from({ length: 4 }, (_, i) => txn(`k${i}`, "KONE ELEVATOR INDIA PRIVATE LIMITED", "2026-03-01", 20229));
    const ledger = Array.from({ length: 3 }, (_, i) => row(i, "Kone Elevator India Pvt Ltd", "2026-03-01", 20229));
    const out = reconcileTally(office, ledger, "194C");
    const miss = out.find((r) => r.result !== "Matched")!;
    expect(out.filter((r) => r.result === "Matched")).toHaveLength(3);
    expect(miss.result).toBe("Ledger Entry Not Found");
    expect(miss.reason).toMatch(/holds 3 entries/);
    expect(miss.reason).toMatch(/Office Data holds 4/);
    expect(miss.reason).toMatch(/short by 1/);
  });

  it("reports a far-dated lone credit as a Date Mismatch, not a phantom not-found", () => {
    // There is NO date window (a span-derived ±15 days was the same client-shape bug on
    // the date axis — it turned an ordinary 31-Mar provision booked 10-Apr into a
    // phantom "Ledger Entry Not Found"). When the ONLY ledger entry for a party is far
    // off, the honest, actionable verdict is a Date Mismatch naming the day count — the
    // CA learns this quarter's entry is missing — never a silent Match (dateDelta drives
    // the verdict) and never a bare not-found.
    const out = reconcileTally([txn("a", "KONE ELEVATOR INDIA PRIVATE LIMITED", "2026-03-05", 20229)],
      [row(0, "Kone Elevator India Pvt Ltd", "2025-08-11", 20229)], null);
    expect(out[0].result).toBe("Date Mismatch");
    expect(out[0].result).not.toBe("Matched");
    expect(out[0].reason).toMatch(/day/i);
  });

  it("EXCLUSIVITY, not a window, keeps the stale credit out when the real one exists", () => {
    // This is the window's only legitimate job, done by evidence instead of a cutoff:
    // when this quarter's entry is present it carries dateDelta 0 and strictly dominates
    // the recurring stale one, so the near entry Matches and the stale one is left as
    // surplus — no client-shape parameter anywhere.
    const out = reconcileTally([txn("a", "KONE ELEVATOR INDIA PRIVATE LIMITED", "2026-03-05", 20229)],
      [row(0, "Kone Elevator India Pvt Ltd", "2025-08-11", 20229),
       row(1, "Kone Elevator India Pvt Ltd", "2026-03-05", 20229)], null);
    expect(out[0].result).toBe("Matched");
    expect(out[0].tally_row_index).toBe(1);
  });
});

describe("reconcileTally — a saved mapping resolves the PARTY and nothing else", () => {
  const map = { "RAMESH PATEL": "Some Trade Name" };

  it("matches via the mapping when the facts agree", () => {
    const out = reconcileTally([txn("a", "RAMESH PATEL", "2026-03-05", 20229)], [row(0, "Some Trade Name", "2026-03-05", 20229)], null, map);
    expect(out[0].result).toBe("Matched");
    expect(out[0].mapped).toBe(true);
  });

  it("still FINDS a mapped party whose date AND amount are both wrong", () => {
    // The user asserted the identity, so the assertion IS the corroboration. Requiring
    // a date or amount hit here is what made the mapping silently do nothing and the
    // record come back "Ledger Entry Not Found".
    const out = reconcileTally([txn("a", "RAMESH PATEL", "2026-03-05", 20229)], [row(0, "Some Trade Name", "2026-03-11", 999)], null, map);
    expect(out[0].result).not.toBe("Ledger Entry Not Found");
    expect(out[0].mapped).toBe(true);
    expect(out[0].tally_row_index).toBe(0);
  });

  it("never lets a mapping manufacture a Match when the money is wrong", () => {
    const out = reconcileTally([txn("a", "RAMESH PATEL", "2026-03-05", 20229)], [row(0, "Some Trade Name", "2026-03-05", 999)], null, map);
    expect(out[0].result).toBe("Credit Amount Mismatch");
    expect(out[0].mapped).toBe(true);
  });

  it("a saved mapping never steals a row from the record whose name IS that party", () => {
    // FINDING 1. office A's name is the ledger party VERBATIM; office B (different PAN)
    // is mapped onto the same party. When A0 (mapped) ran before A1 (exact) the mapping
    // won the row uncontested and filed B against A's ledger entry — a silent wrong-PAN
    // filing. A1 now precedes A0, so the verbatim owner takes its row and the mapping,
    // denied it, is reported instead of mis-committed.
    const out = reconcileTally(
      [txn("a", "SOME TRADE NAME", "2026-03-05", 20229, "AAAPP1111A"),
       txn("b", "RAMESH PATEL", "2026-03-05", 20229, "BBBPP2222B")],
      [row(0, "Some Trade Name", "2026-03-05", 20229)], null, { "RAMESH PATEL": "Some Trade Name" });
    const a = out.find((r) => r.office_deductee_id === "a")!;
    const b = out.find((r) => r.office_deductee_id === "b")!;
    expect(a.result).toBe("Matched");
    expect(a.tally_row_index).toBe(0);
    expect(b.result).not.toBe("Matched");        // the mapping did NOT steal the row
    expect(b.tally_row_index).not.toBe(0);
  });
});

describe("canonicalSection — a hand-written Tally ledger title", () => {
  // Stage 3 reads the section off the ledger's free-text NAME line, which a human typed.
  // Requiring the sub-section letter to be glued to the digits read "TDS Payable - 194 C
  // 25-26" as bare "194" (dividend), so EVERY office record in that file came back "No
  // Ledger for Section" — a whole-client false mismatch from one space.
  it.each([
    ["TDS Payable-194C 25-26", "194C"],
    ["TDS Payable - 194 C 25-26", "194C"],
    ["TDS Payable-194-C 25-26", "194C"],
    ["TDS Payable 194 J 25-26", "194J"],
    ["Sec 194 I Rent Payable", "194I"],
    ["TDS 194 Q Purchase", "194Q"],
    ["194C(2)", "194C"],
    ["206 C", "206C"],
    ["194IA", "194IA"],
  ])("reads %s as %s", (raw, want) => {
    expect(canonicalSection(raw)).toBe(want);
  });

  it("lets a keyword REFINE a bare number, but never override it", () => {
    // The digits ran first and returned early, so /contract/ could not add the letter
    // the title omitted. It may now refine 194 -> 194C, but only on the same base.
    expect(canonicalSection("TDS on Contractors 194")).toBe("194C");
    expect(canonicalSection("TDS on Professional Fees 194")).toBe("194J");
    expect(canonicalSection("194 Dividend")).toBe("194");   // keyword agrees, no letter
    expect(canonicalSection("192 Salary")).toBe("192");
    // A keyword must never move the record to a different base section.
    expect(canonicalSection("195 Payment to contractor abroad")).toBe("195");
  });

  it("does not invent a section code out of ordinary words", () => {
    // The letter may be separated by a space, so an open [A-Z]{1,2} would read "194 to
    // 195" as "194TO" — a code that matches nothing and fails the file.
    expect(canonicalSection("Sec 194 to 195")).toBe("194");
    expect(canonicalSection("194 and 195")).toBe("194");
  });

  it("still reconciles a ledger whose title spaces the sub-section letter", () => {
    // End-to-end: the section is the HARD gate at every tier, so this used to make the
    // whole file unreconcilable.
    const out = reconcileTally(
      [txn("a", "ACME CONTRACTORS", "2026-03-05", 20229)],
      [row(0, "Acme Contractors", "2026-03-05", 20229, "TDS Payable - 194 C 25-26")], null);
    expect(out[0].result).toBe("Matched");
    expect(out[0].result).not.toBe("No Ledger for Section");
  });
});

describe("nameEvidence — a Tally annotation is not part of the party name", () => {
  it("ignores a rate or section suffix the ledger appends", () => {
    // Once ENTERPRISE/TRADERS are stopwords these collapse to ONE token, and one token
    // against two can never reach the 0.6 hits/union ratio — so an obviously identical
    // party escalated as a Party Name Mismatch.
    expect(rank(nameEvidence("ABC ENTERPRISE", "ABC ENTERPRISE (2%)").tier)).toBeLessThanOrEqual(3);
    expect(rank(nameEvidence("XYZ ENTERPRISE", "XYZ ENTERPRISE 194C").tier)).toBeLessThanOrEqual(3);
    expect(rank(nameEvidence("SHAH TRADING", "SHAH TRADING - 194C 2%").tier)).toBeLessThanOrEqual(3);
  });

  it("matches such a record outright instead of asking for a mapping", () => {
    const out = reconcileTally([txn("a", "ABC ENTERPRISE", "2026-03-05", 20229)],
      [row(0, "ABC ENTERPRISE (2%)", "2026-03-05", 20229)], null);
    expect(out[0].result).toBe("Matched");
    expect(out[0].suggested_party).toBeUndefined();
  });

  it("KEEPS a number that both sides carry — it distinguishes the parties", () => {
    // The asymmetry test is what makes the rule safe: a digit present on both sides is
    // contrastive, and stripping it would merge two genuinely different ledger accounts.
    expect(rank(nameEvidence("UNIT 1 TRADERS", "UNIT 2 TRADERS").tier)).toBeGreaterThan(3.5);
    expect(rank(nameEvidence("PLOT 7 ENTERPRISE", "PLOT 9 ENTERPRISE").tier)).toBeGreaterThan(3.5);
  });
});

describe("nameEvidence — a generic ledger head (no party name in the ledger at all)", () => {
  // Reported verbatim from REVTI INFRA's real 194A ledger: interest TDS-deducted for
  // several DIFFERENT unsecured-loan lenders is booked to ONE shared account named
  // "Interest on Unsecured Loan" instead of a per-lender sub-ledger, so Tally's export
  // has no party text at all for any of these credits — every one of them shared 0
  // tokens with its real office deductee and was reported "Ledger Entry Not Found" even
  // with an EXACT date+amount match sitting right there in the ledger.
  it("is rank 3.5 (\"unknown\"), same as a blank name — never a hard mismatch", () => {
    expect(nameEvidence("DWARKESH CHEMICALS", "Interest on Unsecured Loan").tier).toBe("unknown");
    expect(nameEvidence("PRAVINKUMAR HARJIBHAI LAKHANI", "Interest on Unsecured Loan").tier).toBe("unknown");
    expect(nameEvidence("KIRIT PANCHABHAI SUKHADIA HUF", "interest paid on unsecured loans").tier).toBe("unknown");
  });

  it("does NOT fire on a real party whose name merely contains those words", () => {
    // Whole-string match only — a lender actually named this must still compare normally.
    expect(nameEvidence("DWARKESH CHEMICALS", "Interest Loans Finance Private Limited").tier).not.toBe("unknown");
  });

  it("matches outright on an exact date+amount instead of 'Ledger Entry Not Found'", () => {
    const out = reconcileTally(
      [txn("a", "DWARKESH CHEMICALS", "2026-03-01", 925), txn("b", "PRAVINKUMAR HARJIBHAI LAKHANI", "2026-03-31", 11250)],
      [row(0, "Interest on Unsecured Loan", "2026-03-01", 925), row(1, "Interest on Unsecured Loan", "2026-03-31", 11250)],
      null,
    );
    expect(out.map((r) => r.result)).toEqual(["Matched", "Matched"]);
  });

  it("still reports the record — as the correct remaining issue — when date or amount genuinely differ", () => {
    // No party text is not a licence to match anything: A3 still demands the facts exactly.
    const out = reconcileTally(
      [txn("a", "DWARKESH CHEMICALS", "2026-03-01", 925)],
      [row(0, "Interest on Unsecured Loan", "2026-03-05", 925)], // 4 days out
      null,
    );
    expect(out[0].result).toBe("Date Mismatch");
  });
});

describe("nameEvidence — a trailing free-text clause is not part of the party name", () => {
  // Reported verbatim from real Tally exports: office data drops the deductee's middle
  // (patronymic) name, WHILE the ledger head appends a nature-of-transaction or
  // proprietor aside after a hyphen/parenthesis. Either alone is already rescued
  // elsewhere in this file; together they used to fail, because each side then carries
  // exactly one token the other cannot match, and that pushes the 0.6 hits/union ratio
  // below the line. Confirmed against the user's real 194A/194C ledger PDFs.
  it("drops a Tally nature-of-transaction tag introduced by a hyphen", () => {
    expect(rank(nameEvidence("DUSHYANT JASHVANTBHAI PRAJAPATI", "Dushyant Prajapati - Exp.").tier)).toBeLessThanOrEqual(3);
    expect(rank(nameEvidence("PINNAG BIPINBHAI RATHOD", "Pinnag Rathod - Exp.").tier)).toBeLessThanOrEqual(3);
    expect(rank(nameEvidence("KETANKUMAR HARIBHAI PARMAR", "Technosol Corporation-Pur").tier)).toBeGreaterThan(3.5); // sanity: unrelated names still don't match
  });

  it("drops a proprietor/branch aside in a trailing parenthesis", () => {
    expect(rank(nameEvidence("KETANKUMAR HARIBHAI PARMAR", "Ketan Parmar (BH Parmar Electrician)").tier)).toBeLessThanOrEqual(3);
  });

  it("matches such a record outright instead of asking for a mapping", () => {
    const out = reconcileTally(
      [txn("a", "DUSHYANT JASHVANTBHAI PRAJAPATI", "2026-03-31", 10807)],
      [row(0, "Dushyant Prajapati - Exp.", "2026-03-31", 10807)], null);
    expect(out[0].result).toBe("Matched");
  });

  it("does NOT strip a clause that both sides carry — a shared tail is not asymmetric", () => {
    // Two different branch ledgers must not be merged just because both happen to
    // trail a location tag — the annotation is then CONTRASTIVE, not decorative,
    // mirroring the numeric-annotation rule above.
    expect(rank(nameEvidence("ABC Traders - Pune", "ABC Traders - Mumbai").tier)).toBeGreaterThan(3.5);
  });

  it("never collapses a genuinely different name into a false match", () => {
    // A trailing tag must not rescue an otherwise-unrelated pair, and the vowel-
    // substitution guard (PATEL/PATIL) must still hold with a tag riding along.
    expect(nameCompare("Ramesh Patil", "Ramesh Patel - Pur")).not.toBe("match");
    expect(nameCompare("Kiran Shah", "Karan Shah - Exp.")).not.toBe("match");
  });

  it("never treats a legal-status qualifier (HUF/Firm/AOP/BOI/Trust) as decoration", () => {
    // An HUF (or firm/AOP/BOI/trust) is a DIFFERENT ASSESSEE from the individual named
    // beside it under the Income Tax Act — its own PAN, its own return. Unlike "Exp."
    // or a location tag, dropping this changes WHO THE DEDUCTEE IS, so it must never
    // clear the auto-match bar, whether it arrives via a hyphen/parenthesis or as a
    // plain extra token.
    expect(rank(nameEvidence("Ramesh Patel", "Ramesh Patel - HUF").tier)).toBeGreaterThan(3.5);
    expect(rank(nameEvidence("Ramesh Patel", "Ramesh Patel HUF").tier)).toBeGreaterThan(3.5);
    expect(rank(nameEvidence("Suresh Kumar Shah", "Suresh Shah (HUF)").tier)).toBeGreaterThan(3.5);
    expect(rank(nameEvidence("Amit Mehta", "Amit Mehta - Firm").tier)).toBeGreaterThan(3.5);
  });

  it("never collapses a compound hyphenated identity down to one fragile token", () => {
    // "R-Tech Solutions" must not be read as "R" plus a droppable "Tech Solutions"
    // clause — a single surviving short token risks a spurious initial-match against
    // unrelated names elsewhere. The core must retain at least two real tokens for a
    // trailing clause to be stripped at all.
    expect(nameCompare("R-Tech Solutions Private Limited", "Rajesh Patel")).not.toBe("match");
    expect(nameCompare("J-Mart Retail", "Suresh Kumar")).not.toBe("match");
  });
});

describe("amountsMatch — rounding, not an unbounded percentage", () => {
  it("still forgives genuine rounding", () => {
    expect(amountsMatch(20229, 20229)).toBe(true);
    expect(amountsMatch(20229, 20228)).toBe(true);       // rupee rounding
    expect(amountsMatch(1011450, 1011445)).toBe(true);   // round to nearest ten
  });

  it("no longer absorbs a real short deduction into a silent Match", () => {
    // The tolerance was RELATIVE and unbounded, so the rupee gap it forgave grew without
    // limit — a ₹5cr credit absorbed ₹2.5 lakh. Each of these is a real 201(1A) exposure.
    expect(amountsMatch(200000, 199100)).toBe(false);      // short by ₹900
    expect(amountsMatch(1000000, 995500)).toBe(false);     // short by ₹4,500
    expect(amountsMatch(5000000, 4980000)).toBe(false);    // short by ₹20,000
    expect(amountsMatch(20000, 19910)).toBe(false);        // short by ₹90
  });

  it("reports the short deduction instead of reconciling it", () => {
    const out = reconcileTally([txn("a", "ACME TRADING", "2026-03-05", 200000)],
      [row(0, "Acme Trading", "2026-03-05", 199100)], null);
    expect(out[0].result).not.toBe("Matched");
  });
});

describe("reconcileTally — evidence, not degree, resolves a crowded month-end block", () => {
  it("resolves risky (tier-4) names on a same-date, same-amount crowd — FINDING 2", () => {
    // The old residue closer only paired an office with exactly ONE edge whose row had
    // exactly ONE suitor. On a month-end block every record is adjacent to every row, so
    // it deadlocked and reported all of them "Ledger Entry Not Found". A4 now commits its
    // evidence-dominant pairing: each office resolves to its OWN best-name row. Each is a
    // suggestion (tier 4), never a silent Match.
    const names: [string, string][] = [
      ["RAMESH PATEL", "Ramesh Patil"], ["MAHESH PATEL", "Mahesh Patil"], ["SURESH PATEL", "Suresh Patil"],
    ];
    const out = reconcileTally(
      names.map(([o], i) => txn(`o${i}`, o, "2026-03-31", 20229, `AAAPP111${i}A`)),
      names.map(([, l], i) => row(i, l, "2026-03-31", 20229)), null);
    for (let i = 0; i < names.length; i++) {
      const r = out.find((x) => x.office_deductee_id === `o${i}`)!;
      expect(r.result).toBe("Party Name Mismatch");     // resolved, not deadlocked
      expect(r.result).not.toBe("Matched");             // risky name never auto-matches
      expect(r.suggested_party).toBe(names[i][1]);       // and to the RIGHT counterpart
    }
  });
});

describe("reconcileTally — no client-shape date window (FINDING 3)", () => {
  it("reports a year-end provision booked in April as a Date Mismatch, not not-found", () => {
    // Deduction dated 31-Mar, ledger books it 10-Apr — the ordinary Q4 shape. The
    // span-derived ±15-day window made this a phantom "Ledger Entry Not Found"; the CA
    // must instead see a Date Mismatch naming the day count.
    const out = reconcileTally(
      [txn("a", "SHARMA AND ASSOCIATES", "2026-03-31", 10000),
       txn("b", "VERMA CONSULTANCY", "2026-03-31", 10000)],
      [row(0, "Sharma & Associates", "2026-03-31", 10000),
       row(1, "Verma Consultancy", "2026-04-10", 10000)], null);
    const b = out.find((r) => r.office_deductee_id === "b")!;
    expect(b.result).toBe("Date Mismatch");
    expect(b.result).not.toBe("Ledger Entry Not Found");
    expect(b.reason).toMatch(/day/i);
  });

  it("gives one pair the SAME verdict regardless of unrelated records in the file", () => {
    // The span window made a verdict depend on OTHER records: adding a far-dated
    // unrelated record widened the span and flipped this pair from not-found to Date
    // Mismatch. The verdict is now a property of the pair and its competitors only.
    const office = txn("a", "ACME TRADING COMPANY", "2026-03-05", 5000, "AAAPP1111A");
    const led = row(0, "Acme Trading Company", "2026-03-21", 5000);   // 16 days out
    const alone = reconcileTally([office], [led], null);
    const withOthers = reconcileTally(
      [office, txn("z", "ZEBRA CORPORATION", "2026-04-30", 9999, "ZZZPP9999Z")],
      [led, row(1, "Zebra Corporation", "2026-04-30", 9999)], null);
    const a1 = alone[0];
    const a2 = withOthers.find((r) => r.office_deductee_id === "a")!;
    expect(a2.result).toBe(a1.result);
    expect(a2.tally_row_index).toBe(a1.tally_row_index);
  });
});
