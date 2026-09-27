/**
 * AuditChangeLogModal  (CP-07 BUG C)
 *
 * Shows two tabs:
 *  • Snapshots  — full-row before/after diffs from audit_status_history
 *  • Field Log  — field-level change entries from audit_change_log
 *
 * Triggered by the Clock icon per row.
 */
import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge }    from "@/components/ui/badge";
import { Clock, ArrowRight } from "lucide-react";
import { format, parseISO } from "date-fns";
import { useAuditStatusHistory } from "../hooks/useAuditStatusHistory";
import { useAuditChangeLog }      from "../hooks/useAuditChangeLog";

// ─── Tracked field labels for snapshot diffs ──────────────────────────────────

const FIELD_LABELS: Record<string, string> = {
  party_name:                   "Party Name",
  physical_audit_conducted:     "Physical Audit",
  accounting_data:              "Accounting Data",
  audit_employees:              "Audit Employees",
  audit_report_prepared_by:     "Report Prepared By",
  audit_report_checked_by:      "Report Checked By",
  audit_status:                 "Audit Status",
  report_print_date:            "Report Print Date",
  firm:                         "Firm",
  partner:                      "Partner",
  udin_tax_audit:               "UDIN (Tax)",
  udin_statutory_audit:         "UDIN (Stat)",
  udin_date:                    "UDIN Date",
  physical_report_received_date:"Phys. Report Recd",
  scanned:                      "Scanned",
  prepared_by:                  "3CA Prepared By",
  checked_by:                   "3CA Checked By",
  uploaded_by:                  "3CA Uploaded By",
  upload_date:                  "3CA Upload Date",
  remarks:                      "Remarks",
  remarks_other:                "Remarks (Other)",
};

function SnapshotDiff({
  prev, next,
}: { prev: Record<string, any> | null; next: Record<string, any> | null }) {
  const changes = Object.keys(FIELD_LABELS).filter(k => {
    const pv = prev?.[k] ?? null;
    const nv = next?.[k] ?? null;
    return String(pv ?? "") !== String(nv ?? "");
  });

  if (changes.length === 0) {
    return (
      <p className="text-[11px] text-muted-foreground italic">No tracked field changes</p>
    );
  }

  return (
    <div className="space-y-1">
      {changes.map(k => (
        <div key={k} className="flex items-start gap-1.5 text-[11px]">
          <Badge variant="outline" className="text-[9px] font-semibold border-indigo-200 text-indigo-700 shrink-0">
            {FIELD_LABELS[k]}
          </Badge>
          <span className="text-muted-foreground line-through max-w-[90px] truncate" title={prev?.[k] ?? "—"}>
            {prev?.[k] || <span className="italic not-italic opacity-50">empty</span>}
          </span>
          <ArrowRight size={9} className="text-muted-foreground shrink-0 mt-0.5" />
          <span className="font-medium text-foreground max-w-[110px] truncate" title={next?.[k] ?? "—"}>
            {next?.[k] || <span className="italic font-normal text-muted-foreground">empty</span>}
          </span>
        </div>
      ))}
    </div>
  );
}

// ─── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  recordId:  string | null;
  partyName: string | null;
  open:      boolean;
  onClose:   () => void;
}

// ─── Component ─────────────────────────────────────────────────────────────────

export default function AuditChangeLogModal({ recordId, partyName, open, onClose }: Props) {
  const [tab, setTab] = useState<"snapshots" | "fields">("snapshots");

  const { snapshots, loading: snapLoading } = useAuditStatusHistory(open ? recordId : null);
  const { entries,   loading: fieldLoading } = useAuditChangeLog(open ? recordId : null);

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Clock size={16} className="text-indigo-600" />
            Change History
            {partyName && (
              <span className="text-sm font-normal text-muted-foreground">— {partyName}</span>
            )}
          </DialogTitle>
        </DialogHeader>

        {/* ── Tabs ── */}
        <div className="flex gap-1 mt-1 border-b">
          {(["snapshots", "fields"] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-3 py-1.5 text-xs font-medium border-b-2 transition-colors ${
                tab === t
                  ? "border-indigo-600 text-indigo-700"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {t === "snapshots" ? "Snapshots" : "Field Log"}
            </button>
          ))}
        </div>

        <div className="space-y-2 mt-2">

          {/* ── Snapshots tab ── */}
          {tab === "snapshots" && (
            snapLoading ? (
              Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-20 w-full rounded-md" />
              ))
            ) : snapshots.length === 0 ? (
              <div className="py-10 text-center text-sm text-muted-foreground">
                No snapshots yet.
                <p className="text-xs mt-1 text-muted-foreground/70">
                  A snapshot is written every time a row is saved.
                </p>
              </div>
            ) : (
              snapshots.map(s => (
                <div
                  key={s.id}
                  className="rounded-md border border-border bg-muted/20 px-3 py-2.5 space-y-2"
                >
                  {/* Header: who + when */}
                  <div className="flex items-center gap-1.5 text-[11px]">
                    <Clock size={11} className="text-indigo-500 shrink-0" />
                    <span className="font-semibold text-foreground">
                      {s.changed_by_name || "Unknown user"}
                    </span>
                    <span className="text-muted-foreground">·</span>
                    <span className="text-muted-foreground">
                      {format(parseISO(s.changed_at), "dd MMM yyyy")} at {format(parseISO(s.changed_at), "HH:mm")}
                    </span>
                  </div>

                  {/* Diff */}
                  <SnapshotDiff prev={s.previous_data} next={s.new_data} />
                </div>
              ))
            )
          )}

          {/* ── Field log tab ── */}
          {tab === "fields" && (
            fieldLoading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-14 w-full rounded-md" />
              ))
            ) : entries.length === 0 ? (
              <div className="py-10 text-center text-sm text-muted-foreground">
                No field-level log entries yet.
                <p className="text-xs mt-1 text-muted-foreground/70">
                  Requires <code>audit_change_log</code> migration to be applied.
                </p>
              </div>
            ) : (
              entries.map(e => (
                <div
                  key={e.id}
                  className="flex flex-col gap-1 rounded-md border border-border bg-muted/20 px-3 py-2 text-xs"
                >
                  <div className="flex items-center flex-wrap gap-1.5">
                    <Badge variant="outline" className="text-[10px] font-semibold border-indigo-300 text-indigo-700">
                      {e.field_label || e.field_name}
                    </Badge>
                    <span className="text-muted-foreground line-through max-w-[120px] truncate" title={e.old_value ?? "—"}>
                      {e.old_value || <span className="italic">empty</span>}
                    </span>
                    <ArrowRight size={10} className="text-muted-foreground shrink-0" />
                    <span className="font-medium text-foreground max-w-[140px] truncate" title={e.new_value ?? "—"}>
                      {e.new_value || <span className="italic text-muted-foreground">empty</span>}
                    </span>
                  </div>
                  <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                    <span className="font-medium text-foreground">{e.changed_by_name || "Unknown user"}</span>
                    <span>·</span>
                    <span>{format(parseISO(e.changed_at), "dd MMM yyyy")} at {format(parseISO(e.changed_at), "HH:mm")}</span>
                  </div>
                </div>
              ))
            )
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
