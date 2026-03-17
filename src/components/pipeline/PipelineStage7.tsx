import { useState, useEffect, useMemo, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  FileText, ArrowRight, Loader2, Save, Sparkles, Check, Plus, Download,
  Eye, ChevronRight, BookOpen, Edit3, X, AlertTriangle
} from "lucide-react";
import { Json } from "@/integrations/supabase/types";

interface PipelineStage7Props {
  engagementId: string;
  engagement: any;
  onStageComplete: () => void;
  onSaveDraft: () => void;
}

// Accounting Policies sub-sections for Note 2
const POLICY_SUB_SECTIONS = [
  { key: "a_ppe", label: "a) Property, Plant & Equipment", template: "Property, Plant and Equipment are stated at cost less accumulated depreciation and impairment losses. Cost includes purchase price and directly attributable costs of bringing the asset to working condition." },
  { key: "b_depreciation", label: "b) Depreciation", template: "Depreciation is provided on Written Down Value (WDV) method based on useful life prescribed under Schedule II of the Companies Act, 2013." },
  { key: "c_cwip", label: "c) Capital Work-in-Progress", template: "Capital work-in-progress includes cost of assets not yet ready for intended use as at the balance sheet date." },
  { key: "d_research", label: "d) Research & Development", template: "Revenue expenditure on research is charged to the Statement of Profit and Loss. Development expenditure is capitalised when feasibility is established." },
  { key: "e_intangibles", label: "e) Intangible Assets", template: "Intangible assets are recognized when it is probable that future economic benefits will flow and the cost can be reliably measured." },
  { key: "f_leases", label: "f) Leases", template: "Leases where the lessor effectively retains substantially all the risks and benefits of ownership are classified as operating leases. Lease payments are recognized as expense on a straight-line basis." },
  { key: "g_investments", label: "g) Investments", template: "Long-term investments are stated at cost. Provision is made for diminution in value if considered permanent in nature." },
  { key: "h_inventories", label: "h) Inventories", template: "Inventories are valued at lower of cost or net realisable value. Cost is determined on FIFO/Weighted Average basis." },
  { key: "i_receivables", label: "i) Trade Receivables", template: "Trade receivables are recognised at transaction price. The company applies the expected credit loss model for recognising impairment." },
  { key: "j_cash", label: "j) Cash & Cash Equivalents", template: "Cash and cash equivalents include cash on hand, demand deposits, and short-term highly liquid investments with original maturity of three months or less." },
  { key: "k_cashflow", label: "k) Cash Flow Statement", template: "The Cash Flow Statement is prepared using the Indirect Method as prescribed under AS-3/Ind AS 7." },
  { key: "l_revenue", label: "l) Revenue Recognition", template: "Revenue is recognised when it is earned and there is reasonable certainty of its ultimate collection. Revenue from sale of goods is recognized when significant risks and rewards are transferred." },
  { key: "m_borrowing", label: "m) Borrowing Costs", template: "Borrowing costs directly attributable to the acquisition/construction of qualifying assets are capitalised. Other borrowing costs are expensed." },
  { key: "n_impairment", label: "n) Impairment of Assets", template: "The company assesses at each balance sheet date whether there is any indication that an asset may be impaired. An impairment loss is recognized when the carrying amount exceeds recoverable amount." },
  { key: "o_forex", label: "o) Foreign Currency Transactions", template: "Foreign currency transactions are recorded at the exchange rate prevailing on the date of transaction. Monetary assets and liabilities are restated at year-end rates." },
  { key: "p_employee", label: "p) Employee Benefits", template: "Short-term employee benefits are expensed as incurred. Post-employment benefits (gratuity, pension) are recognized as per actuarial valuation." },
  { key: "q_provisions", label: "q) Provisions & Contingencies", template: "Provisions are recognised when there is a present obligation as a result of past events and it is probable that an outflow will be required. Contingent liabilities are disclosed." },
  { key: "r_taxes", label: "r) Income Taxes", template: "Tax expense comprises current and deferred tax. Deferred tax is recognized on timing differences between taxable income and accounting income." },
  { key: "s_grants", label: "s) Government Grants", template: "Government grants are recognised when there is reasonable assurance that the entity will comply with conditions and the grants will be received." },
  { key: "t_eps", label: "t) Earnings Per Share", template: "Basic EPS is computed by dividing net profit attributable to equity shareholders by the weighted average number of equity shares outstanding during the period." },
  { key: "u_segments", label: "u) Segment Reporting", template: "The company identifies segments based on dominant source of risks and returns. The accounting policies adopted for segment reporting are in line with the accounting policies of the company." },
];

