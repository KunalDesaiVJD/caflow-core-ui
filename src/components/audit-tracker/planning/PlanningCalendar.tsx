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
import { useState, useMemo, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ChevronLeft, ChevronRight, Plus, Calendar, AlignJustify, UserPlus, X as XIcon, Search, Filter, Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PlanEntry } from "../hooks/useAuditPlanning";
import type { ClientOption } from "../hooks/useClients";
import type { UserOption }   from "../hooks/useUsers";
import type { PlanningStaffMember } from "../hooks/usePlanningStaff";
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

/** Issue 3: detect leave preferring explicit is_leave flag, with legacy
 *  string fallback so any pre-migration row still renders correctly. */
function entryIsLeave(e: { is_leave?: boolean | null; client_name?: string | null }): boolean {
  if (e.is_leave) return true;
  return (e.client_name || "").trim().toLowerCase() === "leave";
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
  isSunday:  boolean;
  onClick:   (dateISO: string, emp: UserOption, entry: PlanEntry | null) => void;
}

/** CP-08: All entries stacked vertically. Click chip → edit; click empty area → create new. */
function CalCell({ dateISO, employee, entries, isSunday, onClick }: CellProps) {
  const hits = cellEntries(entries, dateISO, employee.id);

  if (hits.length === 0) {
    return (
      <td
        onClick={() => onClick(dateISO, employee, null)}
        className={cn(
          "border border-border/60 min-w-[60px] h-8 cursor-pointer transition-colors",
          isSunday ? "bg-red-50/70 hover:bg-red-100/60" : "hover:bg-indigo-50/40"
        )}
      />
    );
  }

  return (
    <td
      onClick={() => onClick(dateISO, employee, null)}
      className={cn(
        "border border-border/60 min-w-[60px] p-[2px] cursor-pointer align-top transition-colors overflow-hidden",
        isSunday ? "bg-red-50/70 hover:bg-red-100/60" : "hover:bg-muted/10"
      )}
    >
      <div className="space-y-[2px] w-full max-w-full overflow-hidden">
        {hits.map(entry => {
          const isLeave  = entryIsLeave(entry);
          const color    = isLeave ? LEAVE_COLOR : clientColor(entry.client_name || "");
          const dateHint = entry.planned_from === entry.planned_to
            ? entry.planned_from
            : `${entry.planned_from} → ${entry.planned_to}`;
          return (
            <div
              key={entry.id}
              className={cn(
                "px-1.5 rounded border text-[10px] font-medium overflow-hidden h-5 leading-5 w-full max-w-full",
                color
              )}
              onClick={e => { e.stopPropagation(); onClick(dateISO, employee, entry); }}
              title={`${entry.client_name || "—"}  ·  ${dateHint}  —  click to edit`}
            >
              <span className="block truncate w-full">{isLeave ? "Leave" : entry.client_name}</span>
            </div>
          );
        })}
      </div>
    </td>
  );
}

// ─── Week-view cell (taller, shows date range info) ──────────────────────────

