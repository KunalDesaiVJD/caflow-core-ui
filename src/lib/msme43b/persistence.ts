// MSME 43B(h) — Supabase persistence: save / list / load / delete runs per client.
//
// The msme_43b_runs table is added by migration 20260728140000_msme_43b_runs.sql
// and is not yet in the generated Database types (types.ts is CLI-regenerated
// only), so access is via a localised cast. All calls fail soft: if the table is
// absent (migration not yet applied) the helpers surface a friendly flag rather
// than crashing the page.

import { supabase } from '@/integrations/supabase/client';
import { deriveBlockers } from './engine';
import type { Msme43bReport, VendorLedger } from './types';
import type { PanelReview } from './panelReview';

const TABLE = 'msme_43b_runs';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => (supabase as any).from(TABLE);

/**
 * Columns added by 20260730180000_msme_43b_run_session.sql. Everything that
 * touches them degrades to the base columns when the migration has not been
 * applied yet, so a stale schema costs the extras — never the run itself.
 */
const SESSION_COLUMNS = 'cy_ledgers, fy_ledgers, panel_review';

export interface Msme43bRunSummary {
  id: string;
  client_id: string;
  label: string | null;
  cy_label: string;
  fy_label: string | null;
  window_days: number;
  total_disallowed_cy: number;
  total_allowed_fy: number;
  total_still_outstanding: number;
  vendor_count: number;
  created_by_name: string | null;
  created_at: string;
}

export interface SaveRunInput {
  clientId: string;
  firmId?: string | null;
  userId?: string | null;
  userName?: string | null;
  label?: string | null;
  report: Msme43bReport;
  /**
   * The ledgers as extracted, stored with the run. They are what the accuracy
   * loop and the calibration replay need, and re-creating them means paying for
   * the Claude extraction of every PDF again.
   */
  cyLedgers?: VendorLedger[];
  fyLedgers?: VendorLedger[];
}

/** A saved run, restored whole — the state the reviewer left the page in. */
export interface Msme43bRunSession {
  report: Msme43bReport;
  cyLedgers: VendorLedger[];
  fyLedgers: VendorLedger[];
  panelReview: PanelReview | null;
}

export interface PersistResult<T> {
  data: T | null;
  error: string | null;
  /** true when the table does not exist yet (migration not applied) */
  unavailable: boolean;
}

function isMissingTable(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return error.code === '42P01' || /relation .*msme_43b_runs.* does not exist/i.test(error.message || '') ||
    /Could not find the table/i.test(error.message || '');
}

/**
 * The run-session migration has not been applied to this project yet. Postgres
 * says 42703; PostgREST answers from its schema cache with PGRST204 and a
 * different wording, so both are matched.
 */
function isMissingColumn(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const m = error.message || '';
  return error.code === '42703' || error.code === 'PGRST204' ||
    /column .* does not exist/i.test(m) ||
    /Could not find the '.*' column/i.test(m);
}

export async function saveRun(input: SaveRunInput): Promise<PersistResult<string>> {
  const { report } = input;
  const row = {
    firm_id: input.firmId ?? null,
    client_id: input.clientId,
    label: input.label?.trim() || null,
    cy_label: report.cyLabel,
    fy_label: report.fyLabel,
    window_days: report.windowDays,
    total_disallowed_cy: report.totalDisallowedCY,
    total_allowed_fy: report.totalAllowedFY,
    total_still_outstanding: report.totalStillOutstanding,
    vendor_count: report.vendors.length,
    report,
    created_by: input.userId ?? null,
    created_by_name: input.userName ?? null,
  };
  const withLedgers = {
    ...row,
    cy_ledgers: input.cyLedgers ?? null,
    fy_ledgers: input.fyLedgers ?? null,
  };

  let { data, error } = await db().insert(withLedgers).select('id').single();
  // Older schema: keep the run rather than lose it over the extra columns.
  if (error && isMissingColumn(error)) {
    ({ data, error } = await db().insert(row).select('id').single());
  }
  if (error) return { data: null, error: error.message, unavailable: isMissingTable(error) };
  return { data: data.id as string, error: null, unavailable: false };
}

