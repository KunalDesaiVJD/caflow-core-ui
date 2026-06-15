/**
 * nceRecomputePYFromShell — amount-only PY (and CY) correction engine.
 *
 * PURPOSE
 *   Recompute each note row's amount from the trial balance CLOSING balances
 *   (PY = PY-shell closing, CY = current closing), keyed to that row's EXISTING
 *   ledger ownership, while leaving the note STRUCTURE (`_custom_rows`,
 *   `attachedTo`, `section`, `source`, `tbDerived`, `userMoved`, hidden rows,
 *   label overrides) byte-for-byte untouched.
 *
 * WHY (root causes this addresses — see MOVETO_DIAGNOSTIC.md + project memory)
 *   • Opening-leak: PY built from prior-year OPENING instead of CLOSING.
 *   • Under-population: PY never filled from the shell (stale/empty).
 *   • Stale: notes frozen; amounts never refreshed after shell re-sync.
 *   It does NOT re-run auto-populate (that destroys manual Move-to placements),
 *   so it is safe to use on the frozen notes.
 *
 * SAFETY
 *   • Pure function. No DB, no side effects. Returns proposed data + a report.
 *   • Only rewrites amounts for rows whose ledger ownership is UNAMBIGUOUS.
 *   • Any ledger owned by >1 row (e.g. SKYLARK grouped parents + individual
 *     rows) or any row whose ledgers can't be resolved is left UNCHANGED and
 *     reported under `flagged` for manual handling — never guessed.
 *   • Rows with no resolvable ledger (hand-typed manual rows) are preserved.
 */
import { signedBalance } from "@/lib/fsSignConvention";

export interface TBRow {
  ledger_name: string;
  closing_balance?: number | null;
  balance_type?: string | null;
}

interface CustomRow {
  id: string;
  label?: string;
  source?: string;
  attachedTo?: string;
  section?: string;
  tbDerived?: boolean;
  userMoved?: boolean;
  sources?: Array<{ ledger?: string; amountCy?: number; amountPy?: number; column?: "lt" | "st" }> | null;
}

export interface NoteRecomputeInput {
  noteType: string;
  cyData: Record<string, any>;          // serialised cy_data (numbers + _meta)
  pyData: Record<string, number>;       // serialised py_data
}

export interface RowChange {
  rowId: string;
  ledgers: string[];
  oldPy: number;
  newPy: number;
  oldCy: number;
  newCy: number;
}

export interface NoteRecomputeResult {
  noteType: string;
  /** Proposed py_data (only unambiguous rows changed; rest preserved). */
  newPyData: Record<string, number>;
  /** Proposed cy_data numeric values (meta keys preserved verbatim). */
  newCyData: Record<string, any>;
  /** Rows whose amount changed (|Δ| > 0.5). */
  changes: RowChange[];
  /** Ledgers owned by more than one row — left untouched, need manual review. */
  duplicateLedgers: Array<{ ledger: string; rows: string[] }>;
  /** True if any ambiguity was found (caller should NOT auto-write this note). */
  hasAmbiguity: boolean;
  /** Pattern-A note (LT/ST) — engine refused to touch it; needs column-aware pass. */
  patternA: boolean;
}

const norm = (s: string | null | undefined) => String(s ?? "").trim().toLowerCase();
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Pattern-A notes store amounts under `${rowId}_lt` / `${rowId}_st` keys (the
 * LT/ST column split), NOT `${rowId}`. Recomputing them requires column-aware
 * attribution which this engine does not yet do — so it REFUSES to touch them
 * (returns patternA=true) rather than write the wrong key. Handled in a
 * follow-up. Pattern-B notes (single amount per rowId) are safe here.
 */
export const PATTERN_A_NOTES = new Set([
  "borrowings", "provisions", "investments", "loans_advances",
]);

/** Build ledger(normalised) -> signed closing for a note's natural side. */
function signedCloseMap(rows: TBRow[], noteType: string): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) {
    const k = norm(r.ledger_name);
    if (!k) continue;
    // last row wins (matches computeCOATotals dedupe)
    m.set(k, signedBalance(r.closing_balance, r.balance_type, noteType));
  }
  return m;
}

/**
 * Reconstruct row -> [ledger] ownership from the saved structure, using only
 * UNAMBIGUOUS encodings:
 *   1. _cy_sources[rowId] = [{ledger}]            (explicit)
 *   2. _custom_rows[].sources = [{ledger}]        (grouped)
 *   3. custom row whose label exactly matches a TB ledger (1:1)
 * Returns the ownership map AND records any ledger claimed by >1 row.
 */
