/**
 * itdCredentialsRelay — hands a client's saved ITD login off to the browser
 * extension (browser-extension/itd-autofill/) via window.postMessage, the
 * same relay TdsPortalLoginButtons.tsx's "Auto-fill ITD Login" button
 * already uses. Extracted here so TdsChallanDownloadValidation.tsx's
 * "Download Challan" button can do the SAME relay — previously it only
 * opened a blank ITD login page and left the user to log in with no
 * autofill at all, unlike every other entry point into the portal, which
 * read as broken even though the automation past login was working.
 */
import { supabase } from "@/integrations/supabase/client";

/** The TDS-linked client_services row id for a client — credentials live
 *  there, resolved the same way TdsFilings.tsx's own client list and
 *  TdsPortalLoginButtons.tsx's fetchStatus() do. Returns null if this
 *  client has no active TDS service (nothing to relay). */
export async function resolveTdsClientServiceId(clientId: string): Promise<string | null> {
  const { data: catData } = await supabase.from("service_categories").select("id").eq("linked_module", "tds");
  const tdsCatIds = (catData || []).map((c: any) => c.id);
  if (tdsCatIds.length === 0) return null;
  const { data: svc } = await supabase.from("client_services")
    .select("id").eq("client_id", clientId).eq("is_active", true).in("service_category_id", tdsCatIds).limit(1).maybeSingle();
  return svc?.id ?? null;
}

/**
 * Reads the decrypted ITD login (tds-portal-credentials edge function,
 * "read" action — returns itd_login_id alongside itd_password in one call,
 * unlike TdsPortalLoginButtons.tsx's own two-call status+read pattern,
 * which only needs the extra "status" round trip for its dropdown's
 * up-front display; this caller doesn't display anything, so one call
 * suffices) and posts it to the extension, waiting up to 3s for its ACK —
 * same timeout TdsPortalLoginButtons.tsx uses. Never throws: a missing
 * credential, a missing extension, or no ACK all resolve to
 * `{ ok: false, reason }` so the caller can fall back to "log in manually"
 * without the portal tab (already open) going to waste either way.
 */
export async function relayItdLoginCredentials(clientServiceId: string): Promise<{ ok: boolean; reason?: string }> {
  try {
    const { data, error } = await supabase.functions.invoke("tds-portal-credentials", {
      body: { action: "read", client_service_id: clientServiceId },
    });
    if (error || !data?.itd_password || !data?.itd_login_id) {
      return { ok: false, reason: error?.message || "No ITD login saved for this client." };
    }
    const acked = await new Promise<boolean>((resolve) => {
      const onAck = (event: MessageEvent) => {
        if (event.source !== window) return;
        const msg = event.data;
        if (msg?.source === "caflow-extension" && msg?.type === "ITD_LOGIN_CREDENTIALS_ACK") {
          window.removeEventListener("message", onAck);
          resolve(!!msg.ok);
        }
      };
      window.addEventListener("message", onAck);
      window.postMessage(
        { source: "caflow-web", type: "ITD_LOGIN_CREDENTIALS", loginId: data.itd_login_id, password: data.itd_password },
        window.location.origin,
      );
      setTimeout(() => { window.removeEventListener("message", onAck); resolve(false); }, 3000);
    });
    return acked ? { ok: true } : { ok: false, reason: "The extension didn't acknowledge the credential handoff." };
  } catch (err: any) {
    return { ok: false, reason: err?.message || String(err) };
  }
}
