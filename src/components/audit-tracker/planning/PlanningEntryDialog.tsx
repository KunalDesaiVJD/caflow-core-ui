/**
 * PlanningEntryDialog
 * Create OR Edit a planning entry.
 *
 * Create mode (entry = null/undefined):
 *   - Pre-fills date/employee from cell click if provided
 * Edit mode (entry provided):
 *   - Pre-fills from existing entry, shows Delete button
 *
 * Conflict rules:
 *   • Selecting "Leave" for an employee who already has an audit on those dates
 *     → blocked with "The Employee is in Audit"
 *   • Selecting a client for an employee who already has Leave on those dates
 *     → blocked with "The Employee is in Leave"
 */
import { useState, useMemo, useEffect } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button }   from "@/components/ui/button";
import { Input }    from "@/components/ui/input";
import { Label }    from "@/components/ui/label";
import { Badge }    from "@/components/ui/badge";
import {
  Command, CommandEmpty, CommandGroup,
  CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Save, Loader2, ChevronsUpDown, Check, X, Trash2, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PlanEntry } from "../hooks/useAuditPlanning";
import type { ClientOption } from "../hooks/useClients";
import type { UserOption }   from "../hooks/useUsers";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function safeISO(raw: string): string {
  if (!raw) return raw;
  return raw.slice(0, 10);
}

function entryIsLeave(e: { is_leave?: boolean | null; client_name?: string | null }): boolean {
  if (e.is_leave) return true;
  return (e.client_name || "").trim().toLowerCase() === "leave";
}

function datesOverlap(aFrom: string, aTo: string, bFrom: string, bTo: string): boolean {
  return aFrom <= bTo && aTo >= bFrom;
}

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PlanSaveData {
  client_id:      string | null;
  client_name:    string | null;
  planned_from:   string;
  planned_to:     string;
  employee_ids:   string[];
  employee_names: string[];
  is_leave:       boolean;
}

