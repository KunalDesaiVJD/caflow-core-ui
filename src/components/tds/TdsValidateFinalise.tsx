import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getDefaultTdsQuarter, isQuarterInTdsRange, clientHasTdsForm } from "@/lib/tdsQuarter";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  ShieldCheck, AlertTriangle, XCircle, Info, CheckCircle2,
  Download, ExternalLink, Play,
} from "lucide-react";
import { exportToExcel } from "@/lib/exportUtils";

interface ClientOption {
  id: string; name: string | null; pan: string | null; tan_number?: string | null;
  tds_start_fy?: string; tds_start_quarter?: string; tds_end_fy?: string; tds_end_quarter?: string;
  tds_forms_applicable?: string[];
}

interface Props {
  clients: ClientOption[];
  isSuperadmin: boolean;
  resolveFirmId: () => Promise<string | null>;
  onNavigateDataEntry?: (filingId: string) => void;
}

interface ValidationItem {
  code: string;
  severity: "error" | "warning" | "info";
  description: string;
  affectedEntity: string;
  entityId?: string;
  challanId?: string;
  reviewed?: boolean;
}

const FY_OPTIONS = Array.from({ length: 7 }, (_, i) => { const s = 2020 + i; return `${s}-${String(s + 1).slice(2)}`; });
const QUARTER_OPTIONS = ["Q1", "Q2", "Q3", "Q4"];
const TDS_FORMS = ["24Q", "26Q", "27Q", "27EQ"];
const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

const getQuarterDates = (fy: string, quarter: string) => {
  const fyStart = parseInt(fy.split("-")[0]);
  const ranges: Record<string, { start: Date; end: Date }> = {
    Q1: { start: new Date(fyStart, 3, 1), end: new Date(fyStart, 5, 30) },
    Q2: { start: new Date(fyStart, 6, 1), end: new Date(fyStart, 8, 30) },
    Q3: { start: new Date(fyStart, 9, 1), end: new Date(fyStart, 11, 31) },
    Q4: { start: new Date(fyStart + 1, 0, 1), end: new Date(fyStart + 1, 2, 31) },
  };
  return ranges[quarter] || ranges.Q1;
};

