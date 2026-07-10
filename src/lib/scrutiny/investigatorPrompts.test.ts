import { describe, it, expect } from "vitest";
import { suggestedPrompts, type PromptContext } from "./investigatorPrompts";

const labels = (ctx: PromptContext) => suggestedPrompts(ctx).map((p) => p.label);

describe("suggestedPrompts (context-aware)", () => {
  it("shows every relevant prompt when the context is rich", () => {
    const l = labels({ findingCount: 12, hasTds: true, missingFactsCount: 3, recurringCount: 2 });
    expect(l).toEqual(["Top risks", "Ledgers to query", "TDS exposure", "Missing facts", "Recurring items", "Partner summary"]);
  });

  it("always includes the Partner summary, even with no data", () => {
    const l = labels({ findingCount: 0, hasTds: false, missingFactsCount: 0, recurringCount: 0 });
    expect(l).toEqual(["Partner summary"]);
  });

  it("only shows the TDS prompt when there are TDS findings", () => {
    expect(labels({ findingCount: 5, hasTds: false, missingFactsCount: 0, recurringCount: 0 })).not.toContain("TDS exposure");
    expect(labels({ findingCount: 5, hasTds: true, missingFactsCount: 0, recurringCount: 0 })).toContain("TDS exposure");
  });

  it("only shows Missing facts / Recurring items when relevant", () => {
    expect(labels({ findingCount: 5, hasTds: false, missingFactsCount: 0, recurringCount: 0 })).not.toContain("Missing facts");
    expect(labels({ findingCount: 5, hasTds: false, missingFactsCount: 1, recurringCount: 0 })).toContain("Missing facts");
    expect(labels({ findingCount: 5, hasTds: false, missingFactsCount: 0, recurringCount: 0 })).not.toContain("Recurring items");
    expect(labels({ findingCount: 5, hasTds: false, missingFactsCount: 0, recurringCount: 4 })).toContain("Recurring items");
  });

  it("gives finding-dependent prompts only when there are findings", () => {
    const none = labels({ findingCount: 0, hasTds: false, missingFactsCount: 0, recurringCount: 0 });
    expect(none).not.toContain("Top risks");
    expect(none).not.toContain("Ledgers to query");
  });

  it("returns question text for each prompt", () => {
    for (const p of suggestedPrompts({ findingCount: 1, hasTds: true, missingFactsCount: 1, recurringCount: 1 })) {
      expect(p.question.length).toBeGreaterThan(0);
    }
  });
});
