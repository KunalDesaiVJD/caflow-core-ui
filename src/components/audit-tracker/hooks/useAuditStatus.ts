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
  audit_report_checked_by:      string | null;
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

    // Filter out audit_status rows whose client has been archived (deleted_at set)
    if (statusRows.length) {
      const sIds = [...new Set(statusRows.map(r => r.client_id).filter(Boolean))] as string[];
      if (sIds.length) {
        const { data: activeClients } = await (supabase as any)
          .from("clients")
          .select("id")
          .in("id", sIds)
          .eq("is_draft", false)
          .is("deleted_at", null);
        const activeIdSet = new Set((activeClients || []).map((c: any) => c.id));
        statusRows = statusRows.filter(r => !r.client_id || activeIdSet.has(r.client_id));
      }
    }

    // ── 2. Filter by selected FY if provided ──────────────────────────────
    if (selectedFY) {
      statusRows = statusRows.filter(r => {
        // Match via own financial_year OR via joined engagement's financial_year
        const engFY = (r as any).audit_engagements?.financial_year;
        return r.financial_year === selectedFY || engFY === selectedFY;
      });
    }

    // Dedup real status rows: if the same client has multiple rows for this FY,
    // keep only one per client — prefer the row with an engagement_id, then the
    // most recently created one. This prevents duplicate rows in the grid.
    {
      const seenRealClientIds = new Set<string>();
      // Sort so rows with engagement_id come first, then by created_at desc
      statusRows.sort((a, b) => {
        const aHasEng = a.engagement_id ? 1 : 0;
        const bHasEng = b.engagement_id ? 1 : 0;
        if (aHasEng !== bHasEng) return bHasEng - aHasEng; // engagement rows first
        return (b.created_at || "").localeCompare(a.created_at || ""); // newest first
      });
      statusRows = statusRows.filter(r => {
        if (!r.client_id) return true; // keep rows without a client_id
        if (seenRealClientIds.has(r.client_id)) return false;
        seenRealClientIds.add(r.client_id);
        return true;
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
    // Also build a client_id → { firm, partner } map from the most recent
    // engagement, so we can backfill firm/partner on existing status rows.
    const engagementInfoByClient = new Map<string, { firm: string | null; partner: string | null }>();
    if (selectedFY) {
      let engQ = (supabase as any)
        .from("audit_engagements")
        // NOTE: partner_name is stored directly on the engagement (the dialog saves it as text).
        // partner_id FK is also stored when available — we use whichever is populated.
        .select("id, client_id, financial_year, audit_type, audit_firm_id, partner_id, partner_name, status")
        .eq("financial_year", selectedFY)
        .neq("status", "archived")
        .or("is_py_shell.is.null,is_py_shell.eq.false"); // exclude PY shell engagements
      if (!isSuperadmin) engQ = engQ.eq("firm_id", firmId);
      const { data: engData } = await engQ;

      if (engData?.length) {
        // Fetch client names + active filter
        const engClientIds = [...new Set((engData as any[]).map((e: any) => e.client_id).filter(Boolean))];
        const { data: clientsData } = await (supabase as any)
          .from("clients")
          .select("id, name, is_draft, deleted_at")
          .in("id", engClientIds);
        const clientNameMap = new Map(
          (clientsData || [])
            .filter((c: any) => c.is_draft === false && !c.deleted_at)
            .map((c: any) => [c.id, c.name])
        );

        // Resolve audit firm names (always via FK)
        // Resolve partner names: prefer partner_id → users.name; fall back to partner_name text field
        const firmIds    = [...new Set((engData as any[]).map((e: any) => e.audit_firm_id).filter(Boolean))];
        const partnerIds = [...new Set((engData as any[]).map((e: any) => e.partner_id).filter(Boolean))];
        const [{ data: firmRows }, { data: partnerRows }] = await Promise.all([
          firmIds.length
            ? (supabase as any).from("audit_firms").select("id, name").in("id", firmIds)
            : Promise.resolve({ data: [] }),
          partnerIds.length
            ? (supabase as any).from("users").select("id, name").in("id", partnerIds)
            : Promise.resolve({ data: [] }),
        ]);
        const firmNameMap    = new Map((firmRows    || []).map((f: any) => [f.id, f.name]));
        const partnerNameMap = new Map((partnerRows || []).map((p: any) => [p.id, p.name]));

        // Build engagementInfoByClient (one entry per client — first eng wins).
        // Partner resolution chain:
        //   1. partner_id → users table (most reliable, available when set)
        //   2. partner_name text column (used when dialog only stored the name, not the FK)
        for (const eng of (engData as any[])) {
          if (!eng.client_id || engagementInfoByClient.has(eng.client_id)) continue;
          const resolvedPartner =
            (partnerNameMap.get(eng.partner_id) as string | undefined) ??
            (eng.partner_name as string | null | undefined) ??
            null;
          engagementInfoByClient.set(eng.client_id, {
            firm:    (firmNameMap.get(eng.audit_firm_id) as string | undefined) ?? null,
            partner: resolvedPartner,
          });
        }

        // Create at most ONE virtual row per client (dedup engagement duplicates).
        // Skip if the client already has a real row, or already has a virtual row
        // we just created in this loop.
        const seenVirtualClientIds = new Set<string>();
        for (const eng of (engData as any[])) {
          if (engagementIdsWithStatus.has(eng.id)) continue;
          if (clientIdsWithStatus.has(eng.client_id)) continue;
          if (seenVirtualClientIds.has(eng.client_id)) continue;
          if (!clientNameMap.has(eng.client_id)) continue;     // client archived → skip
          seenVirtualClientIds.add(eng.client_id);

          const info = engagementInfoByClient.get(eng.client_id);
          const virtualRow: StatusEntry = {
            id:                           `virtual_${eng.id}`,
            firm_id:                      firmId,
            client_id:                    eng.client_id ?? null,
            party_name:                   clientNameMap.get(eng.client_id) ?? null,
            physical_audit_conducted:     "No",
            accounting_data:              "No",
            audit_employees:              null,
            audit_report_prepared_by:     null,
            audit_report_checked_by:      null,
            audit_status:                 null,
            audit_status_other:           null,
            report_print_date:            null,
            firm:                         info?.firm    ?? null,
            partner:                      info?.partner ?? null,
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

    // Backfill firm/partner on existing real rows that are missing them
    statusRows = statusRows.map(r => {
      if (!r.client_id || (r.firm && r.partner)) return r;
      const info = engagementInfoByClient.get(r.client_id);
      if (!info) return r;
      return {
        ...r,
        firm:    r.firm    || info.firm    || null,
        partner: r.partner || info.partner || null,
      };
    });

    // ── 4. Auto-populate virtual rows from audit_planning ─────────────────
    // Safety net: if addEntry auto-create failed, or if a planning entry was
    // created before the auto-create feature, show a placeholder row so the
    // client always appears in the grid.
    if (selectedFY) {
      // Convert "YYYY-YY" → date range  (e.g. "2025-26" → 2025-04-01 … 2026-03-31)
      const [fyStartYearStr] = selectedFY.split("-");
      const fyStartYear = Number(fyStartYearStr);
      const fyDateStart = `${fyStartYear}-04-01`;
      const fyDateEnd   = `${fyStartYear + 1}-03-31`;

      // Two separate queries:
      // (A) Broad query — ALL planning entries for the firm, no date filter.
      //     Used ONLY for employee-name backfill so staff names always appear
      //     even if planned_from is slightly outside the FY boundary.
      // (B) FY-scoped query — date-filtered entries used for creating virtual rows.
      // Issue 3: leaves must NEVER influence audit status / employee aggregates.
      // Filter at source — both DB-level (`is_leave=false`) and client-side
      // legacy fallback (case-insensitive client_name !== 'leave') for any
      // pre-migration row that wasn't backfilled.
      let planAllQ = (supabase as any)
        .from("audit_planning")
        .select("id, client_id, client_name, planned_from, planned_to, employee_names, is_leave")
        .or("is_leave.is.null,is_leave.eq.false");
      if (!isSuperadmin) planAllQ = planAllQ.eq("firm_id", firmId);
      const { data: planAllDataRaw } = await planAllQ;
      const planAllData = ((planAllDataRaw as any[]) || []).filter(
        (p: any) => (p.client_name || "").trim().toLowerCase() !== "leave"
      );

      // FY-scoped subset (for virtual row creation)
      const planData = ((planAllData as any[]) || []).filter((p: any) => {
        if (!p.planned_from) return false;
        return p.planned_from >= fyDateStart && p.planned_from <= fyDateEnd;
      });

      // Build lookup: client_id → aggregated unique employee names.
      // Uses ALL planning entries (planAllData, no date filter) so staff names
      // are always found even when planned_from is slightly outside the FY boundary.
      // Also keep the first FY-scoped entry per client for date metadata on virtual rows.
      const empByClient  = new Map<string, string>();  // client_id → "Jay, Umang, Yatin"
      const planByClient = new Map<string, any>();     // client_id → first FY-scoped plan entry

      // Pass 1 — aggregate employee names from ALL planning entries (broad)
      for (const plan of ((planAllData as any[]) || [])) {
        if (!plan.client_id) continue;
        const names: string[] = Array.isArray(plan.employee_names)
          ? (plan.employee_names as string[]).filter(Boolean)
          : [];
        if (names.length) {
          const existing = empByClient.get(plan.client_id);
          const merged   = existing ? existing + ", " + names.join(", ") : names.join(", ");
          empByClient.set(plan.client_id, merged);
        }
      }
      // Pass 2 — keep first FY-scoped entry per client for virtual-row metadata
      for (const plan of (planData || [])) {
        if (!plan.client_id) continue;
        if (!planByClient.has(plan.client_id)) planByClient.set(plan.client_id, plan);
      }
      // Deduplicate employee names per client (same person may appear in multiple visits)
      for (const [cid, raw] of empByClient) {
        const unique = [...new Set(raw.split(", ").map((n: string) => n.trim()).filter(Boolean))].join(", ");
        empByClient.set(cid, unique);
      }

      // Backfill audit_employees on ALL rows (always refresh from planning so
      // the latest staff assignments are shown — even if the row was saved earlier)
      statusRows = statusRows.map(r => {
        if (!r.client_id) return r;
        const empNames = empByClient.get(r.client_id) ?? null;
        // Only overwrite if planning has actual data, so manual edits survive
        // when no planning entries exist for this client
        if (!empNames) return r;
        return { ...r, audit_employees: empNames };
      });

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
          audit_employees:              empByClient.get(plan.client_id) ?? (
                                          Array.isArray(plan.employee_names)
                                            ? (plan.employee_names as string[]).filter(Boolean).join(", ") || null
                                            : (plan.employee_names ?? null)
                                        ),
          audit_report_prepared_by:     null,
          audit_report_checked_by:      null,
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

    // Issue 3 defence-in-depth: drop any row whose party_name still reads
    // "Leave" (case-insensitive). Such rows are personal time-off and must
    // never appear in the audit-status grid. The migration purged historical
    // rows, but this guard prevents any stragglers from surfacing.
    statusRows = statusRows.filter(
      r => (r.party_name || "").trim().toLowerCase() !== "leave"
    );

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

    const payload: any = normalizeDates({ ...input, firm_id: firmId });
    // Strip virtual / computed fields that are not DB columns
    delete payload.id;
    delete payload.isVirtual;
    delete payload.isPlanning;
    delete payload.engagement_type;
    delete payload.planned_from;
    delete payload.planned_to;
    delete payload.created_at;     // let DB default to now()
    const { data, error } = await supabase.from("audit_status").insert(payload).select().single();
    if (error) { toast.error(error.message); return null; }
    toast.success("Row added");
    await load();
    return data as StatusEntry;
  }

  // Date/timestamp columns on `audit_status` — empty strings from cleared
  // <input type="date"> fields would crash PostgREST with
  //   "invalid input syntax for type timestamp with time zone: ''"
  // so we coerce "" → null before any insert/update.
  const DATE_COLS = new Set([
    'report_print_date',
    'udin_date',
    'physical_report_received_date',
    'planned_from',
    'planned_to',
  ]);
  function normalizeDates<T extends Record<string, any>>(obj: T): T {
    const out: any = { ...obj };
    for (const k of Object.keys(out)) {
      if (DATE_COLS.has(k) && (out[k] === '' || out[k] === undefined)) {
        out[k] = null;
      }
    }
    return out as T;
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
    const cleanPatch: any = normalizeDates({ ...patch });
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
