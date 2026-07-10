/**
 * Client-portal query loop (Phase 8, Ticket 8.6 — behind VITE_SCRUTINY_V2).
 *
 * Closes the loop on a scrutiny-raised client query. The maker-checker path dispatches an approved
 * query (status `Open`); the client answers it in the portal, which flips the query to
 * `Reply Received` and stores `client_reply`. This helper classifies that lifecycle from the
 * AUDITOR's side and — when a reply has arrived but the linked finding is still open — flags an
 * auto-close candidate, so answered findings surface for a one-click resolve.
 *
 * The state names mirror the live `audit_client_queries.status` values used by the portal
 * (Open / Client Acknowledged / Reply Received / Clarified / Closed / Carried Forward). Pure +
 * dependency-free → unit-testable without a DB.
 */

export type ResponseState = "not_raised" | "awaiting_client" | "responded" | "closed";

const AWAITING = new Set(["open", "client acknowledged"]);
const RESPONDED = new Set(["reply received"]);
const CLOSED = new Set(["clarified", "closed", "carried forward"]);
// Draft / Rejected / null ⇒ not a live client-visible query ⇒ "not_raised".

const isFindingClosed = (s: string | null | undefined): boolean => {
  const u = (s ?? "").toLowerCase();
  return u === "resolved" || u === "waived";
};

export interface QueryLoopInput {
  queryStatus: string | null;
  clientReply?: string | null;
  findingStatus: string | null; // scrutiny finding: open / resolved / waived
}

export interface QueryLoopState {
  state: ResponseState;
  hasReply: boolean;
  /** a client reply has arrived but the finding is still open ⇒ recommend closing it */
  autoClose: boolean;
}

export function queryLoopState(inp: QueryLoopInput): QueryLoopState {
  const q = (inp.queryStatus ?? "").trim().toLowerCase();
  let state: ResponseState;
  if (RESPONDED.has(q)) state = "responded";
  else if (CLOSED.has(q)) state = "closed";
  else if (AWAITING.has(q)) state = "awaiting_client";
  else state = "not_raised";

  const hasReply = !!(inp.clientReply && inp.clientReply.trim());
  const autoClose = state === "responded" && !isFindingClosed(inp.findingStatus);
  return { state, hasReply, autoClose };
}

export interface QueryLoopSummary {
  awaitingClient: number;
  responded: number; // client answered — awaiting auditor review
  closed: number;
  autoCloseCandidates: number; // responded AND finding still open
}

export function queryLoopSummary(inputs: QueryLoopInput[]): QueryLoopSummary {
  const s: QueryLoopSummary = { awaitingClient: 0, responded: 0, closed: 0, autoCloseCandidates: 0 };
  for (const inp of inputs) {
    const r = queryLoopState(inp);
    if (r.state === "awaiting_client") s.awaitingClient++;
    else if (r.state === "responded") s.responded++;
    else if (r.state === "closed") s.closed++;
    if (r.autoClose) s.autoCloseCandidates++;
  }
  return s;
}
