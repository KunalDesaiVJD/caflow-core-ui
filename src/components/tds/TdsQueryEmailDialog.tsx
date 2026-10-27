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
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Loader2, Mail, Plus, Send, Trash2, Info } from "lucide-react";
import { buildTdsEmailHtml, type TdsQueryItem } from "@/lib/tdsEmailTemplate";
import { TDS_FIRM, renderTemplate } from "@/lib/tdsReminders";
import { logReconAudit } from "@/lib/tdsReconAudit";

/** A point a Validate & Finalise stage raised that can be put to the client. */
export interface TdsQueryCandidate {
  id: string;
  stage: "Stage 1" | "Stage 2" | "Stage 3";
  record: string;
  query: string;
}

/** What the Validate & Finalise tab reports up so the Workspace-level "Email
 *  client" button can pre-fill the dialog from whichever stage is open. */
export interface TdsQueryContext {
  filingId: string | null;
  firmId: string | null;
  /** "1".."4" — the stage tab currently open in Validate & Finalise. */
  stage: string;
  candidates: TdsQueryCandidate[];
}

const TEMPLATE_KEY = "query_client";
// Used only if the template row is missing (e.g. migration not applied yet).
const FALLBACK = {
  subject: "Query: {{form_type}} {{quarter}} FY {{financial_year}} — information required | {{client_name}}",
  body: "While preparing your {{form_type}} return for {{quarter}} FY {{financial_year}}, we came across the points listed below that need your clarification before we can proceed with the filing.\n\nKindly reply to this email with the clarification or the corrected details / supporting documents for each point. If you have any questions, please feel free to call us.",
};

const STAGE_LABEL: Record<TdsQueryCandidate["stage"], string> = {
  "Stage 1": "Stage 1 · Data validation",
  "Stage 2": "Stage 2 · PAN & challan",
  "Stage 3": "Stage 3 · Tally ledger",
};

interface CustomItem { key: number; record: string; query: string }

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientId: string;
  formType: string;
  quarter: string;
  financialYear: string;
  context: TdsQueryContext | null;
}

const EMAIL_RE = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;
const addrList = (s: string) => s.split(/[,;]/).map((a) => a.trim()).filter(Boolean);
const addrsValid = (s: string) => addrList(s).every((a) => EMAIL_RE.test(a));

