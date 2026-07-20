import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { ShieldCheck, CheckCircle2, XCircle, Upload, FileSpreadsheet, Loader2, RotateCcw, X, Play, Users, Link2, Unlink, Search } from "lucide-react";
import { pdfToTextPages } from "@/lib/tds/pdfText";
import { parseTallyPdfPages } from "@/lib/tds/tallyPdf";
import { logReconAudit } from "@/lib/tdsReconAudit";
import { TdsExportMenu } from "./TdsExportMenu";
import { ErrorTypeBreakdown, filterByErrorType } from "./ErrorTypeBreakdown";
import type { StageReport, ReportMeta, AuditRow } from "@/lib/tds/tdsReport";
import { makeDateNormaliser, normalizeName, canonicalSection, nameCompare } from "@/lib/tds/match";
import {
  reconcileTallyFull,
  type OfficeTxn, type TallyRow, type TallyReconRow, type PartyMap, type TallyResult,
} from "@/lib/tds/tallyRecon";

/** Stage-3 status for the parent filing gate (optional, like Stage-2). */
export interface TallyStageStatus {
  filingId: string | null; loaded: boolean; applicable: boolean; ran: boolean;
  total: number; matched: number; issues: number; overridden: number;
  /** This stage's FULL report (rows + reasons) for the parent's Overview. Lazy. */
  getReport?: () => StageReport;
  /** Every Tally exception (unresolved, overridden, or resolved via a saved party
   *  mapping) as one audit row each, for the Stage-4 Checker Review table. Lazy. */
  getAuditRows?: () => AuditRow[];
}

interface Props {
  filing: any; selClient: string; selFy: string; selQuarter: string; selForm: string;
  /** Client display name — for the exported report header. */
  clientName?: string;
  resolveFirmId: () => Promise<string | null>; disabled?: boolean;
  onStatusChange?: (s: TallyStageStatus) => void;
}

interface ResultRow {
  id: string; office_deductee_id: string | null;
  office_name: string | null; office_date: string | null; office_amount: number | null; office_tds: number | null; office_section: string | null;
  tally_party: string | null; tally_date: string | null; tally_credit: number | null;
  result: TallyResult; amount_basis: string | null; reason: string | null; confidence: number | null; mapped: boolean;
  overridden: boolean; override_reason: string | null; overridden_by: string | null; overridden_at?: string | null;
}

const RESULT_BADGE: Record<string, string> = {
  "Matched": "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
  "Ledger Entry Not Found": "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
  "Office Data Not Found": "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
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
 * A record the engine itself landed on "Party Name Mismatch" ALWAYS gets the
 * offer — that result IS the engine saying the party is the (or a) problem, and
 * it decided that with full exclusivity context (rival claimants, the
 * distinctness witness) a standalone recompute here cannot see. Never let a
 * client-side re-check silently withhold the one resolution action for the
 * exact case it names, even if match.ts's tolerance has since moved (e.g. after
 * an engine fix, before this filing is re-validated) and would now call the
 * same two names a match — the checker still needs a way to resolve what's on
 * screen right now, not a re-run.
 *
 * For every OTHER mismatch (e.g. "Date Mismatch" on an entry booked under a
 * different name), fall back to a fresh nameCompare over the PERSISTED names —
 * results are re-read from tds_tally_results, which doesn't carry the engine's
 * in-memory `suggested_party` for those cases. Gating the offer on
 * result === "Party Name Mismatch" alone is what made it unreachable for this
 * second group, so keep both paths.
 */
const mappingOffer = (r: ResultRow): string | null => {
  if (r.overridden || r.mapped || r.result === "Matched") return null;
  if (!r.tally_party || !r.office_name) return null;
  if (r.result === "Party Name Mismatch") return r.tally_party;
  const cmp = nameCompare(r.office_name, r.tally_party);
  return cmp === "match" || cmp === "unknown" ? null : r.tally_party;
};

