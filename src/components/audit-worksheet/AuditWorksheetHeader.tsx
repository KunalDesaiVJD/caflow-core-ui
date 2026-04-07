/**
 * AuditWorksheetHeader
 * Displays the CA firm name prominently + key engagement details.
 * Req #1: firm name at the top of every sheet.
 */
import { Badge } from "@/components/ui/badge";
import type { AuditWorksheetData } from "./hooks/useAuditWorksheetData";

interface Props {
  data: AuditWorksheetData;
}

export default function AuditWorksheetHeader({ data }: Props) {
  return (
    <div className="bg-card border rounded-lg p-4 mb-2">
      <div className="flex flex-wrap items-start justify-between gap-2">
        {/* Firm Name — Req #1 */}
        <div>
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">
            CA / Audit Firm
          </p>
          <h2 className="text-lg font-bold text-foreground leading-tight">
            {data.firmName || "—"}
          </h2>
        </div>

        <div className="flex flex-wrap gap-1.5 items-center">
          <Badge variant="outline" className="text-xs">{data.auditTypeLabel}</Badge>
          {data.isCorporate && (
            <Badge className="text-xs bg-blue-100 text-blue-700 border-blue-200">Corporate</Badge>
          )}
          {data.financialYear && (
            <Badge variant="secondary" className="text-xs">FY {data.financialYear}</Badge>
          )}
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-3 text-sm border-t pt-3">
        <div>
          <p className="text-[11px] text-muted-foreground uppercase tracking-wide">Client</p>
          <p className="font-medium truncate">{data.clientName || "—"}</p>
        </div>
        <div>
          <p className="text-[11px] text-muted-foreground uppercase tracking-wide">PAN</p>
          <p className="font-medium font-mono">{data.pan || "—"}</p>
        </div>
        <div>
          <p className="text-[11px] text-muted-foreground uppercase tracking-wide">Period</p>
          <p className="font-medium">
            {data.fyStartDate
              ? `${data.fyStartDate} → ${data.fyEndDate}`
              : "—"}
          </p>
        </div>
        <div>
          <p className="text-[11px] text-muted-foreground uppercase tracking-wide">Entity</p>
          <p className="font-medium">{data.entityType || "—"}</p>
        </div>
      </div>
    </div>
  );
}
