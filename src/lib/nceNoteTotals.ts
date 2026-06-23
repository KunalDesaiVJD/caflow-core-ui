/**
 * nceNoteTotals — single canonical aggregator for every NCE note total.
 *
 * Phase 3 of the FS Re-Architecture. Before this module, four independent
 * aggregation functions computed the same numbers with subtly different
 * rules, and they diverged on edge cases:
 *
 *   1. sumCustomDisplayB / sumCustomDisplayA  (NCEDetailedNotes.tsx, renderer)
 *   2. computeDisplayData.sumCustomB / sumCustomA  (nceNotesConfig.ts, Note Total row)
 *   3. getNCENoteFaceTotal  (nceAutoPopulate.ts, BS/P&L face value)
 *   4. aggA / aggB  (nceFinancialsDocx.ts, DOCX export)
 *
 * Each had its own:
 *   • recursion rule for nested customRows
 *   • sources[] guard (when does sources contribute?)
 *   • cy_sources overlap subtract
 *   • formula DAG traversal
 *
 * The result was that the BS face / Note Total row / per-row aggregate /
 * DOCX export produced different numbers for the same data, which is what
 * the SHREE HARI / SKYLARK / OM REALTY reconciliation bugs reported.
 *
 * This module exposes ONE function — computeNoteTotals — that every
 * callsite delegates to. The math here is the canonical contract: the
 * Note Total row, the BS face, the renderer's per-row aggregate, and the
 * DOCX export ALL read the same numbers because they all read from the
 * same call's result.
 *
 * Sign convention is OUT OF SCOPE here (handled by Phase 1's
 * fsSignConvention module). This file is pure aggregation.
 */

import type { NoteConfig, NoteRowDef } from "@/config/nceNotesConfig";

// ─── Types ────────────────────────────────────────────────────────────────────

/** A customRow as it appears in nce_financial_notes.cy_data._custom_rows.
 *  We accept the structural minimum — id, attachedTo, section, sources[] —
 *  rather than the full NCECustomRow type, so this module stays decoupled
 *  from nceAutoPopulate. */
export interface NoteCustomRowLike {
  id:           string;
  attachedTo?:  string;
  section?:     string;
  /** "manual" = survives re-sync (user "+ Add row"); "auto" = build-created. */
  source?:      string;
  /** true = amount comes from TB/COA (locked from edit) — NOT a hand-typed value. */
  tbDerived?:   boolean;
  sources?: Array<{
    ledger?:     string;
    amountCy?:   number;
    amountPy?:   number;
    /** Pattern A only: which split column this source feeds. Default "lt". */
    column?:     "lt" | "st";
  }>;
}

/** Pattern B row total — single CY + PY pair. */
export interface RowTotalsB {
  cy: number;
  py: number;
}

/** Pattern A row total — LT and ST columns each with CY + PY. */
export interface RowTotalsA {
  ltCy: number;
  ltPy: number;
  stCy: number;
  stPy: number;
}

export type RowTotals = RowTotalsB | RowTotalsA;

export interface NoteTotalsResultB {
  pattern:    "B";
  grandTotal: RowTotalsB;
  /** Lookup by row id (static row OR customRow id) → its aggregated value. */
  perRow:     Record<string, RowTotalsB>;
  /** Lookup by sectionTag (e.g. "secured", "unsecured") → that section's total. */
  perSection: Record<string, RowTotalsB>;
}

export interface NoteTotalsResultA {
  pattern:    "A";
  grandTotal: RowTotalsA;
  perRow:     Record<string, RowTotalsA>;
  perSection: Record<string, RowTotalsA>;
}

export type NoteTotalsResult = NoteTotalsResultA | NoteTotalsResultB;

// ─── Column model (Phase 3 — first-class Pattern A) ─────────────────────────────
//
// THE single source of truth for two things:
//   (1) "which columns does a note have"  → columnsFor(config)
//   (2) "what storage key holds a (row, column) value" → keyFor(rowId, col)
//
// Pattern A notes (borrowings, provisions, investments, loans_advances) split
// each row into a long-term and a short-term column stored under
// `${rowId}_lt` / `${rowId}_st`; every other note is a single column stored
// under the bare `${rowId}`. Nothing else in the codebase may hard-code
// `["lt","st"]` or the `_lt`/`_st` suffix — route through these helpers so the
// LT/ST convention lives in exactly one place.

/** A note column: "all" = the single column of a Pattern B note; "lt"/"st" =
 *  the long-term / short-term columns of a Pattern A note. */
export type NoteColumn = "all" | "lt" | "st";

