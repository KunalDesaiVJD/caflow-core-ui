import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { cn } from "@/lib/utils";
import { BellPlus, CalendarClock, Loader2, Repeat, Send } from "lucide-react";
import { buildTdsEmailHtml } from "@/lib/tdsEmailTemplate";
import { TDS_FIRM, renderTemplate } from "@/lib/tdsReminders";
import { getDefaultTdsQuarter } from "@/lib/tdsQuarter";

const TEMPLATE_KEY = "reminder_custom";
// Used only if the template row is missing (migration not applied yet).
const FALLBACK = {
  subject: "Reminder: TDS data required — {{form_type}} {{quarter}} FY {{financial_year}} | {{client_name}}",
  body: "This is a reminder that we are awaiting your TDS data to prepare and file your {{form_type}} return for {{quarter}} FY {{financial_year}}.\n\nKindly share the deductee-wise payment details, challan details and any other relevant records at the earliest. If you have already sent these, please treat this note as acknowledged.",
};

const FORMS = ["26Q", "24Q", "27Q", "27EQ"];
const QUARTERS = ["Q1", "Q2", "Q3", "Q4"];
const FY_OPTIONS = (() => {
  const thisFy = Number(getDefaultTdsQuarter().fy.slice(0, 4));
  return Array.from({ length: 5 }, (_, i) => { const s = thisFy + 1 - i; return `${s}-${String(s + 1).slice(2)}`; });
})();

const EMAIL_RE = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;
const addrList = (s: string) => s.split(/[,;]/).map((a) => a.trim()).filter(Boolean);
const addrsValid = (s: string) => addrList(s).every((a) => EMAIL_RE.test(a));

/** Local "YYYY-MM-DDTHH:mm" for <input type="datetime-local">. */
const toLocalInput = (d: Date) => format(d, "yyyy-MM-dd'T'HH:mm");

type When = "now" | "once" | "recurring";

interface ClientRow { id: string; name: string | null; email: string | null; contact_person: string | null; tan_number: string | null }

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pre-select a client / return (e.g. from the TDS Workspace). All editable. */
  defaultClientId?: string;
  defaultFormType?: string;
  defaultQuarter?: string;
  defaultFinancialYear?: string;
  onSaved?: () => void;
}

/**
 * Custom TDS data reminder — send a reminder to ANY client right now, once on
 * a chosen date/time, or repeatedly every N days. Independent of the fixed
 * quarterly calendar (queue-tds-reminders) and of the per-client on/off
 * switch. Every option creates a row in tds_custom_reminders; the
 * queue-tds-custom-reminders edge function turns due rows into outbox emails
 * (immediately for "now", hourly otherwise).
 */
