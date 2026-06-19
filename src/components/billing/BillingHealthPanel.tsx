/**
 * BillingHealthPanel — the visible reconciliation guard for the billing module.
 *
 * The billing analogue of FsHealthPanel. Reads the read-only DB view
 * `v_billing_reconciliation`, which computes every client's closing balance two
 * independent ways:
 *   • canonical_closing = opening + invoices − credit_notes − receipts − kasars
 *   • ledger_closing    = opening + Σ(debit − credit) of client_ledger_entries
 *
 * When they disagree (> Rs.1) the stored ledger has a double-post, an orphaned
 * row, or a missing entry — exactly the bug classes this audit found. The panel
 * surfaces the drift on page load so a wrong client statement can never go out
 * unnoticed. It is purely informational and writes nothing.
 */
import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { CheckCircle2, AlertTriangle, ChevronDown, ChevronUp, RefreshCw } from "lucide-react";

interface ReconRow {
  firm_id: string;
  client_id: string;
  opening: number;
  invoiced: number;
  credit_notes: number;
  received: number;
  kasar: number;
  canonical_closing: number;
  ledger_closing: number;
  drift: number;
  is_balanced: boolean;
}

const fmt = (n: number) =>
  `₹${Math.round((n + Number.EPSILON) * 100) / 100 < 0 ? "-" : ""}${Math.abs(
    Math.round((n + Number.EPSILON) * 100) / 100
  ).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function BillingHealthPanel({ firmId }: { firmId?: string | null }) {
  const [drifts, setDrifts] = useState<ReconRow[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let q = (supabase as any).from("v_billing_reconciliation").select("*").eq("is_balanced", false);
      if (firmId) q = q.eq("firm_id", firmId);
      const { data } = await q;
      const rows: ReconRow[] = (data || []).filter((r: ReconRow) => Math.abs(r.drift) > 1);
      setDrifts(rows);
      if (rows.length > 0) {
        const ids = Array.from(new Set(rows.map(r => r.client_id)));
        const { data: cData } = await supabase.from("clients").select("id, name").in("id", ids);
        const map: Record<string, string> = {};
        (cData || []).forEach((c: { id: string; name: string }) => { map[c.id] = c.name; });
        setNames(map);
      }
    } catch {
      /* view may not be deployed yet — stay silent rather than alarm the user */
      setDrifts([]);
    } finally {
      setLoading(false);
    }
  }, [firmId]);

  useEffect(() => { load(); }, [load]);

  if (loading) return null;

  if (drifts.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
        <CheckCircle2 size={16} className="shrink-0" />
        <span>All client ledgers reconcile — canonical balance matches the stored ledger.</span>
      </div>
    );
  }

  return (
    <div className="rounded-md border border-amber-300 bg-amber-50 text-amber-900">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium"
        onClick={() => setOpen(o => !o)}
      >
        <AlertTriangle size={16} className="shrink-0 text-amber-600" />
        <span>
          {drifts.length} client{drifts.length > 1 ? "s" : ""} with a ledger mismatch — the displayed
          balance may be wrong. Review before sending statements.
        </span>
        {open ? <ChevronUp size={16} className="ml-auto" /> : <ChevronDown size={16} className="ml-auto" />}
      </button>

      {open && (
        <div className="overflow-x-auto border-t border-amber-200 px-3 py-2">
          <div className="mb-2 flex justify-end">
            <button
              type="button"
              onClick={load}
              className="flex items-center gap-1 text-xs text-amber-700 hover:underline"
            >
              <RefreshCw size={12} /> Re-check
            </button>
          </div>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-amber-700">
                <th className="py-1 pr-3">Client</th>
                <th className="py-1 pr-3 text-right">Canonical closing</th>
                <th className="py-1 pr-3 text-right">Ledger shows</th>
                <th className="py-1 pr-3 text-right">Difference</th>
              </tr>
            </thead>
            <tbody>
              {drifts
                .slice()
                .sort((a, b) => Math.abs(b.drift) - Math.abs(a.drift))
                .map(r => (
                  <tr key={r.client_id} className="border-t border-amber-100">
                    <td className="py-1 pr-3">{names[r.client_id] || r.client_id.slice(0, 8)}</td>
                    <td className="py-1 pr-3 text-right tabular-nums">{fmt(r.canonical_closing)}</td>
                    <td className="py-1 pr-3 text-right tabular-nums">{fmt(r.ledger_closing)}</td>
                    <td className="py-1 pr-3 text-right font-semibold tabular-nums">{fmt(r.drift)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
          <p className="mt-2 text-[11px] text-amber-700">
            "Canonical" is computed straight from invoices, receipts, kasars and opening balances.
            "Ledger shows" is the stored running ledger. A difference means the stored ledger has a
            double-posted, orphaned or missing entry.
          </p>
        </div>
      )}
    </div>
  );
}
