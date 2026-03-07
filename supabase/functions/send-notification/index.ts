import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ── Template & subject maps ──────────────────────────────────────────

const templateMap: Record<string, string> = {
  tds_due_7_days: "tds_due_7_days_reminder",
  tds_due_1_day: "tds_due_1_day_urgent",
  invoice_generated: "invoice_generated_notification",
};

const subjects: Record<string, string> = {
  tds_due_7_days: "TDS Due in 7 Days",
  tds_due_1_day: "URGENT: TDS Due Tomorrow",
  audit_report_ready: "Audit Report Ready for Review",
  invoice_generated: "New Invoice Generated",
  scrutiny_complete: "Scrutiny Complete — Findings Summary",
  new_user_welcome: "Welcome to CAFlow",
};

const channelRules: Record<string, ("whatsapp" | "email")[]> = {
  tds_due_7_days: ["whatsapp", "email"],
  tds_due_1_day: ["whatsapp", "email"],
  audit_report_ready: ["email"],
  invoice_generated: ["whatsapp", "email"],
  scrutiny_complete: ["email"],
  new_user_welcome: ["email"],
};

// ── Helpers ──────────────────────────────────────────────────────────

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function buildEmailHTML(type: string, payload: Record<string, any>): string {
  const wrapper = (body: string) => `
    <!DOCTYPE html><html><head><meta charset="utf-8"></head>
    <body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#333">
      ${body}
      <hr style="margin-top:30px;border:none;border-top:1px solid #eee">
      <p style="font-size:12px;color:#999">This is an automated message from CAFlow.</p>
    </body></html>`;

  switch (type) {
    case "tds_due_7_days":
      return wrapper(`
        <h2>TDS Due in 7 Days</h2>
        <p>This is a reminder that TDS is due in <strong>7 days</strong> for client <strong>${payload.client_name || "N/A"}</strong>.</p>
        <p>Section: ${payload.section || "N/A"} | Amount: ₹${payload.amount || "N/A"}</p>
        <p>Please ensure timely filing to avoid penalties.</p>`);
    case "tds_due_1_day":
      return wrapper(`
        <h2 style="color:#dc2626">URGENT: TDS Due Tomorrow</h2>
        <p>TDS filing for client <strong>${payload.client_name || "N/A"}</strong> is due <strong>tomorrow</strong>.</p>
        <p>Section: ${payload.section || "N/A"} | Amount: ₹${payload.amount || "N/A"}</p>
        <p style="color:#dc2626;font-weight:bold">Immediate action required.</p>`);
    case "audit_report_ready":
      return wrapper(`
        <h2>Audit Report Ready</h2>
        <p>The audit report for <strong>${payload.client_name || "N/A"}</strong> is ready for review.</p>
        ${payload.pdf_url ? `<p><a href="${payload.pdf_url}" style="background:#2563eb;color:#fff;padding:10px 20px;text-decoration:none;border-radius:4px">Download PDF Report</a></p>` : ""}`);
    case "invoice_generated":
      return wrapper(`
        <h2>Invoice Generated</h2>
        <p><strong>${payload.firm_name || "Your CA firm"}</strong> has sent you an invoice for <strong>₹${payload.amount || "N/A"}</strong>.</p>
        <p>Invoice No: ${payload.invoice_no || "N/A"} | Due Date: ${payload.due_date || "N/A"}</p>`);
    case "scrutiny_complete":
      return wrapper(`
        <h2>Scrutiny Complete</h2>
        <p>Scrutiny is complete for client <strong>${payload.client_name || "N/A"}</strong>.</p>
        <p><strong>${payload.high_count || 0} HIGH</strong> severity findings detected.</p>
        ${payload.xlsx_url ? `<p><a href="${payload.xlsx_url}" style="background:#2563eb;color:#fff;padding:10px 20px;text-decoration:none;border-radius:4px">Download XLSX Report</a></p>` : ""}`);
    case "new_user_welcome":
      return wrapper(`
        <h2>Welcome to CAFlow!</h2>
        <p>Your account has been created. Here are your login details:</p>
        <p>Email: <strong>${payload.email || "N/A"}</strong></p>
        <p>Temporary Password: <code style="background:#f3f4f6;padding:4px 8px;border-radius:4px;font-size:16px">${payload.password || "N/A"}</code></p>
        <p>Please change your password after your first login.</p>`);
    default:
      return wrapper(`<p>${JSON.stringify(payload)}</p>`);
  }
}

async function getRecipient(adminClient: any, recipientId: string) {
  const { data, error } = await adminClient
    .from("users")
    .select("id, name, email, phone")
    .eq("id", recipientId)
    .single();
  if (error || !data) return null;
  return data;
}

