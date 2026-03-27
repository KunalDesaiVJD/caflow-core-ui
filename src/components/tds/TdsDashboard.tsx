import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { format, differenceInDays } from "date-fns";
import { cn } from "@/lib/utils";
import {
  Users, Clock, AlertTriangle, CheckCircle2, FileText, Inbox,
} from "lucide-react";

interface ClientOption { id: string; name: string | null; pan: string | null; }
interface UserOption { id: string; name: string | null; }

interface TdsFiling {
  id: string; client_id: string; firm_id: string; financial_year: string;
  quarter: string; tds_forms: string[] | null; work_status: string;
  date_of_filing: string | null; acknowledgment_number: string | null;
  prn_no: string | null; tan: string | null; assigned_staff: string | null;
  last_updated_by: string | null; last_updated_at: string | null;
  remarks: string | null; created_at: string | null;
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
const TDS_FORMS = ["24Q", "26Q", "27Q", "27EQ"];

const FILING_STATUSES_EXPANDED = [
  "Not Started", "Data Entry in Progress", "Entries Completed",
  "Return Validated", "Return Prepared", "Submitted", "Accepted",
];

const getDueDate = (fy: string, quarter: string): Date => {
  const fyStart = parseInt(fy.split("-")[0]);
  const dates: Record<string, Date> = {
    Q1: new Date(fyStart, 6, 31),
    Q2: new Date(fyStart, 9, 31),
    Q3: new Date(fyStart + 1, 0, 31),
    Q4: new Date(fyStart + 1, 4, 31),
  };
  return dates[quarter] || new Date();
};

const getCurrentQuarter = (): string => {
  const m = new Date().getMonth();
  if (m >= 3 && m <= 5) return "Q1";
  if (m >= 6 && m <= 8) return "Q2";
  if (m >= 9 && m <= 11) return "Q3";
  return "Q4";
};

const STATUS_CELL_COLORS: Record<string, string> = {
  "Not Started": "bg-muted text-muted-foreground",
  "Data Entry in Progress": "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
  "Entries Completed": "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
  "Return Validated": "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
  "Return Prepared": "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
  "Submitted": "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
  "Accepted": "bg-emerald-200 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200",
};

export function TdsDashboard({ clients, users, isSuperadmin, resolveFirmId, onNavigate }: Props) {
  const [filings, setFilings] = useState<TdsFiling[]>([]);
  const [loading, setLoading] = useState(true);
  const [fyFilter, setFyFilter] = useState(DEFAULT_FY);
  const [quarterFilter, setQuarterFilter] = useState("all");
  const [clientFilter, setClientFilter] = useState("all");

  const fetchFilings = useCallback(async () => {
    setLoading(true);
    const firmId = await resolveFirmId();
    let q = supabase.from("tds_filings").select("*").order("created_at", { ascending: false }).limit(500);
    if (!isSuperadmin && firmId) q = q.eq("firm_id", firmId);
    if (fyFilter !== "all") q = q.eq("financial_year", fyFilter);
    if (clientFilter !== "all") q = q.eq("client_id", clientFilter);
    const { data } = await q;
    setFilings((data || []) as TdsFiling[]);
    setLoading(false);
  }, [resolveFirmId, isSuperadmin, fyFilter, clientFilter]);

  useEffect(() => { fetchFilings(); }, [fetchFilings]);

  const currentQuarter = getCurrentQuarter();
  const today = new Date();

  // KPI Stats
  const stats = useMemo(() => {
    const currentQFilings = filings.filter(f =>
      quarterFilter === "all" ? f.quarter === currentQuarter : f.quarter === quarterFilter
    );
    return {
      totalClients: clients.length,
      returnsDue: currentQFilings.filter(f =>
        !["Submitted", "Accepted"].includes(f.work_status)
      ).length,
      overdue: filings.filter(f => {
        if (["Submitted", "Accepted"].includes(f.work_status)) return false;
        const due = getDueDate(f.financial_year, f.quarter);
        return due < today;
      }).length,
      filedThisQ: currentQFilings.filter(f =>
        ["Submitted", "Accepted"].includes(f.work_status)
      ).length,
      pendingDataEntry: currentQFilings.filter(f => f.work_status === "Not Started").length,
    };
  }, [filings, clients, quarterFilter, currentQuarter]);

  // Filing Status Matrix - group by client
  const matrixData = useMemo(() => {
    const clientFilings: Record<string, Record<string, TdsFiling[]>> = {};
    const relevantFilings = filings.filter(f => f.financial_year === fyFilter);

    for (const f of relevantFilings) {
      if (!clientFilings[f.client_id]) clientFilings[f.client_id] = {};
      const qKey = f.quarter;
      if (!clientFilings[f.client_id][qKey]) clientFilings[f.client_id][qKey] = [];
      clientFilings[f.client_id][qKey].push(f);
    }
    return clientFilings;
  }, [filings, fyFilter]);

  // Upcoming due dates (next 30 days)
  const upcomingDueDates = useMemo(() => {
    const items: { filing: TdsFiling; dueDate: Date; daysLeft: number; clientName: string }[] = [];
    for (const f of filings) {
      if (["Submitted", "Accepted"].includes(f.work_status)) continue;
      const due = getDueDate(f.financial_year, f.quarter);
      const days = differenceInDays(due, today);
      if (days >= -7 && days <= 30) {
        items.push({
          filing: f,
          dueDate: due,
          daysLeft: days,
          clientName: clients.find(c => c.id === f.client_id)?.name || "—",
        });
      }
    }
    return items.sort((a, b) => a.daysLeft - b.daysLeft);
  }, [filings, clients]);

  // Recent activity (last 10 filings by update time)
  const recentActivity = useMemo(() => {
    return filings
      .filter(f => f.last_updated_at)
      .sort((a, b) => new Date(b.last_updated_at!).getTime() - new Date(a.last_updated_at!).getTime())
      .slice(0, 10);
  }, [filings]);

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-5 gap-4">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const kpiCards = [
    { label: "Total Active Clients", value: stats.totalClients, icon: Users, color: "text-blue-600", bgColor: "bg-blue-50 dark:bg-blue-950/30" },
    { label: "Returns Due This Quarter", value: stats.returnsDue, icon: Clock, color: "text-amber-600", bgColor: "bg-amber-50 dark:bg-amber-950/30" },
    { label: "Overdue Filings", value: stats.overdue, icon: AlertTriangle, color: "text-destructive", bgColor: "bg-red-50 dark:bg-red-950/30" },
    { label: "Filed This Quarter", value: stats.filedThisQ, icon: CheckCircle2, color: "text-emerald-600", bgColor: "bg-emerald-50 dark:bg-emerald-950/30" },
    { label: "Pending Data Entry", value: stats.pendingDataEntry, icon: Inbox, color: "text-muted-foreground", bgColor: "bg-muted" },
  ];

