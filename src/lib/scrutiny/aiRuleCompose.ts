/**
 * AI Rule Composer (client) — turns a plain-English description into a validated scrutiny rule.
 *
 * Calls the claude-gateway `scrutiny_rule_composer` request type, then runs the AI's draft through
 * the deterministic validator (ruleSpec.validateRule) so the UI only ever shows / applies a rule
 * that is well-formed and actually runnable. Never throws — returns a structured result.
 */

import { supabase } from "@/integrations/supabase/client";
import { validateRule, type ComposedRule, type ValidationResult } from "./ruleSpec";

export interface ComposeResult {
  /** true when a rule came back AND it passed validation (no errors) */
  ok: boolean;
  rule?: ComposedRule;
  explanation?: string;
  validation?: ValidationResult;
  error?: string;
}

export async function composeRuleFromPrompt(prompt: string): Promise<ComposeResult> {
  const text = (prompt ?? "").trim();
  if (!text) return { ok: false, error: "Describe the rule in a sentence." };

  try {
    const { data, error } = await supabase.functions.invoke("claude-gateway", {
      body: { request_type: "scrutiny_rule_composer", user_message: JSON.stringify({ prompt: text }) },
    });
    if (error) return { ok: false, error: error.message ?? "AI service unavailable." };

    const payload = data as { rule?: unknown; explanation?: string; raw?: string; error?: string } | null;
    if (!payload || payload.error) return { ok: false, error: payload?.error ?? "No response from the AI." };
    if (!payload.rule || typeof payload.rule !== "object") {
      return { ok: false, error: "The AI did not return a structured rule — try rephrasing the description." };
    }

    const rule = payload.rule as ComposedRule;
    const validation = validateRule(rule);
    return { ok: validation.valid, rule, explanation: payload.explanation, validation };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Compose failed." };
  }
}
