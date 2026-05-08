/**
 * PortalQueries — Client-facing audit query page
 *
 * Features (Phase 2):
 *  - All audit_client_queries for the logged-in client
 *  - Per-query conversation thread (portal_query_messages)
 *  - File attachment per reply (stored in firm-assets bucket)
 *  - Required documents list per query
 *  - Realtime updates via Supabase channel
 *  - Status badge + priority indicator
 */
import { useState, useEffect, useCallback, useRef } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import {
  MessageSquareWarning, Send, Loader2, Paperclip, Download,
  ChevronDown, ChevronUp, FileText, X, CheckCircle2,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

interface AuditQuery {
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
  client_reply: string | null;         // legacy single-reply field
  firm_id: string | null;
}

interface Message {
  id: string;
  query_id: string;
  sender_role: "auditor" | "client";
  sender_name: string | null;
  message: string;
  attachment_path: string | null;
  attachment_name: string | null;
  created_at: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_STYLE: Record<string, string> = {
  "Open":                 "bg-red-100 text-red-700 border-red-200",
  "Client Acknowledged":  "bg-blue-100 text-blue-700 border-blue-200",
  "Reply Received":       "bg-purple-100 text-purple-700 border-purple-200",
  "Clarified":            "bg-green-100 text-green-700 border-green-200",
  "Carried Forward":      "bg-amber-100 text-amber-700 border-amber-200",
  "Closed":               "bg-muted text-muted-foreground border-border",
};

const PRIORITY_STYLE: Record<string, string> = {
  "High":   "text-red-600",
  "Medium": "text-amber-600",
  "Low":    "text-green-600",
};

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
  });
}

// ─── QueryCard ────────────────────────────────────────────────────────────────

