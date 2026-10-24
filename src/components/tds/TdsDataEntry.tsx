import { useState, useEffect, useCallback, useMemo, useRef, useLayoutEffect, Fragment } from "react";
import { supabase } from "@/integrations/supabase/client";
import { isQuarterInTdsRange, clientHasTdsForm } from "@/lib/tdsQuarter";
import { isProcessedWorkStatus } from "./TdsFilingsManager";
import {
  PAN_4TH_CHAR_MAP, isValidPan, isIndividualRateType, getRateForSection as getRateForSectionPure,
  calcAutoInterest, isChallanOverApplied, isChallanFullyUtilised, computeApplied, balanceColorClass,
  sectionDropdownLabel, withKasarVatav, computeChallanPooled, withChallanInterest,
  isSupersededSectionCode, is194CaDisabledFor, is194CbDisabledFor,
  type RateEntry,
} from "@/lib/tds/rateEngine";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter,
} from "@/components/ui/sheet";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import {
  Plus, Trash2, Pencil, AlertTriangle, CheckCircle2, Undo2,
  CreditCard, RefreshCw, ArrowRight, RotateCcw, Lock, FileText, Loader2, FileSpreadsheet, Upload,
  Archive, ArchiveRestore, ChevronDown, ChevronRight, Search, X,
} from "lucide-react";
import { undoCorrectionRow, diffCorrectionRow, effectiveCorrectionAction, getEffectiveClientLedger } from "@/lib/tdsCorrections";
import { generateGeniusExport } from "@/lib/genius-export";
import { importGeniusXls, repairFilingSectionCodes } from "@/lib/genius-import";
import { markUnderProcessIfNotStarted } from "@/lib/tds/filingActivity";
import { logReconAudit } from "@/lib/tdsReconAudit";
import { isInterestOnlyChallan, planInterestChallans, tdsOfEntry, rowsCountedAgainst, countsAgainstChallan } from "@/lib/tds/challanScope";

// ─── Types ───
interface ClientOption {
  id: string; name: string | null; pan: string | null; tan_number?: string | null;
  tds_start_fy?: string; tds_start_quarter?: string; tds_end_fy?: string; tds_end_quarter?: string;
  tds_forms_applicable?: string[];
}
interface UserOption { id: string; name: string | null; }

interface TdsFiling {
  id: string; client_id: string; firm_id: string; financial_year: string;
  quarter: string; tds_forms: string[] | null; work_status: string;
  tan: string | null;
}

interface Challan {
  id: string; filing_id: string; client_id: string; firm_id: string;
  form_type: string; financial_year: string; quarter: string;
  bsr_code: string | null; challan_serial_no: string | null;
  deposit_date: string | null; total_tax_deposited: number;
  surcharge_deposited: number; education_cess_deposited: number;
  interest_deposited: number; others_deposited: number;
  total_challan_amount: number; minor_head_of_challan: string | null;
  is_book_entry: boolean; transfer_voucher_no: string | null;
  cheque_dd_no: string | null; bank_name: string | null;
  section_code: string | null; challan_remarks: string | null;
  late_fees_234e: number;
  // Issue 6 + 7D + 7H
  late_fees_used: number; fully_utilized: boolean;
  origin_quarter: string | null; origin_fy: string | null;
  is_archived?: boolean; archived_at?: string | null; archived_by?: string | null;
  kasar_vatav_amount?: number | null; kasar_vatav_note?: string | null;
  kasar_vatav_by?: string | null; kasar_vatav_at?: string | null;
}

interface Deductee {
  id: string; challan_id: string; filing_id: string; client_id: string;
  firm_id: string; form_type: string; financial_year: string; quarter: string;
  deductee_name: string; deductee_pan: string | null;
  pan_not_available: boolean; deductee_ref_no: string | null;
  deductee_type: string | null; section_code: string;
  nature_of_payment: string | null; amount_paid_credited: number | null;
  date_of_payment: string | null; date_of_deduction: string | null;
  rate_of_tds: number | null; tds_amount: number | null;
  surcharge_amount: number; cess_amount: number; total_tax_deducted: number | null;
  interest_amount: number; late_fees_amount: number;
  lower_deduction_certificate_no: string | null;
  lower_deduction_rate: number | null;
  reason_for_lower_or_nil_deduction: string | null;
  country_of_residence: string | null;
  gross_salary: number | null; standard_deduction_allowed: number | null;
  net_taxable_salary: number | null; designation: string | null;
  remarks: string | null;
}

interface Props {
  clients: ClientOption[];
  users: UserOption[];
  isSuperadmin: boolean;
  resolveFirmId: () => Promise<string | null>;
  // Shared Workspace filing context (owned by the parent TdsFilings page) so the
  // Data Entry and Validate & Finalise tabs stay on the same Client/FY/Quarter/Form.
  selClient: string; setSelClient: (v: string) => void;
  selFy: string; setSelFy: (v: string) => void;
  selQuarter: string; setSelQuarter: (v: string) => void;
  selForm: string; setSelForm: (v: string) => void;

  // ── Correction mode ───────────────────────────────────────────────────────
  // A correction is the SAME return in a second version, so it must be the
  // same screen — same challan cards, utilised/unutilised balances,
  // validations, calculations and dropdowns. Rather than fork this component
  // (which is exactly how the TDS stages ended up with three drifting copies
  // of the same rules), it is pointed at a different pair of tables.
  //
  // 20260729190000 made tds_correction_challans / tds_correction_deductees
  // column-identical to the live tables — same filing_id, challan_id and
  // utilisation columns — so every query below is unchanged apart from the
  // table NAME, and add/modify/delete tracking happens in DB triggers.
  /** Which tables to read and write. Defaults to the live Data Entry tables. */
  source?: TdsEntrySource;
  /** Use THIS filing-shaped row instead of resolving one from the period. */
  filingOverride?: TdsFiling | null;
  /** Force read-only regardless of work_status (e.g. a filed correction). */
  forceReadOnly?: boolean;
  /**
   * Called after any successful write in correction mode. The change summary
   * and Original-vs-Corrected panel live in the PARENT and are derived from
   * trigger-set columns, so the parent has to re-read after every edit.
   */
  onCorrectionChanged?: () => void;
  /**
   * Called AFTER a row has been reverted to its filed state. The undo itself
   * happens in here, not in the parent: the grid renders from THIS component's
   * state, so a parent-side undo updated the database and the parent's own copy
   * while the visible row stayed exactly as it was — which read as "Undo does
   * nothing". This hook is only for logging / parent refresh.
   */
  onCorrectionRowUndone?: (row: any) => void;
  /**
   * Why the screen is read-only, in the caller's own words.
   *
   * The engine equated "locked" with "Filed", which is wrong for a correction:
   * its entries also freeze while it is awaiting senior approval, and again
   * once authorised but not yet filed. Telling the user it is "Filed" in
   * those states is simply untrue.
   */
  lockNotice?: string;
  /** Short label for the inline lock badges. Defaults to "Filed". */
  lockBadgeLabel?: string;
}

/** The table pair this engine reads and writes. */
export interface TdsEntrySource {
  challans: string;
  deductees: string;
  /** Purely for copy — "filing" vs "correction". */
  label?: string;
}

export const LIVE_TDS_SOURCE: TdsEntrySource = {
  challans: "tds_challans",
  deductees: "tds_deductees",
  label: "filing",
};

export const CORRECTION_TDS_SOURCE: TdsEntrySource = {
  challans: "tds_correction_challans",
  deductees: "tds_correction_deductees",
  label: "correction",
};

// ─── Constants ───
const FY_OPTIONS = Array.from({ length: 7 }, (_, i) => { const s = 2020 + i; return `${s}-${String(s + 1).slice(2)}`; });
const QUARTER_OPTIONS = ["Q1", "Q2", "Q3", "Q4"];
const TDS_FORMS = ["24Q", "26Q", "27Q", "27EQ"];

// Office-record fields the user explicitly asked to have audit-tracked on
// edit (tds_filing_audit_log). Scoped deliberately narrow — every OTHER
// field on a deductee row (name, amount, dates, rate, etc.) is intentionally
// NOT logged here; logging every keystroke would drown the trail that
// matters. Keyed by the exact tds_deductees column name so callers can look
// up straight off the `field` string already in hand.
const TRACKED_DEDUCTEE_AUDIT_FIELDS: Record<string, { actionType: string; label: string }> = {
  deductee_pan: { actionType: "DEDUCTEE_PAN_EDIT", label: "PAN" },
  section_code: { actionType: "DEDUCTEE_SECTION_EDIT", label: "Section" },
  lower_deduction_certificate_no: { actionType: "DEDUCTEE_LDC_NUMBER_EDIT", label: "Lower Deduction Certificate No." },
  lower_deduction_rate: { actionType: "DEDUCTEE_LDC_RATE_EDIT", label: "Lower Deduction Rate" },
};

const REASON_CODES = [
  { code: "A", label: "A — Below threshold (no deduction required)" },
  { code: "B", label: "B — Lower rate certificate u/s 197" },
  { code: "C", label: "C — No deduction u/s 197A (Form 15G/15H)" },
  { code: "D", label: "D — Payment to Government" },
  { code: "E", label: "E — Notification/rules exemption" },
  { code: "Y", label: "Y — Any other reason" },
  { code: "Z", label: "Z — Higher rate u/s 206AA (PAN not available)" },
];

const NEW_REGIME_SLABS = [
  { from: 0, to: 400000, rate: 0 },
  { from: 400001, to: 800000, rate: 5 },
  { from: 800001, to: 1200000, rate: 10 },
  { from: 1200001, to: 1600000, rate: 15 },
  { from: 1600001, to: 2000000, rate: 20 },
  { from: 2000001, to: 2400000, rate: 25 },
  { from: 2400001, to: Infinity, rate: 30 },
];
const OLD_REGIME_SLABS = [
  { from: 0, to: 250000, rate: 0 },
  { from: 250001, to: 500000, rate: 5 },
  { from: 500001, to: 1000000, rate: 20 },
  { from: 1000001, to: Infinity, rate: 30 },
];

const calcTaxWithRebate = (totalIncome: number, regime: "new" | "old"): number => {
  let tax = 0;
  const slabs = regime === "new" ? NEW_REGIME_SLABS : OLD_REGIME_SLABS;
  let remaining = totalIncome;
  for (const slab of slabs) {
    if (remaining <= 0) break;
    const range = slab.to === Infinity ? remaining : slab.to - slab.from + 1;
    const taxable = Math.min(remaining, range);
    tax += taxable * slab.rate / 100;
    remaining -= taxable;
  }
  if (regime === "new" && totalIncome <= 1200000) tax = 0;
  if (regime === "old" && totalIncome <= 500000) tax = Math.max(0, tax - 12500);
  const cess = Math.round(tax * 0.04);
  return Math.round(tax + cess);
};

// Interest-only challans / period scoping live in @/lib/tds/challanScope;
// re-exported here for existing imports.
export { isInterestOnlyChallan, planInterestChallans };

// #3 FIX: Parse date strings as LOCAL midnight to avoid UTC-vs-local timezone shift.
// new Date("2025-02-07") → UTC 00:00 → IST 05:30 the same day, which compares AFTER
// new Date(y, m-1, d) → local 00:00 IST.  Both must use the same reference.

const parseLocalDate = (dateStr: string): Date => {
  const parts = dateStr.split("-");
  return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
};

// ─── Previous-quarter label helper ───────────────────────────────────────────
// Returns the canonical "previous quarter" label for a given current quarter+FY.
// Edge-case for Q1: rolls back to Q4 of the preceding financial year.
//   currentFY format: '2025-26'  →  prevFY for Q1: '2024-25'
const getPreviousQuarterLabel = (currentQuarter: string, currentFY: string): string => {
  const [startStr] = currentFY.split("-");
  const startYear = parseInt(startStr, 10);
  let prevQuarter: string;
  let prevFY: string;
  switch (currentQuarter) {
    case "Q1":
      prevQuarter = "Q4";
      prevFY = `${startYear - 1}-${String(startYear).slice(-2)}`;
      break;
    case "Q2": prevQuarter = "Q1"; prevFY = currentFY; break;
    case "Q3": prevQuarter = "Q2"; prevFY = currentFY; break;
    case "Q4": prevQuarter = "Q3"; prevFY = currentFY; break;
    default:   prevQuarter = "Q?"; prevFY = currentFY; break;
  }
  return `🔒 ${prevQuarter} FY ${prevFY} Entries (Read-Only)`;
};

// Build a section header label for read-only entries that belong to a
// DIFFERENT quarter than the one currently being viewed. "Other" rather than
// "Previous" because a challan can also accumulate FUTURE-quarter utilisation
// (e.g., a Q1 challan partly used in Q2 → when viewing Q1, those Q2 entries
// are 'future' but still read-only here).
// Examples:
//   Single other quarter  →  "🔒 Q2 FY 2025-26 Entries (Read-Only)"
//   Multiple other qtrs   →  "🔒 Entries from other quarters (Q1, Q2 FY 2025-26) — Read Only"
const buildPrevQuarterLabel = (
  prevEntries: Array<{ quarter: string; financial_year: string }>,
  selQuarter: string,
  selFy: string,
): string => {
  if (prevEntries.length === 0) return getPreviousQuarterLabel(selQuarter, selFy);
  // Collect unique "Q? FY ????-??" combinations
  const seen = new Set<string>();
  prevEntries.forEach(e => seen.add(`${e.quarter} FY ${e.financial_year}`));
  if (seen.size === 1) {
    // Single quarter — show exact label from data (most accurate)
    const [first] = seen;
    return `🔒 ${first} Entries (Read-Only)`;
  }
  // Multiple other quarters — group by FY for compact display
  const byFy: Record<string, string[]> = {};
  prevEntries.forEach(e => {
    if (!byFy[e.financial_year]) byFy[e.financial_year] = [];
    if (!byFy[e.financial_year].includes(e.quarter)) byFy[e.financial_year].push(e.quarter);
  });
  const parts = Object.entries(byFy)
    .map(([fy, qs]) => `${qs.sort().join(", ")} FY ${fy}`)
    .join("; ");
  return `🔒 Entries from other quarters (${parts}) — Read Only`;
};

// ═══════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════
/**
 * The filed values of an edited correction entry, rendered in the SAME columns
 * as the row above so old and new line up and can be read across.
 *
 * `original_values` is the snapshot the database takes the instant before the
 * first edit (migration 20260729200000) — not a re-derivation, so it is exactly
 * what was filed. Fields that actually changed are highlighted; the rest are
 * muted, which keeps the eye on the difference.
 */
function CorrectionOriginalRow({ original, current, form }: {
  original: Record<string, any>;
  current: Record<string, any>;
  form: string;
}) {
  const same = (a: any, b: any) => {
    const n = (v: any) => {
      if (v === null || v === undefined || v === "") return null;
      const num = Number(v);
      return Number.isFinite(num) && String(v).trim() !== "" ? num : String(v);
    };
    return n(a) === n(b);
  };

  const money = (v: any) =>
    v === null || v === undefined || v === "" ? "—"
      : new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(Number(v));
  const text = (v: any) => (v === null || v === undefined || v === "" ? "—" : String(v));
  const date = (v: any) => {
    if (!v) return "—";
    const d = new Date(v);
    return isNaN(d.getTime()) ? String(v) : d.toLocaleDateString("en-GB");
  };

  // Mirror the visible columns for this form, so the old row lines up.
  const cols: { key: string; render: (v: any) => string }[] =
    form === "24Q"
      ? [
          { key: "deductee_name", render: text },
          { key: "deductee_pan", render: text },
          { key: "date_of_payment", render: date },
          { key: "gross_salary", render: money },
          { key: "standard_deduction_allowed", render: money },
          { key: "net_taxable_salary", render: money },
          { key: "total_tax_deducted", render: money },
          { key: "__spacer_details", render: () => "" },
        ]
      : [
          { key: "deductee_name", render: text },
          { key: "deductee_pan", render: text },
          { key: "deductee_type", render: text },
          { key: "section_code", render: text },
          { key: "amount_paid_credited", render: money },
          { key: "date_of_payment", render: date },
          { key: "rate_of_tds", render: text },
          { key: "total_tax_deducted", render: money },
          { key: "interest_amount", render: money },
          { key: "reason_for_lower_or_nil_deduction", render: text },
        ];

  return (
    <TableRow className="bg-red-50/40 dark:bg-red-950/10 border-b-2">
      <TableCell />
      <TableCell className="text-[10px] uppercase tracking-wide text-muted-foreground whitespace-nowrap">
        Original
      </TableCell>
      {cols.map(c => {
        if (c.key.startsWith("__spacer")) return <TableCell key={c.key} />;
        const changed = !same(original[c.key], current[c.key]);
        return (
          <TableCell
            key={c.key}
            className={cn(
              "text-xs",
              changed
                ? "text-red-700 dark:text-red-400 font-medium line-through"
                : "text-muted-foreground/60",
            )}
            title={changed ? `Was: ${c.render(original[c.key])} · Now: ${c.render(current[c.key])}` : undefined}
          >
            {c.render(original[c.key])}
          </TableCell>
        );
      })}
      <TableCell />
    </TableRow>
  );
}

