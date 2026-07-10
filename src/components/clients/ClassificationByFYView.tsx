/**
 * ClassificationByFYView
 *
 * Renders a per-FY Audit / Non-Audit client registry.
 * Queries client_fy_classifications.firm_id directly (no large IN() list).
 *
 * Props:
 *   firmId       — current effective firm (null when superadmin shows all)
 *   showAllFirms — superadmin "all firms" mode
 *   canEdit      — whether Edit button is shown
 */

import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Eye, Pencil, RefreshCw, ShieldCheck, ShieldOff, Users, AlertCircle } from "lucide-react";

// ─── Helpers ──────────────────────────────────────────────────────────────────

// 2026-06-25 — Audit tools care about the LAST COMPLETED FY (the one
// whose books are now under audit), not the FY currently in progress.
// In Jul 2026 the auditor is working on FY 2025-26; the ongoing FY
// (2026-27) is irrelevant until next Apr. So the default is the FY that
// ended most recently: April onwards ⇒ y-1 start; Jan–Mar ⇒ y-2 start
// (the FY ends in March of year y, so up to that boundary the previous
// FY is still ongoing).
function getCurrentFY(): string {
  const today = new Date();
  const y = today.getFullYear();
  const m = today.getMonth(); // 0 = Jan
  const start = m >= 3 ? y - 1 : y - 2;
  return `${start}-${String(start + 1).slice(2)}`;
}

function generateFYOptions(): string[] {
  const today = new Date();
  const cur = today.getMonth() >= 3 ? today.getFullYear() : today.getFullYear() - 1;
  const opts: string[] = [];
  for (let y = cur + 2; y >= 2020; y--) {
    opts.push(`${y}-${String(y + 1).slice(2)}`);
  }
  return opts;
}

const FY_OPTIONS = generateFYOptions();

// ─── Types ────────────────────────────────────────────────────────────────────

// 2026-06-25 (V J Desai bug — bucket sum ≠ 1086 total + search misses matches
// in other buckets): added an "Unclassified" bucket so the 5 counts always
// sum to the visible total. Every client not classified for the selected FY
// lands here — no more silent gap. The classification tab is also inferred
// on each row so a cross-bucket search can render the correct badge.
const CLASSIFICATION_TABS = [
  { key: "Audit",                    label: "Audit",                   icon: ShieldCheck,  color: "text-indigo-600" },
  { key: "Non-Audit",                label: "Non-Audit",               icon: ShieldOff,    color: "text-slate-500"  },
  { key: "Partner in Audited Firm",  label: "Partner in Audited Firm", icon: Users,        color: "text-amber-600"  },
  { key: "Not Applicable",           label: "Not Applicable",          icon: AlertCircle,  color: "text-muted-foreground" },
  { key: "Unclassified",             label: "Unclassified",            icon: AlertCircle,  color: "text-rose-500"   },
] as const;

type ClassificationKey = typeof CLASSIFICATION_TABS[number]["key"];

