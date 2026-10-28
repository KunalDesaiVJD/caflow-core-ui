import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import ReceiptsTabComponent from "@/components/billing/ReceiptsTab";
import LedgerTabComponent from "@/components/billing/LedgerTab";
import BillingDashboardTab from "@/components/billing/BillingDashboardTab";
import EmailSettingsTab from "@/components/billing/EmailSettingsTab";
import TallySyncTab from "@/components/billing/TallySyncTab";
import ReceivablesReportTab from "@/components/billing/ReceivablesReportTab";
import BillingHealthPanel from "@/components/billing/BillingHealthPanel";
import { usePermissions } from "@/hooks/usePermissions";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useUserFirmAccess } from "@/hooks/useUserFirmAccess";
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
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableFooter,
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
  Archive, ChevronDown, ChevronUp, User, RefreshCw, Share2, Phone, History, X, Lock, Ban,
} from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";
import * as XLSX from "xlsx";
import JSZip from "jszip";
import { generateInvoicePdfBlob, invoicePdfFilename } from "@/lib/invoicePdfGenerator";
import { LOCKABLE_DOC_TYPES, firmLockDay, isPeriodLocked, lockMessage } from "@/lib/invoiceLock";

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
  voided: "bg-gray-200 text-gray-600 line-through dark:bg-gray-800 dark:text-gray-400",
};

// A cancelled document is kept on file (its number stays retired) but is labelled "Cancelled".
const statusLabel = (s: string) => (s === "voided" ? "cancelled" : s);

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const fmtINR = (n: number) => "\u20B9" + n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ─── Shared Filter Bar ───
function DocumentFilterBar({
  search, setSearch, statusFilter, setStatusFilter,
  firmFilter, setFirmFilter, groupFilter, setGroupFilter,
  responsibleFilter, setResponsibleFilter, multiFirmFilter, setMultiFirmFilter,
  fromDate, setFromDate, toDate, setToDate,
  firms, groups, responsiblePersons,
  statusOptions,
}: {
  search: string; setSearch: (v: string) => void;
  statusFilter: string; setStatusFilter: (v: string) => void;
  firmFilter: string; setFirmFilter: (v: string) => void;
  groupFilter: string; setGroupFilter: (v: string) => void;
  responsibleFilter: string; setResponsibleFilter: (v: string) => void;
  multiFirmFilter: string[]; setMultiFirmFilter: (v: string[]) => void;
  fromDate: string; setFromDate: (v: string) => void;
  toDate: string; setToDate: (v: string) => void;
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
          {statusOptions.map(s => <SelectItem key={s} value={s} className="capitalize">{statusLabel(s)}</SelectItem>)}
        </SelectContent>
      </Select>
      <div className="space-y-1">
        <Label className="text-xs text-muted-foreground">From</Label>
        <Input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} className="w-36" />
      </div>
      <div className="space-y-1">
        <Label className="text-xs text-muted-foreground">To</Label>
        <Input type="date" value={toDate} onChange={e => setToDate(e.target.value)} className="w-36" />
      </div>
      <Input placeholder="Search number, client, or firm..." value={search} onChange={e => setSearch(e.target.value)} className="w-[260px]" />
    </div>
  );
}

