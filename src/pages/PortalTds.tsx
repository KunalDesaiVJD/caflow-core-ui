/**
 * PortalTds — client-facing, READ-ONLY mirror of the TDS Workspace's Data
 * Entry tab.
 *
 * Scope is deliberately narrow: challans and the deductee rows under them, for
 * the ONE entity currently selected in the portal's entity switcher. None of
 * the Validate & Finalise machinery (reconciliation verdicts, PAN
 * verification, Tally matching, override reasons) and none of the internal
 * workflow fields (preparer / checker / approver) are surfaced here.
 *
 * ISOLATION IS NOT ENFORCED BY THIS FILE. Every query below is scoped to
 * activeClient.id, but that is a UX nicety, not the security boundary — a
 * portal user can call the REST API directly. The real guarantee lives in
 * supabase/migrations/20260729160000_tds_portal_readonly_rls.sql, which
 * restricts role='client' to SELECT on their own client_id across
 * tds_filings / tds_challans / tds_deductees and blocks them from every other
 * TDS table and from all writes.
 *
 * Read-only means read-only: this component issues no insert/update/delete
 * and renders no editable control.
 *
 * LIVE: staff edits on the Data Entry screen land in tds_challans /
 * tds_deductees, so this page subscribes to postgres_changes on those two
 * tables plus tds_filings, filtered to the active entity, and refetches
 * silently on every event. Realtime evaluates RLS per subscriber, so a client
 * is only ever notified about their own rows. Focus/visibility/bfcache
 * refetches and a 45s poll cover networks where WebSockets are blocked —
 * mirroring the staff module's fallbacks in src/pages/TdsFilings.tsx.
 * Requires supabase/migrations/20260729161000_tds_data_entry_realtime.sql
 * (publication + REPLICA IDENTITY FULL for the two Data Entry tables).
 */
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { usePortalClient } from "@/contexts/PortalClientContext";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { format } from "date-fns";
import { Receipt, Lock, FileText, Landmark } from "lucide-react";

// ─── Types (subset of the staff-side shapes — only what is displayed) ────────

interface PortalFiling {
  id: string;
  client_id: string;
  financial_year: string;
  quarter: string;
  tds_forms: string[] | null;
  work_status: string | null;
  date_of_filing: string | null;
  acknowledgment_number: string | null;
}

interface PortalChallan {
  id: string;
  form_type: string | null;
  bsr_code: string | null;
  challan_serial_no: string | null;
  deposit_date: string | null;
  total_tax_deposited: number | null;
  interest_deposited: number | null;
  late_fees_234e: number | null;
  total_challan_amount: number | null;
  minor_head_of_challan: string | null;
  is_book_entry: boolean | null;
  bank_name: string | null;
}

