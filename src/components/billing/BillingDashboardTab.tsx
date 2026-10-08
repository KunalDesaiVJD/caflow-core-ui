import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from "recharts";
import { format, differenceInDays, startOfMonth, endOfMonth } from "date-fns";
import { cn } from "@/lib/utils";

interface DashInvoice {
  id: string;
  invoice_no: string | null;
  client_id: string | null;
  firm_id: string | null;
  amount: number | null;
  total_amount: number | null;
  amount_due: number | null;
  payment_status: string | null;
  status: string | null;
  due_date: string | null;
  invoice_date: string | null;
  paid_at: string | null;
  document_type?: string | null;
}

interface ClientInfo { id: string; name: string; }

function fmtMoney(n: number) {
  if (n >= 1_00_00_000) return `₹${(n / 1_00_00_000).toFixed(1)}Cr`;
  if (n >= 1_00_000) return `₹${(n / 1_00_000).toFixed(1)}L`;
  if (n >= 1_000) return `₹${(n / 1_000).toFixed(0)}K`;
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}

const STATUS_COLORS: Record<string, string> = {
  paid: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  draft: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
  sent: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  finalized: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  overdue: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  voided: "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-500",
};

const CHART_COLORS = ["#1a3a5c", "#0891b2", "#7c3aed", "#ea580c", "#16a34a"];

