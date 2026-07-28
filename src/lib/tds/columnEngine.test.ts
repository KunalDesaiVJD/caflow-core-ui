import { describe, it, expect } from "vitest";
import { explodeMonthlyColumns, resolveMapping, buildCanonicalRow, isAutoColumnHeader, rescueMirroredAmountFromNarration, stripAccountingMarker, looksLikeMoneyCell } from "./columnEngine";

// Real client file (MICROCIRCUITS INNOVATIONS PVT LTD, 24Q Q1 FY 2026-27) —
// reported bug: Stage 1 showed 0/70 matched despite PAN overlap on both
// sides. Root cause: the "SALARY" sheet is one row per employee with a
// repeating {APRIL, APRIL - BONUS, APRIL-TDS, MAY, ...} column group per
// calendar month for the whole year — resolveMapping's engine is fundamentally
// row-per-transaction, so its ratio-based fallback locked onto ONE arbitrary
// month's columns (or the annual TOTAL) for the entire file, silently
// discarding the filing's own Apr/May/Jun figures for every employee.
const SALARY_HEADER = [
  "SR NO", "PAN", "SALARY ",
  "APRIL", "APRIL - BONUS", "APRIL-TDS",
  "MAY", "MAY - BONUS", "MAY-TDS",
  "JUNE", "JUN - BONUS", "JUN-TDS",
  "July", "JULY- BONUS", "July-TDS",
  "TOTAL SALARY", "TOTAL  TDS", "TOTAL BOUNS",
];
function rowFrom(values: unknown[]): Record<string, unknown> {
  return Object.fromEntries(SALARY_HEADER.map((h, i) => [h, values[i]]));
}
const SALARY_ROWS = [
  rowFrom([1, "ACOPP5720C", "Madhukant Kanjibhai Patel - Salary", 200000, 0, 19800, 200000, 0, 19800, 200000, 0, 19800, "", "", "", 600000, 59400, 0]),
  rowFrom([2, "ANMPP3375Q", "Nirmitkumar Madhukant Patel - Salary", 350000, 0, 34800, 350000, 0, 34800, 350000, 0, 34800, "", "", "", 1050000, 104400, 0]),
  // A bonus-only employee, and one with no April activity at all (July starter).
  rowFrom([3, "BZDPT4273P", "Nevil Thummar - Salary", 31372, 20000, 0, 31372, 20000, 0, 31372, 20000, 0, 0, 0, 0, 94116, 0, 60000]),
];

