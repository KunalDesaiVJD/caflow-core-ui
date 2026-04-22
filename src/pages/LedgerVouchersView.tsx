import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuditContext } from "@/hooks/useAuditContext";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowLeft, ChevronRight, ChevronDown, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";

// ─── Types ────────────────────────────────────────────────────────────────────

interface LineItem {
  ledger_name: string;
  amount: number;
  dr_cr: string;
}

interface LedgerVoucher {
  id: string;
  voucher_date: string;
  voucher_type: string;
  voucher_number: string;
  narration: string;
  line_items: LineItem[];
  // derived fields
  thisAmount: number;
  thisDrCr: string;
  contraLedgers: string;
}

interface Reconciliation {
  opening_balance: number;
  opening_type: string;
  debit_total: number;
  credit_total: number;
  derived_closing: number;
  derived_closing_type: string;
  tally_closing: number;
  tally_closing_type: string;
  variance: number;
  reconciled: boolean;
  voucher_count: number;
}

interface TBRow {
  opening_balance: number;
  opening_type: string;
  closing_balance: number;
  balance_type: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Sync agent stores dr_cr in correct Tally convention (verified: the custom
// TDL REPORT's $IsDr branch and the voucher fetcher's ISDEEMEDPOSITIVE
// mapping both produce Dr/Cr matching Tally Prime's Ledger Vouchers display).
// Earlier assumption that storage was inverted led to double-flip bugs —
// do NOT introduce client-side Dr/Cr flipping in this file.

function decodeHtml(str: string | null | undefined): string {
  if (!str) return "";
  return str
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&#\d+;/g, "");
}

function fmtAmt(n: number): string {
  return n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDateDisplay(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function LedgerVouchersView() {
  const { ledgerName: encodedName } = useParams<{ ledgerName: string }>();
  const ledgerName = encodedName ? decodeURIComponent(encodedName) : "";
  const navigate   = useNavigate();
  const { selectedEngagementId, selectedEngagement } = useAuditContext();

  const [vouchers,     setVouchers]     = useState<LedgerVoucher[]>([]);
  const [tbRow,        setTbRow]        = useState<TBRow | null>(null);
  const [recon,        setRecon]        = useState<Reconciliation | null>(null);
  const [loading,      setLoading]      = useState(true);
  const [engId,        setEngId]        = useState<string | null>(null);
  const [expandedRow,  setExpandedRow]  = useState<string | null>(null);

  // Resolve the tally engagement_id (same logic as TallySyncPage)
  useEffect(() => {
    async function resolveEngId() {
      if (!selectedEngagement) return;
      const clientId = (selectedEngagement as any).client_id;
      const fy       = (selectedEngagement as any).financial_year;
      let id: string | null = null;

      if (clientId && fy) {
        const { data } = await supabase
          .from("engagements" as any)
          .select("id")
          .eq("client_id", clientId)
          .eq("financial_year", fy)
          .maybeSingle();
        id = (data as any)?.id ?? null;
      }
      if (!id && clientId) {
        const { data } = await supabase
          .from("tally_groups" as any)
          .select("engagement_id")
          .eq("client_id", clientId)
          .limit(1)
          .maybeSingle();
        id = (data as any)?.engagement_id ?? null;
      }
      setEngId(id);
    }
    resolveEngId();
  }, [selectedEngagement]);

  // Load vouchers for this ledger and the TB row
  useEffect(() => {
    if (!engId || !ledgerName) { setLoading(false); return; }
    setLoading(true);
    async function load() {
      // Fetch TB row for opening/closing balance
      const { data: tb } = await supabase
        .from("tally_trial_balance" as any)
        .select("opening_balance,opening_type,closing_balance,balance_type")
        .eq("engagement_id", engId!)
        .eq("ledger_name", ledgerName)
        .maybeSingle();
      setTbRow(tb as TBRow | null);

      // Fetch vouchers via RPC — the new RPC returns `this_amount` / `this_dr_cr`
      // already aggregated server-side (sums ALL line_items matching the ledger,
      // and falls back to voucher-level amount when line_items are empty).
      const { data: vchData, error } = await (supabase as any).rpc("get_ledger_vouchers", {
        p_engagement_id: engId,
        p_ledger_name:   ledgerName,
      });

      if (!error && vchData) {
        const processed: LedgerVoucher[] = (vchData as any[]).map(v => {
          const rawItems: LineItem[] = Array.isArray(v.line_items) ? v.line_items : [];
          let items: LineItem[] = rawItems;

          // Fallback legs for display when line_items was empty
          if (items.length === 0 && v.amount != null && v.party_ledger) {
            const thisIsParty = v.party_ledger === ledgerName;
            const side: LineItem = {
              ledger_name: ledgerName,
              amount: Number(v.amount) || 0,
              dr_cr: thisIsParty ? v.dr_cr : v.dr_cr === "Dr" ? "Cr" : "Dr",
            };
            const contra: LineItem = {
              ledger_name: thisIsParty ? decodeHtml(v.voucher_type) || "(contra)" : v.party_ledger,
              amount: Number(v.amount) || 0,
              dr_cr: side.dr_cr === "Dr" ? "Cr" : "Dr",
            };
            items = [side, contra];
          }

          // Prefer server-computed this_amount / this_dr_cr, fall back to
          // aggregating all matching legs client-side. Dr/Cr from the RPC
          // is already in Tally convention (no client-side flip).
          let thisAmount = Number(v.this_amount ?? 0);
          let thisDrCr: string = String(v.this_dr_cr ?? "Dr");
          if (!thisAmount) {
            const matched = items.filter(i => i.ledger_name === ledgerName);
            const dr = matched.filter(i => i.dr_cr === "Dr").reduce((s, i) => s + i.amount, 0);
            const cr = matched.filter(i => i.dr_cr === "Cr").reduce((s, i) => s + i.amount, 0);
            thisAmount = Math.max(dr, cr);
            thisDrCr   = dr >= cr ? "Dr" : "Cr";
          }

          const contras = items.filter(i => i.ledger_name !== ledgerName).map(i => decodeHtml(i.ledger_name));
          const contraLedgers = contras.length > 0
            ? contras[0] + (contras.length > 1 ? ` (+${contras.length - 1} more)` : "")
            : decodeHtml(v.voucher_type);
          return { ...v, line_items: items, thisAmount, thisDrCr, contraLedgers };
        });
        setVouchers(processed);
      }

      // Pull authoritative reconciliation from the server
      const { data: rec } = await (supabase as any).rpc("get_ledger_reconciliation", {
        p_engagement_id: engId,
        p_ledger_name:   ledgerName,
      });
      if (Array.isArray(rec) && rec.length > 0) {
        // RPC returns values in Tally convention (post-migration
        // 20260422120000 that removed the spurious _tally_flip). The server
        // already computes derived_closing, tally_closing, and variance;
        // only recompute `reconciled` locally with a tighter tolerance.
        const r = { ...(rec[0] as Reconciliation) };
        r.reconciled = Math.abs(r.variance) < 0.01;
        setRecon(r);
      }

      setLoading(false);
    }
    load();
  }, [engId, ledgerName]);

  // Computed totals
  const totalDr  = vouchers.filter(v => v.thisDrCr === "Dr").reduce((s, v) => s + v.thisAmount, 0);
  const totalCr  = vouchers.filter(v => v.thisDrCr === "Cr").reduce((s, v) => s + v.thisAmount, 0);
  const opening  = tbRow ? tbRow.opening_balance * (tbRow.opening_type === "Dr" ? 1 : -1) : 0;
  const closing  = opening + totalDr - totalCr;
  const closingAbs  = Math.abs(closing);
  const closingType = closing >= 0 ? "Dr" : "Cr";

  const fy = (selectedEngagement as any)?.financial_year ?? "";

  return (
    <div className="p-6 space-y-4 max-w-6xl mx-auto">
      {/* Breadcrumb / back */}
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground hover:text-foreground" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>
        <span className="text-muted-foreground text-sm">/ Tally Sync /</span>
        <span className="text-sm font-medium text-foreground">{decodeHtml(ledgerName)}</span>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">{decodeHtml(ledgerName)}</CardTitle>
          <CardDescription>
            Ledger Vouchers · {fy ? `FY ${fy}` : ""}
            {tbRow && (
              <span className="ml-3 text-xs">
                Opening:{" "}
                <span className={tbRow.opening_type === "Dr" ? "text-blue-700 font-medium" : "text-rose-600 font-medium"}>
                  {fmtAmt(tbRow.opening_balance)} {tbRow.opening_type}
                </span>
                {" · "}Closing:{" "}
                <span className={tbRow.balance_type === "Dr" ? "text-blue-700 font-medium" : "text-rose-600 font-medium"}>
                  {fmtAmt(tbRow.closing_balance)} {tbRow.balance_type}
                </span>
              </span>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-6 text-sm text-muted-foreground">Loading…</div>
          ) : vouchers.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground">
              No vouchers found for this ledger.
              {!engId && " (Tally sync not set up — run node auto-setup.js first.)"}
            </div>
          ) : (
            <>
              <div className="overflow-auto max-h-[580px]">
                <Table>
                  <TableHeader className="sticky top-0 bg-background z-10">
                    <TableRow>
                      <TableHead className="w-6" />
                      <TableHead className="w-[110px]">Date</TableHead>
                      <TableHead>Particulars</TableHead>
                      <TableHead>Vch Type</TableHead>
                      <TableHead>No.</TableHead>
                      <TableHead className="text-right w-[130px] text-blue-700">Debit</TableHead>
                      <TableHead className="text-right w-[130px] text-rose-600">Credit</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {vouchers.map(v => {
                      const isExpanded = expandedRow === v.id;
                      return (
                        <>
                          <TableRow
                            key={v.id}
                            className={cn("text-xs cursor-pointer", isExpanded ? "bg-blue-50/50" : "hover:bg-muted/20")}
                            onClick={() => setExpandedRow(isExpanded ? null : v.id)}
                          >
                            <TableCell className="px-2">
                              {isExpanded
                                ? <ChevronDown  className="h-3.5 w-3.5 text-muted-foreground" />
                                : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
                            </TableCell>
                            <TableCell className="whitespace-nowrap">{fmtDateDisplay(v.voucher_date)}</TableCell>
                            <TableCell className="font-medium">{v.contraLedgers}</TableCell>
                            <TableCell className="text-muted-foreground">{v.voucher_type}</TableCell>
                            <TableCell className="text-muted-foreground">{v.voucher_number || "—"}</TableCell>
                            <TableCell className="text-right font-semibold text-blue-700">
                              {v.thisDrCr === "Dr" ? fmtAmt(v.thisAmount) : ""}
                            </TableCell>
                            <TableCell className="text-right font-semibold text-rose-600">
                              {v.thisDrCr === "Cr" ? fmtAmt(v.thisAmount) : ""}
                            </TableCell>
                          </TableRow>
                          {/* Expanded full voucher */}
                          {isExpanded && (
                            <TableRow key={`${v.id}-expand`} className="bg-blue-50/30">
                              <TableCell colSpan={7} className="p-0 pb-1">
                                <div className="mx-8 my-1 rounded border border-blue-100 overflow-hidden text-xs">
                                  {v.narration && (
                                    <div className="px-3 py-1.5 border-b border-blue-100 bg-white/60 text-muted-foreground">
                                      <span className="font-medium text-foreground">Narration: </span>{decodeHtml(v.narration)}
                                    </div>
                                  )}
                                  <table className="w-full">
                                    <thead>
                                      <tr className="bg-blue-100/60 text-[10px] uppercase tracking-wide text-muted-foreground">
                                        <th className="text-left px-3 py-1.5 font-semibold">Ledger</th>
                                        <th className="text-right px-3 py-1.5 font-semibold">Amount</th>
                                        <th className="text-center px-3 py-1.5 font-semibold">Dr/Cr</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {v.line_items.map((item, idx) => (
                                        <tr key={idx} className={cn("border-t border-blue-100/60", item.ledger_name === ledgerName ? "bg-blue-100/40 font-semibold" : "bg-white/40")}>
                                          <td className="px-3 py-1.5">
                                            <button
                                              className="text-left hover:underline hover:text-blue-700 transition-colors"
                                              onClick={e => { e.stopPropagation(); navigate(`/audit/tally-sync/ledger/${encodeURIComponent(item.ledger_name)}`); }}
                                            >
                                              {decodeHtml(item.ledger_name)}
                                            </button>
                                          </td>
                                          <td className="px-3 py-1.5 text-right">{fmtAmt(item.amount)}</td>
                                          <td className="px-3 py-1.5 text-center">
                                            <span className={cn("font-bold text-[10px]", item.dr_cr === "Cr" ? "text-rose-600" : "text-blue-700")}>
                                              {item.dr_cr}
                                            </span>
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
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

              {/* Reconciliation banner — only shows when Tally ≠ computed */}
              {recon && !recon.reconciled && (
                <div className="px-6 pt-4">
                  <Alert variant="destructive" className="border-amber-300 bg-amber-50 text-amber-900">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertTitle>Variance of {fmtAmt(Math.abs(recon.variance))} between computed and Tally closing</AlertTitle>
                    <AlertDescription className="text-xs leading-relaxed">
                      The sync captured {recon.voucher_count} vouchers touching this ledger, summing to Dr {fmtAmt(recon.debit_total)} / Cr {fmtAmt(recon.credit_total)}.
                      Tally's own closing balance ({fmtAmt(recon.tally_closing)} {recon.tally_closing_type}) is the authoritative figure.
                      The gap usually means some Tally legs weren't captured — most commonly <b>contra / journal entries whose party is the bank or another ledger</b> (so the sync agent's "party_ledger" filter misses the customer's leg) or <b>line_items JSONB was not populated for this voucher type</b>.
                      Re-run a <b>full Tally sync</b> (not incremental) after confirming the sync agent exports complete <code>line_items</code>; this page will reconcile automatically once every voucher leg is captured.
                    </AlertDescription>
                  </Alert>
                </div>
              )}

              {/* Summary footer — prefers the server-side reconciliation totals */}
              <div className="border-t bg-muted/40 px-6 py-3 space-y-1 text-xs">
                {(recon || tbRow) && (
                  <div className="flex justify-between text-muted-foreground">
                    <span>Opening Balance</span>
                    <span className={cn("font-semibold",
                      (recon?.opening_type ?? tbRow?.opening_type) === "Dr" ? "text-blue-700" : "text-rose-600")}>
                      {fmtAmt(recon?.opening_balance ?? tbRow?.opening_balance ?? 0)} {recon?.opening_type ?? tbRow?.opening_type}
                    </span>
                  </div>
                )}
                <div className="flex justify-between text-muted-foreground">
                  <span>Total Debit Transactions</span>
                  <span className="font-semibold text-blue-700">{fmtAmt(recon?.debit_total ?? totalDr)}</span>
                </div>
                <div className="flex justify-between text-muted-foreground">
                  <span>Total Credit Transactions</span>
                  <span className="font-semibold text-rose-600">{fmtAmt(recon?.credit_total ?? totalCr)}</span>
                </div>
                {tbRow && (
                  <div className="flex justify-between font-semibold border-t pt-1 mt-1">
                    <span>Closing Balance (from Tally — authoritative)</span>
                    <span className={tbRow.balance_type === "Dr" ? "text-blue-700" : "text-rose-600"}>
                      {fmtAmt(tbRow.closing_balance)} {tbRow.balance_type}
                    </span>
                  </div>
                )}
                {recon && (
                  <div className="flex justify-between text-muted-foreground">
                    <span>Closing Balance (derived from vouchers)</span>
                    <span className={cn("font-semibold",
                      recon.derived_closing_type === "Dr" ? "text-blue-700" : "text-rose-600",
                      !recon.reconciled && "line-through opacity-70"
                    )}>
                      {fmtAmt(recon.derived_closing)} {recon.derived_closing_type}
                    </span>
                  </div>
                )}
                {recon && !recon.reconciled && (
                  <div className="flex justify-between border-t pt-1 font-semibold text-amber-700">
                    <span>Variance (derived − Tally)</span>
                    <span>{recon.variance >= 0 ? "+" : ""}{fmtAmt(recon.variance)}</span>
                  </div>
                )}
                {recon && recon.reconciled && (
                  <div className="flex justify-between border-t pt-1 font-semibold text-emerald-700">
                    <span>✓ Reconciled with Tally</span>
                    <span>Match</span>
                  </div>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
