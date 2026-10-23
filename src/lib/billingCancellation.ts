/**
 * Cancelling an issued invoice or credit note.
 *
 * A cancelled document stays on record with status 'voided' (shown to users
 * as "Cancelled") so its document number stays taken: numbering never goes
 * back (allocate_doc_number's counter only moves forward, and the manual
 * number check still finds the cancelled row). Cancelling removes the
 * document's own ledger row, so it drops out of every client ledger,
 * statement, receivables report and reminder; every report that reads the
 * invoices table already filters to the live statuses.
 *
 * The database enforces the same rules
 * (20261023160000_billing_document_cancellation.sql): it clears the ledger
 * row on cancel, refuses to un-cancel, edit or delete a cancelled document,
 * and refuses new ledger rows or receipts against one.
 */

import { supabase } from "@/integrations/supabase/client";

/** Stored status of a cancelled document. */
export const CANCELLED_STATUS = "voided";

export const CANCELLABLE_DOC_TYPES = ["invoice", "credit_note"];

/** Display label for a stored status ("voided" reads as "Cancelled"). */
export function statusLabel(status: string | null | undefined): string {
  const s = status || "draft";
  if (s === "voided" || s === "cancelled") return "Cancelled";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function isCancelled(status: string | null | undefined): boolean {
  return status === "voided" || status === "cancelled";
}

/**
 * True when the document is an issued invoice / credit note that can be cancelled.
 * Drafts are deleted, not cancelled; they hold no ledger row.
 */
export function canCancelDocument(doc: { document_type?: string | null; status?: string | null }): boolean {
  return CANCELLABLE_DOC_TYPES.includes(doc.document_type || "invoice")
    && !["draft", "voided", "cancelled", "converted"].includes(doc.status || "draft");
}

export interface CancelResult { ok: boolean; title?: string; description?: string }

export async function cancelBillingDocument(
  doc: { id: string; document_type?: string | null; status?: string | null },
  reason: string,
): Promise<CancelResult> {
  if (!canCancelDocument(doc)) {
    return { ok: false, title: "Cannot cancel", description: "Only issued invoices and credit notes can be cancelled." };
  }
  if (!reason.trim()) {
    return { ok: false, title: "Reason required", description: "Enter why this document is being cancelled." };
  }

  // Money already received against the document must be dealt with first,
  // or the receipt would be left pointing at a cancelled invoice.
  const [{ count: receiptCount }, { count: kasarCount }] = await Promise.all([
    supabase.from("billing_receipts").select("id", { count: "exact", head: true }).eq("invoice_id", doc.id),
    supabase.from("billing_kasars").select("id", { count: "exact", head: true }).eq("invoice_id", doc.id),
  ]);
  if ((receiptCount || 0) + (kasarCount || 0) > 0) {
    return {
      ok: false,
      title: "Cannot cancel — payments exist",
      description: `This document has ${receiptCount || 0} receipt(s) and ${kasarCount || 0} kasar entr${kasarCount === 1 ? "y" : "ies"} recorded against it. Delete or reallocate those first.`,
    };
  }

  const { data: updated, error } = await supabase.from("invoices")
    .update({ status: CANCELLED_STATUS, voided_reason: reason.trim() })
    .eq("id", doc.id)
    .neq("status", CANCELLED_STATUS)
    .select("id");
  if (error) return { ok: false, title: "Could not cancel document", description: error.message };
  if (!updated || updated.length === 0) {
    return { ok: false, title: "Could not cancel document", description: "The document was not found or is already cancelled." };
  }

  // The database trigger also clears these; doing it here keeps the ledger
  // right even before that migration is applied.
  const { error: ledgerErr } = await supabase.from("client_ledger_entries")
    .delete()
    .eq("document_id", doc.id)
    .in("entry_type", ["invoice", "credit_note"]);
  if (ledgerErr) {
    return {
      ok: false,
      title: "Cancelled, but the ledger entry was not removed",
      description: `${ledgerErr.message}. Open the client ledger and check this document's entry.`,
    };
  }
  return { ok: true };
}
