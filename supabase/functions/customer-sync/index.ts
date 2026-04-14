/**
 * customer-sync Edge Function
 *
 * Server-side proxy for the eofficeportal FillCustomerlist API.
 * Solves browser CORS + expired SSL cert issues.
 *
 * SSL bypass strategy:
 *   Primary  — node:https with rejectUnauthorized:false  (same as sync_import.mjs — proven to work)
 *   Fallback — standard Deno fetch (may fail if cert is truly expired)
 *
 * Supabase Edge Functions support Node.js built-in modules via the `node:` specifier.
 */

// @ts-ignore — node: built-ins are available in Supabase Edge Functions
import { request as nodeRequest, Agent } from "node:https";
// @ts-ignore
import { request as nodeHttpRequest } from "node:http";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type," +
    "x-supabase-client-platform, x-supabase-client-platform-version",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const API_PATH =
  "/Company/SmartService.asmx/FillCustomerlist" +
  "?customerGroupid=nullksd9ow34e9w0sdmoaskjof8w0eur0wejfomasdojo9auwerwjrowejmfojaspf";

const API_HOST = "eofficeportal.com";
const API_URL_HTTPS = "https://" + API_HOST + API_PATH;
const API_URL_HTTP  = "http://"  + API_HOST + API_PATH;

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
// This mirrors sync_import.mjs which is the proven working approach.

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
        // SSL bypass — identical to sync_import.mjs Node.js approach
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

  // ── Tier 1: node:https with rejectUnauthorized:false (proven approach) ────
  try {
    console.log("[Sync] Trying node:https SSL bypass (HTTPS)…");
    const text = await fetchNodeHttps(API_URL_HTTPS, false);
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

  // ── Tier 2: node:http plain HTTP (no SSL at all) ──────────────────────────
  try {
    console.log("[Sync] Trying node:http (plain HTTP)…");
    const text = await fetchNodeHttps(API_URL_HTTP, true);
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

  // ── Tier 3: Deno createHttpClient SSL bypass ──────────────────────────────
  try {
    console.log("[Sync] Trying Deno createHttpClient SSL bypass…");
    // deno-lint-ignore no-explicit-any
    const Deno_ = (globalThis as any).Deno;
    if (Deno_?.createHttpClient) {
      const client = Deno_.createHttpClient({ caCerts: [], rejectUnauthorized: false });
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 30_000);
      try {
        const res = await fetch(API_URL_HTTPS, { signal: controller.signal, client } as RequestInit);
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

  // ── Tier 4: Standard Deno fetch (last resort) ─────────────────────────────
  try {
    console.log("[Sync] Trying standard Deno fetch…");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    try {
      const res = await fetch(API_URL_HTTPS, { signal: controller.signal });
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

  throw new Error(`All fetch attempts failed:\n${errors.join("\n")}`);
}

// ─── Handler ─────────────────────────────────────────────────────────────────

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
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