describe("explodeMonthlyColumns — repeating per-month layout", () => {
  it("is a no-op when fewer than 2 distinct months are present (e.g. a normal single-pair file)", () => {
    const rows = [{ "Party Name": "X", "PAN": "ABCDE1234F", "Amount Paid": 1000, "TDS Amount": 100 }];
    expect(explodeMonthlyColumns(rows, "Q1", "2026-27")).toBe(rows);
  });

  it("is a no-op when the quarter/financial year is missing or unrecognised", () => {
    expect(explodeMonthlyColumns(SALARY_ROWS, null, "2026-27")).toBe(SALARY_ROWS);
    expect(explodeMonthlyColumns(SALARY_ROWS, "Q9", "2026-27")).toBe(SALARY_ROWS);
  });

  it("explodes each employee into one row per month of the filing's quarter (Q1 = Apr/May/Jun)", () => {
    const exploded = explodeMonthlyColumns(SALARY_ROWS, "Q1", "2026-27");
    // 3 employees × 3 months = 9 rows (Nevil has activity every month too).
    expect(exploded).toHaveLength(9);
    const madhukant = exploded.filter((r) => r.PAN === "ACOPP5720C");
    expect(madhukant).toHaveLength(3);
    for (const r of madhukant) {
      expect(r.amount_paid).toBe(200000);
      expect(r.tds_amount).toBe(19800);
    }
    // Dates land inside FY 2026-27's April/May/June 2026.
    expect(madhukant.map((r) => r.date_of_payment).sort()).toEqual(["2026-04-30", "2026-05-31", "2026-06-30"]);
  });

  it("adds bonus into amount_paid but keeps TDS as its own column", () => {
    const exploded = explodeMonthlyColumns(SALARY_ROWS, "Q1", "2026-27");
    const nevil = exploded.filter((r) => r.PAN === "BZDPT4273P");
    expect(nevil).toHaveLength(3);
    for (const r of nevil) { expect(r.amount_paid).toBe(51372); expect(r.tds_amount).toBe(0); }
  });

  it("drops the annual TOTAL columns so they never compete as a spurious extra money candidate", () => {
    const exploded = explodeMonthlyColumns(SALARY_ROWS, "Q1", "2026-27");
    for (const r of exploded) {
      expect(r).not.toHaveProperty("TOTAL SALARY");
      expect(r).not.toHaveProperty("TOTAL  TDS");
      expect(r).not.toHaveProperty("TOTAL BOUNS");
    }
  });

  it("leaves a row from a DIFFERENT, non-monthly sheet completely untouched", () => {
    const otherSheetRow = { "Vendor Name": "ABC Traders", "PAN": "ZYXWV9876G", "Bill Amount": 50000, "TDS": 500 };
    const mixed = [...SALARY_ROWS, otherSheetRow];
    const exploded = explodeMonthlyColumns(mixed, "Q1", "2026-27");
    expect(exploded).toContainEqual(otherSheetRow);
  });

  // REGRESSION (26Q false mismatch, e.g. Office Amount 56295 vs a wrongly-read
  // imported "Amount" of 563 — exactly 1% of 56295, the TDS-at-194C-rate
  // figure): a genuine per-transaction 26Q file was wrongly treated as a
  // wide-monthly layout because its multi-row header merge (extractSheetRows)
  // produces headers like "Feb-26 TDS PAID DATE CHALLAN BSR" — these still
  // START with a month token and used to still .includes("tds"), which (with
  // ≥2 such headers) was enough to trigger explosion: the file's own "Total"
  // amount column got dropped and the TDS column was left to be misread as
  // Amount. Two independent guards now close this: an EXACT suffix match
  // ("", "tds", "bonus" only, not a substring check) and requiring a real
  // base ("APR") column — not a lone "-TDS" group — before counting a month
  // as data at all.
  it("does NOT explode a normal per-transaction file whose multi-row header merge produced month-token-prefixed TDS labels (no base salary columns)", () => {
    const row = {
      "Party Name": "NILIMA VIJAY", "PAN": "AAAPV1234K", "Section": "194C",
      "Amount": 56295, "TDS": 563,
      "Feb-26 TDS PAID DATE CHALLAN BSR": "10/02/2026", "Mar-26 TDS PAID DATE CHALLAN BSR": "10/03/2026",
    };
    const exploded = explodeMonthlyColumns([row], "Q4", "2025-26");
    expect(exploded).toEqual([row]);
    const { map, report } = resolveMapping(exploded);
    expect(report.amount_paid?.header).toBe("Amount");
    expect(report.tds_amount?.header).toBe("TDS");
    const built = buildCanonicalRow(exploded[0], map);
    expect(built.amount_paid).toBe(56295);
    expect(built.tds_amount).toBe(563);
  });

  it("does NOT treat a lone '-TDS' column group (no matching base 'APRIL'/'MAY' column) as wide-monthly data", () => {
    const rows = [{ "PAN": "AAAPV1234K", "Name": "Some Employee", "APR-TDS": 100, "MAY-TDS": 120 }];
    expect(explodeMonthlyColumns(rows, "Q1", "2026-27")).toBe(rows);
  });

  it("end-to-end: resolveMapping + buildCanonicalRow now correctly resolve amount_paid/tds_amount/date_of_payment for every employee", () => {
    const exploded = explodeMonthlyColumns(SALARY_ROWS, "Q1", "2026-27");
    const { map, report } = resolveMapping(exploded);
    expect(report.amount_paid?.header).toBe("amount_paid");
    expect(report.tds_amount?.header).toBe("tds_amount");
    expect(report.date_of_payment?.header).toBe("date_of_payment");
    expect(report.pan?.header).toBe("PAN");

    const built = exploded.map((r) => buildCanonicalRow(r, map));
    const madhukantApril = built.find((r) => r.pan === "ACOPP5720C" && r.date_of_payment === "2026-04-30");
    expect(madhukantApril).toMatchObject({ amount_paid: 200000, tds_amount: 19800, deductee_name: "Madhukant Kanjibhai Patel - Salary" });
  });
});

