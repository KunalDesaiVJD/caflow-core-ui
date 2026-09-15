/**
 * One AI transport for every edge function that reads a document.
 * ==============================================================
 *
 * Extracted from msme-extract-ledger, which worked out the hard parts first:
 * two providers whose request shapes genuinely differ, a vision route for
 * anything carrying a PDF or an image, and — the part that actually saves
 * time — turning an HTTP failure into something the firm can act on rather
 * than "AI extraction failed" in a log nobody reads.
 *
 * ── Why this exists ───────────────────────────────────────────────────────
 *
 * Because functions that hardcode ANTHROPIC_API_KEY break silently on a
 * project funded through OpenRouter. msme-extract-ledger's own note explains
 * the arrangement: "One OPENROUTER_API_KEY reaches Claude and every other
 * model, so the firm funds a single account; ANTHROPIC_API_KEY still works if
 * preferred." A new function that only knows about ANTHROPIC_API_KEY will
 * deploy cleanly and then fail on first use with a misleading "not
 * configured" — which is exactly what happened to
 * property-agreement-extract.
 *
 * ── Provider precedence ───────────────────────────────────────────────────
 *
 *   MSME_AI_PROVIDER forces a choice, when set and that key exists.
 *   Otherwise OPENROUTER_API_KEY wins, then ANTHROPIC_API_KEY.
 *
 * The env var keeps its MSME name deliberately: it is already set on the
 * project, and renaming it would silently change behaviour on the next
 * deploy. A key's name is part of the deployed configuration, not a detail
 * to tidy.
 *
 * ── Note on the second copy ───────────────────────────────────────────────
 *
 * msme-extract-ledger still carries its own inline version of this logic.
 * That is deliberate for now — it is deployed, working, and reading real
 * client ledgers, and migrating it means redeploying it. This module is the
 * canonical copy for everything new; msme-extract-ledger should be moved onto
 * it the next time it is touched for another reason.
 */

export type LegacyProvider = "openrouter" | "anthropic";
export type Provider = LegacyProvider | "claude-cli";

export type Part =
  | { kind: "text"; text: string }
  | { kind: "pdf"; filename: string; base64: string }
  | { kind: "image"; mediaType: string; base64: string };

export interface ModelReply {
  text: string;
  /** The reply hit the output cap — the caller must not treat it as complete. */
  truncated: boolean;
  model: string;
  provider: Provider;
}

export interface ProviderError {
  error: string;
  status: number;
}

export const isProviderError = (r: ModelReply | ProviderError): r is ProviderError =>
  (r as ProviderError).error !== undefined;

export interface CallOptions {
  /** Env var carrying a model override. Set per calling function. */
  modelEnv?: string;
  /** Model to use when nothing overrides it, per provider. */
  defaultModel: Record<LegacyProvider, string>;
  /** Shown to OpenRouter in X-Title, so spend is attributable per feature. */
  appTitle: string;
  maxTokens: number;
  /**
   * How hard the model should think before answering.
   *
   * This is the single biggest lever on wall-clock time, and it matters here
   * because Supabase cuts an edge-function request off at a 150s idle timeout.
   * Current Claude models run adaptive thinking by DEFAULT at "high" effort —
   * a real registered deed measured 173s that way, so the answer arrived 23
   * seconds after the connection had already gone.
   *
   * "low" allocates roughly a fifth of max_tokens to reasoning instead of four
   * fifths. For structured extraction — read the page, copy the figures — that
   * is the right trade: the work is careful reading, not deduction.
   *
   * Sent as `reasoning.effort` on OpenRouter and `output_config.effort` on
   * Anthropic direct; both accept low/medium/high/xhigh/max.
   */
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
}

