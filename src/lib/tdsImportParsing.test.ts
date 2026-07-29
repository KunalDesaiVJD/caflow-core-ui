import { describe, it, expect } from "vitest";
import { detectHeaderRow, gridToRows, isTwoSheetTemplate, joinChallanTemplate, TEMPLATE_EXAMPLE_CHALLAN_ID, extractSheetRows, extractWorkbookRows, TEMPLATE_EXAMPLE_ROW_SENTINEL, isChallanBlockTemplate, explodeChallanBlockTemplate } from "./tdsImportParsing";

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

// Regression: the template ships with a gray "worked example" row (row 4 on
// both sheets) pre-filled with a realistic-looking deductee — a real name,
// PAN, and amount — so a client can see the expected format. The in-sheet
// note tells them to delete it, but nothing enforces that, and left in place
// it is indistinguishable from real data by content alone. Confirms it is
// dropped unconditionally by its reserved Challan ID, whether or not the
// client removed it, whether alone or alongside genuine rows.
describe("joinChallanTemplate — worked-example row exclusion", () => {
  const challanGridWithExample: unknown[][] = [
    ["Challan ID*", "BSR Code*", "Challan Serial No.*", "Date of Deposit*", "Total Challan Amount (Rs)*", "Bank Name", "Remarks"],
    [TEMPLATE_EXAMPLE_CHALLAN_ID, "0510002", "24894", "04-06-2026", "5,558", "HDFC Bank", "Q1 salary TDS"],
    ["CH-REAL-001", "0640123", "99887", "07-07-2026", "2,500", "ICICI Bank", ""],
  ];
  const entryGridWithExample: unknown[][] = [
    ["Sr. No.", "Challan ID*", "Deductee Name*", "PAN*", "Section*", "Date of Payment/Credit*", "Amount Paid/Credited (Rs)*", "Rate of TDS (%)*", "TDS Amount (Rs)*", "Interest (Rs)", "Remarks"],
    ["", TEMPLATE_EXAMPLE_CHALLAN_ID, "ADINATH PROCESSING INDUSTRIES PRIVATE LIMITED", "AACCP6899F", "194C", "31-05-2026", "5,558,172", "0.10", "5,558", "0", ""],
    ["1", "CH-REAL-001", "Genuine Real Client Pvt Ltd", "AAACG1234H", "194C", "07-07-2026", "250,000", "1.00", "2,500", "0", ""],
  ];

  it("drops the example row entirely — never appears in the joined output", () => {
    const challanRows = gridToRows(challanGridWithExample);
    const entryRows = gridToRows(entryGridWithExample);
    const joined = joinChallanTemplate(challanRows, entryRows);
    expect(joined).toHaveLength(1);
    expect(joined[0]["Deductee Name*"]).toBe("Genuine Real Client Pvt Ltd");
    expect(joined.some((r) => r["Deductee Name*"] === "ADINATH PROCESSING INDUSTRIES PRIVATE LIMITED")).toBe(false);
  });

  it("still correctly resolves the real row's BSR Code/Challan No when the example row is present on both sheets", () => {
    const challanRows = gridToRows(challanGridWithExample);
    const entryRows = gridToRows(entryGridWithExample);
    const joined = joinChallanTemplate(challanRows, entryRows);
    expect(joined[0]["BSR Code"]).toBe("0640123");
    expect(joined[0]["Challan No"]).toBe("99887");
  });

  it("drops the example row even if only ONE of the two sheets still has it", () => {
    const challanRows = gridToRows(challanGridWithExample); // example present
    const entryRows = gridToRows([
      ["Sr. No.", "Challan ID*", "Deductee Name*", "PAN*", "Section*", "Date of Payment/Credit*", "Amount Paid/Credited (Rs)*", "Rate of TDS (%)*", "TDS Amount (Rs)*", "Interest (Rs)", "Remarks"],
      ["1", "CH-REAL-001", "Genuine Real Client Pvt Ltd", "AAACG1234H", "194C", "07-07-2026", "250,000", "1.00", "2,500", "0", ""],
    ]); // example already deleted here
    const joined = joinChallanTemplate(challanRows, entryRows);
    expect(joined).toHaveLength(1);
    expect(joined[0]["BSR Code"]).toBe("0640123");
  });

  it("matches the sentinel case/whitespace-insensitively, same as any other Challan ID", () => {
    const entryRows = gridToRows([
      ["Sr. No.", "Challan ID*", "Deductee Name*", "PAN*", "Section*", "Date of Payment/Credit*", "Amount Paid/Credited (Rs)*", "Rate of TDS (%)*", "TDS Amount (Rs)*", "Interest (Rs)", "Remarks"],
      ["", `  ${TEMPLATE_EXAMPLE_CHALLAN_ID.toLowerCase()}  `, "ADINATH PROCESSING INDUSTRIES PRIVATE LIMITED", "AACCP6899F", "194C", "31-05-2026", "5,558,172", "0.10", "5,558", "0", ""],
      ["1", "CH-REAL-001", "Genuine Real Client Pvt Ltd", "AAACG1234H", "194C", "07-07-2026", "250,000", "1.00", "2,500", "0", ""],
    ]);
    const joined = joinChallanTemplate(gridToRows(challanGridWithExample), entryRows);
    expect(joined).toHaveLength(1);
    expect(joined[0]["Deductee Name*"]).toBe("Genuine Real Client Pvt Ltd");
  });
});

