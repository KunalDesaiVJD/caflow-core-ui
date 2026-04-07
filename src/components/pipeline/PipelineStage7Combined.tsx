import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { ArrowRight, BookMarked, Shield, Loader2 } from 'lucide-react';
import { EngagementCARO } from '@/components/engagement/EngagementCARO';
import NotesToAccounts from '@/pages/NotesToAccounts';

interface Props {
  engagementId: string;
  engagement: any;
  onStageComplete: () => void;
  onSaveDraft: () => void;
}

export default function PipelineStage7Combined({
  engagementId, engagement, onStageComplete, onSaveDraft
}: Props) {
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState('notes');

  // ─── Corporate entity check ───
  // engagement.entity_type values (set at engagement creation): "company" | "llp" | "individual" | "firm" | "trust" | "huf" | "aop"
  // engagement.clients.entity_type values (set at client creation): "Private Ltd" | "Public Ltd" | "LLP" | "Partnership" | etc.
  // CARO 2020 applies ONLY to companies (Private/Public Limited). Enforce both entity-type signals
  // so that even if the caro_applicable flag is misconfigured, non-corporates never see CARO.
  const engEntityType = (engagement?.entity_type || "").toLowerCase();
  const clientEntityType = (engagement?.clients?.entity_type || "");
  const isCorporate =
    engEntityType === "company" ||
    clientEntityType === "Private Ltd" ||
    clientEntityType === "Public Ltd";

  const markComplete = async () => {
    setSaving(true);
    const newStatuses = {
      ...((engagement?.stage_statuses || {}) as Record<string, string>),
      '7': 'complete'
    };
    const { error } = await supabase
      .from('audit_engagements')
      .update({ stage_statuses: newStatuses, pipeline_stage: 8 } as any)
      .eq('id', engagementId);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success('Stage 7 completed — proceeding to 3CD Reports');
    onStageComplete();
  };

  const saveDraft = async () => {
    setSaving(true);
    const newStatuses = {
      ...((engagement?.stage_statuses || {}) as Record<string, string>),
      '7': 'in_progress'
    };
    const { error } = await supabase
      .from('audit_engagements')
      .update({ stage_statuses: newStatuses } as any)
      .eq('id', engagementId);
    setSaving(false);
    if (error) toast.error(error.message);
    else { toast.success('Progress saved'); onSaveDraft(); }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">
            {isCorporate ? 'Stage 7 — Notes to Accounts & CARO' : 'Stage 7 — Notes to Accounts'}
          </h1>
          <p className="text-sm text-muted-foreground">
            {isCorporate
              ? 'Notes to financial statements and CARO 2020 reporting'
              : 'Notes to financial statements'}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={saveDraft} disabled={saving}>
            {saving && <Loader2 className="w-4 h-4 animate-spin mr-1" />} Save Draft
          </Button>
          <Button onClick={markComplete} disabled={saving} className="gap-1">
            Complete Stage 7 <ArrowRight size={14} />
          </Button>
        </div>
      </div>

      {isCorporate ? (
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="notes" className="gap-1">
              <BookMarked size={14} /> Notes to Accounts
            </TabsTrigger>
            <TabsTrigger value="caro" className="gap-1">
              <Shield size={14} /> CARO 2020
            </TabsTrigger>
          </TabsList>

          <TabsContent value="notes" className="mt-4">
            <NotesToAccounts engagementIdProp={engagementId} isCorporate={true} />
          </TabsContent>

          <TabsContent value="caro" className="mt-4">
            <EngagementCARO
              engagement={engagement}
              client={engagement?.clients}
              onUpdate={() => {}}
            />
          </TabsContent>
        </Tabs>
      ) : (
        /* Non-corporate: Notes to Accounts only — no CARO tab at all */
        <NotesToAccounts engagementIdProp={engagementId} isCorporate={false} />
      )}
    </div>
  );
}
