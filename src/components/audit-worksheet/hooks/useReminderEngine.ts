/**
 * useReminderEngine — Phase 4A
 *
 * Evaluates which audit_client_queries are due for a follow-up reminder
 * based on configurable rules stored per engagement in localStorage.
 *
 * A query "needs reminder" when ALL of:
 *   1. status is "Open" or "Client Acknowledged"
 *   2. days since created_at  ≥  rules.intervalDays
 *   3. either never reminded, OR last reminder was sent ≥ intervalDays ago
 *
 * Rules stored at: caflow-reminder-rules-{engagementId}
 * Sent log  stored at: caflow-reminders-sent-{engagementId}
 *   → Record<queryId, lastSentISOString>
 */
import { useState, useCallback, useMemo } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ReminderRules {
  enabled:      boolean;
  intervalDays: number;   // 3 | 5 | 7 | 10 | 14
}

export const INTERVAL_OPTIONS = [3, 5, 7, 10, 14] as const;

export const DEFAULT_RULES: ReminderRules = { enabled: true, intervalDays: 7 };

/** Minimal shape required by the engine — subset of ClientQuery */
export interface RemindableQuery {
  id:                 string;
  status:             string;
  created_at:         string | null;
  query_text:         string;
  ref_number?:        string | null;
  due_date?:          string | null;
  priority:           string;
  ledger_name?:       string | null;
  group_name?:        string | null;
  required_documents?:string | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ACTIVE_STATUSES = new Set(["Open", "Client Acknowledged"]);

function daysSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

function rulesKey(id: string) { return `caflow-reminder-rules-${id}`; }
function sentKey(id: string)  { return `caflow-reminders-sent-${id}`;  }

function loadRules(engagementId: string): ReminderRules {
  try {
    const raw = localStorage.getItem(rulesKey(engagementId));
    return raw ? { ...DEFAULT_RULES, ...JSON.parse(raw) } : { ...DEFAULT_RULES };
  } catch {
    return { ...DEFAULT_RULES };
  }
}

function loadSent(engagementId: string): Record<string, string> {
  try {
    const raw = localStorage.getItem(sentKey(engagementId));
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useReminderEngine(
  engagementId: string,
  queries:      RemindableQuery[],
) {
  const [rules, setRulesState] = useState<ReminderRules>(
    () => loadRules(engagementId),
  );

  const [sentLog, setSentLog] = useState<Record<string, string>>(
    () => loadSent(engagementId),
  );

  /** Persist + update rules */
  const setRules = useCallback((next: ReminderRules) => {
    setRulesState(next);
    localStorage.setItem(rulesKey(engagementId), JSON.stringify(next));
  }, [engagementId]);

  /** Record that reminders were just sent for these query IDs */
  const markSent = useCallback((ids: string[]) => {
    setSentLog(prev => {
      const now  = new Date().toISOString();
      const next = { ...prev };
      for (const id of ids) next[id] = now;
      localStorage.setItem(sentKey(engagementId), JSON.stringify(next));
      return next;
    });
  }, [engagementId]);

  /** Queries that should receive a reminder right now */
  const pendingReminders = useMemo<RemindableQuery[]>(() => {
    if (!rules.enabled) return [];
    return queries.filter(q => {
      if (!ACTIVE_STATUSES.has(q.status))  return false;
      if (!q.created_at)                   return false;
      if (daysSince(q.created_at) < rules.intervalDays) return false;

      const lastSent = sentLog[q.id];
      if (lastSent && daysSince(lastSent) < rules.intervalDays) return false;

      return true;
    });
  }, [queries, rules, sentLog]);

  return {
    rules,
    setRules,
    pendingReminders,
    markSent,
  };
}
