import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { TdsFilingsManager, type KpiStatusGroup, type FilingsPreset } from "@/components/tds/TdsFilingsManager";
import { getDefaultTdsQuarter, isClientTdsEligible, clientHasTdsForm, isFilingTdsCompliant } from "@/lib/tdsQuarter";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import {
  Users, Clock, AlertTriangle, CheckCircle2, FileCheck, Ban, MinusCircle,
  Printer, TrendingUp, Info,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  Tooltip, TooltipContent, TooltipTrigger, TooltipProvider,
} from "@/components/ui/tooltip";

interface ClientOption {
  id: string; name: string | null; pan: string | null; tan_number?: string | null;
  tds_start_fy?: string; tds_start_quarter?: string; tds_end_fy?: string; tds_end_quarter?: string;
  tds_forms_applicable?: string[];
}
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

const TERMINAL_STATUSES = new Set([
  "Filed", "Submitted", "Processed", "Accepted", "Not Applicable", "NIL",
]);

// TDS Compliance Start/End Quarter — single source of truth for whether a
// client should appear for a given FY+quarter. A client with no TDS
// Compliance configured at all (matched only via a legacy TAN/name
// fallback) is excluded from every dashboard card.
function clientInTdsRange(client: ClientOption | undefined, fy: string, quarter: string): boolean {
  return isClientTdsEligible(client?.tds_start_fy, client?.tds_start_quarter, fy, quarter, client?.tds_end_fy, client?.tds_end_quarter);
}

// Client bifurcation by form — TDS Forms Applicable is the single source of
// truth. A client with no configured forms at all (fallback match, no real
// client_services row) never counts toward a SPECIFIC form — only "All Forms"
// still shows them, so legacy/unconfigured clients don't vanish from the
// module entirely.
function clientHasForm(client: ClientOption | undefined, form: string): boolean {
  return clientHasTdsForm(client?.tds_forms_applicable, form);
}

