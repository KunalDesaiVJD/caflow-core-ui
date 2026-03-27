import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter,
} from "@/components/ui/sheet";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { format, differenceInDays } from "date-fns";
import { cn } from "@/lib/utils";
import {
  Plus, Trash2, Download, Upload, Search,
  FileText, AlertTriangle, CheckCircle2,
  XCircle, LayoutDashboard, PenLine,
  ShieldCheck, BarChart3, Settings,
} from "lucide-react";
import { TdsRateMaster } from "@/components/tds/TdsRateMaster";
import { TdsDashboard } from "@/components/tds/TdsDashboard";
import { TdsFilingsManager } from "@/components/tds/TdsFilingsManager";

// ─── Constants ───
const CURRENT_FY_START = new Date().getMonth() >= 3 ? new Date().getFullYear() : new Date().getFullYear() - 1;
const DEFAULT_FY = `${CURRENT_FY_START}-${String(CURRENT_FY_START + 1).slice(2)}`;
const FY_OPTIONS = Array.from({ length: 7 }, (_, i) => {
  const s = 2020 + i;
  return `${s}-${String(s + 1).slice(2)}`;
});

const QUARTER_OPTIONS = ["Q1", "Q2", "Q3", "Q4"];
const TDS_FORMS = ["24Q", "26Q", "27Q", "27EQ"] as const;

const SECTIONS_26Q = [
  { code: "194C", label: "194C — Contractor/Sub-contractor", rate_ind: 1, rate_co: 2, threshold: 30000, agg_threshold: 100000 },
  { code: "194J", label: "194J — Professional/Technical", rate_ind: 10, rate_co: 10, threshold: 30000 },
  { code: "194I(a)", label: "194I(a) — Rent (Plant & Machinery)", rate_ind: 2, rate_co: 2, threshold: 240000 },
  { code: "194I(b)", label: "194I(b) — Rent (Land & Building)", rate_ind: 10, rate_co: 10, threshold: 240000 },
  { code: "194A", label: "194A — Interest other than securities", rate_ind: 10, rate_co: 10, threshold: 40000 },
  { code: "194H", label: "194H — Commission/Brokerage", rate_ind: 5, rate_co: 5, threshold: 15000 },
  { code: "194M", label: "194M — Contractor (by Individual/HUF)", rate_ind: 5, rate_co: 5, threshold: 5000000 },
  { code: "194Q", label: "194Q — Purchase of Goods", rate_ind: 0.1, rate_co: 0.1, threshold: 5000000 },
  { code: "194T", label: "194T — Partner Payment", rate_ind: 10, rate_co: 10, threshold: 20000 },
  { code: "194B", label: "194B — Lottery/Crossword", rate_ind: 30, rate_co: 30, threshold: 10000 },
  { code: "194D", label: "194D — Insurance Commission", rate_ind: 5, rate_co: 10, threshold: 15000 },
  { code: "194DA", label: "194DA — Life Insurance Payout", rate_ind: 5, rate_co: 5, threshold: 100000 },
  { code: "194E", label: "194E — Non-resident sportsman", rate_ind: 20, rate_co: 20, threshold: 0 },
  { code: "194G", label: "194G — Lottery Commission", rate_ind: 5, rate_co: 5, threshold: 15000 },
  { code: "194K", label: "194K — MF Units Income", rate_ind: 10, rate_co: 10, threshold: 5000 },
  { code: "194N", label: "194N — Cash Withdrawal", rate_ind: 2, rate_co: 2, threshold: 10000000 },
  { code: "194O", label: "194O — E-commerce", rate_ind: 1, rate_co: 1, threshold: 500000 },
  { code: "194R", label: "194R — Benefits/Perquisites (Business)", rate_ind: 10, rate_co: 10, threshold: 20000 },
  { code: "194S", label: "194S — Virtual Digital Asset", rate_ind: 1, rate_co: 1, threshold: 10000 },
];

const SECTIONS_27EQ = [
  { code: "206C(1)", label: "206C(1) — Scrap", rate: 1 },
  { code: "206C(1C)", label: "206C(1C) — Motor Vehicle >10L", rate: 1 },
  { code: "206C(1G)", label: "206C(1G) — Overseas Remittance", rate: 5 },
  { code: "206C(1H)", label: "206C(1H) — Sale of Goods >50L", rate: 0.1 },
];

const FILING_STATUSES = [
  "Not Started", "Entries Verified", "Return Prepared", "Submitted", "Accepted",
] as const;

const FILING_STATUS_COLORS: Record<string, string> = {
  "Not Started": "bg-muted text-muted-foreground",
  "Entries Verified": "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
  "Return Prepared": "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
  "Submitted": "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300",
  "Accepted": "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
};

const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;
const BSR_REGEX = /^\d{7}$/;
const CHALLAN_SERIAL_REGEX = /^\d{5}$/;

// ─── Types ───
interface TdsEntry {
  id: string; client_id: string | null; firm_id: string | null; form_type: string | null;
  party_name: string | null; pan: string | null; deductee_pan: string | null;
  section: string | null; section_code: string | null; nature_of_payment: string | null;
  amount: number | null; tds_rate: number | null; tds_amount: number | null;
  challan_no: string | null; challan_bsr_code: string | null; challan_date: string | null;
  challan_serial_no: string | null; challan_amount: number | null; date: string | null;
  due_date: string | null; status: string | null; payment_mode: string | null;
  lower_cert_no: string | null; lower_cert_rate: number | null;
  validation_status: string | null; validation_messages: any;
  country_of_residence: string | null; trc_available: boolean | null;
  tax_treaty_section: string | null; salary_amount: number | null;
  standard_deduction: number | null; taxable_salary: number | null;
  designation: string | null; deductee_id: string | null;
  tds_filing_id: string | null; filed_at: string | null;
}

interface TdsFiling {
  id: string; client_id: string; firm_id: string; financial_year: string;
  quarter: string; tds_forms: string[] | null; work_status: string;
  date_of_filing: string | null; acknowledgment_number: string | null;
  prn_no: string | null; tan: string | null; assigned_staff: string | null;
  last_updated_by: string | null; last_updated_at: string | null;
  remarks: string | null; created_at: string | null;
}

interface ClientOption { id: string; name: string | null; pan: string | null; }
interface UserOption { id: string; name: string | null; }

// ─── Helpers ───
const formatDateDDMMYYYY = (d: string | null) => {
  if (!d) return "";
  try { return format(new Date(d), "dd/MM/yyyy"); } catch { return d; }
};

const getTdsDueDate = (paymentDate: string) => {
  const d = new Date(paymentDate);
  const month = d.getMonth();
  const year = d.getFullYear();
  if (month === 2) return new Date(year, 3, 30);
  return new Date(year + (month === 11 ? 1 : 0), (month + 1) % 12, 7);
};

const validatePAN = (pan: string): string | null => {
  if (!pan) return null;
  if (!PAN_REGEX.test(pan.toUpperCase())) return "Invalid PAN format (e.g. ABCDE1234F)";
  return null;
};

const validateBSR = (bsr: string): string | null => {
  if (!bsr) return null;
  if (!BSR_REGEX.test(bsr)) return "BSR code must be 7 digits";
  return null;
};