// User-reported (with screenshots): an imported record for "Nikhil Rajeshbhai
// Bhoi - Salary" showed PAN "KYUPS2541N" — a PAN that belongs to nobody in
// Office Data — producing a false "In the imported client file only" mismatch
// even though Nikhil's real record (PAN "ATYPN4581C") exists there. Root
// cause, confirmed against the real file's "Q1" sheet: TWO UNRELATED tables
// are pasted side-by-side on one sheet — table 1 (SR NO/PAN/NAME/...) lists
// one set of employees with their PAN column left BLANK; table 2, an entirely
// different PAN/name list for DIFFERENT people, starts a few rows down at
// column J. Flattening the sheet into row objects merges both tables by
// physical row position, so Nikhil's row (table 1, blank PAN) ends up ALSO
// carrying table 2's unrelated PAN in an auto-named "Column11" slot purely by
// coincidence of row alignment. That auto-named column then has a HIGHER
// fracPan than the real (but empty, in this file) "PAN" column and used to win
// the value-based pick — grafting a stranger's PAN onto the wrong employee.
describe("resolveMapping — an auto-generated 'ColumnN' header never outranks a genuinely-named one (real client data)", () => {
  const HEADERS = ["SR NO ", "PAN", "NAME ", "JAN", "TDS", "FEB", "TDS_1", "MARCH", "TDS_2", "Column10", "Column11", "Column12"];
  function rowFrom(values: unknown[]): Record<string, unknown> {
    return Object.fromEntries(HEADERS.map((h, i) => [h, values[i]]));
  }
  const Q1_SHEET_ROWS = [
    rowFrom([1, "", "Nevil Thummar - Salary", "", "", "", "", "", "", "", "", ""]),
    rowFrom([4, "", "Nirali Kishorbhai Odedara - Salary", "", "", "", "", "", "", "", "PAN", "SALARY"]),
    rowFrom([5, "", "Nikhil Rajeshbhai Bhoi - Salary", "", "", "", "", "", "", "", "KYUPS2541N", "Akshaykumar Bhaveshbhai Shingala - Salary"]),
    rowFrom([6, "", "Devang Naimeshkumar Modi - Salary", "", "", "", "", "", "", "", "CPZPB6664P", "Bhankhar Shilpaben Ketanbhai - Salary"]),
    rowFrom([7, "", "Raj Nagabhai Maliya - Salary", "", "", "", "", "", "", "", "FYGPM4821L", "Bhaumikumar Jiteshbhai Malani - Salary"]),
  ];

  it("isAutoColumnHeader recognises a synthesised 'ColumnN' name and nothing else", () => {
    expect(isAutoColumnHeader("Column11")).toBe(true);
    expect(isAutoColumnHeader("column7")).toBe(true);
    expect(isAutoColumnHeader("PAN")).toBe(false);
    expect(isAutoColumnHeader("Column")).toBe(false); // no trailing digits — a real header could be named this
  });

  it("resolves pan from the genuinely-named (but empty, in this file) 'PAN' column, not the coincidentally PAN-shaped 'Column11'", () => {
    const { report } = resolveMapping(Q1_SHEET_ROWS);
    expect(report.pan?.header).toBe("PAN");
  });

  it("never grafts table 2's unrelated PAN onto table 1's employees", () => {
    const { map } = resolveMapping(Q1_SHEET_ROWS);
    const built = Q1_SHEET_ROWS.map((r) => buildCanonicalRow(r, map));
    const nikhil = built.find((r) => r.deductee_name === "Nikhil Rajeshbhai Bhoi - Salary")!;
    const devang = built.find((r) => r.deductee_name === "Devang Naimeshkumar Modi - Salary")!;
    const raj = built.find((r) => r.deductee_name === "Raj Nagabhai Maliya - Salary")!;
    // The real bug: these used to come back "KYUPS2541N" / "CPZPB6664P" / "FYGPM4821L".
    expect(nikhil.pan).not.toBe("KYUPS2541N");
    expect(devang.pan).not.toBe("CPZPB6664P");
    expect(raj.pan).not.toBe("FYGPM4821L");
    // The real (blank, in this file) PAN column means these stay unresolved
    // rather than fabricated — an honest "no PAN parsed", not a wrong one.
    expect(nikhil.pan).toBeNull();
  });

  it("does NOT break the ordinary case: a file with no named header at all still finds PAN by value shape", () => {
    const rows = [
      { Column1: "ABC Traders", Column2: "AAAPA1111A", Column3: 50000, Column4: 500 },
      { Column1: "XYZ Corp", Column2: "BBBPB2222B", Column3: 60000, Column4: 600 },
    ];
    const { report } = resolveMapping(rows);
    expect(report.pan?.header).toBe("Column2");
  });
});

