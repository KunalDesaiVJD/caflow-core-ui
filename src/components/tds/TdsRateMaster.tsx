import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter,
} from "@/components/ui/sheet";
import { Plus, Upload, Copy, Pencil, Trash2, Search, FileUp, AlertCircle, Info } from "lucide-react";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { resolveSection393, isItAct2025Regime, SECTION_393_DISCLAIMER } from "@/lib/section393";

const TAX_YEAR_OPTIONS = Array.from({ length: 8 }, (_, i) => {
  const s = 2023 + i;
  return `${s}-${String(s + 1).slice(2)}`;
});

const FORM_TYPES = ["24Q", "26Q", "27Q", "27EQ"] as const;

// Assessment Year = Tax Year (financial_year) + 1, per Indian tax convention.
// The DB still has an assessment_year column/unique-constraint member; this
// keeps it internally consistent without exposing the concept in the UI.
const taxYearToAssessmentYear = (taxYear: string): string => {
  const start = parseInt(taxYear.split("-")[0], 10) + 1;
  return `${start}-${String(start + 1).slice(2)}`;
};

interface RateRecord {
  id: string;
  assessment_year: string;
  financial_year: string;
  form_type: string;
  section_code: string;
  section_description: string | null;
  nature_of_payment: string | null;
  threshold_individual: number | null;
  threshold_company: number | null;
  rate_individual: number | null;
  rate_company: number | null;
  rate_no_pan: number | null;
  surcharge_applicable: boolean;
  cess_applicable: boolean;
  is_active: boolean;
  effective_from: string | null;
  effective_to: string | null;
  notes: string | null;
  firm_id: string | null;
}

