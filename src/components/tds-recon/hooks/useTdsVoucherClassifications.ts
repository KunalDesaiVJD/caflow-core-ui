/**
 * useTdsVoucherClassifications
 *
 * Feeds the "Split by voucher" drill-down inside the Party Mappings panel
 * (Scenario 1 — voucher-level section override) with:
 *
 *   • Every tally voucher posted against a mapping's TB ledger
 *   • The auditor's per-voucher classification decisions
 *     (section_code_override, is_tds_applicable, notes, exclusion_reason)
 *
 * The hook is intentionally tolerant of a not-yet-migrated backend:
 *   • If tds_voucher_classification is missing, `classifications` is empty
 *     and the UI simply renders every voucher with the mapping's default
 *     section — no crash, no toast.
 *   • If tally_vouchers is empty for a ledger (fresh sync, wrong FY,
 *     etc.), the panel shows a "No vouchers found" state.
 *
 * Cross-cutting notes
 * ───────────────────
 * • On Re-Tally-Sync new vouchers appear here automatically because we
 *   re-query `tally_vouchers` every time the hook mounts / mapping id
 *   changes. Classifications persist through those re-syncs.
 * • The mutate helpers are optimistic — they patch local state first
 *   and roll back on any Supabase error so bulk-tagging feels
 *   instantaneous even on a slow connection.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { logTdsLearningEvent, normalizeTdsPatternFragment } from "./useTdsLearningLogger";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface VoucherRow {
  id:              string;
  voucher_date:    string | null;
  voucher_type:    string | null;
  voucher_number:  string | null;
  narration:       string | null;
  amount:          number | null;
  party_ledger:    string | null;
  line_items:      Array<{ ledger_name: string; amount: number; dr_cr: string }>;
  this_amount:     number | null;
  this_dr_cr:      string | null;
}

export interface VoucherClassification {
  id:                          string;
  voucher_id:                  string;
  section_code_override:       string | null;
  tds_deductee_name_override:  string | null;
  is_tds_applicable:           boolean;
  exclusion_reason:            string | null;
  notes:                       string | null;
  updated_at:                  string;
}

export interface ClassifiedVoucher {
  voucher:         VoucherRow;
  classification:  VoucherClassification | null;
  effectiveSection: string | null;   // override ?? mapping.section
  applicable:      boolean;          // classification.is_tds_applicable ?? true
}

export interface UseTdsVoucherClassificationsResult {
  rows:            ClassifiedVoucher[];
  loading:         boolean;
  error:           string | null;
  openingBalance:  number;
  openingType:     "Dr" | "Cr";
  refresh:         () => Promise<void>;
  updateOne:       (voucherId: string, patch: Partial<Omit<VoucherClassification, "id" | "voucher_id" | "updated_at">>) => Promise<void>;
  bulkAssign:      (voucherIds: string[], sectionCode: string | null) => Promise<void>;
  clearOne:        (voucherId: string) => Promise<void>;
  bulkClear:       (voucherIds: string[]) => Promise<void>;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useTdsVoucherClassifications(params: {
  enabled:        boolean;
  clientId:       string | null | undefined;
  firmId:         string | null | undefined;
  financialYear:  string | null | undefined;
  engagementId:   string | null | undefined;
  mappingId:      string | null | undefined;
  tbLedgerName:   string | null | undefined;
  defaultSection: string | null | undefined;   // mapping.tds_section_code
}): UseTdsVoucherClassificationsResult {
  const {
    enabled, clientId, firmId, financialYear, engagementId,
    mappingId, tbLedgerName, defaultSection,
  } = params;

  const [vouchers,        setVouchers]        = useState<VoucherRow[]>([]);
  const [classifications, setClassifications] = useState<Map<string, VoucherClassification>>(new Map());
  const [loading,         setLoading]         = useState(false);
  const [error,           setError]           = useState<string | null>(null);
  const [openingBalance,  setOpeningBalance]  = useState(0);
  const [openingType,     setOpeningType]     = useState<"Dr" | "Cr">("Dr");

  const load = useCallback(async () => {
    if (!enabled || !clientId || !financialYear || !mappingId || !tbLedgerName) {
      setVouchers([]); setClassifications(new Map()); setLoading(false); return;
    }
    setLoading(true); setError(null);

    // 1. Resolve the tally engagement id (accepts the parent-provided
    //    engagementId; falls back to tally_trial_balance if absent, using the
    //    same fallback chain LedgerVouchersView uses).
    let engId: string | null = engagementId ?? null;
    if (!engId) {
      try {
        const { data } = await (supabase as any)
          .from("tally_trial_balance")
          .select("engagement_id")
          .eq("client_id", clientId)
          .eq("financial_year", financialYear)
          .eq("ledger_name", tbLedgerName)
          .limit(1)
          .maybeSingle();
        engId = (data as any)?.engagement_id ?? null;
      } catch { /* fall through */ }
    }
    if (!engId) {
      try {
        const { data } = await (supabase as any)
          .from("tally_trial_balance")
          .select("engagement_id")
          .eq("client_id", clientId)
          .eq("financial_year", financialYear)
          .limit(1)
          .maybeSingle();
        engId = (data as any)?.engagement_id ?? null;
      } catch { /* fall through */ }
    }

    // 2. Opening balance for the running-balance column — same table/columns
    //    LedgerVouchersView reads, scoped to whichever engagement we resolved.
    if (engId) {
      try {
        const { data } = await (supabase as any)
          .from("tally_trial_balance")
          .select("opening_balance,opening_type")
          .eq("engagement_id", engId)
          .eq("ledger_name", tbLedgerName)
          .maybeSingle();
        setOpeningBalance(Number((data as any)?.opening_balance ?? 0));
        setOpeningType(((data as any)?.opening_type === "Cr" ? "Cr" : "Dr"));
      } catch {
        setOpeningBalance(0); setOpeningType("Dr");
      }
    } else {
      setOpeningBalance(0); setOpeningType("Dr");
    }

    // 3. Vouchers — prefer the same RPC LedgerVouchersView uses.
    let voucherRows: VoucherRow[] = [];
    if (engId) {
      try {
        const { data, error: rpcErr } = await (supabase as any).rpc("get_ledger_vouchers", {
          p_engagement_id: engId,
          p_ledger_name:   tbLedgerName,
        });
        if (rpcErr) throw rpcErr;
        voucherRows = (data ?? []) as VoucherRow[];
      } catch (e: any) {
        // If the RPC isn't available in this env, fall back to a direct query.
        try {
          const rows: any[] = [];
          const PAGE = 1000;
          for (let from = 0; ; from += PAGE) {
            const { data, error: qErr } = await (supabase as any)
              .from("tally_vouchers")
              .select("id, voucher_date, voucher_type, voucher_number, narration, amount, party_ledger, line_items")
              .eq("engagement_id", engId)
              .or(`party_ledger.eq.${tbLedgerName},line_items.cs.[{"ledger_name":"${tbLedgerName}"}]`)
              .range(from, from + PAGE - 1);
            if (qErr || !data || data.length === 0) break;
            rows.push(...data);
            if (data.length < PAGE) break;
          }
          voucherRows = rows as VoucherRow[];
        } catch (e2: any) {
          setError(`Failed to load vouchers: ${e2?.message ?? e?.message ?? String(e)}`);
        }
      }
    }

    // 4. Classifications — silently ignore "relation does not exist"
    //    (migration not yet applied on this environment).
    const classMap = new Map<string, VoucherClassification>();
    try {
      const { data, error: cErr } = await (supabase as any)
        .from("tds_voucher_classification")
        .select("id, voucher_id, section_code_override, tds_deductee_name_override, is_tds_applicable, exclusion_reason, notes, updated_at")
        .eq("client_id", clientId)
        .eq("financial_year", financialYear)
        .eq("mapping_id", mappingId);
      if (!cErr && Array.isArray(data)) {
        for (const c of data as VoucherClassification[]) {
          classMap.set(c.voucher_id, c);
        }
      }
    } catch { /* table missing — non-fatal */ }

    setVouchers(voucherRows);
    setClassifications(classMap);
    setLoading(false);
  }, [enabled, clientId, financialYear, engagementId, mappingId, tbLedgerName]);

  useEffect(() => { void load(); }, [load]);

  // Latest vouchers, readable from inside upsertRow/clearRow without adding
  // `vouchers` to their dependency arrays.
  const vouchersRef = useRef<VoucherRow[]>(vouchers);
  useEffect(() => { vouchersRef.current = vouchers; }, [vouchers]);

  // ── Mutations (optimistic + roll-back on error) ─────────────────────────────

  const upsertRow = useCallback(async (voucherId: string, patch: Partial<Omit<VoucherClassification, "id" | "voucher_id" | "updated_at">>) => {
    if (!clientId || !firmId || !financialYear || !mappingId || !tbLedgerName) return;
    const prev = classifications.get(voucherId) ?? null;
    // Optimistic apply
    setClassifications(m => {
      const next = new Map(m);
      next.set(voucherId, {
        id: prev?.id ?? "pending",
        voucher_id: voucherId,
        section_code_override:       patch.section_code_override      ?? prev?.section_code_override       ?? null,
        tds_deductee_name_override:  patch.tds_deductee_name_override ?? prev?.tds_deductee_name_override ?? null,
        is_tds_applicable:           patch.is_tds_applicable          ?? prev?.is_tds_applicable          ?? true,
        exclusion_reason:            patch.exclusion_reason           ?? prev?.exclusion_reason           ?? null,
        notes:                       patch.notes                      ?? prev?.notes                      ?? null,
        updated_at:                  new Date().toISOString(),
      });
      return next;
    });
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const row = {
        client_id: clientId, firm_id: firmId, financial_year: financialYear,
        engagement_id: engagementId ?? null,
        mapping_id: mappingId, voucher_id: voucherId, tb_ledger_name: tbLedgerName,
        section_code_override:      patch.section_code_override      ?? prev?.section_code_override      ?? null,
        tds_deductee_name_override: patch.tds_deductee_name_override ?? prev?.tds_deductee_name_override ?? null,
        is_tds_applicable:          patch.is_tds_applicable          ?? prev?.is_tds_applicable          ?? true,
        exclusion_reason:           patch.exclusion_reason           ?? prev?.exclusion_reason           ?? null,
        notes:                      patch.notes                      ?? prev?.notes                      ?? null,
        updated_by:                 user?.id ?? null,
        ...(prev ? {} : { created_by: user?.id ?? null }),
      };
      const { error: upErr } = await (supabase as any)
        .from("tds_voucher_classification")
        .upsert(row, { onConflict: "client_id,financial_year,voucher_id,tb_ledger_name" });
      if (upErr) throw upErr;
      // Refresh in the background so we pick up the real row id.
      void load();

      // Learning capture — per-voucher section overrides are how the
      // auditor tells the module "vouchers like this one, under this
      // ledger, actually belong to a different section than the mapping
      // default." Keyed by voucher_type so the pattern generalizes across
      // future vouchers of the same kind under the same ledger.
      if (row.section_code_override) {
        const voucher = vouchersRef.current.find(v => v.id === voucherId);
        logTdsLearningEvent({
          clientId, firmId, financialYear, engagementId,
          eventType: "voucher_classification",
          entityType: "tds_voucher_classification", entityId: voucherId,
          patternType: "voucher_classification_rule",
          patternKey: `ledger:${normalizeTdsPatternFragment(tbLedgerName)}:vch:${normalizeTdsPatternFragment(voucher?.voucher_type ?? "unknown")}`,
          beforeValue: { section: prev?.section_code_override ?? defaultSection ?? null },
          afterValue: { section: row.section_code_override },
          source: "manual",
        });
      }
    } catch (e: any) {
      // Roll back
      setClassifications(m => {
        const next = new Map(m);
        if (prev) next.set(voucherId, prev); else next.delete(voucherId);
        return next;
      });
      setError(`Failed to save classification: ${e?.message ?? String(e)}`);
    }
  }, [clientId, firmId, financialYear, engagementId, mappingId, tbLedgerName, classifications, load]);

  const clearRow = useCallback(async (voucherId: string) => {
    if (!clientId || !financialYear) return;
    const prev = classifications.get(voucherId) ?? null;
    setClassifications(m => { const next = new Map(m); next.delete(voucherId); return next; });
    try {
      const { error: dErr } = await (supabase as any)
        .from("tds_voucher_classification")
        .delete()
        .eq("client_id", clientId)
        .eq("financial_year", financialYear)
        .eq("voucher_id", voucherId)
        .eq("tb_ledger_name", tbLedgerName);
      if (dErr) throw dErr;

      // Learning capture — only when there was an actual override to
      // revert; clearing a row with no prior override is a no-op with
      // nothing to learn from.
      if (prev?.section_code_override && firmId) {
        const voucher = vouchersRef.current.find(v => v.id === voucherId);
        logTdsLearningEvent({
          clientId, firmId, financialYear, engagementId,
          eventType: "voucher_classification",
          entityType: "tds_voucher_classification", entityId: voucherId,
          patternType: "voucher_classification_rule",
          patternKey: `ledger:${normalizeTdsPatternFragment(tbLedgerName)}:vch:${normalizeTdsPatternFragment(voucher?.voucher_type ?? "unknown")}`,
          beforeValue: { section: prev.section_code_override },
          afterValue: { section: defaultSection ?? null },
          source: "manual",
        });
      }
    } catch (e: any) {
      // Roll back
      if (prev) setClassifications(m => new Map(m).set(voucherId, prev));
      setError(`Failed to clear classification: ${e?.message ?? String(e)}`);
    }
  }, [clientId, firmId, financialYear, engagementId, tbLedgerName, defaultSection, classifications]);

  const bulkAssign = useCallback(async (voucherIds: string[], sectionCode: string | null) => {
    for (const id of voucherIds) {
      // Sequential so an error mid-stream still leaves state consistent.
      await upsertRow(id, { section_code_override: sectionCode });
    }
  }, [upsertRow]);

  const bulkClear = useCallback(async (voucherIds: string[]) => {
    for (const id of voucherIds) {
      await clearRow(id);
    }
  }, [clearRow]);

  // ── Merge ──────────────────────────────────────────────────────────────────

  const rows: ClassifiedVoucher[] = vouchers.map(v => {
    const c = classifications.get(v.id) ?? null;
    const effectiveSection = (c?.section_code_override && c.section_code_override !== "")
      ? c.section_code_override
      : (defaultSection ?? null);
    const applicable = c ? c.is_tds_applicable : true;
    return { voucher: v, classification: c, effectiveSection, applicable };
  });

  return {
    rows, loading, error,
    openingBalance, openingType,
    refresh: load,
    updateOne: (voucherId, patch) => upsertRow(voucherId, patch),
    bulkAssign,
    clearOne: (voucherId) => clearRow(voucherId),
    bulkClear,
  };
}