async function sendWhatsApp(
  type: string,
  phone: string,
  payload: Record<string, any>
): Promise<{ success: boolean; providerId?: string; error?: string }> {
  const apiKey = Deno.env.get("WATI_API_KEY");
  if (!apiKey) return { success: false, error: "WATI_API_KEY not configured" };

  const template = templateMap[type];
  if (!template) return { success: false, error: `No WhatsApp template for type: ${type}` };

  // Build parameters from payload
  const parameters = Object.entries(payload).map(([key, value]) => ({
    name: key,
    value: String(value),
  }));

  try {
    const res = await fetch(
      "https://live-mt-server.wati.io/api/v1/sendTemplateMessage",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          whatsappNumber: phone.replace(/[^0-9]/g, ""),
          template_name: template,
          broadcast_name: type,
          parameters,
        }),
      }
    );
    const result = await res.json();
    if (!res.ok) {
      return { success: false, error: result.message || JSON.stringify(result) };
    }
    return { success: true, providerId: result.messageId || result.id || null };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

async function sendEmail(
  type: string,
  email: string,
  payload: Record<string, any>
): Promise<{ success: boolean; providerId?: string; error?: string }> {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey) return { success: false, error: "RESEND_API_KEY not configured" };

  const subject = subjects[type] || "Notification from CAFlow";
  const html = buildEmailHTML(type, payload);

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "CAFlow <noreply@cafirm.app>",
        to: email,
        subject,
        html,
      }),
    });
    const result = await res.json();
    if (!res.ok) {
      return { success: false, error: result.message || JSON.stringify(result) };
    }
    return { success: true, providerId: result.id || null };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

async function logNotification(
  adminClient: any,
  params: {
    firm_id: string;
    recipient_id: string;
    channel: string;
    type: string;
    content: Record<string, any>;
    status: string;
    provider_id: string | null;
  }
) {
  await adminClient.from("notification_log").insert({
    firm_id: params.firm_id,
    recipient_id: params.recipient_id,
    channel: params.channel,
    type: params.type,
    content: params.content,
    status: params.status,
    provider_id: params.provider_id,
    sent_at: new Date().toISOString(),
  });
}

// ── Main handler ─────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const { type, recipient_id, firm_id, payload } = await req.json();

    // Validate input
    if (!type || !recipient_id || !firm_id) {
      return jsonResponse({ error: "Missing required fields: type, recipient_id, firm_id" }, 400);
    }

    const channels = channelRules[type];
    if (!channels) {
      return jsonResponse({ error: `Unknown notification type: ${type}` }, 400);
    }

    // Admin client for DB operations
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    // Resolve recipient
    const recipient = await getRecipient(adminClient, recipient_id);
    if (!recipient) {
      return jsonResponse({ error: `Recipient not found: ${recipient_id}` }, 404);
    }

    const results: Record<string, { status: string; error?: string; provider_id?: string }> = {};

    // Process each channel
    for (const channel of channels) {
      if (channel === "whatsapp") {
        if (!recipient.phone) {
          results.whatsapp = { status: "failed", error: "Recipient has no phone number" };
          await logNotification(adminClient, {
            firm_id, recipient_id, channel: "whatsapp", type,
            content: { payload, error: "No phone number" },
            status: "failed", provider_id: null,
          });
          continue;
        }
        const waResult = await sendWhatsApp(type, recipient.phone, payload || {});
        results.whatsapp = {
          status: waResult.success ? "sent" : "failed",
          ...(waResult.error && { error: waResult.error }),
          ...(waResult.providerId && { provider_id: waResult.providerId }),
        };
        await logNotification(adminClient, {
          firm_id, recipient_id, channel: "whatsapp", type,
          content: { payload, template: templateMap[type] },
          status: waResult.success ? "sent" : "failed",
          provider_id: waResult.providerId || null,
        });
      }

      if (channel === "email") {
        if (!recipient.email) {
          results.email = { status: "failed", error: "Recipient has no email" };
          await logNotification(adminClient, {
            firm_id, recipient_id, channel: "email", type,
            content: { payload, error: "No email" },
            status: "failed", provider_id: null,
          });
          continue;
        }
        const emailResult = await sendEmail(type, recipient.email, payload || {});
        results.email = {
          status: emailResult.success ? "sent" : "failed",
          ...(emailResult.error && { error: emailResult.error }),
          ...(emailResult.providerId && { provider_id: emailResult.providerId }),
        };
        await logNotification(adminClient, {
          firm_id, recipient_id, channel: "email", type,
          content: { payload, subject: subjects[type] },
          status: emailResult.success ? "sent" : "failed",
          provider_id: emailResult.providerId || null,
        });
      }
    }

    return jsonResponse({ success: true, results });
  } catch (err: any) {
    console.error("send-notification error:", err);
    return jsonResponse({ error: err.message || "Internal server error" }, 500);
  }
});
