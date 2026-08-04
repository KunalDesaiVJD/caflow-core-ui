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

  // The Protean "Tax Invoice cum Token Number" receipt (Income-tax Act, 2025,
  // seen from FY2026-27 Q1) — a THIRD template, distinct from both the
  // e-filing-portal ones above. Byte-faithful reproduction of a real
  // receipt's pdf.js coordinates (PRINCIPAL COMMISSIONER OF INCOME TAX
  // (REAC) AHMEDABAD, 334899600554750, 24Q Q1 FY2026-27). It never prints
  // "Acknowledgement Number" anywhere — the value is a plain column entry,
  // left-aligned under the wrapped "Tax Invoice cum Token / Number" header,
  // three bands below it (the header itself wraps across three lines before
  // the value row starts).
  it("reads the acknowledgement number from the Protean 'Tax Invoice cum Token Number' column, with no 'Acknowledgement Number' label anywhere", () => {
    const items: PdfTextItem[] = [
      cell(24, 751, "Tax Invoice cum Token"), cell(411, 751, "GSTIN of"), cell(485, 751, "Receipt no.(note i) (to"),
      cell(120, 746, "Name of Deductor"),
      cell(51, 742, "Number"), cell(485, 742, "be quoted on TDS"),
      cell(393, 741, "Deductor/Collector"),
      cell(120, 722, "PRINCIPAL COMMISSIONER OF INCOMETAX REAC AHMEDABAD 01"),
      cell(20, 721, "334899600554750"), cell(385, 721, "NA"), cell(485, 721, "QWIMJVUD"),
    ];
    expect(extractAckNumber([items])).toBe("334899600554750");
  });
});

describe("extractAckFields", () => {
  // Faithful reproduction of the raw band dump from a genuine Form 24Q
  // e-filing acknowledgement (Form 24Q_ARN_770000388680821.pdf) — same y
  // spacing order as the real receipt's "Label : Value" rows, each label and
  // value split into the same number of pdf.js text runs the real file
  // produced (e.g. "Form" + "No." as two runs, "PAN/TAN" as one).
  //
  // Includes the FULL "Form Description" field exactly as printed on the
  // real receipt, wrapping across three separate visual rows (bands) between
  // "Form No." and "Assessment Year":
  //
  //   Form Description : Quarterly statement of deduction of tax under
  //   sub-section (3) of section 200 of the Income-tax Act, 1961 in respect
  //   of salary for the quarter ended June/September/December/March
  //   (Financial year)
  //
  // Its third line starts with the bare, lowercase, colon-less word
  // "quarter" — this is the exact real-world text that collided with the
  // genuine "Quarter : Q4" row further down the page before the fix.
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
    // "Form Description" — full real paragraph, wrapping across 3 bands.
    cell(40, 470.0, "Form"), cell(90, 470.0, "Description"), cell(150, 470.0, ":"),
    cell(170, 470.0, "Quarterly"), cell(230, 470.0, "statement"), cell(300, 470.0, "of"), cell(320, 470.0, "deduction"),
    cell(390, 470.0, "of"), cell(410, 470.0, "tax"), cell(440, 470.0, "under"), cell(480, 470.0, "sub-section"),
    cell(550, 470.0, "(3)"), cell(580, 470.0, "of"),
    cell(170, 452.0, "section"), cell(220, 452.0, "200"), cell(250, 452.0, "of"), cell(270, 452.0, "the"),
    cell(300, 452.0, "Income-tax"), cell(360, 452.0, "Act,"), cell(390, 452.0, "1961"), cell(430, 452.0, "in"),
    cell(450, 452.0, "respect"), cell(500, 452.0, "of"), cell(520, 452.0, "salary"), cell(560, 452.0, "for"), cell(590, 452.0, "the"),
    cell(170, 434.0, "quarter"), cell(220, 434.0, "ended"), cell(260, 434.0, "June/September/December/March"),
    cell(430, 434.0, "(Financial"), cell(480, 434.0, "year)"),
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

  it("does not let the 'Form Description' boilerplate's 'quarter ended June/September/December/March (Financial year)' line shadow the genuine 'Quarter : Q4' row", () => {
    // Regression test for a real bug: the Form Description field's 3rd wrapped
    // line starts with the bare, lowercase, colon-less word "quarter" and
    // sits ABOVE the genuine "Quarter : Q4" row on the page. A label match
    // that only checked "does this band's text start with /^Quarter\b/i"
    // (no colon requirement) matched that boilerplate line FIRST and returned
    // "ended June/September/December/March (Financial year)" as the
    // extracted quarter — a false-positive mismatch against a fully correct
    // upload. The `items` fixture above includes the full real paragraph;
    // this asserts the genuine value still wins.
    expect(extractAckFields([items]).quarter).toBe("Q4");
  });

  it("rejects a label-like prose line for ANY field, not just Quarter, when it lacks a colon separator", () => {
    // Same class of bug, made generic: a band whose text merely STARTS with
    // a label word (Name/Financial Year/Form No./PAN-TAN) but isn't actually
    // a "label: value" row (no colon right after the label) must never be
    // mistaken for the real field — mirroring the Quarter collision above,
    // for every other label extractLabelledValue() supports.
    const prose: PdfTextItem[] = [
      cell(40, 500, "Name"), cell(90, 500, "of"), cell(110, 500, "the"), cell(130, 500, "deductor"), cell(190, 500, "as"), cell(220, 500, "per"), cell(250, 500, "PAN"),
      cell(40, 480, "Financial"), cell(100, 480, "Year"), cell(150, 480, "beginning"), cell(230, 480, "April"),
      cell(40, 460, "Form"), cell(80, 460, "No"), cell(110, 460, "provided"), cell(170, 460, "for"), cell(200, 460, "reference"),
      cell(40, 440, "PAN/TAN"), cell(110, 440, "as"), cell(140, 440, "applicable"),
      cell(40, 420, "Quarter"), cell(90, 420, "wise"), cell(130, 420, "breakup"), cell(190, 420, "below"),
    ];
    expect(extractAckFields([prose])).toEqual({
      ackNumber: null, name: null, financialYear: null, quarter: null, formNo: null, tan: null,
    });
  });
});

