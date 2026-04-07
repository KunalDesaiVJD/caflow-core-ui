/**
 * AuditWorksheetModule — Stage 6 "Audit Sheet" tab
 *
 * 6 sub-sheets:
 *  1. Tax Audit Master     (shown for audit_type = tax_audit | both)
 *  2. Internal Audit Master(shown for audit_type = internal)
 *  3. Special Attention    (shown only for corporate entities)
 *  4. Worksheet            (work tracking with employee assignments)
 *  5. Query Sheet          (live from audit_client_queries + correction gate)
 *  6. Checklist            (audit documentation tracker)
 */
import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  FileText, ClipboardList, AlertTriangle, CheckSquare, MessageSquare,
  CheckCircle2, Circle, Plus, Trash2, Save, Loader2, Download,
  User, Calendar, Lock, Unlock, ShieldAlert, FileCheck,
} from "lucide-react";
import * as XLSX from "xlsx";

// ─── Types ────────────────────────────────────────────────────────────────

interface WsMaster {
  id?: string;
  // Tax Audit Master
  tax_client_name: string;
  tax_address: string;
  tax_pan: string;
  tax_cin: string;
  tax_gstin: string;
  tax_entity_type: string;
  tax_financial_year: string;
  tax_period_from: string;
  tax_period_to: string;
  tax_prev_year_from: string;
  tax_prev_year_to: string;
  tax_turnover: string;
  tax_accounting_method: string;
  tax_section: string;
  tax_form_type: string;
  tax_remarks: string;
  tax_auditor_firm: string;
  tax_auditor_address: string;
  tax_icai_reg: string;
  tax_partner_name: string;
  tax_partner_icai: string;
  tax_udin: string;
  // Internal Audit Master
  int_client_name: string;
  int_address: string;
  int_pan: string;
  int_entity_type: string;
  int_financial_year: string;
  int_period_label: string;
  int_period_from: string;
  int_period_to: string;
  int_scope: string;
  int_objectives: string;
  int_methodology: string;
  int_audit_firm: string;
  int_partner_name: string;
  int_team_members: string;
  // Query gate
  queries_verified: boolean;
  queries_verified_by: string | null;
  queries_verified_at: string | null;
  queries_notes: string;
}

interface WsItem {
  id: string;
  sheet_type: string;
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

interface TeamUser {
  id: string;
  name: string | null;
  role: string | null;
  icai_reg_no: string | null;
}

// ─── Default seed data ────────────────────────────────────────────────────

const SPECIAL_ATTENTION_DEFAULTS = [
  "Related Party Transactions (AS-18 / Ind AS 24)",
  "Director Remuneration & Loans to Directors",
  "Loans / Advances to Subsidiaries / Associates",
  "CSR Expenditure & Compliance (Sec. 135)",
  "Statutory Dues — PF, ESI, TDS, GST",
  "Secured / Unsecured Loans — Charge Registered",
  "Stock / Inventory Valuation Method",
  "Advances from Customers — Revenue Recognition",
  "Capital Expenditure vs Revenue Expenditure",
  "Provisions & Contingent Liabilities",
];

const CHECKLIST_DEFAULTS = [
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
  "Working papers reviewed by partner",
  "UDIN generated",
  "Final Report / Certificate signed",
];

const WORKSHEET_AREAS = [
  "Revenue & Sales", "Purchases & Expenses", "Fixed Assets & Depreciation",
  "Debtors & Receivables", "Creditors & Payables", "Loans & Borrowings",
  "Inventory / Stock", "Cash & Bank", "Investments", "Capital & Reserves",
  "Payroll & PF/ESI", "TDS Compliance", "GST Compliance",
  "Related Party Transactions", "Contingent Liabilities", "Other",
];

const BLANK_MASTER: WsMaster = {
  tax_client_name: "", tax_address: "", tax_pan: "", tax_cin: "", tax_gstin: "",
  tax_entity_type: "", tax_financial_year: "", tax_period_from: "", tax_period_to: "",
  tax_prev_year_from: "", tax_prev_year_to: "", tax_turnover: "",
  tax_accounting_method: "Mercantile", tax_section: "44AB(a)", tax_form_type: "3CB",
  tax_remarks: "", tax_auditor_firm: "", tax_auditor_address: "", tax_icai_reg: "",
  tax_partner_name: "", tax_partner_icai: "", tax_udin: "",
  int_client_name: "", int_address: "", int_pan: "", int_entity_type: "",
  int_financial_year: "", int_period_label: "", int_period_from: "", int_period_to: "",
  int_scope: "", int_objectives: "", int_methodology: "",
  int_audit_firm: "", int_partner_name: "", int_team_members: "",
  queries_verified: false, queries_verified_by: null, queries_verified_at: null, queries_notes: "",
};

// ─── Helpers ──────────────────────────────────────────────────────────────

/** "2024-25" → { from: "2024-04-01", to: "2025-03-31" } */
function fyToDates(fy: string) {
  const m = fy.match(/^(\d{4})-(\d{2,4})$/);
  if (!m) return { from: "", to: "" };
  const startYear = parseInt(m[1]);
  return {
    from: `${startYear}-04-01`,
    to: `${startYear + 1}-03-31`,
  };
}

function fyLabel(fy: string) {
  const { from, to } = fyToDates(fy);
  if (!from) return fy;
  const fmt = (d: string) => {
    const dt = new Date(d);
    return dt.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  };
  return `${fmt(from)} to ${fmt(to)}`;
}

function prevFY(fy: string) {
  const m = fy.match(/^(\d{4})-(\d{2,4})$/);
  if (!m) return { from: "", to: "" };
  const startYear = parseInt(m[1]) - 1;
  return { from: `${startYear}-04-01`, to: `${startYear + 1}-03-31` };
}

// ─── Status badge ──────────────────────────────────────────────────────────
const STATUS_STYLES: Record<string, string> = {
  pending:     "bg-slate-100 text-slate-600",
  in_progress: "bg-amber-100 text-amber-700",
  done:        "bg-green-100 text-green-700",
  na:          "bg-muted text-muted-foreground",
};
const STATUS_LABELS: Record<string, string> = {
  pending: "Pending", in_progress: "In Progress", done: "Done", na: "N/A",
};
const PRIORITY_STYLES: Record<string, string> = {
  high:   "bg-red-100 text-red-700",
  normal: "bg-blue-100 text-blue-700",
  low:    "bg-slate-100 text-slate-600",
};

// ─── Main Component ────────────────────────────────────────────────────────

interface Props {
  engagementId: string;
  engagement: any;      // full engagement row from AuditPipeline
  client?: any;         // optional: full client row (fetched internally if not provided)
}

export default function AuditWorksheetModule({ engagementId, engagement, client: clientProp }: Props) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState("master");
  const [masterSaving, setMasterSaving] = useState(false);
  const [master, setMaster] = useState<WsMaster>(BLANK_MASTER);
  const [masterLoaded, setMasterLoaded] = useState(false);