/** CP-08: All entries stacked in week view too — each card: client name + date range label. */
function WeekCell({ dateISO, employee, entries, isSunday, onClick }: CellProps) {
  const hits = cellEntries(entries, dateISO, employee.id);

  if (hits.length === 0) {
    return (
      <td
        onClick={() => onClick(dateISO, employee, null)}
        className={cn(
          "border border-border/60 min-w-[60px] h-16 cursor-pointer transition-colors align-top p-1",
          isSunday ? "bg-red-50/70 hover:bg-red-100/60" : "hover:bg-indigo-50/40"
        )}
      />
    );
  }

  return (
    <td
      onClick={() => onClick(dateISO, employee, null)}
      className={cn(
        "border border-border/60 min-w-[60px] min-h-[64px] cursor-pointer p-1 align-top transition-colors overflow-hidden",
        isSunday ? "bg-red-50/70 hover:bg-red-100/60" : "hover:bg-muted/10"
      )}
    >
      <div className="space-y-[3px] w-full max-w-full overflow-hidden">
        {hits.map(entry => {
          const isLeave = entryIsLeave(entry);
          const color   = isLeave ? LEAVE_COLOR : clientColor(entry.client_name || "");
          return (
            <div
              key={entry.id}
              className={cn("px-1.5 py-0.5 rounded border text-[10px] font-medium space-y-0.5 w-full max-w-full overflow-hidden", color)}
              onClick={e => { e.stopPropagation(); onClick(dateISO, employee, entry); }}
              title={`${entry.client_name || ""} — click to edit`}
            >
              <p className="truncate font-semibold w-full">{isLeave ? "Leave" : entry.client_name}</p>
              <p className="text-[9px] opacity-70">
                {entry.planned_from === entry.planned_to
                  ? entry.planned_from
                  : `${entry.planned_from} → ${entry.planned_to}`}
              </p>
            </div>
          );
        })}
      </div>
    </td>
  );
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  entries:          PlanEntry[];
  loading:          boolean;
  clients:          ClientOption[];
  users:            UserOption[];          // all firm users (for add-employee picker)
  planningStaff:    PlanningStaffMember[]; // only these show as calendar columns
  isSuperadmin?:    boolean;
  onAddEntry:       (data: PlanSaveData) => Promise<void>;
  onUpdateEntry:    (id: string, data: Partial<PlanEntry>) => Promise<void>;
  onDeleteEntry:    (id: string) => Promise<void>;
  onAddStaff:       (userId: string, userName: string) => Promise<void>;
  onRemoveStaff:    (staffId: string) => Promise<void>;
  onReorderStaff:   (newOrder: PlanningStaffMember[]) => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function PlanningCalendar({
  entries, loading, clients, users, planningStaff,
  isSuperadmin,
  onAddEntry, onUpdateEntry, onDeleteEntry,
  onAddStaff, onRemoveStaff, onReorderStaff,
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

  // ── Add employee picker state ───────────────────────────────────────────────
  const [addingEmployee,  setAddingEmployee]  = useState(false);
  const [addEmpValue,     setAddEmpValue]     = useState("");
  const [addEmpSearch,    setAddEmpSearch]    = useState("");
  const [addEmpOpen,      setAddEmpOpen]      = useState(false);
  const addEmpInputRef = useRef<HTMLInputElement>(null);

  // ── Global client filter ────────────────────────────────────────────────────
  const [globalClientFilter, setGlobalClientFilter] = useState<string>("__all__");
  const [clientFilterOpen,   setClientFilterOpen]   = useState(false);

  // All unique non-leave client names across all entries
  const allClientNames = useMemo(() => {
    const names = new Set<string>();
    for (const e of entries) {
      if (e.client_name && !entryIsLeave(e)) names.add(e.client_name);
    }
    return Array.from(names).sort();
  }, [entries]);

  // Users not yet in planningStaff
  const availableToAdd = useMemo(() =>
    users.filter(u => !planningStaff.some(s => s.user_id === u.id)),
    [users, planningStaff]
  );

  // Filtered by search
  const filteredAvailable = useMemo(() =>
    addEmpSearch
      ? availableToAdd.filter(u => u.name.toLowerCase().includes(addEmpSearch.toLowerCase()))
      : availableToAdd,
    [availableToAdd, addEmpSearch]
  );

  // ── Column drag-to-reorder ────────────────────────────────────────────────────
  const dragFromIdx = useRef<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  function handleColDragStart(idx: number) {
    dragFromIdx.current = idx;
  }
  function handleColDragOver(e: React.DragEvent, idx: number) {
    e.preventDefault();
    setDragOverIdx(idx);
  }
  function handleColDrop(e: React.DragEvent, toIdx: number) {
    e.preventDefault();
    const fromIdx = dragFromIdx.current;
    if (fromIdx === null || fromIdx === toIdx) { setDragOverIdx(null); return; }
    const next = [...planningStaff];
    const [moved] = next.splice(fromIdx, 1);
    next.splice(toIdx, 0, moved);
    onReorderStaff(next);
    dragFromIdx.current = null;
    setDragOverIdx(null);
  }
  function handleColDragEnd() {
    dragFromIdx.current = null;
    setDragOverIdx(null);
  }

  // ── Per-column filters ────────────────────────────────────────────────────────
  const [columnFilters,    setColumnFilters]    = useState<Record<string, string>>({});
  const [openColDropdown,  setOpenColDropdown]  = useState<string | null>(null);

  // Unique client names assigned to each employee (across all entries)
  const empClientOptions = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const entry of entries) {
      if (!entry.client_name || entryIsLeave(entry)) continue;
      for (const empId of (entry.employee_ids || [])) {
        if (!map[empId]) map[empId] = [];
        if (!map[empId].includes(entry.client_name)) map[empId].push(entry.client_name);
      }
    }
    // Sort each list alphabetically
    Object.keys(map).forEach(k => map[k].sort());
    return map;
  }, [entries]);

  function setColFilter(empId: string, val: string) {
    setColumnFilters(p => ({ ...p, [empId]: val }));
  }
  function clearColFilters() {
    setColumnFilters({});
  }
  const hasColFilters = Object.values(columnFilters).some(Boolean);

  async function handleAddEmployee(userId: string, userName: string) {
    await onAddStaff(userId, userName);
    setAddEmpSearch("");
    setAddEmpOpen(false);
    setAddingEmployee(false);
  }

  // ── Dates to render ────────────────────────────────────────────────────────
  const allDates = useMemo<Date[]>(() => {
    if (view === "month") return monthDates(year, month);
    return weekDates(weekStart);
  }, [view, year, month, weekStart]);

  // Apply global client filter + per-column filters to dates
  const dates = useMemo<Date[]>(() => {
    let filtered = allDates;

    // Global client filter
    if (globalClientFilter !== "__all__") {
      filtered = filtered.filter(date => {
        const iso = toISO(date);
        return entries.some(e =>
          e.client_name === globalClientFilter &&
          e.planned_from <= iso &&
          e.planned_to   >= iso
        );
      });
    }

    // Per-column filters
    const activeColFilters = Object.entries(columnFilters).filter(([, v]) => v.trim());
    if (activeColFilters.length === 0) return filtered;
    return filtered.filter(date => {
      const iso = toISO(date);
      return activeColFilters.every(([empId, filterVal]) => {
        const hits = cellEntries(entries, iso, empId);
        return hits.some(e =>
          (e.client_name || "").toLowerCase().includes(filterVal.toLowerCase())
        );
      });
    });
  }, [allDates, globalClientFilter, columnFilters, entries]);

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

        {/* Right: global client filter + view toggle + add new + add employee */}
        <div className="flex items-center gap-1.5 flex-wrap">

          {/* Global client filter — searchable combobox */}
          <div className="flex items-center gap-1">
            <Filter size={12} className="text-muted-foreground shrink-0" />
            <Popover open={clientFilterOpen} onOpenChange={setClientFilterOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  role="combobox"
                  className={cn(
                    "h-8 text-xs w-[160px] justify-between font-normal",
                    globalClientFilter !== "__all__" && "border-amber-400 text-amber-800"
                  )}
                >
                  <span className="truncate">
                    {globalClientFilter === "__all__" ? "All clients" : globalClientFilter}
                  </span>
                  <ChevronsUpDown size={11} className="ml-1 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="p-0 w-[220px]" align="start">
                <Command>
                  <CommandInput placeholder="Search client…" className="h-8 text-xs" />
                  <CommandList className="max-h-52">
                    <CommandEmpty className="py-2 text-xs text-center text-muted-foreground">
                      No client found
                    </CommandEmpty>
                    <CommandGroup>
                      <CommandItem
                        value="__all__"
                        onSelect={() => { setGlobalClientFilter("__all__"); setClientFilterOpen(false); }}
                        className="text-xs text-muted-foreground"
                      >
                        <Check size={11} className={cn("mr-2", globalClientFilter === "__all__" ? "opacity-100" : "opacity-0")} />
                        — All clients —
                      </CommandItem>
                      {allClientNames.map(name => (
                        <CommandItem
                          key={name}
                          value={name}
                          onSelect={() => { setGlobalClientFilter(name); setClientFilterOpen(false); }}
                          className="text-xs"
                        >
                          <Check size={11} className={cn("mr-2", globalClientFilter === name ? "opacity-100" : "opacity-0")} />
                          {name}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
            {globalClientFilter !== "__all__" && (
              <button
                onClick={() => setGlobalClientFilter("__all__")}
                className="text-amber-600 hover:text-amber-800"
                title="Clear client filter"
              >
                <XIcon size={13} />
              </button>
            )}
          </div>

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

          {/* Add employee to calendar — searchable combobox */}
          {addingEmployee ? (
            <div className="relative flex items-center gap-1">
              <div className="relative">
                <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                <Input
                  ref={addEmpInputRef}
                  autoFocus
                  value={addEmpSearch}
                  onChange={e => { setAddEmpSearch(e.target.value); setAddEmpOpen(true); }}
                  onFocus={() => setAddEmpOpen(true)}
                  onBlur={() => setTimeout(() => setAddEmpOpen(false), 150)}
                  placeholder="Search employee…"
                  className="h-8 text-xs pl-6 w-[170px]"
                />
                {addEmpOpen && (
                  <div className="absolute top-full left-0 z-50 mt-1 w-full min-w-[170px] bg-popover border rounded-md shadow-lg max-h-48 overflow-auto">
                    {filteredAvailable.length === 0 ? (
                      <div className="px-3 py-2 text-xs text-muted-foreground italic">
                        {availableToAdd.length === 0 ? "All employees added" : "No match"}
                      </div>
                    ) : (
                      filteredAvailable.map(u => (
                        <div
                          key={u.id}
                          onMouseDown={e => { e.preventDefault(); handleAddEmployee(u.id, u.name); }}
                          className="px-3 py-1.5 text-xs cursor-pointer hover:bg-accent"
                        >
                          {u.name}
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
              <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={() => { setAddingEmployee(false); setAddEmpSearch(""); }}>
                <XIcon size={13} />
              </Button>
            </div>
          ) : (
            <Button size="sm" variant="outline" className="h-8 text-xs gap-1"
              onClick={() => setAddingEmployee(true)}>
              <UserPlus size={12} /> Add Employee
            </Button>
          )}

          {/* Clear column filters */}
          {hasColFilters && (
            <Button size="sm" variant="outline" className="h-8 text-xs gap-1 text-amber-600 border-amber-300 hover:bg-amber-50"
              onClick={clearColFilters}>
              <XIcon size={12} /> Clear Filters
            </Button>
          )}
        </div>
      </div>

      {/* ── Calendar grid ── Issues 6 & 7 (Aesha):
          • Bounded max-height tied to the viewport so the calendar always
            fits the screen — replaces the previous unbounded "none" which
            forced page-level scroll and broke the sticky thead.
          • overflow-auto on this container means the sticky `thead`
            (top: 0) freezes correctly while the body scrolls underneath,
            keeping the employee/staff names visible at all times.
          • table-layout: auto with width: 100% means the table re-flows
            to the container width whenever a row or column is added /
            removed; column widths shrink uniformly so the calendar
            never overflows horizontally. */}
      <div className="border rounded-lg overflow-hidden">
        <div
          className="overflow-auto"
          style={{ maxHeight: "calc(100vh - 280px)" }}
        >
          {/* Issue 1 (today) — table-fixed forces columns to share the
              container width EQUALLY, so all employees fit on one screen
              without horizontal scroll.  table-auto previously let the
              widest chip (e.g. "CLEAR QUANT TECHNOLOGIES PRIVATE LIMITED")
              push its column wider, causing overflow.  With fixed layout
              and explicit 90 px on the Date column, the remaining width
              auto-distributes among employee columns; adding or removing
              an employee re-divides the space without an explicit reflow. */}
          <table className="border-collapse text-xs w-full table-fixed">
            {/* Sticky header */}
            <thead className="sticky top-0 z-20">
              <tr className="bg-indigo-700 text-white text-[11px] uppercase tracking-wide">
                {/* Date column */}
                {/* Issue 6 (Aesha) — date column also sticks left so the
                    date label stays visible on horizontal scroll, just as
                    the employee header row stays visible on vertical
                    scroll.  Width kept fixed (90 px) for legibility — it
                    holds short labels like "Mon 5" so 90 px is sufficient. */}
                <th className="sticky left-0 top-0 z-30 bg-indigo-700 border border-indigo-600 px-2 py-2.5 text-left w-[90px] min-w-[90px]">
                  Date
                </th>
                {/* Employee columns — only planning staff; draggable to reorder.
                    Issue 7 (Aesha): drop the FIXED w-[90px] / min-w-[90px]
                    which was forcing the table to overflow whenever a few
                    employees were added.  Use min-w-[60px] only — the
                    table's auto layout (width: 100%) divides the remaining
                    space evenly so columns auto-shrink/grow as rows or
                    employees are added/removed. */}
                {planningStaff.map((s, colIdx) => (
                  <th key={s.user_id}
                    draggable
                    onDragStart={() => handleColDragStart(colIdx)}
                    onDragOver={e => handleColDragOver(e, colIdx)}
                    onDrop={e => handleColDrop(e, colIdx)}
                    onDragEnd={handleColDragEnd}
                    className={cn(
                      "border border-indigo-600 px-1 py-1 text-center min-w-[60px] cursor-grab active:cursor-grabbing transition-colors",
                      dragOverIdx === colIdx && dragFromIdx.current !== colIdx && "bg-indigo-500"
                    )}
                    title={`${s.name} — drag to reorder`}>
                    <div className="flex items-center justify-center gap-1 mb-1">
                      <span className="truncate text-[11px]">{s.name.split(" ")[0].toUpperCase()}</span>
                      {isSuperadmin && (
                        <button
                          onClick={() => onRemoveStaff(s.id)}
                          title={`Remove ${s.name} from planning`}
                          className="shrink-0 text-indigo-300 hover:text-red-300 transition-colors"
                        >
                          <XIcon size={10} />
                        </button>
                      )}
                    </div>
                    {/* Per-column client filter with dropdown */}
                    <div className="relative" onClick={e => e.stopPropagation()}>
                      <Filter size={8} className="absolute left-1 top-1/2 -translate-y-1/2 text-indigo-300 pointer-events-none z-10" />
                      {columnFilters[s.user_id] && (
                        <button
                          type="button"
                          onClick={() => { setColFilter(s.user_id, ""); setOpenColDropdown(null); }}
                          className="absolute right-0.5 top-1/2 -translate-y-1/2 text-yellow-300 hover:text-white z-10"
                        >
                          <XIcon size={7} />
                        </button>
                      )}
                      <input
                        type="text"
                        value={columnFilters[s.user_id] || ""}
                        onChange={e => { setColFilter(s.user_id, e.target.value); setOpenColDropdown(s.user_id); }}
                        onFocus={() => setOpenColDropdown(s.user_id)}
                        onBlur={() => setTimeout(() => setOpenColDropdown(null), 150)}
                        placeholder="filter…"
                        className={cn(
                          "w-full h-5 pl-3.5 pr-3 text-[9px] rounded bg-indigo-800 border border-indigo-500 text-white placeholder-indigo-400 focus:outline-none focus:border-yellow-300",
                          columnFilters[s.user_id] && "border-yellow-300 bg-indigo-900"
                        )}
                      />
                      {/* Client options dropdown */}
                      {openColDropdown === s.user_id && (empClientOptions[s.user_id] ?? []).length > 0 && (
                        <div className="absolute top-full left-0 z-50 mt-0.5 w-max min-w-full max-w-[200px] bg-white border border-border rounded shadow-lg max-h-40 overflow-auto">
                          {(empClientOptions[s.user_id] ?? [])
                            .filter(c => !columnFilters[s.user_id] || c.toLowerCase().includes((columnFilters[s.user_id] || "").toLowerCase()))
                            .map(clientName => (
                              <div
                                key={clientName}
                                onMouseDown={e => { e.preventDefault(); setColFilter(s.user_id, clientName); setOpenColDropdown(null); }}
                                className={cn(
                                  "px-2 py-1 text-[10px] cursor-pointer hover:bg-indigo-50 text-foreground truncate",
                                  columnFilters[s.user_id] === clientName && "bg-indigo-50 font-semibold"
                                )}
                              >
                                {clientName}
                              </div>
                            ))
                          }
                        </div>
                      )}
                    </div>
                  </th>
                ))}
                {/* Hint when no staff added yet */}
                {planningStaff.length === 0 && (
                  <th className="border border-indigo-600 px-2 py-2.5 text-center w-48 text-indigo-300 text-[10px] italic">
                    Click "Add Employee" to add staff columns
                  </th>
                )}
              </tr>
            </thead>

            <tbody>
              {loading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i}>
                    <td colSpan={Math.max(planningStaff.length, 1) + 1}
                      className="border border-border/60 h-8 px-3 bg-muted/20 animate-pulse" />
                  </tr>
                ))
              ) : planningStaff.length === 0 ? (
                <tr>
                  <td colSpan={2} className="py-12 text-center text-muted-foreground text-sm">
                    No employees added yet — click <strong>Add Employee</strong> above to add planning staff columns
                  </td>
                </tr>
              ) : (
                dates.map(date => {
                  const iso      = toISO(date);
                  const isToday  = iso === todayISO;
                  const isSunday = date.getDay() === 0;
                  const dayLabel = `${DAY_ABR[date.getDay()]} ${date.getDate()}`;

                  return (
                    <tr key={iso} className={cn(
                      isToday  && "bg-indigo-50/40",
                      isSunday && "bg-red-50/50",
                    )}>
                      {/* Sticky date cell */}
                      <td className={cn(
                        "sticky left-0 z-10 border border-border/60 px-2 align-middle select-none",
                        view === "month" ? "h-8" : "h-16",
                        isSunday  ? "bg-red-100 text-red-700 font-semibold"
                        : isToday ? "bg-indigo-50 font-bold text-indigo-700"
                                  : "bg-card text-muted-foreground"
                      )}>
                        <div className="flex items-center gap-1.5">
                          {isToday && !isSunday && (
                            <span className="h-1.5 w-1.5 rounded-full bg-indigo-500 shrink-0" />
                          )}
                          {isSunday && (
                            <span className="h-1.5 w-1.5 rounded-full bg-red-400 shrink-0" />
                          )}
                          <span className="text-[11px] whitespace-nowrap">{dayLabel}</span>
                        </div>
                      </td>

                      {/* Only planning-staff columns */}
                      {planningStaff.map(staff => {
                        const emp: UserOption = { id: staff.user_id, name: staff.name };
                        return (
                          <CellComponent
                            key={staff.user_id}
                            dateISO={iso}
                            employee={emp}
                            entries={entries}
                            isSunday={isSunday}
                            onClick={handleCellClick}
                          />
                        );
                      })}
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
        entries={entries}
        onSave={handleSave}
        onDelete={onDeleteEntry}
      />
    </div>
  );
}
