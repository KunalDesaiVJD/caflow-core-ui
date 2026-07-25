import { describe, expect, it } from "vitest";
import { extractAckNumber, extractAckFields } from "./ackPdf";
import type { PdfTextItem } from "./tallyPdf";

// Build one positioned text run. y follows PdfTextItem's convention: larger
// y = higher up the page, so a page is built top-down with DEcreasing y.
const cell = (x: number, y: number, str: string): PdfTextItem => ({ x, y, w: str.length * 6, str });

describe("extractAckNumber", () => {
  it("reads the Acknowledgement Number from a real Form 26Q receipt's two-column header row", () => {
    // Row 1 (labels): "e-Filing Acknowledgement Number" | "Date of e-Filing"
    // Row 2 (values): "976924930280526"                 | "28-May-2026"
    // Row 3 (label):  "RRR Number"
    // Row 4 (value):  "770000387240044"
    const items: PdfTextItem[] = [
      cell(40, 800, "e-Filing"), cell(120, 800, "Acknowledgement"), cell(280, 800, "Number"),
      cell(500, 800, "Date"), cell(540, 800, "of"), cell(570, 800, "e-Filing"),
      cell(40, 780, "976924930280526"), cell(500, 780, "28-May-2026"),
      cell(40, 760, "RRR"), cell(100, 760, "Number"),
      cell(40, 740, "770000387240044"),
      cell(40, 700, "Name"), cell(70, 700, ":"), cell(90, 700, "ACCURATE"), cell(200, 700, "PMS"),
    ];
    expect(extractAckNumber([items])).toBe("976924930280526");
  });

  it("reads the Acknowledgement Number from a real Form 24Q receipt", () => {
    const items: PdfTextItem[] = [
      cell(40, 800, "e-Filing"), cell(120, 800, "Acknowledgement"), cell(280, 800, "Number"),
      cell(500, 800, "Date"), cell(540, 800, "of"), cell(570, 800, "e-Filing"),
      cell(40, 780, "988617480290526"), cell(500, 780, "29-May-2026"),
      cell(40, 760, "RRR"), cell(100, 760, "Number"),
      cell(40, 740, "770000388680821"),
    ];
    expect(extractAckNumber([items])).toBe("988617480290526");
  });

  it("still finds the real Acknowledgement Number even if pdf.js emits the RRR value BEFORE it in raw array order", () => {
    // Same visual layout as the real receipts above, but the raw items
    // array is deliberately shuffled so the RRR value comes first — proves
    // the parser uses Y-POSITION, not array/emission order, to disambiguate.
    const items: PdfTextItem[] = [
      cell(40, 740, "770000387240044"), // RRR value — printed lower on the page, but listed FIRST here
      cell(40, 760, "RRR"), cell(100, 760, "Number"),
      cell(500, 780, "28-May-2026"),
      cell(40, 780, "976924930280526"), // the real answer — listed LAST here
      cell(500, 800, "Date"), cell(540, 800, "of"), cell(570, 800, "e-Filing"),
      cell(40, 800, "e-Filing"), cell(120, 800, "Acknowledgement"), cell(280, 800, "Number"),
    ];
    expect(extractAckNumber([items])).toBe("976924930280526");
  });

  it("reassembles an acknowledgement number pdf.js split into two adjacent text runs", () => {
    const items: PdfTextItem[] = [
      cell(40, 800, "e-Filing"), cell(120, 800, "Acknowledgement"), cell(280, 800, "Number"),
      cell(40, 780, "9769"), cell(76, 780, "24930280526"), // one printed number, split by pdf.js
      cell(40, 760, "RRR"), cell(100, 760, "Number"),
      cell(40, 740, "770000387240044"),
    ];
    expect(extractAckNumber([items])).toBe("976924930280526");
  });

  it("skips past a short intervening digit token (e.g. a quarter/form code) to reach the real value", () => {
    const items: PdfTextItem[] = [
      cell(40, 800, "e-Filing"), cell(120, 800, "Acknowledgement"), cell(280, 800, "Number"),
      cell(40, 790, "Form"), cell(70, 790, "No."), cell(100, 790, "26Q"), cell(140, 790, "Quarter"), cell(190, 790, "4"),
      cell(40, 780, "976924930280526"), cell(500, 780, "28-May-2026"),
      cell(40, 760, "RRR"), cell(100, 760, "Number"),
      cell(40, 740, "770000387240044"),
    ];
    expect(extractAckNumber([items])).toBe("976924930280526");
  });

  it("matches the abbreviated 'Acknowledgement No.' label used on older receipt templates", () => {
    const items: PdfTextItem[] = [
      cell(40, 800, "Acknowledgement"), cell(200, 800, "No."),
      cell(40, 780, "976924930280526"), cell(500, 780, "28-May-2026"),
    ];
    expect(extractAckNumber([items])).toBe("976924930280526");
  });

  it("returns null when no acknowledgement-number label is present", () => {
    const items: PdfTextItem[] = [cell(40, 800, "Some"), cell(80, 800, "unrelated"), cell(150, 800, "PDF")];
    expect(extractAckNumber([items])).toBeNull();
  });

  it("returns null when the RRR Number row is reached before any qualifying value is found", () => {
    const items: PdfTextItem[] = [
      cell(40, 800, "e-Filing"), cell(120, 800, "Acknowledgement"), cell(280, 800, "Number"),
      cell(40, 760, "RRR"), cell(100, 760, "Number"),
      cell(40, 740, "770000387240044"),
    ];
    expect(extractAckNumber([items])).toBeNull();
  });
});

