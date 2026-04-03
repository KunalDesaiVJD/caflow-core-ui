import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import * as XLSX from "xlsx";
import {
  Upload, FileSpreadsheet, FileText, FileCode, Table2, CheckCircle2,
  AlertTriangle, ArrowRight, ArrowLeft, Loader2, Download, Eye,
  Flag, RefreshCw, X, ChevronDown, FileUp, ShieldCheck, FileWarning,
  CalendarDays, Sparkles, Link2, SkipForward, Check
} from "lucide-react";
import { buildTbPresentationModel, type TbPresentationModel, type TbSectionType } from "@/lib/tb-hierarchy";
import coaMasterDataJson from "@/data/coa-master-data.json";

// ─── Types ───
interface PipelineStage2Props {
  engagementId: string;
  engagement: any;
  onStageComplete: () => void;
  onSaveDraft: () => void;
}

type ImportFormat = "tally_xml" | "tally_excel" | "expert_software_excel" | "generic_excel" | "generic_csv" | "pdf";

interface FormatOption {
  value: ImportFormat;
  label: string;
  ext: string;
  icon: any;
  description: string;
}

const FORMAT_OPTIONS: FormatOption[] = [
  { value: "tally_xml", label: "Tally XML", ext: ".xml", icon: FileCode, description: "Tally Prime/ERP9 XML export" },
  { value: "tally_excel", label: "Tally Excel", ext: ".xlsx", icon: FileSpreadsheet, description: "Tally's standard Excel export" },
  { value: "expert_software_excel", label: "Expert Software", ext: ".xlsx", icon: Table2, description: "Expert Software Excel TB format" },
  { value: "generic_excel", label: "Generic Excel", ext: ".xlsx", icon: FileSpreadsheet, description: "Any Excel file — you map columns" },
  { value: "generic_csv", label: "Generic CSV", ext: ".csv", icon: FileText, description: "CSV file — you map columns" },
  { value: "pdf", label: "PDF TB", ext: ".pdf", icon: FileText, description: "Tally PDF export — text extraction" },
];

// Column mappings for known formats
const TALLY_EXCEL_FIELDS = [
  { key: "account_name", label: "Account Name", tallyCol: "Particulars" },
  { key: "opening_balance", label: "Opening Balance", tallyCol: "Opening Balance" },
  { key: "debit", label: "Debit", tallyCol: "Debit" },
  { key: "credit", label: "Credit", tallyCol: "Credit" },
  { key: "closing_balance", label: "Closing Balance", tallyCol: "Closing Balance" },
];

const EXPERT_FIELDS = [
  { key: "account_code", label: "Account Code" },
  { key: "account_name", label: "Account Name" },
  { key: "account_group", label: "Group" },
  { key: "opening_dr", label: "Opening Dr" },
  { key: "opening_cr", label: "Opening Cr" },
  { key: "transaction_dr", label: "Transaction Dr" },
  { key: "transaction_cr", label: "Transaction Cr" },
  { key: "closing_dr", label: "Closing Dr" },
  { key: "closing_cr", label: "Closing Cr" },
];

const GENERIC_TARGET_FIELDS = [
  { key: "account_name", label: "Account Name", required: true },
  { key: "debit_total", label: "Debit Total", required: true },
  { key: "credit_total", label: "Credit Total", required: true },
  { key: "opening_balance", label: "Opening Balance", required: false },
  { key: "account_group", label: "Account Group", required: false },
];

const FUZZY_MAP: Record<string, string[]> = {
  account_name: ["particulars", "ledger", "account", "name", "ledgername", "accountname"],
  debit_total: ["debit", "dr", "closingdr", "closedr", "totaldr"],
  credit_total: ["credit", "cr", "closingcr", "closecr", "totalcr"],
  opening_balance: ["opening", "openbal", "openingbalance", "opbal"],
  account_group: ["group", "head", "category", "under", "accountgroup"],
};

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function autoDetectMapping(headers: string[]): Record<string, string> {
  const mapping: Record<string, string> = {};
  for (const field of GENERIC_TARGET_FIELDS) {
    const keywords = FUZZY_MAP[field.key] || [];
    for (const header of headers) {
      const norm = normalize(header);
      if (keywords.some(k => norm.includes(k) || k.includes(norm))) {
        if (!Object.values(mapping).includes(header)) {
          mapping[field.key] = header;
          break;
        }
      }
    }
  }
  return mapping;
}

// ─── Ledger Import Fields ───
const LEDGER_TARGET_FIELDS = [
  { key: "date", label: "Date", required: true },
  { key: "voucher_type", label: "Voucher Type", required: false },
  { key: "voucher_no", label: "Voucher No", required: false },
  { key: "narration", label: "Narration", required: false },
  { key: "debit", label: "Debit", required: true },
  { key: "credit", label: "Credit", required: true },
  { key: "account_name", label: "Account Name", required: false },
];

const LEDGER_FUZZY: Record<string, string[]> = {
  date: ["date", "txndate", "transactiondate", "voucherdate"],
  voucher_type: ["vouchertype", "type", "vchtype"],
  voucher_no: ["voucherno", "vchno", "docno", "refno"],
  narration: ["narration", "description", "remarks", "particulars"],
  debit: ["debit", "dr"],
  credit: ["credit", "cr"],
  account_name: ["account", "ledger", "name", "particulars"],
};

function autoDetectLedgerMapping(headers: string[]): Record<string, string> {
  const mapping: Record<string, string> = {};
  for (const field of LEDGER_TARGET_FIELDS) {
    const keywords = LEDGER_FUZZY[field.key] || [];
    for (const header of headers) {
      const norm = normalize(header);
      if (keywords.some(k => norm.includes(k) || k.includes(norm))) {
        if (!Object.values(mapping).includes(header)) {
          mapping[field.key] = header;
          break;
        }
      }
    }
  }
  return mapping;
}

interface TbHierarchyNode {
  nodeId: string;
  parentNodeId: string | null;
  name: string;
  level: number;
  isLeaf: boolean;
  opening: number;
  txnDebit: number;
  txnCredit: number;
  closing: number;
  primaryGroup: string;
  bsPlSide: string;
  normalBal?: string | null;
  rowNumber?: number | null;
}

interface ValidationResult {
  isBalanced: boolean;
  drTotal: number;
  crTotal: number;
  difference: number;
  duplicateNames: string[];
  groupMismatches: any[];
  unclassifiedLeaves: number;
  bsAssets: number;
  bsLiabilities: number;
  grandTotalDetected: boolean;
  primaryGroups: string[];
  primaryGroupCount: number;
  onlyGroupsCollapsible?: boolean;
  groupTotalsTallied?: boolean;
  unclassifiedNodes?: number;
  allRulesPassed?: boolean;
}

// ─── COA Mapping Row ───
interface CoaMappingRow {
  ledger: string;
  tallyGroup: string;
  closing: number;
  bsPlSide: string;
  suggestedHead: string;
  suggestedGroup: string;
  suggestedBsPl: string;
  confidence: "high" | "medium" | "low" | "";
  reason: string;
  accepted: boolean;
  skipped: boolean;
  customHead: string;
  customGroup: string;
  customBsPl: string;
  alreadyMapped?: boolean;
}

// ─── Entity type → COA category ───
const ENTITY_TO_COA_CAT: Record<string, string> = {
  "Private Ltd": "corporate", "Public Ltd": "corporate",
  "LLP": "llp",
  "Proprietorship": "nce", "Partnership": "nce", "HUF": "nce", "Trust": "nce", "AOP": "nce", "BOI": "nce",
};

// ─── Chunk size for large file uploads (1.5MB base64 per chunk) ───
const CHUNK_SIZE_BYTES = 1.5 * 1024 * 1024;

