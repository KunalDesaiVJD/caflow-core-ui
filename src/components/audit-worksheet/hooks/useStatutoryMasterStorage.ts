/**
 * useStatutoryMasterStorage
 *
 * Manages the Statutory Audit Master form data stored as JSON in
 * audit_worksheet_master.statutory_master_json (jsonb column).
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

export interface StatutoryMasterData {
  // Audit Carried Out By — dynamic list
  audit_carried_by: { id: string; name: string }[];

  // Section 6 — Accountant contact
  accountant_name: string;
  mobile_no:       string;

  // Section 7 — Previous Year documents
  prev_moa_aoa_deed: boolean;
  prev_it_return:    boolean;
  prev_audit_report: boolean;

  // Section 8 — Books verified (same checkboxes as Tax)
  books_cash_book:          boolean;
  books_bank_book:          boolean;
  books_journal_register:   boolean;
  books_general_ledger:     boolean;
  books_purchase:           boolean;
  books_sales_book:         boolean;
  books_stock_register:     boolean;
  books_others:             boolean;
  books_others_text:        string;

  // Section 9 — Audit dates
  audit_date_from: string;
  audit_date_to:   string;

  // Section 10 — CARO applicability (for companies)
  caro_applicable: "yes" | "no" | "";

  // Section 11 — Statutory Audit type
  audit_form_type: "Form of Report u/s 143(3)" | "Short-form Report" | "";

  // Section 12 — Payments to related parties
  payments_to_relatives: "yes" | "no" | "";

  // Section 13 — Secured / Unsecured loans
  secured_unsecured_loan: "yes" | "no" | "";

  // Sections 14-16 — Prepared / Verified / Reviewed
  audit_report_prepared_by_id:   string;
  audit_report_prepared_by_name: string;
  return_prepared_by_id:         string;
  return_prepared_by_name:       string;
  cd_prepared_by_id:             string;
  cd_prepared_by_name:           string;

  // Dates
  signed_copy_received:   string;
  management_repr_letter: string;
  appointment_letter:     string;

  // Footer
  ac_path:                 string;
  report_path:             string;
  footer_prepared_by_id:   string;
  footer_prepared_by_name: string;
  footer_verified_by_id:   string;
  footer_verified_by_name: string;
  footer_reviewed_by_id:   string;
  footer_reviewed_by_name: string;
}

export const BLANK_STATUTORY_MASTER: StatutoryMasterData = {
  audit_carried_by: [],
  accountant_name: "",
  mobile_no: "",
  prev_moa_aoa_deed: false,
  prev_it_return: false,
  prev_audit_report: false,
  books_cash_book: false,
  books_bank_book: false,
  books_journal_register: false,
  books_general_ledger: false,
  books_purchase: false,
  books_sales_book: false,
  books_stock_register: false,
  books_others: false,
  books_others_text: "",
  audit_date_from: "",
  audit_date_to: "",
  caro_applicable: "",
  audit_form_type: "",
  payments_to_relatives: "",
  secured_unsecured_loan: "",
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

export function useStatutoryMasterStorage(engagementId: string, firmId?: string | null) {
  const { user } = useAuth();
  const [data, setData]     = useState<StatutoryMasterData>(BLANK_STATUTORY_MASTER);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // See note in useTaxMasterStorage — userTypedRef tracks genuine user
  // typing only, so programmatic auto-fill never blocks the async DB load.
  const userTypedRef = useRef(false);
  const dataRef      = useRef<StatutoryMasterData>(BLANK_STATUTORY_MASTER);

  // ── Load ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!engagementId || loaded) return;
    setLoaded(true);
    const cached = awLoad<Partial<StatutoryMasterData>>(engagementId, "statutory_master_json");
    if (cached && typeof cached === "object" && Object.keys(cached).length > 0) {
      const merged = { ...BLANK_STATUTORY_MASTER, ...cached };
      setData(merged);
      dataRef.current = merged;
    }
    awLoadFromDB<Partial<StatutoryMasterData>>(engagementId, "statutory_master_json").then(remote => {
      if (userTypedRef.current) return;
      if (remote && typeof remote === "object" && Object.keys(remote).length > 0) {
        const merged = { ...BLANK_STATUTORY_MASTER, ...remote };
        setData(merged);
        dataRef.current = merged;
      }
    });
  }, [engagementId, loaded]);

  // Flush pending debounced save on unmount OR on the global "aw:flush"
  // event. ExportButtons dispatches "aw:flush" right before reading from
  // storage, so PDF/Excel exports always capture what the user just typed
  // — even when they click Export inside the 1-second debounce window.
  useEffect(() => {
    const flushNow = () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      try {
        awSave(engagementId, "statutory_master_json", dataRef.current, firmId, user?.id, user?.name || "");
      } catch { /* swallow */ }
    };
    window.addEventListener("aw:flush", flushNow);
    return () => {
      window.removeEventListener("aw:flush", flushNow);
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
        try {
          awSave(engagementId, "statutory_master_json", dataRef.current, firmId, user?.id, user?.name || "");
        } catch { /* swallow on unmount */ }
      }
    };
  }, [engagementId, firmId, user?.id, user?.name]);

  // ── Internal save ────────────────────────────────────────────────────────
  const persist = useCallback(
    async (snapshot: StatutoryMasterData, silent: boolean) => {
      setSaving(true);
      try {
        awSave(engagementId, "statutory_master_json", snapshot, firmId, user?.id, user?.name || "");
        if (!silent) toast.success("Statutory Audit Master saved");
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
    <K extends keyof StatutoryMasterData>(field: K, value: StatutoryMasterData[K]) => {
      userTypedRef.current = true;
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

  const patchFields = useCallback(
    (patch: Partial<StatutoryMasterData>) => {
      userTypedRef.current = true;
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

  // Programmatic patch — does NOT flip userTypedRef so async DB load can
  // still apply server data after auto-fill effects mutate state.
  const programmaticPatch = useCallback(
    (patch: Partial<StatutoryMasterData>) => {
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

  // Use dataRef so clicking Save while a debounced edit is still in flight
  // persists the freshest data, not a stale closure copy.
  const manualSave = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    return persist(dataRef.current, false);
  }, [persist]);

  return { data, setField, patchFields, programmaticPatch, manualSave, saving, loaded };
}
