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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  Shield, FileText, Upload, Plus, ArrowRight, Loader2, Save,
  Sparkles, Check, Download, ClipboardCheck, AlertTriangle, Trash2
} from "lucide-react";
import { Json } from "@/integrations/supabase/types";

interface PipelineStage6Props {
  engagementId: string;
  engagement: any;
  onStageComplete: () => void;
  onSaveDraft: () => void;
}

// ─── Risk Assessment ───
const RISK_AREAS = [
  "Revenue", "Fixed Assets", "Debtors", "Creditors", "Loans",
  "Inventory", "Payroll", "Taxes", "Related Parties", "Cash"
];

const RISK_LEVELS = ["High", "Medium", "Low"] as const;

interface RiskRow {
  area: string;
  inherent: string;
  control: string;
  detection: string;
  overall: string;
  notes: string;
  autoSuggested?: boolean;
}

function computeDetection(inherent: string, control: string): string {
  if (inherent === "High" && control === "High") return "Low";
  if (inherent === "High" || control === "High") return "Low";
  if (inherent === "Medium" && control === "Medium") return "Medium";
  return "High";
}

function computeOverall(inherent: string, control: string): string {
  if (inherent === "High" && control === "High") return "High";
  if (inherent === "High" || control === "High") return "High";
  if (inherent === "Medium" || control === "Medium") return "Medium";
  return "Low";
}

const RISK_COLORS: Record<string, string> = {
  High: "bg-destructive/15 text-destructive border-destructive/30",
  Medium: "bg-amber-500/15 text-amber-700 border-amber-300",
  Low: "bg-green-500/15 text-green-700 border-green-300",
};

// Map scrutiny categories to risk areas
const CATEGORY_TO_AREA: Record<string, string> = {
  SALES: "Revenue", FA: "Fixed Assets", DEBT: "Debtors", CRED: "Creditors",
  LOAN: "Loans", INV: "Inventory", PAY: "Payroll", TDS: "Taxes",
  RPT: "Related Parties", CASH: "Cash", BKR: "Cash",
};

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

// ─── Physical Verification ───
interface PhysicalVerification {
  category: string;
  date: string;
  items_verified: number;
  discrepancies: string;
  action_taken: string;
}

