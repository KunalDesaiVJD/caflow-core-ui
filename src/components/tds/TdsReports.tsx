import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import {
  FileText, Users, Receipt, BarChart3, FileSpreadsheet,
  AlertTriangle, Award, Download, Printer, ArrowLeft,
  ClipboardList, CalendarCheck, Shield, ShieldCheck, Loader2, Info,
} from "lucide-react";
import { exportToExcel } from "@/lib/exportUtils";
import { generateGeniusExport } from "@/lib/genius-export";
import { clientHasTdsForm, isFilingTdsCompliant, getDefaultTdsQuarter } from "@/lib/tdsQuarter";
import { reportFileName } from "@/lib/tds/tdsReport";
import { buildOverviewWorkbook, downloadWorkbook } from "@/lib/tds/tdsReportExcel";
import { exportOverviewPdf } from "@/lib/tds/tdsReportPdf";
import { fetchFilingReport, mergeQuarterlyReports, type QuarterReportInput } from "@/lib/tds/tdsOverviewFetch";

interface ClientOption {
  id: string; name: string | null; pan: string | null; tan_number?: string | null;
  tds_start_fy?: string; tds_start_quarter?: string; tds_end_fy?: string; tds_end_quarter?: string;
  tds_forms_applicable?: string[];
}

interface Props {
  clients: ClientOption[];
  isSuperadmin: boolean;
  resolveFirmId: () => Promise<string | null>;
}

const FY_OPTIONS = Array.from({ length: 7 }, (_, i) => { const s = 2020 + i; return `${s}-${String(s + 1).slice(2)}`; });
const QUARTER_OPTIONS = ["Q1", "Q2", "Q3", "Q4"];
const TDS_FORMS = ["24Q", "26Q", "27Q", "27EQ"];

const formatINR = (n: number) => `₹${n.toLocaleString("en-IN")}`;
const fmtDate = (d: string | null) => { if (!d) return "—"; try { return format(new Date(d), "dd/MM/yyyy"); } catch { return d; } };

type ReportType = "filing-status" | "deductee-wise" | "challan-register" | "section-summary" | "annual-summary" | "non-filer" | "lower-cert" | "cross-quarter" | "genius-export" | "overview-report" | null;

const REPORT_CARDS: { key: ReportType; label: string; desc: string; icon: any; color: string }[] = [
  { key: "filing-status", label: "Filing Status Report", desc: "All clients, all forms, any period", icon: ClipboardList, color: "text-blue-600" },
  { key: "deductee-wise", label: "Deductee-wise Report", desc: "One deductee across all quarters", icon: Users, color: "text-emerald-600" },
  { key: "challan-register", label: "Challan Register", desc: "All challans for a client", icon: Receipt, color: "text-purple-600" },
  { key: "section-summary", label: "Section-wise Summary", desc: "TDS by section code", icon: BarChart3, color: "text-amber-600" },
  { key: "annual-summary", label: "Annual TDS Summary", desc: "Full year summary per client", icon: CalendarCheck, color: "text-emerald-500" },
  { key: "non-filer", label: "No-PAN Report", desc: "Deductees without PAN", icon: AlertTriangle, color: "text-destructive" },
  { key: "lower-cert", label: "Lower Deduction Certificate", desc: "Register of lower deduction certs", icon: Shield, color: "text-purple-500" },
  { key: "cross-quarter", label: "Cross-Quarter Report", desc: "Same deductee across quarters", icon: FileText, color: "text-blue-500" },
  { key: "genius-export", label: "Genius Export", desc: "Generate XLS for Genius software", icon: FileSpreadsheet, color: "text-emerald-700" },
  { key: "overview-report", label: "Overview Report", desc: "Stage 1-4 validation, consolidated across one, several, or every quarter", icon: ShieldCheck, color: "text-indigo-600" },
];

