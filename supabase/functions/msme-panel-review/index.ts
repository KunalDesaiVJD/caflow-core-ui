// msme-panel-review — the Claude ↔ GPT review panel for a 43B(h) computation.
//
// ─────────────────────────────────────────────────────────────────────────────
//  WHAT THIS DOES, AND THE ONE THING IT MUST NOT DO
// ─────────────────────────────────────────────────────────────────────────────
// Four sequential turns between two models from different families:
//
//   1. Claude  states an opinion on the INTERPRETATION the tool applied.
//   2. GPT     challenges it — objections, missed authority, weak reasoning.
//   3. Claude  answers each challenge: conceded, maintained, or partly.
//   4. GPT     gives a final verdict and lists what is still unresolved.
//
// Two independent models arguing catch reasoning errors that either alone would
// state confidently. Where they disagree, the disagreement is REPORTED, not
// averaged into a false consensus — an unresolved point is exactly the thing a
// chartered accountant should be looking at.
//
// THE HARD RULE: neither model computes, adjusts, or produces a disallowance
// figure. Every rupee in this utility comes from the deterministic engine in
// src/lib/msme43b, re-run over the ledgers under an enumerated rule profile,
// and cross-checked by a second independently-coded engine. Language models are
// unreliable at exact arithmetic over hundreds of bills, and a number that
// cannot be re-derived from the ledger is not auditable. So the panel is given
// the figures as CONTEXT and asked only about the reasoning that produced them.
//
// The panel's output is advisory. It cannot change a number, adopt a rule, or
// alter the working paper — those remain deterministic and human-gated.
//
// AUTH: Supabase JWT, as with the other msme-* functions.
// KEYS: OPENROUTER_API_KEY reaches BOTH panellists — Claude and GPT — so one
//       funded account runs the whole panel. ANTHROPIC_API_KEY still works for
//       the Claude side if set and preferred (see callModel below).
//       Optional: OPENROUTER_MODEL for the GPT side, MSME_CLAUDE_MODEL for the
//       Claude side. Both default to a current model and neither is pinned in
//       code, because two hardcoded IDs in this project were withdrawn and
//       silently broke it.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// The opening/answering side is resolved by callModel() from MSME_CLAUDE_MODEL.
// The CHALLENGING side is:
//
// Kimi K2 — and the lineage matters more here than the price. Two models trained
// by the same lab share blind spots, and a panel that agrees for that reason is
// worse than no panel, because it manufactures comfort. DeepSeek opens and
// answers, Moonshot challenges and closes.
//
// Override with OPENROUTER_MODEL. `kimi-k2-thinking` is the reasoning variant at
// a similar price, if the challenges come back thin.
const DEFAULT_GPT_MODEL = "moonshotai/kimi-k2";

const CONTEXT =
  'CONTEXT — how this computation is produced, so you review the right thing:\n' +
  '- Vendor ledgers are parsed from the client\'s accounting software. Every ledger is ' +
  'reconciled: the reconstructed running balance must equal the printed closing ' +
  'balance, or the ledger is flagged and not relied on.\n' +
  '- A deterministic engine then computes the s.43B(h) disallowance. A SECOND, ' +
  'independently-coded engine re-derives the same figures by a different route, and ' +
  'invariants are asserted (disallowed = allowed-on-payment + still-outstanding; ' +
  'disallowed cannot exceed the closing payable; nothing negative). Disagreements are ' +
  'flagged for a human.\n' +
  '- The exports carry NO bill-wise references, so which bill a payment clears is an ' +
  'interpretation, stated explicitly below.\n' +
  '- The firm pre-filters the vendor set: only registered micro and small enterprises ' +
  'are uploaded. The tool does not determine MSME status.\n\n' +
  'YOUR SCOPE: the LEGAL AND PROFESSIONAL REASONING only. Do NOT compute, re-derive, ' +
  'estimate or state any disallowance amount of your own — the figures are given to ' +
  'you as context, and any arithmetic opinion you offer would be less reliable than ' +
  'the two engines that produced them. If you are tempted to produce a number, say ' +
  'what should be checked instead.';

const CLAUDE_OPEN_SYSTEM =
  'You are a chartered accountant in India reviewing a section 43B(h) Income Tax Act ' +
  '1961 computation (sums payable to micro and small enterprises not paid within the ' +
  'section 15 MSMED Act 2006 time limit) prepared by a software tool for a CA firm.\n\n' +
  CONTEXT + '\n\n' +
  'Give your opinion on each interpretation the tool applied: is it sound, arguable, ' +
  'or wrong? Be specific about statutory authority. Flag anything the computation ' +
  'appears to have missed. Do not be agreeable for its own sake.\n\n' +
  'Return ONLY this JSON (no markdown):\n' +
  '{"positions":[{"topic":string,"assessment":"sound"|"arguable"|"wrong","reasoning":string}],' +
  '"risks":[string],"overall":string}';

