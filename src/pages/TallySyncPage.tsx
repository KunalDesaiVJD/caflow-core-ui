import { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
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
  ChevronRight, ChevronDown,
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
  debit_amount?: number;
  credit_amount?: number;
}

interface VoucherLineItem {
  ledger_name: string;
  amount: number;
  dr_cr: string;
}

interface TallyVoucher {
  id: string;
  voucher_date: string;
  voucher_type: string;
  voucher_number: string;
  party_ledger: string;
  amount: number;
  dr_cr: string;
  narration: string;
  line_items?: VoucherLineItem[];
}

interface RowCounts {
  groups: number;
  ledgers: number;
  trial_balance: number;
  vouchers: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Tally's sync agent currently emits inverted Dr/Cr — flip at read time.
function flipDrCr(t: string | null | undefined): string {
  return t === "Dr" ? "Cr" : "Dr";
}

function decodeHtml(str: string | null | undefined): string {
  if (!str) return "";
  return str
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&#\d+;/g, "");   // strip remaining numeric entities like &#4;
}

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
  const navigate = useNavigate();

  const [batches, setBatches]       = useState<SyncBatch[]>([]);
  const [groups, setGroups]         = useState<TallyGroup[]>([]);
  const [ledgers, setLedgers]       = useState<TallyLedger[]>([]);
  const [tbRows, setTbRows]         = useState<TallyTB[]>([]);
  const [vouchers, setVouchers]     = useState<TallyVoucher[]>([]);
  const [rowCounts, setRowCounts]   = useState<RowCounts>({ groups: 0, ledgers: 0, trial_balance: 0, vouchers: 0 });
  const [tallyEngId, setTallyEngId]   = useState<string | null>(null);
  const [tallyFy, setTallyFy]         = useState<string | null>(null);
  const [loading, setLoading]       = useState(true);
  const [syncing, setSyncing]       = useState(false);
  const [pendingRequest, setPendingRequest] = useState(false);

  const [ledgerSearch, setLedgerSearch]   = useState("");
  const [groupSearch, setGroupSearch]     = useState("");
  const [tbSearch, setTbSearch]           = useState("");
  const [voucherSearch, setVoucherSearch] = useState("");

  // Collapse/expand state for TB group rows and voucher line-items
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [expandedVoucher, setExpandedVoucher] = useState<string | null>(null);

