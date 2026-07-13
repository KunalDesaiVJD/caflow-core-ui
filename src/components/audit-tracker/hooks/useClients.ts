import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface ClientOption {
  id:          string;
  name:        string;
  entity_type: string | null;
  /**
   * Whether tax audit is applicable for this client in the selected FY,
   * sourced from client_fy_audit_setup.tax_audit_applicable. Only populated
   * when the hook is called FY-scoped; otherwise null (caller falls back to
   * engagement_type). Used by the Audit Status grid to lock the 3CA/3CB+3CD
   * columns to "NA" for statutory-only (tax-audit-not-applicable) clients.
   */
  tax_audit_applicable: boolean | null;
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
      // Per-client tax-audit-applicable flag for the selected FY. Only built
      // when FY-scoped (otherwise the flag would be ambiguous across years).
      const taxAuditMap = new Map<string, boolean>();
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
        if (financialYear && r.client_id) {
          taxAuditMap.set(r.client_id as string, !!r.tax_audit_applicable);
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

      // ── Source C: clients with "Audit" classification in client_fy_classifications
      // When the user changes a client's classification FY (e.g. 2026-27 → 2025-26),
      // the handler upserts a client_fy_classifications row for the new FY. Without
      // this source those clients are invisible in FY-scoped dropdowns (Audit Status,
      // Planning Calendar) until an engagement is manually created for them.
      let clsQ: any = (supabase as any)
        .from("client_fy_classifications")
        .select("client_id, classification, firm_id");
      if (financialYear) clsQ = clsQ.eq("financial_year", financialYear);
      if (!isSuperadmin && firmId) clsQ = clsQ.eq("firm_id", firmId);
      const { data: clsRows } = await clsQ;
      const clsClientIds = new Set<string>(
        ((clsRows as any[]) || [])
          .filter(r => (r.classification || "").toLowerCase().includes("audit"))
          .map(r => r.client_id as string)
          .filter(Boolean)
      );

      // 2026-06-25 (V J Desai request v2): Planning + Audit Status dropdowns
      // should surface ONLY clients whose audit ENGAGEMENT has been created
      // for the selected FY — not every client flagged audit-applicable in
      // Advanced Info / classification. Rationale: an engagement is the
      // canonical "we've committed to auditing this client" record; setup
      // flags and classifications are earlier signals that shouldn't
      // pre-populate the tracker.
      //
      // Kept the setup + classification queries above ONLY because they
      // build taxAuditMap (Audit Status uses it to lock the 3CA/3CB columns
      // to "NA" for statutory-only clients). Their client IDs are ignored
      // for the actual client list here.
      void setupClientIds;
      void clsClientIds;
      const clientIds = [...engClientIds];
      if (clientIds.length === 0) {
        setClients([]);
        setLoading(false);
        return;
      }

      // 2026-06-25 (V J Desai — Planning dialog only showed "Leave"):
      // With 689 audit-scoped clients unioned across setup/engagements/
      // classification, .in("id", clientIds) serialises to a ~27 KB URL
      // (689 × ~40 char UUIDs). PostgREST + Supabase Edge drop the request
      // silently at that length, so `data` came back empty and the
      // Planning combobox had nothing to render. Chunk into ~300 IDs per
      // request and merge — same pattern AuditPipeline / Depreciation
      // already use for the same reason.
      const ID_CHUNK = 300;
      const merged: any[] = [];
      for (let i = 0; i < clientIds.length; i += ID_CHUNK) {
        const slice = clientIds.slice(i, i + ID_CHUNK);
        let q: any = supabase
          .from("clients")
          .select("id, name, entity_type")
          .is("deleted_at", null)
          .neq("is_active", false)
          .eq("is_draft", false)
          .in("id", slice)
          .order("name");
        if (!isSuperadmin && firmId) q = q.eq("firm_id", firmId);
        const { data, error } = await q;
        if (error) {
          console.error("[useClients] clients query error (chunk", i, "):", error);
          continue;
        }
        if (Array.isArray(data)) merged.push(...data);
      }
      // Global name sort — each chunk was locally ordered but the union
      // needs a fresh sort so the combobox reads A→Z end-to-end.
      merged.sort((a: any, b: any) => (a.name || "").localeCompare(b.name || ""));

      const withFlags: ClientOption[] = merged.map((c: any) => ({
        id: c.id,
        name: c.name,
        entity_type: c.entity_type ?? null,
        tax_audit_applicable: financialYear && taxAuditMap.has(c.id)
          ? (taxAuditMap.get(c.id) as boolean)
          : null,
      }));
      setClients(withFlags);
      setLoading(false);
    }

    fetchAuditClients();
  }, [firmId, isSuperadmin, financialYear]);

  return { clients, loading };
}
