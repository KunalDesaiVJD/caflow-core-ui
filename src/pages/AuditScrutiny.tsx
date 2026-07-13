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
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle, CheckCircle2, Shield, ShieldAlert, ShieldQuestion, FileSpreadsheet, Play, Download, FileText, FileCode, BarChart3, ChevronLeft, ChevronRight, X, Loader2, Calculator, Sparkles } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import MarkdownView from "@/components/scrutiny-v2/MarkdownView";
import { exportDeliverable } from "@/lib/scrutiny/deliverableExport";
import { TdsReconModule } from "@/components/tds-recon/TdsReconModule";
import { SEVERITIES, STATUSES, type Finding, type RuleTemplate } from "@/lib/scrutiny/scrutinyUi";
import ScrutinyTemplatesView from "@/components/scrutiny-v2/ScrutinyTemplatesView";
import ScrutinyWorkpaperView from "@/components/scrutiny-v2/ScrutinyWorkpaperView";
import ScrutinyCoveragePanel from "@/components/scrutiny-v2/ScrutinyCoveragePanel";
import ScrutinyFactsPanel from "@/components/scrutiny-v2/ScrutinyFactsPanel";
import ScrutinyForensicsPanel from "@/components/scrutiny-v2/ScrutinyForensicsPanel";
import ScrutinyConnectorsPanel from "@/components/scrutiny-v2/ScrutinyConnectorsPanel";
import ScrutinyOverviewPanel from "@/components/scrutiny-v2/ScrutinyOverviewPanel";
import ScrutinyDeliverablesPanel from "@/components/scrutiny-v2/ScrutinyDeliverablesPanel";
import ScrutinyPortfolioPanel from "@/components/scrutiny-v2/ScrutinyPortfolioPanel";
import ScrutinyRuleMasterPanel from "@/components/scrutiny-v2/ScrutinyRuleMasterPanel";
import {
  buildDraftQuery, canReviewQuery, SCRUTINY_QUERY_SOURCE,
  QUERY_STATUS_OPEN, QUERY_STATUS_REJECTED,
} from "@/lib/scrutiny/makerChecker";
import { draftQueryWithAI } from "@/lib/scrutiny/aiQueryDraft";
import { classifyFindingsWithAI, type NarrationClass } from "@/lib/scrutiny/aiNarration";
import { identifyTdsSectionWithAI, type TdsSection } from "@/lib/scrutiny/aiTdsSection";
import { matchExclusions, buildExclusionSet, type PriorWaived } from "@/lib/scrutiny/exclusionLearning";
import { FACT_CATALOGUE, factGateStatus } from "@/lib/scrutiny/facts";
import { investigateWithAI } from "@/lib/scrutiny/aiInvestigator";
import { suggestedPrompts } from "@/lib/scrutiny/investigatorPrompts";
import { computeCoverage, groupByTemplate } from "@/lib/scrutiny/coverage";

