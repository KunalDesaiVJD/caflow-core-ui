/**
 * useFindingsStorage — Phase 5A
 *
 * Manages the Audit Findings Register for a single engagement.
 * Findings are persisted in localStorage under the key:
 *   caflow-findings-{engagementId}
 *
 * An AuditFinding represents a formal audit observation — distinct from
 * client queries (which are information requests). Findings are the
 * auditor's conclusions, documented with criteria, condition, impact,
 * recommendation, and management response.
 *
 * State machine:  open → management_responded → reviewed → closed
 */
import { useState, useCallback, useMemo } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

export type FindingRisk =
  | "critical"
  | "high"
  | "medium"
  | "low"
  | "informational";

export type FindingStatus =
  | "open"
  | "management_responded"
  | "reviewed"
  | "closed";

export interface AuditFinding {
  id:                  string;
  finding_no:          string;   // e.g. "F-001"
  // Classification
  category:            string;   // e.g. "Revenue", "Fixed Assets"
  risk_rating:         FindingRisk;
  // Core audit finding fields (Big-4 style)
  title:               string;
  observation:         string;   // What was found / condition
  criteria:            string;   // Standard / regulation / policy
  impact:              string;   // Effect / risk if unaddressed
  root_cause:          string;   // Why the issue exists
  recommendation:      string;   // Auditor's recommendation
  // Management response
  management_response: string;
  action_plan:         string;
  target_date:         string;   // ISO date — when management will remediate
  // Status & links
  status:              FindingStatus;
  linked_query_id?:    string;   // Corresponds to a QueryRow.id
  // Metadata
  raised_by:           string;
  raised_at:           string;   // ISO datetime
  updated_at:          string;   // ISO datetime
}

// ─── Metadata ─────────────────────────────────────────────────────────────────

export const RISK_META: Record<FindingRisk, {
  label: string; color: string; bg: string; border: string; dot: string; order: number;
}> = {
  critical:     { label: "Critical",     color: "text-red-700",    bg: "bg-red-100",    border: "border-red-300",    dot: "bg-red-600",    order: 0 },
  high:         { label: "High",         color: "text-orange-700", bg: "bg-orange-100", border: "border-orange-300", dot: "bg-orange-500", order: 1 },
  medium:       { label: "Medium",       color: "text-amber-700",  bg: "bg-amber-100",  border: "border-amber-300",  dot: "bg-amber-500",  order: 2 },
  low:          { label: "Low",          color: "text-blue-700",   bg: "bg-blue-100",   border: "border-blue-300",   dot: "bg-blue-500",   order: 3 },
  informational:{ label: "Info",         color: "text-gray-600",   bg: "bg-gray-100",   border: "border-gray-300",   dot: "bg-gray-400",   order: 4 },
};

export const STATUS_META: Record<FindingStatus, {
  label: string; color: string; bg: string; border: string;
}> = {
  open:                 { label: "Open",                color: "text-orange-700", bg: "bg-orange-50",  border: "border-orange-200" },
  management_responded: { label: "Mgmt. Responded",     color: "text-blue-700",   bg: "bg-blue-50",    border: "border-blue-200"   },
  reviewed:             { label: "Reviewed",            color: "text-purple-700", bg: "bg-purple-50",  border: "border-purple-200" },
  closed:               { label: "Closed",              color: "text-green-700",  bg: "bg-green-50",   border: "border-green-200"  },
};

export const AUDIT_CATEGORIES = [
  "Revenue & Sales",
  "Purchases & Expenses",
  "Fixed Assets",
  "Inventory",
  "Debtors & Receivables",
  "Creditors & Payables",
  "Cash & Bank",
  "Loans & Advances",
  "Investments",
  "Reserves & Surplus",
  "Taxation",
  "Compliance & Statutory",
  "Internal Controls",
  "Related Party Transactions",
  "Contingent Liabilities",
  "Other",
] as const;

// ─── localStorage helpers ─────────────────────────────────────────────────────

function storageKey(id: string) { return `caflow-findings-${id}`; }

