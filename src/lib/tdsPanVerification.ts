// Stage-2 PAN Verification — pure, deterministic audit logic (no AI, no I/O).
//
// OFFICE DATA IS THE MASTER. The audit iterates the office parties for a quarter
// and, for each, finds its PAN in the imported TRACES Bulk-PAN file and runs a
// COMPLETE PAN audit using every column the TRACES report provides — PAN Status,
// Verified Name and "Mismatch in Name". A TRACES PAN that has NO office party is
// IGNORED (office is the master; we only validate parties in the software).
//
// Name comparison INHERITS Stage-1's intelligence (order-independent token-set
// matching with subset + Jaccard) so "Jayant Kantilal Jagani" == "Jayant Jagani
// Kantilal" — reimplemented here (Stage-1's lives in an edge function) so Stage-1
// is never touched.

export type PanValidationResult =
  | "PAN Verified"                       // ✅ found + active/valid + name matched
  | "PAN Not Found in TRACES"            // office PAN not in the imported file
  | "Invalid PAN Format"                 // the office PAN isn't a valid 10-char PAN
  | "PAN Missing in Office Data"         // the office party has no PAN to verify
  | "Invalid PAN"                        // TRACES reports the PAN invalid/deleted/fake…
  | "PAN Inoperative"                    // TRACES reports the PAN inoperative/inactive
  | "PAN Status Blank"                   // TRACES returned no status (not processed)
  | "PAN Status Error"                   // TRACES returned an unrecognised status
  | "Name Mismatch"                      // names differ (but share something)
  | "Different Party Name";              // same PAN, an entirely different name

export interface OfficeParty {
  deductee_id: string;
  pan: string | null;
  name: string | null;
}

export interface TracesPanRow {
  row_id: string;
  pan: string | null;
  name: string | null;            // name as submitted (usually the office name)
  verified_name: string | null;   // the ITD/TRACES official name for the PAN
  pan_status: string | null;
  mismatch_in_name: string | null; // TRACES's own Yes/No/Unknown name-mismatch flag
}

export interface PanCheckDetail {
  pan_found: boolean;
  status_class: string;   // classifyPanStatus bucket
  name_matched: boolean;
  name_kind: "matched" | "mismatch" | "different" | "unknown";
}

export interface PanResultRow {
  office_deductee_id: string | null;
  pan_row_id: string | null;
  office_name: string | null;      // master (office) party name
  verified_name: string | null;    // TRACES verified name (for display)
  pan: string | null;
  pan_status: string | null;
  validation_result: PanValidationResult;
  detail: PanCheckDetail;
}

// ── PAN normalisation + shape ────────────────────────────────────────────────
/** Uppercase + strip ALL non-alphanumerics so "aaa pp 4792 m" / trailing spaces /
 * a zero-width copy all compare equal. */
