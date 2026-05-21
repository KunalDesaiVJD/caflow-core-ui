/**
 * nceFinancialsDocx.ts
 * Big4-style Word (.docx) export for NCE Financial Statements.
 *
 * Phase 1: Balance Sheet (page 1) + Profit & Loss (page 2) + Signature block
 *
 * Uses the `docx` npm package (already installed in this project).
 * No new dependencies required.
 */

import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Packer,
  PageNumber,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
} from "docx";

// ─── Layout (all DXA: 1 inch = 1440 DXA) ─────────────────────────────────────
const A4_W   = 11906;           // A4 width
const A4_H   = 16838;           // A4 height
const MARG_H = 720;             // 0.5" left/right
const MARG_T = 720;             // 0.5" top
const MARG_B = 900;             // ~0.625" bottom (room for footer)
const TW     = A4_W - MARG_H * 2; // 10466 DXA — usable table width

// Columns: [Particulars, Note No., CY Amount, PY Amount]  →  must sum to TW
const CW_DESC = 7100;
const CW_NOTE = 400;
const CW_CY   = 1483;
const CW_PY   = 1483;
// 7100 + 400 + 1483 + 1483 = 10466 ✓

// ─── Typography ───────────────────────────────────────────────────────────────
const FONT     = "Arial";
const SZ_XS    = 14;   // 7pt  — footnotes
const SZ_SM    = 16;   // 8pt  — column headers, footer
const SZ_BODY  = 18;   // 9pt  — data rows
const SZ_HDR   = 20;   // 10pt — section labels
const SZ_TITLE = 22;   // 11pt — entity name / page title

// ─── Colour palette ───────────────────────────────────────────────────────────
const NAVY    = "1F3864";   // deep navy  — brand colour
const BG_HDR  = "1F3864";   // column header background
const BG_SECT = "D6E4F0";   // section row (light blue)
const BG_TOT  = "EBF1FA";   // subtotal row (slightly lighter)
const BG_GRAN = "D9E2F3";   // grand total row
const DK_GREY = "505050";   // secondary text
const BLACK   = "000000";
const WHITE   = "FFFFFF";

// ─── Border helpers ───────────────────────────────────────────────────────────
const bNone = { style: BorderStyle.NONE,   size: 0, color: "FFFFFF" };
const bHair = { style: BorderStyle.SINGLE, size: 2, color: "CBCBCB" };  // hairline row separator
const bThin = { style: BorderStyle.SINGLE, size: 4, color: NAVY };       // section top border
const bBold = { style: BorderStyle.SINGLE, size: 8, color: NAVY };       // grand total border

const BDR_NONE  = { top: bNone, bottom: bNone, left: bNone, right: bNone };
const BDR_ROW   = { top: bNone, bottom: bHair, left: bNone, right: bNone };
const BDR_SECT  = { top: bThin, bottom: bNone, left: bNone, right: bNone };
const BDR_SUB   = { top: bThin, bottom: bThin, left: bNone, right: bNone };
const BDR_GRAND = { top: bBold, bottom: bBold, left: bNone, right: bNone };

// ─── Amount formatter — Indian numbering system ───────────────────────────────
function fmt(n: number): string {
  if (n === 0) return "—";
  const abs = Math.round(Math.abs(n));
  // en-IN gives 1,23,456 format
  const str = abs.toLocaleString("en-IN");
  return n < 0 ? `(${str})` : str;
}

// Sign helpers — Tally stores credits as negative, debits as positive
/** Liabilities / equity: stored as credit (negative) → flip sign for display */
function L(code: string, amts: Record<string, number>): number {
  return -(amts[code] ?? 0);
}
/** Assets / expenses: stored as debit (positive) → direct */
function A(code: string, amts: Record<string, number>): number {
  return amts[code] ?? 0;
}
/** Income: stored as credit (negative) → flip sign for display */
function I(code: string, amts: Record<string, number>): number {
  return -(amts[code] ?? 0);
}

// ─── Cell builder ─────────────────────────────────────────────────────────────
interface CellOpts {
  w: number;
  text: string;
  sz?: number;
  bold?: boolean;
  italic?: boolean;
  color?: string;
  align?: AlignmentType;
  bg?: string;
  borders?: Record<string, typeof bNone>;
  padL?: number;
  padR?: number;
  indent?: number;   // each level = 200 DXA additional left pad
  colSpan?: number;
}