describe("extractAckFields — the newer 'Acknowledgement Receipt of Income Tax Forms (Other Than Income Tax Return)' template", () => {
  // Faithful reproduction of the raw band dump from a genuine receipt (Form
  // 140_ARN_770000408905932.pdf, ATC LOGISTICS, Tax Year 2026-27 Q1) — first
  // seen starting Tax Year 2026-27, apparently tied to the new Income Tax
  // Act 2025 renumbering (this receipt cites "section 397(3)(b)", not the
  // old Act's 200(3)). Two real differences from the older Form 24Q/26Q
  // template pinned above: (1) "Form No. : Form 140" — a bare portal CODE,
  // not the familiar 24Q/26Q/27Q/27EQ label (see ackMismatch.ts's own
  // FORM_NO_PORTAL_ALIASES for why "140" genuinely means 26Q here); (2)
  // "Financial Year : -" is blank, with the real year under "Tax Year"
  // instead; (3) the PAN/TAN row is labelled "PAN/TAN/Other ID :".
  const items: PdfTextItem[] = [
    cell(40, 681.3, "e-Filing"), cell(120, 681.3, "Acknowledgement"), cell(280, 681.3, "Number"),
    cell(500, 681.3, "Date"), cell(540, 681.3, "of"), cell(570, 681.3, "e-Filing"),
    cell(40, 662.7, "796898970300726"), cell(500, 662.7, "30-Jul-2026"),
    cell(40, 645.5, "RRR"), cell(100, 645.5, "Number"),
    cell(40, 626.9, "770000408905932"),
    cell(40, 588.9, "Name"), cell(90, 588.9, ":"), cell(110, 588.9, "Atc"), cell(140, 588.9, "Logistics"),
    cell(40, 562.3, "PAN/TAN/Other"), cell(160, 562.3, "ID"), cell(180, 562.3, ":"), cell(200, 562.3, "AHMA14484B"),
    cell(40, 535.7, "Address"), cell(90, 535.7, "of"), cell(120, 535.7, "the"), cell(150, 535.7, "assessee"), cell(210, 535.7, ":"),
    cell(230, 535.7, "216, SUNRISE SHOPPING MALL,JUDGES BUNGLOW ROAD,ahmedabad,VASTRAPUR"),
    cell(40, 496.8, "Form"), cell(75, 496.8, "No."), cell(100, 496.8, ":"), cell(120, 496.8, "Form"), cell(150, 496.8, "140"),
    cell(40, 470.0, "Form"), cell(90, 470.0, "Description"), cell(150, 470.0, ":"),
    cell(170, 470.0, "Quarterly"), cell(230, 470.0, "statement"), cell(300, 470.0, "of"), cell(320, 470.0, "deduction"),
    cell(390, 470.0, "of"), cell(410, 470.0, "tax"), cell(440, 470.0, "under"), cell(480, 470.0, "section"), cell(520, 470.0, "397(3)(b)"),
    cell(170, 452.0, "in"), cell(190, 452.0, "respect"), cell(240, 452.0, "of"), cell(260, 452.0, "payments"),
    cell(320, 452.0, "made"), cell(360, 452.0, "other"), cell(400, 452.0, "than"), cell(430, 452.0, "salary"),
    cell(40, 419.0, "Tax"), cell(80, 419.0, "Year"), cell(120, 419.0, ":"), cell(140, 419.0, "2026-27"),
    cell(40, 392.4, "Financial"), cell(100, 392.4, "Year"), cell(150, 392.4, ":"), cell(170, 392.4, "-"),
    cell(40, 365.8, "Quarter"), cell(100, 365.8, ":"), cell(120, 365.8, "Q1"),
    cell(40, 339.2, "Month"), cell(90, 339.2, ":"), cell(110, 339.2, "-"),
  ];

  it("extracts Financial Year via the Tax Year fallback, PAN/TAN via the '/Other ID' label variant, and the bare portal Form code", () => {
    expect(extractAckFields([items])).toEqual({
      ackNumber: "796898970300726",
      name: "Atc Logistics",
      financialYear: "2026-27",
      quarter: "Q1",
      formNo: "140",
      tan: "AHMA14484B",
    });
  });
});

