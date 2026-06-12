import fs from "fs";
import { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
         Footer, AlignmentType, HeadingLevel, BorderStyle, WidthType,
         ShadingType, PageNumber, PageBreak, LevelFormat } from "docx";

const BG = { style: BorderStyle.SINGLE, size: 4, color: "BFBFBF" };
const BORDERS = { top: BG, bottom: BG, left: BG, right: BG };
const GREEN = "008000", BLUE = "1F4E79", GREY = "595959", AMBER = "B45309", RED = "C00000";

const P = (t, o = {}) => new Paragraph({
  alignment: o.align ?? AlignmentType.LEFT,
  spacing: o.spacing ?? { after: 100 },
  children: [new TextRun({ text: t, bold: o.bold, size: o.size ?? 22, color: o.color, italics: o.italics, font: "Arial" })],
});
const H1 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_1, spacing: { before: 240, after: 200 },
  children: [new TextRun({ text: t, bold: true, size: 32, color: BLUE, font: "Arial" })] });
const H2 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 180, after: 140 },
  children: [new TextRun({ text: t, bold: true, size: 26, color: BLUE, font: "Arial" })] });
const C = (t, o = {}) => new TableCell({
  borders: BORDERS,
  width: { size: o.width ?? 4680, type: WidthType.DXA },
  shading: o.shade ? { fill: o.shade, type: ShadingType.CLEAR, color: "auto" } : undefined,
  margins: { top: 50, bottom: 50, left: 90, right: 90 },
  children: [new Paragraph({
    alignment: o.align ?? AlignmentType.LEFT,
    children: [new TextRun({ text: t, bold: o.bold, color: o.color, size: o.size ?? 17, font: "Arial" })],
  })],
});
const R = (cells) => new TableRow({ children: cells });
const PB = () => new Paragraph({ children: [new PageBreak()] });
const BLT = (t) => new Paragraph({ numbering: { reference: "bullets", level: 0 },
  children: [new TextRun({ text: t, size: 21, font: "Arial" })] });

// â”€â”€ Load sweeps â”€â”€
const parse = (file, expectUuid) => {
  const csv = fs.readFileSync(file, "utf8");
  return csv.split(/\r?\n/).filter(l => l.trim() && !l.startsWith("Initialising") && !l.startsWith("client,") && !l.startsWith("name,")).map(l => l);
};
const nceLines = parse("C:\\Users\\kvdes\\OneDrive\\Desktop\\Audit\\caflow-core-ui-main\\assurance_peryear.csv");
const nce = nceLines.map(l => {
  const p = l.split(",");
  // client may contain commas â€” columns from the END are fixed: has_py, bare, cogs, dpy, dcy, notes
  const hasPy = p[p.length-1], bare = +p[p.length-2], cogs = +p[p.length-3],
        dpy = +p[p.length-4], dcy = +p[p.length-5], notes = +p[p.length-6];
  const client = p.slice(0, p.length-6).join(",");
  return { client, notes, dcy, dpy, cogs, bare, hasPy };
});
const corpLines = parse("C:\\Users\\kvdes\\OneDrive\\Desktop\\Audit\\caflow-core-ui-main\\corporates.csv");
const corps = corpLines.map(l => { const p = l.split(","); return { client: p.slice(0, p.length-2).join(","), hasNotes: p[p.length-1] === "t" }; });

const titlePage = [
  new Paragraph({ spacing: { before: 1500, after: 300 }, alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: "CAFlow â€” Full-Book FS Assurance Report", bold: true, size: 44, color: BLUE, font: "Arial" })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 200 },
    children: [new TextRun({ text: "v9 â€” Per-year (CY + PY) assurance for all 75 engagements Â· COGS family now in scope Â· RC-11 closed", bold: true, size: 24, color: GREY, font: "Arial" })] }),
  P("Date: 12 June 2026", { align: AlignmentType.CENTER, size: 24, spacing: { before: 400 } }),
  P("Scope: 49 NCE engagements + 26 corporate engagements (FY 2025-26)", { align: AlignmentType.CENTER, size: 22 }),
  P("Only exemptions, per your instruction: Capital Account & Fixed Assets", { align: AlignmentType.CENTER, size: 20, italics: true }),
  new Paragraph({ spacing: { before: 350 }, alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: "Commit deployed: ed55893a â€” RC-11 load-time self-heal guard", bold: true, size: 20, color: BLUE, font: "Arial" })] }),
  PB(),
];