function cell(o: CellOpts): TableCell {
  const {
    w, text,
    sz     = SZ_BODY,
    bold   = false,
    italic = false,
    color  = BLACK,
    align  = AlignmentType.LEFT,
    bg,
    borders = BDR_ROW,
    padL    = 80,
    padR    = 80,
    indent  = 0,
    colSpan,
  } = o;

  return new TableCell({
    ...(colSpan ? { columnSpan: colSpan } : {}),
    width:   { size: w, type: WidthType.DXA },
    shading: bg ? { fill: bg, type: ShadingType.CLEAR } : undefined,
    borders,
    margins: { top: 36, bottom: 36, left: padL + indent * 200, right: padR },
    verticalAlign: VerticalAlign.CENTER,
    children: [new Paragraph({
      alignment: align,
      spacing:   { before: 0, after: 0, line: 260, lineRule: "auto" as any },
      children: [new TextRun({ text, font: FONT, size: sz, bold, italic, color })],
    })],
  });
}

/** Amount cell — right-aligned */
function ac(
  val: number,
  w: number,
  opts: { bold?: boolean; bg?: string; borders?: Record<string, typeof bNone> } = {},
): TableCell {
  return cell({
    text:    fmt(val),
    w,
    align:   AlignmentType.RIGHT,
    padL:    20,
    padR:    120,
    bold:    opts.bold,
    bg:      opts.bg,
    borders: opts.borders ?? BDR_ROW,
  });
}

/** Empty placeholder cell */
function ec(w: number, bg?: string, borders?: Record<string, typeof bNone>): TableCell {
  return cell({ text: "", w, bg, borders: borders ?? BDR_ROW });
}

// ─── Standard row factories ───────────────────────────────────────────────────

/** Dark navy column-header row */
function colHeaderRow(cyLabel: string, pyLabel: string): TableRow {
  const hOpts = (text: string, align = AlignmentType.LEFT): TableCell =>
    cell({ text, w: 0, sz: SZ_SM, bold: true, color: WHITE, bg: BG_HDR, borders: BDR_NONE, align });

  return new TableRow({
    tableHeader: true,
    children: [
      cell({ text: "Particulars",    w: CW_DESC, sz: SZ_SM, bold: true, color: WHITE, bg: BG_HDR, borders: BDR_NONE, padL: 100 }),
      cell({ text: "Note\nNo.",      w: CW_NOTE, sz: SZ_SM, bold: true, color: WHITE, bg: BG_HDR, borders: BDR_NONE, align: AlignmentType.CENTER }),
      cell({ text: `${cyLabel}\n(₹)`, w: CW_CY,  sz: SZ_SM, bold: true, color: WHITE, bg: BG_HDR, borders: BDR_NONE, align: AlignmentType.RIGHT, padR: 120 }),
      cell({ text: `${pyLabel}\n(₹)`, w: CW_PY,  sz: SZ_SM, bold: true, color: WHITE, bg: BG_HDR, borders: BDR_NONE, align: AlignmentType.RIGHT, padR: 120 }),
    ],
  });
}

/** Full-width section label (e.g. "EQUITY AND LIABILITIES") */
function sectionRow(label: string): TableRow {
  return new TableRow({
    children: [
      new TableCell({
        columnSpan: 4,
        width:   { size: TW, type: WidthType.DXA },
        shading: { fill: BG_SECT, type: ShadingType.CLEAR },
        borders: BDR_SECT,
        margins: { top: 60, bottom: 60, left: 100, right: 100 },
        children: [new Paragraph({
          spacing: { before: 0, after: 0 },
          children: [new TextRun({ text: label, font: FONT, size: SZ_HDR, bold: true, color: NAVY })],
        })],
      }),
    ],
  });
}

/** Sub-section parent label (no amounts) */
function parentRow(label: string, indent = 0): TableRow {
  return new TableRow({
    children: [
      new TableCell({
        columnSpan: 4,
        width:   { size: TW, type: WidthType.DXA },
        borders: BDR_ROW,
        margins: { top: 30, bottom: 30, left: 100 + indent * 200, right: 80 },
        children: [new Paragraph({
          spacing: { before: 0, after: 0, line: 260, lineRule: "auto" as any },
          children: [new TextRun({ text: label, font: FONT, size: SZ_BODY, bold: true, color: BLACK })],
        })],
      }),
    ],
  });
}

