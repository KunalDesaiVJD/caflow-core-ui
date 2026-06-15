/**
 * AuditClientInboxTab — Auditor-side client query communication hub
 *
 * Shows all audit_client_queries for the current engagement:
 *  - Full conversation thread per query (portal_query_messages)
 *  - Auditor can post messages + attach files
 *  - Status management (Open → Clarified etc.)
 *  - New query creation directly to client
 *  - Real-time updates via Supabase channel
 */
import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  MessageSquareWarning, Send, Loader2, Paperclip, Download, X,
  FileDown, ChevronDown, ChevronUp, CheckCircle2, Clock, Users, Mail,
  AlertTriangle, Bell,
} from "lucide-react";
import { EmailComposeDialog, EmailComposePayload } from "@/components/email/EmailComposeDialog";
import { ReminderRulesPanel } from "./ReminderRulesPanel";
import { useReminderEngine }  from "./hooks/useReminderEngine";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import type { AuditWorksheetData } from "./hooks/useAuditWorksheetData";

// ─── Types ────────────────────────────────────────────────────────────────────

interface QueryAttachment {
  file_path: string;
  file_name: string;
  file_type: string;
  size:      number;
}

interface ClientQuery {
  id: string;
  ref_number: string | null;
  query_text: string;
  status: string;
  priority: string;
  due_date: string | null;
  financial_year: string | null;
  required_documents: string | null;
  ledger_name: string | null;
  group_name: string | null;
  client_reply: string | null;
  internal_notes: string | null;
  created_at: string | null;
  /** Attachments carried over from Stage 2 Query Sheet at dispatch time.
   *  See migration 20260612000001 — JSONB array of { file_path, file_name,
   *  file_type, size } pointing into the "documents" storage bucket. */
  attachments: QueryAttachment[] | null;
}

interface Message {
  id: string;
  sender_role: "auditor" | "client";
  sender_name: string | null;
  message: string;
  attachment_path: string | null;
  attachment_name: string | null;
  created_at: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUSES = ["Open","Client Acknowledged","Reply Received","Clarified","Closed"] as const;
const PRIORITIES = ["High","Medium","Low"] as const;

const STATUS_STYLE: Record<string, string> = {
  "Open":                "bg-red-100 text-red-700 border-red-200",
  "Client Acknowledged": "bg-blue-100 text-blue-700 border-blue-200",
  "Reply Received":      "bg-purple-100 text-purple-700 border-purple-200",
  "Clarified":           "bg-green-100 text-green-700 border-green-200",
  "Closed":              "bg-muted text-muted-foreground",
};

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
  });
}

// ─── Due-date urgency helpers (Phase 3F) ─────────────────────────────────────

type DueStatus = "overdue" | "today" | "soon" | "ok" | "none";

function getDueStatus(due: string | null): { status: DueStatus; days: number } {
  if (!due) return { status: "none", days: 0 };
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const d     = new Date(due); d.setHours(0, 0, 0, 0);
  const days  = Math.ceil((d.getTime() - today.getTime()) / 86_400_000);
  if (days < 0)  return { status: "overdue", days };
  if (days === 0) return { status: "today",   days: 0 };
  if (days <= 3)  return { status: "soon",    days };
  return { status: "ok", days };
}

/** Urgency rank — lower = show first */
function urgencyRank(q: ClientQuery): number {
  const terminal = ["Clarified", "Closed"].includes(q.status);
  if (terminal) return 999;
  const { status, days } = getDueStatus(q.due_date);
  if (status === "overdue") return days;          // negative — most overdue = lowest = first
  if (status === "today")   return 0;
  if (status === "soon")    return days;           // 1–3
  // No due date — sort by priority then created_at
  const priorityOrder: Record<string, number> = { High: 10, Medium: 20, Low: 30 };
  return 100 + (priorityOrder[q.priority] ?? 20);
}

function urgencySort(list: ClientQuery[]): ClientQuery[] {
  return [...list].sort((a, b) => urgencyRank(a) - urgencyRank(b));
}

// ─── QueryThread ─────────────────────────────────────────────────────────────

