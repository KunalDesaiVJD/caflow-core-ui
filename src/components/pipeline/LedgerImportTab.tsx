/**
 * LedgerImportTab
 *
 * Self-contained ledger import UI.  Moved from PipelineStage2 to
 * PipelineStage4 (Scrutiny Engine) as a new third tab per the
 * audit-nav-restructure-v3 spec.
 *
 * Props
 *   engagementId – required
 */
import { useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import * as XLSX from "xlsx";
import {
  Upload, CheckCircle2, ArrowRight, ArrowLeft, Loader2, Flag,
} from "lucide-react";

// ─── Field definitions ────────────────────────────────────────────────────────

const LEDGER_TARGET_FIELDS = [
  { key: "date",         label: "Date",         required: true  },
  { key: "voucher_type", label: "Voucher Type",  required: false },
  { key: "voucher_no",   label: "Voucher No",    required: false },
  { key: "narration",    label: "Narration",     required: false },
  { key: "debit",        label: "Debit",         required: true  },
  { key: "credit",       label: "Credit",        required: true  },
  { key: "account_name", label: "Account Name",  required: false },
];

const LEDGER_FUZZY: Record<string, string[]> = {
  date:         ["date", "txndate", "transactiondate", "voucherdate"],
  voucher_type: ["vouchertype", "type", "vchtype"],
  voucher_no:   ["voucherno", "vchno", "docno", "refno"],
  narration:    ["narration", "description", "remarks", "particulars"],
  debit:        ["debit", "dr"],
  credit:       ["credit", "cr"],
  account_name: ["account", "ledger", "name", "particulars"],
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

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

// ─── Component ────────────────────────────────────────────────────────────────

interface LedgerImportTabProps {
  engagementId: string;
}

export default function LedgerImportTab({ engagementId }: LedgerImportTabProps) {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  // ── state ──────────────────────────────────────────────────────────────────
  const [ledgerFiles,      setLedgerFiles]      = useState<File[]>([]);
  const [ledgerParsedData, setLedgerParsedData] = useState<any[][]>([]);
  const [ledgerHeaders,    setLedgerHeaders]    = useState<string[]>([]);
  const [ledgerMapping,    setLedgerMapping]    = useState<Record<string, string>>({});
  const [ledgerProcessing, setLedgerProcessing] = useState(false);
  const [ledgerProgress,   setLedgerProgress]   = useState(0);
  const [ledgerResult,     setLedgerResult]     = useState<{
    totalTransactions: number;
    accountCount: number;
    dateRange: string;
    flaggedCount: number;
  } | null>(null);
  const [ledgerStep,  setLedgerStep]  = useState(1);
  const [showFlagged, setShowFlagged] = useState(false);
  const ledgerFileRef = useRef<HTMLInputElement>(null);

  // ── queries ────────────────────────────────────────────────────────────────

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

  // ── handlers ──────────────────────────────────────────────────────────────

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
      } catch {
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
              account_name: colIdx("account_name") >= 0
                ? String(row[colIdx("account_name")] || "").trim()
                : sheetName,
              account_group: "",
              date: parseDate(dateVal),
              voucher_type: colIdx("voucher_type") >= 0 ? String(row[colIdx("voucher_type")] || "").trim() : null,
              voucher_no:   colIdx("voucher_no")   >= 0 ? String(row[colIdx("voucher_no")]   || "").trim() : null,
              narration:    colIdx("narration")    >= 0 ? String(row[colIdx("narration")]    || "").trim() : null,
              debit:        parseNum(row[colIdx("debit")]),
              credit:       parseNum(row[colIdx("credit")]),
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

  // ── render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4 mt-4">

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
                <Label className="w-36 text-sm font-medium shrink-0">
                  {field.label} {field.required && <span className="text-destructive">*</span>}
                </Label>
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
    </div>
  );
}
