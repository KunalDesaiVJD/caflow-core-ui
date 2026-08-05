/**
 * TDS Correction module (staff side).
 *
 * Corrects TDS data that has ALREADY BEEN FILED for an earlier quarter / FY.
 * The originally filed Data Entry and Validate & Finalise records are never
 * written to — a correction is a third, separate version of the return, held
 * in tds_correction_* (see supabase/migrations/20260729170000).
 *
 * Two views: a dashboard (search / filter / track) and a correction detail
 * editor. Once signed, a correction is read-only — enforced by a DB trigger,
 * mirrored here so the UI never offers an action the database will reject.
 *
 * UI follows the Data Entry module's language: compact info strips with "|"
 * separators, Card > CardContent p-0 > Table for dense grids, text-[9px]
 * badges, and emerald/amber/destructive as the semantic trio.
 *
 * The detail view is built for the real shape of the job — a challan can hold
 * hundreds of deductees and the user is hunting for the one that is wrong — so
 * search and change-filters sit above the grid, challans collapse, rows are
 * dense, and clicking a row opens it for edit (no hunting for a pencil).
 */
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import {
  Search, Plus, ArrowLeft, PenTool, Trash2, Pencil, RotateCcw, X, GitCompare,
  CheckCircle2, XCircle, Landmark, ShieldCheck, Lock, ChevronDown, ChevronRight,
  AlertTriangle, Send, Upload, Eye, Lightbulb,
} from "lucide-react";
import { isFilingTdsCompliant } from "@/lib/tdsQuarter";
import { isProcessedWorkStatus, PROCESSED_WITH_DEFAULT_STATUS, PROCESSED_WITHOUT_DEFAULT_STATUS } from "./TdsFilingsManager";
import { TdsDataEntry, CORRECTION_TDS_SOURCE } from "./TdsDataEntry";
import {
  CORRECTION_STATUS_META, isCorrectionLocked, isCorrectionEditable,
  createCorrection, loadCorrectionDetail, submitCorrection,
  signAsPreparer, approveAsSenior, markCorrectionFiled,
  rejectCorrection, discardCorrection, summariseCorrection, logCorrectionAction, diffCorrectionRow,
  undoCorrectionRow, uploadCorrectionProof, removeCorrectionProof, canMarkFiled, effectiveCorrectionAction,
  updateCorrectionProcessedOutcome, CORRECTION_PROCESSED_OUTCOMES,
  fetchRecommendations, type Recommendation,
  SUBMISSION_MODE_META, type SubmissionMode,
  type Correction, type CorrectionStatus, type CorrectionChallan,
  type CorrectionDeductee, type CorrectionAction, type Actor, type FieldDiff,
} from "@/lib/tdsCorrections";

/** Every lifecycle state, in workflow order — used by the tiles and filters. */
const ALL_STATUSES: CorrectionStatus[] = [
  "draft", "awaiting_employee", "awaiting_senior", "ready_to_file", "filed", "rejected",
];
import {
  type RateEntry, getRateForSection, computeApplied, computeAllocatable,
  challanStatus, balanceColorClass, statusTextClass, calcAutoInterest,
  PAN_4TH_CHAR_MAP, isValidPan,
} from "@/lib/tds/rateEngine";

interface ClientOption {
  id: string; name: string | null; pan?: string | null;
  tds_start_fy?: string; tds_start_quarter?: string;
  tds_end_fy?: string; tds_end_quarter?: string;
  tds_forms_applicable?: string[];
}
interface UserOption { id: string; name: string | null; }

interface Props {
  clients: ClientOption[];
  users: UserOption[];
  isSuperadmin: boolean;
  resolveFirmId: () => Promise<string | null>;
}

const FY_OPTIONS = Array.from({ length: 7 }, (_, i) => { const s = 2020 + i; return `${s}-${String(s + 1).slice(2)}`; });
const QUARTERS = ["Q1", "Q2", "Q3", "Q4"];
const FORMS = ["24Q", "26Q", "27Q", "27EQ"];

const money = (n: number | null | undefined) =>
  n == null ? "—" : new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(n);

const shortDate = (d: string | null | undefined) => {
  if (!d) return "—";
  const p = new Date(d);
  return isNaN(p.getTime()) ? "—" : format(p, "dd/MM/yyyy");
};

/** Left rail colour + badge tone per change type — one place, used everywhere. */
const ACTION_META: Record<CorrectionAction, { rail: string; badge: string; label: string }> = {
  unchanged: { rail: "border-l-transparent", badge: "", label: "" },
  add:       { rail: "border-l-emerald-500", badge: "bg-emerald-100 text-emerald-700", label: "Added" },
  modify:    { rail: "border-l-amber-500",   badge: "bg-amber-100 text-amber-700",     label: "Modified" },
  delete:    { rail: "border-l-red-500",     badge: "bg-red-100 text-red-700",         label: "Deleted" },
};

type ChangeFilter = "all" | "changed" | "add" | "modify" | "delete";

// Fixed legal enumeration (Sec 197/197A/206AA reason codes) — not a rate or
// business rule that changes with the law, so a small local copy here (same
// values as TdsDataEntry.tsx) is low-risk, unlike the rate/interest/balance
// engine which is shared via rateEngine.ts.
const REASON_CODES = [
  { code: "A", label: "A — Below threshold (no deduction required)" },
  { code: "B", label: "B — Lower rate certificate u/s 197" },
  { code: "C", label: "C — No deduction u/s 197A (Form 15G/15H)" },
  { code: "D", label: "D — Payment to Government" },
  { code: "E", label: "E — Notification/rules exemption" },
  { code: "Y", label: "Y — Any other reason" },
  { code: "Z", label: "Z — Higher rate u/s 206AA (PAN not available)" },
];

const PROCESSED_OUTCOME_TONE: Record<string, string> = {
  [PROCESSED_WITH_DEFAULT_STATUS]: "bg-amber-200 text-amber-900 dark:bg-amber-900/50 dark:text-amber-200",
  [PROCESSED_WITHOUT_DEFAULT_STATUS]: "bg-emerald-200 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200",
};

/**
 * Shown wherever a correction's state needs to read at a glance. A filed
 * correction's own processed_outcome (set from the Processed buttons in
 * FilingBox) takes over the badge once recorded — "Filed" alone would be
 * stale the moment someone records what happened after filing.
 */
export function CorrectionStatusBadge({
  status, processedOutcome, className,
}: { status: string; processedOutcome?: string | null; className?: string }) {
  if (status === "filed" && processedOutcome) {
    return (
      <Badge className={cn("gap-1 text-[11px]", PROCESSED_OUTCOME_TONE[processedOutcome] || "bg-muted", className)}>
        <CheckCircle2 size={11} /> {processedOutcome}
      </Badge>
    );
  }
  const meta = CORRECTION_STATUS_META[status as CorrectionStatus] ?? CORRECTION_STATUS_META.draft;
  return (
    <Badge className={cn("gap-1 text-[11px]", meta.tone, className)}>
      {status === "filed" && <CheckCircle2 size={11} />}
      {status === "rejected" && <XCircle size={11} />}
      {meta.label}
    </Badge>
  );
}

// ═══════════════════════════════════════════════════════════════════════════

