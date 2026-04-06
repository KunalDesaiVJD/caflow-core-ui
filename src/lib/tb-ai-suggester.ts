// ─────────────────────────────────────────────────────────────────────────────
// CAFlow — TB AI Suggestion Workflow (N.8)
//
// Generates AI suggestions for ledgers that the validator flags as uncertain.
// Uses the Supabase Edge Function `ai-tb-classify` which calls the Claude API.
//
// Design:
//   1. Caller passes a list of uncertain TbResolvedRow nodes.
//   2. This module batches them (max 20 per request) and calls the edge function.
//   3. Each response becomes a TbAiSuggestion stored in tb_ai_suggestions.
//   4. The UI reads suggestions from the table and presents them to the user.
//   5. Accept → creates/updates TbManualOverride + marks suggestion "accepted".
//   6. Reject → marks suggestion "rejected", no override created.
//
// Auto-apply threshold:
//   Suggestions with confidence >= AUTO_APPLY_THRESHOLD and matching a small
//   set of safe-to-auto-apply cases (e.g. obvious Expenses misclassified as BS)
//   are applied without user confirmation, with an "auto_applied" status.
//   All other suggestions require explicit user Accept.
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from "@/integrations/supabase/client";
import type { TbResolvedRow, TbAiSuggestion, TbManualOverride, TbSectionType } from "./tb-types";

const AUTO_APPLY_THRESHOLD = 0.95;
const BATCH_SIZE = 20;

// ── Request/response types for the edge function ──────────────────────────────
interface AiClassifyRequest {
  nodes: Array<{
    normalizedName: string;
    name: string;
    hierarchyPath: string;
    currentSection: TbSectionType;
    closing: number;
  }>;
  constitutionType?: string;
}

interface AiClassifyResponse {
  suggestions: Array<{
    normalizedName: string;
    suggestedSection: TbSectionType;
    suggestedNormalBal: "Dr" | "Cr";
    rationale: string;
    confidence: number;
  }>;
}

// ── Batch caller ──────────────────────────────────────────────────────────────
async function callAiClassify(
  batch: TbResolvedRow[],
  constitutionType?: string,
): Promise<AiClassifyResponse["suggestions"]> {
  const payload: AiClassifyRequest = {
    nodes: batch.map(n => ({
      normalizedName: n.normalizedName,
      name: n.name,
      hierarchyPath: n.hierarchyPath,
      currentSection: n.section,
      closing: n.closing,
    })),
    constitutionType,
  };

  const { data, error } = await supabase.functions.invoke("ai-tb-classify", {
    body: payload,
  });

  if (error) throw new Error(`AI classify failed: ${error.message}`);
  return (data as AiClassifyResponse).suggestions ?? [];
}

// ── Main export ───────────────────────────────────────────────────────────────
/**
 * Generate AI suggestions for a list of uncertain/unclassified nodes.
 *
 * @param nodes         Nodes to classify (typically: section === "unknown" or low confidence)
 * @param importId      Current import ID
 * @param engagementId  Engagement ID
 * @param constitutionType  Detected constitution type (optional, improves accuracy)
 * @returns             Array of created TbAiSuggestion records
 */
export async function generateAiSuggestions(
  nodes: TbResolvedRow[],
  importId: string,
  engagementId: string,
  constitutionType?: string,
): Promise<TbAiSuggestion[]> {
  if (nodes.length === 0) return [];

  const allSuggestions: TbAiSuggestion[] = [];
  const now = new Date().toISOString();

  // Process in batches
  for (let i = 0; i < nodes.length; i += BATCH_SIZE) {
    const batch = nodes.slice(i, i + BATCH_SIZE);
    let aiResults: AiClassifyResponse["suggestions"] = [];

    try {
      aiResults = await callAiClassify(batch, constitutionType);
    } catch (err) {
      console.warn("AI classify batch failed:", err);
      continue;
    }

    // Map AI results back to TbAiSuggestion records
    for (const result of aiResults) {
      const sourceNode = batch.find(n => n.normalizedName === result.normalizedName);
      if (!sourceNode) continue;

      // Determine status: auto-apply if confidence is very high
      const autoApply =
        result.confidence >= AUTO_APPLY_THRESHOLD &&
        isSafeToAutoApply(sourceNode, result.suggestedSection);
      const status = autoApply ? "auto_applied" : "pending";

      const suggestion: TbAiSuggestion = {
        suggestionId: `${importId}_ai_${result.normalizedName}_${Date.now()}`,
        importId,
        engagementId,
        normalizedName: result.normalizedName,
        suggestedSection: result.suggestedSection,
        suggestedNormalBal: result.suggestedNormalBal,
        rationale: result.rationale,
        confidence: result.confidence,
        status,
        createdAt: now,
        ...(autoApply && { resolvedAt: now, resolvedBy: "auto" }),
      };

      allSuggestions.push(suggestion);
    }

    // Store suggestions in DB
    const { error } = await supabase
      .from("tb_ai_suggestions")
      .upsert(
        allSuggestions.map(s => ({
          suggestion_id: s.suggestionId,
          import_id: s.importId,
          engagement_id: s.engagementId,
          normalized_name: s.normalizedName,
          suggested_section: s.suggestedSection,
          suggested_normal_bal: s.suggestedNormalBal,
          rationale: s.rationale,
          confidence: s.confidence,
          status: s.status,
          created_at: s.createdAt,
          resolved_at: s.resolvedAt ?? null,
          resolved_by: s.resolvedBy ?? null,
        })),
        { onConflict: "suggestion_id" },
      );

    if (error) console.warn("Failed to store AI suggestions:", error);
  }

  return allSuggestions;
}

