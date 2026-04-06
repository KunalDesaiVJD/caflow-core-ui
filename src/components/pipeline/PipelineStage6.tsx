import { useState, useEffect, useMemo, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import AuditWorksheetModule from "@/components/pipeline/AuditWorksheetModule";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  FileText, Plus, ArrowRight, Loader2, ClipboardCheck
} from "lucide-react";
import { Json } from "@/integrations/supabase/types";

interface PipelineStage6Props {
  engagementId: string;
  engagement: any;
  onStageComplete: () => void;
  onSaveDraft: () => void;
}

// ─── Workpaper ───
interface Workpaper {
  id: string;
  wp_ref: string | null;
  section: string | null;
  objective: string | null;
  procedure: string | null;
  conclusion: string | null;
  signed_by: string | null;
}

const AUDIT_SECTIONS = [
  "Revenue", "Fixed Assets", "Debtors", "Creditors", "Loans",
  "Inventory", "Payroll", "Taxes", "Related Parties", "Cash",
  "General", "Other"
];

export default function PipelineStage6({ engagementId, engagement, onStageComplete, onSaveDraft }: PipelineStage6Props) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState("audit_sheet");
  const [saving, setSaving] = useState(false);

  // ─── WORKPAPERS STATE ───
  const { data: workpapers, refetch: refetchWP } = useQuery({
    queryKey: ["workpapers", engagementId],
    queryFn: async () => {
      const { data } = await supabase
        .from("audit_workpapers")
        .select("*")
        .eq("engagement_id", engagementId)
        .order("wp_ref");
      return (data || []) as unknown as Workpaper[];
    },
    enabled: !!engagementId,
  });

  const [showAddWP, setShowAddWP] = useState(false);
  const [wpForm, setWpForm] = useState({ section: "", objective: "", procedure: "", conclusion: "" });

  const addWorkpaper = async () => {
    const nextRef = `W${(workpapers?.length || 0) + 1}`;
    const { error } = await supabase.from("audit_workpapers").insert({
      engagement_id: engagementId,
      wp_ref: nextRef,
      section: wpForm.section,
      objective: wpForm.objective,
      procedure: wpForm.procedure,
      conclusion: wpForm.conclusion,
      signed_by: user?.name || null,
    } as any);
    if (error) { toast.error(error.message); return; }
    toast.success(`Workpaper ${nextRef} added`);
    setShowAddWP(false);
    setWpForm({ section: "", objective: "", procedure: "", conclusion: "" });
    refetchWP();
  };

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

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="audit_sheet" className="gap-1">
            <ClipboardCheck size={14} /> Audit Sheet
          </TabsTrigger>
          <TabsTrigger value="workpapers" className="gap-1">
            <FileText size={14} /> Workpaper Index
          </TabsTrigger>
        </TabsList>

        {/* ═══ AUDIT SHEET — Full Worksheet Module ═══ */}
        <TabsContent value="audit_sheet">
          <AuditWorksheetModule
            engagementId={engagementId}
            engagement={engagement}
          />
        </TabsContent>

        {/* ═══ WORKPAPERS ═══ */}
        <TabsContent value="workpapers" className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">Workpaper index for this engagement</p>
            <Button size="sm" onClick={() => setShowAddWP(true)} className="gap-1"><Plus size={14} /> Add Workpaper</Button>
          </div>

          <div className="border rounded-lg overflow-auto bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[70px]">W/P Ref</TableHead>
                  <TableHead className="w-[140px]">Audit Area</TableHead>
                  <TableHead>Objective</TableHead>
                  <TableHead>Procedure</TableHead>
                  <TableHead>Conclusion</TableHead>
                  <TableHead className="w-[100px]">Prepared By</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(workpapers || []).length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                      No workpapers yet. Click "Add Workpaper" to create one.
                    </TableCell>
                  </TableRow>
                ) : (workpapers || []).map(wp => (
                  <TableRow key={wp.id}>
                    <TableCell className="font-mono font-bold text-xs">{wp.wp_ref}</TableCell>
                    <TableCell className="text-sm">{wp.section || "—"}</TableCell>
                    <TableCell className="text-xs">{wp.objective || "—"}</TableCell>
                    <TableCell className="text-xs">{wp.procedure || "—"}</TableCell>
                    <TableCell className="text-xs">{wp.conclusion || "—"}</TableCell>
                    <TableCell className="text-xs">{wp.signed_by || "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Add Workpaper Dialog */}
          <Dialog open={showAddWP} onOpenChange={setShowAddWP}>
            <DialogContent className="max-w-lg">
              <DialogHeader><DialogTitle>Add Workpaper</DialogTitle></DialogHeader>
              <div className="grid gap-3">
                <div>
                  <Label>Audit Area / Section</Label>
                  <Select value={wpForm.section} onValueChange={v => setWpForm(f => ({ ...f, section: v }))}>
                    <SelectTrigger><SelectValue placeholder="Select area" /></SelectTrigger>
                    <SelectContent>
                      {AUDIT_SECTIONS.map(a => <SelectItem key={a} value={a}>{a}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Objective</Label>
                  <Textarea value={wpForm.objective} onChange={e => setWpForm(f => ({ ...f, objective: e.target.value }))} rows={2} />
                </div>
                <div>
                  <Label>Procedure Performed</Label>
                  <Textarea value={wpForm.procedure} onChange={e => setWpForm(f => ({ ...f, procedure: e.target.value }))} rows={2} />
                </div>
                <div>
                  <Label>Conclusion</Label>
                  <Textarea value={wpForm.conclusion} onChange={e => setWpForm(f => ({ ...f, conclusion: e.target.value }))} rows={2} />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setShowAddWP(false)}>Cancel</Button>
                <Button onClick={addWorkpaper} disabled={!wpForm.section}>Add</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </TabsContent>
      </Tabs>
    </div>
  );
}
