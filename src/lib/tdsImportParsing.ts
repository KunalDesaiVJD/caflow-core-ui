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

/**
 * Reserved sentinel a template's worked-example row can carry in ANY cell, so
 * a plain single-sheet template's example row is dropped unconditionally —
 * regardless of column layout, and even though it deliberately carries a
 * realistic PAN (so extractSheetRows's PAN-presence data-row test would
 * otherwise admit it). Mirrors TEMPLATE_EXAMPLE_CHALLAN_ID's role for the
 * two-sheet template: a client who leaves the gray example row in place must
 * never have it silently imported as a fabricated deductee. A string this
 * specific could never appear in a real client's data by accident.
 */
export const TEMPLATE_EXAMPLE_ROW_SENTINEL = "EXAMPLE ROW — DELETE BEFORE IMPORT";

function isTemplateExampleRow(row: unknown[]): boolean {
  for (const cell of row) {
    if (String(cell ?? "").trim() === TEMPLATE_EXAMPLE_ROW_SENTINEL) return true;
  }
  return false;
}

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
    if (isTemplateExampleRow(row)) continue; // the flat template's worked-example row — see TEMPLATE_EXAMPLE_ROW_SENTINEL
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
    // A sheet literally named "Instructions" (case/whitespace-insensitive,
    // exact match only — never fuzzy, so a real client sheet coincidentally
    // starting with "Instr…" is unaffected) is documentation, never TDS data.
    // Our own templates' Instructions tabs describe field formats using real
    // PAN-shaped example text (e.g. "AACCP6899F") to show the exact expected
    // shape — which is precisely what extractSheetRows's PAN-presence test
    // looks for, so without this skip, prose describing the format would be
    // misread as a genuine (fabricated) deductee row.
    if (sheetNames[i].trim().toLowerCase() === "instructions") continue;
    const sec = sectionFromSheetName(sheetNames[i]);
    const rows = extractSheetRows(gridOf(sheetNames[i]), sec);
    // Tag every row with the sheet it came from. De-duplication downstream needs
    // it to tell a GENUINE repeat from a cross-sheet ECHO: four identical bills to
    // one party on one day, all on the 194C sheet, are four real transactions,
    // while the same four appearing again on a consolidated "Sheet1" are the same
    // four. Without the sheet, content-dedup cannot distinguish them and silently
    // deletes real records. Not a data column — the mapper skips SHEET_KEY.
    for (const r of rows) r[SHEET_KEY] = sheetNames[i];
    all.push(...rows);
  }
  return all;
}

/** Marks the sheet a row came from. NOT a client column: the column engine skips
 *  it, and nothing maps it to a canonical field. */
export const SHEET_KEY = "__sheet";

// ── Official two-sheet TDS import template (Challan Details + TDS Entries) ─
// The new official template splits challan-level fields (BSR Code, Challan
// Serial No.) onto their OWN "Challan Details" sheet, separate from the
// per-deductee "TDS Entries" sheet, linked by a shared "Challan ID" column on
// both. Every OTHER field on "TDS Entries" already lands on a canonical field
// via tds-recon-import's existing HEADER_SYNONYMS (verified: e.g. "Date of
// Payment/Credit*" → "dateofpaymentcredit" is already an exact-match synonym
// for date_of_payment). The only gap is BSR Code / Challan No, which this join
// resolves BEFORE the rows ever reach that pipeline, by reusing gridToRows /
// detectHeaderRow on each sheet (both are a single clean table — the
// multi-block/PAN-scanning extractSheetRows machinery above is not needed
// here) and stitching the two sheets' rows together in memory.

/** Finds the actual object key in `row` whose header text — normalised the
 * same way normaliseCell already normalises values elsewhere in this file
 * (lowercase, strip everything but letters/digits) — matches one of
 * `targets`. Tolerates a trailing "*" (required-field marker), punctuation
 * (e.g. "Challan Serial No." vs "Challan Serial No"), and case/whitespace —
 * so this never depends on an exact literal header string. */
