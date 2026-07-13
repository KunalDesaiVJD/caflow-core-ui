import { describe, it, expect } from "vitest";
import {
  runDetection,
  TIER_A_HANDLERS,
  TIER_A_CHECK_KINDS,
  TIER_B_CHECK_KINDS,
  type ScrutinyRule,
  type TBRow,
  type VoucherRow,
  type ScrutinyContext,
} from "./detectionEngine";

// ---- builders -------------------------------------------------------------

const rule = (p: Partial<ScrutinyRule> & { rule_id: string; detection_logic: ScrutinyRule["detection_logic"] }): ScrutinyRule => ({
  rule_name: p.rule_id,
  category: p.rule_id.split("-")[0],
  detection_level: "voucher",
  severity: "high",
  threshold_value: null,
  audit_query_template: "Flag {account} {amount} {date}",
  legal_reference: null,
  ...p,
});

const tb = (p: Partial<TBRow> & { ledger_name: string }): TBRow => ({
  closing_balance: 0,
  balance_type: "Dr",
  ...p,
});

const vch = (p: Partial<VoucherRow> & { amount: number; voucher_date: string }): VoucherRow => ({
  dr_cr: "Dr",
  ...p,
});

const FY: ScrutinyContext = { financialYearStart: "2025-04-01", financialYearEnd: "2026-03-31", today: "2026-03-31" };
const run = (r: ScrutinyRule, data: { tb?: TBRow[]; vouchers?: VoucherRow[]; tbPY?: TBRow[] }, ctx: ScrutinyContext = FY) =>
  runDetection([r], { tb: data.tb ?? [], vouchers: data.vouchers ?? [], tbPY: data.tbPY }, ctx, { emitAdvisoryForUnhandled: false }).findings;

// ---- account-grain handlers ----------------------------------------------

describe("sign_reversal", () => {
  it("flags a debtor with a credit balance, leaves a normal debtor alone", () => {
    const r = rule({ rule_id: "DEBT-005", detection_level: "account", detection_logic: { check: "sign_reversal", expected_sign: "debit" } });
    const found = run(r, {
      tb: [
        tb({ ledger_name: "Sundry Debtors — Acme", parent_group: "Sundry Debtors", closing_balance: 5000, balance_type: "Cr" }),
        tb({ ledger_name: "Sundry Debtors — Beta", parent_group: "Sundry Debtors", closing_balance: 9000, balance_type: "Dr" }),
      ],
    });
    expect(found).toHaveLength(1);
    expect(found[0].account).toBe("Sundry Debtors — Acme");
  });

  it("flags a creditor with a debit balance", () => {
    const r = rule({ rule_id: "CRED-001", category: "CRED", detection_level: "account", detection_logic: { check: "sign_reversal", expected_sign: "credit" } });
    const found = run(r, { tb: [tb({ ledger_name: "Sundry Creditors — X", parent_group: "Sundry Creditors", closing_balance: 7000, balance_type: "Dr" })] });
    expect(found).toHaveLength(1);
  });
});

describe("keyword_balance", () => {
  it("flags a non-zero suspense account, ignores zero balance and unrelated ledgers", () => {
    const r = rule({ rule_id: "BKR-002", category: "BKR", detection_level: "account", detection_logic: { check: "keyword_balance", keywords: ["suspense"], nonzero: true } });
    const found = run(r, {
      tb: [
        tb({ ledger_name: "Suspense A/c", closing_balance: 1200, balance_type: "Dr" }),
        tb({ ledger_name: "Suspense (old)", closing_balance: 0, balance_type: "Dr" }),
        tb({ ledger_name: "Bank — HDFC", closing_balance: 50000, balance_type: "Dr" }),
      ],
    });
    expect(found).toHaveLength(1);
    expect(found[0].account).toBe("Suspense A/c");
  });
});

