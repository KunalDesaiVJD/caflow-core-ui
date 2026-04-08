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
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

// ─── Per-row state ────────────────────────────────────────────────────────────

export interface ChecklistRowState {
  /** Editable particulars — stored but only surfaced for custom rows 21 & 22 */
  particulars: string;
  /** Page number string; empty = blank / document not present */
  page_from:   string;
  page_to:     string;
}

export const BLANK_CHECKLIST_ROW: ChecklistRowState = {
  particulars: "",
  page_from:   "",
  page_to:     "",
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
  const [data, setData]     = useState<ChecklistSheetData>(BLANK_CHECKLIST);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Load ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!engagementId || loaded) return;
    (async () => {
      const { data: row } = await (supabase as any)
        .from("audit_worksheet_master")
        .select("checklist_sheet_json")
        .eq("engagement_id", engagementId)
        .maybeSingle();

      const saved = row?.checklist_sheet_json;
      if (
        saved &&
        typeof saved === "object" &&
        saved.rows &&
        typeof saved.rows === "object"
      ) {
        setData({
          rows:          (saved as ChecklistSheetData).rows,
          dynamicRowIds: (saved as ChecklistSheetData).dynamicRowIds || [],
        });
      }
      setLoaded(true);
    })();
  }, [engagementId, loaded]);

  // ── Persist ───────────────────────────────────────────────────────────────
  const persist = useCallback(
    async (snapshot: ChecklistSheetData, silent: boolean) => {
      setSaving(true);
      try {
        const { error } = await (supabase as any)
          .from("audit_worksheet_master")
          .upsert(
            {
              engagement_id:        engagementId,
              firm_id:              firmId ?? null,
              checklist_sheet_json: snapshot,
              updated_at:           new Date().toISOString(),
            },
            { onConflict: "engagement_id" }
          );
        if (error) throw error;
        if (!silent) toast.success("Checklist saved");
      } catch (e: any) {
        if (!silent) toast.error(e.message || "Failed to save");
      } finally {
        setSaving(false);
      }
    },
    [engagementId, firmId]
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
          rows: { ...prev.rows, [rowId]: { ...prevRow, [field]: value } },
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

  return { data, setRowField, getRow, addRow, manualSave, saving, loaded };
}