// ── Accept a suggestion ───────────────────────────────────────────────────────
/**
 * Accept an AI suggestion: creates/updates a TbManualOverride and marks the
 * suggestion as "accepted".
 */
export async function acceptAiSuggestion(
  suggestion: TbAiSuggestion,
  userId: string,
  displayName: string,
): Promise<{ overrideId: string }> {
  const overrideId = `ov_${suggestion.engagementId}_${suggestion.normalizedName}`.slice(0, 100);
  const now = new Date().toISOString();

  const override: Omit<TbManualOverride, "createdAt" | "updatedAt"> & { createdAt: string; updatedAt: string } = {
    overrideId,
    engagementId: suggestion.engagementId,
    normalizedName: suggestion.normalizedName,
    displayName,
    section: suggestion.suggestedSection,
    normalBal: suggestion.suggestedNormalBal,
    overrideFields: [
      ...(suggestion.suggestedSection ? ["section" as const] : []),
      ...(suggestion.suggestedNormalBal ? ["normalBal" as const] : []),
    ],
    locked: false,
    createdBy: userId,
    createdAt: now,
    updatedAt: now,
    note: `AI suggestion accepted (confidence: ${(suggestion.confidence * 100).toFixed(0)}%). Rationale: ${suggestion.rationale}`,
  };

  // Upsert override
  const { error: ovErr } = await supabase
    .from("tb_manual_overrides")
    .upsert({
      override_id: override.overrideId,
      engagement_id: override.engagementId,
      normalized_name: override.normalizedName,
      display_name: override.displayName,
      section: override.section,
      normal_bal: override.normalBal,
      override_fields: override.overrideFields,
      locked: override.locked,
      created_by: override.createdBy,
      created_at: override.createdAt,
      updated_at: override.updatedAt,
      note: override.note,
    }, { onConflict: "override_id" });

  if (ovErr) throw new Error(`Failed to create override: ${ovErr.message}`);

  // Mark suggestion as accepted
  const { error: sugErr } = await supabase
    .from("tb_ai_suggestions")
    .update({
      status: "accepted",
      resulting_override_id: overrideId,
      resolved_at: now,
      resolved_by: userId,
    })
    .eq("suggestion_id", suggestion.suggestionId);

  if (sugErr) console.warn("Failed to update suggestion status:", sugErr);

  return { overrideId };
}

// ── Reject a suggestion ───────────────────────────────────────────────────────
export async function rejectAiSuggestion(
  suggestionId: string,
  userId: string,
): Promise<void> {
  const { error } = await supabase
    .from("tb_ai_suggestions")
    .update({
      status: "rejected",
      resolved_at: new Date().toISOString(),
      resolved_by: userId,
    })
    .eq("suggestion_id", suggestionId);

  if (error) throw new Error(`Failed to reject suggestion: ${error.message}`);
}

// ── Safe-to-auto-apply heuristic ──────────────────────────────────────────────
/**
 * Returns true if this suggestion is low-risk enough to apply without asking the user.
 * Conditions:
 *   - The current classification is "unknown" (we have nothing to lose)
 *   - OR the reclassification is within the same BS/PL side (asset→liability is NOT safe)
 */
function isSafeToAutoApply(
  node: TbResolvedRow,
  suggestedSection: TbSectionType | undefined,
): boolean {
  if (!suggestedSection) return false;
  // Always safe if currently unknown
  if (node.section === "unknown") return true;
  // Within same side: bs_asset → bs_liability is NOT safe; pl_income → pl_expense is NOT safe
  // but bs_asset → bs_asset (normalBal change) could be safe
  const currentSide = node.section.startsWith("bs") ? "bs" : node.section.startsWith("pl") ? "pl" : "?";
  const suggestedSide = suggestedSection.startsWith("bs") ? "bs" : suggestedSection.startsWith("pl") ? "pl" : "?";
  // Only auto-apply within the same side, and only if it's the less-risky direction
  return currentSide === suggestedSide;
}
