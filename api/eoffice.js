/**
 * Vercel serverless function — proxy for eofficeportal FillCustomerlist API.
 *
 * Runs in real Node.js (unlike the Supabase edge function, which runs on
 * Deno — Deno's TLS stack does NOT honour rejectUnauthorized:false, so it
 * cannot bypass eofficeportal.com's expired certificate at all; confirmed
 * via edge function logs: every fetch strategy there fails with
 * "invalid peer certificate: Expired", even the ones that explicitly try
 * to disable verification). Node's https.Agent DOES honour it, so this
 * route is the only path that can actually reach eofficeportal.com.
 *
 * SECURITY (this route was retired 2026-08 after an audit found two real
 * problems — both fixed here, not just re-reverted):
 *   1. No caller authentication — this used to be a fully open proxy.
 *      Now requires a valid Supabase Bearer token (any authenticated
 *      CAFlow user), verified server-side via supabase-js.
 *   2. `process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"` was set at module
 *      scope — that disables TLS verification for EVERY outbound HTTPS
 *      call made by this Vercel function's process, not just this one
 *      request, including any other invocation sharing a warm container.
 *      That line is gone. The bypass here is scoped to this one request
 *      only, via `agent: new https.Agent({ rejectUnauthorized: false })`
 *      passed directly on the https.request() call — Node's officially
 *      supported per-request mechanism, no process-wide side effect.
 *   3. The eofficeportal access token used to be hardcoded in this file
 *      (shipped to Vercel's build, visible to anyone with repo access).
 *      Now read from the EOFFICE_CUSTOMER_GROUP_ID environment variable
 *      (Vercel Project Settings → Environment Variables) — same secret
 *      value the Supabase edge function's EOFFICE_CUSTOMER_GROUP_ID uses.
 *
 * Route: GET /api/eoffice
 * Used by: src/components/client-sync/useCustomerSync.ts (Tier 0, tried
 *          first; falls back to the Supabase edge function 'customer-sync'
 *          if this route is unavailable for any reason).
 */

import https from "https";
import { createClient } from "@supabase/supabase-js";

const CUSTOMER_GROUP_ID = process.env.EOFFICE_CUSTOMER_GROUP_ID || "";
const API_HOST = "eofficeportal.com";
// "null" prefix preserved from the token's original working query-string form.
const API_PATH = "/Company/SmartService.asmx/FillCustomerlist?customerGroupid=null" + CUSTOMER_GROUP_ID;

function parseCustomerList(rawText) {
  const openTag = rawText.indexOf("<string");
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

function fetchXml(hostname, path) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname,
      port: 443,
      path,
      method: "GET",
      timeout: 30_000,
      // Scoped to THIS request only — see security note above. No global
      // process.env.NODE_TLS_REJECT_UNAUTHORIZED override.
      agent: new https.Agent({ rejectUnauthorized: false }),
    };

    const req = https.request(options, (res) => {
      if ((res.statusCode === 301 || res.statusCode === 302) && res.headers?.location) {
        res.resume();
        const loc = res.headers.location;
        const redir = new URL(loc.startsWith("http") ? loc : "https://" + hostname + loc);
        fetchXml(redir.hostname, redir.pathname + redir.search).then(resolve).catch(reject);
        return;
      }
      if (res.statusCode !== 200) { reject(new Error(`HTTP ${res.statusCode}`)); return; }
      let data = "";
      res.on("data", (c) => { data += c; });
      res.on("end", () => resolve(data));
    });

    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("Request timed out (30 s)")); });
    req.end();
  });
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "authorization, content-type");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");

  if (req.method === "OPTIONS") { res.status(200).end(); return; }
  if (req.method !== "GET") { res.status(405).json({ error: "Method not allowed" }); return; }

  // ── Auth gate — any authenticated CAFlow user, same requirement as the
  //    Supabase edge function 'customer-sync'. ──────────────────────────
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!token) { res.status(401).json({ error: "Unauthorized" }); return; }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    console.error("[eoffice] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars");
    res.status(500).json({ error: "Server misconfiguration" });
    return;
  }
  const authClient = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
  const { data: userData, error: userErr } = await authClient.auth.getUser(token);
  if (userErr || !userData?.user) { res.status(401).json({ error: "Unauthorized" }); return; }

  if (!CUSTOMER_GROUP_ID) {
    res.status(500).json({ error: "EOFFICE_CUSTOMER_GROUP_ID is not set in this Vercel project's environment variables." });
    return;
  }

  try {
    const xmlText = await fetchXml(API_HOST, API_PATH);
    const records = parseCustomerList(xmlText);
    res.status(200).json({ records });
  } catch (err) {
    res.status(502).json({ error: err.message || "Upstream request failed" });
  }
}
