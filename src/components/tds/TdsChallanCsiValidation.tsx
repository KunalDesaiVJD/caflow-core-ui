/**
 * Stage 2 · Challan Validation (CSI) — the second half of "PAN & Challan",
 * alongside TdsPanVerification.tsx.
 *
 * IMPORTANT — what a CSI file actually is: a TIN-NSDL/OLTAS Challan Status
 * Inquiry file is NOT a readable per-challan record. Verified directly
 * against 45+ real sample files spanning 2015-2027 (one per quarter): every
 * single one is a header line
 *   <challan_count>^<TAN>^<Deductor Name>^<RPU ver>^<FVU ver>[^extra ver]^<total amount, paise>
 * followed by exactly <challan_count> lines, each a 32-character hash — no
 * BSR code, challan date, serial number, amount, or section anywhere in the
 * file. NSDL's hash algorithm isn't published, so field-by-field comparison
 * (BSR/date/serial/amount) against a CSI file is not something this — or any
 * third-party tool without the official RPU/FVU utility — can actually do.
 *
 * What this DOES do, and is real: a three-way coarse check of the CSI
 * header against this filing's own tds_challans — TAN, total challan COUNT,
 * total challan AMOUNT. A full-year CSI can't be filtered to one quarter
 * either, for the same reason (the header has one count/amount for whatever
 * date range it was generated for, no per-challan quarter tag) — users are
 * expected to upload a quarter-specific CSI, the standard TRACES/OLTAS
 * download granularity every sample file used to verify this format was.
 *
 * Deliberately independent of corrections, same as Stage 1/PAN/Tally — see
 * the project's own permanent rule that Validate & Finalise reads
 * tds_challans directly, never through the correction-aware ledger.
 */
import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { uploadTdsImportFile } from "@/lib/tds/uploadImportFile";
import { downloadStorageFile, removePublicDocumentByUrl } from "@/lib/openStorageFile";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Receipt, Upload, Loader2, RotateCcw, Trash2, CheckCircle2, XCircle, AlertTriangle, Download } from "lucide-react";
import { logReconAudit } from "@/lib/tdsReconAudit";

export interface ChallanCsiStageStatus {
  filingId: string | null;
  loaded: boolean;
  applicable: boolean; // a CSI file has been imported
  ran: boolean;        // a comparison has been computed
  issues: number;      // 0-3: how many of TAN/count/amount don't match
}

interface Props {
  filing: any;
  selClient: string;
  clientTan?: string | null;
  resolveFirmId: () => Promise<string | null>;
  disabled?: boolean;
  onStatusChange?: (s: ChallanCsiStageStatus) => void;
  onActivity?: () => void;
}

interface CsiBatch {
  id: string;
  filing_id: string;
  file_name: string | null;
  file_url: string | null;
  csi_tan: string | null;
  csi_deductor_name: string | null;
  csi_rpu_version: string | null;
  csi_fvu_version: string | null;
  csi_challan_count: number | null;
  csi_total_amount: number | null;
  csi_hash_line_count: number | null;
  office_tan: string | null;
  office_challan_count: number | null;
  office_total_amount: number | null;
  tan_match: boolean | null;
  count_match: boolean | null;
  amount_match: boolean | null;
  imported_at: string | null;
}

