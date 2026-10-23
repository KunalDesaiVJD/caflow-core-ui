/**
 * Billing reminder rules — resolution, conflict detection and validation.
 *
 * Shared by the Email Settings → Reminders screen (blocks saving a rule that
 * conflicts) and the billing-reminders edge function (skips a client whose
 * rules conflict instead of guessing). The edge function imports a
 * byte-identical copy from supabase/functions/_shared/billingReminderRules.ts;
 * billingReminderRules.test.ts fails if the two drift.
 *
 * Pure TypeScript: no imports, no Deno or browser APIs.
 *
 * A rule (billing_reminder_policies row) can be set at four levels. For each
 * client the most specific level that sets a field wins:
 *
 *     client → client group(s) → firm → firm group(s) → system default
 *
 * NULL means "inherit". cc_emails add up across levels. When a client sits in
 * several client groups that set the same field to different values, and the
 * client has no value of its own for that field, the rules CONFLICT: the UI
 * refuses to save such a rule and the engine sends nothing of that kind to
 * the client until it is resolved.
 */

export type ScopeType = "firm_group" | "firm" | "client_group" | "client";
export type RuleKind = "invoice" | "ledger" | "both";

export const POLICY_FIELDS = [
  "invoice_enabled", "invoice_timing", "invoice_start_days", "invoice_repeat_days", "invoice_max_count",
  "invoice_schedule_days", "invoice_min_amount",
  "escalate_after", "escalate_cc",
  "ledger_enabled", "ledger_frequency", "ledger_day", "ledger_min_balance",
  "to_emails", "send_to_responsible", "send_weekdays", "paused_until",
] as const;
export type PolicyField = typeof POLICY_FIELDS[number];

// Safe by default: nothing is sent until some level switches it on.
export const SYSTEM_DEFAULTS: Record<PolicyField, unknown> = {
  invoice_enabled: false,
  invoice_timing: "interval",
  invoice_start_days: 3,
  invoice_repeat_days: 7,
  invoice_max_count: 4,
  invoice_schedule_days: null,
  invoice_min_amount: 1,
  escalate_after: null,
  escalate_cc: null,
  ledger_enabled: false,
  ledger_frequency: "monthly",
  ledger_day: 5,
  ledger_min_balance: 1,
  to_emails: null,
  send_to_responsible: false,
  send_weekdays: null,       // null = every day
  paused_until: null,
};

export const FIELD_LABELS: Record<PolicyField, string> = {
  invoice_enabled: "Invoice reminders on/off",
  invoice_timing: "Reminder timing",
  invoice_start_days: "First reminder",
  invoice_repeat_days: "Repeat every",
  invoice_max_count: "Max reminders",
  invoice_schedule_days: "Fixed schedule",
  invoice_min_amount: "Minimum invoice amount",
  escalate_after: "Escalate from reminder no.",
  escalate_cc: "Escalation CC",
  ledger_enabled: "Statement of Account on/off",
  ledger_frequency: "Statement frequency",
  ledger_day: "Statement day",
  ledger_min_balance: "Statement minimum balance",
  to_emails: "Send to",
  send_to_responsible: "CC responsible person",
  send_weekdays: "Sending days",
  paused_until: "Paused until",
};

const FIELD_KIND: Record<PolicyField, RuleKind> = {
  invoice_enabled: "invoice", invoice_timing: "invoice", invoice_start_days: "invoice",
  invoice_repeat_days: "invoice", invoice_max_count: "invoice", invoice_schedule_days: "invoice",
  invoice_min_amount: "invoice", escalate_after: "invoice", escalate_cc: "invoice",
  ledger_enabled: "ledger", ledger_frequency: "ledger", ledger_day: "ledger", ledger_min_balance: "ledger",
  to_emails: "both", send_to_responsible: "both", send_weekdays: "both", paused_until: "both",
};

const INTERVAL_FIELDS: PolicyField[] = ["invoice_start_days", "invoice_repeat_days", "invoice_max_count"];
const SCHEDULE_FIELDS: PolicyField[] = ["invoice_schedule_days"];

export const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** One level's rule as it applies to one client. */
export interface Layer {
  level: ScopeType;
  id: string;
  label: string;
  policy: Record<string, any>;
}

export interface RuleIssue {
  kind: RuleKind;
  message: string;
  /** The levels involved; the UI blocks a save when the edited level is one of them. */
  layers: { level: ScopeType; id: string; label: string }[];
}

const SPECIFICITY: Record<ScopeType | "default", number> = {
  client: 0, client_group: 1, firm: 2, firm_group: 3, default: 4,
};

export function hasValue(v: unknown): boolean {
  return v !== null && v !== undefined && !(Array.isArray(v) && v.length === 0);
}

function sameValue(a: unknown, b: unknown): boolean {
  const norm = (v: unknown) => Array.isArray(v)
    ? JSON.stringify([...v].map(x => typeof x === "string" ? x.trim().toLowerCase() : x).sort())
    : JSON.stringify(v);
  return norm(a) === norm(b);
}

