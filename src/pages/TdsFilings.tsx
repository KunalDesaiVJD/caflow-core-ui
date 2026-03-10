import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
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
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { VersionHistoryPanel } from "@/components/VersionHistoryPanel";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import {
  CalendarIcon, Plus, Pencil, Trash2, Sparkles,
  FileText, IndianRupee, AlertTriangle, Clock,
  ArrowRight, Link2,
} from "lucide-react";

// ─── Constants ───
const SECTIONS = [
  { value: "194C", label: "194C — Contractor", rate: 2 },
  { value: "194J(a)", label: "194J(a) — Technical 2%", rate: 2 },
  { value: "194J(b)", label: "194J(b) — Professional 10%", rate: 10 },
  { value: "194I(a)", label: "194I(a) — Rent Machinery 2%", rate: 2 },
  { value: "194I(b)", label: "194I(b) — Rent Building 10%", rate: 10 },
  { value: "194H", label: "194H — Commission 2%", rate: 2 },
  { value: "194Q", label: "194Q — Purchase Goods 0.1%", rate: 0.1 },
  { value: "194T", label: "194T — Partner Salary 10%", rate: 10 },
  { value: "194A", label: "194A — Interest 10%", rate: 10 },
  { value: "194IB", label: "194IB — Rent Individual 5%", rate: 5 },
];

const ENTRY_STATUS_COLORS: Record<string, string> = {
  pending: "bg-muted text-muted-foreground",
  paid: "bg-amber-100 text-amber-700",
  filed: "bg-emerald-100 text-emerald-700",
};

const FILING_STATUS_STEPS = [
  "Data Received",
  "Preparation In Progress",
  "Ready for Check",
  "Under Check",
  "Check Complete",
  "Ready to File",
  "Filed",
] as const;

const FILING_STATUS_COLORS: Record<string, string> = {
  "Data Received": "bg-muted text-muted-foreground",
  "Preparation In Progress": "bg-blue-100 text-blue-700",
  "Ready for Check": "bg-amber-100 text-amber-700",
  "Under Check": "bg-orange-100 text-orange-700",
  "Check Complete": "bg-purple-100 text-purple-700",
  "Ready to File": "bg-yellow-100 text-yellow-800",
  "Filed": "bg-emerald-100 text-emerald-700",
};

const TDS_FORM_OPTIONS = ["26Q", "24Q", "27Q", "27EQ"];
const QUARTER_OPTIONS = ["Q1", "Q2", "Q3", "Q4"];

const CURRENT_FY_START = new Date().getMonth() >= 3 ? new Date().getFullYear() : new Date().getFullYear() - 1;
const DEFAULT_FY = `${CURRENT_FY_START}-${String(CURRENT_FY_START + 1).slice(2)}`;
const FY_OPTIONS = Array.from({ length: 7 }, (_, i) => {
  const s = 2020 + i;
  return `${s}-${String(s + 1).slice(2)}`;
});

interface TdsEntry {
  id: string;
  party_name: string | null;
  pan: string | null;
  section: string | null;
  tds_amount: number | null;
  tds_rate: number | null;
  challan_no: string | null;
  date: string | null;
  due_date: string | null;
  filed_at: string | null;
  payment_nature: string | null;
  amount: number | null;
  status: string | null;
  firm_id: string | null;
  client_id: string | null;
  deductee_id: string | null;
  tds_filing_id: string | null;
}

interface TdsFiling {
  id: string;
  client_id: string;
  firm_id: string;
  financial_year: string;
  quarter: string;
  tds_forms: string[] | null;
  date_data_received: string | null;
  preparer_id: string | null;
  checker_id: string | null;
  approver_id: string | null;
  work_status: string;
  date_of_filing: string | null;
  acknowledgment_number: string | null;
  remarks: string | null;
  created_by: string | null;
  created_at: string | null;
  // joined
  client_name?: string | null;
  preparer_name?: string | null;
  checker_name?: string | null;
  approver_name?: string | null;
}

interface Deductee {
  id: string;
  party_name: string;
  pan: string | null;
  pan_valid: boolean | null;
}

interface ClientOption {
  id: string;
  name: string | null;
  pan: string | null;
}

interface UserOption {
  id: string;
  name: string | null;
  role: string | null;
}

const emptyForm = {
  date: "", party_name: "", pan: "", payment_nature: "", amount: "",
  section: "", tds_rate: "", tds_amount: "", due_date: "", challan_no: "",
  deductee_id: "", client_id: "",
};

const emptyFilingForm = {
  client_id: "", financial_year: "", quarter: "", tds_forms: [] as string[],
  date_data_received: "", preparer_id: "", checker_id: "", approver_id: "", remarks: "",
};

const getFinancialYear = (dateValue: string) => {
  const parsed = new Date(dateValue);
  const month = parsed.getMonth();
  const year = parsed.getFullYear();
  const fyStart = month >= 3 ? year : year - 1;
  return `${fyStart}-${String(fyStart + 1).slice(2)}`;
};

