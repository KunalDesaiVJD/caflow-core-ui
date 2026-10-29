// Layout pieces shared with the Telegram bot live in supabase/functions/_shared/statement/layout.ts.
import { supabase } from "@/integrations/supabase/client";
import { firmBankDetailsOf, type FirmBankDetails } from "../../supabase/functions/_shared/statement/layout";

export * from "../../supabase/functions/_shared/statement/layout";

/** Bank details for the given firms, in firm-name order. Firms with none saved are left out. */
export async function loadFirmBankDetails(firmIds: string[]): Promise<FirmBankDetails[]> {
  const ids = Array.from(new Set(firmIds.filter(Boolean)));
  if (ids.length === 0) return [];
  const { data } = await (supabase as any).from("firms").select("id, name, bank_details, settings").in("id", ids).order("name");
  return ((data || []) as any[]).map(firmBankDetailsOf).filter(Boolean) as FirmBankDetails[];
}
