/**
 * clientUtils — shared client-record helpers
 *
 * These utilities resolve client data from an engagementId so callers that
 * don't have a pre-loaded client object (e.g. edge-case hooks, background
 * tasks) can still get the TAN without duplicating the join logic.
 *
 * CP-14 / CP-15 shared utility — resolves tan_number via engagement → client.
 */
import { supabase } from "@/integrations/supabase/client";

/**
 * fetchClientTAN
 *
 * Returns the TAN of the client linked to an engagement.
 * Falls back to null when the engagement or client is missing.
 *
 * NOTE: In contexts where a fully-loaded client object is already available
 * (e.g. ClauseRenderer receives client as a prop from Form3CD.tsx), prefer
 * reading client.tan_number directly rather than calling this function.
 *
 * @param engagementId  UUID of the audit_engagements row
 * @returns             tan_number string or null
 */
export async function fetchClientTAN(engagementId: string): Promise<string | null> {
  if (!engagementId) return null;

  const { data, error } = await supabase
    .from("audit_engagements")
    .select("clients(tan_number)")
    .eq("id", engagementId)
    .single();

  if (error || !data) return null;

  // Supabase returns the joined row as an object (not array) when using .single()
  const clients = (data as any).clients;
  if (!clients) return null;

  return (clients as any).tan_number ?? null;
}
