/**
 * audit-3ca-extract-date
 *
 * Reads an uploaded audit document (scanned audit report OR a filed Form
 * 3CA/3CB + 3CD PDF) for the "3CA/3CB+3CD Uploaded By" dialog in Audit
 * Tracker, and extracts:
 *   - assessee_name — the client/entity the report is ABOUT, so the dialog
 *     can flag a file that belongs to the wrong client.
 *   - date — the filing/signing date (filed-form call only matters for this;
 *     the dialog ignores it for the scanned-report call).
 * Both are best-effort and the auditor can still correct/override the date;
 * a name mismatch blocks the upload (see UploadConfirmDialog.tsx).
 *
 * Input (POST, Bearer auth):
 *   { pdf_base64?: string, image_base64?: string, image_media_type?: string,
 *     file_name?: string }
 * Output: { date: "YYYY-MM-DD" | null, confidence: "high"|"medium"|"low"|"unavailable",
 *           assessee_name: string | null }
 *
 * Requires the ANTHROPIC_API_KEY secret. Fails soft — any missing key,
 * provider error or unparseable reply returns nulls/"unavailable" rather
 * than a hard failure, so the auditor can always fall back to typing the
 * date in manually and isn't blocked by a name it couldn't read.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SYSTEM_PROMPT = `You read an Indian tax-audit document: either (a) a Chartered Accountant's scanned/signed audit report, or (b) a filed Income Tax Form 3CA/3CB and Form 3CD PDF (downloaded from the e-filing portal, usually digitally signed).

Extract TWO things:

1. assessee_name — the name of the ENTITY BEING AUDITED (the client whose accounts these are). NOT the Chartered Accountant's own name, and NOT the audit firm's name. Look for phrases like "Name of the assessee", "In the case of ...", "M/s ...", "the accounts of ...", "the Balance Sheet of ...". This is the company/firm/proprietorship the report is ABOUT — return null only if you genuinely cannot find it.

2. date — the date this document was SIGNED / FILED, checked in this priority order:
   a. HIGHEST PRIORITY: a digital-signature (DSC) certification stamp, which reads approximately like: "This form has been digitally signed by <PERSON NAME> having PAN <PAN> from IP Address <IP> on <DATE> <TIME> Dsc Sl.No and issuer <...>". If this stamp is present ANYWHERE in the document (it usually appears once, near the end), extract the <DATE> immediately after "on" — this OVERRIDES every other date in the document, regardless of which page or section it appears on.
   b. If no such digital-signature stamp exists anywhere, use a manual "Place: ... Date: ..." line printed next to the Chartered Accountant's signature at the end of Form 3CA or Form 3CB.
   c. If NEITHER exists, return date: null — do not guess.
   Indian forms print dates as DD/MM/YYYY — convert to YYYY-MM-DD. Never use the financial-year-end date (31/03/...), an appointment date, or a date inside a schedule/table (e.g. "Date of Sale" in a depreciation or deductions schedule) as the signing date — only rule (a) or (b) above.

Return STRICT JSON only, no markdown, no prose: {"assessee_name":"..."|null,"date":"YYYY-MM-DD"|null,"date_confidence":"high"|"medium"|"low"}`;

interface ExtractResult {
  date: string | null;
  confidence: "high" | "medium" | "low" | "unavailable";
  assessee_name: string | null;
}

function extractJson(text: string): ExtractResult {
  try {
    const cleaned = text.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
    const parsed = JSON.parse(cleaned);
    const date = typeof parsed?.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(parsed.date) ? parsed.date : null;
    const confidence = ["high", "medium", "low"].includes(parsed?.date_confidence) ? parsed.date_confidence : "low";
    const assessee_name = typeof parsed?.assessee_name === "string" && parsed.assessee_name.trim() ? parsed.assessee_name.trim() : null;
    return { date, confidence: date ? confidence : "low", assessee_name };
  } catch {
    return { date: null, confidence: "unavailable", assessee_name: null };
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
      // Fails soft — the dialog just leaves the date blank / skips the name check.
      return json({ date: null, confidence: "unavailable", assessee_name: null });
    }

    const userContent: unknown[] = [{ type: "text", text: `File name: ${file_name || "unknown"}` }];
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
          max_tokens: 400,
          system: SYSTEM_PROMPT,
          messages: [{ role: "user", content: userContent }],
        }),
      });
    } catch (e) {
      console.error("audit-3ca-extract-date: provider request failed", e);
      return json({ date: null, confidence: "unavailable", assessee_name: null });
    }

    if (!res.ok) {
      console.error("audit-3ca-extract-date: Anthropic error", res.status, await res.text());
      return json({ date: null, confidence: "unavailable", assessee_name: null });
    }

    const result = await res.json();
    const text = Array.isArray(result?.content)
      ? result.content.filter((b: any) => b?.type === "text").map((b: any) => b.text).join("")
      : "";

    return json(extractJson(text));
  } catch (e) {
    console.error("audit-3ca-extract-date error:", e);
    return json({ date: null, confidence: "unavailable", assessee_name: null });
  }
});
