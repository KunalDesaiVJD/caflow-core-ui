import { useState, useEffect, useMemo, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  AlertTriangle, CheckCircle2, Shield, ShieldAlert, Eye, Search,
  Play, ChevronDown, ChevronRight, ArrowRight, Loader2, Filter,
  MessageSquare, FileText, BarChart3, X
} from "lucide-react";

// ─── Types ───
interface PipelineStage4Props {
  engagementId: string;
  engagement: any;
  onStageComplete: () => void;
  onSaveDraft: () => void;
}

const CATEGORIES = [
  "All", "BKR", "CASH", "SALES", "EXP", "DEBT", "CRED", "LOAN",
  "FA", "INV", "TDS", "RPT", "JE", "RAT", "PAY", "CAP", "PROV", "COMP"
];

const CATEGORY_LABELS: Record<string, string> = {
  BKR: "Banking", CASH: "Cash", SALES: "Sales/Revenue", EXP: "Expenses",
  DEBT: "Debtors", CRED: "Creditors", LOAN: "Loans", FA: "Fixed Assets",
  INV: "Inventory", TDS: "TDS", RPT: "Related Party", JE: "Journal Entries",
  RAT: "Ratio Analysis", PAY: "Payroll", CAP: "Capital/Equity", PROV: "Provisions", COMP: "Compliance"
};

const SEVERITIES = ["All", "high", "medium", "low"];
const STATUSES = ["All", "open", "accepted", "queried", "noted", "overridden"];

const SEVERITY_COLORS: Record<string, string> = {
  high: "bg-destructive text-destructive-foreground",
  medium: "bg-amber-500 text-white",
  low: "bg-blue-500 text-white",
};

const STATUS_COLORS: Record<string, string> = {
  open: "bg-muted text-muted-foreground",
  accepted: "bg-primary text-primary-foreground",
  queried: "bg-purple-500 text-white",
  noted: "bg-blue-500 text-white",
  overridden: "bg-amber-600 text-white",
};

