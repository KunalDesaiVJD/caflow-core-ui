/**
 * TdsPortalLoginButtons — "ITD Login" / "TRACES Login" quick-access buttons.
 *
 * Deliberately NOT full browser automation. A website cannot script a
 * DIFFERENT website's page in another tab (cross-origin), and even if it
 * could, auto-filling AND auto-submitting a login form up to the CAPTCHA
 * defeats the one control those portals rely on to block automated access —
 * a real risk of violating the ITD/TRACES terms of service and triggering
 * anti-bot lockouts on a client's actual government account, regardless of
 * intent. See the conversation this was built from for the full reasoning.
 *
 * What this DOES do: open the portal in a new tab, and let the user copy the
 * stored login ID / password to their clipboard to paste in themselves — the
 * same shape as any password manager's quick-fill, not an automation of the
 * anti-bot gate itself. The password is never displayed on screen, only
 * copied — same posture as the existing "Reveal" eye-icon flow in
 * StepServiceBilling.tsx, reusing the SAME tds-portal-credentials edge
 * function (status → read) rather than inventing a second credential path.
 */
import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuLabel, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { ExternalLink, Copy, KeyRound, LogIn, Loader2 } from "lucide-react";

const ITD_PORTAL_URL = "https://www.incometax.gov.in/iec/foportal/";
const TRACES_PORTAL_URL = "https://www.tdscpc.gov.in/app/login.xhtml";

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
  label, portalUrl, loginId, passwordSet, onCopyPassword, revealing,
}: {
  label: string; portalUrl: string; loginId: string | null; passwordSet: boolean;
  onCopyPassword: () => void; revealing: boolean;
}) {
  const { toast } = useToast();
  const hasAnyCredential = !!loginId || passwordSet;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs">
          <LogIn size={13} /> {label} Login
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel className="text-xs text-muted-foreground font-normal">
          {hasAnyCredential
            ? "You still complete the login yourself — this only opens the portal and copies what's saved."
            : "No login saved for this client yet — add one in Edit Client → Services → TDS Compliance."}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
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

  if (!clientId) return null;

  return (
    <div className="flex items-center gap-2">
      <PortalLoginMenu
        label="ITD" portalUrl={ITD_PORTAL_URL}
        loginId={status?.itdLoginId ?? null} passwordSet={!!status?.itdPasswordSet}
        onCopyPassword={() => copyPassword("itd")} revealing={revealingItd}
      />
      <PortalLoginMenu
        label="TRACES" portalUrl={TRACES_PORTAL_URL}
        loginId={status?.tracesLoginId ?? null} passwordSet={!!status?.tracesPasswordSet}
        onCopyPassword={() => copyPassword("traces")} revealing={revealingTraces}
      />
    </div>
  );
}
