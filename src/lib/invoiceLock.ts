/**
 * Billing period lock.
 *
 * A firm that sets `firms.settings.invoice_lock_day` (e.g. 20) closes each
 * month on that day of the FOLLOWING month: September invoices can no longer
 * be edited or deleted after 20 October. Superadmins are exempt.
 *
 * Applies to tax invoices and credit notes only (the GST documents). The same
 * rule is enforced in the database by the invoices_period_lock trigger
 * (20261021140000_invoice_period_lock.sql) — this module keeps the UI in step
 * with it so users see "locked" instead of a failed save.
 */

export const LOCKABLE_DOC_TYPES = ["invoice", "credit_note"];

/** Lock day for a firm, from its settings JSON; null when the firm has no lock. */
export function firmLockDay(settings: unknown): number | null {
  const v = (settings as Record<string, unknown> | null)?.invoice_lock_day;
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isInteger(n) && n >= 1 && n <= 28 ? n : null;
}

/** Today's date in India as YYYY-MM-DD. */
function todayIST(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

/** Last date (YYYY-MM-DD) on which a document dated `docDate` may still be changed. */
export function lockDeadline(docDate: string, lockDay: number): string {
  const [y, m] = docDate.slice(0, 10).split("-").map(Number);
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  return `${ny}-${String(nm).padStart(2, "0")}-${String(lockDay).padStart(2, "0")}`;
}

/** True when a document dated `docDate` falls in a closed period. */
export function isPeriodLocked(docDate: string | null | undefined, lockDay: number | null): boolean {
  if (!docDate || !lockDay) return false;
  return todayIST() > lockDeadline(docDate, lockDay);
}

/** Human message for a locked document, e.g. "September 2026 closed on 20 Oct 2026". */
export function lockMessage(docDate: string, lockDay: number): string {
  const d = new Date(docDate.slice(0, 10) + "T00:00:00");
  const month = d.toLocaleDateString("en-IN", { month: "long", year: "numeric" });
  const dl = new Date(lockDeadline(docDate, lockDay) + "T00:00:00");
  const deadline = dl.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  return `${month} was closed on ${deadline}. Only a superadmin can change or delete documents in a closed month.`;
}
