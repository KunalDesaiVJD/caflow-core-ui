/**
 * awStorage — Audit Worksheet localStorage persistence helper
 *
 * The `audit_worksheet_master` table has not yet been applied to the remote
 * Supabase project.  Until the migration is run in the Supabase SQL Editor,
 * all worksheet data is kept in localStorage (per browser, per engagement).
 *
 * ─── TO FIX PERMANENTLY ────────────────────────────────────────────────────
 * Go to Supabase Dashboard → SQL Editor → paste and run the two migration
 * files (in order):
 *
 *   supabase/migrations/20260406100000_audit_worksheet_module.sql
 *   supabase/migrations/20260408000030_audit_worksheet_json_columns.sql
 *
 * After that, replace these helpers with Supabase calls and the data will
 * sync across all users/devices automatically.
 * ───────────────────────────────────────────────────────────────────────────
 *
 * Key format:  aws_<engagementId>_<sheet>
 * Example:     aws_abc123_tax_master_json
 */

/** Build the localStorage key for a given engagement + sheet. */
export function awKey(engagementId: string, sheet: string): string {
  return `aws_${engagementId}_${sheet}`;
}

/**
 * Load saved data for an engagement sheet.
 * Returns null if nothing has been saved yet (or parse fails).
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
 * Persist data for an engagement sheet.
 * Silently ignores quota errors (data is not lost, just not persisted).
 */
export function awSave(engagementId: string, sheet: string, data: unknown): void {
  if (!engagementId) return;
  try {
    localStorage.setItem(awKey(engagementId, sheet), JSON.stringify(data));
  } catch {
    /* localStorage quota exceeded — ignore */
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
