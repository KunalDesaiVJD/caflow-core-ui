/**
 * nceLetterExport
 * ─────────────────────────────────────────────────────────────────────────────
 * Generates Excel workbooks for NCE letters matching the provided templates
 * EXACTLY: column widths, fonts, merged cells, bold formatting, row heights.
 *
 * Client Certificate template font: Calibri 11
 * Management Letter template font:  Arial 11
 *
 * Border strategy for merged headings (B2:H2, B3:H3):
 *   ExcelJS nullifies non-master cells after mergeCells(), so we cannot set
 *   their borders through the normal API. We set borders on every cell in the
 *   range BEFORE calling mergeCells() — the cell objects exist at that point
 *   and are written to the XLSX even after the merge is recorded.
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

/**
 * Set a thin box border on every cell from startCol to endCol in the given
 * row BEFORE the range is merged.  ExcelJS nullifies non-master cells during
 * mergeCells(), but cell objects created before the call remain in the
 * worksheet's internal _cells array and are written to the XLSX with their
 * styles intact — which is exactly how Excel's own "Format Cells" produces
 * bordered merged-cell headings.
 *
 * Call this helper FIRST, then mergeCells(), then set value/font/alignment.
 */
function preMergeBorderRow(
  ws: ExcelJS.Worksheet,
  row: number,
  startCol: number,
  endCol: number,
  style: ExcelJS.BorderStyle = "thin",
) {
  for (let c = startCol; c <= endCol; c++) {
    // Access each cell directly while it is still an independent object
    const cell = ws.getRow(row).getCell(c);
    cell.border = {
      top:    { style },
      bottom: { style },
      left:   { style },
      right:  { style },
    };
  }
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

  // ── Page setup — exact match to template ──
  // Narrow margins are essential: with 0.35in left/right the 9-column layout
  // fits A4 width and all content fits on one page.
  ws.pageSetup.paperSize        = 9;          // A4
  ws.pageSetup.orientation      = "portrait";
  ws.pageSetup.fitToPage        = false;
  ws.pageSetup.fitToWidth       = 1;
  ws.pageSetup.fitToHeight      = 0;
  ws.pageSetup.scale            = 100;
  ws.pageSetup.showGridLines    = false;
  ws.pageSetup.horizontalCentered = true;
  ws.pageSetup.printArea        = "A1:I43";
  ws.pageSetup.margins = {
    left: 0.35, right: 0.35,
    top:  0.55, bottom: 0.55,
    header: 0.2, footer: 0.2,
  };
  // Match template's initial view (Page Break Preview)
  ws.views = [{ state: "normal", showGridLines: false, view: "pageBreakPreview" } as any];

  // ── Column widths — exact match to template ──
  ws.columns = [
    { width: 3      }, // A — left margin
    { width: 16.86  }, // B — main text
    { width: 10.14  }, // C — cash value / small col
    { width: 9.57   }, // D — "was with the firm..."
    { width: 9.14   }, // E
    { width: 5.71   }, // F — "as on"
    { width: 7.86   }, // G — FY / date
    { width: 31     }, // H — remainder
    { width: 3      }, // I — right margin
  ];

  // Font shortcuts (Calibri — template font for Client Certificate)
  const n = (cell: ExcelJS.Cell) => applyFont(cell);
  const b = (cell: ExcelJS.Cell) => applyFont(cell, { bold: true });

  // ── Row 2 — Entity name ──
  // Set borders on B2:H2 BEFORE merging (see preMergeBorderRow comment above)
  preMergeBorderRow(ws, 2, 2, 8);
  ws.mergeCells("B2:H2");
  ws.getCell("B2").value = data.clientName || "[ENTITY NAME]";
  b(ws.getCell("B2"));
  ws.getCell("B2").alignment = { horizontal: "center", vertical: "middle" };
  ws.getRow(2).height = 21;

  // ── Row 3 — Entity address ──
  preMergeBorderRow(ws, 3, 2, 8);
  ws.mergeCells("B3:H3");
  ws.getCell("B3").value = data.clientAddress || "[ENTITY ADDRESS]";
  b(ws.getCell("B3"));
  ws.getCell("B3").alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  // Auto-grow row 3 to fit wrapped address (B3:H3 = ~90 char-units wide).
  // ExcelJS won't auto-size; set height = ceil(len/85) * 15pt with 18pt min.
  {
    const addr = data.clientAddress || "[ENTITY ADDRESS]";
    const lines = Math.max(1, Math.ceil(addr.length / 85));
    ws.getRow(3).height = Math.max(18, lines * 15);
  }

  // ── Row 5 — Date ──
  ws.mergeCells("B5:H5");
  ws.getCell("B5").value = `Date : ${fmtDate(data.letterDate)}`;
  n(ws.getCell("B5"));
  ws.getCell("B5").alignment = { horizontal: "left", vertical: "top" };

  // ── Row 7 — "To," ──
  ws.getCell("B7").value = "To,";
  n(ws.getCell("B7"));
  ws.getCell("B7").alignment = { vertical: "top" };

  // ── Row 8 — Firm name ──
  ws.getCell("B8").value = data.firmName || "[AUDIT FIRM NAME]";
  n(ws.getCell("B8"));
  ws.getCell("B8").alignment = { vertical: "top" };

  // ── Row 9 — Firm address ──
  ws.getCell("B9").value = data.firmAddress || "[AUDIT FIRM ADDRESS]";
  n(ws.getCell("B9"));
  ws.getCell("B9").alignment = { vertical: "top" };

  // ── Row 10 — FRN ──
  ws.getCell("B10").value = data.firmFRN ? `FRN: ${data.firmFRN}` : "";
  n(ws.getCell("B10"));
  ws.getCell("B10").alignment = { vertical: "top" };

  // ── Row 12 — Dear Sir ──
  ws.getCell("B12").value = "Dear Sir,";
  n(ws.getCell("B12"));
  ws.getCell("B12").alignment = { vertical: "top", wrapText: true };

  // ── Row 13 — Opening line ──
  // No wrapText — text in B13 and H13 overflows naturally across empty cols,
  // exactly as the template does (wrapText in a narrow col would break layout).
  ws.getCell("B13").value = "In connection with the Tax Audits for the financial year";
  n(ws.getCell("B13"));
  ws.getCell("B13").alignment = { vertical: "top" };
  ws.getCell("G13").value = data.financialYear || "______";
  b(ws.getCell("G13"));
  ws.getCell("G13").alignment = { vertical: "top" };
  ws.getCell("H13").value = "u/s. 44AB, we herewith certify as";
  n(ws.getCell("H13"));
  ws.getCell("H13").alignment = { vertical: "top" };

  // ── Row 14 — "under :" ──
  ws.getCell("B14").value = "under :";
  n(ws.getCell("B14"));
  ws.getCell("B14").alignment = { vertical: "top" };

  // ── Spacer rows 15 and 17 — height 11.25 to match template ──
  ws.getRow(15).height = 11.25;
  ws.getRow(17).height = 11.25;

  // ── Row 16 — Cash on hand ──
  // D16 text overflows naturally into empty E-H — NO merge, NO wrapText.
  ws.getCell("B16").value = "Cash on hand  Rs..";
  n(ws.getCell("B16"));
  ws.getCell("B16").alignment = { vertical: "top", wrapText: true };
  const coh = data.cashOnHand ? parseFloat(data.cashOnHand) : 0;
  ws.getCell("C16").value = coh;
  ws.getCell("C16").numFmt = "#,##0.00";
  n(ws.getCell("C16"));
  ws.getCell("C16").alignment = { vertical: "top" };
  ws.getCell("D16").value = "was with the firm and same was tallied with the cash book.";
  n(ws.getCell("D16"));
  ws.getCell("D16").alignment = { vertical: "top" }; // NO wrapText — let overflow
  // Don't force a height — template uses default so the row sizes naturally

  // ── Row 18 — Closing stock (B18:D18 merged) ──
  ws.mergeCells("B18:D18");
  ws.getCell("B18").value = "Approxi. Value of the Closing stock is Rs.";
  n(ws.getCell("B18"));
  ws.getCell("B18").alignment = { horizontal: "left", vertical: "top", wrapText: true };
  const cs = data.closingStock ? parseFloat(data.closingStock) : 0;
  ws.getCell("E18").value = cs;
  ws.getCell("E18").numFmt = "#,##0.00";
  n(ws.getCell("E18"));
  ws.getCell("E18").alignment = { vertical: "top" };
  ws.getCell("F18").value = "as on";
  n(ws.getCell("F18"));
  ws.getCell("F18").alignment = { vertical: "top" };
  ws.getCell("G18").value = data.closingStockDate ? fmtDate(data.closingStockDate) : "_______";
  n(ws.getCell("G18"));
  ws.getCell("G18").alignment = { vertical: "top" };
  ws.getCell("H18").value = "and same was physically verified.";
  n(ws.getCell("H18"));
  ws.getCell("H18").alignment = { vertical: "top" };

  // ── Rows 19+ — Dynamic points ──
  // Template fixed rows for points (up to 7): 19, 21, 23, 25, 27, 29, 31.
  // Odd rows = content; even rows between them = spacers at h=11.25pt.
  // No clause numbering — text goes directly into the merged B:H cell.
  //
  // Excel can auto-fit wrapped text only after the file is opened, so
  // we pre-compute row height from text length and the merged width
  // (B:H ≈ 16.86+10.14+9.57+9.14+5.71+7.86+31 = ~90 chars/line, conservative 85).
  const CHARS_PER_LINE = 85;
  const LINE_PT        = 15;
  const heightForText  = (text: string) => {
    const wrapped = text.split('\n')
      .reduce((sum, segment) => sum + Math.max(1, Math.ceil(segment.length / CHARS_PER_LINE)), 0);
    return Math.max(15, wrapped * LINE_PT);
  };
  const FIXED_ROWS = [19, 21, 23, 25, 27, 29, 31];
  const points = data.points || [];

  let lastPointRow = 18;
  points.forEach((text, i) => {
    const row = i < FIXED_ROWS.length
      ? FIXED_ROWS[i]
      : 31 + (i - FIXED_ROWS.length + 1) * 2;

    ws.mergeCells(`B${row}:H${row}`);
    const cell = ws.getCell(`B${row}`);
    cell.value = text;
    n(cell);
    cell.alignment = { wrapText: true, horizontal: "left", vertical: "top" };

    // Auto-grow content row to fit all wrapped lines
    ws.getRow(row).height = heightForText(text);

    // Spacer row immediately before this content row
    if (row > 19) ws.getRow(row - 1).height = 11.25;

    lastPointRow = row;
  });

  // ── Closing line (B:H merged) ──
  const closingRow = Math.max(33, lastPointRow + 2);
  // Spacer row before closing line
  ws.getRow(closingRow - 1).height = 11.25;
  ws.mergeCells(`B${closingRow}:H${closingRow}`);
  const clCell = ws.getCell(`B${closingRow}`);
  clCell.value = data.closingLine || "You are requested to note the same.";
  n(clCell);
  clCell.alignment = { horizontal: "left", vertical: "top", wrapText: true };

  // ── Spacer row before signature block (template: height 9) ──
  const sig = closingRow + 2; // row 35
  ws.getRow(sig - 1).height = 9;

  for (const r of [sig, sig + 1]) {
    ws.mergeCells(`B${r}:D${r}`);
    ws.getRow(r).height = 15;
  }

  const yfRow = sig + 2;
  ws.mergeCells(`B${yfRow}:D${yfRow}`);
  ws.getCell(`B${yfRow}`).value = "Yours faithfully,";
  b(ws.getCell(`B${yfRow}`));
  ws.getCell(`B${yfRow}`).alignment = { vertical: "top", wrapText: true };
  ws.getRow(yfRow).height = 15;

  for (const r of [sig + 3, sig + 4]) {
    ws.mergeCells(`B${r}:D${r}`);
    ws.mergeCells(`F${r}:H${r}`);
    ws.getRow(r).height = 15;
  }

  const rOnlyRow = sig + 5;
  ws.mergeCells(`F${rOnlyRow}:H${rOnlyRow}`);
  ws.getRow(rOnlyRow).height = 15;

  const xRow = sig + 6;
  ws.mergeCells(`B${xRow}:D${xRow}`);
  ws.getCell(`B${xRow}`).value = "x_____________";
  b(ws.getCell(`B${xRow}`));
  ws.getCell(`B${xRow}`).alignment = { vertical: "top", wrapText: true };
  ws.getRow(xRow).height = 15;

  const stRow = sig + 7;
  ws.mergeCells(`B${stRow}:D${stRow}`);
  ws.getCell(`B${stRow}`).value = "(Signature & stamp)";
  b(ws.getCell(`B${stRow}`));
  ws.getCell(`B${stRow}`).alignment = { vertical: "top", wrapText: true };
  ws.getRow(stRow).height = 15;

  const finRow = sig + 8;
  ws.mergeCells(`B${finRow}:D${finRow}`);
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

  // ── Page setup — exact match to template ──
  ws.pageSetup.paperSize        = 9;          // A4
  ws.pageSetup.orientation      = "portrait";
  ws.pageSetup.fitToPage        = false;
  ws.pageSetup.scale            = 100;
  ws.pageSetup.printArea        = "A1:I33";
  ws.pageSetup.margins = {
    left: 0.7, right: 0.7,
    top:  0.75, bottom: 0.75,
    header: 0.3, footer: 0.3,
  };

  // ── Column widths — exact match to template ──
  ws.columns = [
    { width: 3           }, // A — left margin
    { width: 11          }, // B
    { width: 10.140625   }, // C
    { width: 9.5703125   }, // D
    { width: 9.140625    }, // E
    { width: 11.42578125 }, // F
    { width: 11.42578125 }, // G
    { width: 18          }, // H
    { width: 3           }, // I — right margin
  ];

  // Font: Arial (template font for management letter)
  const n = (cell: ExcelJS.Cell) => applyFont(cell, { name: "Arial" });
  const b = (cell: ExcelJS.Cell) => applyFont(cell, { name: "Arial", bold: true });

  // ── Row 2 — Entity name ──
  preMergeBorderRow(ws, 2, 2, 8); // borders on B2:H2 before merge
  ws.mergeCells("B2:H2");
  ws.getCell("B2").value = data.clientName || "[ENTITY NAME]";
  b(ws.getCell("B2"));
  ws.getCell("B2").alignment = { horizontal: "center", vertical: "middle" };
  ws.getRow(2).height = 20.25;

  // ── Row 3 — Entity address ──
  preMergeBorderRow(ws, 3, 2, 8); // borders on B3:H3 before merge
  ws.mergeCells("B3:H3");
  ws.getCell("B3").value = data.clientAddress || "[ENTITY ADDRESS]";
  b(ws.getCell("B3"));
  ws.getCell("B3").alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  ws.getRow(3).height = 19.5;

  // ── Spacer rows — exact heights from template ──
  ws.getRow(4).height  = 4.9;   // tiny gap after address
  ws.getRow(13).height = 11.25; // gap before Subject
  ws.getRow(15).height = 9;     // gap between Subject and Dear Sir
  ws.getRow(17).height = 9;     // gap between Dear Sir and body
  ws.getRow(19).height = 9;     // gap between body rows 18 and 20
  ws.getRow(21).height = 9;     // gap between row 20 and confirm line
  ws.getRow(23).height = 9;     // gap after confirm line

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
  ws.getCell("B10").alignment = { vertical: "top" };

  // ── Row 11 — FRN ──
  ws.getCell("B11").value = data.firmFRN ? `FRN: ${data.firmFRN}` : "";
  n(ws.getCell("B11"));
  ws.getCell("B11").alignment = { vertical: "top" };

  // ── Row 14 — Subject ──
  ws.mergeCells("B14:F14");
  ws.getCell("B14").value = "Subject : Appointment as Tax Auditors for Financial year ";
  n(ws.getCell("B14"));
  ws.getCell("B14").alignment = { horizontal: "left", vertical: "top", wrapText: true };
  ws.getCell("G14").value = data.financialYear || "______";
  n(ws.getCell("G14"));
  ws.getCell("G14").alignment = { vertical: "top", wrapText: true };
  ws.getRow(14).height = 17.25;

  // ── Row 16 — Dear Sir (includes "\n\n" newlines to match template) ──
  ws.mergeCells("B16:H16");
  ws.getCell("B16").value = "Dear Sir,\n\n";
  n(ws.getCell("B16"));
  ws.getCell("B16").alignment = { horizontal: "left", vertical: "top", wrapText: true };
  ws.getRow(16).height = 18.75;

  // ── Rows 18 + 20 — Body paragraph (split to match template layout) ──
  // Template row 18: "We are pleased ... u/s. 44AB"  (height 30.75)
  // Template row 20: "books of accounts ... ending on" (B20:G20) + fyEnd (H20)
  //
  // bodyPara arrives fully resolved (fyEnd already substituted).
  // We split at "u/s. 44AB" then strip fyEnd from the tail for H20.
  const SPLIT_MARKER = "u/s. 44AB";
  const splitIdx = data.bodyPara.indexOf(SPLIT_MARKER);
  let row18text: string;
  let row20label: string;

  if (splitIdx !== -1) {
    row18text  = data.bodyPara.slice(0, splitIdx + SPLIT_MARKER.length).trim();
    let tail   = data.bodyPara.slice(splitIdx + SPLIT_MARKER.length).trim();
    // Remove trailing fyEnd value and any trailing period
    if (data.fyEnd && tail.includes(data.fyEnd)) {
      row20label = tail.slice(0, tail.lastIndexOf(data.fyEnd)).trim().replace(/\.+$/, "").trim();
    } else {
      row20label = tail.replace(/\.+$/, "").trim();
    }
  } else {
    // Fallback: whole body in row 18, row 20 shows standard text
    row18text  = data.bodyPara;
    row20label = "books of accounts of my/our business for the financial year ending on";
  }

  ws.mergeCells("B18:H18");
  ws.getCell("B18").value = row18text;
  n(ws.getCell("B18"));
  ws.getCell("B18").alignment = { horizontal: "justify", vertical: "top", wrapText: true };
  ws.getRow(18).height = 30.75;

  ws.mergeCells("B20:G20");
  ws.getCell("B20").value = row20label;
  n(ws.getCell("B20"));
  ws.getCell("B20").alignment = { horizontal: "left", vertical: "top", wrapText: true };
  ws.getCell("H20").value = data.fyEnd || "______";
  n(ws.getCell("H20"));
  ws.getCell("H20").alignment = { vertical: "top", wrapText: true };
  ws.getRow(20).height = 15;

  // ── Row 22 — Confirm line ──
  ws.mergeCells("B22:G22");
  ws.getCell("B22").value = data.confirmLine;
  n(ws.getCell("B22"));
  ws.getCell("B22").alignment = { horizontal: "left", vertical: "top", wrapText: true };
  ws.getRow(22).height = 15;

  // ── Row 24 — Blank spacer ──
  ws.mergeCells("B24:D24");
  ws.getRow(24).height = 15;

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

  // ── Rows 28-30 — Signature space ──
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
