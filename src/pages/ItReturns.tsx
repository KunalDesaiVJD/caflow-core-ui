import { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
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
  FileText, Plus, Clock, CheckCircle2, AlertTriangle, XCircle, Pencil, Trash2,
  TableIcon, LayoutGrid, Columns3, BarChart3, Filter, X, ChevronRight,
} from "lucide-react";

// ─── Types ───
interface WorkGroup {
  id: string;
  firm_id: string;
  code: string;
  name: string;
  description: string | null;
  color: string | null;
}

interface ItrProfile {
  id: string;
  client_id: string | null;
  firm_id: string | null;
  financial_year: string | null;
  itr_form: string | null;
  filing_status: string | null;
  ais_recon_data: any;
  itr_work_group_id: string | null;
  assigned_to: string | null;
  date_data_received: string | null;
  date_filed: string | null;
  acknowledgment_no: string | null;
  assessment_year: string | null;
  client_name?: string;
  entity_type?: string;
  group_code?: string;
  group_color?: string;
  group_name?: string;
  assigned_name?: string;
}

interface Client { id: string; name: string | null; entity_type: string | null; }
interface StaffUser { id: string; name: string | null; role: string | null; }

const STATUS_COLORS: Record<string, string> = {
  "Not Started": "bg-muted text-muted-foreground",
  "In Progress": "bg-amber-500/15 text-amber-600",
  "Ready to File": "bg-purple-500/15 text-purple-600",
  Filed: "bg-emerald-500/15 text-emerald-600",
  Revised: "bg-blue-500/15 text-blue-600",
  Defective: "bg-destructive/15 text-destructive",
};

const ITR_FORMS = ["ITR-1", "ITR-2", "ITR-3", "ITR-4", "ITR-5", "ITR-6", "ITR-7"];
const FILING_STATUSES = ["Not Started", "In Progress", "Ready to File", "Filed", "Revised"];
const ASSESSMENT_YEARS = ["2026-27", "2025-26", "2024-25", "2023-24", "2022-23"];
const FY_OPTIONS = ["2025-26", "2024-25", "2023-24", "2022-23", "2021-22", "2020-21"];

type ViewMode = "table" | "card" | "kanban" | "summary";

function suggestItrForm(entityType: string | null): string {
  if (!entityType) return "ITR-3";
  const t = entityType.toLowerCase();
  if (t.includes("private") || t.includes("public") || t.includes("company") || t.includes("ltd")) return "ITR-6";
  if (t.includes("llp") || t.includes("partnership")) return "ITR-5";
  if (t === "firm" || t.includes("partner")) return "ITR-5";
  if (t.includes("huf")) return "ITR-2";
  if (t.includes("trust") || t.includes("aop") || t.includes("boi")) return "ITR-5";
  if (t.includes("individual") || t.includes("proprietor")) return "ITR-3";
  return "ITR-3";
}

