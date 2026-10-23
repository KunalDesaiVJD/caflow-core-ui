import { describe, it, expect, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { canCancelDocument, isCancelled, statusLabel } from "./billingCancellation";

describe("billing document cancellation rules", () => {
  it("cancels only issued invoices and credit notes", () => {
    expect(canCancelDocument({ document_type: "invoice", status: "sent" })).toBe(true);
    expect(canCancelDocument({ document_type: "credit_note", status: "finalized" })).toBe(true);
    expect(canCancelDocument({ document_type: "invoice", status: "paid" })).toBe(true);
    expect(canCancelDocument({ document_type: "invoice", status: "draft" })).toBe(false);
    expect(canCancelDocument({ document_type: "invoice", status: null })).toBe(false);
    expect(canCancelDocument({ document_type: "invoice", status: "voided" })).toBe(false);
    expect(canCancelDocument({ document_type: "quotation", status: "finalized" })).toBe(false);
    expect(canCancelDocument({ document_type: "proforma", status: "sent" })).toBe(false);
  });

  it("shows the stored 'voided' status as Cancelled", () => {
    expect(statusLabel("voided")).toBe("Cancelled");
    expect(statusLabel("overdue")).toBe("Overdue");
    expect(statusLabel(null)).toBe("Draft");
    expect(isCancelled("voided")).toBe(true);
    expect(isCancelled("paid")).toBe(false);
  });
});
