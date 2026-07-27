import { supabase } from "@/integrations/supabase/client";

/**
 * Append an entry to the Rate Master audit trail (tds_rate_master_audit_log).
 *
 * tds_rate_master rows are FIRM-scoped configuration (firm_id IS NULL for a
 * global default, or a specific firm's override otherwise) — they are not
 * tied to any single tds_filings row. logReconAudit()/tds_filing_audit_log
 * (src/lib/tdsReconAudit.ts) is filing-scoped by design: it early-returns
 * without a filingId, and every reader of that table (the Stage-4 checker
 * review, TdsAuditLog.tsx) keys off filing_id to show client/quarter/FY
 * context. A Rate Master edit has no natural filing_id to attribute it to,
 * so it gets its own small table instead of a fabricated/null filing_id —
 * same pattern the codebase already uses for scrutiny_rule_audit.
 *
 * Fire-and-forget / best-effort, mirroring logReconAudit(): failures are
 * swallowed and must never block or reverse the user's actual save.
 */
export async function logRateMasterAudit(opts: {
  rateMasterId?: string | null;
  firmId?: string | null;
  userId?: string | null;
  userName?: string | null;
  actionType: string;
  oldValue?: string | null;
  newValue?: string | null;
  remark?: string | null;
}): Promise<void> {
  try {
    // tds_rate_master_audit_log isn't in the generated Supabase types yet
    // (types.ts is regenerated via the Supabase CLI only, per CLAUDE.md) —
    // same `as any` tolerance already used elsewhere for tables/RPCs a full
    // `supabase gen types` run hasn't caught up with.
    await (supabase.from as any)("tds_rate_master_audit_log").insert({
      rate_master_id: opts.rateMasterId ?? null,
      firm_id: opts.firmId ?? null,
      action_type: opts.actionType,
      old_value: opts.oldValue ? String(opts.oldValue).slice(0, 2000) : null,
      new_value: opts.newValue ? String(opts.newValue).slice(0, 2000) : null,
      changed_by: opts.userId ?? null,
      changed_by_name: opts.userName ?? null,
      remark: opts.remark ? String(opts.remark).slice(0, 2000) : null,
    });
  } catch {
    /* audit logging must never block or reverse the user's action */
  }
}
