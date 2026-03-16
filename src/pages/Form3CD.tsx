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
  { key: "cl_35", label: "35", title: "Turnover / Receipts" },
  { key: "cl_36", label: "36", title: "Amounts not credited to P&L" },
  { key: "cl_37_39", label: "37-39", title: "Change in shareholding / Cost audit / Central Excise" },
  { key: "cl_40", label: "40", title: "Fringe benefit details" },
  { key: "cl_41", label: "41", title: "MSME outstanding > 45 days" },
  { key: "cl_42_43", label: "42-43", title: "Form 61 / Form 61A" },
  { key: "cl_44", label: "44", title: "GST breakup of expenditure" },
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
  "cl_35","cl_36","cl_37_39","cl_40","cl_41","cl_42_43","cl_44",
] as const;

const STOCK_UNIT_OPTIONS = ["KG", "MT", "Nos", "Ltrs", "Sq Ft", "Sq Mt", "Other"];

const FRINGE_BENEFIT_CATEGORIES = [
  "Motor Car", "Telephone", "Club", "Travel", "Medical", "Entertainment", "Guest House", "Festival", "Other",
];

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
  const [cl23, setCl23] = useState<ClauseData>({});
  const [cl24_25, setCl24_25] = useState<ClauseData>({});
  const [cl26, setCl26] = useState<ClauseData>({});
  const [cl27, setCl27] = useState<ClauseData>({});
  const [cl29, setCl29] = useState<ClauseData>({});
  const [cl30, setCl30] = useState<ClauseData>({});
  const [cl31, setCl31] = useState<ClauseData>({});
  const [cl32, setCl32] = useState<ClauseData>({});
  const [cl33, setCl33] = useState<ClauseData>({});
  const [cl34, setCl34] = useState<ClauseData>({});
  const [cl35, setCl35] = useState<ClauseData>({});
  const [cl36, setCl36] = useState<ClauseData>({});
  const [cl37_39, setCl37_39] = useState<ClauseData>({});
  const [cl40, setCl40] = useState<ClauseData>(() => ({
    rows: FRINGE_BENEFIT_CATEGORIES.map(c => ({ nature: c, totalExp: "", pctFB: "", fbValue: "" })),
  }));
  const [cl41, setCl41] = useState<ClauseData>({});
  const [cl42_43, setCl42_43] = useState<ClauseData>({});
  const [cl44, setCl44] = useState<ClauseData>({});

  const clauseStateMap: Record<string, ClauseData> = {
    cl_8: cl8, cl_9: cl9, cl_10: cl10, cl_11: cl11, cl_12: cl12, cl_13: cl13,
    cl_14: cl14, cl_15_16: cl15_16, cl_17: cl17, cl_18: cl18,
    cl_19: cl19, cl_20: cl20, cl_21: cl21, cl_22: cl22,
    cl_23: cl23, cl_24_25: cl24_25, cl_26: cl26, cl_27: cl27,
    cl_29: cl29, cl_30: cl30, cl_31: cl31, cl_32: cl32, cl_33: cl33, cl_34: cl34,
    cl_35: cl35, cl_36: cl36, cl_37_39: cl37_39, cl_40: cl40, cl_41: cl41, cl_42_43: cl42_43, cl_44: cl44,
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
      setCl23(e.cl_23 || {}); setCl24_25(e.cl_24_25 || {}); setCl26(e.cl_26 || {});
      setCl27(e.cl_27 || {}); setCl29(e.cl_29 || {}); setCl30(e.cl_30 || {});
      setCl31(e.cl_31 || {}); setCl32(e.cl_32 || {}); setCl33(e.cl_33 || {});
      setCl34(e.cl_34 || {});
      setCl35(e.cl_35 || {}); setCl36(e.cl_36 || {});
      setCl37_39(e.cl_37_39 || {});
      if (e.cl_40 && Object.keys(e.cl_40).length > 0) setCl40(e.cl_40); 
      setCl41(e.cl_41 || {}); setCl42_43(e.cl_42_43 || {}); setCl44(e.cl_44 || {});
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
        cl_23: cl23, cl_24_25: cl24_25, cl_26: cl26, cl_27: cl27,
        cl_29: cl29, cl_30: cl30, cl_31: cl31, cl_32: cl32, cl_33: cl33, cl_34: cl34,
        cl_35: cl35, cl_36: cl36, cl_37_39: cl37_39, cl_40: cl40, cl_41: cl41, cl_42_43: cl42_43, cl_44: cl44,
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

  const [showPrintView, setShowPrintView] = useState(false);

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

            {/* ═══════ CLAUSE 23 — Payments to specified persons ═══════ */}
            <div ref={el => { sectionRefs.current["cl_23"] = el; }}>
              <AccordionItem value="cl_23" className="border rounded-lg">
                <AccordionTrigger className="px-4">
                  <div className="flex items-center gap-3">
                    <Badge variant="outline" className="font-mono text-xs">23</Badge>
                    <span className="font-medium">Payments to Specified Persons u/s 40A(2)(b)</span>
                    {isClauseFilled(cl23) && <Badge className="bg-green-100 text-green-800 text-[10px]">Filled</Badge>}
                  </div>
                </AccordionTrigger>
                <AccordionContent className="px-4 pb-4 space-y-4">
                  <RadioApplicable name="cl23" value={cl23.applicable} onChange={v => updateClause(setCl23, "applicable", v)} />
                  {cl23.applicable === true && (
                    <EditableTable
                      columns={["Name", "PAN", "Relationship", "Nature of Payment", "Amount (₹)"]}
                      rows={cl23.rows || []}
                      onChange={rows => updateClause(setCl23, "rows", rows)}
                    />
                  )}
                  {cl23.applicable === false && <div className="p-3 bg-muted rounded text-sm text-muted-foreground">Not Applicable</div>}
                </AccordionContent>
              </AccordionItem>
            </div>

            {/* ═══════ CLAUSES 24 & 25 — Deemed profits / chargeable amounts ═══════ */}
            <div ref={el => { sectionRefs.current["cl_24_25"] = el; }}>
              <AccordionItem value="cl_24_25" className="border rounded-lg">
                <AccordionTrigger className="px-4">
                  <div className="flex items-center gap-3">
                    <Badge variant="outline" className="font-mono text-xs">24-25</Badge>
                    <span className="font-medium">Amounts Deemed as Profits / Chargeable to Tax</span>
                    {isClauseFilled(cl24_25) && <Badge className="bg-green-100 text-green-800 text-[10px]">Filled</Badge>}
                  </div>
                </AccordionTrigger>
                <AccordionContent className="px-4 pb-4 space-y-6">
                  {/* Clause 24 */}
                  <div className="space-y-3 border-l-2 border-muted pl-4">
                    <Label className="font-medium">Clause 24 — Amounts deemed as profits u/s 33AB/33ABA/33AC</Label>
                    <RadioApplicable name="cl24" value={cl24_25.cl24_applicable} onChange={v => updateClause(setCl24_25, "cl24_applicable", v)} />
                    {cl24_25.cl24_applicable === true && (
                      <EditableTable columns={["Section", "Particulars", "Amount (₹)"]} rows={cl24_25.cl24_rows || []} onChange={rows => updateClause(setCl24_25, "cl24_rows", rows)} />
                    )}
                    {cl24_25.cl24_applicable === false && <div className="p-2 bg-muted rounded text-sm text-muted-foreground">Not Applicable</div>}
                  </div>
                  <Separator />
                  {/* Clause 25 */}
                  <div className="space-y-3 border-l-2 border-muted pl-4">
                    <Label className="font-medium">Clause 25 — Any amount of profit chargeable to tax under the Act</Label>
                    <RadioApplicable name="cl25" value={cl24_25.cl25_applicable} onChange={v => updateClause(setCl24_25, "cl25_applicable", v)} />
                    {cl24_25.cl25_applicable === true && (
                      <div className="space-y-2">
                        <Textarea placeholder="Particulars..." value={cl24_25.cl25_particulars || ""} onChange={e => updateClause(setCl24_25, "cl25_particulars", e.target.value)} />
                        <div className="grid grid-cols-[1fr_200px] gap-3 items-center">
                          <Label>Amount (₹)</Label>
                          <Input type="number" placeholder="₹ 0.00" value={cl24_25.cl25_amount || ""} onChange={e => updateClause(setCl24_25, "cl25_amount", e.target.value)} className="text-right" />
                        </div>
                      </div>
                    )}
                    {cl24_25.cl25_applicable === false && <div className="p-2 bg-muted rounded text-sm text-muted-foreground">Not Applicable</div>}
                  </div>
                </AccordionContent>
              </AccordionItem>
            </div>

            {/* ═══════ CLAUSE 26 — Loss/expenditure disallowable ═══════ */}
            <div ref={el => { sectionRefs.current["cl_26"] = el; }}>
              <AccordionItem value="cl_26" className="border rounded-lg">
                <AccordionTrigger className="px-4">
                  <div className="flex items-center gap-3">
                    <Badge variant="outline" className="font-mono text-xs">26</Badge>
                    <span className="font-medium">Any Amount of Loss / Expenditure Disallowable</span>
                    {isClauseFilled(cl26) && <Badge className="bg-green-100 text-green-800 text-[10px]">Filled</Badge>}
                  </div>
                </AccordionTrigger>
                <AccordionContent className="px-4 pb-4 space-y-6">
                  {[
                    { key: "26ai", label: "26(a)(i) — Penalty / Fine for violation of law" },
                    { key: "26aii", label: "26(a)(ii) — Penalty / Fine for violation of any enactment" },
                    { key: "26aiii", label: "26(a)(iii) — Amount disallowed u/s 37(1)" },
                    { key: "26aiv", label: "26(a)(iv) — Any expenditure by way of contribution to political party" },
                  ].map(sub => (
                    <div key={sub.key} className="space-y-3 border-l-2 border-muted pl-4">
                      <Label className="font-medium">{sub.label}</Label>
                      <RadioApplicable name={`cl26_${sub.key}`} value={cl26[`${sub.key}_applicable`]} onChange={v => updateClause(setCl26, `${sub.key}_applicable`, v)} />
                      {cl26[`${sub.key}_applicable`] === true && (
                        <DropdownTable
                          dropdownCol={0}
                          dropdownLabel="Nature of Liability"
                          dropdownOptions={LIABILITY_NATURE_OPTIONS}
                          columns={["Nature of Liability", "Amount (₹)"]}
                          rows={cl26[`${sub.key}_rows`] || []}
                          onChange={rows => updateClause(setCl26, `${sub.key}_rows`, rows)}
                        />
                      )}
                      {cl26[`${sub.key}_applicable`] === false && <div className="p-2 bg-muted rounded text-sm text-muted-foreground">Not Applicable</div>}
                    </div>
                  ))}
                </AccordionContent>
              </AccordionItem>
            </div>

            {/* ═══════ CLAUSE 27 — Deemed income / Prior period items ═══════ */}
            <div ref={el => { sectionRefs.current["cl_27"] = el; }}>
              <AccordionItem value="cl_27" className="border rounded-lg">
                <AccordionTrigger className="px-4">
                  <div className="flex items-center gap-3">
                    <Badge variant="outline" className="font-mono text-xs">27</Badge>
                    <span className="font-medium">Deemed Income / Prior Period Items</span>
                    {isClauseFilled(cl27) && <Badge className="bg-green-100 text-green-800 text-[10px]">Filled</Badge>}
                  </div>
                </AccordionTrigger>
                <AccordionContent className="px-4 pb-4 space-y-6">
                  {/* 27(a) */}
                  <div className="space-y-3 border-l-2 border-muted pl-4">
                    <Label className="font-medium">27(a) — Receipt of any amount taxable as deemed income</Label>
                    <RadioYesNo name="cl27a" value={cl27.a_yes} onChange={v => updateClause(setCl27, "a_yes", v)} />
                    {cl27.a_yes === true && (
                      <EditableTable columns={["Nature of Receipt", "Section", "Amount (₹)", "Remarks"]} rows={cl27.a_rows || []} onChange={rows => updateClause(setCl27, "a_rows", rows)} />
                    )}
                    {cl27.a_yes === false && <div className="p-2 bg-muted rounded text-sm text-muted-foreground">No deemed income</div>}
                  </div>
                  <Separator />
                  {/* 27(b) */}
                  <div className="space-y-3 border-l-2 border-muted pl-4">
                    <Label className="font-medium">27(b) — Prior period items</Label>
                    <RadioApplicable name="cl27b" value={cl27.b_applicable} onChange={v => updateClause(setCl27, "b_applicable", v)} />
                    {cl27.b_applicable === true && (
                      <DropdownTable
                        dropdownCol={0}
                        dropdownLabel="Type"
                        dropdownOptions={["Income", "Expense"]}
                        columns={["Type", "Particulars", "Amount (₹)", "Prior Period (yyyy-yy)"]}
                        rows={cl27.b_rows || []}
                        onChange={rows => updateClause(setCl27, "b_rows", rows)}
                      />
                    )}
                    {cl27.b_applicable === false && <div className="p-2 bg-muted rounded text-sm text-muted-foreground">Not Applicable</div>}
                  </div>
                </AccordionContent>
              </AccordionItem>
            </div>

            {/* ═══════ CLAUSE 29 — Deemed profits u/s 32AC/33AB/41 ═══════ */}
            <div ref={el => { sectionRefs.current["cl_29"] = el; }}>
              <AccordionItem value="cl_29" className="border rounded-lg">
                <AccordionTrigger className="px-4">
                  <div className="flex items-center gap-3">
                    <Badge variant="outline" className="font-mono text-xs">29</Badge>
                    <span className="font-medium">Deemed Profits u/s 32AC / 33AB / 41</span>
                    {isClauseFilled(cl29) && <Badge className="bg-green-100 text-green-800 text-[10px]">Filled</Badge>}
                  </div>
                </AccordionTrigger>
                <AccordionContent className="px-4 pb-4 space-y-6">
                  {/* 29(A) */}
                  <div className="space-y-3 border-l-2 border-muted pl-4">
                    <Label className="font-medium">29(A) — Amount deemed as profits u/s 32AC/32AD/33AB/33ABA/35ABB</Label>
                    <RadioYesNo name="cl29a" value={cl29.a_yes} onChange={v => updateClause(setCl29, "a_yes", v)} />
                    {cl29.a_yes === true && (
                      <EditableTable columns={["Section", "Amount of Deduction Earlier Claimed (₹)", "Amount Chargeable Now (₹)", "Remarks"]} rows={cl29.a_rows || []} onChange={rows => updateClause(setCl29, "a_rows", rows)} />
                    )}
                    {cl29.a_yes === false && <div className="p-2 bg-muted rounded text-sm text-muted-foreground">No deemed profits</div>}
                  </div>
                  <Separator />
                  {/* 29(B) */}
                  <div className="space-y-3 border-l-2 border-muted pl-4">
                    <Label className="font-medium">29(B) — Deemed profits u/s 41</Label>
                    <RadioYesNo name="cl29b" value={cl29.b_yes} onChange={v => updateClause(setCl29, "b_yes", v)} />
                    {cl29.b_yes === true && (
                      <EditableTable columns={["Section", "Name of Person", "Amount (₹)"]} rows={cl29.b_rows || []} onChange={rows => updateClause(setCl29, "b_rows", rows)} />
                    )}
                    {cl29.b_yes === false && <div className="p-2 bg-muted rounded text-sm text-muted-foreground">No deemed profits u/s 41</div>}
                  </div>
                </AccordionContent>
              </AccordionItem>
            </div>

            {/* ═══════ CLAUSE 30 — Govt receipts / MSME / Tax paid / Hundi ═══════ */}
            <div ref={el => { sectionRefs.current["cl_30"] = el; }}>
              <AccordionItem value="cl_30" className="border rounded-lg">
                <AccordionTrigger className="px-4">
                  <div className="flex items-center gap-3">
                    <Badge variant="outline" className="font-mono text-xs">30</Badge>
                    <span className="font-medium">Government Receipts / MSME / Tax Paid / Hundi</span>
                    {isClauseFilled(cl30) && <Badge className="bg-green-100 text-green-800 text-[10px]">Filled</Badge>}
                  </div>
                </AccordionTrigger>
                <AccordionContent className="px-4 pb-4 space-y-6">
                  {/* 30 — Govt scheme */}
                  <div className="space-y-3 border-l-2 border-muted pl-4">
                    <Label className="font-medium">Clause 30 — Amount received/receivable from Government</Label>
                    <RadioYesNo name="cl30" value={cl30.govt_yes} onChange={v => updateClause(setCl30, "govt_yes", v)} />
                    {cl30.govt_yes === true && (
                      <div className="space-y-2">
                        <Input placeholder="Name of Government scheme" value={cl30.govt_scheme || ""} onChange={e => updateClause(setCl30, "govt_scheme", e.target.value)} />
                        <div className="grid grid-cols-2 gap-3">
                          <Input type="number" placeholder="Amount Received (₹)" value={cl30.govt_amount || ""} onChange={e => updateClause(setCl30, "govt_amount", e.target.value)} />
                          <Input placeholder="Purpose" value={cl30.govt_purpose || ""} onChange={e => updateClause(setCl30, "govt_purpose", e.target.value)} />
                        </div>
                      </div>
                    )}
                    {cl30.govt_yes === false && <div className="p-2 bg-muted rounded text-sm text-muted-foreground">NIL</div>}
                  </div>
                  <Separator />
                  {/* 30(A) — MSME */}
                  <div className="space-y-3 border-l-2 border-muted pl-4">
                    <Label className="font-medium">30(A) — MSME payments u/s 43B(h)</Label>
                    <RadioYesNo name="cl30a" value={cl30.msme_yes} onChange={v => updateClause(setCl30, "msme_yes", v)} />
                    {cl30.msme_yes === true && (
                      <div className="space-y-2">
                        <Select value={cl30.msme_section || ""} onValueChange={v => updateClause(setCl30, "msme_section", v)}>
                          <SelectTrigger><SelectValue placeholder="Select section" /></SelectTrigger>
                          <SelectContent>
                            {SECTION_43B_OPTIONS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        <div className="grid grid-cols-2 gap-3">
                          <Input type="number" placeholder="Amount Due (₹)" value={cl30.msme_due || ""} onChange={e => updateClause(setCl30, "msme_due", e.target.value)} />
                          <Input type="number" placeholder="Amount Paid (₹)" value={cl30.msme_paid || ""} onChange={e => updateClause(setCl30, "msme_paid", e.target.value)} />
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <Input type="date" value={cl30.msme_date || ""} onChange={e => updateClause(setCl30, "msme_date", e.target.value)} />
                          <Input placeholder="Remarks" value={cl30.msme_remarks || ""} onChange={e => updateClause(setCl30, "msme_remarks", e.target.value)} />
                        </div>
                      </div>
                    )}
                    {cl30.msme_yes === false && <div className="p-2 bg-muted rounded text-sm text-muted-foreground">NIL</div>}
                  </div>
                  <Separator />
                  {/* 30(B) — Tax paid */}
                  <div className="space-y-3 border-l-2 border-muted pl-4">
                    <Label className="font-medium">30(B) — Tax paid</Label>
                    <RadioYesNo name="cl30b" value={cl30.tax_yes} onChange={v => updateClause(setCl30, "tax_yes", v)} />
                    {cl30.tax_yes === true && (
                      <EditableTable columns={["Sr No", "Nature of Tax", "Amount (₹)", "Date of Payment"]} rows={cl30.tax_rows || []} onChange={rows => updateClause(setCl30, "tax_rows", rows)} />
                    )}
                    {cl30.tax_yes === false && <div className="p-2 bg-muted rounded text-sm text-muted-foreground">NIL</div>}
                  </div>
                  <Separator />
                  {/* 30(C) — Hundi */}
                  <div className="space-y-3 border-l-2 border-muted pl-4">
                    <Label className="font-medium">30(C) — Amount borrowed / repaid on hundi</Label>
                    <RadioYesNo name="cl30c" value={cl30.hundi_yes} onChange={v => updateClause(setCl30, "hundi_yes", v)} />
                    {cl30.hundi_yes === true && (
                      <EditableTable columns={["Name of Payer/Payee", "Amount Borrowed (₹)", "Amount Repaid (₹)", "Date"]} rows={cl30.hundi_rows || []} onChange={rows => updateClause(setCl30, "hundi_rows", rows)} />
                    )}
                    {cl30.hundi_yes === false && <div className="p-2 bg-muted rounded text-sm text-muted-foreground">NIL</div>}
                  </div>
                </AccordionContent>
              </AccordionItem>
            </div>

            {/* ═══════ CLAUSE 31 — TDS / TCS Particulars ═══════ */}
            <div ref={el => { sectionRefs.current["cl_31"] = el; }}>
              <AccordionItem value="cl_31" className="border rounded-lg">
                <AccordionTrigger className="px-4">
                  <div className="flex items-center gap-3">
                    <Badge variant="outline" className="font-mono text-xs">31</Badge>
                    <span className="font-medium">TDS / TCS Particulars</span>
                    {isClauseFilled(cl31) && <Badge className="bg-green-100 text-green-800 text-[10px]">Filled</Badge>}
                  </div>
                </AccordionTrigger>
                <AccordionContent className="px-4 pb-4 space-y-6">
                  {/* 31(a) — TDS Deductions */}
                  <div className="space-y-3 border-l-2 border-muted pl-4">
                    <Label className="font-medium">31(a) — TDS Deductions (Section 192 to 196D)</Label>
                    <RadioApplicable name="cl31a" value={cl31.a_applicable} onChange={v => updateClause(setCl31, "a_applicable", v)} />
                    {cl31.a_applicable === true && (
                      <TDSScheduleTable rows={cl31.a_rows || []} onChange={rows => updateClause(setCl31, "a_rows", rows)} />
                    )}
                    {cl31.a_applicable === false && <div className="p-2 bg-muted rounded text-sm text-muted-foreground">Not Applicable</div>}
                  </div>
                  <Separator />
                  {/* 31(b) — TCS Collections */}
                  <div className="space-y-3 border-l-2 border-muted pl-4">
                    <Label className="font-medium">31(b) — TCS Collections</Label>
                    <RadioApplicable name="cl31b" value={cl31.b_applicable} onChange={v => updateClause(setCl31, "b_applicable", v)} />
                    {cl31.b_applicable === true && (
                      <EditableTable columns={["Section", "Nature of Transaction", "Name of Buyer", "PAN", "Amount (₹)", "TCS Collected (₹)", "Date of Collection", "Date of Deposit"]} rows={cl31.b_rows || []} onChange={rows => updateClause(setCl31, "b_rows", rows)} />
                    )}
                    {cl31.b_applicable === false && <div className="p-2 bg-muted rounded text-sm text-muted-foreground">Not Applicable</div>}
                  </div>
                  <Separator />
                  {/* 31(c) — TDS where assessee is payer */}
                  <div className="space-y-3 border-l-2 border-muted pl-4">
                    <Label className="font-medium">31(c) — TDS where assessee is payer but deductee is payee</Label>
                    <RadioApplicable name="cl31c" value={cl31.c_applicable} onChange={v => updateClause(setCl31, "c_applicable", v)} />
                    {cl31.c_applicable === true && (
                      <TDSScheduleTable rows={cl31.c_rows || []} onChange={rows => updateClause(setCl31, "c_rows", rows)} showDateOfDeposit={false} />
                    )}
                    {cl31.c_applicable === false && <div className="p-2 bg-muted rounded text-sm text-muted-foreground">Not Applicable</div>}
                  </div>
                  <Separator />
                  {/* 31(d) — Default in TDS */}
                  <div className="space-y-3 border-l-2 border-muted pl-4">
                    <Label className="font-medium">31(d) — Default in TDS deduction</Label>
                    <RadioApplicable name="cl31d" value={cl31.d_applicable} onChange={v => updateClause(setCl31, "d_applicable", v)} />
                    {cl31.d_applicable === true && (
                      <EditableTable columns={["Section", "Name of Party", "PAN", "Amount on which TDS not deducted (₹)", "Reasons"]} rows={cl31.d_rows || []} onChange={rows => updateClause(setCl31, "d_rows", rows)} />
                    )}
                    {cl31.d_applicable === false && <div className="p-2 bg-muted rounded text-sm text-muted-foreground">NIL</div>}
                  </div>
                  <Separator />
                  {/* 31(e) — Default in TCS */}
                  <div className="space-y-3 border-l-2 border-muted pl-4">
                    <Label className="font-medium">31(e) — Default in TCS collection</Label>
                    <RadioApplicable name="cl31e" value={cl31.e_applicable} onChange={v => updateClause(setCl31, "e_applicable", v)} />
                    {cl31.e_applicable === true && (
                      <EditableTable columns={["Section", "Name of Party", "PAN", "Amount on which TCS not collected (₹)", "Reasons"]} rows={cl31.e_rows || []} onChange={rows => updateClause(setCl31, "e_rows", rows)} />
                    )}
                    {cl31.e_applicable === false && <div className="p-2 bg-muted rounded text-sm text-muted-foreground">NIL</div>}
                  </div>
                </AccordionContent>
              </AccordionItem>
            </div>

            {/* ═══════ CLAUSE 32 — Brought forward losses / deductions ═══════ */}
            <div ref={el => { sectionRefs.current["cl_32"] = el; }}>
              <AccordionItem value="cl_32" className="border rounded-lg">
                <AccordionTrigger className="px-4">
                  <div className="flex items-center gap-3">
                    <Badge variant="outline" className="font-mono text-xs">32</Badge>
                    <span className="font-medium">Brought Forward Losses / Deductions</span>
                    {isClauseFilled(cl32) && <Badge className="bg-green-100 text-green-800 text-[10px]">Filled</Badge>}
                  </div>
                </AccordionTrigger>
                <AccordionContent className="px-4 pb-4 space-y-6">
                  {/* 32(a) */}
                  <div className="space-y-3 border-l-2 border-muted pl-4">
                    <Label className="font-medium">32(a) — Brought forward losses</Label>
                    <RadioApplicable name="cl32a" value={cl32.a_applicable} onChange={v => updateClause(setCl32, "a_applicable", v)} />
                    {cl32.a_applicable === true && (
                      <DropdownTable
                        dropdownCol={0}
                        dropdownLabel="Nature of Loss"
                        dropdownOptions={LOSS_NATURE_OPTIONS}
                        columns={["Nature of Loss", "Assessment Year", "Amount (₹)", "Amount set off this year (₹)", "Balance carried forward (₹)"]}
                        rows={cl32.a_rows || []}
                        onChange={rows => updateClause(setCl32, "a_rows", rows)}
                      />
                    )}
                    {cl32.a_applicable === false && <div className="p-2 bg-muted rounded text-sm text-muted-foreground">N/A</div>}
                  </div>
                  <Separator />
                  {/* 32(b) */}
                  <div className="space-y-3 border-l-2 border-muted pl-4">
                    <Label className="font-medium">32(b) — Allowance under section 32(2) deemed deduction?</Label>
                    <div className="flex gap-4">
                      {["Yes", "No", "N/A"].map(opt => (
                        <label key={opt} className="flex items-center gap-2 cursor-pointer">
                          <input type="radio" name="cl32b" checked={cl32.b_value === opt} onChange={() => updateClause(setCl32, "b_value", opt)} /> {opt}
                        </label>
                      ))}
                    </div>
                  </div>
                  <Separator />
                  {/* 32(c) */}
                  <div className="space-y-3 border-l-2 border-muted pl-4">
                    <Label className="font-medium">32(c) — Deduction claimed u/s 10AA/80HH/80HHC?</Label>
                    <RadioYesNo name="cl32c" value={cl32.c_yes} onChange={v => updateClause(setCl32, "c_yes", v)} />
                    {cl32.c_yes === true && (
                      <div className="space-y-2">
                        <Textarea placeholder="Details of deduction claimed..." value={cl32.c_text || ""} onChange={e => updateClause(setCl32, "c_text", e.target.value)} />
                        <Input type="number" placeholder="Amount (₹)" value={cl32.c_amount || ""} onChange={e => updateClause(setCl32, "c_amount", e.target.value)} className="max-w-xs" />
                      </div>
                    )}
                  </div>
                  <Separator />
                  {/* 32(d) */}
                  <div className="space-y-3 border-l-2 border-muted pl-4">
                    <Label className="font-medium">32(d) — Loss from speculation business?</Label>
                    <RadioYesNo name="cl32d" value={cl32.d_yes} onChange={v => updateClause(setCl32, "d_yes", v)} />
                    {cl32.d_yes === true && (
                      <Input type="number" placeholder="Amount (₹)" value={cl32.d_amount || ""} onChange={e => updateClause(setCl32, "d_amount", e.target.value)} className="max-w-xs" />
                    )}
                  </div>
                  <Separator />
                  {/* 32(e) */}
                  <div className="space-y-3 border-l-2 border-muted pl-4">
                    <Label className="font-medium">32(e) — Loss from specified business?</Label>
                    <RadioYesNo name="cl32e" value={cl32.e_yes} onChange={v => updateClause(setCl32, "e_yes", v)} />
                    {cl32.e_yes === true && (
                      <Input type="number" placeholder="Amount (₹)" value={cl32.e_amount || ""} onChange={e => updateClause(setCl32, "e_amount", e.target.value)} className="max-w-xs" />
                    )}
                  </div>
                </AccordionContent>
              </AccordionItem>
            </div>

            {/* ═══════ CLAUSE 33 — Deductions u/s 80G/80GGA/80GGB/80GGC ═══════ */}
            <div ref={el => { sectionRefs.current["cl_33"] = el; }}>
              <AccordionItem value="cl_33" className="border rounded-lg">
                <AccordionTrigger className="px-4">
                  <div className="flex items-center gap-3">
                    <Badge variant="outline" className="font-mono text-xs">33</Badge>
                    <span className="font-medium">Deductions u/s 80G / 80GGA / 80GGB / 80GGC</span>
                    {isClauseFilled(cl33) && <Badge className="bg-green-100 text-green-800 text-[10px]">Filled</Badge>}
                  </div>
                </AccordionTrigger>
                <AccordionContent className="px-4 pb-4 space-y-4">
                  <RadioYesNo name="cl33" value={cl33.yes} onChange={v => updateClause(setCl33, "yes", v)} />
                  {cl33.yes === true && (
                    <DropdownTable
                      dropdownCol={3}
                      dropdownLabel="Section"
                      dropdownOptions={DONATION_SECTION_OPTIONS}
                      columns={["Donee Name", "Address", "PAN", "Section", "Amount Donated (₹)", "Qualifying Amount (₹)", "Deduction Amount (₹)"]}
                      rows={cl33.rows || []}
                      onChange={rows => updateClause(setCl33, "rows", rows)}
                    />
                  )}
                  {cl33.yes === false && <div className="p-3 bg-muted rounded text-sm text-muted-foreground">NIL</div>}
                </AccordionContent>
              </AccordionItem>
            </div>

            {/* ═══════ CLAUSE 34 — TDS / TCS Compliance ═══════ */}
            <div ref={el => { sectionRefs.current["cl_34"] = el; }}>
              <AccordionItem value="cl_34" className="border rounded-lg">
                <AccordionTrigger className="px-4">
                  <div className="flex items-center gap-3">
                    <Badge variant="outline" className="font-mono text-xs">34</Badge>
                    <span className="font-medium">TDS / TCS Compliance</span>
                    {isClauseFilled(cl34) && <Badge className="bg-green-100 text-green-800 text-[10px]">Filled</Badge>}
                  </div>
                </AccordionTrigger>
                <AccordionContent className="px-4 pb-4 space-y-6">
                  {/* 34(a) */}
                  <div className="space-y-3 border-l-2 border-muted pl-4">
                    <Label className="font-medium">34(a) — Tax deducted as per provisions?</Label>
                    <RadioYesNo name="cl34a" value={cl34.a_yes} onChange={v => updateClause(setCl34, "a_yes", v)} />
                    {cl34.a_yes === true && (
                      <TDSComplianceTable rows={cl34.a_rows || []} onChange={rows => updateClause(setCl34, "a_rows", rows)} />
                    )}
                  </div>
                  <Separator />
                  {/* 34(b) */}
                  <div className="space-y-3 border-l-2 border-muted pl-4">
                    <Label className="font-medium">34(b) — TDS deposited timely?</Label>
                    <RadioYesNo name="cl34b" value={cl34.b_yes} onChange={v => updateClause(setCl34, "b_yes", v)} />
                    {cl34.b_yes === true && (
                      <TDSTimeliness rows={cl34.b_rows || []} onChange={rows => updateClause(setCl34, "b_rows", rows)} />
                    )}
                  </div>
                  <Separator />
                  {/* 34(c) */}
                  <div className="space-y-3 border-l-2 border-muted pl-4">
                    <Label className="font-medium">34(c) — TCS as per provisions?</Label>
                    <RadioYesNo name="cl34c" value={cl34.c_yes} onChange={v => updateClause(setCl34, "c_yes", v)} />
                    {cl34.c_yes === true && (
                      <TDSComplianceTable rows={cl34.c_rows || []} onChange={rows => updateClause(setCl34, "c_rows", rows)} />
                    )}
                  </div>
                </AccordionContent>
              </AccordionItem>
            </div>

            {/* Placeholder sections for clauses 35-44 */}
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

/** Generic table with one dropdown column */
function DropdownTable({ columns, rows, onChange, dropdownCol, dropdownLabel, dropdownOptions }: {
  columns: string[]; rows: string[][]; onChange: (rows: string[][]) => void;
  dropdownCol: number; dropdownLabel: string; dropdownOptions: string[];
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
            <TableRow><TableCell colSpan={columns.length + 1} className="text-center text-muted-foreground text-sm py-4">No rows. Click "+ Add Row".</TableCell></TableRow>
          )}
          {rows.map((row, ri) => (
            <TableRow key={ri}>
              {row.map((cell, ci) => (
                <TableCell key={ci} className="p-1">
                  {ci === dropdownCol ? (
                    <Select value={cell} onValueChange={v => updateCell(ri, ci, v)}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue placeholder={`Select ${dropdownLabel}`} /></SelectTrigger>
                      <SelectContent>
                        {dropdownOptions.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Input value={cell} onChange={e => updateCell(ri, ci, e.target.value)} className="h-8 text-xs" />
                  )}
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

/** TDS Schedule table (Clause 31a) with section dropdown + auto-fill nature */
function TDSScheduleTable({ rows, onChange, showDateOfDeposit = true }: {
  rows: { section: string; nature: string; name: string; pan: string; amountPaid: string; tdsDeducted: string; tdsRate: string; dateDeduction: string; dateDeposit: string; remarks: string }[];
  onChange: (r: any[]) => void;
  showDateOfDeposit?: boolean;
}) {
  const emptyRow = { section: "", nature: "", name: "", pan: "", amountPaid: "", tdsDeducted: "", tdsRate: "", dateDeduction: "", dateDeposit: "", remarks: "" };
  function addRow() { onChange([...rows, { ...emptyRow }]); }
  function removeRow(i: number) { onChange(rows.filter((_, idx) => idx !== i)); }
  function update(i: number, key: string, val: string) {
    const updated = rows.map((r, idx) => {
      if (idx !== i) return r;
      const next = { ...r, [key]: val };
      if (key === "section") next.nature = TDS_SECTIONS[val] || "";
      return next;
    });
    onChange(updated);
  }

  const totalPaid = rows.reduce((s, r) => s + (parseFloat(r.amountPaid || "0") || 0), 0);
  const totalTDS = rows.reduce((s, r) => s + (parseFloat(r.tdsDeducted || "0") || 0), 0);
  const fmt = (n: number) => n.toLocaleString("en-IN", { minimumFractionDigits: 2 });

  return (
    <div className="space-y-2 overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="text-xs w-8">Sr</TableHead>
            <TableHead className="text-xs w-28">Section</TableHead>
            <TableHead className="text-xs w-40">Nature of Payment</TableHead>
            <TableHead className="text-xs">Name of Party</TableHead>
            <TableHead className="text-xs w-28">PAN</TableHead>
            <TableHead className="text-xs w-28">Amount Paid (₹)</TableHead>
            <TableHead className="text-xs w-28">TDS Deducted (₹)</TableHead>
            <TableHead className="text-xs w-20">Rate (%)</TableHead>
            <TableHead className="text-xs w-28">Date of Deduction</TableHead>
            {showDateOfDeposit && <TableHead className="text-xs w-28">Date of Deposit</TableHead>}
            <TableHead className="text-xs w-28">Remarks</TableHead>
            <TableHead className="w-10" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 && (
            <TableRow><TableCell colSpan={showDateOfDeposit ? 12 : 11} className="text-center text-muted-foreground text-sm py-4">No rows. Click "+ Add Row".</TableCell></TableRow>
          )}
          {rows.map((row, i) => (
            <TableRow key={i}>
              <TableCell className="p-1 text-xs text-center text-muted-foreground">{i + 1}</TableCell>
              <TableCell className="p-1">
                <Select value={row.section} onValueChange={v => update(i, "section", v)}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Sec" /></SelectTrigger>
                  <SelectContent className="max-h-60">
                    {TDS_SECTION_KEYS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </TableCell>
              <TableCell className="p-1 text-xs text-muted-foreground">{row.nature || "—"}</TableCell>
              <TableCell className="p-1"><Input value={row.name} onChange={e => update(i, "name", e.target.value)} className="h-8 text-xs" /></TableCell>
              <TableCell className="p-1"><Input value={row.pan} onChange={e => update(i, "pan", e.target.value)} className="h-8 text-xs" /></TableCell>
              <TableCell className="p-1"><Input type="number" value={row.amountPaid} onChange={e => update(i, "amountPaid", e.target.value)} className="h-8 text-xs" /></TableCell>
              <TableCell className="p-1"><Input type="number" value={row.tdsDeducted} onChange={e => update(i, "tdsDeducted", e.target.value)} className="h-8 text-xs" /></TableCell>
              <TableCell className="p-1"><Input type="number" value={row.tdsRate} onChange={e => update(i, "tdsRate", e.target.value)} className="h-8 text-xs" /></TableCell>
              <TableCell className="p-1"><Input type="date" value={row.dateDeduction} onChange={e => update(i, "dateDeduction", e.target.value)} className="h-8 text-xs" /></TableCell>
              {showDateOfDeposit && <TableCell className="p-1"><Input type="date" value={row.dateDeposit} onChange={e => update(i, "dateDeposit", e.target.value)} className="h-8 text-xs" /></TableCell>}
              <TableCell className="p-1"><Input value={row.remarks} onChange={e => update(i, "remarks", e.target.value)} className="h-8 text-xs" /></TableCell>
              <TableCell className="p-1">
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => removeRow(i)}><Trash2 className="h-3 w-3 text-destructive" /></Button>
              </TableCell>
            </TableRow>
          ))}
          {rows.length > 0 && (
            <TableRow className="bg-muted/20 font-semibold text-xs">
              <TableCell colSpan={5} className="p-1 text-right">Totals</TableCell>
              <TableCell className="p-1 text-right">{fmt(totalPaid)}</TableCell>
              <TableCell className="p-1 text-right">{fmt(totalTDS)}</TableCell>
              <TableCell colSpan={showDateOfDeposit ? 5 : 4} />
            </TableRow>
          )}
        </TableBody>
      </Table>
      <Button variant="outline" size="sm" onClick={addRow}><Plus className="h-3 w-3 mr-1" /> Add Row</Button>
    </div>
  );
}

/** TDS Compliance table (Clause 34a) with shortfall auto-calc */
function TDSComplianceTable({ rows, onChange }: {
  rows: { section: string; nature: string; amount: string; tdsDeducted: string; tdsRequired: string }[];
  onChange: (r: any[]) => void;
}) {
  const emptyRow = { section: "", nature: "", amount: "", tdsDeducted: "", tdsRequired: "" };
  function addRow() { onChange([...rows, { ...emptyRow }]); }
  function removeRow(i: number) { onChange(rows.filter((_, idx) => idx !== i)); }
  function update(i: number, key: string, val: string) {
    const updated = rows.map((r, idx) => {
      if (idx !== i) return r;
      const next = { ...r, [key]: val };
      if (key === "section") next.nature = TDS_SECTIONS[val] || "";
      return next;
    });
    onChange(updated);
  }
  const fmt = (n: number) => n.toLocaleString("en-IN", { minimumFractionDigits: 2 });

  return (
    <div className="space-y-2">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="text-xs w-28">Section</TableHead>
            <TableHead className="text-xs">Nature</TableHead>
            <TableHead className="text-xs w-28">Amount (₹)</TableHead>
            <TableHead className="text-xs w-28">TDS Deducted (₹)</TableHead>
            <TableHead className="text-xs w-28">TDS Required (₹)</TableHead>
            <TableHead className="text-xs w-28 bg-muted/50">Shortfall (₹)</TableHead>
            <TableHead className="w-10" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 && (
            <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground text-sm py-4">No rows. Click "+ Add Row".</TableCell></TableRow>
          )}
          {rows.map((row, i) => {
            const shortfall = (parseFloat(row.tdsRequired || "0") || 0) - (parseFloat(row.tdsDeducted || "0") || 0);
            return (
              <TableRow key={i}>
                <TableCell className="p-1">
                  <Select value={row.section} onValueChange={v => update(i, "section", v)}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Sec" /></SelectTrigger>
                    <SelectContent className="max-h-60">
                      {TDS_SECTION_KEYS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell className="p-1 text-xs text-muted-foreground">{row.nature || "—"}</TableCell>
                <TableCell className="p-1"><Input type="number" value={row.amount} onChange={e => update(i, "amount", e.target.value)} className="h-8 text-xs" /></TableCell>
                <TableCell className="p-1"><Input type="number" value={row.tdsDeducted} onChange={e => update(i, "tdsDeducted", e.target.value)} className="h-8 text-xs" /></TableCell>
                <TableCell className="p-1"><Input type="number" value={row.tdsRequired} onChange={e => update(i, "tdsRequired", e.target.value)} className="h-8 text-xs" /></TableCell>
                <TableCell className="p-1 bg-muted/30 text-xs text-right font-medium">{fmt(shortfall)}</TableCell>
                <TableCell className="p-1">
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => removeRow(i)}><Trash2 className="h-3 w-3 text-destructive" /></Button>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      <Button variant="outline" size="sm" onClick={addRow}><Plus className="h-3 w-3 mr-1" /> Add Row</Button>
    </div>
  );
}

/** TDS Timeliness table (Clause 34b) with delay auto-calc */
function TDSTimeliness({ rows, onChange }: {
  rows: { section: string; amount: string; dueDate: string; actualDate: string }[];
  onChange: (r: any[]) => void;
}) {
  function addRow() { onChange([...rows, { section: "", amount: "", dueDate: "", actualDate: "" }]); }
  function removeRow(i: number) { onChange(rows.filter((_, idx) => idx !== i)); }
  function update(i: number, key: string, val: string) {
    onChange(rows.map((r, idx) => idx === i ? { ...r, [key]: val } : r));
  }
  function calcDelay(due: string, actual: string): string {
    if (!due || !actual) return "—";
    const d = new Date(due); const a = new Date(actual);
    const diff = Math.ceil((a.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
    return diff > 0 ? `${diff} days` : "On time";
  }
  return (
    <div className="space-y-2">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="text-xs w-28">Section</TableHead>
            <TableHead className="text-xs w-28">Amount (₹)</TableHead>
            <TableHead className="text-xs w-32">Due Date</TableHead>
            <TableHead className="text-xs w-32">Actual Date</TableHead>
            <TableHead className="text-xs w-24 bg-muted/50">Delay</TableHead>
            <TableHead className="w-10" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 && (
            <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground text-sm py-4">No rows. Click "+ Add Row".</TableCell></TableRow>
          )}
          {rows.map((row, i) => (
            <TableRow key={i}>
              <TableCell className="p-1"><Input value={row.section} onChange={e => update(i, "section", e.target.value)} className="h-8 text-xs" /></TableCell>
              <TableCell className="p-1"><Input type="number" value={row.amount} onChange={e => update(i, "amount", e.target.value)} className="h-8 text-xs" /></TableCell>
              <TableCell className="p-1"><Input type="date" value={row.dueDate} onChange={e => update(i, "dueDate", e.target.value)} className="h-8 text-xs" /></TableCell>
              <TableCell className="p-1"><Input type="date" value={row.actualDate} onChange={e => update(i, "actualDate", e.target.value)} className="h-8 text-xs" /></TableCell>
              <TableCell className="p-1 bg-muted/30 text-xs text-center font-medium">{calcDelay(row.dueDate, row.actualDate)}</TableCell>
              <TableCell className="p-1">
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => removeRow(i)}><Trash2 className="h-3 w-3 text-destructive" /></Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <Button variant="outline" size="sm" onClick={addRow}><Plus className="h-3 w-3 mr-1" /> Add Row</Button>
    </div>
  );
}
