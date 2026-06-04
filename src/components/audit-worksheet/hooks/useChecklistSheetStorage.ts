/**
 * useChecklistSheetStorage
 *
 * Manages the Audit Documentation Checklist (Sheet 6) — 22 fixed rows + dynamic
 * extras, stored as a JSON object in audit_worksheet_master.checklist_sheet_json.
 *
 * Per-row state: particulars (custom rows only), page_from, page_to, is_na, and
 * an array of attached files (multiple docs per row supported). Backward-compat:
 * legacy rows with file_path/file_name strings are migrated into files[] on load.
 *
 * ── BULLETPROOF UPLOAD GUARANTEE (2026-06-04 hardening) ─────────────────
 *
 * Past data-loss symptoms reported by the user — "documents not traceable,
 * information vanished" — traced to four loopholes in this hook:
 *
 *   1. File uploads only scheduled a 1-second debounced save. Closing the
 *      tab within 1 s of an upload left the Storage object orphaned with
 *      no DB row pointing at it.
 *   2. ChecklistFile carried no uploader identity / timestamp — once a file
 *      went missing or got duplicated, there was no forensic trail.
 *   3. lastSavedRef was set from the localStorage cache. If the async DB
 *      load failed silently, subsequent saves diffed against stale cache
 *      and could overwrite fresher server state.
 *   4. Engagement-id change without remount didn't reset lastSavedRef,
 *      so cross-engagement merges could corrupt data.
 *
 * Fixes:
 *   - addFileToRow / removeFileFromRow now FLUSH the save immediately
 *     instead of relying on the debounce. The Storage object and the DB
 *     reference land together atomically (within one tick).
 *   - ChecklistFile now carries uploaded_by, uploaded_by_name, uploaded_at.
 *     Each upload/remove also inserts a dedicated audit_worksheet_history
 *     row with field_name=file_path, old_value/new_value=file_name so the
 *     audit trail (/admin/audit-trail) can answer "who attached X at T".
 *   - lastSavedRef is set ONLY from the DB load (canonical server state).
 *     Cache hydration paints the UI but does not become the diff baseline.
 *   - The load effect resets state when engagementId changes mid-mount.
 *   - A `beforeunload` window listener flushes any pending debounced save
 *     before the tab is closed.
 */
import { useState, useEffect, useCallback, useRef } from "react";
import { toast } from "sonner";
import { awLoad, awSave, awLoadFromDB } from "@/lib/awStorage";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

// ─── Per-row state ────────────────────────────────────────────────────────────

export interface ChecklistFile {
  file_path: string;
  file_name: string;
  /** UUID of the user who uploaded this file (auth.users.id). Captured at upload time. */
  uploaded_by?: string | null;
  /** Display name of the uploader at upload time (denormalised). */
  uploaded_by_name?: string | null;
  /** ISO 8601 timestamp when the upload completed. */
  uploaded_at?: string;
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
  const timerRef    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dataRef     = useRef<ChecklistSheetData>(BLANK_CHECKLIST);
  // BULLETPROOF SAVE checkpoint — set ONLY from DB load (canonical state),
  // never from localStorage cache. See file header for the data-loss bug
  // this defence solves.
  const lastSavedRef = useRef<ChecklistSheetData | null>(null);

  // ── Load (with engagement-id-change reset) ────────────────────────────────
  useEffect(() => {
    if (!engagementId) return;

    const applyData = (raw: ChecklistSheetData) => {
      const normalized: Record<string, ChecklistRowState> = {};
      for (const [k, v] of Object.entries(raw.rows ?? {})) {
        normalized[k] = normalizeRow(v as Partial<ChecklistRowState>);
      }
      return { rows: normalized, dynamicRowIds: raw.dynamicRowIds || [] };
    };

    // Reset everything when engagement-id changes. Prevents cross-engagement
    // diff corruption (lastSavedRef from engagement A acting as baseline for
    // engagement B's saves).
    setLoaded(false);
    lastSavedRef.current = null;
    setData(BLANK_CHECKLIST);
    dataRef.current = BLANK_CHECKLIST;

    // 1. Paint UI fast from localStorage cache. Do NOT set lastSavedRef here.
    const cached = awLoad<ChecklistSheetData>(engagementId, "checklist_sheet_json");
    if (cached && typeof cached === "object" && cached.rows && typeof cached.rows === "object") {
      const d = applyData(cached);
      setData(d);
      dataRef.current = d;
    }
    // 2. Authoritative load from DB. ONLY this sets lastSavedRef. If the
    //    network call rejects or returns null, lastSavedRef stays null —
    //    the first save then falls through awStorage's "no prev snapshot"
    //    backward-compat path (full overwrite + section-level history row)
    //    rather than diffing against potentially-stale cache.
    awLoadFromDB<ChecklistSheetData>(engagementId, "checklist_sheet_json")
      .then(remote => {
        if (remote && typeof remote === "object" && remote.rows && typeof remote.rows === "object") {
          const d = applyData(remote);
          setData(d);
          dataRef.current = d;
          lastSavedRef.current = d;
        }
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, [engagementId]);

  // ── Persist ───────────────────────────────────────────────────────────────
  const persist = useCallback(
    async (snapshot: ChecklistSheetData, silent: boolean) => {
      setSaving(true);
      try {
        awSave(
          engagementId, "checklist_sheet_json", snapshot, firmId, user?.id, user?.name || "", null,
          lastSavedRef.current ?? undefined,
        );
        lastSavedRef.current = { ...snapshot };
        if (!silent) toast.success("Checklist saved");
      } catch (e: any) {
        if (!silent) toast.error(e.message || "Failed to save");
      } finally {
        setSaving(false);
      }
    },
    [engagementId, firmId, user?.id, user?.name]
  );

  const debounce = useCallback(
    (next: ChecklistSheetData) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => persist(next, true), 1000);
    },
    [persist]
  );

  /**
   * Flush any pending debounced save immediately. Used after file uploads
   * and file deletes so the Storage mutation + the DB JSON reference always
   * land in the same tick — no "lost between debounces" gap that previously
   * caused untraceable orphan files.
   */
  const flushSave = useCallback(async () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    await persist(dataRef.current, true);
  }, [persist]);

