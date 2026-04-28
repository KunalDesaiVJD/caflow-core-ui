/**
 * EmailTemplateEngine
 *
 * Builds complete branded HTML emails for audit communications.
 * The HTML is sent verbatim to the send-notification edge function
 * via `payload.custom_html` (no re-wrapping by the edge function).
 *
 * 6 templates:
 *   audit_commencement     — Audit start letter
 *   audit_document_request — Request for specific documents
 *   audit_query_dispatch   — Send queries with portal link
 *   audit_query_reminder   — Reminder for pending queries
 *   audit_draft_report     — Draft report ready for review
 *   audit_final_report     — Final report issued
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type AuditEmailType =
  | "audit_commencement"
  | "audit_document_request"
  | "audit_query_dispatch"
  | "audit_query_reminder"
  | "audit_draft_report"
  | "audit_final_report";

export const AUDIT_EMAIL_LABELS: Record<AuditEmailType, string> = {
  audit_commencement:     "Audit Commencement Letter",
  audit_document_request: "Document Request",
  audit_query_dispatch:   "Query Dispatch",
  audit_query_reminder:   "Query Reminder",
  audit_draft_report:     "Draft Report Review",
  audit_final_report:     "Final Report",
};

export const AUDIT_EMAIL_SUBJECTS: Record<AuditEmailType, string> = {
  audit_commencement:     "Commencement of Statutory Audit — FY {FY}",
  audit_document_request: "Document Request — Audit FY {FY}",
  audit_query_dispatch:   "Audit Queries — Action Required (FY {FY})",
  audit_query_reminder:   "Reminder: Pending Audit Queries (FY {FY})",
  audit_draft_report:     "Draft Audit Report for Your Review — FY {FY}",
  audit_final_report:     "Audit Report Finalized — FY {FY}",
};

export interface AuditQueryRow {
  ref_number?:         string | null;
  query_text:          string;
  required_documents?: string | null;
  group_name?:         string | null;
  ledger_name?:        string | null;
}

export interface AuditEmailInput {
  clientName:     string;
  firmName:       string;
  financialYear?: string;
  portalUrl?:     string;
  queries?:       AuditQueryRow[];
  customMessage?: string;
  deadlineDate?:  string;
  signatoryName?: string;
}

// ─── HTML Email Builder ───────────────────────────────────────────────────────

/**
 * Builds a complete standalone HTML email (including DOCTYPE, head, body wrapper).
 * This is sent verbatim to the edge function as `payload.custom_html`.
 */
