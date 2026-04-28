/**
 * useWorksheetSheetStorage
 *
 * Manages the Audit Work Sheet (Sheet 4) — 9 book-category rows stored as JSON
 * in audit_worksheet_master.worksheet_json (jsonb column).
 *
 * Per-row state: extent (text or date), work date, checked-by, notes.
 * Phase 1 addition: multi-period support via VouchingPeriod[].
 * 1-second debounced auto-save on every field change.
 */
import { useState, useEffect, useCallback, useRef } from "react";
import { toast } from "sonner";
import { awLoad, awSave, awLoadFromDB } from "@/lib/awStorage";
import { useAuth } from "@/hooks/useAuth";

// ─── VouchingPeriod — Phase 1 ────────────────────────────────────────────────
// Each book row can have 0-N periods, each checked by different staff members.
// When periods.length === 0, the legacy single-row fields are used for display.

export interface VouchingPeriod {
  id:             string;
  period_label:   string;         // user-editable: "Q1", "Apr-Jun 25", "Period 1"
  extent_text:    string;         // for "range" extentType: "MM/YY TO MM/YY"
  extent_date:    string;         // for "as_on" extentType: ISO date
  date:           string;         // ISO date — when checking was done
  assigned_ids:   string[];       // staff assigned to this period
  assigned_names: string[];
  status:         "pending" | "done" | "na";
}

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
  notes: string;             // book-level remarks
  // Phase 1: multi-period array (empty = use legacy single-row display)
  periods: VouchingPeriod[];
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
  periods: [],
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
  const { user } = useAuth();
  const [data, setData]     = useState<WorksheetSheetData>(BLANK_WS);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Load ───────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!engagementId || loaded) return;
    setLoaded(true);
    // 1. Instant from localStorage cache
    const cached = awLoad<WorksheetSheetData>(engagementId, "worksheet_json");
    if (cached && typeof cached === "object" && Object.keys(cached.rows ?? {}).length > 0) {
      setData({ rows: { ...cached.rows } });
    }
    // 2. Sync from Supabase for cross-device / cross-user data
    awLoadFromDB<WorksheetSheetData>(engagementId, "worksheet_json").then(remote => {
      if (remote && typeof remote === "object" && Object.keys(remote.rows ?? {}).length > 0) {
        setData({ rows: { ...remote.rows } });
      }
    });
  }, [engagementId, loaded]);

  // ── Persist ────────────────────────────────────────────────────────────────
  const persist = useCallback(
    async (snapshot: WorksheetSheetData, silent: boolean) => {
      setSaving(true);
      try {
        awSave(engagementId, "worksheet_json", snapshot, firmId, user?.id, user?.name || "");
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
      // Ensure periods array always exists
      if (!Array.isArray(base.periods)) base.periods = [];
      return base;
    },
    [data.rows]
  );

  // ── Phase 1: Multi-period helpers ─────────────────────────────────────────

  /** Add a new period to a book row.
   *  If this is the first period AND the row has legacy data,
   *  the legacy extent/date/assigned fields are migrated into it. */
  const addPeriod = useCallback(
    (rowId: string) => {
      setData(prev => {
        const prevRow: WsRowState = prev.rows[rowId]
          ? { ...BLANK_ROW, ...prev.rows[rowId], periods: prev.rows[rowId].periods ?? [] }
          : { ...BLANK_ROW };
        const existing = prevRow.periods;
        const isFirst  = existing.length === 0;

        const newPeriod: VouchingPeriod = {
          id:           crypto.randomUUID(),
          period_label: `Period ${existing.length + 1}`,
          // Migrate legacy single-row data on first period only
          extent_text:    isFirst ? prevRow.extent_text : "",
          extent_date:    isFirst ? prevRow.extent_date : "",
          date:           isFirst ? prevRow.date        : "",
          assigned_ids:   isFirst ? (prevRow.checked_by_ids   ?? []) : [],
          assigned_names: isFirst ? (prevRow.checked_by_names ?? []) : [],
          status: "pending",
        };

        const next: WorksheetSheetData = {
          rows: {
            ...prev.rows,
            [rowId]: { ...prevRow, periods: [...existing, newPeriod] },
          },
        };
        debounce(next);
        return next;
      });
    },
    [debounce],
  );

  /** Patch one or more fields on a specific period. */
  const updatePeriod = useCallback(
    (rowId: string, periodId: string, patch: Partial<VouchingPeriod>) => {
      setData(prev => {
        const prevRow: WsRowState = prev.rows[rowId]
          ? { ...BLANK_ROW, ...prev.rows[rowId], periods: prev.rows[rowId].periods ?? [] }
          : { ...BLANK_ROW };
        const periods = prevRow.periods.map(p =>
          p.id === periodId ? { ...p, ...patch } : p,
        );
        const next: WorksheetSheetData = {
          rows: { ...prev.rows, [rowId]: { ...prevRow, periods } },
        };
        debounce(next);
        return next;
      });
    },
    [debounce],
  );

  /** Remove a period by id. */
  const removePeriod = useCallback(
    (rowId: string, periodId: string) => {
      setData(prev => {
        const prevRow: WsRowState = prev.rows[rowId]
          ? { ...BLANK_ROW, ...prev.rows[rowId], periods: prev.rows[rowId].periods ?? [] }
          : { ...BLANK_ROW };
        const periods = prevRow.periods.filter(p => p.id !== periodId);
        const next: WorksheetSheetData = {
          rows: { ...prev.rows, [rowId]: { ...prevRow, periods } },
        };
        debounce(next);
        return next;
      });
    },
    [debounce],
  );

  return {
    data, setRowField, patchRow, getRow, manualSave, saving, loaded,
    addPeriod, updatePeriod, removePeriod,
  };
}