// Real client file (Sarjeet Construction, 26Q Q1 FY 2026-27) — reported bug:
// Stage 1 showed a false "Amount" mismatch, e.g. Office Data 56295 vs
// Imported Excel 563 (563 ≈ 56295 × 0.01). Root cause: the client's own
// "Gross Total" column was mistakenly populated with the TDS figure itself —
// IDENTICAL to the real "TDS on Contractors" column on every row. The true
// gross amount survived only in a free-text "Narration" column, either as
// prose ("BEING 1% TDS ON AMT RS 41415") or, for a few rows, as a bare number
// outright. Rates seen in the real file: 1%, 2%, 10%.
// THE FORMAT THAT BROKE EVERYTHING. The importer reads a sheet as DISPLAY
// TEXT (raw:false, to preserve the client's own date/id formatting), so an
// Excel cell with a Dr/Cr custom number format arrives as the STRING
// "563.00 Dr" — not the number 563. Every "is this column money?" test used a
// bare /[A-Za-z]{2,}/ rejection, saw the "Dr", and classified both money
// columns as text: nothing to pair, the narration rescue never started, and
// all 87 records of a real 26Q file reported a false mismatch.
describe("Dr/Cr-formatted money columns (the real Sarjeet Construction cell format)", () => {
  const HEADERS = ["Date", "Particulars", "PAN No.", "Narration", "Gross Total", "TDS on Contractors"];
  const rowFrom = (values: unknown[]): Record<string, unknown> =>
    Object.fromEntries(HEADERS.map((h, i) => [h, values[i]]));

  // Verbatim from the real file, read the way the app reads it.
  const ROWS = [
    rowFrom(["01-Jun-26", "NILIMA VIJAY HIRAY BITPH4577H", "BITPH4577H", "BEING 1% TDS ON AMT RS 56295", "563.00 Dr", "563.00 Cr"]),
    rowFrom(["01-Jun-26", "X HAWK MULTI SERVICES", "AWNPP5117A", "BEING 1% TDS ON AMT RS 33968", "340.00 Dr", "340.00 Cr"]),
    rowFrom(["02-Jun-26", "HATHILA KAMCHANDBHAI SANIYABHAI", "RZGPS7245D", "BEING 1% TDS ON AMT RS 20000", "200.00 Dr", "200.00 Cr"]),
    rowFrom(["03-Jun-26", "NILESH VINOD SANKLECHA", "CXGPS1857J", "BEING 1% TDS ON AMT RS 73950", "740.00 Dr", "740.00 Cr"]),
    // A bare-figure narration ALSO carries its accounting side once read as text.
    rowFrom(["27/04/2026", "Manisha Manoj Dudhat", "AERPD6644N", "19038.00 Dr", "1904.00 Dr", "1904.00 Dr"]),
  ];

  it("reads a Dr/Cr-formatted cell as money, so the amount/TDS pair resolves at all", () => {
    const rescued = rescueMirroredAmountFromNarration(ROWS);
    const { map } = resolveMapping(rescued);
    const built = rescued.map((r) => buildCanonicalRow(r, map));

    // The exact record reported three times: Office 56,295 vs an imported 563.
    expect(built[0]).toMatchObject({ amount_paid: 56295, tds_amount: 563, rate: 1 });
    expect(built[1]).toMatchObject({ amount_paid: 33968, tds_amount: 340 });
    expect(built[2]).toMatchObject({ amount_paid: 20000, tds_amount: 200 });
    expect(built[3]).toMatchObject({ amount_paid: 73950, tds_amount: 740 });
    // …and the bare-figure narration resolves too, at its own 10% rate.
    expect(built[4]).toMatchObject({ amount_paid: 19038, tds_amount: 1904, rate: 10 });

    // NOT A SINGLE ROW LEFT BEHIND — the whole point of the reconciliation.
    expect(built.every((b) => b.amount_paid != null && b.tds_amount != null)).toBe(true);
  });

  it("strips the side-marker without inventing a number where there is none", () => {
    expect(stripAccountingMarker("563.00 Dr")).toBe("563.00");
    expect(stripAccountingMarker("Cr 1,234.50")).toBe("1,234.50");
    expect(stripAccountingMarker("563.00")).toBe("563.00");
    // A real word is not a marker, and a lone marker is not a number.
    expect(stripAccountingMarker("Credit Note")).toBe("Credit Note");
    expect(looksLikeMoneyCell("563.00 Dr")).toBe(true);
    expect(looksLikeMoneyCell("BEING 1% TDS ON AMT RS 56295")).toBe(false);
    expect(looksLikeMoneyCell("NILIMA VIJAY HIRAY")).toBe(false);
  });
});