function QueryCard({
  query,
  clientId,
  clientName,
}: {
  query: AuditQuery;
  clientId: string;
  clientName: string;
}) {
  const [messages,   setMessages]   = useState<Message[]>([]);
  const [expanded,   setExpanded]   = useState(false);
  const [loadingMsg, setLoadingMsg] = useState(false);
  const [replyText,  setReplyText]  = useState("");
  const [sending,    setSending]    = useState(false);
  const [file,       setFile]       = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const bottomRef    = useRef<HTMLDivElement>(null);

  const fetchMessages = useCallback(async () => {
    setLoadingMsg(true);
    const { data } = await (supabase as any)
      .from("portal_query_messages")
      .select("*")
      .eq("query_id", query.id)
      .order("created_at", { ascending: true });
    setMessages((data as Message[]) || []);
    setLoadingMsg(false);
  }, [query.id]);

  useEffect(() => {
    if (!expanded) return;
    fetchMessages();
    // Realtime
    const channel = supabase
      .channel(`pqm-${query.id}`)
      .on("postgres_changes", {
        event: "INSERT", schema: "public", table: "portal_query_messages",
        filter: `query_id=eq.${query.id}`,
      }, () => fetchMessages())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [expanded, fetchMessages, query.id]);

  // Scroll to bottom on new messages
  useEffect(() => {
    if (expanded && messages.length > 0) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, expanded]);

  const sendReply = async () => {
    if (!replyText.trim() && !file) {
      toast.error("Please type a message or attach a file");
      return;
    }
    setSending(true);
    try {
      let attachPath: string | null = null;
      let attachName: string | null = null;

      // Upload attachment if present
      if (file) {
        const path = `query-docs/${query.id}/${Date.now()}_${file.name}`;
        const { error: upErr } = await supabase.storage
          .from("firm-assets")
          .upload(path, file, { upsert: false });
        if (upErr) throw upErr;
        attachPath = path;
        attachName = file.name;
      }

      // Post message
      const { error } = await (supabase as any)
        .from("portal_query_messages")
        .insert({
          query_id:        query.id,
          sender_role:     "client",
          sender_name:     clientName,
          message:         replyText.trim(),
          attachment_path: attachPath,
          attachment_name: attachName,
        });
      if (error) throw error;

      // Update query status to Reply Received
      await supabase
        .from("audit_client_queries" as any)
        .update({ status: "Reply Received", client_reply: replyText.trim(), replied_via: "portal" } as any)
        .eq("id", query.id);

      setReplyText("");
      setFile(null);
      toast.success("Reply sent successfully");
      fetchMessages();

      // ── Notify firm: client has replied ───────────────────────────
      if (query.firm_id) {
        supabase.functions.invoke("send-notification", {
          body: {
            type:         "audit_query_dispatch",
            firm_id:      query.firm_id,
            direct_email: "info@vjdesai.com",
            payload: {
              client_name:    clientName,
              custom_message: `${clientName} has responded to an audit query${query.ref_number ? ` (Ref: ${query.ref_number})` : ""}. Please log in to CAFlow to review the response.`,
              custom_subject: `Client Response Received — ${clientName}`,
            },
          },
        }).catch(() => { /* non-blocking */ });
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to send reply");
    } finally {
      setSending(false);
    }
  };

  const downloadAttachment = async (path: string, name: string) => {
    try {
      const { data, error } = await supabase.storage.from("firm-assets").createSignedUrl(path, 60);
      if (error) throw error;
      const a = document.createElement("a");
      a.href = data.signedUrl;
      a.download = name;
      a.click();
    } catch (err: any) {
      toast.error("Download failed: " + err.message);
    }
  };

  const isClosed = query.status === "Clarified" || query.status === "Closed";
  const reqDocs  = query.required_documents?.split(",").map(s => s.trim()).filter(Boolean) ?? [];

  return (
    <Card className={cn("overflow-hidden border", isClosed && "opacity-75")}>
      {/* ── Query header ── */}
      <CardHeader
        className="pb-0 cursor-pointer select-none"
        onClick={() => setExpanded(v => !v)}
      >
        <div className="flex items-start gap-3">
          {/* Priority dot */}
          <div className={cn("mt-1 w-2 h-2 rounded-full flex-shrink-0 bg-current", PRIORITY_STYLE[query.priority] || "text-muted-foreground")} />

          <div className="flex-1 min-w-0">
            {/* Top row: ref + status + FY + due */}
            <div className="flex flex-wrap items-center gap-2 mb-1">
              {query.ref_number && (
                <span className="font-mono text-xs text-muted-foreground">{query.ref_number}</span>
              )}
              <Badge className={cn("text-[10px] border", STATUS_STYLE[query.status] || STATUS_STYLE["Open"])}>
                {query.status}
              </Badge>
              {query.financial_year && (
                <Badge variant="outline" className="text-[10px]">FY {query.financial_year}</Badge>
              )}
              {query.group_name && (
                <span className="text-xs text-muted-foreground">{query.group_name}</span>
              )}
              {query.ledger_name && (
                <Badge variant="secondary" className="text-[10px]">{query.ledger_name}</Badge>
              )}
              {query.due_date && (
                <span className="text-xs text-muted-foreground ml-auto">Due: {fmtDate(query.due_date)}</span>
              )}
            </div>

            {/* Query text */}
            <p className="text-sm text-foreground leading-relaxed">{query.query_text}</p>

            {/* Required documents */}
            {reqDocs.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                <span className="text-xs text-muted-foreground font-medium mr-1">Required:</span>
                {reqDocs.map((d, i) => (
                  <Badge key={i} variant="outline" className="text-[10px] gap-1 border-amber-300 text-amber-700">
                    <FileText size={9} /> {d}
                  </Badge>
                ))}
              </div>
            )}
          </div>

          <button type="button" className="text-muted-foreground flex-shrink-0 mt-0.5">
            {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
        </div>
      </CardHeader>

      {/* ── Conversation thread ── */}
      {expanded && (
        <CardContent className="pt-4 space-y-3">
          <div className="border-t pt-3">
            {loadingMsg ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground py-3">
                <Loader2 size={13} className="animate-spin" /> Loading conversation…
              </div>
            ) : messages.length === 0 && !query.client_reply ? (
              <p className="text-xs text-muted-foreground py-3 text-center">
                No messages yet. Send a reply below.
              </p>
            ) : (
              <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                {/* Legacy single reply (migration bridge) */}
                {query.client_reply && messages.length === 0 && (
                  <div className="flex justify-end">
                    <div className="max-w-[80%] bg-primary/10 border border-primary/20 rounded-xl rounded-tr-sm px-3 py-2">
                      <p className="text-[10px] text-muted-foreground mb-0.5 font-medium">You · Earlier reply</p>
                      <p className="text-sm">{query.client_reply}</p>
                    </div>
                  </div>
                )}

                {messages.map(msg => {
                  const isClient = msg.sender_role === "client";
                  return (
                    <div key={msg.id} className={cn("flex", isClient ? "justify-end" : "justify-start")}>
                      <div className={cn(
                        "max-w-[80%] rounded-xl px-3 py-2 space-y-1",
                        isClient
                          ? "bg-primary/10 border border-primary/20 rounded-tr-sm"
                          : "bg-muted border border-border rounded-tl-sm"
                      )}>
                        <div className="flex items-baseline gap-2">
                          <span className="text-[10px] font-semibold text-muted-foreground">
                            {isClient ? "You" : (msg.sender_name || "Auditor")}
                          </span>
                          <span className="text-[9px] text-muted-foreground">{fmtTime(msg.created_at)}</span>
                        </div>
                        {msg.message && <p className="text-sm">{msg.message}</p>}
                        {msg.attachment_path && msg.attachment_name && (
                          <button
                            type="button"
                            onClick={() => downloadAttachment(msg.attachment_path!, msg.attachment_name!)}
                            className="flex items-center gap-1.5 text-xs text-primary hover:underline mt-1"
                          >
                            <Paperclip size={11} />
                            {msg.attachment_name}
                            <Download size={10} />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
                <div ref={bottomRef} />
              </div>
            )}

            {/* Reply box — hidden if closed */}
            {!isClosed && (
              <div className="mt-3 space-y-2 border-t pt-3">
                <Textarea
                  value={replyText}
                  onChange={e => setReplyText(e.target.value)}
                  placeholder="Type your reply or explanation…"
                  rows={3}
                  className="resize-none text-sm"
                />

                {/* File attachment preview */}
                {file && (
                  <div className="flex items-center gap-2 px-2 py-1.5 bg-muted rounded-md text-xs">
                    <Paperclip size={12} className="text-muted-foreground" />
                    <span className="flex-1 truncate">{file.name}</span>
                    <button type="button" onClick={() => setFile(null)} className="text-muted-foreground hover:text-destructive">
                      <X size={12} />
                    </button>
                  </div>
                )}

                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5 h-8 text-xs"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Paperclip size={13} /> Attach File
                  </Button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    className="hidden"
                    onChange={e => { const f = e.target.files?.[0]; if (f) setFile(f); e.target.value = ""; }}
                  />
                  <Button
                    size="sm"
                    className="gap-1.5 h-8 text-xs ml-auto"
                    onClick={sendReply}
                    disabled={sending || (!replyText.trim() && !file)}
                  >
                    {sending ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                    Send Reply
                  </Button>
                </div>
              </div>
            )}

            {isClosed && (
              <div className="mt-3 flex items-center gap-2 text-xs text-green-700 border-t pt-3">
                <CheckCircle2 size={14} /> This query has been {query.status.toLowerCase()}.
              </div>
            )}
          </div>
        </CardContent>
      )}
    </Card>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function PortalQueries() {
  const { user } = useAuth();
  const [loading,    setLoading]    = useState(true);
  const [queries,    setQueries]    = useState<AuditQuery[]>([]);
  const [clientId,   setClientId]   = useState<string>("");
  const [clientName, setClientName] = useState<string>("");
  const [filter,     setFilter]     = useState<"all" | "open" | "closed">("open");

  const fetchQueries = useCallback(async () => {
    if (!user) return;
    setLoading(true);

    const { data: client } = await supabase
      .from("clients")
      .select("id, name")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!client) { setLoading(false); return; }
    setClientId(client.id);
    setClientName(client.name || "");

    const { data } = await (supabase as any)
      .from("audit_client_queries")
      .select("id,ref_number,query_text,status,priority,due_date,financial_year,required_documents,ledger_name,group_name,client_reply,firm_id")
      .eq("client_id", client.id)
      .order("created_at", { ascending: false });

    setQueries((data as AuditQuery[]) || []);
    setLoading(false);
  }, [user]);

  useEffect(() => { fetchQueries(); }, [fetchQueries]);

  // Realtime on audit_client_queries
  useEffect(() => {
    const ch = supabase
      .channel("portal-queries-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "audit_client_queries" }, fetchQueries)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [fetchQueries]);

  const displayed = queries.filter(q => {
    if (filter === "open")   return !["Clarified", "Closed"].includes(q.status);
    if (filter === "closed") return  ["Clarified", "Closed"].includes(q.status);
    return true;
  });

  const openCount   = queries.filter(q => !["Clarified", "Closed"].includes(q.status)).length;
  const closedCount = queries.filter(q =>  ["Clarified", "Closed"].includes(q.status)).length;

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-32" />
        <Skeleton className="h-32" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold flex items-center gap-2">
          <MessageSquareWarning size={22} className="text-primary" /> Audit Queries
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          {openCount > 0
            ? `${openCount} active ${openCount === 1 ? "query" : "queries"} pending your response`
            : "No pending queries — you're all caught up!"}
        </p>
      </div>

      {/* Filter tabs */}
      {queries.length > 0 && (
        <div className="flex gap-1 p-1 bg-muted rounded-lg w-fit">
          {([
            { key: "open",   label: `Open (${openCount})` },
            { key: "closed", label: `Resolved (${closedCount})` },
            { key: "all",    label: `All (${queries.length})` },
          ] as const).map(({ key, label }) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              className={cn(
                "px-3 py-1 rounded-md text-xs font-medium transition-colors",
                filter === key ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {/* Query list */}
      {displayed.length === 0 ? (
        <Card>
          <CardContent className="py-14 text-center text-muted-foreground">
            <MessageSquareWarning className="mx-auto h-10 w-10 mb-3 opacity-25" />
            <p className="text-sm">
              {filter === "open" ? "No active queries at this time." : "No queries in this category."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {displayed.map(q => (
            <QueryCard key={q.id} query={q} clientId={clientId} clientName={clientName} />
          ))}
        </div>
      )}
    </div>
  );
}
