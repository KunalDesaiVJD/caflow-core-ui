/**
 * useQuerySheetStorage
 *
 * Manages the Query Sheet (Sheet 5) — rows stored as a JSON array
 * in audit_worksheet_master.query_sheet_json (jsonb column).
 *
 * Phase 3B additions:
 *   • query_status  — full state machine (draft → raised → dispatched →
 *                     response_received → resolved | escalated)
 *   • priority      — High | Medium | Low
 *   • allCorrected  — also satisfied when query_status === "resolved"
 *   • Backward migration: existing rows with content → "raised"; empty → "draft"
 */
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { toast } from "sonner";
import { awLoad, awSave, awLoadFromDB } from "@/lib/awStorage";
import { useAuth } from "@/hooks/useAuth";

// ─── State machine types ─────────────────────────────────────────────────────

export type QueryStatus =
  | "draft"
  | "raised"
  | "dispatched"
  | "response_received"
  | "resolved"
  | "escalated";

export type QueryPriority = "High" | "Medium" | "Low";

export type CorrectionStatus = "Yes" | "No" | "";

/** Next state in the linear advance path (null = terminal) */
export const STATUS_NEXT: Record<QueryStatus, QueryStatus | null> = {
  draft:             "raised",
  raised:            "dispatched",
  dispatched:        "response_received",
  response_received: "resolved",
  resolved:          null,
  escalated:         null,
};

/** Display metadata for each status */
export const STATUS_META: Record<QueryStatus, {
  label:    string;
  color:    string;   // tailwind text class
  bg:       string;   // tailwind bg class
  border:   string;   // tailwind border class
}> = {
  draft:             { label: "Draft",        color: "text-slate-600",  bg: "bg-slate-100",  border: "border-slate-300"  },
  raised:            { label: "Raised",       color: "text-blue-700",   bg: "bg-blue-100",   border: "border-blue-300"   },
  dispatched:        { label: "Dispatched",   color: "text-violet-700", bg: "bg-violet-100", border: "border-violet-300" },
  response_received: { label: "Received",     color: "text-amber-700",  bg: "bg-amber-100",  border: "border-amber-300"  },
  resolved:          { label: "Resolved",     color: "text-green-700",  bg: "bg-green-100",  border: "border-green-300"  },
  escalated:         { label: "Escalated",    color: "text-red-700",    bg: "bg-red-100",    border: "border-red-300"    },
};

/** Display metadata for each priority */
export const PRIORITY_META: Record<QueryPriority, {
  color: string;
  bg:    string;
  dot:   string;
}> = {
  High:   { color: "text-red-700",   bg: "bg-red-50",    dot: "bg-red-500"   },
  Medium: { color: "text-amber-700", bg: "bg-amber-50",  dot: "bg-amber-400" },
  Low:    { color: "text-green-700", bg: "bg-green-50",  dot: "bg-green-400" },
};

const PRIORITY_CYCLE: QueryPriority[] = ["High", "Medium", "Low"];

// ─── Row type ─────────────────────────────────────────────────────────────────

export interface QueryRow {
  id:                   string;
  head:                 string;
  particulars:          string;
  query_description:    string;
  required_documents:   string;
  remark:               string;
  correction_status:    CorrectionStatus;
  dispatched_query_id?: string;
  // Phase 3B
  query_status:         QueryStatus;
  priority:             QueryPriority;
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
  query_status:       "draft",
  priority:           "Medium",
};

const BLANK_DATA: QuerySheetData = { queries: [] };

// ─── Backward-compat migration ────────────────────────────────────────────────
// Rows loaded from DB may lack query_status / priority (saved before Phase 3B).
// Migrate on read without triggering a save — they will be persisted on next edit.

function migrateRow(q: QueryRow): QueryRow {
  const hasContent = !!(q.query_description || q.head || q.particulars);
  return {
    ...q,
    query_status: q.query_status ?? (hasContent ? "raised" : "draft"),
    priority:     q.priority     ?? "Medium",
  };
}

// ─── uuid-lite ────────────────────────────────────────────────────────────────

