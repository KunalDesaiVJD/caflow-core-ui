/**
 * AI query drafting (Ticket 2.4, Phase 2 — behind VITE_SCRUTINY_V2).
 *
 * When the maker raises a finding as a query, we ask `claude-gateway` (top-tier / judgment
 * model, canonical decision #12) to draft a polished client query. This is STRICTLY additive:
 * `draftQueryWithAI` never throws and returns null on any failure (gateway not deployed, no
 * ANTHROPIC_API_KEY, rate limit, bad JSON) — the caller then falls back to the deterministic
 * template text. So the feature works with or without the gateway live.
 *
 * The pure request/response helpers are unit-tested; the thin invoke wrapper takes an injected
 * invoker so it needs no Supabase client to test.
 */

import type { Finding, RuleTemplate } from "./scrutinyUi";

/** Gateway request_type — must match SYSTEM_PROMPTS/HEAVY_TYPES in supabase/functions/claude-gateway. */
export const SCRUTINY_QUERY_DRAFTER = "scrutiny_query_drafter";

/** Build the JSON payload the gateway prompt expects for a finding. */
export function buildQueryDraftRequest(finding: Finding, rule?: RuleTemplate | null): string {
  return JSON.stringify({
    rule_id: finding.rule_id,
    rule_name: rule?.rule_name ?? null,
    severity: finding.severity,
    legal_reference: rule?.legal_reference ?? null,
    ledger: finding.narration, // the engine stores the account/ledger here
    finding: finding.flag_message,
  });
}

/** Extract a usable query string from the gateway's parsed JSON response, or null. */
export function parseQueryDraftResponse(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const q = (data as { query_text?: unknown }).query_text;
  return typeof q === "string" && q.trim().length > 0 ? q.trim() : null;
}

/** Minimal shape of `supabase.functions.invoke` — injected so this is testable without Supabase. */
export type EdgeInvoker = (
  fn: string,
  opts: { body: unknown },
) => Promise<{ data: unknown; error: unknown }>;

/**
 * Draft a client query for a finding via the gateway. Returns the AI text, or null on ANY
 * failure so the caller can fall back to the deterministic template. Never throws.
 */
export async function draftQueryWithAI(
  invoke: EdgeInvoker,
  finding: Finding,
  rule?: RuleTemplate | null,
): Promise<string | null> {
  try {
    const { data, error } = await invoke("claude-gateway", {
      body: { request_type: SCRUTINY_QUERY_DRAFTER, user_message: buildQueryDraftRequest(finding, rule) },
    });
    if (error) return null;
    return parseQueryDraftResponse(data);
  } catch {
    return null;
  }
}
