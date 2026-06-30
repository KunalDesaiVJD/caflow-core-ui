import { describe, it, expect } from "vitest";
import {
  runDetection,
  TIER_A_HANDLERS,
  TIER_A_CHECK_KINDS,
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
const run = (r: ScrutinyRule, data: { tb?: TBRow[]; vouchers?: VoucherRow[] }, ctx: ScrutinyContext = FY) =>
  runDetection([r], { tb: data.tb ?? [], vouchers: data.vouchers ?? [] }, ctx, { emitAdvisoryForUnhandled: false }).findings;

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
});