export const normalizePan = (pan: string | null | undefined): string =>
  (pan ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

const PAN_SHAPE_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
export const looksLikePan = (v: unknown): boolean => PAN_SHAPE_RE.test(normalizePan(v == null ? "" : String(v)));

// ── Entity-name normalisation + intelligent comparison (Stage-1 parity) ───────
/** Legal-entity name normaliser: case/punctuation/spacing-insensitive, common
 * abbreviations folded, leading honorific stripped — identical to Stage-1 normName. */
export const normalizeName = (v: string | null | undefined): string => {
  let s = (v ?? "").toUpperCase();
  s = s.replace(/&/g, " AND ");
  s = s.replace(/[^A-Z0-9 ]/g, " ");
  s = ` ${s.replace(/\s+/g, " ").trim()} `;
  // Glue "Co-operative" / "Co op" (hyphen already stripped above) BEFORE the
  // standalone CO→COMPANY fold, so a co-operative bank/society is not mangled to
  // "COMPANY OPERATIVE" and falsely reported as a Name Mismatch.
  s = s.replace(/ CO OPERATIVE /g, " COOPERATIVE ").replace(/ CO OP /g, " COOPERATIVE ");
  s = s.replace(/ PVT /g, " PRIVATE ").replace(/ LTD /g, " LIMITED ");
  s = s.replace(/ P LIMITED /g, " PRIVATE LIMITED ").replace(/ CORPN /g, " CORPORATION ").replace(/ CO /g, " COMPANY ");
  s = s.replace(/^ (M S|MESSRS|MESSER?S|THE) /, " ");
  return s.replace(/\s+/g, " ").trim();
};

/** Intelligent name comparison — ORDER-INDEPENDENT (token sets), tolerant of
 * spacing/case/punctuation/abbreviations, extra middle names and reordered
 * first/middle/surnames. Returns how the two names relate:
 *  - "match"     exact after normalisation, one token-set ⊆ the other, or Jaccard ≥ 0.6
 *  - "different" NO significant token in common → almost certainly a different party
 *  - "mismatch"  some overlap but not enough to be confident it's the same party
 *  - "unknown"   a side is blank / has no significant tokens (can't compare)
 * NOTE: unlike Stage-1's namesEquivalent this has NO "PAN matched ⇒ same party"
 * bypass — in Stage-2 the PAN always matches (we found the row by PAN), and the
 * whole point is to still catch a "same PAN, different party name". */
// Compound suffixes an Indian given name legitimately picks up ("Rakesh" →
// "Rakeshkumar", "Jagdish" → "Jagdishbhai"). Prefix matching is allowed ONLY for
// these, so "Ram" is NOT collapsed into "Ramesh" (which would be a false match).
const NAME_COMPOUND_SUFFIXES = new Set(["KUMAR", "BHAI", "BHAII", "BEN", "BHEN", "KUMARI", "LAL", "DAS", "CHANDRA", "PRASAD", "DEVI", "RAJ", "NATH", "SINH", "BABU", "RAO"]);
// Generic legal / honorific words that carry NO distinguishing power — removed
// before comparison so "SHREE ABC PVT LTD" and "SHREE XYZ PVT LTD" do NOT match
// on the common words alone (the distinctive ABC vs XYZ must decide).
const NAME_STOPWORDS = new Set(["PRIVATE", "LIMITED", "COMPANY", "CORPORATION", "LLP", "LLC", "INC", "AND", "THE", "MESSRS", "SHREE", "SHRI", "SRI", "SHREEJI"]);

/** Two normalised name TOKENS are compatible when equal, or one is the other plus
 * a known Indian compound suffix ("Rakesh" ≈ "Rakeshkumar"). A single-letter
 * INITIAL is deliberately NOT matched here — "A" would match Arun/Anil/Ajay/… and
 * with a common surname ("A Kumar") could silently verify a wrong PAN. */
function tokensCompatible(x: string, y: string): boolean {
  if (x === y) return true;
  const [s, l] = x.length <= y.length ? [x, y] : [y, x];
  if (s.length >= 3 && l.startsWith(s) && NAME_COMPOUND_SUFFIXES.has(l.slice(s.length))) return true;
  return false;
}
export function nameCompare(a: string | null | undefined, b: string | null | undefined): "match" | "different" | "mismatch" | "unknown" {
  const na = normalizeName(a), nb = normalizeName(b);
  if (!na || !nb) return "unknown";
  if (na === nb) return "match";
  // Drop single-character tokens (bare initials) — too weak to distinguish parties.
  const allA = na.split(" ").filter((w) => w.length >= 2);
  const allB = nb.split(" ").filter((w) => w.length >= 2);
  if (!allA.length || !allB.length) return "unknown";
  // Compare the DISTINCTIVE tokens (drop generic legal/honorific words); fall back
  // to all tokens only if a side has no distinctive token left.
  let ta = allA.filter((w) => !NAME_STOPWORDS.has(w));
  let tb = allB.filter((w) => !NAME_STOPWORDS.has(w));
  if (!ta.length || !tb.length) { ta = allA; tb = allB; }
  const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  const used = new Set<number>();
  let hits = 0;
  for (const s of short) {
    const idx = long.findIndex((l, i) => !used.has(i) && tokensCompatible(s, l));
    if (idx >= 0) { hits++; used.add(idx); }
  }
  // A MULTI-TOKEN subset (≥2 distinctive tokens, all matched) is a confident match
  // (reorder / extra middle names). A SINGLE-token subset is NOT — a lone common
  // surname ("Kumar") must not verify against any "… Kumar"; it falls to Jaccard,
  // which passes only when the other side has no extra distinctive token.
  if (short.length >= 2 && hits === short.length) return "match";
  const union = short.length + long.length - hits;
  if (hits / union >= 0.6) return "match";          // strong overlap of distinctive tokens
  if (hits === 0) return "different";               // no distinctive token in common ⇒ different party
  return "mismatch";                                // partial overlap
}

/** TRACES "Mismatch in Name" flag → yes | no | unknown. */
export function normMismatchFlag(v: string | null | undefined): "yes" | "no" | "unknown" {
  const s = String(v ?? "").trim().toLowerCase();
  if (s === "no" || s === "n" || s === "false" || s === "match" || s === "matched") return "no";
  if (s === "yes" || s === "y" || s === "true" || s === "mismatch") return "yes";
  return "unknown";
}

/** Combine our intelligent comparison with TRACES's own Mismatch-in-Name flag.
 * Minimises FALSE mismatches: a name is treated as matched if EITHER our
 * comparison passes OR TRACES explicitly says the names match ("No"). Only a
 * confident negative is reported. */
export function resolveNameCheck(
  officeName: string | null | undefined,
  verifiedName: string | null | undefined,
  mismatchFlag: string | null | undefined,
): { matched: boolean; kind: "matched" | "mismatch" | "different" | "unknown" } {
  const cmp = nameCompare(officeName, verifiedName);
  const flag = normMismatchFlag(mismatchFlag);
  if (cmp === "match") return { matched: true, kind: "matched" };
  // A COMPLETELY different name (no distinctive token in common) is authoritative
  // and is NEVER rescued by the TRACES flag — the flag compares the SUBMITTED name
  // to ITD, which may not be the office name, so it can't clear a "different party".
  if (cmp === "different") return { matched: false, kind: "different" };
  // A PARTIAL mismatch (minor variation) may be rescued when TRACES itself says the
  // name matches ("No") — this is where we minimise false mismatches.
  if (cmp === "mismatch") return flag === "no" ? { matched: true, kind: "matched" } : { matched: false, kind: "mismatch" };
  // cmp === "unknown" (no verified name to compare against) → rely on the flag.
  if (flag === "no") return { matched: true, kind: "matched" };
  if (flag === "yes") return { matched: false, kind: "mismatch" };
  return { matched: true, kind: "unknown" };                          // nothing to compare → don't false-flag
}

/**
 * Classify a TRACES "PAN Status" string. Keyword-priority (negative states
 * first, since "inactive" contains "active" and "inoperative" contains
 * "operative"). Covers the real ITD/TRACES terminal states.
 */
export function classifyPanStatus(
  status: string | null | undefined,
): "PAN Verified" | "PAN Status Blank" | "PAN Invalid" | "PAN Inactive" | "PAN Status Error" {
  const s = (status ?? "").trim().toLowerCase();
  if (!s) return "PAN Status Blank";
  if (/invalid|not\s*valid|deactivat|deleted|fake|struck|amalgamat|not\s*(present|found|exist)|non.?exist|not\s*in\s*itd/.test(s)) return "PAN Invalid";
  if (/inoperative|inactive|not\s*linked|notlinked/.test(s)) return "PAN Inactive";
  if (/valid|operative|active/.test(s)) return "PAN Verified";
  return "PAN Status Error";
}

/** Anything that is not a clean "PAN Verified" is an exception needing review/override. */
export const isPanException = (r: PanValidationResult): boolean => r !== "PAN Verified";

/** Plain-English reason for each result. */
export const panReason = (r: PanValidationResult): string => ({
  "PAN Verified": "PAN found in TRACES, status is active/valid, and the name matches the PAN records.",
  "PAN Not Found in TRACES": "This party's PAN was not found in the imported TRACES bulk-PAN file.",
  "Invalid PAN Format": "The PAN entered in Office Data is not a valid 10-character PAN (AAAAA9999A).",
  "PAN Missing in Office Data": "This office party has no PAN entered, so it cannot be verified.",
  "Invalid PAN": "TRACES reports this PAN as invalid / deleted / not a valid PAN.",
  "PAN Inoperative": "PAN is inoperative (typically not linked to Aadhaar) — higher TDS may apply.",
  "PAN Status Blank": "TRACES returned no PAN status for this party — verification was not processed.",
  "PAN Status Error": "TRACES returned an unrecognised PAN status.",
  "Name Mismatch": "PAN is active, but the office name does not match the name on the PAN records.",
  "Different Party Name": "The PAN is active but registered to an entirely different name than the office party.",
}[r] ?? "Requires review.");

/** Recommended next action for an exception. */
export const panRecommendedAction = (r: PanValidationResult): string => ({
  "PAN Not Found in TRACES": "Verify this PAN was included in the TRACES bulk-PAN report, or regenerate the TRACES file including it, then re-import.",
  "Invalid PAN Format": "Correct the PAN in Data Entry (it must be 5 letters + 4 digits + 1 letter).",
  "PAN Missing in Office Data": "Enter this party's PAN in Data Entry, then re-run the TRACES request.",
  "Invalid PAN": "Obtain the correct PAN from the client and update the record.",
  "PAN Inoperative": "Ask the client to link PAN–Aadhaar; deduct at the higher rate until it is active.",
  "PAN Status Blank": "Re-verify this PAN's status on TRACES (it may not have been processed).",
  "PAN Status Error": "Re-verify this PAN's status on TRACES.",
  "Name Mismatch": "Confirm the correct name against the PAN and update the office record if needed.",
  "Different Party Name": "Confirm the PAN belongs to this party. For a proprietorship the PAN name may be the proprietor's personal name — override with a reason if correct.",
}[r] ?? "");

// ── TRACES-file column recognition (mirrors Stage-1 value-based detection) ─────
const nh = (s: unknown): string => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
const isStatusHeader = (h: string) => h.includes("status");
const isMismatchHeader = (h: string) => h.includes("mismatch");
// A NAME column must NOT be the "Mismatch in Name" column.
const isNameHeader = (h: string) =>
  !h.includes("mismatch") && (h.includes("name") || h === "party" || h === "deductee" || h.includes("assessee"));
const isVerifiedHeader = (h: string) =>
  !h.includes("mismatch") && (
    h.includes("verified") || h.includes("nameasper") || h.includes("nameonpan") || h.includes("tracesname") ||
    h.includes("panholder") || h.includes("nameaspan") || h.includes("asperitd") || h.includes("asperpan") ||
    h.includes("panname") || h.includes("availablein") || h.includes("itddatabase"));

/**
 * Extract TRACES PAN rows from sheet grids — GENERIC (value-based PAN + status
 * detection; only real-PAN rows emitted; header/title/total rows auto-skipped;
 * the sheet with the most PAN rows wins). Grids come from tdsWorkbook.readSheetGrids
 * (TRUE used range → a bloated-!ref file can never freeze the tab). Pure + testable.
 */
export function extractTracesRows(grids: { name: string; grid: unknown[][] }[]): Omit<TracesPanRow, "row_id">[] {
  let bestOut: Omit<TracesPanRow, "row_id">[] = [];
  for (const { grid } of grids) {
    if (!grid || !grid.length) continue;
    const ncol = grid.reduce((m, row) => Math.max(m, (row || []).length), 0);
    if (!ncol) continue;

    // 1) VALUE-BASED PAN column.
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
    if (panCol < 0 || bestFrac < 0.3) continue;

    // 2) HEADER row — a row (in the first 25) with a PAN-ish header AND a
    //    different-text status/name header (rejects a merged banner title row).
    let hdrIdx = -1;
    const scan = Math.min(grid.length, 25);
    for (let r = 0; r < scan; r++) {
      const cells = (grid[r] || []).map(nh);
      const panIdx = cells.findIndex((h) => h.includes("pan"));
      if (panIdx < 0) continue;
      const otherIdx = cells.findIndex((h, i) => i !== panIdx && h !== cells[panIdx] && (isStatusHeader(h) || isNameHeader(h) || isVerifiedHeader(h)));
      if (otherIdx >= 0) { hdrIdx = r; break; }
    }
    const useHdr = hdrIdx >= 0 && (firstPanRow === 0 ? false : hdrIdx < firstPanRow);
    const headerRow = (useHdr ? grid[hdrIdx] : (firstPanRow > 0 ? grid[firstPanRow - 1] : [])) || [];
    const header = headerRow.map(nh);
    const findCol = (pred: (h: string) => boolean) => header.findIndex(pred);
    const nameCol = findCol(isNameHeader);
    const verifiedCol = findCol(isVerifiedHeader);
    const mismatchCol = findCol(isMismatchHeader);

    // 3) STATUS column — value-based FIRST (reliable), header only a fallback.
    let statusCol = -1, bf = 0;
    for (let c = 0; c < ncol; c++) {
      if (c === panCol) continue;
      let ne = 0, hit = 0;
      for (let r = 0; r < grid.length; r++) {
        const s = String(grid[r]?.[c] ?? "").toLowerCase();
        if (!s.trim()) continue;
        ne++;
        if (/valid|operative|inactive|\bactive\b|inoperative|deactivat|delet|struck|fake|amalgamat|not\s*(present|found|linked)/.test(s)) hit++;
      }
      const frac = ne ? hit / ne : 0;
      if (frac >= 0.4 && frac > bf) { bf = frac; statusCol = c; }
    }
    if (statusCol < 0) statusCol = findCol(isStatusHeader);

    // 4) Emit only real-PAN rows.
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
        mismatch_in_name: cell(dr, mismatchCol),
      });
    }
    if (out.length > bestOut.length) bestOut = out;
  }
  return bestOut;
}

