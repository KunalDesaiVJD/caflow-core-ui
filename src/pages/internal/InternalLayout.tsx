import { useEffect } from "react";
import { Link, useLocation, useNavigate, Outlet } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import {
  LayoutDashboard, Users, ClipboardList, HeadphonesIcon,
  LogOut, Shield, Building2,
} from "lucide-react";
import { cn } from "@/lib/utils";

const INTERNAL_ROLES = ["implementation_executive", "client_success_executive"];

const IE_NAV = [
  { title: "My Dashboard",        path: "/internal",             icon: LayoutDashboard },
  { title: "Onboarding Board",    path: "/internal/onboarding",  icon: ClipboardList },
];

const CSE_NAV = [
  { title: "My Dashboard",        path: "/internal",             icon: LayoutDashboard },
  { title: "Support Tickets",     path: "/internal/tickets",     icon: HeadphonesIcon },
];

const SUPERADMIN_INTERNAL_NAV = [
  { title: "Overview",            path: "/internal",             icon: LayoutDashboard },
  { title: "Onboarding Board",    path: "/internal/onboarding",  icon: ClipboardList },
  { title: "Support Tickets",     path: "/internal/tickets",     icon: HeadphonesIcon },
  { title: "Internal Team",       path: "/internal/team",        icon: Users },
];

const ROLE_LABELS: Record<string, string> = {
  superadmin:                  "Platform Admin",
  implementation_executive:    "Implementation Executive",
  client_success_executive:    "Client Success Executive",
};

const ROLE_INITIALS: Record<string, string> = {
  superadmin:                  "PA",
  implementation_executive:    "IE",
  client_success_executive:    "CSE",
};

export function InternalLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, signOut, loading } = useAuth();

  const role = user?.role ?? "";
  const isAllowed = role === "superadmin" || INTERNAL_ROLES.includes(role);

  useEffect(() => {
    if (!loading && !isAllowed) {
      navigate("/", { replace: true });
    }
  }, [loading, isAllowed, navigate]);

  const navItems =
    role === "superadmin" ? SUPERADMIN_INTERNAL_NAV
    : role === "implementation_executive" ? IE_NAV
    : CSE_NAV;

  const handleLogout = async () => {
    await signOut();
    navigate("/login", { replace: true });
  };

  const isActive = (path: string) =>
    path === "/internal"
      ? location.pathname === "/internal"
      : location.pathname.startsWith(path);

  if (loading || !isAllowed) return null;

  return (
    <div className="min-h-screen flex">
      {/* Sidebar */}
      <aside className="fixed left-0 top-0 h-screen w-60 bg-[hsl(var(--secondary))] flex flex-col z-40 border-r border-[hsl(var(--sidebar-border))]">
        {/* Logo */}
        <div className="flex items-center h-16 px-4 border-b border-[hsl(var(--sidebar-border))]">
          <Link to="/internal" className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary" />
            <span className="text-primary-foreground font-display font-bold text-lg tracking-tight">
              CA<span className="text-primary">Flow</span>
            </span>
            <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded bg-primary/20 text-primary font-semibold uppercase tracking-wider">
              Internal
            </span>
          </Link>
        </div>

        {/* Navigation */}
        <nav className="flex-1 py-4 flex flex-col gap-1 px-2">
          {navItems.map((item) => (
            <Link
              key={item.path}
              to={item.path}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-all duration-200",
                isActive(item.path)
                  ? "bg-primary/15 text-primary"
                  : "text-[hsl(var(--sidebar-foreground))] hover:bg-[hsl(var(--sidebar-accent))] hover:text-primary"
              )}
            >
              <item.icon size={20} className="shrink-0" />
              <span>{item.title}</span>
            </Link>
          ))}

          <div className="flex-1" />

          {/* Go to Admin Panel (superadmin only) */}
          {role === "superadmin" && (
            <button
              onClick={() => navigate("/admin")}
              className="flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium text-[hsl(var(--sidebar-foreground))] hover:bg-[hsl(var(--sidebar-accent))] hover:text-primary transition-all duration-200 w-full"
            >
              <Building2 size={20} className="shrink-0" />
              <span>Admin Panel</span>
            </button>
          )}
        </nav>

        {/* User section */}
        <div className="border-t border-[hsl(var(--sidebar-border))] p-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-primary/20 flex items-center justify-center text-primary font-semibold text-sm shrink-0">
              {ROLE_INITIALS[role] ?? role.slice(0, 2).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-[hsl(var(--sidebar-foreground))] truncate">
                {user?.name || "Team Member"}
              </p>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/20 text-primary font-semibold uppercase tracking-wider">
                {ROLE_LABELS[role] ?? role}
              </span>
            </div>
            <button
              onClick={handleLogout}
              className="text-[hsl(var(--sidebar-foreground))] hover:text-destructive transition-colors shrink-0"
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 ml-60 flex flex-col">
        <main className="flex-1 p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
