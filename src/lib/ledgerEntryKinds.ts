/**
 * How a client-ledger row is classified and numbered, shared by every ledger
 * (Ledger tab client / group / firm views and the Report tab's ledger sheet) so a
 * receipt, its TDS and a kasar always appear as separate, consistently named lines.
 *
 * Stored `client_ledger_entries` use entry_type 'receipt', 'adjustment' (TDS and
 * GST TDS are both adjustments, told apart by narration), 'kasar', 'invoice' and
 * 'credit_note'.
 */

export type LedgerEntryKind =
  | "invoice" | "credit_note" | "receipt" | "tds" | "gst_tds" | "kasar" | "adjustment" | "other";

export const LEDGER_KIND_LABEL: Record<LedgerEntryKind, string> = {
  invoice: "Invoice",
  credit_note: "Credit Note",
  receipt: "Receipt",
  tds: "TDS",
  gst_tds: "GST TDS",
  kasar: "Kasar",
  adjustment: "Adjustment",
  other: "Other",
};

export function ledgerEntryKind(entryType?: string | null, narration?: string | null): LedgerEntryKind {
  switch (entryType) {
    case "invoice":
    case "credit_note":
    case "receipt":
    case "kasar":
      return entryType;
    case "adjustment": {
      const n = narration || "";
      if (/gst\s*-?\s*tds/i.test(n)) return "gst_tds";
      if (/\btds\b/i.test(n)) return "tds";
      return "adjustment";
    }
    default:
      return "other";
  }
}

/** Document number of a receipt — also shown on its TDS / GST TDS rows, so they trace back to it. */
export const receiptDocNo = (documentId?: string | null) => (documentId ? `RCT-${documentId.slice(0, 6)}` : "");
export const kasarDocNo = (documentId?: string | null) => (documentId ? `KSR-${documentId.slice(0, 6)}` : "");
