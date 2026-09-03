/**
 * audit-3ca-extract-date
 *
 * Reads the filing date off a filed Form 3CA/3CB + 3CD (PDF or scanned
 * image) so the "3CA/3CB+3CD Uploaded By" dialog in Audit Tracker can
 * pre-fill the Upload Date field instead of making the auditor retype it.
 * The auditor can still edit the result — a misread scan must never
 * silently corrupt the compliance record.
 *
 * Input (POST, Bearer auth):
 *   { pdf_base64?: string, image_base64?: string, image_media_type?: string,
 *     file_name?: string }
 * Output: { date: "YYYY-MM-DD" | null, confidence: "high"|"medium"|"low"|"unavailable" }
 *
 * Requires the ANTHROPIC_API_KEY secret. Fails soft — any missing key,
 * provider error or unparseable reply returns confidence "unavailable"
 * rather than a hard failure, so the auditor can always fall back to typing
 * the date in manually.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SYSTEM_PROMPT = `You read a filed Indian Income Tax Form 3CA/3CB and Form 3CD (a tax audit report). Find the date the audit report was SIGNED / FILED — normally printed next to the Chartered Accountant's signature, the UDIN, membership number, or a "Place: ... Date: ..." line near the end of Form 3CA or 3CB.

Do NOT use an unrelated date such as the financial year end (31/03/...), the appointment date, or a date appearing only in the body of Form 3CD schedules — only the signing/filing date near the signature block.

Return STRICT JSON only, no markdown, no prose: {"date":"YYYY-MM-DD","confidence":"high"|"medium"|"low"} or {"date":null,"confidence":"low"} if no such date can be found.`;

function extractJson(text: string): { date: string | null; confidence: string } {
  try {
    const cleaned = text.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
    const parsed = JSON.parse(cleaned);
    const date = typeof parsed?.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(parsed.date) ? parsed.date : null;
    const confidence = ["high", "medium", "low"].includes(parsed?.confidence) ? parsed.confidence : "low";
    return { date, confidence: date ? confidence : "low" };
  } catch {
    return { date: null, confidence: "unavailable" };
  }
}

async function fetchWithTimeout(url: string, init: RequestInit, ms = 45000): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try { return await fetch(url, { ...init, signal: ctrl.signal }); }
  finally { clearTimeout(t); }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "").trim();
    if (!token) return json({ error: "Unauthorized" }, 401);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) return json({ error: "Unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const { pdf_base64, image_base64, image_media_type, file_name } = body ?? {};
    if (!pdf_base64 && !image_base64) {
      return json({ error: "Provide `pdf_base64` or `image_base64`." }, 400);
    }

    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    if (!ANTHROPIC_API_KEY) {
      // Fails soft — the dialog just leaves the date blank for manual entry.
      return json({ date: null, confidence: "unavailable" });
    }

    const userContent: unknown[] = [{ type: "text", text: `Filed form file name: ${file_name || "unknown"}` }];
    if (pdf_base64) {
      userContent.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: pdf_base64 } });
    } else {
      userContent.push({ type: "image", source: { type: "base64", media_type: image_media_type || "image/png", data: image_base64 } });
    }

    let res: Response;
    try {
      res = await fetchWithTimeout("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
          ...(pdf_base64 ? { "anthropic-beta": "pdfs-2024-09-25" } : {}),
        },
        body: JSON.stringify({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 300,
          system: SYSTEM_PROMPT,
          messages: [{ role: "user", content: userContent }],
        }),
      });
    } catch (e) {
      console.error("audit-3ca-extract-date: provider request failed", e);
      return json({ date: null, confidence: "unavailable" });
    }

    if (!res.ok) {
      console.error("audit-3ca-extract-date: Anthropic error", res.status, await res.text());
      return json({ date: null, confidence: "unavailable" });
    }

    const result = await res.json();
    const text = Array.isArray(result?.content)
      ? result.content.filter((b: any) => b?.type === "text").map((b: any) => b.text).join("")
      : "";

    return json(extractJson(text));
  } catch (e) {
    console.error("audit-3ca-extract-date error:", e);
    return json({ date: null, confidence: "unavailable" });
  }
});
