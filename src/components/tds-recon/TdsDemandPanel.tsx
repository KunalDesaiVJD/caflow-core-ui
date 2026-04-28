/**
 * TdsDemandPanel  (Phase TDS-6 — Demand & Interest Calculator)
 *
 * Computes and displays TDS demand from reconciliation flags:
 *   • TDS Shortfall (short_deduction Goal 2 + missing_tds_obligation Goal 3)
 *   • Section 201(1A) interest (1% non-deduction / 1.5% late payment per month)
 *   • Section 234E late filing fee (₹200/day, capped at shortfall)
 *   • Grand total demand
 *
 * Features:
 *   • Computation date picker (default today)
 *   • Conservative / aggressive assumption toggle
 *   • KPI summary row
 *   • Per-item table with expand (shows computation note)
 *   • Status actions: Acknowledge | Raise Dispute | Mark Settled
 *   • Dispute dialog with free-text note
 */
import { useState }       from "react";
import { Button }         from "@/components/ui/button";
import { Badge }          from "@/components/ui/badge";
import { Input }          from "@/components/ui/input";
import { Textarea }       from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  Calculator, ChevronDown, ChevronRight,
  Loader2, AlertTriangle, CheckCircle2,
  MessageSquareWarning, XCircle, InfoIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useTdsDemand, type TdsDemandItem, type ItemStatus } from "./hooks/useTdsDemand";

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  clientId:      string | null | undefined;
  financialYear: string | null | undefined;
}

// ─── Formatters ──────────────────────────────────────────────────────────────

function fmtINR(n: number | null | undefined): string {
  if (n == null) return "—";
  const abs = Math.abs(n);
  if (abs >= 1_00_00_000) return `₹${(n / 1_00_00_000).toFixed(2)} Cr`;
  if (abs >= 1_00_000)    return `₹${(n / 1_00_000).toFixed(2)} L`;
  if (abs >= 1_000)       return `₹${(n / 1_000).toFixed(1)} K`;
  return `₹${n.toLocaleString("en-IN")}`;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }); }
  catch { return iso; }
}

// ─── Sub-components ───────────────────────────────────────────────────────────

const STATUS_META: Record<ItemStatus, { label: string; color: string; icon: React.ReactNode }> = {
  computed:     { label: "Computed",    color: "bg-blue-100 text-blue-700",   icon: <Calculator size={10} /> },
  acknowledged: { label: "Acknowledged",color: "bg-green-100 text-green-700", icon: <CheckCircle2 size={10} /> },
  disputed:     { label: "Disputed",    color: "bg-orange-100 text-orange-700",icon: <MessageSquareWarning size={10} /> },
  settled:      { label: "Settled",     color: "bg-slate-100 text-slate-600", icon: <XCircle size={10} /> },
};

function StatusBadge({ status }: { status: ItemStatus }) {
  const m = STATUS_META[status];
  return (
    <span className={cn("inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded font-medium", m.color)}>
      {m.icon}{m.label}
    </span>
  );
}

function KpiBox({
  label, value, sub, color = "text-slate-700",
}: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="flex-1 min-w-0 text-center py-2 px-3 bg-white rounded-lg border shadow-sm">
      <div className={cn("text-lg font-bold leading-tight truncate", color)}>{value}</div>
      <div className="text-[10px] text-muted-foreground mt-0.5">{label}</div>
      {sub && <div className="text-[9px] text-muted-foreground/70">{sub}</div>}
    </div>
  );
}

// ─── Dispute dialog ───────────────────────────────────────────────────────────

interface DisputeDialogProps {
  item: TdsDemandItem | null;
  onClose: () => void;
  onSubmit: (note: string) => Promise<void>;
}

