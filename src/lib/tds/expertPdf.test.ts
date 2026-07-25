import { describe, it, expect } from "vitest";
import { parseExpertPdfPages, type ExpertPdfTextItem } from "./expertPdf";

// Every fixture below is the VERBATIM pdfjs token dump (x/y/w/str) of a real
// client ledger — POINT PACKERS, Q1 FY2026-27, one file per TDS section
// (194H/194J/194Q/194C) — captured with the exact same legacy-build pdfjs
// used by pdfText.ts. Nothing here is idealised; every test exercises the
// real column geometry, the real glued date+particulars tokens and the
// real narration/balance quirks this parser has to survive.

const HEADER_194H: ExpertPdfTextItem[] = [
  { x: 50, y: 790, w: 78, str: "POINT PACKERS" },
  { x: 50, y: 778, w: 54, str: "TDS 194 H" },
  { x: 50, y: 766, w: 174, str: "From 01/04/2026 To 30/06/2026" },
  { x: 470, y: 754, w: 60, str: "Page No. 1" },
  { x: 50, y: 742, w: 480, str: "-".repeat(80) },
  { x: 50, y: 730, w: 24, str: "Date" },
  { x: 116, y: 730, w: 66, str: "Particulars" },
  { x: 314, y: 730, w: 54, str: "Dr.Amount" },
  { x: 392, y: 730, w: 54, str: "Cr.Amount" },
  { x: 482, y: 730, w: 42, str: "Balance" },
  { x: 50, y: 718, w: 480, str: "-".repeat(80) },
];

const PAGE_194H: ExpertPdfTextItem[] = [
  ...HEADER_194H,
  { x: 50, y: 706, w: 204, str: "01/04/2026 *** OPENING BALANCE ***" },
  { x: 50, y: 682, w: 216, str: "29/04/2026 PATEL PAYALBEN SUNILKUMAR" }, { x: 404, y: 682, w: 42, str: "1333.00" },
  { x: 116, y: 670, w: 132, str: "BEING THE TDS 66637@2%" },
  { x: 50, y: 658, w: 228, str: "29/04/2026 GORDHANBHAI PUNJABHAI PATEL" }, { x: 416, y: 658, w: 30, str: "72.00" },
  { x: 116, y: 646, w: 126, str: "BEING THE TDS 3579@2%" }, { x: 482, y: 646, w: 48, str: "1405.00C" },
  { x: 50, y: 634, w: 108, str: "04/05/2026 Journal" }, { x: 326, y: 634, w: 42, str: "1405.00" },
  { x: 50, y: 610, w: 204, str: "30/06/2026 *** CLOSING BALANCE ***" }, { x: 326, y: 610, w: 42, str: "1405.00" }, { x: 404, y: 610, w: 42, str: "1405.00" },
  { x: 50, y: 598, w: 480, str: "-".repeat(80) },
];

const HEADER_194J: ExpertPdfTextItem[] = HEADER_194H.map((i) => (i.str === "TDS 194 H" ? { ...i, str: "TDS 194 J" } : i));

