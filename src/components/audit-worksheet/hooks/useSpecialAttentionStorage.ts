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
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

// ─── Per-row state ───────────────────────────────────────────────────────────

export interface SARowState {
  checked_by_id:   string;
  checked_by_name: string;
  verified_by_id:   string;
  verified_by_name: string;
  query:   "yes" | "no" | "";
  remarks: string;
}

export const BLANK_ROW: SARowState = {
  checked_by_id:   "",
  checked_by_name: "",
  verified_by_id:   "",
  verified_by_name: "",
  query:   "",
  remarks: "",
};

// ─── Full form data ──────────────────────────────────────────────────────────

export interface SpecialAttentionFormData {
  auditor1_id:   string;
  auditor1_name: string;
  auditor2_id:   string;
  auditor2_name: string;
  rows: Record<string, SARowState>;
}

export const BLANK_SA: SpecialAttentionFormData = {
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
  const [data, setData]     = useState<SpecialAttentionFormData>(BLANK_SA);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Load ───────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!engagementId || loaded) return;
    (async () => {
      const { data: row } = await (supabase as any)
        .from("audit_worksheet_master")
        .select("special_attention_json")
        .eq("engagement_id", engagementId)
        .maybeSingle();

      const saved = row?.special_attention_json;
      if (saved && typeof saved === "object" && Object.keys(saved).length > 0) {
        setData({
          ...BLANK_SA,
          ...(saved as Partial<SpecialAttentionFormData>),
          rows: { ...(saved as SpecialAttentionFormData).rows },
        });
      }
      setLoaded(true);
    })();
  }, [engagementId, loaded]);

  // ── Persist ────────────────────────────────────────────────────────────────
  const persist = useCallback(
    async (snapshot: SpecialAttentionFormData, silent: boolean) => {
      setSaving(true);
      try {
        const { error } = await (supabase as any)
          .from("audit_worksheet_master")
          .upsert(
            {
              engagement_id:           engagementId,
              firm_id:                 firmId ?? null,
              special_attention_json:  snapshot,
              updated_at:              new Date().toISOString(),
            },
            { onConflict: "engagement_id" }
          );
        if (error) throw error;
        if (!silent) toast.success("Special Attention checklist saved");
      } catch (e: any) {
        if (!silent) toast.error(e.message || "Failed to save");
      } finally {
        setSaving(false);
      }
    },
    [engagementId, firmId]
  );

  // ── debounce helper ────────────────────────────────────────────────────────
  const debounce = useCallback(
    (next: SpecialAttentionFormData) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => persist(next, true), 1000);
    },
    [persist]
  );

  // ── setHeader — auditor1/2 ─────────────────────────────────────────────────
  const setHeader = useCallback(
    (patch: Partial<Pick<SpecialAttentionFormData, "auditor1_id"|"auditor1_name"|"auditor2_id"|"auditor2_name">>) => {
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
        debounce(next);
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
        debounce(next);
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
