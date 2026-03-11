import { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Clock } from "lucide-react";
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
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { format, addDays } from "date-fns";
import { cn } from "@/lib/utils";
import {
  ArrowLeft, Plus, Trash2, Save, Lock, Download, Send,
  FileText, CheckCircle2, Sparkles,
} from "lucide-react";

// ─── Types ───
interface LineItem {
  id?: string;
  description: string;
  hsn_sac_code: string;
  quantity: number;
  unit: string;
  rate: number;
  amount: number;
  sort_order: number;
}

interface Client {
  id: string;
  name: string | null;
  pan: string | null;
  gstin: string[] | null;
  entity_type: string | null;
}

interface Firm {
  name: string;
  display_name: string | null;
  logo_url: string | null;
  pan: string | null;
  gstin: string | null;
  phone: string | null;
  email: string | null;
  address: any;
  bank_details: any;
  primary_color: string | null;
  signature_url: string | null;
  state: string | null;
}

interface TimesheetForFetch {
  id: string;
  description: string | null;
  hours: number | null;
  work_date: string | null;
  billable: boolean | null;
  is_billable: boolean | null;
}

const FORMATS = [
  { id: "classic", label: "Classic", desc: "Traditional with navy header band" },
  { id: "modern", label: "Modern", desc: "Colorful header, clean body" },
  { id: "minimal", label: "Minimal", desc: "Clean white, no clutter" },
  { id: "gst_detailed", label: "GST Detailed", desc: "Tax-prominent with SAC codes" },
  { id: "retainer", label: "Retainer", desc: "Monthly with hours breakdown" },
];