function DisputeDialog({ item, onClose, onSubmit }: DisputeDialogProps) {
  const [note, setNote] = useState(item?.dispute_note ?? "");
  const [saving, setSaving] = useState(false);

  const handleSubmit = async () => {
    setSaving(true);
    await onSubmit(note);
    setSaving(false);
    onClose();
  };

  return (
    <Dialog open={!!item} onOpenChange={() => onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-sm">Raise Dispute</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            {item?.tb_ledger_name} — {item?.section_code ?? "—"} — {fmtINR(item?.total_demand)}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="text-[11px] font-medium">Computation basis</div>
          <div className="bg-muted rounded p-2 text-[10px] text-muted-foreground">
            {item?.computation_note || "—"}
          </div>
          <Textarea
            placeholder="Explain reason for dispute (e.g. TDS already paid, incorrect rate applied…)"
            value={note}
            onChange={e => setNote(e.target.value)}
            rows={4}
            className="text-xs"
          />
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" size="sm" onClick={onClose} className="text-xs">Cancel</Button>
          <Button size="sm" onClick={handleSubmit} disabled={saving || !note.trim()} className="text-xs gap-1">
            {saving && <Loader2 size={11} className="animate-spin" />}
            Submit Dispute
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Demand row ───────────────────────────────────────────────────────────────

interface DemandRowProps {
  item: TdsDemandItem;
  onAcknowledge: (id: string) => void;
  onDispute:     (item: TdsDemandItem) => void;
  onSettle:      (id: string) => void;
}

function DemandRow({ item, onAcknowledge, onDispute, onSettle }: DemandRowProps) {
  const [expanded, setExpanded] = useState(false);

  const isShort   = item.flag_type === "short_deduction";
  const isMissing = item.flag_type === "missing_tds_obligation";

  return (
    <>
      <tr
        className={cn(
          "border-b hover:bg-muted/30 cursor-pointer text-xs",
          item.item_status === "settled"   && "opacity-50",
          item.item_status === "disputed"  && "bg-orange-50/40",
          item.item_status === "acknowledged" && "bg-green-50/30",
        )}
        onClick={() => setExpanded(e => !e)}
      >
        {/* Expand */}
        <td className="px-2 py-2 w-6 text-muted-foreground">
          {expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        </td>

        {/* Ledger */}
        <td className="px-2 py-2">
          <div className="font-medium text-slate-700 truncate max-w-[140px]">
            {item.tb_ledger_name || "—"}
          </div>
          <div className="text-[9px] text-muted-foreground truncate max-w-[140px]">
            {item.tds_deductee_name || "—"}
          </div>
        </td>

        {/* Type */}
        <td className="px-2 py-2">
          <span className={cn(
            "text-[9px] px-1.5 py-0.5 rounded font-medium",
            isShort   ? "bg-red-100 text-red-700"    : "bg-teal-100 text-teal-700",
          )}>
            {isShort ? "Short Dedn" : "Missing TDS"}
          </span>
          <div className="text-[9px] text-muted-foreground mt-0.5">{item.section_code || "—"}</div>
        </td>

        {/* Shortfall */}
        <td className="px-2 py-2 text-right font-medium text-red-600">
          {fmtINR(item.tds_shortfall)}
        </td>

        {/* 201(1A) */}
        <td className="px-2 py-2 text-right text-amber-700">
          {fmtINR(item.interest_201_1a)}
          {item.interest_months != null && item.interest_months > 0 && (
            <div className="text-[9px] text-muted-foreground">
              {item.interest_months}mo @ {item.interest_rate_pct != null && item.interest_rate_pct > 0
                ? `${item.interest_rate_pct}%` : "mixed"}
            </div>
          )}
        </td>

        {/* 234E */}
        <td className="px-2 py-2 text-right text-orange-600">
          {fmtINR(item.fee_234e)}
          {item.late_filing_days != null && item.late_filing_days > 0 && (
            <div className="text-[9px] text-muted-foreground">{item.late_filing_days} days</div>
          )}
        </td>

        {/* Total */}
        <td className="px-2 py-2 text-right font-bold text-slate-800">
          {fmtINR(item.total_demand)}
        </td>

        {/* Status */}
        <td className="px-2 py-2">
          <StatusBadge status={item.item_status} />
        </td>

        {/* Actions */}
        <td className="px-2 py-2" onClick={e => e.stopPropagation()}>
          <div className="flex gap-1 flex-wrap">
            {item.item_status === "computed" && (
              <button
                className="text-[9px] px-1.5 py-0.5 rounded bg-green-100 text-green-700 hover:bg-green-200"
                onClick={() => onAcknowledge(item.id)}
              >Acknowledge</button>
            )}
            {(item.item_status === "computed" || item.item_status === "acknowledged") && (
              <button
                className="text-[9px] px-1.5 py-0.5 rounded bg-orange-100 text-orange-700 hover:bg-orange-200"
                onClick={() => onDispute(item)}
              >Dispute</button>
            )}
            {item.item_status !== "settled" && (
              <button
                className="text-[9px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 hover:bg-slate-200"
                onClick={() => onSettle(item.id)}
              >Settle</button>
            )}
          </div>
        </td>
      </tr>

      {/* Expanded detail */}
      {expanded && (
        <tr className="bg-muted/20 border-b">
          <td colSpan={9} className="px-4 py-3">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-[10px]">
              <div>
                <div className="text-muted-foreground font-medium">Nature of Payment</div>
                <div>{item.nature_of_payment || "—"}</div>
              </div>
              <div>
                <div className="text-muted-foreground font-medium">Amount Paid (Books)</div>
                <div>{fmtINR(item.amount_paid)}</div>
              </div>
              <div>
                <div className="text-muted-foreground font-medium">Deductible Date (Est.)</div>
                <div>{fmtDate(item.deductible_date)}</div>
              </div>
              <div>
                <div className="text-muted-foreground font-medium">Computation Date</div>
                <div>{fmtDate(item.computation_date)}</div>
              </div>
              <div className="col-span-2 md:col-span-4">
                <div className="text-muted-foreground font-medium mb-0.5">Computation Note</div>
                <div className="bg-white rounded border px-2 py-1.5 text-[10px] text-slate-600">
                  {item.computation_note || "—"}
                </div>
              </div>
              {item.dispute_note && (
                <div className="col-span-2 md:col-span-4">
                  <div className="text-orange-600 font-medium mb-0.5">Dispute Note</div>
                  <div className="bg-orange-50 rounded border border-orange-200 px-2 py-1.5 text-[10px] text-orange-700">
                    {item.dispute_note}
                  </div>
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ─── Main Panel ───────────────────────────────────────────────────────────────

export function TdsDemandPanel({ clientId, financialYear }: Props) {
  const {
    items, loading, running, error, summary,
    runCalculator, updateItemStatus,
  } = useTdsDemand(clientId, financialYear);

  const [computationDate, setComputationDate] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [assumeNotPaid, setAssumeNotPaid] = useState(true);
  const [disputeItem,   setDisputeItem]   = useState<TdsDemandItem | null>(null);
  const [statusFilter,  setStatusFilter]  = useState<ItemStatus | "all">("all");

  const filtered = statusFilter === "all"
    ? items
    : items.filter(i => i.item_status === statusFilter);

  const hasItems = items.length > 0;

  const handleAcknowledge = async (id: string) => {
    await updateItemStatus(id, "acknowledged");
  };
  const handleSettle = async (id: string) => {
    await updateItemStatus(id, "settled");
  };
  const handleDispute = (item: TdsDemandItem) => setDisputeItem(item);
  const handleDisputeSubmit = async (note: string) => {
    if (!disputeItem) return;
    await updateItemStatus(disputeItem.id, "disputed", note);
  };

  const handleRun = async () => {
    await runCalculator({ computationDate, assumeNotPaid });
  };

  return (
    <div className="space-y-4">

      {/* ── Controls ── */}
      <div className="flex flex-wrap items-end gap-3 p-3 bg-muted/40 rounded-lg border">
        <div className="space-y-1">
          <div className="text-[10px] font-medium text-muted-foreground">Computation Date</div>
          <Input
            type="date"
            value={computationDate}
            onChange={e => setComputationDate(e.target.value)}
            className="h-7 text-xs w-40"
          />
        </div>

        <div className="space-y-1">
          <div className="text-[10px] font-medium text-muted-foreground">Interest Assumption</div>
          <div className="flex gap-1">
            <button
              onClick={() => setAssumeNotPaid(true)}
              className={cn(
                "text-[10px] px-2 py-1 rounded border",
                assumeNotPaid
                  ? "bg-red-600 text-white border-red-600"
                  : "bg-white text-muted-foreground hover:border-red-300",
              )}
            >
              Conservative (not paid)
            </button>
            <button
              onClick={() => setAssumeNotPaid(false)}
              className={cn(
                "text-[10px] px-2 py-1 rounded border",
                !assumeNotPaid
                  ? "bg-amber-600 text-white border-amber-600"
                  : "bg-white text-muted-foreground hover:border-amber-300",
              )}
            >
              Optimistic (partially paid)
            </button>
          </div>
        </div>

        <div className="flex-1" />

        <Button
          size="sm"
          onClick={handleRun}
          disabled={running || !clientId || !financialYear}
          className="h-8 text-xs gap-1.5 bg-teal-700 hover:bg-teal-800"
        >
          {running
            ? <><Loader2 size={12} className="animate-spin" /> Computing…</>
            : <><Calculator size={12} /> Compute Demand</>
          }
        </Button>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-xs text-destructive bg-destructive/10 rounded p-2">
          <AlertTriangle size={12} />
          {error}
        </div>
      )}

      {/* ── KPI Summary ── */}
      {hasItems && (
        <div className="flex gap-2 flex-wrap">
          <KpiBox
            label="TDS Shortfall"
            value={fmtINR(summary.shortfallTotal)}
            sub={`${summary.itemCount} item${summary.itemCount !== 1 ? "s" : ""}`}
            color="text-red-600"
          />
          <KpiBox
            label="201(1A) Interest"
            value={fmtINR(summary.interest201Total)}
            sub="on non-deduction / late payment"
            color="text-amber-600"
          />
          <KpiBox
            label="234E Late Fees"
            value={fmtINR(summary.fee234eTotal)}
            sub="₹200/day late filing"
            color="text-orange-600"
          />
          <KpiBox
            label="Grand Total Demand"
            value={fmtINR(summary.grandTotal)}
            sub="Shortfall + Interest + Fees"
            color="text-slate-800"
          />
        </div>
      )}

      {/* ── Breakdown chips ── */}
      {hasItems && (
        <div className="flex gap-3 flex-wrap text-[10px]">
          <div className="flex items-center gap-1.5 bg-red-50 border border-red-200 rounded px-2 py-1">
            <span className="font-medium text-red-600">Short Deduction:</span>
            <span className="text-red-700 font-bold">{fmtINR(summary.shortDeductionAmt)}</span>
          </div>
          <div className="flex items-center gap-1.5 bg-teal-50 border border-teal-200 rounded px-2 py-1">
            <span className="font-medium text-teal-600">Missing TDS:</span>
            <span className="text-teal-700 font-bold">{fmtINR(summary.missingTdsAmt)}</span>
          </div>
          <div className="flex items-center gap-1.5 bg-green-50 border border-green-200 rounded px-2 py-1">
            <span className="font-medium text-green-600">Acknowledged:</span>
            <span className="text-green-700 font-bold">{summary.acknowledged}</span>
          </div>
          <div className="flex items-center gap-1.5 bg-orange-50 border border-orange-200 rounded px-2 py-1">
            <span className="font-medium text-orange-600">Disputed:</span>
            <span className="text-orange-700 font-bold">{summary.disputed}</span>
          </div>
          <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded px-2 py-1">
            <span className="font-medium text-slate-500">Settled:</span>
            <span className="text-slate-600 font-bold">{summary.settled}</span>
          </div>
        </div>
      )}

      {/* ── Status filter ── */}
      {hasItems && (
        <div className="flex gap-1 flex-wrap">
          {(["all", "computed", "acknowledged", "disputed", "settled"] as const).map(s => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={cn(
                "text-[10px] px-2 py-1 rounded border transition-colors",
                statusFilter === s
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-white text-muted-foreground hover:border-muted-foreground/40",
              )}
            >
              {s === "all" ? `All (${items.length})` : `${STATUS_META[s].label} (${items.filter(i => i.item_status === s).length})`}
            </button>
          ))}
        </div>
      )}

      {/* ── Table ── */}
      {loading && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground py-4">
          <Loader2 size={13} className="animate-spin" /> Loading demand items…
        </div>
      )}

      {!loading && !hasItems && (
        <div className="text-center py-10 border rounded-lg bg-muted/20">
          <Calculator size={28} className="mx-auto mb-2 text-muted-foreground/40" />
          <div className="text-sm font-medium text-muted-foreground">No demand computed yet</div>
          <div className="text-xs text-muted-foreground/70 mt-1 max-w-xs mx-auto">
            Run the reconciliation engine (Goal 2 + Goal 3) first, then click "Compute Demand"
            to calculate interest and late fees.
          </div>
        </div>
      )}

      {!loading && hasItems && (
        <div className="border rounded-lg overflow-hidden">
          <div className="bg-teal-700 px-3 py-2 flex items-center gap-2">
            <span className="text-[11px] font-medium text-white">Demand Items</span>
            <span className="text-[9px] bg-white/20 text-white rounded px-1.5 py-0.5">
              {filtered.length} shown
            </span>
            <div className="flex-1" />
            <div className="flex items-center gap-1 text-[9px] text-white/70">
              <InfoIcon size={9} />
              Conservative: TDS assumed not paid to Govt
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-muted/60 border-b text-[10px] text-muted-foreground">
                  <th className="px-2 py-2 w-6" />
                  <th className="px-2 py-2 text-left">Ledger / Deductee</th>
                  <th className="px-2 py-2 text-left">Type</th>
                  <th className="px-2 py-2 text-right">TDS Shortfall</th>
                  <th className="px-2 py-2 text-right">201(1A) Interest</th>
                  <th className="px-2 py-2 text-right">234E Fees</th>
                  <th className="px-2 py-2 text-right font-semibold">Total Demand</th>
                  <th className="px-2 py-2 text-left">Status</th>
                  <th className="px-2 py-2 text-left">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(item => (
                  <DemandRow
                    key={item.id}
                    item={item}
                    onAcknowledge={handleAcknowledge}
                    onDispute={handleDispute}
                    onSettle={handleSettle}
                  />
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-slate-800 text-white text-[11px] font-semibold">
                  <td colSpan={3} className="px-3 py-2">TOTAL ({filtered.length} items)</td>
                  <td className="px-2 py-2 text-right text-red-300">
                    {fmtINR(filtered.reduce((s, i) => s + i.tds_shortfall,   0))}
                  </td>
                  <td className="px-2 py-2 text-right text-amber-300">
                    {fmtINR(filtered.reduce((s, i) => s + i.interest_201_1a, 0))}
                  </td>
                  <td className="px-2 py-2 text-right text-orange-300">
                    {fmtINR(filtered.reduce((s, i) => s + i.fee_234e,        0))}
                  </td>
                  <td className="px-2 py-2 text-right">
                    {fmtINR(filtered.reduce((s, i) => s + i.total_demand,    0))}
                  </td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* ── Statutory note ── */}
      {hasItems && (
        <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded p-3 text-[10px] text-amber-700">
          <AlertTriangle size={11} className="mt-0.5 shrink-0" />
          <div>
            <span className="font-semibold">Disclaimer: </span>
            These are estimated figures for assessment purposes. Interest u/s 201(1A) uses ceiling months
            (each part month = 1 month). Section 234E fee is capped at TDS shortfall amount. Actual demand
            may differ based on specific transaction dates, CPC notices, and applicable CBDT circulars.
            Consult a qualified CA before taking any legal or financial action.
          </div>
        </div>
      )}

      {/* ── Dispute dialog ── */}
      <DisputeDialog
        item={disputeItem}
        onClose={() => setDisputeItem(null)}
        onSubmit={handleDisputeSubmit}
      />
    </div>
  );
}