const money = (n: number | null | undefined) =>
  n == null ? "—" : `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

/** Parses a CSI file's header line. Returns null if it doesn't look like a
 *  CSI file at all (not enough ^-delimited fields on line 1). */
function parseCsiHeader(text: string): {
  challanCount: number; tan: string; deductorName: string;
  rpuVersion: string; fvuVersion: string; totalAmount: number; hashLineCount: number;
} | null {
  const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
  const header = lines[0];
  if (!header) return null;
  const parts = header.split("^");
  if (parts.length < 4) return null;
  const challanCount = parseInt(parts[0], 10);
  const tan = (parts[1] || "").trim();
  const deductorName = (parts[2] || "").trim();
  // Field count between name and the trailing amount varies (some files carry
  // an extra version field, see the file header doc) — take the LAST field as
  // the amount and everything between name and it as version numbers.
  const totalAmountRaw = parts[parts.length - 1];
  const totalAmount = (parseInt(totalAmountRaw, 10) || 0) / 100;
  const rpuVersion = parts[3] || "";
  const fvuVersion = parts[4] || "";
  if (!Number.isFinite(challanCount) || !tan) return null;
  return { challanCount, tan, deductorName, rpuVersion, fvuVersion, totalAmount, hashLineCount: lines.length - 1 };
}

export function TdsChallanCsiValidation({ filing, selClient, clientTan, resolveFirmId, disabled, onStatusChange, onActivity }: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  const filingId: string | null = filing?.id ?? null;

  const [batch, setBatch] = useState<CsiBatch | null>(null);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [revalidating, setRevalidating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const loadSeq = useRef(0);

  const loadBatch = useCallback(async () => {
    if (!filingId) { setBatch(null); return; }
    const seq = ++loadSeq.current;
    setLoading(true);
    const { data } = await supabase
      .from("tds_challan_csi_batches" as any)
      .select("*")
      .eq("filing_id", filingId)
      .order("imported_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (seq !== loadSeq.current) return;
    setBatch((data as any) ?? null);
    setLoading(false);
  }, [filingId]);

  useEffect(() => { loadBatch(); }, [loadBatch]);

  // Report status up to the parent (Stage 2 badge + canFile gate).
  useEffect(() => {
    if (!onStatusChange) return;
    const ran = !!batch && batch.tan_match !== null;
    const issues = ran
      ? [batch!.tan_match, batch!.count_match, batch!.amount_match].filter(m => m === false).length
      : 0;
    onStatusChange({ filingId, loaded: !loading, applicable: !!batch, ran, issues });
  }, [filingId, loading, batch, onStatusChange]);

  // Office side: tds_challans for THIS filing directly — never the
  // correction-aware ledger. See this file's own header doc.
  const fetchOfficeTotals = useCallback(async () => {
    if (!filingId) return { count: 0, total: 0 };
    const { data } = await supabase.from("tds_challans").select("total_challan_amount").eq("filing_id", filingId);
    const rows = data || [];
    return { count: rows.length, total: rows.reduce((s: number, r: any) => s + (r.total_challan_amount || 0), 0) };
  }, [filingId]);

  const compareAndSave = useCallback(async (parsed: ReturnType<typeof parseCsiHeader>, fileMeta: { name: string; url: string | null }, existingId?: string) => {
    if (!parsed || !filingId) return;
    const firmId = await resolveFirmId();
    const { count: officeCount, total: officeTotal } = await fetchOfficeTotals();
    const officeTanNorm = (clientTan || "").trim().toUpperCase();
    const csiTanNorm = parsed.tan.trim().toUpperCase();
    const tanMatch = !!officeTanNorm && officeTanNorm === csiTanNorm;
    const countMatch = officeCount === parsed.challanCount;
    // Paise-precision comparison — same convention as computeChallanOverApplied
    // elsewhere in this module, avoids float-equality false negatives.
    const amountMatch = Math.round(officeTotal * 100) === Math.round(parsed.totalAmount * 100);

    const payload = {
      filing_id: filingId,
      client_id: selClient,
      firm_id: firmId,
      financial_year: filing.financial_year,
      quarter: filing.quarter,
      form_type: (filing.tds_forms && filing.tds_forms[0]) || filing.form_type || "",
      file_name: fileMeta.name,
      file_url: fileMeta.url,
      csi_tan: parsed.tan,
      csi_deductor_name: parsed.deductorName,
      csi_rpu_version: parsed.rpuVersion,
      csi_fvu_version: parsed.fvuVersion,
      csi_challan_count: parsed.challanCount,
      csi_total_amount: parsed.totalAmount,
      csi_hash_line_count: parsed.hashLineCount,
      office_tan: clientTan || null,
      office_challan_count: officeCount,
      office_total_amount: officeTotal,
      tan_match: tanMatch,
      count_match: countMatch,
      amount_match: amountMatch,
      imported_by: user?.id ?? null,
      imported_at: new Date().toISOString(),
    };

    if (existingId) {
      await supabase.from("tds_challan_csi_batches" as any).update(payload).eq("id", existingId);
    } else {
      await supabase.from("tds_challan_csi_batches" as any).insert(payload);
    }
    await loadBatch();
    onActivity?.();
    return { tanMatch, countMatch, amountMatch };
  }, [filingId, selClient, filing, clientTan, resolveFirmId, fetchOfficeTotals, user?.id, loadBatch, onActivity]);

  const handleFile = async (file: File) => {
    if (!filingId) return;
    setUploading(true);
    try {
      const text = await file.text();
      const parsed = parseCsiHeader(text);
      if (!parsed) {
        toast({ title: "Not a CSI file", description: "This doesn't look like a valid Challan Status Inquiry (.csi) file.", variant: "destructive" });
        setUploading(false);
        return;
      }
      // Only one CSI file per filing — a new upload replaces whatever's there,
      // same "re-import replaces" convention as Stage 1/PAN, just without a
      // multi-file list (a CSI is one cohesive quarter report, not sections).
      if (batch) {
        if (batch.file_url) removePublicDocumentByUrl(supabase, batch.file_url);
        await supabase.from("tds_challan_csi_batches" as any).delete().eq("id", batch.id);
      }
      const uploadedUrl = await uploadTdsImportFile(file, filingId, "challan-csi");
      const result = await compareAndSave(parsed, { name: file.name, url: uploadedUrl });
      const firmId = await resolveFirmId();
      await logReconAudit({
        filingId, firmId, userId: user?.id, userName: user?.name || user?.email || "Unknown",
        actionType: batch ? "CHALLAN_CSI_FILE_REPLACED" : "CHALLAN_CSI_FILE_IMPORTED",
        newValue: file.name,
        remark: result ? `TAN ${result.tanMatch ? "matched" : "MISMATCHED"}, Count ${result.countMatch ? "matched" : "MISMATCHED"}, Amount ${result.amountMatch ? "matched" : "MISMATCHED"}` : undefined,
      });
      toast({ title: "CSI file validated", description: `${parsed.challanCount} challan(s) in the CSI file.` });
    } catch (err: any) {
      toast({ title: "Could not process CSI file", description: err?.message, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  const handleRevalidate = async () => {
    if (!batch) return;
    setRevalidating(true);
    const parsed = {
      challanCount: batch.csi_challan_count || 0,
      tan: batch.csi_tan || "",
      deductorName: batch.csi_deductor_name || "",
      rpuVersion: batch.csi_rpu_version || "",
      fvuVersion: batch.csi_fvu_version || "",
      totalAmount: batch.csi_total_amount || 0,
      hashLineCount: batch.csi_hash_line_count || 0,
    };
    const result = await compareAndSave(parsed, { name: batch.file_name || "", url: batch.file_url }, batch.id);
    const firmId = await resolveFirmId();
    await logReconAudit({
      filingId, firmId, userId: user?.id, userName: user?.name || user?.email || "Unknown",
      actionType: "CHALLAN_CSI_REVALIDATED",
      remark: result ? `TAN ${result.tanMatch ? "matched" : "MISMATCHED"}, Count ${result.countMatch ? "matched" : "MISMATCHED"}, Amount ${result.amountMatch ? "matched" : "MISMATCHED"}` : undefined,
    });
    setRevalidating(false);
    toast({ title: "Re-validated against current challan data" });
  };

  const handleDelete = async () => {
    if (!batch) return;
    setDeleting(true);
    if (batch.file_url) removePublicDocumentByUrl(supabase, batch.file_url);
    await supabase.from("tds_challan_csi_batches" as any).delete().eq("id", batch.id);
    const firmId = await resolveFirmId();
    await logReconAudit({
      filingId, firmId, userId: user?.id, userName: user?.name || user?.email || "Unknown",
      actionType: "CHALLAN_CSI_FILE_DELETED", oldValue: batch.file_name,
    });
    setDeleting(false);
    await loadBatch();
  };

  const ran = !!batch && batch.tan_match !== null;
  const allMatch = ran && batch!.tan_match && batch!.count_match && batch!.amount_match;

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Receipt size={16} className="text-muted-foreground" />
              <span className="text-sm font-semibold">Challan Status Inquiry (CSI) File</span>
            </div>
            {!disabled && (
              <>
                <input
                  ref={fileInputRef} type="file" accept=".csi,.txt" className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }}
                />
                <Button size="sm" variant="outline" className="gap-1.5" disabled={uploading}
                  onClick={() => fileInputRef.current?.click()}>
                  {uploading ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
                  {batch ? "Replace CSI File" : "Upload CSI File"}
                </Button>
              </>
            )}
          </div>

          {!batch ? (
            <p className="text-xs text-muted-foreground">
              No CSI file uploaded yet. Download it from TRACES/OLTAS for this TAN and quarter, then upload it here.
            </p>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>{batch.file_name} · imported {batch.imported_at ? new Date(batch.imported_at).toLocaleString("en-IN") : "—"}</span>
                <div className="flex items-center gap-1">
                  {batch.file_url && (
                    <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs" onClick={() => downloadStorageFile(batch.file_url!, batch.file_name || "csi-file")}>
                      <Download size={12} /> Download
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs" disabled={revalidating || disabled} onClick={handleRevalidate}>
                    {revalidating ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />} Re-validate
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs text-destructive" disabled={deleting || disabled} onClick={handleDelete}>
                    <Trash2 size={12} />
                  </Button>
                </div>
              </div>

              {batch.csi_hash_line_count !== batch.csi_challan_count && (
                <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/20 p-2 text-xs text-amber-800 dark:text-amber-300">
                  <AlertTriangle size={13} className="shrink-0 mt-0.5" />
                  File declares {batch.csi_challan_count} challans but contains {batch.csi_hash_line_count} — it may be truncated or corrupted.
                </div>
              )}

              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: "TAN", csi: batch.csi_tan || "—", office: batch.office_tan || "—", match: batch.tan_match },
                  { label: "Challan Count", csi: String(batch.csi_challan_count ?? "—"), office: String(batch.office_challan_count ?? "—"), match: batch.count_match },
                  { label: "Total Amount", csi: money(batch.csi_total_amount), office: money(batch.office_total_amount), match: batch.amount_match },
                ].map(row => (
                  <div key={row.label} className={cn("rounded-lg border p-3", row.match === false ? "border-destructive/40 bg-destructive/5" : "border-border")}>
                    <div className="flex items-center justify-between mb-1.5">
                      <p className="text-[11px] font-semibold text-muted-foreground">{row.label}</p>
                      {row.match === true ? <CheckCircle2 size={13} className="text-emerald-600" /> : row.match === false ? <XCircle size={13} className="text-destructive" /> : null}
                    </div>
                    <p className="text-xs"><span className="text-muted-foreground">CSI:</span> <span className="font-medium">{row.csi}</span></p>
                    <p className="text-xs"><span className="text-muted-foreground">Office:</span> <span className="font-medium">{row.office}</span></p>
                  </div>
                ))}
              </div>

              {ran && (
                allMatch ? (
                  <div className="rounded-lg border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/20 p-3 flex items-center gap-2">
                    <CheckCircle2 size={16} className="text-emerald-600 shrink-0" />
                    <p className="text-sm font-semibold text-emerald-800 dark:text-emerald-300">Challan Validation Completed Successfully</p>
                  </div>
                ) : (
                  <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 flex items-start gap-2">
                    <XCircle size={16} className="text-destructive shrink-0 mt-0.5" />
                    <div className="text-sm">
                      <p className="font-semibold text-destructive">Challan totals don't match the CSI file</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Review challans in Data Entry, or re-upload the correct CSI file for this quarter, then re-validate.
                      </p>
                    </div>
                  </div>
                )
              )}

              <p className="text-[11px] text-muted-foreground">
                A CSI file stores one hash per challan, not readable challan details — this checks TAN, total challan count,
                and total amount only. Upload a quarter-specific CSI (not a full-year one — the totals won't isolate to this quarter).
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
