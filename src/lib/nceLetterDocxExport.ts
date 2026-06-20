/**
 * nceLetterDocxExport
 * ─────────────────────────────────────────────────────────────────────────────
 * Word (.docx) exports for the Stage 8 NCE letter set:
 *
 *   1. exportClientCertificateDocx — Client Certificate letter
 *   2. exportManagementLetterDocx  — Management Letter
 *   3. exportNote1Docx             — Note 1 (Summary of Significant Accounting
 *                                    Policies) standalone page
 *
 * Each Word file mirrors the corresponding Excel template in
 * src/lib/nceLetterExport.ts (Client Certificate / Management Letter) and the
 * Note 1 page emitted by src/lib/nceFinancialsDocx.ts (Section A of the FS
 * export). The Word files are intended as drop-in equivalents of the existing
 * Excel exports so the auditor can pick whichever format the client prefers
 * without the deliverable looking different.
 */

import {
  AlignmentType,
  BorderStyle,
  Document,
  PageBorderDisplay,
  PageBorderOffsetFrom,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
  PageOrientation,
} from "docx";
import type { ClientCertData, MgmtLetterData } from "@/lib/nceLetterExport";

// ─── Shared types ───────────────────────────────────────────────────────────

export interface Note1DocxData {
  entityName: string;
  cyYear:     string;
  ntaData?:   any | null;
  sig?: {
    firmName?:     string;
    firmFRN?:      string;
    partnerName?:  string;
    membershipNo?: string;
    clientName?:   string;
    place?:        string;
    date?:         string;
  } | null;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const NAVY      = "1F3864";
const BLACK     = "000000";

// A4 portrait. Letters (Client Cert / Mgmt Letter) use a normal letter
// margin set. Note 1 mirrors the FS export's Section A margins so the
// standalone Note 1 docx looks identical to the Note 1 page inside the
// full FS Word export (see nceFinancialsDocx.ts → note1PortraitProps).
const A4_W      = 11906;
const A4_H      = 16838;
const MARG_L    = 864;
const MARG_R    = 864;
const MARG_T    = 1080;
const MARG_B    = 1080;
const TW        = A4_W - MARG_L - MARG_R;

// Note 1-specific margins — match nceFinancialsDocx.ts (MARG_T 720,
// MARG_R 576, MARG_B_NOTES 1440, MARG_L 864) and TW_NOTE1 derived
// from those so the body table is the same width as the FS-export
// Note 1 page.
const NOTE1_MARG_L = 864;
const NOTE1_MARG_R = 576;
const NOTE1_MARG_T = 720;
const NOTE1_MARG_B = 1440;
const TW_NOTE1     = A4_W - NOTE1_MARG_L - NOTE1_MARG_R;

// NAVY page border (12 half-pt single rule, 24 twips from page edge) —
// identical to nceFinancialsDocx.ts → _pgBdr so Note 1 sits inside the
// same dark-blue frame the auditor sees on every FS-export page.
const NOTE1_PAGE_BORDERS = {
  pageBorders: {
    display:    PageBorderDisplay.ALL_PAGES,
    offsetFrom: PageBorderOffsetFrom.PAGE,
  },
  pageBorderTop:    { style: BorderStyle.SINGLE, size: 12, color: NAVY, space: 24 },
  pageBorderBottom: { style: BorderStyle.SINGLE, size: 12, color: NAVY, space: 24 },
  pageBorderLeft:   { style: BorderStyle.SINGLE, size: 12, color: NAVY, space: 24 },
  pageBorderRight:  { style: BorderStyle.SINGLE, size: 12, color: NAVY, space: 24 },
};

// Font sizes in half-points (docx units).
const SZ_ENTITY = 28; // 14pt
const SZ_HDR    = 20; // 10pt
const SZ_BODY   = 20; // 10pt — letter body (Client Cert, Mgmt Letter, Note 1)

const NO_BDR_SIDES = {
  top:    { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
  bottom: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
  left:   { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
  right:  { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
} as const;

const TABLE_NO_BDR = {
  ...NO_BDR_SIDES,
  insideHorizontal: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
  insideVertical:   { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
} as const;

// ─── Helpers ────────────────────────────────────────────────────────────────

function fmtDate(iso: string): string {
  if (!iso) return "__/__/____";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return (
    String(d.getDate()).padStart(2, "0") + "/" +
    String(d.getMonth() + 1).padStart(2, "0") + "/" +
    d.getFullYear()
  );
}

// Indian whole-rupee format with "/-" suffix — e.g. "29,39,17,000/-".
// Used for every money figure in the Client Certificate and Management
// Letter Word exports so the rupee values read like a hand-typed letter
// instead of an accounting line item.
function fmtMoney(s: string): string {
  if (!s) return "_________/-";
  const n = parseFloat(s);
  if (!Number.isFinite(n)) return `${s}/-`;
  return `${n.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}/-`;
}

function para(opts: {
  text?:      string;
  font?:      string;
  size?:      number;
  bold?:      boolean;
  color?:     string;
  align?:     "left" | "right" | "center";
  before?:    number;
  after?:     number;
  runs?:      Array<{ text: string; bold?: boolean; size?: number; color?: string }>;
  border?:    any;
} = {}): Paragraph {
  const font  = opts.font  ?? "Calibri";
  const size  = opts.size  ?? SZ_BODY;
  const color = opts.color ?? BLACK;
  const align =
    opts.align === "right"  ? AlignmentType.RIGHT  :
    opts.align === "center" ? AlignmentType.CENTER :
                              AlignmentType.LEFT;

  const children = opts.runs
    ? opts.runs.map(r => new TextRun({
        text:  r.text,
        font,
        size:  r.size ?? size,
        bold:  r.bold ?? false,
        color: r.color ?? color,
      }))
    : [new TextRun({
        text:  opts.text ?? "",
        font,
        size,
        bold:  opts.bold ?? false,
        color,
      })];

  return new Paragraph({
    alignment: align,
    spacing:   { before: opts.before ?? 0, after: opts.after ?? 0, line: 264, lineRule: "auto" as any },
    border:    opts.border,
    children,
  });
}

function downloadDocx(buffer: Blob, filename: string) {
  const url = URL.createObjectURL(buffer);
  const a   = document.createElement("a");
  a.href    = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Letterhead block — entity name + address inside a thin black border (matches
// the Excel templates' B2:H2 and B3:H3 bordered rows).
function letterheadBlock(entityName: string, entityAddress: string, font: string): Table {
  const thin = { style: BorderStyle.SINGLE, size: 4, color: BLACK };
  const lineBorders = {
    top:    thin,
    bottom: thin,
    left:   thin,
    right:  thin,
  };
  return new Table({
    width:        { size: TW, type: WidthType.DXA },
    columnWidths: [TW],
    borders: {
      ...lineBorders,
      insideHorizontal: thin,
      insideVertical:   thin,
    } as any,
    rows: [
      new TableRow({
        cantSplit: true,
        children: [new TableCell({
          width:    { size: TW, type: WidthType.DXA },
          margins:  { top: 80, bottom: 80, left: 120, right: 120 },
          verticalAlign: VerticalAlign.CENTER,
          children: [para({
            text: (entityName || "[ENTITY NAME]").toUpperCase(),
            font, bold: true, size: SZ_ENTITY, align: "center",
          })],
        })],
      }),
      new TableRow({
        cantSplit: true,
        children: [new TableCell({
          width:    { size: TW, type: WidthType.DXA },
          margins:  { top: 80, bottom: 80, left: 120, right: 120 },
          verticalAlign: VerticalAlign.CENTER,
          children: [para({
            text: entityAddress || "[ENTITY ADDRESS]",
            font, bold: true, size: SZ_BODY, align: "center",
          })],
        })],
      }),
    ],
  });
}

// ─── 1) Client Certificate ──────────────────────────────────────────────────

export async function exportClientCertificateDocx(
  data: ClientCertData,
  filenameSlug: string,
  font: string = "Calibri",
): Promise<void> {
  const FONT = font;
  const children: (Paragraph | Table)[] = [];

  // Tight one-page layout. Earlier revisions used empty spacer paragraphs +
  // 480-DXA gaps before the signature; Word snapped each spacer to the line
  // grid and pushed "(Signature & stamp)" onto a second page. Spacing now
  // lives on the content paragraphs directly (no empty spacers) and the
  // signature gaps are halved so the whole certificate fits on A4.
  children.push(letterheadBlock(data.clientName, data.clientAddress, FONT));

  children.push(para({ before: 200, text: `Date : ${fmtDate(data.letterDate)}`, font: FONT }));

  children.push(para({ before: 160, text: "To,", font: FONT }));
  children.push(para({ text: data.firmName || "[AUDIT FIRM NAME]", font: FONT, bold: true }));
  if (data.firmAddress) children.push(para({ text: data.firmAddress, font: FONT }));
  if (data.firmFRN)     children.push(para({ text: `FRN: ${data.firmFRN}`, font: FONT }));

  children.push(para({ before: 160, text: "Dear Sir,", font: FONT }));

  children.push(para({
    before: 120,
    runs: [
      { text: "In connection with the Tax Audits for the financial year " },
      { text: data.financialYear || "[FY]", bold: true },
      { text: " u/s. 44AB, we herewith certify as under :" },
    ],
    font: FONT,
  }));

  children.push(para({
    before: 160,
    runs: [
      { text: "1.  Cash on hand Rs. " },
      { text: fmtMoney(data.cashOnHand), bold: true },
      { text: "  was with the firm and same was tallied with the cash book." },
    ],
    font: FONT,
  }));

  children.push(para({
    before: 120,
    runs: [
      { text: "2.  Approxi. Value of the Closing stock is Rs. " },
      { text: fmtMoney(data.closingStock), bold: true },
      { text: " as on " },
      { text: fmtDate(data.closingStockDate), bold: true },
      { text: " and same was physically verified." },
    ],
    font: FONT,
  }));

  (data.points || []).forEach((text, i) => {
    children.push(para({ before: 120, text: `${i + 3}.  ${text}`, font: FONT }));
  });

  children.push(para({ before: 160, text: data.closingLine || "You are requested to note the same.", font: FONT }));

  children.push(para({ before: 200, text: "Yours faithfully,", font: FONT, bold: true }));
  children.push(para({ before: 240, text: "x_____________", font: FONT, bold: true }));
  children.push(para({ text: "(Signature & stamp)", font: FONT, bold: true }));

  const doc = new Document({
    styles: {
      default: {
        document: {
          run:       { font: FONT, size: SZ_BODY },
          paragraph: { spacing: { before: 0, after: 0, line: 240, lineRule: "auto" as any } },
        },
      },
    },
    sections: [{
      properties: {
        page: {
          size:   { width: A4_W, height: A4_H },
          margin: { top: MARG_T, right: MARG_R, bottom: MARG_B, left: MARG_L },
        },
      },
      children,
    }],
  });

  const blob = await Packer.toBlob(doc);
  downloadDocx(blob, `ClientCertificate_${filenameSlug}.docx`);
}

// ─── 2) Management Letter ───────────────────────────────────────────────────

export async function exportManagementLetterDocx(
  data: MgmtLetterData,
  filenameSlug: string,
  font: string = "Arial",
): Promise<void> {
  const FONT = font;
  const children: (Paragraph | Table)[] = [];

  // Tight one-page layout. Same fix as the Client Certificate above: drop
  // the empty spacer paragraphs (Word's grid snapping pushed them into
  // full-line gaps) and halve the signature gaps so "(Signature & stamp)"
  // stays on the first page.
  children.push(letterheadBlock(data.clientName, data.clientAddress, FONT));

  children.push(para({ before: 200, text: `Date : ${fmtDate(data.letterDate)}`, font: FONT }));

  children.push(para({ before: 160, text: "To,", font: FONT }));
  children.push(para({ text: data.firmName || "[AUDIT FIRM NAME]", font: FONT, bold: true }));
  if (data.firmAddress) children.push(para({ text: data.firmAddress, font: FONT }));
  if (data.firmFRN)     children.push(para({ text: `FRN: ${data.firmFRN}`, font: FONT }));

  children.push(para({
    before: 200,
    runs: [
      { text: "Subject : Appointment as Tax Auditors for Financial year ", bold: true },
      { text: data.financialYear || "______", bold: true },
    ],
    font: FONT,
  }));

  children.push(para({ before: 160, text: "Dear Sir,", font: FONT }));

  const segments = (data.bodyPara || "").split(/\n{2,}/).map(s => s.trim()).filter(Boolean);
  if (segments.length === 0) {
    children.push(para({ before: 160, font: FONT, text: "" }));
  } else {
    segments.forEach((seg, i) => {
      children.push(para({ before: i === 0 ? 160 : 120, text: seg, font: FONT }));
    });
  }

  children.push(para({ before: 160, text: data.confirmLine || "", font: FONT }));

  children.push(para({ before: 200, text: "Thank You.", font: FONT, bold: true }));
  children.push(para({ before: 120, text: "Yours faithfully,", font: FONT, bold: true }));
  children.push(para({ before: 240, text: "x_____________", font: FONT, bold: true }));
  children.push(para({ text: "(Signature & stamp)", font: FONT, bold: true }));

  const doc = new Document({
    styles: {
      default: {
        document: {
          run:       { font: FONT, size: SZ_BODY },
          paragraph: { spacing: { before: 0, after: 0, line: 240, lineRule: "auto" as any } },
        },
      },
    },
    sections: [{
      properties: {
        page: {
          size:   { width: A4_W, height: A4_H },
          margin: { top: MARG_T, right: MARG_R, bottom: MARG_B, left: MARG_L },
        },
      },
      children,
    }],
  });

  const blob = await Packer.toBlob(doc);
  downloadDocx(blob, `ManagementLetter_${filenameSlug}.docx`);
}

// ─── 3) Note 1 standalone ───────────────────────────────────────────────────
// Mirrors Section A of the FS Word export (see src/lib/nceFinancialsDocx.ts →
// buildNote1Section). Producing the same layout from a standalone helper keeps
// the Stage 8 "Note 1" Word file looking identical to the Note 1 page in the
// full FS export.

interface Note1Row { id: string; label: string; title: string; selected: boolean; text: string; }

function defaultNceNote1Template(auditYear: string): Note1Row[] {
  return [
    { id: "note-1", label: "Note 1", title: "Balance Confirmation", selected: true,
      text: "All debit and credit balances and accounts squared up during the year are subject to confirmation from respective parties." },
    { id: "note-2", label: "Note 2", title: "Rearrangement of Figures", selected: true,
      text: "The figures are rearranged/regrouped wherever considered necessary and rounded off to the nearest rupee." },
    { id: "note-3", label: "Note 3", title: "Cash Balance & Closing Stock", selected: true,
      text: `Cash balance on hand was Rs. [CASH_AMOUNT]/- and value of Closing Stock Rs. [CLOSING_STOCK]/- as at 31st March, ${auditYear} are taken as certified by proprietor.` },
    { id: "note-4", label: "Note 4", title: "Current Assets Valuation", selected: true,
      text: "In opinion of assessee, current assets, loans & advances are approximately of the value at which these are stated in the balance sheet." },
    { id: "note-5", label: "Note 5", title: "Fixed Assets", selected: true,
      text: "Fixed Assets are stated at Cost less depreciation as shown in Note- [FA_NOTE]. Details of rate and amount of Depreciation claimed has been stated in Note-[DEP_NOTE]." },
    { id: "note-6", label: "Note 6", title: "Reliance on Vouchers", selected: true,
      text: "Whenever the supporting proof for the entries made in the books of accounts are not available for the purpose of audit, we are relied on the vouchers prepared and authenticated by the partner." },
    { id: "note-7", label: "Note 7", title: "Loans via Cheque/DD/ECS", selected: true,
      text: "As informed by the partner, the amount of loan or deposits or specified sums taken or accepted or repaid by the assessee through a/c. payee cheque/demand draft or ECS only. However, it is not possible for us to verify the same as necessary evidence are not in possession of the assessee." },
    { id: "note-8", label: "Note 8", title: "Notes form Part of Accounts", selected: true,
      text: `Notes No. 1 to [LAST_NOTE] forms part of accounts for the year ended on 31st March, ${auditYear}.` },
  ];
}

export async function exportNote1Docx(input: Note1DocxData, filenameSlug: string): Promise<void> {
  const FONT      = "Calibri";
  const yearStr   = String(input.cyYear || "").slice(-4) || "20XX";
  const entity    = (input.entityName || "").trim() || "[ENTITY NAME]";

  // ── Merge saved notes_json over the default template ──
  const saved: any[] = Array.isArray(input.ntaData?.notes_json) ? input.ntaData!.notes_json : [];
  const template     = defaultNceNote1Template(yearStr);
  const templateMap  = new Map(template.map(t => [t.id, t]));
  const merged: Note1Row[] = saved.length === 0
    ? template
    : saved.map((r: any) => {
        const tmpl = templateMap.get(r.id);
        if (tmpl) {
          return {
            ...tmpl,
            selected: r.selected ?? tmpl.selected,
            text:     r.text     ?? tmpl.text,
            title:    r.title    ?? tmpl.title,
          };
        }
        return {
          id:       String(r.id ?? ""),
          label:    String(r.label ?? r.title ?? ""),
          title:    String(r.title ?? ""),
          selected: r.selected ?? true,
          text:     String(r.text  ?? ""),
        };
      });

  const header             = (input.ntaData?.header_overrides || {}) as Record<string, any>;
  const note1NewEntityOn   = !!input.ntaData?.note1_new_entity_enabled
                          && String(input.ntaData?.note1_new_entity_text || "").trim().length > 0;
  const note1NewEntityTx   = String(input.ntaData?.note1_new_entity_text || "").trim();
  const note3Variant       = String(input.ntaData?.note3_variant || "none");
  const note3VariantTxt    = String(header?.note3VariantText || input.ntaData?.note3_variant_text || "").trim();

  const selectedNotes = merged.filter(n => n.selected !== false);
  const lastNoteNum   = String(header.lastNoteOverride || selectedNotes.length);

  const resolveTokens = (text: string): string =>
    (text || "")
      .replace(/\[CASH_AMOUNT\]/g,   String(header.cashAmount   || ""))
      .replace(/\[CLOSING_STOCK\]/g, String(header.closingStock || ""))
      .replace(/\[FA_NOTE\]/g,       String(header.faNoteNum    || ""))
      .replace(/\[DEP_NOTE\]/g,      String(header.depNoteNum   || ""))
      .replace(/\[LAST_NOTE\]/g,     lastNoteNum);

  // ── Signature block fields ──
  const sig = input.sig || {};
  const assesseeName  = (sig.clientName || entity).trim();
  const firmName      = sig.firmName      || "_______________";
  const firmFRN       = sig.firmFRN       || "_______________";
  const partnerName   = sig.partnerName   || "_______________";
  const partnerMembNo = sig.membershipNo  || "_______________";
  const placeText     = sig.place         || "_______________";
  const dateText      = fmtDate(sig.date  || "");

  // ── Banners ──
  const NAVY_RULE      = { style: BorderStyle.SINGLE, size: 8, color: NAVY, space: 4 };
  const NAVY_RULE_THIN = { style: BorderStyle.SINGLE, size: 4, color: NAVY, space: 2 };

  const entityBanner = new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing:   { before: 80, after: 40 },
    border:    { top: NAVY_RULE, bottom: NAVY_RULE },
    children:  [new TextRun({
      text: entity.toUpperCase(),
      font: FONT, size: SZ_ENTITY, bold: true, color: NAVY,
    })],
  });
  // Subtitle banner removed (2026-06-20) — the entity banner now sits
  // directly above the "Note 1 — NOTES FORMING PART OF ACCOUNTS FOR THE
  // YEAR ENDED dd.mm.yyyy" heading.
  const note1HeadingBanner = new Paragraph({
    alignment: AlignmentType.LEFT,
    spacing:   { before: 0, after: 60 },
    border:    { bottom: NAVY_RULE_THIN },
    children:  [new TextRun({
      text: `Note 1 — NOTES FORMING PART OF ACCOUNTS FOR THE YEAR ENDED 31.03.${yearStr}`,
      font: FONT, size: SZ_HDR, bold: true, color: NAVY,
    })],
  });

  // ── Numbered policies body (2-col borderless table) ──
  // Width is derived from the Note 1-specific text-width (TW_NOTE1) so the
  // standalone Note 1 page is laid out exactly like the FS export.
  const NOTE_COL_NUM_W  = 700;
  const NOTE_COL_TEXT_W = TW_NOTE1 - NOTE_COL_NUM_W;

  const bodyParas = (body: string): Paragraph[] => {
    const segments = body.split(/\n{2,}/).map(s => s.trim()).filter(Boolean);
    if (segments.length === 0) return [new Paragraph({ spacing: { before: 0, after: 0 }, children: [] })];
    return segments.map((seg, idx) => new Paragraph({
      alignment: AlignmentType.LEFT,
      spacing:   { before: 0, after: idx === segments.length - 1 ? 0 : 80, line: 264, lineRule: "auto" as any },
      children:  [new TextRun({ text: seg, font: FONT, size: SZ_BODY, color: BLACK })],
    }));
  };

  const bodyRows: TableRow[] = selectedNotes.map((n, i) => {
    const num = i + 1;
    let body  = resolveTokens(n.text || "");
    if (n.id === "note-1" && note1NewEntityOn) body += "\n\n" + resolveTokens(note1NewEntityTx);
    if (n.id === "note-3" && note3Variant !== "none" && note3VariantTxt) body += "\n\n" + resolveTokens(note3VariantTxt);
    return new TableRow({
      cantSplit: false,
      children: [
        new TableCell({
          width:    { size: NOTE_COL_NUM_W, type: WidthType.DXA },
          borders:  NO_BDR_SIDES,
          margins:  { top: 80, bottom: 80, left: 100, right: 100 },
          verticalAlign: VerticalAlign.TOP,
          children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing:   { before: 0, after: 0, line: 264, lineRule: "auto" as any },
            children:  [new TextRun({ text: String(num), font: FONT, size: SZ_BODY, color: BLACK })],
          })],
        }),
        new TableCell({
          width:    { size: NOTE_COL_TEXT_W, type: WidthType.DXA },
          borders:  NO_BDR_SIDES,
          margins:  { top: 80, bottom: 80, left: 100, right: 100 },
          verticalAlign: VerticalAlign.TOP,
          children: bodyParas(body),
        }),
      ],
    });
  });

  const bodyTable = new Table({
    width:        { size: TW_NOTE1, type: WidthType.DXA },
    columnWidths: [NOTE_COL_NUM_W, NOTE_COL_TEXT_W],
    borders:      TABLE_NO_BDR as any,
    rows:         bodyRows,
  });

  // ── Signature block (assessee left / firm right) ──
  const sigLineL = (text: string, bold = false): Paragraph => new Paragraph({
    alignment: AlignmentType.LEFT,
    spacing:   { before: 0, after: 40, line: 264, lineRule: "auto" as any },
    children:  [new TextRun({ text, font: FONT, size: SZ_BODY, bold, color: BLACK })],
  });
  const sigLineR = (text: string, bold = false): Paragraph => new Paragraph({
    alignment: AlignmentType.RIGHT,
    spacing:   { before: 0, after: 40, line: 264, lineRule: "auto" as any },
    children:  [new TextRun({ text, font: FONT, size: SZ_BODY, bold, color: BLACK })],
  });

  const half = Math.floor(TW_NOTE1 / 2);
  const signatureTable = new Table({
    width:        { size: TW_NOTE1, type: WidthType.DXA },
    columnWidths: [half, TW_NOTE1 - half],
    borders:      TABLE_NO_BDR as any,
    rows: [new TableRow({
      cantSplit: true,
      children: [
        new TableCell({
          width:    { size: half, type: WidthType.DXA },
          borders:  NO_BDR_SIDES,
          margins:  { top: 80, bottom: 80, left: 100, right: 100 },
          verticalAlign: VerticalAlign.TOP,
          children: [
            sigLineL(`For, ${assesseeName}`, true),
            sigLineL(""),
            sigLineL("x__________________", true),
            sigLineL("Signature of assessee", true),
            sigLineL(""),
            sigLineL(`Place: ${placeText}`, true),
            sigLineL(`Date : ${dateText}`, true),
          ],
        }),
        new TableCell({
          width:    { size: TW_NOTE1 - half, type: WidthType.DXA },
          borders:  NO_BDR_SIDES,
          margins:  { top: 80, bottom: 80, left: 100, right: 100 },
          verticalAlign: VerticalAlign.TOP,
          children: [
            sigLineR(`For ${firmName}`, true),
            sigLineR("Chartered Accountants", true),
            sigLineR(`FRN: ${firmFRN}`, true),
            sigLineR(""),
            sigLineR(partnerName, true),
            sigLineR("Partner", true),
            sigLineR(`Membership No.: ${partnerMembNo}`, true),
          ],
        }),
      ],
    })],
  });

  const preSigSpacer = new Paragraph({ spacing: { before: 240, after: 0 }, children: [] });

  const doc = new Document({
    styles: {
      default: {
        document: {
          run:       { font: FONT, size: SZ_BODY },
          paragraph: { spacing: { before: 0, after: 0, line: 240, lineRule: "auto" as any } },
        },
      },
    },
    sections: [{
      properties: {
        page: {
          size:    { width: A4_W, height: A4_H, orientation: PageOrientation.PORTRAIT },
          margin:  { top: NOTE1_MARG_T, right: NOTE1_MARG_R, bottom: NOTE1_MARG_B, left: NOTE1_MARG_L },
          borders: NOTE1_PAGE_BORDERS,
        },
      },
      children: [
        entityBanner,
        note1HeadingBanner,
        bodyTable,
        preSigSpacer,
        signatureTable,
      ],
    }],
  });

  const blob = await Packer.toBlob(doc);
  downloadDocx(blob, `Note1_${filenameSlug}.docx`);
}
