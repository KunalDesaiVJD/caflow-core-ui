/**
 * EmailComposeDialog
 *
 * Reusable modal for composing and sending audit emails.
 * Features:
 *   - 6 pre-built template types (Commencement, Document Request, Query Dispatch,
 *     Reminder, Draft Report, Final Report)
 *   - Live preview of the branded HTML email
 *   - Editable subject, recipient, and custom message fields
 *   - Sends via `send-notification` edge function (custom_html path)
 *   - Logs to `audit_query_dispatch_log` when engagementId is supplied
 */
import { useState, useEffect } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button }   from "@/components/ui/button";
import { Input }    from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge }    from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, Mail, Eye, Send, Users, Info } from "lucide-react";
import { toast }    from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth }  from "@/hooks/useAuth";
import {
  AuditEmailType,
  AUDIT_EMAIL_LABELS,
  AuditQueryRow,
  buildAuditEmailHtml,
  buildAuditEmailSubject,
} from "./EmailTemplateEngine";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface EmailComposePayload {
  templateType:   AuditEmailType;
  clientName:     string;
  clientEmail:    string;
  firmName:       string;
  firmId:         string;
  clientId:       string;
  engagementId?:  string;
  financialYear?: string;
  portalUrl?:     string;
  queries?:       AuditQueryRow[];
}

interface Props {
  open:           boolean;
  onClose:        () => void;
  defaultPayload: EmailComposePayload;
  onSent?:        () => void;
}

// ─── Template order for selector ─────────────────────────────────────────────

const TEMPLATE_TYPES: AuditEmailType[] = [
  "audit_commencement",
  "audit_document_request",
  "audit_query_dispatch",
  "audit_query_reminder",
  "audit_draft_report",
  "audit_final_report",
];

// ─── Component ────────────────────────────────────────────────────────────────

