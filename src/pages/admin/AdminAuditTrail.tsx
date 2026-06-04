/**
 * AdminAuditTrail — engagement-level audit log viewer for firm_admin + superadmin.
 *
 * Backed by public.engagement_audit_log (populated by the
 * log_audit_engagement_change() trigger on every audit_engagements
 * INSERT/UPDATE/DELETE).
 *
 * RLS on engagement_audit_log already restricts visibility to the user's own
 * firm (or all firms for superadmin), so this page just reads the table
 * directly and trusts the database to filter rows correctly.
 */

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollText, Search, Filter, RotateCw } from "lucide-react";

interface AuditRow {
  id: string;
  engagement_id: string;
  firm_id: string | null;
  action: "create" | "update" | "delete";
  changed_by: string | null;
  changed_by_name: string | null;
  changed_by_email: string | null;
  changed_at: string;
  snapshot: any;
}

const ACTION_BADGE: Record<AuditRow["action"], { label: string; cls: string }> = {
  create: { label: "Create", cls: "bg-emerald-500/15 text-emerald-700 border-emerald-500/30" },
  update: { label: "Update", cls: "bg-amber-500/15 text-amber-700 border-amber-500/30" },
  delete: { label: "Delete", cls: "bg-destructive/15 text-destructive border-destructive/30" },
};

// 2026-06-04 — Per user request, the trail must only surface MEANINGFUL
// changes (firm or engagement partner). Every other field-level diff is
// internal plumbing the auditor doesn't care about (active_tabs, stage
// status JSON, signed_at, etc.). Update rows where neither of these fields
// changed are dropped from the list entirely instead of cluttering it with
// "(no scalar field changed)" placeholders.
const MEANINGFUL_FIELDS = new Set([
  "firm_id",
  "audit_firm_id",
  "partner_id",
  "partner_name",
]);

const FIELD_LABEL: Record<string, string> = {
  firm_id:       "Firm",
  audit_firm_id: "Audit Firm",
  partner_id:    "Engagement Partner",
  partner_name:  "Engagement Partner",
};

interface MeaningfulChange { label: string; before: string; after: string; }

function meaningfulChanges(snap: any): MeaningfulChange[] {
  if (!snap?.before || !snap?.after) return [];
  const before = snap.before, after = snap.after;
  const out: MeaningfulChange[] = [];
  const seenLabels = new Set<string>();
  for (const k of MEANINGFUL_FIELDS) {
    if (!(k in before) && !(k in after)) continue;
    const b = before[k], a = after[k];
    if (b === a) continue;
    const label = FIELD_LABEL[k] ?? k;
    if (seenLabels.has(label)) continue;   // collapse partner_id + partner_name
    seenLabels.add(label);
    out.push({ label, before: String(b ?? "—"), after: String(a ?? "—") });
  }
  return out;
}

const fmtIST = (iso: string) => {
  const d = new Date(iso);
  return d.toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true, timeZone: "Asia/Kolkata" });
};

