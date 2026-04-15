/**
 * useQuerySheetStorage
 *
 * Manages the Query Sheet (Sheet 5) — rows stored as a JSON array
 * in audit_worksheet_master.query_sheet_json (jsonb column).
 *
 * Per-row state: head, particulars, query_description,
 *                required_documents, remark, correction_status.
 * 1-second debounced auto-save on every mutation.
 */
import { useState, useEffect, useCallback, useRef } from "react";
import { toast } from "sonner";
import { awLoad, awSave } from "@/lib/awStorage";

// ─── Types ───────────────────────────────────────────────────────────────────

export type CorrectionStatus = "Yes" | "No" | "";

export interface QueryRow {
  id:                   string;   // client-side uuid for React key
  head:                 string;
  particulars:          string;
  query_description:    string;
  required_documents:   string;
  remark:               string;
  correction_status:    CorrectionStatus;
}

export interface QuerySheetData {
  queries: QueryRow[];
}

export const BLANK_QUERY: Omit<QueryRow, "id"> = {
  head:               "",
  particulars:        "",
  query_description:  "",
  required_documents: "",
  remark:             "",
  correction_status:  "",
};

const BLANK_DATA: QuerySheetData = { queries: [] };

// ─── uuid-lite: crypto.randomUUID where available, else Math.random ──────────
function newId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useQuerySheetStorage(
  engagementId: string,
  firmId?: string | null
) {
  const [data, setData]     = useState<QuerySheetData>(BLANK_DATA);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Load ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!engagementId || loaded) return;
    const saved = awLoad<QuerySheetData>(engagementId, "query_sheet_json");
    if (saved && typeof saved === "object" && Array.isArray(saved.queries)) {
      setData(saved);
    }
    setLoaded(true);
  }, [engagementId, loaded]);

  // ── Persist ───────────────────────────────────────────────────────────────
  const persist = useCallback(
    async (snapshot: QuerySheetData, silent: boolean) => {
      setSaving(true);
      try {
        awSave(engagementId, "query_sheet_json", snapshot);
        if (!silent) toast.success("Query Sheet saved");
      } catch (e: any) {
        if (!silent) toast.error(e.message || "Failed to save");
      } finally {
        setSaving(false);
      }
    },
    [engagementId]
  );

  const debounce = useCallback(
    (next: QuerySheetData) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => persist(next, true), 1000);
    },
    [persist]
  );

  // ── CRUD ──────────────────────────────────────────────────────────────────

  const addQuery = useCallback(() => {
    setData(prev => {
      const next: QuerySheetData = {
        queries: [...prev.queries, { id: newId(), ...BLANK_QUERY }],
      };
      debounce(next);
      return next;
    });
  }, [debounce]);

  const updateQuery = useCallback(
    (id: string, field: keyof Omit<QueryRow, "id">, value: string) => {
      setData(prev => {
        const next: QuerySheetData = {
          queries: prev.queries.map(q =>
            q.id === id ? { ...q, [field]: value } : q
          ),
        };
        debounce(next);
        return next;
      });
    },
    [debounce]
  );

  const deleteQuery = useCallback(
    (id: string) => {
      setData(prev => {
        const next: QuerySheetData = {
          queries: prev.queries.filter(q => q.id !== id),
        };
        debounce(next);
        return next;
      });
    },
    [debounce]
  );

  // CP-17: bulk-add multiple rows (used by Excel import)
  const bulkAddQueries = useCallback(
    (rows: Array<Omit<QueryRow, "id">>) => {
      setData(prev => {
        const newRows = rows.map(r => ({ id: newId(), ...BLANK_QUERY, ...r }));
        const next: QuerySheetData = { queries: [...prev.queries, ...newRows] };
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

  // ── Gate helpers ─────────────────────────────────────────────────────────
  const queries     = data.queries;
  const allCorrected =
    queries.length === 0 ||
    queries.every(q => q.correction_status === "Yes");
  const pendingCount = queries.filter(q => q.correction_status !== "Yes").length;

  return {
    queries,
    addQuery,
    updateQuery,
    deleteQuery,
    bulkAddQueries,
    manualSave,
    saving,
    loaded,
    allCorrected,
    pendingCount,
  };
}