  function toggleGroup(groupName: string) {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      if (next.has(groupName)) next.delete(groupName);
      else next.add(groupName);
      return next;
    });
  }

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
      setVouchers([]);
      setRowCounts({ groups: 0, ledgers: 0, trial_balance: 0, vouchers: 0 });
      setPendingRequest(false);
      setLoading(false);
      return;
    }

    const [batchRes, grpRes, ledRes, tbRes, vchRes, grpData, ledData, tbData, vchData] = await Promise.all([
      supabase.from("sync_batches" as any).select("*").eq("engagement_id", engId).order("started_at", { ascending: false }).limit(20),
      supabase.from("tally_groups" as any).select("id", { count: "exact", head: true }).eq("engagement_id", engId),
      supabase.from("tally_ledgers" as any).select("id", { count: "exact", head: true }).eq("engagement_id", engId),
      supabase.from("tally_trial_balance" as any).select("id", { count: "exact", head: true }).eq("engagement_id", engId),
      supabase.from("tally_vouchers" as any).select("id", { count: "exact", head: true }).eq("engagement_id", engId),
      supabase.from("tally_groups" as any).select("id,group_name,parent_group,primary_group,is_revenue,is_primary").eq("engagement_id", engId).order("group_name"),
      supabase.from("tally_ledgers" as any).select("id,ledger_name,parent_group,opening_balance,opening_type,closing_balance,closing_type").eq("engagement_id", engId).order("ledger_name").limit(2000),
      supabase.from("tally_trial_balance" as any).select("id,ledger_name,parent_group,opening_balance,opening_type,closing_balance,balance_type,debit_amount,credit_amount").eq("engagement_id", engId).order("parent_group,ledger_name").limit(2000),
      supabase.from("tally_vouchers" as any).select("id,voucher_date,voucher_type,voucher_number,party_ledger,amount,dr_cr,narration,line_items").eq("engagement_id", engId).order("voucher_date", { ascending: false }).limit(5000),
    ]);

    if (batchRes.data) setBatches(batchRes.data as SyncBatch[]);
    setRowCounts({
      groups: (grpRes as any).count ?? 0,
      ledgers: (ledRes as any).count ?? 0,
      trial_balance: (tbRes as any).count ?? 0,
      vouchers: (vchRes as any).count ?? 0,
    });
    // Dedupe groups by group_name
    if (grpData.data) {
      const seen = new Map<string, TallyGroup>();
      for (const g of grpData.data as TallyGroup[]) {
        if (!seen.has(g.group_name)) seen.set(g.group_name, g);
      }
      setGroups(Array.from(seen.values()));
    }

    // Filter zeros, dedupe, flip Dr/Cr on ledgers
    if (ledData.data) {
      const seen = new Map<string, TallyLedger>();
      for (const l of ledData.data as TallyLedger[]) {
        if (l.closing_balance <= 0 && l.opening_balance <= 0) continue;
        if (seen.has(l.ledger_name)) continue;
        seen.set(l.ledger_name, {
          ...l,
          opening_type: flipDrCr(l.opening_type),
          closing_type: flipDrCr(l.closing_type),
        });
      }
      setLedgers(Array.from(seen.values()));
    }

    // Build TB source (fallback to ledgers) then dedupe + flip Dr/Cr
    const tbSource: TallyTB[] = (tbData.data && tbData.data.length > 0)
      ? (tbData.data as TallyTB[])
      : (ledData.data
          ? (ledData.data as TallyLedger[]).map(l => ({
              id: l.id,
              ledger_name: l.ledger_name,
              parent_group: l.parent_group,
              opening_balance: l.opening_balance,
              opening_type: l.opening_type,
              closing_balance: l.closing_balance,
              balance_type: l.closing_type,
            } as TallyTB))
          : []);

    // Flip Dr/Cr on vouchers and aggregate period Debit/Credit per ledger
    const flippedVouchers: TallyVoucher[] = vchData.data
      ? (vchData.data as TallyVoucher[]).map(v => ({
          ...v,
          dr_cr: flipDrCr(v.dr_cr),
          line_items: (v.line_items ?? []).map((li: any) => ({ ...li, dr_cr: flipDrCr(li.dr_cr) })),
        }))
      : [];
    setVouchers(flippedVouchers);

    const periodTotals = new Map<string, { debit: number; credit: number }>();
    for (const v of flippedVouchers) {
      for (const li of v.line_items ?? []) {
        const key = li.ledger_name;
        if (!periodTotals.has(key)) periodTotals.set(key, { debit: 0, credit: 0 });
        const bucket = periodTotals.get(key)!;
        if (li.dr_cr === "Dr") bucket.debit += li.amount;
        else bucket.credit += li.amount;
      }
    }

    const tbSeen = new Map<string, TallyTB>();
    for (const r of tbSource) {
      if (r.closing_balance <= 0 && r.opening_balance <= 0) continue;
      if (tbSeen.has(r.ledger_name)) continue;
      const computed = periodTotals.get(r.ledger_name);
      tbSeen.set(r.ledger_name, {
        ...r,
        opening_type: flipDrCr(r.opening_type),
        balance_type: flipDrCr(r.balance_type),
        debit_amount: computed?.debit ?? r.debit_amount ?? 0,
        credit_amount: computed?.credit ?? r.credit_amount ?? 0,
      });
    }
    setTbRows(Array.from(tbSeen.values()));

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
    !groupSearch || decodeHtml(g.group_name).toLowerCase().includes(groupSearch.toLowerCase()) ||
    decodeHtml(g.parent_group ?? "").toLowerCase().includes(groupSearch.toLowerCase())
  );

  const filteredLedgers = ledgers.filter(l =>
    !ledgerSearch || decodeHtml(l.ledger_name).toLowerCase().includes(ledgerSearch.toLowerCase()) ||
    decodeHtml(l.parent_group ?? "").toLowerCase().includes(ledgerSearch.toLowerCase())
  );

  const filteredTB = tbRows.filter(r =>
    !tbSearch || decodeHtml(r.ledger_name).toLowerCase().includes(tbSearch.toLowerCase()) ||
    decodeHtml(r.parent_group ?? "").toLowerCase().includes(tbSearch.toLowerCase())
  );

  const filteredVouchers = vouchers.filter(v =>
    !voucherSearch ||
    decodeHtml(v.party_ledger).toLowerCase().includes(voucherSearch.toLowerCase()) ||
    v.voucher_type.toLowerCase().includes(voucherSearch.toLowerCase()) ||
    (v.voucher_number ?? "").toLowerCase().includes(voucherSearch.toLowerCase()) ||
    decodeHtml(v.narration).toLowerCase().includes(voucherSearch.toLowerCase())
  );

  // TB totals (for footer)
  const tbDrTotal     = filteredTB.filter(r => r.balance_type === "Dr").reduce((s, r) => s + r.closing_balance, 0);
  const tbCrTotal     = filteredTB.filter(r => r.balance_type === "Cr").reduce((s, r) => s + r.closing_balance, 0);
  const tbDebitTotal  = filteredTB.reduce((s, r) => s + (r.debit_amount  ?? 0), 0);
  const tbCreditTotal = filteredTB.reduce((s, r) => s + (r.credit_amount ?? 0), 0);

  // ── Group map for BS/PL classification ───────────────────────────────────────
  const groupInfoMap = useMemo(() => {
    const map = new Map<string, TallyGroup>();
    groups.forEach(g => map.set(g.group_name, g));
    return map;
  }, [groups]);

  // Tally stores root groups with parent = "&#4; Primary" (control char + "Primary").
  // Strip numeric HTML entities before comparing.
  function isTallyPrimary(g: TallyGroup): boolean {
    if (g.is_primary || !g.parent_group) return true;
    const clean = g.parent_group.replace(/&#\d+;/g, "").trim().toLowerCase();
    return clean === "primary";
  }

  function getPrimaryGroup(groupName: string): TallyGroup | null {
    let g = groupInfoMap.get(groupName);
    const visited = new Set<string>();
    while (g && !isTallyPrimary(g) && !visited.has(g.group_name)) {
      visited.add(g.group_name);
      if (!g.parent_group) break;
      g = groupInfoMap.get(g.parent_group);
    }
    return g ?? null;
  }

  function isRevenueGroup(groupName: string): boolean {
    return getPrimaryGroup(groupName)?.is_revenue ?? false;
  }

  // ── Sorted groups: BS primaries first, sub-groups indented under parent ──────
  const sortedGroups = useMemo(() => {
    // Tally stores root groups with parent = "&#4; Primary" — strip entities before comparing
    const isPrim = (g: TallyGroup) => {
      if (g.is_primary || !g.parent_group) return true;
      const clean = g.parent_group.replace(/&#\d+;/g, "").trim().toLowerCase();
      return clean === "primary";
    };

    const primaries = filteredGroups.filter(isPrim);
    const subs = filteredGroups.filter(g => !isPrim(g));

    // BS (non-revenue) primaries first, then PL (revenue), alphabetical within each
    primaries.sort((a, b) => {
      if (a.is_revenue !== b.is_revenue) return a.is_revenue ? 1 : -1;
      return a.group_name.localeCompare(b.group_name);
    });

    // Build parent → children map from sub-groups
    const childrenMap = new Map<string, TallyGroup[]>();
    for (const sub of subs) {
      const parent = sub.parent_group ?? "";
      if (!childrenMap.has(parent)) childrenMap.set(parent, []);
      childrenMap.get(parent)!.push(sub);
    }

    // Recursively flatten: primary → its sub-groups → their sub-groups
    const flatten = (g: TallyGroup, depth: number): Array<{ group: TallyGroup; depth: number }> => {
      const out: Array<{ group: TallyGroup; depth: number }> = [{ group: g, depth }];
      const children = (childrenMap.get(g.group_name) ?? [])
        .slice()
        .sort((a, b) => a.group_name.localeCompare(b.group_name));
      for (const child of children) out.push(...flatten(child, depth + 1));
      return out;
    };

    const result: Array<{ group: TallyGroup; depth: number }> = [];
    for (const p of primaries) result.push(...flatten(p, 0));

    // Any sub-group whose parent wasn't found (orphan)
    const placed = new Set(result.map(r => r.group.group_name));
    for (const g of subs) {
      if (!placed.has(g.group_name)) result.push({ group: g, depth: 1 });
    }
    return result;
  }, [filteredGroups]);

  // ── Grouped ledgers: same hierarchy order as sortedGroups (BS-first, depth-aware)
  const groupedLedgers = useMemo(() => {
    const byGroup = new Map<string, TallyLedger[]>();
    for (const l of filteredLedgers) {
      const grp = l.parent_group || "";
      if (!byGroup.has(grp)) byGroup.set(grp, []);
      byGroup.get(grp)!.push(l);
    }

    // Build set of groups that have ledgers directly OR are ancestors of such groups.
    // This ensures parent headers (e.g. "Current Assets") are shown even when all
    // ledgers sit in sub-groups (e.g. "Bank Accounts", "Cash-in-hand").
    const activeGroups = new Set<string>();
    for (const grpName of byGroup.keys()) {
      activeGroups.add(grpName);
      let g = groupInfoMap.get(grpName);
      const visited = new Set<string>();
      while (g && !visited.has(g.group_name)) {
        visited.add(g.group_name);
        activeGroups.add(g.group_name);
        if (!g.parent_group) break;
        g = groupInfoMap.get(g.parent_group);
      }
    }

    const result: Array<{ groupName: string; isRevenue: boolean; depth: number; ledgers: TallyLedger[] }> = [];
    for (const { group: g, depth } of sortedGroups) {
      if (!activeGroups.has(g.group_name)) continue;
      const grpLedgers = byGroup.get(g.group_name) ?? [];
      result.push({
        groupName: g.group_name,
        isRevenue: g.is_revenue,
        depth,
        ledgers: grpLedgers.slice().sort((a, b) => a.ledger_name.localeCompare(b.ledger_name)),
      });
    }
    // Fallback for any ledger groups not in sortedGroups
    const placed = new Set(result.map(r => r.groupName));
    for (const [grp, leds] of byGroup.entries()) {
      if (!placed.has(grp)) {
        result.push({
          groupName: grp,
          isRevenue: isRevenueGroup(grp),
          depth: 0,
          ledgers: leds.slice().sort((a, b) => a.ledger_name.localeCompare(b.ledger_name)),
        });
      }
    }
    return result;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredLedgers, sortedGroups, groupInfoMap]);

  // ── Grouped TB: same hierarchy order as sortedGroups, group totals ───────────
  const groupedTB = useMemo(() => {
    const byGroup = new Map<string, TallyTB[]>();
    for (const r of filteredTB) {
      const grp = r.parent_group || "";
      if (!byGroup.has(grp)) byGroup.set(grp, []);
      byGroup.get(grp)!.push(r);
    }

    type TBGroup = {
      groupName: string; isRevenue: boolean; rows: TallyTB[];
      openingTotal: number; openingTotalType: string;
      debitTotal: number; creditTotal: number;
      closingTotal: number; closingTotalType: string;
    };

    const makeGroup = (grpName: string, isRevenue: boolean, rows: TallyTB[]): TBGroup => {
      const sorted  = rows.slice().sort((a, b) => a.ledger_name.localeCompare(b.ledger_name));
      const netOp   = sorted.reduce((s, r) => s + (r.opening_type === "Dr" ? r.opening_balance : -r.opening_balance), 0);
      const netCl   = sorted.reduce((s, r) => s + (r.balance_type  === "Dr" ? r.closing_balance  : -r.closing_balance), 0);
      const debit   = sorted.reduce((s, r) => s + (r.debit_amount  ?? 0), 0);
      const credit  = sorted.reduce((s, r) => s + (r.credit_amount ?? 0), 0);
      return {
        groupName: grpName, isRevenue, rows: sorted,
        openingTotal: Math.abs(netOp), openingTotalType: netOp >= 0 ? "Dr" : "Cr",
        debitTotal: debit, creditTotal: credit,
        closingTotal: Math.abs(netCl), closingTotalType: netCl >= 0 ? "Dr" : "Cr",
      };
    };

    const result: TBGroup[] = [];
    for (const { group: g } of sortedGroups) {
      const rows = byGroup.get(g.group_name);
      if (!rows || rows.length === 0) continue;
      result.push(makeGroup(g.group_name, g.is_revenue, rows));
    }
    // Fallback for TB rows whose group isn't in sortedGroups
    const placed = new Set(result.map(r => r.groupName));
    for (const [grp, rows] of byGroup.entries()) {
      if (!placed.has(grp)) result.push(makeGroup(grp, isRevenueGroup(grp), rows));
    }
    return result;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredTB, sortedGroups]);

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
          <TabsTrigger value="vouchers">Vouchers ({rowCounts.vouchers.toLocaleString()})</TabsTrigger>
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
                    ? `${rowCounts.trial_balance} ledgers · group-wise · BS first · click group to collapse`
                    : `Derived from ${rowCounts.ledgers} ledgers`}
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" className="text-xs h-7 px-2 text-muted-foreground"
                  onClick={() => setCollapsedGroups(new Set(groupedTB.map(g => g.groupName)))}>
                  Collapse All
                </Button>
                <Button variant="ghost" size="sm" className="text-xs h-7 px-2 text-muted-foreground"
                  onClick={() => setCollapsedGroups(new Set())}>
                  Expand All
                </Button>
                <div className="relative w-56">
                  <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                  <Input placeholder="Search ledger / group…" className="pl-8 h-8 text-sm" value={tbSearch} onChange={e => setTbSearch(e.target.value)} />
                </div>
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
                  <div className="overflow-auto max-h-[560px]">
                    <Table>
                      <TableHeader className="sticky top-0 bg-background z-10">
                        <TableRow>
                          <TableHead className="w-[36%]">Particulars</TableHead>
                          <TableHead className="text-right w-[16%]">Opening Balance</TableHead>
                          <TableHead className="text-right w-[13%]">Debit</TableHead>
                          <TableHead className="text-right w-[13%]">Credit</TableHead>
                          <TableHead className="text-right font-semibold w-[16%]">Closing Balance</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {groupedTB.map(({ groupName, isRevenue, rows, openingTotal, openingTotalType, debitTotal, creditTotal, closingTotal, closingTotalType }) => {
                          const isCollapsed = collapsedGroups.has(groupName);
                          return (
                            <>
                              {/* Group header row — clickable to collapse */}
                              <TableRow
                                key={`tb-grp-${groupName}`}
                                className="bg-muted/60 hover:bg-muted/80 cursor-pointer select-none"
                                onClick={() => toggleGroup(groupName)}
                              >
                                <TableCell className="py-2 px-3">
                                  <div className="flex items-center gap-1.5">
                                    {isCollapsed
                                      ? <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                                      : <ChevronDown  className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
                                    <span className={cn("text-[11px] font-bold tracking-wide", isRevenue ? "text-orange-700" : "text-blue-800")}>
                                      {decodeHtml(groupName)}
                                    </span>
                                    <Badge variant="outline" className={cn("ml-1 text-[9px] py-0", isRevenue ? "border-orange-300 text-orange-700" : "border-blue-300 text-blue-700")}>
                                      {isRevenue ? "P&L" : "B/S"}
                                    </Badge>
                                  </div>
                                </TableCell>
                                <TableCell className="text-right py-2 font-bold text-xs">
                                  {openingTotal > 0 ? (
                                    <span className={openingTotalType === "Dr" ? "text-blue-700" : "text-rose-600"}>
                                      {fmtAmt(openingTotal)} {openingTotalType}
                                    </span>
                                  ) : "—"}
                                </TableCell>
                                <TableCell className="text-right py-2 font-bold text-xs text-blue-700">
                                  {debitTotal > 0 ? fmtAmt(debitTotal) : "—"}
                                </TableCell>
                                <TableCell className="text-right py-2 font-bold text-xs text-rose-600">
                                  {creditTotal > 0 ? fmtAmt(creditTotal) : "—"}
                                </TableCell>
                                <TableCell className="text-right py-2 font-bold text-xs">
                                  {closingTotal > 0 ? (
                                    <span className={closingTotalType === "Dr" ? "text-blue-700" : "text-rose-600"}>
                                      {fmtAmt(closingTotal)} {closingTotalType}
                                    </span>
                                  ) : "—"}
                                </TableCell>
                              </TableRow>
                              {/* Ledger rows — hidden when group is collapsed */}
                              {!isCollapsed && rows.map(r => (
                                <TableRow key={r.id} className="text-xs hover:bg-muted/20">
                                  <TableCell className="pl-8 text-foreground">
                                    <button
                                      className="text-left hover:underline hover:text-blue-700 transition-colors"
                                      onClick={() => navigate(`/audit/tally-sync/ledger/${encodeURIComponent(r.ledger_name)}`)}
                                    >
                                      {decodeHtml(r.ledger_name)}
                                    </button>
                                  </TableCell>
                                  <TableCell className="text-right">
                                    {r.opening_balance > 0 ? (
                                      <span className={r.opening_type === "Dr" ? "text-blue-700" : "text-rose-600"}>
                                        {fmtAmt(r.opening_balance)} {r.opening_type}
                                      </span>
                                    ) : "—"}
                                  </TableCell>
                                  <TableCell className="text-right text-blue-700">
                                    {(r.debit_amount ?? 0) > 0 ? fmtAmt(r.debit_amount!) : "—"}
                                  </TableCell>
                                  <TableCell className="text-right text-rose-600">
                                    {(r.credit_amount ?? 0) > 0 ? fmtAmt(r.credit_amount!) : "—"}
                                  </TableCell>
                                  <TableCell className="text-right font-medium">
                                    {r.closing_balance > 0 ? (
                                      <span className={r.balance_type === "Dr" ? "text-blue-700" : "text-rose-600"}>
                                        {fmtAmt(r.closing_balance)} {r.balance_type}
                                      </span>
                                    ) : "—"}
                                  </TableCell>
                                </TableRow>
                              ))}
                            </>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                  {/* Grand Total footer */}
                  <div className="border-t bg-muted/40 px-4 py-2 flex flex-wrap justify-end gap-6 text-xs font-semibold">
                    <span>Closing Dr: <span className="text-blue-700 font-bold">{fmtAmt(tbDrTotal)}</span></span>
                    <span>Closing Cr: <span className="text-rose-600 font-bold">{fmtAmt(tbCrTotal)}</span></span>
                    <span>Total Debit: <span className="text-blue-700 font-bold">{fmtAmt(tbDebitTotal)}</span></span>
                    <span>Total Credit: <span className="text-rose-600 font-bold">{fmtAmt(tbCreditTotal)}</span></span>
                    <span className={cn("font-bold", Math.abs(tbDebitTotal - tbCreditTotal) < 1 ? "text-emerald-600" : "text-amber-600")}>
                      {Math.abs(tbDebitTotal - tbCreditTotal) < 1 ? "✓ Balanced" : `⚠ Diff: ${fmtAmt(Math.abs(tbDebitTotal - tbCreditTotal))}`}
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
                        <TableHead className="w-[55%]">Particulars</TableHead>
                        <TableHead className="text-right w-[22%]">Opening Balance</TableHead>
                        <TableHead className="text-right w-[23%] font-semibold">Closing Balance</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {groupedLedgers.map(({ groupName, isRevenue, depth, ledgers: grpLedgers }) => {
                        const prim = getPrimaryGroup(groupName);
                        const primName = prim ? decodeHtml(prim.group_name) : "";
                        const showPrim = primName && primName !== decodeHtml(groupName);
                        return (
                        <>
                          <TableRow key={`grp-hdr-${groupName}`} className="bg-muted/60 hover:bg-muted/60">
                            <TableCell colSpan={3} className="py-2 px-4" style={{ paddingLeft: `${depth * 16 + 16}px` }}>
                              <span className={cn("text-[11px] font-bold tracking-wide", isRevenue ? "text-orange-700" : "text-blue-800")}>
                                {decodeHtml(groupName) || "—"}
                              </span>
                              <Badge variant="outline" className={cn("ml-2 text-[9px] py-0", isRevenue ? "border-orange-300 text-orange-700" : "border-blue-300 text-blue-700")}>
                                {isRevenue ? "P&L" : "B/S"}
                              </Badge>
                              {showPrim && (
                                <span className="ml-2 text-[10px] text-muted-foreground">
                                  under <span className={cn("font-medium", isRevenue ? "text-orange-600" : "text-blue-700")}>{primName}</span>
                                </span>
                              )}
                            </TableCell>
                          </TableRow>
                          {grpLedgers.map(l => (
                            <TableRow key={l.id} className="text-xs hover:bg-muted/20">
                              <TableCell className="text-foreground" style={{ paddingLeft: `${depth * 16 + 32}px` }}>
                                <button
                                  className="text-left hover:underline hover:text-blue-700 transition-colors"
                                  onClick={() => navigate(`/audit/tally-sync/ledger/${encodeURIComponent(l.ledger_name)}`)}
                                >
                                  {decodeHtml(l.ledger_name)}
                                </button>
                              </TableCell>
                              <TableCell className="text-right">
                                {l.opening_balance > 0 ? (
                                  <span className={l.opening_type === "Dr" ? "text-blue-700" : "text-rose-600"}>
                                    {fmtAmt(l.opening_balance)} {l.opening_type}
                                  </span>
                                ) : "—"}
                              </TableCell>
                              <TableCell className="text-right font-medium">
                                {l.closing_balance > 0 ? (
                                  <span className={l.closing_type === "Dr" ? "text-blue-700" : "text-rose-600"}>
                                    {fmtAmt(l.closing_balance)} {l.closing_type}
                                  </span>
                                ) : "—"}
                              </TableCell>
                            </TableRow>
                          ))}
                        </>
                        );
                      })}
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
                      {sortedGroups.map(({ group: g, depth }) => {
                        const isPrimRow = isTallyPrimary(g);
                        return (
                        <TableRow key={g.id} className={cn("text-xs", isPrimRow && "bg-muted/40 font-semibold")}>
                          <TableCell style={{ paddingLeft: `${(depth * 16) + 16}px` }}>
                            <span className={cn(isPrimRow ? (g.is_revenue ? "text-orange-700" : "text-blue-800") : "text-foreground")}>
                              {decodeHtml(g.group_name)}
                            </span>
                            {isPrimRow && (
                              <Badge variant="outline" className={cn("ml-2 text-[9px] py-0", g.is_revenue ? "border-orange-300 text-orange-700" : "border-blue-300 text-blue-700")}>
                                {g.is_revenue ? "P&L" : "B/S"}
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-muted-foreground">{decodeHtml(g.parent_group) || "—"}</TableCell>
                          <TableCell className="text-muted-foreground">
                            {(() => {
                              // Resolve primary by walking parent chain (DB column
                              // is null for non-primary groups).
                              const prim = getPrimaryGroup(g.group_name);
                              if (!prim) return "—";
                              const primName = decodeHtml(prim.group_name);
                              // Don't echo the same name back on a primary row
                              if (primName === decodeHtml(g.group_name)) return "—";
                              return (
                                <span className={cn("font-medium", prim.is_revenue ? "text-orange-700" : "text-blue-800")}>
                                  {primName}
                                </span>
                              );
                            })()}
                          </TableCell>
                          <TableCell className="text-center">
                            {g.is_revenue ? <Badge variant="outline" className="text-orange-600 border-orange-300 text-[10px]">Yes</Badge> : <span className="text-muted-foreground text-[10px]">No</span>}
                          </TableCell>
                          <TableCell className="text-center">
                            {isPrimRow ? <Badge variant="outline" className="text-blue-600 border-blue-300 text-[10px]">Yes</Badge> : <span className="text-muted-foreground text-[10px]">No</span>}
                          </TableCell>
                        </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Vouchers Tab ──────────────────────────────────────────────── */}
        <TabsContent value="vouchers">
          <Card>
            <CardHeader className="pb-3 flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-base">Vouchers</CardTitle>
                <CardDescription>{rowCounts.vouchers.toLocaleString()} vouchers · click row to see all ledger entries</CardDescription>
              </div>
              <div className="relative w-64">
                <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                <Input placeholder="Search party / type / narration…" className="pl-8 h-8 text-sm" value={voucherSearch} onChange={e => setVoucherSearch(e.target.value)} />
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {loading ? (
                <div className="p-6 text-sm text-muted-foreground">Loading…</div>
              ) : filteredVouchers.length === 0 ? (
                <div className="p-6 text-sm text-muted-foreground">
                  {hasData ? "No results for search." : "No vouchers — run the Tally sync agent first."}
                </div>
              ) : (
                <div className="overflow-auto max-h-[560px]">
                  <Table>
                    <TableHeader className="sticky top-0 bg-background z-10">
                      <TableRow>
                        <TableHead className="w-6" />
                        <TableHead>Date</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>No.</TableHead>
                        <TableHead className="w-[28%]">Party Ledger</TableHead>
                        <TableHead className="text-right font-semibold">Amount</TableHead>
                        <TableHead className="text-center">Dr/Cr</TableHead>
                        <TableHead className="w-[18%]">Narration</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredVouchers.map(v => {
                        const isExpanded = expandedVoucher === v.id;
                        const lineItems  = v.line_items ?? [];
                        // Resolved party: prefer stored party_ledger, else first line item
                        const displayParty = decodeHtml(v.party_ledger) || decodeHtml(lineItems[0]?.ledger_name ?? "") || "—";
                        const extraCount   = lineItems.length > 1 ? lineItems.length - 1 : 0;
                        return (
                          <>
                            <TableRow
                              key={v.id}
                              className={cn("text-xs cursor-pointer", isExpanded ? "bg-blue-50/60" : "hover:bg-muted/20")}
                              onClick={() => setExpandedVoucher(isExpanded ? null : v.id)}
                            >
                              <TableCell className="px-2 py-2">
                                {isExpanded
                                  ? <ChevronDown  className="h-3.5 w-3.5 text-muted-foreground" />
                                  : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
                              </TableCell>
                              <TableCell className="whitespace-nowrap">{v.voucher_date}</TableCell>
                              <TableCell>{v.voucher_type}</TableCell>
                              <TableCell className="text-muted-foreground">{v.voucher_number || "—"}</TableCell>
                              <TableCell className="font-medium">
                                <span>{displayParty}</span>
                                {extraCount > 0 && (
                                  <Badge variant="outline" className="ml-1.5 text-[9px] py-0 border-muted-foreground/40 text-muted-foreground">
                                    +{extraCount} more
                                  </Badge>
                                )}
                              </TableCell>
                              <TableCell className="text-right font-semibold">{fmtAmt(v.amount)}</TableCell>
                              <TableCell className="text-center">
                                <span className={cn("text-[10px] font-bold", v.dr_cr === "Cr" ? "text-rose-600" : "text-blue-700")}>{v.dr_cr}</span>
                              </TableCell>
                              <TableCell className="text-muted-foreground truncate max-w-[160px]">{decodeHtml(v.narration) || "—"}</TableCell>
                            </TableRow>
                            {/* Expanded sub-table: all line items */}
                            {isExpanded && (
                              <TableRow key={`${v.id}-expand`} className="bg-blue-50/40">
                                <TableCell colSpan={8} className="p-0 pb-1">
                                  <div className="mx-8 my-1 rounded border border-blue-100 overflow-hidden">
                                    {v.narration && (
                                      <div className="px-3 py-1.5 text-[11px] text-muted-foreground border-b border-blue-100 bg-white/60">
                                        <span className="font-medium text-foreground">Narration: </span>{decodeHtml(v.narration)}
                                      </div>
                                    )}
                                    {lineItems.length > 0 ? (
                                      <table className="w-full text-xs">
                                        <thead>
                                          <tr className="bg-blue-100/60 text-[10px] uppercase tracking-wide text-muted-foreground">
                                            <th className="text-left px-3 py-1.5 font-semibold">Ledger Name</th>
                                            <th className="text-right px-3 py-1.5 font-semibold">Amount</th>
                                            <th className="text-center px-3 py-1.5 font-semibold">Dr/Cr</th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {lineItems.map((item, idx) => (
                                            <tr key={idx} className="border-t border-blue-100/60 bg-white/40">
                                              <td className="px-3 py-1.5">
                                                <button
                                                  className="text-left hover:underline hover:text-blue-700 transition-colors"
                                                  onClick={e => { e.stopPropagation(); navigate(`/audit/tally-sync/ledger/${encodeURIComponent(item.ledger_name)}`); }}
                                                >
                                                  {decodeHtml(item.ledger_name)}
                                                </button>
                                              </td>
                                              <td className="px-3 py-1.5 text-right font-medium">{fmtAmt(item.amount)}</td>
                                              <td className="px-3 py-1.5 text-center">
                                                <span className={cn("font-bold text-[10px]", item.dr_cr === "Cr" ? "text-rose-600" : "text-blue-700")}>
                                                  {item.dr_cr}
                                                </span>
                                              </td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    ) : (
                                      <p className="px-3 py-2 text-xs text-muted-foreground">No line items — re-sync to populate</p>
                                    )}
                                  </div>
                                </TableCell>
                              </TableRow>
                            )}
                          </>
                        );
                      })}
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
