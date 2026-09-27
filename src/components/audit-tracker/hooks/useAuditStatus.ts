/**
 * useAuditStatus
 *
 * CRUD for audit_status rows.
 * - Accepts selectedFY (e.g. "2024-25") to filter rows
 * - Auto-populates virtual rows for audit_engagements that have no status row yet
 * - Falls back to localStorage when Supabase table doesn't exist yet.
 */
import { useState, useEffect, useCallback, useRef } from "react";
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
  upload_date:                  string | null;
  remarks:                      string | null;
  /** Free-text detail when remarks === "Others" — mirrors audit_status_other. */
  remarks_other:                string | null;
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

// ── Shadow store for fields whose DB columns don't exist yet ────────────────
// When the DB schema is missing a column the UI writes (e.g.
// audit_report_checked_by before its migration is applied), PostgREST
// rejects the entire update — the auditor sees "Saved" but the field
// silently vanishes on refresh.
//
// To prevent that silent data loss, the defensive save in updateRow/addRow
// now also mirrors any DROPPED fields into a per-firm shadow store keyed by
// row id. On load() we merge the shadow data back into each row, so the
// field appears populated in the UI even though the DB column is missing.
// This is a stopgap until the migration is applied — once the column
// exists, real saves succeed and the shadow store stays in sync.
const SHADOW = (firmId: string) => `at_status_shadow_${firmId}`;
type ShadowMap = Record<string, Record<string, any>>; // rowId → { col: value }
function shadowLoad(firmId: string): ShadowMap {
  try { const r = localStorage.getItem(SHADOW(firmId)); return r ? JSON.parse(r) : {}; }
  catch { return {}; }
}
function shadowSaveRow(firmId: string, rowId: string, fields: Record<string, any>) {
  const all = shadowLoad(firmId);
  all[rowId] = { ...(all[rowId] || {}), ...fields };
  try { localStorage.setItem(SHADOW(firmId), JSON.stringify(all)); } catch { /* private mode */ }
}
function shadowDeleteRow(firmId: string, rowId: string) {
  const all = shadowLoad(firmId);
  if (rowId in all) {
    delete all[rowId];
    try { localStorage.setItem(SHADOW(firmId), JSON.stringify(all)); } catch { /* private mode */ }
  }
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useAuditStatus(firmId: string, isSuperadmin?: boolean, selectedFY?: string) {
  const { user } = useAuth();
  const [rows,    setRows]    = useState<StatusEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [useLs,   setUseLs]   = useState(false);
  // 2026-09-27 — every autosave ends by calling load() to refetch. Showing
  // the full Skeleton-row loading state on THAT refetch (not just the very
  // first paint) collapsed the table to 6 short placeholder rows and back,
  // which snapped the scroll container to the top on every single edit —
  // "sent back to the start" on autosave. Only the true first load (or a
  // load after an error/empty state) should show the skeleton; every
  // subsequent refetch keeps rendering the existing rows in place while
  // fresh data loads in the background, so scroll position never moves.
  // The autosave mechanism itself (debounce/PATCH/retry) is untouched —
  // this flag only controls whether the loading skeleton renders.
  const hasLoadedRef = useRef(false);

  const load = useCallback(async () => {
    if (!firmId && !isSuperadmin) { setLoading(false); return; }
    if (!hasLoadedRef.current) setLoading(true);

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
      hasLoadedRef.current = true;
      return;
    }

    setUseLs(false);

    // 2026-06-25 (V J Desai — Krishna Infra bug): engagements are HARD-
    // deleted from audit_engagements (AuditIntelligence.tsx L501: DELETE …
    // WHERE id = eid), but the audit_status row's engagement_id column is
    // not FK-cascaded, so a dangling reference stays behind and the row
    // keeps rendering in the tracker grid. The LEFT JOIN returns
    // audit_engagements=null in that case — that's our signal. If a row
    // was TIED to an engagement (engagement_id set) and the join returned
    // null, the engagement is gone → drop the row from the grid.
    // Rows with engagement_id=null are unaffected (standalone manual rows).
    const rawRows = (rawData as any[]) || [];
    let statusRows: StatusEntry[] = rawRows
      .filter(r => !(r.engagement_id && !r.audit_engagements))
      .map(r => ({
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

      // 2026-06-25 (V J Desai — Krishna Infra bug part 2): the earlier
      // LEFT-JOIN filter only catches rows whose engagement_id was set at
      // the time. But when the engagements page hard-deletes an engagement,
      // the corresponding audit_status row often has engagement_id=null
      // (either because the row pre-dated the FK, or because a prior
      // migration nulled it). Result: dangling audit_status rows survive
      // even after every engagement for (client_id, FY) is gone.
      //
      // Fix: hide any audit_status row for the selected FY whose client
      // has ZERO active engagements for that FY. Standalone manual rows
      // (client_id=null) stay visible. This also retroactively hides the
      // 2 other client rows the auditor deleted.
      const engagementClientIds = statusRows.length
        ? await (async () => {
            let engQ = (supabase as any)
              .from("audit_engagements")
              .select("client_id")
              .eq("financial_year", selectedFY)
              .neq("status", "archived")
              .or("is_py_shell.is.null,is_py_shell.eq.false");
            if (!isSuperadmin) engQ = engQ.eq("firm_id", firmId);
            const { data } = await engQ;
            return new Set(((data as any[]) || []).map(e => e.client_id).filter(Boolean));
          })()
        : new Set<string>();
      statusRows = statusRows.filter(r => !r.client_id || engagementClientIds.has(r.client_id));
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

        // Resolve audit firm names. Issue 3 (CAFlow_FirmFix_Report): an
        // engagement's audit firm id can point at EITHER the legacy
        // `audit_firms` table OR the `firms` table (post-`is_audit_firm`
        // rollout — the Stage 1 dropdown is a UNION of the two). Querying
        // only `audit_firms` left engagements assigned to a firms-table
        // audit firm (e.g. "Akta Ramani & Associates") with `firm = null`,
        // so the tracker fell back to the stale stored row value (often
        // "V.J. Desai" from a much earlier creation).
        const allFirmIds = [
          ...new Set(
            (engData as any[]).flatMap((e: any) => [e.audit_firm_id, e.firm_id]).filter(Boolean),
          ),
        ];
        const partnerIds = [...new Set((engData as any[]).map((e: any) => e.partner_id).filter(Boolean))];
        const [{ data: afRows }, { data: fRows }, { data: partnerRows }] = await Promise.all([
          allFirmIds.length
            ? (supabase as any).from("audit_firms").select("id, name").in("id", allFirmIds)
            : Promise.resolve({ data: [] }),
          allFirmIds.length
            ? (supabase as any).from("firms").select("id, name, display_name").in("id", allFirmIds)
            : Promise.resolve({ data: [] }),
          partnerIds.length
            ? (supabase as any).from("users").select("id, name").in("id", partnerIds)
            : Promise.resolve({ data: [] }),
        ]);
        // Merge both tables into a single id→name map. `firms` wins if both
        // tables happen to share the same id (extremely unlikely but defensive).
        const firmNameMap = new Map<string, string>();
        for (const f of (afRows || []) as any[]) firmNameMap.set(f.id, f.name);
        for (const f of (fRows  || []) as any[]) firmNameMap.set(f.id, f.display_name || f.name);
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
          // Issue 3: try audit_firm_id first, then firm_id (the canonical
          // column every downstream consumer reads via firms-table lookup).
          const resolvedFirm =
            (firmNameMap.get(eng.audit_firm_id) as string | undefined) ??
            (firmNameMap.get((eng as any).firm_id) as string | undefined) ??
            null;
          engagementInfoByClient.set(eng.client_id, {
            firm:    resolvedFirm,
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
            upload_date:                  null,
            remarks:                      null,
            remarks_other:                null,
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

    // Backfill firm/partner on existing real rows.
    // Issue 3 fix: when an engagement exists for the client+FY, prefer the
    // engagement-derived firm/partner over the row's stored values. Stored
    // values can be stale — e.g. the row was created when the client was
    // assigned to V.J. Desai, the user later switched the engagement to
    // Akta Ramani, but the audit-status row kept the old name forever.
    // We still preserve r.firm / r.partner when no engagement exists
    // (manually-entered standalone status rows are unaffected).
    statusRows = statusRows.map(r => {
      if (!r.client_id) return r;
      const info = engagementInfoByClient.get(r.client_id);
      if (!info) return r;
      return {
        ...r,
        firm:    info.firm    ?? r.firm    ?? null,
        partner: info.partner ?? r.partner ?? null,
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
          upload_date:                  null,
          remarks:                      null,
          remarks_other:                null,
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

    // Merge shadow-store fields (data the UI saved when its DB column was
    // missing). For each real row id, fields stored in localStorage override
    // the DB row's null/empty values so the auditor's input doesn't appear
    // to vanish on refresh. Untouched rows pass through unchanged.
    const shadow = shadowLoad(firmId);
    if (Object.keys(shadow).length > 0) {
      statusRows = statusRows.map(r => {
        const sh = shadow[r.id];
        if (!sh) return r;
        return { ...r, ...sh };
      });
    }

    setRows(statusRows);
    setLoading(false);
    hasLoadedRef.current = true;
  }, [firmId, selectedFY]);

  // A genuine context switch (different firm or FY) is a real "start over" —
  // that should still show the initial-load skeleton, same as today. Only
  // an autosave-triggered reload WITHIN the same firm+FY should skip it.
  useEffect(() => { hasLoadedRef.current = false; }, [firmId, selectedFY]);

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

    // Defensive insert — see comment in updateRow. Same problem applies when
    // saving a virtual row for the first time: an unknown column in the
    // payload makes PostgREST drop EVERYTHING. We retry without unknown
    // columns and surface a clear toast naming the skipped fields.
    let attemptPayload: any = { ...payload };
    const skippedFields: Record<string, any> = {};
    let lastError: any = null;
    let data: any = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      const res = await supabase.from("audit_status").insert(attemptPayload).select().single();
      if (!res.error) { data = res.data; lastError = null; break; }
      lastError = res.error;
      const msg = String(res.error.message || "");
      const m = msg.match(/column ["']?([a-zA-Z0-9_]+)["']?/i)
            ?? msg.match(/find the ["']?([a-zA-Z0-9_]+)["']? column/i);
      const bad = m?.[1];
      if (!bad || !(bad in attemptPayload)) break;
      skippedFields[bad] = attemptPayload[bad];
      delete attemptPayload[bad];
      if (Object.keys(attemptPayload).length === 0) break;
    }
    if (lastError) { toast.error(lastError.message); return null; }
    const skipped = Object.keys(skippedFields);
    if (skipped.length > 0 && data?.id) {
      // Mirror dropped fields to the shadow store keyed by the new row's
      // real id, so the data survives a page refresh even without the DB
      // column. See updateRow + load() merge logic for the read side.
      shadowSaveRow(firmId, data.id, skippedFields);
      toast.warning(
        `Row added — ${skipped.length} field${skipped.length > 1 ? "s" : ""} kept locally only (column missing in DB): ${skipped.join(", ")}. Ask your admin to apply the latest DB migration for full persistence.`,
        { duration: 6000 },
      );
    } else {
      toast.success("Row added");
    }
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
    'upload_date',
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

    // Defensive save (Issue 3 root-cause partial fix):
    // The audit_status table may not yet have every column the UI writes
    // (e.g. audit_report_checked_by — migration 20260516120000 not yet
    // applied to the remote DB, or the PostgREST schema cache is stale).
    // PostgREST returns a "column ... does not exist" / "Could not find
    // the X column in the schema cache" error and REJECTS THE WHOLE patch
    // — every other field the auditor typed gets lost too, which appears
    // to the user as "save worked but data was deleted on refresh".
    //
    // Strategy: try the full patch first; if PostgREST reports an unknown
    // column, surgically drop that one field and retry. Loop a few times
    // so multiple unknown columns can be stripped in one go. The auditor
    // gets a toast with the column names that were skipped so they (or
    // the firm admin) can apply the missing migration to restore those
    // fields' persistence.
    let attemptPatch: any = { ...cleanPatch };
    const skippedFields: Record<string, any> = {};
    let lastError: any = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      // .select() so an RLS silent-deny (PostgREST returns { error: null,
      // data: [] } when WITH CHECK / USING evaluates false) surfaces as a
      // visible failure instead of a fake "Saved" toast that reverts on
      // refresh. Previously this masked the firm_members_audit_status RLS
      // bug for staff users (see migration 20260625130000).
      const { data: updated, error: err } = await supabase
        .from("audit_status")
        .update(attemptPatch)
        .eq("id", id)
        .select();
      if (!err) {
        if (!updated || updated.length === 0) {
          lastError = new Error("Update affected 0 rows — likely RLS policy block. Check Supabase logs.");
          break;
        }
        lastError = null;
        break;
      }
      lastError = err;
      // PostgREST formats: "column \"foo\" of relation ..." or
      // "Could not find the 'foo' column of 'audit_status' in the schema cache".
      const msg = String(err.message || "");
      // ORDER MATTERS: the "Could not find the 'X' column of 'audit_status'"
      // message from PostgREST's schema-cache miss contains BOTH "column of"
      // AND "column" tokens — the bare "column X" regex incorrectly matched
      // the table name "audit_status" instead of the missing column. Match
      // the more specific "find the X column" / "X column of Y" patterns
      // FIRST. Also covers "column \"foo\" of relation \"audit_status\"".
      const m = msg.match(/find the ["']?([a-zA-Z0-9_]+)["']? column/i)
            ?? msg.match(/column ["']?([a-zA-Z0-9_]+)["']? of (?:relation |the )?["']?(?:audit_status|[a-zA-Z_]+)["']?/i)
            ?? msg.match(/['"]([a-zA-Z0-9_]+)['"] column/i)
            ?? msg.match(/column ["']?([a-zA-Z0-9_]+)["']?/i);
      const bad = m?.[1];
      if (!bad || !(bad in attemptPatch)) break;
      skippedFields[bad] = attemptPatch[bad];
      delete attemptPatch[bad];
      if (Object.keys(attemptPatch).length === 0) break;
    }
    if (lastError) { toast.error(lastError.message); return; }
    const skipped = Object.keys(skippedFields);
    if (skipped.length > 0) {
      // Persist dropped fields to the shadow store so they re-appear on
      // refresh (until the DB migration ships). Toast remains so the auditor
      // / admin know to apply the migration for real persistence.
      shadowSaveRow(firmId, id, skippedFields);
      toast.warning(
        `Saved — ${skipped.length} field${skipped.length > 1 ? "s" : ""} kept locally only (column missing in DB): ${skipped.join(", ")}. Ask your admin to apply the latest DB migration for full persistence.`,
        { duration: 6000 },
      );
    } else {
      toast.success("Saved");
      // If the row had earlier shadow data (from a previous failed save) but
      // the DB now accepts the patch, the shadow entry is stale. Clear it.
      shadowDeleteRow(firmId, id);
    }

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
    // "Saved" toast now shown inside the defensive-save block above so it
    // can be replaced with the "kept locally only" warning when applicable.
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
    // Also clear any shadow-store data tied to this row.
    shadowDeleteRow(firmId, id);
    await load();
  }

  return { rows, loading, useLs, reload: load, addRow, updateRow, removeRow };
}
