// MSME 43B(h) — Supabase persistence: save / list / load / delete runs per client.
//
// The msme_43b_runs table is added by migration 20260728140000_msme_43b_runs.sql
// and is not yet in the generated Database types (types.ts is CLI-regenerated
// only), so access is via a localised cast. All calls fail soft: if the table is
// absent (migration not yet applied) the helpers surface a friendly flag rather
// than crashing the page.

import { supabase } from '@/integrations/supabase/client';
import type { Msme43bReport } from './types';

const TABLE = 'msme_43b_runs';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => (supabase as any).from(TABLE);

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
  const { data, error } = await db().insert(row).select('id').single();
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

export async function loadRun(id: string): Promise<PersistResult<Msme43bReport>> {
  const { data, error } = await db().select('report').eq('id', id).single();
  if (error) return { data: null, error: error.message, unavailable: isMissingTable(error) };
  return { data: (data.report as Msme43bReport) ?? null, error: null, unavailable: false };
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