const TdsFilings = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("entries");

  // ─── Shared data ───
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
    let q = supabase.from("clients").select("id, name, pan").order("name");
    if (!isSuperadmin && firmId) q = q.eq("firm_id", firmId);
    const { data } = await q;
    setClients((data as ClientOption[]) || []);
  }, [isSuperadmin, resolveFirmId]);

  const fetchUsers = useCallback(async () => {
    const firmId = await resolveFirmId();
    let q = supabase.from("users").select("id, name, role").eq("is_active", true);
    if (!isSuperadmin && firmId) q = q.eq("firm_id", firmId);
    const { data } = await q;
    setUsers((data as UserOption[]) || []);
  }, [isSuperadmin, resolveFirmId]);

  useEffect(() => { fetchClients(); fetchUsers(); }, [fetchClients, fetchUsers]);

  // ═══════════════════════════════════════════════
  // ENTRIES TAB STATE (kept from original)
  // ═══════════════════════════════════════════════
  const [entries, setEntries] = useState<TdsEntry[]>([]);
  const [entriesLoading, setEntriesLoading] = useState(true);
  const [deductees, setDeductees] = useState<Deductee[]>([]);
  const [fyFilter, setFyFilter] = useState(DEFAULT_FY);
  const [sectionFilter, setSectionFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiSuggestion, setAiSuggestion] = useState<{ section: string; rate: number; description: string } | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deducteeSearch, setDeducteeSearch] = useState("");
  const [showDeducteeList, setShowDeducteeList] = useState(false);
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [dueDatePickerOpen, setDueDatePickerOpen] = useState(false);

  // ═══════════════════════════════════════════════
  // FILINGS TAB STATE
  // ═══════════════════════════════════════════════
  const [filings, setFilings] = useState<TdsFiling[]>([]);
  const [filingsLoading, setFilingsLoading] = useState(true);
  const [filingFormOpen, setFilingFormOpen] = useState(false);
  const [filingForm, setFilingForm] = useState(emptyFilingForm);
  const [filingSaving, setFilingSaving] = useState(false);
  const [filingFyFilter, setFilingFyFilter] = useState("all");
  const [filingQuarterFilter, setFilingQuarterFilter] = useState("all");
  const [filingClientFilter, setFilingClientFilter] = useState("all");
  const [filingStatusFilter, setFilingStatusFilter] = useState("all");
  // Status advance dialog
  const [advanceFiling, setAdvanceFiling] = useState<TdsFiling | null>(null);
  const [advanceDateFiled, setAdvanceDateFiled] = useState("");
  const [advanceAckNo, setAdvanceAckNo] = useState("");
  const [advancing, setAdvancing] = useState(false);
  // Link entries modal
  const [linkFiling, setLinkFiling] = useState<TdsFiling | null>(null);
  const [unlinkEntries, setUnlinkEntries] = useState<TdsEntry[]>([]);
  const [selectedLinkIds, setSelectedLinkIds] = useState<string[]>([]);
  const [linkingEntries, setLinkingEntries] = useState(false);
  const [filingDataRecvPicker, setFilingDataRecvPicker] = useState(false);

  // ─── Entries fetch ───
  const fetchEntries = useCallback(async () => {
    setEntriesLoading(true);
    const firmId = await resolveFirmId();
    let q = supabase.from("tds_entries").select("*").order("date", { ascending: false }).limit(500);
    if (!isSuperadmin) { if (!firmId) { setEntries([]); setEntriesLoading(false); return; } q = q.eq("firm_id", firmId); }
    const { data } = await q;
    setEntries((data as TdsEntry[]) || []);
    setEntriesLoading(false);
  }, [isSuperadmin, resolveFirmId]);

  const fetchDeductees = useCallback(async () => {
    const firmId = await resolveFirmId();
    let q = supabase.from("deductees").select("id, party_name, pan, pan_valid").order("party_name");
    if (!isSuperadmin && firmId) q = q.eq("firm_id", firmId);
    const { data } = await q;
    setDeductees((data as Deductee[]) || []);
  }, [isSuperadmin, resolveFirmId]);

  // ─── Filings fetch ───
  const fetchFilings = useCallback(async () => {
    setFilingsLoading(true);
    const firmId = await resolveFirmId();
    let q = supabase.from("tds_filings").select("*").order("created_at", { ascending: false }).limit(500);
    if (!isSuperadmin && firmId) q = q.eq("firm_id", firmId);
    const { data } = await q;
    // Enrich with names
    const raw = (data || []) as TdsFiling[];
    const enriched = raw.map(f => ({
      ...f,
      client_name: clients.find(c => c.id === f.client_id)?.name || null,
      preparer_name: users.find(u => u.id === f.preparer_id)?.name || null,
      checker_name: users.find(u => u.id === f.checker_id)?.name || null,
      approver_name: users.find(u => u.id === f.approver_id)?.name || null,
    }));
    setFilings(enriched);
    setFilingsLoading(false);
  }, [isSuperadmin, resolveFirmId, clients, users]);

  useEffect(() => { fetchEntries(); fetchDeductees(); }, [fetchEntries, fetchDeductees]);
  useEffect(() => { if (activeTab === "filings") fetchFilings(); }, [activeTab, fetchFilings]);

  // ─── Entries helpers (unchanged) ───
  const filtered = useMemo(() => entries.filter(e => {
    if (e.date) { if (getFinancialYear(e.date) !== fyFilter) return false; }
    if (sectionFilter !== "all" && e.section !== sectionFilter) return false;
    if (statusFilter !== "all" && e.status !== statusFilter) return false;
    if (searchQuery && !(e.party_name || "").toLowerCase().includes(searchQuery.toLowerCase())) return false;
    return true;
  }), [entries, fyFilter, sectionFilter, statusFilter, searchQuery]);

  const stats = useMemo(() => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    return {
      totalEntries: filtered.length,
      totalDeducted: filtered.reduce((s, e) => s + (e.tds_amount || 0), 0),
      pendingChallans: filtered.filter(e => !e.challan_no).length,
      overdue: filtered.filter(e => e.due_date && new Date(e.due_date) < today && !e.filed_at).length,
    };
  }, [filtered]);

  const updateForm = (key: string, value: string) => {
    setForm(f => {
      const next = { ...f, [key]: value };
      if (key === "amount" || key === "tds_rate") {
        const amt = parseFloat(key === "amount" ? value : next.amount) || 0;
        const rate = parseFloat(key === "tds_rate" ? value : next.tds_rate) || 0;
        next.tds_amount = String(Math.round(amt * rate / 100 * 100) / 100);
      }
      if (key === "section") {
        const sec = SECTIONS.find(s => s.value === value);
        if (sec) { next.tds_rate = String(sec.rate); const amt = parseFloat(next.amount) || 0; next.tds_amount = String(Math.round(amt * sec.rate / 100 * 100) / 100); }
      }
      return next;
    });
  };

  const selectDeductee = (d: Deductee) => { setForm(f => ({ ...f, party_name: d.party_name, pan: d.pan || "", deductee_id: d.id })); setDeducteeSearch(d.party_name); setShowDeducteeList(false); };
  const selectClient = (c: ClientOption) => { setForm(f => ({ ...f, party_name: c.name || "", pan: c.pan || "", client_id: c.id, deductee_id: "" })); setDeducteeSearch(c.name || ""); setShowDeducteeList(false); };
  const filteredDeductees = deductees.filter(d => d.party_name.toLowerCase().includes(deducteeSearch.toLowerCase()));
  const filteredClients = clients.filter(c => (c.name || "").toLowerCase().includes(deducteeSearch.toLowerCase()));

  const openAdd = () => { setEditingId(null); setForm(emptyForm); setDeducteeSearch(""); setAiSuggestion(null); setFormOpen(true); };
  const openEdit = (entry: TdsEntry) => {
    setEditingId(entry.id);
    setForm({ date: entry.date || "", party_name: entry.party_name || "", pan: entry.pan || "", payment_nature: entry.payment_nature || "", amount: entry.amount != null ? String(entry.amount) : "", section: entry.section || "", tds_rate: entry.tds_rate != null ? String(entry.tds_rate) : "", tds_amount: entry.tds_amount != null ? String(entry.tds_amount) : "", due_date: entry.due_date || "", challan_no: entry.challan_no || "", deductee_id: entry.deductee_id || "", client_id: entry.client_id || "" });
    setDeducteeSearch(entry.party_name || ""); setAiSuggestion(null); setFormOpen(true);
  };

  const handleAiSuggest = async () => {
    if (!form.payment_nature.trim()) { toast({ title: "Enter payment nature first", variant: "destructive" }); return; }
    setAiLoading(true); setAiSuggestion(null);
    try {
      const { data, error } = await supabase.functions.invoke("claude-gateway", { body: { request_type: "tds_section_identifier", user_message: form.payment_nature } });
      if (error) throw error;
      if (data?.section) setAiSuggestion({ section: data.section, rate: data.rate, description: data.description });
      else toast({ title: "AI couldn't determine section", description: data?.description || "Try being more specific." });
    } catch (e: any) { toast({ title: "AI suggestion failed", description: e.message, variant: "destructive" }); }
    finally { setAiLoading(false); }
  };

  const acceptAiSuggestion = () => {
    if (!aiSuggestion) return;
    setForm(f => { const amt = parseFloat(f.amount) || 0; return { ...f, section: aiSuggestion.section, tds_rate: String(aiSuggestion.rate), tds_amount: String(Math.round(amt * aiSuggestion.rate / 100 * 100) / 100) }; });
    setAiSuggestion(null);
  };

  const handleSave = async () => {
    if (!form.party_name.trim()) { toast({ title: "Party name required", variant: "destructive" }); return; }
    setSaving(true);
    try {
      let firmId = await resolveFirmId();
      if (!firmId && editingId) firmId = entries.find(e => e.id === editingId)?.firm_id || null;
      if (!firmId && isSuperadmin && form.client_id) { const { data: sc } = await supabase.from("clients").select("firm_id").eq("id", form.client_id).maybeSingle(); firmId = sc?.firm_id || null; }
      if (!editingId && !firmId) throw new Error("Unable to resolve firm. Pick a client first.");
      let deducteeId = form.deductee_id || null;
      if (!deducteeId && form.party_name.trim()) {
        if (!firmId) throw new Error("Select a client to infer firm before creating a new deductee.");
        const { data: newDed, error: e2 } = await supabase.from("deductees").insert({ firm_id: firmId, party_name: form.party_name.trim(), pan: form.pan || null }).select("id").single();
        if (e2) throw e2; if (newDed) deducteeId = newDed.id;
      }
      const payload: any = { date: form.date || null, party_name: form.party_name.trim(), pan: form.pan || null, payment_nature: form.payment_nature || null, amount: form.amount ? parseFloat(form.amount) : null, section: form.section || null, tds_rate: form.tds_rate ? parseFloat(form.tds_rate) : null, tds_amount: form.tds_amount ? parseFloat(form.tds_amount) : null, due_date: form.due_date || null, challan_no: form.challan_no || null, deductee_id: deducteeId, client_id: form.client_id || null, status: form.challan_no ? "paid" : "pending" };
      if (!editingId && firmId) payload.firm_id = firmId;
      if (editingId) {
        const { data: updated, error } = await supabase.from("tds_entries").update(payload).eq("id", editingId).select();
        if (error) throw error; if (!updated?.length) throw new Error("Update failed — no rows modified.");
        toast({ title: "TDS entry updated" });
      } else {
        const { error } = await supabase.from("tds_entries").insert(payload);
        if (error) throw error; toast({ title: "TDS entry added" });
      }
      setFormOpen(false); fetchEntries(); fetchDeductees();
    } catch (e: any) { toast({ title: "Save failed", description: e.message, variant: "destructive" }); }
    finally { setSaving(false); }
  };

  const handleDelete = async () => {
    if (!deleteId) return; setDeleting(true);
    try { const { error } = await supabase.from("tds_entries").delete().eq("id", deleteId); if (error) throw error; toast({ title: "Entry deleted" }); setDeleteId(null); fetchEntries(); }
    catch (e: any) { toast({ title: "Delete failed", description: e.message, variant: "destructive" }); }
    finally { setDeleting(false); }
  };

  // ═══════════════════════════════════════════════
  // FILINGS helpers
  // ═══════════════════════════════════════════════
  const filingStats = useMemo(() => {
    const counts: Record<string, number> = {};
    FILING_STATUS_STEPS.forEach(s => counts[s] = 0);
    filings.forEach(f => { if (counts[f.work_status] !== undefined) counts[f.work_status]++; });
    return counts;
  }, [filings]);

  const filteredFilings = useMemo(() => filings.filter(f => {
    if (filingFyFilter !== "all" && f.financial_year !== filingFyFilter) return false;
    if (filingQuarterFilter !== "all" && f.quarter !== filingQuarterFilter) return false;
    if (filingClientFilter !== "all" && f.client_id !== filingClientFilter) return false;
    if (filingStatusFilter !== "all" && f.work_status !== filingStatusFilter) return false;
    return true;
  }), [filings, filingFyFilter, filingQuarterFilter, filingClientFilter, filingStatusFilter]);

  const staffUsers = useMemo(() => users.filter(u => ["staff_article", "staff", "article"].includes(u.role || "")), [users]);
  const managerUsers = useMemo(() => users.filter(u => ["manager", "partner", "firm_admin"].includes(u.role || "")), [users]);
  const partnerUsers = useMemo(() => users.filter(u => ["partner", "firm_admin"].includes(u.role || "")), [users]);

  const handleFilingSave = async () => {
    if (!filingForm.client_id || !filingForm.financial_year || !filingForm.quarter) { toast({ title: "Client, FY, and Quarter are required", variant: "destructive" }); return; }
    if (filingForm.tds_forms.length === 0) { toast({ title: "Select at least one TDS form", variant: "destructive" }); return; }
    setFilingSaving(true);
    try {
      const firmId = await resolveFirmId();
      if (!firmId) throw new Error("Unable to resolve firm.");
      const payload = {
        client_id: filingForm.client_id,
        firm_id: firmId,
        financial_year: filingForm.financial_year,
        quarter: filingForm.quarter,
        tds_forms: filingForm.tds_forms,
        date_data_received: filingForm.date_data_received || null,
        preparer_id: filingForm.preparer_id || null,
        checker_id: filingForm.checker_id || null,
        approver_id: filingForm.approver_id || null,
        remarks: filingForm.remarks || null,
        created_by: user?.id || null,
        work_status: "Data Received",
      };
      const { error } = await supabase.from("tds_filings").insert(payload);
      if (error) throw error;
      toast({ title: "TDS filing created" });
      setFilingFormOpen(false);
      setFilingForm(emptyFilingForm);
      fetchFilings();
    } catch (e: any) { toast({ title: "Save failed", description: e.message, variant: "destructive" }); }
    finally { setFilingSaving(false); }
  };

  // ─── Advance status ───
  const handleAdvanceStatus = async () => {
    if (!advanceFiling) return;
    const currentIdx = FILING_STATUS_STEPS.indexOf(advanceFiling.work_status as typeof FILING_STATUS_STEPS[number]);
    if (currentIdx < 0 || currentIdx >= FILING_STATUS_STEPS.length - 1) return;
    const nextStatus = FILING_STATUS_STEPS[currentIdx + 1];
    // If advancing to "Filed", require date and ack no
    if (nextStatus === "Filed") {
      if (!advanceDateFiled || !advanceAckNo.trim()) { toast({ title: "Date of Filing and Acknowledgment Number are required", variant: "destructive" }); return; }
    }
    setAdvancing(true);
    try {
      const updatePayload: any = { work_status: nextStatus };
      if (nextStatus === "Filed") {
        updatePayload.date_of_filing = advanceDateFiled;
        updatePayload.acknowledgment_number = advanceAckNo.trim();
      }
      const { error } = await supabase.from("tds_filings").update(updatePayload).eq("id", advanceFiling.id);
      if (error) throw error;
      toast({ title: `Status advanced to "${nextStatus}"` });

      // Trigger notifications based on status transition
      try {
        const firmId = await resolveFirmId();
        if (nextStatus === "Ready for Check" && advanceFiling.checker_id) {
          await supabase.functions.invoke("send-notification", {
            body: { type: "tds_filing_status_change", recipient_id: advanceFiling.checker_id, firm_id: firmId, channel: "both",
              content: { subject: "TDS Filing Ready for Check", message: `TDS filing for ${advanceFiling.client_name || "client"} (${advanceFiling.financial_year} ${advanceFiling.quarter}) is ready for your check.` } },
          });
        } else if (nextStatus === "Check Complete" && advanceFiling.approver_id) {
          await supabase.functions.invoke("send-notification", {
            body: { type: "tds_filing_status_change", recipient_id: advanceFiling.approver_id, firm_id: firmId, channel: "both",
              content: { subject: "TDS Filing Check Complete", message: `TDS filing for ${advanceFiling.client_name || "client"} (${advanceFiling.financial_year} ${advanceFiling.quarter}) check is complete and awaiting approval.` } },
          });
        } else if (nextStatus === "Filed") {
          // Notify preparer
          if (advanceFiling.preparer_id) {
            await supabase.functions.invoke("send-notification", {
              body: { type: "tds_filing_status_change", recipient_id: advanceFiling.preparer_id, firm_id: firmId, channel: "email",
                content: { subject: "TDS Filing Completed", message: `TDS filing for ${advanceFiling.client_name || "client"} (${advanceFiling.financial_year} ${advanceFiling.quarter}) has been filed. Ack: ${advanceAckNo}` } },
            });
          }
        }
      } catch (notifErr) {
        console.warn("Notification send failed (non-blocking):", notifErr);
      }

      setAdvanceFiling(null);
      setAdvanceDateFiled("");
      setAdvanceAckNo("");
      fetchFilings();
    } catch (e: any) { toast({ title: "Advance failed", description: e.message, variant: "destructive" }); }
    finally { setAdvancing(false); }
  };

  // ─── Link entries ───
  const openLinkEntries = async (filing: TdsFiling) => {
    setLinkFiling(filing);
    setSelectedLinkIds([]);
    // Fetch unlinked entries for this client + matching FY quarter
    const { data } = await supabase.from("tds_entries").select("*").eq("client_id", filing.client_id).is("tds_filing_id", null).limit(200);
    // Filter by FY based on date
    const matching = ((data || []) as TdsEntry[]).filter(e => {
      if (!e.date) return true; // include entries without date
      return getFinancialYear(e.date) === filing.financial_year;
    });
    setUnlinkEntries(matching);
  };

  const handleLinkEntries = async () => {
    if (!linkFiling || selectedLinkIds.length === 0) return;
    setLinkingEntries(true);
    try {
      const { error } = await supabase.from("tds_entries").update({ tds_filing_id: linkFiling.id }).in("id", selectedLinkIds);
      if (error) throw error;
      toast({ title: `${selectedLinkIds.length} entries linked` });
      setLinkFiling(null);
      fetchEntries();
    } catch (e: any) { toast({ title: "Link failed", description: e.message, variant: "destructive" }); }
    finally { setLinkingEntries(false); }
  };

  // ─── Render ───
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-display font-bold text-foreground mb-1">TDS Management</h1>
          <p className="text-sm text-muted-foreground">Track deductions, challans, and filing status.</p>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="entries">Entries</TabsTrigger>
          <TabsTrigger value="filings">Filings</TabsTrigger>
        </TabsList>

        {/* ═══════════ ENTRIES TAB ═══════════ */}
        <TabsContent value="entries">
          <div className="space-y-5">
            <div className="flex justify-end">
              <Button onClick={openAdd}><Plus className="h-4 w-4 mr-1" /> Add Entry</Button>
            </div>

            {/* Stat Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {[
                { label: "Total Entries", value: stats.totalEntries, icon: FileText, color: "" },
                { label: "Total TDS Deducted", value: `₹${stats.totalDeducted.toLocaleString("en-IN")}`, icon: IndianRupee, color: "" },
                { label: "Pending Challans", value: stats.pendingChallans, icon: Clock, color: "" },
                { label: "Overdue Filings", value: stats.overdue, icon: AlertTriangle, color: stats.overdue > 0 ? "text-destructive" : "" },
              ].map(s => (
                <Card key={s.label}><CardContent className="p-5">
                  <div className="flex items-center justify-between mb-2"><p className="text-sm text-muted-foreground font-medium">{s.label}</p><s.icon className={cn("h-4 w-4 text-muted-foreground", s.color)} /></div>
                  <p className={cn("text-2xl font-display font-bold text-foreground", s.color)}>{s.value}</p>
                </CardContent></Card>
              ))}
            </div>

            {/* Filter Bar */}
            <div className="flex flex-wrap gap-3">
              <Select value={fyFilter} onValueChange={setFyFilter}><SelectTrigger className="w-[140px]"><SelectValue placeholder="FY" /></SelectTrigger><SelectContent>{FY_OPTIONS.map(fy => <SelectItem key={fy} value={fy}>{fy}</SelectItem>)}</SelectContent></Select>
              <Select value={sectionFilter} onValueChange={setSectionFilter}><SelectTrigger className="w-[160px]"><SelectValue placeholder="Section" /></SelectTrigger><SelectContent><SelectItem value="all">All Sections</SelectItem>{SECTIONS.map(s => <SelectItem key={s.value} value={s.value}>{s.value}</SelectItem>)}<SelectItem value="Other">Other</SelectItem></SelectContent></Select>
              <Select value={statusFilter} onValueChange={setStatusFilter}><SelectTrigger className="w-[130px]"><SelectValue placeholder="Status" /></SelectTrigger><SelectContent><SelectItem value="all">All Status</SelectItem><SelectItem value="pending">Pending</SelectItem><SelectItem value="paid">Paid</SelectItem><SelectItem value="filed">Filed</SelectItem></SelectContent></Select>
              <Input placeholder="Search party name..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} className="w-[220px]" />
            </div>

            {/* Entries Table */}
            <Card><CardContent className="p-0">
              {entriesLoading ? (
                <div className="p-6 space-y-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader><TableRow>
                      <TableHead>Date</TableHead><TableHead>Party Name</TableHead><TableHead>PAN</TableHead><TableHead>Payment Nature</TableHead><TableHead className="text-right">Amount (₹)</TableHead><TableHead>Section</TableHead><TableHead className="text-right">Rate %</TableHead><TableHead className="text-right">TDS (₹)</TableHead><TableHead>Challan No</TableHead><TableHead>Status</TableHead><TableHead>Actions</TableHead>
                    </TableRow></TableHeader>
                    <TableBody>
                      {filtered.map(entry => (
                        <TableRow key={entry.id}>
                          <TableCell className="text-sm text-muted-foreground whitespace-nowrap">{entry.date ? format(new Date(entry.date), "dd MMM yyyy") : "—"}</TableCell>
                          <TableCell className="font-medium max-w-[160px] truncate">{entry.party_name || "—"}</TableCell>
                          <TableCell className="font-mono text-xs">{entry.pan || "—"}</TableCell>
                          <TableCell className="text-sm max-w-[140px] truncate">{entry.payment_nature || "—"}</TableCell>
                          <TableCell className="text-right tabular-nums">{entry.amount != null ? entry.amount.toLocaleString("en-IN") : "—"}</TableCell>
                          <TableCell>{entry.section ? <Badge variant="outline" className="text-[10px]">{entry.section}</Badge> : "—"}</TableCell>
                          <TableCell className="text-right tabular-nums">{entry.tds_rate != null ? `${entry.tds_rate}%` : "—"}</TableCell>
                          <TableCell className="text-right tabular-nums font-medium">{entry.tds_amount != null ? `₹${entry.tds_amount.toLocaleString("en-IN")}` : "—"}</TableCell>
                          <TableCell className="font-mono text-xs">{entry.challan_no || "—"}</TableCell>
                          <TableCell><Badge className={cn("text-[10px] capitalize", ENTRY_STATUS_COLORS[entry.status || "pending"])}>{entry.status || "pending"}</Badge></TableCell>
                          <TableCell>
                            <div className="flex gap-0.5">
                              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(entry)}><Pencil className="h-3.5 w-3.5" /></Button>
                              <VersionHistoryPanel table_name="tds_entries" record_id={entry.id} />
                              <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => setDeleteId(entry.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                      {filtered.length === 0 && <TableRow><TableCell colSpan={11} className="text-center py-8 text-muted-foreground">No TDS entries found.</TableCell></TableRow>}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent></Card>
          </div>
        </TabsContent>

        {/* ═══════════ FILINGS TAB ═══════════ */}
        <TabsContent value="filings">
          <div className="space-y-5">
            <div className="flex justify-end">
              <Button onClick={() => { setFilingForm(emptyFilingForm); setFilingFormOpen(true); }}><Plus className="h-4 w-4 mr-1" /> New Filing</Button>
            </div>

            {/* Filing Stats */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
              {(["Data Received", "Preparation In Progress", "Under Check", "Ready to File", "Filed"] as const).map(s => (
                <Card key={s}><CardContent className="p-4">
                  <p className="text-xs text-muted-foreground font-medium truncate">{s}</p>
                  <p className="text-2xl font-display font-bold text-foreground mt-1">{filingStats[s] || 0}</p>
                </CardContent></Card>
              ))}
            </div>

            {/* Filing Filters */}
            <div className="flex flex-wrap gap-3">
              <Select value={filingClientFilter} onValueChange={setFilingClientFilter}><SelectTrigger className="w-[180px]"><SelectValue placeholder="Client" /></SelectTrigger><SelectContent><SelectItem value="all">All Clients</SelectItem>{clients.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent></Select>
              <Select value={filingFyFilter} onValueChange={setFilingFyFilter}><SelectTrigger className="w-[130px]"><SelectValue placeholder="FY" /></SelectTrigger><SelectContent><SelectItem value="all">All FYs</SelectItem>{FY_OPTIONS.map(fy => <SelectItem key={fy} value={fy}>{fy}</SelectItem>)}</SelectContent></Select>
              <Select value={filingQuarterFilter} onValueChange={setFilingQuarterFilter}><SelectTrigger className="w-[110px]"><SelectValue placeholder="Quarter" /></SelectTrigger><SelectContent><SelectItem value="all">All Quarters</SelectItem>{QUARTER_OPTIONS.map(q => <SelectItem key={q} value={q}>{q}</SelectItem>)}</SelectContent></Select>
              <Select value={filingStatusFilter} onValueChange={setFilingStatusFilter}><SelectTrigger className="w-[180px]"><SelectValue placeholder="Status" /></SelectTrigger><SelectContent><SelectItem value="all">All Status</SelectItem>{FILING_STATUS_STEPS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent></Select>
            </div>

            {/* Filings Table */}
            <Card><CardContent className="p-0">
              {filingsLoading ? (
                <div className="p-6 space-y-3">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader><TableRow>
                      <TableHead>Client</TableHead><TableHead>FY</TableHead><TableHead>Qtr</TableHead><TableHead>TDS Forms</TableHead><TableHead>Data Recd</TableHead><TableHead>Preparer</TableHead><TableHead>Checker</TableHead><TableHead>Approver</TableHead><TableHead>Status</TableHead><TableHead>Date Filed</TableHead><TableHead>Ack No</TableHead><TableHead>Actions</TableHead>
                    </TableRow></TableHeader>
                    <TableBody>
                      {filteredFilings.map(f => {
                        const isFiled = f.work_status === "Filed";
                        const canAdvance = !isFiled && FILING_STATUS_STEPS.indexOf(f.work_status as any) < FILING_STATUS_STEPS.length - 1;
                        return (
                          <TableRow key={f.id}>
                            <TableCell className="font-medium">{f.client_name || "—"}</TableCell>
                            <TableCell>{f.financial_year}</TableCell>
                            <TableCell>{f.quarter}</TableCell>
                            <TableCell>{(f.tds_forms || []).join(", ") || "—"}</TableCell>
                            <TableCell className="text-sm whitespace-nowrap">{f.date_data_received ? format(new Date(f.date_data_received), "dd MMM yy") : "—"}</TableCell>
                            <TableCell className="text-sm">{f.preparer_name || "—"}</TableCell>
                            <TableCell className="text-sm">{f.checker_name || "—"}</TableCell>
                            <TableCell className="text-sm">{f.approver_name || "—"}</TableCell>
                            <TableCell><Badge className={cn("text-[10px] whitespace-nowrap", FILING_STATUS_COLORS[f.work_status])}>{f.work_status}</Badge></TableCell>
                            <TableCell className="text-sm whitespace-nowrap">{f.date_of_filing ? format(new Date(f.date_of_filing), "dd MMM yy") : "—"}</TableCell>
                            <TableCell className="font-mono text-xs">{f.acknowledgment_number || "—"}</TableCell>
                            <TableCell>
                              <div className="flex gap-1">
                                {canAdvance && (
                                  <Button variant="outline" size="sm" className="h-7 gap-1 text-xs" onClick={() => { setAdvanceFiling(f); setAdvanceDateFiled(""); setAdvanceAckNo(""); }}>
                                    <ArrowRight className="h-3 w-3" /> Next
                                  </Button>
                                )}
                                {!isFiled && (
                                  <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={() => openLinkEntries(f)}>
                                    <Link2 className="h-3 w-3" /> Link
                                  </Button>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                      {filteredFilings.length === 0 && <TableRow><TableCell colSpan={12} className="text-center py-8 text-muted-foreground">No filings found.</TableCell></TableRow>}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent></Card>
          </div>
        </TabsContent>
      </Tabs>

      {/* ═══════════ ENTRY ADD/EDIT DRAWER ═══════════ */}
      <Sheet open={formOpen} onOpenChange={setFormOpen}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader><SheetTitle className="font-display">{editingId ? "Edit TDS Entry" : "Add TDS Entry"}</SheetTitle></SheetHeader>
          <div className="mt-6 space-y-4">
            <div>
              <label className="text-sm font-medium">Date</label>
              <Popover open={datePickerOpen} onOpenChange={setDatePickerOpen}><PopoverTrigger asChild><Button variant="outline" className={cn("w-full justify-start text-left font-normal", !form.date && "text-muted-foreground")}><CalendarIcon className="h-4 w-4 mr-2" />{form.date ? format(new Date(form.date), "PPP") : "Pick a date"}</Button></PopoverTrigger><PopoverContent className="w-auto p-0" align="start"><Calendar mode="single" selected={form.date ? new Date(form.date) : undefined} onSelect={d => { if (d) { updateForm("date", format(d, "yyyy-MM-dd")); setDatePickerOpen(false); } }} initialFocus className={cn("p-3 pointer-events-auto")} /></PopoverContent></Popover>
            </div>
            <div className="relative">
              <label className="text-sm font-medium">Party Name</label>
              <Input value={deducteeSearch} onChange={e => { setDeducteeSearch(e.target.value); updateForm("party_name", e.target.value); updateForm("deductee_id", ""); updateForm("client_id", ""); setShowDeducteeList(true); }} onFocus={() => setShowDeducteeList(true)} placeholder="Type to search..." />
              {showDeducteeList && deducteeSearch && (filteredClients.length > 0 || filteredDeductees.length > 0) && (
                <div className="absolute z-50 w-full mt-1 bg-popover border border-border rounded-md shadow-lg max-h-48 overflow-y-auto">
                  {filteredClients.length > 0 && (<><div className="px-3 py-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Clients</div>{filteredClients.slice(0, 6).map(c => (<button key={`c-${c.id}`} className="w-full text-left px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground flex justify-between" onClick={() => selectClient(c)}><span>{c.name}</span>{c.pan && <span className="font-mono text-xs text-muted-foreground">{c.pan}</span>}</button>))}</>)}
                  {filteredDeductees.length > 0 && (<><div className="px-3 py-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Deductees</div>{filteredDeductees.slice(0, 6).map(d => (<button key={`d-${d.id}`} className="w-full text-left px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground flex justify-between" onClick={() => selectDeductee(d)}><span>{d.party_name}</span>{d.pan && <span className="font-mono text-xs text-muted-foreground">{d.pan}</span>}</button>))}</>)}
                </div>
              )}
            </div>
            <div><label className="text-sm font-medium">PAN</label><div className="relative"><Input value={form.pan} onChange={e => updateForm("pan", e.target.value.toUpperCase())} placeholder="ABCDE1234F" maxLength={10} />{form.pan && form.pan.length === 10 && /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(form.pan) && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-emerald-500 text-xs font-medium">✓ Valid</span>}{form.pan && form.pan.length === 10 && !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(form.pan) && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-destructive text-xs font-medium">✗ Invalid</span>}</div></div>
            <div><label className="text-sm font-medium">Payment Nature</label><div className="flex gap-2"><Input className="flex-1" value={form.payment_nature} onChange={e => updateForm("payment_nature", e.target.value)} placeholder="e.g. Professional consulting fees" /><Button type="button" variant="outline" size="sm" className="shrink-0 gap-1" onClick={handleAiSuggest} disabled={aiLoading}><Sparkles className="h-3.5 w-3.5" />{aiLoading ? "..." : "AI Suggest"}</Button></div></div>
            {aiSuggestion && (<div className="rounded-lg border border-amber-300 bg-amber-50 p-3 space-y-2"><p className="text-sm font-medium text-amber-800">AI suggests: Section {aiSuggestion.section} at {aiSuggestion.rate}%</p><p className="text-xs text-amber-700">{aiSuggestion.description}</p><div className="flex gap-2"><Button size="sm" variant="default" onClick={acceptAiSuggestion}>Accept</Button><Button size="sm" variant="ghost" onClick={() => setAiSuggestion(null)}>Ignore</Button></div></div>)}
            <div><label className="text-sm font-medium">Amount (₹)</label><Input type="number" value={form.amount} onChange={e => updateForm("amount", e.target.value)} placeholder="0" /></div>
            <div><label className="text-sm font-medium">Section</label><Select value={form.section} onValueChange={v => updateForm("section", v)}><SelectTrigger><SelectValue placeholder="Select section" /></SelectTrigger><SelectContent>{SECTIONS.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent></Select></div>
            <div><label className="text-sm font-medium">TDS Rate (%)</label><Input type="number" step="0.1" value={form.tds_rate} onChange={e => updateForm("tds_rate", e.target.value)} /></div>
            <div><label className="text-sm font-medium">TDS Amount (₹)</label><Input type="number" value={form.tds_amount} onChange={e => updateForm("tds_amount", e.target.value)} /></div>
            <div><label className="text-sm font-medium">Due Date</label><Popover open={dueDatePickerOpen} onOpenChange={setDueDatePickerOpen}><PopoverTrigger asChild><Button variant="outline" className={cn("w-full justify-start text-left font-normal", !form.due_date && "text-muted-foreground")}><CalendarIcon className="h-4 w-4 mr-2" />{form.due_date ? format(new Date(form.due_date), "PPP") : "Pick due date"}</Button></PopoverTrigger><PopoverContent className="w-auto p-0" align="start"><Calendar mode="single" selected={form.due_date ? new Date(form.due_date) : undefined} onSelect={d => { if (d) { updateForm("due_date", format(d, "yyyy-MM-dd")); setDueDatePickerOpen(false); } }} initialFocus className={cn("p-3 pointer-events-auto")} /></PopoverContent></Popover></div>
            <div><label className="text-sm font-medium">Challan No (optional)</label><Input value={form.challan_no} onChange={e => updateForm("challan_no", e.target.value)} placeholder="e.g. 12345678" /></div>
          </div>
          <SheetFooter className="mt-6"><Button variant="outline" onClick={() => setFormOpen(false)}>Cancel</Button><Button onClick={handleSave} disabled={saving}>{saving ? "Saving..." : editingId ? "Update Entry" : "Save Entry"}</Button></SheetFooter>
        </SheetContent>
      </Sheet>

      {/* ═══════════ DELETE ENTRY DIALOG ═══════════ */}
      <AlertDialog open={!!deleteId} onOpenChange={o => !o && setDeleteId(null)}>
        <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Delete TDS Entry?</AlertDialogTitle><AlertDialogDescription>This action will be logged but the entry will be removed.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={handleDelete} disabled={deleting} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">{deleting ? "Deleting..." : "Delete"}</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
      </AlertDialog>

      {/* ═══════════ NEW FILING DRAWER ═══════════ */}
      <Sheet open={filingFormOpen} onOpenChange={setFilingFormOpen}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader><SheetTitle className="font-display">New TDS Filing</SheetTitle></SheetHeader>
          <div className="mt-6 space-y-4">
            <div><label className="text-sm font-medium">Client *</label><Select value={filingForm.client_id} onValueChange={v => setFilingForm(f => ({ ...f, client_id: v }))}><SelectTrigger><SelectValue placeholder="Select client" /></SelectTrigger><SelectContent>{clients.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent></Select></div>
            <div><label className="text-sm font-medium">Financial Year *</label><Select value={filingForm.financial_year} onValueChange={v => setFilingForm(f => ({ ...f, financial_year: v }))}><SelectTrigger><SelectValue placeholder="Select FY" /></SelectTrigger><SelectContent>{FY_OPTIONS.map(fy => <SelectItem key={fy} value={fy}>{fy}</SelectItem>)}</SelectContent></Select></div>
            <div>
              <label className="text-sm font-medium">Quarter *</label>
              <RadioGroup value={filingForm.quarter} onValueChange={v => setFilingForm(f => ({ ...f, quarter: v }))} className="flex gap-4 mt-2">
                {QUARTER_OPTIONS.map(q => (<div key={q} className="flex items-center space-x-2"><RadioGroupItem value={q} id={`q-${q}`} /><Label htmlFor={`q-${q}`}>{q}</Label></div>))}
              </RadioGroup>
            </div>
            <div>
              <label className="text-sm font-medium">TDS Forms * (select at least one)</label>
              <div className="flex flex-wrap gap-4 mt-2">
                {TDS_FORM_OPTIONS.map(tf => (
                  <div key={tf} className="flex items-center space-x-2">
                    <Checkbox id={`tf-${tf}`} checked={filingForm.tds_forms.includes(tf)} onCheckedChange={checked => setFilingForm(f => ({ ...f, tds_forms: checked ? [...f.tds_forms, tf] : f.tds_forms.filter(x => x !== tf) }))} />
                    <Label htmlFor={`tf-${tf}`}>{tf}</Label>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <label className="text-sm font-medium">Date Data Received</label>
              <Popover open={filingDataRecvPicker} onOpenChange={setFilingDataRecvPicker}><PopoverTrigger asChild><Button variant="outline" className={cn("w-full justify-start text-left font-normal", !filingForm.date_data_received && "text-muted-foreground")}><CalendarIcon className="h-4 w-4 mr-2" />{filingForm.date_data_received ? format(new Date(filingForm.date_data_received), "PPP") : "Pick date"}</Button></PopoverTrigger><PopoverContent className="w-auto p-0" align="start"><Calendar mode="single" selected={filingForm.date_data_received ? new Date(filingForm.date_data_received) : undefined} onSelect={d => { if (d) { setFilingForm(f => ({ ...f, date_data_received: format(d, "yyyy-MM-dd") })); setFilingDataRecvPicker(false); } }} initialFocus className={cn("p-3 pointer-events-auto")} /></PopoverContent></Popover>
            </div>
            <div><label className="text-sm font-medium">Preparer</label><Select value={filingForm.preparer_id} onValueChange={v => setFilingForm(f => ({ ...f, preparer_id: v }))}><SelectTrigger><SelectValue placeholder="Select preparer" /></SelectTrigger><SelectContent>{staffUsers.length > 0 ? staffUsers.map(u => <SelectItem key={u.id} value={u.id}>{u.name || u.id}</SelectItem>) : users.map(u => <SelectItem key={u.id} value={u.id}>{u.name || u.id}</SelectItem>)}</SelectContent></Select></div>
            <div><label className="text-sm font-medium">Checker</label><Select value={filingForm.checker_id} onValueChange={v => setFilingForm(f => ({ ...f, checker_id: v }))}><SelectTrigger><SelectValue placeholder="Select checker" /></SelectTrigger><SelectContent>{managerUsers.length > 0 ? managerUsers.map(u => <SelectItem key={u.id} value={u.id}>{u.name || u.id}</SelectItem>) : users.map(u => <SelectItem key={u.id} value={u.id}>{u.name || u.id}</SelectItem>)}</SelectContent></Select></div>
            <div><label className="text-sm font-medium">Approver</label><Select value={filingForm.approver_id} onValueChange={v => setFilingForm(f => ({ ...f, approver_id: v }))}><SelectTrigger><SelectValue placeholder="Select approver" /></SelectTrigger><SelectContent>{partnerUsers.length > 0 ? partnerUsers.map(u => <SelectItem key={u.id} value={u.id}>{u.name || u.id}</SelectItem>) : users.map(u => <SelectItem key={u.id} value={u.id}>{u.name || u.id}</SelectItem>)}</SelectContent></Select></div>
            <div><label className="text-sm font-medium">Remarks</label><Textarea value={filingForm.remarks} onChange={e => setFilingForm(f => ({ ...f, remarks: e.target.value }))} placeholder="Any notes..." /></div>
          </div>
          <SheetFooter className="mt-6"><Button variant="outline" onClick={() => setFilingFormOpen(false)}>Cancel</Button><Button onClick={handleFilingSave} disabled={filingSaving}>{filingSaving ? "Saving..." : "Create Filing"}</Button></SheetFooter>
        </SheetContent>
      </Sheet>

      {/* ═══════════ ADVANCE STATUS DIALOG ═══════════ */}
      <AlertDialog open={!!advanceFiling} onOpenChange={o => !o && setAdvanceFiling(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Advance Filing Status</AlertDialogTitle>
            <AlertDialogDescription>
              {advanceFiling && (() => {
                const idx = FILING_STATUS_STEPS.indexOf(advanceFiling.work_status as any);
                const next = idx >= 0 && idx < FILING_STATUS_STEPS.length - 1 ? FILING_STATUS_STEPS[idx + 1] : null;
                return next ? `Move from "${advanceFiling.work_status}" → "${next}"?` : "";
              })()}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {advanceFiling && FILING_STATUS_STEPS.indexOf(advanceFiling.work_status as any) === FILING_STATUS_STEPS.length - 2 && (
            <div className="space-y-3 py-2">
              <div><label className="text-sm font-medium">Date of Filing *</label><Input type="date" value={advanceDateFiled} onChange={e => setAdvanceDateFiled(e.target.value)} /></div>
              <div><label className="text-sm font-medium">Acknowledgment Number *</label><Input value={advanceAckNo} onChange={e => setAdvanceAckNo(e.target.value)} placeholder="e.g. 1234567890" /></div>
            </div>
          )}
          <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={handleAdvanceStatus} disabled={advancing}>{advancing ? "Advancing..." : "Advance"}</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ═══════════ LINK ENTRIES MODAL ═══════════ */}
      <Dialog open={!!linkFiling} onOpenChange={o => !o && setLinkFiling(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Link TDS Entries to Filing</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            {linkFiling && `Client: ${linkFiling.client_name || "—"} | FY: ${linkFiling.financial_year} | ${linkFiling.quarter}`}
          </p>
          {unlinkEntries.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">No unlinked entries found for this client and FY.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader><TableRow>
                  <TableHead className="w-10"></TableHead><TableHead>Date</TableHead><TableHead>Party</TableHead><TableHead>Section</TableHead><TableHead className="text-right">TDS (₹)</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {unlinkEntries.map(e => (
                    <TableRow key={e.id}>
                      <TableCell><Checkbox checked={selectedLinkIds.includes(e.id)} onCheckedChange={checked => setSelectedLinkIds(prev => checked ? [...prev, e.id] : prev.filter(x => x !== e.id))} /></TableCell>
                      <TableCell className="text-sm">{e.date ? format(new Date(e.date), "dd MMM yy") : "—"}</TableCell>
                      <TableCell className="text-sm">{e.party_name || "—"}</TableCell>
                      <TableCell><Badge variant="outline" className="text-[10px]">{e.section || "—"}</Badge></TableCell>
                      <TableCell className="text-right tabular-nums">{e.tds_amount != null ? `₹${e.tds_amount.toLocaleString("en-IN")}` : "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setLinkFiling(null)}>Cancel</Button>
            <Button onClick={handleLinkEntries} disabled={linkingEntries || selectedLinkIds.length === 0}>{linkingEntries ? "Linking..." : `Link ${selectedLinkIds.length} Entries`}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default TdsFilings;
