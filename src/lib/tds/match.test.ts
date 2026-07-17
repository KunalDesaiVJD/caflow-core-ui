/**
 * Regression tests for the two matching behaviours the user reported from real
 * client data. Both are cases where the engine escalated to the user instead of
 * deciding — the complaint each time was "why are you asking me this?".
 */
import { describe, it, expect } from "vitest";
import { nameCompare } from "./match";
import { reconcileTally, type OfficeTxn, type TallyRow } from "./tallyRecon";

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
});
