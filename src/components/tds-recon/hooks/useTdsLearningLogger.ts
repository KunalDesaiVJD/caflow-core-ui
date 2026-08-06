/**
 * useTdsLearningLogger
 *
 * Shared capture point for the TDS Analytics learning engine
 * (supabase/migrations/20260807010000_tds_analytics_learning_engine.sql).
 * Every manual action worth learning from — a mapping confirm/override, a
 * per-voucher section classification, etc. — is logged here as one
 * `tds_learning_events` row. A DB trigger (apply_tds_learning_event) does
 * the actual pattern aggregation; this file's only job is to log the event
 * correctly and never impact the caller.
 *
 * Fire-and-forget by design: callers should NOT await logTdsLearningEvent.
 * A logging failure must never surface to the user or roll back the mutation
 * it's attached to — the append-only table is best-effort observability,
 * not a transactional guarantee.
 */
import { supabase } from "@/integrations/supabase/client";

export type TdsLearningEventType =
  | "party_mapping_change" | "ledger_mapping_change" | "section_override"
  | "voucher_classification" | "reconciliation_correction" | "calculation_adjustment"
  | "vendor_treatment_change" | "entry_booking_correction"
  | "ai_suggestion_accepted" | "ai_suggestion_rejected" | "ai_suggestion_modified"
  | "manual_override";

export type TdsPatternType =
  | "party_section_mapping" | "ledger_selection" | "vendor_treatment"
  | "voucher_classification_rule" | "reconciliation_approach" | "calculation_preference";

export type TdsLearningSource = "manual" | "ai_accepted" | "ai_overridden";

export interface TdsLearningEventInput {
  clientId:          string;
  firmId:            string;
  financialYear:     string;
  engagementId?:     string | null;
  eventType:         TdsLearningEventType;
  entityType:        string;
  entityId?:         string | null;
  patternType:       TdsPatternType;
  patternKey:        string;
  beforeValue?:      unknown;
  afterValue:        unknown;
  aiSuggestedValue?: unknown;
  aiConfidence?:     number | null;
  aiMethod?:         string | null;
  source?:           TdsLearningSource;
}

/** lower + trim + collapse whitespace — mirrors the DB-side normalize trigger. */
export function normalizeTdsPatternFragment(s: string | null | undefined): string {
  return (s ?? "").toLowerCase().trim().replace(/\s+/g, " ");
}

export function logTdsLearningEvent(input: TdsLearningEventInput): void {
  if (!input.clientId || !input.firmId || !input.financialYear || !input.patternKey) return;
  void (async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await (supabase as any).from("tds_learning_events").insert({
        client_id:          input.clientId,
        firm_id:            input.firmId,
        financial_year:     input.financialYear,
        engagement_id:      input.engagementId ?? null,
        event_type:         input.eventType,
        entity_type:        input.entityType,
        entity_id:          input.entityId ?? null,
        pattern_type:       input.patternType,
        pattern_key:        input.patternKey,
        before_value:       input.beforeValue ?? null,
        after_value:        input.afterValue,
        ai_suggested_value: input.aiSuggestedValue ?? null,
        ai_confidence:      input.aiConfidence ?? null,
        ai_method:          input.aiMethod ?? null,
        source:             input.source ?? "manual",
        created_by:         user?.id ?? null,
      });
      if (error) console.warn("[tds-learning] capture failed:", error.message);
    } catch (e) {
      console.warn("[tds-learning] capture failed:", e);
    }
  })();
}
