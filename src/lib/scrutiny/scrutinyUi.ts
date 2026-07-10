/**
 * Shared UI types + filter constants for the Scrutiny screens.
 *
 * Single source consumed by BOTH the v1 flat findings table (`pages/AuditScrutiny.tsx`)
 * and the v2 templates-first view (`components/scrutiny-v2/ScrutinyTemplatesView.tsx`),
 * so the two can never drift.
 */

/** A row from `scrutiny_findings` as rendered by the scrutiny UIs. */
export type Finding = {
  id: string;
  rule_id: string | null;
  client_id: string | null;
  severity: string | null;
  clause_3cd: string | null;
  flag_message: string | null;
  status: string | null;
  narration: string | null;
  financial_year: string | null;
  /** maker who raised a query from this finding (maker-checker); dev-only column */
  actioned_by?: string | null;
  /** the audit_client_queries row this finding was raised into, if any */
  linked_query_id?: string | null;
};

/** A row from the `scrutiny_rules` catalogue (the 119 templates). */
export interface RuleTemplate {
  rule_id: string;
  rule_name: string | null;
  category: string | null;
  /** jsonb — parse via `parseDetectionLogic` (tolerant of object|string|null). */
  detection_logic: unknown;
  threshold_value: number | string | null;
  threshold_type: string | null;
  severity: string | null;
  legal_reference: string | null;
  audit_query_template: string | null;
  is_active: boolean | null;
}

/** Severity filter options (shared by both scrutiny views). */
export const SEVERITIES = ["All", "HIGH", "MEDIUM", "LOW"] as const;

/** Finding-status filter options (shared by both scrutiny views). */
export const STATUSES = ["All", "Open", "Resolved", "Waived"] as const;