export function formatValue(field: PolicyField, v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "boolean") return v ? "On" : "Off";
  if (field === "invoice_start_days") {
    const d = Number(v);
    return d === 0 ? "on due date" : d > 0 ? `${d}d after due` : `${-d}d before due`;
  }
  if (field === "invoice_schedule_days" && Array.isArray(v)) return v.map(d => (d > 0 ? `+${d}` : `${d}`)).join(", ") + " days";
  if (field === "send_weekdays" && Array.isArray(v)) return v.length ? v.map(d => WEEKDAYS[d] ?? d).join(", ") : "none";
  if (Array.isArray(v)) return v.join(", ");
  return String(v);
}

const ref = (l: Layer) => ({ level: l.level, id: l.id, label: l.label });

/**
 * Resolve one client's effective settings from its layers (most specific first
 * inside each list) and report anything that conflicts.
 */
export function resolvePolicy(client: Layer | null, groups: Layer[], firm: Layer | null, firmGroups: Layer[]) {
  const effective: Record<string, any> = {};
  const source: Record<string, string> = {};
  const sourceLevel: Record<string, ScopeType | "default"> = {};
  const issues: RuleIssue[] = [];

  const pickMany = (f: PolicyField, layers: Layer[], label: string): Layer | null => {
    const withValue = layers.filter(l => hasValue(l.policy[f]));
    if (withValue.length === 0) return null;
    const distinct = withValue.filter((l, i) => withValue.findIndex(o => sameValue(o.policy[f], l.policy[f])) === i);
    if (distinct.length > 1) {
      issues.push({
        kind: FIELD_KIND[f],
        message: `${FIELD_LABELS[f]} differs between ${label}: ` +
          distinct.map(l => `${l.label} = ${formatValue(f, l.policy[f])}`).join("; ") +
          ". Set it on the client itself, or make the rules agree.",
        layers: distinct.map(ref),
      });
      // Until resolved, an explicit "off" is the safe reading.
      if (f === "invoice_enabled" || f === "ledger_enabled") return withValue.find(l => l.policy[f] === false) || withValue[0];
    }
    return withValue[0];
  };

  const winner: Partial<Record<PolicyField, Layer | null>> = {};
  for (const f of POLICY_FIELDS) {
    const hit =
      (client && hasValue(client.policy[f]) ? client : null) ||
      pickMany(f, groups, "client groups") ||
      (firm && hasValue(firm.policy[f]) ? firm : null) ||
      pickMany(f, firmGroups, "firm groups");
    winner[f] = hit;
    effective[f] = hit ? hit.policy[f] : SYSTEM_DEFAULTS[f];
    source[f] = hit ? hit.label : "Default";
    sourceLevel[f] = hit ? hit.level : "default";
  }

  // CC adds up across every level.
  const cc = new Set<string>();
  const ccSources: string[] = [];
  for (const l of [...firmGroups, ...(firm ? [firm] : []), ...groups, ...(client ? [client] : [])]) {
    const list = (l.policy.cc_emails || []) as string[];
    if (list.length) ccSources.push(l.label);
    list.forEach(e => e && cc.add(e.trim().toLowerCase()));
  }
  effective.cc_emails = [...cc];
  source.cc_emails = ccSources.join(" + ") || "—";

  const all = [...(client ? [client] : []), ...groups, ...(firm ? [firm] : []), ...firmGroups];

  // Timing: a level that sets interval fields while the schedule is in force
  // (or the reverse) at the same or a more specific level has no effect —
  // that is a conflict, not an override.
  const mode = effective.invoice_timing === "schedule" ? "schedule" : "interval";
  const unused = mode === "schedule" ? INTERVAL_FIELDS : SCHEDULE_FIELDS;
  const timingSpec = SPECIFICITY[sourceLevel.invoice_timing];
  for (const l of all) {
    if (SPECIFICITY[l.level] > timingSpec) continue;
    const set = unused.filter(f => hasValue(l.policy[f]));
    if (set.length) {
      issues.push({
        kind: "invoice",
        message: `${l.label} sets ${set.map(f => FIELD_LABELS[f]).join(", ")}, but reminder timing is ` +
          `"${mode === "schedule" ? "fixed schedule" : "repeat interval"}" (${source.invoice_timing}), so ` +
          `${set.length > 1 ? "they are" : "it is"} ignored. Clear ${set.length > 1 ? "them" : "it"} or change the timing.`,
        layers: [ref(l)],
      });
    }
  }
  if (effective.invoice_enabled && mode === "schedule" && !hasValue(effective.invoice_schedule_days)) {
    issues.push({
      kind: "invoice",
      message: `Reminder timing is "fixed schedule" (${source.invoice_timing}) but no schedule days are set at any level.`,
      layers: winner.invoice_timing ? [ref(winner.invoice_timing)] : [],
    });
  }

  // Escalation must be reachable and must have somewhere to go.
  if (hasValue(effective.escalate_after)) {
    const max = mode === "schedule"
      ? (effective.invoice_schedule_days || []).length
      : Number(effective.invoice_max_count);
    const layers = [winner.escalate_after, mode === "schedule" ? winner.invoice_schedule_days : winner.invoice_max_count]
      .filter(Boolean).map(l => ref(l as Layer));
    if (max > 0 && Number(effective.escalate_after) > max) {
      issues.push({
        kind: "invoice",
        message: `Escalation starts at reminder ${effective.escalate_after} (${source.escalate_after}) but at most ` +
          `${max} reminder${max === 1 ? " is" : "s are"} sent (${mode === "schedule" ? source.invoice_schedule_days : source.invoice_max_count}), so it never happens.`,
        layers,
      });
    }
    if (!hasValue(effective.escalate_cc)) {
      issues.push({
        kind: "invoice",
        message: `Escalation from reminder ${effective.escalate_after} is set (${source.escalate_after}) but no escalation CC address is set at any level.`,
        layers: winner.escalate_after ? [ref(winner.escalate_after)] : [],
      });
    }
  }

  return { effective, source, issues };
}

