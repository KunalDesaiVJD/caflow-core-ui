import { useState, useEffect, useRef, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { ArrowLeft, Check, X, Loader2, Download, Upload, Pencil, Trash2, ChevronRight, ChevronDown, FolderTree, AlertTriangle } from "lucide-react";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import * as XLSX from "xlsx";

const ACCOUNT_GROUPS = [
  "Non-Current Assets", "Current Assets", "Long-Term Borrowings", "Short-Term Borrowings",
  "Trade Payables", "Other Current Liabilities", "Equity Share Capital", "Retained Earnings",
  "Revenue", "Cost of Goods Sold", "Employee Benefit Expenses", "Finance Costs",
  "Depreciation", "Other Expenses", "Other Income",
];

const FUZZY_MAP: Record<string, { standard_head: string; account_group: string; bs_pl: string }> = {
  "sundry debtors": { standard_head: "Trade Receivables", account_group: "Current Assets", bs_pl: "BS" },
  "sundry creditors": { standard_head: "Trade Payables", account_group: "Trade Payables", bs_pl: "BS" },
  "trade debtors": { standard_head: "Trade Receivables", account_group: "Current Assets", bs_pl: "BS" },
  "trade creditors": { standard_head: "Trade Payables", account_group: "Trade Payables", bs_pl: "BS" },
  "loans and advances": { standard_head: "Short-Term Loans and Advances", account_group: "Current Assets", bs_pl: "BS" },
  "capital account": { standard_head: "Equity Share Capital", account_group: "Equity Share Capital", bs_pl: "BS" },
  "profit & loss a/c": { standard_head: "Retained Earnings", account_group: "Retained Earnings", bs_pl: "BS" },
  "profit and loss": { standard_head: "Retained Earnings", account_group: "Retained Earnings", bs_pl: "BS" },
  "cash": { standard_head: "Cash and Cash Equivalents", account_group: "Current Assets", bs_pl: "BS" },
  "cash in hand": { standard_head: "Cash and Cash Equivalents", account_group: "Current Assets", bs_pl: "BS" },
  "bank": { standard_head: "Bank Balances", account_group: "Current Assets", bs_pl: "BS" },
  "bank account": { standard_head: "Bank Balances", account_group: "Current Assets", bs_pl: "BS" },
  "salary": { standard_head: "Salaries and Wages", account_group: "Employee Benefit Expenses", bs_pl: "PL" },
  "salaries": { standard_head: "Salaries and Wages", account_group: "Employee Benefit Expenses", bs_pl: "PL" },
  "rent": { standard_head: "Rent Expense", account_group: "Other Expenses", bs_pl: "PL" },
  "depreciation": { standard_head: "Depreciation and Amortisation", account_group: "Depreciation", bs_pl: "PL" },
  "interest paid": { standard_head: "Interest Expense", account_group: "Finance Costs", bs_pl: "PL" },
  "interest received": { standard_head: "Interest Income", account_group: "Other Income", bs_pl: "PL" },
  "sales": { standard_head: "Revenue from Operations", account_group: "Revenue", bs_pl: "PL" },
  "sales account": { standard_head: "Revenue from Operations", account_group: "Revenue", bs_pl: "PL" },
  "purchase": { standard_head: "Purchases", account_group: "Cost of Goods Sold", bs_pl: "PL" },
  "purchase account": { standard_head: "Purchases", account_group: "Cost of Goods Sold", bs_pl: "PL" },
  "opening stock": { standard_head: "Opening Stock", account_group: "Cost of Goods Sold", bs_pl: "PL" },
  "closing stock": { standard_head: "Closing Stock", account_group: "Cost of Goods Sold", bs_pl: "PL" },
  "secured loan": { standard_head: "Secured Loans", account_group: "Long-Term Borrowings", bs_pl: "BS" },
  "unsecured loan": { standard_head: "Unsecured Loans", account_group: "Short-Term Borrowings", bs_pl: "BS" },
  "duties and taxes": { standard_head: "Duties and Taxes", account_group: "Other Current Liabilities", bs_pl: "BS" },
  "provisions": { standard_head: "Provisions", account_group: "Other Current Liabilities", bs_pl: "BS" },
};

function fuzzyMatch(ledgerName: string) {
  const lower = ledgerName.toLowerCase().trim();
  if (FUZZY_MAP[lower]) return FUZZY_MAP[lower];
  for (const [key, val] of Object.entries(FUZZY_MAP)) {
    if (lower.includes(key) || key.includes(lower)) return val;
  }
  return null;
}

interface CoaMapping {
  id: string;
  firm_id: string | null;
  raw_ledger_name: string | null;
  standard_head: string | null;
  bs_pl: string | null;
  account_group: string | null;
}

interface HierarchyNode {
  id: string;
  node_id: string;
  parent_node_id: string | null;
  tally_group_name: string;
  level: number;
  is_leaf: boolean;
  opening_balance: number;
  txn_debit: number;
  txn_credit: number;
  closing_balance: number;
  primary_group: string | null;
  bs_pl_side: string | null;
}

// ─── Hierarchy-aware mapping tree node ───
function MappingTreeNode({
  node,
  allNodes,
  mappings,
  onMap,
}: {
  node: HierarchyNode;
  allNodes: HierarchyNode[];
  mappings: CoaMapping[];
  onMap: (ledgerName: string, standardHead: string, bsPl: string, accountGroup: string) => void;
}) {
  const [open, setOpen] = useState(node.level <= 2);
  const children = allNodes.filter(n => n.parent_node_id === node.node_id);
  const hasChildren = children.length > 0;
  const mapped = mappings.find(m => (m.raw_ledger_name || "").toLowerCase() === node.tally_group_name.toLowerCase());
  const parentMapped = findAncestorMapping(node, allNodes, mappings);

  const fmtNum = (n: number) => n ? n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—";

  return (
    <div>
      <div
        className={`flex items-center gap-2 py-1.5 px-2 text-xs border-b border-border/30 ${
          node.is_leaf ? "hover:bg-muted/50" : "hover:bg-muted/30"
        } ${parentMapped && !mapped ? "bg-primary/5" : ""}`}
        style={{ paddingLeft: `${(node.level - 1) * 20 + 8}px` }}
      >
        {hasChildren ? (
          <button onClick={() => setOpen(!open)} className="shrink-0">
            {open ? <ChevronDown size={14} className="text-muted-foreground" /> : <ChevronRight size={14} className="text-muted-foreground" />}
          </button>
        ) : (
          <div className="w-[14px]" />
        )}
        <span className={`flex-1 ${node.is_leaf ? "text-foreground" : "font-semibold text-muted-foreground"}`}>
          {node.tally_group_name}
        </span>
        {mapped ? (
          <Badge variant="default" className="text-[10px] h-5 shrink-0">{mapped.standard_head}</Badge>
        ) : parentMapped ? (
          <Badge variant="outline" className="text-[10px] h-5 shrink-0 border-primary/30 text-primary">
            ↳ via {parentMapped.standard_head}
          </Badge>
        ) : null}
        <span className="w-20 text-right font-mono text-muted-foreground shrink-0">{fmtNum(node.closing_balance)}</span>
      </div>
      {open && hasChildren && (
        <div>
          {children.map(child => (
            <MappingTreeNode key={child.id} node={child} allNodes={allNodes} mappings={mappings} onMap={onMap} />
          ))}
        </div>
      )}
    </div>
  );
}

/** Walk up the hierarchy to find if any ancestor is mapped */
function findAncestorMapping(
  node: HierarchyNode,
  allNodes: HierarchyNode[],
  mappings: CoaMapping[]
): CoaMapping | null {
  let current = node;
  while (current.parent_node_id) {
    const parent = allNodes.find(n => n.node_id === current.parent_node_id);
    if (!parent) break;
    const mapped = mappings.find(m => (m.raw_ledger_name || "").toLowerCase() === parent.tally_group_name.toLowerCase());
    if (mapped) return mapped;
    current = parent;
  }
  return null;
}

/** Get all descendant node names for a given node */
function getDescendantNames(nodeId: string, allNodes: HierarchyNode[]): string[] {
  const names: string[] = [];
  const children = allNodes.filter(n => n.parent_node_id === nodeId);
  for (const child of children) {
    names.push(child.tally_group_name);
    names.push(...getDescendantNames(child.node_id, allNodes));
  }
  return names;
}

/** Sum only leaf descendants (no double-counting with parent) */
function sumLeafDescendants(nodeId: string, allNodes: HierarchyNode[]): number {
  const children = allNodes.filter(n => n.parent_node_id === nodeId);
  if (children.length === 0) {
    const self = allNodes.find(n => n.node_id === nodeId);
    return self?.closing_balance || 0;
  }
  return children.reduce((sum, child) => sum + sumLeafDescendants(child.node_id, allNodes), 0);
}

const CoaMappings = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const firmId = user?.firm_id;
  const fileRef = useRef<HTMLInputElement>(null);

  const [mappings, setMappings] = useState<CoaMapping[]>([]);
  const [unmappedLedgers, setUnmappedLedgers] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ standard_head: "", bs_pl: "", account_group: "" });
  const [hierarchyNodes, setHierarchyNodes] = useState<HierarchyNode[]>([]);
  const [selectedEngagement, setSelectedEngagement] = useState("");
  const [engagements, setEngagements] = useState<{ id: string; financial_year: string | null; client_id: string | null }[]>([]);

  const [mapForms, setMapForms] = useState<Record<string, { standard_head: string; bs_pl: string; account_group: string }>>({});

  useEffect(() => {
    loadEngagements();
    loadData();
  }, [firmId]);

  useEffect(() => {
    if (selectedEngagement) loadHierarchy();
  }, [selectedEngagement]);

  async function loadEngagements() {
    let q = supabase.from("audit_engagements").select("id, financial_year, client_id").order("financial_year", { ascending: false });
    if (firmId) q = q.eq("firm_id", firmId);
    const { data } = await q.limit(20);
    setEngagements(data || []);
    if (data && data.length > 0) setSelectedEngagement(data[0].id);
  }

  async function loadHierarchy() {
    const { data } = await supabase
      .from("tb_hierarchy_nodes")
      .select("id, node_id, parent_node_id, tally_group_name, level, is_leaf, opening_balance, txn_debit, txn_credit, closing_balance, primary_group, bs_pl_side")
      .eq("engagement_id", selectedEngagement)
      .order("row_number", { ascending: true });
    setHierarchyNodes((data || []) as HierarchyNode[]);
  }

  async function loadData() {
    setLoading(true);
    const [mappingsRes, snapshotsRes] = await Promise.all([
      supabase.from("coa_mappings").select("*").or(`firm_id.eq.${firmId},firm_id.is.null`),
      supabase.from("trial_balance_snapshots").select("raw_data"),
    ]);

    const allMappings = (mappingsRes.data || []) as CoaMapping[];
    setMappings(allMappings);

    const mappedNames = new Set(allMappings.map(m => (m.raw_ledger_name || "").toLowerCase()));
    const allLedgerNames = new Set<string>();
    for (const snap of snapshotsRes.data || []) {
      const rawData = snap.raw_data as any[];
      if (Array.isArray(rawData)) {
        for (const row of rawData) {
          const name = row?.account_name || row?.particulars || row?.ledger_name;
          if (name && typeof name === "string") allLedgerNames.add(name);
        }
      }
    }

    const unmapped = Array.from(allLedgerNames).filter(n => !mappedNames.has(n.toLowerCase()));
    setUnmappedLedgers(unmapped.sort());

    const forms: Record<string, any> = {};
    for (const name of unmapped) {
      const match = fuzzyMatch(name);
      forms[name] = match || { standard_head: "", bs_pl: "BS", account_group: "" };
    }
    setMapForms(forms);
    setLoading(false);
  }

  async function handleMap(ledgerName: string) {
    const form = mapForms[ledgerName];
    if (!form?.standard_head || !form?.account_group) {
      toast({ title: "Please fill Standard Head and Account Group", variant: "destructive" });
      return;
    }
    setSaving(ledgerName);
    const { error } = await supabase.from("coa_mappings").insert({
      firm_id: firmId,
      raw_ledger_name: ledgerName,
      standard_head: form.standard_head,
      bs_pl: form.bs_pl || "BS",
      account_group: form.account_group,
    });
    setSaving(null);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: `Mapped "${ledgerName}"` });
      loadData();
    }
  }

  function handleSkip(ledgerName: string) {
    setUnmappedLedgers(prev => prev.filter(n => n !== ledgerName));
  }

  async function handleDelete(id: string) {
    const { error } = await supabase.from("coa_mappings").delete().eq("id", id);
    if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
    else loadData();
  }

  async function handleEditSave(id: string) {
    const { error } = await supabase.from("coa_mappings").update({
      standard_head: editForm.standard_head,
      bs_pl: editForm.bs_pl,
      account_group: editForm.account_group,
    } as any).eq("id", id);
    if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
    else {
      setEditingId(null);
      loadData();
    }
  }

  function handleExport() {
    const rows = mappings.map(m => ({
      "Raw Ledger Name": m.raw_ledger_name,
      "Standard Head": m.standard_head,
      "BS/PL": m.bs_pl,
      "Account Group": m.account_group,
      "Scope": m.firm_id ? "Firm" : "Global",
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "COA Mappings");
    XLSX.writeFile(wb, "coa_mappings.xlsx");
  }

  function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const wb = XLSX.read(evt.target?.result, { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows: any[] = XLSX.utils.sheet_to_json(ws);
        let count = 0;
        for (const row of rows) {
          const rawName = row["Raw Ledger Name"] || row["raw_ledger_name"];
          const stdHead = row["Standard Head"] || row["standard_head"];
          if (!rawName || !stdHead) continue;
          await supabase.from("coa_mappings").insert({
            firm_id: firmId,
            raw_ledger_name: rawName,
            standard_head: stdHead,
            bs_pl: row["BS/PL"] || row["bs_pl"] || "BS",
            account_group: row["Account Group"] || row["account_group"] || "",
          });
          count++;
        }
        toast({ title: `Imported ${count} mappings` });
        loadData();
      } catch {
        toast({ title: "Failed to parse file", variant: "destructive" });
      }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = "";
  }

  // Build aggregated mapped summary (hierarchy-aware, no double counting)
  const mappedSummary = useMemo(() => {
    if (hierarchyNodes.length === 0 || mappings.length === 0) return [];
    const result: { mapping: CoaMapping; leafTotal: number; childCount: number; children: string[] }[] = [];
    for (const m of mappings) {
      const matchingNode = hierarchyNodes.find(n => n.tally_group_name.toLowerCase() === (m.raw_ledger_name || "").toLowerCase());
      if (!matchingNode) continue;
      // Check this node isn't already covered by an ancestor mapping
      const ancestorMapping = findAncestorMapping(matchingNode, hierarchyNodes, mappings);
      if (ancestorMapping) continue; // skip — already nested under a parent mapping
      const descendants = getDescendantNames(matchingNode.node_id, hierarchyNodes);
      const leafTotal = sumLeafDescendants(matchingNode.node_id, hierarchyNodes);
      result.push({ mapping: m, leafTotal, childCount: descendants.length, children: descendants.slice(0, 10) });
    }
    return result;
  }, [hierarchyNodes, mappings]);

  const rootNodes = useMemo(() => hierarchyNodes.filter(n => !n.parent_node_id), [hierarchyNodes]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <Button variant="ghost" size="sm" className="-ml-2 mb-2 text-xs gap-1" onClick={() => navigate("/settings")}>
          <ArrowLeft className="h-3 w-3" /> Back to Settings
        </Button>
        <h1 className="text-2xl font-display font-bold text-foreground">Chart of Accounts Mappings</h1>
        <p className="text-sm text-muted-foreground">Map Tally/Busy ledger names to standard Schedule III account heads. Hierarchy-aware — mapping a parent auto-nests children.</p>
      </div>

      <Alert>
        <FolderTree className="h-4 w-4" />
        <AlertTitle className="text-sm">Hierarchy-Aware Mapping</AlertTitle>
        <AlertDescription className="text-xs">
          When you map a parent group (e.g. "Share Capital"), all child ledgers automatically appear nested under it.
          Only leaf-level amounts are aggregated — no double-counting of parent + child totals.
        </AlertDescription>
      </Alert>

      <Tabs defaultValue="hierarchy" className="space-y-4">
        <TabsList>
          <TabsTrigger value="hierarchy" className="gap-2">
            <FolderTree className="h-3.5 w-3.5" /> Hierarchy View
          </TabsTrigger>
          <TabsTrigger value="unmapped" className="gap-2">
            Unmapped Ledgers
            {unmappedLedgers.length > 0 && (
              <Badge variant="destructive" className="text-[10px] px-1.5 py-0">{unmappedLedgers.length}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="all">All Mappings</TabsTrigger>
          <TabsTrigger value="summary">Mapped Summary</TabsTrigger>
        </TabsList>

        {/* Hierarchy View */}
        <TabsContent value="hierarchy">
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-sm">TB Hierarchy with Mapping Status</CardTitle>
                  <CardDescription>Select an engagement to view its hierarchy and mapping coverage.</CardDescription>
                </div>
                <Select value={selectedEngagement} onValueChange={setSelectedEngagement}>
                  <SelectTrigger className="w-48 h-8 text-xs"><SelectValue placeholder="Select engagement" /></SelectTrigger>
                  <SelectContent>
                    {engagements.map(e => <SelectItem key={e.id} value={e.id} className="text-xs">FY {e.financial_year || "—"}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>
            <CardContent>
              {hierarchyNodes.length === 0 ? (
                <p className="text-sm text-muted-foreground py-6 text-center">No hierarchy data. Import a Trial Balance first.</p>
              ) : (
                <div className="border rounded-lg overflow-auto max-h-[500px]">
                  <div className="flex items-center gap-2 py-2 px-2 bg-muted/50 text-[10px] font-semibold text-muted-foreground uppercase sticky top-0 z-10 border-b">
                    <div className="w-4" />
                    <span className="flex-1">Account / Group</span>
                    <span className="w-32 text-center">Mapping</span>
                    <span className="w-20 text-right">Closing</span>
                  </div>
                  {rootNodes.map(node => (
                    <MappingTreeNode key={node.id} node={node} allNodes={hierarchyNodes} mappings={mappings} onMap={handleMap} />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Mapped Summary — hierarchy-aware */}
        <TabsContent value="summary">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Mapped Summary (Hierarchy-Aware)</CardTitle>
              <CardDescription>Shows mapped heads with leaf-only totals. No double-counting of parent + child values.</CardDescription>
            </CardHeader>
            <CardContent>
              {mappedSummary.length === 0 ? (
                <p className="text-sm text-muted-foreground py-6 text-center">No hierarchy-linked mappings found. Import a TB and create mappings first.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">Mapped Head</TableHead>
                      <TableHead className="text-xs">Standard Head</TableHead>
                      <TableHead className="text-xs">Account Group</TableHead>
                      <TableHead className="text-xs text-right">Leaf Total (₹)</TableHead>
                      <TableHead className="text-xs text-right">Sub-Ledgers</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {mappedSummary.map(({ mapping, leafTotal, childCount, children }) => (
                      <TableRow key={mapping.id}>
                        <TableCell className="text-xs font-medium">{mapping.raw_ledger_name}</TableCell>
                        <TableCell className="text-xs">{mapping.standard_head}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{mapping.account_group}</TableCell>
                        <TableCell className="text-xs text-right font-mono">
                          {leafTotal.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                        </TableCell>
                        <TableCell className="text-xs text-right">
                          {childCount > 0 ? (
                            <span className="text-muted-foreground" title={children.join(", ")}>
                              {childCount} nested
                            </span>
                          ) : (
                            <span className="text-muted-foreground">leaf</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="unmapped">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Unmapped Ledgers</CardTitle>
              <CardDescription>{unmappedLedgers.length} ledger{unmappedLedgers.length !== 1 ? "s" : ""} need mapping</CardDescription>
            </CardHeader>
            <CardContent>
              {unmappedLedgers.length === 0 ? (
                <p className="text-sm text-muted-foreground py-6 text-center">All ledgers are mapped! 🎉</p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Raw Ledger Name</TableHead>
                        <TableHead>Suggested Standard Head</TableHead>
                        <TableHead>BS/PL</TableHead>
                        <TableHead>Account Group</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {unmappedLedgers.map(name => {
                        const form = mapForms[name] || { standard_head: "", bs_pl: "BS", account_group: "" };
                        return (
                          <TableRow key={name}>
                            <TableCell className="font-mono text-xs">{name}</TableCell>
                            <TableCell>
                              <Input
                                value={form.standard_head}
                                onChange={e => setMapForms(p => ({ ...p, [name]: { ...form, standard_head: e.target.value } }))}
                                className="h-8 text-xs"
                                placeholder="Standard head"
                              />
                            </TableCell>
                            <TableCell>
                              <Select value={form.bs_pl} onValueChange={v => setMapForms(p => ({ ...p, [name]: { ...form, bs_pl: v } }))}>
                                <SelectTrigger className="h-8 text-xs w-20"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="BS">BS</SelectItem>
                                  <SelectItem value="PL">PL</SelectItem>
                                </SelectContent>
                              </Select>
                            </TableCell>
                            <TableCell>
                              <Select value={form.account_group} onValueChange={v => setMapForms(p => ({ ...p, [name]: { ...form, account_group: v } }))}>
                                <SelectTrigger className="h-8 text-xs w-44"><SelectValue placeholder="Select group" /></SelectTrigger>
                                <SelectContent>
                                  {ACCOUNT_GROUPS.map(g => <SelectItem key={g} value={g}>{g}</SelectItem>)}
                                </SelectContent>
                              </Select>
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex justify-end gap-1">
                                <Button size="sm" variant="default" className="h-7 text-xs gap-1" onClick={() => handleMap(name)} disabled={saving === name}>
                                  {saving === name ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />} Map
                                </Button>
                                <Button size="sm" variant="ghost" className="h-7 text-xs gap-1" onClick={() => handleSkip(name)}>
                                  <X className="h-3 w-3" /> Skip
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="all">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-sm">All Mappings</CardTitle>
                <CardDescription>{mappings.length} total mappings</CardDescription>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" className="gap-1" onClick={handleExport}>
                  <Download className="h-3 w-3" /> Export
                </Button>
                <Button variant="outline" size="sm" className="gap-1" onClick={() => fileRef.current?.click()}>
                  <Upload className="h-3 w-3" /> Import
                </Button>
                <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleImportFile} />
              </div>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Raw Ledger Name</TableHead>
                      <TableHead>Standard Head</TableHead>
                      <TableHead>BS/PL</TableHead>
                      <TableHead>Account Group</TableHead>
                      <TableHead>Scope</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {mappings.map(m => {
                      const isGlobal = !m.firm_id;
                      const isEditing = editingId === m.id;
                      return (
                        <TableRow key={m.id} className={isGlobal ? "bg-muted/40" : ""}>
                          <TableCell className="font-mono text-xs">{m.raw_ledger_name}</TableCell>
                          <TableCell>
                            {isEditing ? (
                              <Input value={editForm.standard_head} onChange={e => setEditForm(p => ({ ...p, standard_head: e.target.value }))} className="h-8 text-xs" />
                            ) : m.standard_head}
                          </TableCell>
                          <TableCell>
                            {isEditing ? (
                              <Select value={editForm.bs_pl} onValueChange={v => setEditForm(p => ({ ...p, bs_pl: v }))}>
                                <SelectTrigger className="h-8 text-xs w-20"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="BS">BS</SelectItem>
                                  <SelectItem value="PL">PL</SelectItem>
                                </SelectContent>
                              </Select>
                            ) : (
                              <Badge variant="outline" className="text-[10px]">{m.bs_pl}</Badge>
                            )}
                          </TableCell>
                          <TableCell>
                            {isEditing ? (
                              <Select value={editForm.account_group} onValueChange={v => setEditForm(p => ({ ...p, account_group: v }))}>
                                <SelectTrigger className="h-8 text-xs w-44"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  {ACCOUNT_GROUPS.map(g => <SelectItem key={g} value={g}>{g}</SelectItem>)}
                                </SelectContent>
                              </Select>
                            ) : m.account_group}
                          </TableCell>
                          <TableCell>
                            {isGlobal ? <Badge variant="secondary" className="text-[10px]">Global</Badge> : <Badge variant="outline" className="text-[10px]">Firm</Badge>}
                          </TableCell>
                          <TableCell className="text-right">
                            {isGlobal ? (
                              <span className="text-xs text-muted-foreground">Read-only</span>
                            ) : isEditing ? (
                              <div className="flex justify-end gap-1">
                                <Button size="sm" variant="default" className="h-7 text-xs" onClick={() => handleEditSave(m.id)}>Save</Button>
                                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setEditingId(null)}>Cancel</Button>
                              </div>
                            ) : (
                              <div className="flex justify-end gap-1">
                                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setEditingId(m.id); setEditForm({ standard_head: m.standard_head || "", bs_pl: m.bs_pl || "BS", account_group: m.account_group || "" }); }}>
                                  <Pencil className="h-3.5 w-3.5" />
                                </Button>
                                <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => handleDelete(m.id)}>
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default CoaMappings;
