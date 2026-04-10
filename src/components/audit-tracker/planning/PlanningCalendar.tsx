/**
 * PlanningCalendar — Google Calendar-style planning board
 *
 * Layout:
 *   Rows    = dates (1–31 for month view, 7 days for week view)
 *   Columns = employees (one column per user in the firm)
 *
 * Each cell shows the client name assigned to that employee on that date.
 * 'Leave' renders in a grey block. Empty cells are clickable to create.
 * Clicking a filled block opens the edit/delete dialog.
 *
 * Views: Month | Week
 * Navigation: < prev | Month Year | next >
 */
import { useState, useMemo, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, Plus, Calendar, AlignJustify } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PlanEntry } from "../hooks/useAuditPlanning";
import type { ClientOption } from "../hooks/useClients";
import type { UserOption }   from "../hooks/useUsers";
import PlanningEntryDialog, { type PlanSaveData } from "./PlanningEntryDialog";

// ─── Constants ────────────────────────────────────────────────────────────────

const MONTHS  = ["January","February","March","April","May","June",
                 "July","August","September","October","November","December"];
const DAY_ABR = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

// Tailwind colour pairs: bg / text — for client assignment blocks
const CLIENT_COLORS = [
  "bg-blue-100 text-blue-800 border-blue-200",
  "bg-emerald-100 text-emerald-800 border-emerald-200",
  "bg-amber-100 text-amber-800 border-amber-200",
  "bg-violet-100 text-violet-800 border-violet-200",
  "bg-rose-100 text-rose-800 border-rose-200",
  "bg-cyan-100 text-cyan-800 border-cyan-200",
  "bg-orange-100 text-orange-800 border-orange-200",
  "bg-teal-100 text-teal-800 border-teal-200",
  "bg-pink-100 text-pink-800 border-pink-200",
  "bg-lime-100 text-lime-800 border-lime-200",
];
const LEAVE_COLOR = "bg-gray-100 text-gray-500 border-gray-200";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Convert JS Date → "YYYY-MM-DD" using LOCAL date components.
 * DO NOT use d.toISOString() — it converts to UTC and shifts the date
 * backward by the TZ offset (e.g. IST UTC+5:30 shifts Apr 9 → Apr 8).
 */
function toISO(d: Date): string {
  const yyyy = d.getFullYear();
  const mm   = String(d.getMonth() + 1).padStart(2, "0");
  const dd   = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/** Dates for a given month (year, month 0-indexed) */
function monthDates(year: number, month: number): Date[] {
  const days = new Date(year, month + 1, 0).getDate();
  return Array.from({ length: days }, (_, i) => new Date(year, month, i + 1));
}

/** 7 dates starting from the given Monday */
function weekDates(monday: Date): Date[] {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(d.getDate() + i);
    return d;
  });
}

/** Get Monday of the week containing `d` */
function mondayOf(d: Date): Date {
  const r = new Date(d);
  const dow = r.getDay();           // 0 = Sun
  const diff = dow === 0 ? -6 : 1 - dow;
  r.setDate(r.getDate() + diff);
  r.setHours(0, 0, 0, 0);
  return r;
}

/** Stable colour for a client name (same name → same colour) */
function clientColor(name: string): string {
  if (!name || name.toLowerCase() === "leave") return LEAVE_COLOR;
  let h = 0;
  for (let i = 0; i < name.length; i++) {
    h = (h * 31 + name.charCodeAt(i)) | 0;
  }
  return CLIENT_COLORS[Math.abs(h) % CLIENT_COLORS.length];
}

/** Find all entries that cover a specific (date ISO, employeeId) cell */
function cellEntries(entries: PlanEntry[], dateISO: string, empId: string): PlanEntry[] {
  return entries.filter(e =>
    (e.employee_ids || []).includes(empId) &&
    e.planned_from <= dateISO &&
    e.planned_to   >= dateISO
  );
}

// ─── Cell component ───────────────────────────────────────────────────────────

interface CellProps {
  dateISO:   string;
  employee:  UserOption;
  entries:   PlanEntry[];
  onClick:   (dateISO: string, emp: UserOption, entry: PlanEntry | null) => void;
}

function CalCell({ dateISO, employee, entries, onClick }: CellProps) {
  const hits = cellEntries(entries, dateISO, employee.id);
  const primary = hits[0] || null;
  const extra   = hits.length - 1;

  if (!primary) {
    return (
      <td
        onClick={() => onClick(dateISO, employee, null)}
        className="border border-border/60 w-[90px] min-w-[90px] h-8 cursor-pointer hover:bg-indigo-50/40 transition-colors"
      />
    );
  }

  const isLeave = primary.client_name?.toLowerCase() === "leave";
  const color   = clientColor(primary.client_name || "");

  return (
    <td
      onClick={() => onClick(dateISO, employee, primary)}
      className="border border-border/60 w-[90px] min-w-[90px] h-8 p-[2px] cursor-pointer"
    >
      <div className={cn(
        "h-full px-1.5 rounded border text-[10px] font-medium flex items-center gap-0.5 overflow-hidden",
        color
      )}>
        <span className="truncate flex-1">{isLeave ? "Leave" : primary.client_name}</span>
        {extra > 0 && <span className="shrink-0 text-[9px] opacity-70">+{extra}</span>}
      </div>
    </td>
  );
}

