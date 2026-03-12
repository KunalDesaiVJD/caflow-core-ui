import { useState, useEffect, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { useAuditTracker } from "@/hooks/useAuditTracker";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle, CheckCircle2, Shield, ShieldAlert, ShieldQuestion, FileSpreadsheet, Play, Download, FileText, BarChart3, ChevronLeft, ChevronRight, X, Loader2 } from "lucide-react";

const CATEGORIES = ["All", "TDS", "GST", "Cash Payments", "Loans", "Prior Period", "Depreciation", "Deferred Tax", "Bank Recon", "Narration AI"];
const SEVERITIES = ["All", "HIGH", "MEDIUM", "LOW"];
const STATUSES = ["All", "Open", "Resolved", "Waived"];
const FY_OPTIONS = ["2024-25", "2023-24", "2022-23", "2021-22"];
const PAGE_SIZE = 25;

const CLAUSES_3CD = [
  "7(a)", "7(b)", "8", "9(a)", "9(b)", "10", "11(a)", "11(b)", "12", "13(a)", "13(b)", "13(d)", "14(a)", "14(b)",
  "15", "16", "17(a)", "17(b)", "17(c)", "17(d)", "17(e)", "17(f)", "17(g)", "17(h)", "18", "19", "20(a)", "20(b)",
  "21(a)", "21(b)", "21(c)", "21(d)", "22", "23", "24", "25", "26", "27(a)", "27(b)", "28", "29", "30(a)", "30(b)", "31",
  "32(a)", "32(b)", "33", "34(a)", "34(b)", "35", "36", "37", "38", "39", "40", "41",
];

type Finding = {
  id: string;
  rule_id: string | null;
  client_id: string | null;
  severity: string | null;
  clause_3cd: string | null;
  flag_message: string | null;
  status: string | null;
  narration: string | null;
  financial_year: string | null;
};

export default function AuditScrutiny() {
  const { clientId: routeClientId } = useParams<{ clientId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();
  const { track } = useAuditTracker();

  // Auto-bind from audit context if no route clientId
  let auditCtx: any = null;
  try { auditCtx = useAuditContext(); } catch {}
  const contextClientId = auditCtx?.selectedEngagement?.client_id || "";
  const clientId = routeClientId || contextClientId;

  const [findings, setFindings] = useState<Finding[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasTB, setHasTB] = useState<boolean | null>(null);

  // Filters
  const [fy, setFy] = useState("2024-25");
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

  // Check trial balance existence
  useEffect(() => {
    if (!clientId) return;
    supabase.from("trial_balance_snapshots").select("id").eq("client_id", clientId).limit(1)
      .then(({ data }) => setHasTB(!!data && data.length > 0));
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

  const handleRunScrutiny = async () => {
    setRunning(true);
    try {
      const { data: userData } = await supabase.from("users").select("firm_id").eq("id", user?.id).single();
      const { error } = await supabase.functions.invoke("run-scrutiny", {
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

  // Empty state
  if (hasTB === false) {
    return (
      <div className="p-6">
        <div className="flex flex-col items-center justify-center py-20 space-y-4">
          <FileSpreadsheet className="h-16 w-16 text-muted-foreground" />
          <h2 className="text-xl font-semibold text-foreground">No trial balance imported yet</h2>
          <p className="text-sm text-muted-foreground">Import a trial balance to run AI-powered scrutiny checks.</p>
          <Button onClick={() => navigate(`/clients/${clientId}/audit/import-trial-balance`)}>
            Import Trial Balance
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
          <Button onClick={handleRunScrutiny} disabled={running} className="bg-amber-600 hover:bg-amber-700 text-white">
            {running ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Play className="h-4 w-4 mr-2" />}
            {running ? "Running..." : "Run Scrutiny"}
          </Button>
          <Button variant="outline" onClick={handleExport}><Download className="h-4 w-4 mr-2" />Export XLSX</Button>
          <Button variant="outline" onClick={() => navigate(`/clients/${clientId}/audit/3cd`)}><FileText className="h-4 w-4 mr-2" />3CD Form</Button>
          <Button variant="outline" onClick={() => navigate(`/clients/${clientId}/audit/comparative`)}><BarChart3 className="h-4 w-4 mr-2" />Comparative</Button>
        </div>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <Card><CardContent className="p-4 text-center"><p className="text-xs text-muted-foreground">Total</p><p className="text-2xl font-bold text-foreground">{stats.total}</p></CardContent></Card>
        <Card className="border-destructive/30"><CardContent className="p-4 text-center"><p className="text-xs text-destructive">HIGH</p><p className="text-2xl font-bold text-destructive">{stats.high}</p></CardContent></Card>
        <Card className="border-amber-400/30"><CardContent className="p-4 text-center"><p className="text-xs text-amber-600">MEDIUM</p><p className="text-2xl font-bold text-amber-600">{stats.medium}</p></CardContent></Card>
        <Card><CardContent className="p-4 text-center"><p className="text-xs text-muted-foreground">LOW</p><p className="text-2xl font-bold text-muted-foreground">{stats.low}</p></CardContent></Card>
        <Card className="border-green-400/30"><CardContent className="p-4 text-center"><p className="text-xs text-green-600">Resolved</p><p className="text-2xl font-bold text-green-600">{stats.resolved}</p></CardContent></Card>
      </div>

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
