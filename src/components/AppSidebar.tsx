import { useState, useEffect } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { usePermissions } from "@/hooks/usePermissions";
import { useAuditContext } from "@/hooks/useAuditContext";
import { supabase } from "@/integrations/supabase/client";
import {
  LayoutDashboard, Users, Receipt, FileText, CreditCard, BookOpen,
  Search, Settings, LogOut, PanelLeftClose, PanelLeft, Shield,
  Building2, FolderOpen, ChevronDown, ChevronRight, FileSearch,
  BarChart3, ClipboardCheck, CalendarDays, AlertTriangle, FileCheck,
  BookMarked, Calculator, MessageSquare, BrainCircuit, FileOutput,
  HelpCircle, Package, Send, Layers, Eye, Award, Upload
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

const topNavItems = [
  { title: "Dashboard", path: "/", icon: LayoutDashboard, module: "Client Management" },
  { title: "Clients", path: "/clients", icon: Users, module: "Client Management" },
  { title: "TDS Management", path: "/tds-filings", icon: Receipt, module: "TDS" },
  { title: "IT Returns", path: "/itr", icon: FileText, module: "IT Returns" },
  { title: "Billing & Timesheet", path: "/billing", icon: CreditCard, module: "Billing" },
  { title: "Documents", path: "/documents", icon: FolderOpen, module: "Client Management" },
];

const auditStages = [
  { title: "Audit Dashboard",           path: "/audit",          icon: LayoutDashboard },
  { title: "Engagement Setup",          path: "/audit/pipeline", icon: Building2,    stage: 1  },
  { title: "Trial Balance Import",      path: "/audit/pipeline", icon: Upload,       stage: 2  },
  { title: "COA & Financial Statements",path: "/audit/pipeline", icon: Calculator,   stage: 3  },
  { title: "Scrutiny Engine",           path: "/audit/pipeline", icon: Eye,          stage: 4  },
  { title: "Query Tracker",             path: "/audit/pipeline", icon: MessageSquare,stage: 5  },
  { title: "Workpapers & Risk",         path: "/audit/pipeline", icon: Shield,       stage: 6  },
  { title: "Notes to Accounts",         path: "/audit/pipeline", icon: BookMarked,   stage: 7  },
  { title: "CARO / 3CD Reports",        path: "/audit/pipeline", icon: FileCheck,    stage: 8  },
  { title: "Review & QC",               path: "/audit/pipeline", icon: Layers,       stage: 9  },
  { title: "Sign-off & UDIN",           path: "/audit/pipeline", icon: Award,        stage: 10 },
];

const auditUtilities = [
  { title: "Depreciation", path: "/depreciation", icon: Calculator },
  { title: "ERP Ledger", path: "/erp-ledger", icon: BookOpen },
  { title: "Documents", path: "/documents", icon: FolderOpen },
  { title: "Comparative Reports", path: "/audit/comparative", icon: BarChart3 },
];

const settingsItem = { title: "Settings", path: "/settings", icon: Settings };

interface AppSidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

export function AppSidebar({ collapsed, onToggle }: AppSidebarProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const { can } = usePermissions();
  const auditCtx = useAuditContext();
  const selectedEngId = auditCtx?.selectedEngagementId || "";
  const [firmLogo, setFirmLogo] = useState<string | null>(null);
  const [firmDisplayName, setFirmDisplayName] = useState<string | null>(null);
  const [auditOpen, setAuditOpen] = useState(false);
  const [utilitiesOpen, setUtilitiesOpen] = useState(false);

  useEffect(() => {
    if (location.pathname.startsWith("/audit") || location.pathname === "/settings/coa-mappings" || location.pathname === "/depreciation") {
      setAuditOpen(true);
    }
  }, [location.pathname]);

  useEffect(() => {
    if (!user?.firm_id) return;
    supabase.from("firms").select("name, settings").eq("id", user.firm_id).single().then(({ data }) => {
      if (data) {
        setFirmDisplayName(data.name);
        const settings = (data.settings || {}) as { logo_url?: string };
        if (settings.logo_url) setFirmLogo(settings.logo_url);
      }
    });
  }, [user?.firm_id]);

  const handleLogout = async () => {
    await signOut();
    navigate("/login", { replace: true });
  };

  const initials = user?.name
    ? user.name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2)
    : "??";
  const displayName = user?.name || "User";
  const displayRole = user?.role || "staff_article";

  const isActive = (path: string) =>
    path === "/" ? location.pathname === "/" : location.pathname === path || location.pathname.startsWith(path + "/");

  const isAuditActive = location.pathname.startsWith("/audit") || location.pathname === "/settings/coa-mappings";

  return (
    <aside
      className={cn(
        "fixed left-0 top-0 h-screen bg-sidebar flex flex-col z-40 transition-all duration-300 border-r border-sidebar-border",
        collapsed ? "w-16" : "w-60"
      )}
    >
      {/* Logo */}
      <div className="flex items-center h-16 px-4 border-b border-sidebar-border">
        <Link to="/" className="flex items-center gap-2 overflow-hidden">
          {firmLogo ? (
            <>
              <img src={firmLogo} alt="Firm Logo" className="h-8 w-8 object-contain shrink-0 rounded" />
              {!collapsed && (
                <span className="text-sidebar-foreground font-display font-semibold text-sm tracking-tight truncate">{firmDisplayName || "CA Flow"}</span>
              )}
            </>
          ) : (
            <>
              <span className="text-sidebar-gold font-display font-bold text-xl tracking-tight shrink-0">CA</span>
              {!collapsed && (
                <span className="text-sidebar-foreground font-display font-semibold text-lg tracking-tight">Flow</span>
              )}
            </>
          )}
        </Link>
        <button
          onClick={onToggle}
          className="ml-auto text-sidebar-foreground hover:text-sidebar-gold transition-colors shrink-0"
        >
          {collapsed ? <PanelLeft size={18} /> : <PanelLeftClose size={18} />}
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-4 flex flex-col gap-0.5 px-2 overflow-y-auto overflow-x-hidden">
        {topNavItems.filter(item => can(item.module, "can_view")).map((item) => (
          <Link
            key={item.path}
            to={item.path}
            className={cn(
              "flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-all duration-200 group",
              isActive(item.path)
                ? "bg-sidebar-gold/15 text-sidebar-gold"
                : "text-sidebar-foreground hover:bg-sidebar-hover hover:text-sidebar-gold-foreground"
            )}
          >
            <item.icon size={20} className={cn("shrink-0 transition-colors", isActive(item.path) && "text-sidebar-gold")} />
            {!collapsed && <span className="truncate">{item.title}</span>}
          </Link>
        ))}

        {/* Audit Intelligence - Collapsible */}
        {can("Audit Intelligence", "can_view") && (
          collapsed ? (
            <Link
              to="/audit"
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-all duration-200",
                isAuditActive
                  ? "bg-sidebar-gold/15 text-sidebar-gold"
                  : "text-sidebar-foreground hover:bg-sidebar-hover hover:text-sidebar-gold-foreground"
              )}
            >
              <Search size={20} className="shrink-0 text-sidebar-gold" />
            </Link>
          ) : (
            <Collapsible open={auditOpen} onOpenChange={setAuditOpen}>
              <CollapsibleTrigger className="w-full">
                <div
                  className={cn(
                    "flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-all duration-200 w-full",
                    isAuditActive
                      ? "bg-sidebar-gold/15 text-sidebar-gold"
                      : "text-sidebar-foreground hover:bg-sidebar-hover hover:text-sidebar-gold-foreground"
                  )}
                >
                  <Search size={20} className="shrink-0 text-sidebar-gold" />
                  <span className="truncate flex-1 text-left">
                    Audit Intelligence
                    <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded bg-sidebar-gold/20 text-sidebar-gold font-semibold uppercase tracking-wider">
                      Pro
                    </span>
                  </span>
                  {auditOpen ? <ChevronDown size={14} className="shrink-0" /> : <ChevronRight size={14} className="shrink-0" />}
                </div>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="ml-3 pl-3 border-l border-sidebar-border/50 space-y-0.5 mt-1">
                  {/* Stage items */}
                  {auditStages.map((item) => {
                    // Items with children (Queries & Communication)
                    if ('children' in item && item.children) {
                      const isParentActive = item.children.some(c => isActive(c.path));
                      return (
                        <Collapsible key={item.title} open={queriesOpen} onOpenChange={setQueriesOpen}>
                          <CollapsibleTrigger className="w-full">
                            <div className={cn(
                              "flex items-center gap-2.5 px-2 py-1.5 rounded-md text-xs font-medium transition-all duration-200 w-full",
                              isParentActive
                                ? "bg-sidebar-gold/10 text-sidebar-gold"
                                : "text-sidebar-foreground/80 hover:bg-sidebar-hover hover:text-sidebar-foreground"
                            )}>
                              <item.icon size={14} className="shrink-0" />
                              <span className="truncate flex-1 text-left">{item.title}</span>
                              {queriesOpen ? <ChevronDown size={12} className="shrink-0" /> : <ChevronRight size={12} className="shrink-0" />}
                            </div>
                          </CollapsibleTrigger>
                          <CollapsibleContent>
                            <div className="ml-3 pl-2 border-l border-sidebar-border/30 space-y-0.5 mt-0.5">
                              {item.children.map(child => (
                                <Link
                                  key={child.path}
                                  to={child.path}
                                  className={cn(
                                    "flex items-center gap-2 px-2 py-1 rounded-md text-[11px] font-medium transition-all duration-200",
                                    isActive(child.path)
                                      ? "bg-sidebar-gold/10 text-sidebar-gold"
                                      : "text-sidebar-foreground/70 hover:bg-sidebar-hover hover:text-sidebar-foreground"
                                  )}
                                >
                                  <child.icon size={12} className="shrink-0" />
                                  <span className="truncate">{child.title}</span>
                                </Link>
                              ))}
                            </div>
                          </CollapsibleContent>
                        </Collapsible>
                      );
                    }

                    return (
                      <Link
                        key={item.title}
                        to={item.path}
                        className={cn(
                          "flex items-center gap-2.5 px-2 py-1.5 rounded-md text-xs font-medium transition-all duration-200",
                          isActive(item.path) && (item.path !== "/audit/pipeline" || location.pathname.startsWith("/audit/pipeline"))
                            ? "bg-sidebar-gold/10 text-sidebar-gold"
                            : "text-sidebar-foreground/80 hover:bg-sidebar-hover hover:text-sidebar-foreground"
                        )}
                      >
                        <item.icon size={14} className="shrink-0" />
                        <span className="truncate">{item.title}</span>
                      </Link>
                    );
                  })}

                  {/* Utilities sub-section */}
                  <Collapsible open={utilitiesOpen} onOpenChange={setUtilitiesOpen}>
                    <CollapsibleTrigger className="w-full">
                      <div className="flex items-center justify-between px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-sidebar-foreground/60 hover:text-sidebar-foreground/80 cursor-pointer mt-2">
                        <span>Utilities</span>
                        {utilitiesOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                      </div>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      {auditUtilities.map((item) => (
                        <Link
                          key={item.path}
                          to={item.path}
                          className={cn(
                            "flex items-center gap-2.5 px-2 py-1.5 rounded-md text-xs font-medium transition-all duration-200",
                            isActive(item.path)
                              ? "bg-sidebar-gold/10 text-sidebar-gold"
                              : "text-sidebar-foreground/80 hover:bg-sidebar-hover hover:text-sidebar-foreground"
                          )}
                        >
                          <item.icon size={14} className="shrink-0" />
                          <span className="truncate">{item.title}</span>
                        </Link>
                      ))}
                    </CollapsibleContent>
                  </Collapsible>
                </div>
              </CollapsibleContent>
            </Collapsible>
          )
        )}

        <div className="flex-1" />

        {/* Superadmin links */}
        {user?.role === "superadmin" && (
          <>
            <Link
              to="/admin"
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-all duration-200",
                isActive("/admin")
                  ? "bg-destructive/15 text-destructive"
                  : "text-sidebar-foreground hover:bg-sidebar-hover hover:text-destructive"
              )}
            >
              <Shield size={20} className="shrink-0 text-destructive" />
              {!collapsed && <span>Superadmin</span>}
            </Link>

            <Link
              to="/admin/firms"
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-all duration-200",
                isActive("/admin/firms")
                  ? "bg-sidebar-gold/15 text-sidebar-gold"
                  : "text-sidebar-foreground hover:bg-sidebar-hover hover:text-sidebar-gold-foreground"
              )}
            >
              <Building2 size={20} className="shrink-0" />
              {!collapsed && <span>Firm Management</span>}
            </Link>

            <Link
              to="/admin/users"
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-all duration-200",
                isActive("/admin/users")
                  ? "bg-sidebar-gold/15 text-sidebar-gold"
                  : "text-sidebar-foreground hover:bg-sidebar-hover hover:text-sidebar-gold-foreground"
              )}
            >
              <Users size={20} className="shrink-0" />
              {!collapsed && <span>User Management</span>}
            </Link>
          </>
        )}

        {/* User Management - firm_admin only */}
        {user?.role === "firm_admin" && (
          <Link
            to="/settings/users"
            className={cn(
              "flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-all duration-200",
              isActive("/settings/users")
                ? "bg-sidebar-gold/15 text-sidebar-gold"
                : "text-sidebar-foreground hover:bg-sidebar-hover hover:text-sidebar-gold-foreground"
            )}
          >
            <Users size={20} className="shrink-0" />
            {!collapsed && <span>User Management</span>}
          </Link>
        )}

        {/* Firm Settings */}
        {can("Firm Management", "can_view") && (
          <Link
            to="/settings/firm"
            className={cn(
              "flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-all duration-200",
              isActive("/settings/firm")
                ? "bg-sidebar-gold/15 text-sidebar-gold"
                : "text-sidebar-foreground hover:bg-sidebar-hover hover:text-sidebar-gold-foreground"
            )}
          >
            <Building2 size={20} className="shrink-0" />
            {!collapsed && <span>Firm Settings</span>}
          </Link>
        )}

        {/* Service Masters */}
        {can("Service Masters", "can_view") && (
          <Link
            to="/settings/services"
            className={cn(
              "flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-all duration-200",
              isActive("/settings/services")
                ? "bg-sidebar-gold/15 text-sidebar-gold"
                : "text-sidebar-foreground hover:bg-sidebar-hover hover:text-sidebar-gold-foreground"
            )}
          >
            <Package size={20} className="shrink-0" />
            {!collapsed && <span>Service Masters</span>}
          </Link>
        )}

        {/* Roles & Permissions */}
        {can("Settings", "can_view") && (
          <Link
            to="/settings/roles"
            className={cn(
              "flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-all duration-200",
              isActive("/settings/roles")
                ? "bg-sidebar-gold/15 text-sidebar-gold"
                : "text-sidebar-foreground hover:bg-sidebar-hover hover:text-sidebar-gold-foreground"
            )}
          >
            <Shield size={20} className="shrink-0" />
            {!collapsed && <span>Roles</span>}
          </Link>
        )}

        {/* Settings */}
        {can("Settings", "can_view") && (
          <Link
            to={settingsItem.path}
            className={cn(
              "flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-all duration-200",
              isActive(settingsItem.path) && !isActive("/settings/users") && !isActive("/settings/coa-mappings") && !isActive("/settings/firm") && !isActive("/settings/roles") && !isActive("/settings/services")
                ? "bg-sidebar-gold/15 text-sidebar-gold"
                : "text-sidebar-foreground hover:bg-sidebar-hover hover:text-sidebar-gold-foreground"
            )}
          >
            <settingsItem.icon size={20} className="shrink-0" />
            {!collapsed && <span>Settings</span>}
          </Link>
        )}
      </nav>

      {/* User section with dropdown */}
      <div className="border-t border-sidebar-border p-3">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-3 overflow-hidden w-full text-left hover:opacity-80 transition-opacity">
              <div className="w-9 h-9 rounded-full bg-sidebar-gold/20 flex items-center justify-center text-sidebar-gold font-semibold text-sm shrink-0">
                {initials}
              </div>
              {!collapsed && (
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-sidebar-foreground truncate">{displayName}</p>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-sidebar-gold/20 text-sidebar-gold font-semibold uppercase tracking-wider">
                    {displayRole}
                  </span>
                </div>
              )}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start" className="w-52">
            <DropdownMenuItem onClick={() => navigate("/settings")}>
              <Settings size={14} className="mr-2" /> Settings
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => navigate("/settings/change-password")}>
              <Shield size={14} className="mr-2" /> Change Password
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleLogout} className="text-destructive focus:text-destructive">
              <LogOut size={14} className="mr-2" /> Sign Out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </aside>
  );
}
