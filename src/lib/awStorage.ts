/**
 * awStorage — Audit Worksheet persistence helper
 *
 * Stores data in BOTH localStorage (instant / offline) and Supabase
 * (cross-device / cross-user sync).
 *
 * The `audit_worksheet_master` table has one row per engagement.
 * All JSON columns (worksheet_json, tax_master_json, …) are stored there.
 *
 * Key format for localStorage: aws_<engagementId>_<sheet>
 */

import { supabase } from "@/integrations/supabase/client";

/** Build the localStorage cache key. */
export function awKey(engagementId: string, sheet: string): string {
  return `aws_${engagementId}_${sheet}`;
}

/**
 * Write to localStorage ONLY — no Supabase round-trip. Use inside setField
 * to keep the on-disk cache in lock-step with every keystroke, so PDF/Excel
 * exports never read a stale value due to the 1-second auto-save debounce.
 */
export function awCacheOnly(engagementId: string, sheet: string, data: unknown): void {
  if (!engagementId) return;
  try { localStorage.setItem(awKey(engagementId, sheet), JSON.stringify(data)); } catch {}
}

/**
 * Read from localStorage (synchronous, instant).
 * Returns null if nothing saved or parse fails.
 */
export function awLoad<T>(engagementId: string, sheet: string): T | null {
  if (!engagementId) return null;
  try {
    const raw = localStorage.getItem(awKey(engagementId, sheet));
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

/**
 * Read from Supabase (async, cross-device).
 * Also caches the result in localStorage as a side-effect.
 */
export async function awLoadFromDB<T>(
  engagementId: string,
  sheet: string
): Promise<T | null> {
  if (!engagementId) return null;
  try {
    const { data, error } = await (supabase as any)
      .from("audit_worksheet_master")
      .select(sheet)
      .eq("engagement_id", engagementId)
      .maybeSingle();
    if (error || !data || data[sheet] == null) return null;
    const value = data[sheet] as T;
    // Cache locally for next instant load
    try { localStorage.setItem(awKey(engagementId, sheet), JSON.stringify(value)); } catch {}
    return value;
  } catch {
    return null;
  }
}

// Human-readable section labels for version history
const SHEET_LABELS: Record<string, string> = {
  worksheet_json:        "Audit Worksheet",
  tax_master_json:       "Tax Audit Master",
  int_master_json:       "Internal Audit Master",
  statutory_master_json: "Statutory Audit Master",
  special_attention_json:"Special Attention",
  checklist_sheet_json:  "Checklist",
  query_sheet_json:      "Query Sheet",
};

/**
 * Persist data:
 *  1. Synchronous localStorage write (instant UI feedback)
 *  2. Async Supabase upsert (fire-and-forget, cross-device sync)
 *  3. Async insert to audit_worksheet_history (version history)
 *
 * firmId is required on first write to populate audit_worksheet_master.firm_id.
 * Subsequent writes without firmId still update the sheet column.
 */
/**
 * Persist data to localStorage + Supabase.
 *
 * @param fieldLabel  Optional human-readable label for the specific field/row
 *                    that changed (e.g. "Special Attention · Row 3").
 *                    When provided it is stored as `section_name` in the history
 *                    log instead of the generic sheet label.
 */
export function awSave(
  engagementId: string,
  sheet: string,
  data: unknown,
  firmId?: string | null,
  userId?: string | null,
  userName?: string | null,
  fieldLabel?: string | null,
  prevSnapshot?: unknown,
): void {
  if (!engagementId) return;
  // 1. Instant localStorage cache
  try { localStorage.setItem(awKey(engagementId, sheet), JSON.stringify(data)); } catch {}
  // 2. Fire-and-forget Supabase safe-merge + field-level history log
  _pushToSupabase(engagementId, sheet, data, firmId, userId, userName, fieldLabel, prevSnapshot).catch(() => {});
}

/** Stringify a value for the history table's old_value/new_value columns,
 *  truncated so a single huge field can't blow up the row size. */
function _toHistoryValue(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v === "string") return v.slice(0, 2000);
  try {
    const s = JSON.stringify(v);
    return s.length > 2000 ? s.slice(0, 2000) + "…" : s;
  } catch { return null; }
}

async function _pushToSupabase(
  engagementId: string,
  sheet: string,
  data: unknown,
  firmId?: string | null,
  userId?: string | null,
  userName?: string | null,
  fieldLabel?: string | null,
  prevSnapshot?: unknown,
): Promise<void> {
  try {
    // ─────────────────────────────────────────────────────────────────────
    // BULLETPROOF SAVE (June 2026):
    //
    // Problem the old code had:
    //   Every save sent the WHOLE state object to Supabase, REPLACING the
    //   entire JSON column. If two users edited the same engagement, or if a
    //   stale tab auto-saved after a fresh tab saved newer data, the empty
    //   fields from one snapshot would silently overwrite real values from
    //   the other. The team saw fields they thought they had filled
    //   "disappear" between sessions.
    //
    // New behavior (when caller passes prevSnapshot):
    //   1. Fetch the current state from the DB at save-time.
    //   2. Compute the per-field diff: ONLY the keys the user actually changed
    //      since they loaded the form (current value !== previous snapshot).
    //   3. Merged payload = current DB state + ONLY the user's changed keys.
    //      Fields the user didn't touch this session are left alone, even if
    //      some other tab/user just updated them. No data loss possible.
    //   4. Save the merged result.
    //   5. Insert ONE audit_worksheet_history row PER changed field, with
    //      field_name / old_value / new_value populated — so the team can
    //      forensically reconstruct who typed what, when. Previously every
    //      history row had NULL diffs which made the audit trail useless.
    //
    // Backward compat: when prevSnapshot is not supplied (legacy callers,
    // first-ever save, non-object data like arrays), we fall back to the old
    // whole-object save with a single section-level history row.
    // ─────────────────────────────────────────────────────────────────────

    const hasPrev =
      prevSnapshot !== undefined &&
      prevSnapshot !== null &&
      typeof prevSnapshot === "object" &&
      !Array.isArray(prevSnapshot) &&
      typeof data === "object" &&
      data !== null &&
      !Array.isArray(data);

    let finalValue: unknown = data;
    const diffs: { field: string; oldDbV: unknown; newV: unknown }[] = [];

    if (hasPrev) {
      const prev = prevSnapshot as Record<string, unknown>;
      const next = data as Record<string, unknown>;

      // Fetch current DB snapshot for a safe merge.
      let dbState: Record<string, unknown> = {};
      try {
        const { data: row } = await (supabase as any)
          .from("audit_worksheet_master")
          .select(sheet)
          .eq("engagement_id", engagementId)
          .maybeSingle();
        const v = row?.[sheet];
        if (v && typeof v === "object" && !Array.isArray(v)) dbState = v;
      } catch {
        // Network glitch — fall back to using `next` as-is (best effort).
      }

      const merged: Record<string, unknown> = { ...dbState };
      // For each key the user *actually changed since load*, overwrite the DB
      // state. Untouched fields are left alone — so a stale tab can't blank
      // them out even if it happens to fire a debounced save.
      const keys = new Set<string>([...Object.keys(next), ...Object.keys(prev)]);
      for (const key of keys) {
        const newV = next[key];
        const prevV = prev[key];
        const changed = JSON.stringify(newV) !== JSON.stringify(prevV);
        if (changed) {
          merged[key] = newV;
          diffs.push({ field: key, oldDbV: dbState[key], newV });
        }
      }

      // ── L3/L11 FIX (2026-06-04) — granular Checklist `rows` merge ──────
      //
      // For most sheets a single top-level key (`rows`) holding the entire
      // grid is fine because the safe-merge above protects the OTHER top-
      // level keys (e.g. `dynamicRowIds`). But for `checklist_sheet_json`,
      // `rows` is also where files[] arrays live — and concurrent file
      // uploads from two users / two tabs that flush around the same time
      // would otherwise have the later writer's whole `rows` object win,
      // erasing the earlier writer's file reference (the Storage object
      // would survive in the bucket as an unlinked orphan).
      //
      // Fix: when the sheet is checklist_sheet_json AND the `rows` key was
      // marked changed above, replace the simple overwrite of `rows` with
      // a per-rowId merge:
      //   • If the row only exists in next OR only in dbState → keep as-is
      //   • If both contain it: per-field merge with files[] specifically
      //     unioned by file_path (preserves both users' uploads).
      // Other per-row fields fall through to the existing
      //   "user typed it since load" → win
      //   otherwise               → keep DB state
      // rule, mirroring the top-level safe-merge.
      if (sheet === "checklist_sheet_json" &&
          diffs.some(d => d.field === "rows") &&
          merged.rows && typeof merged.rows === "object" && !Array.isArray(merged.rows)) {
        const dbRows = (dbState.rows && typeof dbState.rows === "object") ? dbState.rows as Record<string, any> : {};
        const prevRows = (prev.rows && typeof prev.rows === "object") ? prev.rows as Record<string, any> : {};
        const nextRows = (next.rows && typeof next.rows === "object") ? next.rows as Record<string, any> : {};

        const mergedRows: Record<string, any> = { ...dbRows };
        const allRowIds = new Set<string>([
          ...Object.keys(dbRows),
          ...Object.keys(prevRows),
          ...Object.keys(nextRows),
        ]);
        for (const rowId of allRowIds) {
          const dbRow   = dbRows[rowId];
          const prevRow = prevRows[rowId];
          const nextRow = nextRows[rowId];
          // Per-field decision: prefer user's typed-since-load value;
          // otherwise keep DB. Files: union by file_path so both
          // concurrent uploads survive.
          if (!nextRow && !dbRow) continue;
          if (!nextRow && dbRow) { mergedRows[rowId] = dbRow; continue; }
          if (nextRow && !dbRow) { mergedRows[rowId] = nextRow; continue; }
          const out: Record<string, any> = { ...dbRow };
          const fieldKeys = new Set<string>([...Object.keys(nextRow), ...Object.keys(prevRow || {})]);
          for (const f of fieldKeys) {
            if (f === "files") {
              // Union by file_path. Empty/missing arrays treated as [].
              const dbFiles   = Array.isArray(dbRow.files)   ? dbRow.files   : [];
              const nextFiles = Array.isArray(nextRow.files) ? nextRow.files : [];
              const prevFiles = Array.isArray(prevRow?.files) ? prevRow.files : [];
              // Files removed by THIS user (in prev but not in next).
              const removedByMe = new Set(prevFiles
                .filter((f: any) => !nextFiles.some((nf: any) => nf?.file_path === f?.file_path))
                .map((f: any) => f?.file_path));
              // Union: dbFiles minus removedByMe, then add any nextFiles
              // not already present.
              const seen = new Set<string>();
              const unioned: any[] = [];
              for (const file of dbFiles) {
                if (!file?.file_path || removedByMe.has(file.file_path)) continue;
                seen.add(file.file_path);
                unioned.push(file);
              }
              for (const file of nextFiles) {
                if (!file?.file_path || seen.has(file.file_path)) continue;
                seen.add(file.file_path);
                unioned.push(file);
              }
              out.files = unioned;
              continue;
            }
            // Non-file fields: typed-since-load wins; else keep DB.
            const wasChanged = JSON.stringify(nextRow[f]) !== JSON.stringify((prevRow ?? {})[f]);
            if (wasChanged) out[f] = nextRow[f];
            else if (f in dbRow) out[f] = dbRow[f];
            else out[f] = nextRow[f];
          }
          mergedRows[rowId] = out;
        }
        merged.rows = mergedRows;
      }

      finalValue = merged;
    }

    const payload: Record<string, unknown> = {
      engagement_id: engagementId,
      [sheet]: finalValue,
      updated_at: new Date().toISOString(),
    };
    if (firmId) payload.firm_id = firmId;
    await (supabase as any)
      .from("audit_worksheet_master")
      .upsert(payload, { onConflict: "engagement_id" });

    // Log to version history (non-fatal). Use fieldLabel for granular tracking
    // (e.g. "Special Attention · Row 3").
    const sectionName = fieldLabel || SHEET_LABELS[sheet] || sheet;
    try {
      if (hasPrev && diffs.length > 0) {
        // One row per changed field — gives forensic "who typed what" history.
        const rows = diffs.map(d => ({
          engagement_id:   engagementId,
          section_name:    sectionName,
          field_name:      d.field,
          old_value:       _toHistoryValue(d.oldDbV),
          new_value:       _toHistoryValue(d.newV),
          changed_by:      userId   ?? null,
          changed_by_name: userName ?? "Unknown",
        }));
        await (supabase as any).from("audit_worksheet_history").insert(rows);
      } else if (!hasPrev) {
        // Back-compat: legacy single section-level event row.
        await (supabase as any)
          .from("audit_worksheet_history")
          .insert({
            engagement_id:   engagementId,
            section_name:    sectionName,
            changed_by:      userId   ?? null,
            changed_by_name: userName ?? "Unknown",
          });
      }
      // hasPrev && diffs.length === 0 → no actual changes; skip history (no noise).
    } catch {
      // History logging is best-effort — do not let it fail the save.
    }
  } catch {
    // Silently fail — localStorage is the offline fallback
  }
}

/** Remove all locally-stored data for a given engagement. */
export function awClear(engagementId: string): void {
  if (!engagementId) return;
  const prefix = `aws_${engagementId}_`;
  Object.keys(localStorage)
    .filter(k => k.startsWith(prefix))
    .forEach(k => localStorage.removeItem(k));
}
