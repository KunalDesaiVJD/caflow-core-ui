import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { CheckCircle2, ChevronLeft, ChevronRight, ClipboardCheck, Building2, Briefcase, BarChart3, AlertCircle } from "lucide-react";
import { toast } from "sonner";

/* ─── Types ─── */
type Answers = {
  entity_type: string;
  statutory_audit: string;
  tax_audit_44ab: string;
  financial_year: string;
  prior_data_available: string;
  has_inventory: string;
  has_fixed_assets: string;
  related_party_txns: string;
  has_loans: string;
  cash_txns_above_10k: string;
  gst_registered: string;
  tds_deductor: string;
  turnover_range: string;
  has_bank_loans: string;
  prior_exceptional_items: string;
};

const DEFAULT_ANSWERS: Answers = {
  entity_type: "",
  statutory_audit: "",
  tax_audit_44ab: "",
  financial_year: "2024-25",
  prior_data_available: "",
  has_inventory: "",
  has_fixed_assets: "",
  related_party_txns: "",
  has_loans: "",
  cash_txns_above_10k: "",
  gst_registered: "",
  tds_deductor: "",
  turnover_range: "",
  has_bank_loans: "",
  prior_exceptional_items: "",
};

const ENTITY_TYPES = [
  "Private Ltd", "Public Ltd", "LLP", "Partnership Firm",
  "Proprietorship", "Trust", "AOP", "HUF",
];

const FY_OPTIONS = ["2024-25", "2023-24", "2022-23", "2021-22"];

const TURNOVER_RANGES = [
  { value: "below_40l", label: "< ₹40 Lakhs" },
  { value: "40l_1cr", label: "₹40L – ₹1 Cr" },
  { value: "1cr_10cr", label: "₹1 Cr – ₹10 Cr" },
  { value: "10cr_100cr", label: "₹10 Cr – ₹100 Cr" },
  { value: "above_100cr", label: "> ₹100 Cr" },
];

const STEPS = [
  { label: "Entity & Year", icon: Building2 },
  { label: "Business Ops", icon: Briefcase },
  { label: "Financial Profile", icon: BarChart3 },
  { label: "Review & Confirm", icon: ClipboardCheck },
];

/* ─── Helpers ─── */
function YesNoQuestion({ label, value, onChange, hint }: { label: string; value: string; onChange: (v: string) => void; hint?: string }) {
  return (
    <div className="space-y-2">
      <Label className="text-sm font-medium">{label}</Label>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      <RadioGroup value={value} onValueChange={onChange} className="flex gap-6">
        <div className="flex items-center gap-2">
          <RadioGroupItem value="yes" id={`${label}-yes`} />
          <Label htmlFor={`${label}-yes`} className="cursor-pointer">Yes</Label>
        </div>
        <div className="flex items-center gap-2">
          <RadioGroupItem value="no" id={`${label}-no`} />
          <Label htmlFor={`${label}-no`} className="cursor-pointer">No</Label>
        </div>
      </RadioGroup>
    </div>
  );
}

function calculateActiveTabs(a: Answers) {
  const tabs: Record<string, boolean> = {
    tb_import: true,
    scrutiny: true,
    engagements: true,
    narration_ai: true,
    coa_mapping: true,
    comparative: true,
  };

  // CARO: Private/Public Ltd AND turnover >= 1Cr
  const isCompany = a.entity_type === "Private Ltd" || a.entity_type === "Public Ltd";
  const turnoverAbove1Cr = ["1cr_10cr", "10cr_100cr", "above_100cr"].includes(a.turnover_range);
  tabs.caro = isCompany && turnoverAbove1Cr;

  // 3CD: tax audit required
  tabs.form_3cd = a.tax_audit_44ab === "yes";

  // Cash flow statement: companies
  tabs.cash_flow = isCompany;

  // Inventory checks
  tabs.inventory_checks = a.has_inventory === "yes";

  // Depreciation checks (D01-D06)
  tabs.depreciation_checks = a.has_fixed_assets === "yes";

  // Related party: CARO 3(xiii), 3CD clause 23
  tabs.related_party = a.related_party_txns === "yes";

  // Loans: CARO 3(iv), C08
  tabs.loan_checks = a.has_loans === "yes";

  // Cash checks (C01-C04)
  tabs.cash_checks = a.cash_txns_above_10k === "yes";

  // Notes to accounts always on for companies
  tabs.notes_to_accounts = isCompany;

  return tabs;
}

