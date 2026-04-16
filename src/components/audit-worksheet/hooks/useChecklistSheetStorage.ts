/**
 * useChecklistSheetStorage
 *
 * Manages the Audit Documentation Checklist (Sheet 6) — 22 fixed rows stored
 * as a JSON object in audit_worksheet_master.checklist_sheet_json (jsonb column).
 *
 * Per-row state: particulars (custom rows only), page_from, page_to.
 * 1-second debounced auto-save on every field change.
 */
import { useState, useEffect, useCallback, useRef } from "react";
import { toast } from "sonner";
import { awLoad, awSave, awLoadFromDB } from "@/lib/awStorage";
import { useAuth } from "@/hooks/useAuth";

// ─── Per-row state ────────────────────────────────────────────────────────────

export interface ChecklistRowState {
  /** Editable particulars — stored but only surfaced for custom rows 21 & 22 */
  particulars: string;
  /** Page number string; empty = blank / document not present */
  page_from:   string;
  page_to:     string;
  /** Supabase Storage path — e.g. checklist/{engId}/{sr}_{filename} */
  file_path:   string;
  /** Original filename for display */
  file_name:   string;
}

export const BLANK_CHECKLIST_ROW: ChecklistRowState = {
  particulars: "",
  page_from:   "",
  page_to:     "",
  file_path:   "",
  file_name:   "",
};

// ─── Full checklist data ──────────────────────────────────────────────────────

export interface ChecklistSheetData {
  rows:          Record<string, ChecklistRowState>;
  /** Issue #11: IDs of dynamically added rows (beyond the static 22) */
  dynamicRowIds: string[];
}

export const BLANK_CHECKLIST: ChecklistSheetData = { rows: {}, dynamicRowIds: [] };

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useChecklistSheetStorage(
  engagementId: string,
  firmId?: string | null
) {
  const { user } = useAuth();
  const [data, setData]     = useState<ChecklistSheetData>(BLANK_CHECKLIST);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Load ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!engagementId || loaded) return;
    setLoaded(true);
    const cached = awLoad<ChecklistSheetData>(engagementId, "checklist_sheet_json");
    if (cached && typeof cached === "object" && cached.rows && typeof cached.rows === "object") {
      setData({ rows: cached.rows, dynamicRowIds: cached.dynamicRowIds || [] });
    }
    awLoadFromDB<ChecklistSheetData>(engagementId, "checklist_sheet_json").then(remote => {
      if (remote && typeof remote === "object" && remote.rows && typeof remote.rows === "object") {
        setData({ rows: remote.rows, dynamicRowIds: remote.dynamicRowIds || [] });
      }
    });
  }, [engagementId, loaded]);

  // ── Persist ───────────────────────────────────────────────────────────────
  const persist = useCallback(
    async (snapshot: ChecklistSheetData, silent: boolean) => {
      setSaving(true);
      try {
        awSave(engagementId, "checklist_sheet_json", snapshot, firmId, user?.id, user?.name || "");
        if (!silent) toast.success("Checklist saved");
      } catch (e: any) {
        if (!silent) toast.error(e.message || "Failed to save");
      } finally {
        setSaving(false);
      }
    },
    [engagementId]
  );

  const debounce = useCallback(
    (next: ChecklistSheetData) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => persist(next, true), 1000);
    },
    [persist]
  );

  // ── setRowField — update one field in one row ────────────────────────────
  const setRowField = useCallback(
    (rowId: string, field: keyof ChecklistRowState, value: string) => {
      setData(prev => {
        const prevRow = prev.rows[rowId] ?? { ...BLANK_CHECKLIST_ROW };
        const next: ChecklistSheetData = {
          rows:          { ...prev.rows, [rowId]: { ...prevRow, [field]: value } },
          dynamicRowIds: prev.dynamicRowIds,
        };
        debounce(next);
        return next;
      });
    },
    [debounce]
  );

  // ── patchRowFields — update multiple row fields atomically ─────────────────
  const patchRowFields = useCallback(
    (rowId: string, patch: Partial<ChecklistRowState>) => {
      setData(prev => {
        const prevRow = prev.rows[rowId] ?? { ...BLANK_CHECKLIST_ROW };
        const next: ChecklistSheetData = {
          rows:          { ...prev.rows, [rowId]: { ...prevRow, ...patch } },
          dynamicRowIds: prev.dynamicRowIds,
        };
        debounce(next);
        return next;
      });
    },
    [debounce]
  );

  const getRow = useCallback(
    (rowId: string): ChecklistRowState =>
      data.rows[rowId] ?? { ...BLANK_CHECKLIST_ROW },
    [data.rows]
  );

  // ── addRow — append a new dynamic row ────────────────────────────────────
  const addRow = useCallback(() => {
    const newId = `dyn_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    setData(prev => {
      const next: ChecklistSheetData = {
        rows:          { ...prev.rows, [newId]: { ...BLANK_CHECKLIST_ROW } },
        dynamicRowIds: [...prev.dynamicRowIds, newId],
      };
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => persist(next, true), 1000);
      return next;
    });
  }, [persist]);

  const manualSave = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    return persist(data, false);
  }, [data, persist]);

  return { data, setRowField, patchRowFields, getRow, addRow, manualSave, saving, loaded };
}
