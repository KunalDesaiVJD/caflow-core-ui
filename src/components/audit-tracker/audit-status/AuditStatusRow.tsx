/**
 * AuditStatusRow
 *
 * Full inline-edit row for the Audit Status grid.
 * Features:
 *  - Party Name → searchable combobox; auto-detects entity_type for UDIN Statutory
 *  - Audit Employees → auto-fetched from audit_planning when party selected
 *  - Audit Status → 9 fixed + OTHERS (shows "Specify Please:" text input)
 *  - Firm → dropdown from auditFirms; Partner → dynamic per firm (clears on firm change)
 *  - UDIN Statutory → only visible / editable for private_limited / public_limited
 *  - UDIN Date → auto-fills today when either UDIN field is first entered
 *  - 3CA Prepared/Checked/Uploaded By → searchable user comboboxes
 *  - Two-step delete confirmation
 *  - isNew mode: row starts in edit mode, Save calls onAdd
 */
import { useState, useEffect, useMemo, useRef } from "react";
import { Button }   from "@/components/ui/button";
import { Input }    from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge }    from "@/components/ui/badge";
import { Check, X, Trash2, Loader2, History } from "lucide-react";
import { cn } from "@/lib/utils";
import type { StatusEntry, StatusPatch } from "../hooks/useAuditStatus";
import type { ClientOption }             from "../hooks/useClients";
import type { UserOption }               from "../hooks/useUsers";
import type { AuditFirmOption }          from "../hooks/useFirms";
import type { PlanEntry }                from "../hooks/useAuditPlanning";
import { AUDIT_STATUS_OPTIONS }          from "./AuditStatusFilters";

// ─── Constants ────────────────────────────────────────────────────────────────

const YES_NO = ["Yes", "No"];

const STATUS_COLORS: Record<string, string> = {
  "DATA PENDING":            "bg-gray-100 text-gray-600",
  "QUERIES GIVEN TO CLIENT": "bg-yellow-100 text-yellow-700",
  "PREPARE PENDING":         "bg-orange-100 text-orange-700",
  "VERIFICATION PENDING":    "bg-blue-100 text-blue-700",
  "REPORT WITH VJD":         "bg-violet-100 text-violet-700",
  "REPORT WITH KVD":         "bg-purple-100 text-purple-700",
  "REPORT SENT TO CLIENT":   "bg-teal-100 text-teal-700",
  "REPORT SIGNED":           "bg-green-100 text-green-700",
  "OTHERS (SPECIFY)":        "bg-pink-100 text-pink-700",
};

