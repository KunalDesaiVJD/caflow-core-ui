import React, { useEffect } from "react";
import { Link, useLocation, useNavigate, Outlet } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useThemeLoader } from "@/hooks/useThemeLoader";
import {
  LayoutDashboard,
  Building2,
  ScrollText,
  Users,
  LogOut,
  ShieldCheck,
  Settings,
  Brain,
  Palette,
  ClipboardList,
} from "lucide-react";
import { cn } from "@/lib/utils";

const navItems = [
  { title: "Platform Overview",    path: "/admin",                    icon: LayoutDashboard },
  { title: "Firms Management",     path: "/admin/firms",              icon: Building2 },
  { title: "User Management",      path: "/admin/users",              icon: Users },
  { title: "Service Masters",      path: "/admin/services",           icon: Building2 },
  { title: "Access & Permissions", path: "/admin/access-permissions", icon: ShieldCheck },
  { title: "Internal Team",        path: "/internal",                 icon: ClipboardList },
  { title: "System Logs",          path: "/admin/logs",               icon: ScrollText },
  { title: "AI Skills",            path: "/admin/ai-skills",          icon: Brain },
  { title: "Theme Studio",         path: "/admin/theme-studio",       icon: Palette },
  { title: "Settings",             path: "/admin/settings",           icon: Settings },
];

export function AdminLayout() {
  useThemeLoader();
  const location = useLocation();
  const navigate = useNavigate();
  const { user, signOut } = useAuth();

  useEffect(() => {
    if (user && user.role !== "superadmin") {
      navigate("/", { replace: true });
    }
  }, [user, navigate]);

  const handleLogout = async () => {
    await signOut();
    navigate("/login", { replace: true });
  };

  const isActive = (path: string) =>
    path === "/admin"
      ? location.pathname === "/admin"
      : location.pathname.startsWith(path);

  return (
    <div className="min-h-screen flex">
      {/* Superadmin Sidebar */}
      <aside className="fixed left-0 top-0 h-screen w-60 bg-[hsl(var(--secondary))] flex flex-col z-40 border-r border-[hsl(var(--sidebar-border))]">
        {/* Logo */}
        <div className="flex items-center h-16 px-4 border-b border-[hsl(var(--sidebar-border))]">
          <Link to="/admin" className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-destructive" />
            <span className="text-primary-foreground font-display font-bold text-lg tracking-tight">
              CA<span className="text-primary">Flow</span>
            </span>
            <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded bg-destructive/20 text-destructive font-semibold uppercase tracking-wider">
              Admin
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

          <button
            onClick={() => navigate("/")}
            className="flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium text-[hsl(var(--sidebar-foreground))] hover:bg-[hsl(var(--sidebar-accent))] hover:text-primary transition-all duration-200 w-full"
          >
            <LayoutDashboard size={20} className="shrink-0" />
            <span>Go to App</span>
          </button>
        </nav>

        {/* User section */}
        <div className="border-t border-[hsl(var(--sidebar-border))] p-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-destructive/20 flex items-center justify-center text-destructive font-semibold text-sm shrink-0">
              SA
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-[hsl(var(--sidebar-foreground))] truncate">
                {user?.name || "Superadmin"}
              </p>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-destructive/20 text-destructive font-semibold uppercase tracking-wider">
                superadmin
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
