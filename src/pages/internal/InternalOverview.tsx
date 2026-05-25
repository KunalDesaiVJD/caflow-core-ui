import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import {
  Building2, ClipboardList, HeadphonesIcon, CheckCircle2,
  Clock, AlertTriangle, TrendingUp,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";

interface OnboardingRow {
  id: string;
  firm_id: string;
  firm_name: string;
  plan_tier: string;
  status: string;
  progress_pct: number;
  assigned_ie_name: string | null;
  created_at: string;
}

interface TicketRow {
  id: string;
  firm_name: string;
  subject: string;
  priority: string;
  status: string;
  created_at: string;
}

const STATUS_COLOR: Record<string, string> = {
  pending:     "bg-yellow-100 text-yellow-800",
  in_progress: "bg-blue-100 text-blue-800",
  completed:   "bg-green-100 text-green-800",
};

const PRIORITY_COLOR: Record<string, string> = {
  low:    "bg-muted text-muted-foreground",
  normal: "bg-blue-100 text-blue-800",
  high:   "bg-orange-100 text-orange-800",
  urgent: "bg-red-100 text-red-800",
};

const PLAN_COLOR: Record<string, string> = {
  solo:       "bg-muted text-muted-foreground",
  studio:     "bg-blue-100 text-blue-800",
  firm:       "bg-purple-100 text-purple-800",
  enterprise: "bg-amber-100 text-amber-800",
};

export default function InternalOverview() {
  const { user } = useAuth();
  const role = user?.role ?? "";

  const [onboarding, setOnboarding] = useState<OnboardingRow[]>([]);
  const [tickets, setTickets] = useState<TicketRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [stats, setStats] = useState({
    totalFirms: 0, activeOnboarding: 0, completedOnboarding: 0,
    openTickets: 0, resolvedToday: 0,
  });

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    try {
      // Onboarding instances with firm name
      const { data: oi } = await (supabase as any)
        .from("onboarding_instances")
        .select(`
          id, firm_id, plan_tier, status, progress_pct, created_at,
          firms(name),
          ie:assigned_ie_id(name)
        `)
        .order("created_at", { ascending: false })
        .limit(20);

      const onboardingRows: OnboardingRow[] = (oi || []).map((r: any) => ({
        id: r.id,
        firm_id: r.firm_id,
        firm_name: r.firms?.name ?? "—",
        plan_tier: r.plan_tier ?? "solo",
        status: r.status ?? "pending",
        progress_pct: r.progress_pct ?? 0,
        assigned_ie_name: r.ie?.name ?? null,
        created_at: r.created_at,
      }));

      // Open tickets
      const { data: tkt } = await (supabase as any)
        .from("support_tickets")
        .select(`
          id, subject, priority, status, created_at,
          firms(name)
        `)
        .in("status", ["open", "in_progress"])
        .order("created_at", { ascending: false })
        .limit(20);

      const ticketRows: TicketRow[] = (tkt || []).map((r: any) => ({
        id: r.id,
        firm_name: r.firms?.name ?? "—",
        subject: r.subject,
        priority: r.priority ?? "normal",
        status: r.status ?? "open",
        created_at: r.created_at,
      }));

      // Stats
      const { count: firmCount } = await (supabase as any)
        .from("firms")
        .select("id", { count: "exact", head: true });

      const active = onboardingRows.filter(r => r.status !== "completed").length;
      const completed = onboardingRows.filter(r => r.status === "completed").length;
      const todayStr = new Date().toISOString().slice(0, 10);
      const { count: resolvedToday } = await (supabase as any)
        .from("support_tickets")
        .select("id", { count: "exact", head: true })
        .eq("status", "resolved")
        .gte("resolved_at", `${todayStr}T00:00:00Z`);

      setOnboarding(onboardingRows);
      setTickets(ticketRows);
      setStats({
        totalFirms: firmCount ?? 0,
        activeOnboarding: active,
        completedOnboarding: completed,
        openTickets: ticketRows.length,
        resolvedToday: resolvedToday ?? 0,
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-display font-bold text-foreground">
          {role === "superadmin" ? "Platform Overview"
           : role === "implementation_executive" ? "My Onboarding Board"
           : "My Support Queue"}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          {format(new Date(), "EEEE, d MMMM yyyy")}
        </p>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Total Firms", value: stats.totalFirms, icon: Building2, color: "text-blue-600" },
          { label: "Active Onboarding", value: stats.activeOnboarding, icon: ClipboardList, color: "text-amber-600" },
          { label: "Completed Setups", value: stats.completedOnboarding, icon: CheckCircle2, color: "text-green-600" },
          { label: "Open Tickets", value: stats.openTickets, icon: HeadphonesIcon, color: "text-red-600" },
        ].map(s => (
          <Card key={s.label}>
            <CardContent className="pt-4 pb-4">
              {loading ? <Skeleton className="h-12 w-full" /> : (
                <div className="flex items-center gap-3">
                  <s.icon size={20} className={cn("shrink-0", s.color)} />
                  <div>
                    <p className="text-2xl font-bold text-foreground">{s.value}</p>
                    <p className="text-xs text-muted-foreground">{s.label}</p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Onboarding list */}
        {(role === "superadmin" || role === "implementation_executive") && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <ClipboardList size={16} /> Recent Onboarding
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {loading ? (
                <div className="p-4 space-y-3">
                  {[1,2,3].map(i => <Skeleton key={i} className="h-14 w-full" />)}
                </div>
              ) : onboarding.length === 0 ? (
                <div className="p-6 text-center text-sm text-muted-foreground">
                  No onboarding instances yet
                </div>
              ) : (
                <div className="divide-y">
                  {onboarding.slice(0, 8).map(row => (
                    <div key={row.id} className="px-4 py-3 hover:bg-muted/30 transition-colors">
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className="text-sm font-medium text-foreground truncate">{row.firm_name}</span>
                        <div className="flex items-center gap-1 shrink-0">
                          <Badge className={cn("text-[10px] px-1.5 py-0", PLAN_COLOR[row.plan_tier] ?? "bg-muted text-muted-foreground")}>
                            {row.plan_tier}
                          </Badge>
                          <Badge className={cn("text-[10px] px-1.5 py-0", STATUS_COLOR[row.status] ?? "bg-muted text-muted-foreground")}>
                            {row.status.replace("_", " ")}
                          </Badge>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Progress value={row.progress_pct} className="h-1.5 flex-1" />
                        <span className="text-[11px] text-muted-foreground shrink-0">{row.progress_pct}%</span>
                      </div>
                      {row.assigned_ie_name && (
                        <p className="text-[11px] text-muted-foreground mt-0.5">IE: {row.assigned_ie_name}</p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Open tickets */}
        {(role === "superadmin" || role === "client_success_executive") && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <HeadphonesIcon size={16} /> Open Support Tickets
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {loading ? (
                <div className="p-4 space-y-3">
                  {[1,2,3].map(i => <Skeleton key={i} className="h-14 w-full" />)}
                </div>
              ) : tickets.length === 0 ? (
                <div className="p-6 text-center text-sm text-muted-foreground">
                  <CheckCircle2 size={32} className="mx-auto mb-2 text-green-500 opacity-60" />
                  All clear — no open tickets!
                </div>
              ) : (
                <div className="divide-y">
                  {tickets.slice(0, 8).map(row => (
                    <div key={row.id} className="px-4 py-3 hover:bg-muted/30 transition-colors">
                      <div className="flex items-center justify-between gap-2 mb-0.5">
                        <span className="text-sm font-medium text-foreground truncate">{row.subject}</span>
                        <Badge className={cn("text-[10px] px-1.5 py-0 shrink-0", PRIORITY_COLOR[row.priority] ?? "bg-muted text-muted-foreground")}>
                          {row.priority}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                        <Building2 size={11} />
                        <span>{row.firm_name}</span>
                        <span>·</span>
                        <Clock size={11} />
                        <span>{format(new Date(row.created_at), "dd MMM, hh:mm a")}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
