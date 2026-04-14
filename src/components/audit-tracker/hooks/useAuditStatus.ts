/**
 * useAuditStatus
 *
 * CRUD for audit_status rows.
 * - Accepts selectedFY (e.g. "2024-25") to filter rows
 * - Auto-populates virtual rows for audit_engagements that have no status row yet
 * - Falls back to localStorage when Supabase table doesn't exist yet.
 */
import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { logChanges } from "./useAuditChangeLog";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface StatusEntry {
  id:                           string;
  firm_id:                      string;
  client_id:                    string | null;
  party_name:                   string | null;
  physical_audit_conducted:     string;
  accounting_data:              string;
  audit_employees:              string | null;
  audit_report_prepared_by:     string | null;
  audit_status:                 string | null;
  audit_status_other:           string | null;
  report_print_date:            string | null;
  firm:                         string | null;
  partner:                      string | null;
  udin_tax_audit:               string | null;
  udin_statutory_audit:         string | null;
  udin_date:                    string | null;
  physical_report_received_date:string | null;
  scanned:                      string;
  prepared_by:                  string | null;
  checked_by:                   string | null;
  uploaded_by:                  string | null;
  remarks:                      string | null;
  engagement_id:                string | null;
  financial_year:               string | null;
  created_at:                   string;
  // Joined from audit_engagements
  engagement_type?:             string | null;
  /** true = row sourced from audit_engagement with no saved status yet */
  isVirtual?:                   boolean;
}

export type StatusPatch = Partial<Omit<StatusEntry, "id"|"firm_id"|"created_at"|"isVirtual">>;

// ─── localStorage helpers ────────────────────────────────────────────────────

