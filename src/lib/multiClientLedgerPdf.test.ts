import { describe, it, expect, vi } from "vitest";
import { drawClientSummaryTable, drawPaymentAdvice, paymentAdviceLines, firmBankDetailsOf } from "./multiClientLedgerPdf";

const fakeDoc = () => ({
  internal: { pageSize: { getHeight: () => 210 } },
  lastAutoTable: { finalY: 40 },
  setTextColor: vi.fn(), setFont: vi.fn(), setFontSize: vi.fn(), text: vi.fn(), addPage: vi.fn(),
});

describe("drawClientSummaryTable", () => {
  const rows = [{ name: "A", opening: 0, debit: 100, credit: 0, closing: 100 }, { name: "B", opening: 0, debit: 50, credit: 50, closing: 0 }];
  it("adds no total row unless asked — clients see only their own closing", () => {
    const autoTable = vi.fn();
    drawClientSummaryTable(fakeDoc(), autoTable, { startY: 20, rows });
    expect(autoTable.mock.calls[0][1].body).toHaveLength(2);
  });
  it("still adds the total row for internal reports that ask for it", () => {
    const autoTable = vi.fn();
    drawClientSummaryTable(fakeDoc(), autoTable, { startY: 20, rows, totalLabel: "TOTAL" });
    expect(autoTable.mock.calls[0][1].body).toHaveLength(3);
  });
});

describe("payment advice", () => {
  const rows = [
    { clientName: "Beta", firmId: "f2", firmName: "VJD Advisory LLP", closing: 2500 },
    { clientName: "Alpha", firmId: "f2", firmName: "VJD Advisory LLP", closing: -300 },
    { clientName: "Alpha", firmId: "f1", firmName: "V J Desai & Co. LLP", closing: 11800 },
    { clientName: "Alpha", firmId: "f3", firmName: "Other", closing: 0.2 },
  ];
  it("lists one line per client per firm, client then firm order, nil balances dropped", () => {
    const lines = paymentAdviceLines(rows);
    expect(lines.map(l => [l.clientName, l.firmName, l.payable, l.advance])).toEqual([
      ["Alpha", "V J Desai & Co. LLP", 11800, 0],
      ["Alpha", "VJD Advisory LLP", 0, 300],
      ["Beta", "VJD Advisory LLP", 2500, 0],
    ]);
  });
  it("prints the amount and the firm's own bank details on each line, client name once", () => {
    const autoTable = vi.fn();
    const banks = [
      firmBankDetailsOf({ id: "f1", name: "V J Desai & Co. LLP", bank_details: { bank_name: "HDFC Bank", account_number: "5020001", ifsc: "HDFC0000123" } })!,
      firmBankDetailsOf({ id: "f2", name: "VJD Advisory LLP", bank_details: { bank_name: "ICICI Bank", account_number: "1234", ifsc: "ICIC0001234" } })!,
    ];
    drawPaymentAdvice(fakeDoc(), autoTable, rows, banks);
    const body = autoTable.mock.calls[0][1].body;
    expect(body.map((r: string[]) => r[0])).toEqual(["Alpha", "", "Beta"]);
    expect(body[0].slice(1)).toEqual(["V J Desai & Co. LLP", "₹11,800.00", "HDFC Bank", "5020001", "HDFC0000123"]);
    expect(body[1][2]).toBe("Nil (advance ₹300.00)");
    expect(body[2][3]).toBe("ICICI Bank");
  });
  it("says nothing is payable instead of drawing an empty table", () => {
    const autoTable = vi.fn(); const doc = fakeDoc();
    drawPaymentAdvice(doc, autoTable, [{ clientName: "A", firmId: "f1", firmName: "F", closing: 0 }], []);
    expect(autoTable).not.toHaveBeenCalled();
    expect(doc.text.mock.calls.some((c: any[]) => String(c[0]).includes("No amount is payable"))).toBe(true);
  });
});
