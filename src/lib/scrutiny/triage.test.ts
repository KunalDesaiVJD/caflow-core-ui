import { describe, it, expect } from "vitest";
import { triage, scoreFinding, triageSummary, type TriageFinding } from "./triage";

const f = (rule_id: string, amount: number | null, severity = "MEDIUM", detection_level = "account"): TriageFinding =>
  ({ rule_id, amount, severity, detection_level });

const PM = 300_000;

describe("scoreFinding", () => {
  it("ranks a larger balance above a smaller one on the same rule", () => {
    expect(scoreFinding(f("A", 5_000_000), PM)).toBeGreaterThan(scoreFinding(f("A", 400_000), PM));
  });

  it("scales to the engagement, not to absolute rupees", () => {
    // The same Rs.5,00,000 balance is a real issue at a small engagement and noise at a large one.
    const small = scoreFinding(f("A", 500_000), 50_000);
    const large = scoreFinding(f("A", 500_000), 5_000_000);
    expect(small).toBeGreaterThan(large);
  });

  // Severity cannot drive selection here: 48% of real findings are HIGH, ~46 per engagement.
  it("lets a much larger MEDIUM outrank a trivial HIGH", () => {
    expect(scoreFinding(f("A", 20_000_000, "MEDIUM"), PM)).toBeGreaterThan(scoreFinding(f("B", 1_000, "HIGH"), PM));
  });

  it("still uses severity to break ties at equal size", () => {
    expect(scoreFinding(f("A", 500_000, "HIGH"), PM)).toBeGreaterThan(scoreFinding(f("A", 500_000, "LOW"), PM));
  });

  // "No depreciation charged at all" carries no amount but is the most consequential finding there is.
  it("does not bury engagement-level findings that carry no amount", () => {
    const aggregate = scoreFinding({ rule_id: "FA-202", severity: "HIGH", amount: null, detection_level: "aggregate" }, PM);
    expect(aggregate).toBeGreaterThan(scoreFinding(f("X", 400_000, "MEDIUM"), PM));
  });

  it("degrades sensibly when no materiality is approved", () => {
    expect(scoreFinding(f("A", 5_000_000), null)).toBeGreaterThan(scoreFinding(f("A", 10_000), null));
  });
});

describe("triage — a capped, broad shortlist", () => {
  it("caps the shortlist and puts the remainder in notes", () => {
    const many = Array.from({ length: 200 }, (_, i) => f(`R${i % 20}`, 1_000_000 - i * 1_000));
    const t = triage(many, { maxQueries: 25, performanceMateriality: PM });
    expect(t.queries).toHaveLength(25);
    expect(t.notes).toHaveLength(175);
  });

  // The core mechanism: without a per-rule cap, one prolific rule fills every slot and the auditor
  // sees twenty instances of one issue instead of a spread of distinct issues.
  it("stops a single prolific rule from consuming the whole shortlist", () => {
    const flood = Array.from({ length: 100 }, (_, i) => f("CRED-004", 9_000_000 - i));
    const others = ["FA-202", "TDS-210", "GST-201", "PROV-201"].map((r) => f(r, 500_000));
    const t = triage([...flood, ...others], { maxQueries: 10, maxPerRule: 3, performanceMateriality: PM });

    const cred = t.queries.filter((q) => q.rule_id === "CRED-004").length;
    expect(cred).toBe(3);
    // every other rule got a place despite scoring lower than the flood
    for (const r of ["FA-202", "TDS-210", "GST-201", "PROV-201"]) {
      expect(t.queries.some((q) => q.rule_id === r)).toBe(true);
    }
  });

  it("keeps the biggest instances of a capped rule, not arbitrary ones", () => {
    const flood = [f("A", 100), f("A", 9_000_000), f("A", 50), f("A", 4_000_000), f("A", 10)];
    const t = triage(flood, { maxQueries: 5, maxPerRule: 2, performanceMateriality: PM });
    expect(t.queries.map((q) => q.amount)).toEqual([9_000_000, 4_000_000]);
  });

  // The cap is hard: topping the list back up with more of an already-capped rule would defeat the
  // only thing it exists for. A one-issue engagement gets a short list, not a padded one.
  it("returns a short list rather than padding it with a capped rule", () => {
    const only = Array.from({ length: 12 }, (_, i) => f("A", 1_000_000 - i));
    const t = triage(only, { maxQueries: 8, maxPerRule: 3, performanceMateriality: PM });
    expect(t.queries).toHaveLength(3);
    expect(t.notes).toHaveLength(9);
  });

  it("never loses or duplicates a finding", () => {
    const all = Array.from({ length: 57 }, (_, i) => f(`R${i % 7}`, i * 1000));
    const t = triage(all, { maxQueries: 25, performanceMateriality: PM });
    expect(t.queries.length + t.notes.length).toBe(57);
    expect(new Set([...t.queries, ...t.notes]).size).toBe(57);
  });

  it("is deterministic across runs", () => {
    const all = Array.from({ length: 40 }, (_, i) => f(`R${i % 5}`, 500_000));
    const a = triage(all, { performanceMateriality: PM }).queries.map((q) => q.rule_id);
    const b = triage(all, { performanceMateriality: PM }).queries.map((q) => q.rule_id);
    expect(a).toEqual(b);
  });

  it("handles an engagement with fewer findings than the cap", () => {
    const t = triage([f("A", 1000), f("B", 2000)], { maxQueries: 25, performanceMateriality: PM });
    expect(t.queries).toHaveLength(2);
    expect(t.notes).toHaveLength(0);
  });

  it("summarises breadth, which is what the cap is for", () => {
    const all = [...Array.from({ length: 50 }, () => f("A", 900_000)), f("B", 800_000), f("C", 700_000)];
    // 3 of A (capped) + B + C = 5 across 3 distinct rules; the other 47 A's are notes.
    const s = triageSummary(triage(all, { maxQueries: 10, maxPerRule: 3, performanceMateriality: PM }));
    expect(s).toEqual({ total: 52, queries: 5, notes: 47, queryRules: 3 });
  });
});
