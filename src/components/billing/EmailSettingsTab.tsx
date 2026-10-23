import { useState } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import EmailTemplatesTab from "./EmailTemplatesTab";
import EmailLogTab from "./EmailLogTab";
import BillingRemindersTab from "./BillingRemindersTab";
import { Mail, History, Bell, Paperclip, CheckCircle2, FileText } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

// ─── PDF Attachment Settings ────────────────────────────────────────────────

const DOC_TYPES = [
  { key: "invoice",     label: "Invoice",            description: "Standard tax invoices sent to clients" },
  { key: "credit_note", label: "Credit Note",         description: "Credit notes / adjustments" },
  { key: "quotation",   label: "Quotation",           description: "Quotes sent before work begins" },
  { key: "proforma",    label: "Proforma Invoice",    description: "Proforma invoices for advance payment" },
  { key: "ledger",      label: "Statement of Account", description: "Outstanding statements of account" },
  { key: "reminder",    label: "Payment Reminder",    description: "Automated overdue payment reminders" },
] as const;

type DocTypeKey = typeof DOC_TYPES[number]["key"];

interface AttachmentSettings {
  [key: string]: boolean;
}

const STORAGE_KEY = "billing_pdf_attachment_settings";

function loadSettings(): AttachmentSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  // Default: all enabled
  const defaults: AttachmentSettings = {};
  DOC_TYPES.forEach(d => { defaults[d.key] = true; });
  return defaults;
}

function AttachmentsSettingsTab({ firmId }: { firmId: string | null }) {
  const { toast } = useToast();
  const [settings, setSettings] = useState<AttachmentSettings>(loadSettings);

  const toggle = (key: DocTypeKey) => {
    setSettings(prev => {
      const next = { ...prev, [key]: !prev[key] };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
    toast({ title: `PDF attachment ${settings[key] ? "disabled" : "enabled"} for ${key}` });
  };

  const enabledCount = Object.values(settings).filter(Boolean).length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold">PDF Attachment Settings</h3>
          <p className="text-sm text-muted-foreground mt-0.5">
            Control which document types automatically attach a PDF when sending by email.
          </p>
        </div>
        <Badge variant="secondary" className="text-xs">
          {enabledCount} of {DOC_TYPES.length} enabled
        </Badge>
      </div>

      {/* How it works */}
      <Card className="border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-950/20">
        <CardHeader className="pb-2 pt-3 px-4">
          <CardTitle className="text-sm font-medium text-blue-700 dark:text-blue-400 flex items-center gap-2">
            <CheckCircle2 size={14} /> How PDF attachment works
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-3 pt-0 space-y-1.5 text-sm text-blue-700 dark:text-blue-300">
          <p>• When you send a document via <strong>Email</strong> (Send to Client, Share dialog, or Bulk Send), the system auto-generates a PDF and attaches it to the email.</p>
          <p>• For <strong>WhatsApp</strong>, the PDF is downloaded to your device and the WhatsApp chat is opened — simply attach the downloaded PDF in WhatsApp.</p>
          <p>• PDFs are generated client-side from the invoice data and never stored on the server.</p>
        </CardContent>
      </Card>

      {/* Toggle cards */}
      <div className="grid gap-3 sm:grid-cols-2">
        {DOC_TYPES.map(dt => (
          <Card key={dt.key} className={`transition-all ${settings[dt.key] ? "" : "opacity-60"}`}>
            <CardContent className="p-4 flex items-center justify-between gap-4">
              <div className="flex items-center gap-3 min-w-0">
                <div className={`p-2 rounded-md shrink-0 ${settings[dt.key] ? "bg-emerald-100 dark:bg-emerald-900/30" : "bg-muted"}`}>
                  <FileText size={16} className={settings[dt.key] ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"} />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium">{dt.label}</p>
                  <p className="text-xs text-muted-foreground truncate">{dt.description}</p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {settings[dt.key] && (
                  <Badge variant="outline" className="text-[10px] border-emerald-300 text-emerald-600 dark:text-emerald-400 hidden sm:flex gap-1">
                    <Paperclip size={9} /> PDF
                  </Badge>
                )}
                <Switch
                  checked={!!settings[dt.key]}
                  onCheckedChange={() => toggle(dt.key as DocTypeKey)}
                  aria-label={`Toggle PDF attachment for ${dt.label}`}
                />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <p className="text-xs text-muted-foreground">
        Settings are stored locally in this browser. The email delivery uses Microsoft Graph API — ensure the sending account has a valid mail licence.
      </p>
    </div>
  );
}

// ─── Main EmailSettingsTab ──────────────────────────────────────────────────

export default function EmailSettingsTab({
  firmId,
  userId,
}: {
  firmId: string | null;
  userId: string | null;
}) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Email Settings</h2>
        <p className="text-sm text-muted-foreground">
          Manage email templates, PDF attachments, sent history, and automated reminders.
        </p>
      </div>
      <Tabs defaultValue="templates">
        <TabsList>
          <TabsTrigger value="templates" className="gap-1.5">
            <Mail size={13} /> Templates
          </TabsTrigger>
          <TabsTrigger value="attachments" className="gap-1.5">
            <Paperclip size={13} /> Attachments
          </TabsTrigger>
          <TabsTrigger value="log" className="gap-1.5">
            <History size={13} /> Email Log
          </TabsTrigger>
          <TabsTrigger value="reminders" className="gap-1.5">
            <Bell size={13} /> Reminders
          </TabsTrigger>
        </TabsList>
        <TabsContent value="templates" className="mt-4">
          <EmailTemplatesTab firmId={firmId} />
        </TabsContent>
        <TabsContent value="attachments" className="mt-4">
          <AttachmentsSettingsTab firmId={firmId} />
        </TabsContent>
        <TabsContent value="log" className="mt-4">
          <EmailLogTab firmId={firmId} />
        </TabsContent>
        <TabsContent value="reminders" className="mt-4">
          <BillingRemindersTab firmId={firmId} userId={userId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