const CATEGORIES = ["All", "TDS", "GST", "Cash Payments", "Loans", "Prior Period", "Depreciation", "Deferred Tax", "Bank Recon", "Narration AI"];
const FY_OPTIONS = ["2026-27", "2025-26", "2024-25", "2023-24", "2022-23", "2021-22"];
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
  const [scrutinyQueries, setScrutinyQueries] = useState<{ id: string; source_ref_id: string | null; status: string; created_at?: string | null; client_reply?: string | null }[]>([]);
  const [rejectTarget, setRejectTarget] = useState<{ finding: Finding; queryId: string } | null>(null);
  const [v2Tab, setV2Tab] = useState<"overview" | "templates" | "ledger" | "facts" | "forensics" | "connectors" | "deliverables" | "portfolio" | "rulemaster">("overview");
  const isSuperAdmin = user?.role === "superadmin";
  // AI narration classification (Ticket 2.2): finding_id -> suggested category / 3CD clause
  const [narrationClasses, setNarrationClasses] = useState<Record<string, NarrationClass>>({});
  const [classifying, setClassifying] = useState(false);
  // AI TDS-section identification (Ticket 2.3) — per finding, shown in the detail sheet
  const [tdsSection, setTdsSection] = useState<TdsSection | null>(null);
  const [tdsLoading, setTdsLoading] = useState(false);
  // Exclusion learning (Ticket 2.5): prior-period waivers for this client
  const [priorWaived, setPriorWaived] = useState<PriorWaived[]>([]);
  // Gate-4 fact-gating (Ticket 3.4): captured general facts for the advisory banner
  const [capturedFacts, setCapturedFacts] = useState<Record<string, string>>({});
  // NL investigator (Ticket 4.1)
  const [investigatorQ, setInvestigatorQ] = useState("");
  const [investigatorAnswer, setInvestigatorAnswer] = useState<string | null>(null);
  const [investigatorTitle, setInvestigatorTitle] = useState("AI Auditor answer");
  const [investigating, setInvestigating] = useState(false);

  // Filters — default FY from engagement context
  const [fy, setFy] = useState(contextFY || "2025-26");

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
  // Completeness ledger from the last Run Scrutiny — proves every active rule was accounted for.
  const [runCompleteness, setRunCompleteness] = useState<{ activeRules: number; accountedFor: number; executed: number; needsData: number; noHandler: number; errored: number } | null>(null);

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
    // PostgREST caps a single select at 1000 rows; page through so ALL findings are shown
    // (a large engagement can produce >1000 — the severity cards must reflect the true total).
    const PAGE = 1000;
    const all: Finding[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from("scrutiny_findings")
        .select("*")
        .eq("client_id", clientId)
        .eq("financial_year", fy)
        .order("severity", { ascending: true })
        .range(from, from + PAGE - 1);
      if (error || !data || data.length === 0) break;
      all.push(...(data as Finding[]));
      if (data.length < PAGE) break;
    }
    setFindings(all);
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
      .select("id, source_ref_id, status, created_at, client_reply")
      .eq("client_id", clientId)
      .eq("financial_year", fy)
      .eq("source", SCRUTINY_QUERY_SOURCE);
    if (Array.isArray(data)) setScrutinyQueries(data);
  };
  useEffect(() => { fetchScrutinyQueries(); }, [v2, clientId, fy]);

  // Prior-period waivers for this client (all FYs) — exclusion learning source
  useEffect(() => {
    if (!v2 || !clientId) return;
    (supabase.from as any)("scrutiny_findings")
      .select("rule_id, narration, financial_year")
      .eq("client_id", clientId)
      .eq("status", "waived")
      .then(({ data }: any) => { if (Array.isArray(data)) setPriorWaived(data); });
  }, [v2, clientId]);

  // Captured judgment facts for the Gate-4 advisory banner (Ticket 3.4)
  const fetchCapturedFacts = async () => {
    if (!v2 || !clientId) return;
    try {
      const { data } = await (supabase.from as any)("scrutiny_facts")
        .select("fact_key, fact_value")
        .eq("client_id", clientId).eq("financial_year", fy).eq("fact_type", "general");
      const m: Record<string, string> = {};
      for (const r of (data ?? [])) if (r?.fact_value != null) m[r.fact_key] = String(r.fact_value);
      setCapturedFacts(m);
    } catch { /* graceful — store may not be deployed */ }
  };
  useEffect(() => { fetchCapturedFacts(); }, [v2, clientId, fy]);
  // Refresh the banner after the auditor edits facts and leaves the Facts tab
  useEffect(() => { if (v2Tab !== "facts") fetchCapturedFacts(); }, [v2Tab]);

  // finding_id -> its linked query { id, status } (via the finding's linked_query_id)
  const queryByFinding = useMemo(() => {
    const byId = new Map(scrutinyQueries.map(q => [q.id, q]));
    const m: Record<string, { id: string; status: string; created_at?: string | null; client_reply?: string | null }> = {};
    for (const f of findings) {
      if (f.linked_query_id && byId.has(f.linked_query_id)) {
        const q = byId.get(f.linked_query_id)!;
        m[f.id] = { id: q.id, status: q.status, created_at: q.created_at ?? null, client_reply: q.client_reply ?? null };
      }
    }
    return m;
  }, [findings, scrutinyQueries]);

  // finding_id -> true when it recurs from a prior-period waiver (exclusion learning)
  const priorExclusions = useMemo(
    () => matchExclusions(findings, buildExclusionSet(priorWaived, fy)),
    [findings, priorWaived, fy],
  );

  // Gate-4 advisory completeness (Ticket 3.4) — never blocks anything
  const factGate = useMemo(() => factGateStatus(FACT_CATALOGUE, capturedFacts), [capturedFacts]);

  // Context-aware quick prompts for the investigator (Ticket 4.2)
  const investigatorPrompts = useMemo(() => suggestedPrompts({
    findingCount: findings.length,
    hasTds: findings.some((f) => (f.rule_id ?? "").toUpperCase().startsWith("TDS")),
    missingFactsCount: factGate.missing.length,
    recurringCount: Object.keys(priorExclusions).length,
  }), [findings, factGate, priorExclusions]);

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

  // ── Close the loop from a client reply (Ticket 8.6) ──────────────────────
  const handleCloseFromReply = async (findingId: string, queryId: string) => {
    const finding = findings.find((f) => f.id === findingId);
    await supabase.from("scrutiny_findings").update({ status: "resolved" }).eq("id", findingId);
    await (supabase.from as any)("audit_client_queries").update({ status: "Clarified" }).eq("id", queryId);
    track("finding_resolve", { rule_id: finding?.rule_id, resolution_note: "closed from client reply", severity: finding?.severity });
    toast({ title: "Finding resolved from client reply", description: "The query is marked Clarified." });
    fetchFindings();
    fetchScrutinyQueries();
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

  // ── NL investigator (Ticket 4.1) — read-only, grounded, graceful ─────────
  const handleInvestigate = async (q?: string) => {
    const question = (q ?? investigatorQ).trim();
    if (!question) return;
    setInvestigatorTitle(question.length > 70 ? `${question.slice(0, 67)}…` : question);
    if (q) setInvestigatorQ(q);
    setInvestigating(true);
    setInvestigatorAnswer(null);
    const cov = computeCoverage(groupByTemplate(rules, findings));
    const ans = await investigateWithAI(
      (fn, opts) => (supabase.functions.invoke as any)(fn, opts),
      question,
      {
        findings,
        financialYear: fy,
        coverage: { auto: cov.auto, advisory: cov.advisory, total: cov.total },
        facts: {
          captured: factGate.captured, total: factGate.total,
          requiredCaptured: factGate.requiredCaptured, requiredTotal: factGate.requiredTotal,
          missing: factGate.missing.map((f) => f.label),
        },
        recurringCount: Object.keys(priorExclusions).length,
      },
      { clientId, financialYear: fy, engagementId: (auditCtx?.selectedEngagement as any)?.id ?? null },
    );
    setInvestigatorAnswer(ans ?? "The AI investigator is unavailable (the gateway isn't deployed yet). Your findings and views are unaffected.");
    setInvestigating(false);
  };

  // ── AI TDS-section identification (Ticket 2.3) ───────────────────────────
  useEffect(() => { setTdsSection(null); }, [detailFinding]);
  const handleIdentifyTds = async () => {
    if (!detailFinding) return;
    setTdsLoading(true);
    const rule = rules.find(r => r.rule_id === detailFinding.rule_id);
    const res = await identifyTdsSectionWithAI(
      (fn, opts) => (supabase.functions.invoke as any)(fn, opts),
      detailFinding, rule,
    );
    setTdsSection(res);
    if (!res) toast({ title: "TDS section not determined", description: "Gateway unavailable or no clear section.", variant: "destructive" });
    setTdsLoading(false);
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
    if (!clientId) return;
    setRunning(true);
    toast({ title: "Running scrutiny…", description: "Large engagements can take up to a minute." });
    try {
      const { data: userData } = await supabase.from("users").select("firm_id").eq("id", user?.id).single();
      // Baseline = newest existing finding (server created_at). Lets us detect the fresh batch even
      // when a large engagement (~1 min) exceeds the client-side invoke timeout while the edge
      // function is still running server-side — so we never show a false "failed".
      const { data: baseRow } = await supabase
        .from("scrutiny_findings")
        .select("created_at")
        .eq("client_id", clientId).eq("financial_year", fy)
        .order("created_at", { ascending: false }).limit(1);
      const baseline = (baseRow?.[0] as { created_at?: string } | undefined)?.created_at ?? "1970-01-01T00:00:00Z";

      let invokeOk = false;
      let invokeErr: { message?: string } | null = null;
      const invokePromise = supabase.functions
        .invoke(scrutinyRunFunction(), {
          body: {
            client_id: clientId,
            financial_year: fy,
            firm_id: userData?.firm_id,
            engagement_id: (auditCtx?.selectedEngagement as any)?.id ?? null,
          },
        })
        .then(({ data, error }) => {
          if (error) invokeErr = error;
          else { invokeOk = true; const c = (data as { completeness?: typeof runCompleteness })?.completeness; if (c) setRunCompleteness(c); }
        })
        .catch((e) => { invokeErr = e; });

      const freshFound = async () => {
        const { data } = await supabase
          .from("scrutiny_findings").select("id")
          .eq("client_id", clientId).eq("financial_year", fy)
          .gt("created_at", baseline).limit(1);
        return !!(data && data.length);
      };

      // Poll up to 3 min. On a fast/clean run the invoke resolves first; on a large run the invoke
      // may error (client timeout) while the function keeps running — so on error we keep polling.
      const deadline = Date.now() + 180000;
      let done = false;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 3000));
        if (await freshFound()) { done = true; break; }
        if (invokeOk) { done = true; break; }
      }
      await invokePromise.catch(() => {});
      await fetchFindings();
      if (done || invokeOk) {
        toast({ title: "Scrutiny complete", description: "Findings have been updated." });
      } else {
        toast({ title: "Scrutiny failed", description: invokeErr?.message ?? "Edge Function error", variant: "destructive" });
      }
    } catch (err: any) {
      toast({ title: "Scrutiny failed", description: err?.message ?? "Error", variant: "destructive" });
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
    priorExclusions,
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
            {/* "No audit firm assigned" advisory removed — it only checked client_auditor_assignments for the FY and was a false warning. */}
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

      {/* Completeness ledger — every active rule accounted for on the last run (no rule left behind) */}
      {runCompleteness && (() => {
        const clean = runCompleteness.noHandler === 0 && runCompleteness.errored === 0 && runCompleteness.accountedFor === runCompleteness.activeRules;
        return (
          <div className={`rounded-md border px-4 py-2 text-xs flex flex-wrap items-center gap-x-3 gap-y-1 ${clean ? "border-green-300 bg-green-50 text-green-800" : "border-amber-300 bg-amber-50 text-amber-800"}`}>
            {clean ? <CheckCircle2 size={14} className="shrink-0" /> : <AlertTriangle size={14} className="shrink-0" />}
            <span className="font-medium">Rule completeness: {runCompleteness.accountedFor}/{runCompleteness.activeRules} active rules accounted for.</span>
            <span>{runCompleteness.executed} executed</span>
            {runCompleteness.needsData > 0 && <span>· {runCompleteness.needsData} need more data</span>}
            {runCompleteness.noHandler > 0 && <span className="font-medium">· {runCompleteness.noHandler} have no engine handler (would not run)</span>}
            {runCompleteness.errored > 0 && <span className="font-medium text-destructive">· {runCompleteness.errored} errored</span>}
            {clean && <span className="text-green-700">No rule was silently skipped.</span>}
          </div>
        );
      })()}

      {/* v2 scrutiny views (behind flag): advisory coverage panel + Templates / By-Ledger */}
      {v2 && (
        <div className="space-y-4">
          {/* NL investigator command bar (Ticket 4.1) — read-only, grounded */}
          <Card>
            <CardContent className="p-3 space-y-2">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary shrink-0" />
                <Input
                  value={investigatorQ}
                  onChange={(e) => setInvestigatorQ(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleInvestigate(); }}
                  placeholder="Ask the AI auditor… e.g. 'Which ledgers carry the highest-risk findings and need queries?'"
                  className="h-9"
                />
                <Button onClick={() => handleInvestigate()} disabled={investigating || !investigatorQ.trim()}>
                  {investigating ? <Loader2 className="h-4 w-4 animate-spin" /> : "Ask"}
                </Button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {investigatorPrompts.map((p) => (
                  <button
                    key={p.label}
                    type="button"
                    onClick={() => handleInvestigate(p.question)}
                    disabled={investigating}
                    className="text-[11px] px-2 py-1 rounded-full border text-muted-foreground hover:bg-muted/60 disabled:opacity-50"
                    title={p.question}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              {investigatorAnswer && (
                <div className="rounded-md border bg-muted/30 p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">AI Auditor answer</span>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button size="sm" variant="outline" className="h-7"><Download className="h-3.5 w-3.5 mr-1" />Download</Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => exportDeliverable("docx", investigatorAnswer, investigatorTitle)}><FileText className="h-3.5 w-3.5 mr-2" />Word (.docx)</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => exportDeliverable("pdf", investigatorAnswer, investigatorTitle)}><FileText className="h-3.5 w-3.5 mr-2" />PDF</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => exportDeliverable("xlsx", investigatorAnswer, investigatorTitle)}><FileSpreadsheet className="h-3.5 w-3.5 mr-2" />Excel (.xlsx)</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => exportDeliverable("csv", investigatorAnswer, investigatorTitle)}><FileSpreadsheet className="h-3.5 w-3.5 mr-2" />CSV</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => exportDeliverable("md", investigatorAnswer, investigatorTitle)}><FileCode className="h-3.5 w-3.5 mr-2" />Markdown</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                  <MarkdownView md={investigatorAnswer} />
                </div>
              )}
            </CardContent>
          </Card>

          {/* Gate-4 fact-gating advisory (Ticket 3.4) — never blocks sign-off / UDIN */}
          {v2Tab !== "facts" && factGate.missing.length > 0 && (
            <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-2 text-xs text-amber-800 flex items-center gap-2 flex-wrap">
              <AlertTriangle size={14} className="shrink-0" />
              <span>{factGate.missing.length} of {factGate.requiredTotal} required judgment facts not captured — advisory, does not block sign-off / UDIN.</span>
              <button type="button" className="underline font-medium" onClick={() => setV2Tab("facts")}>Go to Facts &amp; Judgment</button>
            </div>
          )}
          <ScrutinyCoveragePanel rules={rules} />
          <div className="inline-flex rounded-md border overflow-hidden">
            <button
              type="button"
              onClick={() => setV2Tab("overview")}
              className={`px-3 py-1.5 text-xs font-medium border-r transition-colors ${v2Tab === "overview" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted/60"}`}
            >
              Overview
            </button>
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
              className={`px-3 py-1.5 text-xs font-medium border-r transition-colors ${v2Tab === "ledger" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted/60"}`}
            >
              By Ledger
            </button>
            <button
              type="button"
              onClick={() => setV2Tab("facts")}
              className={`px-3 py-1.5 text-xs font-medium border-r transition-colors ${v2Tab === "facts" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted/60"}`}
            >
              Facts &amp; Judgment
            </button>
            <button
              type="button"
              onClick={() => setV2Tab("forensics")}
              className={`px-3 py-1.5 text-xs font-medium border-r transition-colors ${v2Tab === "forensics" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted/60"}`}
            >
              Forensics
            </button>
            <button
              type="button"
              onClick={() => setV2Tab("connectors")}
              className={`px-3 py-1.5 text-xs font-medium border-r transition-colors ${v2Tab === "connectors" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted/60"}`}
            >
              Connectors
            </button>
            <button
              type="button"
              onClick={() => setV2Tab("deliverables")}
              className={`px-3 py-1.5 text-xs font-medium border-r transition-colors ${v2Tab === "deliverables" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted/60"}`}
            >
              Deliverables
            </button>
            <button
              type="button"
              onClick={() => setV2Tab("portfolio")}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${v2Tab === "portfolio" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted/60"}`}
            >
              Portfolio
            </button>
            {isSuperAdmin && (
              <button
                type="button"
                onClick={() => setV2Tab("rulemaster")}
                className={`px-3 py-1.5 text-xs font-medium border-l transition-colors ${v2Tab === "rulemaster" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted/60"}`}
              >
                Rule Master
              </button>
            )}
          </div>
          {v2Tab === "overview"
            ? <ScrutinyOverviewPanel findings={findings} rules={rules} queryByFinding={queryByFinding} factGate={factGate} priorExclusionCount={Object.keys(priorExclusions).length} onCloseFromReply={handleCloseFromReply} />
            : v2Tab === "facts"
            ? <ScrutinyFactsPanel clientId={clientId} financialYear={fy} userId={user?.id ?? null} />
            : v2Tab === "forensics"
              ? <ScrutinyForensicsPanel clientId={clientId} financialYear={fy} />
              : v2Tab === "connectors"
                ? <ScrutinyConnectorsPanel clientId={clientId} financialYear={fy} engagementId={(auditCtx?.selectedEngagement as any)?.id ?? null} />
                : v2Tab === "deliverables"
                ? <ScrutinyDeliverablesPanel findings={findings} rules={rules} financialYear={fy} factGate={factGate} />
                : v2Tab === "portfolio"
                ? <ScrutinyPortfolioPanel rules={rules} clientId={clientId} />
                : v2Tab === "rulemaster" && isSuperAdmin
                ? <ScrutinyRuleMasterPanel previewContext={clientId && fy ? { client_id: clientId, financial_year: fy, engagement_id: (auditCtx?.selectedEngagement as any)?.id ?? undefined } : undefined} />

                : v2Tab === "templates"
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
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-medium text-muted-foreground">TDS section (AI):</span>
                  <Button size="sm" variant="outline" onClick={handleIdentifyTds} disabled={tdsLoading}>
                    {tdsLoading ? "Identifying…" : "Identify"}
                  </Button>
                </div>
                {tdsSection && (
                  <p className="mt-1">
                    <span className="font-mono">{tdsSection.section}</span>
                    {tdsSection.rate != null && <span> · {tdsSection.rate}%</span>}
                    {tdsSection.threshold != null && <span> · threshold ₹{tdsSection.threshold.toLocaleString("en-IN")}</span>}
                    {tdsSection.flag_message && <span className="block text-xs text-muted-foreground mt-0.5">{tdsSection.flag_message}</span>}
                  </p>
                )}
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