/** Data item row: label | note no. | CY | PY */
function dataRow(
  label: string,
  noteNo: number | null,
  cy: number,
  py: number,
  indent = 0,
  bg?: string,
): TableRow {
  return new TableRow({
    children: [
      cell({ text: label, w: CW_DESC, indent, bg, borders: BDR_ROW }),
      cell({
        text: noteNo ? String(noteNo) : "",
        w: CW_NOTE,
        align: AlignmentType.CENTER,
        bold: true,
        color: noteNo ? NAVY : BLACK,
        bg,
        borders: BDR_ROW,
      }),
      ac(cy, CW_CY, { bg }),
      ac(py, CW_PY, { bg }),
    ],
  });
}

/** Subtotal row (thin top + bottom border) */
function subTotalRow(label: string, cy: number, py: number): TableRow {
  return new TableRow({
    children: [
      cell({ text: label, w: CW_DESC, bold: true, bg: BG_TOT, borders: BDR_SUB }),
      ec(CW_NOTE, BG_TOT, BDR_SUB),
      ac(cy, CW_CY, { bold: true, bg: BG_TOT, borders: BDR_SUB }),
      ac(py, CW_PY, { bold: true, bg: BG_TOT, borders: BDR_SUB }),
    ],
  });
}

/** Grand total row (bold navy border) */
function grandTotalRow(label: string, cy: number, py: number): TableRow {
  return new TableRow({
    children: [
      cell({ text: label, w: CW_DESC, bold: true, sz: SZ_HDR, bg: BG_GRAN, borders: BDR_GRAND, padL: 100 }),
      ec(CW_NOTE, BG_GRAN, BDR_GRAND),
      ac(cy, CW_CY, { bold: true, bg: BG_GRAN, borders: BDR_GRAND }),
      ac(py, CW_PY, { bold: true, bg: BG_GRAN, borders: BDR_GRAND }),
    ],
  });
}

/** Blank spacer row (very small height) */
function blankRow(): TableRow {
  return new TableRow({
    children: [
      cell({ text: "", w: CW_DESC, sz: 10, borders: BDR_NONE }),
      cell({ text: "", w: CW_NOTE, sz: 10, borders: BDR_NONE }),
      cell({ text: "", w: CW_CY,   sz: 10, borders: BDR_NONE }),
      cell({ text: "", w: CW_PY,   sz: 10, borders: BDR_NONE }),
    ],
  });
}

/** Title + subtitle header rows for each statement */
function titleRows(
  entityName: string,
  statementTitle: string,
  subtitle: string,
): TableRow[] {
  return [
    // Row 1 — Entity name (left) + Statement title (right)
    new TableRow({
      children: [
        new TableCell({
          columnSpan: 4,
          width:   { size: TW, type: WidthType.DXA },
          borders: BDR_NONE,
          margins: { top: 60, bottom: 10, left: 100, right: 100 },
          children: [new Paragraph({
            tabStops: [{ type: "right" as any, position: TW - 200 }],
            spacing: { before: 0, after: 0 },
            children: [
              new TextRun({ text: entityName.toUpperCase(), font: FONT, size: SZ_TITLE, bold: true, color: NAVY }),
              new TextRun({ text: "\t",                      font: FONT, size: SZ_TITLE }),
              new TextRun({ text: statementTitle,            font: FONT, size: SZ_TITLE, bold: true, color: NAVY }),
            ],
          })],
        }),
      ],
    }),
    // Row 2 — Subtitle with bottom border
    new TableRow({
      children: [
        new TableCell({
          columnSpan: 4,
          width:   { size: TW, type: WidthType.DXA },
          borders: { top: bNone, bottom: bBold, left: bNone, right: bNone },
          margins: { top: 0, bottom: 60, left: 100, right: 100 },
          children: [new Paragraph({
            spacing: { before: 0, after: 0 },
            children: [new TextRun({ text: subtitle, font: FONT, size: SZ_SM, italic: true, color: DK_GREY })],
          })],
        }),
      ],
    }),
  ];
}

