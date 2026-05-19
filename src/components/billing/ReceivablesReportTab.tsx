/**
 * ReceivablesReportTab — Sundry Debtors / Group Summary (Tally-style)
 *
 * Opening Balance + Period Debit (invoices) + Period Credit (receipts) = Closing Balance
 * Grouped by entity_type with sub-totals. Grand Total at bottom.
 */
import { useState, useEffect, useMemo, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { format, parseISO } from "date-fns";
import { Download, RefreshCw, Search, X, TrendingUp, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import * as XLSX from "xlsx";

// ─── Types ───────────────────────────────────────────────────────────────────

interface ClientRow {
  id: string;
  name: string;
  entity_type: string;
  openingDr: number;   // invoices before period
  openingCr: number;   // receipts before period
  debit: number;       // invoices in period
  credit: number;      // receipts in period
}

interface GroupSummary {
  entity_type: string;
  rows: ClientRow[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const fmtINR = (n: number) =>
  n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function drCr(net: number): { abs: number; label: "Dr" | "Cr" } {
  return net >= 0
    ? { abs: net,  label: "Dr" }
    : { abs: -net, label: "Cr" };
}

function currentFYStart(): string {
  const today = new Date();
  const fyYear = today.getMonth() >= 3 ? today.getFullYear() : today.getFullYear() - 1;
  return `${fyYear}-04-01`;
}

function today(): string {
  return format(new Date(), "yyyy-MM-dd");
}

const ENTITY_ORDER = [
  "Company", "LLP", "Firm", "Partnership",
  "Trust", "AOP / BOI", "HUF", "Individual", "Other",
];

function normaliseEntity(et: string | null | undefined): string {
  if (!et) return "Other";
  const map: Record<string, string> = {
    company: "Company", llp: "LLP", firm: "Firm",
    partnership: "Firm", trust: "Trust",
    "aop / boi": "AOP / BOI", "aop/boi": "AOP / BOI",
    huf: "HUF", individual: "Individual",
  };
  return map[et.toLowerCase()] ?? et;
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function ReceivablesReportTab() {
  const { user } = useAuth();
  const firmId = user?.firm_id ?? null;

  const [fromDate,  setFromDate]  = useState(currentFYStart());
  const [toDate,    setToDate]    = useState(today());
  const [loading,   setLoading]   = useState(false);
  const [rows,      setRows]      = useState<ClientRow[]>([]);
  const [search,    setSearch]    = useState("");
  const [hideZero,  setHideZero]  = useState(true);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  // ── Fetch ──────────────────────────────────────────────────────────────────

  const fetchReport = useCallback(async () => {
    if (!firmId) return;
    setLoading(true);
    try {
      // 1. All clients for firm
      const { data: clients, error: cErr } = await supabase
        .from("clients")
        .select("id, name, entity_type")
        .eq("firm_id", firmId)
        .order("name");
      if (cErr) throw cErr;

      // 2. All non-voided invoices
      const { data: invoices, error: iErr } = await supabase
        .from("invoices")
        .select("client_id, invoice_date, total_amount")
        .eq("firm_id", firmId)
        .neq("status", "voided");
      if (iErr) throw iErr;

      // 3. All receipts (amount_received + tds_amount = total credit)
      const { data: receipts, error: rErr } = await supabase
        .from("billing_receipts")
        .select("client_id, receipt_date, amount_received, tds_amount")
        .eq("firm_id", firmId);
      if (rErr) throw rErr;

      const built: ClientRow[] = (clients || []).map(c => {
        let openingDr = 0, openingCr = 0, debit = 0, credit = 0;

        for (const inv of invoices || []) {
          if (inv.client_id !== c.id) continue;
          const amt = Number(inv.total_amount || 0);
          if (!amt) continue;
          if (inv.invoice_date && inv.invoice_date < fromDate) {
            openingDr += amt;
          } else if (
            inv.invoice_date &&
            inv.invoice_date >= fromDate &&
            inv.invoice_date <= toDate
          ) {
            debit += amt;
          }
        }

        for (const rec of receipts || []) {
          if (rec.client_id !== c.id) continue;
          const amt = Number(rec.amount_received || 0) + Number(rec.tds_amount || 0);
          if (!amt) continue;
          if (rec.receipt_date && rec.receipt_date < fromDate) {
            openingCr += amt;
          } else if (
            rec.receipt_date &&
            rec.receipt_date >= fromDate &&
            rec.receipt_date <= toDate
          ) {
            credit += amt;
          }
        }

        return { id: c.id, name: c.name || "—", entity_type: normaliseEntity(c.entity_type), openingDr, openingCr, debit, credit };
      });

      setRows(built);
    } catch (e: any) {
      toast.error(e.message || "Failed to load report");
    } finally {
      setLoading(false);
    }
  }, [firmId, fromDate, toDate]);

  useEffect(() => { fetchReport(); }, [fetchReport]);

  // ── Derived ────────────────────────────────────────────────────────────────

  const filtered = useMemo(() => {
    let r = rows;
    if (search) r = r.filter(c => c.name.toLowerCase().includes(search.toLowerCase()));
    if (hideZero) r = r.filter(c => {
      const opening = c.openingDr - c.openingCr;
      const closing = opening + c.debit - c.credit;
      return Math.abs(closing) > 0.005 || c.debit > 0 || c.credit > 0;
    });
    return r;
  }, [rows, search, hideZero]);

  const groups = useMemo<GroupSummary[]>(() => {
    const map: Record<string, ClientRow[]> = {};
    for (const r of filtered) {
      if (!map[r.entity_type]) map[r.entity_type] = [];
      map[r.entity_type].push(r);
    }
    return ENTITY_ORDER
      .filter(et => map[et])
      .map(et => ({ entity_type: et, rows: map[et] }))
      .concat(
        Object.keys(map)
          .filter(et => !ENTITY_ORDER.includes(et))
          .map(et => ({ entity_type: et, rows: map[et] }))
      );
  }, [filtered]);

  const grandTotal = useMemo(() => {
    let openingDr = 0, openingCr = 0, debit = 0, credit = 0;
    for (const r of filtered) {
      openingDr += r.openingDr; openingCr += r.openingCr;
      debit += r.debit; credit += r.credit;
    }
    return { openingDr, openingCr, debit, credit };
  }, [filtered]);

  // ── Export ─────────────────────────────────────────────────────────────────

  function exportXlsx() {
    const data: any[] = [];
    for (const g of groups) {
      const gOpenDr = g.rows.reduce((s, r) => s + r.openingDr, 0);
      const gOpenCr = g.rows.reduce((s, r) => s + r.openingCr, 0);
      const gDebit  = g.rows.reduce((s, r) => s + r.debit, 0);
      const gCredit = g.rows.reduce((s, r) => s + r.credit, 0);
      const gOpenNet = gOpenDr - gOpenCr;
      const gClose   = gOpenNet + gDebit - gCredit;
      data.push({
        Particulars: g.entity_type,
        "Opening Balance": gOpenNet >= 0 ? fmtINR(gOpenNet) + " Dr" : fmtINR(-gOpenNet) + " Cr",
        Debit: fmtINR(gDebit),
        Credit: fmtINR(gCredit),
        "Closing Balance": gClose >= 0 ? fmtINR(gClose) + " Dr" : fmtINR(-gClose) + " Cr",
      });
      for (const r of g.rows) {
        const openNet = r.openingDr - r.openingCr;
        const close   = openNet + r.debit - r.credit;
        data.push({
          Particulars: "  " + r.name,
          "Opening Balance": openNet >= 0 ? fmtINR(openNet) + " Dr" : fmtINR(-openNet) + " Cr",
          Debit: fmtINR(r.debit),
          Credit: fmtINR(r.credit),
          "Closing Balance": close >= 0 ? fmtINR(close) + " Dr" : fmtINR(-close) + " Cr",
        });
      }
    }
    const gtOpenNet = grandTotal.openingDr - grandTotal.openingCr;
    const gtClose   = gtOpenNet + grandTotal.debit - grandTotal.credit;
    data.push({
      Particulars: "Grand Total",
      "Opening Balance": gtOpenNet >= 0 ? fmtINR(gtOpenNet) + " Dr" : fmtINR(-gtOpenNet) + " Cr",
      Debit: fmtINR(grandTotal.debit),
      Credit: fmtINR(grandTotal.credit),
      "Closing Balance": gtClose >= 0 ? fmtINR(gtClose) + " Dr" : fmtINR(-gtClose) + " Cr",
    });

    const ws = XLSX.utils.json_to_sheet(data);
    ws["!cols"] = [{ wch: 40 }, { wch: 18 }, { wch: 16 }, { wch: 16 }, { wch: 18 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Sundry Debtors");
    XLSX.writeFile(wb, `Sundry_Debtors_${fromDate}_to_${toDate}.xlsx`);
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  const gtOpenNet = grandTotal.openingDr - grandTotal.openingCr;
  const gtClose   = gtOpenNet + grandTotal.debit - grandTotal.credit;
  const { abs: gtOpenAbs, label: gtOpenLbl } = drCr(gtOpenNet);
  const { abs: gtCloseAbs, label: gtCloseLbl } = drCr(gtClose);

  return (
    <div className="space-y-4">
      {/* ── Header controls ── */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label className="text-xs">From</Label>
          <Input
            type="date" value={fromDate} onChange={e => setFromDate(e.target.value)}
            className="h-8 text-xs w-36"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">To</Label>
          <Input
            type="date" value={toDate} onChange={e => setToDate(e.target.value)}
            className="h-8 text-xs w-36"
          />
        </div>
        <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={fetchReport} disabled={loading}>
          <RefreshCw size={13} className={cn(loading && "animate-spin")} /> Apply
        </Button>

        <div className="flex-1" />

        {/* Search */}
        <div className="relative w-48">
          <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <Input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search client…"
            className="h-8 pl-8 pr-7 text-xs"
          />
          {search && (
            <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground">
              <X size={11} />
            </button>
          )}
        </div>

        {/* Hide zero */}
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Switch
            id="hide-zero" checked={hideZero}
            onCheckedChange={setHideZero}
            className="scale-75 origin-left"
          />
          <Label htmlFor="hide-zero" className="text-xs cursor-pointer">Hide nil balance</Label>
        </div>

        <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={exportXlsx}>
          <Download size={13} /> Export
        </Button>
      </div>

      {/* ── Report title bar (Tally-style) ── */}
      <div className="rounded-lg border border-[#1A2744]/20 overflow-hidden shadow-sm">
        <div className="bg-[#1A2744] text-white px-4 py-2 text-center">
          <div className="font-semibold text-sm">Sundry Debtors</div>
          <div className="text-xs text-white/70">
            {format(parseISO(fromDate), "d-MMM-yy")} to {format(parseISO(toDate), "d-MMM-yy")}
          </div>
        </div>

        {/* ── Column headers ── */}
        <div className="grid grid-cols-[1fr_160px_120px_120px_160px] bg-muted/60 border-b text-[11px] font-semibold text-muted-foreground px-4 py-2">
          <div>Particulars</div>
          <div className="text-right">Opening Balance</div>
          <div className="text-right">Debit</div>
          <div className="text-right">Credit</div>
          <div className="text-right">Closing Balance</div>
        </div>

        {/* ── Body ── */}
        <div className="divide-y">
          {loading ? (
            Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="grid grid-cols-[1fr_160px_120px_120px_160px] px-4 py-2 gap-2">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-4 w-full ml-auto" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-full ml-auto" />
              </div>
            ))
          ) : groups.length === 0 ? (
            <div className="py-16 text-center text-sm text-muted-foreground">
              <Users className="mx-auto h-10 w-10 mb-3 opacity-20" />
              No data found for selected period.
            </div>
          ) : (
            groups.map(g => {
              const gOpenDr = g.rows.reduce((s, r) => s + r.openingDr, 0);
              const gOpenCr = g.rows.reduce((s, r) => s + r.openingCr, 0);
              const gDebit  = g.rows.reduce((s, r) => s + r.debit, 0);
              const gCredit = g.rows.reduce((s, r) => s + r.credit, 0);
              const gOpenNet = gOpenDr - gOpenCr;
              const gClose   = gOpenNet + gDebit - gCredit;
              const { abs: gOpenAbs, label: gOpenLbl } = drCr(gOpenNet);
              const { abs: gCloseAbs, label: gCloseLbl } = drCr(gClose);
              const isCollapsed = collapsed[g.entity_type];

              return (
                <div key={g.entity_type}>
                  {/* Group header row — amber like Tally */}
                  <button
                    className="w-full grid grid-cols-[1fr_160px_120px_120px_160px] px-4 py-2.5 bg-amber-50 hover:bg-amber-100 text-[12px] font-semibold text-amber-900 transition-colors"
                    onClick={() => setCollapsed(p => ({ ...p, [g.entity_type]: !p[g.entity_type] }))}
                  >
                    <div className="text-left flex items-center gap-1.5">
                      <span className={cn("text-[10px] text-amber-600 transition-transform", isCollapsed && "-rotate-90")}>▼</span>
                      {g.entity_type}
                      <span className="text-[10px] text-amber-600 font-normal ml-1">({g.rows.length})</span>
                    </div>
                    <div className="text-right tabular-nums">
                      {fmtINR(gOpenAbs)}&nbsp;
                      <span className={cn("text-[10px]", gOpenLbl === "Cr" ? "text-green-700" : "text-red-700")}>{gOpenLbl}</span>
                    </div>
                    <div className="text-right tabular-nums">{gDebit > 0 ? fmtINR(gDebit) : "—"}</div>
                    <div className="text-right tabular-nums">{gCredit > 0 ? fmtINR(gCredit) : "—"}</div>
                    <div className="text-right tabular-nums">
                      {fmtINR(gCloseAbs)}&nbsp;
                      <span className={cn("text-[10px]", gCloseLbl === "Cr" ? "text-green-700" : "text-red-700")}>{gCloseLbl}</span>
                    </div>
                  </button>

                  {/* Client rows */}
                  {!isCollapsed && g.rows.map((r, idx) => {
                    const openNet = r.openingDr - r.openingCr;
                    const close   = openNet + r.debit - r.credit;
                    const { abs: openAbs, label: openLbl } = drCr(openNet);
                    const { abs: closeAbs, label: closeLbl } = drCr(close);
                    return (
                      <div
                        key={r.id}
                        className={cn(
                          "grid grid-cols-[1fr_160px_120px_120px_160px] px-4 py-2 text-[12px] hover:bg-blue-50/40 transition-colors",
                          idx % 2 === 0 ? "bg-white" : "bg-slate-50/60"
                        )}
                      >
                        <div className="pl-5 text-foreground truncate">{r.name}</div>
                        <div className="text-right tabular-nums text-muted-foreground">
                          {openNet === 0 ? "—" : (
                            <>
                              {fmtINR(openAbs)}&nbsp;
                              <span className={cn("text-[10px]", openLbl === "Cr" ? "text-green-600" : "text-orange-600")}>{openLbl}</span>
                            </>
                          )}
                        </div>
                        <div className="text-right tabular-nums">{r.debit > 0 ? fmtINR(r.debit) : "—"}</div>
                        <div className="text-right tabular-nums">{r.credit > 0 ? fmtINR(r.credit) : "—"}</div>
                        <div className="text-right tabular-nums font-medium">
                          {close === 0 ? "—" : (
                            <>
                              {fmtINR(closeAbs)}&nbsp;
                              <span className={cn("text-[10px]", closeLbl === "Cr" ? "text-green-600" : "text-orange-600")}>{closeLbl}</span>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>

        {/* ── Grand Total ── */}
        {!loading && groups.length > 0 && (
          <div className="grid grid-cols-[1fr_160px_120px_120px_160px] px-4 py-3 bg-[#1A2744] text-white text-[12px] font-bold">
            <div className="flex items-center gap-1.5">
              <TrendingUp size={13} className="text-orange-400" /> Grand Total
              <span className="text-[10px] font-normal text-white/60 ml-1">({filtered.length} clients)</span>
            </div>
            <div className="text-right tabular-nums">
              {fmtINR(gtOpenAbs)}&nbsp;
              <span className={cn("text-[10px] font-normal", gtOpenLbl === "Cr" ? "text-green-300" : "text-orange-300")}>{gtOpenLbl}</span>
            </div>
            <div className="text-right tabular-nums">{fmtINR(grandTotal.debit)}</div>
            <div className="text-right tabular-nums">{fmtINR(grandTotal.credit)}</div>
            <div className="text-right tabular-nums">
              {fmtINR(gtCloseAbs)}&nbsp;
              <span className={cn("text-[10px] font-normal", gtCloseLbl === "Cr" ? "text-green-300" : "text-orange-300")}>{gtCloseLbl}</span>
            </div>
          </div>
        )}
      </div>

      {/* ── Legend ── */}
      <div className="flex gap-4 text-[11px] text-muted-foreground">
        <span><span className="text-orange-600 font-semibold">Dr</span> = amount owed to firm</span>
        <span><span className="text-green-600 font-semibold">Cr</span> = advance / overpaid</span>
        <span>Click a group row to collapse / expand</span>
      </div>
    </div>
  );
}
