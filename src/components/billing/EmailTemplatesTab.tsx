import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Mail, Edit2, Eye, Save, X, CheckCircle2, AlertCircle, Code, Trash2, Wand2, Palette,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { BRAND_LOGO_URL, HEAD_FIRM_NAME, isBillingEmailType } from "../../../supabase/functions/_shared/emailBrand";

// ─── Constants ───────────────────────────────────────────────────────────────

const TEMPLATE_TYPES = [
  "invoice_generated",
  "quotation_sent",
  "proforma_sent",
  "credit_note_issued",
  "payment_reminder",
  "ledger_statement",
  "tds_due_7_days",
  "tds_due_1_day",
  "audit_report_ready",
  "new_user_welcome",
] as const;

export type TemplateType = (typeof TEMPLATE_TYPES)[number];

const DEFAULT_SUBJECTS: Record<TemplateType, string> = {
  invoice_generated: "Invoice from {{firm_name}}",
  quotation_sent: "Quotation from {{firm_name}}",
  proforma_sent: "Proforma Invoice from {{firm_name}}",
  credit_note_issued: "Credit Note from {{firm_name}}",
  payment_reminder: "Payment Reminder — {{firm_name}}",
  ledger_statement: "Statement of Account — {{firm_name}}",
  tds_due_7_days: "TDS Payment Due in 7 Days",
  tds_due_1_day: "Action Needed: TDS Payment Due Tomorrow",
  audit_report_ready: "Your Audit Report is Ready for Review",
  new_user_welcome: "Welcome to {{firm_name}}",
};

const TEMPLATE_LABELS: Record<TemplateType, string> = {
  invoice_generated: "Invoice Generated",
  quotation_sent: "Quotation Sent",
  proforma_sent: "Proforma Invoice Sent",
  credit_note_issued: "Credit Note from {{firm_name}}",
  payment_reminder: "Payment Reminder",
  ledger_statement: "Statement of Account",
  tds_due_7_days: "TDS Due in 7 Days",
  tds_due_1_day: "TDS Due Tomorrow (Urgent)",
  audit_report_ready: "Audit Report Ready",
  new_user_welcome: "New User Welcome",
};

const AVAILABLE_VARIABLES = [
  "{{client_name}}",
  "{{invoice_no}}",
  "{{amount}}",
  "{{due_date}}",
  "{{firm_name}}",
  "{{document_type}}",
  "{{custom_message}}",
  "{{invoice_table}}",
  "{{statement_date}}",
  "{{days_overdue}}",
];

// Sample values so the preview reads like a real email instead of showing raw {{placeholders}}.
const SAMPLE_INVOICE_TABLE = `<table style="width:100%;border-collapse:collapse;margin:16px 0"><tr><th style="padding:6px 8px;border-bottom:2px solid #e5e7eb;text-align:left;font-size:12px;color:#6b7280">Invoice No.</th><th style="padding:6px 8px;border-bottom:2px solid #e5e7eb;text-align:left;font-size:12px;color:#6b7280">Date</th><th style="padding:6px 8px;border-bottom:2px solid #e5e7eb;text-align:left;font-size:12px;color:#6b7280">Due Date</th><th style="padding:6px 8px;border-bottom:2px solid #e5e7eb;text-align:right;font-size:12px;color:#6b7280">Outstanding</th></tr><tr><td style="padding:6px 8px;border-bottom:1px solid #f3f4f6;font-size:13px">INV/26-27/114</td><td style="padding:6px 8px;border-bottom:1px solid #f3f4f6;font-size:13px">01 Oct 2026</td><td style="padding:6px 8px;border-bottom:1px solid #f3f4f6;font-size:13px">15 Nov 2026</td><td style="padding:6px 8px;border-bottom:1px solid #f3f4f6;font-size:13px;text-align:right">₹1,18,000.00</td></tr></table>`;
const SAMPLE_VARS: Record<string, string> = {
  client_name: "Sample Client Pvt Ltd", firm_name: HEAD_FIRM_NAME, invoice_no: "INV/26-27/114",
  amount: "₹1,18,000.00", due_date: "15 Nov 2026", document_type: "Invoice", custom_message: "",
  invoice_table: SAMPLE_INVOICE_TABLE, statement_date: "28 Oct 2026", days_overdue: "12",
};
const withSampleValues = (html: string) => html.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, k) => SAMPLE_VARS[k] ?? "");