describe("extractAckFields — the Protean 'Tax Invoice cum Token Number' template", () => {
  // Byte-faithful reproduction of a real receipt's pdf.js coordinates
  // (PRINCIPAL COMMISSIONER OF INCOME TAX (REAC) AHMEDABAD, 334899600554750,
  // 24Q Q1 FY2026-27 — "Form No" prints the bare portal code "138", already
  // mapped to 24Q in ackMismatch.ts's FORM_NO_PORTAL_ALIASES). No field here
  // is a "Label : Value" row — every one is a column value, left-aligned
  // under its own header, on the row(s) directly below it.
  const items: PdfTextItem[] = [
    cell(24, 751, "Tax Invoice cum Token"), cell(411, 751, "GSTIN of"), cell(485, 751, "Receipt no.(note i) (to"),
    cell(120, 746, "Name of Deductor"),
    cell(51, 742, "Number"), cell(485, 742, "be quoted on TDS"),
    cell(393, 741, "Deductor/Collector"),
    cell(120, 722, "PRINCIPAL COMMISSIONER OF INCOMETAX REAC AHMEDABAD 01"),
    cell(20, 721, "334899600554750"), cell(385, 721, "NA"), cell(485, 721, "QWIMJVUD"),
    cell(20, 699, "Date"), cell(120, 699, "TAN"), cell(205, 699, "AO Code"), cell(270, 699, "Form No"),
    cell(320, 699, "Periodicity"), cell(380, 699, "Type of Statement"), cell(485, 699, "Tax Year"),
    cell(20, 679, "31 July 2026"), cell(120, 679, "AHMP14665A"), cell(205, 679, "GUJWT1471"), cell(270, 679, "138"),
    cell(320, 679, "Q1"), cell(380, 679, "Regular"), cell(485, 679, "2026-27"),
  ];

  it("extracts Ack No./Name/TAN/Form No./Quarter/Tax Year purely from column position, with zero 'Label : Value' rows on the page", () => {
    expect(extractAckFields([items])).toEqual({
      ackNumber: "334899600554750",
      name: "PRINCIPAL COMMISSIONER OF INCOMETAX REAC AHMEDABAD 01",
      financialYear: "2026-27",
      quarter: "Q1",
      formNo: "138",
      tan: "AHMP14665A",
    });
  });

  it("never lets the identity-table fallback fire on the older 'PAN/TAN :' template (no bare 'TAN' run to anchor on)", () => {
    // Regression guard for extractIdentityColumnTable's own safety claim: the
    // older templates' PAN/TAN row is always ONE combined string, never a
    // standalone "TAN" text run, so the fallback must stay silent here and
    // the label-based reader's own real answer must come through unchanged.
    const older: PdfTextItem[] = [
      cell(40, 700, "Name"), cell(70, 700, ":"), cell(90, 700, "Some"), cell(140, 700, "Client"),
      cell(40, 670, "PAN/TAN"), cell(100, 670, ":"), cell(120, 670, "AAAPA1111A"),
      cell(40, 640, "Financial"), cell(100, 640, "Year"), cell(150, 640, ":"), cell(170, 640, "2025-26"),
      cell(40, 610, "Quarter"), cell(70, 610, ":"), cell(90, 610, "Q2"),
      cell(40, 580, "Form"), cell(75, 580, "No."), cell(100, 580, ":"), cell(120, 580, "24Q"),
    ];
    const fields = extractAckFields([older]);
    expect(fields.tan).toBe("AAAPA1111A");
    expect(fields.quarter).toBe("Q2");
    expect(fields.formNo).toBe("24Q");
  });
});
