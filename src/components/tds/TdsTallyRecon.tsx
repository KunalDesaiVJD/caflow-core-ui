import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { uploadTdsImportFile } from "@/lib/tds/uploadImportFile";
import { viewStorageFile, downloadStorageFile, removePublicDocumentByUrl } from "@/lib/openStorageFile";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { ShieldCheck, CheckCircle2, XCircle, Upload, FileSpreadsheet, Loader2, RotateCcw, X, Play, Users, Link2, Unlink, Search, Pencil, Eye, Download } from "lucide-react";
import { pdfToTextPages } from "@/lib/tds/pdfText";
import { parseTallyPdfPages } from "@/lib/tds/tallyPdf";
import { parseExpertPdfPages } from "@/lib/tds/expertPdf";
import { logReconAudit } from "@/lib/tdsReconAudit";
import { TdsExportMenu } from "./TdsExportMenu";
import { ErrorTypeBreakdown, filterByErrorType } from "./ErrorTypeBreakdown";
import type { StageReport, ReportMeta, AuditRow } from "@/lib/tds/tdsReport";
import { makeDateNormaliser, normalizeName, canonicalSection, nameCompare } from "@/lib/tds/match";
import {
  reconcileTallyFull, mergeDualLedgerResults, aggregateTaxableByEmployeeMonth, resolveTaxableIncomeReading,
  SPLIT_FOLD_CONFIDENCE, oneSidedLabel,
  type OfficeTxn, type TallyRow, type TallyReconRow, type PartyMap, type TallyResult,
} from "@/lib/tds/tallyRecon";

/** Stage-3 status for the parent filing gate (optional, like Stage-2). */
export interface TallyStageStatus {
  filingId: string | null; loaded: boolean; applicable: boolean; ran: boolean;
  total: number; matched: number; issues: number; overridden: number;
  /** True only when a user deliberately bypassed Tally verification (client's
   *  books aren't maintained in Tally) — as opposed to `!applicable` from
   *  simply never having imported a ledger. Both make `applicable` false, so
   *  the filing gate doesn't need this; it exists purely so the checklist/UI
   *  can show "bypassed" instead of the generic "optional" label. */
  bypassed?: boolean;
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
  // Called after any real Stage-3 activity (a completed reconciliation run)
  // so the parent can auto-advance the filing out of "Not Started".
  onActivity?: () => void;
}

