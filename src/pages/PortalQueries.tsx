/**
 * PortalQueries — Client-facing audit query page
 *
 * Shows queries for the currently selected entity (controlled by the entity
 * switcher in the top navbar). Use the navbar dropdown to switch between
 * entities — no need to show all entities as tabs here too.
 *
 * Features:
 *  - Open / Resolved / All status filter
 *  - Per-query conversation thread with file attachments
 *  - Realtime updates via Supabase channels
 *  - Priority indicators, due-date overdue alerts
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
  ChevronDown, ChevronUp, FileText, X, CheckCircle2, Building2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { CLIENT_HIDDEN_QUERY_STATUSES } from "@/lib/scrutiny/makerChecker";

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
  client_id:           string;
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

// ─── Styling maps ─────────────────────────────────────────────────────────────

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

function QueryCard({ query, clientName }: { query: AuditQuery; clientName: string }) {
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
    const ch = supabase
      .channel(`pqm-${query.id}`)
      .on("postgres_changes", {
        event: "INSERT", schema: "public", table: "portal_query_messages",
        filter: `query_id=eq.${query.id}`,
      }, () => fetchMessages())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [expanded, fetchMessages, query.id]);

  useEffect(() => {
    if (expanded && messages.length > 0) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, expanded]);

  const sendReply = async () => {
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
      const { error } = await (supabase as any).from("portal_query_messages").insert({
        query_id: query.id, sender_role: "client", sender_name: clientName,
        message: replyText.trim(), attachment_path: attachPath, attachment_name: attachName,
      });
      if (error) throw error;
      await supabase.from("audit_client_queries" as any)
        .update({ status: "Reply Received", client_reply: replyText.trim(), replied_via: "portal" } as any)
        .eq("id", query.id);
      setReplyText(""); setFile(null);
      toast.success("Reply sent");
      fetchMessages();
      if (query.firm_id) {
        supabase.functions.invoke("send-notification", {
          body: {
            type: "portal_client_activity",
            firm_id: query.firm_id,
            client_id: query.client_id,
            payload: {
              client_name:     clientName,
              activity_type:   "query_reply",
              details:         `Query ${query.ref_number || ""}: ${replyText.trim().slice(0, 80)}${replyText.trim().length > 80 ? "…" : ""}`,
              // Rich metadata shown in digest email
              query_ref:       query.ref_number || null,
              query_text:      query.query_text || null,
              reply_text:      replyText.trim() || null,
              attachment_name: attachName || null,
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
      const { data, error } = await supabase.storage.from("firm-assets").createSignedUrl(path, 60);
      if (error) throw error;
      const a = document.createElement("a"); a.href = data.signedUrl; a.download = name; a.click();
    } catch (err: any) { toast.error("Download failed: " + err.message); }
  };

  const isClosed  = query.status === "Clarified" || query.status === "Closed";
  const reqDocs   = query.required_documents?.split(",").map(s => s.trim()).filter(Boolean) ?? [];
  const isOverdue = query.due_date && new Date(query.due_date) < new Date() && !isClosed;

  return (
    <Card className={cn("overflow-hidden border transition-shadow hover:shadow-md", isClosed && "opacity-70")}>
      <CardHeader
        className={cn("pb-2 cursor-pointer select-none", isOverdue ? "bg-red-50/40" : expanded ? "bg-amber-50/30" : "")}
        onClick={() => setExpanded(v => !v)}
      >
        <div className="flex items-start gap-3">
          <div className={cn("mt-1.5 w-2.5 h-2.5 rounded-full flex-shrink-0", PRIORITY_DOT[query.priority] || "bg-gray-300")} />

          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-1">
              {query.ref_number && (
                <span className="font-mono text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">{query.ref_number}</span>
              )}
              <Badge className={cn("text-[10px] border", STATUS_STYLE[query.status] || STATUS_STYLE["Open"])}>
                {query.status}
              </Badge>
              {query.financial_year && <Badge variant="outline" className="text-[10px]">FY {query.financial_year}</Badge>}
              {query.group_name && <span className="text-[10px] text-muted-foreground font-medium">{query.group_name}</span>}
              {query.ledger_name && <Badge variant="secondary" className="text-[10px]">{query.ledger_name}</Badge>}
              {query.due_date && (
                <span className={cn("text-[10px] ml-auto font-medium", isOverdue ? "text-red-600" : "text-muted-foreground")}>
                  {isOverdue ? "⚠ Overdue — " : "Due: "}{fmtDate(query.due_date)}
                </span>
              )}
            </div>
            <p className="text-sm text-foreground leading-relaxed">{query.query_text}</p>
            {reqDocs.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                <span className="text-[10px] text-muted-foreground font-medium mr-1">Required docs:</span>
                {reqDocs.map((d, i) => (
                  <Badge key={i} variant="outline" className="text-[10px] gap-1 border-amber-300 text-amber-700">
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

      {expanded && (
        <CardContent className="pt-4 space-y-3 border-t border-amber-100">
          {loadingMsg ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground py-3">
              <Loader2 size={13} className="animate-spin text-amber-500" /> Loading conversation…
            </div>
          ) : (
            <>
              {messages.length === 0 && !query.client_reply ? (
                <p className="text-xs text-muted-foreground py-3 text-center">No messages yet. Send your reply below.</p>
              ) : (
                <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                  {query.client_reply && messages.length === 0 && (
                    <div className="flex justify-end">
                      <div className="max-w-[80%] bg-amber-50 border border-amber-200 rounded-xl rounded-tr-sm px-3 py-2">
                        <p className="text-[10px] text-amber-600 mb-0.5 font-medium">You · Earlier reply</p>
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
                          isClient ? "bg-amber-50 border border-amber-200 rounded-tr-sm" : "bg-[#0A131E]/5 border border-[#0A131E]/10 rounded-tl-sm",
                        )}>
                          <div className="flex items-baseline gap-2">
                            <span className={cn("text-[10px] font-semibold", isClient ? "text-amber-700" : "text-[#0A131E]")}>
                              {isClient ? "You" : (msg.sender_name || "Auditor")}
                            </span>
                            <span className="text-[9px] text-muted-foreground">{fmtTime(msg.created_at)}</span>
                          </div>
                          {msg.message && <p className="text-sm">{msg.message}</p>}
                          {msg.attachment_path && msg.attachment_name && (
                            <button type="button"
                              onClick={() => downloadAttachment(msg.attachment_path!, msg.attachment_name!)}
                              className="flex items-center gap-1.5 text-xs text-amber-600 hover:underline mt-1">
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

              {!isClosed ? (
                <div className="mt-3 space-y-2 border-t border-amber-100 pt-3">
                  <Textarea
                    value={replyText} onChange={e => setReplyText(e.target.value)}
                    placeholder="Type your reply or explanation…" rows={3}
                    className="resize-none text-sm border-amber-200 focus:ring-amber-400"
                  />
                  {file && (
                    <div className="flex items-center gap-2 px-2 py-1.5 bg-amber-50 rounded-md text-xs border border-amber-200">
                      <Paperclip size={12} className="text-amber-500" />
                      <span className="flex-1 truncate">{file.name}</span>
                      <button type="button"
                        onClick={() => window.open(URL.createObjectURL(file), "_blank")}
                        className="text-amber-600 hover:text-amber-800 font-medium px-1.5 py-0.5 rounded hover:bg-amber-100">
                        View
                      </button>
                      <button type="button"
                        onClick={() => { const a = document.createElement("a"); a.href = URL.createObjectURL(file); a.download = file.name; a.click(); }}
                        className="text-amber-600 hover:text-amber-800 font-medium px-1.5 py-0.5 rounded hover:bg-amber-100 flex items-center gap-0.5">
                        <Download size={11} /> Save
                      </button>
                      <button type="button" onClick={() => setFile(null)} className="text-muted-foreground hover:text-destructive"><X size={12} /></button>
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <Button size="sm" variant="outline" className="gap-1.5 h-8 text-xs border-amber-300 text-amber-700 hover:bg-amber-50"
                      onClick={() => fileInputRef.current?.click()}>
                      <Paperclip size={13} /> Attach
                    </Button>
                    <input ref={fileInputRef} type="file" className="hidden"
                      onChange={e => { const f = e.target.files?.[0]; if (f) setFile(f); e.target.value = ""; }} />
                    <Button size="sm" className="gap-1.5 h-8 text-xs ml-auto bg-amber-600 hover:bg-amber-700"
                      onClick={sendReply} disabled={sending || (!replyText.trim() && !file)}>
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
  const [loading,      setLoading]      = useState(false);
  const [queries,      setQueries]      = useState<AuditQuery[]>([]);
  const [statusFilter, setStatusFilter] = useState<"all" | "open" | "closed">("open");

  const fetchQueries = useCallback(async () => {
    if (!activeClient) return;
    setLoading(true);
    const { data } = await (supabase as any)
      .from("audit_client_queries")
      .select("id,ref_number,query_text,status,priority,due_date,financial_year,required_documents,ledger_name,group_name,client_reply,firm_id,client_id")
      .eq("client_id", activeClient.id)
      .order("created_at", { ascending: false });
    // Never surface unapproved / rejected scrutiny drafts to the client (maker-checker, decision #7)
    const visible = ((data as AuditQuery[]) || []).filter(q => !CLIENT_HIDDEN_QUERY_STATUSES.includes(q.status));
    setQueries(visible);
    setLoading(false);
  }, [activeClient]);

  useEffect(() => { fetchQueries(); }, [fetchQueries]);

  // Realtime for active client
  useEffect(() => {
    if (!activeClient) return;
    const ch = supabase
      .channel(`portal-queries-${activeClient.id}`)
      .on("postgres_changes", {
        event: "*", schema: "public", table: "audit_client_queries",
        filter: `client_id=eq.${activeClient.id}`,
      }, fetchQueries)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [activeClient, fetchQueries]);

  const displayed   = queries.filter(q => {
    if (statusFilter === "open")   return !["Clarified", "Closed"].includes(q.status);
    if (statusFilter === "closed") return  ["Clarified", "Closed"].includes(q.status);
    return true;
  });
  const openCount   = queries.filter(q => !["Clarified", "Closed"].includes(q.status)).length;
  const closedCount = queries.filter(q =>  ["Clarified", "Closed"].includes(q.status)).length;
  const isMulti     = clients.length > 1;

  // ── Loading / empty states ─────────────────────────────────────────────────

  if (clientLoading) {
    return <div className="space-y-4"><Skeleton className="h-24"/><Skeleton className="h-32"/><Skeleton className="h-32"/></div>;
  }

  if (!activeClient) {
    return (
      <div className="text-center py-20 text-muted-foreground">
        <Building2 className="mx-auto h-12 w-12 mb-4 opacity-20" />
        <p>No client profile found. Contact your CA firm.</p>
      </div>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5">

      {/* ── Header ── */}
      <div className="rounded-xl bg-[#0A131E] text-white px-6 py-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-amber-500/20 border-2 border-amber-400 flex items-center justify-center shrink-0">
              <MessageSquareWarning size={18} className="text-amber-300" />
            </div>
            <div>
              <h1 className="text-base font-bold">Audit Queries</h1>
              <p className="text-sm text-white/70 mt-0.5 font-medium">{activeClient.name}</p>
            </div>
          </div>
          <div className="text-right shrink-0">
            {openCount > 0 ? (
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-full bg-red-500 text-white text-sm font-bold flex items-center justify-center">
                  {openCount > 99 ? "99+" : openCount}
                </div>
                <span className="text-xs text-white/70">pending</span>
              </div>
            ) : (
              <span className="text-xs text-green-400 font-medium">All caught up ✓</span>
            )}
          </div>
        </div>

        {/* Entity hint for multi-entity accounts */}
        {isMulti && (
          <p className="text-xs text-white/40 mt-3 border-t border-white/10 pt-3">
            Viewing queries for <span className="text-white/70 font-medium">{activeClient.name}</span>.
            Use the entity switcher in the top bar to view another company.
          </p>
        )}
      </div>

      {/* ── Status filter tabs ── */}
      {(queries.length > 0 || loading) && (
        <div className="flex gap-1 p-1 bg-muted rounded-lg w-fit">
          {([
            { key: "open",   label: `Open (${openCount})`       },
            { key: "closed", label: `Resolved (${closedCount})` },
            { key: "all",    label: `All (${queries.length})`   },
          ] as const).map(({ key, label }) => (
            <button key={key} type="button" onClick={() => setStatusFilter(key)}
              className={cn(
                "px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
                statusFilter === key ? "bg-amber-600 text-white shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}>
              {label}
            </button>
          ))}
        </div>
      )}

      {/* ── Loading skeleton ── */}
      {loading && (
        <div className="space-y-3">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-20" />)}
        </div>
      )}

      {/* ── Query list ── */}
      {!loading && displayed.length === 0 && (
        <Card>
          <CardContent className="py-14 text-center text-muted-foreground">
            <MessageSquareWarning className="mx-auto h-10 w-10 mb-3 text-amber-200" />
            <p className="text-sm font-medium">
              {statusFilter === "open"
                ? "No active queries for this entity. Your CA firm will send queries here."
                : "No queries in this category."}
            </p>
          </CardContent>
        </Card>
      )}

      {!loading && displayed.length > 0 && (
        <div className="space-y-3">
          {displayed.map(q => (
            <QueryCard key={q.id} query={q} clientName={activeClient.name} />
          ))}
        </div>
      )}
    </div>
  );
}
