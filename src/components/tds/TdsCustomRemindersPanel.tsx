import { useCallback, useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BellPlus, Loader2, Pause, Play, Send, Trash2 } from "lucide-react";
import { TdsCustomReminderDialog } from "./TdsCustomReminderDialog";

type Status = "active" | "paused" | "completed" | "cancelled";

interface Row {
  id: string;
  client_id: string;
  to_email: string;
  form_type: string | null;
  financial_year: string | null;
  quarter: string | null;
  schedule_type: "once" | "recurring";
  next_run_at: string;
  interval_days: number | null;
  end_date: string | null;
  max_sends: number | null;
  stop_when_started: boolean;
  sends_count: number;
  last_sent_at: string | null;
  status: Status;
  status_note: string | null;
}

const STATUS_CLASS: Record<Status, string> = {
  active: "bg-emerald-100 text-emerald-800 border-emerald-200",
  paused: "bg-amber-100 text-amber-800 border-amber-200",
  completed: "bg-slate-100 text-slate-600 border-slate-200",
  cancelled: "bg-slate-100 text-slate-500 border-slate-200",
};

const fmt = (iso: string | null) => (iso ? format(new Date(iso), "dd/MM/yyyy HH:mm") : "—");

function describe(r: Row): string {
  if (r.schedule_type === "once") return "Once";
  const parts = [`Every ${r.interval_days} day${r.interval_days === 1 ? "" : "s"}`];
  if (r.max_sends) parts.push(`max ${r.max_sends}`);
  if (r.end_date) parts.push(`until ${format(new Date(`${r.end_date}T00:00:00`), "dd/MM/yyyy")}`);
  return parts.join(" · ");
}

/**
 * Custom TDS data reminders — list + manage (send now, pause/resume, cancel)
 * and the "New custom reminder" entry point for any client. Lives on the TDS
 * Email Settings page.
 */