const FONT_OPTIONS = [
  { value: "Arial, Helvetica, sans-serif", label: "Arial (Sans-Serif)" },
  { value: "'Helvetica Neue', Helvetica, Arial, sans-serif", label: "Helvetica Neue" },
  { value: "Georgia, 'Times New Roman', serif", label: "Georgia (Serif)" },
  { value: "'Times New Roman', Times, serif", label: "Times New Roman" },
  { value: "Verdana, Geneva, sans-serif", label: "Verdana" },
  { value: "'Trebuchet MS', Helvetica, sans-serif", label: "Trebuchet MS" },
  { value: "Tahoma, Geneva, sans-serif", label: "Tahoma" },
];

// ─── Theme System ─────────────────────────────────────────────────────────────

interface ThemeConfig {
  label: string;
  color: string;
  headerBg: string;
  headerText: string;
  bodyBg: string;
  accentColor: string;
  font: string;
  btnText: string;
}

const THEMES: Record<string, ThemeConfig> = {
  professional: {
    label: "Professional",
    color: "#1a3a5c",
    headerBg: "#1a3a5c",
    headerText: "#ffffff",
    bodyBg: "#f0f4f8",
    accentColor: "#1a3a5c",
    font: "Arial, Helvetica, sans-serif",
    btnText: "#ffffff",
  },
  modern: {
    label: "Modern",
    color: "#0891b2",
    headerBg: "#0891b2",
    headerText: "#ffffff",
    bodyBg: "#f0f9ff",
    accentColor: "#0891b2",
    font: "'Helvetica Neue', Helvetica, Arial, sans-serif",
    btnText: "#ffffff",
  },
  bold: {
    label: "Bold",
    color: "#ea580c",
    headerBg: "#ea580c",
    headerText: "#ffffff",
    bodyBg: "#fff7ed",
    accentColor: "#ea580c",
    font: "Georgia, 'Times New Roman', serif",
    btnText: "#ffffff",
  },
  minimal: {
    label: "Minimal",
    color: "#374151",
    headerBg: "#374151",
    headerText: "#ffffff",
    bodyBg: "#f9fafb",
    accentColor: "#374151",
    font: "Tahoma, Geneva, sans-serif",
    btnText: "#ffffff",
  },
  elegant: {
    label: "Elegant",
    color: "#7c3aed",
    headerBg: "#7c3aed",
    headerText: "#ffffff",
    bodyBg: "#faf5ff",
    accentColor: "#7c3aed",
    font: "Georgia, 'Times New Roman', serif",
    btnText: "#ffffff",
  },
};

// ─── Type-specific email body content ────────────────────────────────────────

const P = (t: string) => `<p style="margin:0 0 16px;color:#374151;font-size:14px;line-height:1.7;">${t}</p>`;
const ROW = (label: string, value: string, i: number, tone = "#e5e7eb", valueColor = "#111827") =>
  `<tr${i % 2 === 0 ? ' style="background-color:#f8fafc;"' : ""}><td style="padding:10px 16px;border:1px solid ${tone};font-size:13px;color:#6b7280;font-weight:500;width:42%;">${label}</td><td style="padding:10px 16px;border:1px solid ${tone};font-size:13px;color:${valueColor};font-weight:600;">${value}</td></tr>`;
const TABLE = (rows: string[]) =>
  `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin:0 0 20px;">\n  ${rows.join("\n  ")}\n</table>`;
const NOTE = (t: string, bg: string, bar: string, color: string) =>
  `<div style="background:${bg};border-left:4px solid ${bar};padding:14px 18px;border-radius:0 6px 6px 0;margin:0 0 20px;"><p style="margin:0;color:${color};font-size:13px;line-height:1.6;">${t}</p></div>`;

