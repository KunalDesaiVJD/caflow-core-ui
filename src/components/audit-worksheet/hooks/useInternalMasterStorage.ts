/**
 * useInternalMasterStorage
 *
 * Manages the Internal Audit Master form data stored as JSON in
 * audit_worksheet_master.int_master_json (jsonb column).
 *
 * Features:
 *  - Loads on mount from Supabase
 *  - Auto-saves with 1-second debounce on every field change
 *  - setField()    — update a single field
 *  - patchFields() — update multiple fields at once
 *  - manualSave()  — explicit Save button
 */
import { useState, useEffect, useCallback, useRef } from "react";
import { toast } from "sonner";
import { awLoad, awSave } from "@/lib/awStorage";

// ─── Data shape ──────────────────────────────────────────────────────────────

export interface InternalMasterData {
  // Field 5 — Contact info (same 2-col layout as Tax)
  accountant_name: string;
  mobile_no:       string;
  bank_ac_no:      string;
  bank_branch:     string;

  // Field 6 — Previous year documents (single checkbox)
  prev_it_return: boolean;

  // Field 7 — Books of Accounts (same 8-checkbox set as Tax)
  books_cash_book:        boolean;
  books_bank_book:        boolean;
  books_journal_register: boolean;
  books_general_ledger:   boolean;
  books_purchase:         boolean;
  books_sales_book:       boolean;
  books_stock_register:   boolean;
  books_others:           boolean;
  books_others_text:      string;

  // Field 8 — Utilisation Certificates (free text)
  utilisation_certificates: string;

  // Field 9 — Audit dates
  audit_date_from: string;
  audit_date_to:   string;

  // Field 10 — Audit Carried Out By (team of 4)
  auditor1_id:   string;
  auditor1_name: string;
  auditor2_id:   string;
  auditor2_name: string;
  auditor3_id:   string;
  auditor3_name: string;
  auditor4_id:   string;
  auditor4_name: string;

  // Field 11 — GST Details (no YES/NO — direct fields)
  gst_id:       string;
  gst_password: string;

  // Field 12 — Secured/Unsecured Loan (free text)
  secured_unsecured_loan: string;

  // Field 13 — Audit Report Prepared By
  audit_report_prepared_by_id:   string;
  audit_report_prepared_by_name: string;

  // Footer
  footer_verified_by_id:   string;
  footer_verified_by_name: string;
  ac_path:     string;
  report_path: string;
}

export const BLANK_INT_MASTER: InternalMasterData = {
  accountant_name: "",
  mobile_no:       "",
  bank_ac_no:      "",
  bank_branch:     "",

  prev_it_return: false,

  books_cash_book:        false,
  books_bank_book:        false,
  books_journal_register: false,
  books_general_ledger:   false,
  books_purchase:         false,
  books_sales_book:       false,
  books_stock_register:   false,
  books_others:           false,
  books_others_text:      "",

  utilisation_certificates: "",

  audit_date_from: "",
  audit_date_to:   "",

  auditor1_id:   "",
  auditor1_name: "",
  auditor2_id:   "",
  auditor2_name: "",
  auditor3_id:   "",
  auditor3_name: "",
  auditor4_id:   "",
  auditor4_name: "",

  gst_id:       "",
  gst_password: "",

  secured_unsecured_loan: "",

  audit_report_prepared_by_id:   "",
  audit_report_prepared_by_name: "",

  footer_verified_by_id:   "",
  footer_verified_by_name: "",
  ac_path:     "",
  report_path: "",
};

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useInternalMasterStorage(
  engagementId: string,
  firmId?: string | null
) {
  const [data, setData]     = useState<InternalMasterData>(BLANK_INT_MASTER);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Load ───────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!engagementId || loaded) return;
    const saved = awLoad<Partial<InternalMasterData>>(engagementId, "int_master_json");
    if (saved && typeof saved === "object" && Object.keys(saved).length > 0) {
      setData({ ...BLANK_INT_MASTER, ...saved });
    }
    setLoaded(true);
  }, [engagementId, loaded]);

  // ── Persist ────────────────────────────────────────────────────────────────
  const persist = useCallback(
    async (snapshot: InternalMasterData, silent: boolean) => {
      setSaving(true);
      try {
        awSave(engagementId, "int_master_json", snapshot);
        if (!silent) toast.success("Internal Audit Master saved");
      } catch (e: any) {
        if (!silent) toast.error(e.message || "Failed to save");
      } finally {
        setSaving(false);
      }
    },
    [engagementId]
  );

  // ── setField — single field + debounced auto-save ──────────────────────────
  const setField = useCallback(
    <K extends keyof InternalMasterData>(field: K, value: InternalMasterData[K]) => {
      setData(prev => {
        const next = { ...prev, [field]: value };
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => persist(next, true), 1000);
        return next;
      });
    },
    [persist]
  );

  // ── patchFields — multiple fields + debounced auto-save ───────────────────
  const patchFields = useCallback(
    (patch: Partial<InternalMasterData>) => {
      setData(prev => {
        const next = { ...prev, ...patch };
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => persist(next, true), 1000);
        return next;
      });
    },
    [persist]
  );

  // ── manualSave ─────────────────────────────────────────────────────────────
  const manualSave = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    return persist(data, false);
  }, [data, persist]);

  return { data, setField, patchFields, manualSave, saving, loaded };
}
