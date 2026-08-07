/**
 * ServiceMatrixView
 *
 * "Service-wise" Clients view — one row per client, one column per active
 * service category, so an auditor can see at a glance which clients have
 * which services active (GST / TDS / Statutory Audit / etc.) without
 * opening each client individually.
 *
 * Self-contained data fetching, same pattern as ClassificationByFYView:
 * queries client_services + service_categories directly rather than reusing
 * the parent's `filtered` list, since it needs the full per-service map
 * (not just a flat "N active" count like the other views get from
 * serviceCountMap).
 *
 * Clicking a summary tile or a column header FILTERS the table down to
 * just clients with that service active (not merely a highlight) — the
 * behaviour the firm asked for after reviewing the mockup.
 */
import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Check, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface ServiceCat {
  id: string;
  name: string;
}

interface ClientRow {
  id: string;
  name: string | null;
  pan: string | null;
  entity_type: string | null;
}

interface Props {
  firmId: string | null;
  showAllFirms: boolean;
  search?: string;
  entityFilter?: string;
  onOpenClient: (id: string) => void;
}

/** Fetch every row across the Supabase 1000-row response cap by paging with .range(). */
async function fetchAllPages<T>(builder: (from: number, to: number) => any): Promise<T[]> {
  const PAGE = 1000;
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await builder(from, from + PAGE - 1);
    if (error) { console.error("[ServiceMatrixView] paged fetch:", error); break; }
    const batch = (data as T[]) || [];
    out.push(...batch);
    if (batch.length < PAGE) break;
    if (from > 200_000) break; // safety valve
  }
  return out;
}

