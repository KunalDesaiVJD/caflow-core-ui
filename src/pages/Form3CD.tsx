import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { Save, Printer, Plus, Trash2, Loader2, CheckCircle2, Circle } from "lucide-react";
import { SECTOR_CODES } from "@/data/sectorCodes";

/* ──────── types ──────── */
interface ClauseData { [key: string]: any; }
interface Form3CDRow {
  id: string;
  engagement_id: string;
  firm_id: string;
  client_id: string;
  financial_year: string;
  assessment_year: string;
  status: string;
  [key: string]: any;
}

/* ──────── clause meta ──────── */
const CLAUSE_NAV = [
  { key: "cl_8", label: "8", title: "Relevant clause of section 44AB" },
  { key: "cl_9", label: "9", title: "Books of Account" },
  { key: "cl_10", label: "10", title: "Nature of Business (Sector/Code)" },
  { key: "cl_11", label: "11", title: "Method of Accounting" },
  { key: "cl_12", label: "12", title: "Capital Assets Converted to Stock" },
  { key: "cl_13", label: "13", title: "Speculative Transactions & ICDS" },
  { key: "cl_14", label: "14", title: "Method of Valuation" },
  { key: "cl_15_16", label: "15-16", title: "Amounts debited to P&L" },
  { key: "cl_17", label: "17", title: "Dual deduction / amounts debited twice" },
  { key: "cl_18", label: "18", title: "Depreciation allowable" },
  { key: "cl_19", label: "19", title: "Amounts not deductible u/s 40(a)" },
  { key: "cl_20", label: "20", title: "Amounts inadmissible u/s 40A" },
  { key: "cl_21", label: "21", title: "Amounts allowable on payment basis" },
  { key: "cl_22", label: "22", title: "Personal expenditure" },
  { key: "cl_23", label: "23", title: "Payments to specified persons" },
  { key: "cl_24_25", label: "24-25", title: "Deemed profits / chargeable amounts" },
  { key: "cl_26", label: "26", title: "Loss/expenditure disallowable" },
  { key: "cl_27", label: "27", title: "Deemed income / prior period items" },
  { key: "cl_29", label: "29", title: "Deemed profits u/s 32AC/33AB/41" },
  { key: "cl_30", label: "30", title: "Govt receipts / MSME / Tax paid / Hundi" },
  { key: "cl_31", label: "31", title: "TDS / TCS particulars" },
  { key: "cl_32", label: "32", title: "Brought forward losses / deductions" },
  { key: "cl_33", label: "33", title: "Deductions u/s 80G/80GGA/80GGB/80GGC" },
  { key: "cl_34", label: "34", title: "TDS/TCS compliance" },
  { key: "cl_35", label: "35", title: "Brought forward losses" },
  { key: "cl_36", label: "36", title: "Sec 269SS/269T compliance" },
  { key: "cl_37_39", label: "37-39", title: "Transfer pricing / GAAR" },
  { key: "cl_40", label: "40", title: "Foreign income" },
  { key: "cl_41", label: "41", title: "GST demand/refund" },
  { key: "cl_42_43", label: "42-43", title: "Cash receipts / Expenditure" },
  { key: "cl_44", label: "44", title: "Fees for technical services" },
];

const SECTION_44AB_OPTIONS = [
  "44AB(a) — Business turnover > ₹1 Cr",
  "44AB(b) — Professional receipts > ₹50 Lakhs",
  "44AB(c) — Profit lower than presumptive",
  "44AB(d) — Loss from presumptive business",
  "Third Proviso to sec 44AB: Audited under any other law",
];

const TAXATION_SCHEME_OPTIONS = ["115BA", "115BAA", "115BAB", "115BAC", "115BAD", "115BAE"];

const STOCK_VALUATION_OPTIONS = [
  "Cost or Market Value whichever is lower", "Cost", "Market Value", "Other (specify)",
];

const STOCK_VALUATION_14_OPTIONS = [
  "FIFO", "Weighted Average", "Specific Identification", "Standard Cost", "Market Value", "Other",
];

const ICDS_LIST = [
  "ICDS I — Accounting Policies", "ICDS II — Valuation of Inventories",
  "ICDS III — Construction Contracts", "ICDS IV — Revenue Recognition",
  "ICDS V — Tangible Fixed Assets", "ICDS VI — Effects of Changes in Foreign Exchange Rates",
  "ICDS VII — Government Grants", "ICDS VIII — Securities",
  "ICDS IX — Borrowing Costs", "ICDS X — Provisions, Contingent Liabilities and Contingent Assets",
];

const SECTION_40A_OPTIONS = [
  "40(a)(i)", "40(a)(ia)", "40(a)(ib)", "40(a)(ii)", "40(a)(iia)", "40(a)(iii)", "40(a)(iv)", "40(a)(v)",
];

const LIABILITY_NATURE_OPTIONS = [
  "Interest", "Penalty", "Fine", "Litigation expenses", "Contribution to political party", "Other",
];

const SECTION_43B_OPTIONS = ["43B(a)", "43B(b)", "43B(c)", "43B(d)", "43B(e)", "43B(f)", "43B(h)"];

const LOSS_NATURE_OPTIONS = ["Business Loss", "Speculation Loss", "Capital Loss", "House Property Loss", "Other"];

const DONATION_SECTION_OPTIONS = ["80G", "80GGA", "80GGB", "80GGC"];

const TDS_SECTIONS: Record<string, string> = {
  "192": "Salary", "192A": "PF Withdrawal", "193": "Interest on Securities", "194": "Dividend",
  "194A": "Interest other than Securities", "194B": "Lottery Winnings", "194BB": "Horse Race Winnings",
  "194C": "Contractor Payments", "194D": "Insurance Commission", "194DA": "Life Insurance Maturity",
  "194E": "Non-resident Sportsman", "194EE": "NSS Payments", "194F": "Repurchase by Mutual Fund",
  "194G": "Commission on Lottery", "194H": "Commission/Brokerage", "194I": "Rent",
  "194IA": "Transfer of Immovable Property", "194IB": "Rent by Individual",
  "194IC": "Joint Development Agreement", "194J": "Professional/Technical Fees",
  "194K": "Income from Units", "194LA": "Compensation on Compulsory Acquisition",
  "194LB": "Interest from Infrastructure Bond", "194LC": "Interest from Indian Company",
  "194LD": "Interest on Rupee Bond", "194M": "Payment by Individual/HUF to Contractor",
  "194N": "Cash Withdrawal", "194O": "E-commerce", "194P": "Senior Citizen",
  "194Q": "Purchase of Goods", "194R": "Benefit/Perquisite", "194S": "Cryptocurrency",
  "195": "Non-resident Payments", "196B": "Income from offshore fund",
  "196C": "Income from foreign currency bonds", "196D": "Income of FII from securities",
};

const TDS_SECTION_KEYS = Object.keys(TDS_SECTIONS);

/* ──────── helpers ──────── */
function computeAY(fy: string | null): string {
  if (!fy) return "";
  const match = fy.match(/(\d{4})/);
  if (!match) return "";
  const startYear = parseInt(match[1]);
  return `${startYear + 1}-${String(startYear + 2).slice(2)}`;
}

function isClauseFilled(data: ClauseData | undefined): boolean {
  if (!data || Object.keys(data).length === 0) return false;
  return Object.values(data).some(v => {
    if (typeof v === "string") return v.trim().length > 0;
    if (Array.isArray(v)) return v.length > 0;
    if (typeof v === "boolean") return true;
    if (typeof v === "number") return true;
    if (typeof v === "object" && v !== null) return Object.keys(v).length > 0;
    return false;
  });
}

// All clause keys for state management
const CLAUSE_KEYS = [
  "cl_8","cl_9","cl_10","cl_11","cl_12","cl_13",
  "cl_14","cl_15_16","cl_17","cl_18","cl_19","cl_20","cl_21","cl_22",
  "cl_23","cl_24_25","cl_26","cl_27","cl_29","cl_30","cl_31","cl_32","cl_33","cl_34",
] as const;

