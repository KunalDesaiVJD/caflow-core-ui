/**
 * Due date of an invoice = invoice date + its payment terms (days).
 *
 * Invoices used to store `payment_due_days` but never `due_date`, so overdue
 * status, ageing and payment reminders (all keyed on due_date) ignored them.
 * Everything that needs a due date goes through this one function.
 */
export function dueDateFromTerms(invoiceDate?: string | null, days?: number | null): string | null {
  if (!invoiceDate || days == null || !Number.isFinite(Number(days)) || Number(days) < 0) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(invoiceDate);
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] + Math.floor(Number(days))));
  return d.toISOString().slice(0, 10);
}

/** The stored due date, or the one derived from the invoice's own terms. */
export function effectiveDueDate(inv: { due_date?: string | null; invoice_date?: string | null; payment_due_days?: number | null }): string | null {
  return inv.due_date || dueDateFromTerms(inv.invoice_date, inv.payment_due_days);
}
