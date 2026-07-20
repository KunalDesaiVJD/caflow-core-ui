/**
 * Materiality approval queue (firm-wide).
 *
 * Scrutiny thresholds scale to each engagement's materiality, but the scale is a professional
 * judgement under SA 320 — the engine proposes and never decides. This panel is where a firm
 * clears that backlog: every engagement, what the system suggested and why, and an editable set of
 * figures to approve.
 *
 * Until an engagement is approved its rules fall back to their literal thresholds, so nothing here
 * can break a run — an unapproved engagement behaves exactly as it does today.
 *
 * Reads gracefully: shows a notice if the data isn't reachable, never crashes.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertTriangle, CheckCircle2, Info, Scale, Loader2, RotateCcw } from "lucide-react";
import {
  materialityQueue, queueTotals, validateMateriality, basisLabel, inr,
  type MaterialityRow, type QueueItem,
} from "@/lib/scrutiny/materialityQueue";

const JUDGMENT_KIND = "materiality";

export default function MaterialityQueuePanel() {
  const { user } = useAuth();
  const { toast } = useToast();

  const [rows, setRows] = useState<MaterialityRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [reachable, setReachable] = useState(true);
  const [editing, setEditing] = useState<QueueItem | null>(null);
  const [form, setForm] = useState({ materiality: "", performance: "", trivial: "", rationale: "" });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!user?.firm_id) { setLoading(false); return; }
    setLoading(true);
    try {
      const { data: clients, error: cErr } = await (supabase.from as any)("clients")
        .select("id, name").eq("firm_id", user.firm_id);
      if (cErr || !clients) { setReachable(false); setLoading(false); return; }
      const nameById = new Map((clients as { id: string; name: string }[]).map((c) => [c.id, c.name]));
      const ids = [...nameById.keys()];
      if (!ids.length) { setRows([]); setLoading(false); return; }

      const { data: judgments, error: jErr } = await (supabase.from as any)("scrutiny_judgments")
        .select("id, client_id, financial_year, status, proposed, decided, decided_at")
        .eq("kind", JUDGMENT_KIND).in("client_id", ids).in("status", ["proposed", "approved"]).limit(1000);
      if (jErr) { setReachable(false); setLoading(false); return; }

      // Open findings per engagement — the size of the prize for approving each one. Read from the
      // grouped view rather than counting rows here: ~110 small rows instead of every finding in
      // the firm, and it stays cheap as the finding count grows.
      const { data: counts_ } = await (supabase.from as any)("scrutiny_open_finding_counts")
        .select("client_id, financial_year, open_count").in("client_id", ids);
      const counts = new Map<string, number>(
        ((counts_ ?? []) as { client_id: string; financial_year: string; open_count: number }[])
          .map((c) => [`${c.client_id}|${c.financial_year}`, c.open_count]),
      );

      setRows(((judgments ?? []) as MaterialityRow[]).map((j) => ({
        ...j,
        client_name: nameById.get(j.client_id) ?? "Unknown client",
        finding_count: counts.get(`${j.client_id}|${j.financial_year}`) ?? 0,
      })));
      setReachable(true);
    } catch {
      setReachable(false);
    } finally {
      setLoading(false);
    }
  }, [user?.firm_id]);

  useEffect(() => { void load(); }, [load]);

  const items = useMemo(() => materialityQueue(rows), [rows]);
  const totals = useMemo(() => queueTotals(items), [items]);

  const openEditor = (item: QueueItem) => {
    const src = item.decided ?? item.proposed ?? {};
    setForm({
      materiality: String(src.materiality ?? ""),
      performance: String(src.performance ?? ""),
      trivial: String(src.trivial ?? ""),
      rationale: "",
    });
    setEditing(item);
  };

  const resetToProposal = () => {
    const p = editing?.proposed ?? {};
    setForm((f) => ({ ...f, materiality: String(p.materiality ?? ""), performance: String(p.performance ?? ""), trivial: String(p.trivial ?? "") }));
  };

  const values = {
    materiality: Number(form.materiality),
    performance: Number(form.performance),
    trivial: Number(form.trivial),
  };
  const error = validateMateriality(values);

  const approve = async () => {
    if (!editing || error) return;
    setSaving(true);
    try {
      const { error: uErr } = await (supabase.from as any)("scrutiny_judgments")
        .update({
          decided: values,
          status: "approved",
          decided_by: user?.id ?? null,
          decided_at: new Date().toISOString(),
          rationale: form.rationale || null,
        })
        .eq("id", editing.id);
      if (uErr) throw uErr;
      toast({
        title: "Materiality approved",
        description: `${editing.client_name} ${editing.financial_year} — thresholds will scale to ${inr(values.performance)} on the next run.`,
      });
      setEditing(null);
      await load();
    } catch (e) {
      toast({ title: "Could not save", description: (e as Error).message ?? "Please try again.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="space-y-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-11 w-full" />)}</div>;

  if (!reachable) {
    return (
      <div className="flex items-start gap-2 rounded-md border border-muted-foreground/30 bg-muted/40 p-3 text-sm text-muted-foreground">
        <Info size={15} className="mt-0.5 shrink-0" />
        <span>The materiality queue isn&apos;t reachable right now. Scrutiny still runs — every engagement falls back to its standard thresholds until materiality is approved.</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2 rounded-md border border-muted-foreground/30 bg-muted/40 p-3 text-sm text-muted-foreground">
        <Scale size={15} className="mt-0.5 shrink-0" />
        <span>
          Scrutiny thresholds scale to each engagement once you approve its materiality. The figures below are
          suggestions from the entity&apos;s own turnover or asset base — edit anything that doesn&apos;t match your
          judgement of the engagement. Until approved, a client&apos;s rules keep using their standard thresholds.
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          { k: "Awaiting approval", v: totals.pending },
          { k: "Approved", v: totals.approved },
          { k: "Need your figure", v: totals.needsAttention },
          { k: "Findings not yet scaled", v: totals.findingsBlocked.toLocaleString("en-IN") },
        ].map((t) => (
          <div key={t.k} className="rounded-md border bg-card p-3">
            <div className="text-xl font-semibold tabular-nums">{t.v}</div>
            <div className="text-xs text-muted-foreground">{t.k}</div>
          </div>
        ))}
      </div>

      {!items.length ? (
        <div className="rounded-md border p-6 text-center text-sm text-muted-foreground">
          No engagements yet. Materiality is proposed once a client has a trial balance loaded.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Client</TableHead>
                <TableHead>Year</TableHead>
                <TableHead className="text-right">Open findings</TableHead>
                <TableHead className="text-right">Performance materiality</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-px" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((i) => (
                <TableRow key={i.id} className={i.needsAttention && i.status === "proposed" ? "bg-amber-500/5" : undefined}>
                  <TableCell>
                    <div className="font-medium">{i.client_name}</div>
                    <div className="text-xs text-muted-foreground">{basisLabel(i)}</div>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-sm">{i.financial_year}</TableCell>
                  <TableCell className="text-right tabular-nums text-sm">{(i.finding_count ?? 0).toLocaleString("en-IN")}</TableCell>
                  <TableCell className="text-right tabular-nums text-sm">
                    {inr(i.decided?.performance ?? i.proposed?.performance)}
                    {i.overridePct != null && i.overridePct !== 0 && (
                      <span className="ml-1.5 text-xs text-muted-foreground">
                        ({i.overridePct > 0 ? "+" : ""}{i.overridePct}% vs proposed)
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    {i.status === "approved" ? (
                      <Badge variant="outline" className="gap-1 border-green-300 bg-green-500/15 text-green-700">
                        <CheckCircle2 size={11} /> Approved
                      </Badge>
                    ) : i.needsAttention ? (
                      <Badge variant="outline" className="gap-1 border-amber-300 bg-amber-500/15 text-amber-700">
                        <AlertTriangle size={11} /> Needs your figure
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="border-muted-foreground/30 bg-muted text-muted-foreground">
                        Awaiting approval
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <Button size="sm" variant={i.status === "approved" ? "outline" : "default"} onClick={() => openEditor(i)}>
                      {i.status === "approved" ? "Revise" : "Review"}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing?.client_name} — {editing?.financial_year}</DialogTitle>
          </DialogHeader>

          {editing && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">{editing.proposed?.rationale}</p>

              <div className="grid gap-3">
                {([
                  ["materiality", "Overall materiality", "The level at which a misstatement would influence a reader of the accounts."],
                  ["performance", "Performance materiality", "The working level rule thresholds scale to. Normally below overall materiality."],
                  ["trivial", "Clearly trivial", "Anything below this is not raised at all."],
                ] as const).map(([key, label, help]) => (
                  <div key={key} className="space-y-1">
                    <label className="text-xs font-medium" htmlFor={`mat-${key}`}>{label}</label>
                    <Input
                      id={`mat-${key}`}
                      inputMode="numeric"
                      value={form[key]}
                      onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value.replace(/[^0-9]/g, "") }))}
                    />
                    <p className="text-xs text-muted-foreground">{help}</p>
                  </div>
                ))}
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium" htmlFor="mat-rationale">Reason for any change (optional)</label>
                <Textarea
                  id="mat-rationale"
                  rows={2}
                  value={form.rationale}
                  placeholder="e.g. first-year engagement, so set below the computed level"
                  onChange={(e) => setForm((f) => ({ ...f, rationale: e.target.value }))}
                />
              </div>

              {error && (
                <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm text-destructive">
                  <AlertTriangle size={15} className="mt-0.5 shrink-0" />
                  <span>{error}</span>
                </div>
              )}
            </div>
          )}

          <DialogFooter className="gap-2 sm:justify-between">
            <Button variant="ghost" size="sm" onClick={resetToProposal} className="gap-1.5">
              <RotateCcw size={13} /> Reset to suggestion
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
              <Button onClick={approve} disabled={!!error || saving} className="gap-1.5">
                {saving && <Loader2 size={13} className="animate-spin" />}
                Approve
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