  // ── Fetch full client if not provided ──────────────────────────────────
  const { data: fetchedClient } = useQuery({
    queryKey: ["ws-client", engagement?.client_id],
    queryFn: async () => {
      if (!engagement?.client_id) return null;
      const { data } = await supabase
        .from("clients")
        .select("id, name, pan, cin, gstin, address, registered_office, entity_type, email, mobile")
        .eq("id", engagement.client_id)
        .maybeSingle();
      return data;
    },
    enabled: !!engagement?.client_id && !clientProp,
  });
  const client = clientProp || fetchedClient;

  // ── Determine audit type + entity ──────────────────────────────────────
  const auditType: string = engagement?.audit_type || "";
  const isTaxAudit  = auditType === "tax_audit" || auditType === "both";
  const isInternal  = auditType === "internal";
  const isStatutory = auditType === "statutory" || auditType === "both";
  const isCorporate = (engagement?.entity_type === "company") ||
    (client?.entity_type === "Private Ltd") || (client?.entity_type === "Public Ltd") ||
    (client?.entity_type === "LLP");

  const fy: string = engagement?.financial_year || "";
  const { from: fyFrom, to: fyTo } = fyToDates(fy);
  const { from: prevFrom, to: prevTo } = prevFY(fy);

  // ── Load master + team users ────────────────────────────────────────────
  const { data: auditFirmData } = useQuery({
    queryKey: ["audit-firm", engagement?.audit_firm_id],
    queryFn: async () => {
      if (!engagement?.audit_firm_id) return null;
      const { data } = await supabase
        .from("audit_firms")
        .select("name, partner_name, icai_reg_no, address, city")
        .eq("id", engagement.audit_firm_id)
        .maybeSingle();
      return data;
    },
    enabled: !!engagement?.audit_firm_id,
  });

  const { data: firmUsers = [] } = useQuery<TeamUser[]>({
    queryKey: ["firm-users", user?.firm_id],
    queryFn: async () => {
      const { data } = await supabase
        .from("users")
        .select("id, name, role, icai_reg_no")
        .eq("firm_id", user?.firm_id!)
        .eq("is_active", true)
        .order("name");
      return (data || []) as TeamUser[];
    },
    enabled: !!user?.firm_id,
  });