interface ClassifiedClient {
  client_id: string;
  name: string | null;
  entity_type: string | null;
  pan: string | null;
  /** Which bucket this client lives in for the selected FY. Set on every
   *  row so a search that spans all buckets can render the correct badge
   *  and route the user to the right tab if they click through. */
  classification: ClassificationKey;
  /** True for api_import draft rows — used by the Unclassified tab's
   *  Draft/Active sub-filter so the auditor can triage incomplete setups. */
  is_draft?: boolean;
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  firmId: string | null;
  showAllFirms: boolean;
  canEdit: boolean;
  search?: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ClassificationByFYView({ firmId, showAllFirms, canEdit, search }: Props) {
  const navigate = useNavigate();
  const [selectedFY, setSelectedFY]     = useState<string>(getCurrentFY());
  const [activeTab, setActiveTab]       = useState<ClassificationKey>("Audit");
  const [rows, setRows]                 = useState<ClassifiedClient[]>([]);
  const [counts, setCounts]             = useState<Record<ClassificationKey, number>>({
    "Audit": 0, "Non-Audit": 0, "Partner in Audited Firm": 0, "Not Applicable": 0, "Unclassified": 0,
  });
  const [totalClientsCount, setTotalClientsCount] = useState<number>(0);
  const [searchRows, setSearchRows]     = useState<ClassifiedClient[]>([]);
  const [loading, setLoading]           = useState(false);
  // 2026-06-25 — Unclassified sub-filter: All / Active / Draft.
  // Only visible inside the Unclassified tab. Lets the auditor separate
  // api_import drafts (setup incomplete) from finalised clients that
  // simply haven't been classified for this FY yet.
  const [unclFilter, setUnclFilter] = useState<"all" | "active" | "draft">("all");

  // 2026-06-25 — normalized search query, memoised at hook boundary so the
  // fetchData dependency array can react to it (search-across-buckets fires
  // only when q is non-empty).
  const q = (search ?? "").trim().toLowerCase();

  const fetchData = useCallback(async () => {
    // Need either a firm scope or explicit all-firms flag from superadmin
    if (!firmId && !showAllFirms) return;
    setLoading(true);

    try {
      // ── Total All Clients (denominator for Unclassified) ─────────────────
      // MUST match the parent Clients page's "All Clients" count exactly,
      // otherwise the 5 tab counts won't sum to it. The parent counts:
      //   (a) is_draft=false                          — completed clients
      //   (b) is_draft=true AND source='api_import'   — API-imported drafts
      //   both with deleted_at IS NULL.
      // Earlier fix only counted (a) → Unclassified was under-counted by
      // the api_import drafts (V J Desai FY 2025-26 saw 720 vs 1086 = 366
      // clients silently missing). This OR now mirrors parent semantics.
      let totalQ = (supabase as any)
        .from("clients")
        .select("id", { count: "exact", head: true })
        .is("deleted_at", null)
        .or("is_draft.eq.false,and(is_draft.eq.true,source.eq.api_import)");
      if (!showAllFirms && firmId) totalQ = totalQ.eq("firm_id", firmId);
      const { count: totalCount } = await totalQ;
      setTotalClientsCount(totalCount ?? 0);

      // ── Counts for the 4 real buckets ─────────────────────────────────────
      // Query clients as the primary table and use client_fy_classifications!inner
      // as an embedded filter. This avoids PostgREST embedded-resource filter
      // issues with { head: true } counts that can cause incorrect 0 results.
      const realTabs = CLASSIFICATION_TABS.filter(t => t.key !== "Unclassified");
      const countResults = await Promise.all(
        realTabs.map(async (tab) => {
          let cq = (supabase as any)
            .from("clients")
            .select("id, client_fy_classifications!inner(id)", { count: "exact", head: true })
            .eq("client_fy_classifications.financial_year", selectedFY)
            .eq("client_fy_classifications.classification", tab.key)
            .eq("is_draft", false)
            .is("deleted_at", null);
          if (!showAllFirms && firmId) {
            cq = cq.eq("firm_id", firmId);
            cq = cq.eq("client_fy_classifications.firm_id", firmId);
          }
          const { count } = await cq;
          return { key: tab.key, count: count ?? 0 };
        })
      );

      const newCounts: Record<ClassificationKey, number> = {
        "Audit": 0, "Non-Audit": 0, "Partner in Audited Firm": 0, "Not Applicable": 0, "Unclassified": 0,
      };
      let bucketSum = 0;
      countResults.forEach(r => {
        newCounts[r.key as ClassificationKey] = r.count;
        bucketSum += r.count;
      });
      // ── Unclassified = Total All Clients − Σ(classified buckets) ────────
      // Anything the auditor hasn't classified for this FY lands here so
      // the bucket totals ALWAYS sum to the visible All Clients count.
      newCounts["Unclassified"] = Math.max(0, (totalCount ?? 0) - bucketSum);
      setCounts(newCounts);

      // ── Data rows for the ACTIVE tab ────────────────────────────────────
      if (activeTab === "Unclassified") {
        // Fetch clients that have NO classification row for this FY. We do
        // this by fetching classified client_ids then excluding them —
        // avoids a NOT EXISTS subquery through PostgREST.
        // 2026-06-25 (V J Desai — sub-filter total 876 ≠ tab count 957):
        // Supabase enforces a server-side max-rows cap (typically 1000)
        // that overrides even .range(0, 49999). With 1091 matching clients,
        // ~91 rows were silently truncated — after subtracting classified
        // IDs the Unclassified list came out ~80 short. Fix: paginate in
        // 1000-row chunks via .range(from, to) until a partial page tells
        // us we've reached the end. Works regardless of the server cap.
        const PAGE = 1000;
        const fetchAllPages = async (builder: (from: number, to: number) => any) => {
          const out: any[] = [];
          for (let from = 0; ; from += PAGE) {
            const q = builder(from, from + PAGE - 1);
            const { data, error } = await q;
            if (error) { console.error("[ClassificationByFYView] paged fetch:", error); break; }
            const batch = (data as any[]) || [];
            out.push(...batch);
            if (batch.length < PAGE) break;
            if (from > 200_000) break; // safety valve
          }
          return out;
        };

        const classedRows = await fetchAllPages((from, to) => {
          let cq = (supabase as any)
            .from("client_fy_classifications")
            .select("client_id")
            .eq("financial_year", selectedFY)
            .range(from, to);
          if (!showAllFirms && firmId) cq = cq.eq("firm_id", firmId);
          return cq;
        });
        const classedIds = new Set(classedRows.map(r => r.client_id));

        // Match totalQ semantics: include api_import drafts too. The
        // Unclassified bucket is now the mirror of "clients not yet
        // classified for this FY", not "completed clients only".
        // is_draft is selected so the tab's sub-filter can partition
        // rows into Active vs Draft below.
        const allRows = await fetchAllPages((from, to) => {
          let uq = (supabase as any)
            .from("clients")
            .select("id, name, entity_type, pan, is_draft")
            .is("deleted_at", null)
            .or("is_draft.eq.false,and(is_draft.eq.true,source.eq.api_import)")
            .order("name", { ascending: true })
            .range(from, to);
          if (!showAllFirms && firmId) uq = uq.eq("firm_id", firmId);
          return uq;
        });
        const mapped: ClassifiedClient[] = ((allRows ?? []) as any[])
          .filter(r => !classedIds.has(r.id))
          .map(r => ({
            client_id:   r.id,
            name:        r.name ?? null,
            entity_type: r.entity_type ?? null,
            pan:         r.pan ?? null,
            classification: "Unclassified" as ClassificationKey,
            is_draft:    !!r.is_draft,
          }));
        setRows(mapped);
      } else {
        let dataQ = (supabase as any)
          .from("clients")
          .select("id, name, entity_type, pan, client_fy_classifications!inner(classification, financial_year)")
          .eq("client_fy_classifications.financial_year", selectedFY)
          .eq("client_fy_classifications.classification", activeTab)
          .eq("is_draft", false)
          .is("deleted_at", null)
          .order("name", { ascending: true })
          .range(0, 49999);
        if (!showAllFirms && firmId) {
          dataQ = dataQ.eq("firm_id", firmId);
          dataQ = dataQ.eq("client_fy_classifications.firm_id", firmId);
        }
        const { data: fycRows, error: fycErr } = await dataQ;

        if (fycErr) {
          console.error("[ClassificationByFYView] classifications fetch:", fycErr);
          setRows([]);
        } else {
          const mapped: ClassifiedClient[] = ((fycRows ?? []) as any[])
            .map(r => ({
              client_id:   r.id,
              name:        r.name ?? null,
              entity_type: r.entity_type ?? null,
              pan:         r.pan ?? null,
              classification: activeTab,
            }))
            .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
          setRows(mapped);
        }
      }

      // ── Cross-bucket search (when a query is present) ───────────────────
      // Fetch every client (with joined classification if any) that matches
      // the name/PAN substring, regardless of which bucket they live in.
      // Bucket badges are inferred client-side so the auditor sees ALL
      // matches at once — no more "Amber Gum missing from Audit tab" bug.
      if (q) {
        // Search across ALL clients (drafts too) so an api_import draft
        // like AMBER DYE CHEM surfaces even before its setup is completed.
        let sq = (supabase as any)
          .from("clients")
          .select("id, name, entity_type, pan, is_draft, source, client_fy_classifications!left(classification, financial_year, firm_id)")
          .is("deleted_at", null)
          .or("is_draft.eq.false,and(is_draft.eq.true,source.eq.api_import)")
          .or(`name.ilike.%${q}%,pan.ilike.%${q}%`)
          .order("name", { ascending: true })
          .range(0, 49999);
        if (!showAllFirms && firmId) sq = sq.eq("firm_id", firmId);
        const { data: sRows } = await sq;
        const mappedSearch: ClassifiedClient[] = ((sRows ?? []) as any[]).map(r => {
          const fyc = (r.client_fy_classifications ?? []).find((c: any) =>
            c.financial_year === selectedFY && (showAllFirms || !firmId || c.firm_id === firmId)
          );
          return {
            client_id:   r.id,
            name:        r.name ?? null,
            entity_type: r.entity_type ?? null,
            pan:         r.pan ?? null,
            classification: (fyc?.classification as ClassificationKey) ?? "Unclassified",
            is_draft:    !!r.is_draft,
          };
        });
        setSearchRows(mappedSearch);
      } else {
        setSearchRows([]);
      }
    } finally {
      setLoading(false);
    }
  }, [selectedFY, activeTab, firmId, showAllFirms, q]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { fetchData(); }, [fetchData]);

  // ─── Render ─────────────────────────────────────────────────────────────────

  // 2026-06-25 (V J Desai — search misses matches in other buckets):
  // when the user is searching, show the union of matches across every
  // bucket rather than filtering the active tab's rows only. Each row
  // carries its own `classification` so a badge tells the auditor which
  // tab it belongs to.
  // Inside the Unclassified tab, further split by is_draft when the sub-
  // filter isn't "All". Search mode ignores the sub-filter (already spans
  // all buckets — narrowing again would be confusing).
  const baseRows = q ? searchRows : rows;
  const displayRows = (!q && activeTab === "Unclassified" && unclFilter !== "all")
    ? baseRows.filter(r =>
        unclFilter === "draft" ? !!r.is_draft : !r.is_draft
      )
    : baseRows;

  // Sub-filter counts for the Unclassified tab chips.
  const unclDraftCount  = activeTab === "Unclassified" ? rows.filter(r => r.is_draft).length  : 0;
  const unclActiveCount = activeTab === "Unclassified" ? rows.filter(r => !r.is_draft).length : 0;

  return (
    <div className="space-y-4">

      {/* ── FY Selector ── */}
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-sm font-medium text-muted-foreground">Financial Year:</span>
        <Select value={selectedFY} onValueChange={setSelectedFY}>
          <SelectTrigger className="w-36 h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FY_OPTIONS.map(fy => (
              <SelectItem key={fy} value={fy} className="text-xs">{fy}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button
          variant="ghost"
          size="sm"
          className="h-8 w-8 p-0"
          onClick={fetchData}
          title="Refresh"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
        </Button>

        <span className="text-xs text-muted-foreground">
          Classification registry · FY {selectedFY}
        </span>
      </div>

      {/* ── Classification Tabs ── */}
      <Tabs
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as ClassificationKey)}
      >
        <TabsList className="h-9 flex-wrap">
          {CLASSIFICATION_TABS.map(tab => {
            const Icon = tab.icon;
            return (
              <TabsTrigger key={tab.key} value={tab.key} className="text-xs gap-1.5 px-3">
                <Icon className={`h-3.5 w-3.5 ${tab.color}`} />
                {tab.label}
                {counts[tab.key] > 0 && (
                  <Badge
                    variant="secondary"
                    className="text-[10px] h-4 min-w-[1.25rem] px-1 rounded-full ml-0.5"
                  >
                    {counts[tab.key]}
                  </Badge>
                )}
              </TabsTrigger>
            );
          })}
        </TabsList>

