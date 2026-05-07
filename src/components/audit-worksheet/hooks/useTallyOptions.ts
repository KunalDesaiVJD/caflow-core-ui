/**
 * useTallyOptions — Phase 3A
 *
 * Fetches unique Tally parent groups and ledger names from tally_trial_balance
 * for use as type-ahead suggestions in the Query Sheet.
 *
 * Resolves the tally engagement id internally via useTallyEngagementId so
 * callers only need clientId + financialYear (same as what AuditWorksheetData
 * already provides).
 */
import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useTallyEngagementId } from "./useTallyEngagementId";
import { cleanTallyName } from "@/lib/tallyText";

interface TallyOption {
  name:  string;
  group: string;
}

interface UseTallyOptionsResult {
  groups:            string[];
  ledgers:           TallyOption[];
  getLedgersForGroup:(group: string) => string[];
  hasTallyData:      boolean;
}

export function useTallyOptions(
  clientId:      string | null | undefined,
  financialYear: string | null | undefined,
  /** Audit engagement id — preferred lookup key (sync agent writes here). */
  auditEngagementId?: string | null,
): UseTallyOptionsResult {
  const { tallyEngId } = useTallyEngagementId(clientId, financialYear, auditEngagementId);
  const [raw, setRaw] = useState<TallyOption[]>([]);

  useEffect(() => {
    if (!tallyEngId) return;
    (supabase as any)
      .from("tally_trial_balance")
      .select("ledger_name,parent_group")
      .eq("engagement_id", tallyEngId)
      .order("parent_group")
      .order("ledger_name")
      .then(({ data }: { data: { ledger_name: string; parent_group: string }[] | null }) => {
        if (!data) return;
        setRaw(data.map(r => ({
          name:  cleanTallyName(r.ledger_name),
          group: cleanTallyName(r.parent_group),
        })));
      });
  }, [tallyEngId]);

  const groups = useMemo(
    () => Array.from(new Set(raw.map(r => r.group).filter(Boolean))).sort(),
    [raw],
  );

  const getLedgersForGroup = useMemo(() => (group: string): string[] => {
    const list = group
      ? raw.filter(r => r.group === group).map(r => r.name)
      : raw.map(r => r.name);
    return Array.from(new Set(list)).sort();
  }, [raw]);

  return {
    groups,
    ledgers: raw,
    getLedgersForGroup,
    hasTallyData: raw.length > 0,
  };
}
