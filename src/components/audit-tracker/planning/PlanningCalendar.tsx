/**
 * PlanningCalendar
 * Gantt-style monthly timeline.
 * Rows = planning entries (left: client + dates + employees)
 * Right: scrollable day grid with colored bars spanning planned dates.
 * Click a row to select it (highlights it and filters the communication table).
 */
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge }  from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ChevronLeft, ChevronRight, Plus, Trash2, Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { PlanEntry } from "../hooks/useAuditPlanning";
import type { ClientOption } from "../hooks/useClients";
import type { UserOption }   from "../hooks/useUsers";
import PlanningEntryDialog   from "./PlanningEntryDialog";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const MONTHS = ["January","February","March","April","May","June",
                "July","August","September","October","November","December"];

const BAR_COLORS = [
  "bg-indigo-400","bg-emerald-400","bg-amber-400","bg-rose-400",
  "bg-cyan-400","bg-violet-400","bg-orange-400","bg-teal-400",
];

function colorForIndex(i: number) { return BAR_COLORS[i % BAR_COLORS.length]; }

function daysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}

function clampBarToMonth(
  from: string, to: string, year: number, month: number
): { left: number; width: number } | null {
  const start      = new Date(from);
  const end        = new Date(to);
  const monthStart = new Date(year, month, 1);
  const monthEnd   = new Date(year, month + 1, 0);

  if (start > monthEnd || end < monthStart) return null;

  const clampedStart = start < monthStart ? monthStart : start;
  const clampedEnd   = end   > monthEnd   ? monthEnd   : end;

  const total  = daysInMonth(year, month);
  const left   = ((clampedStart.getDate() - 1) / total) * 100;
  const width  = ((clampedEnd.getDate() - clampedStart.getDate() + 1) / total) * 100;
  return { left, width };
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface Props {
  entries:         PlanEntry[];
  loading:         boolean;
  selectedId:      string | null;
  onSelectEntry:   (id: string | null) => void;
  clients:         ClientOption[];
  users:           UserOption[];
  onAddEntry:      (data: {
    client_id: string | null; client_name: string | null;
    planned_from: string; planned_to: string;
    employee_ids: string[]; employee_names: string[];
  }) => Promise<void>;
  onDeleteEntry:   (id: string) => Promise<void>;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function PlanningCalendar({
  entries, loading, selectedId, onSelectEntry,
  clients, users, onAddEntry, onDeleteEntry,
}: Props) {
  const now  = new Date();
  const [year,      setYear]      = useState(now.getFullYear());
  const [month,     setMonth]     = useState(now.getMonth());
  const [dialogOpen, setDialogOpen] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const total    = daysInMonth(year, month);
  const dayNums  = Array.from({ length: total }, (_, i) => i + 1);

  const visible = entries.filter(e => {
    const bar = clampBarToMonth(e.planned_from, e.planned_to, year, month);
    return bar !== null;
  });

  function prevMonth() {
    if (month === 0) { setMonth(11); setYear(y => y - 1); }
    else setMonth(m => m - 1);
  }
  function nextMonth() {
    if (month === 11) { setMonth(0);  setYear(y => y + 1); }
    else setMonth(m => m + 1);
  }

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" className="h-8 w-8 p-0" onClick={prevMonth}>
            <ChevronLeft size={14} />
          </Button>
          <span className="text-sm font-semibold min-w-[160px] text-center">
            {MONTHS[month]} {year}
          </span>
          <Button size="sm" variant="outline" className="h-8 w-8 p-0" onClick={nextMonth}>
            <ChevronRight size={14} />
          </Button>
        </div>
        <Button size="sm" className="gap-1.5 h-8 text-xs bg-indigo-600 hover:bg-indigo-700"
          onClick={() => setDialogOpen(true)}>
          <Plus size={13} /> Add Plan
        </Button>
      </div>

      {/* Gantt table */}
      <div className="border rounded-lg overflow-hidden">
        <div className="overflow-auto">
          <table className="w-full text-xs border-collapse" style={{ minWidth: 900 }}>
            <colgroup>
              <col style={{ minWidth: 160 }} />
              <col style={{ minWidth: 180 }} />
              <col style={{ width: "100%" }} />
              <col style={{ minWidth: 60 }} />
            </colgroup>
            <thead>
              <tr className="bg-indigo-700 text-white text-[11px] uppercase tracking-wide select-none">
                <th className="border border-indigo-600 px-3 py-2.5 text-left">Client</th>
                <th className="border border-indigo-600 px-3 py-2.5 text-left">Employees</th>
                <th className="border border-indigo-600 px-2 py-2.5">
                  <div className="flex">
                    {dayNums.map(d => (
                      <div key={d} className={cn(
                        "flex-1 text-center text-[9px] font-normal",
                        d === new Date().getDate() &&
                          month === new Date().getMonth() &&
                          year === new Date().getFullYear() &&
                          "text-yellow-300 font-bold"
                      )}>
                        {d}
                      </div>
                    ))}
                  </div>
                </th>
                <th className="border border-indigo-600 px-2 py-2.5 text-center">Del</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <tr key={i}>
                    <td colSpan={4} className="px-3 py-2 border border-border">
                      <Skeleton className="h-5 w-full" />
                    </td>
                  </tr>
                ))
              ) : visible.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-10 text-center text-muted-foreground">
                    No audits planned in {MONTHS[month]} {year}
                  </td>
                </tr>
              ) : (
                visible.map((entry, idx) => {
                  const bar      = clampBarToMonth(entry.planned_from, entry.planned_to, year, month)!;
                  const color    = colorForIndex(idx);
                  const isSelected = selectedId === entry.id;

                  return (
                    <tr
                      key={entry.id}
                      onClick={() => onSelectEntry(isSelected ? null : entry.id)}
                      className={cn(
                        "cursor-pointer transition-colors hover:bg-indigo-50/50",
                        isSelected && "bg-indigo-50"
                      )}
                    >
                      {/* Client name + dates */}
                      <td className="border border-border px-3 py-2 align-middle">
                        <p className="font-medium truncate max-w-[150px]">{entry.client_name || "—"}</p>
                        <p className="text-[10px] text-muted-foreground mt-0.5">
                          {entry.planned_from} → {entry.planned_to}
                        </p>
                      </td>

                      {/* Employees chips */}
                      <td className="border border-border px-2 py-2 align-middle">
                        {entry.employee_names?.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {entry.employee_names.slice(0, 3).map((n, i) => (
                              <Badge key={i} variant="secondary"
                                className="text-[10px] px-1.5 py-0">
                                {n}
                              </Badge>
                            ))}
                            {entry.employee_names.length > 3 && (
                              <Badge variant="secondary" className="text-[10px] px-1.5 py-0 gap-0.5">
                                <Users size={9} />+{entry.employee_names.length - 3}
                              </Badge>
                            )}
                          </div>
                        ) : (
                          <span className="text-muted-foreground/50">—</span>
                        )}
                      </td>

                      {/* Gantt bar */}
                      <td className="border border-border px-0 py-2 align-middle relative">
                        <div className="relative h-5 mx-1">
                          <div
                            className={cn(
                              "absolute top-0 h-full rounded opacity-80",
                              color,
                              isSelected && "opacity-100 ring-2 ring-offset-1 ring-indigo-500"
                            )}
                            style={{
                              left:  `${bar.left}%`,
                              width: `${Math.max(bar.width, 1)}%`,
                            }}
                          />
                        </div>
                      </td>

                      {/* Delete */}
                      <td className="border border-border px-2 py-2 text-center align-middle"
                        onClick={e => e.stopPropagation()}>
                        {confirmId === entry.id ? (
                          <div className="flex flex-col gap-0.5">
                            <Button size="sm" variant="destructive" className="h-5 text-[9px] px-1"
                              onClick={() => { onDeleteEntry(entry.id); setConfirmId(null); }}>
                              Yes
                            </Button>
                            <Button size="sm" variant="ghost" className="h-5 text-[9px] px-1"
                              onClick={() => setConfirmId(null)}>
                              No
                            </Button>
                          </div>
                        ) : (
                          <Button size="sm" variant="ghost"
                            className="h-7 w-7 p-0 text-muted-foreground hover:text-red-600 hover:bg-red-50"
                            onClick={() => setConfirmId(entry.id)}>
                            <Trash2 size={12} />
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add Plan dialog */}
      <PlanningEntryDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        clients={clients}
        users={users}
        onSave={async data => { await onAddEntry(data); }}
      />
    </div>
  );
}
