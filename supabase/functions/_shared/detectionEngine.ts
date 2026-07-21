/**
 * Scrutiny detection engine — Tier A interpreter (gap G1).
 *
 * Pure functions (the single import, ./triage.ts, is itself dependency-free) that execute the `detection_logic` of the seeded
 * scrutiny_rules against in-memory Trial Balance (account grain) and Voucher (voucher grain)
 * rows. NO database, NO network, NO React — so it is fully unit-testable and later drops into
 * the `run-scrutiny` edge function unchanged.
 *
 * Scope: the 20 "Tier A" check kinds (37 rules) classified as deterministic in
 * docs/ledger-scrutiny/rules/01-check-kinds.md. Tier B/C checks have no handler here; the
 * runner reports them as `unhandled` and (optionally) emits an advisory finding so they are
 * never silently passed (canonical decision #8: coverage is advisory, never blocks sign-off).
 *
 * Honest limitation: the seeded `detection_logic` is a skeleton — it carries the check kind +
 * threshold but not always the full ledger scoping (e.g. CASH rules don't encode "cash only").
 * Where that happens, handlers apply a documented category/keyword scope. These may over- or
 * under-detect; that is acceptable for an advisory tool where the auditor reviews each finding.
 */

import { triage } from "./triage.ts";

// ---------------------------------------------------------------------------
// Types — thin projections of tally_trial_balance / tally_vouchers / scrutiny_rules
// ---------------------------------------------------------------------------

export interface TBRow {
  ledger_name: string;
  parent_group?: string | null;
  /** absolute magnitude as stored by Tally */
  closing_balance: number;
  /** sign of the closing balance */
  balance_type?: "Dr" | "Cr" | string | null;
  debit_amount?: number | null;
  credit_amount?: number | null;
  opening_balance?: number | null;
  opening_type?: "Dr" | "Cr" | string | null;
}

/** One leg of a voucher's double entry (from tally_vouchers.line_items). */
export interface VoucherLeg {
  ledger_name?: string | null;
  dr_cr?: "Dr" | "Cr" | string | null;
  amount?: number | null;
}

export interface VoucherRow {
  id?: string;
  amount: number;
  dr_cr?: "Dr" | "Cr" | string | null;
  /** ISO date, "YYYY-MM-DD" */
  voucher_date: string;
  voucher_number?: string | null;
  voucher_type?: string | null;
  party_ledger?: string | null;
  narration?: string | null;
  /** primary ledger if available */
  ledger_name?: string | null;
  /** full double entry — enables cross-leg checks (GST co-tagging, stream gaps). Undefined if not loaded. */
  line_items?: VoucherLeg[] | null;
}

export interface DetectionLogic {
  check: string;
  [k: string]: unknown;
}

export interface ScrutinyRule {
  rule_id: string;
  rule_name: string;
  category: string;
  detection_level: string;
  detection_logic: DetectionLogic;
  threshold_value?: number | null;
  threshold_type?: string | null;
  audit_query_template?: string | null;
  severity: string;
  legal_reference?: string | null;
  /** entity-type buckets this rule applies to ("corporate" | "non_corporate"); empty/absent = all. */
  applicable_to?: string[] | null;
}

/** A fixed-asset register row (thin projection of fa_assets) — enables depreciation checks. */
export interface FaAssetRow {
  asset_name?: string | null;
  gross_block_closing?: number | null;
  wdv_closing?: number | null;
  accumulated_dep_closing?: number | null;
  depreciation_for_year?: number | null;
  is_fully_depreciated?: boolean | null;
  disposals_during_year?: number | null;
  disposal_date?: string | null;
}

export interface ScrutinyData {
  tb: TBRow[];
  vouchers: VoucherRow[];
  /** prior-year trial balance (account grain) — enables py_comparison / capital_change */
  tbPY?: TBRow[];
  /** fixed-asset register (fa_assets) — enables depreciation checks. Undefined if not loaded. */
  fa?: FaAssetRow[];
  /** related-party names (related_parties.party_name) — enables the RPT checks. Empty = not captured. */
  rp?: string[];
}

/** Approved engagement materiality. Absent until a human has signed it off. */
export interface MaterialityValues {
  materiality: number;
  performance: number;
  trivial: number;
}

export interface ScrutinyContext {
  /** FY start, "YYYY-MM-DD" (e.g. 2025-04-01) */
  financialYearStart?: string;
  /** FY end, "YYYY-MM-DD" (e.g. 2026-03-31) */
  financialYearEnd?: string;
  /** ISO dates treated as holidays (in addition to weekends) */
  holidays?: string[];
  /** "today" for future-date checks; defaults to financialYearEnd then real now */
  today?: string;
  /**
   * Human-APPROVED materiality for this engagement. Rules that opt in via
   * detection_logic.materiality have their thresholds rescaled to it. Undefined means nobody has
   * approved anything yet, and every rule falls back to its literal threshold — an unapproved
   * engagement behaves exactly as it does today rather than going silent.
   */
  materiality?: MaterialityValues | null;
}

export interface ScrutinyFinding {
  rule_id: string;
  rule_name: string;
  category: string;
  severity: string;
  legal_reference?: string | null;
  account?: string | null;
  amount?: number | null;
  date?: string | null;
  /** rendered audit_query_template */
  flag_message: string;
  detection_level: string;
  /** true when emitted by the unhandled-advisory path, not a real detection */
  advisory?: boolean;
  /**
   * "query" = on the capped, ranked shortlist an auditor is expected to act on.
   * "note"  = kept, searchable and promotable, but never auto-raised.
   * Assigned by runDetection when opts.triage is set; undefined means untriaged.
   */
  tier?: "query" | "note";
  /** raw values for drill-down */
  evidence?: Record<string, unknown>;
}

export interface RuleRunStatus {
  rule_id: string;
  rule_name: string;
  check: string;
  /** executed = handler ran (found >= 0); needs_data = ran but a required input was missing; skipped_no_handler = no evaluator for the check; error = handler threw */
  status: "executed" | "needs_data" | "skipped_no_handler" | "error";
  found: number;
  reason?: string;
}

export interface DetectionResult {
  findings: ScrutinyFinding[];
  coverage: {
    rulesTotal: number;
    rulesHandled: number;
    executedKinds: string[];
    unhandled: { rule_id: string; check: string }[];
  };
  /** Per-rule accounting so no active rule is ever silently dropped (completeness control). */
  ledger: RuleRunStatus[];
}

type CheckHandler = (
  rule: ScrutinyRule,
  data: ScrutinyData,
  ctx: ScrutinyContext,
) => ScrutinyFinding[];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const num = (v: unknown, fallback = 0): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const lc = (s: unknown): string => String(s ?? "").toLowerCase();

const kwMatch = (haystack: unknown, keywords: unknown): boolean => {
  const h = lc(haystack);
  const list = Array.isArray(keywords) ? keywords : [];
  return list.some((k) => h.includes(lc(k)));
};

/** "Dr" | "Cr" from a balance_type/dr_cr field; defaults to Dr. */
const sideOf = (t: unknown): "Dr" | "Cr" =>
  lc(t).startsWith("c") ? "Cr" : "Dr";

/** signed closing: Dr positive, Cr negative. */
const signedClosing = (r: TBRow): number =>
  sideOf(r.balance_type) === "Cr" ? -Math.abs(num(r.closing_balance)) : Math.abs(num(r.closing_balance));

const parseISO = (s: string | null | undefined): Date | null => {
  if (!s) return null;
  // accept YYYY-MM-DD or full ISO; anchor at UTC noon to avoid TZ rollover
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s));
  if (!m) {
    const d = new Date(String(s));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12));
};

const isWeekend = (d: Date): boolean => {
  const day = d.getUTCDay();
  return day === 0 || day === 6;
};

