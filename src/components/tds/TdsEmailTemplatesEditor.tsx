import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Save, Bell, CheckCircle2, MessageSquareWarning } from "lucide-react";
import { cn } from "@/lib/utils";
import { buildTdsEmailHtml } from "@/lib/tdsEmailTemplate";

interface Tpl {
  key: string;
  name: string;
  kind: "reminder" | "confirmation" | "query";
  step: number | null;
  subject: string;
  body: string;
  is_active: boolean;
  sort_order: number;
}

// Variables available in every template + representative sample values for the
// live preview. Keep in sync with what queue-tds-reminders / enqueueConfirmation
// fill at send time.
const VARS = [
  "contact_person", "client_name", "tan", "form_type", "quarter", "financial_year",
  "due_date", "ack_no", "filing_date", "staff_name", "firm_name", "firm_email", "firm_phone",
  "reply_by", "query_count",
];
const SAMPLE: Record<string, string> = {
  contact_person: "Rajesh Shah",
  client_name: "ABC Enterprises Pvt Ltd",
  tan: "AHMA13819B",
  form_type: "26Q",
  quarter: "Q1",
  financial_year: "2026-27",
  due_date: "31 Jul 2026",
  ack_no: "334899600554750",
  filing_date: "28 Jul 2026",
  staff_name: "TDS Team",
  firm_name: "V. J. Desai & Co. LLP",
  firm_email: "tds@vjdesai.com",
  firm_phone: "+91 265 000 0000",
  reply_by: "05 Aug 2026",
  query_count: "2",
};
// Client-query template only: the table of points the staff picks in the
// Workspace's "Email client" dialog.
const SAMPLE_QUERIES = [
  { record: "Ramesh Traders (AAAPR1234C)", query: "TDS Amount: our records 12,500, your data 15,000. Please confirm the correct value." },
  { record: "Challan 00123 dt 07/07/2026 · ₹48,200", query: "This challan could not be traced in the Income Tax portal payment history. Please share the challan copy." },
];
const renderPreview = (s: string) => s.replace(/\{\{(\w+)\}\}/g, (_m, k) => SAMPLE[k] ?? `{{${k}}}`);

