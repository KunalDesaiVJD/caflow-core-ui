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
import { Save, Loader2, Plus, Trash2, ArrowUp, ArrowDown } from "lucide-react";

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

interface NoteTemplate {
  id?: string;
  note_number: number;
  note_title: string;
  template_content: any;
  is_mandatory?: boolean;
}

const CARO_DEFAULTS: { number: number; title: string }[] = [
  { number: 1, title: "Properties" },
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

// Notes templates matching NotesToAccounts structure exactly
const NOTES_DEFAULTS: { num: number; title: string }[] = [
  { num: 1, title: "Background" },
  { num: 2, title: "Significant Accounting Policies" },
  { num: 29, title: "Construction Contracts" },
  { num: 30, title: "Revenue Recognition" },
  { num: 31, title: "Foreign Currency" },
  { num: 32, title: "Government Grants" },
  { num: 33, title: "Accounting for Investments" },
  { num: 34, title: "Employee Benefits" },
  { num: 35, title: "Borrowing Costs" },
  { num: 36, title: "Segment Reporting" },
  { num: 37, title: "Related Parties" },
  { num: 38, title: "Leases" },
  { num: 39, title: "Earnings per Share" },
  { num: 40, title: "Accounting for Taxes on Income" },
  { num: 41, title: "Discontinuing Operations" },
  { num: 42, title: "Intangible Assets" },
  { num: 43, title: "Impairment of Assets" },
  { num: 44, title: "Events after the Reporting Period" },
  { num: 45, title: "Previous Year Figures" },
];

export function MasterConfigPanel() {
  const [caroTemplates, setCaroTemplates] = useState<CaroTemplate[]>([]);
  const [noteTemplates, setNoteTemplates] = useState<NoteTemplate[]>([]);
  const [threeCDClauses, setThreeCDClauses] = useState<ThreeCDClause[]>([]);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadAll(); }, []);

  async function loadAll() {
    setLoading(true);

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
    // Add any extra saved clauses not in defaults
    caroSaved.forEach(s => {
      if (!caroMerged.find(m => m.clause_number === s.clause_number)) {
        caroMerged.push({
          id: s.id, clause_number: s.clause_number,
          clause_title: s.clause_title, default_content: s.default_content || "",
          is_applicable_default: s.is_applicable_default ?? true,
        });
      }
    });
    caroMerged.sort((a, b) => a.clause_number - b.clause_number);
    setCaroTemplates(caroMerged);

    // Notes templates — merge with defaults
    const notesSaved = (notesRes.data || []) as any[];
    if (notesSaved.length > 0) {
      setNoteTemplates(notesSaved.map((t: any) => ({
        id: t.id,
        note_number: t.note_number,
        note_title: t.note_title,
        template_content: t.template_content || "",
        is_mandatory: t.is_mandatory,
      })));
    } else {
      // Seed from defaults
      setNoteTemplates(NOTES_DEFAULTS.map(d => ({
        note_number: d.num,
        note_title: d.title,
        template_content: "",
      })));
    }

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
    threecdSaved.forEach(s => {
      if (!threecdMerged.find(m => m.clause_number === s.clause_number)) {
        threecdMerged.push({
          id: s.id, clause_number: s.clause_number,
          heading: s.heading, template_content: s.template_content || "",
          is_applicable_default: s.is_applicable_default ?? true,
        });
      }
    });
    threecdMerged.sort((a, b) => parseFloat(a.clause_number) - parseFloat(b.clause_number));
    setThreeCDClauses(threecdMerged);

    setLoading(false);
  }

  // ── CARO handlers ──
  function updateCaro(idx: number, field: keyof CaroTemplate, value: any) {
    setCaroTemplates(prev => prev.map((t, i) => i === idx ? { ...t, [field]: value } : t));
  }
  function addCaroClause() {
    const maxNum = Math.max(0, ...caroTemplates.map(t => t.clause_number));
    setCaroTemplates(prev => [...prev, {
      clause_number: maxNum + 1, clause_title: "New Clause",
      default_content: "", is_applicable_default: true,
    }]);
  }
  function deleteCaroClause(idx: number) {
    const t = caroTemplates[idx];
    if (t.id) {
      if (!window.confirm(`Delete CARO Clause ${t.clause_number} — "${t.clause_title}"? This cannot be undone.`)) return;
    }
    setCaroTemplates(prev => prev.filter((_, i) => i !== idx));
  }
  function moveCaroClause(idx: number, dir: -1 | 1) {
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= caroTemplates.length) return;
    setCaroTemplates(prev => {
      const arr = [...prev];
      [arr[idx], arr[newIdx]] = [arr[newIdx], arr[idx]];
      // Renumber
      return arr.map((t, i) => ({ ...t, clause_number: i + 1 }));
    });
  }

  // ── Notes handlers ──
  function updateNote(idx: number, field: string, value: any) {
    setNoteTemplates(prev => prev.map((t, i) => i === idx ? { ...t, [field]: value } : t));
  }
  function addNoteTemplate() {
    const maxNum = Math.max(0, ...noteTemplates.map(t => t.note_number));
    setNoteTemplates(prev => [...prev, {
      note_number: maxNum + 1, note_title: "New Note",
      template_content: "",
    }]);
  }
  function deleteNoteTemplate(idx: number) {
    const t = noteTemplates[idx];
    if (!window.confirm(`Delete Note ${t.note_number} — "${t.note_title}"?`)) return;
    setNoteTemplates(prev => prev.filter((_, i) => i !== idx));
  }
  function moveNoteTemplate(idx: number, dir: -1 | 1) {
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= noteTemplates.length) return;
    setNoteTemplates(prev => {
      const arr = [...prev];
      [arr[idx], arr[newIdx]] = [arr[newIdx], arr[idx]];
      return arr;
    });
  }

  // ── 3CD handlers ──
  function updateThreeCD(idx: number, field: keyof ThreeCDClause, value: any) {
    setThreeCDClauses(prev => prev.map((t, i) => i === idx ? { ...t, [field]: value } : t));
  }
  function addThreeCDClause() {
    const maxNum = Math.max(0, ...threeCDClauses.map(t => parseFloat(t.clause_number) || 0));
    setThreeCDClauses(prev => [...prev, {
      clause_number: String(Math.floor(maxNum) + 1), heading: "New Clause",
      template_content: "", is_applicable_default: true,
    }]);
  }
  function addThreeCDSubClause(parentIdx: number) {
    const parent = threeCDClauses[parentIdx];
    const parentNum = parent.clause_number;
    // Find existing sub-clauses for this parent
    const existingSubs = threeCDClauses.filter(t =>
      t.clause_number.startsWith(parentNum + '(') || t.clause_number.startsWith(parentNum + '.')
    );
    const nextLetter = String.fromCharCode(97 + existingSubs.length); // a, b, c...
    const newClause: ThreeCDClause = {
      clause_number: `${parentNum}(${nextLetter})`,
      heading: `Sub-clause of ${parentNum}`,
      template_content: "",
      is_applicable_default: true,
    };
    setThreeCDClauses(prev => {
      const arr = [...prev];
      arr.splice(parentIdx + 1 + existingSubs.length, 0, newClause);
      return arr;
    });
  }
  function deleteThreeCDClause(idx: number) {
    const t = threeCDClauses[idx];
    if (!window.confirm(`Delete 3CD Clause ${t.clause_number} — "${t.heading}"?`)) return;
    setThreeCDClauses(prev => prev.filter((_, i) => i !== idx));
  }
  function moveThreeCDClause(idx: number, dir: -1 | 1) {
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= threeCDClauses.length) return;
    setThreeCDClauses(prev => {
      const arr = [...prev];
      [arr[idx], arr[newIdx]] = [arr[newIdx], arr[idx]];
      return arr;
    });
  }

  // ── Save functions ──
  async function saveCaroTemplates() {
    setSaving(true);
    // Delete all existing global CARO templates, then reinsert
    await supabase.from("caro_master_templates").delete().is("firm_id", null);
    const inserts = caroTemplates.map(t => ({
      firm_id: null,
      clause_number: t.clause_number,
      clause_title: t.clause_title,
      default_content: t.default_content,
      is_applicable_default: t.is_applicable_default,
      updated_at: new Date().toISOString(),
    }));
    if (inserts.length > 0) {
      const { error } = await supabase.from("caro_master_templates").insert(inserts);
      if (error) { toast.error(error.message); setSaving(false); return; }
    }
    toast.success("CARO master templates saved (global)");
    setSaving(false);
    loadAll();
  }

  async function saveNoteTemplates() {
    setSaving(true);
    for (const t of noteTemplates) {
      if (t.id) {
        await supabase.from("note_templates" as any).update({
          note_number: t.note_number,
          note_title: t.note_title,
          template_content: t.template_content,
        } as any).eq("id", t.id);
      } else {
        await supabase.from("note_templates" as any).insert({
          note_number: t.note_number,
          note_title: t.note_title,
          template_content: t.template_content || "",
        } as any);
      }
    }
    toast.success("Note templates saved (global)");
    setSaving(false);
    loadAll();
  }

  async function saveThreeCDTemplates() {
    setSaving(true);
    // Delete and reinsert for clean ordering
    const existingIds = threeCDClauses.filter(t => t.id).map(t => t.id!);
    if (existingIds.length > 0) {
      await supabase.from("threecd_master_templates").delete().in("id", existingIds);
    }
    const inserts = threeCDClauses.map(t => ({
      clause_number: t.clause_number,
      heading: t.heading,
      template_content: t.template_content,
      is_applicable_default: t.is_applicable_default,
      updated_at: new Date().toISOString(),
    }));
    if (inserts.length > 0) {
      const { error } = await supabase.from("threecd_master_templates").insert(inserts);
      if (error) { toast.error(error.message); setSaving(false); return; }
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

        {/* ═══ CARO Templates ═══ */}
        <TabsContent value="caro_master" className="mt-4 space-y-4">
          <div className="flex justify-between items-center">
            <Button variant="outline" size="sm" onClick={addCaroClause} className="gap-1">
              <Plus className="w-4 h-4" /> Add Clause
            </Button>
            <Button onClick={saveCaroTemplates} disabled={saving} className="gap-1">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Save CARO Templates
            </Button>
          </div>
          <Accordion type="multiple" className="space-y-2">
            {caroTemplates.map((t, idx) => (
              <AccordionItem key={`caro-${idx}`} value={`caro-${idx}`} className="border rounded-lg">
                <AccordionTrigger className="px-4 py-3 hover:no-underline">
                  <div className="flex items-center gap-3 w-full">
                    <span className="text-sm font-mono font-bold text-primary min-w-[30px]">{t.clause_number}</span>
                    <span className="text-sm font-medium flex-1 text-left">{t.clause_title}</span>
                    {!t.is_applicable_default && <Badge variant="secondary" className="text-[10px]">Default N/A</Badge>}
                    {t.default_content && <Badge className="bg-primary/10 text-primary text-[10px]">Has Content</Badge>}
                  </div>
                </AccordionTrigger>
                <AccordionContent className="px-4 pb-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => moveCaroClause(idx, -1)} disabled={idx === 0}>
                      <ArrowUp className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => moveCaroClause(idx, 1)} disabled={idx === caroTemplates.length - 1}>
                      <ArrowDown className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => deleteCaroClause(idx)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                    <div className="flex-1" />
                    <Switch checked={t.is_applicable_default} onCheckedChange={v => updateCaro(idx, "is_applicable_default", v)} />
                    <Label className="text-xs">Applicable by Default</Label>
                  </div>
                  <div className="grid grid-cols-[80px_1fr] gap-2 items-center">
                    <Label className="text-xs">Number</Label>
                    <Input type="number" value={t.clause_number} onChange={e => updateCaro(idx, "clause_number", parseInt(e.target.value) || 0)} className="w-24 h-8 text-sm" />
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

        {/* ═══ Notes Templates ═══ */}
        <TabsContent value="notes_master" className="mt-4 space-y-4">
          <div className="flex justify-between items-center">
            <Button variant="outline" size="sm" onClick={addNoteTemplate} className="gap-1">
              <Plus className="w-4 h-4" /> Add Note
            </Button>
            <Button onClick={saveNoteTemplates} disabled={saving} className="gap-1">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Save Note Templates
            </Button>
          </div>
          <p className="text-xs text-muted-foreground bg-muted/50 rounded p-2">
            Note numbers and titles here directly control what appears in Notes to Accounts. Reorder or rename to match your statutory structure.
          </p>
          <Accordion type="multiple" className="space-y-2">
            {noteTemplates.map((t, idx) => (
              <AccordionItem key={`note-${idx}`} value={`note-${idx}`} className="border rounded-lg">
                <AccordionTrigger className="px-4 py-3 hover:no-underline">
                  <div className="flex items-center gap-3 w-full">
                    <span className="text-sm font-mono font-bold text-primary min-w-[30px]">{t.note_number}</span>
                    <span className="text-sm font-medium flex-1 text-left">{t.note_title}</span>
                    {t.is_mandatory && <Badge variant="outline" className="text-[10px] bg-destructive/10 text-destructive">Required</Badge>}
                  </div>
                </AccordionTrigger>
                <AccordionContent className="px-4 pb-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => moveNoteTemplate(idx, -1)} disabled={idx === 0}>
                      <ArrowUp className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => moveNoteTemplate(idx, 1)} disabled={idx === noteTemplates.length - 1}>
                      <ArrowDown className="h-3.5 w-3.5" />
                    </Button>
                    {!t.is_mandatory && (
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => deleteNoteTemplate(idx)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                  <div className="grid grid-cols-[100px_1fr] gap-2 items-center">
                    <Label className="text-xs">Note Number</Label>
                    <Input type="number" value={t.note_number} onChange={e => updateNote(idx, "note_number", parseInt(e.target.value) || 0)} className="w-24 h-8 text-sm" />
                  </div>
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
        </TabsContent>

        {/* ═══ 3CD Templates ═══ */}
        <TabsContent value="threecd_master" className="mt-4 space-y-4">
          <div className="flex justify-between items-center">
            <Button variant="outline" size="sm" onClick={addThreeCDClause} className="gap-1">
              <Plus className="w-4 h-4" /> Add Clause
            </Button>
            <Button onClick={saveThreeCDTemplates} disabled={saving} className="gap-1">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Save 3CD Templates
            </Button>
          </div>
          <p className="text-xs text-muted-foreground bg-muted/50 rounded p-2">
            Clause numbers support nested formats like <code>8(a)</code>, <code>8(b)</code>. Edit the clause number field to use any format.
          </p>
          <Accordion type="multiple" className="space-y-2">
            {threeCDClauses.map((t, idx) => (
              <AccordionItem key={`3cd-${idx}`} value={`3cd-${idx}`} className="border rounded-lg">
                <AccordionTrigger className="px-4 py-3 hover:no-underline">
                  <div className="flex items-center gap-3 w-full">
                    <span className="text-sm font-mono font-bold text-primary min-w-[40px]">{t.clause_number}</span>
                    <span className="text-sm font-medium flex-1 text-left">{t.heading}</span>
                    {!t.is_applicable_default && <Badge variant="secondary" className="text-[10px]">Default N/A</Badge>}
                  </div>
                </AccordionTrigger>
                <AccordionContent className="px-4 pb-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => moveThreeCDClause(idx, -1)} disabled={idx === 0}>
                      <ArrowUp className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => moveThreeCDClause(idx, 1)} disabled={idx === threeCDClauses.length - 1}>
                      <ArrowDown className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => deleteThreeCDClause(idx)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                    <div className="flex-1" />
                    <Switch checked={t.is_applicable_default} onCheckedChange={v => updateThreeCD(idx, "is_applicable_default", v)} />
                    <Label className="text-xs">Applicable by Default</Label>
                  </div>
                  <div className="grid grid-cols-[100px_1fr] gap-2 items-center">
                    <Label className="text-xs">Clause Number</Label>
                    <Input value={t.clause_number} onChange={e => updateThreeCD(idx, "clause_number", e.target.value)} className="w-32 h-8 text-sm" placeholder="e.g. 9, 9(a), Clause 9" />
                  </div>
                  <p className="text-[10px] text-muted-foreground">Enter any format: 9, 9(a), Clause 9, C1.9 — fully editable</p>
                  <div>
                    <Label className="text-xs">Clause Heading</Label>
                    <Input value={t.heading} onChange={e => updateThreeCD(idx, "heading", e.target.value)} className="mt-1 text-sm" />
                  </div>
                  <div>
                    <Label className="text-xs">Default Template Content</Label>
                    <Textarea value={t.template_content} onChange={e => updateThreeCD(idx, "template_content", e.target.value)} className="mt-1 text-xs min-h-[100px]" placeholder="Enter default 3CD clause content..." />
                  </div>
                  {/* Add sub-clause button — only for parent-level clauses (no parentheses/dots in number) */}
                  {!/[(.)]/.test(t.clause_number) && (
                    <Button variant="outline" size="sm" onClick={() => addThreeCDSubClause(idx)} className="gap-1 text-xs">
                      <Plus className="w-3 h-3" /> Add Sub-Row under {t.clause_number}
                    </Button>
                  )}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </TabsContent>
      </Tabs>
    </div>
  );
}