/* ──────── main component ──────── */
export default function Form3CD() {
  const [searchParams] = useSearchParams();
  const engagementId = searchParams.get("engagementId");
  const { user } = useAuth();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [engagement, setEngagement] = useState<any>(null);
  const [client, setClient] = useState<any>(null);
  const [formRow, setFormRow] = useState<Form3CDRow | null>(null);
  const [formStatus, setFormStatus] = useState<string>("draft");

  // Clause data states
  const [cl8, setCl8] = useState<ClauseData>({});
  const [cl9, setCl9] = useState<ClauseData>({});
  const [cl10, setCl10] = useState<ClauseData>({});
  const [cl11, setCl11] = useState<ClauseData>({});
  const [cl12, setCl12] = useState<ClauseData>({});
  const [cl13, setCl13] = useState<ClauseData>({});
  const [cl14, setCl14] = useState<ClauseData>({});
  const [cl15_16, setCl15_16] = useState<ClauseData>({});
  const [cl17, setCl17] = useState<ClauseData>({});
  const [cl18, setCl18] = useState<ClauseData>({});
  const [cl19, setCl19] = useState<ClauseData>({});
  const [cl20, setCl20] = useState<ClauseData>({});
  const [cl21, setCl21] = useState<ClauseData>({});
  const [cl22, setCl22] = useState<ClauseData>({});

  const clauseStateMap: Record<string, ClauseData> = {
    cl_8: cl8, cl_9: cl9, cl_10: cl10, cl_11: cl11, cl_12: cl12, cl_13: cl13,
    cl_14: cl14, cl_15_16: cl15_16, cl_17: cl17, cl_18: cl18,
    cl_19: cl19, cl_20: cl20, cl_21: cl21, cl_22: cl22,
  };

  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});

  useEffect(() => {
    if (!engagementId) { setLoading(false); return; }
    loadData();
  }, [engagementId]);

  async function loadData() {
    setLoading(true);
    const { data: eng } = await supabase
      .from("audit_engagements")
      .select("*, clients(*)")
      .eq("id", engagementId!)
      .single();

    if (!eng) { setLoading(false); toast.error("Engagement not found"); return; }
    setEngagement(eng);
    setClient((eng as any).clients);

    const { data: existing } = await supabase
      .from("form_3cd" as any)
      .select("*")
      .eq("engagement_id", engagementId!)
      .maybeSingle();

    if (existing) {
      const e = existing as any;
      setFormRow(e);
      setFormStatus(e.status || "draft");
      setCl8(e.cl_8 || {}); setCl9(e.cl_9 || {}); setCl10(e.cl_10 || {});
      setCl11(e.cl_11 || {}); setCl12(e.cl_12 || {}); setCl13(e.cl_13 || {});
      setCl14(e.cl_14 || {}); setCl15_16(e.cl_15_16 || {}); setCl17(e.cl_17 || {});
      setCl18(e.cl_18 || {}); setCl19(e.cl_19 || {}); setCl20(e.cl_20 || {});
      setCl21(e.cl_21 || {}); setCl22(e.cl_22 || {});
    } else {
      const fy = eng.financial_year || "";
      const ay = computeAY(fy);
      const { data: created } = await supabase
        .from("form_3cd" as any)
        .insert({
          engagement_id: engagementId, firm_id: eng.firm_id,
          client_id: eng.client_id, financial_year: fy,
          assessment_year: ay, status: "draft",
        } as any)
        .select().single();
      if (created) setFormRow(created as any);
    }
    setLoading(false);
  }

  const triggerAutoSave = useCallback(() => {
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(() => saveAll(true), 3000);
  }, [formRow]);

  function updateClause(setter: React.Dispatch<React.SetStateAction<ClauseData>>, key: string, value: any) {
    setter(prev => {
      const next = { ...prev, [key]: value };
      triggerAutoSave();
      return next;
    });
  }

  async function saveAll(silent = false) {
    if (!formRow) return;
    setSaving(true);
    const { error } = await supabase
      .from("form_3cd" as any)
      .update({
        cl_8: cl8, cl_9: cl9, cl_10: cl10, cl_11: cl11, cl_12: cl12, cl_13: cl13,
        cl_14: cl14, cl_15_16: cl15_16, cl_17: cl17, cl_18: cl18,
        cl_19: cl19, cl_20: cl20, cl_21: cl21, cl_22: cl22,
        status: formStatus,
        last_saved_at: new Date().toISOString(),
        last_saved_by: user?.id,
      } as any)
      .eq("id", formRow.id);
    setSaving(false);
    if (error) { if (!silent) toast.error("Save failed: " + error.message); }
    else { if (!silent) toast.success("Form 3CD saved"); }
  }

  function scrollToClause(key: string) {
    sectionRefs.current[key]?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const fy = engagement?.financial_year || "";
  const ay = computeAY(fy);

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>;
  if (!engagementId) return <div className="p-8 text-center text-muted-foreground">Please open Form 3CD from an engagement pipeline (Stage 8).</div>;

  // Implemented clause keys
  const implementedKeys = new Set(CLAUSE_KEYS);

  return (
    <div className="flex gap-0 h-[calc(100vh-4rem)]">
      {/* LEFT SIDEBAR NAV */}
      <div className="w-56 shrink-0 border-r bg-muted/30">
        <ScrollArea className="h-full">
          <div className="p-3 space-y-0.5">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Clauses</p>
            {CLAUSE_NAV.map(c => {
              const filled = implementedKeys.has(c.key as any) ? isClauseFilled(clauseStateMap[c.key]) : false;
              return (
                <button
                  key={c.key}
                  onClick={() => scrollToClause(c.key)}
                  className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-left text-xs hover:bg-accent transition-colors"
                >
                  {filled
                    ? <CheckCircle2 className="h-3 w-3 text-green-500 shrink-0" />
                    : <Circle className="h-3 w-3 text-muted-foreground/40 shrink-0" />}
                  <span className="font-mono text-[11px] text-muted-foreground w-6">{c.label}</span>
                  <span className="truncate">{c.title}</span>
                </button>
              );
            })}
          </div>
        </ScrollArea>
      </div>

      {/* MAIN CONTENT */}
      <div className="flex-1 overflow-y-auto">
        {/* TOP BAR */}
        <div className="sticky top-0 z-10 bg-background border-b px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-bold">Form 3CD — Tax Audit Report u/s 44AB</h1>
            <Badge variant={formStatus === "locked" ? "destructive" : formStatus === "complete" ? "default" : "secondary"}>
              {formStatus === "locked" ? "Locked" : formStatus === "complete" ? "Complete" : "Draft"}
            </Badge>
            {saving && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => window.print()}>
              <Printer className="h-4 w-4 mr-1" /> Print / Export
            </Button>
            <Button size="sm" onClick={() => saveAll(false)} disabled={saving}>
              <Save className="h-4 w-4 mr-1" /> Save All
            </Button>
          </div>
        </div>

        <div className="p-6 max-w-5xl mx-auto space-y-8">
          {/* HEADER BLOCK */}
          <Card>
            <CardContent className="p-6 space-y-4">
              <div className="text-center space-y-1">
                <p className="text-xs font-semibold text-muted-foreground uppercase">FORM NO. 3CD</p>
                <p className="text-xs text-muted-foreground">[See rule 6G(2)]</p>
                <p className="text-sm font-medium">Statement of particulars required to be furnished under section 44AB of the Income-tax Act, 1961</p>
              </div>
              <Separator />
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div><span className="text-muted-foreground">Name of the Assessee:</span> <strong>{client?.name || "—"}</strong></div>
                <div><span className="text-muted-foreground">PAN:</span> <strong>{client?.pan || "—"}</strong></div>
                <div><span className="text-muted-foreground">GSTIN:</span> <strong>{(client?.gstin || []).join(", ") || "—"}</strong></div>
                <div><span className="text-muted-foreground">Status (Entity Type):</span> <strong>{client?.entity_type || engagement?.entity_type || "—"}</strong></div>
                <div><span className="text-muted-foreground">Previous Year:</span> <strong>{fy || "—"}</strong></div>
                <div><span className="text-muted-foreground">Assessment Year:</span> <strong>{ay || "—"}</strong></div>
              </div>
            </CardContent>
          </Card>

          {/* CLAUSES */}
          <Accordion type="multiple" defaultValue={["cl_8"]} className="space-y-4">
            {/* ═══════ CLAUSE 8 ═══════ */}
            <div ref={el => { sectionRefs.current["cl_8"] = el; }}>
              <AccordionItem value="cl_8" className="border rounded-lg">
                <AccordionTrigger className="px-4">
                  <div className="flex items-center gap-3">
                    <Badge variant="outline" className="font-mono text-xs">8</Badge>
                    <span className="font-medium">Indicate the relevant clause of section 44AB</span>
                    {isClauseFilled(cl8) && <Badge className="bg-green-100 text-green-800 text-[10px]">Filled</Badge>}
                  </div>
                </AccordionTrigger>
                <AccordionContent className="px-4 pb-4 space-y-4">
                  <div className="space-y-2">
                    <Label>Relevant Clause of Section 44AB</Label>
                    <Select value={cl8.section44ab || ""} onValueChange={v => updateClause(setCl8, "section44ab", v)}>
                      <SelectTrigger><SelectValue placeholder="Select applicable clause" /></SelectTrigger>
                      <SelectContent>
                        {SECTION_44AB_OPTIONS.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <Separator />
                  <div className="space-y-2">
                    <Label>8(a) Whether the assessee has opted for taxation u/s 115BA / 115BAA / 115BAB / 115BAC / 115BAD / 115BAE?</Label>
                    <div className="flex gap-4">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input type="radio" name="cl8_opted" checked={cl8.optedScheme === true} onChange={() => updateClause(setCl8, "optedScheme", true)} /> Yes
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input type="radio" name="cl8_opted" checked={cl8.optedScheme === false} onChange={() => updateClause(setCl8, "optedScheme", false)} /> No
                      </label>
                    </div>
                  </div>
                  {cl8.optedScheme === true && (
                    <div className="space-y-2">
                      <Label>Section under which option exercised</Label>
                      <Select value={cl8.schemeSection || ""} onValueChange={v => updateClause(setCl8, "schemeSection", v)}>
                        <SelectTrigger><SelectValue placeholder="Select section" /></SelectTrigger>
                        <SelectContent>
                          {TAXATION_SCHEME_OPTIONS.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  {cl8.optedScheme === false && (
                    <div className="p-3 bg-muted rounded text-sm text-muted-foreground">Taxation scheme options not applicable.</div>
                  )}
                </AccordionContent>
              </AccordionItem>
            </div>

            {/* ═══════ CLAUSE 9 ═══════ */}
            <div ref={el => { sectionRefs.current["cl_9"] = el; }}>
              <AccordionItem value="cl_9" className="border rounded-lg">
                <AccordionTrigger className="px-4">
                  <div className="flex items-center gap-3">
                    <Badge variant="outline" className="font-mono text-xs">9</Badge>
                    <span className="font-medium">Books of Account</span>
                    {isClauseFilled(cl9) && <Badge className="bg-green-100 text-green-800 text-[10px]">Filled</Badge>}
                  </div>
                </AccordionTrigger>
                <AccordionContent className="px-4 pb-4 space-y-4">
                  <div className="space-y-2">
                    <Label>9(a) Whether books of account prescribed u/s 44AA are maintained?</Label>
                    <div className="flex gap-4">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input type="radio" name="cl9a" checked={cl9.booksApplicable === true} onChange={() => updateClause(setCl9, "booksApplicable", true)} /> Applicable
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input type="radio" name="cl9a" checked={cl9.booksApplicable === false} onChange={() => updateClause(setCl9, "booksApplicable", false)} /> Not Applicable
                      </label>
                    </div>
                    {cl9.booksApplicable === true && (
                      <div className="space-y-2 mt-2">
                        <Label>Address at which books of account are kept</Label>
                        <Textarea value={cl9.booksAddress || ""} onChange={e => updateClause(setCl9, "booksAddress", e.target.value)} placeholder="Enter address..." />
                      </div>
                    )}
                    {cl9.booksApplicable === false && (
                      <div className="p-3 bg-muted rounded text-sm text-muted-foreground">N/A</div>
                    )}
                  </div>
                  <Separator />
                  <div className="space-y-2">
                    <Label>9(b) Whether books of account have been examined?</Label>
                    <div className="flex gap-4">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input type="radio" name="cl9b" checked={cl9.booksExamined === true} onChange={() => updateClause(setCl9, "booksExamined", true)} /> Yes
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input type="radio" name="cl9b" checked={cl9.booksExamined === false} onChange={() => updateClause(setCl9, "booksExamined", false)} /> No
                      </label>
                    </div>
                    {cl9.booksExamined === true && (
                      <div className="mt-2 space-y-2">
                        <Label>Details of books examined</Label>
                        <EditableTable
                          columns={["Sr No", "Period From", "Period To", "Nature of Books", "Address"]}
                          rows={cl9.booksExaminedRows || []}
                          onChange={rows => updateClause(setCl9, "booksExaminedRows", rows)}
                        />
                      </div>
                    )}
                  </div>
                </AccordionContent>
              </AccordionItem>
            </div>

            {/* ═══════ CLAUSE 10 ═══════ */}
            <div ref={el => { sectionRefs.current["cl_10"] = el; }}>
              <AccordionItem value="cl_10" className="border rounded-lg">
                <AccordionTrigger className="px-4">
                  <div className="flex items-center gap-3">
                    <Badge variant="outline" className="font-mono text-xs">10</Badge>
                    <span className="font-medium">Nature of Business or Profession (Sector / Code)</span>
                    {isClauseFilled(cl10) && <Badge className="bg-green-100 text-green-800 text-[10px]">Filled</Badge>}
                  </div>
                </AccordionTrigger>
                <AccordionContent className="px-4 pb-4 space-y-4">
                  <div className="space-y-2">
                    <Label>10(a) Sector and Sub-sector Code</Label>
                    <SectorPicker
                      selectedSector={cl10.sector || ""}
                      selectedCode={cl10.subSectorCode || ""}
                      onSectorChange={v => { updateClause(setCl10, "sector", v); updateClause(setCl10, "subSectorCode", ""); }}
                      onCodeChange={v => updateClause(setCl10, "subSectorCode", v)}
                    />
                  </div>
                  <Separator />
                  <div className="space-y-2">
                    <Label>10(b) Whether engaged in more than one business or profession?</Label>
                    <div className="flex gap-4">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input type="radio" name="cl10b" checked={cl10.multiBusiness === true} onChange={() => updateClause(setCl10, "multiBusiness", true)} /> Yes
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input type="radio" name="cl10b" checked={cl10.multiBusiness === false} onChange={() => updateClause(setCl10, "multiBusiness", false)} /> No
                      </label>
                    </div>
                    {cl10.multiBusiness === true && (
                      <div className="mt-2">
                        <EditableTable
                          columns={["Sector", "Sub-sector Code", "Description"]}
                          rows={cl10.multiBusinessRows || []}
                          onChange={rows => updateClause(setCl10, "multiBusinessRows", rows)}
                        />
                      </div>
                    )}
                    {cl10.multiBusiness === false && (
                      <div className="p-3 bg-muted rounded text-sm text-muted-foreground">Single business — table not applicable.</div>
                    )}
                  </div>
                </AccordionContent>
              </AccordionItem>
            </div>

            {/* ═══════ CLAUSE 11 ═══════ */}
            <div ref={el => { sectionRefs.current["cl_11"] = el; }}>
              <AccordionItem value="cl_11" className="border rounded-lg">
                <AccordionTrigger className="px-4">
                  <div className="flex items-center gap-3">
                    <Badge variant="outline" className="font-mono text-xs">11</Badge>
                    <span className="font-medium">Method of Accounting</span>
                    {isClauseFilled(cl11) && <Badge className="bg-green-100 text-green-800 text-[10px]">Filled</Badge>}
                  </div>
                </AccordionTrigger>
                <AccordionContent className="px-4 pb-4 space-y-4">
                  <div className="space-y-2">
                    <Label>11(a) Whether method of accounting employed is the same as in the preceding year?</Label>
                    <RadioYesNo name="cl11a" value={cl11.sameMethod} onChange={v => updateClause(setCl11, "sameMethod", v)} />
                  </div>
                  <Separator />
                  <div className="space-y-2">
                    <Label>11(b) Effect on profit/loss due to change in method</Label>
                    <EditableTableWithTotal
                      columns={["Particulars", "Effect (Increase/Decrease)", "Amount (₹)"]}
                      rows={cl11.changeRows || []}
                      onChange={rows => updateClause(setCl11, "changeRows", rows)}
                      totalColIndex={2}
                    />
                  </div>
                  <Separator />
                  <div className="space-y-2">
                    <Label>11(c) Method of valuation of closing stock</Label>
                    <Select value={cl11.stockValuation || ""} onValueChange={v => updateClause(setCl11, "stockValuation", v)}>
                      <SelectTrigger><SelectValue placeholder="Select method" /></SelectTrigger>
                      <SelectContent>
                        {STOCK_VALUATION_OPTIONS.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    {cl11.stockValuation === "Other (specify)" && (
                      <Input value={cl11.stockValuationOther || ""} onChange={e => updateClause(setCl11, "stockValuationOther", e.target.value)} placeholder="Specify method..." className="mt-2" />
                    )}
                  </div>
                </AccordionContent>
              </AccordionItem>
            </div>

            {/* ═══════ CLAUSE 12 ═══════ */}
            <div ref={el => { sectionRefs.current["cl_12"] = el; }}>
              <AccordionItem value="cl_12" className="border rounded-lg">
                <AccordionTrigger className="px-4">
                  <div className="flex items-center gap-3">
                    <Badge variant="outline" className="font-mono text-xs">12</Badge>
                    <span className="font-medium">Capital Assets Converted to Stock in Trade</span>
                    {isClauseFilled(cl12) && <Badge className="bg-green-100 text-green-800 text-[10px]">Filled</Badge>}
                  </div>
                </AccordionTrigger>
                <AccordionContent className="px-4 pb-4 space-y-4">
                  <div className="space-y-2">
                    <Label>Whether any capital asset was converted into stock in trade?</Label>
                    <RadioYesNo name="cl12" value={cl12.converted} onChange={v => updateClause(setCl12, "converted", v)} />
                  </div>
                  {cl12.converted === true && (
                    <EditableTable
                      columns={["Description of Capital Asset", "Date of Acquisition", "Cost of Acquisition (₹)", "Amount at which Converted (₹)", "Date of Conversion"]}
                      rows={cl12.conversionRows || []}
                      onChange={rows => updateClause(setCl12, "conversionRows", rows)}
                    />
                  )}
                  {cl12.converted === false && <div className="p-3 bg-muted rounded text-sm text-muted-foreground">NIL</div>}
                </AccordionContent>
              </AccordionItem>
            </div>

            {/* ═══════ CLAUSE 13 ═══════ */}
            <div ref={el => { sectionRefs.current["cl_13"] = el; }}>
              <AccordionItem value="cl_13" className="border rounded-lg">
                <AccordionTrigger className="px-4">
                  <div className="flex items-center gap-3">
                    <Badge variant="outline" className="font-mono text-xs">13</Badge>
                    <span className="font-medium">Speculative Transactions & ICDS</span>
                    {isClauseFilled(cl13) && <Badge className="bg-green-100 text-green-800 text-[10px]">Filled</Badge>}
                  </div>
                </AccordionTrigger>
                <AccordionContent className="px-4 pb-4 space-y-6">
                  <div className="space-y-2">
                    <Label>13(a) Whether speculative business transactions are accounted separately?</Label>
                    <Select value={cl13.specSeparate || ""} onValueChange={v => updateClause(setCl13, "specSeparate", v)}>
                      <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="yes">Yes — Maintained separately</SelectItem>
                        <SelectItem value="no">No — Not maintained separately</SelectItem>
                        <SelectItem value="na">Not Applicable</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <Separator />
                  <div className="space-y-2">
                    <Label>13(b) Whether previous year method different from preceding year?</Label>
                    <RadioYesNo name="cl13b" value={cl13.methodDifferent} onChange={v => updateClause(setCl13, "methodDifferent", v)} />
                  </div>
                  {cl13.methodDifferent === true ? (
                    <div className="space-y-2">
                      <Label>13(c) Particulars of effect on profit/loss</Label>
                      <EditableTable columns={["Particulars", "Increase in Profit (₹)", "Decrease in Profit (₹)"]} rows={cl13.methodDiffRows || []} onChange={rows => updateClause(setCl13, "methodDiffRows", rows)} />
                    </div>
                  ) : cl13.methodDifferent === false ? (
                    <div className="p-3 bg-muted rounded text-sm text-muted-foreground">13(c) Not applicable — method unchanged.</div>
                  ) : null}
                  <Separator />
                  <div className="space-y-2">
                    <Label>13(d) Whether ICDS applicable and if so any deviation?</Label>
                    <RadioYesNo name="cl13d" value={cl13.icdsDeviation} onChange={v => updateClause(setCl13, "icdsDeviation", v)} />
                  </div>
                  {cl13.icdsDeviation === true ? (
                    <div className="space-y-2">
                      <Label>13(e) Details of ICDS deviation</Label>
                      <ICDSTable rows={cl13.icdsDeviationRows || []} onChange={rows => updateClause(setCl13, "icdsDeviationRows", rows)} />
                    </div>
                  ) : cl13.icdsDeviation === false ? (
                    <div className="p-3 bg-muted rounded text-sm text-muted-foreground">13(e) Not applicable — no ICDS deviation.</div>
                  ) : null}
                  <Separator />
                  <div className="space-y-2">
                    <Label>13(f) Whether any adjustment required as per ICDS?</Label>
                    <RadioApplicable name="cl13f" value={cl13.icdsAdjustment} onChange={v => updateClause(setCl13, "icdsAdjustment", v)} />
                  </div>
                  {cl13.icdsAdjustment === true ? (
                    <div className="space-y-2">
                      <Label>ICDS Adjustment Details</Label>
                      <EditableTable columns={["ICDS", "Net Adjustment (Increase) ₹", "Net Adjustment (Decrease) ₹"]} rows={cl13.icdsAdjustmentRows || []} onChange={rows => updateClause(setCl13, "icdsAdjustmentRows", rows)} />
                    </div>
                  ) : cl13.icdsAdjustment === false ? (
                    <div className="p-3 bg-muted rounded text-sm text-muted-foreground">No ICDS adjustments applicable.</div>
                  ) : null}
                </AccordionContent>
              </AccordionItem>
            </div>

            {/* ═══════ CLAUSE 14 — Method of Valuation ═══════ */}
            <div ref={el => { sectionRefs.current["cl_14"] = el; }}>
              <AccordionItem value="cl_14" className="border rounded-lg">
                <AccordionTrigger className="px-4">
                  <div className="flex items-center gap-3">
                    <Badge variant="outline" className="font-mono text-xs">14</Badge>
                    <span className="font-medium">Method of Valuation</span>
                    {isClauseFilled(cl14) && <Badge className="bg-green-100 text-green-800 text-[10px]">Filled</Badge>}
                  </div>
                </AccordionTrigger>
                <AccordionContent className="px-4 pb-4 space-y-4">
                  <div className="space-y-2">
                    <Label>14(a) Method of valuation of stock</Label>
                    <Select value={cl14.method || ""} onValueChange={v => updateClause(setCl14, "method", v)}>
                      <SelectTrigger><SelectValue placeholder="Select method" /></SelectTrigger>
                      <SelectContent>
                        {STOCK_VALUATION_14_OPTIONS.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <Separator />
                  <div className="space-y-2">
                    <Label>14(b) Whether method of valuation changed during the year?</Label>
                    <RadioYesNo name="cl14b" value={cl14.changed} onChange={v => updateClause(setCl14, "changed", v)} />
                  </div>
                  {cl14.changed === false && <div className="p-3 bg-muted rounded text-sm text-muted-foreground">NIL — No change in method.</div>}
                  {cl14.changed === true && (
                    <div className="space-y-2">
                      <Label>Effect on profit/loss</Label>
                      <EditableTable
                        columns={["Particulars", "Increase in Profit (₹)", "Decrease in Profit (₹)"]}
                        rows={cl14.changeRows || []}
                        onChange={rows => updateClause(setCl14, "changeRows", rows)}
                      />
                    </div>
                  )}
                </AccordionContent>
              </AccordionItem>
            </div>

            {/* ═══════ CLAUSES 15 & 16 — Amounts Debited to P&L ═══════ */}
            <div ref={el => { sectionRefs.current["cl_15_16"] = el; }}>
              <AccordionItem value="cl_15_16" className="border rounded-lg">
                <AccordionTrigger className="px-4">
                  <div className="flex items-center gap-3">
                    <Badge variant="outline" className="font-mono text-xs">15-16</Badge>
                    <span className="font-medium">Amounts Debited to Profit & Loss Account</span>
                    {isClauseFilled(cl15_16) && <Badge className="bg-green-100 text-green-800 text-[10px]">Filled</Badge>}
                  </div>
                </AccordionTrigger>
                <AccordionContent className="px-4 pb-4 space-y-6">
                  {[
                    { key: "cl15", label: "Clause 15 — Capital expenditure debited to P&L" },
                    { key: "cl16a", label: "16(a) — Personal expenses charged to P&L" },
                    { key: "cl16b", label: "16(b) — Amounts inadmissible u/s 40(a)" },
                    { key: "cl16c", label: "16(c) — Amounts inadmissible u/s 40A" },
                    { key: "cl16d", label: "16(d) — Payments to relatives u/s 40A(2)" },
                    { key: "cl16e", label: "16(e) — Expenditure on advertisement in political party journals" },
                  ].map(sub => (
                    <div key={sub.key} className="space-y-3 border-l-2 border-muted pl-4">
                      <Label className="font-medium">{sub.label}</Label>
                      <RadioApplicable
                        name={`cl15_16_${sub.key}`}
                        value={cl15_16[`${sub.key}_applicable`]}
                        onChange={v => updateClause(setCl15_16, `${sub.key}_applicable`, v)}
                      />
                      {cl15_16[`${sub.key}_applicable`] === true && (
                        <EditableTable
                          columns={["Sr No", "Particulars", "Amount (₹)", "Remarks"]}
                          rows={cl15_16[`${sub.key}_rows`] || []}
                          onChange={rows => updateClause(setCl15_16, `${sub.key}_rows`, rows)}
                        />
                      )}
                      {cl15_16[`${sub.key}_applicable`] === false && (
                        <div className="p-2 bg-muted rounded text-sm text-muted-foreground">Not Applicable</div>
                      )}
                    </div>
                  ))}
                </AccordionContent>
              </AccordionItem>
            </div>

            {/* ═══════ CLAUSE 17 — Dual Deduction ═══════ */}
            <div ref={el => { sectionRefs.current["cl_17"] = el; }}>
              <AccordionItem value="cl_17" className="border rounded-lg">
                <AccordionTrigger className="px-4">
                  <div className="flex items-center gap-3">
                    <Badge variant="outline" className="font-mono text-xs">17</Badge>
                    <span className="font-medium">Dual Deduction / Amounts Debited Twice</span>
                    {isClauseFilled(cl17) && <Badge className="bg-green-100 text-green-800 text-[10px]">Filled</Badge>}
                  </div>
                </AccordionTrigger>
                <AccordionContent className="px-4 pb-4 space-y-4">
                  <RadioApplicable name="cl17" value={cl17.applicable} onChange={v => updateClause(setCl17, "applicable", v)} />
                  {cl17.applicable === true && (
                    <EditableTable
                      columns={["Sr No", "Section", "Particulars", "Amount (₹)"]}
                      rows={cl17.rows || []}
                      onChange={rows => updateClause(setCl17, "rows", rows)}
                    />
                  )}
                  {cl17.applicable === false && <div className="p-3 bg-muted rounded text-sm text-muted-foreground">NIL</div>}
                </AccordionContent>
              </AccordionItem>
            </div>

            {/* ═══════ CLAUSE 18 — Depreciation ═══════ */}
            <div ref={el => { sectionRefs.current["cl_18"] = el; }}>
              <AccordionItem value="cl_18" className="border rounded-lg">
                <AccordionTrigger className="px-4">
                  <div className="flex items-center gap-3">
                    <Badge variant="outline" className="font-mono text-xs">18</Badge>
                    <span className="font-medium">Depreciation Allowable</span>
                    {isClauseFilled(cl18) && <Badge className="bg-green-100 text-green-800 text-[10px]">Filled</Badge>}
                  </div>
                </AccordionTrigger>
                <AccordionContent className="px-4 pb-4 space-y-4">
                  <RadioApplicable name="cl18" value={cl18.applicable} onChange={v => updateClause(setCl18, "applicable", v)} />
                  {cl18.applicable === true && (
                    <DepreciationTable
                      rows={cl18.rows || []}
                      onChange={rows => updateClause(setCl18, "rows", rows)}
                    />
                  )}
                  {cl18.applicable === false && <div className="p-3 bg-muted rounded text-sm text-muted-foreground">Not Applicable</div>}
                </AccordionContent>
              </AccordionItem>
            </div>

            {/* ═══════ CLAUSE 19 — Amounts not deductible u/s 40(a) ═══════ */}
            <div ref={el => { sectionRefs.current["cl_19"] = el; }}>
              <AccordionItem value="cl_19" className="border rounded-lg">
                <AccordionTrigger className="px-4">
                  <div className="flex items-center gap-3">
                    <Badge variant="outline" className="font-mono text-xs">19</Badge>
                    <span className="font-medium">Amounts Not Deductible under Section 40(a)</span>
                    {isClauseFilled(cl19) && <Badge className="bg-green-100 text-green-800 text-[10px]">Filled</Badge>}
                  </div>
                </AccordionTrigger>
                <AccordionContent className="px-4 pb-4 space-y-4">
                  <RadioApplicable name="cl19" value={cl19.applicable} onChange={v => updateClause(setCl19, "applicable", v)} />
                  {cl19.applicable === true && (
                    <Section40aTable
                      rows={cl19.rows || []}
                      onChange={rows => updateClause(setCl19, "rows", rows)}
                    />
                  )}
                  {cl19.applicable === false && <div className="p-3 bg-muted rounded text-sm text-muted-foreground">Not Applicable</div>}
                </AccordionContent>
              </AccordionItem>
            </div>

            {/* ═══════ CLAUSE 20 — Amounts Inadmissible u/s 40A ═══════ */}
            <div ref={el => { sectionRefs.current["cl_20"] = el; }}>
              <AccordionItem value="cl_20" className="border rounded-lg">
                <AccordionTrigger className="px-4">
                  <div className="flex items-center gap-3">
                    <Badge variant="outline" className="font-mono text-xs">20</Badge>
                    <span className="font-medium">Amounts Inadmissible u/s 40A</span>
                    {isClauseFilled(cl20) && <Badge className="bg-green-100 text-green-800 text-[10px]">Filled</Badge>}
                  </div>
                </AccordionTrigger>
                <AccordionContent className="px-4 pb-4 space-y-6">
                  {/* 20(a) */}
                  <div className="space-y-3 border-l-2 border-muted pl-4">
                    <Label className="font-medium">20(a) — Amounts inadmissible u/s 40A</Label>
                    <RadioApplicable name="cl20a" value={cl20.a_applicable} onChange={v => updateClause(setCl20, "a_applicable", v)} />
                    {cl20.a_applicable === true && (
                      <EditableTable
                        columns={["Particulars", "Amount Paid (₹)", "Amount Disallowable (₹)"]}
                        rows={cl20.a_rows || []}
                        onChange={rows => updateClause(setCl20, "a_rows", rows)}
                      />
                    )}
                    {cl20.a_applicable === false && <div className="p-2 bg-muted rounded text-sm text-muted-foreground">Not Applicable</div>}
                  </div>
                  <Separator />
                  {/* 20(b) */}
                  <div className="space-y-3 border-l-2 border-muted pl-4">
                    <Label className="font-medium">20(b) — Payments to related parties u/s 40A(2)(b)</Label>
                    <RadioApplicable name="cl20b" value={cl20.b_applicable} onChange={v => updateClause(setCl20, "b_applicable", v)} />
                    {cl20.b_applicable === true && (
                      <EditableTable
                        columns={["Name of Person", "Relationship", "Nature of Payment", "Amount Paid (₹)", "Market Value (₹)", "Amount Disallowable (₹)"]}
                        rows={cl20.b_rows || []}
                        onChange={rows => updateClause(setCl20, "b_rows", rows)}
                      />
                    )}
                    {cl20.b_applicable === false && <div className="p-2 bg-muted rounded text-sm text-muted-foreground">Not Applicable</div>}
                  </div>
                </AccordionContent>
              </AccordionItem>
            </div>

            {/* ═══════ CLAUSE 21 — Amounts Allowable on Payment Basis ═══════ */}
            <div ref={el => { sectionRefs.current["cl_21"] = el; }}>
              <AccordionItem value="cl_21" className="border rounded-lg">
                <AccordionTrigger className="px-4">
                  <div className="flex items-center gap-3">
                    <Badge variant="outline" className="font-mono text-xs">21</Badge>
                    <span className="font-medium">Amounts Allowable on Payment Basis</span>
                    {isClauseFilled(cl21) && <Badge className="bg-green-100 text-green-800 text-[10px]">Filled</Badge>}
                  </div>
                </AccordionTrigger>
                <AccordionContent className="px-4 pb-4 space-y-6">
                  <RadioApplicable name="cl21" value={cl21.applicable} onChange={v => updateClause(setCl21, "applicable", v)} />
                  {cl21.applicable === true && (
                    <>
                      {/* 21(a)(A) Bonus/Commission */}
                      <div className="space-y-3 border-l-2 border-muted pl-4">
                        <Label className="font-medium">21(a)(A) — Bonus / Commission to Employees</Label>
                        <EditableTable
                          columns={["Payee Name", "Amount (₹)", "Due Date", "Actual Payment Date", "Late Payment Amount (₹)"]}
                          rows={cl21.bonus_rows || []}
                          onChange={rows => updateClause(setCl21, "bonus_rows", rows)}
                        />
                      </div>
                      {/* 21(a)(B) Interest on Loans */}
                      <div className="space-y-3 border-l-2 border-muted pl-4">
                        <Label className="font-medium">21(a)(B) — Interest on Loans</Label>
                        <EditableTable
                          columns={["Payee Name", "PAN", "Amount (₹)", "Remarks"]}
                          rows={cl21.interest_rows || []}
                          onChange={rows => updateClause(setCl21, "interest_rows", rows)}
                        />
                      </div>
                      {/* 21(a)(C) Employer's contribution to PF/ESI */}
                      <div className="space-y-3 border-l-2 border-muted pl-4">
                        <Label className="font-medium">21(a)(C) — Employer's Contribution to PF / ESI</Label>
                        <EditableTable
                          columns={["Fund Name", "Amount Due (₹)", "Amount Paid (₹)", "Date of Payment"]}
                          rows={cl21.pf_rows || []}
                          onChange={rows => updateClause(setCl21, "pf_rows", rows)}
                        />
                      </div>
                      {/* 21(a)(D) Interest to partners */}
                      <div className="space-y-3 border-l-2 border-muted pl-4">
                        <Label className="font-medium">21(a)(D) — Interest to Partners</Label>
                        <EditableTable
                          columns={["Partner Name", "Amount (₹)", "Rate %"]}
                          rows={cl21.partner_interest_rows || []}
                          onChange={rows => updateClause(setCl21, "partner_interest_rows", rows)}
                        />
                      </div>
                    </>
                  )}
                  {cl21.applicable === false && <div className="p-3 bg-muted rounded text-sm text-muted-foreground">Not Applicable</div>}
                </AccordionContent>
              </AccordionItem>
            </div>

            {/* ═══════ CLAUSE 22 — Personal Expenditure ═══════ */}
            <div ref={el => { sectionRefs.current["cl_22"] = el; }}>
              <AccordionItem value="cl_22" className="border rounded-lg">
                <AccordionTrigger className="px-4">
                  <div className="flex items-center gap-3">
                    <Badge variant="outline" className="font-mono text-xs">22</Badge>
                    <span className="font-medium">Amounts Debited for Personal Expenditure</span>
                    {isClauseFilled(cl22) && <Badge className="bg-green-100 text-green-800 text-[10px]">Filled</Badge>}
                  </div>
                </AccordionTrigger>
                <AccordionContent className="px-4 pb-4 space-y-4">
                  {[
                    { key: "lifeInsurance", label: "Amount paid as life insurance premium" },
                    { key: "motorCar", label: "Amount paid as personal motor car expenses" },
                    { key: "clubFees", label: "Amount paid as club entrance fee and subscription" },
                    { key: "personalTravel", label: "Amount paid for personal travel" },
                    { key: "personalTelephone", label: "Amount paid for personal telephone" },
                  ].map(item => (
                    <div key={item.key} className="grid grid-cols-[1fr_200px] gap-3 items-center">
                      <Label className="text-sm">{item.label}</Label>
                      <Input
                        type="number"
                        placeholder="₹ 0.00"
                        value={cl22[item.key] || ""}
                        onChange={e => updateClause(setCl22, item.key, e.target.value)}
                        className="text-right"
                      />
                    </div>
                  ))}
                  <Separator />
                  <div className="space-y-2">
                    <Label>Any other personal expenditure</Label>
                    <div className="grid grid-cols-[1fr_200px] gap-3">
                      <Input
                        placeholder="Particulars"
                        value={cl22.otherParticulars || ""}
                        onChange={e => updateClause(setCl22, "otherParticulars", e.target.value)}
                      />
                      <Input
                        type="number"
                        placeholder="₹ 0.00"
                        value={cl22.otherAmount || ""}
                        onChange={e => updateClause(setCl22, "otherAmount", e.target.value)}
                        className="text-right"
                      />
                    </div>
                  </div>
                  <Separator />
                  <div className="flex justify-end">
                    <div className="bg-muted px-4 py-2 rounded text-sm font-medium">
                      Total: ₹{(
                        ["lifeInsurance", "motorCar", "clubFees", "personalTravel", "personalTelephone", "otherAmount"]
                          .reduce((sum, k) => sum + (parseFloat(cl22[k] || "0") || 0), 0)
                      ).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                    </div>
                  </div>
                </AccordionContent>
              </AccordionItem>
            </div>

            {/* Placeholder sections for clauses 23-44 */}
            {CLAUSE_NAV.filter(c => !implementedKeys.has(c.key as any)).map(c => (
              <div key={c.key} ref={el => { sectionRefs.current[c.key] = el; }}>
                <AccordionItem value={c.key} className="border rounded-lg">
                  <AccordionTrigger className="px-4">
                    <div className="flex items-center gap-3">
                      <Badge variant="outline" className="font-mono text-xs">{c.label}</Badge>
                      <span className="font-medium">{c.title}</span>
                      <Badge variant="secondary" className="text-[10px]">Coming Soon</Badge>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent className="px-4 pb-4">
                    <div className="p-4 bg-muted/50 rounded text-sm text-muted-foreground text-center">
                      This clause will be implemented in the next prompt batch.
                    </div>
                  </AccordionContent>
                </AccordionItem>
              </div>
            ))}
          </Accordion>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════
   SUB-COMPONENTS
   ══════════════════════════════════════════════════════ */

/** Radio Yes/No helper */
function RadioYesNo({ name, value, onChange }: { name: string; value: boolean | undefined; onChange: (v: boolean) => void }) {
  return (
    <div className="flex gap-4">
      <label className="flex items-center gap-2 cursor-pointer">
        <input type="radio" name={name} checked={value === true} onChange={() => onChange(true)} /> Yes
      </label>
      <label className="flex items-center gap-2 cursor-pointer">
        <input type="radio" name={name} checked={value === false} onChange={() => onChange(false)} /> No
      </label>
    </div>
  );
}

/** Radio Applicable / Not Applicable helper */
function RadioApplicable({ name, value, onChange }: { name: string; value: boolean | undefined; onChange: (v: boolean) => void }) {
  return (
    <div className="flex gap-4">
      <label className="flex items-center gap-2 cursor-pointer">
        <input type="radio" name={name} checked={value === true} onChange={() => onChange(true)} /> Applicable
      </label>
      <label className="flex items-center gap-2 cursor-pointer">
        <input type="radio" name={name} checked={value === false} onChange={() => onChange(false)} /> Not Applicable
      </label>
    </div>
  );
}

/** Sector picker with two-level dropdown */
function SectorPicker({ selectedSector, selectedCode, onSectorChange, onCodeChange }: {
  selectedSector: string; selectedCode: string;
  onSectorChange: (v: string) => void; onCodeChange: (v: string) => void;
}) {
  const [search, setSearch] = useState("");
  const sector = SECTOR_CODES.find(s => s.name === selectedSector);
  const filteredSectors = search
    ? SECTOR_CODES.filter(s => s.name.toLowerCase().includes(search.toLowerCase()) || s.subSectors.some(ss => ss.code.includes(search) || ss.name.toLowerCase().includes(search.toLowerCase())))
    : SECTOR_CODES;

  return (
    <div className="space-y-3">
      <Input placeholder="Search sector or code..." value={search} onChange={e => setSearch(e.target.value)} className="max-w-sm" />
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-xs">Sector</Label>
          <Select value={selectedSector} onValueChange={onSectorChange}>
            <SelectTrigger><SelectValue placeholder="Select sector" /></SelectTrigger>
            <SelectContent className="max-h-60">
              {filteredSectors.map(s => <SelectItem key={s.name} value={s.name}>{s.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Sub-sector Code</Label>
          <Select value={selectedCode} onValueChange={onCodeChange} disabled={!sector}>
            <SelectTrigger><SelectValue placeholder={sector ? "Select sub-sector" : "Select sector first"} /></SelectTrigger>
            <SelectContent className="max-h-60">
              {sector?.subSectors
                .filter(ss => !search || ss.code.includes(search) || ss.name.toLowerCase().includes(search.toLowerCase()))
                .map(ss => (
                  <SelectItem key={ss.code} value={ss.code}>{ss.code} — {ss.name}</SelectItem>
                ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
}

/** Generic editable table with add/remove rows */
function EditableTable({ columns, rows, onChange }: {
  columns: string[]; rows: string[][]; onChange: (rows: string[][]) => void;
}) {
  function addRow() { onChange([...rows, columns.map(() => "")]); }
  function removeRow(i: number) { onChange(rows.filter((_, idx) => idx !== i)); }
  function updateCell(ri: number, ci: number, val: string) {
    const next = rows.map((r, idx) => idx === ri ? r.map((c, j) => j === ci ? val : c) : [...r]);
    onChange(next);
  }
  return (
    <div className="space-y-2">
      <Table>
        <TableHeader>
          <TableRow>
            {columns.map((c, i) => <TableHead key={i} className="text-xs">{c}</TableHead>)}
            <TableHead className="w-10" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 && (
            <TableRow><TableCell colSpan={columns.length + 1} className="text-center text-muted-foreground text-sm py-4">No rows. Click "+ Add Row" to begin.</TableCell></TableRow>
          )}
          {rows.map((row, ri) => (
            <TableRow key={ri}>
              {row.map((cell, ci) => (
                <TableCell key={ci} className="p-1">
                  <Input value={cell} onChange={e => updateCell(ri, ci, e.target.value)} className="h-8 text-xs" />
                </TableCell>
              ))}
              <TableCell className="p-1">
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => removeRow(ri)}>
                  <Trash2 className="h-3 w-3 text-destructive" />
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <Button variant="outline" size="sm" onClick={addRow}><Plus className="h-3 w-3 mr-1" /> Add Row</Button>
    </div>
  );
}

/** Editable table with auto-sum total row */
function EditableTableWithTotal({ columns, rows, onChange, totalColIndex }: {
  columns: string[]; rows: string[][]; onChange: (rows: string[][]) => void; totalColIndex: number;
}) {
  const total = rows.reduce((sum, row) => sum + (parseFloat(row[totalColIndex] || "0") || 0), 0);
  return (
    <div className="space-y-2">
      <EditableTable columns={columns} rows={rows} onChange={onChange} />
      <div className="flex justify-end pr-12">
        <div className="bg-muted px-4 py-2 rounded text-sm font-medium">
          Total: ₹{total.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
        </div>
      </div>
    </div>
  );
}

/** ICDS table with dropdown in first column */
function ICDSTable({ rows, onChange }: { rows: { icds: string; particulars: string; increase: string; decrease: string }[]; onChange: (r: any[]) => void; }) {
  function addRow() { onChange([...rows, { icds: "", particulars: "", increase: "", decrease: "" }]); }
  function removeRow(i: number) { onChange(rows.filter((_, idx) => idx !== i)); }
  function update(i: number, key: string, val: string) {
    onChange(rows.map((r, idx) => idx === i ? { ...r, [key]: val } : r));
  }
  return (
    <div className="space-y-2">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="text-xs w-56">ICDS Number</TableHead>
            <TableHead className="text-xs">Particulars</TableHead>
            <TableHead className="text-xs w-36">Increase in Profit (₹)</TableHead>
            <TableHead className="text-xs w-36">Decrease in Profit (₹)</TableHead>
            <TableHead className="w-10" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 && (
            <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground text-sm py-4">No rows. Click "+ Add Row".</TableCell></TableRow>
          )}
          {rows.map((row, i) => (
            <TableRow key={i}>
              <TableCell className="p-1">
                <Select value={row.icds} onValueChange={v => update(i, "icds", v)}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select ICDS" /></SelectTrigger>
                  <SelectContent>
                    {ICDS_LIST.map(ic => <SelectItem key={ic} value={ic}>{ic}</SelectItem>)}
                  </SelectContent>
                </Select>
              </TableCell>
              <TableCell className="p-1"><Input value={row.particulars} onChange={e => update(i, "particulars", e.target.value)} className="h-8 text-xs" /></TableCell>
              <TableCell className="p-1"><Input type="number" value={row.increase} onChange={e => update(i, "increase", e.target.value)} className="h-8 text-xs" /></TableCell>
              <TableCell className="p-1"><Input type="number" value={row.decrease} onChange={e => update(i, "decrease", e.target.value)} className="h-8 text-xs" /></TableCell>
              <TableCell className="p-1">
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => removeRow(i)}>
                  <Trash2 className="h-3 w-3 text-destructive" />
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <Button variant="outline" size="sm" onClick={addRow}><Plus className="h-3 w-3 mr-1" /> Add Row</Button>
    </div>
  );
}

/** Depreciation schedule table with auto-calc columns */
function DepreciationTable({ rows, onChange }: {
  rows: { block: string; openingWDV: string; additions: string; deductions: string; rate: string; depAsPerBooks: string }[];
  onChange: (r: any[]) => void;
}) {
  function addRow() {
    onChange([...rows, { block: "", openingWDV: "", additions: "", deductions: "", rate: "", depAsPerBooks: "" }]);
  }
  function removeRow(i: number) { onChange(rows.filter((_, idx) => idx !== i)); }
  function update(i: number, key: string, val: string) {
    onChange(rows.map((r, idx) => idx === i ? { ...r, [key]: val } : r));
  }

  function calc(row: any) {
    const o = parseFloat(row.openingWDV || "0") || 0;
    const a = parseFloat(row.additions || "0") || 0;
    const d = parseFloat(row.deductions || "0") || 0;
    const closingWDV = o + a - d;
    const rate = parseFloat(row.rate || "0") || 0;
    const dep = closingWDV * rate / 100;
    const perBooks = parseFloat(row.depAsPerBooks || "0") || 0;
    return { closingWDV, dep, diff: dep - perBooks };
  }

  const totals = rows.reduce(
    (acc, row) => {
      const c = calc(row);
      return {
        openingWDV: acc.openingWDV + (parseFloat(row.openingWDV || "0") || 0),
        additions: acc.additions + (parseFloat(row.additions || "0") || 0),
        deductions: acc.deductions + (parseFloat(row.deductions || "0") || 0),
        closingWDV: acc.closingWDV + c.closingWDV,
        dep: acc.dep + c.dep,
        perBooks: acc.perBooks + (parseFloat(row.depAsPerBooks || "0") || 0),
        diff: acc.diff + c.diff,
      };
    },
    { openingWDV: 0, additions: 0, deductions: 0, closingWDV: 0, dep: 0, perBooks: 0, diff: 0 }
  );

  const fmt = (n: number) => n.toLocaleString("en-IN", { minimumFractionDigits: 2 });

  return (
    <div className="space-y-2">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="text-xs">Block of Assets</TableHead>
            <TableHead className="text-xs w-28">Opening WDV (₹)</TableHead>
            <TableHead className="text-xs w-28">Additions (₹)</TableHead>
            <TableHead className="text-xs w-28">Deductions (₹)</TableHead>
            <TableHead className="text-xs w-28 bg-muted/50">Closing WDV (₹)</TableHead>
            <TableHead className="text-xs w-20">Rate (%)</TableHead>
            <TableHead className="text-xs w-28 bg-muted/50">Depreciation (₹)</TableHead>
            <TableHead className="text-xs w-28">Dep as per Books (₹)</TableHead>
            <TableHead className="text-xs w-28 bg-muted/50">Difference (₹)</TableHead>
            <TableHead className="w-10" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 && (
            <TableRow><TableCell colSpan={10} className="text-center text-muted-foreground text-sm py-4">No rows. Click "+ Add Row".</TableCell></TableRow>
          )}
          {rows.map((row, i) => {
            const c = calc(row);
            return (
              <TableRow key={i}>
                <TableCell className="p-1"><Input value={row.block} onChange={e => update(i, "block", e.target.value)} className="h-8 text-xs" /></TableCell>
                <TableCell className="p-1"><Input type="number" value={row.openingWDV} onChange={e => update(i, "openingWDV", e.target.value)} className="h-8 text-xs" /></TableCell>
                <TableCell className="p-1"><Input type="number" value={row.additions} onChange={e => update(i, "additions", e.target.value)} className="h-8 text-xs" /></TableCell>
                <TableCell className="p-1"><Input type="number" value={row.deductions} onChange={e => update(i, "deductions", e.target.value)} className="h-8 text-xs" /></TableCell>
                <TableCell className="p-1 bg-muted/30 text-xs text-right font-medium">{fmt(c.closingWDV)}</TableCell>
                <TableCell className="p-1"><Input type="number" value={row.rate} onChange={e => update(i, "rate", e.target.value)} className="h-8 text-xs" /></TableCell>
                <TableCell className="p-1 bg-muted/30 text-xs text-right font-medium">{fmt(c.dep)}</TableCell>
                <TableCell className="p-1"><Input type="number" value={row.depAsPerBooks} onChange={e => update(i, "depAsPerBooks", e.target.value)} className="h-8 text-xs" /></TableCell>
                <TableCell className="p-1 bg-muted/30 text-xs text-right font-medium">{fmt(c.diff)}</TableCell>
                <TableCell className="p-1">
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => removeRow(i)}>
                    <Trash2 className="h-3 w-3 text-destructive" />
                  </Button>
                </TableCell>
              </TableRow>
            );
          })}
          {rows.length > 0 && (
            <TableRow className="bg-muted/20 font-semibold text-xs">
              <TableCell className="p-1">Totals</TableCell>
              <TableCell className="p-1 text-right">{fmt(totals.openingWDV)}</TableCell>
              <TableCell className="p-1 text-right">{fmt(totals.additions)}</TableCell>
              <TableCell className="p-1 text-right">{fmt(totals.deductions)}</TableCell>
              <TableCell className="p-1 text-right">{fmt(totals.closingWDV)}</TableCell>
              <TableCell className="p-1" />
              <TableCell className="p-1 text-right">{fmt(totals.dep)}</TableCell>
              <TableCell className="p-1 text-right">{fmt(totals.perBooks)}</TableCell>
              <TableCell className="p-1 text-right">{fmt(totals.diff)}</TableCell>
              <TableCell />
            </TableRow>
          )}
        </TableBody>
      </Table>
      <Button variant="outline" size="sm" onClick={addRow}><Plus className="h-3 w-3 mr-1" /> Add Row</Button>
    </div>
  );
}

/** Section 40(a) table with dropdown */
function Section40aTable({ rows, onChange }: {
  rows: { section: string; nature: string; amount: string; remarks: string }[];
  onChange: (r: any[]) => void;
}) {
  function addRow() { onChange([...rows, { section: "", nature: "", amount: "", remarks: "" }]); }
  function removeRow(i: number) { onChange(rows.filter((_, idx) => idx !== i)); }
  function update(i: number, key: string, val: string) {
    onChange(rows.map((r, idx) => idx === i ? { ...r, [key]: val } : r));
  }
  return (
    <div className="space-y-2">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="text-xs w-40">Section</TableHead>
            <TableHead className="text-xs">Nature of Payment</TableHead>
            <TableHead className="text-xs w-32">Amount (₹)</TableHead>
            <TableHead className="text-xs w-40">Remarks</TableHead>
            <TableHead className="w-10" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 && (
            <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground text-sm py-4">No rows. Click "+ Add Row".</TableCell></TableRow>
          )}
          {rows.map((row, i) => (
            <TableRow key={i}>
              <TableCell className="p-1">
                <Select value={row.section} onValueChange={v => update(i, "section", v)}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>
                    {SECTION_40A_OPTIONS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </TableCell>
              <TableCell className="p-1"><Input value={row.nature} onChange={e => update(i, "nature", e.target.value)} className="h-8 text-xs" /></TableCell>
              <TableCell className="p-1"><Input type="number" value={row.amount} onChange={e => update(i, "amount", e.target.value)} className="h-8 text-xs" /></TableCell>
              <TableCell className="p-1"><Input value={row.remarks} onChange={e => update(i, "remarks", e.target.value)} className="h-8 text-xs" /></TableCell>
              <TableCell className="p-1">
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => removeRow(i)}>
                  <Trash2 className="h-3 w-3 text-destructive" />
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <Button variant="outline" size="sm" onClick={addRow}><Plus className="h-3 w-3 mr-1" /> Add Row</Button>
    </div>
  );
}
