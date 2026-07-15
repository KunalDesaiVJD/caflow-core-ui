// Stage-2 PAN Verification — pure, deterministic comparison logic (no AI, no I/O).
// Office parties (from tds_deductees for the selected quarter) are matched by PAN
// against a TRACES Bulk PAN Verification file; the PAN Status is keyword-classified.

export type PanValidationResult =
  | "PAN Verified"
  | "Name Mismatch"
  | "Party Missing in PAN Verification File"
  | "Party Missing in Office Data"
  | "PAN Status Error"
  | "PAN Status Blank"
  | "PAN Inactive"
  | "PAN Invalid";

export interface OfficeParty {
  deductee_id: string;
  pan: string | null;
  name: string | null;
}

export interface TracesPanRow {
  row_id: string;
  pan: string | null;
  name: string | null;
  verified_name: string | null;
  pan_status: string | null;
}

export interface PanResultRow {
  office_deductee_id: string | null;
  pan_row_id: string | null;
  party_name: string | null;
  pan: string | null;
  pan_status: string | null;
  validation_result: PanValidationResult;
}

/** Normalise a PAN for exact matching: uppercase, strip ALL whitespace + hidden
 * separators so "aaa pp 4792 m", "AAAPP4792M " and a zero-width-space copy all
 * compare equal (mirrors Stage-1 normPan robustness). */