/** The columns a note has, derived from its config pattern. THE map from
 *  config.pattern → columns. NOTE: the recompute engine's storage-side
 *  classification (PATTERN_A_NOTES in nceRecomputePYFromShell) is a SEPARATE
 *  dimension keyed by storage noteType, not by NoteConfig — the two are
 *  intentionally distinct and must not be unified. */
export function columnsFor(config: Pick<NoteConfig, "pattern">): NoteColumn[] {
  return config.pattern === "A" ? ["lt", "st"] : ["all"];
}

/** The storage key for a (rowId, column) pair. The "all" column lives under the
 *  bare rowId; "lt"/"st" under the suffixed key. */
export function keyFor(rowId: string, col: NoteColumn): string {
  return col === "all" ? rowId : `${rowId}_${col}`;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Read a SINGLE column's CY/PY for a row id, applying the legacy bare-key
 *  fallback rule. The bare key (`${id}`) is consulted ONLY for the "lt" and
 *  "all" columns, and (for "lt") ONLY when neither suffixed key exists in that
 *  map — the "st" column NEVER falls back to the bare key. This asymmetry is
 *  the 2026-06-12 per-column decision that prevents a single legacy bare value
 *  from inflating BOTH the LT and ST totals (the provisions / Other Current
 *  Liabilities double-count bug). Each map (cy, py) decides bare-vs-suffixed
 *  independently so a value present under the bare key in only one column still
 *  resolves. */
export function lookupColumn(
  cy: Record<string, number>,
  py: Record<string, number>,
  id: string,
  col: NoteColumn,
): { cy: number; py: number } {
  if (col === "all") {
    return { cy: cy[id] ?? 0, py: py[id] ?? 0 };
  }
  if (col === "st") {
    // ST never falls back to the bare key (the load-bearing asymmetry).
    const stKey = keyFor(id, "st");
    return { cy: cy[stKey] ?? 0, py: py[stKey] ?? 0 };
  }
  // LT: bare fallback only when NEITHER suffix key exists in that column's map.
  const ltKey = keyFor(id, "lt"), stKey = keyFor(id, "st");
  const useBareCy = !(ltKey in cy) && !(stKey in cy);
  const useBarePy = !(ltKey in py) && !(stKey in py);
  return {
    cy: cy[ltKey] ?? (useBareCy ? cy[id] ?? 0 : 0),
    py: py[ltKey] ?? (useBarePy ? py[id] ?? 0 : 0),
  };
}

/** Pattern A look-up that picks the _lt and _st columns. Thin wrapper over
 *  lookupColumn so the bare-key asymmetry lives in exactly one place. Behaviour
 *  is identical to the pre-Phase-3 inline implementation. */
function lookupSuffixed(
  cy: Record<string, number>,
  py: Record<string, number>,
  id: string,
): { ltCy: number; ltPy: number; stCy: number; stPy: number } {
  const lt = lookupColumn(cy, py, id, "lt");
  const st = lookupColumn(cy, py, id, "st");
  return { ltCy: lt.cy, ltPy: lt.py, stCy: st.cy, stPy: st.py };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * The single canonical aggregator. Drives the Note Total row, the BS / P&L
 * face value, the renderer's per-row aggregate, and the DOCX export. Every
 * callsite that previously had its own duplicated aggregation logic now
 * routes through here.
 *
 * Semantics (matching computeDisplayData's existing rules — the long-tested
 * algorithm that drives the Note Total row that auditors see):
 *
 *   • perRow[id] for a static row    = raw[id] + Σ perRow[descendants attached to id]
 *   • perRow[id] for a customRow     = raw[id]
 *                                     + (sources[] sum, when raw[id] === 0)
 *                                     + Σ perRow[descendants attached to id]
 *   • perSection[tag]                = walks the section-total row's
 *                                       formulaAdd/Sub, summing perRow for each
 *                                       addend + sectionless customRows tagged
 *                                       with `tag` and not attached anywhere
 *   • grandTotal                     = walks the LAST isTotal row's
 *                                       formulaAdd/Sub, summing perRow for each
 *                                       addend + sectionless customRows
 *                                       (`!section && !attachedTo`)
 *
 * For Pattern A the same rules apply per LT/ST column. Sources[] entries
 * are routed by their `column` field (default "lt").
 *
 * Cycle-safe: every recursive walk passes a `seen` set so a stray
 * attachedTo cycle returns 0 rather than blowing the stack.
 */
export function computeNoteTotals(
  config:     NoteConfig,
  rawCy:      Record<string, number>,
  rawPy:      Record<string, number>,
  customRows: NoteCustomRowLike[] = [],
): NoteTotalsResult {
  // ── Build child-index for O(1) "rows attached to X" lookups ────────────
  const childrenOf: Record<string, NoteCustomRowLike[]> = {};
  for (const cr of customRows) {
    if (!cr.attachedTo) continue;
    (childrenOf[cr.attachedTo] ||= []).push(cr);
  }
  const crById: Record<string, NoteCustomRowLike> = {};
  for (const cr of customRows) crById[cr.id] = cr;

  // Find the grand-total row id (last isTotal row in the config).
  const grandTotalId = [...config.rows].reverse().find(r => r.isTotal)?.id ?? null;
  const isTotalId    = new Set(config.rows.filter(r => r.isTotal).map(r => r.id));

  if (config.pattern === "B") {
    // ── Pattern B aggregation ───────────────────────────────────────────
    const perRow:     Record<string, RowTotalsB> = {};
    const perSection: Record<string, RowTotalsB> = {};

    // Recursive descendant aggregate for any node id (static or customRow).
    const aggregate = (id: string, seen: Set<string>): RowTotalsB => {
      if (seen.has(id)) return { cy: 0, py: 0 };
      seen.add(id);
      let c = rawCy[id] ?? 0;
      let p = rawPy[id] ?? 0;
      const hasDescendants = (childrenOf[id] ?? []).length > 0;
      // sources[] — heading-style customRow pattern. Only contribute when
      // the row's own raw is 0 (per side). Static rows never have sources.
      // MAHARSH INFRA FIX: when a row has children attached, do NOT add
      // sources — the children carry the individual amounts. Adding both
      // sources and children double-counts (e.g. "Plot No. A" parent had
      // sources [A-016, A-039] whose amounts also appeared inside child
      // rows, inflating the note total by ₹1.32 cr).
      const self = crById[id];
      if (!hasDescendants && self?.sources && self.sources.length > 0) {
        const srcCy = self.sources.reduce((s, x) => s + (Number(x?.amountCy) || 0), 0);
        const srcPy = self.sources.reduce((s, x) => s + (Number(x?.amountPy) || 0), 0);
        if ((rawCy[id] ?? 0) === 0) c += srcCy;
        if ((rawPy[id] ?? 0) === 0) p += srcPy;
      }
      for (const child of childrenOf[id] ?? []) {
        const r = aggregate(child.id, seen);
        c += r.cy; p += r.py;
      }
      return { cy: c, py: p };
    };

    // First pass: aggregate every static (non-total) row and every customRow.
    for (const row of config.rows) {
      if (row.isTotal) continue;
      perRow[row.id] = aggregate(row.id, new Set());
    }
    for (const cr of customRows) {
      perRow[cr.id] = aggregate(cr.id, new Set());
    }

    // Second pass: walk every isTotal row's formula and write its value.
    for (const row of config.rows) {
      if (!row.isTotal) continue;
      const adds = row.formulaAdd ?? [];
      const subs = row.formulaSub ?? [];

      // Determine which sectionless customRows contribute to THIS total:
      //   • Section-total (sectionTag set) → customRows tagged with that
      //     section AND not attached anywhere (attached ones are already
      //     counted inside their parent's perRow).
      //   • Grand-total (last isTotal)     → customRows with NO section AND
      //     NO attachedTo.
      //   • Intermediate sub-totals        → none (avoids double-count).
      let extras: NoteCustomRowLike[] = [];
      if (row.sectionTag) {
        extras = customRows.filter(cr => cr.section === row.sectionTag && !cr.attachedTo);
      } else if (row.id === grandTotalId) {
        extras = customRows.filter(cr => !cr.section && !cr.attachedTo);
      }

      let cVal = 0, pVal = 0;
      for (const id of adds) {
        // Addend can be a static row, a section-total row id, or any
        // previously-evaluated total. Look it up in perRow first; fall back
        // to rawCy/rawPy for any id we haven't precomputed (legacy keys).
        const v = perRow[id];
        if (v) { cVal += v.cy; pVal += v.py; }
        else   { cVal += rawCy[id] ?? 0; pVal += rawPy[id] ?? 0; }
      }
      for (const id of subs) {
        const v = perRow[id];
        if (v) { cVal -= v.cy; pVal -= v.py; }
        else   { cVal -= rawCy[id] ?? 0; pVal -= rawPy[id] ?? 0; }
      }
      for (const cr of extras) {
        const r = perRow[cr.id] ?? aggregate(cr.id, new Set());
        cVal += r.cy; pVal += r.py;
      }

      const totalRow: RowTotalsB = { cy: round2(cVal), py: round2(pVal) };
      perRow[row.id] = totalRow;
      if (row.sectionTag) perSection[row.sectionTag] = totalRow;
    }

    const grandTotal = grandTotalId ? (perRow[grandTotalId] ?? { cy: 0, py: 0 }) : { cy: 0, py: 0 };
    return { pattern: "B", grandTotal, perRow, perSection };
  }

  // ── Pattern A aggregation (LT / ST split columns) ─────────────────────
  const perRow:     Record<string, RowTotalsA> = {};
  const perSection: Record<string, RowTotalsA> = {};

  const aggregate = (id: string, seen: Set<string>): RowTotalsA => {
    if (seen.has(id)) return { ltCy: 0, ltPy: 0, stCy: 0, stPy: 0 };
    seen.add(id);
    const v = lookupSuffixed(rawCy, rawPy, id);
    let ltC = v.ltCy, ltP = v.ltPy, stC = v.stCy, stP = v.stPy;
    const hasDescendants = (childrenOf[id] ?? []).length > 0;
    // Same MAHARSH INFRA fix as Pattern B: skip sources when children
    // carry the leaf amounts, preventing double-count.
    const self = crById[id];
    if (!hasDescendants && self?.sources && self.sources.length > 0) {
      for (const x of self.sources) {
        const aC = Number(x?.amountCy) || 0;
        const aP = Number(x?.amountPy) || 0;
        if (x?.column === "st") {
          if ((rawCy[id + "_st"] ?? 0) === 0) stC += aC;
          if ((rawPy[id + "_st"] ?? 0) === 0) stP += aP;
        } else {
          if ((rawCy[id + "_lt"] ?? 0) === 0) ltC += aC;
          if ((rawPy[id + "_lt"] ?? 0) === 0) ltP += aP;
        }
      }
    }
    for (const child of childrenOf[id] ?? []) {
      const r = aggregate(child.id, seen);
      ltC += r.ltCy; ltP += r.ltPy; stC += r.stCy; stP += r.stPy;
    }
    return { ltCy: ltC, ltPy: ltP, stCy: stC, stPy: stP };
  };

  for (const row of config.rows) {
    if (row.isTotal) continue;
    perRow[row.id] = aggregate(row.id, new Set());
  }
  for (const cr of customRows) {
    perRow[cr.id] = aggregate(cr.id, new Set());
  }

  for (const row of config.rows) {
    if (!row.isTotal) continue;
    const adds = row.formulaAdd ?? [];
    const subs = row.formulaSub ?? [];

    let extras: NoteCustomRowLike[] = [];
    if (row.sectionTag) {
      extras = customRows.filter(cr => cr.section === row.sectionTag && !cr.attachedTo);
    } else if (row.id === grandTotalId) {
      extras = customRows.filter(cr => !cr.section && !cr.attachedTo);
    }

    let ltC = 0, ltP = 0, stC = 0, stP = 0;
    for (const id of adds) {
      const v = perRow[id];
      if (v) { ltC += v.ltCy; ltP += v.ltPy; stC += v.stCy; stP += v.stPy; }
      else   {
        // Legacy fallback: bare keys not represented in perRow.
        const f = lookupSuffixed(rawCy, rawPy, id);
        ltC += f.ltCy; ltP += f.ltPy; stC += f.stCy; stP += f.stPy;
      }
    }
    for (const id of subs) {
      const v = perRow[id];
      if (v) { ltC -= v.ltCy; ltP -= v.ltPy; stC -= v.stCy; stP -= v.stPy; }
      else   {
        const f = lookupSuffixed(rawCy, rawPy, id);
        ltC -= f.ltCy; ltP -= f.ltPy; stC -= f.stCy; stP -= f.stPy;
      }
    }
    for (const cr of extras) {
      const r = perRow[cr.id] ?? aggregate(cr.id, new Set());
      ltC += r.ltCy; ltP += r.ltPy; stC += r.stCy; stP += r.stPy;
    }

    const totalRow: RowTotalsA = {
      ltCy: round2(ltC), ltPy: round2(ltP),
      stCy: round2(stC), stPy: round2(stP),
    };
    perRow[row.id] = totalRow;
    if (row.sectionTag) perSection[row.sectionTag] = totalRow;
  }
  // Suppress "isTotalId never read" warning — intentional (kept for parity
  // with computeDisplayData's reverse-search rule should anyone need it).
  void isTotalId;

  const grandTotal = grandTotalId ? (perRow[grandTotalId] ?? { ltCy: 0, ltPy: 0, stCy: 0, stPy: 0 }) : { ltCy: 0, ltPy: 0, stCy: 0, stPy: 0 };
  return { pattern: "A", grandTotal, perRow, perSection };
}
