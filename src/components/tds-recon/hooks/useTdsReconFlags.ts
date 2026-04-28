/**
 * useTdsReconFlags
 *
 * Loads and manages tds_recon_flags for a given client + FY.
 * Provides counts by goal / flag_type / status and action helpers.
 */
import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

export type FlagStatus = "pending" | "query_raised" | "accepted" | "disregarded";
export type FlagType =
  | "entry_in_books_not_in_tds"
  | "entry_in_tds_not_in_books"
  | "short_deduction"
  | "over_deduction"
  | "missing_tds_obligation";

export interface TdsReconFlag {
  id: string;
  client_id: string;
  firm_id: string;
  financial_year: string;
  flag_type: FlagType;
  goal_number: number | null;
  tb_ledger_name: string | null;
  tds_deductee_name: string | null;
  section_code: string | null;
  nature_of_payment: string | null;
  // Goal 1 amounts
  book_amount: number | null;
  tds_amount: number | null;
  // Goal 2 amounts
  expected_tds: number | null;
  actual_tds: number | null;
  variance_amount: number | null;
  expected_rate: number | null;
  actual_rate: number | null;
  threshold_amount: number | null;
  // Evidence
  deductee_ids: string[] | null;
  mapping_id: string | null;
  ai_reasoning: string | null;
  ai_confidence: number | null;
  sample_narrations: string[] | null;
  // Lifecycle
  flag_status: FlagStatus;
  query_id: string | null;
  action_note: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface FlagCounts {
  total: number;
  pending: number;
  actioned: number;              // query_raised + accepted + disregarded
  query_raised: number;
  accepted: number;
  disregarded: number;
  // by goal
  goal1: number;
  goal2: number;
  // by type
  in_books_not_tds: number;
  in_tds_not_books: number;
  short_deduction: number;
  over_deduction: number;
}

interface UseTdsReconFlagsResult {
  flags: TdsReconFlag[];
  loading: boolean;
  error: string | null;
  counts: FlagCounts;
  firmId: string | null;
  refresh: () => void;
  updateFlagStatus: (
    id: string,
    status: FlagStatus,
    options?: { note?: string; queryId?: string }
  ) => Promise<void>;
}

export function useTdsReconFlags(
  clientId:      string | null | undefined,
  financialYear: string | null | undefined,
): UseTdsReconFlagsResult {
  const [flags,   setFlags]   = useState<TdsReconFlag[]>([]);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);
  const [firmId,  setFirmId]  = useState<string | null>(null);

  // Resolve firm_id once
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) return;
      (supabase as any)
        .from("firm_users")
        .select("firm_id")
        .eq("user_id", data.user.id)
        .maybeSingle()
        .then(({ data: fu }: any) => { if (fu?.firm_id) setFirmId(fu.firm_id); });
    });
  }, []);

  const load = useCallback(async () => {
    if (!clientId || !financialYear) return;
    setLoading(true);
    setError(null);
    const { data, error: err } = await (supabase as any)
      .from("tds_recon_flags")
      .select("*")
      .eq("client_id", clientId)
      .eq("financial_year", financialYear)
      .order("goal_number")
      .order("ai_confidence", { ascending: false });
    if (err) setError(err.message);
    else setFlags((data ?? []) as TdsReconFlag[]);
    setLoading(false);
  }, [clientId, financialYear]);

  useEffect(() => { load(); }, [load]);

  const counts: FlagCounts = {
    total:           flags.length,
    pending:         flags.filter(f => f.flag_status === "pending").length,
    actioned:        flags.filter(f => f.flag_status !== "pending").length,
    query_raised:    flags.filter(f => f.flag_status === "query_raised").length,
    accepted:        flags.filter(f => f.flag_status === "accepted").length,
    disregarded:     flags.filter(f => f.flag_status === "disregarded").length,
    goal1:           flags.filter(f => f.goal_number === 1).length,
    goal2:           flags.filter(f => f.goal_number === 2).length,
    in_books_not_tds:flags.filter(f => f.flag_type === "entry_in_books_not_in_tds").length,
    in_tds_not_books:flags.filter(f => f.flag_type === "entry_in_tds_not_in_books").length,
    short_deduction: flags.filter(f => f.flag_type === "short_deduction").length,
    over_deduction:  flags.filter(f => f.flag_type === "over_deduction").length,
  };

  const updateFlagStatus = useCallback(async (
    id: string,
    status: FlagStatus,
    options: { note?: string; queryId?: string } = {},
  ) => {
    const patch: Record<string, unknown> = { flag_status: status };
    if (options.note    !== undefined) patch.action_note = options.note;
    if (options.queryId !== undefined) patch.query_id    = options.queryId;

    const { error: err } = await (supabase as any)
      .from("tds_recon_flags")
      .update(patch)
      .eq("id", id);
    if (err) throw new Error(err.message);

    setFlags(prev =>
      prev.map(f =>
        f.id === id
          ? { ...f, flag_status: status, action_note: options.note ?? f.action_note }
          : f,
      ),
    );
  }, []);

  return { flags, loading, error, counts, firmId, refresh: load, updateFlagStatus };
}
