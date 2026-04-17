/**
 * ClassificationHistoryTimeline
 *
 * Reads append-only history rows from `client_classification_history` for a
 * given client and renders them as a vertical dot-and-line timeline (most
 * recent change at the top).
 *
 * Each row shows:
 *   • Effective-from FY
 *   • old_classification → new_classification
 *   • When + who made the change (name resolved from public.users)
 *   • Optional notes
 *
 * The history table isn't in the generated Supabase types yet, so we use an
 * `(supabase as any)` cast on the `.from()` call.
 */
import { useEffect, useState } from "react";
import { format } from "date-fns";
import { Loader2, History } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface HistoryEntry {
  id: string;
  effective_from_fy: string;
  old_classification: string | null;
  new_classification: string;
  changed_at: string;
  changed_by: string | null;
  notes: string | null;
}

interface Props {
  clientId: string;
  /** Optional refresh signal — bump to force a refetch (e.g. after a save). */
  reloadKey?: number;
}

export default function ClassificationHistoryTimeline({ clientId, reloadKey = 0 }: Props) {
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);
  const [history, setHistory]     = useState<HistoryEntry[]>([]);
  const [nameById, setNameById]   = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const { data, error: hErr } = await (supabase as any)
          .from("client_classification_history")
          .select("id, effective_from_fy, old_classification, new_classification, changed_at, changed_by, notes")
          .eq("client_id", clientId)
          .order("effective_from_fy", { ascending: false });

        if (hErr) throw hErr;
        if (cancelled) return;

        const rows = (data || []) as HistoryEntry[];
        setHistory(rows);

        // Resolve "changed by" user names in one round-trip
        const userIds = Array.from(
          new Set(rows.map((r) => r.changed_by).filter((id): id is string => Boolean(id))),
        );
        if (userIds.length > 0) {
          const { data: users } = await supabase
            .from("users")
            .select("id, name")
            .in("id", userIds);
          if (!cancelled && users) {
            const map: Record<string, string> = {};
            users.forEach((u: any) => { map[u.id] = u.name; });
            setNameById(map);
          }
        } else {
          setNameById({});
        }
      } catch (e: any) {
        if (!cancelled) setError(e?.message || String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    if (clientId) load();
    return () => { cancelled = true; };
  }, [clientId, reloadKey]);

  // ─── Render ────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-3">
        <Loader2 className="h-3 w-3 animate-spin" /> Loading history…
      </div>
    );
  }

  if (error) {
    // Most likely cause: history table doesn't exist yet. Render quietly so the
    // surrounding card doesn't break — the warning is logged for devs.
    console.warn("[ClassificationHistory] load failed:", error);
    return (
      <p className="text-xs text-muted-foreground italic py-2">
        Classification history is not available.
      </p>
    );
  }

  return (
    <div>
      <h4 className="text-sm font-semibold mb-3 flex items-center gap-1.5">
        <History className="h-3.5 w-3.5" /> Classification History
      </h4>

      {history.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">
          No classification changes recorded.
        </p>
      ) : (
        <div className="space-y-0">
          {history.map((entry, i) => {
            const changedByName = entry.changed_by ? (nameById[entry.changed_by] || "Unknown user") : "System";
            const when = (() => {
              try { return format(new Date(entry.changed_at), "dd MMM yyyy, HH:mm"); }
              catch { return entry.changed_at; }
            })();
            return (
              <div key={entry.id} className="flex items-start gap-3">
                {/* Dot + connector */}
                <div className="flex flex-col items-center pt-1">
                  <div className="w-2.5 h-2.5 rounded-full bg-amber-500 ring-2 ring-amber-100" />
                  {i < history.length - 1 && (
                    <div className="w-0.5 flex-1 min-h-[28px] bg-border my-0.5" />
                  )}
                </div>

                {/* Entry body */}
                <div className="flex-1 pb-3">
                  <p className="text-sm font-medium">
                    From FY <span className="font-mono">{entry.effective_from_fy}</span>:
                    <span className="text-blue-600 ml-1">{entry.old_classification ?? "—"}</span>
                    <span className="mx-1 text-muted-foreground">→</span>
                    <span className="text-orange-600">{entry.new_classification}</span>
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Changed on {when} by <span className="font-medium">{changedByName}</span>
                  </p>
                  {entry.notes && (
                    <p className="text-xs text-muted-foreground italic mt-1 border-l-2 border-border pl-2">
                      {entry.notes}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