const GPT_CHALLENGE_SYSTEM =
  'You are a senior chartered accountant in India acting as an INDEPENDENT REVIEWER. ' +
  'Another adviser has given an opinion on a section 43B(h) computation. Your job is ' +
  'to challenge it, not to endorse it.\n\n' +
  CONTEXT + '\n\n' +
  'For each position taken: do you agree? If not, state the objection and the ' +
  'authority you rely on (section, proviso, circular, or settled practice). Then list ' +
  'anything BOTH the tool and the first adviser have missed. Disagree where you ' +
  'genuinely disagree — a rubber stamp is worthless here.\n\n' +
  'Return ONLY this JSON (no markdown):\n' +
  '{"challenges":[{"topic":string,"agree":boolean,"objection":string,"authority":string}],' +
  '"missed":[string],"overall":string}';

const CLAUDE_RESPOND_SYSTEM =
  'You are the chartered accountant who gave the first opinion. An independent ' +
  'reviewer has challenged it.\n\n' + CONTEXT + '\n\n' +
  'Answer each challenge honestly. Where the reviewer is right, CONCEDE and say so ' +
  'plainly — defending a weak position helps nobody. Where you are right, maintain it ' +
  'and explain why the objection does not hold. Where the truth is in between, say ' +
  '"partly" and set out what actually turns on it.\n\n' +
  'Return ONLY this JSON (no markdown):\n' +
  '{"responses":[{"topic":string,"outcome":"conceded"|"maintained"|"partly","reasoning":string}],' +
  '"revisedPositions":[string],"overall":string}';

const GPT_FINAL_SYSTEM =
  'You are the independent reviewer. You have seen the original opinion, your own ' +
  'challenge, and the response to it.\n\n' + CONTEXT + '\n\n' +
  'Close the review. State what the two of you now AGREE on, and what remains ' +
  'UNRESOLVED — for each unresolved point give both views and say who should decide ' +
  'it (the engagement partner, the client, or a point needing counsel). Set ' +
  '"consensus" to true ONLY if nothing material is left in dispute. Do not manufacture ' +
  'agreement to close the file.\n\n' +
  'Return ONLY this JSON (no markdown):\n' +
  '{"consensus":boolean,"agreed":[string],' +
  '"unresolved":[{"topic":string,"claudeView":string,"gptView":string,"whoDecides":string}],' +
  '"recommendedActions":[string],"overall":string}';

function parseJson(content: string) {
  const cleaned = content.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
  return JSON.parse(cleaned);
}

/**
 * The Claude side of the panel. Goes through whichever transport is configured
 * (OpenRouter by default), so one funded account can serve both panellists.
 *
 * The independence that matters here is between the two MODELS, not the two
 * transports: a Claude-family and a GPT-family model still reason differently
 * whether or not the bytes travel through the same gateway. What a shared
 * transport does cost is fault isolation — an OpenRouter outage now stops the
 * whole panel rather than half of it — which is the trade the firm chose in
 * exchange for funding one account.
 */
async function callClaude(system: string, userText: string): Promise<unknown> {
  const reply = await callModel(system, [{ kind: "text", text: userText }], 3072);
  if (isModelError(reply)) throw new Error(reply.error);
  return parseJson(reply.text);
}

