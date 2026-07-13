import { describe, it, expect } from "vitest";
import {
  parseDetectionLogic,
  ruleFromRow,
  rulesFromRows,
  tbFromSnapshot,
  vouchersFromSnapshot,
  findingToRow,
  type ScrutinyRuleRow,
} from "./adapters";
import { runDetection } from "./detectionEngine";

describe("parseDetectionLogic", () => {
  it("parses a JSON string, passes through an object, and defaults safely", () => {
    expect(parseDetectionLogic('{"check":"daily_max","threshold":200000}')).toEqual({ check: "daily_max", threshold: 200000 });
    expect(parseDetectionLogic({ check: "single_txn" })).toEqual({ check: "single_txn" });
    expect(parseDetectionLogic("not json")).toEqual({ check: "" });
    expect(parseDetectionLogic(null)).toEqual({ check: "" });
  });
});

describe("ruleFromRow / rulesFromRows", () => {
  it("maps a DB rule row, parsing detection_logic and coercing the threshold", () => {
    const row: ScrutinyRuleRow = {
      rule_id: "CASH-002",
      rule_name: "Single Cash Payment >20k",
      category: "CASH",
      detection_level: "voucher",
      detection_logic: '{"check":"single_txn","direction":"debit","threshold":20000}',
      threshold_value: "20000",
      severity: "high",
      audit_query_template: "Cash payment {amount}",
      legal_reference: "Section 40A(3)",
    };
    const r = ruleFromRow(row);
    expect(r.detection_logic.check).toBe("single_txn");
    expect(r.threshold_value).toBe(20000);
    expect(r.category).toBe("CASH");
  });

  it("drops inactive rules and defaults category from the rule_id prefix", () => {
    const rows: ScrutinyRuleRow[] = [
      { rule_id: "BKR-001", detection_logic: { check: "sign_reversal" }, is_active: true },
      { rule_id: "BKR-002", detection_logic: { check: "keyword_balance" }, is_active: false },
    ];
    const mapped = rulesFromRows(rows);
    expect(mapped).toHaveLength(1);
    expect(mapped[0].category).toBe("BKR");
  });
});

describe("tbFromSnapshot", () => {
  it("derives closing_balance + balance_type from dr/cr, with account_name/account_group fallbacks", () => {
    const tb = tbFromSnapshot([
      { account_name: "Sundry Creditors — X", account_group: "Sundry Creditors", debit: 0, credit: 50000 },
      { ledger_name: "Bank — HDFC", closing_dr: 120000, closing_cr: 0 },
    ]);
    expect(tb[0]).toMatchObject({ ledger_name: "Sundry Creditors — X", parent_group: "Sundry Creditors", closing_balance: 50000, balance_type: "Cr" });
    expect(tb[1]).toMatchObject({ ledger_name: "Bank — HDFC", closing_balance: 120000, balance_type: "Dr" });
  });
});

describe("vouchersFromSnapshot", () => {
  it("maps amount/date/debit_credit and ledger/party fallbacks", () => {
    const v = vouchersFromSnapshot([
      { amount: "25000", debit_credit: "debit", date: "2025-06-10", ledger_name: "Cash", narration: "Vendor payment" },
    ]);
    expect(v[0]).toMatchObject({ amount: 25000, dr_cr: "debit", voucher_date: "2025-06-10", ledger_name: "Cash" });
  });

  it("preserves line_items (the full double entry) instead of flattening it away", () => {
    const v = vouchersFromSnapshot([
      {
        amount: 200334, dr_cr: "Cr", voucher_date: "2025-05-23", party_ledger: "Sevenseas Global Freight Systems Pvt. Ltd.",
        line_items: [
          { ledger_name: "Transportation-18%", dr_cr: "Dr", amount: 187511 },
          { ledger_name: "INPUT IGST@18%", dr_cr: "Dr", amount: 12823 },
          { ledger_name: "Sevenseas Global Freight Systems Pvt. Ltd.", dr_cr: "Cr", amount: 200334 },
        ],
      },
    ]);
    expect(v[0].line_items).toHaveLength(3);
    expect(v[0].line_items?.[0]).toMatchObject({ ledger_name: "Transportation-18%", dr_cr: "Dr", amount: 187511 });
  });

  it("leaves line_items undefined when absent (snapshot raw_data has none)", () => {
    const v = vouchersFromSnapshot([{ amount: 100, date: "2025-06-10" }]);
    expect(v[0].line_items).toBeUndefined();
  });
});

describe("findingToRow", () => {
  it("uppercases severity and stamps client/FY/status", () => {
    const row = findingToRow(
      { rule_id: "BKR-002", rule_name: "Suspense", category: "BKR", severity: "high", flag_message: "msg", detection_level: "account", account: "Suspense A/c" },
      { client_id: "c1", financial_year: "2025-26" },
    );
    expect(row).toMatchObject({ client_id: "c1", financial_year: "2025-26", status: "open", severity: "HIGH", narration: "Suspense A/c" });
  });
});

describe("end-to-end pure pipeline (DB rows -> engine -> finding rows)", () => {
  it("runs the interpreter over snapshot-shaped data and emits insertable rows", () => {
    const ruleRows: ScrutinyRuleRow[] = [
      { rule_id: "BKR-002", category: "BKR", detection_level: "account", severity: "high", audit_query_template: 'Suspense "{account}" has Rs {amount}', detection_logic: '{"check":"keyword_balance","keywords":["suspense"],"nonzero":true}', is_active: true },
      { rule_id: "CASH-002", category: "CASH", detection_level: "voucher", severity: "high", audit_query_template: "Cash payment Rs {amount} on {date}", threshold_value: 20000, detection_logic: '{"check":"single_txn","direction":"debit","threshold":20000}', is_active: true },
    ];
    const normalised = [
      { account_name: "Suspense A/c", account_group: "Current Assets", debit: 1200, credit: 0 },
      { account_name: "Bank — HDFC", account_group: "Bank Accounts", debit: 90000, credit: 0 },
    ];
    const raw = [
      { amount: 25000, debit_credit: "debit", date: "2025-06-10", ledger_name: "Cash", narration: "cash to vendor" },
    ];

    const rules = rulesFromRows(ruleRows);
    const res = runDetection(rules, { tb: tbFromSnapshot(normalised), vouchers: vouchersFromSnapshot(raw) }, { financialYearEnd: "2026-03-31" }, { emitAdvisoryForUnhandled: false });
    const rows = res.findings.map((f) => findingToRow(f, { client_id: "c1", financial_year: "2025-26" }));

    expect(res.findings).toHaveLength(2);
    expect(rows.map((r) => r.rule_id).sort()).toEqual(["BKR-002", "CASH-002"]);
    expect(rows.every((r) => r.severity === "HIGH" && r.status === "open" && r.client_id === "c1")).toBe(true);
    const cash = rows.find((r) => r.rule_id === "CASH-002")!;
    expect(cash.flag_message).toContain("25,000");
  });
});
