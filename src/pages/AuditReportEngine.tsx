import { useState, useEffect, useMemo, useCallback } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useAuditTracker } from "@/hooks/useAuditTracker";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import {
  FileOutput, Save, Loader2, Lock, Download, Sparkles, CheckCircle2, AlertTriangle,
} from "lucide-react";

// ─── 3CD 44 Clauses ───
const CLAUSES_3CD = [
  { number: 1, title: "Name of the assessee" },
  { number: 2, title: "Address" },
  { number: 3, title: "Permanent Account Number (PAN)" },
  { number: 4, title: "Whether the assessee is liable to pay indirect tax like excise duty, service tax, sales tax, customs duty, etc." },
  { number: 5, title: "Status of the assessee" },
  { number: 6, title: "Previous year — From / To" },
  { number: 7, title: "Assessment year" },
  { number: 8, title: "Relevant clause of section 44AB under which the audit has been conducted" },
  { number: 9, title: "Partner/Member details of the firm/AOP" },
  { number: 10, title: "Nature of business or profession" },
  { number: 11, title: "Whether books of account are prescribed under section 44AA, if yes, list of books" },
  { number: 12, title: "Whether the profit and loss account includes any profits and gains assessable on presumptive basis" },
  { number: 13, title: "Method of accounting employed in the previous year" },
  { number: 14, title: "Method of valuation of closing stock employed in the previous year" },
  { number: 15, title: "Capital account of the proprietor/partners (opening, additions, withdrawals, closing)" },
  { number: 16, title: "Particulars of depreciation allowable as per the Income-tax Act, 1961" },
  { number: 17, title: "Amounts not credited to the P&L account (Section 56)" },
  { number: 18, title: "Particulars of amounts not allowable under section 40" },
  { number: 19, title: "Amounts debited to P&L account — Capital or personal expenditure" },
  { number: 20, title: "Amounts disallowed under section 40A(3) — Cash payments exceeding ₹10,000" },
  { number: 21, title: "Payment to persons specified under section 40A(2)(b)" },
  { number: 22, title: "Amounts deemed to be profits — Section 33AB, 33ABA, 33AC" },
  { number: 23, title: "Amount of income/receipts credited to P&L (deducted from the income)" },
  { number: 24, title: "Particulars of each loan or deposit in excess of the specified limits" },
  { number: 25, title: "Repayment of loan/deposit otherwise than by account payee cheque/draft" },
  { number: 26, title: "Payments exceeding ₹20,000 otherwise than by account payee cheque/draft (Sec 40A(3))" },
  { number: 27, title: "Interest paid falling within Section 23 of MSMED Act" },
  { number: 28, title: "Payments to non-residents (Section 40(a)(i))" },
  { number: 29, title: "Expenditure incurred on scientific research under section 35" },
  { number: 30, title: "Expenditure on eligible projects under section 35(2AA)" },
  { number: 31, title: "Amount of deduction inadmissible under section 36(1)(va)" },
  { number: 32, title: "Particulars of contributions received from employees — PF, Superannuation, ESI" },
  { number: 33, title: "Whether the assessee has received any property/sum of money (Section 56(2))" },
  { number: 34, title: "Compliance with TDS/TCS provisions" },
  { number: 35, title: "Quantitative details of principal items or products or services" },
  { number: 36, title: "In the case of trading concern — Opening/Closing stock, Purchases, Sales" },
  { number: 37, title: "In the case of manufacturing concern — Raw materials, Finished goods" },
  { number: 38, title: "Whether any land or building or both is transferred for consideration less than stamp duty" },
  { number: 39, title: "Deemed income under section 56(2)(x)" },
  { number: 40, title: "Details of receipts chargeable under section 56(2)(vi)/(vii)/(viia)" },
  { number: 41, title: "Details of Turnover/Gross receipts reported for GST" },
  { number: 42, title: "Break-up of total expenditure incurred during the previous year" },
  { number: 43, title: "Particulars of demand raised or refund issued during the previous year" },
  { number: 44, title: "Break-up of expenditure — Cash / Digital mode" },
];

