/**
 * useReminderEngine — Phase 4A / Phase 4C
 *
 * Evaluates which audit_client_queries are due for a follow-up reminder
 * and which should be escalated, based on configurable rules stored per
 * engagement in localStorage.
 *
 * A query "needs reminder" when ALL of:
 *   1. status is "Open" or "Client Acknowledged"
 *   2. days since created_at  ≥  rules.intervalDays
 *   3. either never reminded, OR last reminder was sent ≥ intervalDays ago
 *
 * A query "needs escalation" (Phase 4C) when:
 *   1. Same active-status guard as above
 *   2. Total reminders sent for the query ≥ rules.escalateAfterReminders
 *   3. Not already escalated within 2× intervalDays
 *
 * localStorage keys (all scoped to engagementId):
 *   caflow-reminder-rules-{id}    → ReminderRules (JSON)
 *   caflow-reminders-sent-{id}    → Record<queryId, lastSentISO>
 *   caflow-reminder-counts-{id}   → Record<queryId, totalSentCount>  (Phase 4C)
 *   caflow-escalated-sent-{id}    → Record<queryId, lastEscalatedISO> (Phase 4C)
 */
import { useState, useCallback, useMemo } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ReminderRules {
  enabled:                boolean;
  intervalDays:           number;   // 3 | 5 | 7 | 10 | 14
  escalateAfterReminders: number;   // 2 | 3 | 5  (Phase 4C)
}

export const INTERVAL_OPTIONS  = [3, 5, 7, 10, 14] as const;
export const ESCALATE_OPTIONS  = [2, 3, 5]         as const;

export const DEFAULT_RULES: ReminderRules = {
  enabled:                true,
  intervalDays:           7,
  escalateAfterReminders: 3,
};

/** Minimal shape required by the engine — subset of ClientQuery */
export interface RemindableQuery {
  id:                  string;
  status:              string;
  created_at:          string | null;
  query_text:          string;
  ref_number?:         string | null;
  due_date?:           string | null;
  priority:            string;
  ledger_name?:        string | null;
  group_name?:         string | null;
  required_documents?: string | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ACTIVE_STATUSES = new Set(["Open", "Client Acknowledged"]);

function daysSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

function rulesKey(id: string)    { return `caflow-reminder-rules-${id}`;   }
function sentKey(id: string)     { return `caflow-reminders-sent-${id}`;   }
function countKey(id: string)    { return `caflow-reminder-counts-${id}`;  }
function escalatedKey(id: string){ return `caflow-escalated-sent-${id}`;   }

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useReminderEngine(
  engagementId: string,
  queries:      RemindableQuery[],
) {
  const [rules, setRulesState] = useState<ReminderRules>(() =>
    ({ ...DEFAULT_RULES, ...load<Partial<ReminderRules>>(rulesKey(engagementId), {}) }),
  );

  const [sentLog,      setSentLog]      = useState<Record<string, string>>(() => load(sentKey(engagementId),     {}));
  const [countLog,     setCountLog]     = useState<Record<string, number>>(() => load(countKey(engagementId),    {}));
  const [escalatedLog, setEscalatedLog] = useState<Record<string, string>>(() => load(escalatedKey(engagementId), {}));

  // ── Setters ──────────────────────────────────────────────────────────────

  const setRules = useCallback((next: ReminderRules) => {
    setRulesState(next);
    localStorage.setItem(rulesKey(engagementId), JSON.stringify(next));
  }, [engagementId]);

  /** Record that reminders were sent; also increments per-query send count */
  const markSent = useCallback((ids: string[]) => {
    const now = new Date().toISOString();

    setSentLog(prev => {
      const next = { ...prev };
      for (const id of ids) next[id] = now;
      localStorage.setItem(sentKey(engagementId), JSON.stringify(next));
      return next;
    });

    setCountLog(prev => {
      const next = { ...prev };
      for (const id of ids) next[id] = (next[id] ?? 0) + 1;
      localStorage.setItem(countKey(engagementId), JSON.stringify(next));
      return next;
    });
  }, [engagementId]);

  /** Record that an escalation email was sent for these queries */
  const markEscalated = useCallback((ids: string[]) => {
    const now = new Date().toISOString();
    setEscalatedLog(prev => {
      const next = { ...prev };
      for (const id of ids) next[id] = now;
      localStorage.setItem(escalatedKey(engagementId), JSON.stringify(next));
      return next;
    });
  }, [engagementId]);

  // ── Derived ──────────────────────────────────────────────────────────────

  /** Queries that should receive a regular reminder right now */
  const pendingReminders = useMemo<RemindableQuery[]>(() => {
    if (!rules.enabled) return [];
    return queries.filter(q => {
      if (!ACTIVE_STATUSES.has(q.status)) return false;
      if (!q.created_at)                  return false;
      if (daysSince(q.created_at) < rules.intervalDays) return false;

      const lastSent = sentLog[q.id];
      if (lastSent && daysSince(lastSent) < rules.intervalDays) return false;

      return true;
    });
  }, [queries, rules, sentLog]);

  /**
   * Phase 4C: Queries that should be escalated — they've received reminders
   * at least rules.escalateAfterReminders times with no response.
   */
  const escalationCandidates = useMemo<RemindableQuery[]>(() => {
    if (!rules.enabled) return [];
    return queries.filter(q => {
      if (!ACTIVE_STATUSES.has(q.status)) return false;
      const count = countLog[q.id] ?? 0;
      if (count < rules.escalateAfterReminders) return false;

      // Don't re-escalate within 2× the reminder interval
      const lastEsc = escalatedLog[q.id];
      if (lastEsc && daysSince(lastEsc) < rules.intervalDays * 2) return false;

      return true;
    });
  }, [queries, rules, countLog, escalatedLog]);

  /** Per-query reminder send count — exposed for display */
  const reminderCounts = countLog;

  return {
    rules,
    setRules,
    pendingReminders,
    escalationCandidates,
    reminderCounts,
    markSent,
    markEscalated,
  };
}
