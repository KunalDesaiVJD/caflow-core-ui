import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { format, formatDistanceToNow } from "date-fns";
import {
  Building2, FileText, Calculator, Eye, ClipboardCheck, Shield,
  BookMarked, Layers, Award, ChevronRight, Plus, Upload, Search,
  MessageSquare, FileUp, FileOutput, BarChart3, Clock, Activity,
  Users, CalendarDays, AlertTriangle, CheckCircle2, Circle, Loader2
} from "lucide-react";
import { toast } from "sonner";

// ─── Stage definitions matching pipeline ───
const STAGES = [
  { num: 1, label: "Engagement Setup", icon: Building2, path: "" },
  { num: 2, label: "Data Import", icon: FileText, path: "/audit/import" },
  { num: 3, label: "COA Mapping", icon: Calculator, path: "/settings/coa-mappings" },
  { num: 4, label: "Scrutiny", icon: Eye, path: "/audit/scrutiny" },
  { num: 5, label: "Queries", icon: ClipboardCheck, path: "/audit/queries" },
  { num: 6, label: "Workpapers & Risk", icon: Shield, path: "/audit/risk" },
  { num: 7, label: "Notes", icon: BookMarked, path: "/audit/notes" },
  { num: 8, label: "CARO / 3CD", icon: FileText, path: "/audit/3cd" },
  { num: 9, label: "Audit Report", icon: Layers, path: "/audit/report" },
  { num: 10, label: "Sign-Off", icon: Award, path: "" },
];

const QUICK_ACTIONS = [
  { label: "Import Trial Balance", icon: Upload, path: "/audit/import" },
  { label: "Scrutiny Dashboard", icon: Search, path: "/audit/scrutiny" },
  { label: "Raise Client Query", icon: MessageSquare, path: "/audit/queries" },
  { label: "Upload Workpaper", icon: FileUp, path: "/audit/risk" },
  { label: "Notes to Accounts", icon: BookMarked, path: "/audit/notes" },
  { label: "Generate Report", icon: FileOutput, path: "/audit/report" },
];

type Engagement = {
  id: string;
  client_id: string | null;
  financial_year: string | null;
  status: string | null;
  firm_id: string | null;
  audit_type: string | null;
  planned_start: string | null;
  planned_end: string | null;
  partner_id: string | null;
  manager_id: string | null;
  team_members: string[] | null;
  stage_statuses: Record<string, string> | null;
  pipeline_stage: number | null;
  final_locked: boolean | null;
  client_name?: string;
  client_entity_type?: string;
  partner_name?: string;
  manager_name?: string;
};

const statusLabel: Record<string, string> = {
  not_started: "Not Started",
  in_progress: "In Progress",
  complete: "Completed",
};

