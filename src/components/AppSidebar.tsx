import { useState, useEffect } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { usePermissions } from "@/hooks/usePermissions";
import { supabase } from "@/integrations/supabase/client";
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
  PanelLeftClose,
  PanelLeft,
  Shield,
  KeyRound,
  Building2,
  Clock,
  Landmark,
  FolderOpen,
  ChevronDown,
  ChevronRight,
  FileSearch,
  BarChart3,
  ClipboardList,
  CalendarDays,
  AlertTriangle,
  FileCheck,
  BookMarked,
  MessageSquare,
  BrainCircuit,
  FileOutput,
  HelpCircle,
  Send,
  Layers,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

const topNavItems = [
  { title: "Dashboard", path: "/", icon: LayoutDashboard, module: "Dashboard" },
  { title: "Clients", path: "/clients", icon: Users, module: "Clients" },
  { title: "TDS Filings", path: "/tds-filings", icon: Receipt, module: "TDS" },
  { title: "IT Returns", path: "/itr", icon: FileText, module: "IT Returns" },
  { title: "Billing", path: "/billing", icon: CreditCard, module: "Billing" },
  { title: "Timesheets", path: "/billing/timesheets", icon: Clock, module: "Billing" },
  { title: "ERP Ledger", path: "/erp-ledger", icon: BookOpen, module: "Clients" },
  { title: "Documents", path: "/documents", icon: FolderOpen, module: "Clients" },
  { title: "Audit Firms", path: "/settings/audit-firms", icon: Landmark, module: "Settings" },
  { title: "Notice Tracker", path: "/notices", icon: AlertTriangle, module: "Clients" },
];

const auditSections = [
  {
    label: "Scrutiny",
    items: [
      { title: "TB Import", path: "/audit/import", icon: FileOutput },
      { title: "Scrutiny Dashboard", path: "/audit/scrutiny", icon: FileSearch },
      { title: "Narration AI", path: "/audit/narration", icon: BrainCircuit },
      { title: "COA Mapping", path: "/settings/coa-mappings", icon: Layers },
      { title: "Comparative Reports", path: "/audit/comparative", icon: BarChart3 },
    ],
  },
  {
    label: "Reports",
    items: [
      { title: "3CD Clauses", path: "/audit/3cd", icon: ClipboardList },
      { title: "CARO 2020", path: "/audit/caro", icon: FileCheck },
      { title: "Notes to Accounts", path: "/audit/notes", icon: BookMarked },
    ],
  },
  {
    label: "Engagements",
    items: [
      { title: "Engagements", path: "/audit", icon: FileText },
      { title: "Calendar", path: "/audit/calendar", icon: CalendarDays },
      { title: "Risk Assessment", path: "/audit/risk", icon: AlertTriangle },
      { title: "Workpapers", path: "/audit/workpapers", icon: FileText },
      { title: "Sign-Off & Bundle", path: "/audit/signoff", icon: FileCheck },
    ],
  },
  {
    label: "Intelligence",
    items: [
      { title: "Preliminary Questions", path: "/audit/preliminary", icon: HelpCircle },
      { title: "Query Tracker", path: "/audit/queries", icon: MessageSquare },
      { title: "Query Dispatch", path: "/audit/dispatch", icon: Send },
      { title: "Audit Report", path: "/audit/report", icon: FileOutput },
      { title: "AI Skills", path: "/audit/ai-skills", icon: BrainCircuit },
    ],
  },
];

const settingsItem = { title: "Settings", path: "/settings", icon: Settings };
const userMgmtItem = { title: "User Management", path: "/settings/users", icon: Users };

interface AppSidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

export function AppSidebar({ collapsed, onToggle }: AppSidebarProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const [firmLogo, setFirmLogo] = useState<string | null>(null);
  const [firmDisplayName, setFirmDisplayName] = useState<string | null>(null);
  const [auditOpen, setAuditOpen] = useState(false);
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({});

  // Auto-expand audit section if on /audit route
  useEffect(() => {
    if (location.pathname.startsWith("/audit")) {
      setAuditOpen(true);
      // Auto-expand the section that contains the active route
      for (const section of auditSections) {
        if (section.items.some(item => isActive(item.path))) {
          setOpenSections(prev => ({ ...prev, [section.label]: true }));
        }
      }
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

  const isAuditActive = location.pathname.startsWith("/audit");

  const toggleSection = (label: string) => {
    setOpenSections(prev => ({ ...prev, [label]: !prev[label] }));
  };

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
        {topNavItems.map((item) => (
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
        {collapsed ? (
          <Link
            to="/audit"
            className={cn(
              "flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-all duration-200",
              isAuditActive
                ? "bg-sidebar-gold/15 text-sidebar-gold"
                : "text-sidebar-foreground hover:bg-sidebar-hover hover:text-sidebar-gold-foreground"
            )}
          >
            <Search size={20} className={cn("shrink-0 text-sidebar-gold")} />
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
                {auditSections.map((section) => (
                  <Collapsible key={section.label} open={openSections[section.label] ?? false} onOpenChange={() => toggleSection(section.label)}>
                    <CollapsibleTrigger className="w-full">
                      <div className="flex items-center justify-between px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-sidebar-foreground/60 hover:text-sidebar-foreground/80 cursor-pointer">
                        <span>{section.label}</span>
                        {openSections[section.label] ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                      </div>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      {section.items.map((item) => (
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
                ))}
              </div>
            </CollapsibleContent>
          </Collapsible>
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
            to={userMgmtItem.path}
            className={cn(
              "flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-all duration-200",
              isActive(userMgmtItem.path)
                ? "bg-sidebar-gold/15 text-sidebar-gold"
                : "text-sidebar-foreground hover:bg-sidebar-hover hover:text-sidebar-gold-foreground"
            )}
          >
            <userMgmtItem.icon size={20} className="shrink-0" />
            {!collapsed && <span>User Management</span>}
          </Link>
        )}

        {/* Settings */}
        <Link
          to={settingsItem.path}
          className={cn(
            "flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-all duration-200",
            isActive(settingsItem.path) && !isActive("/settings/users") && !isActive("/settings/coa-mappings") && !isActive("/settings/audit-firms")
              ? "bg-sidebar-gold/15 text-sidebar-gold"
              : "text-sidebar-foreground hover:bg-sidebar-hover hover:text-sidebar-gold-foreground"
          )}
        >
          <settingsItem.icon size={20} className="shrink-0" />
          {!collapsed && <span>Settings</span>}
        </Link>
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
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem onClick={() => navigate("/settings/change-password")}>
              <KeyRound size={14} className="mr-2" />
              Change Password
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleLogout} className="text-destructive">
              <LogOut size={14} className="mr-2" />
              Log Out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </aside>
  );
}
