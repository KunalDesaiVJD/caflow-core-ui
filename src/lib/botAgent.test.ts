import { describe, it, expect } from "vitest";
import {
  ageingBuckets, agentProtocol, chunkMessage, drCr, dueDateOf, parseAgentAction, parseCommand,
} from "../../supabase/functions/_shared/botAgent";

const tools = ["get_client_balance", "get_receipts"];

describe("parseAgentAction — text-only model driving the tools", () => {
  it("reads a tool call, also inside a ```json fence with prose around it", () => {
    expect(parseAgentAction('{"action":"tool","name":"get_client_balance","input":{"client_name":"Nirali"}}', tools))
      .toEqual({ type: "tool", name: "get_client_balance", input: { client_name: "Nirali" } });
    expect(parseAgentAction('Sure.\n```json\n{"action":"tool","name":"get_receipts","input":{}}\n```', tools))
      .toEqual({ type: "tool", name: "get_receipts", input: {} });
  });
  it("reads the final reply, braces inside strings included", () => {
    expect(parseAgentAction('{"action":"reply","text":"Balance is {₹1,000}"}', tools)).toEqual({ type: "reply", text: "Balance is {₹1,000}" });
  });
  it("treats an unknown tool or plain prose as the reply, never as a call", () => {
    expect(parseAgentAction('{"action":"tool","name":"drop_tables","input":{}}', tools).type).toBe("reply");
    expect(parseAgentAction("Hello there", tools)).toEqual({ type: "reply", text: "Hello there" });
  });
  it("lists every tool and its required inputs in the protocol", () => {
    const p = agentProtocol([{ name: "get_client_balance", description: "d", input_schema: { type: "object", properties: { client_name: { type: "string", description: "x" } }, required: ["client_name"] } }]);
    expect(p).toContain("get_client_balance");
    expect(p).toContain("client_name (required)");
  });
});

describe("billing helpers", () => {
  it("derives the due date from payment terms when none is stored", () => {
    expect(dueDateOf({ due_date: null, invoice_date: "2026-05-01", payment_due_days: 45 })).toBe("2026-06-15");
    expect(dueDateOf({ due_date: "2026-07-01", invoice_date: "2026-05-01", payment_due_days: 45 })).toBe("2026-07-01");
  });
  it("buckets open invoices by days past due", () => {
    const b = ageingBuckets([
      { due: "2026-10-30", amount_due: 100 }, { due: "2026-10-10", amount_due: 200 },
      { due: "2026-08-15", amount_due: 300 }, { due: "2026-05-01", amount_due: 400 }, { due: null, amount_due: 5 },
    ], "2026-10-29");
    expect(b).toEqual({ not_due: 100, d0_30: 200, d31_60: 0, d61_90: 300, d90_plus: 400, no_due_date: 5 });
  });
  it("formats Dr / Cr / Nil", () => {
    expect(drCr(1500)).toBe("₹1,500.00 Dr");
    expect(drCr(-200)).toBe("₹200.00 Cr");
    expect(drCr(0)).toBe("Nil");
  });
  it("splits long messages on line breaks under Telegram's limit", () => {
    const parts = chunkMessage(Array.from({ length: 300 }, (_, i) => `line ${i} ${"x".repeat(30)}`).join("\n"), 1000);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every(p => p.length <= 1000)).toBe(true);
  });
  it("parses slash commands, with or without the bot name", () => {
    expect(parseCommand("/balance Nirali Perfumery")).toEqual({ cmd: "balance", arg: "Nirali Perfumery" });
    expect(parseCommand("/summary@CAFlowBot")).toEqual({ cmd: "summary", arg: "" });
    expect(parseCommand("how much is due?")).toBeNull();
  });
});
