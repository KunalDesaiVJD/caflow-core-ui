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
import {
  ArrowLeft, Check, X, Loader2, Download, Upload, Pencil, Trash2,
  ChevronRight, ChevronDown, FolderTree, AlertTriangle, Database, FileSpreadsheet,
  Building2, Users, Briefcase, RefreshCw
} from "lucide-react";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import * as XLSX from "xlsx";
import coaMasterDataJson from "@/data/coa-master-data.json";

// ─── Types ───
interface CoaMasterRow {
  account_code: string;
  level: number;
  major_group: string | null;
  group_name: string | null;
  sub_group: string | null;
  account_head: string;
  account_type: string | null;
  normal_balance: string | null;
  bs_pl: string | null;
  fs_line_item: string | null;
  note_no: string | null;
  applicable_entities: string | null;
  tally_group_mapping: string | null;
  remarks: string | null;
  entity_type: string;
}

const coaMasterData: CoaMasterRow[] = coaMasterDataJson as CoaMasterRow[];

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

interface CoaMasterDbRow extends CoaMasterRow {
  id: string;
  firm_id: string | null;
}

// ─── Derive unique account groups from master data ───
const ACCOUNT_GROUPS = [...new Set(
  coaMasterData
    .filter(r => r.group_name)
    .map(r => r.group_name!)
)].sort();

// ─── Entity type → COA category mapping ───
const ENTITY_TYPE_TO_COA: Record<string, "corporate" | "llp" | "nce"> = {
  "Private Ltd": "corporate",
  "Public Ltd": "corporate",
  "LLP": "llp",
  "Proprietorship": "nce",
  "Partnership": "nce",
  "HUF": "nce",
  "Trust": "nce",
  "AOP": "nce",
  "BOI": "nce",
};

const COA_CATEGORY_CONFIG = {
  corporate: {
    label: "Corporate",
    description: "Private Ltd & Public Ltd",
    subtitle: "Schedule III Div I (AS)",
    icon: Building2,
    activeClass: "border-blue-500 bg-blue-50 dark:bg-blue-950/30 text-blue-900 dark:text-blue-100",
    iconBg: "bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300",
    badgeCls: "bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300",
    entities: ["Private Ltd", "Public Ltd"],
  },
  llp: {
    label: "LLP",
    description: "Limited Liability Partnership",
    subtitle: "LLP-specific accounts",
    icon: Users,
    activeClass: "border-purple-500 bg-purple-50 dark:bg-purple-950/30 text-purple-900 dark:text-purple-100",
    iconBg: "bg-purple-100 dark:bg-purple-900/50 text-purple-700 dark:text-purple-300",
    badgeCls: "bg-purple-100 text-purple-700 dark:bg-purple-900/50 dark:text-purple-300",
    entities: ["LLP"],
  },
  nce: {
    label: "Non-Corporate",
    description: "Propr. · Partnership · HUF · Trust · AOP · BOI",
    subtitle: "NCE-applicable accounts",
    icon: Briefcase,
    activeClass: "border-amber-500 bg-amber-50 dark:bg-amber-950/30 text-amber-900 dark:text-amber-100",
    iconBg: "bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300",
    badgeCls: "bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300",
    entities: ["Proprietorship", "Partnership", "HUF", "Trust", "AOP", "BOI"],
  },
} as const;

// ─── Fuzzy matching using COA master tally_group_mapping ───
function fuzzyMatchFromMaster(ledgerName: string, entityType: string): { standard_head: string; account_group: string; bs_pl: string } | null {
  const lower = ledgerName.toLowerCase().trim();
  const filtered = coaMasterData.filter(r => r.entity_type === entityType || r.applicable_entities?.includes("Corp"));

  // Exact tally group match
  for (const row of filtered) {
    if (row.tally_group_mapping && row.tally_group_mapping.toLowerCase() === lower) {
      return {
        standard_head: row.account_head,
        account_group: row.group_name || row.major_group || "",
        bs_pl: row.bs_pl || "BS",
      };
    }
  }

  // Partial tally group match
  for (const row of filtered) {
    if (row.tally_group_mapping && (
      lower.includes(row.tally_group_mapping.toLowerCase()) ||
      row.tally_group_mapping.toLowerCase().includes(lower)
    )) {
      return {
        standard_head: row.account_head,
        account_group: row.group_name || row.major_group || "",
        bs_pl: row.bs_pl || "BS",
      };
    }
  }

  // Account head partial match
  for (const row of filtered) {
    if (row.level === 4 && row.account_head.toLowerCase().includes(lower)) {
      return {
        standard_head: row.account_head,
        account_group: row.group_name || row.major_group || "",
        bs_pl: row.bs_pl || "BS",
      };
    }
  }

  return null;
}

