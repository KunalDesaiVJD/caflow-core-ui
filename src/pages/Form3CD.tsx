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
  cl_8: ClauseData; cl_9: ClauseData; cl_10: ClauseData;
  cl_11: ClauseData; cl_12: ClauseData; cl_13: ClauseData;
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
  { key: "cl_14", label: "14", title: "Capital Account of Partners" },
  { key: "cl_15_16", label: "15-16", title: "Amounts not allowable" },
  { key: "cl_17", label: "17", title: "Amounts admissible u/s 30-36" },
  { key: "cl_18", label: "18", title: "Depreciation allowable" },
  { key: "cl_19", label: "19", title: "Sections 33AB, 33ABA, 33AC" },
  { key: "cl_20", label: "20", title: "Deduction under Chapter VI-A" },
  { key: "cl_21", label: "21", title: "TDS/TCS Compliance" },
  { key: "cl_22", label: "22", title: "Payment to specified persons" },
  { key: "cl_23", label: "23", title: "Interest payment u/s 40(b)" },
  { key: "cl_24_25", label: "24-25", title: "Disallowance/deemed income" },
  { key: "cl_26", label: "26", title: "Undisclosed investments" },
  { key: "cl_27", label: "27", title: "Section 28 income" },
  { key: "cl_29", label: "29", title: "Foreign remittances" },
  { key: "cl_30", label: "30", title: "Transfer pricing adjustments" },
  { key: "cl_31", label: "31", title: "TDS particulars" },
  { key: "cl_32", label: "32", title: "Business receipts" },
  { key: "cl_33", label: "33", title: "Conversion of assets" },
  { key: "cl_34", label: "34", title: "Accounting standards" },
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

const TAXATION_SCHEME_OPTIONS = [
  "115BA", "115BAA", "115BAB", "115BAC", "115BAD", "115BAE",
];

const STOCK_VALUATION_OPTIONS = [
  "Cost or Market Value whichever is lower",
  "Cost",
  "Market Value",
  "Other (specify)",
];