export default function AdminAuditTrail() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const canView = user?.role === "superadmin" || user?.role === "firm_admin";

  const [rows, setRows] = useState<AuditRow[]>([]);
  const [clientLookup, setClientLookup] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  // Filters
  const [actionFilter, setActionFilter] = useState<"all" | AuditRow["action"]>("all");
  const [search, setSearch] = useState("");
  const [days, setDays] = useState<number>(30);

  useEffect(() => {
    if (!authLoading && user && !canView) navigate("/", { replace: true });
  }, [authLoading, user, canView, navigate]);

  async function load() {
    setLoading(true);
    const sinceIso = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await supabase
      .from("engagement_audit_log")
      .select("*")
      .gte("changed_at", sinceIso)
      .order("changed_at", { ascending: false })
      .limit(2000);
    if (error) {
      console.error("audit-trail load:", error.message);
      setRows([]);
      setLoading(false);
      return;
    }
    const list: AuditRow[] = (data || []) as AuditRow[];
    setRows(list);

    // Build a name lookup for client_id values that appear in snapshots
    const clientIds = new Set<string>();
    for (const r of list) {
      const row = r.action === "update" ? r.snapshot?.after || r.snapshot?.before : r.snapshot;
      const cid = row?.client_id;
      if (cid) clientIds.add(cid);
    }
    if (clientIds.size > 0) {
      const { data: cdata } = await supabase
        .from("clients")
        .select("id, name")
        .in("id", [...clientIds]);
      const lookup: Record<string, string> = {};
      for (const c of (cdata || [])) lookup[c.id] = c.name || "(unknown)";
      setClientLookup(lookup);
    }
    setLoading(false);
  }

  useEffect(() => {
    if (canView) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canView, days]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter(r => {
      if (actionFilter !== "all" && r.action !== actionFilter) return false;
      // 2026-06-04 — Drop noise: keep updates only when they touched a
      // meaningful field (firm or engagement partner). Creates and deletes
      // always render. Auditors don't want to see updates that only flipped
      // an internal flag like stage_statuses / signed_at / active_tabs.
      if (r.action === "update" && meaningfulChanges(r.snapshot).length === 0) {
        return false;
      }
      if (!q) return true;
      const row = r.action === "update" ? r.snapshot?.after || r.snapshot?.before : r.snapshot;
      const haystack = [
        r.changed_by_name, r.changed_by_email,
        r.engagement_id,
        clientLookup[row?.client_id] || "",
        row?.financial_year, row?.audit_type, row?.status,
      ].filter(Boolean).join(" ").toLowerCase();
      return haystack.includes(q);
    });
  }, [rows, actionFilter, search, clientLookup]);

  if (authLoading) return <div className="p-6"><div className="h-24 bg-muted/40 rounded animate-pulse" /></div>;
  if (!canView) return null;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <ScrollText className="h-6 w-6 text-primary" />
          Engagement Audit Trail
        </h1>
        <p className="text-sm text-muted-foreground">
          Every create, update and delete of an audit engagement — who, when, and what changed.
          {user?.role === "superadmin" ? " Showing all firms." : " Showing your firm only."}
        </p>
      </div>

      {/* Filters */}
      <Card className="p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[240px]">
            <label className="text-xs text-muted-foreground mb-1 block">Search (user, client, engagement id)</label>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="e.g. Vaidehi, DHAWAL, ce8ff..."
                className="pl-8 h-9"
              />
            </div>
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Action</label>
            <Select value={actionFilter} onValueChange={v => setActionFilter(v as any)}>
              <SelectTrigger className="w-[140px] h-9"><Filter className="h-3.5 w-3.5 mr-1" /><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All actions</SelectItem>
                <SelectItem value="create">Create only</SelectItem>
                <SelectItem value="update">Update only</SelectItem>
                <SelectItem value="delete">Delete only</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Range</label>
            <Select value={String(days)} onValueChange={v => setDays(Number(v))}>
              <SelectTrigger className="w-[140px] h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="7">Last 7 days</SelectItem>
                <SelectItem value="30">Last 30 days</SelectItem>
                <SelectItem value="90">Last 90 days</SelectItem>
                <SelectItem value="365">Last year</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button variant="outline" size="sm" onClick={load} disabled={loading} className="h-9">
            <RotateCw className={`h-3.5 w-3.5 mr-1 ${loading ? "animate-spin" : ""}`} /> Refresh
          </Button>
        </div>
        <div className="text-xs text-muted-foreground mt-2">
          {loading ? "Loading…" : `${filtered.length} event(s) shown` + (rows.length !== filtered.length ? ` (of ${rows.length} in range)` : "")}
        </div>
      </Card>

      {/* Event list */}
      <Card className="overflow-hidden">
        {filtered.length === 0 && !loading && (
          <div className="p-8 text-center text-sm text-muted-foreground">
            No events match these filters.
          </div>
        )}
        <div className="divide-y">
          {filtered.map(r => {
            const row = r.action === "update" ? r.snapshot?.after || r.snapshot?.before : r.snapshot;
            const clientName = clientLookup[row?.client_id] || "(unknown client)";
            const fy   = row?.financial_year ? `FY ${row.financial_year}` : "";
            const type = row?.audit_type as string | undefined;
            const changes = r.action === "update" ? meaningfulChanges(r.snapshot) : [];
            return (
              <div key={r.id} className="px-4 py-3 hover:bg-muted/30 transition-colors">
                <div className="flex flex-wrap items-center gap-3 text-sm">
                  <Badge variant="outline" className={ACTION_BADGE[r.action].cls}>
                    {ACTION_BADGE[r.action].label}
                  </Badge>
                  <span className="font-medium">{clientName}</span>
                  {(fy || type) && (
                    <span className="text-xs text-muted-foreground">
                      {[type, fy].filter(Boolean).join(" · ")}
                    </span>
                  )}
                  <div className="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
                    <span>
                      by <span className="font-medium text-foreground">
                        {r.changed_by_name || (r.changed_by_email ? r.changed_by_email
                          : (r.changed_by ? r.changed_by.slice(0, 8) + "…" : "system"))}
                      </span>
                    </span>
                    <span>{fmtIST(r.changed_at)} IST</span>
                  </div>
                </div>
                {/* For update rows — list only the meaningful field changes
                     (firm / partner) the auditor cares about. Other diffs
                     have already been filtered out above. */}
                {changes.length > 0 && (
                  <div className="mt-1.5 pl-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    {changes.map((c, i) => (
                      <span key={i}>
                        <span className="font-medium text-foreground">{c.label}</span>
                        {": "}
                        <span>{c.before}</span>
                        <span className="mx-1">→</span>
                        <span className="font-medium text-foreground">{c.after}</span>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