export function TdsEmailTemplatesEditor() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [templates, setTemplates] = useState<Tpl[]>([]);
  const [selKey, setSelKey] = useState<string>("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  async function load() {
    setLoading(true);
    const { data, error } = await supabase.from("tds_email_templates" as any).select("*").order("sort_order");
    if (error) { toast({ title: "Failed to load templates", description: error.message, variant: "destructive" }); setLoading(false); return; }
    const rows = (data ?? []) as Tpl[];
    setTemplates(rows);
    const first = rows.find(r => r.key === selKey) ?? rows[0];
    if (first) { setSelKey(first.key); setSubject(first.subject); setBody(first.body); }
    setLoading(false);
  }

  function pick(t: Tpl) {
    setSelKey(t.key);
    setSubject(t.subject);
    setBody(t.body);
  }

  const current = templates.find(t => t.key === selKey);
  const dirty = !!current && (current.subject !== subject || current.body !== body);

  function insertVar(v: string) {
    const token = `{{${v}}}`;
    const el = bodyRef.current;
    if (!el) { setBody(b => b + token); return; }
    const start = el.selectionStart ?? body.length;
    const end = el.selectionEnd ?? body.length;
    setBody(body.slice(0, start) + token + body.slice(end));
    requestAnimationFrame(() => { el.focus(); const p = start + token.length; el.setSelectionRange(p, p); });
  }

  async function save() {
    if (!current) return;
    setSaving(true);
    const { error } = await supabase
      .from("tds_email_templates" as any)
      .update({ subject, body, updated_by: (user as any)?.id ?? null })
      .eq("key", selKey);
    setSaving(false);
    if (error) { toast({ title: "Save failed", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Template saved" });
    setTemplates(ts => ts.map(t => (t.key === selKey ? { ...t, subject, body } : t)));
  }

  if (loading) {
    return <div className="flex items-center justify-center py-16"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  }

  const reminders = templates.filter(t => t.kind === "reminder");
  const confirmations = templates.filter(t => t.kind === "confirmation");
  const queries = templates.filter(t => t.kind === "query");

  const listItem = (t: Tpl) => (
    <button
      key={t.key}
      type="button"
      onClick={() => pick(t)}
      className={cn(
        "w-full text-left rounded-md border px-3 py-2 text-sm transition-colors",
        t.key === selKey ? "border-primary bg-primary/5 font-medium" : "border-border hover:bg-muted",
      )}
    >
      <span className="flex items-center justify-between gap-2">
        <span>{t.name}</span>
        {t.key === selKey && dirty && <span className="h-2 w-2 rounded-full bg-amber-500" title="Unsaved changes" />}
      </span>
    </button>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>TDS email templates</CardTitle>
        <CardDescription>
          The copy used for data reminders, filing confirmations and client query emails, sent from tds@vjdesai.com.
          Edit the wording freely — <code className="text-xs">{"{{variables}}"}</code> are filled in automatically per client and filing.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-6 md:grid-cols-[240px_1fr]">
          {/* Template list */}
          <div className="space-y-4">
            <div className="space-y-1.5">
              <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground"><Bell className="h-3.5 w-3.5" /> Reminders</p>
              <div className="space-y-1.5">{reminders.map(listItem)}</div>
            </div>
            <div className="space-y-1.5">
              <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground"><CheckCircle2 className="h-3.5 w-3.5" /> Confirmations</p>
              <div className="space-y-1.5">{confirmations.map(listItem)}</div>
            </div>
            {queries.length > 0 && (
              <div className="space-y-1.5">
                <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground"><MessageSquareWarning className="h-3.5 w-3.5" /> Client queries</p>
                <div className="space-y-1.5">{queries.map(listItem)}</div>
              </div>
            )}
          </div>

          {/* Editor */}
          {current && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="tds-tpl-subject">Subject</Label>
                <Input id="tds-tpl-subject" value={subject} onChange={e => setSubject(e.target.value)} />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="tds-tpl-body">Message</Label>
                <p className="text-xs text-muted-foreground">Just the wording. The letterhead, details box, signature and colours are added automatically — you can't break the layout. Leave a blank line between paragraphs.</p>
                <Textarea id="tds-tpl-body" ref={bodyRef} value={body} onChange={e => setBody(e.target.value)} rows={9} className="text-[13px] leading-relaxed" />
              </div>

              <div className="space-y-1.5">
                <p className="text-xs text-muted-foreground">Click a variable to insert it into the body at the cursor:</p>
                <div className="flex flex-wrap gap-1.5">
                  {VARS.map(v => (
                    <button key={v} type="button" onClick={() => insertVar(v)}>
                      <Badge variant="secondary" className="cursor-pointer hover:bg-primary/10 font-mono text-[11px]">{`{{${v}}}`}</Badge>
                    </button>
                  ))}
                </div>
              </div>

              {/* Live preview — rendered HTML in a sandboxed iframe */}
              <div className="rounded-lg border bg-muted/30 p-4">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Preview (sample data)</p>
                <p className="text-xs text-muted-foreground">Subject</p>
                <p className="mb-3 text-sm font-medium">{renderPreview(subject)}</p>
                <iframe
                  title="Email preview"
                  srcDoc={buildTdsEmailHtml({ key: selKey, kind: current.kind, message: renderPreview(body), vars: current.kind === "query" ? { ...SAMPLE, query_items: SAMPLE_QUERIES } : SAMPLE })}
                  sandbox=""
                  className="w-full rounded-md border bg-white"
                  style={{ height: 620 }}
                />
              </div>

              <div className="flex items-center justify-end gap-2">
                {dirty && <span className="text-xs text-amber-600">Unsaved changes</span>}
                <Button onClick={save} disabled={saving || !dirty} className="gap-1.5">
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  Save template
                </Button>
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
