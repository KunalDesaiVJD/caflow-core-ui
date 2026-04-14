/**
 * AuditChangeLogModal
 *
 * Displays field-level change history for a single audit_status row.
 * Each entry shows: field name, old → new value, changed by, date+time.
 * Sorted newest-first.
 */
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge }    from "@/components/ui/badge";
import { History, ArrowRight } from "lucide-react";
import { format, parseISO } from "date-fns";
import { useAuditChangeLog } from "../hooks/useAuditChangeLog";

interface Props {
  recordId:  string | null;
  partyName: string | null;
  open:      boolean;
  onClose:   () => void;
}

export default function AuditChangeLogModal({ recordId, partyName, open, onClose }: Props) {
  const { entries, loading } = useAuditChangeLog(open ? recordId : null);

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <History size={16} className="text-indigo-600" />
            Change History
            {partyName && (
              <span className="text-sm font-normal text-muted-foreground">
                — {partyName}
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-2 mt-2">
          {loading ? (
            Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full rounded-md" />
            ))
          ) : entries.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              No changes recorded yet.
              <p className="text-xs mt-1 text-muted-foreground/70">
                Changes will appear here after the <code>audit_change_log</code> migration is applied.
              </p>
            </div>
          ) : (
            entries.map(e => (
              <div
                key={e.id}
                className="flex flex-col gap-1 rounded-md border border-border bg-muted/20 px-3 py-2 text-xs"
              >
                {/* Field badge + old → new */}
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

                {/* By + when */}
                <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                  <span className="font-medium text-foreground">
                    {e.changed_by_name || "Unknown user"}
                  </span>
                  <span>·</span>
                  <span>
                    {format(parseISO(e.changed_at), "dd MMM yyyy")}
                  </span>
                  <span>at</span>
                  <span>
                    {format(parseISO(e.changed_at), "HH:mm")}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
