// Corporate email shell — PREVIEW-ONLY mirror of
// supabase/functions/_shared/tdsEmail.ts, used by TdsEmailTemplatesEditor's
// live preview iframe. The real send path (send-tds-email) uses its own copy
// so the runtime never depends on this frontend bundle. Keep the two in sync
// — same split as the GST sibling feature's src/lib/emailTemplate.ts.

type EmailVars = Record<string, unknown>;

/** One point raised to the client in a 'query' email (render_vars.query_items). */
export interface TdsQueryItem { record?: string | null; query: string }

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

interface ShellMeta {
  accent: string;
  pill?: { text: string; bg: string; fg: string };
  box: { bg: string; border: string; label: string };
}

const SHELL: Record<string, ShellMeta> = {
  reminder_1: { accent: '#c9a227', box: { bg: '#f8fafc', border: '#e2e8f0', label: '#64748b' } },
  reminder_2: { accent: '#d97706', pill: { text: 'Data Pending', bg: '#fef3c7', fg: '#92400e' }, box: { bg: '#fffbeb', border: '#fde68a', label: '#78716c' } },
  reminder_final: { accent: '#dc2626', pill: { text: 'Urgent &middot; Final Reminder', bg: '#fee2e2', fg: '#b91c1c' }, box: { bg: '#fef2f2', border: '#fecaca', label: '#7f1d1d' } },
  confirmation_filed: { accent: '#16a34a', pill: { text: '&#10003; Filed Successfully', bg: '#dcfce7', fg: '#166534' }, box: { bg: '#f0fdf4', border: '#bbf7d0', label: '#15803d' } },
  confirmation_nil: { accent: '#16a34a', pill: { text: '&#10003; Nil Return Filed', bg: '#dcfce7', fg: '#166534' }, box: { bg: '#f0fdf4', border: '#bbf7d0', label: '#15803d' } },
  reminder_custom: { accent: '#d97706', pill: { text: 'Reminder &middot; Data Pending', bg: '#fef3c7', fg: '#92400e' }, box: { bg: '#fffbeb', border: '#fde68a', label: '#78716c' } },
  query_client: { accent: '#2563eb', pill: { text: 'Information Required', bg: '#dbeafe', fg: '#1e40af' }, box: { bg: '#eff6ff', border: '#bfdbfe', label: '#1e3a8a' } },
};

