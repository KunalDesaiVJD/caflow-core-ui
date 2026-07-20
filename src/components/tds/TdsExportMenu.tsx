import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Download, FileSpreadsheet, FileText, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { reportFileName, type StageReport, type ReportMeta } from "@/lib/tds/tdsReport";
import { buildStageWorkbook, downloadWorkbook } from "@/lib/tds/tdsReportExcel";
import { exportStagePdf } from "@/lib/tds/tdsReportPdf";

/**
 * "Export" for a validation stage — Excel or PDF from the SAME StageReport.
 *
 * The report is built LAZILY via `build()` so a stage that has not been run costs
 * nothing, and the rows exported are always the ones on screen right now.
 */
export function TdsExportMenu({
  build, meta, disabled, label = "Export",
}: {
  build: () => StageReport;
  meta: ReportMeta;
  disabled?: boolean;
  label?: string;
}) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);

  const run = async (fmt: "xlsx" | "pdf") => {
    setBusy(true);
    try {
      const report = build();
      if (fmt === "xlsx") await downloadWorkbook(buildStageWorkbook(report, meta), reportFileName(meta, report.title, "xlsx"));
      else await exportStagePdf(report, meta);
    } catch (e: any) {
      toast({ title: "Export failed", description: e?.message || String(e), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="outline" className="h-6 px-2 text-[11px] gap-1 shrink-0" disabled={disabled || busy}>
          {busy ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />} {label}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => run("xlsx")} className="text-xs gap-2">
          <FileSpreadsheet size={13} /> Export to Excel (.xlsx)
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => run("pdf")} className="text-xs gap-2">
          <FileText size={13} /> Export to PDF (.pdf)
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