export async function listRuns(clientId: string): Promise<PersistResult<Msme43bRunSummary[]>> {
  const { data, error } = await db()
    .select('id, client_id, label, cy_label, fy_label, window_days, total_disallowed_cy, total_allowed_fy, total_still_outstanding, vendor_count, created_by_name, created_at')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false });
  if (error) return { data: null, error: error.message, unavailable: isMissingTable(error) };
  return { data: (data ?? []) as Msme43bRunSummary[], error: null, unavailable: false };
}

/**
 * Runs saved before the sign-off blockers existed have no blocksSignOff /
 * blockingReasons in their stored JSON. Defaulting those to "false / none"
 * would silently present an old, unreconciled run as clean, so they are
 * recomputed from the stored vendor results using the same engine function.
 */
export function hydrateReport(raw: Msme43bReport): Msme43bReport {
  if (Array.isArray(raw.blockingReasons)) return raw;
  return { ...raw, ...deriveBlockers(raw.vendors ?? []) };
}

export async function loadRun(id: string): Promise<PersistResult<Msme43bReport>> {
  const { data, error } = await db().select('report').eq('id', id).single();
  if (error) return { data: null, error: error.message, unavailable: isMissingTable(error) };
  const raw = (data.report as Msme43bReport) ?? null;
  return { data: raw ? hydrateReport(raw) : null, error: null, unavailable: false };
}

/**
 * Restore a run whole: the report, the ledgers it was computed from, and the
 * review panel that was run on it. On a schema without the session columns this
 * still returns the report, with the extras empty.
 */
export async function loadRunSession(id: string): Promise<PersistResult<Msme43bRunSession>> {
  let { data, error } = await db().select(`report, ${SESSION_COLUMNS}`).eq('id', id).single();
  if (error && isMissingColumn(error)) {
    ({ data, error } = await db().select('report').eq('id', id).single());
  }
  if (error) return { data: null, error: error.message, unavailable: isMissingTable(error) };

  const raw = (data?.report as Msme43bReport) ?? null;
  if (!raw) return { data: null, error: 'The saved run has no report.', unavailable: false };
  return {
    data: {
      report: hydrateReport(raw),
      cyLedgers: (data.cy_ledgers as VendorLedger[]) ?? [],
      fyLedgers: (data.fy_ledgers as VendorLedger[]) ?? [],
      panelReview: (data.panel_review as PanelReview) ?? null,
    },
    error: null,
    unavailable: false,
  };
}

/**
 * Attach a review-panel transcript to the run it reviewed. Called the moment
 * the panel returns, so the two minutes it took are on file before anything
 * else can go wrong.
 */
export async function savePanelReview(runId: string, panel: PanelReview): Promise<PersistResult<true>> {
  const { error } = await db().update({ panel_review: panel }).eq('id', runId);
  if (error) {
    return {
      data: null,
      error: isMissingColumn(error)
        ? 'The review panel could not be filed against the run — apply the run-session migration.'
        : error.message,
      unavailable: isMissingTable(error) || isMissingColumn(error),
    };
  }
  return { data: true, error: null, unavailable: false };
}

export async function renameRun(id: string, label: string): Promise<PersistResult<true>> {
  const { error } = await db().update({ label: label.trim() || null }).eq('id', id);
  if (error) return { data: null, error: error.message, unavailable: isMissingTable(error) };
  return { data: true, error: null, unavailable: false };
}

export async function deleteRun(id: string): Promise<PersistResult<true>> {
  const { error } = await db().delete().eq('id', id);
  if (error) return { data: null, error: error.message, unavailable: isMissingTable(error) };
  return { data: true, error: null, unavailable: false };
}
