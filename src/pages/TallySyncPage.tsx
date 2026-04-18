import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuditContext } from "@/hooks/useAuditContext";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  RefreshCw, CheckCircle2, XCircle, AlertTriangle, Clock,
  Database, Wifi, WifiOff, Building2, FileText, Layers, Receipt, Search,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

interface SyncBatch {
  id: string;
  status: string;
  tally_company: string | null;
  financial_year: string | null;
  groups_fetched: number;
  ledgers_fetched: number;
  tb_rows_fetched: number;
  vouchers_fetched: number;
  started_at: string;
  completed_at: string | null;
  warnings: unknown[] | null;
}

interface TallyGroup {
  id: string;
  group_name: string;
  parent_group: string | null;
  primary_group: string | null;
  is_revenue: boolean;
  is_primary: boolean;
}

interface TallyLedger {
  id: string;
  ledger_name: string;
  parent_group: string;
  opening_balance: number;
  opening_type: string;
  closing_balance: number;
  closing_type: string;
}

interface TallyTB {
  id: string;
  ledger_name: string;
  parent_group: string;
  opening_balance: number;
  opening_type: string;
  closing_balance: number;
  balance_type: string;
}

interface RowCounts {
  groups: number;
  ledgers: number;
  trial_balance: number;
  vouchers: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-IN", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function fmtAmt(n: number) {
  return n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function statusColor(status: string) {
  if (status === "complete" || status === "success") return "text-emerald-600";
  if (status === "complete_with_warnings") return "text-amber-600";
  if (status === "failed") return "text-red-600";
  if (status === "running" || status === "processing") return "text-blue-600";
  return "text-muted-foreground";
}

function StatusIcon({ status }: { status: string }) {
  if (status === "complete" || status === "success")
    return <CheckCircle2 className="h-4 w-4 text-emerald-600" />;
  if (status === "complete_with_warnings")
    return <AlertTriangle className="h-4 w-4 text-amber-600" />;
  if (status === "failed")
    return <XCircle className="h-4 w-4 text-red-600" />;
  if (status === "running" || status === "processing")
    return <RefreshCw className="h-4 w-4 text-blue-600 animate-spin" />;
  return <Clock className="h-4 w-4 text-muted-foreground" />;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function TallySyncPage() {
  const { selectedEngagementId, selectedEngagement } = useAuditContext();
  const { user } = useAuth();
  const { toast } = useToast();

  const [batches, setBatches]       = useState<SyncBatch[]>([]);
  const [groups, setGroups]         = useState<TallyGroup[]>([]);
  const [ledgers, setLedgers]       = useState<TallyLedger[]>([]);
  const [tbRows, setTbRows]         = useState<TallyTB[]>([]);
  const [rowCounts, setRowCounts]   = useState<RowCounts>({ groups: 0, ledgers: 0, trial_balance: 0, vouchers: 0 });
  const [tallyEngId, setTallyEngId]   = useState<string | null>(null);
  const [tallyFy, setTallyFy]         = useState<string | null>(null);
  const [loading, setLoading]       = useState(true);
  const [syncing, setSyncing]       = useState(false);
  const [pendingRequest, setPendingRequest] = useState(false);

  const [ledgerSearch, setLedgerSearch] = useState("");
  const [groupSearch, setGroupSearch]   = useState("");
  const [tbSearch, setTbSearch]         = useState("");

  // ── Load all data ────────────────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    if (!selectedEngagementId || !selectedEngagement) return;
    setLoading(true);

    // Resolve the engagements.id used by the tally sync agent.
    // Strategy:
    //  1. Try engagements table (client_id + financial_year match)
    //  2. Fallback: any engagements row for this client (most recent FY)
    //  3. Last resort: peek at tally_groups rows for this client_id directly
    const clientId = (selectedEngagement as any).client_id;
    const fy       = (selectedEngagement as any).financial_year;
    let engId: string | null = null;
    let resolvedFy: string | null = fy;

    if (clientId && fy) {
      const { data: exact } = await supabase
        .from("engagements" as any)
        .select("id")
        .eq("client_id", clientId)
        .eq("financial_year", fy)
        .maybeSingle();
      engId = (exact as any)?.id ?? null;
    }

    if (!engId && clientId) {
      const { data: anyEng } = await supabase
        .from("engagements" as any)
        .select("id, financial_year")
        .eq("client_id", clientId)
        .order("financial_year", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (anyEng) {
        engId = (anyEng as any).id;
        resolvedFy = (anyEng as any).financial_year;
      }
    }

    // Last resort: read engagement_id directly from tally_groups rows for this client
    if (!engId && clientId) {
      const { data: peek } = await supabase
        .from("tally_groups" as any)
        .select("engagement_id, financial_year")
        .eq("client_id", clientId)
        .order("financial_year", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (peek) {
        engId = (peek as any).engagement_id;
        resolvedFy = (peek as any).financial_year;
      }
    }

    setTallyEngId(engId);
    setTallyFy(resolvedFy);

    if (!engId) {
      // No engagements row for this client/FY — clear everything and stop
      setBatches([]);
      setGroups([]);
      setLedgers([]);
      setTbRows([]);
      setRowCounts({ groups: 0, ledgers: 0, trial_balance: 0, vouchers: 0 });
      setPendingRequest(false);
      setLoading(false);
      return;
    }

    const [batchRes, grpRes, ledRes, tbRes, vchRes, grpData, ledData, tbData] = await Promise.all([
      supabase.from("sync_batches" as any).select("*").eq("engagement_id", engId).order("started_at", { ascending: false }).limit(20),
      supabase.from("tally_groups" as any).select("id", { count: "exact", head: true }).eq("engagement_id", engId),
      supabase.from("tally_ledgers" as any).select("id", { count: "exact", head: true }).eq("engagement_id", engId),
      supabase.from("tally_trial_balance" as any).select("id", { count: "exact", head: true }).eq("engagement_id", engId),
      supabase.from("tally_vouchers" as any).select("id", { count: "exact", head: true }).eq("engagement_id", engId),
      supabase.from("tally_groups" as any).select("id,group_name,parent_group,primary_group,is_revenue,is_primary").eq("engagement_id", engId).order("group_name"),
      supabase.from("tally_ledgers" as any).select("id,ledger_name,parent_group,opening_balance,opening_type,closing_balance,closing_type").eq("engagement_id", engId).order("ledger_name").limit(2000),
      supabase.from("tally_trial_balance" as any).select("id,ledger_name,parent_group,opening_balance,opening_type,closing_balance,balance_type").eq("engagement_id", engId).order("parent_group,ledger_name").limit(2000),
    ]);

    if (batchRes.data) setBatches(batchRes.data as SyncBatch[]);
    setRowCounts({
      groups: (grpRes as any).count ?? 0,
      ledgers: (ledRes as any).count ?? 0,
      trial_balance: (tbRes as any).count ?? 0,
      vouchers: (vchRes as any).count ?? 0,
    });
    if (grpData.data) setGroups(grpData.data as TallyGroup[]);
    if (ledData.data) setLedgers(ledData.data as TallyLedger[]);

    // TB: prefer tally_trial_balance; fall back to tally_ledgers shape
    if (tbData.data && tbData.data.length > 0) {
      setTbRows(tbData.data as TallyTB[]);
    } else if (ledData.data && ledData.data.length > 0) {
      setTbRows((ledData.data as TallyLedger[]).map(l => ({
        id: l.id,
        ledger_name: l.ledger_name,
        parent_group: l.parent_group,
        opening_balance: l.opening_balance,
        opening_type: l.opening_type,
        closing_balance: l.closing_balance,
        balance_type: l.closing_type,
      })));
    }

    const { data: pending } = await supabase
      .from("sync_requests" as any)
      .select("id")
      .eq("engagement_id", engId)
      .eq("status", "pending")
      .limit(1);
    setPendingRequest((pending as any[])?.length > 0);

    setLoading(false);
  }, [selectedEngagementId, selectedEngagement]);

  useEffect(() => { loadData(); }, [loadData]);

  // ── Sync Now ─────────────────────────────────────────────────────────────────
  async function handleSyncNow() {
    if (!tallyEngId) {
      toast({ title: "No engagements record found for this client/FY", description: "Run node auto-setup.js first.", variant: "destructive" });
      return;
    }
    setSyncing(true);
    const { error } = await supabase
      .from("sync_requests" as any)
      .insert({
        engagement_id: tallyEngId,
        firm_id: (selectedEngagement as any).firm_id ?? null,
        client_id: (selectedEngagement as any).client_id ?? null,
        requested_by: user?.id ?? null,
        status: "pending",
      });
    if (error) {
      toast({ title: "Failed to queue sync request", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Sync queued", description: "Run node auto-sync.js to trigger immediately." });
      setPendingRequest(true);
    }
    setSyncing(false);
  }

  const latest  = batches[0];
  const hasData = rowCounts.ledgers > 0 || rowCounts.groups > 0;

  // ── Filtered views ────────────────────────────────────────────────────────────
  const filteredGroups  = groups.filter(g =>
    !groupSearch || g.group_name.toLowerCase().includes(groupSearch.toLowerCase()) ||
    (g.parent_group ?? "").toLowerCase().includes(groupSearch.toLowerCase())
  );

  const filteredLedgers = ledgers.filter(l =>
    !ledgerSearch || l.ledger_name.toLowerCase().includes(ledgerSearch.toLowerCase()) ||
    (l.parent_group ?? "").toLowerCase().includes(ledgerSearch.toLowerCase())
  );

  const filteredTB = tbRows.filter(r =>
    !tbSearch || r.ledger_name.toLowerCase().includes(tbSearch.toLowerCase()) ||
    (r.parent_group ?? "").toLowerCase().includes(tbSearch.toLowerCase())
  );

  // TB totals
  const tbDrTotal = filteredTB.filter(r => r.balance_type === "Dr").reduce((s, r) => s + r.closing_balance, 0);
  const tbCrTotal = filteredTB.filter(r => r.balance_type === "Cr").reduce((s, r) => s + r.closing_balance, 0);

  return (
    <div className="p-6 space-y-4 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <RefreshCw className="h-6 w-6 text-sidebar-gold" />
            Tally Sync
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Sync Tally data into CAFlow · {(selectedEngagement as any)?.financial_year ?? "—"} · {(selectedEngagement as any)?.client_name ?? (selectedEngagement as any)?.clients?.name ?? ""}
          </p>
          {selectedEngagement && (
            <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-[10px] text-muted-foreground font-mono">
              <span>Client: <span className="text-foreground">{(selectedEngagement as any)?.client_name ?? (selectedEngagement as any)?.clients?.name ?? "—"}</span></span>
              <span>Client ID: <span className="text-foreground">{(selectedEngagement as any)?.client_id?.slice(0,8) ?? "—"}…</span></span>
              <span>Audit Eng: <span className="text-foreground">{selectedEngagementId?.slice(0,8) ?? "—"}…</span></span>
              {tallyEngId && <span>Tally Eng: <span className="text-emerald-600">{tallyEngId.slice(0,8)}… ({tallyFy})</span></span>}
              {!tallyEngId && <span className="text-amber-600">Tally Eng: not found</span>}
            </div>
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={loadData} disabled={loading}>
            <RefreshCw className={cn("h-4 w-4 mr-2", loading && "animate-spin")} />
            Refresh
          </Button>
          <Button
            size="sm"
            onClick={handleSyncNow}
            disabled={syncing || !tallyEngId || pendingRequest}
            className="bg-sidebar-gold hover:bg-sidebar-gold/90 text-white"
          >
            <RefreshCw className={cn("h-4 w-4 mr-2", syncing && "animate-spin")} />
            {pendingRequest ? "Sync Queued…" : "Sync Now"}
          </Button>
        </div>
      </div>

      {/* FY mismatch notice — showing fallback FY data */}
      {selectedEngagementId && !loading && tallyEngId && tallyFy && tallyFy !== (selectedEngagement as any)?.financial_year && (
        <div className="p-3 bg-blue-50 border border-blue-200 rounded-md text-xs text-blue-800">
          <strong>Showing Tally data for FY {tallyFy}</strong> — no tally sync exists for the selected engagement FY ({(selectedEngagement as any)?.financial_year}). Select the {tallyFy} engagement or run <code className="bg-blue-100 px-1 rounded">node auto-setup.js</code> for the current FY.
        </div>
      )}
      {/* No engagements row at all */}
      {selectedEngagementId && !loading && !tallyEngId && (
        <div className="p-3 bg-amber-50 border border-amber-200 rounded-md text-xs text-amber-800">
          <strong>Tally sync not set up for this client.</strong> Run <code className="bg-amber-100 px-1 rounded">node auto-setup.js</code> in the tally-sync folder first, then run <code className="bg-amber-100 px-1 rounded">node auto-sync.js</code>.
        </div>
      )}

      {/* Count Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Groups",        value: rowCounts.groups,        icon: Layers   },
          { label: "Ledgers",       value: rowCounts.ledgers,       icon: FileText },
          { label: "Trial Balance", value: rowCounts.trial_balance, icon: Database },
          { label: "Vouchers",      value: rowCounts.vouchers,      icon: Receipt  },
        ].map(({ label, value, icon: Icon }) => (
          <Card key={label} className="py-3">
            <CardHeader className="pb-1 pt-0 px-4">
              <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                <Icon className="h-3.5 w-3.5" />{label}
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-0">
              <p className={cn("text-2xl font-bold", value > 0 ? "text-foreground" : "text-muted-foreground")}>
                {value.toLocaleString()}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Main Tabs */}
      <Tabs defaultValue={hasData ? "trial-balance" : "overview"} className="space-y-4">
        <TabsList>
          <TabsTrigger value="trial-balance">Trial Balance</TabsTrigger>
          <TabsTrigger value="ledgers">Ledgers ({rowCounts.ledgers.toLocaleString()})</TabsTrigger>
          <TabsTrigger value="groups">Groups ({rowCounts.groups})</TabsTrigger>
          <TabsTrigger value="overview">Sync Overview</TabsTrigger>
        </TabsList>

        {/* ── Trial Balance Tab ──────────────────────────────────────────── */}
        <TabsContent value="trial-balance">
          <Card>
            <CardHeader className="pb-3 flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-base">Trial Balance</CardTitle>
                <CardDescription>
                  {rowCounts.trial_balance > 0
                    ? `${rowCounts.trial_balance} rows from tally_trial_balance`
                    : `Derived from ${rowCounts.ledgers} ledgers (run sync again to populate tally_trial_balance)`}
                </CardDescription>
              </div>
              <div className="relative w-64">
                <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                <Input placeholder="Search ledger / group…" className="pl-8 h-8 text-sm" value={tbSearch} onChange={e => setTbSearch(e.target.value)} />
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {loading ? (
                <div className="p-6 text-sm text-muted-foreground">Loading…</div>
              ) : filteredTB.length === 0 ? (
                <div className="p-6 text-sm text-muted-foreground">
                  {hasData ? "No results for search." : "No data — run the Tally sync agent first."}
                </div>
              ) : (
                <>
                  <div className="overflow-auto max-h-[520px]">
                    <Table>
                      <TableHeader className="sticky top-0 bg-background z-10">
                        <TableRow>
                          <TableHead className="w-[40%]">Ledger Name</TableHead>
                          <TableHead>Group</TableHead>
                          <TableHead className="text-right">Opening Dr</TableHead>
                          <TableHead className="text-right">Opening Cr</TableHead>
                          <TableHead className="text-right font-semibold">Closing Dr</TableHead>
                          <TableHead className="text-right font-semibold">Closing Cr</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredTB.map(r => (
                          <TableRow key={r.id} className="text-xs">
                            <TableCell className="font-medium">{r.ledger_name}</TableCell>
                            <TableCell className="text-muted-foreground">{r.parent_group || "—"}</TableCell>
                            <TableCell className="text-right text-blue-700">
                              {r.opening_type === "Dr" && r.opening_balance > 0 ? fmtAmt(r.opening_balance) : "—"}
                            </TableCell>
                            <TableCell className="text-right text-rose-600">
                              {r.opening_type === "Cr" && r.opening_balance > 0 ? fmtAmt(r.opening_balance) : "—"}
                            </TableCell>
                            <TableCell className="text-right font-semibold text-blue-700">
                              {r.balance_type === "Dr" && r.closing_balance > 0 ? fmtAmt(r.closing_balance) : "—"}
                            </TableCell>
                            <TableCell className="text-right font-semibold text-rose-600">
                              {r.balance_type === "Cr" && r.closing_balance > 0 ? fmtAmt(r.closing_balance) : "—"}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                  {/* Totals row */}
                  <div className="border-t bg-muted/40 px-4 py-2 flex justify-end gap-8 text-xs font-semibold">
                    <span>Total Dr: <span className="text-blue-700 font-bold">{fmtAmt(tbDrTotal)}</span></span>
                    <span>Total Cr: <span className="text-rose-600 font-bold">{fmtAmt(tbCrTotal)}</span></span>
                    <span className={cn("font-bold", Math.abs(tbDrTotal - tbCrTotal) < 1 ? "text-emerald-600" : "text-amber-600")}>
                      Diff: {fmtAmt(Math.abs(tbDrTotal - tbCrTotal))} {Math.abs(tbDrTotal - tbCrTotal) < 1 ? "✓ Balanced" : "⚠ Check"}
                    </span>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Ledgers Tab ───────────────────────────────────────────────── */}
        <TabsContent value="ledgers">
          <Card>
            <CardHeader className="pb-3 flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-base">Ledger Masters</CardTitle>
                <CardDescription>{rowCounts.ledgers.toLocaleString()} ledgers from Tally</CardDescription>
              </div>
              <div className="relative w-64">
                <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                <Input placeholder="Search ledger / group…" className="pl-8 h-8 text-sm" value={ledgerSearch} onChange={e => setLedgerSearch(e.target.value)} />
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {loading ? (
                <div className="p-6 text-sm text-muted-foreground">Loading…</div>
              ) : filteredLedgers.length === 0 ? (
                <div className="p-6 text-sm text-muted-foreground">
                  {hasData ? "No results for search." : "No data — run the Tally sync agent first."}
                </div>
              ) : (
                <div className="overflow-auto max-h-[540px]">
                  <Table>
                    <TableHeader className="sticky top-0 bg-background z-10">
                      <TableRow>
                        <TableHead className="w-[40%]">Ledger Name</TableHead>
                        <TableHead>Group</TableHead>
                        <TableHead className="text-right">Opening</TableHead>
                        <TableHead className="text-right">Dr/Cr</TableHead>
                        <TableHead className="text-right font-semibold">Closing</TableHead>
                        <TableHead className="text-right font-semibold">Dr/Cr</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredLedgers.map(l => (
                        <TableRow key={l.id} className="text-xs">
                          <TableCell className="font-medium">{l.ledger_name}</TableCell>
                          <TableCell className="text-muted-foreground">{l.parent_group || "—"}</TableCell>
                          <TableCell className="text-right">{fmtAmt(l.opening_balance)}</TableCell>
                          <TableCell className={cn("text-right text-xs", l.opening_type === "Cr" ? "text-rose-600" : "text-blue-700")}>
                            {l.opening_type}
                          </TableCell>
                          <TableCell className="text-right font-semibold">{fmtAmt(l.closing_balance)}</TableCell>
                          <TableCell className={cn("text-right text-xs font-semibold", l.closing_type === "Cr" ? "text-rose-600" : "text-blue-700")}>
                            {l.closing_type}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Groups Tab ────────────────────────────────────────────────── */}
        <TabsContent value="groups">
          <Card>
            <CardHeader className="pb-3 flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-base">Group Masters</CardTitle>
                <CardDescription>{rowCounts.groups} groups from Tally</CardDescription>
              </div>
              <div className="relative w-64">
                <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                <Input placeholder="Search group…" className="pl-8 h-8 text-sm" value={groupSearch} onChange={e => setGroupSearch(e.target.value)} />
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {loading ? (
                <div className="p-6 text-sm text-muted-foreground">Loading…</div>
              ) : filteredGroups.length === 0 ? (
                <div className="p-6 text-sm text-muted-foreground">
                  {hasData ? "No results for search." : "No data — run the Tally sync agent first."}
                </div>
              ) : (
                <div className="overflow-auto max-h-[540px]">
                  <Table>
                    <TableHeader className="sticky top-0 bg-background z-10">
                      <TableRow>
                        <TableHead>Group Name</TableHead>
                        <TableHead>Parent Group</TableHead>
                        <TableHead>Primary Group</TableHead>
                        <TableHead className="text-center">Revenue</TableHead>
                        <TableHead className="text-center">Primary</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredGroups.map(g => (
                        <TableRow key={g.id} className="text-xs">
                          <TableCell className="font-medium">{g.group_name}</TableCell>
                          <TableCell className="text-muted-foreground">{g.parent_group || "—"}</TableCell>
                          <TableCell className="text-muted-foreground">{g.primary_group || "—"}</TableCell>
                          <TableCell className="text-center">
                            {g.is_revenue ? <Badge variant="outline" className="text-emerald-600 border-emerald-300 text-[10px]">Yes</Badge> : <span className="text-muted-foreground text-[10px]">No</span>}
                          </TableCell>
                          <TableCell className="text-center">
                            {g.is_primary ? <Badge variant="outline" className="text-blue-600 border-blue-300 text-[10px]">Yes</Badge> : <span className="text-muted-foreground text-[10px]">No</span>}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Overview Tab ──────────────────────────────────────────────── */}
        <TabsContent value="overview" className="space-y-4">
          {/* Last Sync Card */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Last Sync Status</CardTitle>
            </CardHeader>
            <CardContent>
              {latest ? (
                <div className="flex items-center gap-4 flex-wrap">
                  <div className="flex items-center gap-2">
                    <StatusIcon status={latest.status} />
                    <span className={cn("text-sm font-semibold capitalize", statusColor(latest.status))}>
                      {latest.status.replace(/_/g, " ")}
                    </span>
                  </div>
                  <span className="text-xs text-muted-foreground">{fmtDate(latest.started_at)}</span>
                  {latest.tally_company && <span className="text-xs font-medium">{latest.tally_company}</span>}
                  {(latest.warnings as any[])?.length > 0 && (
                    <Badge variant="outline" className="text-amber-600 border-amber-300 text-[10px]">
                      {(latest.warnings as any[]).length} warning{(latest.warnings as any[]).length > 1 ? "s" : ""}
                    </Badge>
                  )}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No sync yet</p>
              )}
            </CardContent>
          </Card>

          {/* Diagnostics */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Diagnostics</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid sm:grid-cols-3 gap-4">
                <DiagItem label="Engagement" ok={!!tallyEngId}
                  detail={tallyEngId ? `FY ${tallyFy ?? ""} · tally engagements ID found` : selectedEngagementId ? "No engagements row for this client — run node auto-setup.js" : "None selected"}
                  icon={Building2} />
                <DiagItem label="Tally Data" ok={hasData}
                  detail={hasData ? `${rowCounts.ledgers.toLocaleString()} ledgers synced` : "No data synced yet"}
                  icon={hasData ? Wifi : WifiOff} />
                <DiagItem label="Pending Request" ok={pendingRequest}
                  detail={pendingRequest ? "Waiting for sync agent" : "None queued"}
                  icon={Clock} neutral={!pendingRequest} />
              </div>
              {!hasData && (
                <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded-md text-xs text-amber-800">
                  <strong>No Tally data found.</strong> Make sure:
                  <ol className="list-decimal ml-4 mt-1 space-y-0.5">
                    <li>Tally is open with the correct company</li>
                    <li>Tally XML server is enabled on port 9000</li>
                    <li>Run <code className="bg-amber-100 px-1 rounded">node auto-sync.js</code> in <code className="bg-amber-100 px-1 rounded">C:\Users\kvdes\Desktop\CA FLOW\tally-sync\</code></li>
                  </ol>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Sync History */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Sync History</CardTitle>
              <CardDescription>Last 20 sync batches for this engagement</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {loading ? (
                <div className="p-6 text-sm text-muted-foreground">Loading…</div>
              ) : batches.length === 0 ? (
                <div className="p-6 text-sm text-muted-foreground">No sync history yet.</div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Status</TableHead>
                      <TableHead>Company</TableHead>
                      <TableHead>FY</TableHead>
                      <TableHead className="text-right">Groups</TableHead>
                      <TableHead className="text-right">Ledgers</TableHead>
                      <TableHead className="text-right">TB Rows</TableHead>
                      <TableHead className="text-right">Vouchers</TableHead>
                      <TableHead>Started</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {batches.map(b => (
                      <TableRow key={b.id}>
                        <TableCell>
                          <div className="flex items-center gap-1.5">
                            <StatusIcon status={b.status} />
                            <span className={cn("text-xs capitalize", statusColor(b.status))}>
                              {b.status.replace(/_/g, " ")}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="text-xs max-w-[140px] truncate">{b.tally_company ?? "—"}</TableCell>
                        <TableCell className="text-xs">{b.financial_year ?? "—"}</TableCell>
                        <TableCell className="text-right text-xs">{b.groups_fetched ?? 0}</TableCell>
                        <TableCell className="text-right text-xs">{b.ledgers_fetched ?? 0}</TableCell>
                        <TableCell className="text-right text-xs">{b.tb_rows_fetched ?? 0}</TableCell>
                        <TableCell className="text-right text-xs">{b.vouchers_fetched ?? 0}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{fmtDate(b.started_at)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {/* Run instructions */}
          <Card className="border-dashed">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">Run Sync Agent Locally</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground mb-2">
                The sync agent runs on your local machine where Tally is open:
              </p>
              <pre className="bg-muted text-xs rounded p-3 overflow-x-auto">
{`cd "C:\\Users\\kvdes\\Desktop\\CA FLOW\\tally-sync"
node auto-sync.js`}
              </pre>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ─── DiagItem ─────────────────────────────────────────────────────────────────

function DiagItem({ label, ok, detail, icon: Icon, neutral }: {
  label: string; ok: boolean; detail: string; icon: React.ElementType; neutral?: boolean;
}) {
  return (
    <div className={cn(
      "flex items-start gap-3 p-3 rounded-md border",
      neutral ? "border-border bg-muted/30" : ok ? "border-emerald-200 bg-emerald-50" : "border-red-200 bg-red-50"
    )}>
      <Icon className={cn("h-4 w-4 mt-0.5 shrink-0",
        neutral ? "text-muted-foreground" : ok ? "text-emerald-600" : "text-red-500"
      )} />
      <div>
        <p className="text-xs font-semibold text-foreground">{label}</p>
        <p className="text-xs text-muted-foreground">{detail}</p>
      </div>
    </div>
  );
}