function buildRowOwnership(
  cyData: Record<string, any>,
  shellMap: Map<string, number>,
): { owner: Map<string, string[]>; ledgerRows: Map<string, string[]> } {
  const owner = new Map<string, string[]>();          // rowId -> [ledgerKey]
  const ledgerRows = new Map<string, string[]>();     // ledgerKey -> [rowId]
  const claim = (rowId: string, ledgerKey: string) => {
    if (!ledgerKey) return;
    if (!owner.has(rowId)) owner.set(rowId, []);
    owner.get(rowId)!.push(ledgerKey);
    if (!ledgerRows.has(ledgerKey)) ledgerRows.set(ledgerKey, []);
    ledgerRows.get(ledgerKey)!.push(rowId);
  };

  const cySources = (cyData._cy_sources && typeof cyData._cy_sources === "object")
    ? cyData._cy_sources as Record<string, Array<{ ledger?: string }>> : {};
  for (const [rowId, srcs] of Object.entries(cySources)) {
    for (const s of srcs || []) claim(rowId, norm(s?.ledger));
  }

  const customRows: CustomRow[] = Array.isArray(cyData._custom_rows) ? cyData._custom_rows : [];
  for (const cr of customRows) {
    if (Array.isArray(cr.sources) && cr.sources.length) {
      for (const s of cr.sources) claim(cr.id, norm(s?.ledger));
    } else if (cr.label && shellMap.has(norm(cr.label))) {
      // 1:1 row whose label is a ledger and not already owned via sources
      if (!owner.has(cr.id)) claim(cr.id, norm(cr.label));
    }
  }
  return { owner, ledgerRows };
}

export function recomputeNotePYFromShell(
  input: NoteRecomputeInput,
  cyTb: TBRow[],
  shellTb: TBRow[],
): NoteRecomputeResult {
  const { noteType, cyData, pyData } = input;

  // Refuse Pattern-A notes — their amounts live under _lt/_st keys; touching
  // them with rowId keys would corrupt the note. Return unchanged + flag.
  if (PATTERN_A_NOTES.has(noteType)) {
    return {
      noteType, newPyData: { ...pyData }, newCyData: { ...cyData },
      changes: [], duplicateLedgers: [], hasAmbiguity: false, patternA: true,
    };
  }

  const shellMap = signedCloseMap(shellTb, noteType);
  const cyMap = signedCloseMap(cyTb, noteType);

  const { owner, ledgerRows } = buildRowOwnership(cyData, shellMap);

  const duplicateLedgers: Array<{ ledger: string; rows: string[] }> = [];
  const dupRowIds = new Set<string>();
  for (const [ledger, rows] of ledgerRows) {
    const uniq = Array.from(new Set(rows));
    if (uniq.length > 1) {
      duplicateLedgers.push({ ledger, rows: uniq });
      uniq.forEach(r => dupRowIds.add(r));
    }
  }

  const newPyData: Record<string, number> = { ...pyData };
  const newCyData: Record<string, any> = { ...cyData };
  const changes: RowChange[] = [];

  for (const [rowId, ledgerKeys] of owner) {
    if (dupRowIds.has(rowId)) continue;            // ambiguous — leave untouched
    const uniqLedgers = Array.from(new Set(ledgerKeys));
    let py = 0, cy = 0;
    for (const lk of uniqLedgers) {                // each ledger once
      py += shellMap.get(lk) ?? 0;
      cy += cyMap.get(lk) ?? 0;
    }
    py = round2(py); cy = round2(cy);
    const oldPy = round2(Number(pyData[rowId] ?? 0));
    const oldCy = round2(Number((cyData[rowId] as number) ?? 0));
    if (Math.abs(py - oldPy) > 0.5 || Math.abs(cy - oldCy) > 0.5) {
      changes.push({ rowId, ledgers: uniqLedgers, oldPy, newPy: py, oldCy, newCy: cy });
    }
    newPyData[rowId] = py;
    newCyData[rowId] = cy;
  }

  return {
    noteType,
    newPyData,
    newCyData,
    changes,
    duplicateLedgers,
    hasAmbiguity: duplicateLedgers.length > 0,
    patternA: false,
  };
}