// ─── Documents Sub-Tab (Invoices / Quotations / Credit Notes merged) ───────
function DocumentsTab({ overrideFirmId }: { overrideFirmId?: string | null }) {
  const [subTab, setSubTab] = useState("invoice");
  return (
    <div className="space-y-3">
      <Tabs value={subTab} onValueChange={setSubTab}>
        <TabsList>
          <TabsTrigger value="invoice" className="gap-1.5">
            <FileText size={13} /> Invoices
          </TabsTrigger>
          <TabsTrigger value="quotation_proforma" className="gap-1.5">
            <FileSpreadsheet size={13} /> Quotations &amp; Proforma
          </TabsTrigger>
          <TabsTrigger value="credit_note" className="gap-1.5">
            <Archive size={13} /> Credit Notes
          </TabsTrigger>
        </TabsList>
        <TabsContent value="invoice" className="mt-3">
          <DocumentListTab documentType="invoice" overrideFirmId={overrideFirmId} />
        </TabsContent>
        <TabsContent value="quotation_proforma" className="mt-3">
          <DocumentListTab documentType="quotation_proforma" overrideFirmId={overrideFirmId} />
        </TabsContent>
        <TabsContent value="credit_note" className="mt-3">
          <DocumentListTab documentType="credit_note" overrideFirmId={overrideFirmId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ─── Main Billing Page ───────────────────────────────────────────────────────
const Billing = () => {
  const [activeTab, setActiveTab] = useState("dashboard");
  const { user } = useAuth();
  const homeFirmId = user?.firm_id ?? null;
  const userId = user?.id ?? null;
  const isSuperadmin = user?.role === "superadmin";

  // Cross-firm access: lets non-superadmin users switch to a granted firm
  const { allAccessibleFirms, hasMultiFirmAccess } = useUserFirmAccess();
  const [activeFirmId, setActiveFirmId] = useState<string | null>(homeFirmId);

  // Keep activeFirmId in sync when home firm loads (initial render may be null)
  useEffect(() => {
    if (!activeFirmId && homeFirmId) setActiveFirmId(homeFirmId);
  }, [homeFirmId]);

  const isViewingOtherFirm = activeFirmId && activeFirmId !== homeFirmId;
  const activeFirmName = allAccessibleFirms.find(f => f.id === activeFirmId)?.name;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Billing</h1>
          <p className="text-sm text-muted-foreground">Dashboard, documents, receipts, ledger, and email settings</p>
        </div>

        {/* Firm switcher — shown only when user has cross-firm grants */}
        {!isSuperadmin && hasMultiFirmAccess && (
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground whitespace-nowrap">Viewing firm:</span>
            <Select
              value={activeFirmId ?? ""}
              onValueChange={v => setActiveFirmId(v)}
            >
              <SelectTrigger className="w-[220px] h-8 text-sm">
                <SelectValue placeholder="Select firm" />
              </SelectTrigger>
              <SelectContent>
                {allAccessibleFirms.map(f => (
                  <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {isViewingOtherFirm && (
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300 font-medium whitespace-nowrap">
                Cross-firm access
              </span>
            )}
          </div>
        )}
      </div>

      <BillingHealthPanel firmId={activeFirmId} />

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="flex-wrap">
          <TabsTrigger value="dashboard" className="gap-2"><BarChart3 size={14} /> Dashboard</TabsTrigger>
          <TabsTrigger value="documents" className="gap-2"><FileText size={14} /> Documents</TabsTrigger>
          <TabsTrigger value="receipts" className="gap-2"><Receipt size={14} /> Receipts</TabsTrigger>
          <TabsTrigger value="ledger" className="gap-2"><BookOpen size={14} /> Ledger</TabsTrigger>
          <TabsTrigger value="item-master" className="gap-2"><Settings2 size={14} /> Item Master</TabsTrigger>
          <TabsTrigger value="report" className="gap-2"><BarChart3 size={14} /> Report</TabsTrigger>
          <TabsTrigger value="email-settings" className="gap-2"><Mail size={14} /> Email Settings</TabsTrigger>
          <TabsTrigger value="tally-sync" className="gap-2"><RefreshCw size={14} /> Tally Sync</TabsTrigger>
        </TabsList>

        <TabsContent value="dashboard"><BillingDashboardTab firmId={activeFirmId} /></TabsContent>
        <TabsContent value="documents"><DocumentsTab overrideFirmId={activeFirmId} /></TabsContent>
        <TabsContent value="receipts"><ReceiptsTab overrideFirmId={activeFirmId} /></TabsContent>
        <TabsContent value="ledger"><LedgerTabComponent defaultFirmId={activeFirmId ?? undefined} /></TabsContent>
        <TabsContent value="item-master"><ItemMasterTab /></TabsContent>
        <TabsContent value="report"><ReceivablesReportTab defaultFirmId={activeFirmId ?? undefined} /></TabsContent>
        <TabsContent value="email-settings"><EmailSettingsTab firmId={activeFirmId} userId={userId} /></TabsContent>
        <TabsContent value="tally-sync"><TallySyncTab firmId={activeFirmId} /></TabsContent>
      </Tabs>
    </div>
  );
};

// ═══════════════════════════════════════
// DOCUMENT LIST TAB (Invoices / Quotations & Proforma / Credit Notes)
// ═══════════════════════════════════════
function DocumentListTab({ documentType, overrideFirmId }: { documentType: "invoice" | "quotation_proforma" | "credit_note"; overrideFirmId?: string | null }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();
  const { can, loading: permsLoading } = usePermissions();
  const isSuperadmin = user?.role === "superadmin";
  // Phase 4 (C2/H8): mutating billing actions respect the role matrix — view-only
  // roles (manager / staff_article / client) must not delete or send.
  // REGRESSION FIX: the gate must FAIL OPEN while auth/permissions are still
  // hydrating (user.role can be null and can() returns false on an empty
  // permissions map), otherwise it wrongly blocked firm_admins/partners. Known
  // privileged roles are allowed immediately; the hard gate only applies once
  // permissions have loaded — so restricted roles are still blocked.
  const isPrivilegedRole = ["superadmin", "firm_admin", "partner_ca"].includes(user?.role || "");
  // Managers may SEND and DELETE/void billing documents. Granted by ROLE here, independent
  // of the role_permissions read: managers fall back to the hardcoded "view-only" defaults
  // (DEFAULT_PERMISSIONS in usePermissions), so a DB permission grant alone does NOT reach
  // them — the role check below does. (Delete still has its own safety checks: blocked when
  // receipts exist, clears the ledger on delete.)
  const canBillingAct = isPrivilegedRole || user?.role === "manager";
  const canDelete = isSuperadmin || canBillingAct || (!permsLoading && can("Billing", "can_delete"));
  const canSend = isSuperadmin || canBillingAct || (!permsLoading && can("Billing", "can_edit"));
  const firmId = overrideFirmId ?? user?.firm_id;

  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [clientMap, setClientMap] = useState<ClientMap>({});
  const [firmMap, setFirmMap] = useState<FirmMap>({});
  // firm_id → invoice lock day (firms.settings.invoice_lock_day); see lib/invoiceLock.
  const [lockDays, setLockDays] = useState<Record<string, number | null>>({});
  const isDocLocked = (inv: { firm_id?: string | null; invoice_date?: string | null; document_type?: string | null; status?: string | null }) =>
    !isSuperadmin && LOCKABLE_DOC_TYPES.includes(inv.document_type || "invoice") && (inv.status || "draft") !== "draft"
    && isPeriodLocked(inv.invoice_date, lockDays[inv.firm_id || ""] ?? null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [firmFilter, setFirmFilter] = useState("all");
  const [groupFilter, setGroupFilter] = useState("all");
  const [responsibleFilter, setResponsibleFilter] = useState("all");
  const [multiFirmFilter, setMultiFirmFilter] = useState<string[]>([]);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [viewBy, setViewBy] = useState<"all" | "responsible" | "group" | "firm" | "multifirm">("all");
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [cancelTarget, setCancelTarget] = useState<Invoice | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelling, setCancelling] = useState(false);

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

  // Share dialog state
  const [shareOpen, setShareOpen] = useState(false);
  const [shareInvoice, setShareInvoice] = useState<Invoice | null>(null);
  const [shareEmail, setShareEmail] = useState("");
  const [shareCC, setShareCC] = useState<string[]>([]);
  const [shareCCInput, setShareCCInput] = useState("");
  const [sharePhone, setSharePhone] = useState("");
  const [shareSubject, setShareSubject] = useState("");
  const [shareMessage, setShareMessage] = useState("");
  const [shareViaEmail, setShareViaEmail] = useState(true);
  const [shareViaWhatsApp, setShareViaWhatsApp] = useState(false);
  const [shareSending, setShareSending] = useState(false);

  // Reminders collapsed state (default collapsed)
  const [remindersCollapsed, setRemindersCollapsed] = useState(true);

  // Client details cache for email/phone
  const [clientDetailsMap, setClientDetailsMap] = useState<Record<string, { email: string | null; mobile: string | null; extra_emails?: string[] | null }>>({});

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

    // When a specific firm is selected in the filter, use it as the scope.
    // Otherwise fall back to the user's own firm (unless superadmin, who sees all).
    const effectiveFirmId = firmFilter !== "all" ? firmFilter : (isSuperadmin ? null : firmId);

    let iQuery = supabase.from("invoices").select("*").in("document_type", docTypeFilter)
      .order("invoice_date", { ascending: false })
      .order("seq_number", { ascending: false });
    if (effectiveFirmId) iQuery = iQuery.eq("firm_id", effectiveFirmId);
    const { data: invData } = await iQuery;

    // 2026-06-25 (V J Desai): Billing shows BOTH archived and active clients
    // so pending invoices for deactivated-in-eOffice clients can still be
    // managed. No .is("deleted_at", null) filter here (nor on the other two
    // client fetches below at responsibleFilter and item-master flows).
    let cQuery = supabase.from("clients").select("id, name, entity_type, email, mobile, compliance_flags, responsible_person_id").eq("is_draft", false);
    const { data: clientData } = await cQuery;

    const { data: firmData } = await supabase.from("firms").select("id, name, display_name, settings");
    const { data: groupData } = await supabase.from("client_groups").select("id, name");
    // Load firm-scoped active users for Responsible Person filter
    let usersQuery = supabase.from("users").select("id, name").neq("role", "client").eq("is_active", true).order("name");
    if (effectiveFirmId) usersQuery = usersQuery.eq("firm_id", effectiveFirmId);
    const { data: usersData } = await usersQuery;

    const cMap: ClientMap = {};
    const cdMap: Record<string, { email: string | null; mobile: string | null; compliance_flags?: Record<string, any> | null; responsible_person_id: string | null }> = {};
    (clientData || []).forEach((c: any) => {
      cMap[c.id] = { name: c.name || "Unknown", entity_type: c.entity_type };
      cdMap[c.id] = { email: c.email, mobile: c.mobile, compliance_flags: c.compliance_flags, responsible_person_id: c.responsible_person_id };
    });
    setClientDetailsMap(cdMap);

    const fMap: FirmMap = {};
    (firmData || []).forEach((f: any) => { fMap[f.id] = f.display_name || f.name || "Unknown"; });

    setInvoices((invData as Invoice[]) || []);
    setClientMap(cMap);
    setFirmMap(fMap);
    const lMap: Record<string, number | null> = {};
    (firmData || []).forEach((f: any) => { lMap[f.id] = firmLockDay(f.settings); });
    setLockDays(lMap);
    setFirms((firmData || []).map((f: any) => ({ id: f.id, name: f.display_name || f.name })));
    setGroups((groupData || []).map((g: any) => ({ id: g.id, name: g.name })));
    setResponsiblePersons((usersData || []).map((u: any) => ({ id: u.id, name: u.name })));
    setLoading(false);
  }, [firmId, isSuperadmin, docTypeFilter, firmFilter, documentType]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Billing reminders — temporarily paused; re-enable by setting REMINDERS_ENABLED = true
  const REMINDERS_ENABLED = false;
  useEffect(() => {
    if (!REMINDERS_ENABLED || documentType !== "invoice" || !firmId) { setReminders([]); return; }
    (async () => {
      const today = format(new Date(), "yyyy-MM-dd");
      const { data } = await supabase.from("billing_reminders")
        .select("*, service_categories(name)")
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
  }, [documentType, firmId, REMINDERS_ENABLED]);

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
      const { data } = await supabase.from("clients").select("id").eq("responsible_person_id", responsibleFilter).eq("is_draft", false);
      setResponsibleClientIds((data || []).map((d: any) => d.id));
    })();
  }, [responsibleFilter]);

  // One definition of a document's total, shared by rows, subtotals, footer and Excel export.
  // Cancelled documents count for nothing in any subtotal / total (rows still show their face value).
  const rawDocTotal = (i: any) => i.total_amount || (i.amount || 0) + (i.gst_amount || 0);
  const docTotal = (i: any) => (i.status === "voided" ? 0 : rawDocTotal(i));

  const enriched = useMemo(() => {
    return invoices.map(inv => ({ ...inv, effectiveStatus: inv.status || "draft" }));
  }, [invoices]);

  const stats = useMemo(() => {
    // Drafts are not receivable; amount_due reflects part-payments (same basis as the dashboard).
    const outstanding = enriched.filter(i => !["paid", "voided", "converted", "draft", "cancelled"].includes(i.effectiveStatus))
      .reduce((s, i) => s + Math.max(0, (i as any).amount_due ?? docTotal(i)), 0);
    const collected = enriched.filter(i => i.effectiveStatus === "paid")
      .reduce((s, i) => s + docTotal(i), 0);
    const overdue = enriched.filter(i => i.effectiveStatus === "overdue").length;
    const drafts = enriched.filter(i => i.effectiveStatus === "draft").length;
    return { outstanding, collected, overdue, drafts };
  }, [enriched]);

  const filtered = useMemo(() => enriched.filter(inv => {
    if (statusFilter !== "all" && inv.effectiveStatus !== statusFilter) return false;
    if (groupFilter !== "all" && !groupClientIds.includes(inv.client_id || "")) return false;
    if (responsibleFilter !== "all" && !responsibleClientIds.includes(inv.client_id || "")) return false;
    if (multiFirmFilter.length > 0 && !multiFirmFilter.includes(inv.firm_id || "")) return false;
    if (fromDate && (!inv.invoice_date || inv.invoice_date < fromDate)) return false;
    if (toDate && (!inv.invoice_date || inv.invoice_date > toDate)) return false;
    if (search) {
      const s = search.toLowerCase();
      const cn = clientMap[inv.client_id || ""]?.name || "";
      const fn = firmMap[inv.firm_id || ""] || "";
      if (!(inv.invoice_no || "").toLowerCase().includes(s) &&
        !cn.toLowerCase().includes(s) &&
        !fn.toLowerCase().includes(s)) return false;
    }
    return true;
  }), [enriched, statusFilter, search, clientMap, firmMap, groupFilter, groupClientIds, responsibleFilter, responsibleClientIds, fromDate, toDate]);

  // Grouped data for view modes
  const groupedInvoices = useMemo(() => {
    if (viewBy === "all") return null;
    const result: { key: string; label: string; invoices: typeof filtered; subtotal: number }[] = [];
    const map = new Map<string, typeof filtered>();

    for (const inv of filtered) {
      let key = "";
      if (viewBy === "responsible") {
        key = (clientDetailsMap[inv.client_id || ""] as any)?.responsible_person_id || "unassigned";
      } else if (viewBy === "group") {
        key = inv.client_id || "unknown";
      } else if (viewBy === "firm" || viewBy === "multifirm") {
        key = inv.firm_id || "unknown";
      }
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(inv);
    }

    for (const [key, invs] of map) {
      let label = key;
      if (viewBy === "responsible") {
        label = key === "unassigned" ? "Unassigned" : (responsiblePersons.find(p => p.id === key)?.name || "Unknown");
      } else if (viewBy === "group") {
        label = clientMap[key]?.name || "Unknown";
      } else if (viewBy === "firm" || viewBy === "multifirm") {
        label = firmMap[key] || "Unknown Firm";
      }
      const subtotal = invs.reduce((s, i) => s + docTotal(i), 0);
      result.push({ key, label, invoices: invs, subtotal });
    }
    result.sort((a, b) => a.label.localeCompare(b.label));
    return result;
  }, [filtered, viewBy, clientDetailsMap, clientMap, firmMap, responsiblePersons]);

  const getClientAllEmails = (clientId: string): string[] => {
    const d = clientDetailsMap[clientId];
    if (!d) return [];
    const arr: string[] = [];
    if (d.email) arr.push(d.email);
    // Extra emails stored in compliance_flags.extra_emails (workaround: extra_emails column not in production)
    const extra = Array.isArray((d.compliance_flags as any)?.extra_emails)
      ? (d.compliance_flags as any).extra_emails as string[]
      : [];
    extra.forEach(e => { if (e && !arr.includes(e)) arr.push(e); });
    return arr;
  };

  // Open share dialog for a single invoice
  const openShareDialog = (inv: Invoice) => {
    const clientName = clientMap[inv.client_id || ""]?.name || "";
    const details = clientDetailsMap[inv.client_id || ""];
    const fName = firmMap[inv.firm_id || ""] || "";
    const allEmails = getClientAllEmails(inv.client_id || "");
    setShareInvoice(inv);
    setShareEmail(allEmails[0] || details?.email || "");
    setShareCC(allEmails.slice(1));
    setShareCCInput("");
    setSharePhone(details?.mobile || "");
    setShareSubject(`${inv.invoice_no || "Invoice"} from ${fName}`);
    setShareMessage(`Dear ${clientName},\n\nPlease find attached ${inv.invoice_no || "Invoice"} for ₹${(inv.total_amount || inv.amount || 0).toLocaleString("en-IN")}.\n\nRegards,\n${fName}`);
    setShareViaEmail(true);
    setShareViaWhatsApp(false);
    setShareOpen(true);
  };

  const handleShareSend = async () => {
    if (!shareInvoice) return;
    if (!canSend) { toast({ title: "Not allowed", description: "You don't have permission to send billing documents.", variant: "destructive" }); return; }
    setShareSending(true);
    try {
      // ── Generate PDF once — reused for both email attachment and WhatsApp download ──
      let pdfBlob: Blob | null = null;
      let pdfBase64: string | undefined;
      const pdfFilename = `${(shareInvoice.invoice_no || "Invoice").replace(/\//g, "-")}.pdf`;
      try {
        const { data: fullInv } = await supabase.from("invoices").select("*").eq("id", shareInvoice.id).single();
        if (fullInv) {
          pdfBlob = await generateInvoicePdfBlob(await enrichInvoiceMsme(fullInv) as any);
          pdfBase64 = await new Promise<string>(resolve => {
            const reader = new FileReader();
            reader.onloadend = () => resolve((reader.result as string).split(",")[1]);
            reader.readAsDataURL(pdfBlob!);
          });
        }
      } catch (pdfErr) {
        console.error("[SharePDF] PDF generation failed:", pdfErr);
        toast({
          title: "PDF generation failed",
          description: "The invoice PDF could not be generated. Please try again.",
          variant: "destructive",
        });
        setShareSending(false);
        return;
      }

      if (shareViaEmail && shareEmail) {
        const allCC = [...shareCC, ...(shareCCInput.trim() ? [shareCCInput.trim()] : [])].filter(e => e && e !== shareEmail);
        const { error: invokeError } = await supabase.functions.invoke("send-notification", {
          body: {
            type: "invoice_generated",
            firm_id: shareInvoice.firm_id,
            client_id: shareInvoice.client_id,
            send_to_client: true,
            custom_cc: allCC,
            payload: {
              invoice_no: shareInvoice.invoice_no,
              amount: shareInvoice.total_amount || shareInvoice.amount || 0,
              document_type: shareInvoice.document_type || "invoice",
              client_name: clientMap[shareInvoice.client_id || ""]?.name || "",
              custom_email: shareEmail,
              custom_subject: shareSubject,
              custom_message: shareMessage,
              ...(pdfBase64 ? { pdf_base64: pdfBase64, pdf_filename: pdfFilename } : {}),
            },
          },
        });
        // Frontend-side audit log via Vercel serverless function (bypasses Supabase RLS).
        // Ensures Email Log tab always shows every send, regardless of edge function version.
        try {
          await fetch("/api/log-email", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              firm_id:      shareInvoice.firm_id,
              recipient_id: shareInvoice.client_id || null,
              channel:      "email",
              type:         "invoice_generated",
              content: {
                to:      shareEmail,
                subject: shareSubject,
                ...(allCC.length > 0 ? { cc: allCC.join(", ") } : {}),
                ...(shareMessage      ? { body: shareMessage }   : {}),
                ...(invokeError       ? { error: invokeError.message ?? String(invokeError) } : {}),
              },
              status:  invokeError ? "failed" : "sent",
              sent_at: new Date().toISOString(),
            }),
          });
        } catch (logErr) {
          console.error("[EmailLog] Failed to write notification log:", logErr);
        }
        await supabase.from("invoices").update({ status: "sent", sent_at: new Date().toISOString() }).eq("id", shareInvoice.id);
        toast({ title: pdfBase64 ? "Email sent with PDF attachment" : "Email sent successfully" });
      }
      if (shareViaWhatsApp && sharePhone) {
        const phone = sharePhone.replace(/\D/g, "");
        const fullPhone = phone.startsWith("91") ? phone : `91${phone}`;
        const msg = encodeURIComponent(shareMessage);
        window.open(`https://wa.me/${fullPhone}?text=${msg}`, "_blank");
        toast({ title: "WhatsApp opened — PDF downloaded for manual attachment" });
        if (pdfBlob) {
          const url = URL.createObjectURL(pdfBlob);
          const a = document.createElement("a");
          a.href = url;
          a.download = pdfFilename;
          a.click();
          URL.revokeObjectURL(url);
        }
      }
    } catch {
      toast({ title: "Failed to send", variant: "destructive" });
    }
    setShareSending(false);
    setShareOpen(false);
    fetchData();
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    const target = invoices.find(i => i.id === deleteId);
    if (target && isDocLocked(target as any)) {
      toast({ title: "Month closed", description: lockMessage(target.invoice_date!, lockDays[target.firm_id || ""]!), variant: "destructive" });
      setDeleteId(null);
      return;
    }
    if (!canDelete) {
      toast({ title: "Not allowed", description: "You don't have permission to delete billing documents.", variant: "destructive" });
      setDeleteId(null);
      return;
    }
    // Q5: a deleted invoice must not leave residual ledger rows behind.
    // Guard first: if real payments (receipts) are linked to this invoice,
    // deleting it would orphan that money — block and tell the user.
    const { count: receiptCount } = await supabase
      .from("billing_receipts")
      .select("id", { count: "exact", head: true })
      .eq("invoice_id", deleteId);
    if (receiptCount && receiptCount > 0) {
      toast({
        title: "Cannot delete — payments exist",
        description: `This document has ${receiptCount} receipt(s) recorded against it. Delete those receipts first, or void the document instead.`,
        variant: "destructive",
      });
      setDeleteId(null);
      return;
    }
    // Remove the document's own ledger entries, then the document itself, so it
    // disappears from every client ledger, report and outstanding balance.
    const { error: ledgerErr } = await supabase
      .from("client_ledger_entries")
      .delete()
      .eq("document_id", deleteId)
      .in("entry_type", ["invoice", "credit_note"]);
    if (ledgerErr) {
      toast({ title: "Error clearing ledger entries", description: ledgerErr.message, variant: "destructive" });
      setDeleteId(null);
      return;
    }
    const { error } = await supabase.from("invoices").delete().eq("id", deleteId);
    if (error) {
      toast({ title: "Error deleting document", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Document deleted" });
    }
    setDeleteId(null);
    fetchData();
  };

  const handleCancelDocument = async () => {
    if (!cancelTarget) return;
    if (!cancelReason.trim()) { toast({ title: "Reason required", description: "Say why this document is being cancelled.", variant: "destructive" }); return; }
    setCancelling(true);
    const { error } = await (supabase as any).rpc("cancel_billing_document", { p_invoice_id: cancelTarget.id, p_reason: cancelReason.trim() });
    setCancelling(false);
    if (error) {
      toast({ title: "Could not cancel", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Document cancelled", description: `${cancelTarget.invoice_no || "Document"} is removed from ledgers and reports. Its number will not be reused.` });
    setCancelTarget(null);
    setCancelReason("");
    fetchData();
  };

  const handleSend = async (inv: Invoice, sendToResponsible = false) => {
    if (!canSend) { toast({ title: "Not allowed", description: "You don't have permission to send billing documents.", variant: "destructive" }); return; }
    const total = inv.total_amount || (inv.amount || 0) + (inv.gst_amount || 0);
    const notifType = sendToResponsible ? "internal_filing_reminder"
      : inv.document_type === "credit_note" ? "credit_note_issued"
      : inv.document_type === "quotation" ? "quotation_sent"
      : inv.document_type === "proforma" ? "proforma_sent"
      : "invoice_generated";

    // Generate PDF attachment for client-facing emails
    let pdfBase64: string | undefined;
    let pdfFilename: string | undefined;
    if (!sendToResponsible) {
      try {
        const { data: fullInv } = await supabase.from("invoices").select("*").eq("id", inv.id).single();
        if (fullInv) {
          const blob = await generateInvoicePdfBlob(await enrichInvoiceMsme(fullInv) as any);
          pdfBase64 = await new Promise<string>(resolve => {
            const reader = new FileReader();
            reader.onloadend = () => resolve((reader.result as string).split(",")[1]);
            reader.readAsDataURL(blob);
          });
          pdfFilename = `${(inv.invoice_no || "Invoice").replace(/\//g, "-")}.pdf`;
        }
      } catch (pdfErr) {
        console.error("[SendPDF] PDF generation failed:", pdfErr);
        toast({
          title: "PDF generation failed",
          description: "Unable to generate the invoice PDF. Please try again.",
          variant: "destructive",
        });
        return;
      }
    }

    try {
      const { data, error } = await supabase.functions.invoke("send-notification", {
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
            ...(pdfBase64 ? { pdf_base64: pdfBase64, pdf_filename: pdfFilename } : {}),
          },
        },
      });
      // Inspect the real result — supabase-js does not throw on 403/500.
      const channel: any = sendToResponsible ? (data as any)?.results?.responsible : (data as any)?.results?.client;
      const anySent = channel ? Object.values(channel).some((c: any) => c?.status === "sent") : true;
      if (error || !anySent) {
        let reason = error?.message || (channel && Object.values(channel).map((c: any) => c?.error).find(Boolean)) || "Delivery failed";
        try { const ctx = await (error as any)?.context?.json?.(); if (ctx?.error) reason = ctx.error; } catch { /* ignore */ }
        toast({ title: "Failed to send", description: reason, variant: "destructive" });
        fetchData();
        return;
      }
    } catch (e: any) {
      toast({ title: "Failed to send", description: e?.message || "Network error", variant: "destructive" });
      fetchData();
      return;
    }

    if (!sendToResponsible) {
      await supabase.from("invoices").update({ status: "sent", sent_at: new Date().toISOString() }).eq("id", inv.id);
      toast({ title: pdfBase64 ? "Document sent with PDF attachment" : "Document sent" });
    } else {
      toast({ title: "Responsible person notified" });
    }
    fetchData();
  };

  // Bulk send handler
  const handleBulkSend = async () => {
    if (!canSend) { toast({ title: "Not allowed", description: "You don't have permission to send billing documents.", variant: "destructive" }); return; }
    const selected = filtered.filter(inv => selectedIds.has(inv.id));
    if (selected.length === 0) return;
    setBulkSending(true);
    setBulkProgress({ current: 0, total: selected.length });

    // Pre-fetch full invoice records for PDF generation (client sends only)
    const needsPdf = bulkSendTarget === "client" || bulkSendTarget === "both";
    let fullInvoiceMap: Record<string, any> = {};
    if (needsPdf) {
      const { data: fullInvoices } = await supabase.from("invoices").select("*").in("id", selected.map(i => i.id));
      (fullInvoices || []).forEach((inv: any) => { fullInvoiceMap[inv.id] = inv; });
    }

    let sentCount = 0;
    let failCount = 0;
    for (const inv of selected) {
      setBulkProgress(p => ({ ...p, current: p.current + 1 }));
      const total = inv.total_amount || (inv.amount || 0) + (inv.gst_amount || 0);
      const notifType = inv.document_type === "credit_note" ? "credit_note_issued"
        : inv.document_type === "quotation" ? "quotation_sent"
        : inv.document_type === "proforma" ? "proforma_sent"
        : "invoice_generated";

      // Generate PDF for client-facing emails
      let pdfBase64: string | undefined;
      let pdfFilename: string | undefined;
      if (needsPdf && fullInvoiceMap[inv.id]) {
        try {
          const blob = await generateInvoicePdfBlob(await enrichInvoiceMsme(fullInvoiceMap[inv.id]) as any);
          pdfBase64 = await new Promise<string>(resolve => {
            const reader = new FileReader();
            reader.onloadend = () => resolve((reader.result as string).split(",")[1]);
            reader.readAsDataURL(blob);
          });
          pdfFilename = `${(inv.invoice_no || "Invoice").replace(/\//g, "-")}.pdf`;
        } catch (pdfErr) {
          console.error("[BulkSendPDF] PDF failed for", inv.invoice_no, pdfErr);
          // Skip this invoice in bulk — individual failures shouldn't abort the whole batch
          // but DO record the skip in progress
        }
      }

      try {
        const { data, error } = await supabase.functions.invoke("send-notification", {
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
              ...(pdfBase64 ? { pdf_base64: pdfBase64, pdf_filename: pdfFilename } : {}),
            },
          },
        });
        // Count a real send only — supabase-js does not throw on 403/500.
        const results: any = (data as any)?.results || {};
        const anySent = Object.values(results).some((r: any) => Object.values(r || {}).some((c: any) => c?.status === "sent"));
        if (error || (Object.keys(results).length > 0 && !anySent)) failCount++; else sentCount++;
      } catch { failCount++; }
    }

    toast({
      title: `Sent to ${sentCount} recipient${sentCount !== 1 ? "s" : ""}${failCount ? `, ${failCount} failed` : ""}`,
      ...(failCount ? { variant: "destructive" as const } : {}),
    });
    setBulkSending(false);
    setBulkSendOpen(false);
    setSelectedIds(new Set());
    fetchData();
  };

  // Month-wise download state
  const [monthDownloadOpen, setMonthDownloadOpen] = useState(false);
  const [dlMonth, setDlMonth] = useState(String(new Date().getMonth() + 1));
  const [dlYear, setDlYear] = useState(String(new Date().getFullYear()));
  const [dlFirm, setDlFirm] = useState("all");
  const [bulkZipProgress, setBulkZipProgress] = useState({ current: 0, total: 0, active: false });

  // Fill from_msme from the firm's current settings.msme_no when the invoice
  // snapshot lacks it (invoices created before from_msme was captured). Cached
  // per firm_id for the lifetime of the component to avoid repeat queries.
  const msmeCacheRef = useRef<Record<string, string>>({});
  const enrichInvoiceMsme = async <T extends { firm_id?: string | null; from_msme?: string | null }>(inv: T): Promise<T> => {
    if (!inv) return inv;
    if (inv.from_msme) return inv;
    const firmId = inv.firm_id || "";
    if (!firmId) return inv;
    let msme = msmeCacheRef.current[firmId];
    if (msme === undefined) {
      const { data: firm } = await supabase.from("firms").select("settings").eq("id", firmId).single();
      msme = ((firm?.settings as Record<string, any> | null)?.msme_no as string) || "";
      msmeCacheRef.current[firmId] = msme;
    }
    return msme ? { ...inv, from_msme: msme } : inv;
  };

  // Generate ZIP from an array of full invoice records
  const generateZipFromInvoices = async (invoiceIds: string[], zipName: string) => {
    setBulkZipProgress({ current: 0, total: invoiceIds.length, active: true });
    toast({ title: `Generating PDFs... 0 of ${invoiceIds.length}` });

    // Fetch full invoice records with all fields needed for PDF
    const { data: fullInvoices } = await supabase.from("invoices").select("*").in("id", invoiceIds);
    if (!fullInvoices || fullInvoices.length === 0) {
      setBulkZipProgress({ current: 0, total: 0, active: false });
      toast({ title: "No invoices found", variant: "destructive" });
      return;
    }
    console.log(`[BulkPDF] Loaded ${fullInvoices.length} invoice records for ZIP generation`);

    // Fetch firm logos for all unique firm_ids and convert to base64 for html2canvas
    const uniqueFirmIds = [...new Set(fullInvoices.map(inv => inv.firm_id).filter(Boolean))];
    const firmDataCache: Record<string, any> = {};
    const firmLogoMap: Record<string, string> = {};
    if (uniqueFirmIds.length > 0) {
      const { data: firmData } = await supabase.from("firms").select("id, name, display_name, address, gstin, pan, email, phone, logo_url, settings").in("id", uniqueFirmIds);
      (firmData || []).forEach((firm: any) => {
        firmDataCache[firm.id] = firm;
      });
      await Promise.all((firmData || []).map(async (f: any) => {
        const resolvedLogoUrl = f.logo_url || ((f.settings as Record<string, any> | null)?.logo_url ?? null);
        if (!resolvedLogoUrl) return;
        try {
          const res = await fetch(resolvedLogoUrl, { mode: "cors" });
          if (!res.ok) { firmLogoMap[f.id] = resolvedLogoUrl; return; }
          const blob = await res.blob();
          const base64 = await new Promise<string>(resolve => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.onerror = () => resolve(resolvedLogoUrl);
            reader.readAsDataURL(blob);
          });
          firmLogoMap[f.id] = base64;
        } catch {
          firmLogoMap[f.id] = resolvedLogoUrl;
        }
      }));
    }

    // Helper: reconstruct firm address exactly like single-invoice path
    const buildFirmAddress = (firm: any): string => {
      if (!firm?.address) return "";
      const addr = firm.address as any;
      const addrLine = addr.line || addr.line1 || "";
      const cityName = addr.city || "";
      const cityAlreadyInAddress = cityName && addrLine.toLowerCase().includes(cityName.toLowerCase());
      const cityPinPart = cityAlreadyInAddress ? "" : [cityName, addr.pincode].filter(Boolean).join(" \u2013 ");
      const rawLines = [addrLine, addr.line2, cityPinPart].filter(Boolean);
      // balanceAddressLines logic inline
      const balanced = (() => {
        if (rawLines.length < 2) return rawLines;
        const firstTwo = rawLines.slice(0, -1);
        const lastLine = rawLines[rawLines.length - 1];
        if (firstTwo.length === 1) {
          const words = firstTwo[0].split(/\s+/);
          if (words.length > 6) {
            const mid = Math.ceil(words.length / 2);
            return [words.slice(0, mid).join(" "), words.slice(mid).join(" "), lastLine];
          }
        }
        return rawLines;
      })();
      return balanced.join(", ");
    };

    const zip = new JSZip();
    let successCount = 0;
    for (let i = 0; i < fullInvoices.length; i++) {
      const inv = fullInvoices[i];
      const clientName = clientMap[inv.client_id || ""]?.name || inv.to_name || "Unknown";
      setBulkZipProgress({ current: i + 1, total: fullInvoices.length, active: true });
      toast({ title: `Generating PDF ${i + 1} of ${fullInvoices.length}...` });

      try {
        const sourceFirm = inv.firm_id ? (firmDataCache[inv.firm_id] || null) : null;
        // Reconstruct address from firm data (same as single-invoice path) to ensure consistency
        const firmAddress = sourceFirm ? buildFirmAddress(sourceFirm) : null;
        const firmSettings = sourceFirm ? (sourceFirm.settings as Record<string, any> | null) : null;
        const billingEmail = firmSettings?.billing_email || sourceFirm?.email || "";
        const billingContact = firmSettings?.billing_contact || sourceFirm?.phone || "";
        const currentFirmName = sourceFirm?.display_name || sourceFirm?.name || "";
        // Always-current overrides — match NewInvoice.tsx single-invoice
        // rendering precedence: pass live firm data, fall back to stored
        // snapshot only when the live value is empty. Previously this used
        // stored-first/live-fallback which silently produced different
        // PDFs for the same invoice depending on the export path.
        const invWithLogo = {
          ...inv,
          from_firm_name: currentFirmName || inv.from_firm_name || "",
          from_address:   firmAddress     || inv.from_address || "",
          from_gstin:     sourceFirm?.gstin || inv.from_gstin || "",
          from_pan:       sourceFirm?.pan   || inv.from_pan   || "",
          from_msme:      firmSettings?.msme_no || inv.from_msme || "",
          from_email:     billingEmail   || inv.from_email || "",
          from_phone:     billingContact || inv.from_phone || "",
          signatory_name: currentFirmName || (inv as any).signatory_name || "",
          logo_url: inv.firm_id ? (firmLogoMap[inv.firm_id] || null) : null,
          firm_settings: firmSettings,
        };
        console.log(`[BulkPDF] Generating ${inv.invoice_no || inv.id} (${i + 1}/${fullInvoices.length})`);
        const pdfBlob = await generateInvoicePdfBlob(invWithLogo as any);
        if (pdfBlob.size < 5000) {
          console.warn(`[BulkPDF] Invoice ${inv.invoice_no} generated suspiciously small PDF (${pdfBlob.size} bytes) — retrying`);
          // Retry once with extra delay
          await new Promise(r => setTimeout(r, 300));
          const retryBlob = await generateInvoicePdfBlob(invWithLogo as any);
          const filename = invoicePdfFilename(inv.invoice_no, clientName);
          zip.file(filename, retryBlob);
          successCount++;
          console.log(`[BulkPDF] Added ${filename} after retry (${retryBlob.size} bytes)`);
        } else {
          const filename = invoicePdfFilename(inv.invoice_no, clientName);
          zip.file(filename, pdfBlob);
          successCount++;
          console.log(`[BulkPDF] Added ${filename} (${pdfBlob.size} bytes)`);
        }
      } catch (err) {
        console.error("[BulkPDF] PDF generation failed for", inv.invoice_no, err);
      }
    }

    if (successCount === 0) {
      setBulkZipProgress({ current: 0, total: 0, active: false });
      toast({ title: "PDF generation failed for all selected invoices", variant: "destructive" });
      return;
    }

    const blob = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = zipName;
    a.click();
    URL.revokeObjectURL(url);
    setBulkZipProgress({ current: 0, total: 0, active: false });
    toast({ title: `Downloaded ${successCount} invoices as PDF` });
  };

  // Bulk download ZIP (selected invoices — finalized only)
  const handleBulkDownloadZip = async () => {
    const selected = filtered.filter(inv => selectedIds.has(inv.id));
    if (selected.length === 0) return;
    const finalized = selected.filter(inv => !["draft", "voided"].includes(inv.effectiveStatus));
    const draftCount = selected.length - finalized.length;
    if (finalized.length === 0) {
      toast({ title: "No finalized invoices selected", description: "Please finalize the invoice(s) before downloading.", variant: "destructive" });
      return;
    }
    if (draftCount > 0) {
      toast({ title: `Skipping ${draftCount} draft invoice(s)`, description: "Only finalized invoices will be downloaded.", variant: "default" });
    }
    await generateZipFromInvoices(finalized.map(s => s.id), `Invoices_${format(new Date(), "yyyyMMdd")}.zip`);
  };

  // Month-wise download
  const handleMonthDownload = async () => {
    const month = parseInt(dlMonth);
    const year = parseInt(dlYear);
    const startDate = `${year}-${String(month).padStart(2, "0")}-01`;
    const endDay = new Date(year, month, 0).getDate();
    const endDate = `${year}-${String(month).padStart(2, "0")}-${endDay}`;

    let q = supabase.from("invoices").select("id, invoice_no, client_id, to_name, status")
      .in("document_type", docTypeFilter)
      .gte("invoice_date", startDate)
      .lte("invoice_date", endDate)
      .not("status", "in", "(draft,voided)"); // Only finalized/sent/paid — never drafts or voided
    if (dlFirm !== "all") q = q.eq("firm_id", dlFirm);
    else if (!isSuperadmin && firmId) q = q.eq("firm_id", firmId);

    const { data } = await q;
    if (!data || data.length === 0) {
      toast({ title: "No finalized invoices found for selected month", description: "Draft invoices are excluded from downloads.", variant: "destructive" });
      return;
    }

    const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    const firmLabel = dlFirm !== "all" ? (firmMap[dlFirm] || "Firm").replace(/[^a-zA-Z0-9]/g, "_") : "AllFirms";
    const zipName = `Invoices_${monthNames[month - 1]}_${year}_${firmLabel}.zip`;

    setMonthDownloadOpen(false);
    await generateZipFromInvoices(data.map(d => d.id), zipName);
    toast({ title: `Downloaded ${data.length} invoices for ${monthNames[month - 1]} ${year}` });
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
    ? ["draft", "finalized", "sent", "paid", "overdue", "voided"]
    : documentType === "quotation_proforma"
      ? ["draft", "finalized", "sent", "converted"]
      : ["draft", "finalized", "sent", "paid", "voided"];

  const colCount = documentType === "quotation_proforma" ? 10 : 9;

  // Excel export of exactly what the register shows: same filters, grouping and totals.
  const handleExportRegisterXlsx = () => {
    const isQP = documentType === "quotation_proforma";
    const head = ["Doc No", ...(isQP ? ["Type"] : []), "Client", "Firm", "Date", "Amount (₹)", "Status", "Due Date"];
    const toRow = (inv: any) => [
      inv.invoice_no || "",
      ...(isQP ? [inv.document_type || ""] : []),
      clientMap[inv.client_id || ""]?.name || inv.to_name || "",
      firmMap[inv.firm_id || ""] || "",
      inv.invoice_date ? format(new Date(inv.invoice_date), "dd/MM/yyyy") : "",
      docTotal(inv),
      statusLabel(inv.effectiveStatus),
      inv.due_date ? format(new Date(inv.due_date), "dd/MM/yyyy") : "",
    ];
    const amtIdx = head.indexOf("Amount (₹)");
    const totalRow = (label: string, amt: number) => { const r: any[] = head.map(() => ""); r[0] = label; r[amtIdx] = amt; return r; };
    const aoa: any[][] = [[`${tabLabel} Register`], [`Generated: ${format(new Date(), "dd/MM/yyyy HH:mm")}`], [], head];
    if (viewBy !== "all" && groupedInvoices) {
      groupedInvoices.forEach(g => {
        aoa.push([g.label]);
        g.invoices.forEach(inv => aoa.push(toRow(inv)));
        aoa.push(totalRow(`Subtotal — ${g.label}`, g.subtotal));
        aoa.push([]);
      });
    } else {
      filtered.forEach(inv => aoa.push(toRow(inv)));
    }
    aoa.push(totalRow(`Total (${filtered.length} documents)`, filtered.reduce((s, i) => s + docTotal(i), 0)));
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = head.map(h => ({ wch: h === "Client" ? 32 : 14 }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Register");
    XLSX.writeFile(wb, `${tabLabel.replace(/[^A-Za-z]+/g, "_")}_Register_${format(new Date(), "yyyyMMdd")}.xlsx`);
  };

  const renderInvoiceRow = (inv: Invoice & { effectiveStatus: string }) => {
    const clientName = clientMap[inv.client_id || ""]?.name || (inv as any).to_name || "—";
    const firmName = firmMap[inv.firm_id || ""] || "—";
    const total = rawDocTotal(inv);
    return (
      <TableRow key={inv.id} className={cn(selectedIds.has(inv.id) && "bg-accent/30")}>
        <TableCell>
          <Checkbox checked={selectedIds.has(inv.id)} onCheckedChange={() => toggleSelect(inv.id)} />
        </TableCell>
        <TableCell className="font-mono text-sm">{inv.invoice_no || "—"}</TableCell>
        {documentType === "quotation_proforma" && (
          <TableCell><Badge variant="outline" className="text-xs capitalize">{inv.document_type}</Badge></TableCell>
        )}
        <TableCell className="font-medium">{clientName}</TableCell>
        <TableCell className="text-sm text-muted-foreground">{firmName}</TableCell>
        <TableCell className="text-sm">{inv.invoice_date ? format(new Date(inv.invoice_date), "dd/MM/yyyy") : "—"}</TableCell>
        <TableCell className={cn("text-right font-semibold tabular-nums", inv.effectiveStatus === "voided" && "line-through text-muted-foreground")}>₹{total.toLocaleString("en-IN")}</TableCell>
        <TableCell>
          <Badge className={cn("text-xs capitalize", STATUS_COLORS[inv.effectiveStatus] || STATUS_COLORS.draft)}>{statusLabel(inv.effectiveStatus)}</Badge>
        </TableCell>
        <TableCell className="text-sm">{inv.due_date ? format(new Date(inv.due_date), "dd/MM/yyyy") : "—"}</TableCell>
        <TableCell>
          <div className="flex gap-0.5">
            <Button variant="ghost" size="icon" className="h-7 w-7" title="View/Edit" onClick={() => navigate(`/billing/edit/${inv.id}`)}>
              <Eye size={14} />
            </Button>
            {inv.effectiveStatus !== "voided" && (
              <Button variant="ghost" size="icon" className="h-7 w-7" title="Share" onClick={() => openShareDialog(inv)}>
                <Share2 size={14} />
              </Button>
            )}
            {documentType === "quotation_proforma" && inv.effectiveStatus === "finalized" && (
              <Button variant="ghost" size="icon" className="h-7 w-7" title="Convert to Invoice" onClick={() => navigate(`/billing/new?type=invoice&source=${inv.id}`)}>
                <RefreshCw size={14} className="text-primary" />
              </Button>
            )}
            {documentType === "quotation_proforma" && inv.effectiveStatus === "converted" && (
              <Button variant="ghost" size="icon" className="h-7 w-7 cursor-default opacity-50" title="Already converted" disabled>
                <RefreshCw size={14} />
              </Button>
            )}
            {(inv.effectiveStatus === "draft" || inv.effectiveStatus === "finalized") && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-7 w-7" title="Send">
                    <Send size={14} />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => openShareDialog(inv)} className="gap-2">
                    <Mail size={14} /> Send to Client
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleSend(inv, true)} className="gap-2">
                    <User size={14} /> Notify Responsible Person
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            {canDelete && !isDocLocked(inv) && inv.document_type !== "quotation" && inv.document_type !== "proforma"
              && ["finalized", "sent", "overdue", "paid"].includes(inv.effectiveStatus) && (
              <Button variant="ghost" size="icon" className="h-7 w-7" title="Cancel this document"
                onClick={() => { setCancelReason(""); setCancelTarget(inv); }}>
                <Ban size={14} className="text-amber-600" />
              </Button>
            )}
            {canDelete && isDocLocked(inv) && (
              <Button variant="ghost" size="icon" className="h-7 w-7 cursor-default opacity-50" disabled
                title={lockMessage(inv.invoice_date!, lockDays[inv.firm_id || ""]!)}>
                <Lock size={14} />
              </Button>
            )}
            {canDelete && !isDocLocked(inv) && inv.effectiveStatus !== "paid" && inv.effectiveStatus !== "converted" && inv.effectiveStatus !== "voided" && (
              <Button variant="ghost" size="icon" className="h-7 w-7" title="Delete" onClick={() => setDeleteId(inv.id)}>
                <Trash2 size={14} className="text-destructive" />
              </Button>
            )}
          </div>
        </TableCell>
      </TableRow>
    );
  };

  return (
    <div className="space-y-4">
      {/* Billing Reminders — paused; re-enable by setting REMINDERS_ENABLED = true above */}

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
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline" className="gap-1" disabled={bulkZipProgress.active}>
                <Archive size={14} /> {bulkZipProgress.active ? `PDF ${bulkZipProgress.current}/${bulkZipProgress.total}` : "Download ZIP"} <ChevronDown size={12} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={handleBulkDownloadZip}>
                <Download size={14} className="mr-2" /> Download Selected ({selectedIds.size})
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setMonthDownloadOpen(true)}>
                <Archive size={14} className="mr-2" /> Download by Month
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
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
          fromDate={fromDate} setFromDate={setFromDate} toDate={toDate} setToDate={setToDate}
          firms={firms} groups={groups} responsiblePersons={responsiblePersons}
          statusOptions={statusOptions}
        />
        <Select value={viewBy} onValueChange={(v: any) => setViewBy(v)}>
          <SelectTrigger className="w-[160px]"><SelectValue placeholder="View By" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All (Default)</SelectItem>
            <SelectItem value="responsible">Responsible Person</SelectItem>
            <SelectItem value="group">Group Wise</SelectItem>
            <SelectItem value="firm">Firm Wise</SelectItem>
            <SelectItem value="multifirm">Multi-Firm</SelectItem>
          </SelectContent>
        </Select>
        <div className="flex-1" />
        {/* Email & WhatsApp quick-send buttons — always visible in every sub-tab */}
        <Button
          variant="outline"
          className="gap-1"
          onClick={() => {
            if (selectedIds.size === 0) {
              toast({ title: "Select documents first", description: "Tick the checkboxes next to the documents you want to send." });
            } else {
              setBulkSendMode("email");
              setBulkSendOpen(true);
            }
          }}
        >
          <Mail size={14} /> Email
          {selectedIds.size > 0 && <span className="ml-1 text-xs bg-primary text-primary-foreground rounded-full px-1.5 py-0.5 leading-none">{selectedIds.size}</span>}
        </Button>
        <Button
          variant="outline"
          className="gap-1"
          onClick={() => {
            if (selectedIds.size === 0) {
              toast({ title: "Select documents first", description: "Tick the checkboxes next to the documents you want to send via WhatsApp." });
            } else {
              setBulkSendMode("whatsapp");
              setBulkSendOpen(true);
            }
          }}
        >
          <MessageSquare size={14} /> WhatsApp
          {selectedIds.size > 0 && <span className="ml-1 text-xs bg-green-600 text-white rounded-full px-1.5 py-0.5 leading-none">{selectedIds.size}</span>}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" className="gap-1" disabled={bulkZipProgress.active}>
              <Archive size={14} /> {bulkZipProgress.active ? `PDF ${bulkZipProgress.current}/${bulkZipProgress.total}` : "Bulk Download"} <ChevronDown size={12} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={async () => {
              const finalizedList = filtered.filter(inv => !["draft", "voided"].includes(inv.effectiveStatus));
              if (finalizedList.length === 0) {
                toast({ title: "No finalized invoices", description: "Please finalize invoice(s) before downloading.", variant: "destructive" });
                return;
              }
              const draftSkipped = filtered.length - finalizedList.length;
              if (draftSkipped > 0) toast({ title: `Skipping ${draftSkipped} draft(s)`, description: "Only finalized invoices will be downloaded." });
              await generateZipFromInvoices(finalizedList.map(inv => inv.id), `Invoices_${format(new Date(), "yyyyMMdd")}.zip`);
            }}>
              <Download size={14} className="mr-2" /> Download All ({filtered.filter(i => !["draft", "voided"].includes(i.effectiveStatus)).length} finalized)
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setMonthDownloadOpen(true)}>
              <Archive size={14} className="mr-2" /> Download by Month
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleExportRegisterXlsx} disabled={filtered.length === 0}>
              <FileSpreadsheet size={14} className="mr-2" /> Export Register (Excel)
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button onClick={() => navigate(`/billing/new?type=${newDocType}`)} className="gap-1"><Plus size={14} /> New {tabLabel}</Button>
      </div>

      {/* Month-wise Download Dialog */}
      <Dialog open={monthDownloadOpen} onOpenChange={setMonthDownloadOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Download Invoices by Month</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Month</Label>
                <Select value={dlMonth} onValueChange={setDlMonth}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["January","February","March","April","May","June","July","August","September","October","November","December"].map((m, i) => (
                      <SelectItem key={i} value={String(i + 1)}>{m}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Year</Label>
                <Select value={dlYear} onValueChange={setDlYear}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - i).map(y => (
                      <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {firms.length > 1 && (
              <div>
                <Label>Firm</Label>
                <Select value={dlFirm} onValueChange={setDlFirm}>
                  <SelectTrigger><SelectValue placeholder="All Firms" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Firms</SelectItem>
                    {firms.map(f => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMonthDownloadOpen(false)}>Cancel</Button>
            <Button onClick={handleMonthDownload} disabled={bulkZipProgress.active}>
              {bulkZipProgress.active ? `Generating ${bulkZipProgress.current}/${bulkZipProgress.total}...` : "Generate & Download"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
              ) : viewBy !== "all" && groupedInvoices ? (
                groupedInvoices.map(group => (
                  <>
                    <TableRow key={`hdr-${group.key}`} className="bg-muted/60">
                      <TableCell colSpan={documentType === "quotation_proforma" ? 8 : 7} className="font-semibold text-foreground py-2">
                        {group.label}
                      </TableCell>
                      <TableCell colSpan={2} className="text-right font-semibold text-foreground py-2 tabular-nums">
                        ₹{group.subtotal.toLocaleString("en-IN")}
                      </TableCell>
                    </TableRow>
                    {group.invoices.map(inv => renderInvoiceRow(inv))}
                  </>
                ))
              ) : filtered.map(inv => renderInvoiceRow(inv))}
            </TableBody>
            {filtered.length > 0 && (
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={colCount - 4} className="font-semibold text-foreground">
                    {viewBy !== "all" && groupedInvoices && groupedInvoices.length > 1
                      ? `Grand Total (${groupedInvoices.length} groups)`
                      : `Total (${filtered.length} document${filtered.length !== 1 ? "s" : ""})`}
                  </TableCell>
                  <TableCell className="text-right font-bold tabular-nums text-foreground">
                    ₹{filtered.reduce((s, i) => s + docTotal(i), 0).toLocaleString("en-IN")}
                  </TableCell>
                  <TableCell colSpan={3} />
                </TableRow>
              </TableFooter>
            )}
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

      {/* Cancel document */}
      <Dialog open={!!cancelTarget} onOpenChange={o => { if (!o) setCancelTarget(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Cancel {cancelTarget?.document_type === "credit_note" ? "credit note" : "invoice"} {cancelTarget?.invoice_no}?</DialogTitle></DialogHeader>
          <div className="space-y-3 text-sm">
            <p className="text-muted-foreground">
              The document stays on file marked <b>Cancelled</b> and its number is never reused, but its amount is
              removed from every ledger, statement, report and reminder from now on. Copies already sent to the
              client are not recalled — tell the client separately. This cannot be undone.
            </p>
            <Textarea placeholder="Reason for cancellation (required)" value={cancelReason} onChange={e => setCancelReason(e.target.value)} rows={3} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelTarget(null)}>Keep document</Button>
            <Button variant="destructive" disabled={cancelling || !cancelReason.trim()} onClick={handleCancelDocument}>
              {cancelling ? "Cancelling…" : "Cancel document"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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

      {/* Share Document Dialog */}
      <Dialog open={shareOpen} onOpenChange={setShareOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Share2 size={18} />
              Share {shareInvoice?.document_type === "credit_note" ? "Credit Note"
                : shareInvoice?.document_type === "quotation" ? "Quotation"
                : shareInvoice?.document_type === "proforma" ? "Proforma"
                : "Invoice"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {/* To field */}
            <div>
              <Label className="text-xs font-semibold uppercase text-muted-foreground mb-1.5 block">To</Label>
              {shareInvoice && getClientAllEmails(shareInvoice.client_id || "").length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {getClientAllEmails(shareInvoice.client_id || "").map(email => (
                    <button
                      key={email}
                      type="button"
                      onClick={() => setShareEmail(email)}
                      className={cn(
                        "px-3 py-1 rounded-full text-xs border transition-colors",
                        shareEmail === email
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-muted text-muted-foreground border-border hover:border-primary"
                      )}
                    >
                      {email}
                    </button>
                  ))}
                </div>
              ) : (
                <Input value={shareEmail} onChange={e => setShareEmail(e.target.value)} placeholder="client@example.com" />
              )}
              {shareInvoice && getClientAllEmails(shareInvoice.client_id || "").length > 0 && (
                <Input
                  className="mt-2"
                  value={shareEmail === getClientAllEmails(shareInvoice.client_id || "")[0] ? "" : shareEmail}
                  onChange={e => setShareEmail(e.target.value)}
                  placeholder="Or type a custom To address..."
                />
              )}
            </div>
            {/* CC field */}
            <div>
              <Label className="text-xs font-semibold uppercase text-muted-foreground mb-1.5 block">CC</Label>
              {shareInvoice && getClientAllEmails(shareInvoice.client_id || "").length > 1 && (
                <div className="flex flex-wrap gap-2 mb-2">
                  {getClientAllEmails(shareInvoice.client_id || "").filter(e => e !== shareEmail).map(email => (
                    <button
                      key={email}
                      type="button"
                      onClick={() => setShareCC(prev => prev.includes(email) ? prev.filter(e => e !== email) : [...prev, email])}
                      className={cn(
                        "px-3 py-1 rounded-full text-xs border transition-colors",
                        shareCC.includes(email)
                          ? "bg-blue-600 text-white border-blue-600"
                          : "bg-muted text-muted-foreground border-border hover:border-blue-400"
                      )}
                    >
                      {email}
                    </button>
                  ))}
                </div>
              )}
              {shareCC.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {shareCC.map(email => (
                    <span key={email} className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 text-xs">
                      {email}
                      <button type="button" onClick={() => setShareCC(prev => prev.filter(e => e !== email))}><X size={10} /></button>
                    </span>
                  ))}
                </div>
              )}
              <Input
                value={shareCCInput}
                onChange={e => setShareCCInput(e.target.value)}
                onKeyDown={e => {
                  if ((e.key === "Enter" || e.key === ",") && shareCCInput.trim()) {
                    e.preventDefault();
                    const email = shareCCInput.trim().replace(/,$/, "");
                    if (email && !shareCC.includes(email)) setShareCC(prev => [...prev, email]);
                    setShareCCInput("");
                  }
                }}
                placeholder="Add CC address and press Enter..."
              />
            </div>
            <div>
              <Label>WhatsApp Number</Label>
              <div className="flex gap-2 items-center">
                <span className="text-sm text-muted-foreground">+91</span>
                <Input value={sharePhone} onChange={e => setSharePhone(e.target.value)} placeholder="9876543210" />
              </div>
            </div>
            <div>
              <Label>Subject</Label>
              <Input value={shareSubject} onChange={e => setShareSubject(e.target.value)} />
            </div>
            <div>
              <Label>Message</Label>
              <Textarea value={shareMessage} onChange={e => setShareMessage(e.target.value)} rows={4} />
            </div>
            <div className="flex items-center gap-2 p-2.5 rounded-md bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800">
              <FileText size={14} className="text-emerald-600 dark:text-emerald-400 shrink-0" />
              <div className="text-sm">
                <span className="font-medium text-emerald-700 dark:text-emerald-300">PDF attached automatically — </span>
                <span className="text-emerald-600 dark:text-emerald-400">{shareInvoice?.invoice_no || "document"}.pdf</span>
              </div>
            </div>
            <div className="flex items-center gap-6">
              <Label className="text-sm font-medium">Send via:</Label>
              <label className="flex items-center gap-2 cursor-pointer">
                <Checkbox checked={shareViaEmail} onCheckedChange={(v) => setShareViaEmail(!!v)} />
                <Mail size={14} /> Email
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <Checkbox checked={shareViaWhatsApp} onCheckedChange={(v) => setShareViaWhatsApp(!!v)} />
                <Phone size={14} /> WhatsApp
              </label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShareOpen(false)} disabled={shareSending}>Cancel</Button>
            <Button onClick={handleShareSend} disabled={shareSending || (!shareViaEmail && !shareViaWhatsApp)} className="gap-1">
              <Send size={14} /> {shareSending ? "Sending..." : "Send"}
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
function ReceiptsTab({ overrideFirmId }: { overrideFirmId?: string | null }) {
  return <ReceiptsTabComponent overrideFirmId={overrideFirmId} />;
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
    // ROOT-CAUSE FIX (Manager couldn't add items — RLS blocked the insert):
    // invoice_item_masters has firm_scope_insert policy:
    //   WITH CHECK (is_superadmin() OR firm_id = current_user_firm_id())
    // The previous code wrote firm_id: null, so for a non-superadmin Manager
    // (current_user_firm_id() != null) the check failed and PG returned
    //   "new row violates row-level security policy for table
    //    'invoice_item_masters'"
    // — the toast the user reported. firm_id IS NULL rows are reserved for
    // superadmin-seeded GLOBAL items (still visible to every firm via the
    // SELECT policy's "firm_id IS NULL" branch). Firm-added items must be
    // scoped to that firm's id so the policy passes.
    const { error } = await supabase.from("invoice_item_masters").insert({
      firm_id: user?.firm_id ?? null,
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
    // Don't blindly reset firm_id on update — leave whatever the row had so
    // a global (firm_id IS NULL) item stays global and a firm-scoped item
    // stays scoped to its firm. firm_scope_update RLS still rejects a write
    // that targets another firm's row, so this is safe.
    const { error } = await supabase.from("invoice_item_masters").update({
      description: editDesc.trim(), hsn_sac_code: editHsn.trim() || null,
      default_rate: editRate ? Number(editRate) : null,
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
        // Same RLS fix as addItem — bulk inserts must carry the firm_id so
        // the firm_scope_insert policy passes for non-superadmin uploads.
        const inserts = rows.map(r => ({
          firm_id: user?.firm_id ?? null,
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
        <p className="text-sm text-muted-foreground">
          Your firm&apos;s Item Master. Global items (seeded by superadmin) are also visible to every firm.
        </p>
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
      let q = supabase.from("clients").select("id, name").eq("is_draft", false).order("name");
      if (!isSuperadmin && firmId) q = q.eq("firm_id", firmId);
      const { data } = await q;
      setClients(data || []);
    })();
    (async () => {
      if (isManager || isSuperadmin) {
        let q = supabase.from("users").select("id, name").neq("role", "client").eq("is_active", true);
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
// REPORTS TAB (replaced by BillingDashboardTab)
// ═══════════════════════════════════════
function ReportsTab_UNUSED() {
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