export function TdsReports({ clients, isSuperadmin, resolveFirmId }: Props) {
  const { toast } = useToast();
  // Reports seed from the SAME active quarter/FY the rest of the TDS module uses
  // (Dashboard / Workspace / Validate all default from getDefaultTdsQuarter()).
  // Only that single quarter is pre-selected by default — never all four. Users
  // can still toggle additional quarters via the chips below.
  const smartDefault = useMemo(() => getDefaultTdsQuarter(), []);
  const [selectedReport, setSelectedReport] = useState<ReportType>(null);
  const [selClient, setSelClient] = useState("all");
  const [selFy, setSelFy] = useState(smartDefault.fy);
  const [selQuarters, setSelQuarters] = useState<string[]>([smartDefault.quarter]);
  const [selForm, setSelForm] = useState("26Q");
  const [loading, setLoading] = useState(false);
  const [reportData, setReportData] = useState<any[]>([]);
  const [exportingOverview, setExportingOverview] = useState(false);

  const toggleQuarter = (q: string) => {
    setSelQuarters(prev => prev.includes(q) ? prev.filter(x => x !== q) : [...prev, q]);
  };

  // TDS Compliance is the single source of truth for whether a filing row
  // belongs in any report — applied UNCONDITIONALLY (every report type, not
  // only genius-export/cross-quarter's form selector). A stale row for a
  // form the client is no longer configured for, or outside their
  // Start/End Quarter range, must never surface in any report.
  const isCompliant = (f: { client_id: string; financial_year: string; quarter: string; tds_forms?: string[] | null }) => {
    const client = clients.find(c => c.id === f.client_id);
    return isFilingTdsCompliant(f as any, client);
  };

  const fetchReportData = async () => {
    setLoading(true);
    setReportData([]);

    const firmId = await resolveFirmId();

    if (selectedReport === "filing-status") {
      let q = supabase.from("tds_filings").select("*").eq("financial_year", selFy).order("created_at", { ascending: false });
      if (!isSuperadmin && firmId) q = q.eq("firm_id", firmId);
      if (selClient !== "all") q = q.eq("client_id", selClient);
      const { data } = await q;
      setReportData((data || []).filter(isCompliant));
    } else if (selectedReport === "challan-register" || selectedReport === "deductee-wise" || selectedReport === "section-summary" || selectedReport === "annual-summary" || selectedReport === "non-filer" || selectedReport === "lower-cert" || selectedReport === "cross-quarter" || selectedReport === "genius-export") {
      // Get filings first
      let fq = supabase.from("tds_filings").select("id, client_id, financial_year, quarter, tds_forms, tan, work_status")
        .eq("financial_year", selFy);
      if (!isSuperadmin && firmId) fq = fq.eq("firm_id", firmId);
      if (selClient !== "all") fq = fq.eq("client_id", selClient);
      const { data: rawFilings } = await fq;
      const filings = (rawFilings || []).filter(isCompliant);
      const filingIds = filings.map((f: any) => f.id);

      if (filingIds.length === 0) { setReportData([]); setLoading(false); return; }

      // Challans
      const { data: challans } = await supabase.from("tds_challans").select("*").in("filing_id", filingIds);
      const challanIds = (challans || []).map((c: any) => c.id);

      // Deductees
      let deductees: any[] = [];
      if (challanIds.length > 0) {
        const { data: dd } = await supabase.from("tds_deductees").select("*").in("challan_id", challanIds);
        deductees = dd || [];
      }

      setReportData([{ filings: filings || [], challans: challans || [], deductees }]);
    }
    setLoading(false);
  };

  useEffect(() => {
    if (selectedReport) fetchReportData();
  }, [selectedReport, selClient, selFy, selQuarters, selForm]);

  const handlePrint = () => window.print();

  const handleExportExcel = (sheetName: string, rows: Record<string, any>[]) => {
    exportToExcel([{ sheetName: sheetName.slice(0, 31), rows }], `TDS_${sheetName}_${selFy}.xlsx`);
  };

  // Genius XLS export using template-based approach
  const generateGeniusXls = async () => {
    if (!reportData[0]) return;
    const { filings, challans, deductees } = reportData[0];

    const filing = filings.find((f: any) =>
      (f.tds_forms || []).includes(selForm) && selQuarters.includes(f.quarter) &&
      clientHasTdsForm(clients.find(c => c.id === f.client_id)?.tds_forms_applicable, selForm)
    );
    if (!filing) { toast({ title: "No filing found for selected form/quarter", variant: "destructive" }); return; }

    const client = clients.find(c => c.id === filing.client_id);
    const filingChallans = challans.filter((c: any) => c.filing_id === filing.id);
    const challanIds = new Set(filingChallans.map((c: any) => c.id));
    const filingDeductees = deductees.filter((d: any) => challanIds.has(d.challan_id));

    // Block export ONLY when applied total STRICTLY exceeds challan total (over-applied).
    // Fully-utilized (applied === challan) and partial/unconsumed (applied < challan) are ALLOWED.
    // Use Math.round(*100) to avoid floating-point false positives (e.g. 0.1+0.2 = 0.30000...4).
    const overApplied = filingChallans.filter((c: any) => {
      const applied = filingDeductees
        .filter((d: any) => d.challan_id === c.id)
        .reduce((s: number, d: any) =>
          s + (d.total_tax_deducted || d.tds_amount || 0) + (d.interest_amount || 0) + (d.surcharge_amount || 0), 0);
      const challanTotal = c.total_challan_amount || 0;
      return Math.round(applied * 100) > Math.round(challanTotal * 100); // strictly greater
    });
    if (overApplied.length > 0) {
      toast({
        title: "Cannot generate Genius XLS",
        description: `One or more challans are over-applied (${overApplied.length} challan${overApplied.length > 1 ? "s" : ""}). Please correct them before proceeding.`,
        variant: "destructive",
      });
      return;
    }

    try {
      await generateGeniusExport(selForm, filing, client || { id: "", name: "Unknown" }, filingChallans, filingDeductees);
      toast({ title: "Genius XLS exported successfully" });
    } catch (err: any) {
      // User cancelled the save dialog — not an error
      if (err?.name === "AbortError") return;
      toast({ title: "Export error", description: err.message, variant: "destructive" });
    }
  };

  // Report renderers
  const renderFilingStatusReport = () => {
    const rows = reportData.map((f: any) => {
      const client = clients.find(c => c.id === f.client_id);
      return {
        "Client": client?.name || "—",
        "TAN": f.tan || "—",
        "Form": (f.tds_forms || []).join(", "),
        "Quarter": f.quarter,
        "FY": f.financial_year,
        "Status": f.work_status,
        "Filing Date": fmtDate(f.date_of_filing),
        "Ack No": f.acknowledgment_number || "—",
      };
    });
    return (
      <>
        <div className="flex justify-end gap-2 mb-3">
          <Button variant="outline" size="sm" className="gap-1" onClick={handlePrint}><Printer size={14} /> Print</Button>
          <Button variant="outline" size="sm" className="gap-1" onClick={() => handleExportExcel("Filing_Status", rows)}><Download size={14} /> Export Excel</Button>
        </div>
        <Card><CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                {Object.keys(rows[0] || {}).map(k => <TableHead key={k}>{k}</TableHead>)}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">No data</TableCell></TableRow>
              ) : rows.map((r, i) => (
                <TableRow key={i}>
                  {Object.values(r).map((v, j) => <TableCell key={j} className="text-sm">{String(v)}</TableCell>)}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent></Card>
      </>
    );
  };

  const renderChallanRegister = () => {
    if (!reportData[0]) return <p className="text-muted-foreground">No data</p>;
    const { challans, deductees } = reportData[0];
    const filtered = challans.filter((c: any) => selQuarters.includes(c.quarter));
    const rows = filtered.map((c: any, i: number) => {
      const dCount = deductees.filter((d: any) => d.challan_id === c.id).length;
      const dTds = deductees.filter((d: any) => d.challan_id === c.id).reduce((s: number, d: any) => s + (d.total_tax_deducted || d.tds_amount || 0), 0);
      return {
        "Sr": i + 1,
        "BSR Code": c.bsr_code || "—",
        "Challan Number": c.challan_serial_no || "—",
        "Date": fmtDate(c.deposit_date),
        "Tax": c.total_tax_deposited || 0,
        "Surcharge": c.surcharge_deposited || 0,
        "Cess": c.education_cess_deposited || 0,
        "Interest": c.interest_deposited || 0,
        "Total": c.total_challan_amount || 0,
        "Section": c.section_code || "—",
        "Deductees": dCount,
        "Matched": Math.abs(dTds - (c.total_tax_deposited || 0)) <= 5 ? "✓" : "✗",
      };
    });

    return (
      <>
        <div className="flex justify-end gap-2 mb-3">
          <Button variant="outline" size="sm" className="gap-1" onClick={handlePrint}><Printer size={14} /> Print</Button>
          <Button variant="outline" size="sm" className="gap-1" onClick={() => handleExportExcel("Challan_Register", rows)}><Download size={14} /> Export Excel</Button>
        </div>
        <Card><CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                {Object.keys(rows[0] || {}).map(k => <TableHead key={k} className={["Tax", "Surcharge", "Cess", "Interest", "Total"].includes(k) ? "text-right" : ""}>{k}</TableHead>)}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow><TableCell colSpan={12} className="text-center text-muted-foreground py-8">No challans found</TableCell></TableRow>
              ) : rows.map((r, i) => (
                <TableRow key={i}>
                  {Object.entries(r).map(([k, v], j) => {
                    const isMoney = ["Tax", "Surcharge", "Cess", "Interest", "Total"].includes(k);
                    return (
                      <TableCell key={j} className={cn("text-sm", isMoney ? "text-right" : "")}>
                        {isMoney && typeof v === "number" ? formatINR(v) : String(v)}
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent></Card>
      </>
    );
  };

  const renderSectionSummary = () => {
    if (!reportData[0]) return <p className="text-muted-foreground">No data</p>;
    const { deductees } = reportData[0];
    const filtered = deductees.filter((d: any) => selQuarters.includes(d.quarter));
    const map = new Map<string, { count: number; totalPayment: number; tds: number }>();
    for (const d of filtered) {
      const sec = d.section_code || "Unknown";
      const ex = map.get(sec) || { count: 0, totalPayment: 0, tds: 0 };
      ex.count++;
      ex.totalPayment += d.amount_paid_credited || 0;
      ex.tds += d.total_tax_deducted || d.tds_amount || 0;
      map.set(sec, ex);
    }
    const rows = Array.from(map.entries()).sort((a, b) => b[1].tds - a[1].tds).map(([sec, d]) => ({
      "Section Code": sec,
      "Count": d.count,
      "Total Payment": d.totalPayment,
      "TDS Deducted": d.tds,
      "Avg Rate %": d.totalPayment > 0 ? ((d.tds / d.totalPayment) * 100).toFixed(2) : "0",
    }));

    return (
      <>
        <div className="flex justify-end gap-2 mb-3">
          <Button variant="outline" size="sm" className="gap-1" onClick={handlePrint}><Printer size={14} /> Print</Button>
          <Button variant="outline" size="sm" className="gap-1" onClick={() => handleExportExcel("Section_Summary", rows)}><Download size={14} /> Export Excel</Button>
        </div>
        <Card><CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Section Code</TableHead>
                <TableHead className="text-right">Count</TableHead>
                <TableHead className="text-right">Total Payment</TableHead>
                <TableHead className="text-right">TDS Deducted</TableHead>
                <TableHead className="text-right">Avg Rate %</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">No data</TableCell></TableRow>
              ) : rows.map((r, i) => (
                <TableRow key={i}>
                  <TableCell><Badge variant="outline" className="font-mono">{r["Section Code"]}</Badge></TableCell>
                  <TableCell className="text-right">{r.Count}</TableCell>
                  <TableCell className="text-right">{formatINR(r["Total Payment"] as number)}</TableCell>
                  <TableCell className="text-right font-semibold">{formatINR(r["TDS Deducted"] as number)}</TableCell>
                  <TableCell className="text-right">{r["Avg Rate %"]}%</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent></Card>
      </>
    );
  };

  const renderDeducteeWise = () => {
    if (!reportData[0]) return <p className="text-muted-foreground">No data</p>;
    const { deductees, challans } = reportData[0];
    const filtered = deductees.filter((d: any) => selQuarters.includes(d.quarter));
    const rows = filtered.map((d: any) => {
      const challan = challans.find((c: any) => c.id === d.challan_id);
      return {
        "Name": d.deductee_name || "—",
        "PAN": d.deductee_pan || "—",
        "Form": d.form_type || "—",
        "FY": d.financial_year,
        "Q": d.quarter,
        "Section": d.section_code || "—",
        "Payment Date": fmtDate(d.date_of_payment),
        "Amount": d.amount_paid_credited || 0,
        "Rate %": d.rate_of_tds || 0,
        "TDS": d.total_tax_deducted || d.tds_amount || 0,
        "Challan BSR": challan?.bsr_code || "—",
        "Challan Date": fmtDate(challan?.deposit_date),
      };
    });

    return (
      <>
        <div className="flex justify-end gap-2 mb-3">
          <Button variant="outline" size="sm" className="gap-1" onClick={handlePrint}><Printer size={14} /> Print</Button>
          <Button variant="outline" size="sm" className="gap-1" onClick={() => handleExportExcel("Deductee_Wise", rows)}><Download size={14} /> Export Excel</Button>
        </div>
        <Card><CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                {["Name", "PAN", "Form", "FY", "Q", "Section", "Payment Date", "Amount", "Rate %", "TDS", "Challan BSR", "Challan Date"].map(k =>
                  <TableHead key={k} className={["Amount", "Rate %", "TDS"].includes(k) ? "text-right" : ""}>{k}</TableHead>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow><TableCell colSpan={12} className="text-center text-muted-foreground py-8">No data</TableCell></TableRow>
              ) : rows.map((r, i) => (
                <TableRow key={i}>
                  <TableCell className="font-medium text-sm">{r.Name}</TableCell>
                  <TableCell className="font-mono text-xs">{r.PAN}</TableCell>
                  <TableCell className="text-sm">{r.Form}</TableCell>
                  <TableCell className="text-sm">{r.FY}</TableCell>
                  <TableCell className="text-sm">{r.Q}</TableCell>
                  <TableCell><Badge variant="outline" className="text-xs">{r.Section}</Badge></TableCell>
                  <TableCell className="text-sm">{r["Payment Date"]}</TableCell>
                  <TableCell className="text-right text-sm">{formatINR(r.Amount)}</TableCell>
                  <TableCell className="text-right text-sm">{r["Rate %"]}%</TableCell>
                  <TableCell className="text-right font-semibold text-sm">{formatINR(r.TDS)}</TableCell>
                  <TableCell className="font-mono text-xs">{r["Challan BSR"]}</TableCell>
                  <TableCell className="text-sm">{r["Challan Date"]}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent></Card>
      </>
    );
  };

  const renderNonFilerAlert = () => {
    if (!reportData[0]) return <p className="text-muted-foreground">No data</p>;
    const { deductees } = reportData[0];
    const noPan = deductees.filter((d: any) => d.pan_not_available || !d.deductee_pan || d.deductee_pan?.toUpperCase().startsWith("PANNOTAVBL"));
    const rows = noPan.map((d: any) => ({
      "Name": d.deductee_name || "—",
      "PAN": d.deductee_pan || "Not Available",
      "Section": d.section_code || "—",
      "Amount": d.amount_paid_credited || 0,
      "TDS": d.total_tax_deducted || d.tds_amount || 0,
      "Rate %": d.rate_of_tds || 0,
      "Reason Code": d.reason_for_lower_or_nil_deduction || "—",
      "Quarter": d.quarter,
    }));

    return (
      <>
        <div className="flex justify-end gap-2 mb-3">
          <Button variant="outline" size="sm" className="gap-1" onClick={handlePrint}><Printer size={14} /> Print</Button>
          <Button variant="outline" size="sm" className="gap-1" onClick={() => handleExportExcel("Non_Filer_Alert", rows)}><Download size={14} /> Export Excel</Button>
        </div>
        <Card><CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                {Object.keys(rows[0] || {}).map(k => <TableHead key={k} className={["Amount", "TDS", "Rate %"].includes(k) ? "text-right" : ""}>{k}</TableHead>)}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">No non-filer deductees found</TableCell></TableRow>
              ) : rows.map((r, i) => (
                <TableRow key={i}>
                  {Object.entries(r).map(([k, v], j) => (
                    <TableCell key={j} className={cn("text-sm", ["Amount", "TDS", "Rate %"].includes(k) ? "text-right" : "")}>
                      {typeof v === "number" ? (k === "Rate %" ? `${v}%` : formatINR(v)) : String(v)}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent></Card>
      </>
    );
  };

  const renderLowerCert = () => {
    if (!reportData[0]) return <p className="text-muted-foreground">No data</p>;
    const { deductees } = reportData[0];
    const withCert = deductees.filter((d: any) => d.lower_deduction_certificate_no);
    const rows = withCert.map((d: any) => ({
      "Name": d.deductee_name || "—",
      "PAN": d.deductee_pan || "—",
      "Certificate No": d.lower_deduction_certificate_no,
      "Section": d.section_code || "—",
      "Rate Applied": d.rate_of_tds || 0,
      "Amount": d.amount_paid_credited || 0,
      "TDS": d.total_tax_deducted || d.tds_amount || 0,
      "Quarter": d.quarter,
    }));

    return (
      <>
        <div className="flex justify-end gap-2 mb-3">
          <Button variant="outline" size="sm" className="gap-1" onClick={handlePrint}><Printer size={14} /> Print</Button>
          <Button variant="outline" size="sm" className="gap-1" onClick={() => handleExportExcel("Lower_Cert", rows)}><Download size={14} /> Export Excel</Button>
        </div>
        <Card><CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                {Object.keys(rows[0] || {}).map(k => <TableHead key={k} className={["Rate Applied", "Amount", "TDS"].includes(k) ? "text-right" : ""}>{k}</TableHead>)}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">No lower deduction certificates found</TableCell></TableRow>
              ) : rows.map((r, i) => (
                <TableRow key={i}>
                  {Object.entries(r).map(([k, v], j) => (
                    <TableCell key={j} className={cn("text-sm", ["Rate Applied", "Amount", "TDS"].includes(k) ? "text-right" : "")}>
                      {typeof v === "number" ? (k === "Rate Applied" ? `${v}%` : formatINR(v)) : String(v)}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent></Card>
      </>
    );
  };

  const renderAnnualSummary = () => {
    if (!reportData[0]) return <p className="text-muted-foreground">No data</p>;
    const { filings, challans, deductees } = reportData[0];
    
    const clientMap = new Map<string, { q1Tds: number; q2Tds: number; q3Tds: number; q4Tds: number; total: number; deducteeCount: number }>();
    for (const d of deductees) {
      const filing = filings.find((f: any) => f.id === d.filing_id);
      const cid = d.client_id || filing?.client_id;
      if (!cid) continue;
      const ex = clientMap.get(cid) || { q1Tds: 0, q2Tds: 0, q3Tds: 0, q4Tds: 0, total: 0, deducteeCount: 0 };
      const tds = d.total_tax_deducted || d.tds_amount || 0;
      const q = d.quarter;
      if (q === "Q1") ex.q1Tds += tds;
      else if (q === "Q2") ex.q2Tds += tds;
      else if (q === "Q3") ex.q3Tds += tds;
      else if (q === "Q4") ex.q4Tds += tds;
      ex.total += tds;
      ex.deducteeCount++;
      clientMap.set(cid, ex);
    }

    const rows = Array.from(clientMap.entries()).map(([cid, d]) => {
      const client = clients.find(c => c.id === cid);
      return {
        "Client": client?.name || "—",
        "Q1 TDS": d.q1Tds,
        "Q2 TDS": d.q2Tds,
        "Q3 TDS": d.q3Tds,
        "Q4 TDS": d.q4Tds,
        "Total TDS": d.total,
        "Deductees": d.deducteeCount,
      };
    });

    return (
      <>
        <div className="flex justify-end gap-2 mb-3">
          <Button variant="outline" size="sm" className="gap-1" onClick={handlePrint}><Printer size={14} /> Print</Button>
          <Button variant="outline" size="sm" className="gap-1" onClick={() => handleExportExcel("Annual_Summary", rows)}><Download size={14} /> Export Excel</Button>
        </div>
        <Card><CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Client</TableHead>
                {["Q1 TDS", "Q2 TDS", "Q3 TDS", "Q4 TDS", "Total TDS"].map(k => <TableHead key={k} className="text-right">{k}</TableHead>)}
                <TableHead className="text-right">Deductees</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">No data</TableCell></TableRow>
              ) : rows.map((r, i) => (
                <TableRow key={i}>
                  <TableCell className="font-medium text-sm">{r.Client}</TableCell>
                  {["Q1 TDS", "Q2 TDS", "Q3 TDS", "Q4 TDS", "Total TDS"].map(k => (
                    <TableCell key={k} className="text-right text-sm">{formatINR((r as any)[k])}</TableCell>
                  ))}
                  <TableCell className="text-right text-sm">{r.Deductees}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent></Card>
      </>
    );
  };

  const renderGeniusExport = () => {
    if (!reportData[0]) return <p className="text-muted-foreground">No data. Select a client first.</p>;
    const { filings, challans, deductees } = reportData[0];
    const filing = filings.find((f: any) =>
      (f.tds_forms || []).includes(selForm) && selQuarters.includes(f.quarter) &&
      clientHasTdsForm(clients.find(c => c.id === f.client_id)?.tds_forms_applicable, selForm)
    );
    const client = filing ? clients.find(c => c.id === filing.client_id) : null;
    const fChallans = filing ? challans.filter((c: any) => c.filing_id === filing.id) : [];
    const cIds = new Set(fChallans.map((c: any) => c.id));
    const fDeductees = deductees.filter((d: any) => cIds.has(d.challan_id));

    // ── Per-challan utilisation status ─────────────────────────────────────
    // Applied = sum of (TDS + interest + surcharge) across all deductees for that challan.
    // Status rules (strictly-greater = over-applied; equal = full; less = partial; zero = unconsumed).
    type ChallanStatus = "over-applied" | "fully-utilized" | "partial" | "unconsumed";
    const challanStatus = fChallans.map((c: any) => {
      const applied = fDeductees
        .filter((d: any) => d.challan_id === c.id)
        .reduce((s: number, d: any) =>
          s + (d.total_tax_deducted || d.tds_amount || 0) + (d.interest_amount || 0) + (d.surcharge_amount || 0), 0);
      const challanTotal = c.total_challan_amount || 0;
      const appliedRounded  = Math.round(applied * 100);
      const challanRounded  = Math.round(challanTotal * 100);
      let status: ChallanStatus;
      if (appliedRounded > challanRounded)    status = "over-applied";
      else if (appliedRounded === 0)          status = "unconsumed";
      else if (appliedRounded === challanRounded) status = "fully-utilized";
      else                                    status = "partial";
      return { challan: c, applied, challanTotal, status };
    });

    // Block Generate button when ANY challan is over-applied
    const hasOverApplied = challanStatus.some(cs => cs.status === "over-applied");

    // Badge helper
    const statusBadge = (status: ChallanStatus) => {
      switch (status) {
        case "over-applied":    return <Badge className="text-[10px] bg-red-100 text-red-700 border-red-300 hover:bg-red-100">Over-applied</Badge>;
        case "fully-utilized":  return <Badge className="text-[10px] bg-green-100 text-green-700 border-green-300 hover:bg-green-100">Fully Utilized</Badge>;
        case "partial":         return <Badge className="text-[10px] bg-amber-100 text-amber-700 border-amber-300 hover:bg-amber-100">Partial</Badge>;
        case "unconsumed":      return <Badge className="text-[10px] bg-slate-100 text-slate-500 border-slate-300 hover:bg-slate-100">Unconsumed</Badge>;
      }
    };

    return (
      <div className="space-y-4">
        <Card>
          <CardContent className="p-6">
            <div className="grid grid-cols-4 gap-4 mb-6">
              <div className="p-3 rounded-lg bg-muted text-center">
                <p className="text-xs text-muted-foreground">Client</p>
                <p className="font-semibold text-sm">{client?.name || "—"}</p>
              </div>
              <div className="p-3 rounded-lg bg-muted text-center">
                <p className="text-xs text-muted-foreground">TAN</p>
                <p className="font-semibold text-sm font-mono">{filing?.tan || "—"}</p>
              </div>
              <div className="p-3 rounded-lg bg-muted text-center">
                <p className="text-xs text-muted-foreground">Challans</p>
                <p className="font-semibold text-sm">{fChallans.length}</p>
              </div>
              <div className="p-3 rounded-lg bg-muted text-center">
                <p className="text-xs text-muted-foreground">Deductees</p>
                <p className="font-semibold text-sm">{fDeductees.length}</p>
              </div>
            </div>

            {!filing ? (
              <p className="text-center text-muted-foreground py-4">No filing found for {selForm} {selQuarters.join(",")} {selFy}</p>
            ) : (
              <div className="flex flex-col items-center gap-2">
                {hasOverApplied && (
                  <p className="text-sm text-destructive font-medium flex items-center gap-1">
                    <AlertTriangle size={14} />
                    One or more challans are over-applied. Correct them before generating.
                  </p>
                )}
                <Button
                  size="lg"
                  className="gap-2 font-semibold"
                  onClick={generateGeniusXls}
                  disabled={hasOverApplied}
                  title={hasOverApplied ? "Fix over-applied challans before generating" : "Generate Genius XLS"}
                >
                  <FileSpreadsheet size={18} /> Generate Genius XLS
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* ── Challan utilisation summary with status badges ─────────────── */}
        {fChallans.length > 0 && (
          <Card>
            <CardHeader className="py-3 px-4">
              <CardTitle className="text-sm">Challan Utilisation</CardTitle>
            </CardHeader>
            <CardContent className="p-0 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">BSR Code</TableHead>
                    <TableHead className="text-xs">Challan No.</TableHead>
                    <TableHead className="text-xs">Date</TableHead>
                    <TableHead className="text-xs text-right">Challan Total</TableHead>
                    <TableHead className="text-xs text-right">Applied</TableHead>
                    <TableHead className="text-xs text-right">Balance</TableHead>
                    <TableHead className="text-xs">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {challanStatus.map(({ challan: c, applied, challanTotal, status }, i) => {
                    const balance = challanTotal - applied;
                    const isOver = status === "over-applied";
                    return (
                      <TableRow key={i} className={isOver ? "bg-red-50 dark:bg-red-950/20" : ""}>
                        <TableCell className="text-xs font-mono">{c.bsr_code || "—"}</TableCell>
                        <TableCell className="text-xs font-mono">{c.challan_serial_no || "—"}</TableCell>
                        <TableCell className="text-xs">{fmtDate(c.deposit_date)}</TableCell>
                        <TableCell className="text-xs text-right tabular-nums">{formatINR(challanTotal)}</TableCell>
                        <TableCell className={cn("text-xs text-right tabular-nums", isOver && "text-destructive font-semibold")}>{formatINR(applied)}</TableCell>
                        <TableCell className={cn("text-xs text-right tabular-nums", isOver && "text-destructive font-semibold")}>{isOver ? `−${formatINR(Math.abs(balance))}` : formatINR(balance)}</TableCell>
                        <TableCell>{statusBadge(status)}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

        {/* ── Deductee preview ───────────────────────────────────────────── */}
        {fDeductees.length > 0 && (
          <Card>
            <CardHeader className="py-3 px-4">
              <CardTitle className="text-sm">Preview — First 10 deductees</CardTitle>
            </CardHeader>
            <CardContent className="p-0 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Challan #</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>PAN</TableHead>
                    <TableHead>Section</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead className="text-right">TDS</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {fDeductees.slice(0, 10).map((d: any, i: number) => {
                    const challan = fChallans.find((c: any) => c.id === d.challan_id);
                    return (
                      <TableRow key={i}>
                        <TableCell className="text-sm">{challan?.challan_serial_no || "—"}</TableCell>
                        <TableCell className="text-sm font-medium">{d.deductee_name || "—"}</TableCell>
                        <TableCell className="font-mono text-xs">{d.deductee_pan || "—"}</TableCell>
                        <TableCell><Badge variant="outline" className="text-xs">{d.section_code}</Badge></TableCell>
                        <TableCell className="text-right text-sm">{formatINR(d.amount_paid_credited || 0)}</TableCell>
                        <TableCell className="text-right text-sm font-semibold">{formatINR(d.total_tax_deducted || d.tds_amount || 0)}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </div>
    );
  };

  // ── Overview Report — Stage 1-4 validation, one/several/all quarters combined.
  // Independent of fetchReportData()/reportData above: this report reads the
  // Stage 1-4 results tables directly (via tdsOverviewFetch.ts) rather than the
  // filings/challans/deductees shape the other 9 cards share, and only runs when
  // the user explicitly clicks Generate (an on-demand multi-round-trip fetch,
  // not something to re-run on every filter keystroke).
  const runOverviewReport = async (fmt: "xlsx" | "pdf") => {
    if (selClient === "all") {
      toast({ title: "Select a specific client", description: "The Overview Report is per-client — pick one client before generating it.", variant: "destructive" });
      return;
    }
    if (selQuarters.length === 0) {
      toast({ title: "Select at least one quarter", variant: "destructive" });
      return;
    }
    const client = clients.find((c) => c.id === selClient);
    if (!client) { toast({ title: "Client not found", variant: "destructive" }); return; }

    setExportingOverview(true);
    try {
      const firmId = await resolveFirmId();
      const perQuarter: QuarterReportInput[] = [];
      const skipped: string[] = [];

      // Resolve each selected quarter's own tds_filings row — same client+FY+
      // quarter+form resolution pattern loadAll() uses in TdsValidateFinalise.tsx —
      // then apply the same TDS-compliance gate every other TDS screen applies
      // before a filing may surface anywhere.
      for (const q of selQuarters) {
        let fq = supabase.from("tds_filings").select("*")
          .eq("client_id", selClient).eq("financial_year", selFy).eq("quarter", q);
        if (!isSuperadmin && firmId) fq = fq.eq("firm_id", firmId);
        const { data } = await fq;
        const filing = (data || []).find((f: any) => (f.tds_forms || []).includes(selForm));
        if (!filing || !isFilingTdsCompliant(filing as any, client)) { skipped.push(q); continue; }

        const rep = await fetchFilingReport(filing as any, {
          clientName: client.name || "—", clientTan: client.tan_number, formLabel: selForm,
        });
        if (!rep) { skipped.push(q); continue; }
        perQuarter.push({ quarter: q, ...rep });
      }

      if (!perQuarter.length) {
        toast({ title: "No data to report", description: `No filing/validation data found for ${selForm} ${selQuarters.join(", ")} ${selFy}.`, variant: "destructive" });
        return;
      }
      if (skipped.length) {
        toast({ title: `Skipped ${skipped.length} of ${selQuarters.length} quarter(s)`, description: `No filing or no validation data for: ${skipped.join(", ")}.` });
      }

      const { meta, stageReports, overview } = mergeQuarterlyReports(perQuarter);
      if (fmt === "xlsx") await downloadWorkbook(buildOverviewWorkbook(overview, meta, stageReports), reportFileName(meta, "Validation Overview", "xlsx"));
      else await exportOverviewPdf(overview, meta, stageReports);
    } catch (e: any) {
      toast({ title: "Export failed", description: e?.message || String(e), variant: "destructive" });
    } finally {
      setExportingOverview(false);
    }
  };

  const renderOverviewReport = () => {
    const clientMissing = selClient === "all";
    const noQuarters = selQuarters.length === 0;
    const blocked = clientMissing || noQuarters;
    return (
      <div className="space-y-3">
        {clientMissing && (
          <div className="flex items-center gap-2 p-3 rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/20 text-sm text-amber-700 dark:text-amber-300">
            <Info size={16} className="shrink-0" /> Select a specific client above — this report is per-client and can't combine multiple clients into one document.
          </div>
        )}
        {!clientMissing && noQuarters && (
          <div className="flex items-center gap-2 p-3 rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/20 text-sm text-amber-700 dark:text-amber-300">
            <Info size={16} className="shrink-0" /> Select at least one quarter above.
          </div>
        )}
        <Card>
          <CardContent className="p-5 space-y-3">
            <p className="text-sm text-muted-foreground">
              Builds the same Stage 1 (data validation) · Stage 2 (PAN verification) · Stage 3 (Tally ledger) · Stage 4 (checker review)
              report the Validate &amp; Finalise workspace produces for one filing — combined here across every quarter you select, into
              one document. Same-titled sections are merged across quarters (each row tagged with its own Quarter), and the Overview
              sheet carries one ready-to-file row per quarter, since each quarter is filed separately.
            </p>
            <div className="flex items-center gap-2">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button className="gap-2 font-semibold" disabled={blocked || exportingOverview}>
                    {exportingOverview ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
                    {exportingOverview ? "Generating…" : "Generate Overview Report"}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuItem onClick={() => runOverviewReport("xlsx")} className="gap-2"><FileSpreadsheet size={14} /> Export to Excel (.xlsx)</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => runOverviewReport("pdf")} className="gap-2"><FileText size={14} /> Export to PDF (.pdf)</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <span className="text-xs text-muted-foreground">
                {selQuarters.length > 0 ? `${selQuarters.length} quarter${selQuarters.length > 1 ? "s" : ""} selected: ${selQuarters.join(", ")}` : ""}
              </span>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  };

  const renderReport = () => {
    switch (selectedReport) {
      case "filing-status": return renderFilingStatusReport();
      case "deductee-wise": return renderDeducteeWise();
      case "challan-register": return renderChallanRegister();
      case "section-summary": return renderSectionSummary();
      case "annual-summary": return renderAnnualSummary();
      case "non-filer": return renderNonFilerAlert();
      case "lower-cert": return renderLowerCert();
      case "cross-quarter": return renderCrossQuarter();
      case "genius-export": return renderGeniusExport();
      case "overview-report": return renderOverviewReport();
      default: return null;
    }
  };

  const renderCrossQuarter = () => {
    if (!reportData[0]) return <p className="text-muted-foreground">No data</p>;
    const { deductees, challans } = reportData[0];
    // Group by PAN across quarters
    const panMap = new Map<string, { name: string; pan: string; quarters: Record<string, { amount: number; tds: number; count: number }> }>();
    for (const d of deductees) {
      const pan = d.deductee_pan || "NO-PAN";
      const ex = panMap.get(pan) || { name: d.deductee_name || "—", pan, quarters: {} };
      const q = d.quarter || "?";
      if (!ex.quarters[q]) ex.quarters[q] = { amount: 0, tds: 0, count: 0 };
      ex.quarters[q].amount += d.amount_paid_credited || 0;
      ex.quarters[q].tds += d.total_tax_deducted || d.tds_amount || 0;
      ex.quarters[q].count++;
      if (!ex.name || ex.name === "—") ex.name = d.deductee_name || "—";
      panMap.set(pan, ex);
    }
    // Only show deductees appearing in 2+ quarters
    const multiQ = Array.from(panMap.values()).filter(v => Object.keys(v.quarters).length >= 2);
    const rows = multiQ.map(v => ({
      "Name": v.name,
      "PAN": v.pan,
      "Q1 Amt": v.quarters.Q1?.amount || 0,
      "Q1 TDS": v.quarters.Q1?.tds || 0,
      "Q2 Amt": v.quarters.Q2?.amount || 0,
      "Q2 TDS": v.quarters.Q2?.tds || 0,
      "Q3 Amt": v.quarters.Q3?.amount || 0,
      "Q3 TDS": v.quarters.Q3?.tds || 0,
      "Q4 Amt": v.quarters.Q4?.amount || 0,
      "Q4 TDS": v.quarters.Q4?.tds || 0,
      "Total": Object.values(v.quarters).reduce((s, q) => s + q.tds, 0),
    }));
    return (
      <>
        <div className="flex justify-end gap-2 mb-3">
          <Button variant="outline" size="sm" className="gap-1" onClick={handlePrint}><Printer size={14} /> Print</Button>
          <Button variant="outline" size="sm" className="gap-1" onClick={() => handleExportExcel("Cross_Quarter", rows)}><Download size={14} /> Export Excel</Button>
        </div>
        <Card><CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead><TableHead>PAN</TableHead>
                {["Q1 Amt", "Q1 TDS", "Q2 Amt", "Q2 TDS", "Q3 Amt", "Q3 TDS", "Q4 Amt", "Q4 TDS", "Total"].map(k =>
                  <TableHead key={k} className="text-right text-xs">{k}</TableHead>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow><TableCell colSpan={11} className="text-center text-muted-foreground py-8">No deductees found in multiple quarters</TableCell></TableRow>
              ) : rows.map((r, i) => (
                <TableRow key={i}>
                  <TableCell className="text-sm font-medium">{r.Name}</TableCell>
                  <TableCell className="font-mono text-xs">{r.PAN}</TableCell>
                  {["Q1 Amt", "Q1 TDS", "Q2 Amt", "Q2 TDS", "Q3 Amt", "Q3 TDS", "Q4 Amt", "Q4 TDS", "Total"].map(k => (
                    <TableCell key={k} className="text-right text-sm">{formatINR((r as any)[k])}</TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent></Card>
      </>
    );
  };

  if (!selectedReport) {
    return (
      <div className="space-y-4">
        <div>
          <h2 className="text-xl font-bold text-foreground">Reports</h2>
          <p className="text-sm text-muted-foreground">Select a report type to generate</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {REPORT_CARDS.map(r => (
            <Card key={r.key} className={cn("cursor-pointer hover:border-primary/50 transition-colors", r.key === "genius-export" && "border-amber-400 dark:border-amber-600 ring-1 ring-amber-400/30")} onClick={() => setSelectedReport(r.key)}>
              <CardContent className="p-5">
                <div className="flex items-start gap-3">
                  <div className={cn("p-2 rounded-lg bg-muted", r.color)}>
                    <r.icon size={20} />
                  </div>
                  <div>
                    <p className="font-semibold text-foreground text-sm">{r.label}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{r.desc}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  const currentReport = REPORT_CARDS.find(r => r.key === selectedReport);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => setSelectedReport(null)}><ArrowLeft size={18} /></Button>
        <div>
          <h2 className="text-xl font-bold text-foreground">{currentReport?.label}</h2>
          <p className="text-sm text-muted-foreground">{currentReport?.desc}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-end">
        <div className="space-y-1">
          <Label className="text-xs">Client</Label>
          <Select value={selClient} onValueChange={setSelClient}>
            <SelectTrigger className="w-[220px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Clients</SelectItem>
              {clients
                .filter(c => {
                  // Form-scoped only for report types with a visible Form selector.
                  if (selectedReport !== "genius-export" && selectedReport !== "cross-quarter" && selectedReport !== "overview-report") return true;
                  return clientHasTdsForm(c.tds_forms_applicable, selForm);
                })
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
          <Label className="text-xs">Quarters</Label>
          <div className="flex gap-1">
            {QUARTER_OPTIONS.map(q => (
              <Button key={q} variant={selQuarters.includes(q) ? "default" : "outline"} size="sm" className="h-8 px-3" onClick={() => toggleQuarter(q)}>
                {q}
              </Button>
            ))}
          </div>
        </div>
    {(selectedReport === "genius-export" || selectedReport === "cross-quarter" || selectedReport === "overview-report") && (
          <div className="space-y-1">
            <Label className="text-xs">Form</Label>
            <Select value={selForm} onValueChange={setSelForm}>
              <SelectTrigger className="w-[100px]"><SelectValue /></SelectTrigger>
              <SelectContent>{TDS_FORMS.map(f => <SelectItem key={f} value={f}>{f}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        )}
      </div>

      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : renderReport()}
    </div>
  );
}
