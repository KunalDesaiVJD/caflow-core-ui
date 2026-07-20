/**
 * AuditStatusSummaryView
 *
 * "All Clients" read-only overview — compact table showing every
 * audit_status row for the firm with a left-join to audit_engagements
 * for the Financial Year column.
 *
 * Features:
 *  - Search bar (client, partner, remarks, status text)
 *  - Audit-status quick-filter dropdown
 *  - Partner filter dropdown
 *  - Color-coded status badges with dot indicator
 *  - Click any row → parent switches to "Select Client" mode for that client
 */
import { useState, useEffect, useMemo, useCallback } from "react";
import { supabase }    from "@/integrations/supabase/client";
import { Input }       from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton }    from "@/components/ui/skeleton";
import { Search, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

interface SummaryRow {
  id:                       string;
  client_id:                string | null;
  party_name:               string | null;
  audit_status:             string | null;
  audit_status_other:       string | null;
  partner:                  string | null;
  firm:                     string | null;
  physical_audit_conducted: string;
  accounting_data:          string;
  scanned:                  string;
  report_print_date:        string | null;
  remarks:                  string | null;
  created_at:               string;
  // Nested from join
  audit_engagements:        { financial_year: string | null } | null;
}

interface Props {
  firmId:          string;
  isSuperadmin?:   boolean;
  onSelectClient?: (clientId: string | null, clientName: string | null) => void;
}

// ─── Status colour map ────────────────────────────────────────────────────────

const STATUS_STYLES: Record<string, { wrap: string; dot: string }> = {
  "DATA PENDING":             { wrap: "bg-gray-100 text-gray-700",     dot: "bg-gray-400"   },
  "QUERIES GIVEN TO CLIENT":  { wrap: "bg-yellow-100 text-yellow-800", dot: "bg-yellow-500" },
  "PREPARE PENDING":          { wrap: "bg-orange-100 text-orange-800", dot: "bg-orange-500" },
  "VERIFICATION PENDING":     { wrap: "bg-blue-100 text-blue-800",     dot: "bg-blue-500"   },
  "REPORT WITH VJD":          { wrap: "bg-violet-100 text-violet-800", dot: "bg-violet-500" },
  "REPORT WITH KVD":          { wrap: "bg-purple-100 text-purple-800", dot: "bg-purple-500" },
  "REPORT SENT TO CLIENT":    { wrap: "bg-teal-100 text-teal-800",     dot: "bg-teal-500"   },
  "REPORT SIGNED":            { wrap: "bg-green-100 text-green-800",   dot: "bg-green-500"  },
  "REPORT PRINTED":           { wrap: "bg-emerald-200 text-emerald-900", dot: "bg-emerald-600" },
  "OTHERS (SPECIFY)":         { wrap: "bg-pink-100 text-pink-800",     dot: "bg-pink-500"   },
};

const ALL_STATUSES = Object.keys(STATUS_STYLES);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtDate(d: string | null) {
  if (!d) return "–";
  return new Date(d).toLocaleDateString("en-IN", {
    day: "numeric", month: "short", year: "numeric",
  });
}

function YesNoBadge({ value }: { value: string }) {
  return value === "Yes"
    ? <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold bg-green-100 text-green-700">Yes</span>
    : <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold bg-red-50 text-red-600">No</span>;
}

function StatusBadge({ status, other }: { status: string | null; other: string | null }) {
  if (!status) return <span className="text-muted-foreground">–</span>;
  const style = STATUS_STYLES[status];
  const label = status === "OTHERS (SPECIFY)" && other ? other : status;
  if (!style) return <span className="text-xs">{label}</span>;
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap", style.wrap)}>
      <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", style.dot)} />
      {label}
    </span>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function AuditStatusSummaryView({ firmId, isSuperadmin, onSelectClient }: Props) {
  const [rows,    setRows]    = useState<SummaryRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [search,        setSearch]        = useState("");
  const [statusFilter,  setStatusFilter]  = useState("all");
  const [partnerFilter, setPartnerFilter] = useState("all");

  // ── Fetch ─────────────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    if (!firmId && !isSuperadmin) { setLoading(false); return; }
    setLoading(true);

    let q = supabase
      .from("audit_status")
      .select("id, client_id, party_name, audit_status, audit_status_other, partner, firm, physical_audit_conducted, accounting_data, scanned, report_print_date, remarks, created_at, audit_engagements(financial_year)")
      .order("party_name", { ascending: true });

    if (!isSuperadmin) q = q.eq("firm_id", firmId);

    const { data, error } = await q;
    if (!error && data) setRows(data as unknown as SummaryRow[]);
    setLoading(false);
  }, [firmId, isSuperadmin]);

  useEffect(() => { load(); }, [load]);

  // ── Derived lists for filter dropdowns ────────────────────────────────────

  const partners = useMemo(() => {
    const set = new Set<string>();
    rows.forEach(r => { if (r.partner) set.add(r.partner); });
    return Array.from(set).sort();
  }, [rows]);

  // ── Filtered rows ─────────────────────────────────────────────────────────

  const filtered = useMemo(() => {
    let result = rows;

    const q = search.trim().toLowerCase();
    if (q) {
      result = result.filter(r =>
        (r.party_name    ?? "").toLowerCase().includes(q) ||
        (r.partner       ?? "").toLowerCase().includes(q) ||
        (r.firm          ?? "").toLowerCase().includes(q) ||
        (r.audit_status  ?? "").toLowerCase().includes(q) ||
        (r.remarks       ?? "").toLowerCase().includes(q)
      );
    }

    if (statusFilter  !== "all") result = result.filter(r => r.audit_status  === statusFilter);
    if (partnerFilter !== "all") result = result.filter(r => r.partner        === partnerFilter);

    return result;
  }, [rows, search, statusFilter, partnerFilter]);

  // ── Status breakdown counts ───────────────────────────────────────────────

  const statusCounts = useMemo(() => {
    const map: Record<string, number> = {};
    rows.forEach(r => {
      const k = r.audit_status ?? "–";
      map[k] = (map[k] ?? 0) + 1;
    });
    return map;
  }, [rows]);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">

      {/* ── Status pills summary bar ── */}
      {!loading && rows.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {ALL_STATUSES.filter(s => statusCounts[s]).map(s => {
            const style = STATUS_STYLES[s];
            return (
              <button
                key={s}
                onClick={() => setStatusFilter(statusFilter === s ? "all" : s)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold transition-all",
                  style.wrap,
                  statusFilter === s ? "ring-2 ring-offset-1 ring-current" : "opacity-80 hover:opacity-100",
                )}
              >
                <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", style.dot)} />
                {s}
                <span className="ml-0.5 opacity-70">({statusCounts[s]})</span>
              </button>
            );
          })}
        </div>
      )}

      {/* ── Filter bar ── */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Search */}
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <Input
            className="pl-8 h-8 text-xs"
            placeholder="Search client, partner, remarks…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        {/* Status filter */}
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="h-8 text-xs w-[200px]">
            <SelectValue placeholder="All Statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all" className="text-xs">All Statuses</SelectItem>
            {ALL_STATUSES.map(s => (
              <SelectItem key={s} value={s} className="text-xs">
                <span className={cn("inline-block w-2 h-2 rounded-full mr-1.5 align-middle", STATUS_STYLES[s].dot)} />
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Partner filter — only shown when partners exist */}
        {partners.length > 0 && (
          <Select value={partnerFilter} onValueChange={setPartnerFilter}>
            <SelectTrigger className="h-8 text-xs w-[150px]">
              <SelectValue placeholder="All Partners" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-xs">All Partners</SelectItem>
              {partners.map(p => (
                <SelectItem key={p} value={p} className="text-xs">{p}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <span className="text-xs text-muted-foreground ml-auto">
          {loading ? "Loading…" : `${filtered.length} of ${rows.length} client${rows.length !== 1 ? "s" : ""}`}
        </span>
      </div>

      {/* ── Summary table ── */}
      <div className="rounded-lg border border-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-indigo-700 text-white text-[10px] uppercase tracking-wide">
                <th className="px-3 py-2.5 text-left font-medium w-9">#</th>
                <th className="px-3 py-2.5 text-left font-medium min-w-[160px]">Client Name</th>
                <th className="px-3 py-2.5 text-left font-medium w-20">FY</th>
                <th className="px-3 py-2.5 text-left font-medium min-w-[190px]">Audit Status</th>
                <th className="px-3 py-2.5 text-left font-medium min-w-[110px]">Partner</th>
                <th className="px-3 py-2.5 text-center font-medium w-24">Physical</th>
                <th className="px-3 py-2.5 text-center font-medium w-24">Acctg Data</th>
                <th className="px-3 py-2.5 text-center font-medium w-20">Scanned</th>
                <th className="px-3 py-2.5 text-left font-medium w-28">Rpt Date</th>
                <th className="px-3 py-2.5 text-left font-medium min-w-[140px]">Remarks</th>
                <th className="px-3 py-2.5 w-8" />
              </tr>
            </thead>

            <tbody>
              {loading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i} className="border-b border-border">
                    {Array.from({ length: 11 }).map((_, j) => (
                      <td key={j} className="px-3 py-2.5">
                        <Skeleton className="h-4 w-full" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={11} className="px-3 py-12 text-center text-muted-foreground">
                    {rows.length === 0
                      ? "No audit entries yet. Add a row from the detail view."
                      : "No entries match the current filters."}
                  </td>
                </tr>
              ) : (
                filtered.map((row, idx) => {
                  const fy = row.audit_engagements?.financial_year ?? "–";
                  return (
                    <tr
                      key={row.id}
                      onClick={() => onSelectClient?.(row.client_id, row.party_name)}
                      className="border-b border-border last:border-0 hover:bg-indigo-50/60 cursor-pointer transition-colors group"
                    >
                      <td className="px-3 py-2.5 text-muted-foreground">{idx + 1}</td>

                      <td className="px-3 py-2.5 font-semibold text-foreground">
                        {row.party_name ?? "–"}
                      </td>

                      <td className="px-3 py-2.5 text-muted-foreground font-mono text-[11px]">{fy}</td>

                      <td className="px-3 py-2.5">
                        <StatusBadge status={row.audit_status} other={row.audit_status_other} />
                      </td>

                      <td className="px-3 py-2.5 text-muted-foreground">{row.partner ?? "–"}</td>

                      <td className="px-3 py-2.5 text-center">
                        <YesNoBadge value={row.physical_audit_conducted} />
                      </td>

                      <td className="px-3 py-2.5 text-center">
                        <YesNoBadge value={row.accounting_data} />
                      </td>

                      <td className="px-3 py-2.5 text-center">
                        <YesNoBadge value={row.scanned} />
                      </td>

                      <td className="px-3 py-2.5 text-muted-foreground">{fmtDate(row.report_print_date)}</td>

                      <td
                        className="px-3 py-2.5 text-muted-foreground max-w-[160px] truncate"
                        title={row.remarks ?? ""}
                      >
                        {row.remarks ?? "–"}
                      </td>

                      {/* Drill-down arrow */}
                      <td className="px-2 py-2.5 text-indigo-300 group-hover:text-indigo-600 transition-colors">
                        <ArrowRight size={12} />
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
