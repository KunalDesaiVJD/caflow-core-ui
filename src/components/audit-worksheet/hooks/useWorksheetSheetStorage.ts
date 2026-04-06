/**
 * useWorksheetSheetStorage
 *
 * Manages the Audit Work Sheet (Sheet 4) — 9 book-category rows stored as JSON
 * in audit_worksheet_master.worksheet_json (jsonb column).
 *
 * Per-row state: extent (text or date), work date, checked-by, notes.
 * 1-second debounced auto-save on every field change.
 */
import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

// ─── Per-row state ───────────────────────────────────────────────────────────

export interface WsRowState {
  extent_text: string;       // free text "MM/YY TO MM/YY"  (rows 1-3, 5-7)
  extent_date: string;       // ISO date for "AS ON" rows  (rows 4, 8, 9)
  date:        string;       // work date (ISO)
  checked_by_id:   string;
  checked_by_name: string;
  notes: string;             // 2-3 sub-row area for additional notes
}

export const BLANK_ROW: WsRowState = {
  extent_text: "",
  extent_date: "",
  date:        "",
  checked_by_id:   "",
  checked_by_name: "",
  notes: "",
};

// ─── Full worksheet data ─────────────────────────────────────────────────────

export interface WorksheetSheetData {
  rows: Record<string, WsRowState>;
}

export const BLANK_WS: WorksheetSheetData = { rows: {} };

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useWorksheetSheetStorage(
  engagementId: string,
  firmId?: string | null
) {
  const [data, setData]     = useState<WorksheetSheetData>(BLANK_WS);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Load ───────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!engagementId || loaded) return;
    (async () => {
      const { data: row } = await (supabase as any)
        .from("audit_worksheet_master")
        .select("worksheet_json")
        .eq("engagement_id", engagementId)
        .maybeSingle();

      const saved = row?.worksheet_json;
      if (saved && typeof saved === "object" && Object.keys(saved).length > 0) {
        setData({ rows: { ...(saved as WorksheetSheetData).rows } });
      }
      setLoaded(true);
    })();
  }, [engagementId, loaded]);

  // ── Persist ────────────────────────────────────────────────────────────────
  const persist = useCallback(
    async (snapshot: WorksheetSheetData, silent: boolean) => {
      setSaving(true);
      try {
        const { error } = await (supabase as any)
          .from("audit_worksheet_master")
          .upsert(
            {
              engagement_id:  engagementId,
              firm_id:        firmId ?? null,
              worksheet_json: snapshot,
              updated_at:     new Date().toISOString(),
            },
            { onConflict: "engagement_id" }
          );
        if (error) throw error;
        if (!silent) toast.success("Audit Worksheet saved");
      } catch (e: any) {
        if (!silent) toast.error(e.message || "Failed to save");
      } finally {
        setSaving(false);
      }
    },
    [engagementId, firmId]
  );

  const debounce = useCallback(
    (next: WorksheetSheetData) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => persist(next, true), 1000);
    },
    [persist]
  );

  // ── setRowField — update one field in one row ──────────────────────────────
  const setRowField = useCallback(
    (rowId: string, field: keyof WsRowState, value: string) => {
      setData(prev => {
        const prevRow = prev.rows[rowId] ?? { ...BLANK_ROW };
        const next: WorksheetSheetData = {
          rows: { ...prev.rows, [rowId]: { ...prevRow, [field]: value } },
        };
        debounce(next);
        return next;
      });
    },
    [debounce]
  );

  // ── patchRow — update multiple fields at once ──────────────────────────────
  const patchRow = useCallback(
    (rowId: string, patch: Partial<WsRowState>) => {
      setData(prev => {
        const prevRow = prev.rows[rowId] ?? { ...BLANK_ROW };
        const next: WorksheetSheetData = {
          rows: { ...prev.rows, [rowId]: { ...prevRow, ...patch } },
        };
        debounce(next);
        return next;
      });
    },
    [debounce]
  );

  const manualSave = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    return persist(data, false);
  }, [data, persist]);

  const getRow = useCallback(
    (rowId: string): WsRowState => data.rows[rowId] ?? { ...BLANK_ROW },
    [data.rows]
  );

  return { data, setRowField, patchRow, getRow, manualSave, saving, loaded };
}