export function TdsCustomReminderDialog({
  open, onOpenChange, defaultClientId, defaultFormType, defaultQuarter, defaultFinancialYear, onSaved,
}: Props) {
  const { user } = useAuth();
  const { toast } = useToast();

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [clientId, setClientId] = useState("");
  const [formType, setFormType] = useState("26Q");
  const [fy, setFy] = useState("");
  const [quarter, setQuarter] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [to, setTo] = useState("");
  const [cc, setCc] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [when, setWhen] = useState<When>("now");
  const [runAt, setRunAt] = useState("");
  const [intervalDays, setIntervalDays] = useState("3");
  const [endDate, setEndDate] = useState("");
  const [maxSends, setMaxSends] = useState("");
  const [firstNow, setFirstNow] = useState(true);
  const [stopWhenStarted, setStopWhenStarted] = useState(true);

  // Reset every time the dialog opens.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [{ data: cs }, { data: tpl }] = await Promise.all([
        supabase.from("clients").select("id, name, email, contact_person, tan_number").order("name"),
        supabase.from("tds_email_templates" as any).select("subject, body").eq("key", TEMPLATE_KEY).maybeSingle(),
      ]);
      if (cancelled) return;
      const def = getDefaultTdsQuarter();
      const t = (tpl as any) ?? FALLBACK;
      setClients((cs ?? []) as ClientRow[]);
      setClientId(defaultClientId ?? "");
      setFormType(defaultFormType || "26Q");
      setFy(defaultFinancialYear || def.fy);
      setQuarter(defaultQuarter || def.quarter);
      setDueDate("");
      setCc("");
      setSubject(t.subject);
      setMessage(t.body);
      setWhen("now");
      const tomorrow10 = new Date(); tomorrow10.setDate(tomorrow10.getDate() + 1); tomorrow10.setHours(10, 0, 0, 0);
      setRunAt(toLocalInput(tomorrow10));
      setIntervalDays("3");
      setEndDate("");
      setMaxSends("");
      setFirstNow(true);
      setStopWhenStarted(true);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [open, defaultClientId, defaultFormType, defaultQuarter, defaultFinancialYear]);

  const client = useMemo(() => clients.find((c) => c.id === clientId) ?? null, [clients, clientId]);

  // Picking a client fills the To address from the client master.
  useEffect(() => { setTo(client?.email ?? ""); }, [client]);

  const clientOptions = useMemo(
    () => clients.map((c) => ({ value: c.id, label: `${c.name ?? "—"}${c.tan_number ? ` · ${c.tan_number}` : ""}` })),
    [clients],
  );

  const staffName = user?.name ? `${user.name}, ${TDS_FIRM.team}` : TDS_FIRM.team;

  const vars = useMemo<Record<string, string>>(() => ({
    contact_person: client?.contact_person || client?.name || "",
    client_name: client?.name || "",
    tan: client?.tan_number ?? "",
    form_type: formType,
    quarter,
    financial_year: fy,
    due_date: dueDate ? format(new Date(`${dueDate}T00:00:00`), "dd MMM yyyy") : "",
    staff_name: staffName,
    firm_name: TDS_FIRM.name,
    firm_email: TDS_FIRM.email,
    firm_phone: TDS_FIRM.phone,
  }), [client, formType, quarter, fy, dueDate, staffName]);

  const previewHtml = useMemo(
    () => buildTdsEmailHtml({ key: TEMPLATE_KEY, kind: "reminder", message: renderTemplate(message, vars), vars }),
    [message, vars],
  );

  const interval = Number(intervalDays);
  const max = maxSends.trim() ? Number(maxSends) : null;
  const startsNow = when === "now" || (when === "recurring" && firstNow);
  const startAt = startsNow ? new Date() : runAt ? new Date(runAt) : null;

  const problem =
    !clientId ? "Pick a client."
    : !to.trim() ? "Enter the client's email address."
    : !addrsValid(to) ? "One of the To addresses doesn't look like an email address."
    : cc.trim() && !addrsValid(cc) ? "One of the CC addresses doesn't look like an email address."
    : !subject.trim() ? "Enter a subject."
    : !message.trim() ? "Enter a message."
    : !startsNow && (!startAt || isNaN(startAt.getTime())) ? "Pick the date and time to send."
    : !startsNow && startAt && startAt.getTime() < Date.now() - 60_000 ? "The send time is in the past."
    : when === "recurring" && (!Number.isInteger(interval) || interval < 1 || interval > 365) ? "Repeat interval must be 1–365 days."
    : when === "recurring" && max !== null && (!Number.isInteger(max) || max < 1) ? "Maximum reminders must be a whole number ≥ 1."
    : when === "recurring" && !endDate && max === null && !stopWhenStarted ? "Set an end date, a maximum count, or 'stop when work starts' so the reminders don't run forever."
    : when === "recurring" && endDate && startAt && new Date(`${endDate}T23:59:59`) < startAt ? "End date is before the first reminder."
    : null;

  const scheduleSummary =
    when === "now" ? "Sent immediately."
    : when === "once" ? (startAt && !isNaN(startAt.getTime()) ? `Sent once on ${format(startAt, "dd MMM yyyy, HH:mm")}.` : "")
    : `Every ${interval || "?"} day${interval === 1 ? "" : "s"} starting ${startsNow ? "now" : startAt && !isNaN(startAt.getTime()) ? format(startAt, "dd MMM yyyy, HH:mm") : "…"}`
      + [endDate && ` until ${format(new Date(`${endDate}T00:00:00`), "dd MMM yyyy")}`, max && `, at most ${max} reminder${max === 1 ? "" : "s"}`].filter(Boolean).join("")
      + (stopWhenStarted ? "; stops automatically once work on this return starts." : ".");

  async function save() {
    if (problem || saving || !startAt) return;
    setSaving(true);
    try {
      const { data: row, error } = await supabase.from("tds_custom_reminders" as any).insert({
        client_id: clientId,
        to_email: addrList(to).join(", "),
        cc_email: cc.trim() ? addrList(cc).join(", ") : null,
        form_type: formType,
        financial_year: fy,
        quarter,
        due_date: dueDate || null,
        subject: subject.trim(),
        body: message,
        schedule_type: when === "recurring" ? "recurring" : "once",
        next_run_at: startAt.toISOString(),
        interval_days: when === "recurring" ? interval : null,
        end_date: when === "recurring" && endDate ? endDate : null,
        max_sends: when === "recurring" ? max : null,
        stop_when_started: stopWhenStarted,
        staff_name: staffName,
        created_by: user?.id ?? null,
      }).select("id").single();
      if (error) throw error;
      const id = (row as any).id as string;

      if (startsNow) {
        const { data: res, error: fnErr } = await supabase.functions.invoke("queue-tds-custom-reminders", { body: { id } });
        const r = (res ?? {}) as { queued?: number; sent?: number; completed?: number; errors?: { error: string }[] };
        if (fnErr || r.errors?.length) {
          toast({ title: "Reminder not sent", description: fnErr?.message ?? r.errors?.[0]?.error, variant: "destructive" });
          return;
        }
        if (!r.queued && r.completed) {
          toast({ title: "Reminder not sent", description: "Work on this return has already started, so the reminder was stopped. Untick 'stop when work starts' to send anyway." });
        } else if (r.sent) {
          toast({ title: "Reminder sent", description: `Sent to ${addrList(to).join(", ")} from ${TDS_FIRM.email}.${when === "recurring" ? ` Next one in ${interval} day${interval === 1 ? "" : "s"}.` : ""}` });
        } else {
          toast({ title: "Reminder queued", description: "It will go out on the next hourly run — see the Email outbox." });
        }
      } else {
        toast({ title: "Reminder scheduled", description: scheduleSummary });
      }
      onSaved?.();
      onOpenChange(false);
    } catch (e) {
      toast({ title: "Could not save reminder", description: (e as Error).message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!saving) onOpenChange(o); }}>
      <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><BellPlus className="h-5 w-5 text-primary" /> Custom TDS data reminder</DialogTitle>
          <DialogDescription>
            Ask any client for their TDS data — right now, on a date you choose, or on a repeating schedule. Sent from {TDS_FIRM.email}.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-16"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : (
          <Tabs defaultValue="compose" className="w-full">
            <TabsList className="h-8">
              <TabsTrigger value="compose" className="text-xs">Compose</TabsTrigger>
              <TabsTrigger value="preview" className="text-xs">Preview</TabsTrigger>
            </TabsList>

            <TabsContent value="compose" className="space-y-4 mt-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5 sm:col-span-2">
                  <Label>Client</Label>
                  <SearchableSelect options={clientOptions} value={clientId} onValueChange={setClientId}
                    placeholder="Select a client…" searchPlaceholder="Search by name or TAN…" className="w-full" />
                </div>
                <div className="grid grid-cols-3 gap-2 sm:col-span-2 sm:grid-cols-4">
                  <div className="space-y-1.5">
                    <Label>Form</Label>
                    <Select value={formType} onValueChange={setFormType}>
                      <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                      <SelectContent>{FORMS.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Quarter</Label>
                    <Select value={quarter} onValueChange={setQuarter}>
                      <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                      <SelectContent>{QUARTERS.map((q) => <SelectItem key={q} value={q}>{q}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>FY</Label>
                    <Select value={fy} onValueChange={setFy}>
                      <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                      <SelectContent>{[...new Set([fy, ...FY_OPTIONS])].filter(Boolean).map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5 col-span-3 sm:col-span-1">
                    <Label htmlFor="tds-cr-due">Data needed by <span className="font-normal text-muted-foreground">(opt.)</span></Label>
                    <Input id="tds-cr-due" type="date" className="h-9" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="tds-cr-to">To</Label>
                  <Input id="tds-cr-to" value={to} onChange={(e) => setTo(e.target.value)} placeholder="client@example.com" />
                  {client && !client.email && <p className="text-[11px] text-amber-600">No email on the client master — type one here.</p>}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="tds-cr-cc">CC <span className="font-normal text-muted-foreground">(optional, comma-separated)</span></Label>
                  <Input id="tds-cr-cc" value={cc} onChange={(e) => setCc(e.target.value)} placeholder="accounts@example.com" />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="tds-cr-subject">Subject</Label>
                  <Input id="tds-cr-subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="tds-cr-msg">Message</Label>
                  <Textarea id="tds-cr-msg" value={message} onChange={(e) => setMessage(e.target.value)} rows={5} className="text-[13px] leading-relaxed" />
                  <p className="text-[11px] text-muted-foreground">
                    Variables such as <code>{"{{client_name}}"}</code>, <code>{"{{form_type}}"}</code>, <code>{"{{quarter}}"}</code>, <code>{"{{financial_year}}"}</code> and <code>{"{{due_date}}"}</code> are filled in when each reminder is sent. Greeting, details box and signature are added automatically.
                  </p>
                </div>
              </div>

              <div className="space-y-3 rounded-md border p-3">
                <p className="text-sm font-medium">When to send</p>
                <RadioGroup value={when} onValueChange={(v) => setWhen(v as When)} className="grid gap-2 sm:grid-cols-3">
                  {([
                    ["now", "Send now", Send],
                    ["once", "Once, on a date", CalendarClock],
                    ["recurring", "Repeat every N days", Repeat],
                  ] as const).map(([v, label, Icon]) => (
                    <label key={v} className={cn("flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm", when === v && "border-primary bg-primary/5")}>
                      <RadioGroupItem value={v} /> <Icon className="h-4 w-4 text-muted-foreground" /> {label}
                    </label>
                  ))}
                </RadioGroup>

                {when === "once" && (
                  <div className="space-y-1.5 max-w-xs">
                    <Label htmlFor="tds-cr-at">Send on</Label>
                    <Input id="tds-cr-at" type="datetime-local" value={runAt} onChange={(e) => setRunAt(e.target.value)} />
                  </div>
                )}

                {when === "recurring" && (
                  <div className="space-y-3">
                    <label className="flex items-center gap-2 text-sm">
                      <Checkbox checked={firstNow} onCheckedChange={(v) => setFirstNow(v === true)} /> Send the first reminder right now
                    </label>
                    <div className="grid gap-3 sm:grid-cols-4">
                      {!firstNow && (
                        <div className="space-y-1.5 sm:col-span-2">
                          <Label htmlFor="tds-cr-start">First reminder on</Label>
                          <Input id="tds-cr-start" type="datetime-local" value={runAt} onChange={(e) => setRunAt(e.target.value)} />
                        </div>
                      )}
                      <div className="space-y-1.5">
                        <Label htmlFor="tds-cr-int">Every (days)</Label>
                        <Input id="tds-cr-int" type="number" min={1} max={365} value={intervalDays} onChange={(e) => setIntervalDays(e.target.value)} />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="tds-cr-max">Max reminders <span className="font-normal text-muted-foreground">(opt.)</span></Label>
                        <Input id="tds-cr-max" type="number" min={1} value={maxSends} onChange={(e) => setMaxSends(e.target.value)} placeholder="No limit" />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="tds-cr-end">Until <span className="font-normal text-muted-foreground">(opt.)</span></Label>
                        <Input id="tds-cr-end" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
                      </div>
                    </div>
                  </div>
                )}

                <label className="flex items-start gap-2 text-sm">
                  <Checkbox className="mt-0.5" checked={stopWhenStarted} onCheckedChange={(v) => setStopWhenStarted(v === true)} />
                  <span>
                    Stop automatically once work on this return starts
                    <span className="block text-xs text-muted-foreground">Skips sending when the {quarter} FY {fy} filing is no longer "Not Started" (i.e. data received).</span>
                  </span>
                </label>

                {scheduleSummary && <p className="text-xs text-muted-foreground">{scheduleSummary}</p>}
              </div>
            </TabsContent>

            <TabsContent value="preview" className="mt-3 space-y-2">
              <div className="text-xs space-y-0.5">
                <p><span className="text-muted-foreground">To:</span> {addrList(to).join(", ") || "—"}{cc.trim() && <><span className="text-muted-foreground"> · CC:</span> {addrList(cc).join(", ")}</>}</p>
                <p><span className="text-muted-foreground">Subject:</span> <b>{renderTemplate(subject, vars)}</b></p>
              </div>
              <iframe title="Reminder email preview" srcDoc={previewHtml} sandbox="" className="w-full rounded-md border bg-white" style={{ height: 560 }} />
            </TabsContent>
          </Tabs>
        )}

        <DialogFooter className="items-center gap-2 sm:justify-between">
          <p className="text-xs text-destructive">{!loading && problem}</p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
            <Button onClick={save} disabled={!!problem || saving || loading} className="gap-1.5">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : startsNow ? <Send className="h-4 w-4" /> : <CalendarClock className="h-4 w-4" />}
              {when === "now" ? "Send reminder" : when === "once" ? "Schedule reminder" : startsNow ? "Send & schedule" : "Schedule reminders"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