export default function PipelineStage4({ engagementId, engagement, onStageComplete, onSaveDraft }: PipelineStage4Props) {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [filterCategory, setFilterCategory] = useState("All");
  const [filterSeverity, setFilterSeverity] = useState("All");
  const [filterStatus, setFilterStatus] = useState("All");
  const [searchRule, setSearchRule] = useState("");
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [overrideDialog, setOverrideDialog] = useState<{ id: string; ruleId: string } | null>(null);
  const [overrideReason, setOverrideReason] = useState("");
  const [drillAccount, setDrillAccount] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("findings");

  // ─── Fetch findings ───
  const { data: findings, refetch: refetchFindings } = useQuery({
    queryKey: ["scrutiny-findings", engagementId],
    queryFn: async () => {
      const { data } = await supabase
        .from("scrutiny_findings")
        .select("*")
        .eq("engagement_id", engagementId)
        .order("created_at", { ascending: false });
      return (data || []) as any[];
    },
    enabled: !!engagementId,
  });

  // ─── Fetch rules ───
  const { data: rules } = useQuery({
    queryKey: ["scrutiny-rules"],
    queryFn: async () => {
      const { data } = await supabase
        .from("scrutiny_rules")
        .select("*")
        .eq("is_active", true)
        .order("rule_id");
      return (data || []) as any[];
    },
  });

  // ─── Fetch TB accounts for scrutiny simulation ───
  const { data: tbAccounts } = useQuery({
    queryKey: ["tb-accounts-stage4", engagementId],
    queryFn: async () => {
      const { data } = await supabase
        .from("trial_balance_snapshots" as any)
        .select("id, snapshot_data")
        .eq("engagement_id", engagementId)
        .order("created_at", { ascending: false })
        .limit(1);
      const rows = data as any[];
      if (rows?.[0]?.snapshot_data && Array.isArray(rows[0].snapshot_data)) {
        return rows[0].snapshot_data as any[];
      }
      return [];
    },
    enabled: !!engagementId,
  });

  // ─── Fetch ledger transactions for drill-down ───
  const { data: ledgerTxns } = useQuery({
    queryKey: ["ledger-drill", engagementId, drillAccount],
    queryFn: async () => {
      if (!drillAccount) return [];
      const { data } = await supabase
        .from("ledger_transactions")
        .select("*")
        .eq("engagement_id", engagementId)
        .eq("account_name", drillAccount)
        .order("date", { ascending: true })
        .limit(500);
      return (data || []) as any[];
    },
    enabled: !!engagementId && !!drillAccount,
  });

  // ─── Run scrutiny engine ───
  const runScrutiny = useCallback(async () => {
    if (!rules || !tbAccounts || tbAccounts.length === 0) {
      toast.error("No TB data or rules available");
      return;
    }
    setRunning(true);
    try {
      // Delete existing open findings first
      await supabase
        .from("scrutiny_findings")
        .delete()
        .eq("engagement_id", engagementId)
        .eq("status", "open");

      const newFindings: any[] = [];
      const entityType = engagement?.entity_type || "company";

      for (const rule of rules) {
        // Check entity applicability
        const applicableTo = rule.applicable_to || [];
        if (Array.isArray(applicableTo) && applicableTo.length > 0 && !applicableTo.includes(entityType)) continue;

        const logic = rule.detection_logic || {};
        const check = logic.check;

        // Run basic checks against TB data
        for (const acct of tbAccounts) {
          const balance = parseFloat(acct.closing_balance || acct.balance || "0");
          const name = (acct.account_name || acct.name || "").toLowerCase();
          const group = (acct.account_group || acct.group || "").toLowerCase();
          let triggered = false;
          let amount = Math.abs(balance);

          if (check === "sign_reversal") {
            const expected = logic.expected_sign;
            if (expected === "debit" && balance < 0) triggered = true;
            if (expected === "credit" && balance > 0) triggered = true;
          }

          if (check === "keyword_balance" && logic.keywords) {
            const keywords = logic.keywords as string[];
            const matched = keywords.some((kw: string) => name.includes(kw.toLowerCase()));
            if (matched && (logic.nonzero ? balance !== 0 : true)) triggered = true;
          }

          if (check === "balance_exceeds" && logic.threshold) {
            if (Math.abs(balance) > logic.threshold) triggered = true;
          }

          if (check === "daily_max" && logic.threshold) {
            if (Math.abs(balance) > logic.threshold && (name.includes("cash") || group.includes("cash"))) triggered = true;
          }

          if (check === "negative_balance" && logic.keywords) {
            const keywords = logic.keywords as string[];
            const matched = keywords.some((kw: string) => name.includes(kw.toLowerCase()));
            if (matched && balance < 0) triggered = true;
          }

          if (triggered) {
            const queryText = (rule.audit_query_template || "")
              .replace("{account}", acct.account_name || acct.name || "")
              .replace("{amount}", amount.toLocaleString("en-IN"));

            newFindings.push({
              engagement_id: engagementId,
              firm_id: user?.firm_id,
              rule_id: rule.rule_id,
              rule_name: rule.rule_name,
              category: rule.category,
              severity: rule.severity,
              account_name: acct.account_name || acct.name,
              amount,
              finding_text: queryText,
              auto_query_text: queryText,
              status: "open",
            });
          }
        }
      }

      // Insert findings in batches
      if (newFindings.length > 0) {
        const batchSize = 100;
        for (let i = 0; i < newFindings.length; i += batchSize) {
          const batch = newFindings.slice(i, i + batchSize);
          await supabase.from("scrutiny_findings").insert(batch as any);
        }
      }

      // Update stage status
      const statuses = engagement?.stage_statuses || {};
      await supabase.from("audit_engagements").update({
        stage_statuses: { ...statuses, "4": "in_progress" },
        re_evaluate_scrutiny: false,
      } as any).eq("id", engagementId);

      toast.success(`Scrutiny complete — ${newFindings.length} findings generated`);
      refetchFindings();
      onSaveDraft();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setRunning(false);
    }
  }, [rules, tbAccounts, engagementId, engagement, user]);

  // ─── Action handlers ───
  const updateFindingStatus = useCallback(async (findingId: string, status: string, reason?: string) => {
    const payload: any = {
      status,
      actioned_by: user?.id,
      actioned_at: new Date().toISOString(),
    };
    if (reason) payload.override_reason = reason;

    await supabase.from("scrutiny_findings").update(payload).eq("id", findingId);
    refetchFindings();
    toast.success(`Finding ${status}`);
  }, [user]);

  const raiseQuery = useCallback(async (finding: any) => {
    const { data, error } = await supabase.from("audit_client_queries").insert({
      engagement_id: engagementId,
      client_id: engagement?.client_id,
      firm_id: user?.firm_id,
      financial_year: engagement?.financial_year,
      query_text: finding.auto_query_text || finding.finding_text,
      source: "Scrutiny Finding",
      source_ref_id: finding.id,
      priority: finding.severity === "high" ? "High" : finding.severity === "medium" ? "Medium" : "Low",
      status: "Open",
    } as any).select("id").single();

    if (error) { toast.error(error.message); return; }

    await supabase.from("scrutiny_findings").update({
      status: "queried",
      linked_query_id: data.id,
      actioned_by: user?.id,
      actioned_at: new Date().toISOString(),
    } as any).eq("id", finding.id);

    refetchFindings();
    toast.success("Query raised from finding");
  }, [engagementId, engagement, user]);

  // ─── Filtered findings ───
  const filtered = useMemo(() => {
    if (!findings) return [];
    return findings.filter((f: any) => {
      if (filterCategory !== "All" && f.category !== filterCategory) return false;
      if (filterSeverity !== "All" && f.severity !== filterSeverity) return false;
      if (filterStatus !== "All" && f.status !== filterStatus) return false;
      if (searchRule && !f.rule_id?.toLowerCase().includes(searchRule.toLowerCase()) && !f.rule_name?.toLowerCase().includes(searchRule.toLowerCase())) return false;
      return true;
    });
  }, [findings, filterCategory, filterSeverity, filterStatus, searchRule]);

  // ─── Summary stats ───
  const stats = useMemo(() => {
    if (!findings) return { total: 0, high: 0, medium: 0, low: 0, open: 0, accepted: 0, queried: 0, noted: 0, overridden: 0 };
    return {
      total: findings.length,
      high: findings.filter((f: any) => f.severity === "high").length,
      medium: findings.filter((f: any) => f.severity === "medium").length,
      low: findings.filter((f: any) => f.severity === "low").length,
      open: findings.filter((f: any) => f.status === "open").length,
      accepted: findings.filter((f: any) => f.status === "accepted").length,
      queried: findings.filter((f: any) => f.status === "queried").length,
      noted: findings.filter((f: any) => f.status === "noted").length,
      overridden: findings.filter((f: any) => f.status === "overridden").length,
    };
  }, [findings]);

  const canComplete = stats.open === 0 && stats.total > 0;

  const completeStage = useCallback(async () => {
    const statuses = engagement?.stage_statuses || {};
    await supabase.from("audit_engagements").update({
      stage_statuses: { ...statuses, "4": "complete", "5": "in_progress" },
      pipeline_stage: 5,
    } as any).eq("id", engagementId);
    toast.success("Stage 4 complete — proceed to Query Tracker");
    onStageComplete();
  }, [engagement, engagementId]);

  return (
    <div className="max-w-7xl space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">Stage 4 — Scrutiny Engine</h1>
          <p className="text-sm text-muted-foreground">Run automated checks against TB & ledger data using 120+ audit rules</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={runScrutiny} disabled={running} className="gap-1.5">
            {running ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
            {running ? "Running..." : "Run Scrutiny"}
          </Button>
          <Button size="sm" onClick={completeStage} disabled={!canComplete} className="gap-1">
            Complete Stage 4 <ArrowRight size={14} />
          </Button>
        </div>
      </div>

      {/* Re-evaluate banner */}
      {engagement?.re_evaluate_scrutiny && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Rules Updated</AlertTitle>
          <AlertDescription>Scrutiny rules have been updated since last run. Re-run scrutiny recommended.</AlertDescription>
        </Alert>
      )}

      {/* Summary bar */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Card className="p-3">
          <p className="text-xs text-muted-foreground">Total Findings</p>
          <p className="text-2xl font-bold text-foreground">{stats.total}</p>
        </Card>
        <Card className="p-3">
          <p className="text-xs text-muted-foreground">High Severity</p>
          <p className="text-2xl font-bold text-destructive">{stats.high}</p>
        </Card>
        <Card className="p-3">
          <p className="text-xs text-muted-foreground">Medium</p>
          <p className="text-2xl font-bold text-amber-500">{stats.medium}</p>
        </Card>
        <Card className="p-3">
          <p className="text-xs text-muted-foreground">Low</p>
          <p className="text-2xl font-bold text-blue-500">{stats.low}</p>
        </Card>
        <Card className="p-3">
          <p className="text-xs text-muted-foreground">Open / Actioned</p>
          <p className="text-2xl font-bold text-foreground">{stats.open} / {stats.total - stats.open}</p>
        </Card>
      </div>

      {/* Status distribution */}
      <div className="flex gap-2 flex-wrap">
        {(["open", "accepted", "queried", "noted", "overridden"] as const).map(s => (
          <Badge key={s} variant="outline" className="gap-1 text-xs cursor-pointer" onClick={() => setFilterStatus(filterStatus === s ? "All" : s)}>
            <span className={cn("w-2 h-2 rounded-full", STATUS_COLORS[s])} /> {s}: {stats[s]}
          </Badge>
        ))}
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="findings" className="gap-1"><Shield size={14} /> Findings ({stats.total})</TabsTrigger>
          <TabsTrigger value="comparative" className="gap-1"><BarChart3 size={14} /> Comparative</TabsTrigger>
        </TabsList>

        <TabsContent value="findings" className="space-y-4">
          {/* Filter bar */}
          <div className="flex flex-wrap gap-2 items-center">
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-2.5 text-muted-foreground" />
              <Input placeholder="Search rule ID or name..." value={searchRule} onChange={e => setSearchRule(e.target.value)} className="pl-8 h-9 w-48 text-xs" />
            </div>
            <Select value={filterCategory} onValueChange={setFilterCategory}>
              <SelectTrigger className="h-9 w-36 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {CATEGORIES.map(c => (
                  <SelectItem key={c} value={c} className="text-xs">{c === "All" ? "All Categories" : `${c} — ${CATEGORY_LABELS[c] || c}`}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filterSeverity} onValueChange={setFilterSeverity}>
              <SelectTrigger className="h-9 w-28 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {SEVERITIES.map(s => <SelectItem key={s} value={s} className="text-xs">{s === "All" ? "All Severity" : s.toUpperCase()}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="h-9 w-28 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {STATUSES.map(s => <SelectItem key={s} value={s} className="text-xs">{s === "All" ? "All Status" : s}</SelectItem>)}
              </SelectContent>
            </Select>
            {(filterCategory !== "All" || filterSeverity !== "All" || filterStatus !== "All" || searchRule) && (
              <Button variant="ghost" size="sm" className="text-xs h-9" onClick={() => { setFilterCategory("All"); setFilterSeverity("All"); setFilterStatus("All"); setSearchRule(""); }}>
                <X size={12} /> Clear
              </Button>
            )}
          </div>

          {/* Findings table */}
          <Card>
            <ScrollArea className="max-h-[500px]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8"></TableHead>
                    <TableHead className="text-xs">Rule ID</TableHead>
                    <TableHead className="text-xs">Rule Name</TableHead>
                    <TableHead className="text-xs">Account</TableHead>
                    <TableHead className="text-xs text-right">Amount</TableHead>
                    <TableHead className="text-xs">Severity</TableHead>
                    <TableHead className="text-xs">Status</TableHead>
                    <TableHead className="text-xs">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center text-sm text-muted-foreground py-12">
                        {stats.total === 0 ? "No findings yet — run scrutiny to generate" : "No findings match filters"}
                      </TableCell>
                    </TableRow>
                  ) : filtered.map((f: any) => (
                    <>
                      <TableRow key={f.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setExpandedRow(expandedRow === f.id ? null : f.id)}>
                        <TableCell className="w-8">
                          {expandedRow === f.id ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        </TableCell>
                        <TableCell className="text-xs font-mono">{f.rule_id}</TableCell>
                        <TableCell className="text-xs max-w-[200px] truncate">{f.rule_name}</TableCell>
                        <TableCell className="text-xs">
                          <button className="text-primary hover:underline" onClick={(e) => { e.stopPropagation(); setDrillAccount(f.account_name); }}>
                            {f.account_name || "—"}
                          </button>
                        </TableCell>
                        <TableCell className="text-xs text-right font-mono">
                          {f.amount ? `₹${Number(f.amount).toLocaleString("en-IN")}` : "—"}
                        </TableCell>
                        <TableCell>
                          <Badge className={cn("text-[10px]", SEVERITY_COLORS[f.severity] || "")}>{f.severity?.toUpperCase()}</Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={cn("text-[10px]", STATUS_COLORS[f.status] || "")}>{f.status}</Badge>
                        </TableCell>
                        <TableCell>
                          {f.status === "open" && (
                            <div className="flex gap-1" onClick={e => e.stopPropagation()}>
                              <Button size="sm" variant="ghost" className="h-6 text-[10px] px-1.5" onClick={() => updateFindingStatus(f.id, "accepted")}>
                                <CheckCircle2 size={12} /> Accept
                              </Button>
                              <Button size="sm" variant="ghost" className="h-6 text-[10px] px-1.5" onClick={() => raiseQuery(f)}>
                                <MessageSquare size={12} /> Query
                              </Button>
                              <Button size="sm" variant="ghost" className="h-6 text-[10px] px-1.5" onClick={() => updateFindingStatus(f.id, "noted")}>
                                <FileText size={12} /> Note
                              </Button>
                              <Button size="sm" variant="ghost" className="h-6 text-[10px] px-1.5" onClick={() => { setOverrideDialog({ id: f.id, ruleId: f.rule_id }); setOverrideReason(""); }}>
                                Override
                              </Button>
                            </div>
                          )}
                          {f.status === "queried" && f.linked_query_id && (
                            <Badge variant="outline" className="text-[10px]">Query #{f.linked_query_id.slice(0, 8)}</Badge>
                          )}
                        </TableCell>
                      </TableRow>
                      {expandedRow === f.id && (
                        <TableRow>
                          <TableCell colSpan={8} className="bg-muted/30 p-4">
                            <div className="space-y-2 text-xs">
                              <p><strong>Finding:</strong> {f.finding_text}</p>
                              <p><strong>Auto Query:</strong> {f.auto_query_text}</p>
                              {f.override_reason && <p><strong>Override Reason:</strong> {f.override_reason}</p>}
                              {f.voucher_ref && <p><strong>Voucher Ref:</strong> {f.voucher_ref}</p>}
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          </Card>
        </TabsContent>

        <TabsContent value="comparative" className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Two-Year Comparative Analysis</CardTitle>
            </CardHeader>
            <CardContent>
              {engagement?.parent_engagement_id ? (
                <p className="text-sm text-muted-foreground">Comparative analysis runs against the parent engagement's TB data. Any account where CY vs PY change exceeds materiality threshold is flagged.</p>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <BarChart3 size={32} className="mx-auto mb-2 opacity-40" />
                  <p className="text-sm">No prior year engagement linked. Comparative analysis requires a parent engagement.</p>
                  <p className="text-xs mt-1">Link a prior year engagement in Stage 1 to enable comparative analysis.</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Override dialog */}
      <Dialog open={!!overrideDialog} onOpenChange={() => setOverrideDialog(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Override Finding — {overrideDialog?.ruleId}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Provide a mandatory justification for overriding this scrutiny finding. This creates an audit trail entry.</p>
            <Textarea placeholder="Reason for override..." value={overrideReason} onChange={e => setOverrideReason(e.target.value)} rows={3} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOverrideDialog(null)}>Cancel</Button>
            <Button disabled={!overrideReason.trim()} onClick={() => {
              if (overrideDialog) updateFindingStatus(overrideDialog.id, "overridden", overrideReason);
              setOverrideDialog(null);
            }}>Confirm Override</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Ledger drill-down */}
      <Dialog open={!!drillAccount} onOpenChange={() => setDrillAccount(null)}>
        <DialogContent className="max-w-4xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle className="text-sm">Ledger Drill-Down — {drillAccount}</DialogTitle>
          </DialogHeader>
          <ScrollArea className="max-h-[60vh]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Date</TableHead>
                  <TableHead className="text-xs">Voucher Type</TableHead>
                  <TableHead className="text-xs">Voucher No</TableHead>
                  <TableHead className="text-xs">Narration</TableHead>
                  <TableHead className="text-xs text-right">Debit</TableHead>
                  <TableHead className="text-xs text-right">Credit</TableHead>
                  <TableHead className="text-xs">Flagged</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(ledgerTxns || []).length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-sm text-muted-foreground py-8">No ledger transactions found for this account</TableCell>
                  </TableRow>
                ) : (ledgerTxns || []).map((t: any) => (
                  <TableRow key={t.id}>
                    <TableCell className="text-xs">{t.date}</TableCell>
                    <TableCell className="text-xs">{t.voucher_type}</TableCell>
                    <TableCell className="text-xs font-mono">{t.voucher_no}</TableCell>
                    <TableCell className="text-xs max-w-[200px] truncate">{t.narration}</TableCell>
                    <TableCell className="text-xs text-right font-mono">{t.debit ? `₹${Number(t.debit).toLocaleString("en-IN")}` : ""}</TableCell>
                    <TableCell className="text-xs text-right font-mono">{t.credit ? `₹${Number(t.credit).toLocaleString("en-IN")}` : ""}</TableCell>
                    <TableCell>{t.scrutiny_flag && <Badge variant="destructive" className="text-[9px]">⚠ {t.flag_reason || "Flagged"}</Badge>}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </div>
  );
}
