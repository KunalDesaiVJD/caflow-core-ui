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

// A GENUINE deductee-table header always names the party IDENTITY (PAN / Name /
// Party / Deductee / Particulars). A row that scores as a header but has NONE of
// these is a SECTION or MONTH LABEL that merely repeats a few trailing sub-headers
// (e.g. "Feb-26 … TDS PAID DATE CHALLAN BSR") — it must NOT replace the real header.
//
// Match identity terms as WHOLE WORDS on the raw cell (plus a few glued header
// spellings) — NOT as substrings — so ordinary deductee VALUES like "Suresh
// Company" or the surname "Pandey" (both contain the letters "pan") are NOT
// mistaken for a "PAN" header. `\bpan\b` matches "PAN No" but not "pandey".
const IDENTITY_WORD_RE = /\b(pan|name|party|deductee|deductees|particulars?|vendor|assessee|payee|beneficiary)\b/i;
const IDENTITY_COMPOUND = ["panno", "pannumber", "panofdeductee", "deducteepan", "partypan", "vendorpan", "deducteename", "partyname", "nameofdeductee", "nameofparty", "vendorname", "payeename", "assesseename", "partysname"];
function hasIdentityToken(row: unknown[]): boolean {
  for (const cell of row) {
    const raw = String(cell ?? "").trim();
    if (!raw) continue;
    if (IDENTITY_WORD_RE.test(raw)) return true;                       // "PAN No", "Party Name", "Name of Deductee"
    const norm = normaliseCell(raw);
    if (norm && IDENTITY_COMPOUND.some(c => norm === c || norm.includes(c))) return true; // glued: "PANNo", "DeducteeName"
  }
  return false;
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
    // stop before folding its rows in under the wrong columns. A second table
    // is often preceded by its own title row (e.g. "Transporter who have
    // submitted declaration") sitting between the blank gap and its real
    // header row — so also peek one row ahead: if THIS row doesn't score as a
    // header but the NEXT one does, this row is that title, and the table
    // boundary is here, not one row later.
    if (consecutiveBlank > 0 && (headerScore(dataRow) >= 3 || headerScore(grid[r + 1] || []) >= 3)) break;
    consecutiveBlank = 0;
    const obj: Record<string, unknown> = {};
    headers.forEach((h, i) => { obj[h] = dataRow[i] ?? null; });
    rows.push(obj);
  }
  return rows;
}

// ── Robust multi-BLOCK / multi-SHEET extraction ─────────────────────────────
// Many client working files aren't a single clean table. A common layout (seen
// in real files) is ONE SHEET PER SECTION (named "194C", "94H"=194H, "194Q"…),
// each sheet holding several month blocks — every block a repeated header row,
// its data rows, and a "TOTAL 194C" summary row — with the section available
// only from the SHEET NAME, never a column. gridToRows (single header, stop at a
// gap) can't handle that. extractSheetRows below walks the whole grid, re-reads
// the header at each block, and picks out data rows by the ONE unambiguous
// signal every deductee line has and no total/month/label/junk row does: a PAN.

const PAN_RE = /\b[A-Z]{5}[0-9]{4}[A-Z]\b/;
// Explicit "PAN unavailable" sentinels — a genuine deductee under 206AA (20%
// higher-rate) often has no PAN, printed as "PANNOTAVBL"/"PAN Not Available"/
// "PAN Applied"/"PAN Awaited"/"PAN NA". Such a line IS a real deductee to
// import, so it's admitted even without a PAN (but only inside a locked header
// block — see extractSheetRows — so totals/labels/ledger rows stay excluded).
const NO_PAN_RE = /pan\s*(not\s*av|applied|awaited|na\b|nil\b)/i;

/** "194C" → 194C · "94H" → 194H · "92B" → 192B · "194A " → 194A · else null. */
export function sectionFromSheetName(name: string): string | null {
  const s = (name || "").trim().toUpperCase();
  let m = s.match(/\b(19[0-9][A-Z]{0,2}|20[0-9][A-Z]{0,2})\b/);
  if (m) return m[1];
  m = s.match(/^(9[0-9][A-Z]{0,2})$/); // leading 1 dropped: 94C → 194C, 92B → 192B
  if (m) return "1" + m[1];
  return null;
}

function buildHeaderNames(headerRow: unknown[]): string[] {
  const seen = new Map<string, number>();
  return headerRow.map((h, i) => {
    let name = h == null ? "" : String(h).trim();
    if (!name) name = `Column${i + 1}`;
    const count = seen.get(name) ?? 0;
    seen.set(name, count + 1);
    return count ? `${name}_${count}` : name;
  });
}

