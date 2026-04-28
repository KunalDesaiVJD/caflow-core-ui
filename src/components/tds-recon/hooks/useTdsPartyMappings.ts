/**
 * useTdsPartyMappings
 *
 * Loads tds_tb_party_mappings for a given client + FY.
 * Provides helpers to confirm, reject, or update a mapping.
 */
import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

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
    else setMappings((data ?? []) as TbPartyMapping[]);
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
    patch: Partial<Pick<TbPartyMapping, "tds_deductee_name" | "tds_section_code" | "notes">>,
  ) => {
    const { error: err } = await (supabase as any)
      .from("tds_tb_party_mappings")
      .update({ ...patch, mapped_by: "auditor", mapping_status: "confirmed" })
      .eq("id", id);
    if (err) throw new Error(err.message);
    setMappings(prev =>
      prev.map(m => m.id === id
        ? { ...m, ...patch, mapped_by: "auditor", mapping_status: "confirmed" }
        : m),
    );
  }, []);

  return { mappings, loading, error, counts, firmId, refresh: load, updateStatus, updateMapping };
}
