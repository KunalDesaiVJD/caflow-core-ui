import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import {
  Download, Search, X, ChevronDown, ChevronUp, ChevronsUpDown, Printer, FileSpreadsheet,
} from "lucide-react";
import { isFilingTdsCompliant } from "@/lib/tdsQuarter";
import { exportToExcel } from "@/lib/exportUtils";

interface ClientOption {
  id: string; name: string | null;
  tds_start_fy?: string; tds_start_quarter?: string; tds_end_fy?: string; tds_end_quarter?: string;
  tds_forms_applicable?: string[];
}
interface UserOption { id: string; name: string | null; }

interface AuditEntry {
  id: string; filing_id: string | null; firm_id: string | null;
  action_type: string; old_value: string | null; new_value: string | null;
  changed_by: string | null; changed_by_name: string | null;
  changed_at: string | null; remark: string | null;
}

interface Props {
  clients: ClientOption[];
  users: UserOption[];
  isSuperadmin: boolean;
  resolveFirmId: () => Promise<string | null>;
}

const CURRENT_FY_START = new Date().getMonth() >= 3 ? new Date().getFullYear() : new Date().getFullYear() - 1;
const DEFAULT_FY = `${CURRENT_FY_START}-${String(CURRENT_FY_START + 1).slice(2)}`;
const FY_OPTIONS = Array.from({ length: 7 }, (_, i) => { const s = 2020 + i; return `${s}-${String(s + 1).slice(2)}`; });
const QUARTER_OPTIONS = ["Q1", "Q2", "Q3", "Q4"];
const TDS_FORMS = ["24Q", "26Q", "27Q", "27EQ"];

type SortKey = "date" | "client" | "user" | "action";
type SortDir = "asc" | "desc";

/** Toolbar multi-select filter — search box, Select All, checkbox list,
 *  Clear (N) footer. Same UX/pattern as TdsFilingsManager.tsx's local
 *  MultiSelectFilter (Status / Prepared By) — recreated locally here since
 *  that component isn't exported and this screen needs its own Action Type
 *  version, generalised over {value,label} options. */