// Regression: the simpler, single-sheet "flat" TDS template has no Challan ID
// column to key an example-row sentinel off of (that's the whole point — no
// cross-sheet linking to get wrong), so its worked-example row instead carries
// TEMPLATE_EXAMPLE_ROW_SENTINEL in its Remarks cell. Confirms extractSheetRows
// — the function that actually processes this flat template, NOT gridToRows —
// drops that row even though it deliberately carries a real-shaped PAN (the
// same signal that makes extractSheetRows admit any other data row).
describe("extractSheetRows — worked-example row exclusion (flat single-sheet template)", () => {
  const FLAT_HEADER = ["Sr. No.", "Deductee Name*", "PAN*", "Section*", "Date of Payment/Credit*", "Amount Paid/Credited (Rs)*", "Rate of TDS (%)*", "TDS Amount (Rs)*", "Interest (Rs)", "BSR Code*", "Challan Serial No.*", "Date of Deposit*", "Remarks"];

  it("drops a row carrying the sentinel, even though it has a real-shaped PAN", () => {
    const grid: unknown[][] = [
      FLAT_HEADER,
      ["", "ADINATH PROCESSING INDUSTRIES PRIVATE LIMITED", "AACCP6899F", "194C", "31-05-2026", "5,558,172", "0.10", "5,558", "0", "0510002", "24894", "04-06-2026", TEMPLATE_EXAMPLE_ROW_SENTINEL],
      ["1", "Genuine Real Client Pvt Ltd", "AAACG1234H", "194C", "07-07-2026", "250,000", "1.00", "2,500", "0", "0640123", "99887", "07-07-2026", ""],
    ];
    const rows = extractSheetRows(grid, null);
    expect(rows).toHaveLength(1);
    expect(rows[0]["Deductee Name*"]).toBe("Genuine Real Client Pvt Ltd");
  });

  it("still admits an ordinary data row with a real PAN (no false positive from the new check)", () => {
    const grid: unknown[][] = [
      FLAT_HEADER,
      ["1", "Genuine Real Client Pvt Ltd", "AAACG1234H", "194C", "07-07-2026", "250,000", "1.00", "2,500", "0", "0640123", "99887", "07-07-2026", ""],
    ];
    expect(extractSheetRows(grid, null)).toHaveLength(1);
  });
});

