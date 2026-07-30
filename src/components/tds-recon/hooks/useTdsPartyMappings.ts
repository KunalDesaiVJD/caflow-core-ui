/**
 * useTdsPartyMappings
 *
 * Loads tds_tb_party_mappings for a given client + FY.
 * Provides helpers to confirm, reject, or update a mapping.
 */
import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { isPartyLedgerGroup } from "../tdsEngine";

export type MappingStatus = "pending" | "confirmed" | "rejected" | "needs_review";

export interface TbPartyMapping {
  id: string;
  client_id: string;
  firm_id: string;
  financial_year: string;
  tb_ledger_name: string;
  tb_parent_group: string | null;
  tb_total_debit: number | null;
  tds_deductee_name: string;
  tds_section_code: string | null;
  tds_total_amount: number | null;
  /** TDS deducted amount per filing (sum of tds_deductees.tds_amount). Added in migration 20260501000001. */
  tds_tds_amount: number | null;
  tds_filing_ids: string[] | null;
  match_confidence: number | null;
  match_method: string | null;
  ai_reasoning: string | null;
  mapping_status: MappingStatus;
  mapped_by: string | null;
  notes: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface MappingCounts {
  total: number;
  confirmed: number;
  pending: number;
  needs_review: number;
  rejected: number;
}

interface UseTdsPartyMappingsResult {
  mappings: TbPartyMapping[];
  loading: boolean;
  error: string | null;
  counts: MappingCounts;
  firmId: string | null;
  refresh: () => void;
  updateStatus: (id: string, status: MappingStatus, note?: string) => Promise<void>;
  updateMapping: (id: string, patch: Partial<Pick<TbPartyMapping,
    "tds_deductee_name" | "tds_section_code" | "notes"
  >>) => Promise<void>;
}

export function useTdsPartyMappings(
  clientId: string | null | undefined,
  financialYear: string | null | undefined,
): UseTdsPartyMappingsResult {
  const [mappings, setMappings] = useState<TbPartyMapping[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [firmId, setFirmId] = useState<string | null>(null);

  // Resolve firm_id once
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
      .from("tds_tb_party_mappings")
      .select("*")
      .eq("client_id", clientId)
      .eq("financial_year", financialYear)
      .order("match_confidence", { ascending: false });
    if (err) setError(err.message);
    else {
      const all = (data ?? []) as TbPartyMapping[];
      // ── Issue 3 (party-group filter) — same as before ─────────────────────
      const partyOnly = all.filter(m => isPartyLedgerGroup(m.tb_parent_group));

      // ── Issue 3 (name-match >= 70 %) ───────────────────────────────────────
      // The mapper now requires name_score ≥ 70 before storing a row, but old
      // rows may have been stored before that filter existed.  Since name_score
      // is not stored as its own column, we use match_method as a proxy: when
      // the mapper accepted a row at name ≥ 70 %, it appended "name_similarity"
      // to match_method.  Rows lacking that token were stored with a weaker
      // name match and are hidden here.  Manual confirmations bypass the
      // filter — auditors may have intentionally accepted a low-name match.
      const nameMatched = partyOnly.filter(m => {
        if (m.mapped_by === "auditor") return true;
        const methods = (m.match_method || "").split("+");
        return methods.includes("name_similarity");
      });

      // 2026-07-24 — Root cause of Issues 9 & 12: this read-time dedupe was
      // collapsing every extra ledger that pointed at the same deductee
      // (case for Issue 9 — one deductee, several Tally ledgers) AND every
      // extra section for the same deductee (case for Issue 12 — one
      // deductee, both 194C and 194J). The DB uniqueness key already
      // covers (client, fy, tb_ledger, deductee) so surfacing every
      // persisted row is safe. Removed the collapse; every mapping row
      // now reaches the panel, and the recon engine sees them all.
      setMappings(nameMatched);
    }
    setLoading(false);
  }, [clientId, financialYear]);

  useEffect(() => { load(); }, [load]);

  const counts: MappingCounts = {
    total:        mappings.length,
    confirmed:    mappings.filter(m => m.mapping_status === "confirmed").length,
    pending:      mappings.filter(m => m.mapping_status === "pending").length,
    needs_review: mappings.filter(m => m.mapping_status === "needs_review").length,
    rejected:     mappings.filter(m => m.mapping_status === "rejected").length,
  };

  const updateStatus = useCallback(async (
    id: string, status: MappingStatus, note?: string,
  ) => {
    const patch: Record<string, unknown> = { mapping_status: status, mapped_by: "auditor" };
    if (note !== undefined) patch.notes = note;
    const { error: err } = await (supabase as any)
      .from("tds_tb_party_mappings")
      .update(patch)
      .eq("id", id);
    if (err) throw new Error(err.message);
    setMappings(prev =>
      prev.map(m => m.id === id ? { ...m, mapping_status: status, notes: note ?? m.notes } : m),
    );
  }, []);

  const updateMapping = useCallback(async (
    id: string,
    patch: Partial<Pick<TbPartyMapping, "tds_deductee_name" | "tds_section_code" | "notes" | "mapping_status">>,
  ) => {
    // 2026-07-24 — Root cause of Issue 2 ("Edit / Override Mapping cannot
    // change status from Confirmed → Pending"): the earlier implementation
    // OVERWROTE `mapping_status` with "confirmed" on every edit call. Now
    // we honour whatever the caller included in `patch` (including a
    // status change), and only default to "confirmed" when the caller
    // didn't specify one at all.
    const mapping_status = patch.mapping_status ?? "confirmed";
    const persist = { ...patch, mapped_by: "auditor", mapping_status };
    const { error: err } = await (supabase as any)
      .from("tds_tb_party_mappings")
      .update(persist)
      .eq("id", id);
    if (err) throw new Error(err.message);
    setMappings(prev =>
      prev.map(m => m.id === id
        ? { ...m, ...persist }
        : m),
    );
  }, []);

  return { mappings, loading, error, counts, firmId, refresh: load, updateStatus, updateMapping };
}