function MultiSelectFilter({ label, options, selection, onChange }: {
  label: string;
  options: { value: string; label: string }[];
  selection: string[];
  onChange: (next: string[]) => void;
}) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const visible = q ? options.filter(o => o.label.toLowerCase().includes(q)) : options;
  const set = new Set(selection);
  const allVisibleChecked = visible.length > 0 && visible.every(o => set.has(o.value));

  const toggle = (v: string) => {
    const next = new Set(set);
    if (next.has(v)) next.delete(v); else next.add(v);
    onChange([...next]);
  };
  const toggleAll = () => {
    const next = new Set(set);
    if (allVisibleChecked) visible.forEach(o => next.delete(o.value));
    else visible.forEach(o => next.add(o.value));
    onChange([...next]);
  };

  const triggerLabel =
    selection.length === 0 ? label
    : selection.length === 1 ? (options.find(o => o.value === selection[0])?.label ?? label)
    : `${label} (${selection.length})`;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="h-9 text-xs w-[180px] justify-between font-normal gap-1">
          <span className="truncate">{triggerLabel}</span>
          <ChevronDown size={13} className="ml-1 shrink-0 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-2">
        <div className="relative">
          <Input
            autoFocus
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={`Search ${label.toLowerCase()}…`}
            className="h-7 text-xs pr-6"
          />
          {query && (
            <button type="button" onClick={() => setQuery("")} className="absolute right-1 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              <X size={11} />
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={toggleAll}
          className="mt-2 flex items-center gap-2 px-1.5 py-1 rounded text-[11px] font-medium hover:bg-muted w-full text-left"
        >
          <span className={cn(
            "inline-flex items-center justify-center h-3.5 w-3.5 rounded border shrink-0",
            allVisibleChecked ? "bg-indigo-600 border-indigo-600 text-white" : "border-input",
          )}>
            {allVisibleChecked && <span className="text-[9px] leading-none">✓</span>}
          </span>
          Select All {q && `(${visible.length})`}
        </button>
        <div className="max-h-56 overflow-y-auto pr-0.5 mt-1">
          {visible.map(o => {
            const checked = set.has(o.value);
            return (
              <button
                key={o.value}
                type="button"
                onClick={() => toggle(o.value)}
                className="w-full flex items-center gap-2 px-1.5 py-1 rounded text-[11px] hover:bg-muted text-left"
              >
                <span className={cn(
                  "inline-flex items-center justify-center h-3.5 w-3.5 rounded border shrink-0",
                  checked ? "bg-indigo-600 border-indigo-600 text-white" : "border-input",
                )}>
                  {checked && <span className="text-[9px] leading-none">✓</span>}
                </span>
                <span className="truncate">{o.label}</span>
              </button>
            );
          })}
          {visible.length === 0 && (
            <div className="px-1.5 py-2 text-[11px] text-muted-foreground italic">No match for "{query}".</div>
          )}
        </div>
        {selection.length > 0 && (
          <button
            type="button"
            onClick={() => onChange([])}
            className="mt-1.5 pt-1.5 flex items-center justify-center gap-1 w-full px-2 py-1 rounded text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted border-t border-border"
          >
            <X size={11} /> Clear ({selection.length})
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
}

export function TdsAuditLog({ clients, users, isSuperadmin, resolveFirmId }: Props) {
  const { toast } = useToast();
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filingMap, setFilingMap] = useState<Record<string, any>>({});
  // Full universe of distinct action_type values, fetched independently of
  // both the 500-row display cap and the current Action Type selection below
  // (see the dedicated effect near fetchEntries) — so picking one action
  // type never shrinks this same dropdown down to just that type.
  const [allActionTypes, setAllActionTypes] = useState<string[]>([]);

  // Filters
  const [clientFilter, setClientFilter] = useState("all");
  // Action Type is a MULTI-select (see MultiSelectFilter above). Its options
  // come from `allActionTypes` (not a hardcoded list), so any action type
  // ever written to tds_filing_audit_log is automatically filterable here
  // with zero further changes to this file. The selection itself is pushed
  // into fetchEntries's own server-side query (`.in("action_type", ...)`,
  // below `.limit(500)`) rather than applied only client-side — otherwise a
  // low-frequency action type could have zero of its matching rows inside
  // the most recent 500 (mixed across every action type) and silently show
  // as "no results" despite more matching rows existing further back.
  const [actionTypeFilter, setActionTypeFilter] = useState<string[]>([]);
  const [userFilter, setUserFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  // Free-text search — matches remark, action_type, changed_by_name, and the
  // resolved client name in one pass (client-side, same as the multi-select
  // filters above).
  const [searchQuery, setSearchQuery] = useState("");

  // Column sorting — Date/Client/User/Action headers are clickable; clicking
  // the active column flips direction, clicking a new column selects it
  // (ascending by default). Purely a client-side sort of the already-fetched
  // (and already-filtered) rows; the fetch itself always orders by
  // changed_at desc, unaffected by this.
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("asc"); }
  };

  const fetchEntries = useCallback(async () => {
    setLoading(true);
    const firmId = await resolveFirmId();
    let q = supabase.from("tds_filing_audit_log").select("*").order("changed_at", { ascending: false }).limit(500);
    if (!isSuperadmin && firmId) q = q.eq("firm_id", firmId);
    // Pushed server-side (before the 500-row cap) rather than left to the
    // client-side re-filter in filteredEntries — see the comment on
    // actionTypeFilter's declaration for why.
    if (actionTypeFilter.length > 0) q = q.in("action_type", actionTypeFilter);
    if (userFilter !== "all") q = q.eq("changed_by", userFilter);
    if (dateFrom) q = q.gte("changed_at", dateFrom);
    if (dateTo) q = q.lte("changed_at", dateTo + "T23:59:59");
    const { data } = await q;
    setEntries((data || []) as AuditEntry[]);

    // Fetch filing details for display
    const filingIds = [...new Set((data || []).map((e: any) => e.filing_id).filter(Boolean))];
    if (filingIds.length > 0) {
      const { data: filings } = await supabase.from("tds_filings")
        .select("id, client_id, tds_forms, quarter, financial_year")
        .in("id", filingIds);
      const map: Record<string, any> = {};
      (filings || []).forEach((f: any) => { map[f.id] = f; });
      setFilingMap(map);
    }
    setLoading(false);
  }, [isSuperadmin, resolveFirmId, userFilter, dateFrom, dateTo, actionTypeFilter]);

  useEffect(() => { fetchEntries(); }, [fetchEntries]);

  // Distinct action_type universe for the multi-select's option list — a
  // separate, narrow (single-column) query, deliberately NOT scoped by the
  // current actionTypeFilter selection or the 500-row display cap above, so
  // selecting some types never removes the others from being re-selectable.
  useEffect(() => {
    (async () => {
      const firmId = await resolveFirmId();
      let q = supabase.from("tds_filing_audit_log").select("action_type").limit(5000);
      if (!isSuperadmin && firmId) q = q.eq("firm_id", firmId);
      const { data } = await q;
      const present = new Set((data || []).map((r: any) => r.action_type).filter(Boolean));
      setAllActionTypes([...present].sort((a, b) => a.localeCompare(b)));
    })();
  }, [isSuperadmin, resolveFirmId]);

  // Base set — TDS Compliance gate + Client filter, applied unconditionally
  // (same per-row gate as every other TDS screen) on top of the already
  // server-filtered (firm/action-type/user/date) `entries`. Action Type's own
  // option list does NOT derive from this set — see actionTypeOptions below.
  const baseEntries = useMemo(() => {
    return entries.filter(e => {
      const filing = e.filing_id ? filingMap[e.filing_id] : null;
      // TDS Compliance is the single source of truth — an entry whose filing
      // is for a de-configured form, an out-of-range quarter, or a client
      // with no TDS Compliance must not appear or be counted here. Same
      // per-row gate as every other TDS screen (applied unconditionally).
      if (filing) {
        const client = clients.find(c => c.id === filing.client_id);
        if (!client || !isFilingTdsCompliant(filing, client)) return false;
      }
      if (clientFilter !== "all") {
        if (!filing || filing.client_id !== clientFilter) return false;
      }
      return true;
    });
  }, [entries, filingMap, clients, clientFilter]);

  // Action Type filter options — the full distinct-value universe fetched
  // independently (see the dedicated effect above), not just what happens to
  // be in the currently-loaded/filtered rows.
  const actionTypeOptions = useMemo(
    () => allActionTypes.map(a => ({ value: a, label: a })),
    [allActionTypes],
  );

  // Final filtered set — base rows further narrowed by the free-text search
  // (remark, action_type, changed_by_name, resolved client name — all in one
  // pass). Action Type itself is already applied server-side in fetchEntries
  // (before the 500-row cap); this re-check is a harmless no-op safety net,
  // not the source of truth for that filter.
  const filteredEntries = useMemo(() => {
    const actionSet = actionTypeFilter.length ? new Set(actionTypeFilter) : null;
    const q = searchQuery.trim().toLowerCase();
    return baseEntries.filter(e => {
      if (actionSet && !actionSet.has(e.action_type)) return false;
      if (!q) return true;
      const filing = e.filing_id ? filingMap[e.filing_id] : null;
      const client = filing ? clients.find(c => c.id === filing.client_id) : null;
      const haystack = [e.remark, e.action_type, e.changed_by_name, client?.name]
        .filter(Boolean).join(" ").toLowerCase();
      return haystack.includes(q);
    });
  }, [baseEntries, actionTypeFilter, searchQuery, filingMap, clients]);

  // Client-side sort applied last, on top of the filtered set — toggled by
  // clicking the Date/Client/User/Action column headers.
  const sortedEntries = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    const decorated = filteredEntries.map(e => {
      const filing = e.filing_id ? filingMap[e.filing_id] : null;
      const client = filing ? clients.find(c => c.id === filing.client_id) : null;
      return { e, client };
    });
    decorated.sort((a, b) => {
      if (sortKey === "date") {
        const at = a.e.changed_at ? new Date(a.e.changed_at).getTime() : 0;
        const bt = b.e.changed_at ? new Date(b.e.changed_at).getTime() : 0;
        return (at - bt) * dir;
      }
      const av = sortKey === "client" ? (a.client?.name || "")
        : sortKey === "user" ? (a.e.changed_by_name || "")
        : (a.e.action_type || "");
      const bv = sortKey === "client" ? (b.client?.name || "")
        : sortKey === "user" ? (b.e.changed_by_name || "")
        : (b.e.action_type || "");
      return av.localeCompare(bv) * dir;
    });
    return decorated.map(d => d.e);
  }, [filteredEntries, filingMap, clients, sortKey, sortDir]);

  const SortIcon = ({ col }: { col: SortKey }) => {
    if (sortKey !== col) return <ChevronsUpDown size={12} className="inline ml-1 opacity-30" />;
    return sortDir === "asc"
      ? <ChevronUp size={12} className="inline ml-1" />
      : <ChevronDown size={12} className="inline ml-1" />;
  };

  const sortableHeaderProps = (key: SortKey) => ({
    className: "cursor-pointer select-none hover:text-foreground",
    onClick: () => toggleSort(key),
  });

  const printLog = () => {
    const rows = sortedEntries.map(e => {
      const filing = e.filing_id ? filingMap[e.filing_id] : null;
      const client = filing ? clients.find(c => c.id === filing.client_id) : null;
      return `<tr>
        <td style="border:1px solid #ccc;padding:4px;font-size:11px">${e.changed_at ? format(new Date(e.changed_at), "dd/MM/yyyy HH:mm") : "—"}</td>
        <td style="border:1px solid #ccc;padding:4px;font-size:11px">${client?.name || "—"}</td>
        <td style="border:1px solid #ccc;padding:4px;font-size:11px">${filing?.tds_forms?.join(", ") || "—"}</td>
        <td style="border:1px solid #ccc;padding:4px;font-size:11px">${filing?.quarter || "—"}</td>
        <td style="border:1px solid #ccc;padding:4px;font-size:11px">${e.changed_by_name || "—"}</td>
        <td style="border:1px solid #ccc;padding:4px;font-size:11px">${e.action_type}</td>
        <td style="border:1px solid #ccc;padding:4px;font-size:11px">${e.old_value || "—"} → ${e.new_value || "—"}</td>
        <td style="border:1px solid #ccc;padding:4px;font-size:11px">${e.remark || "—"}</td>
      </tr>`;
    }).join("");
    const html = `<!DOCTYPE html><html><head><title>TDS Audit Log</title><style>body{font-family:system-ui;margin:20px}table{width:100%;border-collapse:collapse}th{background:#f3f4f6;font-size:11px;border:1px solid #ccc;padding:4px}@media print{@page{size:landscape}}</style></head><body>
      <h2>TDS Filing Audit Log</h2>
      <table><thead><tr><th>Date+Time</th><th>Client</th><th>Form</th><th>Quarter</th><th>User</th><th>Action</th><th>Old → New</th><th>Remark</th></tr></thead><tbody>${rows}</tbody></table></body></html>`;
    const blob = new Blob([html], { type: "text/html" });
    const w = window.open(URL.createObjectURL(blob), "_blank");
    if (w) setTimeout(() => w.print(), 500);
  };

  // Real downloadable .xlsx export — same exportToExcel/xlsx utility used by
  // TdsReports.tsx's handleExportExcel, over exactly the rows currently on
  // screen (filtered + sorted), not the raw unfiltered fetch.
  const exportExcel = () => {
    if (sortedEntries.length === 0) {
      toast({ title: "Nothing to export", description: "No audit log rows match the current filters.", variant: "destructive" });
      return;
    }
    const rows = sortedEntries.map(e => {
      const filing = e.filing_id ? filingMap[e.filing_id] : null;
      const client = filing ? clients.find(c => c.id === filing.client_id) : null;
      return {
        "Date + Time": e.changed_at ? format(new Date(e.changed_at), "dd/MM/yyyy HH:mm") : "—",
        "Client": client?.name || "—",
        "Form": filing?.tds_forms?.join(", ") || "—",
        "Quarter": filing?.quarter || "—",
        "User": e.changed_by_name || "—",
        "Action": e.action_type,
        "Old Value": e.old_value || "—",
        "New Value": e.new_value || "—",
        "Remark": e.remark || "—",
      };
    });
    exportToExcel([{ sheetName: "Audit Log", rows }], `TDS_Audit_Log_${format(new Date(), "yyyy-MM-dd")}.xlsx`);
  };

  return (
    <div className="space-y-4">
      {/* Title lives on the parent's "Audit & Corrections" tab header — this
          screen only describes its own sub-tab. */}
      <p className="text-sm text-muted-foreground">All status changes, notes, and actions across TDS filings</p>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-end">
        <div className="space-y-1">
          <Label className="text-xs">Client</Label>
          <Select value={clientFilter} onValueChange={setClientFilter}>
            <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Clients</SelectItem>
              {clients.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Action Type</Label>
          <MultiSelectFilter
            label="All Actions"
            options={actionTypeOptions}
            selection={actionTypeFilter}
            onChange={setActionTypeFilter}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">User</Label>
          <Select value={userFilter} onValueChange={setUserFilter}>
            <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Users</SelectItem>
              {users.map(u => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">From</Label>
          <Input type="date" className="w-[140px] h-9" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">To</Label>
          <Input type="date" className="w-[140px] h-9" value={dateTo} onChange={e => setDateTo(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Search</Label>
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Remark, action, user, client…"
              className="w-[220px] h-9 pl-7 pr-6"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X size={12} />
              </button>
            )}
          </div>
        </div>
        <div className="flex-1" />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="gap-1">
              <Download size={14} /> Export
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={printLog} className="gap-2 text-xs">
              <Printer size={13} /> Print / PDF Preview
            </DropdownMenuItem>
            <DropdownMenuItem onClick={exportExcel} className="gap-2 text-xs">
              <FileSpreadsheet size={13} /> Export to Excel (.xlsx)
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead {...sortableHeaderProps("date")}>Date + Time <SortIcon col="date" /></TableHead>
                  <TableHead {...sortableHeaderProps("client")}>Client <SortIcon col="client" /></TableHead>
                  <TableHead>Form</TableHead>
                  <TableHead>Quarter</TableHead>
                  <TableHead {...sortableHeaderProps("user")}>User <SortIcon col="user" /></TableHead>
                  <TableHead {...sortableHeaderProps("action")}>Action <SortIcon col="action" /></TableHead>
                  <TableHead>Old → New</TableHead>
                  <TableHead>Remark</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>{Array.from({ length: 8 }).map((_, j) => <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>)}</TableRow>
                )) : sortedEntries.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                      No audit log entries found.
                    </TableCell>
                  </TableRow>
                ) : sortedEntries.map(e => {
                  const filing = e.filing_id ? filingMap[e.filing_id] : null;
                  const client = filing ? clients.find(c => c.id === filing.client_id) : null;
                  return (
                    <TableRow key={e.id}>
                      <TableCell className="text-xs whitespace-nowrap">
                        {e.changed_at ? format(new Date(e.changed_at), "dd/MM/yyyy HH:mm") : "—"}
                      </TableCell>
                      <TableCell className="text-sm">{client?.name || "—"}</TableCell>
                      <TableCell><Badge variant="outline" className="text-xs">{filing?.tds_forms?.join(", ") || "—"}</Badge></TableCell>
                      <TableCell className="text-xs">{filing?.quarter || "—"}</TableCell>
                      <TableCell className="text-sm">{e.changed_by_name || "—"}</TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="text-[10px]">{e.action_type}</Badge>
                      </TableCell>
                      <TableCell className="text-xs">
                        {e.old_value || e.new_value ? (
                          <span>{e.old_value || "—"} → {e.new_value || "—"}</span>
                        ) : "—"}
                      </TableCell>
                      {/* Wraps instead of truncating with "..." — a remark (an
                          override reason, a narration excerpt, etc.) is often
                          the single most important field on the row, so it
                          must never be silently cut off. The native `title`
                          also surfaces the full text as a hover tooltip. */}
                      <TableCell className="text-xs max-w-[340px] whitespace-normal break-words" title={e.remark || undefined}>{e.remark || "—"}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
