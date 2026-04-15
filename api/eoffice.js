/**
 * Vercel serverless function — proxy for eofficeportal FillCustomerlist API.
 *
 * Runs in Node.js (not Deno), so process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"
 * actually works and bypasses the expired SSL certificate on eofficeportal.com.
 *
 * Route: GET /api/eoffice
 * Used by: src/components/client-sync/useCustomerSync.ts  (Tier 0)
 */

const https = require("https");

const API_PATH =
  "/Company/SmartService.asmx/FillCustomerlist" +
  "?customerGroupid=nullksd9ow34e9w0sdmoaskjof8w0eur0wejfomasdojo9auwerwjrowejmfojaspf";

// Disable TLS certificate verification for this process — required because
// eofficeportal.com's SSL certificate is expired.
process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = "0";

module.exports = async function handler(req, res) {
  // CORS headers so the browser fetch from any origin is allowed
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");

  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }

  try {
    const xmlText = await new Promise((resolve, reject) => {
      const options = {
        hostname: "eofficeportal.com",
        port: 443,
        path: API_PATH,
        method: "GET",
        timeout: 30_000,
        rejectUnauthorized: false,       // Node.js respects this
        checkServerIdentity: () => undefined, // Skip identity check
        agent: new https.Agent({ rejectUnauthorized: false }),
      };

      const reqOut = https.request(options, (upstream) => {
        // Follow one redirect
        if (
          (upstream.statusCode === 301 || upstream.statusCode === 302) &&
          upstream.headers?.location
        ) {
          upstream.resume();
          const loc = upstream.headers.location;
          const redir = new URL(loc.startsWith("http") ? loc : "https://eofficeportal.com" + loc);
          const redirOpts = {
            hostname: redir.hostname,
            port: redir.port || 443,
            path: redir.pathname + redir.search,
            method: "GET",
            timeout: 30_000,
            rejectUnauthorized: false,
            checkServerIdentity: () => undefined,
            agent: new https.Agent({ rejectUnauthorized: false }),
          };
          const reqR = https.request(redirOpts, (r2) => {
            if (r2.statusCode !== 200) { reject(new Error(`HTTP ${r2.statusCode}`)); return; }
            let data = "";
            r2.on("data", (c) => { data += c; });
            r2.on("end", () => resolve(data));
          });
          reqR.on("error", reject);
          reqR.on("timeout", () => { reqR.destroy(); reject(new Error("Redirect timed out")); });
          reqR.end();
          return;
        }

        if (upstream.statusCode !== 200) {
          reject(new Error(`HTTP ${upstream.statusCode}`));
          return;
        }

        let data = "";
        upstream.on("data", (chunk) => { data += chunk; });
        upstream.on("end", () => resolve(data));
      });

      reqOut.on("error", reject);
      reqOut.on("timeout", () => { reqOut.destroy(); reject(new Error("Request timed out (30 s)")); });
      reqOut.end();
    });

    res.setHeader("Content-Type", "text/xml; charset=utf-8");
    res.status(200).send(xmlText);
  } catch (err) {
    res.status(502).json({ error: err.message || "Upstream request failed" });
  }
};