export function buildAuditEmailHtml(type: AuditEmailType, input: AuditEmailInput): string {
  const {
    clientName, firmName, financialYear, portalUrl,
    queries = [], customMessage, deadlineDate, signatoryName,
  } = input;

  const fy       = financialYear ? ` for FY ${financialYear}` : "";
  const deadline = deadlineDate
    ? `by <strong>${new Date(deadlineDate).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}</strong>`
    : "at the earliest";

  // ── Branded HTML wrapper ─────────────────────────────────────────────
  const wrapper = (body: string) => `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
  body{font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:0;color:#333;font-size:14px;line-height:1.6}
  .hdr{background:#1a3a5c;color:#fff;padding:18px 24px}
  .hdr h2{margin:0;font-size:18px;font-weight:600}
  .hdr p{margin:4px 0 0;font-size:12px;opacity:.8}
  .bdy{border:1px solid #e5e7eb;border-top:none;padding:24px}
  .bdy p{margin:0 0 12px}
  table.qt{width:100%;border-collapse:collapse;margin:16px 0;font-size:13px}
  table.qt th{padding:8px 10px;background:#f3f4f6;border:1px solid #e5e7eb;text-align:left;font-weight:600;color:#374151}
  table.qt td{padding:8px 10px;border:1px solid #e5e7eb;vertical-align:top}
  table.qt tr:nth-child(even) td{background:#fafafa}
  .portal-btn{display:inline-block;background:#1a3a5c;color:#fff;padding:10px 22px;text-decoration:none;border-radius:4px;margin:8px 0;font-size:14px;font-weight:500}
  .note{margin:12px 0;padding:12px 14px;background:#f9fafb;border-left:3px solid #1a3a5c;font-style:italic;color:#4b5563}
  .ftr{padding:12px 24px;font-size:11px;color:#9ca3af;border-top:1px solid #f3f4f6}
</style></head>
<body>
  <div class="hdr">
    <h2>${firmName}</h2>
    <p>Chartered Accountants</p>
  </div>
  <div class="bdy">${body}</div>
  <div class="ftr">
    This is an automated message from CAFlow Practice Management. Please do not reply to this email directly.<br>
    For queries, contact us at <a href="mailto:accounts@vjdesai.com" style="color:#1a3a5c">accounts@vjdesai.com</a>
  </div>
</body></html>`;

  // ── Shared components ────────────────────────────────────────────────

  const portalBlock = portalUrl
    ? `<p>Please log in to our secure client portal to respond to queries and submit documents:<br>
       <a href="${portalUrl}" class="portal-btn">Login to Client Portal →</a></p>`
    : "";

  const noteBlock = customMessage
    ? `<div class="note">${customMessage.replace(/\n/g, "<br>")}</div>`
    : "";

  const queryTable = queries.length > 0
    ? `<table class="qt">
        <thead>
          <tr>
            <th style="width:8%">#</th>
            <th style="width:42%">Query</th>
            <th style="width:30%">Documents Required</th>
            <th style="width:20%">Ledger / Group</th>
          </tr>
        </thead>
        <tbody>
          ${queries.map((q, i) => `
            <tr>
              <td style="color:#6b7280;text-align:center">${q.ref_number || (i + 1)}</td>
              <td>${q.query_text}</td>
              <td style="color:#92400e">${q.required_documents || "—"}</td>
              <td style="color:#4b5563;font-size:12px">${[q.ledger_name, q.group_name].filter(Boolean).join(" / ") || "—"}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>`
    : "";

  const signatory = signatoryName || firmName;
  const closing   = `<p style="margin-top:20px">Regards,<br><strong>${signatory}</strong><br>
    <em>For ${firmName}</em></p>`;

  // ── Templates ────────────────────────────────────────────────────────

  switch (type) {
    case "audit_commencement":
      return wrapper(`
        <p>Dear ${clientName},</p>
        <p>We are pleased to inform you that we have commenced the statutory audit${fy} for your organization.</p>
        <p>As part of the audit process, we will require your cooperation in providing the necessary documents and information as requested from time to time. We have set up a <strong>secure client portal</strong> through which you can:</p>
        <ul style="margin:0 0 12px;padding-left:20px">
          <li>View and respond to audit queries</li>
          <li>Submit documents electronically</li>
          <li>Track the progress of the audit</li>
        </ul>
        ${portalBlock}
        ${noteBlock}
        <p>We assure you of our best professional services. We look forward to your active cooperation for a smooth and timely audit.</p>
        ${closing}
      `);

    case "audit_document_request":
      return wrapper(`
        <p>Dear ${clientName},</p>
        <p>In connection with the audit${fy}, we require the following documents and information ${deadline}:</p>
        ${queryTable}
        ${portalBlock}
        ${noteBlock}
        <p>Please ensure the documents submitted are complete, organized, and properly labelled. If you have any queries regarding the above requirements, please do not hesitate to contact us.</p>
        ${closing}
      `);

    case "audit_query_dispatch":
      return wrapper(`
        <p>Dear ${clientName},</p>
        <p>Please find below the audit queries raised in connection with the audit${fy}. Kindly review each query carefully and provide the required information / documents ${deadline}.</p>
        ${queryTable}
        <p>You can respond to these queries and upload supporting documents directly through our client portal:</p>
        ${portalBlock}
        ${noteBlock}
        <p>Timely responses will help us complete the audit within the agreed timeline. Please acknowledge receipt of this communication at the earliest.</p>
        ${closing}
      `);

    case "audit_query_reminder":
      return wrapper(`
        <p>Dear ${clientName},</p>
        <p>This is a <strong>reminder</strong> regarding the pending audit queries${fy} that require your immediate attention.</p>
        ${queries.length > 0 ? `<p>The following queries are still awaiting your response:</p>${queryTable}` : ""}
        <p>We request you to provide the required information / documents ${deadline} to avoid any delay in the completion of the audit.</p>
        ${portalBlock}
        ${noteBlock}
        <p>If you have already responded through the client portal, kindly disregard this reminder.</p>
        ${closing}
      `);

    case "audit_draft_report":
      return wrapper(`
        <p>Dear ${clientName},</p>
        <p>We are pleased to share the <strong>draft audit report${fy}</strong> for your review and consideration.</p>
        <p>We request you to go through the report carefully and revert with your confirmation or comments within <strong>3 working days</strong>. The draft report is available on the client portal.</p>
        ${portalBlock}
        ${noteBlock}
        <p>Upon receiving your approval / confirmation, we will proceed with the finalization and signing of the report. Please note that this draft is for review purposes only and should not be circulated.</p>
        ${closing}
      `);

    case "audit_final_report":
      return wrapper(`
        <p>Dear ${clientName},</p>
        <p>We are pleased to inform you that the audit${fy} has been completed. The <strong>signed final audit report</strong> is ready.</p>
        ${portalBlock}
        ${noteBlock}
        <p>We thank you for your cooperation and support throughout the audit process. The signed report and all relevant documentation are available on the client portal for your records.</p>
        <p>Please feel free to contact us if you require any clarification or have any further queries.</p>
        ${closing}
      `);
  }
}

/**
 * Returns a pre-filled subject line with the FY substituted.
 */
export function buildAuditEmailSubject(type: AuditEmailType, financialYear?: string): string {
  const tpl = AUDIT_EMAIL_SUBJECTS[type];
  return financialYear ? tpl.replace("{FY}", financialYear) : tpl.replace(" — FY {FY}", "").replace(" (FY {FY})", "");
}
