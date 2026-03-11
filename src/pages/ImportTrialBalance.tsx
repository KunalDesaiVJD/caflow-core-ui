import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
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
  ArrowLeft, Upload, CheckCircle2, AlertTriangle, FileSpreadsheet, Loader2,
  ChevronRight, ChevronDown, FolderTree, Layers,
} from "lucide-react";
import * as XLSX from "xlsx";

const FY_OPTIONS = ["2024-25", "2023-24", "2022-23", "2021-22"];

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
}

// ─── Hierarchy Tree Component ───
function TreeNode({ node, allNodes }: { node: HierarchyNode; allNodes: HierarchyNode[] }) {
  const [open, setOpen] = useState(node.level <= 2);
  const children = allNodes.filter(n => n.parentNodeId === node.nodeId);
  const hasChildren = children.length > 0;
  const fmtNum = (n: number) => n ? n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—";

  if (node.isLeaf) {
    return (
      <div className="flex items-center gap-2 py-1 px-2 hover:bg-muted/50 rounded text-xs" style={{ paddingLeft: `${(node.level - 1) * 20 + 12}px` }}>
        <div className="w-4" />
        <span className="flex-1 text-foreground">{node.name}</span>
        <span className="w-24 text-right font-mono text-muted-foreground">{fmtNum(node.opening)}</span>
        <span className="w-24 text-right font-mono text-muted-foreground">{fmtNum(node.txnDebit)}</span>
        <span className="w-24 text-right font-mono text-muted-foreground">{fmtNum(node.txnCredit)}</span>
        <span className="w-24 text-right font-mono font-medium text-foreground">{fmtNum(node.closing)}</span>
      </div>
    );
  }

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <div
          className="flex items-center gap-2 py-1.5 px-2 hover:bg-muted/30 rounded cursor-pointer text-xs"
          style={{ paddingLeft: `${(node.level - 1) * 20 + 12}px` }}
        >
          {hasChildren ? (
            open ? <ChevronDown size={14} className="text-muted-foreground shrink-0" /> : <ChevronRight size={14} className="text-muted-foreground shrink-0" />
          ) : <div className="w-[14px]" />}
          <span className="flex-1 font-semibold text-muted-foreground">{node.name}</span>
          <Badge variant="outline" className="text-[10px] h-4">{node.bsPlSide}</Badge>
          <span className="w-24 text-right font-mono text-muted-foreground">{fmtNum(node.opening)}</span>
          <span className="w-24 text-right font-mono text-muted-foreground">{fmtNum(node.txnDebit)}</span>
          <span className="w-24 text-right font-mono text-muted-foreground">{fmtNum(node.txnCredit)}</span>
          <span className="w-24 text-right font-mono text-muted-foreground">{fmtNum(node.closing)}</span>
        </div>
      </CollapsibleTrigger>
      <CollapsibleContent>
        {children.map(child => (
          <TreeNode key={child.nodeId} node={child} allNodes={allNodes} />
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
}

export default function ImportTrialBalance() {
  const { clientId: routeClientId } = useParams<{ clientId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();
  const [selectedClientId, setSelectedClientId] = useState("");
  const [clientsList, setClientsList] = useState<{ id: string; name: string | null }[]>([]);
  const [engagementId, setEngagementId] = useState("");
  const [engagements, setEngagements] = useState<{ id: string; financial_year: string | null; client_id: string | null }[]>([]);

  const clientId = routeClientId || selectedClientId;
  const fileRef = useRef<HTMLInputElement>(null);
  const firmId = user?.firm_id;
  const isSuperadmin = user?.role === "superadmin";

  // States
  const [fy, setFy] = useState("2024-25");
  const [fileName, setFileName] = useState("");
  const [fileBase64, setFileBase64] = useState("");
  const [parsing, setParsing] = useState(false);
  const [parseProgress, setParseProgress] = useState("");
  const [importStats, setImportStats] = useState<ImportStats | null>(null);
  const [viewMode, setViewMode] = useState<"tree" | "flat">("tree");
  const [error, setError] = useState("");

  // Load clients
  useEffect(() => {
    if (routeClientId) return;
    const load = async () => {
      let q = supabase.from("clients").select("id, name").order("name");
      if (firmId) q = q.eq("firm_id", firmId);
      const { data } = await q;
      setClientsList(data || []);
    };
    load();
  }, [firmId, routeClientId]);

  // Load engagements for selected client
  useEffect(() => {
    if (!clientId) return;
    const load = async () => {
      const { data } = await supabase
        .from("audit_engagements")
        .select("id, financial_year, client_id")
        .eq("client_id", clientId)
        .order("financial_year", { ascending: false });
      setEngagements(data || []);
      if (data && data.length > 0) setEngagementId(data[0].id);
    };
    load();
  }, [clientId]);

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

  const handleParse = async () => {
    if (!fileBase64 || !engagementId) {
      toast({ title: "Select engagement and upload file first", variant: "destructive" });
      return;
    }
    setParsing(true);
    setParseProgress("Uploading file to parser...");
    setError("");
    setImportStats(null);

    try {
      setParseProgress("Parsing file structure and detecting format...");

      const { data, error: fnError } = await supabase.functions.invoke("parse-tally-tb", {
        body: {
          engagementId,
          firmId: firmId || null,
          fileBase64,
          fileName,
          financialYear: fy,
        },
      });

      if (fnError) throw new Error(fnError.message || "Edge function error");
      if (!data?.success) throw new Error(data?.error || "Parse failed");

      setParseProgress(`Detected ${data.totalNodes} rows, ${data.leafLedgers} leaf ledgers`);
      setImportStats(data as ImportStats);
      toast({ title: `${data.leafLedgers} ledgers imported successfully` });
    } catch (err: any) {
      setError(err.message);
      toast({ title: "Parse failed", description: err.message, variant: "destructive" });
    } finally {
      setParsing(false);
    }
  };

  // Flat leaf view
  const leafNodes = useMemo(() => {
    if (!importStats?.hierarchy) return [];
    return importStats.hierarchy.filter(n => n.isLeaf);
  }, [importStats]);

  // Root nodes for tree
  const rootNodes = useMemo(() => {
    if (!importStats?.hierarchy) return [];
    return importStats.hierarchy.filter(n => !n.parentNodeId);
  }, [importStats]);

  // Client selector
  if (!isValidUuid) {
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
          <p className="text-muted-foreground text-sm">Intelligent parser with hierarchy detection for all Tally export formats</p>
        </div>
      </div>

      {/* Setup Row */}
      <Card>
        <CardContent className="pt-6 space-y-4">
          <div className="grid grid-cols-3 gap-4">
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
              <Label>Engagement</Label>
              <Select value={engagementId} onValueChange={setEngagementId}>
                <SelectTrigger><SelectValue placeholder="Select engagement" /></SelectTrigger>
                <SelectContent>
                  {engagements.map(e => (
                    <SelectItem key={e.id} value={e.id}>FY {e.financial_year || "—"}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {engagements.length === 0 && (
                <p className="text-xs text-destructive">No engagements found. Create one first in Audit Pipeline.</p>
              )}
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

          {fileName && !importStats && (
            <Button onClick={handleParse} disabled={parsing || !engagementId} className="w-full">
              {parsing ? (
                <><Loader2 size={16} className="mr-2 animate-spin" /> {parseProgress}</>
              ) : (
                <><FileSpreadsheet size={16} className="mr-2" /> Parse & Import Trial Balance</>
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

      {/* Results */}
      {importStats && (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <Card>
              <CardContent className="p-4 text-center">
                <p className="text-2xl font-bold text-foreground">{importStats.leafLedgers}</p>
                <p className="text-xs text-muted-foreground">Leaf Ledgers</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <p className="text-2xl font-bold text-foreground">{importStats.primaryGroups}</p>
                <p className="text-xs text-muted-foreground">Primary Groups</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <p className="text-2xl font-bold text-foreground">{importStats.bsAccounts}</p>
                <p className="text-xs text-muted-foreground">Balance Sheet</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <p className="text-2xl font-bold text-foreground">{importStats.plAccounts}</p>
                <p className="text-xs text-muted-foreground">Profit & Loss</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <p className={`text-2xl font-bold ${importStats.isBalanced ? "text-emerald-600" : "text-destructive"}`}>
                  {importStats.isBalanced ? "YES" : "NO"}
                </p>
                <p className="text-xs text-muted-foreground">TB Balanced</p>
              </CardContent>
            </Card>
          </div>

          {/* Balance warning */}
          {!importStats.isBalanced && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle className="text-sm">Trial Balance is NOT Balanced</AlertTitle>
              <AlertDescription className="text-xs">
                Dr total (₹{importStats.totalDr.toLocaleString("en-IN")}) ≠ Cr total (₹{importStats.totalCr.toLocaleString("en-IN")}).
                Check your Tally export settings. Scrutiny will run but results may be unreliable.
              </AlertDescription>
            </Alert>
          )}

          {importStats.isBalanced && (
            <Alert>
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              <AlertTitle className="text-sm text-emerald-600">Trial Balance Verified ✓</AlertTitle>
              <AlertDescription className="text-xs text-emerald-600">
                Dr: ₹{importStats.totalDr.toLocaleString("en-IN")} = Cr: ₹{importStats.totalCr.toLocaleString("en-IN")} | Format: {importStats.detectedFormat}
              </AlertDescription>
            </Alert>
          )}

          {/* Hierarchy Tree / Flat View */}
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg flex items-center gap-2">
                  <FolderTree size={18} /> Hierarchy Tree
                </CardTitle>
                <div className="flex gap-1">
                  <Button
                    variant={viewMode === "tree" ? "default" : "outline"}
                    size="sm" className="text-xs h-7 gap-1"
                    onClick={() => setViewMode("tree")}
                  >
                    <FolderTree size={12} /> Tree
                  </Button>
                  <Button
                    variant={viewMode === "flat" ? "default" : "outline"}
                    size="sm" className="text-xs h-7 gap-1"
                    onClick={() => setViewMode("flat")}
                  >
                    <Layers size={12} /> Flat
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {viewMode === "tree" ? (
                <div className="border rounded-lg overflow-auto max-h-[500px]">
                  {/* Tree header */}
                  <div className="flex items-center gap-2 py-2 px-2 bg-muted/50 text-[10px] font-semibold text-muted-foreground uppercase sticky top-0 z-10 border-b">
                    <div className="w-4" />
                    <span className="flex-1">Account / Group</span>
                    <span className="w-24 text-right">Opening</span>
                    <span className="w-24 text-right">Txn Dr</span>
                    <span className="w-24 text-right">Txn Cr</span>
                    <span className="w-24 text-right">Closing</span>
                  </div>
                  {rootNodes.map(node => (
                    <TreeNode key={node.nodeId} node={node} allNodes={importStats.hierarchy} />
                  ))}
                </div>
              ) : (
                <div className="border rounded-lg overflow-auto max-h-[500px]">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs">Ledger Name</TableHead>
                        <TableHead className="text-xs">Primary Group</TableHead>
                        <TableHead className="text-xs">BS/PL</TableHead>
                        <TableHead className="text-xs">Dr/Cr</TableHead>
                        <TableHead className="text-xs text-right">Opening</TableHead>
                        <TableHead className="text-xs text-right">Txn Dr</TableHead>
                        <TableHead className="text-xs text-right">Txn Cr</TableHead>
                        <TableHead className="text-xs text-right">Closing</TableHead>
                      </TableRow>
                    </TableHeader>
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

          {/* Actions */}
          <div className="flex justify-center gap-3">
            <Button variant="outline" onClick={() => { setImportStats(null); setFileName(""); setFileBase64(""); }}>
              Upload Another File
            </Button>
            <Button onClick={() => navigate(-1)}>
              Back to Engagement
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
