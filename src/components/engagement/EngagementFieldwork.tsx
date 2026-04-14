import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { toast } from "sonner";
import { ChevronRight, ChevronDown, Plus, Save, Sparkles, Loader2, Upload, FileText, ShieldCheck } from "lucide-react";

interface WorkpaperDef {
  ref: string;
  title: string;
  section: string;
  status: "not_started" | "in_progress" | "signed_off";
}

const SECTIONS = [
  { key: "A", label: "General and Administrative", wps: [
    { ref: "A-1", title: "Engagement Planning Summary" },
    { ref: "A-2", title: "Minutes of Board Meetings Review" },
    { ref: "A-3", title: "Prior Year Issues Follow-up" },
  ]},
  { key: "B", label: "Revenue and Trade Debtors", wps: [
    { ref: "B-1", title: "Revenue Analytical Review" },
    { ref: "B-2", title: "Debtors Confirmation" },
    { ref: "B-3", title: "Bad Debt Review" },
  ]},
  { key: "C", label: "Purchases and Trade Creditors", wps: [
    { ref: "C-1", title: "Purchase Vouching" },
    { ref: "C-2", title: "Creditors Confirmation" },
    { ref: "C-3", title: "Cut-off Testing" },
  ]},
  { key: "D", label: "Fixed Assets and Depreciation", wps: [
    { ref: "D-1", title: "FA Additions and Disposals" },
    { ref: "D-2", title: "Depreciation Recalculation" },
  ]},
  { key: "E", label: "Loans, Borrowings and Interest", wps: [
    { ref: "E-1", title: "Loan Confirmation and Covenant Review" },
    { ref: "E-2", title: "Interest Computation Verification" },
  ]},
  { key: "F", label: "Employee Costs and Compliance", wps: [
    { ref: "F-1", title: "Payroll Analytical Review" },
    { ref: "F-2", title: "PF/ESI Compliance Check" },
    { ref: "F-3", title: "Employee Benefits Provisions" },
  ]},
  { key: "G", label: "Tax Compliance", wps: [
    { ref: "G-1", title: "TDS Compliance Review" },
    { ref: "G-2", title: "GST Reconciliation" },
    { ref: "G-3", title: "Advance Tax Computation" },
  ]},
  { key: "H", label: "Related Party Transactions", wps: [
    { ref: "H-1", title: "RPT Identification and Disclosure" },
    { ref: "H-2", title: "Arm's Length Pricing Review" },
  ]},
  { key: "I", label: "Contingencies and Subsequent Events", wps: [
    { ref: "I-1", title: "Contingent Liabilities Assessment" },
    { ref: "I-2", title: "Subsequent Events Review" },
  ]},
  { key: "J", label: "Management Representations and Review", wps: [
    { ref: "J-1", title: "Management Representation Letter" },
    { ref: "J-2", title: "Overall Analytical Review" },
    { ref: "J-3", title: "Audit Summary Memorandum" },
  ]},
];

interface WPData {
  wp_ref: string;
  section: string;
  objective: string;
  procedure: string;
  findings: { description: string; risk_level: string; mgmt_response: string }[];
  conclusion: string;
  preparer: string;
  reviewer: string;
  signed_by: string | null;
  status: "not_started" | "in_progress" | "signed_off";
}

interface Props {
  engagement: any;
  client: any;
  teamUsers: any[];
  currentUser: any;
  onUpdate: () => void;
}

