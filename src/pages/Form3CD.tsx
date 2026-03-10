import { useState, useEffect, useRef } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useAuditTracker } from "@/hooks/useAuditTracker";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { Save, Wand2, FileText, Loader2, Sparkles } from "lucide-react";

const CLAUSES_3CD = [
  { no: "1", topic: "Name of the assessee" },
  { no: "2", topic: "Address" },
  { no: "3", topic: "PAN" },
  { no: "4", topic: "Whether the assessee is liable to pay indirect tax" },
  { no: "5", topic: "Status of the assessee" },
  { no: "6", topic: "Previous year and assessment year" },
  { no: "7(a)", topic: "Firm or AOP - Names of partners/members and profit sharing ratio" },
  { no: "7(b)", topic: "Changes in partners/members during the year" },
  { no: "8", topic: "Nature of business or profession" },
  { no: "9(a)", topic: "If Section 44AB applicable, relevant clause" },
  { no: "9(b)", topic: "Turnover/gross receipts" },
  { no: "10", topic: "Books of account prescribed u/s 44AA" },
  { no: "11", topic: "Books of account maintained" },
  { no: "12", topic: "Method of accounting employed" },
  { no: "13(a)", topic: "Method of valuation of closing stock" },
  { no: "13(b)", topic: "Deviation from method of valuation prescribed u/s 145A" },
  { no: "13(d)", topic: "Details of deviation in stock valuation" },
  { no: "14", topic: "Capital account of partners - additions, withdrawals" },
  { no: "15", topic: "Increase in partners' capital from income of undisclosed sources" },
  { no: "16(a)", topic: "Amounts debited to P&L not allowable u/s 36" },
  { no: "16(b)", topic: "Amounts debited to P&L not allowable u/s 37" },
  { no: "17", topic: "Amounts admissible under sections 30 to 36" },
  { no: "18", topic: "Particulars of depreciation allowable" },
  { no: "19", topic: "Amounts admissible under sections 33AB, 33ABA, 33AC" },
  { no: "20", topic: "Deduction under Chapter VI-A" },
  { no: "21(a)", topic: "Tax deducted at source - particulars" },
  { no: "21(b)", topic: "Tax collected at source - particulars" },
  { no: "21(c)", topic: "Payment exceeding prescribed limit - Sec 40A(3)" },
  { no: "21(d)", topic: "Deemed income u/s 40A(3A)" },
  { no: "22", topic: "Payment to persons specified in Sec 40A(2)(b)" },
  { no: "23", topic: "Payment of interest - Sec 40(b)(iv)" },
  { no: "24", topic: "Disallowance/deemed income under section 40/40A" },
  { no: "25", topic: "Deemed income u/s 32AC, 33AB, 33ABA, 33AC" },
  { no: "26", topic: "Amount of income u/s 56(2) undisclosed investments" },
  { no: "27(a)", topic: "Amounts of section 28 income" },
  { no: "27(b)", topic: "Details of income not credited to P&L" },
  { no: "28", topic: "Whether income declared on presumptive basis (44AD/44ADA/44AE)" },
  { no: "29", topic: "Whether assessee has received foreign remittances" },
  { no: "30(a)", topic: "Primary adjustment to transfer price (Sec 92CE)" },
  { no: "30(b)", topic: "Excess money available with AE" },
  { no: "30(c)", topic: "Deemed interest on excess money" },
  { no: "31", topic: "Particulars of TDS compliance" },
  { no: "32", topic: "Receipts chargeable to tax under head 'Business'" },
  { no: "33", topic: "Profit and gains from conversion of assets" },
  { no: "34(a)", topic: "Whether accounting standards prescribed u/s 145 followed" },
  { no: "34(b)", topic: "Deviations from accounting standards and effect" },
  { no: "35", topic: "Details of brought forward losses and unabsorbed depreciation" },
  { no: "36", topic: "Sections 269SS/269T - cash receipt/repayment" },
  { no: "36A", topic: "Report under section 92E for international transactions" },
  { no: "37", topic: "Whether assessee is required to furnish transfer pricing report" },
  { no: "38", topic: "Whether assessee has entered into impermissible avoidance arrangement" },
  { no: "39", topic: "Details of filing Form No. 61/61A/61B" },
  { no: "40", topic: "Whether assessee has received income from a country outside India" },
  { no: "41", topic: "Details of demand raised or refund issued under GST" },
  { no: "42", topic: "Whether turnover exceeds Rs 10 crore - cash receipts/payments" },
  { no: "43", topic: "Break-up of total expenditure incurred during the year" },
  { no: "44", topic: "Expenditure by way of 'fees for technical services' chargeable u/s 56" },
];

const AUTO_FILL_MAP: Record<string, string[]> = {
  "21(c)": ["C01"],
  "24": ["C04"],
  "25": ["C05"],
  "26": ["C02"],
  "31": ["T01", "T05"],
};

