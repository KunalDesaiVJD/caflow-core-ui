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
  /** true = row sourced from audit_planning (no engagement exists yet) */
  isPlanning?:                  boolean;
  /** Planned dates from audit_planning entry — displayed in the row */
  planned_from?:                string | null;
  planned_to?:                  string | null;
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
      .select("*, audit_engagements!left(audit_type, financial_year, client_id)")
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
      // audit_engagements column is audit_type (not engagement_type)
      engagement_type: (r.audit_engagements as any)?.audit_type ?? null,
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
    // Also track client_ids that already have a real status row for this FY
    // so we don't create a duplicate virtual row when addEntry auto-creates a
    // status row without an engagement_id.
    const clientIdsWithStatus = new Set(
      statusRows.filter(r => r.client_id).map(r => r.client_id!)
    );

    // ── 3. Auto-populate virtual rows from audit_engagements ──────────────
    if (selectedFY) {
      let engQ = (supabase as any)
        .from("audit_engagements")
        .select("id, client_id, financial_year, audit_type")
        .eq("financial_year", selectedFY)
        .neq("status", "archived");
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

        // Create virtual rows for engagements that don't have a status row.
        // Skip if the client already has a real row for this FY (e.g. auto-created
        // by planning calendar without engagement_id).
        for (const eng of (engData as any[])) {
          if (engagementIdsWithStatus.has(eng.id)) continue;
          if (clientIdsWithStatus.has(eng.client_id)) continue;
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
            engagement_type:              eng.audit_type ?? null,
            isVirtual:                    true,
          };
          statusRows.push(virtualRow);
        }
      }
    }

    // ── 4. Auto-populate virtual rows from audit_planning ─────────────────
    // Safety net: if addEntry auto-create failed, or if a planning entry was
    // created before the auto-create feature, show a placeholder row so the
    // client always appears in the grid.
    if (selectedFY) {
      // Convert "YYYY-YY" → date range  (e.g. "2026-27" → 2026-04-01 … 2027-03-31)
      const [fyStartYearStr] = selectedFY.split("-");
      const fyStartYear = Number(fyStartYearStr);
      const fyDateStart = `${fyStartYear}-04-01`;
      const fyDateEnd   = `${fyStartYear + 1}-03-31`;

      let planQ = (supabase as any)
        .from("audit_planning")
        .select("id, client_id, client_name, planned_from, planned_to, employee_names")
        .gte("planned_from", fyDateStart)
        .lte("planned_from", fyDateEnd);
      if (!isSuperadmin) planQ = planQ.eq("firm_id", firmId);
      const { data: planData } = await planQ;

      // Refresh the set — may have grown after step 3
      const allKnownClientIds = new Set([
        ...clientIdsWithStatus,
        ...statusRows.filter(r => r.client_id).map(r => r.client_id!),
      ]);

      for (const plan of ((planData as any[]) || [])) {
        if (!plan.client_id) continue;
        if (allKnownClientIds.has(plan.client_id)) continue;   // already in grid

        const planningRow: StatusEntry = {
          id:                           `planning_${plan.id}`,
          firm_id:                      firmId,
          client_id:                    plan.client_id ?? null,
          party_name:                   plan.client_name ?? null,
          physical_audit_conducted:     "No",
          accounting_data:              "No",
          audit_employees:              Array.isArray(plan.employee_names)
                                          ? (plan.employee_names as string[]).join(", ")
                                          : (plan.employee_names ?? null),
          audit_report_prepared_by:     null,
          audit_status:                 "Scheduled",
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
          engagement_id:                null,
          financial_year:               selectedFY,
          created_at:                   "",
          engagement_type:              null,
          isVirtual:                    true,
          isPlanning:                   true,
          planned_from:                 plan.planned_from ?? null,
          planned_to:                   plan.planned_to   ?? null,
        };
        statusRows.push(planningRow);
        allKnownClientIds.add(plan.client_id);  // prevent duplicates within same loop
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
    // If this is a virtual row (from engagement or planning) being saved for the first time
    if (id.startsWith("virtual_") || id.startsWith("planning_")) {
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
    if (id.startsWith("virtual_") || id.startsWith("planning_")) {
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
