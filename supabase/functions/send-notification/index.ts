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
import {
  HEAD_FIRM_NAME, HEAD_FIRM_NAME_PATTERN, brandedShell, ensureLogoHeader, isBillingEmailType,
} from "../_shared/emailBrand.ts";

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
  ledger_statement:          "Statement of Account",
  payment_reminder:          "Payment Reminder",
  internal_filing_reminder:  "Filing Reminder",
  // Audit communication templates
  audit_commencement:        "Commencement of Statutory Audit",
  audit_document_request:    "Document Request — Audit",
  audit_query_dispatch:      "Audit Queries — Action Required",
  audit_query_reminder:      "Reminder: Pending Audit Queries",
  audit_draft_report:        "Draft Audit Report for Review",
  audit_final_report:        "Audit Report Finalized",
  // Client portal activity digest (smart-batched to info@vjdesai.com)
  portal_client_activity:    "Client Portal Activity Digest",
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
  // Client portal activity digest — handled specially in main handler
  portal_client_activity:    ["email"],
};

// ── Helpers ──────────────────────────────────────────────────────────

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Escape a value for safe interpolation into HTML markup (text or attribute
// context). Applied to every data value — client names, reply/query text,
// custom messages, etc. — that gets interpolated into the outbound email
// templates below. Some of that data (e.g. client-portal reply_text /
// query_text) originates from an external, low-trust client-portal user with
// no sanitization on the way in, and the composed HTML is both emailed via
// Microsoft Graph and persisted to notification_log for later rendering by
// firm staff (src/components/billing/EmailLogTab.tsx) — so unescaped values
// here are a stored-XSS vector. This only escapes data values; it must never
// be applied to the function's own structural HTML/tags.
function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ── Invoice lines table (billing reminders / statement of account) ──
// Built here from structured payload.invoice_lines (never caller HTML), so
// every value is escaped.
function fmtInr(n: unknown): string {
  return `₹${Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function buildInvoiceLinesTable(payload: Record<string, any>): string {
  const lines = Array.isArray(payload.invoice_lines) ? payload.invoice_lines : [];
  if (lines.length === 0) return "";
  const th = "padding:6px 8px;border-bottom:2px solid #e5e7eb;text-align:left;font-size:12px;color:#6b7280";
  const td = "padding:6px 8px;border-bottom:1px solid #f3f4f6;font-size:13px";
  const rows = lines.map((l: any) => `<tr>
      <td style="${td}">${escapeHtml(l.invoice_no || "")}</td>
      <td style="${td}">${escapeHtml(l.invoice_date || "")}</td>
      <td style="${td}">${escapeHtml(l.due_date || "")}</td>
      <td style="${td};text-align:right">${fmtInr(l.outstanding)}</td>
    </tr>`).join("");
  const total = lines.reduce((s: number, l: any) => s + Number(l.outstanding || 0), 0);
  return `<table style="width:100%;border-collapse:collapse;margin:16px 0">
    <tr><th style="${th}">Invoice No.</th><th style="${th}">Date</th><th style="${th}">Due Date</th><th style="${th};text-align:right">Outstanding</th></tr>
    ${rows}
    <tr><td colspan="3" style="${td};font-weight:600">Total outstanding</td><td style="${td};text-align:right;font-weight:600;color:#dc2626">${fmtInr(total)}</td></tr>
  </table>`;
}

// ── Email HTML builder ───────────────────────────────────────────────

function buildEmailHTML(type: string, payload: Record<string, any>): string {
  const firmName = escapeHtml(payload.firm_name || "V J Desai & Co. LLP, Chartered Accountants");
  const amt = payload.amount
    ? `₹${Number(payload.amount).toLocaleString("en-IN")}`
    : "N/A";
  const clientName    = escapeHtml(payload.client_name || "Client");
  const customMessage = payload.custom_message ? escapeHtml(payload.custom_message) : "";
  const invoiceNo     = escapeHtml(payload.invoice_no || "N/A");
  const dueDate       = escapeHtml(payload.due_date || "");
  const documentType  = escapeHtml(payload.document_type || "");
  const section       = escapeHtml(payload.section || "N/A");
  const portalUrl     = payload.portal_url ? escapeHtml(payload.portal_url) : "";
  const pdfUrl        = payload.pdf_url ? escapeHtml(payload.pdf_url) : "";
  const email         = escapeHtml(payload.email || "N/A");
  const password      = escapeHtml(payload.password || "N/A");

  // Billing emails always carry the head firm's logo and professional layout.
  const wrapper = (body: string) => isBillingEmailType(type) ? brandedShell(body) : `<!DOCTYPE html>
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
      For queries, contact us at <a href="mailto:audit@vjdesai.com">audit@vjdesai.com</a>
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
        <p>Dear ${clientName},</p>
        <p>${customMessage || "Please find the audit communication details below."}</p>
        ${portalUrl ? `
        <p style="margin:16px 0;">
          <a href="${portalUrl}"
             style="background:#c8960c;color:#fff;padding:10px 22px;border-radius:6px;text-decoration:none;font-weight:600;display:inline-block;">
            View in Client Portal →
          </a>
        </p>` : ""}
        <p>Regards,<br><strong>${firmName}</strong><br><em>Chartered Accountants</em></p>
      `);

    case "invoice_generated":
      return wrapper(`
        <p>Dear ${clientName},</p>
        <p>Please find below the details of your invoice:</p>
        <table class="info">
          <tr><td>Invoice No.</td><td>${invoiceNo}</td></tr>
          <tr><td>Amount</td><td>${amt}</td></tr>
          ${dueDate ? `<tr><td>Due Date</td><td>${dueDate}</td></tr>` : ""}
          ${documentType ? `<tr><td>Type</td><td>${documentType}</td></tr>` : ""}
        </table>
        ${customMessage ? `<p style="margin-top:12px">${customMessage}</p>` : ""}
        <p>Kindly arrange payment at the earliest convenience.</p>
        <p>Thank you for your continued trust in our services.</p>
        <p>Regards,<br><strong>${firmName}</strong></p>`);

    case "quotation_sent":
      return wrapper(`
        <p>Dear ${clientName},</p>
        <p>Please find our quotation for your reference:</p>
        <table class="info">
          <tr><td>Document No.</td><td>${invoiceNo}</td></tr>
          <tr><td>Amount</td><td>${amt}</td></tr>
        </table>
        ${customMessage ? `<p>${customMessage}</p>` : ""}
        <p>Please review and revert with your confirmation.</p>
        <p>Regards,<br><strong>${firmName}</strong></p>`);

    case "proforma_sent":
      return wrapper(`
        <p>Dear ${clientName},</p>
        <p>Please find the proforma invoice below:</p>
        <table class="info">
          <tr><td>Document No.</td><td>${invoiceNo}</td></tr>
          <tr><td>Amount</td><td>${amt}</td></tr>
        </table>
        ${customMessage ? `<p>${customMessage}</p>` : ""}
        <p>Regards,<br><strong>${firmName}</strong></p>`);

    case "credit_note_issued":
      return wrapper(`
        <p>Dear ${clientName},</p>
        <p>A credit note has been issued against your account:</p>
        <table class="info">
          <tr><td>Credit Note No.</td><td>${invoiceNo}</td></tr>
          <tr><td>Amount</td><td>${amt}</td></tr>
        </table>
        ${customMessage ? `<p>${customMessage}</p>` : ""}
        <p>Regards,<br><strong>${firmName}</strong></p>`);

    case "payment_reminder":
      return wrapper(`
        <p>Dear ${clientName},</p>
        <p>This is a friendly reminder for the outstanding payment:</p>
        ${buildInvoiceLinesTable(payload) || `<table class="info">
          <tr><td>Invoice No.</td><td>${invoiceNo}</td></tr>
          ${dueDate ? `<tr><td>Due Date</td><td>${dueDate}</td></tr>` : ""}
          <tr><td>Outstanding Amount</td><td style="color:#dc2626">${amt}</td></tr>
        </table>`}
        <p>Please process the payment at your earliest convenience to avoid any inconvenience.
        If you have already paid, kindly ignore this reminder and share the payment details with us.</p>
        <p>Regards,<br><strong>${firmName}</strong></p>`);

    case "tds_due_7_days":
      return wrapper(`
        <p>Dear Team,</p>
        <p>TDS filing for <strong>${escapeHtml(payload.client_name || "N/A")}</strong> is due in <strong>7 days</strong>.</p>
        <table class="info">
          <tr><td>Section</td><td>${section}</td></tr>
          <tr><td>Amount</td><td>${amt}</td></tr>
        </table>
        <p>Please ensure timely filing to avoid penalties.</p>`);

    case "tds_due_1_day":
      return wrapper(`
        <p style="color:#dc2626;font-weight:bold;font-size:16px">⚠ URGENT: TDS Due Tomorrow</p>
        <p>TDS filing for <strong>${escapeHtml(payload.client_name || "N/A")}</strong> is due <strong>tomorrow</strong>.</p>
        <table class="info">
          <tr><td>Section</td><td>${section}</td></tr>
          <tr><td>Amount</td><td style="color:#dc2626">${amt}</td></tr>
        </table>
        <p style="color:#dc2626">Immediate action required to avoid penalties.</p>`);

    case "ledger_statement":
      return wrapper(`
        <p>Dear ${clientName},</p>
        ${payload.invoice_lines
          ? `<p>Please find below your statement of account (invoices outstanding) as on ${escapeHtml(payload.statement_date || "")}. Kindly review and arrange payment, or let us know if any of these have already been settled.</p>
             ${buildInvoiceLinesTable(payload)}`
          : `<p>Please find your statement of account for your review. Kindly confirm the balances at your earliest.</p>`}
        ${customMessage ? `<p>${customMessage}</p>` : ""}
        <p>Regards,<br><strong>${firmName}</strong></p>`);

    case "audit_report_ready":
      return wrapper(`
        <p>Dear ${clientName},</p>
        <p>Your audit report is ready for review.</p>
        ${pdfUrl ? `<p><a href="${pdfUrl}" style="background:#1a3a5c;color:#fff;padding:10px 20px;text-decoration:none;border-radius:4px;display:inline-block">Download Report</a></p>` : ""}
        ${customMessage ? `<p>${customMessage}</p>` : ""}
        <p>Regards,<br><strong>${firmName}</strong></p>`);

    case "new_user_welcome":
      return wrapper(`
        <h3>Welcome to CAFlow!</h3>
        <p>Your account has been set up successfully. Here are your login details:</p>
        <table class="info">
          <tr><td>Email</td><td>${email}</td></tr>
          <tr><td>Temporary Password</td><td><code style="background:#f3f4f6;padding:4px 8px;border-radius:4px">${password}</code></td></tr>
        </table>
        <p>Please change your password after your first login.</p>`);

    default:
      return wrapper(`
        <p>${customMessage || "Please find the details below."}</p>
        ${invoiceNo !== "N/A" ? `<p>Reference: ${invoiceNo}</p>` : ""}`);
  }
}

// ── Portal activity digest HTML builder ─────────────────────────────

function buildPortalDigestHtml(activities: any[], firmName: string): string {
  const cards = activities.map((a: any) => {
    const time = new Date(a.created_at).toLocaleString("en-IN", {
      day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
    });
    const icon     = a.activity === "document_upload" ? "📎" : "💬";
    const actLabel = a.activity === "document_upload" ? "Uploaded a document" : "Replied to a query";
    const meta     = (typeof a.metadata === "object" && a.metadata) ? a.metadata : {};

    // NOTE: query_text / reply_text / attachment_name / filename / details all
    // ultimately trace back to an external, low-trust client-portal user (see
    // src/pages/PortalQueries.tsx sendReply()) with no sanitization on the way
    // in — escape every one of them before interpolating into this HTML.
    const clientNameEsc  = escapeHtml(a.client_name || "Client");
    const detailsEsc     = a.details ? escapeHtml(a.details) : "";
    const queryRefEsc    = meta.query_ref ? escapeHtml(meta.query_ref) : "";
    const queryTextEsc   = meta.query_text ? escapeHtml(meta.query_text) : "";
    const replyTextEsc   = meta.reply_text ? escapeHtml(meta.reply_text) : "";
    const attachNameEsc  = meta.attachment_name ? escapeHtml(meta.attachment_name) : "";
    const filenameEsc    = meta.filename ? escapeHtml(meta.filename) : "";
    const subCategoryEsc = meta.sub_category ? escapeHtml(meta.sub_category) : "";

    let detailBlock = "";

    if (a.activity === "query_reply") {
      detailBlock = `
        ${queryRefEsc ? `<p style="margin:0 0 8px;font-size:12px;color:#6b7280"><strong>Query Ref:</strong> ${queryRefEsc}</p>` : ""}
        ${queryTextEsc ? `
        <div style="background:#f9fafb;border-left:3px solid #d97706;padding:10px 14px;margin:0 0 10px;border-radius:0 4px 4px 0">
          <p style="margin:0 0 4px;font-size:10px;color:#9ca3af;font-weight:700;text-transform:uppercase;letter-spacing:.5px">Original Query</p>
          <p style="margin:0;font-size:13px;color:#374151;line-height:1.5">${queryTextEsc}</p>
        </div>` : ""}
        ${replyTextEsc ? `
        <div style="background:#fffbf0;border-left:3px solid #f59e0b;padding:10px 14px;margin:0 0 10px;border-radius:0 4px 4px 0">
          <p style="margin:0 0 4px;font-size:10px;color:#9ca3af;font-weight:700;text-transform:uppercase;letter-spacing:.5px">Client's Reply</p>
          <p style="margin:0;font-size:13px;color:#374151;line-height:1.5;white-space:pre-line">${replyTextEsc}</p>
        </div>` : (detailsEsc ? `<p style="margin:0 0 8px;font-size:13px;color:#374151">${detailsEsc}</p>` : "")}
        ${attachNameEsc ? `
        <p style="margin:0;font-size:12px;color:#374151">
          📎 <strong>Attached File:</strong>
          <span style="color:#1a3a5c;font-style:italic">${attachNameEsc}</span>
        </p>` : ""}
      `;
    } else if (a.activity === "document_upload") {
      detailBlock = `
        <div style="background:#eff6ff;border-left:3px solid #3b82f6;padding:10px 14px;border-radius:0 4px 4px 0">
          <p style="margin:0 0 4px;font-size:10px;color:#9ca3af;font-weight:700;text-transform:uppercase;letter-spacing:.5px">Document Uploaded</p>
          <p style="margin:0;font-size:13px;color:#374151;font-weight:600">
            📄 ${filenameEsc || detailsEsc || "—"}
          </p>
          ${subCategoryEsc ? `<p style="margin:4px 0 0;font-size:11px;color:#6b7280">Category: <strong>${subCategoryEsc}</strong></p>` : ""}
        </div>
      `;
    } else {
      detailBlock = detailsEsc
        ? `<p style="margin:0;font-size:13px;color:#374151">${detailsEsc}</p>`
        : "";
    }

    return `
    <div style="border:1px solid #e5e7eb;border-radius:8px;margin:0 0 16px;overflow:hidden">
      <div style="background:#f9fafb;padding:10px 14px;border-bottom:1px solid #e5e7eb;display:flex;justify-content:space-between;align-items:center">
        <div style="font-size:13px;font-weight:600;color:#1a3a5c">
          ${icon} ${clientNameEsc}
          <span style="color:#9ca3af;font-weight:400;margin-left:6px">— ${actLabel}</span>
        </div>
        <div style="font-size:11px;color:#9ca3af;white-space:nowrap;margin-left:12px">${time}</div>
      </div>
      <div style="padding:12px 14px">${detailBlock}</div>
    </div>`;
  }).join("");

  const firmNameEsc = escapeHtml(firmName);

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="font-family:Arial,sans-serif;max-width:700px;margin:0 auto;padding:0;color:#333">
<div style="background:#1a3a5c;color:#fff;padding:18px 24px">
  <h2 style="margin:0;font-size:18px;font-weight:600">${firmNameEsc}</h2>
  <p style="margin:4px 0 0;font-size:12px;opacity:.8">Client Portal — Activity Digest</p>
</div>
<div style="border:1px solid #e5e7eb;border-top:none;padding:24px">
  <p style="margin:0 0 20px;font-size:14px;color:#374151">
    The following client portal activities require your attention:
  </p>
  ${cards}
  <p style="margin:8px 0 0;font-size:13px;color:#6b7280">
    Please log in to <strong>CAFlow</strong> to review and respond to your clients.
  </p>
</div>
<div style="padding:12px 24px">
  <div style="font-size:11px;color:#9ca3af;border-top:1px solid #f3f4f6;padding-top:12px">
    Automated digest from CAFlow Client Portal · sent at most once every 4 hours per firm.<br>
    &copy; ${new Date().getFullYear()} V J Desai &amp; Co. LLP, Chartered Accountants
  </div>
</div>
</body></html>`;
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

// ── Email template engine ────────────────────────────────────────────────
// Prefer a firm's ACTIVE saved email_templates row for this notification type,
// substituting {{variables}}. Returns null (→ hardcoded buildEmailHTML) when no
// active template exists, so behaviour is unchanged until a firm designs and
// activates a template.
async function renderFromTemplate(
  firmId: string, type: string, payload: Record<string, any>,
): Promise<{ subject: string; html: string } | null> {
  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data } = await admin.from("email_templates")
      .select("subject, body_html")
      .eq("firm_id", firmId).eq("type", type).eq("is_active", true)
      .order("updated_at", { ascending: false }).limit(1).maybeSingle();
    if (!data || !data.body_html) return null;
    const fmtAmount = payload.amount != null && payload.amount !== ""
      ? `₹${Number(payload.amount).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      : "";
    const vars: Record<string, string> = {
      client_name:    payload.client_name || "Client",
      firm_name:      payload.firm_name || "",
      invoice_no:     payload.invoice_no || "",
      amount:         fmtAmount,
      due_date:       payload.due_date || "",
      document_type:  payload.document_type || "",
      custom_message: payload.custom_message || "",
      // Billing reminders / statement of account
      invoice_table:  buildInvoiceLinesTable(payload),
      days_overdue:   payload.days_overdue != null ? String(payload.days_overdue) : "",
      statement_date: payload.statement_date || "",
    };
    const subst = (s: string) =>
      (s || "").replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, k) => (k in vars ? vars[k] : ""));
    return { subject: subst(data.subject), html: subst(data.body_html) };
  } catch {
    return null;
  }
}

async function sendEmail(
  type: string,
  toEmail: string,
  payload: Record<string, any>,
  customSubject?: string,
  ccEmails?: string[],
): Promise<{ success: boolean; providerId?: string; error?: string }> {
  const defaultFrom = Deno.env.get("SMTP_SENDER") || "accounts@vjdesai.com";
  // Per-firm mailbox (firms.settings.sender_email, set server-side in the main
  // handler — never taken from the caller). Must be a mailbox in the same
  // Microsoft 365 tenant; if Graph rejects it we retry once from the default.
  const fromEmail = payload.firm_sender_email || defaultFrom;
  const firmName  = payload.firm_name || "V J Desai & Co. LLP";
  let subject     = customSubject || subjects[type] || `Notification from ${firmName}`;
  // The static map names one firm; use the sending firm's own name.
  if (!customSubject && type === "invoice_generated") subject = `Invoice from ${firmName}`;
  let html        = buildEmailHTML(type, payload);

  // Use the firm's active saved template when present (skip for custom_html relays).
  // Billing emails use the head firm's templates, whichever firm is selected.
  const templateFirmId = isBillingEmailType(type) ? (payload.template_firm_id || payload.firm_id) : payload.firm_id;
  if (templateFirmId && !payload.custom_html) {
    const tpl = await renderFromTemplate(templateFirmId, type, payload);
    if (tpl) {
      html = isBillingEmailType(type) ? ensureLogoHeader(tpl.html) : tpl.html;
      if (!customSubject && tpl.subject) subject = tpl.subject;
    }
  }

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
            // "a@x.com, b@y.com" → several To recipients (reminder To overrides).
            toRecipients: toEmail.split(/[,;]/).map(e => e.trim()).filter(Boolean)
              .map(e => ({ emailAddress: { address: e } })),
            ...(ccRecipients.length > 0 ? { ccRecipients } : {}),
            from:         { emailAddress: { name: firmName, address: fromEmail } },
            // Deliverability (Issue 3 — reduce spam classification): a valid
            // Reply-To to a real, monitored firm mailbox makes the message look
            // like genuine 1:1 correspondence rather than bulk mail, and lets
            // clients reply directly. (The decisive spam fix is DNS — SPF, DKIM
            // and DMARC for the sending domain in Microsoft 365.)
            replyTo: [{ emailAddress: { address: payload.reply_to || payload.firm_reply_to || fromEmail, name: firmName } }],
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
    console.error(`[Email] ✗ Failed to ${toEmail} from ${fromEmail}: ${errMsg}`);
    if (fromEmail !== defaultFrom) {
      console.warn(`[Email] retrying from default sender ${defaultFrom}`);
      return sendEmail(type, toEmail, { ...payload, firm_sender_email: undefined }, customSubject, ccEmails);
    }
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
    client_id?: string | null; client_group_id?: string | null;
  }
) {
  // "direct" and "direct_wa" are synthetic IDs — log with null recipient_id
  const recipient_id =
    !params.recipient_id ||
    params.recipient_id === "direct" ||
    params.recipient_id === "direct_wa"
      ? null
      : params.recipient_id;

  const row = {
    firm_id:      params.firm_id,
    recipient_id,
    channel:      params.channel,
    type:         params.type,
    content:      params.content,
    status:       params.status,
    provider_id:  params.provider_id,
    sent_at:      new Date().toISOString(),
  };
  // Lets the Billing email log filter by client / group, whatever path the send took.
  const { error } = await adminClient.from("notification_log").insert({
    ...row,
    client_id:       params.client_id || null,
    client_group_id: params.client_group_id || null,
  });
  // A stale / unknown client or group id must never cost us the log row itself.
  if (error) await adminClient.from("notification_log").insert(row);
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
  logLink: { client_id?: string | null; client_group_id?: string | null } = {},
): Promise<Record<string, { status: string; error?: string; provider_id?: string }>> {
  const results: Record<string, { status: string; error?: string; provider_id?: string }> = {};

  for (const channel of channels) {
    if (channel === "email") {
      // custom_email in payload overrides recipient's DB email
      const toEmail = payload.custom_email || recipient.email;
      if (!toEmail) {
        results.email = { status: "failed", error: "No email address" };
        await logNotification(adminClient, {
          ...logLink, firm_id, recipient_id: recipient.id, channel: "email", type,
          content: { payload, error: "No email" }, status: "failed", provider_id: null,
        });
        continue;
      }

      const r = await sendEmail(
        type,
        toEmail,
        { ...payload, firm_id, client_name: payload.client_name || recipient.name },
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
        ...logLink, firm_id, recipient_id: recipient.id, channel: "email", type,
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
          ...logLink, firm_id, recipient_id: recipient.id, channel: "whatsapp", type,
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
        ...logLink, firm_id, recipient_id: recipient.id, channel: "whatsapp", type,
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
      send_to_client: sendToClientArg,
      send_to_responsible = false,
      payload,
      recipient_id,
      direct_email,        // bypass client lookup — send to this address directly
      direct_whatsapp,     // Phase 4B — send WhatsApp to this number directly
      custom_cc,           // array of CC email addresses
      client_group_id,     // group statements — recorded on the log row only
    } = await req.json();

    // With direct_email, client_id only tags the log row: also sending to the
    // client's own address would email the same person twice.
    const send_to_client = sendToClientArg ?? !direct_email;

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

    // ── Authorization (Phase 0 / C7) ─────────────────────────────────────
    // The platform now enforces verify_jwt=true, but the project anon key is
    // itself a valid JWT, so that alone does not stop an anonymous relay.
    // We therefore (a) require either the service-role key or a real signed-in
    // USER, and (b) restrict the phishing-capable params (direct_email /
    // custom_html / custom_cc) to firm staff or the superadmin of the target
    // firm. Typed notifications stay open to any signed-in user (e.g. client
    // portal flows), preserving existing behaviour.
    {
      const authHeader = req.headers.get("Authorization") || "";
      const bearer = authHeader.replace(/^Bearer\s+/i, "").trim();
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
      const isServiceCall = bearer.length > 0 && bearer === serviceKey;

      if (!isServiceCall) {
        if (!bearer) return jsonResponse({ error: "Unauthorized" }, 401);
        const { data: userData, error: authErr } = await adminClient.auth.getUser(bearer);
        if (authErr || !userData?.user) return jsonResponse({ error: "Unauthorized" }, 401);

        const usesSensitiveParams =
          !!direct_email ||
          !!(payload && (payload as Record<string, unknown>).custom_html) ||
          (Array.isArray(custom_cc) && custom_cc.length > 0);

        if (usesSensitiveParams) {
          const { data: caller } = await adminClient
            .from("users").select("firm_id, role").eq("id", userData.user.id).maybeSingle();
          const isSuperadmin = caller?.role === "superadmin";
          const isHomeFirm = caller?.firm_id === firm_id;
          // REGRESSION FIX (multi-firm): also honour explicit cross-firm access
          // grants (user_firm_access). The firm switcher lets a user pick any
          // firm they have a grant for, so the guard must accept those too —
          // otherwise emailing a ledger/invoice for K Desai / Dixita Desai from a
          // V J Desai login was wrongly 403'd. Arbitrary cross-firm calls (no
          // grant, not superadmin) are still blocked.
          let hasGrant = false;
          if (!isSuperadmin && !isHomeFirm && firm_id) {
            const { data: grant } = await adminClient
              .from("user_firm_access")
              .select("firm_id")
              .eq("user_id", userData.user.id)
              .eq("firm_id", firm_id)
              .maybeSingle();
            hasGrant = !!grant;
          }
          if (!isSuperadmin && !isHomeFirm && !hasGrant) {
            return jsonResponse({ error: "Forbidden: not authorized for this firm" }, 403);
          }
        }
      }
    }

    // Enrich payload with firm name for email branding
    const { data: firmData } = await adminClient
      .from("firms").select("name, settings").eq("id", firm_id).single();
    const firmSettings = (firmData?.settings || {}) as Record<string, any>;
    const validEmail = (v: unknown) => typeof v === "string" && v.includes("@") ? v.trim() : null;
    const firmSender  = validEmail(firmSettings.sender_email);
    const firmReplyTo = validEmail(firmSettings.reply_to_email);
    // A caller must never choose the sending mailbox — drop any supplied value.
    const { firm_sender_email: _ignored, firm_reply_to: _ignored2, template_firm_id: _ignored3, ...callerPayload } = (payload || {}) as Record<string, any>;
    // Billing emails are always sent as the head firm (V J Desai & Co. LLP) from the
    // default mailbox, regardless of which firm the user selected. The log row still
    // records the selected firm so the Email Log filters keep working.
    const asHeadFirm = isBillingEmailType(type);
    let headFirmId: string | null = null;
    if (asHeadFirm) {
      const { data: head } = await adminClient.from("firms").select("id")
        .ilike("name", HEAD_FIRM_NAME_PATTERN).limit(1).maybeSingle();
      headFirmId = head?.id ?? null;
    }
    const enrichedPayload: Record<string, any> = {
      ...callerPayload,
      firm_name: asHeadFirm ? HEAD_FIRM_NAME : (firmData?.name || "V J Desai & Co. LLP"),
      ...(asHeadFirm && headFirmId ? { template_firm_id: headFirmId } : {}),
      ...(!asHeadFirm && firmSender  ? { firm_sender_email: firmSender } : {}),
      ...(!asHeadFirm && firmReplyTo ? { firm_reply_to: firmReplyTo }    : {}),
    };

    // ── Smart-batched portal activity digest ─────────────────────────────
    if (type === "portal_client_activity") {
      // Log this activity (ignore failures so the portal interaction still succeeds)
      try {
        await adminClient.from("portal_activity_log").insert({
          firm_id,
          client_id:   client_id || null,
          client_name: payload.client_name   || "Unknown Client",
          activity:    payload.activity_type || "activity",
          details:     payload.details       || null,
          metadata: {
            query_ref:       payload.query_ref       || null,
            query_text:      payload.query_text      || null,
            reply_text:      payload.reply_text      || null,
            attachment_name: payload.attachment_name || null,
            filename:        payload.filename        || null,
            sub_category:    payload.sub_category    || null,
          },
        });
      } catch (_) { /* non-fatal */ }

      // Find when the last digest was sent for this firm
      const { data: lastRow } = await adminClient
        .from("portal_activity_log")
        .select("created_at")
        .eq("firm_id", firm_id)
        .eq("notified", true)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const lastSentAt   = lastRow?.created_at ? new Date(lastRow.created_at) : null;
      const fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1000);

      if (lastSentAt && lastSentAt > fourHoursAgo) {
        // A digest was already sent within 4 hours — just accumulate, skip email
        return jsonResponse({ success: true, batched: true, message: "Activity logged; digest pending" });
      }

      // Fetch all unnotified activities for this firm
      const { data: pending } = await adminClient
        .from("portal_activity_log")
        .select("*")
        .eq("firm_id", firm_id)
        .eq("notified", false)
        .order("created_at", { ascending: true });

      if (!pending || pending.length === 0) {
        return jsonResponse({ success: true, batched: true });
      }

      const digestHtml = buildPortalDigestHtml(pending, enrichedPayload.firm_name || "V J Desai & Co. LLP");
      const subject    = `Client Portal Activity — ${pending.length} update${pending.length !== 1 ? "s" : ""} (${enrichedPayload.firm_name || "CAFlow"})`;

      const emailResult = await sendEmail(
        "portal_client_activity",
        "info@vjdesai.com",
        { ...enrichedPayload, custom_html: digestHtml },
        subject,
      );

      if (emailResult.success) {
        const ids = (pending as any[]).map((r) => r.id);
        await adminClient.from("portal_activity_log").update({ notified: true }).in("id", ids);
      }

      return jsonResponse({ success: true, digest_sent: emailResult.success, count: pending.length });
    }

    const allResults: Record<string, any> = {};
    const logLink = { client_id: client_id || null, client_group_id: client_group_id || null };

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
            channels, enrichedPayload.custom_subject, custom_cc, logLink,
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
            undefined, undefined, logLink,
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
        enrichedPayload.custom_subject, custom_cc, logLink,
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
        undefined, undefined, logLink,
      );
    }

    return jsonResponse({ success: true, results: allResults });
  } catch (err: any) {
    console.error("send-notification error:", err);
    return jsonResponse({ error: err.message || "Internal server error" }, 500);
  }
});
