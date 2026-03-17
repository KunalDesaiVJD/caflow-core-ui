import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Save, Loader2 } from "lucide-react";

interface CaroTemplate {
  id?: string;
  clause_number: number;
  clause_title: string;
  default_content: string;
  is_applicable_default: boolean;
}

interface ThreeCDClause {
  id?: string;
  clause_number: string;
  heading: string;
  template_content: string;
  is_applicable_default: boolean;
}

const CARO_DEFAULTS: { number: number; title: string }[] = [
  { number: 1, title: "Immovable Properties" },
  { number: 2, title: "Inventory Physical Verification" },
  { number: 3, title: "Investments/Guarantees/Security" },
  { number: 4, title: "Loans, Advances, Guarantees Compliance (Sec 185/186)" },
  { number: 5, title: "Deposits Compliance" },
  { number: 6, title: "Cost Records" },
  { number: 7, title: "Statutory Dues (TDS/ESI/PF/IT/GST)" },
  { number: 8, title: "Unrecorded Income/Surrendered" },
  { number: 9, title: "Default on Loans/Debentures" },
  { number: 10, title: "IPO/FPO Fund Utilization" },
  { number: 11, title: "Fraud Reported" },
  { number: 12, title: "Nidhi Company Compliance" },
  { number: 13, title: "Related Party Transactions" },
  { number: 14, title: "Internal Audit" },
  { number: 15, title: "Non-Cash Transactions with Directors" },
  { number: 16, title: "RBI Registration if NBFC" },
  { number: 17, title: "Cash Losses" },
  { number: 18, title: "Resignation of Auditors" },
  { number: 19, title: "Going Concern Doubt" },
  { number: 20, title: "CSR Compliance" },
  { number: 21, title: "Qualifications in Group Audit" },
];

const THREECD_DEFAULTS: { clause: string; heading: string }[] = [
  { clause: "8", heading: "Previous audit qualifications and their effect" },
  { clause: "9", heading: "Firm registration number & date" },
  { clause: "10", heading: "Books of account maintained" },
  { clause: "11", heading: "Whether books examined" },
  { clause: "12", heading: "Method of accounting employed" },
  { clause: "13", heading: "Method of valuation of closing stock" },
  { clause: "14", heading: "Capital & Revenue items" },
  { clause: "15", heading: "Land or building transferred below stamp duty value" },
  { clause: "16", heading: "Depreciation allowable" },
  { clause: "17", heading: "Amounts admissible under sections" },
  { clause: "18", heading: "Depreciation details u/s 32" },
  { clause: "19", heading: "Amounts admissible u/s 33AB, 33ABA, 33AC" },
  { clause: "20", heading: "Any sum paid to a research association" },
  { clause: "21", heading: "Deduction u/s 35 & 35D" },
  { clause: "22", heading: "Deduction u/s 36(1)(ii)" },
  { clause: "23", heading: "Bad debts written off u/s 36(1)(vii)" },
  { clause: "24", heading: "Amount of liability u/s 43B (Disallowances)" },
  { clause: "25", heading: "Amount disallowable u/s 40(a)(i/ia/ii)" },
  { clause: "26", heading: "Amount of interest inadmissible u/s 23(1)(d)" },
  { clause: "27", heading: "Amount disallowable u/s 40A(3)" },
  { clause: "28", heading: "Payment to relatives u/s 40A(2)(b)" },
  { clause: "29", heading: "Amounts deemed as profits u/s 32AC, 33AB, 33ABA" },
  { clause: "30", heading: "Primary adjustments to transfer pricing u/s 92CE" },
  { clause: "31", heading: "TDS/TCS Compliance" },
  { clause: "32", heading: "Whether assessee received any capital asset at below FMV u/s 56(2)" },
  { clause: "33", heading: "Whether any income under head IFOS not offered" },
  { clause: "34", heading: "TCS Compliance details" },
  { clause: "35", heading: "Quantitative details of principal items (Inventory)" },
  { clause: "36", heading: "Whether during previous year the assessee has received any property" },
  { clause: "37", heading: "Whether demand raised under Section 201" },
  { clause: "38", heading: "Whether assessee liable to pay interest u/s 234A/B/C" },
  { clause: "39", heading: "Whether assessee converted into/received from LLP" },
  { clause: "40", heading: "Whether assessee received any amount in cash exceeding limits" },
  { clause: "41", heading: "MSME Compliance — amounts due to micro/small enterprises" },
  { clause: "42", heading: "Whether assessee incurred expenditure for CSR u/s 135" },
  { clause: "43", heading: "Details of cryptocurrency/virtual digital assets" },
  { clause: "44", heading: "Break-up of expenditure in Statement of P&L (GST breakup)" },
];

