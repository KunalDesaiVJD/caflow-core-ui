/**
 * customer-sync Edge Function
 *
 * Server-side proxy for the eofficeportal FillCustomerlist API.
 * Solves browser CORS + expired SSL cert issues.
 *
 * SECURITY (see enterprise audit, 2026-08): this function used to (a) run with
 * no caller authentication at all, (b) hardcode the eofficeportal access token
 * in source, and (c) unconditionally disable TLS certificate verification with
 * an HTTP fallback. All three are fixed below:
 *   - Requires a valid Supabase Bearer token (any authenticated CAFlow user —
 *     this proxies a shared external customer list, not per-firm data).
 *   - The `customerGroupid` token is now read from the EOFFICE_CUSTOMER_GROUP_ID
 *     secret (`npx supabase secrets set EOFFICE_CUSTOMER_GROUP_ID=<token>`),
 *     never hardcoded. Treat the OLD hardcoded value as compromised.
 *   - Standard, fully-verified TLS is tried FIRST. The insecure bypass tiers
 *     only run if EOFFICE_ALLOW_INSECURE_TLS=true is explicitly set — they are
 *     OFF by default. If eofficeportal.com's certificate is genuinely expired,
 *     fix/renew it (or get it re-issued) rather than leaving the bypass on.
 *
 * Supabase Edge Functions support Node.js built-in modules via the `node:` specifier.
 */

// @ts-ignore — node: built-ins are available in Supabase Edge Functions
import { request as nodeRequest, Agent } from "node:https";
// @ts-ignore
import { request as nodeHttpRequest } from "node:http";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type," +
    "x-supabase-client-platform, x-supabase-client-platform-version",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const CUSTOMER_GROUP_ID = Deno.env.get("EOFFICE_CUSTOMER_GROUP_ID");
const ALLOW_INSECURE_TLS = Deno.env.get("EOFFICE_ALLOW_INSECURE_TLS") === "true";

const API_HOST = "eofficeportal.com";
function apiPath(): string {
  // "null" prefix preserved from the original working query string — appears
  // to be how eofficeportal's ASMX endpoint expects a null-group placeholder
  // combined with the token, based on the value's original form.
  return "/Company/SmartService.asmx/FillCustomerlist?customerGroupid=null" + (CUSTOMER_GROUP_ID ?? "");
}
const API_URL_HTTPS = () => "https://" + API_HOST + apiPath();
const API_URL_HTTP  = () => "http://"  + API_HOST + apiPath();

// ─── XML → JSON parser ────────────────────────────────────────────────────────

function parseCustomerList(rawText: string): unknown[] {
  const openTag  = rawText.indexOf("<string");
  const closeTag = rawText.indexOf("</string>");
  if (openTag === -1 || closeTag === -1) {
    throw new Error("API response is missing expected <string> element");
  }
  const contentStart = rawText.indexOf(">", openTag) + 1;
  const jsonStr = rawText.slice(contentStart, closeTag).trim();
  if (!jsonStr) throw new Error("Empty <string> element in API response");
  const records = JSON.parse(jsonStr);
  if (!Array.isArray(records)) throw new Error("Expected a JSON array inside the XML");
  return records;
}

// ─── Fetch via node:https with SSL verification disabled ──────────────────────
// NOTE: In Deno's Node.js compat layer, Agent({ rejectUnauthorized:false }) is NOT
// respected — Deno's own TLS stack is used instead. The fix is to pass
// rejectUnauthorized:false DIRECTLY in the request options AND override
// checkServerIdentity, both of which Deno's compat layer does honour.

function fetchNodeHttps(url: string, useHttp = false): Promise<string> {
  return new Promise((resolve, reject) => {
    const parsed   = new URL(url);
    const options  = {
      hostname: parsed.hostname,
      port:     parsed.port || (useHttp ? 80 : 443),
      path:     parsed.pathname + parsed.search,
      method:   "GET",
      timeout:  30_000,
      ...(useHttp ? {} : {
        // Pass directly in options (not just in Agent) — Deno compat honours these
        rejectUnauthorized:  false,
        checkServerIdentity: () => undefined,  // Completely skip identity check
        agent: new Agent({ rejectUnauthorized: false }),
      }),
    };

    const requester = useHttp ? nodeHttpRequest : nodeRequest;

    const req = (requester as any)(options, (res: any) => {
      // Follow redirects (HTTP → HTTPS) one level deep
      if ((res.statusCode === 301 || res.statusCode === 302) && res.headers?.location) {
        const location = res.headers.location as string;
        console.log("[Sync] Redirect →", location);
        // Redirect from HTTP usually goes to HTTPS — recurse with HTTPS+SSL bypass
        fetchNodeHttps(
          location.startsWith("http") ? location : "https://" + API_HOST + location,
          false,
        ).then(resolve).catch(reject);
        return;
      }

      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }

      let data = "";
      res.on("data", (chunk: any) => { data += chunk; });
      res.on("end", () => resolve(data));
    });

    req.on("error", (e: Error) => reject(e));
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Request timed out (30 s)"));
    });
    req.end();
  });
}

// ─── Fetch upstream — node:https SSL bypass first, plain Deno fetch fallback ──