export default function PipelineStage6({ engagementId, engagement, onStageComplete, onSaveDraft }: PipelineStage6Props) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState("risk");
  const [saving, setSaving] = useState(false);

  // ─── RISK ASSESSMENT STATE ───
  const [riskRows, setRiskRows] = useState<RiskRow[]>(() =>
    RISK_AREAS.map(a => ({ area: a, inherent: "Medium", control: "Medium", detection: "Medium", overall: "Medium", notes: "" }))
  );
  const [aiOpen, setAiOpen] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);

  // Load saved risk assessment
  useEffect(() => {
    if (engagement?.risk_assessment && Array.isArray(engagement.risk_assessment)) {
      const saved = engagement.risk_assessment as any[];
      setRiskRows(RISK_AREAS.map(area => {
        const s = saved.find((r: any) => r.area === area);
        if (s) {
          const inh = s.inherent === 3 ? "High" : s.inherent === 2 ? "Medium" : s.inherent === 1 ? "Low" : (s.inherent || "Medium");
          const ctl = s.control === 3 ? "High" : s.control === 2 ? "Medium" : s.control === 1 ? "Low" : (s.control || "Medium");
          return { area, inherent: inh, control: ctl, detection: computeDetection(inh, ctl), overall: computeOverall(inh, ctl), notes: s.notes || "" };
        }
        return { area, inherent: "Medium", control: "Medium", detection: "Medium", overall: "Medium", notes: "" };
      }));
    }
  }, [engagement?.id]);

  // Fetch scrutiny findings to auto-suggest risk levels
  const { data: scrutinyFindings } = useQuery({
    queryKey: ["scrutiny-findings-for-risk", engagementId],
    queryFn: async () => {
      const { data } = await supabase
        .from("scrutiny_findings" as any)
        .select("rule_id, severity, category")
        .eq("engagement_id", engagementId);
      return (data || []) as any[];
    },
    enabled: !!engagementId,
  });

  // Auto-suggest based on scrutiny findings
  const autoSuggestRisk = useCallback(() => {
    if (!scrutinyFindings?.length) { toast.info("No scrutiny findings to base suggestions on"); return; }

    const categoryCounts: Record<string, { high: number; medium: number; low: number }> = {};
    scrutinyFindings.forEach((f: any) => {
      const cat = f.category || f.rule_id?.split("-")[0];
      if (!cat) return;
      const area = CATEGORY_TO_AREA[cat];
      if (!area) return;
      if (!categoryCounts[area]) categoryCounts[area] = { high: 0, medium: 0, low: 0 };
      const sev = (f.severity || "medium").toLowerCase();
      if (sev === "high") categoryCounts[area].high++;
      else if (sev === "medium") categoryCounts[area].medium++;
      else categoryCounts[area].low++;
    });

    setRiskRows(prev => prev.map(row => {
      const counts = categoryCounts[row.area];
      if (!counts) return row;
      let inherent: string = row.inherent;
      if (counts.high >= 2) inherent = "High";
      else if (counts.high >= 1 || counts.medium >= 3) inherent = "High";
      else if (counts.medium >= 1) inherent = "Medium";
      const detection = computeDetection(inherent, row.control);
      const overall = computeOverall(inherent, row.control);
      return { ...row, inherent, detection, overall, autoSuggested: true };
    }));
    toast.success("Risk levels auto-suggested from scrutiny findings");
  }, [scrutinyFindings]);

  const updateRisk = (idx: number, field: keyof RiskRow, val: string) => {
    setRiskRows(prev => prev.map((r, i) => {
      if (i !== idx) return r;
      const updated = { ...r, [field]: val };
      updated.detection = computeDetection(updated.inherent, updated.control);
      updated.overall = computeOverall(updated.inherent, updated.control);
      return updated;
    }));
  };

  // ─── WORKPAPERS STATE ───
  const { data: workpapers, refetch: refetchWP } = useQuery({
    queryKey: ["workpapers", engagementId],
    queryFn: async () => {
      const { data } = await supabase
        .from("audit_workpapers")
        .select("*")
        .eq("engagement_id", engagementId)
        .order("wp_ref");
      return (data || []) as Workpaper[];
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

  // ─── PHYSICAL VERIFICATION STATE ───
  const [verifications, setVerifications] = useState<PhysicalVerification[]>([
    { category: "Plant & Machinery", date: "", items_verified: 0, discrepancies: "", action_taken: "" },
    { category: "Furniture & Fixtures", date: "", items_verified: 0, discrepancies: "", action_taken: "" },
    { category: "Vehicles", date: "", items_verified: 0, discrepancies: "", action_taken: "" },
    { category: "Office Equipment", date: "", items_verified: 0, discrepancies: "", action_taken: "" },
    { category: "Computer Equipment", date: "", items_verified: 0, discrepancies: "", action_taken: "" },
  ]);

  // Load saved verifications from engagement
  useEffect(() => {
    const saved = (engagement as any)?.materiality as any;
    if (saved?.physical_verifications && Array.isArray(saved.physical_verifications)) {
      setVerifications(saved.physical_verifications);
    }
  }, [engagement?.id]);

  const updateVerification = (idx: number, field: keyof PhysicalVerification, val: any) => {
    setVerifications(prev => prev.map((v, i) => i === idx ? { ...v, [field]: val } : v));
  };

  // ─── SAVE ALL ───
  const saveAll = async (complete: boolean) => {
    setSaving(true);
    const riskData = riskRows.map(r => ({
      area: r.area,
      inherent: r.inherent === "High" ? 3 : r.inherent === "Medium" ? 2 : 1,
      control: r.control === "High" ? 3 : r.control === "Medium" ? 2 : 1,
      notes: r.notes,
    }));

    const matData = {
      ...(engagement?.materiality || {}),
      physical_verifications: verifications,
    };

    const newStatuses = { ...((engagement?.stage_statuses || {}) as Record<string, string>), "6": complete ? "complete" : "in_progress" };
    const payload: Record<string, any> = {
      risk_assessment: riskData as unknown as Json,
      materiality: matData as unknown as Json,
      stage_statuses: newStatuses as unknown as Json,
    };
    if (complete) payload.pipeline_stage = 7;

    const { error } = await supabase.from("audit_engagements").update(payload as any).eq("id", engagementId);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success(complete ? "Stage 6 completed" : "Progress saved");
    if (complete) onStageComplete(); else onSaveDraft();
  };

  return (
    <div className="max-w-6xl space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">Stage 6 — Workpapers & Risk Assessment</h1>
          <p className="text-sm text-muted-foreground">Risk matrix, workpaper index, and physical verification</p>
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
          <TabsTrigger value="risk" className="gap-1"><Shield size={14} /> Risk Assessment</TabsTrigger>
          <TabsTrigger value="workpapers" className="gap-1"><FileText size={14} /> Workpapers</TabsTrigger>
          <TabsTrigger value="physical" className="gap-1"><ClipboardCheck size={14} /> Physical Verification</TabsTrigger>
        </TabsList>

        {/* ═══ RISK ASSESSMENT ═══ */}
        <TabsContent value="risk" className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">Assess risk for each audit area. Auto-suggestions based on scrutiny findings.</p>
            <Button variant="outline" size="sm" onClick={autoSuggestRisk} className="gap-1">
              <Sparkles size={14} /> Auto-Suggest from Scrutiny
            </Button>
          </div>

          <div className="border rounded-lg overflow-auto bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[160px]">Audit Area</TableHead>
                  <TableHead className="w-[120px]">Inherent Risk</TableHead>
                  <TableHead className="w-[120px]">Control Risk</TableHead>
                  <TableHead className="w-[100px]">Detection Risk</TableHead>
                  <TableHead className="w-[100px]">Overall Risk</TableHead>
                  <TableHead>Notes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {riskRows.map((row, i) => (
                  <TableRow key={row.area}>
                    <TableCell className="font-medium text-sm">
                      {row.area}
                      {row.autoSuggested && <Badge variant="outline" className="ml-1 text-[9px] px-1">AI</Badge>}
                    </TableCell>
                    <TableCell>
                      <Select value={row.inherent} onValueChange={v => updateRisk(i, "inherent", v)}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {RISK_LEVELS.map(l => <SelectItem key={l} value={l}>{l}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Select value={row.control} onValueChange={v => updateRisk(i, "control", v)}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {RISK_LEVELS.map(l => <SelectItem key={l} value={l}>{l}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={cn("text-xs", RISK_COLORS[row.detection])}>{row.detection}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={cn("text-xs", RISK_COLORS[row.overall])}>{row.overall}</Badge>
                    </TableCell>
                    <TableCell>
                      <Input
                        className="h-8 text-xs"
                        value={row.notes}
                        onChange={e => updateRisk(i, "notes", e.target.value)}
                        placeholder="Optional notes..."
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
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
                      {RISK_AREAS.map(a => <SelectItem key={a} value={a}>{a}</SelectItem>)}
                      <SelectItem value="General">General</SelectItem>
                      <SelectItem value="Other">Other</SelectItem>
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

        {/* ═══ PHYSICAL VERIFICATION ═══ */}
        <TabsContent value="physical" className="space-y-4">
          <p className="text-sm text-muted-foreground">Physical verification checklist for asset categories</p>

          <div className="border rounded-lg overflow-auto bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[180px]">Asset Category</TableHead>
                  <TableHead className="w-[140px]">Date of Verification</TableHead>
                  <TableHead className="w-[100px]">Items Verified</TableHead>
                  <TableHead>Discrepancies Found</TableHead>
                  <TableHead>Action Taken</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {verifications.map((v, i) => (
                  <TableRow key={i}>
                    <TableCell className="font-medium text-sm">{v.category}</TableCell>
                    <TableCell>
                      <Input type="date" className="h-8 text-xs" value={v.date} onChange={e => updateVerification(i, "date", e.target.value)} />
                    </TableCell>
                    <TableCell>
                      <Input type="number" className="h-8 text-xs w-20" value={v.items_verified || ""} onChange={e => updateVerification(i, "items_verified", parseInt(e.target.value) || 0)} />
                    </TableCell>
                    <TableCell>
                      <Input className="h-8 text-xs" value={v.discrepancies} onChange={e => updateVerification(i, "discrepancies", e.target.value)} placeholder="None / describe..." />
                    </TableCell>
                    <TableCell>
                      <Input className="h-8 text-xs" value={v.action_taken} onChange={e => updateVerification(i, "action_taken", e.target.value)} placeholder="Action taken..." />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <Button variant="outline" size="sm" onClick={() => setVerifications(prev => [...prev, { category: "", date: "", items_verified: 0, discrepancies: "", action_taken: "" }])}>
            <Plus size={14} className="mr-1" /> Add Category
          </Button>
        </TabsContent>
      </Tabs>
    </div>
  );
}
