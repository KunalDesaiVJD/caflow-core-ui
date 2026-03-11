import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter,
} from "@/components/ui/sheet";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import {
  FileText, Plus, Download, Search, Filter, X, Eye,
  AlertTriangle, Clock, CheckCircle2, Scale, ChevronRight,
  CalendarDays, Sparkles, Copy, Send, Mail,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { format, differenceInDays, isBefore, addDays, parse } from "date-fns";

// ─── Constants ───
const ITR_FORMS = ["ITR-1", "ITR-2", "ITR-3", "ITR-4", "ITR-5", "ITR-6", "ITR-7"];
const FILING_STATUSES = ["Not Started", "Data Collection", "In Progress", "Ready for Review", "Pending Approval", "Filed", "Verified"];
const ASSESSMENT_YEARS = ["2026-27", "2025-26", "2024-25", "2023-24", "2022-23"];
const DEFAULT_AY = "2025-26";

const STATUS_COLORS: Record<string, string> = {
  "Not Started": "bg-muted text-muted-foreground",
  "Data Collection": "bg-blue-500/15 text-blue-600",
  "In Progress": "bg-amber-500/15 text-amber-600",
  "Ready for Review": "bg-purple-500/15 text-purple-600",
  "Pending Approval": "bg-orange-500/15 text-orange-600",
  "Filed": "bg-teal-500/15 text-teal-600",
  "Verified": "bg-emerald-500/15 text-emerald-600",
};

// ─── Notice Tracker Constants ───
const NOTICE_TYPES = [
  { value: "143_1", label: "143(1)" },
  { value: "148", label: "148" },
  { value: "139_9", label: "139(9)" },
  { value: "245", label: "245" },
  { value: "156", label: "156" },
  { value: "36B", label: "36B" },
  { value: "scrutiny", label: "Scrutiny Assessment" },
];

const NOTICE_STATUSES = [
  "Notice Received", "Under Review", "Reply Drafted", "Reply Filed",
  "Hearing Scheduled", "Order Received", "Closed/Appeal Filed",
] as const;

// ─── Types ───
interface ItrProfile {
  id: string;
  client_id: string | null;
  firm_id: string | null;
  financial_year: string | null;
  itr_form: string | null;
  filing_status: string | null;
  itr_work_group_id: string | null;
  assigned_to: string | null;
  date_data_received: string | null;
  date_filed: string | null;
  acknowledgment_no: string | null;
  assessment_year: string | null;
  // enriched
  client_name?: string;
  client_pan?: string;
  entity_type?: string;
  group_name?: string;
  assigned_name?: string;
  remarks?: string;
}

interface StaffUser { id: string; name: string | null; role: string | null; }

function formatDateDDMMYYYY(dateStr: string | null): string {
  if (!dateStr) return "";
  try {
    return format(new Date(dateStr), "dd/MM/yyyy");
  } catch { return dateStr; }
}

// ─── Main Component ───
const ItReturns = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isSuperadmin = user?.role === "superadmin";
  const firmId = user?.firm_id;

  const [activeTab, setActiveTab] = useState("filing");
  const [selectedAY, setSelectedAY] = useState(DEFAULT_AY);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterForm, setFilterForm] = useState("");
  const [filterStaff, setFilterStaff] = useState("");

  // ─── Fetch ITR-activated clients ───
  const { data: itrClientIds = [] } = useQuery({
    queryKey: ["itr_client_ids", firmId],
    queryFn: async () => {
      // Get service_category where linked_module = 'itr'
      const { data: cats } = await supabase
        .from("service_categories")
        .select("id")
        .eq("linked_module", "itr");
      if (!cats?.length) return [];
      const catIds = cats.map(c => c.id);
      // Get active client_services for those categories
      const { data: cs } = await supabase
        .from("client_services")
        .select("client_id")
        .in("service_category_id", catIds)
        .eq("is_active", true);
      return [...new Set((cs || []).map(c => c.client_id))];
    },
  });

  // ─── Fetch staff ───
  const { data: staffUsers = [] } = useQuery({
    queryKey: ["staff_users", firmId],
    queryFn: async () => {
      let q = supabase.from("users").select("id, name, role");
      if (!isSuperadmin && firmId) q = q.eq("firm_id", firmId);
      const { data } = await q;
      return (data || []) as StaffUser[];
    },
  });

  // ─── Fetch work groups ───
  const { data: workGroups = [] } = useQuery({
    queryKey: ["itr_work_groups", firmId],
    queryFn: async () => {
      let q = supabase.from("itr_work_groups").select("*");
      if (!isSuperadmin && firmId) q = q.eq("firm_id", firmId);
      const { data } = await q;
      return (data || []) as any[];
    },
  });

  // ─── Fetch profiles with enrichment ───
  const { data: profiles = [], isLoading } = useQuery({
    queryKey: ["itr_profiles", firmId, selectedAY, itrClientIds],
    queryFn: async () => {
      if (itrClientIds.length === 0) return [];
      let q = supabase.from("itr_profiles").select("*").eq("assessment_year", selectedAY);
      if (!isSuperadmin && firmId) q = q.eq("firm_id", firmId);
      q = q.in("client_id", itrClientIds);
      const { data: pData } = await q;

      // Fetch client details
      const { data: cData } = await supabase
        .from("clients")
        .select("id, name, pan, entity_type")
        .in("id", itrClientIds);
      const clientMap = new Map((cData || []).map(c => [c.id, c]));

      // Fetch users for assigned_to
      const { data: uData } = await supabase.from("users").select("id, name");
      const userMap = new Map((uData || []).map(u => [u.id, u.name]));

      // Work group map
      const wgMap = new Map(workGroups.map((g: any) => [g.id, g]));

      // For clients that have ITR service active but no profile for this AY, create placeholder
      const existingClientIds = new Set((pData || []).map(p => p.client_id));
      const enriched: ItrProfile[] = [];

      // Existing profiles
      for (const p of (pData || [])) {
        const cl = clientMap.get(p.client_id || "");
        const wg = wgMap.get(p.itr_work_group_id || "");
        enriched.push({
          ...p,
          client_name: cl?.name || "Unknown",
          client_pan: cl?.pan || "",
          entity_type: cl?.entity_type || "",
          group_name: (wg as any)?.name || "",
          assigned_name: userMap.get(p.assigned_to || "") || "",
        });
      }

      // Missing clients → auto-create profiles
      for (const cid of itrClientIds) {
        if (!existingClientIds.has(cid)) {
          const cl = clientMap.get(cid);
          if (!cl) continue;
          enriched.push({
            id: `new_${cid}`,
            client_id: cid,
            firm_id: firmId || null,
            financial_year: selectedAY.split("-").map((v, i) => i === 0 ? String(Number(v) - 1) : v).join("-"),
            itr_form: null,
            filing_status: "Not Started",
            itr_work_group_id: null,
            assigned_to: null,
            date_data_received: null,
            date_filed: null,
            acknowledgment_no: null,
            assessment_year: selectedAY,
            client_name: cl.name || "Unknown",
            client_pan: cl.pan || "",
            entity_type: cl.entity_type || "",
            group_name: "",
            assigned_name: "",
          });
        }
      }

      return enriched;
    },
    enabled: itrClientIds.length > 0,
  });

  // ─── Filtered profiles ───
  const filtered = useMemo(() => {
    return profiles.filter(p => {
      if (search && !(p.client_name || "").toLowerCase().includes(search.toLowerCase()) && !(p.client_pan || "").toLowerCase().includes(search.toLowerCase())) return false;
      if (filterStatus && (p.filing_status || "Not Started") !== filterStatus) return false;
      if (filterForm && p.itr_form !== filterForm) return false;
      if (filterStaff && p.assigned_to !== filterStaff) return false;
      return true;
    });
  }, [profiles, search, filterStatus, filterForm, filterStaff]);

  // ─── Status counts ───
  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    FILING_STATUSES.forEach(s => { counts[s] = 0; });
    profiles.forEach(p => { const s = p.filing_status || "Not Started"; counts[s] = (counts[s] || 0) + 1; });
    return counts;
  }, [profiles]);

  // ─── Inline update handler ───
  const handleInlineUpdate = async (profile: ItrProfile, field: string, value: any) => {
    const isNew = profile.id.startsWith("new_");
    try {
      if (isNew) {
        // Create the profile first
        const payload: any = {
          client_id: profile.client_id,
          firm_id: firmId,
          assessment_year: selectedAY,
          financial_year: profile.financial_year,
          filing_status: "Not Started",
          [field]: value || null,
        };
        const { error } = await supabase.from("itr_profiles").insert(payload);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("itr_profiles").update({ [field]: value || null } as any).eq("id", profile.id);
        if (error) throw error;
      }
      queryClient.invalidateQueries({ queryKey: ["itr_profiles"] });
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  };

  // ─── Export ───
  const handleExport = () => {
    import("xlsx").then(XLSX => {
      const rows = filtered.map(p => ({
        "Client Name": p.client_name,
        "PAN": p.client_pan,
        "Constitution": p.entity_type,
        "Work Group": p.group_name,
        "ITR Form": p.itr_form || "",
        "Status": p.filing_status || "Not Started",
        "Due Date": "",
        "Filed Date": formatDateDDMMYYYY(p.date_filed),
        "Ack No": p.acknowledgment_no || "",
        "Assigned To": p.assigned_name || "",
      }));
      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "ITR Filings");
      XLSX.writeFile(wb, `ITR_Filings_${selectedAY}_${format(new Date(), "yyyy-MM-dd")}.xlsx`);
    });
  };

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-display font-bold text-foreground">IT Returns</h1>
          <p className="text-muted-foreground text-sm">Income tax return filing, tracking & compliance</p>
        </div>
        <div className="flex items-center gap-3">
          <Select value={selectedAY} onValueChange={setSelectedAY}>
            <SelectTrigger className="w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ASSESSMENT_YEARS.map(ay => <SelectItem key={ay} value={ay}>AY {ay}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Tabs: Filing | Compliance */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="mb-4">
          <TabsTrigger value="filing" className="gap-1.5">
            <FileText size={14} /> Filing
          </TabsTrigger>
          <TabsTrigger value="compliance" className="gap-1.5">
            <AlertTriangle size={14} /> Compliance
          </TabsTrigger>
        </TabsList>

        <TabsContent value="filing">
          <FilingTab
            profiles={filtered}
            allProfiles={profiles}
            statusCounts={statusCounts}
            staffUsers={staffUsers}
            workGroups={workGroups}
            search={search}
            setSearch={setSearch}
            filterStatus={filterStatus}
            setFilterStatus={setFilterStatus}
            filterForm={filterForm}
            setFilterForm={setFilterForm}
            filterStaff={filterStaff}
            setFilterStaff={setFilterStaff}
            isLoading={isLoading}
            onInlineUpdate={handleInlineUpdate}
            onExport={handleExport}
            navigate={navigate}
            selectedAY={selectedAY}
          />
        </TabsContent>

        <TabsContent value="compliance">
          <ComplianceTab navigate={navigate} />
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default ItReturns;

