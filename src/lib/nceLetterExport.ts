/**
 * nceLetterExport
 * ─────────────────────────────────────────────────────────────────────────────
 * Generates Excel workbooks for NCE letters (Client Certificate +
 * Management Letter) matching the provided template layout.
 *
 * Sheet: "Client Certificate"  rows 2-42
 * Sheet: "Management Letter"   rows 2-32
 *
 * Uses ExcelJS (already a project dependency via fsExcelExport).
 */

import ExcelJS from "exceljs";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ClientCertData {
  clientName:       string;
  clientAddress:    string;
  letterDate:       string;   // ISO yyyy-mm-dd
  firmName:         string;
  firmAddress:      string;
  firmFRN:          string;
  financialYear:    string;
  cashOnHand:       string;   // numeric string
  closingStock:     string;   // numeric string
  closingStockDate: string;   // ISO yyyy-mm-dd
  para3:            string;
  para4:            string;
  para5:            string;
  para6:            string;
  para7:            string;
  para8:            string;
  para9:            string;
  closingLine:      string;
}

export interface MgmtLetterData {
  clientName:    string;
  clientAddress: string;
  letterDate:    string;   // ISO yyyy-mm-dd
  firmName:      string;
  firmAddress:   string;
  firmFRN:       string;
  financialYear: string;
  fyEnd:         string;   // "31st March, 2026"
  bodyPara:      string;
  confirmLine:   string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(iso: string): string {
  if (!iso) return "__/__/____";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

function applyFont(
  cell: ExcelJS.Cell,
  bold = false,
  size = 11,
  name = "Times New Roman"
) {
  cell.font = { bold, size, name };
}

function applyWrap(cell: ExcelJS.Cell) {
  cell.alignment = { wrapText: true, vertical: "top" };
}

function download(buf: ExcelJS.Buffer, filename: string) {
  const blob = new Blob([buf as BlobPart], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a   = document.createElement("a");
  a.href     = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Client Certificate ───────────────────────────────────────────────────────

export async function exportClientCertificate(
  data: ClientCertData,
  filenameSlug: string
): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Client Certificate");

  // Column widths matching template
  ws.columns = [
    { width: 3  },  // A
    { width: 42 },  // B — main text
    { width: 16 },  // C — cash on hand value
    { width: 42 },  // D — "was with the firm..."
    { width: 16 },  // E — closing stock value
    { width: 8  },  // F — "as on"
    { width: 16 },  // G — date / FY
    { width: 32 },  // H — remainder text
    { width: 4  },  // I
  ];

  const n  = (cell: ExcelJS.Cell) => applyFont(cell);
  const b  = (cell: ExcelJS.Cell) => applyFont(cell, true);
  const w  = (cell: ExcelJS.Cell) => applyWrap(cell);

  // Row 2 — Entity name (bold)
  ws.getCell("B2").value = data.clientName || "[ENTITY NAME]";
  b(ws.getCell("B2"));

  // Row 3 — Entity address
  ws.getCell("B3").value = data.clientAddress || "[ENTITY ADDRESS]";
  n(ws.getCell("B3")); w(ws.getCell("B3"));
  ws.getRow(3).height = 36;

  // Row 5 — Date
  ws.getCell("B5").value = `Date : ${fmtDate(data.letterDate)}`;
  n(ws.getCell("B5"));

  // Row 7 — "To,"
  ws.getCell("B7").value = "To,";
  n(ws.getCell("B7"));

  // Row 8 — Firm name (bold)
  ws.getCell("B8").value = data.firmName || "[AUDIT FIRM NAME]";
  b(ws.getCell("B8"));

  // Row 9 — Firm address
  ws.getCell("B9").value = data.firmAddress || "[AUDIT FIRM ADDRESS]";
  n(ws.getCell("B9")); w(ws.getCell("B9"));
  ws.getRow(9).height = 36;

  // Row 10 — FRN
  ws.getCell("B10").value = data.firmFRN ? `FRN: ${data.firmFRN}` : "";
  n(ws.getCell("B10"));

  // Row 12 — "Dear Sir,"
  ws.getCell("B12").value = "Dear Sir,";
  n(ws.getCell("B12"));

  // Row 13 — Opening line split across columns
  ws.getCell("B13").value = "In connection with the Tax Audits for the financial year";
  n(ws.getCell("B13"));
  ws.getCell("G13").value = data.financialYear || "______";
  b(ws.getCell("G13"));
  ws.getCell("H13").value = "u/s. 44AB, we herewith certify as";
  n(ws.getCell("H13"));

  // Row 14 — "under :"
  ws.getCell("B14").value = "under :";
  n(ws.getCell("B14"));

  // Row 16 — Para 1: Cash on hand
  ws.getCell("B16").value = "Cash on hand Rs.";
  n(ws.getCell("B16"));
  if (data.cashOnHand) {
    ws.getCell("C16").value  = parseFloat(data.cashOnHand);
    ws.getCell("C16").numFmt = "#,##0.00";
  } else {
    ws.getCell("C16").value = "_______";
  }
  n(ws.getCell("C16"));
  ws.getCell("D16").value = "was with the firm and same was tallied with the cash book.";
  n(ws.getCell("D16")); w(ws.getCell("D16"));

  // Row 18 — Para 2: Closing stock
  ws.getCell("B18").value = "Approxi. Value of the Closing stock is Rs.";
  n(ws.getCell("B18"));
  if (data.closingStock) {
    ws.getCell("E18").value  = parseFloat(data.closingStock);
    ws.getCell("E18").numFmt = "#,##0.00";
  } else {
    ws.getCell("E18").value = "________";
  }
  n(ws.getCell("E18"));
  ws.getCell("F18").value = "as on";
  n(ws.getCell("F18"));
  ws.getCell("G18").value = data.closingStockDate ? fmtDate(data.closingStockDate) : "_______";
  n(ws.getCell("G18"));
  ws.getCell("H18").value = "and same was physically verified.";
  n(ws.getCell("H18"));

  // Row 19 — Para 3
  ws.getCell("B19").value = data.para3;
  n(ws.getCell("B19")); w(ws.getCell("B19"));
  ws.getRow(19).height = 36;

  // Row 21 — Para 4
  ws.getCell("B21").value = data.para4;
  n(ws.getCell("B21")); w(ws.getCell("B21"));
  ws.getRow(21).height = 36;

  // Row 23 — Para 5
  ws.getCell("B23").value = data.para5;
  n(ws.getCell("B23")); w(ws.getCell("B23"));
  ws.getRow(23).height = 36;

  // Row 25 — Para 6
  ws.getCell("B25").value = data.para6;
  n(ws.getCell("B25")); w(ws.getCell("B25"));

  // Row 27 — Para 7
  ws.getCell("B27").value = data.para7;
  n(ws.getCell("B27")); w(ws.getCell("B27"));
  ws.getRow(27).height = 48;

  // Row 29 — Para 8
  ws.getCell("B29").value = data.para8;
  n(ws.getCell("B29")); w(ws.getCell("B29"));
  ws.getRow(29).height = 48;

  // Row 31 — Para 9
  ws.getCell("B31").value = data.para9;
  n(ws.getCell("B31")); w(ws.getCell("B31"));
  ws.getRow(31).height = 48;

  // Row 33 — Closing line
  ws.getCell("B33").value = data.closingLine;
  n(ws.getCell("B33"));

  // Row 37 — Yours faithfully
  ws.getCell("B37").value = "Yours faithfully,";
  n(ws.getCell("B37"));

  // Rows 38-40 — signature space
  [38, 39, 40].forEach((r) => { ws.getRow(r).height = 18; });

  // Row 41 — Signature line
  ws.getCell("B41").value = "x_____________";
  n(ws.getCell("B41"));

  // Row 42 — Stamp
  ws.getCell("B42").value = "(Signature & stamp)";
  n(ws.getCell("B42"));

  const buf = await wb.xlsx.writeBuffer();
  download(buf, `ClientCertificate_${filenameSlug}.xlsx`);
}

// ─── Management Letter ────────────────────────────────────────────────────────

export async function exportManagementLetter(
  data: MgmtLetterData,
  filenameSlug: string
): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Management Letter");

  ws.columns = [
    { width: 3  },  // A
    { width: 70 },  // B — main content
    { width: 4  },  // C
    { width: 4  },  // D
    { width: 4  },  // E
    { width: 4  },  // F
    { width: 16 },  // G
    { width: 16 },  // H
  ];

  const n = (cell: ExcelJS.Cell) => applyFont(cell);
  const b = (cell: ExcelJS.Cell) => applyFont(cell, true);
  const w = (cell: ExcelJS.Cell) => applyWrap(cell);

  // Row 2 — Entity name
  ws.getCell("B2").value = data.clientName || "[ENTITY NAME]";
  b(ws.getCell("B2"));

  // Row 3 — Entity address
  ws.getCell("B3").value = data.clientAddress || "[ENTITY ADDRESS]";
  n(ws.getCell("B3")); w(ws.getCell("B3"));
  ws.getRow(3).height = 36;

  // Row 6 — Date
  ws.getCell("B6").value = `Date : ${fmtDate(data.letterDate)}`;
  n(ws.getCell("B6"));

  // Row 8 — "To,"
  ws.getCell("B8").value = "To,";
  n(ws.getCell("B8"));

  // Row 9 — Firm name
  ws.getCell("B9").value = data.firmName || "[AUDIT FIRM NAME]";
  b(ws.getCell("B9"));

  // Row 10 — Firm address
  ws.getCell("B10").value = data.firmAddress || "[AUDIT FIRM ADDRESS]";
  n(ws.getCell("B10")); w(ws.getCell("B10"));
  ws.getRow(10).height = 36;

  // Row 11 — FRN
  ws.getCell("B11").value = data.firmFRN ? `FRN: ${data.firmFRN}` : "";
  n(ws.getCell("B11"));

  // Row 14 — Subject
  ws.getCell("B14").value = "Subject : Appointment as Tax Auditors for Financial year";
  n(ws.getCell("B14"));
  ws.getCell("G14").value = data.financialYear || "______";
  b(ws.getCell("G14"));

  // Row 16 — "Dear Sir,"
  ws.getCell("B16").value = "Dear Sir,";
  n(ws.getCell("B16"));

  // Row 18 — Body paragraph (full text, may contain fyEnd inline)
  ws.getCell("B18").value = data.bodyPara;
  n(ws.getCell("B18")); w(ws.getCell("B18"));
  ws.getRow(18).height = 60;

  // Row 22 — Confirm line
  ws.getCell("B22").value = data.confirmLine;
  n(ws.getCell("B22"));

  // Row 25 — Thank You
  ws.getCell("B25").value = "Thank You.";
  n(ws.getCell("B25"));

  // Row 27 — Yours faithfully
  ws.getCell("B27").value = "Yours faithfully,";
  n(ws.getCell("B27"));

  // Rows 28-30 — signature space
  [28, 29, 30].forEach((r) => { ws.getRow(r).height = 18; });

  // Row 31 — Signature line
  ws.getCell("B31").value = "x_____________";
  n(ws.getCell("B31"));

  // Row 32 — Stamp
  ws.getCell("B32").value = "(Signature & stamp)";
  n(ws.getCell("B32"));

  const buf = await wb.xlsx.writeBuffer();
  download(buf, `ManagementLetter_${filenameSlug}.xlsx`);
}
