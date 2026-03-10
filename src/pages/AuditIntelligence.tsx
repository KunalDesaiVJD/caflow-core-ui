import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { format, startOfMonth, endOfMonth, eachDayOfInterval, getDay, addMonths, subMonths, isSameDay, isSameMonth, differenceInDays, isToday } from "date-fns";
import { ChevronLeft, ChevronRight, Plus, CalendarIcon, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

type Engagement = {
  id: string;
  client_id: string | null;
  financial_year: string | null;
  status: string | null;
  firm_id: string | null;
  audit_type: string | null;
  planned_start: string | null;
  planned_end: string | null;
  partner_id: string | null;
  manager_id: string | null;
  team_members: string[] | null;
  risk_rating: string | null;
  materiality: Record<string, unknown> | null;
  caro_applicable: boolean | null;
  client_name?: string;
  client_entity_type?: string;
  partner_name?: string;
  manager_name?: string;
};

type UserOption = {
  id: string;
  name: string | null;
  role: string | null;
  icai_reg_no: string | null;
  active_count: number;
};

type ClientOption = {
  id: string;
  name: string | null;
  entity_type: string | null;
};

const AUDIT_TYPES = ["Statutory", "Tax Audit u/s 44AB", "Internal Audit", "Limited Review", "Other"];
const STATUS_OPTIONS = ["planning", "fieldwork", "review", "signed", "complete"];

const statusColor: Record<string, string> = {
  planning: "bg-blue-500",
  fieldwork: "bg-amber-500",
  review: "bg-purple-500",
  signed: "bg-green-500",
  complete: "bg-green-500",
};

const statusBadgeVariant = (s: string | null): "default" | "secondary" | "destructive" | "outline" => {
  if (s === "signed" || s === "complete") return "default";
  if (s === "fieldwork") return "secondary";
  return "outline";
};

export default function AuditIntelligence() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [engagements, setEngagements] = useState<Engagement[]>([]);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [calMonth, setCalMonth] = useState(new Date());
  const [sheetOpen, setSheetOpen] = useState(false);
  const [wizardStep, setWizardStep] = useState(1);

  // Filters
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterType, setFilterType] = useState("all");
  const [filterPartner, setFilterPartner] = useState("all");

  // New engagement form
  const [form, setForm] = useState({
    client_id: "",
    financial_year: "2024-25",
    audit_type: "Statutory",
    caro_applicable: false,
    partner_id: "",
    manager_id: "",
    team_members: [] as string[],
    prior_revenue: "",
    prior_pbt: "",
    planned_start: "",
    planned_end: "",
    risk_rating: "medium",
  });

  const isSuperadmin = user?.role === "superadmin";

  const fetchData = async () => {
    if (!user) return;
    if (!user.firm_id && !isSuperadmin) return;
    setLoading(true);

    const engQuery = supabase.from("audit_engagements").select("*");
    const userQuery = supabase.from("users").select("id, name, role, icai_reg_no").eq("is_active", true);
    const clientQuery = supabase.from("clients").select("id, name, entity_type");

    if (user.firm_id) {
      engQuery.eq("firm_id", user.firm_id);
      userQuery.eq("firm_id", user.firm_id);
      clientQuery.eq("firm_id", user.firm_id);
    }

    const [engRes, userRes, clientRes] = await Promise.all([engQuery, userQuery, clientQuery]);

    const userMap = new Map((userRes.data || []).map(u => [u.id, u]));
    const clientMap = new Map((clientRes.data || []).map(c => [c.id, c]));

    // Count active engagements per user
    const countMap = new Map<string, number>();
    (engRes.data || []).forEach((e: any) => {
      if (e.status !== "signed" && e.status !== "complete") {
        if (e.partner_id) countMap.set(e.partner_id, (countMap.get(e.partner_id) || 0) + 1);
        if (e.manager_id) countMap.set(e.manager_id, (countMap.get(e.manager_id) || 0) + 1);
      }
    });

    setUsers((userRes.data || []).map(u => ({ ...u, active_count: countMap.get(u.id) || 0 })));
    setClients(clientRes.data || []);

    const mapped: Engagement[] = (engRes.data || []).map((e: any) => ({
      ...e,
      client_name: clientMap.get(e.client_id)?.name || "Unknown",
      client_entity_type: clientMap.get(e.client_id)?.entity_type || "",
      partner_name: userMap.get(e.partner_id)?.name || "",
      manager_name: userMap.get(e.manager_id)?.name || "",
    }));
    setEngagements(mapped);
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, [user?.firm_id, user?.role]);

  // Realtime subscription
  useEffect(() => {
    if (!user?.firm_id) return;
    const channel = supabase.channel("audit-eng-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "audit_engagements", filter: `firm_id=eq.${user.firm_id}` }, () => {
        fetchData();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user?.firm_id]);

  // Calendar data
  const monthStart = startOfMonth(calMonth);
  const monthEnd = endOfMonth(calMonth);
  const days = eachDayOfInterval({ start: monthStart, end: monthEnd });
  const startPad = getDay(monthStart); // 0=Sun

  const engByDay = useMemo(() => {
    const map = new Map<string, Engagement[]>();
    engagements.forEach(e => {
      if (!e.planned_start || !e.planned_end) return;
      const s = new Date(e.planned_start);
      const end = new Date(e.planned_end);
      const dayRange = eachDayOfInterval({ start: s > monthStart ? s : monthStart, end: end < monthEnd ? end : monthEnd });
      dayRange.forEach(d => {
        if (isSameMonth(d, calMonth)) {
          const key = format(d, "yyyy-MM-dd");
          const arr = map.get(key) || [];
          arr.push(e);
          map.set(key, arr);
        }
      });
    });
    return map;
  }, [engagements, calMonth]);

  // Filtered list
  const filtered = engagements.filter(e => {
    if (filterStatus !== "all" && e.status !== filterStatus) return false;
    if (filterType !== "all" && e.audit_type !== filterType) return false;
    if (filterPartner !== "all" && e.partner_id !== filterPartner) return false;
    return true;
  });

  // Materiality calc
  const calcMateriality = () => {
    const rev = parseFloat(form.prior_revenue) || 0;
    const pbt = parseFloat(form.prior_pbt) || 0;
    if (rev === 0 && pbt === 0) return null;
    const m1 = rev * 0.01;
    const m2 = Math.abs(pbt) * 0.05;
    return Math.min(m1, m2);
  };
  const materiality = calcMateriality();

  // Auto-set CARO
  const selectedClient = clients.find(c => c.id === form.client_id);
  useEffect(() => {
    if (selectedClient?.entity_type?.toLowerCase() === "company") {
      setForm(f => ({ ...f, caro_applicable: true }));
    }
  }, [form.client_id]);

  const handleSave = async () => {
    if (!form.client_id || !user?.firm_id) {
      toast.error("Please select a client");
      return;
    }

    const payload: Record<string, unknown> = {
      client_id: form.client_id,
      firm_id: user.firm_id,
      financial_year: form.financial_year,
      audit_type: form.audit_type,
      status: "planning",
      caro_applicable: form.caro_applicable,
      partner_id: form.partner_id || null,
      manager_id: form.manager_id || null,
      team_members: form.team_members,
      planned_start: form.planned_start || null,
      planned_end: form.planned_end || null,
      risk_rating: form.risk_rating,
      materiality: materiality ? { revenue: parseFloat(form.prior_revenue), pbt: parseFloat(form.prior_pbt), computed: materiality } : null,
    };

    const { error } = await supabase.from("audit_engagements").insert(payload as any);
    if (error) {
      toast.error("Failed to create engagement");
      return;
    }

    // Notify partner
    if (form.partner_id) {
      supabase.functions.invoke("send-notification", {
        body: { type: "audit_assigned", user_id: form.partner_id, firm_id: user.firm_id, data: { client_name: selectedClient?.name, audit_type: form.audit_type, financial_year: form.financial_year } },
      }).catch(() => {});
    }

    toast.success("Engagement created");
    setSheetOpen(false);
    setWizardStep(1);
    setForm({ client_id: "", financial_year: "2024-25", audit_type: "Statutory", caro_applicable: false, partner_id: "", manager_id: "", team_members: [], prior_revenue: "", prior_pbt: "", planned_start: "", planned_end: "", risk_rating: "medium" });
    fetchData();
  };

  const partners = users.filter(u => u.role === "partner");
  const managers = users.filter(u => u.role === "manager" || u.role === "firm_admin");
  const staff = users.filter(u => u.role === "staff_article" || u.role === "staff");

  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-display font-bold text-foreground">Audit Intelligence</h1>
          <p className="text-sm text-muted-foreground">Engagement calendar, team workload & audit pipeline</p>
        </div>
        <Button onClick={() => setSheetOpen(true)} className="gap-2">
          <Plus size={16} /> New Audit Engagement
        </Button>
      </div>

      {/* Calendar */}
      <Card className="p-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-foreground">{format(calMonth, "MMMM yyyy")}</h2>
          <div className="flex gap-2">
            <Button variant="outline" size="icon" onClick={() => setCalMonth(subMonths(calMonth, 1))}><ChevronLeft size={16} /></Button>
            <Button variant="outline" size="sm" onClick={() => setCalMonth(new Date())}>Today</Button>
            <Button variant="outline" size="icon" onClick={() => setCalMonth(addMonths(calMonth, 1))}><ChevronRight size={16} /></Button>
          </div>
        </div>

        <div className="grid grid-cols-7 gap-px bg-border rounded-lg overflow-hidden">
          {dayNames.map(d => (
            <div key={d} className="bg-muted px-2 py-1.5 text-center text-xs font-medium text-muted-foreground">{d}</div>
          ))}
          {Array.from({ length: startPad }).map((_, i) => (
            <div key={`pad-${i}`} className="bg-card min-h-[80px]" />
          ))}
          {days.map(day => {
            const key = format(day, "yyyy-MM-dd");
            const dayEngs = engByDay.get(key) || [];
            return (
              <div key={key} className={cn("bg-card min-h-[80px] p-1 relative", isToday(day) && "ring-2 ring-primary ring-inset")}>
                <span className={cn("text-xs font-medium", isToday(day) ? "text-primary" : "text-muted-foreground")}>{format(day, "d")}</span>
                <div className="flex flex-wrap gap-0.5 mt-0.5">
                  {dayEngs.slice(0, 4).map(e => (
                    <button
                      key={e.id}
                      onClick={() => navigate(`/audit/${e.id}`)}
                      title={`${e.client_name} — ${e.status}`}
                      className={cn("w-5 h-5 rounded-full text-[8px] font-bold text-white flex items-center justify-center cursor-pointer hover:scale-110 transition-transform", statusColor[e.status || "planning"])}
                    >
                      {(e.client_name || "?").slice(0, 2).toUpperCase()}
                    </button>
                  ))}
                  {dayEngs.length > 4 && <span className="text-[9px] text-muted-foreground">+{dayEngs.length - 4}</span>}
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex gap-4 mt-3 text-xs text-muted-foreground">
          {Object.entries(statusColor).filter(([k]) => k !== "complete").map(([k, c]) => (
            <span key={k} className="flex items-center gap-1.5 capitalize"><span className={cn("w-3 h-3 rounded-full", c)} />{k}</span>
          ))}
        </div>
      </Card>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-[160px]"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            {STATUS_OPTIONS.map(s => <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterType} onValueChange={setFilterType}>
          <SelectTrigger className="w-[200px]"><SelectValue placeholder="Audit Type" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            {AUDIT_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterPartner} onValueChange={setFilterPartner}>
          <SelectTrigger className="w-[200px]"><SelectValue placeholder="Partner" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Partners</SelectItem>
            {partners.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* Engagement List */}
      {loading ? (
        <div className="text-muted-foreground text-sm">Loading engagements…</div>
      ) : filtered.length === 0 ? (
        <Card className="p-8 text-center text-muted-foreground">No engagements found. Create one to get started.</Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map(e => {
            const daysLeft = e.planned_end ? differenceInDays(new Date(e.planned_end), new Date()) : null;
            return (
              <Card key={e.id} className="p-4 space-y-2 hover:shadow-md transition-shadow cursor-pointer" onClick={() => navigate(`/audit/${e.id}`)}>
                <div className="flex items-start justify-between">
                  <h3 className="font-semibold text-foreground">{e.client_name}</h3>
                  <Badge variant={statusBadgeVariant(e.status)} className="capitalize">{e.status}</Badge>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {e.audit_type && <Badge variant="outline" className="text-xs">{e.audit_type}</Badge>}
                  {e.client_entity_type && <Badge variant="secondary" className="text-xs capitalize">{e.client_entity_type}</Badge>}
                </div>
                <div className="text-xs text-muted-foreground space-y-0.5">
                  {e.partner_name && <div>Partner: {e.partner_name}</div>}
                  {e.manager_name && <div>Manager: {e.manager_name}</div>}
                  {e.planned_end && <div>Deadline: {format(new Date(e.planned_end), "dd MMM yyyy")}</div>}
                </div>
                {daysLeft !== null && (
                  <div className={cn("text-xs font-medium", daysLeft < 7 ? "text-destructive" : daysLeft < 30 ? "text-amber-600" : "text-muted-foreground")}>
                    {daysLeft < 0 ? (
                      <span className="flex items-center gap-1"><AlertTriangle size={12} /> Overdue by {Math.abs(daysLeft)} days</span>
                    ) : (
                      `${daysLeft} days until deadline`
                    )}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {/* New Engagement Sheet */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent className="sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle>New Audit Engagement — Step {wizardStep}/3</SheetTitle>
          </SheetHeader>

          <div className="flex gap-1 my-4">
            {[1, 2, 3].map(s => (
              <div key={s} className={cn("h-1.5 flex-1 rounded-full", s <= wizardStep ? "bg-primary" : "bg-muted")} />
            ))}
          </div>

          {wizardStep === 1 && (
            <div className="space-y-4">
              <div>
                <Label>Client</Label>
                <Select value={form.client_id} onValueChange={v => setForm(f => ({ ...f, client_id: v }))}>
                  <SelectTrigger><SelectValue placeholder="Select client" /></SelectTrigger>
                  <SelectContent>
                    {clients.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Financial Year</Label>
                <Input value={form.financial_year} onChange={e => setForm(f => ({ ...f, financial_year: e.target.value }))} placeholder="e.g. 2024-25" />
              </div>
              <div>
                <Label>Audit Type</Label>
                <Select value={form.audit_type} onValueChange={v => setForm(f => ({ ...f, audit_type: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {AUDIT_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Entity Type</Label>
                <Input value={selectedClient?.entity_type || ""} readOnly className="bg-muted" />
              </div>
              <div className="flex items-center gap-3">
                <Switch checked={form.caro_applicable} onCheckedChange={v => setForm(f => ({ ...f, caro_applicable: v }))} />
                <Label>CARO Applicable</Label>
              </div>
              <Button className="w-full" onClick={() => setWizardStep(2)}>Next →</Button>
            </div>
          )}

          {wizardStep === 2 && (
            <div className="space-y-4">
              <div>
                <Label>Engagement Partner</Label>
                <Select value={form.partner_id} onValueChange={v => setForm(f => ({ ...f, partner_id: v }))}>
                  <SelectTrigger><SelectValue placeholder="Select partner" /></SelectTrigger>
                  <SelectContent>
                    {partners.map(p => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name} {p.icai_reg_no ? `(${p.icai_reg_no})` : ""} — {p.active_count} active
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Engagement Manager</Label>
                <Select value={form.manager_id} onValueChange={v => setForm(f => ({ ...f, manager_id: v }))}>
                  <SelectTrigger><SelectValue placeholder="Select manager" /></SelectTrigger>
                  <SelectContent>
                    {managers.map(m => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.name} — {m.active_count} active
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Team Members</Label>
                <div className="grid grid-cols-1 gap-1 max-h-32 overflow-y-auto border rounded-md p-2">
                  {staff.map(s => (
                    <label key={s.id} className="flex items-center gap-2 text-sm cursor-pointer">
                      <input
                        type="checkbox"
                        checked={form.team_members.includes(s.id)}
                        onChange={() => setForm(f => ({
                          ...f,
                          team_members: f.team_members.includes(s.id)
                            ? f.team_members.filter(id => id !== s.id)
                            : [...f.team_members, s.id],
                        }))}
                      />
                      {s.name} <span className="text-muted-foreground">({s.active_count} active)</span>
                    </label>
                  ))}
                  {staff.length === 0 && <span className="text-xs text-muted-foreground">No staff users found</span>}
                </div>
              </div>

              <div className="border rounded-md p-3 space-y-2 bg-muted/50">
                <Label className="text-xs font-semibold uppercase text-muted-foreground">Materiality Calculator</Label>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-xs">Prior Year Revenue (₹)</Label>
                    <Input type="number" value={form.prior_revenue} onChange={e => setForm(f => ({ ...f, prior_revenue: e.target.value }))} />
                  </div>
                  <div>
                    <Label className="text-xs">Prior Year PBT (₹)</Label>
                    <Input type="number" value={form.prior_pbt} onChange={e => setForm(f => ({ ...f, prior_pbt: e.target.value }))} />
                  </div>
                </div>
                {materiality !== null && (
                  <div className="text-sm text-foreground">
                    <strong>Materiality: ₹{materiality.toLocaleString("en-IN", { maximumFractionDigits: 0 })}</strong>
                    <div className="text-xs text-muted-foreground">
                      min(Revenue × 1% = ₹{((parseFloat(form.prior_revenue) || 0) * 0.01).toLocaleString("en-IN", { maximumFractionDigits: 0 })}, |PBT| × 5% = ₹{(Math.abs(parseFloat(form.prior_pbt) || 0) * 0.05).toLocaleString("en-IN", { maximumFractionDigits: 0 })})
                    </div>
                  </div>
                )}
              </div>

              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => setWizardStep(1)}>← Back</Button>
                <Button className="flex-1" onClick={() => setWizardStep(3)}>Next →</Button>
              </div>
            </div>
          )}

          {wizardStep === 3 && (
            <div className="space-y-4">
              <div>
                <Label>Planned Start</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className={cn("w-full justify-start", !form.planned_start && "text-muted-foreground")}>
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {form.planned_start ? format(new Date(form.planned_start), "PPP") : "Pick a date"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={form.planned_start ? new Date(form.planned_start) : undefined}
                      onSelect={d => d && setForm(f => ({ ...f, planned_start: format(d, "yyyy-MM-dd") }))}
                      className="p-3 pointer-events-auto"
                    />
                  </PopoverContent>
                </Popover>
              </div>
              <div>
                <Label>Planned End</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className={cn("w-full justify-start", !form.planned_end && "text-muted-foreground")}>
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {form.planned_end ? format(new Date(form.planned_end), "PPP") : "Pick a date"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={form.planned_end ? new Date(form.planned_end) : undefined}
                      onSelect={d => d && setForm(f => ({ ...f, planned_end: format(d, "yyyy-MM-dd") }))}
                      className="p-3 pointer-events-auto"
                    />
                  </PopoverContent>
                </Popover>
              </div>
              <div>
                <Label>Risk Rating</Label>
                <Select value={form.risk_rating} onValueChange={v => setForm(f => ({ ...f, risk_rating: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="low">Low</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => setWizardStep(2)}>← Back</Button>
                <Button className="flex-1" onClick={handleSave}>Create Engagement</Button>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
