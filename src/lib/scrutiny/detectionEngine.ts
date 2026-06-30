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

export interface DetectionResult {
  findings: ScrutinyFinding[];
  coverage: {
    rulesTotal: number;
    rulesHandled: number;
    executedKinds: string[];
    unhandled: { rule_id: string; check: string }[];
  };
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
  const handlers = opts.handlers ?? TIER_A_HANDLERS;
  const emitAdvisory = opts.emitAdvisoryForUnhandled ?? true;
  const findings: ScrutinyFinding[] = [];
  const executed = new Set<string>();
  const unhandled: { rule_id: string; check: string }[] = [];
  let handledCount = 0;

  for (const rule of rules) {
    const check = String(rule.detection_logic?.check ?? "");
    const handler = handlers[check];
    if (!handler) {
      unhandled.push({ rule_id: rule.rule_id, check });
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
      findings.push(...handler(rule, data, ctx));
    } catch (err) {
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
  };
}
