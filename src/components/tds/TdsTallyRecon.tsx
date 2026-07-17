import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { ShieldCheck, CheckCircle2, XCircle, Upload, FileSpreadsheet, Loader2, RotateCcw, X, Play, Users, Link2 } from "lucide-react";
import { pdfToTextPages } from "@/lib/tds/pdfText";
import { parseTallyPdfPages } from "@/lib/tds/tallyPdf";
import { logReconAudit } from "@/lib/tdsReconAudit";
import { makeDateNormaliser, normalizeName, canonicalSection, nameCompare } from "@/lib/tds/match";
import {
  reconcileTally,
  type OfficeTxn, type TallyRow, type TallyReconRow, type PartyMap, type TallyResult,
} from "@/lib/tds/tallyRecon";

/** Stage-3 status for the parent filing gate (optional, like Stage-2). */
export interface TallyStageStatus {
  filingId: string | null; loaded: boolean; applicable: boolean; ran: boolean;
  total: number; matched: number; issues: number; overridden: number;
}

interface Props {
  filing: any; selClient: string; selFy: string; selQuarter: string; selForm: string;
  resolveFirmId: () => Promise<string | null>; disabled?: boolean;
  onStatusChange?: (s: TallyStageStatus) => void;
}

interface ResultRow {
  id: string; office_deductee_id: string | null;
  office_name: string | null; office_date: string | null; office_amount: number | null; office_tds: number | null; office_section: string | null;
  tally_party: string | null; tally_date: string | null; tally_credit: number | null;
  result: TallyResult; amount_basis: string | null; reason: string | null; confidence: number | null; mapped: boolean;
  overridden: boolean; override_reason: string | null; overridden_by: string | null;
}

const RESULT_BADGE: Record<string, string> = {
  "Matched": "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
  "Ledger Entry Not Found": "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
  "Party Name Mismatch": "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
  "Date Mismatch": "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
  "Credit Amount Mismatch": "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
  "Section Mismatch": "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
  "Multiple Possible Matches": "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
  "Duplicate Ledger Entries": "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
  "No Ledger for Section": "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
};
const inr = (n: number | null | undefined) => (n == null ? "—" : `₹${Math.round(Number(n)).toLocaleString("en-IN")}`);
type Filter = null | "total" | "matched" | "issues" | "mapped" | "overridden";

function AnimatedNumber({ value }: { value: number }) {
  const [d, setD] = useState(0); const prev = useRef(0);
  useEffect(() => {
    const from = prev.current, to = value; if (from === to) { setD(to); return; }
    let raf = 0, start = 0; const fin = () => { setD(to); prev.current = to; };
    const step = (ts: number) => { if (!start) start = ts; const t = Math.min(1, (ts - start) / 500); setD(Math.round(from + (to - from) * (1 - Math.pow(1 - t, 3)))); if (t < 1) raf = requestAnimationFrame(step); else fin(); };
    raf = requestAnimationFrame(step); const s = setTimeout(fin, 700);
    return () => { cancelAnimationFrame(raf); clearTimeout(s); };
  }, [value]);
  return <>{d}</>;
}

/**
 * Stage-3 imports Tally ledger PDFs ONLY.
 *
 * The Excel/CSV path is gone on purpose: a Tally ledger EXPORTED to Excel loses
 * the ledger name (so the section had to be guessed), and every client's export
 * settings produced a different sheet shape — which is what made Stage-3 need a
 * fix per client. The PRINTED ledger PDF is the one artefact Tally emits
 * identically for every client and every section, so the parser can learn that
 * one structure once. See src/lib/tds/tallyPdf.ts.
 */
async function parseTallyFile(file: File) {
  if (!file.name.toLowerCase().endsWith(".pdf")) {
    throw new Error("Stage 3 reads Tally ledger PDFs only. Export the ledger from Tally as PDF (Ledger Account → print/export to PDF) and import that.");
  }
  const pages = await pdfToTextPages(file);
  const parsed = parseTallyPdfPages(pages);
  if (!parsed.rows.length) {
    throw new Error(parsed.issues[0] || "No deduction (credit) entries found — is this a Tally Ledger Account print?");
  }
  return parsed;
}

