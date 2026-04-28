/**
 * useTdsDemand
 *
 * Loads and manages tds_demand_items for a given client + FY.
 * Also exposes the `runCalculator` action that invokes the edge function.
 */
import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

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
  shortfallTotal:    number;
  interest201Total:  number;
  fee234eTotal:      number;
  grandTotal:        number;
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
  itemCount: 0, shortfallTotal: 0, interest201Total: 0, fee234eTotal: 0, grandTotal: 0,
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

  // Summary
  const summary: DemandSummary = {
    itemCount:         items.length,
    shortfallTotal:    items.reduce((s, i) => s + i.tds_shortfall,   0),
    interest201Total:  items.reduce((s, i) => s + i.interest_201_1a, 0),
    fee234eTotal:      items.reduce((s, i) => s + i.fee_234e,        0),
    grandTotal:        items.reduce((s, i) => s + i.total_demand,    0),
    shortDeductionAmt: items.filter(i => i.flag_type === "short_deduction")
                            .reduce((s, i) => s + i.total_demand, 0),
    missingTdsAmt:     items.filter(i => i.flag_type === "missing_tds_obligation")
                            .reduce((s, i) => s + i.total_demand, 0),
    acknowledged:      items.filter(i => i.item_status === "acknowledged").length,
    disputed:          items.filter(i => i.item_status === "disputed").length,
    settled:           items.filter(i => i.item_status === "settled").length,
  };

  // Run calculator
  const runCalculator = useCallback(async (opts: { computationDate?: string; assumeNotPaid?: boolean } = {}) => {
    if (!clientId || !financialYear || !firmId) return null;
    setRunning(true);
    setError(null);
    try {
      const { data, error: fnErr } = await (supabase as any).functions.invoke(
        "tds-demand-calculator",
        {
          body: {
            client_id:       clientId,
            financial_year:  financialYear,
            firm_id:         firmId,
            computation_date: opts.computationDate,
            assumptions: {
              assume_not_paid: opts.assumeNotPaid !== false,
            },
          },
        },
      );
      if (fnErr) throw new Error(fnErr.message || "Function error");
      if (data?.error) throw new Error(data.error);
      await load();
      return data as RunResult;
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
