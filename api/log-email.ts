// api/log-email.ts — Vercel Serverless Function (Node.js runtime)
// Uses service-role key (set in Vercel env vars) to bypass Supabase RLS
// and insert into notification_log on every email send from the billing module.
import { createClient } from "@supabase/supabase-js";

export default async function handler(req: any, res: any) {
  // Only allow POST
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    console.error("[log-email] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars");
    return res.status(500).json({ error: "Server misconfiguration" });
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const {
    firm_id,
    recipient_id,
    client_id,
    client_group_id,
    channel = "email",
    type = "invoice_generated",
    content,
    status = "sent",
    sent_at,
  } = req.body ?? {};

  if (!firm_id || !content) {
    return res.status(400).json({ error: "firm_id and content are required" });
  }

  const { error } = await adminClient.from("notification_log").insert({
    firm_id,
    recipient_id: recipient_id || null,
    client_id: client_id || null,
    client_group_id: client_group_id || null,
    channel,
    type,
    content,
    status,
    provider_id: null,
    sent_at: sent_at || new Date().toISOString(),
  });

  if (error) {
    console.error("[log-email] Insert failed:", error);
    return res.status(500).json({ error: error.message });
  }

  return res.status(200).json({ success: true });
}
