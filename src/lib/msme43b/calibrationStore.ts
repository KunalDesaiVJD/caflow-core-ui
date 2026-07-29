// MSME 43B(h) — persistence for the calibration loop.
//
// Stores the client's rule profile, the append-only audit trail of rule
// changes, and the signed-off runs (goldens) that every future rule proposal is
// replayed against.
//
// Fails soft the same way persistence.ts does: if the migration has not been
// applied yet the page still works, it just cannot remember what it learns.
//
// SAFETY: validateProfile() runs on the way IN and on the way OUT. A profile
// row that has been hand-edited in the database to hold a value the rule space
// never offered is refused rather than applied.

import { supabase } from '@/integrations/supabase/client';
import type { VendorLedger, Msme43bReport } from './types';
import type { Msme43bConfig } from './config';
import { type RuleProfile, emptyProfile, validateProfile } from './rules';
import type { GoldenCase } from './calibrate';
import { normVendor } from './engine';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = (table: string) => (supabase as any).from(table);

export interface StoreResult<T> {
  data: T | null;
  error: string | null;
  /** true when the tables do not exist yet (migration not applied) */
  unavailable: boolean;
}

function isMissingTable(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return error.code === '42P01' ||
    /relation .*msme_43b_(rule_profiles|rule_changes|goldens).* does not exist/i.test(error.message || '') ||
    /Could not find the table/i.test(error.message || '');
}

const ok = <T>(data: T): StoreResult<T> => ({ data, error: null, unavailable: false });
const fail = <T>(error: { code?: string; message?: string }): StoreResult<T> =>
  ({ data: null, error: error.message || 'Unknown error', unavailable: isMissingTable(error) });

// ────────────────────────────────────────────────────────────────────────────
//  Rule profile
// ────────────────────────────────────────────────────────────────────────────

export async function loadRuleProfile(clientId: string): Promise<StoreResult<RuleProfile>> {
  const { data, error } = await db('msme_43b_rule_profiles')
    .select('overrides, vendor_windows, revision')
    .eq('client_id', clientId)
    .maybeSingle();
  if (error) return fail(error);
  if (!data) return ok(emptyProfile(clientId));

  const profile: RuleProfile = {
    clientId,
    overrides: data.overrides ?? {},
    vendorWindows: data.vendor_windows ?? [],
    revision: data.revision ?? 0,
    history: [],
  };

  // Refuse a stored profile that is not entirely within the rule space.
  const errors = validateProfile(profile);
  if (errors.length) {
    return {
      data: emptyProfile(clientId),
      error: `Saved rule profile rejected — ${errors.join(' ')} Falling back to the standard interpretation.`,
      unavailable: false,
    };
  }
  return ok(profile);
}

export interface SaveProfileInput {
  clientId: string;
  firmId?: string | null;
  userId?: string | null;
  userName?: string | null;
  profile: RuleProfile;
  /** the working paper that prompted the change, recorded on the audit trail */
  sourceFile?: string;
  matchedBefore?: number;
  matchedAfter?: number;
}

export async function saveRuleProfile(input: SaveProfileInput): Promise<StoreResult<true>> {
  const errors = validateProfile(input.profile);
  if (errors.length) {
    return { data: null, error: `Refusing to save: ${errors.join(' ')}`, unavailable: false };
  }

  const row = {
    firm_id: input.firmId ?? null,
    client_id: input.clientId,
    overrides: input.profile.overrides,
    vendor_windows: input.profile.vendorWindows,
    revision: input.profile.revision,
    updated_by: input.userId ?? null,
    updated_by_name: input.userName ?? null,
    updated_at: new Date().toISOString(),
  };

  const { error } = await db('msme_43b_rule_profiles')
    .upsert(row, { onConflict: 'client_id' });
  if (error) return fail(error);

  // Audit trail — one row per change accepted in this session.
  const changes = input.profile.history.map((h) => ({
    firm_id: input.firmId ?? null,
    client_id: input.clientId,
    rule_key: h.key,
    from_value: h.from,
    to_value: h.to,
    reason: h.reason,
    matched_before: h.matchedBefore ?? input.matchedBefore ?? null,
    matched_after: h.matchedAfter ?? input.matchedAfter ?? null,
    source_file: input.sourceFile ?? null,
    changed_by: input.userId ?? null,
    changed_by_name: input.userName ?? null,
  }));
  if (changes.length) {
    const { error: auditError } = await db('msme_43b_rule_changes').insert(changes);
    if (auditError) return fail(auditError);
  }

  return ok(true as const);
}

