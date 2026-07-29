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
 */
import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
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
  Search, Plus, ArrowLeft, PenTool, Trash2, Pencil, RotateCcw,
  CheckCircle2, XCircle, Landmark, ShieldCheck, Lock,
} from "lucide-react";
import { isFilingTdsCompliant } from "@/lib/tdsQuarter";
import {
  CORRECTION_STATUS_META, isCorrectionLocked, createCorrection,
  loadCorrectionDetail, submitCorrection, signAndFileCorrection,
  rejectCorrection, summariseCorrection, logCorrectionAction,
  type Correction, type CorrectionStatus, type CorrectionChallan,
  type CorrectionDeductee, type CorrectionAction, type Actor,
} from "@/lib/tdsCorrections";

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

const ACTION_TONE: Record<CorrectionAction, string> = {
  unchanged: "",
  add: "bg-emerald-50 dark:bg-emerald-950/20",
  modify: "bg-amber-50 dark:bg-amber-950/20",
  delete: "bg-red-50 dark:bg-red-950/20 line-through opacity-60",
};
const ACTION_LABEL: Record<CorrectionAction, string> = {
  unchanged: "", add: "Added", modify: "Modified", delete: "Deleted",
};

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
    const all = ((data || []) as unknown as Correction[])
      .slice()
      .sort((a, b) => (b.raised_at || "").localeCompare(a.raised_at || ""));
    setRows(all);
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

  const counts = useMemo(() => ({
    draft: rows.filter(r => r.status === "draft").length,
    pending: rows.filter(r => r.status === "pending").length,
    filed: rows.filter(r => r.status === "filed").length,
    rejected: rows.filter(r => r.status === "rejected").length,
  }), [rows]);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-xl font-bold text-foreground">Corrections</h2>
          <p className="text-sm text-muted-foreground">
            Revise TDS data already filed for an earlier quarter or financial year. The original filed
            data is never changed — each correction is kept as a separate version.
          </p>
        </div>
        <Button size="sm" className="gap-1.5 shrink-0" onClick={() => setNewOpen(true)}>
          <Plus size={14} /> New Correction
        </Button>
      </div>

      {/* Status tiles double as quick filters */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {(["draft", "pending", "filed", "rejected"] as CorrectionStatus[]).map(s => (
          <button
            key={s}
            onClick={() => setFStatus(fStatus === s ? "all" : s)}
            className={cn(
              "text-left rounded-lg border p-3 transition-colors hover:bg-muted/50",
              fStatus === s && "ring-2 ring-primary",
            )}
          >
            <p className="text-xs text-muted-foreground">{CORRECTION_STATUS_META[s].label}</p>
            {/* div, not p — Skeleton renders a div and cannot nest inside a p */}
            <div className="text-2xl font-bold">{loading ? <Skeleton className="h-7 w-10" /> : counts[s]}</div>
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-end">
        <div className="space-y-1">
          <Label className="text-xs">Search</Label>
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Client, reason, person…" className="h-9 w-[220px] pl-8 text-xs"
            />
          </div>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Client</Label>
          <Select value={fClient} onValueChange={setFClient}>
            <SelectTrigger className="w-[180px] h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Clients</SelectItem>
              {clients.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Financial Year</Label>
          <Select value={fFy} onValueChange={setFFy}>
            <SelectTrigger className="w-[130px] h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All FYs</SelectItem>
              {FY_OPTIONS.map(f => <SelectItem key={f} value={f}>{f}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Quarter</Label>
          <Select value={fQuarter} onValueChange={setFQuarter}>
            <SelectTrigger className="w-[110px] h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              {QUARTERS.map(q => <SelectItem key={q} value={q}>{q}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Status</Label>
          <Select value={fStatus} onValueChange={setFStatus}>
            <SelectTrigger className="w-[150px] h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              {(["draft", "pending", "filed", "rejected"] as CorrectionStatus[]).map(s => (
                <SelectItem key={s} value={s}>{CORRECTION_STATUS_META[s].label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">From</Label>
          <Input type="date" className="w-[140px] h-9" value={fFrom} onChange={e => setFFrom(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">To</Label>
          <Input type="date" className="w-[140px] h-9" value={fTo} onChange={e => setFTo(e.target.value)} />
        </div>
      </div>

      {/* List */}
      {loading ? (
        <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}</div>
      ) : filtered.length === 0 ? (
        <Card><CardContent className="p-10 text-center text-sm text-muted-foreground">
          {rows.length === 0
            ? "No corrections raised yet. Use New Correction to revise a filed return."
            : "No corrections match these filters."}
        </CardContent></Card>
      ) : (
        <div className="rounded-md border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">Client</TableHead>
                <TableHead className="text-xs">Period</TableHead>
                <TableHead className="text-xs">Form</TableHead>
                <TableHead className="text-xs">Status</TableHead>
                <TableHead className="text-xs">Raised by</TableHead>
                <TableHead className="text-xs">Raised on</TableHead>
                <TableHead className="text-xs">Signed by</TableHead>
                <TableHead className="text-xs w-16"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map(r => (
                <TableRow key={r.id} className="cursor-pointer" onClick={() => onOpen(r.id)}>
                  <TableCell className="text-xs font-medium">{clientMap[r.client_id] || "—"}</TableCell>
                  <TableCell className="text-xs">{r.quarter} {r.financial_year}</TableCell>
                  <TableCell className="text-xs">{r.form_type}</TableCell>
                  <TableCell><CorrectionStatusBadge status={r.status} /></TableCell>
                  <TableCell className="text-xs">
                    {r.raised_by_name || (r.raised_by ? userMap[r.raised_by] : null) || "—"}
                    {r.raised_by_role === "client" && (
                      <Badge variant="outline" className="ml-1 text-[9px]">Client</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-xs">{shortDate(r.raised_at)}</TableCell>
                  <TableCell className="text-xs">{r.signed_by_name || "—"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">Open</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
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
// New correction — pick the filed period, preview it, create
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

  // Look up the filed return for the chosen period and show what will be
  // copied in, so the user knows there is something to correct before starting.
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
  // Same TDS Compliance gate the rest of the module applies.
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
                <SelectContent>
                  {FY_OPTIONS.map(f => <SelectItem key={f} value={f}>{f}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Quarter</Label>
              <Select value={quarter} onValueChange={setQuarter}>
                <SelectTrigger className="h-9"><SelectValue placeholder="Q" /></SelectTrigger>
                <SelectContent>
                  {QUARTERS.map(q => <SelectItem key={q} value={q}>{q}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Form</Label>
              <Select value={form} onValueChange={setForm}>
                <SelectTrigger className="h-9"><SelectValue placeholder="Form" /></SelectTrigger>
                <SelectContent>
                  {FORMS.map(f => <SelectItem key={f} value={f}>{f}</SelectItem>)}
                </SelectContent>
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
            <p className="text-xs text-red-600">
              No filed return found for {form} · {quarter} {fy} for this client. A correction can only
              revise data that has already been filed.
            </p>
          )}

          {!compliant && (
            <p className="text-xs text-red-600">
              This period is outside the client's TDS Compliance range.
            </p>
          )}

          {preview && (
            <div className="rounded-md border bg-muted/40 p-2.5 text-xs">
              Will copy in <span className="font-semibold">{preview.challans}</span> challan
              {preview.challans === 1 ? "" : "s"} and{" "}
              <span className="font-semibold">{preview.deductees}</span> entr
              {preview.deductees === 1 ? "y" : "ies"}.
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
// Correction detail — edit, submit, sign
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
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [editRow, setEditRow] = useState<CorrectionDeductee | null>(null);
  const [addToChallan, setAddToChallan] = useState<CorrectionChallan | null>(null);
  const [editChallan, setEditChallan] = useState<CorrectionChallan | null>(null);
  const [signOpen, setSignOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from("tds_corrections" as any)
      .select("*").eq("id", correctionId).maybeSingle();
    const head = (data as unknown as Correction) || null;
    setCorrection(head);
    if (head) {
      const detail = await loadCorrectionDetail(correctionId);
      setChallans(detail.challans);
      setDeductees(detail.deductees);
    }
    setLoading(false);
  }, [correctionId]);

  useEffect(() => { load(); }, [load]);

  const locked = isCorrectionLocked(correction?.status);
  const clientName = clients.find(c => c.id === correction?.client_id)?.name || "—";
  const delta = useMemo(() => summariseCorrection(challans, deductees), [challans, deductees]);

  const byChallan = useMemo(() => {
    const m = new Map<string, CorrectionDeductee[]>();
    for (const d of deductees) {
      const k = d.correction_challan_id || "__unlinked__";
      const l = m.get(k); if (l) l.push(d); else m.set(k, [d]);
    }
    return m;
  }, [deductees]);

  // ── Row actions ───────────────────────────────────────────────────────────
  const markDeleted = async (d: CorrectionDeductee) => {
    if (locked || !correction) return;
    setBusy(true);
    // An entry that only exists in this correction is removed outright; one
    // that came from the filed return is marked deleted so the correction can
    // still show what was removed.
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
    if (locked || !correction) return;
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
    return <div className="space-y-3"><Skeleton className="h-9 w-40" /><Skeleton className="h-32 w-full" /><Skeleton className="h-64 w-full" /></div>;
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

  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" className="gap-1.5 -ml-2" onClick={onBack}>
        <ArrowLeft size={14} /> All corrections
      </Button>

      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-xl font-bold text-foreground flex items-center gap-2 flex-wrap">
            {clientName}
            <span className="text-muted-foreground font-normal text-base">
              {correction.form_type} · {correction.quarter} {correction.financial_year}
            </span>
            <CorrectionStatusBadge status={correction.status} />
          </h2>
          {correction.reason && (
            <p className="text-sm text-muted-foreground mt-0.5">{correction.reason}</p>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {!locked && correction.status === "draft" && (
            <Button size="sm" variant="outline" disabled={busy} onClick={doSubmit}>Submit for filing</Button>
          )}
          {!locked && correction.status === "pending" && (
            <>
              <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setRejectOpen(true)}>
                <XCircle size={14} /> Reject
              </Button>
              <Button size="sm" className="gap-1.5" onClick={() => setSignOpen(true)}>
                <PenTool size={14} /> Sign &amp; File
              </Button>
            </>
          )}
          {!locked && correction.status === "rejected" && (
            <Button size="sm" variant="outline" disabled={busy} onClick={doSubmit}>Re-submit</Button>
          )}
        </div>
      </div>

      {/* Filed banner — the clear, module-wide "this is done" indicator */}
      {locked && (
        <div className="rounded-lg border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/20 p-3 flex items-start gap-2.5">
          <ShieldCheck size={18} className="text-emerald-600 shrink-0 mt-0.5" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-emerald-800 dark:text-emerald-300 flex items-center gap-1.5">
              Correction Filed <Lock size={12} />
            </p>
            <p className="text-xs text-emerald-700 dark:text-emerald-400">
              Signed by {correction.signed_by_name || "—"}
              {correction.signed_by_role ? ` (${correction.signed_by_role})` : ""}
              {correction.signed_at ? ` on ${format(new Date(correction.signed_at), "dd/MM/yyyy HH:mm")}` : ""}.
              This correction is now read-only.
            </p>
          </div>
        </div>
      )}

      {correction.status === "rejected" && correction.rejection_reason && (
        <div className="rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/20 p-3">
          <p className="text-sm font-semibold text-red-800 dark:text-red-300">Rejected</p>
          <p className="text-xs text-red-700 dark:text-red-400">{correction.rejection_reason}</p>
        </div>
      )}

      {/* What changed */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {([
          ["Added", delta.added], ["Modified", delta.modified],
          ["Deleted", delta.deleted], ["Challans changed", delta.challansTouched],
        ] as const).map(([label, n]) => (
          <Card key={label}><CardContent className="p-3">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="text-2xl font-bold">{n}</p>
          </CardContent></Card>
        ))}
      </div>

      {/* Challans + entries */}
      <div className="space-y-4">
        {challans.length === 0 && deductees.length === 0 ? (
          <Card><CardContent className="p-10 text-center text-sm text-muted-foreground">
            The filed return had no challans or entries to copy in.
          </CardContent></Card>
        ) : challans.map(c => (
          <Card key={c.id} className={cn(c.action !== "unchanged" && "border-amber-300 dark:border-amber-900")}>
            <CardHeader className="py-3">
              <CardTitle className="text-sm flex items-center gap-2 flex-wrap">
                <Landmark size={14} className="text-amber-600 shrink-0" />
                <span>
                  Challan {c.challan_serial_no || "—"}
                  {c.bsr_code ? ` · BSR ${c.bsr_code}` : ""}
                </span>
                <span className="text-xs font-normal text-muted-foreground">{shortDate(c.deposit_date)}</span>
                {c.action !== "unchanged" && (
                  <Badge variant="outline" className="text-[9px]">{ACTION_LABEL[c.action]}</Badge>
                )}
                <div className="flex-1" />
                <span className="text-xs font-normal text-muted-foreground">
                  ₹{money(c.total_challan_amount)}
                </span>
                {!locked && (
                  <>
                    <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs" onClick={() => setEditChallan(c)}>
                      <Pencil size={12} /> Challan
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs" onClick={() => setAddToChallan(c)}>
                      <Plus size={12} /> Entry
                    </Button>
                  </>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <EntryTable
                rows={byChallan.get(c.id) || []}
                form={correction.form_type}
                locked={locked}
                onEdit={setEditRow}
                onDelete={markDeleted}
                onRestore={restoreRow}
              />
            </CardContent>
          </Card>
        ))}

        {(byChallan.get("__unlinked__") || []).length > 0 && (
          <Card>
            <CardHeader className="py-3"><CardTitle className="text-sm">Not linked to a challan</CardTitle></CardHeader>
            <CardContent className="pt-0">
              <EntryTable
                rows={byChallan.get("__unlinked__") || []}
                form={correction.form_type} locked={locked}
                onEdit={setEditRow} onDelete={markDeleted} onRestore={restoreRow}
              />
            </CardContent>
          </Card>
        )}
      </div>

      {/* Signature section — appears once the correction has been raised */}
      <SignatureSection correction={correction} />

      {/* Dialogs */}
      <EntryDialog
        open={!!editRow || !!addToChallan}
        row={editRow}
        challan={addToChallan}
        correction={correction}
        form={correction.form_type}
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

      <SignDialog
        open={signOpen} onOpenChange={setSignOpen}
        correction={correction} actor={actor} delta={delta}
        onSigned={() => { setSignOpen(false); load(); }}
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
// Entry table
// ═══════════════════════════════════════════════════════════════════════════

function EntryTable({ rows, form, locked, onEdit, onDelete, onRestore }: {
  rows: CorrectionDeductee[]; form: string; locked: boolean;
  onEdit: (d: CorrectionDeductee) => void;
  onDelete: (d: CorrectionDeductee) => void;
  onRestore: (d: CorrectionDeductee) => void;
}) {
  if (rows.length === 0) return <p className="text-xs text-muted-foreground py-2">No entries under this challan.</p>;
  const isSalary = form === "24Q";
  const isTcs = form === "27EQ";

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="text-xs w-20">Change</TableHead>
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
                <TableHead className="text-xs">Date</TableHead>
                <TableHead className="text-xs text-right">Rate%</TableHead>
                <TableHead className="text-xs text-right">{isTcs ? "TCS" : "TDS"}</TableHead>
              </>
            )}
            {!locked && <TableHead className="text-xs w-20"></TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map(d => (
            <TableRow key={d.id} className={ACTION_TONE[d.action]}>
              <TableCell className="text-xs">
                {d.action === "unchanged"
                  ? <span className="text-muted-foreground">—</span>
                  : <Badge variant="outline" className="text-[9px]">{ACTION_LABEL[d.action]}</Badge>}
              </TableCell>
              <TableCell className="text-xs font-medium">{d.deductee_name || "—"}</TableCell>
              <TableCell className="text-xs font-mono">
                {d.pan_not_available ? "PANNOTAVBL" : (d.deductee_pan || "—")}
              </TableCell>
              {isSalary ? (
                <>
                  <TableCell className="text-xs text-right">{money(d.gross_salary)}</TableCell>
                  <TableCell className="text-xs text-right">{money(d.net_taxable_salary)}</TableCell>
                  <TableCell className="text-xs text-right">{money(d.total_tax_deducted ?? d.tds_amount)}</TableCell>
                </>
              ) : (
                <>
                  <TableCell className="text-xs">{d.section_code || "—"}</TableCell>
                  <TableCell className="text-xs text-right">{money(d.amount_paid_credited)}</TableCell>
                  <TableCell className="text-xs">{shortDate(d.date_of_payment)}</TableCell>
                  <TableCell className="text-xs text-right">{d.rate_of_tds ?? "—"}</TableCell>
                  <TableCell className="text-xs text-right">{money(d.total_tax_deducted ?? d.tds_amount)}</TableCell>
                </>
              )}
              {!locked && (
                <TableCell>
                  <div className="flex items-center gap-0.5">
                    {d.action === "delete" ? (
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0" title="Restore" onClick={() => onRestore(d)}>
                        <RotateCcw size={12} />
                      </Button>
                    ) : (
                      <>
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0" title="Edit" onClick={() => onEdit(d)}>
                          <Pencil size={12} />
                        </Button>
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-red-600" title="Delete" onClick={() => onDelete(d)}>
                          <Trash2 size={12} />
                        </Button>
                      </>
                    )}
                  </div>
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Entry add / edit
// ═══════════════════════════════════════════════════════════════════════════

function EntryDialog({
  open, row, challan, correction, form, actor, onClose, onSaved, toast,
}: {
  open: boolean; row: CorrectionDeductee | null; challan: CorrectionChallan | null;
  correction: Correction; form: string; actor: Actor;
  onClose: () => void; onSaved: () => void; toast: any;
}) {
  const isSalary = form === "24Q";
  const [f, setF] = useState<Record<string, any>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setF(row ? { ...row } : {
      deductee_name: "", deductee_pan: "", deductee_type: "", section_code: "",
      amount_paid_credited: "", date_of_payment: "", rate_of_tds: "",
      tds_amount: "", total_tax_deducted: "", interest_amount: "",
      gross_salary: "", standard_deduction_allowed: "", net_taxable_salary: "",
      remarks: "",
    });
  }, [open, row]);

  const set = (k: string, v: any) => setF(p => ({ ...p, [k]: v }));
  const num = (v: any) => (v === "" || v == null ? null : Number(v));

  const save = async () => {
    setSaving(true);
    const payload: Record<string, any> = {
      deductee_name: f.deductee_name || null,
      deductee_pan: f.deductee_pan || null,
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
      remarks: f.remarks || null,
      updated_at: new Date().toISOString(),
    };

    let err: string | null = null;
    if (row) {
      // A row copied from the filed return becomes 'modify'; a row added in
      // this correction stays 'add'.
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
      <DialogContent className="max-w-lg">
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
            <Input className="h-9 text-xs" value={f.deductee_name ?? ""} onChange={e => set("deductee_name", e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">PAN</Label>
            <Input className="h-9 text-xs font-mono" value={f.deductee_pan ?? ""} onChange={e => set("deductee_pan", e.target.value.toUpperCase())} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Section</Label>
            <Input className="h-9 text-xs" value={f.section_code ?? ""} onChange={e => set("section_code", e.target.value)} />
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
                <Label className="text-xs">Rate %</Label>
                <Input type="number" step="0.01" className="h-9 text-xs" value={f.rate_of_tds ?? ""} onChange={e => set("rate_of_tds", e.target.value)} />
              </div>
            </>
          )}

          <div className="space-y-1">
            <Label className="text-xs">TDS amount</Label>
            <Input type="number" className="h-9 text-xs" value={f.tds_amount ?? ""} onChange={e => { set("tds_amount", e.target.value); set("total_tax_deducted", e.target.value); }} />
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

  const save = async () => {
    if (!challan) return;
    setSaving(true);
    const { error } = await supabase.from("tds_correction_challans" as any).update({
      bsr_code: f.bsr_code || null,
      challan_serial_no: f.challan_serial_no || null,
      deposit_date: f.deposit_date || null,
      total_tax_deposited: num(f.total_tax_deposited),
      interest_deposited: num(f.interest_deposited),
      late_fees_234e: num(f.late_fees_234e),
      total_challan_amount: num(f.total_challan_amount),
      minor_head_of_challan: f.minor_head_of_challan || null,
      bank_name: f.bank_name || null,
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
      <DialogContent className="max-w-lg">
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
            <Input className="h-9 text-xs" value={f.minor_head_of_challan ?? ""} onChange={e => set("minor_head_of_challan", e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Tax deposited</Label>
            <Input type="number" className="h-9 text-xs" value={f.total_tax_deposited ?? ""} onChange={e => set("total_tax_deposited", e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Interest</Label>
            <Input type="number" className="h-9 text-xs" value={f.interest_deposited ?? ""} onChange={e => set("interest_deposited", e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Late fee (234E)</Label>
            <Input type="number" className="h-9 text-xs" value={f.late_fees_234e ?? ""} onChange={e => set("late_fees_234e", e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Total challan amount</Label>
            <Input type="number" className="h-9 text-xs" value={f.total_challan_amount ?? ""} onChange={e => set("total_challan_amount", e.target.value)} />
          </div>
          <div className="space-y-1 col-span-2">
            <Label className="text-xs">Bank</Label>
            <Input className="h-9 text-xs" value={f.bank_name ?? ""} onChange={e => set("bank_name", e.target.value)} />
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

/** Sign-off block shown below the correction details once it has been raised. */
export function SignatureSection({ correction }: { correction: Correction }) {
  const signed = correction.status === "filed";
  return (
    <Card className={cn(signed && "border-emerald-200 dark:border-emerald-900")}>
      <CardHeader className="py-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <PenTool size={14} className={signed ? "text-emerald-600" : "text-muted-foreground"} />
          Signature
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {signed ? (
          <div className="space-y-1">
            <div className="border-b border-foreground/40 w-56 pb-1">
              <p className="font-semibold text-sm">{correction.signed_by_name || "—"}</p>
            </div>
            <p className="text-xs text-muted-foreground">
              {correction.signed_by_role || "Authorised signatory"}
              {correction.signed_at ? ` · ${format(new Date(correction.signed_at), "dd/MM/yyyy HH:mm")}` : ""}
            </p>
            <p className="text-xs text-emerald-700 dark:text-emerald-400 flex items-center gap-1 pt-1">
              <CheckCircle2 size={12} /> This signature filed the correction.
            </p>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            Not yet signed. A firm signature on this correction is what files it — once signed it
            becomes read-only.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function SignDialog({ open, onOpenChange, correction, actor, delta, onSigned, toast }: {
  open: boolean; onOpenChange: (v: boolean) => void;
  correction: Correction; actor: Actor; delta: ReturnType<typeof summariseCorrection>;
  onSigned: () => void; toast: any;
}) {
  const [confirmed, setConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (!open) setConfirmed(false); }, [open]);

  const sign = async () => {
    setSaving(true);
    const err = await signAndFileCorrection(correction, actor);
    setSaving(false);
    if (err) { toast({ title: "Could not file", description: err, variant: "destructive" }); return; }
    toast({ title: "Correction filed", description: "It is now signed and read-only." });
    onSigned();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><PenTool size={16} /> Sign &amp; File</DialogTitle>
          <DialogDescription>
            Your signature files this correction. Once signed it becomes permanently read-only —
            this cannot be undone.
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
            <input
              type="checkbox" className="mt-0.5"
              checked={confirmed} onChange={e => setConfirmed(e.target.checked)}
            />
            <span>
              I confirm these corrected particulars are true and correct, and I authorise this
              correction to be filed.
            </span>
          </label>
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button size="sm" className="gap-1.5" disabled={!confirmed || saving} onClick={sign}>
            <PenTool size={14} /> {saving ? "Filing…" : "Sign & File"}
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
