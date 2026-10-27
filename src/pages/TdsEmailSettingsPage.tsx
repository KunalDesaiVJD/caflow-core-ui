import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { TdsEmailTemplatesEditor } from "@/components/tds/TdsEmailTemplatesEditor";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { BellRing, Send, RefreshCw, Loader2, Mail, Clock, CheckCircle2, XCircle, Ban, MessageSquareWarning } from "lucide-react";

type OutboxStatus = "pending" | "sending" | "sent" | "failed" | "skipped" | "cancelled";

interface OutboxRow {
  id: string;
  client_id: string;
  to_email: string;
  kind: "reminder" | "confirmation" | "query";
  form_type: string | null;
  financial_year: string | null;
  quarter: string | null;
  subject: string;
  status: OutboxStatus;
  error: string | null;
  reminder_step: number | null;
  created_at: string;
  sent_at: string | null;
}

const fmtWhen = (iso: string | null): string => {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

const STATUS_META: Record<OutboxStatus, { label: string; className: string; icon: JSX.Element }> = {
  pending: { label: "Queued", className: "bg-amber-100 text-amber-800 border-amber-200", icon: <Clock className="h-3 w-3" /> },
  sending: { label: "Sending", className: "bg-amber-100 text-amber-800 border-amber-200", icon: <Loader2 className="h-3 w-3 animate-spin" /> },
  sent: { label: "Sent", className: "bg-emerald-100 text-emerald-800 border-emerald-200", icon: <CheckCircle2 className="h-3 w-3" /> },
  failed: { label: "Failed", className: "bg-red-100 text-red-800 border-red-200", icon: <XCircle className="h-3 w-3" /> },
  skipped: { label: "Skipped", className: "bg-slate-100 text-slate-600 border-slate-200", icon: <Ban className="h-3 w-3" /> },
  cancelled: { label: "Cancelled", className: "bg-slate-100 text-slate-600 border-slate-200", icon: <Ban className="h-3 w-3" /> },
};

const FILTERS = ["all", "pending", "sent", "failed"] as const;
type FilterKey = (typeof FILTERS)[number];

export function TdsEmailSettingsPage() {
  const { user } = useAuth();
  const { toast } = useToast();

  const [rows, setRows] = useState<OutboxRow[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [queueing, setQueueing] = useState(false);
  const [sending, setSending] = useState(false);
  const [filter, setFilter] = useState<FilterKey>("all");

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: outbox }, { data: clients }] = await Promise.all([
      supabase
        .from("tds_email_outbox" as any)
        .select("id, client_id, to_email, kind, form_type, financial_year, quarter, subject, status, error, reminder_step, created_at, sent_at")
        .order("created_at", { ascending: false })
        .limit(400),
      supabase.from("clients").select("id, name"),
    ]);
    setRows(((outbox ?? []) as unknown) as OutboxRow[]);
    setNames(Object.fromEntries((clients ?? []).map((c) => [c.id as string, c.name as string])));
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const queueDue = async () => {
    setQueueing(true);
    const { data, error } = await supabase.functions.invoke("queue-tds-reminders", {
      body: { staffName: (user as any)?.name ?? (user as any)?.firstName ?? null },
    });
    setQueueing(false);
    if (error) { toast({ title: "Queue failed", description: error.message, variant: "destructive" }); return; }
    const r = (data ?? {}) as { queued?: number; skipped?: number; note?: string };
    if ((r.queued ?? 0) > 0) toast({ title: `Queued ${r.queued} reminder${r.queued === 1 ? "" : "s"}` });
    else toast({ title: "No reminders due today", description: r.note });
    void load();
  };

  const sendNow = async () => {
    setSending(true);
    const { data, error } = await supabase.functions.invoke("send-tds-email", { body: {} });
    setSending(false);
    if (error) { toast({ title: "Send failed", description: error.message, variant: "destructive" }); return; }
    const r = (data ?? {}) as { sent?: number; failed?: number };
    if ((r.sent ?? 0) === 0 && (r.failed ?? 0) === 0) toast({ title: "Nothing queued to send" });
    else toast({ title: `Sent ${r.sent ?? 0}${r.failed ? ` · ${r.failed} failed` : ""}` });
    void load();
  };

  const counts = useMemo(() => {
    const c = { pending: 0, sent: 0, failed: 0 };
    for (const r of rows) if (r.status === "pending" || r.status === "sending") c.pending++;
      else if (r.status in c) (c as Record<string, number>)[r.status]++;
    return c;
  }, [rows]);

  const visible = useMemo(
    () => (filter === "all" ? rows : filter === "pending" ? rows.filter((r) => r.status === "pending" || r.status === "sending") : rows.filter((r) => r.status === filter)),
    [rows, filter],
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <BellRing className="h-6 w-6 text-primary" /> Email Settings
          </h1>
          <p className="text-sm text-muted-foreground">
            Data-pending reminders and filing confirmations for TDS clients. Enable it per client from the TDS
            Compliance panel in Client Settings; edit the wording below.
          </p>
        </div>
        <div className="flex items-center gap-2 self-start">
          <Button size="sm" onClick={sendNow} disabled={sending} className="gap-1.5">
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Send queued now
          </Button>
          <Button variant="outline" size="sm" onClick={load} disabled={loading} className="gap-1.5">
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
          </Button>
        </div>
      </div>

      <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
        <Mail className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          Sending is <strong>live</strong> from <strong>tds@vjdesai.com</strong>. Filing confirmations queue
          automatically when a return is marked <em>Filed</em> or <em>NIL</em>; data-pending reminders queue on the
          fixed quarterly schedule (8th/11th/14th of the month after quarter-end, or 1st/5th/10th May for Q4). Queued
          mail goes out on the hourly run — or click <strong>Send queued now</strong> to flush it immediately.
        </span>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Queue today's reminders</CardTitle>
          <CardDescription>
            For every client with reminders enabled whose filing is still <strong>Not Started</strong> for the
            quarter due today, queue the day's reminder step — a no-op unless today is one of the 12 scheduled dates.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={queueDue} disabled={queueing} className="gap-1.5">
            {queueing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Queue due reminders
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="text-base">Email outbox</CardTitle>
            <CardDescription>{counts.pending} queued · {counts.sent} sent · {counts.failed} failed</CardDescription>
          </div>
          <Tabs value={filter} onValueChange={(v) => setFilter(v as FilterKey)}>
            <TabsList>
              {FILTERS.map((f) => (
                <TabsTrigger key={f} value={f} className="capitalize">{f === "all" ? "All" : STATUS_META[f as OutboxStatus].label}</TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : visible.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">Nothing queued yet.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="py-2 pr-3 font-medium">Client</th>
                    <th className="py-2 pr-3 font-medium">Type</th>
                    <th className="py-2 pr-3 font-medium">Form · Period</th>
                    <th className="py-2 pr-3 font-medium">Subject</th>
                    <th className="py-2 pr-3 font-medium">Status</th>
                    <th className="py-2 pr-3 font-medium whitespace-nowrap">Queued</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((r) => {
                    const meta = STATUS_META[r.status] ?? STATUS_META.pending;
                    return (
                      <tr key={r.id} className="border-b last:border-0 align-top hover:bg-muted/40">
                        <td className="py-2.5 pr-3">
                          <div className="font-medium">{names[r.client_id] ?? "—"}</div>
                          <div className="text-xs text-muted-foreground">{r.to_email}</div>
                        </td>
                        <td className="py-2.5 pr-3 whitespace-nowrap">
                          {r.kind === "query" ? (
                            <span className="inline-flex items-center gap-1 text-blue-700"><MessageSquareWarning className="h-3.5 w-3.5" /> Client query</span>
                          ) : r.kind === "confirmation" ? (
                            <span className="inline-flex items-center gap-1 text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" /> Confirmation</span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-amber-700">
                              <BellRing className="h-3.5 w-3.5" /> Reminder{r.reminder_step ? ` #${r.reminder_step}` : ""}
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 pr-3 whitespace-nowrap">
                          <div>{r.form_type ?? "—"}</div>
                          <div className="text-xs text-muted-foreground">{r.quarter ? `${r.quarter} FY ${r.financial_year}` : "—"}</div>
                        </td>
                        <td className="max-w-[22rem] truncate py-2.5 pr-3" title={r.subject}>{r.subject}</td>
                        <td className="py-2.5 pr-3">
                          <Badge variant="outline" className={`gap-1 ${meta.className}`}>{meta.icon}{meta.label}</Badge>
                          {r.status === "failed" && r.error && (
                            <div className="mt-1 max-w-[16rem] truncate text-xs text-red-600" title={r.error}>{r.error}</div>
                          )}
                        </td>
                        <td className="py-2.5 pr-3 whitespace-nowrap text-xs text-muted-foreground">{fmtWhen(r.created_at)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="pt-2">
        <h2 className="mb-1 flex items-center gap-2 text-lg font-semibold tracking-tight">
          <Mail className="h-5 w-5 text-primary" /> Email templates
        </h2>
        <p className="mb-3 text-sm text-muted-foreground">
          Edit the wording of each reminder and confirmation. The letterhead, details box and signature are applied automatically.
        </p>
        <TdsEmailTemplatesEditor />
      </div>
    </div>
  );
}
