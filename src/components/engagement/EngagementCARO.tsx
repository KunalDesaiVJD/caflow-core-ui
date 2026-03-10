import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuditTracker } from "@/hooks/useAuditTracker";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { Sparkles, Loader2, Save, FileText } from "lucide-react";
import { Json } from "@/integrations/supabase/types";

const CARO_CLAUSES = [
  { para: "3(i)", topic: "Property, Plant and Equipment" },
  { para: "3(ii)", topic: "Physical Verification of Inventory" },
  { para: "3(iii)", topic: "Loans Granted by the Company" },
  { para: "3(iv)", topic: "Compliance with Section 185 & 186" },
  { para: "3(v)", topic: "Deposits under Sections 73-76" },
  { para: "3(vi)", topic: "Maintenance of Cost Records (Section 148)" },
  { para: "3(vii)(a)", topic: "Regularity in Payment of Statutory Dues" },
  { para: "3(vii)(b)", topic: "Disputed Statutory Dues" },
  { para: "3(viii)", topic: "Undisclosed Transactions / Income" },
  { para: "3(ix)", topic: "Default in Repayment of Loans" },
  { para: "3(x)", topic: "Fraud / Accommodation Entries" },
  { para: "3(xi)", topic: "Managerial Remuneration (Section 197)" },
  { para: "3(xii)", topic: "Nidhi Company Compliance" },
  { para: "3(xiii)", topic: "Related Party Transactions (Section 188 & 177)" },
  { para: "3(xiv)", topic: "Internal Audit System" },
  { para: "3(xv)", topic: "Non-Cash Transactions with Directors" },
  { para: "3(xvi)", topic: "Registration under Section 45-IA of RBI Act" },
  { para: "3(xvii)", topic: "Cash Losses" },
  { para: "3(xviii)", topic: "Resignation of Statutory Auditor" },
  { para: "3(xix)", topic: "Material Uncertainty — Going Concern" },
  { para: "3(xx)", topic: "Transfer to Investor Education & Protection Fund" },
];

interface CaroAnswer {
  para: string;
  topic: string;
  answer: string;
  source: "auto" | "ai" | "manual" | "";
  status: "filled" | "partial" | "manual_required" | "empty";
}

interface Props {
  engagement: any;
  client: any;
  onUpdate: () => void;
}