export function TdsValidateFinalise({ clients, isSuperadmin, resolveFirmId, onNavigateDataEntry }: Props) {
  const { user } = useAuth();
  const { toast } = useToast();

  const [selClient, setSelClient] = useState("");
  const defaultTdsQuarter = useMemo(() => getDefaultTdsQuarter(), []);
  const [selFy, setSelFy] = useState(defaultTdsQuarter.fy);
  const [selQuarter, setSelQuarter] = useState(defaultTdsQuarter.quarter);
  const [selForm, setSelForm] = useState("26Q");

  const [loading, setLoading] = useState(false);
  const [validated, setValidated] = useState(false);
  const [results, setResults] = useState<ValidationItem[]>([]);
  const [reviewedCodes, setReviewedCodes] = useState<Set<string>>(new Set());

  const [filing, setFiling] = useState<any>(null);
  const [challans, setChallans] = useState<any[]>([]);
  const [deductees, setDeductees] = useState<any[]>([]);
  const [rateMaster, setRateMaster] = useState<any[]>([]);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [finalising, setFinalising] = useState(false);

  const errors = useMemo(() => results.filter(r => r.severity === "error"), [results]);
  const warnings = useMemo(() => results.filter(r => r.severity === "warning"), [results]);
  const infos = useMemo(() => results.filter(r => r.severity === "info"), [results]);

  const totalDeductees = deductees.length;
  const totalChallans = challans.length;
  const totalTds = useMemo(() => deductees.reduce((s, d) => s + (d.total_tax_deducted || d.tds_amount || 0), 0), [deductees]);

  const runValidation = async () => {
    if (!selClient) { toast({ title: "Select a client", variant: "destructive" }); return; }

    // TDS Compliance is the single source of truth for module membership —
    // block validation for a client with no TDS Compliance configured at
    // all, or for a (FY, quarter) outside their configured period.
    const selectedClient = clients.find(c => c.id === selClient);
    if (!selectedClient?.tds_start_fy) {
      toast({ title: "TDS Compliance not configured", description: "This client has no TDS Compliance / Start Quarter set in Edit Client → Service Specific.", variant: "destructive" });
      return;
    }
    if (!isQuarterInTdsRange(
      selFy, selQuarter,
      selectedClient.tds_start_fy, selectedClient.tds_start_quarter || "Q1",
      selectedClient.tds_end_fy, selectedClient.tds_end_quarter,
    )) {
      const rangeLabel = `${selectedClient.tds_start_quarter} ${selectedClient.tds_start_fy}` +
        (selectedClient.tds_end_fy ? ` to ${selectedClient.tds_end_quarter} ${selectedClient.tds_end_fy}` : " onward (no end date)");
      toast({ title: "Outside TDS compliance period", description: `This client's TDS compliance period is ${rangeLabel}.`, variant: "destructive" });
      return;
    }

    // TDS Forms Applicable — block validation for a form the client isn't
    // currently configured for.
    if (!clientHasTdsForm(selectedClient?.tds_forms_applicable, selForm)) {
      toast({ title: "Form not applicable", description: `This client is not configured for ${selForm} under TDS Compliance.`, variant: "destructive" });
      return;
    }

    setLoading(true);
    setValidated(false);
    setResults([]);
    setReviewedCodes(new Set());

    // Fetch filing
    const { data: filingData } = await supabase.from("tds_filings").select("*")
      .eq("client_id", selClient).eq("financial_year", selFy).eq("quarter", selQuarter).limit(10);
    const match = (filingData || []).find((f: any) => (f.tds_forms || []).includes(selForm));
    
    if (!match) {
      toast({ title: "No filing found for this combination", variant: "destructive" });
      setLoading(false);
      return;
    }
    setFiling(match);

    // Fetch challans & deductees
    const { data: challanData } = await supabase.from("tds_challans").select("*").eq("filing_id", match.id);
    const cList = challanData || [];
    setChallans(cList);

    const challanIds = cList.map((c: any) => c.id);
    let dList: any[] = [];
    if (challanIds.length > 0) {
      const { data: deducteeData } = await supabase.from("tds_deductees").select("*").in("challan_id", challanIds);
      dList = deducteeData || [];
    }
    setDeductees(dList);

    // Fetch rate master
    const { data: rates } = await supabase.from("tds_rate_master").select("*").eq("form_type", selForm).eq("is_active", true);
    setRateMaster(rates || []);

    // Run validation rules
    const items: ValidationItem[] = [];
    const qDates = getQuarterDates(selFy, selQuarter);
    const today = new Date();

  // E006: No challans entered
    if (cList.length === 0) {
    items.push({ code: "E006", severity: "error", description: "No challans entered for this filing", affectedEntity: "Filing" });
    }

    // E009: TAN missing
    if (!match.tan) {
      items.push({ code: "E009", severity: "error", description: "TAN of deductor not present in filing record", affectedEntity: "Filing" });
    }

    // Challan-level checks
    for (const c of cList) {
      // E002: BSR code format
      if (c.bsr_code && !/^\d{7}$/.test(c.bsr_code)) {
        items.push({ code: "E002", severity: "error", description: `BSR Code "${c.bsr_code}" is not 7 digits`, affectedEntity: `Challan #${c.challan_serial_no || '?'}`, challanId: c.id });
      }
      // E003: Challan number format
      if (c.challan_serial_no && !/^\d{5}$/.test(c.challan_serial_no)) {
        items.push({ code: "E003", severity: "error", description: `Challan Number "${c.challan_serial_no}" is not 5 digits`, affectedEntity: `Challan #${c.challan_serial_no || '?'}`, challanId: c.id });
      }
      // E004: Future deposit date
      if (c.deposit_date && new Date(c.deposit_date) > today) {
        items.push({ code: "E004", severity: "error", description: "Date of deposit is in the future", affectedEntity: `Challan #${c.challan_serial_no || '?'}`, challanId: c.id });
      }
      // E005: Before quarter start
      if (c.deposit_date && new Date(c.deposit_date) < qDates.start) {
        items.push({ code: "E005", severity: "error", description: "Date of deposit is before start of quarter", affectedEntity: `Challan #${c.challan_serial_no || '?'}`, challanId: c.id });
      }
      // E014: Deductee TDS != challan amount (>Rs.5)
      const challanDeductees = dList.filter((d: any) => d.challan_id === c.id);
      const sumDeducteeTds = challanDeductees.reduce((s: number, d: any) => s + (d.total_tax_deducted || d.tds_amount || 0), 0);
      if (Math.abs(sumDeducteeTds - (c.total_tax_deposited || 0)) > 5) {
        items.push({ code: "E014", severity: "error", description: `Total deductee TDS (₹${sumDeducteeTds.toFixed(0)}) doesn't match challan tax (₹${(c.total_tax_deposited || 0).toFixed(0)})`, affectedEntity: `Challan #${c.challan_serial_no || '?'}`, challanId: c.id });
      }

      // E016: Challans exist but TDS=0
      if ((c.total_tax_deposited || 0) === 0 && sumDeducteeTds > 0) {
        items.push({ code: "E016", severity: "error", description: "Challans exist but TDS deposited is zero while deductees have TDS > 0", affectedEntity: `Challan #${c.challan_serial_no || '?'}`, challanId: c.id });
      }

      // W005: Late deposit (>7 days after month end)
      if (c.deposit_date) {
        const depDate = new Date(c.deposit_date);
        const monthEnd = new Date(depDate.getFullYear(), depDate.getMonth(), 0);
        const diffDays = Math.floor((depDate.getTime() - monthEnd.getTime()) / (1000 * 60 * 60 * 24));
        if (diffDays > 7) {
          items.push({ code: "W005", severity: "warning", description: "Challan deposit date is more than 7 days after month-end (late deposit)", affectedEntity: `Challan #${c.challan_serial_no || '?'}`, challanId: c.id });
        }
      }

      // W010: Interest on late deposit
      // Only flag if deposit is late and interest is 0
      const qEndPlus15 = new Date(qDates.end);
      qEndPlus15.setDate(qEndPlus15.getDate() + 15);
      if (c.deposit_date && new Date(c.deposit_date) > qEndPlus15 && (c.interest_deposited || 0) === 0) {
        items.push({ code: "W010", severity: "warning", description: "Interest on late deposit not included in challan", affectedEntity: `Challan #${c.challan_serial_no || '?'}`, challanId: c.id });
      }
    }

    // Deductee-level checks
    const panCount: Record<string, number> = {};
    const noPanCount = { total: 0 };

    for (const d of dList) {
      const dName = d.deductee_name || "Unnamed";
      const challan = cList.find((c: any) => c.id === d.challan_id);

      // E001: PAN format
      if (d.deductee_pan && !d.pan_not_available) {
        if (!PAN_REGEX.test(d.deductee_pan.toUpperCase())) {
          items.push({ code: "E001", severity: "error", description: `PAN "${d.deductee_pan}" has invalid format`, affectedEntity: dName, entityId: d.id, challanId: d.challan_id });
        }
      }

      // E007: Deductee TDS > challan amount (>Rs.5)
      if (challan && (d.total_tax_deducted || d.tds_amount || 0) > (challan.total_challan_amount || 0) + 5) {
        items.push({ code: "E007", severity: "error", description: "TDS amount in deductee exceeds challan amount", affectedEntity: dName, entityId: d.id, challanId: d.challan_id });
      }

      // E008: Section code missing
      if (!d.section_code) {
        items.push({ code: "E008", severity: "error", description: "Section code missing", affectedEntity: dName, entityId: d.id, challanId: d.challan_id });
      }

      // E013: Payment date after deduction date
      if (d.date_of_payment && d.date_of_deduction && new Date(d.date_of_payment) > new Date(d.date_of_deduction)) {
        items.push({ code: "E013", severity: "error", description: "Payment date is after deduction date", affectedEntity: dName, entityId: d.id, challanId: d.challan_id });
      }

      // E012: Amount=0 but TDS>0
      if ((d.amount_paid_credited || 0) === 0 && (d.total_tax_deducted || d.tds_amount || 0) > 0) {
        items.push({ code: "E012", severity: "error", description: "Amount paid/credited is zero but TDS amount is non-zero", affectedEntity: dName, entityId: d.id, challanId: d.challan_id });
      }

      // E010: Deductee name blank
      if (!d.deductee_name?.trim()) {
        items.push({ code: "E010", severity: "error", description: "Deductee name is blank", affectedEntity: "Unnamed deductee", entityId: d.id, challanId: d.challan_id });
      }

      // E011: PAN=PANNOTAVBL no reason code
      if (d.deductee_pan?.toUpperCase().startsWith("PANNOTAVBL") && !d.reason_for_lower_or_nil_deduction) {
        items.push({ code: "E011", severity: "error", description: "PAN marked as not available but no reason code provided", affectedEntity: dName, entityId: d.id, challanId: d.challan_id });
      }

      // E017: Section invalid for this form type
      if (d.section_code) {
        const validSections = (rates || []).map((r: any) => r.section_code);
        if (validSections.length > 0 && !validSections.includes(d.section_code)) {
          items.push({ code: "E017", severity: "error", description: `Section "${d.section_code}" is not valid for form ${selForm}`, affectedEntity: dName, entityId: d.id, challanId: d.challan_id });
        }
      }

      // W001: PANNOTAVBL
      if (d.pan_not_available || d.deductee_pan?.toUpperCase().startsWith("PANNOTAVBL")) {
        noPanCount.total++;
        items.push({ code: "W001", severity: "warning", description: "PAN not available — ensure reason code is correct", affectedEntity: dName, entityId: d.id, challanId: d.challan_id });
      }

      // W002: Rate deviation
      if (d.section_code && d.rate_of_tds !== null) {
        const rateMatch = (rates || []).find((r: any) => r.section_code === d.section_code);
        if (rateMatch) {
          const stdRate = rateMatch.rate_individual || 0;
          if (Math.abs((d.rate_of_tds || 0) - stdRate) > 0.5) {
            items.push({ code: "W002", severity: "warning", description: `TDS rate ${d.rate_of_tds}% deviates from standard ${stdRate}%`, affectedEntity: dName, entityId: d.id, challanId: d.challan_id });
          }
        }
      }

      // Track duplicates
      const dupKey = `${d.deductee_pan}_${d.section_code}`;
      panCount[dupKey] = (panCount[dupKey] || 0) + 1;

      // W004: Payment date in previous quarter
      if (d.date_of_payment) {
        const payDate = new Date(d.date_of_payment);
        if (payDate < qDates.start) {
          items.push({ code: "W004", severity: "warning", description: "Payment date is in previous quarter", affectedEntity: dName, entityId: d.id, challanId: d.challan_id });
        }
      }

      // W007: Lower deduction cert but higher rate
      if (d.lower_deduction_certificate_no && d.rate_of_tds !== null) {
        // Just flag as info that cert is present
        const rateMatch = (rates || []).find((r: any) => r.section_code === d.section_code);
        if (rateMatch && (d.rate_of_tds || 0) > (rateMatch.rate_individual || 0)) {
          items.push({ code: "W007", severity: "warning", description: "Lower deduction certificate present but rate is higher than standard", affectedEntity: dName, entityId: d.id, challanId: d.challan_id });
        }
      }

      // W008: Reason A but above threshold
      if (d.reason_for_lower_or_nil_deduction === "A") {
        const rateMatch = (rates || []).find((r: any) => r.section_code === d.section_code);
        if (rateMatch && (d.amount_paid_credited || 0) > (rateMatch.threshold_individual || 0) && (rateMatch.threshold_individual || 0) > 0) {
          items.push({ code: "W008", severity: "warning", description: "Reason code A (no deduction) but payment exceeds threshold", affectedEntity: dName, entityId: d.id, challanId: d.challan_id });
        }
      }

      // W009: Cess not computed
      if ((d.total_tax_deducted || d.tds_amount || 0) > 0 && (d.cess_amount || 0) === 0) {
        items.push({ code: "W009", severity: "warning", description: "Cess not computed (should be 4% of tax + surcharge)", affectedEntity: dName, entityId: d.id, challanId: d.challan_id });
      }

      // I001: Below threshold but deducted
      if (d.section_code) {
        const rateMatch = (rates || []).find((r: any) => r.section_code === d.section_code);
        if (rateMatch && (rateMatch.threshold_individual || 0) > 0 && (d.amount_paid_credited || 0) < (rateMatch.threshold_individual || 0) && (d.total_tax_deducted || d.tds_amount || 0) > 0) {
          items.push({ code: "I001", severity: "info", description: "Payment below threshold but TDS has been deducted", affectedEntity: dName, entityId: d.id, challanId: d.challan_id });
        }
      }

      // I002: 194Q applicability
      if (d.section_code === "194Q" && (d.amount_paid_credited || 0) > 5000000) {
        items.push({ code: "I002", severity: "info", description: "Section 194Q applicable (purchase > ₹50L) — consider TDS vs TCS", affectedEntity: dName, entityId: d.id, challanId: d.challan_id });
      }

      // I003: Senior citizen 194A
      if (d.section_code === "194A" || d.section_code === "194A-SC") {
        items.push({ code: "I003", severity: "info", description: "Check if senior citizen — higher threshold of ₹50,000 may apply", affectedEntity: dName, entityId: d.id, challanId: d.challan_id });
      }
    }

    // W003: Duplicate deductees
    for (const [key, count] of Object.entries(panCount)) {
      if (count > 1 && key !== "undefined_undefined" && key !== "null_null") {
        const [pan, sec] = key.split("_");
        items.push({ code: "W003", severity: "warning", description: `Deductee PAN ${pan} appears ${count} times with section ${sec} (possible duplicate)`, affectedEntity: `PAN: ${pan}` });
      }
    }

    // W006: No-PAN >30%
    if (dList.length > 0 && (noPanCount.total / dList.length) > 0.3) {
      items.push({ code: "W006", severity: "warning", description: `No PAN deductees exceed 30% of total (${noPanCount.total}/${dList.length}) — TDSCPC may query`, affectedEntity: "Filing" });
    }

    // E015: Duplicate Challan Number (globally unique; BSR can repeat but Challan Number cannot)
    const challanNumSet = new Set<string>();
    for (const c of cList) {
      if (c.challan_serial_no) {
        if (challanNumSet.has(c.challan_serial_no)) {
          items.push({ code: "E015", severity: "error", description: `Duplicate Challan Number "${c.challan_serial_no}" — each Challan Number must be unique`, affectedEntity: `Challan #${c.challan_serial_no}`, challanId: c.id });
        }
        challanNumSet.add(c.challan_serial_no);
      }
    }

    setResults(items);
    setValidated(true);
    setLoading(false);
  };

  const toggleReviewed = (code: string, idx: number) => {
    const key = `${code}_${idx}`;
    setReviewedCodes(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const handleFinalise = async () => {
    if (!filing) return;
    setFinalising(true);
    const { error } = await supabase.from("tds_filings").update({
      work_status: "Filed",
      last_updated_by: user?.id,
      last_updated_at: new Date().toISOString(),
    }).eq("id", filing.id);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Return marked as Filed" });
      setFiling({ ...filing, work_status: "Filed" });
    }
    setFinalising(false);
    setConfirmOpen(false);
  };

  const exportErrors = () => {
    const rows = results.map((r, i) => ({
      "Code": r.code,
      "Severity": r.severity.toUpperCase(),
      "Description": r.description,
      "Affected Entity": r.affectedEntity,
      "Reviewed": reviewedCodes.has(`${r.code}_${i}`) ? "Yes" : "No",
    }));
    exportToExcel([{ sheetName: "Validation Results", rows }], `TDS_Validation_${selClient}_${selFy}_${selQuarter}_${selForm}.xlsx`);
  };

  const renderResultsTable = (items: ValidationItem[], severityLabel: string) => (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-[80px]">Code</TableHead>
          <TableHead className="w-[80px]">Severity</TableHead>
          <TableHead>Description</TableHead>
          <TableHead className="w-[180px]">Affected</TableHead>
          {severityLabel !== "error" && <TableHead className="w-[100px]">Reviewed</TableHead>}
          <TableHead className="w-[80px]">Action</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.length === 0 ? (
          <TableRow>
            <TableCell colSpan={6} className="text-center text-muted-foreground py-6">
              No {severityLabel}s found ✓
            </TableCell>
          </TableRow>
        ) : items.map((item, idx) => {
          const globalIdx = results.indexOf(item);
          const isReviewed = reviewedCodes.has(`${item.code}_${globalIdx}`);
          return (
            <TableRow key={`${item.code}-${idx}`} className={cn(isReviewed && "opacity-50")}>
              <TableCell><Badge variant="outline" className="font-mono text-xs">{item.code}</Badge></TableCell>
              <TableCell>
                <Badge className={cn("text-xs",
                  item.severity === "error" ? "bg-destructive text-destructive-foreground" :
                  item.severity === "warning" ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300" :
                  "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
                )}>
                  {item.severity === "error" ? <XCircle size={10} className="mr-1" /> :
                   item.severity === "warning" ? <AlertTriangle size={10} className="mr-1" /> :
                   <Info size={10} className="mr-1" />}
                  {item.severity}
                </Badge>
              </TableCell>
              <TableCell className="text-sm">{item.description}</TableCell>
              <TableCell className="text-sm font-medium">{item.affectedEntity}</TableCell>
              {severityLabel !== "error" && (
                <TableCell>
                  <Switch
                    checked={isReviewed}
                    onCheckedChange={() => toggleReviewed(item.code, globalIdx)}
                  />
                </TableCell>
              )}
              <TableCell>
                {item.challanId && onNavigateDataEntry && (
                  <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={() => onNavigateDataEntry(filing?.id)}>
                    <ExternalLink size={12} /> Fix
                  </Button>
                )}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold text-foreground">Validate & Finalise</h2>
        <p className="text-sm text-muted-foreground">Run validation checks and finalise returns for filing</p>
      </div>

      {/* Filter Bar */}
      <div className="flex flex-wrap gap-3 items-end">
        <div className="space-y-1">
          <Label className="text-xs">Client</Label>
          <Select value={selClient} onValueChange={setSelClient}>
            <SelectTrigger className="w-[220px]"><SelectValue placeholder="Select client" /></SelectTrigger>
            <SelectContent>
              {clients
                .filter(c => clientHasTdsForm(c.tds_forms_applicable, selForm))
                .map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
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
            <SelectTrigger className="w-[100px]"><SelectValue /></SelectTrigger>
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
        <Button size="lg" className="gap-2 font-semibold" onClick={runValidation} disabled={loading || !selClient}>
          <Play size={16} /> {loading ? "Validating..." : "Run Validation"}
        </Button>
      </div>

      {loading && (
        <div className="space-y-3">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      )}

      {validated && !loading && (
        <>
          {/* Summary Bar */}
          <div className="flex gap-4 items-center p-4 rounded-lg border bg-card">
            <div className="flex items-center gap-2">
              <XCircle size={18} className="text-destructive" />
              <span className="text-sm font-medium">Errors: </span>
              <Badge variant={errors.length > 0 ? "destructive" : "outline"} className="font-bold">{errors.length}</Badge>
            </div>
            <div className="flex items-center gap-2">
              <AlertTriangle size={18} className="text-amber-600" />
              <span className="text-sm font-medium">Warnings: </span>
              <Badge className={cn("font-bold", warnings.length > 0 ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300" : "")} variant={warnings.length === 0 ? "outline" : "default"}>{warnings.length}</Badge>
            </div>
            <div className="flex items-center gap-2">
              <Info size={18} className="text-blue-600" />
              <span className="text-sm font-medium">Info: </span>
              <Badge variant="outline" className="font-bold">{infos.length}</Badge>
            </div>
            <div className="flex-1" />
            <Button variant="outline" size="sm" className="gap-1" onClick={exportErrors}>
              <Download size={14} /> Export List
            </Button>
          </div>

          {/* Tabbed Results */}
          <Tabs defaultValue="errors">
            <TabsList>
              <TabsTrigger value="errors" className="gap-1">
                <XCircle size={14} /> Errors ({errors.length})
              </TabsTrigger>
              <TabsTrigger value="warnings" className="gap-1">
                <AlertTriangle size={14} /> Warnings ({warnings.length})
              </TabsTrigger>
              <TabsTrigger value="info" className="gap-1">
                <Info size={14} /> Info ({infos.length})
              </TabsTrigger>
            </TabsList>
            <TabsContent value="errors">
              <Card><CardContent className="p-0 overflow-x-auto">{renderResultsTable(errors, "error")}</CardContent></Card>
            </TabsContent>
            <TabsContent value="warnings">
              <Card><CardContent className="p-0 overflow-x-auto">{renderResultsTable(warnings, "warning")}</CardContent></Card>
            </TabsContent>
            <TabsContent value="info">
              <Card><CardContent className="p-0 overflow-x-auto">{renderResultsTable(infos, "info")}</CardContent></Card>
            </TabsContent>
          </Tabs>

          {/* Finalise Section */}
          {errors.length === 0 && (
            <Card className="border-emerald-200 dark:border-emerald-800">
              <CardContent className="p-6">
                <div className="flex items-center gap-3 mb-4">
                  <CheckCircle2 size={24} className="text-emerald-600" />
                  <div>
                    <p className="font-semibold text-foreground">No errors found — ready to finalise</p>
                    <p className="text-sm text-muted-foreground">
                      {warnings.length > 0 ? `${warnings.length} warning(s) found. Review them before finalising.` : "All validations passed."}
                    </p>
                  </div>
                </div>

                {filing?.work_status === "Filed" ? (
                  <div className="p-4 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800">
                    <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-300">
                      ✓ Return marked as Filed. Generate Genius XLS Export from the Reports section.
                    </p>
                  </div>
                ) : (
                  <Button size="lg" className="gap-2" onClick={() => setConfirmOpen(true)}>
                    <ShieldCheck size={16} /> Mark Return as Ready to File
                  </Button>
                )}
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* Confirmation Dialog */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Finalisation</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-4">
            <div className="grid grid-cols-3 gap-4">
              <div className="text-center p-3 rounded-lg bg-muted">
                <p className="text-2xl font-bold text-foreground">{totalDeductees}</p>
                <p className="text-xs text-muted-foreground">Deductees</p>
              </div>
              <div className="text-center p-3 rounded-lg bg-muted">
                <p className="text-2xl font-bold text-foreground">{totalChallans}</p>
                <p className="text-xs text-muted-foreground">Challans</p>
              </div>
              <div className="text-center p-3 rounded-lg bg-muted">
                <p className="text-2xl font-bold text-foreground">₹{totalTds.toLocaleString("en-IN")}</p>
                <p className="text-xs text-muted-foreground">Total TDS</p>
              </div>
            </div>
            <p className="text-sm text-muted-foreground">
              This will update the filing status to "Return Prepared". Are you sure you want to proceed?
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>Cancel</Button>
            <Button onClick={handleFinalise} disabled={finalising}>
              {finalising ? "Finalising..." : "Confirm & Finalise"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