// Regression: extractWorkbookRows must never scan an "Instructions" tab as
// data. The Instructions sheet's field guide deliberately shows real-shaped
// example values (e.g. a PAN) so a client sees the exact expected format —
// exactly what extractSheetRows's PAN-presence test looks for, so without an
// explicit skip, prose describing the format is misread as a fabricated
// deductee row (confirmed by removing the skip locally and rerunning this
// test — it fails without it).
describe("extractWorkbookRows — skips an 'Instructions' sheet by exact name", () => {
  const instructionsGrid: unknown[][] = [
    ["How To Fill This Template"],
    ["Field", "Guidance"],
    ["PAN*", "10-character PAN, e.g. 5 letters + 4 digits + 1 letter, in UPPERCASE. Example: AACCP6899F"],
  ];
  const dataGrid: unknown[][] = [
    ["Sr. No.", "Deductee Name*", "PAN*", "Section*", "Date of Payment/Credit*", "Amount Paid/Credited (Rs)*", "Rate of TDS (%)*", "TDS Amount (Rs)*", "Interest (Rs)"],
    ["1", "Genuine Real Client Pvt Ltd", "AAACG1234H", "194C", "07-07-2026", "250,000", "1.00", "2,500", "0"],
  ];
  const gridOf = (name: string): unknown[][] => (name === "Instructions" ? instructionsGrid : dataGrid);

  it("never returns a row sourced from the Instructions sheet", () => {
    const rows = extractWorkbookRows(["Instructions", "TDS Entries"], gridOf);
    expect(rows).toHaveLength(1);
    expect(rows[0]["Deductee Name*"]).toBe("Genuine Real Client Pvt Ltd");
  });

  it("matches the sheet name case/whitespace-insensitively", () => {
    const rows = extractWorkbookRows([" INSTRUCTIONS ", "TDS Entries"], (name) =>
      name.trim().toUpperCase() === "INSTRUCTIONS" ? instructionsGrid : dataGrid);
    expect(rows).toHaveLength(1);
  });
});

describe("isChallanBlockTemplate", () => {
  it("detects the single-sheet challan-grouped template by exact tab name", () => {
    expect(isChallanBlockTemplate(["TDS Data"])).toBe("TDS Data");
  });

  it("matches case/whitespace-insensitively", () => {
    expect(isChallanBlockTemplate(["  tds data  "])).toBe("  tds data  ");
  });

  it("does not detect an unrelated single-sheet workbook", () => {
    expect(isChallanBlockTemplate(["Sheet1"])).toBeNull();
  });

  it("does not detect the two-sheet template's own sheet names", () => {
    expect(isChallanBlockTemplate(["Challan Details", "TDS Entries"])).toBeNull();
  });
});

