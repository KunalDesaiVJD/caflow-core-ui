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

interface Props {
  engagementId: string;
  engagement: any;
  onStageComplete: () => void;
  onSaveDraft: () => void;
}

export default function PipelineStage2({ engagementId, engagement, onStageComplete }: Props) {
  const navigate = useNavigate();

  // ── Fetch the most recent completed sync batch for this engagement ──
  const { data: syncBatch, isLoading } = useQuery({
    queryKey: ["sync-batch-stage2", engagementId, engagement?.client_id],
    queryFn: async () => {
      // Primary: sync_batch keyed to this engagement
      const { data: byEng } = await (supabase.from as any)("sync_batches")
        .select("id, status, completed_at, tally_company, tb_rows_fetched, warnings")
        .eq("engagement_id", engagementId)
        .in("status", ["completed", "complete", "success", "complete_with_warnings"])
        .order("completed_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (byEng) return byEng;

      // Fallback: sync batch keyed to client_id (older syncs pre-engagement wiring)
      if (!engagement?.client_id) return null;
      const { data: byClient } = await (supabase.from as any)("sync_batches")
        .select("id, status, completed_at, tally_company, tb_rows_fetched, warnings")
        .eq("client_id", engagement.client_id)
        .in("status", ["completed", "complete", "success", "complete_with_warnings"])
        .order("completed_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return byClient ?? null;
    },
    enabled: !!engagementId,
    refetchInterval: 30_000, // re-check every 30s so the page updates after user syncs
  });

  const isSynced = !!syncBatch;

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
                <Button onClick={() => navigate("/audit/tally-sync")} variant="outline" size="sm">
                  <ExternalLink className="w-3.5 h-3.5 mr-1.5" />
                  Open Tally Sync
                </Button>
                <Button onClick={requestSync} variant="ghost" size="sm">
                  <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
                  Re-sync Now
                </Button>
                <Button
                  onClick={onStageComplete}
                  size="sm"
                  className="ml-auto"
                >
                  Proceed to COA Mapping
                  <ArrowRight className="w-3.5 h-3.5 ml-1.5" />
                </Button>
              </div>
            </div>
          ) : (
            // ── No sync yet ──
            <div className="space-y-3">
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

              <div className="rounded-lg border p-4 space-y-2 text-sm text-muted-foreground">
                <p className="font-medium text-foreground">How to sync Tally data:</p>
                <ol className="list-decimal list-inside space-y-1 text-xs">
                  <li>Open the correct company in Tally on your PC</li>
                  <li>Run <code className="bg-muted px-1 rounded">sync-now.bat</code> from the CAFlow Tally Sync folder</li>
                  <li>Wait for "SYNC COMPLETE" message — this page auto-updates every 30 seconds</li>
                </ol>
              </div>

              <div className="flex gap-2">
                <Button onClick={() => navigate("/audit/tally-sync")} variant="outline" size="sm">
                  <ExternalLink className="w-3.5 h-3.5 mr-1.5" />
                  Open Tally Sync Page
                </Button>
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
    </div>
  );
}