export function resolveProvider(
  opts: Pick<CallOptions, "modelEnv" | "defaultModel">,
): { provider: LegacyProvider; apiKey: string; model: string } | null {
  const forced = (Deno.env.get("MSME_AI_PROVIDER") ?? "").trim().toLowerCase();
  const orKey = Deno.env.get("OPENROUTER_API_KEY");
  const anthKey = Deno.env.get("ANTHROPIC_API_KEY");

  let provider: LegacyProvider | null = null;
  if (forced === "anthropic" && anthKey) provider = "anthropic";
  else if (forced === "openrouter" && orKey) provider = "openrouter";
  else if (orKey) provider = "openrouter";
  else if (anthKey) provider = "anthropic";
  if (!provider) return null;

  const apiKey = (provider === "openrouter" ? orKey : anthKey)!;
  const override = opts.modelEnv ? (Deno.env.get(opts.modelEnv) ?? "").trim() : "";
  return { provider, apiKey, model: override || opts.defaultModel[provider] };
}

/**
 * One call, either transport.
 *
 * The two APIs differ in three ways that matter — how the system prompt is
 * passed, how a PDF is attached, and where the reply and the truncation flag
 * live — so each is built explicitly rather than pretending one shape fits
 * both.
 */
export async function callModel(
  system: string,
  parts: Part[],
  opts: CallOptions,
  timeoutMs = 120_000,
): Promise<ModelReply | ProviderError> {
  // Claude CLI is the application-wide default. The old API transports remain
  // available only as an explicit rollback switch.
  if ((Deno.env.get("CAFLOW_AI_BACKEND") ?? "claude-cli").trim().toLowerCase() !== "legacy-api") {
    return callClaudeCli(system, parts, opts, timeoutMs);
  }

  const resolved = resolveProvider(opts);
  if (!resolved) {
    return {
      error:
        "No AI provider is configured on this project. Set the OPENROUTER_API_KEY secret " +
        "(one key covers Claude and every other model) or ANTHROPIC_API_KEY.",
      status: 503,
    };
  }
  const { provider, apiKey, model } = resolved;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);

  let res: Response;
  try {
    res = provider === "openrouter"
      ? await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          signal: ctrl.signal,
          headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            "HTTP-Referer": "https://caflow-core-ui.vercel.app",
            "X-Title": opts.appTitle,
          },
          body: JSON.stringify({
            model,
            max_tokens: opts.maxTokens,
            ...(opts.effort ? { reasoning: { effort: opts.effort } } : {}),
            messages: [
              { role: "system", content: system },
              {
                role: "user",
                content: parts.map((p) => {
                  if (p.kind === "text") return { type: "text", text: p.text };
                  if (p.kind === "image") {
                    return { type: "image_url", image_url: { url: `data:${p.mediaType};base64,${p.base64}` } };
                  }
                  return {
                    type: "file",
                    file: { filename: p.filename, file_data: `data:application/pdf;base64,${p.base64}` },
                  };
                }),
              },
            ],
            // engine "native" hands the PDF to the model itself, matching the
            // direct Anthropic path — same fidelity, no per-page OCR fee.
            ...(parts.some((p) => p.kind === "pdf")
              ? { plugins: [{ id: "file-parser", pdf: { engine: "native" } }] }
              : {}),
          }),
        })
      : await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          signal: ctrl.signal,
          headers: {
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model,
            max_tokens: opts.maxTokens,
            ...(opts.effort ? { output_config: { effort: opts.effort } } : {}),
            system,
            messages: [{
              role: "user",
              content: parts.map((p) => {
                if (p.kind === "text") return { type: "text", text: p.text };
                if (p.kind === "image") {
                  return { type: "image", source: { type: "base64", media_type: p.mediaType, data: p.base64 } };
                }
                return {
                  type: "document",
                  source: { type: "base64", media_type: "application/pdf", data: p.base64 },
                };
              }),
            }],
          }),
        });
  } catch (e) {
    return {
      error: (e as Error)?.name === "AbortError"
        ? "The document reader timed out. Try a smaller file, or just the pages carrying the figures."
        : "The document reader could not be reached.",
      status: 504,
    };
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const body = await res.text();
    console.error(`${provider} error:`, res.status, body.slice(0, 800));
    return describeProviderError(res.status, body, model, provider, opts.modelEnv);
  }

  // Both linters, because this file is Deno source that the repo's eslint also
  // walks. The provider response genuinely is arbitrary JSON whose shape
  // differs per provider — it is narrowed immediately below.
  // deno-lint-ignore no-explicit-any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
    text: Array.isArray(body.content)
      ? body.content.filter((b: { type?: string }) => b?.type === "text").map((b: { text?: string }) => b.text ?? "").join("")
      : "",
    truncated: body.stop_reason === "max_tokens",
    model,
    provider,
  };
}

