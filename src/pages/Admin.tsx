import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetFooter,
} from "@/components/ui/sheet";
import {
  Building2,
  Users,
  Briefcase,
  CreditCard,
  Plus,
  Pencil,
  UserCheck,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";

const VITE_SUPABASE_PROJECT_ID = import.meta.env.VITE_SUPABASE_PROJECT_ID;

async function callAdmin(action: string, method: "GET" | "POST" = "GET", body?: any, params?: Record<string, string>) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("Not authenticated");

  const url = new URL(`https://${VITE_SUPABASE_PROJECT_ID}.supabase.co/functions/v1/admin-platform`);
  url.searchParams.set("action", action);
  if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

  const res = await fetch(url.toString(), {
    method,
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      "Content-Type": "application/json",
      apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  if (res.status === 403) throw new Error("ACCESS_DENIED");
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Request failed");
  }
  return res.json();
}

interface Firm {
  id: string;
  name: string;
  plan: string | null;
  icai_reg_no: string | null;
  is_active: boolean | null;
  created_at: string | null;
  users_count: number;
  clients_count: number;
}

interface Stats {
  activeFirms: number;
  totalUsers: number;
  totalClients: number;
  activeSubscriptions: number;
}

interface LogEntry {
  id: string;
  operation: string | null;
  user_name: string | null;
  user_role: string | null;
  table_name: string | null;
  record_id: string | null;
  changed_fields: string[] | null;
  created_at: string | null;
}

const PLAN_COLORS: Record<string, string> = {
  starter: "bg-muted text-muted-foreground",
  pro: "bg-primary/10 text-primary",
  enterprise: "bg-sidebar-gold/20 text-sidebar-gold",
};

const OP_COLORS: Record<string, string> = {
  INSERT: "bg-emerald-100 text-emerald-700",
  UPDATE: "bg-sky-100 text-sky-700",
  DELETE: "bg-red-100 text-red-700",
  IMPERSONATE: "bg-amber-100 text-amber-700",
  RESTORE: "bg-purple-100 text-purple-700",
};

const Admin = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user, loading: authLoading } = useAuth();

  const [stats, setStats] = useState<Stats | null>(null);
  const [firms, setFirms] = useState<Firm[]>([]);
  const [loadingStats, setLoadingStats] = useState(true);
  const [loadingFirms, setLoadingFirms] = useState(true);

  // Add firm modal
  const [addOpen, setAddOpen] = useState(false);
  const [newFirm, setNewFirm] = useState({ name: "", icai_reg_no: "", plan: "starter" });
  const [adding, setAdding] = useState(false);

  // Edit firm sheet
  const [editOpen, setEditOpen] = useState(false);
  const [editFirm, setEditFirm] = useState<{ id: string; name: string; plan: string }>({ id: "", name: "", plan: "" });
  const [saving, setSaving] = useState(false);

  // Impersonate dialog
  const [impersonateOpen, setImpersonateOpen] = useState(false);
  const [impersonateFirm, setImpersonateFirm] = useState<Firm | null>(null);

  // Logs
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [logsTotal, setLogsTotal] = useState(0);
  const [logsPage, setLogsPage] = useState(1);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [logFilters, setLogFilters] = useState({
    user_name: "",
    table_name: "",
    operation: "",
    date_from: "",
    date_to: "",
  });

  // Auth guard
  useEffect(() => {
    if (!authLoading && (!user || user.role !== "superadmin")) {
      toast({ title: "Access Denied", description: "You do not have permission to access this page.", variant: "destructive" });
      navigate("/", { replace: true });
    }
  }, [authLoading, user, navigate, toast]);

  const fetchStats = useCallback(async () => {
    try {
      const data = await callAdmin("stats");
      setStats(data);
    } catch (e: any) {
      if (e.message === "ACCESS_DENIED") {
        toast({ title: "Access Denied", variant: "destructive" });
        navigate("/", { replace: true });
      }
    } finally {
      setLoadingStats(false);
    }
  }, [navigate, toast]);

  const fetchFirms = useCallback(async () => {
    try {
      const data = await callAdmin("firms");
      setFirms(data);
    } catch {
      // handled
    } finally {
      setLoadingFirms(false);
    }
  }, []);

  const fetchLogs = useCallback(async () => {
    setLoadingLogs(true);
    try {
      const params: Record<string, string> = { page: logsPage.toString() };
      if (logFilters.user_name) params.user_name = logFilters.user_name;
      if (logFilters.table_name) params.table_name = logFilters.table_name;
      if (logFilters.operation) params.operation = logFilters.operation;
      if (logFilters.date_from) params.date_from = logFilters.date_from;
      if (logFilters.date_to) params.date_to = logFilters.date_to;
      const res = await callAdmin("logs", "GET", undefined, params);
      setLogs(res.data || []);
      setLogsTotal(res.total || 0);
    } catch {
      // handled
    } finally {
      setLoadingLogs(false);
    }
  }, [logsPage, logFilters]);

  useEffect(() => {
    if (user?.role === "superadmin") {
      fetchStats();
      fetchFirms();
    }
  }, [user, fetchStats, fetchFirms]);

  useEffect(() => {
    if (user?.role === "superadmin") fetchLogs();
  }, [user, fetchLogs]);

  const handleAddFirm = async () => {
    if (!newFirm.name.trim()) return;
    setAdding(true);
    try {
      await callAdmin("add-firm", "POST", newFirm);
      toast({ title: "Firm added successfully" });
      setAddOpen(false);
      setNewFirm({ name: "", icai_reg_no: "", plan: "starter" });
      fetchFirms();
      fetchStats();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setAdding(false);
    }
  };

  const handleEditFirm = async () => {
    setSaving(true);
    try {
      await callAdmin("update-firm", "POST", editFirm);
      toast({ title: "Firm updated" });
      setEditOpen(false);
      fetchFirms();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (firm: Firm) => {
    try {
      await callAdmin("toggle-active", "POST", { id: firm.id, is_active: !firm.is_active });
      fetchFirms();
      fetchStats();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  };

  const handleImpersonate = async () => {
    if (!impersonateFirm) return;
    try {
      await callAdmin("impersonate", "POST", {
        firm_id: impersonateFirm.id,
        firm_name: impersonateFirm.name,
        superadmin_name: user?.name || "Superadmin",
      });
      // Store impersonated firm in sessionStorage
      sessionStorage.setItem("impersonated_firm_id", impersonateFirm.id);
      sessionStorage.setItem("impersonated_firm_name", impersonateFirm.name);
      toast({ title: `Now viewing as ${impersonateFirm.name}` });
      setImpersonateOpen(false);
      navigate("/");
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  };

  if (authLoading) {
    return <div className="p-6 space-y-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}</div>;
  }

  if (!user || user.role !== "superadmin") return null;

  const totalPages = Math.ceil(logsTotal / 25);

  const statCards = [
    { label: "Active Firms", value: stats?.activeFirms, icon: Building2 },
    { label: "Total Users", value: stats?.totalUsers, icon: Users },
    { label: "Total Clients", value: stats?.totalClients, icon: Briefcase },
    { label: "Active Subscriptions", value: stats?.activeSubscriptions, icon: CreditCard },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-display font-bold text-foreground">Superadmin Panel</h1>
          <p className="text-sm text-muted-foreground">Platform-wide management</p>
        </div>
        <Button onClick={() => setAddOpen(true)}>
          <Plus className="h-4 w-4 mr-1" /> Add Firm
        </Button>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map((s) =>
          loadingStats ? (
            <Card key={s.label}><CardContent className="p-5"><Skeleton className="h-4 w-24 mb-2" /><Skeleton className="h-8 w-16" /></CardContent></Card>
          ) : (
            <Card key={s.label}>
              <CardContent className="p-5">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm text-muted-foreground font-medium">{s.label}</p>
                  <s.icon className="h-4 w-4 text-muted-foreground" />
                </div>
                <p className="text-3xl font-display font-bold text-foreground">{s.value ?? 0}</p>
              </CardContent>
            </Card>
          )
        )}
      </div>

      <Tabs defaultValue="firms">
        <TabsList>
          <TabsTrigger value="firms">Firms Management</TabsTrigger>
          <TabsTrigger value="logs">System Logs</TabsTrigger>
        </TabsList>

        {/* FIRMS TAB */}
        <TabsContent value="firms">
          <Card>
            <CardContent className="p-0">
              {loadingFirms ? (
                <div className="p-6 space-y-3">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Firm Name</TableHead>
                      <TableHead>Plan</TableHead>
                      <TableHead>Users</TableHead>
                      <TableHead>Clients</TableHead>
                      <TableHead>Active</TableHead>
                      <TableHead>Created</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {firms.map((firm) => (
                      <TableRow key={firm.id}>
                        <TableCell className="font-medium">{firm.name}</TableCell>
                        <TableCell>
                          <Badge className={PLAN_COLORS[firm.plan || "starter"] || PLAN_COLORS.starter}>
                            {firm.plan || "starter"}
                          </Badge>
                        </TableCell>
                        <TableCell>{firm.users_count}</TableCell>
                        <TableCell>{firm.clients_count}</TableCell>
                        <TableCell>
                          <Switch checked={!!firm.is_active} onCheckedChange={() => handleToggleActive(firm)} />
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {firm.created_at ? format(new Date(firm.created_at), "dd MMM yyyy") : "—"}
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                setEditFirm({ id: firm.id, name: firm.name, plan: firm.plan || "starter" });
                                setEditOpen(true);
                              }}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => { setImpersonateFirm(firm); setImpersonateOpen(true); }}
                            >
                              <UserCheck className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                    {firms.length === 0 && (
                      <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No firms found</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* LOGS TAB */}
        <TabsContent value="logs">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">System Logs</CardTitle>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mt-3">
                <Input placeholder="User name..." value={logFilters.user_name} onChange={(e) => setLogFilters((f) => ({ ...f, user_name: e.target.value }))} />
                <Input placeholder="Table name..." value={logFilters.table_name} onChange={(e) => setLogFilters((f) => ({ ...f, table_name: e.target.value }))} />
                <Select value={logFilters.operation} onValueChange={(v) => setLogFilters((f) => ({ ...f, operation: v === "all" ? "" : v }))}>
                  <SelectTrigger><SelectValue placeholder="Operation" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="INSERT">INSERT</SelectItem>
                    <SelectItem value="UPDATE">UPDATE</SelectItem>
                    <SelectItem value="DELETE">DELETE</SelectItem>
                    <SelectItem value="IMPERSONATE">IMPERSONATE</SelectItem>
                    <SelectItem value="RESTORE">RESTORE</SelectItem>
                  </SelectContent>
                </Select>
                <Input type="date" value={logFilters.date_from} onChange={(e) => setLogFilters((f) => ({ ...f, date_from: e.target.value }))} />
                <Input type="date" value={logFilters.date_to} onChange={(e) => setLogFilters((f) => ({ ...f, date_to: e.target.value }))} />
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {loadingLogs ? (
                <div className="p-6 space-y-3">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
              ) : (
                <>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>User</TableHead>
                        <TableHead>Role</TableHead>
                        <TableHead>Table</TableHead>
                        <TableHead>Operation</TableHead>
                        <TableHead>Changed Fields</TableHead>
                        <TableHead>Time</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {logs.map((log) => (
                        <TableRow key={log.id}>
                          <TableCell className="font-medium">{log.user_name || "—"}</TableCell>
                          <TableCell>
                            {log.user_role ? <Badge variant="outline" className="text-[10px]">{log.user_role}</Badge> : "—"}
                          </TableCell>
                          <TableCell className="font-mono text-xs">{log.table_name || "—"}</TableCell>
                          <TableCell>
                            <span className={`text-[11px] font-medium px-2 py-0.5 rounded ${OP_COLORS[log.operation || ""] || "bg-muted text-muted-foreground"}`}>
                              {log.operation}
                            </span>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate">
                            {log.changed_fields?.join(", ") || "—"}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                            {log.created_at ? formatDistanceToNow(new Date(log.created_at), { addSuffix: true }) : "—"}
                          </TableCell>
                        </TableRow>
                      ))}
                      {logs.length === 0 && (
                        <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">No logs found</TableCell></TableRow>
                      )}
                    </TableBody>
                  </Table>
                  {totalPages > 1 && (
                    <div className="flex items-center justify-between p-4 border-t">
                      <p className="text-sm text-muted-foreground">Page {logsPage} of {totalPages} ({logsTotal} total)</p>
                      <div className="flex gap-1">
                        <Button size="sm" variant="outline" disabled={logsPage <= 1} onClick={() => setLogsPage((p) => p - 1)}>
                          <ChevronLeft className="h-4 w-4" />
                        </Button>
                        <Button size="sm" variant="outline" disabled={logsPage >= totalPages} onClick={() => setLogsPage((p) => p + 1)}>
                          <ChevronRight className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Add Firm Modal */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add New Firm</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label className="text-sm font-medium">Firm Name *</label>
              <Input value={newFirm.name} onChange={(e) => setNewFirm((f) => ({ ...f, name: e.target.value }))} />
            </div>
            <div>
              <label className="text-sm font-medium">ICAI Registration No</label>
              <Input value={newFirm.icai_reg_no} onChange={(e) => setNewFirm((f) => ({ ...f, icai_reg_no: e.target.value }))} />
            </div>
            <div>
              <label className="text-sm font-medium">Plan</label>
              <Select value={newFirm.plan} onValueChange={(v) => setNewFirm((f) => ({ ...f, plan: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="starter">Starter</SelectItem>
                  <SelectItem value="pro">Pro</SelectItem>
                  <SelectItem value="enterprise">Enterprise</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button onClick={handleAddFirm} disabled={adding || !newFirm.name.trim()}>
              {adding ? "Adding..." : "Add Firm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Firm Sheet */}
      <Sheet open={editOpen} onOpenChange={setEditOpen}>
        <SheetContent>
          <SheetHeader><SheetTitle>Edit Firm</SheetTitle></SheetHeader>
          <div className="space-y-4 py-6">
            <div>
              <label className="text-sm font-medium">Firm Name</label>
              <Input value={editFirm.name} onChange={(e) => setEditFirm((f) => ({ ...f, name: e.target.value }))} />
            </div>
            <div>
              <label className="text-sm font-medium">Plan</label>
              <Select value={editFirm.plan} onValueChange={(v) => setEditFirm((f) => ({ ...f, plan: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="starter">Starter</SelectItem>
                  <SelectItem value="pro">Pro</SelectItem>
                  <SelectItem value="enterprise">Enterprise</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <SheetFooter>
            <Button onClick={handleEditFirm} disabled={saving}>
              {saving ? "Saving..." : "Save Changes"}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* Impersonate Confirmation */}
      <Dialog open={impersonateOpen} onOpenChange={setImpersonateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Impersonation</DialogTitle>
            <DialogDescription>
              You are about to impersonate <strong>{impersonateFirm?.name}</strong>. This action will be logged.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setImpersonateOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleImpersonate}>Confirm Impersonate</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Admin;
