// FsStatusChip — compact page-level FS status pill + on-demand right drawer.
// Lives in the existing header button row beside Export, so it costs ~0 vertical
// page space when clean. Click opens a Sheet (no page reflow) listing what
// blocks export and any advisory warnings. It IS the export gate's visible face:
// its tone + the drawer read the same exportExcelBlock reasons the buttons use.
import { useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { CheckCircle2, AlertTriangle, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props { blocked: boolean; reasons: string[]; warnings?: string[]; }

export default function FsStatusChip({ blocked, reasons, warnings = [] }: Props) {
  const [open, setOpen] = useState(false);
  const nB = reasons.length, nW = warnings.length;
  const Icon = nB ? AlertCircle : nW ? AlertTriangle : CheckCircle2;
  const label = nB ? `FS: ${nB} to fix` : nW ? `FS: ${nW} to check` : "FS OK";
  const tone = nB
    ? "text-destructive border-destructive/40 bg-destructive/10"
    : nW
      ? "text-amber-600 dark:text-amber-400 border-amber-500/40 bg-amber-500/10"
      : "text-emerald-600 dark:text-emerald-400 border-emerald-500/30 bg-emerald-500/10";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Financial statements health: ${label}${blocked ? ", export blocked" : ""}`}
        className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-opacity hover:opacity-80", tone)}
      >
        <Icon className="h-3.5 w-3.5" /> {label}
      </button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="w-[92vw] sm:w-[460px] p-0">
          <SheetHeader className="px-5 py-4 border-b">
            <SheetTitle className="flex items-center justify-between text-base">
              <span>FS health</span>
              <span className={cn("text-xs font-medium", blocked ? "text-destructive" : "text-emerald-600 dark:text-emerald-400")}>
                {blocked ? "Export: blocked" : "Export: ready"}
              </span>
            </SheetTitle>
          </SheetHeader>
          <ScrollArea className="h-[calc(100vh-72px)]">
            <div className="px-5 py-4 space-y-5 text-sm">
              {nB > 0 && (
                <section className="space-y-2">
                  <div className="text-[11px] uppercase tracking-wide text-destructive font-medium">Blocks export ({nB})</div>
                  {reasons.map((r, i) => (
                    <div key={i} className="flex items-start gap-2 rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2">
                      <AlertCircle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
                      <span>{r}</span>
                    </div>
                  ))}
                </section>
              )}
              {nW > 0 && (
                <section className="space-y-2">
                  <div className="text-[11px] uppercase tracking-wide text-amber-600 dark:text-amber-400 font-medium">Warnings ({nW})</div>
                  {warnings.map((r, i) => (
                    <div key={i} className="flex items-start gap-2 rounded-md border border-amber-500/20 bg-amber-500/5 px-3 py-2">
                      <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
                      <span>{r}</span>
                    </div>
                  ))}
                </section>
              )}
              {nB === 0 && nW === 0 && (
                <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="h-4 w-4" /> All financial-statement checks pass — ready to export.
                </div>
              )}
            </div>
          </ScrollArea>
        </SheetContent>
      </Sheet>
    </>
  );
}