  // ── Load master row ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!engagementId || masterLoaded) return;
    (async () => {
      const { data } = await (supabase as any)
        .from("audit_worksheet_master")
        .select("*")
        .eq("engagement_id", engagementId)
        .maybeSingle();

      if (data) {
        setMaster({
          id: data.id,
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
        } as WsMaster);
      } else {
        // Auto-fill from engagement / client / audit_firm
        setMaster(prev => ({
          ...prev,
          tax_client_name:    client?.name             || "",
          tax_address:        client?.registered_office || client?.address || "",
          tax_pan:            client?.pan              || "",
          tax_cin:            client?.cin              || "",
          tax_gstin:          (client?.gstin || []).join(", "),
          tax_entity_type:    client?.entity_type      || engagement?.entity_type || "",
          tax_financial_year: fy,
          tax_period_from:    fyFrom,
          tax_period_to:      fyTo,
          tax_prev_year_from: prevFrom,
          tax_prev_year_to:   prevTo,
          tax_auditor_firm:   auditFirmData?.name           || "",
          tax_auditor_address:auditFirmData?.city           || "",
          tax_icai_reg:       auditFirmData?.icai_reg_no    || "",
          tax_partner_name:   auditFirmData?.partner_name   || "",
          int_client_name:    client?.name             || "",
          int_address:        client?.registered_office || client?.address || "",
          int_pan:            client?.pan              || "",
          int_entity_type:    client?.entity_type      || engagement?.entity_type || "",
          int_financial_year: fy,
          int_period_label:   fy ? `Annual ${fy}` : "",
          int_period_from:    fyFrom,
          int_period_to:      fyTo,
          int_audit_firm:     auditFirmData?.name        || "",
          int_partner_name:   auditFirmData?.partner_name || "",
        }));
      }
      setMasterLoaded(true);
    })();
  }, [engagementId, masterLoaded, client, engagement, fy, fyFrom, fyTo, prevFrom, prevTo, auditFirmData]);

  // Re-fill auditor when audit_firm data loads
  useEffect(() => {
    if (!auditFirmData || !masterLoaded) return;
    setMaster(prev => ({
      ...prev,
      tax_auditor_firm:    prev.tax_auditor_firm    || auditFirmData.name          || "",
      tax_auditor_address: prev.tax_auditor_address || auditFirmData.city          || "",
      tax_icai_reg:        prev.tax_icai_reg        || auditFirmData.icai_reg_no   || "",
      tax_partner_name:    prev.tax_partner_name    || auditFirmData.partner_name  || "",
      int_audit_firm:      prev.int_audit_firm      || auditFirmData.name          || "",
      int_partner_name:    prev.int_partner_name    || auditFirmData.partner_name  || "",
    }));
  }, [auditFirmData, masterLoaded]);

  const setM = (field: keyof WsMaster, val: any) =>
    setMaster(prev => ({ ...prev, [field]: val }));

  const saveMaster = async () => {
    setMasterSaving(true);
    try {
      const payload: any = {
        engagement_id:         engagementId,
        firm_id:               user?.firm_id || engagement?.firm_id || null,
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
      toast.success("Master sheet saved");
    } catch (e: any) {
      toast.error(e.message || "Failed to save");
    } finally {
      setMasterSaving(false);
    }
  };

  // ── Items (Worksheet / Special Attention / Checklist) ──────────────────
  const { data: allItems = [], refetch: refetchItems } = useQuery<WsItem[]>({
    queryKey: ["ws-items", engagementId],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("audit_worksheet_items")
        .select("*")
        .eq("engagement_id", engagementId)
        .order("sr_no");
      return (data || []).map((r: any) => ({
        id:            r.id,
        sheet_type:    r.sheet_type,
        sr_no:         r.sr_no      || 0,
        particulars:   r.particulars || "",
        work_done:     r.work_done  || "",
        remarks:       r.remarks    || "",
        assigned_to:   r.assigned_to || null,
        assigned_name: r.assigned_name || "",
        is_done:       r.is_done    || false,
        status:        r.status     || "pending",
        priority:      r.priority   || "normal",
        due_date:      r.due_date   || "",
      }));
    },
    enabled: !!engagementId,
  });

  const sheetItems = (type: string) => allItems.filter(i => i.sheet_type === type);

  // Seed defaults on first load
  useEffect(() => {
    if (!engagementId || allItems.length > 0) return;
    (async () => {
      const firmId = user?.firm_id || engagement?.firm_id || null;
      const seeds: any[] = [];
      // Special Attention
      SPECIAL_ATTENTION_DEFAULTS.forEach((p, idx) => seeds.push({
        engagement_id: engagementId, firm_id: firmId,
        sheet_type: "special_attention", sr_no: idx + 1,
        particulars: p, status: "pending", priority: "normal", is_done: false,
      }));
      // Checklist
      CHECKLIST_DEFAULTS.forEach((p, idx) => seeds.push({
        engagement_id: engagementId, firm_id: firmId,
        sheet_type: "checklist", sr_no: idx + 1,
        particulars: p, status: "pending", priority: "normal", is_done: false,
      }));
      // Worksheet — 5 blank rows
      for (let i = 1; i <= 5; i++) seeds.push({
        engagement_id: engagementId, firm_id: firmId,
        sheet_type: "worksheet", sr_no: i,
        particulars: "", status: "pending", priority: "normal", is_done: false,
      });
      if (seeds.length > 0) {
        await (supabase as any).from("audit_worksheet_items").insert(seeds);
        refetchItems();
      }
    })();
  }, [engagementId, allItems.length]);

  const updateItem = async (id: string, updates: Partial<WsItem>) => {
    const { error } = await (supabase as any)
      .from("audit_worksheet_items")
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) toast.error(error.message);
    else refetchItems();
  };

  const addWorksheetRow = async () => {
    const existing = sheetItems("worksheet");
    const nextSr = existing.length + 1;
    await (supabase as any).from("audit_worksheet_items").insert({
      engagement_id: engagementId,
      firm_id: user?.firm_id || engagement?.firm_id || null,
      sheet_type: "worksheet",
      sr_no: nextSr, particulars: "", status: "pending", priority: "normal", is_done: false,
    });
    refetchItems();
  };

  const deleteItem = async (id: string) => {
    await (supabase as any).from("audit_worksheet_items").delete().eq("id", id);
    refetchItems();
  };

  // ── Queries (from audit_client_queries) ────────────────────────────────
  const { data: queries = [], refetch: refetchQueries } = useQuery({
    queryKey: ["ws-queries", engagementId],
    queryFn: async () => {
      const { data } = await supabase
        .from("audit_client_queries")
        .select("id, ref_number, query_text, status, priority, due_date, client_reply, internal_notes, created_at")
        .eq("engagement_id", engagementId)
        .order("created_at");
      return data || [];
    },
    enabled: !!engagementId,
  });

  const updateQueryStatus = async (qid: string, status: string) => {
    await supabase.from("audit_client_queries").update({ status } as any).eq("id", qid);
    refetchQueries();
  };

  const openQueries  = queries.filter((q: any) => q.status === "open" || q.status === "pending");
  const closedCount  = queries.filter((q: any) => q.status === "resolved" || q.status === "closed" || q.status === "replied").length;
  const allResolved  = openQueries.length === 0;

  const verifyQueries = async () => {
    setM("queries_verified", true);
    setM("queries_verified_by", user?.id || null);
    setM("queries_verified_at", new Date().toISOString());
    await saveMaster();
    toast.success("All queries marked verified — stage gate cleared");
  };

  // ── Export to Excel ─────────────────────────────────────────────────────
  const exportExcel = () => {
    const wb = XLSX.utils.book_new();

    if (isTaxAudit) {
      const taxRows = [
        ["TAX AUDIT MASTER SHEET"],
        ["Field", "Details"],
        ["Client Name", master.tax_client_name],
        ["Address", master.tax_address],
        ["PAN", master.tax_pan],
        ["CIN", master.tax_cin],
        ["GSTIN", master.tax_gstin],
        ["Entity Type", master.tax_entity_type],
        ["Financial Year", master.tax_financial_year],
        ["Period From", master.tax_period_from],
        ["Period To", master.tax_period_to],
        ["Previous Year From", master.tax_prev_year_from],
        ["Previous Year To", master.tax_prev_year_to],
        ["Turnover / Gross Receipts", master.tax_turnover],
        ["Accounting Method", master.tax_accounting_method],
        ["Section (44AB)", master.tax_section],
        ["Form Type", master.tax_form_type],
        ["Audit Firm", master.tax_auditor_firm],
        ["Firm Address", master.tax_auditor_address],
        ["ICAI Reg No", master.tax_icai_reg],
        ["Partner Name", master.tax_partner_name],
        ["Partner ICAI No", master.tax_partner_icai],
        ["UDIN", master.tax_udin],
        ["Remarks", master.tax_remarks],
      ];
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(taxRows), "Tax Audit Master");
    }

    if (isInternal) {
      const intRows = [
        ["INTERNAL AUDIT MASTER SHEET"],
        ["Field", "Details"],
        ["Client Name", master.int_client_name],
        ["Address", master.int_address],
        ["PAN", master.int_pan],
        ["Entity Type", master.int_entity_type],
        ["Financial Year", master.int_financial_year],
        ["Period", master.int_period_label],
        ["Period From", master.int_period_from],
        ["Period To", master.int_period_to],
        ["Audit Firm", master.int_audit_firm],
        ["Partner Name", master.int_partner_name],
        ["Team Members", master.int_team_members],
        ["Scope of Audit", master.int_scope],
        ["Objectives", master.int_objectives],
        ["Methodology", master.int_methodology],
      ];
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(intRows), "Internal Audit Master");
    }

    // Worksheet
    const wsRows = [
      ["AUDIT WORKSHEET"],
      ["Sr No", "Area / Particulars", "Work Done", "Assigned To", "Status", "Priority", "Remarks"],
      ...sheetItems("worksheet").map(i => [
        i.sr_no, i.particulars, i.work_done, i.assigned_name, i.status, i.priority, i.remarks,
      ]),
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(wsRows), "Worksheet");

    // Special Attention
    if (isCorporate) {
      const saRows = [
        ["SPECIAL ATTENTION CHECKLIST"],
        ["Sr No", "Area", "Remarks", "Status"],
        ...sheetItems("special_attention").map(i => [
          i.sr_no, i.particulars, i.remarks, i.status,
        ]),
      ];
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(saRows), "Special Attention");
    }

    // Checklist
    const clRows = [
      ["AUDIT CHECKLIST"],
      ["Sr No", "Item", "Remarks", "Done"],
      ...sheetItems("checklist").map(i => [
        i.sr_no, i.particulars, i.remarks, i.is_done ? "Yes" : "No",
      ]),
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(clRows), "Checklist");

    // Query Sheet
    const qRows = [
      ["QUERY SHEET"],
      ["Ref", "Query", "Status", "Reply", "Due Date"],
      ...queries.map((q: any) => [
        q.ref_number || "—", q.query_text, q.status,
        q.client_reply || "—", q.due_date || "—",
      ]),
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(qRows), "Query Sheet");

    XLSX.writeFile(wb, `AuditWorksheet_${client?.name || "Client"}_${fy}.xlsx`);
    toast.success("Exported to Excel");
  };

  // ── Render helpers ─────────────────────────────────────────────────────

  const MasterField = ({
    label, field, type = "text", full = false,
  }: {
    label: string;
    field: keyof WsMaster;
    type?: "text" | "date" | "number" | "textarea";
    full?: boolean;
  }) => (
    <div className={cn("space-y-1", full && "col-span-2")}>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {type === "textarea" ? (
        <Textarea
          value={String(master[field] || "")}
          onChange={e => setM(field, e.target.value)}
          rows={2}
          className="text-sm"
        />
      ) : (
        <Input
          type={type}
          value={String(master[field] || "")}
          onChange={e => setM(field, e.target.value)}
          className="h-8 text-sm"
        />
      )}
    </div>
  );

  // ── Determine default tab based on audit type ───────────────────────────
  useEffect(() => {
    if (isTaxAudit) setActiveTab("tax_master");
    else if (isInternal) setActiveTab("int_master");
    else setActiveTab("worksheet");
  }, [isTaxAudit, isInternal]);

  // ══════════════════════════════════════════════════════════════════════════
  return (
    <div className="space-y-4">
      {/* ── Header ── */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
            <ClipboardList size={16} className="text-primary" /> Audit Worksheet
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {client?.name} · {fy} · {engagement?.audit_type?.replace(/_/g, " ") || "Audit"}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={exportExcel} className="gap-1">
            <Download size={13} /> Export Excel
          </Button>
          <Button size="sm" onClick={saveMaster} disabled={masterSaving} className="gap-1">
            {masterSaving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
            Save
          </Button>
        </div>
      </div>

      {/* ── Tab Navigation ── */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="flex-wrap h-auto gap-1">
          {isTaxAudit && (
            <TabsTrigger value="tax_master" className="gap-1 text-xs">
              <FileText size={12} /> Tax Audit Master
            </TabsTrigger>
          )}
          {isInternal && (
            <TabsTrigger value="int_master" className="gap-1 text-xs">
              <FileText size={12} /> Internal Audit Master
            </TabsTrigger>
          )}
          {!isTaxAudit && !isInternal && (
            <TabsTrigger value="statutory_master" className="gap-1 text-xs">
              <FileText size={12} /> Statutory Audit Master
            </TabsTrigger>
          )}
          {isCorporate && (
            <TabsTrigger value="special_attention" className="gap-1 text-xs">
              <ShieldAlert size={12} /> Special Attention
            </TabsTrigger>
          )}
          <TabsTrigger value="worksheet" className="gap-1 text-xs">
            <CheckSquare size={12} /> Worksheet
          </TabsTrigger>
          <TabsTrigger value="query_sheet" className="gap-1 text-xs">
            <MessageSquare size={12} /> Query Sheet
            {openQueries.length > 0 && (
              <Badge variant="destructive" className="text-[9px] ml-0.5 px-1 h-4">{openQueries.length}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="checklist" className="gap-1 text-xs">
            <FileCheck size={12} /> Checklist
          </TabsTrigger>
        </TabsList>

        {/* ════════════════════════════════════════════════════════════════
            TAB 1: TAX AUDIT MASTER
        ════════════════════════════════════════════════════════════════ */}
        <TabsContent value="tax_master" className="mt-4 space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <FileText size={14} className="text-primary" />
                Tax Audit Master Sheet
                <Badge variant="outline" className="text-[10px]">Form {master.tax_form_type}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {/* ── Client Details ── */}
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                A. Client Details
              </p>
              <div className="grid grid-cols-2 gap-3 mb-5">
                <MasterField label="Client / Assessee Name" field="tax_client_name" />
                <MasterField label="PAN" field="tax_pan" />
                <MasterField label="Address" field="tax_address" full />
                <MasterField label="CIN (if company)" field="tax_cin" />
                <MasterField label="GSTIN(s)" field="tax_gstin" />
                <MasterField label="Entity Type" field="tax_entity_type" />
              </div>
              <Separator className="my-4" />

              {/* ── Period & Audit Info ── */}
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                B. Audit Period
              </p>
              <div className="grid grid-cols-2 gap-3 mb-5">
                <MasterField label="Financial Year" field="tax_financial_year" />
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Accounting Method</Label>
                  <Select value={master.tax_accounting_method} onValueChange={v => setM("tax_accounting_method", v)}>
                    <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Mercantile">Mercantile (Accrual)</SelectItem>
                      <SelectItem value="Cash">Cash</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <MasterField label="Period From" field="tax_period_from" type="date" />
                <MasterField label="Period To" field="tax_period_to" type="date" />
                <MasterField label="Previous Year From" field="tax_prev_year_from" type="date" />
                <MasterField label="Previous Year To" field="tax_prev_year_to" type="date" />
                <MasterField label="Turnover / Gross Receipts (₹)" field="tax_turnover" type="number" />
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Section (44AB)</Label>
                  <Select value={master.tax_section} onValueChange={v => setM("tax_section", v)}>
                    <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {["44AB(a)","44AB(b)","44AB(c)","44AB(d)","44AB(e)"].map(s => (
                        <SelectItem key={s} value={s}>{s}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Form Type</Label>
                  <Select value={master.tax_form_type} onValueChange={v => setM("tax_form_type", v)}>
                    <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="3CA">Form 3CA (already audited under other law)</SelectItem>
                      <SelectItem value="3CB">Form 3CB (not required under other law)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <Separator className="my-4" />

              {/* ── Auditor Details ── */}
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                C. Auditor / Firm Details
              </p>
              <div className="grid grid-cols-2 gap-3 mb-5">
                <MasterField label="Audit Firm Name" field="tax_auditor_firm" />
                <MasterField label="ICAI Firm Reg No" field="tax_icai_reg" />
                <MasterField label="Firm Address / City" field="tax_auditor_address" />
                <MasterField label="Partner / Proprietor Name" field="tax_partner_name" />
                <MasterField label="Partner ICAI Membership No" field="tax_partner_icai" />
                <MasterField label="UDIN" field="tax_udin" />
              </div>
              <Separator className="my-4" />

              {/* ── Remarks ── */}
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                D. Remarks
              </p>
              <MasterField label="Remarks / Observations" field="tax_remarks" type="textarea" full />
            </CardContent>
          </Card>
        </TabsContent>

        {/* ════════════════════════════════════════════════════════════════
            TAB 1B: INTERNAL AUDIT MASTER
        ════════════════════════════════════════════════════════════════ */}
        <TabsContent value="int_master" className="mt-4 space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <FileText size={14} className="text-primary" /> Internal Audit Master Sheet
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                A. Client Details
              </p>
              <div className="grid grid-cols-2 gap-3 mb-5">
                <MasterField label="Client Name" field="int_client_name" />
                <MasterField label="PAN" field="int_pan" />
                <MasterField label="Address" field="int_address" full />
                <MasterField label="Entity Type" field="int_entity_type" />
                <MasterField label="Financial Year" field="int_financial_year" />
              </div>
              <Separator className="my-4" />
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                B. Audit Period
              </p>
              <div className="grid grid-cols-2 gap-3 mb-5">
                <MasterField label="Period Label (e.g. Q1 2024-25)" field="int_period_label" />
                <div />
                <MasterField label="Period From" field="int_period_from" type="date" />
                <MasterField label="Period To" field="int_period_to" type="date" />
              </div>
              <Separator className="my-4" />
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                C. Auditor Details
              </p>
              <div className="grid grid-cols-2 gap-3 mb-5">
                <MasterField label="Audit Firm" field="int_audit_firm" />
                <MasterField label="Partner / Lead Auditor" field="int_partner_name" />
                <MasterField label="Team Members" field="int_team_members" full />
              </div>
              <Separator className="my-4" />
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                D. Scope, Objectives & Methodology
              </p>
              <div className="grid grid-cols-1 gap-3">
                <MasterField label="Scope of Audit" field="int_scope" type="textarea" />
                <MasterField label="Objectives" field="int_objectives" type="textarea" />
                <MasterField label="Methodology" field="int_methodology" type="textarea" />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ════════════════════════════════════════════════════════════════
            TAB 1C: STATUTORY AUDIT MASTER (generic for statutory/stock)
        ════════════════════════════════════════════════════════════════ */}
        <TabsContent value="statutory_master" className="mt-4 space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <FileText size={14} className="text-primary" />
                Statutory Audit Master Sheet
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-3 mb-5">
                <MasterField label="Client Name" field="tax_client_name" />
                <MasterField label="PAN" field="tax_pan" />
                <MasterField label="Address" field="tax_address" full />
                <MasterField label="CIN" field="tax_cin" />
                <MasterField label="Entity Type" field="tax_entity_type" />
                <MasterField label="Financial Year" field="tax_financial_year" />
                <MasterField label="Period From" field="tax_period_from" type="date" />
                <MasterField label="Period To" field="tax_period_to" type="date" />
              </div>
              <Separator className="my-4" />
              <div className="grid grid-cols-2 gap-3">
                <MasterField label="Audit Firm" field="tax_auditor_firm" />
                <MasterField label="ICAI Reg No" field="tax_icai_reg" />
                <MasterField label="Partner Name" field="tax_partner_name" />
                <MasterField label="UDIN" field="tax_udin" />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ════════════════════════════════════════════════════════════════
            TAB 2: SPECIAL ATTENTION (corporate only)
        ════════════════════════════════════════════════════════════════ */}
        <TabsContent value="special_attention" className="mt-4 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold flex items-center gap-1.5">
                <ShieldAlert size={14} className="text-amber-500" /> Special Attention Checklist
              </h3>
              <p className="text-xs text-muted-foreground">
                Areas requiring special attention for corporate entities
              </p>
            </div>
            <Badge variant="secondary" className="text-[10px]">
              {sheetItems("special_attention").filter(i => i.is_done).length} / {sheetItems("special_attention").length} done
            </Badge>
          </div>
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10 text-[11px]">Sr</TableHead>
                    <TableHead className="text-[11px]">Area / Item</TableHead>
                    <TableHead className="text-[11px]">Remarks / Findings</TableHead>
                    <TableHead className="w-32 text-[11px]">Status</TableHead>
                    <TableHead className="w-16 text-[11px] text-center">Done</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sheetItems("special_attention").map(item => (
                    <TableRow key={item.id} className={cn(item.is_done && "opacity-60")}>
                      <TableCell className="text-xs text-muted-foreground">{item.sr_no}</TableCell>
                      <TableCell className="text-xs font-medium">{item.particulars}</TableCell>
                      <TableCell className="p-1">
                        <Input
                          value={item.remarks}
                          onChange={e => updateItem(item.id, { remarks: e.target.value })}
                          className="h-7 text-xs border-0 focus-visible:ring-1"
                          placeholder="Remarks…"
                        />
                      </TableCell>
                      <TableCell className="p-1">
                        <Select
                          value={item.status}
                          onValueChange={v => updateItem(item.id, { status: v, is_done: v === "done" })}
                        >
                          <SelectTrigger className="h-7 text-[11px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {Object.entries(STATUS_LABELS).map(([val, lbl]) => (
                              <SelectItem key={val} value={val} className="text-xs">{lbl}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell className="text-center">
                        <Checkbox
                          checked={item.is_done}
                          onCheckedChange={v => updateItem(item.id, { is_done: !!v, status: v ? "done" : "pending" })}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ════════════════════════════════════════════════════════════════
            TAB 3: WORKSHEET
        ════════════════════════════════════════════════════════════════ */}
        <TabsContent value="worksheet" className="mt-4 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold flex items-center gap-1.5">
                <CheckSquare size={14} className="text-primary" /> Audit Worksheet
              </h3>
              <p className="text-xs text-muted-foreground">
                Track audit work area-by-area with employee assignments
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="text-[10px]">
                {sheetItems("worksheet").filter(i => i.is_done).length} / {sheetItems("worksheet").length} done
              </Badge>
              <Button size="sm" variant="outline" onClick={addWorksheetRow} className="gap-1 h-7 text-xs">
                <Plus size={12} /> Add Row
              </Button>
            </div>
          </div>
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10 text-[11px]">Sr</TableHead>
                      <TableHead className="text-[11px] w-44">Area / Particulars</TableHead>
                      <TableHead className="text-[11px]">Work Done / Procedure</TableHead>
                      <TableHead className="text-[11px] w-36">Assigned To</TableHead>
                      <TableHead className="text-[11px] w-28">Status</TableHead>
                      <TableHead className="text-[11px] w-20">Priority</TableHead>
                      <TableHead className="text-[11px]">Remarks</TableHead>
                      <TableHead className="w-14 text-[11px] text-center">Done</TableHead>
                      <TableHead className="w-8" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sheetItems("worksheet").map(item => (
                      <TableRow key={item.id} className={cn(item.is_done && "opacity-60 bg-green-50/30")}>
                        <TableCell className="text-xs text-muted-foreground">{item.sr_no}</TableCell>
                        <TableCell className="p-1">
                          <Select
                            value={item.particulars || "__custom__"}
                            onValueChange={v => {
                              if (v !== "__custom__") updateItem(item.id, { particulars: v });
                            }}
                          >
                            <SelectTrigger className="h-7 text-[11px]">
                              <SelectValue placeholder="Select area" />
                            </SelectTrigger>
                            <SelectContent>
                              {WORKSHEET_AREAS.map(a => (
                                <SelectItem key={a} value={a} className="text-xs">{a}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Input
                            value={item.particulars}
                            onChange={e => updateItem(item.id, { particulars: e.target.value })}
                            className="h-6 text-[11px] mt-1 border-0 border-b rounded-none focus-visible:ring-0"
                            placeholder="or type custom…"
                          />
                        </TableCell>
                        <TableCell className="p-1">
                          <Textarea
                            value={item.work_done}
                            onChange={e => updateItem(item.id, { work_done: e.target.value })}
                            rows={2}
                            className="text-[11px] min-h-0 resize-none border-0 focus-visible:ring-1"
                            placeholder="Procedure / work performed…"
                          />
                        </TableCell>
                        <TableCell className="p-1">
                          <Select
                            value={item.assigned_to || "none"}
                            onValueChange={v => {
                              const u = firmUsers.find(u => u.id === v);
                              updateItem(item.id, {
                                assigned_to: v === "none" ? null : v,
                                assigned_name: u?.name || "",
                              });
                            }}
                          >
                            <SelectTrigger className="h-7 text-[11px]">
                              <SelectValue placeholder="Assign…" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none" className="text-xs">— Unassigned —</SelectItem>
                              {firmUsers.map(u => (
                                <SelectItem key={u.id} value={u.id} className="text-xs">
                                  {u.name} {u.icai_reg_no ? `(${u.icai_reg_no})` : ""}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell className="p-1">
                          <Select
                            value={item.status}
                            onValueChange={v => updateItem(item.id, { status: v, is_done: v === "done" })}
                          >
                            <SelectTrigger className="h-7 text-[11px]">
                              <span className={cn("px-1.5 py-0.5 rounded text-[10px] font-medium", STATUS_STYLES[item.status])}>
                                {STATUS_LABELS[item.status]}
                              </span>
                            </SelectTrigger>
                            <SelectContent>
                              {Object.entries(STATUS_LABELS).map(([v, l]) => (
                                <SelectItem key={v} value={v} className="text-xs">{l}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell className="p-1">
                          <Select
                            value={item.priority}
                            onValueChange={v => updateItem(item.id, { priority: v })}
                          >
                            <SelectTrigger className="h-7 text-[11px]">
                              <span className={cn("px-1.5 py-0.5 rounded text-[10px] font-medium", PRIORITY_STYLES[item.priority])}>
                                {item.priority}
                              </span>
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="high" className="text-xs">High</SelectItem>
                              <SelectItem value="normal" className="text-xs">Normal</SelectItem>
                              <SelectItem value="low" className="text-xs">Low</SelectItem>
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell className="p-1">
                          <Input
                            value={item.remarks}
                            onChange={e => updateItem(item.id, { remarks: e.target.value })}
                            className="h-7 text-[11px] border-0 focus-visible:ring-1"
                            placeholder="Remarks…"
                          />
                        </TableCell>
                        <TableCell className="text-center">
                          <Checkbox
                            checked={item.is_done}
                            onCheckedChange={v => updateItem(item.id, { is_done: !!v, status: v ? "done" : "in_progress" })}
                          />
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="ghost" size="icon"
                            className="h-6 w-6 text-destructive hover:text-destructive"
                            onClick={() => deleteItem(item.id)}
                          >
                            <Trash2 size={12} />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                    {sheetItems("worksheet").length === 0 && (
                      <TableRow>
                        <TableCell colSpan={9} className="text-center text-xs text-muted-foreground py-8">
                          No rows yet. Click "Add Row" to start.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ════════════════════════════════════════════════════════════════
            TAB 4: QUERY SHEET
        ════════════════════════════════════════════════════════════════ */}
        <TabsContent value="query_sheet" className="mt-4 space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <h3 className="text-sm font-semibold flex items-center gap-1.5">
                <MessageSquare size={14} className="text-primary" /> Query Sheet
              </h3>
              <p className="text-xs text-muted-foreground">
                All audit queries for this engagement · {closedCount}/{queries.length} resolved
              </p>
            </div>
            <div className="flex gap-2 items-center">
              {master.queries_verified ? (
                <Badge className="gap-1 bg-green-100 text-green-700 border-green-200">
                  <Lock size={10} /> Gate Cleared
                </Badge>
              ) : (
                <Badge variant="outline" className="gap-1 text-amber-600 border-amber-300">
                  <Unlock size={10} /> Gate Pending
                </Badge>
              )}
            </div>
          </div>

          {/* ── Query Gate Card ── */}
          {!master.queries_verified && (
            <Alert className={cn(
              "border",
              allResolved
                ? "border-green-200 bg-green-50 dark:bg-green-950/20"
                : "border-amber-200 bg-amber-50 dark:bg-amber-950/20"
            )}>
              {allResolved ? (
                <CheckCircle2 className="h-4 w-4 text-green-600" />
              ) : (
                <AlertTriangle className="h-4 w-4 text-amber-600" />
              )}
              <AlertTitle className="text-sm">
                {allResolved
                  ? "All queries resolved — ready to clear gate"
                  : `${openQueries.length} open quer${openQueries.length === 1 ? "y" : "ies"} pending`}
              </AlertTitle>
              <AlertDescription className="text-xs">
                {allResolved
                  ? "Click below to verify that all queries have been satisfactorily addressed."
                  : "All queries must be resolved or marked N/A before Stage 6 can be completed."}
                {allResolved && (
                  <div className="mt-2">
                    <Textarea
                      value={master.queries_notes}
                      onChange={e => setM("queries_notes", e.target.value)}
                      placeholder="Optional notes on query resolution…"
                      rows={2}
                      className="text-xs mt-1 mb-2"
                    />
                    <Button size="sm" onClick={verifyQueries} className="gap-1">
                      <CheckCircle2 size={13} /> Verify All Queries Corrected
                    </Button>
                  </div>
                )}
              </AlertDescription>
            </Alert>
          )}

          {master.queries_verified && (
            <Alert className="border-green-200 bg-green-50 dark:bg-green-950/20">
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              <AlertTitle className="text-sm text-green-700">Query Gate Cleared</AlertTitle>
              <AlertDescription className="text-xs text-green-600">
                All queries verified on{" "}
                {master.queries_verified_at
                  ? new Date(master.queries_verified_at).toLocaleDateString("en-IN", { day:"2-digit",month:"short",year:"numeric" })
                  : "—"}.
                {master.queries_notes && <span> Notes: {master.queries_notes}</span>}
                <Button
                  size="sm" variant="ghost"
                  className="ml-2 h-5 text-[10px] text-muted-foreground"
                  onClick={() => { setM("queries_verified", false); saveMaster(); }}
                >
                  Re-open
                </Button>
              </AlertDescription>
            </Alert>
          )}

          {/* ── Queries table ── */}
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-16 text-[11px]">Ref</TableHead>
                    <TableHead className="text-[11px]">Query</TableHead>
                    <TableHead className="text-[11px]">Client Reply</TableHead>
                    <TableHead className="w-24 text-[11px]">Due Date</TableHead>
                    <TableHead className="w-28 text-[11px]">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {queries.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-xs text-muted-foreground py-8">
                        No queries for this engagement. Go to the Query Tracker to add queries.
                      </TableCell>
                    </TableRow>
                  ) : (queries as any[]).map(q => (
                    <TableRow key={q.id} className={cn(
                      q.status === "resolved" || q.status === "closed" ? "opacity-60" : ""
                    )}>
                      <TableCell className="text-[11px] font-mono font-bold">{q.ref_number || "—"}</TableCell>
                      <TableCell className="text-xs">{q.query_text}</TableCell>
                      <TableCell className="text-[11px] text-muted-foreground">{q.client_reply || "—"}</TableCell>
                      <TableCell className="text-[11px]">{q.due_date || "—"}</TableCell>
                      <TableCell className="p-1">
                        <Select
                          value={q.status}
                          onValueChange={v => updateQueryStatus(q.id, v)}
                        >
                          <SelectTrigger className="h-7 text-[11px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {["open","pending","replied","resolved","closed"].map(s => (
                              <SelectItem key={s} value={s} className="text-xs capitalize">{s}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ════════════════════════════════════════════════════════════════
            TAB 5: CHECKLIST
        ════════════════════════════════════════════════════════════════ */}
        <TabsContent value="checklist" className="mt-4 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold flex items-center gap-1.5">
                <FileCheck size={14} className="text-primary" /> Audit Documentation Checklist
              </h3>
              <p className="text-xs text-muted-foreground">
                Track completion of required audit documentation
              </p>
            </div>
            <Badge variant="secondary" className="text-[10px]">
              {sheetItems("checklist").filter(i => i.is_done).length} / {sheetItems("checklist").length} done
            </Badge>
          </div>
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10 text-[11px]">Sr</TableHead>
                    <TableHead className="text-[11px]">Documentation Item</TableHead>
                    <TableHead className="text-[11px]">Remarks</TableHead>
                    <TableHead className="w-28 text-[11px]">Status</TableHead>
                    <TableHead className="w-16 text-[11px] text-center">Done</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sheetItems("checklist").map(item => (
                    <TableRow
                      key={item.id}
                      className={cn(
                        item.is_done
                          ? "bg-green-50/40 dark:bg-green-950/10 opacity-70"
                          : "hover:bg-muted/30"
                      )}
                    >
                      <TableCell className="text-xs text-muted-foreground">{item.sr_no}</TableCell>
                      <TableCell className="text-xs font-medium">
                        <span className={cn(item.is_done && "line-through text-muted-foreground")}>
                          {item.particulars}
                        </span>
                      </TableCell>
                      <TableCell className="p-1">
                        <Input
                          value={item.remarks}
                          onChange={e => updateItem(item.id, { remarks: e.target.value })}
                          className="h-7 text-[11px] border-0 focus-visible:ring-1"
                          placeholder="Remarks / Reference…"
                        />
                      </TableCell>
                      <TableCell className="p-1">
                        <Select
                          value={item.status}
                          onValueChange={v => updateItem(item.id, { status: v, is_done: v === "done" })}
                        >
                          <SelectTrigger className="h-7 text-[11px]">
                            <span className={cn("px-1.5 py-0.5 rounded text-[10px] font-medium", STATUS_STYLES[item.status])}>
                              {STATUS_LABELS[item.status]}
                            </span>
                          </SelectTrigger>
                          <SelectContent>
                            {Object.entries(STATUS_LABELS).map(([v, l]) => (
                              <SelectItem key={v} value={v} className="text-xs">{l}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell className="text-center">
                        <Checkbox
                          checked={item.is_done}
                          onCheckedChange={v =>
                            updateItem(item.id, { is_done: !!v, status: v ? "done" : "pending" })
                          }
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
