/**
 * CommunicationDashboard — Phase 4C
 *
 * KPI summary panel embedded at the top of the Communication Log tab.
 * Self-contained: fetches audit_client_queries and audit_query_dispatch_log
 * for the engagement and computes summary metrics.
 *
 * Metrics:
 *   • Response Rate   — % of dispatched queries that got a reply / were resolved
 *   • Open Queries    — awaiting client response
 *   • Emails Sent     — total dispatch log entries
 *   • Avg Open Age    — mean days since dispatch for still-open queries
 *
 * Also shows a Recent Activity timeline of the last 5 communication events.
 */
import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge }    from "@/components/ui/badge";
import { cn }       from "@/lib/utils";
import {
  TrendingUp, MessageSquareWarning, Mail, Clock,
  CheckCircle2, Loader2, RefreshCw, MailCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { AUDIT_EMAIL_LABELS, type AuditEmailType } from "@/components/email/EmailTemplateEngine";

// ─── Types ────────────────────────────────────────────────────────────────────

interface QueryStat {
  id:         string;
  status:     string;
  created_at: string | null;
}

interface DispatchStat {
  id:            string;
  template_used: string | null;
  subject:       string | null;
  dispatched_at: string | null;
  query_ids:     string[] | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const RESPONDED_STATUSES  = new Set(["Reply Received", "Clarified", "Closed"]);
const OPEN_STATUSES       = new Set(["Open", "Client Acknowledged"]);

function daysSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

function fmtRelative(iso: string | null): string {
  if (!iso) return "—";
  const d = daysSince(iso);
  if (d === 0) return "Today";
  if (d === 1) return "Yesterday";
  if (d < 7)   return `${d} days ago`;
  if (d < 30)  return `${Math.floor(d / 7)}w ago`;
  return new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}

const TEMPLATE_BADGE: Partial<Record<AuditEmailType, string>> = {
  audit_commencement:     "bg-blue-100 text-blue-700",
  audit_document_request: "bg-amber-100 text-amber-700",
  audit_query_dispatch:   "bg-orange-100 text-orange-700",
  audit_query_reminder:   "bg-red-100 text-red-700",
  audit_draft_report:     "bg-purple-100 text-purple-700",
  audit_final_report:     "bg-green-100 text-green-700",
};

// ─── KPI card ─────────────────────────────────────────────────────────────────

function KpiCard({
  icon, label, value, sub, color, bg,
}: {
  icon:  React.ReactNode;
  label: string;
  value: string | number;
  sub?:  string;
  color: string;
  bg:    string;
}) {
  return (
    <div className={cn("rounded-lg border p-3 space-y-1", bg)}>
      <div className="flex items-center gap-1.5">
        <span className={color}>{icon}</span>
        <span className={cn("text-[10px] font-medium uppercase tracking-wide", color)}>{label}</span>
      </div>
      <p className={cn("text-2xl font-bold leading-none", color)}>{value}</p>
      {sub && <p className="text-[10px] text-muted-foreground">{sub}</p>}
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  engagementId: string;
}

export function CommunicationDashboard({ engagementId }: Props) {
  const [queries,  setQueries]  = useState<QueryStat[]>([]);
  const [logs,     setLogs]     = useState<DispatchStat[]>([]);
  const [loading,  setLoading]  = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const [{ data: qRows }, { data: logRows }] = await Promise.all([
      (supabase as any)
        .from("audit_client_queries")
        .select("id,status,created_at")
        .eq("engagement_id", engagementId),
      (supabase as any)
        .from("audit_query_dispatch_log")
        .select("id,template_used,subject,dispatched_at,query_ids")
        .eq("engagement_id", engagementId)
        .order("dispatched_at", { ascending: false })
        .limit(20),
    ]);
    setQueries((qRows as QueryStat[]) || []);
    setLogs((logRows as DispatchStat[]) || []);
    setLoading(false);
  }, [engagementId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground py-4 justify-center">
        <Loader2 size={13} className="animate-spin" /> Loading dashboard…
      </div>
    );
  }

  // ── Derived metrics ──────────────────────────────────────────────────────
  const total      = queries.length;
  const responded  = queries.filter(q => RESPONDED_STATUSES.has(q.status)).length;
  const openQ      = queries.filter(q => OPEN_STATUSES.has(q.status));
  const openCount  = openQ.length;
  const emailCount = logs.length;

  const responseRate = total > 0 ? Math.round((responded / total) * 100) : 0;

  const avgAge = openQ.length > 0
    ? Math.round(
        openQ.reduce((sum, q) => sum + (q.created_at ? daysSince(q.created_at) : 0), 0)
        / openQ.length
      )
    : 0;

  const rateColor = responseRate >= 70 ? "text-green-700" : responseRate >= 40 ? "text-amber-700" : "text-red-700";
  const rateBg    = responseRate >= 70 ? "bg-green-50 border-green-200" : responseRate >= 40 ? "bg-amber-50 border-amber-200" : "bg-red-50 border-red-200";

  return (
    <div className="space-y-4">
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <TrendingUp size={14} className="text-primary" />
          <span className="text-sm font-semibold">Communication Overview</span>
        </div>
        <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={fetchData}>
          <RefreshCw size={11} /> Refresh
        </Button>
      </div>

      {total === 0 && emailCount === 0 ? (
        <div className="rounded-lg border bg-muted/20 p-6 text-center text-sm text-muted-foreground">
          <Mail size={24} className="mx-auto mb-2 opacity-30" />
          No communication activity yet for this engagement.
        </div>
      ) : (
        <>
          {/* ── KPI cards ── */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <KpiCard
              icon={<TrendingUp size={13}/>}
              label="Response Rate"
              value={`${responseRate}%`}
              sub={`${responded} of ${total} queries`}
              color={rateColor}
              bg={rateBg}
            />
            <KpiCard
              icon={<MessageSquareWarning size={13}/>}
              label="Open Queries"
              value={openCount}
              sub={openCount > 0 ? `avg ${avgAge}d old` : "all resolved"}
              color={openCount > 0 ? "text-orange-700" : "text-green-700"}
              bg={openCount > 0 ? "bg-orange-50 border-orange-200" : "bg-green-50 border-green-200"}
            />
            <KpiCard
              icon={<Mail size={13}/>}
              label="Emails Sent"
              value={emailCount}
              sub="via dispatch log"
              color="text-blue-700"
              bg="bg-blue-50 border-blue-200"
            />
            <KpiCard
              icon={<CheckCircle2 size={13}/>}
              label="Resolved"
              value={responded}
              sub={total > 0 ? `${Math.round((responded/total)*100)}% of total` : "—"}
              color="text-green-700"
              bg="bg-green-50 border-green-200"
            />
          </div>

          {/* ── Response rate bar ── */}
          {total > 0 && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                <span>Resolution progress</span>
                <span>{responded} / {total}</span>
              </div>
              <div className="h-2 w-full bg-muted rounded-full overflow-hidden">
                <div
                  className={cn(
                    "h-full rounded-full transition-all duration-700",
                    responseRate >= 70 ? "bg-green-500" : responseRate >= 40 ? "bg-amber-400" : "bg-red-400",
                  )}
                  style={{ width: `${responseRate}%` }}
                />
              </div>
              <div className="flex gap-3 text-[10px] text-muted-foreground">
                <span className="flex items-center gap-1">
                  <span className="inline-block w-2 h-2 rounded-full bg-orange-400" /> Open {openCount}
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block w-2 h-2 rounded-full bg-green-500" /> Resolved {responded}
                </span>
              </div>
            </div>
          )}

          {/* ── Recent activity ── */}
          {logs.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                Recent Communications
              </p>
              <div className="space-y-1.5">
                {logs.slice(0, 5).map((log, i) => {
                  const label     = log.template_used
                    ? (AUDIT_EMAIL_LABELS[log.template_used as AuditEmailType] || log.template_used)
                    : "Email";
                  const badgeColor = log.template_used
                    ? (TEMPLATE_BADGE[log.template_used as AuditEmailType] || "bg-muted text-muted-foreground")
                    : "bg-muted text-muted-foreground";
                  return (
                    <div key={log.id}
                      className="flex items-center gap-2.5 py-1.5 px-2 rounded-md bg-muted/30 border">
                      {/* Timeline dot */}
                      <div className={cn(
                        "h-6 w-6 rounded-full flex items-center justify-center flex-shrink-0",
                        i === 0 ? "bg-primary/10" : "bg-muted",
                      )}>
                        <MailCheck size={12} className={i === 0 ? "text-primary" : "text-muted-foreground"} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <Badge className={cn("text-[9px] h-4 px-1.5 border", badgeColor)}>
                            {label}
                          </Badge>
                          {(log.query_ids?.length ?? 0) > 0 && (
                            <span className="text-[10px] text-muted-foreground">
                              {log.query_ids!.length} quer{log.query_ids!.length === 1 ? "y" : "ies"}
                            </span>
                          )}
                        </div>
                        {log.subject && (
                          <p className="text-[11px] text-foreground truncate mt-0.5">{log.subject}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-1 text-[10px] text-muted-foreground flex-shrink-0">
                        <Clock size={9} />
                        {fmtRelative(log.dispatched_at)}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