export function EngagementFieldwork({ engagement, client, teamUsers, currentUser, onUpdate }: Props) {
  const [workpapers, setWorkpapers] = useState<any[]>([]);
  const [selectedWP, setSelectedWP] = useState<string | null>(null);
  const [wpData, setWpData] = useState<WPData | null>(null);
  const [saving, setSaving] = useState(false);
  const [openSections, setOpenSections] = useState<string[]>(["A"]);
  const [customWPs, setCustomWPs] = useState<Record<string, { ref: string; title: string }[]>>({});
  const [aiOpen, setAiOpen] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiText, setAiText] = useState("");

  useEffect(() => {
    fetchWorkpapers();
  }, [engagement.id]);

  async function fetchWorkpapers() {
    const { data } = await supabase
      .from("audit_workpapers")
      .select("*")
      .eq("engagement_id", engagement.id);
    setWorkpapers(data || []);
  }

  function getWPStatus(ref: string): "not_started" | "in_progress" | "signed_off" {
    const wp = workpapers.find(w => w.wp_ref === ref);
    if (!wp) return "not_started";
    if (wp.signed_by) return "signed_off";
    if (wp.objective || wp.procedure || wp.conclusion) return "in_progress";
    return "not_started";
  }

  const statusDot = (s: string) => {
    if (s === "signed_off") return "bg-green-500";
    if (s === "in_progress") return "bg-amber-500";
    return "bg-muted-foreground/30";
  };

  function selectWP(ref: string, section: string, title: string) {
    setSelectedWP(ref);
    const existing = workpapers.find(w => w.wp_ref === ref);
    if (existing) {
      setWpData({
        wp_ref: ref,
        section,
        objective: existing.objective || "",
        procedure: existing.procedure || "",
        findings: [],
        conclusion: existing.conclusion || "",
        preparer: currentUser?.id || "",
        reviewer: "",
        signed_by: existing.signed_by,
        status: getWPStatus(ref),
      });
    } else {
      setWpData({
        wp_ref: ref,
        section,
        objective: "",
        procedure: "",
        findings: [],
        conclusion: "",
        preparer: currentUser?.id || "",
        reviewer: "",
        signed_by: null,
        status: "not_started",
      });
    }
  }

  async function saveWP() {
    if (!wpData) return;
    setSaving(true);
    const existing = workpapers.find(w => w.wp_ref === wpData.wp_ref);
    const payload = {
      engagement_id: engagement.id,
      wp_ref: wpData.wp_ref,
      section: wpData.section,
      objective: wpData.objective,
      procedure: wpData.procedure,
      conclusion: wpData.conclusion,
      signed_by: wpData.signed_by,
    };

    if (existing) {
      await supabase.from("audit_workpapers").update(payload).eq("id", existing.id);
    } else {
      await supabase.from("audit_workpapers").insert(payload);
    }
    setSaving(false);
    toast.success("Workpaper saved");
    fetchWorkpapers();
  }

  async function signOff() {
    if (!wpData) return;
    const userName = currentUser?.name || "Unknown";
    setWpData(prev => prev ? { ...prev, signed_by: `${userName} (${new Date().toISOString().slice(0, 10)})` } : null);
    // Save immediately
    const existing = workpapers.find(w => w.wp_ref === wpData.wp_ref);
    const payload = {
      engagement_id: engagement.id,
      wp_ref: wpData.wp_ref,
      section: wpData.section,
      objective: wpData.objective,
      procedure: wpData.procedure,
      conclusion: wpData.conclusion,
      signed_by: `${userName} (${new Date().toISOString().slice(0, 10)})`,
    };
    if (existing) {
      await supabase.from("audit_workpapers").update(payload).eq("id", existing.id);
    } else {
      await supabase.from("audit_workpapers").insert(payload);
    }
    toast.success("Workpaper signed off");
    fetchWorkpapers();
  }

  async function runAI() {
    if (!wpData) return;
    setAiOpen(true);
    setAiLoading(true);
    setAiText("");

    const { data: findings } = await supabase
      .from("scrutiny_findings")
      .select("rule_id, flag_message, severity, narration")
      .eq("client_id", engagement.client_id)
      .limit(10);

    try {
      const { data, error } = await supabase.functions.invoke("claude-gateway", {
        body: {
          request_type: "workpaper_assistant",
          user_message: JSON.stringify({
            objective: wpData.objective,
            section: wpData.section,
            entity_type: client?.entity_type || "unknown",
            related_scrutiny_findings: findings || [],
          }),
        },
      });
      if (error) throw error;
      setAiText(data?.content || data?.message || JSON.stringify(data));
    } catch (err: any) {
      setAiText("Error: " + (err.message || "Failed"));
    }
    setAiLoading(false);
  }

  function addCustomWP(sectionKey: string) {
    const existing = customWPs[sectionKey] || [];
    const nextNum = existing.length + 4;
    const ref = `${sectionKey}-${nextNum}`;
    setCustomWPs(prev => ({
      ...prev,
      [sectionKey]: [...(prev[sectionKey] || []), { ref, title: `Custom Workpaper ${ref}` }],
    }));
  }

  function toggleSection(key: string) {
    setOpenSections(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]);
  }

  const managers = teamUsers.filter(u => u.role === "manager" || u.role === "partner" || u.role === "firm_admin");

  return (
    <div className="flex gap-0 border rounded-lg overflow-hidden bg-card" style={{ minHeight: 600 }}>
      {/* LEFT: TREE */}
      <div className="w-[30%] min-w-[240px] border-r overflow-y-auto bg-muted/30 p-2">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-2 mb-2">Audit Areas</h3>
        {SECTIONS.map(sec => {
          const isOpen = openSections.includes(sec.key);
          const allWPs = [...sec.wps, ...(customWPs[sec.key] || [])];
          return (
            <div key={sec.key} className="mb-1">
              <button
                onClick={() => toggleSection(sec.key)}
                className="flex items-center gap-1 w-full text-left px-2 py-1.5 rounded text-sm font-medium text-foreground hover:bg-muted transition-colors"
              >
                {isOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                <span className="font-semibold text-xs">{sec.key}</span>
                <span className="text-xs truncate">{sec.label}</span>
              </button>
              {isOpen && (
                <div className="ml-4 space-y-0.5">
                  {allWPs.map(wp => {
                    const st = getWPStatus(wp.ref);
                    const isActive = selectedWP === wp.ref;
                    return (
                      <button
                        key={wp.ref}
                        onClick={() => selectWP(wp.ref, sec.key, wp.title)}
                        className={`flex items-center gap-2 w-full text-left px-2 py-1 rounded text-xs transition-colors ${
                          isActive ? "bg-primary/15 text-primary font-medium" : "hover:bg-muted text-foreground"
                        }`}
                      >
                        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${statusDot(st)}`} />
                        <span className="truncate">{wp.ref} {wp.title}</span>
                      </button>
                    );
                  })}
                  <button
                    onClick={() => addCustomWP(sec.key)}
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary px-2 py-1"
                  >
                    <Plus className="w-3 h-3" /> Add Workpaper
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* RIGHT: EDITOR */}
      <div className="flex-1 overflow-y-auto p-4">
        {!wpData ? (
          <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
            <FileText className="w-8 h-8 mr-2 opacity-30" />
            Select a workpaper from the tree to begin editing
          </div>
        ) : (
          <div className="space-y-4 max-w-3xl">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-foreground">{wpData.wp_ref} — {SECTIONS.find(s => s.key === wpData.section)?.wps.find(w => w.ref === wpData.wp_ref)?.title || "Workpaper"}</h2>
              {wpData.signed_by && (
                <Badge variant="outline" className="bg-green-500/15 text-green-700 border-green-300 text-xs">
                  <ShieldCheck className="w-3 h-3 mr-1" /> Signed Off
                </Badge>
              )}
            </div>

            {/* Objective */}
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Objective</label>
              <Textarea
                rows={2}
                value={wpData.objective}
                onChange={e => setWpData(prev => prev ? { ...prev, objective: e.target.value } : null)}
                placeholder="What is this workpaper testing?"
              />
            </div>

            {/* AI Assist Button */}
            <Button variant="outline" size="sm" onClick={runAI}>
              <Sparkles className="w-4 h-4 mr-1" /> AI Assist
            </Button>

            {/* Procedure */}
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Procedure Performed</label>
              <Textarea
                rows={4}
                value={wpData.procedure}
                onChange={e => setWpData(prev => prev ? { ...prev, procedure: e.target.value } : null)}
                placeholder="Describe what audit procedures were performed..."
              />
            </div>

            {/* Conclusion */}
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Conclusion</label>
              <Select value={wpData.conclusion || ""} onValueChange={v => setWpData(prev => prev ? { ...prev, conclusion: v } : null)}>
                <SelectTrigger><SelectValue placeholder="Select conclusion" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Satisfactory">Satisfactory</SelectItem>
                  <SelectItem value="Unsatisfactory">Unsatisfactory</SelectItem>
                  <SelectItem value="Satisfactory with Comments">Satisfactory with Comments</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Preparer / Reviewer */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Preparer</label>
                <Select value={wpData.preparer} onValueChange={v => setWpData(prev => prev ? { ...prev, preparer: v } : null)}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>
                    {teamUsers.map(u => <SelectItem key={u.id} value={u.id}>{u.name || u.id.slice(0,8)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Reviewer</label>
                <Select value={wpData.reviewer} onValueChange={v => setWpData(prev => prev ? { ...prev, reviewer: v } : null)}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>
                    {managers.map(u => <SelectItem key={u.id} value={u.id}>{u.name || u.id.slice(0,8)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Sign-off info */}
            {wpData.signed_by && (
              <div className="text-xs text-muted-foreground bg-muted/50 rounded p-2">
                Signed off by: {wpData.signed_by}
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-2 pt-2">
              <Button onClick={saveWP} disabled={saving}>
                {saving ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Save className="w-4 h-4 mr-1" />}
                Save
              </Button>
              <Button variant="secondary" onClick={signOff} disabled={!!wpData.signed_by}>
                <ShieldCheck className="w-4 h-4 mr-1" /> Sign Off
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* AI Side Panel */}
      <Sheet open={aiOpen} onOpenChange={setAiOpen}>
        <SheetContent className="w-[420px] sm:max-w-[420px] overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-primary" /> AI Workpaper Assistant
            </SheetTitle>
          </SheetHeader>
          <div className="mt-4 space-y-3">
            {aiLoading ? (
              <div className="flex items-center gap-2 text-muted-foreground text-sm">
                <Loader2 className="w-4 h-4 animate-spin" /> Generating suggestions...
              </div>
            ) : (
              <div className="text-sm whitespace-pre-wrap text-foreground leading-relaxed">{aiText}</div>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
