import { describe, it, expect } from "vitest";
import {
  NARRATION_BATCH_CLASSIFIER,
  buildNarrationBatchRequest,
  parseNarrationBatchResponse,
  classifyFindingsWithAI,
} from "./aiNarration";
import type { EdgeInvoker } from "./aiQueryDraft";
import type { Finding } from "./scrutinyUi";

const f = (id: string, flag: string): Finding => ({
  id, rule_id: "R", client_id: "c1", severity: "MEDIUM", clause_3cd: null,
  flag_message: flag, status: "open", narration: "Ledger", financial_year: "2024-25",
});

describe("buildNarrationBatchRequest", () => {
  it("maps findings to [{entry_id, narration}]", () => {
    const arr = JSON.parse(buildNarrationBatchRequest([f("1", "Prior period expense"), f("2", "Cash payment")]));
    expect(arr).toEqual([
      { entry_id: "1", narration: "Prior period expense" },
      { entry_id: "2", narration: "Cash payment" },
    ]);
  });
});

describe("parseNarrationBatchResponse", () => {
  it("indexes classifications by entry_id", () => {
    const map = parseNarrationBatchResponse([
      { entry_id: "1", category: "prior_period", risk_level: "high", flag_reason: "PY", suggested_3cd_clause: "22" },
    ]);
    expect(map["1"].category).toBe("prior_period");
    expect(map["1"].suggested_3cd_clause).toBe("22");
  });

  it("returns {} for a non-array (gateway parse-failure) response", () => {
    expect(parseNarrationBatchResponse({ raw: "not json" })).toEqual({});
    expect(parseNarrationBatchResponse(null)).toEqual({});
  });

  it("skips malformed items", () => {
    const map = parseNarrationBatchResponse([{ category: "x" }, { entry_id: "2", category: "cash_payment" }]);
    expect(Object.keys(map)).toEqual(["2"]);
  });
});

describe("classifyFindingsWithAI (graceful)", () => {
  it("returns the map on success", async () => {
    const invoke: EdgeInvoker = async () => ({
      data: [{ entry_id: "1", category: "prior_period", risk_level: "high", flag_reason: "", suggested_3cd_clause: "22" }],
      error: null,
    });
    const map = await classifyFindingsWithAI(invoke, [f("1", "x")]);
    expect(map["1"].suggested_3cd_clause).toBe("22");
  });

  it("returns {} on empty input without calling the gateway", async () => {
    let called = false;
    const invoke: EdgeInvoker = async () => { called = true; return { data: [], error: null }; };
    expect(await classifyFindingsWithAI(invoke, [])).toEqual({});
    expect(called).toBe(false);
  });

  it("returns {} on error / throw", async () => {
    expect(await classifyFindingsWithAI(async () => ({ data: null, error: { message: "x" } }), [f("1", "x")])).toEqual({});
    expect(await classifyFindingsWithAI(async () => { throw new Error("down"); }, [f("1", "x")])).toEqual({});
  });

  it("uses the narration_batch_classifier request type", async () => {
    let rt = "";
    const invoke: EdgeInvoker = async (_fn, opts) => { rt = (opts.body as any).request_type; return { data: [], error: null }; };
    await classifyFindingsWithAI(invoke, [f("1", "x")]);
    expect(rt).toBe(NARRATION_BATCH_CLASSIFIER);
  });
});