describe("negative_balance", () => {
  it("flags a stock ledger carrying a credit (negative) balance", () => {
    const r = rule({ rule_id: "INV-001", category: "INV", detection_level: "account", detection_logic: { check: "negative_balance", keywords: ["stock", "inventory"] } });
    const found = run(r, {
      tb: [
        tb({ ledger_name: "Closing Stock", parent_group: "Stock-in-Hand", closing_balance: 3000, balance_type: "Cr" }),
        tb({ ledger_name: "Closing Stock — B", parent_group: "Stock-in-Hand", closing_balance: 8000, balance_type: "Dr" }),
      ],
    });
    expect(found).toHaveLength(1);
    expect(found[0].account).toBe("Closing Stock");
  });
});

describe("balance_exceeds", () => {
  it("flags a creditor balance above the materiality threshold", () => {
    const r = rule({ rule_id: "CRED-007", category: "CRED", detection_level: "account", threshold_value: 500000, detection_logic: { check: "balance_exceeds", threshold: 500000 } });
    const found = run(r, {
      tb: [
        tb({ ledger_name: "Creditors — Big", parent_group: "Sundry Creditors", closing_balance: 750000, balance_type: "Cr" }),
        tb({ ledger_name: "Creditors — Small", parent_group: "Sundry Creditors", closing_balance: 100000, balance_type: "Cr" }),
      ],
    });
    expect(found).toHaveLength(1);
    expect(found[0].amount).toBe(750000);
  });
});

describe("separate_balance", () => {
  it("flags a non-zero sales-return ledger", () => {
    const r = rule({ rule_id: "SALES-005", category: "SALES", detection_level: "account", detection_logic: { check: "separate_balance", keywords: ["sales return"] } });
    const found = run(r, { tb: [tb({ ledger_name: "Sales Return A/c", closing_balance: 12000, balance_type: "Dr" })] });
    expect(found).toHaveLength(1);
  });
});

// ---- voucher-grain handlers ----------------------------------------------

describe("single_txn", () => {
  const r = rule({ rule_id: "CASH-002", category: "CASH", detection_logic: { check: "single_txn", direction: "debit", threshold: 20000 } });
  it("flags a cash payment over the threshold", () => {
    const found = run(r, { vouchers: [vch({ amount: 25000, dr_cr: "Dr", voucher_date: "2025-06-10", ledger_name: "Cash" })] });
    expect(found).toHaveLength(1);
  });
  it("ignores a non-cash voucher of the same amount (cash-only scope)", () => {
    const found = run(r, { vouchers: [vch({ amount: 25000, dr_cr: "Dr", voucher_date: "2025-06-10", ledger_name: "Bank" })] });
    expect(found).toHaveLength(0);
  });
  it("ignores a cash payment below the threshold", () => {
    const found = run(r, { vouchers: [vch({ amount: 15000, dr_cr: "Dr", voucher_date: "2025-06-10", ledger_name: "Cash" })] });
    expect(found).toHaveLength(0);
  });
});

describe("daily_max", () => {
  it("flags the day cumulative cash crosses 2L", () => {
    const r = rule({ rule_id: "CASH-001", category: "CASH", detection_logic: { check: "daily_max", threshold: 200000 } });
    const found = run(r, {
      vouchers: [
        vch({ amount: 150000, dr_cr: "Dr", voucher_date: "2025-05-01", ledger_name: "Cash" }),
        vch({ amount: 100000, dr_cr: "Dr", voucher_date: "2025-05-02", ledger_name: "Cash" }),
      ],
    });
    expect(found).toHaveLength(1);
    expect(found[0].date).toBe("2025-05-02");
    expect(found[0].amount).toBe(250000);
  });
});

describe("round_number", () => {
  const r = rule({ rule_id: "CASH-005", category: "CASH", detection_logic: { check: "round_number", threshold: 50000 } });
  it("flags a round cash amount at/above threshold", () => {
    expect(run(r, { vouchers: [vch({ amount: 51000, voucher_date: "2025-07-01", ledger_name: "Cash" })] })).toHaveLength(1);
  });
  it("ignores a non-round amount and a below-threshold round amount", () => {
    expect(run(r, { vouchers: [vch({ amount: 50500, voucher_date: "2025-07-01", ledger_name: "Cash" })] })).toHaveLength(0);
    expect(run(r, { vouchers: [vch({ amount: 49000, voucher_date: "2025-07-01", ledger_name: "Cash" })] })).toHaveLength(0);
  });
});

