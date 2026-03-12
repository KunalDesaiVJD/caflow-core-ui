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
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import { format, addDays } from "date-fns";
import { cn } from "@/lib/utils";
import {
  ArrowLeft, Plus, Trash2, Save, Lock, Download,
  FileText, Info, Check, ChevronsUpDown, Settings2,
} from "lucide-react";

// ─── GSTIN State Code Map ───
const STATE_CODES: Record<string, string> = {
  "01": "Jammu & Kashmir", "02": "Himachal Pradesh", "03": "Punjab", "04": "Chandigarh",
  "05": "Uttarakhand", "06": "Haryana", "07": "Delhi", "08": "Rajasthan",
  "09": "Uttar Pradesh", "10": "Bihar", "11": "Sikkim", "12": "Arunachal Pradesh",
  "13": "Nagaland", "14": "Manipur", "15": "Mizoram", "16": "Tripura",
  "17": "Meghalaya", "18": "Assam", "19": "West Bengal", "20": "Jharkhand",
  "21": "Odisha", "22": "Chhattisgarh", "23": "Madhya Pradesh", "24": "Gujarat",
  "25": "Daman & Diu", "26": "Dadra & Nagar Haveli", "27": "Maharashtra",
  "28": "Andhra Pradesh", "29": "Karnataka", "30": "Goa",
  "31": "Lakshadweep", "32": "Kerala", "33": "Tamil Nadu", "34": "Puducherry",
  "35": "Andaman & Nicobar", "36": "Telangana", "37": "Andhra Pradesh (New)",
  "38": "Ladakh",
};

function getStateFromGstin(gstin: string): { code: string; name: string } | null {
  if (!gstin || gstin.length < 2) return null;
  const code = gstin.substring(0, 2);
  const name = STATE_CODES[code];
  return name ? { code, name } : null;
}

function getPlaceOfSupply(gstin: string): string {
  const state = getStateFromGstin(gstin);
  return state ? `${state.code}-${state.name}` : "";
}

function isIntraStateFromGstins(firmGstin: string, clientGstin: string): boolean {
  if (!firmGstin || !clientGstin || firmGstin.length < 2 || clientGstin.length < 2) return true;
  return firmGstin.substring(0, 2) === clientGstin.substring(0, 2);
}

// ─── Types ───
interface LineItem {
  id?: string;
  description: string;
  description_details: string;
  hsn_sac_code: string;
  quantity: number;
  rate: number;
  taxable_value: number;
  gst_percent: number;
  gst_amount: number;
  total: number;
  sort_order: number;
  showDetails: boolean;
}

interface ItemMaster {
  id: string;
  description: string;
  hsn_sac_code: string | null;
  default_rate: number | null;
}

interface Client {
  id: string;
  name: string | null;
  pan: string | null;
  gstin: string[] | null;
  entity_type: string | null;
}

interface Firm {
  id: string;
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
  taxable_value: 0, gst_percent: 18, gst_amount: 0,
  total: 0, sort_order: 0, showDetails: false,
});

// Amount in words helper (Indian numbering)
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

function getFY(): string {
  const now = new Date();
  const fyStart = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  return `${fyStart}-${String(fyStart + 1).slice(2)}`;
}

