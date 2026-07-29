import { useState, useEffect, useCallback, useMemo, useRef, useLayoutEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { isQuarterInTdsRange, clientHasTdsForm } from "@/lib/tdsQuarter";
import {
  PAN_4TH_CHAR_MAP, isValidPan, isIndividualRateType, getRateForSection as getRateForSectionPure,
  calcAutoInterest, isChallanOverApplied, isChallanFullyUtilised, computeApplied, balanceColorClass,
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
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import {
  Plus, Trash2, Pencil, AlertTriangle, CheckCircle2,
  CreditCard, RefreshCw, ArrowRight, RotateCcw, Lock, FileText, Loader2, FileSpreadsheet, Upload,
} from "lucide-react";
import { generateGeniusExport } from "@/lib/genius-export";
import { importGeniusXls, repairFilingSectionCodes } from "@/lib/genius-import";
import { markUnderProcessIfNotStarted } from "@/lib/tds/filingActivity";
import { logReconAudit } from "@/lib/tdsReconAudit";

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
}

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
export function TdsDataEntry({
  clients, users, isSuperadmin, resolveFirmId,
  selClient, setSelClient, selFy, setSelFy, selQuarter, setSelQuarter, selForm, setSelForm,
}: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  // Display name for the acting user on audit-log entries — resolved from the
  // already-fetched `users` list (same pattern as other TDS screens), no
  // separate fetch needed.
  const currentUserName = useMemo(
    () => users.find(u => u.id === user?.id)?.name || null,
    [users, user?.id]
  );

  // Client/FY/Quarter/Form are the SHARED Workspace context (owned by the parent),
  // so a return selected here is already loaded when the user opens Validate & Finalise.
  const [clientSearch, setClientSearch] = useState("");
  const [filingLoaded, setFilingLoaded] = useState(false);

  const [filing, setFiling] = useState<TdsFiling | null>(null);
  const [challans, setChallans] = useState<Challan[]>([]);
  const [deductees, setDeductees] = useState<Deductee[]>([]); // current quarter entries
  const [prevEntries, setPrevEntries] = useState<Deductee[]>([]); // previous quarter entries (carry-forward, read-only)
  const [allChallanDeductees, setAllChallanDeductees] = useState<Record<string, Deductee[]>>({});
  const [carryForwardChallans, setCarryForwardChallans] = useState<{ challan: Challan; fromQuarter: string; fromFy: string; appliedAmount: number }[]>([]);
  const [selectedChallan, setSelectedChallan] = useState<Challan | null>(null);
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
    const { data } = await supabase.from("tds_rate_master").select("section_code, nature_of_payment, rate_individual, rate_company, rate_no_pan, threshold_individual, threshold_company, effective_from, effective_to")
      .eq("form_type", selForm).eq("financial_year", selFy).eq("is_active", true);
    setRateMaster((data || []) as RateEntry[]);
  }, [selForm, selFy]);

  useEffect(() => { fetchRates(); }, [fetchRates, selFy]);

  // Any Data Entry activity on a fresh filing auto-advances it out of
  // "Not Started" — the user shouldn't have to separately remember to flip
  // the Dashboard's Status dropdown just to reflect that work has begun.
  const bumpUnderProcess = useCallback(async () => {
    if (!filing) return;
    const flipped = await markUnderProcessIfNotStarted(filing.id, filing.work_status, user?.id);
    if (flipped) setFiling(prev => (prev ? { ...prev, work_status: "Under Process" } : prev));
  }, [filing, user?.id]);

  // ─── Load Filing (Issue 6: try-catch, never crash, empty state on error) ───
  const loadFiling = useCallback(async () => {
    if (!selClient) { toast({ title: "Select a client", variant: "destructive" }); return; }
    setLoading(true);
    setFilingLoaded(false);

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
  }, [selClient, selFy, selQuarter, selForm, clients]);

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
  }, [selClient, selFy, selQuarter, selForm]); // loadFiling/resetFiling intentionally omitted — stable callbacks

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

    // Query challans by stable metadata (client_id) rather than walking
    // filing_id → prior filings. A challan's filing_id can drift if its
    // owning filing was deleted and re-created, which would cause the old
    // filing_id→filings lookup to silently skip the challan. Querying
    // directly on the challan's own quarter/FY columns is drift-proof.
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
    const { data: priorChallansRaw } = await supabase.from("tds_challans").select("*")
      .eq("client_id", clientId)
      .order("deposit_date", { ascending: true });

    const priorChallans = ((priorChallansRaw as unknown as Challan[]) || []).filter(c =>
      c.quarter && c.financial_year &&
      periodToNum(c.financial_year, c.quarter) < currentPeriod
    );
    if (priorChallans.length === 0) { setCarryForwardChallans([]); return; }

    const challanIds = priorChallans.map(c => c.id);
    // Fetch FULL deductee rows (not just sum fields) so we can merge them into
    // allChallanDeductees — getChallanBreakdownAll looks up deductees from that
    // map to compute 'Used (all Q)' for carry-forward challans.
    const { data: allDeds } = await supabase.from("tds_deductees")
      .select("*")
      .in("challan_id", challanIds);

    // Track which prior challans have CURRENT-QUARTER utilisation — i.e.,
    // deductees whose quarter+FY matches the currently-selected quarter.
    // These challans must be shown in the Carry-Forward list even if they
    // are "fully utilised overall", so the user can view/edit the current-
    // quarter entries attached to them.
    const currentQUsage = new Set<string>();
    const appliedMap = new Map<string, number>();
    const cfGrouped: Record<string, Deductee[]> = {};
    (allDeds || []).forEach((d: any) => {
      const applied = (d.total_tax_deducted || d.tds_amount || 0) + (d.interest_amount || 0) + (d.surcharge_amount || 0);
      appliedMap.set(d.challan_id, (appliedMap.get(d.challan_id) || 0) + applied);
      if (!cfGrouped[d.challan_id]) cfGrouped[d.challan_id] = [];
      cfGrouped[d.challan_id].push(d as Deductee);
      if (d.quarter === quarter && d.financial_year === fy) {
        currentQUsage.add(d.challan_id);
      }
    });

    const carried: { challan: Challan; fromQuarter: string; fromFy: string; appliedAmount: number }[] = [];
    priorChallans.forEach((c: any) => {
      const applied = appliedMap.get(c.id) || 0;
      const unconsumed = (c.total_challan_amount || 0) - applied - (c.late_fees_234e || 0);
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

  const fetchChallans = async (filingId: string) => {
    // Query by the stable logical key (client+FY+quarter+form) rather than
    // just filing_id. filing_id is a UUID that can drift if the filing row
    // was re-created (e.g., after a prior delete) — its challans would then
    // be orphaned and disappear from the UI while still existing in the DB.
    // Self-heal any stale filing_id back to the current one so future queries
    // match strictly too.
    const { data } = await supabase.from("tds_challans").select("*")
      .eq("client_id", selClient)
      .eq("form_type", selForm)
      .eq("financial_year", selFy)
      .eq("quarter", selQuarter)
      .order("deposit_date", { ascending: true });
    const ownList = (data as unknown as Challan[]) || [];

    // Self-heal filing_id drift — ONLY for this form's OWN challans. A SHARED
    // challan (below) legitimately belongs to a different form's filing_id;
    // overwriting that here would sever it from the return that actually
    // created it.
    const stale = ownList.filter(c => c.filing_id !== filingId);
    if (stale.length > 0) {
      console.log(`[TDS] Repairing filing_id on ${stale.length} challan(s) for ${selFy} ${selQuarter} ${selForm}`);
      const { error: fixErr } = await supabase.from("tds_challans")
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
    const { data: sharedDeds } = await supabase.from("tds_deductees").select("challan_id")
      .eq("client_id", selClient).eq("form_type", selForm)
      .eq("financial_year", selFy).eq("quarter", selQuarter);
    const ownIds = new Set(ownList.map(c => c.id));
    const sharedIds = Array.from(new Set((sharedDeds || []).map((d: any) => d.challan_id as string)))
      .filter(id => !ownIds.has(id));
    let sharedList: Challan[] = [];
    if (sharedIds.length > 0) {
      const { data: sharedChallans } = await supabase.from("tds_challans").select("*").in("id", sharedIds);
      sharedList = (sharedChallans as unknown as Challan[]) || [];
    }

    const list = [...ownList, ...sharedList].sort((a, b) =>
      (a.deposit_date || "").localeCompare(b.deposit_date || ""));

    setChallans(list);
    if (list.length > 0) {
      const challanIds = list.map(c => c.id);
      const { data: allDeds } = await supabase.from("tds_deductees").select("*")
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
    const { data } = await supabase.from("tds_deductees").select("*")
      .eq("challan_id", challanId).order("created_at", { ascending: true });
    const list = (data || []) as Deductee[];
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
    if (!filing) return;
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
      .from("tds_challans")
      .select("id, filing_id, financial_year, quarter, form_type, client_id, bsr_code")
      .eq("challan_serial_no", challanForm.challan_serial_no);
    if (editingChallan?.id) dupQuery.neq("id", editingChallan.id);
    const { data: dupRows } = await dupQuery.limit(1);
    if (dupRows && dupRows.length > 0) {
      const d = dupRows[0] as any;
      const sameClient = d.client_id === filing.client_id;
      const whereMsg = sameClient
        ? `${d.form_type} ${d.quarter} ${d.financial_year} of this client`
        : `another client's ${d.form_type} ${d.quarter} ${d.financial_year} filing`;
      toast({
        title: "Duplicate Challan Number",
        description: `Challan Number ${challanForm.challan_serial_no} already exists in ${whereMsg} (BSR ${d.bsr_code}). Each Challan Number is globally unique — its balance flows to later quarters via Carry-Forward, don't re-add the challan.`,
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
        return supabase.from("tds_challans").update(p).eq("id", editingChallan.id);
      } else {
        return supabase.from("tds_challans").insert(p);
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
        return;
      }
    }
    if (error) { toast({ title: "Error saving challan", description: error.message, variant: "destructive" }); return; }
    toast({ title: editingChallan ? "Challan updated" : "Challan added" });
    setChallanDialogOpen(false);
    auditChallanCreate();
    await refreshChallansAndCF(filing.id);
    await bumpUnderProcess();
  };

  const deleteChallan = async (id: string) => {
    const { error } = await supabase.from("tds_challans").delete().eq("id", id);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Challan deleted" });
    if (filing) await refreshChallansAndCF(filing.id);
    await bumpUnderProcess();
  };

  // ─── Deductee CRUD ───
  const addDeducteeRow = async () => {
    if (!selectedChallan || !filing || isFilingLocked) return;
    // Issue 7F: Block add when challan balance = 0
    const bd = getChallanBreakdownAll(selectedChallan.id);
    const balance = (selectedChallan.total_challan_amount || 0) - bd.applied;
    if (balance <= 0) {
      toast({ title: "Challan fully utilized", description: "No remaining balance in this challan to add more entries.", variant: "destructive" });
      return;
    }
    const firmId = await resolveFirmId();
    const defaultSection = selectedChallan.section_code || "";
    const { rate } = getRateForSection(defaultSection);
    const { data, error } = await supabase.from("tds_deductees").insert({
      challan_id: selectedChallan.id, filing_id: filing.id,
      client_id: filing.client_id, firm_id: firmId || filing.firm_id,
      form_type: selForm, financial_year: selFy, quarter: selQuarter,
      deductee_name: "", section_code: defaultSection,
      surcharge_amount: 0, cess_amount: 0, interest_amount: 0, late_fees_amount: 0,
      pan_not_available: false, rate_of_tds: rate,
    } as any).select("*").single();
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    const newDed = data as Deductee;
    setDeductees(prev => [...prev, newDed]);
    // Update allChallanDeductees too
    setAllChallanDeductees(prev => ({
      ...prev,
      [selectedChallan.id]: [...(prev[selectedChallan.id] || []), newDed],
    }));
    await bumpUnderProcess();
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

    const { error } = await supabase.from("tds_deductees").update(updates).eq("id", deducteeId);
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
    const merged = { ...deductee, ...updates };
    setDeductees(prev => prev.map(d => d.id === deducteeId ? merged : d));
    // Issue 7G: sync allChallanDeductees for instant balance update
    if (selectedChallan) {
      setAllChallanDeductees(prev => ({
        ...prev,
        [selectedChallan.id]: (prev[selectedChallan.id] || []).map(d => d.id === deducteeId ? merged : d),
      }));
    }
    await bumpUnderProcess();
  };

  // Issue 7I: Delete + instant recalculation
  const deleteDeductee = async (id: string) => {
    if (isFilingLocked) return;
    const { error } = await supabase.from("tds_deductees").delete().eq("id", id);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    setDeductees(prev => prev.filter(d => d.id !== id));
    // Issue 7I: Instantly update allChallanDeductees for balance recalc
    if (selectedChallan) {
      setAllChallanDeductees(prev => ({
        ...prev,
        [selectedChallan.id]: (prev[selectedChallan.id] || []).filter(d => d.id !== id),
      }));
      // Issue 7D: if challan was fully_utilized, re-enable it
      if (selectedChallan.fully_utilized) {
        await supabase.from("tds_challans").update({ fully_utilized: false } as any).eq("id", selectedChallan.id);
        setSelectedChallan(prev => prev ? { ...prev, fully_utilized: false } : prev);
      }
    }
    await bumpUnderProcess();
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
    const { error } = await supabase.from("tds_deductees").update(updates).eq("id", salaryDeductee.id);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    setDeductees(prev => prev.map(d => d.id === salaryDeductee.id ? { ...d, ...updates } : d));
    setSalaryDrawerOpen(false);
    toast({ title: "Salary details saved" });
    await bumpUnderProcess();
  };

  // ─── Challan breakdown (Issue 7A: cross-quarter total) ───
  const getChallanBreakdownAll = useCallback((challanId: string) => {
    // Use ALL entries across all quarters for accurate balance (7A)
    const allForChallan = challanId === selectedChallan?.id
      ? [...prevEntries, ...deductees]
      : (allChallanDeductees[challanId] || []);
    const challanObj = challans.find(c => c.id === challanId)
      || (selectedChallan?.id === challanId ? selectedChallan : null)
      || carryForwardChallans.find(cf => cf.challan.id === challanId)?.challan || null;
    const { tds, interest, surcharge, applied } = computeApplied(allForChallan);
    const lateFees = (challanObj as Challan | null)?.late_fees_234e || 0;
    // Issue 4: Late fees are a separate govt levy — exclude from allocatable TDS amount
    return { tds, interest, surcharge, lateFees, applied, count: allForChallan.length };
  }, [selectedChallan, prevEntries, deductees, allChallanDeductees, challans, carryForwardChallans]);

  // Keep getChallanBreakdown as alias for backward compat
  const getChallanBreakdown = getChallanBreakdownAll;

  const challanDeducteeTds = useMemo(() => {
    if (!selectedChallan) return 0;
    return getChallanBreakdownAll(selectedChallan.id).applied;
  }, [deductees, prevEntries, selectedChallan, allChallanDeductees, getChallanBreakdownAll]);

  const summaryStats = useMemo(() => {
    const allCurrentDeds = deductees; // current quarter only for summary
    const totalChallans = challans.length;
    const totalDeductees = allCurrentDeds.length;
    const totalPayment = allCurrentDeds.reduce((s, d) => s + (d.amount_paid_credited || 0), 0);
    const totalTds = allCurrentDeds.reduce((s, d) => s + Math.round(d.total_tax_deducted || d.tds_amount || 0), 0);
    const totalInterest = allCurrentDeds.reduce((s, d) => s + (d.interest_amount || 0), 0);
    const totalLateFees = allCurrentDeds.reduce((s, d) => s + (d.late_fees_amount || 0), 0);
    return { totalChallans, totalDeductees, totalPayment, totalTds, totalInterest, totalLateFees };
  }, [challans, deductees]);

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
  const [nameColWidth, setNameColWidth] = useState(220);
  const [panColWidth, setPanColWidth] = useState(120);

  useLayoutEffect(() => {
    const nameEl = nameMeasureRef.current;
    const panEl = panMeasureRef.current;
    if (!nameEl || !panEl) return;
    const sampleNameInput = document.querySelector('[data-autofit="name"]');
    const samplePanInput = document.querySelector('[data-autofit="pan"]');
    if (sampleNameInput) nameEl.style.font = getComputedStyle(sampleNameInput).font;
    if (samplePanInput) panEl.style.font = getComputedStyle(samplePanInput).font;
    const rows = [...prevEntries, ...deductees];
    const nameHeaderLabel = selForm === "24Q" ? "Employee Name" : selForm === "27EQ" ? "Collectee" : "Name";
    // TableCell padding (16px × 2) + Input's own padding (12px × 2) + border (1px × 2) + slack
    const CELL_PADDING = 70;

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

    setNameColWidth(Math.max(120, Math.min(560, Math.ceil(maxName) + CELL_PADDING)));
    setPanColWidth(Math.max(90, Math.min(200, Math.ceil(maxPan) + CELL_PADDING)));
  }, [deductees, prevEntries, selForm]);

  const autoMatchChallans = () => {
    if (isFilingLocked) return;
    const challanTotMap = new Map<string, number>();
    deductees.forEach(d => {
      const rowTotal = Math.round(d.total_tax_deducted || d.tds_amount || 0) + (d.interest_amount || 0) + (d.late_fees_amount || 0) + (d.surcharge_amount || 0);
      challanTotMap.set(d.challan_id, (challanTotMap.get(d.challan_id) || 0) + rowTotal);
    });
    const matched: string[] = [], unmatched: string[] = [];
    challans.forEach(c => {
      const entered = challanTotMap.get(c.id) || 0;
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
    const { data, error } = await supabase.from("tds_deductees").insert({
      ...rest,
      firm_id: firmId || filing.firm_id,
    } as any).select("*").single();
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    setDeductees(prev => [...prev, data as Deductee]);
    toast({ title: "Row duplicated" });
    await bumpUnderProcess();
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
    return balanceColorClass(bd.applied, challan.total_challan_amount || 0);
  };

  const client = clients.find(c => c.id === selClient);
  const isFilingLocked = filing?.work_status === "Filed";

  // Issue 1: Row-level read-only check
  const isRowReadOnly = (d: Deductee) => isFilingLocked || (filing ? d.filing_id !== filing.id : false);

  const sectionOptions = useMemo(() => {
    return rateMaster.map(r => ({ value: r.section_code, label: `${r.section_code} — ${r.nature_of_payment || ""}` }));
  }, [rateMaster]);

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

  // Challan balance for selected challan (Issue 7F)
  const selectedChallanBalance = useMemo(() => {
    if (!selectedChallan) return 0;
    const bd = getChallanBreakdownAll(selectedChallan.id);
    // Issue 4: allocatable = total - late_fees (late fees excluded from TDS allocation)
    const allocatable = (selectedChallan.total_challan_amount || 0) - (selectedChallan.late_fees_234e || 0);
    return Math.max(0, allocatable - bd.applied);
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
    importFileInputRef.current?.click();
  };

  const handleGeniusImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Reset so picking the same file again still triggers onChange
    if (importFileInputRef.current) importFileInputRef.current.value = "";
    if (!file) return;
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
    } catch (err: any) {
      console.error("[GeniusImport] Failed:", err);
      toast({
        title: "Import failed",
        description: err?.message || String(err),
        variant: "destructive",
      });
    } finally {
      setImportLoading(false);
    }
  };

  // ─── Render ───
  return (
    <div className="space-y-4">
      {/* ── CP-03: Filing Selector — always visible, auto-loads on change ── */}
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
            <Select value={selClient} onValueChange={v => { setSelClient(v); setClientSearch(""); }}>
              <SelectTrigger className="w-[220px]"><SelectValue placeholder="Select client" /></SelectTrigger>
              <SelectContent>
                <div className="px-2 pb-1 pt-1 sticky top-0 bg-popover z-10">
                  <Input
                    placeholder="Search client…"
                    value={clientSearch}
                    onChange={e => setClientSearch(e.target.value)}
                    onKeyDown={e => e.stopPropagation()}
                    className="h-7 text-xs"
                  />
                </div>
                {clients
                  .filter(c => clientHasTdsForm(c.tds_forms_applicable, selForm))
                  .filter(c => !clientSearch || (c.name || "").toLowerCase().includes(clientSearch.toLowerCase()))
                  .map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)
                }
                {clients
                  .filter(c => clientHasTdsForm(c.tds_forms_applicable, selForm))
                  .filter(c => !clientSearch || (c.name || "").toLowerCase().includes(clientSearch.toLowerCase())).length === 0 && (
                  <div className="py-4 text-center text-xs text-muted-foreground">No clients found</div>
                )}
              </SelectContent>
            </Select>
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
                "bg-emerald-100 text-emerald-700": filing.work_status === "Filed",
              })}>{filing.work_status}</Badge>
              {isFilingLocked && (
                <Badge className="text-xs bg-amber-100 text-amber-800 border border-amber-300 gap-1">
                  <Lock size={10} /> Data Entry Locked — Filed
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
                disabled={importLoading || exportLoading}
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

      {filing && (
        <>
          {/* Issue 1: Prominent lock banner */}
          {isFilingLocked && (
            <div className="flex items-center gap-3 px-4 py-3 rounded-lg bg-amber-50 border-2 border-amber-300 text-amber-900 text-sm font-medium">
              <Lock size={16} className="shrink-0" />
              <span>This filing is <strong>Filed</strong>. All data is read-only. Change status in Filings list to unlock.</span>
            </div>
          )}

          <div className="space-y-3">
            {/* Challan strip — horizontal, single row (was a 30%-width vertical sidebar) */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-foreground">Challans</h3>
                {/* Issue 2: Hide Add Challan when filed */}
                {!isFilingLocked && (
                  <Button size="sm" variant="outline" className="gap-1 h-7 text-xs" onClick={openAddChallan}>
                    <Plus size={12} /> Add Challan
                  </Button>
                )}
              </div>

              {/* Carry-forward challans (Issue 7H: show origin quarter/FY) */}
              {carryForwardChallans.length > 0 && (
                <div className="space-y-1">
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Carried Forward</p>
                  <div className="flex gap-2 overflow-x-auto pb-1">
                    {carryForwardChallans.map(cf => {
                      const bd = getChallanBreakdownAll(cf.challan.id);
                      const avail = Math.max(0, (cf.challan.total_challan_amount || 0) - bd.applied);
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
                                  <div className="flex items-center gap-1.5 flex-wrap">
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
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      );
                    })}
                  </div>
                </div>
              )}

              {challans.length === 0 && carryForwardChallans.length === 0 ? (
                <Card className="border-dashed">
                  <CardContent className="py-6 text-center text-muted-foreground text-sm">
                    {isFilingLocked ? "Filed — no challans can be added." : "No challans yet. Add your first challan."}
                  </CardContent>
                </Card>
              ) : challans.length > 0 && (
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {challans.map(c => {
                    const bd = getChallanBreakdownAll(c.id);
                    // Issue 4: Late fees excluded from allocatable amount (they are a separate govt levy)
                    const allocatable = (c.total_challan_amount || 0) - (c.late_fees_234e || 0);
                    const lateFeeBalance = (c.late_fees_234e || 0) - (c.late_fees_used || 0);
                    return (
                      <TooltipProvider key={c.id}>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Card
                              className={cn("cursor-pointer transition-all hover:shadow-sm flex-shrink-0 w-60",
                                selectedChallan?.id === c.id ? "border-primary ring-1 ring-primary/30" : "",
                                isFilingLocked ? "bg-muted/50" : "")}
                              onClick={() => selectChallan(c)}>
                              <CardContent className="p-2.5 space-y-1">
                                <div className="flex items-start justify-between gap-1">
                                  <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                                    <CreditCard size={12} className="text-primary shrink-0" />
                                    <span className="text-xs font-semibold font-mono truncate">{c.bsr_code || "No BSR"}</span>
                                    {c.section_code && <Badge variant="outline" className="text-[9px] px-1">{c.section_code}</Badge>}
                                    {/* Combined-payment challan: same bank challan funding more than one
                                        form — this row was created under c.form_type, not the form
                                        currently open, but its Applied/Available below already includes
                                        every form's usage. */}
                                    {c.form_type !== selForm && (
                                      <Badge variant="outline" className="text-[9px] px-1 border-primary/40 text-primary">
                                        Shared with {c.form_type}
                                      </Badge>
                                    )}
                                  </div>
                                  {/* Issue 2: Hide Edit/Delete when filed */}
                                  {!isFilingLocked && (
                                    <div className="flex gap-0.5 shrink-0">
                                      <Button variant="ghost" size="icon" className="h-5 w-5" onClick={e => { e.stopPropagation(); openEditChallan(c); }}>
                                        <Pencil size={10} />
                                      </Button>
                                      <Button variant="ghost" size="icon" className="h-5 w-5" onClick={e => { e.stopPropagation(); deleteChallan(c.id); }}>
                                        <Trash2 size={10} className="text-destructive" />
                                      </Button>
                                    </div>
                                  )}
                                </div>
                                <p className="text-[10px] text-muted-foreground truncate">
                                  {c.deposit_date ? format(new Date(c.deposit_date), "dd MMM yyyy") : "No date"}
                                  {c.challan_serial_no && ` • No: ${c.challan_serial_no}`}
                                </p>
                                <div className={cn("flex items-center justify-between text-[10px] font-semibold",
                                  isChallanOverApplied(bd.applied, allocatable) ? "text-destructive" : isChallanFullyUtilised(bd.applied, allocatable) ? "text-emerald-600" : "text-amber-600")}>
                                  <span>{isChallanOverApplied(bd.applied, allocatable) ? "Over-applied" : isChallanFullyUtilised(bd.applied, allocatable) ? "Fully Utilised" : "Unconsumed"}</span>
                                  <span>₹{bd.applied.toLocaleString("en-IN")}/₹{(c.total_challan_amount || 0).toLocaleString("en-IN")}</span>
                                </div>
                                <div className="w-full h-1.5 rounded-full bg-muted overflow-hidden">
                                  <div className={cn("h-full rounded-full transition-all", getBalanceColor(c))}
                                    style={{ width: c.total_challan_amount > 0 ? `${Math.min(100, (bd.applied / c.total_challan_amount) * 100)}%` : "0%" }} />
                                </div>
                                {isFilingLocked && (
                                  <Badge variant="secondary" className="text-[9px] gap-1"><Lock size={8} /> Filed</Badge>
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
                                          await supabase.from("tds_challans").update({ late_fees_used: val } as any).eq("id", c.id);
                                          if (filing) await refreshChallansAndCF(filing.id);
                                          await bumpUnderProcess();
                                        }}
                                      />
                                    )}
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
                            <div>Applied Total: ₹{bd.applied.toLocaleString("en-IN")}</div>
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
            <div className="space-y-3">
              {selectedChallan ? (
                <>
                  {/* Issue 1 FIX: Full Challan Details — always visible (read-only when filed) */}
                  {(() => {
                    const allocatable = (selectedChallan.total_challan_amount || 0) - (selectedChallan.late_fees_234e || 0);
                    const matchOk = isChallanFullyUtilised(challanDeducteeTds, allocatable);
                    const overApplied = isChallanOverApplied(challanDeducteeTds, allocatable);
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
                            <span className="text-muted-foreground">Deductees: <strong>{deductees.length + prevEntries.length}</strong></span>
                            <span className={cn("font-semibold",
                              matchOk ? "text-emerald-600"
                                : challanDeducteeTds < allocatable ? "text-amber-600"
                                : "text-destructive")}>
                              Applied: ₹{challanDeducteeTds.toLocaleString("en-IN")} / ₹{allocatable.toLocaleString("en-IN")}
                              {matchOk
                                ? <CheckCircle2 size={12} className="inline ml-1" />
                                : <AlertTriangle size={12} className="inline ml-1" />}
                            </span>
                            {overApplied ? (
                              <Badge className="text-[9px] bg-red-100 text-red-700">Over-applied</Badge>
                            ) : matchOk && (
                              <Badge className="text-[9px] bg-emerald-100 text-emerald-700">Fully Utilised</Badge>
                            )}
                            <div className="flex-1" />
                            {isFilingLocked && (
                              <Badge variant="secondary" className="text-[9px] gap-1"><Lock size={8} /> Filed — Read Only</Badge>
                            )}
                          </div>
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
                              {selForm === "24Q" ? (
                                <>
                                  <TableHead className="text-xs" style={{ width: nameColWidth, minWidth: nameColWidth }}>Employee Name</TableHead>
                                  <TableHead className="text-xs" style={{ width: panColWidth, minWidth: panColWidth }}>PAN</TableHead>
                                  <TableHead className="text-xs text-right" style={{ width: 110, minWidth: 110 }}>Gross</TableHead>
                                  <TableHead className="text-xs text-right" style={{ width: 90, minWidth: 90 }}>Std Ded</TableHead>
                                  <TableHead className="text-xs text-right" style={{ width: 90, minWidth: 90 }}>Taxable</TableHead>
                                  <TableHead className="text-xs text-right" style={{ width: 70, minWidth: 70 }}>TDS</TableHead>
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
                                <TableCell colSpan={selForm === "24Q" ? 9 : 12} className="py-1 px-2">
                                  {/* Dynamic label: single prev-quarter uses selQuarter/selFy helper;
                                      multi-quarter carry-forward lists all unique quarters from data */}
                                  <span className="text-[10px] font-semibold text-slate-600">
                                    {buildPrevQuarterLabel(prevEntries, selQuarter, selFy)}
                                  </span>
                                </TableCell>
                              </TableRow>
                            )}
                            {prevEntries.map((d, idx) => {
                              const colSpanVal = selForm === "24Q" ? 9 : 12;
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
                                      <TableCell><Input className="h-7 text-xs bg-muted cursor-not-allowed" disabled title={d.deductee_name} defaultValue={d.deductee_name} /></TableCell>
                                      <TableCell><Input className="h-7 text-xs font-mono bg-muted cursor-not-allowed" disabled title={d.deductee_pan || ""} defaultValue={d.deductee_pan || ""} /></TableCell>
                                      <TableCell className="text-right text-xs">{(d.gross_salary || 0).toLocaleString("en-IN")}</TableCell>
                                      <TableCell className="text-right text-xs">{(d.standard_deduction_allowed || 0).toLocaleString("en-IN")}</TableCell>
                                      <TableCell className="text-right text-xs font-medium">{d.net_taxable_salary?.toLocaleString("en-IN") || "—"}</TableCell>
                                      <TableCell className="text-right text-xs font-semibold">{d.total_tax_deducted?.toLocaleString("en-IN") || "—"}</TableCell>
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
                                <TableCell colSpan={selForm === "24Q" ? 9 : 12} className="py-1 px-2">
                                  <span className="text-[10px] font-semibold text-green-700">✅ Current Quarter Entries</span>
                                </TableCell>
                              </TableRow>
                            )}

                            {/* Current quarter entries (Issue 1: locked when filing=Filed) */}
                            {deductees.map((d, idx) => {
                              const locked = isFilingLocked;
                              return (
                                <TableRow key={d.id} className={cn(locked && "bg-muted/20")}>
                                  <TableCell className="text-xs text-muted-foreground">{idx + 1}</TableCell>
                                  {selForm === "24Q" ? (
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
                                      <TableCell className="text-right"><Input type="number" className={cn("h-7 text-xs w-24 text-right", locked && "bg-muted cursor-not-allowed opacity-75")} disabled={locked} defaultValue={d.gross_salary || ""} onBlur={e => { if (!locked) updateDeducteeField(d.id, "gross_salary", parseFloat(e.target.value) || null); }} /></TableCell>
                                      <TableCell className="text-right"><Input type="number" className={cn("h-7 text-xs w-20 text-right", locked && "bg-muted cursor-not-allowed opacity-75")} disabled={locked} defaultValue={d.standard_deduction_allowed || ""} onBlur={e => { if (!locked) updateDeducteeField(d.id, "standard_deduction_allowed", parseFloat(e.target.value) || null); }} /></TableCell>
                                      <TableCell className="text-right text-xs font-medium">{d.net_taxable_salary?.toLocaleString("en-IN") || "—"}</TableCell>
                                      <TableCell className="text-right text-xs font-semibold">{d.total_tax_deducted?.toLocaleString("en-IN") || "—"}</TableCell>
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
                                                {sectionOptions.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                                              </SelectContent>
                                            </Select>
                                          )}
                                          {d.section_code && selectedChallan?.section_code && d.section_code !== selectedChallan.section_code && (
                                            <span className="text-[9px] text-amber-600 leading-tight block">⚠ Differs from challan</span>
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
                                          const { interest, lateMonths } = calcAutoInterest(tdsAmt, payDate, depDate);

                                          // Date context for tooltip display
                                          const entryDt  = payDate ? parseLocalDate(payDate) : null;
                                          const chalDt   = depDate ? parseLocalDate(depDate) : null;
                                          const dueDt    = entryDt ? new Date(entryDt.getFullYear(), entryDt.getMonth() + 1, 7) : null;
                                          const fmtD = (dt: Date | null) =>
                                            dt ? `${String(dt.getDate()).padStart(2,"0")}/${String(dt.getMonth()+1).padStart(2,"0")}/${dt.getFullYear()}` : "—";

                                          // Determine tooltip content variant
                                          const tooltipBody = !hasDates ? (
                                            <p className="text-muted-foreground italic">Insufficient data — dates not available</p>
                                          ) : interest > 0 ? (
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
                                                {tdsAmt.toLocaleString("en-IN")} × 1.5% × {lateMonths} = ₹{interest.toLocaleString("en-IN")}
                                              </p>
                                              <p className="font-bold">Interest = ₹{interest.toLocaleString("en-IN")}</p>
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
                                                    <span className="font-medium tabular-nums text-amber-600 cursor-help underline decoration-dotted decoration-amber-400">
                                                      ₹{interest.toLocaleString("en-IN")}
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
                              );
                            })}

                            {/* Issue 7F: Add Row - disabled when balance=0 or locked */}
                            <TableRow className="bg-muted/20">
                              <TableCell colSpan={selForm === "24Q" ? 9 : 12} className="text-center py-2">
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
                    {sectionOptions.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
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