describe("frequency", () => {
  it("flags a week with >= 5 cash transactions", () => {
    const r = rule({ rule_id: "CASH-007", category: "CASH", detection_logic: { check: "frequency", period: "week", threshold: 5 } });
    const dates = ["2025-04-07", "2025-04-08", "2025-04-09", "2025-04-10", "2025-04-11"]; // same ISO week
    const found = run(r, { vouchers: dates.map((d) => vch({ amount: 1000, voucher_date: d, ledger_name: "Cash" })) });
    expect(found).toHaveLength(1);
  });
});

describe("duplicate_amount_date", () => {
  it("flags two vouchers with the same amount + date + party", () => {
    const r = rule({ rule_id: "EXP-005", category: "EXP", detection_logic: { check: "duplicate_amount_date" } });
    const found = run(r, {
      vouchers: [
        vch({ amount: 40000, voucher_date: "2025-08-01", party_ledger: "Vendor A" }),
        vch({ amount: 40000, voucher_date: "2025-08-01", party_ledger: "Vendor A" }),
        vch({ amount: 40000, voucher_date: "2025-08-02", party_ledger: "Vendor A" }),
      ],
    });
    expect(found).toHaveLength(1);
  });
});

describe("post_period_entry & future_date_entry", () => {
  it("post_period flags a voucher dated after FY end", () => {
    const r = rule({ rule_id: "EXP-006", category: "EXP", detection_logic: { check: "post_period_entry" } });
    const found = run(r, {
      vouchers: [
        vch({ amount: 5000, voucher_date: "2026-04-15" }),
        vch({ amount: 5000, voucher_date: "2026-03-15" }),
      ],
    });
    expect(found).toHaveLength(1);
    expect(found[0].date).toBe("2026-04-15");
  });
  it("future_date flags a voucher after 'today'", () => {
    const r = rule({ rule_id: "JE-007", category: "JE", detection_logic: { check: "future_date_entry" } });
    const found = run(r, { vouchers: [vch({ amount: 1, voucher_date: "2026-06-01" })] }, { ...FY, today: "2026-03-31" });
    expect(found).toHaveLength(1);
  });
});

describe("weekend_holiday_entry", () => {
  const r = rule({ rule_id: "JE-001", category: "JE", detection_logic: { check: "weekend_holiday_entry" } });
  it("flags a Saturday journal, ignores a weekday", () => {
    expect(run(r, { vouchers: [vch({ amount: 1, voucher_date: "2025-04-05", voucher_type: "Journal" })] })).toHaveLength(1); // Sat
    expect(run(r, { vouchers: [vch({ amount: 1, voucher_date: "2025-04-07", voucher_type: "Journal" })] })).toHaveLength(0); // Mon
  });
  it("flags a holiday supplied via context", () => {
    const found = run(r, { vouchers: [vch({ amount: 1, voucher_date: "2025-08-15", voucher_type: "Journal" })] }, { ...FY, holidays: ["2025-08-15"] });
    expect(found).toHaveLength(1);
  });
});

describe("blank_narration", () => {
  it("flags a journal voucher with empty narration only", () => {
    const r = rule({ rule_id: "JE-003", category: "JE", detection_logic: { check: "blank_narration", voucher_type: "journal" } });
    const found = run(r, {
      vouchers: [
        vch({ amount: 1, voucher_date: "2025-09-01", voucher_type: "Journal", narration: "" }),
        vch({ amount: 1, voucher_date: "2025-09-02", voucher_type: "Journal", narration: "Provision" }),
      ],
    });
    expect(found).toHaveLength(1);
    expect(found[0].date).toBe("2025-09-01");
  });
});

