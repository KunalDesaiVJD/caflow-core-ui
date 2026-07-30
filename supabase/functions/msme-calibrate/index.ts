// msme-calibrate — the AI side of the 43B(h) calibration loop.
//
// Two modes, and the split between them is the whole safety story:
//
//   mode "extract-working"  READ the reviewer's own working paper (a PDF, or the
//                           cells of a spreadsheet we could not map by header)
//                           into per-vendor figures. Pure transcription.
//
//   mode "review-difference" EXPLAIN a difference in professional terms and say
//                           which of the tool's permitted legal positions the
//                           reviewer appears to be taking. Narrative only.
//
// WHAT THIS FUNCTION IS NOT ALLOWED TO DO: compute, adjust, or return any
// disallowance figure that ends up in the working paper. Every rupee in the
// output of this utility comes from the deterministic engine in
// src/lib/msme43b, re-run over the ledgers under an enumerated rule profile —
// never from a model. Language models are not reliable at exact arithmetic over
// hundreds of bills, and a number that cannot be re-derived from the ledger is
// not auditable. So the model is used for the thing it is genuinely good at
// (reading a layout, and reasoning about which interpretation someone is
// applying) and is kept away from the thing it is bad at.
//
// In "review-difference" the model is told the candidate rule changes the
// DETERMINISTIC search already found, and asked to assess them. Its opinion is
// shown to the preparer as a second opinion; accepting a rule remains a human
// click, and the figures update only by re-running the engine.
//
// AUTH + KEY: mirrors claude-gateway / msme-extract-ledger (Supabase JWT,
// existing ANTHROPIC_API_KEY secret — nothing new to provision).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const MODEL = "claude-sonnet-4-20250514";

const EXTRACT_SYSTEM =
  'You are a precise data-extraction engine for an Indian CA firm. You are given a ' +
  'WORKING PAPER prepared by a chartered accountant computing the disallowance under ' +
  'section 43B(h) of the Income Tax Act 1961 (sums payable to micro and small ' +
  'enterprises not paid within the section 15 MSMED Act time limit). Layouts vary by ' +
  'firm. Extract the per-vendor figures into strict JSON.\n\n' +
  'Return ONLY this JSON object (no markdown, no commentary):\n' +
  '{"rows":[{' +
  '"vendorName":string,          // the party/supplier name as written\n' +
  '"disallowedCY":number,        // amount disallowed / added back this year\n' +
  '"allowedFY":number|null,      // amount allowed on payment in the following year, if shown\n' +
  '"stillOutstanding":number|null, // amount still unpaid, if shown\n' +
  '"note":string                 // any remark the preparer wrote on that line, else ""\n' +
  '}],"statedTotal":number|null}\n\n' +
  'RULES:\n' +
  '- Transcribe EXACTLY what is written. Never compute, re-derive, correct or ' +
  'reconcile a figure. If the sheet has an arithmetic error, reproduce it faithfully — ' +
  'the difference is the point of the exercise.\n' +
  '- Strip currency symbols and thousands separators; keep paise. Amounts in ' +
  'parentheses are negative.\n' +
  '- Put a grand-total row in "statedTotal", NOT in "rows".\n' +
  '- Skip heading, blank and sub-heading rows.\n' +
  '- If a column is absent, use null. Output valid JSON only.';

const REVIEW_SYSTEM =
  'You are a chartered accountant reviewing a section 43B(h) computation for an ' +
  'Indian CA firm. A software tool and a human reviewer have computed the ' +
  'disallowance from the SAME vendor ledgers and disagree on some vendors.\n\n' +
  'A deterministic search has already re-run the tool\'s engine over the ledgers ' +
  'under every legal position the tool is permitted to hold, and found which ' +
  'position (if any) reproduces the reviewer\'s figures. You are given that result.\n\n' +
  'Your job is JUDGEMENT, not arithmetic:\n' +
  '1. For each candidate rule change, say whether it is a legally defensible reading ' +
  'of s.43B(h) / s.15 MSMED Act, or whether it looks like the wrong explanation for ' +
  'the right observation.\n' +
  '2. For differences no rule explains, give the most likely cause (e.g. the reviewer ' +
  'excluded a vendor as not micro/small, used bill-wise data the ledger does not ' +
  'carry, treated an entry differently, or made an error).\n' +
  '3. State plainly if you think the REVIEWER is wrong and the tool is right. You are ' +
  'not here to agree.\n\n' +
  'DO NOT compute, estimate or state any disallowance amount of your own. Every ' +
  'figure in this engagement comes from the deterministic engine. If you are tempted ' +
  'to produce a number, say what should be checked instead.\n\n' +
  'Return ONLY this JSON (no markdown):\n' +
  '{"verdicts":[{"rule":string,"defensible":boolean,"comment":string}],' +
  '"unexplainedCauses":[{"vendor":string,"likelyCause":string,"whatToCheck":string}],' +
  '"overall":string}';

