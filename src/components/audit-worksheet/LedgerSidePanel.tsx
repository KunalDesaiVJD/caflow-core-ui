/**
 * LedgerSidePanel — Phase 2C (enhanced)
 *
 * Right-side sheet showing all vouchers for a specific ledger.
 *
 * Phase 2C additions:
 *   • Running balance column (computed from opening → each voucher in date order)
 *   • Month-separator rows (vouchers bucketed by calendar month)
 *   • Voucher-type filter chips (Journal / Payment / Receipt / Contra / etc.)
 *   • Text search (narration + contra ledger)
 *   • Anomaly highlight — optional flaggedVoucherIds prop highlights rows amber
 *   • Turnover summary: Dr total | Cr total | Net per quarter in footer
 */
import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge  } from "@/components/ui/badge";
import {
  ChevronRight, ChevronDown, MessageSquareWarning, Loader2, AlertTriangle,
  Search, X, Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useTallyEngagementId } from "./hooks/useTallyEngagementId";

// ─── Types ────────────────────────────────────────────────────────────────────

interface LineItem {
  ledger_name: string;
  amount:      number;
  dr_cr:       string;
}

interface LedgerVoucher {
  id:             string;
  voucher_date:   string;
  voucher_type:   string;
  voucher_number: string;
  narration:      string;
  line_items:     LineItem[];
  thisAmount:     number;
  thisDrCr:       string;
  contraLedgers:  string;
  // Phase 2C: running balance (added after sort)
  runningBalance?: number;
  rbType?:        string;
}

interface TBRow {
  opening_balance: number;
  opening_type:    string;
  closing_balance: number;
  balance_type:    string;
}

interface Reconciliation {
  opening_balance:       number;
  opening_type:          string;
  debit_total:           number;
  credit_total:          number;
  derived_closing:       number;
  derived_closing_type:  string;
  tally_closing:         number;
  tally_closing_type:    string;
  variance:              number;
  reconciled:            boolean;
  voucher_count:         number;
}

// Phase 2C: table item type (vouchers interleaved with month headers)
type TableItem =
  | { kind: "month_header"; label: string; drTotal: number; crTotal: number }
  | { kind: "voucher"; voucher: LedgerVoucher; flagged: boolean };