describe("yearend_large_je", () => {
  const r = rule({ rule_id: "JE-002", category: "JE", threshold_value: 500000, detection_logic: { check: "yearend_large_je", threshold: 500000 } });
  it("flags a large journal within ~31 days of FY end, not one well before", () => {
    expect(run(r, { vouchers: [vch({ amount: 600000, voucher_date: "2026-03-20", voucher_type: "Journal" })] })).toHaveLength(1);
    expect(run(r, { vouchers: [vch({ amount: 600000, voucher_date: "2026-02-01", voucher_type: "Journal" })] })).toHaveLength(0);
  });
});

describe("recurring_round_je", () => {
  it("flags a round JE amount repeated >= 3 times", () => {
    const r = rule({ rule_id: "JE-004", category: "JE", detection_logic: { check: "recurring_round_je", threshold: 3 } });
    const found = run(r, {
      vouchers: [1, 2, 3].map((i) => vch({ amount: 25000, voucher_date: `2025-10-0${i}`, voucher_type: "Journal" })),
    });
    expect(found).toHaveLength(1);
  });
});

describe("reversal_entry", () => {
  it("flags a Dr and Cr of equal amount on the same ledger", () => {
    const r = rule({ rule_id: "JE-005", category: "JE", detection_logic: { check: "reversal_entry" } });
    const found = run(r, {
      vouchers: [
        vch({ amount: 33000, dr_cr: "Dr", voucher_date: "2025-11-01", party_ledger: "Ledger Z" }),
        vch({ amount: 33000, dr_cr: "Cr", voucher_date: "2025-11-05", party_ledger: "Ledger Z" }),
      ],
    });
    expect(found).toHaveLength(1);
  });
});

describe("keyword_count", () => {
  it("flags when round-off entries reach the count threshold", () => {
    const r = rule({ rule_id: "DEBT-007", category: "DEBT", detection_logic: { check: "keyword_count", threshold: 10 } });
    const vouchers = Array.from({ length: 10 }, (_, i) => vch({ amount: 1, voucher_date: "2025-12-01", narration: "round off adjustment", ledger_name: "Debtors" }));
    expect(run(r, { vouchers })).toHaveLength(1);
    expect(run(r, { vouchers: vouchers.slice(0, 9) })).toHaveLength(0);
  });
});

describe("keyword_narration", () => {
  it("flags a voucher whose narration looks personal", () => {
    const r = rule({ rule_id: "EXP-004", category: "EXP", detection_logic: { check: "keyword_narration", keywords: ["personal", "family"] } });
    const found = run(r, { vouchers: [vch({ amount: 9000, voucher_date: "2025-05-20", narration: "Personal car expense" })] });
    expect(found).toHaveLength(1);
  });
});

describe("month_spike", () => {
  it("flags March sales above 150% of the monthly average", () => {
    const r = rule({ rule_id: "SALES-006", category: "SALES", detection_logic: { check: "month_spike", month: 3, threshold_pct: 150 } });
    const vouchers: VoucherRow[] = [
      vch({ amount: 100000, voucher_date: "2025-04-15", voucher_type: "Sales" }),
      vch({ amount: 100000, voucher_date: "2025-05-15", voucher_type: "Sales" }),
      vch({ amount: 1000000, voucher_date: "2026-03-20", voucher_type: "Sales" }),
    ];
    const found = run(r, { vouchers });
    expect(found).toHaveLength(1);
    expect(found[0].evidence?.month).toBe(3);
  });
});

// ---- runner / coverage ----------------------------------------------------