/**
 * Turn an HTTP failure from either provider into something the firm can act
 * on.
 *
 * Each cause has a different remedy: a spent balance needs a payment, a
 * withdrawn model needs a secret changed, a rate limit needs a wait.
 * Collapsing them into "extraction failed" is what sends a plain billing
 * problem to the server logs instead of to the person who could fix it in two
 * minutes.
 */
export function describeProviderError(
  status: number,
  body: string,
  model: string,
  provider: LegacyProvider,
  modelEnv?: string,
): ProviderError {
  let providerMsg = "";
  try {
    providerMsg = String((JSON.parse(body) as { error?: { message?: string } })?.error?.message ?? "");
  } catch {
    // Not JSON — fall through to the status-based cases.
  }

  // Billing. Anthropic returns this as a 400, so it would otherwise land in
  // the generic bucket; OpenRouter uses 402.
  if (status === 402 || /credit balance is too low|insufficient.*credit|purchase credits|billing|quota/i.test(providerMsg)) {
    const where = provider === "openrouter" ? "openrouter.ai/credits" : "console.anthropic.com under Plans & Billing";
    return {
      error: `The ${provider} account has no credits left. Add credits at ${where}. ` +
        "This affects every AI feature using the same key, not only this one.",
      status: 402,
    };
  }
  if (status === 401 || status === 403) {
    const secret = provider === "openrouter" ? "OPENROUTER_API_KEY" : "ANTHROPIC_API_KEY";
    return { error: `The ${provider} key was rejected. Update the ${secret} secret.`, status: 401 };
  }
  if (status === 429) {
    return {
      error: `${provider} is rate-limiting this account. Wait a minute and try again.`,
      status: 429,
    };
  }
  if (status === 404 || /model/i.test(providerMsg)) {
    return {
      error: `${provider} will not serve the model "${model}": ${providerMsg || "model not found"}. ` +
        (modelEnv
          ? `Set the ${modelEnv} secret to a current model (list them at openrouter.ai/models) and try again. No redeploy is needed.`
          : "Models get withdrawn — check the configured model."),
      status: 502,
    };
  }
  return {
    error: `${provider} returned ${status}${providerMsg ? `: ${providerMsg}` : ""}.`,
    status: 502,
  };
}

