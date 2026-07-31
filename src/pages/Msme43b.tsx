import { useState, useCallback, useEffect, useMemo, Fragment } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Scale, Upload, FileText, Download, Loader2, AlertTriangle, CheckCircle2,
  ChevronRight, ChevronDown, Info, Landmark, Save, Trash2, History, Pencil, Check, X,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { getClassificationsForFY } from '@/utils/classificationUtils';
import { MultiYearTrend } from '@/components/msme43b/MultiYearTrend';
import { AccuracyReview } from '@/components/msme43b/AccuracyReview';
import { PanelReview } from '@/components/msme43b/PanelReview';
import {
  extractLedgersViaAI,
  buildReport, downloadWorkpaper, msme43bToForm3cd,
  saveRun, listRuns, loadRun, renameRun, deleteRun, computeCarryForward,
  loadRuleProfile, saveRuleProfile, saveGolden, loadGoldens,
  configFromProfile, vendorWindowMap, vendorGstMap,
  storeFiles, linkToRun, workpaperBlob, workpaperFileName,
  DEFAULT_CONFIG, type VendorLedger, type Msme43bReport, type VendorResult,
  type Msme43bRunSummary, type RuleProfile, type GoldenCase,
} from '@/lib/msme43b';

interface ClientOpt { id: string; name: string }

const inr = (v: number) =>
  new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(Math.round(v));

/** Current financial year in "YYYY-YY" form (e.g. "2026-27" from April 2026). */
function getCurrentFY(): string {
  const today = new Date();
  const year = today.getFullYear();
  const startYear = today.getMonth() >= 3 ? year : year - 1; // April = month 3
  return `${startYear}-${String(startYear + 1).slice(-2)}`;
}

const FY_OPTIONS = (() => {
  const [startStr] = getCurrentFY().split('-');
  const start = Number(startStr);
  return Array.from({ length: 6 }, (_, i) => {
    const s = start - i;
    return `${s}-${String(s + 1).slice(-2)}`;
  });
})();

interface IngestResult {
  ledgers: VendorLedger[];
  aiCount: number;
  truncatedAny: boolean;
  /** files that could not be read, with the reason — the run continues without them */
  failures: Array<{ file: string; reason: string }>;
}

/**
 * EVERY PDF is read through the Claude API, whatever its format.
 *
 * The deterministic Tally/Expert parsers still exist and still reconcile to zero
 * drift on those two formats, but they are no longer on this path: the firm asked
 * for one uniform route so that behaviour does not depend on which software
 * produced the file, and — importantly — so the GST split is captured on every
 * ledger. The deterministic parsers only ever saw a single gross amount per row.
 *
 * The safety property is unchanged: whatever comes back is reconstructed and
 * checked against the PRINTED closing balance before any figure is used. An
 * extraction that does not reconcile is flagged, not trusted.
 *
 * Failures are surfaced, never silently downgraded to a local parse — a figure
 * from an unexpected source is worse than an error message.
 *
 * A firm uploads 16 ledgers per year, so one unreadable file must NOT throw away
 * the other thirty-one. Each failure is collected and reported by name; the run
 * proceeds on what was read, and the exceptions make clear what is missing.
 */
async function filesToLedgers(
  files: FileList | File[],
  onProgress?: (done: number, total: number, current: string) => void,
): Promise<IngestResult> {
  const list = Array.from(files);
  const out: VendorLedger[] = [];
  const failures: IngestResult['failures'] = [];
  let aiCount = 0;
  let truncatedAny = false;

  for (let i = 0; i < list.length; i++) {
    const f = list[i];
    onProgress?.(i, list.length, f.name);
    try {
      const res = await extractLedgersViaAI(f, (note) => onProgress?.(i, list.length, note));
      aiCount += res.ledgers.length;
      truncatedAny = truncatedAny || res.truncated;
      out.push(...res.ledgers);
    } catch (e) {
      failures.push({ file: f.name, reason: (e as Error).message });
    }
  }
  onProgress?.(list.length, list.length, '');
  return { ledgers: out, aiCount, truncatedAny, failures };
}