const PAGE_194J: ExpertPdfTextItem[] = [
  ...HEADER_194J,
  { x: 50, y: 706, w: 204, str: "01/04/2026 *** OPENING BALANCE ***" }, { x: 404, y: 706, w: 42, str: "2100.00" }, { x: 482, y: 706, w: 48, str: "2100.00C" },
  { x: 50, y: 682, w: 198, str: "15/04/2026 ICICI-C/C 045705001798" }, { x: 326, y: 682, w: 42, str: "2100.00" },
  { x: 116, y: 670, w: 36, str: "Ch:GIB" }, { x: 182, y: 670, w: 18, str: "Dt:" }, { x: 212, y: 670, w: 6, str: "/" }, { x: 230, y: 670, w: 6, str: "/" }, { x: 254, y: 670, w: 24, str: "1798" },
  { x: 116, y: 658, w: 30, str: "D TAX" },
  { x: 50, y: 646, w: 156, str: "30/04/2026 V J DESAI & CO." }, { x: 404, y: 646, w: 42, str: "2100.00" },
  { x: 116, y: 634, w: 138, str: "BEING THE TDS 21000@10%" }, { x: 482, y: 634, w: 48, str: "2100.00C" },
  { x: 50, y: 622, w: 108, str: "04/05/2026 Journal" }, { x: 326, y: 622, w: 42, str: "2100.00" },
  { x: 50, y: 610, w: 156, str: "31/05/2026 V J DESAI & CO." }, { x: 404, y: 610, w: 42, str: "2100.00" },
  { x: 116, y: 598, w: 138, str: "BEING THE TDS 21000@10%" }, { x: 482, y: 598, w: 48, str: "2100.00C" },
  { x: 50, y: 586, w: 108, str: "06/06/2026 Journal" }, { x: 326, y: 586, w: 42, str: "2100.00" },
  { x: 50, y: 574, w: 156, str: "30/06/2026 V J DESAI & CO." }, { x: 404, y: 574, w: 42, str: "2100.00" },
  { x: 116, y: 562, w: 138, str: "BEING THE TDS 21000@10%" }, { x: 482, y: 562, w: 48, str: "2100.00C" },
  { x: 50, y: 538, w: 204, str: "30/06/2026 *** CLOSING BALANCE ***" }, { x: 326, y: 538, w: 42, str: "6300.00" }, { x: 404, y: 538, w: 42, str: "8400.00" }, { x: 482, y: 538, w: 48, str: "2100.00C" },
  { x: 50, y: 526, w: 480, str: "-".repeat(80) },
];

const HEADER_194Q: ExpertPdfTextItem[] = HEADER_194H.map((i) => (i.str === "TDS 194 H" ? { ...i, str: "TDS 194 Q (PURCHASE ON GOODS)" } : i));

const PAGE_194Q: ExpertPdfTextItem[] = [
  ...HEADER_194Q,
  { x: 50, y: 706, w: 204, str: "01/04/2026 *** OPENING BALANCE ***" }, { x: 404, y: 706, w: 42, str: "6702.00" }, { x: 482, y: 706, w: 48, str: "6702.00C" },
  { x: 50, y: 682, w: 198, str: "15/04/2026 ICICI-C/C 045705001798" }, { x: 326, y: 682, w: 42, str: "6322.00" },
  { x: 116, y: 670, w: 36, str: "Ch:GIB" }, { x: 182, y: 670, w: 18, str: "Dt:" }, { x: 212, y: 670, w: 6, str: "/" }, { x: 230, y: 670, w: 6, str: "/" }, { x: 254, y: 670, w: 24, str: "1798" },
  { x: 116, y: 658, w: 30, str: "D TAX" }, { x: 488, y: 658, w: 42, str: "380.00C" },
  { x: 50, y: 646, w: 186, str: "30/06/2026 HI-TECH INKS PVT.LTD" }, { x: 410, y: 646, w: 36, str: "325.00" },
  { x: 116, y: 634, w: 180, str: "BEING THE TOTAL PUCHASE OF 01." },
  { x: 116, y: 622, w: 180, str: "04.2026 TO 30.06.2026 = 532474" },
  { x: 116, y: 610, w: 174, str: "7.50-5000000=324747.50*0.100%" },
  { x: 50, y: 598, w: 150, str: "30/06/2026 IKON MULTIPACK" }, { x: 404, y: 598, w: 42, str: "3471.00" },
  { x: 116, y: 586, w: 180, str: "BEING THE TOTAL PUCHASE OF 01." },
  { x: 116, y: 574, w: 180, str: "04.2026 TO 30.06.2026 = 847111" },
  { x: 116, y: 562, w: 180, str: "8.95-5000000=3471118.95*0.100%" }, { x: 482, y: 562, w: 48, str: "4176.00C" },
  { x: 50, y: 538, w: 204, str: "30/06/2026 *** CLOSING BALANCE ***" }, { x: 326, y: 538, w: 42, str: "6322.00" }, { x: 398, y: 538, w: 48, str: "10498.00" }, { x: 482, y: 538, w: 48, str: "4176.00C" },
  { x: 50, y: 526, w: 480, str: "-".repeat(80) },
];

