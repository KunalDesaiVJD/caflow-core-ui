import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuditContext } from "@/hooks/useAuditContext";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  ArrowLeft, Upload, CheckCircle2, AlertTriangle, FileSpreadsheet, Loader2,
  ChevronRight, ChevronDown, FolderTree, Layers, Tag, Zap, AlertCircle, Trash2, RefreshCw,
  CalendarDays, FileText,
} from "lucide-react";
import * as XLSX from "xlsx";

const FY_OPTIONS = ["2024-25", "2023-24", "2022-23", "2021-22"];

const CATEGORY_LABELS: Record<string, string> = {
  PURCH: "Purchases & Expenses", SALES: "Sales & Revenue", CASH: "Cash & Bank",
  BKR: "Bank Reconciliation", TAX: "Tax (TDS/GST)", TDS: "TDS", GST: "GST",
  FA: "Fixed Assets", PAY: "Payroll", DEBT: "Debtors", CRED: "Creditors",
  EXP: "General Expenses", LOAN: "Loans & Borrowings", INV: "Investments",
  PROV: "Provisions", CAP: "Capital & Reserves", DEP: "Depreciation", INT: "Interest",
};

interface HierarchyNode {
  nodeId: string;
  parentNodeId: string | null;
  name: string;
  level: number;
  isLeaf: boolean;
  bold: boolean;
  indent: number;
  opening: number;
  txnDebit: number;
  txnCredit: number;
  closing: number;
  primaryGroup: string;
  bsPlSide: string;
  normalBal: string;
}

interface TaggingResult {
  success: boolean;
  totalLedgers: number;
  tagged: number;
  unmatched: number;
  categoryBreakdown: Record<string, number>;
  unmatchedLedgers: { id: string; name: string }[];
}

interface ImportStats {
  totalNodes: number;
  leafLedgers: number;
  primaryGroups: number;
  primaryGroupNames: string[];
  bsAccounts: number;
  plAccounts: number;
  totalDr: number;
  totalCr: number;
  isBalanced: boolean;
  detectedFormat: string;
  batchId: string;
  hierarchy: HierarchyNode[];
  tagging: TaggingResult | null;
}

interface ExistingTBData {
  totalLedgers: number;
  bsCount: number;
  plCount: number;
  financialYear: string;
  importFormat: string | null;
  // Fix (Issue 2): txn_debit + txn_credit added for full comparison column display
  ledgers: { id: string; ledger_name: string | null; primary_group: string | null; bs_pl_side: string | null; closing_balance: number | null; opening_balance: number | null; txn_debit?: number | null; txn_credit?: number | null; matched_category_code: string | null }[];
}

// ─── Tree Node ───
function TreeNode({ node, allNodes }: { node: HierarchyNode; allNodes: HierarchyNode[] }) {
  const [open, setOpen] = useState(node.level <= 2);
  const children = allNodes.filter(n => n.parentNodeId === node.nodeId);
  const hasChildren = children.length > 0;
  const fmtNum = (n: number) => Math.abs(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const splitDrCr = (n: number) => (n >= 0 ? { dr: n || 0, cr: 0 } : { dr: 0, cr: Math.abs(n || 0) });
  const opening = splitDrCr(node.opening || 0);
  const closing = splitDrCr(node.closing || 0);

  if (node.isLeaf) {
    return (
      <div className="flex items-center gap-2 py-1 px-2 hover:bg-muted/50 rounded text-xs" style={{ paddingLeft: `${(node.level - 1) * 20 + 12}px` }}>
        <div className="w-4" />
        <span className="flex-1 text-foreground">{node.name}</span>
        <span className="w-24 text-right font-mono text-muted-foreground">{fmtNum(opening.dr)}</span>
        <span className="w-24 text-right font-mono text-muted-foreground">{fmtNum(opening.cr)}</span>
        <span className="w-24 text-right font-mono text-muted-foreground">{fmtNum(node.txnDebit || 0)}</span>
        <span className="w-24 text-right font-mono text-muted-foreground">{fmtNum(node.txnCredit || 0)}</span>
        <span className="w-24 text-right font-mono font-medium text-foreground">{fmtNum(closing.dr)}</span>
        <span className="w-24 text-right font-mono font-medium text-foreground">{fmtNum(closing.cr)}</span>
      </div>
    );
  }

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <div className="flex items-center gap-2 py-1.5 px-2 hover:bg-muted/30 rounded cursor-pointer text-xs"
          style={{ paddingLeft: `${(node.level - 1) * 20 + 12}px` }}>
          {hasChildren ? (open ? <ChevronDown size={14} className="text-muted-foreground shrink-0" /> : <ChevronRight size={14} className="text-muted-foreground shrink-0" />) : <div className="w-[14px]" />}
          <span className="flex-1 font-semibold text-muted-foreground">{node.name}</span>
          <Badge variant="outline" className="text-[10px] h-4">{node.bsPlSide}</Badge>
          <span className="w-24 text-right font-mono text-muted-foreground">{fmtNum(opening.dr)}</span>
          <span className="w-24 text-right font-mono text-muted-foreground">{fmtNum(opening.cr)}</span>
          <span className="w-24 text-right font-mono text-muted-foreground">{fmtNum(node.txnDebit || 0)}</span>
          <span className="w-24 text-right font-mono text-muted-foreground">{fmtNum(node.txnCredit || 0)}</span>
          <span className="w-24 text-right font-mono text-muted-foreground">{fmtNum(closing.dr)}</span>
          <span className="w-24 text-right font-mono text-muted-foreground">{fmtNum(closing.cr)}</span>
        </div>
      </CollapsibleTrigger>
      <CollapsibleContent>
        {children.map(child => <TreeNode key={child.nodeId} node={child} allNodes={allNodes} />)}
      </CollapsibleContent>
    </Collapsible>
  );
}

