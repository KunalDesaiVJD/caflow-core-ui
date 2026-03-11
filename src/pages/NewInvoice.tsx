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
  ArrowLeft, Plus, Trash2, Save, Lock, Download,
  FileText, Info,
} from "lucide-react";

// ─── Types ───
interface LineItem {
  id?: string;
  description: string;
  description_details: string;
  hsn_sac_code: string;
  quantity: number;
  rate: number;
  discount_percent: number;
  taxable_value: number;
  cgst_percent: number;
  cgst_amount: number;
  sgst_percent: number;
  sgst_amount: number;
  cess: number;
  total: number;
  sort_order: number;
  showDetails: boolean;
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
  settings: any;
}

const EMPTY_ITEM = (): LineItem => ({
  description: "", description_details: "", hsn_sac_code: "", quantity: 1, rate: 0,
  discount_percent: 0, taxable_value: 0, cgst_percent: 9, cgst_amount: 0,
  sgst_percent: 9, sgst_amount: 0, cess: 0, total: 0, sort_order: 0, showDetails: false,
});

// Amount in words helper
function numberToWords(num: number): string {
  if (num === 0) return "Zero Rupees Only";
  const ones = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
    "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
  const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  const scales = ["", "Thousand", "Lakh", "Crore"];

  const toWords = (n: number): string => {
    if (n === 0) return "";
    if (n < 20) return ones[n];
    if (n < 100) return tens[Math.floor(n / 10)] + (n % 10 ? " " + ones[n % 10] : "");
    return ones[Math.floor(n / 100)] + " Hundred" + (n % 100 ? " " + toWords(n % 100) : "");
  };

  const intPart = Math.floor(Math.abs(num));
  if (intPart === 0) return "Zero Rupees Only";

  // Indian numbering: last 3 digits, then groups of 2
  const groups: number[] = [];
  let rem = intPart;
  groups.push(rem % 1000); rem = Math.floor(rem / 1000);
  while (rem > 0) { groups.push(rem % 100); rem = Math.floor(rem / 100); }

  let result = "";
  for (let i = groups.length - 1; i >= 0; i--) {
    if (groups[i] === 0) continue;
    result += toWords(groups[i]) + (scales[i] ? " " + scales[i] : "") + " ";
  }
  return result.trim() + " Rupees Only";
}

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
  const [clientId, setClientId] = useState("");
  const [invoiceNo, setInvoiceNo] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [dueDate, setDueDate] = useState(format(addDays(new Date(), 30), "yyyy-MM-dd"));
  const [referenceNo, setReferenceNo] = useState("");
  const [placeOfSupply, setPlaceOfSupply] = useState("");
  const [lineItems, setLineItems] = useState<LineItem[]>([EMPTY_ITEM()]);
  const [isIntraState, setIsIntraState] = useState(true);
  const [status, setStatus] = useState("draft");
  const [showLogo, setShowLogo] = useState(true);

  // Client address
  const [toName, setToName] = useState("");
  const [toGstin, setToGstin] = useState("");
  const [toAddress, setToAddress] = useState("");
  const [toCity, setToCity] = useState("");
  const [toState, setToState] = useState("");
  const [toPin, setToPin] = useState("");

  // Finalize dialog
  const [finalizeOpen, setFinalizeOpen] = useState(false);

  // Fetch initial data
  useEffect(() => {
    (async () => {
      setLoading(true);
      let cq = supabase.from("clients").select("id, name, pan, gstin, entity_type").order("name");
      if (!isSuperadmin && firmId) cq = cq.eq("firm_id", firmId);
      const { data: clientData } = await cq;
      setClients(clientData || []);

      // Fetch firm - auto-populate from Firm Management
      if (firmId) {
        const { data: firmData } = await supabase.from("firms")
          .select("name, display_name, logo_url, pan, gstin, phone, email, address, bank_details, primary_color, signature_url, state, settings")
          .eq("id", firmId).single();
        if (firmData) {
          setFirm(firmData);
          setPlaceOfSupply(firmData.state ? `${firmData.state}` : "");
        }
      }

      // Generate invoice number in ###-FY format
      if (!isEdit) {
        const now = new Date();
        const fyStart = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
        const fy = `${fyStart}-${String(fyStart + 1).slice(2)}`;
        let invQ = supabase.from("invoices").select("invoice_no").order("invoice_no", { ascending: false }).limit(1);
        if (!isSuperadmin && firmId) invQ = invQ.eq("firm_id", firmId);
        const { data: lastInv } = await invQ;
        let nextNum = 1;
        if (lastInv?.[0]?.invoice_no) {
          const match = lastInv[0].invoice_no.match(/^(\d+)/);
          if (match) nextNum = parseInt(match[1]) + 1;
        }
        setInvoiceNo(`${nextNum}-${fy}`);
      }

      // Load existing invoice
      if (isEdit && invoiceId) {
        const { data: inv } = await supabase.from("invoices").select("*").eq("id", invoiceId).single();
        if (inv) {
          setClientId(inv.client_id || "");
          setInvoiceNo(inv.invoice_no || "");
          setInvoiceDate(inv.invoice_date || "");
          setDueDate(inv.due_date || "");
          setReferenceNo((inv as any).reference_no || "");
          setStatus(inv.status || "draft");
          setShowLogo(inv.show_logo ?? true);
          setToName(inv.to_name || "");
          setToGstin(inv.to_gstin || "");
          setToAddress(inv.to_address || "");
          if (Array.isArray(inv.line_items) && inv.line_items.length > 0) {
            setLineItems(inv.line_items.map((li: any, i: number) => ({
              ...EMPTY_ITEM(),
              description: li.description || "",
              description_details: li.description_details || "",
              hsn_sac_code: li.hsn_sac_code || li.hsn || "",
              quantity: li.quantity || 1,
              rate: li.rate || 0,
              discount_percent: li.discount_percent || 0,
              taxable_value: li.taxable_value || li.amount || 0,
              cgst_percent: li.cgst_percent ?? 9,
              cgst_amount: li.cgst_amount || 0,
              sgst_percent: li.sgst_percent ?? 9,
              sgst_amount: li.sgst_amount || 0,
              cess: li.cess || 0,
              total: li.total || 0,
              sort_order: i,
              showDetails: false,
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
      setToGstin(client.gstin?.[0] || "");
    }
  }, [clientId, clients]);

  // Recalculate line item
  const recalcItem = (item: LineItem): LineItem => {
    const qty = Number(item.quantity) || 0;
    const rate = Number(item.rate) || 0;
    const disc = Number(item.discount_percent) || 0;
    const baseAmt = qty * rate;
    const discAmt = baseAmt * disc / 100;
    const taxable = Math.round((baseAmt - discAmt) * 100) / 100;
    const cgst = isIntraState ? Math.round(taxable * (Number(item.cgst_percent) || 0) / 100 * 100) / 100 : 0;
    const sgst = isIntraState ? Math.round(taxable * (Number(item.sgst_percent) || 0) / 100 * 100) / 100 : 0;
    const cess = Number(item.cess) || 0;
    return { ...item, taxable_value: taxable, cgst_amount: cgst, sgst_amount: sgst, total: taxable + cgst + sgst + cess };
  };

  const updateLine = (idx: number, field: keyof LineItem, value: any) => {
    setLineItems(prev => {
      const next = [...prev];
      const item = { ...next[idx], [field]: value };
      next[idx] = recalcItem(item);
      return next;
    });
  };
  const addLine = () => setLineItems(prev => [...prev, { ...EMPTY_ITEM(), sort_order: prev.length }]);
  const removeLine = (idx: number) => { if (lineItems.length > 1) setLineItems(prev => prev.filter((_, i) => i !== idx)); };
  const toggleDetails = (idx: number) => {
    setLineItems(prev => prev.map((li, i) => i === idx ? { ...li, showDetails: !li.showDetails } : li));
  };

  // Recalc all items when intra-state changes
  useEffect(() => {
    setLineItems(prev => prev.map(li => recalcItem(li)));
  }, [isIntraState]);

  // Totals
  const items = useMemo(() => lineItems.filter(li => li.description.trim()), [lineItems]);
  const totalTaxable = useMemo(() => items.reduce((s, li) => s + li.taxable_value, 0), [items]);
  const totalCgst = useMemo(() => items.reduce((s, li) => s + li.cgst_amount, 0), [items]);
  const totalSgst = useMemo(() => items.reduce((s, li) => s + li.sgst_amount, 0), [items]);
  const totalCess = useMemo(() => items.reduce((s, li) => s + li.cess, 0), [items]);
  const totalTax = totalCgst + totalSgst + totalCess;
  const grandTotal = totalTaxable + totalTax;

  const firmName = firm?.display_name || firm?.name || "";
  const firmAddr = firm?.address as any;
  const firmFullAddress = firmAddr ? [firmAddr.line1, firmAddr.line2, firmAddr.city, firmAddr.state, firmAddr.pincode].filter(Boolean).join(", ") : "";
  const bankDetails = firm?.bank_details as any;
  const msmeNo = (firm?.settings as any)?.msme_no || "";

  // Save
  const handleSave = async (newStatus?: string) => {
    if (!clientId) { toast({ title: "Select a client", variant: "destructive" }); return; }
    if (items.length === 0) { toast({ title: "Add at least one item", variant: "destructive" }); return; }
    setSaving(true);
    try {
      const effectiveStatus = newStatus || status;
      const payload: any = {
        invoice_no: invoiceNo,
        client_id: clientId,
        firm_id: firmId,
        invoice_date: invoiceDate,
        due_date: dueDate,
        reference_no: referenceNo,
        invoice_format: "gst_tax_invoice",
        amount: totalTaxable,
        subtotal: totalTaxable,
        gst_amount: totalTax,
        total_cgst: totalCgst,
        total_sgst: totalSgst,
        total_amount: grandTotal,
        is_intra_state: isIntraState,
        show_logo: showLogo,
        status: effectiveStatus,
        from_firm_name: firmName,
        from_address: firmFullAddress,
        from_gstin: firm?.gstin || "",
        from_pan: firm?.pan || "",
        from_phone: firm?.phone || "",
        from_email: firm?.email || "",
        to_name: toName,
        to_address: toAddress,
        to_gstin: toGstin,
        bank_details_snapshot: bankDetails,
        line_items: items.map(li => ({
          description: li.description,
          description_details: li.description_details,
          hsn_sac_code: li.hsn_sac_code,
          quantity: li.quantity,
          rate: li.rate,
          discount_percent: li.discount_percent,
          taxable_value: li.taxable_value,
          cgst_percent: li.cgst_percent,
          cgst_amount: li.cgst_amount,
          sgst_percent: li.sgst_percent,
          sgst_amount: li.sgst_amount,
          cess: li.cess,
          total: li.total,
        })),
        signatory_name: firmName,
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
    const w = window.open(URL.createObjectURL(blob), "_blank");
    if (w) setTimeout(() => { w.print(); }, 500);
  };

  const isLocked = status === "finalized" || status === "sent" || status === "paid" || status === "voided";

  // Generate invoice HTML matching reference format exactly
  const generateInvoiceHtml = useCallback(() => {
    const validItems = lineItems.filter(li => li.description.trim());
    const fmtINR = (n: number) => n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    const itemRows = validItems.map((item, i) => `
      <tr>
        <td style="border:1px solid #999;padding:6px 8px;text-align:center;font-size:12px">${i + 1}.</td>
        <td style="border:1px solid #999;padding:6px 8px;font-size:12px">
          ${item.description}
          ${item.description_details ? `<div style="font-size:10px;color:#555;margin-top:2px;white-space:pre-line">${item.description_details}</div>` : ""}
        </td>
        <td style="border:1px solid #999;padding:6px 8px;text-align:center;font-size:12px">${item.hsn_sac_code}</td>
        <td style="border:1px solid #999;padding:6px 8px;text-align:right;font-size:12px">${Number(item.quantity).toFixed(2)}</td>
        <td style="border:1px solid #999;padding:6px 8px;text-align:right;font-size:12px">${fmtINR(item.rate)}</td>
        <td style="border:1px solid #999;padding:6px 8px;text-align:right;font-size:12px">${item.discount_percent > 0 ? fmtINR(item.taxable_value * item.discount_percent / (100 - item.discount_percent)) : "0.00"}</td>
        <td style="border:1px solid #999;padding:6px 8px;text-align:right;font-size:12px">${fmtINR(item.taxable_value)}</td>
        ${isIntraState ? `
          <td style="border:1px solid #999;padding:6px 8px;text-align:right;font-size:11px">${item.cgst_percent}%<br/>${fmtINR(item.cgst_amount)}</td>
          <td style="border:1px solid #999;padding:6px 8px;text-align:right;font-size:11px">${item.sgst_percent}%<br/>${fmtINR(item.sgst_amount)}</td>
        ` : `
          <td style="border:1px solid #999;padding:6px 8px;text-align:right;font-size:11px" colspan="2">${item.cgst_percent + item.sgst_percent}%<br/>${fmtINR(item.cgst_amount + item.sgst_amount)}</td>
        `}
        <td style="border:1px solid #999;padding:6px 8px;text-align:right;font-size:12px">${item.cess > 0 ? fmtINR(item.cess) : "0.00"}</td>
        <td style="border:1px solid #999;padding:6px 8px;text-align:right;font-size:12px;font-weight:600">${fmtINR(item.total)}</td>
      </tr>
    `).join("");

    const totalRow = `
      <tr style="background:#f5f5f5;font-weight:700">
        <td style="border:1px solid #999;padding:8px" colspan="2">Total</td>
        <td style="border:1px solid #999;padding:8px"></td>
        <td style="border:1px solid #999;padding:8px"></td>
        <td style="border:1px solid #999;padding:8px"></td>
        <td style="border:1px solid #999;padding:8px"></td>
        <td style="border:1px solid #999;padding:8px;text-align:right;font-size:12px">${fmtINR(totalTaxable)}</td>
        ${isIntraState ? `
          <td style="border:1px solid #999;padding:8px;text-align:right;font-size:12px">${fmtINR(totalCgst)}</td>
          <td style="border:1px solid #999;padding:8px;text-align:right;font-size:12px">${fmtINR(totalSgst)}</td>
        ` : `
          <td style="border:1px solid #999;padding:8px;text-align:right;font-size:12px" colspan="2">${fmtINR(totalCgst + totalSgst)}</td>
        `}
        <td style="border:1px solid #999;padding:8px;text-align:right;font-size:12px">${fmtINR(totalCess)}</td>
        <td style="border:1px solid #999;padding:8px;text-align:right;font-size:13px">${fmtINR(grandTotal)}</td>
      </tr>
    `;

    const logoHtml = showLogo && firm?.logo_url 
      ? `<img src="${firm.logo_url}" style="max-width:200px;max-height:80px;object-fit:contain" />`
      : `<div style="font-size:20px;font-weight:800;color:#1a365d">${firmName}</div>`;

    return `<!DOCTYPE html><html><head><title>Tax Invoice ${invoiceNo}</title>
      <style>
        body{font-family:'Segoe UI',system-ui,sans-serif;margin:0;padding:20px;color:#1a1a1a;font-size:13px}
        table{width:100%;border-collapse:collapse}
        @media print{body{margin:10px;padding:10px}@page{margin:10mm}}
      </style></head><body>
      <div style="max-width:900px;margin:0 auto">
        <!-- Header -->
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">
          <div>${logoHtml}</div>
          <div style="text-align:right">
            <div style="border:2px dashed #333;padding:6px 16px;display:inline-block;font-size:13px;font-weight:700">ORIGINAL<br/><span style="font-size:11px;font-weight:400">For Recipient</span></div>
          </div>
        </div>

        <!-- TAX INVOICE title -->
        <div style="text-align:center;margin:12px 0;border-top:2px solid #333;border-bottom:2px solid #333;padding:8px 0">
          <h1 style="margin:0;font-size:22px;font-weight:800;letter-spacing:2px">TAX INVOICE</h1>
        </div>

        <!-- Firm + Invoice details -->
        <div style="display:flex;justify-content:space-between;margin-bottom:12px">
          <div style="flex:1">
            <p style="font-weight:700;margin:0 0 4px;font-size:15px">${firmName}</p>
            <p style="margin:2px 0;font-size:12px">${firmFullAddress}</p>
            ${firm?.gstin ? `<p style="margin:4px 0;font-size:12px"><strong>GSTIN:</strong> ${firm.gstin}</p>` : ""}
          </div>
          <div style="text-align:right;font-size:12px;min-width:280px">
            ${firm?.gstin ? `<p style="margin:2px 0"><strong>GSTIN:</strong> ${firm.gstin}</p>` : ""}
            ${firm?.state ? `<p style="margin:2px 0"><strong>State:</strong> ${firm.state}</p>` : ""}
            ${firm?.pan ? `<p style="margin:2px 0"><strong>PAN:</strong> ${firm.pan}</p>` : ""}
            <p style="margin:2px 0"><strong>Invoice Date:</strong> ${invoiceDate ? format(new Date(invoiceDate), "dd/MM/yyyy") : "—"}</p>
            <p style="margin:2px 0"><strong>Invoice No.:</strong> ${invoiceNo}</p>
            ${referenceNo ? `<p style="margin:2px 0"><strong>Reference No.:</strong> ${referenceNo}</p>` : ""}
          </div>
        </div>

        <!-- Customer details - 3 columns -->
        <div style="border:1px solid #999;display:flex;margin-bottom:8px">
          <div style="flex:1;padding:10px;border-right:1px solid #999">
            <p style="font-size:11px;font-weight:700;color:#666;margin:0 0 4px;text-transform:uppercase">Customer Name</p>
            <p style="font-weight:600;margin:0">${toName}</p>
            ${toGstin ? `<p style="margin:4px 0;font-size:11px">Customer GSTIN: ${toGstin}</p>` : ""}
          </div>
          <div style="flex:1;padding:10px;border-right:1px solid #999">
            <p style="font-size:11px;font-weight:700;color:#666;margin:0 0 4px;text-transform:uppercase">Billing Address</p>
            <p style="font-weight:600;margin:0">${toName}</p>
            <p style="margin:2px 0;font-size:11px">${toAddress}</p>
            <p style="margin:2px 0;font-size:11px">${[toCity, toState, toPin].filter(Boolean).join(", ")}</p>
            ${toGstin ? `<p style="margin:2px 0;font-size:11px">${toGstin}</p>` : ""}
          </div>
          <div style="flex:1;padding:10px">
            <p style="font-size:11px;font-weight:700;color:#666;margin:0 0 4px;text-transform:uppercase">Shipping Address</p>
            <p style="font-weight:600;margin:0">${toName}</p>
            <p style="margin:2px 0;font-size:11px">${toAddress}</p>
            <p style="margin:2px 0;font-size:11px">${[toCity, toState, toPin].filter(Boolean).join(", ")}</p>
          </div>
        </div>

        <!-- Place of Supply + Due Date -->
        <div style="display:flex;border:1px solid #999;margin-bottom:12px">
          <div style="flex:1;padding:6px 10px;border-right:1px solid #999;font-size:12px"><strong>Place of Supply:</strong> ${placeOfSupply || firm?.state || ""}</div>
          <div style="flex:1;padding:6px 10px;font-size:12px"><strong>Due Date:</strong> ${dueDate ? format(new Date(dueDate), "dd/MM/yyyy") : "—"}</div>
        </div>

        <!-- Items Table -->
        <table>
          <thead>
            <tr style="background:#e8e8e8">
              <th style="border:1px solid #999;padding:8px;font-size:11px;width:30px">#</th>
              <th style="border:1px solid #999;padding:8px;font-size:11px;text-align:left">Item</th>
              <th style="border:1px solid #999;padding:8px;font-size:11px">HSN/SAC</th>
              <th style="border:1px solid #999;padding:8px;font-size:11px">Quantity</th>
              <th style="border:1px solid #999;padding:8px;font-size:11px">Rate / Item</th>
              <th style="border:1px solid #999;padding:8px;font-size:11px">Discount</th>
              <th style="border:1px solid #999;padding:8px;font-size:11px">Taxable Value</th>
              ${isIntraState ? `
                <th style="border:1px solid #999;padding:8px;font-size:11px">CGST</th>
                <th style="border:1px solid #999;padding:8px;font-size:11px">SGST/UTGST</th>
              ` : `
                <th style="border:1px solid #999;padding:8px;font-size:11px" colspan="2">IGST</th>
              `}
              <th style="border:1px solid #999;padding:8px;font-size:11px">CESS</th>
              <th style="border:1px solid #999;padding:8px;font-size:11px">Total</th>
            </tr>
          </thead>
          <tbody>
            ${itemRows}
            ${totalRow}
          </tbody>
        </table>

        <!-- Totals summary -->
        <div style="display:flex;justify-content:flex-end;margin-top:8px">
          <table style="width:350px;font-size:13px">
            <tr><td style="padding:4px 8px">Taxable Amount</td><td style="padding:4px 8px;text-align:right;font-weight:600">₹ ${fmtINR(totalTaxable)}</td></tr>
            <tr><td style="padding:4px 8px">Total Tax</td><td style="padding:4px 8px;text-align:right">₹ ${fmtINR(totalTax)}</td></tr>
            <tr style="font-weight:700;font-size:14px;border-top:2px solid #333"><td style="padding:8px">Total Value</td><td style="padding:8px;text-align:right">₹ ${fmtINR(grandTotal)}</td></tr>
          </table>
        </div>

        <!-- Amount in words -->
        <div style="margin:8px 0;padding:8px;background:#f9f9f9;border:1px solid #ddd;font-size:12px">
          <strong>Total amount (in words):</strong> ${numberToWords(Math.round(grandTotal))}
        </div>

        <!-- Bank Details + Signatory -->
        <div style="display:flex;justify-content:space-between;margin-top:16px">
          <div style="border:1px solid #999;padding:12px;font-size:12px;min-width:320px">
            <p style="font-weight:700;margin:0 0 6px;font-size:13px">Bank Details:</p>
            ${bankDetails?.account_no ? `<p style="margin:2px 0"><strong>Account Number:</strong> ${bankDetails.account_no}</p>` : ""}
            ${bankDetails?.ifsc ? `<p style="margin:2px 0"><strong>IFSC:</strong> ${bankDetails.ifsc}</p>` : ""}
            ${bankDetails?.bank_name ? `<p style="margin:2px 0"><strong>Bank Name:</strong> ${bankDetails.bank_name}</p>` : ""}
            ${bankDetails?.branch ? `<p style="margin:2px 0"><strong>Branch Name:</strong> ${bankDetails.branch}</p>` : ""}
          </div>
          <div style="text-align:right;padding-top:8px">
            <p style="margin:0;font-size:13px;font-weight:600">For ${firmName}</p>
            <div style="height:50px"></div>
            <p style="margin:0;font-size:12px;border-top:1px solid #333;padding-top:4px">Authorised Signatory</p>
          </div>
        </div>

        <!-- Terms -->
        <div style="margin-top:16px;padding-top:8px;border-top:1px solid #ddd;font-size:11px;color:#666">
          <p style="font-weight:700;margin:0 0 4px">Terms & Conditions:</p>
          ${msmeNo ? `<p style="margin:2px 0">MSME/UDYAM NO: ${msmeNo}</p><p style="margin:2px 0">WE ARE REGISTERED UNDER MSME</p>` : ""}
        </div>
      </div></body></html>`;
  }, [lineItems, invoiceNo, invoiceDate, dueDate, referenceNo, placeOfSupply, isIntraState,
    firm, firmName, firmFullAddress, bankDetails, msmeNo, showLogo, toName, toGstin, toAddress, toCity, toState, toPin,
    totalTaxable, totalCgst, totalSgst, totalCess, totalTax, grandTotal]);

  if (loading) return <div className="p-6"><Skeleton className="h-[400px] w-full" /></div>;

  return (
    <div className="h-[calc(100vh-80px)] flex flex-col">
      {/* Top bar */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-background shrink-0">
        <Button variant="ghost" size="icon" onClick={() => navigate("/billing")}><ArrowLeft size={18} /></Button>
        <div className="flex-1">
          <h1 className="text-lg font-bold text-foreground">{isEdit ? "Edit Invoice" : "New Tax Invoice"}</h1>
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
        <div className="w-[45%] overflow-y-auto border-r border-border p-4 space-y-4">
          {/* Client */}
          <div>
            <Label className="text-xs font-semibold text-muted-foreground uppercase mb-2 block">Client</Label>
            <Select value={clientId} onValueChange={setClientId} disabled={isLocked}>
              <SelectTrigger><SelectValue placeholder="Select client" /></SelectTrigger>
              <SelectContent>{clients.map(c => <SelectItem key={c.id} value={c.id}>{c.name} ({c.pan})</SelectItem>)}</SelectContent>
            </Select>
            {clientId && (
              <div className="grid grid-cols-2 gap-2 mt-2">
                <Input value={toName} onChange={e => setToName(e.target.value)} placeholder="Customer Name" disabled={isLocked} />
                <Input value={toGstin} onChange={e => setToGstin(e.target.value)} placeholder="GSTIN" disabled={isLocked} />
                <Input value={toAddress} onChange={e => setToAddress(e.target.value)} placeholder="Address" disabled={isLocked} />
                <Input value={toCity} onChange={e => setToCity(e.target.value)} placeholder="City" disabled={isLocked} />
                <Input value={toState} onChange={e => setToState(e.target.value)} placeholder="State" disabled={isLocked} />
                <Input value={toPin} onChange={e => setToPin(e.target.value)} placeholder="PIN" disabled={isLocked} />
              </div>
            )}
          </div>

          <Separator />

          {/* Firm details (read-only from Firm Management) */}
          <div>
            <Label className="text-xs font-semibold text-muted-foreground uppercase mb-2 block">
              From (Auto-fetched from Firm Management)
            </Label>
            <div className="text-sm space-y-1 text-muted-foreground bg-muted/30 p-3 rounded-md">
              <p className="font-medium text-foreground">{firmName}</p>
              <p>{firmFullAddress}</p>
              {firm?.gstin && <p>GSTIN: {firm.gstin}</p>}
              {firm?.pan && <p>PAN: {firm.pan}</p>}
              {bankDetails?.bank_name && <p>Bank: {bankDetails.bank_name} | A/C: {bankDetails.account_no}</p>}
            </div>
            <div className="flex items-center gap-2 mt-2">
              <Switch checked={showLogo} onCheckedChange={setShowLogo} disabled={isLocked} />
              <Label className="text-xs">Show Logo</Label>
            </div>
          </div>

          <Separator />

          {/* Invoice Details */}
          <div>
            <Label className="text-xs font-semibold text-muted-foreground uppercase mb-2 block">Invoice Details</Label>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Invoice No</Label>
                <Input value={invoiceNo} readOnly className="bg-muted" />
              </div>
              <div>
                <Label className="text-xs">Reference No</Label>
                <Input value={referenceNo} onChange={e => setReferenceNo(e.target.value)} placeholder="Optional" disabled={isLocked} />
              </div>
              <div>
                <Label className="text-xs">Invoice Date</Label>
                <Input type="date" value={invoiceDate} onChange={e => setInvoiceDate(e.target.value)} disabled={isLocked} />
              </div>
              <div>
                <Label className="text-xs">Due Date</Label>
                <Input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} disabled={isLocked} />
              </div>
              <div>
                <Label className="text-xs">Place of Supply</Label>
                <Input value={placeOfSupply} onChange={e => setPlaceOfSupply(e.target.value)} disabled={isLocked} />
              </div>
              <div className="flex items-end gap-2 pb-1">
                <Switch checked={isIntraState} onCheckedChange={setIsIntraState} disabled={isLocked} />
                <Label className="text-xs">{isIntraState ? "Intra-State (CGST+SGST)" : "Inter-State (IGST)"}</Label>
              </div>
            </div>
          </div>

          <Separator />

          {/* Line Items */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <Label className="text-xs font-semibold text-muted-foreground uppercase">Line Items</Label>
              {!isLocked && <Button variant="outline" size="sm" className="text-xs h-7 gap-1" onClick={addLine}><Plus size={12} /> Add Row</Button>}
            </div>
            <div className="space-y-3">
              {lineItems.map((item, idx) => (
                <div key={idx} className="border border-border rounded-md p-3 space-y-2">
                  <div className="flex gap-2">
                    <Input value={item.description} onChange={e => updateLine(idx, "description", e.target.value)} placeholder="Item description" className="flex-1 text-sm" disabled={isLocked} />
                    <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => toggleDetails(idx)} title="Add details">
                      <Info size={14} className={item.showDetails ? "text-primary" : "text-muted-foreground"} />
                    </Button>
                    {!isLocked && lineItems.length > 1 && (
                      <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => removeLine(idx)}>
                        <Trash2 size={14} className="text-destructive" />
                      </Button>
                    )}
                  </div>
                  {item.showDetails && (
                    <Textarea
                      value={item.description_details}
                      onChange={e => updateLine(idx, "description_details", e.target.value)}
                      placeholder="Detailed description (appears in PDF)"
                      className="text-xs h-16"
                      disabled={isLocked}
                    />
                  )}
                  <div className="grid grid-cols-6 gap-1">
                    <div>
                      <Label className="text-[10px]">HSN/SAC</Label>
                      <Input value={item.hsn_sac_code} onChange={e => updateLine(idx, "hsn_sac_code", e.target.value)} className="text-xs h-8" disabled={isLocked} />
                    </div>
                    <div>
                      <Label className="text-[10px]">Qty</Label>
                      <Input type="number" value={item.quantity || ""} onChange={e => updateLine(idx, "quantity", Number(e.target.value))} className="text-xs h-8" disabled={isLocked} />
                    </div>
                    <div>
                      <Label className="text-[10px]">Rate</Label>
                      <Input type="number" value={item.rate || ""} onChange={e => updateLine(idx, "rate", Number(e.target.value))} className="text-xs h-8" disabled={isLocked} />
                    </div>
                    <div>
                      <Label className="text-[10px]">Disc %</Label>
                      <Input type="number" value={item.discount_percent || ""} onChange={e => updateLine(idx, "discount_percent", Number(e.target.value))} className="text-xs h-8" disabled={isLocked} />
                    </div>
                    <div>
                      <Label className="text-[10px]">{isIntraState ? "CGST %" : "IGST %"}</Label>
                      <Input type="number" value={item.cgst_percent || ""} onChange={e => { updateLine(idx, "cgst_percent", Number(e.target.value)); updateLine(idx, "sgst_percent", Number(e.target.value)); }} className="text-xs h-8" disabled={isLocked} />
                    </div>
                    <div>
                      <Label className="text-[10px]">Total</Label>
                      <div className="text-xs font-semibold pt-2 text-right">₹{item.total.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <Separator />

          {/* Totals */}
          <div className="text-sm space-y-1 text-right">
            <p>Taxable Amount: <strong>₹{totalTaxable.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</strong></p>
            {isIntraState ? (
              <>
                <p>Total CGST: <strong>₹{totalCgst.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</strong></p>
                <p>Total SGST: <strong>₹{totalSgst.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</strong></p>
              </>
            ) : (
              <p>Total IGST: <strong>₹{(totalCgst + totalSgst).toLocaleString("en-IN", { minimumFractionDigits: 2 })}</strong></p>
            )}
            <p className="text-lg font-bold text-foreground">Grand Total: ₹{grandTotal.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</p>
            <p className="text-xs text-muted-foreground italic">{numberToWords(Math.round(grandTotal))}</p>
          </div>
        </div>

        {/* RIGHT PANEL — Live Preview */}
        <div className="w-[55%] overflow-y-auto bg-muted/30 p-6">
          <div className="bg-background rounded-lg shadow-lg max-w-[700px] mx-auto">
            <iframe
              srcDoc={generateInvoiceHtml()}
              className="w-full min-h-[900px] border-0 rounded-lg"
              title="Invoice Preview"
            />
          </div>
        </div>
      </div>

      {/* Finalize confirmation */}
      <AlertDialog open={finalizeOpen} onOpenChange={setFinalizeOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Finalize Invoice?</AlertDialogTitle>
            <AlertDialogDescription>Once finalized, the invoice cannot be edited.</AlertDialogDescription>
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
