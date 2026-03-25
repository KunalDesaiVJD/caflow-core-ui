import { useState, useEffect, useCallback, useMemo } from "react";
import ReceiptsTabComponent from "@/components/billing/ReceiptsTab";
import LedgerTabComponent from "@/components/billing/LedgerTab";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { format, startOfWeek, addDays, isSameDay, startOfMonth, endOfMonth, parseISO, differenceInDays } from "date-fns";
import { cn } from "@/lib/utils";
import {
  Plus, IndianRupee, Clock, AlertTriangle, FileText, Send,
  CheckCircle2, Eye, Copy, Trash2, ChevronLeft, ChevronRight,
  BarChart3, Percent, Upload, Download, Pencil, Settings2,
  Receipt, BookOpen, FileSpreadsheet, Bell, Mail, MessageSquare,
  Archive, ChevronDown, User,
} from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";
import * as XLSX from "xlsx";
import JSZip from "jszip";

// ─── Types ───
interface Invoice {
  id: string;
  invoice_no: string | null;
  client_id: string | null;
  firm_id: string | null;
  amount: number | null;
  gst_amount: number | null;
  total_amount: number | null;
  status: string | null;
  due_date: string | null;
  invoice_date: string | null;
  invoice_format: string | null;
  subject: string | null;
  paid_at: string | null;
  sent_at: string | null;
  created_at?: string | null;
  document_type?: string | null;
  document_series?: string | null;
  seq_number?: number | null;
  financial_year?: string | null;
}

interface ClientMap {
  [id: string]: { name: string; entity_type: string | null };
}

interface FirmMap {
  [id: string]: string;
}

interface TimesheetEntry {
  id: string;
  user_id: string | null;
  client_id: string | null;
  engagement_id: string | null;
  work_date: string | null;
  description: string | null;
  hours: number | null;
  billable: boolean | null;
  is_billable: boolean | null;
  is_invoiced: boolean | null;
  approved_by: string | null;
  service_category_id: string | null;
  minutes: number | null;
}

interface ClientOption { id: string; name: string | null; }
interface UserOption { id: string; name: string | null; }

