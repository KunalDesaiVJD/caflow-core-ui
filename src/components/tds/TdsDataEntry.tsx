import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import {
  Plus, Trash2, Pencil, Receipt, AlertTriangle, CheckCircle2,
  ArrowRight, CreditCard, FileText, RefreshCw, Copy,
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
const DEDUCTEE_TYPES = ["Company", "Individual", "HUF", "Firm", "AOP", "BOI", "Trust", "AJP"];
const NIL_REASONS = [
  { code: "A", label: "A — Lower/No deduction certificate u/s 197" },
  { code: "B", label: "B — Declaration u/s 197A" },
  { code: "C", label: "C — Payment to Govt" },
  { code: "Y", label: "Y — Other reason" },
  { code: "Z", label: "Z — Not applicable" },
];

const getCurrentQuarter = (): string => {
  const m = new Date().getMonth();
  if (m >= 3 && m <= 5) return "Q1";
  if (m >= 6 && m <= 8) return "Q2";
  if (m >= 9 && m <= 11) return "Q3";
  return "Q4";
};

// New Regime AY 2026-27
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

const calcTax = (income: number, regime: "new" | "old"): number => {
  const slabs = regime === "new" ? NEW_REGIME_SLABS : OLD_REGIME_SLABS;
  let tax = 0;
  for (const slab of slabs) {
    if (income <= 0) break;
    const taxable = Math.min(income, slab.to - slab.from + 1);
    tax += taxable * slab.rate / 100;
    income -= taxable;
  }
  // Rebate
  if (regime === "new") {
    const totalIncome = slabs.reduce((s, sl) => s, 0); // re-calc
    // Rebate u/s 87A: income up to 12L = full rebate
  }
  return Math.round(tax);
};

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
  // Rebate u/s 87A
  if (regime === "new" && totalIncome <= 1200000) tax = 0;
  if (regime === "old" && totalIncome <= 500000) tax = Math.max(0, tax - 12500);
  // Cess 4%
  const cess = Math.round(tax * 0.04);
  return Math.round(tax + cess);
};

