import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { VersionHistoryPanel } from "@/components/VersionHistoryPanel";
import { ClientGroupsSection } from "@/components/client-detail/ClientGroupsSection";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { ArrowLeft, Pencil, Shield, Loader2, Save } from "lucide-react";
import { PieChart, Pie, Cell, ResponsiveContainer } from "recharts";

interface Client {
  id: string;
  name: string | null;
  pan: string | null;
  entity_type: string | null;
  cin: string | null;
  gstin: string[] | null;
  created_at: string | null;
  compliance_flags: any;
  firm_id: string | null;
  statutory_audit_applicable: boolean | null;
  tax_audit_type: string | null;
  caro_applicable: boolean | null;
  internal_audit_applicable: boolean | null;
  stock_audit_applicable: boolean | null;
  audit_config: any;
}

interface ServiceCategory {
  id: string;
  name: string;
  category_code: string;
  frequency: string;
  linked_module: string | null;
  is_active: boolean;
}

interface ClientService {
  id: string;
  client_id: string;
  service_category_id: string;
  is_active: boolean;
  frequency_override: string | null;
  due_date_override: number | null;
  assigned_staff: any;
  fee_override: number | null;
  notes: string | null;
}

const SEVERITY_COLORS: Record<string, string> = { HIGH: "#ef4444", MEDIUM: "#f59e0b", LOW: "#9ca3af" };
const FLAG_LABELS: Record<string, string> = {
  gst_registered: "GST", tds_deductor: "TDS", fixed_assets: "Fixed Assets",
  govt_grants: "Govt Grants", multiple_banks: "Multiple Banks", caro_applicable: "CARO",
  transfer_pricing: "Transfer Pricing", mat_applicable: "MAT", special_deductions: "Special Deductions",
  msme_suppliers: "MSME",
};

const FREQUENCIES = [
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "half_yearly", label: "Half Yearly" },
  { value: "annual", label: "Annual" },
  { value: "event_based", label: "Event Based" },
];