export default function ImportTrialBalance() {
  const { clientId: routeClientId } = useParams<{ clientId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();

  const auditCtx = useAuditContext();
  const contextClientId = auditCtx?.selectedEngagement?.client_id || "";
  const contextEngagementId = auditCtx?.selectedEngagementId || "";

  const [selectedClientId, setSelectedClientId] = useState("");
  const [clientsList, setClientsList] = useState<{ id: string; name: string | null }[]>([]);
  const [engagementId, setEngagementId] = useState("");
  const [engagements, setEngagements] = useState<{ id: string; financial_year: string | null; client_id: string | null }[]>([]);

  const clientId = routeClientId || selectedClientId || contextClientId;
  const fileRef = useRef<HTMLInputElement>(null);
  const firmId = user?.firm_id;

  const [fy, setFy] = useState("2024-25");
  const [fileName, setFileName] = useState("");
  const [fileBase64, setFileBase64] = useState("");
  const [parsing, setParsing] = useState(false);
  const [parseProgress, setParseProgress] = useState("");
  const [importStats, setImportStats] = useState<ImportStats | null>(null);
  const [hierarchyNodes, setHierarchyNodes] = useState<HierarchyNode[]>([]);
  const [viewMode, setViewMode] = useState<"tree" | "flat">("tree");
  const [error, setError] = useState("");

  const [showReimportDialog, setShowReimportDialog] = useState(false);
  const [existingImport, setExistingImport] = useState(false);
  const [existingTBData, setExistingTBData] = useState<ExistingTBData | null>(null);
  const [loadingExisting, setLoadingExisting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [reimportAction, setReimportAction] = useState<"replace" | "prior_year" | null>(null);

  // Fix (Issue 2): Prior Period TB state — loaded from audit_engagements.prior_year_tb_snapshot
  const [priorTbLeaves, setPriorTbLeaves] = useState<any[]>([]);
  const [priorTbImportedAt, setPriorTbImportedAt] = useState<string | null>(null);
  const [showDeletePriorConfirm, setShowDeletePriorConfirm] = useState(false);
  const [deletingPriorTb, setDeletingPriorTb] = useState(false);
  const [showPriorReupload, setShowPriorReupload] = useState(false);
  const priorFileRef = useRef<HTMLInputElement>(null);
  const [priorFileName, setPriorFileName] = useState("");
  const [priorFileBase64, setPriorFileBase64] = useState("");
  const [parsePrior, setParsePrior] = useState(false);

  const [unmatchedOverrides, setUnmatchedOverrides] = useState<Record<string, string>>({});
  const [savingOverrides, setSavingOverrides] = useState(false);

  // Fix (Issue 3): Ledger reclassify state
  const [editingLedger, setEditingLedger] = useState<string | null>(null);
  const [editGroup, setEditGroup] = useState("");
  const [editBsPlSide, setEditBsPlSide] = useState("");

  // Auto-set engagement from context
  useEffect(() => {
    if (contextEngagementId && !engagementId) {
      setEngagementId(contextEngagementId);
    }
  }, [contextEngagementId]);

  // Load clients only if no context client
  useEffect(() => {
    if (routeClientId || contextClientId) return;
    const load = async () => {
      let q = supabase.from("clients").select("id, name").eq("is_draft", false).is("deleted_at", null).neq("is_active", false).order("name");
      if (firmId) q = q.eq("firm_id", firmId);
      const { data } = await q;
      setClientsList(data || []);
    };
    load();
  }, [firmId, routeClientId, contextClientId]);

  // Load engagements
  useEffect(() => {
    if (!clientId) return;
    const load = async () => {
      const { data } = await supabase.from("audit_engagements")
        .select("id, financial_year, client_id")
        .eq("client_id", clientId)
        .order("financial_year", { ascending: false });
      setEngagements(data || []);
      if (data && data.length > 0 && !engagementId) setEngagementId(data[0].id);
    };
    load();
  }, [clientId]);

  // Check for existing import + hierarchy + prior year TB when engagement changes
  useEffect(() => {
    if (!engagementId) return;
    void Promise.all([loadExistingTB(), loadHierarchy(), loadPriorTB()]);
  }, [engagementId]);

  // Fix (Issue 2): Load prior period TB snapshot from audit_engagements
  const loadPriorTB = async () => {
    if (!engagementId) return;
    const { data } = await (supabase as any)
      .from("audit_engagements")
      .select("prior_year_tb_snapshot, prior_year_tb_imported_at")
      .eq("id", engagementId)
      .maybeSingle();
    const snapshot = (data?.prior_year_tb_snapshot as any[]) || [];
    const importedAt = data?.prior_year_tb_imported_at || null;
    setPriorTbLeaves(snapshot);
    setPriorTbImportedAt(importedAt);
  };

  const loadExistingTB = async () => {
    if (!engagementId) return;
    setLoadingExisting(true);
    try {
      // Fix (Issue 2): include txn_debit + txn_credit so all comparison columns are populated
      const { data, count } = await supabase.from("trial_balance_snapshots")
        .select("id, ledger_name, primary_group, bs_pl_side, closing_balance, opening_balance, txn_debit, txn_credit, matched_category_code, financial_year, import_format, account_type", { count: "exact" })
        .eq("engagement_id", engagementId)
        .order("ledger_name");

      const hasData = (count || 0) > 0;
      setExistingImport(hasData);

      if (hasData && data) {
        const leafLedgers = data.filter(d => d.account_type !== "group");
        setExistingTBData({
          totalLedgers: leafLedgers.length,
          bsCount: leafLedgers.filter(d => d.bs_pl_side === "BS").length,
          plCount: leafLedgers.filter(d => d.bs_pl_side === "PL").length,
          financialYear: data[0]?.financial_year || "",
          importFormat: data[0]?.import_format || null,
          ledgers: leafLedgers.slice(0, 200) as any,
        });
      } else {
        setExistingTBData(null);
      }
    } catch {
      setExistingTBData(null);
    }
    setLoadingExisting(false);
  };

  async function loadHierarchy() {
    if (!engagementId) {
      setHierarchyNodes([]);
      return;
    }

    const { data, error } = await supabase
      .from("tb_hierarchy_nodes")
      .select("node_id, parent_node_id, tally_group_name, level, is_leaf, is_bold, indent_value, opening_balance, txn_debit, txn_credit, closing_balance, primary_group, bs_pl_side, normal_balance")
      .eq("engagement_id", engagementId)
      .order("row_number", { ascending: true });

    if (error) {
      setHierarchyNodes([]);
      return;
    }

    const mapped: HierarchyNode[] = (data || []).map((row: any) => ({
      nodeId: row.node_id,
      parentNodeId: row.parent_node_id,
      name: row.tally_group_name,
      level: row.level || 1,
      isLeaf: !!row.is_leaf,
      bold: !!row.is_bold,
      indent: row.indent_value || 0,
      opening: row.opening_balance || 0,
      txnDebit: row.txn_debit || 0,
      txnCredit: row.txn_credit || 0,
      closing: row.closing_balance || 0,
      primaryGroup: row.primary_group || row.tally_group_name,
      bsPlSide: row.bs_pl_side || "Unknown",
      normalBal: row.normal_balance || "Unknown",
    }));

    setHierarchyNodes(mapped);
  }

  const handleDeleteTB = async () => {
    if (!engagementId) return;
    setFormSaving(true);
    try {
      await supabase.from("trial_balance_snapshots").delete().eq("engagement_id", engagementId);
      toast({ title: "Trial Balance removed successfully" });
      setExistingImport(false);
      setExistingTBData(null);
      setShowDeleteConfirm(false);
    } catch (err: any) {
      toast({ title: "Failed to remove", description: err.message, variant: "destructive" });
    }
    setFormSaving(false);
  };

  const [formSaving, setFormSaving] = useState(false);

  // Fix (Issue 2): Delete prior period TB
  const handleDeletePriorTB = async () => {
    if (!engagementId) return;
    setDeletingPriorTb(true);
    try {
      await (supabase as any)
        .from("audit_engagements")
        .update({ prior_year_tb_snapshot: [], prior_year_tb_imported_at: null })
        .eq("id", engagementId);
      setPriorTbLeaves([]);
      setPriorTbImportedAt(null);
      setShowDeletePriorConfirm(false);
      setShowPriorReupload(false);
      toast({ title: "Prior period TB removed" });
    } catch (err: any) {
      toast({ title: "Failed to remove prior TB", description: err.message, variant: "destructive" });
    }
    setDeletingPriorTb(false);
  };

  // Fix (Issue 2): Re-upload prior period TB (standalone, not via reimport dialog)
  const handlePriorFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPriorFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      const arrayBuffer = reader.result as ArrayBuffer;
      const bytes = new Uint8Array(arrayBuffer);
      let binary = "";
      for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
      setPriorFileBase64(btoa(binary));
    };
    reader.readAsArrayBuffer(file);
  };

  const handlePriorUpload = async () => {
    if (!priorFileBase64 || !engagementId) return;
    setParsePrior(true);
    try {
      const [startY, endY] = (fy).split("-");
      const priorFY = `${parseInt(startY) - 1}-${(parseInt(endY) - 1).toString().padStart(2, "0")}`;
      const { data, error: fnError } = await supabase.functions.invoke("parse-tally-tb", {
        body: {
          firmId: firmId || null,
          fileBase64: priorFileBase64,
          fileName: priorFileName,
          financialYear: priorFY,
          isPriorYear: true,
        },
      });
      if (fnError) throw new Error(fnError.message || "Edge function error");
      if (!data?.success) throw new Error(data?.error || "Parse failed");

      const priorLeaves = ((data.hierarchy as any[]) || [])
        .filter((n: any) => n.isLeaf)
        .map((n: any) => ({
          name:         n.name          || "",
          opening:      n.opening       || 0,
          txnDebit:     n.txnDebit      || n.debit   || 0,
          txnCredit:    n.txnCredit     || n.credit  || 0,
          closing:      n.closing       || 0,
          primaryGroup: n.primaryGroup  || n.group   || "",
          bsPlSide:     n.bsPlSide      || n.bs_pl_side || "",
        }));
      await (supabase as any)
        .from("audit_engagements")
        .update({ prior_year_tb_snapshot: priorLeaves, prior_year_tb_imported_at: new Date().toISOString() })
        .eq("id", engagementId);
      await loadPriorTB();
      setShowPriorReupload(false);
      setPriorFileName("");
      setPriorFileBase64("");
      toast({ title: `Prior period TB saved — ${priorLeaves.length} leaf ledgers` });
    } catch (err: any) {
      toast({ title: "Prior year parse failed", description: err.message, variant: "destructive" });
    }
    setParsePrior(false);
  };

  // Fix (Issue 3): Save ledger reclassification to trial_balance_snapshots
  const handleSaveLedgerEdit = async (ledgerId: string) => {
    if (!editGroup && !editBsPlSide) return;
    const updates: any = {};
    if (editGroup) updates.primary_group = editGroup;
    if (editBsPlSide) updates.bs_pl_side = editBsPlSide;
    await supabase.from("trial_balance_snapshots").update(updates).eq("id", ledgerId);
    toast({ title: "Ledger reclassified successfully" });
    setEditingLedger(null);
    setEditGroup("");
    setEditBsPlSide("");
    await loadExistingTB();
  };

  const isValidUuid = clientId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clientId);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (!["xlsx", "xls", "csv", "xml", "json"].includes(ext || "")) {
      toast({ title: "Invalid file type", description: "Please upload .xlsx, .xls, .csv, .xml or .json", variant: "destructive" });
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      toast({ title: "File too large", description: "Max 20MB allowed", variant: "destructive" });
      return;
    }
    setFileName(file.name);
    setImportStats(null);
    setError("");

    const reader = new FileReader();
    reader.onload = () => {
      const arrayBuffer = reader.result as ArrayBuffer;
      const bytes = new Uint8Array(arrayBuffer);
      let binary = "";
      for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
      setFileBase64(btoa(binary));
    };
    reader.readAsArrayBuffer(file);
  };

  const handleParseClick = () => {
    if (!fileBase64 || !engagementId) {
      toast({ title: "Select engagement and upload file first", variant: "destructive" });
      return;
    }
    if (existingImport) {
      setShowReimportDialog(true);
    } else {
      doParse();
    }
  };

  const handleReimportConfirm = (action: "replace" | "prior_year") => {
    setReimportAction(action);
    setShowReimportDialog(false);
    doParse(action);
  };

  const doParse = async (reimport?: "replace" | "prior_year") => {
    setParsing(true);
    setParseProgress("Parsing file structure and detecting format...");
    setError("");
    setImportStats(null);

    try {
      const { data, error: fnError } = await supabase.functions.invoke("parse-tally-tb", {
        body: {
          engagementId,
          firmId: firmId || null,
          fileBase64,
          fileName,
          financialYear: fy,
          reimportAction: reimport || null,
        },
      });

      if (fnError) throw new Error(fnError.message || "Edge function error");
      if (!data?.success) throw new Error(data?.error || "Parse failed");

      setParseProgress("Tagging ledgers with scrutiny categories...");

      // Fix (Issue 2): when "prior_year" action, save leaf nodes to prior_year_tb_snapshot
      // so PipelineStage2 comparative view can rebuild from it on next load.
      if (reimport === "prior_year" && engagementId) {
        const priorLeaves = ((data.hierarchy as any[]) || [])
          .filter((n: any) => n.isLeaf)
          .map((n: any) => ({
            name:         n.name          || "",
            opening:      n.opening       || 0,
            txnDebit:     n.txnDebit      || n.debit   || 0,
            txnCredit:    n.txnCredit     || n.credit  || 0,
            closing:      n.closing       || 0,
            primaryGroup: n.primaryGroup  || n.group   || "",
            bsPlSide:     n.bsPlSide      || n.bs_pl_side || "",
          }));
        await (supabase as any)
          .from("audit_engagements")
          .update({
            prior_year_tb_snapshot: priorLeaves,
            prior_year_tb_imported_at: new Date().toISOString(),
          })
          .eq("id", engagementId);
        await loadPriorTB();
        toast({ title: `Prior period TB saved — ${priorLeaves.length} leaf ledgers stored for comparison` });
      } else {
        setImportStats(data as ImportStats);
        setExistingImport(true);
        toast({ title: `${data.leafLedgers} ledgers imported & tagged successfully` });
      }

      await Promise.all([loadExistingTB(), loadHierarchy()]);
    } catch (err: any) {
      setError(err.message);
      toast({ title: "Parse failed", description: err.message, variant: "destructive" });
    } finally {
      setParsing(false);
    }
  };

  const handleSaveOverrides = async () => {
    setSavingOverrides(true);
    try {
      const entries = Object.entries(unmatchedOverrides).filter(([, v]) => v);
      for (const [id, category] of entries) {
        await supabase.from("trial_balance_snapshots")
          .update({ matched_category_code: category })
          .eq("id", id);
      }
      toast({ title: `${entries.length} ledger categories saved` });
      if (importStats?.tagging) {
        const updated = { ...importStats.tagging };
        updated.unmatched -= entries.length;
        updated.tagged += entries.length;
        for (const [, cat] of entries) {
          updated.categoryBreakdown[cat] = (updated.categoryBreakdown[cat] || 0) + 1;
        }
        updated.unmatchedLedgers = updated.unmatchedLedgers.filter(l => !unmatchedOverrides[l.id]);
        setImportStats({ ...importStats, tagging: updated });
      }
      setUnmatchedOverrides({});
    } catch (err: any) {
      toast({ title: "Save failed", description: err.message, variant: "destructive" });
    } finally {
      setSavingOverrides(false);
    }
  };

  const leafNodes = useMemo(() => hierarchyNodes.filter(n => n.isLeaf), [hierarchyNodes]);
  const rootNodes = useMemo(() => hierarchyNodes.filter(n => !n.parentNodeId), [hierarchyNodes]);
  const tagging = importStats?.tagging;

  const fmtNum = (n: number | null) => Math.abs(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // If no client from context or route, show client selector
  if (!isValidUuid && !contextClientId) {
    return (
      <div className="max-w-lg mx-auto p-8 space-y-6">
        <div>
          <h1 className="text-2xl font-display font-bold text-foreground mb-1">Import Tally Trial Balance</h1>
          <p className="text-muted-foreground text-sm">Select a client to begin importing trial balance data.</p>
        </div>
        <Card>
          <CardContent className="pt-6 space-y-4">
            <Label>Select Client</Label>
            <Select value={selectedClientId} onValueChange={setSelectedClientId}>
              <SelectTrigger><SelectValue placeholder="Choose a client..." /></SelectTrigger>
              <SelectContent>
                {clientsList.map(c => (
                  <SelectItem key={c.id} value={c.id}>{c.name || "Unnamed"}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
          <ArrowLeft size={20} />
        </Button>
        <div>
          <h1 className="text-2xl font-display font-bold text-foreground">Import Tally Trial Balance</h1>
          <p className="text-muted-foreground text-sm">Intelligent parser with hierarchy detection, ledger tagging & scrutiny integration</p>
        </div>
      </div>

      {/* ─── Existing TB Display ─── */}
      {existingImport && existingTBData && !importStats && !fileName && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <CheckCircle2 size={18} className="text-emerald-600" />
                Imported Trial Balance
              </CardTitle>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
                  <RefreshCw size={14} className="mr-1" /> Replace TB
                </Button>
                <Button variant="outline" size="sm" className="text-destructive hover:text-destructive" onClick={() => setShowDeleteConfirm(true)}>
                  <Trash2 size={14} className="mr-1" /> Remove TB
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Summary Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="p-3 bg-muted/50 rounded-lg text-center">
                <p className="text-2xl font-bold text-foreground">{existingTBData.totalLedgers}</p>
                <p className="text-xs text-muted-foreground">Total Ledgers</p>
              </div>
              <div className="p-3 bg-muted/50 rounded-lg text-center">
                <p className="text-2xl font-bold text-foreground">{existingTBData.bsCount}</p>
                <p className="text-xs text-muted-foreground">Balance Sheet</p>
              </div>
              <div className="p-3 bg-muted/50 rounded-lg text-center">
                <p className="text-2xl font-bold text-foreground">{existingTBData.plCount}</p>
                <p className="text-xs text-muted-foreground">Profit & Loss</p>
              </div>
              <div className="p-3 bg-muted/50 rounded-lg text-center">
                <p className="text-sm font-semibold text-foreground">FY {existingTBData.financialYear || "—"}</p>
                <p className="text-xs text-muted-foreground">{existingTBData.importFormat || "Excel"}</p>
              </div>
            </div>

            {/* Fix (Issue 2): Expanded ledger table — all relevant columns now shown.
                Fix (Issue 3): Each row has an Edit button to reclassify primary_group / bs_pl_side. */}
            <div className="border rounded-lg overflow-auto max-h-[400px]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs min-w-[160px]">Ledger Name</TableHead>
                    <TableHead className="text-xs min-w-[110px]">Group</TableHead>
                    <TableHead className="text-xs">BS/PL</TableHead>
                    <TableHead className="text-xs">Category</TableHead>
                    <TableHead className="text-xs text-right min-w-[80px]">Opening Dr</TableHead>
                    <TableHead className="text-xs text-right min-w-[80px]">Opening Cr</TableHead>
                    <TableHead className="text-xs text-right min-w-[80px]">TXN Dr</TableHead>
                    <TableHead className="text-xs text-right min-w-[80px]">TXN Cr</TableHead>
                    <TableHead className="text-xs text-right min-w-[80px]">Closing Dr</TableHead>
                    <TableHead className="text-xs text-right min-w-[80px]">Closing Cr</TableHead>
                    <TableHead className="text-xs w-8"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {existingTBData.ledgers.map(l => {
                    const opn = l.opening_balance ?? 0;
                    const cls = l.closing_balance ?? 0;
                    const isEditing = editingLedger === l.id;
                    return (
                      <TableRow key={l.id} className={isEditing ? "bg-primary/5" : undefined}>
                        <TableCell className="text-xs font-medium">{l.ledger_name || "—"}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {isEditing ? (
                            <input
                              className="w-full border rounded px-1 py-0.5 text-xs"
                              value={editGroup}
                              onChange={e => setEditGroup(e.target.value)}
                              placeholder={l.primary_group || "Group"}
                            />
                          ) : l.primary_group || "—"}
                        </TableCell>
                        <TableCell>
                          {isEditing ? (
                            <select
                              className="border rounded px-1 py-0.5 text-xs"
                              value={editBsPlSide}
                              onChange={e => setEditBsPlSide(e.target.value)}
                            >
                              <option value="">— keep —</option>
                              <option value="BS">BS</option>
                              <option value="PL">PL</option>
                            </select>
                          ) : (
                            <Badge variant="outline" className="text-[10px]">{l.bs_pl_side || "—"}</Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          {l.matched_category_code ? (
                            <Badge variant="secondary" className="text-[10px]">{l.matched_category_code}</Badge>
                          ) : (
                            <span className="text-[10px] text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-xs text-right font-mono">{fmtNum(opn >= 0 ? opn : 0)}</TableCell>
                        <TableCell className="text-xs text-right font-mono">{fmtNum(opn < 0 ? Math.abs(opn) : 0)}</TableCell>
                        <TableCell className="text-xs text-right font-mono text-muted-foreground">{fmtNum(l.txn_debit)}</TableCell>
                        <TableCell className="text-xs text-right font-mono text-muted-foreground">{fmtNum(l.txn_credit)}</TableCell>
                        <TableCell className="text-xs text-right font-mono font-medium">{fmtNum(cls >= 0 ? cls : 0)}</TableCell>
                        <TableCell className="text-xs text-right font-mono font-medium">{fmtNum(cls < 0 ? Math.abs(cls) : 0)}</TableCell>
                        <TableCell className="text-xs">
                          {isEditing ? (
                            <div className="flex gap-1">
                              <button onClick={() => handleSaveLedgerEdit(l.id)} className="text-primary hover:underline text-[10px]">Save</button>
                              <button onClick={() => { setEditingLedger(null); setEditGroup(""); setEditBsPlSide(""); }} className="text-muted-foreground hover:underline text-[10px]">Cancel</button>
                            </div>
                          ) : (
                            <button
                              onClick={() => { setEditingLedger(l.id); setEditGroup(l.primary_group || ""); setEditBsPlSide(l.bs_pl_side || ""); }}
                              className="text-muted-foreground hover:text-primary transition-colors"
                              title="Reclassify ledger"
                            >
                              <FileText size={12} />
                            </button>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
            {existingTBData.totalLedgers > 200 && (
              <p className="text-xs text-muted-foreground text-center">Showing first 200 of {existingTBData.totalLedgers} ledgers</p>
            )}

            {/* Quick Actions */}
            <div className="flex gap-2 pt-2">
              <Button size="sm" onClick={() => navigate("/audit/scrutiny")}>
                <Zap size={14} className="mr-1" /> Run Scrutiny
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ─── Fix (Issue 2): Prior Period TB Section ─── */}
      {engagementId && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <CalendarDays size={14} /> Prior Period Trial Balance
                {priorTbLeaves.length > 0 && (
                  <Badge className="bg-primary/10 text-primary text-[10px] ml-1">
                    {priorTbLeaves.length} accounts loaded
                  </Badge>
                )}
              </CardTitle>
              <div className="flex items-center gap-2">
                {priorTbLeaves.length > 0 && !showPriorReupload && (
                  <>
                    <span className="text-[10px] text-muted-foreground">
                      {priorTbImportedAt ? `Uploaded ${new Date(priorTbImportedAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}` : ""}
                    </span>
                    <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => setShowPriorReupload(true)}>
                      <RefreshCw size={12} /> Re-upload
                    </Button>
                    <Button variant="outline" size="sm" className="h-7 text-xs gap-1 text-destructive border-destructive/30 hover:bg-destructive/5"
                      onClick={() => setShowDeletePriorConfirm(true)} disabled={deletingPriorTb}>
                      {deletingPriorTb ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />} Delete
                    </Button>
                  </>
                )}
                {priorTbLeaves.length === 0 && !showPriorReupload && (
                  <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={() => setShowPriorReupload(true)}>
                    <Upload size={12} /> Upload Prior Year TB
                  </Button>
                )}
              </div>
            </div>
          </CardHeader>

          {/* Upload form */}
          {showPriorReupload && (
            <CardContent className="space-y-3">
              <div className="border-2 border-dashed rounded-lg p-4 text-center cursor-pointer hover:bg-muted/30"
                onClick={() => priorFileRef.current?.click()}>
                <Upload size={18} className="mx-auto mb-1 text-muted-foreground" />
                <p className="text-xs text-muted-foreground">{priorFileName || "Upload Prior Year TB (Excel, CSV, XML, JSON)"}</p>
                <input ref={priorFileRef} type="file" className="hidden" accept=".xlsx,.xls,.csv,.xml,.json"
                  onChange={handlePriorFileSelect} />
              </div>
              {priorFileName && (
                <Button size="sm" className="w-full gap-1" onClick={handlePriorUpload} disabled={parsePrior || !priorFileBase64}>
                  {parsePrior ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                  Import as Prior Year TB
                </Button>
              )}
              <Button variant="ghost" size="sm" className="w-full text-xs"
                onClick={() => { setShowPriorReupload(false); setPriorFileName(""); setPriorFileBase64(""); }}>
                Cancel
              </Button>
            </CardContent>
          )}

          {/* Prior year ledger table */}
          {priorTbLeaves.length > 0 && !showPriorReupload && (
            <CardContent className="pt-0">
              <div className="border rounded-lg overflow-auto max-h-64">
                <table className="w-full text-xs min-w-[900px]">
                  <thead className="bg-muted sticky top-0">
                    <tr>
                      <th className="text-left p-2 min-w-[160px]">Account Name</th>
                      <th className="text-left p-2 min-w-[110px]">Group</th>
                      <th className="text-center p-2">BS/PL</th>
                      <th className="text-right p-2 min-w-[80px]">Opening Dr</th>
                      <th className="text-right p-2 min-w-[80px]">Opening Cr</th>
                      <th className="text-right p-2 min-w-[80px]">TXN Dr</th>
                      <th className="text-right p-2 min-w-[80px]">TXN Cr</th>
                      <th className="text-right p-2 min-w-[80px]">Closing Dr</th>
                      <th className="text-right p-2 min-w-[80px]">Closing Cr</th>
                    </tr>
                  </thead>
                  <tbody>
                    {priorTbLeaves.slice(0, 200).map((leaf: any, i: number) => {
                      const opn = leaf.opening || 0;
                      const cls = leaf.closing || 0;
                      return (
                        <tr key={i} className="border-t hover:bg-muted/30">
                          <td className="p-2 font-medium">{leaf.name || "—"}</td>
                          <td className="p-2 text-muted-foreground">{leaf.primaryGroup || "—"}</td>
                          <td className="p-2 text-center">
                            <Badge variant="outline" className="text-[10px]">{leaf.bsPlSide || "—"}</Badge>
                          </td>
                          <td className="p-2 text-right font-mono">{fmtNum(opn >= 0 ? opn : 0)}</td>
                          <td className="p-2 text-right font-mono">{fmtNum(opn < 0 ? Math.abs(opn) : 0)}</td>
                          <td className="p-2 text-right font-mono text-muted-foreground">{fmtNum(leaf.txnDebit || 0)}</td>
                          <td className="p-2 text-right font-mono text-muted-foreground">{fmtNum(leaf.txnCredit || 0)}</td>
                          <td className="p-2 text-right font-mono font-medium">{fmtNum(cls >= 0 ? cls : 0)}</td>
                          <td className="p-2 text-right font-mono font-medium">{fmtNum(cls < 0 ? Math.abs(cls) : 0)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {priorTbLeaves.length > 200 && (
                <p className="text-[11px] text-muted-foreground text-center mt-2">Showing first 200 of {priorTbLeaves.length} accounts</p>
              )}
            </CardContent>
          )}

          {priorTbLeaves.length === 0 && !showPriorReupload && (
            <CardContent className="pt-0 pb-4">
              <p className="text-xs text-muted-foreground text-center py-4">No prior period TB uploaded yet. Click "Upload Prior Year TB" to add one.</p>
            </CardContent>
          )}
        </Card>
      )}

      {/* Upload area - show when no existing TB or user wants to replace */}
      {(!existingImport || fileName || !existingTBData) && (
        <Card>
          <CardContent className="pt-6 space-y-4">
            {existingImport && !fileName && !existingTBData && (
              <Alert>
                <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                <AlertTitle className="text-sm">Trial Balance Already Imported</AlertTitle>
                <AlertDescription className="text-xs">
                  A trial balance has been imported for this engagement. Upload a new file to replace it.
                </AlertDescription>
              </Alert>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Financial Year</Label>
                <Select value={fy} onValueChange={setFy}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {FY_OPTIONS.map(f => <SelectItem key={f} value={f}>{f}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Upload Tally Trial Balance</Label>
                <div
                  className="border-2 border-dashed rounded-lg p-4 text-center cursor-pointer hover:border-primary/50 transition-colors"
                  onClick={() => fileRef.current?.click()}
                >
                  <Upload className="h-6 w-6 mx-auto text-muted-foreground mb-1" />
                  <p className="text-xs font-medium text-foreground">{fileName || "Click to upload .xlsx, .xls, .csv, .xml, .json"}</p>
                  <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv,.xml,.json" className="hidden" onChange={handleFileSelect} />
                </div>
              </div>
            </div>

            {/* Hidden engagement selector - auto-bind from context */}
            {!contextEngagementId && engagements.length > 0 && (
              <div className="space-y-2">
                <Label>Engagement</Label>
                <Select value={engagementId} onValueChange={setEngagementId}>
                  <SelectTrigger><SelectValue placeholder="Select engagement" /></SelectTrigger>
                  <SelectContent>
                    {engagements.map(e => (
                      <SelectItem key={e.id} value={e.id}>FY {e.financial_year || "—"}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {!contextEngagementId && engagements.length === 0 && (
              <p className="text-xs text-destructive">No engagements found. Create one first in Audit Pipeline.</p>
            )}

            {existingImport && fileName && !importStats && (
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertTitle className="text-sm">Existing Import Detected</AlertTitle>
                <AlertDescription className="text-xs">
                  A TB has already been imported for this engagement. You can replace it or add as prior year comparison.
                </AlertDescription>
              </Alert>
            )}

            {fileName && !importStats && (
              <Button onClick={handleParseClick} disabled={parsing || !engagementId} className="w-full">
                {parsing ? (
                  <><Loader2 size={16} className="mr-2 animate-spin" /> {parseProgress}</>
                ) : (
                  <><FileSpreadsheet size={16} className="mr-2" /> Parse, Import & Tag Trial Balance</>
                )}
              </Button>
            )}

            {fileName?.toLowerCase().endsWith(".csv") && (
              <Alert>
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle className="text-sm">CSV Format Detected</AlertTitle>
                <AlertDescription className="text-xs">
                  CSV format does not contain hierarchy/indent information. All accounts will be imported as flat ledgers.
                  For full hierarchy, export as Excel from Tally (Reports → Trial Balance → Export).
                </AlertDescription>
              </Alert>
            )}

            {fileName?.toLowerCase().endsWith(".xml") && (
              <Alert>
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                <AlertTitle className="text-sm">Tally XML Format Detected</AlertTitle>
                <AlertDescription className="text-xs">
                  Tally XML export detected (UTF-16LE). Hierarchy will be reconstructed automatically via value-sum matching — same accuracy as Excel import. Export via: Tally → Display → Trial Balance → Export → XML.
                </AlertDescription>
              </Alert>
            )}

            {fileName?.toLowerCase().endsWith(".json") && (
              <Alert>
                <CheckCircle2 className="h-4 w-4 text-blue-600" />
                <AlertTitle className="text-sm">JSON Format Detected</AlertTitle>
                <AlertDescription className="text-xs">
                  Supports flat array <code>[&#123;"name","opening","debit","credit","closing"&#125;]</code> or CAFlow hierarchy export format.
                </AlertDescription>
              </Alert>
            )}

            {error && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle className="text-sm">Parse Error</AlertTitle>
                <AlertDescription className="text-xs">{error}</AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>
      )}

      {/* Results */}
      {importStats && (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <Card><CardContent className="p-4 text-center"><p className="text-2xl font-bold text-foreground">{importStats.leafLedgers}</p><p className="text-xs text-muted-foreground">Leaf Ledgers</p></CardContent></Card>
            <Card><CardContent className="p-4 text-center"><p className="text-2xl font-bold text-foreground">{importStats.primaryGroups}</p><p className="text-xs text-muted-foreground">Primary Groups</p></CardContent></Card>
            <Card><CardContent className="p-4 text-center"><p className="text-2xl font-bold text-foreground">{importStats.bsAccounts}</p><p className="text-xs text-muted-foreground">Balance Sheet</p></CardContent></Card>
            <Card><CardContent className="p-4 text-center"><p className="text-2xl font-bold text-foreground">{importStats.plAccounts}</p><p className="text-xs text-muted-foreground">Profit & Loss</p></CardContent></Card>
            <Card><CardContent className="p-4 text-center"><p className={`text-2xl font-bold ${importStats.isBalanced ? "text-emerald-600" : "text-destructive"}`}>{importStats.isBalanced ? "YES" : "NO"}</p><p className="text-xs text-muted-foreground">TB Balanced</p></CardContent></Card>
          </div>

          {!importStats.isBalanced ? (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle className="text-sm">Trial Balance is NOT Balanced</AlertTitle>
              <AlertDescription className="text-xs">
                Dr total (₹{importStats.totalDr.toLocaleString("en-IN")}) ≠ Cr total (₹{importStats.totalCr.toLocaleString("en-IN")}).
              </AlertDescription>
            </Alert>
          ) : (
            <Alert>
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              <AlertTitle className="text-sm text-emerald-600">Trial Balance Verified ✓</AlertTitle>
              <AlertDescription className="text-xs text-emerald-600">
                Dr: ₹{importStats.totalDr.toLocaleString("en-IN")} = Cr: ₹{importStats.totalCr.toLocaleString("en-IN")} | Format: {importStats.detectedFormat}
              </AlertDescription>
            </Alert>
          )}

          {tagging && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-lg flex items-center gap-2"><Tag size={18} /> Ledger Matching Results</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex gap-4 text-sm">
                  <div className="flex items-center gap-2"><CheckCircle2 size={16} className="text-emerald-600" /><span className="font-medium">{tagging.tagged}</span><span className="text-muted-foreground">matched</span></div>
                  {tagging.unmatched > 0 && <div className="flex items-center gap-2"><AlertTriangle size={16} className="text-amber-500" /><span className="font-medium text-amber-600">{tagging.unmatched}</span><span className="text-muted-foreground">unmatched</span></div>}
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  {Object.entries(tagging.categoryBreakdown).sort(([, a], [, b]) => b - a).map(([cat, count]) => (
                    <div key={cat} className="flex items-center justify-between p-2 bg-muted/50 rounded text-xs">
                      <span className="font-medium">{CATEGORY_LABELS[cat] || cat}</span>
                      <Badge variant="secondary" className="text-[10px] h-5">{count}</Badge>
                    </div>
                  ))}
                </div>

                {tagging.unmatchedLedgers.length > 0 && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium text-amber-600 flex items-center gap-1"><AlertTriangle size={14} /> Unmatched Ledgers — Assign Category Manually</p>
                      {Object.values(unmatchedOverrides).some(v => v) && (
                        <Button size="sm" onClick={handleSaveOverrides} disabled={savingOverrides}>
                          {savingOverrides ? <Loader2 size={14} className="animate-spin mr-1" /> : null}Save Overrides
                        </Button>
                      )}
                    </div>
                    <div className="border rounded-lg overflow-auto max-h-[250px]">
                      <Table>
                        <TableHeader><TableRow><TableHead className="text-xs">Ledger Name</TableHead><TableHead className="text-xs w-48">Assign Category</TableHead></TableRow></TableHeader>
                        <TableBody>
                          {tagging.unmatchedLedgers.map(l => (
                            <TableRow key={l.id}>
                              <TableCell className="text-xs">{l.name}</TableCell>
                              <TableCell>
                                <Select value={unmatchedOverrides[l.id] || ""} onValueChange={v => setUnmatchedOverrides(prev => ({ ...prev, [l.id]: v }))}>
                                  <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="Select..." /></SelectTrigger>
                                  <SelectContent>{Object.entries(CATEGORY_LABELS).map(([code, label]) => (<SelectItem key={code} value={code} className="text-xs">{code} — {label}</SelectItem>))}</SelectContent>
                                </Select>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                )}

                <Button className="w-full" variant="default" onClick={() => navigate("/audit/scrutiny")}>
                  <Zap size={16} className="mr-2" /> Run Full Scrutiny Now →
                </Button>
              </CardContent>
            </Card>
          )}

          {/* Hierarchy Tree / Flat View */}
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg flex items-center gap-2"><FolderTree size={18} /> Hierarchy Tree</CardTitle>
                <div className="flex gap-1">
                  <Button variant={viewMode === "tree" ? "default" : "outline"} size="sm" className="text-xs h-7 gap-1" onClick={() => setViewMode("tree")}><FolderTree size={12} /> Tree</Button>
                  <Button variant={viewMode === "flat" ? "default" : "outline"} size="sm" className="text-xs h-7 gap-1" onClick={() => setViewMode("flat")}><Layers size={12} /> Flat</Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {viewMode === "tree" ? (
                <div className="border rounded-lg overflow-auto max-h-[500px]">
                  <div className="flex items-center gap-2 py-2 px-2 bg-muted/50 text-[10px] font-semibold text-muted-foreground uppercase sticky top-0 z-10 border-b">
                    <div className="w-4" /><span className="flex-1">Account / Group</span>
                    <span className="w-24 text-right">Opening DR</span><span className="w-24 text-right">Opening CR</span>
                    <span className="w-24 text-right">TXN DR</span><span className="w-24 text-right">TXN CR</span>
                    <span className="w-24 text-right">Closing DR</span><span className="w-24 text-right">Closing CR</span>
                  </div>
                  {rootNodes.length > 0 ? rootNodes.map(node => <TreeNode key={node.nodeId} node={node} allNodes={hierarchyNodes} />) : (
                    <div className="p-4 text-xs text-muted-foreground">No hierarchy nodes available for this import.</div>
                  )}
                </div>
              ) : (
                <div className="border rounded-lg overflow-auto max-h-[500px]">
                  <Table>
                    <TableHeader><TableRow>
                      <TableHead className="text-xs">Ledger Name</TableHead><TableHead className="text-xs">Primary Group</TableHead>
                      <TableHead className="text-xs">BS/PL</TableHead><TableHead className="text-xs">Dr/Cr</TableHead>
                      <TableHead className="text-xs text-right">Opening DR</TableHead><TableHead className="text-xs text-right">Opening CR</TableHead>
                      <TableHead className="text-xs text-right">TXN DR</TableHead><TableHead className="text-xs text-right">TXN CR</TableHead>
                      <TableHead className="text-xs text-right">Closing DR</TableHead><TableHead className="text-xs text-right">Closing CR</TableHead>
                    </TableRow></TableHeader>
                    <TableBody>
                      {leafNodes.map(n => {
                        const opening = n.opening >= 0 ? { dr: n.opening || 0, cr: 0 } : { dr: 0, cr: Math.abs(n.opening || 0) };
                        const closing = n.closing >= 0 ? { dr: n.closing || 0, cr: 0 } : { dr: 0, cr: Math.abs(n.closing || 0) };
                        return (
                          <TableRow key={n.nodeId}>
                            <TableCell className="text-xs">{n.name}</TableCell>
                            <TableCell className="text-xs text-muted-foreground">{n.primaryGroup}</TableCell>
                            <TableCell><Badge variant="outline" className="text-[10px]">{n.bsPlSide}</Badge></TableCell>
                            <TableCell><Badge variant="outline" className="text-[10px]">{n.normalBal}</Badge></TableCell>
                            <TableCell className="text-xs text-right font-mono">{fmtNum(opening.dr)}</TableCell>
                            <TableCell className="text-xs text-right font-mono">{fmtNum(opening.cr)}</TableCell>
                            <TableCell className="text-xs text-right font-mono">{fmtNum(n.txnDebit || 0)}</TableCell>
                            <TableCell className="text-xs text-right font-mono">{fmtNum(n.txnCredit || 0)}</TableCell>
                            <TableCell className="text-xs text-right font-mono font-medium">{fmtNum(closing.dr)}</TableCell>
                            <TableCell className="text-xs text-right font-mono font-medium">{fmtNum(closing.cr)}</TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          <div className="flex justify-center gap-3">
            <Button variant="outline" onClick={() => { setImportStats(null); setFileName(""); setFileBase64(""); }}>Upload Another File</Button>
            <Button onClick={() => navigate(-1)}>Back to Engagement</Button>
          </div>
        </>
      )}

      {/* Re-import Dialog */}
      <Dialog open={showReimportDialog} onOpenChange={setShowReimportDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Existing Import Found</DialogTitle>
            <DialogDescription>A Trial Balance has already been imported for this engagement. What would you like to do?</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-4">
            <Button variant="outline" className="w-full justify-start h-auto py-3" onClick={() => handleReimportConfirm("replace")}>
              <div className="text-left"><p className="font-medium">Replace Existing</p><p className="text-xs text-muted-foreground">Delete current TB data and import fresh.</p></div>
            </Button>
            <Button variant="outline" className="w-full justify-start h-auto py-3" onClick={() => handleReimportConfirm("prior_year")}>
              <div className="text-left"><p className="font-medium">Add as Prior Year Comparison</p><p className="text-xs text-muted-foreground">Keep existing as current year, import this as prior year.</p></div>
            </Button>
          </div>
          <DialogFooter><Button variant="ghost" onClick={() => setShowReimportDialog(false)}>Cancel</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Fix (Issue 2): Delete Prior Period TB Confirmation Dialog */}
      <Dialog open={showDeletePriorConfirm} onOpenChange={setShowDeletePriorConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove Prior Period Trial Balance?</DialogTitle>
            <DialogDescription>This will permanently delete the prior period TB data stored for comparison. The current year TB is unaffected.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeletePriorConfirm(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDeletePriorTB} disabled={deletingPriorTb}>
              {deletingPriorTb && <Loader2 size={16} className="mr-2 animate-spin" />} Remove Prior TB
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove Trial Balance?</DialogTitle>
            <DialogDescription>This will permanently delete the imported trial balance data for this engagement. Scrutiny findings linked to this data may also be affected.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeleteConfirm(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDeleteTB} disabled={formSaving}>
              {formSaving && <Loader2 size={16} className="mr-2 animate-spin" />} Remove Trial Balance
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Hidden file input for replace */}
      {existingImport && existingTBData && !fileName && (
        <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleFileSelect} />
      )}
    </div>
  );
}