interface PortalDeductee {
  id: string;
  challan_id: string | null;
  form_type: string | null;
  deductee_name: string | null;
  deductee_pan: string | null;
  pan_not_available: boolean | null;
  deductee_type: string | null;
  section_code: string | null;
  amount_paid_credited: number | null;
  date_of_payment: string | null;
  rate_of_tds: number | null;
  tds_amount: number | null;
  total_tax_deducted: number | null;
  interest_amount: number | null;
  reason_for_lower_or_nil_deduction: string | null;
  gross_salary: number | null;
  standard_deduction_allowed: number | null;
  net_taxable_salary: number | null;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const money = (n: number | null | undefined) =>
  n == null ? "—" : new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(n);

const shortDate = (d: string | null | undefined) => {
  if (!d) return "—";
  const parsed = new Date(d);
  return isNaN(parsed.getTime()) ? "—" : format(parsed, "dd/MM/yyyy");
};

/** Quarters sort Q1→Q4; FYs sort newest first so the current return leads. */
const sortFilings = (a: PortalFiling, b: PortalFiling) =>
  b.financial_year.localeCompare(a.financial_year) || a.quarter.localeCompare(b.quarter);

const STATUS_TONE: Record<string, string> = {
  Filed: "bg-emerald-100 text-emerald-700",
  "Under Process": "bg-amber-100 text-amber-700",
  "Data Received": "bg-slate-100 text-slate-700",
};

// ─── Page ───────────────────────────────────────────────────────────────────

export default function PortalTds() {
  const { activeClient, loading: clientLoading } = usePortalClient();

  const [filings, setFilings] = useState<PortalFiling[]>([]);
  const [filingsLoading, setFilingsLoading] = useState(true);

  const [selFy, setSelFy] = useState("");
  const [selQuarter, setSelQuarter] = useState("");
  const [selForm, setSelForm] = useState("");

  const [challans, setChallans] = useState<PortalChallan[]>([]);
  const [deductees, setDeductees] = useState<PortalDeductee[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [liveAt, setLiveAt] = useState<Date | null>(null);

  // ── Load this entity's filings ────────────────────────────────────────────
  const fetchFilings = useCallback(async (opts?: { silent?: boolean }) => {
    if (!activeClient) { setFilings([]); setFilingsLoading(false); return; }
    // Silent on live refreshes — filingsLoading gates the whole-page skeleton,
    // so setting it here would blank the screen every time staff save a row.
    if (!opts?.silent) setFilingsLoading(true);
    const { data } = await supabase
      .from("tds_filings")
      .select("id, client_id, financial_year, quarter, tds_forms, work_status, date_of_filing, acknowledgment_number")
      .eq("client_id", activeClient.id);
    const rows = ((data || []) as unknown as PortalFiling[]).slice().sort(sortFilings);
    setFilings(rows);
    setFilingsLoading(false);
  }, [activeClient]);

  useEffect(() => { fetchFilings(); }, [fetchFilings]);

  // Options are derived from the filings that actually exist for this entity —
  // a client should never be offered a period their firm has no return for.
  const fyOptions = useMemo(
    () => [...new Set(filings.map(f => f.financial_year))],
    [filings],
  );
  const quarterOptions = useMemo(
    () => [...new Set(filings.filter(f => f.financial_year === selFy).map(f => f.quarter))].sort(),
    [filings, selFy],
  );
  const formOptions = useMemo(() => {
    const forms = filings
      .filter(f => f.financial_year === selFy && f.quarter === selQuarter)
      .flatMap(f => f.tds_forms || []);
    return [...new Set(forms)].sort();
  }, [filings, selFy, selQuarter]);

  // Keep the three selects in a valid combination as the entity/period changes.
  useEffect(() => {
    if (fyOptions.length && !fyOptions.includes(selFy)) setSelFy(fyOptions[0]);
    if (!fyOptions.length && selFy) setSelFy("");
  }, [fyOptions, selFy]);

  useEffect(() => {
    if (quarterOptions.length && !quarterOptions.includes(selQuarter)) setSelQuarter(quarterOptions[0]);
    if (!quarterOptions.length && selQuarter) setSelQuarter("");
  }, [quarterOptions, selQuarter]);

  useEffect(() => {
    if (formOptions.length && !formOptions.includes(selForm)) setSelForm(formOptions[0]);
    if (!formOptions.length && selForm) setSelForm("");
  }, [formOptions, selForm]);

  const activeFiling = useMemo(
    () => filings.find(f =>
      f.financial_year === selFy &&
      f.quarter === selQuarter &&
      (f.tds_forms || []).includes(selForm),
    ) || null,
    [filings, selFy, selQuarter, selForm],
  );

  // ── Load the selected return's challans + deductees ───────────────────────
  // A monotonic request id, not a per-effect `cancelled` flag: live refetches
  // are fired from outside React's effect lifecycle (realtime, focus, poll), so
  // a slow earlier response must never overwrite a newer one.
  const detailReqRef = useRef(0);

  const fetchDetail = useCallback(async (opts?: { silent?: boolean }) => {
    if (!activeFiling || !activeClient) { setChallans([]); setDeductees([]); return; }
    const req = ++detailReqRef.current;
    // Live refreshes are silent — flashing skeletons over a table the client is
    // reading, every time staff save a row, would be worse than the stale ms.
    if (!opts?.silent) setDetailLoading(true);
    const [{ data: ch }, { data: de }] = await Promise.all([
      supabase
        .from("tds_challans")
        .select("id, form_type, bsr_code, challan_serial_no, deposit_date, total_tax_deposited, interest_deposited, late_fees_234e, total_challan_amount, minor_head_of_challan, is_book_entry, bank_name")
        .eq("filing_id", activeFiling.id)
        .eq("client_id", activeClient.id),
      supabase
        .from("tds_deductees")
        .select("id, challan_id, form_type, deductee_name, deductee_pan, pan_not_available, deductee_type, section_code, amount_paid_credited, date_of_payment, rate_of_tds, tds_amount, total_tax_deducted, interest_amount, reason_for_lower_or_nil_deduction, gross_salary, standard_deduction_allowed, net_taxable_salary")
        .eq("filing_id", activeFiling.id)
        .eq("client_id", activeClient.id),
    ]);
    if (req !== detailReqRef.current) return;
    const forForm = (r: { form_type: string | null }) => !r.form_type || r.form_type === selForm;
    // Cast through unknown: src/integrations/supabase/types.ts is stale and
    // does not know about late_fees_234e (added in 20260401090000) — it is a
    // protected file, regenerated via the Supabase CLI only.
    setChallans(((ch || []) as unknown as PortalChallan[]).filter(forForm));
    setDeductees(((de || []) as unknown as PortalDeductee[]).filter(forForm));
    setDetailLoading(false);
  }, [activeFiling, activeClient, selForm]);

  useEffect(() => { fetchDetail(); }, [fetchDetail]);

  // ── Live sync with the staff-side Data Entry screen ───────────────────────
  // Held in a ref so the subscription below mounts once per entity instead of
  // tearing down and re-subscribing every time a selector changes identity.
  const refreshRef = useRef<() => void>(() => {});
  refreshRef.current = () => { fetchFilings({ silent: true }); fetchDetail({ silent: true }); };

  useEffect(() => {
    if (!activeClient) return;
    // One channel per entity, filtered server-side to that entity's rows. RLS
    // is still the boundary — this filter is about not shipping other rows down
    // the socket, not about trusting the client.
    const scope = `client_id=eq.${activeClient.id}`;
    const onChange = () => { refreshRef.current(); setLiveAt(new Date()); };
    const channel = supabase
      .channel(`portal-tds-${activeClient.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "tds_filings", filter: scope }, onChange)
      .on("postgres_changes", { event: "*", schema: "public", table: "tds_challans", filter: scope }, onChange)
      .on("postgres_changes", { event: "*", schema: "public", table: "tds_deductees", filter: scope }, onChange)
      .subscribe((status) => {
        // Pull once on (re)connect so anything staff changed while the socket
        // was down is picked up straight away.
        if (status === "SUBSCRIBED") refreshRef.current();
      });
    return () => { supabase.removeChannel(channel); };
  }, [activeClient]);

  // Fallbacks for environments where WebSockets are blocked or the socket
  // silently dropped: refetch on focus/visibility/bfcache-restore, and poll
  // while the tab is visible. Same belt-and-braces the staff module uses.
  useEffect(() => {
    const onVisible = () => { if (!document.hidden) refreshRef.current(); };
    const onPageShow = () => refreshRef.current();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    window.addEventListener("pageshow", onPageShow);
    const poll = window.setInterval(() => { if (!document.hidden) refreshRef.current(); }, 45000);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      window.removeEventListener("pageshow", onPageShow);
      window.clearInterval(poll);
    };
  }, []);

  const deducteesByChallan = useMemo(() => {
    const map = new Map<string, PortalDeductee[]>();
    for (const d of deductees) {
      const key = d.challan_id || "__unlinked__";
      const list = map.get(key);
      if (list) list.push(d); else map.set(key, [d]);
    }
    return map;
  }, [deductees]);

  const unlinked = deducteesByChallan.get("__unlinked__") || [];

  const totals = useMemo(() => ({
    deductees: deductees.length,
    tds: deductees.reduce((s, d) => s + (d.total_tax_deducted ?? d.tds_amount ?? 0), 0),
    deposited: challans.reduce((s, c) => s + (c.total_challan_amount ?? 0), 0),
  }), [deductees, challans]);

  // ── Render ────────────────────────────────────────────────────────────────

  if (clientLoading || filingsLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Receipt size={22} className="text-amber-600" />
            TDS Workspace
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {activeClient?.name ? <>Return data for <span className="font-medium">{activeClient.name}</span>. </> : null}
            Prepared by your CA firm.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span
            className="flex items-center gap-1.5 text-xs text-muted-foreground"
            title="This page updates automatically when your CA firm changes the data"
          >
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
            </span>
            {liveAt ? `Updated ${format(liveAt, "HH:mm:ss")}` : "Live"}
          </span>
          <Badge variant="secondary" className="gap-1.5">
            <Lock size={11} /> View only
          </Badge>
        </div>
      </div>

      {filings.length === 0 ? (
        <Card>
          <CardContent className="p-10 text-center text-sm text-muted-foreground">
            No TDS returns have been prepared for this entity yet.
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Period selectors — these choose what to VIEW, they change no data */}
          <Card>
            <CardContent className="p-4 flex flex-wrap gap-3 items-end">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Financial Year</label>
                <Select value={selFy} onValueChange={setSelFy}>
                  <SelectTrigger className="w-[150px] h-9"><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>
                    {fyOptions.map(fy => <SelectItem key={fy} value={fy}>{fy}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Quarter</label>
                <Select value={selQuarter} onValueChange={setSelQuarter}>
                  <SelectTrigger className="w-[110px] h-9"><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>
                    {quarterOptions.map(q => <SelectItem key={q} value={q}>{q}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Form</label>
                <Select value={selForm} onValueChange={setSelForm}>
                  <SelectTrigger className="w-[110px] h-9"><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>
                    {formOptions.map(f => <SelectItem key={f} value={f}>{f}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex-1" />

              {activeFiling && (
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge className={STATUS_TONE[activeFiling.work_status || ""] || "bg-slate-100 text-slate-700"}>
                    {activeFiling.work_status || "—"}
                  </Badge>
                  {activeFiling.date_of_filing && (
                    <span className="text-xs text-muted-foreground">
                      Filed {shortDate(activeFiling.date_of_filing)}
                    </span>
                  )}
                  {activeFiling.acknowledgment_number && (
                    <span className="text-xs text-muted-foreground">
                      Ack {activeFiling.acknowledgment_number}
                    </span>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Totals */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Card><CardContent className="p-3">
              <p className="text-xs text-muted-foreground">Deductee rows</p>
              <p className="text-2xl font-bold">{detailLoading ? <Skeleton className="h-7 w-12" /> : totals.deductees}</p>
            </CardContent></Card>
            <Card><CardContent className="p-3">
              <p className="text-xs text-muted-foreground">Total TDS deducted</p>
              <p className="text-2xl font-bold">{detailLoading ? <Skeleton className="h-7 w-20" /> : `₹${money(totals.tds)}`}</p>
            </CardContent></Card>
            <Card><CardContent className="p-3">
              <p className="text-xs text-muted-foreground">Total challan amount</p>
              <p className="text-2xl font-bold">{detailLoading ? <Skeleton className="h-7 w-20" /> : `₹${money(totals.deposited)}`}</p>
            </CardContent></Card>
          </div>

          {/* Challans, each with its deductee rows */}
          {detailLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : challans.length === 0 && deductees.length === 0 ? (
            <Card>
              <CardContent className="p-10 text-center text-sm text-muted-foreground">
                No data has been entered for {selForm || "this form"} · {selQuarter} {selFy} yet.
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {challans.map(c => (
                <ChallanCard
                  key={c.id}
                  challan={c}
                  form={selForm}
                  rows={deducteesByChallan.get(c.id) || []}
                />
              ))}

              {unlinked.length > 0 && (
                <Card>
                  <CardHeader className="py-3">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <FileText size={14} className="text-muted-foreground" />
                      Not yet linked to a challan
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <DeducteeTable rows={unlinked} form={selForm} />
                  </CardContent>
                </Card>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Challan card ───────────────────────────────────────────────────────────

function ChallanCard({ challan, rows, form }: {
  challan: PortalChallan;
  rows: PortalDeductee[];
  form: string;
}) {
  return (
    <Card>
      <CardHeader className="py-3">
        <CardTitle className="text-sm flex items-center gap-2 flex-wrap">
          <Landmark size={14} className="text-amber-600 shrink-0" />
          <span>
            Challan {challan.challan_serial_no || "—"}
            {challan.bsr_code ? ` · BSR ${challan.bsr_code}` : ""}
          </span>
          <span className="text-xs font-normal text-muted-foreground">
            {shortDate(challan.deposit_date)}
          </span>
          {challan.is_book_entry && (
            <Badge variant="outline" className="text-[10px]">Book entry</Badge>
          )}
          <div className="flex-1" />
          <span className="text-xs font-normal text-muted-foreground">
            Deposited ₹{money(challan.total_challan_amount)}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0 space-y-3">
        <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
          <span>Tax ₹{money(challan.total_tax_deposited)}</span>
          <span>Interest ₹{money(challan.interest_deposited)}</span>
          <span>Late fee (234E) ₹{money(challan.late_fees_234e)}</span>
          {challan.minor_head_of_challan && <span>Minor head {challan.minor_head_of_challan}</span>}
          {challan.bank_name && <span>{challan.bank_name}</span>}
        </div>
        <DeducteeTable rows={rows} form={form} />
      </CardContent>
    </Card>
  );
}

// ─── Deductee table — column set mirrors the staff Data Entry grid ──────────

function DeducteeTable({ rows, form }: { rows: PortalDeductee[]; form: string }) {
  if (rows.length === 0) {
    return <p className="text-xs text-muted-foreground py-2">No rows under this challan.</p>;
  }

  const isSalary = form === "24Q";
  const isTcs = form === "27EQ";

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-8 text-xs">#</TableHead>
            <TableHead className="text-xs">{isSalary ? "Employee Name" : isTcs ? "Collectee" : "Name"}</TableHead>
            <TableHead className="text-xs">PAN</TableHead>
            {isSalary ? (
              <>
                <TableHead className="text-xs text-right">Gross</TableHead>
                <TableHead className="text-xs text-right">Std Ded</TableHead>
                <TableHead className="text-xs text-right">Taxable</TableHead>
                <TableHead className="text-xs text-right">TDS</TableHead>
              </>
            ) : (
              <>
                <TableHead className="text-xs">Type</TableHead>
                <TableHead className="text-xs">Section</TableHead>
                <TableHead className="text-xs text-right">Amount</TableHead>
                <TableHead className="text-xs">Date</TableHead>
                <TableHead className="text-xs text-right">Rate%</TableHead>
                <TableHead className="text-xs text-right">{isTcs ? "TCS" : "TDS"}</TableHead>
                <TableHead className="text-xs text-right">Interest</TableHead>
                <TableHead className="text-xs">Reason</TableHead>
              </>
            )}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((d, i) => (
            <TableRow key={d.id}>
              <TableCell className="text-xs text-muted-foreground">{i + 1}</TableCell>
              <TableCell className="text-xs font-medium">{d.deductee_name || "—"}</TableCell>
              <TableCell className="text-xs font-mono">
                {d.pan_not_available ? <span className="text-muted-foreground">PANNOTAVBL</span> : (d.deductee_pan || "—")}
              </TableCell>
              {isSalary ? (
                <>
                  <TableCell className="text-xs text-right">{money(d.gross_salary)}</TableCell>
                  <TableCell className="text-xs text-right">{money(d.standard_deduction_allowed)}</TableCell>
                  <TableCell className="text-xs text-right">{money(d.net_taxable_salary)}</TableCell>
                  <TableCell className="text-xs text-right">{money(d.total_tax_deducted ?? d.tds_amount)}</TableCell>
                </>
              ) : (
                <>
                  <TableCell className="text-xs">{d.deductee_type || "—"}</TableCell>
                  <TableCell className="text-xs">{d.section_code || "—"}</TableCell>
                  <TableCell className="text-xs text-right">{money(d.amount_paid_credited)}</TableCell>
                  <TableCell className="text-xs">{shortDate(d.date_of_payment)}</TableCell>
                  <TableCell className="text-xs text-right">{d.rate_of_tds == null ? "—" : d.rate_of_tds}</TableCell>
                  <TableCell className="text-xs text-right">{money(d.total_tax_deducted ?? d.tds_amount)}</TableCell>
                  <TableCell className="text-xs text-right">{money(d.interest_amount)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{d.reason_for_lower_or_nil_deduction || "—"}</TableCell>
                </>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