const HEADER_194C: ExpertPdfTextItem[] = HEADER_194H.map((i) => (i.str === "TDS 194 H" ? { ...i, str: "TDS 194 C" } : i));

const PAGE_194C: ExpertPdfTextItem[] = [
  ...HEADER_194C,
  { x: 50, y: 706, w: 204, str: "01/04/2026 *** OPENING BALANCE ***" }, { x: 404, y: 706, w: 42, str: "2812.00" }, { x: 482, y: 706, w: 48, str: "2812.00C" },
  { x: 50, y: 682, w: 120, str: "09/04/2026 MELT SEAL" }, { x: 416, y: 682, w: 30, str: "79.00" },
  { x: 116, y: 670, w: 144, str: "BEING THE TDS 7906.25@1%" },
  { x: 116, y: 658, w: 48, str: "B NO. 17" }, { x: 482, y: 658, w: 48, str: "2891.00C" },
  { x: 50, y: 646, w: 198, str: "15/04/2026 ICICI-C/C 045705001798" }, { x: 326, y: 646, w: 42, str: "2846.00" },
  { x: 116, y: 634, w: 36, str: "Ch:GIB" }, { x: 182, y: 634, w: 18, str: "Dt:" }, { x: 212, y: 634, w: 6, str: "/" }, { x: 230, y: 634, w: 6, str: "/" }, { x: 254, y: 634, w: 24, str: "1798" },
  { x: 116, y: 622, w: 30, str: "D TAX" }, { x: 494, y: 622, w: 36, str: "45.00C" },
  { x: 50, y: 610, w: 120, str: "19/04/2026 MELT SEAL" }, { x: 410, y: 610, w: 36, str: "106.00" },
  { x: 116, y: 598, w: 150, str: "BEING THE TDS 10637.50@1%" },
  { x: 116, y: 586, w: 48, str: "B NO. 42" }, { x: 488, y: 586, w: 42, str: "151.00C" },
  { x: 50, y: 574, w: 120, str: "22/04/2026 MELT SEAL" }, { x: 410, y: 574, w: 36, str: "280.00" },
  { x: 116, y: 562, w: 150, str: "BEING THE TDS 27955.20@1%" },
  { x: 116, y: 550, w: 48, str: "B NO. 47" }, { x: 488, y: 550, w: 42, str: "431.00C" },
  { x: 50, y: 538, w: 156, str: "03/05/2026 SHILPI GRAPHICS" }, { x: 410, y: 538, w: 36, str: "725.00" },
  { x: 116, y: 526, w: 48, str: "36260@2%" },
  { x: 116, y: 514, w: 54, str: "B NO. 260" }, { x: 482, y: 514, w: 48, str: "1156.00C" },
  { x: 50, y: 502, w: 108, str: "04/05/2026 Journal" }, { x: 332, y: 502, w: 36, str: "431.00" }, { x: 488, y: 502, w: 42, str: "725.00C" },
  { x: 50, y: 490, w: 210, str: "15/05/2026 VINTEX RUBBER INDUSTRIES" }, { x: 416, y: 490, w: 30, str: "27.00" },
  { x: 116, y: 478, w: 42, str: "2700@1%" },
  { x: 116, y: 466, w: 60, str: "B NO. 0258" }, { x: 488, y: 466, w: 42, str: "752.00C" },
  { x: 50, y: 454, w: 210, str: "20/05/2026 VINTEX RUBBER INDUSTRIES" }, { x: 410, y: 454, w: 36, str: "841.00" },
  { x: 116, y: 442, w: 48, str: "42056@1%" },
  { x: 116, y: 430, w: 60, str: "B NO. 0286" }, { x: 482, y: 430, w: 48, str: "1593.00C" },
  { x: 50, y: 418, w: 156, str: "24/05/2026 SHILPI GRAPHICS" }, { x: 410, y: 418, w: 36, str: "100.00" },
  { x: 116, y: 406, w: 42, str: "5016@2%" },
  { x: 116, y: 394, w: 54, str: "B NO. 345" }, { x: 482, y: 394, w: 48, str: "1693.00C" },
  { x: 50, y: 382, w: 120, str: "06/06/2026 MELT SEAL" }, { x: 416, y: 382, w: 30, str: "91.00" },
  { x: 116, y: 370, w: 144, str: "BEING THE TDS 9068.75@1%" },
  { x: 116, y: 358, w: 54, str: "B NO. 161" },
  { x: 50, y: 346, w: 108, str: "06/06/2026 Journal" }, { x: 326, y: 346, w: 42, str: "1693.00" }, { x: 494, y: 346, w: 36, str: "91.00C" },
  { x: 50, y: 334, w: 120, str: "10/06/2026 MELT SEAL" }, { x: 410, y: 334, w: 36, str: "256.00" },
  { x: 116, y: 322, w: 150, str: "BEING THE TDS 25624.39@1%" },
  { x: 116, y: 310, w: 54, str: "B NO. 171" }, { x: 488, y: 310, w: 42, str: "347.00C" },
  { x: 50, y: 298, w: 120, str: "18/06/2026 MELT SEAL" }, { x: 410, y: 298, w: 36, str: "314.00" },
  { x: 116, y: 286, w: 132, str: "BEING THE TDS 31443@1%" },
  { x: 116, y: 274, w: 54, str: "B NO. 188" }, { x: 488, y: 274, w: 42, str: "661.00C" },
  { x: 50, y: 262, w: 156, str: "19/06/2026 SHILPI GRAPHICS" }, { x: 410, y: 262, w: 36, str: "108.00" },
  { x: 116, y: 250, w: 42, str: "5415@2%" },
  { x: 116, y: 238, w: 54, str: "B NO. 511" }, { x: 488, y: 238, w: 42, str: "769.00C" },
  { x: 50, y: 226, w: 120, str: "25/06/2026 MELT SEAL" }, { x: 410, y: 226, w: 36, str: "105.00" },
  { x: 116, y: 214, w: 150, str: "BEING THE TDS 10454.40@1%" },
  { x: 116, y: 202, w: 54, str: "B NO. 208" }, { x: 488, y: 202, w: 42, str: "874.00C" },
  { x: 50, y: 190, w: 120, str: "26/06/2026 MELT SEAL" }, { x: 410, y: 190, w: 36, str: "102.00" },
  { x: 116, y: 178, w: 132, str: "BEING THE TDS 10235@1%" },
  { x: 116, y: 166, w: 54, str: "B NO. 213" },
  { x: 50, y: 154, w: 156, str: "26/06/2026 SHILPI GRAPHICS" }, { x: 410, y: 154, w: 36, str: "145.00" },
  { x: 116, y: 142, w: 42, str: "7252@2%" },
  { x: 116, y: 130, w: 54, str: "B NO. 551" }, { x: 482, y: 130, w: 48, str: "1121.00C" },
  { x: 50, y: 106, w: 204, str: "30/06/2026 *** CLOSING BALANCE ***" }, { x: 326, y: 106, w: 42, str: "4970.00" }, { x: 404, y: 106, w: 42, str: "6091.00" }, { x: 482, y: 106, w: 48, str: "1121.00C" },
  { x: 50, y: 94, w: 480, str: "-".repeat(80) },
];

