/**
 * tax-document-extract
 *
 * Reads an uploaded tax document and extracts structured fields, so the
 * upload-confirmation dialogs in Audit Tracker (3CA/3CB+3CD) and IT Returns
 * (ITR filing) can pre-fill a value the auditor would otherwise retype by
 * hand. The auditor can always edit the result — a misread scan must never
 * silently corrupt the record.
 *
 * Was `audit-3ca-extract-date`, generalized here to a second document type
 * (`doc_type: "itr_form"`) rather than forking a near-identical function —
 * same reasoning already applied to this codebase's shared TDS matching
 * engine (src/lib/tds/match.ts): one engine, one prompt-maintenance surface.
 *
 * Input (POST, Bearer auth):
 *   { doc_type: "3ca_3cd" | "itr_form",
 *     pdf_base64?: string, image_base64?: string, image_media_type?: string,
 *     file_name?: string }
 *
 *   doc_type "3ca_3cd"   — a filed Form 3CA/3CB + 3CD. Extracts the filing/
 *                          signing date and the assessee name.
 *   doc_type "itr_form"  — a filed Income Tax Return / acknowledgement PDF.
 *                          Extracts the e-filing acknowledgement number.
 *
 * Output (fields not relevant to the requested doc_type come back null):
 *   { date: "YYYY-MM-DD" | null, date_confidence: "high"|"medium"|"low"|"unavailable",
 *     assessee_name: string | null,
 *     acknowledgment_no: string | null, ack_confidence: "high"|"medium"|"low"|"unavailable" }
 *
 * Requires the ANTHROPIC_API_KEY secret. Fails soft — any missing key,
 * provider error or unparseable reply returns nulls/"unavailable" rather
 * than a hard failure, so the auditor can always fall back to typing the
 * value in manually.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { callClaudeCli, isProviderError } from "../_shared/aiProvider.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type DocType = "3ca_3cd" | "itr_form";

const SYSTEM_PROMPTS: Record<DocType, string> = {
  "3ca_3cd": `You read an Indian tax-audit document: either (a) a Chartered Accountant's scanned/signed audit report, or (b) a filed Income Tax Form 3CA/3CB and Form 3CD PDF (downloaded from the e-filing portal, usually digitally signed).

Extract TWO things:

1. assessee_name — the name of the ENTITY BEING AUDITED (the client whose accounts these are). NOT the Chartered Accountant's own name, and NOT the audit firm's name. This is the company/firm/proprietorship the report is ABOUT, and it appears prominently and REPEATEDLY throughout the document — not just in one labelled field. Look for, in this order of reliability:
   - An explicit label: "Name of the assessee", "In the case of ...", "the accounts of ...", "the Balance Sheet of ...".
   - The document's title block, letterhead, or cover heading (e.g. "TAX AUDIT REPORT OF <NAME>", "M/s <NAME>").
   - The name repeated in running headers/footers or the balance sheet/P&L heading ("Balance Sheet of <NAME> as at 31st March ...").
   Cross-check: the correct name is whichever one appears MOST OFTEN across the document — a CA's or audit firm's name typically appears once or twice (signature block, header), while the assessee's name recurs on nearly every page. Return null ONLY if no company/firm/proprietorship name appears anywhere in the document.

2. date — the date this document was SIGNED / FILED, checked in this priority order:
   a. HIGHEST PRIORITY: a digital-signature (DSC) certification stamp, which reads approximately like: "This form has been digitally signed by <PERSON NAME> having PAN <PAN> from IP Address <IP> on <DATE> <TIME> Dsc Sl.No and issuer <...>". If this stamp is present ANYWHERE in the document (it usually appears once, near the end), extract the <DATE> immediately after "on" — this OVERRIDES every other date in the document, regardless of which page or section it appears on.
   b. If no such digital-signature stamp exists anywhere, use a manual "Place: ... Date: ..." line printed next to the Chartered Accountant's signature at the end of Form 3CA or Form 3CB.
   c. If NEITHER exists, return date: null — do not guess.
   Indian forms print dates as DD/MM/YYYY — convert to YYYY-MM-DD. Never use the financial-year-end date (31/03/...), an appointment date, or a date inside a schedule/table (e.g. "Date of Sale" in a depreciation or deductions schedule) as the signing date — only rule (a) or (b) above.

Return STRICT JSON only, no markdown, no prose: {"assessee_name":"..."|null,"date":"YYYY-MM-DD"|null,"date_confidence":"high"|"medium"|"low"}`,

  itr_form: `You read a filed Indian Income Tax Return (ITR) PDF or its e-filing acknowledgement/ITR-V page.

Extract the ACKNOWLEDGEMENT NUMBER — the number the e-filing portal assigns to this specific filed return. It is printed prominently, usually near the top of the acknowledgement page, labelled something like "Acknowledgement Number", "Acknowledgement No.", "ARN", or "e-Filing Acknowledgement Number", typically followed by a colon and then a run of digits (commonly 15 digits, but treat the exact length as whatever is printed — do not pad or truncate it). Return it EXACTLY as printed, digits only (strip spaces).

Do not confuse it with: a PAN (5 letters + 4 digits + 1 letter), an Aadhaar number, a Form/DSC serial number, or an assessment year. If no acknowledgement number is found anywhere in the document, return null — do not guess.

Return STRICT JSON only, no markdown, no prose: {"acknowledgment_no":"..."|null,"ack_confidence":"high"|"medium"|"low"}`,
};

interface ExtractResult {
  date: string | null;
  date_confidence: "high" | "medium" | "low" | "unavailable";
  assessee_name: string | null;
  acknowledgment_no: string | null;
  ack_confidence: "high" | "medium" | "low" | "unavailable";
}

function extractJson(text: string, docType: DocType): ExtractResult {
  const empty: ExtractResult = {
    date: null, date_confidence: "unavailable", assessee_name: null,
    acknowledgment_no: null, ack_confidence: "unavailable",
  };
  try {
    const cleaned = text.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
    const parsed = JSON.parse(cleaned);
    if (docType === "3ca_3cd") {
      const date = typeof parsed?.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(parsed.date) ? parsed.date : null;
      const confidence = ["high", "medium", "low"].includes(parsed?.date_confidence) ? parsed.date_confidence : "low";
      const assessee_name = typeof parsed?.assessee_name === "string" && parsed.assessee_name.trim() ? parsed.assessee_name.trim() : null;
      return { ...empty, date, date_confidence: date ? confidence : "low", assessee_name };
    }
    const ackRaw = typeof parsed?.acknowledgment_no === "string" ? parsed.acknowledgment_no.replace(/\s+/g, "").trim() : "";
    const acknowledgment_no = /^\d{6,}$/.test(ackRaw) ? ackRaw : null;
    const ackConfidence = ["high", "medium", "low"].includes(parsed?.ack_confidence) ? parsed.ack_confidence : "low";
    return { ...empty, acknowledgment_no, ack_confidence: acknowledgment_no ? ackConfidence : "low" };
  } catch {
    return empty;
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

  const emptyResult: ExtractResult = {
    date: null, date_confidence: "unavailable", assessee_name: null,
    acknowledgment_no: null, ack_confidence: "unavailable",
  };

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
    const { doc_type, pdf_base64, image_base64, image_media_type, file_name } = body ?? {};
    const docType: DocType = doc_type === "itr_form" ? "itr_form" : "3ca_3cd";
    if (!pdf_base64 && !image_base64) {
      return json({ error: "Provide `pdf_base64` or `image_base64`." }, 400);
    }

    if ((Deno.env.get("CAFLOW_AI_BACKEND") ?? "claude-cli") !== "legacy-api") {
      const parts = [
        { kind: "text" as const, text: `File name: ${file_name || "unknown"}` },
        ...(pdf_base64
          ? [{ kind: "pdf" as const, filename: file_name || "tax-document.pdf", base64: pdf_base64 }]
          : [{ kind: "image" as const, mediaType: image_media_type || "image/png", base64: image_base64 }]),
      ];
      const reply = await callClaudeCli(SYSTEM_PROMPTS[docType], parts, {
        defaultModel: { openrouter: "sonnet", anthropic: "sonnet" },
        appTitle: "CAFlow tax document extraction",
        maxTokens: 400,
        effort: "low",
      });
      if (isProviderError(reply)) {
        console.error("tax-document-extract: Claude CLI error", reply.status, reply.error);
        return json(emptyResult);
      }
      const parsed = extractJson(reply.text, docType);
      console.log("tax-document-extract result:", docType, JSON.stringify(parsed));
      return json(parsed);
    }

    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    if (!ANTHROPIC_API_KEY) {
      // Fails soft — the dialog just leaves the field blank for manual entry.
      return json(emptyResult);
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
          // Sonnet, not Haiku — this reads real scanned/complex client PDFs and
          // gates a compliance record, so it uses the same model this codebase's
          // other real-document-reading calls rely on (tds-recon-import, the
          // scrutiny-heavy claude-gateway paths), not the cheaper Haiku tier.
          model: Deno.env.get("ANTHROPIC_MODEL") || "claude-sonnet-4-20250514",
          max_tokens: 400,
          system: SYSTEM_PROMPTS[docType],
          messages: [{ role: "user", content: userContent }],
        }),
      });
    } catch (e) {
      console.error("tax-document-extract: provider request failed", e);
      return json(emptyResult);
    }

    if (!res.ok) {
      console.error("tax-document-extract: Anthropic error", res.status, await res.text());
      return json(emptyResult);
    }

    const result = await res.json();
    const text = Array.isArray(result?.content)
      ? result.content.filter((b: any) => b?.type === "text").map((b: any) => b.text).join("")
      : "";

    const parsed = extractJson(text, docType);
    // Always logged (not just on failure) — the only way to see WHY a real
    // client PDF came back with a null field is the raw model reply, and
    // this function has no other observability hook.
    console.log("tax-document-extract result:", docType, JSON.stringify(parsed), "raw:", text.slice(0, 500));
    return json(parsed);
  } catch (e) {
    console.error("tax-document-extract error:", e);
    return json(emptyResult);
  }
});