function QueryThread({
  query, onStatusChange, onRemind,
}: {
  query:          ClientQuery;
  onStatusChange: () => void;
  onRemind?:      () => void;
}) {
  const { user } = useAuth();
  const [messages,   setMessages]   = useState<Message[]>([]);
  const [expanded,   setExpanded]   = useState(false);
  const [loading,    setLoading]    = useState(false);
  const [replyText,  setReplyText]  = useState("");
  const [sending,    setSending]    = useState(false);
  const [file,       setFile]       = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const bottomRef    = useRef<HTMLDivElement>(null);

  const fetchMessages = useCallback(async () => {
    setLoading(true);
    const { data } = await (supabase as any)
      .from("portal_query_messages")
      .select("*")
      .eq("query_id", query.id)
      .order("created_at", { ascending: true });
    setMessages((data as Message[]) || []);
    setLoading(false);
  }, [query.id]);

  useEffect(() => {
    if (!expanded) return;
    fetchMessages();
    const ch = supabase
      .channel(`inbox-${query.id}`)
      .on("postgres_changes", {
        event: "INSERT", schema: "public", table: "portal_query_messages",
        filter: `query_id=eq.${query.id}`,
      }, fetchMessages)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [expanded, fetchMessages, query.id]);

  useEffect(() => {
    if (expanded && messages.length) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, expanded]);

  const sendMessage = async () => {
    if (!replyText.trim() && !file) { toast.error("Type a message or attach a file"); return; }
    setSending(true);
    try {
      let attachPath: string | null = null;
      let attachName: string | null = null;
      if (file) {
        const path = `query-docs/${query.id}/${Date.now()}_${file.name}`;
        const { error: upErr } = await supabase.storage.from("firm-assets").upload(path, file, { upsert: false });
        if (upErr) throw upErr;
        attachPath = path;
        attachName = file.name;
      }
      const { error } = await (supabase as any)
        .from("portal_query_messages")
        .insert({
          query_id: query.id, sender_role: "auditor",
          sender_name: user?.name || "Auditor",
          message: replyText.trim(),
          attachment_path: attachPath, attachment_name: attachName,
        });
      if (error) throw error;
      setReplyText(""); setFile(null);
      toast.success("Message sent to client");
      fetchMessages();
    } catch (err: any) {
      toast.error(err.message || "Failed to send");
    } finally { setSending(false); }
  };

  const downloadAttachment = async (path: string, name: string) => {
    const { data, error } = await supabase.storage.from("firm-assets").createSignedUrl(path, 60);
    if (error) { toast.error("Download failed"); return; }
    const a = document.createElement("a"); a.href = data.signedUrl; a.download = name; a.click();
  };

  // Dispatched attachments (from Stage 2 Query Sheet) live in the "documents"
  // bucket, not "firm-assets". Use a separate downloader so the signed-URL
  // call goes to the right bucket — without this the auditor sees the
  // attachments listed but every click 404s.
  const downloadDispatchedAttachment = async (path: string, name: string) => {
    const { data, error } = await supabase.storage.from("documents").createSignedUrl(path, 60);
    if (error) { toast.error("Download failed"); return; }
    const a = document.createElement("a"); a.href = data.signedUrl; a.download = name; a.click();
  };

  const updateStatus = async (status: string) => {
    await supabase.from("audit_client_queries" as any).update({ status } as any).eq("id", query.id);
    onStatusChange();
    toast.success(`Status → ${status}`);
  };

  const hasNewReply = query.status === "Reply Received";
  const dueInfo     = getDueStatus(query.due_date);
  const isTerminal  = ["Clarified", "Closed"].includes(query.status);

  return (
    <Card className={cn(
      "overflow-hidden",
      hasNewReply && "ring-2 ring-primary/40",
      !isTerminal && dueInfo.status === "overdue" && "ring-2 ring-red-300",
      !isTerminal && dueInfo.status === "today"   && "ring-2 ring-orange-300",
    )}>
      <CardHeader
        className={cn(
          "pb-0 cursor-pointer",
          hasNewReply && "bg-primary/5",
          !isTerminal && dueInfo.status === "overdue" && "bg-red-50/60",
        )}
        onClick={() => setExpanded(v => !v)}
      >
        <div className="flex items-start gap-3 py-1">
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-1">
              {query.ref_number && (
                <span className="font-mono text-xs text-muted-foreground">{query.ref_number}</span>
              )}
              <Badge className={cn("text-[10px] border", STATUS_STYLE[query.status] || STATUS_STYLE["Open"])}>
                {query.status}
              </Badge>
              <Badge variant="outline" className={cn("text-[10px]",
                query.priority === "High" ? "border-red-300 text-red-700" :
                query.priority === "Low"  ? "border-green-300 text-green-700" : ""
              )}>
                {query.priority}
              </Badge>
              {query.financial_year && (
                <Badge variant="outline" className="text-[10px]">FY {query.financial_year}</Badge>
              )}
              {query.ledger_name && (
                <Badge variant="secondary" className="text-[10px]">{query.ledger_name}</Badge>
              )}
              {hasNewReply && (
                <span className="text-[10px] font-semibold text-primary animate-pulse">● New Reply</span>
              )}

              {/* Phase 3F: due-date urgency badges */}
              {!isTerminal && dueInfo.status === "overdue" && (
                <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-red-700 bg-red-100 border border-red-200 rounded-full px-1.5 py-px">
                  <AlertTriangle size={9} /> {Math.abs(dueInfo.days)}d overdue
                </span>
              )}
              {!isTerminal && dueInfo.status === "today" && (
                <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-orange-700 bg-orange-100 border border-orange-200 rounded-full px-1.5 py-px">
                  <Clock size={9} /> Due today
                </span>
              )}
              {!isTerminal && dueInfo.status === "soon" && (
                <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-amber-700 bg-amber-100 border border-amber-200 rounded-full px-1.5 py-px">
                  <Clock size={9} /> Due in {dueInfo.days}d
                </span>
              )}

              {/* Due date — shown when ok/no urgency */}
              {query.due_date && !["overdue","today","soon"].includes(dueInfo.status) && (
                <span className="text-xs text-muted-foreground ml-auto flex items-center gap-1">
                  <Clock size={10} /> {query.due_date}
                </span>
              )}
            </div>
            <p className="text-sm leading-relaxed line-clamp-2">{query.query_text}</p>
          </div>

          {/* Phase 3F: Remind button — quick access without opening thread */}
          {onRemind && !isTerminal && (
            <button
              type="button"
              onClick={e => { e.stopPropagation(); onRemind(); }}
              title="Send reminder"
              className="flex-shrink-0 h-7 w-7 flex items-center justify-center rounded text-muted-foreground hover:text-orange-600 hover:bg-orange-50 transition-colors"
            >
              <Bell size={13} />
            </button>
          )}

          <button type="button" className="text-muted-foreground flex-shrink-0">
            {expanded ? <ChevronUp size={15}/> : <ChevronDown size={15}/>}
          </button>
        </div>
      </CardHeader>

      {expanded && (
        <CardContent className="pt-4 space-y-3">
          {/* Status + Required docs */}
          <div className="flex flex-wrap items-center gap-2 pb-2 border-b">
            <span className="text-xs text-muted-foreground">Status:</span>
            <Select value={query.status} onValueChange={updateStatus}>
              <SelectTrigger className="h-7 text-xs w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUSES.map(s => <SelectItem key={s} value={s} className="text-xs">{s}</SelectItem>)}
              </SelectContent>
            </Select>
            {query.required_documents && (
              <span className="text-xs text-muted-foreground ml-2">
                <span className="font-medium">Required: </span>{query.required_documents}
              </span>
            )}
          </div>

          {/* Dispatched attachments from Stage 2 Query Sheet.
              When the auditor attached supporting documents to a query row
              in Stage 2, those files travel into audit_client_queries.attachments
              at dispatch time (see migration 20260612000001 + the
              BulkDispatchDialog handler in QuerySheet.tsx). Display them here
              so the auditor doesn't have to re-attach the same docs to send
              an email — they're already on the dispatched query, just not
              previously surfaced in Stage 3's UI. */}
          {Array.isArray(query.attachments) && query.attachments.length > 0 && (
            <div className="rounded-md border bg-muted/30 px-3 py-2 space-y-1.5">
              <p className="text-[11px] font-semibold text-muted-foreground uppercase flex items-center gap-1.5">
                <Paperclip size={11} />
                Attached at dispatch ({query.attachments.length})
              </p>
              <div className="flex flex-wrap gap-1.5">
                {query.attachments.map(att => (
                  <button
                    key={att.file_path}
                    type="button"
                    onClick={() => downloadDispatchedAttachment(att.file_path, att.file_name)}
                    className="inline-flex items-center gap-1.5 text-xs rounded border bg-card px-2 py-1 hover:bg-primary/5 hover:border-primary/40 transition-colors"
                    title={`${att.file_name} (${(att.size / 1024).toFixed(0)} KB)`}
                  >
                    <Paperclip size={10} className="text-primary shrink-0" />
                    <span className="truncate max-w-[200px]">{att.file_name}</span>
                    <Download size={10} className="text-muted-foreground shrink-0" />
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Conversation thread */}
          <div className="space-y-1">
            {loading ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground py-3">
                <Loader2 size={12} className="animate-spin" /> Loading…
              </div>
            ) : (
              <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                {/* Legacy reply bridge */}
                {query.client_reply && messages.length === 0 && (
                  <div className="flex justify-start">
                    <div className="max-w-[80%] bg-blue-50 border border-blue-200 rounded-xl rounded-tl-sm px-3 py-2">
                      <p className="text-[10px] font-semibold text-blue-700 mb-0.5 flex items-center gap-1">
                        <Users size={9} /> Client · Earlier reply
                      </p>
                      <p className="text-sm">{query.client_reply}</p>
                    </div>
                  </div>
                )}
                {messages.length === 0 && !query.client_reply && (
                  <p className="text-xs text-muted-foreground text-center py-4">No messages yet. Send the first message below.</p>
                )}
                {messages.map(msg => {
                  const isAuditor = msg.sender_role === "auditor";
                  return (
                    <div key={msg.id} className={cn("flex", isAuditor ? "justify-end" : "justify-start")}>
                      <div className={cn(
                        "max-w-[80%] rounded-xl px-3 py-2 space-y-1",
                        isAuditor
                          ? "bg-primary/10 border border-primary/20 rounded-tr-sm"
                          : "bg-blue-50 border border-blue-200 rounded-tl-sm"
                      )}>
                        <div className="flex items-baseline gap-2">
                          <span className={cn("text-[10px] font-semibold",
                            isAuditor ? "text-primary" : "text-blue-700"
                          )}>
                            {isAuditor ? (msg.sender_name || "You") : "Client"}
                          </span>
                          <span className="text-[9px] text-muted-foreground">{fmtTime(msg.created_at)}</span>
                        </div>
                        {msg.message && <p className="text-sm">{msg.message}</p>}
                        {msg.attachment_path && msg.attachment_name && (
                          <button type="button" onClick={() => downloadAttachment(msg.attachment_path!, msg.attachment_name!)}
                            className="flex items-center gap-1.5 text-xs text-primary hover:underline">
                            <Paperclip size={10} /> {msg.attachment_name} <Download size={9}/>
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
                <div ref={bottomRef} />
              </div>
            )}

            {/* Reply composer */}
            {query.status !== "Closed" && (
              <div className="border-t pt-3 space-y-2 mt-2">
                <Textarea
                  value={replyText}
                  onChange={e => setReplyText(e.target.value)}
                  placeholder="Type message to client…"
                  rows={2}
                  className="resize-none text-sm"
                />
                {file && (
                  <div className="flex items-center gap-2 px-2 py-1 bg-muted rounded text-xs">
                    <Paperclip size={11} className="text-muted-foreground"/>
                    <span className="flex-1 truncate">{file.name}</span>
                    <button type="button" onClick={() => setFile(null)}><X size={11}/></button>
                  </div>
                )}
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" className="gap-1 h-7 text-xs"
                    onClick={() => fileInputRef.current?.click()}>
                    <Paperclip size={12}/> Attach
                  </Button>
                  <input ref={fileInputRef} type="file" className="hidden"
                    onChange={e => { const f = e.target.files?.[0]; if (f) setFile(f); e.target.value = ""; }}/>
                  <Button size="sm" className="gap-1 h-7 text-xs ml-auto"
                    onClick={sendMessage} disabled={sending || (!replyText.trim() && !file)}>
                    {sending ? <Loader2 size={12} className="animate-spin"/> : <Send size={12}/>}
                    Send
                  </Button>
                </div>
              </div>
            )}
            {query.status === "Closed" && (
              <div className="flex items-center gap-2 text-xs text-green-700 border-t pt-3">
                <CheckCircle2 size={13}/> Query closed.
              </div>
            )}
          </div>
        </CardContent>
      )}
    </Card>
  );
}

// (NewQueryDialog removed — replaced by Export PDF)

// ─── Main Tab ─────────────────────────────────────────────────────────────────

interface Props {
  data:         AuditWorksheetData;
  engagementId: string;
}

export function AuditClientInboxTab({ data, engagementId }: Props) {
  const [queries,      setQueries]      = useState<ClientQuery[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [exporting,    setExporting]    = useState(false);
  const [filter,       setFilter]       = useState<"all"|"open"|"replied"|"closed">("all");
  const [emailPayload, setEmailPayload] = useState<EmailComposePayload | null>(null);

  // Phase 4A/4C: reminder + escalation engine
  const {
    rules, setRules,
    pendingReminders, escalationCandidates,
    markSent, markEscalated,
  } = useReminderEngine(engagementId, queries);

  const fetchQueries = useCallback(async () => {
    if (!engagementId) return;
    const { data: rows } = await (supabase as any)
      .from("audit_client_queries")
      .select("id,ref_number,query_text,status,priority,due_date,financial_year,required_documents,ledger_name,group_name,client_reply,internal_notes,created_at,attachments")
      .eq("engagement_id", engagementId)
      .order("created_at", { ascending: false });
    setQueries((rows as ClientQuery[]) || []);
    setLoading(false);
  }, [engagementId]);

  useEffect(() => { fetchQueries(); }, [fetchQueries]);

  useEffect(() => {
    const ch = supabase
      .channel(`inbox-eng-${engagementId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "audit_client_queries" }, fetchQueries)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [fetchQueries, engagementId]);

  // ── Email compose helper ─────────────────────────────────────────────
  const openEmail = (templateType: EmailComposePayload["templateType"], selectedQueries?: ClientQuery[]) => {
    const qs = (selectedQueries ?? queries.filter(q => !["Clarified","Closed"].includes(q.status)));
    setEmailPayload({
      templateType,
      clientName:    data.clientName || "Client",
      clientEmail:   data.client?.email || "",
      firmName:      data.firmName || "",
      firmId:        data.engagement?.firm_id || "",
      clientId:      data.engagement?.client_id || "",
      engagementId,
      financialYear: data.financialYear,
      portalUrl:     `${window.location.origin}/portal`,
      clientMobile:  (data.client as any)?.mobile || undefined,  // Phase 4B
      queries:       qs.map(q => ({
        ref_number:         q.ref_number,
        query_text:         q.query_text,
        required_documents: q.required_documents,
        group_name:         q.group_name,
        ledger_name:        q.ledger_name,
      })),
    });
  };

  // Phase 4A: send all pending reminders + mark them sent
  const sendPendingReminders = () => {
    if (!pendingReminders.length) return;
    openEmail("audit_query_reminder", pendingReminders as ClientQuery[]);
  };

  // Phase 4C: send escalation email + mark escalated
  const sendEscalation = () => {
    if (!escalationCandidates.length) return;
    openEmail("audit_query_reminder", escalationCandidates as ClientQuery[]);
    // markEscalated called in onSent below
  };

  // ── Export PDF — current filter tab, full chat thread per query ──────────
  // Uses autoTable for message threads so text wrapping is handled correctly
  // and each row is clearly labelled CLIENT / AUDITOR with colour coding.
  const exportPdf = async () => {
    if (displayed.length === 0) { toast.error("No queries to export"); return; }
    setExporting(true);
    try {
      const { jsPDF } = await import("jspdf");
      const autoTable  = (await import("jspdf-autotable")).default;

      // Fetch messages for every displayed query up-front
      const allMessages: Record<string, Message[]> = {};
      for (const q of displayed) {
        const { data: msgs } = await (supabase as any)
          .from("portal_query_messages")
          .select("*")
          .eq("query_id", q.id)
          .order("created_at", { ascending: true });
        allMessages[q.id] = (msgs as Message[]) || [];
      }

      const filterLabel = filter === "all"     ? "All Queries"
                        : filter === "open"    ? "Open Queries"
                        : filter === "replied" ? "Replied Queries"
                        :                        "Closed Queries";

      const doc = new jsPDF({ orientation: "portrait", format: "a4", unit: "mm" });
      const pw  = doc.internal.pageSize.getWidth();   // 210
      const ph  = doc.internal.pageSize.getHeight();  // 297
      const ml  = 12;
      const cw  = pw - ml * 2;   // 186 mm usable width
      const HDR = 22;             // height of the running page header band

      // ── Running page header (drawn on every page) ────────────────────
      const drawPageHeader = () => {
        doc.setFillColor(26, 35, 60);
        doc.rect(0, 0, pw, HDR, "F");
        doc.setTextColor(255, 255, 255);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(11);
        doc.text(`Client Query Inbox  —  ${filterLabel}`, ml, 10);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(7.5);
        doc.text(
          `${data.clientName || ""}   ·   ${displayed.length} quer${displayed.length === 1 ? "y" : "ies"}`,
          ml, 17,
        );
        doc.text(
          new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }),
          pw - ml, 17, { align: "right" },
        );
      };

      drawPageHeader();
      let y = HDR + 5;

      // Status → band colour
      const statusRGB = (s: string): [number, number, number] => {
        if (["Open", "Client Acknowledged"].includes(s)) return [185, 28, 28];   // red
        if (s === "Reply Received")                       return [109, 40, 217]; // violet
        if (s === "Clarified")                            return [21, 128, 61];  // green
        if (s === "Closed")                               return [55, 65, 81];   // gray
        return [67, 56, 202];                                                    // indigo
      };

      const ensureSpace = (h: number) => {
        if (y + h > ph - ml) {
          doc.addPage();
          drawPageHeader();
          y = HDR + 5;
        }
      };

      for (let qi = 0; qi < displayed.length; qi++) {
        const q    = displayed[qi];
        const msgs = allMessages[q.id] || [];

        // Build render-message list
        type RM = { isAuditor: boolean; sender: string; time: string; text: string };
        const renderMsgs: RM[] = [];
        if (q.client_reply && msgs.length === 0) {
          renderMsgs.push({ isAuditor: false, sender: "Client", time: "", text: q.client_reply });
        }
        for (const msg of msgs) {
          if (!msg.message && !msg.attachment_name) continue;
          renderMsgs.push({
            isAuditor: msg.sender_role === "auditor",
            sender:    msg.sender_role === "auditor" ? (msg.sender_name || "Auditor") : "Client",
            time:      fmtTime(msg.created_at),
            text:      msg.message || `[Attachment: ${msg.attachment_name}]`,
          });
        }

        // ── Status-coloured header band ──────────────────────────────────
        ensureSpace(32);
        const [sr, sg, sb] = statusRGB(q.status);
        doc.setFillColor(sr, sg, sb);
        doc.rect(ml, y, cw, 8, "F");
        doc.setFont("helvetica", "bold");
        doc.setFontSize(8.5);
        doc.setTextColor(255, 255, 255);
        doc.text(`Query ${qi + 1} of ${displayed.length}`, ml + 3, y + 5.5);
        doc.text(q.status.toUpperCase(), pw - ml - 3, y + 5.5, { align: "right" });
        y += 8;

        // ── Meta row (ref / priority / FY / ledger / group) ──────────────
        doc.setFillColor(242, 244, 255);
        doc.rect(ml, y, cw, 9, "F");
        doc.setFont("helvetica", "normal");
        doc.setFontSize(7.5);
        doc.setTextColor(30, 30, 70);
        const metaParts = [
          q.ref_number ? `Ref: ${q.ref_number}` : `#${qi + 1}`,
          `Priority: ${q.priority}`,
          q.financial_year ? `FY ${q.financial_year}` : "",
          q.ledger_name    ? `Ledger: ${q.ledger_name}` : "",
          q.group_name     ? `Group: ${q.group_name}` : "",
        ].filter(Boolean);
        const metaStr = metaParts.join("   |   ");
        // Clip meta text so it doesn't overlap the due date
        const dueLabelW = q.due_date ? 36 : 0;
        const metaMaxW  = cw - 6 - dueLabelW;
        const metaClipped = doc.splitTextToSize(metaStr, metaMaxW)[0] as string;
        doc.text(metaClipped, ml + 3, y + 6);
        if (q.due_date) {
          doc.setFont("helvetica", "bold");
          doc.setTextColor(sr, sg, sb);
          doc.text(`Due: ${q.due_date}`, pw - ml - 3, y + 6, { align: "right" });
        }
        y += 10;

        // ── Query text — autoTable so long/special-char text wraps reliably ────
        autoTable(doc, {
          startY:     y,
          margin:     { left: ml, right: ml },
          tableWidth: cw,
          body:       [[q.query_text]],
          showHead:   false,
          styles: {
            font:        "helvetica",
            fontSize:    9,
            textColor:   [15, 20, 40]    as [number, number, number],
            fillColor:   [252, 252, 255] as [number, number, number],
            cellPadding: { top: 5, right: 5, bottom: 5, left: 5 },
            lineWidth:   0.3,
            lineColor:   [210, 215, 240] as [number, number, number],
            overflow:    "linebreak",
          },
          columnStyles: { 0: { cellWidth: cw, overflow: "linebreak" } },
          didDrawPage: () => { drawPageHeader(); },
        });
        y = (doc as any).lastAutoTable.finalY + 3;

        // Required documents note
        if (q.required_documents) {
          ensureSpace(9);
          doc.setFont("helvetica", "italic");
          doc.setFontSize(7.5);
          doc.setTextColor(80, 85, 115);
          doc.text(`Required documents:  ${q.required_documents}`, ml + 2, y + 4);
          y += 9;
        }

        // ── Message thread via autoTable ─────────────────────────────────
        if (renderMsgs.length > 0) {
          ensureSpace(18);

          // Section label
          doc.setFont("helvetica", "bold");
          doc.setFontSize(7.5);
          doc.setTextColor(80, 85, 115);
          doc.text("CONVERSATION THREAD", ml + 2, y + 4);
          y += 7;

          const msgBody = renderMsgs.map(m => [
            m.isAuditor ? "AUDITOR" : "CLIENT",
            m.sender,
            m.time || "—",
            m.text,
          ]);

          // Column widths: Role(18) + Name(30) + Time(28) + Message(rest=110)
          const COL_ROLE = 18, COL_NAME = 30, COL_TIME = 28;
          const COL_MSG  = cw - COL_ROLE - COL_NAME - COL_TIME;

          autoTable(doc, {
            startY: y,
            margin: { left: ml, right: ml, top: HDR + 5 },
            tableWidth: cw,
            head: [["Role", "Sender", "Time", "Message"]],
            body: msgBody,
            headStyles: {
              fillColor:   [44, 50, 82] as [number, number, number],
              textColor:   [255, 255, 255] as [number, number, number],
              fontSize:    7.5,
              fontStyle:   "bold",
              cellPadding: { top: 3, right: 4, bottom: 3, left: 4 },
              halign:      "left",
            },
            columnStyles: {
              0: { cellWidth: COL_ROLE, fontSize: 7,   fontStyle: "bold",   halign: "center" },
              1: { cellWidth: COL_NAME, fontSize: 7.5, fontStyle: "normal"                   },
              2: { cellWidth: COL_TIME, fontSize: 7,
                   textColor: [110, 115, 140] as [number, number, number]                     },
              3: { cellWidth: COL_MSG,  fontSize: 8.5, overflow: "linebreak"                 },
            },
            styles: {
              cellPadding: { top: 3.5, right: 4, bottom: 3.5, left: 4 },
              lineWidth:   0.15,
              lineColor:   [205, 210, 228] as [number, number, number],
              overflow:    "linebreak",
              font:        "helvetica",
            },
            didParseCell: (hookData: any) => {
              if (hookData.section !== "body") return;
              const m = renderMsgs[hookData.row.index];
              if (!m) return;
              if (m.isAuditor) {
                // Auditor row — light indigo tint
                hookData.cell.styles.fillColor = [232, 238, 255] as [number, number, number];
                if (hookData.column.index === 0)
                  hookData.cell.styles.textColor = [67, 56, 202] as [number, number, number];
              } else {
                // Client row — light green tint
                hookData.cell.styles.fillColor = [236, 253, 245] as [number, number, number];
                if (hookData.column.index === 0)
                  hookData.cell.styles.textColor = [21, 128, 61] as [number, number, number];
              }
            },
            // Redraw the running page header on every page autoTable creates
            didDrawPage: () => { drawPageHeader(); },
          });

          y = (doc as any).lastAutoTable.finalY + 6;
        } else {
          ensureSpace(10);
          doc.setFont("helvetica", "italic");
          doc.setFontSize(8);
          doc.setTextColor(150, 155, 165);
          doc.text("No messages recorded for this query.", ml + 3, y + 5);
          y += 12;
        }

        // ── Separator between queries ─────────────────────────────────────
        if (qi < displayed.length - 1) {
          ensureSpace(14);
          y += 3;
          doc.setDrawColor(185, 192, 218);
          doc.setLineWidth(0.5);
          doc.line(ml, y, pw - ml, y);
          doc.setLineWidth(0.2);
          y += 10;
        }
      }

      const safe  = (data.clientName || "Client").replace(/[^a-z0-9]/gi, "_");
      const stamp = new Date().toISOString().split("T")[0];
      doc.save(`Queries_${filterLabel.replace(/ /g, "_")}_${safe}_${stamp}.pdf`);
      toast.success(`Exported ${displayed.length} quer${displayed.length === 1 ? "y" : "ies"} as PDF`);
    } catch (e: any) {
      toast.error(`Export failed: ${e.message}`);
    } finally {
      setExporting(false);
    }
  };

  // Phase 3F: urgency-sorted displayed list
  const filtered = queries.filter(q => {
    if (filter === "open")    return q.status === "Open" || q.status === "Client Acknowledged";
    if (filter === "replied") return q.status === "Reply Received";
    if (filter === "closed")  return q.status === "Clarified" || q.status === "Closed";
    return true;
  });
  const displayed = urgencySort(filtered);

  const newReplies  = queries.filter(q => q.status === "Reply Received").length;
  const overdueCount = queries.filter(q =>
    q.due_date &&
    !["Clarified","Closed"].includes(q.status) &&
    getDueStatus(q.due_date).status === "overdue",
  ).length;

  if (loading) {
    return (
      <div className="space-y-3 py-4">
        {[1,2,3].map(i => <div key={i} className="h-20 bg-muted rounded-lg animate-pulse"/>)}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold flex items-center gap-2 flex-wrap">
            <MessageSquareWarning size={16} className="text-orange-600"/>
            Client Query Inbox
            {newReplies > 0 && (
              <Badge className="bg-primary text-primary-foreground text-[10px] h-4 px-1.5">
                {newReplies} new {newReplies === 1 ? "reply" : "replies"}
              </Badge>
            )}
            {/* Phase 3F: overdue badge */}
            {overdueCount > 0 && (
              <Badge className="bg-red-600 text-white text-[10px] h-4 px-1.5 flex items-center gap-0.5">
                <AlertTriangle size={9} /> {overdueCount} overdue
              </Badge>
            )}
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {queries.length} total · {queries.filter(q => !["Clarified","Closed"].includes(q.status)).length} open
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button size="sm" variant="outline" className="gap-1 h-8 text-xs"
            onClick={() => openEmail("audit_commencement", [])}>
            <Mail size={13}/> Commencement
          </Button>
          <Button size="sm" variant="outline" className="gap-1 h-8 text-xs"
            onClick={() => openEmail("audit_query_dispatch")}>
            <Mail size={13}/> Dispatch Queries
          </Button>
          <Button size="sm" variant="outline" className="gap-1 h-8 text-xs"
            onClick={() => openEmail("audit_query_reminder")}>
            <Mail size={13}/> Send Reminder
          </Button>
          <Button size="sm" className="gap-1 h-8 text-xs bg-indigo-600 hover:bg-indigo-700"
            onClick={exportPdf} disabled={exporting}>
            {exporting ? <Loader2 size={13} className="animate-spin"/> : <FileDown size={13}/>}
            Export PDF
          </Button>
        </div>
      </div>

      {/* Phase 4A/4C: Reminder + escalation rules panel */}
      <ReminderRulesPanel
        rules={rules}
        onSetRules={setRules}
        pendingCount={pendingReminders.length}
        onSendReminders={sendPendingReminders}
        escalationCount={escalationCandidates.length}
        onEscalate={sendEscalation}
      />

      {/* Filter tabs */}
      {queries.length > 0 && (
        <div className="flex gap-1 p-1 bg-muted rounded-lg w-fit text-xs">
          {([
            { key: "all",     label: `All (${queries.length})` },
            { key: "open",    label: `Open (${queries.filter(q => ["Open","Client Acknowledged"].includes(q.status)).length})` },
            { key: "replied", label: `Replied (${newReplies})` },
            { key: "closed",  label: `Closed (${queries.filter(q => ["Clarified","Closed"].includes(q.status)).length})` },
          ] as const).map(({ key, label }) => (
            <button key={key} type="button" onClick={() => setFilter(key)}
              className={cn("px-3 py-1 rounded-md font-medium transition-colors",
                filter === key ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
              )}>
              {label}
            </button>
          ))}
        </div>
      )}

      {/* Query list */}
      {queries.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-48 gap-3 text-muted-foreground">
          <MessageSquareWarning size={36} className="opacity-25"/>
          <div className="text-center">
            <p className="text-sm font-medium text-foreground">No client queries yet</p>
            <p className="text-xs mt-1">Use Dispatch Queries to send queries to the client.</p>
          </div>
        </div>
      ) : displayed.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">No queries in this category.</p>
      ) : (
        <div className="space-y-3">
          {displayed.map(q => (
            <QueryThread
              key={q.id}
              query={q}
              onStatusChange={fetchQueries}
              onRemind={() => openEmail("audit_query_reminder", [q])}
            />
          ))}
        </div>
      )}

      {/* Email Compose dialog */}
      {emailPayload && (
        <EmailComposeDialog
          open={!!emailPayload}
          onClose={() => setEmailPayload(null)}
          defaultPayload={emailPayload}
          onSent={() => {
            if (emailPayload.templateType === "audit_query_reminder") {
              // Phase 4A: mark pending reminders as sent
              if (pendingReminders.length) {
                markSent(pendingReminders.map(q => q.id));
              }
              // Phase 4C: mark escalated queries so they don't re-trigger immediately
              if (escalationCandidates.length) {
                markEscalated(escalationCandidates.map(q => q.id));
              }
            }
            setEmailPayload(null);
          }}
        />
      )}
    </div>
  );
}