const ICDS_LIST = [
  "ICDS I — Accounting Policies",
  "ICDS II — Valuation of Inventories",
  "ICDS III — Construction Contracts",
  "ICDS IV — Revenue Recognition",
  "ICDS V — Tangible Fixed Assets",
  "ICDS VI — Effects of Changes in Foreign Exchange Rates",
  "ICDS VII — Government Grants",
  "ICDS VIII — Securities",
  "ICDS IX — Borrowing Costs",
  "ICDS X — Provisions, Contingent Liabilities and Contingent Assets",
];

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
    if (typeof v === "object" && v !== null) return Object.keys(v).length > 0;
    return false;
  });
}

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

  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // Load data
  useEffect(() => {
    if (!engagementId) { setLoading(false); return; }
    loadData();
  }, [engagementId]);

  async function loadData() {
    setLoading(true);
    // Fetch engagement + client
    const { data: eng } = await supabase
      .from("audit_engagements")
      .select("*, clients(*)")
      .eq("id", engagementId!)
      .single();

    if (!eng) { setLoading(false); toast.error("Engagement not found"); return; }
    setEngagement(eng);
    setClient((eng as any).clients);

    // Fetch or create form_3cd row
    const { data: existing } = await supabase
      .from("form_3cd" as any)
      .select("*")
      .eq("engagement_id", engagementId!)
      .maybeSingle();

    if (existing) {
      setFormRow(existing as any);
      setFormStatus((existing as any).status || "draft");
      setCl8((existing as any).cl_8 || {});
      setCl9((existing as any).cl_9 || {});
      setCl10((existing as any).cl_10 || {});
      setCl11((existing as any).cl_11 || {});
      setCl12((existing as any).cl_12 || {});
      setCl13((existing as any).cl_13 || {});
    } else {
      // Create new row
      const fy = eng.financial_year || "";
      const ay = computeAY(fy);
      const { data: created } = await supabase
        .from("form_3cd" as any)
        .insert({
          engagement_id: engagementId,
          firm_id: eng.firm_id,
          client_id: eng.client_id,
          financial_year: fy,
          assessment_year: ay,
          status: "draft",
        } as any)
        .select()
        .single();
      if (created) setFormRow(created as any);
    }
    setLoading(false);
  }

  // Auto-save debounce
  const triggerAutoSave = useCallback(() => {
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(() => saveAll(true), 3000);
  }, [formRow]);

  // Update clause and trigger auto-save
  function updateClause(setter: React.Dispatch<React.SetStateAction<ClauseData>>, key: string, value: any) {
    setter(prev => {
      const next = { ...prev, [key]: value };
      triggerAutoSave();
      return next;
    });
  }

  // Save all
  async function saveAll(silent = false) {
    if (!formRow) return;
    setSaving(true);
    const { error } = await supabase
      .from("form_3cd" as any)
      .update({
        cl_8: cl8, cl_9: cl9, cl_10: cl10, cl_11: cl11, cl_12: cl12, cl_13: cl13,
        status: formStatus,
        last_saved_at: new Date().toISOString(),
        last_saved_by: user?.id,
      } as any)
      .eq("id", formRow.id);
    setSaving(false);
    if (error) { if (!silent) toast.error("Save failed: " + error.message); }
    else { if (!silent) toast.success("Form 3CD saved"); }
  }

  // Scroll to clause
  function scrollToClause(key: string) {
    sectionRefs.current[key]?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const fy = engagement?.financial_year || "";
  const ay = computeAY(fy);

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>;
  if (!engagementId) return <div className="p-8 text-center text-muted-foreground">Please open Form 3CD from an engagement pipeline (Stage 8).</div>;

  return (
    <div className="flex gap-0 h-[calc(100vh-4rem)]">
      {/* LEFT SIDEBAR NAV */}
      <div className="w-56 shrink-0 border-r bg-muted/30">
        <ScrollArea className="h-full">
          <div className="p-3 space-y-0.5">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Clauses</p>
            {CLAUSE_NAV.map(c => {
              const filled = isClauseFilled(
                c.key === "cl_8" ? cl8 : c.key === "cl_9" ? cl9 : c.key === "cl_10" ? cl10 :
                c.key === "cl_11" ? cl11 : c.key === "cl_12" ? cl12 : c.key === "cl_13" ? cl13 : undefined
              );
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
          <Accordion type="multiple" defaultValue={["cl_8", "cl_9", "cl_10", "cl_11", "cl_12", "cl_13"]} className="space-y-4">
            {/* CLAUSE 8 */}
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

            {/* CLAUSE 9 */}
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
                  {/* 9(a) */}
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
                  {/* 9(b) */}
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

            {/* CLAUSE 10 */}
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
                  {/* 10(a) */}
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
                  {/* 10(b) */}
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

            {/* CLAUSE 11 */}
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
                  {/* 11(a) */}
                  <div className="space-y-2">
                    <Label>11(a) Whether method of accounting employed is the same as in the preceding year?</Label>
                    <div className="flex gap-4">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input type="radio" name="cl11a" checked={cl11.sameMethod === true} onChange={() => updateClause(setCl11, "sameMethod", true)} /> Yes
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input type="radio" name="cl11a" checked={cl11.sameMethod === false} onChange={() => updateClause(setCl11, "sameMethod", false)} /> No
                      </label>
                    </div>
                  </div>
                  <Separator />
                  {/* 11(b) */}
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
                  {/* 11(c) */}
                  <div className="space-y-2">
                    <Label>11(c) Method of valuation of closing stock</Label>
                    <Select value={cl11.stockValuation || ""} onValueChange={v => updateClause(setCl11, "stockValuation", v)}>
                      <SelectTrigger><SelectValue placeholder="Select method" /></SelectTrigger>
                      <SelectContent>
                        {STOCK_VALUATION_OPTIONS.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    {cl11.stockValuation === "Other (specify)" && (
                      <Input
                        value={cl11.stockValuationOther || ""}
                        onChange={e => updateClause(setCl11, "stockValuationOther", e.target.value)}
                        placeholder="Specify method..."
                        className="mt-2"
                      />
                    )}
                  </div>
                </AccordionContent>
              </AccordionItem>
            </div>

            {/* CLAUSE 12 */}
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
                    <div className="flex gap-4">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input type="radio" name="cl12" checked={cl12.converted === true} onChange={() => updateClause(setCl12, "converted", true)} /> Yes
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input type="radio" name="cl12" checked={cl12.converted === false} onChange={() => updateClause(setCl12, "converted", false)} /> No
                      </label>
                    </div>
                  </div>
                  {cl12.converted === true && (
                    <EditableTable
                      columns={["Description of Capital Asset", "Date of Acquisition", "Cost of Acquisition (₹)", "Amount at which Converted (₹)", "Date of Conversion"]}
                      rows={cl12.conversionRows || []}
                      onChange={rows => updateClause(setCl12, "conversionRows", rows)}
                    />
                  )}
                  {cl12.converted === false && (
                    <div className="p-3 bg-muted rounded text-sm text-muted-foreground">NIL</div>
                  )}
                </AccordionContent>
              </AccordionItem>
            </div>

            {/* CLAUSE 13 */}
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
                  {/* 13(a) */}
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

                  {/* 13(b) */}
                  <div className="space-y-2">
                    <Label>13(b) Whether previous year method different from preceding year?</Label>
                    <div className="flex gap-4">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input type="radio" name="cl13b" checked={cl13.methodDifferent === true} onChange={() => updateClause(setCl13, "methodDifferent", true)} /> Yes
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input type="radio" name="cl13b" checked={cl13.methodDifferent === false} onChange={() => updateClause(setCl13, "methodDifferent", false)} /> No
                      </label>
                    </div>
                  </div>

                  {/* 13(c) */}
                  {cl13.methodDifferent === true ? (
                    <div className="space-y-2">
                      <Label>13(c) Particulars of effect on profit/loss</Label>
                      <EditableTable
                        columns={["Particulars", "Increase in Profit (₹)", "Decrease in Profit (₹)"]}
                        rows={cl13.methodDiffRows || []}
                        onChange={rows => updateClause(setCl13, "methodDiffRows", rows)}
                      />
                    </div>
                  ) : cl13.methodDifferent === false ? (
                    <div className="p-3 bg-muted rounded text-sm text-muted-foreground">13(c) Not applicable — method unchanged.</div>
                  ) : null}

                  <Separator />

                  {/* 13(d) */}
                  <div className="space-y-2">
                    <Label>13(d) Whether ICDS applicable and if so any deviation?</Label>
                    <div className="flex gap-4">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input type="radio" name="cl13d" checked={cl13.icdsDeviation === true} onChange={() => updateClause(setCl13, "icdsDeviation", true)} /> Yes
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input type="radio" name="cl13d" checked={cl13.icdsDeviation === false} onChange={() => updateClause(setCl13, "icdsDeviation", false)} /> No
                      </label>
                    </div>
                  </div>

                  {/* 13(e) */}
                  {cl13.icdsDeviation === true ? (
                    <div className="space-y-2">
                      <Label>13(e) Details of ICDS deviation</Label>
                      <ICDSTable
                        rows={cl13.icdsDeviationRows || []}
                        onChange={rows => updateClause(setCl13, "icdsDeviationRows", rows)}
                      />
                    </div>
                  ) : cl13.icdsDeviation === false ? (
                    <div className="p-3 bg-muted rounded text-sm text-muted-foreground">13(e) Not applicable — no ICDS deviation.</div>
                  ) : null}

                  <Separator />

                  {/* 13(f) */}
                  <div className="space-y-2">
                    <Label>13(f) Whether any adjustment required as per ICDS?</Label>
                    <div className="flex gap-4">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input type="radio" name="cl13f" checked={cl13.icdsAdjustment === true} onChange={() => updateClause(setCl13, "icdsAdjustment", true)} /> Applicable
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input type="radio" name="cl13f" checked={cl13.icdsAdjustment === false} onChange={() => updateClause(setCl13, "icdsAdjustment", false)} /> N/A
                      </label>
                    </div>
                  </div>

                  {cl13.icdsAdjustment === true ? (
                    <div className="space-y-2">
                      <Label>ICDS Adjustment Details</Label>
                      <EditableTable
                        columns={["ICDS", "Net Adjustment (Increase) ₹", "Net Adjustment (Decrease) ₹"]}
                        rows={cl13.icdsAdjustmentRows || []}
                        onChange={rows => updateClause(setCl13, "icdsAdjustmentRows", rows)}
                      />
                    </div>
                  ) : cl13.icdsAdjustment === false ? (
                    <div className="p-3 bg-muted rounded text-sm text-muted-foreground">No ICDS adjustments applicable.</div>
                  ) : null}
                </AccordionContent>
              </AccordionItem>
            </div>

            {/* Placeholder sections for clauses 14-44 */}
            {CLAUSE_NAV.filter(c => !["cl_8","cl_9","cl_10","cl_11","cl_12","cl_13"].includes(c.key)).map(c => (
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

/* ──────── SUB-COMPONENTS ──────── */

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
          <Select value={selectedSector} onValueChange={v => { onSectorChange(v); }}>
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
