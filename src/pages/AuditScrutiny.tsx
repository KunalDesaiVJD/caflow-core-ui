import { useState, useEffect, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { useAuditTracker } from "@/hooks/useAuditTracker";
import { useAuditContext } from "@/hooks/useAuditContext";
import { scrutinyRunFunction, scrutinyV2Enabled } from "@/lib/scrutiny/flags";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle, CheckCircle2, Shield, ShieldAlert, ShieldQuestion, FileSpreadsheet, Play, Download, FileText, BarChart3, ChevronLeft, ChevronRight, X, Loader2, Calculator } from "lucide-react";
import { TdsReconModule } from "@/components/tds-recon/TdsReconModule";
import { SEVERITIES, STATUSES, type Finding, type RuleTemplate } from "@/lib/scrutiny/scrutinyUi";
import ScrutinyTemplatesView from "@/components/scrutiny-v2/ScrutinyTemplatesView";
import ScrutinyWorkpaperView from "@/components/scrutiny-v2/ScrutinyWorkpaperView";
import ScrutinyCoveragePanel from "@/components/scrutiny-v2/ScrutinyCoveragePanel";
import {
  buildDraftQuery, canReviewQuery, SCRUTINY_QUERY_SOURCE,
  QUERY_STATUS_OPEN, QUERY_STATUS_REJECTED,
} from "@/lib/scrutiny/makerChecker";
import { draftQueryWithAI } from "@/lib/scrutiny/aiQueryDraft";
import { classifyFindingsWithAI, type NarrationClass } from "@/lib/scrutiny/aiNarration";

const CATEGORIES = ["All", "TDS", "GST", "Cash Payments", "Loans", "Prior Period", "Depreciation", "Deferred Tax", "Bank Recon", "Narration AI"];
const FY_OPTIONS = ["2024-25", "2023-24", "2022-23", "2021-22"];
const PAGE_SIZE = 25;

const CLAUSES_3CD = [
  "7(a)", "7(b)", "8", "9(a)", "9(b)", "10", "11(a)", "11(b)", "12", "13(a)", "13(b)", "13(d)", "14(a)", "14(b)",
  "15", "16", "17(a)", "17(b)", "17(c)", "17(d)", "17(e)", "17(f)", "17(g)", "17(h)", "18", "19", "20(a)", "20(b)",
  "21(a)", "21(b)", "21(c)", "21(d)", "22", "23", "24", "25", "26", "27(a)", "27(b)", "28", "29", "30(a)", "30(b)", "31",
  "32(a)", "32(b)", "33", "34(a)", "34(b)", "35", "36", "37", "38", "39", "40", "41",
];

