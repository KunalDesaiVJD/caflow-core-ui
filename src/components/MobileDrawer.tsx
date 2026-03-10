import { useEffect } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import {
  LayoutDashboard,
  Users,
  Receipt,
  FileText,
  CreditCard,
  BookOpen,
  Search,
  Settings,
  LogOut,
  X,
  Clock,
  FolderOpen,
  Shield,
  Building2,
} from "lucide-react";
import { cn } from "@/lib/utils";

const navItems = [
  { title: "Dashboard", path: "/", icon: LayoutDashboard },
  { title: "Clients", path: "/clients", icon: Users },
  { title: "TDS Filings", path: "/tds-filings", icon: Receipt },
  { title: "IT Returns", path: "/itr", icon: FileText },
  { title: "Billing", path: "/billing", icon: CreditCard },
  { title: "Timesheets", path: "/billing/timesheets", icon: Clock },
  { title: "ERP Ledger", path: "/erp-ledger", icon: BookOpen },
  { title: "Audit Intelligence", path: "/audit-intelligence", icon: Search },
  { title: "Documents", path: "/documents", icon: FolderOpen },
  { title: "Settings", path: "/settings", icon: Settings },
];

interface MobileDrawerProps {
  open: boolean;
  onClose: () => void;
}

export function MobileDrawer({ open, onClose }: MobileDrawerProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, signOut } = useAuth();

  // Close on route change
  useEffect(() => {
    onClose();
  }, [location.pathname]);

  // Prevent scroll when open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  const isActive = (path: string) =>
    path === "/" ? location.pathname === "/" : location.pathname.startsWith(path);

  const handleLogout = async () => {
    onClose();
    await signOut();
    navigate("/login", { replace: true });
  };

  return (
    <>
      {/* Overlay */}
      {open && (
        <div
          className="fixed inset-0 z-50 bg-black/50 animate-in fade-in duration-200"
          onClick={onClose}
        />
      )}

      {/* Drawer */}
      <aside
        className={cn(
          "fixed top-0 left-0 h-full w-72 bg-sidebar z-50 flex flex-col transition-transform duration-300 ease-in-out",
          open ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between h-16 px-4 border-b border-sidebar-border">
          <span className="text-sidebar-gold font-display font-bold text-xl tracking-tight">
            CA<span className="text-sidebar-foreground">Flow</span>
          </span>
          <button onClick={onClose} className="text-sidebar-foreground hover:text-sidebar-gold">
            <X size={20} />
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 py-4 px-2 overflow-y-auto space-y-1">
          {navItems.map((item) => (
            <Link
              key={item.path}
              to={item.path}
              className={cn(
                "flex items-center gap-3 px-3 py-3 rounded-md text-sm font-medium transition-colors",
                isActive(item.path)
                  ? "bg-sidebar-gold/15 text-sidebar-gold"
                  : "text-sidebar-foreground hover:bg-sidebar-hover"
              )}
            >
              <item.icon size={20} className="shrink-0" />
              <span>{item.title}</span>
            </Link>
          ))}

          {user?.role === "superadmin" && (
            <>
              <div className="border-t border-sidebar-border my-2" />
              <Link
                to="/admin"
                className={cn(
                  "flex items-center gap-3 px-3 py-3 rounded-md text-sm font-medium transition-colors",
                  isActive("/admin")
                    ? "bg-destructive/15 text-destructive"
                    : "text-sidebar-foreground hover:bg-sidebar-hover"
                )}
              >
                <Shield size={20} className="shrink-0" />
                <span>Superadmin</span>
              </Link>
              <Link
                to="/admin/firms"
                className="flex items-center gap-3 px-3 py-3 rounded-md text-sm font-medium text-sidebar-foreground hover:bg-sidebar-hover"
              >
                <Building2 size={20} className="shrink-0" />
                <span>Firm Management</span>
              </Link>
            </>
          )}
        </nav>

        {/* User footer */}
        <div className="border-t border-sidebar-border p-4">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-9 h-9 rounded-full bg-sidebar-gold/20 flex items-center justify-center text-sidebar-gold font-semibold text-sm">
              {user?.name?.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2) || "??"}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-sidebar-foreground truncate">{user?.name || "User"}</p>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-sidebar-gold/20 text-sidebar-gold font-semibold uppercase">
                {user?.role || "staff"}
              </span>
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="flex items-center gap-2 w-full px-3 py-2 rounded-md text-sm text-destructive hover:bg-destructive/10 transition-colors"
          >
            <LogOut size={16} />
            Log Out
          </button>
        </div>
      </aside>
    </>
  );
}
