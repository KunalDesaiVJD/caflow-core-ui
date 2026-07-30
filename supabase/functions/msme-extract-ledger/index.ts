// msme-extract-ledger — read a vendor ledger PDF of ANY accounting-software
// format and return a canonical JSON ledger, using Claude with native PDF
// document input, reached through OpenRouter or the Anthropic API direct.
//
// WHY EVERY PDF COMES HERE: the deterministic Tally/Expert parsers still exist
// and still reconcile to zero drift, but they only ever saw a single gross
// amount per row — no tax split. Since the disallowance is stated on the taxable
// value, they cannot produce it. So this is the only ingestion route, not a
// fallback, and behaviour no longer depends on which software made the file.
//
// The API key never leaves the server; whatever comes back is re-checked
// client-side against the printed closing balance (the reconciliation oracle)
// before any figure is trusted — a wrong extraction is flagged, not used.
//
// AUTH: Supabase JWT, mirroring claude-gateway.
// KEY + MODEL: see the transport block at the foot of this file. One
// OPENROUTER_API_KEY reaches Claude and every other model, so the firm funds a
// single account; ANTHROPIC_API_KEY still works if preferred. The model ID is a
// secret, not a constant — the previous hardcoded one was withdrawn.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SYSTEM_PROMPT =
  'You are a precise data-extraction engine for an Indian CA firm. You are given ' +
  'a single vendor/supplier LEDGER exported as a PDF from an accounting software ' +
  '(Tally, Busy, Marg, Expert, Zoho, or any other). Extract it into strict JSON. ' +
  'This is a CREDITOR (accounts-payable) ledger: a CREDIT to the party increases ' +
  'what we owe (a purchase/bill); a DEBIT reduces it (a payment/settlement).\n\n' +
  // ROWS ARE POSITIONAL ARRAYS, NOT OBJECTS. Repeating nine field names on every
  // row spent roughly 60% of the output budget on punctuation, and the output
  // budget is a hard time limit here (see the max_tokens note below). The same
  // information as an array costs about 2.5x less, so 2.5x as many rows fit in a
  // call that returns in time. The order is fixed and validated client-side.
  'Return ONLY this JSON object (no markdown, no commentary):\n' +
  '{"ledgers":[{' +
  '"vendorName":string,' +
  '"financialYear":string,          // e.g. "2025-26" if determinable, else ""\n' +
  '"periodFrom":string,             // ISO yyyy-mm-dd if shown, else ""\n' +
  '"periodTo":string,               // ISO yyyy-mm-dd if shown, else ""\n' +
  '"openingBalance":number,         // signed: +ve = credit/payable, -ve = debit balance\n' +
  '"closingBalance":number,         // signed the same way, exactly as printed\n' +
  '"rows":[ [date, particulars, vchType, vchNo, debit, credit, taxableValue, gstAmount, gstRate] ]\n' +
  '}]}\n\n' +
  'EACH ROW IS AN ARRAY OF EXACTLY 9 ELEMENTS, ALWAYS IN THIS ORDER:\n' +
  '  [0] date         string  ISO yyyy-mm-dd\n' +
  '  [1] particulars  string  narration / contra ledger name as printed\n' +
  '  [2] vchType      string  Purchase/Payment/Journal/Credit Note/etc, or ""\n' +
  '  [3] vchNo        string  voucher/bill no, or ""\n' +
  '  [4] debit        number  amount debited to the party (0 if none)\n' +
  '  [5] credit       number  amount credited to the party (0 if none)\n' +
  '  [6] taxableValue number or null — invoice value EXCLUDING GST, only if shown\n' +
  '  [7] gstAmount    number or null — total GST (CGST+SGST+IGST+cess), only if shown\n' +
  '  [8] gstRate      number or null — GST rate as a percentage, e.g. 18, only if shown\n' +
  'Never omit or reorder an element. Use null for the last three when not shown, ' +
  'and "" or 0 for the others. Example row:\n' +
  '["2026-03-20","Purchase A/c","Purchase","INV-441",0,118000,100000,18000,18]\n\n' +
  'RULES:\n' +
  '- Extract EVERY transaction line, top to bottom, in order. Do not summarise, ' +
  'sample, or skip rows.\n' +
  '- GST FIELDS ARE CRITICAL AND MUST NEVER BE GUESSED. Only fill taxableValue, ' +
  'gstAmount or gstRate when the document ACTUALLY SHOWS them — for example a tax ' +
  'column, a CGST/SGST/IGST breakup, a rate in the narration, or a voucher detail ' +
  'line naming a GST ledger. If the ledger shows only a single gross amount per ' +
  'row, set ALL THREE to null. A wrong tax split produces a wrong disallowance, ' +
  'whereas null is handled safely downstream. Never infer a rate from the amount, ' +
  'from the vendor\'s trade, or from what is typical.\n' +
  '- taxableValue + gstAmount must equal the credit amount when both are given.\n' +
  '- Each transaction has EITHER a debit OR a credit (the other is 0). Never put ' +
  'the same amount in both.\n' +
  '- Copy amounts EXACTLY (strip currency symbols and thousands separators; keep ' +
  'paise). Never round or invent figures.\n' +
  '- Do NOT include opening/closing/"carried forward"/"brought forward"/grand-total ' +
  'rows as transactions — capture opening and closing in their own fields only.\n' +
  '- If the file contains multiple vendor ledgers, return one object per vendor in ' +
  '"ledgers".\n' +
  '- If a value is unknown, use "" for strings and 0 for numbers. Output valid JSON only.';

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
    if (!token) {
      return json({ error: "Unauthorized" }, 401);
    }
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !user) {
      return json({ error: "Unauthorized" }, 401);
    }

    // --- Input: three shapes, all produced by src/lib/msme43b/aiExtract.ts ---
    //   text_content   the text of a line-bounded chunk. The normal route.
    //   page_images    pages of a SCANNED ledger rendered to JPEG. A scan has no
    //                  text to chunk, so the client renders it page by page —
    //                  which is what makes a scan splittable at all.
    //   pdf_base64     the whole document. Last resort, when pdfjs cannot read
    //                  the file well enough even to render its pages.
    const { pdf_base64, text_content, page_images, filename, page_range } = await req.json();
    const images: string[] = Array.isArray(page_images) ? page_images.filter((s) => typeof s === "string") : [];
    if (!pdf_base64 && !text_content && !images.length) {
      return json({ error: "Missing text_content, page_images or pdf_base64" }, 400);
    }

    // --- Model call ---
    //
    // THE OUTPUT CAP IS A TIME BUDGET, NOT A SIZE BUDGET. This function writes
    // nothing to its response until the model has finished, so Supabase's
    // 150-second idle timeout applies to the whole model call. A 32,000-token
    // reply takes several minutes to generate and could never arrive in time —
    // it produced a guaranteed 504 on every real file.
    //
    // 8,000 tokens is what a call can emit and still return. The client sizes
    // each chunk to fit inside it (by LINES for text, by PAGES for images — see
    // aiExtract.ts) and halves a chunk that still overflows. If a reply is cut
    // off anyway, `code: "truncated"` tells the client to split and retry rather
    // than trusting a half-read ledger.

    // Shared instruction: a chunk is a slice of a bigger export, so a ledger may
    // begin or end mid-chunk and the balances must not be invented.
    const PARTIAL_NOTE =
      "Extract it into the JSON schema. This may be one PART of a longer export " +
      "containing several vendors' ledgers, so: return one entry in \"ledgers\" per vendor " +
      "appearing here; a ledger may start or end mid-way, in which case return the " +
      "rows you can see and leave openingBalance/closingBalance as 0 unless this part " +
      "actually shows them. Output JSON only.";

    let parts: Part[];
    if (images.length) {
      parts = [
        {
          kind: "text",
          text:
            `Scanned ledger${filename ? ` from "${filename}"` : ""}` +
            `${page_range ? `, ${page_range}` : ""} — ${images.length} page image(s) follow, in order.`,
        },
        ...images.map((base64) => ({ kind: "image" as const, base64 })),
        { kind: "text", text: PARTIAL_NOTE },
      ];
    } else if (text_content) {
      parts = [
        {
          kind: "text",
          text:
            `Ledger text${filename ? ` from "${filename}"` : ""}` +
            `${page_range ? `, ${page_range}` : ""}:\n\n${String(text_content).slice(0, 600_000)}`,
        },
        { kind: "text", text: PARTIAL_NOTE },
      ];
    } else {
      parts = [
        { kind: "pdf", filename: filename || "ledger.pdf", base64: pdf_base64 },
        { kind: "text", text: `Extract the ledger${filename ? ` from "${filename}"` : ""} into the JSON schema. Output JSON only.` },
      ];
    }

    const reply = await callModel(SYSTEM_PROMPT, parts, 8000);
    if (isModelError(reply)) return json({ error: reply.error }, reply.status);

    let parsed: unknown;
    try {
      parsed = parseJson(reply.text);
    } catch (_e) {
      // Truncation is the usual cause and has a specific remedy, so say which it
      // is rather than reporting a generic parse failure.
      // `code` is what the client keys its retry on — it re-sends this page range
      // one page at a time rather than losing the file. The prose is for the
      // human who sees it if even a single page will not fit.
      return json({
        error: reply.truncated
          ? "This page range holds more rows than one reply can carry. Retrying it a page at a time."
          : "The ledger-reading service returned output that could not be parsed.",
        code: reply.truncated ? "truncated" : "unparseable",
        truncated: reply.truncated,
        raw: reply.text.slice(0, 2000),
      }, 502);
    }

    return json({ ...(parsed as object), truncated: reply.truncated, model: reply.model, provider: reply.provider });
  } catch (e) {
    console.error("msme-extract-ledger error:", e);
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
