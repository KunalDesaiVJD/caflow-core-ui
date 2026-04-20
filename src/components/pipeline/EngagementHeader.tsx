import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { Building2, FileBadge, MapPin, CalendarRange, Hash } from "lucide-react";

interface EngagementHeaderProps {
  engagement: any;
  stageNumber?: number;            // 1..9, shows "Stage X / 9" in header
  stageLabel?: string;             // e.g. "COA Mapping"
  compact?: boolean;               // collapsed single-line variant
  className?: string;
}

/**
 * Persistent engagement banner shown across all 9 pipeline stages.
 * Displays: Client Name, Entity type, PAN, GSTIN, CIN, FY, AY, Pipeline stage.
 * Derives Assessment Year from Financial Year.
 */
export default function EngagementHeader({
  engagement,
  stageNumber,
  stageLabel,
  compact = false,
  className,
}: EngagementHeaderProps) {
  const client = engagement?.clients ?? {};
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

  const gstinList: string[] = Array.isArray(client?.gstin) ? client.gstin : [];
  const primaryGstin = gstinList[0];

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
    const isCorporate = t.includes("company") || t.includes("opc");
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
              </div>
              <div className="flex items-center gap-3 mt-1 text-[11px] text-muted-foreground flex-wrap">
                <span className="inline-flex items-center gap-1">
                  <Hash size={11} /> PAN <span className="font-mono text-foreground">{client?.pan || "—"}</span>
                </span>
                {primaryGstin && (
                  <span className="inline-flex items-center gap-1">
                    <FileBadge size={11} /> GSTIN <span className="font-mono text-foreground">{primaryGstin}</span>
                    {gstinList.length > 1 && <Badge variant="outline" className="text-[8px] px-1 ml-0.5">+{gstinList.length - 1}</Badge>}
                  </span>
                )}
                {client?.cin && (
                  <span className="inline-flex items-center gap-1">
                    <FileBadge size={11} /> CIN <span className="font-mono text-foreground">{client.cin}</span>
                  </span>
                )}
                {client?.tan_number && (
                  <span className="inline-flex items-center gap-1">
                    <FileBadge size={11} /> TAN <span className="font-mono text-foreground">{client.tan_number}</span>
                  </span>
                )}
                {client?.registered_state && (
                  <span className="inline-flex items-center gap-1">
                    <MapPin size={11} /> <span>{client.registered_state}</span>
                  </span>
                )}
              </div>
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
                  Stage <span className="text-primary">{stageNumber}</span> / 9
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