interface ResultRow {
  id: string; office_deductee_id: string | null;
  office_name: string | null; office_date: string | null; office_amount: number | null; office_tds: number | null; office_section: string | null;
  tally_party: string | null; tally_date: string | null; tally_credit: number | null;
  result: TallyResult; amount_basis: string | null; reason: string | null; confidence: number | null; mapped: boolean;
  overridden: boolean; override_reason: string | null; overridden_by: string | null; overridden_at?: string | null;
  // 24Q dual-ledger — null/undefined for every single-ledger row (see tallyRecon.ts's mergeDualLedgerResults).
  salary_tally_row_index?: number | null; salary_tally_party?: string | null; salary_tally_date?: string | null; salary_tally_credit?: number | null;
  taxable_income_status?: string | null; tds_status?: string | null;
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
  // 24Q dual-ledger combined verdicts
  "Name Mismatch": "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
  "Taxable Income Missing from Salary Ledger": "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
  "Taxable Income Missing from Office Data": "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
  "Taxable Income Amount Mismatch": "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
  "TDS Missing from TDS Ledger": "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
  "TDS Missing from Office Data": "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
  "TDS Amount Mismatch": "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
};
// Kept in sync with tallyRecon.ts's own inr(): the reason text built there
// and the Office/Ledger comparison table built here must show the SAME
// number for the SAME figure. Money verdicts flag any gap of ₹0.005+
// (EXACT_EPS, see tallyRecon.ts), tighter than whole-rupee rounding — a
// sub-rupee gap (routine: Tally often carries paise, office TDS is entered
// rounded to the whole rupee) must stay visible here too, or a flagged
// "Credit Amount Mismatch" row shows identical Office/Ledger numbers with no
// visible difference, reading as a false positive when it isn't one.
const inr = (n: number | null | undefined) => {
  if (n == null) return "—";
  const v = Number(n);
  const hasPaise = Math.abs(v - Math.round(v)) >= 0.005;
  return hasPaise
    ? `₹${v.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : `₹${Math.round(v).toLocaleString("en-IN")}`;
};
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
 * Stage-3 imports ledger PDFs ONLY — no Excel/CSV path (a ledger exported to
 * Excel loses the ledger/section name and every client's export settings
 * produced a different sheet shape, which is what made Stage-3 need a fix per
 * client). The PRINTED ledger PDF is the one artefact each accounting package
 * emits identically for every client and every section, so each parser can
 * learn that one structure once.
 *
 * Two accounting packages are supported, as two wholly independent parsers
 * (src/lib/tds/tallyPdf.ts and src/lib/tds/expertPdf.ts — neither imports the
 * other, by design, since the two ledger formats are unrelated): Tally's
 * "Ledger Account" print and "Expert"'s ledger print. Which one a given file
 * is is AUTO-DETECTED from its own column header — a Tally print always has
 * a Particulars/Debit/Credit header, an Expert print always has a
 * Particulars/Dr.Amount/Cr.Amount header — so the user never has to say which
 * software a file came from; a wrong guess would just fail to find a header
 * and fall through to the other parser.
 */
async function parseLedgerFile(file: File) {
  if (!file.name.toLowerCase().endsWith(".pdf")) {
    throw new Error("Stage 3 reads ledger PDFs only (Tally or Expert). Export the ledger as PDF and import that.");
  }
  const pages = await pdfToTextPages(file);

  const tally = parseTallyPdfPages(pages);
  const tallyHeaderFound = !tally.issues.some((i) => i.includes("no Tally ledger column header"));
  if (tallyHeaderFound) {
    if (!tally.rows.length) throw new Error(tally.issues[0] || "No deduction (credit) entries found — is this a Tally Ledger Account print?");
    return { rows: tally.rows, section: tally.section, label: tally.ledgerName || file.name, period: tally.period, issues: tally.issues, skipped: tally.skipped, source: "Tally" as const };
  }

  const expert = parseExpertPdfPages(pages);
  const expertHeaderFound = !expert.issues.some((i) => i.includes("no Expert ledger column header"));
  if (expertHeaderFound) {
    if (!expert.rows.length) throw new Error(expert.issues[0] || "No deduction (credit) entries found — is this an Expert ledger print?");
    return { rows: expert.rows, section: expert.section, label: expert.company || file.name, period: expert.period, issues: expert.issues, skipped: expert.skipped, source: "Expert" as const };
  }

  throw new Error("Unrecognised ledger format — Stage 3 reads Tally Ledger Account PDFs or Expert ledger PDFs. Export one of those and import it.");
}

const isTallyIssue = (r: string) => r !== "Matched";

/** The same party on both sides — identical once normalised, or one name cut
 *  short by the ledger print (Expert truncates "SHREE BALAJI POLY FILMS
 *  PRIVATE LIMITED" to "…PRIVA"). Used only to word the "not found" hint. */
const sameLedgerParty = (a: string | null | undefined, b: string | null | undefined): boolean => {
  const x = normalizeName(a), y = normalizeName(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return short.length >= 12 && long.startsWith(short);
};

/**
 * A row anchored to an actual Office Data (Data Entry) record — as opposed to
 * a pure ledger-surplus row (office_deductee_id/office_name both null, see
 * runAudit's surplusRows), which exists only because SOME ledger credit had
 * no office record to claim it.
 */
export const isOfficeAnchored = (r: ResultRow) => r.office_deductee_id != null || r.office_name != null;

/**
 * Whether a mismatch should be shown to the user as one — vs. merely existing
 * in `results` for the dual reconciliation's own internal mapping/matching
 * purposes. Everywhere except 24Q this is identical to isTallyIssue: every
 * exception in either direction is a real mismatch to review.
 *
 * 24Q is a deliberate exception (firm policy, not a defect): a ledger credit
 * with no Office Data counterpart ("Taxable Income/TDS Missing from Office
 * Data") must still run and persist — the dual reconciliation stays fully
 * live in the background for mapping, name identification and record
 * matching (isOpenRow below is untouched, so those rows remain valid mapping
 * candidates) — but it must not surface as a REVIEWABLE mismatch. Only a
 * Data-Entry-anchored record failing to reconcile against the ledger counts.
 */
export const isDisplayMismatch = (r: ResultRow, form: string) =>
  isTallyIssue(r.result) && (form !== "24Q" || isOfficeAnchored(r));

/**
 * Whether a record is still "open" — i.e. eligible to appear as a mapping
 * candidate on the OPPOSITE side's picker. A record stops being open only once
 * it is CONFIRMED one way or another: auto-Matched by the engine, manually
 * mapped, or approved as a one-sided override. Merely being REFERENCED
 * elsewhere — as its own still-unclaimed surplus row, or as another record's
 * tentative/unconfirmed engine suggestion — is NOT a claim. Getting this wrong
 * is exactly what broke bidirectional mapping: a ledger row that had its own
 * open "Office Data Not Found" surplus entry was being treated as claimed by
 * ITSELF, so it could never be offered to a different unmatched office record.
 *
 * Deliberately NOT form-gated like isDisplayMismatch — 24Q's ledger-surplus
 * rows must stay open mapping candidates even though they're hidden from the
 * mismatch display; that's the entire point of keeping dual reconciliation
 * running in the background for 24Q.
 */
const isOpenRow = (r: ResultRow) => isTallyIssue(r.result) && !r.mapped && !r.overridden;

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
  if (!r.office_name) return null;
  // 24Q dual-ledger's own relabelling of "Party Name Mismatch" (see
  // mergeDualLedgerResults). The mismatching side may be EITHER ledger, and the
  // per-figure sub-statuses say WHICH — read them rather than defaulting to the
  // TDS party, or an employee whose TDS ledger matched cleanly while the SALARY
  // name differs would offer a mapping to the already-correct TDS party,
  // saving a mapping that resolves nothing and leaving the mismatch for ever.
  if (r.result === "Name Mismatch" || r.result === "Party Name Mismatch") {
    if (r.taxable_income_status === "Name Mismatch") return r.salary_tally_party || null;
    if (r.tds_status === "Name Mismatch") return r.tally_party || null;
    return r.tally_party || r.salary_tally_party || null;
  }
  if (!r.tally_party) return null;
  const cmp = nameCompare(r.office_name, r.tally_party);
  return cmp === "match" || cmp === "unknown" ? null : r.tally_party;
};

export function TdsTallyRecon({ filing, selClient, selFy, selQuarter, selForm, clientName, resolveFirmId, disabled, onStatusChange, onActivity }: Props) {
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
  // Mirrors Stage 1/2's own replaceTargetId + shared file input: set right
  // before a synthetic click on fileRef, read (and cleared) in its onChange.
  const [replaceTargetId, setReplaceTargetId] = useState<string | null>(null);
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

  // Bypass Tally Verification — for a client whose books aren't maintained in
  // Tally at all. Same "latest of a pair of action types wins" persistence as
  // the Stage-4 digital signature (tds_filing_audit_log, no migration), read
  // back in loadAll. While bypassed, this stage reports applicable:false to
  // the parent's onStatusChange — the SAME mechanism that already lets Stage 3
  // skip canFile/fileBlockReason when no ledger was ever imported (see
  // TallyStageStatus's own doc) — so no change was needed in the parent's
  // filing-gate logic at all.
  const [bypass, setBypass] = useState<{ byName: string; at: string } | null>(null);
  const [bypassOpen, setBypassOpen] = useState(false);
  const [bypassConfirmChecked, setBypassConfirmChecked] = useState(false);
  const [bypassSaving, setBypassSaving] = useState(false);

  // Correct an imported ledger's own SECTION after the fact — a real,
  // confirmed need: a client's Tally ledger can be mislabelled at the source
  // (e.g. a ledger titled "TDS on Machinery Rent 2% (194IA) - 1008" is
  // genuinely Section 194-I — Plant & Machinery rent's own rate is 2%; 194-IA,
  // property purchase, has no 2%/rent concept at all), which otherwise
  // permanently blocks both automatic AND manual matching against Office
  // Data's correctly-coded records — the section filter applies uniformly to
  // both (see pickSectionBlockedCount's own doc). Corrects tds_tally_batches
  // AND every tds_tally_rows row it owns (rows carry their own section, not a
  // batch-level lookup — see handleImport's own comment on why), then
  // re-validates so the newly-unblocked records get a real chance to match.
  const [editingSectionBatchId, setEditingSectionBatchId] = useState<string | null>(null);
  const [editingSectionValue, setEditingSectionValue] = useState("");
  const [savingSectionEdit, setSavingSectionEdit] = useState(false);

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
    // Scoped by filing_id, not by "attached to one of this filing's challans"
    // — a challan is routinely reused across a client's 24Q and 26Q filings
    // (one combined bank deposit, allocated across both returns), so a
    // challan_id-only join over-collects a DIFFERENT filing's deductees. Same
    // fix as Stage 1 (tds-recon-compare) and Stage 2 (TdsPanVerification).
    const { data: ded } = await supabase.from("tds_deductees")
      .select("id, deductee_name, deductee_pan, date_of_payment, amount_paid_credited, tds_amount, total_tax_deducted, section_code, nature_of_payment").eq("filing_id", fId);
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
      // Only tallyPdf.ts's compound-Journal rows ever populate this — it
      // rides free inside the `raw` jsonb blob (no migration), stored there
      // by handleImport's `raw: r` below. Display only, see TallyRow's own doc.
      narration: t.raw?.narration ?? null,
      // Same free ride — set only for the expense-ledger "taxable income"
      // case (tallyPdf.ts), undefined for every other row (unaffected).
      amountKind: t.raw?.amountKind ?? undefined,
      // Same free ride again — the total tax-line amount tallyPdf.ts
      // excluded from THIS row's own credit (see TallyRow's own doc).
      // Dropping this here silently disabled resolveTaxableIncomeReading
      // for every ledger reconciled through the normal Import → Run
      // Validation flow: the parse itself carried ptExcluded correctly (it
      // rides inside `raw`, stored as-is by handleImport below), but every
      // later "Run Validation" reloads rows through fetchTallyRows, and a
      // field missing here is invisible to the rest of the app no matter
      // how many times reconciliation re-runs — only a fresh re-parse
      // (never triggered by Run Validation, only by re-importing the file)
      // would have carried it, and even that ultimately funnels back
      // through this same read path once persisted.
      ptExcluded: t.raw?.ptExcluded ?? undefined,
    }));
  }, []);

  const loadMaps = useCallback(async (): Promise<PartyMap> => {
    if (!selClient) return {};
    const { data } = await supabase.from("tds_tally_party_maps").select("office_name_norm, tally_party").eq("client_id", selClient);
    return Object.fromEntries((data || []).map((m: any) => [m.office_name_norm, m.tally_party]));
  }, [selClient]);

  const loadAll = useCallback(async () => {
    const seq = ++loadSeq.current; const stale = () => seq !== loadSeq.current;
    if (!filingId) { settled.current = null; setBatches([]); setTallyRows([]); setResults(null); setOffice([]); setBypass(null); return; }
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
    // Bypass Tally Verification — the LATEST of the two action types decides
    // current state (a later undo reverses an earlier bypass), same rule the
    // Stage-4 digital signature already uses.
    const { data: byRows } = await supabase.from("tds_filing_audit_log")
      .select("action_type, new_value, changed_at")
      .eq("filing_id", filingId)
      .in("action_type", ["TALLY_VERIFICATION_BYPASSED", "TALLY_VERIFICATION_BYPASS_UNDONE"])
      .order("changed_at", { ascending: false })
      .limit(1);
    if (stale()) return;
    const latestBy = (byRows || [])[0];
    setBypass(latestBy && latestBy.action_type === "TALLY_VERIFICATION_BYPASSED" && latestBy.changed_at
      ? { byName: latestBy.new_value || "—", at: latestBy.changed_at }
      : null);
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

  const handleImport = async (file: File, replaceBatchId?: string) => {
    if (!filing) return; setImporting(true);
    try {
      // Best-effort, non-blocking — see uploadTdsImportFile's doc. A storage
      // hiccup must never fail the import itself.
      const uploadPromise = uploadTdsImportFile(file, filing.id, "tally");
      const parsed = await parseLedgerFile(file);
      const firmId = await resolveFirmId();
      const { data: dup } = await supabase.from("tds_tally_batches").select("id, row_count, section, file_url").eq("filing_id", filing.id).eq("file_name", file.name);
      const dupIds = (dup || []).map((b: any) => b.id);
      const replaced = dupIds.length > 0;
      const priorRowCount = dup?.[0]?.row_count ?? null;
      const priorSection = dup?.[0]?.section ?? null;
      if (dupIds.length) {
        await supabase.from("tds_tally_rows").delete().in("batch_id", dupIds);
        await supabase.from("tds_tally_batches").delete().in("id", dupIds);
        for (const d of dup || []) removePublicDocumentByUrl(supabase, d.file_url);
      }
      // "Replace this file" (per-row button) targets a SPECIFIC batch id, which
      // may carry a DIFFERENT file name than the one just picked — the same-name
      // de-dupe above can't catch that case, so it's handled separately here.
      let replaceTargetOldInfo: { row_count: number | null; section: string | null; file_name: string | null } | null = null;
      if (replaceBatchId && !dupIds.includes(replaceBatchId)) {
        const { data: oldBatch } = await supabase.from("tds_tally_batches").select("row_count, section, file_name, file_url").eq("id", replaceBatchId).maybeSingle();
        replaceTargetOldInfo = oldBatch ? { row_count: oldBatch.row_count, section: oldBatch.section, file_name: oldBatch.file_name } : null;
        await supabase.from("tds_tally_rows").delete().eq("batch_id", replaceBatchId);
        await supabase.from("tds_tally_batches").delete().eq("id", replaceBatchId);
        removePublicDocumentByUrl(supabase, oldBatch?.file_url);
      }
      const fileUrl = await uploadPromise;
      const { data: bRow, error: bErr } = await supabase.from("tds_tally_batches").insert({
        filing_id: filing.id, client_id: selClient, firm_id: firmId, financial_year: selFy, quarter: selQuarter, form_type: selForm,
        file_name: file.name, section: parsed.section, row_count: parsed.rows.length, status: "imported", imported_by: user?.id, file_url: fileUrl,
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
        title: `Imported ${parsed.rows.length} deduction(s) from ${parsed.section || "the ledger"} (${parsed.source} ledger)`,
        description: [
          `${parsed.label}${parsed.period ? ` · ${parsed.period}` : ""}`,
          dropped ? `Skipped ${dropped} row(s) — not deductions.` : "",
          parsed.issues.join(" "),
          "Click Run Validation.",
        ].filter(Boolean).join(" "),
        ...(parsed.issues.length ? { variant: "default" as const } : {}),
      });
      // Audit the import itself (distinct from TALLY_RECON_RUN, which logs the
      // reconciliation outcome) — a new action_type since this is a new event,
      // not an overload of an existing one. An explicit per-row "Replace this
      // file" click gets its OWN action type (TALLY_LEDGER_REPLACED) so the
      // audit trail distinguishes "swapped out an existing ledger" from a
      // same-name re-import or an ordinary new-ledger add.
      if (replaceTargetOldInfo) {
        await logReconAudit({
          filingId: filing.id, firmId, userId: user?.id, userName: userMap[user?.id ?? ""],
          actionType: "TALLY_LEDGER_REPLACED",
          oldValue: `"${replaceTargetOldInfo.file_name || "—"}" — ${replaceTargetOldInfo.row_count ?? "?"} row(s) · ${replaceTargetOldInfo.section || "no section"}`,
          newValue: `"${file.name}" — ${parsed.rows.length} row(s) · ${parsed.section || "no section"}`,
          remark: `Replaced ledger file (${parsed.source} ledger).`,
        });
      } else {
        await logReconAudit({
          filingId: filing.id, firmId, userId: user?.id, userName: userMap[user?.id ?? ""],
          actionType: "TALLY_LEDGER_IMPORTED",
          oldValue: replaced ? `${priorRowCount ?? "?"} row(s) · ${priorSection || "no section"}` : null,
          newValue: `${parsed.rows.length} row(s) · ${parsed.section || "no section"}`,
          remark: `Imported "${file.name}" (${parsed.source} ledger)${replaced ? " — replaced previous import of the same file." : "."}`,
        });
      }
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
      const { data: doomed } = await supabase.from("tds_tally_batches").select("file_name, row_count, section, file_url").eq("id", id).maybeSingle();
      await supabase.from("tds_tally_rows").delete().eq("batch_id", id);
      const { error } = await supabase.from("tds_tally_batches").delete().eq("id", id);
      if (error) throw new Error(error.message);
      await supabase.from("tds_tally_results").delete().eq("filing_id", filing.id);
      removePublicDocumentByUrl(supabase, doomed?.file_url);
      setResults(null);
      toast({ title: "Ledger removed", description: "Run Validation again to reconcile against the remaining ledgers." });
      await logReconAudit({
        filingId: filing.id, firmId: filing.firm_id, userId: user?.id, userName: userMap[user?.id ?? ""],
        actionType: "TALLY_LEDGER_DELETED",
        oldValue: `"${doomed?.file_name || "—"}" — ${doomed?.row_count ?? "?"} row(s) · ${doomed?.section || "no section"}`,
        newValue: null,
        remark: `Removed ledger "${doomed?.file_name || "—"}".`,
      });
      await loadAll();
    } catch (e: any) { toast({ title: "Could not remove the ledger", description: e.message, variant: "destructive" }); }
    setImporting(false);
  };

  const handleReplaceClick = (batchId: string) => { setReplaceTargetId(batchId); fileRef.current?.click(); };

  const handleDownloadFile = (b: any) => {
    downloadStorageFile(b.file_url, b.file_name || "file");
    logReconAudit({
      filingId: filing?.id, firmId: filing?.firm_id, userId: user?.id, userName: userMap[user?.id ?? ""],
      actionType: "TALLY_LEDGER_DOWNLOADED", newValue: b.file_name || null, remark: `Downloaded "${b.file_name || "file"}".`,
    });
  };

  const startEditingSection = (b: any) => { setEditingSectionBatchId(b.id); setEditingSectionValue(b.section || ""); };
  const cancelEditingSection = () => { setEditingSectionBatchId(null); setEditingSectionValue(""); };
  /** Correct a batch's own section — see the state's own doc for why this is
   *  needed (a ledger mislabelled at the source, in the client's own Tally
   *  books, permanently blocks both automatic and manual matching). Updates
   *  every row the batch owns, not just the batch row itself — see
   *  handleImport's own comment on why section lives per-row. */
  const saveEditedSection = async (b: any) => {
    const canon = canonicalSection(editingSectionValue) || editingSectionValue.trim().toUpperCase() || null;
    if (!canon) { toast({ title: "Enter a section code", variant: "destructive" }); return; }
    if (canon === (b.section || null)) { cancelEditingSection(); return; }
    setSavingSectionEdit(true);
    try {
      const { error: e1 } = await supabase.from("tds_tally_batches").update({ section: canon }).eq("id", b.id);
      if (e1) throw new Error(e1.message);
      const { error: e2 } = await supabase.from("tds_tally_rows").update({ section: canon }).eq("batch_id", b.id);
      if (e2) throw new Error(e2.message);
      await logReconAudit({
        filingId: filing?.id, firmId: filing?.firm_id, userId: user?.id, userName: userMap[user?.id ?? ""],
        actionType: "TALLY_LEDGER_IMPORTED", oldValue: `section: ${b.section || "—"}`, newValue: `section: ${canon}`,
        remark: `Corrected the imported ledger's section for "${b.file_name}" — the client's own Tally ledger name printed a different section than its actual content.`,
      });
      await supabase.from("tds_tally_results").delete().eq("filing_id", filing.id);
      setResults(null);
      toast({ title: "Section corrected", description: `"${b.file_name}" is now treated as ${canon}. Run Validation again to reconcile against it.` });
      cancelEditingSection();
      await loadAll();
    } catch (e: any) { toast({ title: "Could not update the section", description: e.message, variant: "destructive" }); }
    setSavingSectionEdit(false);
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
    //
    // 24Q DUAL-LEDGER: some clients keep the Salary/Remuneration figure and
    // the TDS figure in TWO SEPARATE Tally ledgers (tallyPdf.ts tags the
    // Salary-ledger rows amountKind:"taxable_income" at parse time — see its
    // own doc). A single-ledger client (every 26Q/27EQ filing, and any 24Q
    // client with only one combined ledger) has NO such rows, so this whole
    // branch is a no-op for them and reconcileTallyFull runs exactly as
    // before. When present, run TWO independent, UNCHANGED
    // reconcileTallyFull passes — one against the TDS-liability ledger rows
    // (identical to today), one against the Salary-ledger rows with
    // office.tds/office.section forced null in a COPY (so it can only ever
    // match on office.amount, and the section-coverage gate/sectionEq become
    // non-constraints — see reconcileTallyFull's own null-is-permissive
    // handling) — then merge the two per-office verdicts into one combined
    // result (mergeDualLedgerResults, tallyRecon.ts).
    //
    // Applies to 24Q AND 26Q: both carry TWO independent office figures per
    // record (24Q: Taxable Income + TDS; 26Q: Amount Paid + TDS), and either
    // can be kept in two separate Tally ledgers — an expense/gross ledger
    // ("Staff Salary Expense", "Contractor Expense") and a TDS-liability
    // ledger ("TDS 192B", "TDS 194C").
    //
    // THE TAG ALONE IS NOT ENOUGH TO ENGAGE. tallyPdf's expense-ledger branch
    // keys on a gross-bearing Cr line inside a compound voucher — a shape a
    // 194J/194C liability journal can legitimately have once. Engaging on a
    // single such row would be catastrophic: a missing gross figure outranks
    // every money/date verdict below it, so EVERY office record without an
    // expense-ledger counterpart would be relabelled "…Missing from … Ledger".
    // One stray row, a wall of false mismatches. So require the tagged rows to
    // actually CONSTITUTE a ledger — to outnumber the untagged credits in
    // their own section — which is true for a real imported expense ledger and
    // false for an odd row sitting inside a liability ledger.
    const DUAL_LEDGER_FORMS = ["24Q", "26Q"];
    const taggedRows = DUAL_LEDGER_FORMS.includes(selForm) ? tally.filter((t) => t.amountKind === "taxable_income") : [];
    const creditsIn = (rows: TallyRow[], sec: string | null) =>
      rows.filter((t) => t.credit != null && t.credit !== 0 && (canonicalSection(t.section) ?? null) === sec).length;
    const taggedSections = new Set(taggedRows.map((t) => canonicalSection(t.section) ?? null));
    const isRealExpenseLedger = [...taggedSections].some(
      (sec) => creditsIn(taggedRows, sec) > creditsIn(tally.filter((t) => t.amountKind !== "taxable_income"), sec),
    );
    // ONE ROW PER EMPLOYEE PER MONTH — but only on 24Q, where that is exactly
    // what Office Data holds. A salary month is a single line on the return
    // even when Tally books it across several vouchers (Salary + Bonus +
    // Reimbursement; a TDS instalment corrected by a second entry), so those
    // are summed before reconciling. 26Q/27EQ are the opposite: Office Data
    // carries one row PER TRANSACTION, and two bills to the same contractor in
    // one month are two separate deductions that must never be merged.
    //
    // Both sides need it, not just the taxable one. A real client's TDS ledger
    // held Virender Singh's ₹1,52,672 as ₹1,35,200 + ₹17,472; the engine is
    // strictly 1:1, so the first row paired with him and the SECOND went
    // looking for a home and landed on "Urvashi Virender Singh" — a different
    // person whose name merely contains his. Summed first, there is one row
    // that matches his office figure exactly and nothing left over to
    // mis-assign.
    const perMonth = selForm === "24Q";
    const agg = (rows: TallyRow[]) => (perMonth ? aggregateTaxableByEmployeeMonth(rows) : rows);
    const untagged = tally.filter((t) => t.amountKind !== "taxable_income");
    const partiesForAmount: OfficeTxn[] = parties.map((o) => ({ ...o, tds: null, section: null }));
    // Resolve the PT-inclusion reading (tallyRecon.ts's resolveTaxableIncomeReading)
    // BEFORE aggregation — the vote needs per-voucher dates, which per-employee-per-
    // month summing would otherwise blur together.
    const salaryLedgerRows = isRealExpenseLedger
      ? agg(resolveTaxableIncomeReading(partiesForAmount, taggedRows)) : [];
    const tdsLedgerRows = isRealExpenseLedger ? agg(untagged) : agg(tally);
    const dualLedgerMode = salaryLedgerRows.length > 0;
    let audited: TallyReconRow[]; let surplusLedger: TallyRow[];
    if (dualLedgerMode) {
      const tdsResult = reconcileTallyFull(parties, tdsLedgerRows, null, maps, selForm);
      const salaryResult = reconcileTallyFull(partiesForAmount, salaryLedgerRows, null, maps, selForm);
      audited = mergeDualLedgerResults(tdsResult.rows, salaryResult.rows);
      // Ledger-side surplus from EACH pass is tagged by which ledger it came
      // from (rather than the generic single-ledger "Office Data Not Found")
      // so a checker sees immediately whether it's the Taxable Income figure
      // or the TDS figure sitting in Tally with no Office Data counterpart.
      // Each surplus row already carries its own amountKind from parse time
      // (salaryLedgerRows was filtered BY that exact tag above) — no
      // re-tagging needed, just concatenate both passes' leftovers.
      surplusLedger = [...tdsResult.surplusLedger, ...salaryResult.surplusLedger];
    } else {
      const single = reconcileTallyFull(parties, tally, null, maps, selForm);
      audited = single.rows; surplusLedger = single.surplusLedger;
    }
    // preserve overrides keyed by office_deductee_id
    const { data: prior } = await supabase.from("tds_tally_results").select("id, office_deductee_id, tally_party, tally_date, tally_credit, result, overridden, override_reason, overridden_by, overridden_at").eq("filing_id", fId);
    const priorOffice = (prior || []).filter((p: any) => p.office_deductee_id);
    const pm = new Map<string, any>(); for (const p of priorOffice) pm.set(p.office_deductee_id ?? "", p);
    // Rows where THIS run found a credible suggested mapping (a Party Name
    // Mismatch with a candidate ledger party — see render()'s suggestion gate
    // in tallyRecon.ts) AND the user has not already dismissed this exact
    // question via a prior override. `suggested_party` is deliberately never
    // persisted to tds_tally_results (it is a recommendation for THIS run, not
    // a stored fact), so this is the only place it can be captured — must be
    // computed HERE, in the same pass as the override-preservation `keep`
    // check above, or a name the user already overrode-and-accepted would be
    // asked about again on every subsequent Run Validation.
    const mappingCandidates: TallyReconRow[] = [];
    const newRows = audited.map((r) => {
      const c = pm.get(r.office_deductee_id ?? ""); const keep = !!c?.overridden && c.result === r.result;
      // "Name Mismatch" is the dual-ledger merge's own relabelling of exactly
      // this same suggestion (mergeDualLedgerResults carries suggested_party
      // through unchanged) — both must offer the proactive mapping dialog.
      if (!keep && (r.result === "Party Name Mismatch" || r.result === "Name Mismatch") && r.suggested_party) mappingCandidates.push(r);
      return {
        filing_id: fId, batch_id: b?.[0]?.id ?? null, firm_id: firmId, quarter: selQuarter, office_deductee_id: r.office_deductee_id,
        office_name: r.office_name, office_date: r.office_date, office_amount: r.office_amount, office_tds: r.office_tds, office_section: r.office_section,
        tally_row_index: r.tally_row_index, tally_party: r.tally_party, tally_date: r.tally_date, tally_credit: r.tally_credit,
        salary_tally_row_index: r.salary_tally_row_index ?? null, salary_tally_party: r.salary_tally_party ?? null,
        salary_tally_date: r.salary_tally_date ?? null, salary_tally_credit: r.salary_tally_credit ?? null,
        taxable_income_status: r.taxable_income_status ?? null, tds_status: r.tds_status ?? null,
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
    const priorLedger = (prior || []).filter((p: any) => !p.office_deductee_id
      && (p.result === "Office Data Not Found" || p.result === "Taxable Income Missing from Office Data" || p.result === "TDS Missing from Office Data"));
    // A LIST per key, consumed in order: two ledger credits can share the same
    // party+date+credit ("twins"), and a single-slot map let the later twin
    // overwrite the earlier one — dropping the override from whichever twin
    // the user had actually approved, or copying it onto the other.
    const lm = new Map<string, any[]>();
    for (const p of priorLedger) {
      const k = surplusKey(p.tally_party, p.tally_date, p.tally_credit);
      lm.set(k, [...(lm.get(k) || []), p]);
    }
    const surplusRows = surplusLedger.map((t) => {
      const key = surplusKey(t.party, t.date, t.credit);
      // In dual-ledger mode, tag by WHICH ledger this credit sat in — a
      // checker needs to know immediately whether it's the Taxable Income
      // figure or the TDS figure with no Office Data counterpart, not just
      // that "something" is unclaimed. A single-ledger client's surplus rows
      // (t.amountKind always undefined there) keep the original generic label.
      const result: TallyResult = dualLedgerMode
        ? (t.amountKind === "taxable_income" ? "Taxable Income Missing from Office Data" : "TDS Missing from Office Data")
        : "Office Data Not Found";
      const twins = lm.get(key) || [];
      const at = twins.findIndex((p) => p.overridden && p.result === result);
      const c = at >= 0 ? twins.splice(at, 1)[0] : twins.shift();
      const keep = !!c?.overridden && c.result === result;
      return {
        filing_id: fId, batch_id: b?.[0]?.id ?? null, firm_id: firmId, quarter: selQuarter, office_deductee_id: null,
        office_name: null, office_date: null, office_amount: null, office_tds: null, office_section: null,
        tally_row_index: t.row_index, tally_party: t.party, tally_date: t.date, tally_credit: t.credit,
        result, amount_basis: null,
        reason: `No office record matches this ${dualLedgerMode ? (t.amountKind === "taxable_income" ? "Salary ledger" : "TDS ledger") : "ledger"} entry.`,
        confidence: 0, mapped: false,
        overridden: keep, override_reason: keep ? c.override_reason : null, overridden_by: keep ? c.overridden_by : null, overridden_at: keep ? c.overridden_at : null,
      };
    });
    // Atomic replace (one DB transaction, see the migration's own comment) —
    // NOT a separate insert-then-delete: two overlapping runAudit() calls for
    // the same filing (two browser tabs, or a mapping-triggered re-run racing
    // a manual re-validate) could otherwise both insert a full row set before
    // either deleted the other's, leaving duplicate result rows behind. Cast
    // to `any` because this RPC isn't in the generated Supabase types — same
    // tolerance already used elsewhere in this file for tables/functions a
    // full `supabase gen types` regen hasn't caught up with yet.
    const { error } = await (supabase.rpc as any)("replace_tally_results", {
      p_filing_id: fId,
      p_rows: [...newRows, ...surplusRows],
    });
    if (error) throw new Error(error.message);
    await logReconAudit({ filingId: fId, firmId, userId: user?.id, userName: userMap[user?.id ?? ""], actionType: "TALLY_RECON_RUN", newValue: `${audited.filter((r) => r.result === "Matched").length} matched / ${audited.length}`, remark: `Tally reconciliation over ${tally.length} ledger rows` });
    if (seq !== loadSeq.current) return { audited, mappingCandidates: [] };
    const { data: res } = await supabase.from("tds_tally_results").select("*").eq("filing_id", fId); if (seq !== loadSeq.current) return { audited, mappingCandidates: [] };
    setTallyRows(tally);
    setResults((res as ResultRow[]) || []);
    return { audited, mappingCandidates };
    // selForm gates dual-ledger mode above — omitting it here would let a stale
    // closure run a 26Q filing with a previously-selected 24Q form value.
  }, [loadOffice, loadMaps, fetchTallyRows, resolveFirmId, selQuarter, selForm, user?.id, userMap]);

  const runValidation = useCallback(async () => {
    if (!filing || !batches.length || validating) return; setValidating(true);
    try {
      const { audited: a, mappingCandidates: cands } = await runAudit(filing.id);
      const m = a.filter((r) => r.result === "Matched").length;
      toast({ title: "Stage 3 · Tally reconciliation complete", description: `${m} matched · ${a.length - m} to review across ${a.length} office record(s)` });
      onActivity?.();
      // Surface every credible name-mapping candidate from THIS run in one place,
      // right away — the same suggestions already sit in the results list one
      // card at a time, but asking the user to notice and click each one
      // individually is exactly the manual hunt the user asked to remove. Every
      // candidate here still needs the user's own confirmation (see the dialog's
      // own doc); this only collects the question into a single step.
      if (cands.length) {
        setMappingCandidates(cands);
        setSelectedMappingIds(new Set(cands.map((c) => normalizeName(c.office_name))));
        setMappingDialogOpen(true);
      }
    }
    catch (e: any) { toast({ title: "Reconciliation failed", description: e.message, variant: "destructive" }); }
    setValidating(false);
  }, [filing, batches, validating, runAudit, toast, onActivity]);

  // ── Proactive name-mapping confirmation (after Run Validation) ──────────────
  const [mappingCandidates, setMappingCandidates] = useState<TallyReconRow[]>([]);
  // Keyed by office_name_norm, NOT office_deductee_id — a single office party
  // routinely has several pending transactions in one run (see mappingGroups
  // below), and the engine now resolves a confirmed office name across ALL of
  // that party's transactions, so the user should only ever be asked once per
  // party, not once per transaction.
  const [selectedMappingIds, setSelectedMappingIds] = useState<Set<string>>(new Set());
  const [mappingDialogOpen, setMappingDialogOpen] = useState(false);
  const [confirmingMappings, setConfirmingMappings] = useState(false);
  const toggleMappingCandidate = (id: string) => setSelectedMappingIds((prev) => {
    const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next;
  });
  /** One entry per unique office party (office_name_norm), each carrying every
   *  pending transaction the engine found for it this run — so the dialog asks
   *  "is this the same person?" exactly ONCE per party, however many of their
   *  transactions are currently sitting as Party Name Mismatch. */
  const mappingGroups = useMemo(() => {
    const byKey = new Map<string, { key: string; officeName: string; transactions: TallyReconRow[] }>();
    for (const c of mappingCandidates) {
      const key = normalizeName(c.office_name);
      const g = byKey.get(key);
      if (g) g.transactions.push(c); else byKey.set(key, { key, officeName: c.office_name ?? "—", transactions: [c] });
    }
    return [...byKey.values()];
  }, [mappingCandidates]);

  /** Batch-confirm every SELECTED candidate in one upsert + one re-run, instead
   *  of N calls to saveMapping() (which each re-run the whole audit on their
   *  own — correct for a single click from the results list, wasteful and
   *  flicker-prone for a batch of N confirmed here at once). Every mapping is
   *  still the user's own decision — this only lets several be made at once. */
  const confirmSelectedMappings = async () => {
    // ONE row per selected PARTY, never per transaction — tds_tally_party_maps
    // has a unique index on (client_id, office_name_norm), so a batch upsert
    // with 2+ rows sharing that key (the same party's several transactions)
    // throws "ON CONFLICT DO UPDATE command cannot affect row a second time"
    // and silently fails the WHOLE batch. A single representative row per
    // party is also all that is NEEDED now: the engine resolves a confirmed
    // office name across ALL of that party's other pending transactions too
    // (see tallyRecon.ts's officeConfirmed), not just the one exact ledger
    // string that happened to be saved.
    const toConfirm = mappingGroups.filter((g) => selectedMappingIds.has(g.key));
    if (!toConfirm.length) { setMappingDialogOpen(false); return; }
    setConfirmingMappings(true);
    try {
      const firmId = await resolveFirmId();
      const { error } = await supabase.from("tds_tally_party_maps").upsert(
        toConfirm.map((g) => ({
          firm_id: firmId, client_id: selClient, office_name_norm: g.key,
          office_name: g.officeName, tally_party: g.transactions[0].suggested_party, created_by: user?.id,
        })),
        { onConflict: "client_id,office_name_norm" },
      );
      if (error) { toast({ title: "Could not save mappings", description: error.message, variant: "destructive" }); setConfirmingMappings(false); return; }
      for (const g of toConfirm) {
        await logReconAudit({
          filingId: filing?.id, firmId: filing?.firm_id, userId: user?.id, userName: userMap[user?.id ?? ""],
          actionType: "TALLY_PARTY_MAP", oldValue: g.officeName, newValue: g.transactions[0].suggested_party,
          remark: `Confirmed during Run Validation review — applies to all ${g.transactions.length} pending transaction${g.transactions.length === 1 ? "" : "s"} of this party.`,
        });
      }
      setMappingDialogOpen(false);
      toast({ title: `${toConfirm.length} mapping${toConfirm.length === 1 ? "" : "s"} confirmed`, description: "Re-running validation…" });
      setValidating(true);
      try { await runAudit(filing.id); } catch (e: any) { toast({ title: "Re-validation failed", description: e.message, variant: "destructive" }); }
      setValidating(false);
    } finally { setConfirmingMappings(false); }
  };

  /** Save a party mapping (office name ↔ ledger party) → re-run.
   *
   *  The ledger party is a PARAMETER, not read off the record: two different
   *  parties can legitimately share a date and a TDS amount, so the engine's
   *  suggestion is only a recommendation. Both "Confirm mapping" (accept the
   *  suggestion) and the record picker (the user chose a different ledger entry)
   *  land here, so the upsert / audit log / re-run happen exactly once. */
  const saveMapping = async (officeName: string | null, tallyParty: string | null, remark = "Saved party mapping") => {
    if (!officeName || !tallyParty || validating) return;
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
    // .select() so an update that matched NO row (a re-run replaced this row's
    // id while the dialog was open, or row-level security filtered it out) is
    // reported, instead of a success toast over a change that never saved.
    const { data: saved, error } = await supabase.from("tds_tally_results").update({ overridden: true, override_reason: reason, overridden_by: user?.id, overridden_at: new Date().toISOString() }).eq("id", ovTarget.id).select("id");
    if (error || !saved?.length) { toast({ title: "Override not saved", description: error?.message || "This record has changed since the page loaded — reload Stage 3 and try again.", variant: "destructive" }); }
    else {
      await logReconAudit({ filingId: filing?.id, firmId: filing?.firm_id, userId: user?.id, userName: userMap[user?.id ?? ""], actionType: "TALLY_OVERRIDE", oldValue: `${ovTarget.office_name} — ${ovTarget.result}`, newValue: "Overridden", remark: reason });
      setResults((p) => p ? p.map((x) => x.id === ovTarget.id ? { ...x, overridden: true, override_reason: reason, overridden_by: user?.id ?? null } : x) : p);
      toast({ title: "Override recorded" }); setOvOpen(false);
    }
    setSavingOv(false);
  };
  const undoOverride = async (r: ResultRow) => {
    const { data: saved, error } = await supabase.from("tds_tally_results").update({ overridden: false, override_reason: null, overridden_by: null, overridden_at: null }).eq("id", r.id).select("id");
    if (error || !saved?.length) { toast({ title: "Undo not saved", description: error?.message || "This record has changed since the page loaded — reload Stage 3 and try again.", variant: "destructive" }); return; }
    setResults((p) => p ? p.map((x) => x.id === r.id ? { ...x, overridden: false, override_reason: null, overridden_by: null, overridden_at: null } : x) : p);
  };

  /** Bypass Tally Verification — for a client whose books aren't maintained in
   *  Tally at all, so there is nothing to ever import. One click + a single
   *  confirmation, no typed reason: the checkbox text itself IS the reason
   *  ("this client's data is not maintained in Tally"), so there's nothing a
   *  free-text field would capture that the fixed remark below doesn't already
   *  say. Persisted as a tds_filing_audit_log entry (no migration), mirroring
   *  the Stage-4 CHECKER_SIGNATURE/CHECKER_SIGNATURE_REVOKED pair exactly. */
  const handleBypassTally = async () => {
    if (!filing || !user?.id) return;
    if (!bypassConfirmChecked) { toast({ title: "Confirmation required", description: "Confirm the client's Tally data is not maintained before bypassing.", variant: "destructive" }); return; }
    setBypassSaving(true);
    const byName = userMap[user.id] || user.email || "Unknown";
    await logReconAudit({
      filingId: filing.id, firmId: filing.firm_id, userId: user.id, userName: byName,
      actionType: "TALLY_VERIFICATION_BYPASSED", newValue: byName,
      remark: "Client's Tally data is not maintained — Stage 3 bypassed by user confirmation.",
    });
    // Same Realtime nudge the Stage-4 signature uses — bypassing changes
    // whether this filing is ready-to-file, so the Dashboard badge (which
    // only refetches on a tds_filings change) needs to hear about it too.
    await supabase.from("tds_filings").update({ last_updated_by: user.id, last_updated_at: new Date().toISOString() }).eq("id", filing.id);
    setBypass({ byName, at: new Date().toISOString() });
    setBypassSaving(false); setBypassOpen(false); setBypassConfirmChecked(false);
    toast({ title: "Tally verification bypassed", description: "Stage 3 is marked complete. You can undo this if the client's Tally data becomes available." });
    onActivity?.();
  };

  const handleUndoBypassTally = async () => {
    if (!filing || !user?.id || !bypass) return;
    setBypassSaving(true);
    await logReconAudit({
      filingId: filing.id, firmId: filing.firm_id, userId: user.id, userName: userMap[user.id],
      actionType: "TALLY_VERIFICATION_BYPASS_UNDONE", oldValue: bypass.byName,
      remark: "Bypass undone — Tally verification required again.",
    });
    await supabase.from("tds_filings").update({ last_updated_by: user.id, last_updated_at: new Date().toISOString() }).eq("id", filing.id);
    setBypass(null);
    setBypassSaving(false);
  };

  /** Stage-3 report — the ledger reconciliation as it stands right now. */
  const stage3Report = (): StageReport => {
    const rs = results || [];
    // The dual-ledger columns are carried for EVERY row (blank on single-ledger
    // clients). Without them an exported "Taxable Income Amount Mismatch" line
    // showed Office TDS and Ledger Credit in perfect agreement and simply
    // omitted the figure that actually disagreed — a reviewer reading the
    // export alone would see a mismatch verdict with no visible cause.
    const row = (r: ResultRow) => ({
      "Office Party": r.office_name || "—",
      "Office Date": r.office_date || "—",
      "Office Amount": r.office_amount ?? "",
      "Office TDS": r.office_tds ?? "",
      Section: r.office_section || "—",
      "Expense Ledger Party": r.salary_tally_party || "",
      "Expense Ledger Date": r.salary_tally_date || "",
      "Expense Ledger Credit": r.salary_tally_credit ?? "",
      "Ledger Party": r.tally_party || "—",
      "Ledger Date": r.tally_date || "—",
      "Ledger Credit": r.tally_credit ?? "",
      Result: r.overridden ? oneSidedLabel(r) : r.result,
      Mapped: r.mapped ? "Yes" : "No",
      Remarks: r.overridden ? `Overridden — ${r.override_reason || "accepted"}` : (r.reason || ""),
      Overridden: r.overridden ? "Yes" : "No",
    });
    const unresolved = rs.filter((r) => isDisplayMismatch(r, selForm) && !r.overridden);
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
    // Total must count what the reviewer can actually see, not the full
    // internal reconciliation set. On 24Q, isDisplayMismatch already hides a
    // pure ledger-surplus row (no Office Data counterpart — see its own doc:
    // a Salary Exp. ledger routinely covers dozens of staff never filed in
    // this return) from the Mismatched list by firm policy; Total was still
    // counting every one of those hidden rows, so it could read e.g. 136
    // against an 18-record Office Data / 7+11 Matched+Mismatched — a real
    // client report ("why is Total 136 when there aren't 136 records").
    // Same gate as isDisplayMismatch, minus the isTallyIssue check (a
    // Matched row is always office-anchored, so this doesn't drop any).
    const visible = rs.filter((r) => selForm !== "24Q" || isOfficeAnchored(r));
    return {
      total: visible.length, matched: rs.filter((r) => r.result === "Matched").length,
      issues: rs.filter((r) => isDisplayMismatch(r, selForm) && !r.overridden).length,
      mapped: rs.filter((r) => r.mapped).length, overridden: rs.filter((r) => r.overridden).length,
    };
  }, [results, selForm]);

  /** Every Tally exception as one Stage-4 audit row. A record resolved via a saved
   *  party mapping (matched AND mapped) is "Resolved", not "Unresolved" — a real
   *  decision (the mapping) is why it reconciles, so the checker should see that,
   *  not just silence. Overridden always wins (it can co-exist with a mapping). */
  const tallyAuditRows = (): AuditRow[] =>
    (results || [])
      .filter((r) => r.overridden || isDisplayMismatch(r, selForm) || (r.mapped && r.result === "Matched"))
      .map((r): AuditRow => ({
        stage: "Stage 3",
        record: r.office_name || r.tally_party || "—",
        errorType: r.overridden ? oneSidedLabel(r) : r.result,
        status: r.overridden ? "Overridden" : isTallyIssue(r.result) ? "Unresolved" : "Resolved",
        reason: r.overridden ? (r.override_reason || "accepted") : (r.reason || (r.mapped ? "Reconciled via saved party mapping" : "")),
      }));

  useEffect(() => {
    onStatusChange?.({
      getReport: stage3Report, getAuditRows: tallyAuditRows, filingId, loaded: settled.current === filingId,
      // A deliberate bypass makes this stage not-applicable exactly like never
      // having imported a ledger does — see TallyStageStatus's own doc on why
      // `bypassed` rides alongside rather than replacing that check.
      applicable: batches.length > 0 && !bypass, bypassed: !!bypass,
      ran: results !== null, total: summary.total, matched: summary.matched, issues: summary.issues, overridden: summary.overridden,
    });
  }, [filingId, batches, results, summary, bypass, onStatusChange]);

  /** Matches office_name OR tally_party — a name only ever embedded as text
   *  inside a DIFFERENT record's card (the ledger side of a paired dispute, or a
   *  rival named only in a reason sentence) is otherwise unfindable, since there
   *  is no card titled with it to scan for. */
  const bySearch = (list: ResultRow[], q: string): ResultRow[] =>
    q ? list.filter((r) => [r.office_name, r.tally_party].filter(Boolean).join(" ").toLowerCase().includes(q)) : list;

  const issueRows = useMemo(() => {
    const q = recordSearch.trim().toLowerCase();
    return bySearch((results || []).filter((r) => isDisplayMismatch(r, selForm)), q)
      .sort((a, b) => (a.overridden ? 1 : 0) - (b.overridden ? 1 : 0));
  }, [results, recordSearch, selForm]);
  const cardFiltered = useMemo((): ResultRow[] | null => {
    const rs = results || [];
    const q = recordSearch.trim().toLowerCase();
    switch (activeFilter) {
      case "total": return bySearch(rs, q); case "matched": return bySearch(rs.filter((r) => r.result === "Matched"), q);
      case "issues": return bySearch(rs.filter((r) => isDisplayMismatch(r, selForm) && !r.overridden), q);
      case "mapped": return bySearch(rs.filter((r) => r.mapped), q); case "overridden": return bySearch(rs.filter((r) => r.overridden), q);
      default: return null;
    }
  }, [results, activeFilter, recordSearch, selForm]);

  /** A ledger-anchored ResultRow's OWN section — NOT persisted on
   *  tds_tally_results (only office_section is a column, and that's always
   *  null for a ledger-anchored row), so looked up by VALUE against the
   *  imported tallyRows, the same value-matching convention runAudit()
   *  already uses (surplusKey) to survive a re-run with no stable ledger id. */
  const ledgerSectionOf = (r: ResultRow): string | null => {
    if (!r.tally_party) return null;
    const match = tallyRows.find((t) => normalizeName(t.party) === normalizeName(r.tally_party) && t.date === r.tally_date && t.credit === r.tally_credit);
    return match?.section ?? null;
  };

  /** A compound-Journal's narration ("BEING THE INTEREST PAID @ 6% …"), for
   *  display only — same value-matching lookup as ledgerSectionOf above,
   *  since a ResultRow doesn't persist it directly. Never affects any
   *  verdict; purely lets a reviewer read the rate/period without reopening
   *  the source PDF. */
  const ledgerNarrationOf = (r: ResultRow): string | null => {
    if (!r.tally_party) return null;
    const match = tallyRows.find((t) => normalizeName(t.party) === normalizeName(r.tally_party) && t.date === r.tally_date && t.credit === r.tally_credit);
    return match?.narration ?? null;
  };

  /** A confirmed row's OWN section, whichever side it's anchored on — used to
   *  keep claimedCounts (below) from "orphan-spending" a claim across
   *  sections (see pickRows). */
  const confirmedRowSection = (r: ResultRow): string | null =>
    canonicalSection(r.office_name != null ? r.office_section : ledgerSectionOf(r));

  /** Ledger records offered by the picker: the engine's suggestion first, then the
   *  rest in ledger order. Only CREDIT rows — those are the deductions the engine
   *  pairs against, so mapping to a party that never appears as a credit could not
   *  match anything. "suggested" is party-level because the saved mapping is.
   *
   *  Excludes only a credit CONFIRMED to belong elsewhere — Matched, manually
   *  mapped, or an approved one-sided override ("Tally Ledger Only") for a
   *  DIFFERENT record (see isOpenRow). A credit that's merely its own still-open
   *  surplus row, or another record's unconfirmed tentative suggestion, stays
   *  offered: per the bidirectional-mapping requirement, both sides of a
   *  possible pairing remain available to EVERY unresolved record until one of
   *  them is actually confirmed. Identified by VALUE (party+date+credit), not
   *  position: `tally_row_index` is a raw file row_index and collides across the
   *  several files a filing's ledger is imported from.
   *
   *  Counts claims rather than a boolean Set: two ledger rows can share the
   *  exact same party+date+credit ("twins" — tallyRecon.ts's own term for this
   *  real, anticipated case, resolved there by array position). If only ONE
   *  twin is confirmed elsewhere, only ONE occurrence should be excluded here —
   *  a boolean claimed-value Set would wrongly hide BOTH twins the moment
   *  either one is confirmed, breaking bidirectional symmetry for the other,
   *  still-open one. Depends on `results` (read inside the body) so the list
   *  never goes stale relative to overrides/unmaps applied while this dialog
   *  is open.
   *
   *  claimedCounts is scoped to the TARGET's section: a confirmed row from a
   *  DIFFERENT section that happens to share the exact same party+date+credit
   *  value must never consume a claim here — the candidate pool below is
   *  already filtered to the target's own section, so an unscoped count would
   *  "orphan-spend" against an irrelevant cross-section value-twin, wrongly
   *  hiding the correct, same-section candidate. */
  const pickRows = useMemo(() => {
    const sug = pickTarget?.tally_party ? normalizeName(pickTarget.tally_party) : null;
    const targetSection = canonicalSection(pickTarget?.office_section ?? null);
    // Stage 3's split-entry grouping (tallyRecon.ts) can fold two or more
    // confirmed ResultRows onto the SAME physical ledger row (a single real
    // payment Office Data recorded as multiple rows) — every row in such a
    // fold carries SPLIT_FOLD_CONFIDENCE, on both the anchor and its
    // leftover siblings. Counting each of those rows as its own claim would
    // inflate the total and wrongly hide an unrelated, genuinely free "twin"
    // ledger row that only coincidentally shares the same party+date+credit
    // value — so a whole fold group (same value key, all fold-tagged) counts
    // as exactly ONE claim, no matter how many office rows it spans; every
    // other confirmed row still counts individually, preserving the existing
    // "twins" behaviour (two REAL distinct ledger rows sharing a value).
    const claimedCounts = new Map<string, number>();
    const foldGroupCounted = new Set<string>();
    for (const r of results || []) {
      if (r.id === pickTarget?.id || isOpenRow(r)) continue;
      const rSection = confirmedRowSection(r);
      if (targetSection && rSection && rSection !== targetSection) continue;
      const isFold = r.result === "Matched" && r.confidence === SPLIT_FOLD_CONFIDENCE;
      // BOTH ledgers' claims count. A dual-ledger row holds its Salary-ledger
      // counterpart in the salary_tally_* columns; ignoring those left a salary
      // credit already matched to employee B still on offer while resolving
      // employee A — and a confirmed mapping is permanent, so that is a wrong
      // mapping the checker cannot easily undo. The fold-group rule is applied
      // per key, exactly as before, independently on each side.
      const claims: (string | null)[] = [
        r.tally_party && r.tally_date != null && r.tally_credit != null
          ? `${normalizeName(r.tally_party)}|${r.tally_date}|${r.tally_credit}` : null,
        r.salary_tally_party && r.salary_tally_date != null && r.salary_tally_credit != null
          ? `${normalizeName(r.salary_tally_party)}|${r.salary_tally_date}|${r.salary_tally_credit}` : null,
      ];
      for (const key of claims) {
        if (!key) continue;
        if (isFold) {
          if (foldGroupCounted.has(key)) continue;
          foldGroupCounted.add(key);
        }
        claimedCounts.set(key, (claimedCounts.get(key) || 0) + 1);
      }
    }
    const rows = tallyRows
      .filter((t) => t.party && t.credit != null && Number(t.credit) !== 0)
      // A 194C deductee can never legitimately be booked under a 192B (or any
      // other) ledger — TDS sections are not interchangeable, so a candidate
      // from a different section is never a valid mapping target regardless
      // of how well the name/date/amount happen to line up. Permissive only
      // when EITHER side's section is unknown, matching the engine's own
      // sectionEqOf() convention (assignment.ts) — never exclude a candidate
      // just because section metadata happens to be missing.
      // An EXPENSE-ledger row is exempt: its section comes from the expense
      // ledger's own title ("Staff Salary Expense" canonicalises to 192) while
      // the office record says 192B, so both are truthy and unequal and the
      // gate silently dropped EVERY salary row — leaving the manual picker
      // permanently empty for exactly the "…Missing from … Ledger" cases this
      // feature added the picker for. The engine's own salary pass already
      // treats section as a non-constraint (office section is nulled); mirror
      // that here rather than re-imposing it in the UI.
      .filter((t) => {
        if (t.amountKind === "taxable_income") return true;
        const tSection = canonicalSection(t.section);
        return !targetSection || !tSection || tSection === targetSection;
      })
      .filter((t) => {
        const key = `${normalizeName(t.party)}|${t.date}|${t.credit}`;
        const left = claimedCounts.get(key) || 0;
        if (left > 0) { claimedCounts.set(key, left - 1); return false; }
        return true;
      })
      .map((t, i) => ({ t, i, suggested: !!sug && normalizeName(t.party) === sug }));
    const q = pickQuery.trim().toLowerCase();
    const hit = q
      ? rows.filter(({ t }) => [t.party, t.date, t.iso, t.section, t.credit == null ? "" : String(t.credit), inr(t.credit)]
          .filter(Boolean).join(" ").toLowerCase().includes(q))
      : rows;
    return [...hit].sort((a, b) => (b.suggested ? 1 : 0) - (a.suggested ? 1 : 0) || a.i - b.i);
  }, [results, tallyRows, pickTarget, pickQuery]);

  /** When pickRows is empty, is that because nothing matches at all, or because
   *  candidates exist but were excluded by the section-equality filter above?
   *  Those two are very different situations for the user — "no such ledger
   *  entry exists" vs "the entry exists but is booked under the wrong section,
   *  which mapping can never fix" — and the generic "no match" message used to
   *  say the same thing for both, sending the user hunting for a typo in their
   *  search when the real issue was a section code that needs correcting at
   *  the source (Office Data or the imported ledger), not in this dialog. */
  const pickSectionBlockedCount = useMemo(() => {
    if (pickRows.length > 0) return 0;
    const targetSection = canonicalSection(pickTarget?.office_section ?? null);
    if (!targetSection) return 0;
    const q = pickQuery.trim().toLowerCase();
    return tallyRows
      .filter((t) => t.party && t.credit != null && Number(t.credit) !== 0 && t.amountKind !== "taxable_income")
      .filter((t) => { const tSection = canonicalSection(t.section); return !!tSection && tSection !== targetSection; })
      .filter((t) => !q || [t.party, t.date, t.iso, t.section, t.credit == null ? "" : String(t.credit), inr(t.credit)]
        .filter(Boolean).join(" ").toLowerCase().includes(q))
      .length;
  }, [pickRows.length, tallyRows, pickTarget, pickQuery]);

  /** Office records offered by the REVERSE picker (opened from a ledger-only card).
   *  Candidates are every OPEN office record (see isOpenRow) — not just ones whose
   *  own result happens to be exactly "Ledger Entry Not Found". An office record
   *  mid-dispute against a DIFFERENT ledger row (e.g. "Date Mismatch") must still
   *  be offerable here: the engine's tentative pairing isn't confirmed, so the
   *  checker may need to redirect it to THIS ledger credit instead. Only a
   *  CONFIRMED record (Matched, mapped, or overridden) is excluded — that one
   *  already has a settled counterpart, so offering it here would let one office
   *  record be mapped to two different ledger credits at once. */
  const pickOfficeRows = useMemo(() => {
    const targetSection = canonicalSection(officePickTarget ? ledgerSectionOf(officePickTarget) : null);
    const rows = (results || [])
      .filter((r) => r.office_name && r.id !== officePickTarget?.id && isOpenRow(r))
      // Mirrors pickRows' own section filter: a ledger credit from a specific
      // section can only ever legitimately belong to an office record of that
      // SAME section. Permissive only when either side's section is unknown.
      .filter((r) => {
        const rSection = canonicalSection(r.office_section);
        return !targetSection || !rSection || rSection === targetSection;
      })
      .map((r, i) => ({ r, i }));
    const q = officePickQuery.trim().toLowerCase();
    return q
      ? rows.filter(({ r }) => [r.office_name, r.office_date, r.office_section, r.office_tds == null ? "" : String(r.office_tds), inr(r.office_tds)]
          .filter(Boolean).join(" ").toLowerCase().includes(q))
      : rows;
  }, [results, officePickQuery, officePickTarget, tallyRows]);

  /** Mirrors pickSectionBlockedCount above, for the reverse picker — see that
   *  one's own doc for why this distinction (nothing matches at all vs.
   *  candidates exist but are booked under a different section) matters. */
  const pickOfficeSectionBlockedCount = useMemo(() => {
    if (pickOfficeRows.length > 0) return 0;
    const targetSection = canonicalSection(officePickTarget ? ledgerSectionOf(officePickTarget) : null);
    if (!targetSection) return 0;
    const q = officePickQuery.trim().toLowerCase();
    return (results || [])
      .filter((r) => r.office_name && r.id !== officePickTarget?.id && isOpenRow(r))
      .filter((r) => { const rSection = canonicalSection(r.office_section); return !!rSection && rSection !== targetSection; })
      .filter((r) => !q || [r.office_name, r.office_date, r.office_section, r.office_tds == null ? "" : String(r.office_tds), inr(r.office_tds)]
        .filter(Boolean).join(" ").toLowerCase().includes(q))
      .length;
  }, [pickOfficeRows.length, results, officePickTarget, officePickQuery]);

  /** The Override button's label. Every genuine DISPUTE over an existing pairing
   *  (Party Name Mismatch, Date Mismatch, …) keeps the plain generic "Override".
   *  The two ONE-SIDED results get their own explicit label instead — the user's
   *  action here isn't "accept a difference", it's "confirm this record belongs
   *  to only one side of the books", which deserves saying so directly. */
  const overrideLabel = (r: ResultRow): string =>
    r.result === "Ledger Entry Not Found" ? "Keep as Office Data Only"
      : r.result === "Office Data Not Found" ? "Keep as Tally Ledger Only"
      // 24Q dual-ledger surplus (ledger-anchored, genuinely one-sided for
      // THAT figure) — the mirror image of "Office Data Not Found" above,
      // just naming which ledger. "Missing from Salary/TDS Ledger" (office-
      // anchored) stays plain "Override": that's a partial dispute — the
      // OTHER figure may already be perfectly matched via the other
      // ledger — never a wholesale one-sided declaration.
      : r.result === "Taxable Income Missing from Office Data" ? "Keep as Salary Ledger Only"
      : r.result === "TDS Missing from Office Data" ? "Keep as TDS Ledger Only"
      : "Override";

  /** The audit-facing label for an APPROVED one-sided override — reads as a
   *  final state ("Office Data Only" / "Tally Ledger Only"), not an open
   *  "... Not Found" problem. Only meaningful once `overridden` is true; every
   *  other override keeps the engine's own result label, since that IS a
   *  genuine accepted dispute over a real pairing, not a one-sided entry. */
  // Imported from tallyRecon.ts, NOT redefined here — the Overview Report and
  // Stage-4 audit read the same function, so an overridden row can never be
  // labelled one way on this tab and another way in the export.

  /** "Matched" + a confirmed name mapping reads as "Matched & Mapped" — distinct
   *  from an ordinary Matched, where the name itself already agreed with no
   *  assist. Any OTHER mismatch type + a confirmed mapping reads as
   *  "<result> & Mapped": the name question is resolved, so whatever mismatch
   *  remains is a genuine reconciliation discrepancy, not a spelling issue. */
  const resultLabel = (r: ResultRow): string => (r.mapped ? `${r.result} & Mapped` : r.result);

  /** Office vs Ledger, one row per comparable field, for a record that IS paired
   *  to a specific ledger entry but disputed (anything except "Matched" — that
   *  needs no highlighting since nothing disagrees). Replaces a single "Ledger:
   *  X" sub-line: the field the record's own `result` is actually about is
   *  flagged, so the checker sees BOTH sides at a glance instead of having to
   *  hunt for the ledger party buried in a sentence. */
  const disputeTable = (r: ResultRow) => {
    // 24Q DUAL-LEDGER: taxable_income_status is only ever set by
    // mergeDualLedgerResults, so its presence alone tells us this record has
    // a SEPARATE Salary-ledger side worth its own row, rather than the
    // single generic "Amount" row every other (single-ledger) client sees.
    const dual = r.taxable_income_status != null;
    const rows: { label: string; office: string; ledger: string; flagged: boolean }[] = dual ? [
      {
        label: "Party", office: r.office_name || "—",
        ledger: r.tally_party === r.salary_tally_party ? (r.tally_party || "—") : `${r.salary_tally_party || "—"} (Salary) / ${r.tally_party || "—"} (TDS)`,
        flagged: r.result === "Name Mismatch",
      },
      {
        label: "Date", office: r.office_date || "—",
        ledger: r.tally_date === r.salary_tally_date ? (r.tally_date || "—") : `${r.salary_tally_date || "—"} (Salary) / ${r.tally_date || "—"} (TDS)`,
        flagged: r.result === "Date Mismatch",
      },
      {
        label: "Taxable Income", office: inr(r.office_amount), ledger: inr(r.salary_tally_credit),
        flagged: r.result === "Taxable Income Amount Mismatch" || r.result === "Taxable Income Missing from Salary Ledger",
      },
      {
        label: "TDS", office: inr(r.office_tds), ledger: inr(r.tally_credit),
        flagged: r.result === "TDS Amount Mismatch" || r.result === "TDS Missing from TDS Ledger",
      },
    ] : [
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
            <p className="text-[11px] text-muted-foreground">{r.tally_date || "—"} · ledger credit {inr(r.tally_credit)}</p>
            {ledgerNarrationOf(r) && <p className="text-[11px] text-muted-foreground italic truncate" title={ledgerNarrationOf(r) || undefined}>{ledgerNarrationOf(r)}</p>}</div>
          <div className="flex items-center gap-2 shrink-0">
            <Badge className={cn("text-[10px]", RESULT_BADGE[r.result] || "bg-muted")}>{r.overridden ? oneSidedLabel(r) : resultLabel(r)}</Badge>
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

  const renderCard = (r: ResultRow) => r.office_name == null ? renderLedgerOnlyCard(r) : (() => {
  // Resolved ONCE per card — see the offer/save comment below for the bug that
  // re-reading r.tally_party independently caused.
  const offer = mappingOffer(r);
  return (
    <Card key={r.id} className={cn(r.overridden ? "border-blue-200 dark:border-blue-900 opacity-80" : r.result === "Matched" ? "border-emerald-200 dark:border-emerald-900" : "border-destructive/30")}>
      <CardContent className="p-4 space-y-1.5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0"><p className="font-semibold text-sm truncate">{r.office_name || "—"}</p>
            <p className="text-[11px] text-muted-foreground">{r.office_date || "—"} · office {inr(r.office_amount)} / TDS {inr(r.office_tds)} · {r.office_section || "—"}</p></div>
          <div className="flex items-center gap-2 shrink-0">
            <Badge className={cn("text-[10px]", RESULT_BADGE[r.result] || "bg-muted")}>{r.overridden ? oneSidedLabel(r) : resultLabel(r)}</Badge>
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
        {/* Gated on EITHER ledger side: in dual-ledger mode a record can be
            paired on the Salary ledger while having no TDS-ledger row at all
            (the routine zero-TDS 24Q employee). Requiring tally_party alone
            hid the whole comparison for exactly those disputes — the generic
            verdict with no evidence behind it. */}
        {(r.tally_party != null || r.salary_tally_party != null) && r.result !== "Matched" ? disputeTable(r) : r.tally_party != null && (
          <p className="text-[11px] text-muted-foreground flex items-center gap-1.5 flex-wrap">
            <span>Ledger: <b className="text-foreground">{r.tally_party}</b> · {r.tally_date || "—"} · credit {inr(r.tally_credit)}</span>
            {r.mapped && <Badge variant="secondary" className="text-[9px] px-1 py-0 h-4">party mapped</Badge>}
          </p>
        )}
        {/* The ledger's own narration ("BEING THE INTEREST PAID @ 6% …"), when
            present — display only, so a reviewer resolving a dispute (or just
            reading a Match) doesn't have to reopen the source PDF for context. */}
        {r.tally_party != null && ledgerNarrationOf(r) && (
          <p className="text-[11px] text-muted-foreground italic truncate" title={ledgerNarrationOf(r) || undefined}>{ledgerNarrationOf(r)}</p>
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
        {/* Read the offer ONCE and use that exact value in both the label and
            the save. Re-reading r.tally_party here instead silently diverged
            from what mappingOffer chose: for a dual-ledger row whose name
            problem is on the SALARY side, tally_party is either null (blank
            label, and saveMapping's own null-guard makes Confirm a no-op with
            no feedback at all) or the already-correct TDS party (saving a
            mapping to the wrong ledger). */}
        {offer ? (
          <div className="flex items-center gap-2 flex-wrap p-2 rounded-md border border-amber-200 dark:border-amber-900 bg-amber-50/50 dark:bg-amber-950/20 text-xs">
            <Link2 size={13} className="text-amber-600 shrink-0" />
            <span className="text-foreground min-w-0">Suggested mapping: <b>{r.office_name}</b> ↔ <b>{offer}</b></span>
            <div className="flex-1" />
            {/* A suggestion, never an assumption: the same date + TDS amount can
                belong to two different parties, so the user decides. */}
            <div className="flex items-center gap-2 shrink-0">
              <Button size="sm" className="h-6 text-xs px-2" disabled={disabled || validating} onClick={() => saveMapping(r.office_name, offer)}>Confirm mapping</Button>
              <Button size="sm" variant="outline" className="h-6 text-xs px-2 gap-1" disabled={disabled || validating}
                onClick={() => openPicker(r)} title="The suggestion is based on date and amount only — pick the correct ledger record yourself">
                <Search size={11} /> Choose another record
              </Button>
            </div>
          </div>
        ) : (r.result === "Ledger Entry Not Found" || r.result === "Taxable Income Missing from Salary Ledger" || r.result === "TDS Missing from TDS Ledger")
          && !r.overridden && !r.mapped && r.office_name && (
          <div className="flex items-center gap-2 flex-wrap p-2 rounded-md border border-amber-200 dark:border-amber-900 bg-amber-50/50 dark:bg-amber-950/20 text-xs">
            <Link2 size={13} className="text-amber-600 shrink-0" />
            {/* Only blame the NAME when the ledger really has no entry under it.
                Point Packers Q2: IKON MULTIPACK, HI-TECH INKS etc. sit in the
                194Q ledger under the identical name — they failed on section,
                yet this line told the user to look for a different name. */}
            {(() => {
              const sameName = tallyRows.filter((t) => t.credit && sameLedgerParty(t.party, r.office_name));
              return sameName.length ? (
                <span className="text-foreground min-w-0">
                  The ledger has {sameName.length} entr{sameName.length === 1 ? "y" : "ies"} under the same name <b>{r.office_name}</b>, but none matches this record's date, TDS amount and section — compare them before mapping.
                </span>
              ) : (
                <span className="text-foreground min-w-0">No automatic ledger match for <b>{r.office_name}</b> — it may be booked under a different name.</span>
              );
            })()}
            <div className="flex-1" />
            <Button size="sm" variant="outline" className="h-6 text-xs px-2 gap-1 shrink-0" disabled={disabled || validating} onClick={() => openPicker(r)}>
              <Search size={11} /> Map to ledger record
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
  })();

  /** True two-sided reconciliation display: every record from BOTH sources
   *  stays independently visible in its OWN section until it has its own
   *  final status — approving one side (e.g. "Keep as Office Data Only")
   *  never removes, merges or hides the opposite side's own unresolved
   *  record, since each is its own `ResultRow` with its own override state.
   *  This only reorganizes an already-complete list (renderCard already
   *  dispatches office- vs ledger-anchored rows correctly); it surfaces no
   *  new data. */
  const splitByOrigin = (rows: ResultRow[]) => ({
    office: rows.filter((r) => r.office_name != null),
    ledger: rows.filter((r) => r.office_name == null),
  });

  const renderMismatchSections = (rows: ResultRow[]) => {
    const { office, ledger } = splitByOrigin(rows);
    return (
      <div className="space-y-5">
        <div className="space-y-3">
          <h4 className="text-sm font-semibold text-foreground px-1">Office Data Mismatches ({office.length})</h4>
          {office.length === 0
            ? <p className="text-xs text-muted-foreground px-1">No unresolved Office Data records.</p>
            : office.map(renderCard)}
        </div>
        <div className="space-y-3">
          <h4 className="text-sm font-semibold text-foreground px-1">Tally Ledger Mismatches ({ledger.length})</h4>
          {ledger.length === 0
            ? <p className="text-xs text-muted-foreground px-1">No unresolved Tally Ledger records.</p>
            : ledger.map(renderCard)}
        </div>
      </div>
    );
  };

  if (!filing) return null;

  // Bypassed — Stage 3 is deliberately marked complete, no ledger to reconcile
  // against. Replaces the normal import/reconcile UI entirely rather than
  // sitting alongside it, so there's nothing left implying more is expected.
  if (bypass) {
    return (
      <div className="space-y-3">
        <Card className="border-emerald-200 dark:border-emerald-800">
          <CardContent className="p-4 space-y-2">
            <div className="flex items-center gap-2">
              <ShieldCheck size={16} className="text-emerald-600" />
              <p className="text-sm font-semibold">Tally Verification Bypassed</p>
            </div>
            <p className="text-xs text-emerald-700 dark:text-emerald-300">
              ✓ Client's Tally data is not maintained — bypassed by <b>{bypass.byName}</b> on {new Date(bypass.at).toLocaleString("en-IN")}. Stage 3 is marked complete.
            </p>
            {!disabled && (
              <Button variant="outline" size="sm" className="h-7 gap-1 text-xs" disabled={bypassSaving} onClick={handleUndoBypassTally}>
                <RotateCcw size={12} /> Undo Bypass
              </Button>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

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
            <p className="font-semibold text-xs whitespace-nowrap">Imported Ledger</p>
            {batches.length > 0 && (
              <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                <b className="text-xs font-bold text-foreground">{ledgerRowCount}</b> rows{batches.length > 1 ? ` · ${batches.length} files` : ""}{ledgerSections.length ? ` · ${ledgerSections.join(", ")}` : ""}
              </span>
            )}
            {validating && <span className="text-[10px] text-amber-600 flex items-center gap-1 shrink-0"><Loader2 size={10} className="animate-spin" /> reconciling…</span>}
            <div className="flex-1" />
            <input ref={fileRef} type="file" multiple accept=".pdf,application/pdf" className="hidden"
              onChange={(e) => {
                const picked = Array.from(e.target.files ?? []);
                const tgt = replaceTargetId; setReplaceTargetId(null);
                // "Replace this file" targets ONE batch, so it takes the first pick;
                // a plain Add/re-import imports everything selected in one go.
                if (picked.length) { if (tgt) handleImport(picked[0], tgt); else handleImportMany(picked); }
                e.currentTarget.value = "";
              }} />
            <Button size="sm" variant={batches.length ? "outline" : "default"} className="gap-1 h-6 px-2 text-[11px] shrink-0" disabled={importing || disabled} onClick={() => { setReplaceTargetId(null); fileRef.current?.click(); }}>
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
                    {editingSectionBatchId === b.id ? (
                      <>
                        <Input value={editingSectionValue} onChange={(e) => setEditingSectionValue(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter") saveEditedSection(b); if (e.key === "Escape") cancelEditingSection(); }}
                          className="h-5 w-20 text-[11px] px-1 shrink-0" placeholder="e.g. 194I" autoFocus disabled={savingSectionEdit} />
                        <button className="text-emerald-600 shrink-0" title="Save" disabled={savingSectionEdit} onClick={() => saveEditedSection(b)}>
                          {savingSectionEdit ? <Loader2 size={11} className="animate-spin" /> : <CheckCircle2 size={11} />}
                        </button>
                        <button className="text-muted-foreground shrink-0" title="Cancel" disabled={savingSectionEdit} onClick={cancelEditingSection}><X size={11} /></button>
                      </>
                    ) : (
                      <>
                        <span className="text-muted-foreground shrink-0">{b.section || "—"} · {b.row_count}</span>
                        <button className="text-muted-foreground hover:text-foreground shrink-0" title="Correct this ledger's section — e.g. if Tally's own ledger name is mislabelled"
                          disabled={disabled || importing} onClick={() => startEditingSection(b)}><Pencil size={11} /></button>
                      </>
                    )}
                    {/* Only a batch imported after the file_url column was added has
                        the original PDF to view/download — an older batch simply
                        omits these two rather than showing buttons that 404. Never
                        gated by `disabled`: both are read-only, so they stay
                        available even once the filing is locked (e.g. Ready to
                        File) — unlike Replace/Delete just below, which mutate. */}
                    {b.file_url && (
                      <>
                        <button className="text-muted-foreground hover:text-foreground shrink-0" title={`View: ${b.file_name}`}
                          onClick={() => viewStorageFile(b.file_url)}><Eye size={11} /></button>
                        <button className="text-muted-foreground hover:text-foreground shrink-0" title={`Download: ${b.file_name}`}
                          onClick={() => handleDownloadFile(b)}><Download size={11} /></button>
                      </>
                    )}
                    <button className="text-muted-foreground hover:text-foreground shrink-0" title="Replace this file"
                      disabled={disabled || importing} onClick={() => handleReplaceClick(b.id)}><RotateCcw size={11} /></button>
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
          ) : <p className="text-[11px] text-muted-foreground">Import the <b>Ledger Account PDF</b> for each TDS section (194A, 194C, 194J, 194T …), from either Tally or Expert — the format is detected automatically, no need to say which. The section, dates, parties and TDS (credit) amounts are read from the PDF; they combine across files. Re-importing the same file name replaces it. Stage 3 is optional.</p>}
        </CardContent></Card>
      </div>

      <div className="flex items-center gap-3">
        <Button className="gap-2 font-semibold h-9" onClick={runValidation} disabled={validating || !batches.length || officeCount === 0 || disabled}>
          {validating ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}{validating ? "Validating…" : "Run Validation"}
        </Button>
        {!batches.length ? <span className="text-xs text-muted-foreground">Import the Tally ledger to enable reconciliation.</span> : officeCount === 0 ? <span className="text-xs text-muted-foreground">No office records to reconcile.</span> : null}
        {!batches.length && !disabled && (
          <Button variant="outline" size="sm" className="gap-1.5 h-9 text-xs" onClick={() => setBypassOpen(true)}>
            <ShieldCheck size={13} /> Bypass Tally Verification
          </Button>
        )}
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
                {activeFilter === "issues"
                  ? renderMismatchSections(filterByErrorType(cardFiltered, (r) => r.result, errorTypeFilter))
                  : cardFiltered.map(renderCard)}
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
            {renderMismatchSections(filterByErrorType(issueRows, (r) => r.result, errorTypeFilter))}
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

      <Dialog open={bypassOpen} onOpenChange={(v) => { setBypassOpen(v); if (!v) setBypassConfirmChecked(false); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Bypass Tally Verification</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">
              Use this only when the client's books are not maintained in Tally at all, so there is no ledger to ever import. Stage 3 will be marked complete and the filing can proceed to Stage 4 without a Tally reconciliation.
            </p>
            <div className="flex items-start gap-2">
              <Checkbox id="tally-bypass-confirm" checked={bypassConfirmChecked} onCheckedChange={(v) => setBypassConfirmChecked(!!v)} className="mt-0.5" />
              <Label htmlFor="tally-bypass-confirm" className="text-xs font-normal leading-snug">
                I confirm this client's Tally data is not maintained, and Stage 3 verification does not apply to this filing.
              </Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setBypassOpen(false); setBypassConfirmChecked(false); }}>Cancel</Button>
            <Button onClick={handleBypassTally} disabled={bypassSaving || !bypassConfirmChecked}>{bypassSaving ? "Saving…" : "Confirm Bypass"}</Button>
          </DialogFooter>
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
                  {pickSectionBlockedCount > 0
                    ? `${pickSectionBlockedCount} ledger record${pickSectionBlockedCount === 1 ? "" : "s"} match${pickSectionBlockedCount === 1 ? "es" : ""} by name/date/amount but ${pickSectionBlockedCount === 1 ? "is" : "are"} booked under a different section (${pickTarget?.office_section || "—"} expected). A TDS section can't be changed by mapping — if one side's section code is wrong, correct it (Office Data or the ledger import) and re-run validation.`
                    : tallyRows.length ? "No ledger record matches that search." : "No ledger records — import the Tally ledger PDF first."}
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
                  {pickOfficeSectionBlockedCount > 0
                    ? `${pickOfficeSectionBlockedCount} office record${pickOfficeSectionBlockedCount === 1 ? "" : "s"} match${pickOfficeSectionBlockedCount === 1 ? "es" : ""} by name/date/amount but ${pickOfficeSectionBlockedCount === 1 ? "is" : "are"} booked under a different section than this ledger entry. A TDS section can't be changed by mapping — if one side's section code is wrong, correct it (Office Data or the ledger import) and re-run validation.`
                    : (results || []).some((r) => r.office_name) ? "No unmatched office record matches that search." : "No office records to reconcile for this filing."}
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

      {/* Proactive name-mapping review — opens automatically right after Run
          Validation whenever this run found credible suggested mappings, so
          the user confirms them in one step instead of hunting through the
          results list for the same "Suggested mapping" banner one card at a
          time. Every candidate here is STILL only a suggestion (identical to
          the one already shown on its own card) — this dialog changes how it
          is SURFACED, not the evidence bar for offering it. */}
      <Dialog open={mappingDialogOpen} onOpenChange={setMappingDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-base">Confirm name mappings</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              This run found {mappingGroups.length} deductee{mappingGroups.length === 1 ? "" : "s"} whose ledger entries look like the same
              party under a different spelling or abbreviation. Confirming a party applies to ALL of its pending transactions shown below, saves
              the mapping for this client, and re-runs validation — uncheck any you're not sure about and resolve them individually in the results list instead.
            </p>
            <div className="flex items-center gap-2 px-1">
              <Checkbox
                checked={selectedMappingIds.size === mappingGroups.length && mappingGroups.length > 0}
                onCheckedChange={(v) => setSelectedMappingIds(v ? new Set(mappingGroups.map((g) => g.key)) : new Set())}
              />
              <span className="text-xs text-muted-foreground">Select all ({selectedMappingIds.size}/{mappingGroups.length})</span>
            </div>
            <ScrollArea className="h-72 rounded-md border">
              <div className="p-1 space-y-0.5">
                {mappingGroups.map((g) => (
                  <label key={g.key} className="w-full flex items-start gap-2 rounded px-2 py-1.5 hover:bg-muted cursor-pointer">
                    <Checkbox
                      className="mt-0.5"
                      checked={selectedMappingIds.has(g.key)}
                      onCheckedChange={() => toggleMappingCandidate(g.key)}
                    />
                    <div className="min-w-0 flex-1 text-xs">
                      <p>
                        <b className="text-foreground">{g.officeName}</b> ↔ <b className="text-foreground">{g.transactions[0].suggested_party}</b>
                        {g.transactions.length > 1 && <span className="text-muted-foreground"> (+{g.transactions.length - 1} more transaction{g.transactions.length - 1 === 1 ? "" : "s"})</span>}
                      </p>
                      <p className="text-[10px] text-muted-foreground">
                        {g.transactions.length === 1
                          ? `${g.transactions[0].office_date || "—"} · TDS ${inr(g.transactions[0].office_tds)} · ${g.transactions[0].office_section || "—"}`
                          : `${g.transactions.length} pending transactions, total TDS ${inr(g.transactions.reduce((s, t) => s + (t.office_tds || 0), 0))}`}
                      </p>
                    </div>
                  </label>
                ))}
              </div>
            </ScrollArea>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setMappingDialogOpen(false)} disabled={confirmingMappings}>Review later</Button>
            <Button size="sm" onClick={confirmSelectedMappings} disabled={confirmingMappings || selectedMappingIds.size === 0}>
              {confirmingMappings ? <Loader2 size={12} className="animate-spin" /> : null}
              Confirm {selectedMappingIds.size || ""} mapping{selectedMappingIds.size === 1 ? "" : "s"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
