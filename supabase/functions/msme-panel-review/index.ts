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
// KEYS: ANTHROPIC_API_KEY (existing) + OPENROUTER_API_KEY (new).
//       Set with: npx supabase secrets set OPENROUTER_API_KEY=...
//       Optional: OPENROUTER_MODEL to pin a different GPT model.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const CLAUDE_MODEL = "claude-sonnet-4-20250514";
const DEFAULT_GPT_MODEL = "openai/gpt-4o";

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

async function callClaude(apiKey: string, system: string, userText: string): Promise<unknown> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 3072,
      system,
      messages: [{ role: "user", content: [{ type: "text", text: userText }] }],
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    console.error("Anthropic error:", res.status, t);
    throw new Error(
      res.status === 401 || res.status === 403
        ? "Claude authentication failed — check ANTHROPIC_API_KEY."
        : `Claude call failed (${res.status}).`,
    );
  }
  const body = await res.json();
  return parseJson(body.content?.[0]?.text || "");
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
      max_tokens: 3072,
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

    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY");
    if (!ANTHROPIC_API_KEY) return json({ error: "Claude is not configured (no ANTHROPIC_API_KEY)." }, 503);
    if (!OPENROUTER_API_KEY) {
      return json({
        error: "The GPT reviewer is not configured. Set it with: npx supabase secrets set OPENROUTER_API_KEY=sk-or-v1-...",
      }, 503);
    }
    const gptModel = Deno.env.get("OPENROUTER_MODEL") || DEFAULT_GPT_MODEL;

    const pack = JSON.stringify(evidence).slice(0, 100_000);

    // ── Turn 1: Claude opens ──
    const claudeOpinion = await callClaude(
      ANTHROPIC_API_KEY, CLAUDE_OPEN_SYSTEM,
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
      ANTHROPIC_API_KEY, CLAUDE_RESPOND_SYSTEM,
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
      models: { claude: CLAUDE_MODEL, gpt: gptModel },
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
