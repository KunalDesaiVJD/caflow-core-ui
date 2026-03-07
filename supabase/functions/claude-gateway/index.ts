import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const LIGHT_TYPES = new Set(["tds_section_identifier", "invoice_description"]);

const SYSTEM_PROMPTS: Record<string, string> = {
  tds_section_identifier:
    "You are an Indian tax expert specializing in TDS under the Income Tax Act, 1961. Identify the correct TDS section for the given payment nature. Return JSON only, no markdown: {\"section\":\"194C\",\"rate\":2,\"threshold\":30000,\"flag_message\":\"Brief reason\"}. Common sections: 194C contractor 1-2%, 194J(b) professional 10%, 194J(a) technical 2%, 194I(b) rent building 10%, 194I(a) rent machinery 2%, 194H commission 2%, 194Q purchase goods 0.1%, 194A interest 10%, 194T partner payment 10%, 194IB rent by individual 5%.",
  narration_batch_classifier:
    "You are an Indian CA audit assistant. Analyse journal entry narrations. Return JSON array only, no other text: [{\"entry_id\":\"\",\"category\":\"\",\"risk_level\":\"\",\"flag_reason\":\"\",\"suggested_3cd_clause\":\"\"}]. Categories: prior_period|loan_jv_settlement|accommodation_entry|cash_payment|interest_income_missed|subsidy_accounting|normal. Only flag genuinely suspicious entries.",
  ais_reconciliation:
    "You are a CA reconciling AIS with ITR. Identify mismatches. For each AIS item return JSON: {\"item_id\":\"\",\"matched\":true,\"mismatch_reason\":\"\",\"suggested_explanation\":\"\",\"itr_head\":\"\"}.",
  audit_report_drafter:
    "You are a Senior CA. Draft a formal audit report per ICAI SA standards. Return JSON: {\"opening_paragraph\":\"\",\"basis_for_opinion\":\"\",\"key_audit_matters\":[{\"title\":\"\",\"description\":\"\"}],\"management_responsibility\":\"\",\"auditor_responsibility\":\"\",\"opinion_paragraph\":\"\"}.",
  caro_answers:
    "You are a CA answering CARO 2020 clauses in formal ICAI language. Return JSON: {\"clause_id\":\"answer_text\"}.",
  comparative_commentary:
    "You are a CA writing MD&A commentary. Return 3 paragraphs: overall performance, key movements, audit implications.",
  notice_response_drafter:
    "You are a CA drafting an income tax notice response. Cite IT Act sections and CBDT circulars. Use a professional formal tone.",
  invoice_description:
    "You are a CA writing invoice line items. Return a JSON array of professional service descriptions.",
  workpaper_assistant:
    "You are a CA suggesting audit procedures. Return: specific tests, red flags, and SA standard references.",
  notes_drafter:
    "You are a CA drafting Notes to Accounts in Ind AS or AS format. Return the structured note as JSON.",
};

const RATE_LIMIT = 20;

function parseAiJson(content: string) {
  try {
    const cleaned = content.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
    return JSON.parse(cleaned);
  } catch {
    return { raw: content };
  }
}

function extractOpenAIContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && "text" in part) {
          const text = (part as { text?: unknown }).text;
          return typeof text === "string" ? text : "";
        }
        return "";
      })
      .join("\n")
      .trim();
  }
  return "";
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // --- STEP 1: Auth ---
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace("Bearer ", "").trim();

    if (!token) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const {
      data: { user },
      error: authError,
    } = await supabaseAdmin.auth.getUser(token);

    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get firm_id from users table
    const { data: profile } = await supabaseAdmin
      .from("users")
      .select("firm_id")
      .eq("id", user.id)
      .single();

    const firmId = profile?.firm_id ?? null;

    const body = await req.json();
    const { request_type, user_message, stream: wantStream } = body;

    if (!request_type || !user_message) {
      return new Response(JSON.stringify({ error: "Missing request_type or user_message" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const systemPrompt = SYSTEM_PROMPTS[request_type];
    if (!systemPrompt) {
      return new Response(JSON.stringify({ error: `Unknown request_type: ${request_type}` }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // --- STEP 2: Rate limit ---
    const { count, error: countError } = await supabaseAdmin
      .from("ai_usage_log")
      .select("*", { count: "exact", head: true })
      .eq("user_id", user.id)
      .gte("created_at", new Date(Date.now() - 3600_000).toISOString());

    if (countError) console.error("Rate limit check error:", countError);

    if ((count ?? 0) >= RATE_LIMIT) {
      return new Response(JSON.stringify({ error: "Rate limit exceeded. Max 20 AI calls per hour." }), {
        status: 429,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // --- STEP 3: Log ---
    await supabaseAdmin.from("ai_usage_log").insert({
      user_id: user.id,
      firm_id: firmId,
      request_type,
    });

    // --- STEP 4: Select model ---
    const isLightRequest = LIGHT_TYPES.has(request_type);
    const anthropicModel = isLightRequest ? "claude-haiku-4-5-20251001" : "claude-sonnet-4-20250514";
    const lovableModel = isLightRequest ? "google/gemini-2.5-flash-lite" : "google/gemini-3-flash-preview";
    const useStream = wantStream === true;

    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

    let provider: "anthropic" | "lovable" | null = null;
    let aiResponse: Response | null = null;

    // --- STEP 5: Primary provider (Anthropic) ---
    if (ANTHROPIC_API_KEY) {
      const anthropicResponse = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: anthropicModel,
          max_tokens: 4096,
          system: systemPrompt,
          messages: [{ role: "user", content: user_message }],
          stream: useStream,
        }),
      });

      if (anthropicResponse.ok) {
        provider = "anthropic";
        aiResponse = anthropicResponse;
      } else {
        const errText = await anthropicResponse.text();
        console.error("Anthropic error:", anthropicResponse.status, errText);

        const isAuthError = anthropicResponse.status === 401 || anthropicResponse.status === 403;
        if (!isAuthError || !LOVABLE_API_KEY) {
          const message = isAuthError
            ? "AI provider authentication failed. Please update ANTHROPIC_API_KEY."
            : "AI service error";

          return new Response(JSON.stringify({ error: message }), {
            status: anthropicResponse.status >= 500 ? 502 : anthropicResponse.status,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }
    }

    // --- STEP 6: Fallback provider (Lovable AI Gateway) ---
    if (!aiResponse && LOVABLE_API_KEY) {
      const gatewayResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: lovableModel,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: user_message },
          ],
          stream: useStream,
        }),
      });

      if (!gatewayResponse.ok) {
        const errText = await gatewayResponse.text();
        console.error("Lovable AI Gateway error:", gatewayResponse.status, errText);

        const message =
          gatewayResponse.status === 429
            ? "Rate limits exceeded, please try again later."
            : gatewayResponse.status === 402
              ? "Payment required, please add funds to your Lovable AI workspace."
              : "AI service error";

        return new Response(JSON.stringify({ error: message }), {
          status: gatewayResponse.status >= 500 ? 502 : gatewayResponse.status,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      provider = "lovable";
      aiResponse = gatewayResponse;
    }

    if (!aiResponse || !provider) {
      return new Response(JSON.stringify({ error: "No AI provider is configured." }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (useStream) {
      return new Response(aiResponse.body, {
        headers: {
          ...corsHeaders,
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
        },
      });
    }

    // Non-streaming: parse and return JSON
    const result = await aiResponse.json();

    const content =
      provider === "anthropic"
        ? result.content?.[0]?.text || ""
        : extractOpenAIContent(result.choices?.[0]?.message?.content);

    const parsed = parseAiJson(content);

    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("claude-gateway error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