describe("parseExpertPdfPages — 194H (POINT PACKERS Q1 FY2026-27)", () => {
  const parsed = parseExpertPdfPages([PAGE_194H]);

  it("reads the section from the ledger's own title line", () => {
    expect(parsed.section).toBe("194H");
  });

  it("keeps only the two real deductions — Opening/Closing Balance and the Journal payment are dropped", () => {
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.skipped.balances).toBe(2);   // opening + closing
    expect(parsed.skipped.payments).toBe(1);   // the Journal challan payment
  });

  it("splits the glued 'date + party' token correctly and reads the Cr.Amount as the credit", () => {
    const [a, b] = parsed.rows;
    expect(a.date).toBe("29/04/2026");
    expect(a.party).toBe("PATEL PAYALBEN SUNILKUMAR");
    expect(a.credit).toBe(1333);
    expect(a.debit).toBeNull();
    expect(b.date).toBe("29/04/2026");
    expect(b.party).toBe("GORDHANBHAI PUNJABHAI PATEL");
    expect(b.credit).toBe(72);
  });

  it("captures narration with no bill reference at all — a bare rate line is still full narration, and no vch_no is fabricated", () => {
    const [a, b] = parsed.rows;
    expect(a.narration).toBe("BEING THE TDS 66637@2%");
    expect(a.vch_no).toBeNull();
    expect(b.narration).toBe("BEING THE TDS 3579@2%");
    expect(b.vch_no).toBeNull();
  });
});

