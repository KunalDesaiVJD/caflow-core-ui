/**
 * Scrutiny maker-checker (Ticket 1.3 — Design A: draft query row).
 *
 * A finding is raised into a DRAFT `audit_client_queries` row by the *maker*. A SECOND person
 * (the *checker*, who must differ from the maker) approves it — flipping the query
 * `Draft → Open` — before it can be dispatched to the client (canonical decision #7).
 *
 * Prod-safe by construction, no schema migration:
 *  - `audit_client_queries.status` is free-text, so Draft / Open / Rejected are just values.
 *  - Draft/Rejected queries are HIDDEN from every client surface. `CLIENT_HIDDEN_QUERY_STATUSES`
 *    is the single source both the scrutiny write path and the client portal import.
 *  - `AuditQueryDispatch` already lists only `status='Open'`, so a Draft can never be emailed.
 *  - Maker/checker IDENTITY is recorded on the finding (`actioned_by` / `reviewed_by`), reached
 *    from the query via `source_ref_id` — no new query columns.
 *
 * Pure + dependency-free → unit-testable without a DB.
 */

export const QUERY_STATUS_DRAFT = "Draft"; // raised, awaiting a second reviewer
export const QUERY_STATUS_OPEN = "Open"; // approved → dispatchable + client-visible
export const QUERY_STATUS_REJECTED = "Rejected"; // reviewer rejected; kept as an audit trail

/** Query statuses that must NEVER reach a client (unapproved / rejected scrutiny drafts). */
export const CLIENT_HIDDEN_QUERY_STATUSES: readonly string[] = [QUERY_STATUS_DRAFT, QUERY_STATUS_REJECTED];

/** `source` marker used for scrutiny-raised queries (matches the existing PipelineStage4 bridge). */
export const SCRUTINY_QUERY_SOURCE = "Scrutiny Finding";

export type QueryPriority = "High" | "Medium" | "Low";

/** Map a finding severity to the query priority (mirrors the PipelineStage4 bridge). */
export function priorityFromSeverity(severity: string | null | undefined): QueryPriority {
  const s = (severity ?? "").toLowerCase();
  if (s === "high") return "High";
  if (s === "medium") return "Medium";
  return "Low";
}

export interface DraftQuerySourceFinding {
  id: string;
  rule_id: string | null;
  severity: string | null;
  flag_message: string | null;
}

export interface BuildDraftQueryInput {
  finding: DraftQuerySourceFinding;
  /** the rule's `audit_query_template`, if available — preferred over the raw finding text */
  ruleQueryTemplate?: string | null;
  engagement_id?: string | null;
  client_id: string | null;
  firm_id?: string | null;
  financial_year: string | null;
}

export interface DraftQueryRow {
  engagement_id: string | null;
  client_id: string | null;
  firm_id: string | null;
  financial_year: string | null;
  query_text: string;
  source: string;
  source_ref_id: string;
  priority: QueryPriority;
  status: string;
}

/** Build the `audit_client_queries` insert payload for a finding raised as a DRAFT query. */
export function buildDraftQuery(input: BuildDraftQueryInput): DraftQueryRow {
  const template = input.ruleQueryTemplate?.trim();
  const query_text =
    (template && template.length > 0 ? template : null) ??
    input.finding.flag_message ??
    `Audit query for rule ${input.finding.rule_id ?? ""}`.trim();

  return {
    engagement_id: input.engagement_id ?? null,
    client_id: input.client_id,
    firm_id: input.firm_id ?? null,
    financial_year: input.financial_year,
    query_text,
    source: SCRUTINY_QUERY_SOURCE,
    source_ref_id: input.finding.id,
    priority: priorityFromSeverity(input.finding.severity),
    status: QUERY_STATUS_DRAFT,
  };
}

/**
 * Maker-checker guard (decision #7): a draft query may be approved/rejected only by someone
 * OTHER than the maker who raised it. `makerId` is the finding's `actioned_by`.
 */
export function canReviewQuery(
  makerId: string | null | undefined,
  currentUserId: string | null | undefined,
): boolean {
  return !!currentUserId && currentUserId !== makerId;
}

export type FindingQueryState = "none" | "draft" | "approved" | "rejected";

/** Derive the maker-checker state of a finding from its linked query's status. */
export function findingQueryState(linkedQueryStatus: string | null | undefined): FindingQueryState {
  if (!linkedQueryStatus) return "none";
  if (linkedQueryStatus === QUERY_STATUS_DRAFT) return "draft";
  if (linkedQueryStatus === QUERY_STATUS_REJECTED) return "rejected";
  return "approved"; // Open or any later client-visible status
}
