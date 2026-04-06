/**
 * useAuditWorksheetData
 *
 * Single source of truth for all shared data across the Audit Worksheet module:
 *   - Engagement details (audit_type, financial_year, entity_type, firm_id, client_id)
 *   - Full client row (name, pan, address, cin, gstin, entity_type, etc.)
 *   - Firm name (from firms table via engagement.firm_id)
 *   - Audit firm details (from audit_firms via engagement.audit_firm_id)
 *   - Derived helpers: fyStartDate, fyEndDate, isCorporate, auditTypeLabel
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface AuditWorksheetEngagement {
  id: string;
  audit_type: string | null;
  financial_year: string | null;
  entity_type: string | null;
  firm_id: string | null;
  client_id: string | null;
  audit_firm_id: string | null;
  stage_statuses: Record<string, string>;
  pipeline_stage: number | null;
  planned_start: string | null;
  planned_end: string | null;
  team_members: string[] | null;
  partner_id: string | null;
  manager_id: string | null;
}

export interface AuditWorksheetClient {
  id: string;
  name: string | null;
  pan: string | null;
  cin: string | null;
  gstin: string[] | null;
  address: string | null;
  registered_office: string | null;
  entity_type: string | null;
  email: string | null;
  mobile: string | null;
  date_of_incorporation: string | null;
  business_activity: string | null;
}

export interface AuditWorksheetFirm {
  name: string;
  display_name: string | null;
  icai_firm_reg_no: string | null;
}

export interface AuditWorksheetAuditFirm {
  name: string;
  partner_name: string | null;
  icai_reg_no: string | null;
  address: string | null;
  city: string | null;
  phone: string | null;
}

export interface AuditWorksheetData {
  engagement:    AuditWorksheetEngagement | null;
  client:        AuditWorksheetClient     | null;
  firm:          AuditWorksheetFirm       | null;
  auditFirm:     AuditWorksheetAuditFirm  | null;

  // ── Derived / ready-to-use fields ────────────────────────────────────
  firmName:      string;   // The CA firm's display name (Req #1)
  auditType:     string;   // raw: "tax_audit" | "internal" | "statutory" | "both" | "stock"
  auditTypeLabel:string;   // human: "Tax Audit" | "Internal Audit" | "Statutory Audit" etc.
  clientName:    string;
  clientAddress: string;
  pan:           string;
  cin:           string;
  gstin:         string;   // comma-joined
  entityType:    string;   // from engagement (e.g. "company") or client
  financialYear: string;   // e.g. "2024-25"
  fyStartDate:   string;   // "2024-04-01"
  fyEndDate:     string;   // "2025-03-31"
  prevFyStart:   string;   // "2023-04-01"
  prevFyEnd:     string;   // "2024-03-31"
  isCorporate:   boolean;  // Pvt Ltd / Public Ltd / company / LLP (Req #3)

  loading: boolean;
  error:   string | null;
}

// ── Helpers ────────────────────────────────────────────────────────────────

export function deriveFyDates(fy: string): { start: string; end: string } {
  const m = fy.match(/^(\d{4})-(\d{2,4})$/);
  if (!m) return { start: "", end: "" };
  const y = parseInt(m[1]);
  return { start: `${y}-04-01`, end: `${y + 1}-03-31` };
}

export function prevFyDates(fy: string): { start: string; end: string } {
  const m = fy.match(/^(\d{4})-(\d{2,4})$/);
  if (!m) return { start: "", end: "" };
  const y = parseInt(m[1]) - 1;
  return { start: `${y}-04-01`, end: `${y + 1}-03-31` };
}

const AUDIT_TYPE_LABELS: Record<string, string> = {
  tax_audit:  "Tax Audit",
  internal:   "Internal Audit",
  statutory:  "Statutory Audit",
  both:       "Statutory & Tax Audit",
  stock:      "Stock Audit",
};

// ── Main hook ──────────────────────────────────────────────────────────────

export function useAuditWorksheetData(engagementId: string): AuditWorksheetData {
  // ── Engagement (with client + firm joins) ──
  const {
    data: engagement,
    isLoading: engLoading,
    error: engError,
  } = useQuery<AuditWorksheetEngagement | null>({
    queryKey: ["aws-engagement", engagementId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("audit_engagements")
        .select(
          "id, audit_type, financial_year, entity_type, firm_id, client_id, " +
          "audit_firm_id, stage_statuses, pipeline_stage, planned_start, planned_end, " +
          "team_members, partner_id, manager_id"
        )
        .eq("id", engagementId)
        .maybeSingle();
      if (error) throw error;
      return data
        ? { ...data, stage_statuses: (data.stage_statuses || {}) as Record<string, string> }
        : null;
    },
    enabled: !!engagementId,
    staleTime: 60_000,
  });

  // ── Client ──
  const { data: client, isLoading: clientLoading } = useQuery<AuditWorksheetClient | null>({
    queryKey: ["aws-client", engagement?.client_id],
    queryFn: async () => {
      const { data } = await supabase
        .from("clients")
        .select(
          "id, name, pan, cin, gstin, address, registered_office, entity_type, " +
          "email, mobile, date_of_incorporation, business_activity"
        )
        .eq("id", engagement!.client_id!)
        .maybeSingle();
      return data as AuditWorksheetClient | null;
    },
    enabled: !!engagement?.client_id,
    staleTime: 60_000,
  });

  // ── CA Firm (from firms table via engagement.firm_id) ──
  const { data: firm } = useQuery<AuditWorksheetFirm | null>({
    queryKey: ["aws-firm", engagement?.firm_id],
    queryFn: async () => {
      const { data } = await supabase
        .from("firms")
        .select("name, display_name, icai_firm_reg_no")
        .eq("id", engagement!.firm_id!)
        .maybeSingle();
      return data as AuditWorksheetFirm | null;
    },
    enabled: !!engagement?.firm_id,
    staleTime: 300_000,
  });

  // ── Audit Firm (from audit_firms via engagement.audit_firm_id) ──
  const { data: auditFirm } = useQuery<AuditWorksheetAuditFirm | null>({
    queryKey: ["aws-audit-firm", engagement?.audit_firm_id],
    queryFn: async () => {
      const { data } = await supabase
        .from("audit_firms")
        .select("name, partner_name, icai_reg_no, address, city, phone")
        .eq("id", engagement!.audit_firm_id!)
        .maybeSingle();
      return data as AuditWorksheetAuditFirm | null;
    },
    enabled: !!engagement?.audit_firm_id,
    staleTime: 300_000,
  });

  // ── Derive ────────────────────────────────────────────────────────────
  const fy           = engagement?.financial_year  || "";
  const auditType    = engagement?.audit_type      || "";
  const engEntity    = engagement?.entity_type     || "";
  const clientEntity = client?.entity_type         || "";

  const { start: fyStart, end: fyEnd }     = deriveFyDates(fy);
  const { start: prevStart, end: prevEnd } = prevFyDates(fy);

  // isCorporate: entity is a company / LLP that needs corporate-specific checks (Req #3)
  const isCorporate =
    engEntity    === "company" ||
    engEntity    === "llp"     ||
    clientEntity === "Private Ltd" ||
    clientEntity === "Public Ltd"  ||
    clientEntity === "LLP";

  const firmName =
    firm?.display_name || firm?.name ||
    auditFirm?.name    || "";

  return {
    engagement:     engagement     ?? null,
    client:         client         ?? null,
    firm:           firm           ?? null,
    auditFirm:      auditFirm      ?? null,

    firmName,
    auditType,
    auditTypeLabel: AUDIT_TYPE_LABELS[auditType] || "Audit",
    clientName:     client?.name              || "",
    clientAddress:  client?.registered_office || client?.address || "",
    pan:            client?.pan               || "",
    cin:            client?.cin               || "",
    gstin:          (client?.gstin || []).join(", "),
    entityType:     engEntity || clientEntity,
    financialYear:  fy,
    fyStartDate:    fyStart,
    fyEndDate:      fyEnd,
    prevFyStart:    prevStart,
    prevFyEnd:      prevEnd,
    isCorporate,

    loading: engLoading || clientLoading,
    error:   engError ? String(engError) : null,
  };
}
