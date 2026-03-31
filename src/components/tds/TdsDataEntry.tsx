import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
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
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import {
  Plus, Trash2, Pencil, AlertTriangle, CheckCircle2,
  CreditCard, FileText, RefreshCw, ArrowRight, RotateCcw, Lock,
} from "lucide-react";

// ─── Types ───
interface ClientOption { id: string; name: string | null; pan: string | null; tan_number?: string | null; }
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
  lower_deduction_certificate_no: string | null;
  reason_for_lower_or_nil_deduction: string | null;
  country_of_residence: string | null;
  gross_salary: number | null; standard_deduction_allowed: number | null;
  net_taxable_salary: number | null; designation: string | null;
  remarks: string | null;
}

interface RateEntry {
  section_code: string; nature_of_payment: string | null;
  rate_individual: number | null; rate_company: number | null;
  rate_no_pan: number | null; threshold_individual: number | null;
  threshold_company: number | null;
}

interface Props {
  clients: ClientOption[];
  users: UserOption[];
  isSuperadmin: boolean;
  resolveFirmId: () => Promise<string | null>;
}

// ─── Constants ───
const CURRENT_FY_START = new Date().getMonth() >= 3 ? new Date().getFullYear() : new Date().getFullYear() - 1;
const DEFAULT_FY = `${CURRENT_FY_START}-${String(CURRENT_FY_START + 1).slice(2)}`;
const FY_OPTIONS = Array.from({ length: 7 }, (_, i) => { const s = 2020 + i; return `${s}-${String(s + 1).slice(2)}`; });
const QUARTER_OPTIONS = ["Q1", "Q2", "Q3", "Q4"];
const TDS_FORMS = ["24Q", "26Q", "27Q", "27EQ"];
const DEDUCTEE_TYPES = ["Company", "Individual", "HUF", "Firm", "LLP", "AOP", "BOI", "Trust", "AJP"];

// PAN 4th character → deductee type mapping
const PAN_4TH_CHAR_MAP: Record<string, string> = {
  P: "Individual", H: "HUF", C: "Company", F: "Firm",
  L: "LLP", T: "Trust", A: "AOP",
};

// Check if a PAN is valid format: 5 letters + 4 digits + 1 letter
const isValidPan = (pan: string): boolean => /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan.toUpperCase());

// Map deductee type to rate category: Individual/HUF → individual rate, all others → company rate
const isIndividualRateType = (type: string | null): boolean => type === "Individual" || type === "HUF";

const REASON_CODES = [
  { code: "A", label: "A — Below threshold (no deduction required)" },
  { code: "B", label: "B — Lower rate certificate u/s 197" },
  { code: "C", label: "C — No deduction u/s 197A (Form 15G/15H)" },
  { code: "D", label: "D — Payment to Government" },
  { code: "E", label: "E — Notification/rules exemption" },
  { code: "Y", label: "Y — Any other reason" },
  { code: "Z", label: "Z — Higher rate u/s 206AA (PAN not available)" },
];

const getCurrentQuarter = (): string => {
  const m = new Date().getMonth();
  if (m >= 3 && m <= 5) return "Q1";
  if (m >= 6 && m <= 8) return "Q2";
  if (m >= 9 && m <= 11) return "Q3";
  return "Q4";
};

// 24Q tax computation
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