const validateChallanSerial = (serial: string): string | null => {
  if (!serial) return null;
  if (!CHALLAN_SERIAL_REGEX.test(serial)) return "Serial number must be 5 digits";
  return null;
};

// ─── Sidebar Navigation Items ───
const NAV_ITEMS = [
  { key: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { key: "filings", label: "Filings", icon: FileText },
  { key: "data-entry", label: "Data Entry", icon: PenLine },
  { key: "validate", label: "Validate & Finalise", icon: ShieldCheck },
  { key: "reports", label: "Reports", icon: BarChart3 },
  { key: "rate-master", label: "Rate Master", icon: Settings },
] as const;

type NavKey = typeof NAV_ITEMS[number]["key"];

// ═══════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════
const TdsFilings = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [activeSection, setActiveSection] = useState<NavKey>("dashboard");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const [clients, setClients] = useState<ClientOption[]>([]);
  const [users, setUsers] = useState<UserOption[]>([]);
  const isSuperadmin = user?.role === "superadmin";

  const resolveFirmId = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    const metadataFirmId = session?.user?.user_metadata?.firm_id;
    if (typeof metadataFirmId === "string" && metadataFirmId.length > 0) return metadataFirmId;
    return user?.firm_id ?? null;
  }, [user?.firm_id]);

  const fetchClients = useCallback(async () => {
    const firmId = await resolveFirmId();
    const { data: svcData } = await supabase.from("client_services").select("client_id, service_category_id, is_active").eq("is_active", true);
    const { data: categories } = await supabase.from("service_categories").select("id, linked_module").eq("linked_module", "tds");
    const tdsCatIds = new Set((categories || []).map(c => c.id));
    const tdsClientIds = (svcData || []).filter(s => tdsCatIds.has(s.service_category_id)).map(s => s.client_id);
    if (tdsClientIds.length === 0) { setClients([]); return; }
    let q = supabase.from("clients").select("id, name, pan").eq("is_draft", false).is("deleted_at", null).in("id", tdsClientIds).order("name");
    if (!isSuperadmin && firmId) q = q.eq("firm_id", firmId);
    const { data } = await q;
    setClients((data as ClientOption[]) || []);
  }, [isSuperadmin, resolveFirmId]);

  const fetchUsers = useCallback(async () => {
    const firmId = await resolveFirmId();
    let q = supabase.from("users").select("id, name").eq("is_active", true);
    if (!isSuperadmin && firmId) q = q.eq("firm_id", firmId);
    const { data } = await q;
    setUsers((data as UserOption[]) || []);
  }, [isSuperadmin, resolveFirmId]);

  useEffect(() => { fetchClients(); fetchUsers(); }, [fetchClients, fetchUsers]);

  return (
    <div className="flex h-[calc(100vh-4rem)] overflow-hidden">
      {/* Left Sidebar */}
      <div className={cn(
        "border-r bg-muted/30 flex flex-col shrink-0 transition-all duration-200",
        sidebarCollapsed ? "w-14" : "w-48"
      )}>
        <div className="p-3 border-b flex items-center justify-between">
          {!sidebarCollapsed && <span className="text-sm font-semibold text-foreground">TDS Module</span>}
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setSidebarCollapsed(!sidebarCollapsed)}>
            <FileText size={14} />
          </Button>
        </div>
        <nav className="flex-1 py-2 space-y-0.5 px-2">
          {NAV_ITEMS.map(item => (
            <button
              key={item.key}
              onClick={() => setActiveSection(item.key)}
              className={cn(
                "w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-sm transition-colors",
                activeSection === item.key
                  ? "bg-primary text-primary-foreground font-medium"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              <item.icon size={16} className="shrink-0" />
              {!sidebarCollapsed && <span>{item.label}</span>}
            </button>
          ))}
        </nav>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-[1400px] mx-auto">
          {activeSection === "dashboard" && (
            <TdsDashboard
              clients={clients}
              users={users}
              isSuperadmin={isSuperadmin}
              resolveFirmId={resolveFirmId}
              onNavigate={(section, filters) => setActiveSection(section as NavKey)}
            />
          )}
          {activeSection === "filings" && (
            <TdsFilingsManager
              clients={clients}
              users={users}
              isSuperadmin={isSuperadmin}
              resolveFirmId={resolveFirmId}
              onNavigateDataEntry={() => setActiveSection("data-entry")}
            />
          )}
          {activeSection === "data-entry" && (
            <TdsEntriesTab clients={clients} users={users} isSuperadmin={isSuperadmin} resolveFirmId={resolveFirmId} />
          )}
          {activeSection === "validate" && (
            <TdsValidateSection clients={clients} resolveFirmId={resolveFirmId} isSuperadmin={isSuperadmin} />
          )}
          {activeSection === "reports" && (
            <TdsReportsTab clients={clients} resolveFirmId={resolveFirmId} isSuperadmin={isSuperadmin} />
          )}
          {activeSection === "rate-master" && (
            <TdsRateMaster resolveFirmId={resolveFirmId} isSuperadmin={isSuperadmin} />
          )}
        </div>
      </div>
    </div>
  );
};

// ═══════════════════════════════════════
// DASHBOARD
// ═══════════════════════════════════════
interface TabProps {
  clients: ClientOption[];
  users: UserOption[];
  isSuperadmin: boolean;
  resolveFirmId: () => Promise<string | null>;
}