function findHeaderKey(row: Record<string, unknown> | undefined, targets: string[]): string | null {
  if (!row) return null;
  for (const key of Object.keys(row)) {
    if (targets.includes(normaliseCell(key))) return key;
  }
  return null;
}

/** Normalises a challan-linking VALUE (Challan ID or Challan Serial No.) for
 * tolerant matching across rows/sheets: trim + uppercase only. Unlike
 * header-name normalisation above, punctuation is DELIBERATELY kept — an ID
 * like "CH-Q1-001" carries meaningful structure, not noise, so two
 * differently punctuated values must NOT be folded into the same key. */
const normaliseChallanId = (v: unknown): string => String(v ?? "").trim().toUpperCase();

/**
 * The official template's worked-example row ships pre-filled with
 * realistic-looking data — a real deductee name, PAN, and amount — so a
 * client can see the expected format at a glance. The in-sheet note tells
 * them to delete or overwrite it before submitting, but nothing stops them
 * leaving it in place, and if they do, that row is indistinguishable from
 * real data by content alone (it's DESIGNED to look real). Left unhandled,
 * it would be silently imported as a fabricated deductee record into the
 * client's actual TDS data — worse than a false mismatch, since nothing
 * downstream would ever flag it as wrong. The template gives this row's
 * challan-linking field (Challan ID on the two-sheet template; Challan
 * Serial No. on the single-sheet template, which has no separate Challan
 * ID — see joinChallanTemplate) this exact reserved value everywhere it's
 * used (never a value a client would type), so it can be dropped
 * unconditionally regardless of whether the client remembered to delete it.
 */
export const TEMPLATE_EXAMPLE_CHALLAN_ID = "EXAMPLE-DO-NOT-IMPORT";

/** Drops rows whose challan-linking field is the template's reserved example-row sentinel. */
function dropExampleRow(rows: Record<string, unknown>[], idKey: string | null): Record<string, unknown>[] {
  if (!idKey) return rows;
  return rows.filter((row) => normaliseChallanId(row[idKey]) !== TEMPLATE_EXAMPLE_CHALLAN_ID);
}

/**
 * Detects the official two-sheet TDS import template by its EXACT tab names
 * — "Challan Details" and "TDS Entries" (case- and whitespace-insensitive,
 * but NOT fuzzy) — so this only activates for that specific template and
 * never misfires on an unrelated client workbook that happens to have
 * multiple sheets (e.g. one sheet per TDS section, already handled by
 * extractWorkbookRows above).
 */
export function isTwoSheetTemplate(sheetNames: string[]): { challanSheet: string; entriesSheet: string } | null {
  const norm = (s: string): string => s.trim().toLowerCase().replace(/\s+/g, " ");
  let challanSheet: string | null = null;
  let entriesSheet: string | null = null;
  for (const name of sheetNames) {
    const n = norm(name);
    if (n === "challan details") challanSheet = name;
    else if (n === "tds entries") entriesSheet = name;
  }
  return challanSheet && entriesSheet ? { challanSheet, entriesSheet } : null;
}

/**
 * Joins already-parsed Challan rows and Entry rows (each produced by
 * gridToRows) into ONE row set the existing single-sheet import pipeline can
 * consume: every entry row gets the BSR Code / Challan No. of the challan it
 * links to, added under the EXACT literal keys "BSR Code" and "Challan No" —
 * the same strings tds-recon-import's HEADER_SYNONYMS already recognises by
 * exact match ("bsrcode" → challan_bsr, "challanno" → challan_no; verified
 * directly against that file), so no edge-function change is needed.
 *
 * The linking field is resolved by trying "Challan ID" FIRST (the two-sheet
 * template's own invented key, kept for backward compatibility with copies
 * of that template already in the wild), then falling back to "Challan
 * Serial No." — the field that actually identifies a challan in the
 * software itself (see the Edit Challan dialog in TdsDataEntry.tsx: BSR Code
 * + Challan Number, no separate ID). The single-sheet "TDS Data" template
 * has no Challan ID column at all, so it always resolves to Challan Serial
 * No., which then serves as BOTH the lookup key AND the "Challan No" value
 * injected onto matched entries — deliberately the same field, since that
 * value genuinely IS the challan's identity there.
 *
 * An entry whose linking value doesn't match any known challan (typo,
 * deleted challan, blank) is returned UNCHANGED — no "BSR Code"/"Challan No"
 * keys are added — so it never looks like a confident-but-wrong
 * deterministic mapping; the existing pipeline already tolerates a row with
 * no challan_bsr/challan_no.
 */