/**
 * Stage-2 audit — OFFICE-DRIVEN. For every distinct office PAN: locate it in the
 * TRACES file and produce the correct audit result + a per-check detail (PAN
 * found / status / name). TRACES PANs with no office party are IGNORED.
 */
export function comparePanVerification(office: OfficeParty[], traces: TracesPanRow[]): PanResultRow[] {
  const tracesByPan = new Map<string, TracesPanRow>();
  for (const t of traces) { const k = normalizePan(t.pan); if (k && !tracesByPan.has(k)) tracesByPan.set(k, t); }

  const rows: PanResultRow[] = [];
  const seenOffice = new Set<string>();
  for (const o of office) {
    const k = normalizePan(o.pan);
    const dedupeKey = k || `d:${o.deductee_id}`;
    if (seenOffice.has(dedupeKey)) continue;   // one audit row per office PAN
    seenOffice.add(dedupeKey);

    const base = { office_deductee_id: o.deductee_id, office_name: o.name ?? null };

    // Office-side PAN sanity.
    if (!k) {
      rows.push({ ...base, pan_row_id: null, verified_name: null, pan: o.pan ?? null, pan_status: null,
        validation_result: "PAN Missing in Office Data",
        detail: { pan_found: false, status_class: "", name_matched: false, name_kind: "unknown" } });
      continue;
    }
    if (!looksLikePan(k)) {
      rows.push({ ...base, pan_row_id: null, verified_name: null, pan: o.pan ?? null, pan_status: null,
        validation_result: "Invalid PAN Format",
        detail: { pan_found: false, status_class: "", name_matched: false, name_kind: "unknown" } });
      continue;
    }

    const t = tracesByPan.get(k);
    if (!t) {
      rows.push({ ...base, pan_row_id: null, verified_name: null, pan: o.pan ?? null, pan_status: null,
        validation_result: "PAN Not Found in TRACES",
        detail: { pan_found: false, status_class: "", name_matched: false, name_kind: "unknown" } });
      continue;
    }

    const statusClass = classifyPanStatus(t.pan_status);
    const nameChk = resolveNameCheck(o.name, t.verified_name, t.mismatch_in_name);

    // Status is the primary axis; name is checked whenever the status is good.
    let result: PanValidationResult;
    if (statusClass === "PAN Invalid") result = "Invalid PAN";
    else if (statusClass === "PAN Inactive") result = "PAN Inoperative";
    else if (statusClass === "PAN Status Blank") result = "PAN Status Blank";
    else if (statusClass === "PAN Status Error") result = "PAN Status Error";
    else if (nameChk.matched) result = "PAN Verified";
    else if (nameChk.kind === "different") result = "Different Party Name";
    else result = "Name Mismatch";

    rows.push({
      ...base, pan_row_id: t.row_id, verified_name: t.verified_name ?? null,
      pan: o.pan ?? null, pan_status: t.pan_status ?? null, validation_result: result,
      detail: { pan_found: true, status_class: statusClass, name_matched: nameChk.matched, name_kind: nameChk.kind },
    });
  }
  return rows;
}

