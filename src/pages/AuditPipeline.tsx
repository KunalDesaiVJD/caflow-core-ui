import { useState, useEffect, useMemo, useCallback } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useAuditContext } from "@/hooks/useAuditContext";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  CheckCircle2, Circle, Lock, ChevronRight, Plus, ArrowRight,
  Building2, FileText, Calculator, ClipboardCheck, Layers,
  Eye, BarChart3, BookMarked, Shield, Award, CalendarDays
} from "lucide-react";
import { Calendar } from "@/components/ui/calendar";
import { EngagementCARO } from "@/components/engagement/EngagementCARO";
import { EngagementNotesToAccounts } from "@/components/engagement/EngagementNotesToAccounts";
import NotesToAccountsEditor from "@/pages/NotesToAccounts";
import { EngagementReviewSignoff } from "@/components/engagement/EngagementReviewSignoff";
import PipelineStage2 from "@/components/pipeline/PipelineStage2";
import PipelineStage3 from "@/components/pipeline/PipelineStage3";
import PipelineStage4 from "@/components/pipeline/PipelineStage4";
import PipelineStage5 from "@/components/pipeline/PipelineStage5";
import PipelineStage6 from "@/components/pipeline/PipelineStage6";
import PipelineStage7 from "@/components/pipeline/PipelineStage7";

// ─── Constants ───
const STAGES = [
  { num: 1, label: "Engagement Setup", icon: Building2 },
  { num: 2, label: "Trial Balance Import", icon: FileText },
  { num: 3, label: "COA & Financial Statements", icon: Calculator },
  { num: 4, label: "Scrutiny Engine", icon: Eye },
  { num: 5, label: "Query Tracker", icon: ClipboardCheck },
  { num: 6, label: "Workpapers & Risk", icon: Shield },
  { num: 7, label: "Notes to Accounts/CARO", icon: BookMarked },
  { num: 8, label: "3CD Reports", icon: FileText },
  { num: 9, label: "Review & QC", icon: Layers },
  { num: 10, label: "Sign-off & UDIN", icon: Award },
];

const FY_OPTIONS = ["2025-26", "2024-25", "2023-24", "2022-23", "2021-22", "2020-21"];

const ENTITY_TYPES = [
  { value: "company", label: "Company (Pvt/Public)" },
  { value: "llp", label: "LLP" },
  { value: "individual", label: "Individual / Proprietor" },
  { value: "firm", label: "Partnership Firm" },
  { value: "trust", label: "Trust / Society" },
  { value: "huf", label: "HUF" },
  { value: "aop", label: "AOP / BOI" },
];

const AUDIT_TYPES = [
  { value: "statutory", label: "Statutory Audit" },
  { value: "tax_audit", label: "Tax Audit" },
  { value: "both", label: "Both (Statutory + Tax)" },
  { value: "internal", label: "Internal Audit" },
  { value: "stock", label: "Stock Audit" },
];

const PERIOD_TYPES = [
  { value: "annual", label: "Annual" },
  { value: "half_yearly", label: "Half-Yearly" },
  { value: "quarterly", label: "Quarterly" },
];

type StageStatus = "not_started" | "in_progress" | "complete" | "locked";

// ─── Helper ───
function YesNo({ label, value, onChange, hint }: { label: string; value: string; onChange: (v: string) => void; hint?: string }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-sm">{label}</Label>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      <RadioGroup value={value} onValueChange={onChange} className="flex gap-6">
        <div className="flex items-center gap-2"><RadioGroupItem value="yes" /><Label className="cursor-pointer text-sm">Yes</Label></div>
        <div className="flex items-center gap-2"><RadioGroupItem value="no" /><Label className="cursor-pointer text-sm">No</Label></div>
      </RadioGroup>
    </div>
  );
}