export function TdsDashboard({ clients, users, isSuperadmin, resolveFirmId, onNavigate, refreshKey }: Props) {
  const { toast } = useToast();
  const smartDefault = useMemo(() => getDefaultTdsQuarter(), []);

  const [filings, setFilings] = useState<TdsFiling[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [formTab, setFormTab] = useState("all");
  const [fyFilter, setFyFilter] = useState(smartDefault.fy);
  const [quarterFilter, setQuarterFilter] = useState(smartDefault.quarter);
  const [clientFilter, setClientFilter] = useState("all");
  const [clientFilterSearch, setClientFilterSearch] = useState("");

  const [deletedClientIds, setDeletedClientIds] = useState<Set<string>>(new Set());

  // KPI card click → filters the embedded Client Filing Summary table below
  const [kpiPreset, setKpiPreset] = useState<FilingsPreset | null>(null);
  const filingSummaryRef = useRef<HTMLDivElement>(null);
  const [isFilingSummaryMaximized, setIsFilingSummaryMaximized] = useState(false);
  // Lock page scroll behind the fullscreen overlay — purely cosmetic, no
  // component unmounts, so filters/sorting/unsaved edits are unaffected.
  useEffect(() => {
    document.body.style.overflow = isFilingSummaryMaximized ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [isFilingSummaryMaximized]);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const firmId = await resolveFirmId();

    // Filings — high limit so counts/rows are never silently truncated as
    // filing volume grows (default PostgREST cap is 1000).
    let q = supabase.from("tds_filings").select("*").order("created_at", { ascending: false }).limit(20000);
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

  // Dynamic form tabs — only show a form's tab when at least one client is
  // actually assigned it (Multi-Form Selection / Client Bifurcation).
  const visibleForms = useMemo(
    () => ALL_FORMS.filter(f => clients.some(c => clientHasForm(c, f))),
    [clients],
  );

  // Reset back to "All Forms" if the selected tab's form is no longer visible
  // (e.g. the last client assigned to it was reconfigured away from it).
  useEffect(() => {
    if (formTab !== "all" && !visibleForms.includes(formTab)) setFormTab("all");
  }, [formTab, visibleForms]);

  const today = new Date();

  // Apply form tab filter — exclude deleted clients
  const filteredFilings = useMemo(() => {
    let f = filings.filter(fl => !deletedClientIds.has(fl.client_id));
    // TDS Compliance is the single source of truth — applied UNCONDITIONALLY,
    // not only when a specific form tab is picked. A stale row for a form the
    // client is no longer configured for (or outside their Start/End Quarter
    // range) must never surface, including under "All Forms".
    f = f.filter(fl => isFilingTdsCompliant(fl, clients.find(c => c.id === fl.client_id)));
    if (formTab !== "all") {
      f = f.filter(fl => fl.tds_forms?.includes(formTab));
    }
    if (quarterFilter !== "all") {
      f = f.filter(fl => fl.quarter === quarterFilter);
    }
    return f;
  }, [filings, formTab, quarterFilter, deletedClientIds, clients]);

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

  // Checklist print
  const generateChecklist = () => {
    const quarters = QUARTER_OPTIONS;
    // Only clients with at least one in-range quarter this FY, AND assigned
    // the selected form (Client Bifurcation), appear at all.
    const eligibleClients = clients.filter(client =>
      quarters.some(q => clientInTdsRange(client, fyFilter, q)) &&
      (formTab === "all" || clientHasForm(client, formTab)),
    );
    const rows = eligibleClients.map(client => {
      // ONLY the client's configured TDS Forms Applicable — never a global
      // fallback. A client with no configured forms prints no statuses, so
      // the checklist matches TDS Compliance exactly (fail-closed, same as
      // isFilingTdsCompliant).
      const clientForms = client.tds_forms_applicable && client.tds_forms_applicable.length > 0
        ? client.tds_forms_applicable
        : [];
      const forms = formTab === "all" ? clientForms : clientForms.filter(f => f === formTab);
      // Only compliant rows feed the checklist cells (form in config AND in range).
      const clientFilings = filings.filter(f =>
        f.client_id === client.id && f.financial_year === fyFilter && isFilingTdsCompliant(f, client));
      const qCells = quarters.map(q => {
        if (!clientInTdsRange(client, fyFilter, q)) {
          return `<td style="border:1px solid #ccc;padding:6px;font-size:11px;color:#999">Out of period</td>`;
        }
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

  const kpiCards: { label: string; value: number; icon: typeof Users; color: string; bg: string; statusGroup: KpiStatusGroup; tooltip?: string }[] = [
    { label: "Active TDS Clients", value: stats.activeClients, icon: Users, color: "text-blue-600", bg: "bg-blue-50 dark:bg-blue-950/30", statusGroup: "all" },
    {
      label: "Returns Due", value: stats.returnsDue, icon: Clock, color: "text-amber-600", bg: "bg-amber-50 dark:bg-amber-950/30", statusGroup: "returns-due",
      tooltip: "Counts pending returns, not clients. A client may have multiple pending returns (different TANs/forms), so this count can exceed Active TDS Clients.",
    },
    { label: "Overdue", value: stats.overdue, icon: AlertTriangle, color: "text-destructive", bg: "bg-red-50 dark:bg-red-950/30", statusGroup: "overdue" },
    { label: "Filed / Submitted", value: stats.filed, icon: CheckCircle2, color: "text-emerald-600", bg: "bg-emerald-50 dark:bg-emerald-950/30", statusGroup: "filed" },
    { label: "Processed / Accepted", value: stats.processed, icon: FileCheck, color: "text-emerald-700", bg: "bg-emerald-100 dark:bg-emerald-900/40", statusGroup: "processed" },
    { label: "Not Applicable", value: stats.na, icon: Ban, color: "text-muted-foreground", bg: "bg-muted", statusGroup: "not-applicable" },
    { label: "NIL Returns", value: stats.nil, icon: MinusCircle, color: "text-teal-600", bg: "bg-teal-50 dark:bg-teal-950/30", statusGroup: "nil" },
  ];

  const applyKpiFilter = (statusGroup: KpiStatusGroup) => {
    setKpiPreset({ fy: fyFilter, quarter: quarterFilter, client: clientFilter, form: formTab, statusGroup, nonce: Date.now() });
    filingSummaryRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
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
            {visibleForms.map(f => <TabsTrigger key={f} value={f}>{f}</TabsTrigger>)}
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
                  .filter(c => formTab === "all" || clientHasForm(c, formTab))
                  .filter(c => !clientFilterSearch || (c.name || "").toLowerCase().includes(clientFilterSearch.toLowerCase()))
                  .map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {/* ═══ ROW 2: 7 KPI Cards — click filters the Client Filing Summary table below ═══ */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
        {kpiCards.map(kpi => (
          <Card
            key={kpi.label}
            className={cn("border cursor-pointer transition-shadow hover:shadow-md", kpi.bg)}
            onClick={() => applyKpiFilter(kpi.statusGroup)}
            role="button"
            tabIndex={0}
            onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); applyKpiFilter(kpi.statusGroup); } }}
          >
            <CardContent className="p-3">
              <div className="flex items-center gap-1.5 mb-1">
                <kpi.icon size={14} className={kpi.color} />
                <p className="text-[10px] text-muted-foreground font-medium leading-tight">{kpi.label}</p>
                {kpi.tooltip && (
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Info size={11} className="text-muted-foreground" onClick={e => e.stopPropagation()} />
                      </TooltipTrigger>
                      <TooltipContent className="max-w-[220px] text-xs">{kpi.tooltip}</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                )}
              </div>
              <p className={cn("text-xl font-bold", kpi.color)}>{kpi.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* ═══ ROW 4: Client Filing Summary — the full Filings Management interface, embedded ═══ */}
      <Card
        ref={filingSummaryRef}
        className={cn(isFilingSummaryMaximized && "fixed inset-0 z-50 m-0 rounded-none border-0 overflow-y-auto")}
      >
        <CardHeader className="py-2.5 px-4">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <TrendingUp size={14} className="text-blue-600" />
            FY {fyFilter} — Client Filing Summary
          </CardTitle>
        </CardHeader>
        <CardContent>
          <TdsFilingsManager
            clients={clients}
            users={users}
            isSuperadmin={isSuperadmin}
            resolveFirmId={resolveFirmId}
            onNavigateDataEntry={() => onNavigate?.("data-entry")}
            hideHeader
            preset={kpiPreset}
            onFilingsChanged={fetchAll}
            isMaximized={isFilingSummaryMaximized}
            onToggleMaximize={() => setIsFilingSummaryMaximized(v => !v)}
            refreshKey={refreshKey}
          />
        </CardContent>
      </Card>
    </div>
  );
}