function parseJson(content: string) {
  const cleaned = content.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
  return JSON.parse(cleaned);
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // --- Auth (Supabase JWT) ---
    const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "").trim();
    if (!token) return json({ error: "Unauthorized" }, 401);

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !user) return json({ error: "Unauthorized" }, 401);

    const body = await req.json();
    const mode: string = body?.mode ?? "extract-working";

    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    if (!ANTHROPIC_API_KEY) {
      return json({ error: "AI review is not configured (no ANTHROPIC_API_KEY)." }, 503);
    }

    let system: string;
    // deno-lint-ignore no-explicit-any
    let content: any[];

    if (mode === "extract-working") {
      const { pdf_base64, text_content, filename } = body;
      if (!pdf_base64 && !text_content) {
        return json({ error: "Missing pdf_base64 or text_content" }, 400);
      }
      system = EXTRACT_SYSTEM;
      content = pdf_base64
        ? [
            { type: "document", source: { type: "base64", media_type: "application/pdf", data: pdf_base64 } },
            { type: "text", text: `Extract the 43B(h) working paper${filename ? ` from "${filename}"` : ""} into the JSON schema. Output JSON only.` },
          ]
        : [
            { type: "text", text: `Working paper${filename ? ` "${filename}"` : ""}, as spreadsheet cells:\n\n${String(text_content).slice(0, 200_000)}` },
            { type: "text", text: "Extract it into the JSON schema. Output JSON only." },
          ];
    } else if (mode === "review-difference") {
      // The client sends the deterministic search result — never raw ledgers,
      // and never anything the model could turn into a figure we would use.
      const { summary } = body;
      if (!summary) return json({ error: "Missing summary" }, 400);
      system = REVIEW_SYSTEM;
      content = [{
        type: "text",
        text:
          "Here is the deterministic comparison and rule search. Assess it.\n\n" +
          JSON.stringify(summary).slice(0, 120_000),
      }];
    } else {
      return json({ error: `Unknown mode "${mode}".` }, 400);
    }

    const anthropicResponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 8192,
        system,
        messages: [{ role: "user", content }],
      }),
    });

    if (!anthropicResponse.ok) {
      const errText = await anthropicResponse.text();
      console.error("Anthropic error:", anthropicResponse.status, errText);
      const described = describeProviderError(anthropicResponse.status, errText, MODEL);
      return json({ error: described.error }, described.status);
    }

    const result = await anthropicResponse.json();
    const text: string = result.content?.[0]?.text || "";
    const truncated = result.stop_reason === "max_tokens";

    let parsed: unknown;
    try {
      parsed = parseJson(text);
    } catch (_e) {
      return json({ error: "AI returned unparseable output.", truncated, raw: text.slice(0, 2000) }, 502);
    }

    return json({ ...(parsed as object), truncated, model: MODEL });
  } catch (e) {
    console.error("msme-calibrate error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/**
 * Turn an Anthropic HTTP failure into something the firm can act on.
 *
 * The provider states the actual cause in the body, and each cause has a
 * different remedy: a spent credit balance needs a payment, a retired model
 * needs a code change, a rate limit needs a wait. Collapsing all of them into
 * "AI extraction failed" is what sent a plain billing problem to the server
 * logs instead of to the person who could fix it in two minutes.
 */
function describeProviderError(
  status: number,
  body: string,
  model: string,
): { error: string; status: number } {
  let providerMsg = "";
  try {
    providerMsg = String((JSON.parse(body) as { error?: { message?: string } })?.error?.message ?? "");
  } catch {
    // Not JSON — fall through to the status-based cases.
  }

  // Billing. A 400, not a 401, so it used to land in the generic bucket.
  if (/credit balance is too low|insufficient.*credit|purchase credits|billing/i.test(providerMsg)) {
    return {
      error:
        "The Anthropic account has no credits left, so no ledger can be read. Add credits at " +
        "console.anthropic.com under Plans & Billing. This affects every AI feature in the app, " +
        "not only this one — the same key is shared.",
      status: 402,
    };
  }
  if (status === 401 || status === 403) {
    return { error: "AI provider authentication failed. Update the ANTHROPIC_API_KEY secret.", status: 401 };
  }
  if (status === 429) {
    return {
      error: "The AI provider is rate-limiting this account. Wait a minute and try again, or upload fewer files at once.",
      status: 429,
    };
  }
  if (status === 404 || /model/i.test(providerMsg)) {
    return {
      error: `The AI provider will not serve the model "${model}": ${providerMsg || "model not found"}. ` +
        "Update MODEL in this function and redeploy it.",
      status: 502,
    };
  }
  // Anything else: say what the provider said rather than inventing a summary.
  return {
    error: providerMsg ? `AI provider error (HTTP ${status}): ${providerMsg}` : `AI provider call failed (HTTP ${status}).`,
    status: status >= 500 ? 502 : status,
  };
}
