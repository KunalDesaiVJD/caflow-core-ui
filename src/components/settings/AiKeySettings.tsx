import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Sparkles, Loader2, CheckCircle2, XCircle, KeyRound, Trash2 } from "lucide-react";

/**
 * Settings → AI. Admin-only (the tab is hidden for everyone else and the
 * server route re-checks the role on every call).
 *
 * The key goes to /api/claude once, on Save, and never comes back: the
 * browser only ever sees the masked value, who saved it and when.
 */

interface AiStatus {
  active: "ui" | "env" | "none";
  ui: { masked: string; saved_by: string | null; saved_at: string } | null;
  env_configured: boolean;
  model: string;
}

const KEY_PATTERN = /^sk-ant-[A-Za-z0-9_-]{20,250}$/;

async function callAi<T>(body: Record<string, unknown>): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch("/api/claude", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session?.access_token ?? ""}`,
    },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error || `Request failed (${res.status})`);
  return json as T;
}

const SOURCE_LABEL: Record<AiStatus["active"], string> = {
  ui: "Key saved here",
  env: "Vercel ANTHROPIC_API_KEY",
  none: "No key set",
};

export default function AiKeySettings() {
  const { toast } = useToast();
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [keyInput, setKeyInput] = useState("");
  const [busy, setBusy] = useState<"save" | "test" | "remove" | null>(null);
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setStatus(await callAi<AiStatus>({ action: "status" }));
    } catch (e) {
      toast({ title: "Could not load AI settings", description: (e as Error).message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const keyLooksValid = KEY_PATTERN.test(keyInput.trim());

  async function handleSave() {
    if (!keyLooksValid) return;
    setBusy("save");
    setTestResult(null);
    try {
      await callAi({ action: "save", apiKey: keyInput.trim() });
      setKeyInput("");
      toast({ title: "API key saved" });
      await load();
    } catch (e) {
      toast({ title: "Could not save the key", description: (e as Error).message, variant: "destructive" });
    } finally {
      setBusy(null);
    }
  }

  async function handleTest() {
    setBusy("test");
    setTestResult(null);
    try {
      const r = await callAi<{ ok: boolean; error?: string; model?: string }>({ action: "test" });
      setTestResult(r.ok ? { ok: true, text: `OK — Claude answered (${r.model}).` } : { ok: false, text: r.error || "Test failed." });
    } catch (e) {
      setTestResult({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  async function handleRemove() {
    setConfirmRemove(false);
    setBusy("remove");
    setTestResult(null);
    try {
      await callAi({ action: "remove" });
      toast({ title: "Saved key removed" });
      await load();
    } catch (e) {
      toast({ title: "Could not remove the key", description: (e as Error).message, variant: "destructive" });
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Sparkles className="h-5 w-5" /> AI (Claude API)</CardTitle>
        <CardDescription>
          The Anthropic API key used by every AI feature. It is stored encrypted in Supabase Vault and is never shown again after saving.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
        ) : status && (
          <div className="rounded-lg border border-border p-4 space-y-2 text-sm">
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">Active key:</span>
              <Badge variant={status.active === "none" ? "destructive" : "secondary"}>{SOURCE_LABEL[status.active]}</Badge>
            </div>
            {status.ui && (
              <div className="text-muted-foreground">
                Saved key <span className="font-mono text-foreground">{status.ui.masked}</span>
                {status.ui.saved_by ? <> by {status.ui.saved_by}</> : null} on {new Date(status.ui.saved_at).toLocaleString("en-IN")}
              </div>
            )}
            <div className="text-muted-foreground">
              Vercel fallback (ANTHROPIC_API_KEY): {status.env_configured ? "set" : "not set"}
              {status.ui && status.env_configured ? " — used only if the saved key is removed" : ""}
            </div>
            <div className="text-muted-foreground">Model: <span className="font-mono">{status.model}</span></div>
          </div>
        )}

        <div className="space-y-2 max-w-lg">
          <Label htmlFor="anthropic-key">{status?.ui ? "Replace API key" : "API key"}</Label>
          <Input
            id="anthropic-key"
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder="sk-ant-…"
            value={keyInput}
            onChange={e => setKeyInput(e.target.value)}
          />
          {keyInput && !keyLooksValid && (
            <p className="text-xs text-destructive">An Anthropic API key starts with sk-ant-.</p>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button onClick={handleSave} disabled={!keyLooksValid || busy !== null}>
            {busy === "save" ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <KeyRound className="h-4 w-4 mr-2" />} Save
          </Button>
          <Button variant="outline" onClick={handleTest} disabled={busy !== null || status?.active === "none"}>
            {busy === "test" && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Test connection
          </Button>
          <Button variant="outline" onClick={() => setConfirmRemove(true)} disabled={busy !== null || !status?.ui}>
            {busy === "remove" ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Trash2 className="h-4 w-4 mr-2" />} Remove
          </Button>
        </div>

        {testResult && (
          <div className={`flex items-start gap-2 text-sm ${testResult.ok ? "text-green-700 dark:text-green-400" : "text-destructive"}`}>
            {testResult.ok ? <CheckCircle2 className="h-4 w-4 mt-0.5" /> : <XCircle className="h-4 w-4 mt-0.5" />}
            <span>{testResult.text}</span>
          </div>
        )}
      </CardContent>

      <AlertDialog open={confirmRemove} onOpenChange={setConfirmRemove}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove saved API key</AlertDialogTitle>
            <AlertDialogDescription>
              {status?.env_configured
                ? "AI features will fall back to the ANTHROPIC_API_KEY set in Vercel."
                : "No fallback key is set in Vercel, so AI features will stop working until a key is added."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleRemove} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
