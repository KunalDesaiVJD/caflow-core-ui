// TEMPORARY diagnostic — probes AI providers to see which works. DELETE after use.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

serve(async (req) => {
  const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*" };
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const j = (o: unknown) => new Response(JSON.stringify(o), { headers: { ...cors, "Content-Type": "application/json" } });

  const url = new URL(req.url);
  const provider = url.searchParams.get("provider") || "lovable";
  const model = url.searchParams.get("model") || "";
  const has = {
    anthropic: !!Deno.env.get("ANTHROPIC_API_KEY"),
    openrouter: !!Deno.env.get("OPENROUTER_API_KEY"),
    lovable: !!Deno.env.get("LOVABLE_API_KEY"),
  };

  if (provider === "lovable") {
    const key = Deno.env.get("LOVABLE_API_KEY");
    if (!key) return j({ has, error: "no lovable key" });
    const m = model || "google/gemini-2.5-flash";
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: m, max_tokens: 8000, messages: [{ role: "system", content: "Reply JSON only." }, { role: "user", content: "Return {\"ok\":true}" }] }),
    });
    return j({ has, provider, model: m, status: res.status, body: (await res.text()).slice(0, 700) });
  }

  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) return j({ has, error: "no anthropic key" });
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: model || "claude-sonnet-4-20250514", max_tokens: 1000, system: "JSON only.", messages: [{ role: "user", content: [{ type: "text", text: "Return {\"ok\":true}" }] }] }),
  });
  return j({ has, provider: "anthropic", status: res.status, body: (await res.text()).slice(0, 700) });
});
