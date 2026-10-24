import { useEffect, useMemo, useRef, useState, Fragment } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Checkbox } from '@/components/ui/checkbox';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  FileSpreadsheet, Upload, Download, Loader2, AlertTriangle, CheckCircle2, ChevronDown, ChevronRight,
  Sparkles, Link2, Unlink, RotateCcw, Info, X, ShieldAlert,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  autoLinkParties, bookKeyOf, bookParties, deductorKeyOf, deductors, indexEntries, MATCH_LABEL,
  reconcile, resolveLinks,
} from '@/lib/recon26as/engine';
import { read26as, readLedger, aiMatchParties, aiReview, type AiReview } from '@/lib/recon26as/ingest';
import { findIssues, reviewPayload, CATEGORY_LABEL, type Issue, type IssueSeverity } from '@/lib/recon26as/insights';
import { downloadWorkbook, STATUS_LABEL } from '@/lib/recon26as/exportExcel';
import type { LedgerNature } from '@/lib/recon26as/parseLedger';
import {
  DEFAULT_OPTIONS, type ExcludedRow, type MatchPair, type PartyGroup, type PartyLink, type ReconOptions,
  type ReconOverrides, type TdsEntry,
} from '@/lib/recon26as/types';

const inr = (v: number) =>
  new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);
const fmtDate = (d: string | null) => {
  if (!d) return '—';
  const [y, m, dd] = d.split('-');
  return `${dd}-${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+m - 1]}-${y}`;
};

function getDefaultAuditFY(): string {
  const today = new Date();
  const start = today.getMonth() >= 3 ? today.getFullYear() - 1 : today.getFullYear() - 2;
  return `${start}-${String(start + 1).slice(-2)}`;
}
const FY_OPTIONS = (() => {
  const today = new Date();
  const cur = today.getMonth() >= 3 ? today.getFullYear() : today.getFullYear() - 1;
  return Array.from({ length: 6 }, (_, i) => {
    const s = cur + 1 - i;
    return `${s}-${String(s + 1).slice(-2)}`;
  });
})();

const STATUS_STYLE: Record<PartyGroup['status'], string> = {
  matched: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  forced: 'bg-sky-100 text-sky-800 border-sky-200',
  total_match: 'bg-amber-100 text-amber-800 border-amber-200',
  difference: 'bg-red-100 text-red-800 border-red-200',
  books_only: 'bg-orange-100 text-orange-800 border-orange-200',
  as_only: 'bg-purple-100 text-purple-800 border-purple-200',
};

const LINK_LABEL: Record<PartyLink['method'], string> = {
  tan: 'TAN', exact: 'Name', alias: 'Alias', fuzzy: 'Similar name', total: 'Totals', ai: 'AI', manual: 'Manual',
};

const SESSION_KEY = 'caflow:recon26as:session:v1';

interface Session {
  fy: string;
  client: string;
  books: TdsEntry[];
  as26: TdsEntry[];
  aiLinks: PartyLink[];
  overrides: ReconOverrides;
  options: ReconOptions;
  warnings: string[];
  excluded: ExcludedRow[];
  review?: AiReview | null;
  savedAt: string;
}

const EMPTY_OVERRIDES: ReconOverrides = { forced: [], manual: [], links: {} };

function readSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}
function writeSession(s: Session | null) {
  try {
    if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
    else localStorage.removeItem(SESSION_KEY);
  } catch { /* storage full or blocked — the run still works, it just won't survive a refresh */ }
}

