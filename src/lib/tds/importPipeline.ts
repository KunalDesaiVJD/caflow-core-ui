/**
 * CENTRALISED import pipeline — turns raw extracted rows (any client layout) into
 * clean canonical rows, with de-duplication and a record-count reconciliation
 * report. Shared by Stage-1 (client working files), Stage-2 (TRACES) and Stage-3
 * (Tally ledgers) so a mapping/record-loss fix lands in ALL of them at once.
 *
 * Extraction (which rows are data, header detection) lives in tdsImportParsing;
 * intelligent column mapping lives in columnEngine. This module composes them and
 * adds the safety nets the user asked for: dedupe overlapping sheets, and REPORT
 * (never silently drop) when the mapping reads far fewer rows than the file had.
 */

import { resolveMapping, buildCanonicalRow, type CanonicalRow, type HeaderMap, type CanonField } from "./columnEngine";
import { normalizePan } from "./match";

export interface ImportReconciliation {
  input_rows: number;       // non-empty data rows the file had
  mapped: number;           // rows the mapping turned into data
  imported: number;         // rows kept after de-duplication
  duplicates_removed: number;
  distinct_pans: number;
  expected?: number;        // caller's master count (e.g. office deductees)
  warning?: string;         // reliable: a large share of rows weren't read
  note?: string;            // soft: fewer distinct PANs than the master count
}

export interface MappingReport {
  source: "deterministic" | "ai-assisted";
  fields: Record<string, { column: string; by: string }>;
  issues: string[];
  notes: string[];
}

export interface ImportResult {
  canonical: CanonicalRow[];
  map: HeaderMap;
  mapping: MappingReport;
  reconciliation: ImportReconciliation;
}

const PAN_OK = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const nonEmptyCanon = (r: CanonicalRow) => !!(r.deductee_name || r.pan || r.amount_paid != null || r.tds_amount != null);

export interface MapOptions {
  /** Optional AI column-map (header→field) to seed fields the deterministic pass
   *  couldn't resolve. Callers get one from an edge function only when needed. */
  aiMap?: Partial<Record<CanonField, string>>;
  /** The master record count (e.g. office deductees) for the shortfall note. */
  expectedCount?: number;
}

/**
 * Map raw rows → canonical rows + reconciliation. Deterministic; the caller may
 * pass an `aiMap` (obtained from an AI edge function) to recover fields the value
 * engine couldn't resolve. Returns everything needed to import AND to explain the
 * result to the user.
 */
export function mapAndCanonicalise(rows: Record<string, unknown>[], opts: MapOptions = {}): ImportResult {
  const allRows = (rows || []).slice(0, 20000);
  const { map, report, issues, notes } = resolveMapping(allRows, opts.aiMap);

  const inputRows = allRows.filter((r) => r && typeof r === "object" && Object.values(r).some((v) => v != null && String(v).trim() !== "")).length;
  const built = allRows.map((row) => buildCanonicalRow(row, map));
  const mapped = built.filter(nonEmptyCanon);

  // CONTENT DE-DUPLICATION — collapse exact echoes (a per-section sheet AND a
  // consolidated sheet, or a repeated subtotal). The signature includes the NAME
  // so any real difference keeps both rows — priority is never dropping a record.
  const sigOf = (r: CanonicalRow) => `${normalizePan(r.pan)}|${String(r.deductee_name ?? "").trim().toUpperCase()}|${String(r.date_of_payment ?? "").trim()}|${r.amount_paid ?? ""}|${r.tds_amount ?? ""}|${String(r.section_code ?? "").trim()}`;
  const seen = new Set<string>();
  const canonical: CanonicalRow[] = [];
  let duplicatesRemoved = 0;
  for (const r of mapped) {
    const keyable = (r.pan != null && String(r.pan).trim() !== "") || r.amount_paid != null;
    if (!keyable) { canonical.push(r); continue; }
    const s = sigOf(r);
    if (seen.has(s)) { duplicatesRemoved++; continue; }
    seen.add(s); canonical.push(r);
  }

  const distinctPans = new Set(canonical.map((r) => normalizePan(r.pan)).filter((p) => PAN_OK.test(p))).size;
  const reconciliation: ImportReconciliation = {
    input_rows: inputRows, mapped: mapped.length, imported: canonical.length,
    duplicates_removed: duplicatesRemoved, distinct_pans: distinctPans,
  };
  // Reliable, intra-file signal first — rows the file HAD vs rows the mapping READ.
  if (inputRows > 0 && mapped.length < inputRows * 0.85)
    reconciliation.warning = `Only ${mapped.length} of ${inputRows} data rows were read — some rows may use a different column layout. Review before filing.`;
  // Soft office-vs-imported note (distinct PANs, wide threshold, partial-file aware).
  if (opts.expectedCount && opts.expectedCount > 0) {
    reconciliation.expected = opts.expectedCount;
    if (!reconciliation.warning && distinctPans < opts.expectedCount * 0.5)
      reconciliation.note = `Read ${distinctPans} distinct PAN(s); master data has ${opts.expectedCount}. If this file covers the WHOLE return, some records may be unread — review it. If it covers only part, this is expected.`;
  }

  return {
    canonical, map,
    mapping: {
      source: opts.aiMap ? "ai-assisted" : "deterministic",
      fields: Object.fromEntries(Object.entries(report).map(([f, v]) => [f, { column: v.header, by: v.method }])),
      issues, notes,
    },
    reconciliation,
  };
}

/** Whether a mapping result should escalate to the AI mapper (a required field is
 * unresolved, a pick looks wrong, or a big share of rows built empty). */
export function needsAiAssist(result: ImportResult): boolean {
  const f = new Set(Object.keys(result.mapping.fields));
  const enough = (f.has("pan") || f.has("deductee_name")) && (f.has("amount_paid") || f.has("tds_amount"));
  const dropRate = result.reconciliation.input_rows > 0 ? 1 - result.reconciliation.mapped / result.reconciliation.input_rows : 0;
  return !enough || result.mapping.issues.length > 0 || (result.reconciliation.input_rows >= 10 && dropRate > 0.15);
}
