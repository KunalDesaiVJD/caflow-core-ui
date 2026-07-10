import { describe, it, expect } from "vitest";
import { partyFlows, flowEdges, moneyFlowSummary } from "./moneyFlow";
import type { VoucherRow } from "./detectionEngine";

const v = (amount: number, drCr: "Dr" | "Cr", party: string, ledger = "Bank"): VoucherRow => ({
  amount, dr_cr: drCr, party_ledger: party, ledger_name: ledger,
  voucher_date: "2024-05-01", voucher_number: null, voucher_type: null, narration: null,
});

describe("partyFlows", () => {
  it("aggregates value + Dr/Cr split + net + count per party", () => {
    const flows = partyFlows([
      v(1000, "Dr", "ABC Traders"),
      v(400, "Cr", "ABC Traders"),
      v(250, "Dr", "XYZ Ltd"),
    ]);
    const abc = flows.find((f) => f.party === "ABC Traders")!;
    expect(abc.total).toBe(1400);
    expect(abc.drTotal).toBe(1000);
    expect(abc.crTotal).toBe(400);
    expect(abc.net).toBe(-600); // cr - dr
    expect(abc.count).toBe(2);
    expect(flows[0].party).toBe("ABC Traders"); // largest total first
  });

  it("respects minAmount and skips empty parties", () => {
    const flows = partyFlows([v(50, "Dr", "Small"), v(50, "Dr", ""), v(9000, "Dr", "Big")], 1000);
    expect(flows.map((f) => f.party)).toEqual(["Big"]);
  });
});

describe("flowEdges", () => {
  it("aggregates ledger->party flows, largest first", () => {
    const edges = flowEdges([
      v(1000, "Dr", "ABC", "Bank"),
      v(500, "Dr", "ABC", "Bank"),
      v(2000, "Cr", "XYZ", "Sales"),
    ]);
    expect(edges[0]).toEqual({ from: "Sales", to: "XYZ", total: 2000, count: 1 });
    const bankAbc = edges.find((e) => e.from === "Bank" && e.to === "ABC")!;
    expect(bankAbc.total).toBe(1500);
    expect(bankAbc.count).toBe(2);
  });
});

describe("moneyFlowSummary", () => {
  it("summarises party count, total value and top-N", () => {
    const s = moneyFlowSummary([v(1000, "Dr", "A"), v(2000, "Cr", "B")], { topN: 1 });
    expect(s.parties).toBe(2);
    expect(s.totalValue).toBe(3000);
    expect(s.topParties).toHaveLength(1);
    expect(s.topParties[0].party).toBe("B"); // larger total
    expect(s.topEdges).toHaveLength(1);
  });
});
