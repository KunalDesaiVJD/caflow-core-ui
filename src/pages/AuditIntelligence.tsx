import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { usePermissions } from "@/hooks/usePermissions";
import { useAuditContext } from "@/hooks/useAuditContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import {
  Building2, FileText, Calculator, Eye, ClipboardCheck, Shield,
  BookMarked, Layers, Award, ChevronRight, Plus,
  CalendarDays, CheckCircle2, Circle, Loader2,
  MoreVertical, Pencil, Trash2, ChevronsUpDown, Check
} from "lucide-react";
import { toast } from "sonner";

// ─── Stage definitions ───
const STAGES = [
  { num: 1,  label: "Engagement Setup",           icon: Building2      },
  { num: 2,  label: "Trial Balance Import",        icon: FileText       },
  { num: 3,  label: "COA & Financial Statements",  icon: Calculator     },
  { num: 4,  label: "Scrutiny Engine",             icon: Eye            },
  { num: 5,  label: "Query Tracker",               icon: ClipboardCheck },
  { num: 6,  label: "Workpapers & Audit Sheet",    icon: Shield         },
  { num: 7,  label: "Notes to Accounts & CARO",    icon: BookMarked     },
  { num: 8,  label: "3CA / 3CB / 3CD Reports",     icon: FileText       },
  { num: 9,  label: "Sign-off & UDIN",             icon: Award          },
];


const FY_OPTIONS = ["2025-26", "2024-25", "2023-24", "2022-23", "2021-22", "2020-21"];
const AUDIT_TYPES = [
  { value: "statutory", label: "Statutory Audit" },
  { value: "tax_audit", label: "Tax Audit" },
  { value: "both", label: "Both (Statutory + Tax)" },
  { value: "internal", label: "Internal Audit" },
  { value: "stock", label: "Stock Audit" },
];
const PERIOD_TYPES = [
  { value: "annual",      label: "Full Year" },
  { value: "half_yearly", label: "Half Year" },
  { value: "quarterly",   label: "Quarter"   },
  { value: "custom",      label: "Custom"    },
];
const ENTITY_TYPES = [
  { value: "company", label: "Company (Pvt/Public)" },
  { value: "llp", label: "LLP" },
  { value: "individual", label: "Individual / Proprietor" },
  { value: "firm", label: "Partnership Firm" },
  { value: "trust", label: "Trust / Society" },
  { value: "huf", label: "HUF" },
  { value: "aop", label: "AOP / BOI" },
];

const statusLabel: Record<string, string> = {
  not_started: "Not Started",
  in_progress: "In Progress",
  complete: "Completed",
};

// ─── Filter audit types by client's audit setup ───
function getAuditOptionsForClient(client: any) {
  if (!client) return AUDIT_TYPES;
  const opts: { value: string; label: string }[] = [];
  const hasStat = !!client.statutory_audit_applicable || !!client.has_statutory_service;
  const hasTax  = !!client.tax_audit_applicable || !!client.tax_audit_type || !!client.has_tax_audit_service;
  if (hasStat)           opts.push({ value: "statutory", label: "Statutory Audit" });
  if (hasTax)            opts.push({ value: "tax_audit", label: "Tax Audit" });
  if (hasStat && hasTax) opts.push({ value: "both",      label: "Both (Statutory + Tax)" });
  if (client.internal_audit_applicable || client.has_internal_audit_service)
                         opts.push({ value: "internal",  label: "Internal Audit" });
  if (client.stock_audit_applicable)
                         opts.push({ value: "stock",     label: "Stock Audit" });
  // Fallback: classification-only clients (no specific flags set) — offer all types
  if (opts.length === 0) return AUDIT_TYPES;
  return opts;
}

