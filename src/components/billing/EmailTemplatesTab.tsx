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

type TemplateType = (typeof TEMPLATE_TYPES)[number];

const DEFAULT_SUBJECTS: Record<TemplateType, string> = {
  invoice_generated: "Invoice from {{firm_name}}",
  quotation_sent: "Quotation for Your Review",
  proforma_sent: "Proforma Invoice",
  credit_note_issued: "Credit Note Issued",
  payment_reminder: "Payment Reminder — Action Required",
  ledger_statement: "Your Statement of Account",
  tds_due_7_days: "TDS Due in 7 Days — Please Act",
  tds_due_1_day: "URGENT: TDS Due Tomorrow",
  audit_report_ready: "Audit Report Ready for Review",
  new_user_welcome: "Welcome to CAFlow — {{firm_name}}",
};

const TEMPLATE_LABELS: Record<TemplateType, string> = {
  invoice_generated: "Invoice Generated",
  quotation_sent: "Quotation Sent",
  proforma_sent: "Proforma Invoice Sent",
  credit_note_issued: "Credit Note Issued",
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
];

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

const TYPE_CONTENT: Record<TemplateType, { category: string; body: string; cta: string }> = {
  invoice_generated: {
    category: "Invoice",
    body: `<p style="margin:0 0 16px;color:#374151;font-size:14px;line-height:1.6;">We are pleased to inform you that your invoice has been generated. Please find the details below:</p>
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin:0 0 20px;">
  <tr style="background-color:#f8fafc;"><td style="padding:10px 16px;border:1px solid #e5e7eb;font-size:13px;color:#6b7280;font-weight:500;width:40%;">Invoice Number</td><td style="padding:10px 16px;border:1px solid #e5e7eb;font-size:13px;color:#111827;font-weight:600;">{{invoice_no}}</td></tr>
  <tr><td style="padding:10px 16px;border:1px solid #e5e7eb;border-top:none;font-size:13px;color:#6b7280;font-weight:500;">Amount</td><td style="padding:10px 16px;border:1px solid #e5e7eb;border-top:none;font-size:13px;color:#111827;font-weight:600;">₹{{amount}}</td></tr>
  <tr style="background-color:#f8fafc;"><td style="padding:10px 16px;border:1px solid #e5e7eb;border-top:none;font-size:13px;color:#6b7280;font-weight:500;">Due Date</td><td style="padding:10px 16px;border:1px solid #e5e7eb;border-top:none;font-size:13px;color:#111827;font-weight:600;">{{due_date}}</td></tr>
</table>
<p style="margin:0 0 8px;color:#374151;font-size:14px;line-height:1.6;">Please make the payment by the due date to avoid any late charges.</p>`,
    cta: "View & Download Invoice",
  },
  quotation_sent: {
    category: "Quotation",
    body: `<p style="margin:0 0 16px;color:#374151;font-size:14px;line-height:1.6;">We are pleased to share our quotation for your review and approval.</p>
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin:0 0 20px;">
  <tr style="background-color:#f8fafc;"><td style="padding:10px 16px;border:1px solid #e5e7eb;font-size:13px;color:#6b7280;font-weight:500;width:40%;">Reference No.</td><td style="padding:10px 16px;border:1px solid #e5e7eb;font-size:13px;color:#111827;font-weight:600;">{{invoice_no}}</td></tr>
  <tr><td style="padding:10px 16px;border:1px solid #e5e7eb;border-top:none;font-size:13px;color:#6b7280;font-weight:500;">Quoted Amount</td><td style="padding:10px 16px;border:1px solid #e5e7eb;border-top:none;font-size:13px;color:#111827;font-weight:600;">₹{{amount}}</td></tr>
</table>
<p style="margin:0 0 8px;color:#374151;font-size:14px;line-height:1.6;">Kindly review the quotation and revert with your approval or any modifications at your earliest convenience.</p>`,
    cta: "Review Quotation",
  },
  proforma_sent: {
    category: "Proforma Invoice",
    body: `<p style="margin:0 0 16px;color:#374151;font-size:14px;line-height:1.6;">Please find attached your proforma invoice for the services to be rendered.</p>
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin:0 0 20px;">
  <tr style="background-color:#f8fafc;"><td style="padding:10px 16px;border:1px solid #e5e7eb;font-size:13px;color:#6b7280;font-weight:500;width:40%;">Proforma No.</td><td style="padding:10px 16px;border:1px solid #e5e7eb;font-size:13px;color:#111827;font-weight:600;">{{invoice_no}}</td></tr>
  <tr><td style="padding:10px 16px;border:1px solid #e5e7eb;border-top:none;font-size:13px;color:#6b7280;font-weight:500;">Amount</td><td style="padding:10px 16px;border:1px solid #e5e7eb;border-top:none;font-size:13px;color:#111827;font-weight:600;">₹{{amount}}</td></tr>
  <tr style="background-color:#f8fafc;"><td style="padding:10px 16px;border:1px solid #e5e7eb;border-top:none;font-size:13px;color:#6b7280;font-weight:500;">Valid Until</td><td style="padding:10px 16px;border:1px solid #e5e7eb;border-top:none;font-size:13px;color:#111827;font-weight:600;">{{due_date}}</td></tr>
</table>`,
    cta: "View Proforma Invoice",
  },
  credit_note_issued: {
    category: "Credit Note",
    body: `<p style="margin:0 0 16px;color:#374151;font-size:14px;line-height:1.6;">A credit note has been issued to your account. Please find the details below:</p>
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin:0 0 20px;">
  <tr style="background-color:#f8fafc;"><td style="padding:10px 16px;border:1px solid #e5e7eb;font-size:13px;color:#6b7280;font-weight:500;width:40%;">Credit Note No.</td><td style="padding:10px 16px;border:1px solid #e5e7eb;font-size:13px;color:#111827;font-weight:600;">{{invoice_no}}</td></tr>
  <tr><td style="padding:10px 16px;border:1px solid #e5e7eb;border-top:none;font-size:13px;color:#6b7280;font-weight:500;">Credit Amount</td><td style="padding:10px 16px;border:1px solid #e5e7eb;border-top:none;font-size:13px;color:#111827;font-weight:600;">₹{{amount}}</td></tr>
</table>
<p style="margin:0 0 8px;color:#374151;font-size:14px;line-height:1.6;">This credit will be adjusted in your future invoices or can be refunded upon request.</p>`,
    cta: "View Credit Note",
  },
  payment_reminder: {
    category: "Payment Reminder",
    body: `<div style="background:#fef2f2;border-left:4px solid #ef4444;padding:14px 18px;border-radius:0 6px 6px 0;margin:0 0 20px;"><p style="margin:0;color:#991b1b;font-size:14px;font-weight:600;">⚠ Payment Due</p><p style="margin:4px 0 0;color:#dc2626;font-size:13px;">Invoice {{invoice_no}} · ₹{{amount}} · Due: {{due_date}}</p></div>
<p style="margin:0 0 16px;color:#374151;font-size:14px;line-height:1.6;">This is a friendly reminder that your payment is due. We kindly request you to make the payment at the earliest to avoid any inconvenience.</p>
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin:0 0 20px;">
  <tr style="background-color:#fef2f2;"><td style="padding:10px 16px;border:1px solid #fecaca;font-size:13px;color:#6b7280;font-weight:500;width:40%;">Invoice No.</td><td style="padding:10px 16px;border:1px solid #fecaca;font-size:13px;color:#111827;font-weight:600;">{{invoice_no}}</td></tr>
  <tr><td style="padding:10px 16px;border:1px solid #fecaca;border-top:none;font-size:13px;color:#6b7280;font-weight:500;">Outstanding Amount</td><td style="padding:10px 16px;border:1px solid #fecaca;border-top:none;font-size:13px;color:#dc2626;font-weight:700;">₹{{amount}}</td></tr>
  <tr style="background-color:#fef2f2;"><td style="padding:10px 16px;border:1px solid #fecaca;border-top:none;font-size:13px;color:#6b7280;font-weight:500;">Due Date</td><td style="padding:10px 16px;border:1px solid #fecaca;border-top:none;font-size:13px;color:#dc2626;font-weight:700;">{{due_date}}</td></tr>
</table>`,
    cta: "Pay Now",
  },
  ledger_statement: {
    category: "Statement of Account",
    body: `<p style="margin:0 0 16px;color:#374151;font-size:14px;line-height:1.6;">Please find attached your statement of account. This document provides a comprehensive overview of all transactions in your account.</p>
<div style="background:#f8fafc;border:1px solid #e5e7eb;border-radius:6px;padding:16px 20px;margin:0 0 20px;"><p style="margin:0;color:#374151;font-size:13px;line-height:1.6;">The statement includes all invoices raised, payments received, and any outstanding balances as on date.</p></div>
<p style="margin:0 0 8px;color:#374151;font-size:14px;line-height:1.6;">Please review and confirm the balances. In case of any discrepancy, kindly contact us immediately.</p>`,
    cta: "Download Statement of Account",
  },
  tds_due_7_days: {
    category: "TDS Reminder",
    body: `<div style="background:#fffbeb;border-left:4px solid #f59e0b;padding:14px 18px;border-radius:0 6px 6px 0;margin:0 0 20px;"><p style="margin:0;color:#92400e;font-size:14px;font-weight:600;">⏰ TDS Due in 7 Days</p><p style="margin:4px 0 0;color:#b45309;font-size:13px;">Ensure timely compliance to avoid penalty and interest charges.</p></div>
<p style="margin:0 0 16px;color:#374151;font-size:14px;line-height:1.6;">This is to inform you that your TDS (Tax Deducted at Source) payment is due within the next <strong>7 days</strong>.</p>
<p style="margin:0 0 16px;color:#374151;font-size:14px;line-height:1.6;">Please ensure the TDS amount is deposited with the government before the due date to avoid interest @ 1.5% per month and penalty provisions under the Income Tax Act.</p>`,
    cta: "View TDS Details",
  },
  tds_due_1_day: {
    category: "URGENT: TDS",
    body: `<div style="background:#fef2f2;border-left:4px solid #ef4444;padding:14px 18px;border-radius:0 6px 6px 0;margin:0 0 20px;"><p style="margin:0;color:#991b1b;font-size:14px;font-weight:600;">🚨 URGENT: TDS Due Tomorrow!</p><p style="margin:4px 0 0;color:#dc2626;font-size:13px;">Immediate action required to avoid penalty and interest.</p></div>
<p style="margin:0 0 16px;color:#374151;font-size:14px;line-height:1.6;"><strong>This is an urgent reminder</strong> — your TDS payment is due tomorrow. Failure to deposit may result in:</p>
<ul style="margin:0 0 16px;padding-left:24px;color:#374151;font-size:14px;line-height:1.8;">
  <li>Interest @ 1.5% per month u/s 201(1A)</li>
  <li>Penalty u/s 271C equal to TDS amount</li>
  <li>Prosecution proceedings under the Income Tax Act</li>
</ul>
<p style="margin:0;color:#374151;font-size:14px;line-height:1.6;">Please deposit the TDS amount immediately.</p>`,
    cta: "Take Action Now",
  },
  audit_report_ready: {
    category: "Audit Report",
    body: `<p style="margin:0 0 16px;color:#374151;font-size:14px;line-height:1.6;">We are pleased to inform you that your audit report is ready for review and approval.</p>
<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:6px;padding:16px 20px;margin:0 0 20px;"><p style="margin:0;color:#166534;font-size:13px;font-weight:600;">✓ Audit Completed Successfully</p><p style="margin:6px 0 0;color:#15803d;font-size:13px;">Your audit report has been prepared and is ready for your review and signature.</p></div>
<p style="margin:0 0 16px;color:#374151;font-size:14px;line-height:1.6;">Kindly review the report at your earliest convenience. If you have any queries or require modifications, please get in touch with us.</p>`,
    cta: "Review Audit Report",
  },
  new_user_welcome: {
    category: "Welcome",
    body: `<p style="margin:0 0 16px;color:#374151;font-size:14px;line-height:1.6;">Welcome aboard! We are delighted to have you as our valued client at <strong>{{firm_name}}</strong>.</p>
<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:6px;padding:16px 20px;margin:0 0 20px;"><p style="margin:0;color:#166534;font-size:14px;font-weight:600;">🎉 Your account has been created!</p><p style="margin:6px 0 0;color:#15803d;font-size:13px;">You can now access all our services through our secure portal.</p></div>
<p style="margin:0 0 12px;color:#374151;font-size:14px;line-height:1.6;">As our client, you will have access to:</p>
<ul style="margin:0 0 16px;padding-left:24px;color:#374151;font-size:14px;line-height:1.8;">
  <li>Real-time invoice and payment tracking</li>
  <li>Automated TDS compliance reminders</li>
  <li>Digital document sharing and approvals</li>
  <li>Statements of account and financial reports</li>
</ul>`,
    cta: "Access Client Portal",
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
    <td style="background-color:#ffffff;border-radius:8px 8px 0 0;border-bottom:3px solid #c8960c;padding:22px 36px;">
      <img src="${BRAND_LOGO_URL}" alt="${HEAD_FIRM_NAME}" width="190" style="display:block;border:0;height:auto;max-width:190px;">
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
      <table cellpadding="0" cellspacing="0" border="0" style="margin:28px 0 20px;">
        <tr>
          <td style="background-color:${accentColor};border-radius:6px;padding:12px 28px;">
            <a href="#" style="color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;font-family:${font};">${content.cta} →</a>
          </td>
        </tr>
      </table>
      <p style="margin:20px 0 8px;color:#6b7280;font-size:13px;line-height:1.6;font-family:${font};">For any queries, please do not hesitate to contact us.</p>
      <p style="margin:16px 0 0;color:#374151;font-size:14px;line-height:1.6;font-family:${font};">Warm regards,<br><strong style="color:#111827;">{{firm_name}}</strong><br><span style="font-size:12px;color:#6b7280;">Chartered Accountants</span></p>
    </td>
  </tr>
  <tr>
    <td style="background-color:${headerBg};border-radius:0 0 8px 8px;padding:18px 36px;text-align:center;">
      <p style="margin:0;color:#ffffff;opacity:0.75;font-size:11px;font-family:${font};">This email was sent by {{firm_name}} via CAFlow Practice Management System</p>
      <p style="margin:6px 0 0;color:#ffffff;opacity:0.55;font-size:10px;font-family:${font};">© {{firm_name}}. All rights reserved. | Professional CA Practice Software</p>
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

export default function EmailTemplatesTab({ firmId }: { firmId: string | null }) {
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
        {TEMPLATE_TYPES.map(t => <Skeleton key={t} className="h-44 w-full rounded-lg" />)}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Email Templates</h2>
          <p className="text-sm text-muted-foreground">
            Customise the email content sent to clients. Click a template to edit its theme, design, colours, and content.
            Billing emails (invoice, quotation, proforma, credit note, reminder, statement) always go out as {HEAD_FIRM_NAME} with its logo.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={handleApplyStandard} disabled={applyingAll || !resolvedFirmId}>
          <Wand2 size={14} className="mr-1.5" /> {applyingAll ? "Applying…" : "Apply standard design to all billing templates"}
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {TEMPLATE_TYPES.map(type => {
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
                  <div
                    className="min-h-[250px] max-h-[380px] overflow-auto rounded border bg-white"
                    dangerouslySetInnerHTML={{
                      __html: editState.body_html || "<p style='color:#9ca3af;padding:20px;'>No content — apply a theme to generate HTML.</p>",
                    }}
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