function newId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useQuerySheetStorage(
  engagementId: string,
  firmId?: string | null,
) {
  const { user } = useAuth();
  const [data,   setData]   = useState<QuerySheetData>(BLANK_DATA);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Load ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!engagementId || loaded) return;
    setLoaded(true);
    const cached = awLoad<QuerySheetData>(engagementId, "query_sheet_json");
    if (cached && typeof cached === "object" && Array.isArray(cached.queries)) {
      setData(cached);
    }
    awLoadFromDB<QuerySheetData>(engagementId, "query_sheet_json").then(remote => {
      if (remote && typeof remote === "object" && Array.isArray(remote.queries)) {
        setData(remote);
      }
    });
  }, [engagementId, loaded]);

  // ── Persist ───────────────────────────────────────────────────────────────
  const persist = useCallback(
    async (snapshot: QuerySheetData, silent: boolean) => {
      setSaving(true);
      try {
        awSave(engagementId, "query_sheet_json", snapshot, firmId, user?.id, user?.name || "");
        if (!silent) toast.success("Query Sheet saved");
      } catch (e: any) {
        if (!silent) toast.error(e.message || "Failed to save");
      } finally {
        setSaving(false);
      }
    },
    [engagementId],
  );

  const debounce = useCallback(
    (next: QuerySheetData) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => persist(next, true), 1000);
    },
    [persist],
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
            q.id === id ? { ...q, [field]: value } : q,
          ),
        };
        debounce(next);
        return next;
      });
    },
    [debounce],
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
    [debounce],
  );

  // Add a pre-filled row (called from Ledger Explorer)
  const addQueryPrefilled = useCallback(
    (head: string, particulars: string, queryNote?: string) => {
      setData(prev => {
        const newRow: QueryRow = {
          id: newId(),
          ...BLANK_QUERY,
          head,
          particulars,
          query_description: queryNote || "",
          query_status: "raised",
        };
        const next: QuerySheetData = { queries: [...prev.queries, newRow] };
        debounce(next);
        return next;
      });
    },
    [debounce],
  );

  // Bulk-add (Excel import)
  const bulkAddQueries = useCallback(
    (rows: Array<Omit<QueryRow, "id">>) => {
      setData(prev => {
        const newRows = rows.map(r => ({ id: newId(), ...BLANK_QUERY, ...r }));
        const next: QuerySheetData = { queries: [...prev.queries, ...newRows] };
        debounce(next);
        return next;
      });
    },
    [debounce],
  );

  // ── Phase 3B helpers ──────────────────────────────────────────────────────

  /** Advance status one step in the linear chain */
  const advanceStatus = useCallback(
    (id: string) => {
      setData(prev => {
        const next: QuerySheetData = {
          queries: prev.queries.map(q => {
            if (q.id !== id) return q;
            const current = q.query_status ?? "draft";
            const nextStatus = STATUS_NEXT[current];
            if (!nextStatus) return q;
            // Auto-set correction_status when resolving
            const extra = nextStatus === "resolved"
              ? { correction_status: "Yes" as CorrectionStatus }
              : {};
            return { ...q, query_status: nextStatus, ...extra };
          }),
        };
        debounce(next);
        return next;
      });
    },
    [debounce],
  );

  /** Jump to a specific status directly */
  const setQueryStatus = useCallback(
    (id: string, status: QueryStatus) => {
      setData(prev => {
        const next: QuerySheetData = {
          queries: prev.queries.map(q => {
            if (q.id !== id) return q;
            const extra = status === "resolved"
              ? { correction_status: "Yes" as CorrectionStatus }
              : status === "escalated"
              ? { correction_status: "No" as CorrectionStatus }
              : {};
            return { ...q, query_status: status, ...extra };
          }),
        };
        debounce(next);
        return next;
      });
    },
    [debounce],
  );

  /** Cycle priority: High → Medium → Low → High */
  const cyclePriority = useCallback(
    (id: string) => {
      setData(prev => {
        const next: QuerySheetData = {
          queries: prev.queries.map(q => {
            if (q.id !== id) return q;
            const cur = q.priority ?? "Medium";
            const idx = PRIORITY_CYCLE.indexOf(cur);
            const nextPriority = PRIORITY_CYCLE[(idx + 1) % PRIORITY_CYCLE.length];
            return { ...q, priority: nextPriority };
          }),
        };
        debounce(next);
        return next;
      });
    },
    [debounce],
  );

  const manualSave = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    return persist(data, false);
  }, [data, persist]);

  // ── Derived values ────────────────────────────────────────────────────────

  // Apply backward-compat migration on read (no extra renders — useMemo)
  const queries = useMemo(
    () => data.queries.map(migrateRow),
    [data.queries],
  );

  const allCorrected =
    queries.length === 0 ||
    queries.every(q => q.correction_status === "Yes" || q.query_status === "resolved");

  const pendingCount = queries.filter(
    q => q.correction_status !== "Yes" && q.query_status !== "resolved",
  ).length;

  // Status funnel counts
  const statusCounts = useMemo(() => {
    const counts: Record<QueryStatus, number> = {
      draft: 0, raised: 0, dispatched: 0,
      response_received: 0, resolved: 0, escalated: 0,
    };
    for (const q of queries) counts[q.query_status] = (counts[q.query_status] ?? 0) + 1;
    return counts;
  }, [queries]);

  return {
    queries,
    addQuery,
    addQueryPrefilled,
    updateQuery,
    deleteQuery,
    bulkAddQueries,
    advanceStatus,
    setQueryStatus,
    cyclePriority,
    manualSave,
    saving,
    loaded,
    allCorrected,
    pendingCount,
    statusCounts,
  };
}
