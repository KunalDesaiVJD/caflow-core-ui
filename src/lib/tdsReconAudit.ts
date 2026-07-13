import { supabase } from "@/integrations/supabase/client";

/**
 * Append an entry to the TDS filing audit trail (tds_filing_audit_log) for a
 * Validate & Finalise action — chiefly overrides, which must be attributable.
 *
 * Captures WHO (changed_by / changed_by_name), WHEN (changed_at defaults to
 * now()), WHAT changed (old_value → new_value) and WHY (remark = reason). The
 * insert is firm-scoped by RLS (firm_id must be the caller's firm), so pass the
 * filing's firm_id. Failures are swallowed — an audit-log write must never block
 * or reverse the user's actual action.
 */
export async function logReconAudit(opts: {
  filingId?: string | null;
  firmId?: string | null;
  userId?: string | null;
  userName?: string | null;
  actionType: string;
  oldValue?: string | null;
  newValue?: string | null;
  remark?: string | null;
}): Promise<void> {
  if (!opts.filingId) return;
  try {
    await supabase.from("tds_filing_audit_log").insert({
      filing_id: opts.filingId,
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