describe("runDetection coverage", () => {
  it("handles Tier A and reports Tier B/C as unhandled with an advisory finding", () => {
    const rules: ScrutinyRule[] = [
      rule({ rule_id: "BKR-002", category: "BKR", detection_level: "account", detection_logic: { check: "keyword_balance", keywords: ["suspense"], nonzero: true } }),
      rule({ rule_id: "CRED-003", category: "CRED", detection_logic: { check: "msme_payment_delay", threshold_days: 45 } }), // Tier C, no handler
    ];
    const res = runDetection(
      rules,
      { tb: [tb({ ledger_name: "Suspense", closing_balance: 100, balance_type: "Dr" })], vouchers: [] },
      FY,
    );
    expect(res.coverage.rulesTotal).toBe(2);
    expect(res.coverage.rulesHandled).toBe(1);
    expect(res.coverage.unhandled).toEqual([{ rule_id: "CRED-003", check: "msme_payment_delay" }]);
    const advisory = res.findings.find((f) => f.advisory);
    expect(advisory?.rule_id).toBe("CRED-003");
    expect(res.findings.some((f) => !f.advisory && f.rule_id === "BKR-002")).toBe(true);
  });

  it("exposes exactly 20 Tier A check kinds", () => {
    expect(TIER_A_CHECK_KINDS).toHaveLength(20);
    expect(Object.keys(TIER_A_HANDLERS)).toContain("daily_max");
  });

  it("renders the audit_query_template into flag_message", () => {
    const r = rule({ rule_id: "BKR-002", category: "BKR", detection_level: "account", audit_query_template: 'Suspense "{account}" has ₹{amount}.', detection_logic: { check: "keyword_balance", keywords: ["suspense"], nonzero: true } });
    const found = run(r, { tb: [tb({ ledger_name: "Suspense A/c", closing_balance: 1200, balance_type: "Dr" })] });
    expect(found[0].flag_message).toBe('Suspense "Suspense A/c" has ₹1,200.');
  });

  it("strips an unfilled placeholder and its dangling currency mark (absence checks)", () => {
    const r = rule({ rule_id: "PAY-001", category: "PAY", detection_level: "account", audit_query_template: "Salary ₹{amount} without PF. EPF mandatory above ₹15,000.", detection_logic: { check: "missing_deduction", deduction: "PF" } });
    const found = run(r, { tb: [tb({ ledger_name: "Salaries", closing_balance: 500000, balance_type: "Dr" })] });
    expect(found[0].flag_message).toBe("Salary without PF. EPF mandatory above ₹15,000.");
  });
});

// ---- Tier B handlers ------------------------------------------------------

describe("missing_provision (absence)", () => {
  it("flags when the provision ledger is absent, not when present", () => {
    const r = rule({ rule_id: "PROV-006", category: "PROV", detection_level: "account", detection_logic: { check: "missing_provision", keywords: ["deferred tax"] } });
    expect(run(r, { tb: [tb({ ledger_name: "Rent", closing_balance: 100, balance_type: "Dr" })] })).toHaveLength(1);
    expect(run(r, { tb: [tb({ ledger_name: "Deferred Tax Liability", closing_balance: 5000, balance_type: "Cr" })] })).toHaveLength(0);
  });
});

describe("provision_adequacy_keyword & missing_disclosure", () => {
  it("flag when gratuity / contingent ledger absent, not when present", () => {
    const grat = rule({ rule_id: "PAY-004", category: "PAY", detection_level: "account", detection_logic: { check: "provision_adequacy_keyword", keywords: ["gratuity"] } });
    expect(run(grat, { tb: [tb({ ledger_name: "Salary", closing_balance: 1000, balance_type: "Dr" })] })).toHaveLength(1);
    const cont = rule({ rule_id: "PROV-001", category: "PROV", detection_level: "account", detection_logic: { check: "missing_disclosure", keywords: ["contingent", "claim"] } });
    expect(run(cont, { tb: [tb({ ledger_name: "Contingent Liability — Guarantee", closing_balance: 1, balance_type: "Cr" })] })).toHaveLength(0);
  });
});

describe("missing_deduction (conditional absence)", () => {
  const r = rule({ rule_id: "PAY-001", category: "PAY", detection_level: "voucher", detection_logic: { check: "missing_deduction", deduction: "PF" } });
  it("flags salaries present with no PF ledger", () => {
    expect(run(r, { tb: [tb({ ledger_name: "Salaries & Wages", closing_balance: 500000, balance_type: "Dr" })] })).toHaveLength(1);
  });
  it("does not flag when a PF ledger exists", () => {
    expect(run(r, { tb: [tb({ ledger_name: "Salaries & Wages", closing_balance: 500000, balance_type: "Dr" }), tb({ ledger_name: "Provident Fund Payable", closing_balance: 20000, balance_type: "Cr" })] })).toHaveLength(0);
  });
  it("does not flag when there are no salaries at all", () => {
    expect(run(r, { tb: [tb({ ledger_name: "Rent", closing_balance: 1000, balance_type: "Dr" })] })).toHaveLength(0);
  });
});

