import { describe, expect, it } from "vitest";
import { extractAckNumber } from "./ackPdf";
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