const ItReturns = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();
  const isSuperadmin = user?.role === "superadmin";

  const [profiles, setProfiles] = useState<ItrProfile[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [staffUsers, setStaffUsers] = useState<StaffUser[]>([]);
  const [workGroups, setWorkGroups] = useState<WorkGroup[]>([]);
  const [demands, setDemands] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  // View & filters
  const [viewMode, setViewMode] = useState<ViewMode>("table");
  const [activeGroup, setActiveGroup] = useState<string>("all");
  const [showFilters, setShowFilters] = useState(false);
  const [filterStaff, setFilterStaff] = useState<string[]>([]);
  const [filterStatus, setFilterStatus] = useState("");
  const [filterForm, setFilterForm] = useState("");
  const [filterAY, setFilterAY] = useState("");
  const [search, setSearch] = useState("");

  // Form state
  const [formClientId, setFormClientId] = useState("");
  const [formFY, setFormFY] = useState("2024-25");
  const [formAY, setFormAY] = useState("2025-26");
  const [formItrForm, setFormItrForm] = useState("ITR-3");
  const [formStatus, setFormStatus] = useState("Not Started");
  const [formGroupId, setFormGroupId] = useState("");
  const [formAssignedTo, setFormAssignedTo] = useState("");
  const [formDateReceived, setFormDateReceived] = useState("");
  const [formDateFiled, setFormDateFiled] = useState("");
  const [formAckNo, setFormAckNo] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteProfile, setDeleteProfile] = useState<ItrProfile | null>(null);

  const firmId = user?.firm_id;

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [pRes, cRes, dRes, wgRes, uRes] = await Promise.all([
        (() => { let q = supabase.from("itr_profiles").select("*"); if (!isSuperadmin && firmId) q = q.eq("firm_id", firmId); return q; })(),
        (() => { let q = supabase.from("clients").select("id, name, entity_type"); if (!isSuperadmin && firmId) q = q.eq("firm_id", firmId); return q; })(),
        supabase.from("itr_demands").select("*"),
        (() => { let q = supabase.from("itr_work_groups" as any).select("*"); if (!isSuperadmin && firmId) q = q.eq("firm_id", firmId); return q; })(),
        (() => { let q = supabase.from("users").select("id, name, role"); if (!isSuperadmin && firmId) q = q.eq("firm_id", firmId); return q; })(),
      ]);

      const clientMap = new Map<string, Client>();
      (cRes.data || []).forEach((c: any) => clientMap.set(c.id, c));

      const wgMap = new Map<string, WorkGroup>();
      (wgRes.data || []).forEach((g: any) => wgMap.set(g.id, g));

      const userMap = new Map<string, string>();
      (uRes.data || []).forEach((u: any) => userMap.set(u.id, u.name || u.id));

      const enriched = (pRes.data || []).map((p: any) => {
        const wg = wgMap.get(p.itr_work_group_id || "");
        return {
          ...p,
          client_name: clientMap.get(p.client_id || "")?.name || "Unknown",
          entity_type: clientMap.get(p.client_id || "")?.entity_type || "",
          group_code: wg?.code || null,
          group_color: wg?.color || null,
          group_name: wg?.name || null,
          assigned_name: userMap.get(p.assigned_to || "") || null,
        };
      });

      setProfiles(enriched);
      setClients(cRes.data || []);
      setDemands(dRes.data || []);
      setWorkGroups((wgRes.data || []) as any);
      setStaffUsers((uRes.data || []) as any);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [firmId, isSuperadmin]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Filtering
  const filtered = useMemo(() => {
    return profiles.filter((p) => {
      if (activeGroup !== "all" && p.group_code !== activeGroup) return false;
      if (search && !(p.client_name || "").toLowerCase().includes(search.toLowerCase())) return false;
      if (filterStatus && (p.filing_status || "Not Started") !== filterStatus) return false;
      if (filterForm && p.itr_form !== filterForm) return false;
      if (filterAY && p.assessment_year !== filterAY) return false;
      if (filterStaff.length > 0 && !filterStaff.includes(p.assigned_to || "")) return false;
      return true;
    });
  }, [profiles, activeGroup, search, filterStatus, filterForm, filterAY, filterStaff]);

  // Stats
  const total = profiles.length;
  const filed = profiles.filter((p) => p.filing_status === "Filed" || p.filing_status === "Revised").length;
  const inProgress = profiles.filter((p) => p.filing_status === "In Progress").length;
  const notStarted = profiles.filter((p) => p.filing_status === "Not Started" || !p.filing_status).length;
  const demandTotal = demands.reduce((s, d) => s + (d.demand_amount || 0), 0);
  const demandPending = demands.filter((d) => d.status !== "resolved").length;

  // Group counts
  const groupCounts = useMemo(() => {
    const counts: Record<string, number> = { all: profiles.length };
    workGroups.forEach((g) => { counts[g.code] = 0; });
    profiles.forEach((p) => { if (p.group_code) counts[p.group_code] = (counts[p.group_code] || 0) + 1; });
    return counts;
  }, [profiles, workGroups]);

  const handleClientChange = (clientId: string) => {
    setFormClientId(clientId);
    const client = clients.find((c) => c.id === clientId);
    setFormItrForm(suggestItrForm(client?.entity_type || null));
  };

  const clearFilters = () => {
    setFilterStaff([]);
    setFilterStatus("");
    setFilterForm("");
    setFilterAY("");
    setSearch("");
  };

  const hasActiveFilters = filterStaff.length > 0 || filterStatus || filterForm || filterAY || search;

  const openNew = () => {
    setEditingId(null);
    setFormClientId("");
    setFormFY("2024-25");
    setFormAY("2025-26");
    setFormItrForm("ITR-3");
    setFormStatus("Not Started");
    setFormGroupId("");
    setFormAssignedTo("");
    setFormDateReceived("");
    setFormDateFiled("");
    setFormAckNo("");
    setSheetOpen(true);
  };

  const handleEdit = (p: ItrProfile) => {
    setEditingId(p.id);
    setFormClientId(p.client_id || "");
    setFormFY(p.financial_year || "2024-25");
    setFormAY(p.assessment_year || "2025-26");
    setFormItrForm(p.itr_form || "ITR-3");
    setFormStatus(p.filing_status || "Not Started");
    setFormGroupId(p.itr_work_group_id || "");
    setFormAssignedTo(p.assigned_to || "");
    setFormDateReceived(p.date_data_received || "");
    setFormDateFiled(p.date_filed || "");
    setFormAckNo(p.acknowledgment_no || "");
    setSheetOpen(true);
  };

  const handleSave = async () => {
    if (!formClientId) { toast({ title: "Select a client", variant: "destructive" }); return; }
    setSaving(true);
    try {
      const payload: any = {
        client_id: formClientId,
        financial_year: formFY,
        assessment_year: formAY,
        itr_form: formItrForm,
        filing_status: formStatus,
        itr_work_group_id: formGroupId || null,
        assigned_to: formAssignedTo || null,
        date_data_received: formDateReceived || null,
        date_filed: formDateFiled || null,
        acknowledgment_no: formAckNo || null,
      };
      if (editingId) {
        const { error } = await supabase.from("itr_profiles").update(payload).eq("id", editingId);
        if (error) throw error;
        toast({ title: "ITR profile updated" });
      } else {
        payload.firm_id = firmId || null;
        const { error } = await supabase.from("itr_profiles").insert(payload);
        if (error) throw error;
        toast({ title: "ITR profile created" });
      }
      setSheetOpen(false);
      setEditingId(null);
      fetchData();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteProfile) return;
    try {
      const { error } = await supabase.from("itr_profiles").delete().eq("id", deleteProfile.id);
      if (error) throw error;
      toast({ title: "ITR profile deleted" });
      setDeleteProfile(null);
      fetchData();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  };

  const handleStatusChange = async (profileId: string, newStatus: string) => {
    try {
      const { error } = await supabase.from("itr_profiles").update({ filing_status: newStatus } as any).eq("id", profileId);
      if (error) throw error;
      toast({ title: `Status updated to ${newStatus}` });
      fetchData();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  };

  const stats = [
    { label: "Total Profiles", value: total, icon: FileText, color: "text-foreground" },
    { label: "Filed", value: filed, icon: CheckCircle2, color: "text-emerald-600" },
    { label: "In Progress", value: inProgress, icon: Clock, color: "text-amber-600" },
    { label: "Not Started", value: notStarted, icon: XCircle, color: "text-muted-foreground" },
    { label: "Demand Pending", value: demandPending, icon: AlertTriangle, color: "text-destructive", sub: `₹${demandTotal.toLocaleString("en-IN")}` },
  ];

  const GROUP_TABS = [
    { code: "all", label: "All" },
    ...workGroups.map((g) => ({ code: g.code, label: `${g.code} - ${g.name}` })),
  ];

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-display font-bold text-foreground">IT Returns</h1>
          <p className="text-muted-foreground text-sm">Income tax return filing and tracking</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => navigate("/itr/demands")}>
            <AlertTriangle size={16} className="mr-2" /> Demands
          </Button>
          <Button onClick={openNew}>
            <Plus size={16} className="mr-2" /> Add ITR Profile
          </Button>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
        {stats.map((s) => (
          <Card key={s.label} className={s.label === "Demand Pending" ? "border-destructive/30" : ""}>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <s.icon size={16} className={s.color} />
                <span className="text-xs text-muted-foreground">{s.label}</span>
              </div>
              <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
              {s.sub && <p className="text-xs text-destructive mt-1">{s.sub}</p>}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Group tabs + view toggle + filter */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-1 overflow-x-auto">
          {GROUP_TABS.map((tab) => (
            <Button
              key={tab.code}
              variant={activeGroup === tab.code ? "default" : "outline"}
              size="sm"
              onClick={() => setActiveGroup(tab.code)}
              className="whitespace-nowrap"
            >
              {tab.label}
              <Badge variant="secondary" className="ml-1.5 text-[10px] px-1.5 py-0">
                {groupCounts[tab.code] || 0}
              </Badge>
            </Button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant={showFilters ? "default" : "outline"}
            size="sm"
            onClick={() => setShowFilters(!showFilters)}
          >
            <Filter size={14} className="mr-1" /> Filters
            {hasActiveFilters && <Badge variant="destructive" className="ml-1 text-[10px] px-1">!</Badge>}
          </Button>
          <div className="flex border rounded-md">
            {([
              { mode: "table" as ViewMode, icon: TableIcon, label: "Table" },
              { mode: "card" as ViewMode, icon: LayoutGrid, label: "Cards" },
              { mode: "kanban" as ViewMode, icon: Columns3, label: "Kanban" },
              { mode: "summary" as ViewMode, icon: BarChart3, label: "Summary" },
            ]).map(({ mode, icon: Icon, label }) => (
              <Button
                key={mode}
                variant={viewMode === mode ? "default" : "ghost"}
                size="sm"
                className="rounded-none first:rounded-l-md last:rounded-r-md px-2"
                onClick={() => setViewMode(mode)}
                title={label}
              >
                <Icon size={14} />
              </Button>
            ))}
          </div>
        </div>
      </div>

      {/* Filter bar */}
      {showFilters && (
        <div className="flex flex-wrap items-end gap-3 mb-4 p-3 border rounded-lg bg-muted/30">
          <div className="min-w-[160px]">
            <label className="text-xs text-muted-foreground mb-1 block">Search</label>
            <Input placeholder="Client name..." value={search} onChange={(e) => setSearch(e.target.value)} className="h-8 text-sm" />
          </div>
          <div className="min-w-[140px]">
            <label className="text-xs text-muted-foreground mb-1 block">Status</label>
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="All" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all_statuses">All</SelectItem>
                {FILING_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="min-w-[120px]">
            <label className="text-xs text-muted-foreground mb-1 block">ITR Form</label>
            <Select value={filterForm} onValueChange={setFilterForm}>
              <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="All" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all_forms">All</SelectItem>
                {ITR_FORMS.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="min-w-[120px]">
            <label className="text-xs text-muted-foreground mb-1 block">Assessment Year</label>
            <Select value={filterAY} onValueChange={setFilterAY}>
              <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="All" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all_ay">All</SelectItem>
                {ASSESSMENT_YEARS.map((ay) => <SelectItem key={ay} value={ay}>{ay}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="min-w-[140px]">
            <label className="text-xs text-muted-foreground mb-1 block">Assigned Staff</label>
            <Select value={filterStaff[0] || ""} onValueChange={(v) => setFilterStaff(v ? [v] : [])}>
              <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="All" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all_staff">All</SelectItem>
                {staffUsers.map((u) => <SelectItem key={u.id} value={u.id}>{u.name || u.id}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {hasActiveFilters && (
            <Button variant="ghost" size="sm" onClick={clearFilters} className="h-8">
              <X size={14} className="mr-1" /> Clear
            </Button>
          )}
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div className="space-y-3">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
      ) : (
        <>
          {viewMode === "table" && <TableView profiles={filtered} demands={demands} onEdit={handleEdit} onDelete={setDeleteProfile} onNavigate={navigate} />}
          {viewMode === "card" && <CardView profiles={filtered} onEdit={handleEdit} onStatusChange={handleStatusChange} />}
          {viewMode === "kanban" && <KanbanView profiles={filtered} onEdit={handleEdit} onStatusChange={handleStatusChange} />}
          {viewMode === "summary" && <SummaryView profiles={profiles} workGroups={workGroups} />}
        </>
      )}

      {/* Sheet */}
      <Sheet open={sheetOpen} onOpenChange={(open) => { if (!open) { setSheetOpen(false); setEditingId(null); } else setSheetOpen(true); }}>
        <SheetContent className="overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{editingId ? "Edit ITR Profile" : "Add ITR Profile"}</SheetTitle>
          </SheetHeader>
          <div className="space-y-4 py-4">
            <div>
              <label className="text-sm font-medium text-foreground mb-1 block">Client *</label>
              <Select value={formClientId} onValueChange={handleClientChange}>
                <SelectTrigger><SelectValue placeholder="Select client" /></SelectTrigger>
                <SelectContent>{clients.map((c) => <SelectItem key={c.id} value={c.id}>{c.name} ({c.entity_type})</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium text-foreground mb-1 block">Financial Year</label>
                <Select value={formFY} onValueChange={setFormFY}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{FY_OPTIONS.map((fy) => <SelectItem key={fy} value={fy}>{fy}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-sm font-medium text-foreground mb-1 block">Assessment Year</label>
                <Select value={formAY} onValueChange={setFormAY}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{ASSESSMENT_YEARS.map((ay) => <SelectItem key={ay} value={ay}>{ay}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium text-foreground mb-1 block">ITR Form</label>
                <Select value={formItrForm} onValueChange={setFormItrForm}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{ITR_FORMS.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}</SelectContent>
                </Select>
                {formClientId && <p className="text-xs text-muted-foreground mt-1">Auto-suggested based on entity type</p>}
              </div>
              <div>
                <label className="text-sm font-medium text-foreground mb-1 block">Filing Status</label>
                <Select value={formStatus} onValueChange={setFormStatus}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{FILING_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <label className="text-sm font-medium text-foreground mb-1 block">Work Group</label>
              <Select value={formGroupId} onValueChange={setFormGroupId}>
                <SelectTrigger><SelectValue placeholder="Select group" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {workGroups.map((g) => <SelectItem key={g.id} value={g.id}>{g.code} - {g.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium text-foreground mb-1 block">Assigned To</label>
              <Select value={formAssignedTo} onValueChange={setFormAssignedTo}>
                <SelectTrigger><SelectValue placeholder="Select staff" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="unassigned">Unassigned</SelectItem>
                  {staffUsers.map((u) => <SelectItem key={u.id} value={u.id}>{u.name} ({u.role})</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium text-foreground mb-1 block">Date Data Received</label>
                <Input type="date" value={formDateReceived} onChange={(e) => setFormDateReceived(e.target.value)} />
              </div>
              <div>
                <label className="text-sm font-medium text-foreground mb-1 block">Date Filed</label>
                <Input type="date" value={formDateFiled} onChange={(e) => setFormDateFiled(e.target.value)} />
              </div>
            </div>
            <div>
              <label className="text-sm font-medium text-foreground mb-1 block">Acknowledgment No</label>
              <Input value={formAckNo} onChange={(e) => setFormAckNo(e.target.value)} placeholder="e.g. 1234567890" />
            </div>
          </div>
          <SheetFooter>
            <Button onClick={handleSave} disabled={saving} className="w-full">
              {saving ? "Saving..." : editingId ? "Update Profile" : "Create Profile"}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteProfile} onOpenChange={(open) => { if (!open) setDeleteProfile(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete ITR Profile</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete the ITR profile for <strong>{deleteProfile?.client_name}</strong>?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

// ─── Table View ───
function TableView({ profiles, demands, onEdit, onDelete, onNavigate }: {
  profiles: ItrProfile[]; demands: any[]; onEdit: (p: ItrProfile) => void;
  onDelete: (p: ItrProfile) => void; onNavigate: (path: string) => void;
}) {
  return (
    <div className="border rounded-lg overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Client</TableHead>
            <TableHead>Group</TableHead>
            <TableHead>ITR Form</TableHead>
            <TableHead>AY</TableHead>
            <TableHead>Assigned To</TableHead>
            <TableHead>Date Recd</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Date Filed</TableHead>
            <TableHead>Ack No</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {profiles.length === 0 ? (
            <TableRow><TableCell colSpan={10} className="text-center text-muted-foreground py-8">No ITR profiles found.</TableCell></TableRow>
          ) : profiles.map((p) => (
            <TableRow key={p.id} className="hover:bg-muted/50">
              <TableCell className="font-medium cursor-pointer" onClick={() => onNavigate(`/itr/${p.client_id}`)}>{p.client_name}</TableCell>
              <TableCell>
                {p.group_code ? (
                  <Badge className="text-[10px]" style={{ backgroundColor: `${p.group_color}20`, color: p.group_color || undefined, borderColor: `${p.group_color}40` }}>{p.group_code}</Badge>
                ) : <span className="text-muted-foreground text-xs">—</span>}
              </TableCell>
              <TableCell>{p.itr_form || "—"}</TableCell>
              <TableCell className="text-muted-foreground">{p.assessment_year || "—"}</TableCell>
              <TableCell className="text-sm">{p.assigned_name || <span className="text-muted-foreground">—</span>}</TableCell>
              <TableCell className="text-sm text-muted-foreground">{p.date_data_received || "—"}</TableCell>
              <TableCell>
                <Badge className={STATUS_COLORS[p.filing_status || "Not Started"] || STATUS_COLORS["Not Started"]}>
                  {p.filing_status || "Not Started"}
                </Badge>
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">{p.date_filed || "—"}</TableCell>
              <TableCell className="text-sm text-muted-foreground">{p.acknowledgment_no || "—"}</TableCell>
              <TableCell className="text-right">
                <div className="flex justify-end gap-1">
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onEdit(p)}><Pencil size={14} /></Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => onDelete(p)}><Trash2 size={14} /></Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

// ─── Card View ───
function CardView({ profiles, onEdit, onStatusChange }: {
  profiles: ItrProfile[]; onEdit: (p: ItrProfile) => void;
  onStatusChange: (id: string, status: string) => void;
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {profiles.length === 0 ? (
        <p className="col-span-full text-center text-muted-foreground py-8">No profiles found.</p>
      ) : profiles.map((p) => (
        <Card key={p.id} className="hover:shadow-md transition-shadow cursor-pointer" onClick={() => onEdit(p)}>
          <CardContent className="p-4">
            <div className="flex items-start justify-between mb-2">
              <h3 className="font-semibold text-foreground text-sm truncate">{p.client_name}</h3>
              {p.group_code && (
                <Badge className="text-[10px] ml-2 shrink-0" style={{ backgroundColor: `${p.group_color}20`, color: p.group_color || undefined }}>{p.group_code} - {p.group_name}</Badge>
              )}
            </div>
            <div className="flex items-center gap-2 mb-3">
              <Badge className={STATUS_COLORS[p.filing_status || "Not Started"]}>{p.filing_status || "Not Started"}</Badge>
              {p.itr_form && <Badge variant="outline" className="text-[10px]">{p.itr_form}</Badge>}
            </div>
            <div className="text-xs text-muted-foreground space-y-1">
              {p.assigned_name && <p>Assigned: {p.assigned_name}</p>}
              {p.assessment_year && <p>AY: {p.assessment_year}</p>}
              {p.date_data_received && <p>Data received: {p.date_data_received}</p>}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ─── Kanban View ───
function KanbanView({ profiles, onEdit, onStatusChange }: {
  profiles: ItrProfile[]; onEdit: (p: ItrProfile) => void;
  onStatusChange: (id: string, status: string) => void;
}) {
  const columns = FILING_STATUSES;
  const getByStatus = (status: string) => profiles.filter((p) => (p.filing_status || "Not Started") === status);

  return (
    <div className="flex gap-4 overflow-x-auto pb-4">
      {columns.map((status) => {
        const items = getByStatus(status);
        return (
          <div key={status} className="min-w-[250px] flex-shrink-0">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-foreground">{status}</h3>
              <Badge variant="secondary" className="text-[10px]">{items.length}</Badge>
            </div>
            <div className="space-y-2">
              {items.map((p) => {
                const statusIdx = columns.indexOf(p.filing_status || "Not Started");
                const nextStatus = statusIdx < columns.length - 1 ? columns[statusIdx + 1] : null;
                return (
                  <Card key={p.id} className="cursor-pointer hover:shadow-md transition-shadow">
                    <CardContent className="p-3">
                      <p className="font-medium text-sm text-foreground truncate mb-1">{p.client_name}</p>
                      <div className="flex items-center gap-1.5 mb-2">
                        {p.group_code && <Badge className="text-[9px] px-1" style={{ backgroundColor: `${p.group_color}20`, color: p.group_color || undefined }}>{p.group_code}</Badge>}
                        {p.itr_form && <Badge variant="outline" className="text-[9px] px-1">{p.itr_form}</Badge>}
                      </div>
                      {p.assigned_name && <p className="text-[11px] text-muted-foreground">→ {p.assigned_name}</p>}
                      <div className="flex items-center justify-between mt-2">
                        <Button variant="ghost" size="sm" className="h-6 text-xs px-2" onClick={(e) => { e.stopPropagation(); onEdit(p); }}>
                          <Pencil size={10} className="mr-1" /> Edit
                        </Button>
                        {nextStatus && (
                          <Button variant="outline" size="sm" className="h-6 text-xs px-2" onClick={(e) => { e.stopPropagation(); onStatusChange(p.id, nextStatus); }}>
                            <ChevronRight size={10} className="mr-1" /> {nextStatus}
                          </Button>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
              {items.length === 0 && <p className="text-xs text-muted-foreground text-center py-4">No items</p>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Summary View ───
function SummaryView({ profiles, workGroups }: { profiles: ItrProfile[]; workGroups: WorkGroup[] }) {
  const rows = workGroups.map((g) => {
    const items = profiles.filter((p) => p.group_code === g.code);
    const totalCount = items.length;
    const filedCount = items.filter((p) => p.filing_status === "Filed" || p.filing_status === "Revised").length;
    const pendingCount = items.filter((p) => !p.filing_status || p.filing_status === "Not Started").length;
    const inProgressCount = items.filter((p) => p.filing_status === "In Progress" || p.filing_status === "Ready to File").length;
    const pct = totalCount > 0 ? Math.round((filedCount / totalCount) * 100) : 0;
    return { ...g, totalCount, filedCount, pendingCount, inProgressCount, pct };
  });

  // Ungrouped
  const ungrouped = profiles.filter((p) => !p.group_code);
  if (ungrouped.length > 0) {
    const filedCount = ungrouped.filter((p) => p.filing_status === "Filed" || p.filing_status === "Revised").length;
    const pendingCount = ungrouped.filter((p) => !p.filing_status || p.filing_status === "Not Started").length;
    const inProgressCount = ungrouped.filter((p) => p.filing_status === "In Progress" || p.filing_status === "Ready to File").length;
    rows.push({
      id: "ungrouped", firm_id: "", code: "—", name: "Ungrouped", description: null, color: "#6B7280",
      totalCount: ungrouped.length, filedCount, pendingCount, inProgressCount,
      pct: ungrouped.length > 0 ? Math.round((filedCount / ungrouped.length) * 100) : 0,
    });
  }

  return (
    <div className="border rounded-lg overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Group</TableHead>
            <TableHead className="text-center">Total</TableHead>
            <TableHead className="text-center">Filed</TableHead>
            <TableHead className="text-center">In Progress</TableHead>
            <TableHead className="text-center">Pending</TableHead>
            <TableHead>% Complete</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id}>
              <TableCell>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: r.color || "#6B7280" }} />
                  <span className="font-medium">{r.code} - {r.name}</span>
                </div>
              </TableCell>
              <TableCell className="text-center font-semibold">{r.totalCount}</TableCell>
              <TableCell className="text-center text-emerald-600 font-medium">{r.filedCount}</TableCell>
              <TableCell className="text-center text-amber-600 font-medium">{r.inProgressCount}</TableCell>
              <TableCell className="text-center text-muted-foreground font-medium">{r.pendingCount}</TableCell>
              <TableCell>
                <div className="flex items-center gap-2">
                  <Progress value={r.pct} className="h-2 flex-1" />
                  <span className="text-sm font-medium text-foreground w-10 text-right">{r.pct}%</span>
                </div>
              </TableCell>
            </TableRow>
          ))}
          {rows.length === 0 && (
            <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">No work groups configured. Create groups in Settings.</TableCell></TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}

export default ItReturns;