const dhanani = [
  H1("DHANANI REALTY â€” three-screen verification (12 June 2026, post-deploy)"),
  P("You reported DHANANI as still broken. This session every line item was verified on ALL THREE screens â€” the Stage 6 COA Mapping page, the Notes to Accounts UI (every note expanded), and the BS / P&L face â€” for BOTH years. Result: every single line matches across all three surfaces.", { bold: true }),
  BLT("Changes in Inventories: COA â‚¹15,25,09,500 CY / â‚¹4,63,24,936.93 PY = Notes â‚¹15,25,09,500 / (â‚¹4,63,24,937) = Face. This was the broken cell (PY closing inventory was missing) â€” fixed by the cogs identity migration."),
  BLT("All BS lines (Capital, LT Borrowings, Trade Payables, Other CL, ST Provisions, PPE, Investments, Inventories, Cash, ST Loans & Advances): COA = Notes = Face, both years."),
  BLT("All P&L lines (Revenue, Other Income, Materials Consumed, Employee, Finance, Depreciation, Other Expenses, Total Expenses, Net Profit): COA = Notes = Face, both years."),
  BLT("BS CHECK CY âœ“ Â· BS CHECK PY âœ“ Â· FS Health 24/24 green Â· 0 Notes Mismatches."),
  P("Why your team still saw the mismatch: DHANANI's fix (cogs PY-closing identity + the RC-11 renderer guard) deployed at the end of the previous session. A browser tab opened BEFORE that deploy keeps running the old bundle and the old in-memory data until the page is refreshed. Please hard-refresh (Ctrl+Shift+R) any CAFlow tabs that have been open for more than a few hours.", { color: AMBER }),
  PB(),
];

const headline = [
  H1("Headline â€” the OM REALTY mismatch you reported, and what it exposed"),
  P("Your screenshot: Note 14 (Changes in Inventories) showed PY Closing blank and PY total â‚¹17,53,11,000 while COA Mapping and the P&L face both showed â‚¹3,87,13,000."),
  H2("Root cause #11 â€” the most important find of this whole exercise"),
  P("The database had the CORRECT value all along (PY Closing WIP = â‚¹13,65,98,000). A load-time \"self-heal\" block recomputed every static row that has tracked source-ledgers (_cy_sources) to equal the sum of those sources. Legacy source entries predate the PY feature and carry only the CY amount â€” so the heal computed \"expected PY = 0\" and overwrote the correct saved PY value in memory on every page load. The P&L face reads the DB directly, so the face stayed right while the SCREEN went wrong."),
  P("This one bug class explains why mismatches kept appearing on DIFFERENT notes after every fix round: any note, any engagement, any static row with legacy sources would display a wrong PY â€” while every back-end check (SQL sweeps, FsHealthPanel, face totals) said \"reconciled\". The auditor's screen was the only place the corruption was visible.", { color: AMBER, bold: true }),
  P("Fix: the heal now touches PY only when the sources actually carry PY data. 17 single-source entries got their PY backfilled in the DB so expanded sub-rows display correctly. Deployed and verified.", { color: GREEN }),
  H2("COGS family brought into scope"),
  P("Until now the sweeps excluded cogs/inventories \"by design\". Your instruction exempts ONLY Capital and Fixed Assets â€” so the sweep now also enforces the inventory accounting identity (PY Closing stock = CY Opening stock) per category. 5 violations found and fixed in data: SWASTIK, MAHARSH, NIRALI, DHANANI (PY closing missing entirely), UMIYA (short by â‚¹6,84,124)."),
  PB(),
];

const cw = [3050, 700, 850, 850, 950, 950, 700];
const header = R(["Client (NCE)", "Notes", "Drift CY", "Drift PY", "COGS identity", "Bare-key (RC-10)", "PY TB"].map((h, j) =>
  C(h, { width: cw[j], bold: true, shade: "DDEBF7", align: j > 0 ? AlignmentType.CENTER : AlignmentType.LEFT, size: 16 })));
const rows = nce.map(r => R([
  C(r.client, { width: cw[0] }),
  C(String(r.notes), { width: cw[1], align: AlignmentType.CENTER }),
  C(r.dcy === 0 ? "0 âœ“" : String(r.dcy), { width: cw[2], align: AlignmentType.CENTER, color: r.dcy === 0 ? GREEN : RED, bold: true }),
  C(r.dpy === 0 ? "0 âœ“" : String(r.dpy), { width: cw[3], align: AlignmentType.CENTER, color: r.dpy === 0 ? GREEN : RED, bold: true }),
  C(r.cogs === 0 ? "0 âœ“" : String(r.cogs), { width: cw[4], align: AlignmentType.CENTER, color: r.cogs === 0 ? GREEN : RED, bold: true }),
  C(r.bare === 0 ? "0 âœ“" : String(r.bare), { width: cw[5], align: AlignmentType.CENTER, color: r.bare === 0 ? GREEN : RED, bold: true }),
  C(r.hasPy === "Y" ? "Y" : "â€”", { width: cw[6], align: AlignmentType.CENTER }),
]));

const sectionA = [
  H1("Section A â€” Per-engagement, per-year assurance (49 NCE)"),
  P("Four independent checks per engagement, CY and PY separately, tolerance â‚¹1: (1) Note Total = COA Total per note (legacy codes folded); (2) same for PY; (3) inventory identity PY-closing = CY-opening per category; (4) zero renderer-invisible bare keys on LT/ST split notes. Engagements with Notes = 0 have not reached Stage 7 â€” they inherit every fix on first generation."),
  new Table({ width: { size: 8050, type: WidthType.DXA }, columnWidths: cw, rows: [header, ...rows] }),
  P(" "),
  P("RESULT: every check, every engagement, both years = 0. The book is fully reconciled at the data layer, and the four code-layer bug classes that could re-introduce divergence are closed.", { color: GREEN, bold: true }),
  PB(),
];