// ─── Filing Tab ───
function FilingTab({
  profiles, allProfiles, statusCounts, staffUsers, workGroups,
  search, setSearch, filterStatus, setFilterStatus,
  filterForm, setFilterForm, filterStaff, setFilterStaff,
  isLoading, onInlineUpdate, onExport, navigate, selectedAY,
}: any) {
  return (
    <div className="space-y-4">
      {/* Status count strip */}
      <div className="flex flex-wrap gap-2">
        {FILING_STATUSES.map(s => (
          <Badge
            key={s}
            className={cn("cursor-pointer text-xs px-3 py-1", STATUS_COLORS[s], filterStatus === s && "ring-2 ring-primary")}
            onClick={() => setFilterStatus(filterStatus === s ? "" : s)}
          >
            {s}: {statusCounts[s] || 0}
          </Badge>
        ))}
        <Badge variant="outline" className="text-xs px-3 py-1">
          Total: {allProfiles.length}
        </Badge>
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search client or PAN..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9 h-9"
          />
        </div>
        <Select value={filterForm} onValueChange={v => setFilterForm(v === "all" ? "" : v)}>
          <SelectTrigger className="w-[120px] h-9 text-xs"><SelectValue placeholder="ITR Form" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Forms</SelectItem>
            {ITR_FORMS.map(f => <SelectItem key={f} value={f}>{f}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterStaff} onValueChange={v => setFilterStaff(v === "all" ? "" : v)}>
          <SelectTrigger className="w-[140px] h-9 text-xs"><SelectValue placeholder="Staff" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Staff</SelectItem>
            {staffUsers.map((u: StaffUser) => <SelectItem key={u.id} value={u.id}>{u.name || u.id}</SelectItem>)}
          </SelectContent>
        </Select>
        {(search || filterStatus || filterForm || filterStaff) && (
          <Button variant="ghost" size="sm" onClick={() => { setSearch(""); setFilterStatus(""); setFilterForm(""); setFilterStaff(""); }}>
            <X size={14} className="mr-1" /> Clear
          </Button>
        )}
        <div className="flex-1" />
        <Button variant="outline" size="sm" onClick={onExport}>
          <Download size={14} className="mr-1.5" /> Export
        </Button>
      </div>

      {/* Inline Editable Table */}
      {isLoading ? (
        <div className="space-y-2">{[1, 2, 3].map(i => <Skeleton key={i} className="h-12 w-full" />)}</div>
      ) : (
        <div className="border rounded-lg overflow-auto">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-background">
              <TableRow>
                <TableHead className="sticky left-0 z-20 bg-background min-w-[180px]">Client Name</TableHead>
                <TableHead className="min-w-[100px]">PAN</TableHead>
                <TableHead className="min-w-[100px]">Constitution</TableHead>
                <TableHead className="min-w-[120px]">Work Group</TableHead>
                <TableHead className="min-w-[100px]">ITR Form</TableHead>
                <TableHead className="min-w-[150px]">Status</TableHead>
                <TableHead className="min-w-[130px]">Filed Date</TableHead>
                <TableHead className="min-w-[140px]">Ack No</TableHead>
                <TableHead className="min-w-[140px]">Assigned Staff</TableHead>
                <TableHead className="min-w-[120px]">Remarks</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {profiles.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={10} className="text-center text-muted-foreground py-8">
                    {search || filterStatus || filterForm || filterStaff
                      ? "No matching profiles found."
                      : "No clients with ITR service activated. Activate 'Income Tax Returns' service on clients first."}
                  </TableCell>
                </TableRow>
              ) : profiles.map((p: ItrProfile) => (
                <InlineEditableRow
                  key={p.id}
                  profile={p}
                  staffUsers={staffUsers}
                  workGroups={workGroups}
                  onUpdate={onInlineUpdate}
                  navigate={navigate}
                />
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

// ─── Inline Editable Row ───
function InlineEditableRow({ profile, staffUsers, workGroups, onUpdate, navigate }: {
  profile: ItrProfile; staffUsers: StaffUser[]; workGroups: any[];
  onUpdate: (p: ItrProfile, field: string, value: any) => void;
  navigate: (path: string) => void;
}) {
  const p = profile;

  return (
    <TableRow className="hover:bg-muted/30">
      {/* Client Name - non-editable, clickable */}
      <TableCell className="sticky left-0 z-10 bg-background font-medium">
        <button
          className="text-left text-primary hover:underline truncate max-w-[170px] block"
          onClick={() => navigate(`/clients/${p.client_id}`)}
        >
          {p.client_name}
        </button>
      </TableCell>

      {/* PAN - non-editable */}
      <TableCell className="font-mono text-xs text-muted-foreground">{p.client_pan || "—"}</TableCell>

      {/* Constitution - non-editable */}
      <TableCell className="text-xs">{p.entity_type || "—"}</TableCell>

      {/* Work Group - dropdown */}
      <TableCell>
        <Select
          value={p.itr_work_group_id || "none"}
          onValueChange={v => onUpdate(p, "itr_work_group_id", v === "none" ? null : v)}
        >
          <SelectTrigger className="h-7 text-xs border-none shadow-none bg-transparent px-1">
            <SelectValue placeholder="—" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">—</SelectItem>
            {workGroups.map((g: any) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </TableCell>

      {/* ITR Form - dropdown */}
      <TableCell>
        <Select
          value={p.itr_form || "none"}
          onValueChange={v => onUpdate(p, "itr_form", v === "none" ? null : v)}
        >
          <SelectTrigger className="h-7 text-xs border-none shadow-none bg-transparent px-1">
            <SelectValue placeholder="—" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">—</SelectItem>
            {ITR_FORMS.map(f => <SelectItem key={f} value={f}>{f}</SelectItem>)}
          </SelectContent>
        </Select>
      </TableCell>

      {/* Status - color-coded dropdown */}
      <TableCell>
        <Select
          value={p.filing_status || "Not Started"}
          onValueChange={v => onUpdate(p, "filing_status", v)}
        >
          <SelectTrigger className={cn("h-7 text-xs border-none shadow-none px-1 rounded-full", STATUS_COLORS[p.filing_status || "Not Started"])}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FILING_STATUSES.map(s => (
              <SelectItem key={s} value={s}>
                <span className={cn("inline-block w-2 h-2 rounded-full mr-1.5", STATUS_COLORS[s].split(" ")[0])} />
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </TableCell>

      {/* Filed Date - date picker */}
      <TableCell>
        <InlineDatePicker
          value={p.date_filed}
          onChange={v => onUpdate(p, "date_filed", v)}
        />
      </TableCell>

      {/* Ack No - text */}
      <TableCell>
        <InlineTextInput
          value={p.acknowledgment_no || ""}
          placeholder="—"
          onSave={v => onUpdate(p, "acknowledgment_no", v)}
        />
      </TableCell>

      {/* Assigned Staff - dropdown */}
      <TableCell>
        <Select
          value={p.assigned_to || "none"}
          onValueChange={v => onUpdate(p, "assigned_to", v === "none" ? null : v)}
        >
          <SelectTrigger className="h-7 text-xs border-none shadow-none bg-transparent px-1">
            <SelectValue placeholder="—" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">—</SelectItem>
            {staffUsers.map((u: StaffUser) => <SelectItem key={u.id} value={u.id}>{u.name || u.id}</SelectItem>)}
          </SelectContent>
        </Select>
      </TableCell>

      {/* Remarks - inline text */}
      <TableCell>
        <InlineTextInput
          value={(p as any).remarks || ""}
          placeholder="—"
          onSave={v => {/* remarks not in schema yet - could use acknowledgment or a JSONB field */}}
        />
      </TableCell>
    </TableRow>
  );
}

// ─── Inline Text Input ───
function InlineTextInput({ value, placeholder, onSave }: { value: string; placeholder: string; onSave: (v: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(value);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => { setVal(value); }, [value]);
  useEffect(() => { if (editing) ref.current?.focus(); }, [editing]);

  if (!editing) {
    return (
      <button
        className="text-xs text-left w-full truncate text-muted-foreground hover:text-foreground"
        onClick={() => setEditing(true)}
      >
        {value || placeholder}
      </button>
    );
  }

  return (
    <Input
      ref={ref}
      value={val}
      onChange={e => setVal(e.target.value)}
      onBlur={() => { setEditing(false); if (val !== value) onSave(val); }}
      onKeyDown={e => { if (e.key === "Enter") { setEditing(false); if (val !== value) onSave(val); } if (e.key === "Escape") { setEditing(false); setVal(value); } }}
      className="h-7 text-xs border-none shadow-none bg-transparent px-1"
    />
  );
}

// ─── Inline Date Picker ───
function InlineDatePicker({ value, onChange }: { value: string | null; onChange: (v: string | null) => void }) {
  const [open, setOpen] = useState(false);
  const date = value ? new Date(value) : undefined;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className="text-xs text-left w-full truncate text-muted-foreground hover:text-foreground flex items-center gap-1">
          <CalendarDays size={12} />
          {value ? formatDateDDMMYYYY(value) : "—"}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={date}
          onSelect={d => {
            onChange(d ? format(d, "yyyy-MM-dd") : null);
            setOpen(false);
          }}
          className="p-3 pointer-events-auto"
        />
      </PopoverContent>
    </Popover>
  );
}

// ═══════════════════════════════════════════
// COMPLIANCE TAB (merged Notice Tracker)
// ═══════════════════════════════════════════
function ComplianceTab({ navigate }: { navigate: (path: string) => void }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [filters, setFilters] = useState({ type: "all", status: "all", client: "all", search: "" });
  const [statusDialogNotice, setStatusDialogNotice] = useState<any>(null);
  const [changeNote, setChangeNote] = useState("");

  const [form, setForm] = useState({
    client_id: "", notice_type: "143_1",
    notice_ref_no: "", assessment_year: "", section: "", department: "",
    notice_date: "", date_received: "", amount_demanded: "", amount_disputed: "",
    reply_due_date: "", assigned_to: "", priority: "Medium", remarks: "",
  });

  const { data: notices = [], isLoading } = useQuery({
    queryKey: ["compliance_notices"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("demand_notices")
        .select("*, clients(name, pan), users!demand_notices_assigned_to_fkey(name)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  const { data: clients = [] } = useQuery({
    queryKey: ["compliance_clients"],
    queryFn: async () => {
      const { data } = await supabase.from("clients").select("id, name").order("name");
      return data || [];
    },
  });

  const { data: staff = [] } = useQuery({
    queryKey: ["compliance_staff"],
    queryFn: async () => {
      const { data } = await supabase.from("users").select("id, name").order("name");
      return data || [];
    },
  });

  const createMutation = useMutation({
    mutationFn: async (values: typeof form) => {
      const { error } = await supabase.from("demand_notices").insert({
        client_id: values.client_id,
        firm_id: user?.firm_id,
        notice_type: values.notice_type,
        notice_ref_no: values.notice_ref_no || null,
        assessment_year: values.assessment_year || null,
        section: values.section || null,
        department: values.department || null,
        notice_date: values.notice_date || null,
        date_received: values.date_received || null,
        amount_demanded: values.amount_demanded ? parseFloat(values.amount_demanded) : null,
        amount_disputed: values.amount_disputed ? parseFloat(values.amount_disputed) : null,
        reply_due_date: values.reply_due_date || null,
        assigned_to: values.assigned_to || null,
        priority: values.priority,
        remarks: values.remarks || null,
        created_by: user?.id,
        status: "Received",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["compliance_notices"] });
      setAddOpen(false);
      setForm({ client_id: "", notice_type: "143_1", notice_ref_no: "", assessment_year: "", section: "", department: "", notice_date: "", date_received: "", amount_demanded: "", amount_disputed: "", reply_due_date: "", assigned_to: "", priority: "Medium", remarks: "" });
      toast({ title: "Notice added" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const statusMutation = useMutation({
    mutationFn: async ({ noticeId, currentStatus, nextStatus }: { noticeId: string; currentStatus: string; nextStatus: string }) => {
      const { error } = await supabase.from("demand_notices").update({ status: nextStatus }).eq("id", noticeId);
      if (error) throw error;
      if (changeNote.trim()) {
        await supabase.from("demand_notice_status_history").insert({
          notice_id: noticeId, from_status: currentStatus, to_status: nextStatus,
          changed_by: user?.id, change_note: changeNote.trim(),
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["compliance_notices"] });
      setStatusDialogNotice(null);
      setChangeNote("");
      toast({ title: "Status updated" });
    },
  });

  const filtered = useMemo(() => {
    return notices.filter((n: any) => {
      if (filters.type !== "all" && n.notice_type !== filters.type) return false;
      if (filters.status !== "all" && n.status !== filters.status) return false;
      if (filters.client !== "all" && n.client_id !== filters.client) return false;
      if (filters.search && !(n.clients?.name || "").toLowerCase().includes(filters.search.toLowerCase())) return false;
      return true;
    });
  }, [notices, filters]);

  // Demand reconciliation
  const demandStats = useMemo(() => {
    const total = notices.reduce((s: number, n: any) => s + (Number(n.amount_demanded) || 0), 0);
    const disputed = notices.reduce((s: number, n: any) => s + (Number(n.amount_disputed) || 0), 0);
    const outstanding = total - disputed;
    return { total, disputed, outstanding };
  }, [notices]);

  // Stats
  const openCount = notices.filter((n: any) => n.status !== "Closed/Appeal Filed" && n.status !== "Closed/Dropped").length;
  const overdueCount = notices.filter((n: any) => {
    const d = n.extended_due_date || n.reply_due_date;
    return d && isBefore(new Date(d), new Date()) && n.status !== "Closed/Appeal Filed" && n.status !== "Closed/Dropped";
  }).length;

  const handleExport = () => {
    import("xlsx").then(XLSX => {
      const rows = filtered.map((n: any) => ({
        "Client": n.clients?.name || "-",
        "PAN": n.clients?.pan || "-",
        "Notice Type": n.notice_type,
        "Notice Date": n.notice_date || "",
        "Reply Deadline": n.reply_due_date || "",
        "Status": n.status,
        "Demand Amount": n.amount_demanded ?? "",
        "Disputed": n.amount_disputed ?? "",
      }));
      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Compliance");
      XLSX.writeFile(wb, `Compliance_Notices_${format(new Date(), "yyyy-MM-dd")}.xlsx`);
    });
  };

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card><CardContent className="pt-4"><p className="text-sm text-muted-foreground">Open Notices</p><p className="text-2xl font-bold text-foreground">{openCount}</p></CardContent></Card>
        <Card><CardContent className="pt-4"><p className="text-sm text-muted-foreground">Overdue</p><p className="text-2xl font-bold text-destructive">{overdueCount}</p></CardContent></Card>
        <Card><CardContent className="pt-4"><p className="text-sm text-muted-foreground">Total Demand</p><p className="text-2xl font-bold text-foreground">₹{demandStats.total.toLocaleString("en-IN")}</p></CardContent></Card>
        <Card><CardContent className="pt-4"><p className="text-sm text-muted-foreground">Outstanding</p><p className="text-2xl font-bold text-amber-600">₹{demandStats.outstanding.toLocaleString("en-IN")}</p></CardContent></Card>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap gap-3 items-end">
        <div className="flex-1 min-w-[200px] max-w-sm">
          <Input placeholder="Search client..." value={filters.search} onChange={e => setFilters(p => ({ ...p, search: e.target.value }))} className="h-9" />
        </div>
        <Select value={filters.type} onValueChange={v => setFilters(p => ({ ...p, type: v }))}>
          <SelectTrigger className="w-[140px] h-9 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            {NOTICE_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filters.status} onValueChange={v => setFilters(p => ({ ...p, status: v }))}>
          <SelectTrigger className="w-[160px] h-9 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            {NOTICE_STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
        <div className="flex-1" />
        <Button variant="outline" size="sm" onClick={handleExport}>
          <Download size={14} className="mr-1.5" /> Export
        </Button>
        <Sheet open={addOpen} onOpenChange={setAddOpen}>
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <Plus size={14} className="mr-1.5" /> Add Notice
          </Button>
          <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
            <SheetHeader><SheetTitle>Add New Notice</SheetTitle></SheetHeader>
            <div className="space-y-4 mt-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Client *</Label>
                  <Select value={form.client_id} onValueChange={v => setForm(p => ({ ...p, client_id: v }))}>
                    <SelectTrigger><SelectValue placeholder="Select client" /></SelectTrigger>
                    <SelectContent>
                      {clients.map((c: any) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Notice Type</Label>
                  <Select value={form.notice_type} onValueChange={v => setForm(p => ({ ...p, notice_type: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {NOTICE_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Notice Ref No</Label><Input value={form.notice_ref_no} onChange={e => setForm(p => ({ ...p, notice_ref_no: e.target.value }))} /></div>
                <div><Label>Assessment Year</Label><Input placeholder="2024-25" value={form.assessment_year} onChange={e => setForm(p => ({ ...p, assessment_year: e.target.value }))} /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Section</Label><Input value={form.section} onChange={e => setForm(p => ({ ...p, section: e.target.value }))} /></div>
                <div><Label>Department</Label><Input value={form.department} onChange={e => setForm(p => ({ ...p, department: e.target.value }))} /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Notice Date</Label><Input type="date" value={form.notice_date} onChange={e => setForm(p => ({ ...p, notice_date: e.target.value }))} /></div>
                <div><Label>Date Received</Label><Input type="date" value={form.date_received} onChange={e => setForm(p => ({ ...p, date_received: e.target.value }))} /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Demand Amount</Label><Input type="number" value={form.amount_demanded} onChange={e => setForm(p => ({ ...p, amount_demanded: e.target.value }))} /></div>
                <div><Label>Disputed Amount</Label><Input type="number" value={form.amount_disputed} onChange={e => setForm(p => ({ ...p, amount_disputed: e.target.value }))} /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Reply Due Date</Label><Input type="date" value={form.reply_due_date} onChange={e => setForm(p => ({ ...p, reply_due_date: e.target.value }))} /></div>
                <div>
                  <Label>Assigned To</Label>
                  <Select value={form.assigned_to} onValueChange={v => setForm(p => ({ ...p, assigned_to: v }))}>
                    <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                    <SelectContent>{staff.map((s: any) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
              <div><Label>Remarks</Label><Textarea value={form.remarks} onChange={e => setForm(p => ({ ...p, remarks: e.target.value }))} rows={3} /></div>
              <Button className="w-full" disabled={!form.client_id || createMutation.isPending} onClick={() => createMutation.mutate(form)}>
                {createMutation.isPending ? "Saving..." : "Save Notice"}
              </Button>
            </div>
          </SheetContent>
        </Sheet>
      </div>

      {/* Table */}
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Client</TableHead>
              <TableHead>PAN</TableHead>
              <TableHead>Notice Type</TableHead>
              <TableHead>Notice Date</TableHead>
              <TableHead>Reply Deadline</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Days Remaining</TableHead>
              <TableHead className="text-right">Demand</TableHead>
              <TableHead className="text-right">Disputed</TableHead>
              <TableHead className="w-[100px]">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={10} className="text-center py-8 text-muted-foreground">Loading...</TableCell></TableRow>
            ) : filtered.length === 0 ? (
              <TableRow><TableCell colSpan={10} className="text-center py-8 text-muted-foreground">No notices found</TableCell></TableRow>
            ) : filtered.map((n: any) => {
              const dueDate = n.extended_due_date || n.reply_due_date;
              const daysRemaining = dueDate ? differenceInDays(new Date(dueDate), new Date()) : null;
              const daysColor = daysRemaining === null ? "" : daysRemaining < 0 ? "text-destructive font-bold" : daysRemaining <= 3 ? "text-destructive" : daysRemaining <= 7 ? "text-amber-600" : "text-emerald-600";

              const currentIdx = [...NOTICE_STATUSES, "Received", "Awaiting Order", "Closed/Dropped"].indexOf(n.status);
              const mappedIdx = NOTICE_STATUSES.indexOf(n.status as any);
              const nextStatus = mappedIdx >= 0 && mappedIdx < NOTICE_STATUSES.length - 1 ? NOTICE_STATUSES[mappedIdx + 1] : null;

              return (
                <TableRow key={n.id} className="hover:bg-muted/50">
                  <TableCell className="font-medium">{n.clients?.name || "—"}</TableCell>
                  <TableCell className="font-mono text-xs">{n.clients?.pan || "—"}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-[10px]">
                      {NOTICE_TYPES.find(t => t.value === n.notice_type)?.label || n.notice_type}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs">{n.notice_date ? formatDateDDMMYYYY(n.notice_date) : "—"}</TableCell>
                  <TableCell className="text-xs">{dueDate ? formatDateDDMMYYYY(dueDate) : "—"}</TableCell>
                  <TableCell><Badge variant="outline" className="text-[10px]">{n.status}</Badge></TableCell>
                  <TableCell className={cn("text-xs font-medium", daysColor)}>
                    {daysRemaining !== null ? (daysRemaining < 0 ? `${Math.abs(daysRemaining)}d overdue` : `${daysRemaining}d`) : "—"}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    {n.amount_demanded != null ? `₹${Number(n.amount_demanded).toLocaleString("en-IN")}` : "—"}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    {n.amount_disputed != null ? `₹${Number(n.amount_disputed).toLocaleString("en-IN")}` : "—"}
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => navigate(`/notices/${n.id}`)}>
                        <Eye size={14} />
                      </Button>
                      {nextStatus && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          title={`Move to: ${nextStatus}`}
                          onClick={() => setStatusDialogNotice(n)}
                        >
                          <ChevronRight size={14} />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>

      {/* Demand Reconciliation Panel */}
      <Card>
        <CardHeader><CardTitle className="text-sm">Demand Reconciliation</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <p className="text-xs text-muted-foreground">Total Demand</p>
              <p className="text-lg font-bold font-mono">₹{demandStats.total.toLocaleString("en-IN")}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Disputed Amount</p>
              <p className="text-lg font-bold font-mono text-amber-600">₹{demandStats.disputed.toLocaleString("en-IN")}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Outstanding Balance</p>
              <p className="text-lg font-bold font-mono text-destructive">₹{demandStats.outstanding.toLocaleString("en-IN")}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Status Change Dialog */}
      {statusDialogNotice && (() => {
        const mappedIdx = NOTICE_STATUSES.indexOf(statusDialogNotice.status as any);
        const nextStatus = mappedIdx >= 0 && mappedIdx < NOTICE_STATUSES.length - 1 ? NOTICE_STATUSES[mappedIdx + 1] : null;
        if (!nextStatus) return null;
        return (
          <Dialog open={!!statusDialogNotice} onOpenChange={open => { if (!open) setStatusDialogNotice(null); }}>
            <DialogContent>
              <DialogHeader><DialogTitle>Move to "{nextStatus}"</DialogTitle></DialogHeader>
              <div>
                <Label>Note (optional)</Label>
                <Textarea value={changeNote} onChange={e => setChangeNote(e.target.value)} rows={3} placeholder="Reason..." />
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setStatusDialogNotice(null)}>Cancel</Button>
                <Button
                  onClick={() => statusMutation.mutate({ noticeId: statusDialogNotice.id, currentStatus: statusDialogNotice.status, nextStatus })}
                  disabled={statusMutation.isPending}
                >
                  {statusMutation.isPending ? "Updating..." : "Confirm"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        );
      })()}
    </div>
  );
}
