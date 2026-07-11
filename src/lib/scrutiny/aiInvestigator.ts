/**
 * NL command bar / grounded investigator (Phase 4, Ticket 4.1 — behind VITE_SCRUTINY_V2).
 *
 * The auditor asks a plain-English question; we assemble a compact, READ-ONLY snapshot of the
 * current scrutiny state (severity/category/ledger rollups, coverage, judgment facts, prior-year
 * recurrences) and ask `claude-gateway` (top-tier / judgment model) to answer over it. The AI has
 * NO database access and cannot write anything — it only reasons over the snapshot we send.
 *
 * Strictly additive + graceful: `investigateWithAI` never throws and returns null on any failure.
 * Pure request/response helpers are unit-tested; the invoke wrapper takes an injected invoker.
 */

import type { Finding } from "./scrutinyUi";
import type { EdgeInvoker } from "./aiQueryDraft";
import { groupByLedger } from "./workpaper";

/** Gateway request_type — must match SYSTEM_PROMPTS/HEAVY_TYPES in supabase/functions/claude-gateway. */
export const SCRUTINY_INVESTIGATOR = "scrutiny_investigator";

export interface InvestigatorInputs {
  findings: Finding[];
  coverage: { auto: number; advisory: number; total: number };
  facts: { captured: number; total: number; requiredCaptured: number; requiredTotal: number; missing: string[] };
  recurringCount: number;
  financialYear: string;
}

const sevU = (f: Finding): string => (f.severity ?? "").toUpperCase();

/** Build the compact read-only snapshot the investigator prompt reasons over. */
export function buildInvestigatorContext(inp: InvestigatorInputs) {
  const fs = inp.findings;
  const byCat = new Map<string, number>();
  for (const f of fs) {
    const cat = (f.rule_id ?? "").split("-")[0] || "GEN";
    byCat.set(cat, (byCat.get(cat) ?? 0) + 1);
  }
  const by_ledger = groupByLedger(fs).slice(0, 10).map((g) => ({ ledger: g.ledger, count: g.total, high: g.high }));
  return {
    financial_year: inp.financialYear,
    totals: {
      findings: fs.length,
      high: fs.filter((f) => sevU(f) === "HIGH").length,
      medium: fs.filter((f) => sevU(f) === "MEDIUM").length,
      low: fs.filter((f) => sevU(f) === "LOW").length,
    },
    by_category: [...byCat.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([category, count]) => ({ category, count })),
    by_ledger,
    coverage: inp.coverage,
    facts: {
      captured: inp.facts.captured,
      total: inp.facts.total,
      required_captured: inp.facts.requiredCaptured,
      required_total: inp.facts.requiredTotal,
      missing_required: inp.facts.missing.slice(0, 8),
    },
    recurring_from_prior_year: inp.recurringCount,
  };
}

/** { question, context } payload for the gateway. */
export function buildInvestigatorRequest(question: string, inp: InvestigatorInputs): string {
  return JSON.stringify({ question, context: buildInvestigatorContext(inp) });
}

/** Extract the answer text from the gateway response (accepts {answer}, or a raw string fallback). */
export function parseInvestigatorResponse(data: unknown): string | null {
  if (typeof data === "string") return data.trim() || null;
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (typeof d.answer === "string" && d.answer.trim()) return d.answer.trim();
  if (typeof d.raw === "string" && d.raw.trim()) return d.raw.trim(); // gateway parse-failure shape
  return null;
}

/** Identifiers the Tally-Sync-aware investigator needs to fetch live financial data. */
export interface InvestigatorIds {
  clientId: string;
  financialYear: string;
  engagementId: string | null;
}

/**
 * Ask the investigator. Prefers `scrutiny-investigator`, which enriches the context with LIVE Tally
 * Sync financials (ledger balances, TB, party balances, voucher stats) and delegates the LLM call to
 * claude-gateway — so questions about amounts are answered from real data, not "missing from snapshot".
 * Falls back to calling claude-gateway directly (finding rollups only) if that function is unavailable.
 * Returns the answer, or null on ANY failure (empty question, both paths down, bad JSON). Never throws.
 */
export async function investigateWithAI(
  invoke: EdgeInvoker,
  question: string,
  inp: InvestigatorInputs,
  ids?: InvestigatorIds,
): Promise<string | null> {
  if (!question.trim()) return null;

  // Preferred path: Tally-Sync-aware, financial-context-enriched investigator.
  if (ids?.clientId) {
    try {
      const { data, error } = await invoke("scrutiny-investigator", {
        body: {
          question,
          client_id: ids.clientId,
          financial_year: ids.financialYear,
          engagement_id: ids.engagementId,
          base_context: buildInvestigatorContext(inp),
        },
      });
      if (!error) {
        const ans = parseInvestigatorResponse(data);
        if (ans) return ans;
      }
    } catch {
      /* fall through to the direct gateway path */
    }
  }

  // Fallback: claude-gateway directly (finding rollups only, no live financials).
  try {
    const { data, error } = await invoke("claude-gateway", {
      body: { request_type: SCRUTINY_INVESTIGATOR, user_message: buildInvestigatorRequest(question, inp) },
    });
    if (error) return null;
    return parseInvestigatorResponse(data);
  } catch {
    return null;
  }
}
