import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
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

  // caroApplicable: applies to ALL corporate entities (Private Ltd / Public Ltd).
  // Fix (Issue 12): Removed the caro_applicable / requires_caro flag requirement —
  // most engagements never had that flag set to true, so CARO never showed even for
  // companies. The entity-type gate is the correct enforcement — CARO 2020 is
  // mandatory for all companies. Firms can mark individual clauses as N/A inside.
  const caroApplicable = isCorporate;

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
            Stage 7 — Notes to Accounts & CARO
          </h1>
          <p className="text-sm text-muted-foreground">
            Notes to financial statements and CARO 2020 reporting
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

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="notes" className="gap-1">
            <BookMarked size={14} /> Notes to Accounts
          </TabsTrigger>
          <TabsTrigger value="caro" className="gap-1">
            <Shield size={14} /> CARO 2020
            {!caroApplicable && (
              <Badge variant="secondary" className="ml-1 text-[9px]">N/A</Badge>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="notes" className="mt-4">
          <NotesToAccounts engagementIdProp={engagementId} />
        </TabsContent>

        <TabsContent value="caro" className="mt-4">
          {caroApplicable ? (
            <EngagementCARO
              engagement={engagement}
              client={engagement?.clients}
              onUpdate={() => {}}
            />
          ) : (
            <Card className="border-dashed border-2 border-muted">
              <CardContent className="p-12 text-center space-y-3">
                <Shield className="w-12 h-12 mx-auto text-muted-foreground/40" />
                <h3 className="text-lg font-semibold text-foreground">CARO 2020 is not applicable</h3>
                <p className="text-sm text-muted-foreground">
                  {!isCorporate
                    ? `CARO 2020 applies only to companies (Private Limited / Public Limited). This engagement is for a ${clientEntityType || engEntityType || "non-corporate"} entity.`
                    : "CARO has been marked as not applicable for this engagement. You can update this in the engagement settings if required."}
                </p>
                <p className="text-xs text-muted-foreground">Proceed to Stage 8.</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

      </Tabs>
    </div>
  );
}