export async function callClaudeCli(
  system: string,
  parts: Part[],
  opts: CallOptions,
  timeoutMs = 120_000,
): Promise<ModelReply | ProviderError> {
  const gatewayUrl = (Deno.env.get("CLAUDE_CLI_GATEWAY_URL") ?? "").trim();
  const gatewaySecret = Deno.env.get("CLAUDE_CLI_GATEWAY_SECRET") ?? "";
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!gatewayUrl || !gatewaySecret || !supabaseUrl || !serviceKey) {
    return {
      error: "Claude CLI is not configured. Set CLAUDE_CLI_GATEWAY_URL and CLAUDE_CLI_GATEWAY_SECRET.",
      status: 503,
    };
  }

  const staged: string[] = [];
  const gatewayParts: Array<Record<string, unknown>> = [];
  const storage = createStorageClient(supabaseUrl, serviceKey);

  try {
    for (const part of parts) {
      if (part.kind === "text") {
        gatewayParts.push(part);
        continue;
      }
      const extension = part.kind === "pdf"
        ? ".pdf"
        : imageExtension(part.mediaType);
      const path = `ai-cli-temp/${crypto.randomUUID()}${extension}`;
      const bytes = Uint8Array.from(atob(part.base64), (char) => char.charCodeAt(0));
      const contentType = part.kind === "pdf" ? "application/pdf" : part.mediaType;
      const upload = await storage.upload(path, bytes, contentType);
      if (upload) return { error: `Could not stage the AI input: ${upload}`, status: 502 };
      staged.push(path);
      gatewayParts.push({
        kind: "storage",
        bucket: "documents",
        path,
        filename: part.kind === "pdf" ? part.filename : `page${extension}`,
        mediaType: contentType,
      });
    }

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs + 15_000);
    try {
      const response = await fetch(gatewayUrl, {
        method: "POST",
        signal: ctrl.signal,
        headers: {
          "Authorization": `Bearer ${gatewaySecret}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          system,
          parts: gatewayParts,
          model: cliModel(opts),
          effort: opts.effort || "low",
          timeoutMs,
        }),
      });
      const body = await response.json().catch(() => ({})) as {
        text?: string;
        error?: string;
        truncated?: boolean;
        model?: string;
      };
      if (!response.ok || typeof body.text !== "string") {
        return { error: body.error || `Claude CLI gateway returned ${response.status}.`, status: response.status || 502 };
      }
      return {
        text: body.text,
        truncated: body.truncated === true,
        model: body.model || cliModel(opts),
        provider: "claude-cli",
      };
    } catch (error) {
      return {
        error: (error as Error)?.name === "AbortError"
          ? "Claude CLI timed out while processing the request."
          : "Claude CLI gateway could not be reached.",
        status: 504,
      };
    } finally {
      clearTimeout(timer);
    }
  } finally {
    if (staged.length) await storage.remove(staged);
  }
}

/** Convenience entry point for functions whose AI request is text-only. */
export function callClaudeCliText(
  system: string,
  userText: string,
  timeoutMs = 120_000,
  model: "haiku" | "sonnet" | "opus" = "sonnet",
): Promise<ModelReply | ProviderError> {
  return callClaudeCli(system, [{ kind: "text", text: userText }], {
    defaultModel: { openrouter: model, anthropic: model },
    appTitle: "CAFlow",
    maxTokens: 16_000,
    effort: "low",
  }, timeoutMs);
}

function cliModel(opts: CallOptions): "haiku" | "sonnet" | "opus" {
  const override = opts.modelEnv ? (Deno.env.get(opts.modelEnv) ?? "").toLowerCase() : "";
  const configured = (Deno.env.get("CAFLOW_CLAUDE_CLI_MODEL") ?? override).toLowerCase();
  if (configured.includes("opus")) return "opus";
  if (configured.includes("haiku")) return "haiku";
  return "sonnet";
}

function imageExtension(mediaType: string): string {
  if (mediaType.includes("png")) return ".png";
  if (mediaType.includes("webp")) return ".webp";
  if (mediaType.includes("gif")) return ".gif";
  return ".jpg";
}

function createStorageClient(url: string, key: string) {
  const headers = { Authorization: `Bearer ${key}`, apikey: key };
  return {
    async upload(path: string, bytes: Uint8Array, contentType: string): Promise<string | null> {
      const response = await fetch(`${url}/storage/v1/object/documents/${path}`, {
        method: "POST",
        headers: { ...headers, "Content-Type": contentType, "x-upsert": "false" },
        body: bytes,
      });
      return response.ok ? null : (await response.text()).slice(0, 300);
    },
    async remove(paths: string[]): Promise<void> {
      await fetch(`${url}/storage/v1/object/documents`, {
        method: "DELETE",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ prefixes: paths }),
      }).catch(() => undefined);
    },
  };
}
