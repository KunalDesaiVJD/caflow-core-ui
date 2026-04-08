/**
 * AuditStatusGrid
 * Full audit status table — all columns, horizontally scrollable,
 * sticky Sr/Party columns, powered by useAuditStatus.
 */
import { useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import AuditStatusFilters from "./AuditStatusFilters";
import AuditStatusRow     from "./AuditStatusRow";
import { useAuditStatus } from "../hooks/useAuditStatus";
import type { ClientOption }    from "../hooks/useClients";
import type { UserOption }      from "../hooks/useUsers";
import type { AuditFirmOption } from "../hooks/useFirms";

// ─── Column headers ───────────────────────────────────────────────────────────

const COLS = [
  "Sr No",
  "Party Name",
  "Physical Audit",
  "Accounting Data",
  "Audit Employees",
  "Report Prepared By",
  "Audit Status",
  "Report Print Date",
  "Firm",
  "Partner",
  "UDIN (Tax)",
  "UDIN (Statutory)",
  "UDIN Date",
  "Phys. Report Recd.",
  "Scanned",
  "Prepared By",
  "Checked By",
  "Uploaded By",
  "Remarks",
  "Actions",
];

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  firmId:     string;
  clients:    ClientOption[];
  users:      UserOption[];
  auditFirms: AuditFirmOption[];
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function AuditStatusGrid({ firmId, clients, users, auditFirms }: Props) {
  const { rows, loading, useLs, reload, addRow, updateRow, removeRow } =
    useAuditStatus(firmId);

  const [search,       setSearch]       = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const filtered = rows.filter(r => {
    const q = search.toLowerCase();
    const matchSearch = !q ||
      (r.party_name || "").toLowerCase().includes(q) ||
      (r.audit_employees || "").toLowerCase().includes(q);
    const matchStatus = statusFilter === "all" || r.audit_status === statusFilter;
    return matchSearch && matchStatus;
  });

  async function handleAddRow() {
    await addRow({
      client_id:                    null,
      party_name:                   "",
      physical_audit_conducted:     "No",
      accounting_data:              "No",
      audit_employees:              null,
      audit_report_prepared_by:     null,
      audit_status:                 null,
      audit_status_other:           null,
      report_print_date:            null,
      firm:                         null,
      partner:                      null,
      udin_tax_audit:               null,
      udin_statutory_audit:         null,
      udin_date:                    null,
      physical_report_received_date:null,
      scanned:                      "No",
      prepared_by:                  null,
      checked_by:                   null,
      uploaded_by:                  null,
      remarks:                      null,
      engagement_id:                null,
    });
  }

  return (
    <div className="space-y-3">
      {/* Offline badge */}
      {useLs && (
        <Badge className="bg-amber-100 text-amber-700 text-xs gap-1">
          Offline mode — data stored locally. Apply Supabase migration to persist to cloud.
        </Badge>
      )}

      <AuditStatusFilters
        search={search}       onSearch={setSearch}
        statusFilter={statusFilter} onStatus={setStatusFilter}
        onRefresh={reload}
        onAddRow={handleAddRow}
      />

      <div className="border rounded-lg overflow-hidden">
        <div className="overflow-auto">
          <table className="w-full text-xs border-collapse" style={{ minWidth: 1800 }}>
            <thead>
              <tr className="bg-indigo-700 text-white text-[10px] uppercase tracking-wide">
                {COLS.map(col => (
                  <th key={col} className="border border-indigo-600 px-2 py-2.5 text-left whitespace-nowrap">
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i}>
                    <td colSpan={COLS.length} className="px-3 py-2 border border-border">
                      <Skeleton className="h-5 w-full" />
                    </td>
                  </tr>
                ))
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={COLS.length} className="py-12 text-center text-muted-foreground">
                    {rows.length === 0
                      ? "No rows yet — click Add Row to begin"
                      : "No rows match current filters"}
                  </td>
                </tr>
              ) : (
                filtered.map((row, idx) => (
                  <AuditStatusRow
                    key={row.id}
                    row={row}
                    srNo={idx + 1}
                    clients={clients}
                    users={users}
                    auditFirms={auditFirms}
                    onSave={updateRow}
                    onDelete={removeRow}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-[11px] text-muted-foreground">
        {filtered.length} row{filtered.length !== 1 ? "s" : ""}
        {rows.length !== filtered.length ? ` of ${rows.length}` : ""}
      </p>
    </div>
  );
}