// ─── BALANCE SHEET TABLE ──────────────────────────────────────────────────────
function buildBSTable(
  cy: Record<string, number>,
  py: Record<string, number>,
  cyYear: string,
  pyYear: string,
  entityName: string,
  noteMap: Record<number, number>,
): Table {
  const n = (ref: number | null) => (ref ? (noteMap[ref] ?? ref) : null);

  // Totals
  const totELcy = L("NCE_EL",  cy);
  const totELpy = L("NCE_EL",  py);
  const totAcy  = A("NCE_AST", cy);
  const totApy  = A("NCE_AST", py);

  const rows: TableRow[] = [
    ...titleRows(
      entityName,
      "BALANCE SHEET",
      `As at 31 March ${cyYear}   |   All amounts in ₹`,
    ),
    colHeaderRow(`As at 31 Mar ${cyYear}`, `As at 31 Mar ${pyYear}`),

    // ── EQUITY AND LIABILITIES ────────────────────────────────────────────
    sectionRow("EQUITY AND LIABILITIES"),

    parentRow("(1)  Owners Funds"),
    dataRow("        (a)  Owners' Capital Account", n(2), L("NCE_CAP", cy), L("NCE_CAP", py), 0),

    parentRow("(2)  Non-Current Liabilities"),
    dataRow("        (a)  Long-term borrowings",         n(3), L("NCE_LTB",  cy), L("NCE_LTB",  py)),
    dataRow("        (b)  Other long-term liabilities",  n(4), L("NCE_OLTL", cy), L("NCE_OLTL", py)),
    dataRow("        (c)  Long-term provisions",         n(5), L("NCE_LTP",  cy), L("NCE_LTP",  py)),

    parentRow("(3)  Current Liabilities"),
    dataRow("        (a)  Short-term borrowings",        n(6), L("NCE_STB", cy), L("NCE_STB", py)),
    dataRow("        (b)  Trade payables",               n(7), L("NCE_TP",  cy), L("NCE_TP",  py)),
    dataRow("        (c)  Other current liabilities",    n(8), L("NCE_OCL", cy), L("NCE_OCL", py)),
    dataRow("        (d)  Short-term provisions",        n(9), L("NCE_STP", cy), L("NCE_STP", py)),

    blankRow(),
    grandTotalRow("TOTAL EQUITY AND LIABILITIES", totELcy, totELpy),
    blankRow(),

    // ── ASSETS ───────────────────────────────────────────────────────────
    sectionRow("ASSETS"),

    parentRow("(1)  Non-Current Assets"),
    dataRow("        (a)(i)    Property, plant and equipment",    n(10), A("NCE_PPE",   cy), A("NCE_PPE",   py)),
    dataRow("        (a)(ii)   Capital work-in-progress",         n(11), A("NCE_CWIP",  cy), A("NCE_CWIP",  py)),
    dataRow("        (a)(iii)  Intangible assets",                n(12), A("NCE_INTG",  cy), A("NCE_INTG",  py)),
    dataRow("        (b)       Non-current investments",          n(13), A("NCE_NCINV", cy), A("NCE_NCINV", py)),
    dataRow("        (c)       Long-term loans and advances",     n(14), A("NCE_LTLA",  cy), A("NCE_LTLA",  py)),
    dataRow("        (d)       Other non-current assets",         n(15), A("NCE_ONCA",  cy), A("NCE_ONCA",  py)),

    parentRow("(2)  Current Assets"),
    dataRow("        (a)  Current investments",                   n(16), A("NCE_CINV", cy), A("NCE_CINV", py)),
    dataRow("        (b)  Inventories",                           n(17), A("NCE_STCK", cy), A("NCE_STCK", py)),
    dataRow("        (c)  Trade receivables",                     n(18), A("NCE_TR",   cy), A("NCE_TR",   py)),
    dataRow("        (d)  Cash and bank balances",                n(19), A("NCE_CASH", cy), A("NCE_CASH", py)),
    dataRow("        (e)  Short-term loans and advances",         n(20), A("NCE_STLA", cy), A("NCE_STLA", py)),
    dataRow("        (f)  Other current assets",                  n(21), A("NCE_OCA",  cy), A("NCE_OCA",  py)),

    blankRow(),
    grandTotalRow("TOTAL ASSETS", totAcy, totApy),
    blankRow(),

    // ── Footnote ─────────────────────────────────────────────────────────
    new TableRow({
      children: [
        new TableCell({
          columnSpan: 4,
          width:   { size: TW, type: WidthType.DXA },
          borders: BDR_NONE,
          margins: { top: 40, bottom: 20, left: 100, right: 100 },
          children: [new Paragraph({
            spacing: { before: 0, after: 0 },
            children: [
              new TextRun({ text: `Note ${n(1) ?? 1}  `, font: FONT, size: SZ_XS, bold: true, color: NAVY }),
              new TextRun({
                text: "Significant Accounting Policies and Notes to Accounts form an integral part of the Financial Statements.",
                font: FONT, size: SZ_XS, italic: true, color: DK_GREY,
              }),
            ],
          })],
        }),
      ],
    }),
  ];

  return new Table({
    width:        { size: TW, type: WidthType.DXA },
    columnWidths: [CW_DESC, CW_NOTE, CW_CY, CW_PY],
    rows,
  });
}