// Default seed data for Tax Year 2025-26
const SEED_DATA: Omit<RateRecord, "id" | "firm_id" | "created_at">[] = [
  // 26Q
  { assessment_year: "2026-27", financial_year: "2025-26", form_type: "26Q", section_code: "192A", nature_of_payment: "Premature PF Withdrawal", threshold_individual: 50000, threshold_company: 50000, rate_individual: 10, rate_company: 10, rate_no_pan: 20, surcharge_applicable: false, cess_applicable: false, is_active: true, effective_from: "2025-04-01", effective_to: null, notes: null, section_description: null },
  { assessment_year: "2026-27", financial_year: "2025-26", form_type: "26Q", section_code: "193", nature_of_payment: "Interest on Securities", threshold_individual: 10000, threshold_company: 10000, rate_individual: 10, rate_company: 10, rate_no_pan: 20, surcharge_applicable: false, cess_applicable: false, is_active: true, effective_from: "2025-04-01", effective_to: null, notes: null, section_description: null },
  { assessment_year: "2026-27", financial_year: "2025-26", form_type: "26Q", section_code: "194", nature_of_payment: "Dividend (Domestic Company)", threshold_individual: 5000, threshold_company: 5000, rate_individual: 10, rate_company: 10, rate_no_pan: 20, surcharge_applicable: false, cess_applicable: false, is_active: true, effective_from: "2025-04-01", effective_to: null, notes: null, section_description: null },
  { assessment_year: "2026-27", financial_year: "2025-26", form_type: "26Q", section_code: "194A-SC", nature_of_payment: "Interest (Banks - Sr Citizen)", threshold_individual: 50000, threshold_company: 40000, rate_individual: 10, rate_company: 10, rate_no_pan: 20, surcharge_applicable: false, cess_applicable: false, is_active: true, effective_from: "2025-04-01", effective_to: null, notes: null, section_description: null },
  { assessment_year: "2026-27", financial_year: "2025-26", form_type: "26Q", section_code: "194A", nature_of_payment: "Interest (Banks - Others)", threshold_individual: 40000, threshold_company: 40000, rate_individual: 10, rate_company: 10, rate_no_pan: 20, surcharge_applicable: false, cess_applicable: false, is_active: true, effective_from: "2025-04-01", effective_to: null, notes: null, section_description: null },
  { assessment_year: "2026-27", financial_year: "2025-26", form_type: "26Q", section_code: "194B", nature_of_payment: "Lottery/Crossword", threshold_individual: 10000, threshold_company: 10000, rate_individual: 30, rate_company: 30, rate_no_pan: 30, surcharge_applicable: false, cess_applicable: false, is_active: true, effective_from: "2025-04-01", effective_to: null, notes: null, section_description: null },
  { assessment_year: "2026-27", financial_year: "2025-26", form_type: "26Q", section_code: "194BB", nature_of_payment: "Horse Racing", threshold_individual: 10000, threshold_company: 10000, rate_individual: 30, rate_company: 30, rate_no_pan: 30, surcharge_applicable: false, cess_applicable: false, is_active: true, effective_from: "2025-04-01", effective_to: null, notes: null, section_description: null },
  { assessment_year: "2026-27", financial_year: "2025-26", form_type: "26Q", section_code: "194BA", nature_of_payment: "Online Gaming Winnings", threshold_individual: 0, threshold_company: 0, rate_individual: 30, rate_company: 30, rate_no_pan: 30, surcharge_applicable: false, cess_applicable: false, is_active: true, effective_from: "2025-04-01", effective_to: null, notes: "IT Act 2025: TDS on net winnings from online gaming platforms. No threshold limit.", section_description: null },
  { assessment_year: "2026-27", financial_year: "2025-26", form_type: "26Q", section_code: "194LBC", nature_of_payment: "Securitisation Trust Income", threshold_individual: 0, threshold_company: 0, rate_individual: 25, rate_company: 30, rate_no_pan: 30, surcharge_applicable: false, cess_applicable: false, is_active: true, effective_from: "2025-04-01", effective_to: null, notes: "IT Act 2025: 25% for Ind/HUF, 30% for others (companies/firms).", section_description: null },
  // Merged 194C (was split into 194C-A / 194C-S) — matches what Genius Excel uses on import/export.
  { assessment_year: "2026-27", financial_year: "2025-26", form_type: "26Q", section_code: "194C", nature_of_payment: "Contractor / Sub-contractor", threshold_individual: 30000, threshold_company: 30000, rate_individual: 1, rate_company: 2, rate_no_pan: 20, surcharge_applicable: false, cess_applicable: false, is_active: true, effective_from: "2025-04-01", effective_to: null, notes: "1% for Ind/HUF, 2% for Others. Threshold: ₹30,000 per single transaction OR ₹1,00,000 aggregate in FY.", section_description: null },
  { assessment_year: "2026-27", financial_year: "2025-26", form_type: "26Q", section_code: "194D", nature_of_payment: "Insurance Commission", threshold_individual: 15000, threshold_company: 15000, rate_individual: 5, rate_company: 10, rate_no_pan: 20, surcharge_applicable: false, cess_applicable: false, is_active: true, effective_from: "2025-04-01", effective_to: null, notes: null, section_description: null },
  { assessment_year: "2026-27", financial_year: "2025-26", form_type: "26Q", section_code: "194DA", nature_of_payment: "Life Insurance Payout", threshold_individual: 100000, threshold_company: 100000, rate_individual: 5, rate_company: 5, rate_no_pan: 20, surcharge_applicable: false, cess_applicable: false, is_active: true, effective_from: "2025-04-01", effective_to: null, notes: null, section_description: null },
  { assessment_year: "2026-27", financial_year: "2025-26", form_type: "26Q", section_code: "194G", nature_of_payment: "Lottery Agent Commission", threshold_individual: 15000, threshold_company: 15000, rate_individual: 5, rate_company: 5, rate_no_pan: 20, surcharge_applicable: false, cess_applicable: false, is_active: true, effective_from: "2025-04-01", effective_to: null, notes: null, section_description: null },
  { assessment_year: "2026-27", financial_year: "2025-26", form_type: "26Q", section_code: "194H", nature_of_payment: "Commission/Brokerage", threshold_individual: 15000, threshold_company: 15000, rate_individual: 5, rate_company: 5, rate_no_pan: 20, surcharge_applicable: false, cess_applicable: false, is_active: true, effective_from: "2025-04-01", effective_to: null, notes: null, section_description: null },
  { assessment_year: "2026-27", financial_year: "2025-26", form_type: "26Q", section_code: "194I(a)", nature_of_payment: "Rent - Plant & Machinery", threshold_individual: 240000, threshold_company: 240000, rate_individual: 2, rate_company: 2, rate_no_pan: 20, surcharge_applicable: false, cess_applicable: false, is_active: true, effective_from: "2025-04-01", effective_to: null, notes: null, section_description: null },
  { assessment_year: "2026-27", financial_year: "2025-26", form_type: "26Q", section_code: "194I(b)", nature_of_payment: "Rent - Land/Building", threshold_individual: 240000, threshold_company: 240000, rate_individual: 10, rate_company: 10, rate_no_pan: 20, surcharge_applicable: false, cess_applicable: false, is_active: true, effective_from: "2025-04-01", effective_to: null, notes: null, section_description: null },
  { assessment_year: "2026-27", financial_year: "2025-26", form_type: "26Q", section_code: "194IA", nature_of_payment: "Immovable Property Purchase", threshold_individual: 5000000, threshold_company: 5000000, rate_individual: 1, rate_company: 1, rate_no_pan: 20, surcharge_applicable: false, cess_applicable: false, is_active: true, effective_from: "2025-04-01", effective_to: null, notes: null, section_description: null },
  { assessment_year: "2026-27", financial_year: "2025-26", form_type: "26Q", section_code: "194IB", nature_of_payment: "Rent by Ind/HUF (>50k/month)", threshold_individual: 50000, threshold_company: 0, rate_individual: 2, rate_company: 0, rate_no_pan: 20, surcharge_applicable: false, cess_applicable: false, is_active: true, effective_from: "2025-04-01", effective_to: null, notes: "Rate reduced to 2% w.e.f. 01-Apr-2025 (Finance Act 2025). Per month threshold.", section_description: null },
  { assessment_year: "2026-27", financial_year: "2025-26", form_type: "26Q", section_code: "194IC", nature_of_payment: "Joint Dev Agreement", threshold_individual: 0, threshold_company: 0, rate_individual: 10, rate_company: 10, rate_no_pan: 20, surcharge_applicable: false, cess_applicable: false, is_active: true, effective_from: "2025-04-01", effective_to: null, notes: null, section_description: null },
  { assessment_year: "2026-27", financial_year: "2025-26", form_type: "26Q", section_code: "194J(a)", nature_of_payment: "Professional Services", threshold_individual: 30000, threshold_company: 30000, rate_individual: 10, rate_company: 10, rate_no_pan: 20, surcharge_applicable: false, cess_applicable: false, is_active: true, effective_from: "2025-04-01", effective_to: null, notes: null, section_description: null },
  { assessment_year: "2026-27", financial_year: "2025-26", form_type: "26Q", section_code: "194J(b)", nature_of_payment: "Technical Services", threshold_individual: 30000, threshold_company: 30000, rate_individual: 2, rate_company: 2, rate_no_pan: 20, surcharge_applicable: false, cess_applicable: false, is_active: true, effective_from: "2025-04-01", effective_to: null, notes: null, section_description: null },
  { assessment_year: "2026-27", financial_year: "2025-26", form_type: "26Q", section_code: "194K", nature_of_payment: "MF/UTI Units Income", threshold_individual: 5000, threshold_company: 5000, rate_individual: 10, rate_company: 10, rate_no_pan: 20, surcharge_applicable: false, cess_applicable: false, is_active: true, effective_from: "2025-04-01", effective_to: null, notes: null, section_description: null },
  { assessment_year: "2026-27", financial_year: "2025-26", form_type: "26Q", section_code: "194LA", nature_of_payment: "Compulsory Acquisition", threshold_individual: 250000, threshold_company: 250000, rate_individual: 10, rate_company: 10, rate_no_pan: 20, surcharge_applicable: false, cess_applicable: false, is_active: true, effective_from: "2025-04-01", effective_to: null, notes: null, section_description: null },
  { assessment_year: "2026-27", financial_year: "2025-26", form_type: "26Q", section_code: "194LB", nature_of_payment: "Infrastructure Bond Interest", threshold_individual: 0, threshold_company: 0, rate_individual: 5, rate_company: 5, rate_no_pan: 20, surcharge_applicable: false, cess_applicable: false, is_active: true, effective_from: "2025-04-01", effective_to: null, notes: null, section_description: null },
  { assessment_year: "2026-27", financial_year: "2025-26", form_type: "26Q", section_code: "194M", nature_of_payment: "Contractor/Professional by Ind", threshold_individual: 5000000, threshold_company: 0, rate_individual: 5, rate_company: 0, rate_no_pan: 20, surcharge_applicable: false, cess_applicable: false, is_active: true, effective_from: "2025-04-01", effective_to: null, notes: null, section_description: null },
  { assessment_year: "2026-27", financial_year: "2025-26", form_type: "26Q", section_code: "194N-F", nature_of_payment: "Cash Withdrawal (ITR Filer)", threshold_individual: 10000000, threshold_company: 10000000, rate_individual: 2, rate_company: 2, rate_no_pan: 20, surcharge_applicable: false, cess_applicable: false, is_active: true, effective_from: "2025-04-01", effective_to: null, notes: null, section_description: null },
  { assessment_year: "2026-27", financial_year: "2025-26", form_type: "26Q", section_code: "194N-NF", nature_of_payment: "Cash Withdrawal (Non-Filer)", threshold_individual: 2000000, threshold_company: 2000000, rate_individual: 2, rate_company: 2, rate_no_pan: 20, surcharge_applicable: false, cess_applicable: false, is_active: true, effective_from: "2025-04-01", effective_to: null, notes: "2% for 20L-1Cr, 5% above 1Cr", section_description: null },
  { assessment_year: "2026-27", financial_year: "2025-26", form_type: "26Q", section_code: "194O", nature_of_payment: "E-Commerce", threshold_individual: 500000, threshold_company: 500000, rate_individual: 1, rate_company: 1, rate_no_pan: 20, surcharge_applicable: false, cess_applicable: false, is_active: true, effective_from: "2025-04-01", effective_to: null, notes: null, section_description: null },
  { assessment_year: "2026-27", financial_year: "2025-26", form_type: "26Q", section_code: "194Q", nature_of_payment: "Purchase of Goods", threshold_individual: 5000000, threshold_company: 5000000, rate_individual: 0.1, rate_company: 0.1, rate_no_pan: 5, surcharge_applicable: false, cess_applicable: false, is_active: true, effective_from: "2025-04-01", effective_to: null, notes: null, section_description: null },
  { assessment_year: "2026-27", financial_year: "2025-26", form_type: "26Q", section_code: "194R", nature_of_payment: "Benefit/Perquisite in Business", threshold_individual: 20000, threshold_company: 20000, rate_individual: 10, rate_company: 10, rate_no_pan: 20, surcharge_applicable: false, cess_applicable: false, is_active: true, effective_from: "2025-04-01", effective_to: null, notes: null, section_description: null },
  { assessment_year: "2026-27", financial_year: "2025-26", form_type: "26Q", section_code: "194S", nature_of_payment: "Virtual Digital Asset", threshold_individual: 10000, threshold_company: 50000, rate_individual: 1, rate_company: 1, rate_no_pan: 20, surcharge_applicable: false, cess_applicable: false, is_active: true, effective_from: "2025-04-01", effective_to: null, notes: null, section_description: null },
  { assessment_year: "2026-27", financial_year: "2025-26", form_type: "26Q", section_code: "194T", nature_of_payment: "Payment to Partner", threshold_individual: 20000, threshold_company: 0, rate_individual: 10, rate_company: 0, rate_no_pan: 20, surcharge_applicable: false, cess_applicable: false, is_active: true, effective_from: "2025-04-01", effective_to: null, notes: null, section_description: null },
  { assessment_year: "2026-27", financial_year: "2025-26", form_type: "26Q", section_code: "194F", nature_of_payment: "Mutual Fund Repurchase", threshold_individual: 0, threshold_company: 0, rate_individual: 20, rate_company: 20, rate_no_pan: 20, surcharge_applicable: false, cess_applicable: false, is_active: true, effective_from: "2025-04-01", effective_to: null, notes: null, section_description: null },
  // 24Q
  { assessment_year: "2026-27", financial_year: "2025-26", form_type: "24Q", section_code: "192", nature_of_payment: "Salary", threshold_individual: 0, threshold_company: 0, rate_individual: 0, rate_company: 0, rate_no_pan: 20, surcharge_applicable: false, cess_applicable: true, is_active: true, effective_from: "2025-04-01", effective_to: null, notes: "As per income tax slab rates", section_description: null },
  { assessment_year: "2026-27", financial_year: "2025-26", form_type: "24Q", section_code: "192A", nature_of_payment: "PF Withdrawal", threshold_individual: 50000, threshold_company: 0, rate_individual: 10, rate_company: 0, rate_no_pan: 20, surcharge_applicable: false, cess_applicable: false, is_active: true, effective_from: "2025-04-01", effective_to: null, notes: null, section_description: null },
  // 27EQ
  { assessment_year: "2026-27", financial_year: "2025-26", form_type: "27EQ", section_code: "206C(1)", nature_of_payment: "Scrap", threshold_individual: 0, threshold_company: 0, rate_individual: 1, rate_company: 1, rate_no_pan: 5, surcharge_applicable: false, cess_applicable: false, is_active: true, effective_from: "2025-04-01", effective_to: null, notes: null, section_description: null },
  { assessment_year: "2026-27", financial_year: "2025-26", form_type: "27EQ", section_code: "206C(1C)", nature_of_payment: "Motor Vehicle >10L", threshold_individual: 0, threshold_company: 0, rate_individual: 1, rate_company: 1, rate_no_pan: 5, surcharge_applicable: false, cess_applicable: false, is_active: true, effective_from: "2025-04-01", effective_to: null, notes: null, section_description: null },
  { assessment_year: "2026-27", financial_year: "2025-26", form_type: "27EQ", section_code: "206C(1G)(a)", nature_of_payment: "Overseas Remittance LRS", threshold_individual: 700000, threshold_company: 700000, rate_individual: 5, rate_company: 5, rate_no_pan: 5, surcharge_applicable: false, cess_applicable: false, is_active: true, effective_from: "2025-04-01", effective_to: null, notes: null, section_description: null },
  { assessment_year: "2026-27", financial_year: "2025-26", form_type: "27EQ", section_code: "206C(1G)(b)", nature_of_payment: "Education Loan Remittance", threshold_individual: 700000, threshold_company: 700000, rate_individual: 0.5, rate_company: 0.5, rate_no_pan: 5, surcharge_applicable: false, cess_applicable: false, is_active: true, effective_from: "2025-04-01", effective_to: null, notes: null, section_description: null },
  { assessment_year: "2026-27", financial_year: "2025-26", form_type: "27EQ", section_code: "206C(1H)", nature_of_payment: "Sale of Goods", threshold_individual: 5000000, threshold_company: 5000000, rate_individual: 0.1, rate_company: 0.1, rate_no_pan: 1, surcharge_applicable: false, cess_applicable: false, is_active: true, effective_from: "2025-04-01", effective_to: null, notes: null, section_description: null },
  // 27Q
  { assessment_year: "2026-27", financial_year: "2025-26", form_type: "27Q", section_code: "194E", nature_of_payment: "Sportsman/Entertainer NR", threshold_individual: 0, threshold_company: 0, rate_individual: 20, rate_company: 20, rate_no_pan: 20, surcharge_applicable: false, cess_applicable: false, is_active: true, effective_from: "2025-04-01", effective_to: null, notes: null, section_description: null },
  { assessment_year: "2026-27", financial_year: "2025-26", form_type: "27Q", section_code: "194LB-NR", nature_of_payment: "Infrastructure Bond", threshold_individual: 0, threshold_company: 0, rate_individual: 5, rate_company: 5, rate_no_pan: 20, surcharge_applicable: false, cess_applicable: false, is_active: true, effective_from: "2025-04-01", effective_to: null, notes: null, section_description: null },
  { assessment_year: "2026-27", financial_year: "2025-26", form_type: "27Q", section_code: "194LC", nature_of_payment: "Corporate Bond", threshold_individual: 0, threshold_company: 0, rate_individual: 5, rate_company: 5, rate_no_pan: 20, surcharge_applicable: false, cess_applicable: false, is_active: true, effective_from: "2025-04-01", effective_to: null, notes: null, section_description: null },
  { assessment_year: "2026-27", financial_year: "2025-26", form_type: "27Q", section_code: "194LD", nature_of_payment: "Rupee Bonds/Govt Securities", threshold_individual: 0, threshold_company: 0, rate_individual: 5, rate_company: 5, rate_no_pan: 20, surcharge_applicable: false, cess_applicable: false, is_active: true, effective_from: "2025-04-01", effective_to: null, notes: null, section_description: null },
  { assessment_year: "2026-27", financial_year: "2025-26", form_type: "27Q", section_code: "195", nature_of_payment: "Other Payments to NR", threshold_individual: 0, threshold_company: 0, rate_individual: 0, rate_company: 0, rate_no_pan: 20, surcharge_applicable: false, cess_applicable: false, is_active: true, effective_from: "2025-04-01", effective_to: null, notes: "As per DTAA rates", section_description: null },
  { assessment_year: "2026-27", financial_year: "2025-26", form_type: "27Q", section_code: "196A", nature_of_payment: "MF Income to NR", threshold_individual: 0, threshold_company: 0, rate_individual: 10, rate_company: 10, rate_no_pan: 20, surcharge_applicable: false, cess_applicable: false, is_active: true, effective_from: "2025-04-01", effective_to: null, notes: null, section_description: null },
  { assessment_year: "2026-27", financial_year: "2025-26", form_type: "27Q", section_code: "196B", nature_of_payment: "Offshore Fund Income", threshold_individual: 0, threshold_company: 0, rate_individual: 10, rate_company: 10, rate_no_pan: 20, surcharge_applicable: false, cess_applicable: false, is_active: true, effective_from: "2025-04-01", effective_to: null, notes: null, section_description: null },
  { assessment_year: "2026-27", financial_year: "2025-26", form_type: "27Q", section_code: "196C", nature_of_payment: "Foreign Currency Bonds", threshold_individual: 0, threshold_company: 0, rate_individual: 10, rate_company: 10, rate_no_pan: 20, surcharge_applicable: false, cess_applicable: false, is_active: true, effective_from: "2025-04-01", effective_to: null, notes: null, section_description: null },
  { assessment_year: "2026-27", financial_year: "2025-26", form_type: "27Q", section_code: "196D", nature_of_payment: "FII Securities", threshold_individual: 0, threshold_company: 0, rate_individual: 20, rate_company: 20, rate_no_pan: 20, surcharge_applicable: false, cess_applicable: false, is_active: true, effective_from: "2025-04-01", effective_to: null, notes: null, section_description: null },
];

