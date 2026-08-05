/**
 * useEngagementTdsLedgers
 *
 * Fetches and mutates the auditor-confirmed TDS-payable ledger set for
 * an engagement (Stage 5 / P5-B). When rows exist, discoverTdsLedgers()
 * reads from this table instead of re-running its Layer 1/2/3 heuristics
 * — the auditor's confirmation is authoritative.
 */
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface EngagementTdsLedger {
  id?:             string;
  client_id:       string;
  firm_id:         string;
  financial_year:  string;
  ledger_name:     string;
  parent_group?:   string | null;
  section_code?:   string | null;
  is_active:       boolean;
  confirmed_by?:   string | null;
}

interface UseEngagementTdsLedgersResult {
  ledgers:    EngagementTdsLedger[];
  loading:    boolean;
  error:      string | null;
  refresh:    () => Promise<void>;
  upsertMany: (rows: EngagementTdsLedger[]) => Promise<void>;
  toggleActive: (ledgerName: string, active: boolean) => Promise<void>;
  removeOne: (ledgerName: string) => Promise<void>;
}

export function useEngagementTdsLedgers(
  clientId:      string | null | undefined,
  financialYear: string | null | undefined,
): UseEngagementTdsLedgersResult {
  const [ledgers, setLedgers] = useState<EngagementTdsLedger[]>([]);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!clientId || !financialYear) { setLedgers([]); return; }
    setLoading(true);
    setError(null);
    const { data, error: err } = await (supabase as any)
      .from("engagement_tds_ledgers")
      .select("*")
      .eq("client_id",      clientId)
      .eq("financial_year", financialYear)
      .order("ledger_name");
    if (err) setError(err.message);
    else     setLedgers((data as EngagementTdsLedger[]) ?? []);
    setLoading(false);
  }, [clientId, financialYear]);

  useEffect(() => { load(); }, [load]);

  const upsertMany = useCallback(async (rows: EngagementTdsLedger[]) => {
    if (rows.length === 0) return;
    const { error: err } = await (supabase as any)
      .from("engagement_tds_ledgers")
      .upsert(
        rows.map(r => ({ ...r, updated_at: new Date().toISOString() })),
        { onConflict: "client_id,financial_year,ledger_name" },
      );
    if (err) throw new Error(err.message);
    await load();
  }, [load]);

  const toggleActive = useCallback(async (ledgerName: string, active: boolean) => {
    if (!clientId || !financialYear) return;
    const { error: err } = await (supabase as any)
      .from("engagement_tds_ledgers")
      .update({ is_active: active, updated_at: new Date().toISOString() })
      .eq("client_id",      clientId)
      .eq("financial_year", financialYear)
      .eq("ledger_name",    ledgerName);
    if (err) throw new Error(err.message);
    await load();
  }, [clientId, financialYear, load]);

  const removeOne = useCallback(async (ledgerName: string) => {
    if (!clientId || !financialYear) return;
    const { error: err } = await (supabase as any)
      .from("engagement_tds_ledgers")
      .delete()
      .eq("client_id",      clientId)
      .eq("financial_year", financialYear)
      .eq("ledger_name",    ledgerName);
    if (err) throw new Error(err.message);
    await load();
  }, [clientId, financialYear, load]);

  return { ledgers, loading, error, refresh: load, upsertMany, toggleActive, removeOne };
}
