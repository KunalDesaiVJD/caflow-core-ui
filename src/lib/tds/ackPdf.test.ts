import { describe, expect, it } from "vitest";
import { extractAckNumber } from "./ackPdf";
import type { PdfTextItem } from "./tallyPdf";

// Build a fake page of positioned text runs from a list of "words" in the
// order pdf.js would emit them — position doesn't matter to extractAckNumber
// (it only reads .str), so x/y/w are placeholders.
const page = (...words: string[]): PdfTextItem[][] => [
  words.map((str) => ({ x: 0, y: 0, w: 0, str })),
];

describe("extractAckNumber", () => {
  it("reads the Acknowledgement Number from a real Form 26Q receipt, not the RRR Number", () => {
    const pages = page(
      "Acknowledgement", "Receipt", "of", "Income", "Tax", "Forms",
      "(Other", "Than", "Income", "Tax", "Return)",
      "e-Filing", "Acknowledgement", "Number", "Date", "of", "e-Filing",
      "976924930280526", "28-May-2026",
      "RRR", "Number",
      "770000387240044",
      "Name", ":", "ACCURATE", "PMS", "PRIVATE", "LIMITED",
    );
    expect(extractAckNumber(pages)).toBe("976924930280526");
  });

  it("reads the Acknowledgement Number from a real Form 24Q receipt", () => {
    const pages = page(
      "e-Filing", "Acknowledgement", "Number", "Date", "of", "e-Filing",
      "988617480290526", "29-May-2026",
      "RRR", "Number",
      "770000388680821",
      "Name", ":", "KWIKTEAM", "SUPPORT", "SERVICES", "PRIVATE", "LIMITED",
    );
    expect(extractAckNumber(pages)).toBe("988617480290526");
  });

  it("tolerates the label split across differently-grouped text runs", () => {
    const pages = page(
      "e-Filing Acknowledgement Number", "Date of e-Filing",
      "976924930280526", "28-May-2026",
      "RRR Number", "770000387240044",
    );
    expect(extractAckNumber(pages)).toBe("976924930280526");
  });

  it("returns null when no acknowledgement-number label is present", () => {
    const pages = page("Some", "unrelated", "PDF", "with", "no", "matching", "label", "12345");
    expect(extractAckNumber(pages)).toBeNull();
  });

  it("returns null for a bare RRR Number with no Acknowledgement Number label", () => {
    const pages = page("RRR", "Number", "770000387240044");
    expect(extractAckNumber(pages)).toBeNull();
  });
});
