import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface ClientOption {
  id:          string;
  name:        string;
  entity_type: string | null;
}

/**
 * Source of audit-applicable clients for the Audit Tracker dropdowns.
 *
 * Issue 2 (dropdown missing clients): the previous implementation only
 * surfaced clients that already had a row in `audit_engagements`. That
 * excluded clients who were freshly flagged audit-applicable for the
 * selected FY in Edit Client → Audit Setup but hadn't yet had an
 * engagement created. Result: such clients couldn't be picked in
 * Planning or Audit Status, blocking the very first audit booking.
 *
 * Fix: union the two sources that signal "this client is in scope for
 * audit work in FY X":
 *   (a) `client_fy_audit_setup` rows where any of statutory/tax/CARO/
 *       internal/stock applicable = true for the selected FY.
 *   (b) `audit_engagements` rows that are not archived AND not PY shells.
 *       (PY shells are auto-created comparative-period engagements; they
 *        don't represent a separate client booking.)
 *
 * When `financialYear` is undefined we fall back to the union across ALL
 * FYs — used by callers that aren't FY-scoped (e.g. the planning calendar
 * combobox, where assigning a planned visit to a client should always be
 * possible regardless of which FY's audit setup is filled in).
 */
export function useClients(
  firmId: string,
  isSuperadmin?: boolean,
  financialYear?: string | null,
) {
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!firmId && !isSuperadmin) return;
    setLoading(true);

    async function fetchAuditClients() {
      // ── Source A: clients flagged audit-applicable in client_fy_audit_setup
      let setupQ: any = supabase
        .from("client_fy_audit_setup")
        .select("client_id,financial_year,statutory_audit_applicable,tax_audit_applicable,caro_applicable,internal_audit_applicable,stock_audit_applicable");
      if (financialYear) setupQ = setupQ.eq("financial_year", financialYear);
      const { data: setupRows, error: setupErr } = await setupQ;
      if (setupErr) console.error("[useClients] audit-setup query error:", setupErr);

      const setupClientIds = new Set<string>();
      for (const r of (setupRows as any[]) || []) {
        if (
          r.statutory_audit_applicable ||
          r.tax_audit_applicable ||
          r.caro_applicable ||
          r.internal_audit_applicable ||
          r.stock_audit_applicable
        ) {
          if (r.client_id) setupClientIds.add(r.client_id as string);
        }
      }

      // ── Source B: clients with any active audit engagement
      let engQ: any = supabase
        .from("audit_engagements")
        .select("client_id, financial_year")
        .neq("status", "archived")
        .or("is_py_shell.is.null,is_py_shell.eq.false");
      if (!isSuperadmin && firmId) engQ = engQ.eq("firm_id", firmId);
      if (financialYear) engQ = engQ.eq("financial_year", financialYear);
      const { data: engRows, error: engErr } = await engQ;
      if (engErr) console.error("[useClients] engagements query error:", engErr);

      const engClientIds = new Set<string>(
        ((engRows as any[]) || []).map(e => e.client_id as string).filter(Boolean)
      );

      // ── Union & fetch the actual client rows
      const clientIds = [...new Set([...setupClientIds, ...engClientIds])];
      if (clientIds.length === 0) {
        setClients([]);
        setLoading(false);
        return;
      }

      let q: any = supabase
        .from("clients")
        .select("id, name, entity_type")
        .is("deleted_at", null)
        .eq("is_draft", false)
        .in("id", clientIds)
        .order("name");
      if (!isSuperadmin && firmId) q = q.eq("firm_id", firmId);
      const { data, error } = await q;
      if (error) console.error("[useClients] clients query error:", error);
      setClients((data as ClientOption[]) || []);
      setLoading(false);
    }

    fetchAuditClients();
  }, [firmId, isSuperadmin, financialYear]);

  return { clients, loading };
}