export default function AuditScrutiny() {
  const { clientId: routeClientId } = useParams<{ clientId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();
  const { track } = useAuditTracker();

  // Auto-bind from audit context if no route clientId
  const auditCtx = useAuditContext();
  const contextClientId = auditCtx?.selectedEngagement?.client_id || "";
  const contextFY = auditCtx?.selectedEngagement?.financial_year || "";
  const clientId = routeClientId || contextClientId;

  const [findings, setFindings] = useState<Finding[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasTB, setHasTB] = useState<boolean | null>(null);

  // v2 templates-first view (behind the VITE_SCRUTINY_V2 flag)
  const v2 = scrutinyV2Enabled();
  const [rules, setRules] = useState<RuleTemplate[]>([]);
  // Scrutiny-raised queries (maker-checker): finding_id -> { id, status }
  const [scrutinyQueries, setScrutinyQueries] = useState<{ id: string; source_ref_id: string | null; status: string }[]>([]);
  const [rejectTarget, setRejectTarget] = useState<{ finding: Finding; queryId: string } | null>(null);
  const [v2Tab, setV2Tab] = useState<"templates" | "ledger">("templates");
  // AI narration classification (Ticket 2.2): finding_id -> suggested category / 3CD clause
  const [narrationClasses, setNarrationClasses] = useState<Record<string, NarrationClass>>({});
  const [classifying, setClassifying] = useState(false);

  // Filters — default FY from engagement context
  const [fy, setFy] = useState(contextFY || "2024-25");

  // Sync FY when engagement context changes
  useEffect(() => {
    if (contextFY) setFy(contextFY);
  }, [contextFY]);
  const [category, setCategory] = useState("All");
  const [severity, setSeverity] = useState("All");
  const [status, setStatus] = useState("All");
  const [page, setPage] = useState(0);

  // Actions
  const [detailFinding, setDetailFinding] = useState<Finding | null>(null);
  const [resolveId, setResolveId] = useState<string | null>(null);
  const [waiveId, setWaiveId] = useState<string | null>(null);
  const [actionNote, setActionNote] = useState("");
  const [linkClauseId, setLinkClauseId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [auditFirmName, setAuditFirmName] = useState<string | null>(null);

  // View mode: scrutiny findings vs TDS analytics
  type ScrutinyView = "scrutiny" | "tds";
  const [viewMode, setViewMode] = useState<ScrutinyView>("scrutiny");

  // Check trial balance existence via Tally sync batches (snapshot path removed)
  useEffect(() => {
    if (!clientId) return;
    (supabase.from as any)("sync_batches")
      .select("id")
      .eq("client_id", clientId)
      .in("status", ["completed", "complete", "success", "complete_with_warnings"])
      .limit(1)
      .then(({ data }: any) => setHasTB(!!data && data.length > 0));
  }, [clientId]);

  // Fetch findings
  const fetchFindings = async () => {
    if (!clientId) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("scrutiny_findings")
      .select("*")
      .eq("client_id", clientId)
      .eq("financial_year", fy)
      .order("severity", { ascending: true });
    if (!error && data) setFindings(data as Finding[]);
    setLoading(false);
  };

  useEffect(() => { fetchFindings(); }, [clientId, fy]);

  // Load the rule catalogue (the 119 templates) once, only for the v2 templates-first view
  useEffect(() => {
    if (!v2) return;
    (supabase.from as any)("scrutiny_rules")
      .select("rule_id, rule_name, category, detection_logic, threshold_value, threshold_type, severity, legal_reference, audit_query_template, is_active")
      .eq("is_active", true)
      .order("rule_id")
      .then(({ data }: any) => { if (Array.isArray(data)) setRules(data as RuleTemplate[]); });
  }, [v2]);

  // Load this client/FY's scrutiny-raised queries (maker-checker state), v2 only
  const fetchScrutinyQueries = async () => {
    if (!v2 || !clientId) return;
    const { data } = await (supabase.from as any)("audit_client_queries")
      .select("id, source_ref_id, status")
      .eq("client_id", clientId)
      .eq("financial_year", fy)
      .eq("source", SCRUTINY_QUERY_SOURCE);
    if (Array.isArray(data)) setScrutinyQueries(data);
  };
  useEffect(() => { fetchScrutinyQueries(); }, [v2, clientId, fy]);

  // finding_id -> its linked query { id, status } (via the finding's linked_query_id)
  const queryByFinding = useMemo(() => {
    const byId = new Map(scrutinyQueries.map(q => [q.id, q]));
    const m: Record<string, { id: string; status: string }> = {};
    for (const f of findings) {
      if (f.linked_query_id && byId.has(f.linked_query_id)) {
        const q = byId.get(f.linked_query_id)!;
        m[f.id] = { id: q.id, status: q.status };
      }
    }
    return m;
  }, [findings, scrutinyQueries]);

  // Fetch assigned audit firm for this client + FY
  useEffect(() => {
    if (!clientId) return;
    setAuditFirmName(null);
    supabase
      .from("client_auditor_assignments")
      .select("audit_firms(name)")
      .eq("client_id", clientId)
      .eq("financial_year", fy)
      .maybeSingle()
      .then(({ data }) => {
        const firm = (data as any)?.audit_firms;
        setAuditFirmName(firm?.name || null);
      });
  }, [clientId, fy]);

  // Realtime subscription
  useEffect(() => {
    if (!clientId) return;
    const channel = supabase
      .channel("scrutiny-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "scrutiny_findings", filter: `client_id=eq.${clientId}` }, () => {
        fetchFindings();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [clientId, fy]);

  // Filtered data
  const filtered = useMemo(() => {
    return findings.filter(f => {
      if (category !== "All" && !(f.rule_id || "").toLowerCase().includes(category.toLowerCase())) return false;
      if (severity !== "All" && f.severity?.toUpperCase() !== severity) return false;
      if (status !== "All" && f.status?.toLowerCase() !== status.toLowerCase()) return false;
      return true;
    });
  }, [findings, category, severity, status]);

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const pageData = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  // Stats
  const stats = useMemo(() => ({
    total: findings.length,
    high: findings.filter(f => f.severity?.toUpperCase() === "HIGH").length,
    medium: findings.filter(f => f.severity?.toUpperCase() === "MEDIUM").length,
    low: findings.filter(f => f.severity?.toUpperCase() === "LOW").length,
    resolved: findings.filter(f => f.status?.toLowerCase() === "resolved").length,
  }), [findings]);

  const clearFilters = () => { setCategory("All"); setSeverity("All"); setStatus("All"); setPage(0); };

  const handleResolve = async () => {
    if (!resolveId) return;
    const finding = findings.find(f => f.id === resolveId);
    await supabase.from("scrutiny_findings").update({ status: "resolved" }).eq("id", resolveId);
    track("finding_resolve", {
      rule_id: finding?.rule_id,
      resolution_note: actionNote,
      severity: finding?.severity,
    });
    toast({ title: "Finding resolved" });
    setResolveId(null);
    setActionNote("");
    fetchFindings();
  };

  const handleWaive = async () => {
    if (!waiveId) return;
    await supabase.from("scrutiny_findings").update({ status: "waived" }).eq("id", waiveId);
    toast({ title: "Finding waived" });
    setWaiveId(null);
    setActionNote("");
    fetchFindings();
  };

  const handleLinkClause = async (clause: string) => {
    if (!linkClauseId) return;
    await supabase.from("scrutiny_findings").update({ clause_3cd: clause }).eq("id", linkClauseId);
    toast({ title: `Linked to Clause ${clause}` });
    setLinkClauseId(null);
    fetchFindings();
  };

  // ── AI narration classification (Ticket 2.2) ─────────────────────────────
  const handleClassifyNarrations = async () => {
    setClassifying(true);
    const map = await classifyFindingsWithAI(
      (fn, opts) => (supabase.functions.invoke as any)(fn, opts),
      findings,
    );
    setNarrationClasses(map);
    const n = Object.keys(map).length;
    toast(n > 0
      ? { title: `AI classified ${n} finding${n !== 1 ? "s" : ""}`, description: "Suggested 3CD clauses added — apply from the 3CD column." }
      : { title: "AI classification unavailable", description: "Gateway not reachable; deterministic checks are unaffected.", variant: "destructive" });
    setClassifying(false);
  };

  const handleApplyClause = async (id: string, clause: string) => {
    await supabase.from("scrutiny_findings").update({ clause_3cd: clause }).eq("id", id);
    toast({ title: `Linked to Clause ${clause}` });
    fetchFindings();
  };

  // ── Maker-checker (Ticket 1.3, Design A) ─────────────────────────────────
  const refetchScrutiny = () => { fetchFindings(); fetchScrutinyQueries(); };

  // MAKER: raise a finding into a DRAFT query (not yet client-visible/dispatchable)
  const handleRaiseQuery = async (finding: Finding) => {
    const { data: userData } = await supabase.from("users").select("firm_id").eq("id", user?.id).single();
    const rule = rules.find(r => r.rule_id === finding.rule_id);
    // Phase 2: AI-draft the query text; on any failure this returns null and we fall back
    // to the deterministic rule template, so the flow works whether or not the gateway is live.
    const aiText = await draftQueryWithAI(
      (fn, opts) => (supabase.functions.invoke as any)(fn, opts),
      finding,
      rule,
    );
    const draft = buildDraftQuery({
      finding: { id: finding.id, rule_id: finding.rule_id, severity: finding.severity, flag_message: finding.flag_message },
      ruleQueryTemplate: aiText ?? rule?.audit_query_template ?? null,
      engagement_id: (auditCtx?.selectedEngagement as any)?.id ?? null,
      client_id: clientId,
      firm_id: userData?.firm_id ?? null,
      financial_year: fy,
    });
    const { data, error } = await (supabase.from as any)("audit_client_queries").insert(draft).select("id").single();
    if (error) { toast({ title: "Could not raise query", description: error.message, variant: "destructive" }); return; }
    await (supabase.from as any)("scrutiny_findings")
      .update({ status: "queried", linked_query_id: data.id, actioned_by: user?.id, actioned_at: new Date().toISOString() })
      .eq("id", finding.id);
    track("scrutiny_query_raised", { rule_id: finding.rule_id, severity: finding.severity });
    toast({ title: "Draft query raised", description: "A second reviewer must approve it before it can be sent." });
    refetchScrutiny();
  };

  // CHECKER: approve a DRAFT query (must differ from the maker) → Open (dispatchable)
  const handleApproveQuery = async (finding: Finding, queryId: string) => {
    if (!canReviewQuery(finding.actioned_by, user?.id)) {
      toast({ title: "Maker-checker", description: "A different reviewer must approve this query.", variant: "destructive" });
      return;
    }
    await (supabase.from as any)("audit_client_queries").update({ status: QUERY_STATUS_OPEN }).eq("id", queryId);
    await (supabase.from as any)("scrutiny_findings")
      .update({ reviewed_by: user?.id, reviewed_at: new Date().toISOString() })
      .eq("id", finding.id);
    track("scrutiny_query_approved", { rule_id: finding.rule_id });
    toast({ title: "Query approved", description: "It can now be dispatched to the client." });
    refetchScrutiny();
  };

  // CHECKER: reject a DRAFT query (must differ from the maker) → finding returns to the pool
  const handleRejectQuery = async () => {
    if (!rejectTarget) return;
    const { finding, queryId } = rejectTarget;
    if (!canReviewQuery(finding.actioned_by, user?.id)) {
      toast({ title: "Maker-checker", description: "A different reviewer must reject this query.", variant: "destructive" });
      setRejectTarget(null); setActionNote("");
      return;
    }
    await (supabase.from as any)("audit_client_queries").update({ status: QUERY_STATUS_REJECTED }).eq("id", queryId);
    await (supabase.from as any)("scrutiny_findings")
      .update({ status: "open", linked_query_id: null, override_reason: actionNote || null, reviewed_by: user?.id, reviewed_at: new Date().toISOString() })
      .eq("id", finding.id);
    track("scrutiny_query_rejected", { rule_id: finding.rule_id });
    toast({ title: "Query rejected", description: "The finding is back in the pool." });
    setRejectTarget(null); setActionNote("");
    refetchScrutiny();
  };

  const handleRunScrutiny = async () => {
    setRunning(true);
    try {
      const { data: userData } = await supabase.from("users").select("firm_id").eq("id", user?.id).single();
      const { error } = await supabase.functions.invoke(scrutinyRunFunction(), {
        body: { client_id: clientId, financial_year: fy, firm_id: userData?.firm_id },
      });
      if (error) throw error;
      toast({ title: "Scrutiny complete", description: "Findings have been updated." });
      fetchFindings();
    } catch (err: any) {
      toast({ title: "Scrutiny failed", description: err.message, variant: "destructive" });
    } finally {
      setRunning(false);
    }
  };

  const handleExport = async () => {
    try {
      const { data: userData } = await supabase.from("users").select("firm_id").eq("id", user?.id).single();
      const { data, error } = await supabase.functions.invoke("export-scrutiny-xlsx", {
        body: { client_id: clientId, financial_year: fy, firm_id: userData?.firm_id },
      });
      if (error) throw error;
      toast({ title: "Export triggered" });
    } catch (err: any) {
      toast({ title: "Export failed", description: err.message, variant: "destructive" });
    }
  };

  const severityBadge = (s: string | null) => {
    const v = (s || "").toUpperCase();
    if (v === "HIGH") return <Badge variant="destructive">HIGH</Badge>;
    if (v === "MEDIUM") return <Badge className="bg-amber-500/15 text-amber-700 border-amber-300">MEDIUM</Badge>;
    return <Badge variant="secondary">LOW</Badge>;
  };

  const statusBadge = (s: string | null) => {
    const v = (s || "").toLowerCase();
    if (v === "resolved") return <Badge className="bg-green-500/15 text-green-700 border-green-300">Resolved</Badge>;
    if (v === "waived") return <Badge variant="outline">Waived</Badge>;
    return <Badge variant="destructive">Open</Badge>;
  };

  // Shared props for the v2 findings views (templates + per-ledger workpaper)
  const v2Shared = {
    findings,
    loading,
    queryByFinding,
    currentUserId: user?.id ?? null,
    onDetails: (f: Finding) => setDetailFinding(f),
    onResolve: (id: string) => setResolveId(id),
    onWaive: (id: string) => setWaiveId(id),
    onLink: (id: string) => setLinkClauseId(id),
    onRaiseQuery: handleRaiseQuery,
    onApproveQuery: handleApproveQuery,
    onRejectQuery: (finding: Finding, queryId: string) => setRejectTarget({ finding, queryId }),
    narrationClasses,
    onApplyClause: handleApplyClause,
    severityBadge,
    statusBadge,
  };

  // Empty state
  if (hasTB === false) {
    return (
      <div className="p-6">
        <div className="flex flex-col items-center justify-center py-20 space-y-4">
          <FileSpreadsheet className="h-16 w-16 text-muted-foreground" />
          <h2 className="text-xl font-semibold text-foreground">No Tally sync data found</h2>
          <p className="text-sm text-muted-foreground">Sync Tally data to run AI-powered scrutiny checks.</p>
          <Button onClick={() => navigate("/audit/tally-sync")}>
            Go to Tally Sync
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Scrutiny Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            AI-powered audit findings for FY {fy}
            {auditFirmName && <span className="ml-2 text-foreground font-medium">· Audit Firm: {auditFirmName}</span>}
            {!auditFirmName && <span className="ml-2 text-amber-600">· No audit firm assigned for this FY</span>}
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {/* View mode toggle */}
          <div className="inline-flex rounded-md border overflow-hidden">
            <button
              type="button"
              onClick={() => setViewMode("scrutiny")}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border-r transition-colors ${viewMode === "scrutiny" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted/60"}`}
            >
              <ShieldAlert size={12} /> Scrutiny Findings
            </button>
            <button
              type="button"
              onClick={() => setViewMode("tds")}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors ${viewMode === "tds" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted/60"}`}
            >
              <Calculator size={12} /> TDS Analytics
            </button>
          </div>
          {viewMode === "scrutiny" && (<>
          <Button onClick={handleRunScrutiny} disabled={running} className="bg-amber-600 hover:bg-amber-700 text-white">
            {running ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Play className="h-4 w-4 mr-2" />}
            {running ? "Running..." : "Run Scrutiny"}
          </Button>
          <Button variant="outline" onClick={handleExport}><Download className="h-4 w-4 mr-2" />Export XLSX</Button>
          {v2 && <Button variant="outline" onClick={handleClassifyNarrations} disabled={classifying}>{classifying ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}AI: Classify</Button>}
          <Button variant="outline" onClick={() => navigate(`/clients/${clientId}/audit/3cd`)}><FileText className="h-4 w-4 mr-2" />3CD Form</Button>
          <Button variant="outline" onClick={() => navigate(`/clients/${clientId}/audit/comparative`)}><BarChart3 className="h-4 w-4 mr-2" />Comparative</Button>
          </>)}
        </div>
      </div>

      {/* ── TDS Analytics view ── */}
      {viewMode === "tds" && (
        <TdsReconModule clientId={clientId} financialYear={fy} />
      )}

      {/* ── Scrutiny Findings view ── */}
      {viewMode === "scrutiny" && (<>
      {/* Stat Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <Card><CardContent className="p-4 text-center"><p className="text-xs text-muted-foreground">Total</p><p className="text-2xl font-bold text-foreground">{stats.total}</p></CardContent></Card>
        <Card className="border-destructive/30"><CardContent className="p-4 text-center"><p className="text-xs text-destructive">HIGH</p><p className="text-2xl font-bold text-destructive">{stats.high}</p></CardContent></Card>
        <Card className="border-amber-400/30"><CardContent className="p-4 text-center"><p className="text-xs text-amber-600">MEDIUM</p><p className="text-2xl font-bold text-amber-600">{stats.medium}</p></CardContent></Card>
        <Card><CardContent className="p-4 text-center"><p className="text-xs text-muted-foreground">LOW</p><p className="text-2xl font-bold text-muted-foreground">{stats.low}</p></CardContent></Card>
        <Card className="border-green-400/30"><CardContent className="p-4 text-center"><p className="text-xs text-green-600">Resolved</p><p className="text-2xl font-bold text-green-600">{stats.resolved}</p></CardContent></Card>
      </div>

      {/* v2 scrutiny views (behind flag): advisory coverage panel + Templates / By-Ledger */}
      {v2 && (
        <div className="space-y-4">
          <ScrutinyCoveragePanel rules={rules} />
          <div className="inline-flex rounded-md border overflow-hidden">
            <button
              type="button"
              onClick={() => setV2Tab("templates")}
              className={`px-3 py-1.5 text-xs font-medium border-r transition-colors ${v2Tab === "templates" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted/60"}`}
            >
              By Template
            </button>
            <button
              type="button"
              onClick={() => setV2Tab("ledger")}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${v2Tab === "ledger" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted/60"}`}
            >
              By Ledger
            </button>
          </div>
          {v2Tab === "templates"
            ? <ScrutinyTemplatesView rules={rules} {...v2Shared} />
            : <ScrutinyWorkpaperView {...v2Shared} />}
        </div>
      )}

      {!v2 && (<>
      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-end">
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Financial Year</label>
          <Select value={fy} onValueChange={v => { setFy(v); setPage(0); }}>
            <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
            <SelectContent>{FY_OPTIONS.map(f => <SelectItem key={f} value={f}>{f}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Category</label>
          <Select value={category} onValueChange={v => { setCategory(v); setPage(0); }}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>{CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Severity</label>
          <Select value={severity} onValueChange={v => { setSeverity(v); setPage(0); }}>
            <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
            <SelectContent>{SEVERITIES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Status</label>
          <Select value={status} onValueChange={v => { setStatus(v); setPage(0); }}>
            <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
            <SelectContent>{STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <Button variant="ghost" size="sm" onClick={clearFilters}><X className="h-3 w-3 mr-1" />Clear</Button>
      </div>

      {/* Table */}
      {loading ? (
        <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <ShieldQuestion className="h-12 w-12 mx-auto mb-3" />
          <p>No findings match the current filters.</p>
        </div>
      ) : (
        <>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-24">Rule ID</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Flag Message</TableHead>
                  <TableHead>Severity</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>3CD Clause</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pageData.map(f => (
                  <TableRow key={f.id}>
                    <TableCell className="font-mono text-xs">{f.rule_id || "—"}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">{(f.rule_id || "").split("-")[0] || "General"}</Badge>
                    </TableCell>
                    <TableCell className="max-w-[300px] truncate text-sm">{f.flag_message || "—"}</TableCell>
                    <TableCell>{severityBadge(f.severity)}</TableCell>
                    <TableCell>{statusBadge(f.status)}</TableCell>
                    <TableCell className="text-xs">{f.clause_3cd || "—"}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex gap-1 justify-end flex-wrap">
                        <Button size="sm" variant="ghost" onClick={() => setDetailFinding(f)}>Details</Button>
                        {f.status?.toLowerCase() !== "resolved" && (
                          <Button size="sm" variant="ghost" className="text-green-600" onClick={() => setResolveId(f.id)}>Resolve</Button>
                        )}
                        {f.status?.toLowerCase() !== "waived" && (
                          <Button size="sm" variant="ghost" className="text-amber-600" onClick={() => setWaiveId(f.id)}>Waive</Button>
                        )}
                        <Button size="sm" variant="ghost" onClick={() => setLinkClauseId(f.id)}>Link 3CD</Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>{filtered.length} finding{filtered.length !== 1 ? "s" : ""}</span>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage(p => p - 1)}><ChevronLeft className="h-4 w-4" /></Button>
              <span>Page {page + 1} of {totalPages || 1}</span>
              <Button size="sm" variant="outline" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}><ChevronRight className="h-4 w-4" /></Button>
            </div>
          </div>
        </>
      )}
      </>)}

      {/* ── End Scrutiny Findings view ── */}
      </>)}

      {/* Detail Slide-over */}
      <Sheet open={!!detailFinding} onOpenChange={() => setDetailFinding(null)}>
        <SheetContent className="sm:max-w-lg overflow-y-auto">
          <SheetHeader><SheetTitle>Finding Details</SheetTitle></SheetHeader>
          {detailFinding && (
            <div className="mt-4 space-y-4 text-sm">
              <div><span className="font-medium text-muted-foreground">Rule ID:</span> <span className="font-mono">{detailFinding.rule_id}</span></div>
              <div><span className="font-medium text-muted-foreground">Severity:</span> {severityBadge(detailFinding.severity)}</div>
              <div><span className="font-medium text-muted-foreground">Status:</span> {statusBadge(detailFinding.status)}</div>
              <div><span className="font-medium text-muted-foreground">3CD Clause:</span> {detailFinding.clause_3cd || "Not linked"}</div>
              <div><span className="font-medium text-muted-foreground">Financial Year:</span> {detailFinding.financial_year}</div>
              <div>
                <span className="font-medium text-muted-foreground">Flag Message:</span>
                <p className="mt-1 whitespace-pre-wrap">{detailFinding.flag_message}</p>
              </div>
              <div>
                <span className="font-medium text-muted-foreground">Narration:</span>
                <p className="mt-1 whitespace-pre-wrap">{detailFinding.narration || "—"}</p>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* Resolve Dialog */}
      <Dialog open={!!resolveId} onOpenChange={() => { setResolveId(null); setActionNote(""); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Resolve Finding</DialogTitle></DialogHeader>
          <Textarea placeholder="Resolution note (optional)" value={actionNote} onChange={e => setActionNote(e.target.value)} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setResolveId(null)}>Cancel</Button>
            <Button onClick={handleResolve}>Resolve</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Waive Dialog */}
      <Dialog open={!!waiveId} onOpenChange={() => { setWaiveId(null); setActionNote(""); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Waive Finding</DialogTitle></DialogHeader>
          <Textarea placeholder="Reason for waiving (required)" value={actionNote} onChange={e => setActionNote(e.target.value)} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setWaiveId(null)}>Cancel</Button>
            <Button onClick={handleWaive} disabled={!actionNote.trim()}>Waive</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reject Query Dialog (maker-checker) */}
      <Dialog open={!!rejectTarget} onOpenChange={() => { setRejectTarget(null); setActionNote(""); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Reject Draft Query</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">The finding returns to the pool; the rejected draft is kept for the audit trail and never reaches the client.</p>
          <Textarea placeholder="Reason for rejection (optional)" value={actionNote} onChange={e => setActionNote(e.target.value)} />
          <DialogFooter>
            <Button variant="outline" onClick={() => { setRejectTarget(null); setActionNote(""); }}>Cancel</Button>
            <Button variant="destructive" onClick={handleRejectQuery}>Reject</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Link 3CD Dialog */}
      <Dialog open={!!linkClauseId} onOpenChange={() => setLinkClauseId(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Link to 3CD Clause</DialogTitle></DialogHeader>
          <div className="grid grid-cols-4 gap-2 max-h-64 overflow-y-auto">
            {CLAUSES_3CD.map(c => (
              <Button key={c} size="sm" variant="outline" onClick={() => handleLinkClause(c)}>{c}</Button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
