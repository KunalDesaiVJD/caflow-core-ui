/**
 * Raw-grid → keyed-row parsing for TDS client file imports (Excel/CSV), used
 * by TdsValidateFinalise.tsx before rows are posted to tds-recon-import.
 *
 * Client-prepared TDS exports routinely prepend a company-name title row and
 * a TAN/PAN summary strip before the actual column headers (confirmed
 * against a real client file: row 1 = company name, row 2 = "TAN"/"PAN"
 * strip, row 3 = the real headers). SheetJS's and Papaparse's default "row 1
 * = header" assumption then captures the title row as headers and leaves
 * every real header — Date of Credit, Amount, PAN, etc. — buried as data
 * values, so column matching (both the deterministic pass in
 * tds-recon-import and the LLM) never sees the real header text at all.
 * Detect the real header row by scoring the first few rows against known
 * field-name tokens instead of assuming it's row 1.
 */

const HEADER_ROW_TOKENS = [
  "name", "pan", "date", "amount", "tds", "section", "interest", "rate",
  "srno", "sno", "srnumber", "dob", "natureofpayment", "challan", "bsr", "cin",
  "bank", "voucher", "credit", "payment", "deduction", "party", "vendor",
  "deductee", "nature", "particulars", "remark", "description",
];

const normaliseCell = (v: unknown): string => String(v ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

/** How many cells in a row read as known field-name header tokens. */
function headerScore(row: unknown[]): number {
  let score = 0;
  for (const cell of row) {
    const norm = normaliseCell(cell);
    if (norm && HEADER_ROW_TOKENS.some(t => norm === t || norm.includes(t))) score++;
  }
  return score;
}

/** Scores the first 15 rows by how many cells look like known field names and
 * picks the best match; falls back to row 0 (previous behaviour) when
 * nothing scores highly enough, so already-clean files are unaffected. */
export function detectHeaderRow(grid: unknown[][]): number {
  let bestIdx = 0, bestScore = 0;
  const scanLimit = Math.min(grid.length, 15);
  for (let i = 0; i < scanLimit; i++) {
    const score = headerScore(grid[i] || []);
    if (score > bestScore) { bestScore = score; bestIdx = i; }
  }
  return bestScore >= 3 ? bestIdx : 0;
}

/** Turns a raw grid (array-of-arrays, as produced by `sheet_to_json({header:1})`
 * or Papaparse with `header:false`) into keyed row objects using the detected
 * header row. Stops at the first fully-blank row so a second, differently
 * shaped table further down the sheet (e.g. a "transporters with 194C(6)
 * declaration" block, seen in a real client file) isn't folded into the main
 * data under the wrong columns. */
export function gridToRows(grid: unknown[][]): Record<string, unknown>[] {
  const headerIdx = detectHeaderRow(grid);
  const headerRow = grid[headerIdx] || [];
  const seen = new Map<string, number>();
  const headers = headerRow.map((h, i) => {
    let name = h == null ? "" : String(h).trim();
    if (!name) name = `Column${i + 1}`;
    const count = seen.get(name) ?? 0;
    seen.set(name, count + 1);
    return count ? `${name}_${count}` : name;
  });

  const rows: Record<string, unknown>[] = [];
  let consecutiveBlank = 0;
  for (let r = headerIdx + 1; r < grid.length; r++) {
    const dataRow = grid[r] || [];
    const isBlank = dataRow.every(c => c === null || c === undefined || String(c).trim() === "");
    if (isBlank) {
      // A SINGLE blank spacer row inside the data (a visual gap after a subtotal
      // or between month blocks — common in real client exports) must NOT drop
      // every deductee below it. Only a long run of blanks ends the table.
      if (++consecutiveBlank >= 3) break;
      continue;
    }
    // A non-blank row that itself scores as a HEADER, appearing after a gap, is a
    // genuine second table (e.g. a "194C(6) transporter declaration" block) —
    // stop before folding its rows in under the wrong columns.
    if (consecutiveBlank > 0 && headerScore(dataRow) >= 3) break;
    consecutiveBlank = 0;
    const obj: Record<string, unknown> = {};
    headers.forEach((h, i) => { obj[h] = dataRow[i] ?? null; });
    rows.push(obj);
  }
  return rows;
}
