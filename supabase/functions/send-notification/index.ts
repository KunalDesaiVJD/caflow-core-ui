/**
 * send-notification — Supabase Edge Function
 *
 * Sends email via Microsoft Graph API (OAuth2 / Modern Auth).
 * Required secrets:
 *   GRAPH_TENANT_ID, GRAPH_CLIENT_ID, GRAPH_CLIENT_SECRET
 *   SMTP_SENDER (accounts@vjdesai.com)
 *
 * WhatsApp via WATI (WATI_API_KEY secret).
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ── Subject map ──────────────────────────────────────────────────────

const subjects: Record<string, string> = {
  tds_due_7_days:            "TDS Due in 7 Days",
  tds_due_1_day:             "URGENT: TDS Due Tomorrow",
  audit_report_ready:        "Audit Report Ready for Review",
  invoice_generated:         "Invoice from V J Desai & Co. LLP",
  scrutiny_complete:         "Scrutiny Complete — Findings Summary",
  new_user_welcome:          "Welcome to CAFlow",
  credit_note_issued:        "Credit Note Issued",
  quotation_sent:            "Quotation for Your Review",
  proforma_sent:             "Proforma Invoice",
  ledger_statement:          "Ledger Statement",
  payment_reminder:          "Payment Reminder",
  internal_filing_reminder:  "Filing Reminder",
  // Audit communication templates
  audit_commencement:        "Commencement of Statutory Audit",
  audit_document_request:    "Document Request — Audit",
  audit_query_dispatch:      "Audit Queries — Action Required",
  audit_query_reminder:      "Reminder: Pending Audit Queries",
  audit_draft_report:        "Draft Audit Report for Review",
  audit_final_report:        "Audit Report Finalized",
};

const templateMap: Record<string, string> = {
  tds_due_7_days:        "tds_due_7_days_reminder",
  tds_due_1_day:         "tds_due_1_day_urgent",
  invoice_generated:     "invoice_generated_notification",
  credit_note_issued:    "credit_note_issued_notification",
  payment_reminder:      "payment_reminder_notification",
  // Phase 4B: audit query reminders via WATI
  audit_query_reminder:  "audit_query_reminder",
  audit_query_dispatch:  "audit_query_dispatch",
};

const channelRules: Record<string, ("whatsapp" | "email")[]> = {
  tds_due_7_days:            ["whatsapp", "email"],
  tds_due_1_day:             ["whatsapp", "email"],
  audit_report_ready:        ["email"],
  invoice_generated:         ["email"],
  scrutiny_complete:         ["email"],
  new_user_welcome:          ["email"],
  credit_note_issued:        ["email"],
  quotation_sent:            ["email"],
  proforma_sent:             ["email"],
  ledger_statement:          ["email"],
  payment_reminder:          ["email"],
  internal_filing_reminder:  ["whatsapp"],
  // Audit communication templates
  audit_commencement:        ["email"],
  audit_document_request:    ["email"],
  audit_query_dispatch:      ["email"],
  audit_query_reminder:      ["email"],     // Phase 4B: also handles whatsapp via direct_whatsapp param
  audit_draft_report:        ["email"],
  audit_final_report:        ["email"],
};

// ── Helpers ──────────────────────────────────────────────────────────

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ── Email HTML builder ───────────────────────────────────────────────

function buildEmailHTML(type: string, payload: Record<string, any>): string {
  const firmName = payload.firm_name || "V J Desai & Co. LLP, Chartered Accountants";
  const amt = payload.amount
    ? `₹${Number(payload.amount).toLocaleString("en-IN")}`
    : "N/A";

  const wrapper = (body: string) => `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
  body{font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:0;color:#333}
  .hdr{background:#1a3a5c;color:#fff;padding:18px 24px}
  .hdr h2{margin:0;font-size:18px;font-weight:600}
  .hdr p{margin:4px 0 0;font-size:12px;opacity:.8}
  .bdy{border:1px solid #e5e7eb;border-top:none;padding:24px}
  table.info{width:100%;border-collapse:collapse;margin:16px 0}
  table.info td{padding:8px 0;border-bottom:1px solid #f3f4f6;font-size:14px}
  table.info td:first-child{color:#6b7280;width:40%}
  table.info td:last-child{font-weight:600}
  .ftr{margin-top:20px;font-size:11px;color:#9ca3af;border-top:1px solid #f3f4f6;padding-top:12px}
</style></head>
<body>
  <div class="hdr">
    <h2>${firmName}</h2>
    <p>Chartered Accountants</p>
  </div>
  <div class="bdy">${body}</div>
  <div style="padding:0 24px">
    <div class="ftr">
      This is an automated message from CAFlow Practice Management. Please do not reply to this email.<br>
      For queries, contact us at <a href="mailto:accounts@vjdesai.com">accounts@vjdesai.com</a>
    </div>
  </div>
</body></html>`;

  // ── Audit email templates: full HTML pre-built by frontend ────────────
  // When custom_html is supplied the caller has already assembled the complete
  // branded email; return it verbatim so the edge function acts as a relay only.
  if (payload.custom_html) {
    return payload.custom_html as string;
  }

  switch (type) {
    // ── Audit communication pass-through types ───────────────────────────
    case "audit_commencement":
    case "audit_document_request":
    case "audit_query_dispatch":
    case "audit_query_reminder":
    case "audit_draft_report":
    case "audit_final_report":
      return wrapper(`
        <p>Dear ${payload.client_name || "Client"},</p>
        <p>${payload.custom_message || "Please find the audit communication details below."}</p>
        ${payload.portal_url ? `
        <p style="margin:16px 0;">
          <a href="${payload.portal_url}"
             style="background:#c8960c;color:#fff;padding:10px 22px;border-radius:6px;text-decoration:none;font-weight:600;display:inline-block;">
            View in Client Portal →
          </a>
        </p>` : ""}
        <p>Regards,<br><strong>${firmName}</strong><br><em>Chartered Accountants</em></p>
      `);

    case "invoice_generated":
      return wrapper(`
        <p>Dear ${payload.client_name || "Client"},</p>
        <p>Please find below the details of your invoice:</p>
        <table class="info">
          <tr><td>Invoice No.</td><td>${payload.invoice_no || "N/A"}</td></tr>
          <tr><td>Amount</td><td>${amt}</td></tr>
          ${payload.due_date ? `<tr><td>Due Date</td><td>${payload.due_date}</td></tr>` : ""}
          ${payload.document_type ? `<tr><td>Type</td><td>${payload.document_type}</td></tr>` : ""}
        </table>
        ${payload.custom_message ? `<p style="margin-top:12px">${payload.custom_message}</p>` : ""}
        <p>Kindly arrange payment at the earliest convenience.</p>
        <p>Thank you for your continued trust in our services.</p>
        <p>Regards,<br><strong>${firmName}</strong></p>`);

    case "quotation_sent":
      return wrapper(`
        <p>Dear ${payload.client_name || "Client"},</p>
        <p>Please find our quotation for your reference:</p>
        <table class="info">
          <tr><td>Document No.</td><td>${payload.invoice_no || "N/A"}</td></tr>
          <tr><td>Amount</td><td>${amt}</td></tr>
        </table>
        ${payload.custom_message ? `<p>${payload.custom_message}</p>` : ""}
        <p>Please review and revert with your confirmation.</p>
        <p>Regards,<br><strong>${firmName}</strong></p>`);

    case "proforma_sent":
      return wrapper(`
        <p>Dear ${payload.client_name || "Client"},</p>
        <p>Please find the proforma invoice below:</p>
        <table class="info">
          <tr><td>Document No.</td><td>${payload.invoice_no || "N/A"}</td></tr>
          <tr><td>Amount</td><td>${amt}</td></tr>
        </table>
        ${payload.custom_message ? `<p>${payload.custom_message}</p>` : ""}
        <p>Regards,<br><strong>${firmName}</strong></p>`);

    case "credit_note_issued":
      return wrapper(`
        <p>Dear ${payload.client_name || "Client"},</p>
        <p>A credit note has been issued against your account:</p>
        <table class="info">
          <tr><td>Credit Note No.</td><td>${payload.invoice_no || "N/A"}</td></tr>
          <tr><td>Amount</td><td>${amt}</td></tr>
        </table>
        ${payload.custom_message ? `<p>${payload.custom_message}</p>` : ""}
        <p>Regards,<br><strong>${firmName}</strong></p>`);

    case "payment_reminder":
      return wrapper(`
        <p>Dear ${payload.client_name || "Client"},</p>
        <p>This is a friendly reminder for the outstanding payment:</p>
        <table class="info">
          <tr><td>Invoice No.</td><td>${payload.invoice_no || "N/A"}</td></tr>
          <tr><td>Outstanding Amount</td><td style="color:#dc2626">${amt}</td></tr>
        </table>
        <p>Please process the payment at your earliest convenience to avoid any inconvenience.</p>
        <p>Regards,<br><strong>${firmName}</strong></p>`);

    case "tds_due_7_days":
      return wrapper(`
        <p>Dear Team,</p>
        <p>TDS filing for <strong>${payload.client_name || "N/A"}</strong> is due in <strong>7 days</strong>.</p>
        <table class="info">
          <tr><td>Section</td><td>${payload.section || "N/A"}</td></tr>
          <tr><td>Amount</td><td>${amt}</td></tr>
        </table>
        <p>Please ensure timely filing to avoid penalties.</p>`);

    case "tds_due_1_day":
      return wrapper(`
        <p style="color:#dc2626;font-weight:bold;font-size:16px">⚠ URGENT: TDS Due Tomorrow</p>
        <p>TDS filing for <strong>${payload.client_name || "N/A"}</strong> is due <strong>tomorrow</strong>.</p>
        <table class="info">
          <tr><td>Section</td><td>${payload.section || "N/A"}</td></tr>
          <tr><td>Amount</td><td style="color:#dc2626">${amt}</td></tr>
        </table>
        <p style="color:#dc2626">Immediate action required to avoid penalties.</p>`);

    case "ledger_statement":
      return wrapper(`
        <p>Dear ${payload.client_name || "Client"},</p>
        <p>Please find your ledger statement for your review. Kindly confirm the balances at your earliest.</p>
        ${payload.custom_message ? `<p>${payload.custom_message}</p>` : ""}
        <p>Regards,<br><strong>${firmName}</strong></p>`);

    case "audit_report_ready":
      return wrapper(`
        <p>Dear ${payload.client_name || "Client"},</p>
        <p>Your audit report is ready for review.</p>
        ${payload.pdf_url ? `<p><a href="${payload.pdf_url}" style="background:#1a3a5c;color:#fff;padding:10px 20px;text-decoration:none;border-radius:4px;display:inline-block">Download Report</a></p>` : ""}
        ${payload.custom_message ? `<p>${payload.custom_message}</p>` : ""}
        <p>Regards,<br><strong>${firmName}</strong></p>`);

    case "new_user_welcome":
      return wrapper(`
        <h3>Welcome to CAFlow!</h3>
        <p>Your account has been set up successfully. Here are your login details:</p>
        <table class="info">
          <tr><td>Email</td><td>${payload.email || "N/A"}</td></tr>
          <tr><td>Temporary Password</td><td><code style="background:#f3f4f6;padding:4px 8px;border-radius:4px">${payload.password || "N/A"}</code></td></tr>
        </table>
        <p>Please change your password after your first login.</p>`);

    default:
      return wrapper(`
        <p>${payload.custom_message || "Please find the details below."}</p>
        ${payload.invoice_no ? `<p>Reference: ${payload.invoice_no}</p>` : ""}`);
  }
}

// ── Microsoft Graph API — get access token ───────────────────────────

async function getGraphToken(): Promise<string> {
  const tenantId     = Deno.env.get("GRAPH_TENANT_ID");
  const clientId     = Deno.env.get("GRAPH_CLIENT_ID");
  const clientSecret = Deno.env.get("GRAPH_CLIENT_SECRET");

  if (!tenantId || !clientId || !clientSecret) {
    throw new Error("Graph API credentials not configured (GRAPH_TENANT_ID / GRAPH_CLIENT_ID / GRAPH_CLIENT_SECRET)");
  }

  const res = await fetch(
    `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type:    "client_credentials",
        client_id:     clientId,
        client_secret: clientSecret,
        scope:         "https://graph.microsoft.com/.default",
      }),
    }
  );

  const data = await res.json();
  if (!res.ok) {
    throw new Error(
      `Graph token error: ${data.error} — ${data.error_description || JSON.stringify(data)}`
    );
  }
  return data.access_token as string;
}

// ── Microsoft Graph API — send email ────────────────────────────────

async function sendEmail(
  type: string,
  toEmail: string,
  payload: Record<string, any>,
  customSubject?: string,
  ccEmails?: string[],
): Promise<{ success: boolean; providerId?: string; error?: string }> {
  const fromEmail = Deno.env.get("SMTP_SENDER") || "accounts@vjdesai.com";
  const firmName  = payload.firm_name || "V J Desai & Co. LLP";
  const subject   = customSubject || subjects[type] || `Notification from ${firmName}`;
  const html      = buildEmailHTML(type, payload);

  try {
    const token = await getGraphToken();

    const ccRecipients = (ccEmails || [])
      .filter(e => e && e !== toEmail)
      .map(e => ({ emailAddress: { address: e } }));

    const res = await fetch(
      `https://graph.microsoft.com/v1.0/users/${fromEmail}/sendMail`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: {
            subject,
            body:         { contentType: "HTML", content: html },
            toRecipients: [{ emailAddress: { address: toEmail } }],
            ...(ccRecipients.length > 0 ? { ccRecipients } : {}),
            from:         { emailAddress: { name: firmName, address: fromEmail } },
            // Attach PDF when base64 data is supplied by the caller
            ...(payload.pdf_base64 ? {
              attachments: [{
                "@odata.type": "#microsoft.graph.fileAttachment",
                name:          payload.pdf_filename || "document.pdf",
                contentType:   "application/pdf",
                contentBytes:  payload.pdf_base64,
              }],
            } : {}),
          },
          saveToSentItems: true,
        }),
      }
    );

    if (res.status === 202) {
      console.log(`[Email] ✓ Sent to ${toEmail} | Subject: ${subject}`);
      return { success: true, providerId: `graph-${Date.now()}` };
    }

    const data = await res.json();
    const errMsg = data?.error?.message || JSON.stringify(data);
    console.error(`[Email] ✗ Failed to ${toEmail}: ${errMsg}`);
    return { success: false, error: errMsg };
  } catch (err: any) {
    console.error(`[Email] ✗ Exception: ${err.message}`);
    return { success: false, error: err.message };
  }
}

// ── WhatsApp sender ──────────────────────────────────────────────────

async function sendWhatsApp(
  type: string,
  phone: string,
  payload: Record<string, any>,
): Promise<{ success: boolean; providerId?: string; error?: string }> {
  const apiKey = Deno.env.get("WATI_API_KEY");
  if (!apiKey) return { success: false, error: "WATI_API_KEY not configured" };

  const template = templateMap[type];
  if (!template) return { success: false, error: `No WhatsApp template for: ${type}` };

  const parameters = Object.entries(payload).map(([k, v]) => ({ name: k, value: String(v) }));
  try {
    const res    = await fetch("https://live-mt-server.wati.io/api/v1/sendTemplateMessage", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        whatsappNumber: phone.replace(/[^0-9]/g, ""),
        template_name: template,
        broadcast_name: type,
        parameters,
      }),
    });
    const result = await res.json();
    if (!res.ok) return { success: false, error: result.message || JSON.stringify(result) };
    return { success: true, providerId: result.messageId || result.id || null };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

// ── Contact resolvers ────────────────────────────────────────────────

async function getClientContact(adminClient: any, clientId: string) {
  const { data } = await adminClient
    .from("clients").select("id, name, email, mobile").eq("id", clientId).single();
  if (!data) return null;
  return { id: data.id, name: data.name, email: data.email, phone: data.mobile };
}

async function getResponsiblePersonContact(adminClient: any, clientId: string) {
  const { data: client } = await adminClient
    .from("clients").select("responsible_person_id").eq("id", clientId).single();
  if (!client?.responsible_person_id) return null;
  const { data } = await adminClient
    .from("users").select("id, name, email, phone").eq("id", client.responsible_person_id).single();
  return data || null;
}

// ── Notification logger ──────────────────────────────────────────────

async function logNotification(
  adminClient: any,
  params: {
    firm_id: string; recipient_id: string | null; channel: string; type: string;
    content: Record<string, any>; status: string; provider_id: string | null;
  }
) {
  // "direct" and "direct_wa" are synthetic IDs — log with null recipient_id
  const recipient_id =
    !params.recipient_id ||
    params.recipient_id === "direct" ||
    params.recipient_id === "direct_wa"
      ? null
      : params.recipient_id;

  await adminClient.from("notification_log").insert({
    firm_id:      params.firm_id,
    recipient_id,
    channel:      params.channel,
    type:         params.type,
    content:      params.content,
    status:       params.status,
    provider_id:  params.provider_id,
    sent_at:      new Date().toISOString(),
  });
}

// ── Send to a single recipient ───────────────────────────────────────

async function sendToRecipient(
  adminClient: any,
  recipient: { id: string; name: string; email: string | null; phone: string | null },
  type: string,
  firm_id: string,
  payload: Record<string, any>,
  channels: ("whatsapp" | "email")[],
  customSubject?: string,
  ccEmails?: string[],
): Promise<Record<string, { status: string; error?: string; provider_id?: string }>> {
  const results: Record<string, { status: string; error?: string; provider_id?: string }> = {};

  for (const channel of channels) {
    if (channel === "email") {
      // custom_email in payload overrides recipient's DB email
      const toEmail = payload.custom_email || recipient.email;
      if (!toEmail) {
        results.email = { status: "failed", error: "No email address" };
        await logNotification(adminClient, {
          firm_id, recipient_id: recipient.id, channel: "email", type,
          content: { payload, error: "No email" }, status: "failed", provider_id: null,
        });
        continue;
      }

      const r = await sendEmail(
        type,
        toEmail,
        { ...payload, client_name: payload.client_name || recipient.name },
        customSubject || payload.custom_subject,
        ccEmails,
      );

      results.email = {
        status: r.success ? "sent" : "failed",
        ...(r.error      && { error:       r.error }),
        ...(r.providerId && { provider_id: r.providerId }),
      };
      const ccList = (ccEmails || []).filter(e => e && e !== toEmail);
      await logNotification(adminClient, {
        firm_id, recipient_id: recipient.id, channel: "email", type,
        content: {
          to: toEmail,
          subject: customSubject || payload.custom_subject || subjects[type],
          ...(ccList.length > 0 ? { cc: ccList.join(", ") } : {}),
          ...(payload.custom_message ? { body: payload.custom_message } : {}),
          ...(r.error ? { error: r.error } : {}),
        },
        status: r.success ? "sent" : "failed",
        provider_id: r.providerId || null,
      });
    }

    if (channel === "whatsapp") {
      const phone = recipient.phone;
      if (!phone) {
        results.whatsapp = { status: "failed", error: "No phone number" };
        await logNotification(adminClient, {
          firm_id, recipient_id: recipient.id, channel: "whatsapp", type,
          content: { payload, error: "No phone" }, status: "failed", provider_id: null,
        });
        continue;
      }
      const r = await sendWhatsApp(type, phone, payload);
      results.whatsapp = {
        status: r.success ? "sent" : "failed",
        ...(r.error      && { error:       r.error }),
        ...(r.providerId && { provider_id: r.providerId }),
      };
      await logNotification(adminClient, {
        firm_id, recipient_id: recipient.id, channel: "whatsapp", type,
        content: { payload, template: templateMap[type] },
        status: r.success ? "sent" : "failed",
        provider_id: r.providerId || null,
      });
    }
  }

  return results;
}

// ── Main handler ─────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST")    return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const {
      type,
      firm_id,
      client_id,
      send_to_client      = true,
      send_to_responsible = false,
      payload,
      recipient_id,
      direct_email,        // bypass client lookup — send to this address directly
      direct_whatsapp,     // Phase 4B — send WhatsApp to this number directly
      custom_cc,           // array of CC email addresses
    } = await req.json();

    if (!type || !firm_id)
      return jsonResponse({ error: "Missing required fields: type, firm_id" }, 400);
    if (!client_id && !recipient_id && !direct_email)
      return jsonResponse({ error: "Missing required field: client_id, recipient_id, or direct_email" }, 400);

    const channels = channelRules[type];
    if (!channels)
      return jsonResponse({ error: `Unknown notification type: ${type}` }, 400);

    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Enrich payload with firm name for email branding
    const { data: firmData } = await adminClient
      .from("firms").select("name").eq("id", firm_id).single();
    const enrichedPayload = {
      ...payload,
      firm_name: firmData?.name || "V J Desai & Co. LLP",
    };

    const allResults: Record<string, any> = {};

    if (client_id) {
      if (send_to_client) {
        // Use custom_email from payload if provided (Share dialog override)
        const contact = payload?.custom_email
          ? {
              id:    client_id,
              name:  payload.client_name || "Client",
              email: payload.custom_email,
              phone: null,
            }
          : await getClientContact(adminClient, client_id);

        if (contact) {
          allResults.client = await sendToRecipient(
            adminClient, contact, type, firm_id, enrichedPayload,
            channels, enrichedPayload.custom_subject, custom_cc,
          );
        } else {
          allResults.client = { error: "Client contact not found" };
        }
      }

      if (send_to_responsible) {
        const rpContact = await getResponsiblePersonContact(adminClient, client_id);
        if (rpContact) {
          allResults.responsible = await sendToRecipient(
            adminClient, rpContact, type, firm_id, enrichedPayload, ["whatsapp"],
          );
        } else {
          allResults.responsible = { error: "Responsible person not found" };
        }
      }
    } else if (recipient_id) {
      const { data: userData } = await adminClient
        .from("users").select("id, name, email, phone").eq("id", recipient_id).single();
      if (!userData)
        return jsonResponse({ error: `Recipient not found: ${recipient_id}` }, 404);
      allResults.recipient = await sendToRecipient(
        adminClient, userData, type, firm_id, enrichedPayload, channels,
      );
    }

    // Direct email — no client or user lookup, just send straight to the supplied address
    if (direct_email) {
      const directContact = {
        id:    "direct",
        name:  enrichedPayload.client_name || "Recipient",
        email: direct_email as string,
        phone: null,
      };
      allResults.direct = await sendToRecipient(
        adminClient, directContact, type, firm_id, enrichedPayload, ["email"],
        enrichedPayload.custom_subject, custom_cc,
      );
    }

    // Phase 4B: Direct WhatsApp — send to explicit phone number (no client lookup)
    if (direct_whatsapp) {
      const waContact = {
        id:    "direct_wa",
        name:  enrichedPayload.client_name || "Recipient",
        email: null,
        phone: (direct_whatsapp as string).replace(/[^0-9+]/g, ""),
      };
      allResults.direct_whatsapp = await sendToRecipient(
        adminClient, waContact, type, firm_id, enrichedPayload, ["whatsapp"],
      );
    }

    return jsonResponse({ success: true, results: allResults });
  } catch (err: any) {
    console.error("send-notification error:", err);
    return jsonResponse({ error: err.message || "Internal server error" }, 500);
  }
});
