/**
 * Billing engine feature flags — the Phase 2 "cutover" switches.
 *
 * ALL DEFAULT OFF. Production behaviour is unchanged while these are false.
 * Flip a flag to `true` and redeploy ONLY after a real-data parity check
 * confirms the new path produces identical results to the old one (the same
 * discipline the FS module uses in nceFeatureFlags.ts).
 *
 * Parity check before flipping BILLING_ATOMIC_NUMBERING:
 *   - confirm billing_doc_sequences.last_seq >= MAX(seq_number) for every
 *     (firm, series, FY) in invoices (the migration seeds this; re-verify).
 *   - create a test invoice in a non-critical series and confirm the saved
 *     number = previous max + 1 with no gap/duplicate.
 */

// Allocate the invoice/document sequence number atomically AT SAVE TIME via the
// allocate_doc_number RPC (persistent counter), instead of the race-prone
// MAX()+1 fetched at form load. Prevents concurrent duplicates and post-delete
// number reuse (audit C8).
// ENABLED 2026-06-20 after parity verified (billing_doc_sequences seeded to
// MAX(seq_number) per series; inv/2026-27=47 -> next 48). Revert to false +
// redeploy if invoice creation shows any issue.
export const BILLING_ATOMIC_NUMBERING = true;

// Post receipts (+ TDS / GST-TDS ledger rows) through the transactional
// post_receipt RPC so a receipt and its ledger entries can never be written
// half-way (audit H1). OFF = existing multi-step client-side writes.
// ENABLED 2026-06-20 after parity-verified on prod. Also closes TDS-settled
// invoices correctly (C4). Revert to false + redeploy if any receipt issue.
export const BILLING_RPC_RECEIPT_POSTING = true;
