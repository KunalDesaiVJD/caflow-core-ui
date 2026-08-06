/**
 * send-telegram-report — Edge Function
 *
 * Sends a PDF document to all Telegram users linked to the given firm.
 *
 * Request body:
 *   firm_id    string   — firm whose linked Telegram users to send to
 *   pdf_base64 string   — base64-encoded PDF bytes
 *   filename   string   — e.g. "Sundry_Debtors_2026-04-01_to_2026-05-19.pdf"
 *   caption    string   — Telegram message caption (supports Markdown)
 */

import { createClient } from "npm:@supabase/supabase-js@2";

const BOT_TOKEN           = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const SUPABASE_URL        = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      },
    });
  }

  try {
    const { firm_id, pdf_base64, filename, caption } = await req.json();

    if (!firm_id || !pdf_base64 || !filename) {
      return json({ error: "firm_id, pdf_base64, and filename are required" }, 400);
    }

    if (!BOT_TOKEN) {
      return json({ error: "TELEGRAM_BOT_TOKEN not configured" }, 500);
    }

    // ── Auth + firm-ownership gate (IDOR fix) ──
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace("Bearer ", "").trim();
    if (!token) return json({ error: "Unauthorized" }, 401);

    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) return json({ error: "Unauthorized" }, 401);

    const { data: dbUser } = await supabase.from("users").select("firm_id, role").eq("id", user.id).single();
    const isSuper = dbUser?.role === "superadmin";
    if (!isSuper && (!dbUser?.firm_id || String(firm_id) !== String(dbUser.firm_id))) {
      return json({ error: "Forbidden: firm_id does not match caller's firm" }, 403);
    }

    // Look up all Telegram users linked to this firm
    const { data: tgUsers, error: dbErr } = await supabase
      .from("telegram_authorized_users")
      .select("telegram_chat_id")
      .eq("firm_id", firm_id);

    if (dbErr) throw new Error("DB error: " + dbErr.message);
    if (!tgUsers || tgUsers.length === 0) {
      return json({ sent: 0, message: "No Telegram users linked to this firm" });
    }

    // Decode PDF base64 → Uint8Array
    const binaryStr = atob(pdf_base64);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
    const pdfBlob = new Blob([bytes], { type: "application/pdf" });

    // Send to each chat
    let sent = 0;
    const errors: string[] = [];

    for (const user of tgUsers) {
      try {
        const form = new FormData();
        form.append("chat_id", String(user.telegram_chat_id));
        form.append("document", pdfBlob, filename);
        form.append("caption", caption ?? "");
        form.append("parse_mode", "Markdown");

        const resp = await fetch(
          `https://api.telegram.org/bot${BOT_TOKEN}/sendDocument`,
          { method: "POST", body: form },
        );
        const result = await resp.json();
        if (result.ok) {
          sent++;
        } else {
          errors.push(`chat ${user.telegram_chat_id}: ${result.description}`);
        }
      } catch (e: any) {
        errors.push(`chat ${user.telegram_chat_id}: ${e.message}`);
      }
    }

    return json({ sent, total: tgUsers.length, errors });
  } catch (e: any) {
    console.error("send-telegram-report error:", e);
    return json({ error: e.message }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
