/**
 * ClassificationByFYView
 *
 * Renders a per-FY Audit / Non-Audit client registry.
 * Queries client_fy_classifications joined with clients.
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

function getCurrentFY(): string {
  const today = new Date();
  const y = today.getFullYear();
  const m = today.getMonth(); // 0 = Jan
  const start = m >= 3 ? y : y - 1;
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

const CLASSIFICATION_TABS = [
  { key: "Audit",                    label: "Audit",                   icon: ShieldCheck,  color: "text-indigo-600" },
  { key: "Non-Audit",                label: "Non-Audit",               icon: ShieldOff,    color: "text-slate-500"  },
  { key: "Partner in Audited Firm",  label: "Partner in Audited Firm", icon: Users,        color: "text-amber-600"  },
  { key: "Not Applicable",           label: "Not Applicable",          icon: AlertCircle,  color: "text-muted-foreground" },
] as const;

type ClassificationKey = typeof CLASSIFICATION_TABS[number]["key"];

interface ClassifiedClient {
  client_id: string;
  name: string | null;
  entity_type: string | null;
  pan: string | null;
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  firmId: string | null;
  showAllFirms: boolean;
  canEdit: boolean;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ClassificationByFYView({ firmId, showAllFirms, canEdit }: Props) {
  const navigate = useNavigate();
  const [selectedFY, setSelectedFY]     = useState<string>(getCurrentFY());
  const [activeTab, setActiveTab]       = useState<ClassificationKey>("Audit");
  const [rows, setRows]                 = useState<ClassifiedClient[]>([]);
  const [counts, setCounts]             = useState<Record<ClassificationKey, number>>({
    "Audit": 0, "Non-Audit": 0, "Partner in Audited Firm": 0, "Not Applicable": 0,
  });
  const [loading, setLoading]           = useState(false);

  const fetchData = useCallback(async () => {
    // Need either a firm scope or explicit all-firms flag from superadmin
    if (!firmId && !showAllFirms) return;
    setLoading(true);

    try {
      // ── Counts for all 4 tabs in one round-trip ─────────────────────────────
      const countResults = await Promise.all(
        CLASSIFICATION_TABS.map(async (tab) => {
          let q = (supabase as any)
            .from("client_fy_classifications")
            .select("client_id, clients!inner(id, is_active, deleted_at, firm_id)", { count: "exact", head: true })
            .eq("financial_year", selectedFY)
            .eq("classification", tab.key)
            .eq("clients.is_active", true)
            .is("clients.deleted_at", null);

          if (!showAllFirms && firmId) q = q.eq("clients.firm_id", firmId);

          const { count } = await q;
          return { key: tab.key, count: count ?? 0 };
        })
      );

      const newCounts = { ...counts };
      countResults.forEach(r => { newCounts[r.key as ClassificationKey] = r.count; });
      setCounts(newCounts);

      // ── Data rows for the active tab ─────────────────────────────────────────
      let dataQ = (supabase as any)
        .from("client_fy_classifications")
        .select("client_id, clients!inner(id, name, entity_type, pan, is_active, deleted_at, firm_id)")
        .eq("financial_year", selectedFY)
        .eq("classification", activeTab)
        .eq("clients.is_active", true)
        .is("clients.deleted_at", null)
        .order("clients(name)", { ascending: true });

      if (!showAllFirms && firmId) dataQ = dataQ.eq("clients.firm_id", firmId);

      const { data, error } = await dataQ;
      if (error) {
        console.error("[ClassificationByFYView]", error);
        setRows([]);
      } else {
        setRows(
          ((data as any[]) ?? []).map(r => ({
            client_id:   r.client_id,
            name:        r.clients?.name ?? null,
            entity_type: r.clients?.entity_type ?? null,
            pan:         r.clients?.pan ?? null,
          }))
        );
      }
    } finally {
      setLoading(false);
    }
  }, [selectedFY, activeTab, firmId, showAllFirms]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { fetchData(); }, [fetchData]);

  // ─── Render ─────────────────────────────────────────────────────────────────

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
            {loading ? (
              <div className="py-10 text-center text-sm text-muted-foreground animate-pulse">
                Loading {tab.label} clients for FY {selectedFY}…
              </div>
            ) : rows.length === 0 ? (
              <div className="py-14 text-center space-y-2">
                <tab.icon className={`h-10 w-10 mx-auto opacity-30 ${tab.color}`} />
                <p className="text-sm text-muted-foreground">
                  No <strong>{tab.label}</strong> clients classified for FY {selectedFY}.
                </p>
                <p className="text-xs text-muted-foreground">
                  Set a client's classification in the Client Wizard → Advanced Info step.
                </p>
              </div>
            ) : (
              <div className="rounded-md border border-border overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs w-10">#</TableHead>
                      <TableHead className="text-xs">Client Name</TableHead>
                      <TableHead className="text-xs">PAN</TableHead>
                      <TableHead className="text-xs">Entity Type</TableHead>
                      <TableHead className="text-xs w-20 text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((row, idx) => (
                      <TableRow
                        key={row.client_id}
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => navigate(`/clients/${row.client_id}`)}
                      >
                        <TableCell className="text-xs text-muted-foreground">{idx + 1}</TableCell>
                        <TableCell className="font-medium text-sm">{row.name || "Unnamed"}</TableCell>
                        <TableCell className="text-xs font-mono text-muted-foreground">
                          {row.pan || "—"}
                        </TableCell>
                        <TableCell>
                          {row.entity_type && (
                            <Badge variant="outline" className="text-[10px]">{row.entity_type}</Badge>
                          )}
                        </TableCell>
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
                    ))}
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
