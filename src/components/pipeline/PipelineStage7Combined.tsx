import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { ArrowRight, BookMarked, Shield, Loader2, ClipboardList, Droplets } from 'lucide-react';
import { EngagementCARO } from '@/components/engagement/EngagementCARO';
import { MRLTab } from '@/components/stage7/MRLTab';
import { NCENotesToAccounts } from '@/components/stage7/NotesToAccounts';
import { IFCReportTab } from '@/components/stage7/IFCReportTab';
import { CashFlowNotesTab } from '@/components/stage7/CashFlowNotesTab';
import { isCompanyEntity } from '@/utils/entityUtils';
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
  // isCompanyEntity checks both engagement.entity_type and clients.entity_type.
  // CARO 2020 and MRL apply ONLY to companies (Private/Public Limited / OPC).
  const isCorporate =
    isCompanyEntity(engagement?.entity_type) ||
    isCompanyEntity(engagement?.clients?.entity_type);

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
            {isCorporate ? 'Stage 7 — Notes, CARO & MRL' : 'Stage 7 — Notes to Accounts'}
          </h1>
          <p className="text-sm text-muted-foreground">
            {isCorporate
              ? 'Notes to financial statements, CARO 2020 reporting and Management Representation Letter'
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
        <CorporateStage7Tabs
          engagementId={engagementId}
          engagement={engagement}
          activeTab={activeTab}
          setActiveTab={setActiveTab}
        />
      ) : (
        /* Non-corporate: NCE Notes to Accounts — no CARO or MRL */
        <NCENotesToAccounts engagementId={engagementId} engagement={engagement} />
      )}
    </div>
  );
}

// ─── Corporate Stage 7 tabs (array-driven) ──────────────────────────────────
// Tab visibility is governed by Stage 1 Block C ("Audit Applicability"):
//   - CARO 2020       → engagement.caro_applicable
//   - IFC Report      → engagement.ifc_applicable
//   - Cash Flow Notes → engagement.cash_flow_applicable
//
// Treat `null`/`undefined` as visible so legacy engagements created before
// Block C existed don't lose access to CARO/MRL. Only an explicit `false`
// (set by the auditor in Block C) hides a tab.
//
// If the active tab gets filtered out (e.g. user toggled CARO to No while
// sitting on the CARO tab), fall back to 'notes'.
interface TabsProps {
  engagementId: string;
  engagement: any;
  activeTab: string;
  setActiveTab: (v: string) => void;
}

function CorporateStage7Tabs({ engagementId, engagement, activeTab, setActiveTab }: TabsProps) {
  const tabs = useMemo(() => {
    const visible = (flag: any) => flag !== false; // null/undefined → visible
    const all = [
      { id: 'notes',    label: 'Notes to Accounts', icon: BookMarked,    show: true },
      { id: 'caro',     label: 'CARO 2020',         icon: Shield,        show: visible(engagement?.caro_applicable) },
      { id: 'ifc',      label: 'IFC Report',        icon: Shield,        show: visible(engagement?.ifc_applicable) },
      { id: 'cashflow', label: 'Cash Flow Notes',   icon: Droplets,      show: visible(engagement?.cash_flow_applicable) },
      { id: 'mrl',      label: 'MRL',               icon: ClipboardList, show: true },
    ];
    return all.filter(t => t.show);
  }, [engagement?.caro_applicable, engagement?.ifc_applicable, engagement?.cash_flow_applicable]);

  // If activeTab vanished (Block C toggled), reset to first available.
  useEffect(() => {
    if (!tabs.find(t => t.id === activeTab)) setActiveTab(tabs[0]?.id || 'notes');
  }, [tabs, activeTab, setActiveTab]);

  return (
    <Tabs value={activeTab} onValueChange={setActiveTab}>
      <TabsList>
        {tabs.map(t => {
          const Icon = t.icon;
          return (
            <TabsTrigger key={t.id} value={t.id} className="gap-1">
              <Icon size={14} /> {t.label}
            </TabsTrigger>
          );
        })}
      </TabsList>

      {tabs.some(t => t.id === 'notes') && (
        <TabsContent value="notes" className="mt-4">
          <NotesToAccounts engagementIdProp={engagementId} isCorporate={true} />
        </TabsContent>
      )}
      {tabs.some(t => t.id === 'caro') && (
        <TabsContent value="caro" className="mt-4">
          <EngagementCARO engagement={engagement} client={engagement?.clients} onUpdate={() => {}} />
        </TabsContent>
      )}
      {tabs.some(t => t.id === 'ifc') && (
        <TabsContent value="ifc" className="mt-4">
          <IFCReportTab engagementId={engagementId} engagement={engagement} />
        </TabsContent>
      )}
      {tabs.some(t => t.id === 'cashflow') && (
        <TabsContent value="cashflow" className="mt-4">
          <CashFlowNotesTab engagementId={engagementId} engagement={engagement} />
        </TabsContent>
      )}
      {tabs.some(t => t.id === 'mrl') && (
        <TabsContent value="mrl" className="mt-4">
          <MRLTab engagementId={engagementId} engagement={engagement} />
        </TabsContent>
      )}
    </Tabs>
  );
}