  const getDaysLeftColor = (days: number) => {
    if (days < 0) return "text-destructive font-bold";
    if (days < 7) return "text-destructive";
    if (days <= 14) return "text-amber-600";
    return "text-emerald-600";
  };

  const getFormBadgeStatus = (filingList: TdsFiling[] | undefined, formType: string): string => {
    if (!filingList) return "Not Started";
    const f = filingList.find(fl => fl.tds_forms?.includes(formType));
    return f?.work_status || "Not Started";
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">TDS Dashboard</h1>
        <p className="text-sm text-muted-foreground">Overview of TDS/TCS filings and compliance status</p>
      </div>

      {/* Filter Bar */}
      <div className="flex flex-wrap gap-3 items-end">
        <div className="space-y-1">
          <Label className="text-xs">Financial Year</Label>
          <Select value={fyFilter} onValueChange={setFyFilter}>
            <SelectTrigger className="w-[130px]"><SelectValue /></SelectTrigger>
            <SelectContent>{FY_OPTIONS.map(fy => <SelectItem key={fy} value={fy}>{fy}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Quarter</Label>
          <Select value={quarterFilter} onValueChange={setQuarterFilter}>
            <SelectTrigger className="w-[100px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              {QUARTER_OPTIONS.map(q => <SelectItem key={q} value={q}>{q}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Client</Label>
          <Select value={clientFilter} onValueChange={setClientFilter}>
            <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Clients</SelectItem>
              {clients.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {kpiCards.map(kpi => (
          <Card key={kpi.label} className={cn("border", kpi.bgColor)}>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <kpi.icon size={18} className={kpi.color} />
                <p className="text-xs text-muted-foreground font-medium">{kpi.label}</p>
              </div>
              <p className={cn("text-2xl font-bold", kpi.color)}>{kpi.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filing Status Matrix */}
      <Card>
        <CardHeader className="py-3 px-4">
          <CardTitle className="text-sm font-semibold">Filing Status Matrix — FY {fyFilter}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="sticky left-0 bg-background z-10 min-w-[180px]">Client</TableHead>
                  {QUARTER_OPTIONS.map(q => (
                    <TableHead key={q} className="text-center min-w-[200px]">
                      <div>{q}</div>
                      <div className="text-[10px] text-muted-foreground font-normal">
                        Due: {format(getDueDate(fyFilter, q), "dd MMM yyyy")}
                      </div>
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {Object.keys(matrixData).length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                      No filing data for this period
                    </TableCell>
                  </TableRow>
                ) : (
                  Object.entries(matrixData).map(([clientId, quarters]) => {
                    const client = clients.find(c => c.id === clientId);
                    if (clientFilter !== "all" && clientId !== clientFilter) return null;
                    return (
                      <TableRow key={clientId}>
                        <TableCell className="font-medium sticky left-0 bg-background z-10">
                          {client?.name || "—"}
                        </TableCell>
                        {QUARTER_OPTIONS.map(q => {
                          const qFilings = quarters[q];
                          return (
                            <TableCell key={q} className="text-center">
                              <div className="flex flex-wrap gap-1 justify-center">
                                {TDS_FORMS.map(form => {
                                  const status = getFormBadgeStatus(qFilings, form);
                                  if (status === "Not Started" && !qFilings?.some(f => f.tds_forms?.includes(form))) {
                                    return null;
                                  }
                                  return (
                                    <Badge
                                      key={form}
                                      className={cn("text-[10px] cursor-pointer", STATUS_CELL_COLORS[status] || "bg-muted text-muted-foreground")}
                                      onClick={() => onNavigate?.("data-entry", { client: clientId, quarter: q, form })}
                                    >
                                      {form}
                                    </Badge>
                                  );
                                })}
                                {!qFilings && (
                                  <span className="text-[10px] text-muted-foreground">—</span>
                                )}
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
        </CardContent>
      </Card>

      {/* Bottom Row - Two Panels */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Upcoming Due Dates */}
        <Card>
          <CardHeader className="py-3 px-4">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Clock size={16} className="text-amber-600" />
              Upcoming Due Dates (Next 30 Days)
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="max-h-[300px] overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Client</TableHead>
                    <TableHead className="text-xs">Form</TableHead>
                    <TableHead className="text-xs">Quarter</TableHead>
                    <TableHead className="text-xs">Due Date</TableHead>
                    <TableHead className="text-xs text-right">Days Left</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {upcomingDueDates.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-muted-foreground py-6 text-sm">
                        No upcoming due dates
                      </TableCell>
                    </TableRow>
                  ) : upcomingDueDates.map(item => (
                    <TableRow key={item.filing.id}>
                      <TableCell className="text-sm font-medium">{item.clientName}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-[10px]">
                          {item.filing.tds_forms?.join(", ")}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm">{item.filing.quarter}</TableCell>
                      <TableCell className="text-sm">{format(item.dueDate, "dd MMM yyyy")}</TableCell>
                      <TableCell className={cn("text-sm text-right font-semibold", getDaysLeftColor(item.daysLeft))}>
                        {item.daysLeft < 0 ? `${Math.abs(item.daysLeft)}d overdue` : `${item.daysLeft}d`}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        {/* Recent Activity */}
        <Card>
          <CardHeader className="py-3 px-4">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <FileText size={16} className="text-blue-600" />
              Recent Activity
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <div className="max-h-[300px] overflow-y-auto space-y-2">
              {recentActivity.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">No recent activity</p>
              ) : recentActivity.map(f => {
                const client = clients.find(c => c.id === f.client_id);
                const updatedBy = users.find(u => u.id === f.last_updated_by);
                return (
                  <div key={f.id} className="flex items-center justify-between py-2 border-b last:border-0">
                    <div className="space-y-0.5">
                      <p className="text-sm font-medium">{client?.name || "—"}</p>
                      <p className="text-xs text-muted-foreground">
                        {f.tds_forms?.join(", ")} • {f.quarter} • {f.financial_year}
                      </p>
                    </div>
                    <div className="text-right space-y-0.5">
                      <Badge className={cn("text-[10px]", STATUS_CELL_COLORS[f.work_status] || "bg-muted")}>
                        {f.work_status}
                      </Badge>
                      <p className="text-[10px] text-muted-foreground">
                        {updatedBy?.name || "System"} • {f.last_updated_at ? format(new Date(f.last_updated_at), "dd MMM HH:mm") : "—"}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