interface ItemMaster {
  id: string;
  description: string;
  hsn_sac_code: string | null;
  default_rate: number | null;
}

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  finalized: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
  sent: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300",
  paid: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
  overdue: "bg-destructive/15 text-destructive",
  converted: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
};

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const fmtINR = (n: number) => "\u20B9" + n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ─── Shared Filter Bar ───
function DocumentFilterBar({
  search, setSearch, statusFilter, setStatusFilter,
  firmFilter, setFirmFilter, groupFilter, setGroupFilter,
  responsibleFilter, setResponsibleFilter, multiFirmFilter, setMultiFirmFilter,
  firms, groups, responsiblePersons,
  statusOptions,
}: {
  search: string; setSearch: (v: string) => void;
  statusFilter: string; setStatusFilter: (v: string) => void;
  firmFilter: string; setFirmFilter: (v: string) => void;
  groupFilter: string; setGroupFilter: (v: string) => void;
  responsibleFilter: string; setResponsibleFilter: (v: string) => void;
  multiFirmFilter: string[]; setMultiFirmFilter: (v: string[]) => void;
  firms: { id: string; name: string }[];
  groups: { id: string; name: string }[];
  responsiblePersons: { id: string; name: string }[];
  statusOptions: string[];
}) {
  return (
    <div className="flex flex-wrap gap-3 items-end">
      <Select value={firmFilter} onValueChange={v => { setFirmFilter(v); setGroupFilter("all"); setResponsibleFilter("all"); }}>
        <SelectTrigger className="w-[160px]"><SelectValue placeholder="All Firms" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Firms</SelectItem>
          {firms.map(f => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}
        </SelectContent>
      </Select>
      <Select value={groupFilter} onValueChange={v => { setGroupFilter(v); setFirmFilter("all"); setResponsibleFilter("all"); }}>
        <SelectTrigger className="w-[160px]"><SelectValue placeholder="All Groups" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Groups</SelectItem>
          {groups.map(g => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
        </SelectContent>
      </Select>
      <Select value={responsibleFilter} onValueChange={v => { setResponsibleFilter(v); setFirmFilter("all"); setGroupFilter("all"); }}>
        <SelectTrigger className="w-[170px]"><SelectValue placeholder="Responsible Person" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Persons</SelectItem>
          {responsiblePersons.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
        </SelectContent>
      </Select>
      <Select value={statusFilter} onValueChange={setStatusFilter}>
        <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Status</SelectItem>
          {statusOptions.map(s => <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>)}
        </SelectContent>
      </Select>
      <Input placeholder="Search number, client, or firm..." value={search} onChange={e => setSearch(e.target.value)} className="w-[260px]" />
    </div>
  );
}

const Billing = () => {
  const [activeTab, setActiveTab] = useState("invoices");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Billing & Timesheet</h1>
        <p className="text-sm text-muted-foreground">Invoices, quotations, credit notes, time tracking, and revenue reports</p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="flex-wrap">
          <TabsTrigger value="invoices" className="gap-2"><FileText size={14} /> Invoices</TabsTrigger>
          <TabsTrigger value="quotations" className="gap-2"><FileSpreadsheet size={14} /> Quotations & Proforma</TabsTrigger>
          <TabsTrigger value="credit-notes" className="gap-2"><FileText size={14} /> Credit Notes</TabsTrigger>
          <TabsTrigger value="timesheet" className="gap-2"><Clock size={14} /> Timesheet</TabsTrigger>
          <TabsTrigger value="receipts" className="gap-2"><Receipt size={14} /> Receipts</TabsTrigger>
          <TabsTrigger value="ledger" className="gap-2"><BookOpen size={14} /> Ledger</TabsTrigger>
          <TabsTrigger value="item-master" className="gap-2"><Settings2 size={14} /> Item Master</TabsTrigger>
          <TabsTrigger value="reports" className="gap-2"><BarChart3 size={14} /> Reports</TabsTrigger>
        </TabsList>

        <TabsContent value="invoices"><DocumentListTab documentType="invoice" /></TabsContent>
        <TabsContent value="quotations"><DocumentListTab documentType="quotation_proforma" /></TabsContent>
        <TabsContent value="credit-notes"><DocumentListTab documentType="credit_note" /></TabsContent>
        <TabsContent value="timesheet"><TimesheetTab /></TabsContent>
        <TabsContent value="receipts"><ReceiptsTab /></TabsContent>
        <TabsContent value="ledger"><LedgerTabComponent /></TabsContent>
        <TabsContent value="item-master"><ItemMasterTab /></TabsContent>
        <TabsContent value="reports"><ReportsTab /></TabsContent>
      </Tabs>
    </div>
  );
};

// ═══════════════════════════════════════
// DOCUMENT LIST TAB (Invoices / Quotations & Proforma / Credit Notes)
// ═══════════════════════════════════════
function DocumentListTab({ documentType }: { documentType: "invoice" | "quotation_proforma" | "credit_note" }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();
  const isSuperadmin = user?.role === "superadmin";
  const firmId = user?.firm_id;

  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [clientMap, setClientMap] = useState<ClientMap>({});
  const [firmMap, setFirmMap] = useState<FirmMap>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [firmFilter, setFirmFilter] = useState("all");
  const [groupFilter, setGroupFilter] = useState("all");
  const [responsibleFilter, setResponsibleFilter] = useState("all");
  const [multiFirmFilter, setMultiFirmFilter] = useState<string[]>([]);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  // For filter dropdowns
  const [firms, setFirms] = useState<{ id: string; name: string }[]>([]);
  const [groups, setGroups] = useState<{ id: string; name: string }[]>([]);
  const [responsiblePersons, setResponsiblePersons] = useState<{ id: string; name: string }[]>([]);
  const [groupClientIds, setGroupClientIds] = useState<string[]>([]);
  const [responsibleClientIds, setResponsibleClientIds] = useState<string[]>([]);

  // Bulk selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkSendOpen, setBulkSendOpen] = useState(false);
  const [bulkSendMode, setBulkSendMode] = useState<"email" | "whatsapp">("email");
  const [bulkSendTarget, setBulkSendTarget] = useState<"client" | "responsible" | "both">("client");
  const [bulkSending, setBulkSending] = useState(false);
  const [bulkProgress, setBulkProgress] = useState({ current: 0, total: 0 });

  // Billing reminders
  const [reminders, setReminders] = useState<any[]>([]);
  const [reminderClientMap, setReminderClientMap] = useState<Record<string, string>>({});

  const docTypeFilter = useMemo(() => {
    if (documentType === "invoice") return ["invoice"];
    if (documentType === "quotation_proforma") return ["quotation", "proforma"];
    return ["credit_note"];
  }, [documentType]);

  const tabLabel = documentType === "invoice" ? "Invoice" : documentType === "quotation_proforma" ? "Quotation / Proforma" : "Credit Note";
  const newDocType = documentType === "invoice" ? "invoice" : documentType === "quotation_proforma" ? "quotation" : "credit_note";

  const fetchData = useCallback(async () => {
    setLoading(true);

    // Update overdue invoices in DB before fetching
    if (documentType === "invoice" && firmId) {
      await supabase.rpc("update_overdue_invoices", { p_firm_id: firmId });
    }

    let iQuery = supabase.from("invoices").select("*").in("document_type", docTypeFilter).order("invoice_date", { ascending: false });
    if (!isSuperadmin && firmId) iQuery = iQuery.eq("firm_id", firmId);
    if (firmFilter !== "all") iQuery = iQuery.eq("firm_id", firmFilter);
    const { data: invData } = await iQuery;

    let cQuery = supabase.from("clients").select("id, name, entity_type").eq("is_draft", false).is("deleted_at", null);
    if (!isSuperadmin && firmId) cQuery = cQuery.eq("firm_id", firmId);
    const { data: clientData } = await cQuery;

    const { data: firmData } = await supabase.from("firms").select("id, name, display_name");
    const { data: groupData } = await supabase.from("client_groups").select("id, name");
    // Load firm-scoped active users for Responsible Person filter
    let usersQuery = supabase.from("users").select("id, name").eq("is_active", true).order("name");
    if (!isSuperadmin && firmId) usersQuery = usersQuery.eq("firm_id", firmId);
    const { data: usersData } = await usersQuery;

    const cMap: ClientMap = {};
    (clientData || []).forEach(c => { cMap[c.id] = { name: c.name || "Unknown", entity_type: c.entity_type }; });

    const fMap: FirmMap = {};
    (firmData || []).forEach((f: any) => { fMap[f.id] = f.display_name || f.name || "Unknown"; });

    setInvoices((invData as Invoice[]) || []);
    setClientMap(cMap);
    setFirmMap(fMap);
    setFirms((firmData || []).map((f: any) => ({ id: f.id, name: f.display_name || f.name })));
    setGroups((groupData || []).map((g: any) => ({ id: g.id, name: g.name })));
    setResponsiblePersons((usersData || []).map((u: any) => ({ id: u.id, name: u.name })));
    setLoading(false);
  }, [firmId, isSuperadmin, docTypeFilter, firmFilter, documentType]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Fetch billing reminders (only for invoices tab)
  useEffect(() => {
    if (documentType !== "invoice" || !firmId) return;
    (async () => {
      const today = format(new Date(), "yyyy-MM-dd");
      const { data } = await supabase.from("billing_reminders")
        .select("*")
        .eq("firm_id", firmId)
        .eq("status", "pending")
        .lte("next_due_date", today);
      if (data && data.length > 0) {
        setReminders(data);
        const clientIds = [...new Set(data.map((r: any) => r.client_id).filter(Boolean))];
        if (clientIds.length > 0) {
          const { data: clients } = await supabase.from("clients").select("id, name").in("id", clientIds);
          const map: Record<string, string> = {};
          (clients || []).forEach((c: any) => { map[c.id] = c.name || "Unknown"; });
          setReminderClientMap(map);
        }
      } else {
        setReminders([]);
      }
    })();
  }, [documentType, firmId]);

  // Fetch group client ids when group filter changes
  useEffect(() => {
    if (groupFilter === "all") { setGroupClientIds([]); return; }
    (async () => {
      const { data } = await supabase.from("client_group_memberships").select("client_id").eq("group_id", groupFilter);
      setGroupClientIds((data || []).map((d: any) => d.client_id));
    })();
  }, [groupFilter]);

  // Fetch responsible person client ids
  useEffect(() => {
    if (responsibleFilter === "all") { setResponsibleClientIds([]); return; }
    (async () => {
      const { data } = await supabase.from("clients").select("id").eq("responsible_person_id", responsibleFilter).eq("is_draft", false).is("deleted_at", null);
      setResponsibleClientIds((data || []).map((d: any) => d.id));
    })();
  }, [responsibleFilter]);

  const enriched = useMemo(() => {
    return invoices.map(inv => ({ ...inv, effectiveStatus: inv.status || "draft" }));
  }, [invoices]);

  const stats = useMemo(() => {
    const outstanding = enriched.filter(i => !["paid", "voided", "converted"].includes(i.effectiveStatus))
      .reduce((s, i) => s + (i.total_amount || i.amount || 0), 0);
    const collected = enriched.filter(i => i.effectiveStatus === "paid")
      .reduce((s, i) => s + (i.total_amount || i.amount || 0), 0);
    const overdue = enriched.filter(i => i.effectiveStatus === "overdue").length;
    const drafts = enriched.filter(i => i.effectiveStatus === "draft").length;
    return { outstanding, collected, overdue, drafts };
  }, [enriched]);

  const filtered = useMemo(() => enriched.filter(inv => {
    if (statusFilter !== "all" && inv.effectiveStatus !== statusFilter) return false;
    if (groupFilter !== "all" && !groupClientIds.includes(inv.client_id || "")) return false;
    if (responsibleFilter !== "all" && !responsibleClientIds.includes(inv.client_id || "")) return false;
    if (search) {
      const s = search.toLowerCase();
      const cn = clientMap[inv.client_id || ""]?.name || "";
      const fn = firmMap[inv.firm_id || ""] || "";
      if (!(inv.invoice_no || "").toLowerCase().includes(s) &&
        !cn.toLowerCase().includes(s) &&
        !fn.toLowerCase().includes(s)) return false;
    }
    return true;
  }), [enriched, statusFilter, search, clientMap, firmMap, groupFilter, groupClientIds, responsibleFilter, responsibleClientIds]);

  const handleDelete = async () => {
    if (!deleteId) return;
    const { error } = await supabase.from("invoices").delete().eq("id", deleteId);
    if (error) {
      toast({ title: "Error deleting document", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Document deleted" });
    }
    setDeleteId(null);
    fetchData();
  };

  const handleSend = async (inv: Invoice, sendToResponsible = false) => {
    const total = inv.total_amount || (inv.amount || 0) + (inv.gst_amount || 0);
    const notifType = sendToResponsible ? "internal_filing_reminder"
      : inv.document_type === "credit_note" ? "credit_note_issued"
      : inv.document_type === "quotation" ? "quotation_sent"
      : inv.document_type === "proforma" ? "proforma_sent"
      : "invoice_generated";

    try {
      await supabase.functions.invoke("send-notification", {
        body: {
          type: notifType,
          firm_id: inv.firm_id,
          client_id: inv.client_id,
          send_to_client: !sendToResponsible,
          send_to_responsible: sendToResponsible,
          payload: {
            invoice_no: inv.invoice_no,
            amount: total,
            document_type: inv.document_type || "invoice",
            client_name: clientMap[inv.client_id || ""]?.name || "",
          },
        },
      });
    } catch {
      toast({ title: sendToResponsible ? "Notification could not be confirmed." : "Invoice marked as sent. Notification delivery could not be confirmed." });
    }

    if (!sendToResponsible) {
      await supabase.from("invoices").update({ status: "sent", sent_at: new Date().toISOString() }).eq("id", inv.id);
      toast({ title: "Document sent" });
    } else {
      toast({ title: "Responsible person notified" });
    }
    fetchData();
  };

  // Bulk send handler
  const handleBulkSend = async () => {
    const selected = filtered.filter(inv => selectedIds.has(inv.id));
    if (selected.length === 0) return;
    setBulkSending(true);
    setBulkProgress({ current: 0, total: selected.length });

    let sentCount = 0;
    for (const inv of selected) {
      setBulkProgress(p => ({ ...p, current: p.current + 1 }));
      const total = inv.total_amount || (inv.amount || 0) + (inv.gst_amount || 0);
      const notifType = inv.document_type === "credit_note" ? "credit_note_issued"
        : inv.document_type === "quotation" ? "quotation_sent"
        : inv.document_type === "proforma" ? "proforma_sent"
        : "invoice_generated";

      try {
        await supabase.functions.invoke("send-notification", {
          body: {
            type: notifType,
            firm_id: inv.firm_id,
            client_id: inv.client_id,
            send_to_client: bulkSendTarget === "client" || bulkSendTarget === "both",
            send_to_responsible: bulkSendTarget === "responsible" || bulkSendTarget === "both",
            payload: {
              invoice_no: inv.invoice_no,
              amount: total,
              document_type: inv.document_type || "invoice",
            },
          },
        });
        sentCount++;
      } catch { /* continue */ }
    }

    toast({ title: `Sent to ${sentCount} recipients` });
    setBulkSending(false);
    setBulkSendOpen(false);
    setSelectedIds(new Set());
    fetchData();
  };

  // Bulk download ZIP
  const handleBulkDownloadZip = async () => {
    const selected = filtered.filter(inv => selectedIds.has(inv.id));
    if (selected.length === 0) return;
    toast({ title: "Generating ZIP..." });

    const zip = new JSZip();
    for (const inv of selected) {
      const clientName = clientMap[inv.client_id || ""]?.name || "Unknown";
      const safeNo = (inv.invoice_no || "doc").replace(/\//g, "-");
      const safeName = clientName.replace(/[^a-zA-Z0-9]/g, "_");
      // Generate a simple HTML receipt as PDF placeholder
      const content = `Invoice: ${inv.invoice_no}\nClient: ${clientName}\nAmount: ${inv.total_amount || inv.amount || 0}\nDate: ${inv.invoice_date || ""}`;
      zip.file(`${safeNo}_${safeName}.txt`, content);
    }

    const blob = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `documents_${format(new Date(), "yyyyMMdd")}.zip`;
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: `Downloaded ${selected.length} documents` });
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filtered.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filtered.map(i => i.id)));
    }
  };

  const statusOptions = documentType === "invoice"
    ? ["draft", "finalized", "sent", "paid", "overdue"]
    : documentType === "quotation_proforma"
      ? ["draft", "finalized", "sent", "converted"]
      : ["draft", "finalized", "sent", "paid"];

  return (
    <div className="space-y-4">
      {/* Billing Reminders (invoices tab only) */}
      {documentType === "invoice" && reminders.length > 0 && (
        <Card className="border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20">
          <CardHeader className="pb-2 pt-3 px-4">
            <CardTitle className="text-sm font-semibold flex items-center gap-2 text-amber-700 dark:text-amber-400">
              <Bell size={16} /> Billing Reminders Due ({reminders.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3 pt-0">
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {reminders.map((r: any) => (
                <div key={r.id} className="flex items-center justify-between border rounded-lg p-3 bg-background">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{reminderClientMap[r.client_id] || "Client"}</p>
                    <p className="text-xs text-muted-foreground">₹{Number(r.billing_amount || 0).toLocaleString("en-IN")} · Due {r.next_due_date ? format(new Date(r.next_due_date), "dd MMM") : "—"}</p>
                  </div>
                  <div className="flex items-center gap-2 ml-2">
                    <Badge variant="outline" className={cn("text-[10px]", r.invoice_gen_type === "auto" ? "border-blue-300 text-blue-600" : "border-orange-300 text-orange-600")}>
                      {r.invoice_gen_type === "auto" ? "Auto" : "Reminder"}
                    </Badge>
                    {r.invoice_gen_type === "reminder" ? (
                      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => navigate(`/billing/new?type=invoice&client=${r.client_id}&amount=${r.billing_amount}`)}>
                        Create Invoice
                      </Button>
                    ) : (
                      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => navigate(`/billing?tab=invoices`)}>
                        View Draft
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: "Outstanding", value: `₹${stats.outstanding.toLocaleString("en-IN")}`, icon: IndianRupee },
          { label: "Collected", value: `₹${stats.collected.toLocaleString("en-IN")}`, icon: CheckCircle2 },
          { label: "Overdue", value: stats.overdue, icon: AlertTriangle },
          { label: "Drafts", value: stats.drafts, icon: FileText },
        ].map(s => (
          <Card key={s.label}><CardContent className="p-4 flex items-center gap-3">
            <s.icon size={18} className="text-muted-foreground" />
            <div>
              <p className="text-xs text-muted-foreground">{s.label}</p>
              <p className="text-lg font-bold text-foreground">{s.value}</p>
            </div>
          </CardContent></Card>
        ))}
      </div>

      {/* Bulk actions bar */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-2 p-3 bg-accent/50 rounded-lg border">
          <span className="text-sm font-medium">{selectedIds.size} selected</span>
          <div className="flex-1" />
          <Button size="sm" variant="outline" className="gap-1" onClick={() => { setBulkSendMode("email"); setBulkSendOpen(true); }}>
            <Mail size={14} /> Send via Email
          </Button>
          <Button size="sm" variant="outline" className="gap-1" onClick={() => { setBulkSendMode("whatsapp"); setBulkSendOpen(true); }}>
            <MessageSquare size={14} /> Send via WhatsApp
          </Button>
          <Button size="sm" variant="outline" className="gap-1" onClick={handleBulkDownloadZip}>
            <Archive size={14} /> Download ZIP
          </Button>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-end">
        <DocumentFilterBar
          search={search} setSearch={setSearch}
          statusFilter={statusFilter} setStatusFilter={setStatusFilter}
          firmFilter={firmFilter} setFirmFilter={setFirmFilter}
          groupFilter={groupFilter} setGroupFilter={setGroupFilter}
          responsibleFilter={responsibleFilter} setResponsibleFilter={setResponsibleFilter}
          multiFirmFilter={multiFirmFilter} setMultiFirmFilter={setMultiFirmFilter}
          firms={firms} groups={groups} responsiblePersons={responsiblePersons}
          statusOptions={statusOptions}
        />
        <div className="flex-1" />
        <Button onClick={() => navigate(`/billing/new?type=${newDocType}`)} className="gap-1"><Plus size={14} /> New {tabLabel}</Button>
      </div>

      {/* Table */}
      <Card><CardContent className="p-0">
        {loading ? (
          <div className="p-6 space-y-3">{[1, 2, 3].map(i => <Skeleton key={i} className="h-12 w-full" />)}</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox
                    checked={filtered.length > 0 && selectedIds.size === filtered.length}
                    onCheckedChange={toggleSelectAll}
                  />
                </TableHead>
                <TableHead>Doc No</TableHead>
                {documentType === "quotation_proforma" && <TableHead>Type</TableHead>}
                <TableHead>Client</TableHead>
                <TableHead>Firm</TableHead>
                <TableHead>Date</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Due Date</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow><TableCell colSpan={documentType === "quotation_proforma" ? 10 : 9} className="text-center text-muted-foreground py-8">No documents found.</TableCell></TableRow>
              ) : filtered.map(inv => {
                const clientName = clientMap[inv.client_id || ""]?.name || "—";
                const firmName = firmMap[inv.firm_id || ""] || "—";
                const total = inv.total_amount || (inv.amount || 0) + (inv.gst_amount || 0);
                return (
                  <TableRow key={inv.id} className={cn(selectedIds.has(inv.id) && "bg-accent/30")}>
                    <TableCell>
                      <Checkbox
                        checked={selectedIds.has(inv.id)}
                        onCheckedChange={() => toggleSelect(inv.id)}
                      />
                    </TableCell>
                    <TableCell className="font-mono text-sm">{inv.invoice_no || "—"}</TableCell>
                    {documentType === "quotation_proforma" && (
                      <TableCell>
                        <Badge variant="outline" className="text-xs capitalize">{inv.document_type}</Badge>
                      </TableCell>
                    )}
                    <TableCell className="font-medium">{clientName}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{firmName}</TableCell>
                    <TableCell className="text-sm">{inv.invoice_date ? format(new Date(inv.invoice_date), "dd/MM/yyyy") : "—"}</TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">₹{total.toLocaleString("en-IN")}</TableCell>
                    <TableCell>
                      <Badge className={cn("text-xs capitalize", STATUS_COLORS[inv.effectiveStatus] || STATUS_COLORS.draft)}>{inv.effectiveStatus}</Badge>
                    </TableCell>
                    <TableCell className="text-sm">{inv.due_date ? format(new Date(inv.due_date), "dd/MM/yyyy") : "—"}</TableCell>
                    <TableCell>
                      <div className="flex gap-0.5">
                        <Button variant="ghost" size="icon" className="h-7 w-7" title="View/Edit" onClick={() => navigate(`/billing/edit/${inv.id}`)}>
                          <Eye size={14} />
                        </Button>
                        {(inv.effectiveStatus === "draft" || inv.effectiveStatus === "finalized") && (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-7 w-7" title="Send">
                                <Send size={14} />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => handleSend(inv, false)} className="gap-2">
                                <Mail size={14} /> Send to Client
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => handleSend(inv, true)} className="gap-2">
                                <User size={14} /> Notify Responsible Person
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                        {inv.effectiveStatus !== "paid" && inv.effectiveStatus !== "converted" && (
                          <Button variant="ghost" size="icon" className="h-7 w-7" title="Delete" onClick={() => setDeleteId(inv.id)}>
                            <Trash2 size={14} className="text-destructive" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent></Card>

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Document?</AlertDialogTitle>
            <AlertDialogDescription>This will permanently delete this document. This action cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Bulk send dialog */}
      <Dialog open={bulkSendOpen} onOpenChange={setBulkSendOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send {selectedIds.size} documents via {bulkSendMode === "email" ? "Email" : "WhatsApp"}</DialogTitle>
          </DialogHeader>
          <RadioGroup value={bulkSendTarget} onValueChange={(v: any) => setBulkSendTarget(v)} className="space-y-3 py-2">
            <div className="flex items-center gap-3">
              <RadioGroupItem value="client" id="bulk-client" />
              <Label htmlFor="bulk-client">To Client — sends to each document's client</Label>
            </div>
            <div className="flex items-center gap-3">
              <RadioGroupItem value="responsible" id="bulk-responsible" />
              <Label htmlFor="bulk-responsible">To Responsible Person — internal notification</Label>
            </div>
            <div className="flex items-center gap-3">
              <RadioGroupItem value="both" id="bulk-both" />
              <Label htmlFor="bulk-both">Both — Client and Responsible Person</Label>
            </div>
          </RadioGroup>
          {bulkSending && (
            <p className="text-sm text-muted-foreground">Sending {bulkProgress.current} of {bulkProgress.total}...</p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkSendOpen(false)} disabled={bulkSending}>Cancel</Button>
            <Button onClick={handleBulkSend} disabled={bulkSending} className="gap-1">
              <Send size={14} /> {bulkSending ? "Sending..." : "Send"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ═══════════════════════════════════════
// RECEIPTS TAB (extracted component)
// ═══════════════════════════════════════
function ReceiptsTab() {
  return <ReceiptsTabComponent />;
}

// LedgerTab now imported from @/components/billing/LedgerTab

// ═══════════════════════════════════════
// ITEM MASTER TAB
// ═══════════════════════════════════════
function ItemMasterTab() {
  const { user } = useAuth();
  const { toast } = useToast();

  const [items, setItems] = useState<ItemMaster[]>([]);
  const [loading, setLoading] = useState(true);
  const [desc, setDesc] = useState("");
  const [hsn, setHsn] = useState("");
  const [rate, setRate] = useState("");
  const [saving, setSaving] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editDesc, setEditDesc] = useState("");
  const [editHsn, setEditHsn] = useState("");
  const [editRate, setEditRate] = useState("");

  const fetchItems = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("invoice_item_masters")
      .select("id, description, hsn_sac_code, default_rate")
      .eq("is_active", true)
      .order("description");
    setItems((data as ItemMaster[]) || []);
    setLoading(false);
  }, []);

  useEffect(() => { fetchItems(); }, [fetchItems]);

  const addItem = async () => {
    if (!desc.trim()) return;
    setSaving(true);
    const { error } = await supabase.from("invoice_item_masters").insert({
      firm_id: null,
      description: desc.trim(),
      hsn_sac_code: hsn.trim() || null,
      default_rate: rate ? Number(rate) : null,
      created_by: user?.id,
    });
    if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
    else { setDesc(""); setHsn(""); setRate(""); fetchItems(); toast({ title: "Item added" }); }
    setSaving(false);
  };

  const startEdit = (item: ItemMaster) => {
    setEditId(item.id);
    setEditDesc(item.description);
    setEditHsn(item.hsn_sac_code || "");
    setEditRate(item.default_rate != null ? String(item.default_rate) : "");
  };

  const saveEdit = async () => {
    if (!editId || !editDesc.trim()) return;
    const { error } = await supabase.from("invoice_item_masters").update({
      description: editDesc.trim(), hsn_sac_code: editHsn.trim() || null,
      default_rate: editRate ? Number(editRate) : null,
      firm_id: null,
    }).eq("id", editId);
    if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
    else { setEditId(null); fetchItems(); toast({ title: "Item updated" }); }
  };

  const deleteItem = async (id: string) => {
    await supabase.from("invoice_item_masters").update({ is_active: false }).eq("id", id);
    fetchItems();
    toast({ title: "Item removed" });
  };

  const handleDownloadTemplate = () => {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([
      ["Description", "HSN/SAC Code", "Default Rate"],
      ["Professional Services", "9978", "2000"],
      ["Tax Filing Fees", "9971", "5000"],
    ]);
    ws["!cols"] = [{ wch: 30 }, { wch: 15 }, { wch: 15 }];
    XLSX.utils.book_append_sheet(wb, ws, "Item Masters");
    XLSX.writeFile(wb, "Item_Master_Template.xlsx");
  };

  const handleBulkImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        const data = new Uint8Array(ev.target?.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows: any[] = XLSX.utils.sheet_to_json(ws);
        if (rows.length === 0) { toast({ title: "No rows found", variant: "destructive" }); return; }
        const inserts = rows.map(r => ({
          firm_id: null,
          description: String(r["Description"] || r["description"] || "").trim(),
          hsn_sac_code: String(r["HSN/SAC Code"] || r["hsn_sac_code"] || r["HSN"] || "").trim() || null,
          default_rate: r["Default Rate"] || r["default_rate"] || r["Rate"] ? Number(r["Default Rate"] || r["default_rate"] || r["Rate"]) : null,
          created_by: user?.id,
        })).filter(i => i.description);
        if (inserts.length === 0) { toast({ title: "No valid items found", variant: "destructive" }); return; }
        const { error } = await supabase.from("invoice_item_masters").insert(inserts);
        if (error) toast({ title: "Import error", description: error.message, variant: "destructive" });
        else { toast({ title: `${inserts.length} items imported` }); fetchItems(); }
      } catch (err: any) {
        toast({ title: "Import failed", description: err.message, variant: "destructive" });
      }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = "";
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <p className="text-sm text-muted-foreground">Item Master is shared across all firms.</p>
        <div className="flex-1" />
        <Button variant="outline" size="sm" className="gap-1" onClick={handleDownloadTemplate}>
          <Download size={14} /> Download Template
        </Button>
        <div className="relative">
          <input type="file" accept=".xlsx,.xls" onChange={handleBulkImport} className="absolute inset-0 opacity-0 cursor-pointer" />
          <Button variant="outline" size="sm" className="gap-1 pointer-events-none">
            <Upload size={14} /> Bulk Import
          </Button>
        </div>
      </div>

      {/* Add new item */}
      <Card><CardContent className="p-4">
        <p className="text-sm font-semibold mb-3">Add New Item</p>
        <div className="grid grid-cols-4 gap-2">
          <Input value={desc} onChange={e => setDesc(e.target.value)} placeholder="Description *" />
          <Input value={hsn} onChange={e => setHsn(e.target.value)} placeholder="HSN/SAC" />
          <Input value={rate} onChange={e => setRate(e.target.value)} placeholder="Default Rate" type="number" />
          <Button onClick={addItem} disabled={saving || !desc.trim()} className="gap-1"><Plus size={14} /> Add</Button>
        </div>
      </CardContent></Card>

      {/* Items list */}
      <Card><CardContent className="p-0">
        {loading ? (
          <div className="p-6 space-y-3">{[1, 2, 3].map(i => <Skeleton key={i} className="h-10 w-full" />)}</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Description</TableHead>
                <TableHead>HSN/SAC</TableHead>
                <TableHead className="text-right">Default Rate</TableHead>
                <TableHead className="w-[100px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.length === 0 ? (
                <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-8">No items yet. Add your first item above or bulk import.</TableCell></TableRow>
              ) : items.map(item => (
                <TableRow key={item.id}>
                  {editId === item.id ? (
                    <>
                      <TableCell><Input value={editDesc} onChange={e => setEditDesc(e.target.value)} className="text-sm h-8" /></TableCell>
                      <TableCell><Input value={editHsn} onChange={e => setEditHsn(e.target.value)} className="text-sm h-8" /></TableCell>
                      <TableCell><Input type="number" value={editRate} onChange={e => setEditRate(e.target.value)} className="text-sm h-8 text-right" /></TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={saveEdit}>Save</Button>
                          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setEditId(null)}>Cancel</Button>
                        </div>
                      </TableCell>
                    </>
                  ) : (
                    <>
                      <TableCell className="font-medium">{item.description}</TableCell>
                      <TableCell className="text-muted-foreground">{item.hsn_sac_code || "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{item.default_rate != null ? fmtINR(item.default_rate) : "—"}</TableCell>
                      <TableCell>
                        <div className="flex gap-0.5">
                          <Button variant="ghost" size="icon" className="h-7 w-7" title="Edit" onClick={() => startEdit(item)}>
                            <Pencil size={12} />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7" title="Delete" onClick={() => deleteItem(item.id)}>
                            <Trash2 size={12} className="text-destructive" />
                          </Button>
                        </div>
                      </TableCell>
                    </>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent></Card>
    </div>
  );
}

// ═══════════════════════════════════════
// TIMESHEET TAB
// ═══════════════════════════════════════
function TimesheetTab() {
  const { user } = useAuth();
  const { toast } = useToast();
  const isSuperadmin = user?.role === "superadmin";
  const isManager = ["firm_admin", "partner_ca", "manager"].includes(user?.role || "");
  const firmId = user?.firm_id;

  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }));
  const [entries, setEntries] = useState<TimesheetEntry[]>([]);
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedStaff, setSelectedStaff] = useState(user?.id || "");

  const [addDate, setAddDate] = useState<Date | null>(null);
  const [addClient, setAddClient] = useState("");
  const [addDesc, setAddDesc] = useState("");
  const [addHours, setAddHours] = useState("1");
  const [addBillable, setAddBillable] = useState(true);
  const [addSaving, setAddSaving] = useState(false);

  const weekDates = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);

  useEffect(() => {
    (async () => {
      let q = supabase.from("clients").select("id, name").eq("is_draft", false).is("deleted_at", null).order("name");
      if (!isSuperadmin && firmId) q = q.eq("firm_id", firmId);
      const { data } = await q;
      setClients(data || []);
    })();
    (async () => {
      if (isManager || isSuperadmin) {
        let q = supabase.from("users").select("id, name").eq("is_active", true);
        if (!isSuperadmin && firmId) q = q.eq("firm_id", firmId);
        const { data } = await q;
        setUsers(data || []);
      } else {
        setUsers(user ? [{ id: user.id, name: user.name }] : []);
      }
    })();
  }, [firmId, isSuperadmin, isManager, user]);

  const fetchWeek = useCallback(async () => {
    setLoading(true);
    const from = format(weekDates[0], "yyyy-MM-dd");
    const to = format(weekDates[6], "yyyy-MM-dd");
    let q = supabase.from("timesheets").select("*").gte("work_date", from).lte("work_date", to).order("work_date");
    if (selectedStaff) q = q.eq("user_id", selectedStaff);
    const { data } = await q;
    setEntries((data as TimesheetEntry[]) || []);
    setLoading(false);
  }, [weekDates, selectedStaff]);

  useEffect(() => { fetchWeek(); }, [fetchWeek]);

  const dayEntries = (date: Date) => entries.filter(e => e.work_date && isSameDay(parseISO(e.work_date), date));
  const dayTotals = weekDates.map(d => dayEntries(d).reduce((s, e) => s + (e.hours || 0), 0));
  const weekTotal = dayTotals.reduce((s, t) => s + t, 0);
  const weekBillable = entries.filter(e => e.billable || e.is_billable).reduce((s, e) => s + (e.hours || 0), 0);
  const utilisation = weekTotal > 0 ? Math.round((weekBillable / weekTotal) * 100) : 0;

  const clientName = (id: string | null) => clients.find(c => c.id === id)?.name || "—";

  const handleAdd = async () => {
    if (!addDate || !addClient || !addDesc.trim()) return;
    const hrs = parseFloat(addHours);
    if (isNaN(hrs) || hrs < 0 || hrs > 24) {
      toast({ title: "Hours must be between 0 and 24.", variant: "destructive" });
      return;
    }
    setAddSaving(true);
    const { error } = await supabase.from("timesheets").insert({
      user_id: selectedStaff || user?.id,
      client_id: addClient,
      work_date: format(addDate, "yyyy-MM-dd"),
      description: addDesc.trim(),
      hours: hrs,
      billable: addBillable,
      is_billable: addBillable,
      firm_id: firmId,
    });
    if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
    else { toast({ title: "Entry added" }); setAddDate(null); setAddClient(""); setAddDesc(""); setAddHours("1"); fetchWeek(); }
    setAddSaving(false);
  };

  const handleDelete = async (id: string) => {
    await supabase.from("timesheets").delete().eq("id", id);
    fetchWeek();
  };

  const handleApproveWeek = async () => {
    const from = format(weekDates[0], "yyyy-MM-dd");
    const to = format(weekDates[6], "yyyy-MM-dd");
    const { data, error } = await supabase.rpc("approve_week_timesheets", {
      p_user_id: selectedStaff,
      p_from_date: from,
      p_to_date: to,
      p_approved_by: user?.id,
    });
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: `${data} timesheet entries approved` });
      fetchWeek();
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        {(isManager || isSuperadmin) && (
          <Select value={selectedStaff} onValueChange={setSelectedStaff}>
            <SelectTrigger className="w-[180px]"><SelectValue placeholder="Select staff" /></SelectTrigger>
            <SelectContent>
              {users.map(u => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
        <Button variant="outline" size="icon" onClick={() => setWeekStart(w => addDays(w, -7))}>
          <ChevronLeft size={16} />
        </Button>
        <span className="text-sm font-medium">{format(weekDates[0], "dd MMM")} — {format(weekDates[6], "dd MMM yyyy")}</span>
        <Button variant="outline" size="icon" onClick={() => setWeekStart(w => addDays(w, 7))}>
          <ChevronRight size={16} />
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setWeekStart(startOfWeek(new Date(), { weekStartsOn: 1 }))}>Today</Button>
        <div className="flex-1" />
        <div className="flex items-center gap-4 text-sm">
          <span>Total: <strong>{weekTotal}h</strong></span>
          <span>Billable: <strong>{weekBillable}h</strong></span>
          <span>Utilisation: <strong>{utilisation}%</strong></span>
        </div>
        {isManager && selectedStaff && selectedStaff !== user?.id && (
          <Button size="sm" variant="outline" onClick={handleApproveWeek}>Approve Week</Button>
        )}
      </div>

      <Card><CardContent className="p-0">
        {loading ? (
          <div className="p-6 space-y-3">{[1, 2, 3].map(i => <Skeleton key={i} className="h-24 w-full" />)}</div>
        ) : (
          <>
            <div className="grid grid-cols-7 divide-x divide-border">
              {weekDates.map((date, dayIdx) => {
                const de = dayEntries(date);
                const isToday = isSameDay(date, new Date());
                return (
                  <div key={dayIdx} className={cn("min-h-[160px] flex flex-col", isToday && "bg-accent/30")}>
                    <div className="px-2 py-1.5 border-b border-border text-center">
                      <p className="text-[10px] uppercase text-muted-foreground font-semibold">{WEEKDAYS[dayIdx]}</p>
                      <p className={cn("text-sm font-medium", isToday ? "text-primary" : "text-foreground")}>{format(date, "d")}</p>
                    </div>
                    <div className="flex-1 p-1 space-y-1 overflow-y-auto max-h-[200px]">
                      {de.map(entry => (
                        <div key={entry.id} className={cn(
                          "rounded px-1.5 py-1 text-[11px] leading-tight",
                          entry.approved_by ? "bg-emerald-50 border border-emerald-200 dark:bg-emerald-900/20 dark:border-emerald-800" :
                            (entry.billable || entry.is_billable) ? "bg-primary/10 text-primary border border-primary/20" : "bg-muted text-muted-foreground border border-border"
                        )}>
                          <p className="font-medium truncate">{clientName(entry.client_id)}</p>
                          <p className="truncate opacity-80">{entry.description}</p>
                          <div className="flex items-center justify-between mt-0.5">
                            <span className="font-semibold">{entry.hours}h</span>
                            <div className="flex items-center gap-1">
                              {entry.approved_by && <CheckCircle2 size={8} className="text-emerald-600" />}
                              {entry.is_invoiced && <IndianRupee size={8} className="text-blue-600" />}
                              <button onClick={() => handleDelete(entry.id)} className="text-destructive/60 hover:text-destructive">
                                <Trash2 size={10} />
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="p-1 border-t border-border">
                      <Popover
                        open={addDate ? isSameDay(addDate, date) : false}
                        onOpenChange={open => {
                          if (open) { setAddDate(date); setAddClient(""); setAddDesc(""); setAddHours("1"); setAddBillable(true); }
                          else setAddDate(null);
                        }}
                      >
                        <PopoverTrigger asChild>
                          <Button variant="ghost" size="sm" className="w-full h-6 text-[10px]"><Plus size={10} className="mr-0.5" /> Add</Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-72 p-3 space-y-3" align="start">
                          <p className="text-sm font-semibold">{format(date, "EEE, dd MMM yyyy")}</p>
                          <div>
                            <Label className="text-xs">Client *</Label>
                            <Select value={addClient} onValueChange={setAddClient}>
                              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select" /></SelectTrigger>
                              <SelectContent>{clients.map(c => <SelectItem key={c.id} value={c.id} className="text-xs">{c.name}</SelectItem>)}</SelectContent>
                            </Select>
                          </div>
                          <div>
                            <Label className="text-xs">Description *</Label>
                            <Textarea value={addDesc} onChange={e => setAddDesc(e.target.value)} className="text-xs h-16 resize-none" placeholder="Work done..." />
                          </div>
                          <div className="flex gap-2">
                            <div className="flex-1">
                              <Label className="text-xs">Hours</Label>
                              <Input type="number" step="0.5" min="0.5" max="16" value={addHours} onChange={e => setAddHours(e.target.value)} className="h-8 text-xs" />
                            </div>
                            <div className="flex items-end gap-2 pb-0.5">
                              <Switch checked={addBillable} onCheckedChange={setAddBillable} />
                              <span className="text-xs text-muted-foreground">Billable</span>
                            </div>
                          </div>
                          <Button size="sm" className="w-full" onClick={handleAdd} disabled={addSaving}>{addSaving ? "Saving..." : "Add Entry"}</Button>
                        </PopoverContent>
                      </Popover>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="grid grid-cols-7 border-t border-border bg-muted/30">
              {dayTotals.map((t, i) => (
                <div key={i} className="text-center py-1.5 text-xs font-semibold text-foreground">{t}h</div>
              ))}
            </div>
          </>
        )}
      </CardContent></Card>
    </div>
  );
}

// ═══════════════════════════════════════
// REPORTS TAB
// ═══════════════════════════════════════
function ReportsTab() {
  const { user } = useAuth();
  const isSuperadmin = user?.role === "superadmin";
  const firmId = user?.firm_id;
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [timesheets, setTimesheets] = useState<TimesheetEntry[]>([]);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      let iq = supabase.from("invoices").select("*").order("invoice_date", { ascending: false });
      if (!isSuperadmin && firmId) iq = iq.eq("firm_id", firmId);
      const { data: invData } = await iq;

      let tq = supabase.from("timesheets").select("*").order("work_date", { ascending: false }).limit(1000);
      if (!isSuperadmin) tq = tq.eq("user_id", user?.id);
      const { data: tsData } = await tq;

      let uq = supabase.from("users").select("id, name").eq("is_active", true);
      if (!isSuperadmin && firmId) uq = uq.eq("firm_id", firmId);
      const { data: uData } = await uq;

      setInvoices((invData as Invoice[]) || []);
      setTimesheets((tsData as TimesheetEntry[]) || []);
      setUsers(uData || []);
      setLoading(false);
    })();
  }, [firmId, isSuperadmin, user?.id]);

  const revenueByMonth = useMemo(() => {
    const map: Record<string, number> = {};
    invoices.filter(i => i.status === "paid").forEach(i => {
      const month = i.paid_at ? format(new Date(i.paid_at), "MMM yyyy") : i.invoice_date ? format(new Date(i.invoice_date), "MMM yyyy") : "Unknown";
      map[month] = (map[month] || 0) + (i.total_amount || i.amount || 0);
    });
    return Object.entries(map).map(([name, revenue]) => ({ name, revenue })).slice(0, 12);
  }, [invoices]);

  const aging = useMemo(() => {
    const today = new Date();
    const buckets = { "0-30": 0, "31-60": 0, "61-90": 0, "90+": 0 };
    invoices.filter(i => !["paid", "voided"].includes(i.status || "")).forEach(i => {
      const days = i.due_date ? differenceInDays(today, new Date(i.due_date)) : 0;
      const amount = i.total_amount || i.amount || 0;
      if (days <= 30) buckets["0-30"] += amount;
      else if (days <= 60) buckets["31-60"] += amount;
      else if (days <= 90) buckets["61-90"] += amount;
      else buckets["90+"] += amount;
    });
    return Object.entries(buckets).map(([name, amount]) => ({ name, amount }));
  }, [invoices]);

  const staffUtil = useMemo(() => {
    const map: Record<string, { total: number; billable: number }> = {};
    timesheets.forEach(t => {
      const uid = t.user_id || "unknown";
      if (!map[uid]) map[uid] = { total: 0, billable: 0 };
      map[uid].total += t.hours || 0;
      if (t.billable || t.is_billable) map[uid].billable += t.hours || 0;
    });
    return Object.entries(map).map(([uid, data]) => ({
      name: users.find(u => u.id === uid)?.name || "Unknown",
      total: data.total,
      billable: data.billable,
      utilization: data.total > 0 ? Math.round((data.billable / data.total) * 100) : 0,
    }));
  }, [timesheets, users]);

  const COLORS = ["hsl(var(--primary))", "hsl(var(--chart-2))", "hsl(var(--chart-3))", "hsl(var(--chart-4))"];

  if (loading) return <div className="py-8 text-center text-muted-foreground">Loading reports...</div>;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle className="text-base">Revenue by Month</CardTitle></CardHeader>
          <CardContent>
            {revenueByMonth.length === 0 ? <p className="text-sm text-muted-foreground">No paid invoices yet</p> : (
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={revenueByMonth}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="revenue" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Outstanding Aging</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={250}>
              <PieChart>
                <Pie data={aging} dataKey="amount" nameKey="name" cx="50%" cy="50%" outerRadius={80} label>
                  {aging.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Staff Utilization</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Staff</TableHead>
                <TableHead className="text-right">Total Hours</TableHead>
                <TableHead className="text-right">Billable Hours</TableHead>
                <TableHead className="text-right">Utilization</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {staffUtil.length === 0 ? (
                <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-8">No timesheet data</TableCell></TableRow>
              ) : staffUtil.map((s, i) => (
                <TableRow key={i}>
                  <TableCell className="font-medium">{s.name}</TableCell>
                  <TableCell className="text-right">{s.total}h</TableCell>
                  <TableCell className="text-right">{s.billable}h</TableCell>
                  <TableCell className="text-right">
                    <Badge variant="outline" className={cn("text-xs",
                      s.utilization >= 70 ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300" :
                        s.utilization >= 40 ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300" :
                          "bg-destructive/15 text-destructive"
                    )}>{s.utilization}%</Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

export default Billing;