// ─── Hierarchy-aware tree node ───
function MappingTreeNode({
  node, allNodes, mappings, masterRows,
}: {
  node: HierarchyNode;
  allNodes: HierarchyNode[];
  mappings: CoaMapping[];
  masterRows: CoaMasterDbRow[];
}) {
  const [open, setOpen] = useState(node.level <= 2);
  const children = allNodes.filter(n => n.parent_node_id === node.node_id);
  const hasChildren = children.length > 0;
  const mapped = mappings.find(m => (m.raw_ledger_name || "").toLowerCase() === node.tally_group_name.toLowerCase());
  const parentMapped = findAncestorMapping(node, allNodes, mappings);
  const masterMatch = masterRows.find(m => m.tally_group_mapping?.toLowerCase() === node.tally_group_name.toLowerCase());

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
        ) : masterMatch ? (
          <Badge variant="secondary" className="text-[10px] h-5 shrink-0">
            💡 {masterMatch.account_head}
          </Badge>
        ) : null}
        <span className="w-20 text-right font-mono text-muted-foreground shrink-0">{fmtNum(node.closing_balance)}</span>
      </div>
      {open && hasChildren && (
        <div>
          {children.map(child => (
            <MappingTreeNode key={child.id} node={child} allNodes={allNodes} mappings={mappings} masterRows={masterRows} />
          ))}
        </div>
      )}
    </div>
  );
}

