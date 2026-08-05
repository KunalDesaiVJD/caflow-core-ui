/**
 * TdsPortalLoginButtons — "ITD Login" / "TRACES Login" quick-access buttons.
 *
 * A website genuinely cannot script a DIFFERENT website's page in another
 * tab on its own (cross-origin) — that's a browser security boundary, not a
 * missing feature. Real cross-site autofill needs a browser extension with
 * permission for that specific site, the same mechanism the firm's GST
 * automation uses. See browser-extension/itd-autofill/ (2026-08-06) — a
 * genuinely separate artifact from this web app, installed once per person
 * via Chrome's Developer Mode "Load unpacked", not deployed alongside it.
 *
 * Firm instruction: fill the login ID and password automatically, but the
 * CAPTCHA/OTP step and the final Sign In click stay manual — the extension
 * never touches those, so it never attempts to defeat the portal's own
 * anti-bot gate, only removes the "look up and retype the login" toil in
 * front of it. ITD only for now (TRACES's own multi-step flow hasn't been
 * mapped yet); TRACES still gets the copy-to-clipboard fallback below.
 *
 * This component detects the extension (content-caflow.js stamps a marker
 * attribute on <html> at document_start) and only shows "Auto-fill ITD
 * Login" once it's actually present — without it installed, everyone still
 * gets the copy-to-clipboard flow, which stays the fallback for TRACES and
 * for anyone who hasn't installed the extension. The password is never
 * displayed on screen either way — same posture as the existing "Reveal"
 * eye-icon flow in StepServiceBilling.tsx, reusing the SAME
 * tds-portal-credentials edge function (status → read) rather than
 * inventing a second credential path.
 */
import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuLabel, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { ExternalLink, Copy, KeyRound, LogIn, Loader2, Sparkles } from "lucide-react";

const ITD_PORTAL_URL = "https://www.incometax.gov.in/iec/foportal/";
// The actual login SPA, not the landing page above — the auto-fill extension
// (browser-extension/itd-autofill/) matches this exact host and needs to
// land directly on the login step to activate, not the homepage the plain
// "Open ITD Portal" link goes to.
const ITD_LOGIN_URL = "https://eportal.incometax.gov.in/iec/foservices/#/login";
const TRACES_PORTAL_URL = "https://www.tdscpc.gov.in/app/login.xhtml";

/** Set at document_start by content-caflow.js once the extension is
 *  installed and enabled — absent otherwise, including for every user who
 *  hasn't installed it, which is the expected default until it's rolled out. */
const hasItdAutofillExtension = () =>
  typeof document !== "undefined" && document.documentElement.hasAttribute("data-caflow-itd-extension");

interface Props {
  clientId: string | null;
}

interface PortalStatus {
  clientServiceId: string;
  itdLoginId: string | null;
  itdPasswordSet: boolean;
  tracesLoginId: string | null;
  tracesPasswordSet: boolean;
}

async function copyToClipboard(text: string) {
  await navigator.clipboard.writeText(text);
}