export function TdsDataEntry({
  clients, users, isSuperadmin, resolveFirmId,
  selClient, setSelClient, selFy, setSelFy, selQuarter, setSelQuarter, selForm, setSelForm,
  source, filingOverride, forceReadOnly, onCorrectionChanged, onCorrectionRowUndone,
  lockNotice, lockBadgeLabel,
}: Props) {
  const { user } = useAuth();
  const { toast } = useToast();

  // The table pair this instance drives. Defaults to the live Data Entry
  // tables, so every existing call site behaves exactly as before.
  const SRC = source ?? LIVE_TDS_SOURCE;
  const isCorrectionMode = SRC.challans !== LIVE_TDS_SOURCE.challans;
  // Collapsed by default, Correction tab only — a correction usually touches
  // one or two entries, so the full challan grid + deductee table is mostly
  // noise until the user asks to see it. Data Entry is unaffected: it never
  // sets this to false, so the section there stays exactly as it always has.
  const [challansExpanded, setChallansExpanded] = useState(!isCorrectionMode);
  // Display name for the acting user on audit-log entries — resolved from the
  // already-fetched `users` list (same pattern as other TDS screens), no
  // separate fetch needed.
  const currentUserName = useMemo(
    () => users.find(u => u.id === user?.id)?.name || null,
    [users, user?.id]
  );

  // Client/FY/Quarter/Form are the SHARED Workspace context (owned by the parent),
  // so a return selected here is already loaded when the user opens Validate & Finalise.
  const [filingLoaded, setFilingLoaded] = useState(false);

  const [filing, setFiling] = useState<TdsFiling | null>(null);
  const [challans, setChallans] = useState<Challan[]>([]);
  const [deductees, setDeductees] = useState<Deductee[]>([]); // current quarter entries
  const [prevEntries, setPrevEntries] = useState<Deductee[]>([]); // previous quarter entries (carry-forward, read-only)
  const [allChallanDeductees, setAllChallanDeductees] = useState<Record<string, Deductee[]>>({});
  const [carryForwardChallans, setCarryForwardChallans] = useState<{ challan: Challan; fromQuarter: string; fromFy: string; appliedAmount: number }[]>([]);
  const [selectedChallan, setSelectedChallan] = useState<Challan | null>(null);
  // Archive: hides a no-longer-needed challan from every active list (this
  // filing's own challans, Carry-Forward candidates, balance/utilisation
  // calculations) without deleting it — reversible via Unarchive. Fetched
  // for THIS CLIENT as a whole (not scoped to the current quarter/form) since
  // an archived challan is being put away more permanently, the same way
  // Carry-Forward already looks across periods.
  const [showArchivedChallans, setShowArchivedChallans] = useState(false);
  const [archivedChallans, setArchivedChallans] = useState<Challan[]>([]);
  const [archivingId, setArchivingId] = useState<string | null>(null);
  const [archivedSearch, setArchivedSearch] = useState("");
  // Archived Challans is fetched per-client (not per-quarter/form), so it
  // only needs to reset on an actual CLIENT switch — resetting on every
  // quarter/form change within the same client would just force a redundant
  // refetch. Collapsed closed too, so the next client starts from a clean
  // toggle rather than immediately showing (possibly stale-looking) state.
  useEffect(() => {
    setShowArchivedChallans(false);
    setArchivedChallans([]);
    setArchivedSearch("");
  }, [selClient]);
  const filteredArchivedChallans = useMemo(() => {
    const q = archivedSearch.trim().toLowerCase();
    if (!q) return archivedChallans;
    return archivedChallans.filter(ac =>
      (ac.bsr_code || "").toLowerCase().includes(q) ||
      (ac.challan_serial_no || "").toLowerCase().includes(q) ||
      (ac.section_code || "").toLowerCase().includes(q) ||
      `${ac.form_type} ${ac.quarter} ${ac.financial_year}`.toLowerCase().includes(q) ||
      String(ac.total_challan_amount || "").includes(q)
    );
  }, [archivedChallans, archivedSearch]);
  // Kasar-Vatav: records a small, genuinely-unattachable residual balance
  // (₹5, ₹10, a stray ₹250 — no deductee left to put it against) as a
  // deliberate, attributed write-off so the challan can close out as Fully
  // Utilised. See rateEngine's withKasarVatav for how it folds into the
  // Applied/Unconsumed/Carry-Forward maths everywhere else in this file.
  const [kasarVatavDialogChallan, setKasarVatavDialogChallan] = useState<Challan | null>(null);
  const [kasarVatavAmountInput, setKasarVatavAmountInput] = useState("");
  const [kasarVatavNoteInput, setKasarVatavNoteInput] = useState("");
  const [kasarVatavSaving, setKasarVatavSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);
  const [importLoading, setImportLoading] = useState(false);
  const importFileInputRef = useRef<HTMLInputElement>(null);
  const [rateMaster, setRateMaster] = useState<RateEntry[]>([]);

  // Challan dialog
  const [challanDialogOpen, setChallanDialogOpen] = useState(false);
  const [editingChallan, setEditingChallan] = useState<Challan | null>(null);
  const [challanForm, setChallanForm] = useState<Record<string, any>>({});
  // 24Q salary drawer
  const [salaryDrawerOpen, setSalaryDrawerOpen] = useState(false);
  const [salaryDeductee, setSalaryDeductee] = useState<Deductee | null>(null);
  const [salaryForm, setSalaryForm] = useState<Record<string, any>>({});
  const [taxRegime, setTaxRegime] = useState<"new" | "old">("new");

  const autoSaveRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ─── Rate Master ───
  // Filters by financial_year too (previously missing): without it, a
  // form_type with BOTH FY2025-26 and FY2026-27 rows simultaneously
  // is_active=true (the normal carry-forward state) returned every year's
  // rate, and rateMaster.find() picked whichever row Postgres happened to
  // return first — not necessarily the year actually being filed. Scoping to
  // selFy still leaves every date-ranged row WITHIN that year (see
  // getRateForSection in rateEngine.ts), so a rate that changed mid-year can
  // still resolve correctly by date_of_payment once such a row exists.
  const fetchRates = useCallback(async () => {
    const { data } = await supabase.from("tds_rate_master").select("section_code, nature_of_payment, rate_individual, rate_company, rate_no_pan, threshold_individual, threshold_company, effective_from, effective_to, payment_code, new_section_code, new_section_description")
      .eq("form_type", selForm).eq("financial_year", selFy).eq("is_active", true);
    setRateMaster((data || []) as RateEntry[]);
  }, [selForm, selFy]);

  useEffect(() => { fetchRates(); }, [fetchRates, selFy]);

  // Any Data Entry activity on a fresh filing auto-advances it out of
  // "Not Started" — the user shouldn't have to separately remember to flip
  // the Dashboard's Status dropdown just to reflect that work has begun.
  const bumpUnderProcess = useCallback(async () => {
    if (!filing) return;
    // NOT in correction mode. `filing.id` is the CORRECTION's id there, and
    // this writes to tds_filings — so every correction edit issued a wrong-id
    // write against the filings table, which then fired the module-wide
    // tds_filings realtime subscription and refreshed the whole TDS module.
    // A correction has its own lifecycle (draft → … → filed); it must not move
    // the original filing's work_status either.
    if (isCorrectionMode) return;
    const flipped = await markUnderProcessIfNotStarted(filing.id, filing.work_status, user?.id);
    if (flipped) setFiling(prev => (prev ? { ...prev, work_status: "Under Process" } : prev));
  }, [filing, user?.id, isCorrectionMode]);

  // ─── Load Filing (Issue 6: try-catch, never crash, empty state on error) ───
  const loadFiling = useCallback(async () => {
    if (!selClient) { toast({ title: "Select a client", variant: "destructive" }); return; }
    setLoading(true);
    setFilingLoaded(false);

    // ── Correction mode ──────────────────────────────────────────────────────
    // The "filing" is the correction itself, handed in by the caller. None of
    // the resolve-or-create logic below applies: a correction is never
    // auto-created from a period, and the TDS Compliance gate was already
    // applied when the correction was raised. Re-checking it here would refuse
    // to open a perfectly valid correction for a client whose compliance
    // period has since been closed — precisely when a correction is likeliest.
    if (filingOverride) {
      setFiling(filingOverride);
      await fetchChallans(filingOverride.id);
      // No carry-forward: a correction revises ONE already-filed period, and
      // prior-quarter challans live in the live tables, not this version.
      setCarryForwardChallans([]);
      setFilingLoaded(true);
      setLoading(false);
      return;
    }

    // TDS Compliance is the single source of truth for module membership —
    // refuse to load or auto-create a filing for a client with no TDS
    // Compliance configured at all, or for a (FY, quarter) outside their
    // configured period.
    const selectedClient = clients.find(c => c.id === selClient);
    if (!selectedClient?.tds_start_fy) {
      setFiling(null); setChallans([]); setDeductees([]); setPrevEntries([]);
      setSelectedChallan(null); setCarryForwardChallans([]);
      setFilingLoaded(true);
      setLoading(false);
      toast({ title: "TDS Compliance not configured", description: "This client has no TDS Compliance / Start Quarter set in Edit Client → Service Specific.", variant: "destructive" });
      return;
    }
    if (!isQuarterInTdsRange(
      selFy, selQuarter,
      selectedClient.tds_start_fy, selectedClient.tds_start_quarter || "Q1",
      selectedClient.tds_end_fy, selectedClient.tds_end_quarter,
    )) {
      setFiling(null); setChallans([]); setDeductees([]); setPrevEntries([]);
      setSelectedChallan(null); setCarryForwardChallans([]);
      setFilingLoaded(true);
      setLoading(false);
      const rangeLabel = `${selectedClient.tds_start_quarter} ${selectedClient.tds_start_fy}` +
        (selectedClient.tds_end_fy ? ` to ${selectedClient.tds_end_quarter} ${selectedClient.tds_end_fy}` : " onward (no end date)");
      toast({ title: "Outside TDS compliance period", description: `This client's TDS compliance period is ${rangeLabel}.`, variant: "destructive" });
      return;
    }

    // TDS Forms Applicable — refuse to load or auto-create a filing for a
    // form the client isn't currently configured for.
    if (!clientHasTdsForm(selectedClient?.tds_forms_applicable, selForm)) {
      setFiling(null); setChallans([]); setDeductees([]); setPrevEntries([]);
      setSelectedChallan(null); setCarryForwardChallans([]);
      setFilingLoaded(true);
      setLoading(false);
      toast({ title: "Form not applicable", description: `This client is not configured for ${selForm} under TDS Compliance.`, variant: "destructive" });
      return;
    }

    try {
      const { data } = await supabase.from("tds_filings").select("*")
        .eq("client_id", selClient).eq("financial_year", selFy).eq("quarter", selQuarter).limit(10);
      const match = (data || []).find((f: any) => (f.tds_forms || []).includes(selForm));

      if (match) {
        setFiling(match as TdsFiling);
        // Self-heal existing rows before displaying them: a filing imported
        // before the Genius section-code fix has challans/deductees stuck
        // with a corrupted or Rate-Master-less section_code — re-importing
        // would only duplicate deductees (there's no dedup on that table), so
        // the fix has to reach into what's already stored. Cheap when there's
        // nothing to fix (two reads, zero writes); see repairFilingSectionCodes.
        try {
          const firmIdForRepair = await resolveFirmId();
          if (firmIdForRepair) {
            const repair = await repairFilingSectionCodes((match as TdsFiling).id, firmIdForRepair, selForm, selFy);
            if (repair.challansFixed || repair.deducteesFixed) await fetchRates();
          }
        } catch (rErr) {
          console.warn("[TdsDataEntry] Section-code repair skipped:", rErr);
        }
        await fetchChallans((match as TdsFiling).id);
        await fetchCarryForwardChallans(selClient, selFy, selQuarter, selForm);
      } else {
        // No filing found — auto-create it if TDS service is active for this client.
        // This handles clients activated before the auto-create logic existed, and
        // also allows the workspace to be used immediately after activation.
        const firmId = await resolveFirmId();
        const { data: cats } = await supabase
          .from("service_categories").select("id").eq("linked_module", "tds");
        const catIds = (cats || []).map((c: any) => c.id);
        let tdsActive = false;
        if (catIds.length > 0) {
          const { data: cs } = await supabase
            .from("client_services").select("id")
            .eq("client_id", selClient).eq("is_active", true)
            .in("service_category_id", catIds).limit(1);
          tdsActive = (cs?.length ?? 0) > 0;
        }
        if (tdsActive) {
          const { data: clientRow } = await supabase
            .from("clients").select("tan_number").eq("id", selClient).maybeSingle();
          const { data: insertedFiling, error: insertError } = await (supabase.from("tds_filings").insert({
            client_id:      selClient,
            firm_id:        firmId,
            financial_year: selFy,
            quarter:        selQuarter,
            tds_forms:      [selForm],
            work_status:    "Not Started",
            tan:            (clientRow as any)?.tan_number || null,
          }).select().single() as any);

          // A concurrent call (e.g. two tabs, or the bulk sync in
          // TdsFilingsManager) may have created this exact row a moment
          // earlier — the unique index rejects our insert, not a real
          // failure. Re-fetch instead of showing an empty state.
          let newFiling = insertedFiling;
          if (!newFiling && insertError) {
            const { data: existing } = await supabase.from("tds_filings").select("*")
              .eq("client_id", selClient).eq("financial_year", selFy).eq("quarter", selQuarter)
              .contains("tds_forms", [selForm]).maybeSingle();
            newFiling = existing;
          }

          if (newFiling) {
            setFiling(newFiling as TdsFiling);
            await fetchChallans((newFiling as TdsFiling).id);
            await fetchCarryForwardChallans(selClient, selFy, selQuarter, selForm);
          } else {
            setFiling(null);
            setChallans([]); setDeductees([]); setPrevEntries([]);
            setSelectedChallan(null); setCarryForwardChallans([]);
          }
        } else {
          setFiling(null);
          setChallans([]); setDeductees([]); setPrevEntries([]);
          setSelectedChallan(null); setCarryForwardChallans([]);
        }
      }
    } catch (err: any) {
      // Issue 6: Never show "Something went wrong" — return empty state
      setFiling(null); setChallans([]); setDeductees([]); setPrevEntries([]);
      setSelectedChallan(null); setCarryForwardChallans([]);
      toast({ title: "Could not load filing", description: err?.message || "Please try again.", variant: "destructive" });
    }
    setFilingLoaded(true);
    setLoading(false);
  }, [selClient, selFy, selQuarter, selForm, clients, filingOverride]);

  const resetFiling = () => {
    setFiling(null); setChallans([]); setDeductees([]); setPrevEntries([]);
    setSelectedChallan(null); setFilingLoaded(false);
    setCarryForwardChallans([]); setAllChallanDeductees({});
  };

  // CP-03: Auto-load whenever all 4 selector fields are set.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (selClient && selFy && selQuarter && selForm) {
      loadFiling();
    } else {
      resetFiling();
    }
    // filingOverride?.id so opening a different correction reloads the screen.
  }, [selClient, selFy, selQuarter, selForm, filingOverride?.id]); // loadFiling/resetFiling intentionally omitted — stable callbacks

  // ── Live lock/unlock sync ──────────────────────────────────────────────────
  // isFilingLocked (below) reads filing.work_status from this component's own
  // state, which loadFiling only (re)populates on mount/selector-change — a
  // Firm Admin/Super Admin approving an edit-access request in Validate &
  // Finalise (which reverts work_status away from Ready to File) would
  // otherwise leave an already-open Data Entry tab showing the stale
  // "locked" state until the user reselects the filing or reloads the page.
  // Full loadFiling() re-run (not just a work_status patch) since the whole
  // point of an approved unlock is that the underlying data may now differ.
  const loadFilingRef = useRef(loadFiling);
  loadFilingRef.current = loadFiling;
  useEffect(() => {
    if (!filing?.id) return;
    const channel = supabase
      .channel(`tds-data-entry-lock-${filing.id}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "tds_filings", filter: `id=eq.${filing.id}` }, () => loadFilingRef.current())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [filing?.id]);

  // ─── Carry Forward — CP-04: cross-FY support ──────────────────────────────
  //
  // Convert a (FY, Quarter) pair to a single sortable integer so periods from
  // different financial years can be compared with plain < / > operators.
  //   e.g. FY 2026-27 Q3  →  startYear=2026, Q=3  →  20263
  //        FY 2027-28 Q1  →  startYear=2027, Q=1  →  20271
  //   20263 < 20271  ✔  so Q3/2026-27 is correctly identified as "prior".
  //
  // BUG BEFORE: qNum <= 1 short-circuited Q1 of any year (so Q4-prev-FY→Q1-new-FY
  // never ran), and `.eq("financial_year", fy)` capped the lookup to the same FY.
  //
  // FIX: fetch ALL filings for this client (any FY), keep those whose computed
  // period number is strictly less than the current period, then run the same
  // unconsumed-balance check as before.
  const fetchCarryForwardChallans = async (clientId: string, fy: string, quarter: string, form: string) => {
    const periodToNum = (periodFy: string, periodQ: string): number => {
      const startYear = parseInt(periodFy.split("-")[0], 10);
      const qNum = parseInt(periodQ.replace("Q", ""), 10);
      return startYear * 10 + qNum;
    };

    const currentPeriod = periodToNum(fy, quarter);

    // Read the EFFECTIVE ledger — originally filed challans/deductees, with
    // any FILED correction's numbers substituted in for the period it
    // revised — not the raw tables. Otherwise a challan whose consumption a
    // correction reduced (freeing up balance) would keep showing as fully
    // used here, and the freed balance would never reach later quarters.
    //
    // Deliberately NOT scoped to form_type: a COMBINED PAYMENT — one bank
    // challan funding both e.g. 24Q and 26Q — is recorded under whichever
    // form's Genius import happened to see it first (see
    // resolveExistingChallansByNumber in genius-import.ts, which already
    // reuses a challan by Bank Challan Number across forms). Any of the
    // client's prior-period challans with remaining balance is a legitimate
    // carry-forward candidate for THIS form too, regardless of which form
    // originally created the row — the applied/unconsumed maths below
    // already sum every form's deductees against it (unfiltered by form),
    // so this is purely about not hiding a challan that money-wise is still
    // usable here.
    const { challans: effectiveChallans, deductees: effectiveDeductees } = await getEffectiveClientLedger(clientId);

    const priorChallans = (effectiveChallans as unknown as Challan[]).filter(c =>
      c.quarter && c.financial_year &&
      periodToNum(c.financial_year, c.quarter) < currentPeriod
    );
    if (priorChallans.length === 0) { setCarryForwardChallans([]); return; }

    const challanIds = new Set(priorChallans.map(c => c.id));
    // Fetch FULL deductee rows (not just sum fields) so we can merge them into
    // allChallanDeductees — getChallanBreakdownAll looks up deductees from that
    // map to compute 'Used (all Q)' for carry-forward challans.
    const allDeds = effectiveDeductees.filter(d => d.challan_id && challanIds.has(d.challan_id));

    // Track which prior challans have CURRENT-QUARTER utilisation — i.e.,
    // deductees whose quarter+FY matches the currently-selected quarter.
    // These challans must be shown in the Carry-Forward list even if they
    // are "fully utilised overall", so the user can view/edit the current-
    // quarter entries attached to them.
    const currentQUsage = new Set<string>();
    const appliedMap = new Map<string, number>();
    const cfGrouped: Record<string, Deductee[]> = {};
    const challanById = new Map(priorChallans.map((c: any) => [c.id, c]));
    (allDeds || []).forEach((d: any) => {
      // Same fix as getChallanBreakdownAll, and for the same reason: a row's
      // persisted interest_amount is only ever written by the grid's own
      // per-cell edit handler, so a row that arrived via bulk import and was
      // never hand-edited afterward can sit at 0 forever while the challan
      // itself (and the grid's own read-only Interest cell) show the real,
      // non-zero figure. This is a SEPARATE, independent reimplementation of
      // the same "applied" concept from getChallanBreakdownAll's — not the
      // shared computeApplied() — so it carried the identical bug: a fully-
      // utilised prior-quarter challan (confirmed for real: TDS ₹2,39,452 +
      // interest ₹7,184 = the challan's own ₹2,46,636 total, but both
      // deductees' stored interest_amount was 0) computed a large fake
      // "unconsumed" balance and kept re-qualifying for the Carry-Forward
      // list quarter after quarter even though nothing was actually left.
      if (!cfGrouped[d.challan_id]) cfGrouped[d.challan_id] = [];
      cfGrouped[d.challan_id].push(d as Deductee);
      if (d.quarter === quarter && d.financial_year === fy) {
        currentQUsage.add(d.challan_id);
      }
    });
    // Interest is rounded once per CHALLAN (withChallanInterest), so it is
    // worked out over each challan's whole row set, not row by row.
    for (const [challanId, rows] of Object.entries(cfGrouped)) {
      const depDate = challanById.get(challanId)?.deposit_date || null;
      const applied = withChallanInterest(rowsCountedAgainst(challanById.get(challanId), rows), depDate, tdsOfEntry)
        .reduce((s, d) => s + (d.total_tax_deducted || d.tds_amount || 0) + d.interest_amount + (d.surcharge_amount || 0), 0);
      appliedMap.set(challanId, applied);
    }

    const carried: { challan: Challan; fromQuarter: string; fromFy: string; appliedAmount: number }[] = [];
    priorChallans.forEach((c: any) => {
      const applied = appliedMap.get(c.id) || 0;
      // Kasar-Vatav write-off counts as "spoken for" here too (see
      // withKasarVatav) — otherwise a challan closed out specifically to
      // stop cluttering this list would immediately re-qualify for it.
      const unconsumed = (c.total_challan_amount || 0) - withKasarVatav(applied, c.kasar_vatav_amount) - (c.late_fees_234e || 0);
      const hasCurrentQEntries = currentQUsage.has(c.id);
      // Show this prior challan in the Carry-Forward list if it either:
      //   (a) has remaining unused balance (the classic "still has cash left"
      //       case), OR
      //   (b) has current-quarter entries attached to it (the import or a
      //       manual Add Row under a CF challan has consumed balance in THIS
      //       quarter — user must still be able to see/edit those entries).
      if (unconsumed > 0.5 || hasCurrentQEntries) {
        carried.push({
          challan: c as Challan,
          // Read origin quarter/FY directly from the challan (stable) rather
          // than looking it up via its (possibly drifted) filing_id.
          fromQuarter: c.quarter || "?",
          fromFy: c.financial_year || fy,
          appliedAmount: applied,
        });
      }
    });
    setCarryForwardChallans(carried);
    // Merge carry-forward deductees into allChallanDeductees so the breakdown
    // card (Used / Available) shows correct amounts in the Q2+ list view.
    setAllChallanDeductees(prev => ({ ...prev, ...cfGrouped }));
  };

  // Client-wide, not scoped to the current quarter/form/filing — an archived
  // challan is being put away more permanently (the same reasoning
  // fetchCarryForwardChallans already applies across periods), so "Show
  // Archived Challans" surfaces every archived challan for this client.
  const fetchArchivedChallans = async (clientId: string) => {
    // Read through getEffectiveClientLedger (same as fetchCarryForwardChallans)
    // rather than the raw tables directly — a filed correction that reduced a
    // deductee's amount (freeing up balance) must show that freed balance
    // here too. Querying tds_deductees directly, as this used to, showed the
    // stale pre-correction figures: a challan the active Carry-Forward list
    // correctly reported as "Available ₹9" read as fully consumed the moment
    // it was archived, because the raw table still held the original,
    // uncorrected deductee amount.
    const { challans: archived, deductees: effectiveDeductees } = await getEffectiveClientLedger(clientId, { archived: true });
    archived.sort((a: any, b: any) => (b.archived_at || "").localeCompare(a.archived_at || ""));
    setArchivedChallans(archived as unknown as Challan[]);
    if (archived.length) {
      const archivedIds = new Set(archived.map((c: any) => c.id));
      const grouped: Record<string, Deductee[]> = {};
      effectiveDeductees.forEach((d: any) => {
        if (!d.challan_id || !archivedIds.has(d.challan_id)) return;
        if (!grouped[d.challan_id]) grouped[d.challan_id] = [];
        grouped[d.challan_id].push(d as Deductee);
      });
      setAllChallanDeductees(prev => ({ ...prev, ...grouped }));
    }
  };

  /** Archive: a soft, reversible way to put away a challan that's no longer
   *  needed, without deleting it (and its history) outright. Blocked only
   *  while the challan has a deductee attached IN THE PERIOD CURRENTLY BEING
   *  VIEWED — an in-progress own challan or a carry-forward challan actually
   *  drawn on this quarter must not silently vanish mid-use. A carry-forward
   *  challan whose balance was consumed entirely in a PRIOR quarter (the
   *  "why does this fully-utilised challan keep showing up" case) has no
   *  current-period usage and is exactly what this feature exists for, so
   *  callers pass the period-scoped count rather than an all-time one. */
  const archiveChallan = async (c: Challan, activePeriodCount: number) => {
    if (!user?.id || isFilingLocked) return;
    if (activePeriodCount > 0) {
      toast({ title: "Can't archive", description: `This challan still has ${activePeriodCount} deductee${activePeriodCount === 1 ? "" : "s"} attached in the current period — remove or reassign them first.`, variant: "destructive" });
      return;
    }
    setArchivingId(c.id);
    const now = new Date().toISOString();
    const { error } = await supabase.from(SRC.challans as any)
      .update({ is_archived: true, archived_at: now, archived_by: user.id })
      .eq("id", c.id).eq("is_archived", false); // CAS — a no-op if already archived
    if (error) {
      toast({ title: "Archive failed", description: error.message, variant: "destructive" });
      setArchivingId(null);
      return;
    }
    await logReconAudit({
      filingId: c.filing_id, firmId: c.firm_id, userId: user.id, userName: currentUserName || user.email || "Unknown",
      actionType: "CHALLAN_ARCHIVED",
      oldValue: `${c.bsr_code || "—"} / ${c.challan_serial_no || "—"} — active`,
      newValue: "archived",
      remark: `Archived challan ${c.bsr_code || "—"} / ${c.challan_serial_no || "—"} (₹${(c.total_challan_amount || 0).toLocaleString("en-IN")}).`,
    });
    toast({ title: "Challan archived", description: "It no longer appears in the active list or Carry-Forward. Restore it any time from Show Archived Challans." });
    setChallans(prev => prev.filter(x => x.id !== c.id));
    setCarryForwardChallans(prev => prev.filter(x => x.challan.id !== c.id));
    if (selectedChallan?.id === c.id) setSelectedChallan(null);
    if (showArchivedChallans && selClient) await fetchArchivedChallans(selClient);
    setArchivingId(null);
  };

  /** Restore — the challan re-enters the active list exactly as it was; no
   *  separate "reactivation" step, since archiving never touched anything
   *  but these three columns. */
  const unarchiveChallan = async (c: Challan) => {
    if (!user?.id || isFilingLocked) return;
    setArchivingId(c.id);
    const { error } = await supabase.from(SRC.challans as any)
      .update({ is_archived: false, archived_at: null, archived_by: null })
      .eq("id", c.id).eq("is_archived", true); // CAS — a no-op if already active
    if (error) {
      toast({ title: "Restore failed", description: error.message, variant: "destructive" });
      setArchivingId(null);
      return;
    }
    await logReconAudit({
      filingId: c.filing_id, firmId: c.firm_id, userId: user.id, userName: currentUserName || user.email || "Unknown",
      actionType: "CHALLAN_UNARCHIVED",
      oldValue: "archived",
      newValue: `${c.bsr_code || "—"} / ${c.challan_serial_no || "—"} — active`,
      remark: `Restored challan ${c.bsr_code || "—"} / ${c.challan_serial_no || "—"} from the archive.`,
    });
    toast({ title: "Challan restored", description: "It's back in the active challan list, available for utilisation again." });
    setArchivedChallans(prev => prev.filter(x => x.id !== c.id));
    // Refresh the active lists so a restored challan that belongs to the
    // CURRENTLY selected filing/period reappears immediately.
    if (filing?.id) await fetchChallans(filing.id);
    if (selClient) await fetchCarryForwardChallans(selClient, selFy, selQuarter, selForm);
    setArchivingId(null);
  };

  /** Opens the Kasar-Vatav dialog for a challan, defaulting the amount to the
   *  full raw unconsumed gap (allocatable minus real deductee applied — NOT
   *  minus any existing write-off) so one click closes the challan
   *  completely. Editing an existing adjustment re-opens with its current
   *  total rather than the delta, since the field IS the total. */
  const openKasarVatavDialog = (c: Challan) => {
    if (isFilingLocked) return;
    const bd = getChallanBreakdownAll(c.id);
    const existing = c.kasar_vatav_amount || 0;
    // The gap before ANY kasar-vatav write-off — bd.unconsumed already nets
    // out the EXISTING write-off (it's folded into effectiveApplied), so add
    // it back: the amount entered here REPLACES, not adds to, that existing
    // value (see the pre-fill just below).
    const rawUnconsumed = bd.unconsumed + existing;
    setKasarVatavDialogChallan(c);
    setKasarVatavAmountInput(String(existing > 0 ? existing : rawUnconsumed));
    setKasarVatavNoteInput(c.kasar_vatav_note || "");
  };

  const closeKasarVatavDialog = () => {
    setKasarVatavDialogChallan(null);
    setKasarVatavAmountInput("");
    setKasarVatavNoteInput("");
  };

  /** Writes a Kasar-Vatav amount (0 = remove) to `c`, with the audit log,
   *  toast, local-state patch, and refetch every caller needs — the ONE place
   *  that actually persists an adjustment, so submitKasarVatav (validated
   *  amount) and removeKasarVatav (explicit, one-click removal) can't drift
   *  into two different "how do I clear this" behaviours. */
  const applyKasarVatav = async (c: Challan, amt: number, note: string) => {
    if (!user?.id || isFilingLocked) return;
    const prevAmount = c.kasar_vatav_amount || 0;
    setKasarVatavSaving(true);
    const now = new Date().toISOString();
    const { error } = await supabase.from("tds_challans")
      .update({
        kasar_vatav_amount: amt,
        kasar_vatav_note: amt > 0 ? note.trim() : null,
        kasar_vatav_by: amt > 0 ? user.id : null,
        kasar_vatav_at: amt > 0 ? now : null,
      } as any)
      .eq("id", c.id);
    if (error) {
      toast({ title: amt > 0 ? "Adjustment failed" : "Could not remove adjustment", description: error.message, variant: "destructive" });
      setKasarVatavSaving(false);
      return;
    }
    await logReconAudit({
      filingId: c.filing_id, firmId: c.firm_id, userId: user.id, userName: currentUserName || user.email || "Unknown",
      actionType: amt > 0 ? "CHALLAN_KASAR_VATAV_ADJUSTED" : "CHALLAN_KASAR_VATAV_REMOVED",
      oldValue: prevAmount > 0 ? `₹${prevAmount.toLocaleString("en-IN")}` : "none",
      newValue: amt > 0 ? `₹${amt.toLocaleString("en-IN")}` : "none",
      remark: amt > 0
        ? `Kasar-Vatav adjustment of ₹${amt.toLocaleString("en-IN")} on challan ${c.bsr_code || "—"} / ${c.challan_serial_no || "—"}: ${note.trim()}`
        : `Removed Kasar-Vatav adjustment (was ₹${prevAmount.toLocaleString("en-IN")}) on challan ${c.bsr_code || "—"} / ${c.challan_serial_no || "—"}.`,
    });
    const patch = { kasar_vatav_amount: amt, kasar_vatav_note: amt > 0 ? note.trim() : null, kasar_vatav_by: amt > 0 ? user.id : null, kasar_vatav_at: amt > 0 ? now : null };
    setChallans(prev => prev.map(x => x.id === c.id ? { ...x, ...patch } : x));
    setCarryForwardChallans(prev => prev.map(x => x.challan.id === c.id ? { ...x, challan: { ...x.challan, ...patch } } : x));
    setSelectedChallan(prev => prev && prev.id === c.id ? { ...prev, ...patch } : prev);
    toast({ title: amt > 0 ? "Kasar-Vatav adjustment saved" : "Adjustment removed", description: amt > 0 ? "The challan's remaining balance has been written off." : undefined });
    if (filing?.id) await fetchChallans(filing.id);
    if (selClient) await fetchCarryForwardChallans(selClient, selFy, selQuarter, selForm);
    setKasarVatavSaving(false);
    closeKasarVatavDialog();
  };

  const submitKasarVatav = async () => {
    const c = kasarVatavDialogChallan;
    if (!c || !user?.id || isFilingLocked) return;
    const bd = getChallanBreakdownAll(c.id);
    const rawUnconsumed = bd.unconsumed + (c.kasar_vatav_amount || 0);
    const amt = parseFloat(kasarVatavAmountInput);
    if (isNaN(amt) || amt < 0) {
      toast({ title: "Enter a valid amount", variant: "destructive" });
      return;
    }
    // Paise-tolerant cap — a write-off can't exceed what's actually missing,
    // that would retroactively make the challan look over-applied.
    if (Math.round(amt * 100) > Math.round(rawUnconsumed * 100) + 1) {
      toast({ title: "Amount too high", description: `Kasar-Vatav can't exceed the unconsumed balance of ₹${rawUnconsumed.toLocaleString("en-IN")}.`, variant: "destructive" });
      return;
    }
    if (amt > 0 && !kasarVatavNoteInput.trim()) {
      toast({ title: "Reason required", description: "Add a short remark for the adjustment — it's recorded in the audit log.", variant: "destructive" });
      return;
    }
    await applyKasarVatav(c, amt, kasarVatavNoteInput);
  };

  /** One-click, explicit reversal — the discoverable counterpart to typing 0
   *  into the amount field. No reason re-entry required: the removal itself
   *  is logged (CHALLAN_KASAR_VATAV_REMOVED) with the prior amount/note, so
   *  the audit trail already explains what was undone and why it was there. */
  const removeKasarVatav = async () => {
    const c = kasarVatavDialogChallan;
    if (!c || !user?.id || isFilingLocked || (c.kasar_vatav_amount || 0) <= 0) return;
    await applyKasarVatav(c, 0, "");
  };

  const fetchChallans = async (filingId: string) => {
    // Query by the stable logical key (client+FY+quarter+form) rather than
    // just filing_id. filing_id is a UUID that can drift if the filing row
    // was re-created (e.g., after a prior delete) — its challans would then
    // be orphaned and disappear from the UI while still existing in the DB.
    // Self-heal any stale filing_id back to the current one so future queries
    // match strictly too.
    // Correction mode scopes STRICTLY by filing_id (the correction's id).
    // The logical-key query below is right for live data — one filing per
    // period — but a client can have several corrections for the SAME period,
    // and the logical key cannot tell them apart, so it would merge two
    // corrections' challans into one screen. Correction rows also get their
    // filing_id from a trigger, so it cannot drift and needs no self-heal.
    // Archived challans are excluded from the active list here (both the
    // live and correction paths) — they must not appear, be selectable, or
    // count toward any balance/utilisation total until restored. A
    // correction against an already-archived challan is not a real workflow
    // this app supports, so no special-casing is needed there either.
    // is_archived only exists on the live tds_challans table, not on
    // tds_correction_challans — a correction is a fixed snapshot, so
    // "archiving" (a live-data concept) does not apply to it. Filtering on
    // that column in correction mode queries a nonexistent column, which
    // silently returns zero rows and makes the whole section look empty.
    const challanQuery = isCorrectionMode
      ? supabase.from(SRC.challans as any).select("*")
          .eq("filing_id", filingId)
          .order("deposit_date", { ascending: true })
      : supabase.from(SRC.challans as any).select("*")
          .eq("client_id", selClient)
          .eq("form_type", selForm)
          .eq("financial_year", selFy)
          .eq("quarter", selQuarter)
          .eq("is_archived", false)
          .order("deposit_date", { ascending: true });

    const { data } = await challanQuery;
    const ownList = (data as unknown as Challan[]) || [];

    // Self-heal filing_id drift — ONLY for this form's OWN challans. A SHARED
    // challan (below) legitimately belongs to a different form's filing_id;
    // overwriting that here would sever it from the return that actually
    // created it.
    const stale = isCorrectionMode ? [] : ownList.filter(c => c.filing_id !== filingId);
    if (stale.length > 0) {
      console.log(`[TDS] Repairing filing_id on ${stale.length} challan(s) for ${selFy} ${selQuarter} ${selForm}`);
      const { error: fixErr } = await supabase.from(SRC.challans as any)
        .update({ filing_id: filingId })
        .in("id", stale.map(c => c.id));
      if (fixErr) console.warn("[TDS] filing_id self-heal failed:", fixErr.message);
      // Reflect the fix in the in-memory list so the UI shows correct relations
      stale.forEach(c => { (c as any).filing_id = filingId; });
    }

    // A COMBINED PAYMENT — one bank challan funding deductions on more than
    // one form (e.g. 24Q and 26Q) — is deposited under whichever form's
    // Genius import happened to see it first; every later form's import
    // reuses that SAME challan row by Bank Challan Number rather than
    // duplicating it (see resolveExistingChallansByNumber in genius-import.ts).
    // That means its OWN form_type column never changes to match every form
    // now using it, so the query above alone would make it invisible on this
    // form's screen even though this form's deductees are correctly attached
    // to it. Find those via the deductee side instead: any challan (whatever
    // its own form_type) that has at least one deductee actually booked
    // under THIS form/quarter/FY is genuinely in use here and must show up,
    // with its Applied/Available already reflecting every form's usage
    // (the deductee sums below carry no form_type filter).
    const { data: sharedDeds } = await supabase.from(SRC.deductees as any).select("challan_id")
      .eq("client_id", selClient).eq("form_type", selForm)
      .eq("financial_year", selFy).eq("quarter", selQuarter);
    const ownIds = new Set(ownList.map(c => c.id));
    const sharedIds = Array.from(new Set((sharedDeds || []).map((d: any) => d.challan_id as string)))
      .filter(id => !ownIds.has(id));
    let sharedList: Challan[] = [];
    if (sharedIds.length > 0) {
      // Defensive only — archiving a challan is blocked while it still has
      // deductees attached (see archiveChallan below), so a live deductee
      // should never actually reference an archived one. Filtered anyway so
      // this stays correct even if that invariant is ever relaxed. Not
      // applicable in correction mode — see the comment on challanQuery above.
      let sharedQuery = supabase.from(SRC.challans as any).select("*").in("id", sharedIds);
      if (!isCorrectionMode) sharedQuery = sharedQuery.eq("is_archived", false);
      const { data: sharedChallans } = await sharedQuery;
      sharedList = (sharedChallans as unknown as Challan[]) || [];
    }

    const list = [...ownList, ...sharedList].sort((a, b) =>
      (a.deposit_date || "").localeCompare(b.deposit_date || ""));

    setChallans(list);
    if (list.length > 0) {
      const challanIds = list.map(c => c.id);
      const { data: allDeds } = await supabase.from(SRC.deductees as any).select("*")
        .in("challan_id", challanIds).order("created_at");
      const grouped: Record<string, Deductee[]> = {};
      (allDeds || []).forEach((d: any) => {
        if (!grouped[d.challan_id]) grouped[d.challan_id] = [];
        grouped[d.challan_id].push(d as Deductee);
      });
      // MERGE (not replace) so any carry-forward deductee data that
      // fetchCarryForwardChallans populated earlier for prior-quarter
      // challans isn't wiped. Current-quarter entries (challanIds) always
      // take precedence since they're the freshest.
      setAllChallanDeductees(prev => ({ ...prev, ...grouped }));
      setSelectedChallan(list[0]);
      // Split first challan entries using BOTH filing_id AND quarter/FY/form.
      // Using quarter+FY+form makes the split resilient to legacy records
      // where filing_id might be stale (e.g., filing was re-created after an
      // accidental delete) — form_type is required here (not just quarter+FY)
      // because a SHARED (combined-payment) challan can hold another form's
      // entries for this SAME quarter+FY, which must stay read-only, never
      // merge into this form's own editable list.
      const firstAll = grouped[list[0].id] || [];
      const isCurrent = (d: any) =>
        d.filing_id === filingId ||
        (d.quarter === selQuarter && d.financial_year === selFy && d.form_type === selForm);
      // Non-current entries (both prior AND future quarters) are shown as
      // read-only rows. Each retains its own quarter/FY so the label can
      // correctly say e.g. "Q2 FY 2025-26 Entries (Read-Only)".
      setPrevEntries(firstAll.filter(d => !isCurrent(d)));
      setDeductees(firstAll.filter(d => isCurrent(d)));
    } else {
      setSelectedChallan(null); setDeductees([]); setPrevEntries([]);
      // Don't wipe allChallanDeductees — carry-forward data for this client's
      // prior quarters is still relevant and gets populated by
      // fetchCarryForwardChallans. Only loadFiling resets this map fully
      // when the client/FY/quarter combo actually changes.
    }
  };

  // Helper: always refresh challans + carry-forward together after any
  // DB mutation (new/edit/delete challan, genius import, etc.) so the
  // Used / Available amounts on carry-forward cards stay accurate.
  const refreshChallansAndCF = async (filingId: string) => {
    await fetchChallans(filingId);
    await fetchCarryForwardChallans(selClient, selFy, selQuarter, selForm);
  };

  // Helper: is this deductee an entry FOR the currently-selected filing?
  // Uses both filing_id (strict UUID match) AND quarter/financial_year/form
  // (stable regardless of filing UUID changes). Robust against legacy data
  // where a deductee may have a stale filing_id but correct quarter/FY/form
  // fields. form_type is required alongside quarter+FY (not just quarter+FY
  // alone) because a SHARED (combined-payment) challan can hold a DIFFERENT
  // form's entries for this exact same quarter+FY — those must stay
  // read-only here, never merge into this form's own editable list.
  const isCurrentQuarterDeductee = useCallback((d: { filing_id?: string | null; quarter?: string | null; financial_year?: string | null; form_type?: string | null }) => {
    if (filing && d.filing_id === filing.id) return true;
    if (d.quarter === selQuarter && d.financial_year === selFy && d.form_type === selForm) return true;
    return false;
  }, [filing, selQuarter, selFy, selForm]);

  // Helper: is this deductee from a PRIOR quarter (earlier FY/quarter than the
  // currently-selected one)? These appear as read-only carry-forward entries.
  // Future-quarter entries (belonging to a LATER quarter) are NOT prior — they
  // should only be visible in their own quarter's view, not here.
  const isPriorQuarterDeductee = useCallback((d: { quarter?: string | null; financial_year?: string | null }) => {
    if (!d.quarter || !d.financial_year) return false;
    const periodNum = (fy: string, q: string) => {
      const y = parseInt(fy.split("-")[0], 10);
      const n = parseInt(q.replace("Q", ""), 10);
      return y * 10 + n;
    };
    const deductee = periodNum(d.financial_year, d.quarter);
    const current = periodNum(selFy, selQuarter);
    return deductee < current;
  }, [selQuarter, selFy]);

  // Issue 5: Split entries into prev (read-only) and current (editable)
  const fetchDeductees = async (challanId: string) => {
    const { data } = await supabase.from(SRC.deductees as any).select("*")
      .eq("challan_id", challanId).order("created_at", { ascending: true });
    const rawList = (data || []) as unknown as Deductee[];

    // The CURRENT quarter's own entries are live and editable, so they always
    // come straight from the raw table. Any OTHER quarter's entries attached
    // to this challan are read-only history — if that quarter has since had
    // a correction filed, history must show the corrected values, not what
    // was originally filed (see getEffectiveClientLedger). Without this, a
    // freshly-selected carry-forward challan overwrote allChallanDeductees
    // with the raw, pre-correction rows fetchCarryForwardChallans had
    // already substituted correctly — the balance and the read-only history
    // both silently reverted to the filed-return figures the moment the
    // card was clicked.
    let list = rawList;
    if (!isCorrectionMode && selClient) {
      const currentRaw = rawList.filter(d => isCurrentQuarterDeductee(d));
      const hasPriorRows = rawList.some(d => !isCurrentQuarterDeductee(d));
      if (hasPriorRows) {
        const { deductees: effectiveDeductees } = await getEffectiveClientLedger(selClient);
        const priorEffective = effectiveDeductees.filter((d: any) =>
          d.challan_id === challanId && !isCurrentQuarterDeductee(d));
        list = [...priorEffective, ...currentRaw] as unknown as Deductee[];
      }
    }

    // Store ALL entries for cross-quarter balance calc (Issue 7A)
    setAllChallanDeductees(prev => ({ ...prev, [challanId]: list }));
    // Two-way split:
    //   - current   → editable entries belonging to THIS quarter's filing
    //   - other Q   → read-only entries from a DIFFERENT quarter (earlier
    //                 carry-forward IN or later utilisation of this challan)
    // Both past and future entries are shown as read-only so the user sees
    // the COMPLETE history of this challan's utilisation regardless of which
    // quarter they're viewing. Each read-only row shows its own quarter/FY
    // label via buildPrevQuarterLabel so it's clear which quarter owns it.
    if (filing) {
      setPrevEntries(list.filter(d => !isCurrentQuarterDeductee(d)));
      setDeductees(list.filter(d => isCurrentQuarterDeductee(d)));
    } else {
      setPrevEntries([]);
      setDeductees(list);
    }
  };

  const selectChallan = (c: Challan) => {
    setPrevEntries([]); // reset before fetch
    setSelectedChallan(c);
    fetchDeductees(c.id);
  };

  // ─── Rate lookup ───
  // asOfDate (the deductee's own date_of_payment) picks the right row when a
  // section has more than one date-ranged rate within the selected financial
  // year (e.g. a rate cut effective partway through the year) — see
  // rateEngine.ts. Defaults to today when no date is known yet.
  const getRateForSection = (sectionCode: string, deducteeType?: string | null, asOfDate?: string | null) =>
    getRateForSectionPure(rateMaster, sectionCode, deducteeType, asOfDate);

  // ─── Challan CRUD ───
  const openAddChallan = () => {
    setEditingChallan(null);
    setChallanForm({
      bsr_code: "", challan_serial_no: "", deposit_date: "",
      minor_head: "200", total_tax: "", surcharge: "", education_cess: "",
      interest: "", others: "", late_fees_234e: "", is_book_entry: false,
      transfer_voucher_no: "", bank_name: "", section_code: "", remarks: "",
    });
    setChallanDialogOpen(true);
  };

  const openEditChallan = (c: Challan) => {
    setEditingChallan(c);
    setChallanForm({
      bsr_code: c.bsr_code || "", challan_serial_no: c.challan_serial_no || "",
      deposit_date: c.deposit_date || "", minor_head: c.minor_head_of_challan || "200",
      total_tax: String(c.total_tax_deposited || ""),
      surcharge: String(c.surcharge_deposited || ""),
      education_cess: String(c.education_cess_deposited || ""),
      interest: String(c.interest_deposited || ""),
      others: String(c.others_deposited || ""),
      late_fees_234e: String(c.late_fees_234e || ""),
      is_book_entry: c.is_book_entry,
      transfer_voucher_no: c.transfer_voucher_no || "",
      bank_name: c.bank_name || "",
      section_code: c.section_code || "",
      remarks: c.challan_remarks || "",
    });
    setChallanDialogOpen(true);
  };

  const challanTotal = useMemo(() => {
    return (parseFloat(challanForm.total_tax) || 0) +
      (parseFloat(challanForm.surcharge) || 0) +
      (parseFloat(challanForm.education_cess) || 0) +
      (parseFloat(challanForm.interest) || 0) +
      (parseFloat(challanForm.others) || 0) +
      (parseFloat(challanForm.late_fees_234e) || 0);
  }, [challanForm.total_tax, challanForm.surcharge, challanForm.education_cess, challanForm.interest, challanForm.others, challanForm.late_fees_234e]);

  const saveChallan = async () => {
    if (!filing || isFilingLocked) return;
    if (!challanForm.bsr_code || challanForm.bsr_code.length !== 7) {
      toast({ title: "BSR Code must be 7 digits", variant: "destructive" }); return;
    }
    if (!challanForm.challan_serial_no || challanForm.challan_serial_no.length !== 5) {
      toast({ title: "Challan Number must be 5 digits", variant: "destructive" }); return;
    }
    // Reject numeric-only Bank Name values (likely an amount typed into the wrong field)
    if (challanForm.bank_name && /^[\d,.\s]+$/.test(challanForm.bank_name.trim())) {
      toast({ title: "Bank Name must be a name, not a number", description: "Clear the field or enter the actual bank name (e.g. ICICI Bank).", variant: "destructive" }); return;
    }

    // ── Uniqueness check: Challan Number must be globally unique ─────────────
    // BSR code can legitimately repeat (same bank branch receives many challans),
    // but the Challan Number assigned by the bank is unique per deposit in the
    // entire TDS system. It cannot legitimately appear in two filings — its
    // unused balance flows to later quarters via CARRY-FORWARD, not by re-
    // adding the challan. Skip this check when editing the same row.
    const dupQuery = supabase
      .from(SRC.challans as any)
      .select("id, filing_id, financial_year, quarter, form_type, client_id, bsr_code")
      .eq("challan_serial_no", challanForm.challan_serial_no);
    if (editingChallan?.id) dupQuery.neq("id", editingChallan.id);
    const { data: dupRows } = await dupQuery.limit(1);
    if (dupRows && dupRows.length > 0) {
      const d = dupRows[0] as any;
      const sameClient = d.client_id === filing.client_id;
      // Deductor name — only needs a lookup for the "another client" case;
      // the current client's own name is already in scope via `clients`.
      const deductorName = sameClient
        ? (clients.find(c => c.id === filing.client_id)?.name || "this client")
        : ((await supabase.from("clients").select("name").eq("id", d.client_id).single()).data?.name || "another client");
      const whereMsg = `${deductorName}'s ${d.form_type} ${d.quarter} FY ${d.financial_year} filing (BSR ${d.bsr_code})`;
      toast({
        title: "This challan already exists in the system and cannot be imported or created again.",
        description: `Challan Number ${challanForm.challan_serial_no} already exists in ${whereMsg}. Its balance flows to later quarters via Carry-Forward — don't re-add the challan.`,
        variant: "destructive",
      });
      return;
    }

    const firmId = await resolveFirmId();
    const payload: any = {
      filing_id: filing.id, client_id: filing.client_id,
      firm_id: firmId || filing.firm_id, form_type: selForm,
      financial_year: selFy, quarter: selQuarter,
      bsr_code: challanForm.bsr_code, challan_serial_no: challanForm.challan_serial_no,
      deposit_date: challanForm.deposit_date || null,
      total_tax_deposited: parseFloat(challanForm.total_tax) || 0,
      surcharge_deposited: parseFloat(challanForm.surcharge) || 0,
      education_cess_deposited: parseFloat(challanForm.education_cess) || 0,
      interest_deposited: parseFloat(challanForm.interest) || 0,
      others_deposited: parseFloat(challanForm.others) || 0,
      total_challan_amount: challanTotal,
      minor_head_of_challan: challanForm.minor_head || "200",
      is_book_entry: challanForm.is_book_entry || false,
      transfer_voucher_no: challanForm.is_book_entry ? challanForm.transfer_voucher_no || null : null,
      bank_name: challanForm.bank_name || null,
      section_code: challanForm.section_code || null,
      challan_remarks: challanForm.remarks || null,
      late_fees_234e: parseFloat(challanForm.late_fees_234e) || 0,
    };
    // Try with late_fees_234e first; if the column doesn't exist yet in DB,
    // fall back to saving without it (migration pending).
    let error: any;
    const tryInsertOrUpdate = async (p: any) => {
      if (editingChallan) {
        return supabase.from(SRC.challans as any).update(p).eq("id", editingChallan.id);
      } else {
        return supabase.from(SRC.challans as any).insert(p);
      }
    };
    // Audit trail — log NEW challan creation only (not edits to an existing
    // one). Fire-and-forget, called after the write already succeeded.
    const auditChallanCreate = () => {
      if (editingChallan) return;
      logReconAudit({
        filingId: filing.id, firmId: payload.firm_id,
        userId: user?.id, userName: currentUserName,
        actionType: "CHALLAN_CREATE",
        newValue: `Challan ${payload.challan_serial_no}, ₹${challanTotal.toLocaleString("en-IN")} deposited`,
        remark: `New challan added (BSR ${payload.bsr_code}) for ${selForm} ${selQuarter} FY ${selFy}`,
      });
    };
    ({ error } = await tryInsertOrUpdate(payload));
    if (error && (error.message?.includes("late_fees_234e") || error.message?.includes("schema cache"))) {
      // Column not yet in DB — save without it, show partial success notice
      const { late_fees_234e: _removed, ...payloadWithoutLateFees } = payload;
      ({ error } = await tryInsertOrUpdate(payloadWithoutLateFees));
      if (!error) {
        toast({ title: editingChallan ? "Challan updated" : "Challan added", description: "Note: Late Fees field will be available after database migration is applied." });
        setChallanDialogOpen(false);
        auditChallanCreate();
        await refreshChallansAndCF(filing.id);
        await bumpUnderProcess();
        onCorrectionChanged?.();
        return;
      }
    }
    if (error) { toast({ title: "Error saving challan", description: error.message, variant: "destructive" }); return; }
    toast({ title: editingChallan ? "Challan updated" : "Challan added" });
    setChallanDialogOpen(false);
    auditChallanCreate();
    await refreshChallansAndCF(filing.id);
    await bumpUnderProcess();
    onCorrectionChanged?.();
  };

  /** Deleting a challan CASCADE-deletes every deductee attached to it — including
   *  ones from a DIFFERENT form/filing sharing this same challan via the
   *  combined-payment reuse feature (tds_deductees.challan_id is ON DELETE
   *  CASCADE). That blast radius must be visible in the audit log, not just
   *  "a challan was deleted" — a deletion with no attribution and no record of
   *  what it took with it is exactly how real Data Entry data disappears
   *  without a trace. */
  const deleteChallan = async (c: Challan) => {
    if (isFilingLocked) return;
    const { count } = await supabase.from(SRC.deductees as any)
      .select("id", { count: "exact", head: true }).eq("challan_id", c.id);
    const { error } = await supabase.from(SRC.challans as any).delete().eq("id", c.id);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Challan deleted" });
    await logReconAudit({
      filingId: c.filing_id, firmId: c.firm_id, userId: user?.id, userName: currentUserName || user?.email || "Unknown",
      actionType: "CHALLAN_DELETED",
      oldValue: `${c.bsr_code || "—"} / ${c.challan_serial_no || "—"} — ₹${(c.total_challan_amount || 0).toLocaleString("en-IN")}`,
      newValue: "deleted",
      remark: `Deleted challan ${c.bsr_code || "—"} / ${c.challan_serial_no || "—"} (${c.form_type} ${c.quarter} FY ${c.financial_year})`
        + ((count ?? 0) > 0 ? ` — cascade-deleted ${count} deductee(s) attached to it (including any from a different form/filing sharing this challan).` : "."),
    });
    if (filing) await refreshChallansAndCF(filing.id);
    await bumpUnderProcess();
    onCorrectionChanged?.();
  };

  // ─── Deductee CRUD ───
  const addDeducteeRow = async () => {
    if (!selectedChallan || !filing || isFilingLocked) return;
    // Issue 7F: Block add when challan balance = 0
    const bd = getChallanBreakdownAll(selectedChallan.id);
    if (bd.interestOnly) {
      toast({ title: "Interest challan", description: "This challan only carries interest (no TDS) — it is matched to the late-deposit interest on the other challans, so no deductee entries go against it.", variant: "destructive" });
      return;
    }
    const balance = (selectedChallan.total_challan_amount || 0) - bd.applied;
    if (balance <= 0) {
      toast({ title: "Challan fully utilized", description: "No remaining balance in this challan to add more entries.", variant: "destructive" });
      return;
    }
    const firmId = await resolveFirmId();
    const defaultSection = selectedChallan.section_code || "";
    const { rate } = getRateForSection(defaultSection);
    const { data, error } = await supabase.from(SRC.deductees as any).insert({
      challan_id: selectedChallan.id, filing_id: filing.id,
      client_id: filing.client_id, firm_id: firmId || filing.firm_id,
      form_type: selForm, financial_year: selFy, quarter: selQuarter,
      deductee_name: "", section_code: defaultSection,
      surcharge_amount: 0, cess_amount: 0, interest_amount: 0, late_fees_amount: 0,
      pan_not_available: false, rate_of_tds: rate,
    } as any).select("*").single();
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    const newDed = data as unknown as Deductee;
    setDeductees(prev => [...prev, newDed]);
    // Update allChallanDeductees too
    setAllChallanDeductees(prev => ({
      ...prev,
      [selectedChallan.id]: [...(prev[selectedChallan.id] || []), newDed],
    }));
    await bumpUnderProcess();
    onCorrectionChanged?.();
  };

  const updateDeducteeField = async (deducteeId: string, field: string, value: any) => {
    const deductee = deductees.find(d => d.id === deducteeId);
    if (!deductee) return;
    const updates: Record<string, any> = { [field]: value };

    // date_of_payment is what actually determines which rate LAW applies —
    // when this field itself changes, re-resolve using the NEW date so a row
    // moved across a rate-change boundary picks up the correct rate, exactly
    // like a section/type/PAN change already does. Every OTHER branch below
    // that looks up a rate uses the deductee's existing date (or the fresh
    // value here) as of-date, since none of those fields change the date.
    const asOfDate = field === "date_of_payment" ? value : deductee.date_of_payment;

    if (field === "section_code") {
      const { rate, nature } = getRateForSection(value, deductee.deductee_type, asOfDate);
      if (rate !== null) {
        updates.rate_of_tds = deductee.pan_not_available ? (getRateForSection(value, deductee.deductee_type, asOfDate).noPanRate || 20) : rate;
        if (deductee.amount_paid_credited) {
          updates.tds_amount = Math.round(deductee.amount_paid_credited * updates.rate_of_tds / 100);
          updates.total_tax_deducted = updates.tds_amount;
        }
        updates.nature_of_payment = nature;
      }
    }
    if (field === "deductee_type") {
      const { rate } = getRateForSection(deductee.section_code, value, asOfDate);
      if (rate !== null && !deductee.pan_not_available) {
        updates.rate_of_tds = rate;
        if (deductee.amount_paid_credited) {
          updates.tds_amount = Math.round(deductee.amount_paid_credited * rate / 100);
          updates.total_tax_deducted = updates.tds_amount;
        }
      }
    }
    if (field === "amount_paid_credited") {
      const amt = parseFloat(value) || 0;
      const rate = deductee.rate_of_tds || 0;
      updates.tds_amount = Math.round(amt * rate / 100);
      updates.total_tax_deducted = updates.tds_amount;
    }
    if (field === "rate_of_tds") {
      const rate = parseFloat(value) || 0;
      const amt = deductee.amount_paid_credited || 0;
      updates.tds_amount = Math.round(amt * rate / 100);
      updates.total_tax_deducted = updates.tds_amount;
    }
    if (field === "date_of_payment") {
      // Re-resolve the rate for whichever effective-dated row now applies —
      // matches the software's own PAN-availability rule (pan_not_available
      // still forces the flat no-PAN rate regardless of date).
      const { rate, noPanRate, rateFound } = getRateForSection(deductee.section_code, deductee.deductee_type, asOfDate);
      const resolvedRate = deductee.pan_not_available ? (noPanRate ?? 20) : rate;
      if (rateFound && resolvedRate !== null) {
        updates.rate_of_tds = resolvedRate;
        if (deductee.amount_paid_credited) {
          updates.tds_amount = Math.round(deductee.amount_paid_credited * resolvedRate / 100);
          updates.total_tax_deducted = updates.tds_amount;
        }
      }
    }
    if (["amount_paid_credited", "rate_of_tds", "date_of_payment", "deductee_pan"].includes(field)) {
      const newTds = updates.tds_amount ?? deductee.tds_amount ?? deductee.total_tax_deducted ?? 0;
      const newPayDate = field === "date_of_payment" ? value : deductee.date_of_payment;
      updates.interest_amount = calcAutoInterest(newTds, newPayDate, selectedChallan?.deposit_date || null).interest;
    }
    if (field === "deductee_pan") {
      const panVal = (value || "").trim().toUpperCase();
      updates.deductee_pan = panVal || null;
      if (!panVal || !isValidPan(panVal)) {
        updates.pan_not_available = true;
        if (panVal && panVal.length >= 4 && PAN_4TH_CHAR_MAP[panVal[3]]) updates.deductee_type = PAN_4TH_CHAR_MAP[panVal[3]];
        else if (!panVal) updates.deductee_type = null;
        const { noPanRate } = getRateForSection(deductee.section_code, deductee.deductee_type, asOfDate);
        updates.rate_of_tds = noPanRate || 20;
        if (deductee.amount_paid_credited) {
          updates.tds_amount = Math.round(deductee.amount_paid_credited * updates.rate_of_tds / 100);
          updates.total_tax_deducted = updates.tds_amount;
        }
      } else {
        updates.pan_not_available = false;
        const detectedType = PAN_4TH_CHAR_MAP[panVal[3]] || null;
        if (detectedType) updates.deductee_type = detectedType;
        const effectiveType = detectedType || deductee.deductee_type;
        const { rate, rateFound } = getRateForSection(deductee.section_code, effectiveType, asOfDate);
        if (rateFound && rate !== null) {
          updates.rate_of_tds = rate;
          if (deductee.amount_paid_credited) {
            updates.tds_amount = Math.round(deductee.amount_paid_credited * rate / 100);
            updates.total_tax_deducted = updates.tds_amount;
          }
        }
      }
    }

    // ── Pre-save cross-utilization guard (firm instruction, 2026-08-06) ──────
    // Only the fields that can move TDS/Interest — see the identical field
    // list a few lines up, which is exactly when interest_amount also gets
    // recomputed here. Blocks only when THIS edit INCREASES the challan
    // past its total, never for a challan that was already over-applied
    // before this edit (a typo fix or unrelated field change on an
    // already-bad challan — e.g. imported before this guard existed —
    // must still be editable; only a genuinely new over-application from
    // THIS save is rejected).
    if (deductee.challan_id && ["amount_paid_credited", "rate_of_tds", "date_of_payment", "deductee_pan"].includes(field)) {
      const challanId = deductee.challan_id;
      const bdBefore = getChallanBreakdownAll(challanId);
      const challanObj = challans.find(c => c.id === challanId)
        || (selectedChallan?.id === challanId ? selectedChallan : null)
        || carryForwardChallans.find(cf => cf.challan.id === challanId)?.challan
        || archivedChallans.find(ac => ac.id === challanId) || null;
      if (challanObj) {
        const siblingRows = rowsCountedAgainst(challanObj as Challan, challanId === selectedChallan?.id ? [...prevEntries, ...deductees] : (allChallanDeductees[challanId] || []))
          .filter((d: any) => !(isCorrectionMode && (d as any).action === "delete"));
        const projectedRows = siblingRows.map((d: any) => d.id === deducteeId ? { ...d, ...updates } : d);
        const pooled = computeChallanPooled(challanObj as any, projectedRows as any);
        // Same allowance as getChallanBreakdownAll: interest a separate
        // interest challan already paid is not counted against this challan.
        const projectedApplied = pooled.effectiveApplied
          - (isInterestOnlyChallan(challanObj as Challan) ? 0
            : interestPaidViaIntChallan(challanId, pooled.interest, (challanObj as Challan).interest_deposited || 0));
        if (isChallanOverApplied(projectedApplied, pooled.allocatable) && projectedApplied > bdBefore.effectiveApplied) {
          toast({
            title: "Over-applied — entry blocked",
            description: `This would take the challan to ₹${projectedApplied.toLocaleString("en-IN")} against a total of ₹${pooled.allocatable.toLocaleString("en-IN")} — exceeds it by ₹${(projectedApplied - pooled.allocatable).toLocaleString("en-IN")}. Reduce this entry or increase the challan total first.`,
            variant: "destructive",
          });
          return;
        }
      }
    }

    // Correction mode: return the stored row. action / original_values are set
    // by DB TRIGGERS, so merging only what the client sent would leave the row
    // looking unchanged (Change column "—", "No changes yet") until a reload —
    // which is exactly the bug this avoids.
    const upd = supabase.from(SRC.deductees as any).update(updates).eq("id", deducteeId);
    const { data: savedRow, error } = isCorrectionMode
      ? await (upd as any).select().maybeSingle()
      : await upd;
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    // Audit trail — PAN / Section / LDC No. / LDC Rate edits only (the fields
    // explicitly asked to be tracked), and only when the value genuinely
    // changed. Fire-and-forget: logReconAudit never throws and must never
    // gate or block the save that already succeeded above.
    const tracked = TRACKED_DEDUCTEE_AUDIT_FIELDS[field];
    if (tracked) {
      const oldVal = (deductee as any)[field] ?? null;
      const newVal = (updates as any)[field] ?? null;
      if (oldVal !== newVal) {
        logReconAudit({
          filingId: deductee.filing_id, firmId: deductee.firm_id,
          userId: user?.id, userName: currentUserName,
          actionType: tracked.actionType,
          oldValue: oldVal !== null ? String(oldVal) : null,
          newValue: newVal !== null ? String(newVal) : null,
          remark: `${tracked.label} changed for ${deductee.deductee_name || "deductee"} (${selForm} ${selQuarter} FY ${selFy})`,
        });
      }
    }
    const merged = { ...deductee, ...updates, ...((savedRow as any) || {}) };
    setDeductees(prev => prev.map(d => d.id === deducteeId ? merged : d));
    // Issue 7G: sync allChallanDeductees for instant balance update
    if (selectedChallan) {
      setAllChallanDeductees(prev => ({
        ...prev,
        [selectedChallan.id]: (prev[selectedChallan.id] || []).map(d => d.id === deducteeId ? merged : d),
      }));
    }
    await bumpUnderProcess();
    onCorrectionChanged?.();
  };

  // Issue 7I: Delete + instant recalculation
  const deleteDeductee = async (id: string) => {
    if (isFilingLocked) return;
    // Snapshot before deleting — this is the only record of what a hard
    // DELETE removed. A silent, unattributed deletion of real Data Entry is
    // exactly the failure mode this closes off.
    const target = deductees.find(d => d.id === id) || prevEntries.find(d => d.id === id) || null;
    const { error } = await supabase.from(SRC.deductees as any).delete().eq("id", id);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    if (target && filing) {
      await logReconAudit({
        filingId: filing.id, firmId: filing.firm_id, userId: user?.id, userName: currentUserName || user?.email || "Unknown",
        actionType: "DEDUCTEE_DELETED",
        oldValue: `${target.deductee_name || "—"} · ${target.deductee_pan || "no PAN"} · ₹${(target.total_tax_deducted || target.tds_amount || 0).toLocaleString("en-IN")} TDS`,
        newValue: "deleted",
        remark: `Deleted deductee "${target.deductee_name || "—"}" (${target.section_code || "—"}, ₹${(target.amount_paid_credited || 0).toLocaleString("en-IN")} paid) from ${target.form_type} ${target.quarter} FY ${target.financial_year}${isCorrectionMode ? " — correction draft" : ""}.`,
      });
    }

    // In a correction the DELETE is intercepted by a trigger: a row that came
    // from the filed return SURVIVES, marked action='delete', so the correction
    // still shows what was removed. Dropping it from local state here would
    // hide it until the next reload and contradict the screen's whole purpose,
    // so re-read instead. (A row ADDED inside this correction really is gone —
    // the re-read simply will not return it.)
    if (isCorrectionMode) {
      if (selectedChallan) await fetchDeductees(selectedChallan.id);
      await bumpUnderProcess();
      onCorrectionChanged?.();
      return;
    }

    setDeductees(prev => prev.filter(d => d.id !== id));
    // Issue 7I: Instantly update allChallanDeductees for balance recalc
    if (selectedChallan) {
      setAllChallanDeductees(prev => ({
        ...prev,
        [selectedChallan.id]: (prev[selectedChallan.id] || []).filter(d => d.id !== id),
      }));
      // Issue 7D: if challan was fully_utilized, re-enable it
      if (selectedChallan.fully_utilized) {
        await supabase.from(SRC.challans as any).update({ fully_utilized: false } as any).eq("id", selectedChallan.id);
        setSelectedChallan(prev => prev ? { ...prev, fully_utilized: false } : prev);
      }
    }
    await bumpUnderProcess();
    onCorrectionChanged?.();
  };

  // ─── Correction undo ──────────────────────────────────────────────────────
  // Reverting has to happen HERE because the grid renders from this
  // component's own `deductees` / `challans` state. Doing the update in the
  // parent left the visible row untouched until a reload, which is exactly
  // what "the Undo button is not working" looked like.
  const undoCorrectionEntry = async (d: Deductee) => {
    if (!isCorrectionMode || isFilingLocked) return;
    const err = await undoCorrectionRow(SRC.deductees as any, d as any);
    if (err) { toast({ title: "Could not undo", description: err, variant: "destructive" }); return; }
    // Re-read this challan's rows so the row's badge, values and the Original
    // comparison line all reflect the restored state immediately.
    if (selectedChallan) await fetchDeductees(selectedChallan.id);
    onCorrectionRowUndone?.(d);
    onCorrectionChanged?.();
    toast({ title: "Change undone", description: "The entry is back to its filed values." });
  };

  const undoCorrectionChallanRow = async (c: Challan) => {
    if (!isCorrectionMode || isFilingLocked || !filing) return;
    const err = await undoCorrectionRow(SRC.challans as any, c as any);
    if (err) { toast({ title: "Could not undo", description: err, variant: "destructive" }); return; }
    await fetchChallans(filing.id);
    onCorrectionRowUndone?.(c);
    onCorrectionChanged?.();
    toast({ title: "Change undone", description: "The challan is back to its filed values." });
  };

  // ─── 24Q Salary ───
  const openSalaryDrawer = (d: Deductee) => {
    setSalaryDeductee(d);
    const stdDeduction = taxRegime === "new" ? 75000 : 50000;
    setSalaryForm({
      gross_salary: d.gross_salary || 0,
      standard_deduction: d.standard_deduction_allowed || stdDeduction,
      professional_tax: 0, entertainment_allowance: 0,
      chapter_via_80c: 0, chapter_via_80d: 0, chapter_via_80g: 0, chapter_via_other: 0,
      income_other_sources: 0, income_house_property: 0, tds_previous_employer: 0,
      designation: d.designation || "",
    });
    setSalaryDrawerOpen(true);
  };

  const computedSalaryTax = useMemo(() => {
    const gross = parseFloat(salaryForm.gross_salary) || 0;
    const sd = parseFloat(salaryForm.standard_deduction) || 0;
    const pt = parseFloat(salaryForm.professional_tax) || 0;
    const ea = parseFloat(salaryForm.entertainment_allowance) || 0;
    const netSalary = gross - sd - pt - ea;
    const via = (parseFloat(salaryForm.chapter_via_80c) || 0) + (parseFloat(salaryForm.chapter_via_80d) || 0) +
      (parseFloat(salaryForm.chapter_via_80g) || 0) + (parseFloat(salaryForm.chapter_via_other) || 0);
    const otherIncome = (parseFloat(salaryForm.income_other_sources) || 0) + (parseFloat(salaryForm.income_house_property) || 0);
    const totalIncome = Math.max(0, netSalary - (taxRegime === "old" ? via : 0) + otherIncome);
    const tax = calcTaxWithRebate(totalIncome, taxRegime);
    const prevTds = parseFloat(salaryForm.tds_previous_employer) || 0;
    // Gross Salary isn't imported from a Genius file's Annex-I (it only carries an
    // annual TAXABLE-amount estimate, a different figure) — it's blank until the
    // CA enters it here. Flag that so the UI can show "—" instead of a misleading
    // negative Net Salary (0 minus Standard Deduction) before any real data exists.
    return { netSalary, totalIncome, tax, balanceTax: Math.max(0, tax - prevTds), hasGross: gross > 0 };
  }, [salaryForm, taxRegime]);

  const saveSalaryDetails = async () => {
    if (!salaryDeductee) return;
    const updates = {
      gross_salary: parseFloat(salaryForm.gross_salary) || 0,
      standard_deduction_allowed: parseFloat(salaryForm.standard_deduction) || 0,
      net_taxable_salary: computedSalaryTax.totalIncome,
      tds_amount: computedSalaryTax.tax,
      total_tax_deducted: computedSalaryTax.tax,
      designation: salaryForm.designation || null,
    };
    const { error } = await supabase.from(SRC.deductees as any).update(updates).eq("id", salaryDeductee.id);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    setDeductees(prev => prev.map(d => d.id === salaryDeductee.id ? { ...d, ...updates } : d));
    setSalaryDrawerOpen(false);
    toast({ title: "Salary details saved" });
    await bumpUnderProcess();
    onCorrectionChanged?.();
  };

  // Entries that still COUNT. A correction shows deleted rows struck through
  // so the removal is visible, but they no longer consume the challan, so every
  // total and count must ignore them.
  const liveDeductees = useMemo(
    () => isCorrectionMode ? deductees.filter(d => (d as any).action !== "delete") : deductees,
    [deductees, isCorrectionMode],
  );

  // ─── Challan breakdown (Issue 7A: cross-quarter total) ───
  /**
   * How many ENTRIES under a challan were changed in this correction.
   *
   * A challan's own `action` only flips when its own fields are edited — so a
   * challan holding a modified or deleted deductee still reads 'unchanged',
   * and its card showed nothing. With ten challans on screen that left no way
   * to find the one carrying the change, which is the whole point of the
   * badges. This surfaces the entries' changes on the challan that owns them.
   */
  const correctionChangesForChallan = useCallback((challanId: string) => {
    if (!isCorrectionMode) return null;
    const rows = challanId === selectedChallan?.id
      ? deductees
      : (allChallanDeductees[challanId] || []);
    let add = 0, modify = 0, del = 0;
    for (const r of rows) {
      const a = effectiveCorrectionAction(r as any);
      if (a === "add") add++;
      else if (a === "modify") modify++;
      else if (a === "delete") del++;
    }
    const total = add + modify + del;
    return total ? { add, modify, del, total } : null;
  }, [isCorrectionMode, selectedChallan, deductees, allChallanDeductees]);

  // ── Separate INTEREST challans ──────────────────────────────────────────
  // Genius records late-deposit interest as its OWN challan (no TDS, only an
  // Interest amount — e.g. BSR 0510002, Rs 215 on 21/10/2026), while the TDS
  // challan the late entries sit on carries no interest. The grid's live
  // 201(1A) figure for those entries was added to THEIR challan, so it showed
  // "Over-applied" by exactly the interest that was in fact paid on the other
  // challan — and the interest challan itself read as Unconsumed.
  //
  // Here an interest-only challan is recognised as such and its deposit is
  // matched against the interest the other challans' entries owe beyond what
  // those challans declare themselves (oldest deposit first). The matched part
  // is "paid via the interest challan": it is left out of the TDS challan's
  // Applied and counted as consumed on the interest challan. Interest owed
  // beyond all interest challans still counts against its own challan, so a
  // real shortfall is still flagged. With no interest-only challan in the
  // filing the plan is empty and nothing changes.
  const interestChallanPlan = useMemo(() => planInterestChallans(challans, (c) => {
    const raw = rowsCountedAgainst(c, c.id === selectedChallan?.id ? [...prevEntries, ...deductees] : (allChallanDeductees[c.id] || []));
    return isCorrectionMode ? raw.filter(d => (d as any).action !== "delete") : raw;
  }), [challans, selectedChallan, prevEntries, deductees, allChallanDeductees, isCorrectionMode]);

  /** The part of a TDS challan's own live interest that an interest-only
   *  challan has already paid — `liveInterest` is the challan's total auto
   *  interest, passed in so an edit's projected figure can be checked too. */
  const interestPaidViaIntChallan = (challanId: string, liveInterest: number, ownDeposited: number) =>
    Math.min(Math.max(0, liveInterest - ownDeposited), interestChallanPlan.avail.get(challanId) || 0);

  const getChallanBreakdownAll = useCallback((challanId: string) => {
    // Use ALL entries across all quarters for accurate balance (7A)
    const allForChallanRaw = challanId === selectedChallan?.id
      ? [...prevEntries, ...deductees]
      : (allChallanDeductees[challanId] || []);
    // A correction keeps deleted entries visible (struck through) so the user
    // can see what was removed — but a removed entry no longer consumes any of
    // the challan, so it must not count toward Applied / Unconsumed or the
    // deductee count. Without this the balances describe the OLD return.
    const allForChallanLive = isCorrectionMode
      ? allForChallanRaw.filter(d => (d as any).action !== "delete")
      : allForChallanRaw;
    const challanObj = challans.find(c => c.id === challanId)
      || (selectedChallan?.id === challanId ? selectedChallan : null)
      || carryForwardChallans.find(cf => cf.challan.id === challanId)?.challan
      || archivedChallans.find(ac => ac.id === challanId) || null;
    // Entries from a quarter BEFORE the challan's own were paid from that
    // earlier return's challans, not this one — kept on screen as read-only
    // history but left out of Applied (see countsAgainstChallan).
    const allForChallan = rowsCountedAgainst(challanObj as Challan | null, allForChallanLive);
    const earlierRows = allForChallanLive.filter(d => !countsAgainstChallan(challanObj as Challan | null, d));
    const earlierQuarter = {
      count: earlierRows.length,
      tds: earlierRows.reduce((s, d) => s + Math.round(d.total_tax_deducted || d.tds_amount || 0), 0),
    };
    // Each row's own interest_amount is only ever WRITTEN by the grid's
    // per-cell edit handler (see the "amount_paid_credited"/"date_of_payment"
    // branch above) — a row that arrived via Genius Excel import (or any path
    // that never touched that cell) can sit at interest_amount 0 forever,
    // while the grid's OWN Interest column (a read-only, always-live
    // calcAutoInterest tooltip, never sourced from this field — see its own
    // "read-only, auto-calculated" comment) shows the real, non-zero
    // statutory figure right next to it. Applied/Unconsumed must agree with
    // what the user is actually looking at, not with a column that can be
    // stale by design — so recompute interest the SAME way here instead of
    // trusting the persisted value. Confirmed against a real challan: two
    // Genius-imported deductees showed Interest ₹17 each on screen (₹34
    // total, matching the challan's own declared interest) while their
    // stored interest_amount was 0, so this challan reported "Unconsumed
    // Amount: ₹34" on money that was already fully accounted for.
    const depDate = (challanObj as Challan | null)?.deposit_date || null;
    const liveInterestRows = withChallanInterest(allForChallan as any[], depDate, tdsOfEntry);
    // Per-FORM bifurcation of a combined-payment (cross-form) challan — see
    // fetchCarryForwardChallans' own comment on why a challan is never
    // scoped to one form_type. Groups the SAME liveInterestRows by form_type
    // so each form's share uses the identical live-interest math and the
    // whole set always sums back to `applied` exactly (no separate/divergent
    // calculation to drift out of sync with it).
    const byFormMap = new Map<string, typeof liveInterestRows>();
    for (const r of liveInterestRows) {
      const k = r.form_type || "—";
      const g = byFormMap.get(k); if (g) g.push(r); else byFormMap.set(k, [r]);
    }
    const byForm = [...byFormMap.entries()]
      .map(([formType, rows]) => ({ formType, count: rows.length, ...computeApplied(rows) }))
      .sort((a, b) => a.formType.localeCompare(b.formType));
    // Cross-utilization (firm instruction, 2026-08-06): TDS, Interest, and
    // Late Fee are ONE pool measured against the challan's own undiminished
    // total_challan_amount — see computeChallanPooled's own doc for why this
    // replaced the prior "late_fees_234e is an untouchable slice" rule, which
    // produced false Over-Applied errors on challans genuinely within total.
    // `allocatable`/`overApplied`/`unconsumed` are now computed HERE, once,
    // instead of ~8 call sites below each re-deriving their own copy of
    // `total_challan_amount - late_fees_234e` (the exact duplication that let
    // one of them — the Genius Export guard — silently diverge).
    const pooled = computeChallanPooled((challanObj as Challan | null) || {}, allForChallan as any);
    // Interest that a SEPARATE interest challan paid (see interestChallanPlan):
    // left out of this TDS challan's Applied; on the interest challan itself
    // the matched amount counts as consumed.
    const ch = challanObj as Challan | null;
    const interestOnly = !!ch && isInterestOnlyChallan(ch);
    const viaIntChallan = ch && !interestOnly ? interestPaidViaIntChallan(challanId, pooled.interest, ch.interest_deposited || 0) : 0;
    const intChallanConsumed = interestOnly ? (interestChallanPlan.consumed.get(challanId) || 0) : 0;
    const interest = pooled.interest - viaIntChallan + intChallanConsumed;
    const effectiveApplied = pooled.effectiveApplied - viaIntChallan + intChallanConsumed;
    return {
      tds: pooled.tds, interest, surcharge: pooled.surcharge, lateFees: pooled.lateFees,
      applied: pooled.tds + interest + pooled.surcharge, kasarVatav: pooled.kasarVatav,
      effectiveApplied, allocatable: pooled.allocatable,
      overApplied: isChallanOverApplied(effectiveApplied, pooled.allocatable),
      unconsumed: Math.max(0, pooled.allocatable - effectiveApplied),
      count: allForChallan.length, byForm,
      interestOnly, viaIntChallan, earlierQuarter,
    };
  }, [selectedChallan, prevEntries, deductees, allChallanDeductees, challans, carryForwardChallans, archivedChallans, isCorrectionMode, interestChallanPlan]);

  // Keep getChallanBreakdown as alias for backward compat
  const getChallanBreakdown = getChallanBreakdownAll;

  // Each row's interest exactly as its challan card counts it: the challan's
  // interest rounded ONCE on its total and spread over its rows
  // (withChallanInterest), from the same row sets getChallanBreakdownAll uses.
  // The grid cells, summary bar and Auto-match read it here so a row can never
  // show a figure the card doesn't add up to.
  const interestByRowId = useMemo(() => {
    const m = new Map<string, number>();
    const depOf = new Map<string, string | null>();
    for (const c of [...archivedChallans, ...carryForwardChallans.map(cf => cf.challan), ...challans]) depOf.set(c.id, c.deposit_date || null);
    if (selectedChallan) depOf.set(selectedChallan.id, selectedChallan.deposit_date || null);
    const groups = new Map<string, Deductee[]>(Object.entries(allChallanDeductees));
    if (selectedChallan) groups.set(selectedChallan.id, [...prevEntries, ...deductees]);
    for (const [challanId, raw] of groups) {
      const rows = isCorrectionMode ? raw.filter(d => (d as any).action !== "delete") : raw;
      for (const r of withChallanInterest(rows, depOf.get(challanId) ?? null, tdsOfEntry)) {
        if (r.id) m.set(r.id, r.interest_amount);
      }
    }
    return m;
  }, [selectedChallan, prevEntries, deductees, allChallanDeductees, challans, carryForwardChallans, archivedChallans, isCorrectionMode]);
  const rowInterest = useCallback((d: Deductee, depDate: string | null) =>
    interestByRowId.get(d.id) ?? calcAutoInterest(tdsOfEntry(d), d.date_of_payment ?? null, depDate).interest,
  [interestByRowId]);

  const challanDeducteeTds = useMemo(() => {
    if (!selectedChallan) return 0;
    // effectiveApplied (TDS+interest+surcharge, PLUS any Kasar-Vatav
    // write-off) — this drives the Applied/Unconsumed/Fully-Utilised status
    // shown on the detail bar below, so a challan closed via Kasar-Vatav
    // reads as Fully Utilised without a matching deductee entry.
    return getChallanBreakdownAll(selectedChallan.id).effectiveApplied;
  }, [deductees, prevEntries, selectedChallan, allChallanDeductees, getChallanBreakdownAll]);

  const summaryStats = useMemo(() => {
    const allCurrentDeds = deductees; // current quarter only for summary
    const totalChallans = challans.length;
    const totalDeductees = allCurrentDeds.length;
    const totalPayment = allCurrentDeds.reduce((s, d) => s + (d.amount_paid_credited || 0), 0);
    const totalTds = allCurrentDeds.reduce((s, d) => s + Math.round(d.total_tax_deducted || d.tds_amount || 0), 0);
    // Interest recomputed live — same fix, same rationale, as
    // getChallanBreakdownAll/fetchCarryForwardChallans/autoMatchChallans
    // above: a row's stored interest_amount can be stale-zero (bulk import,
    // never hand-edited) while the grid's own read-only Interest cell
    // already shows the real figure for that same row.
    const depDateByChallan = new Map(challans.map(c => [c.id, c.deposit_date]));
    const totalInterest = allCurrentDeds.reduce((s, d) =>
      s + rowInterest(d, depDateByChallan.get(d.challan_id) ?? null), 0);
    const totalLateFees = allCurrentDeds.reduce((s, d) => s + (d.late_fees_amount || 0), 0);
    return { totalChallans, totalDeductees, totalPayment, totalTds, totalInterest, totalLateFees };
  }, [challans, deductees, rowInterest]);

  // Excel-style AutoFit for the Name/PAN columns — width follows the widest
  // value currently on screen instead of a fixed guess, so short names don't
  // waste space and long ones aren't clipped. Measured against hidden spans
  // (nameMeasureRef/panMeasureRef below), with font copied live from a real
  // [data-autofit] Input rather than guessed via Tailwind classes — the shared
  // Input component's base "md:text-sm" (14px) outranks our own "text-xs"
  // (12px) in the CSS cascade at desktop widths, so assuming text-xs silently
  // under-measures every value.
  const nameMeasureRef = useRef<HTMLSpanElement>(null);
  const panMeasureRef = useRef<HTMLSpanElement>(null);
  // Floors sized off KNOWN worst cases rather than the shortest plausible
  // measurement: PAN is always exactly 10 fixed-format characters
  // (AAAAA9999A) in a monospace font, so it never needs to go below what
  // that takes to render in full; Name's floor is a comfortable ~12
  // characters so a transient under-measurement (e.g. the very first paint,
  // before real rows have loaded) never clips a real value down to a sliver
  // — long names still grow past this via the measurement below.
  const NAME_COL_MIN = 180;
  const PAN_COL_MIN = 150;
  const [nameColWidth, setNameColWidth] = useState(220);
  const [panColWidth, setPanColWidth] = useState(PAN_COL_MIN);

  useLayoutEffect(() => {
    const nameEl = nameMeasureRef.current;
    const panEl = panMeasureRef.current;
    if (!nameEl || !panEl) return;
    const rows = [...prevEntries, ...deductees];
    // Nothing real to measure yet (e.g. mounted before the fetch resolves) —
    // leave the width where it is instead of collapsing to the header-only
    // measurement, which would otherwise flash the columns down to a sliver
    // right before the real data arrives and grows them back.
    if (rows.length === 0) return;
    // Copy font sub-properties individually rather than the `font` shorthand —
    // getComputedStyle().font can come back as an empty string when not every
    // shorthand sub-value is explicitly resolvable, which would silently no-op
    // the assignment and leave the span on its own (smaller) text-xs class,
    // under-measuring every value exactly like the bug this was meant to fix.
    const copyFont = (el: HTMLSpanElement, src: Element) => {
      const cs = getComputedStyle(src);
      el.style.fontSize = cs.fontSize;
      el.style.fontFamily = cs.fontFamily;
      el.style.fontWeight = cs.fontWeight;
      el.style.fontStyle = cs.fontStyle;
      el.style.letterSpacing = cs.letterSpacing;
    };
    const sampleNameInput = document.querySelector('[data-autofit="name"]');
    const samplePanInput = document.querySelector('[data-autofit="pan"]');
    if (sampleNameInput) copyFont(nameEl, sampleNameInput);
    if (samplePanInput) copyFont(panEl, samplePanInput);
    const nameHeaderLabel = selForm === "24Q" ? "Employee Name" : selForm === "27EQ" ? "Collectee" : "Name";
    // TableCell padding (16px × 2) + Input's own padding (12px × 2) + border (1px × 2) + slack
    const CELL_PADDING = 84;

    let maxName = 0;
    for (const text of [nameHeaderLabel, ...rows.map(d => d.deductee_name || "")]) {
      nameEl.textContent = text;
      maxName = Math.max(maxName, nameEl.getBoundingClientRect().width);
    }
    let maxPan = 0;
    for (const text of ["PAN", ...rows.map(d => d.deductee_pan || "")]) {
      panEl.textContent = text;
      maxPan = Math.max(maxPan, panEl.getBoundingClientRect().width);
    }

    setNameColWidth(Math.max(NAME_COL_MIN, Math.min(640, Math.ceil(maxName) + CELL_PADDING)));
    setPanColWidth(Math.max(PAN_COL_MIN, Math.min(220, Math.ceil(maxPan) + CELL_PADDING)));
  }, [deductees, prevEntries, selForm]);

  const autoMatchChallans = () => {
    if (isFilingLocked) return;
    const challanTotMap = new Map<string, number>();
    const challanForMatch = new Map(challans.map(c => [c.id, c]));
    deductees.forEach(d => {
      if (!countsAgainstChallan(challanForMatch.get(d.challan_id), d)) return;
      // Interest recomputed live — same fix, same rationale, as
      // getChallanBreakdownAll/fetchCarryForwardChallans above: a row's
      // stored interest_amount can be stale-zero (bulk import, never
      // hand-edited) while the real figure is what the grid's own Interest
      // cell already shows. Trusting the stale value here reported a
      // correctly-matched challan as "unmatched" in the Auto-match toast.
      const depDate = challanForMatch.get(d.challan_id)?.deposit_date || null;
      const liveInterest = rowInterest(d, depDate);
      const rowTotal = Math.round(d.total_tax_deducted || d.tds_amount || 0) + liveInterest + (d.late_fees_amount || 0) + (d.surcharge_amount || 0);
      challanTotMap.set(d.challan_id, (challanTotMap.get(d.challan_id) || 0) + rowTotal);
    });
    const matched: string[] = [], unmatched: string[] = [];
    challans.forEach(c => {
      // Interest paid via a separate interest challan moves from the TDS
      // challan's side to the interest challan's (see interestChallanPlan).
      const entered = (challanTotMap.get(c.id) || 0)
        - getChallanBreakdownAll(c.id).viaIntChallan + (interestChallanPlan.consumed.get(c.id) || 0);
      if (Math.abs(entered - c.total_challan_amount) <= 1) matched.push(c.bsr_code || c.id.slice(0, 8));
      else unmatched.push(c.bsr_code || c.id.slice(0, 8));
    });
    toast({ title: "Challan Match", description: `✅ ${matched.length} matched | ❌ ${unmatched.length} unmatched` });
  };

  const [autoSaveBadge, setAutoSaveBadge] = useState(false);
  useEffect(() => {
    if (!filing || deductees.length === 0) return;
    autoSaveRef.current = setInterval(() => {
      setAutoSaveBadge(true);
      setTimeout(() => setAutoSaveBadge(false), 2000);
    }, 30000);
    return () => { if (autoSaveRef.current) clearInterval(autoSaveRef.current); };
  }, [filing, deductees.length]);

  const duplicateDeductee = async (sourceDeductee: Deductee) => {
    if (!selectedChallan || !filing || isFilingLocked) return;
    const firmId = await resolveFirmId();
    const { id, ...rest } = sourceDeductee;
    const { data, error } = await supabase.from(SRC.deductees as any).insert({
      ...rest,
      firm_id: firmId || filing.firm_id,
    } as any).select("*").single();
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    setDeductees(prev => [...prev, data as unknown as Deductee]);
    toast({ title: "Row duplicated" });
    await bumpUnderProcess();
    onCorrectionChanged?.();
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "d") {
        e.preventDefault();
        if (deductees.length > 0 && !isFilingLocked) duplicateDeductee(deductees[deductees.length - 1]);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [deductees, selectedChallan, filing]);

  const getBalanceColor = (challan: Challan) => {
    const bd = getChallanBreakdownAll(challan.id);
    return balanceColorClass(bd.effectiveApplied, bd.allocatable);
  };

  const client = clients.find(c => c.id === selClient);
  // A filed return is read-only; so is a correction the caller marks locked
  // (filed corrections are immutable in the DB too, so offering an edit here
  // would only produce an error the user cannot act on).
  //
  // "Ready to File" locks too, and must: the checker has digitally signed
  // THIS office data, and Validate & Finalise is frozen at that status — so
  // leaving the challan/deductee grid editable here would let the numbers
  // Stage 1 reconciled drift out from under a signature that still attests to
  // them, with no way to re-run validation. (Before "Ready to File" existed,
  // finalising wrote "Filed", so this lock is what used to engage.) Nothing
  // invalidates tds_recon_results on an edit, so the freeze is the control.
  // "Processed with/without Default" is included for the same reason — it is
  // strictly past Filed. Escape hatch: Revoke Signature sends the return back
  // to Reviewed.
  const LOCKED_WORK_STATUSES = ["Filed", "Ready to File"];
  const isFilingLocked = forceReadOnly || LOCKED_WORK_STATUSES.includes(filing?.work_status ?? "") || isProcessedWorkStatus(filing?.work_status);

  // Issue 1: Row-level read-only check
  const isRowReadOnly = (d: Deductee) => isFilingLocked || (filing ? d.filing_id !== filing.id : false);

  // A plain code (no "(a)"/"(b)" suffix, e.g. "194C") is superseded once the
  // Section 393 reform has ALSO seeded its own bifurcated siblings in this
  // exact rate master set (e.g. "194C(a)"/"194C(b)"). The plain row stays
  // is_active=true in the DB deliberately — deactivating it broke the Section
  // dropdown for every EXISTING entry already saved against it, rendering
  // blank instead of the real value (see migration
  // 20260730170000_tds_reactivate_bifurcated_base_codes.sql) — so it can't be
  // filtered out at the data layer. Excluded from the OFFERED list here
  // instead: a brand new entry should always pick the more precise (a)/(b)
  // variant, and this is purely a display-layer filter, so it doesn't risk
  // that same regression. sectionOptionsFor (below) still surfaces the plain
  // code for a row whose OWN stored value already is one, so nothing renders
  // blank.
  const sectionOptions = useMemo(() => {
    return rateMaster
      .filter(r => !isSupersededSectionCode(r.section_code, rateMaster))
      .map(r => ({ value: r.section_code, label: sectionDropdownLabel(r) }));
  }, [rateMaster]);

  /** sectionOptions with the CURRENT value spliced back in if it's a
   *  superseded plain code sectionOptions itself excludes — e.g. a deductee
   *  row already saved as "194C" keeps showing "194C — Contractor /
   *  Sub-contractor" as its selected value, but that option is never OFFERED
   *  when adding a new row or changing a different one. When deducteeType is
   *  passed (the deductee-row Select, not the challan-level default-section
   *  one — a challan isn't tied to one deductee's type), 194C(a)/194C(b)
   *  come back with `disabled` set on whichever side doesn't apply, so the
   *  user physically cannot pick the wrong sub-section. */
  const sectionOptionsFor = (currentCode: string | null | undefined, deducteeType?: string | null) => {
    const base = (!currentCode || sectionOptions.some(o => o.value === currentCode))
      ? sectionOptions
      : (() => {
          const match = rateMaster.find(r => r.section_code === currentCode);
          return match ? [{ value: match.section_code, label: sectionDropdownLabel(match) }, ...sectionOptions] : sectionOptions;
        })();
    if (deducteeType === undefined) return base.map(o => ({ ...o, disabled: false }));
    return base.map(o => ({
      ...o,
      disabled: (o.value === "194C(a)" && is194CaDisabledFor(deducteeType))
        || (o.value === "194C(b)" && is194CbDisabledFor(deducteeType)),
    }));
  };

  // Quarter-wise usage breakdown helper (Issue 7B)
  const getQuarterWiseUsage = (challanId: string) => {
    const allDeds = allChallanDeductees[challanId] || (challanId === selectedChallan?.id ? [...prevEntries, ...deductees] : []);
    const byFiling: Record<string, { tds: number; filingId: string }> = {};
    allDeds.forEach(d => {
      if (!byFiling[d.filing_id]) byFiling[d.filing_id] = { tds: 0, filingId: d.filing_id };
      byFiling[d.filing_id].tds += Math.round(d.total_tax_deducted || d.tds_amount || 0);
    });
    return Object.values(byFiling);
  };

  // Challan balance for selected challan (Issue 7F) — pooled across TDS,
  // Interest, and Late Fee (see computeChallanPooled's own doc).
  const selectedChallanBalance = useMemo(() => {
    if (!selectedChallan) return 0;
    return getChallanBreakdownAll(selectedChallan.id).unconsumed;
  }, [selectedChallan, getChallanBreakdownAll]);

  // ─── CP-05: Generate Genius Excel ────────────────────────────────────────
  const handleGeniusExport = async () => {
    if (!filing || !client) return;

    // Validation — per CP-05 Step 4
    const tan = client.tan_number || filing.tan;
    if (!tan) {
      toast({ title: "TAN is required.", description: "Update the client's TAN before exporting.", variant: "destructive" });
      return;
    }
    if (challans.length === 0) {
      toast({ title: "No challans found.", description: "Add at least one challan before exporting.", variant: "destructive" });
      return;
    }
    const allDeductees = Object.values(allChallanDeductees).flat();
    if (allDeductees.length === 0) {
      toast({ title: "No deductee entries found.", description: "Add at least one deductee entry before exporting.", variant: "destructive" });
      return;
    }
    const invalidPans = allDeductees.filter(d => d.deductee_pan && !isValidPan(d.deductee_pan));
    if (invalidPans.length > 0) {
      toast({ title: `Invalid PAN in ${invalidPans.length} entry(s).`, description: `Fix PAN format before exporting. First invalid: ${invalidPans[0].deductee_name}`, variant: "destructive" });
      return;
    }
    const invalidAmts = allDeductees.filter(
      d => (d.tds_amount !== null && (d.tds_amount ?? 0) < 0) ||
           (d.amount_paid_credited !== null && (d.amount_paid_credited ?? 0) < 0)
    );
    if (invalidAmts.length > 0) {
      toast({ title: "Negative amounts found.", description: "All TDS amounts must be non-negative.", variant: "destructive" });
      return;
    }

    setExportLoading(true);
    try {
      await generateGeniusExport(selForm, filing, client, challans, allDeductees);
      toast({ title: "Genius Excel generated successfully! File saved." });
      // Audit trail — pure "this happened" event, no natural old/new value.
      // Placed AFTER the export genuinely succeeds (not in the catch/finally)
      // so a cancelled save dialog (AbortError, below) is never logged as an export.
      logReconAudit({
        filingId: filing.id, firmId: filing.firm_id,
        userId: user?.id, userName: currentUserName,
        actionType: "GENIUS_EXPORT_RUN",
        remark: `Exported Genius Excel for ${selForm} ${selQuarter} FY ${selFy} — ${challans.length} challan(s), ${allDeductees.length} deductee(s)`,
      });
    } catch (err: any) {
      // User cancelled the save dialog — not an error
      if (err?.name === "AbortError") return;
      toast({ title: "Export failed", description: err.message, variant: "destructive" });
    } finally {
      setExportLoading(false);
    }
  };

  // ─── Genius Import — reads a Genius-format .xls and populates challans + deductees ───
  const handleGeniusImportClick = () => {
    if (!filing || !client) {
      toast({ title: "Select a filing first", description: "Pick Client / FY / Quarter / Form before importing.", variant: "destructive" });
      return;
    }
    // A bulk import inserts new challans/deductees straight into the return —
    // exactly the kind of change the Ready to File/Filed freeze exists to
    // block, so it needs the same permission-request flow as every other
    // change, not a bypass via a file picker.
    if (isFilingLocked) {
      toast({ title: "This return is locked", description: "Data Entry is frozen once a return is Ready to File or Filed — request edit access to import.", variant: "destructive" });
      return;
    }
    importFileInputRef.current?.click();
  };

  const handleGeniusImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Reset so picking the same file again still triggers onChange
    if (importFileInputRef.current) importFileInputRef.current.value = "";
    if (!file) return;
    if (isFilingLocked) return;
    if (!filing || !client) {
      toast({ title: "Select a filing first", variant: "destructive" });
      return;
    }

    setImportLoading(true);
    try {
      const firmId = await resolveFirmId();
      const result = await importGeniusXls(
        file,
        filing,
        client,
        selForm,
        selFy,
        selQuarter,
        firmId || filing.firm_id || null,
      );
      // Refresh the UI with newly inserted data.
      // refreshChallansAndCF re-runs both fetchChallans AND
      // fetchCarryForwardChallans — the latter is essential because the
      // import may have attached deductees to prior-quarter carry-forward
      // challans, so their "Used / Available" amounts need to be recomputed.
      await fetchRates();
      await refreshChallansAndCF(filing.id);
      const warningText = result.warnings.length
        ? ` (${result.warnings.length} warning${result.warnings.length > 1 ? "s" : ""} — see console)`
        : "";
      if (result.warnings.length) console.warn("[GeniusImport] Warnings:", result.warnings);
      const reusedText = (result.challansReused ?? 0) > 0
        ? `, re-used ${result.challansReused} carry-forward challan(s)`
        : "";
      toast({
        title: "Genius file imported successfully",
        description: `Added ${result.challansInserted} challan(s)${reusedText} and ${result.deducteesInserted} deductee(s)${warningText}`,
      });

      // Audit trail — one entry summarizing the import itself...
      logReconAudit({
        filingId: filing.id, firmId: firmId || filing.firm_id,
        userId: user?.id, userName: currentUserName,
        actionType: "GENIUS_IMPORT_RUN",
        newValue: `${result.deducteesInserted} deductee(s), ${result.challansInserted} new challan(s)${(result.challansReused ?? 0) > 0 ? `, ${result.challansReused} reused` : ""}`,
        remark: `Imported Genius file "${file.name}" for ${selForm} ${selQuarter} FY ${selFy}`,
      });
      // ...and one per PRE-EXISTING challan newly associated with this filing
      // via the combined-payment / cross-form-and-quarter reuse feature — the
      // whole point of that feature is that a challan's balance is shared
      // FROM another form/quarter, so name it explicitly here.
      for (const r of result.reused) {
        logReconAudit({
          filingId: filing.id, firmId: firmId || filing.firm_id,
          userId: user?.id, userName: currentUserName,
          actionType: "CHALLAN_CROSS_FORM_LINK",
          newValue: `Challan ${r.challanNumber}`,
          remark: `Challan ${r.challanNumber} shared from ${r.fromForm} ${r.fromQuarter} FY ${r.fromFy} — now also linked to ${selForm} ${selQuarter} FY ${selFy}`,
        });
      }

      await bumpUnderProcess();
      onCorrectionChanged?.();
    } catch (err: any) {
      console.error("[GeniusImport] Failed:", err);
      const msg = err?.message || String(err);
      // A per-row validation rejection (see importGeniusXls's Company/Section
      // check) is a newline-joined list — the toast's default whitespace
      // handling collapses \n, so render each line separately instead of
      // letting a multi-row rejection run together as one unreadable block.
      const lines = msg.split("\n").filter(Boolean);
      toast({
        title: "Import failed",
        description: lines.length > 1
          ? <div className="space-y-0.5">{lines.map((l: string, i: number) => <p key={i}>{l}</p>)}</div>
          : msg,
        variant: "destructive",
      });
    } finally {
      setImportLoading(false);
    }
  };

  // ─── Render ───
  return (
    <div className="space-y-4">
      {/* ── CP-03: Filing Selector — hidden in correction mode, where the
          period is fixed by the correction being edited ── */}
      {!isCorrectionMode && (
      <div className="rounded-lg bg-foreground/5 border p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground">Select Filing</h3>
          {loading && (
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 size={13} className="animate-spin" /> Loading…
            </span>
          )}
        </div>

        {/* 4 dropdowns — always editable, never disabled */}
        <div className="flex flex-wrap gap-3 items-end">
          <div className="space-y-1">
            <Label className="text-xs">Client</Label>
            {/* Popover + type-to-filter list: the old search box sat inside a
                Radix Select, which pulls focus onto the items as you type or
                move the mouse, so typing a name rarely narrowed anything. */}
            <SearchableSelect
              className="w-[220px] h-10"
              value={selClient}
              onValueChange={setSelClient}
              placeholder="Select client"
              searchPlaceholder="Search client…"
              emptyText="No clients found"
              options={clients
                .filter(c => clientHasTdsForm(c.tds_forms_applicable, selForm))
                .map(c => ({ value: c.id, label: c.name || "—" }))}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">FY</Label>
            <Select value={selFy} onValueChange={setSelFy}>
              <SelectTrigger className="w-[120px]"><SelectValue /></SelectTrigger>
              <SelectContent>{FY_OPTIONS.map(fy => <SelectItem key={fy} value={fy}>{fy}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Quarter</Label>
            <Select value={selQuarter} onValueChange={setSelQuarter}>
              <SelectTrigger className="w-[90px]"><SelectValue /></SelectTrigger>
              <SelectContent>{QUARTER_OPTIONS.map(q => <SelectItem key={q} value={q}>{q}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Form</Label>
            <Select value={selForm} onValueChange={setSelForm}>
              <SelectTrigger className="w-[100px]"><SelectValue /></SelectTrigger>
              <SelectContent>{TDS_FORMS.map(f => <SelectItem key={f} value={f}>{f}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>

        {/* Filing info row — shown once auto-load completes */}
        {filingLoaded && !loading && (
          filing ? (
            <div className="flex flex-wrap items-center gap-4 pt-2 border-t">
              <div className="space-y-0.5">
                <p className="text-xs text-muted-foreground">Client</p>
                <p className="text-sm font-semibold">{client?.name || "—"}</p>
              </div>
              <div className="space-y-0.5">
                <p className="text-xs text-muted-foreground">TAN</p>
                <p className="text-sm font-mono">{client?.tan_number || filing.tan || "—"}</p>
              </div>
              <div className="space-y-0.5">
                <p className="text-xs text-muted-foreground">Form / Quarter</p>
                <p className="text-sm font-semibold">{selForm} · {selQuarter} FY {selFy}</p>
              </div>
              <Badge className={cn("text-xs", {
                "bg-muted text-muted-foreground": filing.work_status === "Not Started",
                "bg-blue-100 text-blue-700": filing.work_status === "Data Received",
                "bg-indigo-100 text-indigo-700": filing.work_status === "Under Process",
                "bg-violet-100 text-violet-700": filing.work_status === "Reviewed",
                "bg-teal-100 text-teal-700": filing.work_status === "NIL",
                // Sky, never emerald — "Ready to File" must not read as filed.
                "bg-sky-100 text-sky-700": filing.work_status === "Ready to File",
                "bg-emerald-100 text-emerald-700": filing.work_status === "Filed",
                "bg-emerald-200 text-emerald-800": isProcessedWorkStatus(filing.work_status),
              })}>{filing.work_status}</Badge>
              {isFilingLocked && (
                <Badge className="text-xs bg-amber-100 text-amber-800 border border-amber-300 gap-1">
                  {/* Name the ACTUAL reason — the lock now also engages at
                      Ready to File / Processed, so a hardcoded "Filed" would
                      tell the user something the status badge beside it
                      contradicts. */}
                  <Lock size={10} /> Data Entry Locked — {lockBadgeLabel ?? filing.work_status}
                </Badge>
              )}
              {/* Import Genius Excel — parses a Genius-format .xls and pre-fills challans + deductees */}
              <input
                ref={importFileInputRef}
                type="file"
                accept=".xls,.xlsx,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                className="hidden"
                onChange={handleGeniusImportFile}
              />
              <Button
                size="sm"
                variant="outline"
                className="ml-auto gap-1.5"
                disabled={importLoading || exportLoading || isFilingLocked}
                title={isFilingLocked ? "Locked — request edit access to import" : undefined}
                onClick={handleGeniusImportClick}
              >
                {importLoading
                  ? <Loader2 size={14} className="animate-spin" />
                  : <Upload size={14} />}
                Import Genius Excel
              </Button>

              {/* CP-05: Generate Genius Excel */}
              <Button
                size="sm"
                className="gap-1.5"
                style={{ backgroundColor: "#1A2744", color: "#C9A84C" }}
                disabled={exportLoading || importLoading}
                onClick={handleGeniusExport}
              >
                {exportLoading
                  ? <Loader2 size={14} className="animate-spin" />
                  : <FileSpreadsheet size={14} />}
                Generate Genius Excel
              </Button>
            </div>
          ) : (
            <div className="pt-2 border-t">
              <p className="text-sm text-muted-foreground">No filing found for this combination.</p>
              <p className="text-xs text-muted-foreground mt-0.5">Activate TDS in Client Module first.</p>
            </div>
          )
        )}

        {/* Prompt when client not yet selected */}
        {!selClient && (
          <p className="text-xs text-muted-foreground pt-1">Select a client to auto-load the filing.</p>
        )}
      </div>
      )}

      {filing && (
        <>
          {/* Issue 1: Prominent lock banner */}
          {isFilingLocked && (
            <div className="flex items-center gap-3 px-4 py-3 rounded-lg bg-amber-50 border-2 border-amber-300 text-amber-900 text-sm font-medium">
              <Lock size={16} className="shrink-0" />
              <span>{lockNotice ?? <>
                This return is <strong>{lockBadgeLabel ?? "Filed"}</strong> — challans and data entries are frozen and read-only,
                permanently, including once it's Filed. To make a change, request edit access from the <strong>Validate &amp; Finalise</strong> tab;
                a Firm Admin or Super Admin must approve it before anything here can change again.
              </>}</span>
            </div>
          )}

          <div className="space-y-3">
            {/* Challan strip — horizontal, single row (was a 30%-width vertical sidebar) */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                {isCorrectionMode ? (
                  <button
                    type="button"
                    onClick={() => setChallansExpanded(v => !v)}
                    aria-expanded={challansExpanded}
                    className="flex items-center gap-1.5 text-left"
                  >
                    {challansExpanded ? <ChevronDown size={14} className="text-muted-foreground" /> : <ChevronRight size={14} className="text-muted-foreground" />}
                    <h3 className="text-sm font-semibold text-foreground">Challans</h3>
                    {/* Only once loaded — otherwise this flashes "0 challans" for
                        the instant between the correction opening and its own
                        challans finishing their fetch, which reads as data loss. */}
                    {!challansExpanded && filingLoaded && (
                      <span className="text-xs text-muted-foreground">
                        {challans.length} challan{challans.length === 1 ? "" : "s"}
                      </span>
                    )}
                  </button>
                ) : (
                  <h3 className="text-sm font-semibold text-foreground">Challans</h3>
                )}
                {challansExpanded && (
                  <div className="flex items-center gap-2">
                    {/* Archiving is a live-data concept (is_archived only exists
                        on tds_challans) — a correction is a fixed snapshot, so
                        this does not apply to it. */}
                    {!isCorrectionMode && (
                      <Button
                        size="sm"
                        variant={showArchivedChallans ? "secondary" : "ghost"}
                        className="gap-1 h-7 text-xs text-muted-foreground"
                        onClick={() => {
                          const next = !showArchivedChallans;
                          setShowArchivedChallans(next);
                          if (next && selClient) void fetchArchivedChallans(selClient);
                        }}>
                        <Archive size={12} /> {showArchivedChallans ? "Hide" : "Show"} Archived Challans
                        {archivedChallans.length > 0 && (
                          <Badge variant="secondary" className="text-[9px] px-1 ml-0.5">{archivedChallans.length}</Badge>
                        )}
                      </Button>
                    )}
                    {/* Issue 2: Hide Add Challan when filed */}
                    {!isFilingLocked && (
                      <Button size="sm" variant="outline" className="gap-1 h-7 text-xs" onClick={openAddChallan}>
                        <Plus size={12} /> Add Challan
                      </Button>
                    )}
                  </div>
                )}
              </div>

              {/* Archived Challans — a visually distinct panel (tinted background,
                  dashed border) so it never reads as part of the active challan
                  strip above/below it. Its own search box scopes to just this
                  client's archive, independent of anything filtering the active
                  list, since an archive can span many quarters at once. */}
              {challansExpanded && showArchivedChallans && (
                <div className="rounded-lg border border-dashed border-muted-foreground/30 bg-muted/20 p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-1.5">
                      <Archive size={13} className="text-muted-foreground shrink-0" />
                      <p className="text-xs font-semibold text-foreground">Archived Challans</p>
                      <Badge variant="secondary" className="text-[9px] px-1.5">{archivedChallans.length}</Badge>
                      <span className="text-[10px] text-muted-foreground hidden sm:inline">· this client, any period</span>
                    </div>
                    {archivedChallans.length > 0 && (
                      <div className="relative">
                        <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                        <Input
                          placeholder="Search BSR, challan no, period..."
                          className="h-7 w-56 pl-6 pr-6 text-[11px]"
                          value={archivedSearch}
                          onChange={e => setArchivedSearch(e.target.value)}
                        />
                        {archivedSearch && (
                          <button
                            type="button"
                            className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                            onClick={() => setArchivedSearch("")}
                            title="Clear search"
                          >
                            <X size={11} />
                          </button>
                        )}
                      </div>
                    )}
                  </div>

                  {archivedChallans.length === 0 ? (
                    <p className="text-xs text-muted-foreground py-4 text-center">
                      No archived challans for this client — challans you archive will show up here, still fully restorable.
                    </p>
                  ) : filteredArchivedChallans.length === 0 ? (
                    <p className="text-xs text-muted-foreground py-4 text-center">
                      No archived challans match "{archivedSearch}".
                    </p>
                  ) : (
                    <div className="flex gap-2 overflow-x-auto pb-1">
                      {filteredArchivedChallans.map(ac => {
                        // Full status breakdown — same engine, same fields as
                        // the active/carry-forward cards, so an archived
                        // challan's history and balance are just as reviewable
                        // as before it was put away.
                        const bd = getChallanBreakdownAll(ac.id);
                        const pendingBalance = bd.unconsumed;
                        const overApplied = bd.overApplied;
                        const fullyUtilised = isChallanFullyUtilised(bd.effectiveApplied, bd.allocatable);
                        const statusLabel = overApplied ? "Over-applied" : fullyUtilised ? "Fully Utilised" : bd.effectiveApplied > 0 ? "Partially Utilised" : "Unutilised";
                        const statusClass = overApplied ? "bg-red-100 text-red-700" : fullyUtilised ? "bg-emerald-100 text-emerald-700"
                          : bd.effectiveApplied > 0 ? "bg-amber-100 text-amber-700" : "bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-300";
                        const lateFeeBalance = (ac.late_fees_234e || 0) - (ac.late_fees_used || 0);
                        return (
                        <TooltipProvider key={ac.id}>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Card
                                className={cn(
                                  "cursor-pointer transition-all hover:shadow-sm hover:border-muted-foreground/50 flex-shrink-0 w-64 bg-background/60 border-dashed",
                                  selectedChallan?.id === ac.id ? "border-primary ring-1 ring-primary/30" : "",
                                )}
                                onClick={() => selectChallan(ac)}>
                                <CardContent className="p-2.5 space-y-1.5">
                                  <div className="flex items-start justify-between gap-1">
                                    <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                                      <CreditCard size={12} className="text-muted-foreground shrink-0" />
                                      <span className="text-xs font-semibold font-mono truncate text-muted-foreground">{ac.bsr_code || "No BSR"}</span>
                                      {ac.section_code && <Badge variant="outline" className="text-[9px] px-1">{ac.section_code}</Badge>}
                                    </div>
                                    {/* Restoring re-enters the active list of the currently open
                                        filing — blocked once that filing is Ready to File/Filed,
                                        same as every other change here (see isFilingLocked). */}
                                    {!isFilingLocked && (
                                      <Button variant="ghost" size="icon" className="h-5 w-5 shrink-0" title="Restore to active challans"
                                        disabled={archivingId === ac.id}
                                        onClick={e => { e.stopPropagation(); void unarchiveChallan(ac); }}>
                                        {archivingId === ac.id ? <Loader2 size={10} className="animate-spin" /> : <ArchiveRestore size={10} />}
                                      </Button>
                                    )}
                                  </div>
                                  <p className="text-[10px] text-muted-foreground truncate">
                                    {ac.deposit_date ? format(new Date(ac.deposit_date), "dd MMM yyyy") : "No date"}
                                    {ac.challan_serial_no && ` • No: ${ac.challan_serial_no}`}
                                  </p>
                                  <p className="text-[10px] text-muted-foreground truncate">{ac.form_type} {ac.quarter} FY {ac.financial_year}</p>

                                  {/* Status + progress — identical language/visuals to the active cards */}
                                  <div className={cn("flex items-center justify-between text-[10px] font-semibold pt-1 border-t border-border/50",
                                    overApplied ? "text-destructive" : fullyUtilised ? "text-emerald-600" : bd.effectiveApplied > 0 ? "text-amber-600" : "text-muted-foreground")}>
                                    <span>{statusLabel}</span>
                                    <span>₹{bd.effectiveApplied.toLocaleString("en-IN")}/₹{(ac.total_challan_amount || 0).toLocaleString("en-IN")}</span>
                                  </div>
                                  <div className="w-full h-1.5 rounded-full bg-muted overflow-hidden">
                                    <div className={cn("h-full rounded-full transition-all", balanceColorClass(bd.effectiveApplied, ac.total_challan_amount || 0))}
                                      style={{ width: ac.total_challan_amount > 0 ? `${Math.min(100, (bd.effectiveApplied / ac.total_challan_amount) * 100)}%` : "0%" }} />
                                  </div>

                                  {/* Tax / Interest utilised split */}
                                  <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-[9px] text-muted-foreground">
                                    <span>Tax Utilised</span><span className="text-right font-medium text-foreground">₹{bd.tds.toLocaleString("en-IN")}</span>
                                    {bd.interest > 0 && (<><span>Interest Utilised</span><span className="text-right font-medium text-foreground">₹{bd.interest.toLocaleString("en-IN")}</span></>)}
                                    {bd.surcharge > 0 && (<><span>Surcharge</span><span className="text-right font-medium text-foreground">₹{bd.surcharge.toLocaleString("en-IN")}</span></>)}
                                    <span>Unutilised / Pending</span><span className="text-right font-medium text-foreground">₹{pendingBalance.toLocaleString("en-IN")}</span>
                                    <span>Carry Forward Amount</span><span className="text-right font-medium text-foreground">₹{pendingBalance.toLocaleString("en-IN")}</span>
                                  </div>

                                  {(ac.late_fees_234e || 0) > 0 && (
                                    <div className="flex items-center justify-between gap-1 text-[9px] pt-1 border-t border-border/30 text-muted-foreground">
                                      <span>LF ₹{(ac.late_fees_234e || 0).toLocaleString("en-IN")} used</span>
                                      <span>₹{(ac.late_fees_used || 0).toLocaleString("en-IN")} (bal ₹{lateFeeBalance.toLocaleString("en-IN")})</span>
                                    </div>
                                  )}
                                  {bd.kasarVatav > 0 && (
                                    <div className="flex items-center justify-between gap-1 text-[9px] pt-1 border-t border-border/30">
                                      <span className="text-muted-foreground">Kasar-Vatav adjusted</span>
                                      <span className="font-medium">₹{bd.kasarVatav.toLocaleString("en-IN")}</span>
                                    </div>
                                  )}

                                  <div className="flex items-center justify-between gap-1 pt-0.5">
                                    <Badge variant="secondary" className={cn("text-[9px] gap-1", statusClass)}>
                                      <Archive size={8} /> Archived
                                    </Badge>
                                    {ac.archived_at && (
                                      <span className="text-[9px] text-muted-foreground">{format(new Date(ac.archived_at), "dd MMM yyyy")}</span>
                                    )}
                                  </div>
                                </CardContent>
                              </Card>
                            </TooltipTrigger>
                            <TooltipContent>
                              <div>Tax (TDS): ₹{bd.tds.toLocaleString("en-IN")}</div>
                              {bd.interest > 0 && <div>Interest: ₹{bd.interest.toLocaleString("en-IN")}</div>}
                              {bd.surcharge > 0 && <div>Surcharge: ₹{bd.surcharge.toLocaleString("en-IN")}</div>}
                              {bd.lateFees > 0 && <div>Late Fees 234E: ₹{bd.lateFees.toLocaleString("en-IN")} (Balance ₹{lateFeeBalance.toLocaleString("en-IN")})</div>}
                              <div>Applied Total (deductees): ₹{bd.applied.toLocaleString("en-IN")}</div>
                              {bd.kasarVatav > 0 && <div>Kasar-Vatav adjustment: ₹{bd.kasarVatav.toLocaleString("en-IN")}</div>}
                              <div>Effective Applied: ₹{bd.effectiveApplied.toLocaleString("en-IN")}</div>
                              <div>Challan Total: ₹{(ac.total_challan_amount || 0).toLocaleString("en-IN")}</div>
                              <div>Pending Balance: ₹{pendingBalance.toLocaleString("en-IN")}</div>
                              <div className="pt-1 border-t border-border/30 mt-1">Click to view this challan's entries.</div>
                              <div>Use the restore icon to bring it back to the active list.</div>
                              {ac.archived_at && <div>Archived {format(new Date(ac.archived_at), "dd MMM yyyy 'at' HH:mm")}</div>}
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* Carry-forward challans (Issue 7H: show origin quarter/FY) */}
              {challansExpanded && carryForwardChallans.length > 0 && (
                <div className="space-y-1">
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Carried Forward</p>
                  <div className="flex gap-2 overflow-x-auto pb-1">
                    {carryForwardChallans.map(cf => {
                      const bd = getChallanBreakdownAll(cf.challan.id);
                      const avail = Math.max(0, (cf.challan.total_challan_amount || 0) - bd.effectiveApplied);
                      const isFullyUtilized = avail <= 0.5;
                      // Has any deductee from the currently-viewed quarter been
                      // attached to this carry-forward challan?
                      const hasCurrentQUsage = (allChallanDeductees[cf.challan.id] || [])
                        .some(d => d.quarter === selQuarter && d.financial_year === selFy);
                      // Four visual states so user can spot each at a glance:
                      //   1. Untouched + has balance           → warm tan (default)
                      //   2. Partially used in current Q       → amber (new — still has balance here)
                      //   3. Fully consumed via current Q      → blue  (exhausted by this quarter)
                      //   4. Fully consumed only by prior Qs   → slate (old news)
                      let cardTone = "bg-accent/30 border-accent";
                      if (hasCurrentQUsage && !isFullyUtilized) {
                        cardTone = "bg-amber-50 border-amber-300";          // partial
                      } else if (hasCurrentQUsage && isFullyUtilized) {
                        cardTone = "bg-blue-50 border-blue-300";            // fully consumed this Q
                      } else if (isFullyUtilized) {
                        cardTone = "bg-slate-100 border-slate-300 opacity-90"; // historically fully used
                      }
                      return (
                        <TooltipProvider key={`cf-${cf.challan.id}`}>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Card
                                className={cn(
                                  "cursor-pointer transition-all hover:shadow-sm flex-shrink-0 w-60",
                                  cardTone,
                                  selectedChallan?.id === cf.challan.id ? "border-primary ring-1 ring-primary/30" : "",
                                )}
                                onClick={() => selectChallan(cf.challan)}>
                                <CardContent className="p-2.5 space-y-1">
                                  <div className="flex items-start justify-between gap-1">
                                    <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                                      <CreditCard size={12} className="text-accent-foreground shrink-0" />
                                      <span className="text-xs font-semibold font-mono">{cf.challan.bsr_code || "No BSR"}</span>
                                      <Badge variant="secondary" className="text-[9px]">From {cf.fromQuarter} {cf.fromFy}</Badge>
                                      {/* Combined-payment challan carried forward from a DIFFERENT form —
                                          e.g. a 26Q challan still funding this 24Q return. */}
                                      {cf.challan.form_type !== selForm && (
                                        <Badge variant="outline" className="text-[9px] px-1 border-primary/40 text-primary">
                                          Shared with {cf.challan.form_type}
                                        </Badge>
                                      )}
                                    </div>
                                    {/* Blocked while THIS quarter still draws on it (a carry-forward
                                        challan whose balance was used up in a prior quarter has no
                                        reason to keep showing up here) OR while the currently open
                                        filing is Ready to File/Filed — every change here goes through
                                        the same freeze + permission-request flow as Edit/Delete. */}
                                    {!isFilingLocked && (
                                      <Button variant="ghost" size="icon" className="h-5 w-5 shrink-0" title="Archive — hide from active use, restorable any time"
                                        disabled={archivingId === cf.challan.id}
                                        onClick={e => {
                                          e.stopPropagation();
                                          const activeCount = (allChallanDeductees[cf.challan.id] || [])
                                            .filter(d => d.quarter === selQuarter && d.financial_year === selFy).length;
                                          void archiveChallan(cf.challan, activeCount);
                                        }}>
                                        {archivingId === cf.challan.id ? <Loader2 size={10} className="animate-spin" /> : <Archive size={10} />}
                                      </Button>
                                    )}
                                  </div>
                                  <div className="flex items-center justify-between text-[10px]">
                                    <span className="text-muted-foreground">Available</span>
                                    <span className={cn("font-semibold", avail > 0.5 ? "text-emerald-600" : "text-slate-500")}>₹{avail.toLocaleString("en-IN")}</span>
                                  </div>
                                  {(hasCurrentQUsage || isFullyUtilized) && (
                                    <div className="flex flex-wrap gap-1">
                                      {hasCurrentQUsage && !isFullyUtilized && (
                                        <Badge className="text-[8px] bg-amber-500 text-white border-0 px-1">Partial {selQuarter}</Badge>
                                      )}
                                      {hasCurrentQUsage && isFullyUtilized && (
                                        <Badge className="text-[8px] bg-blue-600 text-white border-0 px-1">Used {selQuarter}</Badge>
                                      )}
                                      {isFullyUtilized && (
                                        <Badge className="text-[8px] bg-emerald-600 text-white border-0 px-1">Fully Utilised</Badge>
                                      )}
                                    </div>
                                  )}
                                </CardContent>
                              </Card>
                            </TooltipTrigger>
                            <TooltipContent>
                              Carried from {cf.fromQuarter} FY {cf.fromFy}
                              {cf.challan.challan_serial_no ? ` · Challan No: ${cf.challan.challan_serial_no}` : ""}
                              {" · "}Original: ₹{(cf.challan.total_challan_amount || 0).toLocaleString("en-IN")}
                              {" · "}Used (all quarters): ₹{bd.applied.toLocaleString("en-IN")}
                              {(cf.challan.late_fees_234e || 0) > 0 && (
                                <> · Late Fees 234E: ₹{(cf.challan.late_fees_234e || 0).toLocaleString("en-IN")} (Used ₹{(cf.challan.late_fees_used || 0).toLocaleString("en-IN")})</>
                              )}
                              {bd.kasarVatav > 0 && (
                                <> · Kasar-Vatav adjustment: ₹{bd.kasarVatav.toLocaleString("en-IN")}</>
                              )}
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      );
                    })}
                  </div>
                </div>
              )}

              {!challansExpanded ? null : challans.length === 0 && carryForwardChallans.length === 0 ? (
                <Card className="border-dashed">
                  <CardContent className="py-6 text-center text-muted-foreground text-sm">
                    {isFilingLocked ? "Filed — no challans can be added." : "No challans yet. Add your first challan."}
                  </CardContent>
                </Card>
              ) : challans.length > 0 && (
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {challans.map(c => {
                    const bd = getChallanBreakdownAll(c.id);
                    const entryChanges = correctionChangesForChallan(c.id);
                    const lateFeeBalance = (c.late_fees_234e || 0) - (c.late_fees_used || 0);
                    return (
                      <TooltipProvider key={c.id}>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Card
                              className={cn("cursor-pointer transition-all hover:shadow-sm flex-shrink-0 w-60",
                                selectedChallan?.id === c.id ? "border-primary ring-1 ring-primary/30" : "",
                                isFilingLocked ? "bg-muted/50" : "",
                                // Same colour language as the entry rows.
                                isCorrectionMode && effectiveCorrectionAction(c as any) === "add" && "border-l-[3px] border-l-emerald-500",
                                isCorrectionMode && effectiveCorrectionAction(c as any) === "modify" && "border-l-[3px] border-l-amber-500",
                                isCorrectionMode && effectiveCorrectionAction(c as any) === "delete" && "border-l-[3px] border-l-red-500 opacity-60",
                                // entries changed but the challan itself did not
                                isCorrectionMode && entryChanges && (!(c as any).action || (c as any).action === "unchanged") && "border-l-[3px] border-l-amber-400",
                              )}
                              onClick={() => selectChallan(c)}>
                              <CardContent className="p-2.5 space-y-1">
                                <div className="flex items-start justify-between gap-1">
                                  <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                                    <CreditCard size={12} className="text-primary shrink-0" />
                                    <span className="text-xs font-semibold font-mono truncate">{c.bsr_code || "No BSR"}</span>
                                    {c.section_code && <Badge variant="outline" className="text-[9px] px-1">{c.section_code}</Badge>}
                                    {bd.interestOnly && (
                                      <Badge className="text-[9px] px-1 bg-amber-100 text-amber-700" title="No TDS on this challan — it pays the late-deposit interest of entries on the other challans">
                                        Interest challan
                                      </Badge>
                                    )}
                                    {!bd.interestOnly && bd.viaIntChallan > 0 && (
                                      <Badge className="text-[9px] px-1 bg-amber-100 text-amber-700" title="Interest on this challan's entries was paid on a separate interest challan">
                                        Int. ₹{bd.viaIntChallan.toLocaleString("en-IN")} via interest challan
                                      </Badge>
                                    )}
                                    {/* Combined-payment challan: same bank challan funding more than one
                                        form — this row was created under c.form_type, not the form
                                        currently open, but its Applied/Available below already includes
                                        every form's usage. */}
                                    {c.form_type !== selForm && (
                                      <Badge variant="outline" className="text-[9px] px-1 border-primary/40 text-primary">
                                        Shared with {c.form_type}
                                      </Badge>
                                    )}
                                    {/* Correction mode: which challans changed, so a
                                        long strip can be scanned at a glance. */}
                                    {isCorrectionMode && (c as any).action === "add" && (
                                      <Badge className="text-[9px] px-1 bg-emerald-100 text-emerald-700">Added</Badge>
                                    )}
                                    {isCorrectionMode && effectiveCorrectionAction(c as any) === "modify" && (
                                      <Badge className="text-[9px] px-1 bg-amber-100 text-amber-700">Modified</Badge>
                                    )}
                                    {isCorrectionMode && effectiveCorrectionAction(c as any) === "delete" && (
                                      <Badge className="text-[9px] px-1 bg-red-100 text-red-700">Deleted</Badge>
                                    )}
                                    {isCorrectionMode && entryChanges && (
                                      <Badge
                                        className="text-[9px] px-1 bg-amber-100 text-amber-700"
                                        title={[
                                          entryChanges.add ? entryChanges.add + " added" : null,
                                          entryChanges.modify ? entryChanges.modify + " modified" : null,
                                          entryChanges.del ? entryChanges.del + " deleted" : null,
                                        ].filter(Boolean).join(" · ")}
                                      >
                                        {entryChanges.total} changed
                                      </Badge>
                                    )}
                                    {isCorrectionMode && effectiveCorrectionAction(c as any) !== "unchanged" && !isFilingLocked && (
                                      <Button
                                        variant="ghost" size="icon" className="h-5 w-5"
                                        title="Undo this challan change — restore the filed values"
                                        onClick={e => { e.stopPropagation(); void undoCorrectionChallanRow(c); }}
                                      >
                                        <Undo2 size={10} />
                                      </Button>
                                    )}
                                  </div>
                                  <div className="flex gap-0.5 shrink-0">
                                    {/* Issue 2: Hide Edit/Delete/Archive when the filing is Ready to
                                        File/Filed — every change here goes through the freeze +
                                        permission-request flow, permanently, even once Filed. */}
                                    {!isFilingLocked && (
                                      <Button variant="ghost" size="icon" className="h-5 w-5" onClick={e => { e.stopPropagation(); openEditChallan(c); }}>
                                        <Pencil size={10} />
                                      </Button>
                                    )}
                                    {/* Archiving is a live-data concept — does not apply to a
                                        correction's fixed snapshot (see fetchChallans). */}
                                    {!isFilingLocked && !isCorrectionMode && (
                                      <Button variant="ghost" size="icon" className="h-5 w-5" title="Archive — hide from active use, restorable any time"
                                        disabled={archivingId === c.id}
                                        onClick={e => {
                                          e.stopPropagation();
                                          const activeCount = deductees.filter(d => d.challan_id === c.id).length
                                            + prevEntries.filter(d => d.challan_id === c.id).length;
                                          void archiveChallan(c, activeCount);
                                        }}>
                                        {archivingId === c.id ? <Loader2 size={10} className="animate-spin" /> : <Archive size={10} />}
                                      </Button>
                                    )}
                                    {!isFilingLocked && (
                                      <Button variant="ghost" size="icon" className="h-5 w-5" onClick={e => { e.stopPropagation(); void deleteChallan(c); }}>
                                        <Trash2 size={10} className="text-destructive" />
                                      </Button>
                                    )}
                                  </div>
                                </div>
                                <p className="text-[10px] text-muted-foreground truncate">
                                  {c.deposit_date ? format(new Date(c.deposit_date), "dd MMM yyyy") : "No date"}
                                  {c.challan_serial_no && ` • No: ${c.challan_serial_no}`}
                                </p>
                                <div className={cn("flex items-center justify-between text-[10px] font-semibold",
                                  bd.overApplied ? "text-destructive" : isChallanFullyUtilised(bd.effectiveApplied, bd.allocatable) ? "text-emerald-600" : "text-amber-600")}>
                                  <span>{bd.overApplied ? "Over-applied" : isChallanFullyUtilised(bd.effectiveApplied, bd.allocatable) ? "Fully Utilised" : "Unconsumed"}</span>
                                  <span>₹{bd.effectiveApplied.toLocaleString("en-IN")}/₹{(c.total_challan_amount || 0).toLocaleString("en-IN")}</span>
                                </div>
                                <div className="w-full h-1.5 rounded-full bg-muted overflow-hidden">
                                  <div className={cn("h-full rounded-full transition-all", getBalanceColor(c))}
                                    style={{ width: c.total_challan_amount > 0 ? `${Math.min(100, (bd.effectiveApplied / c.total_challan_amount) * 100)}%` : "0%" }} />
                                </div>
                                {isFilingLocked && (
                                  <Badge variant="secondary" className="text-[9px] gap-1"><Lock size={8} /> {lockBadgeLabel ?? "Filed"}</Badge>
                                )}
                                {/* Issue 6: Late Fees 234E tracking — kept inline since it's an editable field, not just display */}
                                {(c.late_fees_234e || 0) > 0 && (
                                  <div className="flex items-center justify-between gap-1 text-[9px] pt-1 border-t border-border/30">
                                    <span className="text-muted-foreground">LF ₹{(c.late_fees_234e || 0).toLocaleString("en-IN")} used</span>
                                    {isFilingLocked ? (
                                      <span>₹{(c.late_fees_used || 0).toLocaleString("en-IN")}</span>
                                    ) : (
                                      <Input
                                        type="number"
                                        className="h-5 w-16 text-[9px] text-right px-1"
                                        defaultValue={c.late_fees_used || ""}
                                        onClick={e => e.stopPropagation()}
                                        onBlur={async e => {
                                          const val = Math.min(parseFloat(e.target.value) || 0, c.late_fees_234e || 0);
                                          await supabase.from(SRC.challans as any).update({ late_fees_used: val } as any).eq("id", c.id);
                                          if (filing) await refreshChallansAndCF(filing.id);
                                          await bumpUnderProcess();
                                        }}
                                      />
                                    )}
                                  </div>
                                )}
                                {bd.kasarVatav > 0 && (
                                  <div className="flex items-center justify-between gap-1 text-[9px] pt-1 border-t border-border/30">
                                    <span className="text-muted-foreground">Kasar-Vatav adjusted</span>
                                    <span className="font-medium">₹{bd.kasarVatav.toLocaleString("en-IN")}</span>
                                  </div>
                                )}
                              </CardContent>
                            </Card>
                          </TooltipTrigger>
                          <TooltipContent>
                            <div>Tax (TDS): ₹{bd.tds.toLocaleString("en-IN")}</div>
                            {bd.interest > 0 && <div>Interest: ₹{bd.interest.toLocaleString("en-IN")}</div>}
                            {bd.surcharge > 0 && <div>Surcharge: ₹{bd.surcharge.toLocaleString("en-IN")}</div>}
                            {bd.lateFees > 0 && <div>Late Fees 234E: ₹{bd.lateFees.toLocaleString("en-IN")} (Balance ₹{lateFeeBalance.toLocaleString("en-IN")})</div>}
                            <div>Applied Total (deductees): ₹{bd.applied.toLocaleString("en-IN")}</div>
                            {bd.kasarVatav > 0 && <div>Kasar-Vatav adjustment: ₹{bd.kasarVatav.toLocaleString("en-IN")}</div>}
                            <div>Effective Applied: ₹{bd.effectiveApplied.toLocaleString("en-IN")}</div>
                            <div>Challan Total: ₹{(c.total_challan_amount || 0).toLocaleString("en-IN")}</div>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Challan detail + Deductee Table — now full width, no longer squeezed by the left sidebar */}
            {challansExpanded && (
            <div className="space-y-3">
              {selectedChallan ? (
                <>
                  {/* Issue 1 FIX: Full Challan Details — always visible (read-only when filed) */}
                  {(() => {
                    // TDS, Interest, and Late Fee are pooled against the challan's
                    // own undiminished total (computeChallanPooled) — allocatable/
                    // overApplied/unconsumed all come straight from that, not
                    // re-derived here, so this can never drift from the shared rule.
                    const bd = getChallanBreakdownAll(selectedChallan.id);
                    const allocatable = bd.allocatable;
                    const matchOk = isChallanFullyUtilised(challanDeducteeTds, allocatable);
                    const overApplied = bd.overApplied;
                    const unconsumed = bd.unconsumed;
                    // Combined-payment (cross-form) challan bifurcation — see
                    // getChallanBreakdownAll's own doc. Only worth a row when
                    // more than one form actually has entries against it.
                    const byForm = bd.byForm;
                    return (
                      <Card className="bg-muted/30">
                        <CardContent className="px-3 py-1.5">
                          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                            <span><strong>BSR:</strong> <span className="font-mono">{selectedChallan.bsr_code || "—"}</span></span>
                            <span><strong>Challan No:</strong> <span className="font-mono">{selectedChallan.challan_serial_no || "—"}</span></span>
                            <span><strong>Date:</strong> {selectedChallan.deposit_date ? format(new Date(selectedChallan.deposit_date), "dd/MM/yyyy") : "—"}</span>
                            <span><strong>Bank:</strong> {selectedChallan.bank_name || "—"}</span>
                            <span><strong>Section:</strong> {selectedChallan.section_code || "—"}</span>
                            {selectedChallan.minor_head_of_challan && (
                              <span><strong>Minor Head:</strong> {selectedChallan.minor_head_of_challan}</span>
                            )}
                            <span className="text-border">|</span>
                            <span>TDS: <strong>₹{(selectedChallan.total_tax_deposited || 0).toLocaleString("en-IN")}</strong></span>
                            {(selectedChallan.surcharge_deposited || 0) > 0 && (
                              <span>Surcharge: <strong>₹{(selectedChallan.surcharge_deposited || 0).toLocaleString("en-IN")}</strong></span>
                            )}
                            {(selectedChallan.education_cess_deposited || 0) > 0 && (
                              <span>Cess: <strong>₹{(selectedChallan.education_cess_deposited || 0).toLocaleString("en-IN")}</strong></span>
                            )}
                            {(selectedChallan.interest_deposited || 0) > 0 && (
                              <span>Interest: <strong>₹{(selectedChallan.interest_deposited || 0).toLocaleString("en-IN")}</strong></span>
                            )}
                            {(selectedChallan.others_deposited || 0) > 0 && (
                              <span>Others: <strong>₹{(selectedChallan.others_deposited || 0).toLocaleString("en-IN")}</strong></span>
                            )}
                            {(selectedChallan.late_fees_234e || 0) > 0 && (
                              <span className="text-amber-700">Late Fees: <strong>₹{(selectedChallan.late_fees_234e || 0).toLocaleString("en-IN")}</strong></span>
                            )}
                            <span className="font-semibold">Total Paid: ₹{(selectedChallan.total_challan_amount || 0).toLocaleString("en-IN")}</span>
                            {(selectedChallan.late_fees_234e || 0) > 0 && (
                              <span className="text-muted-foreground">Allocatable: ₹{allocatable.toLocaleString("en-IN")}</span>
                            )}
                            <span className="text-border">|</span>
                            <span className="text-muted-foreground">Deductees: <strong>{liveDeductees.length + prevEntries.length}</strong></span>
                            <span className={cn("font-semibold",
                              matchOk ? "text-emerald-600"
                                : challanDeducteeTds < allocatable ? "text-amber-600"
                                : "text-destructive")}>
                              Applied: ₹{challanDeducteeTds.toLocaleString("en-IN")} / ₹{allocatable.toLocaleString("en-IN")}
                              {matchOk
                                ? <CheckCircle2 size={12} className="inline ml-1" />
                                : <AlertTriangle size={12} className="inline ml-1" />}
                            </span>
                            <span className={cn("font-semibold", unconsumed > 0 ? "text-amber-600" : "text-muted-foreground")}>
                              Unconsumed Amount: ₹{unconsumed.toLocaleString("en-IN")}
                            </span>
                            {(selectedChallan.kasar_vatav_amount || 0) > 0 && (
                              <Badge variant="outline" className="text-[9px] gap-1 border-violet-300 text-violet-700 dark:text-violet-300">
                                Kasar-Vatav: ₹{(selectedChallan.kasar_vatav_amount || 0).toLocaleString("en-IN")}
                              </Badge>
                            )}
                            {bd.interestOnly && (
                              <Badge className="text-[9px] bg-amber-100 text-amber-700">Interest challan — ₹{(interestChallanPlan.consumed.get(selectedChallan.id) || 0).toLocaleString("en-IN")} matched to interest on other challans</Badge>
                            )}
                            {bd.interestOnly && interestChallanPlan.shortfall > 0 && (
                              <Badge className="text-[9px] bg-red-100 text-red-700" title="Interest the entries owe beyond what the interest challan(s) paid. It does not make any TDS challan over-applied.">Interest short-paid ₹{interestChallanPlan.shortfall.toLocaleString("en-IN")}</Badge>
                            )}
                            {!bd.interestOnly && bd.viaIntChallan > 0 && (
                              <Badge className="text-[9px] bg-amber-100 text-amber-700">Interest ₹{bd.viaIntChallan.toLocaleString("en-IN")} paid via separate interest challan</Badge>
                            )}
                            {bd.earlierQuarter.count > 0 && (
                              <Badge className="text-[9px] bg-slate-100 text-slate-700" title={`These entries belong to a quarter before this challan's own (${selectedChallan.quarter} FY ${selectedChallan.financial_year}), so they were paid from that return's challans. They are shown read-only and not counted in Applied.`}>
                                {bd.earlierQuarter.count} earlier-quarter {bd.earlierQuarter.count === 1 ? "entry" : "entries"} (TDS ₹{bd.earlierQuarter.tds.toLocaleString("en-IN")}) not counted
                              </Badge>
                            )}
                            {overApplied ? (
                              <Badge className="text-[9px] bg-red-100 text-red-700">Over-applied</Badge>
                            ) : matchOk && (
                              <Badge className="text-[9px] bg-emerald-100 text-emerald-700">Fully Utilised</Badge>
                            )}
                            {/* Kasar-Vatav: close out a small, genuinely unattachable residual
                                balance so the challan can read as Fully Utilised without a
                                fake deductee row. Blocked while the currently open filing is
                                Ready to File/Filed — a challan-level adjustment is still a
                                change to return data, and this stays frozen permanently
                                alongside Edit/Delete/Archive until an approved edit request
                                reverts the return out of that status. Not offered on archived
                                challans (already put away). */}
                            {!isFilingLocked && !isCorrectionMode && !selectedChallan.is_archived && (unconsumed > 0 || (selectedChallan.kasar_vatav_amount || 0) > 0) && (
                              <Button
                                size="sm" variant="outline" className="h-6 gap-1 text-[10px] px-2 border-violet-300 text-violet-700 hover:bg-violet-50 dark:text-violet-300 dark:hover:bg-violet-950"
                                onClick={() => openKasarVatavDialog(selectedChallan)}
                              >
                                {(selectedChallan.kasar_vatav_amount || 0) > 0 ? "Edit Kasar-Vatav" : "Adjust (Kasar-Vatav)"}
                              </Button>
                            )}
                            <div className="flex-1" />
                            {isFilingLocked && (
                              <Badge variant="secondary" className="text-[9px] gap-1"><Lock size={8} /> {lockBadgeLabel ?? "Filed"} — Read Only</Badge>
                            )}
                          </div>
                          {byForm.length > 1 && (
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] mt-1.5 pt-1.5 border-t">
                              <span className="text-muted-foreground">Combined payment — split by form:</span>
                              {byForm.map((f) => (
                                <span key={f.formType} className={cn(f.formType === selForm && "font-semibold text-foreground")}>
                                  {f.formType}: ₹{f.applied.toLocaleString("en-IN")} ({f.count} deductee{f.count === 1 ? "" : "s"})
                                </span>
                              ))}
                            </div>
                          )}
                          {/* Explicit, always-visible error text — the small red
                              "Over-applied" badge above is easy to miss; this states
                              the problem outright and blocks Stage 1 Run Validation
                              (see TdsValidateFinalise.tsx's own gate) until fixed. */}
                          {overApplied && (
                            <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-2 py-1.5 text-[11px] text-destructive mt-1.5">
                              <AlertTriangle size={12} className="shrink-0 mt-0.5" />
                              <span><b>Challan has been over-applied.</b> Remove or correct entries against this challan until Applied no longer exceeds Total Paid — Stage 1 validation can't run until this is fixed.</span>
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    );
                  })()}

                  {/* Hidden measuring spans for Excel-style column AutoFit — same font
                      classes as the real Name/PAN Inputs, positioned off-screen */}
                  <span ref={nameMeasureRef} className="text-xs fixed -left-[9999px] top-0 whitespace-pre" aria-hidden="true" />
                  <span ref={panMeasureRef} className="text-xs font-mono fixed -left-[9999px] top-0 whitespace-pre" aria-hidden="true" />

                  {/* Deductee Table */}
                  <Card>
                    <CardContent className="p-0">
                      <div className="overflow-x-auto">
                        {/* table-layout:fixed ONLY for 24Q — 24Q is the one form whose Employee
                            Name/PAN autofit was visibly failing (both truncated regardless of the
                            computed nameColWidth/panColWidth), because under the default
                            table-layout:auto the browser treats a <th> width as a mere hint that
                            competes with the row's other cells rather than a hard column width.
                            26Q/27EQ already render correctly under auto layout (several of their
                            own columns have no explicit width at all — Type/Amount/Date/Rate%/
                            Interest/Reason — so forcing fixed layout there would redistribute
                            their space too and risk changing an already-correct, already-shipped
                            layout the user explicitly asked not to touch). Every other 24Q column
                            gets an explicit width for the same reason Name/PAN need one: under
                            fixed layout, an unspecified column's width is undefined behaviour
                            (typically an equal share of whatever's left, not a considered size). */}
                        {/* width:max-content, NOT 100%. Under table-layout:fixed a
                            table told to fill 100% of its container hands the LEFTOVER
                            space back to the columns proportionally — which silently
                            undoes the AutoFit above: every Employee Name and PAN box
                            stretched far past its widest value, with a dead gap before
                            Gross. max-content makes the table exactly the sum of the
                            widths computed for it, so a column really is as wide as its
                            content and no wider; the overflow-x-auto wrapper still
                            handles a viewport narrower than that sum. */}
                        <Table style={selForm === "24Q" ? { tableLayout: "fixed", width: "max-content" } : undefined}>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="w-8 text-xs">#</TableHead>
                              {isCorrectionMode && (
                                <TableHead className="w-[92px] text-xs">Change</TableHead>
                              )}
                              {selForm === "24Q" ? (
                                <>
                                  <TableHead className="text-xs" style={{ width: nameColWidth, minWidth: nameColWidth }}>Employee Name</TableHead>
                                  <TableHead className="text-xs" style={{ width: panColWidth, minWidth: panColWidth }}>PAN</TableHead>
                                  <TableHead className="text-xs" style={{ width: 110, minWidth: 110 }}>Date</TableHead>
                                  <TableHead className="text-xs text-right" style={{ width: 110, minWidth: 110 }}>Gross</TableHead>
                                  <TableHead className="text-xs text-right" style={{ width: 90, minWidth: 90 }}>Std Ded</TableHead>
                                  <TableHead className="text-xs text-right" style={{ width: 90, minWidth: 90 }}>Taxable</TableHead>
                                  <TableHead className="text-xs text-right" style={{ width: 70, minWidth: 70 }}>TDS</TableHead>
                                  {/* Bug fix 2026-08-06: 24Q had no Interest column at all, so a
                                      challan legitimately Fully Utilised via TDS + auto-computed
                                      interest (see calcAutoInterest/computeApplied's own docs — the
                                      SAME math the "Fully Utilised" badge already uses) looked
                                      unexplained: the deductee row's own TDS figure alone never
                                      summed to the challan total, with nowhere on this table showing
                                      where the rest came from. */}
                                  <TableHead className="text-xs text-right" style={{ width: 80, minWidth: 80 }}>Interest</TableHead>
                                  <TableHead className="text-xs" style={{ width: 60, minWidth: 60 }}>Details</TableHead>
                                </>
                              ) : selForm === "27EQ" ? (
                                <>
                                  <TableHead className="text-xs" style={{ width: nameColWidth, minWidth: nameColWidth }}>Collectee</TableHead>
                                  <TableHead className="text-xs" style={{ width: panColWidth, minWidth: panColWidth }}>PAN</TableHead>
                                  <TableHead className="text-xs">Type</TableHead>
                                  <TableHead className="text-xs min-w-[140px]">Section</TableHead>
                                  <TableHead className="text-xs text-right">Amount</TableHead>
                                  <TableHead className="text-xs">Date</TableHead>
                                  <TableHead className="text-xs text-right">Rate%</TableHead>
                                  <TableHead className="text-xs text-right">TCS</TableHead>
                                  <TableHead className="text-xs text-right">Interest</TableHead>
                                  <TableHead className="text-xs">Reason</TableHead>
                                </>
                              ) : (
                                <>
                                  <TableHead className="text-xs" style={{ width: nameColWidth, minWidth: nameColWidth }}>Name</TableHead>
                                  <TableHead className="text-xs" style={{ width: panColWidth, minWidth: panColWidth }}>PAN</TableHead>
                                  <TableHead className="text-xs">Type</TableHead>
                                  <TableHead className="text-xs min-w-[140px]">Section</TableHead>
                                  <TableHead className="text-xs text-right">Amount</TableHead>
                                  <TableHead className="text-xs">Date</TableHead>
                                  <TableHead className="text-xs text-right">Rate%</TableHead>
                                  <TableHead className="text-xs text-right">TDS</TableHead>
                                  <TableHead className="text-xs text-right">Interest</TableHead>
                                  <TableHead className="text-xs">Reason</TableHead>
                                </>
                              )}
                              <TableHead className="w-10 text-xs">Del</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {/* Issue 5: Previous quarter entries section (read-only, Issue 7E: distinct styling) */}
                            {prevEntries.length > 0 && (
                              <TableRow className="bg-slate-100 border-l-4 border-l-slate-400">
                                <TableCell colSpan={selForm === "24Q" ? 11 : 12} className="py-1 px-2">
                                  {/* Dynamic label: single prev-quarter uses selQuarter/selFy helper;
                                      multi-quarter carry-forward lists all unique quarters from data */}
                                  <span className="text-[10px] font-semibold text-slate-600">
                                    {buildPrevQuarterLabel(prevEntries, selQuarter, selFy)}
                                  </span>
                                </TableCell>
                              </TableRow>
                            )}
                            {prevEntries.map((d, idx) => {
                              const colSpanVal = selForm === "24Q" ? 11 : 12;
                              // Per-row quarter badge — shows exactly which quarter/FY this
                              // read-only entry belongs to (resolves ambiguity when a
                              // challan has utilisation spanning multiple quarters).
                              const qBadge = (
                                <Badge variant="outline" className="h-4 px-1 text-[9px] font-semibold border-slate-400 text-slate-600 bg-white">
                                  {d.quarter || "?"}
                                </Badge>
                              );
                              return (
                                <TableRow key={`prev-${d.id}`} className="bg-slate-50 border-l-4 border-l-slate-300 opacity-80">
                                  <TableCell className="text-xs text-slate-500">
                                    <div className="flex items-center gap-1">
                                      <Lock size={10} />
                                      {qBadge}
                                    </div>
                                  </TableCell>
                                  {selForm === "24Q" ? (
                                    <>
                                      <TableCell><Input className="h-7 text-xs bg-muted cursor-not-allowed" style={{ width: nameColWidth, minWidth: nameColWidth }} disabled title={d.deductee_name} defaultValue={d.deductee_name} /></TableCell>
                                      <TableCell><Input className="h-7 text-xs font-mono bg-muted cursor-not-allowed" style={{ width: panColWidth, minWidth: panColWidth }} disabled title={d.deductee_pan || ""} defaultValue={d.deductee_pan || ""} /></TableCell>
                                      <TableCell className="text-xs">{d.date_of_payment || "—"}</TableCell>
                                      <TableCell className="text-right text-xs">{(d.gross_salary || 0).toLocaleString("en-IN")}</TableCell>
                                      <TableCell className="text-right text-xs">{(d.standard_deduction_allowed || 0).toLocaleString("en-IN")}</TableCell>
                                      <TableCell className="text-right text-xs font-medium">{d.net_taxable_salary?.toLocaleString("en-IN") || "—"}</TableCell>
                                      <TableCell className="text-right text-xs font-semibold">{d.total_tax_deducted?.toLocaleString("en-IN") || "—"}</TableCell>
                                      <TableCell className="text-right text-xs">{d.interest_amount > 0 ? d.interest_amount.toLocaleString("en-IN") : "—"}</TableCell>
                                      <TableCell><span className="text-[9px] text-slate-500">{d.quarter || "—"} FY {d.financial_year || "—"}</span></TableCell>
                                    </>
                                  ) : (
                                    <>
                                      <TableCell><Input className="h-7 text-xs bg-muted cursor-not-allowed" disabled title={d.deductee_name} defaultValue={d.deductee_name} /></TableCell>
                                      <TableCell><Input className="h-7 text-xs font-mono bg-muted cursor-not-allowed" disabled title={d.deductee_pan || ""} defaultValue={d.deductee_pan || ""} /></TableCell>
                                      <TableCell><span className="text-xs px-1 text-muted-foreground">{d.deductee_type || "—"}</span></TableCell>
                                      <TableCell><Input className="h-7 text-xs w-[160px] bg-muted cursor-not-allowed" disabled defaultValue={d.section_code} /></TableCell>
                                      <TableCell className="text-right text-xs">{(d.amount_paid_credited || 0).toLocaleString("en-IN")}</TableCell>
                                      <TableCell className="text-xs">{d.date_of_payment || "—"}</TableCell>
                                      <TableCell className="text-right text-xs">{d.rate_of_tds ?? "—"}</TableCell>
                                      <TableCell className="text-right text-xs font-semibold">{Math.round(d.total_tax_deducted || d.tds_amount || 0).toLocaleString("en-IN")}</TableCell>
                                      <TableCell className="text-right text-xs">{d.interest_amount > 0 ? d.interest_amount.toLocaleString("en-IN") : "—"}</TableCell>
                                      <TableCell><span className="text-xs text-muted-foreground">{d.reason_for_lower_or_nil_deduction || "—"}</span></TableCell>
                                    </>
                                  )}
                                  <TableCell><Lock size={10} className="text-slate-400" /></TableCell>
                                </TableRow>
                              );
                            })}

                            {/* Issue 5: Current quarter section header */}
                            {prevEntries.length > 0 && (
                              <TableRow className="bg-green-50">
                                <TableCell colSpan={selForm === "24Q" ? 11 : 12} className="py-1 px-2">
                                  <span className="text-[10px] font-semibold text-green-700">✅ Current Quarter Entries</span>
                                </TableCell>
                              </TableRow>
                            )}

                            {/* Current quarter entries (Issue 1: locked when filing=Filed) */}
                            {deductees.map((d, idx) => {
                              // A row already marked deleted in this correction is history —
                              // it is shown struck through, not offered for further editing.
                              const rawAct = isCorrectionMode ? (d as any).action : undefined;
                              // A row can carry a 'modify' marking while holding values
                              // identical to its snapshot — e.g. the user edited it, thought
                              // better of it and typed the original values back by hand.
                              // Rendering that as Modified WITH an Original row beneath shows
                              // two rows containing the same data, which reads as a duplicate.
                              // The database clears the marking on the next write
                              // (20260730140000); this makes rows ALREADY in that state read
                              // correctly without waiting for one.
                              const rowDiffs = rawAct === "modify" ? diffCorrectionRow(d as any) : [];
                              const act = isCorrectionMode ? effectiveCorrectionAction(d as any) : undefined;
                              const locked = isFilingLocked || act === "delete";
                              return (
                                <Fragment key={d.id}>
                                <TableRow
                                  className={cn(
                                    locked && "bg-muted/20",
                                    act === "add" && "bg-emerald-50/70 dark:bg-emerald-950/20",
                                    act === "modify" && "bg-amber-50/70 dark:bg-amber-950/20",
                                    act === "delete" && "bg-red-50/70 dark:bg-red-950/20 opacity-60",
                                  )}
                                  title={
                                    act && act !== "unchanged"
                                      ? `${act[0].toUpperCase()}${act.slice(1)} in this correction`
                                      : undefined
                                  }
                                >
                                  <TableCell className="text-xs text-muted-foreground">{idx + 1}</TableCell>
                                  {isCorrectionMode && (
                                    <TableCell className="text-xs">
                                      {act === "add" && <Badge className="text-[9px] bg-emerald-100 text-emerald-700">Added</Badge>}
                                      {act === "modify" && <Badge className="text-[9px] bg-amber-100 text-amber-700">Modified</Badge>}
                                      {act === "delete" && <Badge className="text-[9px] bg-red-100 text-red-700">Deleted</Badge>}
                                      {(!act || act === "unchanged") && <span className="text-muted-foreground">—</span>}
                                      {act && act !== "unchanged" && !isFilingLocked && (
                                        <Button
                                          variant="ghost" size="icon" className="h-5 w-5 ml-1"
                                          title="Undo this change — restore the filed values"
                                          onClick={e => { e.stopPropagation(); void undoCorrectionEntry(d); }}
                                        >
                                          <Undo2 size={11} />
                                        </Button>
                                      )}
                                    </TableCell>
                                  )}
                                  {selForm === "24Q" ? (
                                    <>
                                      <TableCell>
                                        {/* Explicit pixel width on the INPUT itself, not just the
                                            TableHead — table-layout:fixed derives column widths from
                                            the header row's cells, but the Input's own w-full (100%-
                                            of-td) can still end up narrower than the computed content
                                            width depending on how the browser resolves that cascade.
                                            Setting width/minWidth directly here makes the input's
                                            rendered width unambiguous regardless of that. */}
                                        <Input className={cn("h-7 text-xs", locked && "bg-muted cursor-not-allowed opacity-75")} disabled={locked}
                                          style={{ width: nameColWidth, minWidth: nameColWidth }}
                                          title={d.deductee_name}
                                          data-autofit="name"
                                          defaultValue={d.deductee_name}
                                          onBlur={e => { if (!locked && e.target.value !== d.deductee_name) updateDeducteeField(d.id, "deductee_name", e.target.value); }}
                                          onKeyDown={e => { if (e.key === "Enter") { (e.target as HTMLInputElement).blur(); if (!locked) addDeducteeRow(); } }} />
                                      </TableCell>
                                      <TableCell>
                                        <TooltipProvider>
                                          <Tooltip>
                                            <TooltipTrigger asChild>
                                              <Input className={cn("h-7 text-xs font-mono", locked && "bg-muted cursor-not-allowed opacity-75", d.pan_not_available && "border-destructive text-destructive")}
                                                disabled={locked}
                                                style={{ width: panColWidth, minWidth: panColWidth }}
                                                title={d.deductee_pan || ""}
                                                data-autofit="pan"
                                                defaultValue={d.deductee_pan || ""}
                                                onBlur={e => { if (!locked) updateDeducteeField(d.id, "deductee_pan", e.target.value || null); }} />
                                            </TooltipTrigger>
                                            {d.pan_not_available && <TooltipContent>No PAN — higher TDS rate u/s 206AA applies</TooltipContent>}
                                          </Tooltip>
                                        </TooltipProvider>
                                      </TableCell>
                                      <TableCell>
                                        <Input type="date" className={cn("h-7 text-xs w-28", locked && "bg-muted cursor-not-allowed opacity-75")} disabled={locked}
                                          defaultValue={d.date_of_payment || ""}
                                          onBlur={e => { if (!locked) updateDeducteeField(d.id, "date_of_payment", e.target.value || null); }} />
                                      </TableCell>
                                      <TableCell className="text-right"><Input type="number" className={cn("h-7 text-xs w-24 text-right", locked && "bg-muted cursor-not-allowed opacity-75")} disabled={locked} defaultValue={d.gross_salary || ""} onBlur={e => { if (!locked) updateDeducteeField(d.id, "gross_salary", parseFloat(e.target.value) || null); }} /></TableCell>
                                      <TableCell className="text-right"><Input type="number" className={cn("h-7 text-xs w-20 text-right", locked && "bg-muted cursor-not-allowed opacity-75")} disabled={locked} defaultValue={d.standard_deduction_allowed || ""} onBlur={e => { if (!locked) updateDeducteeField(d.id, "standard_deduction_allowed", parseFloat(e.target.value) || null); }} /></TableCell>
                                      <TableCell className="text-right text-xs font-medium">{d.net_taxable_salary?.toLocaleString("en-IN") || "—"}</TableCell>
                                      <TableCell className="text-right text-xs font-semibold">{d.total_tax_deducted?.toLocaleString("en-IN") || "—"}</TableCell>
                                      <TableCell className="text-right text-xs">
                                        {(() => {
                                          // Live-computed, same as computeApplied/the challan's own
                                          // "Fully Utilised" math — never the stored interest_amount,
                                          // which this form never writes to (see this column's own
                                          // header comment for why that made utilisation status look
                                          // unexplained rather than wrong).
                                          const liveInterest = rowInterest(d, selectedChallan?.deposit_date ?? null);
                                          return liveInterest > 0 ? liveInterest.toLocaleString("en-IN") : "—";
                                        })()}
                                      </TableCell>
                                      <TableCell>
                                        <Button variant="ghost" size="icon" className="h-6 w-6" title="Full Salary Details" disabled={locked} onClick={() => openSalaryDrawer(d)}>
                                          <FileText size={12} />
                                        </Button>
                                      </TableCell>
                                    </>
                                  ) : (
                                    <>
                                      <TableCell>
                                        <Input className={cn("h-7 text-xs", locked && "bg-muted cursor-not-allowed opacity-75")} disabled={locked}
                                          title={d.deductee_name}
                                          data-autofit="name"
                                          defaultValue={d.deductee_name}
                                          onBlur={e => { if (!locked && e.target.value !== d.deductee_name) updateDeducteeField(d.id, "deductee_name", e.target.value); }}
                                          onKeyDown={e => { if (e.key === "Enter") { (e.target as HTMLInputElement).blur(); if (!locked) addDeducteeRow(); } }} />
                                      </TableCell>
                                      <TableCell>
                                        <TooltipProvider>
                                          <Tooltip>
                                            <TooltipTrigger asChild>
                                              <Input className={cn("h-7 text-xs font-mono", locked && "bg-muted cursor-not-allowed opacity-75", d.pan_not_available && "border-destructive text-destructive")}
                                                disabled={locked}
                                                title={d.deductee_pan || ""}
                                                data-autofit="pan"
                                                defaultValue={d.deductee_pan || ""}
                                                onBlur={e => { if (!locked) updateDeducteeField(d.id, "deductee_pan", e.target.value || null); }} />
                                            </TooltipTrigger>
                                            {d.pan_not_available && <TooltipContent>No PAN — higher TDS rate u/s 206AA applies</TooltipContent>}
                                          </Tooltip>
                                        </TooltipProvider>
                                      </TableCell>
                                      {/* Type: read-only label */}
                                      <TableCell>
                                        <span className="text-xs px-1 text-muted-foreground">{d.deductee_type || "—"}</span>
                                      </TableCell>
                                      <TableCell>
                                        <div className="space-y-0.5">
                                          {locked ? (
                                            <span className="text-xs px-1">{d.section_code}</span>
                                          ) : (
                                            <Select value={d.section_code || ""} onValueChange={v => updateDeducteeField(d.id, "section_code", v)}>
                                              <SelectTrigger className="h-7 text-xs w-[160px]"><SelectValue placeholder="Select" /></SelectTrigger>
                                              <SelectContent>
                                                {sectionOptionsFor(d.section_code, d.deductee_type).map(o => <SelectItem key={o.value} value={o.value} disabled={o.disabled}>{o.label}</SelectItem>)}
                                              </SelectContent>
                                            </Select>
                                          )}
                                          {d.section_code && selectedChallan?.section_code && d.section_code !== selectedChallan.section_code && (
                                            <span className="text-[9px] text-amber-600 leading-tight block">⚠ Differs from challan</span>
                                          )}
                                          {/* A section explicitly scoped to Individual/HUF (e.g. 194C(a)) can never
                                              apply to any other deductee type — the rate lookup already refuses to
                                              return a rate for this combination (see rateEngine's
                                              sectionRestrictedToIndividual), so surface WHY the rate field just
                                              unlocked instead of leaving it a silent, unexplained change. */}
                                          {d.section_code && d.deductee_type && getRateForSection(d.section_code, d.deductee_type, d.date_of_payment).sectionRestrictedToIndividual && (
                                            <span className="text-[9px] text-destructive leading-tight block">⚠ {d.deductee_type} — this section is Individual/HUF only</span>
                                          )}
                                        </div>
                                      </TableCell>
                                      <TableCell className="text-right">
                                        <Input type="number" className={cn("h-7 text-xs w-24 text-right", locked && "bg-muted cursor-not-allowed opacity-75")} disabled={locked}
                                          defaultValue={d.amount_paid_credited || ""}
                                          onBlur={e => { if (!locked) updateDeducteeField(d.id, "amount_paid_credited", parseFloat(e.target.value) || null); }} />
                                      </TableCell>
                                      <TableCell>
                                        <Input type="date" className={cn("h-7 text-xs w-28", locked && "bg-muted cursor-not-allowed opacity-75")} disabled={locked}
                                          defaultValue={d.date_of_payment || ""}
                                          onBlur={e => { if (!locked) updateDeducteeField(d.id, "date_of_payment", e.target.value || null); }} />
                                      </TableCell>
                                      <TableCell className="text-right">
                                        {(() => {
                                          const { rateFound } = d.section_code ? getRateForSection(d.section_code, d.deductee_type, d.date_of_payment) : { rateFound: false };
                                          const isAutoRate = rateFound || d.pan_not_available;
                                          return (
                                            <div className="flex items-center gap-1 justify-end">
                                              <Input type="number"
                                                className={cn("h-7 text-xs w-16 text-right",
                                                  (isAutoRate || locked) ? "bg-muted cursor-not-allowed opacity-75" : "",
                                                  d.pan_not_available && "text-destructive"
                                                )}
                                                defaultValue={d.rate_of_tds ?? ""}
                                                readOnly={isAutoRate || locked}
                                                disabled={locked}
                                                onBlur={e => { if (!isAutoRate && !locked) updateDeducteeField(d.id, "rate_of_tds", parseFloat(e.target.value) || null); }}
                                                key={`rate-${d.id}-${d.rate_of_tds}`}
                                              />
                                              {isAutoRate && <Lock size={10} className="text-muted-foreground shrink-0" />}
                                            </div>
                                          );
                                        })()}
                                      </TableCell>
                                      <TableCell className="text-right text-xs font-semibold">
                                        {Math.round(d.total_tax_deducted || d.tds_amount || 0).toLocaleString("en-IN")}
                                      </TableCell>
                                      <TableCell className="text-right text-xs">
                                        {/* Interest u/s 201(1A) — read-only, auto-calculated. Tooltip always shown. */}
                                        {(() => {
                                          const tdsAmt = d.tds_amount || d.total_tax_deducted || 0;
                                          const payDate = d.date_of_payment ?? null;
                                          const depDate = selectedChallan?.deposit_date ?? null;
                                          const hasDates = !!payDate && !!depDate;

                                          // Compute once — stored in IIFE locals, never re-computed on hover
                                          const { lateMonths, exact } = calcAutoInterest(tdsAmt, payDate, depDate);
                                          // This row's share of the challan's interest, rounded once
                                          // on the challan total (see interestByRowId) — can differ
                                          // from rounding this row alone by ₹1.
                                          const interest = rowInterest(d, depDate);
                                          const exactTxt = exact.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                                          // Interest on this challan that a separate interest challan paid.
                                          const viaIntChallan = interestChallanPlan.via.get(d.challan_id) || 0;

                                          // Date context for tooltip display
                                          const entryDt  = payDate ? parseLocalDate(payDate) : null;
                                          const chalDt   = depDate ? parseLocalDate(depDate) : null;
                                          const dueDt    = entryDt ? new Date(entryDt.getFullYear(), entryDt.getMonth() + 1, 7) : null;
                                          const fmtD = (dt: Date | null) =>
                                            dt ? `${String(dt.getDate()).padStart(2,"0")}/${String(dt.getMonth()+1).padStart(2,"0")}/${dt.getFullYear()}` : "—";

                                          // Determine tooltip content variant
                                          const tooltipBody = !hasDates ? (
                                            <p className="text-muted-foreground italic">Insufficient data — dates not available</p>
                                          ) : lateMonths > 0 ? (
                                            <div className="space-y-1">
                                              <p className="font-bold text-sm">Interest Calculation</p>
                                              <p>TDS Amount: <span className="font-medium">₹{tdsAmt.toLocaleString("en-IN")}</span></p>
                                              <p>Late Months: <span className="font-medium">{lateMonths}</span></p>
                                              <p>Interest Rate: <span className="font-medium">1.5% per month</span></p>
                                              <p className="text-muted-foreground text-[10px]">
                                                Deduction: {fmtD(entryDt)} · Due: {fmtD(dueDt)} · Deposit: {fmtD(chalDt)}
                                              </p>
                                              <hr className="border-border" />
                                              <p className="font-mono text-[11px]">
                                                {tdsAmt.toLocaleString("en-IN")} × 1.5% × {lateMonths} = ₹{exactTxt}
                                              </p>
                                              <p className="font-bold">Interest = ₹{interest.toLocaleString("en-IN")}</p>
                                              <p className="text-muted-foreground text-[10px]">
                                                Rounded once on the challan's total interest, as Genius does — the rows add up to the challan's interest.
                                              </p>
                                              {viaIntChallan > 0 && (
                                                <p className="text-amber-700 text-[10px] font-medium">
                                                  Interest on this challan (₹{viaIntChallan.toLocaleString("en-IN")}) was paid on a separate interest challan — it is not added to this challan's Applied.
                                                </p>
                                              )}
                                            </div>
                                          ) : (
                                            <div className="space-y-1">
                                              <p className="font-bold text-sm">Interest Calculation</p>
                                              <p className="text-green-700 font-medium">✓ Paid within due date — Interest = ₹0</p>
                                              <p className="text-muted-foreground text-[10px]">
                                                Deduction: {fmtD(entryDt)} · Due: {fmtD(dueDt)} · Deposit: {fmtD(chalDt)}
                                              </p>
                                              <p className="text-[10px] text-muted-foreground">
                                                No penalty u/s 201(1A) as challan was deposited on or before the due date.
                                              </p>
                                            </div>
                                          );

                                          return (
                                            <TooltipProvider>
                                              <Tooltip>
                                                <TooltipTrigger asChild>
                                                  {interest > 0 ? (
                                                    <span className={cn("font-medium tabular-nums cursor-help underline decoration-dotted",
                                                      viaIntChallan > 0 ? "text-muted-foreground decoration-muted-foreground" : "text-amber-600 decoration-amber-400")}>
                                                      ₹{interest.toLocaleString("en-IN")}{viaIntChallan > 0 && <sup className="ml-0.5 text-[8px]">int. challan</sup>}
                                                    </span>
                                                  ) : (
                                                    <span className="tabular-nums text-muted-foreground cursor-help">—</span>
                                                  )}
                                                </TooltipTrigger>
                                                <TooltipContent
                                                  className="bg-white text-foreground shadow-lg border border-border p-3 max-w-[280px] z-50 text-xs"
                                                  side="left"
                                                  sideOffset={6}
                                                >
                                                  {tooltipBody}
                                                </TooltipContent>
                                              </Tooltip>
                                            </TooltipProvider>
                                          );
                                        })()}
                                      </TableCell>
                                      <TableCell>
                                        {locked ? (
                                          <div className="flex items-center gap-1">
                                            <span className="text-xs text-muted-foreground">{d.reason_for_lower_or_nil_deduction || "—"}</span>
                                            {(d.lower_deduction_certificate_no || d.lower_deduction_rate != null) && (
                                              <span
                                                className="text-muted-foreground shrink-0"
                                                title={`LDC No.: ${d.lower_deduction_certificate_no || "—"} · Rate: ${d.lower_deduction_rate ?? "—"}%`}
                                              >
                                                <FileText size={10} />
                                              </span>
                                            )}
                                          </div>
                                        ) : (
                                          <div className="flex items-center gap-1">
                                            <Select value={d.reason_for_lower_or_nil_deduction || "__none__"} onValueChange={v => updateDeducteeField(d.id, "reason_for_lower_or_nil_deduction", v === "__none__" ? null : v)}>
                                              <SelectTrigger className="h-7 text-xs w-16"><SelectValue placeholder="—" /></SelectTrigger>
                                              <SelectContent>
                                                <SelectItem value="__none__">— None —</SelectItem>
                                                {REASON_CODES.map(r => <SelectItem key={r.code} value={r.code}>{r.label}</SelectItem>)}
                                              </SelectContent>
                                            </Select>
                                            {/* Lower Deduction Certificate No./Rate (u/s 197) — relevant when Reason
                                                = B. Kept as a compact popover rather than two more table columns
                                                (this row is already 12 columns wide). Wired through the same
                                                updateDeducteeField() path as every other field here, so the
                                                DEDUCTEE_LDC_NUMBER_EDIT / DEDUCTEE_LDC_RATE_EDIT audit-log entries
                                                (TRACKED_DEDUCTEE_AUDIT_FIELDS, above) now actually have a way to fire. */}
                                            <Popover>
                                              <PopoverTrigger asChild>
                                                <Button
                                                  variant="ghost" size="icon"
                                                  className={cn("h-6 w-6 shrink-0", (d.lower_deduction_certificate_no || d.lower_deduction_rate != null) ? "text-amber-600" : "text-muted-foreground")}
                                                  title="Lower Deduction Certificate No. / Rate (u/s 197)"
                                                  disabled={locked}
                                                >
                                                  <FileText size={11} />
                                                </Button>
                                              </PopoverTrigger>
                                              <PopoverContent className="w-64 space-y-2" align="start">
                                                <p className="text-xs font-semibold">Lower Deduction Certificate (u/s 197)</p>
                                                <div className="space-y-1">
                                                  <Label className="text-[10px] text-muted-foreground">Certificate No.</Label>
                                                  <Input
                                                    className="h-7 text-xs"
                                                    defaultValue={d.lower_deduction_certificate_no || ""}
                                                    onBlur={e => {
                                                      const v = e.target.value.trim();
                                                      if (v !== (d.lower_deduction_certificate_no || "")) updateDeducteeField(d.id, "lower_deduction_certificate_no", v || null);
                                                    }}
                                                  />
                                                </div>
                                                <div className="space-y-1">
                                                  <Label className="text-[10px] text-muted-foreground">Certified Rate (%)</Label>
                                                  <Input
                                                    type="number" step="0.01"
                                                    className="h-7 text-xs"
                                                    defaultValue={d.lower_deduction_rate ?? ""}
                                                    onBlur={e => {
                                                      const raw = e.target.value;
                                                      const v = raw === "" ? null : parseFloat(raw);
                                                      const normalized = v !== null && isNaN(v) ? null : v;
                                                      if (normalized !== d.lower_deduction_rate) updateDeducteeField(d.id, "lower_deduction_rate", normalized);
                                                    }}
                                                  />
                                                </div>
                                              </PopoverContent>
                                            </Popover>
                                          </div>
                                        )}
                                      </TableCell>
                                    </>
                                  )}
                                  <TableCell>
                                    <Button variant="ghost" size="icon" className="h-6 w-6" disabled={locked} onClick={() => deleteDeductee(d.id)}>
                                      <Trash2 size={12} className={locked ? "text-muted-foreground" : "text-destructive"} />
                                    </Button>
                                  </TableCell>
                                </TableRow>
                                {isCorrectionMode && act === "modify" && rowDiffs.length > 0 && (d as any).original_values && (
                                  <CorrectionOriginalRow
                                    original={(d as any).original_values}
                                    current={d}
                                    form={selForm}
                                  />
                                )}
                              </Fragment>
                              );
                            })}

                            {/* Issue 7F: Add Row - disabled when balance=0 or locked */}
                            <TableRow className="bg-muted/20">
                              <TableCell colSpan={selForm === "24Q" ? 11 : 12} className="text-center py-2">
                                {isFilingLocked ? (
                                  <span className="text-xs text-muted-foreground flex items-center justify-center gap-1"><Lock size={10} /> Data entry locked</span>
                                ) : selectedChallanBalance <= 0 ? (
                                  <span className="text-xs text-muted-foreground">Challan fully utilized — no more entries</span>
                                ) : (
                                  <Button variant="ghost" size="sm" className="gap-1 text-xs h-7" onClick={addDeducteeRow}>
                                    <Plus size={12} /> Add Row
                                  </Button>
                                )}
                              </TableCell>
                            </TableRow>
                          </TableBody>
                        </Table>
                      </div>
                    </CardContent>
                  </Card>
                </>
              ) : (
                <Card><CardContent className="py-12 text-center text-muted-foreground">
                  <CreditCard size={40} className="mx-auto mb-3 opacity-30" />
                  <p className="font-semibold text-sm">Select or add a challan to enter deductee details</p>
                </CardContent></Card>
              )}
            </div>
            )}
          </div>

          {/* Summary Bar */}
          {challans.length > 0 && (
            <Card className="bg-muted/30">
              <CardContent className="p-3">
                <div className="flex flex-wrap gap-6 items-center text-sm">
                  <span>Challans: <strong>{summaryStats.totalChallans}</strong></span>
                  <span>Deductees: <strong>{summaryStats.totalDeductees}</strong></span>
                  <span>Payment: <strong>₹{summaryStats.totalPayment.toLocaleString("en-IN")}</strong></span>
                  <span>TDS: <strong>₹{summaryStats.totalTds.toLocaleString("en-IN")}</strong></span>
                  {summaryStats.totalInterest > 0 && <span>Interest: <strong>₹{summaryStats.totalInterest.toLocaleString("en-IN")}</strong></span>}
                  {summaryStats.totalLateFees > 0 && <span>Late Fees: <strong>₹{summaryStats.totalLateFees.toLocaleString("en-IN")}</strong></span>}
                  <div className="flex-1" />
                  {/* Issue 1: Auto-match disabled when locked */}
                  <Button size="sm" variant="outline" className="gap-1" onClick={autoMatchChallans} disabled={isFilingLocked}>
                    <RefreshCw size={14} /> Auto-match
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
          {autoSaveBadge && (
            <div className="fixed bottom-4 right-4 z-50 bg-emerald-600 text-white text-xs px-3 py-1.5 rounded-full shadow-lg animate-in fade-in slide-in-from-bottom-2">
              ✓ Auto-saved
            </div>
          )}
        </>
      )}

      {/* Challan Dialog (Issue 4: PDF attachment section added) */}
      <Dialog open={challanDialogOpen} onOpenChange={setChallanDialogOpen}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingChallan ? "Edit" : "Add"} Challan</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">BSR Code (7 digits) *</Label>
                <Input value={challanForm.bsr_code || ""} onChange={e => setChallanForm(p => ({ ...p, bsr_code: e.target.value.replace(/\D/g, "") }))} maxLength={7} placeholder="0000000" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Challan Number (5 digits) *</Label>
                <Input value={challanForm.challan_serial_no || ""} onChange={e => setChallanForm(p => ({ ...p, challan_serial_no: e.target.value.replace(/\D/g, "") }))} maxLength={5} placeholder="00000" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Date of Deposit</Label>
                <Input type="date" value={challanForm.deposit_date || ""} onChange={e => setChallanForm(p => ({ ...p, deposit_date: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Minor Head</Label>
                <Select value={challanForm.minor_head || "200"} onValueChange={v => setChallanForm(p => ({ ...p, minor_head: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="200">200 — TDS Payable</SelectItem>
                    <SelectItem value="400">400 — Demand</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Tax</Label>
                <Input type="number" value={challanForm.total_tax || ""} onChange={e => setChallanForm(p => ({ ...p, total_tax: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Surcharge</Label>
                <Input type="number" value={challanForm.surcharge || ""} onChange={e => setChallanForm(p => ({ ...p, surcharge: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Cess</Label>
                <Input type="number" value={challanForm.education_cess || ""} onChange={e => setChallanForm(p => ({ ...p, education_cess: e.target.value }))} />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Interest</Label>
                <Input type="number" value={challanForm.interest || ""} onChange={e => setChallanForm(p => ({ ...p, interest: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Late Fees u/s 234E</Label>
                <Input type="number" value={challanForm.late_fees_234e || ""} onChange={e => setChallanForm(p => ({ ...p, late_fees_234e: e.target.value }))} placeholder="0" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Others</Label>
                <Input type="number" value={challanForm.others || ""} onChange={e => setChallanForm(p => ({ ...p, others: e.target.value }))} />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Total (auto)</Label>
              <Input readOnly className="bg-muted font-semibold" value={`₹${challanTotal.toLocaleString("en-IN")}`} />
            </div>
            <div className="flex items-center gap-3 pt-1">
              <Switch checked={challanForm.is_book_entry || false} onCheckedChange={v => setChallanForm(p => ({ ...p, is_book_entry: v }))} />
              <Label className="text-xs">Book Entry (Govt Payment)</Label>
            </div>
            {challanForm.is_book_entry && (
              <div className="space-y-1">
                <Label className="text-xs">Transfer Voucher No</Label>
                <Input value={challanForm.transfer_voucher_no || ""} onChange={e => setChallanForm(p => ({ ...p, transfer_voucher_no: e.target.value }))} />
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Bank Name</Label>
                <Input
                  value={challanForm.bank_name || ""}
                  onChange={e => setChallanForm(p => ({ ...p, bank_name: e.target.value }))}
                  placeholder="e.g. ICICI Bank"
                />
                {challanForm.bank_name && /^[\d,.\s]+$/.test(challanForm.bank_name.trim()) && (
                  <p className="text-[10px] text-destructive">Bank Name should not be a number. Enter the bank's name (e.g. HDFC Bank, SBI) or leave blank.</p>
                )}
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Section</Label>
                <Select value={challanForm.section_code || "none"} onValueChange={v => setChallanForm(p => ({ ...p, section_code: v === "none" ? "" : v }))}>
                  <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— None —</SelectItem>
                    {sectionOptionsFor(challanForm.section_code).map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Remarks</Label>
              <Textarea value={challanForm.remarks || ""} onChange={e => setChallanForm(p => ({ ...p, remarks: e.target.value }))} rows={2} />
            </div>

          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setChallanDialogOpen(false)}>Cancel</Button>
            <Button onClick={saveChallan}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Kasar-Vatav — close out a small unattachable residual balance as a
          deliberate, attributed write-off instead of leaving the challan
          "Unconsumed" forever. */}
      <Dialog open={!!kasarVatavDialogChallan} onOpenChange={open => { if (!open) closeKasarVatavDialog(); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Kasar-Vatav Adjustment</DialogTitle>
          </DialogHeader>
          {kasarVatavDialogChallan && (() => {
            const c = kasarVatavDialogChallan;
            const bd = getChallanBreakdownAll(c.id);
            const allocatable = bd.allocatable;
            const existing = c.kasar_vatav_amount || 0;
            // The gap before ANY kasar-vatav write-off — see openKasarVatavDialog's
            // own comment on why the existing amount is added back.
            const rawUnconsumed = bd.unconsumed + existing;
            return (
              <div className="space-y-3">
                <div className="rounded-md bg-muted/40 p-2.5 text-xs space-y-1">
                  <div className="flex justify-between"><span className="text-muted-foreground">Challan</span><span className="font-mono">{c.bsr_code || "—"} / {c.challan_serial_no || "—"}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Allocatable</span><span>₹{allocatable.toLocaleString("en-IN")}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Applied (deductees)</span><span>₹{bd.applied.toLocaleString("en-IN")}</span></div>
                  <div className="flex justify-between font-semibold"><span>Unconsumed balance</span><span className="text-amber-600">₹{rawUnconsumed.toLocaleString("en-IN")}</span></div>
                  {existing > 0 && (
                    <div className="pt-1 mt-1 border-t border-border/50 text-[11px] text-muted-foreground">
                      Current adjustment: ₹{existing.toLocaleString("en-IN")}
                      {c.kasar_vatav_note ? ` — "${c.kasar_vatav_note}"` : ""}
                      {c.kasar_vatav_at ? ` · ${format(new Date(c.kasar_vatav_at), "dd MMM yyyy")}` : ""}
                    </div>
                  )}
                </div>

                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs">Adjustment Amount (₹)</Label>
                    <button
                      type="button"
                      className="text-[10px] text-primary hover:underline"
                      onClick={() => setKasarVatavAmountInput(String(rawUnconsumed))}
                    >
                      Use full balance (₹{rawUnconsumed.toLocaleString("en-IN")})
                    </button>
                  </div>
                  <Input
                    type="number" step="0.01" min={0} max={rawUnconsumed}
                    value={kasarVatavAmountInput}
                    onChange={e => setKasarVatavAmountInput(e.target.value)}
                  />
                </div>

                <div className="space-y-1">
                  <Label className="text-xs">Reason / Remarks</Label>
                  <Textarea
                    value={kasarVatavNoteInput}
                    onChange={e => setKasarVatavNoteInput(e.target.value)}
                    placeholder="e.g. Residual round-off, not recoverable — write off to close the challan."
                    rows={2}
                  />
                </div>

                <p className="text-[10px] text-muted-foreground">
                  Recorded separately from actual TDS/interest/surcharge, and logged to the Audit Log.
                  {existing > 0 ? " Use “Remove Adjustment” below to reverse it." : ""}
                </p>
              </div>
            );
          })()}
          <DialogFooter>
            {(kasarVatavDialogChallan?.kasar_vatav_amount || 0) > 0 && (
              <Button variant="outline" className="mr-auto border-destructive/40 text-destructive hover:bg-destructive/10" onClick={removeKasarVatav} disabled={kasarVatavSaving}>
                {kasarVatavSaving ? <Loader2 size={14} className="animate-spin mr-1" /> : null}
                Remove Adjustment
              </Button>
            )}
            <Button variant="outline" onClick={closeKasarVatavDialog} disabled={kasarVatavSaving}>Cancel</Button>
            <Button onClick={submitKasarVatav} disabled={kasarVatavSaving}>
              {kasarVatavSaving ? <Loader2 size={14} className="animate-spin mr-1" /> : null}
              Save Adjustment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 24Q Salary Drawer */}
      <Sheet open={salaryDrawerOpen} onOpenChange={setSalaryDrawerOpen}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Salary Computation — {salaryDeductee?.deductee_name || "Employee"}</SheetTitle>
          </SheetHeader>
          <div className="py-4 space-y-4">
            <div className="flex items-center gap-3">
              <Label className="text-xs">Tax Regime:</Label>
              <Select value={taxRegime} onValueChange={(v) => {
                setTaxRegime(v as "new" | "old");
                setSalaryForm(p => ({ ...p, standard_deduction: v === "new" ? 75000 : 50000 }));
              }}>
                <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="new">New Regime (Default)</SelectItem>
                  <SelectItem value="old">Old Regime</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase">Income Details</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Designation</Label>
                  <Input value={salaryForm.designation || ""} onChange={e => setSalaryForm(p => ({ ...p, designation: e.target.value }))} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Gross Salary</Label>
                  <Input type="number" value={salaryForm.gross_salary || ""} onChange={e => setSalaryForm(p => ({ ...p, gross_salary: e.target.value }))} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Standard Deduction ({taxRegime === "new" ? "₹75,000" : "₹50,000"})</Label>
                  <Input type="number" value={salaryForm.standard_deduction || ""} onChange={e => setSalaryForm(p => ({ ...p, standard_deduction: e.target.value }))} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Professional Tax</Label>
                  <Input type="number" value={salaryForm.professional_tax || ""} onChange={e => setSalaryForm(p => ({ ...p, professional_tax: e.target.value }))} />
                </div>
              </div>
            </div>
            {taxRegime === "old" && (
              <div className="space-y-3 border-t pt-3">
                <p className="text-xs font-semibold text-muted-foreground uppercase">Chapter VI-A Deductions</p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1"><Label className="text-xs">80C</Label><Input type="number" value={salaryForm.chapter_via_80c || ""} onChange={e => setSalaryForm(p => ({ ...p, chapter_via_80c: e.target.value }))} /></div>
                  <div className="space-y-1"><Label className="text-xs">80D</Label><Input type="number" value={salaryForm.chapter_via_80d || ""} onChange={e => setSalaryForm(p => ({ ...p, chapter_via_80d: e.target.value }))} /></div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1"><Label className="text-xs">80G</Label><Input type="number" value={salaryForm.chapter_via_80g || ""} onChange={e => setSalaryForm(p => ({ ...p, chapter_via_80g: e.target.value }))} /></div>
                  <div className="space-y-1"><Label className="text-xs">Other</Label><Input type="number" value={salaryForm.chapter_via_other || ""} onChange={e => setSalaryForm(p => ({ ...p, chapter_via_other: e.target.value }))} /></div>
                </div>
              </div>
            )}
            <div className="space-y-3 border-t pt-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase">Other Income</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1"><Label className="text-xs">Other Sources</Label><Input type="number" value={salaryForm.income_other_sources || ""} onChange={e => setSalaryForm(p => ({ ...p, income_other_sources: e.target.value }))} /></div>
                <div className="space-y-1"><Label className="text-xs">House Property</Label><Input type="number" value={salaryForm.income_house_property || ""} onChange={e => setSalaryForm(p => ({ ...p, income_house_property: e.target.value }))} /></div>
              </div>
              <div className="space-y-1"><Label className="text-xs">TDS by Previous Employer</Label><Input type="number" value={salaryForm.tds_previous_employer || ""} onChange={e => setSalaryForm(p => ({ ...p, tds_previous_employer: e.target.value }))} /></div>
            </div>
            <div className="border-t pt-3 space-y-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase">Tax Computation</p>
              <div className="bg-muted/50 rounded-md p-3 space-y-1 text-sm">
                {computedSalaryTax.hasGross ? (
                  <>
                    <div className="flex justify-between"><span>Net Salary</span><span className="font-mono">₹{computedSalaryTax.netSalary.toLocaleString("en-IN")}</span></div>
                    <div className="flex justify-between"><span>Total Taxable Income</span><span className="font-mono font-semibold">₹{computedSalaryTax.totalIncome.toLocaleString("en-IN")}</span></div>
                    <div className="flex justify-between border-t pt-1 mt-1"><span>Tax Payable (incl. 4% cess)</span><span className="font-mono font-bold text-primary">₹{computedSalaryTax.tax.toLocaleString("en-IN")}</span></div>
                    <div className="flex justify-between"><span>Less: Previous TDS</span><span className="font-mono">₹{(parseFloat(salaryForm.tds_previous_employer) || 0).toLocaleString("en-IN")}</span></div>
                    <div className="flex justify-between border-t pt-1 mt-1"><span className="font-semibold">Balance Tax</span><span className="font-mono font-bold">₹{computedSalaryTax.balanceTax.toLocaleString("en-IN")}</span></div>
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground">Enter Gross Salary to compute Net Salary, Total Taxable Income and Tax Payable.</p>
                )}
              </div>
            </div>
          </div>
          <SheetFooter>
            <Button variant="outline" onClick={() => setSalaryDrawerOpen(false)}>Cancel</Button>
            <Button onClick={saveSalaryDetails}>Save & Apply</Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
}
