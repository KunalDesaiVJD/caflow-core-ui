// TEMPORARY diagnostic — probes the Anthropic Messages API with the exact model
// the recon functions use, to confirm why it returns 400. DELETE after use.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

serve(async (req) => {
  const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*" };
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  const has = { anthropic: !!key, openrouter: !!Deno.env.get("OPENROUTER_API_KEY") };
  if (!key) return new Response(JSON.stringify({ has, error: "no anthropic key" }), { headers: { ...cors, "Content-Type": "application/json" } });

  const url = new URL(req.url);
  const mt = Number(url.searchParams.get("mt") || "32000");
  const model = url.searchParams.get("model") || "claude-sonnet-4-20250514";
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model, max_tokens: mt,
      system: "Reply with strict JSON only.",
      messages: [{ role: "user", content: [{ type: "text", text: "Return {\"ok\":true}" }] }],
    }),
  });
  const body = await res.text();
  return new Response(JSON.stringify({ has, model, max_tokens: mt, status: res.status, body: body.slice(0, 600) }),
    { headers: { ...cors, "Content-Type": "application/json" } });
});