/**
 * Plain-English diagnostics for the WHOLE audit (Stage-1 "explain why"). Surfaces
 * systemic problems so a low verified count is explained, not left to guesswork.
 */
export function panDiagnostics(office: OfficeParty[], traces: TracesPanRow[]): string[] {
  const diag: string[] = [];
  const officePans = office.map((o) => normalizePan(o.pan));
  const officeSet = new Set(officePans.filter(Boolean));
  const tracePans = new Set(traces.map((t) => normalizePan(t.pan)).filter(Boolean));
  const officeNoPan = office.filter((o) => !normalizePan(o.pan)).length;
  const notFound = [...officeSet].filter((p) => !tracePans.has(p)).length;
  const overlap = [...officeSet].filter((p) => tracePans.has(p)).length;

  if (office.length > 0 && officeNoPan > 0)
    diag.push(`${officeNoPan} office part${officeNoPan === 1 ? "y has" : "ies have"} no PAN and cannot be verified — add the PAN in Data Entry.`);
  if (officeSet.size > 0 && tracePans.size > 0 && overlap === 0)
    diag.push(`None of this quarter's ${officeSet.size} office PANs were found in the TRACES file — the file may be for a different client or quarter.`);
  else if (notFound > 0)
    diag.push(`${notFound} office PAN(s) were not found in the TRACES file — include every office PAN in the TRACES bulk-PAN request and re-import.`);
  // Name cross-check couldn't run: overlapping rows exist but none carry a verified name.
  const overlapTraces = traces.filter((t) => officeSet.has(normalizePan(t.pan)));
  const overlapWithName = overlapTraces.filter((t) => (t.verified_name ?? "").trim()).length;
  if (overlapTraces.length >= 3 && overlapWithName === 0)
    diag.push(`The TRACES file has no Verified Name column — the name cross-check was skipped, so verify the PAN-holder names manually.`);
  const withStatus = traces.filter((t) => (t.pan_status ?? "").trim()).length;
  if (traces.length >= 3 && withStatus === 0)
    diag.push(`The TRACES file has no PAN Status values — check you imported the verification RESULT file, not the request file.`);
  return diag;
}

/** Mandatory-override reason options (last is "Other" → free text). */
export const PAN_OVERRIDE_REASONS = [
  "PAN verified manually",
  "Client confirmation received",
  "Name variation accepted",
  "Proprietorship — PAN name is the proprietor's personal name",
  "PAN status updated but TRACES report not refreshed",
  "Data entry difference accepted",
  "Other",
] as const;
