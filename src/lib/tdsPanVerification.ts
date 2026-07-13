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

/** Normalise a PAN for exact matching: uppercase, strip whitespace. */
export const normalizePan = (pan: string | null | undefined): string =>
  (pan ?? "").trim().toUpperCase().replace(/\s+/g, "");

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
  return s.replace(/\s+/g, " ").trim();
};

/**
 * Do two names refer to the same party? Exact after normalisation, OR a high
 * token overlap (≥ 60%) so word-order/extra-token/minor differences don't create
 * false "Name Mismatch"es. A blank on either side is not compared (returns true).
 */
export const namesMatch = (a: string | null | undefined, b: string | null | undefined): boolean => {
  const na = normalizeName(a), nb = normalizeName(b);
  if (!na || !nb) return true;              // nothing reliable to compare
  if (na === nb) return true;
  const ta = new Set(na.split(" ").filter(Boolean));
  const tb = new Set(nb.split(" ").filter(Boolean));
  const inter = [...ta].filter(x => tb.has(x)).length;
  const union = new Set([...ta, ...tb]).size;
  return union > 0 && inter / union >= 0.6;
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
  if (s.includes("invalid") || s.includes("not valid")) return "PAN Invalid";
  if (s.includes("inoperative") || s.includes("inactive")) return "PAN Inactive";
  // Keyword (not exact) match so "Valid and Operative", "PAN is Valid", etc. are
  // recognised as verified rather than falling through to "PAN Status Error".
  if (s.includes("valid") || s.includes("operative") || s.includes("active")) return "PAN Verified";
  return "PAN Status Error";
}

/** Anything that is not a clean "PAN Verified" is an exception needing review/override. */
export const isPanException = (r: PanValidationResult): boolean => r !== "PAN Verified";

/**
 * Deterministic Stage-2 comparison. Office parties are deduped by PAN (one
 * result per party); office parties with no PAN can't be verified and are
 * reported as missing from the PAN file. TRACES PANs absent from the office set
 * are reported as "Party Missing in Office Data" (strict single-quarter scope —
 * caller passes only the selected quarter's office parties).
 */
export function comparePanVerification(office: OfficeParty[], traces: TracesPanRow[]): PanResultRow[] {
  const tracesByPan = new Map<string, TracesPanRow>();
  for (const t of traces) {
    const k = normalizePan(t.pan);
    if (k && !tracesByPan.has(k)) tracesByPan.set(k, t);
  }

  const rows: PanResultRow[] = [];
  const seenOfficePan = new Set<string>();

  for (const o of office) {
    const k = normalizePan(o.pan);
    if (k) {
      if (seenOfficePan.has(k)) continue; // one result per party (PAN)
      seenOfficePan.add(k);
      const t = tracesByPan.get(k);
      if (!t) {
        rows.push({ office_deductee_id: o.deductee_id, pan_row_id: null, party_name: o.name, pan: o.pan ?? null, pan_status: null, validation_result: "Party Missing in PAN Verification File" });
      } else {
        const status = classifyPanStatus(t.pan_status);
        // Intelligent name check — only when the PAN itself is verified: compare
        // the office name against the TRACES verified name (fall back to the
        // submitted name), tolerant of formatting / word-order differences.
        const result: PanValidationResult =
          status === "PAN Verified" && !namesMatch(o.name, t.verified_name || t.name)
            ? "Name Mismatch"
            : status;
        rows.push({ office_deductee_id: o.deductee_id, pan_row_id: t.row_id, party_name: o.name || t.name, pan: o.pan ?? null, pan_status: t.pan_status ?? null, validation_result: result });
      }
    } else {
      // Office party with no PAN — nothing to verify against the TRACES file.
      rows.push({ office_deductee_id: o.deductee_id, pan_row_id: null, party_name: o.name, pan: o.pan ?? null, pan_status: null, validation_result: "Party Missing in PAN Verification File" });
    }
  }

  const seenTraces = new Set<string>();
  for (const t of traces) {
    const k = normalizePan(t.pan);
    if (!k || seenOfficePan.has(k) || seenTraces.has(k)) continue;
    seenTraces.add(k);
    rows.push({ office_deductee_id: null, pan_row_id: t.row_id, party_name: t.name, pan: t.pan ?? null, pan_status: t.pan_status ?? null, validation_result: "Party Missing in Office Data" });
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