function TdsDashboard({ clients, users, isSuperadmin, resolveFirmId }: TabProps) {
  const [filings, setFilings] = useState<TdsFiling[]>([]);
  const [entries, setEntries] = useState<TdsEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const firmId = await resolveFirmId();
      let fq = supabase.from("tds_filings").select("*").order("created_at", { ascending: false }).limit(200);
      if (!isSuperadmin && firmId) fq = fq.eq("firm_id", firmId);
      const { data: fData } = await fq;

      let eq = supabase.from("tds_entries").select("*").order("date", { ascending: false }).limit(500);
      if (!isSuperadmin && firmId) eq = eq.eq("firm_id", firmId);
      const { data: eData } = await eq;

      setFilings((fData || []) as TdsFiling[]);
      setEntries((eData || []) as TdsEntry[]);
      setLoading(false);
    })();
  }, [resolveFirmId, isSuperadmin]);

  const stats = useMemo(() => {
    const totalEntries = entries.length;
    const totalTds = entries.reduce((s, e) => s + (e.tds_amount || 0), 0);
    const totalPayments = entries.reduce((s, e) => s + (e.amount || 0), 0);
    const warnings = entries.filter(e => e.validation_status === "warning").length;
    const pendingFilings = filings.filter(f => f.work_status !== "Accepted" && f.work_status !== "Submitted").length;
    const completedFilings = filings.filter(f => f.work_status === "Accepted").length;
    return { totalEntries, totalTds, totalPayments, warnings, pendingFilings, completedFilings, totalFilings: filings.length };
  }, [entries, filings]);

  if (loading) return <div className="space-y-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}</div>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">TDS Dashboard</h1>
        <p className="text-sm text-muted-foreground">Overview of TDS/TCS filings, entries and compliance</p>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card><CardContent className="p-4 text-center">
          <p className="text-2xl font-bold text-foreground">{stats.totalEntries}</p>
          <p className="text-xs text-muted-foreground">Total Entries</p>
        </CardContent></Card>
        <Card><CardContent className="p-4 text-center">
          <p className="text-2xl font-bold text-foreground">₹{(stats.totalTds / 100000).toFixed(1)}L</p>
          <p className="text-xs text-muted-foreground">Total TDS Deducted</p>
        </CardContent></Card>
        <Card><CardContent className="p-4 text-center">
          <p className="text-2xl font-bold text-foreground">{stats.pendingFilings}</p>
          <p className="text-xs text-muted-foreground">Pending Filings</p>
        </CardContent></Card>
        <Card><CardContent className="p-4 text-center">
          <p className="text-2xl font-bold text-foreground">{stats.completedFilings}</p>
          <p className="text-xs text-muted-foreground">Accepted Filings</p>
        </CardContent></Card>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card><CardContent className="p-4">
          <p className="text-sm font-semibold mb-2">Recent Filings</p>
          {filings.slice(0, 5).map(f => (
            <div key={f.id} className="flex items-center justify-between py-1.5 border-b last:border-0">
              <span className="text-sm">{clients.find(c => c.id === f.client_id)?.name || "—"}</span>
              <div className="flex gap-2 items-center">
                <Badge variant="outline" className="text-xs">{f.tds_forms?.join(", ")}</Badge>
                <Badge className={cn("text-xs", FILING_STATUS_COLORS[f.work_status] || "")}>{f.work_status}</Badge>
              </div>
            </div>
          ))}
          {filings.length === 0 && <p className="text-sm text-muted-foreground">No filings yet</p>}
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-sm font-semibold mb-2">Warnings & Issues</p>
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle size={16} className="text-amber-500" />
            <span className="text-sm">{stats.warnings} entries with warnings</span>
          </div>
          <div className="flex items-center gap-2">
            <CheckCircle2 size={16} className="text-emerald-500" />
            <span className="text-sm">{stats.totalEntries - stats.warnings} entries validated</span>
          </div>
        </CardContent></Card>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════
