/**
 * WorksheetVersionHistoryPanel — CP-16
 *
 * Slide-over panel showing a timeline of all section saves for this engagement.
 * Filters: Section, Changed By, Date range.
 * Export: downloads the filtered list as an XLSX file.
 */
import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button }   from "@/components/ui/button";
import { Input }    from "@/components/ui/input";
import { Label }    from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton }  from "@/components/ui/skeleton";
import { Download, History } from "lucide-react";
import { format }    from "date-fns";

import { useWorksheetHistory } from "./hooks/useWorksheetHistory";
import type { WorksheetHistoryEntry } from "./hooks/useWorksheetHistory";

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  engagementId: string;
  open:         boolean;
  onClose:      () => void;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtDate(iso: string): string {
  try { return format(new Date(iso), "dd MMM yyyy, hh:mm a"); }
  catch { return iso; }
}

function uniq<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function WorksheetVersionHistoryPanel({
  engagementId,
  open,
  onClose,
}: Props) {
  const { history, loading, fetchHistory } = useWorksheetHistory(engagementId);

  // Fetch when panel opens
  useEffect(() => {
    if (open) fetchHistory();
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Filters ──────────────────────────────────────────────────────────────
  const [filterSection, setFilterSection] = useState("__all__");
  const [filterBy,      setFilterBy]      = useState("__all__");
  const [dateFrom,      setDateFrom]      = useState("");
  const [dateTo,        setDateTo]        = useState("");

  const sectionOptions = useMemo(
    () => uniq(history.map(h => h.section_name)).sort(),
    [history]
  );
  const byOptions = useMemo(
    () => uniq(history.map(h => h.changed_by_name || "Unknown")).sort(),
    [history]
  );

  const filtered = useMemo(() => {
    return history.filter(h => {
      if (filterSection !== "__all__" && h.section_name !== filterSection) return false;
      if (filterBy      !== "__all__" && (h.changed_by_name || "Unknown") !== filterBy) return false;
      if (dateFrom) {
        const d = new Date(h.changed_at);
        if (d < new Date(dateFrom)) return false;
      }
      if (dateTo) {
        const d = new Date(h.changed_at);
        const to = new Date(dateTo);
        to.setHours(23, 59, 59, 999);
        if (d > to) return false;
      }
      return true;
    });
  }, [history, filterSection, filterBy, dateFrom, dateTo]);

  // ── Export ────────────────────────────────────────────────────────────────
  const exportExcel = () => {
    const rows = filtered.map(h => ({
      "Date / Time":    fmtDate(h.changed_at),
      "Section":        h.section_name,
      "Page / Clause":  h.page_label   || "",
      "Field":          h.field_name   || "",
      "Changed By":     h.changed_by_name || "Unknown",
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    ws["!cols"] = [
      { wch: 22 }, { wch: 26 }, { wch: 22 }, { wch: 20 }, { wch: 22 },
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Version History");
    XLSX.writeFile(wb, `WorksheetHistory_${engagementId.slice(0, 8)}.xlsx`);
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <Sheet open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-2xl flex flex-col p-0 gap-0"
      >
        {/* ── Header ── */}
        <SheetHeader className="px-6 py-4 border-b">
          <div className="flex items-center justify-between">
            <SheetTitle className="flex items-center gap-2 text-base">
              <History size={16} className="text-indigo-600" />
              Version History
            </SheetTitle>
            <Button
              size="sm"
              variant="outline"
              className="gap-1 text-xs h-7"
              onClick={exportExcel}
              disabled={filtered.length === 0}
            >
              <Download size={13} /> Export History → Excel
            </Button>
          </div>
        </SheetHeader>

        {/* ── Filters ── */}
        <div className="px-6 py-3 border-b bg-muted/30 grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Section</Label>
            <Select value={filterSection} onValueChange={setFilterSection}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="All sections" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All sections</SelectItem>
                {sectionOptions.map(s => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Changed By</Label>
            <Select value={filterBy} onValueChange={setFilterBy}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="All users" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All users</SelectItem>
                {byOptions.map(u => (
                  <SelectItem key={u} value={u}>{u}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">From Date</Label>
            <Input
              type="date"
              className="h-8 text-xs"
              value={dateFrom}
              onChange={e => setDateFrom(e.target.value)}
            />
          </div>

          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">To Date</Label>
            <Input
              type="date"
              className="h-8 text-xs"
              value={dateTo}
              onChange={e => setDateTo(e.target.value)}
            />
          </div>
        </div>

        {/* ── Timeline ── */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3, 4].map(i => (
                <Skeleton key={i} className="h-14 w-full" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center text-muted-foreground text-sm py-12">
              {history.length === 0
                ? "No saves recorded yet for this engagement."
                : "No entries match the selected filters."}
            </div>
          ) : (
            <ol className="relative border-l border-muted-foreground/20 space-y-0">
              {filtered.map((h, idx) => (
                <HistoryRow key={h.id} entry={h} isLast={idx === filtered.length - 1} />
              ))}
            </ol>
          )}
        </div>

        {/* ── Footer count ── */}
        {!loading && filtered.length > 0 && (
          <div className="px-6 py-2 border-t text-xs text-muted-foreground">
            Showing {filtered.length} of {history.length} entries
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

// ─── Timeline row ─────────────────────────────────────────────────────────────

function HistoryRow({
  entry,
  isLast,
}: {
  entry:  WorksheetHistoryEntry;
  isLast: boolean;
}) {
  return (
    <li className={`ml-4 pb-4 ${isLast ? "" : ""}`}>
      {/* dot */}
      <span className="absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full border-2 border-indigo-500 bg-white" />
      <div className="rounded-md border bg-card px-3 py-2 shadow-sm space-y-0.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold text-foreground">
            {entry.section_name}
            {entry.page_label && (
              <span className="ml-1.5 font-normal text-muted-foreground">
                — {entry.page_label}
              </span>
            )}
          </span>
          <span className="text-[11px] text-muted-foreground whitespace-nowrap">
            {fmtDate(entry.changed_at)}
          </span>
        </div>
        <div className="text-[11px] text-muted-foreground">
          Saved by{" "}
          <span className="font-medium text-foreground">
            {entry.changed_by_name || "Unknown"}
          </span>
          {entry.field_name && (
            <span className="ml-1">· {entry.field_name}</span>
          )}
        </div>
      </div>
    </li>
  );
}