const LS = (firmId: string) => `at_status_${firmId}`;
function lsLoad(firmId: string): StatusEntry[] {
  try { const r = localStorage.getItem(LS(firmId)); return r ? JSON.parse(r) : []; }
  catch { return []; }
}
function lsSave(firmId: string, data: StatusEntry[]) {
  localStorage.setItem(LS(firmId), JSON.stringify(data));
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useAuditStatus(firmId: string, isSuperadmin?: boolean, selectedFY?: string) {
  const { user } = useAuth();
  const [rows,    setRows]    = useState<StatusEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [useLs,   setUseLs]   = useState(false);

  const load = useCallback(async () => {
    if (!firmId && !isSuperadmin) { setLoading(false); return; }
    setLoading(true);

    // ── 1. Fetch actual audit_status rows ──────────────────────────────────
    let q = (supabase as any)
      .from("audit_status")
      .select("*, audit_engagements!left(engagement_type, financial_year, client_id)")
      .order("created_at", { ascending: true });
    if (!isSuperadmin) q = q.eq("firm_id", firmId);

    const { data: rawData, error } = await q;

    if (error) {
      setUseLs(true);
      setRows(lsLoad(firmId));
      setLoading(false);
      return;
    }

    setUseLs(false);

    // Flatten nested engagement fields
    let statusRows: StatusEntry[] = ((rawData as any[]) || []).map(r => ({
      ...r,
      engagement_type: (r.audit_engagements as any)?.engagement_type ?? null,
      financial_year:  r.financial_year ?? (r.audit_engagements as any)?.financial_year ?? null,
    }));

    // ── 2. Filter by selected FY if provided ──────────────────────────────
    if (selectedFY) {
      statusRows = statusRows.filter(r => {
        // Match via own financial_year OR via joined engagement's financial_year
        const engFY = (r as any).audit_engagements?.financial_year;
        return r.financial_year === selectedFY || engFY === selectedFY;
      });
    }

    const engagementIdsWithStatus = new Set(
      statusRows.filter(r => r.engagement_id).map(r => r.engagement_id!)
    );

    // ── 3. Auto-populate virtual rows from audit_engagements ──────────────
    if (selectedFY) {
      let engQ = (supabase as any)
        .from("audit_engagements")
        .select("id, client_id, financial_year, engagement_type")
        .eq("financial_year", selectedFY);
      if (!isSuperadmin) engQ = engQ.eq("firm_id", firmId);
      const { data: engData } = await engQ;

      if (engData?.length) {
        // Fetch client names for the engagement client_ids
        const engClientIds = [...new Set((engData as any[]).map((e: any) => e.client_id).filter(Boolean))];
        const { data: clientsData } = await (supabase as any)
          .from("clients")
          .select("id, name")
          .in("id", engClientIds);
        const clientNameMap = new Map((clientsData || []).map((c: any) => [c.id, c.name]));

        // Create virtual rows for engagements that don't have a status row
        for (const eng of (engData as any[])) {
          if (engagementIdsWithStatus.has(eng.id)) continue;
          const virtualRow: StatusEntry = {
            id:                           `virtual_${eng.id}`,
            firm_id:                      firmId,
            client_id:                    eng.client_id ?? null,
            party_name:                   clientNameMap.get(eng.client_id) ?? null,
            physical_audit_conducted:     "No",
            accounting_data:              "No",
            audit_employees:              null,
            audit_report_prepared_by:     null,
            audit_status:                 null,
            audit_status_other:           null,
            report_print_date:            null,
            firm:                         null,
            partner:                      null,
            udin_tax_audit:               null,
            udin_statutory_audit:         null,
            udin_date:                    null,
            physical_report_received_date:null,
            scanned:                      "No",
            prepared_by:                  null,
            checked_by:                   null,
            uploaded_by:                  null,
            remarks:                      null,
            engagement_id:                eng.id,
            financial_year:               selectedFY,
            created_at:                   "",
            engagement_type:              eng.engagement_type ?? null,
            isVirtual:                    true,
          };
          statusRows.push(virtualRow);
        }
      }
    }

    // Sort: virtual rows last (pending), then alphabetically by party_name
    statusRows.sort((a, b) => {
      if (a.isVirtual && !b.isVirtual) return 1;
      if (!a.isVirtual && b.isVirtual) return -1;
      return (a.party_name || "").localeCompare(b.party_name || "");
    });

    setRows(statusRows);
    setLoading(false);
  }, [firmId, selectedFY]);

  useEffect(() => { load(); }, [load]);

  async function addRow(input: Omit<StatusEntry, "id"|"firm_id"|"created_at"|"isVirtual">): Promise<StatusEntry | null> {
    const draft: StatusEntry = {
      ...input,
      id:         crypto.randomUUID(),
      firm_id:    firmId,
      created_at: new Date().toISOString(),
    };

    if (useLs) {
      const updated = [...rows, draft];
      setRows(updated);
      lsSave(firmId, updated);
      toast.success("Row added (offline)");
      return draft;
    }

    const payload: any = { ...input, firm_id: firmId };
    delete payload.isVirtual;
    delete payload.engagement_type;
    const { data, error } = await supabase.from("audit_status").insert(payload).select().single();
    if (error) { toast.error(error.message); return null; }
    toast.success("Row added");
    await load();
    return data as StatusEntry;
  }

  async function updateRow(id: string, patch: StatusPatch) {
    // If this is a virtual row being saved for the first time
    if (id.startsWith("virtual_")) {
      const virtualRow = rows.find(r => r.id === id);
      if (!virtualRow) return;
      const result = await addRow({
        ...virtualRow,
        ...patch,
        id: undefined as any,
        isVirtual: undefined as any,
      });
      return;
    }

    if (useLs) {
      const updated = rows.map(r => r.id === id ? { ...r, ...patch } : r);
      setRows(updated);
      lsSave(firmId, updated);
      toast.success("Saved (offline)");
      return;
    }

    const oldRow = rows.find(r => r.id === id);
    const cleanPatch: any = { ...patch };
    delete cleanPatch.isVirtual;
    delete cleanPatch.engagement_type;

    const { error } = await supabase.from("audit_status").update(cleanPatch).eq("id", id);
    if (error) { toast.error(error.message); return; }

    if (oldRow) {
      (supabase as any).from("audit_status_history").insert({
        audit_status_id: id,
        changed_by:      user?.id ?? null,
        changed_by_name: user?.name ?? user?.email ?? null,
        previous_data:   oldRow,
        new_data:        { ...oldRow, ...patch },
      }).then(() => {});
      logChanges("audit_status", id, oldRow as any, patch as any, user?.id, user?.name ?? user?.email ?? null);
    }
    toast.success("Saved");
    await load();
  }

  async function removeRow(id: string) {
    if (id.startsWith("virtual_")) {
      setRows(prev => prev.filter(r => r.id !== id));
      return;
    }
    if (useLs) {
      const updated = rows.filter(r => r.id !== id);
      setRows(updated);
      lsSave(firmId, updated);
      return;
    }
    const { error } = await supabase.from("audit_status").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    await load();
  }

  return { rows, loading, useLs, reload: load, addRow, updateRow, removeRow };
}
