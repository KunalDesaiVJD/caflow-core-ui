/**
 * AI TDS-section identification (Ticket 2.3, Phase 2 — behind VITE_SCRUTINY_V2).
 *
 * Uses the existing `tds_section_identifier` gateway prompt (light/Haiku tier) to identify the
 * correct TDS section, rate and threshold for a finding's payment nature. Strictly additive +
 * graceful: `identifyTdsSectionWithAI` never throws and returns null on any failure.
 *
 * Pure request/response helpers are unit-tested; the invoke wrapper takes an injected invoker.
 */

import type { Finding, RuleTemplate } from "./scrutinyUi";
import type { EdgeInvoker } from "./aiQueryDraft";

/** Gateway request_type — must match SYSTEM_PROMPTS/LIGHT_TYPES in supabase/functions/claude-gateway. */
export const TDS_SECTION_IDENTIFIER = "tds_section_identifier";

export interface TdsSection {
  section: string;
  rate: number | null;
  threshold: number | null;
  flag_message: string;
}

const num = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const n = Number(v);
  return Number.isFinite(n) && v !== null && v !== "" ? n : null;
};

/** The prompt expects a plain-text "payment nature" — assemble it from the finding + rule. */
export function buildTdsSectionRequest(finding: Finding, rule?: RuleTemplate | null): string {
  return [rule?.rule_name, finding.narration, finding.flag_message].filter(Boolean).join(" — ");
}

/** Parse the gateway JSON into a TdsSection, or null if there's no usable section. */
export function parseTdsSectionResponse(data: unknown): TdsSection | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (typeof d.section !== "string" || d.section.trim() === "") return null;
  return {
    section: d.section.trim(),
    rate: num(d.rate),
    threshold: num(d.threshold),
    flag_message: String(d.flag_message ?? ""),
  };
}

/** Identify the TDS section for a finding via the gateway. Returns null on ANY failure. Never throws. */
export async function identifyTdsSectionWithAI(
  invoke: EdgeInvoker,
  finding: Finding,
  rule?: RuleTemplate | null,
): Promise<TdsSection | null> {
  try {
    const { data, error } = await invoke("claude-gateway", {
      body: { request_type: TDS_SECTION_IDENTIFIER, user_message: buildTdsSectionRequest(finding, rule) },
    });
    if (error) return null;
    return parseTdsSectionResponse(data);
  } catch {
    return null;
  }
}
