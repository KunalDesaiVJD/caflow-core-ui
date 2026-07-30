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
import { useState, useEffect, useCallback, useMemo } from "react";
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
  AlertTriangle, Send,
} from "lucide-react";
import { isFilingTdsCompliant } from "@/lib/tdsQuarter";
import { TdsDataEntry, CORRECTION_TDS_SOURCE } from "./TdsDataEntry";
import {
  CORRECTION_STATUS_META, isCorrectionLocked, isCorrectionEditable,
  isSeniorReviewer, createCorrection, loadCorrectionDetail, submitCorrection,
  signAsPreparer, approveAsSenior, markCorrectionFiled,
  rejectCorrection, summariseCorrection, logCorrectionAction, diffCorrectionRow,
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

/** Shown wherever a correction's state needs to read at a glance. */
export function CorrectionStatusBadge({ status, className }: { status: string; className?: string }) {
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

  return openId
    ? <CorrectionDetail
        correctionId={openId} clients={clients} actor={actor}
        onBack={() => setOpenId(null)} toast={toast}
      />
    : <CorrectionDashboard
        clients={clients} users={users} isSuperadmin={isSuperadmin}
        resolveFirmId={resolveFirmId} actor={actor} toast={toast}
        onOpen={setOpenId}
      />;
}

// ═══════════════════════════════════════════════════════════════════════════
// Dashboard
// ═══════════════════════════════════════════════════════════════════════════

function CorrectionDashboard({
  clients, users, isSuperadmin, resolveFirmId, actor, toast, onOpen,
}: Props & { actor: Actor; toast: any; onOpen: (id: string) => void }) {
  const [rows, setRows] = useState<Correction[]>([]);
  const [loading, setLoading] = useState(true);
  const [newOpen, setNewOpen] = useState(false);

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
        r.reason, r.raised_by_name, r.signed_by_name,
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
        <Button size="sm" className="gap-1.5 shrink-0" onClick={() => setNewOpen(true)}>
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
                      <TableCell className="py-1.5"><CorrectionStatusBadge status={r.status} /></TableCell>
                      <TableCell className="text-xs py-1.5 whitespace-nowrap">
                        {r.raised_by_name || (r.raised_by ? userMap[r.raised_by] : null) || "—"}
                        {r.raised_by_role === "client" && (
                          <Badge variant="outline" className="ml-1 text-[9px]">Client</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-xs py-1.5 whitespace-nowrap">{shortDate(r.raised_at)}</TableCell>
                      <TableCell className="text-xs py-1.5 whitespace-nowrap">{r.signed_by_name || "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      <NewCorrectionDialog
        open={newOpen} onOpenChange={setNewOpen}
        clients={clients} resolveFirmId={resolveFirmId} actor={actor} toast={toast}
        onCreated={(id) => { setNewOpen(false); fetchRows(); onOpen(id); }}
      />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// New correction
// ═══════════════════════════════════════════════════════════════════════════

function NewCorrectionDialog({
  open, onOpenChange, clients, resolveFirmId, actor, toast, onCreated,
}: {
  open: boolean; onOpenChange: (v: boolean) => void;
  clients: ClientOption[]; resolveFirmId: () => Promise<string | null>;
  actor: Actor; toast: any; onCreated: (id: string) => void;
}) {
  const [client, setClient] = useState("");
  const [fy, setFy] = useState("");
  const [quarter, setQuarter] = useState("");
  const [form, setForm] = useState("");
  const [reason, setReason] = useState("");
  const [filing, setFiling] = useState<any | null>(null);
  const [preview, setPreview] = useState<{ challans: number; deductees: number } | null>(null);
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) {
      setClient(""); setFy(""); setQuarter(""); setForm("");
      setReason(""); setFiling(null); setPreview(null);
    }
  }, [open]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!client || !fy || !quarter || !form) { setFiling(null); setPreview(null); return; }
      setChecking(true);
      const { data: filings } = await supabase.from("tds_filings")
        .select("id, client_id, financial_year, quarter, tds_forms, work_status")
        .eq("client_id", client).eq("financial_year", fy).eq("quarter", quarter);
      const match = ((filings || []) as any[]).find(f => (f.tds_forms || []).includes(form)) || null;
      if (cancelled) return;
      setFiling(match);
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
  const canCreate = !!(client && fy && quarter && form && filing && compliant);

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
          <div className="space-y-1">
            <Label className="text-xs">Client</Label>
            <Select value={client} onValueChange={setClient}>
              <SelectTrigger className="h-9"><SelectValue placeholder="Select client" /></SelectTrigger>
              <SelectContent>
                {clients.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">Financial Year</Label>
              <Select value={fy} onValueChange={setFy}>
                <SelectTrigger className="h-9"><SelectValue placeholder="FY" /></SelectTrigger>
                <SelectContent>{FY_OPTIONS.map(f => <SelectItem key={f} value={f}>{f}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Quarter</Label>
              <Select value={quarter} onValueChange={setQuarter}>
                <SelectTrigger className="h-9"><SelectValue placeholder="Q" /></SelectTrigger>
                <SelectContent>{QUARTERS.map(q => <SelectItem key={q} value={q}>{q}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Form</Label>
              <Select value={form} onValueChange={setForm}>
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

  const [editRow, setEditRow] = useState<CorrectionDeductee | null>(null);
  const [addToChallan, setAddToChallan] = useState<CorrectionChallan | null>(null);
  const [editChallan, setEditChallan] = useState<CorrectionChallan | null>(null);
  const [signOpen, setSignOpen] = useState(false);
  const [approveOpen, setApproveOpen] = useState(false);
  const [fileOpen, setFileOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);

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

  const locked = isCorrectionLocked(correction?.status);
  // Entries freeze at the FIRST signature, not at filing — what the senior
  // reviews must be exactly what the preparer signed. The DB enforces this
  // too; `editable` only keeps the UI from offering a rejected action.
  const editable = isCorrectionEditable(correction?.status);
  const isSamePerson = !!correction?.prepared_by && correction.prepared_by === actor.id;
  const canApprove = isSeniorReviewer(actor.role) && !isSamePerson;

  // The correction presented to the Data Entry engine as if it were a filing.
  // 20260729190000 made the correction tables column-identical to the live
  // ones and mirrors filing_id onto correction_id, so the engine's queries
  // work unchanged against this id.
  const correctionAsFiling = useMemo(() => correction ? ({
    id: correction.id,
    client_id: correction.client_id,
    firm_id: correction.firm_id,
    financial_year: correction.financial_year,
    quarter: correction.quarter,
    tds_forms: [correction.form_type],
    work_status: correction.status === "filed" ? "Filed" : "Under Process",
    tan: null,
  }) as any : null, [correction]);
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
      {/* ── Header: back + identity + status + primary action, all one row ── */}
      <div className="flex items-center gap-2 flex-wrap">
        <Button variant="ghost" size="sm" className="gap-1.5 -ml-2 h-8" onClick={onBack}>
          <ArrowLeft size={14} /> All corrections
        </Button>
        <h2 className="text-lg font-bold text-foreground">{clientName}</h2>
        <span className="text-sm text-muted-foreground">
          {correction.form_type} · {correction.quarter} {correction.financial_year}
        </span>
        <CorrectionStatusBadge status={correction.status} />

        <div className="flex-1" />

        {/* One action per stage — the workflow only ever offers its next step. */}
        {correction.status === "draft" && (
          <Button size="sm" className="gap-1.5 h-8" disabled={busy} onClick={doSubmit}>
            <Send size={13} /> Submit for signature
          </Button>
        )}

        {correction.status === "awaiting_employee" && (
          <Button size="sm" className="gap-1.5 h-8" onClick={() => setSignOpen(true)}>
            <PenTool size={13} /> Sign as preparer
          </Button>
        )}

        {correction.status === "awaiting_senior" && (
          <>
            <Button size="sm" variant="outline" className="gap-1.5 h-8" onClick={() => setRejectOpen(true)}>
              <XCircle size={13} /> Reject
            </Button>
            <Button
              size="sm" className="gap-1.5 h-8"
              disabled={!canApprove}
              title={
                !isSeniorReviewer(actor.role)
                  ? "Only a manager, partner or firm admin can give the senior approval"
                  : isSamePerson
                    ? "The senior approval must come from someone other than the preparer"
                    : undefined
              }
              onClick={() => setApproveOpen(true)}
            >
              <ShieldCheck size={13} /> Approve as senior
            </Button>
          </>
        )}

        {correction.status === "ready_to_file" && (
          <Button size="sm" className="gap-1.5 h-8" onClick={() => setFileOpen(true)}>
            <CheckCircle2 size={13} /> Mark as Filed
          </Button>
        )}

        {correction.status === "rejected" && (
          <Button size="sm" className="gap-1.5 h-8" disabled={busy} onClick={doSubmit}>
            <Send size={13} /> Re-submit
          </Button>
        )}
      </div>

      {/* Stage tracker — where the correction is, and what is next */}
      <WorkflowTracker correction={correction} />

      {correction.reason && (
        <p className="text-xs text-muted-foreground -mt-1">
          <span className="font-medium text-foreground">Reason:</span> {correction.reason}
        </p>
      )}

      {/* ── Filed / rejected banners ── */}
      {locked && (
        <div className="rounded-lg border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/20 px-3 py-2 flex items-start gap-2.5">
          <ShieldCheck size={16} className="text-emerald-600 shrink-0 mt-0.5" />
          <div className="min-w-0 text-xs">
            <p className="font-semibold text-emerald-800 dark:text-emerald-300 flex items-center gap-1.5">
              Correction Filed <Lock size={11} />
            </p>
            <p className="text-emerald-700 dark:text-emerald-400">
              Signed by {correction.signed_by_name || "—"}
              {correction.signed_by_role ? ` (${correction.signed_by_role})` : ""}
              {correction.signed_at ? ` on ${format(new Date(correction.signed_at), "dd/MM/yyyy HH:mm")}` : ""}. Read-only.
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

      {/* Every change vs the filed return, with Original -> Corrected values */}
      <ChangesPanel challans={challans} deductees={deductees} />

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
        // action / original_values are written by DB triggers, so the change
        // summary and the Original-vs-Corrected panel above this grid only
        // reflect an edit if we re-read after it.
        onCorrectionChanged={loadSilently}
      />

      {/* Signature */}
      <SignatureSection correction={correction} />

      {/* Dialogs */}
      <EntryDialog
        open={!!editRow || !!addToChallan}
        row={editRow}
        challan={addToChallan}
        correction={correction}
        form={correction.form_type}
        rateMaster={rateMaster}
        actor={actor}
        onClose={() => { setEditRow(null); setAddToChallan(null); }}
        onSaved={() => { setEditRow(null); setAddToChallan(null); load(); }}
        toast={toast}
      />
      <ChallanDialog
        challan={editChallan}
        correction={correction}
        actor={actor}
        onClose={() => setEditChallan(null)}
        onSaved={() => { setEditChallan(null); load(); }}
        toast={toast}
      />
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

      {/* Manual filing, only reachable once both signatures exist */}
      <MarkFiledDialog
        open={fileOpen} onOpenChange={setFileOpen}
        correction={correction} actor={actor}
        onFiled={() => { setFileOpen(false); load(); }}
        toast={toast}
      />
      <RejectDialog
        open={rejectOpen} onOpenChange={setRejectOpen}
        correction={correction} actor={actor}
        onRejected={() => { setRejectOpen(false); load(); }}
        toast={toast}
      />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Entry table — dense; the whole row is the edit affordance
// ═══════════════════════════════════════════════════════════════════════════

function EntryTable({ rows, form, locked, onEdit, onDelete, onRestore }: {
  rows: CorrectionDeductee[]; form: string; locked: boolean;
  onEdit: (d: CorrectionDeductee) => void;
  onDelete: (d: CorrectionDeductee) => void;
  onRestore: (d: CorrectionDeductee) => void;
}) {
  if (rows.length === 0) {
    return <p className="text-xs text-muted-foreground px-3 py-2.5">No entries under this challan.</p>;
  }
  const isSalary = form === "24Q";
  const isTcs = form === "27EQ";

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="text-xs">{isSalary ? "Employee" : isTcs ? "Collectee" : "Name"}</TableHead>
            <TableHead className="text-xs">PAN</TableHead>
            {isSalary ? (
              <>
                <TableHead className="text-xs text-right">Gross</TableHead>
                <TableHead className="text-xs text-right">Taxable</TableHead>
                <TableHead className="text-xs text-right">TDS</TableHead>
              </>
            ) : (
              <>
                <TableHead className="text-xs">Section</TableHead>
                <TableHead className="text-xs text-right">Amount</TableHead>
                <TableHead className="text-xs whitespace-nowrap">Date</TableHead>
                <TableHead className="text-xs text-right">Rate%</TableHead>
                <TableHead className="text-xs text-right">{isTcs ? "TCS" : "TDS"}</TableHead>
              </>
            )}
            {!locked && <TableHead className="text-xs w-[70px] text-right">Actions</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map(d => {
            const meta = ACTION_META[d.action];
            const removed = d.action === "delete";
            return (
              <TableRow
                key={d.id}
                onClick={() => { if (!locked && !removed) onEdit(d); }}
                className={cn(
                  "h-9 border-l-[3px]", meta.rail,
                  removed && "opacity-55",
                  !locked && !removed && "cursor-pointer",
                )}
                title={!locked && !removed ? "Click to edit this entry" : undefined}
              >
                <TableCell className="text-xs font-medium py-1">
                  <span className={cn("inline-flex items-center gap-1.5", removed && "line-through")}>
                    {d.deductee_name || "—"}
                    {d.action !== "unchanged" && (
                      <Badge className={cn("text-[9px] px-1 py-0", meta.badge)}>{meta.label}</Badge>
                    )}
                  </span>
                </TableCell>
                <TableCell className={cn("text-xs font-mono py-1", removed && "line-through")}>
                  {d.pan_not_available ? <span className="text-muted-foreground">PANNOTAVBL</span> : (d.deductee_pan || "—")}
                </TableCell>
                {isSalary ? (
                  <>
                    <TableCell className="text-xs text-right py-1">{money(d.gross_salary)}</TableCell>
                    <TableCell className="text-xs text-right py-1">{money(d.net_taxable_salary)}</TableCell>
                    <TableCell className="text-xs text-right py-1 font-medium">{money(d.total_tax_deducted ?? d.tds_amount)}</TableCell>
                  </>
                ) : (
                  <>
                    <TableCell className="text-xs py-1">{d.section_code || "—"}</TableCell>
                    <TableCell className="text-xs text-right py-1">{money(d.amount_paid_credited)}</TableCell>
                    <TableCell className="text-xs py-1 whitespace-nowrap">{shortDate(d.date_of_payment)}</TableCell>
                    <TableCell className="text-xs text-right py-1">{d.rate_of_tds ?? "—"}</TableCell>
                    <TableCell className="text-xs text-right py-1 font-medium">{money(d.total_tax_deducted ?? d.tds_amount)}</TableCell>
                  </>
                )}
                {!locked && (
                  <TableCell className="py-1" onClick={e => e.stopPropagation()}>
                    <div className="flex items-center justify-end gap-0.5">
                      {removed ? (
                        <Button size="sm" variant="ghost" className="h-6 gap-1 px-1.5 text-[11px]" title="Restore this entry" onClick={() => onRestore(d)}>
                          <RotateCcw size={11} /> Restore
                        </Button>
                      ) : (
                        <>
                          <Button size="sm" variant="ghost" className="h-6 w-6 p-0" title="Edit entry" onClick={() => onEdit(d)}>
                            <Pencil size={12} />
                          </Button>
                          <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-red-600 hover:text-red-700" title="Delete entry" onClick={() => onDelete(d)}>
                            <Trash2 size={12} />
                          </Button>
                        </>
                      )}
                    </div>
                  </TableCell>
                )}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Entry add / edit
// ═══════════════════════════════════════════════════════════════════════════

function EntryDialog({
  open, row, challan, correction, form, rateMaster, actor, onClose, onSaved, toast,
}: {
  open: boolean; row: CorrectionDeductee | null; challan: CorrectionChallan | null;
  correction: Correction; form: string; rateMaster: RateEntry[]; actor: Actor;
  onClose: () => void; onSaved: () => void; toast: any;
}) {
  const isSalary = form === "24Q";
  const [f, setF] = useState<Record<string, any>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setF(row ? { ...row } : {
      deductee_name: "", deductee_pan: "", pan_not_available: false, deductee_type: "", section_code: "",
      amount_paid_credited: "", date_of_payment: "", rate_of_tds: "",
      tds_amount: "", total_tax_deducted: "", interest_amount: 0,
      gross_salary: "", standard_deduction_allowed: "", net_taxable_salary: "",
      reason_for_lower_or_nil_deduction: "", lower_deduction_certificate_no: "", lower_deduction_rate: "",
      country_of_residence: "", remarks: "",
    });
  }, [open, row]);

  // Re-derive PAN Not Available / Deductee Type / Rate of TDS / TDS Amount /
  // Interest Amount from whatever changed — the SAME cascade as Data Entry's
  // updateDeducteeField (rateEngine.ts is the shared engine), just applied to
  // local dialog state and committed to the DB on Save instead of per-field
  // on blur. `patch` carries the field that actually changed plus its value.
  const set = (k: string, v: any) => setF(p => recompute({ ...p, [k]: v }, k));
  const num = (v: any) => (v === "" || v == null ? null : Number(v));

  function recompute(next: Record<string, any>, changedField: string) {
    if (isSalary) return next; // 24Q's salary/slab path is out of scope here, same as the template
    if (changedField === "deductee_pan") {
      const panVal = (next.deductee_pan || "").trim().toUpperCase();
      next.deductee_pan = panVal || "";
      if (!panVal || !isValidPan(panVal)) {
        next.pan_not_available = true;
        if (panVal.length >= 4 && PAN_4TH_CHAR_MAP[panVal[3]]) next.deductee_type = PAN_4TH_CHAR_MAP[panVal[3]];
        else if (!panVal) next.deductee_type = "";
      } else {
        next.pan_not_available = false;
        const detected = PAN_4TH_CHAR_MAP[panVal[3]] || null;
        if (detected) next.deductee_type = detected;
      }
    }
    if (["deductee_pan", "section_code", "amount_paid_credited", "date_of_payment"].includes(changedField)) {
      const { rate, noPanRate, rateFound } = getRateForSection(rateMaster, next.section_code, next.deductee_type, next.date_of_payment || null);
      const resolved = next.pan_not_available ? (noPanRate ?? 20) : rate;
      if (rateFound && resolved !== null) next.rate_of_tds = resolved;
      const amt = parseFloat(next.amount_paid_credited) || 0;
      const rt = parseFloat(next.rate_of_tds) || 0;
      next.tds_amount = Math.round(amt * rt / 100);
      next.total_tax_deducted = next.tds_amount;
      next.interest_amount = calcAutoInterest(next.tds_amount, next.date_of_payment || null, challan?.deposit_date || null).interest;
    }
    return next;
  }

  const isAutoRate = !isSalary && (!!f.section_code
    && getRateForSection(rateMaster, f.section_code, f.deductee_type, f.date_of_payment || null).rateFound
    || f.pan_not_available);

  const save = async () => {
    setSaving(true);
    const payload: Record<string, any> = {
      deductee_name: f.deductee_name || null,
      deductee_pan: f.deductee_pan || null,
      pan_not_available: !!f.pan_not_available,
      deductee_type: f.deductee_type || null,
      section_code: f.section_code || null,
      amount_paid_credited: num(f.amount_paid_credited),
      date_of_payment: f.date_of_payment || null,
      rate_of_tds: num(f.rate_of_tds),
      tds_amount: num(f.tds_amount),
      total_tax_deducted: num(f.total_tax_deducted ?? f.tds_amount),
      interest_amount: num(f.interest_amount) ?? 0,
      gross_salary: num(f.gross_salary),
      standard_deduction_allowed: num(f.standard_deduction_allowed),
      net_taxable_salary: num(f.net_taxable_salary),
      reason_for_lower_or_nil_deduction: f.reason_for_lower_or_nil_deduction || null,
      lower_deduction_certificate_no: f.lower_deduction_certificate_no || null,
      lower_deduction_rate: num(f.lower_deduction_rate),
      country_of_residence: f.country_of_residence || null,
      remarks: f.remarks || null,
      updated_at: new Date().toISOString(),
    };

    let err: string | null = null;
    if (row) {
      const nextAction = row.action === "add" ? "add" : "modify";
      const { error } = await supabase.from("tds_correction_deductees" as any)
        .update({ ...payload, action: nextAction }).eq("id", row.id);
      err = error?.message ?? null;
    } else {
      const { error } = await supabase.from("tds_correction_deductees" as any).insert({
        ...payload,
        correction_id: correction.id,
        correction_challan_id: challan?.id ?? null,
        firm_id: correction.firm_id,
        client_id: correction.client_id,
        form_type: correction.form_type,
        financial_year: correction.financial_year,
        quarter: correction.quarter,
        action: "add",
      });
      err = error?.message ?? null;
    }
    setSaving(false);

    if (err) { toast({ title: "Could not save entry", description: err, variant: "destructive" }); return; }
    await logCorrectionAction({
      correctionId: correction.id, firmId: correction.firm_id, clientId: correction.client_id,
      actionType: row ? "ENTRY_MODIFIED" : "ENTRY_ADDED",
      detail: f.deductee_name || "—", actor,
    });
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{row ? "Edit entry" : "Add entry"}</DialogTitle>
          <DialogDescription>
            {row
              ? "The filed original is preserved — this records the corrected values."
              : `New entry under challan ${challan?.challan_serial_no || "—"}.`}
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1 col-span-2">
            <Label className="text-xs">{isSalary ? "Employee name" : "Deductee name"}</Label>
            <Input autoFocus className="h-9 text-xs" value={f.deductee_name ?? ""} onChange={e => set("deductee_name", e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">PAN</Label>
            <Input className="h-9 text-xs font-mono" value={f.deductee_pan ?? ""} onChange={e => set("deductee_pan", e.target.value.toUpperCase())} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs flex items-center gap-1">PAN Not Available <Lock size={9} className="text-muted-foreground" /></Label>
            <Input readOnly disabled className={cn("h-9 text-xs bg-muted cursor-not-allowed", f.pan_not_available && "text-destructive font-semibold")}
              value={f.pan_not_available ? "Y — flat no-PAN rate applies" : "N"} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Section</Label>
            <Input className="h-9 text-xs" value={f.section_code ?? ""} onChange={e => set("section_code", e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs flex items-center gap-1">Deductee Type <Lock size={9} className="text-muted-foreground" /></Label>
            <Input readOnly disabled className="h-9 text-xs bg-muted cursor-not-allowed" value={f.deductee_type || "—"} />
          </div>

          {isSalary ? (
            <>
              <div className="space-y-1">
                <Label className="text-xs">Gross salary</Label>
                <Input type="number" className="h-9 text-xs" value={f.gross_salary ?? ""} onChange={e => set("gross_salary", e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Taxable salary</Label>
                <Input type="number" className="h-9 text-xs" value={f.net_taxable_salary ?? ""} onChange={e => set("net_taxable_salary", e.target.value)} />
              </div>
            </>
          ) : (
            <>
              <div className="space-y-1">
                <Label className="text-xs">Amount paid</Label>
                <Input type="number" className="h-9 text-xs" value={f.amount_paid_credited ?? ""} onChange={e => set("amount_paid_credited", e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Date of payment</Label>
                <Input type="date" className="h-9 text-xs" value={(f.date_of_payment ?? "").slice(0, 10)} onChange={e => set("date_of_payment", e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs flex items-center gap-1">
                  Rate % {isAutoRate && <Lock size={9} className="text-muted-foreground" />}
                </Label>
                <Input
                  type="number" step="0.01" className={cn("h-9 text-xs", isAutoRate && "bg-muted cursor-not-allowed")}
                  readOnly={isAutoRate} disabled={isAutoRate}
                  value={f.rate_of_tds ?? ""} onChange={e => set("rate_of_tds", e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs flex items-center gap-1">Interest amount <Lock size={9} className="text-muted-foreground" /></Label>
                <Input readOnly disabled className="h-9 text-xs bg-muted cursor-not-allowed" value={money(f.interest_amount)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Reason code</Label>
                <Select value={f.reason_for_lower_or_nil_deduction ?? ""} onValueChange={v => set("reason_for_lower_or_nil_deduction", v)}>
                  <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="Pick" /></SelectTrigger>
                  <SelectContent>{REASON_CODES.map(r => <SelectItem key={r.code} value={r.code}>{r.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Lower deduction certificate no.</Label>
                <Input className="h-9 text-xs" value={f.lower_deduction_certificate_no ?? ""} onChange={e => set("lower_deduction_certificate_no", e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Lower deduction rate</Label>
                <Input type="number" step="0.01" className="h-9 text-xs" value={f.lower_deduction_rate ?? ""} onChange={e => set("lower_deduction_rate", e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Country of residence</Label>
                <Input className="h-9 text-xs" value={f.country_of_residence ?? ""} onChange={e => set("country_of_residence", e.target.value)} />
              </div>
            </>
          )}

          <div className="space-y-1">
            <Label className="text-xs flex items-center gap-1">TDS amount <Lock size={9} className="text-muted-foreground" /></Label>
            <Input readOnly disabled className="h-9 text-xs bg-muted cursor-not-allowed" value={money(f.tds_amount)} />
          </div>
          <div className="space-y-1 col-span-2">
            <Label className="text-xs">Remarks</Label>
            <Input className="h-9 text-xs" value={f.remarks ?? ""} onChange={e => set("remarks", e.target.value)} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" disabled={saving || !f.deductee_name} onClick={save}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Challan edit
// ═══════════════════════════════════════════════════════════════════════════

function ChallanDialog({ challan, correction, actor, onClose, onSaved, toast }: {
  challan: CorrectionChallan | null; correction: Correction; actor: Actor;
  onClose: () => void; onSaved: () => void; toast: any;
}) {
  const [f, setF] = useState<Record<string, any>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (challan) setF({ ...challan }); }, [challan]);
  const set = (k: string, v: any) => setF(p => ({ ...p, [k]: v }));
  const num = (v: any) => (v === "" || v == null ? null : Number(v));

  // Total Challan Amount is auto-computed from the 6 deposit components,
  // exactly like Data Entry's challanTotal — never a field the user types
  // into directly, in either screen.
  const total = (parseFloat(f.total_tax_deposited) || 0) + (parseFloat(f.surcharge_deposited) || 0)
    + (parseFloat(f.education_cess_deposited) || 0) + (parseFloat(f.interest_deposited) || 0)
    + (parseFloat(f.others_deposited) || 0) + (parseFloat(f.late_fees_234e) || 0);

  const save = async () => {
    if (!challan) return;
    setSaving(true);
    const { error } = await supabase.from("tds_correction_challans" as any).update({
      bsr_code: f.bsr_code || null,
      challan_serial_no: f.challan_serial_no || null,
      deposit_date: f.deposit_date || null,
      total_tax_deposited: num(f.total_tax_deposited),
      surcharge_deposited: num(f.surcharge_deposited),
      education_cess_deposited: num(f.education_cess_deposited),
      interest_deposited: num(f.interest_deposited),
      others_deposited: num(f.others_deposited),
      late_fees_234e: num(f.late_fees_234e),
      total_challan_amount: total,
      minor_head_of_challan: f.minor_head_of_challan || null,
      is_book_entry: !!f.is_book_entry,
      transfer_voucher_no: f.is_book_entry ? (f.transfer_voucher_no || null) : null,
      cheque_dd_no: f.cheque_dd_no || null,
      bank_name: f.bank_name || null,
      section_code: f.section_code || null,
      challan_remarks: f.challan_remarks || null,
      action: challan.action === "add" ? "add" : "modify",
      updated_at: new Date().toISOString(),
    }).eq("id", challan.id);
    setSaving(false);
    if (error) { toast({ title: "Could not save challan", description: error.message, variant: "destructive" }); return; }
    await logCorrectionAction({
      correctionId: correction.id, firmId: correction.firm_id, clientId: correction.client_id,
      actionType: "CHALLAN_MODIFIED", detail: f.challan_serial_no || "—", actor,
    });
    onSaved();
  };

  return (
    <Dialog open={!!challan} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Correct challan details</DialogTitle>
          <DialogDescription>The filed challan is preserved; this records the corrected values.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">BSR code</Label>
            <Input className="h-9 text-xs" value={f.bsr_code ?? ""} onChange={e => set("bsr_code", e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Challan serial no.</Label>
            <Input className="h-9 text-xs" value={f.challan_serial_no ?? ""} onChange={e => set("challan_serial_no", e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Deposit date</Label>
            <Input type="date" className="h-9 text-xs" value={(f.deposit_date ?? "").slice(0, 10)} onChange={e => set("deposit_date", e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Minor head</Label>
            <Select value={f.minor_head_of_challan ?? ""} onValueChange={v => set("minor_head_of_challan", v)}>
              <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="Pick" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="200">200 — TDS Payable</SelectItem>
                <SelectItem value="400">400 — Demand</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Section</Label>
            <Input className="h-9 text-xs" value={f.section_code ?? ""} onChange={e => set("section_code", e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Tax deposited</Label>
            <Input type="number" className="h-9 text-xs" value={f.total_tax_deposited ?? ""} onChange={e => set("total_tax_deposited", e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Surcharge deposited</Label>
            <Input type="number" className="h-9 text-xs" value={f.surcharge_deposited ?? ""} onChange={e => set("surcharge_deposited", e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Education cess deposited</Label>
            <Input type="number" className="h-9 text-xs" value={f.education_cess_deposited ?? ""} onChange={e => set("education_cess_deposited", e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Interest deposited</Label>
            <Input type="number" className="h-9 text-xs" value={f.interest_deposited ?? ""} onChange={e => set("interest_deposited", e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Others deposited</Label>
            <Input type="number" className="h-9 text-xs" value={f.others_deposited ?? ""} onChange={e => set("others_deposited", e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Late fee (234E)</Label>
            <Input type="number" className="h-9 text-xs" value={f.late_fees_234e ?? ""} onChange={e => set("late_fees_234e", e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Total challan amount (auto)</Label>
            <Input readOnly disabled className="h-9 text-xs bg-muted cursor-not-allowed" value={money(total)} />
          </div>
          <div className="space-y-1 col-span-2 flex items-center justify-between rounded-md border px-3 py-2">
            <Label className="text-xs">Book entry (government payment, no cheque/DD)</Label>
            <Switch checked={!!f.is_book_entry} onCheckedChange={v => set("is_book_entry", v)} />
          </div>
          {f.is_book_entry ? (
            <div className="space-y-1 col-span-2">
              <Label className="text-xs">Transfer voucher no.</Label>
              <Input className="h-9 text-xs" value={f.transfer_voucher_no ?? ""} onChange={e => set("transfer_voucher_no", e.target.value)} />
            </div>
          ) : (
            <div className="space-y-1 col-span-2">
              <Label className="text-xs">Cheque/DD no.</Label>
              <Input className="h-9 text-xs" value={f.cheque_dd_no ?? ""} onChange={e => set("cheque_dd_no", e.target.value)} />
            </div>
          )}
          <div className="space-y-1 col-span-2">
            <Label className="text-xs">Bank</Label>
            <Input className="h-9 text-xs" value={f.bank_name ?? ""} onChange={e => set("bank_name", e.target.value)} />
          </div>
          <div className="space-y-1 col-span-2">
            <Label className="text-xs">Challan remarks</Label>
            <Input className="h-9 text-xs" value={f.challan_remarks ?? ""} onChange={e => set("challan_remarks", e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" disabled={saving} onClick={save}>{saving ? "Saving…" : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Signature
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Every change in this correction, versus the originally filed return —
 * so nobody has to diff two returns by eye.
 *
 * Additions and deletions come from `action`; modifications are shown
 * field-by-field as Original -> Corrected, using the snapshot the database
 * takes the instant before the first edit (20260729200000).
 */
function ChangesPanel({ challans, deductees }: {
  challans: CorrectionChallan[]; deductees: CorrectionDeductee[];
}) {
  const rows = useMemo(() => {
    const out: {
      kind: "Challan" | "Entry"; action: CorrectionAction;
      title: string; diffs: FieldDiff[];
    }[] = [];

    for (const c of challans) {
      if (c.action === "unchanged") continue;
      out.push({
        kind: "Challan", action: c.action,
        title: `Challan ${c.challan_serial_no || "—"}`,
        diffs: diffCorrectionRow(c),
      });
    }
    for (const d of deductees) {
      if (d.action === "unchanged") continue;
      out.push({
        kind: "Entry", action: d.action,
        title: d.deductee_name || "—",
        diffs: diffCorrectionRow(d),
      });
    }
    // Modified first — those are the ones needing a value comparison.
    const rank = { modify: 0, add: 1, delete: 2, unchanged: 3 } as const;
    return out.sort((a, b) => rank[a.action] - rank[b.action]);
  }, [challans, deductees]);

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
        <div className="px-3 py-2 border-b flex items-center gap-2">
          <GitCompare size={13} className="text-muted-foreground" />
          <span className="text-sm font-semibold">Changes vs the filed return</span>
          <span className="text-[11px] text-muted-foreground">
            {rows.length} change{rows.length === 1 ? "" : "s"}
          </span>
        </div>

        <div className="divide-y">
          {rows.map((r, i) => (
            <div
              key={i}
              className={cn("px-3 py-2 border-l-[3px]", ACTION_META[r.action].rail)}
            >
              <div className="flex items-center gap-2 flex-wrap">
                <Badge className={cn("text-[9px]", ACTION_META[r.action].badge)}>
                  {ACTION_META[r.action].label}
                </Badge>
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{r.kind}</span>
                <span className={cn("text-xs font-medium", r.action === "delete" && "line-through")}>
                  {r.title}
                </span>
              </div>

              {r.action === "modify" && r.diffs.length > 0 && (
                <div className="mt-1.5 overflow-x-auto">
                  <table className="text-xs">
                    <tbody>
                      {r.diffs.map(d => (
                        <tr key={d.field}>
                          <td className="pr-3 py-0.5 text-muted-foreground whitespace-nowrap">{d.label}</td>
                          <td className="pr-2 py-0.5">
                            <span className="line-through text-red-600 dark:text-red-400">{fmt(d.original)}</span>
                          </td>
                          <td className="pr-2 py-0.5 text-muted-foreground">→</td>
                          <td className="py-0.5">
                            <span className="font-medium text-emerald-700 dark:text-emerald-400">{fmt(d.corrected)}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {r.action === "modify" && r.diffs.length === 0 && (
                <p className="text-[11px] text-muted-foreground mt-1">
                  Marked modified; no field-level snapshot was captured for this row.
                </p>
              )}
            </div>
          ))}
        </div>
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
function SignatureSlot({ title, name, role, at, awaiting, note }: {
  title: string; name: string | null; role: string | null; at: string | null;
  awaiting: string; note?: string;
}) {
  const signed = !!at;
  return (
    <div className={cn(
      "rounded-lg border p-3 flex-1 min-w-[220px]",
      signed && "border-emerald-200 dark:border-emerald-900 bg-emerald-50/40 dark:bg-emerald-950/10",
    )}>
      <div className="flex items-center gap-1.5 mb-2">
        <PenTool size={12} className={signed ? "text-emerald-600" : "text-muted-foreground"} />
        <span className="text-xs font-semibold">{title}</span>
        {signed && <CheckCircle2 size={12} className="text-emerald-600" />}
      </div>
      {signed ? (
        <>
          <div className="border-b border-foreground/40 pb-1 mb-1">
            <p className="font-semibold text-sm">{name || "—"}</p>
          </div>
          <p className="text-[11px] text-muted-foreground">
            {role || "Authorised signatory"}
            {at ? ` · ${format(new Date(at), "dd/MM/yyyy HH:mm")}` : ""}
          </p>
        </>
      ) : (
        <p className="text-[11px] text-muted-foreground italic">{awaiting}</p>
      )}
      {note && <p className="text-[11px] text-muted-foreground mt-1">{note}</p>}
    </div>
  );
}

/**
 * Both signatures plus the filing record. Approval and filing are shown as
 * separate things on purpose — signing authorises, filing is the later manual
 * confirmation that the department accepted the return.
 */
export function SignatureSection({ correction }: { correction: Correction }) {
  const filed = correction.status === "filed";
  return (
    <Card>
      <CardContent className="p-3 space-y-3">
        <div className="flex flex-wrap gap-2">
          <SignatureSlot
            title="1 · Employee signature"
            name={correction.prepared_by_name}
            role={correction.prepared_by_role}
            at={correction.prepared_at}
            awaiting="Awaiting the preparer's signature."
          />
          <SignatureSlot
            title="2 · Senior approval"
            name={correction.approved_by_name || correction.signed_by_name}
            role={correction.approved_by_role || correction.signed_by_role}
            at={correction.approved_at || correction.signed_at}
            awaiting="Awaiting a senior reviewer's approval."
            note="Must be a different person from the preparer."
          />
        </div>

        <div className={cn(
          "rounded-lg border p-3",
          filed && "border-emerald-200 dark:border-emerald-900 bg-emerald-50/40 dark:bg-emerald-950/10",
        )}>
          <div className="flex items-center gap-1.5 mb-1">
            <ShieldCheck size={12} className={filed ? "text-emerald-600" : "text-muted-foreground"} />
            <span className="text-xs font-semibold">Filing</span>
          </div>
          {filed ? (
            <p className="text-[11px] text-muted-foreground">
              Marked filed by <span className="font-medium text-foreground">{correction.filed_by_name || "—"}</span>
              {correction.filed_at ? ` on ${format(new Date(correction.filed_at), "dd/MM/yyyy HH:mm")}` : ""}
              {correction.filing_reference ? ` · ref ${correction.filing_reference}` : ""}.
            </p>
          ) : (
            <p className="text-[11px] text-muted-foreground italic">
              Not filed. Both signatures authorise the correction; filing is confirmed manually once
              the return has actually been accepted by the department.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
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

/**
 * Mark as Filed — the deliberate, manual step. Signing authorised the
 * correction; this records that it was actually filed with the department, and
 * is what makes it permanently read-only.
 */
function MarkFiledDialog({ open, onOpenChange, correction, actor, onFiled, toast }: {
  open: boolean; onOpenChange: (v: boolean) => void;
  correction: Correction; actor: Actor; onFiled: () => void; toast: any;
}) {
  const [reference, setReference] = useState("");
  const [filedOn, setFiledOn] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) { setReference(""); setFiledOn(""); setConfirmed(false); }
  }, [open]);

  const go = async () => {
    setSaving(true);
    const err = await markCorrectionFiled(correction, actor, {
      reference: reference.trim() || undefined,
      // A date-only value is stored at local midnight; leaving it blank uses now.
      filedOn: filedOn ? new Date(filedOn).toISOString() : undefined,
    });
    setSaving(false);
    if (err) { toast({ title: "Could not mark as filed", description: err, variant: "destructive" }); return; }
    toast({ title: "Correction filed", description: "It is now locked and read-only." });
    onFiled();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><CheckCircle2 size={16} /> Mark as Filed</DialogTitle>
          <DialogDescription>
            Confirm the correction return has actually been filed with the Income Tax Department.
            This locks it permanently — it cannot be undone.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="rounded-md border bg-muted/40 p-3 text-xs space-y-1">
            <p><span className="text-muted-foreground">Signed by:</span> {correction.prepared_by_name || "—"} (preparer)</p>
            <p><span className="text-muted-foreground">Approved by:</span> {correction.approved_by_name || "—"} (senior)</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Filed on</Label>
              <Input type="date" className="h-9 text-xs" value={filedOn} onChange={e => setFiledOn(e.target.value)} />
              <p className="text-[10px] text-muted-foreground">Leave blank for now.</p>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Acknowledgement no.</Label>
              <Input className="h-9 text-xs" value={reference} onChange={e => setReference(e.target.value)} placeholder="Optional" />
            </div>
          </div>

          <label className="flex items-start gap-2 text-xs cursor-pointer">
            <input type="checkbox" className="mt-0.5" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />
            <span>I confirm this correction return has been filed with the Income Tax Department.</span>
          </label>
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button size="sm" className="gap-1.5" disabled={!confirmed || saving} onClick={go}>
            <CheckCircle2 size={14} /> {saving ? "Filing…" : "Confirm Filed"}
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