async function fetchUpstream(): Promise<string> {
  const errors: string[] = [];

  // ── Tier 1 (default, always tried first): standard, fully-verified TLS ────
  try {
    console.log("[Sync] Trying standard verified fetch…");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    try {
      const res = await fetch(API_URL_HTTPS(), { signal: controller.signal });
      if (res.ok) {
        const text = await res.text();
        if (text.trim()) {
          console.log("[Sync] Standard fetch succeeded, length:", text.length);
          return text;
        }
        errors.push("Standard fetch: empty response");
      } else {
        errors.push(`Standard fetch: status ${res.status}`);
      }
    } finally {
      clearTimeout(timer);
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    errors.push(`Standard fetch: ${msg}`);
    console.warn("[Sync] Standard fetch failed:", msg);
  }

  if (!ALLOW_INSECURE_TLS) {
    throw new Error(
      `Verified TLS fetch to eofficeportal.com failed and EOFFICE_ALLOW_INSECURE_TLS is not set ` +
      `(insecure fallback is intentionally disabled by default). If the certificate is genuinely ` +
      `expired/misconfigured, fix it upstream or set EOFFICE_ALLOW_INSECURE_TLS=true as a deliberate, ` +
      `understood risk. Errors: ${errors.join("; ")}`
    );
  }

  console.warn("[Sync] EOFFICE_ALLOW_INSECURE_TLS=true — falling back to TLS-bypass tiers. " +
    "This accepts MITM risk on client PII (PAN/TAN/GST/Aadhaar) in transit.");

  // ── Tier 2: node:https with rejectUnauthorized:false (opt-in only) ────────
  try {
    console.log("[Sync] Trying node:https SSL bypass (HTTPS)…");
    const text = await fetchNodeHttps(API_URL_HTTPS(), false);
    if (text.trim()) {
      console.log("[Sync] node:https HTTPS succeeded, length:", text.length);
      return text;
    }
    errors.push("node:https HTTPS: empty response");
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    errors.push(`node:https HTTPS: ${msg}`);
    console.warn("[Sync] node:https HTTPS failed:", msg);
  }

  // ── Tier 3: Deno createHttpClient SSL bypass (opt-in only) ────────────────
  try {
    console.log("[Sync] Trying Deno createHttpClient SSL bypass…");
    // deno-lint-ignore no-explicit-any
    const Deno_ = (globalThis as any).Deno;
    if (Deno_?.createHttpClient) {
      const client = Deno_.createHttpClient({ caCerts: [], rejectUnauthorized: false });
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 30_000);
      try {
        const res = await fetch(API_URL_HTTPS(), { signal: controller.signal, client } as RequestInit);
        if (res.ok) {
          const text = await res.text();
          if (text.trim()) {
            console.log("[Sync] Deno SSL bypass succeeded, length:", text.length);
            return text;
          }
          errors.push("Deno SSL bypass: empty response");
        } else {
          errors.push(`Deno SSL bypass: status ${res.status}`);
        }
      } finally {
        clearTimeout(timer);
      }
    } else {
      errors.push("Deno SSL bypass: createHttpClient not available");
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    errors.push(`Deno SSL bypass: ${msg}`);
    console.warn("[Sync] Deno SSL bypass failed:", msg);
  }

  // ── Tier 4: plain HTTP, no TLS at all (opt-in only, last resort) ──────────
  try {
    console.log("[Sync] Trying node:http (plain HTTP)…");
    const text = await fetchNodeHttps(API_URL_HTTP(), true);
    if (text.trim()) {
      console.log("[Sync] node:http succeeded, length:", text.length);
      return text;
    }
    errors.push("node:http: empty response");
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    errors.push(`node:http: ${msg}`);
    console.warn("[Sync] node:http failed:", msg);
  }

  throw new Error(`All fetch attempts failed:\n${errors.join("\n")}`);
}

// ─── Handler ─────────────────────────────────────────────────────────────────

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Require any authenticated CAFlow user (this proxies a shared external
    // customer feed, not per-firm data — but it must not be a fully open,
    // unauthenticated internet-facing endpoint, which it was before this fix).
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace("Bearer ", "").trim();
    if (!token) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const authClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );
    const { data: { user }, error: authErr } = await authClient.auth.getUser(token);
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!CUSTOMER_GROUP_ID) {
      return new Response(
        JSON.stringify({ error: "EOFFICE_CUSTOMER_GROUP_ID secret is not configured. Set it via: npx supabase secrets set EOFFICE_CUSTOMER_GROUP_ID=<token>" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const rawText = await fetchUpstream();

    let records: unknown[];
    try {
      records = parseCustomerList(rawText);
    } catch (parseErr: unknown) {
      const msg = parseErr instanceof Error ? parseErr.message : String(parseErr);
      console.error("[Sync] Parse error:", msg, "| Raw preview:", rawText.slice(0, 200));
      return new Response(
        JSON.stringify({ error: `Parse error: ${msg}` }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    console.log("[Sync] Returning", records.length, "records");
    return new Response(
      JSON.stringify({ records }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );

  } catch (err: unknown) {
    const isAbort  = err instanceof Error && err.name === "AbortError";
    const message  = isAbort
      ? "Request timed out (30 s). The upstream server did not respond."
      : err instanceof Error ? err.message : "Unknown error";

    console.error("[Sync] Handler error:", message);
    return new Response(
      JSON.stringify({ error: message }),
      { status: isAbort ? 504 : 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
