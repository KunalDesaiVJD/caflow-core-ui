/**
 * Forensics panel (Phase 5, Ticket 5.1 — v2 behind the flag).
 *
 * Runs Benford's-Law and duplicate-payment analysis over the client's voucher-level data
 * (trial_balance_snapshots.raw_data). Reads gracefully: if no snapshot/vouchers are present it
 * shows a notice instead of crashing.
 */

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Info, BarChart3, Copy, Network } from "lucide-react";
import { vouchersFromSnapshot } from "@/lib/scrutiny/adapters";
import { benfordAnalysis, findDuplicates, type BenfordVerdict } from "@/lib/scrutiny/forensics";
import { moneyFlowSummary } from "@/lib/scrutiny/moneyFlow";
import type { VoucherRow } from "@/lib/scrutiny/detectionEngine";

interface Props {
  clientId: string;
  financialYear: string;
}

const VERDICT: Record<BenfordVerdict, { label: string; cls: string }> = {
  close: { label: "Close conformance", cls: "bg-green-500/15 text-green-700 border-green-300" },
  acceptable: { label: "Acceptable conformance", cls: "bg-green-500/15 text-green-700 border-green-300" },
  marginal: { label: "Marginal — review", cls: "bg-amber-500/15 text-amber-700 border-amber-300" },
  nonconforming: { label: "Nonconforming — investigate", cls: "bg-destructive/15 text-destructive border-destructive/40" },
  insufficient: { label: "Insufficient sample", cls: "bg-muted text-muted-foreground border-muted-foreground/30" },
};

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

