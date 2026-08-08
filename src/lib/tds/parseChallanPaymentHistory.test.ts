/**
 * Fixture-based, same pattern as tallyPdf.test.ts: constructs PdfTextItem[]
 * pages directly rather than a real PDF file, so these run without pdfjs.
 *
 * NOTE: these fixtures are a best-effort reconstruction of the ITD Payment
 * History export's own layout (see parseChallanPaymentHistory.ts's own
 * header doc) — not copied from a real sample, since none was available
 * while building this. Expect to replace them with real-export fixtures
 * once one is uploaded.
 */
import { describe, it, expect } from "vitest";
import { parseChallanPaymentHistoryPages } from "./parseChallanPaymentHistory";
import type { PdfTextItem } from "./tallyPdf";

function challanRow(y: number, opts: { bsr: string; serial: string; date: string; amount: number }): PdfTextItem[] {
  return [
    { x: 40, y, w: 20, str: "1" }, // Sr. No. column
    { x: 80, y, w: 50, str: opts.bsr },
    { x: 150, y, w: 40, str: opts.serial },
    { x: 210, y, w: 60, str: opts.date },
    { x: 300, y, w: 80, str: "TDS Payment" },
    { x: 420, y, w: 70, str: opts.amount.toLocaleString("en-IN", { minimumFractionDigits: 2 }) },
  ];
}

describe("parseChallanPaymentHistoryPages", () => {
  it("extracts serial, date, and amount from a challan row (BSR+serial CIN convention)", () => {
    const page = challanRow(700, { bsr: "0123456", serial: "347", date: "07-07-2026", amount: 10523.79 });
    const rows = parseChallanPaymentHistoryPages([page]);
    expect(rows).toEqual([{ serialNo: "347", depositDate: "2026-07-07", amount: 10523.79 }]);
  });

  it("parses a dd-mmm-yyyy date", () => {
    const page = challanRow(700, { bsr: "0123456", serial: "12", date: "07-Jul-2026", amount: 500 });
    const rows = parseChallanPaymentHistoryPages([page]);
    expect(rows[0].depositDate).toBe("2026-07-07");
  });

  it("groups multiple rows independently by y-band", () => {
    const page = [
      ...challanRow(700, { bsr: "0123456", serial: "1", date: "01-04-2026", amount: 1000 }),
      ...challanRow(650, { bsr: "0123456", serial: "2", date: "02-04-2026", amount: 2000 }),
    ];
    const rows = parseChallanPaymentHistoryPages([page]);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.serialNo).sort()).toEqual(["1", "2"]);
  });

  it("ignores a header/footer row with no date or amount", () => {
    const page: PdfTextItem[] = [
      { x: 40, y: 750, w: 60, str: "Sr. No." },
      { x: 150, y: 750, w: 60, str: "Challan No." },
      { x: 300, y: 750, w: 60, str: "Amount" },
    ];
    expect(parseChallanPaymentHistoryPages([page])).toEqual([]);
  });

  it("returns [] for a page with no challan-shaped rows", () => {
    expect(parseChallanPaymentHistoryPages([[]])).toEqual([]);
  });
});
