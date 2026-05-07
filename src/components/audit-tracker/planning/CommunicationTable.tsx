/**
 * CommunicationTable
 *
 * Inline-editable grid below the planning calendar.
 * Columns: Client | Audit Planned From | Audit Planned To | Contact Person | Contact No | Remarks
 *
 * Smart behaviours:
 *  - Client → searchable combobox (type-to-filter)
 *  - Selecting a client auto-fetches planned_from / planned_to from audit_planning
 *  - Contact No → validated: /^[6-9]\d{9}$/ (strips spaces before check)
 *  - "Add Row" → new blank editable row appended
 *  - Each row has Save (✓) and Delete buttons
 *  - Dirty rows show a blue save button; clean rows show a grey edit indicator
 */
import { useState, useEffect, useCallback, useMemo } from "react";
import { Button }   from "@/components/ui/button";
import { Input }    from "@/components/ui/input";
import { Badge }    from "@/components/ui/badge";
import {
  Command, CommandEmpty, CommandGroup,
  CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Check, ChevronsUpDown, Plus, Save, Loader2, Trash2, X, History, Search,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { CommEntry, PlanEntry } from "../hooks/useAuditPlanning";
import type { ClientOption }         from "../hooks/useClients";
import AuditChangeLogModal from "../audit-status/AuditChangeLogModal";

// ─── Types ───────────────────────────────────────────────────────────────────

interface DraftRow {
  id:            string;
  isNew:         boolean;
  isDirty:       boolean;
  clientId:      string;   // used for auto-fetch only, not persisted
  clientName:    string;
  auditFrom:     string;
  auditTo:       string;
  contactPerson: string;
  contactNo:     string;
  phoneError:    string;
  remarks:       string;
  saving:        boolean;
  confirmDel:    boolean;
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  comms:    CommEntry[];
  entries:  PlanEntry[];      // planning entries — source for date auto-fetch
  clients:  ClientOption[];
  onAdd:    (data: Omit<CommEntry, "id"|"firm_id"|"created_at">) => Promise<void>;
  onUpdate: (id: string, patch: Partial<CommEntry>) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Convert a saved CommEntry → DraftRow */
function commToDraft(c: CommEntry, clients: ClientOption[]): DraftRow {
  return {
    id:            c.id,
    isNew:         false,
    isDirty:       false,
    clientId:      clients.find(cl => cl.name === c.client_name)?.id || "",
    clientName:    c.client_name     || "",
    auditFrom:     c.audit_planned_from || "",
    auditTo:       c.audit_planned_to   || "",
    contactPerson: c.contact_person     || "",
    contactNo:     c.contact_no         || "",
    phoneError:    "",
    remarks:       c.remarks            || "",
    saving:        false,
    confirmDel:    false,
  };
}

/** Indian mobile: 10 digits starting 6-9; allows spaces/dashes (stripped before check) */
function validatePhone(raw: string): string {
  if (!raw.trim()) return "";                        // empty → valid (not mandatory)
  const stripped = raw.replace(/[\s\-]/g, "");
  if (!/^[6-9]\d{9}$/.test(stripped)) {
    return "Enter 10-digit Indian mobile (starts 6–9)";
  }
  return "";
}

// ─── Compact client combobox (renders inside a table cell) ───────────────────

interface ClientCellProps {
  value:     string;   // current client name
  clientId:  string;
  clients:   ClientOption[];
  onChange:  (client: ClientOption) => void;
}

function ClientCell({ value, clientId, clients, onChange }: ClientCellProps) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" role="combobox"
          className={cn(
            "h-7 w-full justify-between text-xs font-normal px-2",
            !value && "text-muted-foreground"
          )}>
          <span className="truncate">{value || "Select client…"}</span>
          <ChevronsUpDown size={11} className="ml-1 shrink-0 opacity-40" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="p-0 w-[260px]" align="start">
        <Command>
          <CommandInput placeholder="Search client…" className="h-8 text-xs" />
          <CommandList className="max-h-48">
            <CommandEmpty className="py-3 text-xs text-center text-muted-foreground">
              No client found
            </CommandEmpty>
            <CommandGroup>
              {clients.map(c => (
                <CommandItem key={c.id} value={c.name}
                  onSelect={() => { onChange(c); setOpen(false); }}
                  className="text-xs">
                  <Check size={11} className={cn("mr-2", clientId === c.id ? "opacity-100" : "opacity-0")} />
                  {c.name}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function CommunicationTable({ comms, entries, clients, onAdd, onUpdate, onRemove }: Props) {
  const [rows, setRows] = useState<DraftRow[]>([]);
  // ── Search / filter ───────────────────────────────────────────────────────
  const [filterText, setFilterText] = useState("");

  const visibleRows = useMemo(() => {
    const q = filterText.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(r =>
      (r.clientName  || "").toLowerCase().includes(q) ||
      (r.contactPerson || "").toLowerCase().includes(q) ||
      (r.remarks     || "").toLowerCase().includes(q)
    );
  }, [rows, filterText]);

  // ── Version history modal ─────────────────────────────────────────────────
  const [historyRowId,    setHistoryRowId]    = useState<string | null>(null);
  const [historyRowLabel, setHistoryRowLabel] = useState<string | null>(null);

  // ── Sync from comms (skip dirty / unsaved rows) ───────────────────────────
  // Issue 4 — Dedupe by client name on display.  When the same client appears
  // in multiple rows, only the first occurrence (most recent, since comms is
  // ordered by created_at desc) is kept.  Blank-name rows (newly-added drafts)
  // are always preserved.
  useEffect(() => {
    setRows(prev => {
      const newRows   = prev.filter(r => r.isNew);            // keep unsaved drafts
      const syncedRows = comms.map(c => {
        const dirty = prev.find(r => !r.isNew && r.id === c.id && r.isDirty);
        return dirty ?? commToDraft(c, clients);               // preserve dirty edits
      });
      const seen = new Set<string>();
      const deduped = syncedRows.filter(r => {
        const key = (r.clientName || "").trim().toLowerCase();
        if (!key) return true;          // blank-name → keep
        if (seen.has(key)) return false; // duplicate → drop
        seen.add(key);
        return true;
      });
      return [...deduped, ...newRows];
    });
  }, [comms, clients]);

  // ── Row helpers ───────────────────────────────────────────────────────────

  const patch = useCallback((id: string, delta: Partial<DraftRow>) => {
    setRows(prev => prev.map(r => r.id === id ? { ...r, ...delta, isDirty: true } : r));
  }, []);

  function handleClientSelect(id: string, client: ClientOption) {
    // Auto-fetch planned dates for this client
    const planEntry = entries.find(e => e.client_id === client.id);
    setRows(prev => prev.map(r =>
      r.id === id ? {
        ...r,
        isDirty:    true,
        clientId:   client.id,
        clientName: client.name,
        auditFrom:  planEntry?.planned_from || "",
        auditTo:    planEntry?.planned_to   || "",
      } : r
    ));
  }

  function handlePhoneChange(id: string, val: string) {
    setRows(prev => prev.map(r =>
      r.id === id ? { ...r, isDirty: true, contactNo: val, phoneError: validatePhone(val) } : r
    ));
  }

  function handleAddRow() {
    const tempId = `new_${Date.now()}`;
    setRows(prev => [...prev, {
      id: tempId, isNew: true, isDirty: true,
      clientId: "", clientName: "", auditFrom: "", auditTo: "",
      contactPerson: "", contactNo: "", phoneError: "", remarks: "",
      saving: false, confirmDel: false,
    }]);
  }

  async function handleSave(row: DraftRow) {
    // Issue 4 — Block duplicate client entries on save.  A client may
    // appear in the communication log only once.  To update an existing
    // entry the auditor edits the existing row.
    if (row.isNew && row.clientName.trim()) {
      const newKey = row.clientName.trim().toLowerCase();
      const exists = comms.some(c =>
        (c.client_name || "").trim().toLowerCase() === newKey,
      );
      if (exists) {
        toast.error(
          `"${row.clientName}" is already in the communication log. ` +
          `Edit the existing row instead of creating a duplicate.`,
        );
        return;
      }
    }

    // Final phone validation before save
    const phoneErr = validatePhone(row.contactNo);
    if (phoneErr) {
      setRows(prev => prev.map(r => r.id === row.id ? { ...r, phoneError: phoneErr } : r));
      return;
    }

    setRows(prev => prev.map(r => r.id === row.id ? { ...r, saving: true, phoneError: "" } : r));

    const payload: Omit<CommEntry, "id"|"firm_id"|"created_at"> = {
      planning_id:        null,
      client_name:        row.clientName     || null,
      audit_planned_from: row.auditFrom      || null,
      audit_planned_to:   row.auditTo        || null,
      contact_person:     row.contactPerson  || null,
      contact_no:         row.contactNo      || null,
      remarks:            row.remarks        || null,
    };

    if (row.isNew) {
      await onAdd(payload);
      // Remove temp row — comms prop will re-add it with real ID from server
      setRows(prev => prev.filter(r => r.id !== row.id));
    } else {
      await onUpdate(row.id, payload);
      setRows(prev => prev.map(r =>
        r.id === row.id ? { ...r, saving: false, isDirty: false } : r
      ));
    }
  }

  async function handleDelete(row: DraftRow) {
    if (row.isNew) {
      setRows(prev => prev.filter(r => r.id !== row.id));
      return;
    }
    await onRemove(row.id);
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="border rounded-lg overflow-hidden">
      {/* Header */}
      <div className="bg-indigo-600 text-white px-4 py-2.5 flex items-center justify-between gap-3 flex-wrap">
        <span className="text-sm font-semibold shrink-0">Communication Log</span>
        {/* Search filter */}
        <div className="relative flex-1 min-w-[160px] max-w-[260px]">
          <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-white/60 pointer-events-none" />
          <input
            type="text"
            value={filterText}
            onChange={e => setFilterText(e.target.value)}
            placeholder="Search client, person, remarks…"
            className="w-full h-7 pl-6 pr-6 text-[11px] rounded bg-white/10 border border-white/30 text-white placeholder-white/50 focus:outline-none focus:border-white/70"
          />
          {filterText && (
            <button
              type="button"
              onClick={() => setFilterText("")}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 text-white/60 hover:text-white"
            >
              <X size={10} />
            </button>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {filterText && (
            <span className="text-[10px] text-white/70">{visibleRows.length} result{visibleRows.length !== 1 ? "s" : ""}</span>
          )}
          <Button size="sm" variant="outline"
            className="h-7 text-xs border-white/40 text-white hover:bg-white/10 gap-1"
            onClick={handleAddRow}>
            <Plus size={11} /> Add Row
          </Button>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-auto">
        <table className="w-full text-xs border-collapse" style={{ minWidth: 820 }}>
          <thead>
            <tr className="bg-indigo-50 text-indigo-800 text-[11px] uppercase tracking-wide select-none">
              <th className="border border-border px-2 py-2 text-left w-[200px]">Client</th>
              <th className="border border-border px-2 py-2 text-left w-[110px]">
                Audit From
                <span className="ml-1 text-[9px] font-normal text-indigo-400 normal-case">auto</span>
              </th>
              <th className="border border-border px-2 py-2 text-left w-[110px]">
                Audit To
                <span className="ml-1 text-[9px] font-normal text-indigo-400 normal-case">auto</span>
              </th>
              <th className="border border-border px-2 py-2 text-left min-w-[130px]">Contact Person</th>
              <th className="border border-border px-2 py-2 text-left w-[150px]">Contact No</th>
              <th className="border border-border px-2 py-2 text-left">Remarks</th>
              <th className="border border-border px-2 py-2 text-center w-24">Actions</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-10 text-center text-muted-foreground text-sm">
                  {filterText ? (
                    <span>No results for "<strong>{filterText}</strong>". <button onClick={() => setFilterText("")} className="text-indigo-600 underline">Clear filter</button></span>
                  ) : (
                    <span>No communication entries yet.{" "}
                      <button onClick={handleAddRow} className="text-indigo-600 underline">Add first row</button>
                    </span>
                  )}
                </td>
              </tr>
            ) : (
              visibleRows.map(row => (
                <tr key={row.id}
                  className={cn(
                    "align-top transition-colors",
                    row.isNew   && "bg-indigo-50/30",
                    row.isDirty && !row.isNew && "bg-amber-50/30"
                  )}>

                  {/* Client — searchable combobox */}
                  <td className="border border-border px-1 py-1">
                    <ClientCell
                      value={row.clientName}
                      clientId={row.clientId}
                      clients={clients}
                      onChange={c => handleClientSelect(row.id, c)}
                    />
                  </td>

                  {/* Audit Planned From — auto-fetched or manually editable */}
                  <td className="border border-border px-1.5 py-1.5">
                    <Input
                      type="date"
                      className={cn("h-7 text-xs w-full", row.auditFrom && "text-indigo-700 font-medium")}
                      value={row.auditFrom}
                      onChange={e => patch(row.id, { auditFrom: e.target.value })}
                    />
                  </td>

                  {/* Audit Planned To — auto-fetched or manually editable */}
                  <td className="border border-border px-1.5 py-1.5">
                    <Input
                      type="date"
                      className={cn("h-7 text-xs w-full", row.auditTo && "text-indigo-700 font-medium")}
                      value={row.auditTo}
                      onChange={e => patch(row.id, { auditTo: e.target.value })}
                    />
                  </td>

                  {/* Contact Person */}
                  <td className="border border-border px-1.5 py-1.5">
                    <Input
                      className="h-7 text-xs w-full"
                      placeholder="Name…"
                      value={row.contactPerson}
                      onChange={e => patch(row.id, { contactPerson: e.target.value })}
                    />
                  </td>

                  {/* Contact No — with phone validation */}
                  <td className="border border-border px-1.5 py-1.5">
                    <Input
                      type="tel"
                      inputMode="numeric"
                      maxLength={11}          /* 10 digits + optional space */
                      className={cn(
                        "h-7 text-xs w-full font-mono tracking-wide",
                        row.phoneError && "border-red-400 focus-visible:ring-red-300"
                      )}
                      placeholder="98765 43210"
                      value={row.contactNo}
                      onChange={e => handlePhoneChange(row.id, e.target.value)}
                    />
                    {row.phoneError && (
                      <p className="text-[9px] text-red-500 mt-0.5 leading-tight px-0.5">
                        {row.phoneError}
                      </p>
                    )}
                  </td>

                  {/* Remarks */}
                  <td className="border border-border px-1.5 py-1.5">
                    <Input
                      className="h-7 text-xs w-full"
                      placeholder="Remarks…"
                      value={row.remarks}
                      onChange={e => patch(row.id, { remarks: e.target.value })}
                    />
                  </td>

                  {/* Actions */}
                  <td className="border border-border px-2 py-1.5 text-center align-middle">
                    {row.confirmDel ? (
                      <div className="flex flex-col gap-0.5">
                        <Button size="sm" variant="destructive" className="h-5 text-[9px] px-1 w-full"
                          onClick={() => handleDelete(row)}>
                          Yes
                        </Button>
                        <Button size="sm" variant="ghost" className="h-5 text-[9px] px-1 w-full"
                          onClick={() => setRows(prev => prev.map(r =>
                            r.id === row.id ? { ...r, confirmDel: false } : r
                          ))}>
                          No
                        </Button>
                      </div>
                    ) : (
                      <div className="flex items-center justify-center gap-1">
                        {/* Save */}
                        <Button
                          size="sm"
                          variant={row.isDirty ? "default" : "ghost"}
                          className={cn(
                            "h-6 w-6 p-0",
                            row.isDirty
                              ? "bg-indigo-600 hover:bg-indigo-700 text-white"
                              : "text-muted-foreground"
                          )}
                          onClick={() => handleSave(row)}
                          disabled={row.saving || !!row.phoneError}
                          title="Save row"
                        >
                          {row.saving
                            ? <Loader2 size={10} className="animate-spin" />
                            : <Check size={10} />
                          }
                        </Button>
                        {/* Delete */}
                        <Button size="sm" variant="ghost"
                          className="h-6 w-6 p-0 text-muted-foreground hover:text-red-600 hover:bg-red-50"
                          onClick={() => setRows(prev => prev.map(r =>
                            r.id === row.id ? { ...r, confirmDel: true } : r
                          ))}
                          title="Delete row"
                        >
                          <Trash2 size={10} />
                        </Button>
                        {/* Version history — only for persisted rows */}
                        {!row.isNew && (
                          <Button size="sm" variant="ghost"
                            className="h-6 w-6 p-0 text-muted-foreground hover:text-indigo-600 hover:bg-indigo-50"
                            onClick={() => {
                              setHistoryRowId(row.id);
                              setHistoryRowLabel(row.clientName || "Communication Row");
                            }}
                            title="View change history"
                          >
                            <History size={10} />
                          </Button>
                        )}
                      </div>
                    )}
                    {/* Dirty indicator */}
                    {row.isDirty && !row.saving && (
                      <div className="mt-0.5">
                        <Badge className="text-[8px] px-1 py-0 bg-amber-100 text-amber-700 w-full justify-center">
                          unsaved
                        </Badge>
                      </div>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Footer */}
      <div className="border-t bg-muted/20 px-4 py-2 flex items-center justify-between">
        <p className="text-[11px] text-muted-foreground">
          {rows.filter(r => !r.isNew).length} entr{rows.filter(r => !r.isNew).length !== 1 ? "ies" : "y"}
          {rows.some(r => r.isDirty) && (
            <span className="ml-1.5 text-amber-600 font-medium">
              · {rows.filter(r => r.isDirty).length} unsaved
            </span>
          )}
        </p>
        <p className="text-[10px] text-muted-foreground/60">
          Dates auto-fill from Planning entries when client is selected
        </p>
      </div>

      {/* Change history modal — reuses same modal as Audit Status */}
      <AuditChangeLogModal
        recordId={historyRowId}
        partyName={historyRowLabel}
        open={!!historyRowId}
        onClose={() => { setHistoryRowId(null); setHistoryRowLabel(null); }}
      />
    </div>
  );
}
