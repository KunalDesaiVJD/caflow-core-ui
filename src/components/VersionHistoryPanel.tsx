import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Clock, RotateCcw, ArrowRight } from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import type { Json } from "@/integrations/supabase/types";

interface VersionHistoryPanelProps {
  table_name: string;
  record_id: string;
}

interface HistoryEntry {
  id: string;
  operation: string | null;
  user_name: string | null;
  user_role: string | null;
  table_name: string | null;
  record_id: string | null;
  changed_fields: string[] | null;
  old_data: Json | null;
  new_data: Json | null;
  created_at: string | null;
}

const DOT_COLORS: Record<string, string> = {
  INSERT: "bg-emerald-500",
  UPDATE: "bg-amber-500",
  DELETE: "bg-red-500",
  RESTORE: "bg-sky-500",
};

const OP_BADGE_COLORS: Record<string, string> = {
  INSERT: "bg-emerald-100 text-emerald-700 border-emerald-200",
  UPDATE: "bg-amber-100 text-amber-700 border-amber-200",
  DELETE: "bg-red-100 text-red-700 border-red-200",
  RESTORE: "bg-sky-100 text-sky-700 border-sky-200",
};

const RESTORE_ROLES = ["partner_ca", "firm_admin", "superadmin"];

function formatValue(val: unknown): string {
  if (val === null || val === undefined) return "null";
  if (typeof val === "object") return JSON.stringify(val);
  return String(val);
}

export function VersionHistoryPanel({ table_name, record_id }: VersionHistoryPanelProps) {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const { user } = useAuth();
  const { toast } = useToast();

  // Restore state
  const [restoreEntry, setRestoreEntry] = useState<HistoryEntry | null>(null);
  const [restoring, setRestoring] = useState(false);

  const canRestore = user?.role ? RESTORE_ROLES.includes(user.role) : false;

  const fetchHistory = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("version_history")
      .select("*")
      .eq("table_name", table_name)
      .eq("record_id", record_id)
      .order("created_at", { ascending: false });

    if (!error && data) {
      setEntries(data as HistoryEntry[]);
    }
    setLoading(false);
  }, [table_name, record_id]);

  useEffect(() => {
    if (open) fetchHistory();
  }, [open, fetchHistory]);

  const handleRestore = async () => {
    if (!restoreEntry?.old_data || typeof restoreEntry.old_data !== "object") return;
    setRestoring(true);

    try {
      const oldData = restoreEntry.old_data as Record<string, unknown>;
      // Remove id and created_at from restore payload
      const { id, created_at, ...restorePayload } = oldData;

      const { error } = await supabase
        .from(table_name as any)
        .update(restorePayload as any)
        .eq("id", record_id as any);

      if (error) throw error;

      // Log the restore
      await supabase.from("version_history").insert({
        operation: "RESTORE",
        user_name: user?.name || "Unknown",
        user_role: user?.role || "unknown",
        table_name,
        record_id,
        old_data: restoreEntry.old_data,
        new_data: restoreEntry.old_data,
        changed_fields: restoreEntry.changed_fields,
      });

      toast({ title: "Record restored successfully" });
      setRestoreEntry(null);
      fetchHistory();
    } catch (e: any) {
      toast({ title: "Restore failed", description: e.message, variant: "destructive" });
    } finally {
      setRestoring(false);
    }
  };

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8"
        onClick={() => setOpen(true)}
        title="Change History"
      >
        <Clock className="h-4 w-4" />
      </Button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="font-display">Change History</SheetTitle>
            <SheetDescription>
              <span className="font-mono text-xs">{table_name}</span>
              {" · "}
              <span className="font-mono text-xs">{record_id.slice(0, 8)}…</span>
            </SheetDescription>
          </SheetHeader>

          <div className="mt-6">
            {loading ? (
              <div className="space-y-6">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="flex gap-3">
                    <Skeleton className="h-3 w-3 rounded-full mt-1 shrink-0" />
                    <div className="space-y-2 flex-1">
                      <Skeleton className="h-4 w-40" />
                      <Skeleton className="h-3 w-56" />
                      <Skeleton className="h-12 w-full" />
                    </div>
                  </div>
                ))}
              </div>
            ) : entries.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">No history found for this record.</p>
            ) : (
              <div className="relative">
                {/* Timeline line */}
                <div className="absolute left-[5px] top-2 bottom-2 w-px bg-border" />

                <div className="space-y-6">
                  {entries.map((entry) => {
                    const op = entry.operation || "UNKNOWN";
                    const oldObj = (entry.old_data && typeof entry.old_data === "object" && !Array.isArray(entry.old_data))
                      ? entry.old_data as Record<string, unknown>
                      : null;
                    const newObj = (entry.new_data && typeof entry.new_data === "object" && !Array.isArray(entry.new_data))
                      ? entry.new_data as Record<string, unknown>
                      : null;

                    return (
                      <div key={entry.id} className="relative pl-7">
                        {/* Dot */}
                        <div className={`absolute left-0 top-1.5 h-[11px] w-[11px] rounded-full border-2 border-background ${DOT_COLORS[op] || "bg-muted-foreground"}`} />

                        {/* Header */}
                        <div className="flex items-start justify-between gap-2">
                          <div className="space-y-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-sm font-medium text-foreground">{entry.user_name || "System"}</span>
                              {entry.user_role && (
                                <Badge variant="outline" className="text-[10px] px-1.5 py-0">{entry.user_role}</Badge>
                              )}
                              <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${OP_BADGE_COLORS[op] || "bg-muted text-muted-foreground border-border"}`}>
                                {op}
                              </span>
                            </div>
                            {entry.created_at && (
                              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                <span>{format(new Date(entry.created_at), "MMMM d, yyyy 'at' HH:mm")}</span>
                                <span>·</span>
                                <span>{formatDistanceToNow(new Date(entry.created_at), { addSuffix: true })}</span>
                              </div>
                            )}
                          </div>

                          {canRestore && oldObj && op !== "INSERT" && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 text-xs shrink-0"
                              onClick={() => setRestoreEntry(entry)}
                            >
                              <RotateCcw className="h-3 w-3 mr-1" />
                              Restore
                            </Button>
                          )}
                        </div>

                        {/* Diff for UPDATE */}
                        {op === "UPDATE" && entry.changed_fields && entry.changed_fields.length > 0 && oldObj && newObj && (
                          <div className="mt-2 rounded-md border bg-muted/30 p-3 space-y-1.5">
                            {entry.changed_fields.map((field) => (
                              <div key={field} className="flex items-center gap-2 text-xs flex-wrap">
                                <span className="font-mono font-medium text-foreground">{field}</span>
                                <span className="line-through text-red-500/80">{formatValue(oldObj[field])}</span>
                                <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />
                                <span className="text-emerald-600 font-medium">{formatValue(newObj[field])}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>

      {/* Restore Confirmation */}
      <AlertDialog open={!!restoreEntry} onOpenChange={(o) => !o && setRestoreEntry(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restore record to this version?</AlertDialogTitle>
            <AlertDialogDescription>
              Current data will be replaced with the data from this point in time. This action will also be logged.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleRestore} disabled={restoring}>
              {restoring ? "Restoring…" : "Restore"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