        {CLASSIFICATION_TABS.map(tab => (
          <TabsContent key={tab.key} value={tab.key} className="mt-4">
            {/* Unclassified sub-filter — Active / Draft split, only in the Unclassified tab. */}
            {tab.key === "Unclassified" && !q && !loading && (unclActiveCount + unclDraftCount) > 0 && (
              <div className="flex items-center gap-2 mb-3">
                <span className="text-xs text-muted-foreground">Show:</span>
                {([
                  { key: "all",    label: "All",    n: unclActiveCount + unclDraftCount },
                  { key: "active", label: "Active", n: unclActiveCount },
                  { key: "draft",  label: "Draft",  n: unclDraftCount  },
                ] as const).map(f => (
                  <Button
                    key={f.key}
                    size="sm"
                    variant={unclFilter === f.key ? "default" : "outline"}
                    className="h-7 text-xs gap-1.5 px-2.5"
                    onClick={() => setUnclFilter(f.key)}
                  >
                    {f.label}
                    <Badge
                      variant={unclFilter === f.key ? "secondary" : "outline"}
                      className="text-[10px] h-4 min-w-[1.25rem] px-1 rounded-full"
                    >
                      {f.n}
                    </Badge>
                  </Button>
                ))}
              </div>
            )}
            {loading ? (
              <div className="py-10 text-center text-sm text-muted-foreground animate-pulse">
                Loading {tab.label} clients for FY {selectedFY}…
              </div>
            ) : displayRows.length === 0 ? (
              <div className="py-14 text-center space-y-2">
                <tab.icon className={`h-10 w-10 mx-auto opacity-30 ${tab.color}`} />
                <p className="text-sm text-muted-foreground">
                  {q
                    ? <>No clients match "<strong>{search}</strong>" in FY {selectedFY}.</>
                    : <>No <strong>{tab.label}</strong> clients classified for FY {selectedFY}.</>
                  }
                </p>
                {!q && (
                  <p className="text-xs text-muted-foreground">
                    Set a client's classification in the Client Wizard → Advanced Info step.
                  </p>
                )}
              </div>
            ) : (
              <div className="rounded-md border border-border overflow-auto">
                {q && (
                  <div className="px-3 py-2 bg-muted/30 border-b border-border text-xs text-muted-foreground">
                    Showing <strong className="text-foreground">{displayRows.length}</strong> match{displayRows.length === 1 ? "" : "es"} for "<strong className="text-foreground">{search}</strong>" across all classifications.
                  </div>
                )}
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs w-10">#</TableHead>
                      <TableHead className="text-xs">Client Name</TableHead>
                      <TableHead className="text-xs">PAN</TableHead>
                      <TableHead className="text-xs">Entity Type</TableHead>
                      {q && <TableHead className="text-xs">Classification</TableHead>}
                      <TableHead className="text-xs w-20 text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {displayRows.map((row, idx) => {
                      const rowTab = CLASSIFICATION_TABS.find(t => t.key === row.classification);
                      const RowIcon = rowTab?.icon ?? AlertCircle;
                      return (
                      <TableRow
                        key={row.client_id}
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => navigate(`/clients/${row.client_id}`)}
                      >
                        <TableCell className="text-xs text-muted-foreground">{idx + 1}</TableCell>
                        <TableCell className="font-medium text-sm">
                          <span className="inline-flex items-center gap-1.5">
                            {row.name || "Unnamed"}
                            {row.is_draft && (
                              <Badge
                                variant="outline"
                                className="text-[9px] h-4 px-1 border-amber-400 text-amber-700 dark:text-amber-300"
                                title="Client setup incomplete — imported from API"
                              >
                                Draft
                              </Badge>
                            )}
                          </span>
                        </TableCell>
                        <TableCell className="text-xs font-mono text-muted-foreground">
                          {row.pan || "—"}
                        </TableCell>
                        <TableCell>
                          {row.entity_type && (
                            <Badge variant="outline" className="text-[10px]">{row.entity_type}</Badge>
                          )}
                        </TableCell>
                        {q && (
                          <TableCell>
                            <Badge variant="outline" className={`text-[10px] gap-1 ${rowTab?.color ?? ""}`}>
                              <RowIcon className="h-3 w-3" />
                              {row.classification}
                            </Badge>
                          </TableCell>
                        )}
                        <TableCell>
                          <div className="flex gap-1 justify-end">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              title="View"
                              onClick={e => { e.stopPropagation(); navigate(`/clients/${row.client_id}`); }}
                            >
                              <Eye className="h-3.5 w-3.5" />
                            </Button>
                            {canEdit && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                title="Edit"
                                onClick={e => { e.stopPropagation(); navigate(`/clients/edit/${row.client_id}`); }}
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