export const normalizePan = (pan: string | null | undefined): string =>
  (pan ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

/** The canonical PAN shape: 5 letters + 4 digits + 1 letter. Used to detect a PAN
 * column (and validate a PAN cell) by VALUE — so a TRACES file whose PAN header is
 * unusual/absent still parses, exactly like Stage-1's looksLikePan. */
const PAN_SHAPE_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
export const looksLikePan = (v: unknown): boolean => PAN_SHAPE_RE.test(normalizePan(v == null ? "" : String(v)));

/**
 * Normalise a legal-entity name for INTELLIGENT (not exact) comparison: case,
 * punctuation and spacing insensitive, with the common CA-firm abbreviations
 * folded (PVT→PRIVATE, LTD→LIMITED, &→AND, CORPN→CORPORATION) — so "Abc Traders
 * Pvt. Ltd." and "ABC TRADERS PRIVATE LIMITED" normalise identically.
 */
export const normalizeName = (v: string | null | undefined): string => {
  let s = (v ?? "").toUpperCase();
  s = s.replace(/&/g, " AND ");
  s = s.replace(/[^A-Z0-9 ]/g, " ");
  s = ` ${s.replace(/\s+/g, " ").trim()} `;
  s = s.replace(/ PVT /g, " PRIVATE ").replace(/ LTD /g, " LIMITED ");
  s = s.replace(/ P LIMITED /g, " PRIVATE LIMITED ").replace(/ CORPN /g, " CORPORATION ").replace(/ CO /g, " COMPANY ");
  // Strip a LEADING honorific/article a working file routinely prefixes — mirrors
  // Stage-1 normName so "M/s ABC" and "ABC" don't read as a false Name Mismatch.
  // Leading-anchored so a legitimate mid-name "M S" or "THE" survives.
  s = s.replace(/^ (M S|MESSRS|MESSER?S|THE) /, " ");
  return s.replace(/\s+/g, " ").trim();
};

/**
 * Do two names refer to the same party? Intelligent, not exact:
 *  1. exact after normalisation; OR
 *  2. every significant token of the SHORTER name appears (exact / prefix /
 *     substring) in the LONGER name — tolerates fuller legal names, extra middle
 *     names and short forms (e.g. "Rakesh Rupavatiya" ≡ "Rakeshkumar Kanjibhai
 *     Rupavatiya"); OR
 *  3. business context: an INDIVIDUAL PAN (4th char 'P') is typically a
 *     proprietorship, whose recorded trade name legitimately differs from the
 *     proprietor's PAN name — so a residual difference there is not reliable
 *     evidence of a wrong PAN and is not flagged.
 * A blank on either side is not compared (returns true).
 */
export const namesMatch = (
  a: string | null | undefined,
  b: string | null | undefined,
  pan?: string | null,
): boolean => {
  const na = normalizeName(a), nb = normalizeName(b);
  if (!na || !nb) return true;              // nothing reliable to compare
  if (na === nb) return true;
  const ta = na.split(" ").filter(w => w.length >= 2);
  const tb = nb.split(" ").filter(w => w.length >= 2);
  if (!ta.length || !tb.length) return true;
  const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  let hit = 0;
  for (const s of short) {
    if (long.some(l => l === s || l.startsWith(s) || s.startsWith(l) || l.includes(s) || s.includes(l))) hit++;
  }
  if (hit / short.length >= 0.7) return true;
  const p = normalizePan(pan);
  if (p.length === 10 && p[3] === "P") return true; // individual/proprietor PAN
  return false;
};

/** Plain-English reason a party is not a clean "PAN Verified". */
export const panReason = (r: PanValidationResult): string => ({
  "PAN Verified": "PAN active and name matches the PAN records.",
  "Name Mismatch": "PAN is active, but the office name does not match the name on the PAN records.",
  "Party Missing in PAN Verification File": "This party's PAN was not found in the uploaded TRACES bulk-PAN file.",
  "Party Missing in Office Data": "This PAN is in the TRACES file but has no matching party in the office data for this quarter.",
  "PAN Status Error": "TRACES returned an unrecognised PAN status.",
  "PAN Status Blank": "TRACES returned no PAN status for this party.",
  "PAN Inactive": "PAN is inoperative (typically not linked to Aadhaar) — higher TDS may apply.",
  "PAN Invalid": "TRACES reports this PAN as invalid / not a valid PAN.",
}[r] ?? "Requires review.");

/** Recommended next action for an exception. */
export const panRecommendedAction = (r: PanValidationResult): string => ({
  "Name Mismatch": "Confirm the correct name against the PAN and update the office record if needed.",
  "Party Missing in PAN Verification File": "Re-run the TRACES bulk-PAN request including this PAN, then re-import.",
  "Party Missing in Office Data": "Check whether this deductee belongs to this quarter's office data.",
  "PAN Status Error": "Re-verify this PAN's status on TRACES.",
  "PAN Status Blank": "Re-verify this PAN's status on TRACES.",
  "PAN Inactive": "Ask the client to link PAN–Aadhaar; deduct at the higher rate until active.",
  "PAN Invalid": "Obtain the correct PAN from the client and update the record.",
}[r] ?? "");

/**
 * Classify a TRACES "PAN Status" for a party found in BOTH datasets.
 * Keyword-priority (not exact-match) so e.g. "Valid and Inoperative" → PAN
 * Inactive (it is technically valid but inoperative). Only the three explicitly
 * good statuses count as verified.
 */
export function classifyPanStatus(
  status: string | null | undefined,
): "PAN Verified" | "PAN Status Blank" | "PAN Invalid" | "PAN Inactive" | "PAN Status Error" {
  const s = (status ?? "").trim().toLowerCase();
  if (!s) return "PAN Status Blank";
  // Order matters: negative/qualified states are checked FIRST, so a decorated
  // status ("Valid but Inoperative", "PAN is Valid and Operative") is classified
  // by its strongest signal. "inactive" contains "active" and "inoperative"
  // contains "operative", so those must win before the positive checks below.
  //
  // INVALID / unusable — the real TRACES/ITD terminal states beyond "invalid":
  // Deactivated, Deleted, Fake, Struck off (company), Amalgamation/Amalgamated,
  // "Marked as Invalid", and "not present/found in ITD" (the PAN doesn't exist).
  if (/invalid|not\s*valid|deactivat|deleted|fake|struck|amalgamat|not\s*(present|found|exist)|non.?exist|not\s*in\s*itd/.test(s)) return "PAN Invalid";
  // INACTIVE / inoperative — incl. a valid PAN NOT LINKED to Aadhaar (TRACES marks
  // it operative-but-inoperative; higher TDS applies), so treat "not linked" here.
  if (/inoperative|inactive|not\s*linked|notlinked/.test(s)) return "PAN Inactive";
  // Keyword (not exact) match so "Valid and Operative", "PAN is Valid", etc. are
  // recognised as verified rather than "PAN Status Error". Only unambiguously
  // POSITIVE words — a speculative "existing" is deliberately NOT here (it could
  // slip a "PAN not existing" past the negative checks into Verified).
  if (/valid|operative|active/.test(s)) return "PAN Verified";
  return "PAN Status Error";
}

/** Anything that is not a clean "PAN Verified" is an exception needing review/override. */
export const isPanException = (r: PanValidationResult): boolean => r !== "PAN Verified";

// ── TRACES-file column recognition (header synonyms, mirrors Stage-1) ──────────
const nh = (s: unknown): string => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
const isStatusHeader = (h: string) => h.includes("status");
const isNameHeader = (h: string) =>
  h === "name" || h.includes("partyname") || h.includes("deducteename") || h === "party" ||
  h === "deductee" || h.includes("nameofdeductee") || h.includes("nameofperson") || h.includes("assessee");
const isVerifiedHeader = (h: string) =>
  h.includes("verified") || h.includes("nameasper") || h.includes("nameonpan") || h.includes("tracesname") ||
  h.includes("panholder") || h.includes("nameaspan") || h.includes("asperitd") || h.includes("asperpan") || h.includes("panname");

/**
 * Extract TRACES PAN rows from a set of sheet grids — GENERIC, mirroring the
 * Stage-1 import: the PAN column is found by VALUE (looksLikePan) so an unusual or
 * missing PAN header still parses; the status column is found by header OR by value
 * (a column of valid/operative/invalid…); and only rows whose PAN cell is a real
 * PAN are emitted (the header + any title/total rows are skipped automatically).
 * The grids come from tdsWorkbook.readSheetGrids, which uses the TRUE used range so
 * a bloated-!ref file can never freeze the tab. Pure + testable (no XLSX/I-O here).
 */
export function extractTracesRows(grids: { name: string; grid: unknown[][] }[]): Omit<TracesPanRow, "row_id">[] {
  let bestOut: Omit<TracesPanRow, "row_id">[] = [];
  for (const { grid } of grids) {
    if (!grid || !grid.length) continue;
    const ncol = grid.reduce((m, row) => Math.max(m, (row || []).length), 0);
    if (!ncol) continue;

    // 1) VALUE-BASED PAN column — the column whose non-empty values are most often
    //    PANs, regardless of the header wording (or a missing header).
    let panCol = -1, bestFrac = 0, firstPanRow = 0;
    for (let c = 0; c < ncol; c++) {
      let nonEmpty = 0, pans = 0, firstRow = -1;
      for (let r = 0; r < grid.length; r++) {
        const s = String(grid[r]?.[c] ?? "").trim();
        if (!s) continue;
        nonEmpty++;
        if (looksLikePan(s)) { pans++; if (firstRow < 0) firstRow = r; }
      }
      const frac = nonEmpty ? pans / nonEmpty : 0;
      if (pans >= 1 && frac > bestFrac) { bestFrac = frac; panCol = c; firstPanRow = Math.max(0, firstRow); }
    }
    if (panCol < 0 || bestFrac < 0.3) continue; // no PAN column on this sheet

    // 2) HEADER row — the best of: a row (in the first 25) carrying a PAN-ish AND a
    //    DIFFERENT-text status/name header, else the row just above the first PAN.
    //    The different-text check rejects a merged banner ("PAN Verification
    //    Status" spread across every column) being taken as the header.
    let hdrIdx = -1;
    const scan = Math.min(grid.length, 25);
    for (let r = 0; r < scan; r++) {
      const cells = (grid[r] || []).map(nh);
      const panIdx = cells.findIndex((h) => h.includes("pan"));
      if (panIdx < 0) continue;
      const otherIdx = cells.findIndex((h, i) => i !== panIdx && h !== cells[panIdx] && (isStatusHeader(h) || isNameHeader(h) || isVerifiedHeader(h)));
      if (otherIdx >= 0) { hdrIdx = r; break; }
    }
    // A real header sits ABOVE the data; a "header" row at/below the first PAN
    // value is spurious, so fall back to the row just above the first PAN.
    const useHdr = hdrIdx >= 0 && (firstPanRow === 0 ? false : hdrIdx < firstPanRow);
    const headerRow = (useHdr ? grid[hdrIdx] : (firstPanRow > 0 ? grid[firstPanRow - 1] : [])) || [];
    const header = headerRow.map(nh);
    const findCol = (pred: (h: string) => boolean) => header.findIndex(pred);
    const nameCol = findCol(isNameHeader);
    const verifiedCol = findCol(isVerifiedHeader);

    // 3) STATUS column — VALUE-BASED FIRST (the reliable signal, per Stage 1): the
    //    column whose values are mostly PAN-status words. The header-labelled column
    //    is only a fallback, so a mislabelled/serial column can't become the status.
    let statusCol = -1, bf = 0;
    for (let c = 0; c < ncol; c++) {
      if (c === panCol) continue;
      let ne = 0, hit = 0;
      for (let r = 0; r < grid.length; r++) {
        const s = String(grid[r]?.[c] ?? "").toLowerCase();
        if (!s.trim()) continue;
        ne++;
        if (/valid|operative|inactive|\bactive\b|inoperative|deactivat|struck|fake|amalgamat|not\s*(present|found|linked)/.test(s)) hit++;
      }
      const frac = ne ? hit / ne : 0;
      if (frac >= 0.4 && frac > bf) { bf = frac; statusCol = c; }
    }
    if (statusCol < 0) statusCol = findCol(isStatusHeader); // header fallback (coded/unusual status values)

    // 4) Emit only rows whose PAN cell is a real PAN (skips header + title/total rows).
    const cell = (row: unknown[], i: number) => (i >= 0 ? (String(row?.[i] ?? "").trim() || null) : null);
    const out: Omit<TracesPanRow, "row_id">[] = [];
    for (let r = 0; r < grid.length; r++) {
      const dr = grid[r] || [];
      if (!looksLikePan(dr[panCol])) continue;
      out.push({
        pan: normalizePan(dr[panCol]),
        name: cell(dr, nameCol),
        verified_name: cell(dr, verifiedCol),
        pan_status: cell(dr, statusCol),
      });
    }
    // Keep the sheet that yields the MOST PAN rows (a workbook may have a small
    // summary sheet + the real data sheet; pick the real one, not just the first).
    if (out.length > bestOut.length) bestOut = out;
  }
  return bestOut;
}

/**
 * Plain-English diagnostics for the WHOLE verification — the Stage-1 "explain WHY,
 * don't just count" learning. Surfaces systemic problems (office parties with no
 * PAN, a wrong-scope/other-client TRACES file, office PANs missing from the file,
 * a request-file imported instead of the result-file) so a low/zero verified count
 * is explained rather than left for the user to puzzle out.
 */
export function panDiagnostics(office: OfficeParty[], traces: TracesPanRow[]): string[] {
  const diag: string[] = [];
  const officePans = new Set(office.map((o) => normalizePan(o.pan)).filter(Boolean));
  const tracePans = new Set(traces.map((t) => normalizePan(t.pan)).filter(Boolean));
  const officeNoPan = office.filter((o) => !normalizePan(o.pan)).length;
  const overlap = [...tracePans].filter((p) => officePans.has(p)).length;
  const tracesOnly = [...tracePans].filter((p) => !officePans.has(p)).length;
  const officeOnly = [...officePans].filter((p) => !tracePans.has(p)).length;

  if (office.length > 0 && officeNoPan > 0)
    diag.push(`${officeNoPan} office part${officeNoPan === 1 ? "y has" : "ies have"} no PAN and cannot be verified — add the PAN in Data Entry.`);
  if (tracePans.size > 0 && officePans.size > 0 && overlap === 0)
    diag.push(`None of the ${tracePans.size} PANs in the TRACES file match this quarter's office parties — the file may be for a different client or quarter.`);
  else if (tracesOnly > 0 && officePans.size > 0 && tracesOnly >= officePans.size)
    diag.push(`${tracesOnly} PAN(s) in the TRACES file are not in this quarter's office data — check the file's scope (it may cover more than this quarter).`);
  if (officeOnly > 0)
    diag.push(`${officeOnly} office PAN(s) were not found in the TRACES file — re-run the TRACES bulk-PAN request including every PAN for this quarter, then re-import.`);
  const withStatus = traces.filter((t) => (t.pan_status ?? "").trim()).length;
  if (traces.length >= 3 && withStatus === 0)
    diag.push(`The TRACES file has no PAN Status values — check you imported the verification RESULT file (with a PAN Status column), not the request file.`);
  return diag;
}

/**
 * Stage-2 comparison. The records verified are the PANs in the TRACES bulk file —
 * each is classified by its PAN status (Verified / Invalid / Inactive / Blank /
 * Error), and when a matching office party exists, the office name is
 * cross-checked against the TRACES name (Name Mismatch). Office parties whose PAN
 * is NOT in the TRACES file are reported separately as "Party Missing in PAN
 * Verification File" (they were not verified). Result: Total = TRACES PAN count
 * (+ any unverified office parties), Verified = valid PANs — matching the intended
 * workflow (e.g. 72 PANs → 72 verified when all are active and names agree).
 */
export function comparePanVerification(office: OfficeParty[], traces: TracesPanRow[]): PanResultRow[] {
  const officeByPan = new Map<string, OfficeParty>();
  for (const o of office) { const k = normalizePan(o.pan); if (k && !officeByPan.has(k)) officeByPan.set(k, o); }

  const rows: PanResultRow[] = [];
  const seenTraces = new Set<string>();

  // 1. Every TRACES PAN → classify by status; name-check against the office party.
  for (const t of traces) {
    const k = normalizePan(t.pan);
    if (!k || seenTraces.has(k)) continue;
    seenTraces.add(k);
    const o = officeByPan.get(k);
    const status = classifyPanStatus(t.pan_status);
    // A PAN in the TRACES file with NO matching office party is not this quarter's
    // deductee — flag it (not silently "verified"), so a wrong-scope / wrong-client
    // file surfaces instead of inflating the verified count.
    const result: PanValidationResult = !o
      ? "Party Missing in Office Data"
      : status === "PAN Verified" && !namesMatch(o.name, t.verified_name || t.name, t.pan)
        ? "Name Mismatch"
        : status;
    rows.push({ office_deductee_id: o?.deductee_id ?? null, pan_row_id: t.row_id, party_name: o?.name || t.name, pan: t.pan ?? null, pan_status: t.pan_status ?? null, validation_result: result });
  }

  // 2. Office parties whose PAN is not in the TRACES file → not verified.
  const seenOffice = new Set<string>();
  for (const o of office) {
    const k = normalizePan(o.pan);
    const key = k || `d:${o.deductee_id}`;
    if (seenOffice.has(key)) continue;
    seenOffice.add(key);
    if (k && seenTraces.has(k)) continue; // already classified in the TRACES pass
    rows.push({ office_deductee_id: o.deductee_id, pan_row_id: null, party_name: o.name, pan: o.pan ?? null, pan_status: null, validation_result: "Party Missing in PAN Verification File" });
  }

  return rows;
}

/** Mandatory-override reason options (last is "Other" → free text). */
export const PAN_OVERRIDE_REASONS = [
  "PAN verified manually",
  "Client confirmation received",
  "Name variation accepted",
  "PAN status updated but TRACES report not refreshed",
  "Data entry difference accepted",
  "Other",
] as const;
