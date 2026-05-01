import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
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
  Plus,
  Clock,
  CalendarDays,
  Bell,
  X,
} from "lucide-react";
import { startOfMonth, endOfMonth } from "date-fns";

const ROLE_GREETINGS: Record<string, string> = {
  partner_ca: "Partner Dashboard",
  manager: "Manager Dashboard",
  staff_article: "My Tasks",
  firm_admin: "Firm Overview",
  superadmin: "Admin Dashboard",
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

interface UserNotification {
  id:         string;
  type:       string;
  title:      string;
  message:    string;
  link:       string | null;
  is_read:    boolean;
  created_at: string;
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
  const [auditReminders, setAuditReminders] = useState<Array<{
    id:             string;
    client_name:    string | null;
    planned_from:   string;
    planned_to:     string;
    employee_names: string[] | null;
  }>>([]);
  const [notifications, setNotifications] = useState<UserNotification[]>([]);

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


    const firmId = user.firm_id;
    const isSuperadmin = user.role === "superadmin";

    let clientsQ = supabase.from("clients").select("*", { count: "exact", head: true }).eq("is_draft", false).is("deleted_at", null);
    if (!isSuperadmin && firmId) clientsQ = clientsQ.eq("firm_id", firmId);

    let tdsQ = supabase.from("tds_entries").select("*", { count: "exact", head: true })
      .gte("due_date", monthStart).lte("due_date", monthEnd).is("challan_no", null);
    if (!isSuperadmin && firmId) tdsQ = tdsQ.eq("firm_id", firmId);

    let itrQ = supabase.from("itr_profiles").select("*", { count: "exact", head: true })
      .neq("filing_status", "filed");
    if (!isSuperadmin && firmId) itrQ = itrQ.eq("firm_id", firmId);

    let auditsQ = supabase.from("audit_engagements").select("*", { count: "exact", head: true })
      .neq("status", "completed");
    if (!isSuperadmin && firmId) auditsQ = auditsQ.eq("firm_id", firmId);

    let dueQ = supabase.from("tds_entries").select("party_name, due_date")
      .gte("due_date", now.toISOString().split("T")[0])
      .lte("due_date", new Date(Date.now() + 7 * 86400000).toISOString().split("T")[0])
      .is("challan_no", null)
      .order("due_date", { ascending: true })
      .limit(5);
    if (!isSuperadmin && firmId) dueQ = dueQ.eq("firm_id", firmId);

    // Audit planning reminders — entries where this user is an employee and audit hasn't ended yet
    const today = now.toISOString().split("T")[0];
    // Issue 3: leaves are personal time-off, not audit reminders. Filter them
    // out at DB-level (`is_leave=false` OR null for any pre-migration row).
    let auditReminderQ = supabase
      .from("audit_planning")
      .select("*")
      .contains("employee_ids", [user.id])
      .gte("planned_to", today)
      .or("is_leave.is.null,is_leave.eq.false")
      .order("planned_from", { ascending: true })
      .limit(5);

    // User notifications — unread, most recent first
    const notifQ = supabase
      .from("user_notifications")
      .select("id, type, title, message, link, is_read, created_at")
      .eq("user_id", user.id)
      .eq("is_read", false)
      .order("created_at", { ascending: false })
      .limit(10);

    try {
      const [clientsRes, tdsRes, itrRes, auditsRes, dueRes, auditReminderRes, notifRes] = await Promise.all([
        clientsQ, tdsQ, itrQ, auditsQ, dueQ, auditReminderQ, notifQ,
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

      setAuditReminders(
        (auditReminderRes.data || []).map((r: any) => ({
          id:             r.id,
          client_name:    r.client_name    || "Unknown Client",
          planned_from:   r.planned_from,
          planned_to:     r.planned_to,
          employee_names: r.employee_names || null,
        }))
      );

      // Notifications — silently ignore if table doesn't exist yet
      if (!notifRes.error && notifRes.data) {
        setNotifications(notifRes.data as UserNotification[]);
      }
    } catch (err) {
      console.error("Dashboard fetch error:", err);
    } finally {
      setLoading(false);
    }
  }, [user?.firm_id, user?.role]);

  useEffect(() => {
    if (user) fetchDashboard();
  }, [user, fetchDashboard]);

  const dismissNotification = async (id: string, link?: string | null) => {
    // Optimistically remove from UI
    setNotifications((prev) => prev.filter((n) => n.id !== id));
    // Mark as read in DB (best-effort)
    try {
      await supabase.from("user_notifications").update({ is_read: true }).eq("id", id);
    } catch { /* ignore if table absent */ }
    if (link) navigate(link);
  };

  const dismissAllNotifications = async () => {
    const ids = notifications.map((n) => n.id);
    setNotifications([]);
    try {
      await supabase.from("user_notifications").update({ is_read: true }).in("id", ids);
    } catch { /* ignore */ }
  };

  // Superadmin can access dashboard too — no redirect
  const userRole = user?.role || "staff_article";
  const greeting = ROLE_GREETINGS[userRole] || "Dashboard";
  const welcomeLine = userRole === "superadmin" ? "Welcome Admin" : `Welcome back, ${user?.name || user?.email || "there"}. Here's your practice overview.`;

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
          {welcomeLine}
        </p>
      </div>

      {/* Notification Banner */}
      {notifications.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-medium text-indigo-700">
              <Bell className="h-4 w-4" />
              <span>Notifications</span>
              <span className="inline-flex items-center justify-center rounded-full bg-indigo-600 text-white text-[10px] font-bold h-4 min-w-4 px-1">
                {notifications.length}
              </span>
            </div>
            <button
              onClick={dismissAllNotifications}
              className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2 transition-colors"
            >
              Mark all as read
            </button>
          </div>
          <div className="space-y-2">
            {notifications.map((n) => (
              <div
                key={n.id}
                className="flex items-start gap-3 rounded-lg border border-indigo-100 bg-indigo-50 px-4 py-3 cursor-pointer hover:bg-indigo-100 transition-colors"
                onClick={() => dismissNotification(n.id, n.link)}
              >
                <Bell className="h-4 w-4 text-indigo-500 mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-indigo-800 leading-snug">{n.title}</p>
                  <p className="text-xs text-indigo-700 mt-0.5 leading-snug">{n.message}</p>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); dismissNotification(n.id); }}
                  className="shrink-0 text-indigo-400 hover:text-indigo-700 transition-colors mt-0.5"
                  title="Dismiss"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

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

      {/* Due This Week */}
      <div className="grid grid-cols-1 gap-6">
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
      </div>

      {/* Audit Planning Reminders */}
      {(loading || auditReminders.length > 0) && (
        <div className="grid grid-cols-1 gap-6">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-display flex items-center gap-2">
                <CalendarDays className="h-4 w-4 text-indigo-500" />
                Upcoming Audits
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1">
              {loading ? (
                Array.from({ length: 2 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-3 py-3">
                    <Skeleton className="h-4 w-56" />
                  </div>
                ))
              ) : (
                auditReminders.map((r) => (
                  <div
                    key={r.id}
                    className="flex items-start justify-between py-3 border-b border-border last:border-0 cursor-pointer hover:bg-muted/30 rounded px-1 -mx-1 transition-colors gap-3"
                    onClick={() => navigate("/audit/tracker")}
                  >
                    <div className="space-y-1 min-w-0">
                      <p className="text-sm text-foreground">
                        You need to go for audit to{" "}
                        <span className="font-semibold text-indigo-700">{r.client_name}</span>
                        {" "}from{" "}
                        <span className="font-medium">{r.planned_from}</span>
                        {" "}to{" "}
                        <span className="font-medium">{r.planned_to}</span>
                      </p>
                      {r.employee_names && r.employee_names.length > 0 && (
                        <p className="text-xs text-muted-foreground truncate">
                          👥 {r.employee_names.join(", ")}
                        </p>
                      )}
                    </div>
                    <Badge className="text-[10px] px-1.5 bg-indigo-100 text-indigo-700 shrink-0 mt-0.5">
                      Audit
                    </Badge>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      )}

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