describe("py_comparison", () => {
  const r = rule({ rule_id: "EXP-002", category: "EXP", detection_level: "ratio", detection_logic: { check: "py_comparison", threshold_pct: 200 } });
  it("flags a ledger that grew beyond 200% of prior year", () => {
    const found = run(r, {
      tb: [tb({ ledger_name: "Travelling Expenses", closing_balance: 300000, balance_type: "Dr" })],
      tbPY: [tb({ ledger_name: "Travelling Expenses", closing_balance: 100000, balance_type: "Dr" })],
    });
    expect(found).toHaveLength(1);
    expect(found[0].evidence?.ratio_pct).toBe(300);
  });
  it("does not flag a modest increase", () => {
    const found = run(r, {
      tb: [tb({ ledger_name: "Travelling Expenses", closing_balance: 120000, balance_type: "Dr" })],
      tbPY: [tb({ ledger_name: "Travelling Expenses", closing_balance: 100000, balance_type: "Dr" })],
    });
    expect(found).toHaveLength(0);
  });
  it("emits an advisory when prior-year TB is missing", () => {
    const found = run(r, { tb: [tb({ ledger_name: "Travelling Expenses", closing_balance: 300000, balance_type: "Dr" })] });
    expect(found).toHaveLength(1);
    expect(found[0].advisory).toBe(true);
  });
});

describe("capital_change", () => {
  const r = rule({ rule_id: "CAP-001", category: "CAP", detection_level: "account", detection_logic: { check: "capital_change" } });
  it("flags a change in share capital vs prior year", () => {
    const found = run(r, {
      tb: [tb({ ledger_name: "Equity Share Capital", closing_balance: 5000000, balance_type: "Cr" })],
      tbPY: [tb({ ledger_name: "Equity Share Capital", closing_balance: 1000000, balance_type: "Cr" })],
    });
    expect(found).toHaveLength(1);
  });
  it("does not flag when capital is unchanged", () => {
    const found = run(r, {
      tb: [tb({ ledger_name: "Equity Share Capital", closing_balance: 1000000, balance_type: "Cr" })],
      tbPY: [tb({ ledger_name: "Equity Share Capital", closing_balance: 1000000, balance_type: "Cr" })],
    });
    expect(found).toHaveLength(0);
  });
});

describe("capital_in_expense & cash_capital_payment", () => {
  it("capital_in_expense flags a machinery purchase booked as expense", () => {
    const r = rule({ rule_id: "FA-001", category: "FA", threshold_value: 100000, detection_logic: { check: "capital_in_expense", threshold: 100000 } });
    const found = run(r, { vouchers: [vch({ amount: 150000, dr_cr: "Dr", voucher_date: "2025-07-01", ledger_name: "Repairs", narration: "New machinery purchased" })] });
    expect(found).toHaveLength(1);
  });
  it("cash_capital_payment flags a cash payment for equipment", () => {
    const r = rule({ rule_id: "CASH-004", category: "CASH", threshold_value: 10000, detection_logic: { check: "cash_capital_payment", threshold: 10000 } });
    const found = run(r, { vouchers: [vch({ amount: 25000, dr_cr: "Dr", voucher_date: "2025-07-01", ledger_name: "Cash", narration: "Office equipment" })] });
    expect(found).toHaveLength(1);
  });
});