describe("rescueMirroredAmountFromNarration — the 'Amount' column mirrors the TDS column (real Sarjeet Construction data)", () => {
  const HEADERS = ["Date", "Particulars", "PAN No.", "Narration", "Gross Total", "TDS on Contractors"];
  function rowFrom(values: unknown[]): Record<string, unknown> {
    return Object.fromEntries(HEADERS.map((h, i) => [h, values[i]]));
  }
  const ROWS = [
    rowFrom(["2026-04-05", "RAMBABU YADAV ATGPY7463E", "ATGPY7463E", "BEING 1% TDS ON AMT RS 41415", 414, 414]),
    rowFrom(["2026-04-07", "RAMBABU YADAV ATGPY7463E", "ATGPY7463E", "BEING 1% TDS ON AMT RS 12255", 123, 123]),
    rowFrom(["2026-04-28", "Bharat Bavchandbhai Togadiya A/c. ALXPT 8325 K", "ALXPT8325K", "BEING 1% TDS ON AMT RS 709438", 7094, 7094]),
    // A few real rows carry the true amount as a BARE NUMBER in Narration —
    // no "BEING...RS" prose at all — at a 10% rate (a different section).
    rowFrom(["2026-04-30", "Manisha Manoj Dudhat", "AERPD6644N", 19038, 1904, 1904]),
    rowFrom(["2026-06-01", "NILIMA VIJAY HIRAY", "BITPH4577H", "BEING 1% TDS ON AMT RS 56295", 563, 563]),
    // Real rates vary — 2% and 10% must resolve just as well as 1%.
    rowFrom(["2026-06-15", "DHANI CONSTRUCTION", "AAVFD2284J", "BEING 2% TDS ON AMT RS 24312338", 486247, 486247]),
    rowFrom(["2026-06-20", "ACCUMEN CONSULTING ENGINEERS", "APNPP0163M", "BEING 10% TDS ON AMT RS 35000.00", 3500, 3500]),
  ];

  it("recovers the true amount from Narration and lets resolveMapping pair it against the TDS-like column", () => {
    const rescued = rescueMirroredAmountFromNarration(ROWS);
    const { map, report } = resolveMapping(rescued);
    expect(report.amount_paid?.header).toBe("amount_paid");
    expect(report.tds_amount?.header).toBe("Gross Total");

    const built = rescued.map((r) => buildCanonicalRow(r, map));
    expect(built[0]).toMatchObject({ amount_paid: 41415, tds_amount: 414 });
    expect(built[1]).toMatchObject({ amount_paid: 12255, tds_amount: 123 });
    expect(built[2]).toMatchObject({ amount_paid: 709438, tds_amount: 7094 });
  });

  // Reported three times against the SAME real file: Office 56,295 vs an
  // imported "Amount" of 563 (the TDS, at 1%). The narration states BOTH the
  // taxable amount and the rate; the record must carry both so a reviewer can
  // see the basis of the figure the engine reconstructed.
  it("carries the RATE and the narration text alongside the recovered amount", () => {
    const rescued = rescueMirroredAmountFromNarration(ROWS);
    const { map } = resolveMapping(rescued);

    const nilima = buildCanonicalRow(rescued[4], map);
    expect(nilima).toMatchObject({ amount_paid: 56295, tds_amount: 563, rate: 1 });
    expect(rescued[4].narration).toBe("BEING 1% TDS ON AMT RS 56295");

    // Rates vary by section — each row keeps the rate ITS OWN narration states.
    expect(buildCanonicalRow(rescued[5], map).rate).toBe(2);
    expect(buildCanonicalRow(rescued[6], map).rate).toBe(10);

    // A bare-number narration states no rate, so it is DERIVED from the two
    // figures rather than left blank (1904 / 19038 = 10%).
    expect(buildCanonicalRow(rescued[3], map).rate).toBe(10);
  });

  it("recovers the amount from a BARE-NUMBER narration cell (no 'BEING...RS' prose)", () => {
    const rescued = rescueMirroredAmountFromNarration(ROWS);
    const { map } = resolveMapping(rescued);
    const built = buildCanonicalRow(rescued[3], map);
    expect(built.amount_paid).toBe(19038);
    expect(built.tds_amount).toBe(1904);
  });

  it("reproduces the exact reported case: NILIMA VIJAY's Amount is 56295, not 563", () => {
    const rescued = rescueMirroredAmountFromNarration(ROWS);
    const { map } = resolveMapping(rescued);
    const nilima = buildCanonicalRow(rescued[4], map);
    expect(nilima.amount_paid).toBe(56295);
    expect(nilima.tds_amount).toBe(563);
  });

  it("handles a 2% rate and a 10% rate exactly like the 1% cases", () => {
    const rescued = rescueMirroredAmountFromNarration(ROWS);
    const { map } = resolveMapping(rescued);
    const dhani = buildCanonicalRow(rescued[5], map);
    const accumen = buildCanonicalRow(rescued[6], map);
    expect(dhani).toMatchObject({ amount_paid: 24312338, tds_amount: 486247 });
    expect(accumen).toMatchObject({ amount_paid: 35000, tds_amount: 3500 });
  });

  it("is a no-op on an ordinary file where Amount and TDS are genuinely different columns", () => {
    const normal = [
      { Party: "ABC Traders", PAN: "AAAPA1111A", Amount: 50000, TDS: 500 },
      { Party: "XYZ Corp", PAN: "BBBPB2222B", Amount: 60000, TDS: 600 },
    ];
    expect(rescueMirroredAmountFromNarration(normal)).toBe(normal);
  });

  it("does not fire when there is only ONE numeric column (nothing to mirror against)", () => {
    const rows = [{ Party: "ABC Traders", PAN: "AAAPA1111A", Amount: 50000 }];
    expect(rescueMirroredAmountFromNarration(rows)).toBe(rows);
  });
});

// Companion bug found while investigating the above: a cellDates:true XLSX
// read (the app's own default) hands profileColumns a real Date OBJECT, not
// a string — but the date-detection check stringified the cell BEFORE
// testing it, so looksLikeDate's `instanceof Date` branch never fired and
// date_of_payment silently failed to resolve on every such file.
describe("resolveMapping / buildCanonicalRow — a real Date object (cellDates:true) is recognised and formatted cleanly", () => {
  it("detects the date column and stores a clean yyyy-mm-dd string, not Date's verbose toString()", () => {
    const rows = [
      { Name: "ABC Traders", PAN: "AAAPA1111A", Date: new Date(2026, 3, 5), Amount: 50000, TDS: 500 },
      { Name: "XYZ Corp", PAN: "BBBPB2222B", Date: new Date(2026, 4, 31), Amount: 60000, TDS: 600 },
    ];
    const { map, report } = resolveMapping(rows);
    expect(report.date_of_payment?.header).toBe("Date");
    const built = rows.map((r) => buildCanonicalRow(r, map));
    expect(built[0].date_of_payment).toBe("2026-04-05");
    expect(built[1].date_of_payment).toBe("2026-05-31");
  });
});
