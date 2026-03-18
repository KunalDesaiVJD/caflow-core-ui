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
import { Sparkles, Loader2, Save, Lock, CheckCircle2, Download, FileType, Printer } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { exportToPdf, exportToWord } from "@/lib/exportUtils";

// Hardcoded fallback titles — used ONLY if master templates don't exist
const CARO_CLAUSES_FALLBACK: Record<number, string> = {
  1: "Immovable Properties", 2: "Inventory Physical Verification", 3: "Investments/Guarantees/Security",
  4: "Loans, Advances, Guarantees Compliance (Sec 185/186)", 5: "Deposits Compliance", 6: "Cost Records",
  7: "Statutory Dues (TDS/ESI/PF/IT/GST)", 8: "Unrecorded Income/Surrendered", 9: "Default on Loans/Debentures",
  10: "IPO/FPO Fund Utilization", 11: "Fraud Reported", 12: "Nidhi Company Compliance",
  13: "Related Party Transactions", 14: "Internal Audit", 15: "Non-Cash Transactions with Directors",
  16: "RBI Registration if NBFC", 17: "Cash Losses", 18: "Resignation of Auditors",
  19: "Going Concern Doubt", 20: "CSR Compliance", 21: "Qualifications in Group Audit",
};

// Hardcoded fallback default content
const CARO_DEFAULT_CONTENT: Record<number, string> = {
  1: `(A) The company has maintained proper records showing full particulars including, quantitative details and situation of the Property, Plant and Equipment.\n(B) The company does not have any intangible assets and hence, the para is not applicable to the company.\n(b) As explained to us, the Property, Plant and Equipment were physically verified by the management during the year at reasonable interval. No material discrepancies were noticed on such verification.\n(c) The title of the immovable properties is held in the name of the company.\n(d) The company has not revalued its Property, Plant and Equipment (including Right of Use assets) or intangible assets or both during the year.\n(e) No any proceedings have been initiated or are pending against the company for holding any benami property under the Benami Transactions (Prohibition) Act, 1988 (45 of 1988) and rules made there under.`,
  2: `The Inventory were physically verified by the management during the year at reasonable interval. No material discrepancies were noticed on such verification.\n(b) During the year, the company has not been sanctioned working capital limits in excess of five crore rupees, in aggregate, from banks or financial institutions on the basis of security of current assets.`,
  3: `The company has not made Investments, provided any guarantee or security or granted any loans or advances in the nature of loans, secured or unsecured, to companies, firms, Limited liability Partnerships or any other parties. Hence, sub-paragraphs (a) to (f) of paragraph J(iii) of the Companies (Auditor's Report) Order, 2020 ('the order') are not applicable.`,
  4: `The company has not granted any loans or made any investments or provided any guarantees or securities to the parties covered under sections 185 and 186 Act. Accordingly, the provisions or paragraph 3(iv) of the order are not applicable to the company.`,
  5: `The company has neither accepted any deposits from the public nor accepted any amounts which are deemed to be deposits within the meaning of sections 73 to 76 of the Companies Act and the rules made thereunder, to the extent applicable. Therefore, the provisions of paragraph 3(v) of the order are not applicable to the Company.`,
  6: `As informed and explained to us, the maintenance of Cost records u/s. 148(1) of the Act is not applicable to the company.`,
  7: `(a) According to information and explanations given to us, the company is generally regular in depositing with Appropriate Authorities undisputed statutory dues including Income Tax, Provident fund, Employees State Insurance, VAT/Sales Tax, Excise-duty, Custom Duty, Service Tax, Goods and Services Tax and other material statutory dues applicable to it. According to the information and explanations given to us, there were no undisputed amounts payable in respect of such dues which were outstanding as on 31st March, 2025 for a period of more than six months from the date they became payable.\n(b) According to the records of the company, there are no dues of Sales tax, Income tax, Custom duty, Goods & Service Tax which have not been deposited on account of any disputes.`,
  8: `The company has not surrendered or disclosed any transaction, previously unrecorded in the books of account, in the tax assessments under the Income Tax Act, 1961 as income during the year. Accordingly, the requirement to report on clause 3(vii) of the order is not applicable to the company.`,
  9: `(a) In our opinion and according to the information and explanations given by the management, the Company has not defaulted in repayment of loans or other borrowings or in the payment or interest thereon to any lender.\n(b) The company has not been declared willful defaulter by any bank or financial institution or government or any government authority.\n(c) In our opinion, and according to the information and explanations given to us, the term loans have been applied for the purposes for which they were obtained.\n(d) On an overall examination of the financial Statements of the company, no funds raised on short-term basis have been used for long term purposes by the Company.\n(e) On an overall examination of the financial Statements of the company, the company has not taken any funds from any entity or person on account of or to meet the obligations of its subsidiaries, associates or joint ventures.\n(f) The company has not raised loans during the year on the pledge of securities held in its subsidiaries, joint ventures or associate companies.`,
  10: `(a) The company has not raised any funds through IPO or FPO (including debt instruments) or has not made any preferential allotment or private placement of shares or convertible debentures and therefore the question for utilization thereof does not arise.\n(b) The company has not made any preferential allotment or private placement of shares /fully or partially or optionally convertible debentures during the year under audit and hence, the requirement to report on clause 3(x) (b) of the order is not applicable to the Company.`,
  11: `(a) During the course of our examination of the books and records of the company, carried out in accordance with the generally accepted auditing practices in India and according to the information and explanations given to us, we have neither come across any instance of fraud on or by the company, noticed or reported during the year, nor we have been informed of such case by the management.\n(b) During the year, no report under sub-section (12) of section 143 of the Companies Act, 2013 has been filed by auditors in Form ADT - 4 as prescribed under Rule 13 of Companies (Audit and Auditors) Rules, 2014 with the central Government.\n(c) As represented to us by the management, there are no whistle blower complaints received by the Company during the year.`,
  12: `The company is not a Nidhi Company as per the provisions of the Companies Act, 2013. Therefore, the requirement to report on clause 3(xii)(a) (b) and (c) of the order is not applicable to the Company.`,
  13: `According to the information and explanations given to us and based on our examinations of the records of the company, related parties transactions are in compliance with sections 177 and 188 of Companies Act, where ever applicable, the details of the same have been disclosed in the financial statements etc., as required by the applicable accounting standards.`,
  14: `The company does not have an internal audit system and based on our examination, company does not required to have an internal audit system as per provisions of the Companies Act 2013. Accordingly, the reporting under Clause 3(xiv)(a) and (b) of the order is not applicable to the Company.`,
  15: `In our opinion and according to the information and explanations given to us, during the year the Company has not entered into any non-cash transactions with its directors or persons connected to its directors and hence reporting under clause 3(xv) of the order is not applicable to the Company.`,
  16: `(a) The company is not required to be registered under section 45-IA of the Reserve Bank of India Act, 1934. Accordingly, the reporting under Clause 3(xvi)(a) of the order is not applicable to the Company.\n(b) The company has not conducted non-banking financial /housing finance activities during the year. Accordingly, the reporting under Clause 3(xvi)(b) of the order is not applicable to the company.\n(c) The company is not a Core investment Company (CIC) as defined in the regulations made by the Reserve Bank of India. Accordingly, the reporting under Clause 3(xvi)(c) of the order is not applicable to the Company.\n(d) There is no Core Investment Company as a part of the Group, hence, the requirement to report on clause 3(xvi)(d) of the order is not applicable to the company.`,
  17: `The company has not incurred cash losses in the financial year and in the immediately preceding financial year, this para not applicable.`,
  18: `There has been no resignation of the statutory auditors during the year.`,
  19: `On the basis of the financial ratios disclosed in the financial Statements, ageing and expected dates of realization of financial assets and payment of financial liabilities, other information accompanying the financial Statements, our knowledge of the Board of Directors and management plans and based on our examination of the evidence supporting the assumptions, nothing has come to our attention, which causes us to believe that any material uncertainty exists as on the date of the audit report that Company is not capable of meeting its liabilities existing at the date of balance sheet as and when they fall due within a period of one year from the balance sheet date.`,
  20: `According to the information and explanations given to us, the company does not fulfil the criteria as specified under section 135(1) of the Act read with the Companies (Corporate Social Responsibility Policy) Rules, 2014 and accordingly reporting under clause 3(xx) of the order is not applicable to the company.`,
  21: `The reporting under Clause 3(xxi) of the order is not applicable in respect of audit of standalone financial statements. Accordingly, this clause is not applicable to the company.`,
};

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

    // Fetch global master templates to get current titles and default content
    const { data: masterData } = await supabase
      .from("caro_master_templates")
      .select("clause_number, clause_title, default_content, is_applicable_default")
      .is("firm_id", null)
      .order("clause_number");

    const masterMap = new Map<number, { title: string; content: string; applicable: boolean }>();
    (masterData || []).forEach((m: any) => {
      masterMap.set(m.clause_number, {
        title: m.clause_title,
        content: m.default_content || "",
        applicable: m.is_applicable_default ?? true,
      });
    });

    // Helper to get title from master → fallback
    const getTitle = (num: number) => masterMap.get(num)?.title || CARO_CLAUSES_FALLBACK[num] || `Clause ${num}`;
    const getContent = (num: number) => masterMap.get(num)?.content || CARO_DEFAULT_CONTENT[num] || "";
    const getApplicable = (num: number) => masterMap.get(num)?.applicable ?? true;

    const { data } = await supabase
      .from("audit_caro_responses")
      .select("*")
      .eq("engagement_id", engagement.id)
      .order("clause_number");

    if (data && data.length > 0) {
      // Use master title for display (always synced), auto-load default content into user_response if empty
      setRows(data.map((d: any) => {
        const defaultContent = getContent(d.clause_number);
        const userResp = d.user_response || "";
        // Auto-load: if user_response is empty but we have default content, pre-fill it
        const autoLoaded = !userResp && defaultContent ? defaultContent : userResp;
        return {
          id: d.id,
          clause_number: d.clause_number,
          clause_title: getTitle(d.clause_number),
          auto_draft: d.auto_draft || defaultContent || "",
          user_response: autoLoaded,
          status: d.status || (autoLoaded ? "drafted" : "not_started"),
          is_applicable: d.is_applicable ?? true,
          inapplicability_reason: d.inapplicability_reason || "",
          is_locked: d.is_locked || false,
        };
      }));
    } else {
      // Seed all 21 clauses from master templates — auto-fill user_response with default content
      const seeds = Array.from({ length: 21 }, (_, i) => i + 1).map(num => ({
        engagement_id: engagement.id,
        clause_number: num,
        clause_title: getTitle(num),
        auto_draft: getContent(num),
        user_response: getContent(num), // Pre-fill user response with default
        status: getContent(num) ? "drafted" : "not_started",
        is_applicable: getApplicable(num),
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
          clause_title: r.clause_title, // sync title back to DB
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
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="gap-1">
                <Download className="w-4 h-4" /> Export
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => {
                const el = document.getElementById('caro-print-area');
                if (el) {
                  el.style.display = 'block';
                  exportToPdf(el, `CARO-2020_${client?.name || 'report'}_${engagement?.financial_year || ''}.pdf`).then(() => {
                    el.style.display = 'none';
                  });
                }
              }}>
                <Download className="h-4 w-4 mr-2" /> Export PDF
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => {
                // Reuse same HTML structure as PDF print area for consistent formatting
                let html = `<h1 style="text-align:center;font-size:16pt;margin-bottom:16px;">CARO 2020 — Auditor's Report</h1>`;
                rows.forEach(r => {
                  html += `<div style="margin-bottom:16px;padding-bottom:12px;border-bottom:1px solid #ddd;page-break-inside:avoid;">`;
                  html += `<h3 style="font-size:12pt;font-weight:bold;margin-bottom:4px;">Clause ${r.clause_number} — ${r.clause_title}</h3>`;
                  if (!r.is_applicable) {
                    html += `<p style="color:#888;font-style:italic;">Not Applicable${r.inapplicability_reason ? ` — ${r.inapplicability_reason}` : ''}</p>`;
                  } else {
                    const text = (r.user_response || r.auto_draft || 'No response').replace(/\n/g, '<br/>');
                    html += `<p style="white-space:pre-wrap;font-size:10pt;">${text}</p>`;
                  }
                  html += `</div>`;
                });
                exportToWord(html, `CARO-2020_${client?.name || 'report'}_${engagement?.financial_year || ''}.doc`);
              }}>
                <FileType className="h-4 w-4 mr-2" /> Export Word
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
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
                  {row.user_response && (
                    <p className="text-[10px] text-muted-foreground italic">Default content loaded — you can edit below</p>
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
      {/* Hidden print area for PDF export */}
      <div id="caro-print-area" style={{ display: 'none', padding: '32px', fontFamily: 'Arial, sans-serif', fontSize: '11pt' }}>
        <h1 style={{ textAlign: 'center', fontSize: '16pt', marginBottom: '24px' }}>CARO 2020 — Auditor's Report</h1>
        {rows.map(r => (
          <div key={r.clause_number} style={{ marginBottom: '16px', paddingBottom: '12px', borderBottom: '1px solid #ddd', pageBreakInside: 'avoid' }}>
            <h3 style={{ fontSize: '12pt', fontWeight: 'bold', marginBottom: '4px' }}>
              Clause {r.clause_number} — {r.clause_title}
            </h3>
            {!r.is_applicable ? (
              <p style={{ color: '#888', fontStyle: 'italic' }}>Not Applicable{r.inapplicability_reason ? ` — ${r.inapplicability_reason}` : ''}</p>
            ) : (
              <p style={{ whiteSpace: 'pre-wrap', fontSize: '10pt' }}>{r.user_response || r.auto_draft || 'No response'}</p>
            )}
          </div>
        ))}
        <p style={{ textAlign: 'center', fontSize: '8pt', color: '#999', marginTop: '24px', borderTop: '1px solid #ccc', paddingTop: '8px' }}>
          {new Date().toLocaleDateString("en-IN")}
        </p>
      </div>
    </div>
  );
}
