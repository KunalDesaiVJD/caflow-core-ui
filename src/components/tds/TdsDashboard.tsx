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
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import {
  Users, Clock, AlertTriangle, CheckCircle2, FileCheck, Ban, MinusCircle,
  Printer, AlertCircle, TrendingUp,
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

interface Props {
  clients: ClientOption[];
  users: UserOption[];
  isSuperadmin: boolean;
  resolveFirmId: () => Promise<string | null>;
  onNavigate?: (section: string, filters?: Record<string, string>) => void;
  refreshKey?: number;
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

const TERMINAL_STATUSES = new Set([
  "Filed", "Submitted", "Processed", "Accepted", "Not Applicable", "NIL",
]);

export function TdsDashboard({ clients, users, isSuperadmin, resolveFirmId, onNavigate, refreshKey }: Props) {
  const { toast } = useToast();
  const smartDefault = useMemo(() => getSmartDefaultQuarter(), []);

  const [filings, setFilings] = useState<TdsFiling[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [formTab, setFormTab] = useState("all");
  const [fyFilter, setFyFilter] = useState(smartDefault.fy);
  const [quarterFilter, setQuarterFilter] = useState(smartDefault.quarter);
  const [clientFilter, setClientFilter] = useState("all");
  const [clientFilterSearch, setClientFilterSearch] = useState("");

  const [deletedClientIds, setDeletedClientIds] = useState<Set<string>>(new Set());

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const firmId = await resolveFirmId();

    // Filings
    let q = supabase.from("tds_filings").select("*").order("created_at", { ascending: false }).limit(500);
    if (!isSuperadmin && firmId) q = q.eq("firm_id", firmId);
    if (fyFilter !== "all") q = q.eq("financial_year", fyFilter);
    if (clientFilter !== "all") q = q.eq("client_id", clientFilter);
    const { data: filingsData } = await q;

    // Identify deleted clients among fetched filings
    const allFilings = (filingsData || []) as TdsFiling[];
    const cIds = [...new Set(allFilings.map(f => f.client_id))];
    const delIds = new Set<string>();
    if (cIds.length > 0) {
      const { data: delClients } = await supabase.from("clients")
        .select("id")
        .in("id", cIds)
        .not("deleted_at", "is", null);
      for (const dc of (delClients || [])) delIds.add(dc.id);
    }
    setDeletedClientIds(delIds);
    setFilings(allFilings);
    setLoading(false);
  }, [resolveFirmId, isSuperadmin, fyFilter, clientFilter]);

  // Re-fetch when refreshKey changes (e.g. user returns from TDS Workspace to Dashboard)
  useEffect(() => { fetchAll(); }, [fetchAll, refreshKey]);

  const today = new Date();

  // Apply form tab filter — exclude deleted clients
  const filteredFilings = useMemo(() => {
    let f = filings.filter(fl => !deletedClientIds.has(fl.client_id));
    if (formTab !== "all") {
      f = f.filter(fl => fl.tds_forms?.includes(formTab));
    }
    if (quarterFilter !== "all") {
      f = f.filter(fl => fl.quarter === quarterFilter);
    }
    return f;
  }, [filings, formTab, quarterFilter, deletedClientIds]);

  // ═══ KPI Stats ═══
  const stats = useMemo(() => {
    const activeClientIds = new Set(filteredFilings.map(f => f.client_id));
    const notTerminal = filteredFilings.filter(f => !TERMINAL_STATUSES.has(f.work_status));
    const overdue = filteredFilings.filter(f => {
      if (TERMINAL_STATUSES.has(f.work_status)) return false;
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

  // ═══ Matrix Data — exclude deleted clients ═══
  const matrixData = useMemo(() => {
    const clientFilings: Record<string, Record<string, TdsFiling[]>> = {};
    const relevantFilings = filings.filter(f => {
      if (deletedClientIds.has(f.client_id)) return false;
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
  }, [filings, fyFilter, formTab, clientFilter, deletedClientIds]);

  // ═══ Pending Compliance Alerts ═══
  // Overdue or due within the next 14 days (not yet filed) for the selected FY
  const pendingAlerts = useMemo(() => {
    type Alert = {
      id: string; clientName: string; quarter: string; form: string;
      status: string; dueDate: Date; daysOverdue: number; daysLeft: number;
    };
    const alerts: Alert[] = [];
    const fyFilings = filings.filter(f => {
      if (deletedClientIds.has(f.client_id)) return false;
      if (f.financial_year !== fyFilter) return false;
      if (TERMINAL_STATUSES.has(f.work_status)) return false;
      if (clientFilter !== "all" && f.client_id !== clientFilter) return false;
      return true;
    });
    for (const f of fyFilings) {
      const form = f.tds_forms?.[0] || "26Q";
      const dueDate = getDueDate(f.financial_year, f.quarter, form);
      const diffMs = dueDate.getTime() - today.getTime();
      const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
      if (diffDays <= 14) {
        const client = clients.find(c => c.id === f.client_id);
        alerts.push({
          id: f.id,
          clientName: client?.name || "Unknown",
          quarter: f.quarter,
          form,
          status: f.work_status,
          dueDate,
          daysOverdue: diffDays < 0 ? Math.abs(diffDays) : 0,
          daysLeft: diffDays >= 0 ? diffDays : 0,
        });
      }
    }
    return alerts.sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());
  }, [filings, fyFilter, clientFilter, deletedClientIds, clients, today]);

  // ═══ Client FY Filing Summary ═══
  // Shows per-client, per-quarter data entry status for the selected FY
  const clientFySummary = useMemo(() => {
    const fyFilings = filings.filter(f => {
      if (deletedClientIds.has(f.client_id)) return false;
      if (f.financial_year !== fyFilter) return false;
      if (clientFilter !== "all" && f.client_id !== clientFilter) return false;
      return true;
    });
    const byClient: Record<string, {
      clientName: string;
      byQuarter: Record<string, TdsFiling[]>;
      lastUpdated: string | null;
    }> = {};
    for (const f of fyFilings) {
      if (!byClient[f.client_id]) {
        const client = clients.find(c => c.id === f.client_id);
        byClient[f.client_id] = {
          clientName: client?.name || "Unknown",
          byQuarter: {},
          lastUpdated: null,
        };
      }
      if (!byClient[f.client_id].byQuarter[f.quarter]) {
        byClient[f.client_id].byQuarter[f.quarter] = [];
      }
      byClient[f.client_id].byQuarter[f.quarter].push(f);
      const ts = f.last_updated_at || f.created_at;
      if (ts && (!byClient[f.client_id].lastUpdated || ts > byClient[f.client_id].lastUpdated!)) {
        byClient[f.client_id].lastUpdated = ts;
      }
    }
    return Object.entries(byClient)
      .map(([clientId, data]) => ({
        clientId,
        clientName: data.clientName,
        byQuarter: data.byQuarter,
        quartersWithData: Object.keys(data.byQuarter).length,
        quartersComplete: Object.values(data.byQuarter).filter(qf =>
          qf.some(f => TERMINAL_STATUSES.has(f.work_status))
        ).length,
        lastUpdated: data.lastUpdated,
      }))
      .sort((a, b) => a.clientName.localeCompare(b.clientName));
  }, [filings, fyFilter, clientFilter, deletedClientIds, clients]);

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

  // Quarter status badge for the summary table
  const getQStatusBadge = (qFilings: TdsFiling[] | undefined) => {
    if (!qFilings || qFilings.length === 0) return <span className="text-[10px] text-muted-foreground">—</span>;
    // Pick the "best" status if multiple forms
    const statuses = qFilings.map(f => STATUS_ABBREV[f.work_status] || "NS");
    const priority = ["PC", "FL", "QS", "UP", "DR", "NIL", "NA", "NS"];
    const best = priority.find(p => statuses.includes(p)) || "NS";
    return (
      <Badge className={cn("text-[9px] px-1.5 py-0 font-mono", STATUS_BADGE_COLORS[best])}>
        {best}
      </Badge>
    );
  };

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
            <Select value={clientFilter} onValueChange={v => { setClientFilter(v); setClientFilterSearch(""); }}>
              <SelectTrigger className="w-[180px] h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <div className="px-2 pb-1 pt-1 sticky top-0 bg-popover z-10">
                  <Input
                    placeholder="Search…"
                    value={clientFilterSearch}
                    onChange={e => setClientFilterSearch(e.target.value)}
                    onKeyDown={e => e.stopPropagation()}
                    className="h-6 text-xs"
                  />
                </div>
                <SelectItem value="all">All Clients</SelectItem>
                {clients
                  .filter(c => !clientFilterSearch || (c.name || "").toLowerCase().includes(clientFilterSearch.toLowerCase()))
                  .map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
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

      {/* ═══ ROW 3: Matrix (left) + Due Dates & Compliance Alerts (right) ═══ */}
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

        {/* Right Column: Due Dates + Compliance Alerts */}
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

          {/* Compliance Alerts */}
          <Card>
            <CardHeader className="py-2.5 px-4">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <AlertTriangle size={14} className="text-amber-600" /> Compliance Alerts
                {pendingAlerts.length > 0 && (
                  <Badge className="ml-auto bg-destructive text-destructive-foreground text-[10px] px-1.5 py-0">
                    {pendingAlerts.length}
                  </Badge>
                )}
              </CardTitle>
              <p className="text-[10px] text-muted-foreground">Overdue or due within 14 days — FY {fyFilter}</p>
            </CardHeader>
            <CardContent className="p-0">
              {pendingAlerts.length === 0 ? (
                <div className="flex items-center gap-2 px-4 py-5 text-sm text-emerald-600">
                  <CheckCircle2 size={15} />
                  <span>All filings on track for FY {fyFilter}</span>
                </div>
              ) : (
                <div className="divide-y max-h-[240px] overflow-y-auto">
                  {pendingAlerts.slice(0, 12).map(alert => (
                    <div
                      key={alert.id}
                      className="px-3 py-2 flex items-start gap-2 hover:bg-muted/50 cursor-pointer transition-colors"
                      onClick={() => onNavigate?.("data-entry", { client: clients.find(c => c.name === alert.clientName)?.id || "", quarter: alert.quarter })}
                    >
                      <div className={cn("shrink-0 mt-0.5", alert.daysOverdue > 0 ? "text-destructive" : "text-amber-500")}>
                        <AlertCircle size={12} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium truncate leading-tight">{alert.clientName}</p>
                        <p className="text-[10px] text-muted-foreground">
                          {alert.quarter} · {alert.form} ·{" "}
                          {alert.daysOverdue > 0
                            ? <span className="text-destructive font-semibold">{alert.daysOverdue}d overdue</span>
                            : alert.daysLeft === 0
                              ? <span className="text-destructive font-semibold">Due today!</span>
                              : <span className="text-amber-600 font-semibold">Due in {alert.daysLeft}d</span>
                          }
                        </p>
                      </div>
                      <Badge className={cn("text-[9px] shrink-0 font-mono", STATUS_BADGE_COLORS[STATUS_ABBREV[alert.status] || "NS"])}>
                        {STATUS_ABBREV[alert.status] || "NS"}
                      </Badge>
                    </div>
                  ))}
                  {pendingAlerts.length > 12 && (
                    <p className="text-[10px] text-muted-foreground text-center py-2">
                      +{pendingAlerts.length - 12} more alerts
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* ═══ ROW 4: Client FY Filing Summary ═══ */}
      <Card>
        <CardHeader className="py-2.5 px-4 flex flex-row items-start justify-between">
          <div>
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <TrendingUp size={14} className="text-blue-600" />
              FY {fyFilter} — Client Filing Summary
            </CardTitle>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Quarter-wise data coverage for every client in the selected financial year
            </p>
          </div>
          <Badge variant="outline" className="text-[10px] shrink-0 mt-0.5">
            {clientFySummary.length} client{clientFySummary.length !== 1 ? "s" : ""}
          </Badge>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-[10px] sticky left-0 bg-background z-10 min-w-[160px]">Client</TableHead>
                  {QUARTER_OPTIONS.map(q => (
                    <TableHead key={q} className="text-[10px] text-center">{q}</TableHead>
                  ))}
                  <TableHead className="text-[10px] text-center">Coverage</TableHead>
                  <TableHead className="text-[10px]">Last Updated</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {clientFySummary.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-muted-foreground text-sm py-8">
                      No filing data found for FY {fyFilter}
                    </TableCell>
                  </TableRow>
                ) : (
                  clientFySummary.map(row => {
                    const coveragePct = Math.round((row.quartersWithData / 4) * 100);
                    const allDone = row.quartersComplete === row.quartersWithData && row.quartersWithData > 0;
                    return (
                      <TableRow key={row.clientId}>
                        <TableCell className="font-medium text-sm sticky left-0 bg-background z-10 max-w-[180px]">
                          <span className="truncate block">{row.clientName}</span>
                        </TableCell>
                        {QUARTER_OPTIONS.map(q => (
                          <TableCell key={q} className="text-center">
                            {getQStatusBadge(row.byQuarter[q])}
                          </TableCell>
                        ))}
                        <TableCell className="text-center">
                          <div className="flex flex-col items-center gap-1">
                            <div className="w-16 bg-muted rounded-full h-1.5">
                              <div
                                className={cn("h-1.5 rounded-full transition-all", allDone ? "bg-emerald-500" : coveragePct > 0 ? "bg-blue-500" : "bg-muted-foreground/30")}
                                style={{ width: `${coveragePct}%` }}
                              />
                            </div>
                            <span className="text-[9px] text-muted-foreground">
                              {row.quartersWithData}/4 qtrs
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="text-[10px] text-muted-foreground whitespace-nowrap">
                          {row.lastUpdated ? format(new Date(row.lastUpdated), "dd MMM yy, hh:mm a") : "—"}
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
