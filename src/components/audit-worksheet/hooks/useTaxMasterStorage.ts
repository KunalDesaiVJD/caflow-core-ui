/**
 * useTaxMasterStorage
 *
 * Manages the rich Tax Audit Master form data stored as JSON in
 * audit_worksheet_master.tax_master_json (jsonb column).
 *
 * Features:
 *  - Loads on mount from Supabase
 *  - Auto-saves with 1-second debounce on every field change
 *  - Exposes setField() for individual field updates
 *  - Exposes manualSave() for the explicit Save button
 */
import { useState, useEffect, useCallback, useRef } from "react";
import { toast } from "sonner";
import { awLoad, awSave, awLoadFromDB } from "@/lib/awStorage";
import { useAuth } from "@/hooks/useAuth";

// ─── Data shape ─────────────────────────────────────────────────────────────

export interface AuditorEntry {
  id:   string;  // employee UUID
  name: string;  // denormalised display name
}

export interface TaxMasterData {
  // Audit Carried Out By — dynamic list of auditors
  audit_carried_by: AuditorEntry[];

  // Kept for backward compat with existing localStorage data; NOT rendered in UI
  proprietor_partner_name: string;
  bank_ac_no: string;
  bank_branch: string;

  // Field 5 — Contact info
  accountant_name: string;
  mobile_no: string;

  // Field 7 — Previous year documents checkboxes
  prev_moa_aoa_deed: boolean;
  prev_it_return: boolean;

  // Field 8 — Books of Accounts checkboxes
  books_cash_book: boolean;
  books_bank_book: boolean;
  books_journal_register: boolean;
  books_general_ledger: boolean;
  books_purchase: boolean;
  books_sales_book: boolean;
  books_stock_register: boolean;
  books_others: boolean;
  books_others_text: string;

  // Field 9 — Stock Quantity Records
  stock_qty_records: "yes" | "no" | "";
  stock_qty_details: string;

  // Field 10 — Audit Dates
  audit_date_from: string;
  audit_date_to: string;

  // Field 11 — GST Details
  gst_details: "yes" | "no" | "";
  gst_id: string;
  gst_password: string;

  // Fields 12-14 — YES/NO flags
  payments_to_relatives: "yes" | "no" | "";
  secured_unsecured_loan: "yes" | "no" | "";
  deduction_details: "yes" | "no" | "";

  // Fields 15-17 — Employee assignments
  audit_report_prepared_by_id: string;
  audit_report_prepared_by_name: string;
  return_prepared_by_id: string;
  return_prepared_by_name: string;
  cd_prepared_by_id: string;
  cd_prepared_by_name: string;

  // Fields 18-20 — Dates
  signed_copy_received: string;
  management_repr_letter: string;
  appointment_letter: string;

  // Footer
  ac_path: string;
  report_path: string;
  footer_prepared_by_id: string;
  footer_prepared_by_name: string;
  footer_verified_by_id: string;
  footer_verified_by_name: string;
  footer_reviewed_by_id: string;
  footer_reviewed_by_name: string;
}

export const BLANK_TAX_MASTER: TaxMasterData = {
  audit_carried_by: [],
  proprietor_partner_name: "",
  accountant_name: "",
  mobile_no: "",
  bank_ac_no: "",
  bank_branch: "",
  prev_moa_aoa_deed: false,
  prev_it_return: false,
  books_cash_book: false,
  books_bank_book: false,
  books_journal_register: false,
  books_general_ledger: false,
  books_purchase: false,
  books_sales_book: false,
  books_stock_register: false,
  books_others: false,
  books_others_text: "",
  stock_qty_records: "",
  stock_qty_details: "",
  audit_date_from: "",
  audit_date_to: "",
  gst_details: "",
  gst_id: "",
  gst_password: "",
  payments_to_relatives: "",
  secured_unsecured_loan: "",
  deduction_details: "",
  audit_report_prepared_by_id: "",
  audit_report_prepared_by_name: "",
  return_prepared_by_id: "",
  return_prepared_by_name: "",
  cd_prepared_by_id: "",
  cd_prepared_by_name: "",
  signed_copy_received: "",
  management_repr_letter: "",
  appointment_letter: "",
  ac_path: "",
  report_path: "",
  footer_prepared_by_id: "",
  footer_prepared_by_name: "",
  footer_verified_by_id: "",
  footer_verified_by_name: "",
  footer_reviewed_by_id: "",
  footer_reviewed_by_name: "",
};

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useTaxMasterStorage(engagementId: string, firmId?: string | null) {
  const { user } = useAuth();
  const [data, setData]       = useState<TaxMasterData>(BLANK_TAX_MASTER);
  const [loaded, setLoaded]   = useState(false);
  const [saving, setSaving]   = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // User-interaction sentinel — once the user edits a field, the async
  // Supabase load must NOT overwrite their work. Without this guard, a
  // slow DB roundtrip that resolves after the first keystroke wipes the
  // accountant name / mobile no / etc. the user just typed.
  const userEditedRef = useRef(false);
  const dataRef       = useRef<TaxMasterData>(BLANK_TAX_MASTER);

  // ── Load ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!engagementId || loaded) return;
    setLoaded(true);
    const cached = awLoad<Partial<TaxMasterData>>(engagementId, "tax_master_json");
    if (cached && typeof cached === "object" && Object.keys(cached).length > 0) {
      const merged = { ...BLANK_TAX_MASTER, ...cached };
      setData(merged);
      dataRef.current = merged;
    }
    awLoadFromDB<Partial<TaxMasterData>>(engagementId, "tax_master_json").then(remote => {
      if (userEditedRef.current) return;                // user already typed — do not clobber
      if (remote && typeof remote === "object" && Object.keys(remote).length > 0) {
        const merged = { ...BLANK_TAX_MASTER, ...remote };
        setData(merged);
        dataRef.current = merged;
      }
    });
  }, [engagementId, loaded]);

  // ── Internal save ────────────────────────────────────────────────────────
  const persist = useCallback(
    async (snapshot: TaxMasterData, silent: boolean) => {
      setSaving(true);
      try {
        awSave(engagementId, "tax_master_json", snapshot, firmId, user?.id, user?.name || "");
        if (!silent) toast.success("Tax Audit Master saved");
      } catch (e: any) {
        if (!silent) toast.error(e.message || "Failed to save");
      } finally {
        setSaving(false);
      }
    },
    [engagementId]
  );

  // ── Set a single field + debounced auto-save ──────────────────────────────
  const setField = useCallback(
    <K extends keyof TaxMasterData>(field: K, value: TaxMasterData[K]) => {
      userEditedRef.current = true;
      setData(prev => {
        const next = { ...prev, [field]: value };
        dataRef.current = next;
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => persist(next, true), 1000);
        return next;
      });
    },
    [persist]
  );

  // ── Patch multiple fields at once + debounced auto-save ───────────────────
  const patchFields = useCallback(
    (patch: Partial<TaxMasterData>) => {
      userEditedRef.current = true;
      setData(prev => {
        const next = { ...prev, ...patch };
        dataRef.current = next;
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => persist(next, true), 1000);
        return next;
      });
    },
    [persist]
  );

  // ── Manual save (explicit button) ─────────────────────────────────────────
  // Reads from dataRef so it always persists the latest user input even when
  // invoked in the same tick as a trailing setField call (React state update
  // hasn't flushed into closure yet).
  const manualSave = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    return persist(dataRef.current, false);
  }, [persist]);

  return { data, setField, patchFields, manualSave, saving, loaded };
}