export default function Recon26as() {
  const [fy, setFy] = useState(getDefaultAuditFY());
  const [client, setClient] = useState('');
  const [asFiles, setAsFiles] = useState<File[]>([]);
  const [ledgerFiles, setLedgerFiles] = useState<File[]>([]);
  const [nature, setNature] = useState<LedgerNature>('auto');
  const [options, setOptions] = useState<ReconOptions>(DEFAULT_OPTIONS);
  const [useAiNames, setUseAiNames] = useState(true);

  const [books, setBooks] = useState<TdsEntry[]>([]);
  const [as26, setAs26] = useState<TdsEntry[]>([]);
  const [aiLinks, setAiLinks] = useState<PartyLink[]>([]);
  const [overrides, setOverrides] = useState<ReconOverrides>(EMPTY_OVERRIDES);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [excluded, setExcluded] = useState<ExcludedRow[]>([]);
  const [restoredAt, setRestoredAt] = useState<string | null>(null);
  const [review, setReview] = useState<AiReview | null>(null);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [tab, setTab] = useState('issues');

  const [running, setRunning] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [selB, setSelB] = useState<Set<string>>(new Set());
  const [selA, setSelA] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<'all' | PartyGroup['status']>('all');
  const [search, setSearch] = useState('');
  const [showExcluded, setShowExcluded] = useState(false);
  const hydrated = useRef(false);

  // restore the last session
  useEffect(() => {
    const s = readSession();
    if (s && (s.books?.length || s.as26?.length)) {
      setFy(s.fy); setClient(s.client); setBooks(s.books); setAs26(s.as26);
      setAiLinks(s.aiLinks || []); setOverrides(s.overrides || EMPTY_OVERRIDES);
      setOptions({ ...DEFAULT_OPTIONS, ...(s.options || {}) });
      setWarnings(s.warnings || []); setExcluded(s.excluded || []);
      setReview(s.review ?? null);
      setRestoredAt(s.savedAt);
    }
    hydrated.current = true;
  }, []);

  useEffect(() => {
    if (!hydrated.current) return;
    if (!books.length && !as26.length) return;
    writeSession({ fy, client, books, as26, aiLinks, overrides, options, warnings, excluded, review, savedAt: new Date().toISOString() });
  }, [fy, client, books, as26, aiLinks, overrides, options, warnings, excluded, review]);

  const autoLinks = useMemo(() => autoLinkParties(books, as26, options.totalTolerance), [books, as26, options.totalTolerance]);
  const links = useMemo(() => resolveLinks(autoLinks, aiLinks, overrides.links, as26), [autoLinks, aiLinks, overrides.links, as26]);
  const result = useMemo(
    () => (books.length || as26.length ? reconcile(books, as26, links, overrides, options) : null),
    [books, as26, links, overrides, options],
  );
  const issues = useMemo(() => (result ? findIssues(result, options, fy) : []), [result, options, fy]);
  const byId = useMemo(() => new Map([...books, ...as26].map((e) => [e.id, e])), [books, as26]);
  const pairOf = useMemo(() => {
    const m = new Map<string, MatchPair>();
    for (const p of result?.pairs ?? []) for (const id of [...p.bookIds, ...p.asIds]) m.set(id, p);
    return m;
  }, [result]);
  const groupOfEntry = useMemo(() => {
    const m = new Map<string, PartyGroup>();
    for (const g of result?.groups ?? []) {
      for (const e of books) if ((links.find((l) => l.bookKey === bookKeyOf(e))?.deductorKey ?? `B:${bookKeyOf(e)}`) === g.key) m.set(e.id, g);
      for (const e of as26) if (deductorKeyOf(e) === g.key) m.set(e.id, g);
    }
    return m;
  }, [result, books, as26, links]);
  const dedList = useMemo(() => [...deductors(as26).values()].sort((a, b) => a.name.localeCompare(b.name)), [as26]);
  const bookList = useMemo(() => [...bookParties(books).values()].sort((a, b) => a.name.localeCompare(b.name)), [books]);

  async function askAiForNames(b: TdsEntry[], a: TdsEntry[], current: PartyLink[]) {
    const linkedB = new Set(current.map((l) => l.bookKey));
    const linkedD = new Set(current.map((l) => l.deductorKey));
    const openB = [...bookParties(b).values()].filter((p) => !linkedB.has(p.key));
    const openD = [...deductors(a).values()].filter((d) => !linkedD.has(d.key));
    if (!openB.length || !openD.length) return [] as PartyLink[];
    setAiBusy(true);
    try {
      const got = await aiMatchParties(openB, openD);
      toast.success(got.length ? `AI linked ${got.length} more part${got.length === 1 ? 'y' : 'ies'} — review them in Party mapping.` : 'AI found no further confident links.');
      return got;
    } catch (e) {
      toast.error((e as Error).message);
      return [] as PartyLink[];
    } finally {
      setAiBusy(false);
    }
  }

  async function run() {
    if (!asFiles.length || !ledgerFiles.length) {
      toast.error('Upload the 26AS and at least one books ledger.');
      return;
    }
    setRunning(true);
    const warn: string[] = [];
    const excl: ExcludedRow[] = [];
    try {
      const asEntries: TdsEntry[] = [];
      for (const f of asFiles) {
        setProgress(`Reading ${f.name}…`);
        const r = await read26as(f, setProgress);
        asEntries.push(...r.entries);
        warn.push(...r.warnings);
        excl.push(...r.excluded);
        if (r.assessee?.name && !client) setClient(r.assessee.name + (r.assessee.pan ? ` (${r.assessee.pan})` : ''));
        if (r.assessee?.fy && FY_OPTIONS.includes(r.assessee.fy)) setFy(r.assessee.fy);
      }
      const bookEntries: TdsEntry[] = [];
      for (const f of ledgerFiles) {
        setProgress(`Reading ${f.name}…`);
        try {
          const r = await readLedger(f, nature, setProgress);
          bookEntries.push(...r.entries);
          warn.push(...r.warnings);
          excl.push(...r.excluded);
        } catch (e) {
          warn.push(`${f.name} could not be read: ${(e as Error).message}`);
        }
      }
      const b = indexEntries(bookEntries, 'books');
      const a = indexEntries(asEntries, '26as');
      setBooks(b); setAs26(a); setWarnings(warn); setExcluded(excl);
      setOverrides(EMPTY_OVERRIDES); setAiLinks([]); setSelA(new Set()); setSelB(new Set());
      setRestoredAt(null); setExpanded(null); setReview(null); setTab('issues');
      if (useAiNames && b.length && a.length) {
        setProgress('AI matching party names that differ…');
        const auto = autoLinkParties(b, a, options.totalTolerance);
        setAiLinks(await askAiForNames(b, a, auto));
      }
      toast.success(`Read ${a.length} 26AS lines and ${b.length} books lines.`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setRunning(false);
      setProgress(null);
    }
  }

  function reset() {
    setBooks([]); setAs26([]); setAiLinks([]); setOverrides(EMPTY_OVERRIDES); setWarnings([]); setExcluded([]);
    setAsFiles([]); setLedgerFiles([]); setRestoredAt(null); setReview(null); setSelA(new Set()); setSelB(new Set());
    writeSession(null);
  }

  const setForced = (keys: string[], on: boolean) =>
    setOverrides((o) => ({ ...o, forced: on ? [...new Set([...o.forced, ...keys])] : o.forced.filter((k) => !keys.includes(k)) }));
  const setLink = (bookKey: string, dedKey: string) =>
    setOverrides((o) => ({ ...o, links: { ...o.links, [bookKey]: dedKey } }));
  const removeManual = (pairId: string) =>
    setOverrides((o) => ({ ...o, manual: o.manual.filter((m) => `manual:${m.id}` !== pairId) }));

  async function runReview() {
    if (!result) return;
    setReviewBusy(true);
    try {
      setReview(await aiReview(reviewPayload(result, issues, fy)));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setReviewBusy(false);
    }
  }
  const openParty = (key: string) => { setTab('party'); setStatusFilter('all'); setSearch(''); setExpanded(key); };

  const selBooksSum = [...selB].reduce((s, id) => s + (byId.get(id)?.tds ?? 0), 0);
  const selAsSum = [...selA].reduce((s, id) => s + (byId.get(id)?.tds ?? 0), 0);
  function matchSelected() {
    if (!selB.size && !selA.size) return;
    const id = `${Date.now().toString(36)}`;
    setOverrides((o) => ({ ...o, manual: [...o.manual, { id, bookIds: [...selB], asIds: [...selA] }] }));
    setSelB(new Set()); setSelA(new Set());
    toast.success('Matched manually.');
  }
  const toggle = (set: Set<string>, setter: (s: Set<string>) => void, id: string) => {
    const n = new Set(set);
    if (n.has(id)) n.delete(id); else n.add(id);
    setter(n);
  };

  const groups = result?.groups ?? [];
  const totalMatchKeys = groups.filter((g) => g.status === 'total_match').map((g) => g.key);
  const grandAgree = result ? Math.abs(result.totals.diff) <= options.totalTolerance : false;
  const anyOpen = result ? result.totals.openBooks + result.totals.openAs > 0 : false;
  const visibleGroups = groups.filter((g) => {
    if (statusFilter !== 'all' && g.status !== statusFilter) return false;
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (g.deductorName ?? '').toLowerCase().includes(q) || (g.tan ?? '').toLowerCase().includes(q) || g.bookParties.some((p) => p.toLowerCase().includes(q));
  });

  const openBooks = books.filter((e) => !pairOf.has(e.id));
  const openAs = as26.filter((e) => !pairOf.has(e.id));
  const pairs = result?.pairs ?? [];
  const amountDiffPairs = pairs.filter((p) => Math.abs(p.diff) > 0.005);
  const dateDiffPairs = pairs.filter((p) => (p.type === 'date_diff' || p.type === 'amount_only' || p.type === 'rounding') && (p.dayGap ?? 0) > 0);
  const crossPairs = pairs.filter((p) => p.type === 'cross_party');
  const unbooked = as26.filter((e) => e.bookingStatus && e.bookingStatus !== 'F');

  return (
    <div className="space-y-6 pb-24">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <FileSpreadsheet className="h-6 w-6" /> 26AS vs Books Reconciliation
          </h1>
          <p className="text-muted-foreground text-sm mt-1 max-w-3xl">
            Upload Form 26AS and the TDS Receivable ledger (or any ledger showing TDS party-wise and date-wise).
            Parties are matched by TAN, name, proprietor / firm alias, totals and AI; lines are matched even when the
            date or amount differs. Where a party&apos;s totals agree you can force match it.
          </p>
        </div>
        {result && (
          <Button variant="outline" onClick={() => downloadWorkbook(result, { client, fy }, issues, review)}>
            <Download className="h-4 w-4 mr-2" /> Export to Excel
          </Button>
        )}
      </div>

      {restoredAt && (
        <Alert>
          <Info className="h-4 w-4" />
          <AlertTitle>Restored your last reconciliation</AlertTitle>
          <AlertDescription className="text-xs">
            Saved {new Date(restoredAt).toLocaleString('en-IN')} in this browser, with your force matches, manual matches and links.
            <Button variant="link" size="sm" className="h-auto p-0 ml-2" onClick={reset}>Start a new one</Button>
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">1. Upload</CardTitle>
          <CardDescription className="text-xs">
            26AS: the TRACES <b>Text</b> download is read exactly; the PDF and Excel versions also work. Books: Excel / CSV export
            of the ledger (Tally: Display → Account Books → Ledger → TDS Receivable → Export), or a PDF.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <FilePick
              label="Form 26AS"
              hint=".txt (TRACES), .pdf, .xlsx, .csv"
              accept=".txt,.tsv,.pdf,.xlsx,.xls,.csv"
              files={asFiles}
              onChange={setAsFiles}
            />
            <FilePick
              label="Books ledger(s) showing TDS"
              hint=".xlsx, .xls, .csv, .pdf — several files allowed"
              accept=".xlsx,.xls,.csv,.txt,.tsv,.pdf"
              multiple
              files={ledgerFiles}
              onChange={setLedgerFiles}
            />
          </div>
          <div className="grid gap-3 grid-cols-2 md:grid-cols-4 lg:grid-cols-7 items-end">
            <div className="space-y-1">
              <Label className="text-xs">Financial year</Label>
              <select className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={fy} onChange={(e) => setFy(e.target.value)}>
                {FY_OPTIONS.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>
            <div className="space-y-1 col-span-2">
              <Label className="text-xs">Client / assessee</Label>
              <Input className="h-9" value={client} onChange={(e) => setClient(e.target.value)} placeholder="Filled from 26AS when available" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">TDS in ledger is</Label>
              <select className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={nature} onChange={(e) => setNature(e.target.value as LedgerNature)}>
                <option value="auto">Auto-detect</option>
                <option value="debit">Debit side</option>
                <option value="credit">Credit side</option>
              </select>
            </div>
            <NumField label="Date window (days)" value={options.dateWindowDays} onChange={(v) => setOptions((o) => ({ ...o, dateWindowDays: v }))} />
            <NumField label="Rounding / total tolerance ₹" value={options.roundingTolerance} onChange={(v) => setOptions((o) => ({ ...o, roundingTolerance: v, totalTolerance: v }))} />
            <NumField label="Pair if amount differs ≤ %" value={options.amountDiffPct} onChange={(v) => setOptions((o) => ({ ...o, amountDiffPct: v }))} />
          </div>
          <div className="flex items-center gap-4 flex-wrap">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={useAiNames} onCheckedChange={(v) => setUseAiNames(v === true)} />
              Use AI to match party names that differ (proprietor vs firm name)
            </label>
            <div className="flex-1" />
            {result && <Button variant="ghost" onClick={reset}><RotateCcw className="h-4 w-4 mr-2" /> Reset</Button>}
            <Button onClick={run} disabled={running}>
              {running ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />}
              Reconcile
            </Button>
          </div>
          {progress && <div className="text-xs text-muted-foreground flex items-center gap-2"><Loader2 className="h-3 w-3 animate-spin" /> {progress}</div>}
        </CardContent>
      </Card>

      {(warnings.length > 0 || excluded.length > 0) && (
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Reading notes</AlertTitle>
          <AlertDescription className="space-y-1 text-xs">
            {warnings.map((w, i) => <div key={i}>• {w}</div>)}
            {excluded.length > 0 && (
              <div>
                • {excluded.length} row(s) left out of the reconciliation (balances, totals, internal transfers).{' '}
                <button className="underline" onClick={() => setShowExcluded((v) => !v)}>{showExcluded ? 'Hide' : 'Show'}</button>
                {showExcluded && (
                  <div className="mt-1 max-h-48 overflow-auto rounded border bg-muted/30 p-2">
                    {excluded.map((x, i) => <div key={i}><span className="text-muted-foreground">{x.file}:</span> {x.text} — <i>{x.reason}</i></div>)}
                  </div>
                )}
              </div>
            )}
          </AlertDescription>
        </Alert>
      )}

      {result && (
        <>
          <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
            <Tile label="TDS as per books" value={`₹${inr(result.totals.books)}`} sub={`${books.length} lines`} />
            <Tile label="TDS as per 26AS" value={`₹${inr(result.totals.as26)}`} sub={`${as26.length} lines · ${dedList.length} deductors`} />
            <Tile
              label="Difference (Books − 26AS)"
              value={`₹${inr(result.totals.diff)}`}
              tone={Math.abs(result.totals.diff) <= options.totalTolerance ? 'good' : 'bad'}
              sub={Math.abs(result.totals.diff) <= options.totalTolerance ? 'Totals agree' : result.totals.diff > 0 ? 'Books higher — claim at risk' : '26AS higher — TDS not booked'}
            />
            <Tile
              label="Lines matched"
              value={`${result.totals.matchedBooks}/${books.length} · ${result.totals.matchedAs}/${as26.length}`}
              sub="books · 26AS"
              tone={anyOpen ? undefined : 'good'}
            />
          </div>

          {(totalMatchKeys.length > 0 || (grandAgree && anyOpen)) && (
            <Alert className="border-amber-300 bg-amber-50">
              <CheckCircle2 className="h-4 w-4 text-amber-700" />
              <AlertTitle className="text-amber-900">Totals agree — force match available</AlertTitle>
              <AlertDescription className="text-xs text-amber-900 flex flex-wrap gap-2 items-center">
                {totalMatchKeys.length > 0 && (
                  <>
                    <span>{totalMatchKeys.length} part{totalMatchKeys.length === 1 ? 'y has' : 'ies have'} matching totals but lines that do not pair by date or amount.</span>
                    <Button size="sm" variant="outline" className="h-7" onClick={() => setForced(totalMatchKeys, true)}>Force match these parties</Button>
                  </>
                )}
                {grandAgree && anyOpen && (
                  <>
                    <span>The grand totals agree.</span>
                    <Button size="sm" variant="outline" className="h-7" onClick={() => setForced(groups.filter((g) => g.openAsIds.length || g.openBookIds.length).map((g) => g.key), true)}>
                      Force match everything
                    </Button>
                  </>
                )}
              </AlertDescription>
            </Alert>
          )}

          <Tabs value={tab} onValueChange={setTab}>
            <TabsList className="flex-wrap h-auto">
              <TabsTrigger value="issues">Issues 360° ({issues.filter((i) => i.severity !== 'info').length})</TabsTrigger>
              <TabsTrigger value="party">Party-wise (totals)</TabsTrigger>
              <TabsTrigger value="entry">Entry-wise discrepancies ({openBooks.length + openAs.length + amountDiffPairs.length})</TabsTrigger>
              <TabsTrigger value="mapping">Party mapping</TabsTrigger>
              <TabsTrigger value="matches">All matches ({pairs.length})</TabsTrigger>
            </TabsList>

            <TabsContent value="issues" className="space-y-3">
              <IssuesPanel
                issues={issues}
                byId={byId}
                review={review}
                reviewBusy={reviewBusy}
                onReview={runReview}
                onOpenParty={openParty}
              />
            </TabsContent>

            <TabsContent value="party" className="space-y-3">
              <div className="flex gap-2 flex-wrap items-center">
                <Input className="h-8 w-64" placeholder="Search party or TAN" value={search} onChange={(e) => setSearch(e.target.value)} />
                <select className="h-8 rounded-md border bg-background px-2 text-sm" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}>
                  <option value="all">All statuses ({groups.length})</option>
                  {(Object.keys(STATUS_LABEL) as PartyGroup['status'][]).map((s) => (
                    <option key={s} value={s}>{STATUS_LABEL[s]} ({groups.filter((g) => g.status === s).length})</option>
                  ))}
                </select>
              </div>
              <Card>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-6" />
                      <TableHead>26AS deductor</TableHead>
                      <TableHead>Books party</TableHead>
                      <TableHead>Link</TableHead>
                      <TableHead className="text-right">Books TDS</TableHead>
                      <TableHead className="text-right">26AS TDS</TableHead>
                      <TableHead className="text-right">Difference</TableHead>
                      <TableHead className="text-center">Lines matched</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visibleGroups.map((g) => (
                      <Fragment key={g.key}>
                        <TableRow className="cursor-pointer" onClick={() => setExpanded(expanded === g.key ? null : g.key)}>
                          <TableCell>{expanded === g.key ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</TableCell>
                          <TableCell>
                            <div className="font-medium text-sm">{g.deductorName ?? '—'}</div>
                            {g.tan && <div className="text-[11px] text-muted-foreground">{g.tan}</div>}
                          </TableCell>
                          <TableCell className="text-sm max-w-[240px]">{g.bookParties.join('; ') || '—'}</TableCell>
                          <TableCell>
                            {g.link ? (
                              <Badge variant="outline" className="text-[10px]" title={g.link.reason}>
                                {LINK_LABEL[g.link.method]}{g.link.method !== 'manual' && g.link.method !== 'tan' ? ` ${g.link.confidence}%` : ''}
                              </Badge>
                            ) : <span className="text-xs text-muted-foreground">—</span>}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{inr(g.booksTotal)}</TableCell>
                          <TableCell className="text-right tabular-nums">{inr(g.asTotal)}</TableCell>
                          <TableCell className={cn('text-right tabular-nums font-medium', Math.abs(g.diff) > options.totalTolerance && 'text-red-600')}>{inr(g.diff)}</TableCell>
                          <TableCell className="text-center text-xs tabular-nums">{g.matchedBooks}/{g.booksCount} · {g.matchedAs}/{g.asCount}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className={cn('text-[10px] whitespace-nowrap', STATUS_STYLE[g.status])}>{STATUS_LABEL[g.status]}</Badge>
                            {g.unbookedAs > 0 && <div className="text-[10px] text-amber-700 mt-0.5">{g.unbookedAs} line(s) not booked (status ≠ F)</div>}
                          </TableCell>
                          <TableCell onClick={(e) => e.stopPropagation()}>
                            {g.status === 'total_match' && <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setForced([g.key], true)}>Force match</Button>}
                            {g.status === 'forced' && <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setForced([g.key], false)}>Undo force</Button>}
                          </TableCell>
                        </TableRow>
                        {expanded === g.key && (
                          <TableRow>
                            <TableCell colSpan={10} className="bg-muted/30">
                              <GroupDetail
                                group={g}
                                pairs={pairs.filter((p) => p.groupKey === g.key)}
                                byId={byId}
                                pairOf={pairOf}
                                selB={selB} selA={selA}
                                toggleB={(id) => toggle(selB, setSelB, id)}
                                toggleA={(id) => toggle(selA, setSelA, id)}
                                onUnmatch={removeManual}
                                onUnforce={() => setForced([g.key], false)}
                              />
                            </TableCell>
                          </TableRow>
                        )}
                      </Fragment>
                    ))}
                    {!visibleGroups.length && (
                      <TableRow><TableCell colSpan={10} className="text-center text-sm text-muted-foreground py-6">No parties.</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </Card>
            </TabsContent>

            <TabsContent value="entry" className="space-y-4">
              <p className="text-xs text-muted-foreground">
                Tick lines on both sides and press <b>Match selected</b> to pair them yourself — across parties too.
              </p>
              <div className="grid gap-4 xl:grid-cols-2">
                <EntryTable
                  title={`In books, not in 26AS (${openBooks.length})`}
                  subtitle={`₹${inr(openBooks.reduce((s, e) => s + e.tds, 0))} — TDS claimed in books that the deductor has not reported`}
                  entries={openBooks}
                  selected={selB}
                  onToggle={(id) => toggle(selB, setSelB, id)}
                  groupOf={groupOfEntry}
                />
                <EntryTable
                  title={`In 26AS, not in books (${openAs.length})`}
                  subtitle={`₹${inr(openAs.reduce((s, e) => s + e.tds, 0))} — TDS reported by the deductor but not booked`}
                  entries={openAs}
                  selected={selA}
                  onToggle={(id) => toggle(selA, setSelA, id)}
                  groupOf={groupOfEntry}
                />
              </div>
              <PairTable title={`Matched, amount differs (${amountDiffPairs.length})`} pairs={amountDiffPairs} byId={byId} onUnmatch={removeManual} />
              <PairTable title={`Matched, date differs (${dateDiffPairs.length})`} pairs={dateDiffPairs} byId={byId} onUnmatch={removeManual} />
              <PairTable title={`Booked under a different party (${crossPairs.length})`} pairs={crossPairs} byId={byId} onUnmatch={removeManual} />
              {unbooked.length > 0 && (
                <Card>
                  <CardHeader className="py-3"><CardTitle className="text-sm">26AS lines not finally booked ({unbooked.length})</CardTitle>
                    <CardDescription className="text-xs">Booking status U / P / O: the deductor&apos;s challan is unmatched, provisional or over-booked. Credit may not be allowed until the deductor corrects it.</CardDescription>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <SimpleEntries entries={unbooked} />
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            <TabsContent value="mapping" className="space-y-3">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-xs text-muted-foreground flex-1">
                  Each books party is linked to a 26AS deductor. Change any link here; a books party can be linked to the deductor
                  under a different name (e.g. proprietor&apos;s own name in 26AS against the firm name in the books).
                </p>
                <Button size="sm" variant="outline" disabled={aiBusy} onClick={async () => {
                  const got = await askAiForNames(books, as26, links);
                  setAiLinks((prev) => [...prev, ...got]);
                }}>
                  {aiBusy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}
                  Ask AI to match unlinked names
                </Button>
              </div>
              <Card>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Books party</TableHead>
                      <TableHead className="text-right">Books TDS</TableHead>
                      <TableHead>Linked 26AS deductor</TableHead>
                      <TableHead className="text-right">26AS TDS</TableHead>
                      <TableHead>How</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {bookList.map((b) => {
                      const l = links.find((x) => x.bookKey === b.key);
                      const d = l ? dedList.find((x) => x.key === l.deductorKey) : undefined;
                      return (
                        <TableRow key={b.key}>
                          <TableCell className="text-sm">{b.name}</TableCell>
                          <TableCell className="text-right tabular-nums">{inr(b.total)}</TableCell>
                          <TableCell>
                            <select
                              className="h-8 w-full max-w-[320px] rounded-md border bg-background px-2 text-xs"
                              value={l?.deductorKey ?? ''}
                              onChange={(e) => setLink(b.key, e.target.value)}
                            >
                              <option value="">— not linked —</option>
                              {dedList.map((x) => <option key={x.key} value={x.key}>{x.name}{x.tan ? ` (${x.tan})` : ''} — ₹{inr(x.total)}</option>)}
                            </select>
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{d ? inr(d.total) : '—'}</TableCell>
                          <TableCell className="text-xs max-w-[320px]">
                            {l ? (
                              <span className="flex items-start gap-1">
                                <Link2 className="h-3 w-3 mt-0.5 shrink-0" />
                                <span><b>{LINK_LABEL[l.method]}</b> — {l.reason}</span>
                              </span>
                            ) : <span className="text-muted-foreground flex items-center gap-1"><Unlink className="h-3 w-3" /> Not in 26AS</span>}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </Card>
              {(() => {
                const linked = new Set(links.map((l) => l.deductorKey));
                const orphan = dedList.filter((d) => !linked.has(d.key));
                if (!orphan.length) return null;
                return (
                  <Card>
                    <CardHeader className="py-3"><CardTitle className="text-sm">26AS deductors with no books party ({orphan.length})</CardTitle></CardHeader>
                    <CardContent className="pt-0 text-xs space-y-1">
                      {orphan.map((d) => <div key={d.key}>{d.name} {d.tan && <span className="text-muted-foreground">({d.tan})</span>} — ₹{inr(d.total)} in {d.count} line(s)</div>)}
                    </CardContent>
                  </Card>
                );
              })()}
            </TabsContent>

            <TabsContent value="matches">
              <PairTable title="Every match" pairs={pairs} byId={byId} onUnmatch={removeManual} showAll />
            </TabsContent>
          </Tabs>
        </>
      )}

      {(selB.size > 0 || selA.size > 0) && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 rounded-lg border bg-background shadow-lg px-4 py-2 flex items-center gap-4 text-sm">
          <span>Books <b className="tabular-nums">₹{inr(selBooksSum)}</b> ({selB.size})</span>
          <span>26AS <b className="tabular-nums">₹{inr(selAsSum)}</b> ({selA.size})</span>
          <span className={cn('tabular-nums', Math.abs(selBooksSum - selAsSum) > options.roundingTolerance ? 'text-red-600' : 'text-emerald-700')}>
            Difference ₹{inr(selBooksSum - selAsSum)}
          </span>
          <Button size="sm" onClick={matchSelected}>Match selected</Button>
          <Button size="sm" variant="ghost" onClick={() => { setSelA(new Set()); setSelB(new Set()); }}><X className="h-4 w-4" /></Button>
        </div>
      )}
    </div>
  );
}

function FilePick({ label, hint, accept, multiple, files, onChange }: {
  label: string; hint: string; accept: string; multiple?: boolean; files: File[]; onChange: (f: File[]) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div
      className="rounded-lg border-2 border-dashed p-4 text-center cursor-pointer hover:bg-muted/40"
      onClick={() => ref.current?.click()}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => { e.preventDefault(); const f = Array.from(e.dataTransfer.files); onChange(multiple ? [...files, ...f] : f.slice(0, 1)); }}
    >
      <Upload className="h-5 w-5 mx-auto text-muted-foreground" />
      <div className="text-sm font-medium mt-1">{label}</div>
      <div className="text-[11px] text-muted-foreground">{hint}</div>
      <input
        ref={ref}
        type="file"
        className="hidden"
        accept={accept}
        multiple={multiple}
        onChange={(e) => { const f = Array.from(e.target.files || []); onChange(multiple ? [...files, ...f] : f.slice(0, 1)); e.target.value = ''; }}
      />
      {files.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1 justify-center" onClick={(e) => e.stopPropagation()}>
          {files.map((f, i) => (
            <Badge key={i} variant="secondary" className="text-[11px] gap-1">
              {f.name}
              <button onClick={() => onChange(files.filter((_, j) => j !== i))}><X className="h-3 w-3" /></button>
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}

function NumField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <Input className="h-9" type="number" min={0} value={value} onChange={(e) => onChange(Math.max(0, Number(e.target.value) || 0))} />
    </div>
  );
}

function Tile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'good' | 'bad' }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className={cn('text-xl font-semibold tabular-nums mt-1', tone === 'good' && 'text-emerald-700', tone === 'bad' && 'text-red-600')}>{value}</div>
        {sub && <div className="text-[11px] text-muted-foreground mt-0.5">{sub}</div>}
      </CardContent>
    </Card>
  );
}

function EntryTable({ title, subtitle, entries, selected, onToggle, groupOf }: {
  title: string; subtitle: string; entries: TdsEntry[]; selected: Set<string>; onToggle: (id: string) => void; groupOf: Map<string, PartyGroup>;
}) {
  return (
    <Card>
      <CardHeader className="py-3">
        <CardTitle className="text-sm">{title}</CardTitle>
        <CardDescription className="text-xs">{subtitle}</CardDescription>
      </CardHeader>
      <CardContent className="pt-0 max-h-[480px] overflow-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-6" />
              <TableHead>Party</TableHead>
              <TableHead>Date</TableHead>
              <TableHead className="text-right">TDS</TableHead>
              <TableHead>Ref</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.map((e) => {
              const g = groupOf.get(e.id);
              return (
                <TableRow key={e.id} className={cn(selected.has(e.id) && 'bg-primary/5')}>
                  <TableCell><Checkbox checked={selected.has(e.id)} onCheckedChange={() => onToggle(e.id)} /></TableCell>
                  <TableCell className="text-xs">
                    {e.party}
                    {e.side === 'books' && g?.deductorName && g.deductorName !== e.party && <div className="text-[10px] text-muted-foreground">26AS: {g.deductorName}</div>}
                    {e.section && <span className="text-[10px] text-muted-foreground"> · {e.section}</span>}
                  </TableCell>
                  <TableCell className="text-xs tabular-nums whitespace-nowrap">{fmtDate(e.date)}</TableCell>
                  <TableCell className="text-right text-xs tabular-nums">{inr(e.tds)}</TableCell>
                  <TableCell className="text-[11px] text-muted-foreground max-w-[180px] truncate" title={e.ref}>{e.ref || ''}</TableCell>
                </TableRow>
              );
            })}
            {!entries.length && <TableRow><TableCell colSpan={5} className="text-center text-xs text-muted-foreground py-4">None.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function SimpleEntries({ entries }: { entries: TdsEntry[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Party</TableHead><TableHead>Section</TableHead><TableHead>Date</TableHead>
          <TableHead className="text-right">TDS</TableHead><TableHead>Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {entries.map((e) => (
          <TableRow key={e.id}>
            <TableCell className="text-xs">{e.party}</TableCell>
            <TableCell className="text-xs">{e.section || ''}</TableCell>
            <TableCell className="text-xs tabular-nums">{fmtDate(e.date)}</TableCell>
            <TableCell className="text-right text-xs tabular-nums">{inr(e.tds)}</TableCell>
            <TableCell className="text-xs">{e.bookingStatus}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function PairTable({ title, pairs, byId, onUnmatch, showAll }: {
  title: string; pairs: MatchPair[]; byId: Map<string, TdsEntry>; onUnmatch: (id: string) => void; showAll?: boolean;
}) {
  if (!pairs.length && !showAll) return null;
  const side = (ids: string[]) => ids.map((id) => byId.get(id)).filter((e): e is TdsEntry => !!e);
  return (
    <Card>
      <CardHeader className="py-3"><CardTitle className="text-sm">{title}</CardTitle></CardHeader>
      <CardContent className="pt-0 max-h-[520px] overflow-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Match</TableHead>
              <TableHead>Books</TableHead>
              <TableHead className="text-right">Books TDS</TableHead>
              <TableHead>26AS</TableHead>
              <TableHead className="text-right">26AS TDS</TableHead>
              <TableHead className="text-right">Difference</TableHead>
              <TableHead className="text-right">Days</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {pairs.map((p) => {
              const bs = side(p.bookIds), as = side(p.asIds);
              return (
                <TableRow key={p.id}>
                  <TableCell>
                    <Badge variant="outline" className="text-[10px] whitespace-nowrap">{MATCH_LABEL[p.type]}</Badge>
                    {p.note && <div className="text-[10px] text-muted-foreground mt-0.5 max-w-[200px]">{p.note}</div>}
                  </TableCell>
                  <TableCell className="text-[11px]">
                    {bs.slice(0, 4).map((e) => <div key={e.id}>{e.party} · {fmtDate(e.date)} · {inr(e.tds)}</div>)}
                    {bs.length > 4 && <div className="text-muted-foreground">+{bs.length - 4} more</div>}
                  </TableCell>
                  <TableCell className="text-right text-xs tabular-nums">{inr(p.booksAmount)}</TableCell>
                  <TableCell className="text-[11px]">
                    {as.slice(0, 4).map((e) => <div key={e.id}>{e.party} · {fmtDate(e.date)} · {inr(e.tds)}</div>)}
                    {as.length > 4 && <div className="text-muted-foreground">+{as.length - 4} more</div>}
                  </TableCell>
                  <TableCell className="text-right text-xs tabular-nums">{inr(p.asAmount)}</TableCell>
                  <TableCell className={cn('text-right text-xs tabular-nums', Math.abs(p.diff) > 0.005 && 'text-red-600 font-medium')}>{inr(p.diff)}</TableCell>
                  <TableCell className="text-right text-xs tabular-nums">{p.dayGap ?? '—'}</TableCell>
                  <TableCell>
                    {p.type === 'manual' && <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => onUnmatch(p.id)}>Unmatch</Button>}
                  </TableCell>
                </TableRow>
              );
            })}
            {!pairs.length && <TableRow><TableCell colSpan={8} className="text-center text-xs text-muted-foreground py-4">None.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function GroupDetail({ group, pairs, byId, pairOf, selB, selA, toggleB, toggleA, onUnmatch, onUnforce }: {
  group: PartyGroup; pairs: MatchPair[]; byId: Map<string, TdsEntry>; pairOf: Map<string, MatchPair>;
  selB: Set<string>; selA: Set<string>; toggleB: (id: string) => void; toggleA: (id: string) => void;
  onUnmatch: (id: string) => void; onUnforce: () => void;
}) {
  const openB = group.openBookIds.map((id) => byId.get(id)!).filter(Boolean);
  const openA = group.openAsIds.map((id) => byId.get(id)!).filter(Boolean);
  const lineList = (xs: TdsEntry[], sel: Set<string>, tog: (id: string) => void, empty: string) => (
    <div className="space-y-1">
      {xs.map((e) => (
        <label key={e.id} className="flex items-center gap-2 text-xs cursor-pointer">
          <Checkbox checked={sel.has(e.id)} onCheckedChange={() => tog(e.id)} />
          <span className="tabular-nums w-24">{fmtDate(e.date)}</span>
          <span className="tabular-nums w-28 text-right">{inr(e.tds)}</span>
          <span className="text-muted-foreground truncate">{e.section ? `${e.section} · ` : ''}{e.ref || (e.side === 'books' ? e.party : '')}</span>
        </label>
      ))}
      {!xs.length && <div className="text-xs text-muted-foreground">{empty}</div>}
    </div>
  );
  return (
    <div className="space-y-3 py-1">
      {group.link && <div className="text-xs"><b>Link:</b> {group.link.reason}</div>}
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <div className="text-xs font-semibold mb-1">Open in books ({openB.length})</div>
          {lineList(openB, selB, toggleB, 'Every books line is matched.')}
        </div>
        <div>
          <div className="text-xs font-semibold mb-1">Open in 26AS ({openA.length})</div>
          {lineList(openA, selA, toggleA, 'Every 26AS line is matched.')}
        </div>
      </div>
      {pairs.length > 0 && (
        <div>
          <div className="text-xs font-semibold mb-1">Matched ({pairs.length})</div>
          <div className="space-y-0.5">
            {pairs.map((p) => (
              <div key={p.id} className="text-[11px] flex items-center gap-2 flex-wrap">
                <Badge variant="outline" className="text-[10px]">{MATCH_LABEL[p.type]}</Badge>
                <span className="tabular-nums">Books {inr(p.booksAmount)} ({p.bookIds.map((id) => fmtDate(byId.get(id)?.date ?? null)).join(', ') || '—'})</span>
                <span>↔</span>
                <span className="tabular-nums">26AS {inr(p.asAmount)} ({p.asIds.map((id) => fmtDate(byId.get(id)?.date ?? null)).join(', ') || '—'})</span>
                {Math.abs(p.diff) > 0.005 && <span className="text-red-600 tabular-nums">diff {inr(p.diff)}</span>}
                {p.note && <span className="text-muted-foreground">{p.note}</span>}
                {p.type === 'manual' && <button className="underline text-muted-foreground" onClick={() => onUnmatch(p.id)}>unmatch</button>}
                {p.type === 'forced' && <button className="underline text-muted-foreground" onClick={onUnforce}>undo force</button>}
              </div>
            ))}
          </div>
        </div>
      )}
      {pairOf.size === 0 && null}
    </div>
  );
}

const SEV_STYLE: Record<IssueSeverity, string> = {
  high: 'bg-red-100 text-red-800 border-red-200',
  medium: 'bg-amber-100 text-amber-800 border-amber-200',
  low: 'bg-slate-100 text-slate-700 border-slate-200',
  info: 'bg-sky-50 text-sky-800 border-sky-200',
};

function IssuesPanel({ issues, byId, review, reviewBusy, onReview, onOpenParty }: {
  issues: Issue[]; byId: Map<string, TdsEntry>; review: AiReview | null; reviewBusy: boolean;
  onReview: () => void; onOpenParty: (key: string) => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const counts = (['high', 'medium', 'low', 'info'] as IssueSeverity[]).map((s) => [s, issues.filter((i) => i.severity === s).length] as const);
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        {counts.map(([s, n]) => (
          <Badge key={s} variant="outline" className={cn('text-[11px] capitalize', SEV_STYLE[s])}>{s}: {n}</Badge>
        ))}
        <div className="flex-1" />
        <Button size="sm" variant="outline" disabled={reviewBusy} onClick={onReview}>
          {reviewBusy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}
          {review ? 'Re-run AI 360° review' : 'AI 360° review'}
        </Button>
      </div>

      {review && (
        <Card className="border-violet-200">
          <CardHeader className="py-3">
            <CardTitle className="text-sm flex items-center gap-2"><Sparkles className="h-4 w-4 text-violet-600" /> AI reviewer</CardTitle>
            <CardDescription className="text-xs whitespace-pre-line">{review.summary}</CardDescription>
          </CardHeader>
          <CardContent className="pt-0 space-y-2 text-xs">
            {review.findings.map((f, i) => (
              <div key={i} className="flex gap-2">
                <Badge variant="outline" className={cn('text-[10px] h-fit capitalize', SEV_STYLE[(f.severity as IssueSeverity) in SEV_STYLE ? f.severity as IssueSeverity : 'low'])}>{f.severity}</Badge>
                <div><b>{f.title}</b> — {f.detail} {f.action && <span className="text-muted-foreground">→ {f.action}</span>}</div>
              </div>
            ))}
            {review.next_steps.length > 0 && (
              <div>
                <div className="font-semibold mt-2">Next steps</div>
                <ol className="list-decimal ml-5 space-y-0.5">{review.next_steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {!issues.length && (
        <Alert><CheckCircle2 className="h-4 w-4" /><AlertTitle>No issues found</AlertTitle><AlertDescription className="text-xs">Every check passed.</AlertDescription></Alert>
      )}
      {issues.map((i) => {
        const lines = (i.entryIds ?? []).map((id) => byId.get(id)).filter((e): e is TdsEntry => !!e);
        const isOpen = open === i.id;
        return (
          <Card key={i.id}>
            <CardContent className="p-3 space-y-1">
              <div className="flex items-start gap-2">
                <ShieldAlert className={cn('h-4 w-4 mt-0.5 shrink-0', i.severity === 'high' ? 'text-red-600' : i.severity === 'medium' ? 'text-amber-600' : 'text-muted-foreground')} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium">{i.title}</span>
                    <Badge variant="outline" className={cn('text-[10px] capitalize', SEV_STYLE[i.severity])}>{i.severity}</Badge>
                    <Badge variant="outline" className="text-[10px]">{CATEGORY_LABEL[i.category]}</Badge>
                    {i.amount !== undefined && <span className="text-xs tabular-nums text-muted-foreground">₹{inr(i.amount)}</span>}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">{i.detail}</div>
                  <div className="text-xs mt-0.5"><b>Action:</b> {i.action}</div>
                  <div className="flex gap-3 mt-1">
                    {lines.length > 0 && (
                      <button className="text-xs underline" onClick={() => setOpen(isOpen ? null : i.id)}>
                        {isOpen ? 'Hide' : 'Show'} {lines.length} line{lines.length === 1 ? '' : 's'}
                      </button>
                    )}
                    {i.groupKey && <button className="text-xs underline" onClick={() => onOpenParty(i.groupKey!)}>Open party</button>}
                  </div>
                  {isOpen && (
                    <div className="mt-2 max-h-64 overflow-auto rounded border">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Side</TableHead><TableHead>Party</TableHead><TableHead>Section</TableHead>
                            <TableHead>Date</TableHead><TableHead className="text-right">Amount paid</TableHead><TableHead className="text-right">TDS</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {lines.slice(0, 200).map((e) => (
                            <TableRow key={e.id}>
                              <TableCell className="text-[11px]">{e.side === 'books' ? 'Books' : '26AS'}</TableCell>
                              <TableCell className="text-[11px]">{e.party}</TableCell>
                              <TableCell className="text-[11px]">{e.section || ''}</TableCell>
                              <TableCell className="text-[11px] tabular-nums">{fmtDate(e.date)}</TableCell>
                              <TableCell className="text-right text-[11px] tabular-nums">{e.amountPaid !== undefined ? inr(e.amountPaid) : ''}</TableCell>
                              <TableCell className="text-right text-[11px] tabular-nums">{inr(e.tds)}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
