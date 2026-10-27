/**
 * TdsChallanDownloadValidation — Stage 2 · Challan Validation, replacing the
 * old CSI upload flow (TdsChallanCsiValidation, removed). A CSI file turned
 * out to be hash-lines only, checkable at best as a coarse TAN/count/total
 * header comparison — see git history for that component's own header doc.
 * The ITD portal's own Payment History table is a genuine per-challan
 * source, so this does real per-challan matching: challan serial number,
 * deposit date, amount, and BSR code — see matchChallanDownload.ts.
 *
 * "Verify on ITD Portal" hands off to the browser extension
 * (browser-extension/itd-autofill/) the same way TdsPortalLoginButtons.tsx's
 * "Auto-fill ITD Login" does — window.postMessage → content-caflow.js →
 * background.js → content-itd.js on the ITD tab, asking it to attempt the
 * portal click-path for this filing's quarter. 2026-08-11: switched from
 * downloading a PDF (which always needed a manual "Upload Downloaded
 * Report" step, since a content script can't read a file the OS just saved)
 * to reading the Payment History table directly on the ITD tab and relaying
 * the rows back the OPPOSITE direction — content-itd.js → background.js →
 * content-caflow.js polls for it → window.postMessage into THIS page,
 * caught by the CHALLAN_PAYMENT_HISTORY_RESULT listener below, which runs
 * the exact same compareAndSave the manual upload path still uses (kept as
 * a fallback for accounts without the extension, or if the automation
 * genuinely can't complete).
 *
 * Deliberately independent of corrections, same as Stage 1/PAN/Tally — see
 * the project's own permanent rule that Validate & Finalise reads
 * tds_challans directly, never through the correction-aware ledger.
 */
import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { uploadTdsImportFile } from "@/lib/tds/uploadImportFile";
import { downloadStorageFile, removePublicDocumentByUrl } from "@/lib/openStorageFile";
import { parseChallanPaymentHistory, type PortalChallanRow } from "@/lib/tds/parseChallanPaymentHistory";
import { matchChallanDownload, type ChallanMatchResult, type OfficeChallanForMatch } from "@/lib/tds/matchChallanDownload";
import { hasItdAutofillExtension, ITD_LOGIN_URL } from "./TdsPortalLoginButtons";
import { resolveTdsClientServiceId, relayItdLoginCredentials } from "@/lib/tds/itdCredentialsRelay";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Receipt, Upload, Loader2, RotateCcw, Trash2, CheckCircle2, XCircle, Download, CloudDownload } from "lucide-react";
import { logReconAudit } from "@/lib/tdsReconAudit";

export interface ChallanDownloadStageStatus {
  filingId: string | null;
  loaded: boolean;
  applicable: boolean; // a downloaded report has been imported
  ran: boolean;        // a comparison has been computed
  issues: number;       // count of office challans that didn't match
  unmatched?: ChallanMatchResult[]; // the challans behind `issues` (client query emails list them)
}

interface Props {
  filing: any;
  selClient: string;
  selForm: string;
  clientTan?: string | null;
  resolveFirmId: () => Promise<string | null>;
  disabled?: boolean;
  onStatusChange?: (s: ChallanDownloadStageStatus) => void;
  onActivity?: () => void;
}

interface DownloadBatch {
  id: string;
  filing_id: string;
  file_name: string | null;
  file_url: string | null;
  portal_challans: PortalChallanRow[] | null;
  portal_challan_count: number | null;
  match_results: ChallanMatchResult[] | null;
  matched_count: number | null;
  unmatched_count: number | null;
  imported_at: string | null;
}