function findAncestorMapping(node: HierarchyNode, allNodes: HierarchyNode[], mappings: CoaMapping[]): CoaMapping | null {
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

function getDescendantNames(nodeId: string, allNodes: HierarchyNode[]): string[] {
  const names: string[] = [];
  const children = allNodes.filter(n => n.parent_node_id === nodeId);
  for (const child of children) {
    names.push(child.tally_group_name);
    names.push(...getDescendantNames(child.node_id, allNodes));
  }
  return names;
}

function sumLeafDescendants(nodeId: string, allNodes: HierarchyNode[]): number {
  const children = allNodes.filter(n => n.parent_node_id === nodeId);
  if (children.length === 0) {
    const self = allNodes.find(n => n.node_id === nodeId);
    return self?.closing_balance || 0;
  }
  return children.reduce((sum, child) => sum + sumLeafDescendants(child.node_id, allNodes), 0);
}

// ─── COA Master Tree Node (for COA Master tab) ───
function CoaMasterTreeNode({ row, allRows }: { row: CoaMasterRow; allRows: CoaMasterRow[] }) {
  const [open, setOpen] = useState(false);
  const children = allRows.filter(r =>
    r.entity_type === row.entity_type &&
    r.level === row.level + 1 &&
    r.major_group === row.major_group &&
    (row.level === 1 ? true :
     row.level === 2 ? r.group_name === row.group_name :
     row.level === 3 ? r.sub_group === row.sub_group : false)
  );
  // Better: use account_code prefix matching
  const codePrefix = row.account_code.replace(/0+$/, "");
  const childrenByCode = allRows.filter(r =>
    r.entity_type === row.entity_type &&
    r.level === row.level + 1 &&
    r.account_code.startsWith(codePrefix) &&
    r.account_code !== row.account_code
  );
  const effectiveChildren = childrenByCode.length > 0 ? childrenByCode : children;
  const hasChildren = effectiveChildren.length > 0;

  return (
    <div>
      <div
        className={`flex items-center gap-2 py-1 px-2 text-xs border-b border-border/20 hover:bg-muted/30`}
        style={{ paddingLeft: `${(row.level - 1) * 20 + 8}px` }}
      >
        {hasChildren ? (
          <button onClick={() => setOpen(!open)} className="shrink-0">
            {open ? <ChevronDown size={14} className="text-muted-foreground" /> : <ChevronRight size={14} className="text-muted-foreground" />}
          </button>
        ) : (
          <div className="w-[14px]" />
        )}
        <span className="w-12 text-muted-foreground font-mono shrink-0">{row.account_code}</span>
        <span className="w-6 text-center text-muted-foreground shrink-0">{row.level}</span>
        <span className="w-20 truncate text-muted-foreground shrink-0" title={row.major_group || ""}>{row.major_group || "—"}</span>
        <span className="w-24 truncate text-muted-foreground shrink-0" title={row.group_name || ""}>{row.group_name || "—"}</span>
        <span className="w-24 truncate text-muted-foreground shrink-0" title={row.sub_group || ""}>{row.sub_group || "—"}</span>
        <span className={`flex-1 min-w-[120px] ${row.level <= 2 ? "font-semibold text-foreground" : row.level === 3 ? "font-medium text-foreground" : "text-foreground"}`}>
          {row.account_head}
        </span>
        <span className="w-16 truncate text-muted-foreground shrink-0" title={row.account_type || ""}>{row.account_type || "—"}</span>
        <span className="w-10 text-center text-muted-foreground shrink-0">{row.normal_balance || "—"}</span>
        <Badge variant={row.bs_pl === "PL" ? "secondary" : "outline"} className="text-[10px] h-5 shrink-0">
          {row.bs_pl || "—"}
        </Badge>
        <span className="w-36 truncate text-muted-foreground text-[10px] shrink-0" title={row.fs_line_item || ""}>{row.fs_line_item || "—"}</span>
        <span className="w-10 text-center text-muted-foreground text-[10px] shrink-0">{row.note_no || "—"}</span>
        <span className="w-20 truncate text-muted-foreground text-[10px] shrink-0" title={row.applicable_entities || ""}>{row.applicable_entities || "—"}</span>
        <span className="w-28 truncate text-muted-foreground text-[10px] shrink-0" title={row.tally_group_mapping || ""}>{row.tally_group_mapping || "—"}</span>
        <span className="w-24 truncate text-muted-foreground text-[10px] shrink-0" title={row.remarks || ""}>{row.remarks || "—"}</span>
      </div>
      {open && hasChildren && (
        <div>
          {effectiveChildren.map(child => (
            <CoaMasterTreeNode key={`${child.account_code}-${child.entity_type}`} row={child} allRows={allRows} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main Component ───
const CoaMappings = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const firmId = user?.firm_id;
  const fileRef = useRef<HTMLInputElement>(null);
  const masterFileRef = useRef<HTMLInputElement>(null);

  const [mappings, setMappings] = useState<CoaMapping[]>([]);
  const [unmappedLedgers, setUnmappedLedgers] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ standard_head: "", bs_pl: "", account_group: "" });
  const [hierarchyNodes, setHierarchyNodes] = useState<HierarchyNode[]>([]);
  const [selectedEngagement, setSelectedEngagement] = useState("");
  const [engagements, setEngagements] = useState<{ id: string; financial_year: string | null; client_id: string | null; client_name?: string | null; client_entity_type?: string | null }[]>([]);
  const [clientEntityType, setClientEntityType] = useState<string | null>(null);
  const [mapForms, setMapForms] = useState<Record<string, { standard_head: string; bs_pl: string; account_group: string }>>({});
  const [masterEntityFilter, setMasterEntityFilter] = useState<"all" | "corporate" | "llp" | "nce">("all");
  const [masterDbRows, setMasterDbRows] = useState<CoaMasterDbRow[]>([]);
  const [seedingMaster, setSeedingMaster] = useState(false);
  const [importingMaster, setImportingMaster] = useState(false);
  const [importingFromTally, setImportingFromTally] = useState(false);

  // Derived: active COA category tab and client-inferred category
  const activeCOACat = (masterEntityFilter === "all" ? "corporate" : masterEntityFilter) as "corporate" | "llp" | "nce";
  const inferredClientCat: "corporate" | "llp" | "nce" | null = clientEntityType ? (ENTITY_TYPE_TO_COA[clientEntityType] ?? null) : null;

  useEffect(() => {
    loadEngagements();
    loadData();
    loadMasterFromDb();
  }, [firmId]);

  useEffect(() => {
    if (selectedEngagement) loadHierarchy();
  }, [selectedEngagement]);

  // Auto-switch COA category when engagement (client) changes
  useEffect(() => {
    if (!selectedEngagement || engagements.length === 0) return;
    const eng = engagements.find(e => e.id === selectedEngagement);
    const et = eng?.client_entity_type ?? null;
    setClientEntityType(et);
    if (et && ENTITY_TYPE_TO_COA[et]) {
      setMasterEntityFilter(ENTITY_TYPE_TO_COA[et]);
    }
  }, [selectedEngagement, engagements]);

  async function loadEngagements() {
    let q = supabase
      .from("audit_engagements")
      .select("id, financial_year, client_id, clients(client_name, entity_type)")
      .order("financial_year", { ascending: false });
    if (firmId) q = q.eq("firm_id", firmId);
    const { data } = await q.limit(20);
    const mapped = ((data || []) as any[]).map((e) => ({
      id: e.id,
      financial_year: e.financial_year,
      client_id: e.client_id,
      client_name: e.clients?.client_name ?? null,
      client_entity_type: e.clients?.entity_type ?? null,
    }));
    setEngagements(mapped);
    if (mapped.length > 0) setSelectedEngagement(mapped[0].id);
  }

  async function loadHierarchy() {
    const { data } = await supabase
      .from("tb_hierarchy_nodes")
      .select("id, node_id, parent_node_id, tally_group_name, level, is_leaf, opening_balance, txn_debit, txn_credit, closing_balance, primary_group, bs_pl_side")
      .eq("engagement_id", selectedEngagement)
      .order("row_number", { ascending: true });
    setHierarchyNodes((data || []) as HierarchyNode[]);
  }

  async function fetchAllMasterRows() {
    if (!firmId) return [];
    // Fetch all rows (may exceed default 1000 limit), so paginate
    let allRows: CoaMasterDbRow[] = [];
    let from = 0;
    const pageSize = 1000;
    while (true) {
      const { data, error } = await supabase
        .from("coa_master" as any)
        .select("*")
        .or(`firm_id.eq.${firmId},firm_id.is.null`)
        .order("account_code", { ascending: true })
        .range(from, from + pageSize - 1);
      if (error) throw error;
      const rows = (data || []) as unknown as CoaMasterDbRow[];
      allRows = allRows.concat(rows);
      if (rows.length < pageSize) break;
      from += pageSize;
    }
    return allRows;
  }

  async function loadMasterFromDb() {
    try {
      const rows = await fetchAllMasterRows();
      setMasterDbRows(rows);
    } catch (error: any) {
      setMasterDbRows([]);
      toast({ title: "Error loading COA master", description: error.message, variant: "destructive" });
    }
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
      const match = fuzzyMatchFromMaster(name, "corporate");
      forms[name] = match || { standard_head: "", bs_pl: "BS", account_group: "" };
    }
    setMapForms(forms);
    setLoading(false);
  }

  async function handleSeedMaster() {
    if (!firmId) return;
    setSeedingMaster(true);
    try {
      const { error: deleteError } = await supabase.from("coa_master" as any).delete().eq("firm_id", firmId);
      if (deleteError) throw deleteError;

      const rows = coaMasterData.map(r => ({ ...r, firm_id: firmId }));
      for (let i = 0; i < rows.length; i += 200) {
        const batch = rows.slice(i, i + 200);
        const { error } = await supabase.from("coa_master" as any).upsert(batch as any, {
          onConflict: "account_code,entity_type,firm_id",
          ignoreDuplicates: false,
        });
        if (error) throw error;
      }

      const seededRows = await fetchAllMasterRows();
      const firmRows = seededRows.filter(row => row.firm_id === firmId);
      if (firmRows.length !== rows.length) {
        throw new Error(`Expected ${rows.length} seeded rows, but found ${firmRows.length}.`);
      }

      setMasterDbRows(seededRows);
      // Stay on current entity category (or switch to client's if known)
      if (inferredClientCat) setMasterEntityFilter(inferredClientCat);
      toast({ title: `Seeded ${firmRows.length} COA master entries from built-in template` });
    } catch (e: any) {
      toast({ title: "Error seeding master", description: e.message, variant: "destructive" });
    } finally {
      setSeedingMaster(false);
    }
  }

  async function handleImportMasterFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !firmId) return;
    setImportingMaster(true);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });

      const sheetMap: Record<string, string> = {};
      for (const sn of wb.SheetNames) {
        const lower = sn.toLowerCase();
        if (lower.includes("corporate") || lower.includes("corp")) sheetMap[sn] = "corporate";
        else if (lower.includes("llp")) sheetMap[sn] = "llp";
        else if (lower.includes("nce") || lower.includes("non-corp") || lower.includes("proprietor")) sheetMap[sn] = "nce";
      }

      if (Object.keys(sheetMap).length === 0) {
        // Fallback: treat first data sheet as corporate
        const firstDataSheet = wb.SheetNames.find(s => !s.toLowerCase().includes("readme") && !s.toLowerCase().includes("change"));
        if (firstDataSheet) sheetMap[firstDataSheet] = "corporate";
      }

      let totalImported = 0;
      const { error: deleteError } = await supabase.from("coa_master" as any).delete().eq("firm_id", firmId);
      if (deleteError) throw deleteError;

      for (const [sheetName, entityType] of Object.entries(sheetMap)) {
        const ws = wb.Sheets[sheetName];
        const allRows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });

        // Find header row
        let headerIdx = -1;
        for (let i = 0; i < Math.min(10, allRows.length); i++) {
          const cells = allRows[i].map((c: any) => String(c).toLowerCase().trim());
          if (cells.includes("account code") && cells.includes("account head")) {
            headerIdx = i;
            break;
          }
        }
        if (headerIdx === -1) continue;

        const headers = allRows[headerIdx].map((c: any) => String(c).trim());
        const colIdx = (name: string) => headers.findIndex(h => h.toLowerCase().includes(name.toLowerCase()));

        const iCode = colIdx("Account Code");
        const iLevel = colIdx("Level");
        const iMajor = colIdx("Major Group");
        const iGroup = colIdx("Group");
        const iSub = colIdx("Sub-Group");
        const iHead = colIdx("Account Head");
        const iType = colIdx("Account Type");
        const iNormal = colIdx("Normal Balance");
        const iBsPl = colIdx("BS / PL") >= 0 ? colIdx("BS / PL") : colIdx("BS/PL");
        const iFs = colIdx("FS Line Item");
        const iNote = colIdx("Note No");
        const iApplicable = colIdx("Applicable Entities");
        const iTally = colIdx("Tally Group Mapping");
        const iRemarks = colIdx("Remarks");

        const batch: any[] = [];
        for (let r = headerIdx + 1; r < allRows.length; r++) {
          const row = allRows[r];
          const code = String(row[iCode] || "").trim();
          const head = String(row[iHead >= 0 ? iHead : 5] || "").trim();
          if (!code || !head) continue;

          batch.push({
            account_code: code,
            level: parseInt(String(row[iLevel] || "4")) || 4,
            major_group: iMajor >= 0 ? String(row[iMajor] || "").trim() || null : null,
            group_name: iGroup >= 0 ? String(row[iGroup] || "").trim() || null : null,
            sub_group: iSub >= 0 ? String(row[iSub] || "").trim() || null : null,
            account_head: head,
            account_type: iType >= 0 ? String(row[iType] || "").trim() || null : null,
            normal_balance: iNormal >= 0 ? String(row[iNormal] || "").trim() || null : null,
            bs_pl: iBsPl >= 0 ? String(row[iBsPl] || "").trim() || null : null,
            fs_line_item: iFs >= 0 ? String(row[iFs] || "").trim() || null : null,
            note_no: iNote >= 0 ? String(row[iNote] || "").trim() || null : null,
            applicable_entities: iApplicable >= 0 ? String(row[iApplicable] || "").trim() || null : null,
            tally_group_mapping: iTally >= 0 ? String(row[iTally] || "").trim() || null : null,
            remarks: iRemarks >= 0 ? String(row[iRemarks] || "").trim() || null : null,
            entity_type: entityType,
            firm_id: firmId,
          });
        }

        for (let i = 0; i < batch.length; i += 200) {
          const chunk = batch.slice(i, i + 200);
          const { error } = await supabase.from("coa_master" as any).upsert(chunk as any, {
            onConflict: "account_code,entity_type,firm_id",
            ignoreDuplicates: false,
          });
          if (error) throw error;
        }
        totalImported += batch.length;
      }

      const importedRows = await fetchAllMasterRows();
      setMasterDbRows(importedRows);
      // Switch to client's entity category if known, else corporate as default
      setMasterEntityFilter(inferredClientCat ?? "corporate");
      toast({ title: `Imported ${totalImported} COA master entries from ${Object.keys(sheetMap).length} sheet(s)` });
    } catch (err: any) {
      toast({ title: "Import failed", description: err.message, variant: "destructive" });
    } finally {
      setImportingMaster(false);
      e.target.value = "";
    }
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

  function handleExportMaster() {
    // Export only the currently active entity category
    const exportRows = filteredMasterData.map(m => ({
      "Account Code": m.account_code,
      "Level": m.level,
      "Major Group": m.major_group,
      "Group": m.group_name,
      "Sub-Group": m.sub_group,
      "Account Head": m.account_head,
      "Account Type": m.account_type,
      "Normal Balance": m.normal_balance,
      "BS / PL": m.bs_pl,
      "FS Line Item": m.fs_line_item,
      "Note No.": m.note_no,
      "Applicable Entities": m.applicable_entities,
      "Tally Group Mapping": m.tally_group_mapping,
      "Remarks": m.remarks,
      "Entity Type": m.entity_type,
    }));
    const ws = XLSX.utils.json_to_sheet(exportRows);
    const wb = XLSX.utils.book_new();
    const sheetLabel = activeCOACat === "corporate" ? "Corporate COA" : activeCOACat === "llp" ? "LLP COA" : "NCE COA";
    XLSX.utils.book_append_sheet(wb, ws, sheetLabel);
    XLSX.writeFile(wb, `coa_master_${activeCOACat}_export.xlsx`);
  }

  async function handleImportFromTally() {
    if (!selectedEngagement) {
      toast({ title: "Select an engagement first", variant: "destructive" });
      return;
    }
    setImportingFromTally(true);
    try {
      const { data: ledgers, error } = await supabase
        .from("tally_ledgers")
        .select("ledger_name, parent_group")
        .eq("engagement_id", selectedEngagement);

      if (error) throw error;
      if (!ledgers || ledgers.length === 0) {
        toast({
          title: "No Tally ledgers found",
          description: "Run the Tally sync agent first (Tally Sync tab) to populate ledgers.",
          variant: "destructive",
        });
        return;
      }

      const existing = new Set(mappings.map(m => (m.raw_ledger_name || "").toLowerCase()));
      const toInsert = ledgers.filter(l => !existing.has((l.ledger_name || "").toLowerCase()));

      if (toInsert.length === 0) {
        toast({ title: "All Tally ledgers already present in COA Mappings" });
        setImportingFromTally(false);
        return;
      }

      const rows = toInsert.map(l => {
        const match = fuzzyMatchFromMaster(l.ledger_name, activeCOACat);
        return {
          firm_id: firmId,
          raw_ledger_name: l.ledger_name,
          standard_head: match?.account_head ?? "",
          bs_pl: match?.bs_pl ?? "BS",
          account_group: l.parent_group ?? "",
        };
      });

      for (let i = 0; i < rows.length; i += 100) {
        const chunk = rows.slice(i, i + 100);
        const { error: insErr } = await supabase.from("coa_mappings").insert(chunk);
        if (insErr) throw insErr;
      }

      toast({ title: `Imported ${toInsert.length} ledgers from Tally into COA Mappings` });
      await loadData();
    } catch (err: any) {
      toast({ title: "Import failed", description: err.message, variant: "destructive" });
    } finally {
      setImportingFromTally(false);
    }
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

  // Build aggregated mapped summary (hierarchy-aware)
  const mappedSummary = useMemo(() => {
    if (hierarchyNodes.length === 0 || mappings.length === 0) return [];
    const result: { mapping: CoaMapping; leafTotal: number; childCount: number; children: string[] }[] = [];
    for (const m of mappings) {
      const matchingNode = hierarchyNodes.find(n => n.tally_group_name.toLowerCase() === (m.raw_ledger_name || "").toLowerCase());
      if (!matchingNode) continue;
      const ancestorMapping = findAncestorMapping(matchingNode, hierarchyNodes, mappings);
      if (ancestorMapping) continue;
      const descendants = getDescendantNames(matchingNode.node_id, hierarchyNodes);
      const leafTotal = sumLeafDescendants(matchingNode.node_id, hierarchyNodes);
      result.push({ mapping: m, leafTotal, childCount: descendants.length, children: descendants.slice(0, 10) });
    }
    return result;
  }, [hierarchyNodes, mappings]);

  const rootNodes = useMemo(() => hierarchyNodes.filter(n => !n.parent_node_id), [hierarchyNodes]);

  // Filtered master data for the master tab
  const filteredMasterData = useMemo(() => {
    const source = masterDbRows.length > 0 ? masterDbRows : coaMasterData;
    if (masterEntityFilter === "all") return source;
    return source.filter(r => r.entity_type === masterEntityFilter);
  }, [masterDbRows, masterEntityFilter]);

  const masterRootRows = useMemo(() => filteredMasterData.filter(r => r.level === 1), [filteredMasterData]);

  const masterStats = useMemo(() => {
    const source = masterDbRows.length > 0 ? masterDbRows : [];
    return {
      total: source.length,
      corporate: source.filter(r => r.entity_type === "corporate").length,
      llp: source.filter(r => r.entity_type === "llp").length,
      nce: source.filter(r => r.entity_type === "nce").length,
    };
  }, [masterDbRows]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <Button variant="ghost" size="sm" className="-ml-2 mb-2 text-xs gap-1" onClick={() => navigate("/settings")}>
            <ArrowLeft className="h-3 w-3" /> Back to Settings
          </Button>
          <h1 className="text-2xl font-display font-bold text-foreground">Chart of Accounts Mappings</h1>
          <p className="text-sm text-muted-foreground">Map Tally/Busy ledger names to standard Schedule III account heads. Entity-governed — COA adapts to client type automatically.</p>
        </div>
        {/* Global engagement / client selector */}
        {engagements.length > 0 && (
          <div className="flex flex-col items-end gap-1">
            <p className="text-xs text-muted-foreground">Active Client / Engagement</p>
            <Select value={selectedEngagement} onValueChange={setSelectedEngagement}>
              <SelectTrigger className="w-64 h-9 text-xs">
                <SelectValue placeholder="Select engagement" />
              </SelectTrigger>
              <SelectContent>
                {engagements.map(e => (
                  <SelectItem key={e.id} value={e.id} className="text-xs">
                    <span className="font-medium">{e.client_name || "—"}</span>
                    <span className="text-muted-foreground ml-2">FY {e.financial_year || "—"}</span>
                    {e.client_entity_type && (
                      <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{e.client_entity_type}</span>
                    )}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {clientEntityType && (
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-muted-foreground">Entity type:</span>
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-primary/10 text-primary">{clientEntityType}</span>
                {inferredClientCat && (
                  <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${COA_CATEGORY_CONFIG[inferredClientCat].badgeCls}`}>
                    → {COA_CATEGORY_CONFIG[inferredClientCat].label} COA
                  </span>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <Alert>
        <FolderTree className="h-4 w-4" />
        <AlertTitle className="text-sm">Hierarchy-Aware Mapping</AlertTitle>
        <AlertDescription className="text-xs">
          When you map a parent group (e.g. "Share Capital"), all child ledgers automatically appear nested under it.
          Only leaf-level amounts are aggregated — no double-counting of parent + child totals.
        </AlertDescription>
      </Alert>

      {/* Import from Tally */}
      <div className="flex items-center gap-3 p-3 bg-muted/40 border rounded-lg">
        <RefreshCw className="h-4 w-4 text-muted-foreground shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-foreground">Import Ledgers from Tally Sync</p>
          <p className="text-xs text-muted-foreground truncate">
            Pull all ledgers from the last Tally sync into unmapped list. Run Tally Sync first if ledgers are empty.
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="shrink-0"
          onClick={handleImportFromTally}
          disabled={importingFromTally || !selectedEngagement}
        >
          {importingFromTally
            ? <><RefreshCw className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Importing…</>
            : <><RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Import from Tally</>
          }
        </Button>
      </div>

      <Tabs defaultValue="master" className="space-y-4">
        <TabsList className="flex-wrap">
          <TabsTrigger value="master" className="gap-2">
            <Database className="h-3.5 w-3.5" /> COA Master
            {masterStats.total > 0 && <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{masterStats.total}</Badge>}
          </TabsTrigger>
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

        {/* COA Master Tab */}
        <TabsContent value="master">
          <Card>
            <CardHeader className="pb-3">
              {/* ── Entity Category Selector ── */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
                {(["corporate", "llp", "nce"] as const).map((cat) => {
                  const cfg = COA_CATEGORY_CONFIG[cat];
                  const Icon = cfg.icon;
                  const count = masterStats[cat];
                  const isActive = activeCOACat === cat;
                  const isClientCat = inferredClientCat === cat;
                  return (
                    <button
                      key={cat}
                      onClick={() => setMasterEntityFilter(cat)}
                      className={`relative flex items-start gap-3 p-3 rounded-xl border-2 text-left transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                        isActive
                          ? cfg.activeClass + " shadow-sm"
                          : "border-border hover:border-muted-foreground/40 hover:bg-muted/30"
                      }`}
                    >
                      <div className={`shrink-0 rounded-lg p-2 ${cfg.iconBg}`}>
                        <Icon className="h-4 w-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-sm font-semibold">{cfg.label}</span>
                          {count > 0 && (
                            <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${cfg.badgeCls}`}>
                              {count} heads
                            </span>
                          )}
                          {isClientCat && (
                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-primary text-primary-foreground animate-pulse">
                              Client
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug truncate">{cfg.description}</p>
                        <p className="text-[10px] text-muted-foreground/70 mt-0.5 italic">{cfg.subtitle}</p>
                      </div>
                      {isActive && (
                        <div className="absolute top-2 right-2">
                          <Check className="h-3.5 w-3.5 text-primary" />
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>

              <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Database className="h-4 w-4" />
                    {COA_CATEGORY_CONFIG[activeCOACat].label} COA Master
                    {inferredClientCat === activeCOACat && clientEntityType && (
                      <span className="text-[10px] font-normal text-muted-foreground ml-1">
                        — auto-selected for {clientEntityType} client
                      </span>
                    )}
                  </CardTitle>
                  <CardDescription>
                    {masterStats.total > 0
                      ? `${filteredMasterData.length} entries for ${COA_CATEGORY_CONFIG[activeCOACat].label} (${masterStats.total} total across all entity types)`
                      : "No master data loaded yet. Seed from template or import your own Excel."}
                  </CardDescription>
                </div>
                <div className="flex gap-2 flex-wrap">
                  <Button
                    variant="default"
                    size="sm"
                    className="gap-1"
                    onClick={handleSeedMaster}
                    disabled={seedingMaster}
                  >
                    {seedingMaster ? <Loader2 className="h-3 w-3 animate-spin" /> : <Database className="h-3 w-3" />}
                    {masterStats.total > 0 ? "Re-seed from Template" : "Seed from Template"}
                  </Button>
                  <Button variant="outline" size="sm" className="gap-1" onClick={() => masterFileRef.current?.click()} disabled={importingMaster}>
                    {importingMaster ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
                    Import Excel
                  </Button>
                  <input ref={masterFileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleImportMasterFile} />
                  {masterStats.total > 0 && (
                    <Button variant="outline" size="sm" className="gap-1" onClick={handleExportMaster}>
                      <Download className="h-3 w-3" /> Export {COA_CATEGORY_CONFIG[activeCOACat].label}
                    </Button>
                  )}
                  <a href="/templates/CAFlow_COA_Master_v2.xlsx" download>
                    <Button variant="ghost" size="sm" className="gap-1">
                      <FileSpreadsheet className="h-3 w-3" /> Download Template
                    </Button>
                  </a>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {filteredMasterData.length === 0 ? (
                <div className="text-center py-10 space-y-3">
                  {(() => { const Icon = COA_CATEGORY_CONFIG[activeCOACat].icon; return <Icon className="h-10 w-10 text-muted-foreground mx-auto" />; })()}
                  <p className="text-sm text-muted-foreground">No {COA_CATEGORY_CONFIG[activeCOACat].label} COA master data loaded.</p>
                  <p className="text-xs text-muted-foreground">Click "Seed from Template" to load the built-in CAFlow COA Master with 709 accounts across Corporate, LLP, and NCE.</p>
                </div>
              ) : (
                <div className="border rounded-lg overflow-auto max-h-[500px]">
                  <div className="flex items-center gap-2 py-2 px-2 bg-muted/50 text-[10px] font-semibold text-muted-foreground uppercase sticky top-0 z-10 border-b">
                    <div className="w-4" />
                    <span className="w-12">Code</span>
                    <span className="w-6 text-center">Lvl</span>
                    <span className="w-20">Major Group</span>
                    <span className="w-24">Group</span>
                    <span className="w-24">Sub-Group</span>
                    <span className="flex-1 min-w-[120px]">Account Head</span>
                    <span className="w-16">Acct Type</span>
                    <span className="w-10 text-center">Normal</span>
                    <span className="w-12 text-center">BS/PL</span>
                    <span className="w-36">FS Line Item</span>
                    <span className="w-10 text-center">Note</span>
                    <span className="w-20">Entities</span>
                    <span className="w-28">Tally Mapping</span>
                    <span className="w-24">Remarks</span>
                  </div>
                  {masterRootRows.map(row => (
                    <CoaMasterTreeNode key={`${row.account_code}-${row.entity_type}`} row={row} allRows={filteredMasterData} />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Hierarchy View */}
        <TabsContent value="hierarchy">
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                  <CardTitle className="text-sm">TB Hierarchy with Mapping Status</CardTitle>
                  <CardDescription>
                    {selectedEngagement
                      ? (() => {
                          const eng = engagements.find(e => e.id === selectedEngagement);
                          return eng
                            ? `${eng.client_name || "—"} · FY ${eng.financial_year || "—"} · ${eng.client_entity_type || "Entity type unknown"}`
                            : "Engagement selected";
                        })()
                      : "Select an engagement above to view hierarchy and mapping coverage."}
                  </CardDescription>
                </div>
                {inferredClientCat && (
                  <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium ${COA_CATEGORY_CONFIG[inferredClientCat].badgeCls}`}>
                    {(() => { const Icon = COA_CATEGORY_CONFIG[inferredClientCat].icon; return <Icon className="h-3.5 w-3.5" />; })()}
                    {COA_CATEGORY_CONFIG[inferredClientCat].label} Entity
                  </div>
                )}
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
                    <MappingTreeNode key={node.id} node={node} allNodes={hierarchyNodes} mappings={mappings} masterRows={masterDbRows} />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Mapped Summary */}
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

        {/* Unmapped */}
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

        {/* All Mappings */}
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
