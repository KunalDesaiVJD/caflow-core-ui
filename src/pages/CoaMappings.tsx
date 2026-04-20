// ─────────────────────────────────────────────────────────────────────────────
// COA Mappings — Enterprise Rebuild
//
//   Per-engagement Chart-of-Accounts mapping. Each tally_ledger is matched
//   against coa_master via a 3-stage pipeline run by the coa-auto-mapper
//   edge function:
//     1. Cross-client intelligence  (coa_mapping_intelligence)
//     2. Heuristic                   (tally_group_mapping + name similarity)
//     3. AI (Claude via claude-gateway, batched)
//
//   The UI surfaces results in three tabs:
//     • Auto-confirmed   — high-confidence, no action required
//     • Needs Review     — AI / heuristic suggestion awaiting user confirm
//     • Unmapped         — no suggestion, user must choose manually
//
//   Every confirm / override feeds back into coa_mapping_intelligence via the
//   upsert_coa_intelligence RPC, so future mappings across any client get
//   smarter automatically.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useMemo, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import {
  ArrowLeft, Sparkles, Loader2, Check, Pencil, AlertCircle,
  BrainCircuit, Zap, Search, RefreshCw, BadgeCheck, Shield,
} from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────────
interface Engagement {
  id: string;
  financial_year: string | null;
  client_id: string | null;
  client_name: string | null;
  entity_type: string | null;
}

interface Mapping {
  id: string;
  engagement_id: string | null;
  firm_id: string | null;
  ledger_id: string | null;
  raw_ledger_name: string | null;
  standard_head: string | null;
  bs_pl: string | null;
  account_group: string | null;
  entity_type: string | null;
  confidence: number | null;
  source: string | null;
  status: string | null;
  alternatives: unknown;
  reasoning: string | null;
  original_suggestion: string | null;
  updated_at: string | null;
}

interface CoaHead {
  account_head: string;
  bs_pl: string | null;
  group_name: string | null;
}

interface LedgerRow {
  id: string;
  ledger_name: string;
  closing_balance: number;
  parent_group: string | null;
}

const ENTITY_TYPE_TO_COA: Record<string, "corporate" | "llp" | "nce"> = {
  private_limited:  "corporate",
  public_limited:   "corporate",
  llp:              "llp",
  proprietorship:   "nce",
  partnership:      "nce",
  huf:              "nce",
  trust:            "nce",
  aop:              "nce",
  boi:              "nce",
};