function PortalLoginMenu({
  label, portalUrl, loginId, passwordSet, onCopyPassword, revealing, onAutofill, autofilling,
}: {
  label: string; portalUrl: string; loginId: string | null; passwordSet: boolean;
  onCopyPassword: () => void; revealing: boolean;
  /** Present only for a portal the extension actually supports (ITD today) —
   *  see hasItdAutofillExtension's own doc for why this is opt-in per portal. */
  onAutofill?: () => void; autofilling?: boolean;
}) {
  const { toast } = useToast();
  const hasAnyCredential = !!loginId || passwordSet;
  const canAutofill = !!onAutofill && hasItdAutofillExtension() && !!loginId && passwordSet;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs">
          <LogIn size={13} /> {label} Login
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel className="text-xs text-muted-foreground font-normal">
          {canAutofill
            ? "Fills your login ID and password automatically — you still enter the CAPTCHA/OTP and sign in yourself."
            : hasAnyCredential
              ? "You still complete the login yourself — this only opens the portal and copies what's saved."
              : "No login saved for this client yet — add one in Edit Client → Services → TDS Compliance."}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {canAutofill && (
          <>
            <DropdownMenuItem disabled={autofilling} onClick={onAutofill} className="gap-2 font-medium">
              {autofilling ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
              Auto-fill {label} Login
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuItem onClick={() => window.open(portalUrl, "_blank", "noopener,noreferrer")} className="gap-2">
          <ExternalLink size={14} /> Open {label} Portal
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!loginId}
          onClick={() => { copyToClipboard(loginId!); toast({ title: `${label} login ID copied` }); }}
          className="gap-2"
        >
          <Copy size={14} /> Copy Login ID{loginId ? "" : " (none saved)"}
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!passwordSet || revealing} onClick={onCopyPassword} className="gap-2">
          {revealing ? <Loader2 size={14} className="animate-spin" /> : <KeyRound size={14} />}
          Copy Password{passwordSet ? "" : " (none saved)"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function TdsPortalLoginButtons({ clientId }: Props) {
  const { toast } = useToast();
  const [status, setStatus] = useState<PortalStatus | null>(null);
  const [revealingItd, setRevealingItd] = useState(false);
  const [revealingTraces, setRevealingTraces] = useState(false);
  const [autofillingItd, setAutofillingItd] = useState(false);

  const fetchStatus = useCallback(async () => {
    if (!clientId) { setStatus(null); return; }
    // Resolve this client's TDS-linked client_services row the same way
    // TdsFilings.tsx's own client list does — TDS Compliance is the single
    // source of truth for TDS module membership, so credentials live there.
    const { data: catData } = await supabase.from("service_categories").select("id").eq("linked_module", "tds");
    const tdsCatIds = (catData || []).map((c: any) => c.id);
    if (tdsCatIds.length === 0) { setStatus(null); return; }
    const { data: svc } = await supabase.from("client_services")
      .select("id").eq("client_id", clientId).eq("is_active", true).in("service_category_id", tdsCatIds).limit(1).maybeSingle();
    if (!svc) { setStatus(null); return; }

    const { data, error } = await supabase.functions.invoke("tds-portal-credentials", {
      body: { action: "status", client_service_id: svc.id },
    });
    if (error || !data) { setStatus(null); return; }
    setStatus({
      clientServiceId: svc.id,
      itdLoginId: data.itd_login_id ?? null,
      itdPasswordSet: !!data.itd_password_set,
      tracesLoginId: data.traces_login_id ?? null,
      tracesPasswordSet: !!data.traces_password_set,
    });
  }, [clientId]);

  useEffect(() => { fetchStatus(); }, [fetchStatus]);

  const copyPassword = async (which: "itd" | "traces") => {
    if (!status) return;
    const setRevealing = which === "itd" ? setRevealingItd : setRevealingTraces;
    setRevealing(true);
    const { data, error } = await supabase.functions.invoke("tds-portal-credentials", {
      body: { action: "read", client_service_id: status.clientServiceId },
    });
    setRevealing(false);
    const pw = which === "itd" ? data?.itd_password : data?.traces_password;
    if (error || !pw) {
      toast({ title: "Could not copy password", description: error?.message || "No password saved.", variant: "destructive" });
      return;
    }
    await copyToClipboard(pw);
    toast({ title: `${which === "itd" ? "ITD" : "TRACES"} password copied`, description: "Paste it into the portal — nothing was shown on screen." });
  };

  /**
   * Hands the ITD login off to the browser extension (content-caflow.js,
   * browser-extension/itd-autofill/) via window.postMessage — the standard
   * page-to-content-script channel — then opens the login page.
   *
   * window.open() is called FIRST, synchronously, before any `await` — a
   * popup opened after even one microtask of async work (a network call, a
   * Promise) loses the "direct response to a click" status Chrome requires,
   * and gets silently blocked with no visible error. Everything below that
   * first line is async and races the new tab's own load time (network +
   * an Angular app booting, reliably 1s+) against a same-machine edge
   * function call + an in-process extension message — the credential relay
   * wins that race in practice, and content-itd.js also retries its own
   * fetch once as a safety net (see that file's own comment) for when it
   * doesn't.
   */
  const autofillItd = async () => {
    if (!status) return;
    window.open(ITD_LOGIN_URL, "_blank", "noopener,noreferrer");
    setAutofillingItd(true);
    const { data, error } = await supabase.functions.invoke("tds-portal-credentials", {
      body: { action: "read", client_service_id: status.clientServiceId },
    });
    if (error || !data?.itd_password || !status.itdLoginId) {
      setAutofillingItd(false);
      toast({ title: "Could not auto-fill", description: error?.message || "No ITD password saved. The portal is open — log in manually this time.", variant: "destructive" });
      return;
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
        { source: "caflow-web", type: "ITD_LOGIN_CREDENTIALS", loginId: status.itdLoginId, password: data.itd_password },
        window.location.origin,
      );
      setTimeout(() => { window.removeEventListener("message", onAck); resolve(false); }, 3000);
    });
    setAutofillingItd(false);
    if (!acked) {
      toast({ title: "Extension didn't respond", description: "The portal is open, but the extension may not have received the credentials — log in manually if it wasn't filled.", variant: "destructive" });
    }
  };

  if (!clientId) return null;

  return (
    <div className="flex items-center gap-2">
      <PortalLoginMenu
        label="ITD" portalUrl={ITD_PORTAL_URL}
        loginId={status?.itdLoginId ?? null} passwordSet={!!status?.itdPasswordSet}
        onCopyPassword={() => copyPassword("itd")} revealing={revealingItd}
        onAutofill={autofillItd} autofilling={autofillingItd}
      />
      <PortalLoginMenu
        label="TRACES" portalUrl={TRACES_PORTAL_URL}
        loginId={status?.tracesLoginId ?? null} passwordSet={!!status?.tracesPasswordSet}
        onCopyPassword={() => copyPassword("traces")} revealing={revealingTraces}
      />
    </div>
  );
}