interface Props {
  open:               boolean;
  onOpenChange:       (v: boolean) => void;
  entry?:             PlanEntry | null;
  initialDate?:       string;
  initialEmployeeId?:   string;
  initialEmployeeName?: string;
  clients:            ClientOption[];
  users:              UserOption[];
  entries:            PlanEntry[];
  onSave:             (data: PlanSaveData, entryId?: string) => Promise<void>;
  onDelete?:          (id: string) => Promise<void>;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function PlanningEntryDialog({
  open, onOpenChange,
  entry, initialDate, initialEmployeeId, initialEmployeeName,
  clients, users, entries,
  onSave, onDelete,
}: Props) {
  const isEdit = !!entry;

  const [clientOpen,  setClientOpen]  = useState(false);
  const [clientId,    setClientId]    = useState("");
  const [clientName,  setClientName]  = useState("");
  const [from,        setFrom]        = useState("");
  const [to,          setTo]          = useState("");
  const [empIds,      setEmpIds]      = useState<string[]>([]);
  const [empNames,    setEmpNames]    = useState<string[]>([]);
  const [empOpen,     setEmpOpen]     = useState(false);
  const [saving,      setSaving]      = useState(false);
  const [deleting,    setDeleting]    = useState(false);
  const [confirmDel,  setConfirmDel]  = useState(false);
  const [conflictMsg, setConflictMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    if (isEdit && entry) {
      setClientId(entry.client_id    || "");
      setClientName(entry.client_name || "");
      setFrom(entry.planned_from);
      setTo(entry.planned_to);
      setEmpIds([...entry.employee_ids]);
      setEmpNames([...entry.employee_names]);
    } else {
      setClientId("");
      setClientName("");
      setFrom(initialDate || "");
      setTo(initialDate   || "");
      setEmpIds(  initialEmployeeId   ? [initialEmployeeId]   : []);
      setEmpNames(initialEmployeeName ? [initialEmployeeName] : []);
    }
    setConfirmDel(false);
    setConflictMsg(null);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { setConflictMsg(null); }, [clientName, from, to, empIds.length]);

  const unselected = useMemo(
    () => users.filter(u => !empIds.includes(u.id)),
    [users, empIds]
  );

  function addEmployee(u: UserOption) {
    setEmpIds(ids  => [...ids,   u.id]);
    setEmpNames(ns => [...ns,    u.name]);
    setEmpOpen(false);
  }

  function removeEmployee(idx: number) {
    setEmpIds(ids  => ids.filter((_,i) => i !== idx));
    setEmpNames(ns => ns.filter((_,i) => i !== idx));
  }

  function checkConflicts(isLeave: boolean, fromStr: string, toStr: string): string | null {
    for (let i = 0; i < empIds.length; i++) {
      const empId   = empIds[i];
      const empName = empNames[i] || "This employee";

      const overlapping = entries.filter(e =>
        e.id !== entry?.id &&
        (e.employee_ids || []).includes(empId) &&
        datesOverlap(fromStr, toStr, e.planned_from, e.planned_to)
      );

      if (isLeave) {
        const hasAudit = overlapping.some(e => !entryIsLeave(e));
        if (hasAudit)
          return `${empName} is already assigned to an audit on these dates. The Employee is in Audit.`;
      } else {
        const hasLeave = overlapping.some(e => entryIsLeave(e));
        if (hasLeave)
          return `${empName} is on leave on these dates. The Employee is in Leave.`;
      }
    }
    return null;
  }

  async function handleSave(keepOpen: boolean = false) {
    if (!from || !to) return;

    const isLeave = (clientName || "").trim().toLowerCase() === "leave";
    const fromStr = safeISO(from);
    const toStr   = safeISO(to);

    // Issue 3: In edit mode, block changing from Leave → Client or Client → Leave.
    // The user must delete and re-create to change type.
    if (isEdit && entry) {
      const wasLeave = entryIsLeave(entry);
      if (wasLeave && !isLeave) {
        setConflictMsg(
          "This entry was created as Leave. To assign a client instead, please delete this entry and create a new one."
        );
        return;
      }
      if (!wasLeave && isLeave) {
        setConflictMsg(
          "This entry was created as a client assignment. To mark as Leave instead, please delete this entry and create a new one."
        );
        return;
      }
    }

    if (empIds.length > 0 && clientName) {
      const conflict = checkConflicts(isLeave, fromStr, toStr);
      if (conflict) { setConflictMsg(conflict); return; }
    }

    setSaving(true);
    await onSave(
      { client_id: clientId || null, client_name: clientName || null, planned_from: fromStr, planned_to: toStr, employee_ids: empIds, employee_names: empNames, is_leave: isLeave },
      isEdit ? entry!.id : undefined
    );
    setSaving(false);
    if (keepOpen) {
      setClientId("");
      setClientName("");
      setEmpIds([]);
      setEmpNames([]);
    } else {
      onOpenChange(false);
    }
  }

  async function handleDelete() {
    if (!entry || !onDelete) return;
    setDeleting(true);
    await onDelete(entry.id);
    setDeleting(false);
    onOpenChange(false);
  }

  const valid = !!from && !!to && empIds.length > 0;

  return (
    <Dialog open={open} onOpenChange={v => { if (!saving && !deleting) onOpenChange(v); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Assignment" : "New Audit Assignment"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">

          {/* Conflict error banner */}
          {conflictMsg && (
            <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              <AlertTriangle size={13} className="shrink-0 mt-0.5" />
              <span>{conflictMsg}</span>
            </div>
          )}

          {/* Client — searchable combobox */}
          <div>
            <Label className="text-xs mb-1.5 block">
              Client Name <span className="text-red-500">*</span>
            </Label>
            <Popover open={clientOpen} onOpenChange={setClientOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" role="combobox"
                  className="w-full justify-between h-9 text-xs font-normal">
                  <span className="truncate">{clientName || "Type to search client…"}</span>
                  <ChevronsUpDown size={13} className="ml-2 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="p-0 w-full" align="start" style={{ width: "var(--radix-popover-trigger-width)" }}>
                <Command>
                  <CommandInput placeholder="Search client…" className="h-8 text-xs" />
                  <CommandList className="max-h-48">
                    <CommandEmpty className="py-3 text-xs text-center text-muted-foreground">
                      No client found
                    </CommandEmpty>
                    <CommandGroup>
                      <CommandItem value="Leave" onSelect={() => { setClientId(""); setClientName("Leave"); setClientOpen(false); }} className="text-xs">
                        <Check size={12} className={cn("mr-2", clientName === "Leave" ? "opacity-100" : "opacity-0")} />
                        <span className="text-gray-500 font-medium">Leave</span>
                      </CommandItem>
                      {clients.map(c => (
                        <CommandItem key={c.id} value={c.name}
                          onSelect={() => { setClientId(c.id); setClientName(c.name); setClientOpen(false); }}
                          className="text-xs">
                          <Check size={12} className={cn("mr-2", clientId === c.id ? "opacity-100" : "opacity-0")} />
                          {c.name}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>

          {/* Duration */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs mb-1.5 block">From <span className="text-red-500">*</span></Label>
              <Input type="date" className="h-9 text-xs" value={from}
                onChange={e => { setFrom(e.target.value); if (!to || to < e.target.value) setTo(e.target.value); }} />
            </div>
            <div>
              <Label className="text-xs mb-1.5 block">To <span className="text-red-500">*</span></Label>
              <Input type="date" className="h-9 text-xs" value={to} min={from}
                onChange={e => setTo(e.target.value)} />
            </div>
          </div>

          {/* Audit Employees multi-select */}
          <div>
            <Label className="text-xs mb-1.5 block">
              Audit Employees <span className="text-red-500">*</span>
            </Label>
            <div className="flex flex-wrap gap-1.5 mb-2 min-h-[28px]">
              {empNames.map((name, i) => (
                <Badge key={i} variant="secondary" className="text-[11px] gap-1 pr-1">
                  {name}
                  <button onClick={() => removeEmployee(i)} className="hover:text-red-500">
                    <X size={10} />
                  </button>
                </Badge>
              ))}
              {empNames.length === 0 && (
                <span className="text-xs text-muted-foreground">No employees selected</span>
              )}
            </div>
            <Popover open={empOpen} onOpenChange={setEmpOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" className="w-full h-8 text-xs font-normal justify-between">
                  <span>Add employee…</span>
                  <ChevronsUpDown size={13} className="opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="p-0 w-[280px]" align="start">
                <Command>
                  <CommandInput placeholder="Search employee…" className="h-8 text-xs" />
                  <CommandList className="max-h-48">
                    <CommandEmpty className="py-3 text-xs text-center text-muted-foreground">
                      {unselected.length === 0 ? "All employees added" : "No match"}
                    </CommandEmpty>
                    <CommandGroup>
                      {unselected.map(u => (
                        <CommandItem key={u.id} value={u.name}
                          onSelect={() => addEmployee(u)} className="text-xs">
                          {u.name}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>

          {from && to && from !== to && (
            <p className="text-[11px] text-muted-foreground bg-muted/50 rounded px-2 py-1.5">
              📅 Creates blocks for <strong>{Math.ceil((new Date(to).getTime() - new Date(from).getTime()) / 86400000) + 1}</strong> days
              × <strong>{empIds.length}</strong> employee{empIds.length !== 1 ? "s" : ""}
            </p>
          )}
        </div>

        <DialogFooter className="flex items-center justify-between gap-2 sm:justify-between">
          {isEdit && onDelete && (
            confirmDel ? (
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-red-600 font-medium">Delete this entry?</span>
                <Button size="sm" variant="destructive" className="h-7 text-xs"
                  onClick={handleDelete} disabled={deleting}>
                  {deleting ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={11} />}
                  Yes
                </Button>
                <Button size="sm" variant="ghost" className="h-7 text-xs"
                  onClick={() => setConfirmDel(false)}>
                  No
                </Button>
              </div>
            ) : (
              <Button size="sm" variant="outline"
                className="h-7 text-xs text-red-600 border-red-200 hover:bg-red-50 gap-1"
                onClick={() => setConfirmDel(true)}>
                <Trash2 size={11} /> Delete
              </Button>
            )
          )}
          {!(isEdit && onDelete) && <div />}

          <div className="flex gap-2">
            <Button variant="ghost" size="sm" className="h-7 text-xs"
              onClick={() => onOpenChange(false)} disabled={saving}>
              Cancel
            </Button>
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1"
              onClick={() => handleSave(true)} disabled={saving || !valid || !clientName}>
              {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
              Save &amp; Add Another
            </Button>
            <Button size="sm" className="bg-indigo-600 hover:bg-indigo-700 gap-1 h-7 text-xs"
              onClick={() => handleSave(false)} disabled={saving || !valid || !clientName}>
              {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
              {isEdit ? "Update" : "Save"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
