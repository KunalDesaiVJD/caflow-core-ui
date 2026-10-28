/**
 * Branding for billing emails.
 *
 * Every billing email (invoices, credit notes, quotations, proformas, payment
 * reminders, statements of account) goes out as the head firm, V J Desai & Co.
 * LLP, whichever firm the user had selected — same name, same mailbox, same
 * logo. Pure module (no Deno APIs) so it can be unit tested.
 */

export const HEAD_FIRM_NAME = "V J Desai & Co. LLP";
export const HEAD_FIRM_NAME_PATTERN = "V J Desai & Co. LLP%";
export const HEAD_FIRM_TAGLINE = "Chartered Accountants";
export const BRAND_LOGO_URL = "https://app.vjdesai.com/images/firm-logo.png";

export const BILLING_EMAIL_TYPES = new Set([
  "invoice_generated", "quotation_sent", "proforma_sent", "credit_note_issued",
  "payment_reminder", "ledger_statement",
]);

export const isBillingEmailType = (type: string) => BILLING_EMAIL_TYPES.has(type);

const NAVY = "#1a3a5c";
const GOLD = "#c8960c";

/** Logo band used at the top of every billing email: navy edge, centred logo, gold rule. */
export function logoHeaderHtml(): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff;border-top:5px solid ${NAVY};border-bottom:3px solid ${GOLD};">
  <tr><td align="center" style="padding:26px 28px 22px;">
    <img src="${BRAND_LOGO_URL}" alt="${HEAD_FIRM_NAME} — ${HEAD_FIRM_TAGLINE}" width="300" style="display:block;margin:0 auto;border:0;outline:none;height:auto;width:300px;max-width:100%;">
  </td></tr>
</table>`;
}

/**
 * A saved (per-firm) template may or may not already carry the logo. Make sure
 * the logo band is present: after <body …> for a full document, in front of a
 * fragment otherwise.
 */
export function ensureLogoHeader(html: string): string {
  if (html.includes(BRAND_LOGO_URL)) return html;
  const band = logoHeaderHtml();
  const m = /<body[^>]*>/i.exec(html);
  if (m) return html.slice(0, m.index + m[0].length) + band + html.slice(m.index + m[0].length);
  return band + html;
}

/** Professional shell for the built-in (unsaved) billing email bodies. */
export function brandedShell(body: string, opts: { footerNote?: string; contactEmail?: string } = {}): string {
  const contact = opts.contactEmail || "accounts@vjdesai.com";
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body{margin:0;padding:0;background:#f3f5f8;font-family:Arial,Helvetica,sans-serif;color:#1f2937}
  .card{max-width:620px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb}
  .bdy{padding:28px 32px;font-size:14px;line-height:1.65}
  .bdy p{margin:0 0 14px}
  table.info{width:100%;border-collapse:collapse;margin:18px 0;border:1px solid #e5e7eb}
  table.info td{padding:10px 14px;border-bottom:1px solid #eef0f3;font-size:14px}
  table.info td:first-child{color:#6b7280;width:40%;background:#f9fafb}
  table.info td:last-child{font-weight:600;color:#111827}
  .ftr{padding:18px 32px;background:${NAVY};color:#cbd5e1;font-size:11px;line-height:1.6;text-align:center}
  .ftr a{color:#ffffff}
</style></head>
<body>
<div style="padding:20px 12px;background:#f3f5f8;">
  <div class="card">
    ${logoHeaderHtml()}
    <div class="bdy">${body}</div>
    <div class="ftr">
      <strong style="color:#ffffff;font-size:12px;">${HEAD_FIRM_NAME}</strong> · ${HEAD_FIRM_TAGLINE}<br>
      ${opts.footerNote ? `${opts.footerNote}<br>` : ""}For queries write to <a href="mailto:${contact}">${contact}</a>
    </div>
  </div>
</div>
</body></html>`;
}

const esc = (v: unknown) => String(v ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/**
 * Body of the "statement of account" email (PDF attached). Shared by the sender and by the
 * Report tab's preview so what is previewed is what is sent. Values are escaped here; the
 * message keeps its line breaks.
 */
export function ledgerStatementBody(o: { clientName?: string; customMessage?: string; firmName?: string }): string {
  const msg = o.customMessage ? `<p>${esc(o.customMessage).replace(/\r?\n/g, "<br>")}</p>` : "";
  return `
        <p>Dear ${esc(o.clientName || "Client")},</p>
        <p>Please find attached your statement of account for the period mentioned in the attachment.</p>
        ${msg}
        <p>Kindly check the balances against your books. If you find any difference, please let us know within 7 days so that we can reconcile it together. If a balance is payable, we request you to arrange payment at your earliest convenience; our bank details are given at the end of the statement.</p>
        <p>Warm regards,<br><strong>${esc(o.firmName || HEAD_FIRM_NAME)}</strong><br><span style="color:#6b7280">${HEAD_FIRM_TAGLINE}</span></p>`;
}
