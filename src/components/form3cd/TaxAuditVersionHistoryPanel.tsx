/**
 * TaxAuditVersionHistoryPanel
 * Side-sheet that shows the version history for a single 3CD clause or annexure
 * sourced from the tax_audit_versions table.
 */
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Loader2, History } from "lucide-react";
import { format } from "date-fns";

interface VersionRow {
  id: string;
  changed_at: string;
  user_id: string | null;
  old_value: Record<string, any> | null;
  new_value: Record<string, any> | null;
  change_reason: string | null;
  profiles?: { full_name?: string; email?: string } | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  engagementId: string;
  /** 'clause' | 'annexure' | 'value' */
  elementType: "clause" | "annexure" | "value";
  /** Human-readable label, e.g. "Clause 12" */
  label: string;
  /** The element_id (UUID from tax_audit_3cd_clauses / tax_audit_annexures) */
  elementId?: string;
}

// Highlight fields that changed between two versions
function DiffRow({ field, oldVal, newVal }: { field: string; oldVal: unknown; newVal: unknown }) {
  const changed = JSON.stringify(oldVal) !== JSON.stringify(newVal);
  if (!changed) return null;
  return (
    <div className="text-xs grid grid-cols-[1fr_1fr] gap-2 py-1 border-b border-border last:border-0">
      <div>
        <p className="text-[10px] font-medium text-muted-foreground mb-0.5">{field} (before)</p>
        <p className="text-destructive/90 line-through break-all">
          {oldVal == null || oldVal === "" ? <span className="italic text-muted-foreground">empty</span> : String(oldVal)}
        </p>
      </div>
      <div>
        <p className="text-[10px] font-medium text-muted-foreground mb-0.5">{field} (after)</p>
        <p className="text-emerald-600 break-all">
          {newVal == null || newVal === "" ? <span className="italic text-muted-foreground">empty</span> : String(newVal)}
        </p>
      </div>
    </div>
  );
}

function VersionEntry({ v, idx, total }: { v: VersionRow; idx: number; total: number }) {
  const old = v.old_value ?? {};
  const next = v.new_value ?? {};
  const SKIP = new Set(["updated_at", "id", "engagement_id"]);

  const allKeys = Array.from(new Set([...Object.keys(old), ...Object.keys(next)])).filter(
    (k) => !SKIP.has(k)
  );

  const changedKeys = allKeys.filter(
    (k) => JSON.stringify(old[k]) !== JSON.stringify(next[k])
  );

  const author =
    (v.profiles as any)?.full_name ||
    (v.profiles as any)?.email ||
    (v.user_id ? v.user_id.slice(0, 8) + "…" : "System");

  return (
    <div className="border border-border rounded-lg p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-[10px]">v{total - idx}</Badge>
          <span className="text-xs text-muted-foreground">{author}</span>
        </div>
        <span className="text-[10px] text-muted-foreground">
          {format(new Date(v.changed_at), "dd MMM yyyy, h:mm a")}
        </span>
      </div>
      {v.change_reason && (
        <p className="text-xs text-muted-foreground italic">"{v.change_reason}"</p>
      )}
      {changedKeys.length === 0 ? (
        <p className="text-xs text-muted-foreground">No field changes recorded.</p>
      ) : (
        <div>
          {changedKeys.map((k) => (
            <DiffRow key={k} field={k} oldVal={old[k]} newVal={next[k]} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function TaxAuditVersionHistoryPanel({
  open,
  onClose,
  engagementId,
  elementType,
  label,
  elementId,
}: Props) {
  const [versions, setVersions] = useState<VersionRow[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !engagementId) return;
    load();
  }, [open, engagementId, elementId, elementType]);

  async function load() {
    setLoading(true);
    setVersions([]);
    try {
      let query = supabase
        .from("tax_audit_versions")
        .select("*, profiles(full_name, email)")
        .eq("engagement_id", engagementId)
        .eq("element_type", elementType)
        .order("changed_at", { ascending: false })
        .limit(50);

      if (elementId) {
        query = query.eq("element_id", elementId);
      }

      const { data, error } = await query;
      if (error) throw error;
      setVersions((data as VersionRow[]) ?? []);
    } catch (e) {
      console.error("History load failed:", e);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <SheetContent side="right" className="w-full sm:max-w-lg p-0 flex flex-col">
        <SheetHeader className="px-5 pt-5 pb-3 border-b border-border">
          <SheetTitle className="flex items-center gap-2 text-base">
            <History className="h-4 w-4" />
            Version History — {label}
          </SheetTitle>
          <p className="text-xs text-muted-foreground">
            Changes are logged automatically on every save.
          </p>
        </SheetHeader>

        <ScrollArea className="flex-1 px-5 py-4">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : versions.length === 0 ? (
            <div className="text-center py-16">
              <History className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">No version history yet.</p>
              <p className="text-xs text-muted-foreground mt-1">
                Changes will appear here after the first edit is saved.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {versions.map((v, idx) => (
                <VersionEntry key={v.id} v={v} idx={idx} total={versions.length} />
              ))}
            </div>
          )}
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
