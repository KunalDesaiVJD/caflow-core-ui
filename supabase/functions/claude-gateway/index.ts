import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { request_type, user_message } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    let systemPrompt = "";

    if (request_type === "tds_section_identifier") {
      systemPrompt = `You are an Indian tax expert specializing in TDS (Tax Deducted at Source) under the Income Tax Act, 1961.

Given a payment nature/description, identify the correct TDS section and rate.

Available sections:
- 194C: Contractor payments (1% individual/HUF, 2% others)
- 194J(a): Technical services (2%)
- 194J(b): Professional services (10%)
- 194I(a): Rent on machinery/plant/equipment (2%)
- 194I(b): Rent on land/building/furniture (10%)
- 194H: Commission or brokerage (2%)  (was 5%, now 2% after budget changes)
- 194Q: Purchase of goods (0.1%)
- 194T: Payment to partners - salary/bonus/commission (10%)
- 194A: Interest other than on securities (10%)
- 194IB: Rent by individual/HUF (5%)

Respond ONLY with valid JSON (no markdown):
{
  "section": "194C",
  "rate": 2,
  "description": "Brief explanation of why this section applies",
  "confidence": "high" | "medium" | "low"
}`;
    } else {
      return new Response(JSON.stringify({ error: "Unknown request_type" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: user_message },
        ],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("AI gateway error:", response.status, errText);
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded, please try again later." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted. Please top up." }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: "AI service error" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "";

    // Parse the JSON from AI response
    let parsed;
    try {
      // Strip markdown code fences if present
      const cleaned = content.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
      parsed = JSON.parse(cleaned);
    } catch {
      parsed = { section: null, rate: null, description: content, confidence: "low" };
    }

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