// ─── Main ───
export default function AuditPipeline() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { engagementId: routeEngId } = useParams<{ engagementId?: string }>();
  const [searchParams] = useSearchParams();
  const auditCtx = useAuditContext();
  const contextEngId = auditCtx?.selectedEngagementId || "";

  const [selectedEngId, setSelectedEngId] = useState<string>(routeEngId || contextEngId || "");
  const [showNewEng, setShowNewEng] = useState(false);
  const [saving, setSaving] = useState(false);
  const [activeStage, setActiveStage] = useState<number>(() => {
    const sp = searchParams.get("stage");
    return sp ? parseInt(sp, 10) : 1;
  });

  // Sync from audit context when it changes
  useEffect(() => {
    if (contextEngId && !routeEngId && !selectedEngId) {
      setSelectedEngId(contextEngId);
      navigate(`/audit/pipeline/${contextEngId}`, { replace: true });
    }
  }, [contextEngId]);

  // ─── Engagement list ───
  const { data: engagements } = useQuery({
    queryKey: ["audit-engagements-list", user?.firm_id],
    queryFn: async () => {
      const { data } = await supabase
        .from("audit_engagements")
        .select("id, client_id, financial_year, audit_type, pipeline_stage, stage_statuses, final_locked, status, entity_type, clients(name)")
        .eq("firm_id", user!.firm_id!)
        .order("financial_year", { ascending: false });
      return (data || []) as any[];
    },
    enabled: !!user?.firm_id,
  });

  // ─── Audit-eligible clients ───
  const { data: eligibleClients } = useQuery({
    queryKey: ["audit-eligible-clients", user?.firm_id, user?.id],
    queryFn: async () => {
      let query = supabase
        .from("clients")
        .select("id, name, entity_type, statutory_audit_applicable, tax_audit_type")
        .order("name");

      if (user?.firm_id) {
        query = query.eq("firm_id", user.firm_id);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    },
    enabled: !!user?.id,
  });

  // ─── Staff ───
  const { data: firmUsers } = useQuery({
    queryKey: ["firm-users", user?.firm_id],
    queryFn: async () => {
      const { data } = await supabase.from("users").select("id, name, role").eq("firm_id", user!.firm_id!).eq("is_active", true);
      return data || [];
    },
    enabled: !!user?.firm_id,
  });

  // ─── Selected engagement detail ───
  const { data: engagement, refetch: refetchEng } = useQuery({
    queryKey: ["audit-engagement-detail", selectedEngId],
    queryFn: async () => {
      const { data } = await supabase
        .from("audit_engagements")
        .select("*, clients(name, entity_type, caro_applicable, tax_audit_type, pan, gstin)")
        .eq("id", selectedEngId)
        .single();
      return data as any;
    },
    enabled: !!selectedEngId,
  });

  useEffect(() => {
    if (routeEngId) {
      setSelectedEngId(routeEngId);
      if (auditCtx?.setSelectedEngagementId) {
        auditCtx.setSelectedEngagementId(routeEngId);
      }
    }
  }, [routeEngId]);

  const stageStatuses: Record<string, StageStatus> = useMemo(() => {
    if (!engagement?.stage_statuses) {
      return Object.fromEntries(STAGES.map(s => [String(s.num), "not_started"]));
    }
    return engagement.stage_statuses as Record<string, StageStatus>;
  }, [engagement]);

  const currentStage = engagement?.pipeline_stage || 1;

  // Sync active view stage from URL search param or engagement data
  useEffect(() => {
    const sp = searchParams.get("stage");
    if (sp) {
      const stageNum = parseInt(sp, 10);
      if (stageNum >= 1 && stageNum <= 10) {
        setActiveStage(stageNum);
        return;
      }
    }
    setActiveStage(currentStage);
  }, [currentStage, searchParams]);

  // ─── Stage 1 form state ───
  const [form1A, setForm1A] = useState({
    client_id: "", financial_year: "2024-25", audit_period_type: "annual", period_label: "",
    audit_type: "statutory", entity_type: "company",
  });
  const [questionnaire, setQuestionnaire] = useState<Record<string, string>>({});
  const [planning, setPlanning] = useState({
    materiality: "", perf_materiality_pct: "75", team_members: [] as string[],
    key_areas: "", risk_profile: "medium", risk_justification: "",
    expected_completion: "", review_dates: "",
  });

  // Load form from engagement
  useEffect(() => {
    if (!engagement) return;
    setForm1A({
      client_id: engagement.client_id || "",
      financial_year: engagement.financial_year || "2024-25",
      audit_period_type: engagement.audit_period_type || "annual",
      period_label: engagement.period_label || "",
      audit_type: engagement.audit_type || "statutory",
      entity_type: engagement.entity_type || "company",
    });
    if (engagement.questionnaire_answers && typeof engagement.questionnaire_answers === "object") {
      setQuestionnaire(engagement.questionnaire_answers as Record<string, string>);
    }
    if (engagement.materiality) {
      const m = engagement.materiality as any;
      setPlanning(p => ({
        ...p,
        materiality: m.threshold || "",
        perf_materiality_pct: m.perf_pct || "75",
        key_areas: m.key_areas || "",
        risk_profile: engagement.risk_rating || "medium",
        risk_justification: m.risk_justification || "",
        expected_completion: engagement.planned_end || "",
      }));
    }
    if (engagement.team_members) {
      setPlanning(p => ({ ...p, team_members: engagement.team_members || [] }));
    }
  }, [engagement]);

  // Auto-determine flags
  const autoFlags = useMemo(() => {
    const et = form1A.entity_type;
    const at = form1A.audit_type;
    const isCompany = et === "company";
    const isStatutory = at === "statutory" || at === "both";
    const isTaxAudit = at === "tax_audit" || at === "both";
    const turnover = parseFloat(questionnaire.turnover_cy || "0");

    return {
      requires_caro: isCompany && isStatutory,
      requires_3ca: questionnaire.audited_under_other_act === "yes",
      requires_3cb: !isCompany && isTaxAudit && questionnaire.audited_under_other_act !== "yes",
      requires_3cd: isTaxAudit,
      requires_cash_flow: isCompany || (et === "llp" && turnover > 4000000),
      schedule_iii_division: questionnaire.ind_as_applicable === "yes" ? "div_ii" : "div_i",
    };
  }, [form1A.entity_type, form1A.audit_type, questionnaire]);

  const setQ = (key: string, val: string) => setQuestionnaire(q => ({ ...q, [key]: val }));

  // ─── Validation ───
  const block1AValid = form1A.client_id && form1A.financial_year && form1A.entity_type && form1A.audit_type;

  const blockAFields = ["constitution_confirmed", "registered_address", "agm_dates", "board_changes", "regulatory_actions"];
  const blockBFields = ["turnover_cy", "turnover_py", "total_assets", "has_inventory", "capital_transactions", "long_term_borrowings", "director_loans"];
  const blockCFields = ["cash_balance_above_2l", "debtors_above_180", "creditors_msme", "contingent_liabilities", "events_after_reporting"];

  const blockAValid = blockAFields.every(f => questionnaire[f]);
  const blockBValid = blockBFields.every(f => questionnaire[f]);
  const blockCValid = blockCFields.every(f => questionnaire[f]);

  const isCompanyEntity = form1A.entity_type === "company";
  const isTaxAuditReq = form1A.audit_type === "tax_audit" || form1A.audit_type === "both";
  const blockB2Fields = ["fa_register_maintained", "physical_verification", "title_deeds", "working_capital_limits", "loans_directors"];
  const blockB2Valid = !isCompanyEntity || blockB2Fields.every(f => questionnaire[f]);
  const blockDFields = ["turnover_exceeds_limit", "accounting_method", "stock_valuation", "section_40a3", "donations_80g"];
  const blockDValid = !isTaxAuditReq || blockDFields.every(f => questionnaire[f]);

  const questValid = blockAValid && blockBValid && blockCValid && blockB2Valid && blockDValid;
  const canCompleteStage1 = block1AValid && questValid;

  // ─── Create new engagement ───
  const createEngagement = useMutation({
    mutationFn: async () => {
      // Check for duplicate engagement
      const { data: existing } = await supabase
        .from("audit_engagements")
        .select("id")
        .eq("client_id", form1A.client_id)
        .eq("firm_id", user!.firm_id!)
        .eq("financial_year", form1A.financial_year)
        .eq("audit_type", form1A.audit_type)
        .eq("audit_period_type", form1A.audit_period_type)
        .neq("status", "archived")
        .limit(1);
      if (existing && existing.length > 0) {
        throw new Error("An engagement already exists for this client, audit type, financial year, and period.");
      }

      const { data, error } = await supabase.from("audit_engagements").insert({
        client_id: form1A.client_id,
        firm_id: user!.firm_id!,
        financial_year: form1A.financial_year,
        audit_type: form1A.audit_type,
        entity_type: form1A.entity_type,
        audit_period_type: form1A.audit_period_type,
        period_label: form1A.period_label || null,
        status: "planning",
        pipeline_stage: 1,
        stage_statuses: { "1": "in_progress", "2": "not_started", "3": "not_started", "4": "not_started", "5": "not_started", "6": "not_started", "7": "not_started", "8": "not_started", "9": "not_started", "10": "not_started" },
      } as any).select("id").single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      toast.success("Engagement created");
      setSelectedEngId(data.id);
      setShowNewEng(false);
      queryClient.invalidateQueries({ queryKey: ["audit-engagements-list"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  // ─── Save Stage 1 ───
  const saveStage1 = useCallback(async (complete: boolean) => {
    if (!selectedEngId) return;
    setSaving(true);
    const newStatuses = { ...stageStatuses, "1": complete ? "complete" : "in_progress" };

    const payload: Record<string, any> = {
      client_id: form1A.client_id,
      financial_year: form1A.financial_year,
      audit_type: form1A.audit_type,
      entity_type: form1A.entity_type,
      audit_period_type: form1A.audit_period_type,
      period_label: form1A.period_label || null,
      questionnaire_answers: questionnaire,
      stage_statuses: newStatuses,
      pipeline_stage: complete ? 2 : 1,
      requires_caro: autoFlags.requires_caro,
      requires_3ca: autoFlags.requires_3ca,
      requires_3cb: autoFlags.requires_3cb,
      requires_3cd: autoFlags.requires_3cd,
      requires_cash_flow: autoFlags.requires_cash_flow,
      schedule_iii_division: autoFlags.schedule_iii_division,
      caro_applicable: autoFlags.requires_caro,
      risk_rating: planning.risk_profile,
      team_members: planning.team_members,
      planned_end: planning.expected_completion || null,
      materiality: {
        threshold: planning.materiality,
        perf_pct: planning.perf_materiality_pct,
        key_areas: planning.key_areas,
        risk_justification: planning.risk_justification,
        review_dates: planning.review_dates,
      },
    };

    const { error } = await supabase.from("audit_engagements").update(payload as any).eq("id", selectedEngId);
    if (error) { toast.error(error.message); setSaving(false); return; }

    toast.success(complete ? "Stage 1 completed — proceed to TB Import" : "Progress saved");
    refetchEng();
    queryClient.invalidateQueries({ queryKey: ["audit-engagements-list"] });
    setSaving(false);
  }, [selectedEngId, form1A, questionnaire, planning, autoFlags, stageStatuses]);

  const partners = (firmUsers || []).filter(u => u.role === "partner");
  const grouped = useMemo(() => {
    const map = new Map<string, any[]>();
    (engagements || []).forEach(e => {
      const cname = e.clients?.name || "Unknown";
      const arr = map.get(cname) || [];
      arr.push(e);
      map.set(cname, arr);
    });
    return map;
  }, [engagements]);

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      {/* MAIN — Stage Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {!selectedEngId ? (
          <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground gap-4">
            <div className="self-start mb-4">
              <Button variant="ghost" size="sm" onClick={() => navigate('/audit')} className="gap-1 text-xs">
                <ChevronRight size={14} className="rotate-180" /> Back to Audit Dashboard
              </Button>
            </div>
            <Building2 size={48} className="opacity-30" />
            <div>
              <h2 className="text-lg font-semibold text-foreground mb-1">Audit Intelligence Pipeline</h2>
              <p className="text-sm">Select an existing engagement or create a new one to begin.</p>
            </div>
            <Button onClick={() => setShowNewEng(true)} className="gap-2"><Plus size={16} /> New Engagement</Button>
          </div>
        ) : activeStage === 1 ? (
          /* STAGE 1 */
          <div className="max-w-4xl space-y-6">
            <Button variant="ghost" size="sm" onClick={() => navigate('/audit')} className="gap-1 text-xs mb-4">
              <ChevronRight size={14} className="rotate-180" /> Audit Dashboard
            </Button>
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-xl font-bold text-foreground">Engagement Setup & Audit Planning</h1>
                <p className="text-sm text-muted-foreground">Complete the preliminary questionnaire and review the planning calendar.</p>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => saveStage1(false)} disabled={saving}>Save Draft</Button>
                <Button size="sm" onClick={() => saveStage1(true)} disabled={saving || !canCompleteStage1} className="gap-1">
                  Complete & Proceed <ArrowRight size={14} />
                </Button>
              </div>
            </div>

            {/* 1A — Engagement Card (read-only when engagement exists) */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <span className="w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold">A</span>
                  Engagement Card
                  {engagement && <Badge variant="secondary" className="ml-auto text-[10px]"><Lock size={10} className="mr-1 inline" />Locked</Badge>}
                  {!engagement && (block1AValid ? <CheckCircle2 size={16} className="text-primary ml-auto" /> : <span className="text-xs text-destructive ml-auto">Required</span>)}
                </CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label>Client *</Label>
                  {engagement ? (
                    <div className="flex items-center h-10 px-3 rounded-md border border-input bg-muted/50 text-sm text-foreground">
                      {(eligibleClients || []).find(c => c.id === form1A.client_id)?.name || engagement?.clients?.name || form1A.client_id}
                    </div>
                  ) : (
                    <Select value={form1A.client_id} onValueChange={v => setForm1A(f => ({ ...f, client_id: v }))}>
                      <SelectTrigger><SelectValue placeholder="Select client" /></SelectTrigger>
                      <SelectContent>
                        {(eligibleClients || []).length === 0 ? (
                          <div className="px-3 py-2 text-sm text-muted-foreground">No clients found. Add a client first.</div>
                        ) : (
                          (eligibleClients || []).map(c => (
                            <SelectItem key={c.id} value={c.id}>
                              {c.name} {c.entity_type ? `(${c.entity_type})` : ""}
                            </SelectItem>
                          ))
                        )}
                      </SelectContent>
                    </Select>
                  )}
                </div>
                <div>
                  <Label>Financial Year *</Label>
                  {engagement ? (
                    <div className="flex items-center h-10 px-3 rounded-md border border-input bg-muted/50 text-sm text-foreground">{form1A.financial_year}</div>
                  ) : (
                    <Select value={form1A.financial_year} onValueChange={v => setForm1A(f => ({ ...f, financial_year: v }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{FY_OPTIONS.map(f => <SelectItem key={f} value={f}>{f}</SelectItem>)}</SelectContent>
                    </Select>
                  )}
                </div>
                <div>
                  <Label>Entity Type *</Label>
                  {engagement ? (
                    <div className="flex items-center h-10 px-3 rounded-md border border-input bg-muted/50 text-sm text-foreground capitalize">{ENTITY_TYPES.find(t => t.value === form1A.entity_type)?.label || form1A.entity_type}</div>
                  ) : (
                    <Select value={form1A.entity_type} onValueChange={v => setForm1A(f => ({ ...f, entity_type: v }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{ENTITY_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
                    </Select>
                  )}
                </div>
                <div>
                  <Label>Audit Type *</Label>
                  {engagement ? (
                    <div className="flex items-center h-10 px-3 rounded-md border border-input bg-muted/50 text-sm text-foreground capitalize">{AUDIT_TYPES.find(t => t.value === form1A.audit_type)?.label || form1A.audit_type}</div>
                  ) : (
                    <Select value={form1A.audit_type} onValueChange={v => setForm1A(f => ({ ...f, audit_type: v }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{AUDIT_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
                    </Select>
                  )}
                </div>
                <div>
                  <Label>Period Type</Label>
                  {engagement ? (
                    <div className="flex items-center h-10 px-3 rounded-md border border-input bg-muted/50 text-sm text-foreground capitalize">{PERIOD_TYPES.find(t => t.value === form1A.audit_period_type)?.label || form1A.audit_period_type}</div>
                  ) : (
                    <Select value={form1A.audit_period_type} onValueChange={v => setForm1A(f => ({ ...f, audit_period_type: v }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{PERIOD_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
                    </Select>
                  )}
                </div>
                {form1A.audit_period_type !== "annual" && (
                  <div>
                    <Label>Period Label</Label>
                    {engagement ? (
                      <div className="flex items-center h-10 px-3 rounded-md border border-input bg-muted/50 text-sm text-foreground">{form1A.period_label || "—"}</div>
                    ) : (
                      <Select value={form1A.period_label} onValueChange={v => setForm1A(f => ({ ...f, period_label: v }))}>
                        <SelectTrigger><SelectValue placeholder="Select period" /></SelectTrigger>
                        <SelectContent>
                          {form1A.audit_period_type === "half_yearly"
                            ? [<SelectItem key="H1" value="H1">H1</SelectItem>, <SelectItem key="H2" value="H2">H2</SelectItem>]
                            : [<SelectItem key="Q1" value="Q1">Q1</SelectItem>, <SelectItem key="Q2" value="Q2">Q2</SelectItem>, <SelectItem key="Q3" value="Q3">Q3</SelectItem>, <SelectItem key="Q4" value="Q4">Q4</SelectItem>]
                          }
                        </SelectContent>
                      </Select>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* 1B — Questionnaire */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <span className="w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold">B</span>
                  Preliminary Questions
                  {questValid ? <CheckCircle2 size={16} className="text-primary ml-auto" /> : <span className="text-xs text-destructive ml-auto">Required</span>}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Accordion type="multiple" defaultValue={["block-a"]} className="space-y-2">
                  {/* Block A — Legal */}
                  <AccordionItem value="block-a" className="border rounded-lg px-4">
                    <AccordionTrigger className="text-sm font-semibold">
                      Block A — Legal & Constitution
                      {blockAValid && <CheckCircle2 size={14} className="ml-2 text-primary" />}
                    </AccordionTrigger>
                    <AccordionContent className="space-y-4 pt-2">
                      <YesNo label="Constitution confirmed as per records?" value={questionnaire.constitution_confirmed || ""} onChange={v => setQ("constitution_confirmed", v)} />
                      <YesNo label="Registered address verified?" value={questionnaire.registered_address || ""} onChange={v => setQ("registered_address", v)} />
                      <YesNo label="AGM / Meeting dates available?" value={questionnaire.agm_dates || ""} onChange={v => setQ("agm_dates", v)} />
                      <YesNo label="Any board composition changes during the year?" value={questionnaire.board_changes || ""} onChange={v => setQ("board_changes", v)} />
                      <YesNo label="Any regulatory actions / show-cause notices?" value={questionnaire.regulatory_actions || ""} onChange={v => setQ("regulatory_actions", v)} />
                    </AccordionContent>
                  </AccordionItem>

                  {/* Block B — Financial */}
                  <AccordionItem value="block-b" className="border rounded-lg px-4">
                    <AccordionTrigger className="text-sm font-semibold">
                      Block B — Financial Overview
                      {blockBValid && <CheckCircle2 size={14} className="ml-2 text-primary" />}
                    </AccordionTrigger>
                    <AccordionContent className="space-y-4 pt-2">
                      <div className="grid grid-cols-2 gap-3">
                        <div><Label>Turnover (CY) ₹</Label><Input type="number" value={questionnaire.turnover_cy || ""} onChange={e => setQ("turnover_cy", e.target.value)} placeholder="Current year" /></div>
                        <div><Label>Turnover (PY) ₹</Label><Input type="number" value={questionnaire.turnover_py || ""} onChange={e => setQ("turnover_py", e.target.value)} placeholder="Previous year" /></div>
                      </div>
                      <div><Label>Total Assets ₹</Label><Input type="number" value={questionnaire.total_assets || ""} onChange={e => setQ("total_assets", e.target.value)} /></div>
                      <YesNo label="Inventory held at year end?" value={questionnaire.has_inventory || ""} onChange={v => setQ("has_inventory", v)} />
                      <YesNo label="Any capital transactions (issue/buyback of shares, debentures)?" value={questionnaire.capital_transactions || ""} onChange={v => setQ("capital_transactions", v)} />
                      <YesNo label="Long-term borrowings outstanding?" value={questionnaire.long_term_borrowings || ""} onChange={v => setQ("long_term_borrowings", v)} />
                      <YesNo label="Loans to/from directors or related parties?" value={questionnaire.director_loans || ""} onChange={v => setQ("director_loans", v)} />
                    </AccordionContent>
                  </AccordionItem>

                  {/* Block B2 — CARO (Company only) */}
                  {isCompanyEntity && (
                    <AccordionItem value="block-b2" className="border rounded-lg px-4">
                      <AccordionTrigger className="text-sm font-semibold">
                        Block B2 — CARO Applicability
                        {blockB2Valid && <CheckCircle2 size={14} className="ml-2 text-primary" />}
                      </AccordionTrigger>
                      <AccordionContent className="space-y-4 pt-2">
                        <YesNo label="Fixed Assets register maintained?" value={questionnaire.fa_register_maintained || ""} onChange={v => setQ("fa_register_maintained", v)} />
                        <YesNo label="Physical verification of assets conducted?" value={questionnaire.physical_verification || ""} onChange={v => setQ("physical_verification", v)} />
                        <YesNo label="Title deeds available for immovable properties?" value={questionnaire.title_deeds || ""} onChange={v => setQ("title_deeds", v)} />
                        <YesNo label="Working capital limits from banks?" value={questionnaire.working_capital_limits || ""} onChange={v => setQ("working_capital_limits", v)} />
                        <YesNo label="Loans given/taken from directors?" value={questionnaire.loans_directors || ""} onChange={v => setQ("loans_directors", v)} />
                      </AccordionContent>
                    </AccordionItem>
                  )}

                  {/* Block C — Balance Sheet */}
                  <AccordionItem value="block-c" className="border rounded-lg px-4">
                    <AccordionTrigger className="text-sm font-semibold">
                      Block C — Balance Sheet Items
                      {blockCValid && <CheckCircle2 size={14} className="ml-2 text-primary" />}
                    </AccordionTrigger>
                    <AccordionContent className="space-y-4 pt-2">
                      <YesNo label="Cash balance > ₹2 Lakhs at year end?" value={questionnaire.cash_balance_above_2l || ""} onChange={v => setQ("cash_balance_above_2l", v)} />
                      <YesNo label="Debtors outstanding > 180 days?" value={questionnaire.debtors_above_180 || ""} onChange={v => setQ("debtors_above_180", v)} />
                      <YesNo label="Any MSME creditors?" value={questionnaire.creditors_msme || ""} onChange={v => setQ("creditors_msme", v)} hint="Disclosure required under MSMED Act" />
                      <YesNo label="Contingent liabilities exist?" value={questionnaire.contingent_liabilities || ""} onChange={v => setQ("contingent_liabilities", v)} />
                      <YesNo label="Events after reporting period requiring disclosure?" value={questionnaire.events_after_reporting || ""} onChange={v => setQ("events_after_reporting", v)} />
                    </AccordionContent>
                  </AccordionItem>

                  {/* Block D — Tax Audit (conditional) */}
                  {isTaxAuditReq && (
                    <AccordionItem value="block-d" className="border rounded-lg px-4">
                      <AccordionTrigger className="text-sm font-semibold">
                        Block D — Tax Audit Specifics
                        {blockDValid && <CheckCircle2 size={14} className="ml-2 text-primary" />}
                      </AccordionTrigger>
                      <AccordionContent className="space-y-4 pt-2">
                        <YesNo label="Turnover exceeds ₹1Cr (Business) or ₹50L (Profession)?" value={questionnaire.turnover_exceeds_limit || ""} onChange={v => setQ("turnover_exceeds_limit", v)} />
                        <div>
                          <Label>Method of Accounting</Label>
                          <Select value={questionnaire.accounting_method || ""} onValueChange={v => setQ("accounting_method", v)}>
                            <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="mercantile">Mercantile</SelectItem>
                              <SelectItem value="cash">Cash</SelectItem>
                              <SelectItem value="hybrid">Hybrid</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <Label>Stock Valuation Method</Label>
                          <Select value={questionnaire.stock_valuation || ""} onValueChange={v => setQ("stock_valuation", v)}>
                            <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="fifo">FIFO</SelectItem>
                              <SelectItem value="weighted_avg">Weighted Average</SelectItem>
                              <SelectItem value="specific_id">Specific Identification</SelectItem>
                              <SelectItem value="na">N/A</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <YesNo label="Any Section 40A(3) cash payments > ₹10,000?" value={questionnaire.section_40a3 || ""} onChange={v => setQ("section_40a3", v)} />
                        <YesNo label="Donations eligible u/s 80G?" value={questionnaire.donations_80g || ""} onChange={v => setQ("donations_80g", v)} />
                      </AccordionContent>
                    </AccordionItem>
                  )}

                  {/* Block E — Period-specific */}
                  {form1A.audit_period_type !== "annual" && (
                    <AccordionItem value="block-e" className="border rounded-lg px-4">
                      <AccordionTrigger className="text-sm font-semibold">Block E — Period-specific</AccordionTrigger>
                      <AccordionContent className="space-y-4 pt-2">
                        <YesNo label="Does a previous period engagement exist?" value={questionnaire.prev_period_exists || ""} onChange={v => setQ("prev_period_exists", v)} />
                        {questionnaire.prev_period_exists === "yes" && (
                          <YesNo label="Import queries from previous period?" value={questionnaire.import_prev_queries || ""} onChange={v => setQ("import_prev_queries", v)} />
                        )}
                      </AccordionContent>
                    </AccordionItem>
                  )}
                </Accordion>
              </CardContent>
            </Card>

            {/* Planning Calendar */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <CalendarDays size={18} className="text-primary" />
                  Audit Planning Calendar
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-col lg:flex-row gap-6">
                  <div className="shrink-0">
                    <Calendar mode="single" className="rounded-md border" />
                  </div>
                  <div className="flex-1 space-y-4">
                    <h4 className="text-sm font-semibold text-foreground">Engagement Milestones</h4>
                    <div className="space-y-3">
                      <div className="flex items-center gap-3 p-2.5 rounded-md bg-muted/50">
                        <CalendarDays size={14} className="text-primary shrink-0" />
                        <div>
                          <p className="text-xs text-muted-foreground">Planned Start</p>
                          <p className="text-sm font-medium text-foreground">{engagement?.planned_start || "Not set"}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 p-2.5 rounded-md bg-muted/50">
                        <CalendarDays size={14} className="text-primary shrink-0" />
                        <div>
                          <p className="text-xs text-muted-foreground">Expected Completion</p>
                          <p className="text-sm font-medium text-foreground">{planning.expected_completion || engagement?.planned_end || "Not set"}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 p-2.5 rounded-md bg-muted/50">
                        <Shield size={14} className="text-primary shrink-0" />
                        <div>
                          <p className="text-xs text-muted-foreground">Risk Profile</p>
                          <p className="text-sm font-medium text-foreground capitalize">{planning.risk_profile || "Medium"}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 p-2.5 rounded-md bg-muted/50">
                        <Building2 size={14} className="text-primary shrink-0" />
                        <div>
                          <p className="text-xs text-muted-foreground">Team Members</p>
                          <p className="text-sm font-medium text-foreground">
                            {planning.team_members.length > 0
                              ? `${planning.team_members.length} assigned`
                              : "None assigned"}
                          </p>
                        </div>
                      </div>
                    </div>
                    <Separator />
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <Label className="text-xs">Materiality Threshold (₹)</Label>
                        <Input type="number" value={planning.materiality} onChange={e => setPlanning(p => ({ ...p, materiality: e.target.value }))} placeholder="Absolute amount" />
                      </div>
                      <div>
                        <Label className="text-xs">Expected Completion</Label>
                        <Input type="date" value={planning.expected_completion} onChange={e => setPlanning(p => ({ ...p, expected_completion: e.target.value }))} />
                      </div>
                      <div>
                        <Label className="text-xs">Risk Profile</Label>
                        <Select value={planning.risk_profile} onValueChange={v => setPlanning(p => ({ ...p, risk_profile: v }))}>
                          <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="low">Low</SelectItem>
                            <SelectItem value="medium">Medium</SelectItem>
                            <SelectItem value="high">High</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label className="text-xs">Engagement Team</Label>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {(firmUsers || []).slice(0, 6).map(u => {
                            const selected = planning.team_members.includes(u.id);
                            return (
                              <Badge
                                key={u.id}
                                variant={selected ? "default" : "outline"}
                                className="cursor-pointer text-[10px]"
                                onClick={() => setPlanning(p => ({
                                  ...p,
                                  team_members: selected ? p.team_members.filter(id => id !== u.id) : [...p.team_members, u.id],
                                }))}
                              >
                                {u.name}
                              </Badge>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Bottom actions */}
            <div className="flex justify-end gap-3 pb-8">
              <Button variant="outline" onClick={() => saveStage1(false)} disabled={saving}>Save Draft</Button>
              <Button onClick={() => saveStage1(true)} disabled={saving || !canCompleteStage1} className="gap-1">
                Complete Stage 1 & Proceed <ArrowRight size={14} />
              </Button>
            </div>
          </div>
        ) : activeStage === 2 ? (
          /* STAGE 2 — Trial Balance Import */
          <PipelineStage2
            engagementId={selectedEngId}
            engagement={engagement}
            onStageComplete={() => { refetchEng(); queryClient.invalidateQueries({ queryKey: ["audit-engagements-list"] }); }}
            onSaveDraft={() => { refetchEng(); }}
          />
        ) : activeStage === 3 ? (
          /* STAGE 3 — COA & Financial Statements */
          <PipelineStage3
            engagementId={selectedEngId}
            engagement={engagement}
            onStageComplete={() => { refetchEng(); queryClient.invalidateQueries({ queryKey: ["audit-engagements-list"] }); }}
            onSaveDraft={() => { refetchEng(); }}
          />
        ) : activeStage === 4 ? (
          <PipelineStage4
            engagementId={selectedEngId}
            engagement={engagement}
            onStageComplete={() => { refetchEng(); queryClient.invalidateQueries({ queryKey: ["audit-engagements-list"] }); }}
            onSaveDraft={() => { refetchEng(); }}
          />
        ) : activeStage === 5 ? (
          <PipelineStage5
            engagementId={selectedEngId}
            engagement={engagement}
            onStageComplete={() => { refetchEng(); queryClient.invalidateQueries({ queryKey: ["audit-engagements-list"] }); }}
            onSaveDraft={() => { refetchEng(); }}
          />
        ) : activeStage === 6 ? (
          <PipelineStage6
            engagementId={selectedEngId}
            engagement={engagement}
            onStageComplete={() => { refetchEng(); queryClient.invalidateQueries({ queryKey: ["audit-engagements-list"] }); }}
            onSaveDraft={() => { refetchEng(); }}
          />
        ) : activeStage === 7 ? (
          <Tabs defaultValue="notes_editor">
            <TabsList>
              <TabsTrigger value="notes_editor">Notes to Accounts</TabsTrigger>
              <TabsTrigger value="accounting_policies">Accounting Policies (Note 1 & 2)</TabsTrigger>
            </TabsList>
            <TabsContent value="notes_editor" className="mt-4">
              <NotesToAccountsEditor engagementIdProp={selectedEngId} onFinalise={() => { refetchEng(); queryClient.invalidateQueries({ queryKey: ["audit-engagements-list"] }); }} />
            </TabsContent>
            <TabsContent value="accounting_policies" className="mt-4">
              <PipelineStage7
                engagementId={selectedEngId}
                engagement={engagement}
                onStageComplete={() => { refetchEng(); queryClient.invalidateQueries({ queryKey: ["audit-engagements-list"] }); }}
                onSaveDraft={() => { refetchEng(); }}
              />
            </TabsContent>
          </Tabs>
        ) : activeStage === 8 ? (
          /* STAGE 8 — CARO / 3CD */
          <div className="max-w-5xl space-y-6">
            <Button variant="ghost" size="sm" onClick={() => navigate('/audit')} className="gap-1 text-xs mb-4">
              <ChevronRight size={14} className="rotate-180" /> Back to Audit Dashboard
            </Button>
            <h1 className="text-xl font-bold text-foreground">CARO / 3CD Reports</h1>

            <Tabs defaultValue="caro">
              <TabsList>
                <TabsTrigger value="caro">CARO 2020</TabsTrigger>
                <TabsTrigger
                  value="3cd"
                  disabled={!(engagement?.audit_type === "tax_audit" || engagement?.audit_type === "both" || engagement?.requires_3cd || engagement?.clients?.tax_audit_type)}
                >
                  Form 3CD
                </TabsTrigger>
              </TabsList>

              <TabsContent value="caro" className="mt-4">
                {(engagement?.caro_applicable || engagement?.requires_caro || engagement?.clients?.caro_applicable) ? (
                  <EngagementCARO engagement={engagement} client={engagement?.clients} onUpdate={() => refetchEng()} />
                ) : (
                  <Card><CardContent className="p-8 text-center text-muted-foreground">CARO is not applicable for this engagement.</CardContent></Card>
                )}
              </TabsContent>

              <TabsContent value="3cd" className="mt-4">
                {(engagement?.audit_type === "tax_audit" || engagement?.audit_type === "both" || engagement?.requires_3cd || engagement?.clients?.tax_audit_type) ? (
                  <Card>
                    <CardContent className="p-6 space-y-3">
                      <h2 className="text-lg font-semibold">Form 3CD — Tax Audit Report</h2>
                      <p className="text-sm text-muted-foreground">
                        {engagement?.clients?.tax_audit_type === "3cb_3cd"
                          ? "3CB + 3CD applicable (Non-corporate entity)"
                          : engagement?.clients?.tax_audit_type === "3ca_3cd"
                          ? "3CA + 3CD applicable (Audited under other law)"
                          : "Tax Audit — Form 3CD"}
                      </p>
                      <Button onClick={() => navigate(`/audit/3cd?engagementId=${selectedEngId}`)} className="gap-2">
                        <FileText size={16} /> Open Form 3CD Editor
                      </Button>
                    </CardContent>
                  </Card>
                ) : (
                  <Card>
                    <CardContent className="p-8 text-center text-muted-foreground">
                      Form 3CD is applicable only for Tax Audit engagements (Section 44AB).
                    </CardContent>
                  </Card>
                )}
              </TabsContent>
            </Tabs>
          </div>
        ) : activeStage === 9 ? (
          /* STAGE 9 — Review & QC */
          <div className="max-w-4xl space-y-6">
            <Button variant="ghost" size="sm" onClick={() => navigate('/audit')} className="gap-1 text-xs mb-4">
              <ChevronRight size={14} className="rotate-180" /> Back to Audit Dashboard
            </Button>
            <h1 className="text-xl font-bold text-foreground">Review & QC</h1>
            <Card><CardContent className="p-6 space-y-4">
              <p className="text-sm text-muted-foreground">Generate and review audit reports for this engagement.</p>
              <Button onClick={() => navigate("/audit/report")} className="gap-2">
                <FileText size={16} /> Open Report Engine
              </Button>
            </CardContent></Card>
          </div>
        ) : activeStage === 10 ? (
          /* STAGE 10 — Sign-Off & UDIN */
          <div className="max-w-4xl space-y-6">
            <Button variant="ghost" size="sm" onClick={() => navigate('/audit')} className="gap-1 text-xs mb-4">
              <ChevronRight size={14} className="rotate-180" /> Back to Audit Dashboard
            </Button>
            <h1 className="text-xl font-bold text-foreground">Sign-off & UDIN</h1>
            <EngagementReviewSignoff engagement={engagement} client={engagement?.clients} partner={null} onUpdate={() => refetchEng()} />
          </div>
        ) : null}
      </div>

      {/* New Engagement Dialog */}
      <Dialog open={showNewEng} onOpenChange={setShowNewEng}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Create New Audit Engagement</DialogTitle>
            <DialogDescription>Select a client with Statutory or Tax Audit activated</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div>
              <Label>Client *</Label>
              <Select value={form1A.client_id} onValueChange={v => setForm1A(f => ({ ...f, client_id: v }))}>
                <SelectTrigger><SelectValue placeholder="Select client" /></SelectTrigger>
                <SelectContent>
                  {(eligibleClients || []).length === 0 ? (
                    <div className="px-3 py-2 text-sm text-muted-foreground">No clients found. Add a client first.</div>
                  ) : (
                    (eligibleClients || []).map(c => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name} {c.entity_type ? `(${c.entity_type})` : ""}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Financial Year *</Label>
              <Select value={form1A.financial_year} onValueChange={v => setForm1A(f => ({ ...f, financial_year: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{FY_OPTIONS.map(f => <SelectItem key={f} value={f}>{f}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Audit Type</Label>
              <Select value={form1A.audit_type} onValueChange={v => setForm1A(f => ({ ...f, audit_type: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{AUDIT_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Entity Type</Label>
              <Select value={form1A.entity_type} onValueChange={v => setForm1A(f => ({ ...f, entity_type: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{ENTITY_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNewEng(false)}>Cancel</Button>
            <Button onClick={() => createEngagement.mutate()} disabled={!form1A.client_id}>Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