interface NoteItem {
  note_number: number;
  note_title: string;
  is_selected: boolean;
  is_mandatory: boolean;
  note_type: string;
  content_auto: string;
  content_user: string;
  table_data: any;
  sub_sections: Record<string, { enabled: boolean; text: string }> | null;
  ai_suggested: boolean;
  is_locked: boolean;
  source: string;
}

export default function PipelineStage7({ engagementId, engagement, onStageComplete, onSaveDraft }: PipelineStage7Props) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [aiDrafting, setAiDrafting] = useState<number | null>(null);
  const [aiSuggestLoading, setAiSuggestLoading] = useState(false);
  const [showAddCustom, setShowAddCustom] = useState(false);
  const [customForm, setCustomForm] = useState({ title: "", insertAfter: 45, type: "narrative" });
  const [manualMode, setManualMode] = useState(false);
  const [overrideReason, setOverrideReason] = useState("");

  // Load note templates
  const { data: templates } = useQuery({
    queryKey: ["note-templates"],
    queryFn: async () => {
      const { data } = await supabase.from("note_templates").select("*").order("note_number");
      return data || [];
    },
  });

  // Load existing audit notes for this engagement
  const { data: savedNotes, refetch: refetchNotes } = useQuery({
    queryKey: ["audit-notes", engagementId],
    queryFn: async () => {
      const { data } = await supabase.from("audit_notes").select("*").eq("engagement_id", engagementId).order("note_number");
      return data || [];
    },
    enabled: !!engagementId,
  });

  // Build notes list from templates + saved
  const [notes, setNotes] = useState<NoteItem[]>([]);

  useEffect(() => {
    if (!templates) return;
    const entityType = engagement?.entity_type || "company";
    const isCompany = entityType === "company";

    const noteItems: NoteItem[] = templates.map((t: any) => {
      const saved = savedNotes?.find((n: any) => n.note_number === t.note_number);
      const applicable = t.applicable_when?.entity_type ? t.applicable_when.entity_type.includes(entityType) : true;
      const isMandatory = t.is_mandatory && applicable;

      // Sub-sections for Note 2
      let subSections: NoteItem["sub_sections"] = null;
      if (t.note_number === 2) {
        subSections = {};
        POLICY_SUB_SECTIONS.forEach(ps => {
          const savedSub = saved?.note_sub_sections as any;
          subSections![ps.key] = {
            enabled: savedSub?.[ps.key]?.enabled ?? true,
            text: savedSub?.[ps.key]?.text ?? ps.template,
          };
        });
      }

      return {
        note_number: t.note_number,
        note_title: t.note_title,
        is_selected: saved?.is_selected ?? isMandatory,
        is_mandatory: isMandatory,
        note_type: t.note_type,
        content_auto: saved?.note_content_auto || (t.template_content?.default_text || ""),
        content_user: saved?.note_content_user || "",
        table_data: saved?.table_data || null,
        sub_sections: subSections,
        ai_suggested: saved?.ai_suggested || false,
        is_locked: saved?.is_locked || false,
        source: saved ? "saved" : "template",
      };
    });

    // Add any custom notes (note_number > 45)
    const customSaved = savedNotes?.filter((n: any) => n.note_number > 45) || [];
    customSaved.forEach((n: any) => {
      noteItems.push({
        note_number: n.note_number,
        note_title: n.note_title,
        is_selected: n.is_selected,
        is_mandatory: false,
        note_type: "narrative",
        content_auto: n.note_content_auto || "",
        content_user: n.note_content_user || "",
        table_data: n.table_data,
        sub_sections: null,
        ai_suggested: n.ai_suggested,
        is_locked: n.is_locked,
        source: "custom",
      });
    });

    setNotes(noteItems);
  }, [templates, savedNotes, engagement?.entity_type]);

  const toggleNote = (idx: number) => {
    setNotes(prev => prev.map((n, i) => i === idx && !n.is_mandatory ? { ...n, is_selected: !n.is_selected } : n));
  };

  const updateNoteContent = (idx: number, content: string) => {
    setNotes(prev => prev.map((n, i) => i === idx ? { ...n, content_user: content } : n));
  };

  const updateSubSection = (idx: number, key: string, field: "enabled" | "text", val: any) => {
    setNotes(prev => prev.map((n, i) => {
      if (i !== idx || !n.sub_sections) return n;
      return { ...n, sub_sections: { ...n.sub_sections, [key]: { ...n.sub_sections[key], [field]: val } } };
    }));
  };

  // AI Suggest applicable notes
  const aiSuggestNotes = async () => {
    setAiSuggestLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("claude-gateway", {
        body: {
          request_type: "notes_drafter",
          user_message: JSON.stringify({
            task: "suggest_applicable_notes",
            entity_type: engagement?.entity_type,
            audit_type: engagement?.audit_type,
            questionnaire: engagement?.questionnaire_answers,
            total_notes: 45,
          }),
        },
      });
      if (error) throw error;
      const reply = data?.reply || data?.content || "";
      // Try parse array of note numbers
      try {
        const match = reply.match(/\[[\d,\s]+\]/);
        if (match) {
          const suggested: number[] = JSON.parse(match[0]);
          setNotes(prev => prev.map(n => ({
            ...n,
            is_selected: n.is_mandatory || suggested.includes(n.note_number) || n.is_selected,
            ai_suggested: suggested.includes(n.note_number),
          })));
          toast.success(`AI suggested ${suggested.length} applicable notes`);
        } else {
          toast.info("AI returned suggestions — review manually");
        }
      } catch { toast.info("AI suggestions received"); }
    } catch (err: any) {
      toast.error("AI suggestion failed: " + (err.message || "Unknown error"));
    }
    setAiSuggestLoading(false);
  };

  // AI Draft for individual note
  const aiDraftNote = async (idx: number) => {
    const note = notes[idx];
    setAiDrafting(note.note_number);
    try {
      const { data, error } = await supabase.functions.invoke("claude-gateway", {
        body: {
          request_type: "notes_drafter",
          user_message: JSON.stringify({
            task: "draft_note",
            note_number: note.note_number,
            note_title: note.note_title,
            entity_type: engagement?.entity_type,
            financial_year: engagement?.financial_year,
            coa_mapping: engagement?.coa_mapping,
          }),
        },
      });
      if (error) throw error;
      const reply = data?.reply || data?.content || "";
      if (reply) {
        setNotes(prev => prev.map((n, i) => i === idx ? { ...n, content_user: reply, ai_suggested: true } : n));
        toast.success(`AI draft for Note ${note.note_number}`);
      }
    } catch {
      toast.error("AI draft failed");
    }
    setAiDrafting(null);
  };

  // Add custom note
  const addCustomNote = () => {
    const maxNum = Math.max(...notes.map(n => n.note_number), 45);
    const newNum = maxNum + 1;
    setNotes(prev => [...prev, {
      note_number: newNum,
      note_title: customForm.title,
      is_selected: true,
      is_mandatory: false,
      note_type: customForm.type,
      content_auto: "",
      content_user: "",
      table_data: null,
      sub_sections: null,
      ai_suggested: false,
      is_locked: false,
      source: "custom",
    }]);
    setShowAddCustom(false);
    setCustomForm({ title: "", insertAfter: 45, type: "narrative" });
    toast.success(`Custom Note ${newNum} added`);
  };

  // Save all notes
  const saveNotes = async (complete: boolean) => {
    setSaving(true);

    // Upsert each selected note
    for (const note of notes) {
      if (!note.is_selected && !note.is_mandatory) continue;

      const payload = {
        engagement_id: engagementId,
        note_number: note.note_number,
        note_title: note.note_title,
        note_content_auto: note.content_auto,
        note_content_user: note.content_user,
        is_selected: note.is_selected,
        is_mandatory: note.is_mandatory,
        note_source: note.source === "custom" ? "custom" : "schedule_iii",
        table_data: note.table_data as unknown as Json,
        note_sub_sections: note.sub_sections as unknown as Json,
        ai_suggested: note.ai_suggested,
        is_locked: note.is_locked,
      };

      const existing = savedNotes?.find((n: any) => n.note_number === note.note_number);
      if (existing) {
        await supabase.from("audit_notes").update(payload as any).eq("id", existing.id);
      } else {
        await supabase.from("audit_notes").insert(payload as any);
      }
    }

    // Update stage status
    const newStatuses = { ...((engagement?.stage_statuses || {}) as Record<string, string>), "7": complete ? "complete" : "in_progress" };
    const stagePayload: Record<string, any> = { stage_statuses: newStatuses as unknown as Json };
    if (complete) stagePayload.pipeline_stage = 8;
    await supabase.from("audit_engagements").update(stagePayload as any).eq("id", engagementId);

    setSaving(false);
    toast.success(complete ? "Stage 7 completed" : "Notes saved");
    refetchNotes();
    if (complete) onStageComplete(); else onSaveDraft();
  };

  const current = notes[selectedIdx];
  const selectedCount = notes.filter(n => n.is_selected).length;

  return (
    <div className="max-w-6xl space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">Stage 7 — Notes to Accounts</h1>
          <p className="text-sm text-muted-foreground">{selectedCount} notes selected out of {notes.length}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={aiSuggestNotes} disabled={aiSuggestLoading} className="gap-1">
            {aiSuggestLoading ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
            AI Suggest Notes
          </Button>
          <Button variant="outline" size="sm" onClick={() => setShowAddCustom(true)} className="gap-1">
            <Plus size={14} /> Custom Note
          </Button>
          <Button variant="outline" size="sm" onClick={() => saveNotes(false)} disabled={saving}>
            {saving && <Loader2 className="w-3 h-3 animate-spin mr-1" />} Save Draft
          </Button>
          <Button size="sm" onClick={() => saveNotes(true)} disabled={saving} className="gap-1">
            Complete Stage 7 <ArrowRight size={14} />
          </Button>
        </div>
      </div>

      {/* Two-panel layout */}
      <div className="flex gap-4 min-h-[600px]">
        {/* Left: Note List */}
        <div className="w-72 shrink-0 border rounded-lg overflow-hidden bg-card">
          <div className="p-2 border-b bg-muted/30">
            <p className="text-xs font-semibold text-muted-foreground uppercase">Notes (1-{Math.max(...notes.map(n => n.note_number), 45)})</p>
          </div>
          <ScrollArea className="h-[560px]">
            {notes.map((n, i) => (
              <button
                key={n.note_number}
                onClick={() => setSelectedIdx(i)}
                className={cn(
                  "w-full text-left px-3 py-2 border-b last:border-b-0 transition-colors text-xs flex items-start gap-2",
                  selectedIdx === i ? "bg-primary/10 border-l-2 border-l-primary" : "hover:bg-muted/50",
                )}
              >
                <Checkbox
                  checked={n.is_selected}
                  disabled={n.is_mandatory}
                  onCheckedChange={() => toggleNote(i)}
                  onClick={e => e.stopPropagation()}
                  className="mt-0.5"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1 mb-0.5">
                    <span className="font-medium text-foreground">Note {n.note_number}</span>
                    {n.is_mandatory && <Badge variant="outline" className="text-[8px] px-1 bg-destructive/10 text-destructive">Required</Badge>}
                    {n.ai_suggested && <Badge variant="outline" className="text-[8px] px-1 bg-purple-500/10 text-purple-600">AI</Badge>}
                    {n.source === "custom" && <Badge variant="outline" className="text-[8px] px-1">Custom</Badge>}
                  </div>
                  <span className="text-muted-foreground leading-tight line-clamp-2">{n.note_title}</span>
                </div>
              </button>
            ))}
          </ScrollArea>
        </div>

        {/* Right: Note Editor */}
        {current && (
          <div className="flex-1 border rounded-lg p-4 space-y-4 bg-card overflow-auto">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-foreground">Note {current.note_number}: {current.note_title}</h3>
                <div className="flex gap-2 mt-1">
                  <Badge variant="outline" className="text-[10px]">{current.note_type}</Badge>
                  {current.content_user && <Badge variant="outline" className="text-[10px] bg-primary/10 text-primary">Has Content</Badge>}
                  {current.ai_suggested && <Badge variant="outline" className="text-[10px] bg-purple-500/10 text-purple-600">AI Generated</Badge>}
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2">
                  <Label className="text-xs">Manual Mode</Label>
                  <Switch checked={manualMode} onCheckedChange={setManualMode} />
                </div>
                <Button size="sm" variant="outline" onClick={() => aiDraftNote(selectedIdx)} disabled={aiDrafting !== null} className="gap-1">
                  {aiDrafting === current.note_number ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                  AI Draft
                </Button>
              </div>
            </div>

            <Separator />

            {/* Note 2 special: sub-sections */}
            {current.note_number === 2 && current.sub_sections ? (
              <Accordion type="multiple" className="space-y-1">
                {POLICY_SUB_SECTIONS.map(ps => {
                  const sub = current.sub_sections![ps.key];
                  if (!sub) return null;
                  return (
                    <AccordionItem key={ps.key} value={ps.key} className="border rounded px-3">
                      <AccordionTrigger className="text-xs font-medium py-2">
                        <div className="flex items-center gap-2">
                          <Switch
                            checked={sub.enabled}
                            onCheckedChange={v => updateSubSection(selectedIdx, ps.key, "enabled", v)}
                            onClick={e => e.stopPropagation()}
                          />
                          <span className={cn(!sub.enabled && "line-through text-muted-foreground")}>{ps.label}</span>
                        </div>
                      </AccordionTrigger>
                      <AccordionContent>
                        {sub.enabled && (
                          <Textarea
                            value={sub.text}
                            onChange={e => updateSubSection(selectedIdx, ps.key, "text", e.target.value)}
                            rows={3}
                            className="text-xs"
                          />
                        )}
                      </AccordionContent>
                    </AccordionItem>
                  );
                })}
              </Accordion>
            ) : (
              /* Standard note editor */
              <div className="space-y-3">
                {/* Template text auto-populates into the textarea directly if no user content */}

                <Textarea
                  value={current.content_user}
                  onChange={e => updateNoteContent(selectedIdx, e.target.value)}
                  rows={16}
                  className="text-sm min-h-[300px]"
                  placeholder={`Draft content for Note ${current.note_number}: ${current.note_title}...`}
                />

                {manualMode && (
                  <div className="flex items-center gap-2 p-2 bg-amber-500/10 rounded border border-amber-300">
                    <AlertTriangle size={14} className="text-amber-600" />
                    <Input
                      value={overrideReason}
                      onChange={e => setOverrideReason(e.target.value)}
                      placeholder="Reason for manual override (required)..."
                      className="h-8 text-xs flex-1"
                    />
                    <Badge className="bg-amber-500/20 text-amber-700 text-[9px]">M</Badge>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Add Custom Note Dialog */}
      <Dialog open={showAddCustom} onOpenChange={setShowAddCustom}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Add Custom Note</DialogTitle></DialogHeader>
          <div className="grid gap-3">
            <div>
              <Label>Note Title *</Label>
              <Input value={customForm.title} onChange={e => setCustomForm(f => ({ ...f, title: e.target.value }))} placeholder="e.g., Revenue Recognition Policy" />
            </div>
            <div>
              <Label>Type</Label>
              <Select value={customForm.type} onValueChange={v => setCustomForm(f => ({ ...f, type: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="narrative">Narrative</SelectItem>
                  <SelectItem value="tabular">Tabular</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddCustom(false)}>Cancel</Button>
            <Button onClick={addCustomNote} disabled={!customForm.title}>Add Note</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
