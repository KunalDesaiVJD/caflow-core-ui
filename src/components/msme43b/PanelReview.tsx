// MSME 43B(h) — the Claude ↔ GPT review panel, rendered as a transcript.
//
// The debate is shown in full, in order, so a reviewer can read the actual
// reasoning rather than a verdict. Concessions are marked, and the final
// "unresolved" list is given the most prominent treatment — those are the
// points that need a partner's judgement, and they are the whole reason for
// running two models against each other instead of trusting one.

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Loader2, Gavel, CheckCircle2, AlertTriangle, MessageSquare, Scale } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  runPanelReview, type PanelReview as PanelReviewData, type PanelEvidenceInput,
} from '@/lib/msme43b';

export interface PanelReviewProps {
  input: PanelEvidenceInput;
  /**
   * The transcript held by the page, so it can be filed against the run and
   * restored after a refresh. Passing the prop at all makes this component
   * controlled — `null` then means "no panel has been run on these figures",
   * which is exactly what should be shown after a new analysis.
   */
  value?: PanelReviewData | null;
  onResult?: (review: PanelReviewData) => void;
  /** e.g. "Filed against the saved run." — shown next to the badge */
  savedNote?: string | null;
}

export function PanelReview({ input, value, onResult, savedNote }: PanelReviewProps) {
  const [busy, setBusy] = useState(false);
  const [local, setLocal] = useState<PanelReviewData | null>(null);
  const controlled = value !== undefined;
  const review = controlled ? value : local;
  const [open, setOpen] = useState(false);
  /**
   * A failure is KEPT ON SCREEN, not flashed as a toast. A toast disappears in a
   * few seconds, so the one piece of text that says what to fix — a spent
   * account, a withdrawn model, a missing key — was gone before it could be read
   * or passed on, and the card just sat there looking like nothing had happened.
   */
  const [failure, setFailure] = useState<string | null>(null);
  /** which of the four turns is running — the panel takes a couple of minutes */
  const [turn, setTurn] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setFailure(null);
    setTurn(null);
    try {
      const r = await runPanelReview(input, (n, of, what) => setTurn(`Turn ${n} of ${of} — ${what}`));
      if (!controlled) setLocal(r);
      onResult?.(r);
      setOpen(true);
      if (r.gptFinal.consensus) toast.success('The panel reached consensus.');
      else toast.warning(`The panel left ${r.gptFinal.unresolved.length} point(s) unresolved — these need your judgement.`);
    } catch (e) {
      setFailure((e as Error).message);
    } finally {
      setBusy(false);
      setTurn(null);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Gavel className="h-4 w-4" /> Independent review panel — Claude vs GPT
        </CardTitle>
        <CardDescription>
          Claude states an opinion on the interpretation applied, GPT challenges it, Claude answers,
          GPT closes. Two models from different families arguing catch reasoning a single opinion
          states too confidently. Neither produces a figure — the numbers stay with the engine.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={run} disabled={busy} variant={review ? 'outline' : 'default'}>
            {busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Scale className="h-4 w-4 mr-2" />}
            {review ? 'Run the panel again' : 'Run the review panel'}
          </Button>
          {busy && (
            <span className="text-xs text-muted-foreground">
              {turn ?? 'Starting…'} · four turns, about two minutes in total
            </span>
          )}
          {review && (
            <>
              <Badge variant={review.gptFinal.consensus ? 'secondary' : 'destructive'}>
                {review.gptFinal.consensus ? 'Consensus reached' : `${review.gptFinal.unresolved.length} unresolved`}
              </Badge>
              <span className="text-xs text-muted-foreground">{review.models.claude} · {review.models.gpt}</span>
              <Button size="sm" variant="ghost" onClick={() => setOpen((o) => !o)}>
                {open ? 'Hide transcript' : 'Show transcript'}
              </Button>
              {savedNote && <span className="text-xs text-muted-foreground">{savedNote}</span>}
            </>
          )}
        </div>

        {failure && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>The review panel could not be run</AlertTitle>
            <AlertDescription className="text-sm">
              {failure}
              <p className="text-xs mt-2">
                This affects the panel only. The disallowance figures above come from the
                deterministic engine and are unchanged — the panel reviews the reasoning, it never
                produces a number.
              </p>
            </AlertDescription>
          </Alert>
        )}

        {review && (
          <>
            {/* ── the outcome that matters ── */}
            {review.gptFinal.unresolved.length > 0 ? (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Points the panel could not settle — your judgement required</AlertTitle>
                <AlertDescription className="text-sm space-y-2">
                  {review.gptFinal.unresolved.map((u, i) => (
                    <div key={i} className="border-l-2 border-current/30 pl-3">
                      <div className="font-medium">{u.topic}</div>
                      <div className="text-xs"><b>Claude:</b> {u.claudeView}</div>
                      <div className="text-xs"><b>GPT:</b> {u.gptView}</div>
                      <div className="text-xs italic">Decided by: {u.whoDecides}</div>
                    </div>
                  ))}
                </AlertDescription>
              </Alert>
            ) : (
              <Alert>
                <CheckCircle2 className="h-4 w-4" />
                <AlertTitle>Both reviewers agree on the interpretation applied</AlertTitle>
                <AlertDescription className="text-sm">
                  {review.gptFinal.overall}
                  <p className="text-xs text-muted-foreground mt-2">
                    Agreement between two models is evidence the reasoning is defensible. It is not a
                    legal opinion, and it does not verify the arithmetic — that is what the reconciliation
                    and the independent cross-check engine are for.
                  </p>
                </AlertDescription>
              </Alert>
            )}

            {review.gptFinal.recommendedActions.length > 0 && (
              <div className="rounded-md border p-3">
                <div className="text-sm font-medium mb-1">Recommended before signing</div>
                <ul className="text-sm list-disc pl-5 space-y-0.5">
                  {review.gptFinal.recommendedActions.map((a, i) => <li key={i}>{a}</li>)}
                </ul>
              </div>
            )}

            {review.gptFinal.agreed.length > 0 && (
              <div className="rounded-md border bg-muted/20 p-3">
                <div className="text-sm font-medium mb-1">Agreed between both reviewers</div>
                <ul className="text-xs text-muted-foreground list-disc pl-5 space-y-0.5">
                  {review.gptFinal.agreed.map((a, i) => <li key={i}>{a}</li>)}
                </ul>
              </div>
            )}

            {/* ── the full debate ── */}
            {open && (
              <div className="space-y-3">
                <Turn who="Claude" label="Opening opinion" tone="claude">
                  {review.claudeOpinion.overall && <p className="mb-2">{review.claudeOpinion.overall}</p>}
                  {review.claudeOpinion.positions.map((p, i) => (
                    <div key={i} className="mb-2">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{p.topic}</span>
                        <Badge
                          variant={p.assessment === 'sound' ? 'secondary' : p.assessment === 'wrong' ? 'destructive' : 'outline'}
                          className="text-[10px]"
                        >
                          {p.assessment}
                        </Badge>
                      </div>
                      <div className="text-muted-foreground">{p.reasoning}</div>
                    </div>
                  ))}
                  {review.claudeOpinion.risks.length > 0 && (
                    <div className="mt-2">
                      <div className="font-medium">Risks flagged</div>
                      <ul className="list-disc pl-5 text-muted-foreground">
                        {review.claudeOpinion.risks.map((r, i) => <li key={i}>{r}</li>)}
                      </ul>
                    </div>
                  )}
                </Turn>

                <Turn who="GPT" label="Challenge" tone="gpt">
                  {review.gptCritique.overall && <p className="mb-2">{review.gptCritique.overall}</p>}
                  {review.gptCritique.challenges.map((c, i) => (
                    <div key={i} className="mb-2">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{c.topic}</span>
                        <Badge variant={c.agree ? 'secondary' : 'destructive'} className="text-[10px]">
                          {c.agree ? 'agrees' : 'objects'}
                        </Badge>
                      </div>
                      {c.objection && <div className="text-muted-foreground">{c.objection}</div>}
                      {c.authority && <div className="text-xs italic text-muted-foreground">Authority: {c.authority}</div>}
                    </div>
                  ))}
                  {review.gptCritique.missed.length > 0 && (
                    <div className="mt-2">
                      <div className="font-medium">Said to be missed by both the tool and the first opinion</div>
                      <ul className="list-disc pl-5 text-muted-foreground">
                        {review.gptCritique.missed.map((m, i) => <li key={i}>{m}</li>)}
                      </ul>
                    </div>
                  )}
                </Turn>

                <Turn who="Claude" label="Response" tone="claude">
                  {review.claudeResponse.overall && <p className="mb-2">{review.claudeResponse.overall}</p>}
                  {review.claudeResponse.responses.map((r, i) => (
                    <div key={i} className="mb-2">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{r.topic}</span>
                        <Badge
                          variant={r.outcome === 'conceded' ? 'destructive' : r.outcome === 'maintained' ? 'secondary' : 'outline'}
                          className="text-[10px]"
                        >
                          {r.outcome}
                        </Badge>
                      </div>
                      <div className="text-muted-foreground">{r.reasoning}</div>
                    </div>
                  ))}
                  {review.claudeResponse.revisedPositions.length > 0 && (
                    <div className="mt-2">
                      <div className="font-medium">Positions revised after the challenge</div>
                      <ul className="list-disc pl-5 text-muted-foreground">
                        {review.claudeResponse.revisedPositions.map((p, i) => <li key={i}>{p}</li>)}
                      </ul>
                    </div>
                  )}
                </Turn>

                <Turn who="GPT" label="Final verdict" tone="gpt">
                  <p>{review.gptFinal.overall}</p>
                </Turn>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Turn({ who, label, tone, children }: {
  who: string; label: string; tone: 'claude' | 'gpt'; children: React.ReactNode;
}) {
  return (
    <div className={cn(
      'rounded-md border p-3 text-sm',
      tone === 'claude' ? 'bg-primary/5 border-primary/20' : 'bg-muted/40',
    )}>
      <div className="flex items-center gap-2 mb-2">
        <MessageSquare className="h-3.5 w-3.5" />
        <span className="font-semibold">{who}</span>
        <Badge variant="outline" className="text-[10px]">{label}</Badge>
      </div>
      {children}
    </div>
  );
}