// ─── PROFIT & LOSS TABLE ──────────────────────────────────────────────────────
function buildPLTable(
  cy: Record<string, number>,
  py: Record<string, number>,
  cyYear: string,
  pyYear: string,
  entityName: string,
  noteMap: Record<number, number>,
): Table {
  const n = (ref: number | null) => (ref ? (noteMap[ref] ?? ref) : null);

  // Income
  const revOpsCy = I("NCE_REV_OPS", cy);  const revOpsPy = I("NCE_REV_OPS", py);
  const revOthCy = I("NCE_REV_OTH", cy);  const revOthPy = I("NCE_REV_OTH", py);
  const totIncCy = revOpsCy + revOthCy;    const totIncPy = revOpsPy + revOthPy;

  // COGS includes changes in inventories (NCE_CII hidden from display but included in total)
  const cogsCy = A("NCE_COGS", cy) + A("NCE_CII", cy);
  const cogsPy = A("NCE_COGS", py) + A("NCE_CII", py);
  const empCy  = A("NCE_EMP_EXP",  cy);   const empPy  = A("NCE_EMP_EXP",  py);
  const finCy  = A("NCE_FIN_COST", cy);   const finPy  = A("NCE_FIN_COST", py);
  const depCy  = A("NCE_DEPR",     cy);   const depPy  = A("NCE_DEPR",     py);
  const othCy  = A("NCE_OTH_EXP",  cy);   const othPy  = A("NCE_OTH_EXP",  py);
  const totExpCy = cogsCy + empCy + finCy + depCy + othCy;
  const totExpPy = cogsPy + empPy + finPy + depPy + othPy;

  // Profit chain
  const pVcy   = totIncCy - totExpCy;         const pVpy   = totIncPy - totExpPy;
  // Exceptional / extraordinary: treat as income-convention (flip sign)
  const excCy  = I("NCE_EXCEP",  cy);          const excPy  = I("NCE_EXCEP",  py);
  const pVIIcy = pVcy + excCy;                 const pVIIpy = pVpy + excPy;
  const extCy  = I("NCE_EXTORD", cy);          const extPy  = I("NCE_EXTORD", py);
  const pIXcy  = pVIIcy + extCy;               const pIXpy  = pVIIpy + extPy;
  const remCy  = A("NCE_PART_REM", cy);        const remPy  = A("NCE_PART_REM", py);
  const pXIcy  = pIXcy - remCy;               const pXIpy  = pIXpy - remPy;
  const curTaxCy   = A("NCE_CUR_TAX",   cy);   const curTaxPy   = A("NCE_CUR_TAX",   py);
  const priorTaxCy = A("NCE_PRIOR_TAX", cy);   const priorTaxPy = A("NCE_PRIOR_TAX", py);
  const totTaxCy   = curTaxCy + priorTaxCy;    const totTaxPy   = curTaxPy + priorTaxPy;
  const netProfCy  = pXIcy - totTaxCy;         const netProfPy  = pXIpy - totTaxPy;

  const rows: TableRow[] = [
    ...titleRows(
      entityName,
      "PROFIT AND LOSS STATEMENT",
      `For the year ended 31 March ${cyYear}   |   All amounts in ₹`,
    ),
    colHeaderRow(`Year ended 31 Mar ${cyYear}`, `Year ended 31 Mar ${pyYear}`),

    // ── INCOME ───────────────────────────────────────────────────────────
    sectionRow("INCOME"),
    dataRow("I.    Revenue from operations", n(22), revOpsCy, revOpsPy),
    dataRow("II.   Other income",            n(23), revOthCy, revOthPy),
    subTotalRow("III.  Total Income  (I + II)", totIncCy, totIncPy),
    blankRow(),

    // ── EXPENSES ─────────────────────────────────────────────────────────
    sectionRow("EXPENSES"),
    dataRow("(a)   Cost of goods sold",             n(24), cogsCy, cogsPy),
    dataRow("(b)   Employee benefits expense",       n(25), empCy,  empPy),
    dataRow("(c)   Finance costs",                   n(26), finCy,  finPy),
    dataRow("(d)   Depreciation and amortisation",   n(27), depCy,  depPy),
    dataRow("(e)   Other expenses",                  n(28), othCy,  othPy),
    subTotalRow("IV.   Total Expenses", totExpCy, totExpPy),
    blankRow(),

    // ── Profit chain ─────────────────────────────────────────────────────
    dataRow(
      "V.    Profit / (Loss) before exceptional items, partners’ remuneration and tax  (III − IV)",
      null, pVcy, pVpy,
    ),
    dataRow("VI.   Exceptional items",                                                   null, excCy,   excPy),
    dataRow("VII.  Profit / (Loss) before extraordinary items and tax  (V + VI)",        null, pVIIcy, pVIIpy),
    dataRow("VIII. Extraordinary items",                                                 null, extCy,   extPy),
    dataRow("IX.   Profit / (Loss) before partners’ remuneration and tax  (VII + VIII)", null, pIXcy, pIXpy),
    dataRow("X.    Partners’ remuneration",                                         n(29), remCy,   remPy),
    dataRow("XI.   Profit / (Loss) before tax  (IX − X)",                          null, pXIcy,  pXIpy),
    blankRow(),

    parentRow("XII.  Tax expense"),
    dataRow("        (1)  Current tax",                                     null, curTaxCy,   curTaxPy,   1),
    dataRow("        (2)  Short / (excess) provision for earlier years",    null, priorTaxCy, priorTaxPy, 1),
    subTotalRow("             Total tax expense", totTaxCy, totTaxPy),
    blankRow(),

    grandTotalRow(
      "XIII. Profit / (Loss) for the year  (XI − XII)",
      netProfCy,
      netProfPy,
    ),
  ];

  return new Table({
    width:        { size: TW, type: WidthType.DXA },
    columnWidths: [CW_DESC, CW_NOTE, CW_CY, CW_PY],
    rows,
  });
}

