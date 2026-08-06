/**
 * Vercel serverless function — DEPRECATED proxy for eofficeportal FillCustomerlist API.
 *
 * SECURITY (enterprise audit, 2026-08): this endpoint used to run with no caller
 * authentication, a hardcoded eofficeportal access token, and a PROCESS-WIDE
 * `NODE_TLS_REJECT_UNAUTHORIZED=0` — which silently disabled TLS certificate
 * validation for every other outbound HTTPS call made by this same Vercel
 * function process, not just this one request. That has been removed entirely.
 *
 * The frontend (src/components/client-sync/useCustomerSync.ts) no longer calls
 * this route — it goes exclusively through the authenticated Supabase edge
 * function `customer-sync`, which has its own scoped, opt-in-only TLS-bypass
 * handling and reads its token from a Supabase secret instead of source code.
 * This handler is kept only as a locked stub in case anything still points at
 * this URL, so a stale link fails loudly and safely instead of silently
 * reopening the old exposure.
 *
 * Route: GET /api/eoffice (deprecated — do not wire anything new to this)
 */

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");

  if (req.method === "OPTIONS") { res.status(200).end(); return; }

  res.status(410).json({
    error: "This endpoint has been retired for security reasons (see api/eoffice.js). " +
      "Use the authenticated Supabase edge function 'customer-sync' instead.",
  });
}
