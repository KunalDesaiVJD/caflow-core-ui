/**
 * useTallyEngagementId
 *
 * Resolves the tally `engagement_id` (used in tally_* tables) from an
 * audit engagement.  The newer Tally desktop agent writes its rows using
 * the AUDIT engagement_id directly, so the audit engagementId itself is
 * usually the right answer.  The legacy lookups below remain as fallbacks
 * for older engagements that still rely on the separate `engagements`
 * table or only carry a `client_id` on `tally_groups`.
 *
 * Resolution order:
 *   0. Probe tally_groups with engagement_id = audit engagement id.
 *      If any row exists, return audit engagementId directly.
 *   1. Legacy engagements table  (client_id + financial_year)
 *   2. tally_groups table (client_id fallback — picks any row)
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

      // 1. Legacy — separate Tally `engagements` table by client + FY
      if (!id && clientId && financialYear) {
        const { data } = await (supabase as any)
          .from("engagements")
          .select("id")
          .eq("client_id", clientId)
          .eq("financial_year", financialYear)
          .maybeSingle();
        id = data?.id ?? null;
      }

      // 2. Fallback — any tally_groups row for this client
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
