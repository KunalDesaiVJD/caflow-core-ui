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
// AUTH: Supabase JWT, mirroring claude-gateway / msme-extract-ledger.
// KEY + MODEL: see the transport block at the foot of this file — OpenRouter by
// default (one key for every model), Anthropic direct as the alternative, and
// the model ID held in a secret rather than hardcoded.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

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

    let system: string;
    let parts: Part[];

    if (mode === "extract-working") {
      const { pdf_base64, text_content, filename } = body;
      if (!pdf_base64 && !text_content) {
        return json({ error: "Missing pdf_base64 or text_content" }, 400);
      }
      system = EXTRACT_SYSTEM;
      parts = pdf_base64
        ? [
            { kind: "pdf", filename: filename || "working.pdf", base64: pdf_base64 },
            { kind: "text", text: `Extract the 43B(h) working paper${filename ? ` from "${filename}"` : ""} into the JSON schema. Output JSON only.` },
          ]
        : [
            { kind: "text", text: `Working paper${filename ? ` "${filename}"` : ""}, as spreadsheet cells:\n\n${String(text_content).slice(0, 200_000)}` },
            { kind: "text", text: "Extract it into the JSON schema. Output JSON only." },
          ];
    } else if (mode === "review-difference") {
      // The client sends the deterministic search result — never raw ledgers,
      // and never anything the model could turn into a figure we would use.
      const { summary } = body;
      if (!summary) return json({ error: "Missing summary" }, 400);
      system = REVIEW_SYSTEM;
      parts = [{
        kind: "text",
        text:
          "Here is the deterministic comparison and rule search. Assess it.\n\n" +
          JSON.stringify(summary).slice(0, 120_000),
      }];
    } else {
      return json({ error: `Unknown mode "${mode}".` }, 400);
    }

    const reply = await callModel(system, parts, 8192);
    if (isModelError(reply)) return json({ error: reply.error }, reply.status);

    let parsed: unknown;
    try {
      parsed = parseJson(reply.text);
    } catch (_e) {
      return json({ error: "AI returned unparseable output.", truncated: reply.truncated, raw: reply.text.slice(0, 2000) }, 502);
    }

    return json({ ...(parsed as object), truncated: reply.truncated, model: reply.model, provider: reply.provider });
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

// ─────────────────────────────────────────────────────────────────────────────
//  AI transport — OpenRouter (default) or the Anthropic API direct
// ─────────────────────────────────────────────────────────────────────────────
//
// WHY BOTH: one OpenRouter key reaches Claude, GPT and everything else, so the
// firm funds a single account instead of one per provider. The direct Anthropic
// path is kept because it is one less intermediary for the calls that matter,
// and because it is what this function used before — losing it would mean a
// provider outage has no fallback.
//
// WHICH ONE RUNS: OPENROUTER_API_KEY if present, otherwise ANTHROPIC_API_KEY.
// Set MSME_AI_PROVIDER to "anthropic" or "openrouter" to force one.
//
// MODELS ARE NOT HARDCODED. Two pinned model IDs in this project went stale and
// silently broke it (claude-sonnet-4-20250514 and openai/gpt-4o were both
// withdrawn), so the ID is a secret with a current default:
<<<<<<< Updated upstream
//   MSME_CLAUDE_MODEL   e.g. anthropic/claude-sonnet-5   (OpenRouter naming)
//                       e.g. claude-sonnet-5             (Anthropic naming)
=======
//   MSME_CLAUDE_MODEL   the text model, e.g. deepseek/deepseek-v3.2
//   MSME_VISION_MODEL   used only when a page is sent as a picture or a PDF,
//                       because the text model may not accept one
>>>>>>> Stashed changes
// A withdrawn model now produces a message naming the secret to change, rather
// than a generic failure.

type Provider = "openrouter" | "anthropic";

/**
 * Provider-neutral message content: text, a PDF read as a document, or a page
 * rendered to an image (the only way to read a SCANNED ledger, and what makes a
 * scan splittable page by page instead of all-or-nothing).
 */
type Part =
  | { kind: "text"; text: string }
  | { kind: "pdf"; filename: string; base64: string }
  | { kind: "image"; base64: string };

