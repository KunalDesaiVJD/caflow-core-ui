import { supabase } from "@/integrations/supabase/client";
import {
  HEAD_FIRM_NAME, HEAD_FIRM_NAME_PATTERN, brandedShell, ensureLogoHeader, ledgerStatementBody,
} from "../../supabase/functions/_shared/emailBrand";

/**
 * The statement-of-account email as the client will see it: the head firm's saved
 * "ledger_statement" template when it has an active one (same variable substitution as
 * the sender), otherwise the built-in layout.
 */
export async function renderStatementEmailPreview(o: { clientName: string; customMessage?: string }): Promise<string> {
  try {
    const { data: head } = await (supabase as any).from("firms").select("id").ilike("name", HEAD_FIRM_NAME_PATTERN).limit(1).maybeSingle();
    if (head?.id) {
      const { data: tpl } = await (supabase as any).from("email_templates")
        .select("body_html").eq("firm_id", head.id).eq("type", "ledger_statement").eq("is_active", true)
        .order("updated_at", { ascending: false }).limit(1).maybeSingle();
      if (tpl?.body_html) {
        const vars: Record<string, string> = {
          client_name: o.clientName || "Client", firm_name: HEAD_FIRM_NAME, custom_message: o.customMessage || "",
          invoice_no: "", amount: "", due_date: "", document_type: "", invoice_table: "", days_overdue: "", statement_date: "",
        };
        return ensureLogoHeader(String(tpl.body_html).replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, k) => (k in vars ? vars[k] : "")));
      }
    }
  } catch { /* fall back to the built-in layout */ }
  return brandedShell(ledgerStatementBody({ clientName: o.clientName, customMessage: o.customMessage }));
}
