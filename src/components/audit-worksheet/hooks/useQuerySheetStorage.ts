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
 *
 * Phase 3C additions:
 *   • due_date      — ISO date string (YYYY-MM-DD); optional per row
 *   • bulkSetStatus — advance a set of rows to the same status in one mutation
 *
 * Phase 3D additions:
 *   • syncStatusFromClient — called by useQueryStatusSync when client portal
 *                            changes a linked audit_client_queries record
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

/** A single file attached to a query row.  Stored in Supabase storage's
 *  `documents` bucket (same bucket Checklist uses) — only the path + display
 *  name + size live in the row's JSON so the query_sheet_json column stays
 *  small. PDF / Excel / image only; ≤ 5 MB each. Optional. */
export interface QueryAttachment {
  file_path: string;   // storage path inside the "documents" bucket
  file_name: string;   // original filename for display
  file_type: string;   // MIME type (image/png, application/pdf, etc.)
  size:      number;   // bytes (sanity check on re-render)
}

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
  // Phase 3C
  due_date?:            string;  // YYYY-MM-DD — response deadline
  // Issue 2 (2026-05-30) — optional per-row attachments (PDF/Excel/images,
  // ≤5MB each), uploaded to Supabase storage. Empty/missing array = none.
  attachments?:         QueryAttachment[];
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
  due_date:           "",
  attachments:        [],
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

/** Callback signature for row-level edit logging (Issue 3 — 2026-05-30).
 *  Called BEFORE the in-memory state is replaced so the caller sees both
 *  the before and after value. The caller (QuerySheet) wires this to
 *  useWorksheetHistory.logSave so each meaningful change becomes its own
 *  timeline entry like "Status: Raised → Dispatched on row [Group/Ledger]". */
export interface QueryFieldChange {
  rowId:      string;
  rowLabel:   string;        // "head / particulars" so the entry is identifiable
  fieldLabel: string;        // human label: "Status", "Priority", "Due Date", …
  oldValue:   string;
  newValue:   string;
}

