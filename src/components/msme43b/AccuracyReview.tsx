// MSME 43B(h) — "Is this working correct?"
//
// The loop the firm asked for:
//   1. The tool shows its answer and asks the reviewer to confirm it.
//   2. YES  → the run is signed off and kept as a golden case. Every future rule
//            change is replayed against it, so today's agreed answer can never be
//            silently changed by tomorrow's learning.
//   3. NO   → the reviewer uploads their own working. The tool diffs it, searches
//            its permitted legal positions for the interpretation that reproduces
//            the reviewer's figures, optionally asks Claude for a second opinion
//            on whether that reading is defensible, and — only on a human click —
//            adopts the rule and re-runs.
//
// The honest part, and it is deliberately prominent in this UI: differences the
// rule space cannot explain are shown as UNEXPLAINED with their amount. The tool
// does not close a gap it cannot justify.

import { useCallback, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  CheckCircle2, XCircle, Upload, Loader2, AlertTriangle, Sparkles, ShieldCheck,
  ScrollText, HelpCircle, Lock,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  parseExpectedWorking, diffAgainstExpected, calibrate, applyProposals, reviewDifference,
  disclosedAssumptions, vendorWindowMap, vendorGstMap,
  type ExpectedWorking, type DiffResult, type CalibrationResult, type Proposal,
  type GoldenCase, type RuleProfile, type AiReview,
  type VendorLedger, type Msme43bReport, type Msme43bConfig,
} from '@/lib/msme43b';

const inr = (v: number) =>
  new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(Math.round(Math.abs(v)));

const signed = (v: number) => `${v < 0 ? '−' : '+'}₹${inr(v)}`;

export interface AccuracyReviewProps {
  report: Msme43bReport;
  cyLedgers: VendorLedger[];
  fyLedgers: VendorLedger[];
  config: Msme43bConfig;
  profile: RuleProfile | null;
  goldens: GoldenCase[];
  clientId: string;
  persistOff: boolean;
  /** sign the current run off as correct */
  onSignOff: (label: string) => Promise<void>;
  /** adopt an updated rule profile — the parent re-runs the engine */
  onAdoptProfile: (profile: RuleProfile, meta: { sourceFile: string; matchedBefore: number; matchedAfter: number }) => Promise<void>;
}

