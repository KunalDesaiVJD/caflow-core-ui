/**
 * useTallyEngagementId
 *
 * Resolves the tally `engagement_id` (used in tally_* tables) from the
 * audit engagement's client_id + financial_year.
 *
 * Resolution order (matches LedgerVouchersView):
 *   1. engagements table  (client_id + financial_year)
 *   2. tally_groups table (client_id fallback — picks any row)
 */
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

export function useTallyEngagementId(
  clientId: string | null | undefined,
  financialYear: string | null | undefined
) {
  const [tallyEngId, setTallyEngId] = useState<string | null>(null);
  const [loading,    setLoading]    = useState(false);

  useEffect(() => {
    if (!clientId) { setTallyEngId(null); return; }
    let cancelled = false;
    setLoading(true);

    async function resolve() {
      let id: string | null = null;

      // 1. Try tally engagements table
      if (financialYear) {
        const { data } = await (supabase as any)
          .from("engagements")
          .select("id")
          .eq("client_id", clientId)
          .eq("financial_year", financialYear)
          .maybeSingle();
        id = data?.id ?? null;
      }

      // 2. Fallback — any tally_groups row for this client
      if (!id) {
        const { data } = await (supabase as any)
          .from("tally_groups")
          .select("engagement_id")
          .eq("client_id", clientId)
          .limit(1)
          .maybeSingle();
        id = data?.engagement_id ?? null;
      }

      if (!cancelled) {
        setTallyEngId(id);
        setLoading(false);
      }
    }

    resolve();
    return () => { cancelled = true; };
  }, [clientId, financialYear]);

  return { tallyEngId, loading };
}
