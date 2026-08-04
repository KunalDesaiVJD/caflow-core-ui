/**
 * PortalCorrections — client-facing Correction tab.
 *
 * A client may:
 *   • see the corrections raised for THEIR OWN entities, and nothing else
 *   • raise a correction against one of their own filed returns
 *   • edit and submit it while it is still draft / pending
 *
 * A client may NOT sign a correction — the firm's signature is what files it —
 * and a filed correction is read-only here exactly as it is on the staff side.
 *
 * Isolation is enforced in RLS (supabase/migrations/20260729170000): clients
 * reach only rows whose client_id is in portal_client_ids(), a RESTRICTIVE
 * policy caps every command to their own rows, and the signing columns are
 * blocked from client writes. The client_id scoping in the queries below is
 * for correctness and speed, NOT the security boundary.
 */
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { usePortalClient } from "@/contexts/PortalClientContext";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
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
  FileEdit, Plus, ArrowLeft, Landmark, ShieldCheck, Lock, CheckCircle2, XCircle, Trash2, RotateCcw, FileText,
} from "lucide-react";
import {
  CORRECTION_STATUS_META, isCorrectionLocked, createCorrection,
  loadCorrectionDetail, submitCorrection, summariseCorrection, logCorrectionAction,
  type Correction, type CorrectionStatus, type CorrectionChallan,
  type CorrectionDeductee, type CorrectionAction, type Actor,
} from "@/lib/tdsCorrections";

const money = (n: number | null | undefined) =>
  n == null ? "—" : new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(n);

const shortDate = (d: string | null | undefined) => {
  if (!d) return "—";
  const p = new Date(d);
  return isNaN(p.getTime()) ? "—" : format(p, "dd/MM/yyyy");
};

const ACTION_TONE: Record<CorrectionAction, string> = {
  unchanged: "",
  add: "bg-emerald-50",
  modify: "bg-amber-50",
  delete: "bg-red-50 line-through opacity-60",
};
const ACTION_LABEL: Record<CorrectionAction, string> = {
  unchanged: "", add: "Added", modify: "Modified", delete: "Deleted",
};

function StatusBadge({ status }: { status: string }) {
  const meta = CORRECTION_STATUS_META[status as CorrectionStatus] ?? CORRECTION_STATUS_META.draft;
  return (
    <Badge className={cn("gap-1 text-[11px]", meta.tone)}>
      {status === "filed" && <CheckCircle2 size={11} />}
      {status === "rejected" && <XCircle size={11} />}
      {meta.label}
    </Badge>
  );
}

// ═══════════════════════════════════════════════════════════════════════════

