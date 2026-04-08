/**
 * PlanningEntryDialog
 * Create / edit a planning entry with searchable client dropdown + employee multi-select
 */
import { useState, useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Save, Loader2, ChevronsUpDown, Check, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PlanEntry } from "../hooks/useAuditPlanning";
import type { ClientOption } from "../hooks/useClients";
import type { UserOption }   from "../hooks/useUsers";

// ─── Types ───────────────────────────────────────────────────────────────────

interface Props {
  open:       boolean;
  onOpenChange: (v: boolean) => void;
  initial?:   Partial<PlanEntry>;
  clients:    ClientOption[];
  users:      UserOption[];
  onSave:     (data: {
    client_id:      string | null;
    client_name:    string | null;
    planned_from:   string;
    planned_to:     string;
    employee_ids:   string[];
    employee_names: string[];
  }) => Promise<void>;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function PlanningEntryDialog({ open, onOpenChange, initial, clients, users, onSave }: Props) {
  const [clientOpen, setClientOpen] = useState(false);
  const [clientId,   setClientId]   = useState(initial?.client_id   || "");
  const [clientName, setClientName] = useState(initial?.client_name || "");
  const [from,       setFrom]       = useState(initial?.planned_from || "");
  const [to,         setTo]         = useState(initial?.planned_to   || "");
  const [empIds,     setEmpIds]     = useState<string[]>(initial?.employee_ids   || []);
  const [empNames,   setEmpNames]   = useState<string[]>(initial?.employee_names || []);
  const [empOpen,    setEmpOpen]    = useState(false);
  const [saving,     setSaving]     = useState(false);

  const unselectedUsers = useMemo(
    () => users.filter(u => !empIds.includes(u.id)),
    [users, empIds]
  );

  function addEmployee(user: UserOption) {
    if (empIds.includes(user.id)) return;
    setEmpIds(ids   => [...ids,   user.id]);
    setEmpNames(ns  => [...ns,    user.name]);
    setEmpOpen(false);
  }

  function removeEmployee(idx: number) {
    setEmpIds(ids  => ids.filter((_, i) => i !== idx));
    setEmpNames(ns => ns.filter((_, i) => i !== idx));
  }

  async function handleSave() {
    if (!from || !to) return;
    setSaving(true);
    await onSave({
      client_id:      clientId || null,
      client_name:    clientName || null,
      planned_from:   from,
      planned_to:     to,
      employee_ids:   empIds,
      employee_names: empNames,
    });
    setSaving(false);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{initial?.id ? "Edit Plan" : "Add Audit Plan"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Client — searchable combobox */}
          <div>
            <Label className="text-xs mb-1 block">Client</Label>
            <Popover open={clientOpen} onOpenChange={setClientOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" role="combobox"
                  className="w-full justify-between h-8 text-xs font-normal">
                  <span className="truncate">{clientName || "Select client…"}</span>
                  <ChevronsUpDown size={13} className="ml-2 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="p-0 w-[320px]" align="start">
                <Command>
                  <CommandInput placeholder="Search client…" className="h-8 text-xs" />
                  <CommandList>
                    <CommandEmpty className="text-xs py-3 text-center text-muted-foreground">No client found</CommandEmpty>
                    <CommandGroup>
                      {clients.map(c => (
                        <CommandItem key={c.id} value={c.name}
                          onSelect={() => {
                            setClientId(c.id);
                            setClientName(c.name);
                            setClientOpen(false);
                          }}
                          className="text-xs"
                        >
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

          {/* Dates */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs mb-1 block">Planned From <span className="text-red-500">*</span></Label>
              <Input type="date" className="h-8 text-xs" value={from}
                onChange={e => setFrom(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs mb-1 block">Planned To <span className="text-red-500">*</span></Label>
              <Input type="date" className="h-8 text-xs" value={to}
                onChange={e => setTo(e.target.value)} />
            </div>
          </div>

          {/* Employee multi-select */}
          <div>
            <Label className="text-xs mb-1 block">Employees / Audit Staff</Label>
            <div className="flex flex-wrap gap-1.5 mb-2 min-h-[28px]">
              {empNames.map((name, i) => (
                <Badge key={i} variant="secondary" className="text-[11px] gap-1 pr-1">
                  {name}
                  <button onClick={() => removeEmployee(i)}
                    className="hover:text-red-500 transition-colors">
                    <X size={10} />
                  </button>
                </Badge>
              ))}
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
                  <CommandInput placeholder="Search…" className="h-8 text-xs" />
                  <CommandList>
                    <CommandEmpty className="text-xs py-3 text-center text-muted-foreground">
                      {unselectedUsers.length === 0 ? "All employees added" : "No match"}
                    </CommandEmpty>
                    <CommandGroup>
                      {unselectedUsers.map(u => (
                        <CommandItem key={u.id} value={u.name}
                          onSelect={() => addEmployee(u)}
                          className="text-xs"
                        >
                          {u.name}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button size="sm" className="bg-indigo-600 hover:bg-indigo-700 gap-1"
            onClick={handleSave} disabled={saving || !from || !to}>
            {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
