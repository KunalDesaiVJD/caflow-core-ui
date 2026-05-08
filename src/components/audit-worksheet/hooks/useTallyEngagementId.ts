/**
 * useTallyEngagementId
 *
 * Resolves the tally `engagement_id` (used in tally_* tables) from the
 * audit engagement's client_id + financial_year.
 *
 * Resolution order:
 *   0. tally_groups / tally_trial_balance probed with auditEngagementId directly
 *      (current sync agent writes tally rows under the audit engagement id)
 *   1. tally_groups (client_id + financial_year) — exact FY match
 *   2. tally_groups (client_id only)              — any synced year fallback
 *
 * NOTE: The old "engagements" table lookup has been removed. That table
 * held stale ids and, when it returned any non-null row, it bypassed the
 * tally_groups resolution — causing "No Tally sync data found" even when
 * voucher data existed. tally_groups is written during every sync and is
 * the single source of truth for which engagement_id a client's tally
 * data lives under.
 */
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

export function useTallyEngagementId(
  clientId: string | null | undefined,
  financialYear: string | null | undefined,
  /** Audit engagement id — preferred lookup key when Tally rows are
   *  written under the same id (current sync agent behaviour). */
  auditEngagementId?: string | null,
) {
  const [tallyEngId, setTallyEngId] = useState<string | null>(null);
  const [loading,    setLoading]    = useState(false);

  useEffect(() => {
    if (!clientId && !auditEngagementId) { setTallyEngId(null); return; }
    let cancelled = false;
    setLoading(true);

    async function resolve() {
      let id: string | null = null;

      // 0. Preferred — if tally_* tables already have data under the audit
      //    engagement id, that IS the tally engagement id.  Probe both
      //    tally_groups and tally_trial_balance because some legacy syncs
      //    only populated one of the two.
      if (auditEngagementId) {
        const { data: g } = await (supabase as any)
          .from("tally_groups")
          .select("engagement_id")
          .eq("engagement_id", auditEngagementId)
          .limit(1)
          .maybeSingle();
        if (g?.engagement_id) {
          id = g.engagement_id;
        } else {
          const { data: tb } = await (supabase as any)
            .from("tally_trial_balance")
            .select("engagement_id")
            .eq("engagement_id", auditEngagementId)
            .limit(1)
            .maybeSingle();
          if (tb?.engagement_id) id = tb.engagement_id;
        }
      }

      // 1. Exact match: client_id + financial_year (handles multiple years per client)
      if (!id && clientId && financialYear) {
        const { data } = await (supabase as any)
          .from("tally_groups")
          .select("engagement_id")
          .eq("client_id", clientId)
          .eq("financial_year", financialYear)
          .limit(1)
          .maybeSingle();
        id = data?.engagement_id ?? null;
      }

      // 2. Fallback — any synced year for this client (handles PY shells and
      //    minor FY string format differences between audit and tally records)
      if (!id && clientId) {
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
  }, [clientId, financialYear, auditEngagementId]);

  return { tallyEngId, loading };
}