export function TdsCorrectionsModule({ clients, users, isSuperadmin, resolveFirmId }: Props) {
  const { user } = useAuth();
  const { toast } = useToast();

  const actor: Actor = useMemo(() => ({
    id: user?.id ?? null,
    name: user?.name || user?.email || null,
    role: user?.role ?? null,
  }), [user?.id, user?.name, user?.email, user?.role]);

  const [openId, setOpenId] = useState<string | null>(null);
  // Collapsed by default (2026-08-06: Recommendations folded into the single
  // Corrections page instead of living in its own tab) — expanding it is a
  // deliberate "let me see what needs review" action, not the landing view.
  const [recsOpen, setRecsOpen] = useState(false);
  const [recsCount, setRecsCount] = useState(0);
  // Handed from the Recommendations panel's "Create Correction" button down
  // to CorrectionDashboard's own NewCorrectionDialog instance.
  const [newFromRecommendation, setNewFromRecommendation] = useState<CorrectionPrefill | null>(null);

  return (
    <div className="space-y-3">
      {/* Recommendations — collapsible, sits above the primary workspace
          rather than in its own tab. Always fetches (so the count badge is
          accurate even collapsed); only renders the row list when expanded. */}
      <Card className="border-amber-200 dark:border-amber-900">
        <button
          type="button"
          onClick={() => setRecsOpen(o => !o)}
          className="w-full flex items-center justify-between gap-2 px-4 py-2.5 text-left"
        >
          <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Lightbulb size={14} className="text-amber-600" /> Recommendations
            {recsCount > 0 && (
              <Badge className="bg-amber-200 text-amber-900 dark:bg-amber-900/50 dark:text-amber-200 text-[10px]">
                {recsCount}
              </Badge>
            )}
          </span>
          {recsOpen ? <ChevronDown size={16} className="text-muted-foreground" /> : <ChevronRight size={16} className="text-muted-foreground" />}
        </button>
        {/* Always mounted (not just while open) so it keeps fetching and the
            count badge stays accurate while collapsed — same render-but-hide
            pattern as the rest of this codebase's local tab bars. */}
        <div className={recsOpen ? "px-4 pb-4" : "hidden"}>
          <RecommendationsTab
            clients={clients} isSuperadmin={isSuperadmin} resolveFirmId={resolveFirmId}
            onCountChange={setRecsCount}
            onCreateCorrection={(prefill) => { setNewFromRecommendation(prefill); setRecsOpen(false); }}
          />
        </div>
      </Card>

      {openId
        ? <CorrectionDetail
            correctionId={openId} clients={clients} actor={actor}
            onBack={() => setOpenId(null)} toast={toast}
          />
        : <CorrectionDashboard
            clients={clients} users={users} isSuperadmin={isSuperadmin}
            resolveFirmId={resolveFirmId} actor={actor} toast={toast}
            onOpen={setOpenId}
            externalPrefill={newFromRecommendation}
            onExternalPrefillConsumed={() => setNewFromRecommendation(null)}
          />}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Dashboard
// ═══════════════════════════════════════════════════════════════════════════

/** What the Recommendations tab already knows about a period, handed to
 *  NewCorrectionDialog to skip re-picking it. */
export interface CorrectionPrefill {
  clientId: string; fy: string; quarter: string; form: string; reason?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// Recommendations
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Every return currently "Processed with Default" with no correction
 * already in progress — derived live from tds_filings.work_status
 * (fetchRecommendations, tdsCorrections.ts), not a separate stored list.
 * "Processed without Default" needs no correction, so it never appears
 * here — and a period drops out the moment a correction is raised for it,
 * reappearing automatically if THAT correction's own outcome comes back
 * "Processed with Default" again (the sync trigger, 20260805170000, is what
 * makes that loop self-maintaining).
 */
function RecommendationsTab({
  clients, isSuperadmin, resolveFirmId, onCreateCorrection, onCountChange,
}: {
  clients: ClientOption[]; isSuperadmin: boolean; resolveFirmId: () => Promise<string | null>;
  onCreateCorrection: (prefill: CorrectionPrefill) => void;
  onCountChange?: (count: number) => void;
}) {
  const [rows, setRows] = useState<Recommendation[]>([]);
  const [loading, setLoading] = useState(true);

  const clientMap = useMemo(
    () => Object.fromEntries(clients.map(c => [c.id, c.name || "—"])),
    [clients],
  );

  const fetchRows = useCallback(async () => {
    setLoading(true);
    const firmId = await resolveFirmId();
    const data = await fetchRecommendations(firmId, isSuperadmin);
    const sorted = data.slice().sort((a, b) =>
      (clientMap[a.client_id] || "").localeCompare(clientMap[b.client_id] || "")
      || a.financial_year.localeCompare(b.financial_year) || a.quarter.localeCompare(b.quarter));
    setRows(sorted);
    onCountChange?.(sorted.length);
    setLoading(false);
  }, [isSuperadmin, resolveFirmId, clientMap, onCountChange]);

  useEffect(() => { fetchRows(); }, [fetchRows]);

  // Live: a status change on the Dashboard, or a correction's outcome being
  // recorded (which syncs into tds_filings via the trigger), both need to
  // move a row into or out of this list without a manual refresh — this
  // stays subscribed even while the section is collapsed, so the count
  // badge on the collapsed header never goes stale.
  useEffect(() => {
    const ch = supabase
      .channel("tds-recommendations")
      .on("postgres_changes", { event: "*", schema: "public", table: "tds_filings" }, () => fetchRows())
      .on("postgres_changes", { event: "*", schema: "public", table: "tds_corrections" }, () => fetchRows())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [fetchRows]);

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Returns marked Processed with Default — review the reason and raise a correction if needed.
      </p>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? (
        <Card><CardContent className="p-6 text-center text-sm text-muted-foreground">
          Nothing needs review right now — no return is currently Processed with Default.
        </CardContent></Card>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => (
            <Card key={`${r.filing_id}-${r.form_type}`} className="border-amber-200 dark:border-amber-900">
              <CardContent className="p-3 flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground">
                    {clientMap[r.client_id] || "—"}
                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                      {r.form_type} · {r.quarter} {r.financial_year}
                    </span>
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {r.default_reason || "No reason was recorded for this default."}
                  </p>
                </div>
                <Button
                  size="sm" className="gap-1.5 shrink-0"
                  onClick={() => onCreateCorrection({
                    clientId: r.client_id, fy: r.financial_year, quarter: r.quarter,
                    form: r.form_type, reason: r.default_reason || undefined,
                  })}
                >
                  <Plus size={14} /> Create Correction
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function CorrectionDashboard({
  clients, users, isSuperadmin, resolveFirmId, actor, toast, onOpen, externalPrefill, onExternalPrefillConsumed,
}: Props & {
  actor: Actor; toast: any; onOpen: (id: string) => void;
  // Set by the Recommendations tab's own "Create Correction" button — this
  // component owns the one NewCorrectionDialog instance regardless of which
  // tab triggered it (both tabs stay mounted, TdsFilings.tsx's own
  // established render-but-hide pattern), so a recommendation just hands its
  // client/period/reason down to open it pre-filled.
  externalPrefill?: CorrectionPrefill | null; onExternalPrefillConsumed?: () => void;
}) {
  const [rows, setRows] = useState<Correction[]>([]);
  const [loading, setLoading] = useState(true);
  const [newOpen, setNewOpen] = useState(false);
  const [prefill, setPrefill] = useState<CorrectionPrefill | null>(null);

  useEffect(() => {
    if (!externalPrefill) return;
    setPrefill(externalPrefill);
    setNewOpen(true);
    onExternalPrefillConsumed?.();
  }, [externalPrefill, onExternalPrefillConsumed]);

  const [search, setSearch] = useState("");
  const [fClient, setFClient] = useState("all");
  const [fFy, setFFy] = useState("all");
  const [fQuarter, setFQuarter] = useState("all");
  const [fStatus, setFStatus] = useState("all");
  const [fFrom, setFFrom] = useState("");
  const [fTo, setFTo] = useState("");

  const clientMap = useMemo(
    () => Object.fromEntries(clients.map(c => [c.id, c.name || "—"])),
    [clients],
  );
  const userMap = useMemo(
    () => Object.fromEntries(users.map(u => [u.id, u.name || "—"])),
    [users],
  );

  const fetchRows = useCallback(async () => {
    setLoading(true);
    const firmId = await resolveFirmId();
    let q = supabase.from("tds_corrections" as any).select("*");
    if (!isSuperadmin && firmId) q = q.eq("firm_id", firmId);
    const { data } = await q;
    setRows(((data || []) as unknown as Correction[]).slice()
      .sort((a, b) => (b.raised_at || "").localeCompare(a.raised_at || "")));
    setLoading(false);
  }, [isSuperadmin, resolveFirmId]);

  useEffect(() => { fetchRows(); }, [fetchRows]);

  // Live: a correction raised in the client portal appears here without a
  // refresh, and a signature here reaches the portal the same way.
  useEffect(() => {
    const ch = supabase
      .channel("tds-corrections-dashboard")
      .on("postgres_changes", { event: "*", schema: "public", table: "tds_corrections" }, () => fetchRows())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [fetchRows]);

  const filtered = useMemo(() => rows.filter(r => {
    if (fClient !== "all" && r.client_id !== fClient) return false;
    if (fFy !== "all" && r.financial_year !== fFy) return false;
    if (fQuarter !== "all" && r.quarter !== fQuarter) return false;
    if (fStatus !== "all" && r.status !== fStatus) return false;
    if (fFrom && (!r.raised_at || r.raised_at < fFrom)) return false;
    if (fTo && (!r.raised_at || r.raised_at > fTo + "T23:59:59")) return false;
    const q = search.trim().toLowerCase();
    if (q) {
      const hay = [
        clientMap[r.client_id], r.financial_year, r.quarter, r.form_type,
        r.reason, r.raised_by_name, r.prepared_by_name, r.approved_by_name, r.signed_by_name,
        CORRECTION_STATUS_META[r.status]?.label,
      ].filter(Boolean).join(" ").toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  }), [rows, fClient, fFy, fQuarter, fStatus, fFrom, fTo, search, clientMap]);

  const counts = useMemo(() => Object.fromEntries(
    ALL_STATUSES.map(s => [s, rows.filter(r => r.status === s).length]),
  ) as Record<CorrectionStatus, number>, [rows]);

  const filtersActive = fClient !== "all" || fFy !== "all" || fQuarter !== "all"
    || fStatus !== "all" || !!fFrom || !!fTo || !!search.trim();

  const clearFilters = () => {
    setFClient("all"); setFFy("all"); setFQuarter("all");
    setFStatus("all"); setFFrom(""); setFTo(""); setSearch("");
  };

  return (
    <div className="space-y-3">
      {/* Title row */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-xl font-bold text-foreground">Corrections</h2>
          <p className="text-sm text-muted-foreground">
            Revise TDS data already filed for an earlier period. The original filing is never changed —
            each correction is kept as a separate version.
          </p>
        </div>
        <Button size="sm" className="gap-1.5 shrink-0" onClick={() => { setPrefill(null); setNewOpen(true); }}>
          <Plus size={14} /> New Correction
        </Button>
      </div>

      {/* Status tiles — compact, and each is a one-click filter */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        {ALL_STATUSES.map(s => {
          const on = fStatus === s;
          return (
            <button
              key={s}
              onClick={() => setFStatus(on ? "all" : s)}
              aria-pressed={on}
              title={CORRECTION_STATUS_META[s].description}
              className={cn(
                "flex items-center justify-between rounded-lg border px-3 py-2 text-left transition-colors",
                on ? "border-primary bg-primary/5" : "hover:bg-muted/50",
              )}
            >
              <span className="text-xs text-muted-foreground">{CORRECTION_STATUS_META[s].short}</span>
              <span className="text-lg font-bold leading-none">
                {loading ? <Skeleton className="h-5 w-6" /> : counts[s]}
              </span>
            </button>
          );
        })}
      </div>

      {/* Toolbar */}
      <Card>
        <CardContent className="p-2.5 flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search client, reason, person…"
              className="h-8 pl-8 pr-7 text-xs"
            />
            {search && (
              <button
                onClick={() => setSearch("")} title="Clear"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X size={12} />
              </button>
            )}
          </div>

          <Select value={fClient} onValueChange={setFClient}>
            <SelectTrigger className="h-8 w-[170px] text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Clients</SelectItem>
              {clients.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={fFy} onValueChange={setFFy}>
            <SelectTrigger className="h-8 w-[120px] text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All FYs</SelectItem>
              {FY_OPTIONS.map(f => <SelectItem key={f} value={f}>{f}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={fQuarter} onValueChange={setFQuarter}>
            <SelectTrigger className="h-8 w-[100px] text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Qtrs</SelectItem>
              {QUARTERS.map(q => <SelectItem key={q} value={q}>{q}</SelectItem>)}
            </SelectContent>
          </Select>
          <Input type="date" title="Raised from" className="h-8 w-[135px] text-xs" value={fFrom} onChange={e => setFFrom(e.target.value)} />
          <Input type="date" title="Raised to" className="h-8 w-[135px] text-xs" value={fTo} onChange={e => setFTo(e.target.value)} />

          {filtersActive && (
            <Button variant="ghost" size="sm" className="h-8 gap-1 text-xs" onClick={clearFilters}>
              <X size={12} /> Clear
            </Button>
          )}
          <span className="text-[11px] text-muted-foreground ml-auto">
            {loading ? "" : `${filtered.length} of ${rows.length}`}
          </span>
        </CardContent>
      </Card>

      {/* List */}
      {loading ? (
        <div className="space-y-1.5">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-11 w-full" />)}</div>
      ) : filtered.length === 0 ? (
        <Card><CardContent className="p-10 text-center">
          <p className="text-sm text-muted-foreground">
            {rows.length === 0
              ? "No corrections raised yet."
              : "No corrections match these filters."}
          </p>
          {rows.length === 0 ? (
            <Button size="sm" className="mt-3 gap-1.5" onClick={() => setNewOpen(true)}>
              <Plus size={14} /> Raise the first correction
            </Button>
          ) : (
            <Button size="sm" variant="outline" className="mt-3" onClick={clearFilters}>Clear filters</Button>
          )}
        </CardContent></Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="text-xs">Client</TableHead>
                    <TableHead className="text-xs">Period</TableHead>
                    <TableHead className="text-xs">Reason</TableHead>
                    <TableHead className="text-xs">Status</TableHead>
                    <TableHead className="text-xs">Raised by</TableHead>
                    <TableHead className="text-xs">Raised</TableHead>
                    <TableHead className="text-xs">Signed by</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map(r => (
                    <TableRow
                      key={r.id}
                      onClick={() => onOpen(r.id)}
                      className="cursor-pointer h-10"
                      title="Open correction"
                    >
                      <TableCell className="text-xs font-medium py-1.5">{clientMap[r.client_id] || "—"}</TableCell>
                      <TableCell className="text-xs py-1.5 whitespace-nowrap">
                        <span className="font-medium">{r.form_type}</span>
                        <span className="text-muted-foreground"> · {r.quarter} {r.financial_year}</span>
                      </TableCell>
                      <TableCell className="text-xs py-1.5 max-w-[260px] truncate text-muted-foreground">
                        {r.reason || "—"}
                      </TableCell>
                      <TableCell className="py-1.5"><CorrectionStatusBadge status={r.status} processedOutcome={r.processed_outcome} /></TableCell>
                      <TableCell className="text-xs py-1.5 whitespace-nowrap">
                        {r.raised_by_name || (r.raised_by ? userMap[r.raised_by] : null) || "—"}
                        {r.raised_by_role === "client" && (
                          <Badge variant="outline" className="ml-1 text-[9px]">Client</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-xs py-1.5 whitespace-nowrap">{shortDate(r.raised_at)}</TableCell>
                      <TableCell className="text-xs py-1.5 whitespace-nowrap">
                        {/* Two-stage workflow signs via approved_by (senior); signed_by is the
                            legacy single-signature column, kept as a fallback for older rows. */}
                        {r.approved_by_name || (r.approved_by ? userMap[r.approved_by] : null)
                          || r.signed_by_name || "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      <NewCorrectionDialog
        open={newOpen} onOpenChange={(v) => { setNewOpen(v); if (!v) setPrefill(null); }}
        clients={clients} resolveFirmId={resolveFirmId} actor={actor} toast={toast} prefill={prefill}
        onCreated={(id) => { setNewOpen(false); setPrefill(null); fetchRows(); onOpen(id); }}
      />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// New correction
// ═══════════════════════════════════════════════════════════════════════════

function NewCorrectionDialog({
  open, onOpenChange, clients, resolveFirmId, actor, toast, onCreated, prefill,
}: {
  open: boolean; onOpenChange: (v: boolean) => void;
  clients: ClientOption[]; resolveFirmId: () => Promise<string | null>;
  actor: Actor; toast: any; onCreated: (id: string) => void;
  // From the Recommendations tab — client/period is already known (that's
  // what put it there), so the pickers lock instead of asking again; only
  // the reason stays editable (pre-seeded from the recommendation's own
  // captured default_reason, since that's very likely the real reason for
  // the correction too, but the user may want to phrase it differently).
  prefill?: CorrectionPrefill | null;
}) {
  const [client, setClient] = useState("");
  const [fy, setFy] = useState("");
  const [quarter, setQuarter] = useState("");
  const [form, setForm] = useState("");
  const [reason, setReason] = useState("");
  const [filing, setFiling] = useState<any | null>(null);
  const [openCorrection, setOpenCorrection] = useState<any | null>(null);
  const [preview, setPreview] = useState<{ challans: number; deductees: number } | null>(null);
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const locked = !!prefill;

  useEffect(() => {
    if (!open) {
      setClient(""); setFy(""); setQuarter(""); setForm("");
      setReason(""); setFiling(null); setOpenCorrection(null); setPreview(null);
      return;
    }
    if (prefill) {
      setClient(prefill.clientId); setFy(prefill.fy); setQuarter(prefill.quarter); setForm(prefill.form);
      setReason(prefill.reason || "");
    }
  }, [open, prefill]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!client || !fy || !quarter || !form) { setFiling(null); setOpenCorrection(null); setPreview(null); return; }
      setChecking(true);
      const [{ data: filings }, { data: openCorrections }] = await Promise.all([
        supabase.from("tds_filings")
          .select("id, client_id, financial_year, quarter, tds_forms, work_status")
          .eq("client_id", client).eq("financial_year", fy).eq("quarter", quarter),
        // Sequencing gate (firm instruction, 2026-08-04): a second correction
        // for the same period can't start while an earlier one is still open
        // (any status besides filed/rejected — rejected is dead and doesn't
        // block a fresh attempt). Same rule enforced in the DB by
        // trg_tds_corrections_sequencing_guard (20260804180500) — this is the
        // UI-side half, so the reason is explained before the user even hits
        // the trigger's generic error.
        supabase.from("tds_corrections" as any)
          .select("id, status, raised_by_name")
          .eq("client_id", client).eq("financial_year", fy).eq("quarter", quarter).eq("form_type", form)
          .not("status", "in", "(filed,rejected)"),
      ]);
      const match = ((filings || []) as any[]).find(f => (f.tds_forms || []).includes(form)) || null;
      if (cancelled) return;
      setFiling(match);
      setOpenCorrection(((openCorrections || []) as any[])[0] || null);
      if (match) {
        const [{ count: cc }, { count: dc }] = await Promise.all([
          supabase.from("tds_challans").select("id", { count: "exact", head: true })
            .eq("filing_id", match.id).eq("client_id", client),
          supabase.from("tds_deductees").select("id", { count: "exact", head: true })
            .eq("filing_id", match.id).eq("client_id", client),
        ]);
        if (!cancelled) setPreview({ challans: cc || 0, deductees: dc || 0 });
      } else {
        setPreview(null);
      }
      setChecking(false);
    };
    run();
    return () => { cancelled = true; };
  }, [client, fy, quarter, form]);

  const clientObj = clients.find(c => c.id === client);
  const compliant = !clientObj || !fy || !quarter || isFilingTdsCompliant(
    { client_id: client, financial_year: fy, quarter, tds_forms: [form] }, clientObj as any,
  );
  // Sequencing gate (firm instruction, 2026-08-04): the original return must
  // be "Processed" — the most-advanced work_status, not just "Filed" — and no
  // other correction may currently be open for this period.
  const notProcessed = !!filing && !isProcessedWorkStatus(filing.work_status);
  const canCreate = !!(client && fy && quarter && form && filing && compliant && !notProcessed && !openCorrection);

  const handleCreate = async () => {
    const firmId = await resolveFirmId();
    if (!firmId) { toast({ title: "No firm resolved", variant: "destructive" }); return; }
    setSaving(true);
    const { correction, error } = await createCorrection({
      firmId, clientId: client, financialYear: fy, quarter, formType: form,
      filingId: filing?.id ?? null, reason, actor,
    });
    setSaving(false);
    if (error || !correction) {
      toast({ title: "Could not create correction", description: error, variant: "destructive" });
      return;
    }
    toast({ title: "Correction created", description: "The filed data has been copied in — edit and submit it." });
    onCreated(correction.id);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>New Correction</DialogTitle>
          <DialogDescription>
            Choose the filed return to revise. Its challans and entries are copied into the
            correction — the filed originals are left untouched.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {locked && (
            <p className="text-[11px] text-muted-foreground -mb-1">
              From a recommendation — client and period are locked to the return that needs correcting.
            </p>
          )}
          <div className="space-y-1">
            <Label className="text-xs">Client</Label>
            <Select value={client} onValueChange={setClient} disabled={locked}>
              <SelectTrigger className="h-9"><SelectValue placeholder="Select client" /></SelectTrigger>
              <SelectContent>
                {clients.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">Financial Year</Label>
              <Select value={fy} onValueChange={setFy} disabled={locked}>
                <SelectTrigger className="h-9"><SelectValue placeholder="FY" /></SelectTrigger>
                <SelectContent>{FY_OPTIONS.map(f => <SelectItem key={f} value={f}>{f}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Quarter</Label>
              <Select value={quarter} onValueChange={setQuarter} disabled={locked}>
                <SelectTrigger className="h-9"><SelectValue placeholder="Q" /></SelectTrigger>
                <SelectContent>{QUARTERS.map(q => <SelectItem key={q} value={q}>{q}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Form</Label>
              <Select value={form} onValueChange={setForm} disabled={locked}>
                <SelectTrigger className="h-9"><SelectValue placeholder="Form" /></SelectTrigger>
                <SelectContent>{FORMS.map(f => <SelectItem key={f} value={f}>{f}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Reason for correction</Label>
            <Textarea
              value={reason} onChange={e => setReason(e.target.value)}
              placeholder="e.g. Wrong PAN reported for one deductee"
              className="text-xs min-h-[60px]"
            />
          </div>

          {checking && <p className="text-xs text-muted-foreground">Looking up the filed return…</p>}

          {!checking && client && fy && quarter && form && !filing && (
            <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-2.5 text-xs text-red-700">
              <AlertTriangle size={14} className="shrink-0 mt-0.5" />
              <span>
                No filed return found for {form} · {quarter} {fy} for this client. A correction can only
                revise data that has already been filed.
              </span>
            </div>
          )}

          {!compliant && (
            <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-2.5 text-xs text-red-700">
              <AlertTriangle size={14} className="shrink-0 mt-0.5" />
              <span>This period is outside the client's TDS Compliance range.</span>
            </div>
          )}

          {!checking && filing && notProcessed && (
            <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-2.5 text-xs text-red-700">
              <AlertTriangle size={14} className="shrink-0 mt-0.5" />
              <span>
                This return is currently "{filing.work_status}". A correction can only be started
                once it is marked Processed with Default or Processed without Default.
              </span>
            </div>
          )}

          {!checking && openCorrection && (
            <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-2.5 text-xs text-red-700">
              <AlertTriangle size={14} className="shrink-0 mt-0.5" />
              <span>
                A correction for this period is already {CORRECTION_STATUS_META[openCorrection.status as CorrectionStatus]?.label ?? openCorrection.status}
                {openCorrection.raised_by_name ? ` (raised by ${openCorrection.raised_by_name})` : ""}. Resolve it — file
                or reject it — before starting another.
              </span>
            </div>
          )}

          {preview && (
            <div className="rounded-md border bg-muted/40 p-2.5 text-xs">
              Will copy in <strong>{preview.challans}</strong> challan{preview.challans === 1 ? "" : "s"} and{" "}
              <strong>{preview.deductees}</strong> entr{preview.deductees === 1 ? "y" : "ies"}.
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button size="sm" disabled={!canCreate || saving} onClick={handleCreate}>
            {saving ? "Creating…" : "Create Correction"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Correction detail
// ═══════════════════════════════════════════════════════════════════════════

function CorrectionDetail({
  correctionId, clients, actor, onBack, toast,
}: {
  correctionId: string; clients: ClientOption[]; actor: Actor;
  onBack: () => void; toast: any;
}) {
  const [correction, setCorrection] = useState<Correction | null>(null);
  const [challans, setChallans] = useState<CorrectionChallan[]>([]);
  const [deductees, setDeductees] = useState<CorrectionDeductee[]>([]);
  const [rateMaster, setRateMaster] = useState<RateEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [signOpen, setSignOpen] = useState(false);
  const [approveOpen, setApproveOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [discarding, setDiscarding] = useState(false);

  const [search, setSearch] = useState("");
  const [changeFilter, setChangeFilter] = useState<ChangeFilter>("all");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  // `silent` refreshes the data WITHOUT flipping `loading`. The loading branch
  // returns a skeleton, which unmounts the entire detail — including the Data
  // Entry grid — so calling this after every field edit rebuilt the screen and
  // threw the user out of the row they were typing in. A silent refresh just
  // updates state in place and lets React reconcile.
  const load = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true);
    const { data } = await supabase.from("tds_corrections" as any)
      .select("*").eq("id", correctionId).maybeSingle();
    const head = (data as unknown as Correction) || null;
    setCorrection(head);
    if (head) {
      const detail = await loadCorrectionDetail(correctionId);
      setChallans(detail.challans);
      setDeductees(detail.deductees);
      // Same Rate Master scoping as Data Entry (form_type + financial_year +
      // is_active) — see rateEngine.ts / TdsDataEntry.tsx's fetchRates for why
      // financial_year must be included, not just form_type.
      const { data: rates } = await supabase.from("tds_rate_master")
        .select("section_code, nature_of_payment, rate_individual, rate_company, rate_no_pan, threshold_individual, threshold_company, effective_from, effective_to")
        .eq("form_type", head.form_type).eq("financial_year", head.financial_year).eq("is_active", true);
      setRateMaster((rates || []) as RateEntry[]);
    }
    setLoading(false);
  }, [correctionId]);

  useEffect(() => { load(); }, [load]);

  // Stable identity, so passing it to the grid never re-triggers the grid's
  // own effects. Used after every edit — see the comment on `load`.
  const loadSilently = useCallback(() => { void load({ silent: true }); }, [load]);

  // Undo one change back to the filed state. Silent refresh afterwards for the
  // same reason every other edit uses one: never rebuild the screen under the
  // user.
  // The grid performs the undo (it owns the rows); this only records it.
  const handleRowUndone = useCallback(async (row: any) => {
    if (!correction) return;
    await logCorrectionAction({
      correctionId: correction.id, firmId: correction.firm_id, clientId: correction.client_id,
      actionType: "CHANGE_UNDONE",
      detail: `Reverted ${row?.deductee_name || row?.challan_serial_no || "row"} to its filed values`,
      oldValue: row?.action ?? null, newValue: "unchanged", actor,
    });
    // No toast or refresh here — the grid already showed both. This hook exists
    // only so the undo reaches the correction audit log.
  }, [correction, actor]);

  const locked = isCorrectionLocked(correction?.status);
  // Entries freeze at the FIRST signature, not at filing — what the senior
  // reviews must be exactly what the preparer signed. The DB enforces this
  // too; `editable` only keeps the UI from offering a rejected action.
  const editable = isCorrectionEditable(correction?.status);
  const isSamePerson = !!correction?.prepared_by && correction.prepared_by === actor.id;
  // No role gate — the second signature is open to every user by request.
  // The only remaining rule is maker-checker: the approver cannot be the
  // preparer, which the database enforces too.
  const canApprove = !isSamePerson;

  // The correction presented to the Data Entry engine as if it were a filing.
  // 20260729190000 made the correction tables column-identical to the live
  // ones and mirrors filing_id onto correction_id, so the engine's queries
  // work unchanged against this id.
  // Memoised on PRIMITIVES, not on `correction` — a silent refresh replaces the
  // correction object on every edit, and depending on the object would hand the
  // grid a brand-new filingOverride each time, churning it for no reason.
  const correctionAsFiling = useMemo(() => correction ? ({
    id: correction.id,
    client_id: correction.client_id,
    firm_id: correction.firm_id,
    financial_year: correction.financial_year,
    quarter: correction.quarter,
    tds_forms: [correction.form_type],
    work_status: correction.status === "filed" ? "Filed" : "Under Process",
    tan: null,
  }) as any : null, [
    correction?.id, correction?.client_id, correction?.firm_id,
    correction?.financial_year, correction?.quarter, correction?.form_type,
    correction?.status,
  ]);
  const clientName = clients.find(c => c.id === correction?.client_id)?.name || "—";
  const delta = useMemo(() => summariseCorrection(challans, deductees), [challans, deductees]);
  const hasChanges = delta.added + delta.modified + delta.deleted + delta.challansTouched > 0;

  // ── Per-challan financial breakdown (Total / Utilised / Unutilised /
  // Balance / Status) — the SAME engine Data Entry uses (rateEngine.ts),
  // scoped to this correction's own rows only (a correction is a single,
  // self-contained snapshot — no cross-quarter carry-forward concept
  // applies). A deleted entry no longer counts as "utilised".
  const challanBreakdown = useMemo(() => {
    const m = new Map<string, ReturnType<typeof computeApplied> & { allocatable: number; status: string; colorClass: string }>();
    for (const c of challans) {
      const rows = deductees.filter(d => d.correction_challan_id === c.id && d.action !== "delete");
      const bd = computeApplied(rows);
      const allocatable = computeAllocatable(c.total_challan_amount || 0, c.late_fees_234e || 0);
      m.set(c.id, { ...bd, allocatable, status: challanStatus(bd.applied, allocatable), colorClass: balanceColorClass(bd.applied, allocatable) });
    }
    return m;
  }, [challans, deductees]);

  // ── Search + change filter ────────────────────────────────────────────────
  const visibleDeductees = useMemo(() => {
    const q = search.trim().toLowerCase();
    return deductees.filter(d => {
      if (changeFilter === "changed" && d.action === "unchanged") return false;
      if (changeFilter !== "all" && changeFilter !== "changed" && d.action !== changeFilter) return false;
      if (!q) return true;
      return [d.deductee_name, d.deductee_pan, d.section_code, d.remarks]
        .filter(Boolean).join(" ").toLowerCase().includes(q);
    });
  }, [deductees, search, changeFilter]);

  const byChallan = useMemo(() => {
    const m = new Map<string, CorrectionDeductee[]>();
    for (const d of visibleDeductees) {
      const k = d.correction_challan_id || "__unlinked__";
      const l = m.get(k); if (l) l.push(d); else m.set(k, [d]);
    }
    return m;
  }, [visibleDeductees]);

  const filtering = !!search.trim() || changeFilter !== "all";
  // While filtering, hide challans with no matching rows — the user is hunting.
  const shownChallans = useMemo(
    () => filtering ? challans.filter(c => (byChallan.get(c.id) || []).length > 0) : challans,
    [challans, byChallan, filtering],
  );

  const toggleChallan = (id: string) =>
    setCollapsed(prev => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });

  // ── Row actions ───────────────────────────────────────────────────────────
  const markDeleted = async (d: CorrectionDeductee) => {
    if (!editable || !correction) return;
    setBusy(true);
    if (d.action === "add") {
      await supabase.from("tds_correction_deductees" as any).delete().eq("id", d.id);
    } else {
      await supabase.from("tds_correction_deductees" as any)
        .update({ action: "delete", updated_at: new Date().toISOString() }).eq("id", d.id);
    }
    await logCorrectionAction({
      correctionId: correction.id, firmId: correction.firm_id, clientId: correction.client_id,
      actionType: "ENTRY_DELETED", detail: d.deductee_name || "—", actor,
    });
    setBusy(false);
    load();
  };

  const restoreRow = async (d: CorrectionDeductee) => {
    if (!editable || !correction) return;
    setBusy(true);
    await supabase.from("tds_correction_deductees" as any)
      .update({ action: "unchanged", updated_at: new Date().toISOString() }).eq("id", d.id);
    await logCorrectionAction({
      correctionId: correction.id, firmId: correction.firm_id, clientId: correction.client_id,
      actionType: "ENTRY_RESTORED", detail: d.deductee_name || "—", actor,
    });
    setBusy(false);
    load();
  };

  const doSubmit = async () => {
    if (!correction) return;
    setBusy(true);
    const err = await submitCorrection(correction, actor);
    setBusy(false);
    if (err) { toast({ title: "Could not submit", description: err, variant: "destructive" }); return; }
    toast({ title: "Correction submitted", description: "It is now pending a firm signature." });
    load();
  };

  const doDiscard = async () => {
    if (!correction) return;
    setDiscarding(true);
    const err = await discardCorrection(correction);
    setDiscarding(false);
    if (err) { toast({ title: "Could not discard", description: err, variant: "destructive" }); return; }
    setDiscardOpen(false);
    toast({ title: "Draft discarded" });
    onBack();
  };

  if (loading) {
    return <div className="space-y-3"><Skeleton className="h-9 w-40" /><Skeleton className="h-16 w-full" /><Skeleton className="h-64 w-full" /></div>;
  }

  if (!correction) {
    return (
      <div className="space-y-3">
        <Button variant="ghost" size="sm" className="gap-1.5" onClick={onBack}><ArrowLeft size={14} /> Back</Button>
        <Card><CardContent className="p-10 text-center text-sm text-muted-foreground">
          This correction could not be loaded.
        </CardContent></Card>
      </div>
    );
  }

  const totalTds = deductees
    .filter(d => d.action !== "delete")
    .reduce((s, d) => s + (d.total_tax_deducted ?? d.tds_amount ?? 0), 0);

  return (
    <div className="space-y-3">
      {/* ── Top block: identity/status/summary (left) + Signature & Filing
          (right), side by side. Signature & Filing sits here — above Changes
          vs the filed return, aligned with the header — rather than after
          the whole Data Entry grid, so it is visible without scrolling. Below
          this block, everything else runs full width as before. */}
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px] gap-3 items-start">
        <div className="space-y-2 min-w-0 order-2 lg:order-1">
          {/* ── Header: back + identity + status, all one row ── */}
          <div className="flex items-center gap-2 flex-wrap">
            <Button variant="ghost" size="sm" className="gap-1.5 -ml-2 h-8" onClick={onBack}>
              <ArrowLeft size={14} /> All corrections
            </Button>
            <h2 className="text-lg font-bold text-foreground">{clientName}</h2>
            <span className="text-sm text-muted-foreground">
              {correction.form_type} · {correction.quarter} {correction.financial_year}
            </span>
            <CorrectionStatusBadge status={correction.status} processedOutcome={correction.processed_outcome} />

            {/* No workflow buttons here. Each stage's action lives inside its own
                box in the Signature & Filing column so an action sits with the
                thing it acts on, and nothing is duplicated between the header
                and the cards. */}
          </div>

          {/* Stage tracker — where the correction is, and what is next */}
          <WorkflowTracker correction={correction} />

          {correction.reason && (
            <p className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground">Reason:</span> {correction.reason}
            </p>
          )}

          {/* ── Change summary strip (Data Entry's info-strip language) ── */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs px-0.5">
            <span className="text-muted-foreground">Challans: <strong className="text-foreground">{challans.length}</strong></span>
            <span className="text-border">|</span>
            <span className="text-muted-foreground">Entries: <strong className="text-foreground">{deductees.filter(d => d.action !== "delete").length}</strong></span>
            <span className="text-border">|</span>
            <span className="text-muted-foreground">TDS: <strong className="text-foreground">₹{money(totalTds)}</strong></span>
            <span className="text-border">|</span>
            {hasChanges ? (
              <>
                {delta.added > 0 && <Badge className={cn("text-[9px]", ACTION_META.add.badge)}>{delta.added} added</Badge>}
                {delta.modified > 0 && <Badge className={cn("text-[9px]", ACTION_META.modify.badge)}>{delta.modified} modified</Badge>}
                {delta.deleted > 0 && <Badge className={cn("text-[9px]", ACTION_META.delete.badge)}>{delta.deleted} deleted</Badge>}
                {delta.challansTouched > 0 && <Badge variant="outline" className="text-[9px]">{delta.challansTouched} challan{delta.challansTouched === 1 ? "" : "s"} changed</Badge>}
              </>
            ) : (
              <span className="text-muted-foreground italic">No changes yet — edit an entry to start.</span>
            )}
          </div>

          {/* ── Filed / rejected banners ── */}
          {locked && (
            <div className="rounded-lg border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/20 px-3 py-2 flex items-start gap-2.5">
              <ShieldCheck size={16} className="text-emerald-600 shrink-0 mt-0.5" />
              <div className="min-w-0 text-xs">
                <p className="font-semibold text-emerald-800 dark:text-emerald-300 flex items-center gap-1.5">
                  Correction Filed <Lock size={11} />
                </p>
                <p className="text-emerald-700 dark:text-emerald-400">
                  {/* Two-stage workflow signs via approved_by (senior); signed_by/_role/_at
                      are the legacy single-signature columns, kept as a fallback. */}
                  Signed by {correction.approved_by_name || correction.signed_by_name || "—"}
                  {(correction.approved_by_role || correction.signed_by_role)
                    ? ` (${correction.approved_by_role || correction.signed_by_role})` : ""}
                  {(correction.approved_at || correction.signed_at)
                    ? ` on ${format(new Date(correction.approved_at || correction.signed_at || ""), "dd/MM/yyyy HH:mm")}`
                    : ""}. Read-only.
                </p>
              </div>
            </div>
          )}

          {correction.status === "rejected" && correction.rejection_reason && (
            <div className="rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/20 px-3 py-2 text-xs">
              <p className="font-semibold text-red-800 dark:text-red-300">Rejected</p>
              <p className="text-red-700 dark:text-red-400">{correction.rejection_reason}</p>
            </div>
          )}

          {/* Every change vs the filed return, with Original -> Corrected values.
              Kept in this column (not full width) so its height fills the space
              beside Signature & Filing instead of leaving it blank. */}
          <ChangesPanel challans={challans} deductees={deductees} />
        </div>

        {/* Signature + Filing — top-right, sticky so it stays reachable while
            scrolling the Data Entry grid below. */}
        <div className="order-1 lg:order-2 lg:sticky lg:top-3">
          <SignatureSection
            correction={correction}
            actor={actor}
            busy={busy}
            canApprove={canApprove}
            isSamePerson={isSamePerson}
            onSubmitForSignature={doSubmit}
            onSignPreparer={() => setSignOpen(true)}
            onApproveSenior={() => setApproveOpen(true)}
            onReject={() => setRejectOpen(true)}
            onDiscard={() => setDiscardOpen(true)}
            onRefresh={loadSilently}
            toast={toast}
          />
        </div>
      </div>

      {/* ── The Data Entry module itself ──────────────────────────────────
          Not a look-alike: this IS TdsDataEntry, pointed at the correction's
          tables. Challan cards, utilised/unutilised balances, validations,
          calculations, dropdowns, Genius import/export — all identical,
          because it is the same component. Users edit as if it were the
          original return; every write lands in the correction version, and
          the DB tracks add/modify/delete on the way in. */}
      <TdsDataEntry
        clients={clients as any}
        users={[]}
        isSuperadmin={false}
        resolveFirmId={async () => correction.firm_id}
        selClient={correction.client_id} setSelClient={() => {}}
        selFy={correction.financial_year} setSelFy={() => {}}
        selQuarter={correction.quarter} setSelQuarter={() => {}}
        selForm={correction.form_type} setSelForm={() => {}}
        source={CORRECTION_TDS_SOURCE}
        filingOverride={correctionAsFiling}
        forceReadOnly={!editable}
        lockBadgeLabel={locked ? "Filed" : "Locked"}
        lockNotice={
          locked
            ? "This correction has been filed. All data is read-only."
            : correction.status === "awaiting_senior"
              ? "Signed by the preparer and awaiting senior approval. Entries are locked so what is approved is exactly what was signed."
              : correction.status === "ready_to_file"
                ? "Both signatures are complete. Entries are locked — record the filing in the Filing box above."
                : correction.status === "rejected"
                  ? "This correction was rejected. Re-submit it from the Employee signature box to edit again."
                  : undefined
        }
        // action / original_values are written by DB triggers, so the change
        // summary and the Original-vs-Corrected panel above this grid only
        // reflect an edit if we re-read after it.
        onCorrectionChanged={loadSilently}
        onCorrectionRowUndone={handleRowUndone}
      />

      {/* Dialogs */}
      {/* Signature 1 — the preparer */}
      <SignatureDialog
        open={signOpen} onOpenChange={setSignOpen}
        correction={correction} actor={actor} delta={delta}
        title="Employee signature"
        icon={<PenTool size={16} />}
        attestation="I prepared this correction and confirm the corrected particulars are true and correct."
        confirmLabel="Sign as preparer"
        run={signAsPreparer}
        onDone={() => { setSignOpen(false); load(); }}
        toast={toast}
      />

      {/* Signature 2 — the senior reviewer */}
      <SignatureDialog
        open={approveOpen} onOpenChange={setApproveOpen}
        correction={correction} actor={actor} delta={delta}
        title="Senior approval"
        icon={<ShieldCheck size={16} />}
        attestation="I have reviewed this correction and authorise it for filing. This does not file it — filing is confirmed separately."
        confirmLabel="Approve as senior"
        run={approveAsSenior}
        onDone={() => { setApproveOpen(false); load(); }}
        toast={toast}
      />

      <RejectDialog
        open={rejectOpen} onOpenChange={setRejectOpen}
        correction={correction} actor={actor}
        onRejected={() => { setRejectOpen(false); load(); }}
        toast={toast}
      />

      {/* Discard — only reachable while status === "draft" (never submitted,
          so there's nothing an audit trail needs to remember). */}
      <Dialog open={discardOpen} onOpenChange={setDiscardOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Discard this draft?</DialogTitle>
            <DialogDescription>
              This correction has never been submitted for signature. Discarding it deletes
              it permanently, including any edits made so far — this can't be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button size="sm" variant="outline" onClick={() => setDiscardOpen(false)} disabled={discarding}>Cancel</Button>
            <Button size="sm" variant="destructive" disabled={discarding} onClick={doDiscard}>
              {discarding ? "Discarding…" : "Discard draft"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Entry table — dense; the whole row is the edit affordance
// ═══════════════════════════════════════════════════════════════════════════


// ═══════════════════════════════════════════════════════════════════════════
// Entry add / edit
// ═══════════════════════════════════════════════════════════════════════════


// ═══════════════════════════════════════════════════════════════════════════
// Challan edit
// ═══════════════════════════════════════════════════════════════════════════


// ═══════════════════════════════════════════════════════════════════════════
// Signature
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Every change in this correction, versus the originally filed return —
 * so nobody has to diff two returns by eye.
 *
 * ONE ROW PER CHANGE. A modified entry that touched three fields is three
 * rows, not a stacked block: the columns line up, so a whole correction can be
 * scanned down a single Original / Corrected pair instead of read block by
 * block. Additions and deletions come from `action`; the field-level values
 * come from the snapshot the database takes the instant before the first edit
 * (20260729200000), so they are exactly what was filed.
 */
function ChangesPanel({ challans, deductees }: {
  challans: CorrectionChallan[]; deductees: CorrectionDeductee[];
}) {
  const rows = useMemo(() => {
    const out: {
      kind: "Challan" | "Entry"; action: CorrectionAction;
      title: string; field: string; original: unknown; corrected: unknown;
      /** first row of a group carries the badge + name; the rest indent under it */
      lead: boolean;
    }[] = [];

    const push = (kind: "Challan" | "Entry", action: CorrectionAction, title: string, diffs: FieldDiff[]) => {
      if (action === "modify" && diffs.length > 0) {
        diffs.forEach((d, i) => out.push({
          kind, action, title, field: d.label,
          original: d.original, corrected: d.corrected, lead: i === 0,
        }));
      } else {
        // Added / deleted / modified-without-snapshot: the row IS the change.
        out.push({ kind, action, title, field: "—", original: null, corrected: null, lead: true });
      }
    };

    // Modified first — those are the ones that need a value comparison, and
    // burying them under alphabetically-earlier additions/deletions is exactly
    // the manual hunting this panel exists to remove. Challans lead their
    // entries, and each group's own rows stay in order.
    const rank = { modify: 0, add: 1, delete: 2, unchanged: 3 } as const;
    const changedChallans = challans
      .map(c => ({ ...c, action: effectiveCorrectionAction(c) }))
      .filter(c => c.action !== "unchanged")
      .sort((a, b) => rank[a.action] - rank[b.action]);
    const changedEntries = deductees
      .map(d => ({ ...d, action: effectiveCorrectionAction(d) }))
      .filter(d => d.action !== "unchanged")
      .sort((a, b) => rank[a.action] - rank[b.action]);

    for (const c of changedChallans) {
      push("Challan", c.action, `Challan ${c.challan_serial_no || "—"}`, diffCorrectionRow(c));
    }
    for (const d of changedEntries) {
      push("Entry", d.action, d.deductee_name || "—", diffCorrectionRow(d));
    }
    return out;
  }, [challans, deductees]);

  const changeCount = useMemo(
    () => new Set(rows.map(r => `${r.kind}|${r.title}|${r.action}`)).size,
    [rows],
  );

  const [expanded, setExpanded] = useState(true);

  if (rows.length === 0) {
    return (
      <Card>
        <CardContent className="p-3 text-xs text-muted-foreground">
          No changes yet — this correction is currently identical to the filed return.
        </CardContent>
      </Card>
    );
  }

  const fmt = (v: unknown) =>
    v === null || v === undefined || v === "" ? "—" : String(v);

  return (
    <Card>
      <CardContent className="p-0">
        <button
          type="button"
          onClick={() => setExpanded(v => !v)}
          aria-expanded={expanded}
          className="w-full px-3 py-2 border-b flex items-center gap-2 text-left hover:bg-muted/40"
        >
          {expanded ? <ChevronDown size={13} className="text-muted-foreground" /> : <ChevronRight size={13} className="text-muted-foreground" />}
          <GitCompare size={13} className="text-muted-foreground" />
          <span className="text-sm font-semibold">Changes vs the filed return</span>
          <span className="text-[11px] text-muted-foreground">
            {changeCount} change{changeCount === 1 ? "" : "s"}
            {rows.length !== changeCount && ` · ${rows.length} fields`}
          </span>
        </button>

        {expanded && (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="text-xs w-[92px]">Change</TableHead>
                  <TableHead className="text-xs w-[70px]">Type</TableHead>
                  <TableHead className="text-xs">Name</TableHead>
                  <TableHead className="text-xs">Field</TableHead>
                  <TableHead className="text-xs">Original</TableHead>
                  <TableHead className="text-xs">Corrected</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r, i) => (
                  <TableRow
                    key={i}
                    className={cn("h-9 border-l-[3px]", ACTION_META[r.action].rail)}
                  >
                    <TableCell className="py-1">
                      {/* Only the first row of a multi-field change repeats the
                          badge and name — the rest read as continuations. */}
                      {r.lead && (
                        <Badge className={cn("text-[9px]", ACTION_META[r.action].badge)}>
                          {ACTION_META[r.action].label}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="py-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                      {r.lead ? r.kind : ""}
                    </TableCell>
                    <TableCell className={cn(
                      "py-1 text-xs font-medium",
                      r.action === "delete" && "line-through",
                      !r.lead && "text-muted-foreground/50",
                    )}>
                      {r.lead ? r.title : "↳"}
                    </TableCell>
                    <TableCell className="py-1 text-xs text-muted-foreground whitespace-nowrap">
                      {r.field}
                    </TableCell>
                    <TableCell className="py-1 text-xs">
                      {r.action === "modify"
                        ? <span className="line-through text-red-600 dark:text-red-400">{fmt(r.original)}</span>
                        : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="py-1 text-xs">
                      {r.action === "modify"
                        ? <span className="font-medium text-emerald-700 dark:text-emerald-400">{fmt(r.corrected)}</span>
                        : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** Horizontal stage tracker: where the correction is and what happens next. */
function WorkflowTracker({ correction }: { correction: Correction }) {
  const order: CorrectionStatus[] = [
    "draft", "awaiting_employee", "awaiting_senior", "ready_to_file", "filed",
  ];
  if (correction.status === "rejected") return null;
  const at = order.indexOf(correction.status as CorrectionStatus);

  return (
    <div className="flex items-center gap-1 flex-wrap text-[11px]">
      {order.map((s, i) => {
        const done = i < at;
        const current = i === at;
        return (
          <div key={s} className="flex items-center gap-1">
            <span
              className={cn(
                "px-2 py-0.5 rounded-full border",
                done && "bg-emerald-50 border-emerald-200 text-emerald-700",
                current && "bg-primary text-primary-foreground border-primary font-medium",
                !done && !current && "border-dashed text-muted-foreground",
              )}
            >
              {done && <CheckCircle2 size={10} className="inline mr-1 -mt-0.5" />}
              {CORRECTION_STATUS_META[s].short}
            </span>
            {i < order.length - 1 && <span className="text-muted-foreground/40">›</span>}
          </div>
        );
      })}
    </div>
  );
}

/** One signature slot — signed shows the name/role/time, else what is awaited. */
function SignatureSlot({ title, name, role, at, awaiting, note, action }: {
  title: string; name: string | null; role: string | null; at: string | null;
  awaiting: string; note?: string;
  /** The stage's own action, rendered inside this box rather than in a toolbar. */
  action?: React.ReactNode;
}) {
  const signed = !!at;
  return (
    <div className={cn(
      "rounded-md border px-2 py-1.5 flex-1 min-w-[150px]",
      signed && "border-emerald-200 dark:border-emerald-900 bg-emerald-50/40 dark:bg-emerald-950/10",
    )}>
      <div className="flex items-center gap-1 min-w-0">
        <PenTool size={10} className={cn("shrink-0", signed ? "text-emerald-600" : "text-muted-foreground")} />
        <span className="text-[10px] font-semibold text-muted-foreground truncate">{title}</span>
        {signed && <CheckCircle2 size={10} className="text-emerald-600 shrink-0" />}
      </div>

      {signed ? (
        <p className="text-xs leading-tight truncate" title={`${name || "—"} · ${role || "Authorised signatory"}`}>
          <span className="font-semibold">{name || "—"}</span>
          <span className="text-muted-foreground"> · {at ? format(new Date(at), "dd/MM/yy HH:mm") : role || "—"}</span>
        </p>
      ) : (
        <p className="text-[10px] text-muted-foreground italic leading-tight">
          {awaiting}
          {/* The rule only matters while the slot is still open. Repeating it
              under a completed signature reads as a warning about it. */}
          {note && ` ${note}`}
        </p>
      )}

      {action && <div className="mt-1 flex flex-wrap gap-1">{action}</div>}
    </div>
  );
}

/**
 * The workflow, laid out as the three things it actually is: the employee
 * signature, the senior approval, and the filing.
 *
 * Each box carries its OWN action — submit / sign / approve / reject / choose
 * a submission mode / upload the proof / mark filed. Nothing is duplicated in
 * a header toolbar, so an action always sits with the thing it acts on.
 *
 * Approval and filing stay visually separate on purpose: signing authorises
 * the correction, filing is the later manual confirmation that the department
 * accepted it.
 */
export function SignatureSection({
  correction, actor, busy, canApprove, isSamePerson,
  onSubmitForSignature, onSignPreparer, onApproveSenior, onReject, onDiscard, onRefresh, toast,
}: {
  correction: Correction;
  actor: Actor;
  busy?: boolean;
  canApprove?: boolean;
  isSamePerson?: boolean;
  onSubmitForSignature?: () => void;
  onSignPreparer?: () => void;
  onApproveSenior?: () => void;
  onReject?: () => void;
  onDiscard?: () => void;
  onRefresh?: () => void;
  toast?: any;
}) {
  const filed = correction.status === "filed";
  const status = correction.status;

  return (
    <Card>
      <CardContent className="p-2 space-y-1.5">
        <div className="flex flex-wrap gap-1.5">
          <SignatureSlot
            title="1 · Employee signature"
            name={correction.prepared_by_name}
            role={correction.prepared_by_role}
            at={correction.prepared_at}
            awaiting={
              status === "draft"
                ? "Submit the correction to request the preparer's signature."
                : "Awaiting the preparer's signature."
            }
            action={
              status === "draft" ? (
                <>
                  <Button size="sm" className="gap-1 h-6 text-[11px] px-2" disabled={busy} onClick={onSubmitForSignature}>
                    <Send size={11} /> Submit for signature
                  </Button>
                  <Button size="sm" variant="outline" className="gap-1 h-6 text-[11px] px-2" disabled={busy} onClick={onDiscard}>
                    <Trash2 size={11} /> Discard
                  </Button>
                </>
              ) : status === "awaiting_employee" ? (
                <Button size="sm" className="gap-1 h-6 text-[11px] px-2" onClick={onSignPreparer}>
                  <PenTool size={11} /> Sign as preparer
                </Button>
              ) : status === "rejected" ? (
                <Button size="sm" className="gap-1 h-6 text-[11px] px-2" disabled={busy} onClick={onSubmitForSignature}>
                  <Send size={11} /> Re-submit
                </Button>
              ) : undefined
            }
          />

          <SignatureSlot
            title="2 · Senior approval"
            name={correction.approved_by_name || correction.signed_by_name}
            role={correction.approved_by_role || correction.signed_by_role}
            at={correction.approved_at || correction.signed_at}
            awaiting="Awaiting a senior reviewer's approval."
            note="Must be a different person from the preparer."
            action={
              status === "awaiting_senior" ? (
                <>
                  <Button size="sm" variant="outline" className="gap-1 h-6 text-[11px] px-2" onClick={onReject}>
                    <XCircle size={11} /> Reject
                  </Button>
                  <Button
                    size="sm" className="gap-1 h-6 text-[11px] px-2"
                    disabled={!canApprove}
                    title={isSamePerson
                      ? "The senior approval must come from someone other than the preparer"
                      : undefined}
                    onClick={onApproveSenior}
                  >
                    <ShieldCheck size={11} /> Approve as senior
                  </Button>
                </>
              ) : undefined
            }
          />
        </div>

        {/* Filing — the whole flow lives here: mode, proof, then Mark as Filed */}
        <FilingBox
          correction={correction} actor={actor}
          onRefresh={onRefresh} toast={toast}
        />
      </CardContent>
    </Card>
  );
}

/**
 * Filing, inline.
 *
 *   1. choose how it was submitted — offline (ACK) or online (screenshot)
 *   2. upload that proof
 *   3. Mark as Filed, which only becomes available once 1 and 2 are done
 *
 * The same requirement is enforced by a DB trigger (20260729220000), so the
 * disabled button is a courtesy rather than the control.
 */
function FilingBox({ correction, actor, onRefresh, toast }: {
  correction: Correction; actor: Actor; onRefresh?: () => void; toast?: any;
}) {
  const filed = correction.status === "filed";
  const ready = correction.status === "ready_to_file";

  const [mode, setMode] = useState<SubmissionMode | null>(correction.submission_mode ?? null);
  const [reference, setReference] = useState(correction.filing_reference || "");
  const [filedOn, setFiledOn] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [settingOutcome, setSettingOutcome] = useState(false);
  const [outcomePrompt, setOutcomePrompt] = useState(false);
  const [outcomeReasonText, setOutcomeReasonText] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setMode(correction.submission_mode ?? null); }, [correction.submission_mode]);

  const proofName = correction.proof_file_url
    ? (correction.proof_file_name || "Attached file")
    : null;
  const meta = mode ? SUBMISSION_MODE_META[mode] : null;

  const pickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !mode) return;
    setUploading(true);
    const { error } = await uploadCorrectionProof(correction, mode, file, actor);
    setUploading(false);
    if (error) { toast?.({ title: "Upload failed", description: error, variant: "destructive" }); return; }
    toast?.({ title: `${SUBMISSION_MODE_META[mode].proofLabel} attached` });
    onRefresh?.();
  };

  const removeProof = async () => {
    if (!window.confirm(`Remove ${proofName}? You'll need to re-attach it before this correction can be filed.`)) return;
    setRemoving(true);
    const { error } = await removeCorrectionProof(correction, actor);
    setRemoving(false);
    if (error) { toast?.({ title: "Could not remove file", description: error, variant: "destructive" }); return; }
    toast?.({ title: "Attachment removed" });
    onRefresh?.();
  };

  const markFiled = async () => {
    setSaving(true);
    const err = await markCorrectionFiled(correction, actor, {
      reference: reference.trim() || undefined,
      filedOn: filedOn ? new Date(filedOn).toISOString() : undefined,
    });
    setSaving(false);
    if (err) { toast?.({ title: "Could not mark as filed", description: err, variant: "destructive" }); return; }
    toast?.({ title: "Correction filed", description: "It is now locked and read-only." });
    onRefresh?.();
  };

  // Recorded LATER, once the department's CPC/TRACES response is known —
  // the one field on a filed correction that stays writable (20260805150000's
  // own carve-out in tds_correction_block_when_filed). Same two values as the
  // original return's own work_status (TdsFilingsManager.tsx), so reporting
  // reads consistently whether a period was ever corrected or not.
  const setOutcome = async (outcome: typeof CORRECTION_PROCESSED_OUTCOMES[number], reason?: string) => {
    setSettingOutcome(true);
    const err = await updateCorrectionProcessedOutcome(correction, outcome, actor, reason);
    setSettingOutcome(false);
    if (err) { toast?.({ title: "Could not record the outcome", description: err, variant: "destructive" }); return; }
    toast?.({ title: `Marked ${outcome}` });
    onRefresh?.();
  };

  // "Processed with Default" needs a reason first (shown in the
  // Recommendations tab) — same rule as the original return's own status
  // dropdown (TdsFilingsManager.tsx). "Processed without Default" commits
  // immediately; there's nothing to explain.
  const handleOutcomeClick = (outcome: typeof CORRECTION_PROCESSED_OUTCOMES[number]) => {
    if (outcome === PROCESSED_WITH_DEFAULT_STATUS) {
      setOutcomeReasonText(correction.default_reason || "");
      setOutcomePrompt(true);
      return;
    }
    setOutcome(outcome);
  };

  return (
    <div className={cn(
      "rounded-md border p-2",
      filed && "border-emerald-200 dark:border-emerald-900 bg-emerald-50/40 dark:bg-emerald-950/10",
    )}>
      <div className="flex items-center gap-1.5 mb-1">
        <ShieldCheck size={11} className={filed ? "text-emerald-600" : "text-muted-foreground"} />
        <span className="text-[11px] font-semibold">Filing</span>
        {filed && <CheckCircle2 size={11} className="text-emerald-600" />}
      </div>

      {filed ? (
        <>
          <p className="text-[11px] text-muted-foreground leading-snug">
            Filed by <span className="font-medium text-foreground">{correction.filed_by_name || "—"}</span>
            {correction.filed_at ? ` · ${format(new Date(correction.filed_at), "dd/MM/yy HH:mm")}` : ""}
            {correction.filing_reference ? ` · ref ${correction.filing_reference}` : ""}
          </p>
          {correction.submission_mode && (
            <p className="text-[11px] text-muted-foreground leading-snug">
              {SUBMISSION_MODE_META[correction.submission_mode].label} ·{" "}
              {correction.proof_file_url ? (
                <a href={correction.proof_file_url} target="_blank" rel="noreferrer" className="underline hover:text-foreground">
                  {correction.proof_file_name || SUBMISSION_MODE_META[correction.submission_mode].proofLabel}
                </a>
              ) : SUBMISSION_MODE_META[correction.submission_mode].proofLabel}
            </p>
          )}

          {/* Processed outcome — the one field that stays writable after
              filing (see setOutcome's own doc). Same two-button pattern as
              the submission-mode picker above, so recording/changing it
              never needs a separate dialog. */}
          <div className="mt-1.5 pt-1.5 border-t space-y-1">
            <span className="text-[11px] font-semibold text-muted-foreground">Processed</span>
            <div className="grid grid-cols-2 gap-1.5">
              {CORRECTION_PROCESSED_OUTCOMES.map(o => (
                <button
                  key={o}
                  type="button"
                  disabled={settingOutcome}
                  onClick={() => handleOutcomeClick(o)}
                  aria-pressed={correction.processed_outcome === o}
                  className={cn(
                    "rounded border px-1.5 py-1 text-[11px] text-left transition-colors disabled:opacity-60",
                    correction.processed_outcome === o
                      ? "border-emerald-300 bg-emerald-100 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200"
                      : "border-input hover:bg-muted",
                  )}
                >
                  {o}
                </button>
              ))}
            </div>
            {correction.processed_outcome && (
              <p className="text-[10px] text-muted-foreground leading-snug">
                By {correction.processed_by_name || "—"}
                {correction.processed_at ? ` · ${format(new Date(correction.processed_at), "dd/MM/yy HH:mm")}` : ""}
              </p>
            )}
          </div>
        </>
      ) : !ready ? (
        <p className="text-[11px] text-muted-foreground italic leading-snug">
          Not filed — confirmed manually once the department has accepted the return.
        </p>
      ) : (
        <div className="space-y-1.5">
          {/* 1 — how was it submitted */}
          <div className="grid grid-cols-2 gap-1.5">
            {(["offline", "online"] as SubmissionMode[]).map(m => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                aria-pressed={mode === m}
                className={cn(
                  "rounded-md border px-1.5 py-1 text-left transition-colors leading-tight",
                  mode === m ? "border-primary bg-primary/5" : "hover:bg-muted/50",
                )}
              >
                <p className="text-[11px] font-medium">
                  {m === "offline" ? "Offline" : "Online"}
                </p>
                <p className="text-[10px] text-muted-foreground">
                  {SUBMISSION_MODE_META[m].proofLabel}
                </p>
              </button>
            ))}
          </div>

          {/* 2 — the proof for that mode */}
          {meta && (
            <div className="space-y-1">
              <input ref={fileRef} type="file" className="hidden" accept={meta.accept} onChange={pickFile} />

              {proofName ? (
                <div className="flex items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 dark:bg-emerald-950/20 px-1.5 py-1 text-[11px]">
                  <CheckCircle2 size={12} className="text-emerald-600 shrink-0" />
                  <span className="truncate flex-1">{proofName}</span>
                  {correction.proof_file_url && (
                    <Button size="sm" variant="ghost" className="h-5 text-[10px] px-1.5 gap-1" asChild>
                      <a href={correction.proof_file_url} target="_blank" rel="noreferrer">
                        <Eye size={10} /> View
                      </a>
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" className="h-5 text-[10px] px-1.5" disabled={uploading || removing} onClick={() => fileRef.current?.click()}>
                    Replace
                  </Button>
                  <Button size="sm" variant="ghost" className="h-5 text-[10px] px-1.5 text-destructive hover:text-destructive gap-1" disabled={uploading || removing} onClick={removeProof}>
                    <Trash2 size={10} /> {removing ? "Removing…" : "Delete"}
                  </Button>
                </div>
              ) : (
                <>
                  <p className="text-[10px] text-muted-foreground leading-snug">{meta.hint}</p>
                  <Button size="sm" variant="outline" className="w-full gap-1.5 h-7 text-[11px]" disabled={uploading} onClick={() => fileRef.current?.click()}>
                    <Upload size={12} />
                    {uploading ? "Uploading…" : `Upload ${meta.proofLabel}`}
                  </Button>
                </>
              )}
            </div>
          )}

          {/* 3 — confirm and file */}
          {proofName && (
            <>
              <div className="grid grid-cols-2 gap-1.5">
                <div>
                  <Label className="text-[10px]">Filed on <span className="text-destructive">*</span></Label>
                  <Input type="date" className="h-7 text-[11px] px-1.5" value={filedOn} onChange={e => setFiledOn(e.target.value)} required />
                </div>
                <div>
                  <Label className="text-[10px]">Ack. no. <span className="text-destructive">*</span></Label>
                  <Input className="h-7 text-[11px] px-1.5" value={reference} onChange={e => setReference(e.target.value)} placeholder="Required" required />
                </div>
              </div>

              <label className="flex items-start gap-1.5 text-[11px] leading-snug cursor-pointer">
                <input type="checkbox" className="mt-0.5" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />
                <span>I confirm this correction return has been filed with the Income Tax Department.</span>
              </label>
            </>
          )}

          <Button
            size="sm" className="gap-1.5 h-7 text-[11px] w-full"
            disabled={!mode || !proofName || !filedOn || !reference.trim() || !confirmed || saving}
            title={
              !mode ? "Choose how the correction was submitted"
                : !proofName ? "Upload the proof of submission first"
                  : !filedOn ? "Enter the date the correction was filed"
                    : !reference.trim() ? "Enter the acknowledgement number"
                      : !confirmed ? "Confirm the return has been filed" : undefined
            }
            onClick={markFiled}
          >
            <CheckCircle2 size={12} /> {saving ? "Filing…" : "Mark as Filed"}
          </Button>
        </div>
      )}

      <Dialog open={outcomePrompt} onOpenChange={(o) => { if (!o) setOutcomePrompt(false); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>What was the default?</DialogTitle>
            <DialogDescription>
              This correction is being marked Processed with Default. Describe the default — it
              appears in the Recommendations tab so a further correction can be raised for it.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={outcomeReasonText} onChange={(e) => setOutcomeReasonText(e.target.value)} rows={3}
            placeholder="e.g. Short deduction on section 194C — TDS deducted at 1% instead of 2%"
            disabled={settingOutcome}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setOutcomePrompt(false)} disabled={settingOutcome}>Cancel</Button>
            <Button
              disabled={settingOutcome || !outcomeReasonText.trim()}
              onClick={async () => { await setOutcome(PROCESSED_WITH_DEFAULT_STATUS, outcomeReasonText); setOutcomePrompt(false); }}
            >
              {settingOutcome ? "Saving…" : "Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * A signature dialog. Used for BOTH signatures — the only differences are the
 * wording, the attestation text and which transition it calls — so the
 * confirmation UX cannot drift between the two stages.
 */
function SignatureDialog({
  open, onOpenChange, correction, actor, delta, title, icon, attestation,
  confirmLabel, run, onDone, toast,
}: {
  open: boolean; onOpenChange: (v: boolean) => void;
  correction: Correction; actor: Actor;
  delta: ReturnType<typeof summariseCorrection>;
  title: string; icon: React.ReactNode; attestation: string; confirmLabel: string;
  run: (c: Correction, a: Actor) => Promise<string | null>;
  onDone: () => void; toast: any;
}) {
  const [confirmed, setConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (!open) setConfirmed(false); }, [open]);

  const go = async () => {
    setSaving(true);
    const err = await run(correction, actor);
    setSaving(false);
    if (err) { toast({ title: "Could not sign", description: err, variant: "destructive" }); return; }
    toast({ title: `${title} recorded` });
    onDone();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">{icon} {title}</DialogTitle>
          <DialogDescription>
            Your name, role and the current date and time are recorded in the audit trail.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="rounded-md border bg-muted/40 p-3 text-xs space-y-1">
            <p><span className="text-muted-foreground">Period:</span> {correction.form_type} · {correction.quarter} {correction.financial_year}</p>
            <p>
              <span className="text-muted-foreground">Changes:</span>{" "}
              {delta.added} added, {delta.modified} modified, {delta.deleted} deleted
              {delta.challansTouched > 0 ? `, ${delta.challansTouched} challan(s) changed` : ""}
            </p>
            <p><span className="text-muted-foreground">Signing as:</span> {actor.name || "—"}{actor.role ? ` (${actor.role})` : ""}</p>
          </div>

          <label className="flex items-start gap-2 text-xs cursor-pointer">
            <input type="checkbox" className="mt-0.5" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />
            <span>{attestation}</span>
          </label>
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button size="sm" className="gap-1.5" disabled={!confirmed || saving} onClick={go}>
            {saving ? "Recording…" : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RejectDialog({ open, onOpenChange, correction, actor, onRejected, toast }: {
  open: boolean; onOpenChange: (v: boolean) => void;
  correction: Correction; actor: Actor; onRejected: () => void; toast: any;
}) {
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (!open) setReason(""); }, [open]);

  const doReject = async () => {
    setSaving(true);
    const err = await rejectCorrection(correction, reason, actor);
    setSaving(false);
    if (err) { toast({ title: "Could not reject", description: err, variant: "destructive" }); return; }
    toast({ title: "Correction rejected" });
    onRejected();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Reject correction</DialogTitle>
          <DialogDescription>The requester will see this reason and can revise and re-submit.</DialogDescription>
        </DialogHeader>
        <Textarea
          value={reason} onChange={e => setReason(e.target.value)}
          placeholder="Why is this being sent back?" className="text-xs min-h-[80px]"
        />
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button size="sm" variant="destructive" disabled={saving || !reason.trim()} onClick={doReject}>
            {saving ? "Rejecting…" : "Reject"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