export function joinChallanTemplate(
  challanRows: Record<string, unknown>[],
  entryRows: Record<string, unknown>[],
): Record<string, unknown>[] {
  const LINK_TARGETS = ["challanid", "challanserialno", "challanno", "challannumber"];
  const idKey = findHeaderKey(challanRows[0], LINK_TARGETS);
  const entryIdKey = findHeaderKey(entryRows[0], LINK_TARGETS);

  // Strip the worked-example row FIRST, on both sheets, regardless of whether
  // the client deleted it as instructed — see TEMPLATE_EXAMPLE_CHALLAN_ID.
  const cleanChallanRows = dropExampleRow(challanRows, idKey);
  const cleanEntryRows = dropExampleRow(entryRows, entryIdKey);

  if (!idKey) return cleanEntryRows; // no challan-linking column at all — nothing to join

  const bsrKey = findHeaderKey(cleanChallanRows[0], ["bsrcode", "bsr"]);
  const noKey = findHeaderKey(cleanChallanRows[0], ["challanserialno", "challanno", "challannumber"]) ?? idKey;

  const byId = new Map<string, { bsr: unknown; no: unknown }>();
  for (const row of cleanChallanRows) {
    const id = normaliseChallanId(row[idKey]);
    if (!id) continue; // blank linking value (e.g. the template's own placeholder row) — never a lookup target
    byId.set(id, { bsr: bsrKey ? row[bsrKey] : null, no: row[noKey] });
  }

  if (!entryIdKey) return cleanEntryRows; // entries have no challan-linking column — nothing to join

  return cleanEntryRows.map((row) => {
    const match = byId.get(normaliseChallanId(row[entryIdKey]));
    if (!match) return row;
    return { ...row, "BSR Code": match.bsr, "Challan No": match.no };
  });
}

// ── Official single-sheet, challan-grouped TDS import template ─────────────
// A third template shape: ONE sheet ("TDS Data"), every row tagged "Challan"
// or "Entry" via a Row Type column. A Challan row carries its full details
// (BSR Code, Challan Serial No., Date of Deposit, Total Amount, Bank Name)
// once; its entries are listed directly beneath it, each also carrying the
// same Challan ID for the link. Simpler for a client to fill than the
// two-sheet template (nothing to switch tabs for) while showing the complete
// challan picture the flat one-row-per-entry template (repeated BSR/No only)
// was criticised for lacking.

/**
 * Detects the single-sheet, challan-grouped template by its EXACT tab name
 * ("TDS Data", case/whitespace-insensitive, never fuzzy) — same convention
 * as isTwoSheetTemplate, so it can't misfire on an unrelated client workbook.
 */
export function isChallanBlockTemplate(sheetNames: string[]): string | null {
  const norm = (s: string): string => s.trim().toLowerCase().replace(/\s+/g, " ");
  for (const name of sheetNames) {
    if (norm(name) === "tds data") return name;
  }
  return null;
}

/**
 * Splits the challan-grouped sheet's rows by their "Row Type" (Challan /
 * Entry) and hands them to joinChallanTemplate — the SAME, already-tested
 * join used by the two-sheet template. Row Type is the only new signal this
 * layout needs; Challan ID linking, example-row exclusion, and unmatched
 * pass-through all come from joinChallanTemplate unchanged, so this shape
 * inherits those guarantees for free rather than re-implementing them.
 * Not this layout after all (no Row Type column) → rows pass through as-is.
 */
