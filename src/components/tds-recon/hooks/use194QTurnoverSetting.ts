/**
 * use194QTurnoverSetting
 *
 * Fetches / sets the auditor's yes-no answer to "did the buyer's PY
 * turnover exceed ₹10 crore?" — the gate that decides whether Section
 * 194Q reconciliation runs at all (Stage 6).
 */
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface Turnover194QSetting {
  turnover_exceeds_10cr: boolean;
  confirmed_by?:  string | null;
  confirmed_at?:  string | null;
}

interface Use194QTurnoverSettingResult {
  setting:  Turnover194QSetting | null;
  loading:  boolean;
  refresh:  () => Promise<void>;
  setAnswer: (exceeds10Cr: boolean) => Promise<void>;
}

export function use194QTurnoverSetting(
  clientId:      string | null | undefined,
  firmId:        string | null | undefined,
  financialYear: string | null | undefined,
): Use194QTurnoverSettingResult {
  const [setting, setSetting] = useState<Turnover194QSetting | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!clientId || !financialYear) { setSetting(null); return; }
    setLoading(true);
    const { data } = await (supabase as any)
      .from("tds_194q_settings")
      .select("turnover_exceeds_10cr,confirmed_by,confirmed_at")
      .eq("client_id",      clientId)
      .eq("financial_year", financialYear)
      .maybeSingle();
    setSetting((data as Turnover194QSetting) ?? null);
    setLoading(false);
  }, [clientId, financialYear]);

  useEffect(() => { load(); }, [load]);

  const setAnswer = useCallback(async (exceeds10Cr: boolean) => {
    if (!clientId || !firmId || !financialYear) return;
    const { error: err } = await (supabase as any)
      .from("tds_194q_settings")
      .upsert({
        client_id: clientId, firm_id: firmId, financial_year: financialYear,
        turnover_exceeds_10cr: exceeds10Cr, confirmed_by: "auditor",
        updated_at: new Date().toISOString(),
      }, { onConflict: "client_id,financial_year" });
    if (err) throw new Error(err.message);
    await load();
  }, [clientId, firmId, financialYear, load]);

  return { setting, loading, refresh: load, setAnswer };
}
