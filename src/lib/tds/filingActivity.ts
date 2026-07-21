import { supabase } from "@/integrations/supabase/client";

/**
 * Any TDS Workspace activity (Data Entry, or Stage 1-3 of Validate &
 * Finalise) auto-advances a fresh filing out of "Not Started" — the user
 * should never have to manually flip the Status dropdown just to reflect
 * that work has begun.
 *
 * Uses a DB-level compare-and-swap (.eq("work_status", "Not Started") on
 * the update itself, not just a client-side check) so two near-simultaneous
 * activities — or a manual status change landing at the same moment — can
 * never race each other into a wrong end state. Never touches any OTHER
 * status: NIL/Data Received/Filed/Processed/etc. are always left alone,
 * since the write is scoped to rows still "Not Started".
 *
 * Returns true only if this call actually flipped the row, so the caller
 * knows whether to update its own local `filing` state.
 */
export async function markUnderProcessIfNotStarted(
  filingId: string,
  currentStatus: string | null | undefined,
  userId: string | undefined,
): Promise<boolean> {
  if (currentStatus !== "Not Started") return false;
  const { data, error } = await supabase.from("tds_filings").update({
    work_status: "Under Process",
    last_updated_by: userId ?? null,
    last_updated_at: new Date().toISOString(),
  }).eq("id", filingId).eq("work_status", "Not Started").select("id");
  return !error && !!data && data.length > 0;
}
