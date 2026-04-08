import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import AuditWorksheetPage from "@/components/audit-worksheet/AuditWorksheetPage";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { ArrowRight, Loader2 } from "lucide-react";

interface PipelineStage6Props {
  engagementId: string;
  engagement: any;
  onStageComplete: () => void;
  onSaveDraft: () => void;
}

export default function PipelineStage6({ engagementId, engagement, onStageComplete, onSaveDraft }: PipelineStage6Props) {
  const [saving, setSaving] = useState(false);

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
    toast.success(complete ? 'Stage 6 completed' : 'Progress saved');
    if (complete) onStageComplete(); else onSaveDraft();
  };

  return (
    <div className="max-w-6xl space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">Stage 6 — Workpapers & Audit Sheet</h1>
          <p className="text-sm text-muted-foreground">Audit working papers and engagement documentation</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => saveAll(false)} disabled={saving}>
            {saving && <Loader2 className="w-3 h-3 animate-spin mr-1" />} Save Draft
          </Button>
          <Button size="sm" onClick={() => saveAll(true)} disabled={saving} className="gap-1">
            Complete Stage 6 <ArrowRight size={14} />
          </Button>
        </div>
      </div>

      {/* ═══ AUDIT SHEET — Full Worksheet Module ═══ */}
      <AuditWorksheetPage engagementId={engagementId} />
    </div>
  );
}