const DEFAULT_MODEL: Record<Provider, string> = {
<<<<<<< Updated upstream
  openrouter: "anthropic/claude-sonnet-5",
  anthropic: "claude-sonnet-5",
=======
  // DeepSeek v3.2 — the firm's choice, and a sound one for this work: reading a
  // ledger is TRANSCRIPTION, not judgement, and correctness here does not rest on
  // the model's reasoning. The reconstructed running balance must agree with the
  // printed closing balance or the ledger is flagged and not relied on, so a
  // misread shows up as a failed control rather than a wrong figure. $0.27/$0.40
  // per M against Haiku's $1/$5 — about a seventh of the cost.
  openrouter: "deepseek/deepseek-v3.2",
  // DeepSeek is not served by the Anthropic API, so the direct-transport
  // fallback stays on Anthropic's own cheapest current model.
  anthropic: "claude-haiku-4-5-20251001",
};

/**
 * A SEPARATE MODEL FOR PAGES SENT AS PICTURES.
 *
 * DeepSeek v3.2 and Kimi K2 are text-only — neither accepts an image or a PDF.
 * That is fine for the normal route, where the client sends extracted text, but
 * a SCANNED ledger has no text and can only be read as page images, and the
 * whole-document fallback sends a PDF. Pointing those at a text-only model would
 * fail on exactly the files that are hardest to deal with, and the failure would
 * look like a bad scan rather than a wrong model.
 *
 * So the transport routes on what the request actually contains: text goes to
 * the configured model, anything with an image or a PDF goes here. Qwen3.7-flash
 * reads images, costs $0.03/$0.13 per M, and carries a 1M context.
 *
 * Override with MSME_VISION_MODEL. It only ever has to handle a scan.
 */
const DEFAULT_VISION_MODEL: Record<Provider, string> = {
  openrouter: "qwen/qwen3.7-flash",
  anthropic: "claude-haiku-4-5-20251001",
>>>>>>> Stashed changes
};

interface ModelReply {
  text: string;
  /** the reply hit the output cap — the caller must not treat it as complete */
  truncated: boolean;
  model: string;
  provider: Provider;
}

function resolveProvider(needsVision = false): { provider: Provider; apiKey: string; model: string } | null {
  const forced = (Deno.env.get("MSME_AI_PROVIDER") ?? "").trim().toLowerCase();
  const orKey = Deno.env.get("OPENROUTER_API_KEY");
  const anthKey = Deno.env.get("ANTHROPIC_API_KEY");

  let provider: Provider | null = null;
  if (forced === "anthropic" && anthKey) provider = "anthropic";
  else if (forced === "openrouter" && orKey) provider = "openrouter";
  else if (orKey) provider = "openrouter";
  else if (anthKey) provider = "anthropic";
  if (!provider) return null;

  const apiKey = (provider === "openrouter" ? orKey : anthKey)!;
  const model = needsVision
    ? (Deno.env.get("MSME_VISION_MODEL") ?? "").trim() || DEFAULT_VISION_MODEL[provider]
    : (Deno.env.get("MSME_CLAUDE_MODEL") ?? "").trim() || DEFAULT_MODEL[provider];
  return { provider, apiKey, model };
}

/**
 * One call, either transport. The two APIs differ in three ways that matter —
 * how the system prompt is passed, how a PDF is attached, and where the reply
 * and the truncation flag live — so each is built explicitly rather than
 * pretending one shape fits both.
 */
