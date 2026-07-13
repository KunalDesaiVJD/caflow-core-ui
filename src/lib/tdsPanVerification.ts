// Stage-2 PAN Verification — pure, deterministic comparison logic (no AI, no I/O).
// Office parties (from tds_deductees for the selected quarter) are matched by PAN
// against a TRACES Bulk PAN Verification file; the PAN Status is keyword-classified.

export type PanValidationResult =
  | "PAN Verified"
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
  if (s.includes("invalid") || s.includes("not valid")) return "PAN Invalid";
  if (s.includes("inoperative") || s.includes("inactive")) return "PAN Inactive";
  if (s === "valid" || s === "valid and operative" || s === "active") return "PAN Verified";
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
        rows.push({ office_deductee_id: o.deductee_id, pan_row_id: t.row_id, party_name: o.name || t.name, pan: o.pan ?? null, pan_status: t.pan_status ?? null, validation_result: classifyPanStatus(t.pan_status) });
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