export interface RuleChangeRow {
  id: string;
  rule_key: string;
  from_value: unknown;
  to_value: unknown;
  reason: string | null;
  matched_before: number | null;
  matched_after: number | null;
  source_file: string | null;
  changed_by_name: string | null;
  created_at: string;
}

export async function listRuleChanges(clientId: string): Promise<StoreResult<RuleChangeRow[]>> {
  const { data, error } = await db('msme_43b_rule_changes')
    .select('id, rule_key, from_value, to_value, reason, matched_before, matched_after, source_file, changed_by_name, created_at')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false });
  if (error) return fail(error);
  return ok((data ?? []) as RuleChangeRow[]);
}

// ────────────────────────────────────────────────────────────────────────────
//  Signed-off runs (goldens)
// ────────────────────────────────────────────────────────────────────────────

export interface SaveGoldenInput {
  clientId: string;
  firmId?: string | null;
  userId?: string | null;
  userName?: string | null;
  label: string;
  report: Msme43bReport;
  cyLedgers: VendorLedger[];
  fyLedgers: VendorLedger[];
  config: Msme43bConfig;
  vendorWindows?: Record<string, number>;
}

/**
 * Record a run the reviewer has confirmed is correct. The ledgers are stored
 * alongside the blessed figures so the case can be REPLAYED — a golden that
 * only remembered its numbers could not tell you whether a new rule broke it.
 */
export async function saveGolden(input: SaveGoldenInput): Promise<StoreResult<string>> {
  const blessed: Record<string, number> = {};
  for (const v of input.report.vendors) blessed[normVendor(v.vendorName)] = v.totalDisallowedCY;

  const row = {
    firm_id: input.firmId ?? null,
    client_id: input.clientId,
    label: input.label,
    cy_label: input.report.cyLabel,
    fy_label: input.report.fyLabel,
    cy_ledgers: input.cyLedgers,
    fy_ledgers: input.fyLedgers,
    blessed,
    config: input.config,
    vendor_windows: input.vendorWindows ?? {},
    signed_off_by: input.userId ?? null,
    signed_off_by_name: input.userName ?? null,
  };

  const { data, error } = await db('msme_43b_goldens').insert(row).select('id').single();
  if (error) return fail(error);
  return ok(data.id as string);
}

export interface GoldenSummary {
  id: string;
  label: string;
  cy_label: string;
  fy_label: string | null;
  signed_off_by_name: string | null;
  created_at: string;
  vendorCount: number;
}

export async function listGoldenSummaries(clientId: string): Promise<StoreResult<GoldenSummary[]>> {
  const { data, error } = await db('msme_43b_goldens')
    .select('id, label, cy_label, fy_label, blessed, signed_off_by_name, created_at')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false });
  if (error) return fail(error);
  const rows = (data ?? []).map((r: Record<string, unknown>) => ({
    id: r.id as string,
    label: r.label as string,
    cy_label: r.cy_label as string,
    fy_label: (r.fy_label as string) ?? null,
    signed_off_by_name: (r.signed_off_by_name as string) ?? null,
    created_at: r.created_at as string,
    vendorCount: Object.keys((r.blessed as object) ?? {}).length,
  }));
  return ok(rows);
}

/** Load the full golden cases (with ledgers) so the calibrator can replay them. */
export async function loadGoldens(clientId: string): Promise<StoreResult<GoldenCase[]>> {
  const { data, error } = await db('msme_43b_goldens')
    .select('id, label, cy_label, cy_ledgers, fy_ledgers, blessed, vendor_windows')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false });
  if (error) return fail(error);
  const cases: GoldenCase[] = (data ?? []).map((r: Record<string, unknown>) => ({
    id: r.id as string,
    label: r.label as string,
    cyLabel: r.cy_label as string,
    cyLedgers: (r.cy_ledgers as VendorLedger[]) ?? [],
    fyLedgers: (r.fy_ledgers as VendorLedger[]) ?? [],
    blessed: (r.blessed as Record<string, number>) ?? {},
    vendorWindows: (r.vendor_windows as Record<string, number>) ?? undefined,
  }));
  return ok(cases);
}

export async function deleteGolden(id: string): Promise<StoreResult<true>> {
  const { error } = await db('msme_43b_goldens').delete().eq('id', id);
  if (error) return fail(error);
  return ok(true as const);
}