const fmtINR = (n: number) => "\u20B9" + n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ─── Item Master Dialog ───
function ItemMasterDialog({ open, onClose, firmId }: { open: boolean; onClose: () => void; firmId: string }) {
  const { toast } = useToast();
  const { user } = useAuth();
  const [items, setItems] = useState<ItemMaster[]>([]);
  const [desc, setDesc] = useState("");
  const [hsn, setHsn] = useState("");
  const [rate, setRate] = useState("");
  const [loading, setLoading] = useState(false);

  const fetchItems = useCallback(async () => {
    const { data } = await supabase.from("invoice_item_masters").select("id, description, hsn_sac_code, default_rate").eq("firm_id", firmId).eq("is_active", true).order("description");
    setItems((data as ItemMaster[]) || []);
  }, [firmId]);

  useEffect(() => { if (open) fetchItems(); }, [open, fetchItems]);

  const addItem = async () => {
    if (!desc.trim()) return;
    setLoading(true);
    const { error } = await supabase.from("invoice_item_masters").insert({
      firm_id: firmId, description: desc.trim(), hsn_sac_code: hsn.trim() || null,
      default_rate: rate ? Number(rate) : null, created_by: user?.id,
    });
    if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
    else { setDesc(""); setHsn(""); setRate(""); fetchItems(); }
    setLoading(false);
  };

  const deleteItem = async (id: string) => {
    await supabase.from("invoice_item_masters").update({ is_active: false }).eq("id", id);
    fetchItems();
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Item Description Master</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            <Input value={desc} onChange={e => setDesc(e.target.value)} placeholder="Description" />
            <Input value={hsn} onChange={e => setHsn(e.target.value)} placeholder="HSN/SAC" />
            <div className="flex gap-1">
              <Input value={rate} onChange={e => setRate(e.target.value)} placeholder="Rate" type="number" />
              <Button size="sm" onClick={addItem} disabled={loading}><Plus size={14} /></Button>
            </div>
          </div>
          <div className="max-h-60 overflow-y-auto space-y-1">
            {items.map(item => (
              <div key={item.id} className="flex items-center justify-between text-sm p-2 rounded bg-muted/50">
                <div>
                  <span className="font-medium">{item.description}</span>
                  {item.hsn_sac_code && <span className="text-muted-foreground ml-2">({item.hsn_sac_code})</span>}
                  {item.default_rate != null && <span className="text-muted-foreground ml-2">{fmtINR(item.default_rate)}</span>}
                </div>
                <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => deleteItem(item.id)}>
                  <Trash2 size={12} className="text-destructive" />
                </Button>
              </div>
            ))}
            {items.length === 0 && <p className="text-sm text-muted-foreground text-center py-4">No items yet. Add your first item above.</p>}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Component ───
const NewInvoice = () => {
  const navigate = useNavigate();
  const { invoiceId } = useParams<{ invoiceId?: string }>();
  const { user } = useAuth();
  const { toast } = useToast();
  const isSuperadmin = user?.role === "superadmin";
  const isEdit = !!invoiceId;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [clients, setClients] = useState<Client[]>([]);
  const [firmsList, setFirmsList] = useState<Firm[]>([]);
  const [selectedFirmId, setSelectedFirmId] = useState<string>("");
  const [firm, setFirm] = useState<Firm | null>(null);
  const [itemMasters, setItemMasters] = useState<ItemMaster[]>([]);
  const [masterDialogOpen, setMasterDialogOpen] = useState(false);

  // Invoice state
  const [clientId, setClientId] = useState("");
  const [invoiceNo, setInvoiceNo] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [referenceNo, setReferenceNo] = useState("");
  const [lineItems, setLineItems] = useState<LineItem[]>([EMPTY_ITEM()]);
  const [isIntraState, setIsIntraState] = useState(true);
  const [status, setStatus] = useState("draft");
  const [showLogo, setShowLogo] = useState(true);

  // Client fields
  const [toName, setToName] = useState("");
  const [toGstin, setToGstin] = useState("");
  const [toAddress, setToAddress] = useState("");

  // Finalize dialog
  const [finalizeOpen, setFinalizeOpen] = useState(false);

  // Derived values
  const firmGstin = firm?.gstin || "";
  const placeOfSupply = getPlaceOfSupply(firmGstin);
  const msmeNo = (firm?.settings as any)?.msme_no || "";

  // Auto-detect intra/inter state when client GSTIN changes
  useEffect(() => {
    if (firmGstin && toGstin) {
      setIsIntraState(isIntraStateFromGstins(firmGstin, toGstin));
    }
  }, [firmGstin, toGstin]);

  // Fetch firms list
  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("firms").select("id, name, display_name, logo_url, pan, gstin, phone, email, address, bank_details, primary_color, signature_url, state, settings").order("name");
      const firms = (data || []) as Firm[];
      setFirmsList(firms);
      if (user?.firm_id) setSelectedFirmId(user.firm_id);
      else if (firms.length > 0) setSelectedFirmId(firms[0].id);
    })();
  }, [user?.firm_id]);

  // When selected firm changes
  useEffect(() => {
    if (!selectedFirmId) return;
    const f = firmsList.find(f => f.id === selectedFirmId);
    if (f) setFirm(f);
  }, [selectedFirmId, firmsList]);

  // Fetch item masters
  useEffect(() => {
    if (!selectedFirmId) return;
    (async () => {
      const { data } = await supabase.from("invoice_item_masters").select("id, description, hsn_sac_code, default_rate").eq("firm_id", selectedFirmId).eq("is_active", true).order("description");
      setItemMasters((data as ItemMaster[]) || []);
    })();
  }, [selectedFirmId, masterDialogOpen]);

  // Fetch clients & generate invoice number
  useEffect(() => {
    (async () => {
      setLoading(true);
      let cq = supabase.from("clients").select("id, name, pan, gstin, entity_type").order("name");
      if (!isSuperadmin && user?.firm_id) cq = cq.eq("firm_id", user.firm_id);
      const { data: clientData } = await cq;
      setClients(clientData || []);

      // Auto invoice numbering: N/YYYY-YY
      if (!isEdit) {
        const fy = getFY();
        let invQ = supabase.from("invoices").select("invoice_no").ilike("invoice_no", `%/${fy}`).order("created_at", { ascending: false }).limit(50);
        if (!isSuperadmin && user?.firm_id) invQ = invQ.eq("firm_id", user.firm_id);
        const { data: existing } = await invQ;
        let maxNum = 0;
        (existing || []).forEach((inv: any) => {
          const match = inv.invoice_no?.match(/^(\d+)\//);
          if (match) maxNum = Math.max(maxNum, parseInt(match[1]));
        });
        setInvoiceNo(`${maxNum + 1}/${fy}`);
      }

      // Load existing invoice
      if (isEdit && invoiceId) {
        const { data: inv } = await supabase.from("invoices").select("*").eq("id", invoiceId).single();
        if (inv) {
          setClientId(inv.client_id || "");
          setInvoiceNo(inv.invoice_no || "");
          setInvoiceDate(inv.invoice_date || "");
          setReferenceNo((inv as any).reference_no || "");
          setStatus(inv.status || "draft");
          setShowLogo(inv.show_logo ?? true);
          setToName(inv.to_name || "");
          setToGstin(inv.to_gstin || "");
          setToAddress(inv.to_address || "");
          if (inv.firm_id) setSelectedFirmId(inv.firm_id);
          if (Array.isArray(inv.line_items) && inv.line_items.length > 0) {
            setLineItems(inv.line_items.map((li: any, i: number) => ({
              ...EMPTY_ITEM(),
              description: li.description || "",
              description_details: li.description_details || "",
              hsn_sac_code: li.hsn_sac_code || li.hsn || "",
              quantity: li.quantity || 1,
              rate: li.rate || 0,
              taxable_value: li.taxable_value || li.amount || 0,
              gst_percent: li.gst_percent ?? (li.cgst_percent ? li.cgst_percent * 2 : 18),
              gst_amount: li.gst_amount || ((li.cgst_amount || 0) + (li.sgst_amount || 0)),
              total: li.total || 0,
              sort_order: i,
              showDetails: false,
            })));
          }
        }
      }
      setLoading(false);
    })();
  }, [isSuperadmin, isEdit, invoiceId, user?.firm_id]);

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
  const recalcItem = useCallback((item: LineItem): LineItem => {
    const qty = Number(item.quantity) || 0;
    const rate = Number(item.rate) || 0;
    const taxable = Math.round(qty * rate * 100) / 100;
    const gstPct = Number(item.gst_percent) || 0;
    const gstAmt = Math.round(taxable * gstPct / 100 * 100) / 100;
    return { ...item, taxable_value: taxable, gst_amount: gstAmt, total: taxable + gstAmt };
  }, []);

  const updateLine = (idx: number, field: keyof LineItem, value: any) => {
    setLineItems(prev => {
      const next = [...prev];
      next[idx] = recalcItem({ ...next[idx], [field]: value });
      return next;
    });
  };

  const selectMasterItem = (idx: number, master: ItemMaster) => {
    setLineItems(prev => {
      const next = [...prev];
      const item = { ...next[idx], description: master.description, hsn_sac_code: master.hsn_sac_code || "", rate: master.default_rate || next[idx].rate };
      next[idx] = recalcItem(item);
      return next;
    });
  };

  const addLine = () => setLineItems(prev => [...prev, { ...EMPTY_ITEM(), sort_order: prev.length }]);
  const removeLine = (idx: number) => { if (lineItems.length > 1) setLineItems(prev => prev.filter((_, i) => i !== idx)); };
  const toggleDetails = (idx: number) => {
    setLineItems(prev => prev.map((li, i) => i === idx ? { ...li, showDetails: !li.showDetails } : li));
  };

  // Totals
  const items = useMemo(() => lineItems.filter(li => li.description.trim()), [lineItems]);
  const totalTaxable = useMemo(() => items.reduce((s, li) => s + li.taxable_value, 0), [items]);
  const totalGst = useMemo(() => items.reduce((s, li) => s + li.gst_amount, 0), [items]);
  const grandTotal = totalTaxable + totalGst;

  const firmName = firm?.display_name || firm?.name || "";
  const firmAddr = firm?.address as any;
  const firmAddressLines = firmAddr
    ? [firmAddr.line || firmAddr.line1, firmAddr.line2, [firmAddr.city, firmAddr.state || firm?.state, firmAddr.pincode].filter(Boolean).join(" \u2013 ")].filter(Boolean)
    : [];
  const firmFullAddress = firmAddressLines.join(", ");
  const bankDetails = firm?.bank_details as any;

  // Save
  const handleSave = async (newStatus?: string) => {
    if (!clientId) { toast({ title: "Select a client", variant: "destructive" }); return; }
    if (items.length === 0) { toast({ title: "Add at least one item", variant: "destructive" }); return; }
    setSaving(true);
    try {
      const effectiveStatus = newStatus || status;
      const halfGst = isIntraState ? totalGst / 2 : 0;
      const payload: any = {
        invoice_no: invoiceNo,
        client_id: clientId,
        firm_id: selectedFirmId || user?.firm_id,
        invoice_date: invoiceDate,
        reference_no: referenceNo || null,
        place_of_supply: placeOfSupply || null,
        invoice_format: "gst_tax_invoice",
        amount: totalTaxable,
        subtotal: totalTaxable,
        gst_amount: totalGst,
        total_cgst: isIntraState ? halfGst : 0,
        total_sgst: isIntraState ? halfGst : 0,
        total_igst: isIntraState ? 0 : totalGst,
        total_amount: grandTotal,
        is_intra_state: isIntraState,
        show_logo: showLogo,
        status: effectiveStatus,
        from_firm_name: firmName,
        from_address: firmFullAddress,
        from_gstin: firmGstin,
        from_pan: firm?.pan || "",
        from_phone: firm?.phone || "",
        from_email: firm?.email || "",
        to_name: toName,
        to_address: toAddress,
        to_gstin: toGstin,
        bank_details_snapshot: bankDetails,
        payment_terms: "PAYMENT IS DUE WITHIN 45 DAYS FROM THE INVOICE DATE",
        line_items: items.map(li => ({
          description: li.description,
          description_details: li.description_details,
          hsn_sac_code: li.hsn_sac_code,
          quantity: li.quantity,
          rate: li.rate,
          taxable_value: li.taxable_value,
          gst_percent: li.gst_percent,
          gst_amount: li.gst_amount,
          cgst_percent: isIntraState ? li.gst_percent / 2 : 0,
          cgst_amount: isIntraState ? li.gst_amount / 2 : 0,
          sgst_percent: isIntraState ? li.gst_percent / 2 : 0,
          sgst_amount: isIntraState ? li.gst_amount / 2 : 0,
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

  const handleDownloadPdf = async () => {
    const html = generateInvoiceHtml();
    const container = document.createElement("div");
    container.innerHTML = html;
    document.body.appendChild(container);
    try {
      const html2pdf = (await import("html2pdf.js")).default;
      await html2pdf().set({
        margin: [10, 10, 20, 10],
        filename: `Tax_Invoice_${invoiceNo?.replace(/\//g, "-") || "draft"}.pdf`,
        image: { type: "jpeg", quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true },
        jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
        pagebreak: { mode: ['avoid-all', 'css', 'legacy'] },
      }).from(container).save();
    } finally {
      document.body.removeChild(container);
    }
  };

  const isLocked = status === "finalized" || status === "sent" || status === "paid" || status === "voided";

  // Generate invoice HTML - professional A4 layout
  const generateInvoiceHtml = useCallback(() => {
    const validItems = lineItems.filter(li => li.description.trim());

    const gstLabel = isIntraState ? "CGST + SGST" : "IGST";

    const itemRows = validItems.map((item, i) => {
      const gstPct = item.gst_percent;
      return `
      <tr>
        <td style="border:1px solid #bbb;padding:6px 8px;text-align:center;vertical-align:middle;font-size:11px">${i + 1}.</td>
        <td style="border:1px solid #bbb;padding:6px 8px;vertical-align:middle;font-size:11px">
          ${item.description}
          ${item.description_details ? `<div style="font-size:10px;color:#555;margin-top:2px;white-space:pre-line">${item.description_details}</div>` : ""}
        </td>
        <td style="border:1px solid #bbb;padding:6px 8px;text-align:center;vertical-align:middle;font-size:11px">${item.hsn_sac_code}</td>
        <td style="border:1px solid #bbb;padding:6px 8px;text-align:right;vertical-align:middle;font-size:11px">${Number(item.quantity).toFixed(2)}</td>
        <td style="border:1px solid #bbb;padding:6px 8px;text-align:right;vertical-align:middle;font-size:11px">\u20B9${item.rate.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
        <td style="border:1px solid #bbb;padding:6px 8px;text-align:right;vertical-align:middle;font-size:11px">\u20B9${item.taxable_value.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
        <td style="border:1px solid #bbb;padding:6px 8px;text-align:center;vertical-align:middle;font-size:11px">${gstPct}%</td>
        <td style="border:1px solid #bbb;padding:6px 8px;text-align:right;vertical-align:middle;font-size:11px;font-weight:600">\u20B9${item.total.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
      </tr>`;
    }).join("");

    const totalRow = `
      <tr style="background:#f0f0f0;font-weight:700">
        <td style="border:1px solid #bbb;padding:8px" colspan="5">Total</td>
        <td style="border:1px solid #bbb;padding:8px;text-align:right;font-size:11px">\u20B9${totalTaxable.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
        <td style="border:1px solid #bbb;padding:8px"></td>
        <td style="border:1px solid #bbb;padding:8px;text-align:right;font-size:12px">\u20B9${grandTotal.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
      </tr>`;

    const halfGst = totalGst / 2;

    return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Tax Invoice ${invoiceNo}</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Segoe UI', Arial, sans-serif; color: #1a1a1a; font-size: 12px; }
        table { width: 100%; border-collapse: collapse; }
        @media print {
          @page { size: A4; margin: 20mm 15mm 20mm 15mm; }
          body { margin: 0; padding: 0; }
        }
        @media screen {
          body { padding: 20mm 15mm; max-width: 210mm; margin: 0 auto; }
        }
      </style></head><body>

      <!-- TAX INVOICE Header -->
      <div style="text-align:center;margin-bottom:16px">
        <h1 style="font-size:20px;font-weight:700;color:#1a56db;letter-spacing:1.5px;margin:0">TAX INVOICE</h1>
      </div>

      <!-- Firm Details + Invoice Details -->
      <div style="display:flex;justify-content:space-between;margin-bottom:14px">
        <!-- Left: Firm Name + Address + Place of Supply -->
        <div style="flex:1;max-width:55%">
          <p style="font-weight:800;font-size:14px;margin:0 0 4px">${firmName.toUpperCase()}</p>
          ${firmAddressLines.map(line => `<p style="margin:1px 0;font-size:11px;line-height:1.5">${line}</p>`).join("")}
          ${placeOfSupply ? `<p style="margin:6px 0 0;font-size:11px"><strong>Place of Supply:</strong> ${placeOfSupply}</p>` : ""}
        </div>
        <!-- Right: GSTIN, PAN, Invoice Date, Invoice No, MSME -->
        <div style="text-align:right;font-size:11px;min-width:280px">
          <div style="display:flex;justify-content:space-between;gap:20px">
            <div style="text-align:left">
              ${firmGstin ? `<p style="margin:2px 0"><strong>GSTIN:</strong> ${firmGstin}</p>` : ""}
              ${firm?.pan ? `<p style="margin:2px 0"><strong>PAN:</strong> ${firm.pan}</p>` : ""}
              ${msmeNo ? `<p style="margin:2px 0"><strong>MSME/Udyam No:</strong> ${msmeNo}</p>` : ""}
            </div>
            <div style="text-align:right">
              <p style="margin:2px 0"><strong>Invoice Date:</strong> ${invoiceDate ? format(new Date(invoiceDate), "dd/MM/yyyy") : "\u2014"}</p>
              <p style="margin:2px 0"><strong>Invoice No:</strong> ${invoiceNo}</p>
              ${referenceNo ? `<p style="margin:2px 0"><strong>Ref No:</strong> ${referenceNo}</p>` : ""}
            </div>
          </div>
        </div>
      </div>

      <!-- Customer details -->
      <div style="border:1px solid #bbb;margin-bottom:12px;padding:10px">
        <p style="font-size:10px;font-weight:700;color:#666;text-transform:uppercase;margin:0 0 4px">Bill To</p>
        <p style="font-weight:600;margin:0;font-size:13px">${toName}</p>
        ${toAddress ? `<p style="margin:2px 0;font-size:11px">${toAddress}</p>` : ""}
        ${toGstin ? `<p style="margin:4px 0;font-size:11px"><strong>GSTIN:</strong> ${toGstin}</p>` : ""}
        <p style="margin:2px 0;font-size:11px"><strong>Tax Type:</strong> ${isIntraState ? "Intra-State (CGST + SGST)" : "Inter-State (IGST)"}</p>
      </div>

      <!-- Items Table -->
      <table>
        <thead>
          <tr style="background:#e2e8f0">
            <th style="border:1px solid #bbb;padding:7px;font-size:10px;width:30px">#</th>
            <th style="border:1px solid #bbb;padding:7px;font-size:10px;text-align:left">Item</th>
            <th style="border:1px solid #bbb;padding:7px;font-size:10px">HSN/SAC</th>
            <th style="border:1px solid #bbb;padding:7px;font-size:10px">Quantity</th>
            <th style="border:1px solid #bbb;padding:7px;font-size:10px">Rate / Item</th>
            <th style="border:1px solid #bbb;padding:7px;font-size:10px">Taxable Value</th>
            <th style="border:1px solid #bbb;padding:7px;font-size:10px">GST %</th>
            <th style="border:1px solid #bbb;padding:7px;font-size:10px">Total</th>
          </tr>
        </thead>
        <tbody>
          ${itemRows}
          ${totalRow}
        </tbody>
      </table>

      <!-- Totals summary -->
      <div style="display:flex;justify-content:flex-end;margin-top:10px">
        <table style="width:320px;font-size:12px">
          <tr><td style="padding:3px 8px">Taxable Amount</td><td style="padding:3px 8px;text-align:right;font-weight:600">\u20B9${totalTaxable.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td></tr>
          ${isIntraState ? `
            <tr><td style="padding:3px 8px">CGST</td><td style="padding:3px 8px;text-align:right">\u20B9${halfGst.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td></tr>
            <tr><td style="padding:3px 8px">SGST</td><td style="padding:3px 8px;text-align:right">\u20B9${halfGst.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td></tr>
          ` : `
            <tr><td style="padding:3px 8px">IGST</td><td style="padding:3px 8px;text-align:right">\u20B9${totalGst.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td></tr>
          `}
          <tr style="font-weight:700;font-size:13px;border-top:2px solid #333"><td style="padding:6px 8px">Grand Total</td><td style="padding:6px 8px;text-align:right">\u20B9${grandTotal.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td></tr>
        </table>
      </div>

      <!-- Amount in words -->
      <div style="margin:8px 0;padding:6px 8px;background:#f9f9f9;border:1px solid #ddd;font-size:11px">
        <strong>Amount in words:</strong> ${numberToWords(Math.round(grandTotal))}
      </div>

      <!-- Bank Details + Signatory -->
      <div style="display:flex;justify-content:space-between;margin-top:16px">
        <div style="border:1px solid #bbb;padding:10px;font-size:11px;min-width:300px">
          <p style="font-weight:700;margin:0 0 4px;font-size:12px">Bank Details:</p>
          ${bankDetails?.account_number || bankDetails?.account_no ? `<p style="margin:2px 0"><strong>Account No:</strong> ${bankDetails.account_number || bankDetails.account_no}</p>` : ""}
          ${bankDetails?.ifsc ? `<p style="margin:2px 0"><strong>IFSC:</strong> ${bankDetails.ifsc}</p>` : ""}
          ${bankDetails?.bank_name ? `<p style="margin:2px 0"><strong>Bank:</strong> ${bankDetails.bank_name}</p>` : ""}
          ${bankDetails?.branch ? `<p style="margin:2px 0"><strong>Branch:</strong> ${bankDetails.branch}</p>` : ""}
        </div>
        <div style="text-align:right;padding-top:8px">
          <p style="margin:0;font-size:12px;font-weight:600">For ${firmName.toUpperCase()}</p>
          <div style="height:50px"></div>
          <p style="margin:0;font-size:11px;border-top:1px solid #333;padding-top:4px">Authorised Signatory</p>
        </div>
      </div>

      <!-- Terms -->
      <div style="margin-top:16px;padding-top:8px;padding-bottom:10px;border-top:1px solid #ddd;font-size:10px;color:#555">
        <p style="font-weight:700;margin:0 0 4px">Terms & Conditions:</p>
        <p style="margin:0;font-weight:700;letter-spacing:0.5px">PAYMENT TERMS: PAYMENT IS DUE WITHIN 45 DAYS FROM THE INVOICE DATE</p>
      </div>

    </body></html>`;
  }, [lineItems, invoiceNo, invoiceDate, referenceNo, placeOfSupply, isIntraState,
    firm, firmName, firmAddressLines, firmFullAddress, firmGstin, bankDetails, msmeNo, showLogo,
    toName, toGstin, toAddress, totalTaxable, totalGst, grandTotal]);

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
          {/* Firm Selection */}
          <div>
            <Label className="text-xs font-semibold text-muted-foreground uppercase mb-2 block">Billing From</Label>
            <Select value={selectedFirmId} onValueChange={setSelectedFirmId} disabled={isLocked}>
              <SelectTrigger><SelectValue placeholder="Select firm" /></SelectTrigger>
              <SelectContent>
                {firmsList.map(f => (
                  <SelectItem key={f.id} value={f.id}>{f.display_name || f.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {firm && (
              <div className="text-sm space-y-1 text-muted-foreground bg-muted/30 p-3 rounded-md mt-2">
                <p className="font-medium text-foreground">{firmName}</p>
                {firmAddressLines.map((line, i) => <p key={i}>{line}</p>)}
                {placeOfSupply && <p className="text-xs">Place of Supply: {placeOfSupply}</p>}
              </div>
            )}
            <div className="flex items-center gap-2 mt-2">
              <Switch checked={showLogo} onCheckedChange={setShowLogo} disabled={isLocked} />
              <Label className="text-xs">Show Logo</Label>
            </div>
          </div>

          <Separator />

          {/* Client */}
          <div>
            <Label className="text-xs font-semibold text-muted-foreground uppercase mb-2 block">Bill To (Client)</Label>
            <Select value={clientId} onValueChange={setClientId} disabled={isLocked}>
              <SelectTrigger><SelectValue placeholder="Select client" /></SelectTrigger>
              <SelectContent>{clients.map(c => <SelectItem key={c.id} value={c.id}>{c.name} ({c.pan})</SelectItem>)}</SelectContent>
            </Select>
            {clientId && (
              <div className="grid grid-cols-2 gap-2 mt-2">
                <Input value={toName} onChange={e => setToName(e.target.value)} placeholder="Customer Name" disabled={isLocked} />
                <Input value={toGstin} onChange={e => setToGstin(e.target.value)} placeholder="GSTIN" disabled={isLocked} />
                <Input value={toAddress} onChange={e => setToAddress(e.target.value)} placeholder="Address" disabled={isLocked} className="col-span-2" />
              </div>
            )}
            {clientId && toGstin && (
              <div className="mt-2 text-xs text-muted-foreground">
                Tax Type: <strong>{isIntraState ? "Intra-State (CGST + SGST)" : "Inter-State (IGST)"}</strong>
                <span className="ml-1">(auto-detected from GSTINs)</span>
              </div>
            )}
          </div>

          <Separator />

          {/* Invoice Details */}
          <div>
            <Label className="text-xs font-semibold text-muted-foreground uppercase mb-2 block">Invoice Details</Label>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Invoice No</Label>
                <Input value={invoiceNo} readOnly className="bg-muted font-mono" />
              </div>
              <div>
                <Label className="text-xs">Invoice Date</Label>
                <Input type="date" value={invoiceDate} onChange={e => setInvoiceDate(e.target.value)} disabled={isLocked} />
              </div>
              <div>
                <Label className="text-xs">Reference No</Label>
                <Input value={referenceNo} onChange={e => setReferenceNo(e.target.value)} placeholder="Optional" disabled={isLocked} />
              </div>
              <div>
                <Label className="text-xs">Place of Supply</Label>
                <Input value={placeOfSupply} readOnly className="bg-muted text-xs" />
              </div>
            </div>
          </div>

          <Separator />

          {/* Line Items */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <Label className="text-xs font-semibold text-muted-foreground uppercase">Line Items</Label>
              <div className="flex gap-1">
                <Button variant="outline" size="sm" className="text-xs h-7 gap-1" onClick={() => setMasterDialogOpen(true)}>
                  <Settings2 size={12} /> Item Master
                </Button>
                {!isLocked && <Button variant="outline" size="sm" className="text-xs h-7 gap-1" onClick={addLine}><Plus size={12} /> Add Row</Button>}
              </div>
            </div>
            <div className="space-y-3">
              {lineItems.map((item, idx) => (
                <div key={idx} className="border border-border rounded-md p-3 space-y-2">
                  <div className="flex gap-2">
                    {/* Item description - with master dropdown */}
                    <div className="flex-1">
                      <Popover>
                        <PopoverTrigger asChild>
                          <div className="relative">
                            <Input
                              value={item.description}
                              onChange={e => updateLine(idx, "description", e.target.value)}
                              placeholder="Select or type item..."
                              className="text-sm pr-8"
                              disabled={isLocked}
                            />
                            {itemMasters.length > 0 && (
                              <ChevronsUpDown size={14} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                            )}
                          </div>
                        </PopoverTrigger>
                        {itemMasters.length > 0 && (
                          <PopoverContent className="w-[300px] p-0" align="start">
                            <Command>
                              <CommandInput placeholder="Search items..." />
                              <CommandList>
                                <CommandEmpty>No items found.</CommandEmpty>
                                <CommandGroup>
                                  {itemMasters.map(m => (
                                    <CommandItem key={m.id} onSelect={() => selectMasterItem(idx, m)}>
                                      <div className="flex-1">
                                        <span>{m.description}</span>
                                        {m.hsn_sac_code && <span className="text-muted-foreground ml-2 text-xs">({m.hsn_sac_code})</span>}
                                      </div>
                                      {m.default_rate != null && <span className="text-xs text-muted-foreground">{fmtINR(m.default_rate)}</span>}
                                    </CommandItem>
                                  ))}
                                </CommandGroup>
                              </CommandList>
                            </Command>
                          </PopoverContent>
                        )}
                      </Popover>
                    </div>
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
                  <div className="grid grid-cols-5 gap-1">
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
                      <Label className="text-[10px]">GST %</Label>
                      <Input type="number" value={item.gst_percent || ""} onChange={e => updateLine(idx, "gst_percent", Number(e.target.value))} className="text-xs h-8" disabled={isLocked} />
                    </div>
                    <div>
                      <Label className="text-[10px]">Total</Label>
                      <div className="text-xs font-semibold pt-2 text-right">{fmtINR(item.total)}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <Separator />

          {/* Totals */}
          <div className="text-sm space-y-1 text-right">
            <p>Taxable Amount: <strong>{fmtINR(totalTaxable)}</strong></p>
            {isIntraState ? (
              <>
                <p>CGST: <strong>{fmtINR(totalGst / 2)}</strong></p>
                <p>SGST: <strong>{fmtINR(totalGst / 2)}</strong></p>
              </>
            ) : (
              <p>IGST: <strong>{fmtINR(totalGst)}</strong></p>
            )}
            <p className="text-lg font-bold text-foreground">Grand Total: {fmtINR(grandTotal)}</p>
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

      {/* Item Master Dialog */}
      <ItemMasterDialog open={masterDialogOpen} onClose={() => setMasterDialogOpen(false)} firmId={selectedFirmId} />
    </div>
  );
};

export default NewInvoice;
