import { describe, it, expect } from "vitest";
import {
  runDetection,
  TIER_A_HANDLERS,
  TIER_A_CHECK_KINDS,
  TIER_B_CHECK_KINDS,
  type ScrutinyRule,
  type TBRow,
  type VoucherRow,
  type FaAssetRow,
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
const run = (r: ScrutinyRule, data: { tb?: TBRow[]; vouchers?: VoucherRow[]; tbPY?: TBRow[]; fa?: FaAssetRow[] }, ctx: ScrutinyContext = FY) =>
  runDetection([r], { tb: data.tb ?? [], vouchers: data.vouchers ?? [], tbPY: data.tbPY, fa: data.fa }, ctx, { emitAdvisoryForUnhandled: false }).findings;

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

describe("cotag — GST intra/inter co-tagging (line_items)", () => {
  it("flags a party carrying both CGST/SGST and IGST legs; leaves a single-tax party alone", () => {
    const r = rule({
      rule_id: "GST-001", category: "GST",
      detection_logic: { check: "cotag", sets: [["cgst", "sgst"], ["igst"]] },
      audit_query_template: "{account} carries both intra and inter-state GST",
    });
    const out = run(r, {
      vouchers: [
        vch({ amount: 118000, voucher_date: "2025-06-01", party_ledger: "Acme Traders", line_items: [
          { ledger_name: "Output CGST@9%", dr_cr: "Cr", amount: 9000 },
          { ledger_name: "Output SGST@9%", dr_cr: "Cr", amount: 9000 },
        ] }),
        vch({ amount: 118000, voucher_date: "2025-08-01", party_ledger: "Acme Traders", line_items: [
          { ledger_name: "Output IGST@18%", dr_cr: "Cr", amount: 18000 },
        ] }),
        vch({ amount: 59000, voucher_date: "2025-06-01", party_ledger: "Beta Co", line_items: [
          { ledger_name: "Output CGST@9%", dr_cr: "Cr", amount: 4500 },
          { ledger_name: "Output SGST@9%", dr_cr: "Cr", amount: 4500 },
        ] }),
      ],
    });
    expect(out).toHaveLength(1);
    expect(out[0].account).toBe("Acme Traders");
  });
});

describe("stream_gap — money moved, nothing booked (line_items)", () => {
  it("flags a debtor with only a bank leg and no sales leg", () => {
    const r = rule({
      rule_id: "DEBT-020", category: "DEBT",
      detection_logic: { check: "stream_gap", scope: { parent_group_keywords: ["debtor"] }, present: ["bank", "cash"], missing: ["sales", "income"] },
      audit_query_template: "{account}: receipts booked but no sales",
    });
    const out = run(r, {
      tb: [
        tb({ ledger_name: "Ghost Debtor", parent_group: "Sundry Debtors" }),
        tb({ ledger_name: "Real Debtor", parent_group: "Sundry Debtors" }),
      ],
      vouchers: [
        vch({ amount: 50000, voucher_date: "2025-06-01", party_ledger: "Ghost Debtor", line_items: [
          { ledger_name: "HDFC Bank", dr_cr: "Dr", amount: 50000 },
          { ledger_name: "Ghost Debtor", dr_cr: "Cr", amount: 50000 },
        ] }),
        vch({ amount: 40000, voucher_date: "2025-06-01", party_ledger: "Real Debtor", line_items: [
          { ledger_name: "Sales GST@18%", dr_cr: "Cr", amount: 40000 },
          { ledger_name: "Real Debtor", dr_cr: "Dr", amount: 40000 },
        ] }),
      ],
    });
    expect(out.map((f) => f.account)).toEqual(["Ghost Debtor"]);
  });
});

describe("ageing — outstanding balance with no recent activity", () => {
  it("flags an aged creditor (no activity > 365d), not one with recent activity, and skips sub-threshold balances", () => {
    const r = rule({
      rule_id: "CRED-AGE", category: "CRED", detection_level: "account",
      detection_logic: { check: "ageing", scope: { parent_group_keywords: ["creditor"] }, days: 365, min_balance: 1000 },
      audit_query_template: "Creditor {account} balance {amount} outstanding {count} days with no activity",
    });
    const out = run(r, {
      tb: [
        tb({ ledger_name: "Old Vendor", parent_group: "Sundry Creditors", closing_balance: 50000, balance_type: "Cr" }),
        tb({ ledger_name: "Active Vendor", parent_group: "Sundry Creditors", closing_balance: 40000, balance_type: "Cr" }),
        tb({ ledger_name: "Tiny Vendor", parent_group: "Sundry Creditors", closing_balance: 500, balance_type: "Cr" }),
      ],
      vouchers: [
        vch({ amount: 50000, voucher_date: "2024-06-01", party_ledger: "Old Vendor" }),
        vch({ amount: 40000, voucher_date: "2026-03-01", party_ledger: "Active Vendor" }),
      ],
    });
    expect(out.map((f) => f.account)).toEqual(["Old Vendor"]);
    expect(out[0].amount).toBe(50000);
  });

  it("treats a creditor with a balance but zero activity as fully aged", () => {
    const r = rule({
      rule_id: "CRED-AGE2", category: "CRED", detection_level: "account",
      detection_logic: { check: "ageing", scope: { parent_group_keywords: ["creditor"] }, days: 180 },
      audit_query_template: "Aged: {account}",
    });
    const out = run(r, { tb: [tb({ ledger_name: "Dormant Vendor", parent_group: "Sundry Creditors", closing_balance: 20000, balance_type: "Cr" })], vouchers: [] });
    expect(out).toHaveLength(1);
    expect(out[0].account).toBe("Dormant Vendor");
  });
});

describe("ratio — computed financial ratios over the TB", () => {
  it("flags current ratio below 1 (raw ratio)", () => {
    const r = rule({
      rule_id: "RAT-003", category: "RAT", detection_level: "account",
      detection_logic: { check: "ratio", numerator: { parent_group_keywords: ["current asset"] }, denominator: { parent_group_keywords: ["current liabilit"] }, op: "<", value: 1, as_pct: false, label: "Current ratio" },
      audit_query_template: "Current ratio {ratio} is below 1",
    });
    const out = run(r, { tb: [
      tb({ ledger_name: "Debtors", parent_group: "Current Assets", closing_balance: 80000, balance_type: "Dr" }),
      tb({ ledger_name: "Creditors", parent_group: "Current Liabilities", closing_balance: 100000, balance_type: "Cr" }),
    ] });
    expect(out).toHaveLength(1);
    expect(out[0].evidence?.ratio).toBe(0.8);
  });

  it("flags misc expenses over 2% of total expenses (percent)", () => {
    const r = rule({
      rule_id: "EXP-007", category: "EXP", detection_level: "account",
      detection_logic: { check: "ratio", numerator: { ledger_keywords: ["miscellaneous"] }, denominator: { parent_group_keywords: ["expense"] }, op: ">", pct: 2, min_denominator: 1000 },
      audit_query_template: "Misc expenses are {pct}% of total expenses",
    });
    const out = run(r, { tb: [
      tb({ ledger_name: "Miscellaneous Expenses", parent_group: "Indirect Expenses", closing_balance: 5000, balance_type: "Dr" }),
      tb({ ledger_name: "Salaries", parent_group: "Indirect Expenses", closing_balance: 90000, balance_type: "Dr" }),
      tb({ ledger_name: "Rent", parent_group: "Indirect Expenses", closing_balance: 5000, balance_type: "Dr" }),
    ] });
    expect(out).toHaveLength(1);
    expect(out[0].evidence?.ratio).toBe(5);
  });

  it("does not flag a healthy ratio and guards against a tiny/zero denominator", () => {
    const healthy = rule({ rule_id: "RAT-003b", detection_level: "account", detection_logic: { check: "ratio", numerator: { parent_group_keywords: ["current asset"] }, denominator: { parent_group_keywords: ["current liabilit"] }, op: "<", value: 1, as_pct: false } });
    expect(run(healthy, { tb: [tb({ ledger_name: "CA", parent_group: "Current Assets", closing_balance: 150000, balance_type: "Dr" }), tb({ ledger_name: "CL", parent_group: "Current Liabilities", closing_balance: 100000, balance_type: "Cr" })] })).toHaveLength(0);
    const noBase = rule({ rule_id: "EXP-007b", detection_level: "account", detection_logic: { check: "ratio", numerator: { ledger_keywords: ["misc"] }, denominator: { parent_group_keywords: ["nonexistent"] }, op: ">", pct: 2 } });
    expect(run(noBase, { tb: [tb({ ledger_name: "Misc", parent_group: "Indirect Expenses", closing_balance: 5000 })] })).toHaveLength(0);
  });
});

describe("fully_depreciated_in_use — fixed-asset register (data.fa)", () => {
  it("summarises fully-depreciated assets still in use, excluding disposed ones", () => {
    const r = rule({
      rule_id: "FA-006", category: "FA", detection_level: "account",
      detection_logic: { check: "fully_depreciated_in_use" },
      audit_query_template: "{count} fully-depreciated assets still in use (gross {amount}) - review continued use / impairment.",
    });
    const out = run(r, { fa: [
      { asset_name: "Laptop A", gross_block_closing: 60000, is_fully_depreciated: true, disposals_during_year: 0, disposal_date: null },
      { asset_name: "Printer B", gross_block_closing: 20000, is_fully_depreciated: true, disposals_during_year: 0, disposal_date: null },
      { asset_name: "Old Server (sold)", gross_block_closing: 90000, is_fully_depreciated: true, disposals_during_year: 90000, disposal_date: "2025-08-01" },
      { asset_name: "New Machine", gross_block_closing: 500000, is_fully_depreciated: false, disposals_during_year: 0, disposal_date: null },
    ] });
    expect(out).toHaveLength(1);
    expect(out[0].amount).toBe(80000); // 60000 + 20000 (sold + not-fully-dep excluded)
    expect(out[0].evidence?.count).toBe(2);
  });

  it("returns nothing when the FA register is absent or has no such assets", () => {
    const r = rule({ rule_id: "FA-006b", detection_logic: { check: "fully_depreciated_in_use" } });
    expect(run(r, {})).toHaveLength(0);
    expect(run(r, { fa: [{ asset_name: "X", gross_block_closing: 100, is_fully_depreciated: false }] })).toHaveLength(0);
  });
});

describe("tds_shortfall — precise per-party TDS coverage (line_items, deductee-aware)", () => {
  const R = rule({
    rule_id: "TDS-XLEG", category: "TDS", detection_level: "voucher",
    detection_logic: { check: "tds_shortfall", sections: [{ section: "194C", keywords: ["transport", "freight", "contractor"], rate: 0.02, individual_rate: 0.01, threshold: 30000 }], tolerance: 0.05 },
    audit_query_template: "{account}: TDS short by {amount} on 194C ({value} base @ {pct}%).",
  });

  it("reproduces the Sevenseas short (business @2%), excluding the party's own 'Freight' leg and GST", () => {
    const out = run(R, { vouchers: [
      vch({ amount: 200334, voucher_date: "2025-05-23", party_ledger: "Sevenseas Global Freight Systems Pvt. Ltd.", line_items: [
        { ledger_name: "Transportation-18%", dr_cr: "Dr", amount: 187511 },
        { ledger_name: "Transportation Charges-RCM", dr_cr: "Dr", amount: 21000 },
        { ledger_name: "INPUT IGST@18%", dr_cr: "Dr", amount: 12823 },
        { ledger_name: "Sevenseas Global Freight Systems Pvt. Ltd.", dr_cr: "Cr", amount: 200334 },
        { ledger_name: "TDS on Contractor U/s 94C", dr_cr: "Cr", amount: 3750 },
      ] }),
    ] });
    expect(out).toHaveLength(1);
    expect(out[0].account).toBe("Sevenseas Global Freight Systems Pvt. Ltd.");
    expect(out[0].evidence?.base).toBe(208511); // 187511 + 21000 (party 'Freight' leg + IGST excluded)
    expect(out[0].amount).toBe(420); // req 4170 @2% − actual 3750
  });

  it("does NOT flag an individual who correctly deducted 1%", () => {
    const out = run(R, { vouchers: [
      vch({ amount: 100000, voucher_date: "2025-06-01", party_ledger: "Kanubhai Bharwad", line_items: [
        { ledger_name: "Labour Charges Transport", dr_cr: "Dr", amount: 100000 },
        { ledger_name: "Kanubhai Bharwad", dr_cr: "Cr", amount: 99000 },
        { ledger_name: "TDS on Contractor U/s 94C", dr_cr: "Cr", amount: 1000 },
      ] }),
    ] });
    expect(out).toHaveLength(0);
  });

  it("flags a business transporter with zero TDS", () => {
    const out = run(R, { vouchers: [
      vch({ amount: 500000, voucher_date: "2025-06-01", party_ledger: "JRC Transport Company", line_items: [
        { ledger_name: "Freight Charges", dr_cr: "Dr", amount: 500000 },
        { ledger_name: "JRC Transport Company", dr_cr: "Cr", amount: 500000 },
      ] }),
    ] });
    expect(out).toHaveLength(1);
    expect(out[0].amount).toBe(10000);
  });
});

describe("ratio_change — year-on-year financial ratio movement (tb vs tbPY)", () => {
  it("flags a GP% decline of more than 5 points (numerator_less = Sales − COGS)", () => {
    const r = rule({
      rule_id: "RAT-001", category: "RAT", detection_level: "account",
      detection_logic: { check: "ratio_change", numerator: { parent_group_keywords: ["sales"] }, numerator_less: { parent_group_keywords: ["purchase"] }, denominator: { parent_group_keywords: ["sales"] }, as_pct: true, change_mode: "delta_pct_points", direction: "decline", threshold: 5, label: "GP %" },
      audit_query_template: "GP margin fell to {pct}% (from {value}%), a {count}-point drop.",
    });
    const out = run(r, {
      tb: [tb({ ledger_name: "Sales", parent_group: "Sales Accounts", closing_balance: 100000, balance_type: "Cr" }), tb({ ledger_name: "Purchases", parent_group: "Purchase Accounts", closing_balance: 91000, balance_type: "Dr" })],
      tbPY: [tb({ ledger_name: "Sales", parent_group: "Sales Accounts", closing_balance: 100000, balance_type: "Cr" }), tb({ ledger_name: "Purchases", parent_group: "Purchase Accounts", closing_balance: 84000, balance_type: "Dr" })],
    });
    expect(out).toHaveLength(1);
    expect(out[0].evidence?.cy_ratio).toBe(9); // (100000-91000)/100000
    expect(out[0].evidence?.py_ratio).toBe(16);
  });

  it("flags a D/E increase of more than 20% (relative)", () => {
    const r = rule({
      rule_id: "RAT-004", category: "RAT", detection_level: "account",
      detection_logic: { check: "ratio_change", numerator: { parent_group_keywords: ["loan"] }, denominator: { parent_group_keywords: ["capital"] }, change_mode: "relative", direction: "increase", threshold: 20 },
    });
    const out = run(r, {
      tb: [tb({ ledger_name: "Loan", parent_group: "Loans (Liability)", closing_balance: 100000, balance_type: "Cr" }), tb({ ledger_name: "Capital", parent_group: "Capital Account", closing_balance: 100000, balance_type: "Cr" })],
      tbPY: [tb({ ledger_name: "Loan", parent_group: "Loans (Liability)", closing_balance: 50000, balance_type: "Cr" }), tb({ ledger_name: "Capital", parent_group: "Capital Account", closing_balance: 100000, balance_type: "Cr" })],
    });
    expect(out).toHaveLength(1); // 1.0 vs 0.5 = +100%
  });

  it("does not flag a stable ratio, and emits an advisory when prior-year TB is absent", () => {
    const r = rule({ rule_id: "RAT-006", detection_level: "account", detection_logic: { check: "ratio_change", numerator: { parent_group_keywords: ["sales"] }, denominator: { parent_group_keywords: ["debtor"] }, change_mode: "relative", direction: "decline", threshold: 20 } });
    const stable = run(r, {
      tb: [tb({ ledger_name: "S", parent_group: "Sales Accounts", closing_balance: 100000 }), tb({ ledger_name: "D", parent_group: "Sundry Debtors", closing_balance: 20000 })],
      tbPY: [tb({ ledger_name: "S", parent_group: "Sales Accounts", closing_balance: 98000 }), tb({ ledger_name: "D", parent_group: "Sundry Debtors", closing_balance: 20000 })],
    });
    expect(stable).toHaveLength(0);
    const noPy = run(r, { tb: [tb({ ledger_name: "S", parent_group: "Sales Accounts", closing_balance: 100000 })] });
    expect(noPy).toHaveLength(1);
    expect(noPy[0].advisory).toBe(true);
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
