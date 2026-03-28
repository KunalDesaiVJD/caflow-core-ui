import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { Save, Loader2, CheckCircle2, Circle, Download, Printer, FileSpreadsheet } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { exportToPdf, exportToExcel } from "@/lib/exportUtils";

import { FORM_3CD_CLAUSES } from "@/data/form3cd-clauses";
import type { ClauseDefinition } from "@/data/form3cd-master";
import ClauseRenderer from "@/components/form3cd/ClauseRenderer";
import Form3CDReport from "@/components/form3cd/Form3CDReport";

/* ──────── types ──────── */
interface ClauseData { [key: string]: any; }

/* ──────── helpers ──────── */
function computeAY(fy: string | null): string {
  if (!fy) return "";
  const match = fy.match(/(\d{4})/);
  if (!match) return "";
  const startYear = parseInt(match[1]);
  return `${startYear + 1}-${String(startYear + 2).slice(2)}`;
}

function computeFYDates(fy: string | null): { from: string; to: string } {
  if (!fy) return { from: "", to: "" };
  const match = fy.match(/(\d{4})/);
  if (!match) return { from: "", to: "" };
  const start = parseInt(match[1]);
  return { from: `01/04/${start}`, to: `31/03/${start + 1}` };
}

const ENTITY_STATUS_OPTIONS = [
  'Individual', 'HUF', 'Firm', 'AOP/BOI', 'Company', 'Trust', 'Others'
];

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

function clauseStateKey(clauseNo: string): string {
  return `cl_${clauseNo}`;
}

