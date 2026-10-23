import { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate, useParams, useSearchParams, useLocation } from "react-router-dom";
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
import { SearchableSelect } from "@/components/ui/searchable-select";
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
import { effectiveDueDate } from "@/lib/billingReminderRules";
import { cn } from "@/lib/utils";
import {
  ArrowLeft, Plus, Trash2, Save, Lock, Download,
  FileText, Info, Check, ChevronsUpDown, ChevronDown, Copy, RefreshCw, Pencil, AlertTriangle,
} from "lucide-react";
import { buildInvoiceHtml, downloadPdfFromHtml } from "@/lib/invoicePdfGenerator";
import { resolveFirmNameForDate } from "@/lib/firmName";
import { BILLING_ATOMIC_NUMBERING } from "@/lib/billingFlags";
import { isValidGstin } from "@/lib/gstinUtils";
import { LOCKABLE_DOC_TYPES, firmLockDay, isPeriodLocked, lockMessage } from "@/lib/invoiceLock";
import { isCancelled } from "@/lib/billingCancellation";

// ─── Export Invoice Currencies ───
const EXPORT_CURRENCIES = [
  { code: "USD", name: "US Dollar" },
  { code: "EUR", name: "Euro" },
  { code: "GBP", name: "Pound Sterling" },
  { code: "AED", name: "UAE Dirham" },
  { code: "SGD", name: "Singapore Dollar" },
  { code: "AUD", name: "Australian Dollar" },
  { code: "CAD", name: "Canadian Dollar" },
  { code: "JPY", name: "Japanese Yen" },
  { code: "CHF", name: "Swiss Franc" },
  { code: "HKD", name: "Hong Kong Dollar" },
  { code: "SAR", name: "Saudi Riyal" },
  { code: "NZD", name: "New Zealand Dollar" },
];

type InvoiceType = "domestic" | "export_with_igst" | "export_without_igst";

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

// ─── Root-cause fix (2026-08-11): GSTIN-less Place of Supply ───
// Place of Supply / intra-vs-inter-state was previously derived ONLY from
// GSTIN, silently falling back to the FIRM's own state for any client with
// no GSTIN (unregistered / B2C) — wrong whenever that client is actually in
// a different state. The client record already carries a proper,
// standardized state (`registered_state`, picked from a fixed dropdown at
// client onboarding — see StepAdvancedInfo.tsx's INDIAN_STATES list),
// independent of GSTIN. This normalizes a state name (from either that list
// or a manual override) against STATE_CODES so it can be used as a
// GSTIN-less fallback. Normalization only affects matching, not what's
// displayed — STATE_CODES' own names are always what render.
function normalizeStateName(name: string): string {
  return String(name || "")
    .toLowerCase()
    .replace(/\(new\)/g, "")
    .replace(/\s*&\s*/g, " and ")
    .replace(/[^a-z]+/g, " ")
    .trim();
}
const STATE_NAME_TO_CODE: Record<string, string> = (() => {
  const map: Record<string, string> = {};
  for (const [code, name] of Object.entries(STATE_CODES)) {
    const key = normalizeStateName(name);
    if (!(key in map)) map[key] = code; // first match wins (e.g. AP → 28, not 37)
  }
  return map;
})();
/** Resolve a free-form/standardized state name (e.g. client.registered_state
 *  or a manually-picked value) to its GST state code, or null if unmatched.
 *  Unmatched names (e.g. the post-2020 merged "Dadra and Nagar Haveli and
 *  Daman and Diu" UT, which STATE_CODES still lists as two separate legacy
 *  codes) fall through to null so callers can keep their existing fallback —
 *  this only ADDS a resolution path, it never removes the old one. */
