/**
 * tds-portal-credentials
 *
 * Save/read a client's ITD e-filing and TRACES login credentials, stored
 * encrypted at rest against their TDS-Compliance client_services row (see
 * migration 20260804120000_tds_portal_credentials.sql for the schema and the
 * two SECURITY DEFINER Postgres functions this calls — service_role-only,
 * so a browser session can never encrypt/decrypt directly even with a valid
 * user JWT). This function is the sole gate in front of them: it verifies
 * the caller belongs to the target client's firm (or is a superadmin)
 * BEFORE calling either function, since the functions themselves bypass RLS.
 *
 * The encryption key (TDS_CREDENTIALS_ENCRYPTION_KEY) lives only in this
 * function's own secret — never in the database, never returned to the
 * browser, never logged.
 *
 * Input (POST, Bearer auth):
 *   { action: "save", client_service_id, itd_login_id?, itd_password?, traces_login_id?, traces_password? }
 *     — a password field of `undefined`/absent leaves the stored password
 *       unchanged; an explicit empty string "" clears it. Login-id fields
 *       always overwrite (they're not secret, so there's no "leave
 *       unchanged" ambiguity to preserve).
 *   { action: "read", client_service_id }
 *     — returns the DECRYPTED credentials. Call only when the user actively
 *       asks to reveal a password (see TdsDataEntry/StepServiceBilling's own
 *       "Reveal" button) — never on ordinary page load.
 *   { action: "status", client_service_id }
 *     — returns which fields are SET, without decrypting anything. Safe to
 *       call on every page load to render "•••••• (saved)" placeholders.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsFor = (req: Request) => ({
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    req.headers.get("access-control-request-headers") ??
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
});

serve(async (req) => {
  const corsHeaders = corsFor(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "").trim();
    if (!token) return json({ error: "Unauthorized" }, 401);

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) return json({ error: "Unauthorized" }, 401);

    const body = (await req.json().catch(() => ({}))) ?? {};
    const { action, client_service_id } = body;
    if (!client_service_id) return json({ error: "client_service_id is required" }, 400);
    if (!["save", "read", "status"].includes(action)) return json({ error: "action must be save, read, or status" }, 400);

    // Resolve the target row's owning firm via its client — client_services
    // itself carries no firm_id column, only client_id.
    const { data: cs, error: csErr } = await supabase
      .from("client_services").select("id, client_id, clients(firm_id)").eq("id", client_service_id).single();
    if (csErr || !cs) return json({ error: "Service record not found" }, 404);
    const targetFirmId = (cs as any).clients?.firm_id;

    // AUTHORIZE — the service-role client (and the SECURITY DEFINER
    // functions it's about to call) bypass RLS entirely, so this check is
    // the ONLY thing standing between an authenticated user and another
    // firm's stored government-portal passwords. Without it, any valid
    // CAFlow login could pass a foreign client_service_id and read/write
    // its credentials.
    const { data: caller } = await supabase.from("users").select("firm_id, role").eq("id", user.id).single();
    if (!caller || (caller.firm_id !== targetFirmId && caller.role !== "superadmin")) {
      return json({ error: "You are not authorised for this client." }, 403);
    }

    if (action === "status") {
      const { data, error } = await supabase
        .from("client_services")
        .select("itd_login_id, itd_password_encrypted, traces_login_id, traces_password_encrypted, credentials_updated_at")
        .eq("id", client_service_id).single();
      if (error || !data) return json({ error: error?.message || "Not found" }, 404);
      return json({
        itd_login_id: data.itd_login_id,
        itd_password_set: data.itd_password_encrypted != null,
        traces_login_id: data.traces_login_id,
        traces_password_set: data.traces_password_encrypted != null,
        credentials_updated_at: data.credentials_updated_at,
      });
    }

    const key = Deno.env.get("TDS_CREDENTIALS_ENCRYPTION_KEY");
    if (!key) return json({ error: "Server is not configured for credential storage (missing encryption key)." }, 500);

    if (action === "save") {
      const { itd_login_id, itd_password, traces_login_id, traces_password } = body;
      const { error } = await supabase.rpc("tds_save_portal_credentials", {
        p_client_service_id: client_service_id,
        p_itd_login_id: itd_login_id ?? null,
        p_itd_password: itd_password === undefined ? null : itd_password,
        p_traces_login_id: traces_login_id ?? null,
        p_traces_password: traces_password === undefined ? null : traces_password,
        p_key: key,
        p_updated_by: user.id,
      });
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true });
    }

    // action === "read"
    const { data, error } = await supabase.rpc("tds_read_portal_credentials", {
      p_client_service_id: client_service_id,
      p_key: key,
    });
    if (error) return json({ error: error.message }, 500);
    const row = Array.isArray(data) ? data[0] : data;
    return json(row ?? { itd_login_id: null, itd_password: null, traces_login_id: null, traces_password: null, credentials_updated_at: null });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
