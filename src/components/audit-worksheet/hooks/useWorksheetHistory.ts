/**
 * useWorksheetHistory — CP-16
 *
 * Logs section-level saves to audit_worksheet_history and retrieves
 * the full history for the Version History panel.
 */
import { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth }  from "@/hooks/useAuth";

export interface WorksheetHistoryEntry {
  id:               string;
  engagement_id:    string;
  section_name:     string;
  page_label:       string | null;
  field_name:       string | null;
  old_value:        string | null;
  new_value:        string | null;
  changed_by:       string | null;
  changed_by_name:  string | null;
  changed_at:       string;
}

export function useWorksheetHistory(engagementId: string) {
  const { user } = useAuth();
  const [history,  setHistory]  = useState<WorksheetHistoryEntry[]>([]);
  const [loading,  setLoading]  = useState(false);

  /** Insert one history row (fire-and-forget; errors are non-fatal). */
  const logSave = useCallback(async (
    sectionName: string,
    pageLabel?:  string,
    fieldName?:  string,
    oldValue?:   string,
    newValue?:   string,
  ) => {
    if (!engagementId || !user) return;
    try {
      await (supabase as any)
        .from("audit_worksheet_history")
        .insert({
          engagement_id:   engagementId,
          section_name:    sectionName,
          page_label:      pageLabel  ?? null,
          field_name:      fieldName  ?? null,
          old_value:       oldValue   ?? null,
          new_value:       newValue   ?? null,
          changed_by:      user.id,
          changed_by_name: user.name || user.email || "Unknown",
        });
    } catch (err) {
      console.warn("[useWorksheetHistory] logSave:", err);
    }
  }, [engagementId, user]);

  /** Fetch the full history for the current engagement (newest first). */
  const fetchHistory = useCallback(async () => {
    if (!engagementId) return;
    setLoading(true);
    try {
      const { data } = await (supabase as any)
        .from("audit_worksheet_history")
        .select("*")
        .eq("engagement_id", engagementId)
        .order("changed_at", { ascending: false })
        .limit(500);
      setHistory(data || []);
    } finally {
      setLoading(false);
    }
  }, [engagementId]);

  return { logSave, fetchHistory, history, loading };
}
