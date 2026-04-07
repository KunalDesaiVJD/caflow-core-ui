/**
 * useWorksheetStorage
 *
 * Handles all read/write for:
 *   - audit_worksheet_master  (Tax/Internal master data, one row per engagement)
 *   - audit_worksheet_items   (Worksheet / Special Attention / Checklist rows)
 *
 * Tables were created by:
 *   supabase/migrations/20260406100000_audit_worksheet_module.sql
 */
import { useState, useEffect, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

// ─── Master data shape ─────────────────────────────────────────────────────

export interface WsMaster {
  id?: string;
  // Tax Audit Master
  tax_client_name: string;       tax_address: string;
  tax_pan: string;               tax_cin: string;
  tax_gstin: string;             tax_entity_type: string;
  tax_financial_year: string;    tax_period_from: string;
  tax_period_to: string;         tax_prev_year_from: string;
  tax_prev_year_to: string;      tax_turnover: string;
  tax_accounting_method: string; tax_section: string;
  tax_form_type: string;         tax_remarks: string;
  tax_auditor_firm: string;      tax_auditor_address: string;
  tax_icai_reg: string;          tax_partner_name: string;
  tax_partner_icai: string;      tax_udin: string;
  // Internal Audit Master
  int_client_name: string;       int_address: string;
  int_pan: string;               int_entity_type: string;
  int_financial_year: string;    int_period_label: string;
  int_period_from: string;       int_period_to: string;
  int_scope: string;             int_objectives: string;
  int_methodology: string;       int_audit_firm: string;
  int_partner_name: string;      int_team_members: string;
  // Query gate
  queries_verified: boolean;
  queries_verified_by: string | null;
  queries_verified_at: string | null;
  queries_notes: string;
}

export const BLANK_MASTER: WsMaster = {
  tax_client_name: "",       tax_address: "",
  tax_pan: "",               tax_cin: "",
  tax_gstin: "",             tax_entity_type: "",
  tax_financial_year: "",    tax_period_from: "",
  tax_period_to: "",         tax_prev_year_from: "",
  tax_prev_year_to: "",      tax_turnover: "",
  tax_accounting_method: "Mercantile",
  tax_section: "44AB(a)",    tax_form_type: "3CB",
  tax_remarks: "",           tax_auditor_firm: "",
  tax_auditor_address: "",   tax_icai_reg: "",
  tax_partner_name: "",      tax_partner_icai: "",
  tax_udin: "",
  int_client_name: "",       int_address: "",
  int_pan: "",               int_entity_type: "",
  int_financial_year: "",    int_period_label: "",
  int_period_from: "",       int_period_to: "",
  int_scope: "",             int_objectives: "",
  int_methodology: "",       int_audit_firm: "",
  int_partner_name: "",      int_team_members: "",
  queries_verified: false,
  queries_verified_by: null,
  queries_verified_at: null,
  queries_notes: "",
};

// ─── Item shape ────────────────────────────────────────────────────────────

export interface WsItem {
  id: string;
  sheet_type: "worksheet" | "special_attention" | "checklist";
  sr_no: number;
  particulars: string;
  work_done: string;
  remarks: string;
  assigned_to: string | null;
  assigned_name: string;
  is_done: boolean;
  status: string;
  priority: string;
  due_date: string;
}

// ─── Seed defaults ─────────────────────────────────────────────────────────

export const SPECIAL_ATTENTION_SEEDS = [
  "Related Party Transactions (AS-18 / Ind AS 24)",
  "Director Remuneration & Loans to Directors",
  "Loans / Advances to Subsidiaries / Associates",
  "CSR Expenditure & Compliance (Sec. 135)",
  "Statutory Dues — PF, ESI, TDS, GST",
  "Secured / Unsecured Loans — Charge Registered with ROC",
  "Stock / Inventory Valuation Method",
  "Advances from Customers — Revenue Recognition",
  "Capital Expenditure vs Revenue Expenditure",
  "Provisions & Contingent Liabilities",
];

export const CHECKLIST_SEEDS = [
  "Engagement Letter signed by client",
  "Independence Declaration signed by auditor",
  "Audit Planning Memorandum prepared",
  "Materiality computed and documented",
  "Audit Risk Assessment completed",
  "Trial Balance obtained and tallied",
  "Bank Reconciliation Statement verified",
  "Debtors / Creditors confirmation obtained",
  "Stock Certificate / Physical Verification done",
  "Management Representation Letter obtained",
  "All audit queries replied and resolved",
  "Working papers reviewed by partner / manager",
  "UDIN generated",
  "Final Report / Certificate signed and dated",
];

// ─── Main hook ─────────────────────────────────────────────────────────────

export function useWorksheetStorage(engagementId: string, firmId?: string | null) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const effectiveFirmId = firmId || user?.firm_id || null;

  // ── Master state (local, saved on demand) ─────────────────────────────
  const [master, setMasterState] = useState<WsMaster>(BLANK_MASTER);
  const [masterLoaded, setMasterLoaded] = useState(false);
  const [masterSaving, setMasterSaving] = useState(false);

  // ── Load master ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!engagementId || masterLoaded) return;
    (async () => {
      const { data } = await (supabase as any)
        .from("audit_worksheet_master")
        .select("*")
        .eq("engagement_id", engagementId)
        .maybeSingle();

      if (data) {
        setMasterState({
          id:                    data.id,
          tax_client_name:       data.tax_client_name       || "",
          tax_address:           data.tax_address           || "",
          tax_pan:               data.tax_pan               || "",
          tax_cin:               data.tax_cin               || "",
          tax_gstin:             data.tax_gstin             || "",
          tax_entity_type:       data.tax_entity_type       || "",
          tax_financial_year:    data.tax_financial_year    || "",
          tax_period_from:       data.tax_period_from       || "",
          tax_period_to:         data.tax_period_to         || "",
          tax_prev_year_from:    data.tax_prev_year_from    || "",
          tax_prev_year_to:      data.tax_prev_year_to      || "",
          tax_turnover:          data.tax_turnover          != null ? String(data.tax_turnover) : "",
          tax_accounting_method: data.tax_accounting_method || "Mercantile",
          tax_section:           data.tax_section           || "44AB(a)",
          tax_form_type:         data.tax_form_type         || "3CB",
          tax_remarks:           data.tax_remarks           || "",
          tax_auditor_firm:      data.tax_auditor_firm      || "",
          tax_auditor_address:   data.tax_auditor_address   || "",
          tax_icai_reg:          data.tax_icai_reg          || "",
          tax_partner_name:      data.tax_partner_name      || "",
          tax_partner_icai:      data.tax_partner_icai      || "",
          tax_udin:              data.tax_udin              || "",
          int_client_name:       data.int_client_name       || "",
          int_address:           data.int_address           || "",
          int_pan:               data.int_pan               || "",
          int_entity_type:       data.int_entity_type       || "",
          int_financial_year:    data.int_financial_year    || "",
          int_period_label:      data.int_period_label      || "",
          int_period_from:       data.int_period_from       || "",
          int_period_to:         data.int_period_to         || "",
          int_scope:             data.int_scope             || "",
          int_objectives:        data.int_objectives        || "",
          int_methodology:       data.int_methodology       || "",
          int_audit_firm:        data.int_audit_firm        || "",
          int_partner_name:      data.int_partner_name      || "",
          int_team_members:      data.int_team_members      || "",
          queries_verified:      data.queries_verified      || false,
          queries_verified_by:   data.queries_verified_by   || null,
          queries_verified_at:   data.queries_verified_at   || null,
          queries_notes:         data.queries_notes         || "",
        });
      }
      setMasterLoaded(true);
    })();
  }, [engagementId, masterLoaded]);

  const setMaster = useCallback(
    (field: keyof WsMaster, value: any) =>
      setMasterState(prev => ({ ...prev, [field]: value })),
    []
  );

  const patchMaster = useCallback(
    (patch: Partial<WsMaster>) =>
      setMasterState(prev => ({ ...prev, ...patch })),
    []
  );

  const saveMaster = useCallback(async (silent = false): Promise<boolean> => {
    setMasterSaving(true);
    try {
      const payload: any = {
        engagement_id:         engagementId,
        firm_id:               effectiveFirmId,
        tax_client_name:       master.tax_client_name,
        tax_address:           master.tax_address,
        tax_pan:               master.tax_pan,
        tax_cin:               master.tax_cin,
        tax_gstin:             master.tax_gstin,
        tax_entity_type:       master.tax_entity_type,
        tax_financial_year:    master.tax_financial_year,
        tax_period_from:       master.tax_period_from  || null,
        tax_period_to:         master.tax_period_to    || null,
        tax_prev_year_from:    master.tax_prev_year_from || null,
        tax_prev_year_to:      master.tax_prev_year_to   || null,
        tax_turnover:          master.tax_turnover ? parseFloat(master.tax_turnover) : null,
        tax_accounting_method: master.tax_accounting_method,
        tax_section:           master.tax_section,
        tax_form_type:         master.tax_form_type,
        tax_remarks:           master.tax_remarks,
        tax_auditor_firm:      master.tax_auditor_firm,
        tax_auditor_address:   master.tax_auditor_address,
        tax_icai_reg:          master.tax_icai_reg,
        tax_partner_name:      master.tax_partner_name,
        tax_partner_icai:      master.tax_partner_icai,
        tax_udin:              master.tax_udin,
        int_client_name:       master.int_client_name,
        int_address:           master.int_address,
        int_pan:               master.int_pan,
        int_entity_type:       master.int_entity_type,
        int_financial_year:    master.int_financial_year,
        int_period_label:      master.int_period_label,
        int_period_from:       master.int_period_from || null,
        int_period_to:         master.int_period_to   || null,
        int_scope:             master.int_scope,
        int_objectives:        master.int_objectives,
        int_methodology:       master.int_methodology,
        int_audit_firm:        master.int_audit_firm,
        int_partner_name:      master.int_partner_name,
        int_team_members:      master.int_team_members,
        queries_verified:      master.queries_verified,
        queries_verified_by:   master.queries_verified_by,
        queries_verified_at:   master.queries_verified_at,
        queries_notes:         master.queries_notes,
        updated_at:            new Date().toISOString(),
      };
      const { error } = await (supabase as any)
        .from("audit_worksheet_master")
        .upsert(payload, { onConflict: "engagement_id" });
      if (error) throw error;
      if (!silent) toast.success("Master sheet saved");
      return true;
    } catch (e: any) {
      toast.error(e.message || "Failed to save");
      return false;
    } finally {
      setMasterSaving(false);
    }
  }, [master, engagementId, effectiveFirmId]);

  // ── Items (Worksheet / Special Attention / Checklist) ─────────────────
  const { data: allItems = [], refetch: refetchItems } = useQuery<WsItem[]>({
    queryKey: ["aws-items", engagementId],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("audit_worksheet_items")
        .select("*")
        .eq("engagement_id", engagementId)
        .order("sr_no");
      return (data || []).map((r: any): WsItem => ({
        id:            r.id,
        sheet_type:    r.sheet_type,
        sr_no:         r.sr_no        || 0,
        particulars:   r.particulars  || "",
        work_done:     r.work_done    || "",
        remarks:       r.remarks      || "",
        assigned_to:   r.assigned_to  || null,
        assigned_name: r.assigned_name || "",
        is_done:       r.is_done      || false,
        status:        r.status       || "pending",
        priority:      r.priority     || "normal",
        due_date:      r.due_date     || "",
      }));
    },
    enabled: !!engagementId,
  });

  // Seed defaults once on first load
  useEffect(() => {
    if (!engagementId || allItems.length > 0) return;
    (async () => {
      const fid = effectiveFirmId;
      const seeds: any[] = [];
      SPECIAL_ATTENTION_SEEDS.forEach((p, i) =>
        seeds.push({ engagement_id: engagementId, firm_id: fid,
          sheet_type: "special_attention", sr_no: i + 1,
          particulars: p, status: "pending", priority: "normal", is_done: false })
      );
      CHECKLIST_SEEDS.forEach((p, i) =>
        seeds.push({ engagement_id: engagementId, firm_id: fid,
          sheet_type: "checklist", sr_no: i + 1,
          particulars: p, status: "pending", priority: "normal", is_done: false })
      );
      for (let i = 1; i <= 5; i++) {
        seeds.push({ engagement_id: engagementId, firm_id: fid,
          sheet_type: "worksheet", sr_no: i,
          particulars: "", status: "pending", priority: "normal", is_done: false });
      }
      await (supabase as any).from("audit_worksheet_items").insert(seeds);
      refetchItems();
    })();
  }, [engagementId, allItems.length]);

  const getItemsBySheet = useCallback(
    (type: WsItem["sheet_type"]) => allItems.filter(i => i.sheet_type === type),
    [allItems]
  );

  const updateItem = useCallback(async (id: string, updates: Partial<WsItem>) => {
    await (supabase as any)
      .from("audit_worksheet_items")
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq("id", id);
    refetchItems();
  }, [refetchItems]);

  const addItem = useCallback(async (
    sheetType: WsItem["sheet_type"],
    overrides: Partial<WsItem> = {}
  ) => {
    const existing = allItems.filter(i => i.sheet_type === sheetType);
    await (supabase as any).from("audit_worksheet_items").insert({
      engagement_id: engagementId,
      firm_id: effectiveFirmId,
      sheet_type: sheetType,
      sr_no: existing.length + 1,
      particulars: "", status: "pending", priority: "normal", is_done: false,
      ...overrides,
    });
    refetchItems();
  }, [allItems, engagementId, effectiveFirmId, refetchItems]);

  const deleteItem = useCallback(async (id: string) => {
    await (supabase as any).from("audit_worksheet_items").delete().eq("id", id);
    refetchItems();
  }, [refetchItems]);

  return {
    // Master
    master, setMaster, patchMaster, saveMaster, masterSaving, masterLoaded,
    // Items
    allItems, getItemsBySheet, updateItem, addItem, deleteItem, refetchItems,
  };
}
