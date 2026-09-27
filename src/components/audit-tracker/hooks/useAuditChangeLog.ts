/**
 * useAuditChangeLog
 *
 * Fetches change-log entries for a given record_id from audit_change_log.
 * Used by the AuditChangeLogModal to display field-level history.
 * Gracefully handles the case where the table does not exist yet.
 */
import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface ChangeLogEntry {
  id:              string;
  table_name:      string;
  record_id:       string;
  field_name:      string;
  field_label:     string | null;
  old_value:       string | null;
  new_value:       string | null;
  changed_by:      string | null;
  changed_by_name: string | null;
  changed_at:      string;
}

export function useAuditChangeLog(recordId: string | null) {
  const [entries, setEntries] = useState<ChangeLogEntry[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!recordId) { setEntries([]); return; }
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("audit_change_log")
        .select("*")
        .eq("record_id", recordId)
        .order("changed_at", { ascending: false });

      if (!error && data) {
        setEntries(data as ChangeLogEntry[]);
      } else {
        // Table may not exist yet — fail silently
        setEntries([]);
      }
    } catch {
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [recordId]);

  useEffect(() => { load(); }, [load]);

  return { entries, loading, reload: load };
}

// ─── Helper: insert change log entries (best-effort, never throws) ────────────

export const FIELD_LABELS: Record<string, string> = {
  // ── audit_status fields ──────────────────────────────────────────────────────
  party_name:                    "Party Name",
  physical_audit_conducted:      "Physical Audit",
  accounting_data:               "Accounting Data",
  audit_employees:               "Audit Employees",
  audit_report_prepared_by:      "Report Prepared By",
  audit_report_checked_by:       "Report Checked By",
  audit_status:                  "Audit Status",
  audit_status_other:            "Audit Status (Other)",
  report_print_date:             "Report Print Date",
  firm:                          "Firm",
  partner:                       "Partner",
  udin_tax_audit:                "UDIN (Tax)",
  udin_statutory_audit:          "UDIN (Statutory)",
  udin_date:                     "UDIN Date",
  physical_report_received_date: "Physical Report Received",
  scanned:                       "Scanned",
  prepared_by:                   "3CA Prepared By",
  checked_by:                    "3CA Checked By",
  uploaded_by:                   "3CA Uploaded By",
  upload_date:                   "3CA Upload Date",
  remarks:                       "Remarks",
  remarks_other:                 "Remarks (Other)",
  client_id:                     "Client",
  engagement_id:                 "Engagement",
  // ── audit_communication fields ───────────────────────────────────────────────
  client_name:                   "Client",
  audit_planned_from:            "Audit Planned From",
  audit_planned_to:              "Audit Planned To",
  contact_person:                "Contact Person",
  contact_no:                    "Contact No",
  // ── audit_planning fields ────────────────────────────────────────────────────
  planned_from:                  "Planned From",
  planned_to:                    "Planned To",
  employee_names:                "Audit Employees",
};

export async function logChanges(
  tableName:      string,
  recordId:       string,
  oldRow:         Record<string, any>,
  patch:          Record<string, any>,
  changedById:    string | null | undefined,
  changedByName:  string | null | undefined,
): Promise<void> {
  const entries: any[] = [];

  for (const [field, newVal] of Object.entries(patch)) {
    const oldVal = oldRow[field];
    const oldStr = oldVal == null ? null : String(oldVal);
    const newStr = newVal == null ? null : String(newVal);
    if (oldStr === newStr) continue;

    entries.push({
      table_name:      tableName,
      record_id:       recordId,
      field_name:      field,
      field_label:     FIELD_LABELS[field] ?? field,
      old_value:       oldStr,
      new_value:       newStr,
      changed_by:      changedById    ?? null,
      changed_by_name: changedByName  ?? null,
    });
  }

  if (entries.length === 0) return;

  try {
    await supabase.from("audit_change_log").insert(entries);
  } catch {
    // Table may not exist — fail silently; app still works
  }
}
