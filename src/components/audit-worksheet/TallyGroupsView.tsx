import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  ChevronRight, ChevronDown, Loader2, Search, X,
  BookOpen, MessageSquareWarning, FolderTree,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { cleanTallyName } from "@/lib/tallyText";
import { useTallyEngagementId } from "./hooks/useTallyEngagementId";
import { LedgerSidePanel } from "./LedgerSidePanel";
import { signedBalance } from "@/lib/fsSignConvention";

interface TBRow {
  ledger_name: string;
  parent_group: string;
  closing_balance: number;
  balance_type: string;
}

interface GroupNode {
  name: string;
  ledgers: { name: string; balance: number }[];
}

interface Props {
  engagementId: string;
  clientId?: string | null;
  financialYear?: string | null;
  onRaiseQuery: (group: string, ledger: string, entryNote?: string) => void;
}

function fmtAmt(n: number): string {
  return Math.abs(n).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function TallyGroupsView({ engagementId, clientId, financialYear, onRaiseQuery }: Props) {
  const { tallyEngId, loading: resolving } = useTallyEngagementId(clientId, financialYear, engagementId);
  const [rawRows, setRawRows] = useState<TBRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [panelLedger, setPanelLedger] = useState<{ name: string; group: string } | null>(null);

  useEffect(() => {
    if (!tallyEngId) return;
    setLoading(true);
    const PAGE = 1000;
    const all: TBRow[] = [];
    (async () => {
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await (supabase as any)
          .from("tally_trial_balance")
          .select("ledger_name, parent_group, closing_balance, balance_type")
          .eq("engagement_id", tallyEngId)
          .range(from, from + PAGE - 1);
        if (error || !data || data.length === 0) break;
        all.push(...data);
        if (data.length < PAGE) break;
      }
      setRawRows(all);
      setLoading(false);
    })();
  }, [tallyEngId]);

  const groups = useMemo(() => {
    const map = new Map<string, { name: string; balance: number }[]>();
    for (const r of rawRows) {
      const groupName = cleanTallyName(r.parent_group) || "Other";
      const ledgerName = cleanTallyName(r.ledger_name);
      if (!ledgerName) continue;
      const balance = signedBalance(r.closing_balance, r.balance_type, "DR");
      if (!map.has(groupName)) map.set(groupName, []);
      map.get(groupName)!.push({ name: ledgerName, balance });
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, ledgers]): GroupNode => ({
        name,
        ledgers: ledgers.sort((a, b) => a.name.localeCompare(b.name)),
      }));
  }, [rawRows]);

  const searchLower = search.trim().toLowerCase();

  const filtered = useMemo(() => {
    if (!searchLower) return groups;
    return groups
      .map(g => {
        const groupMatch = g.name.toLowerCase().includes(searchLower);
        const matchingLedgers = g.ledgers.filter(l =>
          l.name.toLowerCase().includes(searchLower));
        if (groupMatch) return g;
        if (matchingLedgers.length > 0) return { ...g, ledgers: matchingLedgers };
        return null;
      })
      .filter(Boolean) as GroupNode[];
  }, [groups, searchLower]);

  const toggleGroup = (name: string) =>
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });

  const isLoading = resolving || loading;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-48 gap-2 text-sm text-muted-foreground">
        <Loader2 size={16} className="animate-spin" /> Loading Tally groups…
      </div>
    );
  }

  if (groups.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-48 gap-2 text-center text-muted-foreground">
        <FolderTree size={32} className="opacity-25" />
        <p className="text-sm">No Tally groups found.</p>
      </div>
    );
  }

  const totalLedgers = groups.reduce((s, g) => s + g.ledgers.length, 0);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3 flex-wrap">
        <Badge variant="secondary" className="text-[10px] h-5 px-1.5">
          {groups.length} groups · {totalLedgers} ledgers
        </Badge>
        <div className="relative ml-auto">
          <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search group or ledger…"
            className="h-7 w-56 pl-7 pr-7 text-xs rounded-md border border-input bg-background
                       focus:outline-none focus:ring-1 focus:ring-primary"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X size={12} />
            </button>
          )}
        </div>
      </div>

      <div className="rounded-lg overflow-hidden border">
        <div className="flex items-center gap-2 px-4 py-2 bg-slate-800 text-white text-[10px]
                        uppercase tracking-wide border-b">
          <div className="w-5 flex-shrink-0" />
          <span className="flex-1">Tally Group / Ledger</span>
          <span className="w-36 text-right">Closing Balance</span>
          <div className="w-14 flex-shrink-0" />
        </div>

        <div className="divide-y divide-border/30 bg-background max-h-[70vh] overflow-y-auto">
          {filtered.map(g => {
            const isOpen = expanded.has(g.name) || searchLower.length > 0;
            const groupTotal = g.ledgers.reduce((s, l) => s + l.balance, 0);
            return (
              <div key={g.name}>
                <div
                  className="flex items-center gap-2 px-4 py-2 hover:bg-muted/10 cursor-pointer transition-colors"
                  onClick={() => toggleGroup(g.name)}
                >
                  <button type="button" className="h-5 w-5 flex items-center justify-center rounded text-muted-foreground">
                    {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                  </button>
                  <FolderTree size={12} className="text-slate-500 flex-shrink-0" />
                  <span className="flex-1 text-xs font-semibold text-foreground">
                    {g.name}
                    <span className="ml-1.5 text-[10px] font-normal text-muted-foreground">
                      ({g.ledgers.length})
                    </span>
                  </span>
                  <span className={cn(
                    "text-xs font-mono tabular-nums w-36 text-right font-medium",
                    groupTotal >= 0 ? "text-blue-700" : "text-rose-600",
                  )}>
                    ₹{fmtAmt(groupTotal)}
                    <span className="ml-1 text-[10px] font-normal">{groupTotal >= 0 ? "Dr" : "Cr"}</span>
                  </span>
                  <div className="w-14 flex-shrink-0" />
                </div>

                {isOpen && (
                  <div className="bg-slate-50/60 border-t border-border/40">
                    {g.ledgers.map(l => {
                      const isDr = l.balance >= 0;
                      const highlight = searchLower && l.name.toLowerCase().includes(searchLower);
                      return (
                        <div
                          key={l.name}
                          className={cn(
                            "flex items-center gap-2 px-6 py-1.5 hover:bg-muted/10 transition-colors",
                            "border-b border-border/30 last:border-b-0",
                            highlight && "bg-amber-100/70 hover:bg-amber-100",
                          )}
                        >
                          <span className={cn(
                            "flex-1 text-xs truncate",
                            highlight ? "text-amber-900 font-semibold" : "text-foreground",
                          )} title={l.name}>
                            {l.name}
                          </span>
                          <span className={cn(
                            "text-xs font-mono tabular-nums font-medium w-36 text-right",
                            isDr ? "text-blue-700" : "text-rose-600",
                          )}>
                            ₹{fmtAmt(l.balance)}
                            <span className="ml-1 text-[10px] font-normal">{isDr ? "Dr" : "Cr"}</span>
                          </span>
                          <div className="flex items-center gap-0.5 flex-shrink-0">
                            <button
                              type="button"
                              title="View journal entries"
                              onClick={(e) => { e.stopPropagation(); setPanelLedger({ name: l.name, group: g.name }); }}
                              className="h-6 w-6 flex items-center justify-center rounded
                                         text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
                            >
                              <BookOpen size={11} />
                            </button>
                            <button
                              type="button"
                              title="Raise query"
                              onClick={(e) => {
                                e.stopPropagation();
                                onRaiseQuery(g.name, l.name,
                                  `[Groups] ${l.name} — ₹${fmtAmt(l.balance)} ${isDr ? "Dr" : "Cr"}`);
                              }}
                              className="h-6 w-6 flex items-center justify-center rounded
                                         text-amber-600 hover:bg-amber-50 transition-colors"
                            >
                              <MessageSquareWarning size={11} />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}

          {searchLower && filtered.length === 0 && (
            <div className="px-4 py-6 text-center text-xs text-muted-foreground">
              No group or ledger matches "{search.trim()}"
            </div>
          )}
        </div>
      </div>

      <LedgerSidePanel
        open={!!panelLedger}
        ledgerName={panelLedger?.name ?? ""}
        parentGroup={panelLedger?.group ?? ""}
        clientId={clientId}
        financialYear={financialYear}
        engagementId={engagementId}
        onClose={() => setPanelLedger(null)}
        onRaiseQuery={(group, ledger, note) => {
          setPanelLedger(null);
          onRaiseQuery(group, ledger, note);
        }}
      />
    </div>
  );
}
