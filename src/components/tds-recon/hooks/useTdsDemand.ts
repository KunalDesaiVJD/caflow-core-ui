/**
 * useTdsDemand
 *
 * Loads and manages tds_demand_items for a given client + FY.
 * Also exposes the `runCalculator` action that invokes the edge function.
 */
import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { runDemandCalculator } from "../tdsEngine";

export type ItemStatus = "computed" | "acknowledged" | "disputed" | "settled";

export interface TdsDemandItem {
  id:                string;
  client_id:         string;
  firm_id:           string;
  financial_year:    string;
  flag_id:           string | null;
  flag_type:         string;
  goal_number:       number;
  tb_ledger_name:    string | null;
  tds_deductee_name: string | null;
  section_code:      string | null;
  nature_of_payment: string | null;
  tds_shortfall:     number;
  amount_paid:       number | null;
  deductible_date:   string | null;
  deduction_date:    string | null;
  payment_date:      string | null;
  computation_date:  string | null;
  interest_rate_pct: number | null;
  interest_months:   number | null;
  interest_201_1a:   number;
  late_filing_days:  number | null;
  fee_234e:          number;
  total_demand:      number;
  computation_note:  string | null;
  item_status:       ItemStatus;
  dispute_note:      string | null;
  created_at:        string | null;
  updated_at:        string | null;
}

export interface DemandSummary {
  itemCount:         number;
  // ── Confirmed-only totals (Acknowledged status) ─────────────────────────
  // Headline KPIs reflect only short deductions the auditor has reviewed
  // and confirmed via the "Acknowledge" button.  Per Income Tax Act
  // workflow — the auditor must verify each computed item before it
  // becomes a real demand exposure.
  shortfallTotal:    number;
  interest201Total:  number;
  fee234eTotal:      number;
  grandTotal:        number;
  // ── Computed totals (all items the calculator surfaced) ─────────────────
  // Used as a secondary "of ₹X.X computed" sub-text so the auditor can see
  // the full universe of potential demand pending review.
  shortfallTotalAll:    number;
  interest201TotalAll:  number;
  fee234eTotalAll:      number;
  grandTotalAll:        number;
  acknowledgedCount:    number;
  // by type
  shortDeductionAmt: number;
  missingTdsAmt:     number;
  // by status
  acknowledged:      number;
  disputed:          number;
  settled:           number;
}

interface RunResult {
  items_created:         number;
  shortfall_total:       number;
  interest_201_1a_total: number;
  fee_234e_total:        number;
  grand_total_demand:    number;
  computation_date:      string;
}

interface UseTdsDemandResult {
  items:          TdsDemandItem[];
  loading:        boolean;
  running:        boolean;
  error:          string | null;
  summary:        DemandSummary;
  firmId:         string | null;
  refresh:        () => void;
  runCalculator:  (opts?: { computationDate?: string; assumeNotPaid?: boolean }) => Promise<RunResult | null>;
  updateItemStatus: (id: string, status: ItemStatus, note?: string) => Promise<void>;
}

const EMPTY_SUMMARY: DemandSummary = {
  itemCount: 0,
  shortfallTotal: 0, interest201Total: 0, fee234eTotal: 0, grandTotal: 0,
  shortfallTotalAll: 0, interest201TotalAll: 0, fee234eTotalAll: 0, grandTotalAll: 0,
  acknowledgedCount: 0,
  shortDeductionAmt: 0, missingTdsAmt: 0, acknowledged: 0, disputed: 0, settled: 0,
};