export default function Msme43b() {
  const { user } = useAuth();
  const [cyFiles, setCyFiles] = useState<File[]>([]);
  const [fyFiles, setFyFiles] = useState<File[]>([]);
  const [clients, setClients] = useState<ClientOpt[]>([]);
  const [clientsLoading, setClientsLoading] = useState(true);
  const [clientId, setClientId] = useState<string>('');
  const [clientSearch, setClientSearch] = useState('');
  const [clientOpen, setClientOpen] = useState(false);
  const [fy, setFy] = useState<string>(getCurrentFY());
  const [windowDays, setWindowDays] = useState(45);
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState<Msme43bReport | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [saveLabel, setSaveLabel] = useState('');
  const [savedRuns, setSavedRuns] = useState<Msme43bRunSummary[]>([]);
  const [persistOff, setPersistOff] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingLabel, setEditingLabel] = useState('');
  const [carryPriorId, setCarryPriorId] = useState<string>('');
  // Ledgers are kept after the run so the accuracy loop can re-run the engine
  // under a candidate interpretation without re-uploading the PDFs.
  const [cyLedgers, setCyLedgers] = useState<VendorLedger[]>([]);
  const [fyLedgers, setFyLedgers] = useState<VendorLedger[]>([]);
  const [profile, setProfile] = useState<RuleProfile | null>(null);
  const [goldens, setGoldens] = useState<GoldenCase[]>([]);
  const [calibOff, setCalibOff] = useState(false);
  const [retention, setRetention] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [ingestFailures, setIngestFailures] = useState<Array<{ file: string; reason: string }>>([]);
  /**
   * The reviewer has read the blocking exceptions and still wants the file.
   * Deliberately NOT persisted and reset on every new report: an acknowledgement
   * belongs to the exact figures it was given for.
   */
  const [ackBlockers, setAckBlockers] = useState(false);

  const clientName = clients.find((c) => c.id === clientId)?.name || '';

  // The interpretation in force: the standard positions, overridden by whatever
  // this client's reviewer has taught the tool.
  const activeConfig = useMemo(
    () => ({ ...configFromProfile(profile, DEFAULT_CONFIG), windowDays }),
    [profile, windowDays],
  );

  // Load client list, restricted to clients classified "Audit" for the
  // selected financial year — MSME 43B(h) disallowance only applies to
  // audited entities, so the dropdown should never show non-audit clients.
  // Mirrors the searchable-dropdown UX of the Depreciation Register page,
  // but the filter here is a genuine classification check (getClassificationsForFY)
  // rather than an entity-type restriction.
  useEffect(() => {
    let cancelled = false;
    setClientsLoading(true);
    (async () => {
      let q = supabase.from('clients')
        .select('id, name, firm_id')
        .eq('is_draft', false).is('deleted_at', null).neq('is_active', false)
        .order('name');
      if (user?.role !== 'superadmin' && user?.firm_id) q = q.eq('firm_id', user.firm_id);
      const { data } = await q;
      const all = (data || []).filter((c): c is ClientOpt & { firm_id: string } => !!c.name);
      if (cancelled) return;
      if (all.length === 0) { setClients([]); setClientsLoading(false); return; }

      const clsMap = await getClassificationsForFY(all.map((c) => c.id), fy);
      if (cancelled) return;
      const audited = all.filter((c) => (clsMap.get(c.id) || '').toLowerCase() === 'audit');
      setClients(audited.map((c) => ({ id: c.id, name: c.name })));
      setClientsLoading(false);
    })();
    return () => { cancelled = true; };
  }, [user?.firm_id, user?.role, fy]);

  // If the FY changes and the previously-selected client falls out of the
  // audited set for the new FY, clear the selection rather than silently
  // keeping an id that's no longer visible in the dropdown.
  useEffect(() => {
    if (clientId && !clientsLoading && !clients.some((c) => c.id === clientId)) {
      setClientId('');
    }
  }, [clients, clientsLoading, clientId]);

  const refreshRuns = useCallback(async (cid: string) => {
    if (!cid) { setSavedRuns([]); return; }
    const res = await listRuns(cid);
    if (res.unavailable) { setPersistOff(true); setSavedRuns([]); return; }
    setPersistOff(false);
    setSavedRuns(res.data || []);
  }, []);

  useEffect(() => { refreshRuns(clientId); }, [clientId, refreshRuns]);

  // Load this client's learned interpretation and its signed-off runs.
  const refreshCalibration = useCallback(async (cid: string) => {
    if (!cid) { setProfile(null); setGoldens([]); return; }
    const [p, g] = await Promise.all([loadRuleProfile(cid), loadGoldens(cid)]);
    if (p.unavailable || g.unavailable) { setCalibOff(true); setProfile(null); setGoldens([]); return; }
    setCalibOff(false);
    if (p.error) toast.warning(p.error);
    setProfile(p.data);
    setGoldens(g.data || []);
    // Keep the window selector showing the position actually in force.
    const learned = p.data?.overrides.windowDays;
    if (learned) setWindowDays(learned);
  }, []);

  useEffect(() => { refreshCalibration(clientId); }, [clientId, refreshCalibration]);

  const run = useCallback(async () => {
    if (cyFiles.length === 0) {
      toast.error('Upload at least the current-year ledger PDF(s).');
      return;
    }
    setRunning(true);
    setIngestFailures([]);
    setProgress(`Reading ${cyFiles.length + fyFiles.length} ledger(s)…`);
    try {
      // Sequential, not parallel: each file is a Claude call, and a firm-sized
      // batch fired at once would hit rate limits and lose the lot.
      const total = cyFiles.length + fyFiles.length;
      let done = 0;
      let started = 0;
      const track = () => (_d: number, _t: number, current: string) => {
        if (!current) { setProgress(null); return; }
        // A chunk note ("file.pdf: pages 9–16 of 40") replaces the line without
        // advancing the file counter, so a long merged file shows real movement.
        const isChunkNote = current.includes(': pages ');
        if (!isChunkNote) started = ++done;
        setProgress(`Reading ${Math.min(started || 1, total)} of ${total}: ${current}`);
      };
      const cyRes = await filesToLedgers(cyFiles, track());
      const fyRes = await filesToLedgers(fyFiles, track());
      const cy = cyRes.ledgers;
      const fy = fyRes.ledgers;

      // Kept on screen, not just flashed as a toast: this is the text the user
      // needs in order to tell anyone what went wrong.
      const failures = [...cyRes.failures, ...fyRes.failures];
      setIngestFailures(failures);
      if (!cy.length) {
        toast.error('No current-year ledger could be read — see the details below.');
        return;
      }
      if (failures.length) {
        toast.warning(`${failures.length} file(s) could not be read — analysing the rest.`);
      }
      const rep = buildReport(cy, fy, activeConfig, clientName || undefined, {
        vendorWindowDays: vendorWindowMap(profile),
        vendorGstRate: vendorGstMap(profile),
      });
      setReport(rep);
      setCyLedgers(cy);
      setFyLedgers(fy);
      if (cyRes.truncatedAny || fyRes.truncatedAny) {
        toast.warning('A ledger was too large for the AI to read in full — its result may be incomplete. Check reconciliation.');
      }
      const bad = cy.filter((l) => !l.balanceReconciled);
      const aiCount = cyRes.aiCount + fyRes.aiCount;
      if (bad.length) {
        toast.warning(`${bad.length} ledger(s) did not reconcile to their printed closing balance — check Exceptions.`);
      } else {
        toast.success(`Read ${cy.length} CY + ${fy.length} FY ledger(s) via Claude${aiCount ? '' : ''}, all reconciled.`);
      }
      // Retention runs after the result is on screen — it must never delay or
      // block the analysis, and a storage failure must not lose the work.
      void retain(rep);
    } catch (e) {
      console.error(e);
      toast.error(`Analysis failed: ${(e as Error).message}`);
    } finally {
      setRunning(false);
      setProgress(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cyFiles, fyFiles, clientName, activeConfig, profile, clientId, user, saveLabel]);

  /**
   * Keep everything, permanently: the uploaded ledgers, the computed run, and
   * the exported working paper — all linked together so the run can be
   * reproduced from its own sources later.
   *
   * Re-running the same ledgers is expressly allowed and simply creates another
   * run; nothing is overwritten.
   */
  const retain = useCallback(async (rep: Msme43bReport) => {
    if (!clientId || !user?.firm_id) {
      setRetention('Not retained — select a client before running to keep the uploads and the output on file.');
      return;
    }
    setRetention('Saving uploads and output…');
    const base = {
      clientId, firmId: user.firm_id, userId: user.id,
      userName: user.name || user.email || null,
    };
    try {
      const [cyStore, fyStore] = await Promise.all([
        storeFiles({ ...base, files: cyFiles, kind: 'cy_ledger' }),
        storeFiles({ ...base, files: fyFiles, kind: 'fy_ledger' }),
      ]);
      if (cyStore.unavailable || fyStore.unavailable) {
        setRetention('Retention not deployed yet — apply the migrations to keep uploads and outputs on file.');
        return;
      }

      const saved = await saveRun({
        ...base,
        label: saveLabel.trim() || `${rep.cyLabel} · ${new Date().toLocaleString('en-IN')}`,
        report: rep,
      });
      if (saved.unavailable) { setPersistOff(true); setRetention('Saved-runs table not deployed yet.'); return; }
      if (saved.error || !saved.data) { setRetention(`Could not save the run: ${saved.error}`); return; }

      const runId = saved.data;
      const ids = [...cyStore.stored, ...fyStore.stored].map((a) => a.id);
      await linkToRun(ids, runId);

      // The deliverable itself is retained too, so what was issued is on file.
      const blob = await workpaperBlob(rep, null, { config: activeConfig, profile, preparedBy: base.userName || undefined });
      const file = new File([blob], workpaperFileName(rep), { type: blob.type });
      await storeFiles({ ...base, files: [file], kind: 'workpaper_export', runId });

      setSaveLabel('');
      setRetention(`Retained: ${ids.length} ledger file(s) + the working paper, against this run.`);
      refreshRuns(clientId);
    } catch (e) {
      setRetention(`Retention failed: ${(e as Error).message}`);
    }
  }, [clientId, user, cyFiles, fyFiles, saveLabel, activeConfig, profile, refreshRuns]);

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

  // ── Accuracy loop ───────────────────────────────────────────────────────
  /** The reviewer confirms this run — store it as a replayable golden case. */
  const doSignOff = useCallback(async (label: string) => {
    if (!report || !clientId) return;
    const res = await saveGolden({
      clientId, firmId: user?.firm_id, userId: user?.id,
      userName: user?.name || user?.email || null,
      label, report, cyLedgers, fyLedgers,
      config: activeConfig, vendorWindows: vendorWindowMap(profile),
      vendorGstRates: vendorGstMap(profile),
    });
    if (res.unavailable) { setCalibOff(true); toast.error('Calibration tables not deployed yet — apply the migration first.'); return; }
    if (res.error) { toast.error(`Sign-off failed: ${res.error}`); return; }
    toast.success('Signed off. Future rule changes will be checked against this run.');
    refreshCalibration(clientId);
  }, [report, clientId, user, cyLedgers, fyLedgers, activeConfig, profile, refreshCalibration]);

  /** The reviewer accepts a learned interpretation — persist it and re-run. */
  const doAdoptProfile = useCallback(async (
    next: RuleProfile,
    meta: { sourceFile: string; matchedBefore: number; matchedAfter: number },
  ) => {
    if (!clientId) { toast.error('Select a client — rules are learned per client.'); return; }
    const res = await saveRuleProfile({
      clientId, firmId: user?.firm_id, userId: user?.id,
      userName: user?.name || user?.email || null,
      profile: next, sourceFile: meta.sourceFile,
      matchedBefore: meta.matchedBefore, matchedAfter: meta.matchedAfter,
    });
    if (res.unavailable) { setCalibOff(true); toast.error('Calibration tables not deployed yet — apply the migration first.'); return; }
    if (res.error) { toast.error(`Could not save the rules: ${res.error}`); return; }

    setProfile(next);
    const cfg = { ...configFromProfile(next, DEFAULT_CONFIG) };
    if (next.overrides.windowDays) setWindowDays(next.overrides.windowDays);
    setReport(buildReport(cyLedgers, fyLedgers, cfg, clientName || undefined, {
      vendorWindowDays: vendorWindowMap(next),
      vendorGstRate: vendorGstMap(next),
    }));
    toast.success('Rules adopted and the working re-computed.');
    refreshCalibration(clientId);
  }, [clientId, user, cyLedgers, fyLedgers, clientName, refreshCalibration]);

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

  // An acknowledgement belongs to the figures it was given for, so it is reset
  // whenever a new report object appears — a fresh run, a loaded run, or a
  // re-run under a changed interpretation.
  useEffect(() => { setAckBlockers(false); }, [report]);

  const exportBlocked = !!report?.blocksSignOff && !ackBlockers;

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
            <Button
              onClick={() => downloadWorkpaper(report, carry, {
                config: activeConfig, profile,
                preparedBy: user?.name || user?.email || undefined,
              })}
              variant="outline"
              disabled={exportBlocked}
              title={exportBlocked
                ? 'Exceptions must be acknowledged before the working paper can be exported — see the red panel below.'
                : undefined}
            >
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
          <div className="grid gap-4 md:grid-cols-3">
            <div>
              <Label className="text-sm">Client *</Label>
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setClientOpen((v) => !v)}
                  className="flex h-9 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm ring-offset-background focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  <span className={clientId ? 'text-foreground' : 'text-muted-foreground'}>
                    {clientId
                      ? clients.find((c) => c.id === clientId)?.name || 'Select client'
                      : clientsLoading ? 'Loading clients…' : 'Select a client (required to save)'}
                  </span>
                  <ChevronDown className="h-4 w-4 opacity-50 shrink-0" />
                </button>
                {clientOpen && (
                  <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-lg">
                    <div className="p-2">
                      <input
                        autoFocus
                        className="w-full rounded border px-2 py-1 text-sm outline-none focus:ring-1 focus:ring-ring"
                        placeholder="Search client…"
                        value={clientSearch}
                        onChange={(e) => setClientSearch(e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                      />
                    </div>
                    <div className="max-h-60 overflow-y-auto">
                      {clients
                        .filter((c) => c.name.toLowerCase().includes(clientSearch.toLowerCase()))
                        .map((c) => (
                          <div
                            key={c.id}
                            className="flex cursor-pointer items-center px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground"
                            onClick={() => { setClientId(c.id); setClientOpen(false); setClientSearch(''); }}
                          >
                            {clientId === c.id && <Check className="mr-2 h-4 w-4" />}
                            <span className={clientId === c.id ? 'font-medium' : ''}>{c.name}</span>
                          </div>
                        ))}
                      {!clientsLoading && !clients.filter((c) => c.name.toLowerCase().includes(clientSearch.toLowerCase())).length && (
                        <div className="px-3 py-2 text-sm text-muted-foreground">No audited clients found</div>
                      )}
                    </div>
                  </div>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-1">Audited clients only, for the selected FY</p>
            </div>
            <div>
              <Label className="text-sm">Financial Year</Label>
              <Select value={fy} onValueChange={setFy}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {FY_OPTIONS.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}
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

          <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground space-y-1">
            <div className="font-medium text-foreground text-sm">Every PDF is read by Claude</div>
            <p>
              Any accounting software's format works — Tally, Expert, Busy, Marg, Zoho or anything
              else. Each ledger is then reconstructed and checked against its <b>printed closing
              balance</b>, so a misread is flagged rather than used.
            </p>
            <p>
              The disallowance is computed on the <b>taxable value</b>: GST is not claimed as a
              deduction, so it cannot be disallowed. Where a ledger doesn't show the tax split, the
              vendor is flagged so you can declare the rate.
            </p>
          </div>

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
            {progress && (
              <span className="text-xs text-muted-foreground">{progress}</span>
            )}
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

      {ingestFailures.length > 0 && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>{ingestFailures.length} file(s) could not be read</AlertTitle>
          <AlertDescription className="text-sm space-y-1">
            {ingestFailures.map((f, i) => (
              <div key={i}><b>{f.file}</b> — {f.reason}</div>
            ))}
          </AlertDescription>
        </Alert>
      )}

      {report && (
        <>
          {/* ── Summary cards ── */}
          <div className="grid gap-4 md:grid-cols-4">
            <StatCard label={`Disallowance ${report.cyLabel}`} value={inr(report.totalDisallowedCY)} tone="danger" icon={<AlertTriangle className="h-4 w-4" />} />
            <StatCard label={`Allowed on payment ${report.fyLabel}`} value={inr(report.totalAllowedFY)} tone="ok" icon={<CheckCircle2 className="h-4 w-4" />} />
            <StatCard label="Still outstanding (FY end)" value={inr(report.totalStillOutstanding)} tone="warn" icon={<AlertTriangle className="h-4 w-4" />} />
            <StatCard label="GST excluded (not disallowable)" value={inr(report.totalGstExcluded)} tone="neutral" icon={<Landmark className="h-4 w-4" />} />
          </div>

          {/*
            Sign-off gate. The figures above are shown either way — hiding them
            would only invite a re-run until the warning went away — but the
            working paper cannot be exported until the reviewer has read these
            exceptions and taken them on record.
          */}
          {report.blocksSignOff && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>
                Not ready for sign-off — {report.blockingReasons.length} exception
                {report.blockingReasons.length === 1 ? '' : 's'} must be cleared
              </AlertTitle>
              <AlertDescription className="text-sm space-y-2">
                <ul className="list-disc pl-5 space-y-1">
                  {report.blockingReasons.map((r, i) => <li key={i}>{r}</li>)}
                </ul>
                {report.unreconciledDisallowed > 0 && (
                  <p>
                    Amount at risk: <b>₹{inr(report.unreconciledDisallowed)}</b> of the
                    ₹{inr(report.totalDisallowedCY)} disallowance comes from ledgers that did not
                    reconcile — that is {report.totalDisallowedCY > 0
                      ? Math.round((report.unreconciledDisallowed / report.totalDisallowedCY) * 100)
                      : 0}% of the total.
                  </p>
                )}
                <label className="flex items-start gap-2 pt-1 font-medium cursor-pointer">
                  <Checkbox
                    checked={ackBlockers}
                    onCheckedChange={(v) => setAckBlockers(v === true)}
                    className="mt-0.5 border-current data-[state=checked]:bg-current"
                  />
                  <span>
                    I have read these exceptions and accept them on record. Export the working
                    paper — the exceptions will be printed on its cover and summary sheets.
                  </span>
                </label>
              </AlertDescription>
            </Alert>
          )}

          {retention && (
            <div className="text-xs text-muted-foreground flex items-center gap-1.5">
              <Save className="h-3 w-3" /> {retention}
            </div>
          )}

          {report.totalGstUnidentified > 0 && (
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>GST not identified on ₹{inr(report.totalGstUnidentified)} of disallowed value</AlertTitle>
              <AlertDescription className="text-sm">
                Those ledgers don't print a tax split, so that amount is stated on <b>gross</b> and is
                overstated by the tax. Upload your own working and the tool will suggest each vendor's
                GST rate for you to confirm — or the vendors are listed below with a warning.
              </AlertDescription>
            </Alert>
          )}

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

          {/* ── Accuracy loop: confirm, or teach the tool your interpretation ── */}
          {cyLedgers.length > 0 && (
            <AccuracyReview
              report={report}
              cyLedgers={cyLedgers}
              fyLedgers={fyLedgers}
              config={activeConfig}
              profile={profile}
              goldens={goldens}
              clientId={clientId}
              persistOff={calibOff}
              onSignOff={doSignOff}
              onAdoptProfile={doAdoptProfile}
            />
          )}

          {/* ── Claude ↔ GPT panel on the interpretation applied ── */}
          <PanelReview input={{ report, config: activeConfig, profile }} />

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
      {/*
        The badge says "arithmetic", not "correct". The cross-check reproduces
        the figures by a second code path but shares the classifier, so it
        cannot vouch for the narrations — that is the separate badge below.
      */}
      {v.verified === true && (
        <Badge
          variant="outline" className="text-[10px] border-emerald-500 text-emerald-600"
          title="A second, independently written computation reproduced these figures and all invariants hold. It shares the narration classifier, so it does not vouch for how entries were typed."
        >
          arithmetic re-derived ✓
        </Badge>
      )}
      {v.verified === false && <Badge variant="destructive" className="text-[10px]" title={(v.verifyNotes || []).join(' | ')}>cross-check: review</Badge>}
      {!!v.narrationSwing && v.narrationSwing > 0 && (
        <Badge
          variant="secondary" className="text-[10px] text-amber-700"
          title={(v.sensitivityNotes || []).join(' | ')}
        >
          ₹{inr(v.narrationSwing)} rests on narrations
        </Badge>
      )}
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
