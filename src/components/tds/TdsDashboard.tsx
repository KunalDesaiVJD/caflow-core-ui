import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter,
} from "@/components/ui/sheet";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import {
  Users, Clock, AlertTriangle, CheckCircle2, FileCheck, Ban, MinusCircle,
  Printer, AlertCircle, Plus, Upload, Copy, Pencil, Trash2, Search,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface ClientOption { id: string; name: string | null; pan: string | null; tan_number?: string | null; }
interface UserOption { id: string; name: string | null; }

interface TdsFiling {
  id: string; client_id: string; firm_id: string; financial_year: string;
  quarter: string; tds_forms: string[] | null; work_status: string;
  date_of_filing: string | null; acknowledgment_number: string | null;
  tan: string | null; created_at: string | null;
  last_updated_by: string | null; last_updated_at: string | null;
}

interface AuditLogEntry {
  id: string; filing_id: string | null; firm_id: string | null;
  action_type: string; old_value: string | null; new_value: string | null;
  changed_by: string | null; changed_by_name: string | null;
  changed_at: string | null; remark: string | null;
}

interface RateRecord {
  id: string; assessment_year: string; form_type: string;
  section_code: string; nature_of_payment: string | null;
  threshold_individual: number | null; threshold_company: number | null;
  rate_individual: number | null; rate_company: number | null;
  rate_no_pan: number | null; is_active: boolean;
}

interface Props {
  clients: ClientOption[];
  users: UserOption[];
  isSuperadmin: boolean;
  resolveFirmId: () => Promise<string | null>;
  onNavigate?: (section: string, filters?: Record<string, string>) => void;
}

const CURRENT_FY_START = new Date().getMonth() >= 3 ? new Date().getFullYear() : new Date().getFullYear() - 1;
const DEFAULT_FY = `${CURRENT_FY_START}-${String(CURRENT_FY_START + 1).slice(2)}`;
const FY_OPTIONS = Array.from({ length: 7 }, (_, i) => { const s = 2020 + i; return `${s}-${String(s + 1).slice(2)}`; });
const QUARTER_OPTIONS = ["Q1", "Q2", "Q3", "Q4"];
const ALL_FORMS = ["26Q", "24Q", "27Q", "27EQ"];

// Due dates: TDS forms -> 31st; TCS (27EQ) -> 15th
const TDS_DUE_DATES: Record<string, Record<string, { month: number; day: number }>> = {
  TDS: { Q1: { month: 6, day: 31 }, Q2: { month: 9, day: 31 }, Q3: { month: 0, day: 31 }, Q4: { month: 4, day: 31 } },
  TCS: { Q1: { month: 6, day: 15 }, Q2: { month: 9, day: 15 }, Q3: { month: 0, day: 15 }, Q4: { month: 4, day: 15 } },
};

function getDueDate(fy: string, quarter: string, formType?: string): Date {
  const fyStart = parseInt(fy.split("-")[0]);
  const isTCS = formType === "27EQ";
  const schedule = isTCS ? TDS_DUE_DATES.TCS : TDS_DUE_DATES.TDS;
  const d = schedule[quarter];
  if (!d) return new Date();
  const year = quarter === "Q3" || quarter === "Q4" ? fyStart + 1 : fyStart;
  return new Date(year, d.month, d.day);
}

function getSmartDefaultQuarter(): { fy: string; quarter: string } {
  const today = new Date();
  const fyStart = today.getMonth() >= 3 ? today.getFullYear() : today.getFullYear() - 1;
  const fy = `${fyStart}-${String(fyStart + 1).slice(2)}`;
  // Check each quarter's TDS due date
  for (const q of QUARTER_OPTIONS) {
    const due = getDueDate(fy, q);
    if (today <= due) return { fy, quarter: q };
  }
  // Past all due dates — default to next FY Q1
  const nextFyStart = fyStart + 1;
  return { fy: `${nextFyStart}-${String(nextFyStart + 1).slice(2)}`, quarter: "Q1" };
}

// Status abbreviations for matrix badges
const STATUS_ABBREV: Record<string, string> = {
  "Not Started": "NS", "Data Entry in Progress": "DR", "Entries Completed": "DR",
  "Upload Pending": "UP", "Return Validated": "QS", "Return Prepared": "QS",
  "Query Raised": "QS", "Submitted": "FL", "Filed": "FL", "Accepted": "PC",
  "Processed": "PC", "Not Applicable": "NA", "NIL": "NIL",
};

const STATUS_BADGE_COLORS: Record<string, string> = {
  NS: "bg-muted text-muted-foreground",
  DR: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
  UP: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300",
  QS: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
  FL: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
  PC: "bg-emerald-200 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200",
  NA: "bg-muted text-muted-foreground line-through",
  NIL: "bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300",
};

const AY_OPTIONS = Array.from({ length: 8 }, (_, i) => { const s = 2023 + i; return `${s}-${String(s + 1).slice(2)}`; });

export function TdsDashboard({ clients, users, isSuperadmin, resolveFirmId, onNavigate }: Props) {
  const { toast } = useToast();
  const smartDefault = useMemo(() => getSmartDefaultQuarter(), []);

  const [filings, setFilings] = useState<TdsFiling[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [rates, setRates] = useState<RateRecord[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [formTab, setFormTab] = useState("all");
  const [fyFilter, setFyFilter] = useState(smartDefault.fy);
  const [quarterFilter, setQuarterFilter] = useState(smartDefault.quarter);
  const [clientFilter, setClientFilter] = useState("all");

  // Rate Master state (embedded)
  const [rateAY, setRateAY] = useState("2026-27");
  const [rateFormTab, setRateFormTab] = useState("26Q");
  const [rateSearch, setRateSearch] = useState("");
  const [rateEditOpen, setRateEditOpen] = useState(false);
  const [editingRate, setEditingRate] = useState<RateRecord | null>(null);
  const [rateFormData, setRateFormData] = useState<Record<string, any>>({});
  const [rateSaving, setRateSaving] = useState(false);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const firmId = await resolveFirmId();

    // Filings
    let q = supabase.from("tds_filings").select("*").order("created_at", { ascending: false }).limit(500);
    if (!isSuperadmin && firmId) q = q.eq("firm_id", firmId);
    if (fyFilter !== "all") q = q.eq("financial_year", fyFilter);
    if (clientFilter !== "all") q = q.eq("client_id", clientFilter);
    const { data: filingsData } = await q;

    // Audit logs
    let logQ = supabase.from("tds_filing_audit_log").select("*").order("changed_at", { ascending: false }).limit(15);
    if (!isSuperadmin && firmId) logQ = logQ.eq("firm_id", firmId);
    const { data: logsData } = await logQ;

    // Rates for embedded panel
    let rateQ = supabase.from("tds_rate_master").select("id, assessment_year, form_type, section_code, nature_of_payment, threshold_individual, threshold_company, rate_individual, rate_company, rate_no_pan, is_active")
      .eq("assessment_year", rateAY).eq("form_type", rateFormTab).eq("is_active", true).order("section_code");
    if (!isSuperadmin && firmId) rateQ = rateQ.eq("firm_id", firmId);
    const { data: rateData } = await rateQ;

    setFilings((filingsData || []) as TdsFiling[]);
    setAuditLogs((logsData || []) as AuditLogEntry[]);
    setRates((rateData || []) as RateRecord[]);
    setLoading(false);
  }, [resolveFirmId, isSuperadmin, fyFilter, clientFilter, rateAY, rateFormTab]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const today = new Date();

  // Apply form tab filter
  const filteredFilings = useMemo(() => {
    let f = filings;
    if (formTab !== "all") {
      f = f.filter(fl => fl.tds_forms?.includes(formTab));
    }
    if (quarterFilter !== "all") {
      f = f.filter(fl => fl.quarter === quarterFilter);
    }
    return f;
  }, [filings, formTab, quarterFilter]);

  // ═══ KPI Stats ═══
  const stats = useMemo(() => {
    const activeClientIds = new Set(filteredFilings.map(f => f.client_id));
    const notTerminal = filteredFilings.filter(f =>
      !["Not Applicable", "NIL", "Filed", "Submitted", "Processed", "Accepted"].includes(f.work_status)
    );
    const overdue = filteredFilings.filter(f => {
      if (["Filed", "Submitted", "Processed", "Accepted", "Not Applicable", "NIL"].includes(f.work_status)) return false;
      const form = f.tds_forms?.[0];
      const due = getDueDate(f.financial_year, f.quarter, form);
      return due < today;
    });
    const filed = filteredFilings.filter(f => ["Filed", "Submitted"].includes(f.work_status));
    const processed = filteredFilings.filter(f => ["Processed", "Accepted"].includes(f.work_status));
    const na = filteredFilings.filter(f => f.work_status === "Not Applicable");
    const nil = filteredFilings.filter(f => f.work_status === "NIL");
    return {
      activeClients: activeClientIds.size,
      returnsDue: notTerminal.length,
      overdue: overdue.length,
      filed: filed.length,
      processed: processed.length,
      na: na.length,
      nil: nil.length,
    };
  }, [filteredFilings]);

  // ═══ Matrix Data ═══
  const matrixData = useMemo(() => {
    const clientFilings: Record<string, Record<string, TdsFiling[]>> = {};
    const relevantFilings = filings.filter(f => {
      if (f.financial_year !== fyFilter) return false;
      if (formTab !== "all" && !f.tds_forms?.includes(formTab)) return false;
      if (clientFilter !== "all" && f.client_id !== clientFilter) return false;
      return true;
    });
    for (const f of relevantFilings) {
      if (!clientFilings[f.client_id]) clientFilings[f.client_id] = {};
      if (!clientFilings[f.client_id][f.quarter]) clientFilings[f.client_id][f.quarter] = [];
      clientFilings[f.client_id][f.quarter].push(f);
    }
    return clientFilings;
  }, [filings, fyFilter, formTab, clientFilter]);

  // ═══ Rate Master filtering ═══
  const filteredRates = useMemo(() => {
    if (!rateSearch) return rates;
    const s = rateSearch.toLowerCase();
    return rates.filter(r => r.section_code.toLowerCase().includes(s) || (r.nature_of_payment || "").toLowerCase().includes(s));
  }, [rates, rateSearch]);

  // Rate CRUD
  const openRateEdit = (r?: RateRecord) => {
    if (r) {
      setEditingRate(r);
      setRateFormData({ ...r });
    } else {
      setEditingRate(null);
      setRateFormData({
        assessment_year: rateAY, form_type: rateFormTab, section_code: "",
        nature_of_payment: "", threshold_individual: 0, threshold_company: 0,
        rate_individual: 0, rate_company: 0, rate_no_pan: 20, is_active: true,
      });
    }
    setRateEditOpen(true);
  };

  const saveRate = async () => {
    setRateSaving(true);
    const firmId = await resolveFirmId();
    try {
      if (editingRate) {
        await supabase.from("tds_rate_master").update({
          section_code: rateFormData.section_code,
          nature_of_payment: rateFormData.nature_of_payment,
          threshold_individual: Number(rateFormData.threshold_individual) || 0,
          threshold_company: Number(rateFormData.threshold_company) || 0,
          rate_individual: Number(rateFormData.rate_individual) || 0,
          rate_company: Number(rateFormData.rate_company) || 0,
          rate_no_pan: Number(rateFormData.rate_no_pan) || 20,
        } as any).eq("id", editingRate.id);
      } else {
        await supabase.from("tds_rate_master").insert({
          ...rateFormData,
          financial_year: `${parseInt(rateAY) - 1}-${rateAY.slice(0, 2)}`,
          firm_id: firmId,
          surcharge_applicable: false, cess_applicable: false,
          effective_from: `${parseInt(rateAY) - 1}-04-01`,
        } as any);
      }
      toast({ title: editingRate ? "Rate updated" : "Rate added" });
      setRateEditOpen(false);
      fetchAll();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
    setRateSaving(false);
  };

  const deleteRate = async (id: string) => {
    if (!confirm("Delete this rate entry?")) return;
    await supabase.from("tds_rate_master").delete().eq("id", id);
    toast({ title: "Rate deleted" });
    fetchAll();
  };

  // Checklist print
  const generateChecklist = () => {
    const forms = formTab === "all" ? ALL_FORMS : [formTab];
    const quarters = QUARTER_OPTIONS;
    const rows = clients.map(client => {
      const clientFilings = filings.filter(f => f.client_id === client.id && f.financial_year === fyFilter);
      const qCells = quarters.map(q => {
        const qf = clientFilings.filter(f => f.quarter === q);
        const formStatuses = forms.map(form => {
          const found = qf.find(f => f.tds_forms?.includes(form));
          return found ? `${form}: ${found.work_status}` : `${form}: —`;
        }).join("<br/>");
        return `<td style="border:1px solid #ccc;padding:6px;font-size:11px">${formStatuses}</td>`;
      }).join("");
      return `<tr><td style="border:1px solid #ccc;padding:6px;font-weight:bold;font-size:12px">${client.name || "—"}</td>${qCells}</tr>`;
    }).join("");
    const html = `<!DOCTYPE html><html><head><title>TDS Filing Checklist — FY ${fyFilter}</title>
      <style>body{font-family:system-ui;margin:20px}table{width:100%;border-collapse:collapse}th{background:#f3f4f6;font-size:11px;border:1px solid #ccc;padding:6px}@media print{@page{size:landscape}}</style></head><body>
      <h2>TDS Filing Checklist — FY ${fyFilter}</h2>
      <p style="font-size:12px;color:#666">Generated on ${format(new Date(), "dd MMM yyyy, hh:mm a")}</p>
      <table><thead><tr><th>Client</th>${quarters.map(q => `<th>${q}</th>`).join("")}</tr></thead>
      <tbody>${rows}</tbody></table></body></html>`;
    const blob = new Blob([html], { type: "text/html" });
    const w = window.open(URL.createObjectURL(blob), "_blank");
    if (w) setTimeout(() => w.print(), 500);
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-full" />
        <div className="grid grid-cols-7 gap-3">{Array.from({ length: 7 }).map((_, i) => <Skeleton key={i} className="h-20" />)}</div>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const kpiCards = [
    { label: "Active TDS Clients", value: stats.activeClients, icon: Users, color: "text-blue-600", bg: "bg-blue-50 dark:bg-blue-950/30" },
    { label: "Returns Due", value: stats.returnsDue, icon: Clock, color: "text-amber-600", bg: "bg-amber-50 dark:bg-amber-950/30" },
    { label: "Overdue", value: stats.overdue, icon: AlertTriangle, color: "text-destructive", bg: "bg-red-50 dark:bg-red-950/30" },
    { label: "Filed / Submitted", value: stats.filed, icon: CheckCircle2, color: "text-emerald-600", bg: "bg-emerald-50 dark:bg-emerald-950/30" },
    { label: "Processed / Accepted", value: stats.processed, icon: FileCheck, color: "text-emerald-700", bg: "bg-emerald-100 dark:bg-emerald-900/40" },
    { label: "Not Applicable", value: stats.na, icon: Ban, color: "text-muted-foreground", bg: "bg-muted" },
    { label: "NIL Returns", value: stats.nil, icon: MinusCircle, color: "text-teal-600", bg: "bg-teal-50 dark:bg-teal-950/30" },
  ];

  const dueDateTable = [
    { form: "26Q / 24Q / 27Q", q1: "31 Jul", q2: "31 Oct", q3: "31 Jan", q4: "31 May" },
    { form: "27EQ (TCS)", q1: "15 Jul", q2: "15 Oct", q3: "15 Jan", q4: "15 May" },
  ];

  const getFormBadge = (qFilings: TdsFiling[] | undefined, form: string) => {
    if (!qFilings) return null;
    const f = qFilings.find(fl => fl.tds_forms?.includes(form));
    if (!f) return null;
    const abbrev = STATUS_ABBREV[f.work_status] || "NS";
    return (
      <Badge
        key={form}
        className={cn("text-[9px] px-1.5 py-0 cursor-pointer font-mono", STATUS_BADGE_COLORS[abbrev] || STATUS_BADGE_COLORS.NS)}
        onClick={() => onNavigate?.("data-entry", { client: f.client_id, quarter: f.quarter, form })}
        title={`${form}: ${f.work_status}`}
      >
        {form.replace("27EQ", "EQ")}
      </Badge>
    );
  };

  const isDueDateOverdue = (q: string, isTCS: boolean) => {
    const due = getDueDate(fyFilter, q, isTCS ? "27EQ" : "26Q");
    return due < today;
  };

  const isDueDateCurrent = (q: string) => q === smartDefault.quarter && fyFilter === smartDefault.fy;

  return (
    <div className="space-y-5">
      {/* ═══ ROW 1: Header + Form Tabs + Filters ═══ */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">TDS Dashboard</h1>
          <p className="text-sm text-muted-foreground">Overview of TDS/TCS filings and compliance status</p>
        </div>
        <Button variant="outline" size="sm" className="gap-1" onClick={generateChecklist}>
          <Printer size={14} /> Filing Checklist
        </Button>
      </div>

      <div className="flex flex-wrap items-end gap-4">
        <Tabs value={formTab} onValueChange={setFormTab}>
          <TabsList>
            <TabsTrigger value="all">All Forms</TabsTrigger>
            {ALL_FORMS.map(f => <TabsTrigger key={f} value={f}>{f}</TabsTrigger>)}
          </TabsList>
        </Tabs>

        <div className="flex gap-3 ml-auto">
          <div className="space-y-0.5">
            <Label className="text-[10px]">Financial Year</Label>
            <Select value={fyFilter} onValueChange={setFyFilter}>
              <SelectTrigger className="w-[120px] h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>{FY_OPTIONS.map(fy => <SelectItem key={fy} value={fy}>{fy}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-0.5">
            <Label className="text-[10px]">Quarter</Label>
            <Select value={quarterFilter} onValueChange={setQuarterFilter}>
              <SelectTrigger className="w-[90px] h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                {QUARTER_OPTIONS.map(q => <SelectItem key={q} value={q}>{q}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-0.5">
            <Label className="text-[10px]">Client</Label>
            <Select value={clientFilter} onValueChange={setClientFilter}>
              <SelectTrigger className="w-[180px] h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Clients</SelectItem>
                {clients.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {/* ═══ ROW 2: 7 KPI Cards ═══ */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
        {kpiCards.map(kpi => (
          <Card key={kpi.label} className={cn("border", kpi.bg)}>
            <CardContent className="p-3">
              <div className="flex items-center gap-1.5 mb-1">
                <kpi.icon size={14} className={kpi.color} />
                <p className="text-[10px] text-muted-foreground font-medium leading-tight">{kpi.label}</p>
              </div>
              <p className={cn("text-xl font-bold", kpi.color)}>{kpi.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* ═══ ROW 3: Matrix (left) + Due Dates & Rate Master (right) ═══ */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* Filing Status Matrix */}
        <Card className="xl:col-span-2">
          <CardHeader className="py-2.5 px-4">
            <CardTitle className="text-sm font-semibold">Filing Status Matrix — FY {fyFilter}</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto max-h-[400px]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="sticky left-0 bg-background z-10 min-w-[160px] text-xs">Client</TableHead>
                    {QUARTER_OPTIONS.map(q => (
                      <TableHead key={q} className="text-center min-w-[140px] text-xs">
                        {q}
                        <div className="text-[9px] text-muted-foreground font-normal">
                          Due: {format(getDueDate(fyFilter, q), "dd MMM")}
                        </div>
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {Object.keys(matrixData).length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-muted-foreground py-8 text-sm">
                        No filing data for this period
                      </TableCell>
                    </TableRow>
                  ) : (
                    Object.entries(matrixData).map(([clientId, quarters]) => {
                      const client = clients.find(c => c.id === clientId);
                      const tanMissing = !client?.tan_number;
                      return (
                        <TableRow key={clientId}>
                          <TableCell className="font-medium text-sm sticky left-0 bg-background z-10">
                            <div className="flex items-center gap-1">
                              {tanMissing && (
                                <span title="TAN missing"><AlertCircle size={12} className="text-destructive shrink-0" /></span>
                              )}
                              <span className="truncate max-w-[140px]">{client?.name || "—"}</span>
                            </div>
                          </TableCell>
                          {QUARTER_OPTIONS.map(q => {
                            const qFilings = quarters[q];
                            const formsToShow = formTab === "all" ? ALL_FORMS : [formTab];
                            return (
                              <TableCell key={q} className="text-center">
                                <div className="flex flex-wrap gap-0.5 justify-center">
                                  {formsToShow.map(form => getFormBadge(qFilings, form))}
                                  {!qFilings && <span className="text-[10px] text-muted-foreground">—</span>}
                                </div>
                              </TableCell>
                            );
                          })}
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
            {/* Legend */}
            <div className="flex flex-wrap gap-2 px-4 py-2 border-t">
              {Object.entries(STATUS_BADGE_COLORS).map(([abbr, cls]) => (
                <span key={abbr} className="flex items-center gap-1">
                  <Badge className={cn("text-[8px] px-1 py-0", cls)}>{abbr}</Badge>
                  <span className="text-[9px] text-muted-foreground">
                    {abbr === "NS" ? "Not Started" : abbr === "DR" ? "Data Entry" : abbr === "UP" ? "Upload Pending" :
                     abbr === "QS" ? "Query/Validated" : abbr === "FL" ? "Filed" : abbr === "PC" ? "Processed" :
                     abbr === "NA" ? "N/A" : "NIL"}
                  </span>
                </span>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Right Column: Due Dates + Rate Master */}
        <div className="space-y-4">
          {/* Due Date Reference */}
          <Card>
            <CardHeader className="py-2.5 px-4">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Clock size={14} className="text-amber-600" /> Due Date Reference
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-[10px]">Form</TableHead>
                    {QUARTER_OPTIONS.map(q => <TableHead key={q} className="text-[10px] text-center">{q}</TableHead>)}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {dueDateTable.map((row, i) => (
                    <TableRow key={i}>
                      <TableCell className="text-xs font-medium">{row.form}</TableCell>
                      {[row.q1, row.q2, row.q3, row.q4].map((val, qi) => {
                        const q = QUARTER_OPTIONS[qi];
                        const isTCS = i === 1;
                        const overdue = isDueDateOverdue(q, isTCS);
                        const current = isDueDateCurrent(q);
                        return (
                          <TableCell key={qi} className={cn(
                            "text-xs text-center font-mono",
                            overdue ? "text-destructive font-bold" : current ? "text-amber-600 font-semibold" : ""
                          )}>
                            {val}
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Embedded Rate Master */}
          <Card>
            <CardHeader className="py-2.5 px-4">
              <CardTitle className="text-sm font-semibold">Rate Master</CardTitle>
            </CardHeader>
            <CardContent className="p-3 pt-0 space-y-2">
              <div className="flex gap-2 items-end">
                <Select value={rateAY} onValueChange={setRateAY}>
                  <SelectTrigger className="w-[100px] h-7 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>{AY_OPTIONS.map(ay => <SelectItem key={ay} value={ay}>AY {ay}</SelectItem>)}</SelectContent>
                </Select>
                <Tabs value={rateFormTab} onValueChange={setRateFormTab}>
                  <TabsList className="h-7">
                    {ALL_FORMS.map(f => <TabsTrigger key={f} value={f} className="text-[10px] px-2 h-6">{f}</TabsTrigger>)}
                  </TabsList>
                </Tabs>
              </div>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <Input value={rateSearch} onChange={e => setRateSearch(e.target.value)} placeholder="Search section..." className="h-7 text-xs pl-7" />
                </div>
                <Button size="sm" variant="outline" className="h-7 text-[10px] gap-1" onClick={() => openRateEdit()}>
                  <Plus size={10} /> Add
                </Button>
              </div>
              <div className="overflow-y-auto max-h-[200px]">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-[9px]">Section</TableHead>
                      <TableHead className="text-[9px]">Nature</TableHead>
                      <TableHead className="text-[9px] text-right">Rate%</TableHead>
                      <TableHead className="text-[9px] text-right">No-PAN%</TableHead>
                      <TableHead className="text-[9px] w-[50px]"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredRates.length === 0 ? (
                      <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground text-xs py-4">No rates</TableCell></TableRow>
                    ) : filteredRates.map(r => (
                      <TableRow key={r.id}>
                        <TableCell className="text-[10px] font-mono">{r.section_code}</TableCell>
                        <TableCell className="text-[10px] max-w-[120px] truncate">{r.nature_of_payment}</TableCell>
                        <TableCell className="text-[10px] text-right">{r.rate_individual}%</TableCell>
                        <TableCell className="text-[10px] text-right">{r.rate_no_pan}%</TableCell>
                        <TableCell className="text-right">
                          <div className="flex gap-0.5 justify-end">
                            <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => openRateEdit(r)}>
                              <Pencil size={10} />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-5 w-5 text-destructive" onClick={() => deleteRate(r.id)}>
                              <Trash2 size={10} />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* ═══ ROW 4: Recent Activity ═══ */}
      <Card>
        <CardHeader className="py-2.5 px-4">
          <CardTitle className="text-sm font-semibold">Recent Activity</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-[10px]">Action</TableHead>
                  <TableHead className="text-[10px]">Change</TableHead>
                  <TableHead className="text-[10px]">User</TableHead>
                  <TableHead className="text-[10px]">Date & Time</TableHead>
                  <TableHead className="text-[10px]">Remark</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {auditLogs.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground text-sm py-6">
                      No recent activity recorded
                    </TableCell>
                  </TableRow>
                ) : auditLogs.map(log => (
                    <TableRow key={log.id}>
                      <TableCell><Badge variant="secondary" className="text-[10px]">{log.action_type}</Badge></TableCell>
                      <TableCell className="text-sm">
                        {log.old_value || log.new_value ? (
                          <><span className="text-muted-foreground">{log.old_value || "—"}</span><span className="mx-1">→</span><span className="font-medium">{log.new_value || "—"}</span></>
                        ) : "—"}
                      </TableCell>
                      <TableCell className="text-sm">{log.changed_by_name || "System"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {log.changed_at ? format(new Date(log.changed_at), "dd MMM yyyy, hh:mm a") : "—"}
                      </TableCell>
                      <TableCell className="text-xs max-w-[150px] truncate">{log.remark || "—"}</TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* ═══ Rate Edit Dialog ═══ */}
      <Dialog open={rateEditOpen} onOpenChange={setRateEditOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingRate ? "Edit Rate" : "Add Rate Section"}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 space-y-1">
              <Label className="text-xs">Section Code</Label>
              <Input value={rateFormData.section_code || ""} onChange={e => setRateFormData(p => ({ ...p, section_code: e.target.value }))} className="h-8 text-xs" />
            </div>
            <div className="col-span-2 space-y-1">
              <Label className="text-xs">Nature of Payment</Label>
              <Input value={rateFormData.nature_of_payment || ""} onChange={e => setRateFormData(p => ({ ...p, nature_of_payment: e.target.value }))} className="h-8 text-xs" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Threshold Ind (₹)</Label>
              <Input type="number" value={rateFormData.threshold_individual ?? ""} onChange={e => setRateFormData(p => ({ ...p, threshold_individual: e.target.value }))} className="h-8 text-xs" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Threshold Co (₹)</Label>
              <Input type="number" value={rateFormData.threshold_company ?? ""} onChange={e => setRateFormData(p => ({ ...p, threshold_company: e.target.value }))} className="h-8 text-xs" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Rate Ind %</Label>
              <Input type="number" step="0.1" value={rateFormData.rate_individual ?? ""} onChange={e => setRateFormData(p => ({ ...p, rate_individual: e.target.value }))} className="h-8 text-xs" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Rate Co %</Label>
              <Input type="number" step="0.1" value={rateFormData.rate_company ?? ""} onChange={e => setRateFormData(p => ({ ...p, rate_company: e.target.value }))} className="h-8 text-xs" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">No-PAN Rate %</Label>
              <Input type="number" step="0.1" value={rateFormData.rate_no_pan ?? ""} onChange={e => setRateFormData(p => ({ ...p, rate_no_pan: e.target.value }))} className="h-8 text-xs" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRateEditOpen(false)}>Cancel</Button>
            <Button onClick={saveRate} disabled={rateSaving || !rateFormData.section_code}>
              {rateSaving ? "Saving..." : editingRate ? "Update" : "Add Section"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