export function explodeChallanBlockTemplate(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  const rowTypeKey = findHeaderKey(rows[0], ["rowtype"]);
  if (!rowTypeKey) return rows;
  const type = (row: Record<string, unknown>): string => String(row[rowTypeKey] ?? "").trim().toUpperCase();
  const challanRows = rows.filter((r) => type(r) === "CHALLAN");
  const entryRows = rows.filter((r) => type(r) === "ENTRY");
  return joinChallanTemplate(challanRows, entryRows);
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

// ── Firm's quarterly 24Q/26Q workbook (Challan Master + "24Q Q1" … "26Q Q4") ─
// The firm's own TDS data-entry workbook keeps ONE sheet per form per quarter
// ("24Q Q1" … "24Q Q4", "26Q Q1" … "26Q Q4") next to a "Challan Master". Read
// generically it fails Stage 1 in several ways at once: every quarter and both
// forms land in one import (the compare's PAN rescue then keeps another
// quarter's rows for the same employee), 24Q rows carry no section, salary has
// four money columns (Salary / Bonus / Other / TOTAL), "RECOMMENDED TDS" sits
// beside "TDS Deducted", the challan is one "serial | BSR x | date" string, the
// sheets carry ~40 helper columns (dep, due, effd, …) that look like dates and
// amounts, rows deleted in a revision stay on the sheet (act = 0), and the
// "Salary Working" sheet repeats every employee's PAN as an annual summary.
// So this layout is read by its own, exact column names into clean rows.

const FORM_SHEET_RE = /^(24Q|26Q|27Q|27EQ)\s*Q([1-4])$/i;

/** The workbook's per-form-per-quarter sheets, when it is this layout
 * (exact tab names plus a "Challan Master" tab — never a fuzzy match). */
export function quarterlyFormSheets(sheetNames: string[]): { name: string; form: string; quarter: string }[] | null {
  const hasChallanMaster = sheetNames.some((n) => n.trim().toLowerCase().replace(/\s+/g, " ") === "challan master");
  if (!hasChallanMaster) return null;
  const out: { name: string; form: string; quarter: string }[] = [];
  for (const name of sheetNames) {
    const m = name.trim().replace(/\s+/g, " ").match(FORM_SHEET_RE);
    if (m) out.push({ name, form: m[1].toUpperCase(), quarter: `Q${m[2]}` });
  }
  return out.length ? out : null;
}

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** A cell date as an unambiguous "30-Apr-2026". SheetJS hands back either local
 * or UTC midnight depending on version; +12h lands on the right calendar day
 * in both cases for any Indian/US time zone. */
function fmtDate(v: unknown): string | null {
  if (v instanceof Date && !isNaN(v.getTime())) {
    const d = new Date(v.getTime() + 12 * 3600 * 1000);
    return `${String(d.getDate()).padStart(2, "0")}-${MON[d.getMonth()]}-${d.getFullYear()}`;
  }
  const s = String(v ?? "").trim();
  return s || null;
}
const num = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  if (typeof v === "number") return v;
  const s = String(v).replace(/[,₹\s]/g, "");
  if (s === "-") return 0;
  const n = Number(s);
  return isFinite(n) ? n : null;
};
const text = (v: unknown): string => (v == null ? "" : String(v).trim());

/** "14904 | BSR 0510002 | 21-05-2026" → serial + BSR. */
function splitChallanRef(v: unknown): { no: string | null; bsr: string | null } {
  const parts = text(v).split("|").map((p) => p.trim());
  const no = parts[0] || null;
  const bsrPart = parts.find((p) => /^bsr\b/i.test(p));
  const bsr = bsrPart ? bsrPart.replace(/^bsr\s*/i, "").trim() || null : null;
  return { no, bsr };
}

/** Salary section from the 24Q helper text ("1002 – Salary: Non-Govt employees"). */
function salarySection(sc: unknown): string {
  const s = text(sc).toLowerCase();
  if (/non[\s-]*gov/.test(s)) return "192B";
  if (/gov/.test(s)) return "192A";
  return "192B";
}

