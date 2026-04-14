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
import { toast } from "sonner";
import { awLoad, awSave } from "@/lib/awStorage";

// ─── Per-row state ───────────────────────────────────────────────────────────

export interface WsRowState {
  extent_text: string;       // free text "MM/YY TO MM/YY"  (rows 1-3, 5-7)
  extent_date: string;       // ISO date for "AS ON" rows  (rows 4, 8, 9)
  date:        string;       // work date (ISO)
  // Legacy single-checker fields — retained for backward-compat / migration
  checked_by_id:   string;
  checked_by_name: string;
  // Multi-checker fields (CP-06)
  checked_by_ids:   string[];
  checked_by_names: string[];
  notes: string;             // 2-3 sub-row area for additional notes
}

export const BLANK_ROW: WsRowState = {
  extent_text: "",
  extent_date: "",
  date:        "",
  checked_by_id:   "",
  checked_by_name: "",
  checked_by_ids:   [],
  checked_by_names: [],
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
    const saved = awLoad<WorksheetSheetData>(engagementId, "worksheet_json");
    if (saved && typeof saved === "object" && Object.keys(saved).length > 0) {
      setData({ rows: { ...saved.rows } });
    }
    setLoaded(true);
  }, [engagementId, loaded]);

  // ── Persist ────────────────────────────────────────────────────────────────
  const persist = useCallback(
    async (snapshot: WorksheetSheetData, silent: boolean) => {
      setSaving(true);
      try {
        awSave(engagementId, "worksheet_json", snapshot);
        if (!silent) toast.success("Audit Worksheet saved");
      } catch (e: any) {
        if (!silent) toast.error(e.message || "Failed to save");
      } finally {
        setSaving(false);
      }
    },
    [engagementId]
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
    (rowId: string): WsRowState => {
      const raw = data.rows[rowId];
      if (!raw) return { ...BLANK_ROW };
      const base: WsRowState = { ...BLANK_ROW, ...raw };
      // Migrate legacy single-checker → arrays
      if ((!base.checked_by_ids || base.checked_by_ids.length === 0) && base.checked_by_id) {
        base.checked_by_ids   = [base.checked_by_id];
        base.checked_by_names = base.checked_by_name ? [base.checked_by_name] : [];
      }
      return base;
    },
    [data.rows]
  );

  return { data, setRowField, patchRow, getRow, manualSave, saving, loaded };
}