async function callModel(
  system: string,
  parts: Part[],
  maxTokens: number,
): Promise<ModelReply | { error: string; status: number }> {
  // Route on what is actually being sent: a picture or a PDF needs a model that
  // can see one, whatever the text model happens to be.
  const needsVision = parts.some((p) => p.kind === "image" || p.kind === "pdf");
  const resolved = resolveProvider(needsVision);
  if (!resolved) {
    return {
      error: "No AI provider is configured. Set the OPENROUTER_API_KEY secret " +
        "(one key covers Claude and every other model) or ANTHROPIC_API_KEY.",
      status: 503,
    };
  }
  const { provider, apiKey, model } = resolved;

  const res = provider === "openrouter"
    ? await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://caflow-core-ui.vercel.app",
          "X-Title": "CAFlow MSME 43B(h)",
        },
        body: JSON.stringify({
          model,
          max_tokens: maxTokens,
          messages: [
            { role: "system", content: system },
            {
              role: "user",
              content: parts.map((p) => {
                if (p.kind === "text") return { type: "text", text: p.text };
                if (p.kind === "image") {
                  return { type: "image_url", image_url: { url: `data:image/jpeg;base64,${p.base64}` } };
                }
                return {
                  type: "file",
                  file: {
                    filename: p.filename,
                    file_data: `data:application/pdf;base64,${p.base64}`,
                  },
                };
              }),
            },
          ],
          // engine "native" hands the PDF to the model itself, which is what the
          // direct Anthropic path did — same fidelity, and no per-page OCR fee.
          // Switch to "mistral-ocr" only if a scanned ledger reads badly.
          ...(parts.some((p) => p.kind === "pdf")
            ? { plugins: [{ id: "file-parser", pdf: { engine: "native" } }] }
            : {}),
        }),
      })
    : await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          max_tokens: maxTokens,
          system,
          messages: [{
            role: "user",
            content: parts.map((p) => {
              if (p.kind === "text") return { type: "text", text: p.text };
              if (p.kind === "image") {
                return {
                  type: "image",
                  source: { type: "base64", media_type: "image/jpeg", data: p.base64 },
                };
              }
              return {
                type: "document",
                source: { type: "base64", media_type: "application/pdf", data: p.base64 },
              };
            }),
          }],
        }),
      });

  if (!res.ok) {
    const body = await res.text();
    console.error(`${provider} error:`, res.status, body);
    return describeProviderError(res.status, body, model, provider);
  }

  // deno-lint-ignore no-explicit-any
  const body: any = await res.json();
  if (provider === "openrouter") {
    const choice = body.choices?.[0];
    return {
      text: choice?.message?.content ?? "",
      truncated: choice?.finish_reason === "length",
      model,
      provider,
    };
  }
  return {
    text: body.content?.[0]?.text ?? "",
    truncated: body.stop_reason === "max_tokens",
    model,
    provider,
  };
}

/**
 * Turn an HTTP failure from either provider into something the firm can act on.
 *
 * Each cause has a different remedy: a spent balance needs a payment, a
 * withdrawn model needs a secret changed, a rate limit needs a wait. Collapsing
 * them into "AI extraction failed" is what sent a plain billing problem to the
 * server logs instead of to the person who could fix it in two minutes.
 */
function describeProviderError(
  status: number,
  body: string,
  model: string,
  provider: Provider,
): { error: string; status: number } {
  let providerMsg = "";
  try {
    providerMsg = String((JSON.parse(body) as { error?: { message?: string } })?.error?.message ?? "");
  } catch {
    // Not JSON — fall through to the status-based cases.
  }

  // Billing. Anthropic returns this as a 400, so it used to land in the
  // generic bucket; OpenRouter uses 402.
  if (status === 402 || /credit balance is too low|insufficient.*credit|purchase credits|billing|quota/i.test(providerMsg)) {
    const where = provider === "openrouter"
      ? "openrouter.ai/credits"
      : "console.anthropic.com under Plans & Billing";
    return {
      error: `The ${provider} account has no credits left, so no ledger can be read. Add credits at ${where}. ` +
        "This affects every AI feature that uses the same key, not only this one.",
      status: 402,
    };
  }
  if (status === 401 || status === 403) {
    const secret = provider === "openrouter" ? "OPENROUTER_API_KEY" : "ANTHROPIC_API_KEY";
    return { error: `The ${provider} key was rejected. Update the ${secret} secret.`, status: 401 };
  }
  if (status === 429) {
    return {
      error: `${provider} is rate-limiting this account. Wait a minute and try again, or upload fewer files at once.`,
      status: 429,
    };
  }
  if (status === 404 || /model/i.test(providerMsg)) {
    return {
      error: `${provider} will not serve the model "${model}": ${providerMsg || "model not found"}. ` +
        "Models get withdrawn — set the MSME_CLAUDE_MODEL secret to a current one " +
        "(list them at openrouter.ai/models) and try again. No redeploy is needed.",
      status: 502,
    };
  }
  // Anything else: say what the provider said rather than inventing a summary.
  return {
    error: providerMsg
      ? `${provider} error (HTTP ${status}): ${providerMsg}`
      : `${provider} call failed (HTTP ${status}).`,
    status: status >= 500 ? 502 : status,
  };
}

function isModelError(r: unknown): r is { error: string; status: number } {
  return typeof (r as { error?: unknown })?.error === "string";
}