export function EngagementCARO({ engagement, client, onUpdate }: Props) {
  const [clauses, setClauses] = useState<CaroAnswer[]>([]);
  const [autoFilling, setAutoFilling] = useState(false);
  const [saving, setSaving] = useState(false);
  const prevClausesRef = useRef<CaroAnswer[]>([]);
  const { track } = useAuditTracker(engagement?.id);

  useEffect(() => {
    const saved = engagement.caro_responses as CaroAnswer[] | null;
    if (saved && Array.isArray(saved) && saved.length > 0) {
      // Merge saved with template to handle any new clauses
      const merged = CARO_CLAUSES.map(c => {
        const existing = (saved as any[]).find((s: any) => s.para === c.para);
        return existing || { ...c, answer: "", source: "", status: "empty" };
      });
      setClauses(merged);
    } else {
      setClauses(CARO_CLAUSES.map(c => ({ ...c, answer: "", source: "" as const, status: "empty" as const })));
    }
  }, [engagement.caro_responses]);

  const updateClause = (idx: number, answer: string) => {
    setClauses(prev => prev.map((c, i) => i === idx ? {
      ...c, answer, source: "manual" as const,
      status: answer.trim() ? "filled" as const : "empty" as const
    } : c));
  };

  const counts = {
    filled: clauses.filter(c => c.status === "filled").length,
    partial: clauses.filter(c => c.status === "partial").length,
    manual: clauses.filter(c => c.status === "manual_required" || c.status === "empty").length,
  };

  async function autoFillAll() {
    setAutoFilling(true);
    try {
      // Fetch supporting data
      const [findingsRes, tdsRes, rpRes, profileRes] = await Promise.all([
        supabase.from("scrutiny_findings").select("*").eq("client_id", client?.id),
        supabase.from("tds_entries").select("*").eq("client_id", client?.id),
        supabase.from("related_parties").select("*").eq("client_id", client?.id),
        supabase.from("client_profiles").select("*").eq("client_id", client?.id).maybeSingle(),
      ]);

      const findings = findingsRes.data || [];
      const tdsEntries = tdsRes.data || [];
      const relatedParties = rpRes.data || [];
      const profile = profileRes.data;
      const flags = client?.compliance_flags || {};

      const updated = clauses.map(c => {
        let answer = c.answer;
        let source: CaroAnswer["source"] = "";
        let status: CaroAnswer["status"] = "manual_required";

        switch (c.para) {
          case "3(i)": {
            const faFindings = findings.filter(f => f.rule_id?.startsWith("D0"));
            if (faFindings.length === 0) {
              answer = "The company has maintained proper records showing full particulars, including quantitative details and situation of Property, Plant and Equipment. The company has maintained proper records showing full particulars of intangible assets. The fixed assets have been physically verified by the management at reasonable intervals and no material discrepancies were noticed.";
              source = "auto"; status = "filled";
            } else {
              answer = `Fixed asset scrutiny found ${faFindings.length} observation(s): ${faFindings.map(f => f.flag_message).join("; ")}. Further review required.`;
              source = "auto"; status = "partial";
            }
            break;
          }
          case "3(ii)": {
            if (flags.fixed_assets) {
              answer = "Physical verification of inventories has been conducted at reasonable intervals by the management during the year. The discrepancies noticed on physical verification of inventories as compared to book records were not material.";
              source = "auto"; status = "partial";
            }
            break;
          }
          case "3(iii)": {
            const loanFindings = findings.filter(f => f.rule_id === "C08" || f.rule_id === "C09");
            const rpLoans = relatedParties.filter(rp => rp.transaction_types?.includes("loan"));
            answer = `Loan-related findings: ${loanFindings.length}. Related party loans: ${rpLoans.length}.`;
            if (rpLoans.length > 0) answer += ` Parties: ${rpLoans.map(r => r.party_name).join(", ")}.`;
            source = "auto"; status = loanFindings.length > 0 ? "partial" : "filled";
            break;
          }
          case "3(vii)(a)": {
            const pendingChallans = tdsEntries.filter(t => !t.challan_no);
            const overdueTds = tdsEntries.filter(t => t.due_date && !t.filed_at && new Date(t.due_date) < new Date());
            answer = `TDS challans pending: ${pendingChallans.length}. Overdue filings: ${overdueTds.length}.`;
            if (pendingChallans.length === 0 && overdueTds.length === 0) {
              answer = "According to the information and explanations given to us, the company has been regular in depositing undisputed statutory dues including provident fund, income-tax, sales-tax, service tax, goods and services tax, customs duty, excise duty, cess and any other material statutory dues with the appropriate authorities.";
              status = "filled";
            } else { status = "partial"; }
            source = "auto";
            break;
          }
          case "3(vii)(b)": {
            const auditQs = profile?.audit_questions as any;
            if (auditQs?.pending_litigation) {
              answer = `Disputed dues as reported by management: ${auditQs.pending_litigation}`;
              source = "auto"; status = "partial";
            }
            break;
          }
          case "3(x)": {
            const fraudFindings = findings.filter(f =>
              f.rule_id?.includes("NAR_AI") &&
              (f.flag_message?.toLowerCase().includes("accommodation") || f.flag_message?.toLowerCase().includes("circular"))
            );
            if (fraudFindings.length === 0) {
              answer = "Based on our audit procedures and according to the information and explanations given to us, no fraud by the company or on the company has been noticed or reported during the year.";
              source = "auto"; status = "filled";
            } else {
              answer = `${fraudFindings.length} potential fraud/accommodation entries identified: ${fraudFindings.map(f => f.flag_message).join("; ")}`;
              source = "auto"; status = "partial";
            }
            break;
          }
          case "3(xiv)": {
            if (flags.internal_audit !== undefined) {
              answer = flags.internal_audit
                ? "The company has an internal audit system commensurate with the size and nature of its business."
                : "The company does not have an internal audit system. This is required to be established as per the applicable provisions.";
              source = "auto"; status = flags.internal_audit ? "filled" : "partial";
            }
            break;
          }
          case "3(xi)":
          case "3(xix)": {
            const dirRemuneration = relatedParties.filter(rp =>
              rp.is_director && rp.transaction_types?.includes("remuneration")
            );
            if (c.para === "3(xi)" && dirRemuneration.length > 0) {
              answer = `Director remuneration paid to: ${dirRemuneration.map(d => d.party_name).join(", ")}. Verify compliance with Section 197.`;
              source = "auto"; status = "partial";
            }
            break;
          }
          default:
            break;
        }

        // If we already had a filled answer from user, keep it
        if (c.status === "filled" && c.source === "manual") return c;
        return { ...c, answer, source, status };
      });

      setClauses(updated);

      // Now send partial/manual_required clauses to AI
      const needsAI = updated.filter(c => c.status === "partial" || c.status === "manual_required" || c.status === "empty");
      if (needsAI.length > 0) {
        toast.info(`Auto-fill complete. Sending ${needsAI.length} clauses to AI for completion...`);
        try {
          const { data: { session } } = await supabase.auth.getSession();
          const res = await supabase.functions.invoke("claude-gateway", {
            body: {
              request_type: "caro_answers",
              user_message: JSON.stringify({
                partial_clauses: needsAI.map(c => ({ para: c.para, topic: c.topic, current_answer: c.answer })),
                entity_type: client?.entity_type,
                client_name: client?.name,
                financial_year: engagement.financial_year,
              }),
            },
          });

          if (res.data?.reply) {
            try {
              const aiAnswers = JSON.parse(res.data.reply);
              if (Array.isArray(aiAnswers)) {
                setClauses(prev => prev.map(c => {
                  const aiMatch = aiAnswers.find((a: any) => a.para === c.para);
                  if (aiMatch && (c.status !== "filled" || c.source !== "manual")) {
                    return { ...c, answer: aiMatch.answer || c.answer, source: "ai" as const, status: "filled" as const };
                  }
                  return c;
                }));
              }
            } catch {
              // AI returned non-JSON, apply as general text
              toast.info("AI provided general guidance. Please review individual clauses.");
            }
          }
        } catch (e) {
          toast.error("AI assist failed. Please fill remaining clauses manually.");
        }
      }

      toast.success("Auto-fill complete!");
    } catch (e) {
      toast.error("Auto-fill failed");
    } finally {
      setAutoFilling(false);
    }
  }

  async function save() {
    setSaving(true);
    // Track human edits on AI/auto-filled clauses
    clauses.forEach((c, i) => {
      const prev = prevClausesRef.current[i];
      if (prev && (prev.source === "ai" || prev.source === "auto") && c.source === "manual" && prev.answer !== c.answer) {
        track("caro_clause_edit", {
          clause_no: c.para,
          ai_text: prev.answer,
          human_text: c.answer,
          char_diff: c.answer.length - prev.answer.length,
        }, { aiSuggestion: prev.answer, humanOverride: true });
      }
    });
    prevClausesRef.current = [...clauses];

    const { error } = await supabase
      .from("audit_engagements")
      .update({ caro_responses: clauses as unknown as Json })
      .eq("id", engagement.id);

    if (error) toast.error("Save failed");
    else { toast.success("CARO responses saved"); onUpdate(); }
    setSaving(false);
  }

  const sourceBadge = (source: string) => {
    if (source === "auto") return <Badge variant="outline" className="text-[10px] bg-blue-500/10 text-blue-700 border-blue-300">Auto</Badge>;
    if (source === "ai") return <Badge variant="outline" className="text-[10px] bg-purple-500/10 text-purple-700 border-purple-300">AI</Badge>;
    if (source === "manual") return <Badge variant="outline" className="text-[10px] bg-muted text-muted-foreground">Manual</Badge>;
    return <span className="text-xs text-muted-foreground">—</span>;
  };

  const statusBadge = (status: string) => {
    if (status === "filled") return <Badge className="bg-green-500/15 text-green-700 border-green-300 text-[10px]">Filled</Badge>;
    if (status === "partial") return <Badge className="bg-amber-500/15 text-amber-700 border-amber-300 text-[10px]">Partial</Badge>;
    return <Badge variant="outline" className="text-[10px] text-muted-foreground">Required</Badge>;
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Companies Auditor's Report Order 2020 (CARO 2020)</h2>
          <div className="flex gap-2 mt-1">
            <Badge className="bg-green-500/15 text-green-700 text-xs">{counts.filled} Filled</Badge>
            <Badge className="bg-amber-500/15 text-amber-700 text-xs">{counts.partial} Partial</Badge>
            <Badge variant="outline" className="text-xs text-muted-foreground">{counts.manual} Required</Badge>
          </div>
        </div>
        <div className="flex gap-2">
          <Button onClick={autoFillAll} disabled={autoFilling} className="bg-sidebar-gold hover:bg-sidebar-gold/90 text-sidebar-gold-foreground">
            {autoFilling ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Sparkles className="w-4 h-4 mr-1" />}
            Auto-Fill All CARO Clauses
          </Button>
          <Button onClick={save} disabled={saving} variant="default">
            {saving ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Save className="w-4 h-4 mr-1" />}
            Save CARO
          </Button>
        </div>
      </div>

      {/* Table */}
      <div className="border rounded-lg overflow-auto max-h-[65vh]">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[80px]">Para</TableHead>
              <TableHead className="w-[200px]">Topic</TableHead>
              <TableHead>Current Answer</TableHead>
              <TableHead className="w-[70px]">Source</TableHead>
              <TableHead className="w-[80px]">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {clauses.map((c, i) => (
              <TableRow key={c.para}>
                <TableCell className="text-xs font-mono font-medium">{c.para}</TableCell>
                <TableCell className="text-xs">{c.topic}</TableCell>
                <TableCell>
                  <Textarea
                    value={c.answer}
                    onChange={e => updateClause(i, e.target.value)}
                    rows={4}
                    className="text-xs min-h-[80px]"
                    placeholder="Enter CARO response..."
                  />
                </TableCell>
                <TableCell>{sourceBadge(c.source)}</TableCell>
                <TableCell>{statusBadge(c.status)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