export function ServiceMatrixView({ firmId, showAllFirms, search, entityFilter, onOpenClient }: Props) {
  const [services, setServices] = useState<ServiceCat[]>([]);
  const [clients, setClients] = useState<ClientRow[]>([]);
  // Set of "clientId::serviceCategoryId" — O(1) active-service lookup per cell.
  const [activeSet, setActiveSet] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!firmId && !showAllFirms) return;
    setLoading(true);
    try {
      let svcQ = supabase.from("service_categories").select("id, name").eq("is_active", true).order("name");
      if (!showAllFirms && firmId) svcQ = svcQ.eq("firm_id", firmId);
      const { data: svcRows } = await svcQ;
      const svcList = ((svcRows ?? []) as ServiceCat[]);
      setServices(svcList);

      const clientRows = await fetchAllPages<ClientRow>((from, to) => {
        let cq = supabase
          .from("clients")
          .select("id, name, pan, entity_type")
          .is("deleted_at", null)
          .or("is_draft.eq.false,and(is_draft.eq.true,source.eq.api_import)")
          .order("name", { ascending: true })
          .range(from, to);
        if (!showAllFirms && firmId) cq = cq.eq("firm_id", firmId);
        return cq;
      });
      setClients(clientRows);

      if (clientRows.length === 0) { setActiveSet(new Set()); return; }

      const clientIds = clientRows.map(c => c.id);
      const validServiceIds = new Set(svcList.map(s => s.id));
      const CHUNK = 500;
      const pairs: string[] = [];
      for (let i = 0; i < clientIds.length; i += CHUNK) {
        const idsChunk = clientIds.slice(i, i + CHUNK);

        // Direct per-service assignments.
        const csRows = await fetchAllPages<{ client_id: string; service_category_id: string }>((from, to) =>
          supabase
            .from("client_services")
            .select("client_id, service_category_id")
            .in("client_id", idsChunk)
            .eq("is_active", true)
            .range(from, to)
        );
        for (const r of csRows) pairs.push(`${r.client_id}::${r.service_category_id}`);

        // Package billing — a client on an active package has every service
        // in that package's service_category_ids array, even with NO
        // client_services row for it. Skipping this undercounted every
        // tile by however many clients are package-billed for that service
        // (confirmed: 2 clients had IT Returns via package only, causing
        // the "517 vs 519" mismatch against the IT Returns module, which
        // already unions both sources — see resolveClassification there).
        const pkgRows = await fetchAllPages<{ client_id: string; service_category_ids: string[] | null }>((from, to) =>
          supabase
            .from("client_service_packages")
            .select("client_id, service_category_ids")
            .in("client_id", idsChunk)
            .eq("is_active", true)
            .range(from, to)
        );
        for (const r of pkgRows) {
          for (const catId of (r.service_category_ids ?? [])) {
            if (validServiceIds.has(catId)) pairs.push(`${r.client_id}::${catId}`);
          }
        }
      }
      setActiveSet(new Set(pairs));
    } finally {
      setLoading(false);
    }
  }, [firmId, showAllFirms]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const isActive = (clientId: string, serviceId: string) => activeSet.has(`${clientId}::${serviceId}`);

  const serviceCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of services) {
      let n = 0;
      for (const c of clients) if (isActive(c.id, s.id)) n++;
      counts.set(s.id, n);
    }
    return counts;
  }, [services, clients, activeSet]);

  const maxCount = Math.max(1, ...Array.from(serviceCounts.values()));

  const q = (search ?? "").trim().toLowerCase();
  const rows = useMemo(() => {
    return clients.filter(c => {
      const matchesSearch = !q || (c.name || "").toLowerCase().includes(q) || (c.pan || "").toLowerCase().includes(q);
      const matchesEntity = !entityFilter || entityFilter === "all" || c.entity_type === entityFilter;
      const matchesService = !picked || isActive(c.id, picked);
      return matchesSearch && matchesEntity && matchesService;
    });
  }, [clients, q, entityFilter, picked, activeSet]);

  if (loading && clients.length === 0) {
    return (
      <div className="flex items-center justify-center h-40 text-sm text-muted-foreground">
        Loading service matrix…
      </div>
    );
  }

  if (services.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-40 gap-2 text-muted-foreground">
        <p className="text-sm">No active service categories configured for this firm.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* ── Summary strip — click a tile to filter the table to that service ── */}
      <div
        className="grid gap-2.5"
        style={{ gridTemplateColumns: `repeat(${Math.min(services.length, 9)}, minmax(0, 1fr))` }}
      >
        {services.map(s => {
          const n = serviceCounts.get(s.id) ?? 0;
          const pct = Math.round((n / maxCount) * 100);
          const isPicked = picked === s.id;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => setPicked(p => (p === s.id ? null : s.id))}
              className={cn(
                "text-left rounded-lg border bg-card p-3 transition-all hover:-translate-y-0.5 hover:shadow-sm",
                isPicked ? "border-primary ring-1 ring-primary" : "border-border",
              )}
            >
              <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground truncate mb-1.5">
                {s.name}
              </div>
              <div className="text-lg font-bold tabular-nums">{n}</div>
              <div className="h-[3px] rounded-full bg-muted mt-2 overflow-hidden">
                <div className="h-full rounded-full bg-emerald-500" style={{ width: `${pct}%` }} />
              </div>
            </button>
          );
        })}
      </div>

      {/* ── Filter status line ── */}
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {picked ? (
            <>
              Filtered to <span className="font-semibold text-foreground">{services.find(s => s.id === picked)?.name}</span>
              {" — "}
              <span className="font-semibold text-foreground tabular-nums">{rows.length}</span> of {clients.length} clients
            </>
          ) : (
            <>Showing <span className="font-semibold text-foreground tabular-nums">{rows.length}</span> of {clients.length} clients</>
          )}
        </span>
        {picked && (
          <button type="button" onClick={() => setPicked(null)} className="flex items-center gap-1 text-primary hover:underline">
            <X className="h-3 w-3" /> Clear service filter
          </button>
        )}
      </div>

      {/* ── Matrix table ── */}
      <div className="border border-border rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-xs" style={{ minWidth: 640 + services.length * 44 }}>
            <thead>
              <tr className="bg-muted/60 border-b border-border">
                <th className="sticky left-0 z-10 bg-muted/60 text-left px-3 py-2.5 font-semibold text-muted-foreground uppercase tracking-wide text-[10.5px] whitespace-nowrap">
                  Client Name
                </th>
                <th className="text-left px-3 py-2.5 font-semibold text-muted-foreground uppercase tracking-wide text-[10.5px] whitespace-nowrap">PAN</th>
                <th className="text-left px-3 py-2.5 font-semibold text-muted-foreground uppercase tracking-wide text-[10.5px] whitespace-nowrap">Constitution</th>
                {services.map(s => (
                  <th
                    key={s.id}
                    onClick={() => setPicked(p => (p === s.id ? null : s.id))}
                    className={cn(
                      "w-11 min-w-11 align-bottom pb-2.5 pt-2 cursor-pointer transition-colors",
                      picked === s.id ? "bg-primary/10" : "hover:bg-muted",
                    )}
                  >
                    <span
                      className={cn(
                        "inline-block whitespace-nowrap text-[10.5px] font-semibold origin-bottom-left",
                        picked === s.id ? "text-primary" : "text-muted-foreground",
                      )}
                      style={{ transform: "rotate(-38deg)" }}
                    >
                      {s.name}
                    </span>
                  </th>
                ))}
                <th className="text-right px-3 py-2.5 font-semibold text-muted-foreground uppercase tracking-wide text-[10.5px] whitespace-nowrap">Active</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c, i) => {
                const total = services.filter(s => isActive(c.id, s.id)).length;
                return (
                  <tr key={c.id} className={cn("border-b border-border last:border-b-0 hover:bg-primary/5", i % 2 === 1 && "bg-muted/20")}>
                    <td className="sticky left-0 z-10 bg-inherit px-3 py-2 whitespace-nowrap">
                      <button type="button" onClick={() => onOpenClient(c.id)} className="font-semibold text-primary hover:underline text-left">
                        {c.name || "—"}
                      </button>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">{c.pan || "—"}</td>
                    <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">{c.entity_type || "—"}</td>
                    {services.map(s => {
                      const on = isActive(c.id, s.id);
                      return (
                        <td key={s.id} className="text-center py-2">
                          {on ? (
                            <span className="inline-flex items-center justify-center h-4 w-4 rounded-full bg-emerald-500/15">
                              <Check className="h-2.5 w-2.5 text-emerald-600" />
                            </span>
                          ) : (
                            <span className="inline-block h-1 w-1 rounded-full bg-muted-foreground/30" />
                          )}
                        </td>
                      );
                    })}
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      <span className="inline-block px-2 py-0.5 rounded-full text-[11px] font-bold tabular-nums bg-muted text-foreground">
                        {total} active
                      </span>
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={services.length + 4} className="text-center py-8 text-muted-foreground">
                    No clients match the current filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