// {{amount}} already carries the ₹ sign; no CTA button for billing emails — the document is attached.
const TYPE_CONTENT: Record<TemplateType, { category: string; body: string; cta: string }> = {
  invoice_generated: {
    category: "Invoice",
    body: [
      P("Thank you for choosing {{firm_name}}. Please find attached our invoice for the services rendered. The details are summarised below."),
      TABLE([ROW("Invoice No.", "{{invoice_no}}", 0), ROW("Invoice Amount", "{{amount}}", 1), ROW("Payment Due Date", "{{due_date}}", 2)]),
      P("We request you to arrange payment on or before the due date. Our bank details for remittance are printed on the invoice; please quote the invoice number in your payment reference."),
      P("Should you have any question about this invoice, simply reply to this email and we will be glad to assist."),
    ].join("\n"),
    cta: "",
  },
  quotation_sent: {
    category: "Quotation",
    body: [
      P("Thank you for giving us the opportunity to be of service. Please find attached our quotation for your consideration."),
      TABLE([ROW("Quotation No.", "{{invoice_no}}", 0), ROW("Quoted Amount", "{{amount}}", 1)]),
      P("Kindly review the scope and fees and let us know if you would like to proceed, or if you would like any change. We shall commence the engagement on receipt of your confirmation."),
    ].join("\n"),
    cta: "",
  },
  proforma_sent: {
    category: "Proforma Invoice",
    body: [
      P("Please find attached the proforma invoice for the services proposed to be rendered to you."),
      TABLE([ROW("Proforma No.", "{{invoice_no}}", 0), ROW("Amount", "{{amount}}", 1)]),
      P("Please note that a proforma invoice is issued for your approval and payment planning; it is not a tax invoice. The tax invoice will be issued as per our engagement terms."),
    ].join("\n"),
    cta: "",
  },
  credit_note_issued: {
    category: "Credit Note",
    body: [
      P("We have issued a credit note in your favour. A copy is attached for your records."),
      TABLE([ROW("Credit Note No.", "{{invoice_no}}", 0), ROW("Credit Amount", "{{amount}}", 1)]),
      P("The amount will be adjusted against your outstanding balance or future invoices, and will be reflected in your next statement of account. Please get in touch if you would like to discuss it."),
    ].join("\n"),
    cta: "",
  },
  payment_reminder: {
    category: "Payment Reminder",
    body: [
      NOTE("Gentle reminder — payment outstanding", "#fef2f2", "#ef4444", "#991b1b"),
      P("We trust you are well. Our records show that the payment below is outstanding as on the date of this email."),
      "{{invoice_table}}",
      P("We would appreciate your arranging payment at the earliest. If you have already paid, please accept our thanks and share the payment date and UTR / reference so that we can update our books."),
    ].join("\n"),
    cta: "",
  },
  ledger_statement: {
    category: "Statement of Account",
    body: [
      P("Please find attached your statement of account for the period mentioned in the attachment."),
      NOTE("Kindly check the balances against your books. If you find any difference, please let us know within 7 days so that we can reconcile it together.", "#f8fafc", "#1a3a5c", "#374151"),
      P("If the balance is payable, we request you to arrange payment at your earliest convenience. Our bank details are given at the end of the statement."),
    ].join("\n"),
    cta: "",
  },
  tds_due_7_days: {
    category: "TDS Reminder",
    body: [
      NOTE("TDS payment due within 7 days", "#fffbeb", "#f59e0b", "#92400e"),
      P("This is a courtesy reminder that the TDS (Tax Deducted at Source) deducted by you is due for deposit with the Government within the next <strong>7 days</strong>."),
      P("Timely deposit avoids interest under section 201(1A) and the related late-fee and penalty consequences. Please let us know if you would like us to prepare the challan."),
    ].join("\n"),
    cta: "",
  },
  tds_due_1_day: {
    category: "URGENT: TDS",
    body: [
      NOTE("Action needed — TDS payment due tomorrow", "#fef2f2", "#ef4444", "#991b1b"),
      P("Your TDS payment is due for deposit <strong>tomorrow</strong>. A delay attracts interest at 1.5% per month under section 201(1A), and may lead to penalty and further proceedings."),
      P("Please arrange the deposit today and share the challan details with us so that we can update your TDS records."),
    ].join("\n"),
    cta: "",
  },
  audit_report_ready: {
    category: "Audit Report",
    body: [
      P("We are pleased to inform you that your audit report is ready for your review."),
      NOTE("Please read the report carefully and let us have your comments or approval at your earliest convenience.", "#f0fdf4", "#16a34a", "#166534"),
      P("If you need any clarification or wish to discuss any of the points, please reply to this email and we will arrange a call."),
    ].join("\n"),
    cta: "",
  },
  new_user_welcome: {
    category: "Welcome",
    body: [
      P("Welcome to {{firm_name}}. We are delighted to have you with us and look forward to serving you."),
      P("Through your client portal you can view invoices and statements of account, share documents with us securely, and track the status of your work."),
      P("Your login details have been shared with you separately. For your security, please change your password when you first sign in."),
    ].join("\n"),
    cta: "",
  },
};