export function TdsTallyRecon({ filing, selClient, selFy, selQuarter, selForm, clientName, resolveFirmId, disabled, onStatusChange }: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [office, setOffice] = useState<OfficeTxn[]>([]);
  // ALL imported ledgers for this filing. A client keeps one ledger PER SECTION
  // (194C, 194J, 194A …), so the filing's Tally dataset is the UNION of its files:
  // re-importing the same file NAME replaces it, a different name accumulates —
  // identical to Stage-1/Stage-2.
  const [batches, setBatches] = useState<any[]>([]);
  // The imported ledger rows themselves, kept in state so the "Choose another
  // record" picker can list them without re-reading the PDFs.
  const [tallyRows, setTallyRows] = useState<TallyRow[]>([]);
  const [results, setResults] = useState<ResultRow[] | null>(null);
  const [partyMaps, setPartyMaps] = useState<PartyMap>({});
  const [userMap, setUserMap] = useState<Record<string, string>>({});
  const [importing, setImporting] = useState(false);
  const [validating, setValidating] = useState(false);
  const [activeFilter, setActiveFilter] = useState<Filter>(null);
  // Secondary breakdown WITHIN the issue list, by the specific result reason (e.g.
  // "Date Mismatch" vs "Ledger Entry Not Found") — see ErrorTypeBreakdown.
  const [errorTypeFilter, setErrorTypeFilter] = useState<string | null>(null);
  // Free-text search across the WHOLE list (office name OR ledger party), on top
  // of the summary-card/error-type filters. Without it, a name that's only ever
  // embedded text inside a DIFFERENT record's card (e.g. the ledger side of a
  // "Multiple Possible Matches" dispute, or a name mentioned only in a reason
  // sentence) is unfindable — there's no card titled with it to scan for.
  const [recordSearch, setRecordSearch] = useState("");
  const fileRef = useRef<HTMLInputElement | null>(null);
  const loadSeq = useRef(0);
  const settled = useRef<string | null>(null);

  const [ovOpen, setOvOpen] = useState(false); const [ovTarget, setOvTarget] = useState<ResultRow | null>(null);
  const [ovReason, setOvReason] = useState(""); const [ovOther, setOvOther] = useState(""); const [savingOv, setSavingOv] = useState(false);

  // "Choose another record" picker — the user overrides the engine's suggestion.
  const [pickOpen, setPickOpen] = useState(false); const [pickTarget, setPickTarget] = useState<ResultRow | null>(null);
  const [pickQuery, setPickQuery] = useState("");
  // The REVERSE picker — opened from a ledger-only ("Office Data Not Found") card
  // to pick an unmatched OFFICE record for it, mirroring pick*/openPicker above.
  const [officePickOpen, setOfficePickOpen] = useState(false); const [officePickTarget, setOfficePickTarget] = useState<ResultRow | null>(null);
  const [officePickQuery, setOfficePickQuery] = useState("");

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

  /** The filing's ledger rows shaped for the engine — the UNION of every imported
   *  ledger. `batchList` supplies a row's fallback section (rows imported before
   *  per-row section existed), so it must be the same filing's batches. */
  const fetchTallyRows = useCallback(async (fId: string, batchList: any[]): Promise<TallyRow[]> => {
    const batchSection = new Map<string, string | null>(batchList.map((x: any) => [x.id, x.section ?? null]));
    const { data: tr } = await supabase.from("tds_tally_rows").select("*").eq("filing_id", fId);
    return (tr || []).map((t: any) => ({
      row_index: t.row_index, date: t.date_text, iso: t.date_iso, party: t.party,
      debit: t.debit != null ? Number(t.debit) : null, credit: t.credit != null ? Number(t.credit) : null,
      vch_no: t.vch_no, vch_type: t.vch_type,
      section: t.section ?? batchSection.get(t.batch_id) ?? null,
    }));
  }, []);

  const loadMaps = useCallback(async (): Promise<PartyMap> => {
    if (!selClient) return {};
    const { data } = await supabase.from("tds_tally_party_maps").select("office_name_norm, tally_party").eq("client_id", selClient);
    return Object.fromEntries((data || []).map((m: any) => [m.office_name_norm, m.tally_party]));
  }, [selClient]);

  const loadAll = useCallback(async () => {
    const seq = ++loadSeq.current; const stale = () => seq !== loadSeq.current;
    if (!filingId) { settled.current = null; setBatches([]); setTallyRows([]); setResults(null); setOffice([]); return; }
    const parties = await loadOffice(filingId); if (stale()) return; setOffice(parties);
    const { data: b } = await supabase.from("tds_tally_batches").select("*").eq("filing_id", filingId).order("imported_at", { ascending: false });
    if (stale()) return; setBatches(b || []);
    const rows = await fetchTallyRows(filingId, b || []); if (stale()) return; setTallyRows(rows);
    const maps = await loadMaps(); if (stale()) return; setPartyMaps(maps);
    const { data: res } = await supabase.from("tds_tally_results").select("*").eq("filing_id", filingId);
    if (stale()) return;
    settled.current = filingId;
    setResults(res && res.length ? (res as ResultRow[]) : null);
    const { data: us } = await supabase.from("users").select("id, name").limit(5000); if (stale()) return;
    setUserMap(Object.fromEntries((us || []).map((u: any) => [u.id, u.name])));
  }, [filingId, loadOffice, loadMaps, fetchTallyRows]);

  useEffect(() => { loadAll(); }, [loadAll]);
  useEffect(() => { setActiveFilter(null); setErrorTypeFilter(null); setRecordSearch(""); }, [filingId]);

  /** Import several ledger PDFs at once — a client keeps one ledger PER SECTION, so
   *  picking 194A/194C/194J/194T together is the normal case, not the exception.
   *  Sequential: each import clears this filing's results, so parallel runs would
   *  race. One file failing does not abandon the rest. */
  const handleImportMany = async (files: File[]) => {
    if (files.length === 1) { await handleImport(files[0]); return; }
    let ok = 0;
    for (const f of files) { try { await handleImport(f); ok++; } catch { /* handleImport toasts */ } }
    if (ok > 1) toast({ title: `Imported ${ok} of ${files.length} ledger(s)`, description: "All ledgers reconcile together — click Run Validation." });
  };

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
    const tally = await fetchTallyRows(fId, b || []);
    const maps = await loadMaps();
    // reconcileTallyFull (not reconcileTally) so a ledger credit no office record
    // claims is not silently discarded — the checker must be able to see and
    // resolve it, the same way an unmatched office record already is.
    const { rows: audited, surplusLedger } = reconcileTallyFull(parties, tally, null, maps);
    // preserve overrides keyed by office_deductee_id
    const { data: prior } = await supabase.from("tds_tally_results").select("id, office_deductee_id, tally_party, tally_date, tally_credit, result, overridden, override_reason, overridden_by, overridden_at").eq("filing_id", fId);
    const priorOffice = (prior || []).filter((p: any) => p.office_deductee_id);
    const pm = new Map<string, any>(); for (const p of priorOffice) pm.set(p.office_deductee_id ?? "", p);
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
    // Ledger credits nobody claimed become their own rows (office_* columns null,
    // result "Office Data Not Found") — no schema change needed, every column is
    // already nullable except filing_id/firm_id/result. Prior overrides are
    // preserved by VALUE (party+date+credit) since a ledger row has no column
    // here to carry a stable id across runs — the office side uses
    // office_deductee_id for this because it IS a stable id; this is a
    // best-effort match for the same convenience, not a correctness requirement
    // (worst case, a re-run asks the user to re-confirm one override).
    const surplusKey = (party: string | null, date: string | null, credit: number | null) => `${normalizeName(party)}|${date ?? ""}|${credit ?? ""}`;
    const priorLedger = (prior || []).filter((p: any) => !p.office_deductee_id && p.result === "Office Data Not Found");
    const lm = new Map<string, any>(); for (const p of priorLedger) lm.set(surplusKey(p.tally_party, p.tally_date, p.tally_credit), p);
    const surplusRows = surplusLedger.map((t) => {
      const key = surplusKey(t.party, t.date, t.credit);
      const c = lm.get(key); const keep = !!c?.overridden && c.result === "Office Data Not Found";
      return {
        filing_id: fId, batch_id: b?.[0]?.id ?? null, firm_id: firmId, quarter: selQuarter, office_deductee_id: null,
        office_name: null, office_date: null, office_amount: null, office_tds: null, office_section: null,
        tally_row_index: t.row_index, tally_party: t.party, tally_date: t.date, tally_credit: t.credit,
        result: "Office Data Not Found" as TallyResult, amount_basis: null,
        reason: "No office record matches this ledger entry.", confidence: 0, mapped: false,
        overridden: keep, override_reason: keep ? c.override_reason : null, overridden_by: keep ? c.overridden_by : null, overridden_at: keep ? c.overridden_at : null,
      };
    });
    const { error } = await supabase.from("tds_tally_results").insert([...newRows, ...surplusRows]); if (error) throw new Error(error.message);
    const priorIds = (prior || []).map((p: any) => p.id); if (priorIds.length) await supabase.from("tds_tally_results").delete().in("id", priorIds);
    await logReconAudit({ filingId: fId, firmId, userId: user?.id, userName: userMap[user?.id ?? ""], actionType: "TALLY_RECON_RUN", newValue: `${audited.filter((r) => r.result === "Matched").length} matched / ${audited.length}`, remark: `Tally reconciliation over ${tally.length} ledger rows` });
    if (seq !== loadSeq.current) return audited;
    const { data: res } = await supabase.from("tds_tally_results").select("*").eq("filing_id", fId); if (seq !== loadSeq.current) return audited;
    setTallyRows(tally);
    setResults((res as ResultRow[]) || []);
    return audited;
  }, [loadOffice, loadMaps, fetchTallyRows, resolveFirmId, selQuarter, user?.id, userMap]);

  const runValidation = useCallback(async () => {
    if (!filing || !batches.length || validating) return; setValidating(true);
    try { const a = await runAudit(filing.id); const m = a.filter((r) => r.result === "Matched").length; toast({ title: "Stage 3 · Tally reconciliation complete", description: `${m} matched · ${a.length - m} to review across ${a.length} office record(s)` }); }
    catch (e: any) { toast({ title: "Reconciliation failed", description: e.message, variant: "destructive" }); }
    setValidating(false);
  }, [filing, batches, validating, runAudit, toast]);

  /** Save a party mapping (office name ↔ ledger party) → re-run.
   *
   *  The ledger party is a PARAMETER, not read off the record: two different
   *  parties can legitimately share a date and a TDS amount, so the engine's
   *  suggestion is only a recommendation. Both "Confirm mapping" (accept the
   *  suggestion) and the record picker (the user chose a different ledger entry)
   *  land here, so the upsert / audit log / re-run happen exactly once. */
  const saveMapping = async (officeName: string | null, tallyParty: string | null, remark = "Saved party mapping") => {
    if (!officeName || !tallyParty) return;
    const firmId = await resolveFirmId();
    const { error } = await supabase.from("tds_tally_party_maps").upsert({
      firm_id: firmId, client_id: selClient, office_name_norm: normalizeName(officeName), office_name: officeName, tally_party: tallyParty, created_by: user?.id,
    }, { onConflict: "client_id,office_name_norm" });
    if (error) { toast({ title: "Could not save mapping", description: error.message, variant: "destructive" }); return; }
    await logReconAudit({ filingId: filing?.id, firmId: filing?.firm_id, userId: user?.id, userName: userMap[user?.id ?? ""], actionType: "TALLY_PARTY_MAP", oldValue: officeName, newValue: tallyParty, remark });
    toast({ title: "Party mapping saved", description: `"${officeName}" ↔ "${tallyParty}" — re-running.` });
    setValidating(true); try { await runAudit(filing.id); } catch (e: any) { toast({ title: "Re-validation failed", description: e.message, variant: "destructive" }); } setValidating(false);
  };

  const openPicker = (r: ResultRow) => { setPickTarget(r); setPickQuery(""); setPickOpen(true); };
  /** Map to the ledger record the USER chose, overriding the suggestion. */
  const pickRecord = (party: string | null) => {
    const t = pickTarget; setPickOpen(false);
    if (t) void saveMapping(t.office_name, party, "Saved party mapping — ledger record chosen by the user");
  };

  /** The REVERSE of openPicker/pickRecord — opened from a ledger-only card to pick
   *  an office record for IT, instead of a ledger record for an office record.
   *  Same saveMapping() underneath; only which side the user searches differs. */
  const openOfficePicker = (r: ResultRow) => { setOfficePickTarget(r); setOfficePickQuery(""); setOfficePickOpen(true); };
  const pickOfficeRecord = (officeName: string | null) => {
    const t = officePickTarget; setOfficePickOpen(false);
    if (t) void saveMapping(officeName, t.tally_party, "Saved party mapping — office record chosen by the user");
  };

  /** Undo a saved party mapping. Deletes the mapping and re-runs, so the record
   *  drops straight back out of Matched into the mismatch list and every count
   *  (Matched / Mapped / Mismatched) follows from the fresh audit — no separate
   *  bookkeeping to drift. */
  const unmapParty = async (r: ResultRow) => {
    if (!r.office_name || !selClient) return;
    const { error } = await supabase.from("tds_tally_party_maps").delete()
      .eq("client_id", selClient).eq("office_name_norm", normalizeName(r.office_name));
    if (error) { toast({ title: "Could not remove the mapping", description: error.message, variant: "destructive" }); return; }
    await logReconAudit({ filingId: filing?.id, firmId: filing?.firm_id, userId: user?.id, userName: userMap[user?.id ?? ""], actionType: "TALLY_PARTY_MAP", oldValue: r.tally_party, newValue: null, remark: `Removed party mapping for "${r.office_name}"` });
    toast({ title: "Mapping removed", description: `"${r.office_name}" is no longer mapped — re-running.` });
    setValidating(true);
    try { await runAudit(filing.id); await loadAll(); }
    catch (e: any) { toast({ title: "Re-validation failed", description: e.message, variant: "destructive" }); }
    setValidating(false);
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

  /** Stage-3 report — the ledger reconciliation as it stands right now. */
  const stage3Report = (): StageReport => {
    const rs = results || [];
    const row = (r: ResultRow) => ({
      "Office Party": r.office_name || "—",
      "Office Date": r.office_date || "—",
      "Office TDS": r.office_tds ?? "",
      Section: r.office_section || "—",
      "Ledger Party": r.tally_party || "—",
      "Ledger Date": r.tally_date || "—",
      "Ledger Credit": r.tally_credit ?? "",
      Result: r.result,
      Mapped: r.mapped ? "Yes" : "No",
      Remarks: r.overridden ? `Overridden — ${r.override_reason || "accepted"}` : (r.reason || ""),
      Overridden: r.overridden ? "Yes" : "No",
    });
    const unresolved = rs.filter((r) => isTallyIssue(r.result) && !r.overridden);
    return {
      title: "Stage 3 - Tally Ledger Reconciliation",
      subtitle: `Office Data vs the imported Tally ledger PDFs — date, party and TDS (credit)${ledgerSections.length ? ` · sections ${ledgerSections.join(", ")}` : ""}`,
      summary: [
        { label: "Total", value: summary.total },
        { label: "Matched", value: summary.matched },
        { label: "Mismatched", value: summary.issues },
        { label: "Mapped", value: summary.mapped },
        { label: "Overridden", value: summary.overridden },
      ],
      sections: [
        { title: "Mismatched", rows: unresolved.map(row), emptyNote: "No mismatches — every office record reconciled to the ledger." },
        { title: "Mapped", rows: rs.filter((r) => r.mapped).map(row), emptyNote: "No records have a manual party mapping." },
        { title: "Overridden", rows: rs.filter((r) => r.overridden).map(row), emptyNote: "No overrides." },
        { title: "Matched", rows: rs.filter((r) => r.result === "Matched").map(row), emptyNote: "No matched records." },
      ],
      notes: missingSections.length
        ? [`Office Data has section(s) ${missingSections.join(", ")} with no imported ledger — those records cannot be reconciled until that ledger PDF is imported.`]
        : [],
    };
  };

  const summary = useMemo(() => {
    const rs = results || [];
    return {
      total: rs.length, matched: rs.filter((r) => r.result === "Matched").length,
      issues: rs.filter((r) => isTallyIssue(r.result) && !r.overridden).length,
      mapped: rs.filter((r) => r.mapped).length, overridden: rs.filter((r) => r.overridden).length,
    };
  }, [results]);

  /** Every Tally exception as one Stage-4 audit row. A record resolved via a saved
   *  party mapping (matched AND mapped) is "Resolved", not "Unresolved" — a real
   *  decision (the mapping) is why it reconciles, so the checker should see that,
   *  not just silence. Overridden always wins (it can co-exist with a mapping). */
  const tallyAuditRows = (): AuditRow[] =>
    (results || [])
      .filter((r) => r.overridden || isTallyIssue(r.result) || (r.mapped && r.result === "Matched"))
      .map((r): AuditRow => ({
        stage: "Stage 3",
        record: r.office_name || r.tally_party || "—",
        errorType: r.result,
        status: r.overridden ? "Overridden" : isTallyIssue(r.result) ? "Unresolved" : "Resolved",
        reason: r.overridden ? (r.override_reason || "accepted") : (r.reason || (r.mapped ? "Reconciled via saved party mapping" : "")),
      }));

  useEffect(() => {
    onStatusChange?.({ getReport: stage3Report, getAuditRows: tallyAuditRows, filingId, loaded: settled.current === filingId, applicable: batches.length > 0, ran: results !== null, total: summary.total, matched: summary.matched, issues: summary.issues, overridden: summary.overridden });
  }, [filingId, batches, results, summary, onStatusChange]);

  /** Matches office_name OR tally_party — a name only ever embedded as text
   *  inside a DIFFERENT record's card (the ledger side of a paired dispute, or a
   *  rival named only in a reason sentence) is otherwise unfindable, since there
   *  is no card titled with it to scan for. */
  const bySearch = (list: ResultRow[], q: string): ResultRow[] =>
    q ? list.filter((r) => [r.office_name, r.tally_party].filter(Boolean).join(" ").toLowerCase().includes(q)) : list;

  const issueRows = useMemo(() => {
    const q = recordSearch.trim().toLowerCase();
    return bySearch((results || []).filter((r) => isTallyIssue(r.result)), q)
      .sort((a, b) => (a.overridden ? 1 : 0) - (b.overridden ? 1 : 0));
  }, [results, recordSearch]);
  const cardFiltered = useMemo((): ResultRow[] | null => {
    const rs = results || [];
    const q = recordSearch.trim().toLowerCase();
    switch (activeFilter) {
      case "total": return bySearch(rs, q); case "matched": return bySearch(rs.filter((r) => r.result === "Matched"), q);
      case "issues": return bySearch(rs.filter((r) => isTallyIssue(r.result) && !r.overridden), q);
      case "mapped": return bySearch(rs.filter((r) => r.mapped), q); case "overridden": return bySearch(rs.filter((r) => r.overridden), q);
      default: return null;
    }
  }, [results, activeFilter, recordSearch]);

  /** Ledger records offered by the picker: the engine's suggestion first, then the
   *  rest in ledger order. Only CREDIT rows — those are the deductions the engine
   *  pairs against, so mapping to a party that never appears as a credit could not
   *  match anything. "suggested" is party-level because the saved mapping is.
   *
   *  Excludes any credit ALREADY paired to a DIFFERENT office record (Matched,
   *  mapped, or simply the candidate a weaker tier already assigned) — otherwise
   *  the picker would let two office records both claim the same ledger entry,
   *  a conflict nothing else in this dialog would surface. Identified by VALUE
   *  (party+date+credit), not position: `tally_row_index` is a raw file row_index
   *  and collides across the several files a filing's ledger is imported from. */
  const pickRows = useMemo(() => {
    const sug = pickTarget?.tally_party ? normalizeName(pickTarget.tally_party) : null;
    const claimed = new Set(
      (results || [])
        .filter((r) => r.id !== pickTarget?.id && r.tally_party && r.tally_date != null && r.tally_credit != null)
        .map((r) => `${normalizeName(r.tally_party)}|${r.tally_date}|${r.tally_credit}`),
    );
    const rows = tallyRows
      .filter((t) => t.party && t.credit != null && Number(t.credit) !== 0)
      .filter((t) => !claimed.has(`${normalizeName(t.party)}|${t.date}|${t.credit}`))
      .map((t, i) => ({ t, i, suggested: !!sug && normalizeName(t.party) === sug }));
    const q = pickQuery.trim().toLowerCase();
    const hit = q
      ? rows.filter(({ t }) => [t.party, t.date, t.iso, t.section, t.credit == null ? "" : String(t.credit), inr(t.credit)]
          .filter(Boolean).join(" ").toLowerCase().includes(q))
      : rows;
    return [...hit].sort((a, b) => (b.suggested ? 1 : 0) - (a.suggested ? 1 : 0) || a.i - b.i);
  }, [tallyRows, pickTarget, pickQuery]);

  /** Office records offered by the REVERSE picker (opened from a ledger-only card).
   *  Candidates are office records genuinely unpaired ("Ledger Entry Not Found",
   *  not overridden or already mapped) — anything else already has a claimed
   *  counterpart, even if disputed, so offering it here would let one office
   *  record be mapped to two different ledger credits at once. */
  const pickOfficeRows = useMemo(() => {
    const rows = (results || [])
      .filter((r) => r.office_name && r.result === "Ledger Entry Not Found" && !r.overridden && !r.mapped)
      .map((r, i) => ({ r, i }));
    const q = officePickQuery.trim().toLowerCase();
    return q
      ? rows.filter(({ r }) => [r.office_name, r.office_date, r.office_section, r.office_tds == null ? "" : String(r.office_tds), inr(r.office_tds)]
          .filter(Boolean).join(" ").toLowerCase().includes(q))
      : rows;
  }, [results, officePickQuery]);

  /** The Override button's label. Every genuine DISPUTE over an existing pairing
   *  (Party Name Mismatch, Date Mismatch, …) keeps the plain generic "Override".
   *  The two ONE-SIDED results get their own explicit label instead — the user's
   *  action here isn't "accept a difference", it's "confirm this record belongs
   *  to only one side of the books", which deserves saying so directly. */
  const overrideLabel = (r: ResultRow): string =>
    r.result === "Ledger Entry Not Found" ? "Keep as Office Data Only"
      : r.result === "Office Data Not Found" ? "Keep as Tally Ledger Only"
      : "Override";

  /** Office vs Ledger, one row per comparable field, for a record that IS paired
   *  to a specific ledger entry but disputed (anything except "Matched" — that
   *  needs no highlighting since nothing disagrees). Replaces a single "Ledger:
   *  X" sub-line: the field the record's own `result` is actually about is
   *  flagged, so the checker sees BOTH sides at a glance instead of having to
   *  hunt for the ledger party buried in a sentence. */
  const disputeTable = (r: ResultRow) => {
    const rows: { label: string; office: string; ledger: string; flagged: boolean }[] = [
      { label: "Party", office: r.office_name || "—", ledger: r.tally_party || "—", flagged: r.result === "Party Name Mismatch" },
      { label: "Date", office: r.office_date || "—", ledger: r.tally_date || "—", flagged: r.result === "Date Mismatch" },
      { label: "Amount", office: inr(r.office_tds ?? r.office_amount), ledger: inr(r.tally_credit), flagged: r.result === "Credit Amount Mismatch" },
    ];
    return (
      <table className="w-full text-[11px] border rounded-md overflow-hidden">
        <thead className="bg-muted/50">
          <tr><th className="text-left px-2 py-1 font-medium w-14">Field</th><th className="text-left px-2 py-1 font-medium">Office</th><th className="text-left px-2 py-1 font-medium">Ledger</th></tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label} className={cn(row.flagged && "bg-destructive/5")}>
              <td className="px-2 py-1 text-muted-foreground">{row.label}</td>
              <td className={cn("px-2 py-1", row.flagged && "text-destructive font-medium")}>{row.office}</td>
              <td className={cn("px-2 py-1", row.flagged && "text-destructive font-medium")}>{row.ledger}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  };

  /** A ledger credit no office record claims (result "Office Data Not Found") —
   *  anchored on the LEDGER side instead of the office side, the mirror image of
   *  the office-anchored card below. Same actions, reversed: Override reads
   *  "Keep as Tally Ledger Only", and instead of picking a ledger record for an
   *  office record, the checker picks an OFFICE record for this ledger credit. */
  const renderLedgerOnlyCard = (r: ResultRow) => (
    <Card key={r.id} className={cn(r.overridden ? "border-blue-200 dark:border-blue-900 opacity-80" : "border-destructive/30")}>
      <CardContent className="p-4 space-y-1.5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0"><p className="font-semibold text-sm truncate">{r.tally_party || "—"}</p>
            <p className="text-[11px] text-muted-foreground">{r.tally_date || "—"} · ledger credit {inr(r.tally_credit)}</p></div>
          <div className="flex items-center gap-2 shrink-0">
            <Badge className={cn("text-[10px]", RESULT_BADGE[r.result] || "bg-muted")}>{r.result}</Badge>
            {!r.overridden ? <Button variant="outline" size="sm" className="h-7 gap-1 text-xs" onClick={() => openOverride(r)} disabled={disabled}><ShieldCheck size={12} /> {overrideLabel(r)}</Button>
              : <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={() => undoOverride(r)}><RotateCcw size={12} /> Undo</Button>}
          </div>
        </div>
        <p className={cn("text-xs", r.overridden ? "text-blue-600" : "text-destructive")}>
          {r.overridden ? `Overridden — ${r.override_reason || "accepted"}${r.overridden_by && userMap[r.overridden_by] ? ` · ${userMap[r.overridden_by]}` : ""}` : r.reason}
        </p>
        {!r.overridden && (
          <div className="flex items-center gap-2 flex-wrap p-2 rounded-md border border-amber-200 dark:border-amber-900 bg-amber-50/50 dark:bg-amber-950/20 text-xs">
            <Link2 size={13} className="text-amber-600 shrink-0" />
            <span className="text-foreground min-w-0">No office record matches <b>{r.tally_party}</b> — it may belong to a deductee booked under a different name.</span>
            <div className="flex-1" />
            <Button size="sm" variant="outline" className="h-6 text-xs px-2 gap-1 shrink-0" disabled={disabled || validating} onClick={() => openOfficePicker(r)}>
              <Search size={11} /> Map to office record
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );

  const renderCard = (r: ResultRow) => r.office_name == null ? renderLedgerOnlyCard(r) : (
    <Card key={r.id} className={cn(r.overridden ? "border-blue-200 dark:border-blue-900 opacity-80" : r.result === "Matched" ? "border-emerald-200 dark:border-emerald-900" : "border-destructive/30")}>
      <CardContent className="p-4 space-y-1.5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0"><p className="font-semibold text-sm truncate">{r.office_name || "—"}</p>
            <p className="text-[11px] text-muted-foreground">{r.office_date || "—"} · office {inr(r.office_amount)} / TDS {inr(r.office_tds)} · {r.office_section || "—"}</p></div>
          <div className="flex items-center gap-2 shrink-0">
            <Badge className={cn("text-[10px]", RESULT_BADGE[r.result] || "bg-muted")}>{r.result}</Badge>
            {typeof r.confidence === "number" && <span className="text-[10px] text-muted-foreground">{r.confidence}%</span>}
            {!r.overridden ? <Button variant="outline" size="sm" className="h-7 gap-1 text-xs" onClick={() => openOverride(r)} disabled={disabled}><ShieldCheck size={12} /> {overrideLabel(r)}</Button>
              : <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={() => undoOverride(r)}><RotateCcw size={12} /> Undo</Button>}
            {/* Only a manually-mapped record can be unmapped. It sits with the other
                record actions rather than as a text link buried in the details. */}
            {r.mapped && (
              <Button variant="outline" size="sm" className="h-7 gap-1 text-xs text-muted-foreground hover:text-destructive"
                disabled={disabled || validating} onClick={() => unmapParty(r)} title="Remove the saved party mapping and re-validate">
                <Unlink size={12} /> Unmap
              </Button>
            )}
          </div>
        </div>
        {/* Genuinely paired + disputed: BOTH sides, field by field, with the
            actually-wrong one flagged — not a subdued one-liner the ledger side
            can get lost in. A clean Match keeps the terser summary; nothing there
            needs highlighting. */}
        {r.tally_party != null && r.result !== "Matched" ? disputeTable(r) : r.tally_party != null && (
          <p className="text-[11px] text-muted-foreground flex items-center gap-1.5 flex-wrap">
            <span>Ledger: <b className="text-foreground">{r.tally_party}</b> · {r.tally_date || "—"} · credit {inr(r.tally_credit)}</span>
            {r.mapped && <Badge variant="secondary" className="text-[9px] px-1 py-0 h-4">party mapped</Badge>}
          </p>
        )}
        <p className={cn("text-xs", r.overridden ? "text-blue-600" : r.result === "Matched" ? "text-emerald-600" : "text-destructive")}>
          {r.overridden ? `Overridden — ${r.override_reason || "accepted"}${r.overridden_by && userMap[r.overridden_by] ? ` · ${userMap[r.overridden_by]}` : ""}` : r.reason}
        </p>
        {/* Offer the mapping whenever a credible ledger candidate was found whose
            PARTY differs — not only on "Party Name Mismatch". The common real case
            is a ledger entry that is a few days out AND booked under the
            proprietor's personal name, which lands on "Date Mismatch"; gating the
            button on that one result made the mapping feature unreachable.
            "Ledger Entry Not Found" gets the SAME resolution path even though it
            has no auto-suggested candidate (tally_party is null — nothing paired):
            the office record may still be sitting in the ledger under a name the
            engine's search missed, so offer a manual pick rather than nothing. */}
        {mappingOffer(r) ? (
          <div className="flex items-center gap-2 flex-wrap p-2 rounded-md border border-amber-200 dark:border-amber-900 bg-amber-50/50 dark:bg-amber-950/20 text-xs">
            <Link2 size={13} className="text-amber-600 shrink-0" />
            <span className="text-foreground min-w-0">Suggested mapping: <b>{r.office_name}</b> ↔ <b>{r.tally_party}</b></span>
            <div className="flex-1" />
            {/* A suggestion, never an assumption: the same date + TDS amount can
                belong to two different parties, so the user decides. */}
            <div className="flex items-center gap-2 shrink-0">
              <Button size="sm" className="h-6 text-xs px-2" disabled={disabled || validating} onClick={() => saveMapping(r.office_name, r.tally_party)}>Confirm mapping</Button>
              <Button size="sm" variant="outline" className="h-6 text-xs px-2 gap-1" disabled={disabled || validating}
                onClick={() => openPicker(r)} title="The suggestion is based on date and amount only — pick the correct ledger record yourself">
                <Search size={11} /> Choose another record
              </Button>
            </div>
          </div>
        ) : r.result === "Ledger Entry Not Found" && !r.overridden && !r.mapped && r.office_name && (
          <div className="flex items-center gap-2 flex-wrap p-2 rounded-md border border-amber-200 dark:border-amber-900 bg-amber-50/50 dark:bg-amber-950/20 text-xs">
            <Link2 size={13} className="text-amber-600 shrink-0" />
            <span className="text-foreground min-w-0">No automatic ledger match for <b>{r.office_name}</b> — it may be booked under a different name.</span>
            <div className="flex-1" />
            <Button size="sm" variant="outline" className="h-6 text-xs px-2 gap-1 shrink-0" disabled={disabled || validating} onClick={() => openPicker(r)}>
              <Search size={11} /> Map to ledger record
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );

  if (!filing) return null;

  return (
    <div className="space-y-3">
      <div className="grid gap-2 md:grid-cols-2 items-start">
        <Card><CardContent className="p-2.5">
          <div className="flex items-center gap-2">
            <Users size={14} className="text-muted-foreground shrink-0" />
            <p className="font-semibold text-xs whitespace-nowrap">Office Data</p>
            <div className="flex-1" />
            <span className="text-xs whitespace-nowrap"><b className="text-sm font-bold">{officeCount}</b> <span className="text-muted-foreground">records</span></span>
          </div>
          {officeCount === 0 && <p className="text-[11px] text-amber-600 mt-1.5">No office records yet — enter data in the Data Entry tab first.</p>}
        </CardContent></Card>
        <Card><CardContent className="p-2.5">
          <div className="flex items-center gap-2">
            <FileSpreadsheet size={14} className="text-muted-foreground shrink-0" />
            <p className="font-semibold text-xs whitespace-nowrap">Imported Tally Ledger</p>
            {batches.length > 0 && (
              <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                <b className="text-xs font-bold text-foreground">{ledgerRowCount}</b> rows{batches.length > 1 ? ` · ${batches.length} files` : ""}{ledgerSections.length ? ` · ${ledgerSections.join(", ")}` : ""}
              </span>
            )}
            {validating && <span className="text-[10px] text-amber-600 flex items-center gap-1 shrink-0"><Loader2 size={10} className="animate-spin" /> reconciling…</span>}
            <div className="flex-1" />
            <input ref={fileRef} type="file" multiple accept=".pdf,application/pdf" className="hidden"
              onChange={(e) => { const picked = Array.from(e.target.files ?? []); if (picked.length) handleImportMany(picked); e.currentTarget.value = ""; }} />
            <Button size="sm" variant={batches.length ? "outline" : "default"} className="gap-1 h-6 px-2 text-[11px] shrink-0" disabled={importing || disabled} onClick={() => fileRef.current?.click()}>
              {importing ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}{batches.length ? "Add / re-import" : "Import ledger PDF"}
            </Button>
          </div>
          {batches.length ? (
            <div className="text-sm">
              <div className="mt-1.5 space-y-0.5 max-h-24 overflow-y-auto">
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
          ) : <p className="text-[11px] text-muted-foreground">Import the Tally <b>Ledger Account PDF</b> for each TDS section (194A, 194C, 194J, 194T …) — in Tally open the ledger and print/export it to PDF. The section, dates, parties and TDS (credit) amounts are read from the PDF; they combine across files. Re-importing the same file name replaces it. Stage 3 is optional.</p>}
        </CardContent></Card>
      </div>

      <div className="flex items-center gap-3">
        <Button className="gap-2 font-semibold h-9" onClick={runValidation} disabled={validating || !batches.length || officeCount === 0 || disabled}>
          {validating ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}{validating ? "Validating…" : "Run Validation"}
        </Button>
        {!batches.length ? <span className="text-xs text-muted-foreground">Import the Tally ledger to enable reconciliation.</span> : officeCount === 0 ? <span className="text-xs text-muted-foreground">No office records to reconcile.</span> : null}
        <div className="flex-1" />
        {results && (
          <TdsExportMenu
            build={stage3Report}
            meta={{ client: clientName || "—", form: selForm, quarter: selQuarter, fy: selFy }}
            label="Export Stage 3"
          />
        )}
      </div>

      {results && (<>
        <div className={cn("grid grid-cols-2 sm:grid-cols-5 gap-2", validating && "animate-pulse")}>
          {([
            { key: "total" as const, label: "Total", value: summary.total, cls: "" },
            { key: "matched" as const, label: "Matched", value: summary.matched, cls: "text-emerald-600" },
            { key: "issues" as const, label: "Mismatched", value: summary.issues, cls: summary.issues > 0 ? "text-destructive" : "text-emerald-600" },
            { key: "mapped" as const, label: "Mapped", value: summary.mapped, cls: "text-blue-600" },
            { key: "overridden" as const, label: "Overridden", value: summary.overridden, cls: "text-blue-600" },
          ]).map((s) => (
            <button key={s.label} type="button" onClick={() => { setActiveFilter(activeFilter === s.key ? null : s.key); setErrorTypeFilter(null); }} aria-pressed={activeFilter === s.key}
              className={cn("rounded-md border bg-card p-2 text-center transition-all hover:border-primary/50 hover:shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary", activeFilter === s.key ? "ring-2 ring-primary border-primary" : "border-border")}>
              <p className={cn("text-xl font-bold tabular-nums", s.cls)}><AnimatedNumber value={s.value} /></p><p className="text-[11px] text-muted-foreground">{s.label}</p>
            </button>
          ))}
        </div>
        {/* Free-text search over the WHOLE list, on top of whichever summary-card
            filter is active — the only way to locate a name that's only ever
            embedded text inside a different record's card (see bySearch above). */}
        <div className="flex items-center gap-2">
          <Input value={recordSearch} onChange={(e) => setRecordSearch(e.target.value)} placeholder="Search by office or ledger party name…" className="h-8 text-xs" />
          {recordSearch && <Button variant="ghost" size="sm" className="h-8 text-xs gap-1 shrink-0" onClick={() => setRecordSearch("")}><X size={11} /> Clear</Button>}
        </div>
        {cardFiltered !== null ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs px-1"><span className="text-muted-foreground">Showing <b className="text-foreground">{cardFiltered.length}</b> record(s)</span>
              <Button variant="ghost" size="sm" className="h-6 text-xs gap-1" onClick={() => setActiveFilter(null)}><X size={11} /> Clear</Button></div>
            {cardFiltered.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground rounded-lg border border-dashed">
                {recordSearch ? "No records match your search." : `No ${activeFilter} records.`}
              </div>
            ) : (
              <div className="space-y-3">
                {activeFilter === "issues" && (
                  <ErrorTypeBreakdown rows={cardFiltered} getType={(r) => r.result} activeType={errorTypeFilter} onSelectType={setErrorTypeFilter} />
                )}
                {(activeFilter === "issues" ? filterByErrorType(cardFiltered, (r) => r.result, errorTypeFilter) : cardFiltered).map(renderCard)}
              </div>
            )}
          </div>
        ) : summary.total === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground rounded-lg border border-dashed">No office records to reconcile for this filing.</div>
        ) : issueRows.length === 0 ? (
          recordSearch ? (
            <div className="p-8 text-center text-sm text-muted-foreground rounded-lg border border-dashed">No records match your search.</div>
          ) : (
            <Card className="border-emerald-200 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-950/20"><CardContent className="p-4 space-y-2">
              <div className="flex items-center gap-2"><CheckCircle2 size={22} className="text-emerald-600" /><p className="text-lg font-bold text-emerald-700 dark:text-emerald-300">Tally Reconciliation Completed</p></div>
              <p className="text-sm text-muted-foreground">All {summary.total} office records were found in the Tally ledger with matching date, amount and party.</p>
            </CardContent></Card>
          )
        ) : (
          <div className="space-y-3">
            <ErrorTypeBreakdown rows={issueRows} getType={(r) => r.result} activeType={errorTypeFilter} onSelectType={setErrorTypeFilter} />
            {filterByErrorType(issueRows, (r) => r.result, errorTypeFilter).map(renderCard)}
          </div>
        )}
      </>)}

      <Dialog open={ovOpen} onOpenChange={setOvOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{ovTarget ? overrideLabel(ovTarget) : "Override"} — {ovTarget?.result}</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            {/* A ledger-only record has no office_name — fall back to its own
                (ledger) identity so this line is never blank. */}
            <p className="text-sm text-muted-foreground">{ovTarget?.office_name || ovTarget?.tally_party} · {ovTarget?.office_date || ovTarget?.tally_date}</p>
            <div className="space-y-1"><Label className="text-xs">Override reason <span className="text-destructive">*</span></Label>
              <Select value={ovReason} onValueChange={setOvReason}><SelectTrigger><SelectValue placeholder="Select a reason" /></SelectTrigger>
                <SelectContent>{["Verified manually against Tally", "Timing/period difference accepted", "Rounding difference accepted", "Entry in another ledger", "Other"].map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent></Select></div>
            {ovReason === "Other" && <div className="space-y-1"><Label className="text-xs">Please specify <span className="text-destructive">*</span></Label><Textarea value={ovOther} onChange={(e) => setOvOther(e.target.value)} rows={2} /></div>}
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setOvOpen(false)}>Cancel</Button>
            <Button onClick={saveOverride} disabled={savingOv || !ovReason || (ovReason === "Other" && !ovOther.trim())}>{savingOv ? "Saving…" : "Confirm Override"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={pickOpen} onOpenChange={setPickOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle className="text-base">Choose the ledger record</DialogTitle></DialogHeader>
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              Office record: <b className="text-foreground">{pickTarget?.office_name || "—"}</b> · {pickTarget?.office_date || "—"} · TDS {inr(pickTarget?.office_tds)} · {pickTarget?.office_section || "—"}
            </p>
            <Input value={pickQuery} onChange={(e) => setPickQuery(e.target.value)} placeholder="Search by party, date or amount…" className="h-8 text-xs" />
            <ScrollArea className="h-72 rounded-md border">
              {pickRows.length === 0 ? (
                <p className="p-6 text-center text-xs text-muted-foreground">
                  {tallyRows.length ? "No ledger record matches that search." : "No ledger records — import the Tally ledger PDF first."}
                </p>
              ) : (
                <div className="p-1 space-y-0.5">
                  {pickRows.map(({ t, i, suggested }) => (
                    <button key={i} type="button" disabled={disabled || validating} onClick={() => pickRecord(t.party)}
                      className="w-full text-left flex items-center gap-2 rounded px-2 py-1.5 hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50">
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium truncate">{t.party}</p>
                        <p className="text-[10px] text-muted-foreground">{t.date || t.iso || "—"} · credit {inr(t.credit)} · {t.section || "—"}</p>
                      </div>
                      {suggested && <Badge variant="secondary" className="text-[9px] px-1 py-0 h-4 shrink-0">suggested</Badge>}
                    </button>
                  ))}
                </div>
              )}
            </ScrollArea>
            <p className="text-[10px] text-muted-foreground">Selecting a record saves "{pickTarget?.office_name || "—"}" ↔ that ledger party for this client and re-runs the reconciliation.</p>
          </div>
          <DialogFooter><Button variant="outline" size="sm" onClick={() => setPickOpen(false)}>Cancel</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={officePickOpen} onOpenChange={setOfficePickOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle className="text-base">Choose the office record</DialogTitle></DialogHeader>
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              Ledger record: <b className="text-foreground">{officePickTarget?.tally_party || "—"}</b> · {officePickTarget?.tally_date || "—"} · credit {inr(officePickTarget?.tally_credit)}
            </p>
            <Input value={officePickQuery} onChange={(e) => setOfficePickQuery(e.target.value)} placeholder="Search by party, date or amount…" className="h-8 text-xs" />
            <ScrollArea className="h-72 rounded-md border">
              {pickOfficeRows.length === 0 ? (
                <p className="p-6 text-center text-xs text-muted-foreground">
                  {(results || []).some((r) => r.office_name) ? "No unmatched office record matches that search." : "No office records to reconcile for this filing."}
                </p>
              ) : (
                <div className="p-1 space-y-0.5">
                  {pickOfficeRows.map(({ r, i }) => (
                    <button key={i} type="button" disabled={disabled || validating} onClick={() => pickOfficeRecord(r.office_name)}
                      className="w-full text-left flex items-center gap-2 rounded px-2 py-1.5 hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50">
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium truncate">{r.office_name}</p>
                        <p className="text-[10px] text-muted-foreground">{r.office_date || "—"} · TDS {inr(r.office_tds)} · {r.office_section || "—"}</p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </ScrollArea>
            <p className="text-[10px] text-muted-foreground">Selecting a record saves that office party ↔ "{officePickTarget?.tally_party || "—"}" for this client and re-runs the reconciliation.</p>
          </div>
          <DialogFooter><Button variant="outline" size="sm" onClick={() => setOfficePickOpen(false)}>Cancel</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
