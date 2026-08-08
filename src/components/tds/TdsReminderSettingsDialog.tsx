import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { BellRing, Save, Loader2 } from "lucide-react";

interface Props {
  clientId: string;
}

interface Settings {
  enabled: boolean;
  send_confirmation: boolean;
}
const DEFAULTS: Settings = { enabled: false, send_confirmation: true };

/**
 * Per-client TDS reminder configuration — a popup opened from the TDS
 * Compliance panel. Writes only to public.tds_client_reminder_settings
 * (independent of the client wizard's own save), mirroring the GST sibling
 * feature's ReminderSettingsCard, but as a Dialog rather than an inline card
 * (this app's TDS Compliance panel is already dense) and without the
 * interval/escalate/cap controls — the schedule is fixed, not per-client.
 */
export function TdsReminderSettingsDialog({ clientId }: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [s, setS] = useState<Settings>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from("tds_client_reminder_settings" as any)
        .select("enabled, send_confirmation")
        .eq("client_id", clientId)
        .maybeSingle();
      if (cancelled) return;
      setS(data ? { ...DEFAULTS, ...(data as any) } : DEFAULTS);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [open, clientId]);

  const save = async () => {
    setSaving(true);
    const { error } = await supabase
      .from("tds_client_reminder_settings" as any)
      .upsert(
        {
          client_id: clientId,
          enabled: s.enabled,
          send_confirmation: s.send_confirmation,
          updated_by: (user as any)?.id ?? null,
        },
        { onConflict: "client_id" },
      );
    setSaving(false);
    if (error) {
      toast({ title: "Save failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Reminder settings saved" });
    setOpen(false);
  };

  return (
    <>
      <Button type="button" variant="outline" size="sm" className="h-8 text-xs gap-1.5" onClick={() => setOpen(true)}>
        <BellRing size={12} /> Reminder Settings
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><BellRing className="h-4 w-4" /> TDS Data Reminders</DialogTitle>
            <DialogDescription>
              Automatic email reminders (from tds@vjdesai.com) asking this client to share their TDS data, plus a
              confirmation once the return is filed.
            </DialogDescription>
          </DialogHeader>

          {loading ? (
            <div className="flex items-center justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : (
            <div className="space-y-4 py-1">
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-0.5">
                  <p className="text-sm font-medium">Send reminders</p>
                  <p className="text-xs text-muted-foreground">Master on/off switch for this client.</p>
                </div>
                <Switch checked={s.enabled} onCheckedChange={(v) => setS((x) => ({ ...x, enabled: v }))} />
              </div>

              <div className="space-y-1 rounded-md border bg-muted/30 p-3">
                <p className="text-sm font-medium">Reminder interval</p>
                <p className="text-xs text-muted-foreground">Fixed firm-wide schedule — not editable per client.</p>
                <ul className="list-inside list-disc space-y-0.5 pt-1 text-xs text-muted-foreground">
                  <li>Q1 / Q2 / Q3: 8th, 11th &amp; 14th of the month after quarter-end</li>
                  <li>Q4 (Jan-Mar): 1st, 5th &amp; 10th May</li>
                </ul>
              </div>

              <div className="flex items-start justify-between gap-4">
                <div className="space-y-0.5">
                  <p className="text-sm font-medium">Filing confirmation</p>
                  <p className="text-xs text-muted-foreground">
                    Email this client automatically when their return is marked Filed or NIL.
                  </p>
                </div>
                <Switch checked={s.send_confirmation} onCheckedChange={(v) => setS((x) => ({ ...x, send_confirmation: v }))} />
              </div>
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="button" size="sm" onClick={save} disabled={saving || loading} className="gap-1.5">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save reminder settings
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