describe("default handlers include Tier B", () => {
  it("exposes 8 Tier B kinds and runs them by default", () => {
    expect(TIER_B_CHECK_KINDS).toHaveLength(8);
    const r = rule({ rule_id: "PROV-003", category: "PROV", detection_level: "account", detection_logic: { check: "missing_provision", keywords: ["warranty"] } });
    const res = runDetection([r], { tb: [tb({ ledger_name: "Sales", closing_balance: 1, balance_type: "Cr" })], vouchers: [] }, FY);
    expect(res.coverage.rulesHandled).toBe(1);
    expect(res.findings.some((f) => f.rule_id === "PROV-003" && !f.advisory)).toBe(true);
  });
});

describe("expr — generic composable evaluator", () => {
  it("voucher grain: scope + where flags matching vouchers only", () => {
    const r = rule({
      rule_id: "GEN-001",
      detection_logic: { check: "expr", grain: "voucher", scope: { cash_only: true }, where: [{ field: "abs_amount", op: ">", value: 10000 }] },
      audit_query_template: "Cash {amount} on {date}",
    });
    const out = run(r, {
      vouchers: [
        vch({ amount: 15000, voucher_date: "2025-06-01", party_ledger: "Cash", ledger_name: "Cash" }),
        vch({ amount: 5000, voucher_date: "2025-06-02", party_ledger: "Cash" }),
        vch({ amount: 99999, voucher_date: "2025-06-03", party_ledger: "HDFC Bank" }),
      ],
    });
    expect(out).toHaveLength(1);
    expect(out[0].amount).toBe(15000);
  });

  it("account grain: signed closing + keyword scope", () => {
    const r = rule({
      rule_id: "GEN-002",
      detection_logic: { check: "expr", grain: "account", scope: { ledger_keywords: ["creditor"], nonzero: true }, where: [{ field: "closing", op: ">", value: 0 }] },
    });
    const out = run(r, {
      tb: [
        tb({ ledger_name: "ABC Creditor", parent_group: "Sundry Creditors", closing_balance: 5000, balance_type: "Dr" }),
        tb({ ledger_name: "XYZ Creditor", parent_group: "Sundry Creditors", closing_balance: 8000, balance_type: "Cr" }),
      ],
    });
    expect(out.map((f) => f.account)).toEqual(["ABC Creditor"]);
  });

  it("aggregate grain: per-party-per-year sum over threshold", () => {
    const r = rule({
      rule_id: "GEN-003",
      detection_logic: { check: "expr", grain: "aggregate", scope: { side: "Dr" }, aggregate: { by: ["party", "year"], fn: "sum", field: "abs_amount", having: { op: ">", value: 100000 } } },
      audit_query_template: "{account} total {amount}",
    });
    const out = run(r, {
      vouchers: [
        vch({ amount: 60000, voucher_date: "2025-06-01", party_ledger: "Vendor A", dr_cr: "Dr" }),
        vch({ amount: 50000, voucher_date: "2025-07-01", party_ledger: "Vendor A", dr_cr: "Dr" }),
        vch({ amount: 40000, voucher_date: "2025-06-01", party_ledger: "Vendor B", dr_cr: "Dr" }),
      ],
    });
    expect(out).toHaveLength(1);
    expect(out[0].account).toBe("Vendor A");
    expect(out[0].amount).toBe(110000);
  });

  it("aggregate count: duplicate party+amount+date groups", () => {
    const r = rule({
      rule_id: "GEN-004",
      detection_logic: { check: "expr", grain: "aggregate", aggregate: { by: ["party", "amount", "date"], fn: "count", having: { op: ">", value: 1 } } },
      audit_query_template: "Duplicate {amount} x{count}",
    });
    const out = run(r, {
      vouchers: [
        vch({ amount: 5000, voucher_date: "2025-06-01", party_ledger: "P" }),
        vch({ amount: 5000, voucher_date: "2025-06-01", party_ledger: "P" }),
        vch({ amount: 5000, voucher_date: "2025-06-02", party_ledger: "P" }),
      ],
    });
    expect(out).toHaveLength(1);
  });
});

