import { useState, useEffect, useCallback } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Building2, Users, Briefcase, CreditCard } from "lucide-react";
import { callAdmin, Stats } from "./adminShared";

const AdminOverview = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user, loading: authLoading } = useAuth();
  const [stats, setStats] = useState<Stats | null>(null);
  const [loadingStats, setLoadingStats] = useState(true);

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

  useEffect(() => {
    if (user?.role === "superadmin") fetchStats();
  }, [user, fetchStats]);

  if (authLoading) {
    return <div className="p-6 space-y-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}</div>;
  }
  if (!user || user.role !== "superadmin") return null;

  const statCards = [
    { label: "Active Firms", value: stats?.activeFirms, icon: Building2, path: "/admin/firms" },
    { label: "Total Users", value: stats?.totalUsers, icon: Users, path: "/admin/users" },
    { label: "Total Clients", value: stats?.totalClients, icon: Briefcase, path: "/admin/clients" },
    { label: "Active Subscriptions", value: stats?.activeSubscriptions, icon: CreditCard, path: "/admin/subscriptions" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-display font-bold text-foreground">Platform Overview</h1>
        <p className="text-sm text-muted-foreground">Platform-wide statistics</p>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map((s) =>
          loadingStats ? (
            <Card key={s.label}><CardContent className="p-5"><Skeleton className="h-4 w-24 mb-2" /><Skeleton className="h-8 w-16" /></CardContent></Card>
          ) : (
            <Link key={s.label} to={s.path}>
              <Card className="hover:border-primary/40 transition-colors cursor-pointer">
                <CardContent className="p-5">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm text-muted-foreground font-medium">{s.label}</p>
                    <s.icon className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <p className="text-3xl font-display font-bold text-foreground">{s.value ?? 0}</p>
                </CardContent>
              </Card>
            </Link>
          )
        )}
      </div>
    </div>
  );
};

export default AdminOverview;