interface Props {
  resolveFirmId: () => Promise<string | null>;
  isSuperadmin: boolean;
}

export function TdsRateMaster({ resolveFirmId, isSuperadmin }: Props) {
  const { toast } = useToast();
  const [rates, setRates] = useState<RateRecord[]>([]);
  const [loading, setLoading] = useState(true);
  // "Tax Year" here means financial_year (the year TDS is deducted/deposited) —
  // the DB also carries a legacy assessment_year column (= tax year + 1, per
  // Indian tax convention) kept in sync automatically for internal consistency,
  // but it's no longer surfaced in the UI.
  const [selectedTaxYear, setSelectedTaxYear] = useState("2026-27");
  const [selectedForm, setSelectedForm] = useState<string>("26Q");
  const [search, setSearch] = useState("");
  // §393 searchable-dropdown selection (Tax Year 2026-27+ only). "" = show all.
  const [selectedSection, setSelectedSection] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editingRate, setEditingRate] = useState<RateRecord | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState<Record<string, any>>({});
  const [activeTab, setActiveTab] = useState<"rates" | "templates">("rates");
  const [templates, setTemplates] = useState<Record<string, { name: string; updated: string; uploadedBy: string } | null>>({
    "26Q": null, "24Q": null, "27Q": null, "27EQ": null,
  });
  const [uploadingTemplate, setUploadingTemplate] = useState<string | null>(null);

  const fetchRates = useCallback(async () => {
    setLoading(true);
    const firmId = await resolveFirmId();
    let q = supabase.from("tds_rate_master").select("*")
      .eq("financial_year", selectedTaxYear)
      .eq("form_type", selectedForm)
      .order("section_code");
    if (!isSuperadmin && firmId) q = q.eq("firm_id", firmId);
    const { data } = await q;
    setRates((data as any[]) || []);
    setLoading(false);
  }, [selectedTaxYear, selectedForm, resolveFirmId, isSuperadmin]);

  useEffect(() => { fetchRates(); }, [fetchRates]);

  // Section 393 (Income-tax Act, 2025) applies from Tax Year 2026-27 onward.
  // Earlier years keep the plain section cards untouched.
  const is2025Regime = isItAct2025Regime(selectedTaxYear);

  // The set of sections differs per form/year — clear any dropdown selection
  // when the user switches so a now-absent section isn't left "selected".
  useEffect(() => { setSelectedSection(""); }, [selectedForm, selectedTaxYear]);

  // Genius-style searchable Section dropdown options — one per rate row,
  // enriched with the §393 payment code / new-section / table Sl.No / old
  // section / description so it's searchable by any of those tokens.
  const sectionSelectOptions = useMemo(() => {
    // Superadmin queries span all firms, so the same section_code can appear
    // more than once (once per firm) — dedupe to keep option values unique.
    const seen = new Set<string>();
    const opts: { value: string; label: string }[] = [];
    for (const r of rates) {
      if (seen.has(r.section_code)) continue;
      seen.add(r.section_code);
      const info = resolveSection393(r.section_code);
      const parts: string[] = [];
      if (info?.paymentCode) parts.push(info.paymentCode);
      if (info) parts.push(`§${info.newSection}`);
      if (info?.tableRef) parts.push(`[${info.tableRef}]`);
      const prefix = parts.length ? `${parts.join(" · ")} · ` : "";
      opts.push({ value: r.section_code, label: `${prefix}${r.section_code} — ${r.nature_of_payment || ""}` });
    }
    return [{ value: "", label: "All sections" }, ...opts];
  }, [rates]);

  const filtered = useMemo(() => rates.filter(r => {
    if (selectedSection && r.section_code !== selectedSection) return false;
    if (!search) return true;
    const s = search.toLowerCase();
    return r.section_code.toLowerCase().includes(s) || (r.nature_of_payment || "").toLowerCase().includes(s);
  }), [rates, search, selectedSection]);

  const seedRates = async () => {
    const firmId = await resolveFirmId();
    if (!firmId) { toast({ title: "No firm ID", variant: "destructive" }); return; }

    // ── Migration: merge legacy 194C-A / 194C-S into a single 194C ─────────
    // The Genius Excel format uses plain "194C"; the app previously split this
    // into 194C-A (Aggregate) and 194C-S (Single Transaction) which broke
    // Genius import/export round-trips. Runs idempotently — safe on every seed.
    const legacy194C = ["194C-A", "194C-S"];
    try {
      // Update any existing challans with legacy codes
      await supabase.from("tds_challans")
        .update({ section_code: "194C" })
        .in("section_code", legacy194C);
      // Update any existing deductees with legacy codes
      await supabase.from("tds_deductees")
        .update({ section_code: "194C" })
        .in("section_code", legacy194C);
      // Delete old rate_master rows for this firm (for all AYs)
      await supabase.from("tds_rate_master")
        .delete()
        .eq("firm_id", firmId)
        .in("section_code", legacy194C);
    } catch (migErr) {
      console.warn("[TdsRateMaster] 194C migration step failed (non-fatal):", migErr);
    }

    const toInsert = SEED_DATA.map(d => ({ ...d, firm_id: firmId }));
    const { error } = await supabase.from("tds_rate_master").upsert(toInsert as any[], { onConflict: "assessment_year,form_type,section_code,firm_id" });
    if (error) toast({ title: "Error seeding", description: error.message, variant: "destructive" });
    else { toast({ title: "Rate master seeded for Tax Year 2025-26", description: "Legacy 194C-A / 194C-S merged into 194C." }); fetchRates(); }
  };

  const importFromPrevYear = async () => {
    const firmId = await resolveFirmId();
    if (!firmId) { toast({ title: "No firm ID", variant: "destructive" }); return; }
    const prevTaxYearStart = parseInt(selectedTaxYear.split("-")[0], 10) - 1;
    const prevTaxYear = `${prevTaxYearStart}-${String(prevTaxYearStart + 1).slice(2)}`;

    // Import ALL form types, not just the currently selected one
    let totalImported = 0;
    for (const formType of FORM_TYPES) {
      let q = supabase.from("tds_rate_master").select("*")
        .eq("financial_year", prevTaxYear)
        .eq("form_type", formType)
        .eq("firm_id", firmId);
      const { data: prevRates } = await q;
      if (!prevRates || prevRates.length === 0) continue;
      const toInsert = prevRates.map((r: any) => ({
        ...r,
        id: undefined,
        financial_year: selectedTaxYear,
        assessment_year: taxYearToAssessmentYear(selectedTaxYear),
        firm_id: firmId,
        created_at: undefined,
      }));
      const { error } = await supabase.from("tds_rate_master").upsert(toInsert as any[], { onConflict: "assessment_year,form_type,section_code,firm_id" });
      if (error) { toast({ title: `Error importing ${formType}`, description: error.message, variant: "destructive" }); return; }
      totalImported += toInsert.length;
    }
    if (totalImported === 0) {
      toast({ title: `No rates found for Tax Year ${prevTaxYear} for this firm`, variant: "destructive" });
      return;
    }
    toast({ title: `Imported ${totalImported} rates from Tax Year ${prevTaxYear} (all form types)` });
    fetchRates();
  };

  const openAdd = (prefillSectionCode?: string) => {
    setEditingRate(null);
    setFormData({
      section_code: prefillSectionCode || "", nature_of_payment: "", threshold_individual: "",
      threshold_company: "", rate_individual: "", rate_company: "", rate_no_pan: "20",
      surcharge_applicable: false, cess_applicable: false, effective_from: "2025-04-01", notes: "",
    });
    setFormOpen(true);
  };

  const openEdit = (r: RateRecord) => {
    setEditingRate(r);
    setFormData({
      section_code: r.section_code, nature_of_payment: r.nature_of_payment || "",
      threshold_individual: r.threshold_individual ?? "", threshold_company: r.threshold_company ?? "",
      rate_individual: r.rate_individual ?? "", rate_company: r.rate_company ?? "",
      rate_no_pan: r.rate_no_pan ?? "", surcharge_applicable: r.surcharge_applicable,
      cess_applicable: r.cess_applicable, effective_from: r.effective_from || "", notes: r.notes || "",
    });
    setFormOpen(true);
  };

  const handleSave = async () => {
    if (!formData.section_code) { toast({ title: "Section code required", variant: "destructive" }); return; }
    setSaving(true);
    const firmId = await resolveFirmId();
    const payload = {
      assessment_year: taxYearToAssessmentYear(selectedTaxYear), financial_year: selectedTaxYear, form_type: selectedForm, firm_id: firmId,
      section_code: formData.section_code, nature_of_payment: formData.nature_of_payment || null,
      threshold_individual: parseFloat(formData.threshold_individual) || 0,
      threshold_company: parseFloat(formData.threshold_company) || 0,
      rate_individual: parseFloat(formData.rate_individual) || null,
      rate_company: parseFloat(formData.rate_company) || null,
      rate_no_pan: parseFloat(formData.rate_no_pan) || null,
      surcharge_applicable: formData.surcharge_applicable, cess_applicable: formData.cess_applicable,
      effective_from: formData.effective_from || null, notes: formData.notes || null,
      is_active: true,
    };
    if (editingRate) {
      const { error } = await supabase.from("tds_rate_master").update(payload as any).eq("id", editingRate.id);
      if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
      else {
        toast({ title: "Rate updated" });
        // Follow the §393 dropdown filter to the row's new code so an edit
        // that renames the selected section doesn't strand the filter on a
        // now-nonexistent code (which would blank the grid).
        if (selectedSection === editingRate.section_code && formData.section_code !== editingRate.section_code) {
          setSelectedSection(formData.section_code);
        }
        setFormOpen(false); fetchRates();
      }
    } else {
      const { error } = await supabase.from("tds_rate_master").insert(payload as any);
      if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
      else {
        toast({ title: "Rate added" });
        // Filter straight to the just-added section so the user gets
        // immediate visual confirmation of what they created.
        if (is2025Regime) setSelectedSection(payload.section_code);
        setFormOpen(false); fetchRates();
      }
    }
    setSaving(false);
  };

  const handleDelete = async (id: string) => {
    const target = rates.find(r => r.id === id);
    const { error } = await supabase.from("tds_rate_master").delete().eq("id", id);
    if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
    else {
      toast({ title: "Deleted" });
      // If the deleted row was the §393 dropdown's active filter, clear it —
      // otherwise the grid would filter to a code that no longer exists and
      // misleadingly show "No rates found" despite other sections remaining.
      if (target && target.section_code === selectedSection) setSelectedSection("");
      fetchRates();
    }
  };

  const handleUpload = async (file: File) => {
    const text = await file.text();
    const firmId = await resolveFirmId();
    let rows: any[] = [];
    if (file.name.endsWith(".json")) {
      rows = JSON.parse(text);
    } else {
      const Papa = (await import("papaparse")).default;
      const { data } = Papa.parse(text, { header: true, skipEmptyLines: true });
      rows = data as any[];
    }
    if (!rows.length) { toast({ title: "No data found", variant: "destructive" }); return; }
    const toInsert = rows.map((r: any) => {
      const financial_year = r.financial_year || r.tax_year;
      return {
        financial_year, assessment_year: r.assessment_year || taxYearToAssessmentYear(financial_year), form_type: r.form_type,
        section_code: r.section_code, nature_of_payment: r.nature_of_payment,
        threshold_individual: parseFloat(r.threshold_individual) || 0,
        threshold_company: parseFloat(r.threshold_company) || 0,
        rate_individual: parseFloat(r.rate_individual) || null,
        rate_company: parseFloat(r.rate_company) || null,
        rate_no_pan: parseFloat(r.rate_no_pan) || null,
        effective_from: r.effective_from || null,
        firm_id: firmId, is_active: true, surcharge_applicable: false, cess_applicable: false,
      };
    });
    const { error } = await supabase.from("tds_rate_master").upsert(toInsert as any[], { onConflict: "assessment_year,form_type,section_code,firm_id" });
    if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
    else { toast({ title: `${toInsert.length} rates imported` }); setUploadOpen(false); fetchRates(); }
  };

  const fmt = (v: number | null) => v != null ? v.toLocaleString("en-IN") : "—";
  const fmtRate = (v: number | null) => v != null ? `${v}%` : "—";

  // ─── Fetch templates ───
  const fetchTemplates = useCallback(async () => {
    const forms = ["26Q", "24Q", "27Q", "27EQ"];
    const result: Record<string, any> = {};
    for (const form of forms) {
      const { data } = await supabase.storage.from("tds-templates").list("", { search: `${form}.xls` });
      if (data && data.length > 0) {
        const file = data.find(f => f.name.startsWith(form));
        if (file) {
          result[form] = { name: file.name, updated: file.updated_at || file.created_at || "", uploadedBy: "" };
        } else {
          result[form] = null;
        }
      } else {
        result[form] = null;
      }
    }
    setTemplates(result);
  }, []);

  useEffect(() => { if (activeTab === "templates") fetchTemplates(); }, [activeTab, fetchTemplates]);

  const uploadTemplate = async (formType: string, file: File) => {
    setUploadingTemplate(formType);
    const path = `${formType}.xls`;
    const { error } = await supabase.storage.from("tds-templates").upload(path, file, { upsert: true });
    if (error) toast({ title: "Upload error", description: error.message, variant: "destructive" });
    else { toast({ title: `${formType} template uploaded` }); fetchTemplates(); }
    setUploadingTemplate(null);
  };

  // ─── Effective date alerts ───
  const effectiveDateAlerts = useMemo(() => {
    return rates.filter(r => r.effective_from && r.effective_from !== "2025-04-01");
  }, [rates]);

  return (
    <div className="space-y-4">
      <Tabs value={activeTab} onValueChange={v => setActiveTab(v as any)}>
        <TabsList>
          <TabsTrigger value="rates">Rate Master</TabsTrigger>
          <TabsTrigger value="templates">XLS Templates</TabsTrigger>
        </TabsList>

        <TabsContent value="templates" className="space-y-4 mt-4">
          <div>
            <h2 className="text-xl font-bold text-foreground">XLS Templates</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Upload the blank Genius Software template files here (26Q.xls, 24Q.xls, 27Q.xls, 27EQ.xls).
              These templates are used to generate the export files for import into Genius Software.
              When you receive updated templates from Genius, upload them here to replace the old ones.
              The system writes your data into these templates exactly matching the Genius import format.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {(["26Q", "24Q", "27Q", "27EQ"] as const).map(form => (
              <Card key={form}>
                <CardHeader className="py-3 px-4">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <FileUp size={16} className="text-primary" />
                    Form {form} Template
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-4 pt-0 space-y-2">
                  {templates[form] ? (
                    <>
                      <p className="text-xs text-muted-foreground">
                        File: <span className="font-mono">{templates[form]!.name}</span>
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Last updated: {templates[form]!.updated ? new Date(templates[form]!.updated).toLocaleDateString() : "—"}
                      </p>
                      <Badge variant="outline" className="text-xs bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300">
                        Uploaded ✓
                      </Badge>
                    </>
                  ) : (
                    <p className="text-xs text-muted-foreground italic">No template uploaded yet</p>
                  )}
                  <div className="pt-1">
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1 text-xs"
                      disabled={uploadingTemplate === form}
                      onClick={() => {
                        const input = document.createElement("input");
                        input.type = "file";
                        input.accept = ".xls,.xlsx";
                        input.onchange = (ev: any) => {
                          const f = ev.target.files?.[0];
                          if (f) uploadTemplate(form, f);
                        };
                        input.click();
                      }}
                    >
                      <Upload size={12} />
                      {uploadingTemplate === form ? "Uploading..." : templates[form] ? "Replace Template" : "Upload Template"}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="rates" className="space-y-4 mt-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label className="text-xs">Tax Year</Label>
          <Select value={selectedTaxYear} onValueChange={setSelectedTaxYear}>
            <SelectTrigger className="w-[130px]"><SelectValue /></SelectTrigger>
            <SelectContent>{TAX_YEAR_OPTIONS.map(ty => <SelectItem key={ty} value={ty}>{ty}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <Tabs value={selectedForm} onValueChange={setSelectedForm} className="ml-2">
          <TabsList>
            {FORM_TYPES.map(f => <TabsTrigger key={f} value={f}>{f}</TabsTrigger>)}
          </TabsList>
        </Tabs>
        <div className="relative ml-auto">
          <Search size={14} className="absolute left-2.5 top-2.5 text-muted-foreground" />
          <Input className="pl-8 w-[200px]" placeholder="Search section..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
      </div>

      <div className="flex gap-2">
        <Button size="sm" className="gap-1" onClick={() => openAdd()}><Plus size={14} /> Add Section</Button>
        <Button size="sm" variant="outline" className="gap-1" onClick={importFromPrevYear}><Copy size={14} /> Import from Previous Year</Button>
        <Button size="sm" variant="outline" className="gap-1" onClick={() => setUploadOpen(true)}><Upload size={14} /> Upload New Year Rules</Button>
      </div>

      {is2025Regime && (
        <Card className="border-blue-200 dark:border-blue-900 bg-blue-50/40 dark:bg-blue-950/20">
          <CardContent className="p-3 space-y-2.5">
            <div className="flex items-start gap-2">
              <Info size={14} className="text-blue-600 dark:text-blue-400 mt-0.5 shrink-0" />
              <p className="text-[11px] text-muted-foreground leading-relaxed">{SECTION_393_DISCLAIMER}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="w-full sm:max-w-2xl">
                <SearchableSelect
                  options={sectionSelectOptions}
                  value={selectedSection}
                  onValueChange={setSelectedSection}
                  placeholder="Select a section — search by payment code, old section (194C…), 393, or description"
                  searchPlaceholder="Type a code, 194J, 393, rent, contractor…"
                  emptyText="No matching section."
                  className="w-full"
                  onCreateNew={(query) => openAdd(query)}
                  createNewLabel="Add new section"
                />
              </div>
              {selectedSection && (
                <Button size="sm" variant="ghost" className="text-xs h-8" onClick={() => setSelectedSection("")}>
                  Clear
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i}><CardContent className="p-4 space-y-3">
              <Skeleton className="h-5 w-24" />
              <Skeleton className="h-4 w-48" />
              <div className="grid grid-cols-3 gap-2">
                <Skeleton className="h-8 rounded" />
                <Skeleton className="h-8 rounded" />
                <Skeleton className="h-8 rounded" />
              </div>
            </CardContent></Card>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">
          No rates found. Click "Add Section" to add a new TDS section.
        </CardContent></Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filtered.map(r => {
            const info = is2025Regime ? resolveSection393(r.section_code) : null;
            return (
            <Card key={r.id} className="border border-border hover:shadow-md transition-shadow">
              <CardContent className="p-4">
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="outline" className="font-mono text-xs font-bold px-2 py-0.5 border-primary/40 text-primary">
                      {r.section_code}
                    </Badge>
                    {info && (
                      <>
                        <span className="text-muted-foreground text-xs">→</span>
                        <Badge className="font-mono text-[10px] px-1.5 py-0 bg-blue-100 text-blue-700 border border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-900">
                          §{info.newSection}
                        </Badge>
                      </>
                    )}
                    {r.effective_from && r.effective_from >= "2025-04-01" && (
                      <Badge className="text-[10px] px-1.5 py-0 bg-emerald-100 text-emerald-700 border border-emerald-200">
                        IT Act 2025
                      </Badge>
                    )}
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(r)}><Pencil size={12} /></Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleDelete(r.id)}><Trash2 size={12} className="text-destructive" /></Button>
                  </div>
                </div>

                <p className="text-sm font-medium text-foreground mb-2 leading-snug">{r.nature_of_payment || "—"}</p>

                {info && (
                  <div className="flex items-center gap-x-2 gap-y-1 flex-wrap mb-3 text-[10px] text-muted-foreground">
                    <span className="font-medium">Sec {info.newSection} · {info.categoryLabel}</span>
                    {info.paymentCode && (
                      <Badge
                        variant="outline"
                        className="font-mono text-[10px] px-1.5 py-0 border-amber-300 text-amber-700 dark:border-amber-800 dark:text-amber-300"
                        title="Indicative filing-utility payment code — verify against your TDS return utility before filing."
                      >
                        Code {info.paymentCode}
                      </Badge>
                    )}
                    {info.tableRef && <span className="font-mono">{info.tableRef}</span>}
                    {info.codeStatus === "indicative" && (
                      <span className="uppercase tracking-wide text-[9px] text-amber-600 dark:text-amber-400">indicative</span>
                    )}
                  </div>
                )}

                <div className="grid grid-cols-3 gap-2 mb-3">
                  <div className="bg-muted/50 rounded-md px-2 py-1.5 text-center">
                    <p className="text-[10px] text-muted-foreground mb-0.5">Rate (Ind)</p>
                    <p className="text-sm font-bold text-foreground">{fmtRate(r.rate_individual)}</p>
                  </div>
                  <div className="bg-muted/50 rounded-md px-2 py-1.5 text-center">
                    <p className="text-[10px] text-muted-foreground mb-0.5">Rate (Co.)</p>
                    <p className="text-sm font-bold text-foreground">{fmtRate(r.rate_company)}</p>
                  </div>
                  <div className="bg-red-50 dark:bg-red-950/20 rounded-md px-2 py-1.5 text-center border border-red-100 dark:border-red-900/30">
                    <p className="text-[10px] text-muted-foreground mb-0.5">No PAN</p>
                    <p className="text-sm font-bold text-destructive">{fmtRate(r.rate_no_pan)}</p>
                  </div>
                </div>

                <div className="flex items-center justify-between text-xs text-muted-foreground flex-wrap gap-1">
                  <span>Threshold: <span className="font-mono text-foreground">₹{fmt(r.threshold_individual)}</span> / <span className="font-mono text-foreground">₹{fmt(r.threshold_company)}</span></span>
                  <div className="flex gap-1">
                    {r.surcharge_applicable && <Badge variant="secondary" className="text-[10px] px-1.5 py-0">Surcharge</Badge>}
                    {r.cess_applicable && <Badge variant="secondary" className="text-[10px] px-1.5 py-0">Cess</Badge>}
                  </div>
                </div>

                {r.notes && (
                  <p className="text-[11px] text-muted-foreground mt-2 border-t pt-2 leading-relaxed italic">{r.notes}</p>
                )}
              </CardContent>
            </Card>
            );
          })}
        </div>
      )}

      {/* Add/Edit Sheet */}
      <Sheet open={formOpen} onOpenChange={setFormOpen}>
        <SheetContent className="w-full sm:max-w-md overflow-y-auto">
          <SheetHeader><SheetTitle>{editingRate ? "Edit" : "Add"} Rate — {selectedForm}</SheetTitle></SheetHeader>
          <div className="py-4 space-y-3">
            <div className="space-y-1">
              <Label>Section Code *</Label>
              <Input value={formData.section_code || ""} onChange={e => setFormData(p => ({ ...p, section_code: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label>Nature of Payment</Label>
              <Input value={formData.nature_of_payment || ""} onChange={e => setFormData(p => ({ ...p, nature_of_payment: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Threshold (Individual)</Label>
                <Input type="number" value={formData.threshold_individual} onChange={e => setFormData(p => ({ ...p, threshold_individual: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label>Threshold (Company)</Label>
                <Input type="number" value={formData.threshold_company} onChange={e => setFormData(p => ({ ...p, threshold_company: e.target.value }))} />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1">
                <Label>Rate Ind (%)</Label>
                <Input type="number" value={formData.rate_individual} onChange={e => setFormData(p => ({ ...p, rate_individual: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label>Rate Co. (%)</Label>
                <Input type="number" value={formData.rate_company} onChange={e => setFormData(p => ({ ...p, rate_company: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label>No PAN Rate (%)</Label>
                <Input type="number" value={formData.rate_no_pan} onChange={e => setFormData(p => ({ ...p, rate_no_pan: e.target.value }))} />
              </div>
            </div>
            <div className="flex gap-6">
              <div className="flex items-center gap-2">
                <Switch checked={formData.surcharge_applicable} onCheckedChange={v => setFormData(p => ({ ...p, surcharge_applicable: v }))} />
                <Label>Surcharge</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={formData.cess_applicable} onCheckedChange={v => setFormData(p => ({ ...p, cess_applicable: v }))} />
                <Label>Cess</Label>
              </div>
            </div>
            <div className="space-y-1">
              <Label>Effective From</Label>
              <Input type="date" value={formData.effective_from || ""} onChange={e => setFormData(p => ({ ...p, effective_from: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label>Notes</Label>
              <Input value={formData.notes || ""} onChange={e => setFormData(p => ({ ...p, notes: e.target.value }))} />
            </div>
          </div>
          <SheetFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>{saving ? "Saving..." : editingRate ? "Update" : "Save"}</Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* Upload Dialog */}
      <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Upload New Year TDS Rules</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            Upload a JSON or CSV file with new year TDS rules to activate new rates.
          </p>
          <p className="text-xs text-muted-foreground">
            Required columns: financial_year (Tax Year, e.g. "2026-27"), form_type, section_code, nature_of_payment, threshold_individual, threshold_company, rate_individual, rate_company, rate_no_pan, effective_from. assessment_year is optional — auto-computed from financial_year if omitted.
          </p>
          <div className="mt-3">
            <Input type="file" accept=".json,.csv" onChange={e => {
              const file = e.target.files?.[0];
              if (file) handleUpload(file);
            }} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUploadOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* Effective Date Alerts */}
      {activeTab === "rates" && effectiveDateAlerts.length > 0 && (
        <Card className="border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20">
          <CardContent className="p-3">
            <div className="flex items-center gap-2 mb-2">
              <AlertCircle size={14} className="text-amber-600" />
              <span className="text-xs font-semibold text-amber-700 dark:text-amber-300">Mid-Year Rate Changes Detected</span>
            </div>
            <div className="space-y-1">
              {effectiveDateAlerts.map(r => (
                <p key={r.id} className="text-xs text-muted-foreground">
                  Section <strong>{r.section_code}</strong> — effective from <strong>{r.effective_from}</strong>
                  {r.notes && ` (${r.notes})`}
                </p>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
      </TabsContent>
      </Tabs>
    </div>
  );
}
