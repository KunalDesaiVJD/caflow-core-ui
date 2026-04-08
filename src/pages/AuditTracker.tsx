/**
 * AuditTracker — Audit Planning & Status Tracker
 *
 * Tab 1 "Planning Board": Month/Year selector, Gantt timeline, communication log
 * Tab 2 "Audit Status":   Combined TAOTA + Pvt Ltd grid with UDIN, fees, status
 */
import { useState, useEffect, useCallback } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  CalendarDays, ClipboardCheck, Plus, Save, Loader2,
  Phone, Mail, MessageSquare, ChevronLeft, ChevronRight,
  Search, RefreshCw, Edit2, Check, X,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

interface PlanningEntry {
  id: string;
  client_id: string | null;
  engagement_id: string | null;
  financial_year: string | null;
  audit_type: string | null;
  audit_firm_id: string | null;
  partner_id: string | null;
  manager_id: string | null;
  planned_start: string | null;
  planned_end: string | null;
  actual_start: string | null;
  actual_end: string | null;
  status: string;
  notes: string | null;
  client_name?: string;
  partner_name?: string;
  audit_firm_name?: string;
}

interface CommEntry {
  id: string;
  planning_id: string | null;
  client_id: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  communication_date: string;
  communication_type: string;
  subject: string | null;
  notes: string | null;
  follow_up_date: string | null;
}

interface StatusRow {
  engagement_id: string;
  client_name: string;
  entity_type: string | null;
  financial_year: string | null;
  audit_type: string | null;
  partner_name?: string;
  // from audit_status (may be null if not yet created)
  status_id: string | null;
  fees_quoted: number | null;
  fees_received: number | null;
  udin_tax: string | null;
  udin_statutory: string | null;
  tracker_status: string;
  remarks: string | null;
}

interface ClientOption { id: string; name: string; }
interface UserOption   { id: string; name: string; }
interface AuditFirmOption { id: string; name: string; partner_name: string | null; }

// ─── Constants ────────────────────────────────────────────────────────────────

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

const AUDIT_TYPES = [
  { value: "tax_audit",  label: "Tax Audit" },
  { value: "statutory",  label: "Statutory" },
  { value: "both",       label: "Both" },
  { value: "internal",   label: "Internal" },
  { value: "stock",      label: "Stock" },
];

const PLAN_STATUSES = ["planned","in_progress","completed","delayed","cancelled"];

const TRACKER_STATUSES = [
  { value: "not_started", label: "Not Started",  color: "bg-gray-100 text-gray-700" },
  { value: "in_progress", label: "In Progress",  color: "bg-blue-100 text-blue-700" },
  { value: "review",      label: "Review",       color: "bg-yellow-100 text-yellow-700" },
  { value: "completed",   label: "Completed",    color: "bg-green-100 text-green-700" },
  { value: "signed",      label: "Signed",       color: "bg-violet-100 text-violet-700" },
];

const COMM_TYPES = ["call","email","meeting","letter","whatsapp"];

const CURRENT_FY = (() => {
  const now = new Date();
  const y = now.getFullYear();
  return now.getMonth() >= 3 ? `${y}-${y+1}` : `${y-1}-${y}`;
})();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function planStatusBadge(status: string) {
  const map: Record<string, string> = {
    planned:     "bg-blue-100 text-blue-700",
    in_progress: "bg-yellow-100 text-yellow-700",
    completed:   "bg-green-100 text-green-700",
    delayed:     "bg-red-100 text-red-700",
    cancelled:   "bg-gray-100 text-gray-500",
  };
  return map[status] || "bg-gray-100 text-gray-600";
}

function commTypeIcon(t: string) {
  if (t === "call" || t === "whatsapp") return <Phone size={11} />;
  if (t === "email") return <Mail size={11} />;
  return <MessageSquare size={11} />;
}

function isCompany(entity_type: string | null) {
  return entity_type === "private_limited" || entity_type === "public_limited";
}

// ─── Blank form states ────────────────────────────────────────────────────────

const BLANK_PLAN = {
  client_id: "", financial_year: CURRENT_FY, audit_type: "tax_audit",
  audit_firm_id: "", partner_id: "", manager_id: "",
  planned_start: "", planned_end: "", actual_start: "", actual_end: "",
  status: "planned", notes: "",
};

const BLANK_COMM = {
  client_id: "", contact_name: "", contact_phone: "", contact_email: "",
  communication_date: new Date().toISOString().slice(0, 10),
  communication_type: "call", subject: "", notes: "", follow_up_date: "",
};

// ─── Gantt bar ────────────────────────────────────────────────────────────────