interface Clause3CD {
  id?: string;
  clause_number: number;
  clause_sub: string;
  title: string;
  auto_value: string;
  user_value: string;
  is_applicable: boolean;
  is_locked: boolean;
}

export default function AuditReportEngine() {
  const { clientId } = useParams<{ clientId?: string }>();
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState("iar");
  const [engagements, setEngagements] = useState<any[]>([]);
  const [selectedEngId, setSelectedEngId] = useState("");
  const [engagement, setEngagement] = useState<any>(null);
  const [client, setClient] = useState<any>(null);
  const [firm, setFirm] = useState<any>(null);
  // W3/W4 fix: partner name now comes from engagement.partner_id → users
  // (the engagement's actual partner), and membership_no is looked up in
  // firms.membership_numbers keyed by that partner's name. The previous
  // code always took the FIRST entry in membership_numbers — which was
  // only correct when the firm had exactly one partner.
  const [partner, setPartner] = useState<{ name: string; icai_reg_no: string | null } | null>(null);
  const [loading, setLoading] = useState(true);

  // IAR
  const [opinionType, setOpinionType] = useState("unmodified");
  const [basisParagraph, setBasisParagraph] = useState("");
  const [kamText, setKamText] = useState("");
  const [udin, setUdin] = useState("");

  // 3CD
  const [clauses3cd, setClauses3cd] = useState<Clause3CD[]>([]);
  const [saving3cd, setSaving3cd] = useState(false);

  // 3CA/3CB
  const [form3caText, setForm3caText] = useState("");
  const [form3cbText, setForm3cbText] = useState("");

  // Finalize
  const [finalizeOpen, setFinalizeOpen] = useState(false);
  const [finalizeChecked, setFinalizeChecked] = useState(false);
  const [finalizing, setFinalizing] = useState(false);

  // Load engagements
  useEffect(() => {
    (async () => {
      setLoading(true);
      let q = supabase.from("audit_engagements").select("id, client_id, financial_year, audit_type, status, requires_3ca, requires_3cb, requires_3cd, requires_caro").order("financial_year", { ascending: false });
      if (user?.firm_id) q = q.eq("firm_id", user.firm_id);
      if (clientId) q = q.eq("client_id", clientId);
      const { data } = await q;
      setEngagements(data || []);
      if (data && data.length > 0 && !selectedEngId) setSelectedEngId(data[0].id);
      setLoading(false);
    })();
  }, [user?.firm_id, clientId]);

  // Load engagement detail
  useEffect(() => {
    if (!selectedEngId) return;
    (async () => {
      const { data: eng } = await supabase.from("audit_engagements").select("*").eq("id", selectedEngId).single();
      setEngagement(eng);
      if (eng?.client_id) {
        const { data: cl } = await supabase.from("clients").select("*").eq("id", eng.client_id).single();
        setClient(cl);
      }
      if (eng?.firm_id) {
        const { data: f } = await supabase.from("firms").select("*").eq("id", eng.firm_id).single();
        setFirm(f);
      } else {
        setFirm(null);
      }
      if (eng?.partner_id) {
        const { data: p } = await supabase
          .from("users")
          .select("name, icai_reg_no")
          .eq("id", eng.partner_id)
          .maybeSingle();
        setPartner(p ? { name: p.name || "", icai_reg_no: (p as any).icai_reg_no ?? null } : null);
      } else {
        setPartner(null);
      }
      // Load 3CD
      const { data: cd } = await supabase.from("audit_3cd_responses").select("*").eq("engagement_id", selectedEngId).order("clause_number");
      if (cd && cd.length > 0) {
        setClauses3cd(cd.map((d: any) => ({
          id: d.id,
          clause_number: d.clause_number,
          clause_sub: d.clause_sub || "",
          title: CLAUSES_3CD.find(c => c.number === d.clause_number)?.title || "",
          auto_value: d.auto_value || "",
          user_value: d.user_value || "",
          is_applicable: d.is_applicable ?? true,
          is_locked: d.is_locked || false,
        })));
      } else {
        // Seed 3CD clauses
        const seeds = CLAUSES_3CD.map(c => ({
          engagement_id: selectedEngId,
          clause_number: c.number,
          clause_sub: "",
          is_applicable: true,
          is_locked: false,
        }));
        await supabase.from("audit_3cd_responses").insert(seeds as any);
        setClauses3cd(CLAUSES_3CD.map(c => ({
          clause_number: c.number,
          clause_sub: "",
          title: c.title,
          auto_value: "",
          user_value: "",
          is_applicable: true,
          is_locked: false,
        })));
      }
    })();
  }, [selectedEngId]);

  function update3cd(idx: number, field: keyof Clause3CD, value: any) {
    setClauses3cd(prev => prev.map((c, i) => i === idx ? { ...c, [field]: value } : c));
  }

  async function save3cd() {
    setSaving3cd(true);
    for (const c of clauses3cd) {
      if (c.id) {
        await supabase.from("audit_3cd_responses").update({
          auto_value: c.auto_value,
          user_value: c.user_value,
          is_applicable: c.is_applicable,
          is_locked: c.is_locked,
          last_updated_by: user?.id,
          updated_at: new Date().toISOString(),
        }).eq("id", c.id);
      }
    }
    toast.success("3CD responses saved");
    setSaving3cd(false);
  }

  async function handleFinalize() {
    setFinalizing(true);
    try {
      // Check open queries
      const { data: openQueries } = await supabase
        .from("audit_client_queries")
        .select("id")
        .eq("engagement_id", selectedEngId)
        .eq("status", "open")
        .limit(1);
      if (openQueries && openQueries.length > 0) {
        toast.error("Cannot finalize: Open queries remain. Resolve them first.");
        setFinalizing(false);
        return;
      }

      // Lock notes
      await supabase.from("audit_notes").update({ is_locked: true }).eq("engagement_id", selectedEngId);
      // Lock CARO
      await supabase.from("audit_caro_responses").update({ is_locked: true, status: "locked" }).eq("engagement_id", selectedEngId);
      // Lock 3CD
      await supabase.from("audit_3cd_responses").update({ is_locked: true }).eq("engagement_id", selectedEngId);
      // Update engagement
      await supabase.from("audit_engagements").update({
        pipeline_stage: 9,
        stage_statuses: { ...(engagement?.stage_statuses || {}), "9": "complete" },
      } as any).eq("id", selectedEngId);
      // Lock FA assets if any
      await supabase.from("fa_assets").update({ is_locked: true }).eq("engagement_id", selectedEngId);

      toast.success("All reports finalized and locked. Proceed to Stage 10 (Sign-off).");
      setFinalizeOpen(false);
    } catch (e: any) {
      toast.error("Finalization failed: " + e.message);
    }
    setFinalizing(false);
  }

  const firmName = firm?.display_name || firm?.name || "";
  // W3: partner is the engagement's actual partner (from partner_id),
  // not whoever happens to be first in the firm's roster.
  const partnerName = partner?.name || "";
  // W4: membership number resolved from firms.membership_numbers by
  // matching partner_name case-insensitively. Fall back to user's
  // icai_reg_no, then a blank-line placeholder.
  const icaiNo = (() => {
    const roster: Array<{ partner_name: string; membership_no: string }> =
      Array.isArray((firm as any)?.membership_numbers) ? (firm as any).membership_numbers : [];
    const norm = (s: string) => (s || "").trim().toLowerCase();
    const hit = roster.find(m => norm(m.partner_name) === norm(partnerName));
    return hit?.membership_no || partner?.icai_reg_no || "";
  })();

  if (loading) return <div className="p-6"><Skeleton className="h-[400px] w-full" /></div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-display font-bold text-foreground">Audit Reports — Stage 9</h1>
          <p className="text-sm text-muted-foreground">Independent Auditor's Report, Form 3CA/3CB, Form 3CD</p>
        </div>
        <div className="flex gap-2">
          <Select value={selectedEngId} onValueChange={setSelectedEngId}>
            <SelectTrigger className="w-[300px]"><SelectValue placeholder="Select Engagement" /></SelectTrigger>
            <SelectContent>
              {engagements.map(e => (
                <SelectItem key={e.id} value={e.id}>
                  {e.financial_year} — {e.audit_type || "Statutory"} ({e.status})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {!selectedEngId ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">Select an engagement to generate reports.</CardContent></Card>
      ) : (
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          {(() => {
            // Enforce entity-type rule: companies must never show Form 3CB
            const et = (engagement?.entity_type || "").toLowerCase().trim();
            const isCompanyEng = ["company", "private ltd", "public ltd", "opc", "pvt_ltd", "public_ltd"].includes(et);
            const show3ca = isCompanyEng || (engagement?.requires_3ca ?? false);
            const show3cb = !isCompanyEng && (engagement?.requires_3cb ?? false);
            return (
              <TabsList>
                <TabsTrigger value="iar">Independent Auditor's Report</TabsTrigger>
                {show3ca && <TabsTrigger value="3ca">Form 3CA</TabsTrigger>}
                {show3cb && <TabsTrigger value="3cb">Form 3CB</TabsTrigger>}
                {engagement?.requires_3cd && <TabsTrigger value="3cd">Form 3CD</TabsTrigger>}
              </TabsList>
            );
          })()}

          {/* IAR Tab */}
          <TabsContent value="iar">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Independent Auditor's Report</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label className="text-xs">Opinion Type</Label>
                    <Select value={opinionType} onValueChange={setOpinionType}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="unmodified">Unmodified</SelectItem>
                        <SelectItem value="qualified">Qualified</SelectItem>
                        <SelectItem value="adverse">Adverse</SelectItem>
                        <SelectItem value="disclaimer">Disclaimer of Opinion</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs">UDIN</Label>
                    <Input value={udin} onChange={e => setUdin(e.target.value)} placeholder="To be filled in Stage 10" />
                  </div>
                </div>

                {opinionType !== "unmodified" && (
                  <div>
                    <Label className="text-xs">Basis for {opinionType === "qualified" ? "Qualified" : opinionType === "adverse" ? "Adverse" : "Disclaimer of"} Opinion</Label>
                    <Textarea value={basisParagraph} onChange={e => setBasisParagraph(e.target.value)} placeholder="Describe the basis..." className="min-h-[120px]" />
                  </div>
                )}

                <div>
                  <Label className="text-xs">Key Audit Matters (if applicable)</Label>
                  <Textarea value={kamText} onChange={e => setKamText(e.target.value)} placeholder="Key audit matters identified during the audit..." className="min-h-[120px]" />
                </div>

                <div className="bg-muted/30 p-4 rounded-md text-sm space-y-1">
                  <p><strong>Firm:</strong> {firmName}</p>
                  <p><strong>ICAI Reg No:</strong> {icaiNo}</p>
                  <p><strong>Place:</strong> {firm?.state || "—"}</p>
                  <p><strong>Date:</strong> {new Date().toLocaleDateString("en-IN")}</p>
                </div>

                <Button variant="outline" className="gap-1">
                  <Download className="w-4 h-4" /> Export IAR PDF
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          {/* 3CA Tab */}
          {engagement?.requires_3ca && (
            <TabsContent value="3ca">
              <Card>
                <CardHeader><CardTitle className="text-base">Form 3CA — Audit Report u/s 44AB (Companies)</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                  <div className="bg-muted/30 p-4 rounded-md text-sm space-y-1">
                    <p><strong>Entity:</strong> {client?.name}</p>
                    <p><strong>PAN:</strong> {client?.pan}</p>
                    <p><strong>Period:</strong> {engagement?.financial_year}</p>
                  </div>
                  <Textarea value={form3caText} onChange={e => setForm3caText(e.target.value)} placeholder="We have examined the balance sheet as at..." className="min-h-[200px]" />
                  <Button variant="outline" className="gap-1"><Download className="w-4 h-4" /> Export 3CA PDF</Button>
                </CardContent>
              </Card>
            </TabsContent>
          )}

          {/* 3CB Tab — only for non-companies */}
          {engagement?.requires_3cb && !(["company","private ltd","public ltd","opc","pvt_ltd","public_ltd"].includes((engagement?.entity_type||"").toLowerCase().trim())) && (
            <TabsContent value="3cb">
              <Card>
                <CardHeader><CardTitle className="text-base">Form 3CB — Audit Report u/s 44AB (Non-Companies)</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                  <div className="bg-muted/30 p-4 rounded-md text-sm space-y-1">
                    <p><strong>Entity:</strong> {client?.name}</p>
                    <p><strong>PAN:</strong> {client?.pan}</p>
                    <p><strong>Period:</strong> {engagement?.financial_year}</p>
                  </div>
                  <Textarea value={form3cbText} onChange={e => setForm3cbText(e.target.value)} placeholder="I/We have examined the balance sheet as at..." className="min-h-[200px]" />
                  <Button variant="outline" className="gap-1"><Download className="w-4 h-4" /> Export 3CB PDF</Button>
                </CardContent>
              </Card>
            </TabsContent>
          )}

          {/* 3CD Tab */}
          {engagement?.requires_3cd && (
            <TabsContent value="3cd">
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">Form 3CD — Statement of Particulars (44 Clauses)</CardTitle>
                    <div className="flex gap-2">
                      <Button onClick={save3cd} disabled={saving3cd} size="sm" className="gap-1">
                        {saving3cd ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                        Save 3CD
                      </Button>
                      <Button variant="outline" size="sm" className="gap-1"><Download className="w-4 h-4" /> Export 3CD</Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <Accordion type="multiple" className="space-y-1">
                    {clauses3cd.map((clause, idx) => (
                      <AccordionItem key={clause.clause_number} value={`3cd-${clause.clause_number}`} className="border rounded-md">
                        <AccordionTrigger className="px-3 py-2 hover:no-underline text-xs">
                          <div className="flex items-center gap-2 w-full">
                            <span className="font-mono font-bold text-primary min-w-[30px]">{clause.clause_number}</span>
                            <span className="flex-1 text-left">{clause.title}</span>
                            {!clause.is_applicable && <Badge variant="secondary" className="text-[9px]">N/A</Badge>}
                            {clause.user_value && <Badge className="bg-green-500/15 text-green-700 text-[9px]">Filled</Badge>}
                            {clause.is_locked && <Lock className="w-3 h-3 text-muted-foreground" />}
                          </div>
                        </AccordionTrigger>
                        <AccordionContent className="px-3 pb-3 space-y-2">
                          <div className="flex items-center gap-2">
                            <Switch checked={clause.is_applicable} onCheckedChange={v => update3cd(idx, "is_applicable", v)} disabled={clause.is_locked} />
                            <Label className="text-xs">Applicable</Label>
                          </div>
                          {clause.is_applicable && (
                            <Textarea
                              value={clause.user_value}
                              onChange={e => update3cd(idx, "user_value", e.target.value)}
                              placeholder={`Enter details for Clause ${clause.clause_number}...`}
                              className="text-xs min-h-[80px]"
                              disabled={clause.is_locked}
                            />
                          )}
                        </AccordionContent>
                      </AccordionItem>
                    ))}
                  </Accordion>
                </CardContent>
              </Card>
            </TabsContent>
          )}
        </Tabs>
      )}

      {/* Generate Final Report Button */}
      {selectedEngId && (
        <div className="flex justify-center pt-4">
          <Button size="lg" onClick={() => setFinalizeOpen(true)} className="gap-2 px-8">
            <Lock className="w-5 h-5" /> Generate Final Report & Lock All
          </Button>
        </div>
      )}

      <AlertDialog open={finalizeOpen} onOpenChange={setFinalizeOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2"><AlertTriangle className="w-5 h-5 text-amber-500" /> Finalize All Reports?</AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <p>This will lock the following permanently:</p>
              <ul className="list-disc list-inside text-xs space-y-1">
                <li>All Notes to Accounts</li>
                <li>All CARO 2020 Responses</li>
                <li>All Form 3CD Responses</li>
                <li>Fixed Assets (if applicable)</li>
              </ul>
              <p className="text-amber-600 font-medium">Open queries will block finalization.</p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex items-center gap-2 px-6">
            <Checkbox checked={finalizeChecked} onCheckedChange={v => setFinalizeChecked(!!v)} />
            <Label className="text-xs">I confirm all information is accurate and complete.</Label>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleFinalize} disabled={!finalizeChecked || finalizing}>
              {finalizing ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
              Finalize & Lock
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
