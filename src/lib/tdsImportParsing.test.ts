import { describe, it, expect } from "vitest";
import { detectHeaderRow, gridToRows, isTwoSheetTemplate, joinChallanTemplate } from "./tdsImportParsing";

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

// The official two-sheet TDS import template ("Challan Details" + "TDS
// Entries", structure only — no real client data): headers carry the
// template's trailing "*" required-field marker, mirroring the real file.
const CHALLAN_GRID: unknown[][] = [
  ["Challan ID*", "BSR Code*", "Challan Serial No.*", "Date of Deposit*", "Total Challan Amount (Rs)*", "Bank Name", "Remarks"],
  ["CH-Q1-001", "0510002", "24894", "31-05-2026", "6,558", "HDFC Bank", "May payments"],
  ["CH-Q1-002", "0510002", "38051", "30-06-2026", "4,491", "HDFC Bank", "June payments"],
];
const ENTRY_GRID: unknown[][] = [
  ["Sr. No.", "Challan ID*", "Deductee Name*", "PAN*", "Section*", "Date of Payment/Credit*", "Amount Paid/Credited (Rs)*", "Rate of TDS (%)*", "TDS Amount (Rs)*", "Interest (Rs)", "Remarks"],
  ["1", "CH-Q1-001", "Acme Traders", "AACCP6899F", "194C", "31-05-2026", "5,558,172", "0.10", "5,558", "-", ""],
  ["2", " ch-q1-001 ", "Beta Chemicals", "AAGCA2480D", "194C", "31-05-2026", "500,000", "0.20", "1,000", "-", ""], // same challan, different case/whitespace
  ["3", "CH-Q1-002", "Gamma Industries", "AAGCG2480D", "194J", "30-06-2026", "732,750", "0.10", "733", "-", ""],
  ["4", "CH-UNKNOWN-999", "Delta Corp", "AADCD1234E", "194C", "30-06-2026", "100,000", "0.10", "100", "-", ""], // no matching challan
];

describe("isTwoSheetTemplate", () => {
  it("detects the official template by exact tab name (case/whitespace-insensitive)", () => {
    expect(isTwoSheetTemplate(["Instructions", "Challan Details", "TDS Entries"]))
      .toEqual({ challanSheet: "Challan Details", entriesSheet: "TDS Entries" });
  });

  it("still detects when the tab names differ only in case or surrounding whitespace", () => {
    expect(isTwoSheetTemplate(["  challan details ", "TDS ENTRIES"]))
      .toEqual({ challanSheet: "  challan details ", entriesSheet: "TDS ENTRIES" });
  });

  it("does not detect an unrelated multi-sheet workbook (one sheet per TDS section)", () => {
    expect(isTwoSheetTemplate(["194C", "194J", "194Q"])).toBeNull();
  });

  it("does not detect an ordinary single-sheet workbook", () => {
    expect(isTwoSheetTemplate(["Sheet1"])).toBeNull();
  });

  it("does not detect a workbook with only ONE of the two required sheets", () => {
    expect(isTwoSheetTemplate(["Challan Details", "Sheet1"])).toBeNull();
    expect(isTwoSheetTemplate(["TDS Entries", "Sheet1"])).toBeNull();
  });
});

describe("joinChallanTemplate", () => {
  const challanRows = gridToRows(CHALLAN_GRID);
  const entryRows = gridToRows(ENTRY_GRID);
  const joined = joinChallanTemplate(challanRows, entryRows);

  it("resolves BSR Code and Challan No for an entry whose Challan ID matches", () => {
    expect(joined[0]["BSR Code"]).toBe("0510002");
    expect(joined[0]["Challan No"]).toBe("24894");
  });

  it("resolves a Challan ID that differs only in case/whitespace from the Challan Details row", () => {
    expect(joined[1]["Challan ID*"]).toBe(" ch-q1-001 "); // original value untouched
    expect(joined[1]["BSR Code"]).toBe("0510002");
    expect(joined[1]["Challan No"]).toBe("24894");
  });

  it("one challan with multiple linked entries: both resolve to the same BSR/Challan No", () => {
    expect(joined[0]["BSR Code"]).toBe(joined[1]["BSR Code"]);
    expect(joined[0]["Challan No"]).toBe(joined[1]["Challan No"]);
  });

  it("resolves a second, distinct challan correctly", () => {
    expect(joined[2]["BSR Code"]).toBe("0510002");
    expect(joined[2]["Challan No"]).toBe("38051");
  });

  it("passes an unmatched Challan ID through UNCHANGED — no BSR Code/Challan No keys injected", () => {
    const unmatched = joined[3];
    expect(unmatched["Challan ID*"]).toBe("CH-UNKNOWN-999");
    expect("BSR Code" in unmatched).toBe(false);
    expect("Challan No" in unmatched).toBe(false);
    // Every other field is passed through untouched.
    expect(unmatched).toEqual(entryRows[3]);
  });

  it("preserves every original entry field alongside the two added keys", () => {
    expect(joined[0]).toMatchObject({
      "Sr. No.": "1",
      "Deductee Name*": "Acme Traders",
      "PAN*": "AACCP6899F",
      "Section*": "194C",
    });
  });

  it("is a no-op (returns entry rows unchanged) when Challan Details has no Challan ID column", () => {
    const noIdChallanRows = gridToRows([
      ["BSR Code*", "Challan Serial No.*"],
      ["0510002", "24894"],
    ]);
    const result = joinChallanTemplate(noIdChallanRows, entryRows);
    expect(result).toEqual(entryRows);
  });
});
