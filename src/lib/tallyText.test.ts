import { describe, it, expect } from "vitest";
import { cleanTallyName, cleanTallyRow, buildLedgerMapMatcher } from "@/lib/tallyText";

describe("cleanTallyName", () => {
  it("strips numeric HTML entities Tally embeds for control chars", () => {
    expect(cleanTallyName("The District TB Centre&#13;&#10;")).toBe("The District TB Centre");
    expect(cleanTallyName("&#4;Primary")).toBe("Primary");
  });

  it("strips raw ASCII control chars", () => {
    expect(cleanTallyName("Vehical Expenses\r\n")).toBe("Vehical Expenses");
  });

  it("normalises named entities and trims", () => {
    expect(cleanTallyName("  A &amp; B  ")).toBe("A & B");
  });

  it("is idempotent on an already-clean name", () => {
    const clean = "Trade Payables";
    expect(cleanTallyName(clean)).toBe(clean);
  });

  it("handles null/undefined without throwing", () => {
    expect(cleanTallyName(null)).toBe("");
    expect(cleanTallyName(undefined)).toBe("");
  });
});

describe("cleanTallyRow", () => {
  it("cleans both ledger_name and parent_group", () => {
    const row = cleanTallyRow({ ledger_name: "Foo&#13;&#10;", parent_group: "Bar&#4;", closing_balance: 100 });
    expect(row.ledger_name).toBe("Foo");
    expect(row.parent_group).toBe("Bar");
    expect(row.closing_balance).toBe(100);
  });
});

describe("buildLedgerMapMatcher — RC-21 regression (VADIWALA / RAY WINGS TECHNOLOGY)", () => {
  it("resolves a control-char-corrupted TB ledger name against a clean coa_mapping key", () => {
    // coa_mapping is always persisted keyed by cleanTallyName() output (PipelineStage3.tsx),
    // but a raw TB row can still carry the uncleaned Tally artifact. Every consumer that
    // matches raw ledger_name -> coa_mapping must resolve this the same way the COA Mapping
    // screen does, or it reports a false "unmapped ledger".
    const mapping = { "The District TB Centre": { code: "NCE_TR" } };
    const lookup = buildLedgerMapMatcher(mapping);
    expect(lookup("The District TB Centre&#13;&#10;")?.code).toBe("NCE_TR");
  });

  it("resolves via exact match first (fast path, unaffected)", () => {
    const mapping = { "Trade Receivables": { code: "NCE_TR" } };
    const lookup = buildLedgerMapMatcher(mapping);
    expect(lookup("Trade Receivables")?.code).toBe("NCE_TR");
  });

  it("resolves via trim fallback", () => {
    const mapping = { "Trade Receivables": { code: "NCE_TR" } };
    const lookup = buildLedgerMapMatcher(mapping);
    expect(lookup("  Trade Receivables  ")?.code).toBe("NCE_TR");
  });

  it("resolves via case-insensitive fallback", () => {
    const mapping = { "Gst Payable": { code: "NCE_OCL" } };
    const lookup = buildLedgerMapMatcher(mapping);
    expect(lookup("GST PAYABLE")?.code).toBe("NCE_OCL");
  });

  it("returns undefined for a genuinely unmapped ledger", () => {
    const mapping = { "Trade Receivables": { code: "NCE_TR" } };
    const lookup = buildLedgerMapMatcher(mapping);
    expect(lookup("Some Random Ledger")).toBeUndefined();
  });

  it("returns undefined for empty/null input without throwing", () => {
    const lookup = buildLedgerMapMatcher({});
    expect(lookup("")).toBeUndefined();
    expect(lookup(null)).toBeUndefined();
    expect(lookup(undefined)).toBeUndefined();
  });
});
