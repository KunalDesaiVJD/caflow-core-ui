import { describe, it, expect } from "vitest";
import {
  SCRUTINY_INVESTIGATOR,
  buildInvestigatorContext,
  buildInvestigatorRequest,
  parseInvestigatorResponse,
  investigateWithAI,
  type InvestigatorInputs,
} from "./aiInvestigator";
import type { EdgeInvoker } from "./aiQueryDraft";
import type { Finding } from "./scrutinyUi";

const f = (id: string, rule: string, sev: string, ledger: string): Finding => ({
  id, rule_id: rule, client_id: "c1", severity: sev, clause_3cd: null,
  flag_message: "x", status: "open", narration: ledger, financial_year: "2024-25",
});

const inputs: InvestigatorInputs = {
  findings: [
    f("1", "CASH-002", "HIGH", "Cash-in-Hand"),
    f("2", "CASH-007", "HIGH", "Cash-in-Hand"),
    f("3", "TDS-194C", "MEDIUM", "Freight"),
  ],
  coverage: { auto: 50, advisory: 69, total: 119 },
  facts: { captured: 14, total: 30, requiredCaptured: 7, requiredTotal: 11, missing: ["Bank balances confirmed (BRS)"] },
  recurringCount: 2,
  financialYear: "2024-25",
};

describe("buildInvestigatorContext", () => {
  it("rolls up totals, categories and ledgers (read-only snapshot)", () => {
    const ctx = buildInvestigatorContext(inputs);
    expect(ctx.totals).toEqual({ findings: 3, high: 2, medium: 1, low: 0 });
    expect(ctx.by_category[0]).toEqual({ category: "CASH", count: 2 }); // busiest category first
    const cash = ctx.by_ledger.find((l) => l.ledger === "Cash-in-Hand");
    expect(cash).toEqual({ ledger: "Cash-in-Hand", count: 2, high: 2 });
    expect(ctx.coverage).toEqual({ auto: 50, advisory: 69, total: 119 });
    expect(ctx.facts.required_captured).toBe(7);
    expect(ctx.recurring_from_prior_year).toBe(2);
  });
});

describe("buildInvestigatorRequest", () => {
  it("wraps the question + context as JSON", () => {
    const payload = JSON.parse(buildInvestigatorRequest("Which ledgers need queries?", inputs));
    expect(payload.question).toBe("Which ledgers need queries?");
    expect(payload.context.totals.findings).toBe(3);
  });
});

describe("parseInvestigatorResponse", () => {
  it("accepts {answer}, a raw fallback, or a bare string", () => {
    expect(parseInvestigatorResponse({ answer: "Focus on Cash-in-Hand." })).toBe("Focus on Cash-in-Hand.");
    expect(parseInvestigatorResponse({ raw: "plain text" })).toBe("plain text");
    expect(parseInvestigatorResponse("bare")).toBe("bare");
    expect(parseInvestigatorResponse({})).toBeNull();
    expect(parseInvestigatorResponse(null)).toBeNull();
  });
});

describe("investigateWithAI (graceful)", () => {
  it("returns the answer and uses the investigator request type", async () => {
    let rt = "";
    const invoke: EdgeInvoker = async (_fn, opts) => { rt = (opts.body as any).request_type; return { data: { answer: "2 high-risk cash findings." }, error: null }; };
    expect(await investigateWithAI(invoke, "summarise risk", inputs)).toBe("2 high-risk cash findings.");
    expect(rt).toBe(SCRUTINY_INVESTIGATOR);
  });

  it("returns null on empty question without calling the gateway", async () => {
    let called = false;
    const invoke: EdgeInvoker = async () => { called = true; return { data: {}, error: null }; };
    expect(await investigateWithAI(invoke, "   ", inputs)).toBeNull();
    expect(called).toBe(false);
  });

  it("returns null on error / throw", async () => {
    expect(await investigateWithAI(async () => ({ data: null, error: { message: "x" } }), "q", inputs)).toBeNull();
    expect(await investigateWithAI(async () => { throw new Error("down"); }, "q", inputs)).toBeNull();
  });
});
