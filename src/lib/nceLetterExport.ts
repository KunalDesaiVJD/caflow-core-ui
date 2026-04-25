/**
 * nceLetterExport
 * ─────────────────────────────────────────────────────────────────────────────
 * Generates Excel workbooks for NCE letters matching the provided templates
 * EXACTLY: column widths, fonts, merged cells, bold formatting, row heights.
 *
 * Client Certificate template font: Calibri 11
 * Management Letter template font:  Arial 11
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
  points:           string[]; // dynamic list of numbered paragraphs (items 3+)
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
  bodyPara:      string;   // full resolved body (fyEnd already substituted)
  confirmLine:   string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

type FontOpts = { bold?: boolean; name?: string; size?: number };

function applyFont(cell: ExcelJS.Cell, opts: FontOpts = {}) {
  cell.font = {
    name: opts.name ?? "Calibri",
    size: opts.size ?? 11,
    bold: opts.bold ?? false,
  };
}

function download(buf: ExcelJS.Buffer, filename: string) {
  const blob = new Blob([buf as BlobPart], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
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

  // ── Column widths — exact match to template ──
  ws.columns = [
    { width: 3      }, // A — left margin
    { width: 16.86  }, // B — main text
    { width: 10.14  }, // C — cash value / small col
    { width: 9.57   }, // D — "was with the firm..."
    { width: 9.14   }, // E — closing stock value
    { width: 5.71   }, // F — "as on"
    { width: 7.86   }, // G — FY / date
    { width: 31     }, // H — remainder
    { width: 3      }, // I — right margin
  ];

  // Font shortcuts (Calibri — template font)
  const n = (cell: ExcelJS.Cell) => applyFont(cell);
  const b = (cell: ExcelJS.Cell) => applyFont(cell, { bold: true });
  const ni = (cell: ExcelJS.Cell) => applyFont(cell, { name: "Calibri" }); // alias

  // ── Row 2 — Entity name ──
  ws.mergeCells("B2:H2");
  ws.getCell("B2").value = data.clientName || "[ENTITY NAME]";
  b(ws.getCell("B2"));
  ws.getCell("B2").alignment = { horizontal: "center", vertical: "middle" };

  // ── Row 3 — Entity address ──
  ws.mergeCells("B3:H3");
  ws.getCell("B3").value = data.clientAddress || "[ENTITY ADDRESS]";
  b(ws.getCell("B3"));
  ws.getCell("B3").alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  ws.getRow(3).height = 36;

  // ── Row 5 — Date ──
  ws.mergeCells("B5:H5");
  ws.getCell("B5").value = `Date : ${fmtDate(data.letterDate)}`;
  n(ws.getCell("B5"));
  ws.getCell("B5").alignment = { horizontal: "left", vertical: "top" };

  // ── Row 7 — "To," ──
  ws.getCell("B7").value = "To,";
  n(ws.getCell("B7"));

  // ── Row 8 — Firm name (PLAIN per template) ──
  ws.getCell("B8").value = data.firmName || "[AUDIT FIRM NAME]";
  n(ws.getCell("B8"));

  // ── Row 9 — Firm address ──
  ws.getCell("B9").value = data.firmAddress || "[AUDIT FIRM ADDRESS]";
  n(ws.getCell("B9"));
  ws.getCell("B9").alignment = { wrapText: true, vertical: "top" };
  ws.getRow(9).height = 36;

  // ── Row 10 — FRN ──
  ws.getCell("B10").value = data.firmFRN ? `FRN: ${data.firmFRN}` : "";
  n(ws.getCell("B10"));

  // ── Row 12 — Dear Sir ──
  ws.getCell("B12").value = "Dear Sir,";
  n(ws.getCell("B12"));
  ws.getCell("B12").alignment = { wrapText: true };

  // ── Rows 13-14 — Opening line ──
  ws.getCell("B13").value = "In connection with the Tax Audits for the financial year";
  n(ws.getCell("B13"));
  ws.getCell("G13").value = data.financialYear || "______";
  b(ws.getCell("G13"));
  ws.getCell("H13").value = "u/s. 44AB, we herewith certify as";
  n(ws.getCell("H13"));
  ws.getCell("B14").value = "under :";
  n(ws.getCell("B14"));

  // ── Row 16 — Cash on hand ──
  ws.getCell("B16").value = "Cash on hand Rs.";
  n(ws.getCell("B16"));
  const coh = data.cashOnHand ? parseFloat(data.cashOnHand) : 0;
  ws.getCell("C16").value = coh;
  ws.getCell("C16").numFmt = "#,##0.00";
  n(ws.getCell("C16"));
  ws.getCell("D16").value = "was with the firm and same was tallied with the cash book.";
  n(ws.getCell("D16"));
  ws.getCell("D16").alignment = { wrapText: true, vertical: "top" };
  ws.getRow(16).height = 18;

  // ── Row 18 — Closing stock ──
  ws.mergeCells("B18:D18");
  ws.getCell("B18").value = "Approxi. Value of the Closing stock is Rs.";
  n(ws.getCell("B18"));
  const cs = data.closingStock ? parseFloat(data.closingStock) : 0;
  ws.getCell("E18").value = cs;
  ws.getCell("E18").numFmt = "#,##0.00";
  n(ws.getCell("E18"));
  ws.getCell("F18").value = "as on";
  n(ws.getCell("F18"));
  ws.getCell("G18").value = data.closingStockDate ? fmtDate(data.closingStockDate) : "_______";
  n(ws.getCell("G18"));
  ws.getCell("H18").value = "and same was physically verified.";
  n(ws.getCell("H18"));

  // ── Rows 19+ — Dynamic points ──
  // Template fixed rows for points (up to 7): 19, 21, 23, 25, 27, 29, 31
  // Extra points beyond 7 extend past row 31
  const FIXED_ROWS = [19, 21, 23, 25, 27, 29, 31];
  const points = data.points || [];

  let lastPointRow = 17;
  points.forEach((text, i) => {
    const row = i < FIXED_ROWS.length
      ? FIXED_ROWS[i]
      : 31 + (i - FIXED_ROWS.length + 1) * 2;

    ws.mergeCells(`B${row}:H${row}`);
    const cell = ws.getCell(`B${row}`);
    cell.value = text;
    n(cell);
    cell.alignment = { wrapText: true, horizontal: "justify", vertical: "top" };
    ws.getRow(row).height = 32;
    lastPointRow = row;
  });

  // ── Closing line ──
  const closingRow = Math.max(33, lastPointRow + 2);
  ws.mergeCells(`B${closingRow}:H${closingRow}`);
  const clCell = ws.getCell(`B${closingRow}`);
  clCell.value = data.closingLine || "You are requested to note the same.";
  n(clCell);
  clCell.alignment = { horizontal: "left", wrapText: true };

  // ── Signature block (BOLD throughout — exact template layout) ──
  const sig = closingRow + 2; // row 35 for default 7 points

  // sig, sig+1 — blank bold spacer rows
  for (const r of [sig, sig + 1]) {
    ws.mergeCells(`B${r}:D${r}`);
    b(ws.getCell(`B${r}`));
    ws.getRow(r).height = 15;
  }

  // "Yours faithfully,"
  const yfRow = sig + 2; // row 37
  ws.mergeCells(`B${yfRow}:D${yfRow}`);
  ws.getCell(`B${yfRow}`).value = "Yours faithfully,";
  b(ws.getCell(`B${yfRow}`));
  ws.getRow(yfRow).height = 15;

  // Two-column signature space (left B:D + right F:H)
  for (const r of [sig + 3, sig + 4]) {
    ws.mergeCells(`B${r}:D${r}`);
    ws.mergeCells(`F${r}:H${r}`);
    b(ws.getCell(`B${r}`));
    ws.getRow(r).height = 15;
  }

  // Right-only spacer
  const rOnlyRow = sig + 5;
  ws.mergeCells(`F${rOnlyRow}:H${rOnlyRow}`);
  ws.getRow(rOnlyRow).height = 15;

  // "x_____________"
  const xRow = sig + 6; // row 41
  ws.mergeCells(`B${xRow}:D${xRow}`);
  ws.getCell(`B${xRow}`).value = "x_____________";
  b(ws.getCell(`B${xRow}`));
  ws.getRow(xRow).height = 15;

  // "(Signature & stamp)"
  const stRow = sig + 7; // row 42
  ws.mergeCells(`B${stRow}:D${stRow}`);
  ws.getCell(`B${stRow}`).value = "(Signature & stamp)";
  b(ws.getCell(`B${stRow}`));
  ws.getRow(stRow).height = 15;

  // Final blank bold row
  const finRow = sig + 8; // row 43
  ws.mergeCells(`B${finRow}:D${finRow}`);
  b(ws.getCell(`B${finRow}`));
  ws.getRow(finRow).height = 15;

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

  // ── Column widths — exact match to template ──
  ws.columns = [
    { width: 3         }, // A — left margin
    { width: 11        }, // B
    { width: 10.140625 }, // C
    { width: 9.5703125 }, // D
    { width: 9.140625  }, // E
    { width: 11.42578125 }, // F
    { width: 11.42578125 }, // G
    { width: 18        }, // H
    { width: 3         }, // I — right margin
  ];

  // Font: Arial (template font for management letter)
  const n = (cell: ExcelJS.Cell) => applyFont(cell, { name: "Arial" });
  const b = (cell: ExcelJS.Cell) => applyFont(cell, { name: "Arial", bold: true });

  // ── Row 2 — Entity name ──
  ws.mergeCells("B2:H2");
  ws.getCell("B2").value = data.clientName || "[ENTITY NAME]";
  b(ws.getCell("B2"));
  ws.getCell("B2").alignment = { horizontal: "center", vertical: "middle" };
  ws.getRow(2).height = 20.25;

  // ── Row 3 — Entity address ──
  ws.mergeCells("B3:H3");
  ws.getCell("B3").value = data.clientAddress || "[ENTITY ADDRESS]";
  b(ws.getCell("B3"));
  ws.getCell("B3").alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  ws.getRow(3).height = 19.5;

  // ── Row 6 — Date ──
  ws.getCell("B6").value = `Date : ${fmtDate(data.letterDate)}`;
  n(ws.getCell("B6"));
  ws.getCell("B6").alignment = { vertical: "top" };

  // ── Row 8 — "To," ──
  ws.getCell("B8").value = "To,";
  n(ws.getCell("B8"));
  ws.getCell("B8").alignment = { vertical: "top" };

  // ── Row 9 — Firm name ──
  ws.getCell("B9").value = data.firmName || "[AUDIT FIRM NAME]";
  n(ws.getCell("B9"));
  ws.getCell("B9").alignment = { vertical: "top" };

  // ── Row 10 — Firm address ──
  ws.getCell("B10").value = data.firmAddress || "[AUDIT FIRM ADDRESS]";
  n(ws.getCell("B10"));
  ws.getCell("B10").alignment = { vertical: "top", wrapText: true };

  // ── Row 11 — FRN ──
  ws.getCell("B11").value = data.firmFRN ? `FRN: ${data.firmFRN}` : "";
  n(ws.getCell("B11"));
  ws.getCell("B11").alignment = { vertical: "top" };

  // ── Row 14 — Subject ──
  ws.mergeCells("B14:F14");
  ws.getCell("B14").value = "Subject : Appointment as Tax Auditors for Financial year";
  n(ws.getCell("B14"));
  ws.getCell("B14").alignment = { horizontal: "left", vertical: "top", wrapText: true };
  ws.getCell("G14").value = data.financialYear || "______";
  n(ws.getCell("G14"));
  ws.getCell("G14").alignment = { vertical: "top", wrapText: true };
  ws.getRow(14).height = 17.25;

  // ── Row 16 — Dear Sir ──
  ws.mergeCells("B16:H16");
  ws.getCell("B16").value = "Dear Sir,";
  n(ws.getCell("B16"));
  ws.getCell("B16").alignment = { horizontal: "left", vertical: "top", wrapText: true };
  ws.getRow(16).height = 18.75;

  // ── Row 18 — Body paragraph (full resolved text, wrap) ──
  ws.mergeCells("B18:H18");
  ws.getCell("B18").value = data.bodyPara;
  n(ws.getCell("B18"));
  ws.getCell("B18").alignment = { horizontal: "justify", vertical: "top", wrapText: true };
  ws.getRow(18).height = 60;

  // ── Row 22 — Confirm line ──
  ws.mergeCells("B22:G22");
  ws.getCell("B22").value = data.confirmLine;
  n(ws.getCell("B22"));
  ws.getCell("B22").alignment = { horizontal: "left", vertical: "top", wrapText: true };
  ws.getRow(22).height = 15;

  // ── Row 25 — Thank You ──
  ws.mergeCells("B25:D25");
  ws.getCell("B25").value = "Thank You.";
  b(ws.getCell("B25"));
  ws.getCell("B25").alignment = { vertical: "top", wrapText: true };
  ws.getRow(25).height = 15;

  // ── Row 27 — Yours faithfully ──
  ws.mergeCells("B27:D27");
  ws.getCell("B27").value = "Yours faithfully,";
  b(ws.getCell("B27"));
  ws.getCell("B27").alignment = { vertical: "top", wrapText: true };
  ws.getRow(27).height = 15;

  // ── Rows 28-30 — Signature space (left B:D + right F:H) ──
  for (const r of [28, 29]) {
    ws.mergeCells(`B${r}:D${r}`);
    ws.mergeCells(`F${r}:H${r}`);
    ws.getRow(r).height = 15;
  }
  ws.mergeCells("F30:H30");
  ws.getRow(30).height = 15;

  // ── Row 31 — Signature line ──
  ws.mergeCells("B31:D31");
  ws.getCell("B31").value = "x_____________";
  b(ws.getCell("B31"));
  ws.getCell("B31").alignment = { vertical: "top", wrapText: true };
  ws.getRow(31).height = 15;

  // ── Row 32 — Stamp ──
  ws.mergeCells("B32:D32");
  ws.getCell("B32").value = "(Signature & stamp)";
  b(ws.getCell("B32"));
  ws.getCell("B32").alignment = { vertical: "top", wrapText: true };
  ws.getRow(32).height = 15;

  // ── Row 33 — Empty closer ──
  ws.mergeCells("B33:D33");
  ws.getRow(33).height = 15;

  const buf = await wb.xlsx.writeBuffer();
  download(buf, `ManagementLetter_${filenameSlug}.xlsx`);
}