interface Props {
  open:          boolean;
  ledgerName:    string;
  parentGroup:   string;
  clientId:      string | null | undefined;
  financialYear: string | null | undefined;
  /** Audit engagement id — passed through so the Tally lookup can find
   *  rows written under the audit id directly (current sync agent). */
  engagementId?: string | null;
  onClose:       () => void;
  onRaiseQuery:  (group: string, ledger: string, entryNote?: string) => void;
  /** Phase 2C: voucher IDs with anomaly flags — shown with amber highlight */
  flaggedVoucherIds?: Set<string>;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function decodeHtml(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&#\d+;/g, "");
}

function fmtAmt(n: number): string {
  return n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" });
}

function monthLabel(iso: string): string {
  if (!iso) return "Unknown";
  const d = new Date(iso);
  return d.toLocaleDateString("en-IN", { month: "long", year: "numeric" });
}

function monthKey(iso: string): string {
  return iso ? iso.substring(0, 7) : "";
}

/** Add running balance to vouchers sorted by date */
function attachRunningBalance(
  vouchers: LedgerVoucher[],
  opening:  number,
  openingType: string,
): LedgerVoucher[] {
  const sorted = [...vouchers].sort((a, b) => {
    const diff = (a.voucher_date ?? "").localeCompare(b.voucher_date ?? "");
    return diff !== 0 ? diff : (a.voucher_number ?? "").localeCompare(b.voucher_number ?? "");
  });
  let running = openingType === "Dr" ? opening : -opening;
  return sorted.map(v => {
    if (v.thisDrCr === "Dr") running += v.thisAmount;
    else running -= v.thisAmount;
    return {
      ...v,
      runningBalance: Math.abs(running),
      rbType:         running >= 0 ? "Dr" : "Cr",
    };
  });
}

/** Build flat table items list with month header rows interleaved */
function buildTableItems(
  vouchers: LedgerVoucher[],
  flaggedIds: Set<string>,
): TableItem[] {
  const items: TableItem[] = [];
  let lastKey = "";
  // Accumulate month Dr/Cr totals
  const monthTotals: Record<string, { dr: number; cr: number; label: string }> = {};

  for (const v of vouchers) {
    const key = monthKey(v.voucher_date);
    if (!monthTotals[key]) monthTotals[key] = { dr: 0, cr: 0, label: monthLabel(v.voucher_date) };
    if (v.thisDrCr === "Dr") monthTotals[key].dr += v.thisAmount;
    else monthTotals[key].cr += v.thisAmount;
  }

  for (const v of vouchers) {
    const key = monthKey(v.voucher_date);
    if (key !== lastKey) {
      const mt = monthTotals[key];
      items.push({ kind: "month_header", label: mt.label, drTotal: mt.dr, crTotal: mt.cr });
      lastKey = key;
    }
    items.push({ kind: "voucher", voucher: v, flagged: flaggedIds.has(v.id) });
  }
  return items;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function LedgerSidePanel({
  open, ledgerName, parentGroup, clientId, financialYear, engagementId, onClose, onRaiseQuery,
  flaggedVoucherIds = new Set(),
}: Props) {
  const { tallyEngId, loading: resolving } = useTallyEngagementId(clientId, financialYear, engagementId);

  const [vouchers,    setVouchers]    = useState<LedgerVoucher[]>([]);
  const [tbRow,       setTbRow]       = useState<TBRow | null>(null);
  const [recon,       setRecon]       = useState<Reconciliation | null>(null);
  const [loading,     setLoading]     = useState(false);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);

  // Phase 2C filters
  const [search,     setSearch]     = useState("");
  const [typeFilter, setTypeFilter] = useState<Set<string>>(new Set());

  // Reset + fetch whenever ledger or panel opens
  useEffect(() => {
    if (!open || !tallyEngId || !ledgerName) return;
    setVouchers([]); setTbRow(null); setRecon(null); setExpandedRow(null);
    setSearch(""); setTypeFilter(new Set());
    setLoading(true);

    async function load() {
      const { data: tb } = await (supabase as any)
        .from("tally_trial_balance")
        .select("opening_balance,opening_type,closing_balance,balance_type")
        .eq("engagement_id", tallyEngId)
        .eq("ledger_name", ledgerName)
        .maybeSingle();
      setTbRow(tb ?? null);

      const { data: vchData, error } = await (supabase as any).rpc("get_ledger_vouchers", {
        p_engagement_id: tallyEngId,
        p_ledger_name:   ledgerName,
      });

      if (!error && vchData) {
        const processed: LedgerVoucher[] = (vchData as any[]).map(v => {
          const rawItems: LineItem[] = Array.isArray(v.line_items) ? v.line_items : [];
          let items = rawItems;

          if (items.length === 0 && v.amount != null && v.party_ledger) {
            const thisIsParty = v.party_ledger === ledgerName;
            const side: LineItem = {
              ledger_name: ledgerName,
              amount:  Number(v.amount) || 0,
              dr_cr:   thisIsParty ? v.dr_cr : v.dr_cr === "Dr" ? "Cr" : "Dr",
            };
            const contra: LineItem = {
              ledger_name: thisIsParty ? decodeHtml(v.voucher_type) || "(contra)" : v.party_ledger,
              amount:  Number(v.amount) || 0,
              dr_cr:   side.dr_cr === "Dr" ? "Cr" : "Dr",
            };
            items = [side, contra];
          }

          let thisAmount = Number(v.this_amount ?? 0);
          let thisDrCr   = String(v.this_dr_cr ?? "Dr");
          if (!thisAmount) {
            const matched = items.filter(i => i.ledger_name === ledgerName);
            const dr = matched.filter(i => i.dr_cr === "Dr").reduce((s, i) => s + i.amount, 0);
            const cr = matched.filter(i => i.dr_cr === "Cr").reduce((s, i) => s + i.amount, 0);
            thisAmount = Math.max(dr, cr);
            thisDrCr   = dr >= cr ? "Dr" : "Cr";
          }

          const contras = items
            .filter(i => i.ledger_name !== ledgerName)
            .map(i => decodeHtml(i.ledger_name));
          const contraLedgers = contras.length > 0
            ? contras[0] + (contras.length > 1 ? ` (+${contras.length - 1})` : "")
            : decodeHtml(v.voucher_type);

          return { ...v, line_items: items, thisAmount, thisDrCr, contraLedgers };
        });

        // Attach running balance (sorted by date)
        const withBalance = tb
          ? attachRunningBalance(processed, tb.opening_balance, tb.opening_type)
          : processed;
        setVouchers(withBalance);
      }

      const { data: rec } = await (supabase as any).rpc("get_ledger_reconciliation", {
        p_engagement_id: tallyEngId,
        p_ledger_name:   ledgerName,
      });
      if (Array.isArray(rec) && rec.length > 0) {
        const r = { ...(rec[0] as Reconciliation) };
        r.reconciled = Math.abs(r.variance) < 0.01;
        setRecon(r);
      }

      setLoading(false);
    }
    load();
  }, [open, tallyEngId, ledgerName]);

  const handleRaiseForVoucher = (v: LedgerVoucher) => {
    const note = `${fmtDate(v.voucher_date)} | ${v.voucher_type} ${v.voucher_number ? `#${v.voucher_number}` : ""} | ₹${fmtAmt(v.thisAmount)} ${v.thisDrCr}${v.narration ? ` | ${decodeHtml(v.narration)}` : ""}`;
    onRaiseQuery(parentGroup, ledgerName, note);
  };

  // Phase 2C: available voucher types (for filter chips)
  const availableTypes = useMemo(() => {
    const types = new Set<string>();
    for (const v of vouchers) if (v.voucher_type) types.add(v.voucher_type);
    return Array.from(types).sort();
  }, [vouchers]);

  // Phase 2C: filtered vouchers
  const filteredVouchers = useMemo(() => {
    return vouchers.filter(v => {
      if (typeFilter.size > 0 && !typeFilter.has(v.voucher_type)) return false;
      if (search) {
        const q = search.toLowerCase();
        const hit =
          v.contraLedgers.toLowerCase().includes(q) ||
          decodeHtml(v.narration).toLowerCase().includes(q) ||
          (v.voucher_number ?? "").toLowerCase().includes(q) ||
          (v.voucher_type ?? "").toLowerCase().includes(q);
        if (!hit) return false;
      }
      return true;
    });
  }, [vouchers, typeFilter, search]);

  // Phase 2C: table items with month headers
  const tableItems = useMemo(
    () => buildTableItems(filteredVouchers, flaggedVoucherIds),
    [filteredVouchers, flaggedVoucherIds],
  );

  const flaggedCount = useMemo(
    () => vouchers.filter(v => flaggedVoucherIds.has(v.id)).length,
    [vouchers, flaggedVoucherIds],
  );

  const toggleType = (t: string) =>
    setTypeFilter(prev => {
      const next = new Set(prev);
      next.has(t) ? next.delete(t) : next.add(t);
      return next;
    });

  const isLoading = resolving || loading;
  const hasFilters = typeFilter.size > 0 || search.length > 0;

  return (
    <Sheet open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <SheetContent className="w-full sm:max-w-3xl flex flex-col p-0" side="right">

        {/* ── Header ── */}
        <SheetHeader className="px-5 py-4 border-b bg-muted/30 flex-shrink-0">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <SheetTitle className="text-base truncate">{decodeHtml(ledgerName)}</SheetTitle>
                {vouchers.length > 0 && (
                  <Badge variant="secondary" className="text-[10px] h-4 px-1.5 flex-shrink-0">
                    {vouchers.length} entries
                  </Badge>
                )}
                {flaggedCount > 0 && (
                  <Badge className="text-[10px] h-4 px-1.5 flex-shrink-0 bg-amber-100 text-amber-700 border-amber-300 border">
                    <Zap size={9} className="mr-0.5" />
                    {flaggedCount} anomal{flaggedCount === 1 ? "y" : "ies"}
                  </Badge>
                )}
              </div>
              <SheetDescription className="text-xs mt-0.5">
                {parentGroup && <span className="text-muted-foreground">{parentGroup} · </span>}
                Ledger Vouchers
                {financialYear && ` · FY ${financialYear}`}
              </SheetDescription>
              {tbRow && (
                <div className="flex gap-4 mt-1.5 text-xs flex-wrap">
                  <span>
                    Opening:{" "}
                    <span className={cn("font-semibold", tbRow.opening_type === "Dr" ? "text-blue-700" : "text-rose-600")}>
                      ₹{fmtAmt(tbRow.opening_balance)} {tbRow.opening_type}
                    </span>
                  </span>
                  <span>
                    Closing:{" "}
                    <span className={cn("font-semibold", tbRow.balance_type === "Dr" ? "text-blue-700" : "text-rose-600")}>
                      ₹{fmtAmt(tbRow.closing_balance)} {tbRow.balance_type}
                    </span>
                  </span>
                  {recon && (
                    <Badge variant="outline" className={cn("text-[10px] h-4 px-1.5", recon.reconciled ? "border-emerald-400 text-emerald-700" : "border-amber-400 text-amber-700")}>
                      {recon.reconciled ? "✓ Reconciled" : "⚠ Variance"}
                    </Badge>
                  )}
                </div>
              )}
            </div>
            <Button
              size="sm"
              className="flex-shrink-0 gap-1 h-7 text-xs bg-orange-600 hover:bg-orange-700"
              onClick={() => onRaiseQuery(parentGroup, ledgerName)}
            >
              <MessageSquareWarning size={12} />
              Raise Query
            </Button>
          </div>
        </SheetHeader>

        {/* ── Filter Bar (Phase 2C) ── */}
        {!isLoading && vouchers.length > 0 && (
          <div className="px-4 py-2 border-b bg-background flex-shrink-0 space-y-1.5">
            {/* Search */}
            <div className="flex items-center gap-2 flex-wrap">
              <div className="relative flex-1 min-w-[180px]">
                <Search size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                <input
                  type="text"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search narration, contra, voucher no…"
                  className="w-full h-7 pl-7 pr-7 text-xs rounded-md border border-input bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                />
                {search && (
                  <button
                    type="button"
                    onClick={() => setSearch("")}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    <X size={10} />
                  </button>
                )}
              </div>
              {hasFilters && (
                <button
                  type="button"
                  onClick={() => { setSearch(""); setTypeFilter(new Set()); }}
                  className="text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-0.5"
                >
                  <X size={10} /> clear
                </button>
              )}
              {hasFilters && (
                <span className="text-[10px] text-muted-foreground">
                  {filteredVouchers.length} of {vouchers.length}
                </span>
              )}
            </div>
            {/* Type chips */}
            {availableTypes.length > 1 && (
              <div className="flex flex-wrap gap-1">
                {availableTypes.map(t => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => toggleType(t)}
                    className={cn(
                      "h-5 px-2 rounded text-[10px] font-medium border transition-colors",
                      typeFilter.has(t)
                        ? "bg-foreground text-background border-foreground"
                        : "text-muted-foreground hover:bg-muted/60 border-transparent hover:border-border",
                    )}
                  >
                    {t}
                    <span className="ml-1 opacity-60">
                      {vouchers.filter(v => v.voucher_type === t).length}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Body ── */}
        <div className="flex-1 overflow-auto">
          {isLoading ? (
            <div className="flex items-center justify-center h-40 text-muted-foreground gap-2 text-sm">
              <Loader2 size={16} className="animate-spin" /> Loading vouchers…
            </div>
          ) : !tallyEngId ? (
            <div className="p-6 text-sm text-muted-foreground text-center">
              No Tally sync data found. Run a Tally sync first.
            </div>
          ) : vouchers.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground text-center space-y-1">
              {tbRow ? (
                <>
                  <p className="font-medium text-foreground">No voucher-level data for this year.</p>
                  <p className="text-xs">
                    The trial balance is synced (closing ₹{fmtAmt(tbRow.closing_balance)} {tbRow.balance_type}),
                    but no vouchers were imported for FY {financialYear}. Run a full Tally
                    sync (voucher-level) for this year to drill into entries.
                  </p>
                </>
              ) : (
                <p>No vouchers found for this ledger.</p>
              )}
            </div>
          ) : filteredVouchers.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground text-center">
              No vouchers match the current filter.
              <button
                type="button"
                onClick={() => { setSearch(""); setTypeFilter(new Set()); }}
                className="ml-2 text-primary underline text-xs"
              >
                clear filters
              </button>
            </div>
          ) : (
            <table className="w-full text-xs border-collapse">
              <thead className="sticky top-0 bg-background z-10">
                <tr className="border-b bg-muted/50 text-[10px] uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2 text-left w-6" />
                  <th className="px-3 py-2 text-left w-[90px]">Date</th>
                  <th className="px-3 py-2 text-left">Particulars</th>
                  <th className="px-3 py-2 text-left w-[72px]">Type</th>
                  <th className="px-3 py-2 text-right w-[88px] text-blue-700">Debit</th>
                  <th className="px-3 py-2 text-right w-[88px] text-rose-600">Credit</th>
                  <th className="px-3 py-2 text-right w-[96px]">Balance</th>
                  <th className="px-2 py-2 w-[76px]" />
                </tr>
              </thead>
              <tbody>
                {tableItems.map((item, itemIdx) => {
                  // Month header row
                  if (item.kind === "month_header") {
                    return (
                      <tr key={`mh_${itemIdx}`} className="bg-slate-100/80">
                        <td colSpan={8} className="px-3 py-1.5">
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-600">
                              {item.label}
                            </span>
                            <div className="flex gap-3 text-[10px]">
                              {item.drTotal > 0 && (
                                <span className="text-blue-700">
                                  Dr ₹{fmtAmt(item.drTotal)}
                                </span>
                              )}
                              {item.crTotal > 0 && (
                                <span className="text-rose-600">
                                  Cr ₹{fmtAmt(item.crTotal)}
                                </span>
                              )}
                            </div>
                          </div>
                        </td>
                      </tr>
                    );
                  }

                  // Voucher row
                  const { voucher: v, flagged } = item;
                  const isExp = expandedRow === v.id;
                  return [
                    <tr
                      key={v.id}
                      className={cn(
                        "border-b transition-colors cursor-pointer",
                        isExp          ? "bg-blue-50/50" : "",
                        flagged        ? "bg-amber-50/70 hover:bg-amber-50" : !isExp ? "hover:bg-muted/20" : "",
                      )}
                      onClick={() => setExpandedRow(isExp ? null : v.id)}
                    >
                      <td className="px-2 py-2 text-muted-foreground">
                        <div className="flex items-center gap-1">
                          {isExp
                            ? <ChevronDown  size={11} />
                            : <ChevronRight size={11} />}
                          {flagged && (
                            <Zap size={9} className="text-amber-500" />
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                        {fmtDate(v.voucher_date)}
                      </td>
                      <td className="px-3 py-2 font-medium max-w-[140px] truncate">
                        {v.contraLedgers}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground text-[10px]">{v.voucher_type}</td>
                      <td className="px-3 py-2 text-right font-semibold text-blue-700">
                        {v.thisDrCr === "Dr" ? `₹${fmtAmt(v.thisAmount)}` : ""}
                      </td>
                      <td className="px-3 py-2 text-right font-semibold text-rose-600">
                        {v.thisDrCr === "Cr" ? `₹${fmtAmt(v.thisAmount)}` : ""}
                      </td>
                      {/* Running balance */}
                      <td className={cn(
                        "px-3 py-2 text-right text-[10px] font-semibold tabular-nums",
                        v.rbType === "Dr" ? "text-blue-700" : "text-rose-600",
                      )}>
                        {v.runningBalance !== undefined
                          ? <>₹{fmtAmt(v.runningBalance)} <span className="text-[9px] font-normal">{v.rbType}</span></>
                          : ""}
                      </td>
                      <td className="px-2 py-1.5">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 px-1.5 text-[10px] text-orange-600 hover:bg-orange-50 hover:text-orange-700 whitespace-nowrap"
                          onClick={e => { e.stopPropagation(); handleRaiseForVoucher(v); }}
                        >
                          + Query
                        </Button>
                      </td>
                    </tr>,
                    isExp && (
                      <tr key={`${v.id}-exp`} className="bg-blue-50/30 border-b">
                        <td colSpan={8} className="p-0 pb-1">
                          <div className="mx-8 my-1 rounded border border-blue-100 overflow-hidden text-xs">
                            {v.narration && (
                              <div className="px-3 py-1.5 border-b border-blue-100 bg-white/60 text-muted-foreground">
                                <span className="font-medium text-foreground">Narration: </span>
                                {decodeHtml(v.narration)}
                              </div>
                            )}
                            {v.voucher_number && (
                              <div className="px-3 py-1 border-b border-blue-100 bg-white/40 text-[10px] text-muted-foreground">
                                Voucher #{v.voucher_number}
                              </div>
                            )}
                            <table className="w-full">
                              <thead>
                                <tr className="bg-blue-100/60 text-[10px] uppercase text-muted-foreground">
                                  <th className="text-left px-3 py-1 font-semibold">Ledger</th>
                                  <th className="text-right px-3 py-1 font-semibold">Amount</th>
                                  <th className="text-center px-3 py-1 font-semibold">Dr/Cr</th>
                                </tr>
                              </thead>
                              <tbody>
                                {v.line_items.map((item, idx) => (
                                  <tr
                                    key={idx}
                                    className={cn(
                                      "border-t border-blue-100/60",
                                      item.ledger_name === ledgerName
                                        ? "bg-blue-100/40 font-semibold"
                                        : "bg-white/40"
                                    )}
                                  >
                                    <td className="px-3 py-1">{decodeHtml(item.ledger_name)}</td>
                                    <td className="px-3 py-1 text-right">₹{fmtAmt(item.amount)}</td>
                                    <td className="px-3 py-1 text-center">
                                      <span className={cn("font-bold text-[10px]", item.dr_cr === "Cr" ? "text-rose-600" : "text-blue-700")}>
                                        {item.dr_cr}
                                      </span>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </td>
                      </tr>
                    ),
                  ].filter(Boolean);
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* ── Footer summary ── */}
        {!isLoading && (tbRow || recon) && (
          <div className="border-t bg-muted/30 px-5 py-3 space-y-1 text-xs flex-shrink-0">
            {recon && !recon.reconciled && (
              <div className="flex items-start gap-1.5 text-amber-700 mb-2">
                <AlertTriangle size={13} className="mt-0.5 flex-shrink-0" />
                <span>Variance of ₹{fmtAmt(Math.abs(recon.variance))} — re-run full Tally sync to reconcile.</span>
              </div>
            )}
            <div className="flex justify-between text-muted-foreground">
              <span>Total Dr</span>
              <span className="font-semibold text-blue-700">
                ₹{fmtAmt(recon?.debit_total ?? vouchers.filter(v => v.thisDrCr === "Dr").reduce((s, v) => s + v.thisAmount, 0))}
              </span>
            </div>
            <div className="flex justify-between text-muted-foreground">
              <span>Total Cr</span>
              <span className="font-semibold text-rose-600">
                ₹{fmtAmt(recon?.credit_total ?? vouchers.filter(v => v.thisDrCr === "Cr").reduce((s, v) => s + v.thisAmount, 0))}
              </span>
            </div>
            {tbRow && (
              <div className="flex justify-between font-semibold border-t pt-1 mt-1">
                <span>Closing Balance (Tally)</span>
                <span className={tbRow.balance_type === "Dr" ? "text-blue-700" : "text-rose-600"}>
                  ₹{fmtAmt(tbRow.closing_balance)} {tbRow.balance_type}
                </span>
              </div>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