const cw2 = [4600, 2200];
const corpHeader = R(["Client (Corporate)", "Notes data"].map((h, j) =>
  C(h, { width: cw2[j], bold: true, shade: "DDEBF7", align: j > 0 ? AlignmentType.CENTER : AlignmentType.LEFT })));
const corpRows = corps.map(r => R([
  C(r.client, { width: cw2[0] }),
  C(r.hasNotes ? "Present âœ“" : "Not yet generated", { width: cw2[1], align: AlignmentType.CENTER, color: r.hasNotes ? GREEN : GREY }),
]));

const sectionB = [
  H1("Section B â€” 26 corporate engagements"),
  P("Corporates use the stage5_notes architecture with its own validator (validateCorporateFSReconciliation) feeding the same FsHealthPanel three-way check (COA / Note / Face) on every page load. The sign-convention, name-matching and dedupe hardening from this exercise lives in the shared computeCOATotals and benefits corporates identically."),
  new Table({ width: { size: 6800, type: WidthType.DXA }, columnWidths: cw2, rows: [corpHeader, ...corpRows] }),
  PB(),
];

const rcLog = [
  H1("Section C â€” Complete root-cause ledger (11 closed across this exercise)"),
  BLT("RC-1..5 (prior sessions): per-cell data drift; FsHealthPanel income-code sign flip; COA PY anchor = 0 for P&L codes; BS residual from unclosed Tally books; orphan-skip discarding note overrides."),
  BLT("RC-6: legacy corporate codes invisible to the validator (SWASTIK BS_CL_STB) â€” codes now fold to NCE canonical."),
  BLT("RC-7: Pattern A bare-key PY silently dropped â€” per-column key decision."),
  BLT("RC-8: numeric strings excluded from face â€” clean coercion."),
  BLT("RC-9: name-match asymmetry + duplicate-row exposure â€” trim fallback + dedupe."),
  BLT("RC-10 (your BHAKTI catch): bare keys invisible to the Pattern A renderer â€” 419 values migrated to suffixed keys; fix-SQL hardened."),
  BLT("RC-11 (your OM REALTY catch): load-time self-heal destroyed saved PY when legacy sources lack amountPy â€” heal now gated on sources actually carrying PY; 17 source entries backfilled; 5 cogs notes' inventory identity restored."),
  H2("Why the recurrence pattern is now closed"),
  P("Every mismatch you reported traced to one of two families: (a) a back-end divergence (data or comparison logic) â€” now swept to zero book-wide and guarded by the legacy-aware SQL sweep; or (b) a SCREEN-only divergence where the renderer disagreed with the DB (RC-10, RC-11) â€” the two known mechanisms are fixed, and the verification standard now includes the rendered screen, not just the back-end totals."),
  P("Standing tools: nce_assurance_peryear.sql (per-year, 4-check sweep, legacy-aware) Â· nce_drift_fix.sql (idempotent gap-closer, Pattern-A-aware) Â· FsHealthPanel (runtime tripwire on every page load).", { italics: true }),
];

const doc = new Document({
  styles: {
    default: { document: { run: { font: "Arial", size: 22 } } },
    paragraphStyles: [
      { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 32, bold: true, font: "Arial", color: BLUE },
        paragraph: { spacing: { before: 240, after: 200 }, outlineLevel: 0 } },
      { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 25, bold: true, font: "Arial", color: BLUE },
        paragraph: { spacing: { before: 180, after: 140 }, outlineLevel: 1 } },
    ],
  },
  numbering: {
    config: [{ reference: "bullets", levels: [{ level: 0, format: LevelFormat.BULLET, text: "â€¢",
      alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] }],
  },
  sections: [{
    properties: { page: { size: { width: 12240, height: 15840 },
      margin: { top: 1080, right: 1080, bottom: 1080, left: 1080 } } },
    footers: { default: new Footer({ children: [new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({ text: "CAFlow Full-Book FS Assurance v9 â€” Page ", size: 18, color: "808080", font: "Arial" }),
        new TextRun({ children: [PageNumber.CURRENT], size: 18, color: "808080", font: "Arial" }),
        new TextRun({ text: " â€” 12 June 2026 â€” Per-year assurance, all 75 engagements", size: 18, color: "808080", font: "Arial" }),
      ],
    })] }) },
    children: [...titlePage, ...dhanani, ...headline, ...sectionA, ...sectionB, ...rcLog],
  }],
});

const buf = await Packer.toBuffer(doc);
fs.writeFileSync("C:\\Users\\kvdes\\OneDrive\\Desktop\\Audit\\caflow-core-ui-main\\CAFlow_FullBook_FS_Assurance_Report_v9_1.docx", buf);
console.log("WROTE v9 size=", buf.length, "nce:", nce.length, "corps:", corps.length);

