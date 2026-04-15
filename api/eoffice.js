/**
 * Vercel serverless function — proxy for eofficeportal FillCustomerlist API.
 *
 * Runs in Node.js (not Deno), so rejectUnauthorized:false actually works
 * and bypasses the expired SSL certificate on eofficeportal.com.
 *
 * Route: GET /api/eoffice
 * Used by: src/components/client-sync/useCustomerSync.ts (Tier 0)
 */

import https from "https";

// Disable TLS cert verification — eofficeportal.com has an expired cert
process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = "0";

const API_PATH =
  "/Company/SmartService.asmx/FillCustomerlist" +
  "?customerGroupid=nullksd9ow34e9w0sdmoaskjof8w0eur0wejfomasdojo9auwerwjrowejmfojaspf";

function fetchXml(hostname, path) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname,
      port: 443,
      path,
      method: "GET",
      timeout: 30_000,
      rejectUnauthorized: false,
      checkServerIdentity: () => undefined,
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
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");

  if (req.method === "OPTIONS") { res.status(200).end(); return; }

  try {
    const xmlText = await fetchXml("eofficeportal.com", API_PATH);
    res.setHeader("Content-Type", "text/xml; charset=utf-8");
    res.status(200).send(xmlText);
  } catch (err) {
    res.status(502).json({ error: err.message || "Upstream request failed" });
  }
}