async function callGpt(apiKey: string, model: string, system: string, userText: string): Promise<unknown> {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      // OpenRouter attribution headers.
      "HTTP-Referer": "https://caflow-core-ui.vercel.app",
      "X-Title": "CAFlow MSME 43B(h) review panel",
    },
    body: JSON.stringify({
      model,
      // 8,000, not 3,072. A reasoning model's internal thinking is charged and
      // counted as output, so a tight cap can be spent entirely on reasoning and
      // return an empty message — which would surface as "unparseable output" and
      // look like a model fault rather than a budget one. Unused tokens are not
      // billed, so the headroom costs nothing and removes a whole failure mode.
      max_tokens: 8000,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: userText },
      ],
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    console.error("OpenRouter error:", res.status, t);
    if (res.status === 401 || res.status === 403) {
      throw new Error("OpenRouter authentication failed — check the OPENROUTER_API_KEY secret.");
    }
    if (res.status === 402) {
      throw new Error("OpenRouter rejected the request for credit/quota reasons — top up the account.");
    }
    if (res.status === 404 || /model/i.test(t)) {
      throw new Error(`OpenRouter does not serve the model "${model}". Set the OPENROUTER_MODEL secret to one it does.`);
    }
    throw new Error(`GPT call failed (${res.status}).`);
  }
  const body = await res.json();
  return parseJson(body.choices?.[0]?.message?.content || "");
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "").trim();
    if (!token) return json({ error: "Unauthorized" }, 401);

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !user) return json({ error: "Unauthorized" }, 401);

    const { evidence } = await req.json();
    if (!evidence) return json({ error: "Missing evidence" }, 400);

    // The Claude side picks its own transport (see callModel). The GPT side is
    // OpenRouter by definition — it is the only way this project reaches a
    // non-Anthropic model — so its key is required either way.
    const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY");
    if (!OPENROUTER_API_KEY) {
      return json({
        error: "The GPT reviewer is not configured. Set it with: npx supabase secrets set OPENROUTER_API_KEY=sk-or-v1-...",
      }, 503);
    }
    const gptModel = Deno.env.get("OPENROUTER_MODEL") || DEFAULT_GPT_MODEL;
    const claudeModel = resolveProvider()?.model ?? "unavailable";

    const pack = JSON.stringify(evidence).slice(0, 100_000);

    // ── Turn 1: Claude opens ──
    const claudeOpinion = await callClaude(
      CLAUDE_OPEN_SYSTEM,
      `Here is the computation and the interpretation applied.\n\n${pack}`,
    );

    // ── Turn 2: GPT challenges ──
    const gptCritique = await callGpt(
      OPENROUTER_API_KEY, gptModel, GPT_CHALLENGE_SYSTEM,
      `The computation and the interpretation applied:\n\n${pack}\n\n` +
      `The first adviser's opinion:\n\n${JSON.stringify(claudeOpinion)}`,
    );

    // ── Turn 3: Claude answers ──
    const claudeResponse = await callClaude(
      CLAUDE_RESPOND_SYSTEM,
      `The computation:\n\n${pack}\n\n` +
      `Your opinion:\n\n${JSON.stringify(claudeOpinion)}\n\n` +
      `The reviewer's challenge:\n\n${JSON.stringify(gptCritique)}`,
    );

    // ── Turn 4: GPT closes ──
    const gptFinal = await callGpt(
      OPENROUTER_API_KEY, gptModel, GPT_FINAL_SYSTEM,
      `The computation:\n\n${pack}\n\n` +
      `Original opinion:\n\n${JSON.stringify(claudeOpinion)}\n\n` +
      `Your challenge:\n\n${JSON.stringify(gptCritique)}\n\n` +
      `The response:\n\n${JSON.stringify(claudeResponse)}`,
    );

    return json({
      claudeOpinion,
      gptCritique,
      claudeResponse,
      gptFinal,
      // The panel names its own members: which two models actually argued is
      // part of the working paper, not an implementation detail.
      models: { claude: claudeModel, gpt: gptModel },
    });
  } catch (e) {
    console.error("msme-panel-review error:", e);
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
//   MSME_CLAUDE_MODEL   the text model, e.g. deepseek/deepseek-v3.2
//   MSME_VISION_MODEL   used only when a page is sent as a picture or a PDF,
//                       because the text model may not accept one
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
  // DeepSeek v3.2. Reading a ledger is TRANSCRIPTION, not judgement, and
  // correctness here does not rest on the model's reasoning: the reconstructed
  // running balance must agree with the printed closing balance or the ledger is
  // flagged and not relied on. A misread surfaces as a failed control, not as a
  // wrong figure — which is what makes the cheaper model a sound bet.
  // $0.27/$0.40 per M, against Sonnet's $2/$10.
  openrouter: "deepseek/deepseek-v3.2",
  // DeepSeek is not served by the Anthropic API, so the direct-transport
  // fallback stays on Anthropic's own cheapest current model.
  anthropic: "claude-haiku-4-5-20251001",
};

/**
 * A SEPARATE MODEL FOR PAGES SENT AS PICTURES.
 *
 * DeepSeek v3.2 and Kimi K2 are text-only — neither accepts an image or a PDF.
 * That is fine for the normal route, which sends extracted text, but a SCANNED
 * ledger has no text and can only be read as page images, and the whole-document
 * fallback sends a PDF. Pointing those at a text-only model would fail on exactly
 * the files that are hardest to deal with, and the failure would look like a bad
 * scan rather than a wrong model.
 *
 * So the transport routes on what the request actually contains: text to the
 * configured model, anything carrying an image or a PDF to here. Qwen3.7-flash
 * reads images, costs $0.03/$0.13 per M, and carries a 1M context.
 *
 * Override with MSME_VISION_MODEL. It only ever has to handle a scan.
 */
const DEFAULT_VISION_MODEL: Record<Provider, string> = {
  openrouter: "qwen/qwen3.7-flash",
  anthropic: "claude-haiku-4-5-20251001",
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
