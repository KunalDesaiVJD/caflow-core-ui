/**
 * LedgerSidePanel
 *
 * A right-side Sheet that shows all vouchers for a specific ledger,
 * plus opening/closing balance and reconciliation status.
 *
 * Has "Raise Query" button per voucher AND a general "Raise Query for Ledger"
 * button at the top.
 *
 * Reuses the voucher-fetching logic from LedgerVouchersView (standalone page)
 * but rendered inline as a panel — no navigation required.
 */
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge }  from "@/components/ui/badge";
import {
  ChevronRight, ChevronDown, MessageSquareWarning, Loader2, AlertTriangle,
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

interface Props {
  open:          boolean;
  ledgerName:    string;
  parentGroup:   string;
  clientId:      string | null | undefined;
  financialYear: string | null | undefined;
  onClose:       () => void;
  /** Called when user wants to raise a query — pre-fills group + ledger (+ optional entry note) */
  onRaiseQuery:  (group: string, ledger: string, entryNote?: string) => void;
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
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

// ─── Component ────────────────────────────────────────────────────────────────

export function LedgerSidePanel({
  open, ledgerName, parentGroup, clientId, financialYear, onClose, onRaiseQuery,
}: Props) {
  const { tallyEngId, loading: resolving } = useTallyEngagementId(clientId, financialYear);

  const [vouchers,    setVouchers]    = useState<LedgerVoucher[]>([]);
  const [tbRow,       setTbRow]       = useState<TBRow | null>(null);
  const [recon,       setRecon]       = useState<Reconciliation | null>(null);
  const [loading,     setLoading]     = useState(false);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);

  // Reset + fetch whenever ledger or panel opens
  useEffect(() => {
    if (!open || !tallyEngId || !ledgerName) return;
    setVouchers([]); setTbRow(null); setRecon(null); setExpandedRow(null);
    setLoading(true);

    async function load() {
      // TB row (opening / closing)
      const { data: tb } = await (supabase as any)
        .from("tally_trial_balance")
        .select("opening_balance,opening_type,closing_balance,balance_type")
        .eq("engagement_id", tallyEngId)
        .eq("ledger_name", ledgerName)
        .maybeSingle();
      setTbRow(tb ?? null);

      // Vouchers via RPC
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
        setVouchers(processed);
      }

      // Reconciliation
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

  const isLoading = resolving || loading;

  return (
    <Sheet open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <SheetContent className="w-full sm:max-w-2xl flex flex-col p-0" side="right">
        {/* ── Header ── */}
        <SheetHeader className="px-5 py-4 border-b bg-muted/30 flex-shrink-0">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <SheetTitle className="text-base truncate">{decodeHtml(ledgerName)}</SheetTitle>
              <SheetDescription className="text-xs mt-0.5">
                {parentGroup && <span className="text-muted-foreground">{parentGroup} · </span>}
                Ledger Vouchers
                {financialYear && ` · FY ${financialYear}`}
              </SheetDescription>
              {tbRow && (
                <div className="flex gap-4 mt-1.5 text-xs">
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
            <div className="p-6 text-sm text-muted-foreground text-center">
              No vouchers found for this ledger.
            </div>
          ) : (
            <table className="w-full text-xs border-collapse">
              <thead className="sticky top-0 bg-background z-10">
                <tr className="border-b bg-muted/50 text-[10px] uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2 text-left w-6" />
                  <th className="px-3 py-2 text-left w-[100px]">Date</th>
                  <th className="px-3 py-2 text-left">Particulars</th>
                  <th className="px-3 py-2 text-left w-[80px]">Type</th>
                  <th className="px-3 py-2 text-right w-[100px] text-blue-700">Debit</th>
                  <th className="px-3 py-2 text-right w-[100px] text-rose-600">Credit</th>
                  <th className="px-2 py-2 w-[80px]" />
                </tr>
              </thead>
              <tbody>
                {vouchers.map(v => {
                  const isExp = expandedRow === v.id;
                  return [
                    <tr
                      key={v.id}
                      className={cn(
                        "border-b transition-colors cursor-pointer",
                        isExp ? "bg-blue-50/50" : "hover:bg-muted/20"
                      )}
                      onClick={() => setExpandedRow(isExp ? null : v.id)}
                    >
                      <td className="px-2 py-2 text-muted-foreground">
                        {isExp
                          ? <ChevronDown  size={12} />
                          : <ChevronRight size={12} />}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                        {fmtDate(v.voucher_date)}
                      </td>
                      <td className="px-3 py-2 font-medium max-w-[160px] truncate">
                        {v.contraLedgers}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{v.voucher_type}</td>
                      <td className="px-3 py-2 text-right font-semibold text-blue-700">
                        {v.thisDrCr === "Dr" ? `₹${fmtAmt(v.thisAmount)}` : ""}
                      </td>
                      <td className="px-3 py-2 text-right font-semibold text-rose-600">
                        {v.thisDrCr === "Cr" ? `₹${fmtAmt(v.thisAmount)}` : ""}
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
                        <td colSpan={7} className="p-0 pb-1">
                          <div className="mx-8 my-1 rounded border border-blue-100 overflow-hidden text-xs">
                            {v.narration && (
                              <div className="px-3 py-1.5 border-b border-blue-100 bg-white/60 text-muted-foreground">
                                <span className="font-medium text-foreground">Narration: </span>
                                {decodeHtml(v.narration)}
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