export default function ScrutinyForensicsPanel({ clientId, financialYear }: Props) {
  const [vouchers, setVouchers] = useState<VoucherRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [reachable, setReachable] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!clientId) { setLoading(false); return; }
      setLoading(true);
      try {
        const { data, error } = await (supabase.from as any)("trial_balance_snapshots")
          .select("raw_data")
          .eq("client_id", clientId).eq("financial_year", financialYear).single();
        if (cancelled) return;
        if (error || !data) { setReachable(false); setVouchers([]); }
        else {
          const raw = Array.isArray(data.raw_data) ? data.raw_data : [];
          setVouchers(vouchersFromSnapshot(raw as never[]));
          setReachable(true);
        }
      } catch { if (!cancelled) setReachable(false); }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [clientId, financialYear]);

  const amounts = useMemo(() => vouchers.map((v) => v.amount ?? 0).filter((n) => Number.isFinite(n)), [vouchers]);
  const benford = useMemo(() => benfordAnalysis(amounts), [amounts]);
  const duplicates = useMemo(() => findDuplicates(vouchers, 1), [vouchers]);
  const flow = useMemo(() => moneyFlowSummary(vouchers, { minAmount: 1, topN: 15 }), [vouchers]);
  const maxBar = useMemo(() => Math.max(30.1, ...benford.digits.map((d) => d.observedPct)), [benford]);

  if (loading) {
    return <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>;
  }

  if (vouchers.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <Info className="h-10 w-10 mx-auto mb-3" />
        <p>No voucher-level data available for forensics.{!reachable && " (Trial-balance snapshot not reachable — sync Tally / apply the snapshot to this database.)"}</p>
      </div>
    );
  }

  const vd = VERDICT[benford.verdict];

  return (
    <div className="space-y-6">
      {/* Benford's Law */}
      <div>
        <div className="flex items-center gap-2 flex-wrap mb-2">
          <BarChart3 size={16} className="text-muted-foreground" />
          <h3 className="text-sm font-semibold text-foreground">Benford's Law — first-digit distribution</h3>
          <Badge className={vd.cls}>{vd.label}</Badge>
          <span className="text-xs text-muted-foreground">{benford.total} amounts · MAD {benford.mad.toFixed(4)}</span>
        </div>
        <p className="text-xs text-muted-foreground mb-2">Genuine accounting amounts should follow the expected curve. Large deviations can indicate fabricated or manipulated figures — advisory, review before concluding.</p>
        <div className="rounded-md border divide-y">
          {benford.digits.map((d) => (
            <div key={d.digit} className="flex items-center gap-3 px-3 py-1.5 text-xs">
              <span className="w-4 font-mono text-muted-foreground">{d.digit}</span>
              <div className="flex-1 h-3 bg-muted/40 rounded relative">
                <div className="absolute inset-y-0 left-0 rounded bg-primary/70" style={{ width: `${(d.observedPct / maxBar) * 100}%` }} />
                <div className="absolute inset-y-0 w-px bg-foreground/60" style={{ left: `${(d.expectedPct / maxBar) * 100}%` }} title={`expected ${d.expectedPct.toFixed(1)}%`} />
              </div>
              <span className="w-14 text-right">{d.observedPct.toFixed(1)}%</span>
              <span className="w-14 text-right text-muted-foreground">{d.expectedPct.toFixed(1)}%</span>
              <span className={`w-14 text-right ${Math.abs(d.deviation) > 3 ? "text-destructive font-medium" : "text-muted-foreground"}`}>{d.deviation >= 0 ? "+" : ""}{d.deviation.toFixed(1)}</span>
            </div>
          ))}
          <div className="flex items-center gap-3 px-3 py-1 text-[10px] text-muted-foreground">
            <span className="w-4"></span><span className="flex-1">bar = observed · line = expected</span>
            <span className="w-14 text-right">observed</span><span className="w-14 text-right">expected</span><span className="w-14 text-right">dev (pp)</span>
          </div>
        </div>
      </div>

      {/* Duplicate payments */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <Copy size={16} className="text-muted-foreground" />
          <h3 className="text-sm font-semibold text-foreground">Possible duplicate payments</h3>
          <Badge variant={duplicates.length ? "destructive" : "secondary"} className="text-xs">{duplicates.length} group{duplicates.length !== 1 ? "s" : ""}</Badge>
        </div>
        {duplicates.length === 0 ? (
          <p className="text-xs text-muted-foreground">No vouchers share the same amount, date and party.</p>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Party</TableHead>
                  <TableHead className="w-28">Date</TableHead>
                  <TableHead className="w-32 text-right">Amount</TableHead>
                  <TableHead className="w-20 text-right">Repeats</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {duplicates.slice(0, 50).map((g) => (
                  <TableRow key={g.key}>
                    <TableCell className="text-sm truncate max-w-[280px]">{g.party || "—"}</TableCell>
                    <TableCell className="text-xs">{g.date}</TableCell>
                    <TableCell className="text-right text-sm">{inr(g.amount)}</TableCell>
                    <TableCell className="text-right"><Badge variant="destructive" className="text-xs">×{g.count}</Badge></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {duplicates.length > 50 && <div className="px-3 py-2 text-xs text-muted-foreground">Showing top 50 of {duplicates.length} groups.</div>}
          </div>
        )}
      </div>

      {/* Money flow (Ticket 5.2) */}
      <div>
        <div className="flex items-center gap-2 flex-wrap mb-2">
          <Network size={16} className="text-muted-foreground" />
          <h3 className="text-sm font-semibold text-foreground">Money flow — top counterparties</h3>
          <span className="text-xs text-muted-foreground">{flow.parties} parties · {inr(flow.totalValue)} transacted</span>
        </div>
        {flow.topParties.length === 0 ? (
          <p className="text-xs text-muted-foreground">No party-level flows in the voucher data.</p>
        ) : (
          <>
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Counterparty</TableHead>
                    <TableHead className="w-16 text-right">Txns</TableHead>
                    <TableHead className="w-28 text-right">Total</TableHead>
                    <TableHead className="w-24 text-right">Dr</TableHead>
                    <TableHead className="w-24 text-right">Cr</TableHead>
                    <TableHead className="w-28 text-right">Net</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {flow.topParties.map((p) => (
                    <TableRow key={p.party}>
                      <TableCell className="text-sm truncate max-w-[240px]">{p.party}</TableCell>
                      <TableCell className="text-right text-xs">{p.count}</TableCell>
                      <TableCell className="text-right text-sm">{inr(p.total)}</TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground">{inr(p.drTotal)}</TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground">{inr(p.crTotal)}</TableCell>
                      <TableCell className={`text-right text-xs ${p.net < 0 ? "text-destructive" : "text-green-700"}`}>{p.net < 0 ? "−" : "+"}{inr(Math.abs(p.net))}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">Net = Cr − Dr on the row-level leg (positive leans to receipts, negative to payments). The full ledger↔party edge list is available in the data; graph visualisation is a later enhancement.</p>
          </>
        )}
      </div>
    </div>
  );
}
