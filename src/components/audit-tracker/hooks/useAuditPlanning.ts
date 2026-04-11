/**
 * useAuditPlanning
 *
 * CRUD for audit_planning + audit_communication.
 * Falls back to localStorage when Supabase tables don't exist yet.
 */
import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { logChanges } from "./useAuditChangeLog";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PlanEntry {
  id:             string;
  firm_id:        string;
  client_id:      string | null;
  client_name:    string | null;
  planned_from:   string;
  planned_to:     string;
  employee_ids:   string[];
  employee_names: string[];
  created_by:     string | null;
  created_at:     string;
}

export interface CommEntry {
  id:                 string;
  firm_id:            string;
  planning_id:        string | null;
  client_name:        string | null;
  audit_planned_from: string | null;
  audit_planned_to:   string | null;
  contact_person:     string | null;
  contact_no:         string | null;
  remarks:            string | null;
  created_at:         string;
}

// ─── localStorage helpers ────────────────────────────────────────────────────

function lsKey(type: string, firmId: string) { return `at_${type}_${firmId}`; }
function lsLoad<T>(key: string): T[] {
  try { const r = localStorage.getItem(key); return r ? JSON.parse(r) : []; }
  catch { return []; }
}
function lsSave<T>(key: string, data: T[]) {
  localStorage.setItem(key, JSON.stringify(data));
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useAuditPlanning(firmId: string, userId?: string, isSuperadmin?: boolean) {
  const { user } = useAuth();
  const [entries, setEntries] = useState<PlanEntry[]>([]);
  const [comms,   setComms]   = useState<CommEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [useLs,   setUseLs]   = useState(false);   // true = Supabase tables absent

  const load = useCallback(async () => {
    if (!firmId && !isSuperadmin) { setLoading(false); return; }
    setLoading(true);

    let planQ = supabase
      .from("audit_planning")
      .select("*")
      .order("planned_from", { ascending: true });
    if (!isSuperadmin) planQ = planQ.eq("firm_id", firmId);
    const { data: planData, error: planErr } = await planQ;

    if (planErr) {
      // Supabase table doesn't exist — use localStorage
      setUseLs(true);
      setEntries(lsLoad<PlanEntry>(lsKey("planning", firmId)));
      setComms(lsLoad<CommEntry>(lsKey("communication", firmId)));
      setLoading(false);
      return;
    }

    setUseLs(false);
    setEntries((planData as PlanEntry[]) || []);

    let commQ = supabase
      .from("audit_communication")
      .select("*")
      .order("created_at", { ascending: false });
    if (!isSuperadmin) commQ = commQ.eq("firm_id", firmId);
    const { data: commData } = await commQ;
    setComms((commData as CommEntry[]) || []);
    setLoading(false);
  }, [firmId, isSuperadmin]);

  useEffect(() => { load(); }, [load]);

  // ── Planning CRUD ──────────────────────────────────────────────────────────

  async function addEntry(
    input: Pick<PlanEntry, "client_id"|"client_name"|"planned_from"|"planned_to"|"employee_ids"|"employee_names">
  ): Promise<PlanEntry | null> {
    const draft: PlanEntry = {
      ...input,
      id:         crypto.randomUUID(),
      firm_id:    firmId,
      created_by: userId || null,
      created_at: new Date().toISOString(),
    };

    if (useLs) {
      const updated = [...entries, draft];
      setEntries(updated);
      lsSave(lsKey("planning", firmId), updated);

      // Auto-add communication log entry (offline)
      const commDraft: CommEntry = {
        id:                 crypto.randomUUID(),
        firm_id:            firmId,
        planning_id:        draft.id,
        client_name:        input.client_name,
        audit_planned_from: input.planned_from,
        audit_planned_to:   input.planned_to,
        contact_person:     null,
        contact_no:         null,
        remarks:            "Auto-created from Planning Calendar",
        created_at:         new Date().toISOString(),
      };
      const updatedComms = [commDraft, ...comms];
      setComms(updatedComms);
      lsSave(lsKey("communication", firmId), updatedComms);

      toast.success("Plan added (offline)");
      return draft;
    }

    const { data, error } = await supabase
      .from("audit_planning")
      .insert({
        firm_id:        firmId,
        client_id:      input.client_id,
        client_name:    input.client_name,
        planned_from:   input.planned_from,
        planned_to:     input.planned_to,
        employee_ids:   input.employee_ids,
        employee_names: input.employee_names,
        created_by:     userId || null,
      })
      .select()
      .single();

    if (error) { toast.error(error.message); return null; }

    const newEntry = data as PlanEntry;

    // Part B — Auto-insert into communication log (audit_communication)
    await supabase.from("audit_communication").insert({
      firm_id:            firmId,
      planning_id:        newEntry.id,
      client_name:        input.client_name,
      audit_planned_from: input.planned_from,
      audit_planned_to:   input.planned_to,
      remarks:            "Auto-created from Planning Calendar",
    });

    // Part B — Auto-upsert into audit_status as Scheduled
    await supabase.from("audit_status").insert({
      firm_id:                  firmId,
      client_id:                input.client_id,
      party_name:               input.client_name,
      audit_status:             "Scheduled",
      physical_audit_conducted: "No",
      accounting_data:          "No",
      scanned:                  "No",
    });

    // Part C — Notify every assigned employee on their dashboard
    if (input.employee_ids && input.employee_ids.length > 0) {
      const fmt = (d: string) =>
        new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
      const notifications = input.employee_ids.map((uid) => ({
        firm_id: firmId,
        user_id: uid,
        type:    "audit_scheduled",
        title:   `Audit at ${input.client_name ?? "Client"}`,
        message: `You are scheduled for audit at ${input.client_name ?? "Client"} from ${fmt(input.planned_from)} to ${fmt(input.planned_to)}.`,
        link:    "/audit/tracker",
        is_read: false,
      }));
      // Best-effort — table may not exist yet
      try {
        await supabase.from("user_notifications").insert(notifications);
      } catch { /* ignore */ }
    }

    toast.success("Plan added");
    await load();
    return newEntry;
  }

  async function updateEntry(id: string, patch: Partial<PlanEntry>) {
    if (useLs) {
      const updated = entries.map(e => e.id === id ? { ...e, ...patch } : e);
      setEntries(updated);
      lsSave(lsKey("planning", firmId), updated);
      toast.success("Updated (offline)");
      return;
    }
    const oldRow = entries.find(e => e.id === id);
    const { error } = await supabase.from("audit_planning").update(patch as any).eq("id", id);
    if (error) { toast.error(error.message); return; }
    // Log field-level changes into audit_change_log (best-effort)
    if (oldRow) {
      logChanges("audit_planning", id, oldRow as any, patch as any,
        user?.id, user?.name ?? user?.email ?? null);
    }
    toast.success("Updated");
    await load();
  }

  async function removeEntry(id: string) {
    if (useLs) {
      const updatedEntries = entries.filter(e => e.id !== id);
      const updatedComms   = comms.filter(c => c.planning_id !== id);
      setEntries(updatedEntries);
      setComms(updatedComms);
      lsSave(lsKey("planning",      firmId), updatedEntries);
      lsSave(lsKey("communication", firmId), updatedComms);
      return;
    }
    const { error } = await supabase.from("audit_planning").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    await load();
  }

  // ── Communication CRUD ─────────────────────────────────────────────────────

  async function addComm(
    input: Pick<CommEntry, "planning_id"|"client_name"|"audit_planned_from"|"audit_planned_to"|"contact_person"|"contact_no"|"remarks">
  ) {
    const draft: CommEntry = {
      ...input,
      id:         crypto.randomUUID(),
      firm_id:    firmId,
      created_at: new Date().toISOString(),
    };

    if (useLs) {
      const updated = [draft, ...comms];
      setComms(updated);
      lsSave(lsKey("communication", firmId), updated);
      toast.success("Communication logged (offline)");
      return;
    }

    const { error } = await supabase.from("audit_communication").insert({
      firm_id:            firmId,
      planning_id:        input.planning_id,
      client_name:        input.client_name,
      audit_planned_from: input.audit_planned_from,
      audit_planned_to:   input.audit_planned_to,
      contact_person:     input.contact_person,
      contact_no:         input.contact_no,
      remarks:            input.remarks,
    });

    if (error) { toast.error(error.message); return; }
    toast.success("Communication logged");
    await load();
  }

  async function updateComm(id: string, patch: Partial<CommEntry>) {
    if (useLs) {
      const updated = comms.map(c => c.id === id ? { ...c, ...patch } : c);
      setComms(updated);
      lsSave(lsKey("communication", firmId), updated);
      return;
    }
    const oldRow = comms.find(c => c.id === id);
    const { error } = await supabase.from("audit_communication").update(patch as any).eq("id", id);
    if (error) { toast.error(error.message); return; }
    // Log field-level changes into audit_change_log (best-effort)
    if (oldRow) {
      logChanges("audit_communication", id, oldRow as any, patch as any,
        user?.id, user?.name ?? user?.email ?? null);
    }
    await load();
  }

  async function removeComm(id: string) {
    if (useLs) {
      const updated = comms.filter(c => c.id !== id);
      setComms(updated);
      lsSave(lsKey("communication", firmId), updated);
      return;
    }
    const { error } = await supabase.from("audit_communication").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    await load();
  }

  return {
    entries, comms, loading, useLs,
    reload: load,
    addEntry, updateEntry, removeEntry,
    addComm, updateComm, removeComm,
  };
}