/** ISO-year + ISO-week key, e.g. "2025-W37". */
const isoWeekKey = (d: Date): string => {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNr = (t.getUTCDay() + 6) % 7;
  t.setUTCDate(t.getUTCDate() - dayNr + 3);
  const firstThursday = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
  const week =
    1 + Math.round(((t.getTime() - firstThursday.getTime()) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
};

const isRound = (amount: number, unit = 1000): boolean =>
  amount !== 0 && amount % unit === 0;

const fmtAmt = (n: number): string => {
  try {
    return Math.round(num(n)).toLocaleString("en-IN");
  } catch {
    return String(Math.round(num(n)));
  }
};

/** Replace {account}/{amount}/{date}/{count}/{pct}/{value}/{threshold}/{narration} tokens. */
const render = (
  template: string | null | undefined,
  vars: Record<string, string | number | null | undefined>,
): string => {
  const fallback = "Scrutiny finding";
  let out = template && template.trim() ? template : fallback;
  for (const [k, v] of Object.entries(vars)) {
    out = out.replace(new RegExp(`\\{${k}\\}`, "g"), v == null ? "" : String(v));
  }
  // strip any placeholders the handler didn't fill (e.g. absence checks have no amount/date),
  // then drop a rupee sign left dangling (not followed by a number) and tidy whitespace/punctuation.
  out = out
    .replace(/[^\w\s]?\s*\{[a-zA-Z_]+\}/g, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([.,;])/g, "$1")
    .trim();
  return out;
};

const threshold = (rule: ScrutinyRule): number =>
  num(rule.detection_logic?.threshold ?? rule.threshold_value);

const finding = (
  rule: ScrutinyRule,
  partial: Partial<ScrutinyFinding> & { flag_message: string },
): ScrutinyFinding => ({
  rule_id: rule.rule_id,
  rule_name: rule.rule_name,
  category: rule.category,
  severity: rule.severity,
  legal_reference: rule.legal_reference ?? null,
  detection_level: rule.detection_level,
  account: null,
  amount: null,
  date: null,
  ...partial,
});

/** category-scoped account selectors (best-effort over parent_group + ledger_name). */
const SCOPE: Record<string, RegExp> = {
  BKR: /asset|bank|cash|investment|fixed asset|current asset|advance|deposit|loans? and advances/i,
  DEBT: /debtor|receivable/i,
  CRED: /creditor|payable/i,
};
const inScope = (r: TBRow, re: RegExp | undefined): boolean =>
  !re || re.test(`${r.parent_group ?? ""} ${r.ledger_name}`);

const isCashVoucher = (v: VoucherRow): boolean =>
  /\bcash\b/i.test(`${v.party_ledger ?? ""} ${v.ledger_name ?? ""}`);

const ofType = (v: VoucherRow, re: RegExp): boolean => re.test(String(v.voucher_type ?? ""));

// ---------------------------------------------------------------------------
// Tier A handlers
// ---------------------------------------------------------------------------

const h_keyword_balance: CheckHandler = (rule, { tb }) => {
  const kws = rule.detection_logic.keywords;
  const requireNonzero = rule.detection_logic.nonzero === true;
  return tb
    .filter((r) => kwMatch(`${r.ledger_name} ${r.parent_group ?? ""}`, kws))
    .filter((r) => (requireNonzero ? num(r.closing_balance) !== 0 : true))
    .map((r) =>
      finding(rule, {
        account: r.ledger_name,
        amount: num(r.closing_balance),
        flag_message: render(rule.audit_query_template, { account: r.ledger_name, amount: fmtAmt(num(r.closing_balance)) }),
        evidence: { closing_balance: r.closing_balance, balance_type: r.balance_type, parent_group: r.parent_group },
      }),
    );
};

const h_keyword_narration: CheckHandler = (rule, { vouchers }) => {
  const kws = rule.detection_logic.keywords;
  return vouchers
    .filter((v) => kwMatch(v.narration, kws))
    .map((v) =>
      finding(rule, {
        account: v.party_ledger ?? v.ledger_name ?? null,
        amount: num(v.amount),
        date: v.voucher_date,
        flag_message: render(rule.audit_query_template, {
          account: v.party_ledger ?? v.ledger_name ?? "",
          amount: fmtAmt(num(v.amount)),
          date: v.voucher_date,
          narration: v.narration ?? "",
        }),
        evidence: { voucher_number: v.voucher_number, narration: v.narration },
      }),
    );
};

/**
 * sign_reversal — a balance sitting on the wrong side of its natural head.
 *
 * min_balance is opt-in and defaults to 0, so rules that do not set it behave exactly as before.
 * Without it the check had no notion of size at all: a Rs.99,000 customer advance and a Rs.44 lakh
 * one were reported identically, and at a developer — where every flat buyer legitimately carries a
 * credit balance until possession — that meant one finding per buyer.
 */
const h_sign_reversal: CheckHandler = (rule, { tb }) => {
  const dl = rule.detection_logic as unknown as Record<string, unknown>;
  const expected = sideOf(dl.expected_sign === "credit" ? "Cr" : "Dr");
  const re = SCOPE[rule.category];
  const minBal = num(dl.min_balance, 0);
  return tb
    .filter((r) => inScope(r, re))
    .filter((r) => num(r.closing_balance) !== 0 && sideOf(r.balance_type) !== expected)
    .filter((r) => Math.abs(num(r.closing_balance)) >= minBal)
    .map((r) =>
      finding(rule, {
        account: r.ledger_name,
        amount: num(r.closing_balance),
        flag_message: render(rule.audit_query_template, { account: r.ledger_name, amount: fmtAmt(num(r.closing_balance)) }),
        evidence: { balance_type: r.balance_type, expected_sign: expected },
      }),
    );
};

const h_single_txn: CheckHandler = (rule, { vouchers }) => {
  const t = threshold(rule);
  const dir = rule.detection_logic.direction; // 'debit' | 'credit' | undefined
  const wantSide = dir === "debit" ? "Dr" : dir === "credit" ? "Cr" : null;
  const cashOnly = rule.category === "CASH";
  return vouchers
    .filter((v) => (cashOnly ? isCashVoucher(v) : true))
    .filter((v) => (wantSide ? sideOf(v.dr_cr) === wantSide : true))
    .filter((v) => Math.abs(num(v.amount)) >= t)
    .map((v) =>
      finding(rule, {
        account: v.party_ledger ?? v.ledger_name ?? null,
        amount: num(v.amount),
        date: v.voucher_date,
        flag_message: render(rule.audit_query_template, {
          account: v.party_ledger ?? v.ledger_name ?? "",
          amount: fmtAmt(num(v.amount)),
          date: v.voucher_date,
        }),
        evidence: { dr_cr: v.dr_cr, voucher_number: v.voucher_number, threshold: t },
      }),
    );
};

const h_balance_exceeds: CheckHandler = (rule, { tb }) => {
  const t = threshold(rule);
  const re = SCOPE[rule.category];
  return tb
    .filter((r) => inScope(r, re))
    .filter((r) => Math.abs(num(r.closing_balance)) > t)
    .map((r) =>
      finding(rule, {
        account: r.ledger_name,
        amount: num(r.closing_balance),
        flag_message: render(rule.audit_query_template, { account: r.ledger_name, amount: fmtAmt(num(r.closing_balance)), threshold: fmtAmt(t) }),
        evidence: { threshold: t },
      }),
    );
};

const h_negative_balance: CheckHandler = (rule, { tb }) => {
  const kws = rule.detection_logic.keywords ?? ["stock", "inventory"];
  return tb
    .filter((r) => kwMatch(`${r.ledger_name} ${r.parent_group ?? ""}`, kws))
    .filter((r) => signedClosing(r) < 0)
    .map((r) =>
      finding(rule, {
        account: r.ledger_name,
        amount: signedClosing(r),
        flag_message: render(rule.audit_query_template, { account: r.ledger_name, amount: fmtAmt(Math.abs(signedClosing(r))) }),
        evidence: { balance_type: r.balance_type },
      }),
    );
};

const h_daily_max: CheckHandler = (rule, { vouchers }) => {
  const t = threshold(rule);
  const cash = vouchers.filter(isCashVoucher);
  // cumulative cash balance by date: Dr (into cash) +, Cr (out of cash) -
  const byDate = new Map<string, number>();
  for (const v of cash) {
    const delta = sideOf(v.dr_cr) === "Cr" ? -Math.abs(num(v.amount)) : Math.abs(num(v.amount));
    byDate.set(v.voucher_date, (byDate.get(v.voucher_date) ?? 0) + delta);
  }
  const dates = [...byDate.keys()].sort();
  let running = 0;
  const out: ScrutinyFinding[] = [];
  for (const d of dates) {
    running += byDate.get(d) ?? 0;
    if (running > t) {
      out.push(
        finding(rule, {
          date: d,
          amount: running,
          flag_message: render(rule.audit_query_template, { amount: fmtAmt(running), date: d }),
          evidence: { closing_cash: running, threshold: t },
        }),
      );
    }
  }
  return out;
};

const h_round_number: CheckHandler = (rule, { vouchers }) => {
  const t = threshold(rule);
  const cashOnly = rule.category === "CASH";
  return vouchers
    .filter((v) => (cashOnly ? isCashVoucher(v) : true))
    .filter((v) => Math.abs(num(v.amount)) >= t && isRound(Math.abs(num(v.amount))))
    .map((v) =>
      finding(rule, {
        account: v.party_ledger ?? v.ledger_name ?? null,
        amount: num(v.amount),
        date: v.voucher_date,
        flag_message: render(rule.audit_query_template, { amount: fmtAmt(num(v.amount)), date: v.voucher_date }),
        evidence: { voucher_number: v.voucher_number },
      }),
    );
};

const h_frequency: CheckHandler = (rule, { vouchers }) => {
  const t = threshold(rule);
  const cash = vouchers.filter(isCashVoucher);
  const byWeek = new Map<string, VoucherRow[]>();
  for (const v of cash) {
    const d = parseISO(v.voucher_date);
    if (!d) continue;
    const k = isoWeekKey(d);
    (byWeek.get(k) ?? byWeek.set(k, []).get(k)!).push(v);
  }
  const out: ScrutinyFinding[] = [];
  for (const [week, list] of byWeek) {
    if (list.length >= t) {
      out.push(
        finding(rule, {
          amount: list.reduce((s, v) => s + Math.abs(num(v.amount)), 0),
          flag_message: render(rule.audit_query_template, { count: list.length }),
          evidence: { week, count: list.length, threshold: t },
        }),
      );
    }
  }
  return out;
};

const h_duplicate_amount_date: CheckHandler = (rule, { vouchers }) => {
  const groups = new Map<string, VoucherRow[]>();
  for (const v of vouchers) {
    const k = `${Math.abs(num(v.amount))}|${v.voucher_date}|${lc(v.party_ledger)}`;
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(v);
  }
  const out: ScrutinyFinding[] = [];
  for (const list of groups.values()) {
    if (list.length > 1) {
      const v = list[0];
      out.push(
        finding(rule, {
          account: v.party_ledger ?? v.ledger_name ?? null,
          amount: num(v.amount),
          date: v.voucher_date,
          flag_message: render(rule.audit_query_template, { amount: fmtAmt(num(v.amount)), date: v.voucher_date }),
          evidence: { count: list.length, voucher_numbers: list.map((x) => x.voucher_number) },
        }),
      );
    }
  }
  return out;
};

const h_post_period_entry: CheckHandler = (rule, { vouchers }, ctx) => {
  const end = parseISO(ctx.financialYearEnd);
  if (!end) return [];
  return vouchers
    .filter((v) => {
      const d = parseISO(v.voucher_date);
      return d != null && d.getTime() > end.getTime();
    })
    .map((v) =>
      finding(rule, {
        account: v.party_ledger ?? v.ledger_name ?? null,
        amount: num(v.amount),
        date: v.voucher_date,
        flag_message: render(rule.audit_query_template, { amount: fmtAmt(num(v.amount)), date: v.voucher_date }),
        evidence: { fy_end: ctx.financialYearEnd },
      }),
    );
};

const h_future_date_entry: CheckHandler = (rule, { vouchers }, ctx) => {
  const ref = parseISO(ctx.today) ?? parseISO(ctx.financialYearEnd);
  if (!ref) return [];
  return vouchers
    .filter((v) => {
      const d = parseISO(v.voucher_date);
      return d != null && d.getTime() > ref.getTime();
    })
    .map((v) =>
      finding(rule, {
        amount: num(v.amount),
        date: v.voucher_date,
        flag_message: render(rule.audit_query_template, { date: v.voucher_date, amount: fmtAmt(num(v.amount)) }),
        evidence: { reference_date: ctx.today ?? ctx.financialYearEnd },
      }),
    );
};

const h_weekend_holiday_entry: CheckHandler = (rule, { vouchers }, ctx) => {
  const holidays = new Set((ctx.holidays ?? []).map((s) => s.slice(0, 10)));
  const journalOnly = /journal/i;
  return vouchers
    .filter((v) => (v.voucher_type ? ofType(v, journalOnly) : true))
    .filter((v) => {
      const d = parseISO(v.voucher_date);
      if (!d) return false;
      return isWeekend(d) || holidays.has(v.voucher_date.slice(0, 10));
    })
    .map((v) =>
      finding(rule, {
        amount: num(v.amount),
        date: v.voucher_date,
        flag_message: render(rule.audit_query_template, { amount: fmtAmt(num(v.amount)), date: v.voucher_date }),
        evidence: { voucher_number: v.voucher_number },
      }),
    );
};

const h_blank_narration: CheckHandler = (rule, { vouchers }) => {
  const vt = rule.detection_logic.voucher_type;
  const re = vt ? new RegExp(String(vt), "i") : null;
  return vouchers
    .filter((v) => (re ? ofType(v, re) : true))
    .filter((v) => String(v.narration ?? "").trim() === "")
    .map((v) =>
      finding(rule, {
        amount: num(v.amount),
        date: v.voucher_date,
        flag_message: render(rule.audit_query_template, { amount: fmtAmt(num(v.amount)), date: v.voucher_date }),
        evidence: { voucher_number: v.voucher_number, voucher_type: v.voucher_type },
      }),
    );
};

const h_yearend_large_je: CheckHandler = (rule, { vouchers }, ctx) => {
  const t = threshold(rule);
  const end = parseISO(ctx.financialYearEnd);
  const windowStart = end ? end.getTime() - 31 * 86400000 : null;
  return vouchers
    .filter((v) => (v.voucher_type ? ofType(v, /journal/i) : true))
    .filter((v) => Math.abs(num(v.amount)) >= t)
    .filter((v) => {
      if (!end || windowStart == null) return true;
      const d = parseISO(v.voucher_date);
      return d != null && d.getTime() >= windowStart && d.getTime() <= end.getTime();
    })
    .map((v) =>
      finding(rule, {
        amount: num(v.amount),
        date: v.voucher_date,
        flag_message: render(rule.audit_query_template, { amount: fmtAmt(num(v.amount)), date: v.voucher_date }),
        evidence: { threshold: t },
      }),
    );
};

const h_recurring_round_je: CheckHandler = (rule, { vouchers }) => {
  const minCount = threshold(rule) || 3;
  const journals = vouchers.filter((v) => (v.voucher_type ? ofType(v, /journal/i) : true));
  const byAmount = new Map<number, VoucherRow[]>();
  for (const v of journals) {
    const a = Math.abs(num(v.amount));
    if (!isRound(a)) continue;
    (byAmount.get(a) ?? byAmount.set(a, []).get(a)!).push(v);
  }
  const out: ScrutinyFinding[] = [];
  for (const [amount, list] of byAmount) {
    if (list.length >= minCount) {
      out.push(
        finding(rule, {
          amount,
          flag_message: render(rule.audit_query_template, { amount: fmtAmt(amount), count: list.length }),
          evidence: { count: list.length, threshold: minCount },
        }),
      );
    }
  }
  return out;
};

const h_reversal_entry: CheckHandler = (rule, { vouchers }) => {
  // group by (abs amount + ledger); flag if both a Dr and a Cr of equal magnitude exist
  const groups = new Map<string, { dr: VoucherRow[]; cr: VoucherRow[] }>();
  for (const v of vouchers) {
    const key = `${Math.abs(num(v.amount))}|${lc(v.party_ledger ?? v.ledger_name)}`;
    const g = groups.get(key) ?? groups.set(key, { dr: [], cr: [] }).get(key)!;
    (sideOf(v.dr_cr) === "Cr" ? g.cr : g.dr).push(v);
  }
  const out: ScrutinyFinding[] = [];
  for (const g of groups.values()) {
    if (g.dr.length > 0 && g.cr.length > 0) {
      const v = g.dr[0];
      out.push(
        finding(rule, {
          account: v.party_ledger ?? v.ledger_name ?? null,
          amount: num(v.amount),
          date: v.voucher_date,
          flag_message: render(rule.audit_query_template, { amount: fmtAmt(num(v.amount)), date: v.voucher_date }),
          evidence: { dr: g.dr.map((x) => x.voucher_number), cr: g.cr.map((x) => x.voucher_number) },
        }),
      );
    }
  }
  return out;
};

const h_keyword_count: CheckHandler = (rule, { vouchers }) => {
  const t = threshold(rule) || 10;
  const kws = (rule.detection_logic.keywords as unknown[]) ?? ["round off", "round-off", "rounding"];
  const matches = vouchers.filter((v) => kwMatch(`${v.narration ?? ""} ${v.ledger_name ?? ""}`, kws));
  if (matches.length < t) return [];
  return [
    finding(rule, {
      amount: matches.reduce((s, v) => s + Math.abs(num(v.amount)), 0),
      flag_message: render(rule.audit_query_template, { count: matches.length }),
      evidence: { count: matches.length, threshold: t },
    }),
  ];
};

const h_separate_balance: CheckHandler = (rule, { tb }) => {
  const kws = (rule.detection_logic.keywords as unknown[]) ?? ["sales return", "return"];
  return tb
    .filter((r) => kwMatch(`${r.ledger_name} ${r.parent_group ?? ""}`, kws))
    .filter((r) => num(r.closing_balance) !== 0)
    .map((r) =>
      finding(rule, {
        account: r.ledger_name,
        amount: num(r.closing_balance),
        flag_message: render(rule.audit_query_template, { account: r.ledger_name, amount: fmtAmt(num(r.closing_balance)) }),
        evidence: { parent_group: r.parent_group },
      }),
    );
};

const h_month_spike: CheckHandler = (rule, { vouchers }) => {
  const targetMonth = num(rule.detection_logic.month, 3); // 1-12
  const pct = num(rule.detection_logic.threshold_pct, 150);
  const sales = vouchers.filter((v) => (v.voucher_type ? ofType(v, /sales|revenue/i) : true));
  const byMonth = new Map<number, number>();
  for (const v of sales) {
    const d = parseISO(v.voucher_date);
    if (!d) continue;
    const m = d.getUTCMonth() + 1;
    byMonth.set(m, (byMonth.get(m) ?? 0) + Math.abs(num(v.amount)));
  }
  const months = [...byMonth.keys()];
  if (months.length === 0) return [];
  const total = [...byMonth.values()].reduce((s, x) => s + x, 0);
  const avg = total / months.length;
  const targetTotal = byMonth.get(targetMonth) ?? 0;
  if (avg <= 0 || targetTotal <= (pct / 100) * avg) return [];
  const ratioPct = Math.round((targetTotal / avg) * 100);
  return [
    finding(rule, {
      amount: targetTotal,
      flag_message: render(rule.audit_query_template, { amount: fmtAmt(targetTotal), pct: ratioPct }),
      evidence: { month: targetMonth, avg_month: Math.round(avg), ratio_pct: ratioPct, threshold_pct: pct },
    }),
  ];
};

// ---------------------------------------------------------------------------
// Tier B handlers — the subset computable from the seed's own detection_logic
// (plus optional prior-year TB). The heavier ratio / ageing / adequacy checks
// stay advisory (no handler) until classified financials / a dev DB exist.
// ---------------------------------------------------------------------------

const normName = (s: unknown): string =>
  String(s ?? "").toLowerCase().replace(/\s+/g, " ").trim();

/** is any non-zero ledger matching the keywords present in the TB? */
const anyLedger = (tb: TBRow[], keywords: unknown): boolean =>
  tb.some((r) => kwMatch(`${r.ledger_name} ${r.parent_group ?? ""}`, keywords) && num(r.closing_balance) !== 0);

const SALARY_KEYWORDS = ["salary", "salaries", "wages", "remuneration", "staff cost", "payroll"];
const DEDUCTION_KEYWORDS: Record<string, string[]> = {
  PF: ["provident fund", "pf payable", "epf", "p.f."],
  ESI: ["esi", "employee state insurance", "esic"],
};
const CAPITAL_KEYWORDS = [
  "machinery", "plant", "building", "furniture", "fixture", "vehicle",
  "equipment", "computer", "land", "office equipment",
];

/** flag the whole engagement (no specific account) — used by absence checks. */
const flagEngagement = (rule: ScrutinyRule, message: string, evidence?: Record<string, unknown>): ScrutinyFinding[] => [
  finding(rule, { flag_message: message, evidence }),
];

/**
 * Absence check: flag when an expected provision/disclosure was not made THIS year.
 *
 * Testing mere existence was wrong. A ledger such as "Unpaid Audit Fee" that carries only last
 * year's balance and saw no movement at all in the current year satisfied `anyLedger` and silenced
 * the rule — yet that stale prior-year figure standing alone IS the finding auditors raise. The
 * check now distinguishes three states: never created (absent or nil), created this year (silent),
 * and carried over untouched from the prior year (flagged as stale).
 */
const h_missing_provision: CheckHandler = (rule, { tb }) => {
  const kws = rule.detection_logic.keywords ?? [];
  const live = tb.filter((r) => kwMatch(`${r.ledger_name} ${r.parent_group ?? ""}`, kws) && num(r.closing_balance) !== 0);
  if (live.length === 0) {
    return flagEngagement(rule, render(rule.audit_query_template, {}), { keywords: kws, present: false });
  }
  // Movement is the test for "created this year". Tally reports the year's turnover on the ledger,
  // so a provision raised, reversed or topped up in the year shows a non-zero debit or credit.
  const moved = live.some((r) => Math.abs(num(r.debit_amount)) > 0 || Math.abs(num(r.credit_amount)) > 0);
  if (moved) return [];
  const worst = live.reduce((a, b) => (Math.abs(num(b.closing_balance)) > Math.abs(num(a.closing_balance)) ? b : a));
  const bal = Math.abs(num(worst.closing_balance));
  return [finding(rule, {
    account: worst.ledger_name,
    amount: bal,
    flag_message: render(rule.audit_query_template, { account: worst.ledger_name, amount: fmtAmt(bal) })
      + ` The ledger "${worst.ledger_name}" carries ${fmtAmt(bal)} but shows no movement whatsoever during the year, so the balance is the earlier year's figure still standing rather than a provision created for the current year.`,
    evidence: { keywords: kws, present: true, stale_py_only: true, closing: bal },
  })];
};

// provision_adequacy_keyword & missing_disclosure share the absence pattern
// (true adequacy is manual; we flag when the named ledger is absent).
const h_provision_adequacy_keyword: CheckHandler = h_missing_provision;
const h_missing_disclosure: CheckHandler = h_missing_provision;

/** Conditional absence: salaries present but the statutory deduction ledger is missing. */
const h_missing_deduction: CheckHandler = (rule, { tb }) => {
  const ded = String(rule.detection_logic.deduction ?? "").toUpperCase();
  const dedKws = DEDUCTION_KEYWORDS[ded] ?? [ded.toLowerCase()];
  const hasSalary = anyLedger(tb, SALARY_KEYWORDS);
  const hasDeduction = anyLedger(tb, dedKws);
  if (!hasSalary || hasDeduction) return [];
  return flagEngagement(rule, render(rule.audit_query_template, {}), {
    deduction: ded, salary_present: true, deduction_present: false,
  });
};

/** Year-on-year movement on a ledger above threshold_pct (needs prior-year TB). */
const h_py_comparison: CheckHandler = (rule, { tb, tbPY }) => {
  if (!tbPY || tbPY.length === 0) {
    return [finding(rule, { advisory: true, flag_message: `${rule.rule_name}: prior-year balances unavailable — review manually.`, evidence: { reason: "no_py" } })];
  }
  const pct = num(rule.detection_logic.threshold_pct, 200);
  const pyByName = new Map<string, number>();
  for (const r of tbPY) pyByName.set(normName(r.ledger_name), Math.abs(num(r.closing_balance)));
  const out: ScrutinyFinding[] = [];
  for (const r of tb) {
    const cy = Math.abs(num(r.closing_balance));
    const py = pyByName.get(normName(r.ledger_name)) ?? 0;
    if (py < 1000 || cy < 1000) continue; // skip immaterial
    const ratioPct = (cy / py) * 100;
    if (ratioPct >= pct) {
      out.push(finding(rule, {
        account: r.ledger_name,
        amount: cy,
        flag_message: render(rule.audit_query_template, { account: r.ledger_name, amount: fmtAmt(cy), pct: Math.round(ratioPct) }),
        evidence: { cy, py, ratio_pct: Math.round(ratioPct), threshold_pct: pct },
      }));
    }
  }
  return out;
};

/** Share-capital balance changed vs prior year (needs prior-year TB). */
const h_capital_change: CheckHandler = (rule, { tb, tbPY }) => {
  const kws = ["share capital", "equity share", "preference share", "capital account"];
  const sumCap = (rows: TBRow[]) =>
    rows.filter((r) => kwMatch(`${r.ledger_name} ${r.parent_group ?? ""}`, kws)).reduce((s, r) => s + signedClosing(r), 0);
  if (!tbPY || tbPY.length === 0) {
    return [finding(rule, { advisory: true, flag_message: `${rule.rule_name}: prior-year capital unavailable — review manually.`, evidence: { reason: "no_py" } })];
  }
  const cy = sumCap(tb);
  const py = sumCap(tbPY);
  if (Math.abs(cy - py) <= 1) return [];
  return [finding(rule, {
    amount: cy - py,
    flag_message: render(rule.audit_query_template, { amount: fmtAmt(Math.abs(cy - py)) }),
    evidence: { cy_capital: cy, py_capital: py, change: cy - py },
  })];
};

/** Capital-looking item booked as an expense (voucher grain, keyword heuristic). */
const h_capital_in_expense: CheckHandler = (rule, { vouchers }) => {
  const t = threshold(rule);
  return vouchers
    .filter((v) => sideOf(v.dr_cr) === "Dr")
    .filter((v) => kwMatch(`${v.ledger_name ?? ""} ${v.narration ?? ""}`, CAPITAL_KEYWORDS))
    .filter((v) => Math.abs(num(v.amount)) >= t)
    .map((v) => finding(rule, {
      account: v.ledger_name ?? v.party_ledger ?? null,
      amount: num(v.amount),
      date: v.voucher_date,
      flag_message: render(rule.audit_query_template, { account: v.ledger_name ?? "", amount: fmtAmt(num(v.amount)) }),
      evidence: { voucher_number: v.voucher_number, narration: v.narration },
    }));
};

/** Cash payment for a capital-nature item (voucher grain, keyword heuristic). */
const h_cash_capital_payment: CheckHandler = (rule, { vouchers }) => {
  const t = threshold(rule);
  return vouchers
    .filter(isCashVoucher)
    .filter((v) => kwMatch(`${v.party_ledger ?? ""} ${v.ledger_name ?? ""} ${v.narration ?? ""}`, CAPITAL_KEYWORDS))
    .filter((v) => Math.abs(num(v.amount)) >= t)
    .map((v) => finding(rule, {
      account: v.party_ledger ?? v.ledger_name ?? null,
      amount: num(v.amount),
      date: v.voucher_date,
      flag_message: render(rule.audit_query_template, { amount: fmtAmt(num(v.amount)), date: v.voucher_date }),
      evidence: { voucher_number: v.voucher_number },
    }));
};

// ---------------------------------------------------------------------------
// Generic composable evaluator (check: "expr") — expresses most rules as DATA,
// with no bespoke handler. This is what the AI Rule Composer targets and what
// lets previously-unhandled rules run. detection_logic shape:
//   { check:"expr", grain?:"voucher"|"account"|"aggregate",
//     scope?:{voucher_type?:string[], ledger_keywords?:string[], parent_group_keywords?:string[] (alias group), cash_only?:bool, side?:"Dr"|"Cr", nonzero?:bool},
//       - on the voucher grain, ledger_keywords also matches the party's resolved parent_group (from the TB),
//         so family words like "creditor"/"debtor" work even though they live in the group label, not the ledger name.
//     where?: Cond | Cond[] | {all?:Cond[], any?:Cond[]},
//     aggregate?:{by:("party"|"ledger"|"day"|"month"|"year"|"amount"|"date"|"voucher_type")[], fn:"sum"|"count"|"max", field?:string, having:{op,value}},
//     vs_prior_year?:{op?:string, pct:number}, message?:string }
//   Cond = {field:string, op:string, value?:any}
//   op ∈ > >= < <= == != between contains not_contains in is_blank is_not_blank is_round
//   voucher fields: amount abs_amount narration voucher_type dr_cr party ledger date month is_weekend days_to_fy_end
//   account fields: closing(signed) abs_closing balance_type ledger parent_group opening
// ---------------------------------------------------------------------------

const applyOp = (op: string, a: unknown, b: unknown): boolean => {
  const na = num(a);
  const nb = num(b);
  switch (op) {
    case ">": return na > nb;
    case ">=": return na >= nb;
    case "<": return na < nb;
    case "<=": return na <= nb;
    case "==": case "=": return lc(a) === lc(b) || na === nb;
    case "!=": case "<>": return !(lc(a) === lc(b) || na === nb);
    case "between": { const arr = Array.isArray(b) ? b : []; return na >= num(arr[0]) && na <= num(arr[1]); }
    case "contains": return lc(a).includes(lc(b));
    case "not_contains": return !lc(a).includes(lc(b));
    case "in": return (Array.isArray(b) ? b : []).some((x) => lc(x) === lc(a));
    case "is_blank": return String(a ?? "").trim() === "";
    case "is_not_blank": return String(a ?? "").trim() !== "";
    case "is_round": return isRound(Math.abs(na), num(b, 1000));
    default: return false;
  }
};

const voucherField = (v: VoucherRow, field: string, ctx: ScrutinyContext): unknown => {
  switch (field) {
    case "amount": return num(v.amount);
    case "abs_amount": return Math.abs(num(v.amount));
    case "narration": return v.narration ?? "";
    case "voucher_type": return v.voucher_type ?? "";
    case "dr_cr": case "side": return sideOf(v.dr_cr);
    case "party": return v.party_ledger ?? "";
    case "ledger": return v.ledger_name ?? v.party_ledger ?? "";
    case "date": return v.voucher_date;
    case "month": { const d = parseISO(v.voucher_date); return d ? d.getUTCMonth() + 1 : 0; }
    case "is_weekend": { const d = parseISO(v.voucher_date); return d ? (isWeekend(d) ? 1 : 0) : 0; }
    case "days_to_fy_end": {
      const d = parseISO(v.voucher_date);
      const e = parseISO(ctx.financialYearEnd);
      return d && e ? Math.round((e.getTime() - d.getTime()) / 86400000) : 9999;
    }
    default: return (v as unknown as Record<string, unknown>)[field];
  }
};

const accountField = (r: TBRow, field: string): unknown => {
  switch (field) {
    case "closing": return signedClosing(r);
    case "abs_closing": return Math.abs(num(r.closing_balance));
    case "balance_type": case "side": return sideOf(r.balance_type);
    case "ledger": return r.ledger_name;
    case "parent_group": return r.parent_group ?? "";
    case "opening": return num(r.opening_balance);
    default: return (r as unknown as Record<string, unknown>)[field];
  }
};

type Cond = { field?: string; op?: string; value?: unknown };
const evalWhere = (where: unknown, resolve: (f: string) => unknown): boolean => {
  if (where == null) return true;
  if (Array.isArray(where)) return where.every((c) => evalWhere(c, resolve));
  const w = where as Record<string, unknown>;
  if (Array.isArray(w.all)) return (w.all as unknown[]).every((c) => evalWhere(c, resolve));
  if (Array.isArray(w.any)) return (w.any as unknown[]).some((c) => evalWhere(c, resolve));
  const c = where as Cond;
  if (!c.field || !c.op) return true;
  return applyOp(c.op, resolve(c.field), c.value);
};

/**
 * party/ledger → parent_group resolver, memoized per TB array. Vouchers carry no parent_group, so
 * this lets voucher-grain scope reach the account's FAMILY (RC1): a keyword like "creditor" can
 * match a party ledger grouped under "Sundry Creditors" even though the word never appears in the
 * party's own name — the exact reason a composed creditor rule previously matched zero vouchers.
 */
const _groupOfCache = new WeakMap<object, (ledger: string | null | undefined) => string>();
const groupResolver = (tb: TBRow[]): ((ledger: string | null | undefined) => string) => {
  const cached = _groupOfCache.get(tb);
  if (cached) return cached;
  const m = new Map<string, string>();
  for (const r of tb) m.set(normName(r.ledger_name), r.parent_group ?? "");
  const fn = (ledger: string | null | undefined) => m.get(normName(ledger ?? "")) ?? "";
  _groupOfCache.set(tb, fn);
  return fn;
};

const voucherInScope = (
  v: VoucherRow,
  scope: Record<string, unknown> | undefined,
  groupOf: (ledger: string | null | undefined) => string = () => "",
): boolean => {
  if (!scope) return true;
  if (scope.cash_only && !isCashVoucher(v)) return false;
  if (scope.side && sideOf(v.dr_cr) !== sideOf(scope.side)) return false;
  // voucher_type accepts a single string as well as a list — a bare string used to be ignored
  // silently, which widened the rule to every voucher type instead of narrowing it.
  const vtRaw = scope.voucher_type;
  const vt = typeof vtRaw === "string" ? [vtRaw] : Array.isArray(vtRaw) ? vtRaw : undefined;
  if (vt && vt.length && !vt.some((t) => lc(v.voucher_type).includes(lc(t)))) return false;
  // resolved parent_group of the voucher's party/ledger (RC1)
  const grp = groupOf(v.party_ledger ?? v.ledger_name);
  // scope.match_legs opts a rule into scanning the full double entry: the target ledger of an asset
  // purchase or a repair bill is a LEG, never the party, so a party-only haystack can never match it.
  // Opt-in by design — switching it on globally would widen every existing voucher rule.
  const legs = scope.match_legs && Array.isArray(v.line_items) ? v.line_items : [];
  const legNames = legs.map((l) => l.ledger_name ?? "").join(" ");
  const legGroups = legs.map((l) => groupOf(l.ledger_name)).join(" ");
  // explicit group scoping: scope.parent_group_keywords (alias: scope.group)
  const grpKw = (scope.parent_group_keywords ?? scope.group) as unknown;
  if (Array.isArray(grpKw) && grpKw.length && !kwMatch(`${grp} ${legGroups}`, grpKw)) return false;
  const kw = scope.ledger_keywords;
  // ledger_keywords also matches the resolved parent_group so family words work on the voucher path (RC1)
  if (Array.isArray(kw) && kw.length && !kwMatch(`${v.party_ledger ?? ""} ${v.ledger_name ?? ""} ${v.narration ?? ""} ${grp} ${legNames} ${legGroups}`, kw)) return false;
  return true;
};

const accountInScope = (r: TBRow, scope: Record<string, unknown> | undefined): boolean => {
  if (!scope) return true;
  if (scope.nonzero && num(r.closing_balance) === 0) return false;
  if (scope.side && sideOf(r.balance_type) !== sideOf(scope.side)) return false;
  const grpKw = (scope.parent_group_keywords ?? scope.group) as unknown;
  if (Array.isArray(grpKw) && grpKw.length && !kwMatch(r.parent_group ?? "", grpKw)) return false;
  const kw = scope.ledger_keywords;
  if (Array.isArray(kw) && kw.length && !kwMatch(`${r.ledger_name} ${r.parent_group ?? ""}`, kw)) return false;
  return true;
};

const groupKey = (v: VoucherRow, by: string[]): string =>
  by
    .map((b) => {
      switch (b) {
        case "party": return lc(v.party_ledger);
        case "ledger": return lc(v.ledger_name ?? v.party_ledger);
        case "amount": return String(Math.abs(num(v.amount)));
        case "date": case "day": return String(v.voucher_date).slice(0, 10);
        case "voucher_type": return lc(v.voucher_type);
        case "month": { const d = parseISO(v.voucher_date); return d ? `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}` : ""; }
        case "year": { const d = parseISO(v.voucher_date); return d ? String(d.getUTCFullYear()) : ""; }
        default: return "";
      }
    })
    .join("|");

const h_expr: CheckHandler = (rule, data, ctx) => {
  const dl = rule.detection_logic as unknown as Record<string, unknown>;
  const grain = String(dl.grain ?? "voucher");
  const scope = dl.scope as Record<string, unknown> | undefined;
  const where = dl.where;
  const tpl = (dl.message as string | undefined) ?? rule.audit_query_template;

  if (grain === "account") {
    if (dl.vs_prior_year) {
      const vpy = dl.vs_prior_year as Record<string, unknown>;
      if (!data.tbPY || data.tbPY.length === 0) {
        return [finding(rule, { advisory: true, flag_message: `${rule.rule_name}: prior-year balances unavailable — review manually.`, evidence: { reason: "no_py" } })];
      }
      const pyByName = new Map<string, number>();
      for (const r of data.tbPY) pyByName.set(normName(r.ledger_name), Math.abs(num(r.closing_balance)));
      const out: ScrutinyFinding[] = [];
      for (const r of data.tb) {
        if (!accountInScope(r, scope)) continue;
        const cy = Math.abs(num(r.closing_balance));
        const py = pyByName.get(normName(r.ledger_name)) ?? 0;
        if (py < 1000 || cy < 1000) continue;
        const ratioPct = (cy / py) * 100;
        if (applyOp(String(vpy.op ?? ">="), ratioPct, num(vpy.pct, 200))) {
          out.push(finding(rule, { account: r.ledger_name, amount: cy, flag_message: render(tpl, { account: r.ledger_name, amount: fmtAmt(cy), pct: Math.round(ratioPct) }), evidence: { cy, py, ratio_pct: Math.round(ratioPct) } }));
        }
      }
      return out;
    }
    return data.tb
      .filter((r) => accountInScope(r, scope))
      .filter((r) => evalWhere(where, (f) => accountField(r, f)))
      .map((r) => finding(rule, { account: r.ledger_name, amount: num(r.closing_balance), flag_message: render(tpl, { account: r.ledger_name, amount: fmtAmt(num(r.closing_balance)) }), evidence: { balance_type: r.balance_type, parent_group: r.parent_group } }));
  }

  const groupOf = groupResolver(data.tb);
  const matched = data.vouchers
    .filter((v) => voucherInScope(v, scope, groupOf))
    .filter((v) => evalWhere(where, (f) => voucherField(v, f, ctx)));

  // An aggregate block is honoured whenever it is present, even if grain says "voucher". Requiring
  // grain==="aggregate" meant a grain/aggregate mismatch silently dropped the having clause and the
  // rule emitted one finding per voucher instead of one per breaching group — a flood, not a no-op.
  if (dl.aggregate) {
    const agg = dl.aggregate as Record<string, unknown>;
    const by = (Array.isArray(agg.by) ? agg.by : ["party"]) as string[];
    const fn = String(agg.fn ?? "sum");
    const field = String(agg.field ?? "abs_amount");
    const having = (agg.having as { op?: string; value?: unknown } | undefined) ?? { op: ">", value: 0 };
    // by:["leg"] aggregates over the EXPENSE LEDGER rather than the party. A recurring charge is a
    // property of the head ("Electricity Expenses"), not of the vendor: grouping the same test by
    // party measured 42 findings per engagement against 2.8 by leg, because every vendor who ever
    // supplied anything legitimately transacts in only a few months. Only legs matching the scope's
    // ledger_keywords open a group, so the bank/party side of the entry never forms one.
    const byLeg = by.includes("leg");
    const otherBy = by.filter((b) => b !== "leg");
    const legKw = scope?.ledger_keywords as unknown;
    const legsOf = (v: VoucherRow): Array<{ name: string; amount: number }> =>
      (Array.isArray(v.line_items) ? v.line_items : [])
        .map((l) => ({ name: l.ledger_name ?? "", amount: Math.abs(num(l.amount)) }))
        .filter((l) => l.name && (!Array.isArray(legKw) || !legKw.length || kwMatch(l.name, legKw)));

    const groups = new Map<string, { rows: VoucherRow[]; val: number; distinct: Set<string>; label: string | null }>();
    for (const v of matched) {
      const units = byLeg ? legsOf(v) : [null];
      for (const u of units) {
        const k = byLeg ? `${lc(u!.name)}|${groupKey(v, otherBy)}` : groupKey(v, by);
        const g = groups.get(k) ?? groups.set(k, { rows: [], val: 0, distinct: new Set<string>(), label: u ? u.name : null }).get(k)!;
        g.rows.push(v);
        // count_distinct counts unique VALUES of `field`, not rows — the only way to express
        // "booked in fewer than twelve distinct months", which plain count cannot say (a ledger
        // can carry twenty vouchers all falling in the same three months).
        if (fn === "count_distinct") g.distinct.add(String(voucherField(v, field, ctx) ?? ""));
        else {
          const fv = u ? u.amount : num(voucherField(v, field, ctx));
          g.val = fn === "max" ? Math.max(g.val, fv) : g.val + fv;
        }
      }
    }
    const out: ScrutinyFinding[] = [];
    for (const g of groups.values()) {
      const metric = fn === "count" ? g.rows.length : fn === "count_distinct" ? g.distinct.size : g.val;
      if (applyOp(String(having.op ?? ">"), metric, num(having.value))) {
        const v = g.rows[0];
        const acct = g.label ?? v.party_ledger ?? v.ledger_name ?? null;
        const amt = fn === "count_distinct"
          ? (byLeg ? g.rows.reduce((s, r) => s + legsOf(r).reduce((t, l) => t + l.amount, 0), 0) : g.rows.reduce((s, r) => s + Math.abs(num(r.amount)), 0))
          : g.val;
        out.push(finding(rule, { account: acct, amount: amt, date: v.voucher_date, flag_message: render(tpl, { account: acct ?? "", amount: fmtAmt(amt), count: fn === "count_distinct" ? metric : g.rows.length, date: v.voucher_date }), evidence: { group_count: g.rows.length, metric, distinct: fn === "count_distinct" ? [...g.distinct].sort() : undefined } }));
      }
    }
    return out;
  }

  return matched.map((v) => finding(rule, { account: v.party_ledger ?? v.ledger_name ?? null, amount: num(v.amount), date: v.voucher_date, flag_message: render(tpl, { account: v.party_ledger ?? v.ledger_name ?? "", amount: fmtAmt(num(v.amount)), date: v.voucher_date, narration: v.narration ?? "" }), evidence: { dr_cr: v.dr_cr, voucher_number: v.voucher_number } }));
};

// ---------------------------------------------------------------------------
// Line-item (cross-leg) handlers — read the full double entry (VoucherRow.line_items) to express
// checks a single flattened row cannot: GST intra/inter co-tagging and "money moved but nothing
// booked" stream gaps. Both group by party and scan every leg's ledger_name.
// ---------------------------------------------------------------------------

/**
 * cotag — flags a party whose legs (across all its vouchers) hit TWO OR MORE keyword sets that
 * should be mutually exclusive — e.g. a customer carrying both intra-state CGST/SGST and inter-state
 * IGST sales. detection_logic: { check:"cotag", sets: string[][], scope?, message? }.
 */
const h_cotag: CheckHandler = (rule, data) => {
  const dl = rule.detection_logic as unknown as Record<string, unknown>;
  const sets = (Array.isArray(dl.sets) ? dl.sets : []) as unknown[];
  if (sets.length < 2) return [];
  const scope = dl.scope as Record<string, unknown> | undefined;
  const tpl = (dl.message as string | undefined) ?? rule.audit_query_template;
  const groupOf = groupResolver(data.tb);
  const acc = new Map<string, { hit: Set<number>; legs: string[]; sample: VoucherRow }>();
  for (const v of data.vouchers) {
    if (!voucherInScope(v, scope, groupOf)) continue;
    const key = lc(v.party_ledger ?? v.ledger_name);
    if (!key) continue;
    const rec = acc.get(key) ?? acc.set(key, { hit: new Set(), legs: [], sample: v }).get(key)!;
    for (const leg of Array.isArray(v.line_items) ? v.line_items : []) {
      const ln = String(leg.ledger_name ?? "");
      sets.forEach((s, i) => {
        if (!rec.hit.has(i) && kwMatch(ln, s)) { rec.hit.add(i); rec.legs.push(ln); }
      });
    }
  }
  const out: ScrutinyFinding[] = [];
  for (const [, rec] of acc) {
    if (rec.hit.size >= sets.length) {
      const name = rec.sample.party_ledger ?? rec.sample.ledger_name ?? "";
      out.push(finding(rule, { account: name, flag_message: render(tpl, { account: name }), evidence: { co_tagged_legs: rec.legs } }));
    }
  }
  return out;
};

/**
 * stream_gap — flags a party that has legs matching `present` keywords (e.g. bank/cash movement)
 * but NO leg matching `missing` keywords (e.g. sales/income): money moved, nothing booked.
 * detection_logic: { check:"stream_gap", present:string[], missing:string[], scope?, message? }.
 */
const h_stream_gap: CheckHandler = (rule, data) => {
  const dl = rule.detection_logic as unknown as Record<string, unknown>;
  const present = (Array.isArray(dl.present) ? dl.present : []) as unknown[];
  const missing = (Array.isArray(dl.missing) ? dl.missing : []) as unknown[];
  if (!present.length || !missing.length) return [];
  const scope = dl.scope as Record<string, unknown> | undefined;
  const tpl = (dl.message as string | undefined) ?? rule.audit_query_template;
  const groupOf = groupResolver(data.tb);
  // Value moved through the party during the year. Without this the check has no notion of size and
  // flags every counterparty in the ledger — the single largest source of noise in the system.
  const minAmount = num(dl.min_amount, 0);
  const acc = new Map<string, { present: boolean; missing: boolean; value: number; sample: VoucherRow }>();
  for (const v of data.vouchers) {
    if (!voucherInScope(v, scope, groupOf)) continue;
    const key = lc(v.party_ledger ?? v.ledger_name);
    if (!key) continue;
    const rec = acc.get(key) ?? acc.set(key, { present: false, missing: false, value: 0, sample: v }).get(key)!;
    rec.value += Math.abs(num(v.amount));
    for (const leg of Array.isArray(v.line_items) ? v.line_items : []) {
      const ln = String(leg.ledger_name ?? "");
      if (kwMatch(ln, present)) rec.present = true;
      if (kwMatch(ln, missing)) rec.missing = true;
    }
  }
  const out: ScrutinyFinding[] = [];
  for (const [, rec] of acc) {
    if (rec.present && !rec.missing && rec.value >= minAmount) {
      const name = rec.sample.party_ledger ?? rec.sample.ledger_name ?? "";
      out.push(finding(rule, {
        account: name,
        amount: Math.round(rec.value),
        flag_message: render(tpl, { account: name, amount: fmtAmt(Math.round(rec.value)) }),
        evidence: { has_present: true, has_missing: false, value: Math.round(rec.value) },
      }));
    }
  }
  return out;
};

/**
 * ageing — flags a scoped ledger (e.g. creditors / debtors) whose non-zero closing balance has had
 * NO transaction activity for more than `days` before FY-end (a computable proxy for "outstanding
 * > N days"). Age = days between the ledger's most recent voucher (party leg or any line-item leg)
 * and financialYearEnd; a ledger with a balance but zero activity is treated as fully aged.
 * detection_logic: { check:"ageing", days:number, min_balance?:number, scope?, message? }.
 */
const h_ageing: CheckHandler = (rule, data, ctx) => {
  const dl = rule.detection_logic as unknown as Record<string, unknown>;
  const scope = dl.scope as Record<string, unknown> | undefined;
  const days = num(dl.days ?? dl.threshold ?? rule.threshold_value, 365);
  const minBal = num(dl.min_balance, 0);
  const tpl = (dl.message as string | undefined) ?? rule.audit_query_template;
  const fyEnd = parseISO(ctx.financialYearEnd);
  const endT = fyEnd ? fyEnd.getTime() : null;

  // most recent activity date per ledger name (party leg + every line-item leg)
  const lastAct = new Map<string, number>();
  const bump = (name: string | null | undefined, t: number) => {
    const k = normName(name ?? "");
    if (!k) return;
    const cur = lastAct.get(k);
    if (cur == null || t > cur) lastAct.set(k, t);
  };
  for (const v of data.vouchers) {
    const d = parseISO(v.voucher_date);
    if (!d) continue;
    const t = d.getTime();
    bump(v.party_ledger, t);
    bump(v.ledger_name, t);
    for (const leg of Array.isArray(v.line_items) ? v.line_items : []) bump(leg.ledger_name, t);
  }

  const out: ScrutinyFinding[] = [];
  for (const r of data.tb) {
    if (!accountInScope(r, scope)) continue;
    const bal = Math.abs(num(r.closing_balance));
    if (bal === 0 || bal < minBal) continue;
    const last = lastAct.get(normName(r.ledger_name));
    const ageDays = last == null ? 99999 : endT != null ? Math.round((endT - last) / 86400000) : 0;
    if (ageDays > days) {
      out.push(finding(rule, {
        account: r.ledger_name,
        amount: bal,
        flag_message: render(tpl, { account: r.ledger_name, amount: fmtAmt(bal), count: ageDays }),
        evidence: {
          balance: bal,
          days_since_last_activity: ageDays === 99999 ? "no activity in year" : ageDays,
          last_activity: last ? new Date(last).toISOString().slice(0, 10) : null,
          parent_group: r.parent_group,
        },
      }));
    }
  }
  return out;
};

/** sum of |closing_balance| over TB ledgers matching a scope (numerator/denominator population). */
const sumScoped = (tb: TBRow[], scope: Record<string, unknown> | undefined): number =>
  tb.filter((r) => accountInScope(r, scope)).reduce((s, r) => s + Math.abs(num(r.closing_balance)), 0);

/**
 * ratio — computes a single financial ratio numerator/denominator (each a summed TB scope) and
 * flags if it breaches a threshold. Covers current ratio (as_pct:false, op:"<", value:1), expense
 * share (as_pct:true default, op:">", pct:2), bank-charges/turnover, etc. One finding per rule.
 * detection_logic: { check:"ratio", numerator:scope, denominator:scope, op, value|pct, as_pct?:bool,
 *                    min_denominator?:number, label?:string, message? }.
 */
const h_ratio: CheckHandler = (rule, data) => {
  const dl = rule.detection_logic as unknown as Record<string, unknown>;
  const numScope = (dl.numerator ?? dl.scope) as Record<string, unknown> | undefined;
  const denScope = (dl.denominator ?? dl.base) as Record<string, unknown> | undefined;
  if (!numScope || !denScope) return [];
  const numer = sumScoped(data.tb, numScope);
  const denom = sumScoped(data.tb, denScope);
  if (denom === 0 || denom < num(dl.min_denominator, 0)) return [];
  const asPct = dl.as_pct !== false; // default: percent (most rules are "% of")
  const ratio = asPct ? (numer / denom) * 100 : numer / denom;
  const rounded = Math.round(ratio * 1000) / 1000;
  const op = String(dl.op ?? ">");
  const thr = num(dl.value ?? dl.pct ?? dl.threshold ?? rule.threshold_value);
  if (!applyOp(op, ratio, thr)) return [];
  const label = (dl.label as string | undefined) ?? rule.rule_name;
  const tpl = (dl.message as string | undefined) ?? rule.audit_query_template;
  return [finding(rule, {
    account: label,
    amount: numer,
    flag_message: render(tpl, { account: label, amount: fmtAmt(numer), pct: rounded, ratio: rounded, value: thr }),
    evidence: { numerator: numer, denominator: denom, ratio: rounded, as_pct: asPct, threshold: thr, op },
  })];
};

/**
 * fully_depreciated_in_use — reads the fixed-asset register (data.fa): assets fully depreciated
 * (is_fully_depreciated) yet still held (not disposed this year, no disposal date). Emits ONE summary
 * finding with the count + total gross block; the asset names are in evidence for drill-down.
 * detection_logic: { check:"fully_depreciated_in_use", min_gross?:number, message? }.
 */
const h_fully_depreciated_in_use: CheckHandler = (rule, data) => {
  const fa = Array.isArray(data.fa) ? data.fa : [];
  if (fa.length === 0) return [];
  const dl = rule.detection_logic as unknown as Record<string, unknown>;
  const minGross = num(dl.min_gross, 0);
  const hits = fa.filter((a) =>
    a.is_fully_depreciated === true &&
    num(a.disposals_during_year) === 0 &&
    !a.disposal_date &&
    Math.abs(num(a.gross_block_closing)) >= minGross,
  );
  if (hits.length === 0) return [];
  const totalGross = hits.reduce((s, a) => s + Math.abs(num(a.gross_block_closing)), 0);
  const tpl = (dl.message as string | undefined) ?? rule.audit_query_template;
  return [finding(rule, {
    account: `${hits.length} fully-depreciated asset(s) still in use`,
    amount: totalGross,
    flag_message: render(tpl, { account: `${hits.length} asset(s)`, amount: fmtAmt(totalGross), count: hits.length }),
    evidence: { count: hits.length, total_gross_block: totalGross, assets: hits.slice(0, 50).map((a) => a.asset_name).filter(Boolean) },
  })];
};

/** payee looks like a business (194C rate 2%) vs an individual/HUF (194C rate 1%). */
const TDS_ENTITY_RE = /pvt|private|limited|\bltd\b|llp|company|corp|enterprise|industr|trader|logistic|roadway|transport|carrier|freight|associat|\bco\b|services|solutions/i;

/**
 * tds_shortfall — precise per-party TDS coverage from the voucher legs (line_items). For each party,
 * sums the expense base per section (Dr legs matching that section's keywords, EXCLUDING the party's
 * own leg + GST/bank/TDS/round-off legs) and the actual TDS deducted (any tds/194 leg), then flags a
 * party whose actual TDS falls short of required = base x rate (deductee-type aware: 194C 2% for a
 * business payee, 1% for an individual). Advisory — the auditor confirms section / RCM / deductee.
 * detection_logic: { check:"tds_shortfall", sections:[{section,keywords,rate,individual_rate?,threshold}], tolerance?, message? }.
 */
const h_tds_shortfall: CheckHandler = (rule, data) => {
  const dl = rule.detection_logic as unknown as Record<string, unknown>;
  const sections = (Array.isArray(dl.sections) ? dl.sections : []) as Array<Record<string, unknown>>;
  if (!sections.length) return [];
  const tol = num(dl.tolerance, 0.05);
  const excludeRe = /igst|cgst|sgst|input|output|bank|cash|tds|194|receivable|payable|round|discount|gst/i;
  const tdsRe = /tds|tax deducted|194[a-z]?/i;
  const tpl = (dl.message as string | undefined) ?? rule.audit_query_template;

  const acc = new Map<string, { bySection: Map<string, number>; tds: number; sample: VoucherRow }>();
  for (const v of data.vouchers) {
    const party = v.party_ledger ?? "";
    if (!party || /^cash$|^bank/i.test(party.trim())) continue;
    const pk = lc(party);
    const rec = acc.get(pk) ?? acc.set(pk, { bySection: new Map(), tds: 0, sample: v }).get(pk)!;
    for (const leg of Array.isArray(v.line_items) ? v.line_items : []) {
      const ln = String(leg.ledger_name ?? "");
      const amt = Math.abs(num(leg.amount));
      if (tdsRe.test(ln)) { rec.tds += amt; continue; }
      if (lc(ln) === pk || excludeRe.test(ln) || sideOf(leg.dr_cr) !== "Dr") continue;
      for (const s of sections) {
        if (kwMatch(ln, (Array.isArray(s.keywords) ? s.keywords : []) as unknown[])) {
          const sec = String(s.section ?? "");
          rec.bySection.set(sec, (rec.bySection.get(sec) ?? 0) + amt);
        }
      }
    }
  }

  const out: ScrutinyFinding[] = [];
  for (const [, rec] of acc) {
    let domSec = "", domBase = 0;
    for (const [sec, b] of rec.bySection) if (b > domBase) { domBase = b; domSec = sec; }
    if (!domSec) continue;
    const scfg = sections.find((s) => String(s.section) === domSec);
    if (!scfg) continue;
    if (domBase < num(scfg.threshold, 30000)) continue;
    const party = rec.sample.party_ledger ?? "";
    const isEntity = TDS_ENTITY_RE.test(party);
    const rate = isEntity ? num(scfg.rate, 0.02) : num(scfg.individual_rate ?? scfg.rate, 0.01);
    const required = domBase * rate;
    if (rec.tds >= required * (1 - tol)) continue;
    const shortfall = Math.round(required - rec.tds);
    out.push(finding(rule, {
      account: party,
      amount: shortfall,
      flag_message: render(tpl, { account: party, amount: fmtAmt(shortfall), pct: Math.round(rate * 10000) / 100, value: fmtAmt(Math.round(domBase)) }),
      evidence: { section: domSec, base: Math.round(domBase), actual_tds: Math.round(rec.tds), expected_rate_pct: rate * 100, required: Math.round(required), shortfall, deductee: isEntity ? "business (2%)" : "individual (1%)" },
    }));
  }
  return out;
};

/** sum of |field| over TB ledgers matching a scope (closing or opening balance). */
const sumScopedField = (tb: TBRow[], scope: Record<string, unknown> | undefined, field: "closing" | "opening"): number =>
  tb.filter((r) => accountInScope(r, scope)).reduce((s, r) => s + Math.abs(num(field === "opening" ? r.opening_balance : r.closing_balance)), 0);

/** compute a ratio from a TB: (sum(numerator) − sum(numerator_less)) / (avg? sum(denominator)), ×100 if as_pct. */
const ratioValue = (tb: TBRow[], dl: Record<string, unknown>): number | null => {
  const numScope = dl.numerator as Record<string, unknown> | undefined;
  const denScope = dl.denominator as Record<string, unknown> | undefined;
  if (!numScope || !denScope) return null;
  let numer = sumScopedField(tb, numScope, "closing");
  if (dl.numerator_less) numer -= sumScopedField(tb, dl.numerator_less as Record<string, unknown>, "closing");
  let denom = sumScopedField(tb, denScope, "closing");
  if (dl.denominator_avg === true) denom = (denom + sumScopedField(tb, denScope, "opening")) / 2;
  if (denom === 0) return null;
  return dl.as_pct === true ? (numer / denom) * 100 : numer / denom;
};

/**
 * ratio_change — a financial ratio computed for CY (tb) and PY (tbPY), flagged when the year-on-year
 * change breaches a threshold. numerator may subtract a group (numerator_less, e.g. GP = Sales−COGS);
 * denominator may be averaged (denominator_avg, for turnover). change_mode "delta_pct_points" compares
 * ratio points (GP% down 6pp), "relative" compares % change (D/E up 69%). direction gates decline/increase.
 * Advisory (keyword-estimated group sums). detection_logic: { check:"ratio_change", numerator, numerator_less?,
 * denominator, denominator_avg?, as_pct?, change_mode?, direction?, threshold, label?, message? }.
 */
const h_ratio_change: CheckHandler = (rule, data) => {
  const dl = rule.detection_logic as unknown as Record<string, unknown>;
  if (!data.tbPY || data.tbPY.length === 0) {
    return [finding(rule, { advisory: true, flag_message: `${rule.rule_name}: prior-year TB unavailable — review manually.`, evidence: { reason: "no_py" } })];
  }
  const cy = ratioValue(data.tb, dl);
  const py = ratioValue(data.tbPY, dl);
  if (cy == null || py == null) return [];
  const mode = String(dl.change_mode ?? "relative");
  const change = mode === "delta_pct_points" ? cy - py : (py !== 0 ? ((cy - py) / Math.abs(py)) * 100 : 0);
  const dir = String(dl.direction ?? "any");
  const threshold = num(dl.threshold ?? dl.change_pct ?? rule.threshold_value, 5);
  const directionOk = dir === "any" || (dir === "decline" && change < 0) || (dir === "increase" && change > 0);
  if (!directionOk || Math.abs(change) < threshold) return [];
  const label = (dl.label as string | undefined) ?? rule.rule_name;
  const tpl = (dl.message as string | undefined) ?? rule.audit_query_template;
  return [finding(rule, {
    account: label,
    amount: Math.round(cy * 100) / 100,
    flag_message: render(tpl, { account: label, pct: Math.round(cy * 100) / 100, value: Math.round(py * 100) / 100, count: Math.round(change * 10) / 10 }),
    evidence: { cy_ratio: Math.round(cy * 1000) / 1000, py_ratio: Math.round(py * 1000) / 1000, change_pct: Math.round(change * 10) / 10, change_mode: mode, source: "keyword_estimate" },
  })];
};

/**
 * duplicate_ledger — flags two ledgers in the SAME parent_group whose names are near-duplicates
 * (likely the same party entered twice, e.g. "Balvant Parmar" vs "Balvantbhai Parmar"). Token
 * similarity: tokens match on equality OR prefix (≥4 chars); flag when matched/max ≥ min_similarity.
 * detection_logic: { check:"duplicate_ledger", scope?, min_similarity?:number, message? }.
 */
const h_duplicate_ledger: CheckHandler = (rule, data) => {
  const dl = rule.detection_logic as unknown as Record<string, unknown>;
  const scope = dl.scope as Record<string, unknown> | undefined;
  const minSim = num(dl.min_similarity, 0.7);
  const tpl = (dl.message as string | undefined) ?? rule.audit_query_template;
  const tokenize = (s: string) => normName(s).replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((t) => t.length >= 3);
  const tokMatch = (a: string, b: string) => a === b || (a.length >= 4 && b.length >= 4 && (a.startsWith(b) || b.startsWith(a)));

  /**
   * A GST rate split is not a duplicate party. Tally practice is to keep one ledger per rate —
   * "Hardware Purchase - 5%", "- 12%", "- 18%", "- 28%" — which tokenises to the SAME words once
   * the short numeric tokens drop out, scoring similarity 1.0. Raising min_similarity cannot help
   * because these are perfect matches; they have to be recognised and excluded. Four rate variants
   * of one head also produce six pairs, so this is where the volume came from.
   *
   * Only pairs that are identical APART FROM rate/percentage markers are excluded, so genuine
   * near-duplicates ("Balvant Parmar" vs "Balvantbhai Parmar") are untouched.
   */
  const rateStripped = (s: string) =>
    normName(s)
      .replace(/\d+(\.\d+)?\s*%/g, " ")
      .replace(/\b(nil|zero|exempt|urd|rcm)\s*(rate|rated)?\b/g, " ")
      .replace(/[^a-z ]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  const hasRateMarker = (s: string) => /\d|%|\b(nil|exempt|urd|rcm)\b/i.test(s);
  const isRateVariantPair = (a: string, b: string) =>
    (hasRateMarker(a) || hasRateMarker(b)) && rateStripped(a) === rateStripped(b) && rateStripped(a).length > 0;
  const sim = (aTok: string[], bTok: string[]): number => {
    if (!aTok.length || !bTok.length) return 0;
    let m = 0;
    const used = new Set<number>();
    for (const ta of aTok) for (let i = 0; i < bTok.length; i++) { if (!used.has(i) && tokMatch(ta, bTok[i])) { used.add(i); m++; break; } }
    return m / Math.max(aTok.length, bTok.length);
  };
  const byGroup = new Map<string, TBRow[]>();
  for (const r of data.tb) {
    if (!accountInScope(r, scope)) continue;
    const g = normName(r.parent_group ?? "");
    (byGroup.get(g) ?? byGroup.set(g, []).get(g)!).push(r);
  }
  const out: ScrutinyFinding[] = [];
  const seen = new Set<string>();
  for (const [, rows] of byGroup) {
    const toks = rows.map((r) => tokenize(r.ledger_name));
    for (let i = 0; i < rows.length; i++) {
      if (toks[i].length < 2) continue;
      for (let j = i + 1; j < rows.length; j++) {
        if (toks[j].length < 2 || sim(toks[i], toks[j]) < minSim) continue;
        if (isRateVariantPair(rows[i].ledger_name, rows[j].ledger_name)) continue;
        const key = [normName(rows[i].ledger_name), normName(rows[j].ledger_name)].sort().join("||");
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(finding(rule, {
          account: rows[i].ledger_name,
          flag_message: render(tpl, { account: `"${rows[i].ledger_name}" and "${rows[j].ledger_name}"` }),
          evidence: { ledger_a: rows[i].ledger_name, ledger_b: rows[j].ledger_name, parent_group: rows[i].parent_group },
        }));
      }
    }
  }
  return out;
};

/**
 * no_corresponding_entry — per voucher, flags when a `primary` leg is present but its `counterpart`
 * leg is absent from the SAME voucher (e.g. a purchase with no creditor/cash counterpart; a loan
 * repayment with no interest leg). Each leg is matched against its own name PLUS its resolved
 * parent_group, so family words ("creditor") match a party leg named after the vendor.
 * detection_logic: { check:"no_corresponding_entry", primary:string[], counterpart:string[], scope?, min_amount?, message? }.
 */
const h_no_corresponding_entry: CheckHandler = (rule, data) => {
  const dl = rule.detection_logic as unknown as Record<string, unknown>;
  const primary = (Array.isArray(dl.primary) ? dl.primary : []) as unknown[];
  const counterpart = (Array.isArray(dl.counterpart) ? dl.counterpart : []) as unknown[];
  if (!primary.length || !counterpart.length) return [];
  const scope = dl.scope as Record<string, unknown> | undefined;
  const minAmt = num(dl.min_amount, 0);
  const tpl = (dl.message as string | undefined) ?? rule.audit_query_template;
  const groupOf = groupResolver(data.tb);
  const out: ScrutinyFinding[] = [];
  for (const v of data.vouchers) {
    if (!voucherInScope(v, scope, groupOf)) continue;
    const legs = Array.isArray(v.line_items) ? v.line_items : [];
    if (legs.length === 0) continue;
    let hasP = false, hasC = false;
    for (const leg of legs) {
      const ln = String(leg.ledger_name ?? "");
      const hay = `${ln} ${groupOf(ln)}`;
      if (!hasP && kwMatch(hay, primary)) hasP = true;
      if (!hasC && kwMatch(hay, counterpart)) hasC = true;
    }
    if (hasP && !hasC && Math.abs(num(v.amount)) >= minAmt) {
      const acct = v.party_ledger ?? v.ledger_name ?? null;
      out.push(finding(rule, {
        account: acct,
        amount: num(v.amount),
        date: v.voucher_date,
        flag_message: render(tpl, { account: acct ?? "", amount: fmtAmt(num(v.amount)), date: v.voucher_date }),
        evidence: { voucher_number: v.voucher_number, legs: legs.map((l) => l.ledger_name) },
      }));
    }
  }
  return out;
};

/**
 * adequacy — compares an `actual` TB sum against a statutory limit derived from a `base` sum
 * (limit = (base − base_less) × pct/100) and flags per `op`. Covers dividend-vs-distributable-profit,
 * DRR-vs-debentures, and director/partner remuneration vs book profit. Emits a needs-data advisory
 * when the base is absent from the books (e.g. no debentures). Advisory: the auditor confirms.
 * detection_logic: { check:"adequacy"|alias, actual:scope, base:scope, base_less?:scope, pct, op, min_base?, message? }.
 */
const h_adequacy: CheckHandler = (rule, data) => {
  const dl = rule.detection_logic as unknown as Record<string, unknown>;
  const actualScope = dl.actual as Record<string, unknown> | undefined;
  const baseScope = dl.base as Record<string, unknown> | undefined;
  if (!actualScope || !baseScope) return [];
  const actual = sumScoped(data.tb, actualScope);
  let base = sumScoped(data.tb, baseScope);
  if (dl.base_less) base -= sumScoped(data.tb, dl.base_less as Record<string, unknown>);
  if (base <= 0 || base < num(dl.min_base, 0)) {
    return [finding(rule, { advisory: true, flag_message: `${rule.rule_name}: the statutory base is not present in the books — confirm manually.`, evidence: { reason: "no_base", base: Math.round(base) } })];
  }
  // actual === 0 against a base that IS present is the strongest form of this finding — no
  // depreciation charged at all on a live asset block, no reverse charge discharged at all. It was
  // previously short-circuited away, so the engine passed exactly the engagements it should fail.
  const pct = num(dl.pct ?? dl.required_pct ?? dl.threshold_pct ?? rule.threshold_value, 100);
  const limit = (base * pct) / 100;
  const op = String(dl.op ?? ">");
  if (!applyOp(op, actual, limit)) return [];
  const tpl = (dl.message as string | undefined) ?? rule.audit_query_template;
  return [finding(rule, {
    account: rule.rule_name,
    amount: Math.round(actual),
    flag_message: render(tpl, { account: rule.rule_name, amount: fmtAmt(Math.round(actual)), value: fmtAmt(Math.round(limit)), pct }),
    evidence: { actual: Math.round(actual), base: Math.round(base), pct, limit: Math.round(limit), op, source: "keyword_estimate" },
  })];
};

/**
 * related_party — matches ledgers in scope against the captured related-party list (data.rp, from the
 * related_parties master). If the list is empty it emits an honest needs-data advisory rather than
 * silently finding nothing. Modes are expressed purely by the rule's scope (investments, guarantees,
 * debtors/sales, or all) so one handler serves every RPT rule.
 * detection_logic: { check:"related_party"|alias, scope?, message? }.
 */
const h_related_party: CheckHandler = (rule, data) => {
  const rp = Array.isArray(data.rp) ? data.rp.filter(Boolean) : [];
  if (rp.length === 0) {
    return [finding(rule, { advisory: true, flag_message: `${rule.rule_name}: the related-party list has not been captured for this client — enter the related parties to enable this check.`, evidence: { reason: "no_related_party_master" } })];
  }
  const dl = rule.detection_logic as unknown as Record<string, unknown>;
  const scope = dl.scope as Record<string, unknown> | undefined;
  const tpl = (dl.message as string | undefined) ?? rule.audit_query_template;
  const rpNorm = rp.map((n) => normName(n)).filter((n) => n.length >= 3);
  const isRP = (name: string): boolean => {
    const n = normName(name);
    return !!n && rpNorm.some((r) => n.includes(r) || r.includes(n));
  };
  const out: ScrutinyFinding[] = [];
  for (const r of data.tb) {
    if (!accountInScope(r, scope)) continue;
    const bal = Math.abs(num(r.closing_balance));
    if (bal === 0 || !isRP(r.ledger_name)) continue;
    out.push(finding(rule, {
      account: r.ledger_name,
      amount: bal,
      flag_message: render(tpl, { account: r.ledger_name, amount: fmtAmt(bal) }),
      evidence: { related_party: true, parent_group: r.parent_group },
    }));
  }
  return out;
};

/**
 * balance_decreased — flags a scoped ledger whose balance FELL during the year (opening > closing),
 * i.e. the reserve/fund was utilised. Used for securities-premium utilisation (Sec 52).
 * detection_logic: { check:"balance_decreased"|alias, scope?, min_drop?, message? }.
 */
const h_balance_decreased: CheckHandler = (rule, data) => {
  const dl = rule.detection_logic as unknown as Record<string, unknown>;
  const scope = dl.scope as Record<string, unknown> | undefined;
  const minDrop = num(dl.min_drop, 1);
  const tpl = (dl.message as string | undefined) ?? rule.audit_query_template;
  const out: ScrutinyFinding[] = [];
  for (const r of data.tb) {
    if (!accountInScope(r, scope)) continue;
    const open = Math.abs(num(r.opening_balance));
    const close = Math.abs(num(r.closing_balance));
    const drop = open - close;
    if (open <= 0 || drop < minDrop) continue;
    out.push(finding(rule, {
      account: r.ledger_name,
      amount: Math.round(drop),
      flag_message: render(tpl, { account: r.ledger_name, amount: fmtAmt(Math.round(drop)), value: fmtAmt(Math.round(open)) }),
      evidence: { opening: Math.round(open), closing: Math.round(close), utilised: Math.round(drop) },
    }));
  }
  return out;
};

/**
 * no_movement — flags a scoped ledger that carries a balance which did NOT move during the year
 * (opening ≈ closing). This is the "previous year's provision still exists / pending reversal",
 * "old balance never adjusted" query an auditor raises. Distinct from missing_provision (which fires
 * when the ledger is ABSENT) and from ageing (which needs voucher activity to judge dormancy).
 * detection_logic: { check:"no_movement", scope?, min_balance?:number, tolerance?:number, message? }.
 */
const h_no_movement: CheckHandler = (rule, data) => {
  const dl = rule.detection_logic as unknown as Record<string, unknown>;
  const scope = dl.scope as Record<string, unknown> | undefined;
  const minBal = num(dl.min_balance, 1000);
  const tol = num(dl.tolerance, 1);
  const tpl = (dl.message as string | undefined) ?? rule.audit_query_template;
  const out: ScrutinyFinding[] = [];
  for (const r of data.tb) {
    if (!accountInScope(r, scope)) continue;
    const open = Math.abs(num(r.opening_balance));
    const close = Math.abs(num(r.closing_balance));
    if (open < minBal || close < minBal) continue;
    if (Math.abs(open - close) > tol) continue;
    out.push(finding(rule, {
      account: r.ledger_name,
      amount: close,
      flag_message: render(tpl, { account: r.ledger_name, amount: fmtAmt(close) }),
      evidence: { opening: Math.round(open), closing: Math.round(close), moved: false, parent_group: r.parent_group },
    }));
  }
  return out;
};

// ---------------------------------------------------------------------------
// Registry + runner
// ---------------------------------------------------------------------------

export const TIER_A_HANDLERS: Record<string, CheckHandler> = {
  keyword_balance: h_keyword_balance,
  keyword_narration: h_keyword_narration,
  sign_reversal: h_sign_reversal,
  single_txn: h_single_txn,
  balance_exceeds: h_balance_exceeds,
  negative_balance: h_negative_balance,
  daily_max: h_daily_max,
  round_number: h_round_number,
  frequency: h_frequency,
  duplicate_amount_date: h_duplicate_amount_date,
  post_period_entry: h_post_period_entry,
  future_date_entry: h_future_date_entry,
  weekend_holiday_entry: h_weekend_holiday_entry,
  blank_narration: h_blank_narration,
  yearend_large_je: h_yearend_large_je,
  recurring_round_je: h_recurring_round_je,
  reversal_entry: h_reversal_entry,
  keyword_count: h_keyword_count,
  separate_balance: h_separate_balance,
  month_spike: h_month_spike,
};

export const TIER_A_CHECK_KINDS = Object.keys(TIER_A_HANDLERS);

export const TIER_B_HANDLERS: Record<string, CheckHandler> = {
  missing_provision: h_missing_provision,
  provision_adequacy_keyword: h_provision_adequacy_keyword,
  missing_disclosure: h_missing_disclosure,
  missing_deduction: h_missing_deduction,
  py_comparison: h_py_comparison,
  capital_change: h_capital_change,
  capital_in_expense: h_capital_in_expense,
  cash_capital_payment: h_cash_capital_payment,
};

export const TIER_B_CHECK_KINDS = Object.keys(TIER_B_HANDLERS);

/** Generic composable evaluator + cross-leg (line_items) handlers — data-driven, no bespoke code per rule. */
export const GENERIC_HANDLERS: Record<string, CheckHandler> = {
  expr: h_expr,
  cotag: h_cotag,
  stream_gap: h_stream_gap,
  ageing: h_ageing,
  ratio: h_ratio,
  fully_depreciated_in_use: h_fully_depreciated_in_use,
  tds_shortfall: h_tds_shortfall,
  ratio_change: h_ratio_change,
  duplicate_ledger: h_duplicate_ledger,
  no_movement: h_no_movement,

  // Cross-leg "booked one side, not the other" (voucher grain, uses line_items + resolved groups)
  no_corresponding_entry: h_no_corresponding_entry,
  repayment_without_interest: h_no_corresponding_entry,

  // Statutory adequacy: actual vs (base × pct). Emits needs-data when the base is absent.
  adequacy: h_adequacy,
  dividend_adequacy: h_adequacy,
  drr_adequacy: h_adequacy,
  remuneration_limit: h_adequacy,
  partner_remuneration_limit: h_adequacy,

  // Related-party family — one handler, mode expressed by the rule's scope. Honest needs-data
  // advisory until the related_parties master is captured.
  related_party: h_related_party,
  rpt_disclosure_missing: h_related_party,
  guarantee_related_party: h_related_party,
  investment_related_party: h_related_party,
  related_party_sales: h_related_party,

  // Reserve/fund utilised during the year (securities premium, Sec 52)
  balance_decreased: h_balance_decreased,
  premium_utilization: h_balance_decreased,

  // Aliases onto existing handlers — same logic, legacy check names kept so the rules resolve.
  msme_payment_delay: h_ageing,      // creditors outstanding beyond N days (auditor confirms MSME status)
  inventory_ageing: h_ageing,        // stock ledgers with no movement beyond N days
  guarantee_disclosure: h_keyword_balance, // loan/guarantee ledgers present -> confirm disclosure
};

export const GENERIC_CHECK_KINDS = Object.keys(GENERIC_HANDLERS);

/** All implemented handlers (Tier A deterministic + Tier B computable subset + generic expr). */
export const DEFAULT_HANDLERS: Record<string, CheckHandler> = {
  ...TIER_A_HANDLERS,
  ...TIER_B_HANDLERS,
  ...GENERIC_HANDLERS,
};

export interface RunOptions {
  handlers?: Record<string, CheckHandler>;
  /** emit an advisory finding for rules whose check kind has no handler (default true) */
  emitAdvisoryForUnhandled?: boolean;
  /**
   * Split the run's findings into a capped, ranked shortlist ("query") and review notes ("note").
   * Applied here rather than at the call site so neither write path can forget it — the same
   * reasoning as materiality resolution. Omit to leave every finding untiered.
   */
  triage?: { maxQueries?: number; maxPerRule?: number };
}

/**
 * Execute `rules` against `data`. Each rule is dispatched to the handler registered for its
 * `detection_logic.check`. Rules with no handler (Tier B/C) are reported under coverage.unhandled
 * and, when emitAdvisoryForUnhandled is true, also produce an advisory finding so they are never
 * silently passed.
 */
/**
 * Rewrite a rule's materiality-relative thresholds into absolute rupees for this engagement.
 *
 * A flat rupee threshold is why a ₹1,000 creditor balance is raised at a ₹100 crore company and a
 * ₹35,000 dormant balance is missed at a small firm. A rule opts in with a `materiality` map of
 * dotted paths to MULTIPLES of performance materiality:
 *
 *   { "check":"no_movement", "min_balance":100000,
 *     "materiality": { "min_balance": 0.25, "where.0.value": 0.5 } }
 *
 * The literal value stays as the fallback, so a rule behaves exactly as it does today until a
 * human has approved materiality for the engagement. Applied here rather than at the call site so
 * no caller can forget it.
 */
export const applyMateriality = <T extends { detection_logic?: Record<string, unknown> | null }>(
  rule: T,
  values: MaterialityValues | null | undefined,
): T => {
  const dl = rule.detection_logic as Record<string, unknown> | undefined | null;
  const map = dl?.materiality as Record<string, unknown> | undefined;
  if (!dl || !map || !values || !Number.isFinite(Number(values.performance))) return rule;

  const next = JSON.parse(JSON.stringify(dl)) as Record<string, unknown>;
  for (const [path, factorRaw] of Object.entries(map)) {
    const factor = Number(factorRaw);
    if (!Number.isFinite(factor)) continue;
    const target = Math.round(num(values.performance) * factor);
    const parts = path.split(".");
    let node: unknown = next;
    for (let i = 0; i < parts.length - 1 && node && typeof node === "object"; i++) {
      node = Array.isArray(node)
        ? (node as unknown[])[Number(parts[i])]
        : (node as Record<string, unknown>)[parts[i]];
    }
    if (!node || typeof node !== "object") continue;
    const leaf = parts[parts.length - 1];
    if (Array.isArray(node)) (node as unknown[])[Number(leaf)] = target;
    else (node as Record<string, unknown>)[leaf] = target;
  }
  return { ...rule, detection_logic: next };
};

/**
 * Collapse a rule's findings into ONE engagement-level summary.
 *
 * An auditor raises one query per issue. Several checks naturally emit one finding per day, per
 * voucher or per ledger, so a single behaviour becomes dozens of rows — a cash balance sitting
 * above the limit for 54 days produced 54 findings, none of which a human would ever write up
 * separately. Rolling up preserves every fact (count, total, peak, span, the ledgers involved)
 * while presenting one reviewable item.
 *
 * Opt-in per rule so nothing changes for checks that are already one-per-issue.
 * detection_logic.rollup: true | { min_count?: number, metric?: "total"|"peak", message?: string }
 * The message may use {count} {amount} {peak} {accounts} {date} {value}.
 */
const rollupFindings = (rule: ScrutinyRule, produced: ScrutinyFinding[]): ScrutinyFinding[] => {
  const dl = rule.detection_logic as unknown as Record<string, unknown>;
  const cfg = dl.rollup;
  if (!cfg) return produced;
  const advisory = produced.filter((f) => f.advisory);
  const real = produced.filter((f) => !f.advisory);
  const o = (typeof cfg === "object" && cfg !== null ? cfg : {}) as Record<string, unknown>;
  const minCount = num(o.min_count, 2);
  if (real.length < minCount) return produced;

  const accounts = [...new Set(real.map((f) => f.account).filter(Boolean) as string[])];
  const total = real.reduce((s, f) => s + Math.abs(num(f.amount)), 0);
  const peak = real.reduce((m, f) => Math.max(m, Math.abs(num(f.amount))), 0);
  const dates = (real.map((f) => f.date).filter(Boolean) as string[]).sort();
  const worst = real.reduce((a, b) => (Math.abs(num(b.amount)) > Math.abs(num(a.amount)) ? b : a));
  const headline = num(o.metric === "peak" ? peak : total);
  const shown = accounts.slice(0, 3).join(", ") + (accounts.length > 3 ? ` and ${accounts.length - 3} more` : "");
  const tpl = (o.message as string | undefined) ?? (dl.rollup_message as string | undefined) ?? rule.audit_query_template;

  return [
    ...advisory,
    finding(rule, {
      account: accounts.length === 1 ? accounts[0] : null,
      amount: headline,
      date: worst.date ?? dates[0] ?? null,
      flag_message: render(tpl, {
        count: real.length,
        amount: fmtAmt(headline),
        peak: fmtAmt(peak),
        value: fmtAmt(total),
        accounts: shown,
        date: worst.date ?? dates[0] ?? "",
      }),
      evidence: {
        rolled_up: real.length,
        accounts: accounts.slice(0, 25),
        total: Math.round(total),
        peak: Math.round(peak),
        first: dates[0] ?? null,
        last: dates[dates.length - 1] ?? null,
      },
    }),
  ];
};

export function runDetection(
  rules: ScrutinyRule[],
  data: ScrutinyData,
  ctx: ScrutinyContext = {},
  opts: RunOptions = {},
): DetectionResult {
  const handlers = opts.handlers ?? DEFAULT_HANDLERS;
  const emitAdvisory = opts.emitAdvisoryForUnhandled ?? true;
  const findings: ScrutinyFinding[] = [];
  const executed = new Set<string>();
  const unhandled: { rule_id: string; check: string }[] = [];
  const ledger: RuleRunStatus[] = [];
  let handledCount = 0;

  for (const raw of rules) {
    // Thresholds are rescaled to the engagement's APPROVED materiality before dispatch. With no
    // approval this is a no-op and the rule's literal thresholds apply.
    const rule = applyMateriality(raw, ctx.materiality);
    const check = String(rule.detection_logic?.check ?? "");
    const handler = handlers[check];
    if (!handler) {
      unhandled.push({ rule_id: rule.rule_id, check });
      ledger.push({ rule_id: rule.rule_id, rule_name: rule.rule_name, check, status: "skipped_no_handler", found: 0, reason: `no evaluator for check "${check}"` });
      if (emitAdvisory) {
        findings.push(
          finding(rule, {
            advisory: true,
            flag_message: `${rule.rule_name}: not auto-verified by the deterministic engine (check "${check}") — review manually.`,
            evidence: { check },
          }),
        );
      }
      continue;
    }
    handledCount += 1;
    executed.add(check);
    try {
      const produced = rollupFindings(rule, handler(rule, data, ctx));
      findings.push(...produced);
      const real = produced.filter((f) => !f.advisory);
      const adv = produced.filter((f) => f.advisory);
      if (produced.length > 0 && real.length === 0 && adv.length > 0) {
        const reason = String((adv[0].evidence as Record<string, unknown> | undefined)?.reason ?? "required input unavailable");
        ledger.push({ rule_id: rule.rule_id, rule_name: rule.rule_name, check, status: "needs_data", found: 0, reason });
      } else {
        ledger.push({ rule_id: rule.rule_id, rule_name: rule.rule_name, check, status: "executed", found: real.length });
      }
    } catch (err) {
      ledger.push({ rule_id: rule.rule_id, rule_name: rule.rule_name, check, status: "error", found: 0, reason: String(err) });
      findings.push(
        finding(rule, {
          advisory: true,
          flag_message: `${rule.rule_name}: handler error — review manually.`,
          evidence: { error: String(err) },
        }),
      );
    }
  }

  // Tier the real findings. Advisories are never client-facing, so they stay out of the shortlist
  // and out of the ranking entirely rather than consuming slots.
  if (opts.triage) {
    const real = findings.filter((f) => !f.advisory);
    const { queries } = triage(real, {
      maxQueries: opts.triage.maxQueries,
      maxPerRule: opts.triage.maxPerRule,
      performanceMateriality: ctx.materiality?.performance ?? null,
    });
    const shortlist = new Set<ScrutinyFinding>(queries);
    for (const f of real) f.tier = shortlist.has(f) ? "query" : "note";
  }

  return {
    findings,
    coverage: {
      rulesTotal: rules.length,
      rulesHandled: handledCount,
      executedKinds: [...executed],
      unhandled,
    },
    ledger,
  };
}