export default function AuditIntelligence() {
  const { user } = useAuth();
  const { can } = usePermissions();
  const canCreateEngagement = can("Audit Intelligence", "can_create") || user?.role === "superadmin";
  const navigate = useNavigate();
  const {
    selectedClientId, setSelectedClientId,
    selectedEngagementId, setSelectedEngagementId,
    clients, engagements, selectedEngagement, loading,
    refreshEngagements,
  } = useAuditContext();

  const [users, setUsers] = useState<{ id: string; name: string | null; role: string | null }[]>([]);
  const [auditFirms, setAuditFirms] = useState<{ id: string; name: string }[]>([]);
  const [metrics, setMetrics] = useState({ ledgers: 0, queriesRaised: 0, queriesPending: 0, workpapers: 0, caroCompleted: 0 });

  // #1 — clients from context are already filtered to audit-eligible (see useAuditContext)
  const auditClients = clients;

  // Dialogs
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [formSaving, setFormSaving] = useState(false);

  // Filters
  const [filterAuditType, setFilterAuditType] = useState<string>("all");
  const [filterFY, setFilterFY] = useState<string>("all");
  const [filterPeriodType, setFilterPeriodType] = useState<string>("all");

  // Searchable client dropdown
  const [clientOpen, setClientOpen] = useState(false);

  // Edit form — must be declared BEFORE editDialogClients useMemo
  const [engForm, setEngForm] = useState({
    audit_firm_id: "", client_id: "", financial_year: "2024-25", audit_type: "statutory",
    entity_type: "company", audit_period_type: "annual", partner_id: "",
  });

  // For the Edit Engagement dialog: always include the existing engagement's client
  // even if it no longer passes the audit eligibility filter.
  // IMPORTANT: must come AFTER engForm useState declaration.
  const editDialogClients = useMemo(() => {
    if (!engForm.client_id) return auditClients;
    const alreadyIncluded = auditClients.some(c => c.id === engForm.client_id);
    if (alreadyIncluded) return auditClients;
    const engClientName = selectedEngagement?.client_name || (selectedEngagement?.clients as any)?.name || "";
    const engClientType = selectedEngagement?.client_entity_type || selectedEngagement?.entity_type || "";
    return [
      { id: engForm.client_id, name: engClientName, entity_type: engClientType },
      ...auditClients,
    ];
  }, [auditClients, engForm.client_id, selectedEngagement]);

  useEffect(() => {
    if (!user?.firm_id) return;
    supabase.from("users").select("id, name, role").eq("firm_id", user.firm_id).eq("is_active", true)
      .then(({ data }) => setUsers(data || []));
  }, [user?.firm_id]);

  useEffect(() => {
    if (!user?.id) return;
    let q = supabase.from("audit_firms").select("id, name").neq("active", false).order("name");
    if (user.role !== "superadmin" && user.firm_id) {
      q = q.eq("firm_id", user.firm_id) as typeof q;
    }
    q.then(({ data }) => setAuditFirms(data || []));
  }, [user?.id, user?.firm_id, user?.role]);

  useEffect(() => {
    if (!selectedEngagementId) return;
    loadMetrics(selectedEngagementId);
  }, [selectedEngagementId]);

  const loadMetrics = async (engId: string) => {
    const [queriesRes, workpapersRes, caroRes] = await Promise.all([
      supabase.from("audit_client_queries").select("id, status", { count: "exact" }).eq("engagement_id", engId),
      supabase.from("audit_workpapers").select("id", { count: "exact" }).eq("engagement_id", engId),
      supabase.from("audit_caro_responses").select("id, status", { count: "exact" }).eq("engagement_id", engId),
    ]);
    const queries = queriesRes.data || [];
    const caroRows = caroRes.data || [];
    setMetrics({
      ledgers: 0,
      queriesRaised: queries.length,
      queriesPending: queries.filter(q => q.status === "Open" || q.status === "Pending").length,
      workpapers: workpapersRes.count || 0,
      caroCompleted: caroRows.filter(c => c.status === "completed" || c.status === "reviewed").length,
    });
  };

  // Filter engagements by all 4 filters and auto-resolve
  const filteredEngagements = useMemo(() => {
    let result = engagements.filter(e => e.status !== "archived");
    if (selectedClientId && selectedClientId !== "all") {
      result = result.filter(e => e.client_id === selectedClientId);
    }
    if (filterAuditType && filterAuditType !== "all") {
      result = result.filter(e => e.audit_type === filterAuditType);
    }
    if (filterFY && filterFY !== "all") {
      result = result.filter(e => e.financial_year === filterFY);
    }
    if (filterPeriodType && filterPeriodType !== "all") {
      result = result.filter(e => (e.audit_period_type || "annual") === filterPeriodType);
    }
    return result;
  }, [engagements, selectedClientId, filterAuditType, filterFY, filterPeriodType]);

  // Deduplicate: use a Set to track unique combos
  const uniqueFilteredEngagements = useMemo(() => {
    const seen = new Set<string>();
    return filteredEngagements.filter(e => {
      const key = `${e.client_id}_${e.audit_type}_${e.financial_year}_${e.audit_period_type || "annual"}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [filteredEngagements]);

  // Auto-select engagement when filters narrow to exactly one
  useEffect(() => {
    if (uniqueFilteredEngagements.length === 1) {
      const eng = uniqueFilteredEngagements[0];
      if (eng.id !== selectedEngagementId) {
        setSelectedEngagementId(eng.id);
      }
    }
  }, [uniqueFilteredEngagements]);

  const stageStatuses = selectedEngagement?.stage_statuses || {};
  const completedStages = Object.values(stageStatuses).filter((s: any) => s === "complete").length;
  const progressPct = Math.round((completedStages / 9) * 100);

  const getStageColor = (status: string) => {
    if (status === "complete") return "bg-emerald-500";
    if (status === "in_progress") return "bg-amber-500";
    return "bg-muted";
  };
  const getStageTextColor = (status: string) => {
    if (status === "complete") return "text-emerald-600";
    if (status === "in_progress") return "text-amber-600";
    return "text-muted-foreground";
  };

  const handleStageClick = async (stage: typeof STAGES[0]) => {
    if (!selectedEngagementId) {
      toast.error("Please select an engagement first");
      return;
    }
    await supabase
      .from("audit_engagements")
      .update({ pipeline_stage: stage.num } as any)
      .eq("id", selectedEngagementId);
    navigate(`/audit/pipeline/${selectedEngagementId}?stage=${stage.num}`);
  };

  // ─── Edit Engagement ───
  const openEditDialog = (eng?: any) => {
    const target = eng || selectedEngagement;
    if (!target) return;
    setEngForm({
      audit_firm_id: target.audit_firm_id || "",
      client_id: target.client_id || "",
      financial_year: target.financial_year || "2024-25",
      audit_type: target.audit_type || "statutory",
      entity_type: target.entity_type || target.client_entity_type || "",
      audit_period_type: target.audit_period_type || "annual",
      partner_id: target.partner_id || "",
    });
    setShowEditDialog(true);
  };
  const handleEdit = async () => {
    if (!selectedEngagementId) return;
    setFormSaving(true);
    const { error } = await supabase.from("audit_engagements").update({
      audit_firm_id: engForm.audit_firm_id || null,
      client_id: engForm.client_id,
      financial_year: engForm.financial_year,
      audit_type: engForm.audit_type,
      entity_type: engForm.entity_type,
      audit_period_type: engForm.audit_period_type,
      partner_id: engForm.partner_id || null,
    } as any).eq("id", selectedEngagementId);
    setFormSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Engagement updated");
    setShowEditDialog(false);
    refreshEngagements();
  };

  // ─── Delete Engagement ───
  const handleDelete = async () => {
    if (!selectedEngagementId) return;
    setFormSaving(true);
    const { error } = await supabase.from("audit_engagements").update({
      status: "archived",
    } as any).eq("id", selectedEngagementId);
    setFormSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Engagement archived");
    setShowDeleteDialog(false);
    setSelectedEngagementId("");
    refreshEngagements();
  };

  const userMap = useMemo(() => new Map(users.map(u => [u.id, u.name])), [users]);

  // Partners = firm_admin + partner_ca roles (eligible engagement partners)
  const partners = useMemo(
    () => users.filter(u => u.role === "partner_ca" || u.role === "firm_admin" || u.role === "superadmin"),
    [users]
  );

  const selectedClientName = useMemo(() => {
    if (!selectedClientId || selectedClientId === "all") return "";
    return auditClients.find(c => c.id === selectedClientId)?.name || "";
  }, [selectedClientId, auditClients]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-display font-bold text-foreground">Audit Intelligence</h1>
          <p className="text-sm text-muted-foreground">Engagement dashboard, progress tracking & audit analytics</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() =>
            navigate(selectedEngagementId
              ? `/audit/pipeline/${selectedEngagementId}`
              : '/audit/pipeline')
          }>
            <Layers className="mr-2 h-4 w-4" /> Pipeline View
          </Button>
          {canCreateEngagement && <Button onClick={() => navigate('/audit/pipeline?new=1')}>
            <Plus className="mr-2 h-4 w-4" /> New Engagement
          </Button>}
        </div>
      </div>

      {/* 4-Filter Engagement Switcher */}
      <Card className="p-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 items-end">
          {/* Client Filter */}
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5 block">Client</label>
            <Popover open={clientOpen} onOpenChange={setClientOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" role="combobox" aria-expanded={clientOpen} className="w-full justify-between font-normal">
                  {selectedClientName || "All Clients"}
                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[300px] p-0" align="start">
                <Command>
                  <CommandInput placeholder="Search clients..." />
                  <CommandList>
                    <CommandEmpty>No clients found.</CommandEmpty>
                    <CommandGroup>
                      <CommandItem
                        value="all-clients"
                        onSelect={() => {
                          setSelectedClientId("all");
                          setClientOpen(false);
                        }}
                      >
                        <Check className={cn("mr-2 h-4 w-4", (!selectedClientId || selectedClientId === "all") ? "opacity-100" : "opacity-0")} />
                        All Clients
                      </CommandItem>
                      {auditClients.map(c => (
                        <CommandItem
                          key={c.id}
                          value={c.name || c.id}
                          onSelect={() => {
                            setSelectedClientId(c.id);
                            setClientOpen(false);
                          }}
                        >
                          <Check className={cn("mr-2 h-4 w-4", selectedClientId === c.id ? "opacity-100" : "opacity-0")} />
                          {c.name || "Unnamed"}
                          {c.entity_type && <Badge variant="secondary" className="ml-auto text-[10px]">{c.entity_type}</Badge>}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>

          {/* Audit Type Filter */}
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5 block">Audit Type</label>
            <Select value={filterAuditType} onValueChange={setFilterAuditType}>
              <SelectTrigger><SelectValue placeholder="All Types" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                {AUDIT_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {/* Financial Year Filter */}
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5 block">Financial Year</label>
            <Select value={filterFY} onValueChange={setFilterFY}>
              <SelectTrigger><SelectValue placeholder="All Years" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Years</SelectItem>
                {FY_OPTIONS.map(f => <SelectItem key={f} value={f}>{f}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {/* Period Type Filter */}
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5 block">Period Type</label>
            <Select value={filterPeriodType} onValueChange={setFilterPeriodType}>
              <SelectTrigger><SelectValue placeholder="All Periods" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Periods</SelectItem>
                {PERIOD_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Resolved engagement info */}
        {uniqueFilteredEngagements.length > 1 && (
          <div className="mt-3 pt-3 border-t border-border">
            <p className="text-xs text-muted-foreground mb-2">{uniqueFilteredEngagements.length} engagements match. Select one:</p>
            <div className="flex flex-wrap gap-2">
              {uniqueFilteredEngagements.map(e => (
                <Button
                  key={e.id}
                  variant={e.id === selectedEngagementId ? "default" : "outline"}
                  size="sm"
                  className="text-xs"
                  onClick={() => setSelectedEngagementId(e.id)}
                >
                  {e.client_name} — {e.audit_type || "Audit"} — FY {e.financial_year}
                </Button>
              ))}
            </div>
          </div>
        )}
        {selectedEngagement && (
          <div className="mt-3 pt-3 border-t border-border flex items-center justify-between">
            <p className="text-sm text-foreground font-medium">
              Active: <span className="text-primary">{selectedEngagement.client_name} — {selectedEngagement.audit_type || "Audit"} — FY {selectedEngagement.financial_year}</span>
            </p>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" className="shrink-0 h-8 w-8">
                  <MoreVertical size={14} />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={openEditDialog}>
                  <Pencil size={14} className="mr-2" /> Edit Engagement
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setShowDeleteDialog(true)} className="text-destructive focus:text-destructive">
                  <Trash2 size={14} className="mr-2" /> Archive Engagement
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </Card>

      {!selectedEngagement ? (
        <Card className="p-12 text-center">
          <Building2 className="h-12 w-12 mx-auto text-muted-foreground/40 mb-4" />
          <h3 className="text-lg font-semibold text-foreground mb-1">Select an Engagement</h3>
          <p className="text-sm text-muted-foreground mb-4">Use the filters above to narrow down and select an engagement.</p>
          {canCreateEngagement && <Button onClick={() => navigate('/audit/pipeline?new=1')}>
            <Plus className="mr-2 h-4 w-4" /> Create New Engagement
          </Button>}
        </Card>
      ) : (
        <>
          {/* Engagement Summary Panel */}
          <div className="grid gap-4 md:grid-cols-5">
            <Card className="p-4 space-y-1">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Client</p>
              <p className="text-sm font-semibold text-foreground">{selectedEngagement.client_name}</p>
              {selectedEngagement.client_entity_type && (
                <Badge variant="secondary" className="text-[10px] capitalize">{selectedEngagement.client_entity_type}</Badge>
              )}
            </Card>
            <Card className="p-4 space-y-1">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Financial Year</p>
              <p className="text-sm font-semibold text-foreground">FY {selectedEngagement.financial_year || "—"}</p>
            </Card>
            <Card className="p-4 space-y-1">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Audit Type</p>
              <p className="text-sm font-semibold text-foreground capitalize">{selectedEngagement.audit_type || "Statutory"}</p>
            </Card>
            <Card className="p-4 space-y-1">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Status</p>
              <Badge
                variant={selectedEngagement.status === "signed" || selectedEngagement.status === "complete" ? "default" : "outline"}
                className="capitalize"
              >
                {selectedEngagement.final_locked ? "✅ Completed" : selectedEngagement.status || "Planning"}
              </Badge>
            </Card>
            <Card className="p-4 space-y-1">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Partner</p>
              <p className="text-sm font-semibold text-foreground">{userMap.get(selectedEngagement.partner_id) || "—"}</p>
            </Card>
          </div>

          {/* 9-Stage Audit Progress Tracker */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Audit Progress</CardTitle>
                <div className="flex items-center gap-3">
                  <span className="text-sm text-muted-foreground">{completedStages}/9 stages</span>
                  <span className="text-sm font-semibold text-foreground">{progressPct}%</span>
                </div>
              </div>
              <Progress value={progressPct} className="h-2" />
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                {STAGES.map(stage => {
                  const status = stageStatuses[String(stage.num)] || "not_started";
                  const Icon = stage.icon;
                  return (
                    <button
                      key={stage.num}
                      onClick={() => handleStageClick(stage)}
                      className={cn(
                        "group relative flex flex-col items-center gap-2 p-3 rounded-lg border transition-all hover:shadow-md hover:border-primary/30",
                        status === "complete" && "border-emerald-200 bg-emerald-50/50 dark:border-emerald-800 dark:bg-emerald-950/20",
                        status === "in_progress" && "border-amber-200 bg-amber-50/50 dark:border-amber-800 dark:bg-amber-950/20",
                        status === "not_started" && "border-border bg-card"
                      )}
                    >
                      <div className={cn(
                        "w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold",
                        getStageColor(status)
                      )}>
                        {status === "complete" ? <CheckCircle2 size={16} /> : stage.num}
                      </div>
                      <span className="text-[11px] font-medium text-center leading-tight text-foreground">{stage.label}</span>
                      <span className={cn("text-[9px] font-medium uppercase tracking-wider", getStageTextColor(status))}>
                        {statusLabel[status] || "Not Started"}
                      </span>
                      <ChevronRight size={12} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground/30 group-hover:text-primary transition-colors" />
                    </button>
                  );
                })}
              </div>
              <div className="flex gap-6 mt-4 pt-3 border-t">
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Circle size={10} className="fill-muted text-muted" /> Not Started
                </span>
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Circle size={10} className="fill-amber-500 text-amber-500" /> In Progress
                </span>
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Circle size={10} className="fill-emerald-500 text-emerald-500" /> Completed
                </span>
              </div>
            </CardContent>
          </Card>

          {/* All Engagements */}
          <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2">
                    <CalendarDays size={16} className="text-primary" />
                    All Engagements
                  </CardTitle>
                  <Badge variant="secondary">{engagements.filter(e => e.status !== "archived").length}</Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-1 max-h-[300px] overflow-y-auto">
                {engagements.filter(e => e.status !== "archived").slice(0, 10).map(e => (
                  <div
                    key={e.id}
                    className={cn(
                      "group flex items-center gap-1 p-2 rounded-md transition-colors text-sm",
                      e.id === selectedEngagementId
                        ? "bg-primary/10 border border-primary/20"
                        : "hover:bg-muted border border-transparent"
                    )}
                  >
                    <button
                      className="flex-1 text-left"
                      onClick={() => setSelectedEngagementId(e.id)}
                    >
                      <p className="font-medium text-foreground">{e.client_name}</p>
                      <p className="text-xs text-muted-foreground">{e.audit_type} — FY {e.financial_year}</p>
                    </button>
                    <Badge variant={e.final_locked ? "default" : "outline"} className="capitalize text-[10px] shrink-0">
                      {e.final_locked ? "Completed" : e.status || "planning"}
                    </Badge>
                    <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                      <Button
                        variant="ghost" size="icon" className="h-6 w-6"
                        title="Edit engagement"
                        onClick={() => { setSelectedEngagementId(e.id); openEditDialog(e); }}
                      >
                        <Pencil size={11} />
                      </Button>
                      <Button
                        variant="ghost" size="icon" className="h-6 w-6 text-destructive hover:text-destructive"
                        title="Archive engagement"
                        onClick={() => { setSelectedEngagementId(e.id); setShowDeleteDialog(true); }}
                      >
                        <Trash2 size={11} />
                      </Button>
                    </div>
                  </div>
                ))}
                {engagements.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-4">No engagements yet</p>
                )}
              </CardContent>
            </Card>
        </>
      )}

      {/* ─── Edit Engagement Dialog ─── */}
      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Engagement</DialogTitle>
            <DialogDescription>Update engagement details.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Audit Firm <span className="text-destructive">*</span></Label>
              <Select value={engForm.audit_firm_id} onValueChange={v => setEngForm(f => ({ ...f, audit_firm_id: v }))}>
                <SelectTrigger><SelectValue placeholder="Select audit firm" /></SelectTrigger>
                <SelectContent>
                  {auditFirms.length === 0 ? (
                    <div className="px-3 py-2 text-sm text-muted-foreground">No audit firms found.</div>
                  ) : (
                    auditFirms.map(f => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)
                  )}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Client *</Label>
              <Select value={engForm.client_id} onValueChange={v => {
                const client = editDialogClients.find(c => c.id === v);
                setEngForm(f => ({ ...f, client_id: v, entity_type: client?.entity_type || f.entity_type }));
              }}>
                <SelectTrigger><SelectValue placeholder="Select client" /></SelectTrigger>
                <SelectContent>
                  {editDialogClients.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Financial Year</Label>
              <Select value={engForm.financial_year} onValueChange={v => setEngForm(f => ({ ...f, financial_year: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{FY_OPTIONS.map(f => <SelectItem key={f} value={f}>{f}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Audit Type</Label>
              {(() => {
                const selClient = clients.find(c => c.id === engForm.client_id);
                const opts = getAuditOptionsForClient(selClient);
                if (engForm.client_id && opts.length === 0) {
                  return (
                    <p className="text-xs text-amber-600 mt-1">
                      No audit services enabled for this client. Configure in Client → Audit Setup.
                    </p>
                  );
                }
                return (
                  <Select value={engForm.audit_type} onValueChange={v => setEngForm(f => ({ ...f, audit_type: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {(opts.length === 0 ? AUDIT_TYPES : opts).map(t => (
                        <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                );
              })()}
            </div>
            <div>
              <Label>Engagement Partner</Label>
              <Select value={engForm.partner_id || "__none__"} onValueChange={v => setEngForm(f => ({ ...f, partner_id: v === "__none__" ? "" : v }))}>
                <SelectTrigger><SelectValue placeholder="Select partner" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— Not assigned —</SelectItem>
                  {partners.map(p => (
                    <SelectItem key={p.id} value={p.id}>{p.name || p.id}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Period Type</Label>
              <Select value={engForm.audit_period_type} onValueChange={v => setEngForm(f => ({ ...f, audit_period_type: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{PERIOD_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Entity Type</Label>
              <div className="flex items-center h-10 px-3 rounded-md border border-input bg-muted/50 text-sm text-foreground">
                {engForm.entity_type || (engForm.client_id ? "Not set on client profile" : "Select a client first")}
              </div>
              <p className="text-xs text-muted-foreground mt-1">Auto-fetched from client profile (read-only)</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEditDialog(false)}>Cancel</Button>
            <Button onClick={handleEdit} disabled={formSaving}>
              {formSaving && <Loader2 size={16} className="mr-2 animate-spin" />}
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── Delete/Archive Confirmation ─── */}
      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Archive Engagement?</DialogTitle>
            <DialogDescription>
              This will archive the engagement "{selectedEngagement?.client_name} — FY {selectedEngagement?.financial_year}".
              Archived engagements will no longer appear in the active list but data will be preserved.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeleteDialog(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={formSaving}>
              {formSaving && <Loader2 size={16} className="mr-2 animate-spin" />}
              Archive Engagement
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

