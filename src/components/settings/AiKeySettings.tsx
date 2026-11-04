import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Sparkles, Loader2, CheckCircle2, XCircle, KeyRound, Trash2 } from "lucide-react";

/**
 * Settings → AI. Admin-only (the tab is hidden for everyone else and the
 * server route re-checks the role on every call).
 *
 * The key goes to /api/claude once, on Save, where it is checked with
 * Anthropic before it is stored. It never comes back: the browser only sees
 * its last 4 characters, who saved it and when.
 */

type KeyInfo =
  | { source: "pasted"; hint: string | null; savedOn: string | null; savedBy: string | null }
  | { source: "server" }
  | { source: "unreadable" }
  | { source: "none" };

interface AiStatus {
  key: KeyInfo;
  serverKeySet: boolean;
  model: string;
  modelSource: "settings" | "env" | "default";
  modelSavedBy: string | null;
  modelSavedOn: string | null;
  models: { id: string; label: string }[];
}

const KEY_PATTERN = /^sk-ant-[A-Za-z0-9_-]{16,250}$/;

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
  // The server's own sentence (e.g. "Anthropic could not be reached…"), never a generic one.
  if (!res.ok) throw new Error(json?.error || `Request failed (${res.status})`);
  return json as T;
}

function formatDate(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "";
}

function keyLine(key: KeyInfo): string {
  switch (key.source) {
    case "pasted":
      return `Key ending ${key.hint ?? "????"}, pasted here${key.savedBy ? ` by ${key.savedBy}` : ""}${key.savedOn ? ` on ${formatDate(key.savedOn)}` : ""}.`;
    case "server":
      return "Key set where the app is hosted (Vercel). A key pasted here would be used instead.";
    case "unreadable":
      return "The saved key can no longer be opened. Paste the key again.";
    default:
      return "No key yet. AI features are off until a key is pasted here.";
  }
}