export function TdsQueryEmailDialog({ open, onOpenChange, clientId, formType, quarter, financialYear, context }: Props) {
  const { user } = useAuth();
  const { toast } = useToast();

  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [client, setClient] = useState<{ name: string | null; email: string | null; contact_person: string | null; tan_number: string | null } | null>(null);
  const [to, setTo] = useState("");
  const [cc, setCc] = useState("");
  const [replyBy, setReplyBy] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  // Candidate id → edited query text; presence in `picked` = included.
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [custom, setCustom] = useState<CustomItem[]>([]);
  const [history, setHistory] = useState<{ created_at: string; status: string; to_email: string }[]>([]);

  const candidates = useMemo(() => context?.candidates ?? [], [context]);

  // (Re)initialise every time the dialog opens, so it always reflects the
  // stage the user is on right now rather than the last time it was opened.
  useEffect(() => {
    if (!open || !clientId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const filingId = context?.filingId ?? null;
      const [{ data: c }, { data: tpl }, hist] = await Promise.all([
        supabase.from("clients").select("name, email, contact_person, tan_number").eq("id", clientId).maybeSingle(),
        supabase.from("tds_email_templates" as any).select("subject, body").eq("key", TEMPLATE_KEY).maybeSingle(),
        filingId
          ? supabase.from("tds_email_outbox" as any).select("created_at, status, to_email")
            .eq("filing_id", filingId).eq("kind", "query").order("created_at", { ascending: false }).limit(5)
          : Promise.resolve({ data: [] as any[] }),
      ]);
      if (cancelled) return;
      const vars = {
        client_name: c?.name ?? "", form_type: formType, quarter, financial_year: financialYear,
        tan: c?.tan_number ?? "", contact_person: c?.contact_person || c?.name || "",
      };
      const t = (tpl as any) ?? FALLBACK;
      setClient(c ?? null);
      setTo(c?.email ?? "");
      setCc("");
      setReplyBy("");
      setSubject(renderTemplate(t.subject, vars));
      setMessage(renderTemplate(t.body, vars));
      // Pre-tick the open stage's points (Stage 4 = the consolidated review, so all).
      const stageKey = context?.stage && context.stage !== "4" ? `Stage ${context.stage}` : null;
      setPicked(new Set(candidates.filter((q) => !stageKey || q.stage === stageKey).map((q) => q.id)));
      setEdits({});
      setCustom(candidates.length ? [] : [{ key: Date.now(), record: "", query: "" }]);
      setHistory(((hist as any).data ?? []) as any[]);
      setLoading(false);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, clientId, formType, quarter, financialYear]);

  const grouped = useMemo(() => {
    const m = new Map<TdsQueryCandidate["stage"], TdsQueryCandidate[]>();
    for (const q of candidates) m.set(q.stage, [...(m.get(q.stage) ?? []), q]);
    return [...m.entries()];
  }, [candidates]);

  const items: TdsQueryItem[] = useMemo(() => [
    ...candidates.filter((q) => picked.has(q.id)).map((q) => ({ record: q.record, query: edits[q.id] ?? q.query })),
    ...custom.filter((c) => c.query.trim()).map((c) => ({ record: c.record.trim() || null, query: c.query })),
  ], [candidates, picked, edits, custom]);

  const renderVars = useMemo(() => ({
    contact_person: client?.contact_person || client?.name || "",
    client_name: client?.name || "",
    tan: client?.tan_number ?? "",
    form_type: formType,
    quarter,
    financial_year: financialYear,
    reply_by: replyBy ? format(new Date(replyBy), "dd MMM yyyy") : "",
    staff_name: user?.name ? `${user.name}, ${TDS_FIRM.team}` : TDS_FIRM.team,
    firm_name: TDS_FIRM.name,
    firm_email: TDS_FIRM.email,
    firm_phone: TDS_FIRM.phone,
    query_count: String(items.length),
    query_items: items,
  }), [client, formType, quarter, financialYear, replyBy, user?.name, items]);

  const previewHtml = useMemo(
    () => buildTdsEmailHtml({ key: TEMPLATE_KEY, kind: "query", message, vars: renderVars }),
    [message, renderVars],
  );

  const toggle = (id: string, on: boolean) => setPicked((prev) => {
    const next = new Set(prev);
    if (on) next.add(id); else next.delete(id);
    return next;
  });
  const toggleStage = (stage: TdsQueryCandidate["stage"], on: boolean) => setPicked((prev) => {
    const next = new Set(prev);
    for (const q of candidates) if (q.stage === stage) { if (on) next.add(q.id); else next.delete(q.id); }
    return next;
  });

  const problem =
    !to.trim() ? "Enter the client's email address."
    : !addrsValid(to) ? "One of the To addresses doesn't look like an email address."
    : cc.trim() && !addrsValid(cc) ? "One of the CC addresses doesn't look like an email address."
    : !subject.trim() ? "Enter a subject."
    : items.length === 0 ? "Pick at least one query, or add your own."
    : null;

  async function send() {
    if (problem || sending) return;
    setSending(true);
    try {
      const { data: row, error } = await supabase.from("tds_email_outbox" as any).insert({
        client_id: clientId,
        to_email: addrList(to).join(", "),
        cc_email: cc.trim() ? addrList(cc).join(", ") : null,
        kind: "query",
        template_key: TEMPLATE_KEY,
        form_type: formType,
        financial_year: financialYear,
        quarter,
        subject: subject.trim(),
        body: message,
        render_vars: renderVars,
        status: "pending",
        filing_id: context?.filingId ?? null,
        created_by: user?.id ?? null,
      }).select("id").single();
      if (error) throw error;
      const id = (row as any).id as string;

      const { data: res, error: fnErr } = await supabase.functions.invoke("send-tds-email", { body: { id } });
      const r = (res ?? {}) as { sent?: number; failed?: number; errors?: { error: string }[] };
      if (fnErr || !r.sent) {
        const why = fnErr?.message ?? r.errors?.[0]?.error ?? "The mail server did not accept the message.";
        toast({ title: "Email not sent", description: `${why} It is saved in TDS Email Settings → Email log, where you can retry it.`, variant: "destructive" });
        return;
      }
      await logReconAudit({
        filingId: context?.filingId, firmId: context?.firmId, userId: user?.id, userName: user?.name,
        actionType: "CLIENT_QUERY_EMAILED",
        newValue: `${items.length} quer${items.length === 1 ? "y" : "ies"} → ${addrList(to).join(", ")}`,
        remark: items.map((q, i) => `${i + 1}. ${q.record ? `${q.record}: ` : ""}${q.query}`).join("\n"),
      });
      toast({ title: "Query emailed to client", description: `Sent to ${addrList(to).join(", ")} from ${TDS_FIRM.email}.` });
      onOpenChange(false);
    } catch (e) {
      toast({ title: "Email not sent", description: (e as Error).message, variant: "destructive" });
    } finally {
      setSending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!sending) onOpenChange(o); }}>
      <DialogContent className="max-w-4xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Mail className="h-5 w-5 text-primary" /> Email query to client</DialogTitle>
          <DialogDescription>
            {client?.name || "Client"} · {formType} · {quarter} FY {financialYear}. Sent from {TDS_FIRM.email}; the client's reply comes back to that mailbox.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-16"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : (
          <Tabs defaultValue="compose" className="w-full">
            <TabsList className="h-8">
              <TabsTrigger value="compose" className="text-xs">Compose</TabsTrigger>
              <TabsTrigger value="preview" className="text-xs">Preview{items.length ? ` (${items.length})` : ""}</TabsTrigger>
            </TabsList>

            <TabsContent value="compose" className="space-y-4 mt-3">
              {history.length > 0 && (
                <div className="flex items-start gap-2 rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                  <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                  <span>
                    {history.length === 5 ? "5+" : history.length} query email{history.length === 1 ? "" : "s"} already sent for this return — last on{" "}
                    <b className="text-foreground">{format(new Date(history[0].created_at), "dd/MM/yyyy HH:mm")}</b> to {history[0].to_email} ({history[0].status}).
                  </span>
                </div>
              )}

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="tds-q-to">To</Label>
                  <Input id="tds-q-to" value={to} onChange={(e) => setTo(e.target.value)} placeholder="client@example.com" />
                  {!client?.email && <p className="text-[11px] text-amber-600">No email on the client master — type one here.</p>}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="tds-q-cc">CC <span className="font-normal text-muted-foreground">(optional, comma-separated)</span></Label>
                  <Input id="tds-q-cc" value={cc} onChange={(e) => setCc(e.target.value)} placeholder="accounts@example.com" />
                </div>
                <div className="space-y-1.5 sm:col-span-2 grid sm:grid-cols-[1fr_180px] gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="tds-q-subject">Subject</Label>
                    <Input id="tds-q-subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="tds-q-reply">Reply by <span className="font-normal text-muted-foreground">(optional)</span></Label>
                    <Input id="tds-q-reply" type="date" value={replyBy} onChange={(e) => setReplyBy(e.target.value)} />
                  </div>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="tds-q-msg">Message</Label>
                <Textarea id="tds-q-msg" value={message} onChange={(e) => setMessage(e.target.value)} rows={5} className="text-[13px] leading-relaxed" />
                <p className="text-[11px] text-muted-foreground">The greeting, return details, the table of queries below and the signature are added automatically. The default wording is editable under TDS → Email Settings.</p>
              </div>

              <div className="space-y-2">
                <p className="text-sm font-medium">Queries to include</p>
                {grouped.length === 0 && (
                  <p className="text-xs text-muted-foreground">No open exceptions in Validate &amp; Finalise for this return — type your queries below.</p>
                )}
                {grouped.map(([stage, qs]) => {
                  const all = qs.every((q) => picked.has(q.id));
                  const some = qs.some((q) => picked.has(q.id));
                  return (
                    <div key={stage} className="rounded-md border">
                      <label className="flex items-center gap-2 border-b bg-muted/40 px-3 py-1.5 text-xs font-semibold cursor-pointer">
                        <Checkbox checked={all ? true : some ? "indeterminate" : false} onCheckedChange={(v) => toggleStage(stage, v === true)} />
                        {STAGE_LABEL[stage]}
                        <Badge variant="secondary" className="text-[10px] ml-1">{qs.length}</Badge>
                      </label>
                      <div className="max-h-56 overflow-y-auto divide-y">
                        {qs.map((q) => {
                          const on = picked.has(q.id);
                          return (
                            <div key={q.id} className={cn("flex items-start gap-2 px-3 py-2 text-xs", !on && "opacity-60")}>
                              <Checkbox className="mt-0.5" checked={on} onCheckedChange={(v) => toggle(q.id, v === true)} />
                              <div className="flex-1 min-w-0 space-y-1">
                                <p className="font-medium truncate">{q.record}</p>
                                {on ? (
                                  <Textarea
                                    value={edits[q.id] ?? q.query}
                                    onChange={(e) => setEdits((p) => ({ ...p, [q.id]: e.target.value }))}
                                    rows={2}
                                    className="min-h-0 text-xs"
                                  />
                                ) : (
                                  <p className="text-muted-foreground">{edits[q.id] ?? q.query}</p>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}

                {custom.map((c) => (
                  <div key={c.key} className="flex items-start gap-2 rounded-md border px-3 py-2">
                    <div className="flex-1 grid gap-2 sm:grid-cols-[200px_1fr]">
                      <Input value={c.record} placeholder="Particulars (optional)" className="h-8 text-xs"
                        onChange={(e) => setCustom((p) => p.map((x) => (x.key === c.key ? { ...x, record: e.target.value } : x)))} />
                      <Textarea value={c.query} placeholder="Your query to the client" rows={2} className="min-h-0 text-xs"
                        onChange={(e) => setCustom((p) => p.map((x) => (x.key === c.key ? { ...x, query: e.target.value } : x)))} />
                    </div>
                    <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => setCustom((p) => p.filter((x) => x.key !== c.key))}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
                <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => setCustom((p) => [...p, { key: Date.now(), record: "", query: "" }])}>
                  <Plus className="h-3.5 w-3.5" /> Add a query
                </Button>
              </div>
            </TabsContent>

            <TabsContent value="preview" className="mt-3 space-y-2">
              <div className="text-xs space-y-0.5">
                <p><span className="text-muted-foreground">To:</span> {addrList(to).join(", ") || "—"}{cc.trim() && <><span className="text-muted-foreground"> · CC:</span> {addrList(cc).join(", ")}</>}</p>
                <p><span className="text-muted-foreground">Subject:</span> <b>{subject}</b></p>
              </div>
              <iframe title="Query email preview" srcDoc={previewHtml} sandbox="" className="w-full rounded-md border bg-white" style={{ height: 600 }} />
            </TabsContent>
          </Tabs>
        )}

        <DialogFooter className="items-center gap-2 sm:justify-between">
          <p className="text-xs text-destructive">{!loading && problem}</p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={sending}>Cancel</Button>
            <Button onClick={send} disabled={!!problem || sending || loading} className="gap-1.5">
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Send email
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