export function MasterConfigPanel() {
  const [caroTemplates, setCaroTemplates] = useState<CaroTemplate[]>([]);
  const [noteTemplates, setNoteTemplates] = useState<any[]>([]);
  const [threeCDClauses, setThreeCDClauses] = useState<ThreeCDClause[]>([]);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadAll(); }, []);

  async function loadAll() {
    setLoading(true);

    // Load GLOBAL templates (firm_id IS NULL for CARO)
    const [caroRes, notesRes, threecdRes] = await Promise.all([
      supabase.from("caro_master_templates").select("*").is("firm_id", null).order("clause_number"),
      supabase.from("note_templates" as any).select("*").order("note_number"),
      supabase.from("threecd_master_templates").select("*").order("clause_number"),
    ]);

    // Merge CARO defaults with saved global templates
    const caroSaved = (caroRes.data || []) as any[];
    const caroMerged = CARO_DEFAULTS.map(d => {
      const existing = caroSaved.find(s => s.clause_number === d.number);
      return {
        id: existing?.id,
        clause_number: d.number,
        clause_title: existing?.clause_title || d.title,
        default_content: existing?.default_content || "",
        is_applicable_default: existing?.is_applicable_default ?? true,
      };
    });
    setCaroTemplates(caroMerged);
    setNoteTemplates(notesRes.data || []);

    // Merge 3CD defaults with saved
    const threecdSaved = (threecdRes.data || []) as any[];
    const threecdMerged = THREECD_DEFAULTS.map(d => {
      const existing = threecdSaved.find(s => s.clause_number === d.clause);
      return {
        id: existing?.id,
        clause_number: d.clause,
        heading: existing?.heading || d.heading,
        template_content: existing?.template_content || "",
        is_applicable_default: existing?.is_applicable_default ?? true,
      };
    });
    setThreeCDClauses(threecdMerged);

    setLoading(false);
  }

  function updateCaro(idx: number, field: keyof CaroTemplate, value: any) {
    setCaroTemplates(prev => prev.map((t, i) => i === idx ? { ...t, [field]: value } : t));
  }

  function updateNote(idx: number, field: string, value: any) {
    setNoteTemplates(prev => prev.map((t, i) => i === idx ? { ...t, [field]: value } : t));
  }

  function updateThreeCD(idx: number, field: keyof ThreeCDClause, value: any) {
    setThreeCDClauses(prev => prev.map((t, i) => i === idx ? { ...t, [field]: value } : t));
  }

  async function saveCaroTemplates() {
    setSaving(true);
    for (const t of caroTemplates) {
      const payload: any = {
        firm_id: null, // GLOBAL
        clause_number: t.clause_number,
        clause_title: t.clause_title,
        default_content: t.default_content,
        is_applicable_default: t.is_applicable_default,
        updated_at: new Date().toISOString(),
      };
      if (t.id) {
        await supabase.from("caro_master_templates").update(payload).eq("id", t.id);
      } else {
        await supabase.from("caro_master_templates").insert(payload);
      }
    }
    toast.success("CARO master templates saved (global)");
    setSaving(false);
    loadAll();
  }

  async function saveNoteTemplates() {
    setSaving(true);
    for (const t of noteTemplates) {
      await supabase.from("note_templates" as any).update({
        note_title: t.note_title,
        template_content: t.template_content,
      } as any).eq("id", t.id);
    }
    toast.success("Note templates saved (global)");
    setSaving(false);
  }

  async function saveThreeCDTemplates() {
    setSaving(true);
    for (const t of threeCDClauses) {
      const payload: any = {
        clause_number: t.clause_number,
        heading: t.heading,
        template_content: t.template_content,
        is_applicable_default: t.is_applicable_default,
        updated_at: new Date().toISOString(),
      };
      if (t.id) {
        await supabase.from("threecd_master_templates").update(payload).eq("id", t.id);
      } else {
        await supabase.from("threecd_master_templates").insert(payload);
      }
    }
    toast.success("3CD master templates saved (global)");
    setSaving(false);
    loadAll();
  }

  if (loading) return <div className="py-8 text-center text-muted-foreground">Loading master configuration...</div>;

  return (
    <div className="max-w-5xl space-y-4">
      <h2 className="text-lg font-semibold text-foreground">Master Configuration</h2>
      <p className="text-sm text-muted-foreground">
        Global templates — changes here apply as defaults for <strong>all firms and all future engagements</strong>. Existing engagements retain their saved content.
      </p>

      <Tabs defaultValue="caro_master">
        <TabsList>
          <TabsTrigger value="caro_master">CARO Templates</TabsTrigger>
          <TabsTrigger value="notes_master">Notes Templates</TabsTrigger>
          <TabsTrigger value="threecd_master">3CD Templates</TabsTrigger>
        </TabsList>

        {/* CARO Templates */}
        <TabsContent value="caro_master" className="mt-4 space-y-4">
          <div className="flex justify-end">
            <Button onClick={saveCaroTemplates} disabled={saving} className="gap-1">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Save CARO Templates
            </Button>
          </div>
          <Accordion type="multiple" className="space-y-2">
            {caroTemplates.map((t, idx) => (
              <AccordionItem key={t.clause_number} value={`caro-${t.clause_number}`} className="border rounded-lg">
                <AccordionTrigger className="px-4 py-3 hover:no-underline">
                  <div className="flex items-center gap-3 w-full">
                    <span className="text-sm font-mono font-bold text-primary min-w-[30px]">{t.clause_number}</span>
                    <span className="text-sm font-medium flex-1 text-left">{t.clause_title}</span>
                    {!t.is_applicable_default && <Badge variant="secondary" className="text-[10px]">Default N/A</Badge>}
                    {t.default_content && <Badge className="bg-primary/10 text-primary text-[10px]">Has Content</Badge>}
                  </div>
                </AccordionTrigger>
                <AccordionContent className="px-4 pb-4 space-y-3">
                  <div className="flex items-center gap-3">
                    <Switch checked={t.is_applicable_default} onCheckedChange={v => updateCaro(idx, "is_applicable_default", v)} />
                    <Label className="text-xs">Applicable by Default</Label>
                  </div>
                  <div>
                    <Label className="text-xs">Clause Title</Label>
                    <Input value={t.clause_title} onChange={e => updateCaro(idx, "clause_title", e.target.value)} className="mt-1 text-sm" />
                  </div>
                  <div>
                    <Label className="text-xs">Default Content</Label>
                    <Textarea value={t.default_content} onChange={e => updateCaro(idx, "default_content", e.target.value)} className="mt-1 text-xs min-h-[100px]" placeholder="Enter default CARO response..." />
                  </div>
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </TabsContent>

        {/* Notes Templates */}
        <TabsContent value="notes_master" className="mt-4 space-y-4">
          <div className="flex justify-end">
            <Button onClick={saveNoteTemplates} disabled={saving} className="gap-1">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Save Note Templates
            </Button>
          </div>
          {noteTemplates.length === 0 ? (
            <Card><CardContent className="p-8 text-center text-muted-foreground">No note templates found. Templates are seeded from the system.</CardContent></Card>
          ) : (
            <Accordion type="multiple" className="space-y-2">
              {noteTemplates.map((t: any, idx: number) => (
                <AccordionItem key={t.id} value={`note-${t.note_number}`} className="border rounded-lg">
                  <AccordionTrigger className="px-4 py-3 hover:no-underline">
                    <div className="flex items-center gap-3 w-full">
                      <span className="text-sm font-mono font-bold text-primary min-w-[30px]">{t.note_number}</span>
                      <span className="text-sm font-medium flex-1 text-left">{t.note_title}</span>
                      {t.is_mandatory && <Badge variant="outline" className="text-[10px] bg-destructive/10 text-destructive">Required</Badge>}
                    </div>
                  </AccordionTrigger>
                  <AccordionContent className="px-4 pb-4 space-y-3">
                    <div>
                      <Label className="text-xs">Note Title</Label>
                      <Input value={t.note_title || ""} onChange={e => updateNote(idx, "note_title", e.target.value)} className="mt-1 text-sm" />
                    </div>
                    <div>
                      <Label className="text-xs">Default Template Text</Label>
                      <Textarea
                        value={typeof t.template_content === "object" ? (t.template_content?.default_text || "") : (t.template_content || "")}
                        onChange={e => updateNote(idx, "template_content", { ...(typeof t.template_content === "object" ? t.template_content : {}), default_text: e.target.value })}
                        className="mt-1 text-xs min-h-[80px]"
                        placeholder="Default content for this note..."
                      />
                    </div>
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          )}
        </TabsContent>

        {/* 3CD Templates */}
        <TabsContent value="threecd_master" className="mt-4 space-y-4">
          <div className="flex justify-end">
            <Button onClick={saveThreeCDTemplates} disabled={saving} className="gap-1">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Save 3CD Templates
            </Button>
          </div>
          <Accordion type="multiple" className="space-y-2">
            {threeCDClauses.map((t, idx) => (
              <AccordionItem key={t.clause_number} value={`3cd-${t.clause_number}`} className="border rounded-lg">
                <AccordionTrigger className="px-4 py-3 hover:no-underline">
                  <div className="flex items-center gap-3 w-full">
                    <span className="text-sm font-mono font-bold text-primary min-w-[40px]">Cl {t.clause_number}</span>
                    <span className="text-sm font-medium flex-1 text-left">{t.heading}</span>
                    {!t.is_applicable_default && <Badge variant="secondary" className="text-[10px]">Default N/A</Badge>}
                  </div>
                </AccordionTrigger>
                <AccordionContent className="px-4 pb-4 space-y-3">
                  <div className="flex items-center gap-3">
                    <Switch checked={t.is_applicable_default} onCheckedChange={v => updateThreeCD(idx, "is_applicable_default", v)} />
                    <Label className="text-xs">Applicable by Default</Label>
                  </div>
                  <div>
                    <Label className="text-xs">Clause Heading</Label>
                    <Input value={t.heading} onChange={e => updateThreeCD(idx, "heading", e.target.value)} className="mt-1 text-sm" />
                  </div>
                  <div>
                    <Label className="text-xs">Default Template Content</Label>
                    <Textarea value={t.template_content} onChange={e => updateThreeCD(idx, "template_content", e.target.value)} className="mt-1 text-xs min-h-[100px]" placeholder="Enter default 3CD clause content..." />
                  </div>
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </TabsContent>
      </Tabs>
    </div>
  );
}