describe("expr — parent_group scoping on the voucher path (RC1)", () => {
  const creditorTB = [
    tb({ ledger_name: "Sevenseas Global Freight Systems Pvt. Ltd.", parent_group: "Sundry Creditors" }),
    tb({ ledger_name: "JRC Transport Company", parent_group: "Sundry Creditors" }),
    tb({ ledger_name: "HDFC Bank C/A", parent_group: "Bank Accounts" }),
  ];

  it('ledger_keywords ["creditor"] now matches a party grouped under "Sundry Creditors" (word absent from the party name)', () => {
    const r = rule({
      rule_id: "TDS-001", category: "TDS",
      detection_logic: { check: "expr", grain: "aggregate", scope: { ledger_keywords: ["creditor"], side: "Dr" }, aggregate: { by: ["party"], fn: "sum", field: "abs_amount", having: { op: ">", value: 0 } } },
    });
    const out = run(r, {
      tb: creditorTB,
      vouchers: [
        vch({ amount: 31490, voucher_date: "2025-07-26", party_ledger: "Sevenseas Global Freight Systems Pvt. Ltd.", dr_cr: "Dr" }),
        vch({ amount: 12000, voucher_date: "2025-08-01", party_ledger: "HDFC Bank C/A", dr_cr: "Dr" }),
      ],
    });
    // Sevenseas (a Sundry Creditor) is now in scope; the bank payment is not.
    expect(out).toHaveLength(1);
    expect(out[0].account).toBe("Sevenseas Global Freight Systems Pvt. Ltd.");
  });

  it("matches ZERO when the party's group is unknown (reproduces the old bug: 0 findings)", () => {
    const r = rule({
      rule_id: "TDS-002", category: "TDS",
      detection_logic: { check: "expr", grain: "voucher", scope: { ledger_keywords: ["creditor"] } },
    });
    // no TB -> no group resolution -> "creditor" cannot match the party name alone
    const out = run(r, { tb: [], vouchers: [vch({ amount: 31490, voucher_date: "2025-07-26", party_ledger: "Sevenseas Global Freight Systems Pvt. Ltd." })] });
    expect(out).toHaveLength(0);
  });

  it("explicit parent_group_keywords scopes precisely to the family", () => {
    const r = rule({
      rule_id: "CRED-010", category: "CRED",
      detection_logic: { check: "expr", grain: "voucher", scope: { parent_group_keywords: ["sundry creditors"] } },
    });
    const out = run(r, {
      tb: creditorTB,
      vouchers: [
        vch({ amount: 100, voucher_date: "2025-07-26", party_ledger: "JRC Transport Company" }),
        vch({ amount: 200, voucher_date: "2025-07-27", party_ledger: "HDFC Bank C/A" }),
      ],
    });
    expect(out.map((f) => f.account)).toEqual(["JRC Transport Company"]);
  });
});

describe("run ledger — completeness accounting (no rule silently dropped)", () => {
  it("reports executed / needs_data / skipped_no_handler per rule", () => {
    const rExec = rule({ rule_id: "CASH-X", category: "CASH", detection_logic: { check: "single_txn", threshold: 10000 } });
    const rNoHandler = rule({ rule_id: "ZZZ-1", detection_logic: { check: "nonexistent_check" } });
    const rNeedsData = rule({ rule_id: "RAT-X", detection_level: "account", detection_logic: { check: "expr", grain: "account", vs_prior_year: { op: ">=", pct: 200 } } });
    const res = runDetection(
      [rExec, rNoHandler, rNeedsData],
      { tb: [tb({ ledger_name: "X", closing_balance: 5000 })], vouchers: [vch({ amount: 20000, voucher_date: "2025-06-01", party_ledger: "Cash", ledger_name: "Cash", dr_cr: "Dr" })] },
      FY,
      { emitAdvisoryForUnhandled: false },
    );
    const byId = Object.fromEntries(res.ledger.map((l) => [l.rule_id, l]));
    expect(res.ledger).toHaveLength(3);
    expect(byId["CASH-X"].status).toBe("executed");
    expect(byId["CASH-X"].found).toBe(1);
    expect(byId["ZZZ-1"].status).toBe("skipped_no_handler");
    expect(byId["RAT-X"].status).toBe("needs_data");
  });
});
