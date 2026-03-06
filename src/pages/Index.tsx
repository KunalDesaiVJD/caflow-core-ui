import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Users,
  Receipt,
  FileText,
  Search,
  TrendingUp,
  TrendingDown,
  ArrowRight,
  Plus,
  Clock,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

// Mock role — will come from JWT later
const MOCK_ROLE: "partner" | "manager" | "staff" | "firm_admin" = "partner";

const ROLE_GREETINGS: Record<string, string> = {
  partner: "Partner Dashboard",
  manager: "Manager Dashboard",
  staff: "My Tasks",
  firm_admin: "Firm Overview",
};

const MOCK_STATS = [
  { label: "Active Clients", value: 142, trend: 8, icon: Users },
  { label: "TDS Due This Month", value: 23, trend: -3, icon: Receipt },
  { label: "ITR Pending", value: 8, trend: 2, icon: FileText },
  { label: "Open Audits", value: 5, trend: 0, icon: Search },
];

const MOCK_DUE_ITEMS = [
  { client: "ABC Enterprises", due: new Date(Date.now() + 1 * 86400000), type: "TDS" },
  { client: "Sharma & Sons", due: new Date(Date.now() + 2 * 86400000), type: "ITR" },
  { client: "Global Infra Ltd", due: new Date(Date.now() + 3 * 86400000), type: "TDS" },
  { client: "Priya Textiles", due: new Date(Date.now() + 5 * 86400000), type: "ITR" },
  { client: "Metro Builders", due: new Date(Date.now() + 6 * 86400000), type: "TDS" },
];

const MOCK_ACTIVITY = [
  { user: "Rajesh K.", role: "partner", table: "clients", op: "INSERT", at: new Date(Date.now() - 2 * 3600000) },
  { user: "Sneha M.", role: "manager", table: "tds_entries", op: "UPDATE", at: new Date(Date.now() - 5 * 3600000) },
  { user: "Amit P.", role: "staff", table: "itr_profiles", op: "INSERT", at: new Date(Date.now() - 8 * 3600000) },
  { user: "Rajesh K.", role: "partner", table: "audit_engagements", op: "UPDATE", at: new Date(Date.now() - 12 * 3600000) },
  { user: "Priya S.", role: "staff", table: "tds_entries", op: "INSERT", at: new Date(Date.now() - 24 * 3600000) },
  { user: "Sneha M.", role: "manager", table: "clients", op: "DELETE", at: new Date(Date.now() - 36 * 3600000) },
  { user: "Amit P.", role: "staff", table: "itr_profiles", op: "UPDATE", at: new Date(Date.now() - 48 * 3600000) },
];

const OP_COLORS: Record<string, string> = {
  INSERT: "bg-emerald-100 text-emerald-700 border-emerald-200",
  UPDATE: "bg-sky-100 text-sky-700 border-sky-200",
  DELETE: "bg-red-100 text-red-700 border-red-200",
};

function daysUntil(date: Date) {
  return Math.max(0, Math.ceil((date.getTime() - Date.now()) / 86400000));
}

const Index = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => setLoading(false), 800);
    return () => clearTimeout(t);
  }, []);

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
        <h1 className="text-2xl font-display font-bold text-foreground">
          {ROLE_GREETINGS[MOCK_ROLE]}
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          Welcome back, Rajesh. Here's your practice overview.
        </p>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {MOCK_STATS.map((stat) =>
          loading ? (
            <Card key={stat.label}>
              <CardContent className="p-5 space-y-3">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-8 w-16" />
                <Skeleton className="h-3 w-20" />
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
                <div className="flex items-center gap-1 mt-1">
                  {stat.trend > 0 ? (
                    <TrendingUp className="h-3.5 w-3.5 text-emerald-500" />
                  ) : stat.trend < 0 ? (
                    <TrendingDown className="h-3.5 w-3.5 text-red-500" />
                  ) : null}
                  <span
                    className={`text-xs font-medium ${
                      stat.trend > 0
                        ? "text-emerald-600"
                        : stat.trend < 0
                        ? "text-red-600"
                        : "text-muted-foreground"
                    }`}
                  >
                    {stat.trend > 0 ? `+${stat.trend}` : stat.trend < 0 ? stat.trend : "No change"}{" "}
                    {stat.trend !== 0 && "this month"}
                  </span>
                </div>
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
            {loading
              ? Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-3 py-3">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-5 w-12" />
                    <Skeleton className="ml-auto h-4 w-16" />
                  </div>
                ))
              : MOCK_DUE_ITEMS.map((item, i) => {
                  const days = daysUntil(item.due);
                  return (
                    <div
                      key={i}
                      className="flex items-center justify-between py-3 border-b border-border last:border-0"
                    >
                      <div className="flex items-center gap-3">
                        <span className="text-sm font-medium text-foreground">{item.client}</span>
                        <Badge
                          variant={item.type === "TDS" ? "default" : "secondary"}
                          className="text-[10px] px-1.5 py-0"
                        >
                          {item.type}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-2 text-xs">
                        <span
                          className={`font-semibold ${
                            days <= 2 ? "text-red-600" : "text-muted-foreground"
                          }`}
                        >
                          {days === 0 ? "Today" : days === 1 ? "Tomorrow" : `${days} days`}
                        </span>
                      </div>
                    </div>
                  );
                })}
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
            {loading
              ? Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-3 py-3">
                    <Skeleton className="h-4 w-20" />
                    <Skeleton className="h-5 w-14" />
                    <Skeleton className="ml-auto h-4 w-24" />
                  </div>
                ))
              : MOCK_ACTIVITY.map((item, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between py-3 border-b border-border last:border-0"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-sm font-medium text-foreground whitespace-nowrap">
                        {item.user}
                      </span>
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0 shrink-0">
                        {item.role}
                      </Badge>
                      <span className="text-xs text-muted-foreground truncate">
                        <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium border ${OP_COLORS[item.op]}`}>
                          {item.op}
                        </span>
                        {" "}on{" "}
                        <span className="font-mono">{item.table}</span>
                      </span>
                    </div>
                    <span className="text-xs text-muted-foreground whitespace-nowrap ml-2">
                      {formatDistanceToNow(item.at, { addSuffix: true })}
                    </span>
                  </div>
                ))}
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
