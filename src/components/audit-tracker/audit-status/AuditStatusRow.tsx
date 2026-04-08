/**
 * AuditStatusRow
 * Single row in the Audit Status grid.
 * Inline edit mode: click Edit → all cells become inputs → Save/Cancel.
 */
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Edit2, Check, X, Trash2, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { StatusEntry, StatusPatch } from "../hooks/useAuditStatus";
import { AUDIT_STATUS_OPTIONS } from "./AuditStatusFilters";
import type { ClientOption }  from "../hooks/useClients";
import type { UserOption }    from "../hooks/useUsers";
import type { AuditFirmOption } from "../hooks/useFirms";

// ─── Constants ────────────────────────────────────────────────────────────────

const YES_NO = ["Yes", "No"];

const STATUS_COLORS: Record<string, string> = {
  "Not Started": "bg-gray-100 text-gray-600",
  "In Progress": "bg-blue-100 text-blue-700",
  "Under Review":"bg-yellow-100 text-yellow-700",
  "Completed":   "bg-green-100 text-green-700",
  "Signed":      "bg-violet-100 text-violet-700",
  "Other":       "bg-orange-100 text-orange-700",
};

// ─── Tiny cell helpers ────────────────────────────────────────────────────────

function TCell({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <td className={cn("border border-border px-2 py-1.5 align-middle text-xs", className)}>
      {children}
    </td>
  );
}

function EInput({ value, onChange, placeholder, type = "text", className }: {
  value: string; onChange: (v: string) => void;
  placeholder?: string; type?: string; className?: string;
}) {
  return (
    <Input
      type={type}
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      className={cn("h-6 text-[11px] w-full", className)}
    />
  );
}