const norm = (s: string | null | undefined) =>
  (s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9& ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const fmt = (n: number) =>
  new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(n);

// ─── Component ───────────────────────────────────────────────────────────────
export default function CoaMappings() {
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const firmId = user?.firm_id ?? null;

  const [engagements, setEngagements] = useState<Engagement[]>([]);
  const [selectedEng, setSelectedEng] = useState<string>("");
  const [entityType, setEntityType] = useState<"corporate" | "llp" | "nce">("corporate");

  const [ledgers, setLedgers] = useState<LedgerRow[]>([]);
  const [mappings, setMappings] = useState<Mapping[]>([]);
  const [coaHeads, setCoaHeads] = useState<CoaHead[]>([]);

  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [search, setSearch] = useState("");

  // ── Load engagements ───────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      let q = supabase
        .from("audit_engagements")
        .select("id, financial_year, client_id, clients(client_name, entity_type)")
        .order("financial_year", { ascending: false })
        .limit(100);
      if (firmId) q = q.eq("firm_id", firmId);
      const { data } = await q;
      const mapped: Engagement[] = ((data || []) as any[]).map((e) => ({
        id: e.id,
        financial_year: e.financial_year,
        client_id: e.client_id,
        client_name: e.clients?.client_name ?? null,
        entity_type: e.clients?.entity_type ?? null,
      }));
      setEngagements(mapped);
      if (mapped.length > 0 && !selectedEng) setSelectedEng(mapped[0].id);
    })();

  }, [firmId]);

  // ── When engagement changes, derive entity type & reload ──────────────────
  useEffect(() => {
    const eng = engagements.find((e) => e.id === selectedEng);
    const et = eng?.entity_type ? ENTITY_TYPE_TO_COA[eng.entity_type] : null;
    setEntityType(et ?? "corporate");
  }, [selectedEng, engagements]);

  // ── Load COA heads for entity type ────────────────────────────────────────
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("coa_master")
        .select("account_head, bs_pl, group_name")
        .eq("entity_type", entityType)
        .order("account_head");
      setCoaHeads((data || []) as CoaHead[]);
    })();
  }, [entityType]);

  // ── Load ledgers + existing mappings for selected engagement ───────────────
  const loadEngagementData = useCallback(async () => {
    if (!selectedEng) return;
    setLoading(true);
    const [ledRes, mapRes] = await Promise.all([
      supabase
        .from("tally_ledgers")
        .select("id, ledger_name, closing_balance, parent_group")
        .eq("engagement_id", selectedEng),
      supabase
        .from("coa_mappings")
        .select("*")
        .eq("engagement_id", selectedEng),
    ]);
    setLedgers(((ledRes.data || []) as any[]).map((l) => ({
      id: l.id,
      ledger_name: String(l.ledger_name ?? "").trim(),
      closing_balance: Number(l.closing_balance ?? 0),
      parent_group: l.parent_group,
    })));
    setMappings((mapRes.data || []) as Mapping[]);
    setLoading(false);
  }, [selectedEng]);

  useEffect(() => { loadEngagementData(); }, [loadEngagementData]);

  // ── Run AI auto-mapper ─────────────────────────────────────────────────────
  const runAutoMap = async () => {
    if (!selectedEng) return;
    setRunning(true);
    try {
      const { data, error } = await supabase.functions.invoke("coa-auto-mapper", {
        body: { engagement_id: selectedEng },
      });
      if (error) throw error;
      const r = data as any;
      toast({
        title: "Auto-mapping complete",
        description: `${r.intelligence ?? 0} from intelligence • ${r.heuristic ?? 0} heuristic • ${r.ai ?? 0} by AI • ${r.total ?? 0} ledgers total`,
      });
      await loadEngagementData();
    } catch (e: any) {
      toast({ title: "Auto-mapping failed", description: e.message, variant: "destructive" });
    } finally {
      setRunning(false);
    }
  };

  // ── Confirm / override a mapping ───────────────────────────────────────────
  const confirmMapping = async (m: Mapping) => {
    if (!m.standard_head) return;
    const { error } = await supabase
      .from("coa_mappings")
      .update({
        status: "confirmed",
        confidence: 95,
        updated_at: new Date().toISOString(),
        updated_by: user?.id ?? null,
      } as any)
      .eq("id", m.id);
    if (error) { toast({ title: "Save failed", description: error.message, variant: "destructive" }); return; }

    await supabase.rpc("upsert_coa_intelligence", {
      p_normalized_name: norm(m.raw_ledger_name ?? ""),
      p_entity_type:     m.entity_type ?? entityType,
      p_account_head:    m.standard_head,
      p_bs_pl:           m.bs_pl,
      p_account_group:   m.account_group,
      p_firm_id:         m.firm_id,
      p_engagement_id:   m.engagement_id,
      p_accepted:        true,
    });

    // Track as a human action for AdminAiSkills pattern detection
    await supabase.from("audit_human_actions").insert({
      action_type:    "coa_map_confirm",
      ai_suggestion:  m.original_suggestion,
      action_context: { ledger: m.raw_ledger_name, head: m.standard_head },
      human_override: false,
      firm_id:        m.firm_id,
      engagement_id:  m.engagement_id,
      user_id:        user?.id,
    } as any);

    toast({ title: "Confirmed", description: `${m.raw_ledger_name} → ${m.standard_head}` });
    await loadEngagementData();
  };

  const overrideMapping = async (m: Mapping, newHead: CoaHead) => {
    const { error } = await supabase
      .from("coa_mappings")
      .update({
        standard_head: newHead.account_head,
        bs_pl:         newHead.bs_pl,
        account_group: newHead.group_name,
        status:        "overridden",
        source:        "manual",
        confidence:    99,
        updated_at:    new Date().toISOString(),
        updated_by:    user?.id ?? null,
      } as any)
      .eq("id", m.id);
    if (error) { toast({ title: "Save failed", description: error.message, variant: "destructive" }); return; }

    await supabase.rpc("upsert_coa_intelligence", {
      p_normalized_name: norm(m.raw_ledger_name ?? ""),
      p_entity_type:     m.entity_type ?? entityType,
      p_account_head:    newHead.account_head,
      p_bs_pl:           newHead.bs_pl,
      p_account_group:   newHead.group_name,
      p_firm_id:         m.firm_id,
      p_engagement_id:   m.engagement_id,
      p_accepted:        false,
    });

    await supabase.from("audit_human_actions").insert({
      action_type:    "coa_map_override",
      ai_suggestion:  m.original_suggestion ?? m.standard_head,
      action_context: {
        ledger: m.raw_ledger_name,
        ai_text: m.original_suggestion ?? m.standard_head,
        human_text: newHead.account_head,
      },
      human_override: true,
      firm_id:        m.firm_id,
      engagement_id:  m.engagement_id,
      user_id:        user?.id,
    } as any);

    toast({ title: "Override saved", description: `${m.raw_ledger_name} → ${newHead.account_head}` });
    await loadEngagementData();
  };

  // ── Derived: categorise ledgers into tabs ──────────────────────────────────
  const byLedger = useMemo(() => {
    const m = new Map<string, Mapping>();
    for (const row of mappings) {
      if (row.raw_ledger_name) m.set(row.raw_ledger_name, row);
    }
    return m;
  }, [mappings]);

  const rows = useMemo(() => {
    return ledgers.map((l) => ({ ledger: l, mapping: byLedger.get(l.ledger_name) ?? null }));
  }, [ledgers, byLedger]);

  const filterSearch = (r: { ledger: LedgerRow; mapping: Mapping | null }) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      r.ledger.ledger_name.toLowerCase().includes(q) ||
      (r.mapping?.standard_head?.toLowerCase().includes(q) ?? false) ||
      (r.ledger.parent_group?.toLowerCase().includes(q) ?? false)
    );
  };

  const autoConfirmed = rows.filter((r) => r.mapping?.status === "confirmed" || r.mapping?.status === "overridden").filter(filterSearch);
  const needsReview   = rows.filter((r) => r.mapping?.status === "suggested" && r.mapping?.standard_head).filter(filterSearch);
  const unmapped      = rows.filter((r) => !r.mapping || (r.mapping?.status === "suggested" && !r.mapping?.standard_head)).filter(filterSearch);

  // ── Render ─────────────────────────────────────────────────────────────────
  const eng = engagements.find((e) => e.id === selectedEng);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <Button variant="ghost" size="sm" className="-ml-2 mb-1" onClick={() => navigate(-1)}>
            <ArrowLeft size={14} className="mr-1" /> Back
          </Button>
          <h1 className="text-2xl font-display font-bold flex items-center gap-2">
            <BrainCircuit className="h-6 w-6 text-primary" /> COA Mapping
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            AI-powered Chart-of-Accounts mapping with cross-client learning.
          </p>
        </div>

        <div className="flex gap-2 items-center">
          <Select value={selectedEng} onValueChange={setSelectedEng}>
            <SelectTrigger className="w-[320px]">
              <SelectValue placeholder="Select engagement" />
            </SelectTrigger>
            <SelectContent>
              {engagements.map((e) => (
                <SelectItem key={e.id} value={e.id}>
                  {e.client_name ?? "(Unnamed)"} · {e.financial_year ?? "-"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button variant="outline" size="icon" onClick={loadEngagementData} disabled={loading}>
            <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
          </Button>

          <Button onClick={runAutoMap} disabled={running || !selectedEng} className="gap-2">
            {running ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
            Run AI Auto-Map
          </Button>
        </div>
      </div>

      {/* Context bar */}
      {eng && (
        <Card>
          <CardContent className="py-3 flex flex-wrap gap-x-6 gap-y-2 text-sm">
            <span><span className="text-muted-foreground">Client:</span> <b>{eng.client_name ?? "-"}</b></span>
            <span><span className="text-muted-foreground">FY:</span> <b>{eng.financial_year ?? "-"}</b></span>
            <span><span className="text-muted-foreground">Entity type:</span> <Badge variant="outline">{entityType.toUpperCase()}</Badge></span>
            <span><span className="text-muted-foreground">COA heads available:</span> <b>{coaHeads.length}</b></span>
            <span><span className="text-muted-foreground">Ledgers:</span> <b>{ledgers.length}</b></span>
          </CardContent>
        </Card>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <StatCard icon={<BadgeCheck className="text-green-600" size={18} />} label="Auto-confirmed" count={autoConfirmed.length} total={rows.length} color="green" />
        <StatCard icon={<AlertCircle className="text-amber-600" size={18} />} label="Needs Review"     count={needsReview.length}   total={rows.length} color="amber" />
        <StatCard icon={<Shield      className="text-rose-600"  size={18} />} label="Unmapped"         count={unmapped.length}      total={rows.length} color="rose" />
      </div>

      {ledgers.length === 0 && !loading && (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>No ledgers found</AlertTitle>
          <AlertDescription>
            Import a trial balance for this engagement first, then run auto-mapping.
          </AlertDescription>
        </Alert>
      )}

      {/* Search */}
      <div className="relative max-w-md">
        <Search size={14} className="absolute left-3 top-3 text-muted-foreground" />
        <Input placeholder="Search ledger, head, group…" className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      {/* Tabs */}
      <Tabs defaultValue="review">
        <TabsList>
          <TabsTrigger value="review" className="gap-2">
            <AlertCircle size={14} /> Needs Review <Badge variant="secondary">{needsReview.length}</Badge>
          </TabsTrigger>
          <TabsTrigger value="unmapped" className="gap-2">
            <Shield size={14} /> Unmapped <Badge variant="secondary">{unmapped.length}</Badge>
          </TabsTrigger>
          <TabsTrigger value="confirmed" className="gap-2">
            <BadgeCheck size={14} /> Auto-confirmed <Badge variant="secondary">{autoConfirmed.length}</Badge>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="review">
          <MappingTable rows={needsReview} coaHeads={coaHeads} onConfirm={confirmMapping} onOverride={overrideMapping} showActions />
        </TabsContent>
        <TabsContent value="unmapped">
          <MappingTable rows={unmapped} coaHeads={coaHeads} onConfirm={confirmMapping} onOverride={overrideMapping} showActions />
        </TabsContent>
        <TabsContent value="confirmed">
          <MappingTable rows={autoConfirmed} coaHeads={coaHeads} onConfirm={confirmMapping} onOverride={overrideMapping} showActions />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ─── Subcomponents ───────────────────────────────────────────────────────────
function StatCard({ icon, label, count, total, color }: {
  icon: React.ReactNode; label: string; count: number; total: number; color: "green" | "amber" | "rose";
}) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  const bar = color === "green" ? "bg-green-500" : color === "amber" ? "bg-amber-500" : "bg-rose-500";
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-2">
          {icon} {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-bold">{count}</span>
          <span className="text-xs text-muted-foreground">/ {total} ledgers ({pct}%)</span>
        </div>
        <div className="mt-2 h-1.5 w-full rounded-full bg-muted overflow-hidden">
          <div className={`h-full ${bar} transition-all`} style={{ width: `${pct}%` }} />
        </div>
      </CardContent>
    </Card>
  );
}

function MappingTable({
  rows, coaHeads, onConfirm, onOverride, showActions,
}: {
  rows: { ledger: LedgerRow; mapping: Mapping | null }[];
  coaHeads: CoaHead[];
  onConfirm: (m: Mapping) => void;
  onOverride: (m: Mapping, h: CoaHead) => void;
  showActions: boolean;
}) {
  if (rows.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          No ledgers in this bucket.
        </CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Ledger</TableHead>
              <TableHead>Tally Group</TableHead>
              <TableHead className="text-right">Closing Balance</TableHead>
              <TableHead>Suggested Account Head</TableHead>
              <TableHead>BS/PL</TableHead>
              <TableHead>Source · Confidence</TableHead>
              <TableHead>Status</TableHead>
              {showActions && <TableHead className="w-[180px] text-right">Actions</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(({ ledger, mapping }) => (
              <TableRow key={ledger.id}>
                <TableCell className="font-medium">{ledger.ledger_name}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{ledger.parent_group ?? "-"}</TableCell>
                <TableCell className="text-right font-mono">{fmt(ledger.closing_balance)}</TableCell>
                <TableCell>{mapping?.standard_head ?? <span className="text-muted-foreground italic">— no suggestion —</span>}</TableCell>
                <TableCell>{mapping?.bs_pl ? <Badge variant="outline">{mapping.bs_pl}</Badge> : "-"}</TableCell>
                <TableCell>
                  {mapping ? <SourceBadge source={mapping.source} confidence={mapping.confidence} /> : "-"}
                </TableCell>
                <TableCell><StatusBadge status={mapping?.status ?? null} /></TableCell>
                {showActions && (
                  <TableCell className="text-right">
                    {mapping ? (
                      <div className="flex gap-1 justify-end">
                        {mapping.standard_head && mapping.status !== "confirmed" && (
                          <Button size="sm" variant="ghost" className="text-green-600 gap-1" onClick={() => onConfirm(mapping)}>
                            <Check size={14} /> Accept
                          </Button>
                        )}
                        <ChangeMappingPopover coaHeads={coaHeads} onPick={(h) => onOverride(mapping, h)} />
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">Run AI</span>
                    )}
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function ChangeMappingPopover({ coaHeads, onPick }: { coaHeads: CoaHead[]; onPick: (h: CoaHead) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const qq = q.toLowerCase();
    return coaHeads.filter((h) => h.account_head.toLowerCase().includes(qq) || (h.group_name ?? "").toLowerCase().includes(qq)).slice(0, 40);
  }, [coaHeads, q]);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="ghost" className="gap-1">
          <Pencil size={14} /> Change
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[380px] p-0" align="end">
        <div className="p-2 border-b">
          <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search account head…" />
        </div>
        <div className="max-h-[320px] overflow-y-auto">
          {filtered.map((h) => (
            <button
              key={h.account_head}
              className="w-full text-left px-3 py-2 text-sm hover:bg-accent border-b last:border-b-0"
              onClick={() => { onPick(h); setOpen(false); setQ(""); }}
            >
              <div className="font-medium">{h.account_head}</div>
              <div className="text-xs text-muted-foreground flex gap-2 mt-0.5">
                {h.bs_pl && <Badge variant="outline" className="text-[10px] py-0 h-4">{h.bs_pl}</Badge>}
                <span>{h.group_name ?? ""}</span>
              </div>
            </button>
          ))}
          {filtered.length === 0 && <div className="p-4 text-sm text-muted-foreground">No matches.</div>}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function SourceBadge({ source, confidence }: { source: string | null; confidence: number | null }) {
  const icon = source === "intelligence" ? <Zap size={10} /> : source === "ai" ? <Sparkles size={10} /> : source === "heuristic" ? <BrainCircuit size={10} /> : <Pencil size={10} />;
  const color =
    source === "intelligence" ? "bg-violet-100 text-violet-800 border-violet-300" :
    source === "ai"          ? "bg-blue-100 text-blue-800 border-blue-300" :
    source === "heuristic"   ? "bg-teal-100 text-teal-800 border-teal-300" :
    source === "manual"      ? "bg-slate-100 text-slate-800 border-slate-300" :
    "bg-muted text-muted-foreground";
  return (
    <div className="flex items-center gap-1.5">
      <Badge variant="outline" className={`${color} gap-1 font-mono text-[10px]`}>{icon}{source ?? "—"}</Badge>
      {confidence != null && <span className="text-xs text-muted-foreground">{Math.round(confidence)}%</span>}
    </div>
  );
}

function StatusBadge({ status }: { status: string | null }) {
  if (status === "confirmed")   return <Badge className="bg-green-600 text-white">Confirmed</Badge>;
  if (status === "overridden")  return <Badge className="bg-emerald-700 text-white">Overridden</Badge>;
  if (status === "suggested")   return <Badge className="bg-amber-500 text-white">Needs Review</Badge>;
  return <Badge variant="outline">Pending</Badge>;
}
