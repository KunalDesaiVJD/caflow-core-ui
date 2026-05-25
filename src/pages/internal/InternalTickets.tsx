import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  HeadphonesIcon, Building2, Clock, Send, Loader2,
  CheckCircle2, AlertTriangle, MessageSquare,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";

interface Ticket {
  id: string;
  firm_name: string;
  raised_by_name: string;
  subject: string;
  message: string;
  priority: string;
  status: string;
  cse_id: string | null;
  cse_name: string | null;
  created_at: string;
  reply_count: number;
}

interface Reply {
  id: string;
  author_name: string;
  message: string;
  is_internal: boolean;
  created_at: string;
}

interface CSEUser { id: string; name: string; }

const PRIORITY_COLORS: Record<string, string> = {
  low:    "bg-muted text-muted-foreground",
  normal: "bg-blue-100 text-blue-800",
  high:   "bg-orange-100 text-orange-800",
  urgent: "bg-red-100 text-red-800",
};
const STATUS_COLORS: Record<string, string> = {
  open:        "bg-yellow-100 text-yellow-800",
  in_progress: "bg-blue-100 text-blue-800",
  resolved:    "bg-green-100 text-green-800",
  closed:      "bg-muted text-muted-foreground",
};
const STATUS_LABELS: Record<string, string> = {
  open: "Open", in_progress: "In Progress", resolved: "Resolved", closed: "Closed",
};

