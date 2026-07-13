/**
 * Scrutiny detection engine — Tier A interpreter (gap G1).
 *
 * Pure, dependency-free functions that execute the `detection_logic` of the seeded
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
}

export interface ScrutinyData {
  tb: TBRow[];
  vouchers: VoucherRow[];
  /** prior-year trial balance (account grain) — enables py_comparison / capital_change */
  tbPY?: TBRow[];
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

const h_sign_reversal: CheckHandler = (rule, { tb }) => {
  const expected = sideOf(rule.detection_logic.expected_sign === "credit" ? "Cr" : "Dr");
  const re = SCOPE[rule.category];
  return tb
    .filter((r) => inScope(r, re))
    .filter((r) => num(r.closing_balance) !== 0 && sideOf(r.balance_type) !== expected)
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

/** Absence check: flag when an expected provision/disclosure ledger is NOT present. */
const h_missing_provision: CheckHandler = (rule, { tb }) => {
  const kws = rule.detection_logic.keywords ?? [];
  if (anyLedger(tb, kws)) return [];
  return flagEngagement(rule, render(rule.audit_query_template, {}), { keywords: kws, present: false });
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
  const vt = scope.voucher_type as unknown[] | undefined;
  if (Array.isArray(vt) && vt.length && !vt.some((t) => lc(v.voucher_type).includes(lc(t)))) return false;
  // resolved parent_group of the voucher's party/ledger (RC1)
  const grp = groupOf(v.party_ledger ?? v.ledger_name);
  // explicit group scoping: scope.parent_group_keywords (alias: scope.group)
  const grpKw = (scope.parent_group_keywords ?? scope.group) as unknown;
  if (Array.isArray(grpKw) && grpKw.length && !kwMatch(grp, grpKw)) return false;
  const kw = scope.ledger_keywords;
  // ledger_keywords also matches the resolved parent_group so family words work on the voucher path (RC1)
  if (Array.isArray(kw) && kw.length && !kwMatch(`${v.party_ledger ?? ""} ${v.ledger_name ?? ""} ${v.narration ?? ""} ${grp}`, kw)) return false;
  return true;
};

const accountInScope = (r: TBRow, scope: Record<string, unknown> | undefined): boolean => {
  if (!scope) return true;
  if (scope.nonzero && num(r.closing_balance) === 0) return false;
  if (scope.side && sideOf(r.balance_type) !== sideOf(scope.side)) return false;
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

  if (grain === "aggregate" && dl.aggregate) {
    const agg = dl.aggregate as Record<string, unknown>;
    const by = (Array.isArray(agg.by) ? agg.by : ["party"]) as string[];
    const fn = String(agg.fn ?? "sum");
    const field = String(agg.field ?? "abs_amount");
    const having = (agg.having as { op?: string; value?: unknown } | undefined) ?? { op: ">", value: 0 };
    const groups = new Map<string, { rows: VoucherRow[]; val: number }>();
    for (const v of matched) {
      const k = groupKey(v, by);
      const g = groups.get(k) ?? groups.set(k, { rows: [], val: 0 }).get(k)!;
      g.rows.push(v);
      const fv = num(voucherField(v, field, ctx));
      g.val = fn === "max" ? Math.max(g.val, fv) : g.val + fv;
    }
    const out: ScrutinyFinding[] = [];
    for (const g of groups.values()) {
      const metric = fn === "count" ? g.rows.length : g.val;
      if (applyOp(String(having.op ?? ">"), metric, num(having.value))) {
        const v = g.rows[0];
        out.push(finding(rule, { account: v.party_ledger ?? v.ledger_name ?? null, amount: g.val, date: v.voucher_date, flag_message: render(tpl, { account: v.party_ledger ?? v.ledger_name ?? "", amount: fmtAmt(g.val), count: g.rows.length, date: v.voucher_date }), evidence: { group_count: g.rows.length, metric } }));
      }
    }
    return out;
  }

  return matched.map((v) => finding(rule, { account: v.party_ledger ?? v.ledger_name ?? null, amount: num(v.amount), date: v.voucher_date, flag_message: render(tpl, { account: v.party_ledger ?? v.ledger_name ?? "", amount: fmtAmt(num(v.amount)), date: v.voucher_date, narration: v.narration ?? "" }), evidence: { dr_cr: v.dr_cr, voucher_number: v.voucher_number } }));
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

/** Generic composable evaluator — one data-driven handler that expresses most rules without bespoke code. */
export const GENERIC_HANDLERS: Record<string, CheckHandler> = {
  expr: h_expr,
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
}

/**
 * Execute `rules` against `data`. Each rule is dispatched to the handler registered for its
 * `detection_logic.check`. Rules with no handler (Tier B/C) are reported under coverage.unhandled
 * and, when emitAdvisoryForUnhandled is true, also produce an advisory finding so they are never
 * silently passed.
 */
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

  for (const rule of rules) {
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
      const produced = handler(rule, data, ctx);
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