export function AccuracyReview(props: AccuracyReviewProps) {
  const { report, cyLedgers, fyLedgers, config, profile, goldens, clientId, persistOff } = props;

  const [mode, setMode] = useState<'ask' | 'signing' | 'disputing'>('ask');
  const [signLabel, setSignLabel] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [expected, setExpected] = useState<ExpectedWorking | null>(null);
  const [rawDiff, setRawDiff] = useState<DiffResult | null>(null);
  const [calib, setCalib] = useState<CalibrationResult | null>(null);
  const [accepted, setAccepted] = useState<Set<number>>(new Set());
  const [ai, setAi] = useState<AiReview | null>(null);
  const [showAssumptions, setShowAssumptions] = useState(false);
  const [matchTolerance, setMatchTolerance] = useState(1);

  const assumptions = useMemo(() => disclosedAssumptions(config), [config]);
  const nonDefault = assumptions.filter((a) => !a.isDefault);

  // ── sign off ────────────────────────────────────────────────────────────
  const doSignOff = useCallback(async () => {
    setBusy('sign');
    try {
      await props.onSignOff(signLabel.trim() || `${report.cyLabel} — signed off`);
      setMode('ask');
      setSignLabel('');
    } finally {
      setBusy(null);
    }
  }, [props, signLabel, report.cyLabel]);

  // ── upload the reviewer's working ───────────────────────────────────────
  const onUpload = useCallback(async (file: File) => {
    setBusy('parse');
    setCalib(null); setAi(null); setAccepted(new Set());
    try {
      const parsed = await parseExpectedWorking(file);
      if (!parsed.rows.length) {
        toast.error('No vendor rows could be read from that file. Check it has a vendor column and a disallowance column.');
        return;
      }
      setExpected(parsed);
      setRawDiff(diffAgainstExpected(report, parsed, matchTolerance));
      for (const w of parsed.warnings) toast.warning(w);
      toast.success(`Read ${parsed.rows.length} vendor row(s) from your working.`);
    } catch (e) {
      toast.error(`Could not read the working paper: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  }, [report, matchTolerance]);

  // ── search the rule space ───────────────────────────────────────────────
  const runCalibration = useCallback(() => {
    if (!expected) return;
    setBusy('calibrate');
    // Yield a frame so the spinner paints before the synchronous search.
    setTimeout(() => {
      try {
        const res = calibrate({
          cyLedgers, fyLedgers, expected,
          baseConfig: config,
          clientName: report.clientName,
          vendorWindows: vendorWindowMap(profile),
          vendorGstRates: vendorGstMap(profile),
          goldens,
          matchTolerance,
        });
        setCalib(res);
        setAccepted(new Set(res.proposals.map((_, i) => i)));
        if (!res.proposals.length) {
          toast.warning('No permitted interpretation reduces the difference — see the unexplained items.');
        } else {
          toast.success(`Found ${res.proposals.length} candidate rule change(s) from ${res.variantsEvaluated} configurations tested.`);
        }
      } catch (e) {
        toast.error(`Calibration failed: ${(e as Error).message}`);
      } finally {
        setBusy(null);
      }
    }, 30);
  }, [expected, cyLedgers, fyLedgers, config, report.clientName, profile, goldens, matchTolerance]);

  // ── AI second opinion ───────────────────────────────────────────────────
  const askClaude = useCallback(async () => {
    if (!calib) return;
    setBusy('ai');
    try {
      setAi(await reviewDifference(calib, { cyLabel: report.cyLabel, fyLabel: report.fyLabel }));
    } catch (e) {
      toast.error(`AI review failed: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  }, [calib, report.cyLabel, report.fyLabel]);

  // ── adopt ───────────────────────────────────────────────────────────────
  const adopt = useCallback(async () => {
    if (!calib || !expected) return;
    const picks = calib.proposals.filter((_, i) => accepted.has(i));
    if (!picks.length) { toast.error('Select at least one rule to adopt.'); return; }

    const { profile: next, errors } = applyProposals(profile, picks, {
      reason: `Calibrated against "${expected.fileName}".`,
    });
    if (errors.length) { toast.error(errors[0]); return; }

    setBusy('adopt');
    try {
      await props.onAdoptProfile(next, {
        sourceFile: expected.fileName,
        matchedBefore: calib.before.matched,
        matchedAfter: calib.after.matched,
      });
      setCalib(null); setAi(null); setExpected(null); setRawDiff(null);
      setMode('ask');
    } finally {
      setBusy(null);
    }
  }, [calib, expected, accepted, profile, props]);

  const diff = calib?.after ?? rawDiff;

  return (
    <Card className="border-primary/30">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <ShieldCheck className="h-4 w-4" /> Is this working correct?
        </CardTitle>
        <CardDescription>
          Confirm the result, or upload your own working and let the tool find which interpretation
          you are applying. Adopted rules are saved against this client and used from the next run onwards.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* ── assumptions in force ── */}
        <div className="rounded-md border bg-muted/30 p-3 space-y-2">
          <button
            className="flex items-center gap-2 text-sm font-medium"
            onClick={() => setShowAssumptions((s) => !s)}
          >
            <ScrollText className="h-4 w-4" />
            Interpretation applied
            {nonDefault.length > 0 && (
              <Badge variant="secondary" className="text-[10px]">{nonDefault.length} learned</Badge>
            )}
            {profile && (profile.vendorWindows.length + (profile.vendorGstRates?.length ?? 0)) > 0 && (
              <Badge variant="outline" className="text-[10px]">
                {profile.vendorWindows.length + (profile.vendorGstRates?.length ?? 0)} vendor declaration(s)
              </Badge>
            )}
            <span className="text-xs text-muted-foreground">({showAssumptions ? 'hide' : 'show all'})</span>
          </button>

          {!showAssumptions && nonDefault.length > 0 && (
            <div className="text-xs text-muted-foreground">
              Differs from the standard position on: {nonDefault.map((a) => `${a.title} — ${a.position}`).join(' · ')}
            </div>
          )}

          {showAssumptions && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Question</TableHead>
                  <TableHead className="text-xs">Position taken</TableHead>
                  <TableHead className="text-xs">Basis</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {assumptions.map((a) => (
                  <TableRow key={a.title}>
                    <TableCell className="text-xs align-top">
                      <div className="font-medium">{a.title}</div>
                      <div className="text-muted-foreground">{a.question}</div>
                    </TableCell>
                    <TableCell className="text-xs align-top whitespace-nowrap">
                      {a.position}
                      {!a.isDefault && <Badge variant="secondary" className="ml-2 text-[10px]">learned</Badge>}
                    </TableCell>
                    <TableCell className="text-xs align-top text-muted-foreground">{a.basis}</TableCell>
                  </TableRow>
                ))}
                {profile?.vendorGstRates?.map((d) => (
                  <TableRow key={`gst-${d.key}`}>
                    <TableCell className="text-xs align-top">
                      <div className="font-medium">GST declaration — {d.vendorName}</div>
                      <div className="text-muted-foreground">What rate does this vendor charge?</div>
                    </TableCell>
                    <TableCell className="text-xs align-top whitespace-nowrap">{d.gstRate}%</TableCell>
                    <TableCell className="text-xs align-top text-muted-foreground">
                      Ledger shows no tax split; taxable value derived from the declared rate.
                      {d.declaredBy ? ` Declared by ${d.declaredBy}.` : ''}
                    </TableCell>
                  </TableRow>
                ))}
                {profile?.vendorWindows.map((d) => (
                  <TableRow key={d.key}>
                    <TableCell className="text-xs align-top">
                      <div className="font-medium">Vendor declaration — {d.vendorName}</div>
                      <div className="text-muted-foreground">Is there a written agreement with this vendor?</div>
                    </TableCell>
                    <TableCell className="text-xs align-top whitespace-nowrap">{d.windowDays} days</TableCell>
                    <TableCell className="text-xs align-top text-muted-foreground">
                      {d.basis === 'agreement' ? 'Written agreement declared on file.' : 'No written agreement declared.'}
                      {d.declaredBy ? ` Declared by ${d.declaredBy}.` : ''}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>

        {/* ── the question ── */}
        {mode === 'ask' && (
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={() => setMode('signing')} disabled={persistOff || !clientId}>
              <CheckCircle2 className="h-4 w-4 mr-2" /> Correct — sign off
            </Button>
            <Button variant="outline" onClick={() => setMode('disputing')}>
              <XCircle className="h-4 w-4 mr-2" /> Not correct — upload my working
            </Button>
            {(persistOff || !clientId) && (
              <span className="text-xs text-muted-foreground">
                {persistOff ? 'Calibration tables not deployed yet — apply the migration to save rules and sign-offs.' : 'Select a client to sign off.'}
              </span>
            )}
            {goldens.length > 0 && (
              <span className="text-xs text-emerald-700 flex items-center gap-1">
                <Lock className="h-3 w-3" />
                {goldens.length} signed-off run(s) protected from future rule changes
              </span>
            )}
          </div>
        )}

        {/* ── sign off ── */}
        {mode === 'signing' && (
          <div className="space-y-3">
            <Alert>
              <ShieldCheck className="h-4 w-4" />
              <AlertTitle>Sign this run off as correct</AlertTitle>
              <AlertDescription className="text-sm">
                The ledgers and the agreed figures are stored together. Any rule the tool later proposes is
                re-run against this case first, and discarded if it would change these numbers. That is what
                stops the tool "improving" itself into disagreeing with work you have already signed.
              </AlertDescription>
            </Alert>
            <div className="flex gap-2 items-center">
              <Input
                autoFocus value={signLabel} onChange={(e) => setSignLabel(e.target.value)}
                placeholder={`${report.cyLabel} — signed off`} className="h-9 max-w-sm"
                onKeyDown={(e) => { if (e.key === 'Enter') doSignOff(); }}
              />
              <Button onClick={doSignOff} disabled={busy === 'sign'}>
                {busy === 'sign' ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}
                Confirm sign-off
              </Button>
              <Button variant="ghost" onClick={() => setMode('ask')}>Cancel</Button>
            </div>
          </div>
        )}

        {/* ── dispute ── */}
        {mode === 'disputing' && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Your working paper (Excel, CSV or PDF)</label>
                <Input
                  type="file" accept=".xlsx,.xlsm,.xls,.csv,.tsv,.pdf" className="h-9 max-w-sm"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) onUpload(f); }}
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Agreement bar (₹)</label>
                <Input
                  type="number" min={0} value={matchTolerance} className="h-9 w-28"
                  onChange={(e) => setMatchTolerance(Math.max(0, Number(e.target.value) || 0))}
                />
              </div>
              <Button variant="ghost" onClick={() => { setMode('ask'); setExpected(null); setRawDiff(null); setCalib(null); setAi(null); }}>
                Cancel
              </Button>
              {busy === 'parse' && <span className="text-xs flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> Reading…</span>}
            </div>

            {expected && (
              <div className="text-xs text-muted-foreground flex flex-wrap gap-x-4 gap-y-1">
                <span>Read <b>{expected.rows.length}</b> rows from <b>{expected.fileName}</b></span>
                <span>via {expected.source === 'ai' ? 'Claude (any format)' : 'direct column mapping'}</span>
                {expected.columnMap && (
                  <span>columns: {Object.entries(expected.columnMap).map(([f, l]) => `${l} → ${f}`).join(', ')}</span>
                )}
              </div>
            )}

            {/* ── the comparison ── */}
            {diff && (
              <>
                <div className="grid gap-3 sm:grid-cols-4">
                  <Stat label="Vendors agreeing" value={String(diff.matched)} tone="ok" />
                  <Stat label="Vendors differing" value={String(diff.differing + diff.onlyOurs + diff.onlyTheirs)} tone={diff.differing ? 'danger' : 'neutral'} />
                  <Stat label="Your total" value={`₹${inr(diff.theirTotal)}`} tone="neutral" />
                  <Stat label="Tool total" value={`₹${inr(diff.ourTotal)}`} tone={Math.abs(diff.totalDelta) > matchTolerance ? 'danger' : 'ok'} />
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Button onClick={runCalibration} disabled={!expected || busy !== null}>
                    {busy === 'calibrate' ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}
                    Find the rule that explains the difference
                  </Button>
                  {calib && (
                    <Button variant="outline" onClick={askClaude} disabled={busy !== null}>
                      {busy === 'ai' ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <HelpCircle className="h-4 w-4 mr-2" />}
                      Ask Claude whether that reading is defensible
                    </Button>
                  )}
                </div>

                <VendorDiffTable diff={diff} />
              </>
            )}

            {/* ── proposals ── */}
            {calib && (
              <div className="space-y-3">
                {calib.proposals.length > 0 && (
                  <div className="rounded-md border">
                    <div className="px-3 py-2 border-b bg-muted/40 text-sm font-medium">
                      Proposed rule changes — {calib.before.matched} → {calib.after.matched} vendors agreeing
                    </div>
                    <div className="divide-y">
                      {calib.proposals.map((p, i) => (
                        <ProposalRow
                          key={i} proposal={p}
                          checked={accepted.has(i)}
                          onToggle={() => setAccepted((s) => {
                            const n = new Set(s);
                            n.has(i) ? n.delete(i) : n.add(i);
                            return n;
                          })}
                          verdict={ai?.verdicts.find((v) => v.rule.toLowerCase().includes(
                            proposalTitle(p).toLowerCase().slice(0, 12),
                          ))}
                        />
                      ))}
                    </div>
                    <div className="px-3 py-2 border-t flex items-center gap-2">
                      <Button onClick={adopt} disabled={busy !== null || accepted.size === 0}>
                        {busy === 'adopt' ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}
                        Adopt {accepted.size} rule(s) and re-run
                      </Button>
                      <span className="text-xs text-muted-foreground">
                        Saved against this client and applied to every future run.
                      </span>
                    </div>
                  </div>
                )}

                {calib.rejectedForRegression.length > 0 && (
                  <Alert>
                    <Lock className="h-4 w-4" />
                    <AlertTitle>Rules discarded because they change work you have signed off</AlertTitle>
                    <AlertDescription className="text-sm space-y-1">
                      {calib.rejectedForRegression.map((r, i) => (
                        <div key={i}>
                          <b>{r.title} → {r.toLabel}</b> would have helped here, but changes: {r.goldens.join(', ')}.
                        </div>
                      ))}
                    </AlertDescription>
                  </Alert>
                )}

                {calib.unexplained.length > 0 && (
                  <Alert variant="destructive">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertTitle>
                      Unexplained — ₹{inr(calib.unexplainedAmount)} across {calib.unexplained.length} vendor(s)
                    </AlertTitle>
                    <AlertDescription className="text-sm">
                      No interpretation the tool is permitted to hold produces your figures for these vendors.
                      They are shown as-is rather than forced to agree. Likely causes: the vendor was excluded
                      from your working on MSME status, your figure used bill-wise information the ledger does
                      not carry, or one of the two workings is wrong.
                    </AlertDescription>
                  </Alert>
                )}

                <div className="rounded-md border bg-muted/20 p-3">
                  <div className="text-xs font-medium mb-1">What this exercise did and did not establish</div>
                  <ul className="text-xs text-muted-foreground list-disc pl-4 space-y-0.5">
                    {calib.honestNotes.map((n, i) => <li key={i}>{n}</li>)}
                  </ul>
                </div>
              </div>
            )}

            {/* ── AI second opinion ── */}
            {ai && (
              <Alert>
                <Sparkles className="h-4 w-4" />
                <AlertTitle>Claude's opinion on the interpretation</AlertTitle>
                <AlertDescription className="text-sm space-y-2">
                  {ai.overall && <p>{ai.overall}</p>}
                  {ai.unexplainedCauses.length > 0 && (
                    <div>
                      <div className="font-medium mt-1">On the unexplained differences:</div>
                      <ul className="list-disc pl-4">
                        {ai.unexplainedCauses.map((c, i) => (
                          <li key={i}><b>{c.vendor}</b> — {c.likelyCause} <i>Check: {c.whatToCheck}</i></li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <p className="text-xs text-muted-foreground">
                    An opinion on the legal reading only. Every figure in this utility comes from the
                    deterministic engine re-run over your ledgers — never from the model.
                  </p>
                </AlertDescription>
              </Alert>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function proposalTitle(p: Proposal): string {
  if (p.kind === 'rule') return p.title;
  if (p.kind === 'vendor-window') return `s.15 window — ${p.vendorName}`;
  return `GST rate — ${p.vendorName}`;
}

function proposalChange(p: Proposal): string {
  if (p.kind === 'rule') return `${p.fromLabel} → ${p.toLabel}`;
  if (p.kind === 'vendor-window') return `${p.currentWindowDays}d → ${p.windowDays}d`;
  return `not declared → ${p.gstRate}%`;
}

function proposalQuestion(p: Proposal): string {
  if (p.kind === 'rule') return p.question;
  if (p.kind === 'vendor-window') return 'Is there a written agreement with this vendor?';
  return 'What GST rate does this vendor charge? The ledger does not show the split.';
}

function ProposalRow({ proposal: p, checked, onToggle, verdict }: {
  proposal: Proposal;
  checked: boolean;
  onToggle: () => void;
  verdict?: AiReview['verdicts'][number];
}) {
  const isRule = p.kind === 'rule';
  return (
    <div className="flex gap-3 p-3">
      <Checkbox checked={checked} onCheckedChange={onToggle} className="mt-1" />
      <div className="space-y-1 text-sm flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{proposalTitle(p)}</span>
          <Badge variant="outline" className="text-[10px]">{proposalChange(p)}</Badge>
          {!isRule && <Badge variant="secondary" className="text-[10px]">needs your declaration</Badge>}
          {verdict && (
            <Badge variant={verdict.defensible ? 'secondary' : 'destructive'} className="text-[10px]">
              Claude: {verdict.defensible ? 'defensible' : 'questionable'}
            </Badge>
          )}
        </div>
        <div className="text-xs text-muted-foreground">{proposalQuestion(p)}</div>
        <div className="text-xs">{p.basis}</div>
        {isRule && (
          <div className="text-xs text-muted-foreground">
            Brings <b className="text-emerald-700">{p.fixes.length}</b> vendor(s) into agreement
            {p.breaks.length > 0 && <> · pushes <b className="text-red-600">{p.breaks.length}</b> out ({p.breaks.join(', ')})</>}
            {' '}· gap ₹{inr(p.absDeltaBefore)} → ₹{inr(p.absDeltaAfter)}
          </div>
        )}
        {verdict?.comment && <div className="text-xs italic text-muted-foreground">{verdict.comment}</div>}
      </div>
    </div>
  );
}

function VendorDiffTable({ diff }: { diff: DiffResult }) {
  const rows = diff.vendors.filter((v) => v.status !== 'match');
  if (!rows.length) {
    return (
      <div className="flex items-center gap-2 text-sm text-emerald-700">
        <CheckCircle2 className="h-4 w-4" /> Every vendor agrees with your working.
      </div>
    );
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Vendor</TableHead>
          <TableHead className="text-right">Tool</TableHead>
          <TableHead className="text-right">Your working</TableHead>
          <TableHead className="text-right">Difference</TableHead>
          <TableHead>Note</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((v) => (
          <TableRow key={v.vendorName}>
            <TableCell className="text-sm">
              {v.vendorName}
              {v.theirName && <span className="text-xs text-muted-foreground block">matched to "{v.theirName}"</span>}
              {v.fuzzyMatched && <Badge variant="outline" className="text-[10px] ml-1">name matched by similarity</Badge>}
            </TableCell>
            <TableCell className="text-right tabular-nums text-sm">{v.ours ? `₹${inr(v.ours.disallowed)}` : '—'}</TableCell>
            <TableCell className="text-right tabular-nums text-sm">{v.theirs ? `₹${inr(v.theirs.disallowed)}` : '—'}</TableCell>
            <TableCell className={cn('text-right tabular-nums text-sm font-medium', v.delta > 0 ? 'text-red-600' : 'text-amber-600')}>
              {signed(v.delta)}
            </TableCell>
            <TableCell className="text-xs text-muted-foreground">{v.note || ''}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone: 'ok' | 'danger' | 'neutral' }) {
  const color = tone === 'ok' ? 'text-emerald-600' : tone === 'danger' ? 'text-red-600' : '';
  return (
    <div className="rounded-md border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn('text-lg font-semibold tabular-nums', color)}>{value}</div>
    </div>
  );
}
