import { describe, it, expect } from "vitest";
import { detectHeaderRow, gridToRows } from "./tdsImportParsing";

// Fixture shape mirrors a real client TDS export (structure only — no real
// client data): a company-name title row, a TAN/PAN summary strip, THEN the
// real header row, then deductee rows (one with both a "Date of Credit" and
// a separate challan-only "Date of Payment" column), a blank row, then an
// unrelated second table (transporter declarations under 194C(6)).
const REAL_SHAPE_GRID: unknown[][] = [
  ["Example Industries"],
  ["TAN", "XXXX00000X", null, "PAN", "XXXXX0000X"],
  ["Sr. No.", "Name", "DOB", "PAN", "Nature of Payment", "Date of Credit", "TDS Rate", "Amount", "Amount of TDS", "Interest", "Bank Name", "BSR Code", "Date of Payment", "CIN"],
  ["1", "Acme Traders", "5/21/87", "AACCP6899F", "393(1) 8(ii)", "5/31/26", "0.10%", " 5,558,172 ", " 5,558 ", " -   ", "HDFC Bank", "510002", "6/4/26", "24894"],
  ["2", "Beta Chemicals", "3/23/07", "AAGCA2480D", "393(1) 8(ii)", "6/30/26", "0.10%", " 732,750 ", " 733 ", " -   ", null, null, null, null],
  [],
  ["Transporter who have submitted declaration"],
  ["Sr. No.", "Name", null, "Date", "Amount"],
  ["1", "Gamma Logistics", null, "3-Apr-26", " 95,000 "],
];

describe("detectHeaderRow", () => {
  it("skips the title row and TAN/PAN strip to find the real header row", () => {
    expect(detectHeaderRow(REAL_SHAPE_GRID)).toBe(2);
  });

  it("falls back to row 0 for an already-clean file (headers on row 1)", () => {
    const clean = [
      ["Name", "PAN", "Date", "Amount", "TDS", "Section"],
      ["Acme", "AACCP6899F", "1/4/26", "1000", "100", "194C"],
    ];
    expect(detectHeaderRow(clean)).toBe(0);
  });
});

describe("gridToRows", () => {
  const rows = gridToRows(REAL_SHAPE_GRID);

  it("uses the real header row as keys, not the title row or TAN/PAN strip", () => {
    expect(Object.keys(rows[0])).toEqual([
      "Sr. No.", "Name", "DOB", "PAN", "Nature of Payment", "Date of Credit",
      "TDS Rate", "Amount", "Amount of TDS", "Interest", "Bank Name",
      "BSR Code", "Date of Payment", "CIN",
    ]);
  });

  it("stops at the first fully-blank row and excludes the second table", () => {
    expect(rows).toHaveLength(2);
    expect(rows.some(r => r["Name"] === "Gamma Logistics")).toBe(false);
  });

  it("keeps Date of Credit and the challan-only Date of Payment as separate columns", () => {
    expect(rows[0]["Date of Credit"]).toBe("5/31/26");
    expect(rows[0]["Date of Payment"]).toBe("6/4/26");
    // Second row has no challan info yet — Date of Payment genuinely blank,
    // Date of Credit still present. This is what the downstream column
    // mapper (tds-recon-import's guessColumnMapping) must pick correctly.
    expect(rows[1]["Date of Credit"]).toBe("6/30/26");
    expect(rows[1]["Date of Payment"]).toBeNull();
  });

  it("synthesises Column<N> keys for header cells with no label", () => {
    const grid = [
      ["Name", "PAN", null, "Amount"],
      ["Acme", "AACCP6899F", "extra", "1000"],
    ];
    const [row] = gridToRows(grid);
    expect(row["Column3"]).toBe("extra");
  });
});