/** One form-quarter sheet (raw cell values) → clean deductee rows. */
function extractFormSheet(grid: unknown[][], form: string): Record<string, unknown>[] {
  // Header = the first row naming both a Challan and a PAN column.
  let h = -1;
  for (let r = 0; r < Math.min(grid.length, 20) && h < 0; r++) {
    const cells = (grid[r] || []).map(normaliseCell);
    if (cells.some((c) => c.startsWith("challan")) && cells.some((c) => c.startsWith("pan"))) h = r;
  }
  if (h < 0) return [];
  const head = (grid[h] || []).map(normaliseCell);
  const col = (test: (c: string) => boolean): number => head.findIndex(test);
  const c = {
    challan: col((x) => x.startsWith("challan")),
    name: col((x) => x.startsWith("employeename") || x.startsWith("deducteename") || x === "name"),
    pan: col((x) => x.startsWith("pan")),
    section: col((x) => x.startsWith("section")),
    date: col((x) => x.startsWith("dateofpayment")),
    amount: form === "24Q" ? col((x) => x.startsWith("totalsalary")) : col((x) => x.startsWith("amount")),
    tds: col((x) => x.startsWith("tdsdeducted")),
    dedDate: col((x) => x.startsWith("dateofdeduction")),
    interest: col((x) => x.startsWith("interest")),
    act: col((x) => x === "act"),
    sc: col((x) => x === "sc"),
  };
  if (c.name < 0 || c.amount < 0 || c.tds < 0) return [];
  const rows: Record<string, unknown>[] = [];
  for (let r = h + 1; r < grid.length; r++) {
    const row = grid[r] || [];
    const name = text(row[c.name]);
    if (!name) continue;
    // act = 1 marks a live entry; 0 is a blank slot or a row deleted in a revision.
    if (c.act >= 0 && num(row[c.act]) !== 1) continue;
    const pan = c.pan >= 0 ? text(row[c.pan]).toUpperCase() : "";
    const { no, bsr } = c.challan >= 0 ? splitChallanRef(row[c.challan]) : { no: null, bsr: null };
    const paid = c.date >= 0 ? fmtDate(row[c.date]) : null;
    const deducted = c.dedDate >= 0 ? fmtDate(row[c.dedDate]) : null;
    rows.push({
      "Deductee Name": name,
      "PAN": pan || null,
      "Section": form === "24Q" ? salarySection(c.sc >= 0 ? row[c.sc] : null) : (c.section >= 0 ? text(row[c.section]) || null : null),
      "Date of Payment": paid,
      // "Date of Deduction (if later)" — blank means deducted on payment.
      "Date of Deduction": deducted || paid,
      "Amount Paid": num(row[c.amount]),
      "TDS Deducted": num(row[c.tds]),
      "Interest": c.interest >= 0 ? num(row[c.interest]) : null,
      "BSR Code": bsr,
      "Challan No": no,
    });
  }
  return rows;
}

/**
 * Rows from the quarterly workbook, limited to the filing being validated
 * (`scope.form` / `scope.quarter`, e.g. "24Q" / "Q1") so a 24Q Q1 import never
 * carries Q2's salary or the 26Q sheets. With no scope (or a form the workbook
 * has no sheet for) every form-quarter sheet is read.
 * `rawGridOf` must return RAW cell values (numbers, Dates), not display text.
 */
export function extractQuarterlyFormRows(
  sheets: { name: string; form: string; quarter: string }[],
  rawGridOf: (name: string) => unknown[][],
  scope?: { form?: string | null; quarter?: string | null },
): Record<string, unknown>[] {
  const form = scope?.form?.toUpperCase().match(/24Q|26Q|27Q|27EQ/)?.[0];
  const q = scope?.quarter?.match(/[1-4]/)?.[0];
  let pick = sheets;
  if (form && sheets.some((s) => s.form === form)) {
    pick = sheets.filter((s) => s.form === form && (!q || s.quarter === `Q${q}`));
  }
  const all: Record<string, unknown>[] = [];
  for (const s of pick) {
    for (const r of extractFormSheet(rawGridOf(s.name), s.form)) {
      r[SHEET_KEY] = s.name;
      all.push(r);
    }
  }
  return all;
}
