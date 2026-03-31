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
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import {
  FileText, Users, Receipt, BarChart3, FileSpreadsheet,
  AlertTriangle, Award, Download, Printer, ArrowLeft,
  ClipboardList, CalendarCheck, Shield,
} from "lucide-react";
import { exportToExcel } from "@/lib/exportUtils";
import { generateGeniusExport } from "@/lib/genius-export";

interface ClientOption { id: string; name: string | null; pan: string | null; tan_number?: string | null; }

interface Props {
  clients: ClientOption[];
  isSuperadmin: boolean;
  resolveFirmId: () => Promise<string | null>;
}

const CURRENT_FY_START = new Date().getMonth() >= 3 ? new Date().getFullYear() : new Date().getFullYear() - 1;
const DEFAULT_FY = `${CURRENT_FY_START}-${String(CURRENT_FY_START + 1).slice(2)}`;
const FY_OPTIONS = Array.from({ length: 7 }, (_, i) => { const s = 2020 + i; return `${s}-${String(s + 1).slice(2)}`; });
const QUARTER_OPTIONS = ["Q1", "Q2", "Q3", "Q4"];
const TDS_FORMS = ["24Q", "26Q", "27Q", "27EQ"];

const formatINR = (n: number) => `₹${n.toLocaleString("en-IN")}`;
const fmtDate = (d: string | null) => { if (!d) return "—"; try { return format(new Date(d), "dd/MM/yyyy"); } catch { return d; } };

type ReportType = "filing-status" | "deductee-wise" | "challan-register" | "section-summary" | "annual-summary" | "non-filer" | "lower-cert" | "cross-quarter" | "genius-export" | null;

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
];

export function TdsReports({ clients, isSuperadmin, resolveFirmId }: Props) {
  const { toast } = useToast();
  const [selectedReport, setSelectedReport] = useState<ReportType>(null);
  const [selClient, setSelClient] = useState("all");
  const [selFy, setSelFy] = useState(DEFAULT_FY);
  const [selQuarters, setSelQuarters] = useState<string[]>(["Q1", "Q2", "Q3", "Q4"]);
  const [selForm, setSelForm] = useState("26Q");
  const [loading, setLoading] = useState(false);
  const [reportData, setReportData] = useState<any[]>([]);

  const toggleQuarter = (q: string) => {
    setSelQuarters(prev => prev.includes(q) ? prev.filter(x => x !== q) : [...prev, q]);
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
      setReportData(data || []);
    } else if (selectedReport === "challan-register" || selectedReport === "deductee-wise" || selectedReport === "section-summary" || selectedReport === "annual-summary" || selectedReport === "non-filer" || selectedReport === "lower-cert" || selectedReport === "cross-quarter" || selectedReport === "genius-export") {
      // Get filings first
      let fq = supabase.from("tds_filings").select("id, client_id, financial_year, quarter, tds_forms, tan, work_status")
        .eq("financial_year", selFy);
      if (!isSuperadmin && firmId) fq = fq.eq("firm_id", firmId);
      if (selClient !== "all") fq = fq.eq("client_id", selClient);
      const { data: filings } = await fq;
      const filingIds = (filings || []).map((f: any) => f.id);

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

    const filing = filings.find((f: any) => (f.tds_forms || []).includes(selForm) && selQuarters.includes(f.quarter));
    if (!filing) { toast({ title: "No filing found for selected form/quarter", variant: "destructive" }); return; }

    const client = clients.find(c => c.id === filing.client_id);
    const filingChallans = challans.filter((c: any) => c.filing_id === filing.id);
    const challanIds = new Set(filingChallans.map((c: any) => c.id));
    const filingDeductees = deductees.filter((d: any) => challanIds.has(d.challan_id));

    try {
      await generateGeniusExport(selForm, filing, client || { id: "", name: "Unknown" }, filingChallans, filingDeductees);
      toast({ title: "Genius XLS exported successfully" });
    } catch (err: any) {
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
        "Serial No": c.challan_serial_no || "—",
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
    const filing = filings.find((f: any) => (f.tds_forms || []).includes(selForm) && selQuarters.includes(f.quarter));
    const client = filing ? clients.find(c => c.id === filing.client_id) : null;
    const fChallans = filing ? challans.filter((c: any) => c.filing_id === filing.id) : [];
    const cIds = new Set(fChallans.map((c: any) => c.id));
    const fDeductees = deductees.filter((d: any) => cIds.has(d.challan_id));

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
              <div className="flex justify-center">
                <Button size="lg" className="gap-2 font-semibold" onClick={generateGeniusXls}>
                  <FileSpreadsheet size={18} /> Generate Genius XLS
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

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
          <Label className="text-xs">Quarters</Label>
          <div className="flex gap-1">
            {QUARTER_OPTIONS.map(q => (
              <Button key={q} variant={selQuarters.includes(q) ? "default" : "outline"} size="sm" className="h-8 px-3" onClick={() => toggleQuarter(q)}>
                {q}
              </Button>
            ))}
          </div>
        </div>
    {(selectedReport === "genius-export" || selectedReport === "cross-quarter") && (
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