// DATA ENTRY TAB (formerly Entries)
// ═══════════════════════════════════════
function TdsEntriesTab({ clients, users, isSuperadmin, resolveFirmId }: TabProps) {
  const { toast } = useToast();
  const [entries, setEntries] = useState<TdsEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedClient, setSelectedClient] = useState<string>("all");
  const [selectedForm, setSelectedForm] = useState<string>("26Q");
  const [selectedQuarter, setSelectedQuarter] = useState<string>("Q1");
  const [selectedFy, setSelectedFy] = useState(DEFAULT_FY);
  const [formOpen, setFormOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<TdsEntry | null>(null);
  const [saving, setSaving] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [formData, setFormData] = useState<Record<string, any>>({});
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    const month = new Date().getMonth();
    if (month >= 3 && month <= 5) setSelectedQuarter("Q1");
    else if (month >= 6 && month <= 8) setSelectedQuarter("Q2");
    else if (month >= 9 && month <= 11) setSelectedQuarter("Q3");
    else setSelectedQuarter("Q4");
  }, []);

  const fetchEntries = useCallback(async () => {
    setLoading(true);
    const firmId = await resolveFirmId();
    let q = supabase.from("tds_entries").select("*").order("date", { ascending: false }).limit(500);
    if (!isSuperadmin && firmId) q = q.eq("firm_id", firmId);
    if (selectedClient !== "all") q = q.eq("client_id", selectedClient);
    if (selectedForm) q = q.eq("form_type", selectedForm);
    const { data } = await q;
    setEntries((data as TdsEntry[]) || []);
    setLoading(false);
  }, [isSuperadmin, resolveFirmId, selectedClient, selectedForm]);

  useEffect(() => { fetchEntries(); }, [fetchEntries]);

  const filtered = useMemo(() => entries.filter(e => {
    if (searchQuery && !(e.party_name || "").toLowerCase().includes(searchQuery.toLowerCase())) return false;
    return true;
  }), [entries, searchQuery]);

  const stats = useMemo(() => ({
    total: filtered.length,
    totalTds: filtered.reduce((s, e) => s + (e.tds_amount || 0), 0),
    totalAmount: filtered.reduce((s, e) => s + (e.amount || 0), 0),
    withErrors: filtered.filter(e => e.validation_status === "error" || e.validation_status === "warning").length,
  }), [filtered]);

  const resetForm = () => {
    setFormData({
      party_name: "", pan: "", section_code: "", nature_of_payment: "",
      amount: "", tds_rate: "", tds_amount: "", date: "",
      challan_bsr_code: "", challan_date: "", challan_serial_no: "", challan_amount: "",
      payment_mode: "", lower_cert_no: "", lower_cert_rate: "",
      country_of_residence: "", trc_available: false, tax_treaty_section: "",
      salary_amount: "", standard_deduction: "", taxable_salary: "", designation: "",
      client_id: selectedClient !== "all" ? selectedClient : "",
    });
    setValidationErrors({});
  };

  const openAdd = () => { setEditingEntry(null); resetForm(); setFormOpen(true); };

  const openEdit = (e: TdsEntry) => {
    setEditingEntry(e);
    setFormData({
      party_name: e.party_name || "", pan: e.deductee_pan || e.pan || "",
      section_code: e.section_code || e.section || "", nature_of_payment: e.nature_of_payment || "",
      amount: e.amount != null ? String(e.amount) : "", tds_rate: e.tds_rate != null ? String(e.tds_rate) : "",
      tds_amount: e.tds_amount != null ? String(e.tds_amount) : "", date: e.date || "",
      challan_bsr_code: e.challan_bsr_code || "", challan_date: e.challan_date || "",
      challan_serial_no: e.challan_serial_no || "", challan_amount: e.challan_amount != null ? String(e.challan_amount) : "",
      payment_mode: e.payment_mode || "", lower_cert_no: e.lower_cert_no || "",
      lower_cert_rate: e.lower_cert_rate != null ? String(e.lower_cert_rate) : "",
      country_of_residence: e.country_of_residence || "", trc_available: e.trc_available || false,
      tax_treaty_section: e.tax_treaty_section || "",
      salary_amount: e.salary_amount != null ? String(e.salary_amount) : "",
      standard_deduction: e.standard_deduction != null ? String(e.standard_deduction) : "",
      taxable_salary: e.taxable_salary != null ? String(e.taxable_salary) : "",
      designation: e.designation || "", client_id: e.client_id || "",
    });
    setValidationErrors({});
    setFormOpen(true);
  };

  const updateField = (key: string, value: any) => {
    setFormData(prev => {
      const next = { ...prev, [key]: value };
      if (key === "amount" || key === "tds_rate") {
        const amt = parseFloat(key === "amount" ? value : next.amount) || 0;
        const rate = parseFloat(key === "tds_rate" ? value : next.tds_rate) || 0;
        next.tds_amount = String(Math.round(amt * rate / 100 * 100) / 100);
      }
      if (key === "section_code") {
        const sec = SECTIONS_26Q.find(s => s.code === value);
        if (sec) {
          next.tds_rate = String(sec.rate_ind);
          const amt = parseFloat(next.amount) || 0;
          next.tds_amount = String(Math.round(amt * sec.rate_ind / 100 * 100) / 100);
          next.nature_of_payment = sec.label;
        }
      }
      if (selectedForm === "24Q" && (key === "salary_amount" || key === "standard_deduction")) {
        const sal = parseFloat(key === "salary_amount" ? value : next.salary_amount) || 0;
        const sd = parseFloat(key === "standard_deduction" ? value : next.standard_deduction) || 0;
        next.taxable_salary = String(sal - sd);
      }
      return next;
    });
    setValidationErrors(prev => { const n = { ...prev }; delete n[key]; return n; });
  };

  const validate = (): boolean => {
    const errors: Record<string, string> = {};
    if (!formData.party_name?.trim()) errors.party_name = "Name is required";
    if (!formData.client_id) errors.client_id = "Select a client";
    if (formData.pan) { const e = validatePAN(formData.pan); if (e) errors.pan = e; }
    if (formData.challan_bsr_code) { const e = validateBSR(formData.challan_bsr_code); if (e) errors.challan_bsr_code = e; }
    if (formData.challan_serial_no) { const e = validateChallanSerial(formData.challan_serial_no); if (e) errors.challan_serial_no = e; }
    if (formData.challan_date && formData.date && new Date(formData.challan_date) < new Date(formData.date)) {
      errors.challan_date = "Challan date cannot be before payment date";
    }
    if (formData.payment_mode === "cash" && parseFloat(formData.amount) > 10000) {
      errors.payment_mode = "Warning: Cash payment >₹10,000 — Section 40A(3) disallowance risk";
    }
    setValidationErrors(errors);
    return !errors.party_name && !errors.client_id && !errors.pan && !errors.challan_bsr_code && !errors.challan_serial_no && !errors.challan_date;
  };

  const handleSave = async () => {
    if (!validate()) return;
    setSaving(true);
    try {
      const firmId = await resolveFirmId();
      const warnings: string[] = [];
      const sec = SECTIONS_26Q.find(s => s.code === formData.section_code);
      if (sec && formData.tds_rate && parseFloat(formData.tds_rate) !== sec.rate_ind) {
        warnings.push(`Rate ${formData.tds_rate}% deviates from standard ${sec.rate_ind}%`);
      }
      if (formData.date) {
        const dueDate = getTdsDueDate(formData.date);
        if (formData.challan_date && new Date(formData.challan_date) > dueDate) {
          warnings.push(`Challan date is after due date (${format(dueDate, "dd/MM/yyyy")})`);
        }
      }
      if ((parseFloat(formData.tds_amount) || 0) === 0 && (parseFloat(formData.amount) || 0) > 0) {
        warnings.push("NIL deduction on taxable payment");
      }

      const payload = {
        party_name: formData.party_name, pan: formData.pan?.toUpperCase() || null,
        deductee_pan: formData.pan?.toUpperCase() || null,
        section: formData.section_code || null, section_code: formData.section_code || null,
        nature_of_payment: formData.nature_of_payment || null,
        amount: parseFloat(formData.amount) || null, tds_rate: parseFloat(formData.tds_rate) || null,
        tds_amount: parseFloat(formData.tds_amount) || null, date: formData.date || null,
        challan_bsr_code: formData.challan_bsr_code || null, challan_date: formData.challan_date || null,
        challan_serial_no: formData.challan_serial_no || null,
        challan_amount: parseFloat(formData.challan_amount) || null,
        payment_mode: formData.payment_mode || null,
        lower_cert_no: formData.lower_cert_no || null,
        lower_cert_rate: parseFloat(formData.lower_cert_rate) || null,
        form_type: selectedForm, client_id: formData.client_id, firm_id: firmId,
        validation_status: warnings.length > 0 ? "warning" : "valid", validation_messages: warnings,
        country_of_residence: selectedForm === "27Q" ? formData.country_of_residence || null : null,
        trc_available: selectedForm === "27Q" ? formData.trc_available : null,
        tax_treaty_section: selectedForm === "27Q" ? formData.tax_treaty_section || null : null,
        salary_amount: selectedForm === "24Q" ? parseFloat(formData.salary_amount) || null : null,
        standard_deduction: selectedForm === "24Q" ? parseFloat(formData.standard_deduction) || null : null,
        taxable_salary: selectedForm === "24Q" ? parseFloat(formData.taxable_salary) || null : null,
        designation: selectedForm === "24Q" ? formData.designation || null : null,
      };

      if (editingEntry) {
        const { error } = await supabase.from("tds_entries").update(payload).eq("id", editingEntry.id);
        if (error) throw error;
        toast({ title: "Entry updated" });
      } else {
        const { error } = await supabase.from("tds_entries").insert(payload);
        if (error) throw error;
        toast({ title: "Entry added" });
      }
      setFormOpen(false);
      fetchEntries();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
    setSaving(false);
  };

  const handleDelete = async (id: string) => {
    const { error } = await supabase.from("tds_entries").delete().eq("id", id);
    if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
    else { toast({ title: "Deleted" }); fetchEntries(); }
  };

  const renderChallanFields = () => (
    <div className="space-y-3 border-t pt-3">
      <p className="text-xs font-semibold text-muted-foreground uppercase">Challan Details</p>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label>BSR Code (7 digits)</Label>
          <Input value={formData.challan_bsr_code || ""} onChange={e => updateField("challan_bsr_code", e.target.value)} maxLength={7} />
          {validationErrors.challan_bsr_code && <p className="text-xs text-destructive">{validationErrors.challan_bsr_code}</p>}
        </div>
        <div className="space-y-1">
          <Label>Challan Date</Label>
          <Input type="date" value={formData.challan_date || ""} onChange={e => updateField("challan_date", e.target.value)} />
          {validationErrors.challan_date && <p className="text-xs text-destructive">{validationErrors.challan_date}</p>}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label>Serial No (5 digits)</Label>
          <Input value={formData.challan_serial_no || ""} onChange={e => updateField("challan_serial_no", e.target.value)} maxLength={5} />
          {validationErrors.challan_serial_no && <p className="text-xs text-destructive">{validationErrors.challan_serial_no}</p>}
        </div>
        <div className="space-y-1">
          <Label>Challan Amount</Label>
          <Input type="number" value={formData.challan_amount || ""} onChange={e => updateField("challan_amount", e.target.value)} />
        </div>
      </div>
    </div>
  );

  const renderFormFields = () => {
    const commonFields = (
      <>
        <div className="space-y-1">
          <Label>Client *</Label>
          <Select value={formData.client_id || ""} onValueChange={v => updateField("client_id", v)}>
            <SelectTrigger><SelectValue placeholder="Select client" /></SelectTrigger>
            <SelectContent>{clients.map(c => <SelectItem key={c.id} value={c.id}>{c.name} ({c.pan})</SelectItem>)}</SelectContent>
          </Select>
          {validationErrors.client_id && <p className="text-xs text-destructive">{validationErrors.client_id}</p>}
        </div>
        <div className="space-y-1">
          <Label>{selectedForm === "27EQ" ? "Collectee Name" : "Deductee Name"} *</Label>
          <Input value={formData.party_name || ""} onChange={e => updateField("party_name", e.target.value)} />
          {validationErrors.party_name && <p className="text-xs text-destructive">{validationErrors.party_name}</p>}
        </div>
        <div className="space-y-1">
          <Label>PAN</Label>
          <Input value={formData.pan || ""} onChange={e => updateField("pan", e.target.value.toUpperCase())} maxLength={10} placeholder="ABCDE1234F" />
          {validationErrors.pan && <p className="text-xs text-destructive">{validationErrors.pan}</p>}
        </div>
      </>
    );

    if (selectedForm === "24Q") {
      return (
        <div className="space-y-3">
          {commonFields}
          <div className="space-y-1"><Label>Designation</Label><Input value={formData.designation || ""} onChange={e => updateField("designation", e.target.value)} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><Label>Salary Amount</Label><Input type="number" value={formData.salary_amount || ""} onChange={e => updateField("salary_amount", e.target.value)} /></div>
            <div className="space-y-1"><Label>Standard Deduction</Label><Input type="number" value={formData.standard_deduction || ""} onChange={e => updateField("standard_deduction", e.target.value)} /></div>
          </div>
          <div className="space-y-1"><Label>Taxable Salary (auto)</Label><Input value={formData.taxable_salary || ""} readOnly className="bg-muted" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><Label>TDS Deducted</Label><Input type="number" value={formData.tds_amount || ""} onChange={e => updateField("tds_amount", e.target.value)} /></div>
            <div className="space-y-1"><Label>Payment Date</Label><Input type="date" value={formData.date || ""} onChange={e => updateField("date", e.target.value)} /></div>
          </div>
          {renderChallanFields()}
        </div>
      );
    }

    if (selectedForm === "27EQ") {
      return (
        <div className="space-y-3">
          {commonFields}
          <div className="space-y-1">
            <Label>Nature of Transaction (TCS Section)</Label>
            <Select value={formData.section_code || ""} onValueChange={v => {
              const sec = SECTIONS_27EQ.find(s => s.code === v);
              updateField("section_code", v);
              if (sec) { updateField("tds_rate", String(sec.rate)); updateField("nature_of_payment", sec.label); }
            }}>
              <SelectTrigger><SelectValue placeholder="Select section" /></SelectTrigger>
              <SelectContent>{SECTIONS_27EQ.map(s => <SelectItem key={s.code} value={s.code}>{s.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1"><Label>Amount</Label><Input type="number" value={formData.amount || ""} onChange={e => updateField("amount", e.target.value)} /></div>
            <div className="space-y-1"><Label>TCS Rate %</Label><Input type="number" value={formData.tds_rate || ""} onChange={e => updateField("tds_rate", e.target.value)} /></div>
            <div className="space-y-1"><Label>TCS Amount</Label><Input value={formData.tds_amount || ""} readOnly className="bg-muted" /></div>
          </div>
          <div className="space-y-1"><Label>Payment Date</Label><Input type="date" value={formData.date || ""} onChange={e => updateField("date", e.target.value)} /></div>
          {renderChallanFields()}
        </div>
      );
    }

    // 26Q and 27Q
    return (
      <div className="space-y-3">
        {commonFields}
        <div className="space-y-1">
          <Label>Nature of Payment (Section)</Label>
          <Select value={formData.section_code || ""} onValueChange={v => updateField("section_code", v)}>
            <SelectTrigger><SelectValue placeholder="Select section" /></SelectTrigger>
            <SelectContent>{SECTIONS_26Q.map(s => <SelectItem key={s.code} value={s.code}>{s.label}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div className="space-y-1"><Label>Amount Paid/Credited</Label><Input type="number" value={formData.amount || ""} onChange={e => updateField("amount", e.target.value)} /></div>
          <div className="space-y-1">
            <Label>TDS Rate %</Label>
            <Input type="number" value={formData.tds_rate || ""} onChange={e => updateField("tds_rate", e.target.value)} />
            {formData.tds_rate && formData.section_code && (() => {
              const sec = SECTIONS_26Q.find(s => s.code === formData.section_code);
              if (sec && parseFloat(formData.tds_rate) !== sec.rate_ind) return <p className="text-xs text-amber-600">⚠ Standard rate is {sec.rate_ind}%</p>;
              return null;
            })()}
          </div>
          <div className="space-y-1"><Label>TDS Amount</Label><Input value={formData.tds_amount || ""} readOnly className="bg-muted" /></div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1"><Label>Lower Deduction Cert (Form 13)</Label><Input value={formData.lower_cert_no || ""} onChange={e => updateField("lower_cert_no", e.target.value)} placeholder="Certificate No" /></div>
          <div className="space-y-1"><Label>Certificate Rate %</Label><Input type="number" value={formData.lower_cert_rate || ""} onChange={e => updateField("lower_cert_rate", e.target.value)} /></div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1"><Label>Payment Date</Label><Input type="date" value={formData.date || ""} onChange={e => updateField("date", e.target.value)} /></div>
          <div className="space-y-1">
            <Label>Payment Mode</Label>
            <Select value={formData.payment_mode || ""} onValueChange={v => updateField("payment_mode", v)}>
              <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="bank">Bank Transfer</SelectItem>
                <SelectItem value="cheque">Cheque</SelectItem>
                <SelectItem value="cash">Cash</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
            {validationErrors.payment_mode && <p className="text-xs text-amber-600">{validationErrors.payment_mode}</p>}
          </div>
        </div>
        {selectedForm === "27Q" && (
          <div className="space-y-3 border-t pt-3">
            <p className="text-xs font-semibold text-muted-foreground uppercase">NRI Details</p>
            <div className="space-y-1"><Label>Country of Residence</Label><Input value={formData.country_of_residence || ""} onChange={e => updateField("country_of_residence", e.target.value)} /></div>
            <div className="flex items-center gap-2"><Switch checked={formData.trc_available || false} onCheckedChange={v => updateField("trc_available", v)} /><Label>Tax Residency Certificate (TRC) Available</Label></div>
            <div className="space-y-1"><Label>Tax Treaty Section</Label><Input value={formData.tax_treaty_section || ""} onChange={e => updateField("tax_treaty_section", e.target.value)} /></div>
          </div>
        )}
        {renderChallanFields()}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div><h2 className="text-xl font-bold text-foreground">Data Entry</h2><p className="text-sm text-muted-foreground">Add and manage TDS/TCS entries</p></div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card><CardContent className="p-4 text-center"><p className="text-2xl font-bold">{stats.total}</p><p className="text-xs text-muted-foreground">Total Entries</p></CardContent></Card>
        <Card><CardContent className="p-4 text-center"><p className="text-2xl font-bold">₹{(stats.totalAmount / 100000).toFixed(1)}L</p><p className="text-xs text-muted-foreground">Total Payments</p></CardContent></Card>
        <Card><CardContent className="p-4 text-center"><p className="text-2xl font-bold">₹{(stats.totalTds / 100000).toFixed(1)}L</p><p className="text-xs text-muted-foreground">Total TDS</p></CardContent></Card>
        <Card><CardContent className="p-4 text-center"><p className="text-2xl font-bold">{stats.withErrors}</p><p className="text-xs text-muted-foreground">With Warnings</p></CardContent></Card>
      </div>

      <div className="flex flex-wrap gap-3 items-end">
        <div className="space-y-1"><Label className="text-xs">Client</Label>
          <Select value={selectedClient} onValueChange={setSelectedClient}>
            <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="all">All Clients</SelectItem>{clients.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-1"><Label className="text-xs">Form</Label>
          <Select value={selectedForm} onValueChange={setSelectedForm}>
            <SelectTrigger className="w-[100px]"><SelectValue /></SelectTrigger>
            <SelectContent>{TDS_FORMS.map(f => <SelectItem key={f} value={f}>{f}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-2.5 text-muted-foreground" />
          <Input className="pl-8 w-[200px]" placeholder="Search deductee..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
        </div>
        <div className="flex-1" />
        <Button size="sm" className="gap-1" onClick={openAdd}><Plus size={14} /> Add Entry</Button>
        <Button variant="outline" size="sm" className="gap-1" onClick={() => {
          const input = document.createElement("input"); input.type = "file"; input.accept = ".csv";
          input.onchange = async (ev: any) => {
            const file = ev.target.files?.[0]; if (!file) return;
            const text = await file.text();
            const Papa = (await import("papaparse")).default;
            const { data: rows } = Papa.parse(text, { header: true, skipEmptyLines: true });
            if (!rows?.length) { toast({ title: "No data found in CSV", variant: "destructive" }); return; }
            const firmId = await resolveFirmId();
            const clientId = selectedClient !== "all" ? selectedClient : clients[0]?.id;
            if (!clientId) { toast({ title: "Select a client first", variant: "destructive" }); return; }
            let imported = 0;
            for (const row of rows as any[]) {
              const name = row["Deductee Name"] || row["Employee Name"] || row["Collectee Name"] || "";
              if (!name.trim()) continue;
              await supabase.from("tds_entries").insert({
                party_name: name.trim(), pan: (row["PAN"] || "").toUpperCase() || null,
                deductee_pan: (row["PAN"] || "").toUpperCase() || null,
                section_code: row["Section"] || null, nature_of_payment: row["Nature of Payment"] || null,
                amount: parseFloat(row["Amount"] || "0") || null, tds_rate: parseFloat(row["TDS Rate %"] || "0") || null,
                tds_amount: parseFloat(row["TDS Amount"] || "0") || null, date: row["Payment Date"] || null,
                challan_bsr_code: row["BSR Code"] || null, challan_date: row["Challan Date"] || null,
                challan_serial_no: row["Challan Serial"] || null,
                challan_amount: parseFloat(row["Challan Amount"] || "0") || null,
                form_type: selectedForm, client_id: clientId, firm_id: firmId,
              });
              imported++;
            }
            toast({ title: `${imported} entries imported` }); fetchEntries();
          };
          input.click();
        }}><Upload size={14} /> Import CSV</Button>
      </div>

      <Card><CardContent className="p-0"><div className="overflow-x-auto">
        <Table>
          <TableHeader><TableRow>
            <TableHead className="min-w-[150px]">Deductee</TableHead><TableHead>PAN</TableHead>
            <TableHead>Section</TableHead><TableHead className="text-right">Amount</TableHead>
            <TableHead className="text-right">Rate %</TableHead><TableHead className="text-right">TDS</TableHead>
            <TableHead>Date</TableHead><TableHead>BSR Code</TableHead><TableHead>Status</TableHead>
            <TableHead className="w-[60px]"></TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {loading ? Array.from({ length: 5 }).map((_, i) => (
              <TableRow key={i}>{Array.from({ length: 10 }).map((_, j) => <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>)}</TableRow>
            )) : filtered.length === 0 ? (
              <TableRow><TableCell colSpan={10} className="text-center text-muted-foreground py-8">No entries found. Click "Add Entry" to create one.</TableCell></TableRow>
            ) : filtered.map(entry => (
              <TableRow key={entry.id} className="cursor-pointer hover:bg-muted/50" onClick={() => openEdit(entry)}>
                <TableCell className="font-medium">{entry.party_name}</TableCell>
                <TableCell className="font-mono text-xs">{entry.deductee_pan || entry.pan}</TableCell>
                <TableCell><Badge variant="outline" className="text-xs">{entry.section_code || entry.section}</Badge></TableCell>
                <TableCell className="text-right">₹{(entry.amount || 0).toLocaleString("en-IN")}</TableCell>
                <TableCell className="text-right">{entry.tds_rate}%</TableCell>
                <TableCell className="text-right font-semibold">₹{(entry.tds_amount || 0).toLocaleString("en-IN")}</TableCell>
                <TableCell>{formatDateDDMMYYYY(entry.date)}</TableCell>
                <TableCell className="font-mono text-xs">{entry.challan_bsr_code}</TableCell>
                <TableCell>
                  {entry.validation_status === "warning" ? (
                    <Badge variant="outline" className="bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300 text-xs"><AlertTriangle size={10} className="mr-1" /> Warning</Badge>
                  ) : entry.validation_status === "error" ? (
                    <Badge variant="destructive" className="text-xs"><XCircle size={10} className="mr-1" /> Error</Badge>
                  ) : (
                    <Badge variant="outline" className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300 text-xs"><CheckCircle2 size={10} className="mr-1" /> Valid</Badge>
                  )}
                </TableCell>
                <TableCell><Button variant="ghost" size="icon" className="h-7 w-7" onClick={e => { e.stopPropagation(); handleDelete(entry.id); }}><Trash2 size={14} className="text-destructive" /></Button></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div></CardContent></Card>

      <Sheet open={formOpen} onOpenChange={setFormOpen}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader><SheetTitle>{editingEntry ? "Edit" : "New"} TDS Entry — Form {selectedForm}</SheetTitle></SheetHeader>
          <div className="py-4">{renderFormFields()}</div>
          <SheetFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>{saving ? "Saving..." : editingEntry ? "Update" : "Save"}</Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
}

// ═══════════════════════════════════════
// FILINGS TAB
// ═══════════════════════════════════════
function TdsFilingsTab({ clients, users, isSuperadmin, resolveFirmId }: TabProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [filings, setFilings] = useState<TdsFiling[]>([]);
  const [loading, setLoading] = useState(true);
  const [fyFilter, setFyFilter] = useState(DEFAULT_FY);
  const [quarterFilter, setQuarterFilter] = useState("all");
  const [clientFilter, setClientFilter] = useState("all");

  const fetchFilings = useCallback(async () => {
    setLoading(true);
    const firmId = await resolveFirmId();
    let q = supabase.from("tds_filings").select("*").order("created_at", { ascending: false }).limit(500);
    if (!isSuperadmin && firmId) q = q.eq("firm_id", firmId);
    if (fyFilter !== "all") q = q.eq("financial_year", fyFilter);
    if (quarterFilter !== "all") q = q.eq("quarter", quarterFilter);
    if (clientFilter !== "all") q = q.eq("client_id", clientFilter);
    const { data } = await q;
    setFilings((data || []) as TdsFiling[]);
    setLoading(false);
  }, [isSuperadmin, resolveFirmId, fyFilter, quarterFilter, clientFilter]);

  useEffect(() => { fetchFilings(); }, [fetchFilings]);

  const getDueDate = (fy: string, quarter: string): Date => {
    const fyStart = parseInt(fy.split("-")[0]);
    const dates: Record<string, Date> = {
      Q1: new Date(fyStart, 6, 31), Q2: new Date(fyStart, 9, 31),
      Q3: new Date(fyStart + 1, 0, 31), Q4: new Date(fyStart + 1, 4, 31),
    };
    return dates[quarter] || new Date();
  };

  const getDueDateColor = (fy: string, quarter: string, status: string) => {
    if (status === "Accepted" || status === "Submitted") return "text-emerald-600";
    const due = getDueDate(fy, quarter);
    const days = differenceInDays(due, new Date());
    if (days < 0) return "text-destructive font-bold";
    if (days < 7) return "text-amber-600 font-semibold";
    return "text-emerald-600";
  };

  const handleInlineUpdate = async (filing: TdsFiling, field: string, value: any) => {
    const { error } = await supabase.from("tds_filings").update({
      [field]: value, last_updated_by: user?.id, last_updated_at: new Date().toISOString(),
    }).eq("id", filing.id);
    if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
    else fetchFilings();
  };

  return (
    <div className="space-y-4">
      <div><h2 className="text-xl font-bold text-foreground">Filings</h2><p className="text-sm text-muted-foreground">Track TDS/TCS return filings</p></div>

      <div className="flex flex-wrap gap-3 items-end">
        <div className="space-y-1"><Label className="text-xs">FY</Label>
          <Select value={fyFilter} onValueChange={setFyFilter}>
            <SelectTrigger className="w-[120px]"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="all">All FY</SelectItem>{FY_OPTIONS.map(fy => <SelectItem key={fy} value={fy}>{fy}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-1"><Label className="text-xs">Quarter</Label>
          <Select value={quarterFilter} onValueChange={setQuarterFilter}>
            <SelectTrigger className="w-[100px]"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="all">All</SelectItem>{QUARTER_OPTIONS.map(q => <SelectItem key={q} value={q}>{q}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-1"><Label className="text-xs">Client</Label>
          <Select value={clientFilter} onValueChange={setClientFilter}>
            <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="all">All Clients</SelectItem>{clients.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="flex-1" />
        <Button size="sm" className="gap-1" onClick={async () => {
          if (!clients.length) { toast({ title: "No TDS clients available", variant: "destructive" }); return; }
          const firmId = await resolveFirmId();
          const clientId = clientFilter !== "all" ? clientFilter : clients[0]?.id;
          if (!clientId) return;
          const { error } = await supabase.from("tds_filings").insert({
            client_id: clientId, firm_id: firmId,
            financial_year: fyFilter !== "all" ? fyFilter : DEFAULT_FY,
            quarter: quarterFilter !== "all" ? quarterFilter : "Q1",
            tds_forms: ["26Q"], work_status: "Not Started",
          });
          if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
          else { toast({ title: "Filing record created" }); fetchFilings(); }
        }}><Plus size={14} /> Add Filing</Button>
        <Button variant="outline" size="sm" className="gap-1" onClick={() => {
          const rows = filings.map(f => `<tr>
            <td style="border:1px solid #ccc;padding:6px;font-size:12px">${clients.find(c => c.id === f.client_id)?.name || "—"}</td>
            <td style="border:1px solid #ccc;padding:6px;font-size:12px">${clients.find(c => c.id === f.client_id)?.pan || "—"}</td>
            <td style="border:1px solid #ccc;padding:6px;font-size:12px">${f.tan || "—"}</td>
            <td style="border:1px solid #ccc;padding:6px;font-size:12px">${f.tds_forms?.join(", ") || "—"}</td>
            <td style="border:1px solid #ccc;padding:6px;font-size:12px">${f.quarter}</td>
            <td style="border:1px solid #ccc;padding:6px;font-size:12px">${f.financial_year}</td>
            <td style="border:1px solid #ccc;padding:6px;font-size:12px">${f.work_status}</td>
            <td style="border:1px solid #ccc;padding:6px;font-size:12px">${f.date_of_filing ? format(new Date(f.date_of_filing), "dd/MM/yyyy") : "—"}</td>
            <td style="border:1px solid #ccc;padding:6px;font-size:12px">${f.acknowledgment_number || "—"}</td>
            <td style="border:1px solid #ccc;padding:6px;font-size:12px">${format(getDueDate(f.financial_year, f.quarter), "dd/MM/yyyy")}</td>
          </tr>`).join("");
          const html = `<!DOCTYPE html><html><head><title>TDS Filing Sheet</title><style>body{font-family:system-ui;margin:20px}table{width:100%;border-collapse:collapse}th{background:#f3f4f6;font-size:11px}@media print{@page{size:landscape}}</style></head><body>
            <h2>TDS Filing Sheet — FY: ${fyFilter} | Qtr: ${quarterFilter}</h2>
            <table><thead><tr><th style="border:1px solid #ccc;padding:6px">Client</th><th style="border:1px solid #ccc;padding:6px">PAN</th><th style="border:1px solid #ccc;padding:6px">TAN</th><th style="border:1px solid #ccc;padding:6px">Form</th><th style="border:1px solid #ccc;padding:6px">Qtr</th><th style="border:1px solid #ccc;padding:6px">FY</th><th style="border:1px solid #ccc;padding:6px">Status</th><th style="border:1px solid #ccc;padding:6px">Filing Date</th><th style="border:1px solid #ccc;padding:6px">Ack No</th><th style="border:1px solid #ccc;padding:6px">Due Date</th></tr></thead><tbody>${rows}</tbody></table></body></html>`;
          const blob = new Blob([html], { type: "text/html" });
          const w = window.open(URL.createObjectURL(blob), "_blank");
          if (w) setTimeout(() => w.print(), 500);
        }}><Download size={14} /> Export</Button>
      </div>

      <Card><CardContent className="p-0"><div className="overflow-x-auto">
        <Table>
          <TableHeader><TableRow>
            <TableHead className="min-w-[150px] sticky left-0 bg-background z-10">Client</TableHead>
            <TableHead>PAN</TableHead><TableHead>TAN</TableHead><TableHead>Form</TableHead>
            <TableHead>Quarter</TableHead><TableHead>FY</TableHead>
            <TableHead className="min-w-[150px]">Status</TableHead>
            <TableHead>Filing Date</TableHead><TableHead>Ack No</TableHead>
            <TableHead>Due Date</TableHead><TableHead>Assigned</TableHead>
            <TableHead>Remarks</TableHead><TableHead className="w-[50px]"></TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {loading ? Array.from({ length: 5 }).map((_, i) => (
              <TableRow key={i}>{Array.from({ length: 13 }).map((_, j) => <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>)}</TableRow>
            )) : filings.length === 0 ? (
              <TableRow><TableCell colSpan={13} className="text-center text-muted-foreground py-8">No filings found.</TableCell></TableRow>
            ) : filings.map(f => (
              <TableRow key={f.id}>
                <TableCell className="font-medium sticky left-0 bg-background">{clients.find(c => c.id === f.client_id)?.name || "—"}</TableCell>
                <TableCell className="font-mono text-xs">{clients.find(c => c.id === f.client_id)?.pan}</TableCell>
                <TableCell><Input className="h-7 w-24 text-xs" defaultValue={f.tan || ""} onBlur={e => { if (e.target.value !== (f.tan || "")) handleInlineUpdate(f, "tan", e.target.value); }} /></TableCell>
                <TableCell><Badge variant="outline" className="text-xs">{f.tds_forms?.join(", ")}</Badge></TableCell>
                <TableCell>{f.quarter}</TableCell>
                <TableCell>{f.financial_year}</TableCell>
                <TableCell>
                  <Select value={f.work_status} onValueChange={v => handleInlineUpdate(f, "work_status", v)}>
                    <SelectTrigger className="h-7 text-xs w-[140px]"><Badge className={cn("text-xs", FILING_STATUS_COLORS[f.work_status])}>{f.work_status}</Badge></SelectTrigger>
                    <SelectContent>{FILING_STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                  </Select>
                </TableCell>
                <TableCell><Input type="date" className="h-7 w-32 text-xs" defaultValue={f.date_of_filing || ""} onBlur={e => { if (e.target.value !== (f.date_of_filing || "")) handleInlineUpdate(f, "date_of_filing", e.target.value || null); }} /></TableCell>
                <TableCell><Input className="h-7 w-28 text-xs" defaultValue={f.acknowledgment_number || ""} onBlur={e => { if (e.target.value !== (f.acknowledgment_number || "")) handleInlineUpdate(f, "acknowledgment_number", e.target.value || null); }} /></TableCell>
                <TableCell className={getDueDateColor(f.financial_year, f.quarter, f.work_status)}>{format(getDueDate(f.financial_year, f.quarter), "dd/MM/yyyy")}</TableCell>
                <TableCell>
                  <Select value={f.assigned_staff || ""} onValueChange={v => handleInlineUpdate(f, "assigned_staff", v || null)}>
                    <SelectTrigger className="h-7 text-xs w-[120px]"><SelectValue placeholder="—" /></SelectTrigger>
                    <SelectContent>{users.map(u => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}</SelectContent>
                  </Select>
                </TableCell>
                <TableCell><Input className="h-7 w-28 text-xs" defaultValue={f.remarks || ""} onBlur={e => { if (e.target.value !== (f.remarks || "")) handleInlineUpdate(f, "remarks", e.target.value || null); }} /></TableCell>
                <TableCell><Button variant="ghost" size="icon" className="h-7 w-7" onClick={async () => {
                  const { error } = await supabase.from("tds_filings").delete().eq("id", f.id);
                  if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
                  else { toast({ title: "Deleted" }); fetchFilings(); }
                }}><Trash2 size={14} className="text-destructive" /></Button></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div></CardContent></Card>
    </div>
  );
}

// ═══════════════════════════════════════
// VALIDATE & FINALISE
// ═══════════════════════════════════════
function TdsValidateSection({ clients, resolveFirmId, isSuperadmin }: { clients: ClientOption[]; resolveFirmId: () => Promise<string | null>; isSuperadmin: boolean }) {
  const { toast } = useToast();
  return (
    <div className="space-y-4">
      <div><h2 className="text-xl font-bold text-foreground">Validate & Finalise</h2><p className="text-sm text-muted-foreground">Run validation checks and finalise returns for filing</p></div>
      <Card><CardContent className="p-8 text-center text-muted-foreground">
        <ShieldCheck size={48} className="mx-auto mb-4 opacity-30" />
        <p className="text-lg font-semibold">Coming Soon</p>
        <p className="text-sm mt-1">Automated validation against rate master, PAN verification, challan matching, and return finalisation will be available here.</p>
      </CardContent></Card>
    </div>
  );
}

// ═══════════════════════════════════════
// REPORTS TAB
// ═══════════════════════════════════════
function TdsReportsTab({ clients, resolveFirmId, isSuperadmin }: { clients: ClientOption[]; resolveFirmId: () => Promise<string | null>; isSuperadmin: boolean }) {
  const { toast } = useToast();
  const [entries, setEntries] = useState<TdsEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedClient, setSelectedClient] = useState("all");
  const [selectedFy, setSelectedFy] = useState(DEFAULT_FY);

  const fetchEntries = useCallback(async () => {
    setLoading(true);
    const firmId = await resolveFirmId();
    let q = supabase.from("tds_entries").select("*").order("date", { ascending: false }).limit(1000);
    if (!isSuperadmin && firmId) q = q.eq("firm_id", firmId);
    if (selectedClient !== "all") q = q.eq("client_id", selectedClient);
    const { data } = await q;
    setEntries((data as TdsEntry[]) || []);
    setLoading(false);
  }, [resolveFirmId, isSuperadmin, selectedClient]);

  useEffect(() => { fetchEntries(); }, [fetchEntries]);

  const sectionSummary = useMemo(() => {
    const map = new Map<string, { count: number; amount: number; tds: number }>();
    entries.forEach(e => {
      const sec = e.section_code || e.section || "Unknown";
      const existing = map.get(sec) || { count: 0, amount: 0, tds: 0 };
      existing.count++;
      existing.amount += e.amount || 0;
      existing.tds += e.tds_amount || 0;
      map.set(sec, existing);
    });
    return Array.from(map.entries()).sort((a, b) => b[1].tds - a[1].tds);
  }, [entries]);

  return (
    <div className="space-y-4">
      <div><h2 className="text-xl font-bold text-foreground">Reports</h2><p className="text-sm text-muted-foreground">TDS section-wise summary and analytics</p></div>

      <div className="flex gap-3 items-end">
        <div className="space-y-1"><Label className="text-xs">Client</Label>
          <Select value={selectedClient} onValueChange={setSelectedClient}>
            <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="all">All Clients</SelectItem>{clients.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <Button variant="outline" size="sm" className="gap-1" onClick={() => {
          const csv = ["Section,Count,Amount,TDS", ...sectionSummary.map(([s, d]) => `${s},${d.count},${d.amount},${d.tds}`)].join("\n");
          const blob = new Blob([csv], { type: "text/csv" });
          const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "tds_report.csv"; a.click();
        }}><Download size={14} /> Export CSV</Button>
      </div>

      <Card><CardContent className="p-0"><div className="overflow-x-auto">
        <Table>
          <TableHeader><TableRow>
            <TableHead>Section</TableHead><TableHead className="text-right">Entries</TableHead>
            <TableHead className="text-right">Total Amount</TableHead><TableHead className="text-right">Total TDS</TableHead>
            <TableHead className="text-right">Avg Rate %</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {loading ? Array.from({ length: 5 }).map((_, i) => (
              <TableRow key={i}>{Array.from({ length: 5 }).map((_, j) => <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>)}</TableRow>
            )) : sectionSummary.length === 0 ? (
              <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">No data</TableCell></TableRow>
            ) : sectionSummary.map(([sec, data]) => (
              <TableRow key={sec}>
                <TableCell><Badge variant="outline" className="font-mono">{sec}</Badge></TableCell>
                <TableCell className="text-right">{data.count}</TableCell>
                <TableCell className="text-right">₹{data.amount.toLocaleString("en-IN")}</TableCell>
                <TableCell className="text-right font-semibold">₹{data.tds.toLocaleString("en-IN")}</TableCell>
                <TableCell className="text-right">{data.amount > 0 ? ((data.tds / data.amount) * 100).toFixed(2) : "0"}%</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div></CardContent></Card>
    </div>
  );
}

export default TdsFilings;