export function EmailComposeDialog({ open, onClose, defaultPayload, onSent }: Props) {
  const { user } = useAuth();

  const [type,          setType]          = useState<AuditEmailType>(defaultPayload.templateType);
  const [subject,       setSubject]       = useState("");
  const [toEmail,       setToEmail]       = useState(defaultPayload.clientEmail || "");
  const [customMessage, setCustomMessage] = useState("");
  const [deadlineDate,  setDeadlineDate]  = useState("");
  const [sending,       setSending]       = useState(false);
  const [tab,           setTab]           = useState<"compose"|"preview">("compose");

  // ── Reset when dialog opens ──────────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    setType(defaultPayload.templateType);
    setToEmail(defaultPayload.clientEmail || "");
    setSubject(buildAuditEmailSubject(defaultPayload.templateType, defaultPayload.financialYear));
    setCustomMessage("");
    setDeadlineDate("");
    setTab("compose");
  }, [open, defaultPayload.templateType, defaultPayload.clientEmail, defaultPayload.financialYear]);

  const handleTypeChange = (t: AuditEmailType) => {
    setType(t);
    setSubject(buildAuditEmailSubject(t, defaultPayload.financialYear));
  };

  // ── Build preview HTML ───────────────────────────────────────────────
  const previewHtml = buildAuditEmailHtml(type, {
    clientName:     defaultPayload.clientName,
    firmName:       defaultPayload.firmName,
    financialYear:  defaultPayload.financialYear,
    portalUrl:      defaultPayload.portalUrl,
    queries:        defaultPayload.queries,
    customMessage:  customMessage.trim() || undefined,
    deadlineDate:   deadlineDate || undefined,
    signatoryName:  user?.name,
  });

  // ── Send ─────────────────────────────────────────────────────────────
  const send = async () => {
    if (!toEmail.trim()) {
      toast.error("Recipient email is required");
      return;
    }
    setSending(true);
    try {
      const { error } = await supabase.functions.invoke("send-notification", {
        body: {
          type,
          firm_id:        defaultPayload.firmId,
          client_id:      defaultPayload.clientId,
          send_to_client: false,   // we use direct_email path
          direct_email:   toEmail.trim(),
          payload: {
            client_name:     defaultPayload.clientName,
            firm_name:       defaultPayload.firmName,
            custom_subject:  subject,
            custom_html:     previewHtml,
          },
        },
      });
      if (error) throw error;

      // Log the dispatch
      if (defaultPayload.engagementId) {
        await (supabase as any)
          .from("audit_query_dispatch_log")
          .insert({
            firm_id:       defaultPayload.firmId,
            client_id:     defaultPayload.clientId,
            engagement_id: defaultPayload.engagementId,
            channel:       "email",
            subject,
            body:          previewHtml,
            template_used: type,
            query_ids:     (defaultPayload.queries ?? [])
              .map((q: any) => q.id)
              .filter(Boolean),
            dispatch_ref:  `DISP-${Date.now()}`,
            dispatched_by: user?.id ?? null,
            dispatched_at: new Date().toISOString(),
          });
      }

      toast.success(`Email sent to ${toEmail.trim()}`);
      onSent?.();
      onClose();
    } catch (err: any) {
      toast.error(err.message || "Failed to send email");
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-2xl flex flex-col max-h-[90vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Mail size={16}/> Compose Audit Email
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-3 pr-1 py-1">
          {/* Row 1: Template + Recipient */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium mb-1 block">Template</label>
              <Select value={type} onValueChange={v => handleTypeChange(v as AuditEmailType)}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TEMPLATE_TYPES.map(t => (
                    <SelectItem key={t} value={t} className="text-xs">
                      {AUDIT_EMAIL_LABELS[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium mb-1 block flex items-center gap-1">
                <Users size={11}/> To (recipient email)
              </label>
              <Input
                value={toEmail}
                onChange={e => setToEmail(e.target.value)}
                placeholder="client@example.com"
                className="h-8 text-xs"
                type="email"
              />
            </div>
          </div>

          {/* Row 2: Subject */}
          <div>
            <label className="text-xs font-medium mb-1 block">Subject</label>
            <Input
              value={subject}
              onChange={e => setSubject(e.target.value)}
              className="h-8 text-xs"
            />
          </div>

          {/* Row 3: Deadline (shown for dispatch/reminder/document request) */}
          {["audit_query_dispatch","audit_query_reminder","audit_document_request"].includes(type) && (
            <div className="max-w-xs">
              <label className="text-xs font-medium mb-1 block">Response deadline (optional)</label>
              <Input
                type="date"
                value={deadlineDate}
                onChange={e => setDeadlineDate(e.target.value)}
                className="h-8 text-xs"
              />
            </div>
          )}

          {/* Row 4: Included queries badge */}
          {(defaultPayload.queries?.length ?? 0) > 0 && (
            <div className="flex items-center gap-2 p-2 bg-blue-50 border border-blue-200 rounded-lg">
              <Info size={13} className="text-blue-600 flex-shrink-0"/>
              <p className="text-xs text-blue-700">
                <strong>{defaultPayload.queries!.length}</strong> quer{defaultPayload.queries!.length === 1 ? "y" : "ies"} will be included as a table in the email.
              </p>
            </div>
          )}

          {/* Row 5: Compose / Preview tabs */}
          <Tabs value={tab} onValueChange={v => setTab(v as "compose"|"preview")}>
            <TabsList className="h-8">
              <TabsTrigger value="compose" className="text-xs gap-1"><Mail size={11}/>Compose</TabsTrigger>
              <TabsTrigger value="preview" className="text-xs gap-1"><Eye size={11}/>Preview</TabsTrigger>
            </TabsList>

            <TabsContent value="compose" className="mt-2">
              <label className="text-xs font-medium mb-1 block text-muted-foreground">
                Additional message (optional — personalised note added inside the email)
              </label>
              <Textarea
                value={customMessage}
                onChange={e => setCustomMessage(e.target.value)}
                placeholder="Add any specific instructions, notes, or a personalised message here…"
                rows={4}
                className="text-sm resize-none"
              />
              {defaultPayload.portalUrl && (
                <p className="text-xs text-green-700 mt-1.5 flex items-center gap-1">
                  ✓ Client portal link included
                </p>
              )}
            </TabsContent>

            <TabsContent value="preview" className="mt-2">
              <div className="border rounded-lg overflow-hidden bg-white">
                <div className="text-xs text-muted-foreground px-3 py-1.5 bg-muted border-b flex items-center gap-2">
                  <Eye size={11}/> Email preview
                  <Badge variant="outline" className="text-[10px] h-4">{AUDIT_EMAIL_LABELS[type]}</Badge>
                </div>
                <iframe
                  srcDoc={previewHtml}
                  title="Email Preview"
                  className="w-full"
                  style={{ height: "360px", border: "none" }}
                  sandbox=""
                />
              </div>
            </TabsContent>
          </Tabs>
        </div>

        <DialogFooter className="pt-3 border-t">
          <Button variant="outline" size="sm" onClick={onClose} disabled={sending}>
            Cancel
          </Button>
          <Button size="sm" onClick={send} disabled={sending || !toEmail.trim()} className="gap-1">
            {sending ? <Loader2 size={13} className="animate-spin"/> : <Send size={13}/>}
            Send Email
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
