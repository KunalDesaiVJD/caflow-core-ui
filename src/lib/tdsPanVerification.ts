// Stage-2 PAN Verification — pure, deterministic audit logic (no AI, no I/O).
//
// OFFICE DATA IS THE MASTER. The audit iterates the office parties for a quarter
// and, for each, finds its PAN in the imported TRACES Bulk-PAN file and checks
// the PAN STATUS the report returns. A TRACES PAN that has NO office party is
// IGNORED (office is the master; we only validate parties in the software).
//
// The office party name is NOT compared against the TRACES verified name — see the
// note on PanValidationResult below.

export type PanValidationResult =
  | "PAN Verified"                       // ✅ found in TRACES + status active/valid
  | "PAN Not Found in TRACES"            // office PAN not in the imported file
  | "Invalid PAN Format"                 // the office PAN isn't a valid 10-char PAN
  | "PAN Missing in Office Data"         // the office party has no PAN to verify
  | "Invalid PAN"                        // TRACES reports the PAN invalid/deleted/fake…
  | "PAN Inoperative"                    // TRACES reports the PAN inoperative/inactive
  | "PAN Status Blank"                   // TRACES returned no status (not processed)
  | "PAN Status Error"                   // TRACES returned an unrecognised status
  | "Duplicate PAN Across Parties";      // two office parties with different names share one PAN

// NOTE: Stage-2 does NOT cross-check the office party name against the TRACES
// verified name. The office name is routinely a legitimate short form of the ITD
// name ("KALPNABEN D PATEL" vs "KALPNABEN DIPAKBHAI PATEL", "KRUPAL HARSHADBHAI
// PATEL" vs "KRUPALKUMAR HARSHADKUMAR PATEL"), so the check produced almost
// nothing but false "Name Mismatch" noise on real returns. The PAN is the legal
// identifier and it is what the return is filed on, so Stage-2 verifies exactly
// two things: the PAN exists in TRACES, and its PAN STATUS is good. The TRACES
// verified name is still carried and displayed as context — it just never
// produces an exception. ("Duplicate PAN Across Parties" below is unrelated: it
// compares two OFFICE parties to each other to catch one PAN entered against two
// different parties — a data-entry error, not a TRACES name comparison.)

export interface OfficeParty {
  deductee_id: string;
  pan: string | null;
  name: string | null;
  // Optional TDS figures for the 206AA higher-rate cross-check (aggregated per PAN
  // inside comparePanVerification). All amounts in ₹; rate in %.
  amount?: number | null;               // amount paid/credited
  tds?: number | null;                  // total tax deducted
  rate?: number | null;                 // rate of TDS applied (%), if recorded
  section?: string | null;              // section / nature of payment
  deductee_type?: string | null;        // Company / Individual / Firm / … (PAN 4th-char cross-check)
  pan_not_available?: boolean | null;   // office flagged PAN-not-available (PANNOTAVBL)
}

export interface TracesPanRow {
  row_id: string;
  pan: string | null;
  name: string | null;            // name as submitted (usually the office name)
  verified_name: string | null;   // the ITD/TRACES official name for the PAN
  pan_status: string | null;
  mismatch_in_name: string | null; // TRACES's own Yes/No/Unknown name-mismatch flag
}

export interface ShortDeduction {
  required_rate: number;   // the rate that should have applied under 206AA (%)
  applied_rate: number;    // the rate actually deducted (%)
  amount: number;          // amount paid/credited (₹)
  shortfall: number;       // under-deducted tax (₹)
  basis: string;           // "206AA" | "206AA (194Q/194O cap)" | …
}