// ─── SIGNATURE BLOCK ─────────────────────────────────────────────────────────
function buildSignatureTable(entityName: string, engagement: any): Table {
  // Pull from engagement — adapt field names as your schema evolves
  const caFirm    = engagement?.audit_firm_name      ?? engagement?.ca_firm_name       ?? "M/s _______________";
  const frn       = engagement?.firm_reg_no          ?? engagement?.frn                ?? "FRN: _______________";
  const partner   = engagement?.signing_partner_name ?? engagement?.partner_name       ?? "_______________";
  const memNo     = engagement?.membership_number    ?? engagement?.mem_no             ?? "M.No. _______________";
  const place     = engagement?.sign_off_place       ?? engagement?.clients?.city      ?? "_______________";
  const rawDate   = engagement?.sign_off_date;
  const reportDate = rawDate
    ? new Date(rawDate).toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" })
    : "_______________";

  const half = Math.floor(TW / 2);

  function sigLines(lines: Array<{ text: string; bold?: boolean; gap?: boolean }>): Paragraph[] {
    return lines.map(l => new Paragraph({
      spacing: { before: l.gap ? 200 : 0, after: 0 },
      children: [new TextRun({
        text:  l.text,
        font:  FONT,
        size:  SZ_SM,
        bold:  l.bold ?? false,
        color: l.bold ? NAVY : BLACK,
      })],
    }));
  }

  return new Table({
    width:        { size: TW, type: WidthType.DXA },
    columnWidths: [half, TW - half],
    rows: [
      new TableRow({
        children: [
          new TableCell({
            width:   { size: half, type: WidthType.DXA },
            borders: BDR_NONE,
            margins: { top: 80, bottom: 80, left: 80, right: 80 },
            children: sigLines([
              { text: "As per our report of even date", bold: true },
              { text: `For ${caFirm}`,                  bold: true, gap: true },
              { text: "Chartered Accountants" },
              { text: frn },
              { text: "____________________________",   gap: true },
              { text: partner,                          bold: true },
              { text: memNo },
              { text: `Date: ${reportDate}`,            gap: true },
              { text: `Place: ${place}` },
            ]),
          }),
          new TableCell({
            width:   { size: TW - half, type: WidthType.DXA },
            borders: BDR_NONE,
            margins: { top: 80, bottom: 80, left: 80, right: 80 },
            children: sigLines([
              { text: `For ${entityName}`, bold: true },
              { text: "____________________________", gap: true },
              { text: "Partner / Proprietor",         bold: true },
              { text: "____________________________", gap: true },
              { text: "Partner",                      bold: true },
              { text: `Date: ${reportDate}`,          gap: true },
              { text: `Place: ${place}` },
            ]),
          }),
        ],
      }),
    ],
  });
}

