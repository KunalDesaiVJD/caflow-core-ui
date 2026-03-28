import { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { format, addDays } from "date-fns";
import { cn } from "@/lib/utils";
import {
  ArrowLeft, Plus, Trash2, Save, Lock, Download,
  FileText, Info, Check, ChevronsUpDown, ChevronDown, Copy, RefreshCw, Pencil, AlertTriangle,
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
type DocumentType = "invoice" | "quotation" | "proforma" | "credit_note";

const DOC_TYPE_LABELS: Record<DocumentType, string> = {
  invoice: "Tax Invoice",
  quotation: "Quotation",
  proforma: "Proforma Invoice",
  credit_note: "Credit Note",
};

const DOC_TYPE_HEADINGS: Record<DocumentType, string> = {
  invoice: "TAX INVOICE",
  quotation: "QUOTATION",
  proforma: "PROFORMA INVOICE",
  credit_note: "CREDIT NOTE",
};

function getDocSeries(docType: DocumentType): string {
  if (docType === "invoice") return "inv";
  if (docType === "credit_note") return "cn";
  return "pi"; // quotation and proforma share PI series
}

function formatDocNumber(seqNumber: number, series: string, fy: string): string {
  if (series === "inv") return `${seqNumber}/${fy}`;
  if (series === "cn") return `${seqNumber}/CN/${fy}`;
  return `${seqNumber}/PI/${fy}`;
}

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
  address: string | null;
  registered_office: string | null;
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

function getFYFromDate(dateStr: string): string {
  const d = new Date(dateStr);
  const fyStart = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
  return `${fyStart}-${String(fyStart + 1).slice(2)}`;
}

function getPreviousFY(fy: string): string {
  const parts = fy.split("-");
  const startYear = parseInt(parts[0]);
  return `${startYear - 1}-${String(startYear).slice(2)}`;
}

const fmtINR = (n: number) => "\u20B9" + n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function balanceAddressLines(lines: string[]): string[] {
  if (lines.length < 2) return lines;
  const firstTwo = lines.slice(0, -1);
  const lastLine = lines[lines.length - 1];
  if (firstTwo.length === 1) {
    const words = firstTwo[0].split(/\s+/);
    if (words.length > 6) {
      const mid = Math.ceil(words.length / 2);
      return [words.slice(0, mid).join(" "), words.slice(mid).join(" "), lastLine];
    }
  }
  return lines;
}

// ─── Main Component ───
const NewInvoice = () => {
  const navigate = useNavigate();
  const { invoiceId } = useParams<{ invoiceId?: string }>();
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const { toast } = useToast();
  const isSuperadmin = user?.role === "superadmin";
  const isEdit = !!invoiceId;

  // Document type from query param or default
  const initialDocType = (searchParams.get("type") as DocumentType) || "invoice";

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [clients, setClients] = useState<Client[]>([]);
  const [firmsList, setFirmsList] = useState<Firm[]>([]);
  const [selectedFirmId, setSelectedFirmId] = useState<string>("");
  const [firm, setFirm] = useState<Firm | null>(null);
  const [itemMasters, setItemMasters] = useState<ItemMaster[]>([]);

  // Document type
  const [docType, setDocType] = useState<DocumentType>(initialDocType);

  // Invoice state
  const [clientId, setClientId] = useState("");
  const [invoiceNo, setInvoiceNo] = useState("");
  const [seqNumber, setSeqNumber] = useState<number | null>(null);
  const [invoiceDate, setInvoiceDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [referenceNo, setReferenceNo] = useState("");
  const [lineItems, setLineItems] = useState<LineItem[]>([EMPTY_ITEM()]);
  const [isIntraState, setIsIntraState] = useState(true);
  const [status, setStatus] = useState("draft");
  const [showLogo, setShowLogo] = useState(true);
  const [remarksConditions, setRemarksConditions] = useState("");
  const [baseTurnover, setBaseTurnover] = useState("");
  const [sourceDocumentId, setSourceDocumentId] = useState("");

  // Editable doc number
  const [docNoEditable, setDocNoEditable] = useState(false);
  const [docNoManual, setDocNoManual] = useState(false);
  const [duplicateWarning, setDuplicateWarning] = useState("");

  // Client fields
  const [toName, setToName] = useState("");
  const [toGstin, setToGstin] = useState("");
  const [toAddress, setToAddress] = useState("");

  // Credit note specific
  const [clientInvoices, setClientInvoices] = useState<any[]>([]);

  // Last year reference
  const [lastYearInvoice, setLastYearInvoice] = useState<any>(null);
  const [lastYearOpen, setLastYearOpen] = useState(false);

  // Audit client check
  const [isAuditClient, setIsAuditClient] = useState(false);

  // Date error dialog
  const [dateErrorOpen, setDateErrorOpen] = useState(false);
  const [dateErrorMsg, setDateErrorMsg] = useState("");

  // Finalize dialog
  const [finalizeOpen, setFinalizeOpen] = useState(false);

  // Firm-specific
  const [firmError, setFirmError] = useState(false);

  // Derived values
  const firmGstin = firm?.gstin || "";
  const placeOfSupply = getPlaceOfSupply(firmGstin);
  const msmeNo = (firm?.settings as any)?.msme_no || "";
  const billingEmail = (firm?.settings as any)?.billing_email || firm?.email || "";
  const billingContact = (firm?.settings as any)?.billing_contact_no || firm?.phone || "";
  const firmHasGst = !!firmGstin;
  const currentFY = getFYFromDate(invoiceDate);

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

  useEffect(() => {
    if (!selectedFirmId) return;
    const f = firmsList.find(f => f.id === selectedFirmId);
    if (f) setFirm(f);
    setFirmError(false);
  }, [selectedFirmId, firmsList]);

  // Fetch item masters
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("invoice_item_masters")
        .select("id, description, hsn_sac_code, default_rate")
        .eq("is_active", true)
        .order("description");
      setItemMasters((data as ItemMaster[]) || []);
    })();
  }, []);

  // Fetch clients
  useEffect(() => {
    (async () => {
      let cq = supabase.from("clients").select("id, name, pan, gstin, entity_type, address, registered_office").eq("is_draft", false).is("deleted_at", null).order("name");
      if (!isSuperadmin && user?.firm_id) cq = cq.eq("firm_id", user.firm_id);
      const { data: clientData } = await cq;
      setClients(clientData || []);
    })();
  }, [isSuperadmin, user?.firm_id]);

  // Generate document number via get_next_invoice_seq
  const generateDocNumber = useCallback(async () => {
    if (!selectedFirmId || isEdit) return;
    const series = getDocSeries(docType);
    const fy = getFYFromDate(invoiceDate);

    try {
      const { data, error } = await supabase.rpc("get_next_invoice_seq", {
        p_firm_id: selectedFirmId,
        p_series: series,
        p_financial_year: fy,
        p_invoice_date: invoiceDate,
      });

      if (error) {
        if (error.message.includes("BACKDATING_ERROR")) {
          const match = error.message.match(/dated (\S+) because a document dated (\S+)/);
          const enteredDate = match?.[1] || invoiceDate;
          const lastDate = match?.[2] || "a later date";
          setDateErrorMsg(`You cannot create a document dated ${enteredDate} in this series because a document dated ${lastDate} already exists.\n\nPlease change the document date to ${lastDate} or later.`);
          setDateErrorOpen(true);
          setInvoiceNo("");
          setSeqNumber(null);
          return;
        }
        throw error;
      }

      setSeqNumber(data);
      setInvoiceNo(formatDocNumber(data, series, fy));
    } catch (e: any) {
      console.error("Error generating doc number:", e);
    }
  }, [selectedFirmId, docType, invoiceDate, isEdit]);

  useEffect(() => { generateDocNumber(); }, [generateDocNumber]);

  // Load existing invoice in edit mode
  useEffect(() => {
    if (!isEdit || !invoiceId) { setLoading(false); return; }
    (async () => {
      setLoading(true);
      const { data: inv } = await supabase.from("invoices").select("*").eq("id", invoiceId).single();
      if (inv) {
        setDocType((inv as any).document_type || "invoice");
        setClientId(inv.client_id || "");
        setInvoiceNo(inv.invoice_no || "");
        setSeqNumber((inv as any).seq_number || null);
        setInvoiceDate(inv.invoice_date || "");
        setReferenceNo((inv as any).reference_no || "");
        setStatus(inv.status || "draft");
        setShowLogo(inv.show_logo ?? true);
        setToName(inv.to_name || "");
        setToGstin(inv.to_gstin || "");
        setToAddress(inv.to_address || "");
        setRemarksConditions((inv as any).remarks_conditions || "");
        setBaseTurnover((inv as any).base_turnover ? String((inv as any).base_turnover) : "");
        setSourceDocumentId((inv as any).source_document_id || "");
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
      setLoading(false);
    })();
  }, [isEdit, invoiceId]);

  // Auto-fill client details & check audit classification
  useEffect(() => {
    if (!clientId) { setIsAuditClient(false); return; }
    const client = clients.find(c => c.id === clientId);
    if (client) {
      setToName(client.name || "");
      setToGstin(client.gstin?.[0] || "");
      // Auto-fetch address from client management
      const addrParts = [client.address, client.registered_office].filter(Boolean);
      if (addrParts.length > 0) {
        setToAddress(addrParts.join(", "));
      }
    }
    // Check audit classification
    (async () => {
      const fy = getFYFromDate(invoiceDate);
      const { data } = await supabase.from("client_fy_classifications")
        .select("classification")
        .eq("client_id", clientId)
        .eq("financial_year", fy)
        .maybeSingle();
      setIsAuditClient(data?.classification === "Audit");
    })();
  }, [clientId, clients, invoiceDate]);

  // Fetch client invoices for Credit Note "Against Invoice" dropdown
  useEffect(() => {
    if (docType !== "credit_note" || !clientId || !selectedFirmId) { setClientInvoices([]); return; }
    (async () => {
      try {
        const { data, error } = await supabase.from("invoices")
          .select("id, invoice_no, invoice_date, total_amount")
          .eq("client_id", clientId)
          .eq("firm_id", selectedFirmId)
          .eq("document_type", "invoice")
          .in("status", ["finalized", "sent", "paid"])
          .order("invoice_date", { ascending: false });
        if (error) { console.error("Error fetching client invoices:", error); }
        setClientInvoices(data || []);
      } catch (e) {
        console.error("Error fetching client invoices:", e);
        setClientInvoices([]);
      }
    })();
  }, [docType, clientId, selectedFirmId]);

  // Fetch last year invoice
  useEffect(() => {
    if (!clientId || !selectedFirmId) { setLastYearInvoice(null); return; }
    (async () => {
      const prevFy = getPreviousFY(currentFY);
      const { data } = await supabase.from("invoices")
        .select("id, invoice_no, invoice_date, line_items, remarks_conditions, total_amount")
        .eq("client_id", clientId)
        .eq("firm_id", selectedFirmId)
        .eq("document_type", "invoice")
        .eq("financial_year", prevFy)
        .order("seq_number", { ascending: false })
        .limit(1)
        .maybeSingle();
      setLastYearInvoice(data);
    })();
  }, [clientId, selectedFirmId, currentFY]);

  // Recalculate line item
  const recalcItem = useCallback((item: LineItem): LineItem => {
    const qty = Number(item.quantity) || 0;
    const rate = Number(item.rate) || 0;
    const taxable = Math.round(qty * rate * 100) / 100;
    const gstPct = firmHasGst ? (Number(item.gst_percent) || 0) : 0;
    const gstAmt = Math.round(taxable * gstPct / 100 * 100) / 100;
    return { ...item, taxable_value: taxable, gst_amount: gstAmt, total: taxable + gstAmt };
  }, [firmHasGst]);

  const updateLine = (idx: number, field: keyof LineItem, value: any) => {
    setLineItems(prev => {
      const next = [...prev];
      next[idx] = recalcItem({ ...next[idx], [field]: value });
      return next;
    });
  };

  const [openItemPopover, setOpenItemPopover] = useState<number | null>(null);

  const selectMasterItem = (idx: number, master: ItemMaster) => {
    setLineItems(prev => {
      const next = [...prev];
      const item = { ...next[idx], description: master.description, hsn_sac_code: master.hsn_sac_code || "", rate: master.default_rate || next[idx].rate };
      next[idx] = recalcItem(item);
      return next;
    });
    setOpenItemPopover(null);
  };

  const addLine = () => setLineItems(prev => [...prev, { ...EMPTY_ITEM(), sort_order: prev.length }]);
  const removeLine = (idx: number) => { if (lineItems.length > 1) setLineItems(prev => prev.filter((_, i) => i !== idx)); };
  const toggleDetails = (idx: number) => {
    setLineItems(prev => prev.map((li, i) => i === idx ? { ...li, showDetails: !li.showDetails } : li));
  };

  // Copy from last year
  const copyFromLastYear = () => {
    if (!lastYearInvoice?.line_items) return;
    const items = (lastYearInvoice.line_items as any[]).map((li: any, i: number) =>
      recalcItem({
        ...EMPTY_ITEM(),
        description: li.description || "",
        description_details: li.description_details || "",
        hsn_sac_code: li.hsn_sac_code || li.hsn || "",
        quantity: li.quantity || 1,
        rate: li.rate || 0,
        gst_percent: li.gst_percent ?? 18,
        sort_order: i,
        showDetails: false,
      } as any)
    );
    setLineItems(items.length > 0 ? items : [EMPTY_ITEM()]);
    if (lastYearInvoice.remarks_conditions) setRemarksConditions(lastYearInvoice.remarks_conditions);
    toast({ title: "Line items copied from last year. Please review and update amounts." });
  };

  // Load from client package (for quotations)
  const loadFromPackage = async () => {
    if (!clientId) return;
    const { data: packages } = await supabase.from("client_service_packages")
      .select("package_name, service_category_ids, billing_amount")
      .eq("client_id", clientId)
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();
    if (!packages) { toast({ title: "No package found for this client" }); return; }
    const serviceIds = (packages.service_category_ids as string[]) || [];
    if (serviceIds.length === 0) return;
    const { data: services } = await supabase.from("service_categories")
      .select("id, name, default_fee")
      .in("id", serviceIds);
    if (!services || services.length === 0) return;
    const items = services.map((s: any, i: number) => recalcItem({
      ...EMPTY_ITEM(),
      description: s.name,
      rate: s.default_fee || 0,
      sort_order: i,
    }));
    setLineItems(items);
    toast({ title: "Line items loaded from client package" });
  };

  // Totals
  const items = useMemo(() => lineItems.filter(li => li.description.trim()), [lineItems]);
  const totalTaxable = useMemo(() => items.reduce((s, li) => s + li.taxable_value, 0), [items]);
  const totalGst = useMemo(() => firmHasGst ? items.reduce((s, li) => s + li.gst_amount, 0) : 0, [items, firmHasGst]);
  const grandTotal = totalTaxable + totalGst;

  const firmName = firm?.display_name || firm?.name || "";
  const firmAddr = firm?.address as any;
  const firmAddressLines = useMemo(() => {
    if (!firmAddr) return [];
    const rawLines = [firmAddr.line || firmAddr.line1, firmAddr.line2, [firmAddr.city, firmAddr.pincode].filter(Boolean).join(" \u2013 ")].filter(Boolean);
    return balanceAddressLines(rawLines);
  }, [firmAddr]);
  const firmFullAddress = firmAddressLines.join(", ");
  const bankDetails = firm?.bank_details as any;

  // Save
  const handleSave = async (newStatus?: string) => {
    if (!selectedFirmId) { setFirmError(true); toast({ title: "Please select a firm", variant: "destructive" }); return; }
    if (!clientId) { toast({ title: "Select a client", variant: "destructive" }); return; }
    if (items.length === 0) { toast({ title: "Add at least one item", variant: "destructive" }); return; }
    setSaving(true);
    try {
      const effectiveStatus = newStatus || status;
      const halfGst = isIntraState ? totalGst / 2 : 0;
      const series = getDocSeries(docType);
      const fy = getFYFromDate(invoiceDate);

      const payload: any = {
        invoice_no: invoiceNo,
        client_id: clientId,
        firm_id: selectedFirmId,
        invoice_date: invoiceDate,
        reference_no: referenceNo || null,
        place_of_supply: placeOfSupply || null,
        invoice_format: "gst_tax_invoice",
        amount: totalTaxable,
        subtotal: totalTaxable,
        gst_amount: totalGst,
        total_cgst: firmHasGst && isIntraState ? halfGst : 0,
        total_sgst: firmHasGst && isIntraState ? halfGst : 0,
        total_igst: firmHasGst && !isIntraState ? totalGst : 0,
        total_amount: grandTotal,
        is_intra_state: isIntraState,
        show_logo: showLogo,
        status: effectiveStatus,
        document_type: docType,
        document_series: series,
        seq_number: seqNumber,
        financial_year: fy,
        remarks_conditions: remarksConditions || null,
        base_turnover: baseTurnover ? Number(baseTurnover) : null,
        source_document_id: sourceDocumentId || null,
        from_firm_name: firmName,
        from_address: firmFullAddress,
        from_gstin: firmGstin,
        from_pan: firm?.pan || "",
        from_phone: billingContact,
        from_email: billingEmail,
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
          gst_percent: firmHasGst ? li.gst_percent : 0,
          gst_amount: firmHasGst ? li.gst_amount : 0,
          cgst_percent: firmHasGst && isIntraState ? li.gst_percent / 2 : 0,
          cgst_amount: firmHasGst && isIntraState ? li.gst_amount / 2 : 0,
          sgst_percent: firmHasGst && isIntraState ? li.gst_percent / 2 : 0,
          sgst_amount: firmHasGst && isIntraState ? li.gst_amount / 2 : 0,
          total: li.total,
        })),
        signatory_name: firmName,
        created_by: user?.id,
      };

      let savedId = invoiceId;
      if (isEdit && invoiceId) {
        const { error } = await supabase.from("invoices").update(payload).eq("id", invoiceId);
        if (error) throw error;
        toast({ title: effectiveStatus === "finalized" ? "Document finalized" : "Document updated" });
      } else {
        const { data: inserted, error } = await supabase.from("invoices").insert(payload).select("id").single();
        if (error) throw error;
        savedId = inserted?.id;
        toast({ title: `${DOC_TYPE_LABELS[docType]} created` });
      }

      // Auto-insert ledger entry when finalizing
      if (effectiveStatus === "finalized" && savedId && clientId && selectedFirmId) {
        const entryType = docType === "credit_note" ? "credit_note" : "invoice";
        const isCredit = docType === "credit_note";
        await supabase.from("client_ledger_entries").insert({
          firm_id: selectedFirmId,
          client_id: clientId,
          entry_date: invoiceDate,
          entry_type: entryType,
          document_id: savedId,
          debit_amount: isCredit ? 0 : grandTotal,
          credit_amount: isCredit ? grandTotal : 0,
          narration: `${isCredit ? "Credit Note" : "Invoice"} ${invoiceNo}`,
          financial_year: fy,
        });
      }

      setStatus(effectiveStatus);
      if (!isEdit) navigate("/billing");
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
    setSaving(false);
  };

  const handleFinalize = () => { setFinalizeOpen(false); handleSave("finalized"); };

  // Convert to Invoice
  const handleConvertToInvoice = async () => {
    if (!invoiceId) return;
    // Navigate to new invoice with source document
    navigate(`/billing/new?type=invoice&source=${invoiceId}`);
  };

  // Handle source document (conversion from quotation/proforma)
  useEffect(() => {
    const sourceId = searchParams.get("source");
    if (!sourceId || isEdit) return;
    (async () => {
      const { data: source } = await supabase.from("invoices").select("*").eq("id", sourceId).single();
      if (!source) return;
      setSourceDocumentId(sourceId);
      setClientId(source.client_id || "");
      if (source.firm_id) setSelectedFirmId(source.firm_id);
      setToName(source.to_name || "");
      setToGstin(source.to_gstin || "");
      setToAddress(source.to_address || "");
      setRemarksConditions((source as any).remarks_conditions || "");
      setBaseTurnover((source as any).base_turnover ? String((source as any).base_turnover) : "");
      if (Array.isArray(source.line_items) && source.line_items.length > 0) {
        setLineItems(source.line_items.map((li: any, i: number) => ({
          ...EMPTY_ITEM(),
          description: li.description || "",
          description_details: li.description_details || "",
          hsn_sac_code: li.hsn_sac_code || "",
          quantity: li.quantity || 1,
          rate: li.rate || 0,
          taxable_value: li.taxable_value || 0,
          gst_percent: li.gst_percent ?? 18,
          gst_amount: li.gst_amount || 0,
          total: li.total || 0,
          sort_order: i,
          showDetails: false,
        })));
      }
      // Mark source as converted after saving the new invoice
    })();
  }, [searchParams, isEdit]);

  // After saving a converted invoice, update the source document
  useEffect(() => {
    if (!isEdit || !sourceDocumentId) return;
    // This runs on edit load - we handle conversion marking in save
  }, [isEdit, sourceDocumentId]);

  const handleDownloadPdf = async () => {
    const html = generateInvoiceHtml();
    const container = document.createElement("div");
    container.innerHTML = html;
    document.body.appendChild(container);
    try {
      const html2pdf = (await import("html2pdf.js")).default;
      await html2pdf().set({
        margin: [10, 10, 20, 10],
        filename: `${DOC_TYPE_LABELS[docType].replace(/ /g, "_")}_${invoiceNo?.replace(/\//g, "-") || "draft"}.pdf`,
        image: { type: "jpeg", quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true },
        jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
        pagebreak: { mode: ['avoid-all', 'css', 'legacy'] },
      }).from(container).save();
    } finally {
      document.body.removeChild(container);
    }
  };

  const isLocked = status === "finalized" || status === "sent" || status === "paid" || status === "voided" || status === "converted";
  const canConvert = isEdit && (docType === "quotation" || docType === "proforma") && status === "finalized";

  // Generate invoice HTML
  const generateInvoiceHtml = useCallback(() => {
    const validItems = lineItems.filter(li => li.description.trim());
    const heading = DOC_TYPE_HEADINGS[docType];

    const thGst = firmHasGst ? `<th style="border:1px solid #bbb;padding:7px;font-size:10px;vertical-align:middle">GST %</th>` : "";

    const itemRows = validItems.map((item, i) => {
      const gstCol = firmHasGst
        ? `<td style="border:1px solid #bbb;padding:6px 8px;text-align:center;vertical-align:middle;font-size:11px">${item.gst_percent}%</td>`
        : "";
      const itemTotal = firmHasGst ? item.total : item.taxable_value;
      return `
      <tr>
        <td style="border:1px solid #bbb;padding:6px 8px;text-align:center;vertical-align:middle;font-size:11px">${i + 1}.</td>
        <td style="border:1px solid #bbb;padding:6px 8px;vertical-align:middle;font-size:11px">
          ${item.description}
          ${item.description_details ? `<div style="font-size:10px;color:#555;margin-top:2px;white-space:pre-line">${item.description_details}</div>` : ""}
        </td>
        <td style="border:1px solid #bbb;padding:6px 8px;text-align:center;vertical-align:middle;font-size:11px">${item.hsn_sac_code}</td>
        <td style="border:1px solid #bbb;padding:6px 8px;text-align:right;vertical-align:middle;font-size:11px">${Number(item.quantity).toFixed(2)}</td>
        <td style="border:1px solid #bbb;padding:6px 8px;text-align:right;vertical-align:middle;font-size:11px">${item.rate.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
        <td style="border:1px solid #bbb;padding:6px 8px;text-align:right;vertical-align:middle;font-size:11px">${item.taxable_value.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
        ${gstCol}
        <td style="border:1px solid #bbb;padding:6px 8px;text-align:right;vertical-align:middle;font-size:11px;font-weight:600">${itemTotal.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
      </tr>`;
    }).join("");

    const colSpan = firmHasGst ? 5 : 4;
    const totalRow = `
      <tr style="background:#f0f0f0;font-weight:700">
        <td style="border:1px solid #bbb;padding:8px;vertical-align:middle" colspan="${colSpan}">Total</td>
        <td style="border:1px solid #bbb;padding:8px;text-align:right;vertical-align:middle;font-size:11px">${totalTaxable.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
        ${firmHasGst ? `<td style="border:1px solid #bbb;padding:8px;vertical-align:middle"></td>` : ""}
        <td style="border:1px solid #bbb;padding:8px;text-align:right;vertical-align:middle;font-size:12px">${grandTotal.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
      </tr>`;

    const halfGst = totalGst / 2;
    let totalsSummary = `<tr><td style="padding:3px 8px;vertical-align:middle">Taxable Amount</td><td style="padding:3px 8px;text-align:right;font-weight:600;vertical-align:middle">\u20B9${totalTaxable.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td></tr>`;
    if (firmHasGst) {
      if (isIntraState) {
        totalsSummary += `
          <tr><td style="padding:3px 8px;vertical-align:middle">CGST</td><td style="padding:3px 8px;text-align:right;vertical-align:middle">\u20B9${halfGst.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td></tr>
          <tr><td style="padding:3px 8px;vertical-align:middle">SGST</td><td style="padding:3px 8px;text-align:right;vertical-align:middle">\u20B9${halfGst.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td></tr>`;
      } else {
        totalsSummary += `<tr><td style="padding:3px 8px;vertical-align:middle">IGST</td><td style="padding:3px 8px;text-align:right;vertical-align:middle">\u20B9${totalGst.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td></tr>`;
      }
      totalsSummary += `<tr><td style="padding:3px 8px;vertical-align:middle">Round Off</td><td style="padding:3px 8px;text-align:right;vertical-align:middle">${(Math.round(grandTotal) - grandTotal) >= 0 ? "+" : ""}\u20B9${(Math.round(grandTotal) - grandTotal).toFixed(2)}</td></tr>`;
    }
    totalsSummary += `<tr style="font-weight:700;font-size:13px;border-top:2px solid #333"><td style="padding:6px 8px;vertical-align:middle">Grand Total</td><td style="padding:6px 8px;text-align:right;vertical-align:middle">\u20B9${Math.round(grandTotal).toLocaleString("en-IN")}</td></tr>`;

    const pdfAddressLines = balanceAddressLines(
      firmAddr ? [firmAddr.line || firmAddr.line1, firmAddr.line2, [firmAddr.city, firmAddr.pincode].filter(Boolean).join(" \u2013 ")].filter(Boolean) : []
    );

    const docLabel = heading === "TAX INVOICE" ? "Invoice" : heading.charAt(0) + heading.slice(1).toLowerCase();

    return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${heading} ${invoiceNo}</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Segoe UI', Arial, sans-serif; color: #1a1a1a; font-size: 12px; }
        table { width: 100%; border-collapse: collapse; }
        td, th { vertical-align: middle !important; }
        @media print { @page { size: A4; margin: 20mm 15mm 20mm 15mm; } body { margin: 0; padding: 0; } }
        @media screen { body { padding: 20mm 15mm; max-width: 210mm; margin: 0 auto; } }
      </style></head><body>
      <div style="border:2px solid #7ba4d9;padding:16px;margin:0">

      <div style="text-align:center;margin-bottom:16px;border:1.5px solid #7ba4d9;padding:4px 0;line-height:1.2">
        <h1 style="font-size:20px;font-weight:700;color:#8B4513;letter-spacing:1.5px;margin:0;padding:0">${heading}</h1>
      </div>

      <div style="display:flex;justify-content:space-between;margin-bottom:14px">
        <div style="flex:1;max-width:55%">
          <p style="font-weight:800;font-size:14px;margin:0 0 4px">${firmName.toUpperCase()}</p>
          ${pdfAddressLines.map(line => `<p style="margin:1px 0;font-size:11px;line-height:1.5">${line}</p>`).join("")}
          ${placeOfSupply ? `<p style="margin:6px 0 0;font-size:11px"><strong>Place of Supply:</strong> ${placeOfSupply}</p>` : ""}
        </div>
        <div style="text-align:right;font-size:11px;min-width:280px">
          <div style="display:flex;justify-content:space-between;gap:20px">
            <div style="text-align:left">
              ${firmGstin ? `<p style="margin:2px 0"><strong>GSTIN:</strong> ${firmGstin}</p>` : ""}
              ${firm?.pan ? `<p style="margin:2px 0"><strong>PAN:</strong> ${firm.pan}</p>` : ""}
              ${msmeNo ? `<p style="margin:2px 0"><strong>MSME/Udyam No:</strong> ${msmeNo}</p>` : ""}
              ${billingEmail ? `<p style="margin:2px 0"><strong>Email:</strong> ${billingEmail}</p>` : ""}
              ${billingContact ? `<p style="margin:2px 0"><strong>Contact No:</strong> ${billingContact}</p>` : ""}
            </div>
            <div style="text-align:right">
              <p style="margin:2px 0"><strong>${docLabel} Date:</strong> ${invoiceDate ? format(new Date(invoiceDate), "dd/MM/yyyy") : "\u2014"}</p>
              <p style="margin:2px 0"><strong>${docLabel} No:</strong> ${invoiceNo}</p>
              ${referenceNo ? `<p style="margin:2px 0"><strong>Ref No:</strong> ${referenceNo}</p>` : ""}
            </div>
          </div>
        </div>
      </div>

      <div style="border:1px solid #bbb;margin-bottom:12px;padding:10px">
        <p style="font-size:10px;font-weight:700;color:#666;text-transform:uppercase;margin:0 0 4px">Bill To</p>
        <p style="font-weight:600;margin:0;font-size:13px">${toName}</p>
        ${toAddress ? `<p style="margin:2px 0;font-size:11px">${toAddress}</p>` : ""}
        ${toGstin ? `<p style="margin:4px 0;font-size:11px"><strong>GSTIN:</strong> ${toGstin}</p>` : ""}
      </div>

      <table>
        <thead>
          <tr style="background:#e2e8f0">
            <th style="border:1px solid #bbb;padding:7px;font-size:10px;width:30px;vertical-align:middle">#</th>
            <th style="border:1px solid #bbb;padding:7px;font-size:10px;text-align:left;vertical-align:middle">Item</th>
            <th style="border:1px solid #bbb;padding:7px;font-size:10px;vertical-align:middle">HSN/SAC</th>
            <th style="border:1px solid #bbb;padding:7px;font-size:10px;vertical-align:middle">Quantity</th>
            <th style="border:1px solid #bbb;padding:7px;font-size:10px;vertical-align:middle">Rate / Item (\u20B9)</th>
            <th style="border:1px solid #bbb;padding:7px;font-size:10px;vertical-align:middle">Taxable Value (\u20B9)</th>
            ${thGst}
            <th style="border:1px solid #bbb;padding:7px;font-size:10px;vertical-align:middle">Total (\u20B9)</th>
          </tr>
        </thead>
        <tbody>
          ${itemRows}
          ${totalRow}
        </tbody>
      </table>

      <div style="display:flex;justify-content:flex-end;margin-top:10px">
        <table style="width:320px;font-size:12px">${totalsSummary}</table>
      </div>

      <div style="margin:8px 0;padding:6px 8px;background:#f9f9f9;border:1px solid #ddd;font-size:11px">
        <strong>Amount in words:</strong> ${numberToWords(Math.round(grandTotal))}
      </div>

      ${remarksConditions ? `<div style="margin:8px 0;padding:6px 8px;font-size:11px;border:1px solid #ddd;page-break-inside:avoid;overflow:hidden">
        <strong>Remarks / Terms & Conditions:</strong><br/>
        <span style="white-space:pre-line;word-wrap:break-word;overflow-wrap:break-word">${remarksConditions}</span>
      </div>` : ""}

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

      <div style="margin-top:16px;padding-top:8px;padding-bottom:10px;border-top:1px solid #ddd;font-size:10px;color:#555">
        <p style="font-weight:700;margin:0 0 4px">Terms & Conditions:</p>
        <p style="margin:0;font-weight:700;letter-spacing:0.5px">PAYMENT TERMS: PAYMENT IS DUE WITHIN 45 DAYS FROM THE INVOICE DATE</p>
      </div>

      </div>
    </body></html>`;
  }, [lineItems, invoiceNo, invoiceDate, referenceNo, placeOfSupply, isIntraState,
    firm, firmName, firmAddressLines, firmFullAddress, firmGstin, bankDetails, msmeNo, showLogo,
    toName, toGstin, toAddress, totalTaxable, totalGst, grandTotal, firmHasGst, firmAddr,
    billingEmail, billingContact, docType, remarksConditions]);

  if (loading) return <div className="p-6"><Skeleton className="h-[400px] w-full" /></div>;

  return (
    <div className="h-[calc(100vh-80px)] flex flex-col">
      {/* Top bar */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-background shrink-0">
        <Button variant="ghost" size="icon" onClick={() => navigate("/billing")}><ArrowLeft size={18} /></Button>
        <div className="flex-1">
          <h1 className="text-lg font-bold text-foreground">{isEdit ? `Edit ${DOC_TYPE_LABELS[docType]}` : `New ${DOC_TYPE_LABELS[docType]}`}</h1>
          {status !== "draft" && <Badge className={cn("text-xs capitalize ml-2", status === "finalized" ? "bg-blue-100 text-blue-700" : "")}>{status}</Badge>}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleDownloadPdf} className="gap-1"><Download size={14} /> PDF</Button>
          {canConvert && (
            <Button variant="outline" size="sm" onClick={handleConvertToInvoice} className="gap-1"><RefreshCw size={14} /> Convert to Tax Invoice</Button>
          )}
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

          {/* Document Type Selector */}
          {!isEdit && (
            <div>
              <Label className="text-xs font-semibold text-muted-foreground uppercase mb-2 block">Document Type</Label>
              <div className="flex gap-1">
                {(["invoice", "quotation", "proforma", "credit_note"] as DocumentType[]).map(dt => (
                  <Button
                    key={dt}
                    variant={docType === dt ? "default" : "outline"}
                    size="sm"
                    className="text-xs"
                    onClick={() => setDocType(dt)}
                  >
                    {DOC_TYPE_LABELS[dt]}
                  </Button>
                ))}
              </div>
            </div>
          )}

          <Separator />

          {/* Firm Selection */}
          <div>
            <Label className="text-xs font-semibold text-muted-foreground uppercase mb-2 block">Billing From *</Label>
            <Select value={selectedFirmId} onValueChange={setSelectedFirmId} disabled={isLocked}>
              <SelectTrigger className={cn(firmError && !selectedFirmId && "border-destructive")}><SelectValue placeholder="Select firm" /></SelectTrigger>
              <SelectContent>
                {firmsList.map(f => (
                  <SelectItem key={f.id} value={f.id}>{f.display_name || f.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {firmError && !selectedFirmId && <p className="text-xs text-destructive mt-1">Please select a firm</p>}
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
          </div>

          {/* Last Year Reference Panel */}
          {clientId && selectedFirmId && (
            <Collapsible open={lastYearOpen} onOpenChange={setLastYearOpen}>
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="sm" className="w-full justify-between text-xs">
                  Reference: Last Year Invoice
                  <ChevronDown size={14} className={cn("transition-transform", lastYearOpen && "rotate-180")} />
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="border border-border rounded-md p-3 mt-1 text-sm space-y-2">
                  {lastYearInvoice ? (
                    <>
                      <div className="flex justify-between">
                        <span className="font-mono text-xs">{lastYearInvoice.invoice_no}</span>
                        <span className="text-xs text-muted-foreground">{lastYearInvoice.invoice_date ? format(new Date(lastYearInvoice.invoice_date), "dd/MM/yyyy") : ""}</span>
                      </div>
                      {Array.isArray(lastYearInvoice.line_items) && lastYearInvoice.line_items.map((li: any, i: number) => (
                        <div key={i} className="flex justify-between text-xs">
                          <span>{li.description}</span>
                          <span className="font-mono">{fmtINR(li.total || li.taxable_value || 0)}</span>
                        </div>
                      ))}
                      {lastYearInvoice.remarks_conditions && (
                        <p className="text-xs text-muted-foreground italic">{lastYearInvoice.remarks_conditions}</p>
                      )}
                      <Button variant="outline" size="sm" className="w-full text-xs gap-1 mt-1" onClick={copyFromLastYear} disabled={isLocked}>
                        <Copy size={12} /> Copy from Last Year
                      </Button>
                    </>
                  ) : (
                    <p className="text-xs text-muted-foreground">No previous year invoice found for this client.</p>
                  )}
                </div>
              </CollapsibleContent>
            </Collapsible>
          )}

          <Separator />

          {/* Document Details */}
          <div>
            <Label className="text-xs font-semibold text-muted-foreground uppercase mb-2 block">{DOC_TYPE_LABELS[docType]} Details</Label>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Document No</Label>
                <div className="relative">
                  <Input
                    value={invoiceNo}
                    readOnly={!docNoEditable}
                    className={cn("font-mono pr-8", !docNoEditable && "bg-muted")}
                    onChange={e => {
                      setInvoiceNo(e.target.value);
                      setDocNoManual(true);
                      setDuplicateWarning("");
                    }}
                    onBlur={async () => {
                      if (!docNoManual || !invoiceNo.trim() || !selectedFirmId) return;
                      const { data } = await supabase.from("invoices")
                        .select("id")
                        .eq("invoice_no", invoiceNo.trim())
                        .eq("firm_id", selectedFirmId)
                        .neq("id", invoiceId || "00000000-0000-0000-0000-000000000000")
                        .limit(1);
                      if (data && data.length > 0) setDuplicateWarning("This number already exists!");
                      else setDuplicateWarning("");
                    }}
                  />
                  {!isLocked && !docNoEditable && (
                    <button
                      type="button"
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      onClick={() => setDocNoEditable(true)}
                      title="Edit document number"
                    >
                      <Pencil size={14} />
                    </button>
                  )}
                </div>
                {duplicateWarning && (
                  <p className="text-xs text-destructive mt-1 flex items-center gap-1">
                    <AlertTriangle size={12} /> {duplicateWarning}
                  </p>
                )}
              </div>
              <div>
                <Label className="text-xs">Document Date</Label>
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

          {/* Credit Note: Against Invoice */}
          {docType === "credit_note" && clientId && (
            <div>
              <Label className="text-xs">Against Invoice (optional)</Label>
              <Select value={sourceDocumentId || "standalone"} onValueChange={v => setSourceDocumentId(v === "standalone" ? "" : v)} disabled={isLocked}>
                <SelectTrigger><SelectValue placeholder="Standalone credit note" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="standalone">Standalone (no linked invoice)</SelectItem>
                  {clientInvoices.length === 0 && (
                    <SelectItem value="no-invoices" disabled>No invoices found for this client</SelectItem>
                  )}
                  {clientInvoices.map(inv => (
                    <SelectItem key={inv.id} value={inv.id}>
                      {inv.invoice_no} — {inv.invoice_date ? format(new Date(inv.invoice_date), "dd MMM yyyy") : ""} — ₹{(inv.total_amount || 0).toLocaleString("en-IN")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Base Turnover (Audit clients only) */}
          {isAuditClient && (
            <div>
              <Label className="text-xs">Base Turnover (Reference Only — Not Printed)</Label>
              <Input type="number" value={baseTurnover} onChange={e => setBaseTurnover(e.target.value)} placeholder="₹" disabled={isLocked} />
            </div>
          )}

          <Separator />

          {/* Line Items */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <Label className="text-xs font-semibold text-muted-foreground uppercase">Line Items</Label>
              <div className="flex gap-1">
                {docType === "quotation" && clientId && (
                  <Button variant="outline" size="sm" className="text-xs h-7 gap-1" onClick={loadFromPackage} disabled={isLocked}>
                    <FileText size={12} /> Load from Package
                  </Button>
                )}
                {!isLocked && <Button variant="outline" size="sm" className="text-xs h-7 gap-1" onClick={addLine}><Plus size={12} /> Add Row</Button>}
              </div>
            </div>
            <div className="space-y-3">
              {lineItems.map((item, idx) => (
                <div key={idx} className="border border-border rounded-md p-3 space-y-2">
                  <div className="flex gap-2">
                    <div className="flex-1">
                      <Popover open={openItemPopover === idx} onOpenChange={(open) => setOpenItemPopover(open ? idx : null)}>
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
                  <div className={cn("grid gap-1", firmHasGst ? "grid-cols-5" : "grid-cols-4")}>
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
                    {firmHasGst && (
                      <div>
                        <Label className="text-[10px]">GST %</Label>
                        <Input type="number" value={item.gst_percent || ""} onChange={e => updateLine(idx, "gst_percent", Number(e.target.value))} className="text-xs h-8" disabled={isLocked} />
                      </div>
                    )}
                    <div>
                      <Label className="text-[10px]">Total</Label>
                      <div className="text-xs font-semibold pt-2 text-right">{fmtINR(firmHasGst ? item.total : item.taxable_value)}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <Separator />

          {/* Remarks / Terms & Conditions */}
          <div>
            <Label className="text-xs">Remarks / Terms & Conditions</Label>
            <Textarea
              value={remarksConditions}
              onChange={e => setRemarksConditions(e.target.value)}
              placeholder="These will be printed on the document"
              className="text-sm h-20"
              disabled={isLocked}
            />
          </div>

          <Separator />

          {/* Totals */}
          <div className="text-sm space-y-1 text-right">
            <p>Taxable Amount: <strong>{fmtINR(totalTaxable)}</strong></p>
            {firmHasGst && (
              isIntraState ? (
                <>
                  <p>CGST: <strong>{fmtINR(totalGst / 2)}</strong></p>
                  <p>SGST: <strong>{fmtINR(totalGst / 2)}</strong></p>
                </>
              ) : (
                <p>IGST: <strong>{fmtINR(totalGst)}</strong></p>
              )
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
              title="Document Preview"
            />
          </div>
        </div>
      </div>

      {/* Finalize confirmation */}
      <AlertDialog open={finalizeOpen} onOpenChange={setFinalizeOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Finalize {DOC_TYPE_LABELS[docType]}?</AlertDialogTitle>
            <AlertDialogDescription>Once finalized, the document cannot be edited.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleFinalize}>Finalize</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Date Error Dialog */}
      <Dialog open={dateErrorOpen} onOpenChange={setDateErrorOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Date Error</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground whitespace-pre-line">{dateErrorMsg}</p>
          <DialogFooter>
            <Button onClick={() => setDateErrorOpen(false)}>OK</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default NewInvoice;