export interface PanCheckDetail {
  pan_found: boolean;
  status_class: string;   // classifyPanStatus bucket
  // 206AA higher-rate cross-check: present when a PAN defect (invalid/inoperative/
  // missing) means a higher rate should have been deducted but wasn't.
  short_deduction?: ShortDeduction | null;
  // Names sharing this PAN across office parties (Duplicate PAN Across Parties).
  duplicate_names?: string[];
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

// ── Entity-name normalisation + intelligent comparison — THE SHARED ENGINE ────
// normalizeName and nameCompare were once a LOCAL copy here (an older fork of the
// Stage-3 logic that had drifted: it lacked the vowel-elision rule, the Tally
// annotation stripping, and the whole tier system). That divergence is precisely
// the bug being unified away — a fix landing in one stage never reached the others.
// Stage-2 now imports the ONE engine from ./tds/match, so name comparison behaves
// identically in Stage-1, Stage-2 and Stage-3.
//
// Re-exported so existing importers of normalizeName/nameCompare FROM this module
// (e.g. TdsPanVerification.tsx imports normalizeName as normName) keep working.
//
// Stage-2's own behaviour is UNCHANGED in intent: it still does NOT compare the
// office name against the TRACES verified name (that produced false "Name Mismatch"
// noise the user asked us to remove). nameCompare's ONLY caller in this module is
// allNamesEquivalent(), which compares two OFFICE parties sharing one PAN to decide
// whether it is a Duplicate-PAN-Across-Parties data-entry error. The shared engine
// is a strict improvement for that check (vowel-elision + annotation stripping mean
// two genuine spellings of the SAME party are correctly seen as equivalent, so it
// no longer raises a spurious duplicate conflict).
export { normalizeName, nameCompare } from "./tds/match";
import { normalizeName, nameCompare } from "./tds/match";

/** TRACES "Mismatch in Name" flag → yes | no | unknown. Substring/normalised (real
 * files phrase it "Name Matched" / "Does Not Match" / "Not Matched" / "Y" / "N"),
 * negatives checked first since "does not match" contains "match". "yes" = there IS
 * a name mismatch (bad); "no" = names match (good). */
export function normMismatchFlag(v: string | null | undefined): "yes" | "no" | "unknown" {
  const s = String(v ?? "").trim().toLowerCase();
  if (!s) return "unknown";
  if (/mismatch|not\s*match|does\s*not|differ|unmatch/.test(s) || /^y(es)?$/.test(s) || s === "true") return "yes";
  if (/match/.test(s) || /^n(o|a)?$/.test(s) || s === "false") return "no";
  return "unknown";
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
  if (/invalid|not\s*valid|deactivat|deleted|fake|struck|amalgamat|merg|acqui|liquidat|dissolv|surrender|not\s*(present|found|exist)|non.?exist|not\s*in\s*itd/.test(s)) return "PAN Invalid";
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
  "Duplicate PAN Across Parties": "Two or more office parties with different names share this PAN — at least one PAN is likely entered against the wrong party.",
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
  "Duplicate PAN Across Parties": "Check each party sharing this PAN — correct the PAN on whichever entry is wrong (a common cause of TDS credit going to the wrong deductee).",
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

/** A value that reads like a party/person NAME — mostly letters, multi-char, and
 * NOT a PAN / pure number / status word. Used as a value-based fallback for the
 * name column when no header matched (parity with Stage-1's looksLikeName). */
const TRACES_STATUS_WORD = /valid|operative|inactive|active|inoperative|deactivat|delet|struck|fake|amalgamat|blank|error|pending|processed|not\s*(present|found|linked)/i;
function looksLikeTracesName(v: unknown): boolean {
  const s = String(v ?? "").trim();
  if (s.length < 4) return false;
  if (looksLikePan(s)) return false;
  if (/^[\d.,\-()/%\s]+$/.test(s)) return false;   // pure number/punct
  if (TRACES_STATUS_WORD.test(s) && s.split(/\s+/).length <= 2) return false; // a status value, not a name
  const letters = (s.match(/[A-Za-z]/g) || []).length;
  return letters >= 3 && letters / s.length >= 0.5;
}

/** The columns extractTracesRows detected — surfaced to the user for transparency
 * (parity with Stage-1's mapping report). Each value is the source header label
 * (or a positional fallback), or null when the column wasn't found. */
export interface TracesMapping {
  sheet: string | null;
  pan: string | null;
  pan_status: string | null;
  name: string | null;
  verified_name: string | null;
  mismatch_in_name: string | null;
  panRows: number;
}

/**
 * Extract TRACES PAN rows from sheet grids — GENERIC (value-based PAN + status +
 * name detection; only real-PAN rows emitted; header/title/total rows auto-skipped;
 * the sheet with the most PAN rows wins). Grids come from tdsWorkbook.readSheetGrids
 * (TRUE used range → a bloated-!ref file can never freeze the tab). Returns the
 * parsed rows PLUS a mapping report of which column fed each field. Pure + testable.
 */
export function extractTracesRows(
  grids: { name: string; grid: unknown[][] }[],
): { rows: Omit<TracesPanRow, "row_id">[]; mapping: TracesMapping } {
  let bestOut: Omit<TracesPanRow, "row_id">[] = [];
  let bestMapping: TracesMapping = { sheet: null, pan: null, pan_status: null, name: null, verified_name: null, mismatch_in_name: null, panRows: 0 };
  for (const { name: sheetName, grid } of grids) {
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

    // 2) HEADER row — the BEST-scoring label row ABOVE the data (not merely the
    //    first pan-ish row, which could be a preamble/banner). A header row carries
    //    several recognised labels and NO PAN value. A TWO-ROW header (a main-label
    //    row directly above a sub-label row) is merged cell-by-cell, like Stage-1.
    const nbs = (v: unknown) => String(v ?? "").trim();
    const headerScore = (row: unknown[]): number => {
      const cells = (row || []).map(nh);
      let s = 0;
      if (cells.some((h) => h.includes("pan"))) s++;
      if (cells.some(isStatusHeader)) s++;
      if (cells.some(isNameHeader)) s++;
      if (cells.some(isVerifiedHeader)) s++;
      if (cells.some(isMismatchHeader)) s++;
      return s;
    };
    const scanEnd = firstPanRow > 0 ? firstPanRow : Math.min(grid.length, 25);
    let hdrIdx = -1, hdrBest = 1;   // require ≥2 recognised labels to count as a header
    for (let r = 0; r < scanEnd; r++) {
      const row = grid[r] || [];
      if (row.some((c) => looksLikePan(c))) continue;      // a header row carries no PAN value
      const sc = headerScore(row);
      if (sc >= 2 && sc >= hdrBest) { hdrBest = sc; hdrIdx = r; }   // ≥ prefers the row CLOSEST to the data on ties
    }
    let headerCells: unknown[] = hdrIdx >= 0 ? [...(grid[hdrIdx] || [])] : (firstPanRow > 0 ? [...(grid[firstPanRow - 1] || [])] : []);
    if (hdrIdx > 0) {   // merge a header-ish, PAN-less row directly above (split labels)
      const above = grid[hdrIdx - 1] || [];
      if (!above.some((c) => looksLikePan(c)) && headerScore(above) >= 1) {
        const m = Math.max(headerCells.length, above.length);
        for (let i = 0; i < m; i++) {
          const top = nbs(above[i]), bot = nbs(headerCells[i]);
          headerCells[i] = top && bot ? `${top} ${bot}` : (top || headerCells[i]);
        }
      }
    }
    const headerRow = headerCells;
    const header = headerRow.map(nh);
    const findCol = (pred: (h: string) => boolean) => header.findIndex(pred);
    let nameCol = findCol(isNameHeader);
    const verifiedCol = findCol(isVerifiedHeader);
    let mismatchCol = findCol(isMismatchHeader);

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

    // 3b) NAME column — value-based fallback when no header matched: the column
    //     (not PAN/status/verified/mismatch) whose values read most like names.
    if (nameCol < 0) {
      let bestNameCol = -1, bestNameFrac = 0;
      for (let c = 0; c < ncol; c++) {
        if (c === panCol || c === statusCol || c === verifiedCol || c === mismatchCol) continue;
        let ne = 0, hit = 0;
        for (let r = Math.max(0, firstPanRow); r < grid.length; r++) {
          const s = String(grid[r]?.[c] ?? "").trim();
          if (!s) continue;
          ne++;
          if (looksLikeTracesName(s)) hit++;
        }
        const frac = ne ? hit / ne : 0;
        if (frac >= 0.5 && frac > bestNameFrac) { bestNameFrac = frac; bestNameCol = c; }
      }
      if (bestNameCol >= 0) nameCol = bestNameCol;
    }

    // 3c) MISMATCH-flag column — value-based fallback (a Yes/No/Match column) when
    //     no header matched, so a two-row / oddly-labelled flag still clears names.
    if (mismatchCol < 0) {
      let bestM = -1, bestMFrac = 0;
      for (let c = 0; c < ncol; c++) {
        if (c === panCol || c === statusCol || c === nameCol || c === verifiedCol) continue;
        let ne = 0, hit = 0;
        for (let r = Math.max(0, firstPanRow); r < grid.length; r++) {
          const s = nbs(grid[r]?.[c]).toLowerCase();
          if (!s) continue;
          ne++;
          if (/^(y|n|yes|no|match|matched|mismatch|not\s*match|does\s*not|differ)/.test(s)) hit++;
        }
        const frac = ne ? hit / ne : 0;
        if (frac >= 0.6 && frac > bestMFrac) { bestMFrac = frac; bestM = c; }
      }
      if (bestM >= 0) mismatchCol = bestM;
    }

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
    if (out.length > bestOut.length) {
      bestOut = out;
      // Column label = the source header text (original casing), or a positional
      // fallback for a value-detected column with no header text.
      const label = (i: number): string | null => {
        if (i < 0) return null;
        const h = String(headerRow[i] ?? "").trim();
        return h || `Column ${i + 1}`;
      };
      bestMapping = {
        sheet: sheetName ?? null,
        pan: label(panCol), pan_status: label(statusCol), name: label(nameCol),
        verified_name: label(verifiedCol), mismatch_in_name: label(mismatchCol),
        panRows: out.length,
      };
    }
  }
  return { rows: bestOut, mapping: bestMapping };
}

/** True when every name in the list is name-equivalent (used to decide whether two
 *  office parties sharing a PAN are the same party or a Duplicate-PAN conflict). */
function allNamesEquivalent(names: string[]): boolean {
  for (let i = 1; i < names.length; i++) if (nameCompare(names[0], names[i]) !== "match") return false;
  return true;
}

/** The higher TDS rate mandated when the PAN is not effectively furnished (§206AA /
 *  Rule 114AAA for inoperative PANs). 20% in general; the 206AA proviso caps it at
 *  5% for 194-Q and 194-O. (max-with-section-rate is unnecessary here: a PAN-defect
 *  case only under-deducts when the applied rate is below this floor.) */
function higherRateFor(section: string | null | undefined): { required: number; basis: string } {
  const s = String(section ?? "").toUpperCase().replace(/[^0-9A-Z]/g, "");
  if (/194Q/.test(s) || /194O/.test(s)) return { required: 5, basis: "§206AA (194Q/194O cap 5%)" };
  return { required: 20, basis: "§206AA (20%)" };
}

/** §206AA short-deduction: given a party's amount/tds/rate + section, the rupee
 *  under-deduction vs the mandated higher rate, or null if compliant / no amount. */
function computeShortDeduction(
  amount: number | null | undefined, tds: number | null | undefined,
  rate: number | null | undefined, section: string | null | undefined,
): ShortDeduction | null {
  const amt = Number(amount) || 0;
  if (amt <= 0) return null;
  const applied = (rate != null && Number(rate) > 0) ? Number(rate) : ((Number(tds) || 0) / amt) * 100;
  const { required, basis } = higherRateFor(section);
  if (applied >= required - 0.05) return null;          // already at/above the higher rate
  const shortfall = Math.round(((required - applied) / 100) * amt);
  if (shortfall <= 1) return null;                      // within ₹1 tolerance
  return { required_rate: required, applied_rate: Math.round(applied * 100) / 100, amount: amt, shortfall, basis };
}

/** One entry in the office-side PAN grouping — see groupOfficeByParty(). */
interface OfficePartyAgg { rep: OfficeParty; amount: number; tds: number; names: Set<string>; }

/**
 * Groups raw office rows into PARTIES: one entry per valid PAN (a party can have
 * several `tds_deductees` rows in a quarter — one per payment/transaction — and
 * they must count as ONE party, not several), with amount/TDS summed and every
 * distinct name sharing that PAN collected (for Duplicate-PAN detection). A
 * missing/invalid PAN is never silently merged into another party — each such row
 * is its own, individually-audited party.
 *
 * This is the ONE definition of "a party" for Stage 2 — comparePanVerification and
 * countDistinctOfficeParties both call it, so the audit's "Total Parties" and the
 * Office Data card's "parties" count can never disagree.
 */
function groupOfficeByParty(office: OfficeParty[]): { byPan: Map<string, OfficePartyAgg>; noPan: OfficeParty[] } {
  const byPan = new Map<string, OfficePartyAgg>();
  const noPan: OfficeParty[] = [];
  for (const o of office) {
    const k = normalizePan(o.pan);
    if (!k || !looksLikePan(k)) { noPan.push(o); continue; }
    let agg = byPan.get(k);
    if (!agg) { agg = { rep: o, amount: 0, tds: 0, names: new Set() }; byPan.set(k, agg); }
    agg.amount += Number(o.amount) || 0;
    agg.tds += Number(o.tds) || 0;
    if (o.name && normalizeName(o.name)) agg.names.add(o.name.trim());
  }
  return { byPan, noPan };
}

/**
 * Distinct-PARTY counts for the office data, using the SAME grouping the audit runs
 * on (see groupOfficeByParty). This is what the Office Data card must show: a raw
 * `tds_deductees` row count over-counts whenever one party has multiple TDS entries
 * in the quarter, which is routine (several months' payments to the same deductee).
 */
export function countDistinctOfficeParties(office: OfficeParty[]): { total: number; withPan: number } {
  const { byPan, noPan } = groupOfficeByParty(office);
  return { total: byPan.size + noPan.length, withPan: byPan.size };
}

/**
 * Stage-2 audit — OFFICE-DRIVEN. Every office party is audited against the TRACES
 * file: PAN existence → status → name (with the §206AA higher-rate cross-check for
 * PAN defects, and Duplicate-PAN detection when two parties share one PAN under
 * different names). TRACES PANs with no office party are IGNORED (office is master).
 */
export function comparePanVerification(office: OfficeParty[], traces: TracesPanRow[]): PanResultRow[] {
  // Index TRACES rows by PAN. Across MULTIPLE imported files (or duplicate rows
  // within one) the SAME PAN can appear more than once. `traces` arrives NEWEST-file
  // -first, and PAN status is point-in-time, so we take each field from the NEWEST
  // row that has it (a fresh "Inoperative" must never be shadowed by an older
  // "Valid"), backfilling blanks from older rows. This "newest non-blank per field"
  // merge keeps recency on the compliance axis while still filling missing names.
  const nb = (v: unknown) => String(v ?? "").trim();
  const tracesByPan = new Map<string, TracesPanRow>();
  for (const t of traces) {
    const k = normalizePan(t.pan);
    if (!k) continue;
    const cur = tracesByPan.get(k);
    if (!cur) { tracesByPan.set(k, { ...t, pan: k }); continue; }
    if (!nb(cur.pan_status) && nb(t.pan_status)) cur.pan_status = t.pan_status;
    if (!nb(cur.verified_name) && nb(t.verified_name)) cur.verified_name = t.verified_name;
    if (!nb(cur.name) && nb(t.name)) cur.name = t.name;
    if (!nb(cur.mismatch_in_name) && nb(t.mismatch_in_name)) cur.mismatch_in_name = t.mismatch_in_name;
  }

  // Aggregate office parties by valid PAN — one row per PARTY, not per transaction.
  const { byPan, noPan } = groupOfficeByParty(office);

  const rows: PanResultRow[] = [];

  // No-PAN / invalid-format parties — audited individually; §206AA higher rate is
  // mandatory when the PAN is not furnished, so cross-check the rate here too.
  for (const o of noPan) {
    const k = normalizePan(o.pan);
    const result: PanValidationResult = !k ? "PAN Missing in Office Data" : "Invalid PAN Format";
    const detail: PanCheckDetail = {
      pan_found: false, status_class: "",
      short_deduction: computeShortDeduction(o.amount, o.tds, o.rate, o.section),
    };
    rows.push({ office_deductee_id: o.deductee_id, office_name: o.name ?? null, pan_row_id: null,
      verified_name: null, pan: o.pan ?? null, pan_status: null, validation_result: result, detail });
  }

  // Real-PAN parties — one audit row per PAN.
  for (const [k, agg] of byPan) {
    const o = agg.rep;
    const base = { office_deductee_id: o.deductee_id, office_name: o.name ?? null };
    const distinctNames = [...agg.names];
    const namesConflict = distinctNames.length >= 2 && !allNamesEquivalent(distinctNames);

    const t = tracesByPan.get(k);
    if (!t) {
      const detail: PanCheckDetail = { pan_found: false, status_class: "" };
      if (namesConflict) detail.duplicate_names = distinctNames;
      rows.push({ ...base, pan_row_id: null, verified_name: null, pan: o.pan ?? null, pan_status: null,
        validation_result: namesConflict ? "Duplicate PAN Across Parties" : "PAN Not Found in TRACES", detail });
      continue;
    }

    const statusClass = classifyPanStatus(t.pan_status);

    // Duplicate-PAN conflict outranks a clean status; otherwise the PAN STATUS is
    // the only thing that can raise an exception. A good status = verified — the
    // party name is NOT compared against TRACES (see the note on PanValidationResult).
    let result: PanValidationResult;
    if (namesConflict) result = "Duplicate PAN Across Parties";
    else if (statusClass === "PAN Invalid") result = "Invalid PAN";
    else if (statusClass === "PAN Inactive") result = "PAN Inoperative";
    else if (statusClass === "PAN Status Blank") result = "PAN Status Blank";
    else if (statusClass === "PAN Status Error") result = "PAN Status Error";
    else result = "PAN Verified";

    const detail: PanCheckDetail = { pan_found: true, status_class: statusClass };
    if (namesConflict) detail.duplicate_names = distinctNames;
    // §206AA: an inoperative / invalid PAN requires the higher rate.
    if (statusClass === "PAN Invalid" || statusClass === "PAN Inactive") {
      detail.short_deduction = computeShortDeduction(agg.amount, agg.tds, o.rate, o.section);
    }

    rows.push({
      ...base, pan_row_id: t.row_id, verified_name: t.verified_name ?? null,
      pan: o.pan ?? null, pan_status: t.pan_status ?? null, validation_result: result, detail,
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
  const withStatus = traces.filter((t) => (t.pan_status ?? "").trim()).length;
  if (traces.length >= 3 && withStatus === 0)
    diag.push(`The TRACES file has no PAN Status values — check you imported the verification RESULT file, not the request file.`);
  // Reverse completeness — PANs in the TRACES file that match no office party. A
  // large number usually means the wrong quarter's/client's file was imported, or
  // parties were edited/deleted in office after the TRACES request was generated.
  const unmatched = [...tracePans].filter((p) => !officeSet.has(p)).length;
  if (tracePans.size > 0 && officeSet.size > 0 && unmatched > 0 && unmatched >= Math.max(3, Math.ceil(tracePans.size * 0.5)))
    diag.push(`${unmatched} of ${tracePans.size} PAN(s) in the TRACES file have no matching office party — confirm this is the right quarter's/client's file.`);
  return diag;
}

/** Mandatory-override reason options (last is "Other" → free text). */
export const PAN_OVERRIDE_REASONS = [
  "PAN verified manually",
  "Client confirmation received",
  "Proprietorship — PAN name is the proprietor's personal name",
  "PAN status updated but TRACES report not refreshed",
  "Higher rate (20% / 5%) already deducted — §206AA satisfied",
  "Short deduction to be corrected / adjusted",
  "Data entry difference accepted",
  "Other",
] as const;
