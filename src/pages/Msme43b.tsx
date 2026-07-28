import { useState, useCallback, Fragment } from 'react';
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
  ChevronRight, ChevronDown, Info, Landmark,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  pdfToLines, parseLedgerPages, buildReport, downloadWorkpaper, msme43bToForm3cd,
  DEFAULT_CONFIG, type VendorLedger, type Msme43bReport, type VendorResult,
} from '@/lib/msme43b';

const inr = (v: number) =>
  new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(Math.round(v));

async function filesToLedgers(files: FileList | File[]): Promise<VendorLedger[]> {
  const out: VendorLedger[] = [];
  for (const f of Array.from(files)) {
    const buf = await f.arrayBuffer();
    const pages = await pdfToLines(buf);
    out.push(...parseLedgerPages(pages, f.name));
  }
  return out;
}

export default function Msme43b() {
  const [cyFiles, setCyFiles] = useState<File[]>([]);
  const [fyFiles, setFyFiles] = useState<File[]>([]);
  const [clientName, setClientName] = useState('');
  const [windowDays, setWindowDays] = useState(45);
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState<Msme43bReport | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const run = useCallback(async () => {
    if (cyFiles.length === 0) {
      toast.error('Upload at least the current-year ledger PDF(s).');
      return;
    }
    setRunning(true);
    try {
      const [cy, fy] = await Promise.all([filesToLedgers(cyFiles), filesToLedgers(fyFiles)]);
      const rep = buildReport(cy, fy, { ...DEFAULT_CONFIG, windowDays }, clientName || undefined);
      setReport(rep);
      const bad = cy.filter((l) => !l.balanceReconciled);
      if (bad.length) {
        toast.warning(`${bad.length} ledger(s) did not reconcile to their printed closing balance — check Exceptions.`);
      } else {
        toast.success(`Parsed ${cy.length} CY + ${fy.length} FY ledger(s), all reconciled.`);
      }
    } catch (e) {
      console.error(e);
      toast.error(`Analysis failed: ${(e as Error).message}`);
    } finally {
      setRunning(false);
    }
  }, [cyFiles, fyFiles, clientName, windowDays]);

  const toggle = (name: string) =>
    setExpanded((s) => {
      const n = new Set(s);
      n.has(name) ? n.delete(name) : n.add(name);
      return n;
    });

  const clause26 = report ? msme43bToForm3cd(report).clause26 : null;

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
          <Button onClick={() => downloadWorkpaper(report)} variant="outline">
            <Download className="h-4 w-4 mr-2" /> Export working paper
          </Button>
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
              <Label className="text-sm">Client name (optional)</Label>
              <Input value={clientName} onChange={(e) => setClientName(e.target.value)} placeholder="e.g. Unity Organics Pvt Ltd" />
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