describe("parseExpertPdfPages — 194J (POINT PACKERS Q1 FY2026-27)", () => {
  const parsed = parseExpertPdfPages([PAGE_194J]);

  it("reads the section from the ledger's own title line", () => {
    expect(parsed.section).toBe("194J");
  });

  it("keeps only the three real deductions to the same repeated party across different dates", () => {
    expect(parsed.rows).toHaveLength(3);
    expect(parsed.rows.every((r) => r.party === "V J DESAI & CO.")).toBe(true);
    expect(parsed.rows.map((r) => r.date)).toEqual(["30/04/2026", "31/05/2026", "30/06/2026"]);
    expect(parsed.rows.every((r) => r.credit === 2100)).toBe(true);
  });

  it("drops the ICICI bank-clearing entry and every Journal payment (Dr-only rows)", () => {
    // Opening/Closing Balance (2) — ICICI and the two Journal rows all have
    // no Cr.Amount at all, so they fall out via the credit-only filter, not
    // the balance-marker filter.
    expect(parsed.skipped.balances).toBe(2);
    expect(parsed.skipped.payments).toBe(3);
  });

  it("never mistakes the bare bill/cheque reference number '1798' inside the ICICI narration for an amount", () => {
    // If it had been, some row's debit/credit would spuriously read 1798.
    for (const r of parsed.rows) {
      expect(r.debit).not.toBe(1798);
      expect(r.credit).not.toBe(1798);
    }
  });

  it("captures identical narration text independently per row, scoped correctly across 3 repeated same-party entries", () => {
    expect(parsed.rows.every((r) => r.narration === "BEING THE TDS 21000@10%")).toBe(true);
  });
});

describe("parseExpertPdfPages — 194Q (POINT PACKERS Q1 FY2026-27)", () => {
  const parsed = parseExpertPdfPages([PAGE_194Q]);

  it("reads the section from the ledger's own title line, including the parenthetical suffix", () => {
    expect(parsed.section).toBe("194Q");
  });

  it("keeps the two real deductions despite their gross-amount narration wrapping mid-number across three lines", () => {
    expect(parsed.rows).toHaveLength(2);
    const [a, b] = parsed.rows;
    expect(a.party).toBe("HI-TECH INKS PVT.LTD");
    expect(a.credit).toBe(325);
    expect(b.party).toBe("IKON MULTIPACK");
    expect(b.credit).toBe(3471);
  });

  it("never extracts a figure from the word-wrapped purchase-total formula narration", () => {
    // "532474" / "7.50" / "847111" / "8.95" are fragments of a formula split
    // mid-number across lines — none of them may leak into debit/credit.
    for (const r of parsed.rows) {
      expect(r.debit).toBeNull();
      expect([325, 3471]).toContain(r.credit);
    }
  });

  it("still captures the full 3-line word-wrapped narration as display text, for both rows independently", () => {
    const [a, b] = parsed.rows;
    expect(a.narration).toBe("BEING THE TOTAL PUCHASE OF 01. 04.2026 TO 30.06.2026 = 532474 7.50-5000000=324747.50*0.100%");
    expect(b.narration).toBe("BEING THE TOTAL PUCHASE OF 01. 04.2026 TO 30.06.2026 = 847111 8.95-5000000=3471118.95*0.100%");
  });
});

