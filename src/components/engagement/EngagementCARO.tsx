import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useAuditTracker } from "@/hooks/useAuditTracker";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { toast } from "sonner";
import { Sparkles, Loader2, Save, Lock, Download, CheckCircle2 } from "lucide-react";

const CARO_CLAUSES = [
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
  { number: 20, title: "Qualifications in Group Audit" },
  { number: 21, title: "CSR Compliance" },
];

interface CaroRow {
  id?: string;
  clause_number: number;
  clause_title: string;
  auto_draft: string;
  user_response: string;
  status: string;
  is_applicable: boolean;
  inapplicability_reason: string;
  is_locked: boolean;
}

interface Props {
  engagement: any;
  client: any;
  onUpdate: () => void;
}

export function EngagementCARO({ engagement, client, onUpdate }: Props) {
  const { user } = useAuth();
  const { track } = useAuditTracker(engagement?.id);
  const [rows, setRows] = useState<CaroRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [autoFilling, setAutoFilling] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadRows();
  }, [engagement?.id]);

  async function loadRows() {
    setLoading(true);
    const { data } = await supabase
      .from("audit_caro_responses")
      .select("*")
      .eq("engagement_id", engagement.id)
      .order("clause_number");

    if (data && data.length > 0) {
      setRows(data.map((d: any) => ({
        id: d.id,
        clause_number: d.clause_number,
        clause_title: d.clause_title,
        auto_draft: d.auto_draft || "",
        user_response: d.user_response || "",
        status: d.status || "not_started",
        is_applicable: d.is_applicable ?? true,
        inapplicability_reason: d.inapplicability_reason || "",
        is_locked: d.is_locked || false,
      })));
    } else {
      // Seed all 21 clauses
      const seeds = CARO_CLAUSES.map(c => ({
        engagement_id: engagement.id,
        clause_number: c.number,
        clause_title: c.title,
        status: "not_started",
        is_applicable: true,
        is_locked: false,
      }));
      await supabase.from("audit_caro_responses").insert(seeds as any);
      await loadRows();
      return;
    }
    setLoading(false);
  }

  function updateRow(idx: number, field: keyof CaroRow, value: any) {
    setRows(prev => prev.map((r, i) => i === idx ? { ...r, [field]: value } : r));
  }

  const counts = {
    approved: rows.filter(r => r.status === "approved" || r.status === "locked").length,
    drafted: rows.filter(r => r.status === "drafted" || r.status === "reviewed").length,
    pending: rows.filter(r => r.status === "not_started").length,
    na: rows.filter(r => !r.is_applicable).length,
  };

  async function autoFillAll() {
    setAutoFilling(true);
    try {
      const [findingsRes, tdsRes] = await Promise.all([
        supabase.from("scrutiny_findings").select("*").eq("client_id", client?.id),
        supabase.from("tds_entries").select("*").eq("client_id", client?.id),
      ]);
      const findings = findingsRes.data || [];
      const tdsEntries = tdsRes.data || [];

      // Send to AI for drafting
      const clausesForAI = rows.filter(r => r.is_applicable && !r.is_locked && r.status !== "approved").map(r => ({
        clause_number: r.clause_number,
        clause_title: r.clause_title,
        current_response: r.user_response || r.auto_draft,
      }));

      const res = await supabase.functions.invoke("claude-gateway", {
        body: {
          request_type: "caro_answers",
          user_message: JSON.stringify({
            partial_clauses: clausesForAI.map(c => ({ para: `Clause ${c.clause_number}`, topic: c.clause_title, current_answer: c.current_response })),
            entity_type: client?.entity_type,
            client_name: client?.name,
            financial_year: engagement.financial_year,
            findings_count: findings.length,
            tds_entries_count: tdsEntries.length,
          }),
        },
      });

      if (res.data?.reply) {
        try {
          const aiAnswers = JSON.parse(res.data.reply);
          if (Array.isArray(aiAnswers)) {
            setRows(prev => prev.map(r => {
              const match = aiAnswers.find((a: any) => {
                const num = parseInt(String(a.para || a.clause_number || "").replace(/\D/g, ""));
                return num === r.clause_number;
              });
              if (match && !r.is_locked && r.status !== "approved") {
                return { ...r, auto_draft: match.answer || match.response || r.auto_draft, status: "drafted" };
              }
              return r;
            }));
          }
        } catch {
          toast.info("AI returned guidance. Review individual clauses.");
        }
      }
      toast.success("Auto-fill complete!");
    } catch {
      toast.error("Auto-fill failed. Fill clauses manually.");
    }
    setAutoFilling(false);
  }

  async function saveAll() {
    setSaving(true);
    try {
      for (const r of rows) {
        const payload: any = {
          auto_draft: r.auto_draft,
          user_response: r.user_response,
          status: r.status,
          is_applicable: r.is_applicable,
          inapplicability_reason: r.inapplicability_reason,
          is_locked: r.is_locked,
          last_updated_by: user?.id,
          last_updated_at: new Date().toISOString(),
        };
        if (r.id) {
          await supabase.from("audit_caro_responses").update(payload).eq("id", r.id);
        }
      }
      toast.success("CARO responses saved");
      onUpdate();
    } catch {
      toast.error("Save failed");
    }
    setSaving(false);
  }

  function approveClause(idx: number) {
    setRows(prev => prev.map((r, i) => i === idx ? { ...r, status: "approved", is_locked: true } : r));
    track("caro_clause_approve", { clause_number: rows[idx].clause_number });
  }

  function approveAll() {
    setRows(prev => prev.map(r => r.is_applicable && r.user_response.trim() ? { ...r, status: "approved", is_locked: true } : r));
    track("caro_approve_all", {});
  }

  const statusBadge = (status: string) => {
    const map: Record<string, string> = {
      not_started: "bg-muted text-muted-foreground",
      drafted: "bg-blue-500/15 text-blue-700",
      reviewed: "bg-amber-500/15 text-amber-700",
      approved: "bg-green-500/15 text-green-700",
      locked: "bg-green-500/15 text-green-700",
    };
    return <Badge className={`text-[10px] ${map[status] || ""}`}>{status.replace("_", " ")}</Badge>;
  };

  if (loading) return <div className="py-8 text-center text-muted-foreground">Loading CARO clauses...</div>;

  return (
    <div className="space-y-4">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-foreground">CARO 2020 — 21 Clauses</h2>
          <div className="flex gap-2 mt-1">
            <Badge className="bg-green-500/15 text-green-700 text-xs">{counts.approved} Approved</Badge>
            <Badge className="bg-blue-500/15 text-blue-700 text-xs">{counts.drafted} Drafted</Badge>
            <Badge variant="outline" className="text-xs">{counts.pending} Pending</Badge>
            {counts.na > 0 && <Badge variant="secondary" className="text-xs">{counts.na} N/A</Badge>}
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button onClick={autoFillAll} disabled={autoFilling} variant="outline" className="gap-1">
            {autoFilling ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            Auto-Fill All
          </Button>
          <Button onClick={approveAll} variant="outline" className="gap-1">
            <CheckCircle2 className="w-4 h-4" /> Approve All
          </Button>
          <Button onClick={saveAll} disabled={saving} className="gap-1">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save CARO
          </Button>
        </div>
      </div>

      <Accordion type="multiple" className="space-y-2">
        {rows.map((row, idx) => (
          <AccordionItem key={row.clause_number} value={`clause-${row.clause_number}`} className="border rounded-lg">
            <AccordionTrigger className="px-4 py-3 hover:no-underline">
              <div className="flex items-center gap-3 w-full">
                <span className="text-sm font-mono font-bold text-primary min-w-[30px]">{row.clause_number}</span>
                <span className="text-sm font-medium flex-1 text-left">{row.clause_title}</span>
                {!row.is_applicable && <Badge variant="secondary" className="text-[10px]">N/A</Badge>}
                {statusBadge(row.status)}
                {row.is_locked && <Lock className="w-3.5 h-3.5 text-muted-foreground" />}
              </div>
            </AccordionTrigger>
            <AccordionContent className="px-4 pb-4 space-y-3">
              <div className="flex items-center gap-3">
                <Switch
                  checked={row.is_applicable}
                  onCheckedChange={v => updateRow(idx, "is_applicable", v)}
                  disabled={row.is_locked}
                />
                <Label className="text-xs">Applicable</Label>
              </div>

              {!row.is_applicable && (
                <Textarea
                  value={row.inapplicability_reason}
                  onChange={e => updateRow(idx, "inapplicability_reason", e.target.value)}
                  placeholder="Reason for inapplicability..."
                  className="text-xs h-16"
                  disabled={row.is_locked}
                />
              )}

              {row.is_applicable && (
                <>
                  {row.auto_draft && (
                    <div className="bg-blue-50 dark:bg-blue-950/20 rounded-md p-3 text-xs">
                      <p className="font-semibold text-blue-700 mb-1">AI Draft:</p>
                      <p className="whitespace-pre-wrap text-muted-foreground">{row.auto_draft}</p>
                      {!row.is_locked && !row.user_response && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="mt-2 text-xs h-7"
                          onClick={() => updateRow(idx, "user_response", row.auto_draft)}
                        >
                          Use AI Draft
                        </Button>
                      )}
                    </div>
                  )}
                  <Textarea
                    value={row.user_response}
                    onChange={e => updateRow(idx, "user_response", e.target.value)}
                    placeholder="Enter your CARO response..."
                    className="text-xs min-h-[100px]"
                    disabled={row.is_locked}
                  />
                  {!row.is_locked && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1 text-xs"
                      onClick={() => approveClause(idx)}
                      disabled={!row.user_response.trim()}
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" /> Approve & Lock
                    </Button>
                  )}
                </>
              )}
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </div>
  );
}