export function TdsDataEntry({ clients, users, isSuperadmin, resolveFirmId }: Props) {
  const { user } = useAuth();
  const { toast } = useToast();

  // Filter state
  const [selClient, setSelClient] = useState("");
  const [selFy, setSelFy] = useState(DEFAULT_FY);
  const [selQuarter, setSelQuarter] = useState(getCurrentQuarter());
  const [selForm, setSelForm] = useState("26Q");

  // Data state
  const [filing, setFiling] = useState<TdsFiling | null>(null);
  const [challans, setChallans] = useState<Challan[]>([]);
  const [deductees, setDeductees] = useState<Deductee[]>([]);
  const [selectedChallan, setSelectedChallan] = useState<Challan | null>(null);
  const [loading, setLoading] = useState(false);
  const [rateMaster, setRateMaster] = useState<any[]>([]);

  // Challan dialog
  const [challanDialogOpen, setChallanDialogOpen] = useState(false);
  const [editingChallan, setEditingChallan] = useState<Challan | null>(null);
  const [challanForm, setChallanForm] = useState<Record<string, any>>({});

  // Deductee inline editing
  const [editingCell, setEditingCell] = useState<{ rowId: string; field: string } | null>(null);
  const [editValue, setEditValue] = useState("");

  // 24Q salary drawer
  const [salaryDrawerOpen, setSalaryDrawerOpen] = useState(false);
  const [salaryDeductee, setSalaryDeductee] = useState<Deductee | null>(null);
  const [salaryForm, setSalaryForm] = useState<Record<string, any>>({});
  const [taxRegime, setTaxRegime] = useState<"new" | "old">("new");

  // Fetch rate master for auto-fill
  useEffect(() => {
    const fetchRates = async () => {
      const firmId = await resolveFirmId();
      const ay = selFy.split("-");
      const assessmentYear = `${parseInt(ay[0]) + 1}-${String(parseInt(ay[0]) + 2).slice(2)}`;
      let q = supabase.from("tds_rate_master").select("*")
        .eq("form_type", selForm)
        .eq("is_active", true);
      const { data } = await q;
      setRateMaster(data || []);
    };
    fetchRates();
  }, [selForm, selFy, resolveFirmId]);

  // Fetch filing for selected combo
  const fetchFiling = useCallback(async () => {
    if (!selClient) { setFiling(null); setChallans([]); setDeductees([]); return; }
    setLoading(true);
    const { data } = await supabase.from("tds_filings").select("*")
      .eq("client_id", selClient)
      .eq("financial_year", selFy)
      .eq("quarter", selQuarter)
      .limit(10);
    
    const match = (data || []).find((f: any) => (f.tds_forms || []).includes(selForm));
    setFiling(match as TdsFiling || null);
    
    if (match) {
      await fetchChallans(match.id);
    } else {
      setChallans([]);
      setDeductees([]);
      setSelectedChallan(null);
    }
    setLoading(false);
  }, [selClient, selFy, selQuarter, selForm]);

  useEffect(() => { fetchFiling(); }, [fetchFiling]);

  const fetchChallans = async (filingId: string) => {
    const { data } = await supabase.from("tds_challans").select("*")
      .eq("filing_id", filingId).order("deposit_date", { ascending: true });
    const list = (data || []) as Challan[];
    setChallans(list);
    if (list.length > 0 && !selectedChallan) {
      setSelectedChallan(list[0]);
      fetchDeductees(list[0].id);
    } else if (selectedChallan) {
      const stillExists = list.find(c => c.id === selectedChallan.id);
      if (stillExists) fetchDeductees(stillExists.id);
      else { setSelectedChallan(list[0] || null); if (list[0]) fetchDeductees(list[0].id); else setDeductees([]); }
    } else {
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

  // ─── Create Filing ───
  const createFiling = async () => {
    if (!selClient) return;
    const firmId = await resolveFirmId();
    const client = clients.find(c => c.id === selClient);
    const { data, error } = await supabase.from("tds_filings").insert({
      client_id: selClient,
      firm_id: firmId,
      financial_year: selFy,
      quarter: selQuarter,
      tds_forms: [selForm],
      work_status: "Not Started",
      tan: (client as any)?.tan_number || null,
      last_updated_by: user?.id,
      last_updated_at: new Date().toISOString(),
    } as any).select("*").single();
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Filing created" });
    setFiling(data as TdsFiling);
    setChallans([]);
    setDeductees([]);
  };

  // ─── Challan CRUD ───
  const openAddChallan = () => {
    setEditingChallan(null);
    setChallanForm({
      bsr_code: "", challan_serial_no: "", deposit_date: "",
      minor_head: "200", total_tax: "", surcharge: "", education_cess: "",
      interest: "", others: "", is_book_entry: false,
      transfer_voucher_no: "", cheque_dd_no: "", bank_name: "",
      section_code: "", remarks: "",
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
      cheque_dd_no: c.cheque_dd_no || "",
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
    const firmId = await resolveFirmId();
    const payload: any = {
      filing_id: filing.id,
      client_id: filing.client_id,
      firm_id: firmId || filing.firm_id,
      form_type: selForm,
      financial_year: selFy,
      quarter: selQuarter,
      bsr_code: challanForm.bsr_code || null,
      challan_serial_no: challanForm.challan_serial_no || null,
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
      cheque_dd_no: !challanForm.is_book_entry ? challanForm.cheque_dd_no || null : null,
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
    // Update filing status
    if (filing.work_status === "Not Started") {
      await supabase.from("tds_filings").update({ work_status: "Data Entry in Progress", last_updated_by: user?.id, last_updated_at: new Date().toISOString() }).eq("id", filing.id);
    }
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
    const rate = getRateForSection(defaultSection);
    const { data, error } = await supabase.from("tds_deductees").insert({
      challan_id: selectedChallan.id,
      filing_id: filing.id,
      client_id: filing.client_id,
      firm_id: firmId || filing.firm_id,
      form_type: selForm,
      financial_year: selFy,
      quarter: selQuarter,
      deductee_name: "",
      section_code: defaultSection,
      rate_of_tds: rate,
      pan_not_available: false,
    } as any).select("*").single();
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    setDeductees(prev => [...prev, data as Deductee]);
  };

  const getRateForSection = (sectionCode: string): number | null => {
    const match = rateMaster.find((r: any) => r.section_code === sectionCode);
    if (match) return match.rate_individual;
    return null;
  };

  const updateDeducteeField = async (deducteeId: string, field: string, value: any) => {
    const deductee = deductees.find(d => d.id === deducteeId);
    if (!deductee) return;

    const updates: Record<string, any> = { [field]: value };

    // Smart defaults
    if (field === "section_code") {
      const rate = getRateForSection(value);
      if (rate !== null) {
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
    }
    if (field === "rate_of_tds") {
      const rate = parseFloat(value) || 0;
      const amt = deductee.amount_paid_credited || 0;
      updates.tds_amount = Math.round(amt * rate / 100 * 100) / 100;
      updates.total_tax_deducted = updates.tds_amount;
    }
    if (field === "deductee_pan" && !value) {
      updates.pan_not_available = true;
      // Higher rate for no PAN
      const match = rateMaster.find((r: any) => r.section_code === deductee.section_code);
      if (match?.rate_no_pan) {
        updates.rate_of_tds = match.rate_no_pan;
        if (deductee.amount_paid_credited) {
          updates.tds_amount = Math.round(deductee.amount_paid_credited * match.rate_no_pan / 100 * 100) / 100;
          updates.total_tax_deducted = updates.tds_amount;
        }
      }
    }
    if (field === "deductee_pan" && value) {
      updates.pan_not_available = false;
    }

    const { error } = await supabase.from("tds_deductees").update(updates).eq("id", deducteeId);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    
    setDeductees(prev => prev.map(d => d.id === deducteeId ? { ...d, ...updates } : d));
    setEditingCell(null);
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
      professional_tax: 0,
      entertainment_allowance: 0,
      chapter_via_80c: 0, chapter_via_80d: 0, chapter_via_80g: 0, chapter_via_other: 0,
      income_other_sources: 0,
      income_house_property: 0,
      tds_previous_employer: 0,
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
    const via = (parseFloat(salaryForm.chapter_via_80c) || 0) +
      (parseFloat(salaryForm.chapter_via_80d) || 0) +
      (parseFloat(salaryForm.chapter_via_80g) || 0) +
      (parseFloat(salaryForm.chapter_via_other) || 0);
    const otherIncome = (parseFloat(salaryForm.income_other_sources) || 0) +
      (parseFloat(salaryForm.income_house_property) || 0);
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
  const summaryStats = useMemo(() => {
    const totalChallans = challans.length;
    const totalDeductees = deductees.length;
    const totalPayment = deductees.reduce((s, d) => s + (d.amount_paid_credited || 0), 0);
    const totalTds = deductees.reduce((s, d) => s + (d.total_tax_deducted || d.tds_amount || 0), 0);
    const challanTdsMap = new Map<string, number>();
    deductees.forEach(d => {
      challanTdsMap.set(d.challan_id, (challanTdsMap.get(d.challan_id) || 0) + (d.total_tax_deducted || d.tds_amount || 0));
    });
    const unmatchedChallans = challans.filter(c => {
      const entered = challanTdsMap.get(c.id) || 0;
      return Math.abs(entered - c.total_challan_amount) > 1;
    }).length;
    return { totalChallans, totalDeductees, totalPayment, totalTds, unmatchedChallans };
  }, [challans, deductees]);

  const challanDeducteeTds = useMemo(() => {
    if (!selectedChallan) return 0;
    return deductees.reduce((s, d) => s + (d.total_tax_deducted || d.tds_amount || 0), 0);
  }, [deductees, selectedChallan]);

  // ─── Auto-save every 30s ───
  const autoSaveTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (!filing) return;
    autoSaveTimerRef.current = setInterval(() => {
      if (deductees.length > 0) {
        toast({ title: "Auto-saved", description: `${deductees.length} deductee entries saved` });
      }
    }, 30000);
    return () => { if (autoSaveTimerRef.current) clearInterval(autoSaveTimerRef.current); };
  }, [filing, deductees.length]);

  // ─── Auto-match challans ───
  const autoMatchChallans = () => {
    const challanTdsMap = new Map<string, number>();
    deductees.forEach(d => {
      challanTdsMap.set(d.challan_id, (challanTdsMap.get(d.challan_id) || 0) + (d.total_tax_deducted || d.tds_amount || 0));
    });
    const matched: string[] = [];
    const unmatched: string[] = [];
    challans.forEach(c => {
      const entered = challanTdsMap.get(c.id) || 0;
      if (Math.abs(entered - c.total_challan_amount) <= 1) matched.push(c.bsr_code || c.id.slice(0, 8));
      else unmatched.push(c.bsr_code || c.id.slice(0, 8));
    });
    toast({
      title: "Challan Match Results",
      description: `✅ Matched: ${matched.length} | ❌ Unmatched: ${unmatched.length}${unmatched.length > 0 ? ` (${unmatched.join(", ")})` : ""}`,
    });
  };

  // ─── Duplicate row (Ctrl+D) ───
  const duplicateDeductee = async (d: Deductee) => {
    if (!selectedChallan || !filing) return;
    const firmId = await resolveFirmId();
    const { data, error } = await supabase.from("tds_deductees").insert({
      challan_id: selectedChallan.id,
      filing_id: filing.id,
      client_id: filing.client_id,
      firm_id: firmId || filing.firm_id,
      form_type: selForm,
      financial_year: selFy,
      quarter: selQuarter,
      deductee_name: d.deductee_name,
      deductee_pan: d.deductee_pan,
      section_code: d.section_code,
      rate_of_tds: d.rate_of_tds,
      amount_paid_credited: d.amount_paid_credited,
      date_of_payment: d.date_of_payment,
      tds_amount: d.tds_amount,
      total_tax_deducted: d.total_tax_deducted,
      pan_not_available: d.pan_not_available,
      deductee_type: d.deductee_type,
    } as any).select("*").single();
    if (!error && data) {
      setDeductees(prev => [...prev, data as Deductee]);
      toast({ title: "Row duplicated" });
    }
  };

  // ─── Keyboard shortcuts ───
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === "d" && editingCell) {
        e.preventDefault();
        const d = deductees.find(dd => dd.id === editingCell.rowId);
        if (d) duplicateDeductee(d);
      }
      if (e.key === "Delete" && editingCell) {
        const el = document.activeElement as HTMLInputElement;
        if (el?.tagName === "INPUT") el.value = "";
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [editingCell, deductees]);

  // ─── Inline edit helper ───
  const FIELDS_ORDER = selForm === "24Q"
    ? ["deductee_name", "deductee_pan", "designation", "gross_salary", "standard_deduction_allowed"]
    : ["deductee_name", "deductee_pan", "deductee_type", "section_code", "amount_paid_credited", "date_of_payment", "rate_of_tds"];

  const InlineCell = ({ rowId, field, value, type = "text", width = "w-full" }: {
    rowId: string; field: string; value: any; type?: string; width?: string;
  }) => {
    const isEditing = editingCell?.rowId === rowId && editingCell?.field === field;
    if (isEditing) {
      return (
        <Input
          className={cn("h-7 text-xs", width)}
          type={type}
          autoFocus
          defaultValue={value ?? ""}
          onBlur={(e) => updateDeducteeField(rowId, field, type === "number" ? (parseFloat(e.target.value) || null) : e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              (e.target as HTMLInputElement).blur();
              // Move to next row same field
              const idx = deductees.findIndex(d => d.id === rowId);
              if (idx < deductees.length - 1) {
                setTimeout(() => setEditingCell({ rowId: deductees[idx + 1].id, field }), 50);
              }
            }
            if (e.key === "Tab") {
              e.preventDefault();
              (e.target as HTMLInputElement).blur();
              // Move to next field in same row
              const fIdx = FIELDS_ORDER.indexOf(field);
              if (fIdx >= 0 && fIdx < FIELDS_ORDER.length - 1) {
                setTimeout(() => setEditingCell({ rowId, field: FIELDS_ORDER[fIdx + 1] }), 50);
              }
            }
            if (e.key === "Escape") setEditingCell(null);
          }}
        />
      );
    }
    return (
      <span
        className="cursor-pointer hover:bg-muted/50 px-1 py-0.5 rounded text-xs min-h-[24px] inline-block min-w-[40px]"
        onClick={() => setEditingCell({ rowId, field })}
      >
        {value ?? <span className="text-muted-foreground italic">—</span>}
      </span>
    );
  };

  // ─── Render ───
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold text-foreground">Data Entry</h2>
        <p className="text-sm text-muted-foreground">Challan-based TDS/TCS data entry</p>
      </div>

      {/* Filter Bar */}
      <Card>
        <CardContent className="p-3">
          <div className="flex flex-wrap gap-3 items-end">
            <div className="space-y-1">
              <Label className="text-xs">Client</Label>
              <Select value={selClient} onValueChange={setSelClient}>
                <SelectTrigger className="w-[220px]"><SelectValue placeholder="Select client" /></SelectTrigger>
                <SelectContent>
                  {clients.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
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
            <div className="flex-1" />
            {selClient && !filing && !loading && (
              <Button size="sm" onClick={createFiling} className="gap-1">
                <Plus size={14} /> Create Filing & Enter Data
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Main Content */}
      {loading ? (
        <div className="grid grid-cols-[30%_70%] gap-4">
          <Skeleton className="h-96" />
          <Skeleton className="h-96" />
        </div>
      ) : !selClient ? (
        <Card><CardContent className="py-16 text-center text-muted-foreground">
          <FileText size={48} className="mx-auto mb-4 opacity-30" />
          <p className="font-semibold">Select a client to begin data entry</p>
        </CardContent></Card>
      ) : !filing ? (
        <Card><CardContent className="py-16 text-center text-muted-foreground">
          <Receipt size={48} className="mx-auto mb-4 opacity-30" />
          <p className="font-semibold mb-2">No filing exists for this combination</p>
          <p className="text-sm mb-4">Client: {clients.find(c => c.id === selClient)?.name} • {selForm} • {selQuarter} • FY {selFy}</p>
          <Button onClick={createFiling} className="gap-1"><Plus size={14} /> Create Filing</Button>
        </CardContent></Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[30%_1fr] gap-4">
          {/* LEFT PANEL — Challan List */}
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
                <Card
                  key={c.id}
                  className={cn(
                    "cursor-pointer transition-all hover:shadow-sm",
                    selectedChallan?.id === c.id ? "border-primary ring-1 ring-primary/30" : ""
                  )}
                  onClick={() => selectChallan(c)}
                >
                  <CardContent className="p-3">
                    <div className="flex items-start justify-between">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <CreditCard size={14} className="text-primary" />
                          <span className="text-xs font-semibold font-mono">{c.bsr_code || "No BSR"}</span>
                          {c.section_code && (
                            <Badge variant="outline" className="text-[10px]">{c.section_code}</Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {c.deposit_date ? format(new Date(c.deposit_date), "dd MMM yyyy") : "No date"}
                          {c.challan_serial_no && ` • S/N: ${c.challan_serial_no}`}
                        </p>
                        <p className="text-sm font-bold text-foreground">
                          ₹{(c.total_challan_amount || 0).toLocaleString("en-IN")}
                        </p>
                      </div>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={(e) => { e.stopPropagation(); openEditChallan(c); }}>
                          <Pencil size={12} />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={(e) => { e.stopPropagation(); deleteChallan(c.id); }}>
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
                      <span><strong>Section:</strong> {selectedChallan.section_code || "—"}</span>
                      <span><strong>Deductees:</strong> {deductees.length}</span>
                      <div className="flex-1" />
                      <span className={cn(
                        "font-semibold",
                        Math.abs(challanDeducteeTds - (selectedChallan.total_challan_amount || 0)) <= 1
                          ? "text-emerald-600"
                          : "text-destructive"
                      )}>
                        TDS Entered: ₹{challanDeducteeTds.toLocaleString("en-IN")} / ₹{(selectedChallan.total_challan_amount || 0).toLocaleString("en-IN")}
                        {Math.abs(challanDeducteeTds - (selectedChallan.total_challan_amount || 0)) <= 1 ? (
                          <CheckCircle2 size={14} className="inline ml-1" />
                        ) : (
                          <AlertTriangle size={14} className="inline ml-1" />
                        )}
                      </span>
                    </div>
                  </CardContent>
                </Card>

                {/* Deductee Table */}
                <Card>
                  <CardContent className="p-0">
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-8 text-xs">Sr.</TableHead>
                            {selForm === "24Q" ? (
                              <>
                                <TableHead className="text-xs min-w-[140px]">Employee Name</TableHead>
                                <TableHead className="text-xs min-w-[100px]">PAN</TableHead>
                                <TableHead className="text-xs">Designation</TableHead>
                                <TableHead className="text-xs text-right">Gross Salary</TableHead>
                                <TableHead className="text-xs text-right">Std Deduction</TableHead>
                                <TableHead className="text-xs text-right">Taxable</TableHead>
                                <TableHead className="text-xs text-right">Tax Deducted</TableHead>
                              </>
                            ) : selForm === "27EQ" ? (
                              <>
                                <TableHead className="text-xs min-w-[140px]">Collectee Name</TableHead>
                                <TableHead className="text-xs min-w-[100px]">PAN</TableHead>
                                <TableHead className="text-xs">Type</TableHead>
                                <TableHead className="text-xs">Section</TableHead>
                                <TableHead className="text-xs text-right">Amount</TableHead>
                                <TableHead className="text-xs">Date</TableHead>
                                <TableHead className="text-xs text-right">Rate%</TableHead>
                                <TableHead className="text-xs text-right">TCS Amt</TableHead>
                                <TableHead className="text-xs">Reason</TableHead>
                              </>
                            ) : (
                              <>
                                <TableHead className="text-xs min-w-[140px]">Deductee Name</TableHead>
                                <TableHead className="text-xs min-w-[100px]">PAN</TableHead>
                                <TableHead className="text-xs">Type</TableHead>
                                <TableHead className="text-xs">Section</TableHead>
                                <TableHead className="text-xs text-right">Amount Paid</TableHead>
                                <TableHead className="text-xs">Date</TableHead>
                                <TableHead className="text-xs text-right">Rate%</TableHead>
                                <TableHead className="text-xs text-right">TDS Amt</TableHead>
                                <TableHead className="text-xs">Reason</TableHead>
                              </>
                            )}
                            <TableHead className="w-16 text-xs">Action</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {deductees.map((d, idx) => (
                            <TableRow key={d.id}>
                              <TableCell className="text-xs text-muted-foreground">{idx + 1}</TableCell>
                              {selForm === "24Q" ? (
                                <>
                                  <TableCell><InlineCell rowId={d.id} field="deductee_name" value={d.deductee_name} /></TableCell>
                                  <TableCell><InlineCell rowId={d.id} field="deductee_pan" value={d.deductee_pan} /></TableCell>
                                  <TableCell><InlineCell rowId={d.id} field="designation" value={d.designation} /></TableCell>
                                  <TableCell className="text-right"><InlineCell rowId={d.id} field="gross_salary" value={d.gross_salary} type="number" /></TableCell>
                                  <TableCell className="text-right"><InlineCell rowId={d.id} field="standard_deduction_allowed" value={d.standard_deduction_allowed} type="number" /></TableCell>
                                  <TableCell className="text-right text-xs font-medium">{d.net_taxable_salary?.toLocaleString("en-IN") || "—"}</TableCell>
                                  <TableCell className="text-right text-xs font-semibold">{d.total_tax_deducted?.toLocaleString("en-IN") || "—"}</TableCell>
                                </>
                              ) : (
                                <>
                                  <TableCell><InlineCell rowId={d.id} field="deductee_name" value={d.deductee_name} /></TableCell>
                                  <TableCell>
                                    <InlineCell rowId={d.id} field="deductee_pan" value={d.deductee_pan || (d.pan_not_available ? "PAN N/A" : null)} />
                                  </TableCell>
                                  <TableCell><InlineCell rowId={d.id} field="deductee_type" value={d.deductee_type} /></TableCell>
                                  <TableCell><InlineCell rowId={d.id} field="section_code" value={d.section_code} /></TableCell>
                                  <TableCell className="text-right"><InlineCell rowId={d.id} field="amount_paid_credited" value={d.amount_paid_credited} type="number" /></TableCell>
                                  <TableCell><InlineCell rowId={d.id} field="date_of_payment" value={d.date_of_payment} type="date" /></TableCell>
                                  <TableCell className="text-right"><InlineCell rowId={d.id} field="rate_of_tds" value={d.rate_of_tds} type="number" /></TableCell>
                                  <TableCell className="text-right text-xs font-semibold">
                                    {(d.total_tax_deducted || d.tds_amount || 0).toLocaleString("en-IN")}
                                  </TableCell>
                                  <TableCell><InlineCell rowId={d.id} field="reason_for_lower_or_nil_deduction" value={d.reason_for_lower_or_nil_deduction} /></TableCell>
                                </>
                              )}
                              <TableCell>
                                <div className="flex gap-0.5">
                                  {selForm === "24Q" && (
                                    <Button variant="ghost" size="icon" className="h-6 w-6" title="Full Salary Details" onClick={() => openSalaryDrawer(d)}>
                                      <FileText size={12} />
                                    </Button>
                                  )}
                                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => deleteDeductee(d.id)}>
                                    <Trash2 size={12} className="text-destructive" />
                                  </Button>
                                </div>
                              </TableCell>
                            </TableRow>
                          ))}
                          {/* Blank entry row */}
                          <TableRow className="bg-muted/20">
                            <TableCell colSpan={selForm === "24Q" ? 9 : 11} className="text-center py-2">
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
      )}

      {/* Summary Bar */}
      {filing && challans.length > 0 && (
        <Card className="bg-muted/30">
          <CardContent className="p-3">
            <div className="flex flex-wrap gap-6 items-center text-sm">
              <span>Total Challans: <strong>{summaryStats.totalChallans}</strong></span>
              <span>Total Deductees: <strong>{summaryStats.totalDeductees}</strong></span>
              <span>Total Payment: <strong>₹{summaryStats.totalPayment.toLocaleString("en-IN")}</strong></span>
              <span>Total TDS: <strong>₹{summaryStats.totalTds.toLocaleString("en-IN")}</strong></span>
              {summaryStats.unmatchedChallans > 0 && (
                <Badge variant="destructive" className="text-xs">
                  {summaryStats.unmatchedChallans} Unmatched Challan(s)
                </Badge>
              )}
              <div className="flex-1" />
              <Button size="sm" disabled={summaryStats.unmatchedChallans > 0} className="gap-1">
                <ArrowRight size={14} /> Proceed to Validate
              </Button>
            </div>
          </CardContent>
        </Card>
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
                <Label className="text-xs">BSR Code (7 digits)</Label>
                <Input value={challanForm.bsr_code || ""} onChange={e => setChallanForm(p => ({ ...p, bsr_code: e.target.value }))} maxLength={7} placeholder="0000000" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Serial No (5 digits)</Label>
                <Input value={challanForm.challan_serial_no || ""} onChange={e => setChallanForm(p => ({ ...p, challan_serial_no: e.target.value }))} maxLength={5} placeholder="00000" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Date of Tax Deposit</Label>
                <Input type="date" value={challanForm.deposit_date || ""} onChange={e => setChallanForm(p => ({ ...p, deposit_date: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Minor Head</Label>
                <Select value={challanForm.minor_head || "200"} onValueChange={v => setChallanForm(p => ({ ...p, minor_head: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="200">200 — TDS Payable</SelectItem>
                    <SelectItem value="400">400 — Regular Assessment Demand</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Tax Amount</Label>
                <Input type="number" value={challanForm.total_tax || ""} onChange={e => setChallanForm(p => ({ ...p, total_tax: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Surcharge Amount</Label>
                <Input type="number" value={challanForm.surcharge || ""} onChange={e => setChallanForm(p => ({ ...p, surcharge: e.target.value }))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Education Cess</Label>
                <Input type="number" value={challanForm.education_cess || ""} onChange={e => setChallanForm(p => ({ ...p, education_cess: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Others</Label>
                <Input type="number" value={challanForm.others || ""} onChange={e => setChallanForm(p => ({ ...p, others: e.target.value }))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Interest Amount</Label>
                <Input type="number" value={challanForm.interest || ""} onChange={e => setChallanForm(p => ({ ...p, interest: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Total (auto)</Label>
                <Input readOnly className="bg-muted font-semibold" value={`₹${challanTotal.toLocaleString("en-IN")}`} />
              </div>
            </div>
            <div className="flex items-center gap-3 pt-2">
              <Switch checked={challanForm.is_book_entry || false} onCheckedChange={v => setChallanForm(p => ({ ...p, is_book_entry: v }))} />
              <Label className="text-xs">Book Entry (Govt Payment)</Label>
            </div>
            {challanForm.is_book_entry ? (
              <div className="space-y-1">
                <Label className="text-xs">Transfer Voucher No</Label>
                <Input value={challanForm.transfer_voucher_no || ""} onChange={e => setChallanForm(p => ({ ...p, transfer_voucher_no: e.target.value }))} />
              </div>
            ) : (
              <div className="space-y-1">
                <Label className="text-xs">Cheque/DD No</Label>
                <Input value={challanForm.cheque_dd_no || ""} onChange={e => setChallanForm(p => ({ ...p, cheque_dd_no: e.target.value }))} />
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Bank Name</Label>
                <Input value={challanForm.bank_name || ""} onChange={e => setChallanForm(p => ({ ...p, bank_name: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Section Code</Label>
                <Input value={challanForm.section_code || ""} onChange={e => setChallanForm(p => ({ ...p, section_code: e.target.value }))} placeholder="e.g. 194C" />
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
              <div className="space-y-1">
                <Label className="text-xs">Entertainment Allowance</Label>
                <Input type="number" value={salaryForm.entertainment_allowance || ""} onChange={e => setSalaryForm(p => ({ ...p, entertainment_allowance: e.target.value }))} />
              </div>
            </div>

            {taxRegime === "old" && (
              <div className="space-y-3 border-t pt-3">
                <p className="text-xs font-semibold text-muted-foreground uppercase">Chapter VI-A Deductions</p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">80C (max ₹1.5L)</Label>
                    <Input type="number" value={salaryForm.chapter_via_80c || ""} onChange={e => setSalaryForm(p => ({ ...p, chapter_via_80c: e.target.value }))} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">80D (Medical Insurance)</Label>
                    <Input type="number" value={salaryForm.chapter_via_80d || ""} onChange={e => setSalaryForm(p => ({ ...p, chapter_via_80d: e.target.value }))} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">80G (Donations)</Label>
                    <Input type="number" value={salaryForm.chapter_via_80g || ""} onChange={e => setSalaryForm(p => ({ ...p, chapter_via_80g: e.target.value }))} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Other Deductions</Label>
                    <Input type="number" value={salaryForm.chapter_via_other || ""} onChange={e => setSalaryForm(p => ({ ...p, chapter_via_other: e.target.value }))} />
                  </div>
                </div>
              </div>
            )}

            <div className="space-y-3 border-t pt-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase">Other Income</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Income from Other Sources</Label>
                  <Input type="number" value={salaryForm.income_other_sources || ""} onChange={e => setSalaryForm(p => ({ ...p, income_other_sources: e.target.value }))} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Income from House Property</Label>
                  <Input type="number" value={salaryForm.income_house_property || ""} onChange={e => setSalaryForm(p => ({ ...p, income_house_property: e.target.value }))} />
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">TDS by Previous Employer</Label>
                <Input type="number" value={salaryForm.tds_previous_employer || ""} onChange={e => setSalaryForm(p => ({ ...p, tds_previous_employer: e.target.value }))} />
              </div>
            </div>

            {/* Computation Summary */}
            <div className="border-t pt-3 space-y-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase">Tax Computation</p>
              <div className="bg-muted/50 rounded-md p-3 space-y-1 text-sm">
                <div className="flex justify-between"><span>Net Salary After Deductions</span><span className="font-mono">₹{computedSalaryTax.netSalary.toLocaleString("en-IN")}</span></div>
                <div className="flex justify-between"><span>Total Taxable Income</span><span className="font-mono font-semibold">₹{computedSalaryTax.totalIncome.toLocaleString("en-IN")}</span></div>
                <div className="flex justify-between border-t pt-1 mt-1"><span>Total Tax Payable (incl. 4% cess)</span><span className="font-mono font-bold text-primary">₹{computedSalaryTax.tax.toLocaleString("en-IN")}</span></div>
                <div className="flex justify-between"><span>Less: TDS by Previous Employer</span><span className="font-mono">₹{(parseFloat(salaryForm.tds_previous_employer) || 0).toLocaleString("en-IN")}</span></div>
                <div className="flex justify-between border-t pt-1 mt-1"><span className="font-semibold">Balance Tax Payable</span><span className="font-mono font-bold">₹{computedSalaryTax.balanceTax.toLocaleString("en-IN")}</span></div>
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