const isTallyIssue = (r: string) => r !== "Matched";

/**
 * The ledger party to offer as a saved mapping for this record, or null.
 *
 * Derived from the PERSISTED office/ledger names rather than read back from the
 * engine's `suggested_party` (results are re-read from tds_tally_results, which
 * doesn't carry it). It uses the SAME shared nameCompare the engine used, so the
 * two can't drift: offer a mapping whenever a ledger candidate was found whose
 * party is neither an actual match nor blank — regardless of WHICH mismatch the
 * record landed on. Gating this on result === "Party Name Mismatch" is what made
 * the mapping feature unreachable.
 */
const mappingOffer = (r: ResultRow): string | null => {
  if (r.overridden || r.mapped || r.result === "Matched") return null;
  if (!r.tally_party || !r.office_name) return null;
  const cmp = nameCompare(r.office_name, r.tally_party);
  return cmp === "match" || cmp === "unknown" ? null : r.tally_party;
};

export function TdsTallyRecon({ filing, selClient, selFy, selQuarter, selForm, resolveFirmId, disabled, onStatusChange }: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [office, setOffice] = useState<OfficeTxn[]>([]);
  // ALL imported ledgers for this filing. A client keeps one ledger PER SECTION
  // (194C, 194J, 194A …), so the filing's Tally dataset is the UNION of its files:
  // re-importing the same file NAME replaces it, a different name accumulates —
  // identical to Stage-1/Stage-2.
  const [batches, setBatches] = useState<any[]>([]);
  const [results, setResults] = useState<ResultRow[] | null>(null);
  const [partyMaps, setPartyMaps] = useState<PartyMap>({});
  const [userMap, setUserMap] = useState<Record<string, string>>({});
  const [importing, setImporting] = useState(false);
  const [validating, setValidating] = useState(false);
  const [activeFilter, setActiveFilter] = useState<Filter>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const loadSeq = useRef(0);
  const settled = useRef<string | null>(null);

  const [ovOpen, setOvOpen] = useState(false); const [ovTarget, setOvTarget] = useState<ResultRow | null>(null);
  const [ovReason, setOvReason] = useState(""); const [ovOther, setOvOther] = useState(""); const [savingOv, setSavingOv] = useState(false);

  const filingId = filing?.id ?? null;
  const officeCount = office.length;
  const ledgerRowCount = useMemo(() => batches.reduce((s, b: any) => s + (Number(b.row_count) || 0), 0), [batches]);
  const ledgerSections = useMemo(
    () => [...new Set(batches.map((b: any) => b.section).filter(Boolean) as string[])].sort(),
    [batches]);
  /** Sections Office Data needs but no ledger covers — the actionable gap that
   *  otherwise shows up as a wall of "Ledger Entry Not Found". */
  const missingSections = useMemo(() => {
    if (!batches.length) return [];
    const have = new Set(ledgerSections.map((s) => canonicalSection(s)).filter(Boolean) as string[]);
    if (!have.size) return [];
    const need = new Set(office.map((o) => canonicalSection(o.section)).filter(Boolean) as string[]);
    return [...need].filter((s) => !have.has(s)).sort();
  }, [office, batches, ledgerSections]);

  const loadOffice = useCallback(async (fId: string): Promise<OfficeTxn[]> => {
    const { data: ch } = await supabase.from("tds_challans").select("id").eq("filing_id", fId);
    const chIds = (ch || []).map((c: any) => c.id);
    if (!chIds.length) return [];
    const { data: ded } = await supabase.from("tds_deductees")
      .select("id, deductee_name, deductee_pan, date_of_payment, amount_paid_credited, tds_amount, total_tax_deducted, section_code, nature_of_payment").in("challan_id", chIds);
    const dates = (ded || []).map((d: any) => d.date_of_payment);
    const toIso = makeDateNormaliser(dates);
    return (ded || []).map((d: any) => ({
      deductee_id: d.id, name: d.deductee_name, pan: d.deductee_pan, date_iso: toIso(d.date_of_payment),
      amount: d.amount_paid_credited != null ? Number(d.amount_paid_credited) : null,
      tds: (d.tds_amount != null ? Number(d.tds_amount) : null) ?? (d.total_tax_deducted != null ? Number(d.total_tax_deducted) : null),
      section: d.section_code || d.nature_of_payment,
    }));
  }, []);

  const loadMaps = useCallback(async (): Promise<PartyMap> => {
    if (!selClient) return {};
    const { data } = await supabase.from("tds_tally_party_maps").select("office_name_norm, tally_party").eq("client_id", selClient);
    return Object.fromEntries((data || []).map((m: any) => [m.office_name_norm, m.tally_party]));
  }, [selClient]);

  const loadAll = useCallback(async () => {
    const seq = ++loadSeq.current; const stale = () => seq !== loadSeq.current;
    if (!filingId) { settled.current = null; setBatches([]); setResults(null); setOffice([]); return; }
    const parties = await loadOffice(filingId); if (stale()) return; setOffice(parties);
    const { data: b } = await supabase.from("tds_tally_batches").select("*").eq("filing_id", filingId).order("imported_at", { ascending: false });
    if (stale()) return; setBatches(b || []);
    const maps = await loadMaps(); if (stale()) return; setPartyMaps(maps);
    const { data: res } = await supabase.from("tds_tally_results").select("*").eq("filing_id", filingId);
    if (stale()) return;
    settled.current = filingId;
    setResults(res && res.length ? (res as ResultRow[]) : null);
    const { data: us } = await supabase.from("users").select("id, name").limit(5000); if (stale()) return;
    setUserMap(Object.fromEntries((us || []).map((u: any) => [u.id, u.name])));
  }, [filingId, loadOffice, loadMaps]);

  useEffect(() => { loadAll(); }, [loadAll]);
  useEffect(() => { setActiveFilter(null); }, [filingId]);

  const handleImport = async (file: File) => {
    if (!filing) return; setImporting(true);
    try {
      const parsed = await parseTallyFile(file);
      const firmId = await resolveFirmId();
      const { data: dup } = await supabase.from("tds_tally_batches").select("id").eq("filing_id", filing.id).eq("file_name", file.name);
      const dupIds = (dup || []).map((b: any) => b.id);
      if (dupIds.length) { await supabase.from("tds_tally_rows").delete().in("batch_id", dupIds); await supabase.from("tds_tally_batches").delete().in("id", dupIds); }
      const { data: bRow, error: bErr } = await supabase.from("tds_tally_batches").insert({
        filing_id: filing.id, client_id: selClient, firm_id: firmId, financial_year: selFy, quarter: selQuarter, form_type: selForm,
        file_name: file.name, section: parsed.section, row_count: parsed.rows.length, status: "imported", imported_by: user?.id,
      }).select("id").single();
      if (bErr || !bRow) throw new Error(bErr?.message || "Batch insert failed");
      const recs = parsed.rows.map((r) => ({
        batch_id: bRow.id, filing_id: filing.id, firm_id: firmId, row_index: r.row_index,
        // section is stored PER ROW: one workbook can hold a ledger per section on
        // separate sheets, so a single batch-level section would lose that.
        section: r.section ?? parsed.section ?? null,
        date_text: r.date, date_iso: r.iso, party: r.party, debit: r.debit, credit: r.credit, vch_no: r.vch_no, vch_type: r.vch_type, raw: r,
      }));
      for (let i = 0; i < recs.length; i += 1000) { const { error } = await supabase.from("tds_tally_rows").insert(recs.slice(i, i + 1000)); if (error) throw new Error(error.message); }
      await supabase.from("tds_tally_results").delete().eq("filing_id", filing.id);
      setResults(null);
      // Report what the ledger actually yielded, including what was deliberately
      // left out (challan payments / balances / totals) so a low count is never a
      // mystery, and surface any parse issue rather than importing quietly.
      const sk = parsed.skipped;
      const dropped = [sk.payments && `${sk.payments} payment`, sk.balances && `${sk.balances} balance`, sk.totals && `${sk.totals} total`]
        .filter(Boolean).join(", ");
      toast({
        title: `Imported ${parsed.rows.length} deduction(s) from ${parsed.section || "the ledger"}`,
        description: [
          `${parsed.ledgerName || file.name}${parsed.period ? ` · ${parsed.period}` : ""}`,
          dropped ? `Skipped ${dropped} row(s) — not deductions.` : "",
          parsed.issues.join(" "),
          "Click Run Validation.",
        ].filter(Boolean).join(" "),
        ...(parsed.issues.length ? { variant: "default" as const } : {}),
      });
      await loadAll();
    } catch (e: any) { toast({ title: "Tally import failed", description: e.message, variant: "destructive" }); }
    setImporting(false);
  };

  /** Remove ONE imported ledger (a filing can hold several). Any prior results are
   *  invalidated because the reconciliation set just changed. */
  const deleteBatch = async (id: string) => {
    if (!filing) return;
    setImporting(true);
    try {
      await supabase.from("tds_tally_rows").delete().eq("batch_id", id);
      const { error } = await supabase.from("tds_tally_batches").delete().eq("id", id);
      if (error) throw new Error(error.message);
      await supabase.from("tds_tally_results").delete().eq("filing_id", filing.id);
      setResults(null);
      toast({ title: "Ledger removed", description: "Run Validation again to reconcile against the remaining ledgers." });
      await loadAll();
    } catch (e: any) { toast({ title: "Could not remove the ledger", description: e.message, variant: "destructive" }); }
    setImporting(false);
  };

  const runAudit = useCallback(async (fId: string) => {
    const seq = loadSeq.current; const firmId = await resolveFirmId();
    const parties = await loadOffice(fId);
    // Reconcile against the UNION of EVERY imported ledger for this filing (a
    // client keeps one per section). Each row carries its own section, so an
    // office 194A record is only ever matched against 194A ledger rows; a batch's
    // section is the fallback for rows imported before per-row section existed.
    const { data: b } = await supabase.from("tds_tally_batches").select("id, section").eq("filing_id", fId).order("imported_at", { ascending: false });
    const batchSection = new Map<string, string | null>((b || []).map((x: any) => [x.id, x.section ?? null]));
    const { data: tr } = await supabase.from("tds_tally_rows").select("*").eq("filing_id", fId);
    const tally: TallyRow[] = (tr || []).map((t: any) => ({
      row_index: t.row_index, date: t.date_text, iso: t.date_iso, party: t.party,
      debit: t.debit != null ? Number(t.debit) : null, credit: t.credit != null ? Number(t.credit) : null,
      vch_no: t.vch_no, vch_type: t.vch_type,
      section: t.section ?? batchSection.get(t.batch_id) ?? null,
    }));
    const maps = await loadMaps();
    const audited = reconcileTally(parties, tally, null, maps);
    // preserve overrides keyed by office_deductee_id
    const { data: prior } = await supabase.from("tds_tally_results").select("id, office_deductee_id, result, overridden, override_reason, overridden_by, overridden_at").eq("filing_id", fId);
    const pm = new Map<string, any>(); for (const p of prior || []) pm.set(p.office_deductee_id ?? "", p);
    const newRows = audited.map((r) => {
      const c = pm.get(r.office_deductee_id ?? ""); const keep = !!c?.overridden && c.result === r.result;
      return {
        filing_id: fId, batch_id: b?.[0]?.id ?? null, firm_id: firmId, quarter: selQuarter, office_deductee_id: r.office_deductee_id,
        office_name: r.office_name, office_date: r.office_date, office_amount: r.office_amount, office_tds: r.office_tds, office_section: r.office_section,
        tally_row_index: r.tally_row_index, tally_party: r.tally_party, tally_date: r.tally_date, tally_credit: r.tally_credit,
        result: r.result, amount_basis: r.amount_basis, reason: r.reason, confidence: r.confidence, mapped: !!r.mapped,
        overridden: keep, override_reason: keep ? c.override_reason : null, overridden_by: keep ? c.overridden_by : null, overridden_at: keep ? c.overridden_at : null,
      };
    });
    const { error } = await supabase.from("tds_tally_results").insert(newRows); if (error) throw new Error(error.message);
    const priorIds = (prior || []).map((p: any) => p.id); if (priorIds.length) await supabase.from("tds_tally_results").delete().in("id", priorIds);
    await logReconAudit({ filingId: fId, firmId, userId: user?.id, userName: userMap[user?.id ?? ""], actionType: "TALLY_RECON_RUN", newValue: `${audited.filter((r) => r.result === "Matched").length} matched / ${audited.length}`, remark: `Tally reconciliation over ${tally.length} ledger rows` });
    if (seq !== loadSeq.current) return audited;
    const { data: res } = await supabase.from("tds_tally_results").select("*").eq("filing_id", fId); if (seq !== loadSeq.current) return audited;
    setResults((res as ResultRow[]) || []);
    return audited;
  }, [loadOffice, loadMaps, resolveFirmId, selQuarter, user?.id, userMap]);

  const runValidation = useCallback(async () => {
    if (!filing || !batches.length || validating) return; setValidating(true);
    try { const a = await runAudit(filing.id); const m = a.filter((r) => r.result === "Matched").length; toast({ title: "Stage 3 · Tally reconciliation complete", description: `${m} matched · ${a.length - m} to review across ${a.length} office record(s)` }); }
    catch (e: any) { toast({ title: "Reconciliation failed", description: e.message, variant: "destructive" }); }
    setValidating(false);
  }, [filing, batches, validating, runAudit, toast]);

  // Confirm a party mapping: office name ↔ ledger party → save + re-run.
  const confirmMapping = async (r: ResultRow) => {
    if (!r.office_name || !r.tally_party) return;
    const firmId = await resolveFirmId();
    const { error } = await supabase.from("tds_tally_party_maps").upsert({
      firm_id: firmId, client_id: selClient, office_name_norm: normalizeName(r.office_name), office_name: r.office_name, tally_party: r.tally_party, created_by: user?.id,
    }, { onConflict: "client_id,office_name_norm" });
    if (error) { toast({ title: "Could not save mapping", description: error.message, variant: "destructive" }); return; }
    await logReconAudit({ filingId: filing?.id, firmId: filing?.firm_id, userId: user?.id, userName: userMap[user?.id ?? ""], actionType: "TALLY_PARTY_MAP", oldValue: r.office_name, newValue: r.tally_party, remark: "Saved party mapping" });
    toast({ title: "Party mapping saved", description: `"${r.office_name}" ↔ "${r.tally_party}" — re-running.` });
    setValidating(true); try { await runAudit(filing.id); } catch (e: any) { toast({ title: "Re-validation failed", description: e.message, variant: "destructive" }); } setValidating(false);
  };

  const openOverride = (r: ResultRow) => { setOvTarget(r); setOvReason(""); setOvOther(""); setOvOpen(true); };
  const saveOverride = async () => {
    if (!ovTarget) return; const reason = ovReason === "Other" ? ovOther.trim() : ovReason;
    if (!reason) { toast({ title: "Override reason is required", variant: "destructive" }); return; }
    setSavingOv(true);
    const { error } = await supabase.from("tds_tally_results").update({ overridden: true, override_reason: reason, overridden_by: user?.id, overridden_at: new Date().toISOString() }).eq("id", ovTarget.id);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); }
    else {
      await logReconAudit({ filingId: filing?.id, firmId: filing?.firm_id, userId: user?.id, userName: userMap[user?.id ?? ""], actionType: "TALLY_OVERRIDE", oldValue: `${ovTarget.office_name} — ${ovTarget.result}`, newValue: "Overridden", remark: reason });
      setResults((p) => p ? p.map((x) => x.id === ovTarget.id ? { ...x, overridden: true, override_reason: reason, overridden_by: user?.id ?? null } : x) : p);
      toast({ title: "Override recorded" }); setOvOpen(false);
    }
    setSavingOv(false);
  };
  const undoOverride = async (r: ResultRow) => {
    const { error } = await supabase.from("tds_tally_results").update({ overridden: false, override_reason: null, overridden_by: null, overridden_at: null }).eq("id", r.id);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    setResults((p) => p ? p.map((x) => x.id === r.id ? { ...x, overridden: false, override_reason: null } : x) : p);
  };

  const summary = useMemo(() => {
    const rs = results || [];
    return {
      total: rs.length, matched: rs.filter((r) => r.result === "Matched").length,
      issues: rs.filter((r) => isTallyIssue(r.result) && !r.overridden).length,
      mapped: rs.filter((r) => r.mapped).length, overridden: rs.filter((r) => r.overridden).length,
    };
  }, [results]);

  useEffect(() => {
    onStatusChange?.({ filingId, loaded: settled.current === filingId, applicable: batches.length > 0, ran: results !== null, total: summary.total, matched: summary.matched, issues: summary.issues, overridden: summary.overridden });
  }, [filingId, batches, results, summary, onStatusChange]);

  const issueRows = useMemo(() => (results || []).filter((r) => isTallyIssue(r.result)).sort((a, b) => (a.overridden ? 1 : 0) - (b.overridden ? 1 : 0)), [results]);
  const cardFiltered = useMemo((): ResultRow[] | null => {
    const rs = results || [];
    switch (activeFilter) {
      case "total": return rs; case "matched": return rs.filter((r) => r.result === "Matched");
      case "issues": return rs.filter((r) => isTallyIssue(r.result) && !r.overridden);
      case "mapped": return rs.filter((r) => r.mapped); case "overridden": return rs.filter((r) => r.overridden);
      default: return null;
    }
  }, [results, activeFilter]);

  const renderCard = (r: ResultRow) => (
    <Card key={r.id} className={cn(r.overridden ? "border-blue-200 dark:border-blue-900 opacity-80" : r.result === "Matched" ? "border-emerald-200 dark:border-emerald-900" : "border-destructive/30")}>
      <CardContent className="p-4 space-y-1.5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0"><p className="font-semibold text-sm truncate">{r.office_name || "—"}</p>
            <p className="text-[11px] text-muted-foreground">{r.office_date || "—"} · office {inr(r.office_amount)} / TDS {inr(r.office_tds)} · {r.office_section || "—"}</p></div>
          <div className="flex items-center gap-2 shrink-0">
            <Badge className={cn("text-[10px]", RESULT_BADGE[r.result] || "bg-muted")}>{r.result}</Badge>
            {typeof r.confidence === "number" && <span className="text-[10px] text-muted-foreground">{r.confidence}%</span>}
            {!r.overridden ? <Button variant="outline" size="sm" className="h-7 gap-1 text-xs" onClick={() => openOverride(r)} disabled={disabled}><ShieldCheck size={12} /> Override</Button>
              : <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={() => undoOverride(r)}><RotateCcw size={12} /> Undo</Button>}
          </div>
        </div>
        {r.tally_party != null && (
          <p className="text-[11px] text-muted-foreground">Ledger: <b className="text-foreground">{r.tally_party}</b> · {r.tally_date || "—"} · credit {inr(r.tally_credit)}{r.mapped ? " · mapped" : ""}</p>
        )}
        <p className={cn("text-xs", r.overridden ? "text-blue-600" : r.result === "Matched" ? "text-emerald-600" : "text-destructive")}>
          {r.overridden ? `Overridden — ${r.override_reason || "accepted"}${r.overridden_by && userMap[r.overridden_by] ? ` · ${userMap[r.overridden_by]}` : ""}` : r.reason}
        </p>
        {/* Offer the mapping whenever a credible ledger candidate was found whose
            PARTY differs — not only on "Party Name Mismatch". The common real case
            is a ledger entry that is a few days out AND booked under the
            proprietor's personal name, which lands on "Date Mismatch"; gating the
            button on that one result made the mapping feature unreachable. */}
        {mappingOffer(r) && (
          <div className="flex items-center gap-2 p-2 rounded-md border border-amber-200 dark:border-amber-900 bg-amber-50/50 dark:bg-amber-950/20 text-xs">
            <Link2 size={13} className="text-amber-600 shrink-0" />
            <span className="text-foreground">Possible mapping: <b>{r.office_name}</b> ↔ <b>{r.tally_party}</b></span>
            <div className="flex-1" />
            <Button size="sm" className="h-6 text-xs px-2" disabled={disabled} onClick={() => confirmMapping(r)}>Confirm mapping</Button>
          </div>
        )}
      </CardContent>
    </Card>
  );

  if (!filing) return null;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2">
        <Card><CardContent className="p-4">
          <div className="flex items-center gap-2 mb-2"><Users size={16} className="text-foreground" /><p className="font-semibold text-sm">Office Data <span className="text-muted-foreground font-normal">(master · this quarter)</span></p></div>
          <div><span className="text-2xl font-bold">{officeCount}</span> <span className="text-muted-foreground text-sm">records</span></div>
          {officeCount === 0 && <p className="text-xs text-amber-600 mt-2">No office records yet — enter data in the Data Entry tab first.</p>}
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="flex items-center justify-between mb-2">
            <p className="font-semibold text-sm flex items-center gap-2"><FileSpreadsheet size={15} className="text-foreground" /> Imported Tally Ledger{validating && <span className="text-xs text-amber-600 flex items-center gap-1"><Loader2 size={11} className="animate-spin" /> reconciling…</span>}</p>
            <input ref={fileRef} type="file" accept=".pdf,application/pdf" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImport(f); e.currentTarget.value = ""; }} />
            <Button size="sm" variant={batches.length ? "outline" : "default"} className="gap-1" disabled={importing || disabled} onClick={() => fileRef.current?.click()}>
              {importing ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}{batches.length ? "Add / re-import ledger" : "Import ledger PDF"}
            </Button>
          </div>
          {batches.length ? (
            <div className="text-sm">
              <span className="text-2xl font-bold">{ledgerRowCount}</span> <span className="text-muted-foreground">rows</span>
              {batches.length > 1 && <span className="text-muted-foreground"> · {batches.length} files</span>}
              <p className="text-xs text-muted-foreground mt-1">Sections: <b className="text-foreground">{ledgerSections.length ? ledgerSections.join(", ") : "—"}</b></p>
              <div className="mt-2 space-y-1 max-h-28 overflow-y-auto">
                {batches.map((b: any) => (
                  <div key={b.id} className="flex items-center gap-2 text-[11px] rounded border px-2 py-1">
                    <FileSpreadsheet size={11} className="text-muted-foreground shrink-0" />
                    <span className="truncate flex-1" title={b.file_name}>{b.file_name}</span>
                    <span className="text-muted-foreground shrink-0">{b.section || "—"} · {b.row_count}</span>
                    <button className="text-muted-foreground hover:text-destructive shrink-0" title="Remove this ledger"
                      disabled={disabled || importing} onClick={() => deleteBatch(b.id)}><X size={11} /></button>
                  </div>
                ))}
              </div>
              {missingSections.length > 0 && (
                <p className="text-[11px] text-amber-600 mt-2">
                  Office Data also has {missingSections.join(", ")} — import {missingSections.length === 1 ? "that section's ledger" : "those sections' ledgers"} too, or those records can't be reconciled.
                </p>
              )}
            </div>
          ) : <p className="text-xs text-muted-foreground">Import the Tally <b>Ledger Account PDF</b> for each TDS section (194A, 194C, 194J, 194T …) — in Tally open the ledger and print/export it to PDF. The section, dates, parties and TDS (credit) amounts are read from the PDF; they combine across files. Re-importing the same file name replaces it. Stage 3 is optional.</p>}
        </CardContent></Card>
      </div>

      <div className="flex items-center gap-3">
        <Button size="lg" className="gap-2 font-semibold" onClick={runValidation} disabled={validating || !batches.length || officeCount === 0 || disabled}>
          {validating ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}{validating ? "Validating…" : "Run Validation"}
        </Button>
        {!batches.length ? <span className="text-xs text-muted-foreground">Import the Tally ledger to enable reconciliation.</span> : officeCount === 0 ? <span className="text-xs text-muted-foreground">No office records to reconcile.</span> : null}
      </div>

      {results && (<>
        <div className={cn("grid grid-cols-2 sm:grid-cols-5 gap-3", validating && "animate-pulse")}>
          {([
            { key: "total" as const, label: "Total", value: summary.total, cls: "" },
            { key: "matched" as const, label: "Matched", value: summary.matched, cls: "text-emerald-600" },
            { key: "issues" as const, label: "Mismatched", value: summary.issues, cls: summary.issues > 0 ? "text-destructive" : "text-emerald-600" },
            { key: "mapped" as const, label: "Mapped", value: summary.mapped, cls: "text-blue-600" },
            { key: "overridden" as const, label: "Overridden", value: summary.overridden, cls: "text-blue-600" },
          ]).map((s) => (
            <button key={s.label} type="button" onClick={() => setActiveFilter(activeFilter === s.key ? null : s.key)} aria-pressed={activeFilter === s.key}
              className={cn("rounded-lg border bg-card p-3 text-center transition-all hover:border-primary/50 hover:shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary", activeFilter === s.key ? "ring-2 ring-primary border-primary" : "border-border")}>
              <p className={cn("text-2xl font-bold tabular-nums", s.cls)}><AnimatedNumber value={s.value} /></p><p className="text-[11px] text-muted-foreground">{s.label}</p>
            </button>
          ))}
        </div>
        {cardFiltered !== null ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs px-1"><span className="text-muted-foreground">Showing <b className="text-foreground">{cardFiltered.length}</b> record(s)</span>
              <Button variant="ghost" size="sm" className="h-6 text-xs gap-1" onClick={() => setActiveFilter(null)}><X size={11} /> Clear</Button></div>
            {cardFiltered.length === 0 ? <div className="p-8 text-center text-sm text-muted-foreground rounded-lg border border-dashed">No {activeFilter} records.</div> : <div className="space-y-3">{cardFiltered.map(renderCard)}</div>}
          </div>
        ) : summary.total === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground rounded-lg border border-dashed">No office records to reconcile for this filing.</div>
        ) : issueRows.length === 0 ? (
          <Card className="border-emerald-200 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-950/20"><CardContent className="p-6 space-y-2">
            <div className="flex items-center gap-2"><CheckCircle2 size={22} className="text-emerald-600" /><p className="text-lg font-bold text-emerald-700 dark:text-emerald-300">Tally Reconciliation Completed</p></div>
            <p className="text-sm text-muted-foreground">All {summary.total} office records were found in the Tally ledger with matching date, amount and party.</p>
          </CardContent></Card>
        ) : <div className="space-y-3">{issueRows.map(renderCard)}</div>}
      </>)}

      <Dialog open={ovOpen} onOpenChange={setOvOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Override — {ovTarget?.result}</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">{ovTarget?.office_name} · {ovTarget?.office_date}</p>
            <div className="space-y-1"><Label className="text-xs">Override reason <span className="text-destructive">*</span></Label>
              <Select value={ovReason} onValueChange={setOvReason}><SelectTrigger><SelectValue placeholder="Select a reason" /></SelectTrigger>
                <SelectContent>{["Verified manually against Tally", "Timing/period difference accepted", "Rounding difference accepted", "Entry in another ledger", "Other"].map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent></Select></div>
            {ovReason === "Other" && <div className="space-y-1"><Label className="text-xs">Please specify <span className="text-destructive">*</span></Label><Textarea value={ovOther} onChange={(e) => setOvOther(e.target.value)} rows={2} /></div>}
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setOvOpen(false)}>Cancel</Button>
            <Button onClick={saveOverride} disabled={savingOv || !ovReason || (ovReason === "Other" && !ovOther.trim())}>{savingOv ? "Saving…" : "Confirm Override"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
