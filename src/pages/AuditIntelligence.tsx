import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useAuditContext } from "@/hooks/useAuditContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
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
import { format, formatDistanceToNow } from "date-fns";
import {
  Building2, FileText, Calculator, Eye, ClipboardCheck, Shield,
  BookMarked, Layers, Award, ChevronRight, Plus, Upload, Search,
  MessageSquare, FileUp, FileOutput, BarChart3, Clock, Activity,
  Users, CalendarDays, AlertTriangle, CheckCircle2, Circle, Loader2,
  MoreVertical, Pencil, Trash2, HelpCircle, ChevronsUpDown, Check
} from "lucide-react";
import { toast } from "sonner";

// ─── Stage definitions ───
const STAGES = [
  { num: 1, label: "Engagement Setup & Planning", icon: Building2, path: "/audit/pipeline" },
  { num: 2, label: "Workpapers & Risk", icon: Shield, path: "/audit/risk" },
  { num: 3, label: "Data Import", icon: FileText, path: "/audit/import" },
  { num: 4, label: "Scrutiny & Ledger Analysis", icon: Eye, path: "/audit/scrutiny" },
  { num: 5, label: "Queries & Communication", icon: ClipboardCheck, path: "/audit/queries" },
  { num: 6, label: "COA Mapping & FS Prep", icon: Calculator, path: "/settings/coa-mappings" },
  { num: 7, label: "Notes to Accounts", icon: BookMarked, path: "/audit/notes" },
  { num: 8, label: "CARO / 3CD", icon: FileText, path: "/audit/3cd" },
  { num: 9, label: "Audit Reports", icon: Layers, path: "/audit/report" },
  { num: 10, label: "Sign-Off & Bundle", icon: Award, path: "/audit/pipeline" },
];