export default function BillingDashboardTab({ firmId }: { firmId: string | null }) {
  const { user } = useAuth();
  const isSuperadmin = user?.role === "superadmin";
  const resolvedFirmId = firmId ?? user?.firm_id ?? null;

  const [invoices, setInvoices] = useState<DashInvoice[]>([]);
  const [clients, setClients] = useState<ClientInfo[]>([]);
  const [timesheets, setTimesheets] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      // C9: page past PostgREST's 1000-row cap so headline totals are complete
      // for large firms. M1: always firm-scope when a firm is selected — including
      // a superadmin viewing one specific firm (previously skipped, mixing firms).
      const cols = "id,invoice_no,client_id,firm_id,amount,total_amount,amount_due,payment_status,status,due_date,invoice_date,paid_at,document_type";
      const allInv: DashInvoice[] = [];
      const PAGE = 1000;
      for (let from = 0; ; from += PAGE) {
        let iq = supabase.from("invoices").select(cols)
          .order("invoice_date", { ascending: false })
          .range(from, from + PAGE - 1);
        if (resolvedFirmId) iq = iq.eq("firm_id", resolvedFirmId);
        const { data: page } = await iq;
        if (!page || page.length === 0) break;
        allInv.push(...(page as DashInvoice[]));
        if (page.length < PAGE) break;
      }

      let cq = supabase.from("clients").select("id,name").eq("is_draft", false).is("deleted_at", null).neq("is_active", false);
      if (resolvedFirmId) cq = (cq as any).eq("firm_id", resolvedFirmId);
      const { data: cData } = await cq;

      let tq = supabase.from("timesheets").select("user_id,hours,billable,is_billable").limit(500);
      if (!isSuperadmin) tq = tq.eq("user_id", user?.id ?? "");
      const { data: tsData } = await tq;

      let uq = supabase.from("users").select("id,name").eq("is_active", true);
      if (resolvedFirmId) uq = uq.eq("firm_id", resolvedFirmId);
      const { data: uData } = await uq;

      setInvoices(allInv);
      setClients((cData as ClientInfo[]) || []);
      setTimesheets(tsData || []);
      setUsers(uData || []);
      setLoading(false);
    })();
  }, [resolvedFirmId, isSuperadmin, user?.id]);

  const today = new Date();
  const monthStart = startOfMonth(today);
  const monthEnd = endOfMonth(today);

  const totalRevenue = useMemo(
    () => invoices.filter(i => i.status === "paid").reduce((s, i) => s + (i.total_amount || i.amount || 0), 0),
    [invoices],
  );
  // Outstanding / overdue use amount_due (net of receipts + TDS + GST-TDS) so
  // partial payments are reflected, and count only real invoices (not
  // quotations / credit notes). Fully-paid invoices have amount_due = 0.
  const isOpenInvoice = (i: DashInvoice) =>
    (i.document_type ?? "invoice") === "invoice" && !["voided","draft"].includes(i.status || "");
  const dueOf = (i: DashInvoice) => i.amount_due ?? i.total_amount ?? i.amount ?? 0;
  const outstanding = useMemo(
    () => invoices.filter(isOpenInvoice).reduce((s, i) => s + Math.max(0, dueOf(i)), 0),
    [invoices],
  );
  const overdue = useMemo(
    () => invoices.filter(i =>
      isOpenInvoice(i) && i.due_date && new Date(i.due_date) < today,
    ).reduce((s, i) => s + Math.max(0, dueOf(i)), 0),
    [invoices],
  );
  const paidThisMonth = useMemo(
    () => invoices.filter(i =>
      i.status === "paid" && i.paid_at &&
      new Date(i.paid_at) >= monthStart && new Date(i.paid_at) <= monthEnd,
    ).reduce((s, i) => s + (i.total_amount || i.amount || 0), 0),
    [invoices, monthStart, monthEnd],
  );

  const statusCounts = useMemo(() => {
    const map: Record<string, number> = {};
    invoices.forEach(i => { const s = i.status || "draft"; map[s] = (map[s] || 0) + 1; });
    return map;
  }, [invoices]);

  const revenueByMonth = useMemo(() => {
    const map: Record<string, number> = {};
    invoices.filter(i => i.status === "paid").forEach(i => {
      const d = i.paid_at || i.invoice_date;
      if (!d) return;
      // Key by yyyy-MM so months sort chronologically; label only at the end.
      const key = format(new Date(d), "yyyy-MM");
      map[key] = (map[key] || 0) + (i.total_amount || i.amount || 0);
    });
    const sorted = Object.entries(map).sort(([a], [b]) => a.localeCompare(b));
    return sorted.slice(-12).map(([key, revenue]) => ({ name: format(new Date(`${key}-01T00:00:00`), "MMM yy"), revenue }));
  }, [invoices]);

  const aging = useMemo(() => {
    const buckets: Record<string, number> = { "0-30 Days": 0, "31-60 Days": 0, "61-90 Days": 0, "90+ Days": 0 };
    invoices.filter(i => isOpenInvoice(i) && i.due_date).forEach(i => {
      const days = differenceInDays(today, new Date(i.due_date!));
      const amt = Math.max(0, dueOf(i));
      if (amt <= 0) return;
      if (days <= 30) buckets["0-30 Days"] += amt;
      else if (days <= 60) buckets["31-60 Days"] += amt;
      else if (days <= 90) buckets["61-90 Days"] += amt;
      else buckets["90+ Days"] += amt;
    });
    return Object.entries(buckets).filter(([, v]) => v > 0).map(([name, amount]) => ({ name, amount }));
  }, [invoices]);

  const statusPieData = useMemo(() =>
    Object.entries(statusCounts).map(([name, count]) => ({ name: name.charAt(0).toUpperCase() + name.slice(1), count })),
    [statusCounts],
  );

  const topClients = useMemo(() => {
    const map: Record<string, number> = {};
    invoices.filter(i => i.status === "paid").forEach(i => {
      if (!i.client_id) return;
      map[i.client_id] = (map[i.client_id] || 0) + (i.total_amount || i.amount || 0);
    });
    return Object.entries(map)
      .sort((a, b) => b[1] - a[1]).slice(0, 5)
      .map(([cid, revenue]) => ({
        name: clients.find(c => c.id === cid)?.name || "Unknown",
        revenue,
      }));
  }, [invoices, clients]);

  const recentInvoices = useMemo(() => invoices.slice(0, 8), [invoices]);

  const staffUtil = useMemo(() => {
    const map: Record<string, { total: number; billable: number }> = {};
    timesheets.forEach((t: any) => {
      const uid = t.user_id || "unknown";
      if (!map[uid]) map[uid] = { total: 0, billable: 0 };
      map[uid].total += t.hours || 0;
      if (t.billable || t.is_billable) map[uid].billable += t.hours || 0;
    });
    return Object.entries(map).map(([uid, data]) => ({
      name: users.find((u: any) => u.id === uid)?.name || "Unknown",
      total: data.total,
      billable: data.billable,
      utilization: data.total > 0 ? Math.round((data.billable / data.total) * 100) : 0,
    })).sort((a, b) => b.utilization - a.utilization).slice(0, 5);
  }, [timesheets, users]);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[1,2,3,4].map(i => <div key={i} className="h-28 rounded-xl bg-muted animate-pulse" />)}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="h-64 rounded-xl bg-muted animate-pulse" />
          <div className="h-64 rounded-xl bg-muted animate-pulse" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Page Title */}
      <div>
        <h2 className="text-lg font-semibold">Billing Dashboard</h2>
        <p className="text-sm text-muted-foreground">Overview of your billing activity, revenue, and outstanding payments.</p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="border-l-4 border-l-primary">
          <CardContent className="pt-4 pb-3 px-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Total Revenue</p>
            <p className="text-2xl font-bold mt-1 text-primary">{fmtMoney(totalRevenue)}</p>
            <p className="text-xs text-muted-foreground mt-1">{invoices.filter(i => i.status === "paid").length} paid invoices</p>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-amber-500">
          <CardContent className="pt-4 pb-3 px-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Outstanding</p>
            <p className="text-2xl font-bold mt-1 text-amber-600">{fmtMoney(outstanding)}</p>
            <p className="text-xs text-muted-foreground mt-1">
              {invoices.filter(i => isOpenInvoice(i) && dueOf(i) > 0).length} pending
            </p>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-red-500">
          <CardContent className="pt-4 pb-3 px-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Overdue</p>
            <p className="text-2xl font-bold mt-1 text-red-600">{fmtMoney(overdue)}</p>
            <p className="text-xs text-muted-foreground mt-1">
              {invoices.filter(i => !["paid","voided","draft"].includes(i.status||"") && i.due_date && new Date(i.due_date) < today).length} overdue
            </p>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-emerald-500">
          <CardContent className="pt-4 pb-3 px-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Paid This Month</p>
            <p className="text-2xl font-bold mt-1 text-emerald-600">{fmtMoney(paidThisMonth)}</p>
            <p className="text-xs text-muted-foreground mt-1">{format(today, "MMMM yyyy")}</p>
          </CardContent>
        </Card>
      </div>

      {/* Status Summary Pills */}
      <div className="flex flex-wrap gap-2">
        <span className="text-xs text-muted-foreground self-center font-medium">Document Status:</span>
        {Object.entries(statusCounts).map(([status, count]) => (
          <Badge key={status} variant="outline" className={cn("capitalize text-xs px-3 py-1", STATUS_COLORS[status] || "")}>
            {status}: {count}
          </Badge>
        ))}
        <Badge variant="outline" className="text-xs px-3 py-1 bg-muted">
          Total: {invoices.length}
        </Badge>
      </div>

      {/* Charts Row 1 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Revenue by Month (Paid Invoices)</CardTitle>
          </CardHeader>
          <CardContent>
            {revenueByMonth.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">No paid invoices yet</p>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={revenueByMonth} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={v => fmtMoney(v).replace("₹", "")} />
                  <Tooltip formatter={(v: number) => [fmtMoney(v), "Revenue"]} />
                  <Bar dataKey="revenue" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Outstanding Aging Analysis</CardTitle>
          </CardHeader>
          <CardContent>
            {aging.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">No outstanding invoices 🎉</p>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie
                    data={aging}
                    dataKey="amount"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    outerRadius={80}
                    label={({ name, percent }) => `${(percent * 100).toFixed(0)}%`}
                  >
                    {aging.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                  </Pie>
                  <Tooltip formatter={(v: number) => fmtMoney(v)} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Charts Row 2 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Invoice Status Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            {statusPieData.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">No data</p>
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie
                    data={statusPieData}
                    dataKey="count"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    outerRadius={70}
                    label={({ name, count }) => `${name}: ${count}`}
                  >
                    {statusPieData.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Top 5 Clients by Revenue</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {topClients.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center px-4">No revenue data yet</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8">#</TableHead>
                    <TableHead>Client</TableHead>
                    <TableHead className="text-right">Revenue</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {topClients.map((c, i) => (
                    <TableRow key={i}>
                      <TableCell className="text-muted-foreground text-xs font-medium">{i + 1}</TableCell>
                      <TableCell className="font-medium text-sm">{c.name}</TableCell>
                      <TableCell className="text-right font-semibold text-sm text-primary">{fmtMoney(c.revenue)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Bottom Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Invoices */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Recent Invoices</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Invoice #</TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentInvoices.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground py-8">No invoices yet</TableCell>
                  </TableRow>
                ) : recentInvoices.map(inv => (
                  <TableRow key={inv.id}>
                    <TableCell className="font-medium text-sm">{inv.invoice_no || "—"}</TableCell>
                    <TableCell className="text-sm truncate max-w-[120px]">{clients.find(c => c.id === inv.client_id)?.name || "—"}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={cn("capitalize text-xs", STATUS_COLORS[inv.status || "draft"] || "")}>
                        {inv.status || "draft"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-semibold text-sm">{fmtMoney(inv.total_amount || inv.amount || 0)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Staff Utilization */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Staff Utilization</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {staffUtil.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center px-4">No timesheet data yet</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Staff</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="text-right">Billable</TableHead>
                    <TableHead className="text-right">Util%</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {staffUtil.map((s, i) => (
                    <TableRow key={i}>
                      <TableCell className="font-medium text-sm">{s.name}</TableCell>
                      <TableCell className="text-right text-sm">{s.total}h</TableCell>
                      <TableCell className="text-right text-sm">{s.billable}h</TableCell>
                      <TableCell className="text-right">
                        <Badge variant="outline" className={cn("text-xs",
                          s.utilization >= 70 ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" :
                          s.utilization >= 40 ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" :
                          "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                        )}>{s.utilization}%</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