/* ─── Main Component ─── */
export default function AuditPreliminary() {
  const { clientId } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Answers>({ ...DEFAULT_ANSWERS });
  const [clientName, setClientName] = useState("");
  const [engagementId, setEngagementId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [slideDir, setSlideDir] = useState<"left" | "right">("right");
  const [animKey, setAnimKey] = useState(0);

  // Load client + engagement
  useEffect(() => {
    if (!clientId) return;
    const load = async () => {
      const [clientRes, engRes] = await Promise.all([
        supabase.from("clients").select("name").eq("id", clientId).single(),
        supabase.from("audit_engagements").select("id, preliminary_complete, active_tabs, financial_year")
          .eq("client_id", clientId).order("financial_year", { ascending: false }).limit(1),
      ]);
      if (clientRes.data) setClientName(clientRes.data.name || "");
      if (engRes.data && engRes.data.length > 0) {
        const eng = engRes.data[0];
        setEngagementId(eng.id);
        if (eng.preliminary_complete) setCompleted(true);
        if (eng.financial_year) setAnswers(a => ({ ...a, financial_year: eng.financial_year! }));

        // Load existing answers
        const { data: existing } = await (supabase as any)
          .from("audit_preliminary_answers")
          .select("answers")
          .eq("engagement_id", eng.id)
          .single();
        if (existing?.answers) {
          setAnswers(prev => ({ ...prev, ...existing.answers }));
        }
      }
    };
    load();
  }, [clientId]);

  const set = (key: keyof Answers, val: string) => setAnswers(a => ({ ...a, [key]: val }));

  const goNext = () => {
    setSlideDir("right");
    setAnimKey(k => k + 1);
    setStep(s => Math.min(s + 1, 3));
  };
  const goPrev = () => {
    setSlideDir("left");
    setAnimKey(k => k + 1);
    setStep(s => Math.max(s - 1, 0));
  };

  const activeTabs = calculateActiveTabs(answers);
  const activatedCount = Object.values(activeTabs).filter(Boolean).length;

  const handleConfirm = async () => {
    if (!engagementId || !user?.firm_id) {
      toast.error("No engagement found for this client.");
      return;
    }
    setSaving(true);

    // Upsert answers
    const { error: ansErr } = await supabase.from("audit_preliminary_answers" as any).upsert({
      engagement_id: engagementId,
      client_id: clientId,
      firm_id: user.firm_id,
      answers: answers as any,
      activated_tabs: activeTabs as any,
      updated_at: new Date().toISOString(),
    } as any, { onConflict: "engagement_id" });

    if (ansErr) {
      toast.error("Failed to save answers");
      setSaving(false);
      return;
    }

    // Update engagement
    const { error: engErr } = await supabase.from("audit_engagements").update({
      preliminary_complete: true,
      active_tabs: activeTabs as any,
      entity_type_logic: answers.entity_type,
    }).eq("id", engagementId);

    if (engErr) {
      toast.error("Failed to update engagement");
      setSaving(false);
      return;
    }

    setSaving(false);
    setCompleted(true);
    toast.success(`Preliminary questionnaire complete. ${activatedCount} audit sections activated.`);
  };

  // Step validation
  const step1Valid = answers.entity_type && answers.statutory_audit && answers.tax_audit_44ab && answers.financial_year && answers.prior_data_available;
  const step2Valid = answers.has_inventory && answers.has_fixed_assets && answers.related_party_txns && answers.has_loans && answers.cash_txns_above_10k;
  const step3Valid = answers.gst_registered && answers.tds_deductor && answers.turnover_range && answers.has_bank_loans && answers.prior_exceptional_items;
  const canProceed = [step1Valid, step2Valid, step3Valid, true][step];

  if (!clientId) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-display font-bold text-foreground">Preliminary Questions</h1>
        <Card className="p-8 text-center text-muted-foreground">
          <AlertCircle className="mx-auto h-8 w-8 mb-2" />
          <p>Select a client from the Audit Intelligence page to begin the preliminary questionnaire.</p>
          <Button variant="outline" className="mt-4" onClick={() => navigate("/audit")}>Go to Engagements</Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-display font-bold text-foreground">
          Preliminary Questionnaire — {clientName || "Loading…"} — FY {answers.financial_year}
        </h1>
        <p className="text-sm text-muted-foreground">Complete this before any audit work begins</p>
      </div>

      {/* Success banner */}
      {completed && (
        <div className="rounded-lg border border-green-500/30 bg-green-500/10 p-4 flex items-center gap-3 animate-fade-in">
          <CheckCircle2 className="h-5 w-5 text-green-600 shrink-0" />
          <div>
            <p className="text-sm font-medium text-green-700">Preliminary questionnaire complete. {activatedCount} audit sections activated.</p>
            <p className="text-xs text-green-600 mt-0.5">You can update answers at any time — tabs will recalculate automatically.</p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Left — Stepper */}
        <div className="lg:col-span-1">
          <Card className="p-4 space-y-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Progress</p>
            <Progress value={((step + 1) / 4) * 100} className="h-1.5 mb-4" />
            {STEPS.map((s, i) => {
              const Icon = s.icon;
              const done = i < step || completed;
              const active = i === step;
              return (
                <button
                  key={i}
                  onClick={() => { setSlideDir(i > step ? "right" : "left"); setAnimKey(k => k + 1); setStep(i); }}
                  className={cn(
                    "w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-left transition-colors text-sm",
                    active && "bg-primary/10 text-primary font-semibold",
                    done && !active && "text-green-600",
                    !active && !done && "text-muted-foreground hover:bg-muted"
                  )}
                >
                  <div className={cn(
                    "w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0",
                    active && "bg-primary text-primary-foreground",
                    done && !active && "bg-green-500 text-white",
                    !active && !done && "bg-muted text-muted-foreground"
                  )}>
                    {done && !active ? <CheckCircle2 size={14} /> : i + 1}
                  </div>
                  <span>{s.label}</span>
                </button>
              );
            })}
          </Card>
        </div>

        {/* Right — Questions */}
        <div className="lg:col-span-3">
          <Card className="p-6 min-h-[420px] relative overflow-hidden">
            <div
              key={animKey}
              className={cn(
                "space-y-6",
                slideDir === "right" ? "animate-fade-in" : "animate-fade-in"
              )}
            >
              {step === 0 && (
                <>
                  <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
                    <Building2 size={20} /> Step 1: Entity & Year Info
                  </h2>
                  <div className="space-y-5">
                    <div className="space-y-2">
                      <Label>Q1. Entity Type</Label>
                      <Select value={answers.entity_type} onValueChange={v => set("entity_type", v)}>
                        <SelectTrigger><SelectValue placeholder="Select entity type" /></SelectTrigger>
                        <SelectContent>
                          {ENTITY_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <YesNoQuestion
                      label="Q2. Does this entity require statutory audit?"
                      value={answers.statutory_audit}
                      onChange={v => set("statutory_audit", v)}
                    />
                    <YesNoQuestion
                      label="Q3. Is the entity subject to Tax Audit u/s 44AB?"
                      value={answers.tax_audit_44ab}
                      onChange={v => set("tax_audit_44ab", v)}
                      hint="Activates Form 3CD generation"
                    />
                    <div className="space-y-2">
                      <Label>Q4. Financial Year being audited</Label>
                      <Select value={answers.financial_year} onValueChange={v => set("financial_year", v)}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {FY_OPTIONS.map(fy => <SelectItem key={fy} value={fy}>{fy}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <YesNoQuestion
                      label="Q5. Is last year's audited data available for comparison?"
                      value={answers.prior_data_available}
                      onChange={v => set("prior_data_available", v)}
                    />
                  </div>
                </>
              )}

              {step === 1 && (
                <>
                  <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
                    <Briefcase size={20} /> Step 2: Business Operations
                  </h2>
                  <div className="space-y-5">
                    <YesNoQuestion
                      label="Q6. Does the entity have inventory?"
                      value={answers.has_inventory}
                      onChange={v => set("has_inventory", v)}
                      hint="Activates inventory scrutiny checks"
                    />
                    <YesNoQuestion
                      label="Q7. Does the entity have fixed assets?"
                      value={answers.has_fixed_assets}
                      onChange={v => set("has_fixed_assets", v)}
                      hint="Activates depreciation checks (D01–D06)"
                    />
                    <YesNoQuestion
                      label="Q8. Any related party transactions?"
                      value={answers.related_party_txns}
                      onChange={v => set("related_party_txns", v)}
                      hint="Activates CARO Para 3(xiii), 3CD Clause 23"
                    />
                    <YesNoQuestion
                      label="Q9. Any loans given or taken?"
                      value={answers.has_loans}
                      onChange={v => set("has_loans", v)}
                      hint="Activates CARO Para 3(iv), C08 check"
                    />
                    <YesNoQuestion
                      label="Q10. Any cash transactions > ₹10,000?"
                      value={answers.cash_txns_above_10k}
                      onChange={v => set("cash_txns_above_10k", v)}
                      hint="Activates C01–C04 cash checks"
                    />
                  </div>
                </>
              )}

              {step === 2 && (
                <>
                  <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
                    <BarChart3 size={20} /> Step 3: Financial Characteristics
                  </h2>
                  <div className="space-y-5">
                    <YesNoQuestion
                      label="Q11. Is the entity registered for GST?"
                      value={answers.gst_registered}
                      onChange={v => set("gst_registered", v)}
                    />
                    <YesNoQuestion
                      label="Q12. Is the entity a TDS deductor?"
                      value={answers.tds_deductor}
                      onChange={v => set("tds_deductor", v)}
                    />
                    <div className="space-y-2">
                      <Label>Q13. Approximate turnover range</Label>
                      <Select value={answers.turnover_range} onValueChange={v => set("turnover_range", v)}>
                        <SelectTrigger><SelectValue placeholder="Select range" /></SelectTrigger>
                        <SelectContent>
                          {TURNOVER_RANGES.map(r => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <YesNoQuestion
                      label="Q14. Does the entity have bank loans / secured debts?"
                      value={answers.has_bank_loans}
                      onChange={v => set("has_bank_loans", v)}
                    />
                    <YesNoQuestion
                      label="Q15. Any prior period items or exceptional items in accounts?"
                      value={answers.prior_exceptional_items}
                      onChange={v => set("prior_exceptional_items", v)}
                    />
                  </div>
                </>
              )}

              {step === 3 && (
                <>
                  <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
                    <ClipboardCheck size={20} /> Step 4: Review & Confirm
                  </h2>
                  <p className="text-sm text-muted-foreground">Review your answers. On confirm, the system will activate the relevant audit tabs.</p>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                    {/* Summary cards */}
                    <SummaryCard title="Entity & Year" items={[
                      ["Entity Type", answers.entity_type],
                      ["Statutory Audit", answers.statutory_audit],
                      ["Tax Audit 44AB", answers.tax_audit_44ab],
                      ["Financial Year", answers.financial_year],
                      ["Prior Data Available", answers.prior_data_available],
                    ]} />
                    <SummaryCard title="Business Operations" items={[
                      ["Inventory", answers.has_inventory],
                      ["Fixed Assets", answers.has_fixed_assets],
                      ["Related Party Txns", answers.related_party_txns],
                      ["Loans Given/Taken", answers.has_loans],
                      ["Cash > ₹10K", answers.cash_txns_above_10k],
                    ]} />
                    <SummaryCard title="Financial Profile" items={[
                      ["GST Registered", answers.gst_registered],
                      ["TDS Deductor", answers.tds_deductor],
                      ["Turnover Range", TURNOVER_RANGES.find(r => r.value === answers.turnover_range)?.label || "—"],
                      ["Bank Loans", answers.has_bank_loans],
                      ["Prior/Exceptional Items", answers.prior_exceptional_items],
                    ]} />

                    {/* Activated tabs preview */}
                    <Card className="p-4 space-y-3 border-primary/20">
                      <h3 className="text-sm font-semibold text-foreground">Tabs to Activate ({activatedCount})</h3>
                      <div className="flex flex-wrap gap-1.5">
                        {Object.entries(activeTabs).map(([key, on]) => (
                          <Badge key={key} variant={on ? "default" : "outline"} className={cn("text-xs capitalize", !on && "opacity-50")}>
                            {key.replace(/_/g, " ")}
                          </Badge>
                        ))}
                      </div>
                    </Card>
                  </div>
                </>
              )}
            </div>

            {/* Bottom nav */}
            <div className="flex items-center justify-between mt-8 pt-4 border-t border-border">
              <Button variant="outline" onClick={goPrev} disabled={step === 0} className="gap-1.5">
                <ChevronLeft size={16} /> Previous
              </Button>
              <span className="text-xs text-muted-foreground">Step {step + 1} of 4</span>
              {step < 3 ? (
                <Button onClick={goNext} disabled={!canProceed} className="gap-1.5">
                  Next <ChevronRight size={16} />
                </Button>
              ) : (
                <Button onClick={handleConfirm} disabled={saving || (!step1Valid || !step2Valid || !step3Valid)} className="gap-1.5">
                  {saving ? "Saving…" : "Save & Confirm"} <CheckCircle2 size={16} />
                </Button>
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

/* ─── Summary Card ─── */
function SummaryCard({ title, items }: { title: string; items: [string, string][] }) {
  return (
    <Card className="p-4 space-y-2">
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      <div className="space-y-1.5">
        {items.map(([label, val]) => (
          <div key={label} className="flex justify-between text-xs">
            <span className="text-muted-foreground">{label}</span>
            <span className={cn("font-medium capitalize", val === "yes" ? "text-green-600" : val === "no" ? "text-destructive" : "text-foreground")}>
              {val || "—"}
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}