// Maps clauseNo to its actual DB column in form_3cd table
// DB columns: cl_8, cl_9, cl_10, cl_11, cl_12, cl_13, cl_14, cl_15_16, cl_17, cl_18,
// cl_19, cl_20, cl_21, cl_22, cl_23, cl_24_25, cl_26, cl_27, cl_29, cl_30, cl_31,
// cl_32, cl_33, cl_34, cl_35, cl_36, cl_37_39, cl_40, cl_41, cl_42_43, cl_44
const CLAUSE_DB_MAP: Record<string, string> = {
  '15': 'cl_15_16', '16': 'cl_15_16',
  '24': 'cl_24_25', '25': 'cl_24_25',
  '28': 'cl_29', // no cl_28 column — store with cl_29
  '37': 'cl_37_39', '38': 'cl_37_39', '39': 'cl_37_39',
  '42': 'cl_42_43', '43': 'cl_42_43',
};
function clauseDbColumn(clauseNo: string): string {
  // Extract the base number (e.g. "10a" → "10", "13f" → "13")
  const baseMatch = clauseNo.match(/^(\d+)/);
  const baseNum = baseMatch ? baseMatch[1] : clauseNo;
  // Check explicit map first
  if (CLAUSE_DB_MAP[baseNum]) return CLAUSE_DB_MAP[baseNum];
  // Default: cl_{baseNum}
  return `cl_${baseNum}`;
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
  const [formRow, setFormRow] = useState<any>(null);
  const [formStatus, setFormStatus] = useState<string>("draft");
  const [showPrintView, setShowPrintView] = useState(false);

  // Single state object for all clause data — keyed by cl_{clauseNo}
  const [clauseData, setClauseData] = useState<Record<string, ClauseData>>({});

  // Clauses 1-7 editable state
  const [cl17, setCl17] = useState<{ indirectTaxLiable?: boolean; indirectTaxDetails?: string; statusOverride?: string }>({});

  // Sorted active clauses
  const activeClauses = useMemo(() =>
    FORM_3CD_CLAUSES
      .filter(c => c.isActive)
      .sort((a, b) => a.displayOrder - b.displayOrder),
    []
  );

  // Dynamic clause titles from DB (optional override)
  const [dbTitles, setDbTitles] = useState<Map<string, string>>(new Map());

  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // Fetch dynamic titles
  useEffect(() => {
    (async () => {
      const { data: templates } = await supabase
        .from("threecd_master_templates")
        .select("clause_number, heading")
        .order("clause_number");
      if (templates && templates.length > 0) {
        const map = new Map<string, string>();
        (templates as any[]).forEach((t: any) => map.set(t.clause_number, t.heading));
        setDbTitles(map);
      }
    })();
  }, []);

  // Load data
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

    if (!eng || !(eng as any).clients) { setLoading(false); toast.error("Engagement not found"); return; }
    const clientData = (eng as any).clients;
    // Filter out draft/deleted clients
    if (clientData?.is_draft === true || clientData?.deleted_at != null) {
      setLoading(false); toast.error("Client is archived or in draft"); return;
    }
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
      // Load all clause data from the row
      const loaded: Record<string, ClauseData> = {};
      activeClauses.forEach(c => {
        const stateKey = clauseStateKey(c.clauseNo);
        const dbCol = clauseDbColumn(c.clauseNo);
        const dbData = e[dbCol];
        // If the DB column stores grouped sub-clauses, extract by clauseNo
        if (dbData && typeof dbData === 'object' && c.clauseNo in dbData) {
          loaded[stateKey] = (dbData as any)[c.clauseNo];
        } else if (dbData && typeof dbData === 'object') {
          // Check if data is stored flat (legacy) or is the direct value
          loaded[stateKey] = dbData;
        } else {
          loaded[stateKey] = {};
        }
      });
      setClauseData(loaded);
      // Load clauses 1-7 editable data
      // Load clauses 1-7 editable data (stored inside cl_8._cl17)
      if (e.cl_8 && typeof e.cl_8 === 'object' && (e.cl_8 as any)._cl17) {
        setCl17((e.cl_8 as any)._cl17);
      } else if (e.cl_1_7 && typeof e.cl_1_7 === 'object') {
        // Legacy fallback
        setCl17(e.cl_1_7);
      }
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
  }, [formRow, clauseData]);

  function updateClauseData(clauseNo: string, value: ClauseData) {
    const key = clauseStateKey(clauseNo);
    setClauseData(prev => {
      const next = { ...prev, [key]: value };
      // Trigger autosave
      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
      autoSaveTimer.current = setTimeout(() => saveAll(true), 3000);
      return next;
    });
  }

  async function saveAll(silent = false) {
    if (!formRow) return;
    setSaving(true);
    const updatePayload: any = {
      status: formStatus,
      last_saved_at: new Date().toISOString(),
      last_saved_by: user?.id,
    };
    // Group clause data by DB column (e.g. cl_9a + cl_9b → cl_9: { "9a": {...}, "9b": {...} })
    const dbGrouped: Record<string, any> = {};
    activeClauses.forEach(c => {
      const stateKey = clauseStateKey(c.clauseNo);
      const dbCol = clauseDbColumn(c.clauseNo);
      // Check if multiple clauses share the same DB column
      const siblingsInSameCol = activeClauses.filter(x => clauseDbColumn(x.clauseNo) === dbCol);
      if (siblingsInSameCol.length > 1) {
        // Group under parent column with clauseNo as sub-key
        if (!dbGrouped[dbCol]) dbGrouped[dbCol] = {};
        dbGrouped[dbCol][c.clauseNo] = clauseData[stateKey] || {};
      } else {
        // Single clause maps directly to DB column
        dbGrouped[dbCol] = clauseData[stateKey] || {};
      }
    });
    // Save clauses 1-7 editable data inside cl_8 (no separate cl_1_7 column exists)
    if (dbGrouped['cl_8'] && typeof dbGrouped['cl_8'] === 'object') {
      dbGrouped['cl_8']._cl17 = cl17;
    } else {
      dbGrouped['cl_8'] = { _cl17: cl17 };
    }
    Object.assign(updatePayload, dbGrouped);

    const { error } = await supabase
      .from("form_3cd" as any)
      .update(updatePayload as any)
      .eq("id", formRow.id);
    setSaving(false);
    if (error) { if (!silent) toast.error("Save failed: " + error.message); }
    else { if (!silent) toast.success("Form 3CD saved"); }
  }

  function scrollToClause(clauseNo: string) {
    sectionRefs.current[clauseNo]?.scrollIntoView({ behavior: "smooth", block: "start" });
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
            {activeClauses.map(c => {
              const key = clauseStateKey(c.clauseNo);
              const filled = isClauseFilled(clauseData[key]);
              const displayTitle = c.title;
              return (
                <button
                  key={c.clauseNo}
                  onClick={() => scrollToClause(c.clauseNo)}
                  className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-left text-xs hover:bg-accent transition-colors"
                >
                  {filled
                    ? <CheckCircle2 className="h-3 w-3 text-green-500 shrink-0" />
                    : <Circle className="h-3 w-3 text-muted-foreground/40 shrink-0" />}
                  <span className="font-mono text-[11px] text-muted-foreground w-8">{c.clauseNo.replace('_', '-')}</span>
                  <span className="truncate">{displayTitle}</span>
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
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  <Download className="h-4 w-4 mr-1" /> Export
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setShowPrintView(true)}>
                  <Printer className="h-4 w-4 mr-2" /> Preview & Print
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => {
                  setShowPrintView(true);
                  setTimeout(() => {
                    const el = document.querySelector('.print-view') as HTMLElement;
                    if (el) exportToPdf(el, `Form-3CD_${client?.name || 'report'}_${fy}.pdf`);
                  }, 800);
                }}>
                  <Download className="h-4 w-4 mr-2" /> Export PDF
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => {
                  const excelRows = activeClauses.map(c => {
                    const key = clauseStateKey(c.clauseNo);
                    const data = clauseData[key] || {};
                    const filled = isClauseFilled(data);
                    let answer = '';
                    if (filled) {
                      const entries = Object.entries(data).filter(([k]) => !k.startsWith('_'));
                      answer = entries
                        .filter(([, v]) => typeof v === 'string' && v.trim())
                        .map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v}`)
                        .join('\n');
                    }
                    return {
                      "Clause Number": c.clauseNo.replace('_', '-'),
                      "Clause Heading": c.title,
                      "Description": filled ? 'Filled' : 'Not Applicable / NIL',
                      "Answer": answer || (filled ? 'See detailed entries' : 'N/A'),
                    };
                  });
                  exportToExcel([{ sheetName: "Form 3CD", rows: excelRows }], `Form-3CD_${client?.name || 'report'}_${fy}.xlsx`);
                }}>
                  <FileSpreadsheet className="h-4 w-4 mr-2" /> Export Excel
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button size="sm" onClick={() => saveAll(false)} disabled={saving}>
              <Save className="h-4 w-4 mr-1" /> Save All
            </Button>
          </div>
        </div>

        <div className="p-6 max-w-5xl mx-auto space-y-8">
          {/* HEADER + CLAUSES 1-7 TABLE */}
          <Card>
            <CardContent className="p-6 space-y-4">
              <div className="text-center space-y-1">
                <p className="text-xs font-semibold text-muted-foreground uppercase">FORM NO. 3CD</p>
                <p className="text-xs text-muted-foreground">[See rule 6G(2)]</p>
                <p className="text-sm font-medium">Statement of particulars required to be furnished under section 44AB of the Income-tax Act, 1961</p>
              </div>
              <Separator />
              {/* Clauses 1-7 Vertical Table */}
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted">
                    <TableHead className="w-16 font-semibold">Sr. No.</TableHead>
                    <TableHead className="font-semibold">Particulars</TableHead>
                    <TableHead className="w-[320px] font-semibold">Details</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow className="bg-background">
                    <TableCell className="font-mono text-muted-foreground">1</TableCell>
                    <TableCell>Name of the assessee</TableCell>
                    <TableCell className="text-muted-foreground font-medium">{client?.name || "—"}</TableCell>
                  </TableRow>
                  <TableRow className="bg-muted/30">
                    <TableCell className="font-mono text-muted-foreground">2</TableCell>
                    <TableCell>Address</TableCell>
                    <TableCell className="text-muted-foreground font-medium">{client?.address || client?.registered_office || "—"}</TableCell>
                  </TableRow>
                  <TableRow className="bg-background">
                    <TableCell className="font-mono text-muted-foreground">3</TableCell>
                    <TableCell>Permanent Account Number</TableCell>
                    <TableCell className="text-muted-foreground font-medium font-mono tracking-wider">{client?.pan || "—"}</TableCell>
                  </TableRow>
                  <TableRow className="bg-muted/30">
                    <TableCell className="font-mono text-muted-foreground">4</TableCell>
                    <TableCell>Whether the assessee is liable to pay indirect tax (GST, Excise, etc.)?</TableCell>
                    <TableCell>
                      <div className="space-y-2">
                        <RadioGroup
                          value={cl17.indirectTaxLiable === true ? 'yes' : cl17.indirectTaxLiable === false ? 'no' : ''}
                          onValueChange={v => setCl17(prev => ({ ...prev, indirectTaxLiable: v === 'yes', indirectTaxDetails: v === 'no' ? '' : prev.indirectTaxDetails }))}
                          className="flex gap-4"
                        >
                          <div className="flex items-center gap-1.5">
                            <RadioGroupItem value="yes" id="cl4-yes" />
                            <Label htmlFor="cl4-yes" className="text-sm cursor-pointer">Yes</Label>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <RadioGroupItem value="no" id="cl4-no" />
                            <Label htmlFor="cl4-no" className="text-sm cursor-pointer">No</Label>
                          </div>
                        </RadioGroup>
                        {cl17.indirectTaxLiable === true && (
                          <Input
                            placeholder="Registration No. / Details"
                            value={cl17.indirectTaxDetails || ''}
                            onChange={e => setCl17(prev => ({ ...prev, indirectTaxDetails: e.target.value }))}
                            className="h-8 text-sm"
                          />
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                  <TableRow className="bg-background">
                    <TableCell className="font-mono text-muted-foreground">5</TableCell>
                    <TableCell>Status</TableCell>
                    <TableCell>
                      {client?.entity_type ? (
                        <span className="text-muted-foreground font-medium">{client.entity_type}</span>
                      ) : (
                        <Select value={cl17.statusOverride || ''} onValueChange={v => setCl17(prev => ({ ...prev, statusOverride: v }))}>
                          <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Select status..." /></SelectTrigger>
                          <SelectContent>
                            {ENTITY_STATUS_OPTIONS.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      )}
                    </TableCell>
                  </TableRow>
                  <TableRow className="bg-muted/30">
                    <TableCell className="font-mono text-muted-foreground">6</TableCell>
                    <TableCell>Previous year</TableCell>
                    <TableCell className="text-muted-foreground font-medium">
                      {computeFYDates(fy).from ? `From: ${computeFYDates(fy).from}  To: ${computeFYDates(fy).to}` : "—"}
                    </TableCell>
                  </TableRow>
                  <TableRow className="bg-background">
                    <TableCell className="font-mono text-muted-foreground">7</TableCell>
                    <TableCell>Assessment year</TableCell>
                    <TableCell className="text-muted-foreground font-medium">{ay || "—"}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* CLAUSES 8+ — Data-driven rendering */}
          <Accordion type="multiple" defaultValue={[activeClauses[0]?.clauseNo || '']} className="space-y-4">
            {activeClauses.map(clause => {
              const key = clauseStateKey(clause.clauseNo);
              const filled = isClauseFilled(clauseData[key]);
              const displayNo = clause.clauseNo.replace('_', '-');
              const displayHeading = clause.heading;

              // Handle top-level dependsOn — check if parent clause value matches
              if (clause.dependsOn) {
                const parentKey = clauseStateKey(clause.dependsOn);
                const parentData = clauseData[parentKey];
                const parentValue = parentData?._value;
                const requiredValue = clause.dependsOnValue ?? true;
                if (parentValue !== requiredValue) {
                  return (
                    <div key={clause.clauseNo} ref={el => { sectionRefs.current[clause.clauseNo] = el; }}>
                      <AccordionItem value={clause.clauseNo} className="border rounded-lg opacity-60">
                        <AccordionTrigger className="px-4">
                          <div className="flex items-center gap-3 text-left">
                            <Badge variant="outline" className="font-mono text-xs shrink-0">{displayNo}</Badge>
                            <span className="text-sm">{displayHeading}</span>
                            <Badge className="bg-muted text-muted-foreground text-[10px] shrink-0">Not Applicable</Badge>
                          </div>
                        </AccordionTrigger>
                        <AccordionContent className="px-4 pb-4">
                          <p className="text-sm text-muted-foreground italic">
                            This clause is not applicable because Clause {clause.dependsOn} is not answered "Yes".
                          </p>
                        </AccordionContent>
                      </AccordionItem>
                    </div>
                  );
                }
              }

              return (
                <div key={clause.clauseNo} ref={el => { sectionRefs.current[clause.clauseNo] = el; }}>
                  <AccordionItem value={clause.clauseNo} className="border rounded-lg">
                    <AccordionTrigger className="px-4">
                      <div className="flex items-center gap-3 text-left">
                        <Badge variant="outline" className="font-mono text-xs shrink-0">{displayNo}</Badge>
                        <span className="text-sm">{displayHeading}</span>
                        {filled && <Badge className="bg-green-100 text-green-800 text-[10px] shrink-0">Filled</Badge>}
                      </div>
                    </AccordionTrigger>
                    <AccordionContent className="px-4 pb-4 space-y-4">
                      <ClauseRenderer
                        definition={clause}
                        value={clauseData[key] || {}}
                        onChange={value => updateClauseData(clause.clauseNo, value)}
                        isLocked={formStatus === 'locked'}
                        client={client}
                      />
                      {/* Remarks field */}
                      <div className="pt-2 border-t border-border/50">
                        <Label className="text-xs text-muted-foreground">Remarks</Label>
                        <Textarea
                          placeholder="Remarks (optional)..."
                          value={(clauseData[key] || {}).remarks || ''}
                          onChange={e => updateClauseData(clause.clauseNo, { ...(clauseData[key] || {}), remarks: e.target.value })}
                          disabled={formStatus === 'locked'}
                          className="mt-1 text-sm"
                          rows={2}
                        />
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                </div>
              );
            })}
          </Accordion>
        </div>
      </div>

      {/* PRINT VIEW MODAL */}
      {showPrintView && (
        <Form3CDReport
          client={client}
          engagement={engagement}
          fy={fy}
          ay={ay}
          clauseData={clauseData}
          onClose={() => setShowPrintView(false)}
        />
      )}
    </div>
  );
}