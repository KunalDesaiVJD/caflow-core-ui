/**
 * AI narration classification (Ticket 2.2, Phase 2 — behind VITE_SCRUTINY_V2).
 *
 * Uses the existing `narration_batch_classifier` gateway prompt (standard tier) to classify a
 * batch of findings by their narrative: category, risk level, and a suggested 3CD clause the
 * auditor can one-click apply. Strictly additive + graceful: `classifyFindingsWithAI` never
 * throws and returns {} on any failure (gateway not deployed, no key, rate limit, bad JSON).
 *
 * Pure request/response helpers are unit-tested; the invoke wrapper takes an injected invoker.
 */

import type { Finding } from "./scrutinyUi";
import type { EdgeInvoker } from "./aiQueryDraft";

/** Gateway request_type — must match SYSTEM_PROMPTS in supabase/functions/claude-gateway. */
export const NARRATION_BATCH_CLASSIFIER = "narration_batch_classifier";

export interface NarrationClass {
  category: string;
  risk_level: string;
  flag_reason: string;
  suggested_3cd_clause: string;
}

/** Build the JSON array the classifier prompt expects: [{entry_id, narration}]. */
export function buildNarrationBatchRequest(findings: Finding[]): string {
  return JSON.stringify(findings.map((f) => ({ entry_id: f.id, narration: f.flag_message ?? "" })));
}

/** Parse the classifier's JSON array into a finding_id -> classification map. */
export function parseNarrationBatchResponse(data: unknown): Record<string, NarrationClass> {
  const out: Record<string, NarrationClass> = {};
  if (!Array.isArray(data)) return out; // gateway returns {raw:...} on a parse failure -> ignore
  for (const item of data) {
    if (item && typeof item === "object" && typeof (item as { entry_id?: unknown }).entry_id === "string") {
      const it = item as Record<string, unknown>;
      out[it.entry_id as string] = {
        category: String(it.category ?? ""),
        risk_level: String(it.risk_level ?? ""),
        flag_reason: String(it.flag_reason ?? ""),
        suggested_3cd_clause: String(it.suggested_3cd_clause ?? ""),
      };
    }
  }
  return out;
}

/** Classify findings via the gateway. Returns {} on ANY failure so callers can no-op. Never throws. */
export async function classifyFindingsWithAI(
  invoke: EdgeInvoker,
  findings: Finding[],
): Promise<Record<string, NarrationClass>> {
  try {
    if (findings.length === 0) return {};
    const { data, error } = await invoke("claude-gateway", {
      body: { request_type: NARRATION_BATCH_CLASSIFIER, user_message: buildNarrationBatchRequest(findings) },
    });
    if (error) return {};
    return parseNarrationBatchResponse(data);
  } catch {
    return {};
  }
}
