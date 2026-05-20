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
  fieldLabel?: string | null
): void {
  if (!engagementId) return;
  // 1. Instant localStorage cache
  try { localStorage.setItem(awKey(engagementId, sheet), JSON.stringify(data)); } catch {}
  // 2. Fire-and-forget Supabase upsert + history log
  _pushToSupabase(engagementId, sheet, data, firmId, userId, userName, fieldLabel).catch(() => {});
}

async function _pushToSupabase(
  engagementId: string,
  sheet: string,
  data: unknown,
  firmId?: string | null,
  userId?: string | null,
  userName?: string | null,
  fieldLabel?: string | null
): Promise<void> {
  try {
    const payload: Record<string, unknown> = {
      engagement_id: engagementId,
      [sheet]: data,
      updated_at: new Date().toISOString(),
    };
    if (firmId) payload.firm_id = firmId;
    await (supabase as any)
      .from("audit_worksheet_master")
      .upsert(payload, { onConflict: "engagement_id" });

    // Log to version history (non-fatal)
    // Use fieldLabel if provided for granular tracking (e.g. "Special Attention · Row 3")
    const sectionName = fieldLabel || SHEET_LABELS[sheet] || sheet;
    try {
      await (supabase as any)
        .from("audit_worksheet_history")
        .insert({
          engagement_id:   engagementId,
          section_name:    sectionName,
          changed_by:      userId   ?? null,
          changed_by_name: userName ?? "Unknown",
        });
    } catch {
      // History logging is best-effort — do not let it fail the save
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