// ─── DOCUMENT FOOTER ─────────────────────────────────────────────────────────
function makeFooter(entityName: string): Footer {
  return new Footer({
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        border:    { top: { style: BorderStyle.SINGLE, size: 4, color: NAVY, space: 1 } },
        spacing:   { before: 80 },
        children: [
          new TextRun({ text: `${entityName}  |  Financial Statements  |  Page `, font: FONT, size: SZ_XS, color: DK_GREY }),
          new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: SZ_XS, color: DK_GREY }),
          new TextRun({ text: " of ",                  font: FONT, size: SZ_XS, color: DK_GREY }),
          new TextRun({ children: [PageNumber.TOTAL_PAGES], font: FONT, size: SZ_XS, color: DK_GREY }),
        ],
      }),
    ],
  });
}

// ─── PUBLIC API ───────────────────────────────────────────────────────────────
export interface NCEDocxParams {
  engagement: any;
  nceCyAmounts: Record<string, number>;
  ncePyAmounts: Record<string, number>;
  cyYear: string;
  pyYear: string;
  /** Dynamic note number map (static noteRef → display number).
   *  Pass `nceDynamicNoteMap` from PipelineFinancialStatements. */
  dynamicNoteMap?: Record<number, number>;
}

export async function generateNCEFinancialsDocx(params: NCEDocxParams): Promise<void> {
  const {
    engagement,
    nceCyAmounts,
    ncePyAmounts,
    cyYear,
    pyYear,
    dynamicNoteMap = {},
  } = params;

  const entityName = engagement?.clients?.name ?? "Entity Name";
  const fy         = engagement?.financial_year ?? `${Number(cyYear) - 1}-${cyYear}`;
  const footer     = makeFooter(entityName);

  const bsTable  = buildBSTable(nceCyAmounts, ncePyAmounts, cyYear, pyYear, entityName, dynamicNoteMap);
  const plTable  = buildPLTable(nceCyAmounts, ncePyAmounts, cyYear, pyYear, entityName, dynamicNoteMap);
  const sigTable = buildSignatureTable(entityName, engagement);

  const pageProps = {
    size:   { width: A4_W, height: A4_H },
    margin: { top: MARG_T, right: MARG_H, bottom: MARG_B, left: MARG_H },
  };

  const doc = new Document({
    styles: {
      default: {
        document: { run: { font: FONT, size: SZ_BODY } },
      },
    },
    sections: [
      // ── Page 1: Balance Sheet ─────────────────────────────────────────
      {
        properties: { page: pageProps },
        footers:    { default: footer },
        children:   [bsTable],
      },
      // ── Page 2: P&L + Signature block ────────────────────────────────
      {
        properties: { page: pageProps },
        footers:    { default: footer },
        children: [
          plTable,
          new Paragraph({ spacing: { before: 600 }, children: [] }),
          sigTable,
        ],
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = `FS_${entityName.replace(/[^a-z0-9]/gi, "_")}_${fy}.docx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