// ─── Template HTML Builder ────────────────────────────────────────────────────

function buildTemplateHTML(
  themeKey: string,
  type: TemplateType,
  overrideHeaderColor?: string,
  overrideAccentColor?: string,
  overrideFont?: string,
): string {
  const base = THEMES[themeKey] || THEMES.professional;
  const headerBg = overrideHeaderColor || base.headerBg;
  const accentColor = overrideAccentColor || base.accentColor;
  const font = overrideFont || base.font;
  const content = TYPE_CONTENT[type];

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${TEMPLATE_LABELS[type]}</title>
</head>
<body style="margin:0;padding:0;background-color:${base.bodyBg};font-family:${font};">
<table width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${base.bodyBg}">
<tr><td align="center" style="padding:24px 16px;">
<table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;">
  ${isBillingEmailType(type) ? `<tr>
    <td align="center" style="background-color:#ffffff;border-radius:8px 8px 0 0;border-top:5px solid #1a3a5c;border-bottom:3px solid #c8960c;padding:26px 36px 22px;">
      <img src="${BRAND_LOGO_URL}" alt="${HEAD_FIRM_NAME}" width="300" style="display:block;margin:0 auto;border:0;height:auto;width:300px;max-width:100%;">
    </td>
  </tr>` : `<tr>
    <td style="background-color:${headerBg};border-radius:8px 8px 0 0;padding:28px 36px;">
      <table width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td>
            <div style="font-size:22px;font-weight:800;color:#ffffff;font-family:${font};">{{firm_name}}</div>
            <div style="font-size:12px;color:#ffffff;opacity:0.85;margin-top:4px;font-family:${font};">Chartered Accountants</div>
          </td>
          <td align="right" style="vertical-align:top;">
            <div style="background:rgba(255,255,255,0.18);border-radius:6px;padding:6px 14px;">
              <span style="color:#ffffff;font-size:12px;font-weight:600;font-family:${font};">${content.category}</span>
            </div>
          </td>
        </tr>
      </table>
    </td>
  </tr>
  <tr><td style="background-color:${accentColor};height:4px;"></td></tr>`}
  <tr>
    <td style="background-color:#ffffff;padding:36px;border:1px solid #e5e7eb;border-top:none;">
      <p style="margin:0 0 20px;color:#111827;font-size:15px;line-height:1.6;font-family:${font};">Dear {{client_name}},</p>
      ${content.body}
      <p style="margin:20px 0 8px;color:#6b7280;font-size:13px;line-height:1.6;font-family:${font};">If you have any question, please reply to this email or write to accounts@vjdesai.com.</p>
      <p style="margin:16px 0 0;color:#374151;font-size:14px;line-height:1.6;font-family:${font};">Warm regards,<br><strong style="color:#111827;">{{firm_name}}</strong><br><span style="font-size:12px;color:#6b7280;">Chartered Accountants</span></p>
    </td>
  </tr>
  <tr>
    <td style="background-color:${headerBg};border-radius:0 0 8px 8px;padding:18px 36px;text-align:center;">
      <p style="margin:0;color:#ffffff;opacity:0.75;font-size:11px;font-family:${font};">{{firm_name}} · Chartered Accountants</p>
      <p style="margin:6px 0 0;color:#ffffff;opacity:0.55;font-size:10px;font-family:${font};">This message and its attachments are confidential and intended only for the addressee.</p>
    </td>
  </tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface EmailTemplate {
  id: string;
  firm_id: string;
  type: TemplateType;
  name: string;
  subject: string;
  body_html: string;
  is_active: boolean;
  updated_at: string;
}

interface EditState {
  id?: string;
  type: TemplateType;
  name: string;
  subject: string;
  body_html: string;
  is_active: boolean;
  themeKey: string;
  headerColor: string;
  accentColor: string;
  fontFamily: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function EmailTemplatesTab({
  firmId,
  types,
  title = "Email Templates",
  description,
}: {
  firmId: string | null;
  /** Show only these template types (e.g. the reminder templates inside Billing Reminders). */
  types?: readonly TemplateType[];
  title?: string;
  description?: string;
}) {
  const shownTypes = types ?? TEMPLATE_TYPES;
  const { user } = useAuth();
  const { toast } = useToast();
  const resolvedFirmId = firmId ?? user?.firm_id ?? null;

  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [editOpen, setEditOpen] = useState(false);
  const [editState, setEditState] = useState<EditState | null>(null);
  const [saving, setSaving] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<EmailTemplate | null>(null);

  const bodyRef = useRef<HTMLTextAreaElement | null>(null);

  const fetchTemplates = useCallback(async () => {
    if (!resolvedFirmId) { setLoading(false); return; }
    setLoading(true);
    const { data, error } = await (supabase.from("email_templates") as any)
      .select("*")
      .eq("firm_id", resolvedFirmId);
    if (!error) setTemplates((data as EmailTemplate[]) || []);
    setLoading(false);
  }, [resolvedFirmId]);

  useEffect(() => { fetchTemplates(); }, [fetchTemplates]);

  const getTemplateForType = (type: TemplateType) => templates.find(t => t.type === type);

  const openEdit = (type: TemplateType) => {
    const existing = getTemplateForType(type);
    const defaultTheme = THEMES.professional;
    setEditState({
      id: existing?.id,
      type,
      name: existing?.name ?? TEMPLATE_LABELS[type],
      subject: existing?.subject ?? DEFAULT_SUBJECTS[type],
      body_html: existing?.body_html ?? buildTemplateHTML("professional", type),
      is_active: existing?.is_active ?? true,
      themeKey: "professional",
      headerColor: defaultTheme.headerBg,
      accentColor: defaultTheme.accentColor,
      fontFamily: defaultTheme.font,
    });
    setShowPreview(false);
    setEditOpen(true);
  };

  const applyTheme = () => {
    if (!editState) return;
    const html = buildTemplateHTML(
      editState.themeKey,
      editState.type,
      editState.headerColor,
      editState.accentColor,
      editState.fontFamily,
    );
    setEditState(p => p ? { ...p, body_html: html } : p);
    toast({ title: "Theme applied!", description: "HTML body regenerated with selected theme." });
  };

  const insertVariable = (variable: string) => {
    if (!editState || !bodyRef.current) return;
    const el = bodyRef.current;
    const start = el.selectionStart ?? editState.body_html.length;
    const end = el.selectionEnd ?? editState.body_html.length;
    const newBody =
      editState.body_html.substring(0, start) +
      variable +
      editState.body_html.substring(end);
    setEditState(prev => prev ? { ...prev, body_html: newBody } : prev);
    requestAnimationFrame(() => {
      el.selectionStart = start + variable.length;
      el.selectionEnd = start + variable.length;
      el.focus();
    });
  };

  const handleSave = async () => {
    if (!editState || !resolvedFirmId) return;
    if (!editState.name.trim() || !editState.subject.trim()) {
      toast({ title: "Name and subject are required", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const payload: any = {
        firm_id: resolvedFirmId,
        type: editState.type,
        name: editState.name.trim(),
        subject: editState.subject.trim(),
        body_html: editState.body_html,
        is_active: editState.is_active,
        updated_at: new Date().toISOString(),
      };
      let error: any;
      if (editState.id) {
        ({ error } = await (supabase.from("email_templates") as any)
          .update(payload).eq("id", editState.id));
      } else {
        ({ error } = await (supabase.from("email_templates") as any).insert(payload));
      }
      if (error) throw error;
      toast({ title: "Template saved successfully" });
      setEditOpen(false);
      fetchTemplates();
    } catch (err: any) {
      toast({ title: "Error saving template", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  // Rewrite the six billing templates in the standard V J Desai design (logo, head-firm name).
  const [applyingAll, setApplyingAll] = useState(false);
  const handleApplyStandard = async () => {
    if (!resolvedFirmId) return;
    setApplyingAll(true);
    try {
      for (const type of TEMPLATE_TYPES.filter(isBillingEmailType)) {
        const existing = templates.find(t => t.type === type);
        const row: any = {
          firm_id: resolvedFirmId, type,
          name: existing?.name || TEMPLATE_LABELS[type],
          subject: existing?.subject || DEFAULT_SUBJECTS[type],
          body_html: buildTemplateHTML("professional", type),
          is_active: true, updated_at: new Date().toISOString(),
        };
        const { error } = existing
          ? await (supabase.from("email_templates") as any).update(row).eq("id", existing.id)
          : await (supabase.from("email_templates") as any).insert(row);
        if (error) throw error;
      }
      toast({ title: "Billing templates updated", description: "All six billing templates now use the V J Desai & Co. LLP logo and design." });
      fetchTemplates();
    } catch (err: any) {
      toast({ title: "Could not update templates", description: err.message, variant: "destructive" });
    } finally {
      setApplyingAll(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    const { error } = await (supabase.from("email_templates") as any)
      .delete().eq("id", deleteTarget.id);
    if (error) {
      toast({ title: "Error deleting template", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Template deleted", description: "Default template will be used." });
      fetchTemplates();
    }
    setDeleteTarget(null);
  };

  const handleToggleActive = async (type: TemplateType, newVal: boolean) => {
    const existing = getTemplateForType(type);
    if (!resolvedFirmId) return;
    if (!existing) {
      const { error } = await (supabase.from("email_templates") as any).insert({
        firm_id: resolvedFirmId,
        type,
        name: TEMPLATE_LABELS[type],
        subject: DEFAULT_SUBJECTS[type],
        body_html: buildTemplateHTML("professional", type),
        is_active: newVal,
        updated_at: new Date().toISOString(),
      });
      if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    } else {
      const { error } = await (supabase.from("email_templates") as any)
        .update({ is_active: newVal, updated_at: new Date().toISOString() })
        .eq("id", existing.id);
      if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    }
    fetchTemplates();
  };

  if (loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 p-1">
        {shownTypes.map(t => <Skeleton key={t} className="h-44 w-full rounded-lg" />)}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">{title}</h2>
          <p className="text-sm text-muted-foreground">
            {description ?? <>Customise the email content sent to clients. Click a template to edit its theme, design, colours, and content.
            Billing emails (invoice, quotation, proforma, credit note, reminder, statement) always go out as {HEAD_FIRM_NAME} with its logo.</>}
          </p>
        </div>
        {!types && <Button variant="outline" size="sm" onClick={handleApplyStandard} disabled={applyingAll || !resolvedFirmId}>
          <Wand2 size={14} className="mr-1.5" /> {applyingAll ? "Applying…" : "Apply standard design to all billing templates"}
        </Button>}
      </div>

      <div className={cn("grid grid-cols-1 md:grid-cols-2 gap-4", !types && "xl:grid-cols-3")}>
        {shownTypes.map(type => {
          const tpl = getTemplateForType(type);
          const isActive = tpl ? tpl.is_active : true;
          const isDefault = !tpl;
          const subject = tpl?.subject ?? DEFAULT_SUBJECTS[type];

          return (
            <Card key={type} className="relative flex flex-col">
              <CardHeader className="pb-2 flex flex-row items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <CardTitle className="text-sm font-semibold truncate">
                      {tpl?.name ?? TEMPLATE_LABELS[type]}
                    </CardTitle>
                    {isDefault && (
                      <Badge variant="secondary" className="text-xs shrink-0">Default</Badge>
                    )}
                  </div>
                  <Badge variant="outline" className="text-xs mt-1 font-mono">{type}</Badge>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {isActive
                    ? <CheckCircle2 size={14} className="text-emerald-500" />
                    : <AlertCircle size={14} className="text-muted-foreground" />
                  }
                  <Switch
                    checked={isActive}
                    onCheckedChange={v => handleToggleActive(type, v)}
                    className="scale-75"
                  />
                </div>
              </CardHeader>
              <CardContent className="space-y-3 flex-1 flex flex-col justify-between">
                <div>
                  <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide mb-0.5">Subject</p>
                  <p className="text-sm text-foreground truncate" title={subject}>{subject}</p>
                </div>
                {types && (
                  // Inline preview (sample values) so the reminder email can be read without opening the editor.
                  <iframe
                    title={`${TEMPLATE_LABELS[type]} preview`}
                    className="w-full h-[360px] rounded border bg-white"
                    sandbox=""
                    srcDoc={withSampleValues(tpl?.body_html ?? buildTemplateHTML("professional", type))}
                  />
                )}
                <div className="flex gap-2 pt-1">
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1 gap-1.5"
                    onClick={() => openEdit(type)}
                  >
                    <Edit2 size={13} />
                    {isDefault ? "Create Template" : "Edit Template"}
                  </Button>
                  {!isDefault && tpl && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1 text-destructive hover:bg-destructive/10 hover:text-destructive border-destructive/30"
                      onClick={() => setDeleteTarget(tpl)}
                    >
                      <Trash2 size={13} />
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* ── Edit Dialog ───────────────────────────────────────────────────── */}
      <Dialog open={editOpen} onOpenChange={open => { if (!saving) setEditOpen(open); }}>
        <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Mail size={18} />
              {editState ? `Edit: ${TEMPLATE_LABELS[editState.type]}` : "Edit Template"}
            </DialogTitle>
          </DialogHeader>

          {editState && (
            <div className="space-y-5 py-1">

              {/* ── Design Theme Section ─────────────────────────────── */}
              <div className="rounded-lg border bg-muted/30 p-4 space-y-4">
                <div className="flex items-center gap-2 mb-1">
                  <Palette size={15} className="text-muted-foreground" />
                  <p className="text-sm font-semibold">Design & Theme</p>
                </div>

                {/* Theme Swatches */}
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground uppercase tracking-wide">Theme Preset</Label>
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(THEMES).map(([key, theme]) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => {
                          setEditState(p => p ? {
                            ...p,
                            themeKey: key,
                            headerColor: theme.headerBg,
                            accentColor: theme.accentColor,
                            fontFamily: theme.font,
                          } : p);
                        }}
                        className={cn(
                          "flex items-center gap-2 px-3 py-1.5 rounded-md border text-xs font-medium transition-all",
                          editState.themeKey === key
                            ? "ring-2 ring-offset-1 ring-primary border-primary"
                            : "border-border hover:border-primary/50",
                        )}
                      >
                        <span
                          className="w-4 h-4 rounded-full shrink-0 border border-white/30"
                          style={{ backgroundColor: theme.color }}
                        />
                        {theme.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Color + Font row */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="hdr-color" className="text-xs text-muted-foreground">Header Colour</Label>
                    <div className="flex items-center gap-2">
                      <input
                        id="hdr-color"
                        type="color"
                        value={editState.headerColor}
                        onChange={e => setEditState(p => p ? { ...p, headerColor: e.target.value } : p)}
                        className="w-8 h-8 rounded border cursor-pointer p-0.5"
                      />
                      <Input
                        value={editState.headerColor}
                        onChange={e => setEditState(p => p ? { ...p, headerColor: e.target.value } : p)}
                        className="h-8 text-xs font-mono"
                        maxLength={7}
                      />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="acc-color" className="text-xs text-muted-foreground">Accent Colour</Label>
                    <div className="flex items-center gap-2">
                      <input
                        id="acc-color"
                        type="color"
                        value={editState.accentColor}
                        onChange={e => setEditState(p => p ? { ...p, accentColor: e.target.value } : p)}
                        className="w-8 h-8 rounded border cursor-pointer p-0.5"
                      />
                      <Input
                        value={editState.accentColor}
                        onChange={e => setEditState(p => p ? { ...p, accentColor: e.target.value } : p)}
                        className="h-8 text-xs font-mono"
                        maxLength={7}
                      />
                    </div>
                  </div>
                  <div className="space-y-1.5 col-span-2">
                    <Label className="text-xs text-muted-foreground">Font Family</Label>
                    <Select
                      value={editState.fontFamily}
                      onValueChange={v => setEditState(p => p ? { ...p, fontFamily: v } : p)}
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {FONT_OPTIONS.map(f => (
                          <SelectItem key={f.value} value={f.value} className="text-xs">
                            {f.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <Button
                  variant="default"
                  size="sm"
                  className="gap-2 w-full sm:w-auto"
                  onClick={applyTheme}
                >
                  <Wand2 size={14} />
                  Apply Theme &amp; Regenerate HTML
                </Button>
              </div>

              {/* ── Template Name ────────────────────────────────────── */}
              <div className="space-y-1.5">
                <Label htmlFor="tpl-name">Template Name</Label>
                <Input
                  id="tpl-name"
                  value={editState.name}
                  onChange={e => setEditState(p => p ? { ...p, name: e.target.value } : p)}
                  placeholder="e.g. Invoice Notification"
                />
              </div>

              {/* ── Subject ──────────────────────────────────────────── */}
              <div className="space-y-1.5">
                <Label htmlFor="tpl-subject">Subject Line</Label>
                <Input
                  id="tpl-subject"
                  value={editState.subject}
                  onChange={e => setEditState(p => p ? { ...p, subject: e.target.value } : p)}
                  placeholder="Email subject line"
                />
                <div className="flex flex-wrap gap-1.5 mt-1">
                  <span className="text-xs text-muted-foreground self-center">Insert:</span>
                  {AVAILABLE_VARIABLES.map(v => (
                    <button
                      key={v}
                      type="button"
                      className="text-xs px-2 py-0.5 rounded bg-muted hover:bg-accent border border-border font-mono transition-colors"
                      onClick={() => setEditState(p => p ? { ...p, subject: p.subject + v } : p)}
                    >
                      {v}
                    </button>
                  ))}
                </div>
              </div>

              {/* ── Body HTML Editor ─────────────────────────────────── */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label htmlFor="tpl-body">Body (HTML)</Label>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 gap-1 text-xs"
                    onClick={() => setShowPreview(p => !p)}
                  >
                    {showPreview ? <><Code size={12} /> Edit HTML</> : <><Eye size={12} /> Preview</>}
                  </Button>
                </div>

                {showPreview ? (
                  <iframe
                    title="Email preview"
                    sandbox=""
                    className="w-full h-[420px] rounded border bg-white"
                    srcDoc={withSampleValues(editState.body_html) || "<p style='color:#9ca3af;padding:20px;font-family:Arial'>No content — apply a theme to generate HTML.</p>"}
                  />
                ) : (
                  <Textarea
                    id="tpl-body"
                    ref={bodyRef}
                    value={editState.body_html}
                    onChange={e => setEditState(p => p ? { ...p, body_html: e.target.value } : p)}
                    placeholder="Apply a theme above to auto-generate HTML, or write custom HTML here."
                    className="font-mono text-xs min-h-[250px] resize-y"
                  />
                )}

                {/* Available Variables */}
                <div className="rounded-md border bg-muted/40 p-3 space-y-2">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Available Variables — click to insert into body
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {AVAILABLE_VARIABLES.map(v => (
                      <button
                        key={v}
                        type="button"
                        className="text-xs px-2 py-0.5 rounded bg-background hover:bg-accent border border-border font-mono transition-colors"
                        onClick={() => insertVariable(v)}
                        disabled={showPreview}
                      >
                        {v}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* ── Active toggle ─────────────────────────────────────── */}
              <div className="flex items-center gap-3">
                <Switch
                  checked={editState.is_active}
                  onCheckedChange={v => setEditState(p => p ? { ...p, is_active: v } : p)}
                />
                <Label className="cursor-pointer">
                  {editState.is_active ? "Active — this template will be used" : "Inactive — default template used"}
                </Label>
              </div>
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setEditOpen(false)} disabled={saving}>
              <X size={14} className="mr-1.5" /> Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              <Save size={14} className="mr-1.5" />
              {saving ? "Saving..." : "Save Template"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete Confirmation ──────────────────────────────────────────── */}
      <AlertDialog open={!!deleteTarget} onOpenChange={open => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Template?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete the <strong>{deleteTarget?.name}</strong> template?
              The system default template will be used for this notification type after deletion.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleDelete}
            >
              Delete Template
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
