/**
 * useChecklistSheetStorage
 *
 * Manages the Audit Documentation Checklist (Sheet 6) — 22 fixed rows stored
 * as a JSON object in audit_worksheet_master.checklist_sheet_json (jsonb column).
 *
 * Per-row state: particulars (custom rows only), page_from, page_to,
 * and an array of attached files (supports multiple docs per row).
 *
 * Backward-compat: old rows with file_path/file_name strings are
 * automatically migrated into the files[] array on first read.
 */
import { useState, useEffect, useCallback, useRef } from "react";
import { toast } from "sonner";
import { awLoad, awSave, awLoadFromDB } from "@/lib/awStorage";
import { useAuth } from "@/hooks/useAuth";

// ─── Per-row state ────────────────────────────────────────────────────────────

export interface ChecklistFile {
  file_path: string;
  file_name: string;
}

export interface ChecklistRowState {
  /** Editable particulars — stored but only surfaced for custom rows 21 & 22 */
  particulars: string;
  /** Page number string; empty = blank / document not present */
  page_from:   string;
  page_to:     string;
  /**
   * Multiple attached documents per row.
   * Replaces the old single file_path / file_name strings.
   * Old data with file_path/file_name is migrated in normalizeRow().
   */
  files: ChecklistFile[];
  /** Marked as Not Applicable — no document required for this row */
  is_na?: boolean;
  /** @deprecated — kept for backward-compat migration only */
  file_path?: string;
  /** @deprecated — kept for backward-compat migration only */
  file_name?: string;
}

export const BLANK_CHECKLIST_ROW: ChecklistRowState = {
  particulars: "",
  page_from:   "",
  page_to:     "",
  files:       [],
  is_na:       false,
};

/** Migrate old single-file rows into the new files[] array. */
function normalizeRow(raw: Partial<ChecklistRowState>): ChecklistRowState {
  const base: ChecklistRowState = {
    particulars: raw.particulars ?? "",
    page_from:   raw.page_from   ?? "",
    page_to:     raw.page_to     ?? "",
    files:       Array.isArray(raw.files) ? raw.files : [],
    is_na:       raw.is_na ?? false,
  };
  // Migrate legacy file_path / file_name into files[]
  if (base.files.length === 0 && raw.file_path) {
    base.files = [{ file_path: raw.file_path, file_name: raw.file_name || raw.file_path }];
  }
  return base;
}

// ─── Full checklist data ──────────────────────────────────────────────────────

export interface ChecklistSheetData {
  rows:          Record<string, ChecklistRowState>;
  /** IDs of dynamically added rows (beyond the static set) */
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

    const applyData = (raw: ChecklistSheetData) => {
      const normalized: Record<string, ChecklistRowState> = {};
      for (const [k, v] of Object.entries(raw.rows ?? {})) {
        normalized[k] = normalizeRow(v as Partial<ChecklistRowState>);
      }
      return { rows: normalized, dynamicRowIds: raw.dynamicRowIds || [] };
    };

    const cached = awLoad<ChecklistSheetData>(engagementId, "checklist_sheet_json");
    if (cached && typeof cached === "object" && cached.rows && typeof cached.rows === "object") {
      setData(applyData(cached));
    }
    awLoadFromDB<ChecklistSheetData>(engagementId, "checklist_sheet_json").then(remote => {
      if (remote && typeof remote === "object" && remote.rows && typeof remote.rows === "object") {
        setData(applyData(remote));
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

  // ── addFileToRow — append a new file attachment ───────────────────────────
  const addFileToRow = useCallback(
    (rowId: string, file: ChecklistFile) => {
      setData(prev => {
        const prevRow = prev.rows[rowId] ?? { ...BLANK_CHECKLIST_ROW };
        const next: ChecklistSheetData = {
          rows: {
            ...prev.rows,
            [rowId]: { ...prevRow, files: [...prevRow.files, file] },
          },
          dynamicRowIds: prev.dynamicRowIds,
        };
        debounce(next);
        return next;
      });
    },
    [debounce]
  );

  // ── removeFileFromRow — remove a specific file by file_path ───────────────
  const removeFileFromRow = useCallback(
    (rowId: string, filePath: string) => {
      setData(prev => {
        const prevRow = prev.rows[rowId] ?? { ...BLANK_CHECKLIST_ROW };
        const next: ChecklistSheetData = {
          rows: {
            ...prev.rows,
            [rowId]: {
              ...prevRow,
              files: prevRow.files.filter(f => f.file_path !== filePath),
            },
          },
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

  // ── toggleNA — flip the is_na flag for a row ─────────────────────────────
  const toggleNA = useCallback(
    (rowId: string) => {
      setData(prev => {
        const prevRow = prev.rows[rowId] ?? { ...BLANK_CHECKLIST_ROW };
        const next: ChecklistSheetData = {
          rows:          { ...prev.rows, [rowId]: { ...prevRow, is_na: !prevRow.is_na } },
          dynamicRowIds: prev.dynamicRowIds,
        };
        debounce(next);
        return next;
      });
    },
    [debounce]
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

  return {
    data,
    setRowField,
    patchRowFields,
    addFileToRow,
    removeFileFromRow,
    getRow,
    toggleNA,
    addRow,
    manualSave,
    saving,
    loaded,
  };
}
