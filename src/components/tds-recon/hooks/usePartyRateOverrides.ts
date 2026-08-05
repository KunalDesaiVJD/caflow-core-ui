/**
 * usePartyRateOverrides
 *
 * Fetches and mutates auditor-confirmed applicable TDS rates for
 * 194C / 194J parties. The reconciliation engine reads from this
 * table BEFORE its auto-detection heuristics, so the auditor's
 * judgement is authoritative on sub-classification (Individual vs
 * Company on 194C, Professional vs Technical on 194J).
 *
 * Table: tds_party_rate_overrides
 * Uniqueness: (client_id, financial_year, tb_ledger_name, tds_deductee_name, section_code)
 */
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface PartyRateOverride {
  id?:                string;
  client_id:          string;
  firm_id:            string;
  financial_year:     string;
  tb_ledger_name:     string;
  tds_deductee_name:  string;
  section_code:       string;
  applicable_rate:    number;
  applicable_nature?: string | null;
  set_by?:            string | null;
  set_at?:            string | null;
}

interface UsePartyRateOverridesResult {
  overrides: PartyRateOverride[];
  loading:   boolean;
  error:     string | null;
  refresh:   () => Promise<void>;
  /** Upsert a batch of overrides at once (used by the modal's Save action). */
  upsertMany: (rows: PartyRateOverride[]) => Promise<void>;
  /** Delete overrides for one party+section pair. */
  clearOne:   (tbLedger: string, deductee: string, section: string) => Promise<void>;
}

export function usePartyRateOverrides(
  clientId:      string | null | undefined,
  financialYear: string | null | undefined,
): UsePartyRateOverridesResult {
  const [overrides, setOverrides] = useState<PartyRateOverride[]>([]);
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!clientId || !financialYear) { setOverrides([]); return; }
    setLoading(true);
    setError(null);
    const { data, error: err } = await (supabase as any)
      .from("tds_party_rate_overrides")
      .select("*")
      .eq("client_id",       clientId)
      .eq("financial_year",  financialYear);
    if (err) setError(err.message);
    else     setOverrides((data as PartyRateOverride[]) ?? []);
    setLoading(false);
  }, [clientId, financialYear]);

  useEffect(() => { load(); }, [load]);

  const upsertMany = useCallback(async (rows: PartyRateOverride[]) => {
    if (rows.length === 0) return;
    const { error: err } = await (supabase as any)
      .from("tds_party_rate_overrides")
      .upsert(
        rows.map(r => ({ ...r, updated_at: new Date().toISOString() })),
        { onConflict: "client_id,financial_year,tb_ledger_name,tds_deductee_name,section_code" },
      );
    if (err) throw new Error(err.message);
    await load();
  }, [load]);

  const clearOne = useCallback(async (
    tbLedger: string, deductee: string, section: string,
  ) => {
    if (!clientId || !financialYear) return;
    const { error: err } = await (supabase as any)
      .from("tds_party_rate_overrides")
      .delete()
      .eq("client_id",         clientId)
      .eq("financial_year",    financialYear)
      .eq("tb_ledger_name",    tbLedger)
      .eq("tds_deductee_name", deductee)
      .eq("section_code",      section);
    if (err) throw new Error(err.message);
    await load();
  }, [clientId, financialYear, load]);

  return { overrides, loading, error, refresh: load, upsertMany, clearOne };
}