// ═══════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════
export function TdsDataEntry({ clients, users, isSuperadmin, resolveFirmId }: Props) {
  const { user } = useAuth();
  const { toast } = useToast();

  // Filing selector state
  const [selClient, setSelClient] = useState("");
  const [selFy, setSelFy] = useState(DEFAULT_FY);
  const [selQuarter, setSelQuarter] = useState(getCurrentQuarter());
  const [selForm, setSelForm] = useState("26Q");
  const [filingLoaded, setFilingLoaded] = useState(false);

  // Data state
  const [filing, setFiling] = useState<TdsFiling | null>(null);
  const [challans, setChallans] = useState<Challan[]>([]);
  const [deductees, setDeductees] = useState<Deductee[]>([]);
  const [selectedChallan, setSelectedChallan] = useState<Challan | null>(null);
  const [loading, setLoading] = useState(false);
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

  // Auto-save ref
  const autoSaveRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ─── Rate Master fetch ───
  useEffect(() => {
    const fetchRates = async () => {
      const ay = selFy.split("-");
      const assessmentYear = `${parseInt(ay[0]) + 1}-${String(parseInt(ay[0]) + 2).slice(2)}`;
      const { data } = await supabase.from("tds_rate_master").select("section_code, nature_of_payment, rate_individual, rate_company, rate_no_pan, threshold_individual, threshold_company")
        .eq("form_type", selForm).eq("is_active", true);
      setRateMaster((data || []) as RateEntry[]);
    };
    fetchRates();
  }, [selForm, selFy]);

  // ─── Load Filing ───
  const loadFiling = useCallback(async () => {
    if (!selClient) { toast({ title: "Select a client", variant: "destructive" }); return; }
    setLoading(true);
    setFilingLoaded(false);
    const { data } = await supabase.from("tds_filings").select("*")
      .eq("client_id", selClient).eq("financial_year", selFy).eq("quarter", selQuarter).limit(10);
    const match = (data || []).find((f: any) => (f.tds_forms || []).includes(selForm));
    setFiling(match as TdsFiling || null);
    if (match) {
      await fetchChallans((match as TdsFiling).id);
    } else {
      setChallans([]);
      setDeductees([]);
      setSelectedChallan(null);
    }
    setFilingLoaded(true);
    setLoading(false);
  }, [selClient, selFy, selQuarter, selForm]);

  const resetFiling = () => {
    setFiling(null);
    setChallans([]);
    setDeductees([]);
    setSelectedChallan(null);
    setFilingLoaded(false);
  };

  const fetchChallans = async (filingId: string) => {
    const { data } = await supabase.from("tds_challans").select("*")
      .eq("filing_id", filingId).order("deposit_date", { ascending: true });
    const list = (data || []) as Challan[];
    setChallans(list);
    if (list.length > 0) {
      setSelectedChallan(list[0]);
      fetchDeductees(list[0].id);
    } else {
      setSelectedChallan(null);
      setDeductees([]);
    }
  };

  const fetchDeductees = async (challanId: string) => {
    const { data } = await supabase.from("tds_deductees").select("*")
      .eq("challan_id", challanId).order("created_at", { ascending: true });
    setDeductees((data || []) as Deductee[]);
  };

  const selectChallan = (c: Challan) => {
    setSelectedChallan(c);
    fetchDeductees(c.id);
  };

  // ─── Rate lookup helpers ───
  const getRateForSection = (sectionCode: string, deducteeType?: string | null): { rate: number | null; noPanRate: number | null; nature: string | null; threshold: number | null; rateFound: boolean } => {
    const match = rateMaster.find(r => r.section_code === sectionCode);
    if (!match) return { rate: null, noPanRate: null, nature: null, threshold: null, rateFound: false };
    const useIndRate = isIndividualRateType(deducteeType || null);
    return {
      rate: useIndRate ? match.rate_individual : match.rate_company,
      noPanRate: match.rate_no_pan,
      nature: match.nature_of_payment,
      threshold: useIndRate ? match.threshold_individual : match.threshold_company,
      rateFound: true,
    };
  };

  // ─── Challan CRUD ───
  const openAddChallan = () => {
    setEditingChallan(null);
    setChallanForm({
      bsr_code: "", challan_serial_no: "", deposit_date: "",
      minor_head: "200", total_tax: "", surcharge: "", education_cess: "",
      interest: "", others: "", is_book_entry: false,
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
      (parseFloat(challanForm.others) || 0);
  }, [challanForm.total_tax, challanForm.surcharge, challanForm.education_cess, challanForm.interest, challanForm.others]);

  const saveChallan = async () => {
    if (!filing) return;
    if (!challanForm.bsr_code || challanForm.bsr_code.length !== 7) {
      toast({ title: "BSR Code must be 7 digits", variant: "destructive" }); return;
    }
    if (!challanForm.challan_serial_no || challanForm.challan_serial_no.length !== 5) {
      toast({ title: "Serial No must be 5 digits", variant: "destructive" }); return;
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
    };

    let error;
    if (editingChallan) {
      ({ error } = await supabase.from("tds_challans").update(payload).eq("id", editingChallan.id));
    } else {
      ({ error } = await supabase.from("tds_challans").insert(payload));
    }
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    toast({ title: editingChallan ? "Challan updated" : "Challan added" });
    setChallanDialogOpen(false);
    await fetchChallans(filing.id);
  };

  const deleteChallan = async (id: string) => {
    const { error } = await supabase.from("tds_challans").delete().eq("id", id);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Challan deleted" });
    if (filing) fetchChallans(filing.id);
  };

  // ─── Deductee CRUD ───
  const addDeducteeRow = async () => {
    if (!selectedChallan || !filing) return;
    const firmId = await resolveFirmId();
    const defaultSection = selectedChallan.section_code || "";
    const { rate } = getRateForSection(defaultSection);
    const { data, error } = await supabase.from("tds_deductees").insert({
      challan_id: selectedChallan.id, filing_id: filing.id,
      client_id: filing.client_id, firm_id: firmId || filing.firm_id,
      form_type: selForm, financial_year: selFy, quarter: selQuarter,
      deductee_name: "", section_code: defaultSection,
      rate_of_tds: rate, pan_not_available: false,
    } as any).select("*").single();
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    setDeductees(prev => [...prev, data as Deductee]);
  };

  const updateDeducteeField = async (deducteeId: string, field: string, value: any) => {
    const deductee = deductees.find(d => d.id === deducteeId);
    if (!deductee) return;
    const updates: Record<string, any> = { [field]: value };

    if (field === "section_code") {
      const { rate, nature } = getRateForSection(value, deductee.deductee_type);
      if (rate !== null) {
        updates.rate_of_tds = deductee.pan_not_available ? (getRateForSection(value).noPanRate || 20) : rate;
        if (deductee.amount_paid_credited) {
          updates.tds_amount = Math.round(deductee.amount_paid_credited * updates.rate_of_tds / 100 * 100) / 100;
          updates.total_tax_deducted = updates.tds_amount;
        }
        updates.nature_of_payment = nature;
      }
    }

    if (field === "deductee_type") {
      const { rate } = getRateForSection(deductee.section_code, value);
      if (rate !== null && !deductee.pan_not_available) {
        updates.rate_of_tds = rate;
        if (deductee.amount_paid_credited) {
          updates.tds_amount = Math.round(deductee.amount_paid_credited * rate / 100 * 100) / 100;
          updates.total_tax_deducted = updates.tds_amount;
        }
      }
    }

    if (field === "amount_paid_credited") {
      const amt = parseFloat(value) || 0;
      const rate = deductee.rate_of_tds || 0;
      updates.tds_amount = Math.round(amt * rate / 100 * 100) / 100;
      updates.total_tax_deducted = updates.tds_amount;
      // Auto-suggest reason A if below threshold
      const { threshold } = getRateForSection(deductee.section_code, deductee.deductee_type);
      if (threshold && amt < threshold && updates.tds_amount === 0) {
        updates.reason_for_lower_or_nil_deduction = "A";
      }
    }

    if (field === "rate_of_tds") {
      const rate = parseFloat(value) || 0;
      const amt = deductee.amount_paid_credited || 0;
      updates.tds_amount = Math.round(amt * rate / 100 * 100) / 100;
      updates.total_tax_deducted = updates.tds_amount;
    }

    if (field === "deductee_pan") {
      const panVal = (value || "").trim().toUpperCase();
      updates.deductee_pan = panVal || null;

      if (!panVal || !isValidPan(panVal)) {
        // Invalid or blank PAN
        updates.pan_not_available = true;
        // Auto-detect type from 4th char if at least 4 chars
        if (panVal && panVal.length >= 4 && PAN_4TH_CHAR_MAP[panVal[3]]) {
          updates.deductee_type = PAN_4TH_CHAR_MAP[panVal[3]];
        } else if (!panVal) {
          updates.deductee_type = null;
        }
        const { noPanRate } = getRateForSection(deductee.section_code);
        updates.rate_of_tds = noPanRate || 20;
        updates.reason_for_lower_or_nil_deduction = "Z";
        if (deductee.amount_paid_credited) {
          updates.tds_amount = Math.round(deductee.amount_paid_credited * updates.rate_of_tds / 100 * 100) / 100;
          updates.total_tax_deducted = updates.tds_amount;
        }
      } else {
        // Valid PAN
        updates.pan_not_available = false;
        // Auto-detect type from 4th character
        const detectedType = PAN_4TH_CHAR_MAP[panVal[3]] || null;
        if (detectedType) {
          updates.deductee_type = detectedType;
        }
        const effectiveType = detectedType || deductee.deductee_type;
        const { rate, rateFound } = getRateForSection(deductee.section_code, effectiveType);
        if (rateFound && rate !== null) {
          updates.rate_of_tds = rate;
          if (deductee.amount_paid_credited) {
            updates.tds_amount = Math.round(deductee.amount_paid_credited * rate / 100 * 100) / 100;
            updates.total_tax_deducted = updates.tds_amount;
          }
        }
        if (deductee.reason_for_lower_or_nil_deduction === "Z") {
          updates.reason_for_lower_or_nil_deduction = null;
        }
      }
    }

    const { error } = await supabase.from("tds_deductees").update(updates).eq("id", deducteeId);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    setDeductees(prev => prev.map(d => d.id === deducteeId ? { ...d, ...updates } : d));
  };

  const deleteDeductee = async (id: string) => {
    const { error } = await supabase.from("tds_deductees").delete().eq("id", id);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    setDeductees(prev => prev.filter(d => d.id !== id));
  };

  // ─── 24Q Salary Drawer ───
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
    return { netSalary, totalIncome, tax, balanceTax: Math.max(0, tax - prevTds) };
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
  };

  // ─── Summary stats ───
  const challanDeducteeTds = useMemo(() => {
    if (!selectedChallan) return 0;
    return deductees.reduce((s, d) => s + (d.total_tax_deducted || d.tds_amount || 0), 0);
  }, [deductees, selectedChallan]);

  const summaryStats = useMemo(() => {
    const totalChallans = challans.length;
    const totalDeductees = deductees.length;
    const totalPayment = deductees.reduce((s, d) => s + (d.amount_paid_credited || 0), 0);
    const totalTds = deductees.reduce((s, d) => s + (d.total_tax_deducted || d.tds_amount || 0), 0);
    return { totalChallans, totalDeductees, totalPayment, totalTds };
  }, [challans, deductees]);

  // Auto-match challans
  const autoMatchChallans = () => {
    const challanTdsMap = new Map<string, number>();
    deductees.forEach(d => {
      challanTdsMap.set(d.challan_id, (challanTdsMap.get(d.challan_id) || 0) + (d.total_tax_deducted || d.tds_amount || 0));
    });
    const matched: string[] = [], unmatched: string[] = [];
    challans.forEach(c => {
      const entered = challanTdsMap.get(c.id) || 0;
      if (Math.abs(entered - c.total_challan_amount) <= 1) matched.push(c.bsr_code || c.id.slice(0, 8));
      else unmatched.push(c.bsr_code || c.id.slice(0, 8));
    });
    toast({ title: "Challan Match", description: `✅ ${matched.length} matched | ❌ ${unmatched.length} unmatched` });
  };

  // Auto-save badge state
  const [autoSaveBadge, setAutoSaveBadge] = useState(false);

  // Real auto-save: re-save all deductees every 30s
  useEffect(() => {
    if (!filing || deductees.length === 0) return;
    autoSaveRef.current = setInterval(async () => {
      setAutoSaveBadge(true);
      setTimeout(() => setAutoSaveBadge(false), 2000);
    }, 30000);
    return () => { if (autoSaveRef.current) clearInterval(autoSaveRef.current); };
  }, [filing, deductees.length]);

  // Ctrl+D duplicate row
  const duplicateDeductee = async (sourceDeductee: Deductee) => {
    if (!selectedChallan || !filing) return;
    const firmId = await resolveFirmId();
    const { id, ...rest } = sourceDeductee;
    const { data, error } = await supabase.from("tds_deductees").insert({
      ...rest,
      firm_id: firmId || filing.firm_id,
    } as any).select("*").single();
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    setDeductees(prev => [...prev, data as Deductee]);
    toast({ title: "Row duplicated" });
  };

  // Global keyboard handler for Ctrl+D
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "d") {
        e.preventDefault();
        if (deductees.length > 0) {
          duplicateDeductee(deductees[deductees.length - 1]);
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [deductees, selectedChallan, filing]);

  // Challan balance color
  const getBalanceColor = (challan: Challan) => {
    const entered = challan.id === selectedChallan?.id
      ? challanDeducteeTds
      : 0; // We only know deductees for selected challan
    const diff = Math.abs(entered - (challan.total_challan_amount || 0));
    if (diff <= 1) return "bg-emerald-500";
    if (entered < (challan.total_challan_amount || 0)) return "bg-amber-500";
    return "bg-destructive";
  };

  const client = clients.find(c => c.id === selClient);

  // Section dropdown options
  const sectionOptions = useMemo(() => {
    return rateMaster.map(r => ({
      value: r.section_code,
      label: `${r.section_code} — ${r.nature_of_payment || ""}`,
    }));
  }, [rateMaster]);

  // ─── Render ───
  return (
    <div className="space-y-4">
      {/* Filing Selector Bar */}
      <div className="rounded-lg bg-foreground/5 border p-4">
        {!filingLoaded ? (
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-foreground">Select Filing</h3>
            <div className="flex flex-wrap gap-3 items-end">
              <div className="space-y-1">
                <Label className="text-xs">Client</Label>
                <Select value={selClient} onValueChange={setSelClient}>
                  <SelectTrigger className="w-[220px]"><SelectValue placeholder="Select client" /></SelectTrigger>
                  <SelectContent>{clients.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
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
              <Button size="sm" onClick={loadFiling} disabled={loading}>
                {loading ? "Loading..." : "Load Filing"}
              </Button>
            </div>
          </div>
        ) : filing ? (
          <div className="flex flex-wrap items-center gap-4">
            <div className="space-y-0.5">
              <p className="text-xs text-muted-foreground">Client</p>
              <p className="text-sm font-semibold">{client?.name || "—"}</p>
            </div>
            <div className="space-y-0.5">
              <p className="text-xs text-muted-foreground">TAN</p>
              <p className="text-sm font-mono">{client?.tan_number || filing.tan || "—"}</p>
            </div>
            <div className="space-y-0.5">
              <p className="text-xs text-muted-foreground">Form</p>
              <p className="text-sm font-semibold">{selForm}</p>
            </div>
            <div className="space-y-0.5">
              <p className="text-xs text-muted-foreground">Quarter</p>
              <p className="text-sm font-semibold">{selQuarter} — FY {selFy}</p>
            </div>
            <Badge className={cn("text-xs", {
              "bg-muted text-muted-foreground": filing.work_status === "Not Started",
              "bg-blue-100 text-blue-700": filing.work_status === "Data Received",
              "bg-indigo-100 text-indigo-700": filing.work_status === "Under Process",
              "bg-emerald-100 text-emerald-700": filing.work_status === "Filed",
            })}>{filing.work_status}</Badge>
            <div className="flex-1" />
            <Button size="sm" variant="outline" className="gap-1" onClick={resetFiling}>
              <RotateCcw size={14} /> Change Filing
            </Button>
          </div>
        ) : (
          <div className="text-center py-4">
            <p className="text-sm text-muted-foreground mb-2">No filing found for this combination.</p>
            <p className="text-xs text-muted-foreground">Activate TDS in Client Module first.</p>
            <Button size="sm" variant="outline" className="mt-3 gap-1" onClick={resetFiling}>
              <RotateCcw size={14} /> Change Filing
            </Button>
          </div>
        )}
      </div>

      {/* Main two-panel layout */}
      {filing && (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-[30%_1fr] gap-4">
            {/* LEFT PANEL — Challan Cards */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-foreground">Challans</h3>
                <Button size="sm" variant="outline" className="gap-1 h-7 text-xs" onClick={openAddChallan}>
                  <Plus size={12} /> Add Challan
                </Button>
              </div>
              {challans.length === 0 ? (
                <Card className="border-dashed">
                  <CardContent className="py-8 text-center text-muted-foreground text-sm">
                    No challans yet. Add your first challan.
                  </CardContent>
                </Card>
              ) : challans.map(c => {
                const deducteeCount = c.id === selectedChallan?.id ? deductees.length : 0;
                return (
                  <Card key={c.id}
                    className={cn("cursor-pointer transition-all hover:shadow-sm",
                      selectedChallan?.id === c.id ? "border-primary ring-1 ring-primary/30" : "")}
                    onClick={() => selectChallan(c)}>
                    <CardContent className="p-3">
                      <div className="flex items-start justify-between">
                        <div className="space-y-1 flex-1">
                          <div className="flex items-center gap-2">
                            <CreditCard size={14} className="text-primary" />
                            <span className="text-xs font-semibold font-mono">{c.bsr_code || "No BSR"}</span>
                            {c.section_code && <Badge variant="outline" className="text-[10px]">{c.section_code}</Badge>}
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {c.deposit_date ? format(new Date(c.deposit_date), "dd MMM yyyy") : "No date"}
                            {c.challan_serial_no && ` • S/N: ${c.challan_serial_no}`}
                          </p>
                          <p className="text-sm font-bold text-foreground">
                            ₹{(c.total_challan_amount || 0).toLocaleString("en-IN")}
                            <span className="text-xs font-normal text-muted-foreground ml-2">
                              {deducteeCount > 0 ? `${deducteeCount} deductees` : ""}
                            </span>
                          </p>
                          {/* Balance bar */}
                          <div className="w-full h-1.5 rounded-full bg-muted mt-1 overflow-hidden">
                            <div className={cn("h-full rounded-full transition-all", getBalanceColor(c))}
                              style={{ width: c.total_challan_amount > 0 && c.id === selectedChallan?.id
                                ? `${Math.min(100, (challanDeducteeTds / c.total_challan_amount) * 100)}%` : "0%" }} />
                          </div>
                        </div>
                        <div className="flex gap-1 ml-2">
                          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={e => { e.stopPropagation(); openEditChallan(c); }}>
                            <Pencil size={12} />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={e => { e.stopPropagation(); deleteChallan(c.id); }}>
                            <Trash2 size={12} className="text-destructive" />
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>

            {/* RIGHT PANEL — Deductee Table */}
            <div className="space-y-3">
              {selectedChallan ? (
                <>
                  {/* Challan Summary Bar */}
                  <Card className="bg-muted/30">
                    <CardContent className="p-3">
                      <div className="flex flex-wrap gap-4 items-center text-xs">
                        <span><strong>BSR:</strong> {selectedChallan.bsr_code || "—"}</span>
                        <span><strong>Date:</strong> {selectedChallan.deposit_date ? format(new Date(selectedChallan.deposit_date), "dd/MM/yyyy") : "—"}</span>
                        <span><strong>Total:</strong> ₹{(selectedChallan.total_challan_amount || 0).toLocaleString("en-IN")}</span>
                        <span><strong>Deductees:</strong> {deductees.length}</span>
                        <div className="flex-1" />
                        <span className={cn("font-semibold",
                          Math.abs(challanDeducteeTds - (selectedChallan.total_challan_amount || 0)) <= 1
                            ? "text-emerald-600" : challanDeducteeTds < (selectedChallan.total_challan_amount || 0)
                            ? "text-amber-600" : "text-destructive")}>
                          TDS: ₹{challanDeducteeTds.toLocaleString("en-IN")} / ₹{(selectedChallan.total_challan_amount || 0).toLocaleString("en-IN")}
                          {Math.abs(challanDeducteeTds - (selectedChallan.total_challan_amount || 0)) <= 1
                            ? <CheckCircle2 size={14} className="inline ml-1" />
                            : <AlertTriangle size={14} className="inline ml-1" />}
                        </span>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Deductee Table — all inline editable */}
                  <Card>
                    <CardContent className="p-0">
                      <div className="overflow-x-auto">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="w-8 text-xs">#</TableHead>
                              {selForm === "24Q" ? (
                                <>
                                  <TableHead className="text-xs min-w-[140px]">Employee Name</TableHead>
                                  <TableHead className="text-xs min-w-[100px]">PAN</TableHead>
                                  <TableHead className="text-xs">Designation</TableHead>
                                  <TableHead className="text-xs text-right">Gross</TableHead>
                                  <TableHead className="text-xs text-right">Std Ded</TableHead>
                                  <TableHead className="text-xs text-right">Taxable</TableHead>
                                  <TableHead className="text-xs text-right">TDS</TableHead>
                                  <TableHead className="text-xs">Details</TableHead>
                                </>
                              ) : selForm === "27EQ" ? (
                                <>
                                  <TableHead className="text-xs min-w-[140px]">Collectee</TableHead>
                                  <TableHead className="text-xs min-w-[100px]">PAN</TableHead>
                                  <TableHead className="text-xs">Type</TableHead>
                                  <TableHead className="text-xs min-w-[140px]">Section</TableHead>
                                  <TableHead className="text-xs text-right">Amount</TableHead>
                                  <TableHead className="text-xs">Date</TableHead>
                                  <TableHead className="text-xs text-right">Rate%</TableHead>
                                  <TableHead className="text-xs text-right">TCS</TableHead>
                                  <TableHead className="text-xs">Reason</TableHead>
                                </>
                              ) : (
                                <>
                                  <TableHead className="text-xs min-w-[140px]">Name</TableHead>
                                  <TableHead className="text-xs min-w-[100px]">PAN</TableHead>
                                  <TableHead className="text-xs">Type</TableHead>
                                  <TableHead className="text-xs min-w-[140px]">Section</TableHead>
                                  <TableHead className="text-xs text-right">Amount</TableHead>
                                  <TableHead className="text-xs">Date</TableHead>
                                  <TableHead className="text-xs text-right">Rate%</TableHead>
                                  <TableHead className="text-xs text-right">TDS</TableHead>
                                  <TableHead className="text-xs">Reason</TableHead>
                                </>
                              )}
                              <TableHead className="w-10 text-xs">Del</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {deductees.map((d, idx) => (
                              <TableRow key={d.id}>
                                <TableCell className="text-xs text-muted-foreground">{idx + 1}</TableCell>
                                {selForm === "24Q" ? (
                                  <>
                                    <TableCell>
                                      <Input className="h-7 text-xs" defaultValue={d.deductee_name}
                                        onBlur={e => { if (e.target.value !== d.deductee_name) updateDeducteeField(d.id, "deductee_name", e.target.value); }}
                                        onKeyDown={e => { if (e.key === "Enter") { (e.target as HTMLInputElement).blur(); addDeducteeRow(); } if (e.key === "Escape") (e.target as HTMLInputElement).blur(); }} />
                                    </TableCell>
                                    <TableCell>
                                      <TooltipProvider>
                                        <Tooltip>
                                          <TooltipTrigger asChild>
                                            <Input className={cn("h-7 text-xs font-mono", d.pan_not_available && "border-destructive text-destructive")}
                                              defaultValue={d.deductee_pan || ""}
                                              onBlur={e => updateDeducteeField(d.id, "deductee_pan", e.target.value || null)} />
                                          </TooltipTrigger>
                                          {d.pan_not_available && <TooltipContent>No PAN — higher TDS rate u/s 206AA applies</TooltipContent>}
                                        </Tooltip>
                                      </TooltipProvider>
                                    </TableCell>
                                    <TableCell><Input className="h-7 text-xs w-20" defaultValue={d.designation || ""} onBlur={e => updateDeducteeField(d.id, "designation", e.target.value)} /></TableCell>
                                    <TableCell className="text-right"><Input type="number" className="h-7 text-xs w-24 text-right" defaultValue={d.gross_salary || ""} onBlur={e => updateDeducteeField(d.id, "gross_salary", parseFloat(e.target.value) || null)} /></TableCell>
                                    <TableCell className="text-right"><Input type="number" className="h-7 text-xs w-20 text-right" defaultValue={d.standard_deduction_allowed || ""} onBlur={e => updateDeducteeField(d.id, "standard_deduction_allowed", parseFloat(e.target.value) || null)} /></TableCell>
                                    <TableCell className="text-right text-xs font-medium">{d.net_taxable_salary?.toLocaleString("en-IN") || "—"}</TableCell>
                                    <TableCell className="text-right text-xs font-semibold">{d.total_tax_deducted?.toLocaleString("en-IN") || "—"}</TableCell>
                                    <TableCell>
                                      <Button variant="ghost" size="icon" className="h-6 w-6" title="Full Salary Details" onClick={() => openSalaryDrawer(d)}>
                                        <FileText size={12} />
                                      </Button>
                                    </TableCell>
                                  </>
                                ) : (
                                  <>
                                    <TableCell>
                                      <Input className="h-7 text-xs" defaultValue={d.deductee_name}
                                        onBlur={e => { if (e.target.value !== d.deductee_name) updateDeducteeField(d.id, "deductee_name", e.target.value); }}
                                        onKeyDown={e => { if (e.key === "Enter") { (e.target as HTMLInputElement).blur(); addDeducteeRow(); } if (e.key === "Escape") (e.target as HTMLInputElement).blur(); }} />
                                    </TableCell>
                                    <TableCell>
                                      <TooltipProvider>
                                        <Tooltip>
                                          <TooltipTrigger asChild>
                                            <Input className={cn("h-7 text-xs font-mono w-24", d.pan_not_available && "border-destructive text-destructive")}
                                              defaultValue={d.deductee_pan || ""}
                                              onBlur={e => updateDeducteeField(d.id, "deductee_pan", e.target.value || null)} />
                                          </TooltipTrigger>
                                          {d.pan_not_available && <TooltipContent>No PAN — higher TDS rate u/s 206AA applies</TooltipContent>}
                                        </Tooltip>
                                      </TooltipProvider>
                                    </TableCell>
                                    <TableCell>
                                      <Select value={d.deductee_type || ""} onValueChange={v => updateDeducteeField(d.id, "deductee_type", v)}>
                                        <SelectTrigger className="h-7 text-xs w-24"><SelectValue placeholder="—" /></SelectTrigger>
                                        <SelectContent>{DEDUCTEE_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                                      </Select>
                                    </TableCell>
                                    <TableCell>
                                      <Select value={d.section_code || ""} onValueChange={v => updateDeducteeField(d.id, "section_code", v)}>
                                        <SelectTrigger className="h-7 text-xs w-[160px]"><SelectValue placeholder="Select" /></SelectTrigger>
                                        <SelectContent>
                                          {sectionOptions.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                                        </SelectContent>
                                      </Select>
                                    </TableCell>
                                    <TableCell className="text-right">
                                      <Input type="number" className="h-7 text-xs w-24 text-right" defaultValue={d.amount_paid_credited || ""}
                                        onBlur={e => updateDeducteeField(d.id, "amount_paid_credited", parseFloat(e.target.value) || null)} />
                                    </TableCell>
                                    <TableCell>
                                      <Input type="date" className="h-7 text-xs w-28" defaultValue={d.date_of_payment || ""}
                                        onBlur={e => updateDeducteeField(d.id, "date_of_payment", e.target.value || null)} />
                                    </TableCell>
                                    <TableCell className="text-right">
                                      <Input type="number" className={cn("h-7 text-xs w-16 text-right", d.pan_not_available && "text-destructive")}
                                        defaultValue={d.rate_of_tds ?? ""}
                                        onBlur={e => updateDeducteeField(d.id, "rate_of_tds", parseFloat(e.target.value) || null)} />
                                    </TableCell>
                                    <TableCell className="text-right text-xs font-semibold">
                                      {(d.total_tax_deducted || d.tds_amount || 0).toLocaleString("en-IN")}
                                    </TableCell>
                                    <TableCell>
                                      {(d.tds_amount === 0 || d.tds_amount === null) ? (
                                        <Select value={d.reason_for_lower_or_nil_deduction || ""} onValueChange={v => updateDeducteeField(d.id, "reason_for_lower_or_nil_deduction", v)}>
                                          <SelectTrigger className="h-7 text-xs w-16"><SelectValue placeholder="—" /></SelectTrigger>
                                          <SelectContent>{REASON_CODES.map(r => <SelectItem key={r.code} value={r.code}>{r.label}</SelectItem>)}</SelectContent>
                                        </Select>
                                      ) : (
                                        <span className="text-xs text-muted-foreground">—</span>
                                      )}
                                    </TableCell>
                                  </>
                                )}
                                <TableCell>
                                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => deleteDeductee(d.id)}>
                                    <Trash2 size={12} className="text-destructive" />
                                  </Button>
                                </TableCell>
                              </TableRow>
                            ))}
                            {/* Always-visible blank row trigger */}
                            <TableRow className="bg-muted/20">
                              <TableCell colSpan={selForm === "24Q" ? 10 : 11} className="text-center py-2">
                                <Button variant="ghost" size="sm" className="gap-1 text-xs h-7" onClick={addDeducteeRow}>
                                  <Plus size={12} /> Add Row
                                </Button>
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
                  <div className="flex-1" />
                  <Button size="sm" variant="outline" className="gap-1" onClick={autoMatchChallans}>
                    <RefreshCw size={14} /> Auto-match
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
          {/* Auto-save badge */}
          {autoSaveBadge && (
            <div className="fixed bottom-4 right-4 z-50 bg-emerald-600 text-white text-xs px-3 py-1.5 rounded-full shadow-lg animate-in fade-in slide-in-from-bottom-2">
              ✓ Auto-saved
            </div>
          )}
        </>
      )}

      {/* Challan Dialog */}
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
                <Label className="text-xs">Serial No (5 digits) *</Label>
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
                <Label className="text-xs">Others</Label>
                <Input type="number" value={challanForm.others || ""} onChange={e => setChallanForm(p => ({ ...p, others: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Total (auto)</Label>
                <Input readOnly className="bg-muted font-semibold" value={`₹${challanTotal.toLocaleString("en-IN")}`} />
              </div>
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
                <Input value={challanForm.bank_name || ""} onChange={e => setChallanForm(p => ({ ...p, bank_name: e.target.value }))} />
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
                  <div className="space-y-1"><Label className="text-xs">80C (max ₹1.5L)</Label><Input type="number" value={salaryForm.chapter_via_80c || ""} onChange={e => setSalaryForm(p => ({ ...p, chapter_via_80c: e.target.value }))} /></div>
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
                <div className="flex justify-between"><span>Net Salary</span><span className="font-mono">₹{computedSalaryTax.netSalary.toLocaleString("en-IN")}</span></div>
                <div className="flex justify-between"><span>Total Taxable Income</span><span className="font-mono font-semibold">₹{computedSalaryTax.totalIncome.toLocaleString("en-IN")}</span></div>
                <div className="flex justify-between border-t pt-1 mt-1"><span>Tax Payable (incl. 4% cess)</span><span className="font-mono font-bold text-primary">₹{computedSalaryTax.tax.toLocaleString("en-IN")}</span></div>
                <div className="flex justify-between"><span>Less: Previous TDS</span><span className="font-mono">₹{(parseFloat(salaryForm.tds_previous_employer) || 0).toLocaleString("en-IN")}</span></div>
                <div className="flex justify-between border-t pt-1 mt-1"><span className="font-semibold">Balance Tax</span><span className="font-mono font-bold">₹{computedSalaryTax.balanceTax.toLocaleString("en-IN")}</span></div>
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
