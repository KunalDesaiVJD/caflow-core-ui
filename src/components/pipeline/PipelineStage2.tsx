// ═══════════════════════════════════════════════════════════════════════════
// PipelineStage2 — Tally Sync Gate  (replaces the old Trial Balance Import)
//
// Trial Balance Import has been removed. Tally Sync is the ONLY authoritative
// source of trial balance data. This stage:
//   1. Shows the most recent sync status for this engagement
//   2. Guides the user to run Tally Sync if not yet done
//   3. Auto-marks Stage 2 complete once a successful sync_batch exists
// ═══════════════════════════════════════════════════════════════════════════

import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import EngagementHeader from "@/components/pipeline/EngagementHeader";
import { RefreshCw, CheckCircle2, AlertTriangle, ArrowRight, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import TallySyncPage from "@/pages/TallySyncPage";

interface Props {
  engagementId: string;
  engagement: any;
  onStageComplete: () => void;
  onSaveDraft: () => void;
}

export default function PipelineStage2({ engagementId, engagement, onStageComplete }: Props) {
  const navigate = useNavigate();

  // ── Fetch the most recent completed sync batch for this engagement ──
  // PY shells share a client_id with the CY engagement. The legacy client_id
  // fallback below would mis-classify a PY shell as "synced" simply because
  // a sibling CY engagement had a sync batch — even though the PY shell's
  // own tally_trial_balance / tally_ledgers / tally_vouchers tables are
  // empty. Detect that case and surface it explicitly instead.
  const { data: syncInfo, isLoading } = useQuery({
    queryKey: ["sync-batch-stage2", engagementId, engagement?.client_id, engagement?.is_py_shell],
    queryFn: async () => {
      // Primary: sync_batch keyed to this engagement
      const { data: byEng } = await (supabase.from as any)("sync_batches")
        .select("id, status, completed_at, tally_company, tb_rows_fetched, warnings")
        .eq("engagement_id", engagementId)
        .in("status", ["completed", "complete", "success", "complete_with_warnings"])
        .order("completed_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (byEng) return { batch: byEng, source: "engagement" as const };

      // For PY shells we never fall back — a sibling engagement's sync batch
      // has nothing to do with the PY shell's own (empty) tables.
      if ((engagement as any)?.is_py_shell) {
        // Probe whether a sibling engagement is synced so we can show a
        // helpful "synced on the wrong engagement" message.
        if (!engagement?.client_id) return { batch: null, source: "none" as const };
        const { data: sibling } = await (supabase.from as any)("sync_batches")
          .select("id, completed_at, tally_company, engagement_id")
          .eq("client_id", engagement.client_id)
          .neq("engagement_id", engagementId)
          .in("status", ["completed", "complete", "success", "complete_with_warnings"])
          .order("completed_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        return { batch: null, source: sibling ? "sibling" as const : "none" as const, sibling };
      }

      // Fallback: sync batch keyed to client_id (older syncs pre-engagement wiring)
      if (!engagement?.client_id) return { batch: null, source: "none" as const };
      const { data: byClient } = await (supabase.from as any)("sync_batches")
        .select("id, status, completed_at, tally_company, tb_rows_fetched, warnings")
        .eq("client_id", engagement.client_id)
        .in("status", ["completed", "complete", "success", "complete_with_warnings"])
        .order("completed_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return byClient ? { batch: byClient, source: "client" as const } : { batch: null, source: "none" as const };
    },
    enabled: !!engagementId,
    refetchInterval: 30_000, // re-check every 30s so the page updates after user syncs
  });

  // Per-table row counts for THIS engagement — the only authoritative signal
  // that data really landed against this engagement_id.
  const { data: rowCounts } = useQuery({
    queryKey: ["stage2-rowcounts", engagementId],
    queryFn: async () => {
      const tables = ["tally_trial_balance","tally_ledgers","tally_vouchers","tally_groups"] as const;
      const out: Record<string, number> = {};
      for (const t of tables) {
        const { count } = await (supabase.from as any)(t)
          .select("id", { count: "exact", head: true })
          .eq("engagement_id", engagementId);
        out[t] = count ?? 0;
      }
      return out;
    },
    enabled: !!engagementId,
    refetchInterval: 30_000,
  });

  const syncBatch: any = syncInfo?.batch ?? null;
  const totalRows = (rowCounts?.tally_trial_balance ?? 0)
                  + (rowCounts?.tally_ledgers ?? 0)
                  + (rowCounts?.tally_vouchers ?? 0)
                  + (rowCounts?.tally_groups ?? 0);
  // "Synced" requires both a batch keyed to THIS engagement AND actual rows
  // in this engagement's tables. Either condition alone is a false positive.
  const isSynced = !!syncBatch && totalRows > 0;

  // ── Auto-complete Stage 2 once a sync batch is found ──
  useEffect(() => {
    if (!isSynced || !engagementId) return;
    const alreadyDone = (engagement?.stage_statuses as any)?.[2] === "complete";
    if (alreadyDone) return;

    supabase
      .from("audit_engagements")
      .update({
        stage_statuses: { ...(engagement?.stage_statuses || {}), "2": "complete" },
        pipeline_stage: Math.max(engagement?.pipeline_stage ?? 2, 3),
      } as any)
      .eq("id", engagementId)
      .then(({ error }) => {
        if (!error) onStageComplete();
      });
  }, [isSynced, engagementId]);

  const syncedAt = syncBatch?.completed_at
    ? new Date(syncBatch.completed_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })
    : null;

  const hasWarnings = (syncBatch?.warnings ?? []).length > 0;

  // ── Request a fresh sync via sync_requests table ──
  const requestSync = async () => {
    try {
      await (supabase.from as any)("sync_requests").insert({
        engagement_id: engagementId,
        client_id: engagement?.client_id,
        status: "pending",
        requested_at: new Date().toISOString(),
      });
      toast.success("Sync request sent — your Tally Sync agent will pick it up within 30 seconds");
    } catch {
      toast.info("Open Tally Sync page and click 'Sync Now' to refresh data");
    }
  };

  return (
    <div className="space-y-4">
      <EngagementHeader engagement={engagement} stageNumber={5} stageLabel="Tally Sync" />

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <RefreshCw className="w-4 h-4" />
            Stage 2 — Tally Sync
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">

          {isLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground text-sm py-6">
              <RefreshCw className="w-4 h-4 animate-spin" />
              Checking sync status…
            </div>
          ) : isSynced ? (
            // ── Sync found ──
            <div className="space-y-3">
              <div className="flex items-start gap-3 p-3 rounded-lg bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-900">
                <CheckCircle2 className="w-5 h-5 text-green-600 mt-0.5 shrink-0" />
                <div className="space-y-1">
                  <p className="text-sm font-medium text-green-800 dark:text-green-300">
                    Tally sync completed — trial balance data is available
                  </p>
                  <p className="text-xs text-green-700 dark:text-green-400">
                    Company: <span className="font-mono">{syncBatch.tally_company || "—"}</span>
                    {" · "}Last synced: {syncedAt}
                    {syncBatch.tb_rows_fetched ? ` · ${syncBatch.tb_rows_fetched} TB rows` : ""}
                  </p>
                  {/* Per-table breakdown so the user can see exactly what landed */}
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-green-700/90 dark:text-green-400/90 pt-0.5">
                    <span><b>{rowCounts?.tally_trial_balance ?? 0}</b> TB rows</span>
                    <span><b>{rowCounts?.tally_ledgers ?? 0}</b> ledgers</span>
                    <span><b>{rowCounts?.tally_vouchers ?? 0}</b> vouchers</span>
                    <span><b>{rowCounts?.tally_groups ?? 0}</b> groups</span>
                  </div>
                </div>
              </div>

              {hasWarnings && (
                <Alert className="border-amber-200 bg-amber-50 dark:bg-amber-950/20">
                  <AlertTriangle className="w-4 h-4 text-amber-600" />
                  <AlertDescription className="text-xs text-amber-700 dark:text-amber-400">
                    Sync completed with warnings — check Tally Sync page for details before proceeding.
                  </AlertDescription>
                </Alert>
              )}

              <div className="flex gap-2 pt-1">
                {/* Only show standalone Tally Sync link for regular (non-PY-shell) engagements.
                    PY shells use this same Stage 2 page as their sync UI — navigating to the
                    standalone /audit/tally-sync page would show the CY client's data instead. */}
                {!(engagement as any)?.is_py_shell && (
                  <Button onClick={() => navigate("/audit/tally-sync")} variant="outline" size="sm">
                    <ExternalLink className="w-3.5 h-3.5 mr-1.5" />
                    Open Tally Sync
                  </Button>
                )}
                <Button onClick={requestSync} variant="ghost" size="sm">
                  <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
                  Re-sync Now
                </Button>
                {!(engagement as any)?.is_py_shell && (
                  <Button
                    onClick={onStageComplete}
                    size="sm"
                    className="ml-auto"
                  >
                    Proceed to COA Mapping
                    <ArrowRight className="w-3.5 h-3.5 ml-1.5" />
                  </Button>
                )}
              </div>
            </div>
          ) : (
            // ── No sync yet ──
            <div className="space-y-3">
              {syncInfo?.source === "sibling" && (engagement as any)?.is_py_shell ? (
                <Alert className="border-red-300 bg-red-50 dark:bg-red-950/20">
                  <AlertTriangle className="w-4 h-4 text-red-600" />
                  <AlertDescription className="text-sm text-red-800 dark:text-red-400 space-y-1">
                    <div className="font-semibold">This PY shell has not been synced yet.</div>
                    <div>
                      A sync batch exists for the <b>current-year</b> engagement (same client) — but the PY shell's own tables
                      (<code className="text-[11px]">tally_trial_balance</code>, <code className="text-[11px]">tally_ledgers</code>, <code className="text-[11px]">tally_vouchers</code>, <code className="text-[11px]">tally_groups</code>)
                      are all empty. The sync was run while Tally was on the current-year period.
                    </div>
                    <div className="pt-1">
                      <b>To fix:</b> in Tally press <code className="bg-red-100 dark:bg-red-900/30 px-1 rounded">F2</code> →
                      set period to <b>FY {engagement?.financial_year}</b> (01-Apr to 31-Mar), press <kbd>Esc</kbd> back to
                      Gateway, then run <code className="bg-red-100 dark:bg-red-900/30 px-1 rounded">sync-py.bat</code>
                      from <code className="bg-red-100 dark:bg-red-900/30 px-1 rounded">C:\team-package</code>.
                    </div>
                  </AlertDescription>
                </Alert>
              ) : (
                <Alert className="border-amber-200 bg-amber-50 dark:bg-amber-950/20">
                  <AlertTriangle className="w-4 h-4 text-amber-600" />
                  <AlertDescription className="text-sm text-amber-700 dark:text-amber-400">
                    No Tally sync found for this engagement. Trial Balance data is not yet available.
                    <br />
                    <span className="font-medium">
                      Open Tally on your PC with the correct company, then run the sync agent.
                    </span>
                  </AlertDescription>
                </Alert>
              )}

              {/* Per-engagement row counts — proves whether data actually landed */}
              <div className="grid grid-cols-4 gap-2">
                {[
                  { label: "TB Rows",  key: "tally_trial_balance" },
                  { label: "Ledgers",  key: "tally_ledgers" },
                  { label: "Vouchers", key: "tally_vouchers" },
                  { label: "Groups",   key: "tally_groups" },
                ].map(t => (
                  <div key={t.key} className="border rounded px-2 py-1.5 bg-muted/30">
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{t.label}</div>
                    <div className={`text-sm font-semibold ${(rowCounts?.[t.key] ?? 0) > 0 ? "text-foreground" : "text-red-600"}`}>
                      {(rowCounts?.[t.key] ?? 0).toLocaleString()}
                    </div>
                  </div>
                ))}
              </div>

              <div className="rounded-lg border p-4 space-y-2 text-sm text-muted-foreground">
                <p className="font-medium text-foreground">How to sync Tally data:</p>
                <ol className="list-decimal list-inside space-y-1 text-xs">
                  <li>Open the correct company in Tally on your PC</li>
                  <li>Run <code className="bg-muted px-1 rounded">sync-now.bat</code> from the CAFlow Tally Sync folder</li>
                  <li>Wait for "SYNC COMPLETE" message — this page auto-updates every 30 seconds</li>
                </ol>
              </div>

              <div className="flex gap-2">
                {/* For regular engagements only — PY shells use THIS page as their sync UI */}
                {!(engagement as any)?.is_py_shell && (
                  <Button onClick={() => navigate("/audit/tally-sync")} variant="outline" size="sm">
                    <ExternalLink className="w-3.5 h-3.5 mr-1.5" />
                    Open Tally Sync Page
                  </Button>
                )}
                <Button onClick={requestSync} size="sm">
                  <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
                  Request Sync
                </Button>
              </div>
            </div>
          )}

          <div className="pt-2 border-t text-xs text-muted-foreground">
            <Badge variant="secondary" className="text-xs mr-2">ℹ️ Info</Badge>
            Trial Balance Import has been replaced by Tally Sync. All balance data comes directly
            from Tally via the sync agent — no manual file upload is required.
          </div>
        </CardContent>
      </Card>

      {/* ── PY Shell: detailed Trial Balance / Ledgers / Vouchers / Groups view ──
         For PY shells we render the same rich detailed view that Stage 5 (CY)
         shows on /audit/tally-sync, but scoped to THIS PY shell's engagement_id
         (not the globally selected CY engagement). The standalone tally-sync
         page is engagement-agnostic and would otherwise show CY data here. */}
      {(engagement as any)?.is_py_shell && isSynced && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <RefreshCw className="w-4 h-4" />
              PY Shell — Detailed Trial Balance &amp; Ledgers
              <Badge variant="outline" className="ml-2 text-[10px]">
                FY {engagement?.financial_year ?? "—"}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <TallySyncPage engagementOverride={engagement} hideHeader />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
