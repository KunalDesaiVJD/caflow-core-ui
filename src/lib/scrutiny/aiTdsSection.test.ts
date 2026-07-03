import { describe, it, expect } from "vitest";
import {
  TDS_SECTION_IDENTIFIER,
  buildTdsSectionRequest,
  parseTdsSectionResponse,
  identifyTdsSectionWithAI,
} from "./aiTdsSection";
import type { EdgeInvoker } from "./aiQueryDraft";
import type { Finding, RuleTemplate } from "./scrutinyUi";

const finding: Finding = {
  id: "f1", rule_id: "TDS-194C", client_id: "c1", severity: "MEDIUM", clause_3cd: null,
  flag_message: "Payment to contractor without TDS", status: "open",
  narration: "Freight Charges", financial_year: "2024-25",
};
const rule = { rule_id: "TDS-194C", rule_name: "Contractor payment" } as RuleTemplate;

describe("buildTdsSectionRequest", () => {
  it("joins rule name, ledger and finding into a payment-nature string", () => {
    expect(buildTdsSectionRequest(finding, rule)).toBe("Contractor payment — Freight Charges — Payment to contractor without TDS");
  });
  it("tolerates a missing rule", () => {
    expect(buildTdsSectionRequest(finding, null)).toBe("Freight Charges — Payment to contractor without TDS");
  });
});

describe("parseTdsSectionResponse", () => {
  it("parses section + numeric rate/threshold", () => {
    const out = parseTdsSectionResponse({ section: "194C", rate: 2, threshold: 30000, flag_message: "Contractor" });
    expect(out).toEqual({ section: "194C", rate: 2, threshold: 30000, flag_message: "Contractor" });
  });
  it("coerces string numbers and tolerates missing rate/threshold", () => {
    const out = parseTdsSectionResponse({ section: "194J", rate: "10", threshold: null });
    expect(out).toEqual({ section: "194J", rate: 10, threshold: null, flag_message: "" });
  });
  it("returns null without a usable section", () => {
    expect(parseTdsSectionResponse({ section: "" })).toBeNull();
    expect(parseTdsSectionResponse({ raw: "x" })).toBeNull();
    expect(parseTdsSectionResponse(null)).toBeNull();
  });
});

describe("identifyTdsSectionWithAI (graceful)", () => {
  it("returns the section on success and uses the right request type", async () => {
    let rt = "";
    const invoke: EdgeInvoker = async (_fn, opts) => { rt = (opts.body as any).request_type; return { data: { section: "194I", rate: 10, threshold: 240000 }, error: null }; };
    const out = await identifyTdsSectionWithAI(invoke, finding, rule);
    expect(out?.section).toBe("194I");
    expect(rt).toBe(TDS_SECTION_IDENTIFIER);
  });
  it("returns null on error / throw / no-section", async () => {
    expect(await identifyTdsSectionWithAI(async () => ({ data: null, error: { message: "x" } }), finding, rule)).toBeNull();
    expect(await identifyTdsSectionWithAI(async () => { throw new Error("down"); }, finding, rule)).toBeNull();
    expect(await identifyTdsSectionWithAI(async () => ({ data: { raw: "no json" }, error: null }), finding, rule)).toBeNull();
  });
});
