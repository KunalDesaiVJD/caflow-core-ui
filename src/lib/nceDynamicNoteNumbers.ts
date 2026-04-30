/**
 * nceDynamicNoteNumbers
 * ---------------------
 * Computes DYNAMIC, sequential note numbers for NCE (Non-Corporate Entity)
 * financial statements.
 *
 * Rules:
 *  1. A note is "active" if its corresponding NCE FS line item(s) have a
 *     non-zero CY or PY amount, OR if it is always-active (Acct Policies,
 *     Capital Account, PPE).
 *  2. Active notes are sorted by their ORIGINAL (static) noteRef and assigned
 *     sequential integers starting at 1.
 *  3. Inactive notes (zero CY + zero PY) are excluded — they get no number
 *     in both the FS display and the Notes tab headings.
 *
 * This file is the SINGLE source of truth for NCE dynamic note numbers.
 * Both PipelineFinancialStatements (FS display) and NCEDetailedNotes
 * (Notes tab headings) must consume the same map so the numbers are always
 * in sync across tabs.
 */

import { NCE_FS_ITEMS, type FSLineItem } from "@/config/nceLineItems";
import { NOTE_META } from "@/config/nceNotesConfig";

// ── Internal helpers ─────────────────────────────────────────────────────────

/** Recursively flatten NCE_FS_ITEMS to leaf nodes that carry a noteRef. */
function flattenLeaves(items: FSLineItem[]): { code: string; noteRef: number }[] {
  const result: { code: string; noteRef: number }[] = [];
  function visit(item: FSLineItem) {
    if (item.noteRef !== null && item.noteRef !== undefined && !item.children) {
      result.push({ code: item.code, noteRef: item.noteRef });
    }
    item.children?.forEach(visit);
  }
  items.forEach(visit);
  return result;
}

/** Cached leaf list — computed once at module load, not per render. */
const NCE_LEAF_ITEMS = flattenLeaves(NCE_FS_ITEMS);

/**
 * Note refs that are ALWAYS considered active, regardless of FS amounts.
 *   1  = Accounting Policies (BS footnote — no FS line item)
 *   2  = Capital Account     (NCECapitalAccount component)
 *   10 = PPE                 (NCEPPESchedule component)
 */
const ALWAYS_ACTIVE = new Set<number>([1, 2, 10]);

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Compute a dynamic note number map for NCE.
 *
 * @param computedAmounts  CY FS amounts keyed by FSLineItem.code
 * @param mergedPY         PY FS amounts keyed by FSLineItem.code
 * @returns Map<originalNoteRef, dynamicNoteNo>
 *
 * Notes whose every leaf has rawCy === 0 AND rawPy === 0 are omitted from
 * the map.  Calling code should treat `map.get(ref) ?? ""` as the display
 * value — undefined means "suppressed".
 */
export function computeNceDynamicNoteMap(
  computedAmounts: Record<string, number>,
  mergedPY:        Record<string, number>,
): Map<number, number> {
  // Step 1 — collect active noteRefs from FS amounts
  const activeRefs = new Set<number>(ALWAYS_ACTIVE);

  for (const { code, noteRef } of NCE_LEAF_ITEMS) {
    const cy = computedAmounts[code] ?? 0;
    const py = mergedPY[code] ?? 0;
    if (cy !== 0 || py !== 0) {
      activeRefs.add(noteRef);
    }
  }

  // Step 2 — sort and assign sequential numbers 1, 2, 3, …
  const sorted = [...activeRefs].sort((a, b) => a - b);
  const map = new Map<number, number>();
  sorted.forEach((ref, idx) => map.set(ref, idx + 1));

  return map;
}

/**
 * Return the dynamic display string for a NOTES_CONFIG entry.
 *
 * For compound refs like "3 & 6" (borrowings) or "5 & 9" (provisions),
 * returns "N & M" using dynamic numbers for both refs.  If neither ref is
 * active, returns null (note should be shown without a number).
 *
 * @param noteType    NOTES_CONFIG.noteType string
 * @param dynamicMap  Result of computeNceDynamicNoteMap()
 */
export function getDynamicNoteDisplay(
  noteType:   string,
  dynamicMap: Map<number, number>,
): string | null {
  const meta = NOTE_META[noteType];
  if (!meta) return null;

  // Parse static refs from strings like "3 & 6" or "5 & 9"
  const staticRefs = meta.noteNumber
    .split(/\s*[&,]\s*/)
    .map(s => parseInt(s.trim(), 10))
    .filter(n => !isNaN(n));

  const dynamicNos = staticRefs
    .map(ref  => dynamicMap.get(ref))
    .filter((n): n is number => n !== undefined);

  if (dynamicNos.length === 0) return null;
  return dynamicNos.join(" & ");
}