function loadFindings(id: string): AuditFinding[] {
  try {
    const raw = localStorage.getItem(storageKey(id));
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveFindings(id: string, findings: AuditFinding[]): void {
  localStorage.setItem(storageKey(id), JSON.stringify(findings));
}

function genId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function nextFindingNo(existing: AuditFinding[]): string {
  const nums = existing
    .map(f => parseInt(f.finding_no.replace(/[^0-9]/g, ""), 10))
    .filter(n => !isNaN(n));
  const max = nums.length > 0 ? Math.max(...nums) : 0;
  return `F-${String(max + 1).padStart(3, "0")}`;
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useFindingsStorage(engagementId: string) {
  const [findings, setFindings] = useState<AuditFinding[]>(() =>
    loadFindings(engagementId),
  );

  const persist = useCallback((next: AuditFinding[]) => {
    setFindings(next);
    saveFindings(engagementId, next);
  }, [engagementId]);

  // ── CRUD ──────────────────────────────────────────────────────────────────

  const addFinding = useCallback((overrides?: Partial<AuditFinding>): string => {
    const id  = genId();
    const now = new Date().toISOString();
    const finding: AuditFinding = {
      id,
      finding_no:          nextFindingNo(findings),
      category:            "Other",
      risk_rating:         "medium",
      title:               "",
      observation:         "",
      criteria:            "",
      impact:              "",
      root_cause:          "",
      recommendation:      "",
      management_response: "",
      action_plan:         "",
      target_date:         "",
      status:              "open",
      raised_by:           "",
      raised_at:           now,
      updated_at:          now,
      ...overrides,
    };
    persist([...findings, finding]);
    return id;
  }, [findings, persist]);

  const updateFinding = useCallback(<K extends keyof AuditFinding>(
    id: string,
    field: K,
    value: AuditFinding[K],
  ) => {
    persist(findings.map(f =>
      f.id === id
        ? { ...f, [field]: value, updated_at: new Date().toISOString() }
        : f,
    ));
  }, [findings, persist]);

  const deleteFinding = useCallback((id: string) => {
    persist(findings.filter(f => f.id !== id));
  }, [findings, persist]);

  const advanceStatus = useCallback((id: string) => {
    const ORDER: FindingStatus[] = ["open", "management_responded", "reviewed", "closed"];
    persist(findings.map(f => {
      if (f.id !== id) return f;
      const i = ORDER.indexOf(f.status);
      const next = ORDER[Math.min(i + 1, ORDER.length - 1)];
      return { ...f, status: next, updated_at: new Date().toISOString() };
    }));
  }, [findings, persist]);

  /** Pre-populate a new finding from an anomaly / query raise */
  const addFromQuery = useCallback((
    queryId:   string,
    group:     string,
    ledger:    string,
    noteText?: string,
  ): string => {
    return addFinding({
      category:       group || "Other",
      title:          ledger ? `Issue in ${ledger}` : group || "New Finding",
      observation:    noteText || "",
      linked_query_id: queryId,
    });
  }, [addFinding]);

  // ── Derived stats ─────────────────────────────────────────────────────────

  const riskCounts = useMemo(() => {
    const c: Record<FindingRisk, number> = {
      critical: 0, high: 0, medium: 0, low: 0, informational: 0,
    };
    for (const f of findings) c[f.risk_rating] = (c[f.risk_rating] ?? 0) + 1;
    return c;
  }, [findings]);

  const statusCounts = useMemo(() => {
    const c: Record<FindingStatus, number> = {
      open: 0, management_responded: 0, reviewed: 0, closed: 0,
    };
    for (const f of findings) c[f.status] = (c[f.status] ?? 0) + 1;
    return c;
  }, [findings]);

  const openCount   = statusCounts.open + statusCounts.management_responded;
  const closedCount = statusCounts.reviewed + statusCounts.closed;

  return {
    findings,
    addFinding,
    updateFinding,
    deleteFinding,
    advanceStatus,
    addFromQuery,
    riskCounts,
    statusCounts,
    openCount,
    closedCount,
  };
}
