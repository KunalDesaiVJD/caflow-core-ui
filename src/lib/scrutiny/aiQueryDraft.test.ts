import { describe, it, expect } from "vitest";
import {
  SCRUTINY_QUERY_DRAFTER,
  buildQueryDraftRequest,
  parseQueryDraftResponse,
  draftQueryWithAI,
  type EdgeInvoker,
} from "./aiQueryDraft";
import type { Finding, RuleTemplate } from "./scrutinyUi";

const finding: Finding = {
  id: "f1",
  rule_id: "CASH-002",
  client_id: "c1",
  severity: "HIGH",
  clause_3cd: null,
  flag_message: "Cash payment of ₹45,000 to Ramesh Transport",
  status: "open",
  narration: "Cash-in-Hand",
  financial_year: "2024-25",
};

const rule = {
  rule_id: "CASH-002",
  rule_name: "Single cash payment > ₹10,000",
  legal_reference: "Section 40A(3)",
} as RuleTemplate;

describe("buildQueryDraftRequest", () => {
  it("packs the finding + rule context into parseable JSON", () => {
    const payload = JSON.parse(buildQueryDraftRequest(finding, rule));
    expect(payload.rule_id).toBe("CASH-002");
    expect(payload.severity).toBe("HIGH");
    expect(payload.legal_reference).toBe("Section 40A(3)");
    expect(payload.ledger).toBe("Cash-in-Hand");
    expect(payload.finding).toContain("Ramesh Transport");
  });

  it("tolerates a missing rule", () => {
    const payload = JSON.parse(buildQueryDraftRequest(finding, null));
    expect(payload.rule_name).toBeNull();
    expect(payload.legal_reference).toBeNull();
  });
});

describe("parseQueryDraftResponse", () => {
  it("returns the query text when present and non-blank", () => {
    expect(parseQueryDraftResponse({ query_text: "Please explain the cash payment." })).toBe("Please explain the cash payment.");
    expect(parseQueryDraftResponse({ query_text: "  trimmed  " })).toBe("trimmed");
  });

  it("returns null for missing / blank / wrong-shape responses", () => {
    expect(parseQueryDraftResponse({ query_text: "   " })).toBeNull();
    expect(parseQueryDraftResponse({})).toBeNull();
    expect(parseQueryDraftResponse({ raw: "not json" })).toBeNull(); // gateway parse-failure shape
    expect(parseQueryDraftResponse(null)).toBeNull();
    expect(parseQueryDraftResponse("string")).toBeNull();
  });
});

describe("draftQueryWithAI (graceful fallback)", () => {
  it("returns the drafted text on success and calls the gateway correctly", async () => {
    let seen: { fn: string; body: any } | null = null;
    const invoke: EdgeInvoker = async (fn, opts) => {
      seen = { fn, body: opts.body };
      return { data: { query_text: "Kindly explain the cash payment and share the vouchers." }, error: null };
    };
    const out = await draftQueryWithAI(invoke, finding, rule);
    expect(out).toBe("Kindly explain the cash payment and share the vouchers.");
    expect(seen!.fn).toBe("claude-gateway");
    expect(seen!.body.request_type).toBe(SCRUTINY_QUERY_DRAFTER);
  });

  it("returns null when the gateway reports an error", async () => {
    const invoke: EdgeInvoker = async () => ({ data: null, error: { message: "no key" } });
    expect(await draftQueryWithAI(invoke, finding, rule)).toBeNull();
  });

  it("returns null when the invoker throws (gateway not deployed)", async () => {
    const invoke: EdgeInvoker = async () => { throw new Error("Function not found"); };
    expect(await draftQueryWithAI(invoke, finding, rule)).toBeNull();
  });

  it("returns null when the response has no usable text", async () => {
    const invoke: EdgeInvoker = async () => ({ data: { raw: "oops" }, error: null });
    expect(await draftQueryWithAI(invoke, finding, rule)).toBeNull();
  });
});