/**
 * Extract every deductee data row from ONE sheet's grid, tolerating repeated
 * header blocks, month labels, TOTAL/summary rows, pre-header title/TAN-PAN
 * strips and unrelated content (e.g. Tally ledger vouchers).
 *
 * A genuine TDS deductee line ALWAYS carries a PAN, so a PAN is the one reliable,
 * format-independent signal for a data row — requiring it cleanly rejects ledger
 * Debit/Credit rows, subtotals, notes and the TAN/PAN header strip, without any
 * per-file tuning. Rows appearing BEFORE the sheet's header (when it has one) are
 * also skipped as title/summary strips. When `sectionHint` is given (the section
 * derived from the sheet name) it's attached as a synthetic "Section" column, so
 * the section is captured even for files that have no section column.
 */
export function extractSheetRows(grid: unknown[][], sectionHint: string | null): Record<string, unknown>[] {
  const n = grid.length;
  // Score every row ONCE, and note whether it carries a PAN. A genuine HEADER
  // row scores high on field-name tokens AND has no deductee PAN; a DATA row
  // whose party name/values coincidentally hit ≥3 header tokens (e.g. a vendor
  // literally named "Intec Infonet Private Limited") must NOT be mistaken for a
  // header — if it were, it'd be dropped AND every row beneath it would be
  // re-keyed under this data row's values, corrupting the column mapping and
  // silently losing those deductees (observed: a whole month-block of rows went
  // missing this way). Requiring "no PAN" makes header detection robust.
  const scores = new Array<number>(n);
  const rowHasPan = new Array<boolean>(n);
  let hasHeader = false;
  for (let r = 0; r < n; r++) {
    const row = grid[r] || [];
    scores[r] = headerScore(row);
    let hp = false;
    for (let i = 0; i < row.length; i++) { const c = row[i]; if (c != null && PAN_RE.test(String(c).toUpperCase().replace(/\s+/g, ""))) { hp = true; break; } }
    rowHasPan[r] = hp;
    if (scores[r] >= 3 && !hp) hasHeader = true;
  }
  const rows: Record<string, unknown>[] = [];
  let headers: string[] | null = null;
  let headerCells: unknown[] | null = null; // raw header cells (for MULTI-ROW header merge)
  let lastHeaderRow = -2;
  const MONTHS = /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|q[1-4]|quarter)/i;
  for (let r = 0; r < n; r++) {
    const row = grid[r] || [];
    // Count non-empty cells without allocating a filtered array (hot loop).
    let nonEmptyCount = 0;
    for (let i = 0; i < row.length; i++) { const c = row[i]; if (c != null && String(c).trim() !== "") nonEmptyCount++; }
    if (nonEmptyCount === 0) continue;
    if (scores[r] >= 3 && !rowHasPan[r]) {
      const consecutive = headerCells != null && lastHeaderRow === r - 1;
      // A row that scores as a header but names NO identity column (PAN/Name/Party)
      // and is NOT the sub-label row of the current header is a SECTION or MONTH
      // LABEL that only repeats a few trailing sub-headers (e.g. "Feb-26 … TDS PAID
      // DATE CHALLAN BSR"). REPLACING the locked real header with it re-keys the
      // whole block below under "Feb-26/Column2/…", so the column mapper — built on
      // the real header names — then silently DROPS every one of those deductees
      // (the "33 of 100" record-loss bug). Keep the locked header; treat this row
      // as a label and skip it (it carries no PAN, so it's never a data row).
      // Also peek at the NEXT row: a genuine SECOND table can have its identity
      // column on a sub-label row directly below (a two-row header). Detect that by
      // whether the next row itself looks like a HEADER (scores ≥ 3 AND has no PAN)
      // — NOT by scanning its values for identity words, because a real deductee
      // NAME can legitimately contain "party"/"name"/etc. A data row always carries
      // a PAN, so it is never "header-like".
      const nextIsHeaderLike = (scores[r + 1] ?? 0) >= 3 && !(rowHasPan[r + 1] ?? false);
      if (!consecutive && headers != null && !hasIdentityToken(row) && !nextIsHeaderLike) continue;
      // MULTI-ROW HEADER: a main label row (e.g. "Bill" "TDS" "Bank" "Party's
      // Name") directly followed by a sub-label row ("Amt." "Amt" "Name") is one
      // logical header split across two rows — VERY common in real TDS working
      // files. MERGE consecutive header rows PER COLUMN: "Bill"+"Amt."→"Bill Amt.".
      // A genuine, non-consecutive NEW header (with an identity column) still
      // replaces (a real second table further down).
      if (consecutive) {
        const m = Math.max(headerCells!.length, row.length);
        for (let i = 0; i < m; i++) {
          const sub = row[i] == null ? "" : String(row[i]).trim();
          if (sub) headerCells![i] = `${headerCells![i] == null ? "" : String(headerCells![i]).trim()} ${sub}`.trim();
        }
      } else {
        headerCells = row.slice();
      }
      headers = buildHeaderNames(headerCells!);
      lastHeaderRow = r;
      continue;
    } // header ONLY if it has no PAN
    if (hasHeader && !headers) continue;                                 // pre-header strip (title / TAN-PAN)
    const first = String(row[0] ?? "").toLowerCase().trim();
    if (/\btotal\b/.test(first) || first.startsWith("total")) continue;  // summary row
    if (nonEmptyCount <= 2 && MONTHS.test(first)) continue;              // month/quarter label
    const hasPan = rowHasPan[r];
    // Deductee lines carry a PAN — except genuine 206AA "PAN unavailable" cases,
    // which we admit only when a header is locked (inside a data block) and a
    // cell explicitly flags the missing PAN. Everything else PAN-less is a
    // total/label/ledger row and stays dropped.
    let admit = hasPan;
    if (!admit && headers != null) { for (let i = 0; i < row.length; i++) { if (NO_PAN_RE.test(String(row[i] ?? ""))) { admit = true; break; } } }
    if (!admit) continue;
    const obj: Record<string, unknown> = {};
    if (headers) for (let i = 0; i < headers.length; i++) obj[headers[i]] = row[i] ?? null;
    else for (let i = 0; i < row.length; i++) obj[`Column${i + 1}`] = row[i] ?? null;
    if (sectionHint) obj["Section"] = sectionHint;
    rows.push(obj);
  }
  return rows;
}