export function useTdsDemand(
  clientId:      string | null | undefined,
  financialYear: string | null | undefined,
): UseTdsDemandResult {
  const [items,   setItems]   = useState<TdsDemandItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [error,   setError]   = useState<string | null>(null);
  const [firmId,  setFirmId]  = useState<string | null>(null);

  // Resolve firm_id
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) return;
      (supabase as any)
        .from("users")
        .select("firm_id")
        .eq("id", data.user.id)
        .maybeSingle()
        .then(({ data: fu }: any) => { if (fu?.firm_id) setFirmId(fu.firm_id); });
    });
  }, []);

  const load = useCallback(async () => {
    if (!clientId || !financialYear) return;
    setLoading(true);
    setError(null);
    const { data, error: err } = await (supabase as any)
      .from("tds_demand_items")
      .select("*")
      .eq("client_id",     clientId)
      .eq("financial_year", financialYear)
      .order("total_demand", { ascending: false });
    if (err) setError(err.message);
    else setItems((data ?? []) as TdsDemandItem[]);
    setLoading(false);
  }, [clientId, financialYear]);

  useEffect(() => { load(); }, [load]);

  // Summary — Issue 2: headline totals (shortfallTotal / interest201Total /
  // fee234eTotal / grandTotal) reflect ONLY items whose short deduction has
  // been Acknowledged (confirmed) by the auditor.  Items still in
  // "computed" / "disputed" / "settled" are excluded from the headline
  // figures.  The "*All" variants retain the full computed totals for
  // sub-text display so the auditor can see how much remains to review.
  const ackItems = items.filter(i => i.item_status === "acknowledged");
  const summary: DemandSummary = {
    itemCount:           items.length,
    // Confirmed-only headline totals
    shortfallTotal:      ackItems.reduce((s, i) => s + i.tds_shortfall,   0),
    interest201Total:    ackItems.reduce((s, i) => s + i.interest_201_1a, 0),
    fee234eTotal:        ackItems.reduce((s, i) => s + i.fee_234e,        0),
    grandTotal:          ackItems.reduce((s, i) => s + i.total_demand,    0),
    acknowledgedCount:   ackItems.length,
    // Universe (all computed items, regardless of status) — for context
    shortfallTotalAll:   items.reduce((s, i) => s + i.tds_shortfall,   0),
    interest201TotalAll: items.reduce((s, i) => s + i.interest_201_1a, 0),
    fee234eTotalAll:     items.reduce((s, i) => s + i.fee_234e,        0),
    grandTotalAll:       items.reduce((s, i) => s + i.total_demand,    0),
    shortDeductionAmt:   items.filter(i => i.flag_type === "short_deduction")
                              .reduce((s, i) => s + i.total_demand, 0),
    missingTdsAmt:       items.filter(i => i.flag_type === "missing_tds_obligation")
                              .reduce((s, i) => s + i.total_demand, 0),
    acknowledged:        ackItems.length,
    disputed:            items.filter(i => i.item_status === "disputed").length,
    settled:             items.filter(i => i.item_status === "settled").length,
  };

  // Run calculator (client-side — no edge function required)
  const runCalculator = useCallback(async (opts: { computationDate?: string; assumeNotPaid?: boolean } = {}) => {
    if (!clientId || !financialYear || !firmId) return null;
    setRunning(true);
    setError(null);
    try {
      const result = await runDemandCalculator({
        client_id:        clientId,
        financial_year:   financialYear,
        firm_id:          firmId,
        computation_date: opts.computationDate,
        assume_not_paid:  opts.assumeNotPaid !== false,
      });
      await load();
      return {
        items_created:         result.items_created,
        shortfall_total:       result.shortfall_total,
        interest_201_1a_total: result.interest_201_1a_total,
        fee_234e_total:        result.fee_234e_total,
        grand_total_demand:    result.grand_total_demand,
        computation_date:      result.computation_date,
      } as RunResult;
    } catch (e: any) {
      setError(e.message);
      return null;
    } finally {
      setRunning(false);
    }
  }, [clientId, financialYear, firmId, load]);

  // Update item status
  const updateItemStatus = useCallback(async (id: string, status: ItemStatus, note?: string) => {
    const patch: Record<string, unknown> = { item_status: status };
    if (note !== undefined) patch.dispute_note = note;
    const { error: err } = await (supabase as any)
      .from("tds_demand_items")
      .update(patch)
      .eq("id", id);
    if (err) throw new Error(err.message);
    setItems(prev =>
      prev.map(i =>
        i.id === id
          ? { ...i, item_status: status, dispute_note: note ?? i.dispute_note }
          : i,
      ),
    );
  }, []);

  return {
    items, loading, running, error, summary, firmId,
    refresh: load, runCalculator, updateItemStatus,
  };
}