// The single-sheet challan-grouped template: every row tagged "Challan" or
// "Entry" via a Row Type column. There is NO separate "Challan ID" field —
// the software itself identifies a challan by BSR Code + Challan Serial No.
// only (see the Edit Challan dialog in TdsDataEntry.tsx), so an Entry row
// links back to its Challan row by repeating that SAME Challan Serial No.
// explodeChallanBlockTemplate splits by Row Type and hands off to
// joinChallanTemplate — already covered by its own tests — so these tests
// focus on the split itself, not re-testing the join.
describe("explodeChallanBlockTemplate", () => {
  const BLOCK_HEADER = [
    "Sr. No.", "Row Type*", "BSR Code*", "Challan Serial No.*", "Date of Deposit*", "Total Challan Amount (Rs)*", "Bank Name",
    "Deductee Name*", "PAN*", "Section*", "Date of Payment/Credit*", "Amount Paid/Credited (Rs)*", "Rate of TDS (%)*", "TDS Amount (Rs)*", "Interest (Rs)", "Remarks",
  ];
  // Placeholders for the 3 challan-only columns that stay blank on an entry
  // row AFTER its Challan Serial No. linking value (Date of Deposit, Total
  // Challan Amount, Bank Name) — BSR Code is written separately as "" in
  // each row below, and Challan Serial No. is filled, not blank.
  const blankChallanCols = ["", "", ""];
  const grid: unknown[][] = [
    BLOCK_HEADER,
    ["", "Challan", "0510002", "24894", "31-05-2026", "6,558", "HDFC Bank", "", "", "", "", "", "", "", "", "May payments"],
    ["1", "Entry", "", "24894", ...blankChallanCols, "Acme Traders", "AACCP6899F", "194C", "31-05-2026", "5,558,172", "0.10", "5,558", "0", ""],
    ["2", "Entry", "", " 24894 ", ...blankChallanCols, "Beta Chemicals", "AAGCA2480D", "194C", "31-05-2026", "500,000", "0.20", "1,000", "0", ""],
    ["", "Challan", "0510002", "38051", "30-06-2026", "4,491", "HDFC Bank", "", "", "", "", "", "", "", "", "June payments"],
    ["3", "Entry", "", "38051", ...blankChallanCols, "Gamma Industries", "AAGCG2480D", "194J", "30-06-2026", "732,750", "0.10", "733", "0", ""],
    ["4", "Entry", "", "99999", ...blankChallanCols, "Delta Corp", "AADCD1234E", "194C", "30-06-2026", "100,000", "0.10", "100", "0", ""],
  ];
  const rows = explodeChallanBlockTemplate(gridToRows(grid));

  it("returns ONLY entry rows — challan rows never appear in the output", () => {
    expect(rows).toHaveLength(4);
    expect(rows.every((r) => r["Deductee Name*"])).toBe(true);
  });

  it("resolves BSR Code / Challan No for entries under their challan, by Serial No. — not by position", () => {
    expect(rows[0]["BSR Code"]).toBe("0510002");
    expect(rows[0]["Challan No"]).toBe("24894");
    expect(rows[1]["BSR Code"]).toBe("0510002"); // whitespace-tolerant match
    expect(rows[1]["Challan No"]).toBe("24894");
  });

  it("resolves a second, distinct challan correctly", () => {
    expect(rows[2]["BSR Code"]).toBe("0510002");
    expect(rows[2]["Challan No"]).toBe("38051");
  });

  it("passes an unmatched Challan Serial No. through unchanged", () => {
    expect("BSR Code" in rows[3]).toBe(false);
    expect("Challan No" in rows[3]).toBe(false);
  });

  it("is a no-op (rows pass through unchanged) when there is no Row Type column — not this layout", () => {
    const plainRows = gridToRows([
      ["Deductee Name*", "PAN*"],
      ["Acme Traders", "AACCP6899F"],
    ]);
    expect(explodeChallanBlockTemplate(plainRows)).toEqual(plainRows);
  });

  it("drops the worked-example block (challan + its entry) via the shared example Challan Serial No., however the client leaves it", () => {
    const exampleGrid: unknown[][] = [
      BLOCK_HEADER,
      ["", "Challan", "0510002", TEMPLATE_EXAMPLE_CHALLAN_ID, "04-06-2026", "5,558", "HDFC Bank", "", "", "", "", "", "", "", "", "Worked example"],
      ["", "Entry", "", TEMPLATE_EXAMPLE_CHALLAN_ID, ...blankChallanCols, "ADINATH PROCESSING INDUSTRIES PRIVATE LIMITED", "AACCP6899F", "194C", "31-05-2026", "5,558,172", "0.10", "5,558", "0", ""],
      ["1", "Challan", "0640123", "99887", "07-07-2026", "2,500", "ICICI Bank", "", "", "", "", "", "", "", "", ""],
      ["1", "Entry", "", "99887", ...blankChallanCols, "Genuine Real Client Pvt Ltd", "AAACG1234H", "194C", "07-07-2026", "250,000", "1.00", "2,500", "0", ""],
    ];
    const out = explodeChallanBlockTemplate(gridToRows(exampleGrid));
    expect(out).toHaveLength(1);
    expect(out[0]["Deductee Name*"]).toBe("Genuine Real Client Pvt Ltd");
    expect(out[0]["BSR Code"]).toBe("0640123");
  });
});
