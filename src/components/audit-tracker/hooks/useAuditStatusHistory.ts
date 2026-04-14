/**
 * useAuditStatusHistory
 *
 * Fetches full-row snapshot history for one audit_status row from
 * audit_status_history (JSONB previous_data / new_data per save).
 * Sorted newest-first.
 */
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface HistorySnapshot {
  id:              string;
  audit_status_id: string;
  changed_by:      string | null;
  changed_by_name: string | null;
  changed_at:      string;
  previous_data:   Record<string, any> | null;
  new_data:        Record<string, any> | null;
}

export function useAuditStatusHistory(rowId: string | null) {
  const [snapshots, setSnapshots] = useState<HistorySnapshot[]>([]);
  const [loading,   setLoading]   = useState(false);

  useEffect(() => {
    if (!rowId) { setSnapshots([]); return; }
    setLoading(true);
    (supabase as any)
      .from("audit_status_history")
      .select("*")
      .eq("audit_status_id", rowId)
      .order("changed_at", { ascending: false })
      .then(({ data }: { data: HistorySnapshot[] | null }) => {
        setSnapshots(data || []);
        setLoading(false);
      });
  }, [rowId]);

  return { snapshots, loading };
}