function isCorporate(entityType: string | null | undefined) {
  return entityType === "private_limited" || entityType === "public_limited";
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

// ─── Draft state shape ───────────────────────────────────────────────────────

interface RowDraft {
  clientId:                     string;
  entityType:                   string | null;
  party_name:                   string;
  physical_audit_conducted:     string;
  accounting_data:              string;
  audit_employees:              string;
  audit_report_prepared_by:     string;
  audit_status:                 string;
  audit_status_other:           string;
  report_print_date:            string;
  firm:                         string;
  partner:                      string;
  udin_tax_audit:               string;
  udin_statutory_audit:         string;
  udin_date:                    string;
  physical_report_received_date:string;
  scanned:                      string;
  prepared_by:                  string;
  checked_by:                   string;
  uploaded_by:                  string;
  remarks:                      string;
}

// ─── Mini shared cell wrapper ─────────────────────────────────────────────────

function TCell({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <td className={cn("border border-border px-1.5 py-1 align-middle text-xs", className)}>
      {children}
    </td>
  );
}

// ─── Inline text input ────────────────────────────────────────────────────────

function EInput({ value, onChange, placeholder, type = "text", className, readOnly }: {
  value: string; onChange: (v: string) => void;
  placeholder?: string; type?: string; className?: string; readOnly?: boolean;
}) {
  return (
    <Input
      type={type}
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      readOnly={readOnly}
      className={cn("h-6 text-[11px] w-full px-1.5", className)}
    />
  );
}

// ─── Select helper ────────────────────────────────────────────────────────────

function ESelect({ value, onChange, options, placeholder }: {
  value: string; onChange: (v: string) => void;
  options: string[]; placeholder?: string;
}) {
  return (
    <Select value={value || "__none__"} onValueChange={v => onChange(v === "__none__" ? "" : v)}>
      <SelectTrigger className="h-6 text-[11px] px-1.5"><SelectValue placeholder={placeholder || "—"} /></SelectTrigger>
      <SelectContent>
        <SelectItem value="__none__" className="text-[11px]">—</SelectItem>
        {options.map(o => <SelectItem key={o} value={o} className="text-[11px]">{o}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

// ─── Searchable combobox for clients ─────────────────────────────────────────

function ClientCombobox({ value, onChange, clients, placeholder }: {
  value: string;
  onChange: (text: string, client: ClientOption | null) => void;
  clients: ClientOption[];
  placeholder?: string;
}) {
  const [open, setOpen]     = useState(false);
  const [dropPos, setDropPos] = useState({ top: 0, left: 0, width: 180 });
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() =>
    (value
      ? clients.filter(c => c.name.toLowerCase().includes(value.toLowerCase()))
      : clients
    ).slice(0, 20),
    [value, clients]
  );

  function handleFocus() {
    if (inputRef.current) {
      const r = inputRef.current.getBoundingClientRect();
      setDropPos({ top: r.bottom, left: r.left, width: Math.max(r.width, 180) });
    }
    setOpen(true);
  }

  return (
    <div className="min-w-[130px]">
      <Input
        ref={inputRef}
        value={value}
        onChange={e => onChange(e.target.value, null)}
        onFocus={handleFocus}
        onBlur={() => setTimeout(() => setOpen(false), 160)}
        placeholder={placeholder || "Search party…"}
        className="h-6 text-[11px] px-1.5 w-full"
      />
      {open && filtered.length > 0 && (
        <div
          style={{ position: "fixed", top: dropPos.top, left: dropPos.left, width: dropPos.width, zIndex: 9999 }}
          className="bg-popover border rounded-md shadow-lg max-h-48 overflow-auto"
        >
          {filtered.map(c => (
            <div
              key={c.id}
              onMouseDown={e => { e.preventDefault(); onChange(c.name, c); setOpen(false); }}
              className="px-2 py-1.5 text-[11px] cursor-pointer hover:bg-accent"
            >
              {c.name}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Searchable combobox for users ───────────────────────────────────────────

function UserCombobox({ value, onChange, users, placeholder }: {
  value: string; onChange: (v: string) => void;
  users: UserOption[]; placeholder?: string;
}) {
  const [open, setOpen]     = useState(false);
  const [dropPos, setDropPos] = useState({ top: 0, left: 0, width: 120 });
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() =>
    (value
      ? users.filter(u => u.name.toLowerCase().includes(value.toLowerCase()))
      : users
    ).slice(0, 15),
    [value, users]
  );

  function handleFocus() {
    if (inputRef.current) {
      const r = inputRef.current.getBoundingClientRect();
      setDropPos({ top: r.bottom, left: r.left, width: Math.max(r.width, 120) });
    }
    setOpen(true);
  }

  return (
    <div className="min-w-[100px]">
      <Input
        ref={inputRef}
        value={value}
        onChange={e => onChange(e.target.value)}
        onFocus={handleFocus}
        onBlur={() => setTimeout(() => setOpen(false), 160)}
        placeholder={placeholder || "Search…"}
        className="h-6 text-[11px] px-1.5 w-full"
      />
      {open && filtered.length > 0 && (
        <div
          style={{ position: "fixed", top: dropPos.top, left: dropPos.left, width: dropPos.width, zIndex: 9999 }}
          className="bg-popover border rounded-md shadow-lg max-h-40 overflow-auto"
        >
          {filtered.map(u => (
            <div
              key={u.id}
              onMouseDown={e => { e.preventDefault(); onChange(u.name); setOpen(false); }}
              className="px-2 py-1.5 text-[11px] cursor-pointer hover:bg-accent"
            >
              {u.name}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  row:                StatusEntry;
  srNo:               number;
  clients:            ClientOption[];
  users:              UserOption[];
  auditFirms:         AuditFirmOption[];
  planEntries:        PlanEntry[];
  onSave:             (id: string, patch: StatusPatch) => Promise<void>;
  onDelete:           (id: string) => Promise<void>;
  onHistory?:         (id: string) => void;
  /** isNew: row was just created in the grid and starts in edit mode */
  isNew?:             boolean;
  onAdd?:             (patch: StatusPatch) => Promise<void>;
  onCancelNew?:       () => void;
  /** Save All registry — row registers its save fn when editing starts */
  onRegisterSave?:   (id: string, fn: () => Promise<void>) => void;
  onUnregisterSave?: (id: string) => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function AuditStatusRow({
  row, srNo, clients, users, auditFirms, planEntries,
  onSave, onDelete, onHistory,
  isNew, onAdd, onCancelNew,
  onRegisterSave, onUnregisterSave,
}: Props) {

  // ── Edit state ───────────────────────────────────────────────────────────────
  const [editing,    setEditing]    = useState(!!isNew);
  const [draft,      setDraft]      = useState<RowDraft>(buildDraft(row, clients));
  const [saving,     setSaving]     = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);

  // Auto-start edit for new rows
  useEffect(() => {
    if (isNew) { setEditing(true); setDraft(buildDraft(row, clients)); }
  }, [isNew]); // eslint-disable-line

  // ── Firm options ─────────────────────────────────────────────────────────────
  const firmNames = useMemo(
    () => [...new Set(auditFirms.map(f => f.name))].sort(),
    [auditFirms]
  );
  const partnerOptions = useMemo(() => {
    if (!draft.firm) return [];
    return auditFirms
      .filter(f => f.name === draft.firm)
      .map(f => f.partner_name)
      .filter(Boolean) as string[];
  }, [draft.firm, auditFirms]);

  // ── View-mode entity type (from persisted client_id) ─────────────────────────
  const viewEntityType = clients.find(c => c.id === row.client_id)?.entity_type ?? null;
  const showUdinStatutoryView = isCorporate(viewEntityType);

  // ── Edit handlers ─────────────────────────────────────────────────────────────

  function startEdit() {
    setDraft(buildDraft(row, clients));
    setEditing(true);
    onRegisterSave?.(row.id, commitSave);
  }

  function set(field: keyof RowDraft, val: string) {
    setDraft(p => ({ ...p, [field]: val }));
  }

  function handleClientSelect(text: string, client: ClientOption | null) {
    if (client) {
      // Find matching plan entry to auto-fill employees
      const planEntry = planEntries.find(e => e.client_id === client.id);
      const empNames = planEntry?.employee_names?.join(", ") || "";
      setDraft(p => ({
        ...p,
        party_name: client.name,
        clientId:   client.id,
        entityType: client.entity_type,
        audit_employees: empNames || p.audit_employees,
      }));
    } else {
      // Free-text entry
      setDraft(p => ({ ...p, party_name: text, clientId: "", entityType: null }));
    }
  }

  function handleFirmChange(firmName: string) {
    setDraft(p => ({ ...p, firm: firmName, partner: "" }));
  }

  function handleUdinField(field: "udin_tax_audit" | "udin_statutory_audit", val: string) {
    setDraft(p => {
      const updates: Partial<RowDraft> = { [field]: val };
      // Auto-fill UDIN date when first entering a value
      if (val && !p.udin_date) {
        updates.udin_date = todayISO();
      }
      return { ...p, ...updates };
    });
  }

  async function commitSave() {
    setSaving(true);
    const patch = draftToPatch(draft);
    if (isNew && onAdd) {
      await onAdd(patch);
    } else {
      await onSave(row.id, patch);
    }
    setSaving(false);
    if (!isNew) {
      setEditing(false);
      onUnregisterSave?.(row.id);
    }
  }

  function cancelEdit() {
    if (isNew && onCancelNew) { onCancelNew(); return; }
    setEditing(false);
    setDraft(buildDraft(row, clients));
    onUnregisterSave?.(row.id);
  }

  // ── Convenience aliases ───────────────────────────────────────────────────────
  const showUdinStatutoryEdit = isCorporate(draft.entityType);
  const showOther = draft.audit_status === "OTHERS (SPECIFY)";

  const statusColor = STATUS_COLORS[row.audit_status || ""] || "bg-gray-100 text-gray-600";

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <tr className={cn(
      "hover:bg-muted/10 transition-colors",
      editing && "bg-indigo-50/40",
    )}>

      {/* 1 · Sr No */}
      <TCell className="text-center text-muted-foreground font-mono w-10 sticky left-0 z-10 bg-card">
        {srNo || <span className="text-indigo-400 text-[10px]">new</span>}
      </TCell>

      {/* 2 · Party Name */}
      <TCell className="min-w-[140px] sticky left-10 z-10 bg-card">
        {editing
          ? <ClientCombobox
              value={draft.party_name}
              onChange={handleClientSelect}
              clients={clients}
              placeholder="Search party…"
            />
          : <span className="font-medium text-foreground">{row.party_name || "—"}</span>}
      </TCell>

      {/* 3 · Physical Audit Conducted */}
      <TCell className="w-20 text-center">
        {editing
          ? <ESelect value={draft.physical_audit_conducted} onChange={v => set("physical_audit_conducted", v)} options={YES_NO} />
          : <Badge className={cn("text-[10px]", row.physical_audit_conducted === "Yes" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700")}>
              {row.physical_audit_conducted || "No"}
            </Badge>}
      </TCell>

      {/* 4 · Accounting Data */}
      <TCell className="w-20 text-center">
        {editing
          ? <ESelect value={draft.accounting_data} onChange={v => set("accounting_data", v)} options={YES_NO} />
          : <Badge className={cn("text-[10px]", row.accounting_data === "Yes" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700")}>
              {row.accounting_data || "No"}
            </Badge>}
      </TCell>

      {/* 5 · Audit Employees */}
      <TCell className="min-w-[130px]">
        {editing
          ? <EInput value={draft.audit_employees} onChange={v => set("audit_employees", v)} placeholder="Names…" />
          : <span title={row.audit_employees || ""} className="text-muted-foreground text-[11px] truncate block max-w-[130px]">{row.audit_employees || "—"}</span>}
      </TCell>

      {/* 6 · Audit Report Prepared By */}
      <TCell className="min-w-[120px]">
        {editing
          ? <UserCombobox value={draft.audit_report_prepared_by} onChange={v => set("audit_report_prepared_by", v)} users={users} placeholder="Name…" />
          : <span>{row.audit_report_prepared_by || "—"}</span>}
      </TCell>

      {/* 7 · Audit Status */}
      <TCell className="min-w-[130px]">
        {editing ? (
          <div className="space-y-1">
            <ESelect value={draft.audit_status} onChange={v => set("audit_status", v)} options={AUDIT_STATUS_OPTIONS} />
            {showOther && (
              <EInput
                value={draft.audit_status_other}
                onChange={v => set("audit_status_other", v)}
                placeholder="Specify please…"
              />
            )}
          </div>
        ) : row.audit_status ? (
          <div className="space-y-0.5">
            <Badge className={cn("text-[10px]", statusColor)}>{row.audit_status}</Badge>
            {row.audit_status === "OTHERS (SPECIFY)" && row.audit_status_other && (
              <p className="text-[10px] text-muted-foreground truncate">{row.audit_status_other}</p>
            )}
          </div>
        ) : (
          <span className="text-muted-foreground/50">—</span>
        )}
      </TCell>

      {/* 8 · Report Print Date */}
      <TCell className="w-28">
        {editing
          ? <EInput type="date" value={draft.report_print_date} onChange={v => set("report_print_date", v)} />
          : <span className="text-muted-foreground text-[11px]">{row.report_print_date || "—"}</span>}
      </TCell>

      {/* 9 · Firm */}
      <TCell className="min-w-[110px]">
        {editing
          ? <ESelect value={draft.firm} onChange={handleFirmChange} options={firmNames} placeholder="Select firm…" />
          : <span title={row.firm || ""}>{row.firm || "—"}</span>}
      </TCell>

      {/* 10 · Partner */}
      <TCell className="min-w-[110px]">
        {editing ? (
          partnerOptions.length > 0
            ? <ESelect value={draft.partner} onChange={v => set("partner", v)} options={partnerOptions} placeholder="Select partner…" />
            : <EInput value={draft.partner} onChange={v => set("partner", v)} placeholder="Partner…" />
        ) : (
          <span title={row.partner || ""}>{row.partner || "—"}</span>
        )}
      </TCell>

      {/* 11 · UDIN Tax Audit */}
      <TCell className="min-w-[150px]">
        {editing
          ? <EInput
              value={draft.udin_tax_audit}
              onChange={v => handleUdinField("udin_tax_audit", v)}
              placeholder="UDIN…"
              className="font-mono"
            />
          : <span className="font-mono text-[10px]">{row.udin_tax_audit || "—"}</span>}
      </TCell>

      {/* 12 · UDIN Statutory Audit (conditional on entity type) */}
      <TCell className="min-w-[150px]">
        {editing ? (
          showUdinStatutoryEdit
            ? <EInput
                value={draft.udin_statutory_audit}
                onChange={v => handleUdinField("udin_statutory_audit", v)}
                placeholder="UDIN…"
                className="font-mono"
              />
            : <span className="text-[11px] text-muted-foreground/60 italic">N/A</span>
        ) : (
          showUdinStatutoryView
            ? <span className="font-mono text-[10px]">{row.udin_statutory_audit || "—"}</span>
            : <span className="text-[11px] text-muted-foreground/60 italic">N/A</span>
        )}
      </TCell>

      {/* 13 · UDIN Date */}
      <TCell className="w-28">
        {editing
          ? <EInput type="date" value={draft.udin_date} onChange={v => set("udin_date", v)} />
          : <span className="text-muted-foreground text-[11px]">{row.udin_date || "—"}</span>}
      </TCell>

      {/* 14 · Physical Report Received Date */}
      <TCell className="w-28">
        {editing
          ? <EInput type="date" value={draft.physical_report_received_date} onChange={v => set("physical_report_received_date", v)} />
          : <span className="text-muted-foreground text-[11px]">{row.physical_report_received_date || "—"}</span>}
      </TCell>

      {/* 15 · Scanned */}
      <TCell className="w-20 text-center">
        {editing
          ? <ESelect value={draft.scanned} onChange={v => set("scanned", v)} options={YES_NO} />
          : <Badge className={cn("text-[10px]", row.scanned === "Yes" ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600")}>
              {row.scanned || "No"}
            </Badge>}
      </TCell>

      {/* 16 · 3CA/3CB/3CD Prepared By */}
      <TCell className="min-w-[110px]">
        {editing
          ? <UserCombobox value={draft.prepared_by} onChange={v => set("prepared_by", v)} users={users} placeholder="Prepared by…" />
          : <span>{row.prepared_by || "—"}</span>}
      </TCell>

      {/* 17 · 3CA/3CB/3CD Checked By */}
      <TCell className="min-w-[110px]">
        {editing
          ? <UserCombobox value={draft.checked_by} onChange={v => set("checked_by", v)} users={users} placeholder="Checked by…" />
          : <span>{row.checked_by || "—"}</span>}
      </TCell>

      {/* 18 · 3CA/3CB/3CD Uploaded By */}
      <TCell className="min-w-[110px]">
        {editing
          ? <UserCombobox value={draft.uploaded_by} onChange={v => set("uploaded_by", v)} users={users} placeholder="Uploaded by…" />
          : <span>{row.uploaded_by || "—"}</span>}
      </TCell>

      {/* 19 · Remarks — inline save/cancel appended when editing (Actions column removed per Issue #8D) */}
      <TCell className="min-w-[130px]">
        {editing ? (
          <div className="flex items-center gap-1">
            <EInput value={draft.remarks} onChange={v => set("remarks", v)} placeholder="Remarks…" />
            <Button size="sm" variant="ghost"
              className="h-6 w-6 p-0 shrink-0 text-green-600 hover:bg-green-50"
              onClick={commitSave} disabled={saving} title="Save row">
              {saving ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
            </Button>
            <Button size="sm" variant="ghost"
              className="h-6 w-6 p-0 shrink-0 text-red-500 hover:bg-red-50"
              onClick={cancelEdit} title="Cancel">
              <X size={11} />
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-1 group">
            <span className="text-muted-foreground line-clamp-2 text-[11px] flex-1">{row.remarks || "—"}</span>
            {/* Edit trigger — visible on row hover */}
            <Button size="sm" variant="ghost"
              className="h-5 w-5 p-0 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-indigo-600"
              onClick={startEdit} title="Edit row">
              ✎
            </Button>
          </div>
        )}
      </TCell>

      {/* 20 · Version history — clock icon, always visible for saved rows */}
      <TCell className="w-9 text-center">
        {!isNew && (
          <Button
            size="sm"
            variant="ghost"
            className="h-6 w-6 p-0 text-muted-foreground hover:text-indigo-600 hover:bg-indigo-50"
            onClick={() => onHistory?.(row.id)}
            title="View change history"
          >
            <History size={12} />
          </Button>
        )}
      </TCell>
    </tr>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildDraft(row: StatusEntry, clients: ClientOption[]): RowDraft {
  const entityType = clients.find(c => c.id === row.client_id)?.entity_type ?? null;
  return {
    clientId:                     row.client_id                    || "",
    entityType,
    party_name:                   row.party_name                   || "",
    physical_audit_conducted:     row.physical_audit_conducted     || "No",
    accounting_data:              row.accounting_data              || "No",
    audit_employees:              row.audit_employees              || "",
    audit_report_prepared_by:     row.audit_report_prepared_by     || "",
    audit_status:                 row.audit_status                 || "",
    audit_status_other:           row.audit_status_other           || "",
    report_print_date:            row.report_print_date            || "",
    firm:                         row.firm                         || "",
    partner:                      row.partner                      || "",
    udin_tax_audit:               row.udin_tax_audit               || "",
    udin_statutory_audit:         row.udin_statutory_audit         || "",
    udin_date:                    row.udin_date                    || "",
    physical_report_received_date:row.physical_report_received_date|| "",
    scanned:                      row.scanned                      || "No",
    prepared_by:                  row.prepared_by                  || "",
    checked_by:                   row.checked_by                   || "",
    uploaded_by:                  row.uploaded_by                  || "",
    remarks:                      row.remarks                      || "",
  };
}

function draftToPatch(d: RowDraft): StatusPatch {
  return {
    client_id:                    d.clientId || null,
    party_name:                   d.party_name || null,
    physical_audit_conducted:     d.physical_audit_conducted || "No",
    accounting_data:              d.accounting_data || "No",
    audit_employees:              d.audit_employees || null,
    audit_report_prepared_by:     d.audit_report_prepared_by || null,
    audit_status:                 d.audit_status || null,
    audit_status_other:           d.audit_status === "OTHERS" ? (d.audit_status_other || null) : null,
    report_print_date:            d.report_print_date || null,
    firm:                         d.firm || null,
    partner:                      d.partner || null,
    udin_tax_audit:               d.udin_tax_audit || null,
    udin_statutory_audit:         isCorporate(d.entityType) ? (d.udin_statutory_audit || null) : null,
    udin_date:                    d.udin_date || null,
    physical_report_received_date:d.physical_report_received_date || null,
    scanned:                      d.scanned || "No",
    prepared_by:                  d.prepared_by || null,
    checked_by:                   d.checked_by || null,
    uploaded_by:                  d.uploaded_by || null,
    remarks:                      d.remarks || null,
  };
}
