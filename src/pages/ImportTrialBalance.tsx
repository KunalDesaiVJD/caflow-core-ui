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
  ledgers: { id: string; ledger_name: string | null; primary_group: string | null; bs_pl_side: string | null; closing_balance: number | null; opening_balance: number | null; matched_category_code: string | null }[];
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

  const [unmatchedOverrides, setUnmatchedOverrides] = useState<Record<string, string>>({});
  const [savingOverrides, setSavingOverrides] = useState(false);

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
      let q = supabase.from("clients").select("id, name").order("name");
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

  // Check for existing import + hierarchy when engagement changes
  useEffect(() => {
    if (!engagementId) return;
    void Promise.all([loadExistingTB(), loadHierarchy()]);
  }, [engagementId]);

  const loadExistingTB = async () => {
    if (!engagementId) return;
    setLoadingExisting(true);
    try {
      const { data, count } = await supabase.from("trial_balance_snapshots")
        .select("id, ledger_name, primary_group, bs_pl_side, closing_balance, opening_balance, matched_category_code, financial_year, import_format, account_type", { count: "exact" })
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

  const isValidUuid = clientId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clientId);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (!["xlsx", "xls", "csv"].includes(ext || "")) {
      toast({ title: "Invalid file type", description: "Please upload .xlsx, .xls or .csv", variant: "destructive" });
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
      setImportStats(data as ImportStats);
      setExistingImport(true);
      toast({ title: `${data.leafLedgers} ledgers imported & tagged successfully` });
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

  const fmtNum = (n: number | null) => n ? n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—";

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

            {/* Ledger Table */}
            <div className="border rounded-lg overflow-auto max-h-[400px]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Ledger Name</TableHead>
                    <TableHead className="text-xs">Group</TableHead>
                    <TableHead className="text-xs">BS/PL</TableHead>
                    <TableHead className="text-xs">Category</TableHead>
                    <TableHead className="text-xs text-right">Opening</TableHead>
                    <TableHead className="text-xs text-right">Closing</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {existingTBData.ledgers.map(l => (
                    <TableRow key={l.id}>
                      <TableCell className="text-xs">{l.ledger_name || "—"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{l.primary_group || "—"}</TableCell>
                      <TableCell><Badge variant="outline" className="text-[10px]">{l.bs_pl_side || "—"}</Badge></TableCell>
                      <TableCell>
                        {l.matched_category_code ? (
                          <Badge variant="secondary" className="text-[10px]">{l.matched_category_code}</Badge>
                        ) : (
                          <span className="text-[10px] text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-right font-mono">{fmtNum(l.opening_balance)}</TableCell>
                      <TableCell className="text-xs text-right font-mono font-medium">{fmtNum(l.closing_balance)}</TableCell>
                    </TableRow>
                  ))}
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
              <Button size="sm" variant="outline" onClick={() => navigate("/settings/coa-mappings")}>
                <Layers size={14} className="mr-1" /> COA Mapping
              </Button>
            </div>
          </CardContent>
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
                  <p className="text-xs font-medium text-foreground">{fileName || "Click to upload .xlsx, .xls, .csv"}</p>
                  <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleFileSelect} />
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
                    <span className="w-24 text-right">Opening</span><span className="w-24 text-right">Txn Dr</span><span className="w-24 text-right">Txn Cr</span><span className="w-24 text-right">Closing</span>
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
                      <TableHead className="text-xs text-right">Opening</TableHead><TableHead className="text-xs text-right">Txn Dr</TableHead>
                      <TableHead className="text-xs text-right">Txn Cr</TableHead><TableHead className="text-xs text-right">Closing</TableHead>
                    </TableRow></TableHeader>
                    <TableBody>
                      {leafNodes.map(n => (
                        <TableRow key={n.nodeId}>
                          <TableCell className="text-xs">{n.name}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">{n.primaryGroup}</TableCell>
                          <TableCell><Badge variant="outline" className="text-[10px]">{n.bsPlSide}</Badge></TableCell>
                          <TableCell><Badge variant="outline" className="text-[10px]">{n.normalBal}</Badge></TableCell>
                          <TableCell className="text-xs text-right font-mono">{n.opening ? n.opening.toLocaleString("en-IN") : "—"}</TableCell>
                          <TableCell className="text-xs text-right font-mono">{n.txnDebit ? n.txnDebit.toLocaleString("en-IN") : "—"}</TableCell>
                          <TableCell className="text-xs text-right font-mono">{n.txnCredit ? n.txnCredit.toLocaleString("en-IN") : "—"}</TableCell>
                          <TableCell className="text-xs text-right font-mono font-medium">{n.closing ? n.closing.toLocaleString("en-IN") : "—"}</TableCell>
                        </TableRow>
                      ))}
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
