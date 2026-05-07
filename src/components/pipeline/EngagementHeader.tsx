import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { Building2, CalendarRange } from "lucide-react";

interface EngagementHeaderProps {
  engagement: any;
  stageNumber?: number;            // 1..9, shows "Stage X / 10" in header
  stageLabel?: string;             // e.g. "COA Mapping"
  compact?: boolean;               // collapsed single-line variant
  className?: string;
}

/**
 * Persistent engagement banner shown across all 9 pipeline stages.
 * Displays: Client Name, Entity type, PAN, GSTIN, CIN, FY, AY, Pipeline stage.
 * Derives Assessment Year from Financial Year.
 *
 * Resilience: Some upstream callers pass an engagement object whose joined
 * `clients(...)` row was fetched with a narrower SELECT (e.g. only `name`
 * and `entity_type`). When that happens, this header silently fetches the
 * missing fields directly from the `clients` table using engagement.client_id,
 * so PAN / GSTIN / CIN / state / TAN never disappear depending on which stage
 * the user is on.
 */
export default function EngagementHeader({
  engagement,
  stageNumber,
  stageLabel,
  compact = false,
  className,
}: EngagementHeaderProps) {
  const joinedClient = engagement?.clients ?? {};
  const clientId     = engagement?.client_id ?? joinedClient?.id;

  // Detect a narrow join — name/entity_type present but the rest absent.
  // When detected, fetch the missing fields once.
  const needsClientFetch =
    !!clientId &&
    !joinedClient?.pan &&
    !joinedClient?.gstin &&
    !joinedClient?.cin &&
    !joinedClient?.tan_number &&
    !joinedClient?.registered_state;

  const { data: fetchedClient } = useQuery({
    queryKey: ["engagement-header-client", clientId],
    queryFn: async () => {
      const { data } = await supabase
        .from("clients")
        .select("id, name, entity_type, pan, gstin, cin, registered_state, tan_number, date_of_incorporation")
        .eq("id", clientId!)
        .maybeSingle();
      return (data as any) ?? null;
    },
    enabled: needsClientFetch,
    staleTime: 5 * 60 * 1000,
  });

  // Merge the joined data with the fallback fetch. Joined values win when
  // both are non-empty so we never overwrite richer data with stale data.
  const client = useMemo(() => {
    const j: Record<string, any> = joinedClient || {};
    const f: Record<string, any> = fetchedClient || {};
    return {
      ...f,
      ...j,
      pan:               j.pan               || f.pan,
      gstin:             j.gstin             || f.gstin,
      cin:               j.cin               || f.cin,
      tan_number:        j.tan_number        || f.tan_number,
      registered_state:  j.registered_state  || f.registered_state,
      name:              j.name              || f.name,
      entity_type:       j.entity_type       || f.entity_type,
    };
  }, [joinedClient, fetchedClient]);
  const fy = engagement?.financial_year || "—";
  const entityType = engagement?.entity_type || client?.entity_type || "—";

  // AY = FY start-year + 1  →  next year
  //   FY 2025-26 → AY 2026-27
  const assessmentYear = useMemo(() => {
    if (!fy || fy === "—") return "—";
    const parts = String(fy).split("-");
    if (parts.length !== 2) return "—";
    const start = parseInt(parts[0], 10);
    if (!Number.isFinite(start)) return "—";
    const ayStart = start + 1;
    const ayEnd = (ayStart + 1).toString().slice(-2);
    return `${ayStart}-${ayEnd}`;
  }, [fy]);

  const entityBadgeClass = (() => {
    const t = String(entityType || "").toLowerCase();
    if (t.includes("company") || t.includes("opc")) return "bg-blue-50 text-blue-700 border-blue-300 dark:bg-blue-950/40 dark:text-blue-300";
    if (t.includes("llp"))         return "bg-violet-50 text-violet-700 border-violet-300 dark:bg-violet-950/40 dark:text-violet-300";
    if (t.includes("partnership")) return "bg-amber-50 text-amber-800 border-amber-300 dark:bg-amber-950/40 dark:text-amber-300";
    if (t.includes("individual") || t.includes("proprietor")) return "bg-slate-100 text-slate-700 border-slate-300 dark:bg-slate-900/60 dark:text-slate-300";
    if (t.includes("trust") || t.includes("society")) return "bg-teal-50 text-teal-700 border-teal-300 dark:bg-teal-950/40 dark:text-teal-300";
    return "bg-muted text-muted-foreground border-muted-foreground/30";
  })();

  const frameworkLabel = (() => {
    const t = String(entityType || "").toLowerCase();
    // "Private Ltd" / "Public Ltd" / "Pvt Ltd" / "Ltd" / "Limited" / "Company" / "OPC"
    // all qualify as corporate entities under Schedule III.
    const isCorporate =
      t.includes("company") ||
      t.includes("opc") ||
      t.includes("ltd") ||
      t.includes("limited") ||
      t.includes("private") ||
      t.includes("public");
    if (isCorporate) {
      const div = engagement?.schedule_iii_division;
      if (div === "div_ii") return "Schedule III · Ind AS (Div II)";
      return "Schedule III (Div I)";
    }
    return "Non-corporate (NCE)";
  })();

  if (!engagement) return null;

  if (compact) {
    return (
      <div className={cn("flex items-center gap-2 text-xs text-muted-foreground border-b pb-2", className)}>
        <Building2 size={12} />
        <span className="font-semibold text-foreground truncate">{client?.name || "—"}</span>
        <Badge variant="outline" className={cn("text-[9px] px-1", entityBadgeClass)}>{entityType}</Badge>
        <span>·</span><span>PAN {client?.pan || "—"}</span>
        <span>·</span><span>FY {fy}</span>
        <span>·</span><span>AY {assessmentYear}</span>
        {stageNumber && <>
          <span className="ml-auto">·</span>
          <span>Stage {stageNumber}/9{stageLabel ? ` · ${stageLabel}` : ""}</span>
        </>}
      </div>
    );
  }

  return (
    <Card className={cn("sticky top-0 z-20 border-primary/20 bg-gradient-to-r from-primary/5 via-background to-background", className)}>
      <CardContent className="py-3 px-4">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          {/* Left: Client identity */}
          <div className="flex items-start gap-3 min-w-0 flex-1">
            <div className="rounded-md bg-primary/10 p-2 shrink-0">
              <Building2 className="h-5 w-5 text-primary" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-base font-bold text-foreground truncate">{client?.name || "—"}</h2>
                <Badge variant="outline" className={cn("text-[10px] px-1.5 py-0", entityBadgeClass)}>
                  {entityType}
                </Badge>
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-muted-foreground/30 text-muted-foreground">
                  {frameworkLabel}
                </Badge>
                {engagement?.is_py_shell && (
                  <Badge className="text-[10px] px-1.5 py-0 bg-amber-600 hover:bg-amber-600 text-white">
                    PY SHELL
                  </Badge>
                )}
              </div>
              {/* Issue 3 — PAN / GSTIN / CIN / TAN / state row removed from
                  the engagement banner per user request (unnecessary clutter
                  on every stage).  The full client master remains accessible
                  from the client management screen. */}
            </div>
          </div>

          {/* Right: Period + Stage */}
          <div className="flex items-center gap-2 shrink-0">
            <div className="text-right">
              <div className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-primary/10 text-primary text-xs font-semibold">
                <CalendarRange size={12} /> FY {fy}
              </div>
              <p className="text-[10px] text-muted-foreground mt-0.5">AY {assessmentYear}</p>
            </div>
            {stageNumber && (
              <div className="text-right border-l pl-3 ml-1">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Pipeline</p>
                <p className="text-xs font-semibold">
                  Stage <span className="text-primary">{stageNumber}</span> / 10
                </p>
                {stageLabel && <p className="text-[10px] text-muted-foreground">{stageLabel}</p>}
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
