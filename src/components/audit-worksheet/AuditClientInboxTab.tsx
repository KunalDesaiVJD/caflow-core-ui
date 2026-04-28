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
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  MessageSquareWarning, Send, Loader2, Paperclip, Download, X,
  Plus, ChevronDown, ChevronUp, CheckCircle2, Clock, Users, Mail,
} from "lucide-react";
import { EmailComposeDialog, EmailComposePayload } from "@/components/email/EmailComposeDialog";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import type { AuditWorksheetData } from "./hooks/useAuditWorksheetData";

// ─── Types ────────────────────────────────────────────────────────────────────

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

// ─── QueryThread ─────────────────────────────────────────────────────────────

function QueryThread({ query, onStatusChange }: { query: ClientQuery; onStatusChange: () => void }) {
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

  const updateStatus = async (status: string) => {
    await supabase.from("audit_client_queries" as any).update({ status } as any).eq("id", query.id);
    onStatusChange();
    toast.success(`Status → ${status}`);
  };

  const hasNewReply = query.status === "Reply Received";

  return (
    <Card className={cn("overflow-hidden", hasNewReply && "ring-2 ring-primary/40")}>
      <CardHeader
        className={cn("pb-0 cursor-pointer", hasNewReply && "bg-primary/5")}
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
              {query.due_date && (
                <span className="text-xs text-muted-foreground ml-auto flex items-center gap-1">
                  <Clock size={10} /> {query.due_date}
                </span>
              )}
            </div>
            <p className="text-sm leading-relaxed line-clamp-2">{query.query_text}</p>
          </div>
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

// ─── New Query Dialog ─────────────────────────────────────────────────────────

function NewQueryDialog({
  open, onClose, engagementId, clientId, firmId, financialYear, onCreated,
}: {
  open: boolean; onClose: () => void;
  engagementId: string; clientId: string; firmId: string | null;
  financialYear: string; onCreated: () => void;
}) {
  const [form, setForm] = useState({
    query_text: "", required_documents: "", ledger_name: "", group_name: "",
    priority: "Medium", due_date: "",
  });
  const [saving, setSaving] = useState(false);
  const set = (k: string, v: string) => setForm(p => ({ ...p, [k]: v }));

  const submit = async () => {
    if (!form.query_text.trim()) { toast.error("Query text is required"); return; }
    setSaving(true);
    const { error } = await supabase
      .from("audit_client_queries" as any)
      .insert({
        query_text:         form.query_text,
        required_documents: form.required_documents || null,
        ledger_name:        form.ledger_name || null,
        group_name:         form.group_name || null,
        priority:           form.priority,
        due_date:           form.due_date || null,
        engagement_id:      engagementId,
        client_id:          clientId,
        firm_id:            firmId,
        financial_year:     financialYear,
        status:             "Open",
        source:             "manual",
      } as any);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Query sent to client");
    onCreated(); onClose();
    setForm({ query_text:"", required_documents:"", ledger_name:"", group_name:"", priority:"Medium", due_date:"" });
  };

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageSquareWarning size={16}/> New Query to Client
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div>
            <label className="text-xs font-medium mb-1 block">Query *</label>
            <Textarea value={form.query_text} onChange={e => set("query_text", e.target.value)}
              placeholder="Describe the query for the client…" rows={3} className="text-sm resize-none"/>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium mb-1 block">Group / Subgroup</label>
              <Input value={form.group_name} onChange={e => set("group_name", e.target.value)}
                placeholder="e.g. Sundry Creditors" className="h-8 text-xs"/>
            </div>
            <div>
              <label className="text-xs font-medium mb-1 block">Ledger</label>
              <Input value={form.ledger_name} onChange={e => set("ledger_name", e.target.value)}
                placeholder="e.g. ABC Traders" className="h-8 text-xs"/>
            </div>
          </div>
          <div>
            <label className="text-xs font-medium mb-1 block">Required Documents</label>
            <Input value={form.required_documents} onChange={e => set("required_documents", e.target.value)}
              placeholder="e.g. Invoice, Bank statement, TDS certificate" className="h-8 text-xs"/>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium mb-1 block">Priority</label>
              <Select value={form.priority} onValueChange={v => set("priority", v)}>
                <SelectTrigger className="h-8 text-xs"><SelectValue/></SelectTrigger>
                <SelectContent>
                  {PRIORITIES.map(p => <SelectItem key={p} value={p} className="text-xs">{p}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium mb-1 block">Due Date</label>
              <Input type="date" value={form.due_date} onChange={e => set("due_date", e.target.value)} className="h-8 text-xs"/>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={submit} disabled={saving} className="gap-1">
            {saving ? <Loader2 size={13} className="animate-spin"/> : <Send size={13}/>} Send to Client
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Tab ─────────────────────────────────────────────────────────────────

interface Props {
  data:         AuditWorksheetData;
  engagementId: string;
}

export function AuditClientInboxTab({ data, engagementId }: Props) {
  const [queries,      setQueries]      = useState<ClientQuery[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [newQueryOpen, setNewQueryOpen] = useState(false);
  const [filter,       setFilter]       = useState<"all"|"open"|"replied"|"closed">("all");
  const [emailPayload, setEmailPayload] = useState<EmailComposePayload | null>(null);

  const fetchQueries = useCallback(async () => {
    if (!engagementId) return;
    const { data: rows } = await (supabase as any)
      .from("audit_client_queries")
      .select("id,ref_number,query_text,status,priority,due_date,financial_year,required_documents,ledger_name,group_name,client_reply,internal_notes,created_at")
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
      queries:       qs.map(q => ({
        ref_number:         q.ref_number,
        query_text:         q.query_text,
        required_documents: q.required_documents,
        group_name:         q.group_name,
        ledger_name:        q.ledger_name,
      })),
    });
  };

  const displayed = queries.filter(q => {
    if (filter === "open")    return q.status === "Open" || q.status === "Client Acknowledged";
    if (filter === "replied") return q.status === "Reply Received";
    if (filter === "closed")  return q.status === "Clarified" || q.status === "Closed";
    return true;
  });

  const newReplies = queries.filter(q => q.status === "Reply Received").length;

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
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <MessageSquareWarning size={16} className="text-orange-600"/>
            Client Query Inbox
            {newReplies > 0 && (
              <Badge className="bg-primary text-primary-foreground text-[10px] h-4 px-1.5">
                {newReplies} new {newReplies === 1 ? "reply" : "replies"}
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
          <Button size="sm" className="gap-1 h-8 text-xs bg-orange-600 hover:bg-orange-700"
            onClick={() => setNewQueryOpen(true)}>
            <Plus size={13}/> New Query
          </Button>
        </div>
      </div>

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
            <p className="text-xs mt-1">Create a new query to start communicating with the client.</p>
          </div>
          <Button size="sm" className="gap-1 mt-2 bg-orange-600 hover:bg-orange-700"
            onClick={() => setNewQueryOpen(true)}>
            <Plus size={13}/> New Query to Client
          </Button>
        </div>
      ) : displayed.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">No queries in this category.</p>
      ) : (
        <div className="space-y-3">
          {displayed.map(q => (
            <QueryThread key={q.id} query={q} onStatusChange={fetchQueries}/>
          ))}
        </div>
      )}

      {/* New Query dialog */}
      <NewQueryDialog
        open={newQueryOpen}
        onClose={() => setNewQueryOpen(false)}
        engagementId={engagementId}
        clientId={data.engagement?.client_id || ""}
        firmId={data.engagement?.firm_id || null}
        financialYear={data.financialYear}
        onCreated={fetchQueries}
      />

      {/* Email Compose dialog */}
      {emailPayload && (
        <EmailComposeDialog
          open={!!emailPayload}
          onClose={() => setEmailPayload(null)}
          defaultPayload={emailPayload}
          onSent={() => setEmailPayload(null)}
        />
      )}
    </div>
  );
}
