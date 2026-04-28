/**
 * CommunicationLogTab
 *
 * Shows a timeline of all emails sent for a specific audit engagement.
 * Reads from `audit_query_dispatch_log` filtered by engagement_id.
 *
 * Each entry shows: template type, subject, to, queries count, sent by, sent at.
 * HTML body preview available on expand.
 */
import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge }    from "@/components/ui/badge";
import { Button }   from "@/components/ui/button";
import {
  Mail, ChevronDown, ChevronUp, Loader2, Clock, User,
  MailCheck, RefreshCw,
} from "lucide-react";
import { cn }  from "@/lib/utils";
import { AUDIT_EMAIL_LABELS, AuditEmailType } from "@/components/email/EmailTemplateEngine";
import type { AuditWorksheetData } from "./hooks/useAuditWorksheetData";

// ─── Types ────────────────────────────────────────────────────────────────────

interface DispatchLog {
  id:            string;
  subject:       string | null;
  body:          string | null;
  channel:       string;
  template_used: string | null;
  query_ids:     string[];
  dispatch_ref:  string | null;
  dispatched_at: string | null;
  dispatched_by: string | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

const TEMPLATE_BADGE_COLOR: Partial<Record<AuditEmailType, string>> = {
  audit_commencement:     "bg-blue-100 text-blue-700 border-blue-200",
  audit_document_request: "bg-amber-100 text-amber-700 border-amber-200",
  audit_query_dispatch:   "bg-orange-100 text-orange-700 border-orange-200",
  audit_query_reminder:   "bg-red-100 text-red-700 border-red-200",
  audit_draft_report:     "bg-purple-100 text-purple-700 border-purple-200",
  audit_final_report:     "bg-green-100 text-green-700 border-green-200",
};

// ─── Log Item ─────────────────────────────────────────────────────────────────

function LogItem({ log }: { log: DispatchLog }) {
  const [expanded, setExpanded] = useState(false);

  const templateLabel = log.template_used
    ? (AUDIT_EMAIL_LABELS[log.template_used as AuditEmailType] || log.template_used)
    : "Email";
  const badgeColor = log.template_used
    ? (TEMPLATE_BADGE_COLOR[log.template_used as AuditEmailType] || "bg-muted text-muted-foreground")
    : "bg-muted text-muted-foreground";

  return (
    <div className="border rounded-lg overflow-hidden">
      {/* Header row */}
      <button
        type="button"
        className="w-full flex items-start gap-3 p-3 text-left hover:bg-muted/30 transition-colors"
        onClick={() => setExpanded(v => !v)}
      >
        <div className="mt-0.5 flex-shrink-0 h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center">
          <MailCheck size={14} className="text-primary"/>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-0.5">
            <Badge className={cn("text-[10px] border h-4 px-1.5", badgeColor)}>
              {templateLabel}
            </Badge>
            {log.query_ids?.length > 0 && (
              <span className="text-[10px] text-muted-foreground">
                {log.query_ids.length} quer{log.query_ids.length === 1 ? "y" : "ies"}
              </span>
            )}
          </div>
          <p className="text-sm font-medium text-foreground truncate">{log.subject || "—"}</p>
          <div className="flex flex-wrap items-center gap-3 mt-0.5">
            {log.dispatched_at && (
              <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                <Clock size={10}/> {fmtDateTime(log.dispatched_at)}
              </span>
            )}
            {log.dispatch_ref && (
              <span className="font-mono text-[10px] text-muted-foreground">{log.dispatch_ref}</span>
            )}
          </div>
        </div>
        <span className="text-muted-foreground flex-shrink-0 mt-0.5">
          {expanded ? <ChevronUp size={14}/> : <ChevronDown size={14}/>}
        </span>
      </button>

      {/* Expanded: email preview */}
      {expanded && log.body && (
        <div className="border-t">
          <div className="text-xs text-muted-foreground px-3 py-1.5 bg-muted/50 border-b flex items-center gap-1">
            <Mail size={10}/> Email body preview
          </div>
          <iframe
            srcDoc={log.body}
            title="Email body"
            className="w-full"
            style={{ height: "300px", border: "none" }}
            sandbox=""
          />
        </div>
      )}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

interface Props {
  data:         AuditWorksheetData;
  engagementId: string;
}

export function CommunicationLogTab({ data, engagementId }: Props) {
  const [logs,    setLogs]    = useState<DispatchLog[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    const { data: rows } = await (supabase as any)
      .from("audit_query_dispatch_log")
      .select("id,subject,body,channel,template_used,query_ids,dispatch_ref,dispatched_at,dispatched_by")
      .eq("engagement_id", engagementId)
      .order("dispatched_at", { ascending: false });
    setLogs((rows as DispatchLog[]) || []);
    setLoading(false);
  }, [engagementId]);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
        <Loader2 size={14} className="animate-spin"/> Loading communication log…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <Mail size={15} className="text-primary"/> Communication Log
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {logs.length} email{logs.length !== 1 ? "s" : ""} sent for this engagement
          </p>
        </div>
        <Button size="sm" variant="outline" className="gap-1 h-7 text-xs" onClick={fetchLogs}>
          <RefreshCw size={11}/> Refresh
        </Button>
      </div>

      {/* Log entries */}
      {logs.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-48 gap-3 text-muted-foreground">
          <Mail size={36} className="opacity-25"/>
          <div className="text-center">
            <p className="text-sm font-medium text-foreground">No emails sent yet</p>
            <p className="text-xs mt-1">
              Use the <strong>Send Email</strong> button in Client Inbox to compose and send audit communications.
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {logs.map(log => <LogItem key={log.id} log={log}/>)}
        </div>
      )}
    </div>
  );
}