export function TdsCustomRemindersPanel({ onChanged }: { onChanged?: () => void }) {
  const { toast } = useToast();
  const [rows, setRows] = useState<Row[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [filter, setFilter] = useState<"open" | "all">("open");
  const [dialogOpen, setDialogOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data }, { data: clients }] = await Promise.all([
      supabase.from("tds_custom_reminders" as any)
        .select("id, client_id, to_email, form_type, financial_year, quarter, schedule_type, next_run_at, interval_days, end_date, max_sends, stop_when_started, sends_count, last_sent_at, status, status_note")
        .order("created_at", { ascending: false })
        .limit(300),
      supabase.from("clients").select("id, name"),
    ]);
    setRows(((data ?? []) as unknown) as Row[]);
    setNames(Object.fromEntries((clients ?? []).map((c) => [c.id as string, c.name as string])));
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const visible = useMemo(
    () => (filter === "all" ? rows : rows.filter((r) => r.status === "active" || r.status === "paused")),
    [rows, filter],
  );

  const refresh = () => { void load(); onChanged?.(); };

  const setStatus = async (r: Row, status: Status, note: string | null) => {
    setBusy(r.id);
    const patch: Record<string, unknown> = { status, status_note: note, updated_at: new Date().toISOString() };
    // Resuming a schedule whose slot already passed -> next run on the next hourly pass.
    if (status === "active" && new Date(r.next_run_at).getTime() < Date.now()) patch.next_run_at = new Date().toISOString();
    const { error } = await supabase.from("tds_custom_reminders" as any).update(patch).eq("id", r.id);
    setBusy(null);
    if (error) { toast({ title: "Update failed", description: error.message, variant: "destructive" }); return; }
    refresh();
  };

  const sendNow = async (r: Row) => {
    setBusy(r.id);
    // Make it due now, then process just this schedule (keeps the cadence going from here).
    const { error: upErr } = await supabase.from("tds_custom_reminders" as any)
      .update({ status: "active", next_run_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", r.id);
    if (upErr) { setBusy(null); toast({ title: "Send failed", description: upErr.message, variant: "destructive" }); return; }
    const { data, error } = await supabase.functions.invoke("queue-tds-custom-reminders", { body: { id: r.id } });
    setBusy(null);
    const res = (data ?? {}) as { queued?: number; sent?: number; completed?: number; errors?: { error: string }[] };
    if (error || res.errors?.length) toast({ title: "Send failed", description: error?.message ?? res.errors?.[0]?.error, variant: "destructive" });
    else if (!res.queued && res.completed) toast({ title: "Not sent", description: "Work on this return has already started, so the reminder was stopped." });
    else toast({ title: res.sent ? "Reminder sent" : "Reminder queued", description: `To ${r.to_email}` });
    refresh();
  };

  const remove = async (r: Row) => {
    if (!window.confirm(`Delete this reminder schedule for ${names[r.client_id] ?? "this client"}? Emails already sent stay in the outbox log.`)) return;
    setBusy(r.id);
    const { error } = await supabase.from("tds_custom_reminders" as any).delete().eq("id", r.id);
    setBusy(null);
    if (error) { toast({ title: "Delete failed", description: error.message, variant: "destructive" }); return; }
    refresh();
  };

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <CardTitle className="text-base">Custom reminders</CardTitle>
          <CardDescription>
            Ask any client for TDS data on your own schedule — now, on a date, or every N days. Independent of the fixed quarterly calendar.
          </CardDescription>
        </div>
        <div className="flex items-center gap-2">
          <Tabs value={filter} onValueChange={(v) => setFilter(v as "open" | "all")}>
            <TabsList>
              <TabsTrigger value="open">Active</TabsTrigger>
              <TabsTrigger value="all">All</TabsTrigger>
            </TabsList>
          </Tabs>
          <Button size="sm" className="gap-1.5" onClick={() => setDialogOpen(true)}>
            <BellPlus className="h-4 w-4" /> New custom reminder
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : visible.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground">
            {filter === "open" ? "No active custom reminders." : "No custom reminders yet."} Click <b>New custom reminder</b> to set one up.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">Client</th>
                  <th className="py-2 pr-3 font-medium">Form · Period</th>
                  <th className="py-2 pr-3 font-medium">Schedule</th>
                  <th className="py-2 pr-3 font-medium whitespace-nowrap">Next / last</th>
                  <th className="py-2 pr-3 font-medium">Sent</th>
                  <th className="py-2 pr-3 font-medium">Status</th>
                  <th className="py-2 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => {
                  const open = r.status === "active" || r.status === "paused";
                  return (
                    <tr key={r.id} className="border-b last:border-0 align-top hover:bg-muted/40">
                      <td className="py-2.5 pr-3">
                        <div className="font-medium">{names[r.client_id] ?? "—"}</div>
                        <div className="text-xs text-muted-foreground">{r.to_email}</div>
                      </td>
                      <td className="py-2.5 pr-3 whitespace-nowrap">
                        <div>{r.form_type ?? "—"}</div>
                        <div className="text-xs text-muted-foreground">{r.quarter ? `${r.quarter} FY ${r.financial_year}` : "—"}</div>
                      </td>
                      <td className="py-2.5 pr-3">
                        <div>{describe(r)}</div>
                        {r.stop_when_started && <div className="text-xs text-muted-foreground">Stops when work starts</div>}
                      </td>
                      <td className="py-2.5 pr-3 whitespace-nowrap text-xs">
                        <div>{open ? fmt(r.next_run_at) : "—"}</div>
                        <div className="text-muted-foreground">last: {fmt(r.last_sent_at)}</div>
                      </td>
                      <td className="py-2.5 pr-3">{r.sends_count}{r.max_sends ? ` / ${r.max_sends}` : ""}</td>
                      <td className="py-2.5 pr-3">
                        <Badge variant="outline" className={`capitalize ${STATUS_CLASS[r.status]}`}>{r.status}</Badge>
                        {r.status_note && <div className="mt-1 max-w-[14rem] text-xs text-muted-foreground">{r.status_note}</div>}
                      </td>
                      <td className="py-2.5 text-right whitespace-nowrap">
                        {busy === r.id ? (
                          <Loader2 className="ml-auto h-4 w-4 animate-spin text-muted-foreground" />
                        ) : (
                          <div className="flex justify-end gap-1">
                            <Button variant="ghost" size="icon" className="h-7 w-7" title="Send a reminder now" onClick={() => sendNow(r)}>
                              <Send className="h-3.5 w-3.5" />
                            </Button>
                            {r.status === "active" && (
                              <Button variant="ghost" size="icon" className="h-7 w-7" title="Pause" onClick={() => setStatus(r, "paused", "Paused by staff")}>
                                <Pause className="h-3.5 w-3.5" />
                              </Button>
                            )}
                            {r.status === "paused" && (
                              <Button variant="ghost" size="icon" className="h-7 w-7" title="Resume" onClick={() => setStatus(r, "active", null)}>
                                <Play className="h-3.5 w-3.5" />
                              </Button>
                            )}
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" title="Delete schedule" onClick={() => remove(r)}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
      <TdsCustomReminderDialog open={dialogOpen} onOpenChange={setDialogOpen} onSaved={refresh} />
    </Card>
  );
}
