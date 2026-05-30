import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import AuditWorksheetPage from "@/components/audit-worksheet/AuditWorksheetPage";
import WorksheetVersionHistoryPanel from "@/components/audit-worksheet/WorksheetVersionHistoryPanel";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { ArrowRight, History, Loader2 } from "lucide-react";
import { useWorksheetHistory } from "@/components/audit-worksheet/hooks/useWorksheetHistory";
import EngagementHeader from "@/components/pipeline/EngagementHeader";

interface PipelineStage6Props {
  engagementId: string;
  engagement: any;
  onStageComplete: () => void;
  onSaveDraft: () => void;
}

export default function PipelineStage6({ engagementId, engagement, onStageComplete, onSaveDraft }: PipelineStage6Props) {
  const [saving,      setSaving]      = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const { logSave } = useWorksheetHistory(engagementId);

  // ─── SAVE ALL ───
  const saveAll = async (complete: boolean) => {
    setSaving(true);
    const newStatuses = {
      ...((engagement?.stage_statuses || {}) as Record<string, string>),
      '6': complete ? 'complete' : 'in_progress'
    };
    const payload: any = { stage_statuses: newStatuses };
    if (complete) payload.pipeline_stage = 7;

    const { error } = await supabase
      .from('audit_engagements')
      .update(payload)
      .eq('id', engagementId);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success(complete ? 'Stage 2 completed' : 'Progress saved');
    if (complete) onStageComplete(); else onSaveDraft();
  };

  return (
    <div className="max-w-6xl space-y-4">
      <EngagementHeader engagement={engagement} stageNumber={2} stageLabel="Workpapers & Audit Sheet" />
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-foreground">Stage 2 — Workpapers & Audit Sheet</h1>
          <p className="text-sm text-muted-foreground">Audit working papers and engagement documentation</p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            className="gap-1"
            onClick={() => setShowHistory(true)}
          >
            <History size={14} /> Version History
          </Button>
          <Button variant="outline" size="sm" onClick={() => saveAll(false)} disabled={saving}>
            {saving && <Loader2 className="w-3 h-3 animate-spin mr-1" />} Save Draft
          </Button>
          <Button size="sm" onClick={() => saveAll(true)} disabled={saving} className="gap-1">
            Complete Stage 2 <ArrowRight size={14} />
          </Button>
        </div>
      </div>

      {/* ═══ AUDIT SHEET — Full Worksheet Module ═══ */}
      <AuditWorksheetPage
        engagementId={engagementId}
        onSaved={(sectionName) => logSave(sectionName)}
        // Issue 3 (2026-05-30) — record each Query Sheet row-level edit as its
        // own history entry. The section_name embeds the row identifier so the
        // Version History panel can render "Status: Raised → Dispatched on
        // [Property, Plant & Equipment / Machinery] by Super Admin on 30/05/2026".
        onQueryFieldChange={(c) => logSave(
          `Query Sheet — ${c.rowLabel}`,
          c.rowLabel,
          c.fieldLabel,
          c.oldValue,
          c.newValue,
        )}
      />

      {/* ═══ CP-16: Version History slide-over ═══ */}
      <WorksheetVersionHistoryPanel
        engagementId={engagementId}
        open={showHistory}
        onClose={() => setShowHistory(false)}
      />
    </div>
  );
}