const NewInvoice = () => {
  const navigate = useNavigate();
  const { invoiceId } = useParams<{ invoiceId?: string }>();
  const { user } = useAuth();
  const { toast } = useToast();
  const firmId = user?.firm_id;
  const isSuperadmin = user?.role === "superadmin";
  const isEdit = !!invoiceId;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [clients, setClients] = useState<Client[]>([]);
  const [firm, setFirm] = useState<Firm | null>(null);

  // Invoice state
  const [invoiceFormat, setInvoiceFormat] = useState("classic");
  const [clientId, setClientId] = useState("");
  const [invoiceNo, setInvoiceNo] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [dueDate, setDueDate] = useState(format(addDays(new Date(), 30), "yyyy-MM-dd"));
  const [subject, setSubject] = useState("");
  const [lineItems, setLineItems] = useState<LineItem[]>([{ description: "", hsn_sac_code: "", quantity: 1, unit: "", rate: 0, amount: 0, sort_order: 0 }]);
  const [isIntraState, setIsIntraState] = useState(true);
  const [cgstRate, setCgstRate] = useState(9);
  const [sgstRate, setSgstRate] = useState(9);
  const [igstRate, setIgstRate] = useState(18);
  const [paymentTerms, setPaymentTerms] = useState("Payment due within 30 days of invoice date.");
  const [footerText, setFooterText] = useState("Thank you for your business.");
  const [notes, setNotes] = useState("");
  const [signatoryName, setSignatoryName] = useState("");
  const [showLogo, setShowLogo] = useState(true);
  const [status, setStatus] = useState("draft");

  // From/To overrides
  const [fromName, setFromName] = useState("");
  const [fromAddress, setFromAddress] = useState("");
  const [fromGstin, setFromGstin] = useState("");
  const [fromPan, setFromPan] = useState("");
  const [fromPhone, setFromPhone] = useState("");
  const [fromEmail, setFromEmail] = useState("");
  const [toName, setToName] = useState("");
  const [toAddress, setToAddress] = useState("");
  const [toGstin, setToGstin] = useState("");
  const [toPan, setToPan] = useState("");
  const [bankSnapshot, setBankSnapshot] = useState<any>(null);

  // Timesheet modal
  const [tsModalOpen, setTsModalOpen] = useState(false);
  const [tsEntries, setTsEntries] = useState<TimesheetForFetch[]>([]);
  const [tsSelected, setTsSelected] = useState<string[]>([]);

  // Finalize dialog
  const [finalizeOpen, setFinalizeOpen] = useState(false);

  // Fetch initial data
  useEffect(() => {
    (async () => {
      setLoading(true);
      // Fetch clients
      let cq = supabase.from("clients").select("id, name, pan, gstin, entity_type").order("name");
      if (!isSuperadmin && firmId) cq = cq.eq("firm_id", firmId);
      const { data: clientData } = await cq;
      setClients(clientData || []);

      // Fetch firm
      if (firmId) {
        const { data: firmData } = await supabase.from("firms").select("name, display_name, logo_url, pan, gstin, phone, email, address, bank_details, primary_color, signature_url, state").eq("id", firmId).single();
        if (firmData) {
          setFirm(firmData);
          setFromName(firmData.display_name || firmData.name);
          const addr = firmData.address as any;
          setFromAddress(addr ? [addr.line1, addr.line2, addr.city, addr.state, addr.pincode].filter(Boolean).join(", ") : "");
          setFromGstin(firmData.gstin || "");
          setFromPan(firmData.pan || "");
          setFromPhone(firmData.phone || "");
          setFromEmail(firmData.email || "");
          setBankSnapshot(firmData.bank_details);
          setSignatoryName(firmData.display_name || firmData.name);
        }
      }

      // Generate invoice number
      if (!isEdit) {
        let invQ = supabase.from("invoices").select("invoice_no").order("invoice_no", { ascending: false }).limit(1);
        if (!isSuperadmin && firmId) invQ = invQ.eq("firm_id", firmId);
        const { data: lastInv } = await invQ;
        let nextNum = 1;
        if (lastInv?.[0]?.invoice_no) {
          const match = lastInv[0].invoice_no.match(/(\d+)$/);
          if (match) nextNum = parseInt(match[1]) + 1;
        }
        setInvoiceNo(`INV-${String(nextNum).padStart(4, "0")}`);
      }

      // Load existing invoice if editing
      if (isEdit && invoiceId) {
        const { data: inv } = await supabase.from("invoices").select("*").eq("id", invoiceId).single();
        if (inv) {
          setInvoiceFormat(inv.invoice_format || "classic");
          setClientId(inv.client_id || "");
          setInvoiceNo(inv.invoice_no || "");
          setInvoiceDate(inv.invoice_date || "");
          setDueDate(inv.due_date || "");
          setSubject(inv.subject || "");
          setIsIntraState(inv.is_intra_state ?? true);
          setPaymentTerms(inv.payment_terms || "");
          setFooterText(inv.footer_text || "");
          setNotes(inv.notes || "");
          setSignatoryName(inv.signatory_name || "");
          setShowLogo(inv.show_logo ?? true);
          setStatus(inv.status || "draft");
          setFromName(inv.from_firm_name || "");
          setFromAddress(inv.from_address || "");
          setFromGstin(inv.from_gstin || "");
          setFromPan(inv.from_pan || "");
          setFromPhone(inv.from_phone || "");
          setFromEmail(inv.from_email || "");
          setToName(inv.to_name || "");
          setToAddress(inv.to_address || "");
          setToGstin(inv.to_gstin || "");
          setToPan(inv.to_pan || "");
          setBankSnapshot(inv.bank_details_snapshot);

          // Load line items from JSONB (legacy) or table
          if (Array.isArray(inv.line_items) && inv.line_items.length > 0) {
            setLineItems(inv.line_items.map((li: any, i: number) => ({
              description: li.description || "",
              hsn_sac_code: li.hsn_sac_code || "",
              quantity: li.quantity || li.hours || 1,
              unit: li.unit || "",
              rate: li.rate || 0,
              amount: li.amount || 0,
              sort_order: i,
            })));
          }
        }
      }
      setLoading(false);
    })();
  }, [firmId, isSuperadmin, isEdit, invoiceId]);

  // Auto-fill client details
  useEffect(() => {
    if (!clientId) return;
    const client = clients.find(c => c.id === clientId);
    if (client) {
      setToName(client.name || "");
      setToPan(client.pan || "");
      setToGstin(client.gstin?.[0] || "");
    }
  }, [clientId, clients]);

  // Line item helpers
  const updateLine = (idx: number, field: keyof LineItem, value: any) => {
    setLineItems(prev => {
      const next = [...prev];
      const item = { ...next[idx], [field]: value };
      if (field === "quantity" || field === "rate") {
        item.amount = Math.round((Number(item.quantity) || 0) * (Number(item.rate) || 0) * 100) / 100;
      }
      next[idx] = item;
      return next;
    });
  };
  const addLine = () => setLineItems(prev => [...prev, { description: "", hsn_sac_code: "", quantity: 1, unit: "", rate: 0, amount: 0, sort_order: prev.length }]);
  const removeLine = (idx: number) => { if (lineItems.length > 1) setLineItems(prev => prev.filter((_, i) => i !== idx)); };

  // Totals
  const subtotal = useMemo(() => lineItems.reduce((s, li) => s + li.amount, 0), [lineItems]);
  const totalCgst = useMemo(() => isIntraState ? Math.round(subtotal * cgstRate / 100 * 100) / 100 : 0, [subtotal, cgstRate, isIntraState]);
  const totalSgst = useMemo(() => isIntraState ? Math.round(subtotal * sgstRate / 100 * 100) / 100 : 0, [subtotal, sgstRate, isIntraState]);
  const totalIgst = useMemo(() => !isIntraState ? Math.round(subtotal * igstRate / 100 * 100) / 100 : 0, [subtotal, igstRate, isIntraState]);
  const grandTotal = useMemo(() => subtotal + totalCgst + totalSgst + totalIgst, [subtotal, totalCgst, totalSgst, totalIgst]);

  // Fetch timesheets for client
  const fetchTimesheets = async () => {
    if (!clientId) return;
    const { data } = await supabase.from("timesheets")
      .select("id, description, hours, work_date, billable, is_billable")
      .eq("client_id", clientId)
      .eq("is_invoiced", false)
      .order("work_date");
    setTsEntries((data as TimesheetForFetch[]) || []);
    setTsSelected([]);
    setTsModalOpen(true);
  };

  const applyTimesheets = () => {
    const selected = tsEntries.filter(t => tsSelected.includes(t.id));
    const newItems: LineItem[] = selected.map((t, i) => ({
      description: `${t.description || "Service"} (${t.work_date ? format(new Date(t.work_date), "dd/MM/yyyy") : ""})`,
      hsn_sac_code: "998231",
      quantity: t.hours || 1,
      unit: "hrs",
      rate: 0,
      amount: 0,
      sort_order: lineItems.length + i,
    }));
    setLineItems(prev => [...prev.filter(li => li.description), ...newItems]);
    setTsModalOpen(false);
  };

  // Save
  const handleSave = async (newStatus?: string) => {
    if (!clientId) { toast({ title: "Select a client", variant: "destructive" }); return; }
    setSaving(true);
    try {
      const effectiveStatus = newStatus || status;
      const payload: any = {
        invoice_no: invoiceNo,
        client_id: clientId,
        firm_id: firmId,
        invoice_date: invoiceDate,
        due_date: dueDate,
        subject,
        invoice_format: invoiceFormat,
        amount: subtotal,
        subtotal,
        gst_amount: totalCgst + totalSgst + totalIgst,
        total_cgst: totalCgst,
        total_sgst: totalSgst,
        total_igst: totalIgst,
        total_amount: grandTotal,
        is_intra_state: isIntraState,
        payment_terms: paymentTerms,
        footer_text: footerText,
        notes,
        signatory_name: signatoryName,
        show_logo: showLogo,
        status: effectiveStatus,
        from_firm_name: fromName,
        from_address: fromAddress,
        from_gstin: fromGstin,
        from_pan: fromPan,
        from_phone: fromPhone,
        from_email: fromEmail,
        to_name: toName,
        to_address: toAddress,
        to_gstin: toGstin,
        to_pan: toPan,
        bank_details_snapshot: bankSnapshot,
        line_items: lineItems.filter(li => li.description.trim()),
        created_by: user?.id,
      };

      if (isEdit && invoiceId) {
        const { error } = await supabase.from("invoices").update(payload).eq("id", invoiceId);
        if (error) throw error;
        toast({ title: effectiveStatus === "finalized" ? "Invoice finalized" : "Invoice updated" });
      } else {
        const { error } = await supabase.from("invoices").insert(payload);
        if (error) throw error;
        toast({ title: "Invoice created" });
      }
      setStatus(effectiveStatus);
      if (!isEdit) navigate("/billing");
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
    setSaving(false);
  };

  const handleFinalize = () => { setFinalizeOpen(false); handleSave("finalized"); };

  const handleDownloadPdf = () => {
    const html = generateInvoiceHtml();
    const blob = new Blob([html], { type: "text/html" });
    window.open(URL.createObjectURL(blob), "_blank");
  };

  const selectedClient = clients.find(c => c.id === clientId);
  const isLocked = status === "finalized" || status === "sent" || status === "paid" || status === "voided";

  // Generate invoice HTML for preview/PDF
  const generateInvoiceHtml = useCallback(() => {
    const primaryColor = firm?.primary_color || "#1e3a5f";
    const items = lineItems.filter(li => li.description.trim());

    const rows = items.map((item, i) => `
      <tr style="${i % 2 === 0 ? '' : 'background:#f9fafb'}">
        <td style="padding:8px;border-bottom:1px solid #eee">${i + 1}</td>
        <td style="padding:8px;border-bottom:1px solid #eee">${item.description}</td>
        ${invoiceFormat === "gst_detailed" ? `<td style="padding:8px;border-bottom:1px solid #eee">${item.hsn_sac_code}</td>` : ""}
        <td style="padding:8px;border-bottom:1px solid #eee;text-align:right">${item.quantity}</td>
        ${item.unit ? `<td style="padding:8px;border-bottom:1px solid #eee">${item.unit}</td>` : ""}
        <td style="padding:8px;border-bottom:1px solid #eee;text-align:right">₹${item.rate.toLocaleString("en-IN")}</td>
        <td style="padding:8px;border-bottom:1px solid #eee;text-align:right">₹${item.amount.toLocaleString("en-IN")}</td>
      </tr>
    `).join("");

    const bankHtml = bankSnapshot ? `
      <div style="margin-top:24px;padding:16px;background:#f9fafb;border-radius:8px;font-size:13px">
        <p style="font-weight:600;margin:0 0 8px">Bank Details</p>
        ${bankSnapshot.bank_name ? `<p style="margin:2px 0">Bank: ${bankSnapshot.bank_name}</p>` : ""}
        ${bankSnapshot.account_no ? `<p style="margin:2px 0">A/C No: ${bankSnapshot.account_no}</p>` : ""}
        ${bankSnapshot.ifsc ? `<p style="margin:2px 0">IFSC: ${bankSnapshot.ifsc}</p>` : ""}
        ${bankSnapshot.branch ? `<p style="margin:2px 0">Branch: ${bankSnapshot.branch}</p>` : ""}
      </div>
    ` : "";

    if (invoiceFormat === "classic") {
      return `<!DOCTYPE html><html><head><title>Invoice ${invoiceNo}</title>
        <style>body{font-family:system-ui,sans-serif;margin:0;color:#1a1a1a}table{width:100%;border-collapse:collapse}@media print{body{margin:10px}}</style></head><body>
        <div style="background:${primaryColor};padding:24px 32px;color:white;display:flex;justify-content:space-between;align-items:center">
          <div>
            <h1 style="margin:0;font-size:24px">${fromName}</h1>
            <p style="margin:4px 0;font-size:13px;opacity:0.9">${fromAddress}</p>
            ${fromGstin ? `<p style="margin:2px 0;font-size:12px">GSTIN: ${fromGstin}</p>` : ""}
          </div>
          <div style="text-align:right">
            <h2 style="margin:0;font-size:20px">INVOICE</h2>
            <p style="margin:4px 0;font-size:14px">${invoiceNo}</p>
          </div>
        </div>
        <div style="padding:24px 32px">
          <div style="display:flex;justify-content:space-between;margin-bottom:24px">
            <div>
              <p style="font-weight:600;margin:0 0 4px;color:#666;font-size:11px;text-transform:uppercase">Bill To</p>
              <p style="margin:0;font-weight:600">${toName}</p>
              ${toAddress ? `<p style="margin:2px 0;font-size:13px">${toAddress}</p>` : ""}
              ${toPan ? `<p style="margin:2px 0;font-size:12px;color:#666">PAN: ${toPan}</p>` : ""}
              ${toGstin ? `<p style="margin:2px 0;font-size:12px;color:#666">GSTIN: ${toGstin}</p>` : ""}
            </div>
            <div style="text-align:right;font-size:13px">
              <p style="margin:2px 0"><strong>Date:</strong> ${invoiceDate ? format(new Date(invoiceDate), "dd/MM/yyyy") : "—"}</p>
              <p style="margin:2px 0"><strong>Due:</strong> ${dueDate ? format(new Date(dueDate), "dd/MM/yyyy") : "—"}</p>
              ${subject ? `<p style="margin:2px 0"><strong>Subject:</strong> ${subject}</p>` : ""}
            </div>
          </div>
          <table>
            <thead><tr style="background:#f3f4f6">
              <th style="padding:8px;text-align:left">#</th>
              <th style="padding:8px;text-align:left">Description</th>
              <th style="padding:8px;text-align:right">Qty</th>
              <th style="padding:8px;text-align:right">Rate</th>
              <th style="padding:8px;text-align:right">Amount</th>
            </tr></thead>
            <tbody>${rows}</tbody>
          </table>
          <div style="display:flex;justify-content:flex-end;margin-top:16px">
            <table style="width:280px">
              <tr><td style="padding:4px 8px">Subtotal</td><td style="padding:4px 8px;text-align:right">₹${subtotal.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td></tr>
              ${isIntraState ? `
                <tr><td style="padding:4px 8px">CGST @ ${cgstRate}%</td><td style="padding:4px 8px;text-align:right">₹${totalCgst.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td></tr>
                <tr><td style="padding:4px 8px">SGST @ ${sgstRate}%</td><td style="padding:4px 8px;text-align:right">₹${totalSgst.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td></tr>
              ` : `
                <tr><td style="padding:4px 8px">IGST @ ${igstRate}%</td><td style="padding:4px 8px;text-align:right">₹${totalIgst.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td></tr>
              `}
              <tr style="font-weight:700;font-size:16px;border-top:2px solid ${primaryColor}">
                <td style="padding:8px">Grand Total</td>
                <td style="padding:8px;text-align:right">₹${grandTotal.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
              </tr>
            </table>
          </div>
          ${bankHtml}
          ${paymentTerms ? `<p style="margin-top:16px;font-size:12px;color:#666"><strong>Payment Terms:</strong> ${paymentTerms}</p>` : ""}
          ${notes ? `<p style="margin-top:8px;font-size:12px;color:#666"><strong>Notes:</strong> ${notes}</p>` : ""}
          <div style="margin-top:40px;text-align:right">
            <p style="margin:0;font-size:12px;color:#999">Authorized Signatory</p>
            <p style="margin:4px 0;font-weight:600">${signatoryName}</p>
          </div>
          ${footerText ? `<p style="margin-top:24px;text-align:center;font-size:12px;color:#999;border-top:1px solid #eee;padding-top:12px">${footerText}</p>` : ""}
        </div></body></html>`;
    }

    // For other formats, use a simplified version
    return `<!DOCTYPE html><html><head><title>Invoice ${invoiceNo}</title>
      <style>body{font-family:system-ui,sans-serif;margin:40px;color:#1a1a1a}table{width:100%;border-collapse:collapse}@media print{body{margin:20px}}</style></head><body>
      ${invoiceFormat === "gst_detailed" ? `<h2 style="text-align:center;color:${primaryColor};margin:0">TAX INVOICE</h2>` : ""}
      <div style="display:flex;justify-content:space-between;margin-bottom:24px;padding-bottom:16px;border-bottom:${invoiceFormat === "minimal" ? "1px solid #eee" : `3px solid ${primaryColor}`}">
        <div>
          <h1 style="margin:0;font-size:${invoiceFormat === "modern" ? "28px" : "22px"};color:${invoiceFormat === "minimal" ? "#999" : primaryColor}">${fromName}</h1>
          <p style="margin:4px 0;font-size:13px;color:#666">${fromAddress}</p>
          ${fromGstin ? `<p style="margin:2px 0;font-size:12px;color:#666">GSTIN: ${fromGstin}</p>` : ""}
        </div>
        <div style="text-align:right">
          <h2 style="margin:0;font-size:18px">INVOICE</h2>
          <p style="margin:4px 0;font-size:14px">${invoiceNo}</p>
          <p style="margin:2px 0;font-size:13px">${invoiceDate ? format(new Date(invoiceDate), "dd/MM/yyyy") : ""}</p>
        </div>
      </div>
      <div style="margin-bottom:24px">
        <p style="font-size:11px;text-transform:uppercase;color:#999;margin:0 0 4px">Bill To</p>
        <p style="margin:0;font-weight:600">${toName}</p>
        ${toPan ? `<p style="margin:2px 0;font-size:12px;color:#666">PAN: ${toPan}</p>` : ""}
        ${toGstin ? `<p style="margin:2px 0;font-size:12px;color:#666">GSTIN: ${toGstin}</p>` : ""}
      </div>
      <table>
        <thead><tr style="background:#f3f4f6">
          <th style="padding:8px;text-align:left">#</th>
          <th style="padding:8px;text-align:left">Description</th>
          ${invoiceFormat === "gst_detailed" ? '<th style="padding:8px">SAC</th>' : ""}
          <th style="padding:8px;text-align:right">Qty</th>
          <th style="padding:8px;text-align:right">Rate</th>
          <th style="padding:8px;text-align:right">Amount</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div style="display:flex;justify-content:flex-end;margin-top:16px">
        <div style="${invoiceFormat === "modern" ? `background:${primaryColor};color:white;padding:16px 24px;border-radius:8px` : ""}">
          <table style="width:280px">
            <tr><td style="padding:4px 8px">Subtotal</td><td style="padding:4px 8px;text-align:right">₹${subtotal.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td></tr>
            ${isIntraState ? `
              <tr><td style="padding:4px 8px">CGST @ ${cgstRate}%</td><td style="padding:4px 8px;text-align:right">₹${totalCgst.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td></tr>
              <tr><td style="padding:4px 8px">SGST @ ${sgstRate}%</td><td style="padding:4px 8px;text-align:right">₹${totalSgst.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td></tr>
            ` : `
              <tr><td style="padding:4px 8px">IGST @ ${igstRate}%</td><td style="padding:4px 8px;text-align:right">₹${totalIgst.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td></tr>
            `}
            <tr style="font-weight:700;font-size:16px;border-top:2px solid ${invoiceFormat === "modern" ? "rgba(255,255,255,0.3)" : primaryColor}">
              <td style="padding:8px">Total</td>
              <td style="padding:8px;text-align:right">₹${grandTotal.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
            </tr>
          </table>
        </div>
      </div>
      ${bankHtml}
      <div style="margin-top:40px;text-align:right">
        <p style="margin:0;font-size:12px;color:#999">Authorized Signatory</p>
        <p style="margin:4px 0;font-weight:600">${signatoryName}</p>
      </div>
      ${footerText ? `<p style="margin-top:24px;text-align:center;font-size:12px;color:#999">${footerText}</p>` : ""}
      </body></html>`;
  }, [invoiceFormat, fromName, fromAddress, fromGstin, toName, toAddress, toPan, toGstin, invoiceNo, invoiceDate, dueDate, subject, lineItems, subtotal, totalCgst, totalSgst, totalIgst, grandTotal, cgstRate, sgstRate, igstRate, isIntraState, bankSnapshot, paymentTerms, notes, footerText, signatoryName, firm]);

  if (loading) return <div className="p-6"><Skeleton className="h-[400px] w-full" /></div>;

  return (
    <div className="h-[calc(100vh-80px)] flex flex-col">
      {/* Top bar */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-background shrink-0">
        <Button variant="ghost" size="icon" onClick={() => navigate("/billing")}><ArrowLeft size={18} /></Button>
        <div className="flex-1">
          <h1 className="text-lg font-bold text-foreground">{isEdit ? "Edit Invoice" : "New Invoice"}</h1>
          {status !== "draft" && <Badge className={cn("text-xs capitalize ml-2", status === "finalized" ? "bg-blue-100 text-blue-700" : "")}>{status}</Badge>}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleDownloadPdf} className="gap-1"><Download size={14} /> PDF</Button>
          {!isLocked && (
            <>
              <Button variant="outline" size="sm" onClick={() => handleSave()} disabled={saving} className="gap-1">
                <Save size={14} /> {saving ? "Saving..." : "Save Draft"}
              </Button>
              <Button size="sm" onClick={() => setFinalizeOpen(true)} className="gap-1"><Lock size={14} /> Finalize</Button>
            </>
          )}
        </div>
      </div>

      {/* Split screen */}
      <div className="flex-1 flex overflow-hidden">
        {/* LEFT PANEL — Form */}
        <div className="w-[45%] overflow-y-auto border-r border-border p-4 space-y-5">
          {/* Format selector */}
          <div>
            <Label className="text-xs font-semibold text-muted-foreground uppercase">Invoice Format</Label>
            <div className="grid grid-cols-5 gap-2 mt-2">
              {FORMATS.map(f => (
                <button
                  key={f.id}
                  disabled={isLocked}
                  onClick={() => setInvoiceFormat(f.id)}
                  className={cn(
                    "rounded-lg border-2 p-2 text-center transition-all text-xs",
                    invoiceFormat === f.id ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
                  )}
                >
                  <FileText size={20} className="mx-auto mb-1 text-muted-foreground" />
                  <p className="font-medium text-foreground">{f.label}</p>
                </button>
              ))}
            </div>
          </div>

          <Separator />

          {/* From */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <Label className="text-xs font-semibold text-muted-foreground uppercase">From (Firm Details)</Label>
              <div className="flex items-center gap-2">
                <Label className="text-xs">Show Logo</Label>
                <Switch checked={showLogo} onCheckedChange={setShowLogo} disabled={isLocked} />
              </div>
            </div>
            <p className="text-[10px] text-muted-foreground mb-2">Changes here only affect this invoice, not firm settings.</p>
            <div className="grid grid-cols-2 gap-2">
              <Input value={fromName} onChange={e => setFromName(e.target.value)} placeholder="Firm Name" disabled={isLocked} />
              <Input value={fromGstin} onChange={e => setFromGstin(e.target.value)} placeholder="GSTIN" disabled={isLocked} />
              <Input value={fromPan} onChange={e => setFromPan(e.target.value)} placeholder="PAN" disabled={isLocked} />
              <Input value={fromPhone} onChange={e => setFromPhone(e.target.value)} placeholder="Phone" disabled={isLocked} />
              <Input value={fromEmail} onChange={e => setFromEmail(e.target.value)} placeholder="Email" disabled={isLocked} className="col-span-2" />
              <Input value={fromAddress} onChange={e => setFromAddress(e.target.value)} placeholder="Address" disabled={isLocked} className="col-span-2" />
            </div>
          </div>

          <Separator />

          {/* To */}
          <div>
            <Label className="text-xs font-semibold text-muted-foreground uppercase mb-2 block">To (Client)</Label>
            <Select value={clientId} onValueChange={setClientId} disabled={isLocked}>
              <SelectTrigger><SelectValue placeholder="Select client" /></SelectTrigger>
              <SelectContent>{clients.map(c => <SelectItem key={c.id} value={c.id}>{c.name} ({c.pan})</SelectItem>)}</SelectContent>
            </Select>
            {clientId && (
              <div className="grid grid-cols-2 gap-2 mt-2">
                <Input value={toName} onChange={e => setToName(e.target.value)} placeholder="Name" disabled={isLocked} />
                <Input value={toPan} onChange={e => setToPan(e.target.value)} placeholder="PAN" disabled={isLocked} />
                <Input value={toGstin} onChange={e => setToGstin(e.target.value)} placeholder="GSTIN" disabled={isLocked} />
                <Input value={toAddress} onChange={e => setToAddress(e.target.value)} placeholder="Address" disabled={isLocked} />
              </div>
            )}
          </div>

          <Separator />

          {/* Meta */}
          <div>
            <Label className="text-xs font-semibold text-muted-foreground uppercase mb-2 block">Invoice Details</Label>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Invoice No</Label>
                <Input value={invoiceNo} onChange={e => setInvoiceNo(e.target.value)} disabled={isLocked} />
              </div>
              <div>
                <Label className="text-xs">Subject</Label>
                <Input value={subject} onChange={e => setSubject(e.target.value)} placeholder="Professional fees" disabled={isLocked} />
              </div>
              <div>
                <Label className="text-xs">Invoice Date</Label>
                <Input type="date" value={invoiceDate} onChange={e => setInvoiceDate(e.target.value)} disabled={isLocked} />
              </div>
              <div>
                <Label className="text-xs">Due Date</Label>
                <Input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} disabled={isLocked} />
              </div>
            </div>
          </div>

          <Separator />

          {/* Line Items */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <Label className="text-xs font-semibold text-muted-foreground uppercase">Line Items</Label>
              <div className="flex gap-1">
                {clientId && !isLocked && (
                  <Button variant="outline" size="sm" className="text-xs h-7 gap-1" onClick={fetchTimesheets}>
                    <Clock size={12} /> From Timesheet
                  </Button>
                )}
                {!isLocked && <Button variant="outline" size="sm" className="text-xs h-7 gap-1" onClick={addLine}><Plus size={12} /> Add Row</Button>}
              </div>
            </div>
            <div className="space-y-2">
              {lineItems.map((item, idx) => (
                <div key={idx} className="flex gap-2 items-start">
                  <div className="flex-1 space-y-1">
                    <Input value={item.description} onChange={e => updateLine(idx, "description", e.target.value)} placeholder="Description" className="text-sm" disabled={isLocked} />
                    <div className="flex gap-1">
                      {(invoiceFormat === "gst_detailed") && (
                        <Input value={item.hsn_sac_code} onChange={e => updateLine(idx, "hsn_sac_code", e.target.value)} placeholder="SAC" className="text-xs w-20" disabled={isLocked} />
                      )}
                      <Input type="number" value={item.quantity || ""} onChange={e => updateLine(idx, "quantity", e.target.value)} placeholder="Qty" className="text-xs w-16" disabled={isLocked} />
                      <Input value={item.unit} onChange={e => updateLine(idx, "unit", e.target.value)} placeholder="Unit" className="text-xs w-16" disabled={isLocked} />
                      <Input type="number" value={item.rate || ""} onChange={e => updateLine(idx, "rate", e.target.value)} placeholder="Rate" className="text-xs w-24" disabled={isLocked} />
                      <div className="text-xs text-right font-semibold w-24 pt-2">₹{item.amount.toLocaleString("en-IN")}</div>
                    </div>
                  </div>
                  {!isLocked && lineItems.length > 1 && (
                    <Button variant="ghost" size="icon" className="h-7 w-7 mt-1" onClick={() => removeLine(idx)}>
                      <Trash2 size={14} className="text-destructive" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </div>

          <Separator />

          {/* Tax */}
          <div>
            <Label className="text-xs font-semibold text-muted-foreground uppercase mb-2 block">Tax</Label>
            <div className="flex items-center gap-3 mb-3">
              <Switch checked={isIntraState} onCheckedChange={setIsIntraState} disabled={isLocked} />
              <Label className="text-sm">{isIntraState ? "Intra-State (CGST + SGST)" : "Inter-State (IGST)"}</Label>
            </div>
            <div className="flex gap-2">
              {isIntraState ? (
                <>
                  <div>
                    <Label className="text-xs">CGST %</Label>
                    <Input type="number" value={cgstRate} onChange={e => setCgstRate(Number(e.target.value))} className="w-20" disabled={isLocked} />
                  </div>
                  <div>
                    <Label className="text-xs">SGST %</Label>
                    <Input type="number" value={sgstRate} onChange={e => setSgstRate(Number(e.target.value))} className="w-20" disabled={isLocked} />
                  </div>
                </>
              ) : (
                <div>
                  <Label className="text-xs">IGST %</Label>
                  <Input type="number" value={igstRate} onChange={e => setIgstRate(Number(e.target.value))} className="w-20" disabled={isLocked} />
                </div>
              )}
            </div>
            <div className="mt-3 text-sm space-y-1 text-right">
              <p>Subtotal: <strong>₹{subtotal.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</strong></p>
              {isIntraState ? (
                <>
                  <p>CGST @ {cgstRate}%: <strong>₹{totalCgst.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</strong></p>
                  <p>SGST @ {sgstRate}%: <strong>₹{totalSgst.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</strong></p>
                </>
              ) : (
                <p>IGST @ {igstRate}%: <strong>₹{totalIgst.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</strong></p>
              )}
              <p className="text-lg font-bold">Grand Total: ₹{grandTotal.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</p>
            </div>
          </div>

          <Separator />

          {/* Payment & Footer */}
          <div>
            <Label className="text-xs font-semibold text-muted-foreground uppercase mb-2 block">Payment & Footer</Label>
            <div className="space-y-2">
              <div>
                <Label className="text-xs">Payment Terms</Label>
                <Textarea value={paymentTerms} onChange={e => setPaymentTerms(e.target.value)} className="h-16 text-sm" disabled={isLocked} />
              </div>
              <div>
                <Label className="text-xs">Notes</Label>
                <Textarea value={notes} onChange={e => setNotes(e.target.value)} className="h-12 text-sm" placeholder="Internal notes..." disabled={isLocked} />
              </div>
              <div>
                <Label className="text-xs">Footer Text</Label>
                <Input value={footerText} onChange={e => setFooterText(e.target.value)} disabled={isLocked} />
              </div>
              <div>
                <Label className="text-xs">Authorized Signatory</Label>
                <Input value={signatoryName} onChange={e => setSignatoryName(e.target.value)} disabled={isLocked} />
              </div>
            </div>
          </div>
        </div>

        {/* RIGHT PANEL — Live Preview */}
        <div className="w-[55%] overflow-y-auto bg-muted/30 p-6">
          <div className="bg-background rounded-lg shadow-lg max-w-[700px] mx-auto">
            <iframe
              srcDoc={generateInvoiceHtml()}
              className="w-full min-h-[800px] border-0 rounded-lg"
              title="Invoice Preview"
            />
          </div>
        </div>
      </div>

      {/* Timesheet modal */}
      <Dialog open={tsModalOpen} onOpenChange={setTsModalOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Select Timesheet Entries</DialogTitle></DialogHeader>
          <div className="max-h-[300px] overflow-y-auto">
            {tsEntries.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">No unbilled timesheet entries for this client.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10"></TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead className="text-right">Hours</TableHead>
                    <TableHead>Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tsEntries.map(t => (
                    <TableRow key={t.id} className="cursor-pointer" onClick={() => {
                      setTsSelected(prev => prev.includes(t.id) ? prev.filter(x => x !== t.id) : [...prev, t.id]);
                    }}>
                      <TableCell><input type="checkbox" checked={tsSelected.includes(t.id)} readOnly /></TableCell>
                      <TableCell className="text-sm">{t.description}</TableCell>
                      <TableCell className="text-right">{t.hours}h</TableCell>
                      <TableCell className="text-sm">{t.work_date ? format(new Date(t.work_date), "dd/MM/yyyy") : ""}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTsModalOpen(false)}>Cancel</Button>
            <Button onClick={applyTimesheets} disabled={tsSelected.length === 0}>Add {tsSelected.length} Entries</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Finalize confirmation */}
      <AlertDialog open={finalizeOpen} onOpenChange={setFinalizeOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Finalize Invoice?</AlertDialogTitle>
            <AlertDialogDescription>Once finalized, the invoice cannot be edited. You can still send it, download PDF, or void it.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleFinalize}>Finalize</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default NewInvoice;