export default function AiKeySettings() {
  const { toast } = useToast();
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [keyInput, setKeyInput] = useState("");
  const [keyError, setKeyError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"save" | "test" | "remove" | "model" | null>(null);
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
  const hasKey = status?.key.source === "pasted" || status?.key.source === "server";

  async function handleSave() {
    if (!keyLooksValid) return;
    const key = keyInput.trim();
    // Cleared after every attempt, success or failure.
    setKeyInput("");
    setKeyError(null);
    setBusy("save");
    setTestResult(null);
    try {
      setStatus(await callAi<AiStatus>({ action: "save", apiKey: key }));
      toast({ title: "AI is connected", description: "Anthropic accepted the key and it was saved." });
    } catch (e) {
      setKeyError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function handleModel(model: string) {
    if (!status || model === status.model) return;
    setBusy("model");
    setTestResult(null);
    try {
      setStatus(await callAi<AiStatus>({ action: "set_model", model }));
      toast({ title: "Model saved", description: `Every AI feature now uses ${model}.` });
    } catch (e) {
      toast({ title: "Could not change the model", description: (e as Error).message, variant: "destructive" });
    } finally {
      setBusy(null);
    }
  }

  async function handleTest() {
    setBusy("test");
    setTestResult(null);
    try {
      const r = await callAi<{ ok: boolean; error?: string; model?: string; reply?: string }>({ action: "test" });
      setTestResult(
        r.ok
          ? { ok: true, text: `OK — ${r.model} answered${r.reply ? `: “${r.reply}”` : "."}` }
          : { ok: false, text: r.error || "Test failed." },
      );
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
      setStatus(await callAi<AiStatus>({ action: "remove" }));
      toast({ title: "Saved key removed" });
    } catch (e) {
      toast({ title: "Could not remove the key", description: (e as Error).message, variant: "destructive" });
    } finally {
      setBusy(null);
    }
  }

  const canRemove = status?.key.source === "pasted" || status?.key.source === "unreadable";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Sparkles className="h-5 w-5" /> AI (Claude API)</CardTitle>
        <CardDescription>
          The Anthropic API key and model used by every AI feature. The key is checked with Anthropic, stored encrypted in
          Supabase Vault, and never shown again after saving. Get a key at console.anthropic.com › API keys; the account needs
          API credit (a Claude subscription does not cover the API).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
        ) : status && (
          <div className="rounded-lg border border-border p-4 space-y-2 text-sm">
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">AI:</span>
              <Badge variant={hasKey ? "secondary" : "destructive"}>{hasKey ? "Connected" : "Not set up"}</Badge>
            </div>
            <div className={status.key.source === "unreadable" ? "text-destructive" : "text-foreground"}>{keyLine(status.key)}</div>
          </div>
        )}

        <div className="space-y-2 max-w-lg">
          <Label htmlFor="anthropic-key">{status?.key.source === "pasted" ? "Replace key" : "Paste key"}</Label>
          <Input
            id="anthropic-key"
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder="sk-ant-…"
            value={keyInput}
            onChange={e => { setKeyInput(e.target.value); setKeyError(null); }}
          />
          {keyInput && !keyLooksValid ? (
            <p className="text-xs text-destructive">An Anthropic API key starts with sk-ant-. Copy it again from console.anthropic.com.</p>
          ) : keyError ? (
            <p className="text-sm text-destructive">{keyError}</p>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button onClick={handleSave} disabled={!keyLooksValid || busy !== null}>
            {busy === "save" ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <KeyRound className="h-4 w-4 mr-2" />}
            {busy === "save" ? "Checking with Anthropic…" : "Save"}
          </Button>
          <Button variant="outline" onClick={handleTest} disabled={busy !== null || !hasKey}>
            {busy === "test" && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Test connection
          </Button>
          {canRemove && (
            <Button variant="outline" onClick={() => setConfirmRemove(true)} disabled={busy !== null}>
              {busy === "remove" ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Trash2 className="h-4 w-4 mr-2" />} Remove key
            </Button>
          )}
        </div>

        {testResult && (
          <div className={`flex items-start gap-2 text-sm ${testResult.ok ? "text-green-700 dark:text-green-400" : "text-destructive"}`}>
            {testResult.ok ? <CheckCircle2 className="h-4 w-4 mt-0.5" /> : <XCircle className="h-4 w-4 mt-0.5" />}
            <span>{testResult.text}</span>
          </div>
        )}

        {status && (
          <div className="space-y-2 max-w-lg border-t border-border pt-6">
            <Label htmlFor="anthropic-model">Model</Label>
            <Select value={status.model} onValueChange={handleModel} disabled={busy !== null}>
              <SelectTrigger id="anthropic-model" aria-label="Model">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {status.models.map(m => (
                  <SelectItem key={m.id} value={m.id}>{m.label}</SelectItem>
                ))}
                {!status.models.some(m => m.id === status.model) && (
                  <SelectItem value={status.model} disabled>{status.model} (set in Vercel)</SelectItem>
                )}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Used for every AI feature. Quick background tasks keep using Claude Haiku 5.5.
              {status.modelSource === "settings" && status.modelSavedBy
                ? ` Chosen by ${status.modelSavedBy}${status.modelSavedOn ? ` on ${formatDate(status.modelSavedOn)}` : ""}.`
                : status.modelSource === "env" ? " Currently set by ANTHROPIC_MODEL in Vercel; a choice here wins." : ""}
            </p>
          </div>
        )}
      </CardContent>

      <AlertDialog open={confirmRemove} onOpenChange={setConfirmRemove}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove saved API key</AlertDialogTitle>
            <AlertDialogDescription>
              {status?.serverKeySet
                ? "AI features will fall back to the ANTHROPIC_API_KEY set in Vercel."
                : "No key is set in Vercel, so AI features will stop working until a key is pasted again."}
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