describe("parseExpertPdfPages — 194C (POINT PACKERS Q1 FY2026-27)", () => {
  const parsed = parseExpertPdfPages([PAGE_194C]);

  it("reads the section from the ledger's own title line", () => {
    expect(parsed.section).toBe("194C");
  });

  it("keeps exactly the 14 real deductions and drops Opening/Closing Balance + the ICICI entry + both Journal payments", () => {
    expect(parsed.rows).toHaveLength(14);
    expect(parsed.skipped.balances).toBe(2);
    expect(parsed.skipped.payments).toBe(3);   // ICICI + 2× Journal
    const total = parsed.rows.reduce((s, r) => s + (r.credit ?? 0), 0);
    expect(total).toBeCloseTo(79 + 106 + 280 + 725 + 27 + 841 + 100 + 91 + 256 + 314 + 108 + 105 + 102 + 145, 2);
  });

  it("lifts the 'B NO. ####' bill reference out of two/three-line narration, for display only", () => {
    const melt09 = parsed.rows.find((r) => r.date === "09/04/2026");
    expect(melt09?.vch_no).toBe("17");
    const vintex15 = parsed.rows.find((r) => r.date === "15/05/2026");
    expect(vintex15?.vch_no).toBe("0258");
  });

  it("captures the full narration text (both lines joined), not just the bill reference", () => {
    const melt09 = parsed.rows.find((r) => r.date === "09/04/2026");
    expect(melt09?.narration).toBe("BEING THE TDS 7906.25@1% B NO. 17");
    // A bare "gross@rate%" narration (no "BEING THE TDS" prefix) is captured
    // just the same — SHILPI GRAPHICS' own convention.
    const shilpi03 = parsed.rows.find((r) => r.date === "03/05/2026");
    expect(shilpi03?.narration).toBe("36260@2% B NO. 260");
  });

  it("still recovers a row whose own balance is deferred to the NEXT entry's line (sparse balance printing)", () => {
    // "06/06/2026 MELT SEAL" prints no balance of its own — the very next
    // line ("06/06/2026 Journal") carries it instead. The row must still be
    // read correctly regardless.
    const melt0606 = parsed.rows.find((r) => r.date === "06/06/2026" && r.party === "MELT SEAL");
    expect(melt0606?.credit).toBe(91);
    expect(melt0606?.vch_no).toBe("161");
  });

  it("handles two same-day entries for different parties without cross-contamination", () => {
    const shilpi2606 = parsed.rows.find((r) => r.date === "26/06/2026" && r.party === "SHILPI GRAPHICS");
    const melt2606 = parsed.rows.find((r) => r.date === "26/06/2026" && r.party === "MELT SEAL");
    expect(shilpi2606?.credit).toBe(145);
    expect(melt2606?.credit).toBe(102);
  });
});

describe("parseExpertPdfPages — robustness", () => {
  it("returns an issue and no rows for a PDF with no recognisable Expert ledger header", () => {
    const parsed = parseExpertPdfPages([[{ x: 50, y: 700, w: 100, str: "Not a ledger at all" }]]);
    expect(parsed.rows).toHaveLength(0);
    expect(parsed.section).toBeNull();
    expect(parsed.issues.length).toBeGreaterThan(0);
  });

  it("normalises dd/mm/yyyy dates to ISO", () => {
    const parsed = parseExpertPdfPages([PAGE_194C]);
    const melt09 = parsed.rows.find((r) => r.date === "09/04/2026");
    expect(melt09?.iso).toBe("2026-04-09");
  });
});
