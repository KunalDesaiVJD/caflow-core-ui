/**
 * PipelineStage5 — Stage 3: Audit Query Tracker
 *
 * The previous Audit Query Tracker (large query-management UI) has been
 * retired; this stage is now a host for the 3 communication / findings
 * tabs that were previously inside Stage 2's Audit Worksheet:
 *
 *   • Client Inbox   (AuditClientInboxTab)
 *   • Comm. Log      (CommunicationLogTab)
 *   • Findings       (FindingsTab)
 *
 * Each tab loads its own data via `useAuditWorksheetData(engagementId)`.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { toast } from "sonner";
import {
  ArrowRight, AlertTriangle, MessageSquareWarning, MailCheck, ShieldAlert,
} from "lucide-react";

import EngagementHeader from "@/components/pipeline/EngagementHeader";
import { useAuditWorksheetData } from "@/components/audit-worksheet/hooks/useAuditWorksheetData";
import { AuditClientInboxTab }   from "@/components/audit-worksheet/AuditClientInboxTab";
import { CommunicationLogTab }   from "@/components/audit-worksheet/CommunicationLogTab";
import { FindingsTab }           from "@/components/audit-worksheet/FindingsTab";

interface PipelineStage5Props {
  engagementId:    string;
  engagement:      any;
  onStageComplete: () => void;
  onSaveDraft:     () => void;
}

export default function PipelineStage5({
  engagementId, engagement, onStageComplete, onSaveDraft,
}: PipelineStage5Props) {
  const data = useAuditWorksheetData(engagementId);

  const [activeTab, setActiveTab] = useState<"client_inbox" | "comm_log" | "findings">("client_inbox");
  const [saving,    setSaving]    = useState(false);

  // Snap to the default tab once data finishes loading (parity with
  // AuditWorksheetPage's tab-init pattern — keeps initial render stable).
  const tabInitialized = useRef(false);
  useEffect(() => {
    if (!data.loading && !tabInitialized.current) {
      tabInitialized.current = true;
    }
  }, [data.loading]);

  // ─── Save / Complete stage ──────────────────────────────────────────────────
  const saveDraft = useCallback(async () => {
    setSaving(true);
    const newStatuses = {
      ...((engagement?.stage_statuses || {}) as Record<string, string>),
      "5": "in_progress",
    };
    const { error } = await supabase
      .from("audit_engagements")
      .update({ stage_statuses: newStatuses } as any)
      .eq("id", engagementId);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Progress saved");
    onSaveDraft();
  }, [engagement, engagementId, onSaveDraft]);

  const completeStage = useCallback(async () => {
    setSaving(true);
    const newStatuses = {
      ...((engagement?.stage_statuses || {}) as Record<string, string>),
      "5": "complete",
      "6": "in_progress",
    };
    const { error } = await supabase
      .from("audit_engagements")
      .update({ stage_statuses: newStatuses, pipeline_stage: 6 } as any)
      .eq("id", engagementId);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Stage 3 completed");
    onStageComplete();
  }, [engagement, engagementId, onStageComplete]);

  // ─── Loading / error states ────────────────────────────────────────────────
  if (data.loading) {
    return (
      <div className="space-y-3 p-4">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (data.error) {
    return (
      <Alert variant="destructive" className="m-4">
        <AlertTriangle size={16} />
        <AlertDescription>{data.error}</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="max-w-7xl space-y-4">
      <EngagementHeader engagement={engagement} stageNumber={3} stageLabel="Audit Query Tracker" />

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-foreground">Stage 3 — Audit Query Tracker</h1>
          <p className="text-sm text-muted-foreground">
            Client communications and audit findings
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={saveDraft} disabled={saving}>
            Save Draft
          </Button>
          <Button size="sm" onClick={completeStage} disabled={saving} className="gap-1">
            Complete Stage 3 <ArrowRight size={14} />
          </Button>
        </div>
      </div>

      {/* Tabs — only the three migrated tabs are rendered here */}
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)}>
        <TabsList className="flex-wrap h-auto gap-1">
          <TabsTrigger value="client_inbox" className="text-xs gap-1">
            <MessageSquareWarning size={11} /> Client Inbox
          </TabsTrigger>
          <TabsTrigger value="comm_log" className="text-xs gap-1">
            <MailCheck size={11} /> Comm. Log
          </TabsTrigger>
          <TabsTrigger value="findings" className="text-xs gap-1">
            <ShieldAlert size={11} /> Findings
          </TabsTrigger>
        </TabsList>

        <TabsContent value="client_inbox" className="mt-3">
          <AuditClientInboxTab data={data} engagementId={engagementId} />
        </TabsContent>

        <TabsContent value="comm_log" className="mt-3">
          <CommunicationLogTab data={data} engagementId={engagementId} />
        </TabsContent>

        <TabsContent value="findings" className="mt-3">
          <FindingsTab
            data={data}
            engagementId={engagementId}
            externalPrefill={null}
            onPrefillConsumed={() => {}}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