const ClientDetail = () => {
  const { clientId } = useParams<{ clientId: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user } = useAuth();
  const [client, setClient] = useState<Client | null>(null);
  const [responsiblePersonName, setResponsiblePersonName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Scrutiny
  const [findings, setFindings] = useState<any[]>([]);
  const [scrutinyRunning, setScrutinyRunning] = useState(false);

  // Banking
  const [bankingData, setBankingData] = useState<any>(null);

  // Services
  const [serviceCategories, setServiceCategories] = useState<ServiceCategory[]>([]);
  const [clientServices, setClientServices] = useState<ClientService[]>([]);
  const [svcSaving, setSvcSaving] = useState<string | null>(null);

  // Audit setup
  const [auditForm, setAuditForm] = useState({
    statutory_audit_applicable: false,
    tax_audit_type: "" as string,
    caro_applicable: false,
    internal_audit_applicable: false,
    stock_audit_applicable: false,
    audit_turnover: "" as string,
  });
  const [auditSaving, setAuditSaving] = useState(false);

  // Work groups
  const [itrWorkGroups, setItrWorkGroups] = useState<any[]>([]);
  const [clientItrProfile, setClientItrProfile] = useState<any>(null);

  // Staff list
  const [staffList, setStaffList] = useState<{ id: string; name: string }[]>([]);

  // Audit classification (FY-based)
  const [isAuditClient, setIsAuditClient] = useState(false);

  useEffect(() => {
    if (!clientId) return;
    loadAllData();
    // Check audit classification
    const checkAuditClassification = async () => {
      const now = new Date();
      const fyStart = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
      const currentFY = `${fyStart}-${String(fyStart + 1).slice(-2)}`;
      const { data } = await supabase
        .from("client_fy_classifications")
        .select("classification")
        .eq("client_id", clientId)
        .eq("financial_year", currentFY)
        .maybeSingle();
      setIsAuditClient(data?.classification === "Audit");
    };
    checkAuditClassification();
  }, [clientId]);

  async function loadAllData() {
    setLoading(true);
    try {
      const [clientRes, profileRes, catRes, csRes, staffRes] = await Promise.all([
        supabase.from("clients").select("*").eq("id", clientId!).single(),
        supabase.from("client_profiles").select("audit_questions").eq("client_id", clientId!).limit(1),
        supabase.from("service_categories").select("id, name, category_code, frequency, linked_module, is_active").eq("is_active", true).order("name"),
        supabase.from("client_services").select("*").eq("client_id", clientId!),
        supabase.from("users").select("id, name").order("name"),
      ]);

      // Load optional tables gracefully
      let findingsData: any[] = [];
      let wgData: any[] = [];
      let itrData: any = null;
      try { const r = await supabase.from("scrutiny_findings").select("*").eq("client_id", clientId!); findingsData = r.data || []; } catch {}
      try { const r = await supabase.from("itr_work_groups").select("*").order("code"); wgData = r.data || []; } catch {}
      try { const r = await supabase.from("itr_profiles").select("*").eq("client_id", clientId!).limit(1); itrData = r.data?.[0] || null; } catch {}

      const c = clientRes.data as Client | null;
      setClient(c);
      setFindings(findingsData);

      // Load responsible person name
      if (c && (c as any).responsible_person_id) {
        const rpUser = (staffRes.data || []).find((u: any) => u.id === (c as any).responsible_person_id);
        setResponsiblePersonName(rpUser?.name || null);
      } else {
        setResponsiblePersonName(null);
      }

      if (profileRes.data?.[0]) setBankingData(profileRes.data[0]);
      setServiceCategories((catRes.data || []) as any as ServiceCategory[]);
      setClientServices((csRes.data || []) as any as ClientService[]);
      setStaffList((staffRes.data || []) as any[]);
      setItrWorkGroups(wgData);
      setClientItrProfile(itrData);

      if (c) {
        setAuditForm({
          statutory_audit_applicable: c.statutory_audit_applicable || false,
          tax_audit_type: c.tax_audit_type || "",
          caro_applicable: c.caro_applicable || false,
          internal_audit_applicable: c.internal_audit_applicable || false,
          stock_audit_applicable: c.stock_audit_applicable || false,
          audit_turnover: (c as any).audit_turnover ? String((c as any).audit_turnover) : "",
        });
      }
    } catch (e: any) {
      console.error("Error loading client data:", e);
      toast({ title: "Error loading client data", description: e?.message, variant: "destructive" });
    }
    setLoading(false);
  }

  async function runScrutiny() {
    if (!clientId || !client) return;
    setScrutinyRunning(true);
    try {
      const { error } = await supabase.functions.invoke("run-scrutiny", {
        body: { client_id: clientId, financial_year: new Date().getFullYear().toString(), firm_id: client.firm_id },
      });
      if (error) throw error;
      toast({ title: "Scrutiny complete" });
      const { data } = await supabase.from("scrutiny_findings").select("*").eq("client_id", clientId);
      setFindings(data || []);
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setScrutinyRunning(false);
    }
  }

  // Generate tasks based on frequency
  function generateTasksForFrequency(
    clientId: string, clientName: string, catName: string, catId: string, 
    frequency: string, firmId: string
  ) {
    const now = new Date();
    const fy = now.getMonth() >= 3
      ? `${now.getFullYear()}-${String(now.getFullYear()+1).slice(-2)}`
      : `${now.getFullYear()-1}-${String(now.getFullYear()).slice(-2)}`;
    const tasks: any[] = [];

    if (frequency === 'event_based') return tasks; // No auto-tasks

    const periods: { label: string; due: string }[] = [];
    const fyStart = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;

    if (frequency === 'monthly') {
      for (let m = 0; m < 12; m++) {
        const month = new Date(fyStart, 3 + m, 1);
        const monthName = month.toLocaleString('en-IN', { month: 'short', year: 'numeric' });
        const dueDate = new Date(fyStart, 3 + m + 1, 10); // 10th of next month
        periods.push({ label: monthName, due: dueDate.toISOString().split('T')[0] });
      }
    } else if (frequency === 'quarterly') {
      [{ label: 'Q1 (Apr-Jun)', m: 6 }, { label: 'Q2 (Jul-Sep)', m: 9 },
       { label: 'Q3 (Oct-Dec)', m: 12 }, { label: 'Q4 (Jan-Mar)', m: 15 }].forEach(q => {
        const due = new Date(fyStart, q.m, 15);
        periods.push({ label: `${q.label} ${fy}`, due: due.toISOString().split('T')[0] });
      });
    } else if (frequency === 'half_yearly') {
      periods.push(
        { label: `H1 (Apr-Sep) ${fy}`, due: new Date(fyStart, 9, 15).toISOString().split('T')[0] },
        { label: `H2 (Oct-Mar) ${fy}`, due: new Date(fyStart + 1, 2, 31).toISOString().split('T')[0] }
      );
    } else if (frequency === 'annual') {
      periods.push({ label: `FY ${fy}`, due: new Date(fyStart + 1, 2, 31).toISOString().split('T')[0] });
    }

    for (const p of periods) {
      tasks.push({
        client_id: clientId,
        service_category_id: catId,
        firm_id: firmId,
        task_title: `${catName} — ${p.label}`,
        task_description: `Auto-generated task for ${clientName}`,
        frequency,
        due_date: p.due,
        period_label: p.label,
        status: 'pending',
      });
    }
    return tasks;
  }

  // Service toggle
  async function toggleService(catId: string, currentlyActive: boolean) {
    setSvcSaving(catId);
    try {
      const existing = clientServices.find(s => s.service_category_id === catId);
      if (existing) {
        await supabase.from("client_services").update({
          is_active: !currentlyActive,
          ...(currentlyActive ? { deactivated_at: new Date().toISOString() } : { activated_at: new Date().toISOString(), deactivated_at: null }),
        } as any).eq("id", existing.id);

        // If deactivating, remove pending tasks
        if (currentlyActive) {
          await supabase.from("service_tasks").delete()
            .eq("client_id", clientId!)
            .eq("service_category_id", catId)
            .eq("status", "pending");
        }
      } else {
        await supabase.from("client_services").insert({
          client_id: clientId!,
          service_category_id: catId,
          is_active: true,
          activated_at: new Date().toISOString(),
        } as any);
      }

      // If activating, auto-generate tasks based on frequency
      if (!currentlyActive && client?.firm_id) {
        const cat = serviceCategories.find(c => c.id === catId);
        const cs = clientServices.find(s => s.service_category_id === catId);
        const freq = cs?.frequency_override || cat?.frequency || 'annual';
        if (freq !== 'event_based') {
          const tasks = generateTasksForFrequency(
            clientId!, client.name || 'Client', cat?.name || 'Service',
            catId, freq, client.firm_id
          );
          if (tasks.length > 0) {
            // Remove existing pending tasks first to avoid duplicates
            await supabase.from("service_tasks").delete()
              .eq("client_id", clientId!)
              .eq("service_category_id", catId)
              .eq("status", "pending");
            await supabase.from("service_tasks").insert(tasks as any);
            toast({ title: `${tasks.length} task(s) auto-created for ${cat?.name}` });
          }
        }
      }

      const { data } = await supabase.from("client_services").select("*").eq("client_id", clientId!);
      setClientServices((data || []) as any as ClientService[]);
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setSvcSaving(null);
    }
  }

  async function updateServiceField(csId: string, field: string, value: any) {
    await supabase.from("client_services").update({ [field]: value } as any).eq("id", csId);
    setClientServices(prev => prev.map(s => s.id === csId ? { ...s, [field]: value } : s));
  }

  // Audit setup save
  async function saveAuditSetup() {
    if (!clientId) return;
    setAuditSaving(true);
    try {
      await supabase.from("clients").update({
        statutory_audit_applicable: auditForm.statutory_audit_applicable,
        tax_audit_type: auditForm.tax_audit_type || null,
        caro_applicable: auditForm.caro_applicable,
        internal_audit_applicable: auditForm.internal_audit_applicable,
        stock_audit_applicable: auditForm.stock_audit_applicable,
      } as any).eq("id", clientId);
      toast({ title: "Audit setup saved" });
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setAuditSaving(false);
    }
  }

  if (loading) return <div className="space-y-4"><Skeleton className="h-8 w-48" /><Skeleton className="h-40 w-full" /></div>;
  if (!client) return <div className="text-center py-16 text-muted-foreground">Client not found.</div>;

  const compliance = client.compliance_flags || {};
  const activeFlags = Object.entries(FLAG_LABELS).filter(([key]) => compliance[key]);
  const unresolvedFindings = findings.filter(f => f.status !== "resolved" && f.status !== "waived");
  const highCount = unresolvedFindings.filter(f => f.severity === "HIGH").length;
  const medCount = unresolvedFindings.filter(f => f.severity === "MEDIUM").length;
  const lowCount = unresolvedFindings.filter(f => f.severity === "LOW").length;
  const donutData = [
    { name: "HIGH", value: highCount, color: SEVERITY_COLORS.HIGH },
    { name: "MEDIUM", value: medCount, color: SEVERITY_COLORS.MEDIUM },
    { name: "LOW", value: lowCount, color: SEVERITY_COLORS.LOW },
  ].filter(d => d.value > 0);


  const bankAccounts: any[] = [];

  const isDraft = (client as any).is_draft === true;

  const handleDeleteDraft = async () => {
    if (!clientId) return;
    const confirmed = window.confirm("Delete this draft client?");
    if (!confirmed) return;
    try {
      const { error } = await supabase.from("clients").delete().eq("id", clientId);
      if (error) throw error;
      toast({ title: "Draft deleted" });
      navigate("/clients");
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  };

  return (
    <div className="space-y-4">
      {/* Draft banner */}
      {isDraft && (
        <div className="flex items-center justify-between rounded-lg border border-accent bg-accent/10 p-4">
          <p className="text-sm font-medium text-foreground">This client is a draft. Complete setup to activate.</p>
          <div className="flex gap-2">
            <Button variant="destructive" size="sm" onClick={handleDeleteDraft}>Delete Draft</Button>
            <Button size="sm" onClick={() => navigate(`/clients/edit/${client.id}`)}>Continue Setup</Button>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <Button variant="ghost" size="sm" className="mb-2 -ml-2 text-xs gap-1" onClick={() => navigate("/clients")}><ArrowLeft className="h-3 w-3" /> Back to Clients</Button>
          <h1 className="text-2xl font-display font-bold text-foreground">{client.name || "Unnamed Client"}</h1>
          <div className="flex items-center gap-2 mt-1">
            {client.entity_type && <Badge variant="outline">{client.entity_type}</Badge>}
            {client.pan && <span className="text-sm font-mono text-muted-foreground">{client.pan}</span>}
            {isDraft && <Badge variant="secondary">Draft</Badge>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="gap-1" onClick={() => navigate(`/clients/edit/${client.id}`)}><Pencil className="h-3 w-3" /> Edit</Button>
          <VersionHistoryPanel table_name="clients" record_id={client.id} />
        </div>
      </div>

      {/* 4-Tab Layout */}
      <Tabs defaultValue="basic" className="space-y-4">
        <TabsList>
          <TabsTrigger value="basic">Basic Info</TabsTrigger>
          <TabsTrigger value="services">Service Activation</TabsTrigger>
          {isAuditClient && <TabsTrigger value="audit">Audit Setup</TabsTrigger>}
          <TabsTrigger value="groups">Work Groups</TabsTrigger>
        </TabsList>

        {/* Tab 1: Basic Info */}
        <TabsContent value="basic">
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
            <div className="lg:col-span-3 space-y-4">
              {/* Client Details */}
              <Card>
                <CardHeader><CardTitle className="text-sm">Client Details</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div><span className="text-muted-foreground">Name:</span> <span className="font-medium">{client.name || "—"}</span></div>
                    <div><span className="text-muted-foreground">PAN:</span> <span className="font-mono">{client.pan || "—"}</span></div>
                    <div><span className="text-muted-foreground">Entity Type:</span> <span>{client.entity_type || "—"}</span></div>
                    <div><span className="text-muted-foreground">CIN:</span> <span className="font-mono">{client.cin || "—"}</span></div>
                    <div className="col-span-2"><span className="text-muted-foreground">GSTIN:</span> <span className="font-mono">{(client.gstin || []).join(", ") || "—"}</span></div>
                    <div className="col-span-2"><span className="text-muted-foreground">Responsible Person:</span> <span className="font-medium">{responsiblePersonName || "—"}</span></div>
                  </div>
                </CardContent>
              </Card>

              {/* Compliance Flags */}
              <Card>
                <CardHeader><CardTitle className="text-sm">Compliance Flags</CardTitle></CardHeader>
                <CardContent>
                  {activeFlags.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {activeFlags.map(([key, label]) => <Badge key={key} className="text-xs bg-primary/10 text-primary border-primary/20">{label}</Badge>)}
                    </div>
                  ) : <p className="text-sm text-muted-foreground">No compliance flags set</p>}
                </CardContent>
              </Card>

              {/* Banking Summary */}
              <Card>
                <CardHeader><CardTitle className="text-sm">Banking Details</CardTitle></CardHeader>
                <CardContent>
                  {bankAccounts.length > 0 ? (
                    <div className="space-y-1">
                      {bankAccounts.map((b: any, i: number) => (
                        <div key={i} className="flex justify-between text-sm">
                          <span>{b.bank_name} — {b.branch}</span>
                          <span className="font-mono text-muted-foreground">{b.account_type}</span>
                        </div>
                      ))}
                    </div>
                  ) : <p className="text-sm text-muted-foreground">No bank accounts recorded</p>}
                </CardContent>
              </Card>

              {/* Groups */}
              <Card>
                <CardContent className="p-4"><ClientGroupsSection clientId={client.id} /></CardContent>
              </Card>
            </div>

            {/* Scrutiny Widget */}
            <div className="lg:col-span-2">
              <Card>
                <CardHeader><CardTitle className="text-sm flex items-center gap-2"><Shield className="h-4 w-4" /> Scrutiny Health</CardTitle></CardHeader>
                <CardContent className="flex flex-col items-center space-y-3">
                  {donutData.length > 0 ? (
                    <div className="relative w-32 h-32">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart><Pie data={donutData} dataKey="value" innerRadius={35} outerRadius={55} paddingAngle={2}>{donutData.map((d, i) => <Cell key={i} fill={d.color} />)}</Pie></PieChart>
                      </ResponsiveContainer>
                      <div className="absolute inset-0 flex items-center justify-center"><span className="text-xl font-bold text-foreground">{unresolvedFindings.length}</span></div>
                    </div>
                  ) : <p className="text-sm text-muted-foreground py-4">No unresolved findings</p>}
                  <div className="flex gap-3 text-xs">
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-destructive" />{highCount} HIGH</span>
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-400" />{medCount} MED</span>
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-muted-foreground" />{lowCount} LOW</span>
                  </div>
                  <Button size="sm" className="gap-1" onClick={runScrutiny} disabled={scrutinyRunning}>
                    {scrutinyRunning ? <Loader2 className="h-3 w-3 animate-spin" /> : <Shield className="h-3 w-3" />} Run Scrutiny
                  </Button>
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>

        {/* Tab 2: Service Activation */}
        <TabsContent value="services">
          <Card>
            <CardHeader><CardTitle className="text-sm">Service Activation</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {serviceCategories.map(cat => {
                const cs = clientServices.find(s => s.service_category_id === cat.id);
                const isActive = cs?.is_active || false;
                return (
                  <div key={cat.id} className="border border-border rounded-lg p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <Switch
                          checked={isActive}
                          onCheckedChange={() => toggleService(cat.id, isActive)}
                          disabled={svcSaving === cat.id}
                        />
                        <div>
                          <p className="text-sm font-medium text-foreground">{cat.name}</p>
                          <div className="flex gap-1.5 mt-0.5">
                            <Badge variant="outline" className="text-[10px]">{cat.frequency}</Badge>
                            {cat.linked_module && <Badge variant="secondary" className="text-[10px]">{cat.linked_module}</Badge>}
                          </div>
                        </div>
                      </div>
                      {svcSaving === cat.id && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                    </div>
                    {isActive && cs && (
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pl-12">
                        <div className="space-y-1">
                          <Label className="text-[11px]">Frequency Override</Label>
                          <Select value={cs.frequency_override || "__default__"} onValueChange={v => updateServiceField(cs.id, "frequency_override", v === "__default__" ? null : v)}>
                            <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Default" /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__default__">Default</SelectItem>
                              {FREQUENCIES.map(f => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1">
                          <Label className="text-[11px]">Due Day Override</Label>
                          <Input type="number" min={1} max={31} className="h-8 text-xs" value={cs.due_date_override || ""} onChange={e => updateServiceField(cs.id, "due_date_override", e.target.value ? parseInt(e.target.value) : null)} />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-[11px]">Fee Override (₹)</Label>
                          <Input type="number" className="h-8 text-xs" value={cs.fee_override || ""} onChange={e => updateServiceField(cs.id, "fee_override", e.target.value ? parseFloat(e.target.value) : null)} />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-[11px]">Notes</Label>
                          <Input className="h-8 text-xs" value={cs.notes || ""} onChange={e => updateServiceField(cs.id, "notes", e.target.value || null)} />
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tab 3: Audit Setup — only for audit clients */}
        {isAuditClient && <TabsContent value="audit">
          <Card>
            <CardHeader><CardTitle className="text-sm">Audit Configuration</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-4">
                <div className="flex items-center justify-between border border-border rounded-lg p-4">
                  <div>
                    <p className="text-sm font-medium">Statutory Audit Applicable</p>
                    <p className="text-xs text-muted-foreground">Companies Act 2013 requirements</p>
                  </div>
                  <Switch checked={auditForm.statutory_audit_applicable} onCheckedChange={v => setAuditForm(p => ({ ...p, statutory_audit_applicable: v }))} />
                </div>

                <div className="border border-border rounded-lg p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium">Tax Audit Applicable</p>
                      <p className="text-xs text-muted-foreground">Section 44AB — 3CA/3CB/3CD</p>
                    </div>
                    <Switch checked={!!auditForm.tax_audit_type} onCheckedChange={v => setAuditForm(p => ({ ...p, tax_audit_type: v ? "3CB-3CD" : "" }))} />
                  </div>
                  {auditForm.tax_audit_type && (
                    <Select value={auditForm.tax_audit_type} onValueChange={v => setAuditForm(p => ({ ...p, tax_audit_type: v }))}>
                      <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="3CA-3CD">3CA + 3CD (Company)</SelectItem>
                        <SelectItem value="3CB-3CD">3CB + 3CD (Non-Company)</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                </div>

                <div className="flex items-center justify-between border border-border rounded-lg p-4">
                  <div>
                    <p className="text-sm font-medium">CARO Applicable</p>
                    <p className="text-xs text-muted-foreground">Companies (Auditor's Report) Order</p>
                  </div>
                  <Switch checked={auditForm.caro_applicable} onCheckedChange={v => setAuditForm(p => ({ ...p, caro_applicable: v }))} />
                </div>

                <div className="flex items-center justify-between border border-border rounded-lg p-4">
                  <div>
                    <p className="text-sm font-medium">Internal Audit Applicable</p>
                    <p className="text-xs text-muted-foreground">Section 138 / voluntary</p>
                  </div>
                  <Switch checked={auditForm.internal_audit_applicable} onCheckedChange={v => setAuditForm(p => ({ ...p, internal_audit_applicable: v }))} />
                </div>

                <div className="flex items-center justify-between border border-border rounded-lg p-4">
                  <div>
                    <p className="text-sm font-medium">Stock Audit Applicable</p>
                    <p className="text-xs text-muted-foreground">Bank-mandated or voluntary</p>
                  </div>
                  <Switch checked={auditForm.stock_audit_applicable} onCheckedChange={v => setAuditForm(p => ({ ...p, stock_audit_applicable: v }))} />
                </div>
              </div>

              <Button onClick={saveAuditSetup} disabled={auditSaving} className="gap-2">
                {auditSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save Audit Setup
              </Button>
            </CardContent>
          </Card>
        </TabsContent>}

        {/* Tab 4: Work Groups */}
        <TabsContent value="groups">
          <div className="space-y-4">
            <Card>
              <CardHeader><CardTitle className="text-sm">Client Groups</CardTitle></CardHeader>
              <CardContent><ClientGroupsSection clientId={client.id} /></CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-sm">ITR Work Group</CardTitle></CardHeader>
              <CardContent>
                {clientItrProfile ? (
                  <div className="space-y-2">
                    <p className="text-sm"><span className="text-muted-foreground">Current Group:</span> <span className="font-medium">{itrWorkGroups.find(g => g.id === clientItrProfile.itr_work_group_id)?.name || "Unassigned"}</span></p>
                    <Select
                      value={clientItrProfile.itr_work_group_id || "__none__"}
                      onValueChange={async v => {
                        const val = v === "__none__" ? null : v;
                        await supabase.from("itr_profiles").update({ itr_work_group_id: val } as any).eq("id", clientItrProfile.id);
                        setClientItrProfile((p: any) => ({ ...p, itr_work_group_id: val }));
                        toast({ title: "Work group updated" });
                      }}
                    >
                      <SelectTrigger className="w-64"><SelectValue placeholder="Select work group" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">Unassigned</SelectItem>
                        {itrWorkGroups.map(g => <SelectItem key={g.id} value={g.id}>{g.code} — {g.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No ITR profile exists for this client. Create an ITR filing first.</p>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default ClientDetail;
