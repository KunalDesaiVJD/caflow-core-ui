import { useState, useCallback, useEffect, Fragment } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Scale, Upload, FileText, Download, Loader2, AlertTriangle, CheckCircle2,
  ChevronRight, ChevronDown, Info, Landmark, Save, Trash2, History, Pencil, Check, X,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { MultiYearTrend } from '@/components/msme43b/MultiYearTrend';
import {
  pdfToLines, parseLedgerPages, detectFormat, extractLedgersViaAI,
  buildReport, downloadWorkpaper, msme43bToForm3cd,
  saveRun, listRuns, loadRun, renameRun, deleteRun, computeCarryForward,
  DEFAULT_CONFIG, type VendorLedger, type Msme43bReport, type VendorResult,
  type Msme43bRunSummary,
} from '@/lib/msme43b';

interface ClientOpt { id: string; name: string }

const inr = (v: number) =>
  new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(Math.round(v));

interface IngestResult { ledgers: VendorLedger[]; aiCount: number; truncatedAny: boolean }

/**
 * Route each PDF: Tally/Expert go through the exact deterministic parser;
 * any other format goes to Claude (when enabled). Both paths are reconciled
 * against the printed closing balance downstream.
 */
async function filesToLedgers(files: FileList | File[], useAi: boolean): Promise<IngestResult> {
  const out: VendorLedger[] = [];
  let aiCount = 0;
  let truncatedAny = false;
  for (const f of Array.from(files)) {
    const buf = await f.arrayBuffer();
    const pages = await pdfToLines(buf);
    const fmt = detectFormat(pages);
    if (fmt === 'tally' || fmt === 'expert') {
      out.push(...parseLedgerPages(pages, f.name));
    } else if (useAi) {
      const res = await extractLedgersViaAI(f);
      aiCount += res.ledgers.length;
      truncatedAny = truncatedAny || res.truncated;
      out.push(...res.ledgers);
    } else {
      out.push(...parseLedgerPages(pages, f.name)); // best-effort deterministic
    }
  }
  return { ledgers: out, aiCount, truncatedAny };
}

