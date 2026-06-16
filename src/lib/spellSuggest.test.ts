import { describe, it, expect } from "vitest";
import { findSpellIssues, applyAllSuggestions } from "./spellSuggest";

describe("spellSuggest", () => {
  it("flags a known misspelling and suggests the canonical spelling", () => {
    const issues = findSpellIssues("Alluminum Section Purchase - 18%");
    expect(issues).toHaveLength(1);
    expect(issues[0].word).toBe("Alluminum");
    expect(issues[0].suggestion).toBe("Aluminium"); // case-matched (Title)
  });

  it("returns nothing for correctly-spelled labels", () => {
    expect(findSpellIssues("Cement Purchase - 28%")).toHaveLength(0);
    expect(findSpellIssues("Trade Payables")).toHaveLength(0);
  });

  it("never flags proper nouns / unknown ledger names (no false positives)", () => {
    // The whole point: arbitrary ledger names must NOT be flagged.
    expect(findSpellIssues("Dilipbhai Mandanka HUF")).toHaveLength(0);
    expect(findSpellIssues("DBS Realty ICICI Bank")).toHaveLength(0);
  });

  it("de-duplicates repeated misspellings", () => {
    const issues = findSpellIssues("expences and more expences");
    expect(issues).toHaveLength(1);
    expect(issues[0].suggestion).toBe("expenses");
  });

  it("applies all corrections while preserving each word's case", () => {
    expect(applyAllSuggestions("EXPENCES recievable Statment"))
      .toBe("EXPENSES receivable Statement");
  });

  it("leaves correct words untouched when applying", () => {
    expect(applyAllSuggestions("Trade Receivables")).toBe("Trade Receivables");
  });

  it("handles empty / nullish input", () => {
    expect(findSpellIssues("")).toHaveLength(0);
    expect(findSpellIssues(undefined)).toHaveLength(0);
    expect(findSpellIssues(null)).toHaveLength(0);
  });
});
