/**
 * useSpecialAttentionStorage
 *
 * Manages the Special Attention (Advanced Checklist) form stored as JSON in
 * audit_worksheet_master.special_attention_json (jsonb column).
 *
 * Data shape:
 *  - auditor1/2 dropdown selection
 *  - rows: map from rowId → { checked_by, verified_by, query, remarks }
 *
 * Features:
 *  - Loads on mount
 *  - 1-second debounced auto-save on every change
 *  - manualSave() for explicit Save button
 */
import { useState, useEffect, useCallback, useRef } from "react";
import { toast } from "sonner";
import { awLoad, awSave, awLoadFromDB } from "@/lib/awStorage";
import { useAuth } from "@/hooks/useAuth";

// ─── Per-row state ───────────────────────────────────────────────────────────

export interface SARowState {
  /** ISSUE-17: multi-checker support — replaces single checked_by_id/name */
  checked_by_ids:   string[];
  checked_by_names: string[];
  verified_by_id:   string;
  verified_by_name: string;
  query:   "yes" | "no" | "";
  remarks: string;
}

export const BLANK_ROW: SARowState = {
  checked_by_ids:   [],
  checked_by_names: [],
  verified_by_id:   "",
  verified_by_name: "",
  query:   "",
  remarks: "",
};

/** Migrate a raw persisted row (may use old single-field format) to current shape */
function migrateRow(r: any): SARowState {
  const ids   = Array.isArray(r?.checked_by_ids)
    ? r.checked_by_ids
    : r?.checked_by_id ? [r.checked_by_id] : [];
  const names = Array.isArray(r?.checked_by_names)
    ? r.checked_by_names
    : r?.checked_by_name ? [r.checked_by_name] : [];
  return {
    checked_by_ids:   ids,
    checked_by_names: names,
    verified_by_id:   r?.verified_by_id   ?? "",
    verified_by_name: r?.verified_by_name ?? "",
    query:            r?.query            ?? "",
    remarks:          r?.remarks          ?? "",
  };
}

// ─── Full form data ──────────────────────────────────────────────────────────

export interface AuditorEntry {
  id:   string;
  name: string;
}

export interface SpecialAttentionFormData {
  /** Dynamic auditor list — replaces fixed auditor1/2 slots */
  audit_carried_by: AuditorEntry[];
  /** Kept for backward-compat with existing localStorage data; not rendered in UI */
  auditor1_id:   string;
  auditor1_name: string;
  auditor2_id:   string;
  auditor2_name: string;
  rows: Record<string, SARowState>;
}

export const BLANK_SA: SpecialAttentionFormData = {
  audit_carried_by: [],
  auditor1_id:   "",
  auditor1_name: "",
  auditor2_id:   "",
  auditor2_name: "",
  rows: {},
};

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useSpecialAttentionStorage(
  engagementId: string,
  firmId?: string | null
) {
  const { user } = useAuth();
  const [data, setData]     = useState<SpecialAttentionFormData>(BLANK_SA);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Load ───────────────────────────────────────────────────────────────────
  // Helper to apply migrations to raw data from localStorage or Supabase
  function applyMigrations(saved: SpecialAttentionFormData) {
    const carried: AuditorEntry[] =
      Array.isArray((saved as any).audit_carried_by) && (saved as any).audit_carried_by.length > 0
        ? (saved as any).audit_carried_by
        : [
            ...(saved.auditor1_id ? [{ id: saved.auditor1_id, name: saved.auditor1_name || "" }] : []),
            ...(saved.auditor2_id ? [{ id: saved.auditor2_id, name: saved.auditor2_name || "" }] : []),
          ];
    const migratedRows: Record<string, SARowState> = {};
    for (const [rowId, row] of Object.entries(saved.rows || {})) {
      migratedRows[rowId] = migrateRow(row);
    }
    return { ...BLANK_SA, ...saved, audit_carried_by: carried, rows: migratedRows };
  }

  useEffect(() => {
    if (!engagementId || loaded) return;
    setLoaded(true);
    const cached = awLoad<SpecialAttentionFormData>(engagementId, "special_attention_json");
    if (cached && typeof cached === "object" && Object.keys(cached).length > 0) {
      setData(applyMigrations(cached));
    }
    awLoadFromDB<SpecialAttentionFormData>(engagementId, "special_attention_json").then(remote => {
      if (remote && typeof remote === "object" && Object.keys(remote).length > 0) {
        setData(applyMigrations(remote));
      }
    });
  }, [engagementId, loaded]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Persist ────────────────────────────────────────────────────────────────
  const persist = useCallback(
    async (snapshot: SpecialAttentionFormData, silent: boolean, fieldLabel?: string) => {
      setSaving(true);
      try {
        awSave(engagementId, "special_attention_json", snapshot, firmId, user?.id, user?.name || "", fieldLabel);
        if (!silent) toast.success("Special Attention checklist saved");
      } catch (e: any) {
        if (!silent) toast.error(e.message || "Failed to save");
      } finally {
        setSaving(false);
      }
    },
    [engagementId]
  );

  // ── debounce helper ────────────────────────────────────────────────────────
  const debounce = useCallback(
    (next: SpecialAttentionFormData, fieldLabel?: string) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => persist(next, true, fieldLabel), 1000);
    },
    [persist]
  );

  // ── setHeader — auditor list + legacy auditor1/2 ──────────────────────────
  const setHeader = useCallback(
    (patch: Partial<Pick<SpecialAttentionFormData, "audit_carried_by"|"auditor1_id"|"auditor1_name"|"auditor2_id"|"auditor2_name">>) => {
      setData(prev => {
        const next = { ...prev, ...patch };
        debounce(next);
        return next;
      });
    },
    [debounce]
  );

  // ── setRowField — update one field in one row ──────────────────────────────
  const setRowField = useCallback(
    (rowId: string, field: keyof SARowState, value: string) => {
      setData(prev => {
        const prevRow = prev.rows[rowId] ?? { ...BLANK_ROW };
        const next: SpecialAttentionFormData = {
          ...prev,
          rows: {
            ...prev.rows,
            [rowId]: { ...prevRow, [field]: value },
          },
        };
        // Build a readable label for granular version history: "Special Attention · <rowId>"
        const rowLabel = `Special Attention · ${rowId}`;
        debounce(next, rowLabel);
        return next;
      });
    },
    [debounce]
  );

  // ── patchRow — update multiple row fields at once ─────────────────────────
  const patchRow = useCallback(
    (rowId: string, patch: Partial<SARowState>) => {
      setData(prev => {
        const prevRow = prev.rows[rowId] ?? { ...BLANK_ROW };
        const next: SpecialAttentionFormData = {
          ...prev,
          rows: {
            ...prev.rows,
            [rowId]: { ...prevRow, ...patch },
          },
        };
        const rowLabel = `Special Attention · ${rowId}`;
        debounce(next, rowLabel);
        return next;
      });
    },
    [debounce]
  );

  // ── manualSave ─────────────────────────────────────────────────────────────
  const manualSave = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    return persist(data, false);
  }, [data, persist]);

  // ── getRow — get row state (with blank fallback) ───────────────────────────
  const getRow = useCallback(
    (rowId: string): SARowState => data.rows[rowId] ?? { ...BLANK_ROW },
    [data.rows]
  );

  return {
    data, setHeader, setRowField, patchRow, getRow,
    manualSave, saving, loaded,
  };
}