function getStateCodeFromName(stateName: string | null | undefined): string | null {
  if (!stateName) return null;
  return STATE_NAME_TO_CODE[normalizeStateName(stateName)] ?? null;
}
// Dropdown options for the manual Place-of-Supply override (GSTIN-less
// clients only) — every STATE_CODES entry, alphabetised by name.
const STATE_OPTIONS = Object.entries(STATE_CODES)
  .map(([code, name]) => ({ code, name }))
  .sort((a, b) => a.name.localeCompare(b.name));

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
  gstin_states: Record<string, string> | null;
  gstin_addresses: Record<string, string> | null;
  entity_type: string | null;
  address: string | null;
  registered_office: string | null;
  registered_state?: string | null;
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
  const { state: routeState } = useLocation();
  const { user } = useAuth();
  const { toast } = useToast();
  const isSuperadmin = user?.role === "superadmin";
  const isEdit = !!invoiceId;

  // ─── ROOT CAUSE B+C FIX ────────────────────────────────────────────────────
  // Extract prefill data SYNCHRONOUSLY (before any useState) so the form's
  // initial state is already populated on the very first render — no effect
  // timing gap, no skeleton flash, no blank-form frame.
  // Only applies in new-invoice mode (not edit).
  const prefillData: {
    client_id?:    string;
    client_name?:  string;
    amount?:       number;
    period?:       string;
    due_date?:     string;
    service_name?: string;
    reminder_id?:  string;
  } | null = !invoiceId ? ((routeState as any)?.prefill ?? null) : null;
  // ──────────────────────────────────────────────────────────────────────────

  // Document type from query param or default
  const initialDocType = (searchParams.get("type") as DocumentType) || "invoice";

  // ROOT CAUSE C FIX: new invoices start with loading=false — no skeleton flash
  const [loading, setLoading] = useState(!!invoiceId);
  const [saving, setSaving] = useState(false);
  const [clients, setClients] = useState<Client[]>([]);
  const [firmsList, setFirmsList] = useState<Firm[]>([]);
  const [selectedFirmId, setSelectedFirmId] = useState<string>("");
  const [firm, setFirm] = useState<Firm | null>(null);
  const [itemMasters, setItemMasters] = useState<ItemMaster[]>([]);

  // Document type
  const [docType, setDocType] = useState<DocumentType>(initialDocType);

  // Invoice state — ROOT CAUSE B FIX: initialize directly from prefillData
  const [clientId, setClientId] = useState(
    prefillData?.client_id ? String(prefillData.client_id) : ""
  );
  const [invoiceNo, setInvoiceNo] = useState("");
  const [seqNumber, setSeqNumber] = useState<number | null>(null);
  const [invoiceDate, setInvoiceDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [referenceNo, setReferenceNo] = useState(
    prefillData?.due_date ? String(prefillData.due_date) : ""
  );
  const [lineItems, setLineItems] = useState<LineItem[]>(() => {
    if (!prefillData) return [EMPTY_ITEM()];
    const amt = Number(prefillData.amount) || 0;
    const gstAmt = Math.round(amt * 0.18 * 100) / 100;
    return [{
      ...EMPTY_ITEM(),
      description:         prefillData.service_name || "Professional Services",
      description_details: prefillData.period ? `Period: ${String(prefillData.period)}` : "",
      rate:          amt,
      taxable_value: amt,
      quantity:      1,
      gst_percent:   18,
      gst_amount:    gstAmt,
      total:         amt + gstAmt,
    }];
  });
  const [isIntraState, setIsIntraState] = useState(true);
  const [status, setStatus] = useState("draft");
  // Date and status as stored, for the period lock (the form fields can change).
  const [savedDate, setSavedDate] = useState<string | null>(null);
  const [savedStatus, setSavedStatus] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [showLogo, setShowLogo] = useState(true);
  const [remarksConditions, setRemarksConditions] = useState("");
  // Editable payment-terms window (days). Default 45; shown on the invoice as
  // "PAYMENT IS DUE WITHIN <N> DAYS FROM THE INVOICE DATE".
  const [paymentDueDays, setPaymentDueDays] = useState<number>(45);
  const [baseTurnover, setBaseTurnover] = useState("");
  const [sourceDocumentId, setSourceDocumentId] = useState("");

  // Editable doc number
  const [docNoEditable, setDocNoEditable] = useState(false);
  const [docNoManual, setDocNoManual] = useState(false);
  const [duplicateWarning, setDuplicateWarning] = useState("");

  // Client fields — ROOT CAUSE B FIX: set toName immediately from prefill
  // so the name shows even before the async clients-list fetch completes
  const [toName, setToName] = useState(
    prefillData?.client_name ? String(prefillData.client_name) : ""
  );
  const [toGstin, setToGstin] = useState("");
  const [toAddress, setToAddress] = useState("");
  // Root-cause fix (2026-08-11): the client's own registered state (set at
  // onboarding, independent of GSTIN) — used as the Place-of-Supply source
  // for clients with no GSTIN instead of silently falling back to the
  // firm's state. manualPlaceOfSupplyCode lets the auditor override/correct
  // it directly on the invoice when registered_state is blank or wrong;
  // only surfaced (and only takes effect) when the client has no GSTIN.
  const [toRegisteredState, setToRegisteredState] = useState("");
  const [manualPlaceOfSupplyCode, setManualPlaceOfSupplyCode] = useState("");

  // Source document info (for converted docs)
  const [sourceDocInfo, setSourceDocInfo] = useState<{ invoice_no: string; document_type: string; invoice_date: string; total_amount: number } | null>(null);

  // Multi-GSTIN picker — shown when selected client has > 1 GSTIN
  const [clientGstins, setClientGstins] = useState<string[]>([]);
  const [clientGstinStates, setClientGstinStates] = useState<Record<string, string>>({});
  const [clientGstinAddresses, setClientGstinAddresses] = useState<Record<string, string>>({});

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

  // TDS Section state
  const [tdsRates, setTdsRates] = useState<{ section_code: string; description: string; rate: number }[]>([]);
  const [tdsSectionCode, setTdsSectionCode] = useState("");
  const [tdsRate, setTdsRate] = useState(0);

  // Export invoice state
  const [invoiceType, setInvoiceType] = useState<InvoiceType>("domestic");
  const [exportCurrency, setExportCurrency] = useState("USD");
  const [exchangeRate, setExchangeRate] = useState<number>(84);
  const [lutNumber, setLutNumber] = useState("");

  // Derived values
  const firmGstin = firm?.gstin || "";
  // Root-cause fix (2026-08-11): for a client with NO GSTIN, resolve Place of
  // Supply from (in priority order) a manual override typed on the invoice,
  // then the client's own registered_state — instead of silently falling
  // back to the firm's own state. Only when NEITHER resolves (no manual pick
  // and registered_state is blank/unrecognised) does the original H6
  // fallback-to-firm's-state behaviour apply, unchanged.
  const noGstinStateCode = !toGstin
    ? (manualPlaceOfSupplyCode || getStateCodeFromName(toRegisteredState) || "")
    : "";
  // H6 (original): place of supply is the RECIPIENT's state (from the client
  // GSTIN); falls back to the firm's state only when GSTIN-less resolution
  // above found nothing.
  const placeOfSupply = toGstin
    ? getPlaceOfSupply(toGstin)
    : (noGstinStateCode ? `${noGstinStateCode}-${STATE_CODES[noGstinStateCode]}` : getPlaceOfSupply(firmGstin));
  const msmeNo = (firm?.settings as any)?.msme_no || "";
  const billingEmail = (firm?.settings as any)?.billing_email || firm?.email || "";
  const billingContact = (firm?.settings as any)?.billing_contact_no || firm?.phone || "";
  const firmHasGst = !!firmGstin;
  const isExport = invoiceType !== "domestic";
  const isExportWithIGST = invoiceType === "export_with_igst";
  const isExportWithoutIGST = invoiceType === "export_without_igst";
  // Export transactions are always inter-state (IGST); domestic follows GSTIN match
  const effectiveIsIntraState = isExport ? false : isIntraState;
  const currentFY = getFYFromDate(invoiceDate);

  useEffect(() => {
    if (firmGstin && toGstin) {
      setIsIntraState(isIntraStateFromGstins(firmGstin, toGstin));
    } else if (!toGstin && firmGstin.length >= 2 && noGstinStateCode) {
      // Root-cause fix (2026-08-11): previously this branch never ran for a
      // GSTIN-less client, so isIntraState stayed stuck at its `true`
      // default forever (always CGST+SGST). Now that we can resolve the
      // client's actual state (manual pick or registered_state), compare it
      // against the firm's GSTIN state like the GSTIN path already does.
      // Only fires once a state is actually resolved — when it isn't, the
      // original always-true default is left untouched.
      setIsIntraState(firmGstin.substring(0, 2) === noGstinStateCode);
    }
    // When user picks a GSTIN from the multi-picker, auto-fill per-GSTIN address
    if (toGstin && clientGstins.length > 1 && clientGstinAddresses[toGstin]) {
      setToAddress(clientGstinAddresses[toGstin]);
    }
  }, [firmGstin, toGstin, noGstinStateCode]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch firms list
  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("firms").select("id, name, display_name, logo_url, pan, gstin, phone, email, address, bank_details, primary_color, signature_url, state, settings, legal_name_changes").order("name");
      const firms = (data || []) as Firm[];
      setFirmsList(firms);
      // Don't override selectedFirmId in edit mode — it will be set from the invoice record
      if (!isEdit) {
        if (user?.firm_id) setSelectedFirmId(user.firm_id);
        else if (firms.length > 0) setSelectedFirmId(firms[0].id);
      }
    })();
  }, [user?.firm_id, isEdit]);

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

  // Fetch TDS sections from tds_rate_master (26Q form type = non-salary TDS)
  // 194C and 194J shown first (Change 3)
  useEffect(() => {
    (async () => {
      let q = supabase.from("tds_rate_master")
        .select("section_code, nature_of_payment, rate_individual")
        .eq("form_type", "26Q")
        .eq("is_active", true);
      if (!isSuperadmin && user?.firm_id) q = q.eq("firm_id", user.firm_id);
      const { data } = await q;
      if (data && data.length > 0) {
        const sorted = [...data].sort((a, b) => {
          const priority = (s: string) => s.startsWith("194C") ? 0 : s.startsWith("194J") ? 1 : 2;
          const pa = priority(a.section_code);
          const pb = priority(b.section_code);
          if (pa !== pb) return pa - pb;
          return a.section_code.localeCompare(b.section_code);
        });
        setTdsRates(sorted.map(r => ({
          section_code: r.section_code,
          description: (r as any).nature_of_payment || r.section_code,
          rate: Number((r as any).rate_individual) || 0,
        })));
      }
    })();
  }, [isSuperadmin, user?.firm_id]);

  // Fetch clients — INCLUDE archived clients so the user can still raise
  // invoices against them (e.g. carried-over work for a client who was
  // archived after year-end).
  //
  // ROOT-CAUSE FIX: this codebase archives a client by setting
  // `deleted_at` (a soft-delete timestamp) — NOT by flipping `is_active`.
  // Confirmed by Clients.tsx#fetchArchivedClients which queries
  // `.not("deleted_at", "is", null)` to list the Archived tab. The old
  // NewInvoice fetch had `.is("deleted_at", null)` AND `.neq("is_active",
  // false)`, so every archived client was silently dropped from the
  // dropdown. Both filters are removed here. Draft records
  // (is_draft = true) stay excluded — those are incomplete stubs, not
  // real clients yet.
  //
  // Archived rows are sorted to the bottom and tagged " — Archived" in
  // the dropdown label so the active list stays on top and the auditor
  // sees at a glance which clients are inactive.
  useEffect(() => {
    (async () => {
      const { data: clientData } = await supabase
        .from("clients")
        .select("id, name, pan, gstin, gstin_states, gstin_addresses, entity_type, address, registered_office, registered_state, is_active, deleted_at")
        .eq("is_draft", false)
        .order("name");
      const isArchived = (c: any) => c.deleted_at != null || c.is_active === false;
      const rows = (clientData || []).slice().sort((a: any, b: any) => {
        const aa = isArchived(a) ? 1 : 0;
        const bb = isArchived(b) ? 1 : 0;
        if (aa !== bb) return aa - bb;
        return String(a.name || "").localeCompare(String(b.name || ""));
      });
      setClients(rows);
    })();
  }, [isSuperadmin, user?.firm_id]);

  // Generate document number via get_next_invoice_seq
  const generateDocNumber = useCallback(async () => {
    if (!selectedFirmId || isEdit || docNoManual) return;
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
  }, [selectedFirmId, docType, invoiceDate, isEdit, docNoManual]);

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
        setSavedDate(inv.invoice_date || null);
        setSavedStatus(inv.status || "draft");
        setCancelReason((inv as any).voided_reason || "");
        setReferenceNo((inv as any).reference_no || "");
        setStatus(inv.status || "draft");
        setShowLogo(inv.show_logo ?? true);
        setToName(inv.to_name || "");
        setToGstin(inv.to_gstin || "");
        setToAddress(inv.to_address || "");
        setRemarksConditions((inv as any).remarks_conditions || "");
        setPaymentDueDays(Number((inv as any).payment_due_days) > 0 ? Number((inv as any).payment_due_days) : 45);
        setBaseTurnover((inv as any).base_turnover ? String((inv as any).base_turnover) : "");
        setSourceDocumentId((inv as any).source_document_id || "");
        setTdsSectionCode((inv as any).tds_section_code || "");
        setTdsRate(Number((inv as any).tds_rate) || 0);
        setInvoiceType(((inv as any).invoice_type as InvoiceType) || "domestic");
        setExportCurrency((inv as any).export_currency || "USD");
        setExchangeRate(Number((inv as any).exchange_rate) || 84);
        setLutNumber((inv as any).lut_number || "");
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
        // Load source document info for linkage display
        const srcId = (inv as any).source_document_id;
        if (srcId) {
          const { data: srcDoc } = await supabase.from("invoices")
            .select("invoice_no, document_type, invoice_date, total_amount")
            .eq("id", srcId).maybeSingle();
          if (srcDoc) setSourceDocInfo(srcDoc as any);
        }
      }
      setLoading(false);
    })();
  }, [isEdit, invoiceId]);

  // Auto-fill client details & check audit classification
  useEffect(() => {
    if (!clientId) { setIsAuditClient(false); setClientGstins([]); setClientGstinStates({}); setToRegisteredState(""); setManualPlaceOfSupplyCode(""); return; }
    const client = clients.find(c => c.id === clientId);
    if (client) {
      setToName(client.name || "");
      // Root-cause fix (2026-08-11): carry the client's own registered state
      // + clear any manual Place-of-Supply override from a previous client
      // selection, so switching clients never leaks a stale pick forward.
      setToRegisteredState(client.registered_state || "");
      setManualPlaceOfSupplyCode("");
      const gstins = client.gstin ?? [];
      const states = (client.gstin_states && typeof client.gstin_states === "object") ? client.gstin_states as Record<string, string> : {};
      const addresses = (client.gstin_addresses && typeof client.gstin_addresses === "object") ? client.gstin_addresses as Record<string, string> : {};
      setClientGstins(gstins);
      setClientGstinStates(states);
      setClientGstinAddresses(addresses);
      if (gstins.length === 1) {
        // Single GSTIN — auto-fill as before
        setToGstin(gstins[0]);
        // Use per-GSTIN address if available, else fall back to client address
        const perGstinAddr = addresses[gstins[0]];
        if (perGstinAddr) {
          setToAddress(perGstinAddr);
        } else {
          const addrParts = [client.address, client.registered_office].filter(Boolean);
          if (addrParts.length > 0) setToAddress(addrParts.join(", "));
        }
      } else if (gstins.length === 0) {
        setToGstin("");
        const addrParts = [client.address, client.registered_office].filter(Boolean);
        if (addrParts.length > 0) setToAddress(addrParts.join(", "));
      }
      // Multiple GSTINs: don't auto-fill address; it will update when user picks a GSTIN
    }
    // Check audit classification & fetch turnover
    (async () => {
      const fy = getFYFromDate(invoiceDate);
      const { data } = await supabase.from("client_fy_classifications")
        .select("classification")
        .eq("client_id", clientId)
        .eq("financial_year", fy)
        .maybeSingle();
      const isAudit = data?.classification === "Audit";
      setIsAuditClient(isAudit);
      if (isAudit && !baseTurnover) {
        const { data: cl } = await supabase.from("clients").select("audit_turnover").eq("id", clientId).maybeSingle();
        if ((cl as any)?.audit_turnover) setBaseTurnover(String((cl as any).audit_turnover));
      }
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
    // Export without IGST = zero-rated; no GST on the invoice
    const gstPct = (firmHasGst && !isExportWithoutIGST) ? (Number(item.gst_percent) || 0) : 0;
    const gstAmt = Math.round(taxable * gstPct / 100 * 100) / 100;
    return { ...item, taxable_value: taxable, gst_amount: gstAmt, total: taxable + gstAmt };
  }, [firmHasGst, isExportWithoutIGST]);

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

  // Totals (amounts in foreign currency for export, INR for domestic)
  const items = useMemo(() => lineItems.filter(li => li.description.trim()), [lineItems]);
  const totalTaxable = useMemo(() => items.reduce((s, li) => s + li.taxable_value, 0), [items]);
  const totalGst = useMemo(() => (firmHasGst && !isExportWithoutIGST) ? items.reduce((s, li) => s + li.gst_amount, 0) : 0, [items, firmHasGst, isExportWithoutIGST]);
  const grandTotal = totalTaxable + totalGst;
  // INR equivalents for saving to DB and ledger entries
  const inrMultiplier = isExport ? (Number(exchangeRate) || 1) : 1;
  const inrSubtotal   = Math.round(totalTaxable * inrMultiplier * 100) / 100;
  const inrGst        = Math.round(totalGst * inrMultiplier * 100) / 100;
  const inrGrandTotal = Math.round(grandTotal * inrMultiplier * 100) / 100;
  const tdsAmount = useMemo(() => tdsSectionCode ? Math.round(inrSubtotal * tdsRate / 100 * 100) / 100 : 0, [tdsSectionCode, tdsRate, inrSubtotal]);
  const firmLogoUrl = useMemo(() => {
    const settingsLogo = typeof firm?.settings === "object" && firm?.settings
      ? (firm.settings as Record<string, any>).logo_url
      : null;
    return firm?.logo_url || settingsLogo || "";
  }, [firm]);

  // Firm name applicable to the document date (handles constitution changes,
  // e.g. "V J Desai & Co." → "V J Desai & Co. LLP" from 16/04/2026).
  const firmName = useMemo(
    () => resolveFirmNameForDate(firm as any, invoiceDate) || firm?.display_name || firm?.name || "",
    [firm, invoiceDate]
  );
  const firmAddr = firm?.address as any;
  const firmAddressLines = useMemo(() => {
    if (!firmAddr) return [];
    const addrLine = firmAddr.line || firmAddr.line1 || "";
    const cityName = firmAddr.city || "";
    // Avoid duplicating city if already present in address line
    const cityAlreadyInAddress = cityName && addrLine.toLowerCase().includes(cityName.toLowerCase());
    const cityPinPart = cityAlreadyInAddress ? "" : [cityName, firmAddr.pincode].filter(Boolean).join(" \u2013 ");
    const rawLines = [addrLine, firmAddr.line2, cityPinPart].filter(Boolean);
    return balanceAddressLines(rawLines);
  }, [firmAddr]);
  const firmFullAddress = firmAddressLines.join(", ");
  const bankDetails = firm?.bank_details as any;

  // Save
  const handleSave = async (newStatus?: string) => {
    if (!selectedFirmId) { setFirmError(true); toast({ title: "Please select a firm", variant: "destructive" }); return; }
    if (!clientId) { toast({ title: "Select a client", variant: "destructive" }); return; }
    if (!invoiceNo.trim()) { toast({ title: "Document number cannot be blank", variant: "destructive" }); return; }
    if (items.length === 0) { toast({ title: "Add at least one item", variant: "destructive" }); return; }
    if (duplicateWarning) { toast({ title: "Document number already exists. Please change it.", variant: "destructive" }); return; }
    if (isCancelledDoc) { toast({ title: "This document is cancelled", description: "A cancelled document cannot be edited or re-issued.", variant: "destructive" }); return; }
    if (isLocked) { toast({ title: "This month is closed", description: lockMessage(savedDate!, lockDay!), variant: "destructive" }); return; }
    // Issuing (or re-dating) a document into a closed month is blocked too.
    if (!isSuperadmin && LOCKABLE_DOC_TYPES.includes(docType) && (newStatus || status) !== "draft"
        && isPeriodLocked(invoiceDate, lockDay)) {
      toast({ title: "Date is in a closed month", description: lockMessage(invoiceDate, lockDay!), variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const effectiveStatus = newStatus || status;
      const halfGst = effectiveIsIntraState ? inrGst / 2 : 0;
      const series = getDocSeries(docType);
      const fy = getFYFromDate(invoiceDate);

      // Phase 2 cutover (C8, flag-gated OFF): when enabled, allocate the
      // sequence atomically AT SAVE so concurrent creates can't collide and a
      // deleted number is never reused. OFF → the form-load number is used.
      //
      // 2026-06-25 (V J Desai & Co. LLP — numbering out-of-order fix):
      //   the previous logic wrote `finalSeq = null` whenever the auditor
      //   had manually edited the invoice number. The row then persisted
      //   with seq_number IS NULL, breaking every downstream numbering
      //   consumer (get_next_invoice_seq / list ORDER BY seq_number DESC
      //   / Documents-list sort within same date). Parse a seq out of the
      //   invoice_no string as a fallback so seq_number is never NULL
      //   for a numbered doc — even on manual overrides.
      const parseSeqFromInvoiceNo = (s: string): number | null => {
        const m = /^\s*(\d+)/.exec(s || "");
        if (!m) return null;
        const n = Number(m[1]);
        return Number.isFinite(n) && n > 0 ? n : null;
      };
      let finalSeq: number | null = docNoManual
        ? (parseSeqFromInvoiceNo(invoiceNo) ?? seqNumber)
        : seqNumber;
      let finalInvoiceNo = invoiceNo.trim();
      if (BILLING_ATOMIC_NUMBERING && !docNoManual && !isEdit) {
        const { data: allocated, error: allocErr } = await (supabase as any).rpc("allocate_doc_number", {
          p_firm_id: selectedFirmId, p_series: series, p_financial_year: fy, p_invoice_date: invoiceDate,
        });
        if (allocErr) {
          setSaving(false);
          toast({ title: "Could not allocate document number", description: allocErr.message, variant: "destructive" });
          return;
        }
        finalSeq = allocated as number;
        finalInvoiceNo = formatDocNumber(allocated as number, series, fy);
      }

      const payload: any = {
        invoice_no: finalInvoiceNo,
        client_id: clientId,
        firm_id: selectedFirmId,
        invoice_date: invoiceDate,
        reference_no: referenceNo || null,
        place_of_supply: placeOfSupply || null,
        invoice_format: "gst_tax_invoice",
        amount: inrSubtotal,
        subtotal: inrSubtotal,
        gst_amount: inrGst,
        total_cgst: firmHasGst && effectiveIsIntraState ? halfGst : 0,
        total_sgst: firmHasGst && effectiveIsIntraState ? halfGst : 0,
        total_igst: firmHasGst && !effectiveIsIntraState && !isExportWithoutIGST ? inrGst : 0,
        total_amount: Math.round(inrGrandTotal),
        is_intra_state: effectiveIsIntraState,
        invoice_type: invoiceType,
        export_currency: isExport ? exportCurrency : null,
        exchange_rate: isExport ? (Number(exchangeRate) || null) : null,
        lut_number: isExportWithoutIGST ? (lutNumber || null) : null,
        show_logo: showLogo,
        status: effectiveStatus,
        document_type: docType,
        document_series: series,
        seq_number: finalSeq,
        financial_year: fy,
        remarks_conditions: remarksConditions || null,
        base_turnover: baseTurnover ? Number(baseTurnover) : null,
        source_document_id: sourceDocumentId || null,
        from_firm_name: firmName,
        from_address: firmFullAddress,
        from_gstin: firmGstin,
        from_pan: firm?.pan || "",
        from_msme: msmeNo,
        from_phone: billingContact,
        from_email: billingEmail,
        to_name: toName,
        to_address: toAddress,
        to_gstin: toGstin,
        bank_details_snapshot: bankDetails,
        payment_due_days: paymentDueDays,
        // Payment reminders run off due_date; keep it in step with the printed terms.
        ...(docType === "invoice" ? { due_date: effectiveDueDate({ invoice_date: invoiceDate, payment_due_days: paymentDueDays }) } : {}),
        payment_terms: `PAYMENT IS DUE WITHIN ${paymentDueDays} DAYS FROM THE INVOICE DATE`,
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
        tds_section_code: tdsSectionCode || null,
        tds_rate: tdsSectionCode ? tdsRate : null,
        tds_amount: tdsAmount > 0 ? tdsAmount : null,
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

        // Mark source document as converted (for quotation/proforma → invoice conversion)
        if (sourceDocumentId && docType === "invoice") {
          await supabase.from("invoices")
            .update({ status: "converted", converted_to_id: savedId, conversion_date: new Date().toISOString() })
            .eq("id", sourceDocumentId);
        }

        // ── STEP 6: Close the reminder loop ──────────────────────────────────
        // If this invoice was created from a billing reminder, mark that
        // reminder as "invoiced" and store a back-reference to this invoice.
        if (prefillData?.reminder_id && savedId) {
          await supabase.from("billing_reminders")
            .update({ status: "invoice_created", last_invoice_id: savedId })
            .eq("id", prefillData.reminder_id);
        }
        // ─────────────────────────────────────────────────────────────────────
      }

      // Auto-insert/update ledger entry when finalizing.
      // Q3: ONLY real invoices and credit notes post to the client ledger.
      // Quotations / proformas are not confirmed transactions and must never
      // appear in the ledger or outstanding balance.
      if (
        ["finalized", "sent", "overdue", "paid"].includes(effectiveStatus) &&
        (docType === "invoice" || docType === "credit_note") &&
        savedId && clientId && selectedFirmId
      ) {
        const entryType = docType === "credit_note" ? "credit_note" : "invoice";
        const isCredit = docType === "credit_note";
        // Remove stale ledger row if invoice was edited and re-finalized
        await supabase.from("client_ledger_entries")
          .delete()
          .eq("document_id", savedId)
          .in("entry_type", ["invoice", "credit_note"]);
        await supabase.from("client_ledger_entries").insert({
          firm_id: selectedFirmId,
          client_id: clientId,
          entry_date: invoiceDate,
          entry_type: entryType,
          document_id: savedId,
          debit_amount: isCredit ? 0 : Math.round(inrGrandTotal),
          credit_amount: isCredit ? Math.round(inrGrandTotal) : 0,
          narration: `${isCredit ? "Credit Note" : "Invoice"} ${invoiceNo}`,
          financial_year: fy,
        });
      }

      setStatus(effectiveStatus);
      setSavedDate(invoiceDate);
      setSavedStatus(effectiveStatus);
      if (!isEdit) navigate("/billing");
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
    setSaving(false);
  };

  const handleFinalize = () => {
    if (isExportWithoutIGST && !lutNumber.trim()) {
      toast({ title: "LUT Number required", description: "Enter the LUT/Bond number for export without IGST before finalizing.", variant: "destructive" });
      return;
    }
    setFinalizeOpen(false);
    handleSave("finalized");
  };

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
      setPaymentDueDays(Number((source as any).payment_due_days) > 0 ? Number((source as any).payment_due_days) : 45);
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

  // NOTE: Prefill from Billing reminder is now handled synchronously via
  // `prefillData` extracted before useState calls above (ROOT CAUSE B+C fix).
  // No post-paint effect needed — state is already populated on first render.

  const handleDownloadPdf = async () => {
    if (status === "draft") {
      toast({ title: "Finalize before downloading", description: "Please finalize this document before downloading the PDF.", variant: "destructive" });
      return;
    }
    const fullHtml = generateInvoiceHtml();
    const filename = `${DOC_TYPE_LABELS[docType].replace(/ /g, "_")}_${invoiceNo?.replace(/\//g, "-") || "draft"}.pdf`;
    await downloadPdfFromHtml(fullHtml, filename, `Single invoice ${invoiceNo || "draft"}`);
  };

  // Per firm preference: documents stay editable at ANY status (no locking).
  // Editing re-syncs the ledger entry on save (see handleSave), and the Billing
  // Health panel surfaces any resulting drift, so editability is safe.
  // Period lock: an issued invoice / credit note in a closed month is read-only
  // for everyone except a superadmin (enforced again by a DB trigger).
  const lockDay = firmLockDay(firm?.settings);
  // A cancelled document is read-only for everyone, superadmins included.
  const isCancelledDoc = isEdit && isCancelled(savedStatus);
  const isLocked = isCancelledDoc || (isEdit && !isSuperadmin && LOCKABLE_DOC_TYPES.includes(docType)
    && savedStatus !== null && savedStatus !== "draft" && isPeriodLocked(savedDate, lockDay));
  const canConvert = isEdit && (docType === "quotation" || docType === "proforma") && status === "finalized";

  // Generate invoice HTML
  const generateInvoiceHtml = useCallback(() => {
    const validItems = lineItems.filter(li => li.description.trim());
    return buildInvoiceHtml({
      invoice_no: invoiceNo,
      invoice_date: invoiceDate,
      document_type: docType,
      from_firm_name: firmName,
      from_gstin: firmGstin,
      from_pan: firm?.pan || "",
      from_msme: msmeNo,
      from_address: firmFullAddress,
      from_email: billingEmail,
      from_phone: billingContact,
      to_name: toName,
      to_gstin: toGstin,
      to_address: toAddress,
      place_of_supply: placeOfSupply,
      is_intra_state: effectiveIsIntraState,
      line_items: validItems,
      amount: totalTaxable,
      subtotal: totalTaxable,
      gst_amount: totalGst,
      total_amount: Math.round(inrGrandTotal),
      reference_no: referenceNo || null,
      remarks_conditions: remarksConditions || null,
      payment_due_days: paymentDueDays,
      bank_details_snapshot: bankDetails,
      signatory_name: firmName,
      logo_url: firmLogoUrl,
      show_logo: showLogo,
      firm_settings: typeof firm?.settings === "object" ? firm.settings : null,
      invoice_type: invoiceType,
      export_currency: isExport ? exportCurrency : null,
      exchange_rate: isExport ? (Number(exchangeRate) || 1) : null,
      lut_number: isExportWithoutIGST ? lutNumber : null,
    });
  }, [lineItems, invoiceNo, invoiceDate, referenceNo, placeOfSupply, effectiveIsIntraState,
    firm, firmName, firmFullAddress, firmGstin, bankDetails, showLogo, firmLogoUrl,
    toName, toGstin, toAddress, totalTaxable, totalGst, inrGrandTotal,
    billingEmail, billingContact, docType, remarksConditions, paymentDueDays,
    invoiceType, exportCurrency, exchangeRate, lutNumber, isExport, isExportWithoutIGST]);

  if (loading) return <div className="p-6"><Skeleton className="h-[400px] w-full" /></div>;

  return (
    <div className="h-[calc(100vh-80px)] flex flex-col">
      {/* Top bar */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-background shrink-0">
        <Button variant="ghost" size="icon" onClick={() => navigate("/billing")}><ArrowLeft size={18} /></Button>
        <div className="flex-1">
          <h1 className="text-lg font-bold text-foreground">{isLocked ? `View ${DOC_TYPE_LABELS[docType]}` : isEdit ? `Edit ${DOC_TYPE_LABELS[docType]}` : `New ${DOC_TYPE_LABELS[docType]}`}</h1>
          {status !== "draft" && <Badge className={cn("text-xs capitalize ml-2", status === "finalized" ? "bg-blue-100 text-blue-700" : "")}>{status}</Badge>}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleDownloadPdf} className="gap-1"
            title={status === "draft" ? "Finalize this document before downloading PDF" : "Download PDF"}>
            <Download size={14} /> PDF
            {status === "draft" && <span className="ml-1 text-[10px] text-muted-foreground">(finalize first)</span>}
          </Button>
          {canConvert && (
            <Button variant="outline" size="sm" onClick={handleConvertToInvoice} className="gap-1"><RefreshCw size={14} /> Convert to Tax Invoice</Button>
          )}
          {!isLocked && (
            <>
              <Button variant="outline" size="sm" onClick={() => handleSave()} disabled={saving} className="gap-1">
                <Save size={14} /> {saving ? "Saving..." : status === "draft" ? "Save Draft" : "Save"}
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

          {/* ── Step 5: Prefill banner (shown when opened from a billing reminder) ── */}
          {prefillData && (
            <div className="flex items-start gap-2 rounded-md border border-blue-200 dark:border-blue-800 bg-blue-50/60 dark:bg-blue-950/30 px-3 py-2.5">
              <Info size={14} className="text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
              <div className="text-xs text-blue-700 dark:text-blue-300">
                <span className="font-semibold">Pre-filled from Billing Reminder</span>
                {prefillData.client_name && <span> — {prefillData.client_name}</span>}
                {prefillData.service_name && <span> · {prefillData.service_name}</span>}
                {prefillData.due_date && <span> · Due {prefillData.due_date}</span>}
                <span className="block text-blue-500 dark:text-blue-400 mt-0.5">Review the details below and click <strong>Save Draft</strong> or <strong>Finalize</strong> to create the invoice.</span>
              </div>
            </div>
          )}

          {isCancelledDoc && (
            <div className="flex items-start gap-2 rounded-md border border-red-300 bg-red-50 px-3 py-2.5 text-xs text-red-800">
              <Lock size={14} className="shrink-0 mt-0.5" />
              <span>
                <span className="font-semibold">Cancelled — read-only.</span> This document is excluded from the ledger and
                reports, and its number is not reused.{cancelReason ? ` Reason: ${cancelReason}` : ""}
              </span>
            </div>
          )}

          {isLocked && !isCancelledDoc && savedDate && lockDay && (
            <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2.5 text-xs text-amber-800">
              <Lock size={14} className="shrink-0 mt-0.5" />
              <span><span className="font-semibold">Read-only — period closed.</span> {lockMessage(savedDate, lockDay)}</span>
            </div>
          )}

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
                    onClick={() => { setDocType(dt); if (dt !== "invoice") setInvoiceType("domestic"); }}
                  >
                    {DOC_TYPE_LABELS[dt]}
                  </Button>
                ))}
              </div>
            </div>
          )}

          {/* Export Invoice Type — only for Tax Invoice */}
          {docType === "invoice" && (
            <div>
              <Label className="text-xs font-semibold text-muted-foreground uppercase mb-2 block">Invoice Type</Label>
              <div className="flex flex-wrap gap-1">
                {([
                  { value: "domestic",             label: "Tax Invoice (Domestic)" },
                  { value: "export_with_igst",     label: "Export — With IGST" },
                  { value: "export_without_igst",  label: "Export — Without IGST (LUT/Bond)" },
                ] as { value: InvoiceType; label: string }[]).map(opt => (
                  <Button
                    key={opt.value}
                    variant={invoiceType === opt.value ? "default" : "outline"}
                    size="sm"
                    className="text-xs"
                    disabled={isLocked}
                    onClick={() => setInvoiceType(opt.value)}
                  >
                    {opt.label}
                  </Button>
                ))}
              </div>
            </div>
          )}

          {/* Export Invoice Settings Panel */}
          {isExport && docType === "invoice" && (
            <div className="rounded-lg border border-orange-200 bg-orange-50/50 dark:bg-orange-950/20 p-3 space-y-3">
              <div className="flex items-center gap-2">
                <Badge className="text-[10px] bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200">Export Invoice</Badge>
                <span className="text-xs text-orange-700 dark:text-orange-300 italic">
                  {isExportWithIGST
                    ? "Supply meant for Export under Bond or LUT with payment of IGST"
                    : "Supply meant for Export under Bond or LUT without payment of IGST"}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs">Currency</Label>
                  <Select value={exportCurrency} onValueChange={setExportCurrency} disabled={isLocked}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {EXPORT_CURRENCIES.map(c => (
                        <SelectItem key={c.code} value={c.code} className="text-xs">
                          {c.code} — {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Exchange Rate (1 {exportCurrency} = ₹)</Label>
                  <Input
                    type="number"
                    value={exchangeRate}
                    onChange={e => setExchangeRate(Number(e.target.value))}
                    disabled={isLocked}
                    className="h-8 text-xs"
                    min={0}
                    step={0.01}
                  />
                </div>
              </div>
              {isExportWithoutIGST && (
                <div>
                  <Label className="text-xs">LUT / Bond Number <span className="text-destructive">*</span></Label>
                  <Input
                    value={lutNumber}
                    onChange={e => setLutNumber(e.target.value)}
                    placeholder="e.g., AD240124012345G"
                    disabled={isLocked}
                    className="h-8 text-xs"
                  />
                  <p className="text-[10px] text-muted-foreground mt-1">Mandatory for zero-rated supply without IGST</p>
                </div>
              )}
              {grandTotal > 0 && Number(exchangeRate) > 0 && (
                <div className="text-xs text-orange-700 dark:text-orange-300 border-t border-orange-200 pt-2">
                  {exportCurrency} {grandTotal.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                  {" "}× ₹{Number(exchangeRate).toLocaleString("en-IN")} = <strong>₹{inrGrandTotal.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</strong>
                </div>
              )}
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
                {/* Place of Supply removed from invoice display */}
              </div>
            )}
            {/* Show Logo toggle removed per user request */}
          </div>

          <Separator />

          {/* Client */}
          <div>
            <Label className="text-xs font-semibold text-muted-foreground uppercase mb-2 block">Bill To (Client)</Label>
            <SearchableSelect
              options={clients.map(c => ({
                value: c.id,
                label: `${c.name} (${c.pan})${((c as any).deleted_at != null || (c as any).is_active === false) ? " — Archived" : ""}`,
              }))}
              value={clientId}
              onValueChange={setClientId}
              placeholder="Select client"
              searchPlaceholder="Search client..."
              disabled={isLocked}
              className="w-full"
            />
            {/* Multi-GSTIN Picker — shown only when client has 2+ GSTINs */}
            {clientId && clientGstins.length > 1 && (
              <div className="mt-2">
                <Label className="text-xs text-muted-foreground mb-1 block">Bill from which GSTIN?</Label>
                <Select
                  value={toGstin}
                  onValueChange={setToGstin}
                  disabled={isLocked}
                >
                  <SelectTrigger className="text-xs">
                    <SelectValue placeholder="Select GSTIN to bill from" />
                  </SelectTrigger>
                  <SelectContent>
                    {clientGstins.map((g) => {
                      const stateName = clientGstinStates[g] || getStateFromGstin(g)?.name || "";
                      return (
                        <SelectItem key={g} value={g} className="text-xs">
                          <span className="font-mono">{g}</span>
                          {stateName && <span className="ml-2 text-muted-foreground">— {stateName}</span>}
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              </div>
            )}
            {clientId && (
              <div className="grid grid-cols-2 gap-2 mt-2">
                <Input value={toName} onChange={e => setToName(e.target.value)} placeholder="Customer Name" disabled={isLocked} />
                {/* Single-GSTIN clients: editable input as before; multi-GSTIN: readonly (controlled by picker above) */}
                <div>
                  <Input
                    value={toGstin}
                    onChange={e => setToGstin(e.target.value)}
                    placeholder="GSTIN"
                    disabled={isLocked || clientGstins.length > 1}
                    className={cn(clientGstins.length > 1 ? "bg-muted/40" : "", toGstin && !isValidGstin(toGstin) ? "border-destructive" : "")}
                  />
                  {toGstin && !isValidGstin(toGstin) && (
                    <p className="text-[10px] text-destructive mt-0.5">Invalid GSTIN format</p>
                  )}
                </div>
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
                        .select("id, status")
                        .eq("invoice_no", invoiceNo.trim())
                        .eq("firm_id", selectedFirmId)
                        .neq("id", invoiceId || "00000000-0000-0000-0000-000000000000")
                        .limit(1);
                      // A cancelled document keeps its number, so it still counts as taken.
                      if (data && data.length > 0) setDuplicateWarning(isCancelled(data[0].status)
                        ? "This number belongs to a cancelled document and cannot be reused."
                        : "This number already exists!");
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
                {/* Root-cause fix (2026-08-11): a client with no GSTIN gets an
                    editable state picker (defaulting to their registered_state
                    when resolvable) instead of a locked field permanently
                    showing the firm's own state. A client WITH a GSTIN is
                    unchanged — GST law ties place of supply to the GSTIN
                    there, so it stays derived-only. */}
                {clientGstins.length > 1 && !toGstin ? (
                  // Multi-GSTIN client, no GSTIN picked yet: let the user drive the
                  // pick by STATE instead of only via "Bill from which GSTIN?" above.
                  // Options are this client's own GSTINs (never the generic 36-state
                  // list), so picking one sets toGstin directly — same variable the
                  // GSTIN dropdown sets — and everything downstream (address autofill,
                  // derived placeOfSupply) already reacts to toGstin unchanged.
                  <Select
                    value=""
                    onValueChange={setToGstin}
                    disabled={isLocked}
                  >
                    <SelectTrigger className="text-xs h-9">
                      <SelectValue placeholder="Select state" />
                    </SelectTrigger>
                    <SelectContent>
                      {clientGstins.map(g => {
                        const stateName = clientGstinStates[g] || getStateFromGstin(g)?.name || "";
                        return (
                          <SelectItem key={g} value={g} className="text-xs">
                            {stateName || "Unknown state"} <span className="ml-2 text-muted-foreground font-mono">{g}</span>
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                ) : !toGstin ? (
                  <Select
                    value={noGstinStateCode}
                    onValueChange={setManualPlaceOfSupplyCode}
                    disabled={isLocked}
                  >
                    <SelectTrigger className="text-xs h-9">
                      <SelectValue placeholder="Select state" />
                    </SelectTrigger>
                    <SelectContent>
                      {STATE_OPTIONS.map(s => (
                        <SelectItem key={s.code} value={s.code}>{s.code}-{s.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input value={placeOfSupply} readOnly className="bg-muted text-xs" />
                )}
              </div>
            </div>
          </div>

          {/* Document History — Converted from link */}
          {isEdit && sourceDocInfo && (
            <div className="border border-border rounded-md p-3 bg-muted/30">
              <p className="text-xs font-semibold text-muted-foreground uppercase mb-1">Converted from</p>
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-sm font-medium capitalize">{sourceDocInfo.document_type === "quotation" ? "Quotation" : sourceDocInfo.document_type === "proforma" ? "Proforma Invoice" : sourceDocInfo.document_type}</span>
                  <span className="text-sm font-mono ml-2">{sourceDocInfo.invoice_no}</span>
                </div>
                <div className="text-xs text-muted-foreground">
                  {sourceDocInfo.invoice_date ? format(new Date(sourceDocInfo.invoice_date), "dd/MM/yyyy") : ""} · ₹{(sourceDocInfo.total_amount || 0).toLocaleString("en-IN")}
                </div>
              </div>
              <Button variant="link" size="sm" className="p-0 h-auto text-xs mt-1" onClick={() => navigate(`/billing/edit/${sourceDocumentId}`)}>
                View source document →
              </Button>
            </div>
          )}

          {/* Audit Client Turnover Info Bar — internal view only, not in PDF */}
          {isAuditClient && baseTurnover && Number(baseTurnover) > 0 && isEdit && (
            <div className="rounded-md border border-border bg-muted/50 px-4 py-2 flex items-center gap-2">
              <Badge variant="outline" className="text-[10px]">Audit Client</Badge>
              <span className="text-xs text-muted-foreground">Turnover: ₹{Number(baseTurnover).toLocaleString("en-IN")}</span>
            </div>
          )}

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

          {/* Audit Billing — Turnover Reference Panel */}
          {isAuditClient && (
            <div className="rounded-lg border border-border bg-muted/40 p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className="text-xs">Audit Billing</Badge>
                <span className="text-xs text-muted-foreground">Turnover Reference</span>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Base Turnover (Reference Only — Not Printed on Invoice)</Label>
                <Input type="number" value={baseTurnover} onChange={e => setBaseTurnover(e.target.value)} placeholder="₹ Enter turnover" disabled={isLocked} className="max-w-xs" />
                {baseTurnover && Number(baseTurnover) > 0 && (
                  <p className="text-xs text-muted-foreground font-medium">₹{Number(baseTurnover).toLocaleString("en-IN")}</p>
                )}
              </div>
              {baseTurnover && Number(baseTurnover) > 0 && (
                <div className="rounded border border-border bg-background p-3 space-y-1">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Suggested Fee Scale (Reference Only)</p>
                  {(() => {
                    const t = Number(baseTurnover);
                    const scales = [
                      { max: 10000000, label: "Up to ₹1 Cr", range: "₹25,000 – ₹50,000" },
                      { max: 50000000, label: "₹1 Cr – ₹5 Cr", range: "₹50,000 – ₹1,00,000" },
                      { max: 250000000, label: "₹5 Cr – ₹25 Cr", range: "₹1,00,000 – ₹2,50,000" },
                      { max: Infinity, label: "Above ₹25 Cr", range: "₹2,50,000 and above" },
                    ];
                    return scales.map((s, i) => {
                      const isActive = i === 0 ? t <= s.max : t <= s.max && t > (scales[i - 1]?.max || 0);
                      return (
                        <div key={i} className={`flex justify-between text-xs px-2 py-1 rounded ${isActive ? "bg-primary/10 text-primary font-semibold" : "text-muted-foreground"}`}>
                          <span>{s.label}</span>
                          <span>{s.range}</span>
                        </div>
                      );
                    });
                  })()}
                  <p className="text-[10px] text-muted-foreground mt-1 italic">These ranges are indicative only. The actual billing amount is fully editable below.</p>
                </div>
              )}
              <p className="text-[10px] text-muted-foreground">Manual Override — final amount to be billed in line items below</p>
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
                      <Label className="text-[10px]">Rate {isExport ? `(${exportCurrency})` : ""}</Label>
                      <Input type="number" value={item.rate || ""} onChange={e => updateLine(idx, "rate", Number(e.target.value))} className="text-xs h-8" disabled={isLocked} />
                    </div>
                    {firmHasGst && !isExportWithoutIGST && (
                      <div>
                        <Label className="text-[10px]">GST %</Label>
                        <Input type="number" value={item.gst_percent || ""} onChange={e => updateLine(idx, "gst_percent", Number(e.target.value))} className="text-xs h-8" disabled={isLocked} />
                      </div>
                    )}
                    <div>
                      <Label className="text-[10px]">Total {isExport ? `(${exportCurrency})` : ""}</Label>
                      <div className="text-xs font-semibold pt-2 text-right">
                        {isExport
                          ? `${exportCurrency} ${(firmHasGst && !isExportWithoutIGST ? item.total : item.taxable_value).toLocaleString("en-US", { minimumFractionDigits: 2 })}`
                          : fmtINR(firmHasGst ? item.total : item.taxable_value)
                        }
                      </div>
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

          {/* Payment due days — drives the "PAYMENT IS DUE WITHIN N DAYS" line */}
          <div>
            <Label className="text-xs">Payment Due (days)</Label>
            <Input
              type="number"
              min={0}
              value={paymentDueDays}
              onChange={e => setPaymentDueDays(Math.max(0, Number(e.target.value) || 0))}
              placeholder="45"
              className="text-sm max-w-[120px]"
              disabled={isLocked}
            />
            <p className="text-[11px] text-muted-foreground mt-1">
              Prints as “PAYMENT IS DUE WITHIN {paymentDueDays} DAYS FROM THE INVOICE DATE”.
            </p>
          </div>

          <Separator />

          {/* Totals */}
          <div className="flex flex-col gap-3">
            {/* TDS Section Selector (Change 2 & 3) */}
            {docType === "invoice" && (
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground font-medium">TDS Section (if applicable)</Label>
                <Select
                  value={tdsSectionCode || "_none"}
                  onValueChange={v => {
                    const actual = v === "_none" ? "" : v;
                    setTdsSectionCode(actual);
                    const found = tdsRates.find(t => t.section_code === actual);
                    setTdsRate(found ? Number(found.rate) : 0);
                  }}
                  disabled={isLocked}
                >
                  <SelectTrigger className="w-full text-sm h-9">
                    <SelectValue placeholder="No TDS deduction" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_none">No TDS deduction</SelectItem>
                    {tdsRates.map(t => (
                      <SelectItem key={t.section_code} value={t.section_code}>
                        {t.section_code} — {t.description} ({t.rate}%)
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Amount summary */}
            <div className="text-sm space-y-1 text-right">
              {isExport ? (
                <>
                  <p>Taxable Amount ({exportCurrency}): <strong>{exportCurrency} {totalTaxable.toLocaleString("en-US", { minimumFractionDigits: 2 })}</strong></p>
                  {isExportWithIGST && firmHasGst && totalGst > 0 && (
                    <p>IGST ({exportCurrency}): <strong>{exportCurrency} {totalGst.toLocaleString("en-US", { minimumFractionDigits: 2 })}</strong></p>
                  )}
                  {isExportWithoutIGST && (
                    <p className="text-xs text-orange-600">Zero-rated — No IGST (LUT/Bond)</p>
                  )}
                  <p className="text-base font-bold">Grand Total ({exportCurrency}): {exportCurrency} {grandTotal.toLocaleString("en-US", { minimumFractionDigits: 2 })}</p>
                  <p className="text-xs text-muted-foreground">@ ₹{Number(exchangeRate).toLocaleString("en-IN")} per {exportCurrency}</p>
                  <p className="text-lg font-bold text-foreground border-t pt-1">INR Equivalent: {fmtINR(inrGrandTotal)}</p>
                </>
              ) : (
                <>
                  <p>Taxable Amount: <strong>{fmtINR(totalTaxable)}</strong></p>
                  {firmHasGst && (
                    effectiveIsIntraState ? (
                      <>
                        <p>CGST: <strong>{fmtINR(totalGst / 2)}</strong></p>
                        <p>SGST: <strong>{fmtINR(totalGst / 2)}</strong></p>
                      </>
                    ) : (
                      <p>IGST: <strong>{fmtINR(totalGst)}</strong></p>
                    )
                  )}
                  <p className="text-lg font-bold text-foreground">Grand Total: {fmtINR(grandTotal)}</p>
                </>
              )}
              {tdsAmount > 0 && (
                <p className="text-sm text-orange-600 font-medium">
                  TDS Deductible u/s {tdsSectionCode} @ {tdsRate}%: <strong>— {fmtINR(tdsAmount)}</strong>
                </p>
              )}
              {tdsAmount > 0 && (
                <p className="text-sm font-semibold text-foreground">
                  Net Receivable after TDS: {fmtINR(inrGrandTotal - tdsAmount)}
                </p>
              )}
              <p className="text-xs text-muted-foreground italic">{numberToWords(Math.round(isExport ? inrGrandTotal : grandTotal))}</p>
            </div>
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
            <AlertDialogDescription>Once finalized, the document will be marked as finalized. You can still edit it if needed.</AlertDialogDescription>
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
