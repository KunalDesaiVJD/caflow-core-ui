import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
  CalendarDays
} from "lucide-react";
import { buildTbPresentationModel, type TbPresentationModel } from "@/lib/tb-hierarchy";

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
}

// ─── Chunk size for large file uploads (1.5MB base64 per chunk) ───
const CHUNK_SIZE_BYTES = 1.5 * 1024 * 1024;

// Format: show dash when value is zero, Indian number format otherwise
const fmtTb = (v: number) =>
  v === 0 ? '—'
  : v.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

function TbTreeRow({ node, allNodes, depth = 0 }:
  { node: TbHierarchyNode; allNodes: TbHierarchyNode[]; depth?: number }) {

  const [open, setOpen] = useState(depth < 1);
  const children = allNodes.filter(n => n.parentNodeId === node.nodeId);
  const hasChildren = children.length > 0;

  const presentation = buildTbPresentationModel(allNodes);
  const vals = node.isLeaf
    ? { opening: node.opening||0, txnDebit: node.txnDebit||0,
        txnCredit: node.txnCredit||0, closing: node.closing||0 }
    : presentation.activeNodes.find((item) => item.nodeId === node.nodeId)
      ? buildTbPresentationModel(allNodes).activeNodes.find((item) => item.nodeId === node.nodeId)
      : { opening: node.opening||0, txnDebit: node.txnDebit||0, txnCredit: node.txnCredit||0, closing: node.closing||0 };

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
  const [deletingTb, setDeletingTb] = useState(false);
  const [tbStatusMsg, setTbStatusMsg] = useState('');

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
        .select("node_id, parent_node_id, tally_group_name, level, is_leaf, opening_balance, txn_debit, txn_credit, closing_balance, primary_group, bs_pl_side")
        .eq("engagement_id", engagementId)
        .order("row_number", { ascending: true });

      if (error) throw error;

      return (data || []).map((row: any) => ({
        nodeId: row.node_id,
        parentNodeId: row.parent_node_id,
        name: row.tally_group_name,
        level: row.level || 1,
        isLeaf: !!row.is_leaf,
        opening: row.opening_balance || 0,
        txnDebit: row.txn_debit || 0,
        txnCredit: row.txn_credit || 0,
        closing: row.closing_balance || 0,
        primaryGroup: row.primary_group || row.tally_group_name,
        bsPlSide: row.bs_pl_side || 'Unknown',
      }));
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
  useEffect(() => {
    if (storedTbHierarchy.length > 0) {
      const leafRows = storedTbHierarchy.filter((row) => row.isLeaf);
      const debitTotal = leafRows.reduce((sum, row) => sum + (row.txnDebit || 0), 0);
      const creditTotal = leafRows.reduce((sum, row) => sum + (row.txnCredit || 0), 0);
      const difference = Math.abs(debitTotal - creditTotal);

      setTbHierarchyNodes(storedTbHierarchy);
      setTbResult((prev) => prev || {
        totalAccounts: leafRows.length,
        debitTotal: Math.round(debitTotal * 100) / 100,
        creditTotal: Math.round(creditTotal * 100) / 100,
        difference: Math.round(difference * 100) / 100,
        isValid: difference <= 1,
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

    if (existingTb && (existingTb as any).is_validated) {
      const tb = existingTb as any;
      setTbResult({
        totalAccounts: (tb.normalised_data as any[])?.length || 0,
        debitTotal: tb.debit_total || 0,
        creditTotal: tb.credit_total || 0,
        difference: tb.difference || 0,
        isValid: tb.validation_status === "valid",
        preview: ((tb.normalised_data as any[]) || []).slice(0, 20),
      });
      setTbStep(5);
    }
  }, [existingTb, storedTbHierarchy]);

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
          // Also parse locally for row count preview
          const wb = XLSX.read(data, { type: "array" });
          const ws = wb.Sheets[wb.SheetNames[0]];
          const jsonData: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1 });
          setTbParsedData(jsonData);
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

        const mappedHierarchy: TbHierarchyNode[] = ((data.hierarchy || []) as any[]).map((row: any) => ({
          nodeId: row.nodeId,
          parentNodeId: row.parentNodeId,
          name: row.name,
          level: row.level || 1,
          isLeaf: !!row.isLeaf,
          opening: row.opening || 0,
          txnDebit: row.txnDebit || 0,
          txnCredit: row.txnCredit || 0,
          closing: row.closing || 0,
          primaryGroup: row.primaryGroup || row.name,
          bsPlSide: row.bsPlSide || 'Unknown',
        }));
        const leafPreview = mappedHierarchy.filter((n) => n.isLeaf).slice(0, 20);
        setTbHierarchyNodes(mappedHierarchy);

        // Store validation result
        if (data.validation) {
          setTbValidation(data.validation);
        }

        setTbResult({
          totalAccounts: data.leafLedgers,
          debitTotal: Math.round(data.totalDr * 100) / 100,
          creditTotal: Math.round(data.totalCr * 100) / 100,
          difference: Math.round(Math.abs(data.totalDr - data.totalCr) * 100) / 100,
          isValid: data.isBalanced,
          preview: leafPreview.map((n) => ({
            account_name: n.name,
            account_group: n.primaryGroup,
            debit: n.txnDebit,
            credit: n.txnCredit,
          })),
        });

        setTbStep(5);
        toast.success(`${data.leafLedgers} ledgers imported — ${data.detectedFormat} format detected. Groups: ${data.groupsDetected}, Skipped: ${data.rowsSkipped}`);
        queryClient.invalidateQueries({ queryKey: ["tb-snapshot-for-engagement"] });
        queryClient.invalidateQueries({ queryKey: ["tb-hierarchy-nodes"] });
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

      const priorLeaves: any[] = (data.hierarchy || []).filter((n: any) => n.isLeaf);
      const currentLeaves = (tbHierarchyNodes.length > 0 ? tbHierarchyNodes : storedTbHierarchy).filter(n => n.isLeaf);
      const priorClosingMap = new Map<string, number>();
      for (const n of priorLeaves) {
        priorClosingMap.set(String(n.name).toLowerCase().trim(), n.closing || 0);
      }

      const verificationRows: any[] = [];
      let matched = 0, mismatched = 0;
      for (const n of currentLeaves) {
        const key = n.name.toLowerCase().trim();
        const pyClosing = priorClosingMap.get(key);
        if (pyClosing === undefined) continue;
        const cyOpening = n.opening || 0;
        const diff = Math.abs(Math.abs(cyOpening) - Math.abs(pyClosing));
        if (diff < 1) matched++; else mismatched++;
        verificationRows.push({ name: n.name, pyClosing, cyOpening, diff: diff < 1 ? 0 : diff });
      }
      verificationRows.sort((a: any, b: any) => b.diff - a.diff);

      setComparativeResult({
        verificationRows: verificationRows.slice(0, 100),
        matched,
        mismatched,
        total: matched + mismatched,
        priorFY,
      });
      toast.success(`Prior year TB imported. ${mismatched} opening balance mismatches found.`);
    } catch (err: any) {
      toast.error(err.message || "Prior year import failed");
    } finally {
      setComparativeProcessing(false);
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

  // Check if stage 2 can be completed
  const canComplete = tbResult?.isValid || (existingTb as any)?.is_validated;

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
            {["Format", "Upload", "Map Columns", "Process", "Result"].map((label, i) => (
              <div key={label} className={cn(
                "flex-1 text-center text-[10px] py-1 rounded-sm font-medium",
                tbStep > i + 1 ? "bg-primary/20 text-primary" :
                tbStep === i + 1 ? "bg-primary text-primary-foreground" :
                "bg-muted text-muted-foreground"
              )}>
                {label}
              </div>
            ))}
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
                <Alert variant="destructive">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertTitle>Validation Failed</AlertTitle>
                  <AlertDescription className="text-sm">
                    Difference of ₹{tbResult.difference.toLocaleString("en-IN")} detected between Debits and Credits.
                    <div className="flex gap-2 mt-2">
                      <Button size="sm" variant="outline" onClick={() => { setTbStep(1); setTbResult(null); setTbValidation(null); }}>
                        Re-upload
                      </Button>
                      <Button size="sm" variant="destructive" onClick={() => setTbShowOverride(true)}>
                        Override with Justification
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
                        <span>BS Assets ≈ Liabilities: {Math.abs(tbValidation.bsAssets - tbValidation.bsLiabilities) < 1 ? "Yes" : "No"}</span>
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
                  </CardContent>
                </Card>
              )}

              {/* View Toggle */}
              {(tbHierarchyNodes.length > 0 || storedTbHierarchy.length > 0) && (
                <div className='flex items-center gap-2 flex-wrap'>
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
                  {/* Spacer */}
                  <div className='flex-1' />
                  {/* Delete & Re-upload button */}
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
              )}

              {/* Hierarchy Tree View */}
              {tbViewMode === "tree" && (tbHierarchyNodes.length > 0 || storedTbHierarchy.length > 0) && (() => {
                const rawNodes = tbHierarchyNodes.length > 0 ? tbHierarchyNodes : storedTbHierarchy;
                // Reconstruct parent-child from row order if hierarchy is flat
                const hasParents = rawNodes.some(n => n.parentNodeId !== null);
                const activeNodes = hasParents ? rawNodes : buildVirtualHierarchy(rawNodes);
                const rootNodes = activeNodes.filter(n => n.parentNodeId === null);

                // Classify root groups into sections
                const sections: { key: SectionType; label: string; colorClass: string; subtotalLabel: string; nodes: TbHierarchyNode[] }[] = [
                  { key: 'bs_asset', label: 'BALANCE SHEET — ASSETS', colorClass: 'bg-emerald-600/15 text-emerald-400 border-emerald-600/30', subtotalLabel: 'TOTAL ASSETS', nodes: [] },
                  { key: 'bs_liability', label: 'BALANCE SHEET — LIABILITIES & EQUITY', colorClass: 'bg-emerald-600/15 text-emerald-400 border-emerald-600/30', subtotalLabel: 'TOTAL LIABILITIES & EQUITY', nodes: [] },
                  { key: 'pl_income', label: 'P&L — INCOME', colorClass: 'bg-amber-600/15 text-amber-400 border-amber-600/30', subtotalLabel: 'TOTAL INCOME', nodes: [] },
                  { key: 'pl_expense', label: 'P&L — EXPENSES', colorClass: 'bg-purple-600/15 text-purple-400 border-purple-600/30', subtotalLabel: 'TOTAL EXPENSES', nodes: [] },
                  { key: 'unknown', label: 'UNCLASSIFIED', colorClass: 'bg-muted/30 text-muted-foreground border-border', subtotalLabel: 'TOTAL UNCLASSIFIED', nodes: [] },
                ];
                for (const node of rootNodes) {
                  const section = classifyGroup(node.name, node.bsPlSide);
                  const s = sections.find(s => s.key === section);
                  if (s) s.nodes.push(node);
                }
                // Filter out empty sections
                const activeSections = sections.filter(s => s.nodes.length > 0);

                // Grand total across ALL leaves
                const grandTotal = rootNodes.reduce((acc, root) => {
                  const v = sumLeafDescendants(root.nodeId, activeNodes);
                  return {
                    opening: acc.opening + v.opening,
                    txnDebit: acc.txnDebit + v.txnDebit,
                    txnCredit: acc.txnCredit + v.txnCredit,
                    closing: acc.closing + v.closing,
                  };
                }, { opening: 0, txnDebit: 0, txnCredit: 0, closing: 0 });

                const isBalanced = Math.abs(grandTotal.txnDebit - grandTotal.txnCredit) < 1;

                const leafCount = activeNodes.filter(n => n.isLeaf).length;

                return (
                  <Card>
                    <CardHeader className='pb-2'>
                      <CardTitle className='text-sm flex items-center gap-2'>
                        Trial Balance Hierarchy
                        <span className='text-xs font-normal text-muted-foreground'>
                          {leafCount} ledgers · {rootNodes.length} primary groups
                        </span>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className='p-0'>
                      <div className='max-h-[600px] overflow-auto'>
                        {/* Sticky header */}
                        <div className='flex items-center border-b-2 border-border bg-muted/50 px-2 py-2 text-[10px] font-bold text-muted-foreground uppercase sticky top-0 z-10'>
                          <div className='mr-2 w-4 shrink-0' />
                          <span className='flex-1'>Account / Group</span>
                          <span className='w-32 shrink-0 text-right pr-3'>Opening Bal</span>
                          <span className='w-32 shrink-0 text-right pr-3'>TXN DR</span>
                          <span className='w-32 shrink-0 text-right pr-3'>TXN CR</span>
                          <span className='w-32 shrink-0 text-right pr-3'>Closing Bal</span>
                        </div>

                        {/* Sections with headers & subtotals */}
                        {activeSections.map(section => {
                          const sectionTotal = section.nodes.reduce((acc, root) => {
                            const v = sumLeafDescendants(root.nodeId, activeNodes);
                            return {
                              opening: acc.opening + v.opening,
                              txnDebit: acc.txnDebit + v.txnDebit,
                              txnCredit: acc.txnCredit + v.txnCredit,
                              closing: acc.closing + v.closing,
                            };
                          }, { opening: 0, txnDebit: 0, txnCredit: 0, closing: 0 });

                          return (
                            <div key={section.key}>
                              {/* Section header */}
                              <div className={cn('flex items-center px-4 py-1.5 text-[10px] font-bold uppercase tracking-wider border-b', section.colorClass)}>
                                {section.label}
                              </div>

                              {/* Group rows */}
                              {section.nodes.map(node => (
                                <TbTreeRow
                                  key={node.nodeId}
                                  node={node}
                                  allNodes={activeNodes}
                                  depth={0}
                                />
                              ))}

                              {/* Section subtotal */}
                              <div className={cn('flex items-center border-b-2 px-2 py-1.5 text-[11px] font-bold', section.colorClass)}>
                                <div className='mr-2 w-4 shrink-0' />
                                <span className='flex-1 pl-1'>{section.subtotalLabel}</span>
                                <span className='w-32 shrink-0 text-right tabular-nums font-mono pr-3'>{fmtTb(sectionTotal.opening)}</span>
                                <span className='w-32 shrink-0 text-right tabular-nums font-mono pr-3'>{fmtTb(sectionTotal.txnDebit)}</span>
                                <span className='w-32 shrink-0 text-right tabular-nums font-mono pr-3'>{fmtTb(sectionTotal.txnCredit)}</span>
                                <span className='w-32 shrink-0 text-right tabular-nums font-mono pr-3'>{fmtTb(sectionTotal.closing)}</span>
                              </div>
                            </div>
                          );
                        })}

                        {/* Grand Total row */}
                        <div className='flex items-center border-t-2 border-border bg-primary/10 px-2 py-2 text-xs font-bold text-foreground sticky bottom-0'>
                          <div className='mr-2 w-4 shrink-0' />
                          <span className='flex-1 flex items-center gap-2'>
                            GRAND TOTAL
                            {isBalanced && (
                              <Badge variant='outline' className='text-[9px] border-emerald-500/50 text-emerald-500 font-semibold'>
                                ✓ BALANCED
                              </Badge>
                            )}
                          </span>
                          <span className='w-32 shrink-0 text-right tabular-nums font-mono pr-3'>{fmtTb(grandTotal.opening)}</span>
                          <span className='w-32 shrink-0 text-right tabular-nums font-mono pr-3'>{fmtTb(grandTotal.txnDebit)}</span>
                          <span className='w-32 shrink-0 text-right tabular-nums font-mono pr-3'>{fmtTb(grandTotal.txnCredit)}</span>
                          <span className='w-32 shrink-0 text-right tabular-nums font-mono pr-3'>{fmtTb(grandTotal.closing)}</span>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })()}

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
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <CalendarDays size={14} /> Comparative / Prior Period TB
                    </CardTitle>
                    <Button variant="ghost" size="sm" onClick={() => setShowComparativeTb(!showComparativeTb)}>
                      {showComparativeTb ? "Hide" : "Add Prior Year TB"}
                    </Button>
                  </div>
                </CardHeader>
                {showComparativeTb && (
                  <CardContent className="space-y-4">
                    <Alert className="py-2">
                      <AlertDescription className="text-xs">
                        Upload the previous year's Trial Balance to enable:
                        opening balance verification, comparative financial statements,
                        and year-on-year scrutiny rules.
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
                      <input ref={comparativeFileRef} type="file" className="hidden"
                        accept=".xlsx,.xls,.pdf"
                        onChange={e => setComparativeFile(e.target.files?.[0] || null)} />
                    </div>

                    {comparativeFile && (
                      <Button size="sm" onClick={handleComparativeImport} disabled={comparativeProcessing} className="w-full gap-1">
                        {comparativeProcessing ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                        Import Prior Year TB
                      </Button>
                    )}

                    {comparativeResult && (
                      <div className="space-y-2">
                        <h4 className="text-sm font-semibold">Opening Balance Verification</h4>
                        <p className="text-xs text-muted-foreground">
                          Comparing current year opening balances against prior year closing balances.
                          Mismatches indicate regrouping or data entry errors.
                        </p>
                        <div className="border rounded-lg overflow-auto max-h-64">
                          <table className="w-full text-xs">
                            <thead className="bg-muted">
                              <tr>
                                <th className="text-left p-2">Ledger Name</th>
                                <th className="text-right p-2">Prior Year Closing</th>
                                <th className="text-right p-2">Current Year Opening</th>
                                <th className="text-right p-2">Difference</th>
                                <th className="text-center p-2">Status</th>
                              </tr>
                            </thead>
                            <tbody>
                              {comparativeResult.verificationRows.map((row: any, i: number) => (
                                <tr key={i} className={cn("border-t", row.diff !== 0 && "bg-destructive/5")}>
                                  <td className="p-2">{row.name}</td>
                                  <td className="p-2 text-right font-mono">{row.pyClosing?.toLocaleString("en-IN")}</td>
                                  <td className="p-2 text-right font-mono">{row.cyOpening?.toLocaleString("en-IN")}</td>
                                  <td className={cn("p-2 text-right font-mono", row.diff !== 0 ? "text-destructive font-bold" : "text-primary")}>
                                    {row.diff !== 0 ? `₹${Math.abs(row.diff).toLocaleString("en-IN")}` : "✓"}
                                  </td>
                                  <td className="p-2 text-center">
                                    <Badge className={row.diff === 0 ? "bg-primary/10 text-primary text-[9px]" : "bg-destructive/10 text-destructive text-[9px]"}>
                                      {row.diff === 0 ? "Match" : "Mismatch"}
                                    </Badge>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        <div className="flex gap-4 text-xs">
                          <span className="text-primary">✓ Matched: {comparativeResult.matched}</span>
                          <span className="text-destructive">✗ Mismatched: {comparativeResult.mismatched}</span>
                          <span className="text-muted-foreground">Total compared: {comparativeResult.total}</span>
                        </div>
                      </div>
                    )}
                  </CardContent>
                )}
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
