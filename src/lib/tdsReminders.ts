import { supabase } from "@/integrations/supabase/client";

// Firm identity used to fill the {{firm_*}} template variables. tds@vjdesai.com
// is fixed (the sending address, via the same Microsoft Graph app registration
// already used for gst@vjdesai.com — see send-tds-email's own header).
export const TDS_FIRM = {
  name: "V. J. Desai & Co. LLP",
  email: "tds@vjdesai.com",
  phone: "",
  team: "V. J. Desai & Co. (TDS Team)",
};

/** Substitute {{var}} tokens; an unknown/absent variable renders as ''. */
export function renderTemplate(s: string, vars: Record<string, string>): string {
  return s.replace(/\{\{(\w+)\}\}/g, (_m, k) => vars[k] ?? "");
}

type EnqueueResult = "queued" | "skipped" | "error";

/**
 * Queue the filing-confirmation email for a client whose return was just
 * marked "Filed" or "NIL". Writes a `pending` row to tds_email_outbox — the
 * actual send happens later via the tds@vjdesai.com sender. Best-effort and
 * idempotent (the DB unique index blocks a second confirmation for the same
 * client/form/FY/quarter). Never throws to the caller.
 */
export async function enqueueConfirmation(opts: {
  clientId: string;
  formType: string;
  financialYear: string;
  quarter: string;
  ackNo?: string | null;
  filedDate: string;
  filingId?: string | null;
  isNil: boolean;
  staffName?: string | null;
}): Promise<EnqueueResult> {
  try {
    // Confirmation is ON by default; only skip if the client explicitly turned it off.
    const { data: st } = await supabase
      .from("tds_client_reminder_settings" as any)
      .select("send_confirmation")
      .eq("client_id", opts.clientId)
      .maybeSingle();
    if (st && (st as any).send_confirmation === false) return "skipped";

    const { data: client } = await supabase
      .from("clients")
      .select("name, email, contact_person, tan_number")
      .eq("id", opts.clientId)
      .maybeSingle();
    if (!client?.email) return "skipped"; // no address on file -> nothing to send

    const templateKey = opts.isNil ? "confirmation_nil" : "confirmation_filed";
    const { data: tpl } = await supabase
      .from("tds_email_templates" as any)
      .select("subject, body, is_active")
      .eq("key", templateKey)
      .maybeSingle();
    if (!tpl || (tpl as any).is_active === false) return "skipped";

    const vars: Record<string, string> = {
      contact_person: client.contact_person || client.name || "",
      client_name: client.name || "",
      tan: client.tan_number ?? "",
      form_type: opts.formType,
      quarter: opts.quarter,
      financial_year: opts.financialYear,
      ack_no: opts.ackNo || "",
      filing_date: opts.filedDate,
      staff_name: opts.staffName || TDS_FIRM.team,
      firm_name: TDS_FIRM.name,
      firm_email: TDS_FIRM.email,
      firm_phone: TDS_FIRM.phone,
      due_date: "",
    };

    const { error } = await supabase.from("tds_email_outbox" as any).insert({
      client_id: opts.clientId,
      to_email: client.email,
      kind: "confirmation",
      template_key: templateKey,
      form_type: opts.formType,
      financial_year: opts.financialYear,
      quarter: opts.quarter,
      subject: renderTemplate((tpl as any).subject, vars),
      body: renderTemplate((tpl as any).body, vars),
      render_vars: vars,
      status: "pending",
      filing_id: opts.filingId ?? null,
    });
    if (error) {
      // 23505 = the confirmation for this (client, form, FY, quarter) is already queued.
      if ((error as { code?: string }).code === "23505") return "skipped";
      throw error;
    }
    // Flush the queue now so the confirmation lands within seconds of filing.
    // Best-effort — the hourly cron is the backstop if this call fails.
    void supabase.functions.invoke("send-tds-email", { body: {} }).catch(() => {});
    return "queued";
  } catch (e) {
    console.warn("[tdsReminders] enqueueConfirmation failed (non-fatal):", (e as Error)?.message);
    return "error";
  }
}