// ─── Week-view cell (taller, shows date range info) ──────────────────────────

function WeekCell({ dateISO, employee, entries, onClick }: CellProps) {
  const hits = cellEntries(entries, dateISO, employee.id);
  const primary = hits[0] || null;

  if (!primary) {
    return (
      <td
        onClick={() => onClick(dateISO, employee, null)}
        className="border border-border/60 w-[90px] min-w-[90px] h-16 cursor-pointer hover:bg-indigo-50/40 transition-colors align-top p-1"
      />
    );
  }

  const isLeave = primary.client_name?.toLowerCase() === "leave";
  const color   = clientColor(primary.client_name || "");

  return (
    <td
      onClick={() => onClick(dateISO, employee, primary)}
      className="border border-border/60 w-[90px] min-w-[90px] h-16 cursor-pointer p-1 align-top"
    >
      <div className={cn(
        "h-full px-1.5 py-1 rounded border text-[10px] font-medium space-y-0.5",
        color
      )}>
        <p className="truncate font-semibold">{isLeave ? "Leave" : primary.client_name}</p>
        <p className="text-[9px] opacity-70">
          {primary.planned_from === primary.planned_to
            ? primary.planned_from
            : `${primary.planned_from} → ${primary.planned_to}`}
        </p>
      </div>
    </td>
  );
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  entries:         PlanEntry[];
  loading:         boolean;
  clients:         ClientOption[];
  users:           UserOption[];
  onAddEntry:      (data: PlanSaveData) => Promise<void>;
  onUpdateEntry:   (id: string, data: Partial<PlanEntry>) => Promise<void>;
  onDeleteEntry:   (id: string) => Promise<void>;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function PlanningCalendar({
  entries, loading, clients, users,
  onAddEntry, onUpdateEntry, onDeleteEntry,
}: Props) {
  const now = new Date();

  // ── View state ─────────────────────────────────────────────────────────────
  const [view,      setView]      = useState<"month"|"week">("month");
  const [year,      setYear]      = useState(now.getFullYear());
  const [month,     setMonth]     = useState(now.getMonth());
  const [weekStart, setWeekStart] = useState<Date>(mondayOf(now));

  // ── Dialog state ───────────────────────────────────────────────────────────
  const [dialogOpen,        setDialogOpen]        = useState(false);
  const [dialogEntry,       setDialogEntry]       = useState<PlanEntry | null>(null);
  const [dialogDate,        setDialogDate]        = useState<string>("");
  const [dialogEmpId,       setDialogEmpId]       = useState<string>("");
  const [dialogEmpName,     setDialogEmpName]     = useState<string>("");

  // ── Dates to render ────────────────────────────────────────────────────────
  const dates = useMemo<Date[]>(() => {
    if (view === "month") return monthDates(year, month);
    return weekDates(weekStart);
  }, [view, year, month, weekStart]);

  const todayISO = toISO(now);

  // ── Navigation ─────────────────────────────────────────────────────────────
  function prevPeriod() {
    if (view === "month") {
      if (month === 0) { setMonth(11); setYear(y => y - 1); }
      else setMonth(m => m - 1);
    } else {
      setWeekStart(d => { const n = new Date(d); n.setDate(n.getDate() - 7); return n; });
    }
  }
  function nextPeriod() {
    if (view === "month") {
      if (month === 11) { setMonth(0); setYear(y => y + 1); }
      else setMonth(m => m + 1);
    } else {
      setWeekStart(d => { const n = new Date(d); n.setDate(n.getDate() + 7); return n; });
    }
  }

  const periodLabel = view === "month"
    ? `${MONTHS[month]} ${year}`
    : (() => {
        const wEnd = new Date(weekStart);
        wEnd.setDate(wEnd.getDate() + 6);
        return `${weekStart.getDate()} ${MONTHS[weekStart.getMonth()].slice(0,3)} – ${wEnd.getDate()} ${MONTHS[wEnd.getMonth()].slice(0,3)} ${wEnd.getFullYear()}`;
      })();

  // ── Cell click ─────────────────────────────────────────────────────────────
  const handleCellClick = useCallback((dateISO: string, emp: UserOption, entry: PlanEntry | null) => {
    setDialogEntry(entry);
    setDialogDate(dateISO);
    setDialogEmpId(emp.id);
    setDialogEmpName(emp.name);
    setDialogOpen(true);
  }, []);

  // ── Dialog save ────────────────────────────────────────────────────────────
  async function handleSave(data: PlanSaveData, entryId?: string) {
    if (entryId) {
      await onUpdateEntry(entryId, data as Partial<PlanEntry>);
    } else {
      await onAddEntry(data);
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  const CellComponent = view === "month" ? CalCell : WeekCell;

  return (
    <div className="space-y-3">

      {/* ── Toolbar ── */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        {/* Left: navigation */}
        <div className="flex items-center gap-1.5">
          <Button size="sm" variant="outline" className="h-8 w-8 p-0" onClick={prevPeriod}>
            <ChevronLeft size={14} />
          </Button>
          <span className="text-sm font-semibold min-w-[200px] text-center select-none">
            {periodLabel}
          </span>
          <Button size="sm" variant="outline" className="h-8 w-8 p-0" onClick={nextPeriod}>
            <ChevronRight size={14} />
          </Button>
          <Button size="sm" variant="outline" className="h-8 text-xs ml-2"
            onClick={() => { setYear(now.getFullYear()); setMonth(now.getMonth()); setWeekStart(mondayOf(now)); }}>
            Today
          </Button>
        </div>

        {/* Right: view toggle + add */}
        <div className="flex items-center gap-1.5">
          <Button size="sm" variant={view === "month" ? "default" : "outline"}
            className="h-8 text-xs gap-1" onClick={() => setView("month")}>
            <AlignJustify size={12} /> Month
          </Button>
          <Button size="sm" variant={view === "week" ? "default" : "outline"}
            className="h-8 text-xs gap-1" onClick={() => setView("week")}>
            <Calendar size={12} /> Week
          </Button>
          <Button size="sm" className="h-8 text-xs gap-1 bg-indigo-600 hover:bg-indigo-700"
            onClick={() => { setDialogEntry(null); setDialogDate(""); setDialogEmpId(""); setDialogEmpName(""); setDialogOpen(true); }}>
            <Plus size={12} /> New
          </Button>
        </div>
      </div>

      {/* ── Calendar grid ── */}
      <div className="border rounded-lg overflow-hidden">
        <div
          className="overflow-auto"
          style={{ maxHeight: view === "month" ? "calc(100vh - 340px)" : "auto" }}
        >
          <table className="border-collapse text-xs" style={{ tableLayout: "fixed" }}>
            {/* Sticky header */}
            <thead className="sticky top-0 z-20">
              <tr className="bg-indigo-700 text-white text-[11px] uppercase tracking-wide">
                {/* Date column */}
                <th className="sticky left-0 z-30 bg-indigo-700 border border-indigo-600 px-2 py-2.5 text-left w-[90px] min-w-[90px]">
                  Date
                </th>
                {/* Employee columns */}
                {users.map(u => (
                  <th key={u.id}
                    className="border border-indigo-600 px-2 py-2.5 text-center w-[90px] min-w-[90px] truncate"
                    title={u.name}>
                    {u.name.split(" ")[0].toUpperCase()}
                  </th>
                ))}
              </tr>
            </thead>

            <tbody>
              {loading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i}>
                    <td colSpan={users.length + 1}
                      className="border border-border/60 h-8 px-3 bg-muted/20 animate-pulse" />
                  </tr>
                ))
              ) : users.length === 0 ? (
                <tr>
                  <td colSpan={2} className="py-12 text-center text-muted-foreground text-sm">
                    No employees found — check user management
                  </td>
                </tr>
              ) : (
                dates.map(date => {
                  const iso  = toISO(date);
                  const isToday = iso === todayISO;
                  const dayLabel = `${DAY_ABR[date.getDay()]} ${date.getDate()}`;

                  return (
                    <tr key={iso} className={cn(isToday && "bg-indigo-50/40")}>
                      {/* Sticky date cell */}
                      <td className={cn(
                        "sticky left-0 z-10 border border-border/60 px-2 align-middle select-none",
                        view === "month" ? "h-8" : "h-16",
                        isToday ? "bg-indigo-50 font-bold text-indigo-700" : "bg-card text-muted-foreground"
                      )}>
                        <div className="flex items-center gap-1.5">
                          {isToday && (
                            <span className="h-1.5 w-1.5 rounded-full bg-indigo-500 shrink-0" />
                          )}
                          <span className="text-[11px] whitespace-nowrap">{dayLabel}</span>
                        </div>
                      </td>

                      {/* Employee cells */}
                      {users.map(emp => (
                        <CellComponent
                          key={emp.id}
                          dateISO={iso}
                          employee={emp}
                          entries={entries}
                          onClick={handleCellClick}
                        />
                      ))}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Entry count hint */}
      <p className="text-[11px] text-muted-foreground">
        {entries.length} assignment{entries.length !== 1 ? "s" : ""} total
        {" · "}Click any cell to create or edit
      </p>

      {/* ── Dialog ── */}
      <PlanningEntryDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        entry={dialogEntry}
        initialDate={dialogDate}
        initialEmployeeId={dialogEmpId}
        initialEmployeeName={dialogEmpName}
        clients={clients}
        users={users}
        onSave={handleSave}
        onDelete={onDeleteEntry}
      />
    </div>
  );
}