export function useQuerySheetStorage(
  engagementId: string,
  firmId?: string | null,
  onFieldChange?: (c: QueryFieldChange) => void,
) {
  const { user } = useAuth();
  const [data,   setData]   = useState<QuerySheetData>(BLANK_DATA);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // BULLETPROOF SAVE checkpoint — see useTaxMasterStorage for full notes.
  const lastSavedRef = useRef<QuerySheetData | null>(null);

  // Stable ref so internal callbacks always see the latest onFieldChange
  // without needing to re-create themselves on every render.
  const onFieldChangeRef = useRef(onFieldChange);
  useEffect(() => { onFieldChangeRef.current = onFieldChange; }, [onFieldChange]);

  // Debounce edit-log emission for free-text fields so typing a sentence doesn't
  // create dozens of history entries. logTimerRef holds the pending timeout per
  // "rowId:field" key; logStartRef captures the old value at the START of each
  // typing session so the log shows the real before/after, not intermediate chars.
  const logTimerRef  = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const logStartRef  = useRef<Record<string, string>>({});
  const TEXT_LOG_FIELDS = new Set<string>(["head", "particulars", "query_description", "required_documents", "remark"]);

  // Human-readable labels for fields surfaced in the version history.
  const FIELD_LABEL: Partial<Record<keyof QueryRow, string>> = {
    head:               "Group",
    particulars:        "Ledger",
    query_description:  "Description",
    required_documents: "Required Documents",
    remark:             "Remark",
    correction_status:  "Correction Status",
    query_status:       "Status",
    priority:           "Priority",
    due_date:           "Due Date",
    attachments:        "Attachments",
  };

  /** Row identifier for the timeline ("Property, Plant & Equipment / Machinery"). */
  const rowLabel = (r: QueryRow) => {
    const h = (r.head || "").trim();
    const p = (r.particulars || "").trim();
    if (h && p) return `${h} / ${p}`;
    return h || p || `Row ${r.id.slice(0, 6)}`;
  };

  /** Map an internal status code to its display label so the history reads
   *  like "Raised → Dispatched" instead of "raised → dispatched". */
  const statusLabel = (s: QueryStatus) => STATUS_META[s]?.label ?? s;

  // ── Load ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!engagementId || loaded) return;
    setLoaded(true);
    const cached = awLoad<QuerySheetData>(engagementId, "query_sheet_json");
    if (cached && typeof cached === "object" && Array.isArray(cached.queries)) {
      const d = { queries: cached.queries.map(migrateRow) };
      setData(d);
      lastSavedRef.current = d;
    }
    awLoadFromDB<QuerySheetData>(engagementId, "query_sheet_json").then(remote => {
      if (remote && typeof remote === "object" && Array.isArray(remote.queries)) {
        // ── Race-condition fix ───────────────────────────────────────────────
        // addQueryPrefilled (from Ledger Explorer "+ Query") may have already
        // added a row to local state while this async fetch was in flight.
        // A plain setData(remote) would overwrite — and silently discard — that
        // locally-added row.  Use a functional update so we can inspect the
        // current state and preserve any rows whose IDs are not present in the
        // remote snapshot (i.e. rows added locally after the fetch started).
        setData(prev => {
          const migratedRemote = remote.queries.map(migrateRow);
          const remoteIds = new Set(migratedRemote.map(q => q.id));
          const localOnly  = prev.queries.filter(q => !remoteIds.has(q.id));
          const next = { queries: [...migratedRemote, ...localOnly] };
          lastSavedRef.current = next;   // checkpoint against canonical server state
          return next;
        });
      }
    });
  }, [engagementId, loaded]);

  // ── Persist ───────────────────────────────────────────────────────────────
  const persist = useCallback(
    async (snapshot: QuerySheetData, silent: boolean) => {
      setSaving(true);
      try {
        awSave(engagementId, "query_sheet_json", snapshot, firmId, user?.id, user?.name || "", null, lastSavedRef.current ?? undefined);
        lastSavedRef.current = { ...snapshot };   // CHECKPOINT_AFTER
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
        const target = prev.queries.find(q => q.id === id);
        const next: QuerySheetData = {
          queries: prev.queries.map(q =>
            q.id === id ? { ...q, [field]: value } : q,
          ),
        };
        debounce(next);
        // Emit a row-level edit-log entry for meaningful field changes.
        // Text fields are debounced (1500 ms) so that typing a sentence doesn't
        // flood the log with one entry per character — only the final value is
        // recorded. Discrete fields (status, priority, etc.) fire immediately.
        if (
          target
          && onFieldChangeRef.current
          && field !== "dispatched_query_id"
          && (target as any)[field] !== value
        ) {
          const fl = FIELD_LABEL[field] ?? String(field);
          let oldDisplay = String((target as any)[field] ?? "");
          let newDisplay = String(value ?? "");
          if (field === "query_status") {
            oldDisplay = statusLabel(oldDisplay as QueryStatus);
            newDisplay = statusLabel(newDisplay as QueryStatus);
          }
          if (TEXT_LOG_FIELDS.has(field as string)) {
            const logKey = `${id}:${field}`;
            if (!logTimerRef.current[logKey]) {
              // First keystroke in this typing session — save the original value
              logStartRef.current[logKey] = oldDisplay;
            } else {
              clearTimeout(logTimerRef.current[logKey]);
            }
            const capturedNew = newDisplay;
            const capturedLabel = rowLabel(target);
            logTimerRef.current[logKey] = setTimeout(() => {
              delete logTimerRef.current[logKey];
              const startOld = logStartRef.current[logKey] ?? "";
              delete logStartRef.current[logKey];
              if (startOld !== capturedNew && onFieldChangeRef.current) {
                onFieldChangeRef.current({
                  rowId: id, rowLabel: capturedLabel,
                  fieldLabel: fl, oldValue: startOld, newValue: capturedNew,
                });
              }
            }, 1500);
          } else {
            onFieldChangeRef.current({
              rowId: id, rowLabel: rowLabel(target),
              fieldLabel: fl, oldValue: oldDisplay, newValue: newDisplay,
            });
          }
        }
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
        let logged: QueryFieldChange | null = null;
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
            logged = {
              rowId: q.id, rowLabel: rowLabel(q),
              fieldLabel: "Status",
              oldValue:   statusLabel(current),
              newValue:   statusLabel(nextStatus),
            };
            return { ...q, query_status: nextStatus, ...extra };
          }),
        };
        debounce(next);
        if (logged && onFieldChangeRef.current) onFieldChangeRef.current(logged);
        return next;
      });
    },
    [debounce],
  );

  /** Jump to a specific status directly */
  const setQueryStatus = useCallback(
    (id: string, status: QueryStatus) => {
      setData(prev => {
        let logged: QueryFieldChange | null = null;
        const next: QuerySheetData = {
          queries: prev.queries.map(q => {
            if (q.id !== id) return q;
            if (q.query_status === status) return q;
            const extra = status === "resolved"
              ? { correction_status: "Yes" as CorrectionStatus }
              : status === "escalated"
              ? { correction_status: "No" as CorrectionStatus }
              : {};
            logged = {
              rowId: q.id, rowLabel: rowLabel(q),
              fieldLabel: "Status",
              oldValue:   statusLabel(q.query_status),
              newValue:   statusLabel(status),
            };
            return { ...q, query_status: status, ...extra };
          }),
        };
        debounce(next);
        if (logged && onFieldChangeRef.current) onFieldChangeRef.current(logged);
        return next;
      });
    },
    [debounce],
  );

  /** Phase 3C: Set the same status on multiple rows at once */
  const bulkSetStatus = useCallback(
    (ids: string[], status: QueryStatus) => {
      setData(prev => {
        const idSet = new Set(ids);
        const logged: QueryFieldChange[] = [];
        const next: QuerySheetData = {
          queries: prev.queries.map(q => {
            if (!idSet.has(q.id)) return q;
            if (q.query_status === status) return q;
            const extra = status === "resolved"
              ? { correction_status: "Yes" as CorrectionStatus }
              : status === "escalated"
              ? { correction_status: "No" as CorrectionStatus }
              : {};
            logged.push({
              rowId: q.id, rowLabel: rowLabel(q),
              fieldLabel: "Status",
              oldValue:   statusLabel(q.query_status),
              newValue:   statusLabel(status),
            });
            return { ...q, query_status: status, ...extra };
          }),
        };
        debounce(next);
        if (onFieldChangeRef.current) logged.forEach(c => onFieldChangeRef.current!(c));
        return next;
      });
    },
    [debounce],
  );

  /**
   * Phase 3D: Called by useQueryStatusSync when a linked audit_client_queries
   * record changes status in the portal.
   * Maps:  "Reply Received"  → response_received
   *        "Clarified"|"Closed" → resolved
   * Silently ignored if the row isn't in a state that should advance.
   */
  const syncStatusFromClient = useCallback(
    (clientQueryId: string, clientStatus: string) => {
      setData(prev => {
        const rowIdx = prev.queries.findIndex(q => q.dispatched_query_id === clientQueryId);
        if (rowIdx === -1) return prev;

        const row = prev.queries[rowIdx];
        let newStatus: QueryStatus | null = null;

        if (clientStatus === "Reply Received" && row.query_status === "dispatched") {
          newStatus = "response_received";
        } else if (
          (clientStatus === "Clarified" || clientStatus === "Closed") &&
          row.query_status !== "resolved" &&
          row.query_status !== "escalated"
        ) {
          newStatus = "resolved";
        }

        if (!newStatus) return prev;

        const extra = newStatus === "resolved"
          ? { correction_status: "Yes" as CorrectionStatus }
          : {};
        const updated = { ...row, query_status: newStatus, ...extra };
        const queries = [...prev.queries];
        queries[rowIdx] = updated;
        const next: QuerySheetData = { queries };
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
        let logged: QueryFieldChange | null = null;
        const next: QuerySheetData = {
          queries: prev.queries.map(q => {
            if (q.id !== id) return q;
            const cur = q.priority ?? "Medium";
            const idx = PRIORITY_CYCLE.indexOf(cur);
            const nextPriority = PRIORITY_CYCLE[(idx + 1) % PRIORITY_CYCLE.length];
            logged = {
              rowId: q.id, rowLabel: rowLabel(q),
              fieldLabel: "Priority",
              oldValue: cur, newValue: nextPriority,
            };
            return { ...q, priority: nextPriority };
          }),
        };
        debounce(next);
        if (logged && onFieldChangeRef.current) onFieldChangeRef.current(logged);
        return next;
      });
    },
    [debounce],
  );

  // ── Attachments (Issue 2 — 2026-05-30) ────────────────────────────────────

  /** Add an attachment to a row. Caller is responsible for the actual upload to
   *  Supabase storage — this only persists the record on the row. */
  const addAttachment = useCallback(
    (rowId: string, attachment: QueryAttachment) => {
      setData(prev => {
        let logged: QueryFieldChange | null = null;
        const next: QuerySheetData = {
          queries: prev.queries.map(q => {
            if (q.id !== rowId) return q;
            const list = [...(q.attachments ?? []), attachment];
            logged = {
              rowId: q.id, rowLabel: rowLabel(q),
              fieldLabel: "Attachments",
              oldValue: `${(q.attachments ?? []).length} file(s)`,
              newValue: `+${attachment.file_name}`,
            };
            return { ...q, attachments: list };
          }),
        };
        debounce(next);
        if (logged && onFieldChangeRef.current) onFieldChangeRef.current(logged);
        return next;
      });
    },
    [debounce],
  );

  /** Remove an attachment from a row by file_path. */
  const removeAttachment = useCallback(
    (rowId: string, file_path: string) => {
      setData(prev => {
        let logged: QueryFieldChange | null = null;
        const next: QuerySheetData = {
          queries: prev.queries.map(q => {
            if (q.id !== rowId) return q;
            const removed = (q.attachments ?? []).find(a => a.file_path === file_path);
            const list = (q.attachments ?? []).filter(a => a.file_path !== file_path);
            if (removed) {
              logged = {
                rowId: q.id, rowLabel: rowLabel(q),
                fieldLabel: "Attachments",
                oldValue: removed.file_name,
                newValue: "removed",
              };
            }
            return { ...q, attachments: list };
          }),
        };
        debounce(next);
        if (logged && onFieldChangeRef.current) onFieldChangeRef.current(logged);
        return next;
      });
    },
    [debounce],
  );

  /** Validate that every row has a non-empty Query Description before save.
   *  Returns the count of offending rows; 0 means the save is clear to go. */
  const validateRequired = useCallback((snapshot: QuerySheetData): {
    missingCount: number;
    firstMissingId: string | null;
  } => {
    let missingCount = 0;
    let firstMissingId: string | null = null;
    for (const q of snapshot.queries) {
      if (!(q.query_description || "").trim()) {
        missingCount += 1;
        if (!firstMissingId) firstMissingId = q.id;
      }
    }
    return { missingCount, firstMissingId };
  }, []);

  const manualSave = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    // Issue 4 (2026-05-30) — Query Description is mandatory. Block save and
    // surface a toast pointing the auditor at the offending row count.
    const { missingCount } = validateRequired(data);
    if (missingCount > 0) {
      toast.error(
        `${missingCount} ${missingCount === 1 ? "query is" : "queries are"} missing a Query Description. Fill them in before saving.`,
      );
      return Promise.reject(new Error("query_description_required"));
    }
    return persist(data, false);
  }, [data, persist, validateRequired]);

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

  // ── Derived: rows missing the mandatory Query Description ────────────────
  const missingDescriptionIds = useMemo(
    () => new Set(queries.filter(q => !(q.query_description || "").trim()).map(q => q.id)),
    [queries],
  );

  return {
    queries,
    addQuery,
    addQueryPrefilled,
    updateQuery,
    deleteQuery,
    bulkAddQueries,
    advanceStatus,
    setQueryStatus,
    bulkSetStatus,
    syncStatusFromClient,
    cyclePriority,
    addAttachment,
    removeAttachment,
    manualSave,
    saving,
    loaded,
    allCorrected,
    pendingCount,
    statusCounts,
    missingDescriptionIds,
  };
}