const QUICK_ACTIONS = [
  { label: "Import Trial Balance", icon: Upload, stage: 2 },
  { label: "Scrutiny Engine", icon: Search, stage: 4 },
  { label: "Client Queries", icon: MessageSquare, stage: 5 },
  { label: "Workpapers & Risk", icon: FileUp, stage: 6 },
  { label: "Notes to Accounts", icon: BookMarked, stage: 7 },
  { label: "Generate Report", icon: FileOutput, stage: 9 },
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

const statusLabel: Record<string, string> = {
  not_started: "Not Started",
  in_progress: "In Progress",
  complete: "Completed",
};

export default function AuditIntelligence() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const {
    selectedClientId, setSelectedClientId,
    selectedEngagementId, setSelectedEngagementId,
    clients, engagements, selectedEngagement, loading,
    refreshEngagements,
  } = useAuditContext();

  const [users, setUsers] = useState<{ id: string; name: string | null }[]>([]);
  const [metrics, setMetrics] = useState({ ledgers: 0, queriesRaised: 0, queriesPending: 0, workpapers: 0, caroCompleted: 0 });

  // Dialogs
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [formSaving, setFormSaving] = useState(false);

  // Searchable dropdown states
  const [clientOpen, setClientOpen] = useState(false);
  const [engagementOpen, setEngagementOpen] = useState(false);

  // Edit form
  const [engForm, setEngForm] = useState({
    client_id: "", financial_year: "2024-25", audit_type: "statutory", entity_type: "company",
  });

  useEffect(() => {
    if (!user?.firm_id) return;
    supabase.from("users").select("id, name").eq("firm_id", user.firm_id).eq("is_active", true)
      .then(({ data }) => setUsers(data || []));
  }, [user?.firm_id]);


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

  // Filter engagements by client
  const filteredEngagements = useMemo(() => {
    if (!selectedClientId || selectedClientId === "all") return engagements;
    return engagements.filter(e => e.client_id === selectedClientId);
  }, [engagements, selectedClientId]);

  const activeEngagements = useMemo(() =>
    filteredEngagements.filter(e => e.status !== "archived"),
    [filteredEngagements]
  );

  const stageStatuses = selectedEngagement?.stage_statuses || {};
  const completedStages = Object.values(stageStatuses).filter((s: any) => s === "complete").length;
  const progressPct = Math.round((completedStages / 10) * 100);

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

  const handleStageClick = (stage: typeof STAGES[0]) => {
    if (!selectedEngagementId) {
      toast.error("Please select an engagement first");
      return;
    }
    // Stages rendered inside the pipeline view
    const pipelineStages = [1, 2, 5, 6, 7, 8, 10];
    if (pipelineStages.includes(stage.num)) {
      // Update pipeline_stage so the pipeline opens to the correct stage
      supabase.from("audit_engagements").update({ pipeline_stage: stage.num } as any).eq("id", selectedEngagementId);
      navigate(`/audit/pipeline/${selectedEngagementId}`);
    } else if (stage.path) {
      navigate(stage.path);
    }
  };

  // ─── Edit Engagement ───
  const openEditDialog = () => {
    if (!selectedEngagement) return;
    setEngForm({
      client_id: selectedEngagement.client_id || "",
      financial_year: selectedEngagement.financial_year || "2024-25",
      audit_type: selectedEngagement.audit_type || "statutory",
      entity_type: selectedEngagement.entity_type || "company",
    });
    setShowEditDialog(true);
  };
  const handleEdit = async () => {
    if (!selectedEngagementId) return;
    setFormSaving(true);
    const { error } = await supabase.from("audit_engagements").update({
      client_id: engForm.client_id,
      financial_year: engForm.financial_year,
      audit_type: engForm.audit_type,
      entity_type: engForm.entity_type,
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

  // Selected client name for display
  const selectedClientName = useMemo(() => {
    if (!selectedClientId || selectedClientId === "all") return "";
    return clients.find(c => c.id === selectedClientId)?.name || "";
  }, [selectedClientId, clients]);

  // Selected engagement label for display
  const selectedEngagementLabel = useMemo(() => {
    if (!selectedEngagement) return "";
    return `${selectedEngagement.client_name} — ${selectedEngagement.audit_type || "Audit"} — FY ${selectedEngagement.financial_year}`;
  }, [selectedEngagement]);

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
          <Button onClick={() => navigate('/audit/pipeline')}>
            <Plus className="mr-2 h-4 w-4" /> New Engagement
          </Button>
        </div>
      </div>

      {/* Engagement Switcher */}
      <Card className="p-4">
        <div className="flex flex-wrap gap-4 items-end">
          {/* Searchable Client Dropdown */}
          <div className="flex-1 min-w-[200px]">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5 block">Client</label>
            <Popover open={clientOpen} onOpenChange={setClientOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" role="combobox" aria-expanded={clientOpen} className="w-full justify-between font-normal">
                  {selectedClientName || "Select Client..."}
                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[300px] p-0" align="start">
                <Command>
                  <CommandInput placeholder="Search clients..." />
                  <CommandList>
                    <CommandEmpty>No clients found.</CommandEmpty>
                    <CommandGroup>
                      {clients.map(c => (
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

          {/* Searchable Engagement Dropdown */}
          <div className="flex-1 min-w-[280px]">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5 block">Engagement</label>
            <div className="flex gap-2">
              <Popover open={engagementOpen} onOpenChange={setEngagementOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" role="combobox" aria-expanded={engagementOpen} className="flex-1 justify-between font-normal">
                    <span className="truncate">{selectedEngagementLabel || "Select Engagement..."}</span>
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[400px] p-0" align="start">
                  <Command>
                    <CommandInput placeholder="Search engagements..." />
                    <CommandList>
                      <CommandEmpty>No engagements found.</CommandEmpty>
                      <CommandGroup>
                        {activeEngagements.map(e => (
                          <CommandItem
                            key={e.id}
                            value={`${e.client_name} ${e.audit_type} ${e.financial_year}`}
                            onSelect={() => {
                              setSelectedEngagementId(e.id);
                              setEngagementOpen(false);
                            }}
                          >
                            <Check className={cn("mr-2 h-4 w-4 shrink-0", selectedEngagementId === e.id ? "opacity-100" : "opacity-0")} />
                            <span className="truncate">{e.client_name} — {e.audit_type || "Audit"} — FY {e.financial_year}</span>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
              {selectedEngagement && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="icon" className="shrink-0">
                      <MoreVertical size={16} />
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
              )}
            </div>
          </div>
        </div>
      </Card>

      {!selectedEngagement ? (
        <Card className="p-12 text-center">
          <Building2 className="h-12 w-12 mx-auto text-muted-foreground/40 mb-4" />
          <h3 className="text-lg font-semibold text-foreground mb-1">Select an Engagement</h3>
          <p className="text-sm text-muted-foreground mb-4">Choose a client and engagement above to view the audit dashboard.</p>
          <Button onClick={() => { setEngForm({ client_id: "", financial_year: "2024-25", audit_type: "statutory", entity_type: "company" }); setShowCreateDialog(true); }}>
            <Plus className="mr-2 h-4 w-4" /> Create New Engagement
          </Button>
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

          {/* 10-Stage Audit Progress Tracker */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Audit Progress</CardTitle>
                <div className="flex items-center gap-3">
                  <span className="text-sm text-muted-foreground">{completedStages}/10 stages</span>
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

          {/* Metrics + Quick Actions Row */}
          <div className="grid gap-6 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <h3 className="text-sm font-semibold text-foreground mb-3 uppercase tracking-wider">Key Audit Metrics</h3>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <MetricCard icon={BarChart3} label="Queries Raised" value={metrics.queriesRaised} />
                <MetricCard icon={AlertTriangle} label="Pending Responses" value={metrics.queriesPending} color="text-amber-600" />
                <MetricCard icon={FileText} label="Workpapers" value={metrics.workpapers} />
                <MetricCard icon={CheckCircle2} label="CARO Completed" value={metrics.caroCompleted} color="text-emerald-600" />
              </div>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-foreground mb-3 uppercase tracking-wider">Quick Actions</h3>
              <div className="grid grid-cols-2 gap-2">
                {QUICK_ACTIONS.map(action => (
                  <Button
                    key={action.label}
                    variant="outline"
                    size="sm"
                    className="h-auto py-2.5 px-3 justify-start gap-2 text-xs"
                    onClick={() => navigate(action.path)}
                  >
                    <action.icon size={14} className="shrink-0 text-primary" />
                    <span className="truncate">{action.label}</span>
                  </Button>
                ))}
              </div>
            </div>
          </div>

          {/* Recent Activity + All Engagements */}
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Activity size={16} className="text-primary" />
                  Recent Activity
                </CardTitle>
              </CardHeader>
              <CardContent>
                <RecentActivityTimeline engagementId={selectedEngagementId} />
              </CardContent>
            </Card>
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
              <CardContent className="space-y-2 max-h-[300px] overflow-y-auto">
                {engagements.filter(e => e.status !== "archived").slice(0, 10).map(e => (
                  <button
                    key={e.id}
                    onClick={() => setSelectedEngagementId(e.id)}
                    className={cn(
                      "w-full flex items-center justify-between p-2.5 rounded-md text-left transition-colors text-sm",
                      e.id === selectedEngagementId
                        ? "bg-primary/10 border border-primary/20"
                        : "hover:bg-muted border border-transparent"
                    )}
                  >
                    <div>
                      <p className="font-medium text-foreground">{e.client_name}</p>
                      <p className="text-xs text-muted-foreground">{e.audit_type} — FY {e.financial_year}</p>
                    </div>
                    <Badge variant={e.final_locked ? "default" : "outline"} className="capitalize text-[10px]">
                      {e.final_locked ? "Completed" : e.status || "planning"}
                    </Badge>
                  </button>
                ))}
                {engagements.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-4">No engagements yet</p>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}

      {/* ─── Create Engagement Dialog ─── */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create New Audit Engagement</DialogTitle>
            <DialogDescription>Select a client with statutory or tax audit activated.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Client *</Label>
              <Select value={engForm.client_id} onValueChange={v => setEngForm(f => ({ ...f, client_id: v }))}>
                <SelectTrigger><SelectValue placeholder="Select audit-activated client" /></SelectTrigger>
                <SelectContent>
                  {eligibleClients.map((c: any) => <SelectItem key={c.id} value={c.id}>{c.name} ({c.entity_type || "—"})</SelectItem>)}
                  {eligibleClients.length === 0 && <div className="px-3 py-2 text-sm text-muted-foreground">No audit-activated clients found</div>}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Financial Year *</Label>
              <Select value={engForm.financial_year} onValueChange={v => setEngForm(f => ({ ...f, financial_year: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{FY_OPTIONS.map(f => <SelectItem key={f} value={f}>{f}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Audit Type *</Label>
              <Select value={engForm.audit_type} onValueChange={v => setEngForm(f => ({ ...f, audit_type: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{AUDIT_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Entity Type *</Label>
              <Select value={engForm.entity_type} onValueChange={v => setEngForm(f => ({ ...f, entity_type: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{ENTITY_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateDialog(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={formSaving || !engForm.client_id}>
              {formSaving ? <Loader2 size={16} className="mr-2 animate-spin" /> : <Plus size={16} className="mr-2" />}
              Create Engagement
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── Edit Engagement Dialog ─── */}
      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Engagement</DialogTitle>
            <DialogDescription>Update engagement details.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Client *</Label>
              <Select value={engForm.client_id} onValueChange={v => setEngForm(f => ({ ...f, client_id: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {clients.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
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
              <Select value={engForm.audit_type} onValueChange={v => setEngForm(f => ({ ...f, audit_type: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{AUDIT_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Entity Type</Label>
              <Select value={engForm.entity_type} onValueChange={v => setEngForm(f => ({ ...f, entity_type: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{ENTITY_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
              </Select>
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

// ─── Sub-components ───

function MetricCard({ icon: Icon, label, value, color }: { icon: any; label: string; value: number; color?: string }) {
  return (
    <Card className="p-3">
      <div className="flex items-center gap-2 mb-1">
        <Icon size={14} className={color || "text-primary"} />
        <span className="text-xs text-muted-foreground">{label}</span>
      </div>
      <p className={cn("text-2xl font-bold", color || "text-foreground")}>{value.toLocaleString("en-IN")}</p>
    </Card>
  );
}

function RecentActivityTimeline({ engagementId }: { engagementId: string }) {
  const [activities, setActivities] = useState<any[]>([]);

  useEffect(() => {
    if (!engagementId) return;
    loadActivities();
  }, [engagementId]);

  const loadActivities = async () => {
    const [queriesRes, wpRes] = await Promise.all([
      supabase.from("audit_client_queries")
        .select("id, query_text, status, created_at")
        .eq("engagement_id", engagementId)
        .order("created_at", { ascending: false })
        .limit(5),
      supabase.from("audit_workpapers")
        .select("id, section, wp_ref, signed_by")
        .eq("engagement_id", engagementId)
        .limit(3),
    ]);

    const items: any[] = [];
    (queriesRes.data || []).forEach(q => {
      items.push({
        id: q.id,
        text: `Query: ${(q.query_text || "").slice(0, 60)}…`,
        status: q.status,
        time: q.created_at,
        type: "query",
      });
    });
    (wpRes.data || []).forEach(w => {
      items.push({
        id: w.id,
        text: `Workpaper ${w.wp_ref || ""}: ${w.section || "General"}`,
        status: w.signed_by ? "Signed" : "Draft",
        time: null,
        type: "workpaper",
      });
    });

    items.sort((a, b) => {
      if (!a.time && !b.time) return 0;
      if (!a.time) return 1;
      if (!b.time) return -1;
      return new Date(b.time).getTime() - new Date(a.time).getTime();
    });

    setActivities(items.slice(0, 8));
  };

  if (activities.length === 0) {
    return (
      <div className="text-center py-6">
        <Clock className="h-8 w-8 mx-auto text-muted-foreground/30 mb-2" />
        <p className="text-sm text-muted-foreground">No activity yet for this engagement</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {activities.map(a => (
        <div key={a.id} className="flex gap-3 items-start">
          <div className={cn(
            "w-2 h-2 rounded-full mt-1.5 shrink-0",
            a.type === "query" ? "bg-blue-500" : "bg-emerald-500"
          )} />
          <div className="flex-1 min-w-0">
            <p className="text-sm text-foreground truncate">{a.text}</p>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-[9px]">{a.status}</Badge>
              {a.time && (
                <span className="text-[10px] text-muted-foreground">
                  {formatDistanceToNow(new Date(a.time), { addSuffix: true })}
                </span>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
