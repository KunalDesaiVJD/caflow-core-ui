/**
 * analyze-coa-override — Edge function
 *
 * Called fire-and-forget every time a human overrides an AI COA mapping.
 * Uses Claude to understand WHY the override happened, then generates alias
 * ledger name variants (spelling variants, abbreviations, related names) that
 * should also resolve to the same account head in future.
 *
 * Strict rule: NEVER learns from party/person/business names — only from
 * generic accounting ledger names (bank charges, depreciation, rent, etc.)
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import Anthropic from "https://esm.sh/@anthropic-ai/sdk@0.27.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Heuristic: if normalized_name matches these patterns it's likely a party name
// and we must NOT generate aliases for it.
const PARTY_NAME_SIGNALS = [
  /\b(pvt|ltd|llp|inc|corp|co\.|enterprises|trading|industries|solutions|services|associates|brothers|sons|agency|suppliers)\b/i,
  /\b(mr|mrs|ms|dr|shri|smt|km)\b\.?\s+\w/i,          // title + name
  /^[A-Z][a-z]+\s+[A-Z][a-z]+\s+[A-Z][a-z]+$/,       // three-word proper name pattern
];

function looksLikePartyName(normalized: string): boolean {
  return PARTY_NAME_SIGNALS.some(r => r.test(normalized));
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    // ── Auth ──────────────────────────────────────────────────────────────────
    const authHeader = req.headers.get("Authorization") ?? "";
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const sb = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const {
      ledger_name,           // original ledger name as typed in Tally
      normalized_name,       // lowercased + trimmed
      entity_type,           // "nce" | "corporate" | "llp"
      ai_mapping_code,       // what AI suggested (fs_code / account_head code), null if no AI suggestion
      human_mapping_code,    // what human chose
      firm_id,
      engagement_id,
    } = await req.json();

    if (!normalized_name || !human_mapping_code || !entity_type) {
      return new Response(JSON.stringify({ skipped: true, reason: "missing required fields" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Skip party/business names — they must never generate global aliases ──
    if (looksLikePartyName(normalized_name)) {
      console.log(`[analyze-coa-override] Skipping party name: "${normalized_name}"`);
      return new Response(JSON.stringify({ skipped: true, reason: "party_name" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Fetch the current coa_mapping_intelligence row ───────────────────────
    const { data: intelRow } = await sb
      .from("coa_mapping_intelligence")
      .select("id, is_party_name, scope, aliases")
      .eq("normalized_name", normalized_name)
      .eq("entity_type", entity_type)
      .maybeSingle();

    // Double-check server-side is_party_name flag
    if (intelRow?.is_party_name || intelRow?.scope === "engagement") {
      console.log(`[analyze-coa-override] Skipping — is_party_name or engagement-scoped: "${normalized_name}"`);
      return new Response(JSON.stringify({ skipped: true, reason: "party_name_db" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Fetch human-readable COA labels for both codes ───────────────────────
    const codesToFetch = [human_mapping_code, ai_mapping_code].filter(Boolean);
    const { data: coaRows } = await sb
      .from("coa_master")
      .select("account_head, group_name, bs_pl")
      .in("account_head", codesToFetch);

    const coaMap: Record<string, { group_name: string | null; bs_pl: string | null }> = {};
    for (const r of (coaRows ?? [])) coaMap[r.account_head] = r;

    const humanLabel = coaMap[human_mapping_code]?.group_name
      ? `${human_mapping_code} (${coaMap[human_mapping_code].group_name})`
      : human_mapping_code;
    const aiLabel = ai_mapping_code
      ? (coaMap[ai_mapping_code]?.group_name
          ? `${ai_mapping_code} (${coaMap[ai_mapping_code].group_name})`
          : ai_mapping_code)
      : null;

    // ── Call Claude to analyse the override ──────────────────────────────────
    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY")!;
    const anthropic = new Anthropic({ apiKey: anthropicKey });

    const overrideContext = aiLabel
      ? `AI suggested: ${aiLabel}\nHuman corrected to: ${humanLabel}`
      : `Human confirmed mapping to: ${humanLabel} (no prior AI suggestion)`;

    const prompt = `You are an Indian CA audit AI trainer. A user has manually mapped a Tally ERP ledger to a Chart of Accounts head.

Ledger name: "${ledger_name}"
Entity type: ${entity_type.toUpperCase()}
${overrideContext}

Your job: analyse why the mapping was made and generate alias ledger name variants.

STRICT RULES — aliases must:
1. Be GENERIC accounting/expense/income names only — NEVER party, vendor, customer, or person names
2. Include: common abbreviations, spelling variants, alternative phrasings CA firms use in India
3. Be plausible Tally ledger names a bookkeeper might type
4. Each alias should be short (1-5 words), lowercase

Examples of GOOD aliases for "bank charges": ["bk charges", "bank chgs", "bank chrgs", "bank commission", "bank service charges", "bank processing fee", "bank transaction charges", "banking charges"]
Examples of BAD aliases (NEVER include): ["State Bank of India", "HDFC Bank Ltd", "Rajesh Kumar"] ← these are party names

Return ONLY valid JSON, no markdown:
{
  "reason_type": "SPELLING_VARIANT | ABBREVIATION | ALIAS | CONCEPTUAL_CORRECTION | ERROR_CORRECTION | CONFIRMED",
  "explanation": "One sentence explaining why this mapping makes sense and how aliases help",
  "aliases": ["alias1", "alias2", "alias3"],
  "is_generic_accounting_term": true
}

If the ledger name itself looks like a party/business/person name, return:
{ "reason_type": "PARTY_NAME", "explanation": "This is a party name", "aliases": [], "is_generic_accounting_term": false }`;

    const message = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 512,
      messages: [{ role: "user", content: prompt }],
    });

    const raw = message.content[0].type === "text" ? message.content[0].text : "{}";
    let analysis: {
      reason_type: string;
      explanation: string;
      aliases: string[];
      is_generic_accounting_term: boolean;
    };
    try {
      const cleaned = raw.replace(/```json\s*/g, "").replace(/```/g, "").trim();
      analysis = JSON.parse(cleaned);
    } catch {
      console.error("[analyze-coa-override] Failed to parse Claude response:", raw);
      return new Response(JSON.stringify({ error: "parse_failed" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      });
    }

    // Safety: if Claude thinks this is a party name, abort
    if (!analysis.is_generic_accounting_term || analysis.reason_type === "PARTY_NAME") {
      console.log(`[analyze-coa-override] Claude flagged party name: "${normalized_name}"`);
      return new Response(JSON.stringify({ skipped: true, reason: "claude_party_name" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Normalize aliases and merge with existing ────────────────────────────
    const normalizeAlias = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
    const newAliases: string[] = (analysis.aliases ?? [])
      .map(normalizeAlias)
      .filter(a => a.length > 1 && a !== normalized_name); // exclude self-references

    const existingAliases: string[] = Array.isArray(intelRow?.aliases) ? intelRow.aliases : [];
    const mergedAliases = [...new Set([...existingAliases, ...newAliases])].slice(0, 20); // cap at 20

    // ── Update coa_mapping_intelligence with aliases + analysis ───────────────
    if (intelRow?.id) {
      await sb
        .from("coa_mapping_intelligence")
        .update({
          aliases:         mergedAliases,
          override_reason: analysis.reason_type,
          ai_analysis:     analysis.explanation,
          ai_analyzed_at:  new Date().toISOString(),
        } as any)
        .eq("id", intelRow.id);

      // ── Upsert alias index rows ──────────────────────────────────────────
      if (newAliases.length > 0) {
        const aliasRows = newAliases.map(alias => ({
          alias_normalized: alias,
          canonical_id:     intelRow.id,
          account_head:     human_mapping_code,
          entity_type,
          reason_type:      analysis.reason_type,
          confidence_score: 80,
        }));

        // Upsert: if same alias+entity exists, update account_head + reason
        await sb
          .from("coa_alias_index")
          .upsert(aliasRows, { onConflict: "alias_normalized,entity_type", ignoreDuplicates: false });
      }
    }

    console.log(`[analyze-coa-override] Done for "${normalized_name}": ${analysis.reason_type}, ${newAliases.length} aliases added`);

    return new Response(
      JSON.stringify({
        success: true,
        reason_type: analysis.reason_type,
        explanation: analysis.explanation,
        aliases_added: newAliases.length,
        aliases: mergedAliases,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err: any) {
    console.error("[analyze-coa-override] Error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
