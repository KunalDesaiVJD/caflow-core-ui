/**
 * useRequiredDocsMaster — fetch the firm-scoped Required Documents master list.
 *
 * • Used by both the Required Documents Master CRUD page and the QueryCombobox
 *   in the Query Sheet so all firms see their own curated list.
 * • If the table is empty for the firm, the seed list (COMMON_REQUIRED_DOCS)
 *   is used for read-only consumers; the CRUD page calls `seedDefaults()` to
 *   write them so the user can edit/delete them.
 */
import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { COMMON_REQUIRED_DOCS } from "@/components/audit-worksheet/QueryCombobox";

export interface RequiredDocMaster {
  id:          string;
  firm_id:     string;
  doc_name:    string;
  description: string | null;
  category:    string | null;
  is_active:   boolean;
  sort_order:  number;
  created_at:  string;
  updated_at:  string;
}

export function useRequiredDocsMaster() {
  const { user } = useAuth();
  const firmId = (user as any)?.firm_id ?? null;
  const [rows, setRows]       = useState<RequiredDocMaster[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!firmId) { setRows([]); setLoading(false); return; }
    setLoading(true);
    const { data, error } = await (supabase as any)
      .from("required_documents_master")
      .select("*")
      .eq("firm_id", firmId)
      .order("sort_order", { ascending: true })
      .order("doc_name",  { ascending: true });
    if (error) setError(error.message);
    setRows((data as RequiredDocMaster[]) ?? []);
    setLoading(false);
  }, [firmId]);

  useEffect(() => { refresh(); }, [refresh]);

  /** Bulk insert COMMON_REQUIRED_DOCS for this firm. Idempotent — uses upsert. */
  const seedDefaults = useCallback(async () => {
    if (!firmId) return;
    const payload = COMMON_REQUIRED_DOCS.map((name, idx) => ({
      firm_id: firmId, doc_name: name, sort_order: idx, is_active: true,
    }));
    await (supabase as any)
      .from("required_documents_master")
      .upsert(payload, { onConflict: "firm_id,doc_name", ignoreDuplicates: true });
    await refresh();
  }, [firmId, refresh]);

  /** Active doc names — what the QueryCombobox shows. Falls back to defaults. */
  const activeNames = rows.filter(r => r.is_active).map(r => r.doc_name);
  const options = activeNames.length > 0 ? activeNames : COMMON_REQUIRED_DOCS;

  return { firmId, rows, options, loading, error, refresh, seedDefaults };
}