export default function PortalCorrections() {
  const { activeClient, loading: clientLoading } = usePortalClient();
  const { user } = useAuth();
  const { toast } = useToast();

  const clientId = activeClient?.id ?? null;
  const firmId = activeClient?.firm_id ?? null;

  const actor: Actor = useMemo(() => ({
    id: user?.id ?? null,
    name: activeClient?.name || user?.name || user?.email || null,
    role: "client",
  }), [user?.id, user?.name, user?.email, activeClient?.name]);

  const [rows, setRows] = useState<Correction[]>([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);

  const fetchRows = useCallback(async (opts?: { silent?: boolean }) => {
    if (!clientId) { setRows([]); setLoading(false); return; }
    if (!opts?.silent) setLoading(true);
    const { data } = await supabase.from("tds_corrections" as any)
      .select("*").eq("client_id", clientId);
    setRows(((data || []) as unknown as Correction[]).slice()
      .sort((a, b) => (b.raised_at || "").localeCompare(a.raised_at || "")));
    setLoading(false);
  }, [clientId]);

  useEffect(() => { fetchRows(); }, [fetchRows]);

  // Live, so a firm signature flips this to "Correction Filed" without a reload.
  const refreshRef = useRef<() => void>(() => {});
  refreshRef.current = () => fetchRows({ silent: true });

  useEffect(() => {
    if (!clientId) return;
    const ch = supabase
      .channel(`portal-corrections-${clientId}`)
      .on("postgres_changes",
        { event: "*", schema: "public", table: "tds_corrections", filter: `client_id=eq.${clientId}` },
        () => refreshRef.current())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [clientId]);

  if (clientLoading || loading) {
    return <div className="space-y-4"><Skeleton className="h-8 w-48" /><Skeleton className="h-40 w-full" /></div>;
  }

  if (openId) {
    return (
      <PortalCorrectionDetail
        correctionId={openId} clientName={activeClient?.name || "—"} actor={actor}
        onBack={() => { setOpenId(null); fetchRows({ silent: true }); }} toast={toast}
      />
    );
  }

  return (
    <div className="space-y-5">
      {/* Sub-tab header. The page title lives on the TDS module shell
          (PortalTdsModule) — this row only carries what is specific to the
          Correction tab. */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <p className="text-sm text-muted-foreground">
          Raise a correction against a TDS return already filed. Your CA firm reviews and signs it.
        </p>
        <Button size="sm" className="gap-1.5 shrink-0" onClick={() => setNewOpen(true)}>
          <Plus size={14} /> Raise Correction
        </Button>
      </div>

      {rows.length === 0 ? (
        <Card><CardContent className="p-10 text-center text-sm text-muted-foreground">
          No corrections yet. Use Raise Correction if something in a filed return needs fixing.
        </CardContent></Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="text-xs">Period</TableHead>
                    <TableHead className="text-xs">Reason</TableHead>
                    <TableHead className="text-xs">Status</TableHead>
                    <TableHead className="text-xs">Raised</TableHead>
                    <TableHead className="text-xs">Signed by</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map(r => (
                    <TableRow
                      key={r.id}
                      className="cursor-pointer h-10"
                      onClick={() => setOpenId(r.id)}
                      title="Open correction"
                    >
                      <TableCell className="text-xs py-1.5 whitespace-nowrap">
                        <span className="font-medium">{r.form_type}</span>
                        <span className="text-muted-foreground"> · {r.quarter} {r.financial_year}</span>
                      </TableCell>
                      <TableCell className="text-xs py-1.5 max-w-[280px] truncate text-muted-foreground">
                        {r.reason || "—"}
                      </TableCell>
                      <TableCell className="py-1.5"><StatusBadge status={r.status} /></TableCell>
                      <TableCell className="text-xs py-1.5 whitespace-nowrap">{shortDate(r.raised_at)}</TableCell>
                      <TableCell className="text-xs py-1.5 whitespace-nowrap">{r.approved_by_name || r.signed_by_name || "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      <RaiseCorrectionDialog
        open={newOpen} onOpenChange={setNewOpen}
        clientId={clientId} firmId={firmId} actor={actor} toast={toast}
        onCreated={(id) => { setNewOpen(false); fetchRows({ silent: true }); setOpenId(id); }}
      />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Raise — only against this entity's own filed returns
// ═══════════════════════════════════════════════════════════════════════════

function RaiseCorrectionDialog({
  open, onOpenChange, clientId, firmId, actor, toast, onCreated,
}: {
  open: boolean; onOpenChange: (v: boolean) => void;
  clientId: string | null; firmId: string | null; actor: Actor; toast: any;
  onCreated: (id: string) => void;
}) {
  const [filings, setFilings] = useState<any[]>([]);
  const [openPeriods, setOpenPeriods] = useState<Set<string>>(new Set());
  const [pick, setPick] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !clientId) return;
    setPick(""); setReason("");
    // Only this entity's own filings — RLS would block anything else anyway.
    Promise.all([
      supabase.from("tds_filings")
        .select("id, financial_year, quarter, tds_forms, work_status")
        .eq("client_id", clientId),
      // Sequencing gate (firm instruction, 2026-08-04): a period already
      // holding an open (non-filed, non-rejected) correction isn't offered
      // again — same rule TdsCorrectionsModule enforces, and the DB backstops
      // via trg_tds_corrections_sequencing_guard (20260804180500).
      supabase.from("tds_corrections" as any)
        .select("financial_year, quarter, form_type")
        .eq("client_id", clientId).not("status", "in", "(filed,rejected)"),
    ]).then(([{ data: f }, { data: open }]) => {
      setFilings((f || []) as any[]);
      setOpenPeriods(new Set(((open || []) as any[]).map(c => `${c.financial_year}|${c.quarter}|${c.form_type}`)));
    });
  }, [open, clientId]);

  // One option per (filing × form), since a correction targets a single form —
  // only for a Processed return, and only when no correction is already open
  // for that exact period (see the fetch above).
  const options = useMemo(() => filings.flatMap(f =>
    f.work_status === "Processed" ? ((f.tds_forms || []) as string[]).map(form => ({
      key: `${f.id}::${form}`,
      filingId: f.id, form,
      fy: f.financial_year, quarter: f.quarter,
      label: `${form} · ${f.quarter} ${f.financial_year}`,
    })) : []
  ).filter(o => !openPeriods.has(`${o.fy}|${o.quarter}|${o.form}`))
    .sort((a, b) => b.fy.localeCompare(a.fy) || a.quarter.localeCompare(b.quarter)), [filings, openPeriods]);

  const chosen = options.find(o => o.key === pick) || null;

  const create = async () => {
    if (!chosen || !clientId || !firmId) return;
    setSaving(true);
    const { correction, error } = await createCorrection({
      firmId, clientId,
      financialYear: chosen.fy, quarter: chosen.quarter, formType: chosen.form,
      filingId: chosen.filingId, reason, actor,
    });
    setSaving(false);
    if (error || !correction) {
      toast({ title: "Could not raise correction", description: error, variant: "destructive" });
      return;
    }
    toast({ title: "Correction started", description: "Edit the entries, then submit it to your firm." });
    onCreated(correction.id);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Raise a correction</DialogTitle>
          <DialogDescription>
            Pick the filed return that needs fixing. Its data is copied in for you to edit — the
            original filing is not changed.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">Filed return</Label>
            <Select value={pick} onValueChange={setPick}>
              <SelectTrigger className="h-9"><SelectValue placeholder="Select a filed return" /></SelectTrigger>
              <SelectContent>
                {options.map(o => <SelectItem key={o.key} value={o.key}>{o.label}</SelectItem>)}
              </SelectContent>
            </Select>
            {options.length === 0 && (
              <p className="text-xs text-muted-foreground">No filed returns are available for this entity.</p>
            )}
          </div>
          <div className="space-y-1">
            <Label className="text-xs">What needs correcting?</Label>
            <Textarea
              value={reason} onChange={e => setReason(e.target.value)}
              placeholder="e.g. The PAN reported for one vendor is wrong"
              className="text-xs min-h-[70px]"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button size="sm" disabled={!chosen || !reason.trim() || saving} onClick={create}>
            {saving ? "Starting…" : "Start Correction"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Detail
// ═══════════════════════════════════════════════════════════════════════════

function PortalCorrectionDetail({ correctionId, clientName, actor, onBack, toast }: {
  correctionId: string; clientName: string; actor: Actor; onBack: () => void; toast: any;
}) {
  const [correction, setCorrection] = useState<Correction | null>(null);
  const [challans, setChallans] = useState<CorrectionChallan[]>([]);
  const [deductees, setDeductees] = useState<CorrectionDeductee[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [editRow, setEditRow] = useState<CorrectionDeductee | null>(null);
  const [addTo, setAddTo] = useState<CorrectionChallan | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from("tds_corrections" as any)
      .select("*").eq("id", correctionId).maybeSingle();
    const head = (data as unknown as Correction) || null;
    setCorrection(head);
    if (head) {
      const d = await loadCorrectionDetail(correctionId);
      setChallans(d.challans); setDeductees(d.deductees);
    }
    setLoading(false);
  }, [correctionId]);

  useEffect(() => { load(); }, [load]);

  const locked = isCorrectionLocked(correction?.status);
  const delta = useMemo(() => summariseCorrection(challans, deductees), [challans, deductees]);

  const byChallan = useMemo(() => {
    const m = new Map<string, CorrectionDeductee[]>();
    for (const d of deductees) {
      const k = d.correction_challan_id || "__unlinked__";
      const l = m.get(k); if (l) l.push(d); else m.set(k, [d]);
    }
    return m;
  }, [deductees]);

  const markDeleted = async (d: CorrectionDeductee) => {
    if (locked || !correction) return;
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
    setBusy(false); load();
  };

  const restore = async (d: CorrectionDeductee) => {
    if (locked || !correction) return;
    setBusy(true);
    await supabase.from("tds_correction_deductees" as any)
      .update({ action: "unchanged", updated_at: new Date().toISOString() }).eq("id", d.id);
    setBusy(false); load();
  };

  const submit = async () => {
    if (!correction) return;
    setBusy(true);
    const err = await submitCorrection(correction, actor);
    setBusy(false);
    if (err) { toast({ title: "Could not submit", description: err, variant: "destructive" }); return; }
    toast({ title: "Sent to your firm", description: "Your firm will review and sign it." });
    load();
  };

  if (loading) return <div className="space-y-3"><Skeleton className="h-9 w-40" /><Skeleton className="h-64 w-full" /></div>;

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

      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2 flex-wrap">
            {clientName}
            <span className="text-muted-foreground font-normal text-base">
              {correction.form_type} · {correction.quarter} {correction.financial_year}
            </span>
            <StatusBadge status={correction.status} />
          </h1>
          {correction.reason && <p className="text-sm text-muted-foreground mt-0.5">{correction.reason}</p>}
        </div>
        {!locked && (correction.status === "draft" || correction.status === "rejected") && (
          <Button size="sm" disabled={busy} onClick={submit}>
            {correction.status === "rejected" ? "Re-submit to firm" : "Submit to firm"}
          </Button>
        )}
      </div>

      {locked && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 flex items-start gap-2.5">
          <ShieldCheck size={18} className="text-emerald-600 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-emerald-800 flex items-center gap-1.5">
              Correction Filed <Lock size={12} />
            </p>
            <p className="text-xs text-emerald-700">
              Signed by {correction.approved_by_name || correction.signed_by_name || "your firm"}
              {(correction.approved_at || correction.signed_at)
                ? ` on ${format(new Date(correction.approved_at || correction.signed_at || ""), "dd/MM/yyyy HH:mm")}`
                : ""}.
              This is now read-only.
            </p>
          </div>
        </div>
      )}

      {(correction.status === "awaiting_employee" || correction.status === "awaiting_senior") && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          Submitted to your firm. You will see it marked <strong>Correction Filed</strong> once they sign it.
        </div>
      )}

      {correction.status === "rejected" && correction.rejection_reason && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3">
          <p className="text-sm font-semibold text-red-800">Sent back by your firm</p>
          <p className="text-xs text-red-700">{correction.rejection_reason}</p>
        </div>
      )}

      <div className="grid grid-cols-3 gap-3">
        {([["Added", delta.added], ["Modified", delta.modified], ["Deleted", delta.deleted]] as const).map(([l, n]) => (
          <Card key={l}><CardContent className="p-3">
            <p className="text-xs text-muted-foreground">{l}</p>
            <p className="text-2xl font-bold">{n}</p>
          </CardContent></Card>
        ))}
      </div>

      {challans.length === 0 && deductees.length === 0 ? (
        <Card>
          <CardContent className="p-10 text-center text-sm text-muted-foreground">
            No challans or entries were captured for this correction.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {challans.map(c => (
            <Card key={c.id}>
              <CardHeader className="py-3">
                <CardTitle className="text-sm flex items-center gap-2 flex-wrap">
                  <Landmark size={14} className="text-amber-600 shrink-0" />
                  Challan {c.challan_serial_no || "—"}
                  <span className="text-xs font-normal text-muted-foreground">{shortDate(c.deposit_date)}</span>
                  <div className="flex-1" />
                  <span className="text-xs font-normal text-muted-foreground">₹{money(c.total_challan_amount)}</span>
                  {!locked && (
                    <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs" onClick={() => setAddTo(c)}>
                      <Plus size={12} /> Entry
                    </Button>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <PortalEntryTable
                  rows={byChallan.get(c.id) || []} form={correction.form_type} locked={locked}
                  onEdit={setEditRow} onDelete={markDeleted} onRestore={restore}
                />
              </CardContent>
            </Card>
          ))}

          {/* Entries not linked to any challan in this correction — previously
              computed into byChallan's "__unlinked__" bucket but never
              rendered anywhere, so they existed in the Added/Modified/Deleted
              counts above yet were invisible in the body below. */}
          {(byChallan.get("__unlinked__") || []).length > 0 && (
            <Card>
              <CardHeader className="py-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <FileText size={14} className="text-muted-foreground" />
                  Not linked to a challan
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <PortalEntryTable
                  rows={byChallan.get("__unlinked__") || []} form={correction.form_type} locked={locked}
                  onEdit={setEditRow} onDelete={markDeleted} onRestore={restore}
                />
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Signature — clients never sign; this shows the firm's */}
      <Card className={cn(locked && "border-emerald-200")}>
        <CardHeader className="py-3"><CardTitle className="text-sm">Signature</CardTitle></CardHeader>
        <CardContent className="pt-0">
          {locked ? (
            <div className="space-y-1">
              <div className="border-b border-foreground/40 w-56 pb-1">
                <p className="font-semibold text-sm">{correction.approved_by_name || correction.signed_by_name || "—"}</p>
              </div>
              <p className="text-xs text-muted-foreground">
                {correction.approved_by_role || correction.signed_by_role || "Authorised signatory"}
                {(correction.approved_at || correction.signed_at)
                  ? ` · ${format(new Date(correction.approved_at || correction.signed_at || ""), "dd/MM/yyyy HH:mm")}`
                  : ""}
              </p>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              Awaiting your firm's signature. Their signature is what files the correction.
            </p>
          )}
        </CardContent>
      </Card>

      <PortalEntryDialog
        open={!!editRow || !!addTo}
        row={editRow} challan={addTo} correction={correction} actor={actor}
        onClose={() => { setEditRow(null); setAddTo(null); }}
        onSaved={() => { setEditRow(null); setAddTo(null); load(); }}
        toast={toast}
      />
    </div>
  );
}

function PortalEntryTable({ rows, form, locked, onEdit, onDelete, onRestore }: {
  rows: CorrectionDeductee[]; form: string; locked: boolean;
  onEdit: (d: CorrectionDeductee) => void;
  onDelete: (d: CorrectionDeductee) => void;
  onRestore: (d: CorrectionDeductee) => void;
}) {
  if (rows.length === 0) return <p className="text-xs text-muted-foreground py-2">No entries under this challan.</p>;
  const isSalary = form === "24Q";

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="text-xs w-20">Change</TableHead>
            <TableHead className="text-xs">{isSalary ? "Employee" : "Name"}</TableHead>
            <TableHead className="text-xs">PAN</TableHead>
            <TableHead className="text-xs">Section</TableHead>
            <TableHead className="text-xs text-right">Amount</TableHead>
            <TableHead className="text-xs text-right">TDS</TableHead>
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
              <TableCell className="text-xs">{d.section_code || "—"}</TableCell>
              <TableCell className="text-xs text-right">
                {money(isSalary ? d.gross_salary : d.amount_paid_credited)}
              </TableCell>
              <TableCell className="text-xs text-right">{money(d.total_tax_deducted ?? d.tds_amount)}</TableCell>
              {!locked && (
                <TableCell>
                  <div className="flex items-center gap-0.5">
                    {d.action === "delete" ? (
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0" title="Restore" onClick={() => onRestore(d)}>
                        <RotateCcw size={12} />
                      </Button>
                    ) : (
                      <>
                        <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px]" onClick={() => onEdit(d)}>Edit</Button>
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-red-600" title="Remove" onClick={() => onDelete(d)}>
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

function PortalEntryDialog({ open, row, challan, correction, actor, onClose, onSaved, toast }: {
  open: boolean; row: CorrectionDeductee | null; challan: CorrectionChallan | null;
  correction: Correction; actor: Actor; onClose: () => void; onSaved: () => void; toast: any;
}) {
  const isSalary = correction.form_type === "24Q";
  const [f, setF] = useState<Record<string, any>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setF(row ? { ...row } : {
      deductee_name: "", deductee_pan: "", section_code: "",
      amount_paid_credited: "", date_of_payment: "", tds_amount: "",
      gross_salary: "", net_taxable_salary: "", remarks: "",
    });
  }, [open, row]);

  const set = (k: string, v: any) => setF(p => ({ ...p, [k]: v }));
  const num = (v: any) => (v === "" || v == null ? null : Number(v));

  const save = async () => {
    setSaving(true);
    const payload: Record<string, any> = {
      deductee_name: f.deductee_name || null,
      deductee_pan: f.deductee_pan || null,
      section_code: f.section_code || null,
      amount_paid_credited: num(f.amount_paid_credited),
      date_of_payment: f.date_of_payment || null,
      tds_amount: num(f.tds_amount),
      total_tax_deducted: num(f.tds_amount),
      gross_salary: num(f.gross_salary),
      net_taxable_salary: num(f.net_taxable_salary),
      remarks: f.remarks || null,
      updated_at: new Date().toISOString(),
    };

    let err: string | null = null;
    if (row) {
      const { error } = await supabase.from("tds_correction_deductees" as any)
        .update({ ...payload, action: row.action === "add" ? "add" : "modify" }).eq("id", row.id);
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
    if (err) { toast({ title: "Could not save", description: err, variant: "destructive" }); return; }
    await logCorrectionAction({
      correctionId: correction.id, firmId: correction.firm_id, clientId: correction.client_id,
      actionType: row ? "ENTRY_MODIFIED" : "ENTRY_ADDED", detail: f.deductee_name || "—", actor,
    });
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{row ? "Edit entry" : "Add entry"}</DialogTitle>
          <DialogDescription>Your firm reviews every change before it is filed.</DialogDescription>
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
            </>
          )}
          <div className="space-y-1">
            <Label className="text-xs">TDS amount</Label>
            <Input type="number" className="h-9 text-xs" value={f.tds_amount ?? ""} onChange={e => set("tds_amount", e.target.value)} />
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