/**
 * Parse a whole workbook (all sheets). Sheets named after a TDS section are read
 * first with that section attached; if none yield data (a file whose data lives
 * in a plainly-named sheet like "Sheet1"/"Data"), every sheet is read by content
 * as a fallback. `gridOf(sheetName)` returns that sheet's raw grid.
 */
export function extractWorkbookRows(
  sheetNames: string[],
  gridOf: (name: string) => unknown[][],
  onProgress?: (sheetIndex: number) => void,
): Record<string, unknown>[] {
  // READ EVERY SHEET. The section taken from a sheet's NAME is only a HINT for the
  // rows of THAT sheet (used when the sheet carries no section column) — it must
  // never decide WHICH sheets are read.
  //
  // This previously ran in two passes: collect rows from sheets whose NAME looks
  // like a TDS section, and if that found anything, RETURN ONLY THOSE — discarding
  // every other sheet in the workbook. So a client whose real data sits on sheets
  // named by quarter/month ("QUT-01 April 01 to June-30" …) alongside ONE small
  // incidental section-named tab ("194T") had their whole return silently reduced
  // to that one tab. Measured on a real file: 159 rows across 6 sheets came back as
  // 3, with no warning — the four quarterly sheets (24+34+28+70 rows) were dropped
  // wholesale. That is the "entries not captured" bug, and it is format-dependent,
  // which is why it kept resurfacing with each new client's workbook.
  const all: Record<string, unknown>[] = [];
  for (let i = 0; i < sheetNames.length; i++) {
    onProgress?.(i);
    const sec = sectionFromSheetName(sheetNames[i]);
    all.push(...extractSheetRows(gridOf(sheetNames[i]), sec));
  }
  return all;
}

/**
 * GROUND TRUTH for the never-lose-a-record safety net: every distinct PAN that
 * appears in ANY cell of the workbook.
 *
 * The import's existing shortfall warning compares rows MAPPED against rows
 * EXTRACTED — so it is structurally blind to a sheet that extracts nothing at all
 * (0 of 0 reads as 100%). A TDS deductee line always carries a PAN, so the PANs
 * physically present in the file are an independent measure of what SHOULD have
 * been read. Comparing against this catches whole-sheet loss, which no amount of
 * header heuristics can.
 */
const PAN_CELL_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;   // the WHOLE cell is a PAN
export function countPansInGrids(sheetNames: string[], gridOf: (name: string) => unknown[][]): number {
  const pans = new Set<string>();
  for (const name of sheetNames) {
    for (const row of gridOf(name) || []) {
      for (const cell of row || []) {
        const s = String(cell ?? "").trim().toUpperCase().replace(/\s+/g, "");
        if (PAN_CELL_RE.test(s)) pans.add(s);
      }
    }
  }
  return pans.size;
}