function sumDisplayedNode(nodeId: string, allNodes: TbHierarchyNode[]): { opening: number; txnDebit: number; txnCredit: number; closing: number } {
  const children = allNodes.filter((n) => n.parentNodeId === nodeId);
  if (children.length === 0) {
    const self = allNodes.find((n) => n.nodeId === nodeId);
    return {
      opening: self?.opening || 0,
      txnDebit: self?.txnDebit || 0,
      txnCredit: self?.txnCredit || 0,
      closing: self?.closing || 0,
    };
  }

  return children.reduce((acc, child) => {
    const childTotals = child.isLeaf
      ? { opening: child.opening || 0, txnDebit: child.txnDebit || 0, txnCredit: child.txnCredit || 0, closing: child.closing || 0 }
      : sumDisplayedNode(child.nodeId, allNodes);
    return {
      opening: acc.opening + childTotals.opening,
      txnDebit: acc.txnDebit + childTotals.txnDebit,
      txnCredit: acc.txnCredit + childTotals.txnCredit,
      closing: acc.closing + childTotals.closing,
    };
  }, { opening: 0, txnDebit: 0, txnCredit: 0, closing: 0 });
}
function fmtTb(v: number): string {
  if (!v && v !== 0) return '—';
  return v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function TbTreeRow({ node, allNodes, depth = 0 }:
  { node: TbHierarchyNode; allNodes: TbHierarchyNode[]; depth?: number }) {

  const [open, setOpen] = useState(depth < 1);
  const children = allNodes.filter(n => n.parentNodeId === node.nodeId);
  const hasChildren = children.length > 0;

  const vals = node.isLeaf
    ? { opening: node.opening || 0, txnDebit: node.txnDebit || 0, txnCredit: node.txnCredit || 0, closing: node.closing || 0 }
    : sumDisplayedNode(node.nodeId, allNodes);

  const indent = depth * 24 + 12;

  return (
    <div>
      <div
        className={cn(
          'flex w-full items-center border-b border-border/30 py-1.5 text-xs hover:bg-muted/30',
          !node.isLeaf && 'bg-muted/10 font-semibold',
        )}
        style={{ paddingLeft: `${indent}px` }}
      >
        {/* +/- expand/collapse button */}
        <button
          type='button'
          onClick={() => hasChildren && setOpen(p => !p)}
          className={cn(
            'mr-2 flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px] font-bold leading-none',
            hasChildren
              ? 'cursor-pointer border-border bg-background text-foreground hover:bg-primary hover:text-primary-foreground'
              : 'invisible',
          )}
        >
          {open ? '−' : '+'}
        </button>

        {/* Account / Group name */}
        <span className={cn(
          'flex-1 truncate pr-2',
          !node.isLeaf ? 'text-foreground' : 'text-foreground/80 font-normal',
        )}>
          {node.name}
        </span>

        {/* 4 numeric columns: Opening Bal | Txn Dr | Txn Cr | Closing Bal */}
        <span className={cn('w-32 shrink-0 text-right tabular-nums font-mono text-[11px] pr-3',
          !node.isLeaf ? 'font-semibold' : 'text-muted-foreground')}>
          {fmtTb(vals.opening)}
        </span>
        <span className={cn('w-32 shrink-0 text-right tabular-nums font-mono text-[11px] pr-3',
          !node.isLeaf ? 'font-semibold' : 'text-muted-foreground')}>
          {fmtTb(vals.txnDebit)}
        </span>
        <span className={cn('w-32 shrink-0 text-right tabular-nums font-mono text-[11px] pr-3',
          !node.isLeaf ? 'font-semibold' : 'text-muted-foreground')}>
          {fmtTb(vals.txnCredit)}
        </span>
        <span className={cn('w-32 shrink-0 text-right tabular-nums font-mono text-[11px] pr-3 font-medium',
          !node.isLeaf ? 'font-semibold text-foreground' : 'text-foreground')}>
          {fmtTb(vals.closing)}
        </span>
      </div>

      {/* Render children when expanded */}
      {open && hasChildren && children.map(child => (
        <TbTreeRow
          key={child.nodeId}
          node={child}
          allNodes={allNodes}
          depth={depth + 1}
        />
      ))}
    </div>
  );
}

// ─── Prior Period TB: full-column comparison builder ───
function buildComparativeResultFromLeaves(
  priorLeaves: any[],
  currentLeaves: any[],
  priorFY: string,
) {
  const priorMap = new Map<string, any>();
  for (const n of priorLeaves) priorMap.set(String(n.name).toLowerCase().trim(), n);

  const verificationRows: any[] = [];
  let matched = 0, mismatched = 0;

  for (const cur of currentLeaves) {
    const key   = (cur.name || "").toLowerCase().trim();
    const prior = priorMap.get(key);
    if (!prior) continue;

    const pyClosing  = prior.closing  || 0;
    const cyOpening  = cur.opening    || 0;
    const openingVar = cyOpening - pyClosing;
    const closingVar = (cur.closing   || 0) - pyClosing;
    const isMismatch = Math.abs(openingVar) >= 1;
    // significant = opening variance > 10 % of prior closing OR > ₹ 10,000
    const significantVar = Math.abs(openingVar) > Math.max(Math.abs(pyClosing) * 0.1, 10000);

    if (isMismatch) mismatched++; else matched++;

    verificationRows.push({
      name:        cur.name,
      group:       cur.primaryGroup  || prior.primaryGroup  || "",
      bsPlSide:    cur.bsPlSide      || prior.bsPlSide      || "",
      pyOpening:   prior.opening     || 0,
      pyTxnDebit:  prior.txnDebit    || 0,
      pyTxnCredit: prior.txnCredit   || 0,
      pyClosing,
      cyOpening,
      cyTxnDebit:  cur.txnDebit      || 0,
      cyTxnCredit: cur.txnCredit     || 0,
      cyClosing:   cur.closing       || 0,
      openingVar,
      closingVar,
      isMismatch,
      significantVar,
    });
  }

  verificationRows.sort((a, b) => Math.abs(b.openingVar) - Math.abs(a.openingVar));
  return { verificationRows, matched, mismatched, total: matched + mismatched, priorFY };
}

// ═══════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════
export default function PipelineStage2({ engagementId, engagement, onStageComplete, onSaveDraft }: PipelineStage2Props) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<"tb" | "ledger">("tb");

  // ─── TB Import State ───
  const [tbStep, setTbStep] = useState(1);
  const [tbFormat, setTbFormat] = useState<ImportFormat | "">("");
  const [tbFile, setTbFile] = useState<File | null>(null);
  const [tbParsedData, setTbParsedData] = useState<any[][]>([]);
  const [tbHeaders, setTbHeaders] = useState<string[]>([]);
  const [tbMapping, setTbMapping] = useState<Record<string, string>>({});
  const [tbProcessing, setTbProcessing] = useState(false);
  const [tbProgress, setTbProgress] = useState(0);
  const [tbProgressLabel, setTbProgressLabel] = useState("");
  const [tbResult, setTbResult] = useState<{
    totalAccounts: number; debitTotal: number; creditTotal: number;
    difference: number; isValid: boolean; preview: any[];
  } | null>(null);
  const [tbValidation, setTbValidation] = useState<ValidationResult | null>(null);
  const [tbHierarchyNodes, setTbHierarchyNodes] = useState<TbHierarchyNode[]>([]);
  const [tbViewMode, setTbViewMode] = useState<"tree" | "flat">("tree");
  const [tbOverrideJustification, setTbOverrideJustification] = useState("");
  const [tbShowOverride, setTbShowOverride] = useState(false);
  const tbFileRef = useRef<HTMLInputElement>(null);

  // ─── Ledger Import State ───
  const [ledgerFiles, setLedgerFiles] = useState<File[]>([]);
  const [ledgerParsedData, setLedgerParsedData] = useState<any[][]>([]);
  const [ledgerHeaders, setLedgerHeaders] = useState<string[]>([]);
  const [ledgerMapping, setLedgerMapping] = useState<Record<string, string>>({});
  const [ledgerProcessing, setLedgerProcessing] = useState(false);
  const [ledgerProgress, setLedgerProgress] = useState(0);
  const [ledgerResult, setLedgerResult] = useState<{
    totalTransactions: number; accountCount: number; dateRange: string; flaggedCount: number;
  } | null>(null);
  const [ledgerStep, setLedgerStep] = useState(1);
  const [showFlagged, setShowFlagged] = useState(false);
  const ledgerFileRef = useRef<HTMLInputElement>(null);

  // ─── Comparative TB State ───
  const [showComparativeTb, setShowComparativeTb] = useState(false);
  const [comparativeFile, setComparativeFile] = useState<File | null>(null);
  const [comparativeResult, setComparativeResult] = useState<any>(null);
  const [comparativeProcessing, setComparativeProcessing] = useState(false);
  const comparativeFileRef = useRef<HTMLInputElement>(null);
  const [deletingPriorTb, setDeletingPriorTb] = useState(false);
  const [showDeletePriorConfirm, setShowDeletePriorConfirm] = useState(false);
  const [deletingTb, setDeletingTb] = useState(false);
  const [tbStatusMsg, setTbStatusMsg] = useState('');
  const [aiClassifying, setAiClassifying] = useState(false);

  // ─── AI Pre-Analysis State ───
  const [tbAiPreAnalysis, setTbAiPreAnalysis] = useState<{
    score: number; status: string; summary: string;
    issues: { severity: string; category: string; title: string; description: string; affected: string[] }[];
    insights: { title: string; finding: string }[];
    suggestions: string[];
  } | null>(null);
  const [tbAiAnalysing, setTbAiAnalysing] = useState(false);

  // ─── TB File Storage & Verification State ───
  const [tbStoragePath, setTbStoragePath] = useState<string | null>(null);
  const [tbTotalsVerification, setTbTotalsVerification] = useState<{
    leafCount: number; drTotal: number; crTotal: number;
    sectionTotals: { key: string; label: string; closing: number }[];
    isBalanced: boolean; discrepancy: number;
  } | null>(null);

  // ─── COA Mapping State ───
  const [coaMappingRows, setCoaMappingRows] = useState<CoaMappingRow[]>([]);
  const [coaMappingLoading, setCoaMappingLoading] = useState(false);
  const [coaMappingSaving, setCoaMappingSaving] = useState(false);
  const [coaMappingDone, setCoaMappingDone] = useState(false);
  // Maps root-group name → "section|||displayGroupName" (e.g. "bs_asset|||Bank Accounts")
  // or just "section" for AI-suggested results. Section key extracted on apply.
  const [tbManualClassifications, setTbManualClassifications] = useState<Record<string, string>>({});
  const [aiClassifyingUnclassified, setAiClassifyingUnclassified] = useState(false);
  const [applyingManualClassify, setApplyingManualClassify] = useState(false);

  // ─── Existing TB snapshot ───
  // Fetch existing TB snapshots — Tally import creates N rows (one per ledger),
  // generic import creates 1 row with normalised_data JSON.
  const { data: existingTb } = useQuery({
    queryKey: ["tb-snapshot-for-engagement", engagementId],
    queryFn: async () => {
      const { data } = await supabase
        .from("trial_balance_snapshots")
        .select("id, debit_total, credit_total, difference, validation_status, is_validated, normalised_data, ledger_name, txn_debit, txn_credit, primary_group, opening_balance, closing_balance, bs_pl_side")
        .eq("engagement_id", engagementId)
        .order("id", { ascending: true })
        .limit(500);
      const rows = (data || []) as any[];
      if (rows.length === 0) return null;
      // Check if this is a single-row generic import (has normalised_data JSON)
      if (rows.length === 1 && rows[0].normalised_data && Array.isArray(rows[0].normalised_data)) {
        return rows[0]; // Single snapshot row with JSON data
      }
      // Multiple rows = Tally import (one row per ledger) — synthesize a summary
      const totalDr = rows.reduce((s: number, r: any) => s + (r.txn_debit || 0), 0);
      const totalCr = rows.reduce((s: number, r: any) => s + (r.txn_credit || 0), 0);
      return {
        id: rows[0].id,
        debit_total: totalDr,
        credit_total: totalCr,
        difference: Math.abs(totalDr - totalCr),
        validation_status: Math.abs(totalDr - totalCr) < 1 ? "valid" : "invalid",
        is_validated: Math.abs(totalDr - totalCr) < 1,
        normalised_data: rows.map((r: any) => ({
          account_name: r.ledger_name,
          debit: r.txn_debit || 0,
          credit: r.txn_credit || 0,
          opening_balance: r.opening_balance || 0,
          closing_balance: r.closing_balance || 0,
          account_group: r.primary_group || "",
          bs_pl_side: r.bs_pl_side || "",
        })),
        _isSynthesized: true,
      };
    },
    enabled: !!engagementId,
  });

  const { data: storedTbHierarchy = [] } = useQuery({
    queryKey: ["tb-hierarchy-nodes", engagementId],
    queryFn: async (): Promise<TbHierarchyNode[]> => {
      const { data, error } = await supabase
        .from("tb_hierarchy_nodes")
        .select("node_id, parent_node_id, tally_group_name, level, is_leaf, opening_balance, txn_debit, txn_credit, closing_balance, primary_group, bs_pl_side, normal_balance, row_number")
        .eq("engagement_id", engagementId)
        .order("row_number", { ascending: true });

      if (error) throw error;

      // ── Pass 1: map raw DB values without sign correction yet ──────────────
      const rawNodes = (data || []).map((row: any) => ({
        nodeId: row.node_id as string,
        parentNodeId: (row.parent_node_id ?? null) as string | null,
        name: row.tally_group_name as string,
        level: (row.level || 1) as number,
        isLeaf: !!row.is_leaf,
        opening: (row.opening_balance || 0) as number,
        txnDebit: (row.txn_debit || 0) as number,
        txnCredit: (row.txn_credit || 0) as number,
        closing: (row.closing_balance || 0) as number,
        primaryGroup: (row.primary_group || row.tally_group_name) as string,
        bsPlSide: (row.bs_pl_side || 'Unknown') as string,
        normalBal: (row.normal_balance || null) as string | null,
        rowNumber: (row.row_number || null) as number | null,
      }));

      // ── Pass 2: build parent-lookup maps for normalBal inheritance ──────────
      // Leaf nodes (e.g. truck vehicle accounts) often have normalBal = null/Unknown.
      // Walk up the parent chain to inherit the nearest ancestor's known normalBal.
      const parentMap = new Map<string, string | null>(rawNodes.map(n => [n.nodeId, n.parentNodeId]));
      const nbMap     = new Map<string, string | null>(rawNodes.map(n => [n.nodeId, n.normalBal]));

      function resolveNb(nodeId: string | null, depth = 0): string | null {
        if (!nodeId || depth > 15) return null;
        const nb = nbMap.get(nodeId);
        if (nb && nb !== 'Unknown') return nb;
        return resolveNb(parentMap.get(nodeId) ?? null, depth + 1);
      }

      // ── Pass 3: apply sign correction using resolved normalBal ──────────────
      // Tally's Excel export convention:
      //   - Some Dr-normal accounts (e.g. Fixed Assets) export opening/closing as NEGATIVE
      //     (Tally shows them on the "Cr" side internally → parseNum returns negative)
      //   - Other Dr-normal accounts (e.g. Current Assets: cash, bank) export as POSITIVE
      // Rule: only flip when the stored value is NEGATIVE for a Dr account.
      //       This safely corrects Fixed Assets leaves without breaking Current Assets.
      // txnDebit / txnCredit are always stored as positive — never flip those.
      return rawNodes.map(node => {
        const resolvedNb = resolveNb(node.nodeId);
        const flipO = resolvedNb === 'Dr' && node.opening < 0;
        const flipC = resolvedNb === 'Dr' && node.closing < 0;
        return {
          ...node,
          opening: flipO ? -node.opening : node.opening,
          closing: flipC ? -node.closing : node.closing,
        };
      });
    },
    enabled: !!engagementId,
  });

  // ─── Flagged transactions ───
  const { data: flaggedTransactions } = useQuery({
    queryKey: ["flagged-transactions", engagementId],
    queryFn: async () => {
      const { data } = await supabase
        .from("ledger_transactions")
        .select("*")
        .eq("engagement_id", engagementId)
        .eq("scrutiny_flag", true)
        .order("date")
        .limit(200);
      return data || [];
    },
    enabled: !!engagementId && showFlagged,
  });

  // ─── Stored Prior Period TB nodes ───
  const { data: storedPriorTbNodes = [], refetch: refetchPriorTb } = useQuery({
    queryKey: ["prior-tb-hierarchy-nodes", engagementId],
    queryFn: async () => {
      const { data } = await supabase
        .from("tb_hierarchy_nodes")
        .select("tally_group_name, opening_balance, txn_debit, txn_credit, closing_balance, primary_group, bs_pl_side")
        .eq("engagement_id", `${engagementId}_prior`)
        .eq("is_leaf", true)
        .order("tally_group_name");
      return (data || []).map((row: any) => ({
        name:        row.tally_group_name  as string,
        opening:     (row.opening_balance  || 0) as number,
        txnDebit:    (row.txn_debit        || 0) as number,
        txnCredit:   (row.txn_credit       || 0) as number,
        closing:     (row.closing_balance  || 0) as number,
        primaryGroup:(row.primary_group    || "") as string,
        bsPlSide:    (row.bs_pl_side       || "") as string,
      }));
    },
    enabled: !!engagementId,
  });

  // ─── Ledger import batches ───
  const { data: ledgerBatches } = useQuery({
    queryKey: ["ledger-batches", engagementId],
    queryFn: async () => {
      const { data } = await supabase
        .from("ledger_import_batches")
        .select("*")
        .eq("engagement_id", engagementId)
        .order("imported_at", { ascending: false });
      return data || [];
    },
    enabled: !!engagementId,
  });

  // Load existing TB result if available
  const tbPresentation: TbPresentationModel | null = useMemo(() => {
    const source = tbHierarchyNodes.length > 0 ? tbHierarchyNodes : storedTbHierarchy;
    return source.length > 0 ? buildTbPresentationModel(source) : null;
  }, [tbHierarchyNodes, storedTbHierarchy]);

  useEffect(() => {
    if (tbPresentation) {
      const leafRows = tbPresentation.activeNodes.filter((row) => row.isLeaf);
      setTbValidation(tbPresentation.validation as any);
      setTbResult((prev) => prev || {
        totalAccounts: leafRows.length,
        debitTotal: Math.round(tbPresentation.grandTotal.txnDebit * 100) / 100,
        creditTotal: Math.round(tbPresentation.grandTotal.txnCredit * 100) / 100,
        difference: Math.round(Math.abs(tbPresentation.grandTotal.txnDebit - tbPresentation.grandTotal.txnCredit) * 100) / 100,
        isValid: tbPresentation.validation.allRulesPassed,
        preview: leafRows.slice(0, 20).map((row) => ({
          account_name: row.name,
          account_group: row.primaryGroup,
          debit: row.txnDebit,
          credit: row.txnCredit,
        })),
      });
      setTbStep((prev) => (prev < 5 ? 5 : prev));
      return;
    }

    if (existingTb) {
      const tb = existingTb as any;
      // Use prev || ... so we don't overwrite a richer tbResult already set from hierarchy nodes
      setTbResult((prev) => prev || {
        totalAccounts: (tb.normalised_data as any[])?.length || 0,
        debitTotal: tb.debit_total || 0,
        creditTotal: tb.credit_total || 0,
        difference: tb.difference || 0,
        isValid: tb.validation_status === "valid" || !!tb.is_validated,
        preview: ((tb.normalised_data as any[]) || []).slice(0, 20),
      });
      setTbStep(5);
    }
  }, [existingTb, tbPresentation]);

  // ─── Auto-rebuild comparative result from stored prior TB on load ───
  useEffect(() => {
    if (!storedPriorTbNodes || storedPriorTbNodes.length === 0) return;
    const currentLeaves = (tbHierarchyNodes.length > 0 ? tbHierarchyNodes : storedTbHierarchy).filter(n => n.isLeaf);
    if (currentLeaves.length === 0) return;
    const fy = engagement?.financial_year || "2024-25";
    const [startY, endY] = fy.split("-");
    const priorFY = `${parseInt(startY) - 1}-${(parseInt(endY) - 1).toString().padStart(2, "0")}`;
    setComparativeResult(buildComparativeResultFromLeaves(storedPriorTbNodes, currentLeaves, priorFY));
  }, [storedPriorTbNodes, tbHierarchyNodes, storedTbHierarchy]);

  // ─── Replace confirmation state ───
  const [showReplaceDialog, setShowReplaceDialog] = useState(false);
  const [tbFileBase64, setTbFileBase64] = useState("");

  // Check if Tally format that should go through edge function
  const isTallyFormat = tbFormat === "tally_excel" || tbFormat === "tally_xml" || tbFormat === "pdf";

  // ═══════ TB IMPORT LOGIC ═══════

  const needsColumnMapping = tbFormat === "generic_excel" || tbFormat === "generic_csv";

  // ─── Convert ArrayBuffer to base64 ───
  function arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  }

  const handleTbFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setTbFile(file);

    const reader = new FileReader();
    reader.onload = (evt) => {
      const data = evt.target?.result;
      try {
        if (tbFormat === "pdf") {
          // For PDF, store as base64 for now — will extract text client-side
          const base64 = arrayBufferToBase64(data as ArrayBuffer);
          setTbFileBase64(base64);
          setTbStep(4);
        } else if (isTallyFormat) {
          // For Tally formats, store base64 for edge function
          const base64 = arrayBufferToBase64(data as ArrayBuffer);
          setTbFileBase64(base64);
          if (tbFormat === "tally_xml") {
            // XML cannot be parsed by XLSX — skip local preview, edge function handles it
            setTbParsedData([]);
          } else {
            // Excel — parse locally for row count preview
            const wb = XLSX.read(data, { type: "array" });
            const ws = wb.Sheets[wb.SheetNames[0]];
            const jsonData: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1 });
            setTbParsedData(jsonData);
          }
          setTbStep(4); // Go directly to process step
        } else {
          const wb = XLSX.read(data, { type: "array" });
          const ws = wb.Sheets[wb.SheetNames[0]];
          const jsonData: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1 });
          setTbParsedData(jsonData);

          if (jsonData.length > 0) {
            const headerRow = jsonData[0].map((h: any) => String(h || "").trim()).filter(Boolean);
            setTbHeaders(headerRow);

            if (tbFormat === "generic_excel" || tbFormat === "generic_csv") {
              setTbMapping(autoDetectMapping(headerRow));
            }
          }
          setTbStep(needsColumnMapping ? 3 : 4);
        }
      } catch (err) {
        toast.error("Failed to parse file");
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const parseTbRows = useCallback(() => {
    if (tbParsedData.length < 2) return [];
    const headerRow = tbParsedData[0].map((h: any) => String(h || "").trim());

    const parseNum = (v: any) => {
      if (v == null || v === "") return 0;
      let s = String(v).trim();
      const isNeg = s.startsWith("(") && s.endsWith(")");
      if (isNeg) s = s.slice(1, -1);
      s = s.replace(/,/g, "").replace(/Cr|Dr/gi, "").trim();
      const n = parseFloat(s) || 0;
      return isNeg ? -n : n;
    };

    if (tbFormat === "expert_software_excel") {
      const codeIdx = headerRow.findIndex(h => normalize(h).includes("code"));
      const nameIdx = headerRow.findIndex(h => normalize(h).includes("name") || normalize(h).includes("account"));
      const groupIdx = headerRow.findIndex(h => normalize(h).includes("group"));
      const clDrIdx = headerRow.findIndex(h => normalize(h).includes("closingdr") || normalize(h).includes("closedr"));
      const clCrIdx = headerRow.findIndex(h => normalize(h).includes("closingcr") || normalize(h).includes("closecr"));

      return tbParsedData.slice(1).filter(row => row[nameIdx >= 0 ? nameIdx : 0]).map(row => ({
        account_name: String(row[nameIdx >= 0 ? nameIdx : 0] || "").trim(),
        account_group: groupIdx >= 0 ? String(row[groupIdx] || "").trim() : "",
        debit: parseNum(row[clDrIdx >= 0 ? clDrIdx : 0]),
        credit: parseNum(row[clCrIdx >= 0 ? clCrIdx : 0]),
      }));
    }

    // Generic — use mapping
    const colIdx = (key: string) => {
      const header = tbMapping[key];
      return header ? headerRow.indexOf(header) : -1;
    };

    return tbParsedData.slice(1)
      .filter(row => {
        const nameI = colIdx("account_name");
        return nameI >= 0 && row[nameI] && String(row[nameI]).trim() !== "";
      })
      .map(row => ({
        account_name: String(row[colIdx("account_name")] || "").trim(),
        account_group: colIdx("account_group") >= 0 ? String(row[colIdx("account_group")] || "").trim() : "",
        debit: parseNum(row[colIdx("debit_total")]),
        credit: parseNum(row[colIdx("credit_total")]),
        opening_balance: parseNum(row[colIdx("opening_balance")]),
      }));
  }, [tbParsedData, tbFormat, tbMapping]);

  // ─── Chunked upload helper ───
  async function sendChunked(base64: string, engId: string, firmId: string | null, fileName: string, financialYear: string): Promise<any> {
    const totalLength = base64.length;
    // Each chunk is ~1.5MB of base64 text
    const chunkCharSize = Math.floor(CHUNK_SIZE_BYTES * 1.33); // base64 is ~33% larger
    const totalChunks = Math.ceil(totalLength / chunkCharSize);
    const uploadSessionId = crypto.randomUUID();

    if (totalChunks <= 1) {
      // Small file — send directly
      const { data, error } = await supabase.functions.invoke("parse-tally-tb", {
        body: {
          engagementId: engId,
          firmId,
          fileBase64: base64,
          fileName,
          financialYear,
        },
      });
      if (error) throw new Error(error.message || "Edge function error");
      if (!data?.success) throw new Error(data?.error || "Parse failed");
      return data;
    }

    // Large file — send in chunks
    for (let i = 0; i < totalChunks; i++) {
      const start = i * chunkCharSize;
      const end = Math.min(start + chunkCharSize, totalLength);
      const chunkData = base64.slice(start, end);
      const isLast = i === totalChunks - 1;

      setTbProgressLabel(`Uploading chunk ${i + 1}/${totalChunks}...`);
      setTbProgress(10 + (i / totalChunks) * 50);

      const { data, error } = await supabase.functions.invoke("parse-tally-tb", {
        body: {
          engagementId: engId,
          firmId,
          chunkBase64: chunkData,
          chunkIndex: i,
          totalChunks,
          uploadSessionId,
          isLastChunk: isLast,
          fileName,
          financialYear,
        },
      });

      if (error) throw new Error(error.message || "Chunk upload error");

      if (isLast) {
        // Last chunk returns the full parse result
        if (!data?.success) throw new Error(data?.error || "Parse failed");
        return data;
      }
    }
    throw new Error("Chunked upload completed without final response");
  }

  const handleTbProcess = async () => {
    // Check for existing TB — show replace dialog
    if (existingTb && !showReplaceDialog) {
      setShowReplaceDialog(true);
      return;
    }
    setShowReplaceDialog(false);

    setTbProcessing(true);
    setTbProgress(10);
    setTbProgressLabel("Starting...");

    try {
      if (isTallyFormat) {
        // ── Stage 1: Encoding file ──────────────────────────────
        setTbStatusMsg('Encoding file for upload...');
        setTbProgress(10);

        // ── Stage 2: Uploading to server ────────────────────────
        setTbStatusMsg('Uploading to server...');
        setTbProgress(18);

        // Start a simulated progress ticker so the bar never freezes.
        // It advances from 20% to 82% over ~45 seconds while the Edge
        // Function processes the file server-side.
        let simProgress = 20;
        const progressMessages = [
          { pct: 20, msg: 'Parsing Excel file on server...' },
          { pct: 35, msg: 'Detecting column headers and format...' },
          { pct: 48, msg: 'Building account hierarchy...' },
          { pct: 60, msg: 'Detecting group vs ledger rows...' },
          { pct: 70, msg: 'Aggregating group totals...' },
          { pct: 78, msg: 'Saving to database...' },
          { pct: 82, msg: 'Tagging ledgers with scrutiny rules...' },
        ];
        const ticker = setInterval(() => {
          simProgress = Math.min(simProgress + 1, 82);
          setTbProgress(simProgress);
          const stage = progressMessages.filter(m => m.pct <= simProgress).pop();
          if (stage) setTbStatusMsg(stage.msg);
        }, 600); // advance 1% every 600ms (~48 seconds to reach 82%)

        let data: any;

        try {
          if (tbFormat === "pdf") {
            // PDF: extract text lines client-side (simple approach — split by newlines)
            setTbStatusMsg("Extracting PDF text...");
            // Decode base64 to text lines (basic approach)
            const binaryStr = atob(tbFileBase64);
            const textLines: string[] = [];
            let currentLine = "";
            for (let i = 0; i < binaryStr.length; i++) {
              const code = binaryStr.charCodeAt(i);
              if (code >= 32 && code <= 126) {
                currentLine += binaryStr[i];
              } else if (currentLine.length > 3) {
                textLines.push(currentLine.trim());
                currentLine = "";
              } else {
                currentLine = "";
              }
            }
            if (currentLine.length > 3) textLines.push(currentLine.trim());

            const tbLines = textLines.filter(line => {
              const hasNumber = /\d/.test(line);
              const hasText = /[a-zA-Z]/.test(line);
              return hasText && hasNumber && line.length > 5;
            });

            const { data: pdfData, error: pdfError } = await supabase.functions.invoke("parse-tally-tb", {
              body: {
                engagementId,
                firmId: user?.firm_id || null,
                pdfTextRows: tbLines,
                fileName: tbFile?.name,
                financialYear: engagement.financial_year,
              },
            });
            if (pdfError) throw new Error(pdfError.message || "PDF parse error");
            if (!pdfData?.success) throw new Error(pdfData?.error || "PDF parse failed");
            data = pdfData;
          } else {
            // Excel/XML — use chunked upload
            data = await sendChunked(
              tbFileBase64,
              engagementId,
              user?.firm_id || null,
              tbFile?.name || "file.xlsx",
              engagement.financial_year
            );
          }
        } finally {
          clearInterval(ticker);
        }

        setTbStatusMsg('Import complete!');
        setTbProgress(100);

        // ── Pass 1: map edge-function response without sign correction ────────
        const _rawImport = ((data.hierarchy || []) as any[]).map((row: any) => ({
          nodeId: row.nodeId as string,
          parentNodeId: (row.parentNodeId ?? null) as string | null,
          name: row.name as string,
          level: (row.level || 1) as number,
          isLeaf: !!row.isLeaf,
          opening: (row.opening || 0) as number,
          txnDebit: (row.txnDebit || 0) as number,
          txnCredit: (row.txnCredit || 0) as number,
          closing: (row.closing || 0) as number,
          primaryGroup: (row.primaryGroup || row.name) as string,
          bsPlSide: (row.bsPlSide || 'Unknown') as string,
          normalBal: (row.normalBal || null) as string | null,
          rowNumber: (row.rowNumber || null) as number | null,
        }));

        // ── Pass 2: build parent-lookup maps for normalBal inheritance ────────
        const _impParentMap = new Map<string, string | null>(_rawImport.map(n => [n.nodeId, n.parentNodeId]));
        const _impNbMap     = new Map<string, string | null>(_rawImport.map(n => [n.nodeId, n.normalBal]));
        function _resolveImpNb(nodeId: string | null, depth = 0): string | null {
          if (!nodeId || depth > 15) return null;
          const nb = _impNbMap.get(nodeId);
          if (nb && nb !== 'Unknown') return nb;
          return _resolveImpNb(_impParentMap.get(nodeId) ?? null, depth + 1);
        }

        // ── Pass 3: apply sign correction with resolved normalBal ─────────────
        // Only flip negative Dr-account values — Tally exports some Dr accounts (Fixed Assets)
        // as negative while others (Current Assets: cash, bank) are already positive.
        const mappedHierarchy: TbHierarchyNode[] = _rawImport.map(node => {
          const resolvedNb = _resolveImpNb(node.nodeId);
          const flipO = resolvedNb === 'Dr' && node.opening < 0;
          const flipC = resolvedNb === 'Dr' && node.closing < 0;
          return {
            ...node,
            opening: flipO ? -node.opening : node.opening,
            closing: flipC ? -node.closing : node.closing,
          };
        });
        const leafPreview = mappedHierarchy.filter((n) => n.isLeaf).slice(0, 20);
        setTbHierarchyNodes(mappedHierarchy);

        // Store validation result
        if (data.validation) {
          setTbValidation(data.validation);
        }

        const strictPresentation = buildTbPresentationModel(mappedHierarchy);
        setTbValidation(strictPresentation.validation as any);
        setTbResult({
          totalAccounts: strictPresentation.leafCount,
          debitTotal: Math.round(strictPresentation.grandTotal.txnDebit * 100) / 100,
          creditTotal: Math.round(strictPresentation.grandTotal.txnCredit * 100) / 100,
          difference: Math.round(Math.abs(strictPresentation.grandTotal.txnDebit - strictPresentation.grandTotal.txnCredit) * 100) / 100,
          isValid: strictPresentation.validation.allRulesPassed,
          preview: leafPreview.map((n) => ({
            account_name: n.name,
            account_group: n.primaryGroup,
            debit: n.txnDebit,
            credit: n.txnCredit,
          })),
        });

        // ── New Change: Store TB Excel file in Supabase Storage (non-blocking) ──
        if (tbFile && engagementId) {
          (async () => {
            try {
              const fileExt = (tbFile.name.split('.').pop() || 'xlsx').toLowerCase();
              const storagePath = `${engagementId}/tb-${Date.now()}.${fileExt}`;
              const { error: storageErr } = await supabase.storage
                .from('tb-files')
                .upload(storagePath, tbFile, { upsert: true, contentType: tbFile.type || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
              if (!storageErr) {
                setTbStoragePath(storagePath);
              }
            } catch {
              // Non-blocking — storage failure does not prevent import
            }
          })();
        }

        // ── New Change: Verify hierarchy totals match the imported data ──
        // Cross-check: sum of all leaf closing values grouped by BS/PL section
        // and compare with the presentation model's section totals. Any discrepancy
        // indicates a hierarchy repair issue (double-counting or missing nodes).
        const sectionTotals = strictPresentation.sections.map((sec) => ({
          key: sec.key,
          label: sec.subtotalLabel,
          closing: Math.abs(sec.totals.closing),
        }));
        const drCrDiscrepancy = Math.abs(strictPresentation.grandTotal.txnDebit - strictPresentation.grandTotal.txnCredit);
        setTbTotalsVerification({
          leafCount: strictPresentation.leafCount,
          drTotal: strictPresentation.grandTotal.txnDebit,
          crTotal: strictPresentation.grandTotal.txnCredit,
          sectionTotals,
          isBalanced: drCrDiscrepancy < 1,
          discrepancy: drCrDiscrepancy,
        });

        setTbStep(5);
        toast.success(`${data.leafCount} ledgers imported — ${data.detectedFormat} format detected. Groups: ${data.primaryGroupCount}, Skipped: ${data.unknownAccounts ?? 0}`);
        queryClient.invalidateQueries({ queryKey: ["tb-snapshot-for-engagement"] });
        queryClient.invalidateQueries({ queryKey: ["tb-hierarchy-nodes"] });

        // Change-2: Auto-classify unclassified root groups immediately after import
        const unclassifiedOnImport = strictPresentation.rootNodes.filter(
          (r) => !strictPresentation.sections.some((s) => s.nodes.some((n) => n.nodeId === r.nodeId))
        );
        if (unclassifiedOnImport.length > 0) {
          try {
            const groupsCtx = buildGroupContext(unclassifiedOnImport, mappedHierarchy);
            const { data: aiData } = await supabase.functions.invoke("claude-gateway", {
              body: {
                request_type: "tb_classifier",
                user_message: `Classify each Tally Trial Balance group using the context (edgeClassification, normalBal, closingSign, sampleAccounts) as bs_asset, bs_liability, pl_income, or pl_expense.\nGroups: ${JSON.stringify(groupsCtx)}\nReturn ONLY JSON: {"GroupName":"bs_asset"}`,
              },
            });
            if (aiData && typeof aiData === "object" && !aiData.raw) {
              const valid = ["bs_asset","bs_liability","pl_income","pl_expense"];
              const aiUpdates: Record<string, string> = {};
              for (const [name, section] of Object.entries(aiData as Record<string,string>)) {
                if (valid.includes(section)) aiUpdates[name] = section;
              }
              if (Object.keys(aiUpdates).length > 0) {
                setTbManualClassifications(aiUpdates);
                toast.info(`AI pre-classified ${Object.keys(aiUpdates).length} unclassified group(s). Review in the Unclassified panel below and click Apply.`);
              }
            }
          } catch {
            // Non-fatal — user can still manually classify
          }
        }

        // ── New Change: AI 360° pre-analysis (runs in background, non-blocking) ──
        handleAiPreAnalysis(strictPresentation).catch(() => {});
        return;
      }

      // ─── Generic / Expert local parse flow ───
      const rows = parseTbRows();
      if (rows.length === 0) {
        toast.error("No valid rows found");
        setTbProcessing(false);
        return;
      }

      setTbProgress(30);

      const debitTotal = rows.reduce((s, r) => s + (r.debit || 0), 0);
      const creditTotal = rows.reduce((s, r) => s + (r.credit || 0), 0);
      const diff = Math.abs(debitTotal - creditTotal);
      const isValid = diff <= 1;

      setTbProgress(60);

      // Save to trial_balance_snapshots
      const payload: any = {
        client_id: engagement.client_id,
        engagement_id: engagementId,
        financial_year: engagement.financial_year,
        raw_data: tbParsedData,
        normalised_data: rows,
        source_format: tbFormat,
        import_format: tbFormat,
        column_mapping: tbMapping,
        debit_total: Math.round(debitTotal * 100) / 100,
        credit_total: Math.round(creditTotal * 100) / 100,
        difference: Math.round(diff * 100) / 100,
        is_validated: isValid,
        validation_status: isValid ? "valid" : "invalid",
        processing_status: "complete",
      };

      // Upsert — delete old then insert
      await supabase.from("trial_balance_snapshots").delete().eq("engagement_id", engagementId);
      await supabase.from("trial_balance_snapshots").insert(payload);

      setTbProgress(100);

      setTbResult({
        totalAccounts: rows.length,
        debitTotal: Math.round(debitTotal * 100) / 100,
        creditTotal: Math.round(creditTotal * 100) / 100,
        difference: Math.round(diff * 100) / 100,
        isValid,
        preview: rows.slice(0, 20),
      });

      setTbStep(5);
      toast.success(`${rows.length} accounts processed`);
      queryClient.invalidateQueries({ queryKey: ["tb-snapshot-for-engagement"] });
    } catch (err: any) {
      toast.error(err.message || "Processing failed");
    } finally {
      setTbProcessing(false);
      setTbProgressLabel("");
    }
  };

  // ═══════ AI PRE-ANALYSIS ═══════
  const handleAiPreAnalysis = async (presentation: TbPresentationModel) => {
    setTbAiAnalysing(true);
    try {
      const { rootNodes, sections, grandTotal, validation } = presentation;

      const groupLines = rootNodes.slice(0, 30).map(r => {
        const sec = sections.find(s => s.nodes.some(n => n.nodeId === r.nodeId));
        const totals = sumDisplayedNode(r.nodeId, presentation.activeNodes as TbHierarchyNode[]);
        const childCount = presentation.activeNodes.filter(n => n.parentNodeId === r.nodeId).length;
        return `  ${r.name}: section=${sec?.key || 'unclassified'} | closing=${Math.round(totals.closing)} | opening=${Math.round(totals.opening)} | children=${childCount}`;
      }).join('\n');

      const leafSample = presentation.activeNodes.filter(n => n.isLeaf).slice(0, 15)
        .map(n => `  ${n.name} (${n.primaryGroup}): cl=${Math.round(n.closing || 0)}`).join('\n');

      const msg = `Trial Balance Pre-Audit Analysis Request:\n\nMETRICS:\n- Total Ledgers: ${presentation.leafCount}\n- Debit Total: ${Math.round(grandTotal.txnDebit)}, Credit Total: ${Math.round(grandTotal.txnCredit)}\n- Difference: ${Math.round(Math.abs(grandTotal.txnDebit - grandTotal.txnCredit))}\n- TB Balanced: ${validation.isBalanced}\n- Primary Groups: ${rootNodes.length}\n- BS Assets: ${Math.round(validation.bsAssets)}, BS Liabilities: ${Math.round(validation.bsLiabilities)}\n- BS Balanced: ${Math.abs(validation.bsAssets - validation.bsLiabilities) < 1}\n- Unclassified Groups: ${validation.unclassifiedNodes}\n- Group Totals Tallied: ${validation.groupTotalsTallied}\n- Only Groups Collapsible: ${validation.onlyGroupsCollapsible}\n- Duplicate Ledgers: ${validation.duplicateNames.length > 0 ? validation.duplicateNames.join(', ') : 'None'}\n\nPRIMARY GROUPS:\n${groupLines}\n\nSAMPLE LEDGERS:\n${leafSample}`;

      const { data, error } = await supabase.functions.invoke('claude-gateway', {
        body: { request_type: 'tb_pre_analyser', user_message: msg },
      });
      if (!error && data && !data.raw && data.score !== undefined) {
        setTbAiPreAnalysis(data);
      }
    } catch {
      // Non-fatal
    } finally {
      setTbAiAnalysing(false);
    }
  };

  const handleTbOverride = async () => {
    if (!tbOverrideJustification.trim()) {
      toast.error("Please provide a justification for overriding");
      return;
    }

    await supabase
      .from("trial_balance_snapshots")
      .update({
        is_validated: true,
        validation_status: "valid",
      } as any)
      .eq("engagement_id", engagementId);

    if (tbResult) {
      setTbResult({ ...tbResult, isValid: true });
    }
    setTbShowOverride(false);
    toast.success("Override applied — proceeding with difference noted");
  };

  // ─── AI Auto-Classify TB Groups ───
  const handleAiClassify = async () => {
    const source = tbHierarchyNodes.length > 0 ? tbHierarchyNodes : storedTbHierarchy;
    const rootNodes = source.filter(n => !n.parentNodeId);
    if (rootNodes.length === 0) { toast.error("No groups to classify"); return; }
    setAiClassifying(true);
    try {
      const groupNames = rootNodes.map(n => n.name);
      const { data, error } = await supabase.functions.invoke("claude-gateway", {
        body: { request_type: "tb_classifier", user_message: `Classify these Trial Balance top-level groups into bs_asset, bs_liability, pl_income, or pl_expense:\n${JSON.stringify(groupNames)}` },
      });
      if (error) throw new Error(error.message || "AI classification failed");
      const classification: Record<string, string> = data?.raw ? {} : (data || {});
      if (Object.keys(classification).length === 0) { toast.error("AI returned no classification"); setAiClassifying(false); return; }

      for (const root of rootNodes) {
        const section = classification[root.name];
        if (!section) continue;
        const bsPlSide = section.startsWith("bs_") ? "BS" : "PL";
        const normalBal = section === "bs_liability" || section === "pl_income" ? "Cr" : "Dr";
        await supabase.from("tb_hierarchy_nodes")
          .update({ bs_pl_side: bsPlSide, normal_balance: normalBal, primary_group: root.name } as any)
          .eq("engagement_id", engagementId)
          .eq("node_id", root.nodeId);
        // Update descendants by matching primary_group
        const descIds = source.filter(n => n.primaryGroup === root.name && n.nodeId !== root.nodeId).map(n => n.nodeId);
        if (descIds.length > 0) {
          for (const did of descIds) {
            await supabase.from("tb_hierarchy_nodes")
              .update({ bs_pl_side: bsPlSide, normal_balance: normalBal, primary_group: root.name } as any)
              .eq("engagement_id", engagementId)
              .eq("node_id", did);
          }
        }
      }
      queryClient.invalidateQueries({ queryKey: ["tb-hierarchy-nodes", engagementId] });
      toast.success(`AI classified ${Object.keys(classification).length} groups. Refreshing...`);
    } catch (err: any) {
      toast.error(err.message || "AI classification failed");
    } finally {
      setAiClassifying(false);
    }
  };

  // ── Build rich context for AI classification ────────────────────────────
  // Change-4: Send closing balance, sign, edge-function's bsPlSide + normalBal,
  // and sample ledger names so Claude can classify using the actual Excel data.
  function buildGroupContext(roots: typeof tbHierarchyNodes, source: typeof tbHierarchyNodes) {
    return roots.map((r) => {
      const leaves = source.filter((n) => n.isLeaf && n.primaryGroup === r.name);
      const totalCl = leaves.reduce((s, n) => s + (n.closing || 0), 0);
      return {
        name: r.name,
        edgeClassification: r.bsPlSide || "Unknown",
        normalBal: r.normalBal || "Unknown",
        closingBalance: Math.abs(totalCl).toFixed(2),
        closingSign: totalCl >= 0 ? "Dr" : "Cr",
        sampleAccounts: leaves.slice(0, 5).map((n) => n.name),
      };
    });
  }

  // ── Ask Claude API to classify unclassified root groups ────────────────
  const handleAiClassifyUnclassified = async () => {
    const source = tbHierarchyNodes.length > 0 ? tbHierarchyNodes : storedTbHierarchy;
    const presentation = buildTbPresentationModel(source);
    const unknownRoots = presentation.rootNodes.filter(
      (r) => (presentation.sections.find((s) => s.nodes.some((n) => n.nodeId === r.nodeId)) === undefined)
    );
    if (unknownRoots.length === 0) { toast.info("No unclassified groups found"); return; }
    setAiClassifyingUnclassified(true);
    try {
      const groupsCtx = buildGroupContext(unknownRoots, source);
      const { data, error } = await supabase.functions.invoke("claude-gateway", {
        body: {
          request_type: "tb_classifier",
          user_message: `Classify each Tally Trial Balance group. Use the context fields (edgeClassification, normalBal, closingSign, sampleAccounts) to accurately determine if it is bs_asset, bs_liability, pl_income, or pl_expense.\nGroups: ${JSON.stringify(groupsCtx)}\nReturn ONLY JSON: {"GroupName":"bs_asset"}`,
        },
      });
      if (error) throw new Error(error.message);
      const classification: Record<string, string> = typeof data === "object" && !data?.raw ? data : {};
      if (Object.keys(classification).length === 0) { toast.error("AI returned no results"); return; }
      const updates: Record<string, string> = {};
      const valid = ["bs_asset","bs_liability","pl_income","pl_expense"];
      for (const [name, section] of Object.entries(classification)) {
        if (valid.includes(section)) updates[name] = section;
      }
      setTbManualClassifications((prev) => ({ ...prev, ...updates }));
      toast.success(`AI suggested ${Object.keys(updates).length} classifications — review dropdowns and click Apply.`);
    } catch (err: any) {
      toast.error(err.message || "AI classification failed");
    } finally {
      setAiClassifyingUnclassified(false);
    }
  };

  // ── Apply manual classifications to hierarchy nodes and recompute ────────
  const handleApplyManualClassifications = async () => {
    if (Object.keys(tbManualClassifications).length === 0) {
      toast.error("No classifications to apply");
      return;
    }
    setApplyingManualClassify(true);
    try {
      const source = tbHierarchyNodes.length > 0 ? tbHierarchyNodes : storedTbHierarchy;
      // Extract section key: stored as "bs_asset|||Bank Accounts" or plain "bs_asset"
      const sectionOf = (v: string) => (v.includes("|||") ? v.split("|||")[0] : v) as TbSectionType;
      // Update in-memory nodes
      const updated = source.map((node) => {
        const rootName = node.primaryGroup || node.name;
        const raw = tbManualClassifications[rootName];
        if (!raw) return node;
        const section = sectionOf(raw);
        const bsPlSide = section.startsWith("bs_") ? "BS" : "PL";
        const normalBal = (section === "bs_liability" || section === "pl_income") ? "Cr" : "Dr";
        return { ...node, bsPlSide, normalBal: normalBal as any };
      });

      // Persist to Supabase in batches
      for (const [rootName, raw] of Object.entries(tbManualClassifications)) {
        const section = sectionOf(raw);
        const bsPlSide = section.startsWith("bs_") ? "BS" : "PL";
        const normalBal = (section === "bs_liability" || section === "pl_income") ? "Cr" : "Dr";
        const affectedIds = source
          .filter((n) => n.primaryGroup === rootName || n.name === rootName)
          .map((n) => n.nodeId);
        for (const nid of affectedIds) {
          await supabase.from("tb_hierarchy_nodes" as any)
            .update({ bs_pl_side: bsPlSide, normal_balance: normalBal } as any)
            .eq("engagement_id", engagementId)
            .eq("node_id", nid);
        }
      }

      setTbHierarchyNodes(updated);
      const newPresentation = buildTbPresentationModel(updated);
      setTbValidation(newPresentation.validation as any);
      setTbResult((prev) => prev ? {
        ...prev,
        debitTotal: Math.round(newPresentation.grandTotal.txnDebit * 100) / 100,
        creditTotal: Math.round(newPresentation.grandTotal.txnCredit * 100) / 100,
        difference: Math.round(Math.abs(newPresentation.grandTotal.txnDebit - newPresentation.grandTotal.txnCredit) * 100) / 100,
        isValid: newPresentation.validation.allRulesPassed,
      } : prev);
      setTbManualClassifications({});
      queryClient.invalidateQueries({ queryKey: ["tb-hierarchy-nodes", engagementId] });
      toast.success("Classifications applied. Integrity checks updated.");
    } catch (err: any) {
      toast.error(err.message || "Apply failed");
    } finally {
      setApplyingManualClassify(false);
    }
  };

  const handleDeleteTb = async () => {
    if (!window.confirm(
      'Delete the imported Trial Balance? This will remove all ledger hierarchy data for this engagement. You can re-upload a new file.'
    )) return;
    setDeletingTb(true);
    try {
      await supabase.from('tb_hierarchy_nodes')
        .delete().eq('engagement_id', engagementId);
      await supabase.from('trial_balance_snapshots')
        .delete().eq('engagement_id', engagementId);
      setTbResult(null);
      setTbHierarchyNodes([]);
      setTbAiPreAnalysis(null);
      setTbStep(1);
      setTbFormat('');
      setTbFile(null);
      setTbFileBase64('');
      setTbParsedData([]);
      setTbProgress(0);
      queryClient.invalidateQueries({ queryKey: ['tb-snapshot-for-engagement'] });
      queryClient.invalidateQueries({ queryKey: ['tb-hierarchy-nodes', engagementId] });
      toast.success('Trial Balance deleted. You can now upload a new file.');
    } catch (err: any) {
      toast.error(err.message || 'Delete failed');
    } finally {
      setDeletingTb(false);
    }
  };

  // ═══════ COA MAPPING LOGIC ═══════

  const handleInitCoaMapping = async () => {
    const source = tbHierarchyNodes.length > 0 ? tbHierarchyNodes : storedTbHierarchy;
    const leaves = source.filter((n) => n.isLeaf);
    if (leaves.length === 0) { toast.error("No leaf ledgers found. Import a TB first."); return; }

    setCoaMappingLoading(true);
    try {
      // 1. Check which ledgers are already mapped
      const firmId = user?.firm_id;
      const { data: existingMappings } = await supabase
        .from("coa_mappings")
        .select("raw_ledger_name, standard_head, bs_pl, account_group")
        .or(firmId ? `firm_id.eq.${firmId},firm_id.is.null` : "firm_id.is.null");
      const existingMap = new Map<string, { standard_head: string; bs_pl: string; account_group: string }>();
      for (const m of existingMappings || []) {
        if (m.raw_ledger_name) existingMap.set(m.raw_ledger_name.toLowerCase(), m);
      }

      // 2. Determine entity COA category from engagement
      const entityType = engagement?.entity_type || engagement?.clients?.entity_type || null;
      const coaCat = entityType ? (ENTITY_TO_COA_CAT[entityType] || "corporate") : "corporate";
      const coaMaster = (coaMasterDataJson as any[]).filter((r: any) => r.entity_type === coaCat);
      const coaHeads = coaMaster
        .filter((r: any) => r.level === 4)
        .map((r: any) => `${r.account_head} (${r.group_name || r.major_group}, ${r.bs_pl})`)
        .join("; ");

      // 3. Build ledger objects for AI prompt (batch in groups of 40)
      const ledgerObjects = leaves.map((n) => ({
        ledger: n.name,
        tally_group: n.primaryGroup || "",
        closing_balance: +(n.closing || 0).toFixed(2),
        bs_pl_side: n.bsPlSide || "",
      }));

      const BATCH_SIZE = 40;
      const aiResults = new Map<string, { suggested_head: string; bs_pl: string; account_group: string; confidence: string; reason: string }>();

      for (let bi = 0; bi < ledgerObjects.length; bi += BATCH_SIZE) {
        const batch = ledgerObjects.slice(bi, bi + BATCH_SIZE);
        const prompt = `Entity type: ${entityType || "Corporate"}. Available COA heads (sample): ${coaHeads.slice(0, 2000)}.\n\nLedgers to map:\n${JSON.stringify(batch)}`;
        const { data, error } = await supabase.functions.invoke("claude-gateway", {
          body: { request_type: "coa_mapper", user_message: prompt },
        });
        if (error) { toast.warning(`AI batch ${bi / BATCH_SIZE + 1} failed: ${error.message}`); continue; }
        const arr: any[] = Array.isArray(data) ? data : (data?.raw ? [] : []);
        for (const item of arr) {
          if (item?.ledger) aiResults.set(item.ledger.toLowerCase(), item);
        }
      }

      // 4. Build the full row list
      const rows: CoaMappingRow[] = leaves.map((n) => {
        const key = n.name.toLowerCase();
        const existing = existingMap.get(key);
        const ai = aiResults.get(key);
        return {
          ledger: n.name,
          tallyGroup: n.primaryGroup || "",
          closing: n.closing || 0,
          bsPlSide: n.bsPlSide || "",
          suggestedHead: existing?.standard_head || ai?.suggested_head || "",
          suggestedGroup: existing?.account_group || ai?.account_group || "",
          suggestedBsPl: existing?.bs_pl || ai?.bs_pl || (n.bsPlSide === "BS" ? "BS" : "PL"),
          confidence: existing ? "high" : (ai?.confidence || "") as any,
          reason: existing ? "Already mapped" : (ai?.reason || ""),
          accepted: !!existing,
          skipped: false,
          customHead: existing?.standard_head || ai?.suggested_head || "",
          customGroup: existing?.account_group || ai?.account_group || "",
          customBsPl: existing?.bs_pl || ai?.bs_pl || (n.bsPlSide === "BS" ? "BS" : "PL"),
          alreadyMapped: !!existing,
        };
      });

      setCoaMappingRows(rows);
      setCoaMappingDone(false);
      setTbStep(6);
      toast.success(`Loaded ${rows.length} ledgers — ${aiResults.size} AI suggestions fetched`);
    } catch (err: any) {
      toast.error(err.message || "COA mapping init failed");
    } finally {
      setCoaMappingLoading(false);
    }
  };

  const handleSaveCoaMappings = async () => {
    const firmId = user?.firm_id;
    if (!firmId) { toast.error("Firm not found"); return; }
    const toSave = coaMappingRows.filter((r) => r.accepted && !r.alreadyMapped && r.customHead);
    if (toSave.length === 0) { toast.info("No new mappings to save"); return; }
    setCoaMappingSaving(true);
    try {
      const inserts = toSave.map((r) => ({
        firm_id: firmId,
        raw_ledger_name: r.ledger,
        standard_head: r.customHead || r.suggestedHead,
        bs_pl: r.customBsPl || r.suggestedBsPl || "BS",
        account_group: r.customGroup || r.suggestedGroup || "",
      }));
      for (let i = 0; i < inserts.length; i += 100) {
        const { error } = await supabase.from("coa_mappings").upsert(
          inserts.slice(i, i + 100) as any,
          { onConflict: "firm_id,raw_ledger_name", ignoreDuplicates: false }
        );
        if (error) throw error;
      }
      // Mark saved rows as alreadyMapped
      setCoaMappingRows((prev) => prev.map((r) => (r.accepted && !r.alreadyMapped ? { ...r, alreadyMapped: true } : r)));
      setCoaMappingDone(true);
      toast.success(`Saved ${inserts.length} COA mappings`);
    } catch (err: any) {
      toast.error(err.message || "Save failed");
    } finally {
      setCoaMappingSaving(false);
    }
  };

  // ═══════ LEDGER IMPORT LOGIC ═══════

  const handleLedgerFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    setLedgerFiles(files);

    const reader = new FileReader();
    reader.onload = (evt) => {
      const data = evt.target?.result;
      try {
        const wb = XLSX.read(data, { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const jsonData: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1 });
        setLedgerParsedData(jsonData);

        if (jsonData.length > 0) {
          const headerRow = jsonData[0].map((h: any) => String(h || "").trim()).filter(Boolean);
          setLedgerHeaders(headerRow);
          setLedgerMapping(autoDetectLedgerMapping(headerRow));
        }
        setLedgerStep(2);
      } catch (err) {
        toast.error("Failed to parse ledger file");
      }
    };
    reader.readAsArrayBuffer(files[0]);
  };

  const handleLedgerProcess = async () => {
    setLedgerProcessing(true);
    setLedgerProgress(10);
    setLedgerStep(3);

    try {
      const allRows: any[] = [];
      const parseNum = (v: any) => {
        if (v == null || v === "") return 0;
        return parseFloat(String(v).replace(/,/g, "").trim()) || 0;
      };

      for (let fi = 0; fi < ledgerFiles.length; fi++) {
        const file = ledgerFiles[fi];
        const data = await file.arrayBuffer();
        const wb = XLSX.read(data, { type: "array" });

        for (const sheetName of wb.SheetNames) {
          const ws = wb.Sheets[sheetName];
          const jsonData: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1 });
          if (jsonData.length < 2) continue;

          const headerRow = jsonData[0].map((h: any) => String(h || "").trim());
          const colIdx = (key: string) => {
            const header = ledgerMapping[key];
            return header ? headerRow.indexOf(header) : -1;
          };

          for (let i = 1; i < jsonData.length; i++) {
            const row = jsonData[i];
            const dateVal = row[colIdx("date")];
            if (!dateVal) continue;

            allRows.push({
              engagement_id: engagementId,
              account_name: colIdx("account_name") >= 0 ? String(row[colIdx("account_name")] || "").trim() : sheetName,
              account_group: "",
              date: parseDate(dateVal),
              voucher_type: colIdx("voucher_type") >= 0 ? String(row[colIdx("voucher_type")] || "").trim() : null,
              voucher_no: colIdx("voucher_no") >= 0 ? String(row[colIdx("voucher_no")] || "").trim() : null,
              narration: colIdx("narration") >= 0 ? String(row[colIdx("narration")] || "").trim() : null,
              debit: parseNum(row[colIdx("debit")]),
              credit: parseNum(row[colIdx("credit")]),
              running_balance: 0,
            });
          }
        }
        setLedgerProgress(10 + (fi + 1) / ledgerFiles.length * 40);
      }

      if (allRows.length === 0) {
        toast.error("No valid transactions found");
        setLedgerProcessing(false);
        setLedgerStep(1);
        return;
      }

      const { data: batch } = await supabase
        .from("ledger_import_batches")
        .insert({
          engagement_id: engagementId,
          original_filename: ledgerFiles.map(f => f.name).join(", "),
          file_size_bytes: ledgerFiles.reduce((s, f) => s + f.size, 0),
          row_count: allRows.length,
          processing_status: "processing",
          imported_by: user?.id,
        } as any)
        .select("id")
        .single();

      setLedgerProgress(55);

      await supabase
        .from("ledger_transactions")
        .delete()
        .eq("engagement_id", engagementId);

      const CHUNK_SIZE = 2000;
      for (let i = 0; i < allRows.length; i += CHUNK_SIZE) {
        const chunk = allRows.slice(i, i + CHUNK_SIZE).map(r => ({
          ...r,
          import_batch_id: batch?.id,
        }));
        await supabase.from("ledger_transactions").insert(chunk as any);
        setLedgerProgress(55 + ((i + CHUNK_SIZE) / allRows.length) * 35);
      }

      if (batch?.id) {
        await supabase
          .from("ledger_import_batches")
          .update({ processing_status: "complete" } as any)
          .eq("id", batch.id);
      }

      setLedgerProgress(95);

      const suspiciousPatterns = ["misc", "adjustment", "adj", "sundry", "other", "temp"];
      let flaggedCount = 0;
      const flagUpdates: { id: string; flag_reason: string }[] = [];

      const { data: inserted } = await supabase
        .from("ledger_transactions")
        .select("id, narration, debit, credit")
        .eq("engagement_id", engagementId)
        .limit(5000);

      for (const txn of inserted || []) {
        const narr = (txn.narration || "").toLowerCase().trim();
        const reasons: string[] = [];
        if (!narr || narr.length < 3) reasons.push("Blank/short narration");
        if (suspiciousPatterns.some(p => narr.includes(p))) reasons.push("Suspicious keyword");
        const amt = Math.max(txn.debit || 0, txn.credit || 0);
        if (amt > 0 && amt % 1000 === 0 && amt >= 10000) reasons.push("Round number amount");

        if (reasons.length > 0) {
          flaggedCount++;
          flagUpdates.push({ id: txn.id, flag_reason: reasons.join("; ") });
        }
      }

      for (const upd of flagUpdates) {
        await supabase
          .from("ledger_transactions")
          .update({ scrutiny_flag: true, flag_reason: upd.flag_reason } as any)
          .eq("id", upd.id);
      }

      setLedgerProgress(100);

      const dates = allRows.map(r => r.date).filter(Boolean).sort();
      const dateRange = dates.length > 0 ? `${dates[0]} to ${dates[dates.length - 1]}` : "N/A";
      const accounts = new Set(allRows.map(r => r.account_name));

      setLedgerResult({
        totalTransactions: allRows.length,
        accountCount: accounts.size,
        dateRange,
        flaggedCount,
      });

      setLedgerStep(4);
      toast.success(`${allRows.length} transactions imported`);
      queryClient.invalidateQueries({ queryKey: ["ledger-batches"] });
    } catch (err: any) {
      toast.error(err.message || "Ledger import failed");
      setLedgerStep(1);
    } finally {
      setLedgerProcessing(false);
    }
  };

  // ─── Comparative TB Import ───
  const handleComparativeImport = async () => {
    if (!comparativeFile) return;
    setComparativeProcessing(true);
    try {
      const arrayBuffer = await comparativeFile.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      let binary = "";
      for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
      const base64 = btoa(binary);

      const fy = engagement.financial_year || "2024-25";
      const [startY, endY] = fy.split("-");
      const priorFY = `${parseInt(startY) - 1}-${(parseInt(endY) - 1).toString().padStart(2, "0")}`;

      const { data, error } = await supabase.functions.invoke("parse-tally-tb", {
        body: {
          engagementId: `${engagementId}_prior`,
          firmId: user?.firm_id,
          fileBase64: base64,
          fileName: comparativeFile.name,
          financialYear: priorFY,
          isPriorYear: true,
        },
      });

      if (error) throw new Error(error.message || "Prior year parse error");
      if (!data?.success) throw new Error(data?.error || "Prior year parse failed");

      // Map all fields from the edge-function hierarchy response
      const priorLeaves: any[] = (data.hierarchy || [])
        .filter((n: any) => n.isLeaf)
        .map((n: any) => ({
          name:        n.name         || "",
          opening:     n.opening      || 0,
          txnDebit:    n.txnDebit     || n.debit  || 0,
          txnCredit:   n.txnCredit    || n.credit || 0,
          closing:     n.closing      || 0,
          primaryGroup:n.primaryGroup || n.group  || "",
          bsPlSide:    n.bsPlSide     || n.bs_pl_side || "",
        }));

      const currentLeaves = (tbHierarchyNodes.length > 0 ? tbHierarchyNodes : storedTbHierarchy).filter(n => n.isLeaf);
      const result = buildComparativeResultFromLeaves(priorLeaves, currentLeaves, priorFY);
      setComparativeResult(result);
      setComparativeFile(null);
      setShowComparativeTb(false);
      refetchPriorTb();
      toast.success(`Prior year TB imported. ${result.mismatched} opening balance mismatches found.`);
    } catch (err: any) {
      toast.error(err.message || "Prior year import failed");
    } finally {
      setComparativeProcessing(false);
    }
  };

  // ─── Delete Prior Period TB ───
  const handleDeletePriorTb = async () => {
    setDeletingPriorTb(true);
    try {
      const priorEngId = `${engagementId}_prior`;
      await supabase.from("tb_hierarchy_nodes").delete().eq("engagement_id", priorEngId);
      await supabase.from("trial_balance_snapshots").delete().eq("engagement_id", priorEngId);
      setComparativeResult(null);
      setComparativeFile(null);
      setShowComparativeTb(false);
      setShowDeletePriorConfirm(false);
      await refetchPriorTb();
      toast.success("Prior year TB deleted successfully");
    } catch (err: any) {
      toast.error(err.message || "Failed to delete prior year TB");
    } finally {
      setDeletingPriorTb(false);
    }
  };

  // ─── Downstream push after TB import ───
  const pushTbToDownstreamModules = async () => {
    const { data: existingCoa } = await supabase
      .from("audit_engagements")
      .select("coa_mapping")
      .eq("id", engagementId)
      .single();
    if (!existingCoa?.coa_mapping || Object.keys(existingCoa.coa_mapping as any || {}).length === 0) {
      await supabase.from("audit_engagements").update({
        re_evaluate_scrutiny: true,
      } as any).eq("id", engagementId);
    }
    await supabase.from("audit_engagements").update({
      pipeline_stage: Math.max(engagement?.pipeline_stage || 2, 3),
    } as any).eq("id", engagementId);
    toast.success(
      "TB imported. Stage 3 (COA Mapping) is now ready. Scrutiny rules have been tagged.",
      { duration: 5000 }
    );
  };

  // Check if stage 2 can be completed — allow with warnings (TB must exist)
  const canComplete = !!tbPresentation;

  const handleCompleteStage2 = async () => {
    if (!engagement) return;
    await pushTbToDownstreamModules();
    const newStatuses = { ...(engagement.stage_statuses || {}), "2": "complete" };
    await supabase.from("audit_engagements").update({
      stage_statuses: newStatuses as any,
      pipeline_stage: 3,
    } as any).eq("id", engagementId);
    onStageComplete();
    toast.success("Stage 2 complete — moving to COA & Financial Statements");
  };

  // Guard: engagement may be undefined while loading (must be after all hooks)
  if (!engagement) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="max-w-5xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">Stage 2 — Data Import</h1>
          <p className="text-sm text-muted-foreground">Import Trial Balance and Ledger data for {engagement.clients?.name || engagement.client_name || "—"} — FY {engagement.financial_year}</p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" onClick={handleCompleteStage2} disabled={!canComplete} className="gap-1">
            Complete Stage 2 <ArrowRight size={14} />
          </Button>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={(v: any) => setActiveTab(v)}>
        <TabsList>
          <TabsTrigger value="tb" className="gap-1.5">
            <FileSpreadsheet size={14} /> TB Import
            {tbResult?.isValid && <CheckCircle2 size={12} className="text-primary" />}
          </TabsTrigger>
          <TabsTrigger value="ledger" className="gap-1.5">
            <Table2 size={14} /> Ledger Import
            {ledgerResult && <CheckCircle2 size={12} className="text-primary" />}
          </TabsTrigger>
        </TabsList>

        {/* ═══════ TB IMPORT TAB ═══════ */}
        <TabsContent value="tb" className="space-y-4 mt-4">
          {/* Progress indicator */}
          <div className="flex gap-1 mb-2">
            {["Format", "Upload", "Map Cols", "Process", "Result", "COA Map"].map((label, i) => {
              const isCoaMapStep = i === 5;
              const coaMapClickable = isCoaMapStep && tbStep >= 5 && (tbHierarchyNodes.length > 0 || storedTbHierarchy.length > 0) && !coaMappingLoading;
              return (
                <div
                  key={label}
                  className={cn(
                    "flex-1 text-center text-[10px] py-1 rounded-sm font-medium transition-colors",
                    tbStep > i + 1 ? "bg-primary/20 text-primary" :
                    tbStep === i + 1 ? "bg-primary text-primary-foreground" :
                    "bg-muted text-muted-foreground",
                    coaMapClickable && tbStep !== 6 && "cursor-pointer hover:bg-primary/40 hover:text-primary",
                    isCoaMapStep && tbStep < 5 && "opacity-40",
                  )}
                  onClick={() => {
                    if (coaMapClickable) {
                      if (tbStep === 6) return; // already on COA Map step
                      handleInitCoaMapping();
                    }
                  }}
                  title={isCoaMapStep && coaMapClickable ? "Click to map ledgers to COA with AI" : undefined}
                >
                  {coaMappingLoading && isCoaMapStep ? "Loading…" : label}
                </div>
              );
            })}
          </div>

          {/* Step 1: Format Selection */}
          {tbStep === 1 && (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {FORMAT_OPTIONS.map(f => {
                const Icon = f.icon;
                return (
                  <Card
                    key={f.value}
                    className={cn(
                      "cursor-pointer transition-all hover:shadow-md",
                      tbFormat === f.value && "ring-2 ring-primary border-primary"
                    )}
                    onClick={() => { setTbFormat(f.value); setTbStep(2); }}
                  >
                    <CardContent className="p-4 flex flex-col items-center text-center gap-2">
                      <Icon size={28} className="text-primary" />
                      <span className="text-sm font-semibold">{f.label}</span>
                      <span className="text-[10px] text-muted-foreground">{f.description}</span>
                      <Badge variant="outline" className="text-[9px]">{f.ext}</Badge>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}

          {/* Step 2: Upload */}
          {tbStep === 2 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Upload size={18} /> Upload {FORMAT_OPTIONS.find(f => f.value === tbFormat)?.label} File
                  <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setTbStep(1)}>
                    <ArrowLeft size={14} className="mr-1" /> Back
                  </Button>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div
                  className="border-2 border-dashed rounded-lg p-10 text-center cursor-pointer hover:border-primary/50 transition-colors"
                  onClick={() => tbFileRef.current?.click()}
                  onDragOver={e => e.preventDefault()}
                  onDrop={e => {
                    e.preventDefault();
                    const file = e.dataTransfer.files?.[0];
                    if (file && tbFileRef.current) {
                      const dt = new DataTransfer();
                      dt.items.add(file);
                      tbFileRef.current.files = dt.files;
                      tbFileRef.current.dispatchEvent(new Event("change", { bubbles: true }));
                    }
                  }}
                >
                  <FileUp size={40} className="mx-auto text-muted-foreground mb-3" />
                  <p className="text-sm font-medium">{tbFile?.name || "Click or drag file here"}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Max 50MB • {FORMAT_OPTIONS.find(f => f.value === tbFormat)?.ext}
                    {tbFormat === "pdf" && " — Text will be extracted automatically"}
                  </p>
                  <input
                    ref={tbFileRef}
                    type="file"
                    accept={
                      tbFormat === "generic_csv" ? ".csv" :
                      tbFormat === "tally_xml" ? ".xml" :
                      tbFormat === "pdf" ? ".pdf" :
                      ".xlsx,.xls"
                    }
                    className="hidden"
                    onChange={handleTbFileUpload}
                  />
                </div>
              </CardContent>
            </Card>
          )}

          {/* Step 3: Column Mapper (Generic only) */}
          {tbStep === 3 && needsColumnMapping && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  Map Columns
                  <Button variant="outline" size="sm" className="ml-auto gap-1" onClick={() => {
                    setTbMapping(autoDetectMapping(tbHeaders));
                    toast.success("Auto-mapped columns");
                  }}>
                    Map Similar
                  </Button>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {GENERIC_TARGET_FIELDS.map(field => (
                  <div key={field.key} className="flex items-center gap-3">
                    <div className="w-40 text-sm font-medium">
                      {field.label} {field.required && <span className="text-destructive">*</span>}
                    </div>
                    <Select
                      value={tbMapping[field.key] || ""}
                      onValueChange={v => setTbMapping(m => ({ ...m, [field.key]: v }))}
                    >
                      <SelectTrigger className="flex-1"><SelectValue placeholder="Select column" /></SelectTrigger>
                      <SelectContent>
                        {tbHeaders.map(h => <SelectItem key={h} value={h}>{h}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                ))}

                <div className="flex justify-between pt-3">
                  <Button variant="ghost" size="sm" onClick={() => setTbStep(2)}>
                    <ArrowLeft size={14} className="mr-1" /> Back
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => setTbStep(4)}
                    disabled={!GENERIC_TARGET_FIELDS.filter(f => f.required).every(f => tbMapping[f.key])}
                  >
                    Continue <ArrowRight size={14} className="ml-1" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Step 4: Processing */}
          {tbStep === 4 && (
            <Card>
              <CardContent className="p-6 space-y-4">
                {tbProcessing ? (
                  <div className="text-center space-y-3">
                    <Loader2 size={32} className="mx-auto animate-spin text-primary" />
                    <p className="text-sm font-medium">
                      {tbStatusMsg || 'Processing Trial Balance...'}
                    </p>
                    <Progress value={tbProgress} className="h-2" />
                    <div className='flex items-center justify-between text-xs text-muted-foreground px-1'>
                      <span>{tbStatusMsg}</span>
                      <span>{Math.round(tbProgress)}%</span>
                    </div>
                    {tbProgress > 18 && tbProgress < 100 && (
                      <p className='text-[10px] text-muted-foreground italic'>
                        Large files may take 30–60 seconds. Do not close this page.
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="text-center space-y-4">
                    <FileSpreadsheet size={40} className="mx-auto text-primary opacity-60" />
                    <div>
                      <p className="text-sm font-medium">
                        Ready to process {tbFormat === "pdf" ? "PDF file" : `${tbParsedData.length - 1} rows`}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Format: {FORMAT_OPTIONS.find(f => f.value === tbFormat)?.label} • File: {tbFile?.name}
                        {tbFile && tbFile.size > 2 * 1024 * 1024 && (
                          <span className="ml-1 text-amber-600">
                            ({(tbFile.size / (1024 * 1024)).toFixed(1)}MB — chunked upload)
                          </span>
                        )}
                      </p>
                    </div>
                    <div className="flex justify-center gap-3">
                      <Button variant="ghost" size="sm" onClick={() => setTbStep(needsColumnMapping ? 3 : 2)}>
                        <ArrowLeft size={14} className="mr-1" /> Back
                      </Button>
                      <Button onClick={handleTbProcess} className="gap-1">
                        <CheckCircle2 size={14} /> Process & Validate
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Step 5: Validation Result */}
          {tbStep === 5 && tbResult && (
            <div className="space-y-4">
              <div className="grid grid-cols-4 gap-3">
                <Card>
                  <CardContent className="p-4 text-center">
                    <p className="text-2xl font-bold text-foreground">{tbResult.totalAccounts}</p>
                    <p className="text-xs text-muted-foreground">Total Accounts</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4 text-center">
                    <p className="text-lg font-bold text-foreground">₹{tbResult.debitTotal.toLocaleString("en-IN")}</p>
                    <p className="text-xs text-muted-foreground">Total Debit</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4 text-center">
                    <p className="text-lg font-bold text-foreground">₹{tbResult.creditTotal.toLocaleString("en-IN")}</p>
                    <p className="text-xs text-muted-foreground">Total Credit</p>
                  </CardContent>
                </Card>
                <Card className={tbResult.isValid ? "border-primary/30" : "border-destructive/30"}>
                  <CardContent className="p-4 text-center">
                    <p className={cn("text-lg font-bold", tbResult.isValid ? "text-primary" : "text-destructive")}>
                      ₹{tbResult.difference.toLocaleString("en-IN")}
                    </p>
                    <p className="text-xs text-muted-foreground">Difference</p>
                  </CardContent>
                </Card>
              </div>

              {tbResult.isValid ? (
                <Alert className="border-primary/30 bg-primary/5">
                  <CheckCircle2 className="h-4 w-4 text-primary" />
                  <AlertTitle className="text-primary">Trial Balance Validated ✓</AlertTitle>
                  <AlertDescription className="text-sm">
                    Debits and Credits are balanced within ₹1 tolerance. Proceed to Ledger Import or complete Stage 2.
                  </AlertDescription>
                </Alert>
              ) : (
                <Alert className="border-amber-500/30 bg-amber-500/5">
                  <AlertTriangle className="h-4 w-4 text-amber-600" />
                  <AlertTitle className="text-amber-700">Validation Warnings</AlertTitle>
                  <AlertDescription className="text-sm text-amber-700">
                    Some validation checks did not pass. You can still preview and work with the Trial Balance.
                    Review the integrity checks below and use AI Auto-Classify to fix classification issues.
                    <div className="flex gap-2 mt-2">
                      <Button size="sm" variant="outline" onClick={() => { setTbStep(1); setTbResult(null); setTbValidation(null); setTbAiPreAnalysis(null); }}>
                        Re-upload
                      </Button>
                    </div>
                  </AlertDescription>
                </Alert>
              )}

              {/* ─── Validation Checks Panel ─── */}
              {tbValidation && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <ShieldCheck size={16} className="text-primary" /> Integrity Checks
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      {/* Check 1: TB Balanced */}
                      <div className={cn("flex items-center gap-2 p-2 rounded", tbValidation.isBalanced ? "bg-primary/5" : "bg-destructive/5")}>
                        {tbValidation.isBalanced ? <CheckCircle2 size={14} className="text-primary" /> : <AlertTriangle size={14} className="text-destructive" />}
                        <span>TB Balanced: {tbValidation.isBalanced ? "Yes" : `No (₹${tbValidation.difference.toLocaleString("en-IN")})`}</span>
                      </div>

                      {/* Check 2: Duplicate Names */}
                      <div className={cn("flex items-center gap-2 p-2 rounded", tbValidation.duplicateNames.length === 0 ? "bg-primary/5" : "bg-amber-500/5")}>
                        {tbValidation.duplicateNames.length === 0 ? <CheckCircle2 size={14} className="text-primary" /> : <FileWarning size={14} className="text-amber-600" />}
                        <span>Duplicate Ledgers: {tbValidation.duplicateNames.length === 0 ? "None" : tbValidation.duplicateNames.length}</span>
                      </div>

                      {/* Check 3: Unclassified leaves */}
                      <div className={cn("flex items-center gap-2 p-2 rounded", tbValidation.unclassifiedLeaves === 0 ? "bg-primary/5" : "bg-amber-500/5")}>
                        {tbValidation.unclassifiedLeaves === 0 ? <CheckCircle2 size={14} className="text-primary" /> : <FileWarning size={14} className="text-amber-600" />}
                        <span>Unclassified: {tbValidation.unclassifiedLeaves}</span>
                      </div>

                      {/* Check 4: Grand Total Detected */}
                      <div className="flex items-center gap-2 p-2 rounded bg-primary/5">
                        <CheckCircle2 size={14} className="text-primary" />
                        <span>Grand Total stripped: {tbValidation.grandTotalDetected ? "Yes" : "N/A"}</span>
                      </div>

                      {/* Check 5: Primary Groups */}
                      <div className="flex items-center gap-2 p-2 rounded bg-primary/5">
                        <CheckCircle2 size={14} className="text-primary" />
                        <span>Primary Groups: {tbValidation.primaryGroupCount}</span>
                      </div>

                      {/* Check 6: BS check */}
                      <div className={cn("flex items-center gap-2 p-2 rounded",
                        Math.abs(tbValidation.bsAssets - tbValidation.bsLiabilities) < 1 ? "bg-primary/5" : "bg-amber-500/5"
                      )}>
                        {Math.abs(tbValidation.bsAssets - tbValidation.bsLiabilities) < 1
                          ? <CheckCircle2 size={14} className="text-primary" />
                          : <FileWarning size={14} className="text-amber-600" />}
                        <span>BS Assets = Liabilities & Equity: {Math.abs(tbValidation.bsAssets - tbValidation.bsLiabilities) < 1 ? "Yes" : "No"}</span>
                      </div>

                      <div className={cn("flex items-center gap-2 p-2 rounded", tbValidation?.onlyGroupsCollapsible ? "bg-primary/5" : "bg-amber-500/5")}>
                        {tbValidation?.onlyGroupsCollapsible ? <CheckCircle2 size={14} className="text-primary" /> : <FileWarning size={14} className="text-amber-600" />}
                        <span>Only groups collapsible: {tbValidation?.onlyGroupsCollapsible ? "Yes" : "No"}</span>
                      </div>

                      <div className={cn("flex items-center gap-2 p-2 rounded", tbValidation?.groupTotalsTallied ? "bg-primary/5" : "bg-amber-500/5")}>
                        {tbValidation?.groupTotalsTallied ? <CheckCircle2 size={14} className="text-primary" /> : <FileWarning size={14} className="text-amber-600" />}
                        <span>Group totals tallied: {tbValidation?.groupTotalsTallied ? "Yes" : "No"}</span>
                      </div>
                    </div>

                    {/* Show duplicate names if any */}
                    {tbValidation.duplicateNames.length > 0 && (
                      <div className="mt-2 p-2 bg-amber-500/5 rounded text-xs">
                        <p className="font-semibold text-amber-700 mb-1">Duplicate ledger names found:</p>
                        <div className="flex flex-wrap gap-1">
                          {tbValidation.duplicateNames.slice(0, 10).map((name, i) => (
                            <Badge key={i} variant="outline" className="text-[9px] border-amber-500/30 text-amber-700">{name}</Badge>
                          ))}
                          {tbValidation.duplicateNames.length > 10 && (
                            <Badge variant="outline" className="text-[9px]">+{tbValidation.duplicateNames.length - 10} more</Badge>
                          )}
                        </div>
                      </div>
                    )}

                    {/* AI classification is in the Unclassified Groups panel below */}
                  </CardContent>
                </Card>
              )}

              {/* ─── TB Totals Verification Card ─── */}
              {tbTotalsVerification && (
                <Card className={cn("border", tbTotalsVerification.isBalanced ? "border-green-500/30 bg-green-500/5" : "border-destructive/30 bg-destructive/5")}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      {tbTotalsVerification.isBalanced
                        ? <CheckCircle2 size={15} className="text-green-600" />
                        : <AlertTriangle size={15} className="text-destructive" />}
                      TB Totals Verification
                      {tbStoragePath && (
                        <Badge variant="outline" className="ml-auto text-[9px] border-green-500/40 text-green-700">
                          File stored securely
                        </Badge>
                      )}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div className="p-2 rounded bg-background/60 border">
                        <p className="text-muted-foreground mb-0.5">Total Dr Transactions</p>
                        <p className="font-semibold">₹{tbTotalsVerification.drTotal.toLocaleString("en-IN", { maximumFractionDigits: 2 })}</p>
                      </div>
                      <div className="p-2 rounded bg-background/60 border">
                        <p className="text-muted-foreground mb-0.5">Total Cr Transactions</p>
                        <p className="font-semibold">₹{tbTotalsVerification.crTotal.toLocaleString("en-IN", { maximumFractionDigits: 2 })}</p>
                      </div>
                      {tbTotalsVerification.sectionTotals.map((sec) => (
                        <div key={sec.key} className="p-2 rounded bg-background/60 border">
                          <p className="text-muted-foreground mb-0.5 truncate">{sec.label}</p>
                          <p className="font-semibold">₹{sec.closing.toLocaleString("en-IN", { maximumFractionDigits: 2 })}</p>
                        </div>
                      ))}
                    </div>
                    {!tbTotalsVerification.isBalanced && (
                      <p className="mt-2 text-xs text-destructive font-medium">
                        Discrepancy: ₹{tbTotalsVerification.discrepancy.toLocaleString("en-IN", { maximumFractionDigits: 2 })} — TB is not balanced. Review the source file.
                      </p>
                    )}
                  </CardContent>
                </Card>
              )}

              {/* ─── AI 360° Pre-Analysis Card ─── */}
              {(tbAiAnalysing || tbAiPreAnalysis) && (
                <Card className={cn(
                  "border",
                  tbAiAnalysing ? "border-primary/20" :
                  tbAiPreAnalysis?.status === "clean" ? "border-green-500/30 bg-green-500/5" :
                  tbAiPreAnalysis?.status === "errors" ? "border-destructive/30 bg-destructive/5" :
                  "border-amber-500/30 bg-amber-500/5"
                )}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      {tbAiAnalysing ? (
                        <><Loader2 size={15} className="animate-spin text-primary" /><span>AI is analysing your Trial Balance at 360°…</span></>
                      ) : (
                        <>
                          <span className={cn(
                            "inline-flex items-center justify-center rounded-full w-8 h-8 text-sm font-bold shrink-0",
                            tbAiPreAnalysis!.score >= 90 ? "bg-green-500/20 text-green-700" :
                            tbAiPreAnalysis!.score >= 70 ? "bg-amber-500/20 text-amber-700" :
                            "bg-destructive/20 text-destructive"
                          )}>{tbAiPreAnalysis!.score}</span>
                          <span>AI Pre-Audit Analysis
                            <span className={cn("ml-2 text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded",
                              tbAiPreAnalysis!.status === "clean" ? "bg-green-500/20 text-green-700" :
                              tbAiPreAnalysis!.status === "errors" ? "bg-destructive/20 text-destructive" :
                              "bg-amber-500/20 text-amber-700"
                            )}>{tbAiPreAnalysis!.status}</span>
                          </span>
                        </>
                      )}
                    </CardTitle>
                    {tbAiPreAnalysis && (
                      <p className="text-xs text-muted-foreground mt-1">{tbAiPreAnalysis.summary}</p>
                    )}
                  </CardHeader>
                  {tbAiPreAnalysis && (
                    <CardContent className="space-y-3 pt-0">
                      {/* Issues */}
                      {tbAiPreAnalysis.issues.length > 0 && (
                        <div className="space-y-1.5">
                          <p className="text-[10px] font-semibold uppercase text-muted-foreground tracking-wider">Issues Found</p>
                          {tbAiPreAnalysis.issues.map((issue, idx) => (
                            <div key={idx} className={cn(
                              "flex gap-2 p-2 rounded text-xs",
                              issue.severity === "error" ? "bg-destructive/10" :
                              issue.severity === "warning" ? "bg-amber-500/10" : "bg-primary/5"
                            )}>
                              {issue.severity === "error" ? <AlertTriangle size={13} className="text-destructive shrink-0 mt-0.5" /> :
                               issue.severity === "warning" ? <AlertTriangle size={13} className="text-amber-600 shrink-0 mt-0.5" /> :
                               <CheckCircle2 size={13} className="text-primary shrink-0 mt-0.5" />}
                              <div>
                                <p className="font-semibold">{issue.title}</p>
                                <p className="text-muted-foreground">{issue.description}</p>
                                {issue.affected?.length > 0 && (
                                  <div className="flex flex-wrap gap-1 mt-1">
                                    {issue.affected.slice(0, 4).map((a, ai) => (
                                      <Badge key={ai} variant="outline" className="text-[9px]">{a}</Badge>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                      {/* Insights */}
                      {tbAiPreAnalysis.insights?.length > 0 && (
                        <div className="space-y-1">
                          <p className="text-[10px] font-semibold uppercase text-muted-foreground tracking-wider">Key Insights</p>
                          {tbAiPreAnalysis.insights.slice(0, 4).map((ins, idx) => (
                            <div key={idx} className="text-xs p-2 bg-primary/5 rounded">
                              <span className="font-semibold">{ins.title}: </span>
                              <span className="text-muted-foreground">{ins.finding}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      {/* Suggestions */}
                      {tbAiPreAnalysis.suggestions?.length > 0 && (
                        <div className="space-y-1">
                          <p className="text-[10px] font-semibold uppercase text-muted-foreground tracking-wider">CA Action Items</p>
                          <ol className="space-y-1 pl-1">
                            {tbAiPreAnalysis.suggestions.slice(0, 5).map((s, idx) => (
                              <li key={idx} className="text-xs flex gap-1.5">
                                <span className="shrink-0 font-bold text-primary">{idx + 1}.</span>
                                <span className="text-muted-foreground">{s}</span>
                              </li>
                            ))}
                          </ol>
                        </div>
                      )}
                    </CardContent>
                  )}
                </Card>
              )}

              {/* ─── Unclassified Accounts Panel ─── */}
              {tbPresentation && tbPresentation.rootNodes.filter(
                (r) => !tbPresentation.sections.some((s) => s.nodes.some((n) => n.nodeId === r.nodeId))
              ).length > 0 && (
                <Card className="border-amber-500/40 bg-amber-500/5">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2 text-amber-700">
                      <FileWarning size={16} />
                      Unclassified Groups
                      <Badge variant="outline" className="ml-1 border-amber-500/40 text-amber-700 text-[10px]">
                        {tbPresentation.rootNodes.filter(
                          (r) => !tbPresentation.sections.some((s) => s.nodes.some((n) => n.nodeId === r.nodeId))
                        ).length} unclassified
                      </Badge>
                    </CardTitle>
                    <p className="text-xs text-muted-foreground mt-1">
                      These groups could not be auto-classified. Use AI to get suggestions, review them, then click Apply.
                    </p>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {/* AI classify button */}
                    <div className="flex items-center gap-2 flex-wrap">
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1 border-amber-500/40 text-amber-700 hover:bg-amber-500/10"
                        onClick={handleAiClassifyUnclassified}
                        disabled={aiClassifyingUnclassified}
                      >
                        {aiClassifyingUnclassified ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                        {aiClassifyingUnclassified ? "Classifying…" : "AI Classify All"}
                      </Button>
                      {Object.keys(tbManualClassifications).length > 0 && (
                        <Button
                          size="sm"
                          className="gap-1"
                          onClick={handleApplyManualClassifications}
                          disabled={applyingManualClassify}
                        >
                          {applyingManualClassify ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
                          {applyingManualClassify ? "Applying…" : `Apply ${Object.keys(tbManualClassifications).length} Classification(s)`}
                        </Button>
                      )}
                    </div>

                    {/* Table of unclassified roots */}
                    <div className="border border-amber-500/20 rounded-md overflow-hidden text-xs">
                      <Table>
                        <TableHeader>
                          <TableRow className="bg-amber-500/10">
                            <TableHead className="text-[11px] h-7 text-amber-800">Group / Account</TableHead>
                            <TableHead className="text-[11px] h-7 text-amber-800 text-right">Closing Bal</TableHead>
                            <TableHead className="text-[11px] h-7 text-amber-800">Classify As</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {tbPresentation.rootNodes
                            .filter((r) => !tbPresentation.sections.some((s) => s.nodes.some((n) => n.nodeId === r.nodeId)))
                            .map((root) => {
                              const totals = (() => {
                                const src = tbHierarchyNodes.length > 0 ? tbHierarchyNodes : storedTbHierarchy;
                                const leaves = src.filter((n) => n.isLeaf && n.primaryGroup === root.name);
                                return leaves.reduce((a, n) => ({ closing: a.closing + (n.closing || 0) }), { closing: 0 });
                              })();
                              const chosen = tbManualClassifications[root.name];
                              return (
                                <TableRow key={root.nodeId} className="hover:bg-amber-500/5">
                                  <TableCell className="font-medium py-2 text-foreground">
                                    {root.name}
                                    <div className="text-[10px] text-muted-foreground mt-0.5">
                                      {(tbHierarchyNodes.length > 0 ? tbHierarchyNodes : storedTbHierarchy)
                                        .filter((n) => n.isLeaf && n.primaryGroup === root.name)
                                        .slice(0, 3)
                                        .map((n) => n.name)
                                        .join(", ")}
                                      {(tbHierarchyNodes.length > 0 ? tbHierarchyNodes : storedTbHierarchy)
                                        .filter((n) => n.isLeaf && n.primaryGroup === root.name).length > 3 &&
                                        ` +${(tbHierarchyNodes.length > 0 ? tbHierarchyNodes : storedTbHierarchy).filter((n) => n.isLeaf && n.primaryGroup === root.name).length - 3} more`}
                                    </div>
                                  </TableCell>
                                  <TableCell className="text-right py-2 font-mono">
                                    ₹{Math.abs(totals.closing).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                    <span className="ml-1 text-[9px] text-muted-foreground">{totals.closing >= 0 ? "Dr" : "Cr"}</span>
                                  </TableCell>
                                  <TableCell className="py-2">
                                    <Select
                                      value={chosen || ""}
                                      onValueChange={(val) =>
                                        setTbManualClassifications((prev) => ({ ...prev, [root.name]: val }))
                                      }
                                    >
                                      <SelectTrigger className="h-7 text-xs w-56 border-amber-500/30">
                                        <SelectValue placeholder="Select group / category…" />
                                      </SelectTrigger>
                                      <SelectContent className="max-h-64">
                                        {/* ── Actual groups from this TB, grouped by section ── */}
                                        {tbPresentation && tbPresentation.sections.length > 0
                                          ? tbPresentation.sections.map((section) => {
                                              // Only show group-level nodes (non-leaf) — never individual ledgers
                                              const groupNodes = section.nodes.filter(n => !n.isLeaf);
                                              if (groupNodes.length === 0) return null;
                                              return (
                                                <SelectGroup key={section.key}>
                                                  <SelectLabel className="text-[10px] text-muted-foreground px-2 py-1 font-semibold">
                                                    {section.label}
                                                  </SelectLabel>
                                                  {groupNodes.map((groupNode) => (
                                                    <SelectItem
                                                      key={groupNode.nodeId}
                                                      value={`${section.key}|||${groupNode.name}`}
                                                      className="text-xs"
                                                    >
                                                      {groupNode.name}
                                                    </SelectItem>
                                                  ))}
                                                </SelectGroup>
                                              );
                                            })
                                          : null}
                                        {/* ── Generic fallback categories ── */}
                                        <SelectGroup>
                                          <SelectLabel className="text-[10px] text-muted-foreground px-2 py-1 font-semibold">
                                            Generic Categories
                                          </SelectLabel>
                                          <SelectItem value="bs_asset" className="text-xs">BS — Asset (General)</SelectItem>
                                          <SelectItem value="bs_liability" className="text-xs">BS — Liability / Equity (General)</SelectItem>
                                          <SelectItem value="pl_income" className="text-xs">P&L — Income (General)</SelectItem>
                                          <SelectItem value="pl_expense" className="text-xs">P&L — Expense (General)</SelectItem>
                                        </SelectGroup>
                                      </SelectContent>
                                    </Select>
                                  </TableCell>
                                </TableRow>
                              );
                            })}
                        </TableBody>
                      </Table>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* View Toggle + Delete row — Delete always shown at step 5; tree/flat only when hierarchy exists */}
              <div className='flex items-center gap-2 flex-wrap'>
                {(tbHierarchyNodes.length > 0 || storedTbHierarchy.length > 0) && (
                  <>
                    <Button
                      variant={tbViewMode === 'tree' ? 'default' : 'outline'}
                      size='sm'
                      className='text-xs gap-1'
                      onClick={() => setTbViewMode('tree')}
                    >
                      <ChevronDown size={14} /> Hierarchy Tree
                    </Button>
                    <Button
                      variant={tbViewMode === 'flat' ? 'default' : 'outline'}
                      size='sm'
                      className='text-xs gap-1'
                      onClick={() => setTbViewMode('flat')}
                    >
                      <Table2 size={14} /> Flat Preview
                    </Button>
                  </>
                )}
                {/* Spacer */}
                <div className='flex-1' />
                {/* Delete & Re-upload button — always visible at step 5 regardless of hierarchy state */}
                <Button
                  variant='outline'
                  size='sm'
                  className='text-xs gap-1 border-destructive/40 text-destructive hover:bg-destructive hover:text-destructive-foreground'
                  onClick={handleDeleteTb}
                  disabled={deletingTb}
                >
                  {deletingTb
                    ? <><Loader2 size={13} className='animate-spin' /> Deleting...</>
                    : <><X size={13} /> Delete TB &amp; Re-upload</>
                  }
                </Button>
              </div>

              {/* Hierarchy Tree View */}
              {tbViewMode === "tree" && tbPresentation && (
                <Card>
                  <CardHeader className='pb-2'>
                    <CardTitle className='text-sm flex items-center gap-2'>
                      Trial Balance Hierarchy
                      <span className='text-xs font-normal text-muted-foreground'>
                        {tbPresentation.leafCount} ledgers · {tbPresentation.rootNodes.length} primary groups
                      </span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className='p-0'>
                    <div className='max-h-[600px] overflow-auto'>
                      <div className='flex items-center border-b-2 border-border bg-muted/50 px-2 py-2 text-[10px] font-bold text-muted-foreground uppercase sticky top-0 z-10'>
                        <div className='mr-2 w-4 shrink-0' />
                        <span className='flex-1'>Account / Group</span>
                        <span className='w-32 shrink-0 text-right pr-3'>Opening Bal</span>
                        <span className='w-32 shrink-0 text-right pr-3'>TXN DR</span>
                        <span className='w-32 shrink-0 text-right pr-3'>TXN CR</span>
                        <span className='w-32 shrink-0 text-right pr-3'>Closing Bal</span>
                      </div>

                      {tbPresentation.sections.map((section) => (
                        <div key={section.key}>
                          <div className='flex items-center px-4 py-1.5 text-[10px] font-bold uppercase tracking-wider border-b bg-muted/30 text-foreground'>
                            {section.label}
                          </div>
                          {section.nodes.map((node) => (
                            <TbTreeRow key={node.nodeId} node={node as TbHierarchyNode} allNodes={tbPresentation.activeNodes as TbHierarchyNode[]} depth={0} />
                          ))}
                          <div className='flex items-center border-b-2 px-2 py-1.5 text-[11px] font-bold bg-muted/20 text-foreground'>
                            <div className='mr-2 w-4 shrink-0' />
                            <span className='flex-1 pl-1'>{section.subtotalLabel}</span>
                            <span className='w-32 shrink-0 text-right tabular-nums font-mono pr-3'>{fmtTb(section.totals.opening)}</span>
                            <span className='w-32 shrink-0 text-right tabular-nums font-mono pr-3'>{fmtTb(section.totals.txnDebit)}</span>
                            <span className='w-32 shrink-0 text-right tabular-nums font-mono pr-3'>{fmtTb(section.totals.txnCredit)}</span>
                            <span className='w-32 shrink-0 text-right tabular-nums font-mono pr-3'>{fmtTb(section.totals.closing)}</span>
                          </div>
                        </div>
                      ))}

                      <div className='flex items-center border-t-2 border-border bg-primary/10 px-2 py-2 text-xs font-bold text-foreground sticky bottom-0'>
                        <div className='mr-2 w-4 shrink-0' />
                        <span className='flex-1 flex items-center gap-2'>
                          GRAND TOTAL
                          <Badge variant='outline' className='text-[9px] font-semibold'>✓ BALANCED</Badge>
                        </span>
                        <span className='w-32 shrink-0 text-right tabular-nums font-mono pr-3'>{fmtTb(tbPresentation.grandTotal.opening)}</span>
                        <span className='w-32 shrink-0 text-right tabular-nums font-mono pr-3'>{fmtTb(tbPresentation.grandTotal.txnDebit)}</span>
                        <span className='w-32 shrink-0 text-right tabular-nums font-mono pr-3'>{fmtTb(tbPresentation.grandTotal.txnCredit)}</span>
                        <span className='w-32 shrink-0 text-right tabular-nums font-mono pr-3'>{fmtTb(tbPresentation.grandTotal.closing)}</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Flat Preview Table */}
              {tbViewMode === "flat" && tbResult.preview.length > 0 && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Preview (first 20 accounts)</CardTitle>
                  </CardHeader>
                  <CardContent className="p-0">
                    <div className="max-h-64 overflow-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Account Name</TableHead>
                            <TableHead>Group</TableHead>
                            <TableHead className="text-right">Debit</TableHead>
                            <TableHead className="text-right">Credit</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {tbResult.preview.map((row: any, i: number) => (
                            <TableRow key={i}>
                              <TableCell className="text-xs">{row.account_name || row.ledger_name}</TableCell>
                              <TableCell className="text-xs text-muted-foreground">{row.account_group}</TableCell>
                              <TableCell className="text-xs text-right">{(row.debit || row.closing_dr || 0).toLocaleString("en-IN")}</TableCell>
                              <TableCell className="text-xs text-right">{(row.credit || row.closing_cr || 0).toLocaleString("en-IN")}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* No hierarchy — show flat by default */}
              {tbHierarchyNodes.length === 0 && storedTbHierarchy.length === 0 && tbResult.preview.length > 0 && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Preview (first 20 accounts)</CardTitle>
                  </CardHeader>
                  <CardContent className="p-0">
                    <div className="max-h-64 overflow-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Account Name</TableHead>
                            <TableHead>Group</TableHead>
                            <TableHead className="text-right">Debit</TableHead>
                            <TableHead className="text-right">Credit</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {tbResult.preview.map((row: any, i: number) => (
                            <TableRow key={i}>
                              <TableCell className="text-xs">{row.account_name || row.ledger_name}</TableCell>
                              <TableCell className="text-xs text-muted-foreground">{row.account_group}</TableCell>
                              <TableCell className="text-xs text-right">{(row.debit || row.closing_dr || 0).toLocaleString("en-IN")}</TableCell>
                              <TableCell className="text-xs text-right">{(row.credit || row.closing_cr || 0).toLocaleString("en-IN")}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </CardContent>
                </Card>
              )}
              {/* ─── Comparative / Prior Period TB ─── */}
              <Card>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <CalendarDays size={14} /> Comparative / Prior Period TB
                      {comparativeResult && (
                        <Badge className="bg-primary/10 text-primary text-[10px] ml-1">
                          {comparativeResult.priorFY} loaded
                        </Badge>
                      )}
                    </CardTitle>
                    <div className="flex items-center gap-2">
                      {comparativeResult && !showComparativeTb && (
                        <>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 text-xs gap-1"
                            onClick={() => setShowDeletePriorConfirm(true)}
                            disabled={deletingPriorTb}
                          >
                            {deletingPriorTb
                              ? <Loader2 size={12} className="animate-spin" />
                              : <X size={12} />}
                            Delete
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs gap-1"
                            onClick={() => setShowComparativeTb(true)}
                          >
                            <RefreshCw size={12} /> Re-upload
                          </Button>
                        </>
                      )}
                      {!comparativeResult && (
                        <Button variant="ghost" size="sm" onClick={() => setShowComparativeTb(!showComparativeTb)}>
                          {showComparativeTb ? "Hide" : "Add Prior Year TB"}
                        </Button>
                      )}
                    </div>
                  </div>
                </CardHeader>

                {/* Upload form — shown when no result yet, or when Re-upload clicked */}
                {showComparativeTb && (
                  <CardContent className="space-y-4">
                    <Alert className="py-2">
                      <AlertDescription className="text-xs">
                        Upload the previous year's Trial Balance to enable opening balance
                        verification, comparative financial statements, and year-on-year scrutiny rules.
                      </AlertDescription>
                    </Alert>
                    <div
                      className="border-2 border-dashed rounded-lg p-4 text-center cursor-pointer hover:bg-muted/30"
                      onClick={() => comparativeFileRef.current?.click()}
                    >
                      <Upload size={20} className="mx-auto mb-2 text-muted-foreground" />
                      <p className="text-sm text-muted-foreground">
                        {comparativeFile ? comparativeFile.name : "Upload Prior Year TB (Excel or PDF)"}
                      </p>
                      <input
                        ref={comparativeFileRef}
                        type="file"
                        className="hidden"
                        accept=".xlsx,.xls,.pdf"
                        onChange={e => setComparativeFile(e.target.files?.[0] || null)}
                      />
                    </div>
                    {comparativeFile && (
                      <Button size="sm" onClick={handleComparativeImport} disabled={comparativeProcessing} className="w-full gap-1">
                        {comparativeProcessing ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                        Import Prior Year TB
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full text-xs"
                      onClick={() => { setShowComparativeTb(false); setComparativeFile(null); }}
                    >
                      Cancel
                    </Button>
                  </CardContent>
                )}

                {/* Full-column comparison table — shown after data is loaded */}
                {comparativeResult && !showComparativeTb && (
                  <CardContent className="space-y-3 pt-0">
                    <div className="flex gap-4 text-xs flex-wrap">
                      <span className="text-primary font-medium">✓ Matched: {comparativeResult.matched}</span>
                      <span className="text-destructive font-medium">✗ Mismatched: {comparativeResult.mismatched}</span>
                      <span className="text-muted-foreground">Total compared: {comparativeResult.total}</span>
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      Opening variance = CY Opening − PY Closing.{" "}
                      <span className="text-amber-600 font-medium">Amber</span> = significant variance (&gt;10% or &gt;₹10,000).{" "}
                      <span className="text-destructive font-medium">Red</span> = any mismatch ≥ ₹1.
                    </p>
                    <div className="border rounded-lg overflow-auto max-h-72">
                      <table className="w-full text-xs min-w-[1000px]">
                        <thead className="bg-muted sticky top-0">
                          <tr>
                            <th className="text-left p-2 min-w-[160px]">Account Name</th>
                            <th className="text-left p-2 min-w-[100px]">Group</th>
                            <th className="text-right p-2 min-w-[90px]">PY Opening</th>
                            <th className="text-right p-2 min-w-[80px]">PY Txn Dr</th>
                            <th className="text-right p-2 min-w-[80px]">PY Txn Cr</th>
                            <th className="text-right p-2 min-w-[90px]">PY Closing</th>
                            <th className="text-right p-2 min-w-[90px]">CY Opening</th>
                            <th className="text-right p-2 min-w-[100px] font-bold text-foreground">Opening Var</th>
                            <th className="text-right p-2 min-w-[80px]">CY Txn Dr</th>
                            <th className="text-right p-2 min-w-[80px]">CY Txn Cr</th>
                            <th className="text-right p-2 min-w-[90px]">CY Closing</th>
                            <th className="text-right p-2 min-w-[90px]">Closing Var</th>
                            <th className="text-center p-2 min-w-[70px]">Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {comparativeResult.verificationRows.map((row: any, i: number) => (
                            <tr
                              key={i}
                              className={cn(
                                "border-t",
                                row.significantVar
                                  ? "bg-amber-50 dark:bg-amber-950/20"
                                  : row.isMismatch
                                  ? "bg-destructive/5"
                                  : ""
                              )}
                            >
                              <td className="p-2 font-medium">{row.name}</td>
                              <td className="p-2 text-muted-foreground text-[11px]">{row.group}</td>
                              <td className="p-2 text-right font-mono">{(row.pyOpening || 0).toLocaleString("en-IN")}</td>
                              <td className="p-2 text-right font-mono text-muted-foreground">{(row.pyTxnDebit || 0).toLocaleString("en-IN")}</td>
                              <td className="p-2 text-right font-mono text-muted-foreground">{(row.pyTxnCredit || 0).toLocaleString("en-IN")}</td>
                              <td className="p-2 text-right font-mono">{(row.pyClosing || 0).toLocaleString("en-IN")}</td>
                              <td className="p-2 text-right font-mono">{(row.cyOpening || 0).toLocaleString("en-IN")}</td>
                              <td className={cn("p-2 text-right font-mono font-semibold",
                                row.significantVar
                                  ? "text-amber-600"
                                  : row.isMismatch
                                  ? "text-destructive"
                                  : "text-primary"
                              )}>
                                {row.openingVar !== 0
                                  ? (row.openingVar > 0 ? "+" : "") + row.openingVar.toLocaleString("en-IN")
                                  : "✓"}
                              </td>
                              <td className="p-2 text-right font-mono text-muted-foreground">{(row.cyTxnDebit || 0).toLocaleString("en-IN")}</td>
                              <td className="p-2 text-right font-mono text-muted-foreground">{(row.cyTxnCredit || 0).toLocaleString("en-IN")}</td>
                              <td className="p-2 text-right font-mono">{(row.cyClosing || 0).toLocaleString("en-IN")}</td>
                              <td className={cn("p-2 text-right font-mono",
                                Math.abs(row.closingVar || 0) >= 1
                                  ? "text-amber-600 font-medium"
                                  : "text-muted-foreground"
                              )}>
                                {(row.closingVar || 0) !== 0
                                  ? (row.closingVar > 0 ? "+" : "") + row.closingVar.toLocaleString("en-IN")
                                  : "—"}
                              </td>
                              <td className="p-2 text-center">
                                <Badge className={row.isMismatch
                                  ? "bg-destructive/10 text-destructive text-[9px]"
                                  : "bg-primary/10 text-primary text-[9px]"
                                }>
                                  {row.isMismatch ? "Mismatch" : "Match"}
                                </Badge>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </CardContent>
                )}
              </Card>

              {/* ─── Proceed to COA Mapping ─── */}
              {(tbHierarchyNodes.length > 0 || storedTbHierarchy.length > 0) && tbStep === 5 && (
                <Card className="border-primary/20 bg-primary/5">
                  <CardContent className="p-4 flex items-center justify-between flex-wrap gap-3">
                    <div>
                      <p className="text-sm font-semibold text-foreground">Next: Map Ledgers to COA</p>
                      <p className="text-xs text-muted-foreground">
                        {(() => {
                          const src = tbHierarchyNodes.length > 0 ? tbHierarchyNodes : storedTbHierarchy;
                          return `${src.filter(n => n.isLeaf).length} leaf ledgers ready for mapping to Schedule III account heads.`;
                        })()}
                      </p>
                    </div>
                    <Button
                      onClick={handleInitCoaMapping}
                      disabled={coaMappingLoading}
                      className="gap-2"
                    >
                      {coaMappingLoading
                        ? <><Loader2 size={14} className="animate-spin" /> Loading AI Suggestions…</>
                        : <><Sparkles size={14} /> Map to COA with AI</>
                      }
                    </Button>
                  </CardContent>
                </Card>
              )}
            </div>
          )}

          {/* ─── Step 6: COA Mapping ─── */}
          {tbStep === 6 && (
            <div className="space-y-4">
              {/* Header */}
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                  <h3 className="text-base font-semibold flex items-center gap-2">
                    <Link2 size={16} className="text-primary" /> COA Mapping
                    <Badge variant="secondary" className="text-[10px]">
                      {coaMappingRows.filter(r => r.accepted || r.alreadyMapped).length} / {coaMappingRows.length} mapped
                    </Badge>
                  </h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    AI suggestions shown. Accept, edit, or skip each ledger. Only ledgers are mapped — groups are used as context.
                  </p>
                </div>
                <div className="flex gap-2 flex-wrap">
                  <Button variant="outline" size="sm" className="gap-1" onClick={() => setTbStep(5)}>
                    <ArrowLeft size={13} /> Back
                  </Button>
                  <Button
                    size="sm"
                    className="gap-1"
                    onClick={() => {
                      setCoaMappingRows(prev => prev.map(r => (!r.alreadyMapped && !r.skipped && r.suggestedHead) ? { ...r, accepted: true, customHead: r.customHead || r.suggestedHead, customGroup: r.customGroup || r.suggestedGroup, customBsPl: r.customBsPl || r.suggestedBsPl } : r));
                      toast.success("Accepted all AI suggestions");
                    }}
                  >
                    <Check size={13} /> Accept All Suggestions
                  </Button>
                  <Button
                    size="sm"
                    variant="default"
                    className="gap-1"
                    onClick={handleSaveCoaMappings}
                    disabled={coaMappingSaving || coaMappingRows.filter(r => r.accepted && !r.alreadyMapped).length === 0}
                  >
                    {coaMappingSaving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                    Save {coaMappingRows.filter(r => r.accepted && !r.alreadyMapped).length} Mappings
                  </Button>
                </div>
              </div>

              {/* Progress bar */}
              <div className="space-y-1">
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>{coaMappingRows.filter(r => r.accepted || r.alreadyMapped).length} mapped</span>
                  <span>{coaMappingRows.filter(r => r.skipped).length} skipped</span>
                  <span>{coaMappingRows.filter(r => !r.accepted && !r.skipped && !r.alreadyMapped).length} pending</span>
                </div>
                <Progress
                  value={coaMappingRows.length > 0 ? (coaMappingRows.filter(r => r.accepted || r.alreadyMapped).length / coaMappingRows.length) * 100 : 0}
                  className="h-2"
                />
              </div>

              {coaMappingDone && (
                <Alert className="border-primary/30 bg-primary/5">
                  <CheckCircle2 className="h-4 w-4 text-primary" />
                  <AlertTitle className="text-primary text-sm">Mappings Saved!</AlertTitle>
                  <AlertDescription className="text-xs">
                    COA mappings saved. Financial statements can now be prepared from these mapped ledgers.
                    View the full COA Mappings Master for more options.
                  </AlertDescription>
                </Alert>
              )}

              {/* Mapping table */}
              <Card>
                <CardContent className="p-0">
                  <div className="overflow-auto max-h-[600px]">
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 z-10 bg-muted border-b">
                        <tr>
                          <th className="text-left p-2 font-semibold w-48">Ledger (Tally)</th>
                          <th className="text-left p-2 font-semibold w-32">Tally Group</th>
                          <th className="text-right p-2 font-semibold w-24">Closing</th>
                          <th className="text-left p-2 font-semibold">Standard Head</th>
                          <th className="text-left p-2 font-semibold w-28">Account Group</th>
                          <th className="text-center p-2 font-semibold w-16">BS/PL</th>
                          <th className="text-center p-2 font-semibold w-20">Confidence</th>
                          <th className="text-center p-2 font-semibold w-28">Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {coaMappingRows.map((row, idx) => (
                          <tr
                            key={row.ledger}
                            className={cn(
                              "border-b transition-colors",
                              row.alreadyMapped ? "bg-primary/5 opacity-70" :
                              row.accepted ? "bg-green-50 dark:bg-green-950/20" :
                              row.skipped ? "bg-muted/30 opacity-60" : "hover:bg-muted/30"
                            )}
                          >
                            <td className="p-2 font-mono font-medium truncate max-w-[180px]" title={row.ledger}>
                              {row.ledger}
                            </td>
                            <td className="p-2 text-muted-foreground truncate max-w-[120px]" title={row.tallyGroup}>
                              {row.tallyGroup || "—"}
                            </td>
                            <td className="p-2 text-right font-mono tabular-nums text-muted-foreground">
                              {row.closing ? row.closing.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 0 }) : "—"}
                            </td>
                            {/* Editable Standard Head */}
                            <td className="p-1">
                              {row.alreadyMapped || row.skipped ? (
                                <span className="text-muted-foreground px-1">{row.customHead || row.suggestedHead || "—"}</span>
                              ) : (
                                <input
                                  type="text"
                                  className="w-full border border-border rounded px-2 py-1 text-xs bg-background focus:ring-1 focus:ring-primary outline-none"
                                  value={row.customHead}
                                  onChange={(e) => setCoaMappingRows(prev => prev.map((r, i) => i === idx ? { ...r, customHead: e.target.value } : r))}
                                  placeholder={row.suggestedHead || "Enter standard head"}
                                />
                              )}
                              {row.reason && !row.alreadyMapped && (
                                <p className="text-[10px] text-muted-foreground/70 px-1 mt-0.5 italic truncate" title={row.reason}>
                                  {row.reason}
                                </p>
                              )}
                            </td>
                            {/* Account Group */}
                            <td className="p-1">
                              {row.alreadyMapped || row.skipped ? (
                                <span className="text-muted-foreground px-1">{row.customGroup || "—"}</span>
                              ) : (
                                <input
                                  type="text"
                                  className="w-full border border-border rounded px-2 py-1 text-xs bg-background focus:ring-1 focus:ring-primary outline-none"
                                  value={row.customGroup}
                                  onChange={(e) => setCoaMappingRows(prev => prev.map((r, i) => i === idx ? { ...r, customGroup: e.target.value } : r))}
                                  placeholder="Group"
                                />
                              )}
                            </td>
                            {/* BS/PL */}
                            <td className="p-1 text-center">
                              {row.alreadyMapped || row.skipped ? (
                                <Badge variant="outline" className="text-[9px]">{row.customBsPl || "BS"}</Badge>
                              ) : (
                                <select
                                  className="border border-border rounded px-1 py-1 text-xs bg-background"
                                  value={row.customBsPl}
                                  onChange={(e) => setCoaMappingRows(prev => prev.map((r, i) => i === idx ? { ...r, customBsPl: e.target.value } : r))}
                                >
                                  <option value="BS">BS</option>
                                  <option value="PL">PL</option>
                                </select>
                              )}
                            </td>
                            {/* Confidence */}
                            <td className="p-2 text-center">
                              {row.alreadyMapped ? (
                                <Badge className="text-[9px] bg-primary/10 text-primary">Saved</Badge>
                              ) : row.confidence === "high" ? (
                                <Badge className="text-[9px] bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300">High</Badge>
                              ) : row.confidence === "medium" ? (
                                <Badge className="text-[9px] bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">Medium</Badge>
                              ) : row.confidence === "low" ? (
                                <Badge className="text-[9px] bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300">Low</Badge>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </td>
                            {/* Actions */}
                            <td className="p-1 text-center">
                              {row.alreadyMapped ? (
                                <span className="text-[10px] text-primary font-medium">✓ Mapped</span>
                              ) : row.skipped ? (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-6 text-[10px] px-2"
                                  onClick={() => setCoaMappingRows(prev => prev.map((r, i) => i === idx ? { ...r, skipped: false } : r))}
                                >
                                  Undo
                                </Button>
                              ) : (
                                <div className="flex items-center justify-center gap-1">
                                  <Button
                                    size="sm"
                                    variant={row.accepted ? "default" : "outline"}
                                    className="h-6 px-2 text-[10px] gap-0.5"
                                    onClick={() => setCoaMappingRows(prev => prev.map((r, i) => i === idx ? { ...r, accepted: !r.accepted } : r))}
                                  >
                                    <Check size={10} />
                                    {row.accepted ? "Acc" : "Accept"}
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-6 px-1.5 text-[10px]"
                                    onClick={() => setCoaMappingRows(prev => prev.map((r, i) => i === idx ? { ...r, skipped: true, accepted: false } : r))}
                                  >
                                    <SkipForward size={10} />
                                  </Button>
                                </div>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
        </TabsContent>

        {/* ═══════ LEDGER IMPORT TAB ═══════ */}
        <TabsContent value="ledger" className="space-y-4 mt-4">
          {/* Step 1: Upload */}
          {ledgerStep === 1 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Upload Ledger Files</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-xs text-muted-foreground">
                  Upload one or more ledger files. Supports combined file or one file per account.
                  Expert Software format: Date, Voucher Type, Voucher No, Narration, Debit, Credit, Balance.
                </p>
                <div
                  className="border-2 border-dashed rounded-lg p-10 text-center cursor-pointer hover:border-primary/50 transition-colors"
                  onClick={() => ledgerFileRef.current?.click()}
                  onDragOver={e => e.preventDefault()}
                  onDrop={e => {
                    e.preventDefault();
                    const files = Array.from(e.dataTransfer.files);
                    if (files.length > 0) {
                      setLedgerFiles(files);
                      const reader = new FileReader();
                      reader.onload = (evt) => {
                        const data = evt.target?.result;
                        const wb = XLSX.read(data, { type: "array" });
                        const ws = wb.Sheets[wb.SheetNames[0]];
                        const jsonData: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1 });
                        setLedgerParsedData(jsonData);
                        if (jsonData.length > 0) {
                          const hRow = jsonData[0].map((h: any) => String(h || "").trim()).filter(Boolean);
                          setLedgerHeaders(hRow);
                          setLedgerMapping(autoDetectLedgerMapping(hRow));
                        }
                        setLedgerStep(2);
                      };
                      reader.readAsArrayBuffer(files[0]);
                    }
                  }}
                >
                  <Upload size={40} className="mx-auto text-muted-foreground mb-3" />
                  <p className="text-sm font-medium">Click or drag ledger files here</p>
                  <p className="text-xs text-muted-foreground mt-1">.xlsx, .xls, .csv — Multiple files supported — Max 50MB each</p>
                  <input
                    ref={ledgerFileRef}
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    multiple
                    className="hidden"
                    onChange={handleLedgerFileUpload}
                  />
                </div>

                {/* Previous batches */}
                {(ledgerBatches || []).length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-muted-foreground uppercase">Previous Imports</p>
                    {ledgerBatches!.map((b: any) => (
                      <div key={b.id} className="flex items-center justify-between p-2 bg-muted/50 rounded text-xs">
                        <span>{b.original_filename}</span>
                        <div className="flex items-center gap-2">
                          <span className="text-muted-foreground">{b.row_count} rows</span>
                          <Badge variant={b.processing_status === "complete" ? "default" : "secondary"} className="text-[9px]">
                            {b.processing_status}
                          </Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Step 2: Column Mapper */}
          {ledgerStep === 2 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  Map Ledger Columns
                  <Badge variant="outline" className="text-[10px] ml-2">{ledgerFiles.length} file(s)</Badge>
                  <Button variant="outline" size="sm" className="ml-auto gap-1" onClick={() => {
                    setLedgerMapping(autoDetectLedgerMapping(ledgerHeaders));
                    toast.success("Auto-mapped columns");
                  }}>
                    Map Similar
                  </Button>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {LEDGER_TARGET_FIELDS.map(field => (
                  <div key={field.key} className="flex items-center gap-3">
                    <div className="w-36 text-sm font-medium">
                      {field.label} {field.required && <span className="text-destructive">*</span>}
                    </div>
                    <Select
                      value={ledgerMapping[field.key] || ""}
                      onValueChange={v => setLedgerMapping(m => ({ ...m, [field.key]: v }))}
                    >
                      <SelectTrigger className="flex-1"><SelectValue placeholder="Select column" /></SelectTrigger>
                      <SelectContent>
                        {ledgerHeaders.map(h => <SelectItem key={h} value={h}>{h}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
                <div className="flex justify-between pt-3">
                  <Button variant="ghost" size="sm" onClick={() => setLedgerStep(1)}>
                    <ArrowLeft size={14} className="mr-1" /> Back
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleLedgerProcess}
                    disabled={!LEDGER_TARGET_FIELDS.filter(f => f.required).every(f => ledgerMapping[f.key])}
                  >
                    Process Ledger <ArrowRight size={14} className="ml-1" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Step 3: Processing */}
          {ledgerStep === 3 && (
            <Card>
              <CardContent className="p-6 text-center space-y-3">
                <Loader2 size={32} className="mx-auto animate-spin text-primary" />
                <p className="text-sm font-medium">Processing Ledger Transactions...</p>
                <Progress value={ledgerProgress} className="h-2" />
                <p className="text-xs text-muted-foreground">{Math.round(ledgerProgress)}% complete</p>
              </CardContent>
            </Card>
          )}

          {/* Step 4: Result */}
          {ledgerStep === 4 && ledgerResult && (
            <div className="space-y-4">
              <div className="grid grid-cols-4 gap-3">
                <Card>
                  <CardContent className="p-4 text-center">
                    <p className="text-2xl font-bold text-foreground">{ledgerResult.totalTransactions.toLocaleString()}</p>
                    <p className="text-xs text-muted-foreground">Transactions</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4 text-center">
                    <p className="text-2xl font-bold text-foreground">{ledgerResult.accountCount}</p>
                    <p className="text-xs text-muted-foreground">Accounts</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4 text-center">
                    <p className="text-sm font-medium text-foreground">{ledgerResult.dateRange}</p>
                    <p className="text-xs text-muted-foreground">Date Range</p>
                  </CardContent>
                </Card>
                <Card className={ledgerResult.flaggedCount > 0 ? "border-amber-500/30" : "border-primary/30"}>
                  <CardContent className="p-4 text-center">
                    <p className={cn("text-2xl font-bold", ledgerResult.flaggedCount > 0 ? "text-amber-600" : "text-primary")}>
                      {ledgerResult.flaggedCount}
                    </p>
                    <p className="text-xs text-muted-foreground">Flagged</p>
                  </CardContent>
                </Card>
              </div>

              <Alert className="border-primary/30 bg-primary/5">
                <CheckCircle2 className="h-4 w-4 text-primary" />
                <AlertTitle className="text-primary">Ledger Import Complete</AlertTitle>
                <AlertDescription className="text-sm">
                  {ledgerResult.totalTransactions} transactions from {ledgerResult.accountCount} accounts imported successfully.
                  {ledgerResult.flaggedCount > 0 && ` ${ledgerResult.flaggedCount} transactions flagged for review.`}
                </AlertDescription>
              </Alert>

              <div className="flex gap-2">
                {ledgerResult.flaggedCount > 0 && (
                  <Button variant="outline" size="sm" onClick={() => setShowFlagged(!showFlagged)} className="gap-1">
                    <Flag size={14} /> {showFlagged ? "Hide" : "View"} Flagged Transactions
                  </Button>
                )}
                <Button variant="outline" size="sm" onClick={() => { setLedgerStep(1); setLedgerResult(null); }} className="gap-1">
                  <Upload size={14} /> Import More
                </Button>
              </div>

              {/* Flagged transactions table */}
              {showFlagged && (flaggedTransactions || []).length > 0 && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Flag size={14} className="text-amber-600" /> Flagged Transactions
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-0">
                    <div className="max-h-72 overflow-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Date</TableHead>
                            <TableHead>Account</TableHead>
                            <TableHead>Narration</TableHead>
                            <TableHead className="text-right">Amount</TableHead>
                            <TableHead>Flag Reason</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {(flaggedTransactions || []).map((txn: any) => (
                            <TableRow key={txn.id}>
                              <TableCell className="text-xs">{txn.date}</TableCell>
                              <TableCell className="text-xs">{txn.account_name}</TableCell>
                              <TableCell className="text-xs max-w-[200px] truncate">{txn.narration || "—"}</TableCell>
                              <TableCell className="text-xs text-right">
                                {((txn.debit || 0) + (txn.credit || 0)).toLocaleString("en-IN")}
                              </TableCell>
                              <TableCell>
                                <Badge variant="outline" className="text-[9px] text-amber-600 border-amber-500/30">
                                  {txn.flag_reason}
                                </Badge>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Override Dialog */}
      <Dialog open={tbShowOverride} onOpenChange={setTbShowOverride}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Override Validation</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Difference of ₹{tbResult?.difference.toLocaleString("en-IN")} detected. Provide a justification to proceed.
          </p>
          <Textarea
            value={tbOverrideJustification}
            onChange={e => setTbOverrideJustification(e.target.value)}
            placeholder="Reason for accepting unbalanced TB (audit note will be created)..."
            rows={3}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setTbShowOverride(false)}>Cancel</Button>
            <Button onClick={handleTbOverride} disabled={!tbOverrideJustification.trim()}>
              Override & Proceed
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Prior Period TB Confirmation */}
      <Dialog open={showDeletePriorConfirm} onOpenChange={setShowDeletePriorConfirm}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Delete Prior Year Trial Balance?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This will permanently remove the prior year TB data for this engagement.
            The comparison table will be cleared. You can re-upload at any time.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeletePriorConfirm(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDeletePriorTb} disabled={deletingPriorTb}>
              {deletingPriorTb ? <Loader2 size={14} className="animate-spin mr-1" /> : null}
              Delete Prior Year TB
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Replace Existing TB Dialog */}
      <Dialog open={showReplaceDialog} onOpenChange={setShowReplaceDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Existing Trial Balance Found</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            A Trial Balance already exists for this engagement. Replacing it will delete all existing TB data including hierarchy nodes and tagged categories.
          </p>
          <p className="text-sm font-medium">Replace existing Trial Balance?</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowReplaceDialog(false)}>Cancel</Button>
            <Button variant="destructive" onClick={() => handleTbProcess()}>
              Replace
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Helper ───
function parseDate(val: any): string | null {
  if (!val) return null;
  if (typeof val === "number") {
    const d = new Date((val - 25569) * 86400 * 1000);
    return d.toISOString().split("T")[0];
  }
  const s = String(val).trim();
  const parts = s.split(/[\/\-\.]/);
  if (parts.length === 3) {
    const [a, b, c] = parts;
    if (a.length === 4) return `${a}-${b.padStart(2, "0")}-${c.padStart(2, "0")}`;
    if (c.length === 4) return `${c}-${b.padStart(2, "0")}-${a.padStart(2, "0")}`;
  }
  try {
    return new Date(s).toISOString().split("T")[0];
  } catch {
    return null;
  }
}