/** Problems inside one rule on its own (before looking at other levels). */
export function validatePolicy(p: Record<string, any>, scope: ScopeType): string[] {
  const out: string[] = [];
  const isInt = (v: unknown) => Number.isInteger(Number(v));
  const between = (f: PolicyField, lo: number, hi: number, what: string) => {
    const v = p[f];
    if (!hasValue(v)) return;
    if (!isInt(v) || Number(v) < lo || Number(v) > hi) out.push(`${what} must be a whole number from ${lo} to ${hi}.`);
  };
  between("invoice_start_days", -90, 365, "First reminder days");
  between("invoice_repeat_days", 1, 365, "Repeat every (days)");
  between("invoice_max_count", 1, 20, "Max reminders");
  between("escalate_after", 1, 20, "Escalate from reminder no.");
  between("ledger_day", 1, 28, "Statement day");
  if (hasValue(p.invoice_min_amount) && Number(p.invoice_min_amount) < 0) out.push("Minimum invoice amount cannot be negative.");
  if (hasValue(p.ledger_min_balance) && Number(p.ledger_min_balance) < 0) out.push("Statement minimum balance cannot be negative.");

  const sched = p.invoice_schedule_days as number[] | null;
  if (Array.isArray(sched) && sched.length) {
    if (sched.some(d => !isInt(d) || d < -90 || d > 365)) out.push("Schedule days must be whole numbers from -90 to 365.");
    else if (sched.some((d, i) => i > 0 && d <= sched[i - 1])) out.push("Schedule days must go up, with no repeats (e.g. -3, 7, 15, 30).");
    if (sched.length > 20) out.push("A schedule can have at most 20 reminders.");
  }
  if (p.invoice_timing === "schedule" && INTERVAL_FIELDS.some(f => hasValue(p[f]))) {
    out.push("Timing is \"fixed schedule\", so clear First reminder / Repeat every / Max reminders on this rule.");
  }
  if (p.invoice_timing === "interval" && Array.isArray(sched) && sched.length) {
    out.push("Timing is \"repeat interval\", so clear the fixed schedule on this rule.");
  }
  if (Array.isArray(p.send_weekdays)) {
    if (p.send_weekdays.length === 0) out.push("Pick at least one sending day, or set Sending days to Inherit.");
    if (p.send_weekdays.some((d: number) => !isInt(d) || d < 0 || d > 6)) out.push("Sending days are not valid.");
  }
  if ((scope === "firm" || scope === "firm_group") && hasValue(p.to_emails)) {
    out.push("\"Send to\" on a firm or firm group would send every client's reminders to the same address. Set it on a client or client group instead.");
  }
  for (const f of ["to_emails", "cc_emails", "escalate_cc"] as const) {
    const bad = ((p[f] || []) as string[]).filter(e => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
    if (bad.length) out.push(`Not a valid email address: ${bad.join(", ")}.`);
  }
  return out;
}

/** "Off", "3d after due, every 7d, max 4", "Schedule: -3, +7, +15 days" … */
export function describeInvoice(s: Record<string, any>): string {
  if (!s.invoice_enabled) return "Off";
  if (s.invoice_timing === "schedule") {
    return hasValue(s.invoice_schedule_days) ? `Schedule: ${formatValue("invoice_schedule_days", s.invoice_schedule_days)}` : "Schedule: none set";
  }
  return `${formatValue("invoice_start_days", s.invoice_start_days ?? 0)}, every ${s.invoice_repeat_days}d, max ${s.invoice_max_count}`;
}

export function describeLedger(s: Record<string, any>): string {
  if (!s.ledger_enabled) return "Off";
  return `${s.ledger_frequency === "quarterly" ? "Quarterly" : "Monthly"}, day ${s.ledger_day}`;
}

/** The due date the engine uses: the stored one, else invoice date + payment terms (45 days if unset). */
export function effectiveDueDate(inv: { due_date?: string | null; invoice_date?: string | null; payment_due_days?: number | null }): string | null {
  if (inv.due_date) return inv.due_date.slice(0, 10);
  if (!inv.invoice_date) return null;
  const days = Number(inv.payment_due_days) > 0 ? Number(inv.payment_due_days) : 45;
  const d = new Date(inv.invoice_date.slice(0, 10) + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
