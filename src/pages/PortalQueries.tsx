/**
 * PortalQueries — Client-facing audit query page (Multi-entity)
 *
 * Uses PortalClientContext so shared-email accounts see queries for the
 * currently selected entity. Theme: CAFlow navy + orange-600.
 *
 * Features:
 *  - All audit_client_queries for the active client entity
 *  - Per-query conversation thread (portal_query_messages)
 *  - File attachment per reply
 *  - Required documents list per query
 *  - Realtime updates via Supabase channels
 *  - Status badge + priority indicator
 *  - Entity switcher hint (when multi-entity)
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { usePortalClient } from "@/contexts/PortalClientContext";
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
  Building2,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

interface AuditQuery {
  id:                  string;
  ref_number:          string | null;
  query_text:          string;
  status:              string;
  priority:            string;
  due_date:            string | null;
  financial_year:      string | null;
  required_documents:  string | null;
  ledger_name:         string | null;
  group_name:          string | null;
  client_reply:        string | null;
  firm_id:             string | null;
}

interface Message {
  id:              string;
  query_id:        string;
  sender_role:     "auditor" | "client";
  sender_name:     string | null;
  message:         string;
  attachment_path: string | null;
  attachment_name: string | null;
  created_at:      string;
}

// ─── Status / Priority styling ────────────────────────────────────────────────

const STATUS_STYLE: Record<string, string> = {
  "Open":                "bg-red-100 text-red-700 border-red-200",
  "Client Acknowledged": "bg-blue-100 text-blue-700 border-blue-200",
  "Reply Received":      "bg-purple-100 text-purple-700 border-purple-200",
  "Clarified":           "bg-green-100 text-green-700 border-green-200",
  "Carried Forward":     "bg-amber-100 text-amber-700 border-amber-200",
  "Closed":              "bg-gray-100 text-gray-500 border-gray-200",
};

const PRIORITY_DOT: Record<string, string> = {
  High:   "bg-red-500",
  Medium: "bg-amber-400",
  Low:    "bg-green-500",
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
  clientName,
}: {
  query:      AuditQuery;
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
    const channel = supabase
      .channel(`pqm-${query.id}`)
      .on("postgres_changes", {
        event: "INSERT", schema: "public", table: "portal_query_messages",
        filter: `query_id=eq.${query.id}`,
      }, () => fetchMessages())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [expanded, fetchMessages, query.id]);

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

      if (file) {
        const path = `query-docs/${query.id}/${Date.now()}_${file.name}`;
        const { error: upErr } = await supabase.storage
          .from("firm-assets")
          .upload(path, file, { upsert: false });
        if (upErr) throw upErr;
        attachPath = path;
        attachName = file.name;
      }

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

      await supabase
        .from("audit_client_queries" as any)
        .update({ status: "Reply Received", client_reply: replyText.trim(), replied_via: "portal" } as any)
        .eq("id", query.id);

      setReplyText("");
      setFile(null);
      toast.success("Reply sent successfully");
      fetchMessages();

      // Notify firm
      if (query.firm_id) {
        supabase.functions.invoke("send-notification", {
          body: {
            type:         "audit_query_dispatch",
            firm_id:      query.firm_id,
            direct_email: "info@vjdesai.com",
            payload: {
              client_name:    clientName,
              custom_message: `${clientName} has responded to an audit query${query.ref_number ? ` (Ref: ${query.ref_number})` : ""}. Please log in to CAFlow to review.`,
              custom_subject: `Client Response — ${clientName}`,
            },
          },
        }).catch(() => {});
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to send reply");
    } finally {
      setSending(false);
    }
  };

  const downloadAttachment = async (path: string, name: string) => {
    try {
      const { data, error } = await supabase.storage
        .from("firm-assets")
        .createSignedUrl(path, 60);
      if (error) throw error;
      const a = document.createElement("a");
      a.href  = data.signedUrl;
      a.download = name;
      a.click();
    } catch (err: any) {
      toast.error("Download failed: " + err.message);
    }
  };

  const isClosed = query.status === "Clarified" || query.status === "Closed";
  const reqDocs  = query.required_documents?.split(",").map(s => s.trim()).filter(Boolean) ?? [];
  const isOverdue = query.due_date && new Date(query.due_date) < new Date() && !isClosed;

  return (
    <Card className={cn("overflow-hidden border transition-shadow hover:shadow-md", isClosed && "opacity-70")}>
      {/* ── Query header ── */}
      <CardHeader
        className={cn(
          "pb-2 cursor-pointer select-none",
          isOverdue ? "bg-red-50/40" : expanded ? "bg-orange-50/40" : "",
        )}
        onClick={() => setExpanded(v => !v)}
      >
        <div className="flex items-start gap-3">
          {/* Priority dot */}
          <div className={cn(
            "mt-1.5 w-2.5 h-2.5 rounded-full flex-shrink-0",
            PRIORITY_DOT[query.priority] || "bg-gray-300",
          )} />

          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-1">
              {query.ref_number && (
                <span className="font-mono text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                  {query.ref_number}
                </span>
              )}
              <Badge className={cn("text-[10px] border", STATUS_STYLE[query.status] || STATUS_STYLE["Open"])}>
                {query.status}
              </Badge>
              {query.financial_year && (
                <Badge variant="outline" className="text-[10px]">FY {query.financial_year}</Badge>
              )}
              {query.group_name && (
                <span className="text-[10px] text-muted-foreground font-medium">{query.group_name}</span>
              )}
              {query.ledger_name && (
                <Badge variant="secondary" className="text-[10px]">{query.ledger_name}</Badge>
              )}
              {query.due_date && (
                <span className={cn(
                  "text-[10px] ml-auto font-medium",
                  isOverdue ? "text-red-600" : "text-muted-foreground",
                )}>
                  {isOverdue ? "⚠ Overdue — " : "Due: "}{fmtDate(query.due_date)}
                </span>
              )}
            </div>

            <p className="text-sm text-foreground leading-relaxed">{query.query_text}</p>

            {reqDocs.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                <span className="text-[10px] text-muted-foreground font-medium mr-1">Required docs:</span>
                {reqDocs.map((d, i) => (
                  <Badge key={i} variant="outline" className="text-[10px] gap-1 border-orange-300 text-orange-700">
                    <FileText size={9} /> {d}
                  </Badge>
                ))}
              </div>
            )}
          </div>

          <button type="button" className="text-muted-foreground flex-shrink-0 mt-0.5 hover:text-foreground">
            {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
        </div>
      </CardHeader>

      {/* ── Conversation thread ── */}
      {expanded && (
        <CardContent className="pt-4 space-y-3 border-t border-orange-100">
          {loadingMsg ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground py-3">
              <Loader2 size={13} className="animate-spin text-orange-500" /> Loading conversation…
            </div>
          ) : (
            <>
              {messages.length === 0 && !query.client_reply ? (
                <p className="text-xs text-muted-foreground py-3 text-center">
                  No messages yet. Send your reply below.
                </p>
              ) : (
                <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                  {/* Legacy single-reply bridge */}
                  {query.client_reply && messages.length === 0 && (
                    <div className="flex justify-end">
                      <div className="max-w-[80%] bg-orange-50 border border-orange-200 rounded-xl rounded-tr-sm px-3 py-2">
                        <p className="text-[10px] text-orange-600 mb-0.5 font-medium">You · Earlier reply</p>
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
                            ? "bg-orange-50 border border-orange-200 rounded-tr-sm"
                            : "bg-[#1A2744]/5 border border-[#1A2744]/10 rounded-tl-sm",
                        )}>
                          <div className="flex items-baseline gap-2">
                            <span className={cn(
                              "text-[10px] font-semibold",
                              isClient ? "text-orange-700" : "text-[#1A2744]",
                            )}>
                              {isClient ? "You" : (msg.sender_name || "Auditor")}
                            </span>
                            <span className="text-[9px] text-muted-foreground">{fmtTime(msg.created_at)}</span>
                          </div>
                          {msg.message && <p className="text-sm">{msg.message}</p>}
                          {msg.attachment_path && msg.attachment_name && (
                            <button
                              type="button"
                              onClick={() => downloadAttachment(msg.attachment_path!, msg.attachment_name!)}
                              className="flex items-center gap-1.5 text-xs text-orange-600 hover:underline mt-1"
                            >
                              <Paperclip size={11} /> {msg.attachment_name} <Download size={10} />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  <div ref={bottomRef} />
                </div>
              )}

              {/* Reply box */}
              {!isClosed ? (
                <div className="mt-3 space-y-2 border-t border-orange-100 pt-3">
                  <Textarea
                    value={replyText}
                    onChange={e => setReplyText(e.target.value)}
                    placeholder="Type your reply or explanation…"
                    rows={3}
                    className="resize-none text-sm border-orange-200 focus:ring-orange-400"
                  />

                  {file && (
                    <div className="flex items-center gap-2 px-2 py-1.5 bg-orange-50 rounded-md text-xs border border-orange-200">
                      <Paperclip size={12} className="text-orange-500" />
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
                      className="gap-1.5 h-8 text-xs border-orange-300 text-orange-700 hover:bg-orange-50"
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
                      className="gap-1.5 h-8 text-xs ml-auto bg-orange-600 hover:bg-orange-700"
                      onClick={sendReply}
                      disabled={sending || (!replyText.trim() && !file)}
                    >
                      {sending ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                      Send Reply
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="mt-3 flex items-center gap-2 text-xs text-green-700 border-t border-green-100 pt-3">
                  <CheckCircle2 size={14} /> This query has been {query.status.toLowerCase()}.
                </div>
              )}
            </>
          )}
        </CardContent>
      )}
    </Card>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function PortalQueries() {
  const { activeClient, clients, loading: clientLoading } = usePortalClient();
  const [loading,    setLoading]    = useState(true);
  const [queries,    setQueries]    = useState<AuditQuery[]>([]);
  const [filter,     setFilter]     = useState<"all" | "open" | "closed">("open");

  const fetchQueries = useCallback(async () => {
    if (!activeClient) return;
    setLoading(true);

    const { data } = await (supabase as any)
      .from("audit_client_queries")
      .select("id,ref_number,query_text,status,priority,due_date,financial_year,required_documents,ledger_name,group_name,client_reply,firm_id")
      .eq("client_id", activeClient.id)
      .order("created_at", { ascending: false });

    setQueries((data as AuditQuery[]) || []);
    setLoading(false);
  }, [activeClient]);

  useEffect(() => { fetchQueries(); }, [fetchQueries]);

  // Realtime
  useEffect(() => {
    if (!activeClient) return;
    const ch = supabase
      .channel(`portal-queries-rt-${activeClient.id}`)
      .on("postgres_changes", {
        event: "*", schema: "public", table: "audit_client_queries",
        filter: `client_id=eq.${activeClient.id}`,
      }, fetchQueries)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [activeClient, fetchQueries]);

  const displayed  = queries.filter(q => {
    if (filter === "open")   return !["Clarified", "Closed"].includes(q.status);
    if (filter === "closed") return  ["Clarified", "Closed"].includes(q.status);
    return true;
  });

  const openCount   = queries.filter(q => !["Clarified", "Closed"].includes(q.status)).length;
  const closedCount = queries.filter(q =>  ["Clarified", "Closed"].includes(q.status)).length;

  // ── Loading states ─────────────────────────────────────────────────────────

  if (clientLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-32" />
        <Skeleton className="h-32" />
      </div>
    );
  }

  if (!activeClient) {
    return (
      <div className="text-center py-20 text-muted-foreground">
        <Building2 className="mx-auto h-12 w-12 mb-4 opacity-20" />
        <p>No client profile found. Contact your CA firm.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-32" />
        <Skeleton className="h-32" />
      </div>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5">

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2 text-[#1A2744]">
            <MessageSquareWarning size={22} className="text-orange-600" />
            Audit Queries
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {activeClient.name}
            {clients.length > 1 && (
              <span className="ml-2 text-[11px] bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded-full font-medium">
                Switch entity from top bar
              </span>
            )}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {openCount > 0
              ? `${openCount} active ${openCount === 1 ? "query" : "queries"} pending your response`
              : "No pending queries — you're all caught up! ✓"}
          </p>
        </div>
      </div>

      {/* Filter tabs */}
      {queries.length > 0 && (
        <div className="flex gap-1 p-1 bg-muted rounded-lg w-fit">
          {([
            { key: "open",   label: `Open (${openCount})`       },
            { key: "closed", label: `Resolved (${closedCount})` },
            { key: "all",    label: `All (${queries.length})`   },
          ] as const).map(({ key, label }) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              className={cn(
                "px-3 py-1 rounded-md text-xs font-medium transition-colors",
                filter === key
                  ? "bg-orange-600 text-white shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
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
            <MessageSquareWarning className="mx-auto h-10 w-10 mb-3 text-orange-200" />
            <p className="text-sm font-medium">
              {filter === "open"
                ? "No active queries at this time. Your CA firm will send queries here."
                : "No queries in this category."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {displayed.map(q => (
            <QueryCard key={q.id} query={q} clientName={activeClient.name} />
          ))}
        </div>
      )}
    </div>
  );
}