function GanttBar({ entry, year, month }: { entry: PlanningEntry; year: number; month: number }) {
  if (!entry.planned_start && !entry.actual_start) return null;
  const start = entry.actual_start || entry.planned_start!;
  const end   = entry.actual_end   || entry.planned_end   || start;

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const startDate = new Date(start);
  const endDate   = new Date(end);
  const monthStart = new Date(year, month, 1);
  const monthEnd   = new Date(year, month, daysInMonth);

  const clampedStart = startDate < monthStart ? monthStart : startDate;
  const clampedEnd   = endDate   > monthEnd   ? monthEnd   : endDate;

  if (clampedStart > clampedEnd) return null;

  const left = ((clampedStart.getDate() - 1) / daysInMonth) * 100;
  const width = ((clampedEnd.getDate() - clampedStart.getDate() + 1) / daysInMonth) * 100;

  const colorMap: Record<string, string> = {
    planned:     "bg-blue-400",
    in_progress: "bg-yellow-400",
    completed:   "bg-green-400",
    delayed:     "bg-red-400",
    cancelled:   "bg-gray-300",
  };

  return (
    <div
      className={cn(
        "absolute top-1/2 -translate-y-1/2 h-4 rounded-full opacity-80",
        colorMap[entry.status] || "bg-blue-400"
      )}
      style={{ left: `${left}%`, width: `${Math.max(width, 2)}%` }}
      title={`${entry.client_name || "—"} | ${entry.planned_start} → ${entry.planned_end}`}
    />
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// PLANNING BOARD TAB
// ═══════════════════════════════════════════════════════════════════════════════

function PlanningBoard({ firmId }: { firmId: string }) {
  const now = new Date();
  const [year,  setYear]  = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());

  const [plans, setPlans]         = useState<PlanningEntry[]>([]);
  const [comms, setComms]         = useState<CommEntry[]>([]);
  const [selected, setSelected]   = useState<PlanningEntry | null>(null);
  const [loading, setLoading]     = useState(true);

  // Options
  const [clients,    setClients]    = useState<ClientOption[]>([]);
  const [users,      setUsers]      = useState<UserOption[]>([]);
  const [auditFirms, setAuditFirms] = useState<AuditFirmOption[]>([]);

  // Modals
  const [planModal, setPlanModal] = useState(false);
  const [commModal, setCommModal] = useState(false);
  const [planForm,  setPlanForm]  = useState({ ...BLANK_PLAN });
  const [commForm,  setCommForm]  = useState({ ...BLANK_COMM });
  const [saving,    setSaving]    = useState(false);

  const loadOptions = useCallback(async () => {
    const [{ data: c }, { data: u }, { data: af }] = await Promise.all([
      supabase.from("clients").select("id, name").eq("firm_id", firmId).is("deleted_at", null).order("name"),
      supabase.from("users").select("id, name").eq("firm_id", firmId).eq("is_active", true).order("name"),
      supabase.from("audit_firms").select("id, name, partner_name").eq("firm_id", firmId).order("name"),
    ]);
    setClients(c || []);
    setUsers(u || []);
    setAuditFirms(af || []);
  }, [firmId]);

  const loadData = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("audit_planning")
      .select("*")
      .eq("firm_id", firmId)
      .order("planned_start", { ascending: true });

    if (data) {
      // enrich with client names
      const enriched: PlanningEntry[] = data.map((p: any) => ({
        ...p,
        client_name: clients.find(c => c.id === p.client_id)?.name || "—",
        audit_firm_name: auditFirms.find(af => af.id === p.audit_firm_id)?.name || "—",
        partner_name: users.find(u => u.id === p.partner_id)?.name || "—",
      }));
      setPlans(enriched);
      if (selected) {
        const updated = enriched.find(p => p.id === selected.id);
        if (updated) setSelected(updated);
      }
    }
    setLoading(false);
  }, [firmId, clients, auditFirms, users, selected]);

  const loadComms = useCallback(async (planningId: string) => {
    const { data } = await supabase
      .from("audit_communication")
      .select("*")
      .eq("planning_id", planningId)
      .order("communication_date", { ascending: false });
    setComms(data || []);
  }, []);

  useEffect(() => { loadOptions(); }, [loadOptions]);
  useEffect(() => { if (clients.length || !loading) loadData(); }, [clients.length, firmId]); // eslint-disable-line
  useEffect(() => { if (selected) loadComms(selected.id); else setComms([]); }, [selected, loadComms]);

  // filter plans visible in the current month
  const visiblePlans = plans.filter(p => {
    const s = p.planned_start || p.actual_start;
    const e = p.planned_end   || p.actual_end || s;
    if (!s) return false;
    const monthStart = new Date(year, month, 1);
    const monthEnd   = new Date(year, month + 1, 0);
    return new Date(s) <= monthEnd && new Date(e) >= monthStart;
  });

  async function savePlan() {
    setSaving(true);
    const payload: any = {
      firm_id: firmId,
      client_id:      planForm.client_id      || null,
      financial_year: planForm.financial_year || null,
      audit_type:     planForm.audit_type     || null,
      audit_firm_id:  planForm.audit_firm_id  || null,
      partner_id:     planForm.partner_id     || null,
      manager_id:     planForm.manager_id     || null,
      planned_start:  planForm.planned_start  || null,
      planned_end:    planForm.planned_end    || null,
      actual_start:   planForm.actual_start   || null,
      actual_end:     planForm.actual_end     || null,
      status:         planForm.status,
      notes:          planForm.notes          || null,
    };
    const { error } = await supabase.from("audit_planning").insert(payload);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Planning entry added");
    setPlanModal(false);
    setPlanForm({ ...BLANK_PLAN });
    loadData();
  }

  async function saveComm() {
    if (!selected) return;
    setSaving(true);
    const payload: any = {
      firm_id:            firmId,
      planning_id:        selected.id,
      client_id:          commForm.client_id         || selected.client_id,
      contact_name:       commForm.contact_name      || null,
      contact_phone:      commForm.contact_phone     || null,
      contact_email:      commForm.contact_email     || null,
      communication_date: commForm.communication_date,
      communication_type: commForm.communication_type,
      subject:            commForm.subject           || null,
      notes:              commForm.notes             || null,
      follow_up_date:     commForm.follow_up_date    || null,
    };
    const { error } = await supabase.from("audit_communication").insert(payload);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Communication logged");
    setCommModal(false);
    setCommForm({ ...BLANK_COMM });
    loadComms(selected.id);
  }

  // auto-populate partner when audit firm selected
  function onAuditFirmChange(afId: string) {
    const af = auditFirms.find(a => a.id === afId);
    const partnerId = af?.partner_name
      ? (users.find(u => u.name === af.partner_name)?.id || "")
      : "";
    setPlanForm(f => ({ ...f, audit_firm_id: afId, partner_id: partnerId }));
  }

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const dayLabels = Array.from({ length: daysInMonth }, (_, i) => i + 1);

  return (
    <div className="space-y-4">
      {/* Month navigator */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" className="h-8 w-8 p-0"
            onClick={() => { if (month === 0) { setMonth(11); setYear(y => y-1); } else setMonth(m => m-1); }}>
            <ChevronLeft size={14} />
          </Button>
          <span className="text-sm font-semibold min-w-[120px] text-center">
            {MONTHS[month]} {year}
          </span>
          <Button size="sm" variant="outline" className="h-8 w-8 p-0"
            onClick={() => { if (month === 11) { setMonth(0); setYear(y => y+1); } else setMonth(m => m+1); }}>
            <ChevronRight size={14} />
          </Button>
        </div>
        <Button size="sm" className="gap-1.5 h-8 text-xs bg-indigo-600 hover:bg-indigo-700"
          onClick={() => { setPlanForm({ ...BLANK_PLAN }); setPlanModal(true); }}>
          <Plus size={12} /> Add Plan
        </Button>
      </div>

      {loading ? (
        <div className="space-y-2">{Array.from({length:3}).map((_,i) => <Skeleton key={i} className="h-10 w-full"/>)}</div>
      ) : (
        <>
          {/* Gantt table */}
          <div className="border rounded-lg overflow-hidden">
            <div className="overflow-auto">
              <table className="w-full text-xs border-collapse" style={{ minWidth: 900 }}>
                <thead>
                  <tr className="bg-indigo-700 text-white">
                    <th className="px-3 py-2 text-left w-48 border-r border-indigo-600">Client</th>
                    <th className="px-2 py-2 text-left w-28 border-r border-indigo-600">Type</th>
                    <th className="px-2 py-2 text-left w-24 border-r border-indigo-600">Status</th>
                    <th className="px-2 py-2 text-left border-r border-indigo-600" colSpan={daysInMonth}>
                      {MONTHS[month]} {year}
                    </th>
                  </tr>
                  <tr className="bg-indigo-50 text-indigo-800 text-[10px]">
                    <th className="border-r border-border px-3 py-1" />
                    <th className="border-r border-border px-2 py-1" />
                    <th className="border-r border-border px-2 py-1" />
                    {dayLabels.map(d => (
                      <th key={d} className="border-r border-border px-0 py-1 text-center font-normal w-6">
                        {d}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visiblePlans.length === 0 ? (
                    <tr><td colSpan={daysInMonth + 3} className="py-10 text-center text-muted-foreground text-sm">
                      No planned audits in {MONTHS[month]} {year}
                    </td></tr>
                  ) : visiblePlans.map(p => (
                    <tr key={p.id}
                      className={cn("cursor-pointer hover:bg-muted/30 transition-colors", selected?.id === p.id && "bg-indigo-50/70")}
                      onClick={() => setSelected(sel => sel?.id === p.id ? null : p)}>
                      <td className="border-r border-border px-3 py-2 font-medium truncate max-w-[180px]">{p.client_name}</td>
                      <td className="border-r border-border px-2 py-2 capitalize text-muted-foreground">{p.audit_type?.replace("_"," ")}</td>
                      <td className="border-r border-border px-2 py-2">
                        <Badge className={cn("text-[10px] px-1.5 py-0.5", planStatusBadge(p.status))}>
                          {p.status.replace("_"," ")}
                        </Badge>
                      </td>
                      <td colSpan={daysInMonth} className="relative border-border px-0">
                        <GanttBar entry={p} year={year} month={month} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Communication panel */}
          {selected && (
            <div className="border rounded-lg overflow-hidden">
              <div className="bg-indigo-600 text-white px-4 py-2.5 flex items-center justify-between">
                <span className="text-sm font-semibold">
                  Communication Log — {selected.client_name}
                </span>
                <Button size="sm" variant="outline"
                  className="h-7 text-xs border-white/40 text-white hover:bg-white/10 gap-1"
                  onClick={() => { setCommForm({ ...BLANK_COMM }); setCommModal(true); }}>
                  <Plus size={11} /> Log
                </Button>
              </div>
              {comms.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">No communications logged yet</p>
              ) : (
                <div className="divide-y">
                  {comms.map(c => (
                    <div key={c.id} className="px-4 py-2.5 flex items-start gap-3">
                      <div className="mt-0.5 text-muted-foreground">{commTypeIcon(c.communication_type)}</div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-medium">{c.subject || "—"}</span>
                          <Badge className="text-[10px] px-1.5 bg-indigo-100 text-indigo-700 capitalize">
                            {c.communication_type}
                          </Badge>
                          <span className="text-[10px] text-muted-foreground ml-auto">{c.communication_date}</span>
                        </div>
                        {c.notes && <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">{c.notes}</p>}
                        {c.contact_name && <p className="text-[10px] text-muted-foreground mt-0.5">Contact: {c.contact_name}</p>}
                        {c.follow_up_date && <p className="text-[10px] text-amber-600 mt-0.5">Follow-up: {c.follow_up_date}</p>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* Add Plan Modal */}
      <Dialog open={planModal} onOpenChange={setPlanModal}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Add Audit Plan</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3 py-2">
            <div className="col-span-2">
              <Label className="text-xs">Client</Label>
              <Select value={planForm.client_id} onValueChange={v => setPlanForm(f=>({...f,client_id:v}))}>
                <SelectTrigger className="h-8 text-xs mt-1"><SelectValue placeholder="Select client…"/></SelectTrigger>
                <SelectContent>{clients.map(c=><SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Financial Year</Label>
              <Input className="h-8 text-xs mt-1" value={planForm.financial_year}
                onChange={e=>setPlanForm(f=>({...f,financial_year:e.target.value}))} placeholder="2025-2026"/>
            </div>
            <div>
              <Label className="text-xs">Audit Type</Label>
              <Select value={planForm.audit_type} onValueChange={v=>setPlanForm(f=>({...f,audit_type:v}))}>
                <SelectTrigger className="h-8 text-xs mt-1"><SelectValue/></SelectTrigger>
                <SelectContent>{AUDIT_TYPES.map(t=><SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Audit Firm</Label>
              <Select value={planForm.audit_firm_id} onValueChange={onAuditFirmChange}>
                <SelectTrigger className="h-8 text-xs mt-1"><SelectValue placeholder="Select…"/></SelectTrigger>
                <SelectContent>{auditFirms.map(a=><SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Partner</Label>
              <Select value={planForm.partner_id} onValueChange={v=>setPlanForm(f=>({...f,partner_id:v}))}>
                <SelectTrigger className="h-8 text-xs mt-1"><SelectValue placeholder="Select…"/></SelectTrigger>
                <SelectContent>{users.map(u=><SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Manager</Label>
              <Select value={planForm.manager_id} onValueChange={v=>setPlanForm(f=>({...f,manager_id:v}))}>
                <SelectTrigger className="h-8 text-xs mt-1"><SelectValue placeholder="Select…"/></SelectTrigger>
                <SelectContent>{users.map(u=><SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Planned Start</Label>
              <Input type="date" className="h-8 text-xs mt-1" value={planForm.planned_start}
                onChange={e=>setPlanForm(f=>({...f,planned_start:e.target.value}))}/>
            </div>
            <div>
              <Label className="text-xs">Planned End</Label>
              <Input type="date" className="h-8 text-xs mt-1" value={planForm.planned_end}
                onChange={e=>setPlanForm(f=>({...f,planned_end:e.target.value}))}/>
            </div>
            <div>
              <Label className="text-xs">Actual Start</Label>
              <Input type="date" className="h-8 text-xs mt-1" value={planForm.actual_start}
                onChange={e=>setPlanForm(f=>({...f,actual_start:e.target.value}))}/>
            </div>
            <div>
              <Label className="text-xs">Actual End</Label>
              <Input type="date" className="h-8 text-xs mt-1" value={planForm.actual_end}
                onChange={e=>setPlanForm(f=>({...f,actual_end:e.target.value}))}/>
            </div>
            <div>
              <Label className="text-xs">Status</Label>
              <Select value={planForm.status} onValueChange={v=>setPlanForm(f=>({...f,status:v}))}>
                <SelectTrigger className="h-8 text-xs mt-1"><SelectValue/></SelectTrigger>
                <SelectContent>{PLAN_STATUSES.map(s=><SelectItem key={s} value={s} className="capitalize">{s.replace("_"," ")}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="col-span-2">
              <Label className="text-xs">Notes</Label>
              <Textarea rows={2} className="text-xs mt-1 resize-none" value={planForm.notes}
                onChange={e=>setPlanForm(f=>({...f,notes:e.target.value}))}/>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={()=>setPlanModal(false)}>Cancel</Button>
            <Button size="sm" className="bg-indigo-600 hover:bg-indigo-700 gap-1" onClick={savePlan} disabled={saving}>
              {saving ? <Loader2 size={12} className="animate-spin"/> : <Save size={12}/>} Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Log Communication Modal */}
      <Dialog open={commModal} onOpenChange={setCommModal}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Log Communication</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3 py-2">
            <div>
              <Label className="text-xs">Date</Label>
              <Input type="date" className="h-8 text-xs mt-1" value={commForm.communication_date}
                onChange={e=>setCommForm(f=>({...f,communication_date:e.target.value}))}/>
            </div>
            <div>
              <Label className="text-xs">Type</Label>
              <Select value={commForm.communication_type} onValueChange={v=>setCommForm(f=>({...f,communication_type:v}))}>
                <SelectTrigger className="h-8 text-xs mt-1"><SelectValue/></SelectTrigger>
                <SelectContent>{COMM_TYPES.map(t=><SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="col-span-2">
              <Label className="text-xs">Subject</Label>
              <Input className="h-8 text-xs mt-1" value={commForm.subject}
                onChange={e=>setCommForm(f=>({...f,subject:e.target.value}))} placeholder="Subject…"/>
            </div>
            <div>
              <Label className="text-xs">Contact Name</Label>
              <Input className="h-8 text-xs mt-1" value={commForm.contact_name}
                onChange={e=>setCommForm(f=>({...f,contact_name:e.target.value}))} placeholder="Name…"/>
            </div>
            <div>
              <Label className="text-xs">Phone</Label>
              <Input className="h-8 text-xs mt-1" value={commForm.contact_phone}
                onChange={e=>setCommForm(f=>({...f,contact_phone:e.target.value}))} placeholder="Phone…"/>
            </div>
            <div>
              <Label className="text-xs">Email</Label>
              <Input className="h-8 text-xs mt-1" value={commForm.contact_email}
                onChange={e=>setCommForm(f=>({...f,contact_email:e.target.value}))} placeholder="Email…"/>
            </div>
            <div>
              <Label className="text-xs">Follow-up Date</Label>
              <Input type="date" className="h-8 text-xs mt-1" value={commForm.follow_up_date}
                onChange={e=>setCommForm(f=>({...f,follow_up_date:e.target.value}))}/>
            </div>
            <div className="col-span-2">
              <Label className="text-xs">Notes</Label>
              <Textarea rows={3} className="text-xs mt-1 resize-none" value={commForm.notes}
                onChange={e=>setCommForm(f=>({...f,notes:e.target.value}))} placeholder="Notes…"/>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={()=>setCommModal(false)}>Cancel</Button>
            <Button size="sm" className="bg-indigo-600 hover:bg-indigo-700 gap-1" onClick={saveComm} disabled={saving}>
              {saving ? <Loader2 size={12} className="animate-spin"/> : <Save size={12}/>} Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// AUDIT STATUS TAB
// ═══════════════════════════════════════════════════════════════════════════════

function AuditStatusGrid({ firmId }: { firmId: string }) {
  const [rows,    setRows]    = useState<StatusRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search,  setSearch]  = useState("");
  const [fyFilter, setFyFilter]     = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");

  // Inline edit state: rowId → partial StatusRow fields being edited
  const [editing,  setEditing]  = useState<Record<string, Partial<StatusRow>>>({});
  const [saving,   setSaving]   = useState<Record<string, boolean>>({});

  const loadRows = useCallback(async () => {
    setLoading(true);

    // Load engagements
    const { data: engData } = await supabase
      .from("audit_engagements")
      .select("id, client_id, financial_year, audit_type, partner_id, entity_type")
      .eq("firm_id", firmId)
      .order("financial_year", { ascending: false });

    if (!engData || engData.length === 0) { setRows([]); setLoading(false); return; }

    // Load clients for names
    const clientIds = [...new Set(engData.map((e: any) => e.client_id).filter(Boolean))];
    const { data: clientData } = await supabase
      .from("clients")
      .select("id, name")
      .in("id", clientIds);

    // Load audit_status rows
    const engIds = engData.map((e: any) => e.id);
    const { data: statusData } = await supabase
      .from("audit_status")
      .select("*")
      .in("engagement_id", engIds);

    // Load partners
    const partnerIds = [...new Set(engData.map((e: any) => e.partner_id).filter(Boolean))];
    const { data: partnerData } = partnerIds.length > 0
      ? await supabase.from("users").select("id, name").in("id", partnerIds)
      : { data: [] };

    const clientMap   = Object.fromEntries((clientData  || []).map((c: any) => [c.id, c.name]));
    const statusMap   = Object.fromEntries((statusData  || []).map((s: any) => [s.engagement_id, s]));
    const partnerMap  = Object.fromEntries((partnerData || []).map((u: any) => [u.id, u.name]));

    const built: StatusRow[] = engData.map((e: any) => {
      const st = statusMap[e.id];
      return {
        engagement_id:  e.id,
        client_name:    clientMap[e.client_id] || "—",
        entity_type:    e.entity_type,
        financial_year: e.financial_year,
        audit_type:     e.audit_type,
        partner_name:   partnerMap[e.partner_id] || "—",
        status_id:      st?.id || null,
        fees_quoted:    st?.fees_quoted  ?? null,
        fees_received:  st?.fees_received ?? null,
        udin_tax:       st?.udin_tax      ?? null,
        udin_statutory: st?.udin_statutory ?? null,
        tracker_status: st?.tracker_status ?? "not_started",
        remarks:        st?.remarks ?? null,
      };
    });
    setRows(built);
    setLoading(false);
  }, [firmId]);

  useEffect(() => { loadRows(); }, [loadRows]);

  // Collect distinct FYs for filter
  const fyOptions = [...new Set(rows.map(r => r.financial_year).filter(Boolean))] as string[];

  const filtered = rows.filter(r => {
    const q = search.toLowerCase();
    const matchSearch = !q || r.client_name.toLowerCase().includes(q) ||
      (r.financial_year || "").includes(q);
    const matchFy   = fyFilter   === "all" || r.financial_year === fyFilter;
    const matchType = typeFilter === "all" || r.audit_type === typeFilter;
    return matchSearch && matchFy && matchType;
  });

  function startEdit(engId: string, row: StatusRow) {
    setEditing(e => ({
      ...e,
      [engId]: {
        fees_quoted:    row.fees_quoted,
        fees_received:  row.fees_received,
        udin_tax:       row.udin_tax || "",
        udin_statutory: row.udin_statutory || "",
        tracker_status: row.tracker_status,
        remarks:        row.remarks || "",
      }
    }));
  }

  function cancelEdit(engId: string) {
    setEditing(e => { const n = {...e}; delete n[engId]; return n; });
  }

  async function commitEdit(row: StatusRow) {
    const patch = editing[row.engagement_id];
    if (!patch) return;
    setSaving(s => ({...s, [row.engagement_id]: true}));

    const payload: any = {
      firm_id:        firmId,
      engagement_id:  row.engagement_id,
      client_id:      null, // optional linkage
      financial_year: row.financial_year,
      fees_quoted:    patch.fees_quoted    ?? null,
      fees_received:  patch.fees_received  ?? null,
      udin_tax:       patch.udin_tax       || null,
      udin_statutory: patch.udin_statutory || null,
      tracker_status: patch.tracker_status || "not_started",
      remarks:        patch.remarks        || null,
      updated_at:     new Date().toISOString(),
    };

    let error: any;
    if (row.status_id) {
      ({ error } = await supabase.from("audit_status").update(payload).eq("id", row.status_id));
    } else {
      ({ error } = await supabase.from("audit_status").insert(payload));
    }

    setSaving(s => ({...s, [row.engagement_id]: false}));
    if (error) { toast.error(error.message); return; }
    toast.success("Status saved");
    cancelEdit(row.engagement_id);
    loadRows();
  }

  function editVal(engId: string, field: keyof StatusRow, value: any) {
    setEditing(e => ({ ...e, [engId]: { ...(e[engId] || {}), [field]: value } }));
  }

  if (loading) return <div className="space-y-2">{Array.from({length:5}).map((_,i)=><Skeleton key={i} className="h-10 w-full"/>)}</div>;

  return (
    <div className="space-y-3">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"/>
          <Input className="pl-7 h-8 text-xs" placeholder="Search client…"
            value={search} onChange={e=>setSearch(e.target.value)}/>
        </div>
        <Select value={fyFilter} onValueChange={setFyFilter}>
          <SelectTrigger className="h-8 text-xs w-36"><SelectValue placeholder="All FY"/></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All FY</SelectItem>
            {fyOptions.map(fy=><SelectItem key={fy} value={fy}>{fy}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="h-8 text-xs w-36"><SelectValue placeholder="All Types"/></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            {AUDIT_TYPES.map(t=><SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button size="sm" variant="outline" className="h-8 w-8 p-0" onClick={loadRows}>
          <RefreshCw size={13}/>
        </Button>
      </div>

      {/* Table */}
      <div className="border rounded-lg overflow-hidden">
        <div className="overflow-auto">
          <table className="w-full text-xs border-collapse" style={{ minWidth: 1100 }}>
            <thead>
              <tr className="bg-indigo-700 text-white text-[11px] uppercase tracking-wide">
                <th className="border border-indigo-600 px-3 py-2.5 text-left min-w-[160px]">Client</th>
                <th className="border border-indigo-600 px-2 py-2.5 text-left w-28">FY</th>
                <th className="border border-indigo-600 px-2 py-2.5 text-left w-28">Type</th>
                <th className="border border-indigo-600 px-2 py-2.5 text-left w-28">Partner</th>
                <th className="border border-indigo-600 px-2 py-2.5 text-right w-28">Fees Quoted</th>
                <th className="border border-indigo-600 px-2 py-2.5 text-right w-28">Fees Recd</th>
                <th className="border border-indigo-600 px-2 py-2.5 text-left w-40">UDIN (Tax 3CA/3CB)</th>
                <th className="border border-indigo-600 px-2 py-2.5 text-left w-40">UDIN (Statutory)</th>
                <th className="border border-indigo-600 px-2 py-2.5 text-left w-32">Status</th>
                <th className="border border-indigo-600 px-2 py-2.5 text-left w-40">Remarks</th>
                <th className="border border-indigo-600 px-2 py-2.5 text-center w-16">Edit</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={11} className="py-10 text-center text-muted-foreground">No engagements found</td></tr>
              ) : filtered.map(row => {
                const ed = editing[row.engagement_id];
                const isEditing = !!ed;
                const isSaving  = saving[row.engagement_id];
                const showStatutoryUdin = isCompany(row.entity_type);
                const tsInfo = TRACKER_STATUSES.find(t => t.value === (isEditing ? ed.tracker_status : row.tracker_status));

                return (
                  <tr key={row.engagement_id} className="hover:bg-muted/10 transition-colors align-middle">
                    <td className="border border-border px-3 py-2 font-medium">{row.client_name}</td>
                    <td className="border border-border px-2 py-2 text-muted-foreground">{row.financial_year || "—"}</td>
                    <td className="border border-border px-2 py-2 capitalize text-muted-foreground">{row.audit_type?.replace("_"," ") || "—"}</td>
                    <td className="border border-border px-2 py-2 text-muted-foreground">{row.partner_name}</td>

                    {/* Fees Quoted */}
                    <td className="border border-border px-2 py-2 text-right">
                      {isEditing ? (
                        <Input type="number" className="h-6 text-xs text-right w-24 ml-auto"
                          value={ed.fees_quoted ?? ""}
                          onChange={e=>editVal(row.engagement_id,"fees_quoted", e.target.value === "" ? null : Number(e.target.value))}/>
                      ) : (
                        <span>{row.fees_quoted != null ? `₹${row.fees_quoted.toLocaleString("en-IN")}` : "—"}</span>
                      )}
                    </td>

                    {/* Fees Received */}
                    <td className="border border-border px-2 py-2 text-right">
                      {isEditing ? (
                        <Input type="number" className="h-6 text-xs text-right w-24 ml-auto"
                          value={ed.fees_received ?? ""}
                          onChange={e=>editVal(row.engagement_id,"fees_received", e.target.value === "" ? null : Number(e.target.value))}/>
                      ) : (
                        <span>{row.fees_received != null ? `₹${row.fees_received.toLocaleString("en-IN")}` : "—"}</span>
                      )}
                    </td>

                    {/* UDIN Tax */}
                    <td className="border border-border px-2 py-2">
                      {isEditing ? (
                        <Input className="h-6 text-xs w-full font-mono"
                          value={ed.udin_tax ?? ""}
                          onChange={e=>editVal(row.engagement_id,"udin_tax",e.target.value)}
                          placeholder="UDIN…"/>
                      ) : (
                        <span className="font-mono text-[11px]">{row.udin_tax || "—"}</span>
                      )}
                    </td>

                    {/* UDIN Statutory — only for Pvt/Public Ltd */}
                    <td className="border border-border px-2 py-2">
                      {showStatutoryUdin ? (
                        isEditing ? (
                          <Input className="h-6 text-xs w-full font-mono"
                            value={ed.udin_statutory ?? ""}
                            onChange={e=>editVal(row.engagement_id,"udin_statutory",e.target.value)}
                            placeholder="UDIN…"/>
                        ) : (
                          <span className="font-mono text-[11px]">{row.udin_statutory || "—"}</span>
                        )
                      ) : (
                        <span className="text-muted-foreground/40 text-[10px]">N/A</span>
                      )}
                    </td>

                    {/* Tracker Status */}
                    <td className="border border-border px-2 py-2">
                      {isEditing ? (
                        <Select value={ed.tracker_status || "not_started"}
                          onValueChange={v=>editVal(row.engagement_id,"tracker_status",v)}>
                          <SelectTrigger className="h-6 text-xs"><SelectValue/></SelectTrigger>
                          <SelectContent>
                            {TRACKER_STATUSES.map(t=><SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      ) : (
                        <Badge className={cn("text-[10px] px-1.5", tsInfo?.color)}>
                          {tsInfo?.label || row.tracker_status}
                        </Badge>
                      )}
                    </td>

                    {/* Remarks */}
                    <td className="border border-border px-2 py-2">
                      {isEditing ? (
                        <Input className="h-6 text-xs w-full"
                          value={ed.remarks ?? ""}
                          onChange={e=>editVal(row.engagement_id,"remarks",e.target.value)}
                          placeholder="Remarks…"/>
                      ) : (
                        <span className="text-muted-foreground line-clamp-1">{row.remarks || "—"}</span>
                      )}
                    </td>

                    {/* Edit / Save buttons */}
                    <td className="border border-border px-2 py-2 text-center">
                      {isEditing ? (
                        <div className="flex items-center justify-center gap-1">
                          <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-green-600 hover:bg-green-50"
                            onClick={()=>commitEdit(row)} disabled={isSaving}>
                            {isSaving ? <Loader2 size={11} className="animate-spin"/> : <Check size={11}/>}
                          </Button>
                          <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-red-500 hover:bg-red-50"
                            onClick={()=>cancelEdit(row.engagement_id)}>
                            <X size={11}/>
                          </Button>
                        </div>
                      ) : (
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-muted-foreground hover:text-indigo-600 hover:bg-indigo-50"
                          onClick={()=>startEdit(row.engagement_id, row)}>
                          <Edit2 size={12}/>
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground">
        {filtered.length} engagement{filtered.length !== 1 ? "s" : ""} shown
        {rows.length !== filtered.length ? ` of ${rows.length}` : ""}
        {" · "}UDIN (Statutory) column shown only for Private Ltd / Public Ltd entities
      </p>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// PAGE SHELL
// ═══════════════════════════════════════════════════════════════════════════════

export default function AuditTracker() {
  const { user } = useAuth();
  const firmId = user?.firm_id || "";

  if (!firmId) return (
    <div className="p-6 text-muted-foreground text-sm">Loading firm context…</div>
  );

  return (
    <div className="space-y-4 p-4 md:p-6">
      {/* Page Header */}
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-indigo-100 text-indigo-700">
          <ClipboardCheck size={22} />
        </div>
        <div>
          <h1 className="text-xl font-bold text-foreground">Audit Tracker</h1>
          <p className="text-sm text-muted-foreground">Plan, track, and communicate across all audit engagements</p>
        </div>
      </div>

      <Tabs defaultValue="planning">
        <TabsList className="h-auto gap-1">
          <TabsTrigger value="planning" className="text-xs gap-1.5">
            <CalendarDays size={13}/> Planning Board
          </TabsTrigger>
          <TabsTrigger value="status" className="text-xs gap-1.5">
            <ClipboardCheck size={13}/> Audit Status
          </TabsTrigger>
        </TabsList>

        <TabsContent value="planning" className="mt-4">
          <PlanningBoard firmId={firmId} />
        </TabsContent>

        <TabsContent value="status" className="mt-4">
          <AuditStatusGrid firmId={firmId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
