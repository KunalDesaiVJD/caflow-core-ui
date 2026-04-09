/**
 * customer-sync Edge Function
 *
 * Server-side proxy for the eofficeportal FillCustomerlist API.
 * Solves two browser-side problems:
 *   1. CORS — browser cannot call cross-origin .asmx endpoints
 *   2. SSL  — eofficeportal.com may have an expired/invalid certificate
 *             (Deno runtime verifies certs by default; we pass
 *              DENO_TLS_CA_STORE and/or skip verify if needed — see below)
 *
 * Frontend usage:
 *   const { data, error } = await supabase.functions.invoke('customer-sync');
 *   // data: ApiRecord[]  (parsed JSON array, already extracted from XML)
 *
 * Response:
 *   200  { records: ApiRecord[] }
 *   502  { error: string }        — upstream fetch / parse failure
 *   500  { error: string }        — unexpected runtime error
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

// ─── CORS headers (allow CaFlow frontend, any origin in dev) ─────────────────

const corsHeaders = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type," +
    "x-supabase-client-platform, x-supabase-client-platform-version",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

// ─── Upstream API URL ────────────────────────────────────────────────────────

const UPSTREAM_URL =
  "https://eofficeportal.com/Company/SmartService.asmx/FillCustomerlist" +
  "?customerGroupid=nullksd9ow34e9w0sdmoaskjof8w0eur0wejfomasdojo9auwerwjrowejmfojaspf";

// ─── XML → JSON parser (mirrors frontend parseCustomerList) ──────────────────

function parseCustomerList(rawText: string): unknown[] {
  // Response format: text/xml with a <string> element containing a JSON array
  // We do a simple string extraction to avoid a DOM parser dependency in Deno.
  const openTag  = rawText.indexOf("<string");
  const closeTag = rawText.indexOf("</string>");

  if (openTag === -1 || closeTag === -1) {
    throw new Error("API response is missing expected <string> element");
  }

  // Move past the full opening tag (may have xmlns attributes)
  const contentStart = rawText.indexOf(">", openTag) + 1;
  const jsonStr = rawText.slice(contentStart, closeTag).trim();

  if (!jsonStr) throw new Error("Empty <string> element in API response");

  const records = JSON.parse(jsonStr);
  if (!Array.isArray(records)) throw new Error("Expected a JSON array inside the XML");

  return records;
}

// ─── Handler ─────────────────────────────────────────────────────────────────

serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Fetch from upstream with a 30-second timeout
    // NOTE: If eofficeportal.com has an expired SSL cert, set the env var
    //       DENO_TLS_CA_STORE=system (or use a custom CA) in the function
    //       settings. Alternatively, deploy with --no-verify-ssl flag.
    //       For now we attempt a normal fetch; errors surface as a 502.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);

    let upstream: Response;
    try {
      upstream = await fetch(UPSTREAM_URL, {
        signal: controller.signal,
        // Deno fetch respects standard TLS; add CA bundle via env if needed.
      });
    } finally {
      clearTimeout(timer);
    }

    if (!upstream.ok) {
      return new Response(
        JSON.stringify({ error: `Upstream API returned HTTP ${upstream.status}` }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const rawText = await upstream.text();

    let records: unknown[];
    try {
      records = parseCustomerList(rawText);
    } catch (parseErr: unknown) {
      const msg = parseErr instanceof Error ? parseErr.message : String(parseErr);
      return new Response(
        JSON.stringify({ error: `Parse error: ${msg}` }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({ records }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );

  } catch (err: unknown) {
    const isAbort = err instanceof Error && err.name === "AbortError";
    const message = isAbort
      ? "Request timed out (30 s). The upstream server did not respond."
      : err instanceof Error ? err.message : "Unknown error";

    return new Response(
      JSON.stringify({ error: message }),
      { status: isAbort ? 504 : 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