function ESelect({ value, onChange, options }: {
  value: string; onChange: (v: string) => void; options: string[];
}) {
  return (
    <Select value={value || "__none__"} onValueChange={v => onChange(v === "__none__" ? "" : v)}>
      <SelectTrigger className="h-6 text-[11px]"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="__none__" className="text-[11px]">—</SelectItem>
        {options.map(o => <SelectItem key={o} value={o} className="text-[11px]">{o}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  row:        StatusEntry;
  srNo:       number;
  clients:    ClientOption[];
  users:      UserOption[];
  auditFirms: AuditFirmOption[];
  onSave:     (id: string, patch: StatusPatch) => Promise<void>;
  onDelete:   (id: string) => Promise<void>;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function AuditStatusRow({ row, srNo, clients, users, auditFirms, onSave, onDelete }: Props) {
  const [editing,   setEditing]   = useState(false);
  const [draft,     setDraft]     = useState<StatusPatch>({});
  const [saving,    setSaving]    = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);

  function startEdit() {
    setDraft({
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
    });
    setEditing(true);
  }

  async function commitSave() {
    setSaving(true);
    await onSave(row.id, draft);
    setSaving(false);
    setEditing(false);
  }

  function cancelEdit() { setEditing(false); setDraft({}); }

  const d = draft as Record<string, string>;
  const set = (field: string, val: string) => setDraft(p => ({ ...p, [field]: val }));
  const v   = (field: string, fallback: string | null) =>
    editing ? (d[field] ?? fallback ?? "") : (fallback ?? "");

  const statusColor = STATUS_COLORS[row.audit_status || ""] || "bg-gray-100 text-gray-600";
  const showOther   = (editing ? d.audit_status : row.audit_status) === "Other";

  return (
    <tr className={cn(
      "hover:bg-muted/10 transition-colors",
      editing && "bg-indigo-50/40"
    )}>
      {/* Sr No */}
      <TCell className="text-center text-muted-foreground font-mono w-10">{srNo}</TCell>

      {/* Party Name */}
      <TCell className="min-w-[140px]">
        {editing
          ? <EInput value={d.party_name ?? ""} onChange={val => set("party_name", val)} placeholder="Party…" />
          : <span className="font-medium">{row.party_name || "—"}</span>}
      </TCell>

      {/* Physical Audit Conducted */}
      <TCell className="w-20 text-center">
        {editing
          ? <ESelect value={d.physical_audit_conducted ?? "No"} onChange={val => set("physical_audit_conducted", val)} options={YES_NO} />
          : <Badge className={cn("text-[10px]", row.physical_audit_conducted === "Yes" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700")}>
              {row.physical_audit_conducted || "No"}
            </Badge>}
      </TCell>

      {/* Accounting Data */}
      <TCell className="w-20 text-center">
        {editing
          ? <ESelect value={d.accounting_data ?? "No"} onChange={val => set("accounting_data", val)} options={YES_NO} />
          : <Badge className={cn("text-[10px]", row.accounting_data === "Yes" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700")}>
              {row.accounting_data || "No"}
            </Badge>}
      </TCell>

      {/* Audit Employees */}
      <TCell className="min-w-[120px]">
        {editing
          ? <EInput value={d.audit_employees ?? ""} onChange={val => set("audit_employees", val)} placeholder="Names…" />
          : <span className="text-muted-foreground">{row.audit_employees || "—"}</span>}
      </TCell>

      {/* Audit Report Prepared By */}
      <TCell className="min-w-[110px]">
        {editing
          ? <EInput value={d.audit_report_prepared_by ?? ""} onChange={val => set("audit_report_prepared_by", val)} placeholder="Name…" />
          : <span>{row.audit_report_prepared_by || "—"}</span>}
      </TCell>

      {/* Audit Status */}
      <TCell className="w-28">
        {editing ? (
          <div className="space-y-1">
            <ESelect value={d.audit_status ?? ""} onChange={val => set("audit_status", val)} options={AUDIT_STATUS_OPTIONS} />
            {showOther && (
              <EInput value={d.audit_status_other ?? ""} onChange={val => set("audit_status_other", val)} placeholder="Specify…" />
            )}
          </div>
        ) : (
          row.audit_status
            ? <Badge className={cn("text-[10px]", statusColor)}>{row.audit_status}</Badge>
            : <span className="text-muted-foreground/50">—</span>
        )}
      </TCell>

      {/* Report Print Date */}
      <TCell className="w-28">
        {editing
          ? <EInput type="date" value={d.report_print_date ?? ""} onChange={val => set("report_print_date", val)} />
          : <span className="text-muted-foreground">{row.report_print_date || "—"}</span>}
      </TCell>

      {/* Firm */}
      <TCell className="min-w-[100px]">
        {editing
          ? <EInput value={d.firm ?? ""} onChange={val => set("firm", val)} placeholder="Firm…" />
          : <span>{row.firm || "—"}</span>}
      </TCell>

      {/* Partner */}
      <TCell className="min-w-[100px]">
        {editing
          ? <EInput value={d.partner ?? ""} onChange={val => set("partner", val)} placeholder="Partner…" />
          : <span>{row.partner || "—"}</span>}
      </TCell>

      {/* UDIN Tax Audit */}
      <TCell className="min-w-[140px]">
        {editing
          ? <EInput value={d.udin_tax_audit ?? ""} onChange={val => set("udin_tax_audit", val)} placeholder="UDIN…" className="font-mono" />
          : <span className="font-mono text-[10px]">{row.udin_tax_audit || "—"}</span>}
      </TCell>

      {/* UDIN Statutory Audit */}
      <TCell className="min-w-[140px]">
        {editing
          ? <EInput value={d.udin_statutory_audit ?? ""} onChange={val => set("udin_statutory_audit", val)} placeholder="UDIN…" className="font-mono" />
          : <span className="font-mono text-[10px]">{row.udin_statutory_audit || "—"}</span>}
      </TCell>

      {/* UDIN Date */}
      <TCell className="w-28">
        {editing
          ? <EInput type="date" value={d.udin_date ?? ""} onChange={val => set("udin_date", val)} />
          : <span className="text-muted-foreground">{row.udin_date || "—"}</span>}
      </TCell>

      {/* Physical Report Received Date */}
      <TCell className="w-28">
        {editing
          ? <EInput type="date" value={d.physical_report_received_date ?? ""} onChange={val => set("physical_report_received_date", val)} />
          : <span className="text-muted-foreground">{row.physical_report_received_date || "—"}</span>}
      </TCell>

      {/* Scanned */}
      <TCell className="w-20 text-center">
        {editing
          ? <ESelect value={d.scanned ?? "No"} onChange={val => set("scanned", val)} options={YES_NO} />
          : <Badge className={cn("text-[10px]", row.scanned === "Yes" ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600")}>
              {row.scanned || "No"}
            </Badge>}
      </TCell>

      {/* Prepared By */}
      <TCell className="min-w-[100px]">
        {editing
          ? <EInput value={d.prepared_by ?? ""} onChange={val => set("prepared_by", val)} placeholder="Name…" />
          : <span>{row.prepared_by || "—"}</span>}
      </TCell>

      {/* Checked By */}
      <TCell className="min-w-[100px]">
        {editing
          ? <EInput value={d.checked_by ?? ""} onChange={val => set("checked_by", val)} placeholder="Name…" />
          : <span>{row.checked_by || "—"}</span>}
      </TCell>

      {/* Uploaded By */}
      <TCell className="min-w-[100px]">
        {editing
          ? <EInput value={d.uploaded_by ?? ""} onChange={val => set("uploaded_by", val)} placeholder="Name…" />
          : <span>{row.uploaded_by || "—"}</span>}
      </TCell>

      {/* Remarks */}
      <TCell className="min-w-[120px]">
        {editing
          ? <EInput value={d.remarks ?? ""} onChange={val => set("remarks", val)} placeholder="Remarks…" />
          : <span className="text-muted-foreground line-clamp-2">{row.remarks || "—"}</span>}
      </TCell>

      {/* Actions */}
      <TCell className="w-20 text-center">
        {editing ? (
          <div className="flex items-center justify-center gap-1">
            <Button size="sm" variant="ghost"
              className="h-6 w-6 p-0 text-green-600 hover:bg-green-50"
              onClick={commitSave} disabled={saving}>
              {saving ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
            </Button>
            <Button size="sm" variant="ghost"
              className="h-6 w-6 p-0 text-red-500 hover:bg-red-50"
              onClick={cancelEdit}>
              <X size={11} />
            </Button>
          </div>
        ) : confirmDel ? (
          <div className="flex flex-col gap-0.5">
            <Button size="sm" variant="destructive" className="h-5 text-[9px] px-1 w-full"
              onClick={() => { onDelete(row.id); setConfirmDel(false); }}>
              Yes
            </Button>
            <Button size="sm" variant="ghost" className="h-5 text-[9px] px-1 w-full"
              onClick={() => setConfirmDel(false)}>
              No
            </Button>
          </div>
        ) : (
          <div className="flex items-center justify-center gap-1">
            <Button size="sm" variant="ghost"
              className="h-6 w-6 p-0 text-muted-foreground hover:text-indigo-600 hover:bg-indigo-50"
              onClick={startEdit}>
              <Edit2 size={11} />
            </Button>
            <Button size="sm" variant="ghost"
              className="h-6 w-6 p-0 text-muted-foreground hover:text-red-600 hover:bg-red-50"
              onClick={() => setConfirmDel(true)}>
              <Trash2 size={11} />
            </Button>
          </div>
        )}
      </TCell>
    </tr>
  );
}
