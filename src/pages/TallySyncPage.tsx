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
  ChevronRight, ChevronDown, FileSpreadsheet, FileDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  exportTrialBalanceExcel, exportTrialBalancePDF,
  exportLedgersExcel,      exportLedgersPDF,
  exportGroupsExcel,       exportGroupsPDF,
  type ExportMeta,
} from "@/lib/tallyExport";

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
  sync_type?: string | null;
  current_phase?: string | null;
  phase_status?: Record<string, "pending" | "running" | "completed" | "failed" | "skipped"> | null;
  phase_errors?: Record<string, string> | null;
  phase_timings?: Record<string, number> | null;
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

// Sync agent stores Dr/Cr in Tally's correct convention; no client-side flip.

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
  const [expandedBatch, setExpandedBatch] = useState<string | null>(null);

  const [ledgerSearch, setLedgerSearch]   = useState("");
  const [groupSearch, setGroupSearch]     = useState("");
  const [tbSearch, setTbSearch]           = useState("");
  const [voucherSearch, setVoucherSearch] = useState("");

  // Collapse/expand state — separate sets per tab
  const [collapsedGroups,        setCollapsedGroups]        = useState<Set<string>>(new Set()); // TB
  const [collapsedLedgerGroups,  setCollapsedLedgerGroups]  = useState<Set<string>>(new Set()); // Ledgers tab
  const [collapsedGroupMasters,  setCollapsedGroupMasters]  = useState<Set<string>>(new Set()); // Groups tab (collapses children under primary)
  const [expandedVoucher,        setExpandedVoucher]        = useState<string | null>(null);
  const [reconExpanded,          setReconExpanded]          = useState(false);

  const makeToggler = (setter: React.Dispatch<React.SetStateAction<Set<string>>>) =>
    (name: string) => setter(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });

  const toggleGroup        = makeToggler(setCollapsedGroups);
  const toggleLedgerGroup  = makeToggler(setCollapsedLedgerGroups);
  const toggleGroupMaster  = makeToggler(setCollapsedGroupMasters);

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

    // Paginate vouchers — PostgREST caps a single response at 1,000 rows, so
    // fetch in 1,000-row ranges until we have every voucher. Without this,
    // voucher-derived turnover and the reconciliation card under-report.
    async function fetchAllVouchers() {
      const pageSize = 1000;
      const all: any[] = [];
      for (let from = 0; ; from += pageSize) {
        const { data, error } = await supabase
          .from("tally_vouchers" as any)
          .select("id,voucher_date,voucher_type,voucher_number,party_ledger,amount,dr_cr,narration,line_items")
          .eq("engagement_id", engId)
          .order("voucher_date", { ascending: false })
          .range(from, from + pageSize - 1);
        if (error || !data || data.length === 0) break;
        all.push(...data);
        if (data.length < pageSize) break;
      }
      return { data: all };
    }

    // Same PostgREST pagination needed for ledgers + TB — .limit(2000) gets
    // silently capped at 1,000 so large engagements were missing rows.
    async function fetchAllFrom(table: string, select: string, orderCol: string) {
      const pageSize = 1000;
      const all: any[] = [];
      for (let from = 0; ; from += pageSize) {
        const { data, error } = await supabase
          .from(table as any)
          .select(select)
          .eq("engagement_id", engId)
          .order(orderCol)
          .range(from, from + pageSize - 1);
        if (error || !data || data.length === 0) break;
        all.push(...data);
        if (data.length < pageSize) break;
      }
      return { data: all };
    }

    // Clean zombie batches: anything still "running" with no update for 10 min
    // is almost certainly a crashed agent. Without this the UI shows a stale
    // "Sync Queued…" pill forever.
    const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    await supabase
      .from("sync_batches" as any)
      .update({ status: "failed", completed_at: new Date().toISOString(), warnings: [{ message: "Auto-failed: no progress for 10 min (agent likely crashed)" }] })
      .eq("engagement_id", engId)
      .in("status", ["running", "processing"])
      .lt("started_at", tenMinAgo);

    const [batchRes, grpRes, ledRes, tbRes, vchRes, grpData, ledData, tbData, vchData] = await Promise.all([
      supabase.from("sync_batches" as any).select("*").eq("engagement_id", engId).order("started_at", { ascending: false }).limit(20),
      supabase.from("tally_groups" as any).select("id", { count: "exact", head: true }).eq("engagement_id", engId),
      supabase.from("tally_ledgers" as any).select("id", { count: "exact", head: true }).eq("engagement_id", engId),
      supabase.from("tally_trial_balance" as any).select("id", { count: "exact", head: true }).eq("engagement_id", engId),
      supabase.from("tally_vouchers" as any).select("id", { count: "exact", head: true }).eq("engagement_id", engId),
      supabase.from("tally_groups" as any).select("id,group_name,parent_group,primary_group,is_revenue,is_primary").eq("engagement_id", engId).order("group_name"),
      fetchAllFrom("tally_ledgers", "id,ledger_name,parent_group,opening_balance,opening_type,closing_balance,closing_type", "ledger_name"),
      fetchAllFrom("tally_trial_balance", "id,ledger_name,parent_group,opening_balance,opening_type,closing_balance,balance_type,debit_amount,credit_amount", "parent_group"),
      fetchAllVouchers(),
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

    // Flip Dr/Cr on vouchers and aggregate period Debit/Credit per ledger.
    // Computed BEFORE ledger/TB processing so we can derive closing balances
    // from voucher activity when the Tally connector pushes zero-balance
    // rows (slim sync — the connector only fills balances via TB, but many
    // deployments see TB come through with zeros too). Every voucher
    // line_item has a real amount + dr_cr, so Σ Dr − Σ Cr per ledger gives
    // the closing balance for the synced period.
    const voucherRows: TallyVoucher[] = vchData.data
      ? (vchData.data as TallyVoucher[])
      : [];
    setVouchers(voucherRows);

    const periodTotals = new Map<string, { debit: number; credit: number }>();
    for (const v of voucherRows) {
      for (const li of v.line_items ?? []) {
        const key = li.ledger_name;
        if (!periodTotals.has(key)) periodTotals.set(key, { debit: 0, credit: 0 });
        const bucket = periodTotals.get(key)!;
        if (li.dr_cr === "Dr") bucket.debit += li.amount;
        else bucket.credit += li.amount;
      }
    }

    // Derive a closing balance from voucher Dr−Cr when DB has none.
    const deriveClosing = (name: string): { balance: number; type: string } | null => {
      const tot = periodTotals.get(name);
      if (!tot) return null;
      const net = tot.debit - tot.credit;
      if (net === 0) return null;
      return { balance: Math.abs(net), type: net > 0 ? "Dr" : "Cr" };
    };

    // Dedupe, fall back to voucher-derived closing when DB=0
    if (ledData.data) {
      const seen = new Map<string, TallyLedger>();
      for (const l of ledData.data as TallyLedger[]) {
        if (seen.has(l.ledger_name)) continue;
        let closing_balance = l.closing_balance;
        let closing_type = l.closing_type;
        if (closing_balance <= 0) {
          const derived = deriveClosing(l.ledger_name);
          if (derived) {
            closing_balance = derived.balance;
            closing_type = derived.type;
          }
        }
        seen.set(l.ledger_name, { ...l, closing_balance, closing_type });
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

    const tbSeen = new Map<string, TallyTB>();
    for (const r of tbSource) {
      if (tbSeen.has(r.ledger_name)) continue;
      const computed = periodTotals.get(r.ledger_name);
      let closing_balance = r.closing_balance;
      let balance_type = r.balance_type;
      if (closing_balance <= 0) {
        const derived = deriveClosing(r.ledger_name);
        if (derived) {
          closing_balance = derived.balance;
          balance_type = derived.type;
        }
      }
      if (closing_balance <= 0 && r.opening_balance <= 0) continue;
      tbSeen.set(r.ledger_name, {
        ...r,
        closing_balance,
        balance_type,
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

    // Auto-fail stuck batches + stale requests older than 30 min before queuing a new one
    const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    await supabase
      .from("sync_batches" as any)
      .update({ status: "failed", completed_at: new Date().toISOString(), warnings: [{ message: "Auto-failed: stuck in running state over 30 min" }] })
      .eq("engagement_id", tallyEngId)
      .in("status", ["running", "processing"])
      .lt("started_at", thirtyMinAgo);
    await supabase
      .from("sync_requests" as any)
      .update({ status: "failed" })
      .eq("engagement_id", tallyEngId)
      .eq("status", "pending")
      .lt("requested_at", thirtyMinAgo);

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
      await loadData();
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

  // ── Voucher reconciliation: per-month counts from DB vs last sync batch ──
  const voucherRecon = useMemo(() => {
    const monthly = new Map<string, number>(); // "YYYY-MM" -> count
    for (const v of vouchers) {
      const d = (v.voucher_date ?? "").slice(0, 7);
      if (!d) continue;
      monthly.set(d, (monthly.get(d) ?? 0) + 1);
    }
    const lastBatch = batches.find(b => (b.vouchers_fetched ?? 0) > 0) ?? batches[0];
    const dbTotal = rowCounts.vouchers;
    const fetchedTotal = lastBatch?.vouchers_fetched ?? 0;
    const months = Array.from(monthly.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([ym, count]) => {
        const [y, m] = ym.split("-");
        const label = new Date(Number(y), Number(m) - 1, 1).toLocaleString("en-IN", { month: "short", year: "2-digit" });
        return { ym, label, count };
      });
    const matched = fetchedTotal > 0 && dbTotal === fetchedTotal;
    const delta = dbTotal - fetchedTotal;
    const loadedShown = vouchers.length;
    const loadedTruncated = loadedShown < dbTotal; // 5000-row cap hit
    return { monthly, months, dbTotal, fetchedTotal, matched, delta, lastBatch, loadedShown, loadedTruncated };
  }, [vouchers, batches, rowCounts.vouchers]);

  // ── Current-year turnover derived from vouchers (fallback when tally_trial_balance.debit_amount/credit_amount is 0) ──
  const ledgerTurnover = useMemo(() => {
    const m = new Map<string, { debit: number; credit: number }>();
    const add = (name: string | null | undefined, amount: number, drCr: string | null | undefined) => {
      if (!name || !amount) return;
      const key = decodeHtml(name).trim().toLowerCase();
      if (!key) return;
      if (!m.has(key)) m.set(key, { debit: 0, credit: 0 });
      const rec = m.get(key)!;
      const amt = Math.abs(amount);
      if (drCr === "Dr") rec.debit += amt;
      else if (drCr === "Cr") rec.credit += amt;
    };
    for (const v of vouchers) {
      const items = v.line_items ?? [];
      if (items.length > 0) {
        for (const li of items) add(li.ledger_name, li.amount, li.dr_cr);
      } else {
        add(v.party_ledger, v.amount, v.dr_cr);
      }
    }
    return m;
  }, [vouchers]);

  // Return effective debit/credit for a TB row. tally_trial_balance.debit_amount
  // /credit_amount is now populated by sync-step.js from the FULL voucher set
  // (with a reconciliation guard ensuring Dr=Cr to within ₹500), so it is the
  // authoritative per-ledger turnover. The UI-side vouchers state is capped at
  // 5000 rows, which under-reports turnover on companies with larger voucher
  // books, so we only fall back to voucher-derived numbers when the DB column
  // is missing/zero.
  const getTurnover = useCallback((r: TallyTB): { debit: number; credit: number } => {
    const dbDebit  = r.debit_amount  ?? 0;
    const dbCredit = r.credit_amount ?? 0;
    if (dbDebit > 0 || dbCredit > 0) return { debit: dbDebit, credit: dbCredit };
    const t = ledgerTurnover.get(decodeHtml(r.ledger_name).trim().toLowerCase());
    if (t && (t.debit > 0 || t.credit > 0)) return t;
    return { debit: 0, credit: 0 };
  }, [ledgerTurnover]);

  // TB totals (for footer, now using effective turnover)
  const tbDrTotal     = filteredTB.filter(r => r.balance_type === "Dr").reduce((s, r) => s + r.closing_balance, 0);
  const tbCrTotal     = filteredTB.filter(r => r.balance_type === "Cr").reduce((s, r) => s + r.closing_balance, 0);
  const tbDrOpening   = filteredTB.filter(r => r.opening_type === "Dr").reduce((s, r) => s + r.opening_balance, 0);
  const tbCrOpening   = filteredTB.filter(r => r.opening_type === "Cr").reduce((s, r) => s + r.opening_balance, 0);
  const tbDebitTotal  = filteredTB.reduce((s, r) => s + getTurnover(r).debit,  0);
  const tbCreditTotal = filteredTB.reduce((s, r) => s + getTurnover(r).credit, 0);
  const hasDebitCredit = tbDebitTotal > 0 || tbCreditTotal > 0;

  // Per-ledger reconciliation against Tally's authoritative closing
  const tbReconStats = useMemo(() => {
    let matched = 0;
    const mismatches: { name: string; expected: number; actual: number }[] = [];
    for (const r of filteredTB) {
      const { debit, credit } = getTurnover(r);
      const openingSigned = r.opening_balance * (r.opening_type === "Dr" ? 1 : -1);
      const closingSigned = r.closing_balance * (r.balance_type  === "Dr" ? 1 : -1);
      const derivedSigned = openingSigned + debit - credit;
      if (Math.abs(derivedSigned - closingSigned) < 1) matched++;
      else mismatches.push({ name: r.ledger_name, expected: closingSigned, actual: derivedSigned });
    }
    return { matched, total: filteredTB.length, allMatched: filteredTB.length > 0 && matched === filteredTB.length, mismatches };
  }, [filteredTB, getTurnover]);

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

  // Returns "Under Sub group of Parent > Grandparent" for sub-groups, or "" for primary groups.
  function getParentChainLabel(groupName: string): string {
    const g = groupInfoMap.get(groupName);
    if (!g || isTallyPrimary(g) || !g.parent_group) return "";
    const chain: string[] = [];
    let current = groupInfoMap.get(g.parent_group);
    const visited = new Set<string>();
    while (current && !visited.has(current.group_name)) {
      visited.add(current.group_name);
      chain.push(decodeHtml(current.group_name));
      if (isTallyPrimary(current) || !current.parent_group) break;
      current = groupInfoMap.get(current.parent_group);
    }
    if (chain.length === 0) return "";
    return `Under Sub group of ${chain.join(" › ")}`;
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

    type EnrichedRow = TallyTB & { _debit: number; _credit: number };

    type TBGroup = {
      groupName: string; isRevenue: boolean; rows: EnrichedRow[];
      openingTotal: number; openingTotalType: string;
      debitTotal: number; creditTotal: number;
      closingTotal: number; closingTotalType: string;
    };

    const makeGroup = (grpName: string, isRevenue: boolean, rows: TallyTB[]): TBGroup => {
      const enriched: EnrichedRow[] = rows
        .slice()
        .sort((a, b) => a.ledger_name.localeCompare(b.ledger_name))
        .map(r => {
          const t = getTurnover(r);
          return { ...r, _debit: t.debit, _credit: t.credit };
        });
      const netOp  = enriched.reduce((s, r) => s + (r.opening_type === "Dr" ? r.opening_balance : -r.opening_balance), 0);
      const netCl  = enriched.reduce((s, r) => s + (r.balance_type  === "Dr" ? r.closing_balance  : -r.closing_balance), 0);
      const debit  = enriched.reduce((s, r) => s + r._debit,  0);
      const credit = enriched.reduce((s, r) => s + r._credit, 0);
      return {
        groupName: grpName, isRevenue, rows: enriched,
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
  }, [filteredTB, sortedGroups, getTurnover]);

  // ── Export helpers ───────────────────────────────────────────────────────────
  const exportMeta: ExportMeta = useMemo(() => ({
    clientName: (selectedEngagement as any)?.client_name
              ?? (selectedEngagement as any)?.clients?.name
              ?? "Client",
    financialYear: (selectedEngagement as any)?.financial_year ?? tallyFy ?? "—",
    firmName: (selectedEngagement as any)?.firm_name
            ?? (selectedEngagement as any)?.firms?.name
            ?? "Tally Sync Export",
  }), [selectedEngagement, tallyFy]);

  const tbBlocksForExport = () => groupedTB.map(g => ({
    groupName: decodeHtml(g.groupName),
    isRevenue: g.isRevenue,
    openingTotal: g.openingTotal, openingTotalType: g.openingTotalType,
    debitTotal:   g.debitTotal,   creditTotal:      g.creditTotal,
    closingTotal: g.closingTotal, closingTotalType: g.closingTotalType,
    rows: g.rows.map(r => ({
      ledger_name:     decodeHtml(r.ledger_name),
      opening_balance: r.opening_balance,
      opening_type:    r.opening_type,
      debit:           (r as any)._debit  ?? 0,
      credit:          (r as any)._credit ?? 0,
      closing_balance: r.closing_balance,
      balance_type:    r.balance_type,
    })),
  }));

  const tbGrand = {
    drOpening: tbDrOpening,  crOpening: tbCrOpening,
    debit:     tbDebitTotal, credit:    tbCreditTotal,
    drClosing: tbDrTotal,    crClosing: tbCrTotal,
  };

  const ledgerBlocksForExport = () => groupedLedgers.map(g => {
    const prim = getPrimaryGroup(g.groupName);
    const primName = prim ? decodeHtml(prim.group_name) : "";
    return {
      groupName:   decodeHtml(g.groupName),
      isRevenue:   g.isRevenue,
      depth:       g.depth,
      primaryName: primName && primName !== decodeHtml(g.groupName) ? primName : "",
      ledgers: g.ledgers.map(l => ({
        ledger_name:     decodeHtml(l.ledger_name),
        parent_group:    decodeHtml(l.parent_group),
        opening_balance: l.opening_balance,
        opening_type:    l.opening_type,
        closing_balance: l.closing_balance,
        closing_type:    l.closing_type,
      })),
    };
  });

  const groupRowsForExport = () => sortedGroups.map(({ group: g, depth }) => {
    const prim = getPrimaryGroup(g.group_name);
    const primName = prim ? decodeHtml(prim.group_name) : "";
    return {
      group_name:   decodeHtml(g.group_name),
      parent_group: decodeHtml(g.parent_group || ""),
      primary_name: primName && primName !== decodeHtml(g.group_name) ? primName : "",
      is_revenue:   g.is_revenue,
      is_primary:   isTallyPrimary(g),
      depth,
    };
  });

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

      {/* Voucher Reconciliation Card */}
      {hasData && (
        <Card className="border-l-4" style={{ borderLeftColor: voucherRecon.matched ? "#16a34a" : voucherRecon.fetchedTotal === 0 ? "#9ca3af" : "#dc2626" }}>
          <CardHeader className="pb-2 flex flex-row items-start justify-between">
            <div>
              <CardTitle className="text-sm flex items-center gap-2">
                {voucherRecon.matched ? (
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                ) : voucherRecon.fetchedTotal === 0 ? (
                  <AlertTriangle className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <XCircle className="h-4 w-4 text-red-600" />
                )}
                Voucher Reconciliation
                {voucherRecon.matched && <Badge variant="outline" className="text-[10px] border-green-600 text-green-700">Tallied</Badge>}
                {!voucherRecon.matched && voucherRecon.fetchedTotal > 0 && (
                  <Badge variant="outline" className="text-[10px] border-red-600 text-red-700">
                    {voucherRecon.delta > 0 ? `+${voucherRecon.delta}` : voucherRecon.delta}
                  </Badge>
                )}
              </CardTitle>
              <CardDescription className="text-xs">
                DB <span className="font-semibold text-foreground">{voucherRecon.dbTotal.toLocaleString()}</span>
                {" · "}Last sync fetched <span className="font-semibold text-foreground">{voucherRecon.fetchedTotal.toLocaleString()}</span>
                {voucherRecon.lastBatch?.completed_at && <> · {fmtDate(voucherRecon.lastBatch.completed_at)}</>}
                {voucherRecon.loadedTruncated && (
                  <> · <span className="text-amber-600">monthly breakdown limited to most recent {voucherRecon.loadedShown.toLocaleString()} rows</span></>
                )}
              </CardDescription>
            </div>
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setReconExpanded(v => !v)}>
              {reconExpanded ? <ChevronDown className="h-3.5 w-3.5 mr-1" /> : <ChevronRight className="h-3.5 w-3.5 mr-1" />}
              Monthly breakdown
            </Button>
          </CardHeader>
          {reconExpanded && (
            <CardContent className="pt-0 pb-3">
              {voucherRecon.months.length === 0 ? (
                <div className="text-xs text-muted-foreground">No vouchers in current data set.</div>
              ) : (
                <div className="grid grid-cols-4 sm:grid-cols-6 lg:grid-cols-12 gap-2">
                  {voucherRecon.months.map(m => (
                    <div key={m.ym} className="border rounded px-2 py-1.5 bg-muted/20">
                      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{m.label}</div>
                      <div className="text-sm font-semibold">{m.count.toLocaleString()}</div>
                    </div>
                  ))}
                  <div className="border rounded px-2 py-1.5 bg-blue-50 border-blue-200">
                    <div className="text-[10px] uppercase tracking-wide text-blue-700">Total</div>
                    <div className="text-sm font-semibold text-blue-900">
                      {voucherRecon.months.reduce((s, m) => s + m.count, 0).toLocaleString()}
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          )}
        </Card>
      )}

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
                <CardTitle className="text-base flex items-center gap-2">
                  Trial Balance
                  {hasData && (
                    tbReconStats.allMatched ? (
                      <Badge className="bg-emerald-100 text-emerald-800 border-emerald-300 hover:bg-emerald-100 gap-1">
                        <CheckCircle2 className="h-3.5 w-3.5" /> Tallied with Tally · {tbReconStats.matched}/{tbReconStats.total}
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="border-amber-400 text-amber-700 bg-amber-50 gap-1">
                        <AlertTriangle className="h-3.5 w-3.5" /> {tbReconStats.matched}/{tbReconStats.total} reconciled · {tbReconStats.total - tbReconStats.matched} with variance
                      </Badge>
                    )
                  )}
                </CardTitle>
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
                <Button variant="outline" size="sm" className="text-xs h-7 px-2" disabled={!hasData}
                  onClick={() => exportTrialBalanceExcel(tbBlocksForExport(), exportMeta, tbGrand)}>
                  <FileSpreadsheet className="h-3.5 w-3.5 mr-1 text-emerald-600" /> Excel
                </Button>
                <Button variant="outline" size="sm" className="text-xs h-7 px-2" disabled={!hasData}
                  onClick={() => exportTrialBalancePDF(tbBlocksForExport(), exportMeta, tbGrand)}>
                  <FileDown className="h-3.5 w-3.5 mr-1 text-rose-600" /> PDF
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
                                    {getParentChainLabel(groupName) && (
                                      <span className="ml-2 text-[10px] font-normal italic text-muted-foreground">
                                        {getParentChainLabel(groupName)}
                                      </span>
                                    )}
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
                                    {(r as any)._debit > 0 ? fmtAmt((r as any)._debit) : "—"}
                                  </TableCell>
                                  <TableCell className="text-right text-rose-600">
                                    {(r as any)._credit > 0 ? fmtAmt((r as any)._credit) : "—"}
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
                        {/* Grand Total row — aligned to columns */}
                        <TableRow className="bg-muted/70 hover:bg-muted/70 border-t-2 border-blue-700/40 sticky bottom-0">
                          <TableCell className="py-2 px-3">
                            <span className="text-[11px] font-extrabold tracking-wide text-blue-800 uppercase">Grand Total</span>
                          </TableCell>
                          <TableCell className="text-right py-2 font-bold text-xs">
                            <div><span className="text-blue-700">{fmtAmt(tbDrOpening)}</span> <span className="text-blue-700">Dr</span></div>
                            <div><span className="text-rose-600">{fmtAmt(tbCrOpening)}</span> <span className="text-rose-600">Cr</span></div>
                          </TableCell>
                          {hasDebitCredit && (
                            <TableCell className="text-right py-2 font-bold text-xs text-blue-700">
                              {tbDebitTotal > 0 ? fmtAmt(tbDebitTotal) : "—"}
                            </TableCell>
                          )}
                          {hasDebitCredit && (
                            <TableCell className="text-right py-2 font-bold text-xs text-rose-600">
                              {tbCreditTotal > 0 ? fmtAmt(tbCreditTotal) : "—"}
                            </TableCell>
                          )}
                          <TableCell className="text-right py-2 font-bold text-xs">
                            <div><span className="text-blue-700">{fmtAmt(tbDrTotal)}</span> <span className="text-blue-700">Dr</span></div>
                            <div><span className="text-rose-600">{fmtAmt(tbCrTotal)}</span> <span className="text-rose-600">Cr</span></div>
                          </TableCell>
                        </TableRow>
                      </TableBody>
                    </Table>
                  </div>
                  {/* Balance check strip */}
                  <div className="border-t bg-muted/30 px-4 py-1.5 text-[11px] font-semibold flex justify-end gap-4">
                    <span className={cn(Math.abs(tbDrTotal - tbCrTotal) < 1 ? "text-emerald-600" : "text-amber-600")}>
                      {Math.abs(tbDrTotal - tbCrTotal) < 1 ? "✓ Closing Balanced" : `⚠ Closing Diff: ${fmtAmt(Math.abs(tbDrTotal - tbCrTotal))}`}
                    </span>
                    {hasDebitCredit && (
                      <span className={cn(Math.abs(tbDebitTotal - tbCreditTotal) < 1 ? "text-emerald-600" : "text-amber-600")}>
                        {Math.abs(tbDebitTotal - tbCreditTotal) < 1 ? "✓ Movement Balanced" : `⚠ Movement Diff: ${fmtAmt(Math.abs(tbDebitTotal - tbCreditTotal))}`}
                      </span>
                    )}
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
                <CardDescription>{rowCounts.ledgers.toLocaleString()} ledgers from Tally · click group to collapse</CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" className="text-xs h-7 px-2 text-muted-foreground"
                  onClick={() => setCollapsedLedgerGroups(new Set(groupedLedgers.map(g => g.groupName)))}>
                  Collapse All
                </Button>
                <Button variant="ghost" size="sm" className="text-xs h-7 px-2 text-muted-foreground"
                  onClick={() => setCollapsedLedgerGroups(new Set())}>
                  Expand All
                </Button>
                <Button variant="outline" size="sm" className="text-xs h-7 px-2" disabled={!hasData}
                  onClick={() => exportLedgersExcel(ledgerBlocksForExport(), exportMeta)}>
                  <FileSpreadsheet className="h-3.5 w-3.5 mr-1 text-emerald-600" /> Excel
                </Button>
                <Button variant="outline" size="sm" className="text-xs h-7 px-2" disabled={!hasData}
                  onClick={() => exportLedgersPDF(ledgerBlocksForExport(), exportMeta)}>
                  <FileDown className="h-3.5 w-3.5 mr-1 text-rose-600" /> PDF
                </Button>
                <div className="relative w-56">
                  <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                  <Input placeholder="Search ledger / group…" className="pl-8 h-8 text-sm" value={ledgerSearch} onChange={e => setLedgerSearch(e.target.value)} />
                </div>
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
                        const parentChain = getParentChainLabel(groupName);
                        const isCollapsed = collapsedLedgerGroups.has(groupName);
                        return (
                        <>
                          <TableRow
                            key={`grp-hdr-${groupName}`}
                            className="bg-muted/60 hover:bg-muted/80 cursor-pointer select-none"
                            onClick={() => toggleLedgerGroup(groupName)}
                          >
                            <TableCell colSpan={3} className="py-2 px-4" style={{ paddingLeft: `${depth * 16 + 16}px` }}>
                              <div className="flex items-center gap-1.5 flex-wrap">
                                {isCollapsed
                                  ? <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                                  : <ChevronDown  className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
                                <span className={cn("text-[11px] font-bold tracking-wide", isRevenue ? "text-orange-700" : "text-blue-800")}>
                                  {decodeHtml(groupName) || "—"}
                                </span>
                                <Badge variant="outline" className={cn("ml-1 text-[9px] py-0", isRevenue ? "border-orange-300 text-orange-700" : "border-blue-300 text-blue-700")}>
                                  {isRevenue ? "P&L" : "B/S"}
                                </Badge>
                                <span className="ml-1 text-[10px] text-muted-foreground">({grpLedgers.length})</span>
                                {parentChain && (
                                  <span className="ml-2 text-[10px] italic text-muted-foreground">{parentChain}</span>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                          {!isCollapsed && grpLedgers.map(l => (
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
                <CardDescription>{rowCounts.groups} groups from Tally · primaries + sub-groups · click primary to collapse its children</CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" className="text-xs h-7 px-2 text-muted-foreground"
                  onClick={() => setCollapsedGroupMasters(new Set(sortedGroups.filter(x => isTallyPrimary(x.group)).map(x => x.group.group_name)))}>
                  Collapse All
                </Button>
                <Button variant="ghost" size="sm" className="text-xs h-7 px-2 text-muted-foreground"
                  onClick={() => setCollapsedGroupMasters(new Set())}>
                  Expand All
                </Button>
                <Button variant="outline" size="sm" className="text-xs h-7 px-2" disabled={!hasData}
                  onClick={() => exportGroupsExcel(groupRowsForExport(), exportMeta)}>
                  <FileSpreadsheet className="h-3.5 w-3.5 mr-1 text-emerald-600" /> Excel
                </Button>
                <Button variant="outline" size="sm" className="text-xs h-7 px-2" disabled={!hasData}
                  onClick={() => exportGroupsPDF(groupRowsForExport(), exportMeta)}>
                  <FileDown className="h-3.5 w-3.5 mr-1 text-rose-600" /> PDF
                </Button>
                <div className="relative w-56">
                  <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                  <Input placeholder="Search group…" className="pl-8 h-8 text-sm" value={groupSearch} onChange={e => setGroupSearch(e.target.value)} />
                </div>
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
                        // For sub-groups: hide if their primary is in the collapsed set
                        if (!isPrimRow) {
                          const prim = getPrimaryGroup(g.group_name);
                          if (prim && collapsedGroupMasters.has(prim.group_name)) return null;
                        }
                        const isCollapsed = isPrimRow && collapsedGroupMasters.has(g.group_name);
                        return (
                        <TableRow
                          key={g.id}
                          className={cn("text-xs", isPrimRow && "bg-muted/40 font-semibold cursor-pointer hover:bg-muted/60 select-none")}
                          onClick={isPrimRow ? () => toggleGroupMaster(g.group_name) : undefined}
                        >
                          <TableCell style={{ paddingLeft: `${(depth * 16) + 16}px` }}>
                            <div className="flex items-center gap-1.5 flex-wrap">
                              {isPrimRow && (
                                isCollapsed
                                  ? <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                                  : <ChevronDown  className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                              )}
                              <span className={cn(isPrimRow ? (g.is_revenue ? "text-orange-700" : "text-blue-800") : "text-foreground")}>
                                {decodeHtml(g.group_name)}
                              </span>
                              {isPrimRow && (
                                <Badge variant="outline" className={cn("ml-1 text-[9px] py-0", g.is_revenue ? "border-orange-300 text-orange-700" : "border-blue-300 text-blue-700")}>
                                  {g.is_revenue ? "P&L" : "B/S"}
                                </Badge>
                              )}
                              {!isPrimRow && getParentChainLabel(g.group_name) && (
                                <span className="ml-1 text-[10px] italic text-muted-foreground">
                                  {getParentChainLabel(g.group_name)}
                                </span>
                              )}
                            </div>
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
                      <TableHead className="w-8" />
                      <TableHead>Status</TableHead>
                      <TableHead>Type</TableHead>
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
                    {batches.map(b => {
                      const warns = (b.warnings as any[]) ?? [];
                      const phaseStatus = (b.phase_status ?? {}) as Record<string, string>;
                      const phaseErrors = (b.phase_errors ?? {}) as Record<string, string>;
                      const phaseTimings = (b.phase_timings ?? {}) as Record<string, number>;
                      const phases = Object.keys(phaseStatus);
                      const isFailed = b.status === "failed";
                      const isRunning = b.status === "running";
                      const expanded = expandedBatch === b.id;
                      const hasDetail = phases.length > 0 || warns.length > 0 || isFailed;
                      const summaryError = phases
                        .filter(p => phaseStatus[p] === "failed")
                        .map(p => `${p}: ${phaseErrors[p] || "failed"}`)[0];

                      return (
                        <>
                          <TableRow
                            key={b.id}
                            className={cn(hasDetail && "cursor-pointer hover:bg-muted/40")}
                            onClick={() => hasDetail && setExpandedBatch(expanded ? null : b.id)}
                          >
                            <TableCell className="w-8 pr-0">
                              {hasDetail && (
                                expanded
                                  ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                                  : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                              )}
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-1.5">
                                <StatusIcon status={b.status} />
                                <span className={cn("text-xs capitalize", statusColor(b.status))}>
                                  {b.status.replace(/_/g, " ")}
                                </span>
                                {isRunning && b.current_phase && (
                                  <span className="text-xs text-blue-600 font-medium">· {b.current_phase}</span>
                                )}
                              </div>
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">{b.sync_type ?? "full"}</TableCell>
                            <TableCell className="text-xs max-w-[140px] truncate">{b.tally_company ?? "—"}</TableCell>
                            <TableCell className="text-xs">{b.financial_year ?? "—"}</TableCell>
                            <TableCell className="text-right text-xs">{b.groups_fetched ?? 0}</TableCell>
                            <TableCell className="text-right text-xs">{b.ledgers_fetched ?? 0}</TableCell>
                            <TableCell className="text-right text-xs">{b.tb_rows_fetched ?? 0}</TableCell>
                            <TableCell className="text-right text-xs">{b.vouchers_fetched ?? 0}</TableCell>
                            <TableCell className="text-xs text-muted-foreground">{fmtDate(b.started_at)}</TableCell>
                          </TableRow>

                          {/* One-line failure summary always shown (collapsed view) */}
                          {(isFailed && (summaryError || warns.length > 0) && !expanded) && (
                            <TableRow key={`${b.id}-sum`} className="bg-red-50 text-xs">
                              <TableCell colSpan={10} className="py-1.5 px-4 text-red-700">
                                <div className="flex items-start gap-2">
                                  <XCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                                  <span className="leading-snug">
                                    {summaryError || (typeof warns[0] === "string" ? warns[0] : (warns[0] as any)?.message || "Sync failed")}
                                    <span className="ml-2 text-red-500/70">(click row for phase breakdown)</span>
                                  </span>
                                </div>
                              </TableCell>
                            </TableRow>
                          )}

                          {/* Expanded phase breakdown */}
                          {expanded && hasDetail && (
                            <TableRow key={`${b.id}-detail`} className="bg-slate-50">
                              <TableCell colSpan={10} className="py-3 px-4">
                                {phases.length > 0 ? (
                                  <div className="space-y-1.5">
                                    <div className="text-xs font-semibold text-slate-700 mb-2">Phase breakdown</div>
                                    {phases.map(p => {
                                      const s = phaseStatus[p];
                                      const err = phaseErrors[p];
                                      const ms = phaseTimings[p];
                                      const col =
                                        s === "completed" ? "text-green-700" :
                                        s === "failed"    ? "text-red-700"   :
                                        s === "running"   ? "text-blue-700"  :
                                                            "text-slate-500";
                                      const icon =
                                        s === "completed" ? <CheckCircle2 className="h-3.5 w-3.5" /> :
                                        s === "failed"    ? <XCircle className="h-3.5 w-3.5" /> :
                                        s === "running"   ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> :
                                                            <Clock className="h-3.5 w-3.5" />;
                                      return (
                                        <div key={p} className="flex items-start gap-2 text-xs">
                                          <span className={cn("flex items-center gap-1.5 min-w-[160px]", col)}>
                                            {icon}
                                            <span className="font-mono">{p}</span>
                                          </span>
                                          <span className={col}>{s}</span>
                                          {ms != null && (
                                            <span className="text-slate-500">· {(ms / 1000).toFixed(1)}s</span>
                                          )}
                                          {err && (
                                            <span className="text-red-600 flex-1 break-all">— {err}</span>
                                          )}
                                        </div>
                                      );
                                    })}
                                  </div>
                                ) : (
                                  <div className="text-xs text-red-700 flex items-start gap-2">
                                    <XCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                                    <div>
                                      {warns.length > 0 ? (
                                        warns.map((w: any, i: number) => (
                                          <div key={i}>• {typeof w === "string" ? w : (w?.message ?? w?.error ?? JSON.stringify(w))}</div>
                                        ))
                                      ) : (
                                        <div>Sync failed — check Tally is reachable and no dialog is open.</div>
                                      )}
                                    </div>
                                  </div>
                                )}
                              </TableCell>
                            </TableRow>
                          )}
                        </>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {/* Run instructions */}
          <Card className="border-dashed">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">Run Sync Agent Locally</CardTitle>
              <CardDescription className="text-xs">
                All commands run where Tally Prime is open. See <code className="text-[11px]">tally-sync/README.md</code> for full guide.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <div className="text-xs font-semibold mb-1">Full sync (with automatic chunking)</div>
                <pre className="bg-muted text-xs rounded p-3 overflow-x-auto">
{`cd "C:\\Users\\kvdes\\Desktop\\CA FLOW\\tally-sync"
node sync-step.js all`}
                </pre>
              </div>
              <div>
                <div className="text-xs font-semibold mb-1">Run one phase at a time (when Tally is slow)</div>
                <pre className="bg-muted text-xs rounded p-3 overflow-x-auto">
{`node sync-step.js groups     # fast
node sync-step.js ledgers    # medium (name + parent only)
node sync-step.js vouchers   # chunked monthly — safest
node sync-step.js tb         # Openings+closings via custom TDL REPORT; turnover from DB vouchers`}
                </pre>
              </div>
              <div>
                <div className="text-xs font-semibold mb-1">Resume after a failure</div>
                <pre className="bg-muted text-xs rounded p-3 overflow-x-auto">
{`node sync-step.js resume    # skips phases already marked 'completed'`}
                </pre>
              </div>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                <strong>Tip:</strong> click any failed batch row above to see exactly which phase failed and the full error. Vouchers run as one phase per calendar month — a hang on one month doesn't lose earlier months.
              </p>
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