describe("extractAckFields", () => {
  // Faithful reproduction of the raw band dump from a genuine Form 24Q
  // e-filing acknowledgement (Form 24Q_ARN_770000388680821.pdf) — same y
  // spacing order as the real receipt's "Label : Value" rows, each label and
  // value split into the same number of pdf.js text runs the real file
  // produced (e.g. "Form" + "No." as two runs, "PAN/TAN" as one).
  const items: PdfTextItem[] = [
    cell(40, 681.3, "e-Filing"), cell(120, 681.3, "Acknowledgement"), cell(280, 681.3, "Number"),
    cell(500, 681.3, "Date"), cell(540, 681.3, "of"), cell(570, 681.3, "e-Filing"),
    cell(40, 662.7, "988617480290526"), cell(500, 662.7, "29-May-2026"),
    cell(40, 645.5, "RRR"), cell(100, 645.5, "Number"),
    cell(40, 626.9, "770000388680821"),
    cell(40, 588.9, "Name"), cell(90, 588.9, ":"),
    cell(110, 588.9, "KWIKTEAM"), cell(180, 588.9, "SUPPORT"), cell(240, 588.9, "SERVICES"), cell(300, 588.9, "PRIVATE"), cell(360, 588.9, "LIMITED"),
    cell(40, 562.3, "PAN/TAN"), cell(90, 562.3, ":"), cell(110, 562.3, "AHMK08204A"),
    cell(40, 535.7, "Address"), cell(90, 535.7, ":"), cell(110, 535.7, "E-604, TITANIUM CITY CENTER,NR SACHIN"),
    cell(40, 496.8, "Form"), cell(75, 496.8, "No."), cell(100, 496.8, ":"), cell(120, 496.8, "Form"), cell(150, 496.8, "24Q"),
    cell(40, 419.0, "Assessment"), cell(100, 419.0, "Year"), cell(150, 419.0, ":"), cell(170, 419.0, "-"),
    cell(40, 392.4, "Financial"), cell(100, 392.4, "Year"), cell(150, 392.4, ":"), cell(170, 392.4, "2025-26"),
    cell(40, 365.8, "Month"), cell(90, 365.8, ":"), cell(110, 365.8, "-"),
    cell(40, 339.2, "Quarter"), cell(100, 339.2, ":"), cell(120, 339.2, "Q4"),
  ];

  it("extracts Name/Financial Year/Quarter/Form No./TAN alongside the Ack No. from the real receipt's 'Label : Value' rows", () => {
    expect(extractAckFields([items])).toEqual({
      ackNumber: "988617480290526",
      name: "KWIKTEAM SUPPORT SERVICES PRIVATE LIMITED",
      financialYear: "2025-26",
      quarter: "Q4",
      formNo: "24Q",
      tan: "AHMK08204A",
    });
  });

  it("treats blank '-' values (Assessment Year, Month on a regular quarterly receipt) as null rather than the literal dash", () => {
    const fields = extractAckFields([items]);
    // Assessment Year and Month are both "-" in the sample above and are not
    // fields this codebase cross-checks — confirming they don't leak into
    // any of the extracted fields is what this test guards.
    expect(Object.values(fields)).not.toContain("-");
  });

  it("returns all-null fields (never throws) for a PDF with no matching text layer, e.g. scanned/image-only", () => {
    expect(extractAckFields([[]])).toEqual({
      ackNumber: null, name: null, financialYear: null, quarter: null, formNo: null, tan: null,
    });
  });
});
