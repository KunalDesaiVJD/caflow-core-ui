import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolvePolicy, validatePolicy, effectiveDueDate, type Layer } from "./billingReminderRules";

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8").replace(/\r\n/g, "\n");

// The billing-reminders edge function imports the _shared copy.
describe("billingReminderRules stays in sync with the edge-function copy", () => {
  it("matches supabase/functions/_shared/billingReminderRules.ts", () => {
    expect(read("../../supabase/functions/_shared/billingReminderRules.ts")).toBe(read("./billingReminderRules.ts"));
  });
});

const L = (level: Layer["level"], id: string, policy: Record<string, any>): Layer =>
  ({ level, id, label: `${level}:${id}`, policy });

describe("resolvePolicy", () => {
  it("most specific level wins and CC adds up", () => {
    const { effective, source, issues } = resolvePolicy(
      L("client", "c", { invoice_repeat_days: 3, cc_emails: ["c@x.com"] }),
      [],
      L("firm", "f", { invoice_enabled: true, invoice_repeat_days: 10, cc_emails: ["f@x.com"] }),
      [],
    );
    expect(effective.invoice_enabled).toBe(true);
    expect(effective.invoice_repeat_days).toBe(3);
    expect(source.invoice_repeat_days).toBe("client:c");
    expect(effective.cc_emails.sort()).toEqual(["c@x.com", "f@x.com"]);
    expect(issues).toEqual([]);
  });

  it("flags two client groups that disagree, and off wins meanwhile", () => {
    const { effective, issues } = resolvePolicy(null,
      [L("client_group", "a", { invoice_enabled: true }), L("client_group", "b", { invoice_enabled: false })], null, []);
    expect(effective.invoice_enabled).toBe(false);
    expect(issues).toHaveLength(1);
    expect(issues[0].kind).toBe("invoice");
    expect(issues[0].layers.map(l => l.id).sort()).toEqual(["a", "b"]);
  });

  it("groups that agree are not a conflict; a client value resolves a disagreement", () => {
    expect(resolvePolicy(null,
      [L("client_group", "a", { ledger_day: 5 }), L("client_group", "b", { ledger_day: 5 })], null, []).issues).toEqual([]);
    expect(resolvePolicy(L("client", "c", { ledger_day: 9 }),
      [L("client_group", "a", { ledger_day: 5 }), L("client_group", "b", { ledger_day: 7 })], null, []).issues).toEqual([]);
  });

  it("flags interval fields that a schedule at the same or a more specific level makes useless", () => {
    const { issues } = resolvePolicy(
      L("client", "c", { invoice_repeat_days: 3 }), [],
      L("firm", "f", { invoice_enabled: true, invoice_timing: "schedule", invoice_schedule_days: [0, 7] }), []);
    expect(issues.map(i => i.layers[0].id)).toEqual(["c"]);
  });

  it("a less specific level's interval fields are simply overridden by a client schedule", () => {
    const { issues } = resolvePolicy(
      L("client", "c", { invoice_timing: "schedule", invoice_schedule_days: [0, 7] }), [],
      L("firm", "f", { invoice_enabled: true, invoice_repeat_days: 5 }), []);
    expect(issues).toEqual([]);
  });

  it("flags escalation that can never happen or has no address", () => {
    const { issues } = resolvePolicy(null, [],
      L("firm", "f", { invoice_enabled: true, invoice_max_count: 2, escalate_after: 3 }), []);
    expect(issues).toHaveLength(2);
  });
});

describe("validatePolicy", () => {
  it("accepts a clean rule", () => {
    expect(validatePolicy({ invoice_timing: "schedule", invoice_schedule_days: [-3, 7, 15], send_weekdays: [1, 2, 3, 4, 5] }, "client")).toEqual([]);
  });
  it("rejects bad schedules, empty weekdays and firm-wide Send to", () => {
    expect(validatePolicy({ invoice_schedule_days: [7, 3] }, "client").length).toBe(1);
    expect(validatePolicy({ send_weekdays: [] }, "client").length).toBe(1);
    expect(validatePolicy({ to_emails: ["a@b.com"] }, "firm").length).toBe(1);
    expect(validatePolicy({ invoice_timing: "schedule", invoice_repeat_days: 3 }, "client").length).toBe(1);
    expect(validatePolicy({ cc_emails: ["not-an-email@"] }, "client").length).toBe(1);
  });
});

describe("effectiveDueDate", () => {
  it("uses the stored due date, else invoice date + terms (45 by default)", () => {
    expect(effectiveDueDate({ due_date: "2026-05-01", invoice_date: "2026-04-01" })).toBe("2026-05-01");
    expect(effectiveDueDate({ invoice_date: "2026-04-01", payment_due_days: 30 })).toBe("2026-05-01");
    expect(effectiveDueDate({ invoice_date: "2026-04-01" })).toBe("2026-05-16");
    expect(effectiveDueDate({})).toBeNull();
  });
});