const money = (n: number | null | undefined) =>
  n == null ? "—" : `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

// Q1: Apr–Jun, Q2: Jul–Sep, Q3: Oct–Dec, Q4: Jan–Mar of the filing's own FY.
function quarterDateRange(financialYear: string | undefined, quarter: string | undefined): { start: string; end: string } | null {
  if (!financialYear || !quarter) return null;
  const startYear = parseInt(financialYear.slice(0, 4), 10);
  if (!Number.isFinite(startYear)) return null;
  const ranges: Record<string, { start: string; end: string }> = {
    "1Q": { start: `${startYear}-04-01`, end: `${startYear}-06-30` },
    "2Q": { start: `${startYear}-07-01`, end: `${startYear}-09-30` },
    "3Q": { start: `${startYear}-10-01`, end: `${startYear}-12-31` },
    "4Q": { start: `${startYear + 1}-01-01`, end: `${startYear + 1}-03-31` },
  };
  const key = /^Q?([1-4])$/i.exec(quarter.trim())?.[1];
  return key ? ranges[`${key}Q`] : null;
}

export function TdsChallanDownloadValidation({ filing, selClient, selForm, clientTan, resolveFirmId, disabled, onStatusChange, onActivity }: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  const filingId: string | null = filing?.id ?? null;

  const [batch, setBatch] = useState<DownloadBatch | null>(null);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [revalidating, setRevalidating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [requestingDownload, setRequestingDownload] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const loadSeq = useRef(0);

  const loadBatch = useCallback(async () => {
    if (!filingId) { setBatch(null); return; }
    const seq = ++loadSeq.current;
    setLoading(true);
    const { data } = await supabase
      .from("tds_challan_download_batches" as any)
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

  useEffect(() => {
    if (!onStatusChange) return;
    const ran = !!batch && batch.matched_count !== null;
    const issues = ran ? (batch!.unmatched_count ?? 0) : 0;
    const unmatched = ran ? (batch!.match_results || []).filter((m) => !m.matched) : [];
    onStatusChange({ filingId, loaded: !loading, applicable: !!batch, ran, issues, unmatched });
  }, [filingId, loading, batch, onStatusChange]);

  // Office side: tds_challans for THIS filing directly — never the
  // correction-aware ledger, and archived challans excluded, same convention
  // as every other "office total" computation in the TDS module.
  const fetchOfficeChallans = useCallback(async (): Promise<OfficeChallanForMatch[]> => {
    if (!filingId) return [];
    const { data } = await supabase.from("tds_challans")
      .select("id, bsr_code, challan_serial_no, deposit_date, total_challan_amount")
      .eq("filing_id", filingId).eq("is_archived", false);
    return (data || []) as OfficeChallanForMatch[];
  }, [filingId]);

  const compareAndSave = useCallback(async (portalChallans: PortalChallanRow[], fileMeta: { name: string; url: string | null }, existingId?: string) => {
    if (!filingId) return;
    const firmId = await resolveFirmId();
    const officeChallans = await fetchOfficeChallans();
    const matchResults = matchChallanDownload(officeChallans, portalChallans);
    const matchedCount = matchResults.filter((m) => m.matched).length;
    const unmatchedCount = matchResults.length - matchedCount;

    const payload = {
      filing_id: filingId,
      client_id: selClient,
      firm_id: firmId,
      financial_year: filing.financial_year,
      quarter: filing.quarter,
      form_type: selForm,
      file_name: fileMeta.name,
      file_url: fileMeta.url,
      portal_challans: portalChallans,
      portal_challan_count: portalChallans.length,
      match_results: matchResults,
      matched_count: matchedCount,
      unmatched_count: unmatchedCount,
      imported_by: user?.id ?? null,
      imported_at: new Date().toISOString(),
    };

    if (existingId) {
      await supabase.from("tds_challan_download_batches" as any).update(payload).eq("id", existingId);
    } else {
      await supabase.from("tds_challan_download_batches" as any).insert(payload);
    }
    await loadBatch();
    onActivity?.();
    return { matchedCount, unmatchedCount };
  }, [filingId, selClient, filing, resolveFirmId, fetchOfficeChallans, user?.id, loadBatch, onActivity]);

  // 2026-08-11: the extension's "Download Challan" no longer downloads
  // anything — it reads the Payment History table directly on the ITD tab
  // (browser-extension/itd-autofill/content-itd.js's scrapePaymentHistoryTable)
  // and relays the rows back here via content-caflow.js's poll loop, since
  // this tab and the ITD tab never share a JS context. Listens the same way
  // itdCredentialsRelay.ts's ACK does — window.postMessage from the
  // "caflow-extension" source — and runs the SAME compareAndSave the manual
  // PDF-upload path already uses, so both paths produce identical results
  // and neither needs its own separate matching logic.
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (event.source !== window) return;
      const msg = event.data;
      if (msg?.source !== "caflow-extension" || msg?.type !== "CHALLAN_PAYMENT_HISTORY_RESULT") return;
      if (!filingId) return;
      const portalChallans: PortalChallanRow[] = (msg.rows || []).map((r: any) => ({
        serialNo: r.serialNo, depositDate: r.depositDate, amount: r.amount, bsrCode: r.bsrCode ?? null,
      }));
      (async () => {
        setRequestingDownload(true);
        try {
          // Auto-verified batches replace whatever's there, same "re-import
          // replaces" convention the manual upload path already uses —
          // there's no storage file to delete this time since nothing was
          // ever downloaded.
          if (batch) {
            if (batch.file_url) removePublicDocumentByUrl(supabase, batch.file_url);
            await supabase.from("tds_challan_download_batches" as any).delete().eq("id", batch.id);
          }
          const result = await compareAndSave(portalChallans, { name: "Auto-verified from ITD Portal (Payment History)", url: null });
          const firmId = await resolveFirmId();
          await logReconAudit({
            filingId, firmId, userId: user?.id, userName: user?.name || user?.email || "Unknown",
            actionType: batch ? "CHALLAN_DOWNLOAD_FILE_REPLACED" : "CHALLAN_DOWNLOAD_FILE_IMPORTED",
            newValue: "Auto-verified from ITD Portal",
            remark: result ? `${result.matchedCount} matched, ${result.unmatchedCount} not matched` : undefined,
          });
          toast({
            title: portalChallans.length ? "Challan verification complete" : "No challans found on the portal",
            description: portalChallans.length
              ? `${portalChallans.length} challan(s) read directly from the ITD Portal and compared against Data Entry.`
              : "The Payment History table appears to be empty for this account.",
          });
        } finally {
          setRequestingDownload(false);
        }
      })();
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [filingId, batch, compareAndSave, resolveFirmId, user?.id, toast]);

  const handleFile = async (file: File) => {
    if (!filingId) return;
    setUploading(true);
    try {
      const portalChallans = await parseChallanPaymentHistory(file);
      if (!portalChallans.length) {
        toast({ title: "Couldn't read this file", description: "This doesn't look like a Payment History export — no challan rows were found.", variant: "destructive" });
        setUploading(false);
        return;
      }
      // Only one report per filing — a new upload replaces whatever's there,
      // same "re-import replaces" convention the old CSI upload used.
      if (batch) {
        if (batch.file_url) removePublicDocumentByUrl(supabase, batch.file_url);
        await supabase.from("tds_challan_download_batches" as any).delete().eq("id", batch.id);
      }
      const uploadedUrl = await uploadTdsImportFile(file, filingId, "challan-download");
      const result = await compareAndSave(portalChallans, { name: file.name, url: uploadedUrl });
      const firmId = await resolveFirmId();
      await logReconAudit({
        filingId, firmId, userId: user?.id, userName: user?.name || user?.email || "Unknown",
        actionType: batch ? "CHALLAN_DOWNLOAD_FILE_REPLACED" : "CHALLAN_DOWNLOAD_FILE_IMPORTED",
        newValue: file.name,
        remark: result ? `${result.matchedCount} matched, ${result.unmatchedCount} not matched` : undefined,
      });
      toast({ title: "Challan report validated", description: `${portalChallans.length} challan(s) found in the report.` });
    } catch (err: any) {
      toast({ title: "Could not process this file", description: err?.message, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  const handleRevalidate = async () => {
    if (!batch) return;
    setRevalidating(true);
    const result = await compareAndSave(batch.portal_challans || [], { name: batch.file_name || "", url: batch.file_url }, batch.id);
    const firmId = await resolveFirmId();
    await logReconAudit({
      filingId, firmId, userId: user?.id, userName: user?.name || user?.email || "Unknown",
      actionType: "CHALLAN_DOWNLOAD_REVALIDATED",
      remark: result ? `${result.matchedCount} matched, ${result.unmatchedCount} not matched` : undefined,
    });
    setRevalidating(false);
    toast({ title: "Re-validated against current challan data" });
  };

  const handleDelete = async () => {
    if (!batch) return;
    setDeleting(true);
    if (batch.file_url) removePublicDocumentByUrl(supabase, batch.file_url);
    await supabase.from("tds_challan_download_batches" as any).delete().eq("id", batch.id);
    const firmId = await resolveFirmId();
    await logReconAudit({
      filingId, firmId, userId: user?.id, userName: user?.name || user?.email || "Unknown",
      actionType: "CHALLAN_DOWNLOAD_FILE_DELETED", oldValue: batch.file_name,
    });
    setDeleting(false);
    await loadBatch();
  };

  /**
   * Best-effort hand-off to the extension's post-login automation — see this
   * file's own header doc. Also relays the client's SAVED ITD login the same
   * way TdsPortalLoginButtons.tsx's "Auto-fill ITD Login" does (see
   * itdCredentialsRelay.ts) — added 2026-08-11 after this button was
   * reported as opening a blank login form with no autofill at all, unlike
   * every other entry point into the portal. Whether or not the relay or the
   * automation itself lands, this also opens/focuses the ITD tab so the user
   * can finish manually if it stalls (log in, then e-File → e-Pay Tax →
   * Payment History). Nothing gets downloaded any more — the extension reads
   * the table directly and posts the result back (see the
   * CHALLAN_PAYMENT_HISTORY_RESULT listener above); "Upload Downloaded
   * Report" below stays only as a manual fallback for accounts without the
   * extension, or if the automation genuinely can't complete on its own.
   */
  const requestDownload = () => {
    const range = quarterDateRange(filing?.financial_year, filing?.quarter);
    // window.open() FIRST, synchronously, before any await — a popup opened
    // after even one microtask of async work loses the "direct response to
    // a click" status Chrome requires and gets silently blocked. See
    // TdsPortalLoginButtons.tsx's autofillItd for the same rule.
    window.open(ITD_LOGIN_URL, "_blank", "noopener,noreferrer");
    if (!hasItdAutofillExtension()) {
      toast({ title: "Portal opened", description: "The ITD Portal Autofill extension isn't detected — log in and download Payment History yourself for this quarter, then upload it below." });
      return;
    }
    setRequestingDownload(true);
    (async () => {
      let loginRelayed = false;
      try {
        const clientServiceId = await resolveTdsClientServiceId(selClient);
        if (clientServiceId) {
          const result = await relayItdLoginCredentials(clientServiceId);
          loginRelayed = result.ok;
        }
      } catch {
        // Non-fatal — the portal tab is already open regardless; worst case
        // the user logs in manually, same as before this relay existed.
      }
      window.postMessage(
        { source: "caflow-web", type: "START_CHALLAN_DOWNLOAD", fyStartDate: range?.start ?? null, fyEndDate: range?.end ?? null },
        window.location.origin,
      );
      toast({
        title: loginRelayed ? "Sent your saved login and asked the extension to verify this quarter's challans" : "Opened the ITD Portal",
        description: loginRelayed
          ? "Check the ITD tab — your login should be filled in; click Continue to finish signing in. The rest runs automatically and results will appear back here, no download or upload needed."
          : "Log in on the ITD tab (no saved login found to auto-fill, or the extension didn't respond) — verification will pick up automatically once you're in.",
      });
      setRequestingDownload(false);
    })();
  };

  const ran = !!batch && batch.matched_count !== null;
  const allMatch = ran && (batch!.unmatched_count ?? 0) === 0;
  const matchResults = batch?.match_results || [];

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Receipt size={16} className="text-muted-foreground" />
              <span className="text-sm font-semibold">Challan Payment History (ITD Portal)</span>
            </div>
            {!disabled && (
              <div className="flex items-center gap-1.5">
                <Button size="sm" variant="outline" className="gap-1.5" disabled={requestingDownload} onClick={requestDownload}>
                  {requestingDownload ? <Loader2 size={13} className="animate-spin" /> : <CloudDownload size={13} />}
                  Verify on ITD Portal
                </Button>
                <input
                  ref={fileInputRef} type="file" accept=".pdf" className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }}
                />
                <Button size="sm" variant="outline" className="gap-1.5" disabled={uploading}
                  onClick={() => fileInputRef.current?.click()}>
                  {uploading ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
                  {batch ? "Replace Report" : "Upload Downloaded Report"}
                </Button>
              </div>
            )}
          </div>

          {!batch ? (
            <p className="text-xs text-muted-foreground">
              Not verified yet. Click "Verify on ITD Portal" to open the portal — with the browser extension installed,
              it logs in (you finish the last click) and reads this quarter's challans automatically, no download or
              upload needed. Without the extension, use Payment History → Actions → Download and upload the file below instead.
            </p>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>{batch.file_name} · imported {batch.imported_at ? new Date(batch.imported_at).toLocaleString("en-IN") : "—"} · {batch.portal_challan_count ?? 0} challan(s) in report</span>
                <div className="flex items-center gap-1">
                  {batch.file_url && (
                    <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs" onClick={() => downloadStorageFile(batch.file_url!, batch.file_name || "challan-report.pdf")}>
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

              {matchResults.length > 0 && (
                <div className="rounded-lg border divide-y">
                  {matchResults.map((m) => (
                    <div key={m.officeChallanId} className={cn("flex items-center justify-between gap-3 px-3 py-2 text-xs", !m.matched && "bg-destructive/5")}>
                      <div className="flex items-center gap-2 min-w-0">
                        {m.matched ? <CheckCircle2 size={13} className="text-emerald-600 shrink-0" /> : <XCircle size={13} className="text-destructive shrink-0" />}
                        <span className="font-medium">Challan #{m.officeSerialNo || "—"}</span>
                        <span className="text-muted-foreground">{m.officeDate || "—"}</span>
                        <span className="text-muted-foreground">{money(m.officeAmount)}</span>
                      </div>
                      {m.reason ? (
                        <span className="text-destructive shrink-0">{m.reason}</span>
                      ) : (
                        <Badge variant="outline" className="shrink-0 text-[10px] border-emerald-300 text-emerald-700 dark:text-emerald-400">Matched</Badge>
                      )}
                    </div>
                  ))}
                </div>
              )}

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
                      <p className="font-semibold text-destructive">{batch!.unmatched_count} challan(s) don't match the portal report</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Review challans in Data Entry, or re-download the correct quarter's report, then re-validate.
                      </p>
                    </div>
                  </div>
                )
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
