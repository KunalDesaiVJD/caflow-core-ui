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

// Maps clauseNo like "10a" to its DB column "cl_10"
function clauseDbColumn(clauseNo: string): string {
  const match = clauseNo.match(/^(\d+(?:_\d+)?)/);
  return `cl_${match ? match[1] : clauseNo}`;
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
              const displayTitle = dbTitles.get(c.clauseNo) || c.title;
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

          {/* CLAUSES — Data-driven rendering */}
          <Accordion type="multiple" defaultValue={[activeClauses[0]?.clauseNo || '']} className="space-y-4">
            {activeClauses.map(clause => {
              const key = clauseStateKey(clause.clauseNo);
              const filled = isClauseFilled(clauseData[key]);
              const displayNo = clause.clauseNo.replace('_', '-');
              const displayTitle = dbTitles.get(clause.clauseNo) || clause.title;

              // Handle top-level dependsOn — check if parent clause value matches
              if (clause.dependsOn) {
                const parentKey = clauseStateKey(clause.dependsOn);
                const parentData = clauseData[parentKey];
                const parentValue = parentData?._value;
                const requiredValue = clause.dependsOnValue ?? true;
                if (parentValue !== requiredValue) {
                  // Show as disabled/not applicable
                  return (
                    <div key={clause.clauseNo} ref={el => { sectionRefs.current[clause.clauseNo] = el; }}>
                      <AccordionItem value={clause.clauseNo} className="border rounded-lg opacity-60">
                        <AccordionTrigger className="px-4">
                          <div className="flex items-center gap-3">
                            <Badge variant="outline" className="font-mono text-xs">{displayNo}</Badge>
                            <span className="font-medium">{displayTitle}</span>
                            <Badge className="bg-muted text-muted-foreground text-[10px]">Not Applicable</Badge>
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
                      <div className="flex items-center gap-3">
                        <Badge variant="outline" className="font-mono text-xs">{displayNo}</Badge>
                        <span className="font-medium">{displayTitle}</span>
                        {filled && <Badge className="bg-green-100 text-green-800 text-[10px]">Filled</Badge>}
                      </div>
                    </AccordionTrigger>
                    <AccordionContent className="px-4 pb-4 space-y-4">
                      <ClauseRenderer
                        definition={clause}
                        value={clauseData[key] || {}}
                        onChange={value => updateClauseData(clause.clauseNo, value)}
                        isLocked={formStatus === 'locked'}
                      />
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
        <Form3CDPrintView
          client={client}
          engagement={engagement}
          fy={fy}
          ay={ay}
          clauseData={clauseData}
          activeClauses={activeClauses}
          onClose={() => setShowPrintView(false)}
        />
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════
   PRINT VIEW
   ══════════════════════════════════════════════════════ */
function Form3CDPrintView({ client, engagement, fy, ay, clauseData, activeClauses, onClose }: {
  client: any; engagement: any; fy: string; ay: string;
  clauseData: Record<string, ClauseData>;
  activeClauses: ClauseDefinition[];
  onClose: () => void;
}) {
  const printRef = useRef<HTMLDivElement>(null);

  function renderClauseValue(key: string, data: ClauseData): React.ReactNode {
    if (!data || Object.keys(data).length === 0) return <p className="print-nil">NIL</p>;

    const entries = Object.entries(data);
    const hasContent = entries.some(([, v]) => {
      if (typeof v === "string") return v.trim().length > 0;
      if (Array.isArray(v)) return v.length > 0;
      if (typeof v === "boolean") return true;
      return v !== null && v !== undefined;
    });

    if (!hasContent) return <p className="print-nil">NIL</p>;

    return (
      <div className="print-clause-content">
        {entries.map(([k, v]) => {
          if (v === undefined || v === null || v === "" || k.startsWith('_')) {
            // Render _value, _rows etc
            if (k === '_value' && v) return <p key={k} className="print-field"><strong>Answer:</strong> {typeof v === 'boolean' ? (v ? 'Yes' : 'No') : String(v)}</p>;
            if (k === '_notApplicable' && v === true) return <p key={k} className="print-field text-muted-foreground italic">Not Applicable</p>;
            if (k === '_rows' && Array.isArray(v) && v.length > 0) {
              const cols = Object.keys(v[0]);
              return (
                <div key={k} className="print-table-wrapper">
                  <table className="print-table">
                    <thead><tr>{cols.map(c => <th key={c}>{c.replace(/_/g, ' ')}</th>)}</tr></thead>
                    <tbody>
                      {v.map((row: any, ri: number) => (
                        <tr key={ri} className={ri % 2 === 1 ? "print-row-alt" : ""}>
                          {cols.map(c => <td key={c}>{String(row[c] ?? "")}</td>)}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            }
            return null;
          }
          if (typeof v === "boolean") return <p key={k} className="print-field"><strong>{k.replace(/_/g, ' ')}:</strong> {v ? "Yes" : "No"}</p>;
          if (typeof v === "string") return <p key={k} className="print-field"><strong>{k.replace(/_/g, ' ')}:</strong> {v}</p>;
          if (typeof v === "object" && v !== null && !Array.isArray(v)) {
            return <div key={k} className="ml-4">{renderClauseValue(k, v)}</div>;
          }
          return null;
        })}
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[100] bg-background overflow-auto print:static print:overflow-visible">
      <div className="sticky top-0 z-10 bg-background border-b px-6 py-3 flex items-center justify-between print:hidden">
        <h2 className="text-lg font-bold">Form 3CD — Print Preview</h2>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => window.print()}>
            <Printer className="h-4 w-4 mr-1" /> Print
          </Button>
          <Button variant="outline" size="sm" onClick={() => {
            if (printRef.current) exportToPdf(printRef.current, `Form-3CD_${client?.name || 'report'}_${fy}.pdf`);
          }}>
            <Download className="h-4 w-4 mr-1" /> Export PDF
          </Button>
          <Button variant="ghost" size="sm" onClick={onClose}>Close</Button>
        </div>
      </div>

      <div ref={printRef} className="print-view max-w-4xl mx-auto p-8 print:p-0 print:max-w-none">
        <style>{`
          @media print {
            body * { visibility: hidden; }
            .print-view, .print-view * { visibility: visible; }
            .print-view { position: absolute; left: 0; top: 0; width: 100%; }
            @page { size: A4 portrait; margin: 2cm; }
            .print-table { width: 100%; border-collapse: collapse; font-size: 10pt; margin: 8px 0; }
            .print-table th, .print-table td { border: 1px solid #999; padding: 4px 6px; text-align: left; }
            .print-table th { background: #f0f0f0; font-weight: 600; }
            .print-row-alt { background: #f9f9f9; }
            .print-clause { margin-bottom: 16px; page-break-inside: avoid; }
            .print-nil { color: #888; font-style: italic; }
            .print-field { margin: 4px 0; font-size: 10pt; }
            .print-declaration { page-break-before: always; margin-top: 40px; }
          }
          .print-table { width: 100%; border-collapse: collapse; font-size: 11px; margin: 8px 0; }
          .print-table th, .print-table td { border: 1px solid hsl(var(--border)); padding: 4px 8px; text-align: left; }
          .print-table th { background: hsl(var(--muted)); font-weight: 600; }
          .print-row-alt { background: hsl(var(--muted) / 0.3); }
          .print-clause { margin-bottom: 20px; border-bottom: 1px solid hsl(var(--border)); padding-bottom: 16px; }
          .print-nil { color: hsl(var(--muted-foreground)); font-style: italic; }
          .print-field { margin: 4px 0; font-size: 12px; }
        `}</style>

        {/* HEADER */}
        <div className="text-center mb-6">
          <h1 className="text-lg font-bold">FORM NO. 3CD</h1>
          <p className="text-sm text-muted-foreground">[See rule 6G(2)]</p>
          <p className="text-sm mt-1">Statement of particulars required to be furnished under section 44AB of the Income-tax Act, 1961</p>
          <Separator className="my-4" />
          <div className="grid grid-cols-2 gap-2 text-sm text-left">
            <p><strong>Name:</strong> {client?.name || "—"}</p>
            <p><strong>PAN:</strong> {client?.pan || "—"}</p>
            <p><strong>GSTIN:</strong> {(client?.gstin || []).join(", ") || "—"}</p>
            <p><strong>Status:</strong> {client?.entity_type || engagement?.entity_type || "—"}</p>
            <p><strong>Previous Year:</strong> {fy}</p>
            <p><strong>Assessment Year:</strong> {ay}</p>
          </div>
          <Separator className="my-4" />
        </div>

        {/* ALL CLAUSES */}
        {activeClauses.map(c => {
          const key = clauseStateKey(c.clauseNo);
          const data = clauseData[key] || {};
          const filled = isClauseFilled(data);
          return (
            <div key={c.clauseNo} className="print-clause">
              <h3 className="font-bold text-sm mb-2">
                Clause {c.clauseNo.replace('_', '-')} — {c.title}
              </h3>
              <p className="text-xs text-muted-foreground mb-2">{c.heading}</p>
              {filled ? renderClauseValue(key, data) : <p className="print-nil">NIL / Not Applicable</p>}
            </div>
          );
        })}

        {/* DECLARATION */}
        <div className="print-declaration mt-12 pt-8 border-t-2">
          <h3 className="font-bold text-center mb-6">DECLARATION</h3>
          <p className="text-sm mb-8">
            I/We have examined the accounts and records of <strong>{client?.name || "________"}</strong> (PAN: {client?.pan || "________"})
            for the previous year {fy || "________"} relevant to the Assessment Year {ay || "________"},
            and certify that the information given above is true and correct to the best of my/our knowledge and belief.
          </p>
          <div className="grid grid-cols-2 gap-8 text-sm mt-12">
            <div className="space-y-6">
              <div className="border-b border-dashed pb-1"><strong>Name of the Chartered Accountant:</strong> ___________________________</div>
              <div className="border-b border-dashed pb-1"><strong>Membership Number:</strong> ___________________________</div>
              <div className="border-b border-dashed pb-1"><strong>FRN:</strong> ___________________________</div>
            </div>
            <div className="space-y-6">
              <div className="border-b border-dashed pb-1"><strong>Date:</strong> ___________________________</div>
              <div className="border-b border-dashed pb-1"><strong>Place:</strong> ___________________________</div>
              <div className="border-b border-dashed pb-1"><strong>UDIN:</strong> ___________________________</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