  // ── Flush on tab close ────────────────────────────────────────────────────
  useEffect(() => {
    const onBeforeUnload = () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        try {
          awSave(engagementId, "checklist_sheet_json", dataRef.current, firmId, user?.id, user?.name || "", null, lastSavedRef.current ?? undefined);
        } catch { /* nothing we can do; localStorage cache still has it */ }
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      // Same flush on unmount — defensive, in case the user navigates away
      // mid-debounce without unloading the page.
      onBeforeUnload();
    };
  }, [engagementId, firmId, user?.id, user?.name]);

  // ── setRowField — update one field in one row ────────────────────────────
  const setRowField = useCallback(
    (rowId: string, field: keyof ChecklistRowState, value: string) => {
      setData(prev => {
        const prevRow = prev.rows[rowId] ?? { ...BLANK_CHECKLIST_ROW };
        const next: ChecklistSheetData = {
          rows:          { ...prev.rows, [rowId]: { ...prevRow, [field]: value } },
          dynamicRowIds: prev.dynamicRowIds,
        };
        dataRef.current = next;
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
        dataRef.current = next;
        debounce(next);
        return next;
      });
    },
    [debounce]
  );

  /**
   * Insert a dedicated audit-history row for a single file mutation.
   * This survives even when the row-level diff in awStorage treats `rows`
   * as one key and would truncate the JSON blob in old_value/new_value.
   */
  const logFileHistory = useCallback(
    async (rowId: string, action: "added" | "removed", file: ChecklistFile) => {
      try {
        await (supabase as any).from("audit_worksheet_history").insert({
          engagement_id:   engagementId,
          section_name:    `Checklist · ${rowId} · file ${action}`,
          field_name:      file.file_path,
          old_value:       action === "removed" ? file.file_name : null,
          new_value:       action === "added"   ? file.file_name : null,
          changed_by:      user?.id ?? null,
          changed_by_name: user?.name ?? "Unknown",
        });
      } catch {
        // History logging is best-effort — never block a real save on it.
      }
    },
    [engagementId, user?.id, user?.name]
  );

  // ── addFileToRow — append a new file attachment ───────────────────────────
  // Now: synchronously flushes the save BEFORE returning so the Storage
  // object and the DB JSON reference land together. Also stamps uploader
  // identity + timestamp so the user can audit "who attached this and when".
  const addFileToRow = useCallback(
    async (rowId: string, file: ChecklistFile) => {
      const stamped: ChecklistFile = {
        ...file,
        uploaded_by:      file.uploaded_by      ?? user?.id ?? null,
        uploaded_by_name: file.uploaded_by_name ?? user?.name ?? null,
        uploaded_at:      file.uploaded_at      ?? new Date().toISOString(),
      };
      const next: ChecklistSheetData = (() => {
        const cur = dataRef.current;
        const prevRow = cur.rows[rowId] ?? { ...BLANK_CHECKLIST_ROW };
        return {
          rows: { ...cur.rows, [rowId]: { ...prevRow, files: [...prevRow.files, stamped] } },
          dynamicRowIds: cur.dynamicRowIds,
        };
      })();
      dataRef.current = next;
      setData(next);
      // FLUSH IMMEDIATELY — no debounce. This is the critical loop closer:
      // before this fix, the 1-second debounce meant a fast tab-close left
      // the Storage upload as an orphan with no DB pointer.
      await persist(next, true);
      // Forensic trail row — independent of the main JSON history.
      void logFileHistory(rowId, "added", stamped);
    },
    [persist, logFileHistory, user?.id, user?.name]
  );

  // ── removeFileFromRow — remove a specific file by file_path ───────────────
  // Symmetric flush so the JSON pointer is gone BEFORE Storage delete fires
  // upstream (Checklist.tsx). Prevents the "ghost reference to deleted blob"
  // bug where a 404 Preview link was the only sign anything went wrong.
  const removeFileFromRow = useCallback(
    async (rowId: string, filePath: string) => {
      const cur = dataRef.current;
      const prevRow = cur.rows[rowId];
      const removed = prevRow?.files.find(f => f.file_path === filePath);
      const next: ChecklistSheetData = {
        rows: {
          ...cur.rows,
          [rowId]: {
            ...(prevRow ?? BLANK_CHECKLIST_ROW),
            files: (prevRow?.files ?? []).filter(f => f.file_path !== filePath),
          },
        },
        dynamicRowIds: cur.dynamicRowIds,
      };
      dataRef.current = next;
      setData(next);
      await persist(next, true);
      if (removed) void logFileHistory(rowId, "removed", removed);
    },
    [persist, logFileHistory]
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
        dataRef.current = next;
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
      dataRef.current = next;
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
    flushSave,
    saving,
    loaded,
  };
}