export default function Form3CD() {
  const { clientId } = useParams<{ clientId: string }>();
  const { user } = useAuth();
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [statuses, setStatuses] = useState<Record<string, string>>({});
  const [findings, setFindings] = useState<any[]>([]);
  const [engagement, setEngagement] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [autoFilling, setAutoFilling] = useState(false);
  const [tdsEntries, setTdsEntries] = useState<any[]>([]);

  useEffect(() => {
    if (!clientId) return;
    loadData();
  }, [clientId]);

  async function loadData() {
    const [findingsRes, engRes, tdsRes] = await Promise.all([
      supabase.from("scrutiny_findings").select("*").eq("client_id", clientId!),
      supabase.from("audit_engagements").select("*").eq("client_id", clientId!).order("financial_year", { ascending: false }).limit(1),
      supabase.from("tds_entries").select("*").eq("client_id", clientId!),
    ]);
    setFindings(findingsRes.data || []);
    setTdsEntries(tdsRes.data || []);
    if (engRes.data?.[0]) {
      setEngagement(engRes.data[0]);
      const form3cd = engRes.data[0].form_3cd as Record<string, any> | null;
      if (form3cd) {
        const ans: Record<string, string> = {};
        const sts: Record<string, string> = {};
        for (const [k, v] of Object.entries(form3cd)) {
          if (typeof v === "object" && v !== null && "answer" in v) {
            ans[k] = (v as any).answer || "";
            sts[k] = (v as any).status || "Empty";
          } else {
            ans[k] = String(v || "");
          }
        }
        setAnswers(ans);
        setStatuses(sts);
      }
    }
  }

  function getAutoFillRules(clauseNo: string): string[] {
    return AUTO_FILL_MAP[clauseNo] || [];
  }

  function hasAutoFill(clauseNo: string): boolean {
    return getAutoFillRules(clauseNo).length > 0;
  }

  async function autoFillAll() {
    setAutoFilling(true);
    const newAnswers = { ...answers };

    // Clause 21(c) — Cash payments
    const c01 = findings.filter(f => f.rule_id === "C01");
    if (c01.length > 0) {
      newAnswers["21(c)"] = c01.map(f => f.flag_message).join("\n");
    }

    // Clause 24
    const c04 = findings.filter(f => f.rule_id === "C04");
    if (c04.length > 0) {
      newAnswers["24"] = c04.map(f => f.flag_message).join("\n");
    }

    // Clause 25
    const c05 = findings.filter(f => f.rule_id === "C05");
    if (c05.length > 0) {
      newAnswers["25"] = c05.map(f => f.flag_message).join("\n");
    }

    // Clause 26
    const c02 = findings.filter(f => f.rule_id === "C02");
    if (c02.length > 0) {
      newAnswers["26"] = c02.map(f => f.flag_message).join("\n");
    }

    // Clause 31 — TDS summary
    if (tdsEntries.length > 0) {
      const sectionSummary: Record<string, { count: number; amount: number; tds: number }> = {};
      for (const t of tdsEntries) {
        const sec = t.section || "Unknown";
        if (!sectionSummary[sec]) sectionSummary[sec] = { count: 0, amount: 0, tds: 0 };
        sectionSummary[sec].count++;
        sectionSummary[sec].amount += Number(t.amount || 0);
        sectionSummary[sec].tds += Number(t.tds_amount || 0);
      }
      newAnswers["31"] = Object.entries(sectionSummary)
        .map(([sec, d]) => `Section ${sec}: ${d.count} entries, Amount Rs ${d.amount.toLocaleString("en-IN")}, TDS Rs ${d.tds.toLocaleString("en-IN")}`)
        .join("\n");
    }

    setAnswers(newAnswers);
    setAutoFilling(false);
    toast.success("Auto-filled available clauses from scrutiny findings and TDS data");
  }

  async function saveDraft() {
    if (!engagement) {
      toast.error("No audit engagement found for this client");
      return;
    }
    setSaving(true);
    const form3cd: Record<string, any> = {};
    for (const clause of CLAUSES_3CD) {
      form3cd[clause.no] = {
        answer: answers[clause.no] || "",
        status: answers[clause.no]?.trim() ? (statuses[clause.no] || "Draft") : "Empty",
      };
    }
    const { error } = await supabase
      .from("audit_engagements")
      .update({ form_3cd: form3cd } as any)
      .eq("id", engagement.id);

    setSaving(false);
    if (error) toast.error("Failed to save: " + error.message);
    else toast.success("Form 3CD draft saved");
  }

  function getStatus(clauseNo: string): string {
    if (statuses[clauseNo]) return statuses[clauseNo];
    return answers[clauseNo]?.trim() ? "Draft" : "Empty";
  }

  const statusColors: Record<string, string> = {
    Empty: "bg-muted text-muted-foreground",
    Draft: "bg-amber-100 text-amber-800",
    Approved: "bg-green-100 text-green-800",
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Form 3CD — Tax Audit Report</h1>
          <p className="text-sm text-muted-foreground">Statement of particulars required under section 44AB</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={autoFillAll} disabled={autoFilling}>
            {autoFilling ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Wand2 className="h-4 w-4 mr-2" />}
            Auto-fill All Available
          </Button>
          <Button onClick={saveDraft} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
            Save Draft
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-20">Clause</TableHead>
                <TableHead className="w-64">Topic</TableHead>
                <TableHead>Answer</TableHead>
                <TableHead className="w-36">Badges</TableHead>
                <TableHead className="w-24">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {CLAUSES_3CD.map((clause) => (
                <TableRow key={clause.no}>
                  <TableCell className="font-mono text-sm font-medium">{clause.no}</TableCell>
                  <TableCell className="text-sm">{clause.topic}</TableCell>
                  <TableCell>
                    <Textarea
                      value={answers[clause.no] || ""}
                      onChange={(e) => setAnswers(prev => ({ ...prev, [clause.no]: e.target.value }))}
                      className="min-h-[72px] text-sm"
                      placeholder="Enter answer..."
                    />
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-1">
                      {hasAutoFill(clause.no) && (
                        <Badge variant="outline" className="text-xs bg-amber-50 text-amber-700 border-amber-200">
                          Auto-fill
                        </Badge>
                      )}
                      <Badge variant="outline" className="text-xs bg-blue-50 text-blue-700 border-blue-200">
                        <Sparkles className="h-3 w-3 mr-1" />AI
                      </Badge>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge className={statusColors[getStatus(clause.no)] || statusColors.Empty}>
                      {getStatus(clause.no)}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
