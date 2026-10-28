/**
 * notification_log types that belong to billing. The Billing → Email Settings →
 * Email Log shows only these — audit, TDS, onboarding and other modules write to
 * the same table but are not billing activity.
 */
export const BILLING_LOG_TYPES = [
  "invoice_generated", "quotation_sent", "proforma_sent", "credit_note_issued",
  "payment_reminder", "ledger_statement", "internal_filing_reminder",
] as const;
