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

/**
 * Persist data:
 *  1. Synchronous localStorage write (instant UI feedback)
 *  2. Async Supabase upsert (fire-and-forget, cross-device sync)
 *
 * firmId is required on first write to populate audit_worksheet_master.firm_id.
 * Subsequent writes without firmId still update the sheet column.
 */
export function awSave(
  engagementId: string,
  sheet: string,
  data: unknown,
  firmId?: string | null
): void {
  if (!engagementId) return;
  // 1. Instant localStorage cache
  try { localStorage.setItem(awKey(engagementId, sheet), JSON.stringify(data)); } catch {}
  // 2. Fire-and-forget Supabase upsert
  _pushToSupabase(engagementId, sheet, data, firmId).catch(() => {});
}

async function _pushToSupabase(
  engagementId: string,
  sheet: string,
  data: unknown,
  firmId?: string | null
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
