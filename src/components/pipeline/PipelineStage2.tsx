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
  Flag, RefreshCw, X, ChevronDown, FileUp
} from "lucide-react";

// ─── Types ───
interface PipelineStage2Props {
  engagementId: string;
  engagement: any;
  onStageComplete: () => void;
  onSaveDraft: () => void;
}

type ImportFormat = "tally_xml" | "tally_excel" | "expert_software_excel" | "generic_excel" | "generic_csv";

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
  const [tbResult, setTbResult] = useState<{
    totalAccounts: number; debitTotal: number; creditTotal: number;
    difference: number; isValid: boolean; preview: any[];
  } | null>(null);
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
  const [ledgerStep, setLedgerStep] = useState(1); // 1=upload, 2=map, 3=processing, 4=result
  const [showFlagged, setShowFlagged] = useState(false);
  const ledgerFileRef = useRef<HTMLInputElement>(null);

  // ─── Existing TB snapshot ───
  const { data: existingTb } = useQuery({
    queryKey: ["tb-snapshot-for-engagement", engagementId],
    queryFn: async () => {
      const { data } = await supabase
        .from("trial_balance_snapshots")
        .select("*")
        .eq("engagement_id", engagementId)
        .maybeSingle();
      return data;
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
  }, [existingTb]);

  // ─── Replace confirmation state ───
  const [showReplaceDialog, setShowReplaceDialog] = useState(false);
  const [tbFileBase64, setTbFileBase64] = useState("");

  // Check if Tally format that should go through edge function
  const isTallyFormat = tbFormat === "tally_excel" || tbFormat === "tally_xml";

  // ═══════ TB IMPORT LOGIC ═══════

  const needsColumnMapping = tbFormat === "generic_excel" || tbFormat === "generic_csv";

  const handleTbFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setTbFile(file);

    const reader = new FileReader();
    reader.onload = (evt) => {
      const data = evt.target?.result;
      try {
        if (isTallyFormat) {
          // For Tally formats, store base64 for edge function
          const arrayBuffer = data as ArrayBuffer;
          const bytes = new Uint8Array(arrayBuffer);
          let binary = "";
          for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
          setTbFileBase64(btoa(binary));
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

  const handleTbProcess = async () => {
    // Check for existing TB — show replace dialog
    if (existingTb && !showReplaceDialog) {
      setShowReplaceDialog(true);
      return;
    }
    setShowReplaceDialog(false);

    setTbProcessing(true);
    setTbProgress(10);

    try {
      if (isTallyFormat) {
        // ─── Route through edge function for Tally formats ───
        setTbProgress(20);
        const { data, error: fnError } = await supabase.functions.invoke("parse-tally-tb", {
          body: {
            engagementId,
            firmId: user?.firm_id || null,
            fileBase64: tbFileBase64,
            fileName: tbFile?.name,
            financialYear: engagement.financial_year,
          },
        });

        if (fnError) throw new Error(fnError.message || "Edge function error");
        if (!data?.success) throw new Error(data?.error || "Parse failed");

        setTbProgress(100);

        setTbResult({
          totalAccounts: data.leafLedgers,
          debitTotal: Math.round(data.totalDr * 100) / 100,
          creditTotal: Math.round(data.totalCr * 100) / 100,
          difference: Math.round(Math.abs(data.totalDr - data.totalCr) * 100) / 100,
          isValid: data.isBalanced,
          preview: (data.hierarchy || []).filter((n: any) => n.isLeaf).slice(0, 20).map((n: any) => ({
            account_name: n.name,
            account_group: n.primaryGroup,
            debit: n.txnDebit,
            credit: n.txnCredit,
          })),
        });

        setTbStep(5);
        toast.success(`${data.leafLedgers} ledgers imported — ${data.detectedFormat} format detected. Groups: ${data.groupsDetected}, Skipped: ${data.rowsSkipped}`);
        queryClient.invalidateQueries({ queryKey: ["tb-snapshot-for-engagement"] });
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
    }
  };

  const handleTbOverride = async () => {
    if (!tbOverrideJustification.trim()) {
      toast.error("Please provide a justification for overriding");
      return;
    }

    // Mark as validated with override
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

  // ═══════ LEDGER IMPORT LOGIC ═══════

  const handleLedgerFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    setLedgerFiles(files);

    // Parse first file for mapping
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

      // Process all files
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

      // Create batch record
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

      // Delete old transactions for this engagement
      await supabase
        .from("ledger_transactions")
        .delete()
        .eq("engagement_id", engagementId);

      // Insert in chunks of 2000
      const CHUNK_SIZE = 2000;
      for (let i = 0; i < allRows.length; i += CHUNK_SIZE) {
        const chunk = allRows.slice(i, i + CHUNK_SIZE).map(r => ({
          ...r,
          import_batch_id: batch?.id,
        }));
        await supabase.from("ledger_transactions").insert(chunk as any);
        setLedgerProgress(55 + ((i + CHUNK_SIZE) / allRows.length) * 35);
      }

      // Update batch status
      if (batch?.id) {
        await supabase
          .from("ledger_import_batches")
          .update({ processing_status: "complete" } as any)
          .eq("id", batch.id);
      }

      setLedgerProgress(95);

      // Flag suspicious narrations client-side (simple heuristic)
      const suspiciousPatterns = ["misc", "adjustment", "adj", "sundry", "other", "temp"];
      let flaggedCount = 0;
      const flagUpdates: { id: string; flag_reason: string }[] = [];

      // Query inserted transactions to flag
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

      // Batch update flags
      for (const upd of flagUpdates) {
        await supabase
          .from("ledger_transactions")
          .update({ scrutiny_flag: true, flag_reason: upd.flag_reason } as any)
          .eq("id", upd.id);
      }

      setLedgerProgress(100);

      // Get date range
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

  // ─── Parent Period Import ───
  const handleImportPrevPeriod = async () => {
    if (!engagement.parent_engagement_id) return;
    try {
      const { data: parentTb } = await supabase
        .from("trial_balance_snapshots")
        .select("*")
        .eq("engagement_id", engagement.parent_engagement_id)
        .maybeSingle();

      if (!parentTb) {
        toast.error("No TB snapshot found in parent engagement");
        return;
      }

      const payload: any = {
        client_id: engagement.client_id,
        engagement_id: engagementId,
        financial_year: engagement.financial_year,
        normalised_data: (parentTb as any).normalised_data,
        source_format: "carried_forward",
        import_format: "generic_excel",
        is_validated: true,
        validation_status: "valid",
        processing_status: "complete",
      };

      await supabase.from("trial_balance_snapshots").insert(payload);
      toast.success("Previous period data imported as opening balances");
      queryClient.invalidateQueries({ queryKey: ["tb-snapshot-for-engagement"] });
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  // Check if stage 2 can be completed
  const canComplete = tbResult?.isValid || (existingTb as any)?.is_validated;

  const handleCompleteStage2 = async () => {
    const newStatuses = { ...(engagement.stage_statuses || {}), "2": "complete" };
    await supabase.from("audit_engagements").update({
      stage_statuses: newStatuses,
      pipeline_stage: Math.max(engagement.pipeline_stage || 2, 3),
    } as any).eq("id", engagementId);
    toast.success("Stage 2 completed — proceed to Scrutiny & Analysis");
    onStageComplete();
  };

  return (
    <div className="max-w-5xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">Stage 2 — Data Import</h1>
          <p className="text-sm text-muted-foreground">Import Trial Balance and Ledger data for {engagement.clients?.name} — FY {engagement.financial_year}</p>
        </div>
        <div className="flex gap-2">
          {engagement.parent_engagement_id && (
            <Button variant="outline" size="sm" onClick={handleImportPrevPeriod} className="gap-1">
              <RefreshCw size={14} /> Import Previous Period
            </Button>
          )}
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
                  <p className="text-xs text-muted-foreground mt-1">Max 50MB • {FORMAT_OPTIONS.find(f => f.value === tbFormat)?.ext}</p>
                  <input
                    ref={tbFileRef}
                    type="file"
                    accept={tbFormat === "generic_csv" ? ".csv" : tbFormat === "tally_xml" ? ".xml" : ".xlsx,.xls"}
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
                    <p className="text-sm font-medium">Processing Trial Balance...</p>
                    <Progress value={tbProgress} className="h-2" />
                    <p className="text-xs text-muted-foreground">{Math.round(tbProgress)}% complete</p>
                  </div>
                ) : (
                  <div className="text-center space-y-4">
                    <FileSpreadsheet size={40} className="mx-auto text-primary opacity-60" />
                    <div>
                      <p className="text-sm font-medium">Ready to process {tbParsedData.length - 1} rows</p>
                      <p className="text-xs text-muted-foreground">
                        Format: {FORMAT_OPTIONS.find(f => f.value === tbFormat)?.label} • File: {tbFile?.name}
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
                      <Button size="sm" variant="outline" onClick={() => { setTbStep(1); setTbResult(null); }}>
                        Re-upload
                      </Button>
                      <Button size="sm" variant="destructive" onClick={() => setTbShowOverride(true)}>
                        Override with Justification
                      </Button>
                    </div>
                  </AlertDescription>
                </Alert>
              )}

              {/* Preview Table */}
              {tbResult.preview.length > 0 && (
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
                      // Trigger parse of first file
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
    </div>
  );
}

// ─── Helper ───
function parseDate(val: any): string | null {
  if (!val) return null;
  // Excel serial date
  if (typeof val === "number") {
    const d = new Date((val - 25569) * 86400 * 1000);
    return d.toISOString().split("T")[0];
  }
  // String date
  const s = String(val).trim();
  // dd/mm/yyyy
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
