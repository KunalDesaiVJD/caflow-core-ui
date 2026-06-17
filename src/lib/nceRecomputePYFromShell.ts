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
import { keyFor } from "@/lib/nceNoteTotals";

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
  /** Informational: this is a Pattern-A (LT/ST split) note. When the engine is
   *  called WITHOUT opts.enablePatternA it still refuses these (changes empty,
   *  data unchanged); with the flag set it recomputes them column-aware. Callers
   *  should gate on `changes`/`hasAmbiguity`, not on this flag. */
  patternA: boolean;
}

const norm = (s: string | null | undefined) => String(s ?? "").trim().toLowerCase();
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Pattern-A notes store amounts under `${rowId}_lt` / `${rowId}_st` keys (the
 * LT/ST column split), NOT `${rowId}`. Recomputing them requires column-aware
 * attribution: the column a row belongs to is encoded in which suffixed key
 * already holds its value (NOT in sources[].column, which is absent on real
 * auto-populated rows). The column-aware path below derives the column from
 * suffix-key presence and writes back via keyFor(rowId, col).
 *
 * This is a STORAGE-side classification keyed by note_type — distinct from
 * columnsFor(config) in nceNoteTotals (config.pattern), which the recompute has
 * no NoteConfig for. The two are intentionally separate.
 *
 * GATING: by default the engine still REFUSES these (returns patternA=true,
 * unchanged) so existing callers are unaffected; pass opts.enablePatternA to
 * opt in to the column-aware recompute. Gated because this engine has no
 * production caller yet — wire it on only after validating against a captured
 * real borrowings/provisions note (mixed LT/ST) with no FsHealthPanel drift.
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
  opts: { enablePatternA?: boolean } = {},
): NoteRecomputeResult {
  const { noteType, cyData, pyData } = input;
  const isPatternA = PATTERN_A_NOTES.has(noteType);

  // Pattern-A notes store amounts under _lt/_st keys. By default still REFUSE
  // them (return patternA=true, unchanged) so existing callers are unaffected.
  // Opt in via opts.enablePatternA for the column-aware recompute below.
  if (isPatternA && !opts.enablePatternA) {
    return {
      noteType, newPyData: { ...pyData }, newCyData: { ...cyData },
      changes: [], duplicateLedgers: [], hasAmbiguity: false, patternA: true,
    };
  }

  const shellMap = signedCloseMap(shellTb, noteType);
  const cyMap = signedCloseMap(cyTb, noteType);

  if (isPatternA) {
    return recomputePatternAFromShell(input, cyMap, shellMap);
  }

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

/**
 * The column(s) a Pattern-A row currently occupies, derived from which suffixed
 * key already holds its value in cyData. A value under `${rowId}_lt` → LT;
 * under `${rowId}_st` → ST; a row can occupy BOTH. When neither suffix key is
 * present (a genuinely new row) fall back to the row's sources[].column,
 * defaulting to "lt".
 *
 * This is the load-bearing fix: the column lives in the KEY SUFFIX, never in
 * sources[].column for real auto rows. Deriving it from sources would default
 * every short-term ledger to LT and silently slide Short-Term Borrowings into
 * Long-Term on the Balance Sheet.
 */
function rowColumns(
  cyData: Record<string, any>,
  rowId: string,
  sourcesCol?: "lt" | "st",
): Array<"lt" | "st"> {
  const cols: Array<"lt" | "st"> = [];
  if (keyFor(rowId, "lt") in cyData) cols.push("lt");
  if (keyFor(rowId, "st") in cyData) cols.push("st");
  if (cols.length === 0) cols.push(sourcesCol ?? "lt");
  return cols;
}

/**
 * Column-aware Pattern-A recompute. Mirrors the Pattern-B engine but attributes
 * each row to its column via suffix-key presence and writes back through
 * keyFor(rowId, col). A ledger owned by >1 row IN THE SAME COLUMN is ambiguous
 * and left untouched; the same ledger split across LT and ST is NOT a duplicate.
 * A row occupying BOTH columns carries a manual LT/ST split the TB closing
 * cannot reproduce, so it is left untouched.
 */
function recomputePatternAFromShell(
  input: NoteRecomputeInput,
  cyMap: Map<string, number>,
  shellMap: Map<string, number>,
): NoteRecomputeResult {
  const { noteType, cyData, pyData } = input;
  const { owner } = buildRowOwnership(cyData, shellMap);
  const customRows: CustomRow[] = Array.isArray(cyData._custom_rows) ? cyData._custom_rows : [];
  const crById = new Map(customRows.map(cr => [cr.id, cr]));

  // Per-row column(s) (from suffix keys) + per-(ledger,column) duplicate detection.
  const rowCols = new Map<string, Array<"lt" | "st">>();
  const ledgerColRows = new Map<string, string[]>();   // `${ledger}::${col}` -> [rowId]
  for (const [rowId, ledgers] of owner) {
    const srcCol = crById.get(rowId)?.sources?.find(s => s?.column)?.column ?? undefined;
    const cols = rowColumns(cyData, rowId, srcCol);
    rowCols.set(rowId, cols);
    for (const lk of new Set(ledgers)) {
      for (const col of cols) {
        const k = `${lk}::${col}`;
        if (!ledgerColRows.has(k)) ledgerColRows.set(k, []);
        ledgerColRows.get(k)!.push(rowId);
      }
    }
  }

  const duplicateLedgers: Array<{ ledger: string; rows: string[] }> = [];
  const dupRowIds = new Set<string>();
  for (const [k, rows] of ledgerColRows) {
    const uniq = Array.from(new Set(rows));
    if (uniq.length > 1) {
      duplicateLedgers.push({ ledger: k.slice(0, k.lastIndexOf("::")), rows: uniq });
      uniq.forEach(r => dupRowIds.add(r));
    }
  }

  const newPyData: Record<string, number> = { ...pyData };
  const newCyData: Record<string, any> = { ...cyData };
  const changes: RowChange[] = [];

  for (const [rowId, ledgers] of owner) {
    if (dupRowIds.has(rowId)) continue;              // ambiguous in some column
    const cols = rowCols.get(rowId)!;
    if (cols.length !== 1) continue;                 // both-column manual split — leave it
    const col = cols[0];
    const uniqLedgers = Array.from(new Set(ledgers));
    let py = 0, cy = 0;
    for (const lk of uniqLedgers) {
      py += shellMap.get(lk) ?? 0;
      cy += cyMap.get(lk) ?? 0;
    }
    py = round2(py); cy = round2(cy);
    const key = keyFor(rowId, col);
    const oldPy = round2(Number(pyData[key] ?? 0));
    const oldCy = round2(Number((cyData[key] as number) ?? 0));
    if (Math.abs(py - oldPy) > 0.5 || Math.abs(cy - oldCy) > 0.5) {
      changes.push({ rowId, ledgers: uniqLedgers, oldPy, newPy: py, oldCy, newCy: cy });
    }
    newPyData[key] = py;
    newCyData[key] = cy;
  }

  return {
    noteType, newPyData, newCyData, changes, duplicateLedgers,
    hasAmbiguity: duplicateLedgers.length > 0, patternA: true,
  };
}
