import { useState, useEffect, useCallback } from "react";
import DOMPurify from "dompurify";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { format } from "date-fns";
import {
  Mail, MessageSquare, CheckCircle2, XCircle, ChevronDown, ChevronRight,
  Download, Inbox, Filter,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface NotificationLog {
  id: string;
  firm_id: string | null;
  recipient_id: string | null;
  channel: string | null;
  type: string | null;
  content: Record<string, any> | null;
  status: string | null;
  sent_at: string | null;
  provider_id: string | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const PAGE_SIZE = 20;

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  try { return format(new Date(iso), "dd/MM/yyyy HH:mm"); } catch { return iso; }
}

function statusBadge(status: string | null) {
  if (status === "sent" || status === "delivered")
    return <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300 text-xs gap-1"><CheckCircle2 size={11} />Sent</Badge>;
  if (status === "failed" || status === "error")
    return <Badge variant="destructive" className="text-xs gap-1"><XCircle size={11} />Failed</Badge>;
  if (status === "draft")
    return <Badge variant="outline" className="text-xs gap-1 border-amber-300 text-amber-700 dark:text-amber-400">Draft</Badge>;
  return <Badge variant="outline" className="text-xs capitalize">{status ?? "Unknown"}</Badge>;
}

function channelBadge(channel: string | null) {
  if (channel === "whatsapp")
    return <Badge variant="outline" className="text-xs gap-1 text-green-700 border-green-300"><MessageSquare size={11} />WhatsApp</Badge>;
  return <Badge variant="outline" className="text-xs gap-1"><Mail size={11} />Email</Badge>;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function EmailLogTab({ firmId }: { firmId: string | null }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const resolvedFirmId = firmId ?? user?.firm_id ?? null;

  const [logs, setLogs] = useState<NotificationLog[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Filters
  const [statusFilter, setStatusFilter] = useState("all");
  const [channelFilter, setChannelFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [search, setSearch] = useState("");

  const allTypes = [
    "invoice_generated", "quotation_sent", "proforma_sent", "credit_note_issued",
    "payment_reminder", "ledger_statement", "tds_due_7_days", "tds_due_1_day",
    "audit_report_ready", "new_user_welcome",
  ];

  // Same filters for the on-screen page and the CSV export. Search runs server-side
  // so the count / pagination reflect it; dates are local-day bounds converted to UTC.
  const buildQuery = useCallback(() => {
    let q = (supabase.from("notification_log") as any)
      .select("*", { count: "exact" })
      .order("sent_at", { ascending: false });

    // Filter by firm when available; super-admins without a firm_id see all logs
    if (resolvedFirmId) q = q.eq("firm_id", resolvedFirmId);

    if (statusFilter !== "all") q = q.eq("status", statusFilter);
    if (channelFilter !== "all") q = q.eq("channel", channelFilter);
    if (typeFilter !== "all") q = q.eq("type", typeFilter);
    if (dateFrom) q = q.gte("sent_at", new Date(`${dateFrom}T00:00:00`).toISOString());
    if (dateTo) {
      const end = new Date(`${dateTo}T00:00:00`);
      end.setDate(end.getDate() + 1);
      q = q.lt("sent_at", end.toISOString());
    }
    // Strip PostgREST filter syntax characters from the user's term.
    const term = search.trim().replace(/[,()*%\\]/g, " ").trim();
    if (term) q = q.or(`content->>to.ilike.*${term}*,content->>subject.ilike.*${term}*`);
    return q;
  }, [resolvedFirmId, statusFilter, channelFilter, typeFilter, dateFrom, dateTo, search]);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    const { data, count, error } = await buildQuery().range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
    if (error) {
      toast({ title: "Error loading email log", description: error.message, variant: "destructive" });
    } else {
      setLogs((data as NotificationLog[]) || []);
      setTotal(count ?? 0);
    }
    setLoading(false);
  }, [buildQuery, page, toast]);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  // Reset page when filters change
  useEffect(() => { setPage(0); }, [statusFilter, channelFilter, typeFilter, dateFrom, dateTo, search]);

  // Exports every row matching the filters, not just the visible page.
  const exportCSV = async () => {
    const all: NotificationLog[] = [];
    const CHUNK = 1000;
    for (let from = 0; ; from += CHUNK) {
      const { data, error } = await buildQuery().range(from, from + CHUNK - 1);
      if (error) { toast({ title: "Export failed", description: error.message, variant: "destructive" }); return; }
      all.push(...((data as NotificationLog[]) || []));
      if (!data || data.length < CHUNK) break;
    }
    if (all.length === 0) return;
    const headers = ["Date/Time", "To", "Type", "Subject", "Status", "Channel"];
    const rows = all.map(r => [
      formatDateTime(r.sent_at),
      r.content?.to ?? "—",
      r.type ?? "—",
      r.content?.subject ?? "—",
      r.status ?? "—",
      r.channel ?? "email",
    ]);
    const csv = [headers, ...rows].map(row => row.map(v => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `email-log-${format(new Date(), "yyyy-MM-dd")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-semibold">Email &amp; Notification Log</h2>
          <p className="text-sm text-muted-foreground">History of all emails and WhatsApp messages sent from this firm.</p>
        </div>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={exportCSV} disabled={logs.length === 0}>
          <Download size={14} /> Export CSV
        </Button>
      </div>

      {/* Filter Bar */}
      <div className="flex flex-wrap gap-3 items-end rounded-lg border bg-muted/30 p-3">
        <Filter size={14} className="text-muted-foreground self-center mt-1" />

        <div className="space-y-1">
          <Label className="text-xs">Status</Label>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="h-8 w-[120px] text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="sent">Sent</SelectItem>
              <SelectItem value="delivered">Delivered</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
              <SelectItem value="draft">Draft</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label className="text-xs">Channel</Label>
          <Select value={channelFilter} onValueChange={setChannelFilter}>
            <SelectTrigger className="h-8 w-[120px] text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="email">Email</SelectItem>
              <SelectItem value="whatsapp">WhatsApp</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label className="text-xs">Type</Label>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="h-8 w-[190px] text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              {allTypes.map(t => <SelectItem key={t} value={t} className="text-xs capitalize">{t.replace(/_/g, " ")}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label className="text-xs">From</Label>
          <Input type="date" className="h-8 text-xs w-[140px]" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">To</Label>
          <Input type="date" className="h-8 text-xs w-[140px]" value={dateTo} onChange={e => setDateTo(e.target.value)} />
        </div>

        <div className="space-y-1 flex-1 min-w-[180px]">
          <Label className="text-xs">Search email / subject</Label>
          <Input
            placeholder="Search..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="h-8 text-xs"
          />
        </div>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-6 space-y-3">
              {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : logs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-3">
              <Inbox size={40} strokeWidth={1.2} />
              <p className="text-sm">No notification logs found.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>Date/Time</TableHead>
                  <TableHead>To</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Subject</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Channel</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.map(log => (
                  <>
                    <TableRow
                      key={log.id}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => setExpandedId(expandedId === log.id ? null : log.id)}
                    >
                      <TableCell className="text-muted-foreground">
                        {expandedId === log.id
                          ? <ChevronDown size={14} />
                          : <ChevronRight size={14} />}
                      </TableCell>
                      <TableCell className="text-sm whitespace-nowrap">{formatDateTime(log.sent_at)}</TableCell>
                      <TableCell className="text-sm max-w-[200px] truncate" title={log.content?.to ?? ""}>
                        {log.content?.to ?? "—"}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs capitalize">
                          {(log.type ?? "").replace(/_/g, " ")}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm max-w-[220px] truncate" title={log.content?.subject ?? ""}>
                        {log.content?.subject ?? "—"}
                      </TableCell>
                      <TableCell>{statusBadge(log.status)}</TableCell>
                      <TableCell>{channelBadge(log.channel)}</TableCell>
                    </TableRow>
                    {expandedId === log.id && (
                      <TableRow key={log.id + "-expanded"} className="bg-muted/30">
                        <TableCell colSpan={7} className="p-4">
                          <div className="space-y-2 text-sm">
                            <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 items-start text-sm">
                              <span className="font-semibold text-muted-foreground text-xs uppercase pt-0.5">To</span>
                              <span className="font-medium">{log.content?.to ?? "—"}</span>
                              {log.content?.cc && (
                                <>
                                  <span className="font-semibold text-muted-foreground text-xs uppercase pt-0.5">CC</span>
                                  <span className="text-muted-foreground">{log.content.cc}</span>
                                </>
                              )}
                              <span className="font-semibold text-muted-foreground text-xs uppercase pt-0.5">Status</span>
                              <span>{statusBadge(log.status)}</span>
                              {log.provider_id && (
                                <>
                                  <span className="font-semibold text-muted-foreground text-xs uppercase pt-0.5">Ref ID</span>
                                  <span className="font-mono text-xs text-muted-foreground">{log.provider_id}</span>
                                </>
                              )}
                            </div>
                            {log.content?.body && (
                              <div>
                                <p className="font-medium text-muted-foreground text-xs uppercase mb-1">Message Body:</p>
                                <div
                                  className="rounded border bg-white dark:bg-background p-3 text-xs max-h-48 overflow-auto prose prose-sm max-w-none"
                                  // log.content.body can originate from an external, low-trust
                                  // client-portal user (e.g. audit query replies) that gets
                                  // persisted verbatim into notification_log — sanitize before
                                  // rendering to prevent stored XSS in this staff-facing view.
                                  dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(log.content.body) }}
                                />
                              </div>
                            )}
                            {log.content?.error && (
                              <div className="flex items-start gap-1.5 text-destructive text-xs mt-1 p-2 rounded bg-destructive/10 border border-destructive/20">
                                <XCircle size={12} className="shrink-0 mt-0.5" />
                                <span><span className="font-medium">Error: </span>{log.content.error}</span>
                              </div>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total}</span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage(p => Math.max(0, p - 1))}
              disabled={page === 0}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