export default function AuditIntelligence() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [engagements, setEngagements] = useState<Engagement[]>([]);
  const [clients, setClients] = useState<{ id: string; name: string | null; entity_type: string | null }[]>([]);
  const [users, setUsers] = useState<{ id: string; name: string | null }[]>([]);
  const [loading, setLoading] = useState(true);

  // Engagement switcher
  const [selectedClientId, setSelectedClientId] = useState<string>("all");
  const [selectedEngagementId, setSelectedEngagementId] = useState<string>("");

  // Metrics
  const [metrics, setMetrics] = useState({ ledgers: 0, queriesRaised: 0, queriesPending: 0, workpapers: 0, caroCompleted: 0 });

  const isSuperadmin = user?.role === "superadmin";

  useEffect(() => {
    fetchData();
  }, [user?.firm_id, user?.role]);

  const fetchData = async () => {
    if (!user) return;
    if (!user.firm_id && !isSuperadmin) return;
    setLoading(true);

    const engQuery = supabase.from("audit_engagements").select("*");
    const userQuery = supabase.from("users").select("id, name").eq("is_active", true);
    const clientQuery = supabase.from("clients").select("id, name, entity_type");

    if (user.firm_id) {
      engQuery.eq("firm_id", user.firm_id);
      userQuery.eq("firm_id", user.firm_id);
      clientQuery.eq("firm_id", user.firm_id);
    }

    const [engRes, userRes, clientRes] = await Promise.all([engQuery, userQuery, clientQuery]);

    const userMap = new Map((userRes.data || []).map(u => [u.id, u]));
    const clientMap = new Map((clientRes.data || []).map(c => [c.id, c]));

    setUsers(userRes.data || []);
    setClients(clientRes.data || []);

    const mapped: Engagement[] = (engRes.data || []).map((e: any) => ({
      ...e,
      stage_statuses: (e.stage_statuses || {}) as Record<string, string>,
      client_name: clientMap.get(e.client_id)?.name || "Unknown",
      client_entity_type: clientMap.get(e.client_id)?.entity_type || "",
      partner_name: userMap.get(e.partner_id)?.name || "",
      manager_name: userMap.get(e.manager_id)?.name || "",
    }));
    setEngagements(mapped);

    // Auto-select first engagement
    if (mapped.length > 0 && !selectedEngagementId) {
      setSelectedEngagementId(mapped[0].id);
    }

    setLoading(false);
  };

  // Load metrics for selected engagement
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
      ledgers: 0, // TB ledgers would come from trial_balance_rows - placeholder
      queriesRaised: queries.length,
      queriesPending: queries.filter(q => q.status === "Open" || q.status === "Pending").length,
      workpapers: workpapersRes.count || 0,
      caroCompleted: caroRows.filter(c => c.status === "completed" || c.status === "reviewed").length,
    });
  };

  // Filter engagements by client
  const filteredEngagements = useMemo(() => {
    if (selectedClientId === "all") return engagements;
    return engagements.filter(e => e.client_id === selectedClientId);
  }, [engagements, selectedClientId]);

  const selectedEngagement = engagements.find(e => e.id === selectedEngagementId);

  const stageStatuses = selectedEngagement?.stage_statuses || {};
  const completedStages = Object.values(stageStatuses).filter(s => s === "complete").length;
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
    if (stage.num === 1 || stage.num === 10) {
      navigate(`/audit/pipeline/${selectedEngagementId}`);
    } else if (stage.path) {
      navigate(stage.path);
    }
  };

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
          <Button variant="outline" onClick={() => navigate("/audit/pipeline")}>
            <Layers className="mr-2 h-4 w-4" /> Pipeline View
          </Button>
          <Button onClick={() => navigate("/audit/pipeline")}>
            <Plus className="mr-2 h-4 w-4" /> New Engagement
          </Button>
        </div>
      </div>

      {/* Engagement Switcher */}
      <Card className="p-4">
        <div className="flex flex-wrap gap-4 items-end">
          <div className="flex-1 min-w-[200px]">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5 block">Client</label>
            <Select value={selectedClientId} onValueChange={v => { setSelectedClientId(v); setSelectedEngagementId(""); }}>
              <SelectTrigger><SelectValue placeholder="All Clients" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Clients</SelectItem>
                {clients.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex-1 min-w-[280px]">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5 block">Engagement</label>
            <Select value={selectedEngagementId} onValueChange={setSelectedEngagementId}>
              <SelectTrigger><SelectValue placeholder="Select Engagement" /></SelectTrigger>
              <SelectContent>
                {filteredEngagements.map(e => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.client_name} — {e.audit_type || "Audit"} — FY {e.financial_year}
                  </SelectItem>
                ))}
                {filteredEngagements.length === 0 && (
                  <div className="px-3 py-2 text-sm text-muted-foreground">No engagements found</div>
                )}
              </SelectContent>
            </Select>
          </div>
        </div>
      </Card>

      {!selectedEngagement ? (
        <Card className="p-12 text-center">
          <Building2 className="h-12 w-12 mx-auto text-muted-foreground/40 mb-4" />
          <h3 className="text-lg font-semibold text-foreground mb-1">Select an Engagement</h3>
          <p className="text-sm text-muted-foreground mb-4">Choose a client and engagement above to view the audit dashboard.</p>
          <Button onClick={() => navigate("/audit/pipeline")}>
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
              <p className="text-sm font-semibold text-foreground">{selectedEngagement.partner_name || "—"}</p>
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

              {/* Stage Legend */}
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
            {/* Key Metrics */}
            <div className="lg:col-span-2">
              <h3 className="text-sm font-semibold text-foreground mb-3 uppercase tracking-wider">Key Audit Metrics</h3>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <MetricCard icon={BarChart3} label="Queries Raised" value={metrics.queriesRaised} />
                <MetricCard icon={AlertTriangle} label="Pending Responses" value={metrics.queriesPending} color="text-amber-600" />
                <MetricCard icon={FileText} label="Workpapers" value={metrics.workpapers} />
                <MetricCard icon={CheckCircle2} label="CARO Completed" value={metrics.caroCompleted} color="text-emerald-600" />
              </div>
            </div>

            {/* Quick Actions */}
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
            {/* Recent Activity Timeline */}
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

            {/* All Engagements List */}
            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2">
                    <CalendarDays size={16} className="text-primary" />
                    All Engagements
                  </CardTitle>
                  <Badge variant="secondary">{engagements.length}</Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-2 max-h-[300px] overflow-y-auto">
                {engagements.slice(0, 10).map(e => (
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
    // Combine queries and workpapers as activity items
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
