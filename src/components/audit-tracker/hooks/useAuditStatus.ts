/**
 * useAuditStatus
 *
 * CRUD for audit_status rows.
 * Falls back to localStorage when Supabase table doesn't exist yet.
 */
import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface StatusEntry {
  id:                           string;
  firm_id:                      string;
  client_id:                    string | null;
  party_name:                   string | null;
  physical_audit_conducted:     string;   // "Yes" | "No"
  accounting_data:              string;   // "Yes" | "No"
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
  scanned:                      string;   // "Yes" | "No"
  prepared_by:                  string | null;
  checked_by:                   string | null;
  uploaded_by:                  string | null;
  remarks:                      string | null;
  engagement_id:                string | null;
  created_at:                   string;
}

export type StatusPatch = Partial<Omit<StatusEntry, "id"|"firm_id"|"created_at">>;

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

export function useAuditStatus(firmId: string) {
  const [rows,    setRows]    = useState<StatusEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [useLs,   setUseLs]   = useState(false);

  const load = useCallback(async () => {
    if (!firmId) { setLoading(false); return; }
    setLoading(true);

    const { data, error } = await supabase
      .from("audit_status")
      .select("*")
      .eq("firm_id", firmId)
      .order("created_at", { ascending: true });

    if (error) {
      setUseLs(true);
      setRows(lsLoad(firmId));
      setLoading(false);
      return;
    }
    setUseLs(false);
    setRows((data as StatusEntry[]) || []);
    setLoading(false);
  }, [firmId]);

  useEffect(() => { load(); }, [load]);

  async function addRow(input: Omit<StatusEntry, "id"|"firm_id"|"created_at">): Promise<StatusEntry | null> {
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
    const { data, error } = await supabase.from("audit_status").insert(payload).select().single();
    if (error) { toast.error(error.message); return null; }
    toast.success("Row added");
    await load();
    return data as StatusEntry;
  }

  async function updateRow(id: string, patch: StatusPatch) {
    if (useLs) {
      const updated = rows.map(r => r.id === id ? { ...r, ...patch } : r);
      setRows(updated);
      lsSave(firmId, updated);
      toast.success("Saved (offline)");
      return;
    }
    const { error } = await supabase.from("audit_status").update(patch as any).eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success("Saved");
    await load();
  }

  async function removeRow(id: string) {
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
