import { useState, useEffect, useCallback } from "react";
import { useNavigate, Navigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Users,
  Receipt,
  FileText,
  Search,
  ArrowRight,
  Plus,
  Clock,
} from "lucide-react";
import { formatDistanceToNow, startOfMonth, endOfMonth } from "date-fns";

const ROLE_GREETINGS: Record<string, string> = {
  partner_ca: "Partner Dashboard",
  manager: "Manager Dashboard",
  staff_article: "My Tasks",
  firm_admin: "Firm Overview",
  superadmin: "Admin Dashboard",
};

const OP_COLORS: Record<string, string> = {
  INSERT: "bg-emerald-100 text-emerald-700 border-emerald-200",
  UPDATE: "bg-sky-100 text-sky-700 border-sky-200",
  DELETE: "bg-red-100 text-red-700 border-red-200",
};

interface DashboardStats {
  activeClients: number;
  tdsDue: number;
  itrPending: number;
  openAudits: number;
}

interface DueItem {
  client: string;
  due: Date;
  type: string;
}

interface ActivityItem {
  user: string;
  role: string;
  table: string;
  op: string;
  at: Date;
}

function daysUntil(date: Date) {
  return Math.max(0, Math.ceil((date.getTime() - Date.now()) / 86400000));
}

const Index = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<DashboardStats>({ activeClients: 0, tdsDue: 0, itrPending: 0, openAudits: 0 });
  const [dueItems, setDueItems] = useState<DueItem[]>([]);
  const [activity, setActivity] = useState<ActivityItem[]>([]);

  const fetchDashboard = useCallback(async () => {
    if (!user) {
      setLoading(false);
      return;
    }

    if (user.role !== "superadmin" && !user.firm_id) {
      setLoading(false);
      return;
    }

    const now = new Date();
    const monthStart = startOfMonth(now).toISOString().split("T")[0];
    const monthEnd = endOfMonth(now).toISOString().split("T")[0];


    const [clientsRes, tdsRes, itrRes, auditsRes, dueRes, activityRes] = await Promise.all([
      supabase.from("clients").select("*", { count: "exact", head: true }),
      supabase.from("tds_entries").select("*", { count: "exact", head: true })
        .gte("due_date", monthStart).lte("due_date", monthEnd).is("challan_no", null),
      supabase.from("itr_profiles").select("*", { count: "exact", head: true })
        .neq("filing_status", "filed"),
      supabase.from("audit_engagements").select("*", { count: "exact", head: true })
        .neq("status", "completed"),
      // Due this week: TDS entries due in next 7 days
      supabase.from("tds_entries").select("party_name, due_date")
        .gte("due_date", now.toISOString().split("T")[0])
        .lte("due_date", new Date(Date.now() + 7 * 86400000).toISOString().split("T")[0])
        .is("challan_no", null)
        .order("due_date", { ascending: true })
        .limit(5),
      // Recent activity from version_history
      supabase.from("version_history").select("user_name, user_role, table_name, operation, created_at")
        .order("created_at", { ascending: false })
        .limit(10),
    ]);

    setStats({
      activeClients: clientsRes.count ?? 0,
      tdsDue: tdsRes.count ?? 0,
      itrPending: itrRes.count ?? 0,
      openAudits: auditsRes.count ?? 0,
    });

    setDueItems(
      (dueRes.data || []).map((d: any) => ({
        client: d.party_name || "Unknown",
        due: new Date(d.due_date),
        type: "TDS",
      }))
    );

    setActivity(
      (activityRes.data || []).map((a: any) => ({
        user: a.user_name || "System",
        role: a.user_role || "unknown",
        table: a.table_name || "",
        op: a.operation || "",
        at: new Date(a.created_at),
      }))
    );

    setLoading(false);
  }, [user?.firm_id]);

  useEffect(() => {
    if (user) fetchDashboard();
  }, [user, fetchDashboard]);

  // Superadmin can access dashboard too — no redirect
  const userRole = user?.role || "staff_article";
  const greeting = ROLE_GREETINGS[userRole] || "Dashboard";
  const userName = user?.name || user?.email || "there";

  const statCards = [
    { label: "Active Clients", value: stats.activeClients, icon: Users },
    { label: "TDS Due This Month", value: stats.tdsDue, icon: Receipt },
    { label: "ITR Pending", value: stats.itrPending, icon: FileText },
    { label: "Open Audits", value: stats.openAudits, icon: Search },
  ];

  const quickActions = [
    { label: "Add New Client", path: "/clients", icon: Plus },
    { label: "New TDS Entry", path: "/tds-filings", icon: Plus },
    { label: "Run Scrutiny", path: "/audit-intelligence", icon: Search },
    { label: "New Audit Engagement", path: "/audit-intelligence", icon: Plus },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-display font-bold text-foreground">{greeting}</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Welcome back, {userName}. Here's your practice overview.
        </p>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map((stat) =>
          loading ? (
            <Card key={stat.label}>
              <CardContent className="p-5 space-y-3">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-8 w-16" />
              </CardContent>
            </Card>
          ) : (
            <Card key={stat.label} className="group hover:shadow-md transition-shadow">
              <CardContent className="p-5">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm text-muted-foreground font-medium">{stat.label}</p>
                  <stat.icon className="h-4 w-4 text-muted-foreground" />
                </div>
                <p className="text-3xl font-display font-bold text-foreground">{stat.value}</p>
              </CardContent>
            </Card>
          )
        )}
      </div>

      {/* Two-column section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Due This Week */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-display flex items-center gap-2">
              <Clock className="h-4 w-4 text-primary" />
              Due This Week
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            {loading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 py-3">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-5 w-12" />
                  <Skeleton className="ml-auto h-4 w-16" />
                </div>
              ))
            ) : dueItems.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4">No upcoming items due this week.</p>
            ) : (
              dueItems.map((item, i) => {
                const days = daysUntil(item.due);
                return (
                  <div key={i} className="flex items-center justify-between py-3 border-b border-border last:border-0">
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-medium text-foreground">{item.client}</span>
                      <Badge variant="default" className="text-[10px] px-1.5 py-0">{item.type}</Badge>
                    </div>
                    <span className={`text-xs font-semibold ${days <= 2 ? "text-red-600" : "text-muted-foreground"}`}>
                      {days === 0 ? "Today" : days === 1 ? "Tomorrow" : `${days} days`}
                    </span>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>

        {/* Recent Activity */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-display flex items-center gap-2">
              <ArrowRight className="h-4 w-4 text-primary" />
              Recent Activity
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 py-3">
                  <Skeleton className="h-4 w-20" />
                  <Skeleton className="h-5 w-14" />
                  <Skeleton className="ml-auto h-4 w-24" />
                </div>
              ))
            ) : activity.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4">No recent activity.</p>
            ) : (
              activity.map((item, i) => (
                <div key={i} className="flex items-center justify-between py-3 border-b border-border last:border-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-sm font-medium text-foreground whitespace-nowrap">{item.user}</span>
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 shrink-0">{item.role}</Badge>
                    <span className="text-xs text-muted-foreground truncate">
                      <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium border ${OP_COLORS[item.op] || ""}`}>
                        {item.op}
                      </span>{" "}on <span className="font-mono">{item.table}</span>
                    </span>
                  </div>
                  <span className="text-xs text-muted-foreground whitespace-nowrap ml-2">
                    {formatDistanceToNow(item.at, { addSuffix: true })}
                  </span>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      {/* Quick Actions */}
      <Card>
        <CardContent className="p-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {quickActions.map((action) => (
              <Button
                key={action.label}
                variant="outline"
                className="h-auto py-3 flex-col gap-1.5 text-sm font-medium"
                onClick={() => navigate(action.path)}
              >
                <action.icon className="h-4 w-4" />
                {action.label}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default Index;