export function buildTdsEmailHtml(opts: { key: string; kind: string; message: string; vars: EmailVars }): string {
  const { key, kind, message, vars } = opts;
  const meta = SHELL[key] ?? SHELL.reminder_1;
  const g = (k: string) => (typeof vars[k] === 'string' ? (vars[k] as string) : '').trim();

  const rows: Array<[string, string]> = [['TAN', g('tan')]];
  rows.push(['Form', key === 'confirmation_nil' ? `NIL ${g('form_type')}`.trim() : g('form_type')]);
  if (g('quarter') || g('financial_year')) rows.push(['Period', `${g('quarter')} FY ${g('financial_year')}`.trim()]);
  if (kind === 'confirmation') {
    if (g('ack_no')) rows.push(['Ack No', g('ack_no')]);
    rows.push(['Filed on', g('filing_date')]);
  } else if (kind === 'query') {
    rows.push(['Please reply by', g('reply_by')]);
  } else {
    rows.push([key === 'reminder_custom' ? 'Data needed by' : 'Filing due', g('due_date')]);
  }
  const dueColor = key === 'reminder_final' ? '#dc2626' : '#b45309';
  const detailRows = rows
    .filter(([, val]) => val && val !== '')
    .map(([label, val]) =>
      `<tr><td style="padding:3px 0;color:${meta.box.label};width:110px;">${label}</td><td style="padding:3px 0;font-weight:600;${label === 'Filing due' || label === 'Data needed by' || label === 'Please reply by' ? `color:${dueColor};` : ''}">${val}</td></tr>`,
    )
    .join('');

  const paras = message
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p style="margin:0 0 16px;">${p.replace(/\n/g, '<br>')}</p>`)
    .join('');

  // Query emails: the points raised, as a numbered table under the message.
  const items = (Array.isArray(vars.query_items) ? (vars.query_items as TdsQueryItem[]) : [])
    .filter((q) => q && typeof q.query === 'string' && q.query.trim());
  const hasRecord = items.some((q) => (q.record ?? '').toString().trim());
  const th = `padding:8px 10px;text-align:left;font-size:12px;font-weight:600;color:${meta.box.label};border-bottom:1px solid ${meta.box.border};`;
  const td = 'padding:8px 10px;font-size:13px;color:#1f2937;border-bottom:1px solid #e2e8f0;vertical-align:top;';
  const queryTable = items.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${meta.box.border};border-radius:6px;border-collapse:separate;margin:0 0 18px;overflow:hidden;">
<tr style="background:${meta.box.bg};"><td style="${th}width:28px;">#</td>${hasRecord ? `<td style="${th}width:38%;">Particulars</td>` : ''}<td style="${th}">Query</td></tr>
${items.map((q, i) => `<tr><td style="${td}color:#64748b;">${i + 1}</td>${hasRecord ? `<td style="${td}font-weight:600;">${esc((q.record ?? '').toString().trim() || '—')}</td>` : ''}<td style="${td}">${esc(q.query.trim()).replace(/\n/g, '<br>')}</td></tr>`).join('')}
</table>`
    : '';

  const pill = meta.pill
    ? `<span style="display:inline-block;background:${meta.pill.bg};color:${meta.pill.fg};font-size:11px;font-weight:700;letter-spacing:.5px;padding:4px 10px;border-radius:99px;text-transform:uppercase;margin-bottom:14px;">${meta.pill.text}</span>`
    : '';

  const firmName = g('firm_name') || 'V. J. Desai & Co. LLP';
  const firmEmail = g('firm_email') || 'tds@vjdesai.com';
  const staff = g('staff_name') || 'V. J. Desai & Co. (TDS Team)';
  const contact = g('contact_person') || g('client_name') || 'Sir/Madam';

  return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef1f4;margin:0;padding:24px 0;font-family:'Segoe UI',Arial,sans-serif;">
<tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:100%;background:#ffffff;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;">
<tr><td style="height:4px;background:${meta.accent};font-size:0;line-height:0;">&nbsp;</td></tr>
<tr><td style="background:#0f2b46;padding:22px 28px;">
<div style="color:#ffffff;font-size:20px;font-weight:700;letter-spacing:.3px;">V. J. Desai &amp; Co. LLP</div>
<div style="color:#9fb3c8;font-size:11px;letter-spacing:2px;text-transform:uppercase;margin-top:3px;">Chartered Accountants &nbsp;&middot;&nbsp; TDS Compliance Desk</div>
</td></tr>
<tr><td style="padding:28px 28px 6px 28px;color:#1f2937;font-size:14px;line-height:1.6;">
${pill}
<p style="margin:0 0 14px;">Dear ${contact},</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${meta.box.bg};border:1px solid ${meta.box.border};border-radius:6px;margin:4px 0 18px;">
<tr><td style="padding:14px 16px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;color:#334155;">${detailRows}</table></td></tr>
</table>
${paras}
${queryTable}
<p style="margin:0 0 6px;">Warm regards,</p>
<p style="margin:0 0 1px;font-weight:600;color:#0f2b46;">${staff}</p>
<p style="margin:0 0 20px;color:#475569;font-size:13px;">${firmName}</p>
</td></tr>
<tr><td style="background:#f1f5f9;padding:15px 28px;border-top:1px solid #e2e8f0;">
<div style="font-size:12px;color:#64748b;line-height:1.5;">${firmName} &nbsp;&middot;&nbsp; <a href="mailto:${firmEmail}" style="color:#0f2b46;text-decoration:none;">${firmEmail}</a><br>${kind === 'query' ? 'Please reply to this email with your response.' : 'Automated message from our TDS compliance desk.'}</div>
</td></tr>
</table>
</td></tr>
</table>`;
}