export default function Msme43b() {
  const { user } = useAuth();
  const [cyFiles, setCyFiles] = useState<File[]>([]);
  const [fyFiles, setFyFiles] = useState<File[]>([]);
  const [clients, setClients] = useState<ClientOpt[]>([]);
  const [clientId, setClientId] = useState<string>('');
  const [windowDays, setWindowDays] = useState(45);
  const [useAi, setUseAi] = useState(true);
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState<Msme43bReport | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [saveLabel, setSaveLabel] = useState('');
  const [savedRuns, setSavedRuns] = useState<Msme43bRunSummary[]>([]);
  const [persistOff, setPersistOff] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingLabel, setEditingLabel] = useState('');
  const [carryPriorId, setCarryPriorId] = useState<string>('');

  const clientName = clients.find((c) => c.id === clientId)?.name || '';

  // Load client list.
  useEffect(() => {
    supabase.from('clients')
      .select('id, name').eq('is_draft', false).is('deleted_at', null).neq('is_active', false).order('name')
      .then(({ data }) => setClients((data || []).filter((c): c is ClientOpt => !!c.name)));
  }, []);

  const refreshRuns = useCallback(async (cid: string) => {
    if (!cid) { setSavedRuns([]); return; }
    const res = await listRuns(cid);
    if (res.unavailable) { setPersistOff(true); setSavedRuns([]); return; }
    setPersistOff(false);
    setSavedRuns(res.data || []);
  }, []);

  useEffect(() => { refreshRuns(clientId); }, [clientId, refreshRuns]);

  const run = useCallback(async () => {
    if (cyFiles.length === 0) {
      toast.error('Upload at least the current-year ledger PDF(s).');
      return;
    }
    setRunning(true);
    try {
      const [cyRes, fyRes] = await Promise.all([filesToLedgers(cyFiles, useAi), filesToLedgers(fyFiles, useAi)]);
      const cy = cyRes.ledgers;
      const fy = fyRes.ledgers;
      const rep = buildReport(cy, fy, { ...DEFAULT_CONFIG, windowDays }, clientName || undefined);
      setReport(rep);
      if (cyRes.truncatedAny || fyRes.truncatedAny) {
        toast.warning('A ledger was too large for the AI to read in full — its result may be incomplete. Check reconciliation.');
      }
      const bad = cy.filter((l) => !l.balanceReconciled);
      const aiCount = cyRes.aiCount + fyRes.aiCount;
      if (bad.length) {
        toast.warning(`${bad.length} ledger(s) did not reconcile to their printed closing balance — check Exceptions.`);
      } else {
        toast.success(`Parsed ${cy.length} CY + ${fy.length} FY ledger(s)${aiCount ? ` (${aiCount} via Claude)` : ''}, all reconciled.`);
      }
    } catch (e) {
      console.error(e);
      toast.error(`Analysis failed: ${(e as Error).message}`);
    } finally {
      setRunning(false);
    }
  }, [cyFiles, fyFiles, clientName, windowDays, useAi]);

  const doSave = useCallback(async () => {
    if (!report) return;
    if (!clientId) { toast.error('Select a client to save this run against.'); return; }
    setSaving(true);
    const res = await saveRun({
      clientId, firmId: user?.firm_id, userId: user?.id,
      userName: user?.name || user?.email || null, label: saveLabel, report,
    });
    setSaving(false);
    if (res.unavailable) { setPersistOff(true); toast.error('Saved-runs table not deployed yet — apply the migration first.'); return; }
    if (res.error) { toast.error(`Save failed: ${res.error}`); return; }
    toast.success('Run saved.');
    setSaveLabel('');
    refreshRuns(clientId);
  }, [report, clientId, user, saveLabel, refreshRuns]);

  const commitRename = useCallback(async (id: string) => {
    setEditingId(null);
    const res = await renameRun(id, editingLabel);
    if (res.error) { toast.error(`Rename failed: ${res.error}`); return; }
    setSavedRuns((rows) => rows.map((r) => (r.id === id ? { ...r, label: editingLabel.trim() || null } : r)));
  }, [editingLabel]);

  const doLoad = useCallback(async (id: string) => {
    const res = await loadRun(id);
    if (res.error || !res.data) { toast.error(`Load failed: ${res.error || 'not found'}`); return; }
    setReport(res.data);
    setWindowDays(res.data.windowDays);
    toast.success('Loaded saved run.');
  }, []);

  const doDelete = useCallback(async (id: string) => {
    const res = await deleteRun(id);
    if (res.error) { toast.error(`Delete failed: ${res.error}`); return; }
    toast.success('Run deleted.');
    refreshRuns(clientId);
  }, [clientId, refreshRuns]);

  const toggle = (name: string) =>
    setExpanded((s) => {
      const n = new Set(s);
      n.has(name) ? n.delete(name) : n.add(name);
      return n;
    });

  const clause26 = report ? msme43bToForm3cd(report).clause26 : null;

  // Year-over-year carry-forward: prior runs that aren't the current year.
  const priorRunOptions = report ? savedRuns.filter((r) => r.cy_label !== report.cyLabel) : [];
  const priorRun = savedRuns.find((r) => r.id === carryPriorId);
  const carry = report && priorRun
    ? computeCarryForward(
        {
          cyLabel: priorRun.cy_label, fyLabel: priorRun.fy_label || '',
          totalDisallowedCY: priorRun.total_disallowed_cy,
          totalAllowedFY: priorRun.total_allowed_fy,
          totalStillOutstanding: priorRun.total_still_outstanding,
        },
        {
          cyLabel: report.cyLabel, fyLabel: report.fyLabel,
          totalDisallowedCY: report.totalDisallowedCY,
          totalAllowedFY: report.totalAllowedFY,
          totalStillOutstanding: report.totalStillOutstanding,
        },
      )
    : null;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Scale className="h-6 w-6" /> MSME 43B(h) Analyser
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Section 43B(h), Income Tax Act 1961 · disallowance of sums payable to micro &amp; small
            enterprises beyond the s.15 MSMED Act time limit. Upload two years of vendor ledgers.
          </p>
        </div>
        {report && (
          <div className="flex gap-2 items-center">
            {!persistOff && (
              <>
                <Input
                  value={saveLabel} onChange={(e) => setSaveLabel(e.target.value)}
                  placeholder="Label (optional)" className="h-9 w-44"
                  onKeyDown={(e) => { if (e.key === 'Enter' && clientId) doSave(); }}
                />
                <Button onClick={doSave} variant="outline" disabled={saving || !clientId}
                  title={!clientId ? 'Select a client first' : 'Save this run against the selected client'}>
                  {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
                  Save run
                </Button>
              </>
            )}
            <Button onClick={() => downloadWorkpaper(report, carry)} variant="outline">
              <Download className="h-4 w-4 mr-2" /> Export working paper
            </Button>
          </div>
        )}
      </div>

      {/* ── Inputs ── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Upload ledgers</CardTitle>
          <CardDescription>
            Employees upload only ledgers of registered micro/small vendors. Tally and Expert PDF
            exports are both supported. Provide the current year and the following year so payment
            dates that fall in the s.15 window (which spills into April) can be evaluated.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <Label className="text-sm">Client</Label>
              <Select value={clientId} onValueChange={setClientId}>
                <SelectTrigger><SelectValue placeholder="Select a client (required to save)" /></SelectTrigger>
                <SelectContent>
                  {clients.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-sm">Section 15 window</Label>
              <Select value={String(windowDays)} onValueChange={(v) => setWindowDays(Number(v))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="45">45 days (written agreement)</SelectItem>
                  <SelectItem value="15">15 days (no written agreement)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <label className="flex items-start gap-2 text-sm cursor-pointer">
            <input
              type="checkbox" className="mt-0.5" checked={useAi}
              onChange={(e) => setUseAi(e.target.checked)}
            />
            <span>
              <span className="font-medium">Read any format with Claude</span>
              <span className="block text-xs text-muted-foreground">
                Tally &amp; Expert PDFs are parsed exactly on-device. Any other software's format is
                sent to Claude to read — the result is still verified against the printed closing
                balance, so a wrong read is flagged, not trusted.
              </span>
            </span>
          </label>

          <div className="grid gap-4 md:grid-cols-2">
            <FileDrop
              label="Current year ledgers (year under audit)"
              files={cyFiles}
              onChange={setCyFiles}
            />
            <FileDrop
              label="Following year ledgers"
              files={fyFiles}
              onChange={setFyFiles}
            />
          </div>

          <div className="flex items-center gap-3">
            <Button onClick={run} disabled={running}>
              {running ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Scale className="h-4 w-4 mr-2" />}
              {running ? 'Analysing…' : 'Run 43B(h) analysis'}
            </Button>
            {fyFiles.length === 0 && cyFiles.length > 0 && (
              <span className="text-xs text-amber-600 flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" /> No following-year ledgers — year-end outstanding will be treated as disallowed pending payment data.
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ── Saved runs for the selected client ── */}
      {clientId && !persistOff && savedRuns.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <History className="h-4 w-4" /> Saved runs — {clientName}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Label</TableHead>
                  <TableHead>Saved</TableHead>
                  <TableHead>Period</TableHead>
                  <TableHead className="text-right">Disallowed</TableHead>
                  <TableHead className="text-right">Vendors</TableHead>
                  <TableHead>By</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {savedRuns.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="text-xs min-w-[160px]">
                      {editingId === r.id ? (
                        <div className="flex items-center gap-1">
                          <Input
                            autoFocus value={editingLabel} onChange={(e) => setEditingLabel(e.target.value)}
                            className="h-7 text-xs"
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') commitRename(r.id);
                              if (e.key === 'Escape') setEditingId(null);
                            }}
                          />
                          <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => commitRename(r.id)}>
                            <Check className="h-3.5 w-3.5" />
                          </Button>
                          <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setEditingId(null)}>
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      ) : (
                        <button
                          className="group inline-flex items-center gap-1 text-left hover:text-foreground"
                          onClick={() => { setEditingId(r.id); setEditingLabel(r.label || ''); }}
                          title="Rename"
                        >
                          <span className={cn(!r.label && 'italic text-muted-foreground')}>{r.label || 'Unnamed run'}</span>
                          <Pencil className="h-3 w-3 opacity-0 group-hover:opacity-60" />
                        </button>
                      )}
                    </TableCell>
                    <TableCell className="text-xs">{new Date(r.created_at).toLocaleString('en-IN')}</TableCell>
                    <TableCell className="text-xs">{r.cy_label} → {r.fy_label || '—'} · {r.window_days}d</TableCell>
                    <TableCell className="text-right tabular-nums text-red-600">₹{inr(r.total_disallowed_cy)}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.vendor_count}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{r.created_by_name || '—'}</TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="ghost" onClick={() => doLoad(r.id)}>Load</Button>
                      <Button size="sm" variant="ghost" onClick={() => doDelete(r.id)}>
                        <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* ── Multi-year trend (self-hides with < 2 saved years) ── */}
      {clientId && !persistOff && <MultiYearTrend runs={savedRuns} />}

      {report && (
        <>
          {/* ── Summary cards ── */}
          <div className="grid gap-4 md:grid-cols-4">
            <StatCard label={`Disallowance ${report.cyLabel}`} value={inr(report.totalDisallowedCY)} tone="danger" icon={<AlertTriangle className="h-4 w-4" />} />
            <StatCard label={`Allowed on payment ${report.fyLabel}`} value={inr(report.totalAllowedFY)} tone="ok" icon={<CheckCircle2 className="h-4 w-4" />} />
            <StatCard label="Still outstanding (FY end)" value={inr(report.totalStillOutstanding)} tone="warn" icon={<AlertTriangle className="h-4 w-4" />} />
            <StatCard label="Vendors analysed" value={String(report.vendors.length)} tone="neutral" icon={<FileText className="h-4 w-4" />} />
          </div>

          {clause26 && (
            <Alert>
              <Landmark className="h-4 w-4" />
              <AlertTitle>Form 3CD — Clause 26 (sums covered u/s 43B)</AlertTitle>
              <AlertDescription className="text-sm">
                Disallowed under s.43B(h): <b>₹{inr(clause26.amountDisallowedCY)}</b> in {report.cyLabel}
                {clause26.amountAllowedOnPaymentFY > 0 && <> · allowed on payment in {report.fyLabel}: <b>₹{inr(clause26.amountAllowedOnPaymentFY)}</b></>}.
                {' '}Window applied: {report.windowDays} days. Clause 22 (MSMED-Act interest u/s 23) is out of scope.
              </AlertDescription>
            </Alert>
          )}

          {/* ── Year-over-year carry-forward ── */}
          {!persistOff && priorRunOptions.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <History className="h-4 w-4" /> Year-over-year carry-forward
                </CardTitle>
                <CardDescription>
                  Link the previous year's saved run. Amounts disallowed then and <b>paid this year</b> become
                  an allowable deduction in {report.cyLabel}.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="max-w-md">
                  <Select value={carryPriorId} onValueChange={setCarryPriorId}>
                    <SelectTrigger><SelectValue placeholder="Select the prior-year run" /></SelectTrigger>
                    <SelectContent>
                      {priorRunOptions.map((r) => (
                        <SelectItem key={r.id} value={r.id}>
                          {(r.label ? r.label + ' · ' : '')}{r.cy_label} → {r.fy_label || '—'} · disallowed ₹{inr(r.total_disallowed_cy)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {carry && (
                  <>
                    {!carry.yearsAligned && (
                      <div className="text-xs text-amber-600 flex items-center gap-1">
                        <AlertTriangle className="h-3 w-3" />
                        Years don't chain: prior FY ({carry.priorFyLabel}) ≠ current year ({carry.currentCyLabel}). Pick the run whose following year is {report.cyLabel}.
                      </div>
                    )}
                    <Table>
                      <TableBody>
                        <CarryRow label={`Disallowance brought forward (added back in ${carry.priorCyLabel})`} value={carry.broughtForwardDisallowed} />
                        <CarryRow label={`Less: paid in ${carry.currentCyLabel} → allowed now (deduction)`} value={-carry.allowedThisYearOnPayment} tone="ok" />
                        <CarryRow label="Still carried forward (unpaid at prior year-end)" value={carry.stillCarriedForward} tone="warn" />
                        <CarryRow label={`Add: fresh disallowance for ${carry.currentCyLabel}`} value={carry.currentYearDisallowance} tone="danger" />
                        <CarryRow label={`Net s.43B(h) impact for ${carry.currentCyLabel}`} value={carry.netDisallowanceThisYear} bold />
                      </TableBody>
                    </Table>
                    <p className="text-[11px] text-muted-foreground">
                      Net impact = fresh disallowance this year − prior-year disallowance now paid. A negative figure is a net deduction.
                    </p>
                  </>
                )}
              </CardContent>
            </Card>
          )}

          {/* ── Vendor table with drilldown ── */}
          <Card>
            <CardHeader><CardTitle className="text-lg">Vendor-wise result</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8" />
                    <TableHead>Vendor</TableHead>
                    <TableHead>Format</TableHead>
                    <TableHead className="text-right">CY Closing</TableHead>
                    <TableHead className="text-right">Disallowed CY</TableHead>
                    <TableHead className="text-right">Allowed FY</TableHead>
                    <TableHead className="text-right">Outstanding</TableHead>
                    <TableHead>Checks</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.vendors.map((v) => (
                    <Fragment key={v.vendorName}>
                      <TableRow className="cursor-pointer" onClick={() => toggle(v.vendorName)}>
                        <TableCell>{expanded.has(v.vendorName) ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</TableCell>
                        <TableCell className="font-medium">{v.vendorName}</TableCell>
                        <TableCell><Badge variant="outline">{v.format}</Badge></TableCell>
                        <TableCell className="text-right tabular-nums">₹{inr(v.cyClosing)}</TableCell>
                        <TableCell className="text-right tabular-nums font-semibold text-red-600">{v.totalDisallowedCY ? `₹${inr(v.totalDisallowedCY)}` : '—'}</TableCell>
                        <TableCell className="text-right tabular-nums text-emerald-600">{v.totalAllowedFY ? `₹${inr(v.totalAllowedFY)}` : '—'}</TableCell>
                        <TableCell className="text-right tabular-nums text-amber-600">{v.totalStillOutstanding ? `₹${inr(v.totalStillOutstanding)}` : '—'}</TableCell>
                        <TableCell><VendorChecks v={v} /></TableCell>
                      </TableRow>
                      {expanded.has(v.vendorName) && (
                        <TableRow>
                          <TableCell colSpan={8} className="bg-muted/30 p-0">
                            <BillDetail v={v} />
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}

      {!report && (
        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription className="text-sm">
            The tool parses each ledger, reconstructs its running balance and verifies it against the
            printed closing balance, then matches purchases to settlements FIFO (no bill references are
            printed in these exports). TDS, kasar/vatav, round-off and credit/debit notes are netted out
            of the disallowance base automatically.
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}

function FileDrop({ label, files, onChange }: { label: string; files: File[]; onChange: (f: File[]) => void }) {
  return (
    <div>
      <Label className="text-sm">{label}</Label>
      <label className="mt-1 flex flex-col items-center justify-center gap-1 rounded-md border border-dashed p-4 cursor-pointer hover:bg-muted/40 transition">
        <Upload className="h-5 w-5 text-muted-foreground" />
        <span className="text-xs text-muted-foreground">
          {files.length ? `${files.length} file(s) selected` : 'Click to select PDF ledgers'}
        </span>
        <input
          type="file" accept="application/pdf" multiple className="hidden"
          onChange={(e) => onChange(e.target.files ? Array.from(e.target.files) : [])}
        />
      </label>
      {files.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {files.map((f) => (
            <Badge key={f.name} variant="secondary" className="text-[10px]">{f.name}</Badge>
          ))}
        </div>
      )}
    </div>
  );
}

function CarryRow({ label, value, tone, bold }: { label: string; value: number; tone?: 'danger' | 'ok' | 'warn'; bold?: boolean }) {
  const toneCls = tone === 'danger' ? 'text-red-600' : tone === 'ok' ? 'text-emerald-600' : tone === 'warn' ? 'text-amber-600' : '';
  const sign = value < 0 ? '−' : '';
  return (
    <TableRow className={cn(bold && 'border-t-2 font-semibold')}>
      <TableCell className={cn('text-sm', bold && 'font-semibold')}>{label}</TableCell>
      <TableCell className={cn('text-right tabular-nums', toneCls, bold && 'text-base font-bold')}>
        {sign}₹{inr(Math.abs(value))}
      </TableCell>
    </TableRow>
  );
}

function StatCard({ label, value, tone, icon }: { label: string; value: string; tone: 'danger' | 'ok' | 'warn' | 'neutral'; icon: React.ReactNode }) {
  const toneCls = {
    danger: 'text-red-600', ok: 'text-emerald-600', warn: 'text-amber-600', neutral: 'text-foreground',
  }[tone];
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">{icon}{label}</div>
        <div className={cn('text-2xl font-bold mt-1 tabular-nums', toneCls)}>
          {tone !== 'neutral' && value !== '0' ? '₹' : ''}{value}
        </div>
      </CardContent>
    </Card>
  );
}

function VendorChecks({ v }: { v: VendorResult }) {
  return (
    <div className="flex flex-wrap gap-1">
      <Badge variant={v.cyReconciled ? 'outline' : 'destructive'} className="text-[10px]">
        {v.cyReconciled ? 'CY ✓' : 'CY drift'}
      </Badge>
      {v.continuityOk
        ? <Badge variant="outline" className="text-[10px]">continuity ✓</Badge>
        : <Badge variant="destructive" className="text-[10px]">continuity ✗</Badge>}
      {v.verified === true && <Badge variant="outline" className="text-[10px] border-emerald-500 text-emerald-600">cross-checked ✓</Badge>}
      {v.verified === false && <Badge variant="destructive" className="text-[10px]" title={(v.verifyNotes || []).join(' | ')}>cross-check: review</Badge>}
      {v.reviewCount > 0 && <Badge variant="secondary" className="text-[10px]">{v.reviewCount} review</Badge>}
    </div>
  );
}

function BillDetail({ v }: { v: VendorResult }) {
  const rows = v.bills.filter((b) => !b.bill.isOpening && (b.disallowedCY > 0 || b.outstandingAtYearEnd > 0));
  return (
    <div className="p-4 space-y-3">
      {v.warnings.length > 0 && (
        <div className="space-y-1">
          {v.warnings.map((w, i) => (
            <div key={i} className="text-xs text-amber-700 flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" /> {w}
            </div>
          ))}
        </div>
      )}
      {rows.length === 0 ? (
        <div className="text-xs text-muted-foreground">No disallowance — all year-end payables cleared within the s.15 window.</div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Bill Date</TableHead>
              <TableHead className="text-right">Gross</TableHead>
              <TableHead className="text-right">Base</TableHead>
              <TableHead>Due Date</TableHead>
              <TableHead className="text-right">Out @ 31-Mar</TableHead>
              <TableHead className="text-right">Disallowed</TableHead>
              <TableHead className="text-right">Allowed FY</TableHead>
              <TableHead>Reason</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((b, i) => (
              <TableRow key={i}>
                <TableCell className="tabular-nums">{b.bill.billDate}</TableCell>
                <TableCell className="text-right tabular-nums">₹{inr(b.bill.grossAmount)}</TableCell>
                <TableCell className="text-right tabular-nums">₹{inr(b.bill.base)}</TableCell>
                <TableCell className="tabular-nums">{b.dueDate}</TableCell>
                <TableCell className="text-right tabular-nums">₹{inr(b.outstandingAtYearEnd)}</TableCell>
                <TableCell className="text-right tabular-nums text-red-600 font-medium">{b.disallowedCY ? `₹${inr(b.disallowedCY)}` : '—'}</TableCell>
                <TableCell className="text-right tabular-nums text-emerald-600">{b.allowedInFY ? `₹${inr(b.allowedInFY)}` : '—'}</TableCell>
                <TableCell className="text-[11px] text-muted-foreground max-w-[220px]">{b.reason}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