export default function InternalTickets() {
  const { user } = useAuth();
  const { toast } = useToast();

  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [selected, setSelected] = useState<Ticket | null>(null);
  const [replies, setReplies] = useState<Reply[]>([]);
  const [cseUsers, setCseUsers] = useState<CSEUser[]>([]);

  const [loading, setLoading] = useState(true);
  const [loadingReplies, setLoadingReplies] = useState(false);
  const [replyText, setReplyText] = useState("");
  const [isInternal, setIsInternal] = useState(false);
  const [sending, setSending] = useState(false);
  const [statusFilter, setStatusFilter] = useState("open");

  const loadTickets = useCallback(async () => {
    setLoading(true);
    let q = (supabase as any)
      .from("support_tickets")
      .select(`
        id, subject, message, priority, status, cse_id, created_at,
        firms(name),
        raised_by_user:raised_by(name),
        cse:cse_id(name)
      `)
      .order("created_at", { ascending: false });

    if (statusFilter !== "all") q = q.eq("status", statusFilter);

    const { data } = await q;
    setTickets(
      (data || []).map((t: any) => ({
        id: t.id, subject: t.subject, message: t.message,
        priority: t.priority ?? "normal", status: t.status ?? "open",
        cse_id: t.cse_id, cse_name: t.cse?.name ?? null,
        firm_name: t.firms?.name ?? "—",
        raised_by_name: t.raised_by_user?.name ?? "—",
        created_at: t.created_at,
        reply_count: 0,
      }))
    );

    // Load CSE users for assignment
    const { data: cses } = await (supabase as any)
      .from("users")
      .select("id, name")
      .eq("role", "client_success_executive")
      .eq("is_active", true)
      .order("name");
    setCseUsers((cses || []).map((u: any) => ({ id: u.id, name: u.name || u.email })));

    setLoading(false);
  }, [statusFilter]);

  useEffect(() => { loadTickets(); }, [loadTickets]);

  const loadReplies = useCallback(async (ticketId: string) => {
    setLoadingReplies(true);
    const { data } = await (supabase as any)
      .from("support_ticket_replies")
      .select(`id, message, is_internal, created_at, author:author_id(name)`)
      .eq("ticket_id", ticketId)
      .order("created_at");
    setReplies(
      (data || []).map((r: any) => ({
        id: r.id, message: r.message, is_internal: r.is_internal,
        author_name: r.author?.name ?? "—", created_at: r.created_at,
      }))
    );
    setLoadingReplies(false);
  }, []);

  const selectTicket = (t: Ticket) => { setSelected(t); loadReplies(t.id); setReplyText(""); };

  const sendReply = async () => {
    if (!selected || !replyText.trim()) return;
    setSending(true);
    try {
      const { error } = await (supabase as any)
        .from("support_ticket_replies")
        .insert({ ticket_id: selected.id, author_id: user?.id, message: replyText.trim(), is_internal: isInternal });
      if (error) throw error;
      await loadReplies(selected.id);
      setReplyText("");
      toast({ title: isInternal ? "Internal note saved" : "Reply sent" });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setSending(false);
    }
  };

  const updateStatus = async (ticketId: string, newStatus: string) => {
    const { error } = await (supabase as any)
      .from("support_tickets")
      .update({
        status: newStatus,
        resolved_at: newStatus === "resolved" ? new Date().toISOString() : null,
        resolved_by: newStatus === "resolved" ? user?.id : null,
      })
      .eq("id", ticketId);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    setTickets(prev => prev.map(t => t.id === ticketId ? { ...t, status: newStatus } : t));
    if (selected?.id === ticketId) setSelected(prev => prev ? { ...prev, status: newStatus } : prev);
    toast({ title: `Ticket ${STATUS_LABELS[newStatus] ?? newStatus}` });
  };

  const assignCSE = async (ticketId: string, cseId: string) => {
    const { error } = await (supabase as any)
      .from("support_tickets")
      .update({ cse_id: cseId || null })
      .eq("id", ticketId);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    const cseName = cseUsers.find(u => u.id === cseId)?.name ?? null;
    setTickets(prev => prev.map(t => t.id === ticketId ? { ...t, cse_id: cseId || null, cse_name: cseName } : t));
    if (selected?.id === ticketId)
      setSelected(prev => prev ? { ...prev, cse_id: cseId || null, cse_name: cseName } : prev);
    toast({ title: "CSE assigned" });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-display font-bold text-foreground flex items-center gap-2">
            <HeadphonesIcon size={22} /> Support Tickets
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Handle queries raised by firm users and their staff.
          </p>
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-36 h-8 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="open">Open</SelectItem>
            <SelectItem value="in_progress">In Progress</SelectItem>
            <SelectItem value="resolved">Resolved</SelectItem>
            <SelectItem value="closed">Closed</SelectItem>
            <SelectItem value="all">All</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex gap-4 h-[calc(100vh-240px)] min-h-[500px]">
        {/* Left: ticket list */}
        <div className="w-80 shrink-0 flex flex-col border rounded-lg bg-card overflow-hidden">
          <div className="px-4 py-3 border-b bg-muted/30">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Tickets ({tickets.length})
            </p>
          </div>
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="p-3 space-y-2">
                {[1,2,3].map(i => <Skeleton key={i} className="h-16 w-full" />)}
              </div>
            ) : tickets.length === 0 ? (
              <div className="p-6 text-center text-sm text-muted-foreground">
                <CheckCircle2 size={32} className="mx-auto mb-2 text-green-500 opacity-50" />
                No {statusFilter === "all" ? "" : statusFilter} tickets
              </div>
            ) : (
              tickets.map(t => (
                <button
                  key={t.id}
                  onClick={() => selectTicket(t)}
                  className={cn(
                    "w-full text-left px-3 py-3 border-b last:border-0 transition-colors",
                    selected?.id === t.id ? "bg-primary/10 border-l-2 border-l-primary" : "hover:bg-muted/50"
                  )}
                >
                  <div className="flex items-center justify-between gap-1 mb-0.5">
                    <span className="text-sm font-medium text-foreground truncate">{t.subject}</span>
                    <Badge className={cn("text-[10px] px-1.5 py-0 shrink-0", PRIORITY_COLORS[t.priority])}>
                      {t.priority}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                    <Building2 size={11} />
                    <span className="truncate">{t.firm_name}</span>
                  </div>
                  <div className="flex items-center gap-1 mt-0.5">
                    <Badge className={cn("text-[10px] px-1.5 py-0", STATUS_COLORS[t.status])}>
                      {STATUS_LABELS[t.status] ?? t.status}
                    </Badge>
                    <span className="text-[10px] text-muted-foreground ml-auto">
                      {format(new Date(t.created_at), "dd MMM")}
                    </span>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        {/* Right: ticket detail */}
        <div className="flex-1 border rounded-lg bg-card overflow-hidden flex flex-col">
          {!selected ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 text-muted-foreground">
              <MessageSquare size={40} className="opacity-30" />
              <p className="text-sm">Select a ticket to view and respond</p>
            </div>
          ) : (
            <>
              {/* Ticket header */}
              <div className="p-4 border-b">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="flex-1 min-w-0">
                    <h2 className="font-semibold text-foreground">{selected.subject}</h2>
                    <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground flex-wrap">
                      <Building2 size={12} />
                      <span>{selected.firm_name}</span>
                      <span>·</span>
                      <span>Raised by {selected.raised_by_name}</span>
                      <span>·</span>
                      <Clock size={12} />
                      <span>{format(new Date(selected.created_at), "dd MMM yyyy, hh:mm a")}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 flex-wrap">
                    {/* Status */}
                    <Select
                      value={selected.status}
                      onValueChange={val => updateStatus(selected.id, val)}
                    >
                      <SelectTrigger className="h-8 w-32 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(STATUS_LABELS).map(([k, v]) => (
                          <SelectItem key={k} value={k}>{v}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {/* CSE assignment (superadmin only) */}
                    {user?.role === "superadmin" && (
                      <Select
                        value={selected.cse_id ?? "none"}
                        onValueChange={val => assignCSE(selected.id, val === "none" ? "" : val)}
                      >
                        <SelectTrigger className="h-8 w-40 text-xs">
                          <SelectValue placeholder="Assign CSE" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Unassigned</SelectItem>
                          {cseUsers.map(c => (
                            <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </div>
                </div>

                {/* Original message */}
                <div className="mt-3 p-3 bg-muted/30 rounded-md text-sm text-foreground">
                  {selected.message}
                </div>
              </div>

              {/* Replies */}
              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {loadingReplies ? (
                  <div className="space-y-2">
                    {[1,2].map(i => <Skeleton key={i} className="h-16 w-full" />)}
                  </div>
                ) : replies.length === 0 ? (
                  <div className="text-center text-sm text-muted-foreground py-4">
                    No replies yet — be the first to respond.
                  </div>
                ) : (
                  replies.map(r => (
                    <div
                      key={r.id}
                      className={cn(
                        "p-3 rounded-md text-sm border",
                        r.is_internal
                          ? "bg-amber-50 border-amber-200"
                          : "bg-card border-border"
                      )}
                    >
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className="font-medium text-foreground text-xs">{r.author_name}</span>
                        <div className="flex items-center gap-2">
                          {r.is_internal && (
                            <Badge variant="outline" className="text-[10px] text-amber-700 border-amber-300 px-1.5 py-0">
                              Internal Note
                            </Badge>
                          )}
                          <span className="text-[10px] text-muted-foreground">
                            {format(new Date(r.created_at), "dd MMM, hh:mm a")}
                          </span>
                        </div>
                      </div>
                      <p className="text-foreground whitespace-pre-wrap">{r.message}</p>
                    </div>
                  ))
                )}
              </div>

              {/* Reply box */}
              <div className="p-4 border-t space-y-2">
                <Textarea
                  value={replyText}
                  onChange={e => setReplyText(e.target.value)}
                  placeholder="Write your reply..."
                  className="min-h-[80px] resize-none text-sm"
                />
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isInternal}
                      onChange={e => setIsInternal(e.target.checked)}
                      className="rounded"
                    />
                    Internal note (not visible to firm)
                  </label>
                  <Button
                    size="sm"
                    disabled={!replyText.trim() || sending}
                    onClick={sendReply}
                    className="gap-2"
                  >
                    {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                    {isInternal ? "Save Note" : "Send Reply"}
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
