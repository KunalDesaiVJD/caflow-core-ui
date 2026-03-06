import { useState, useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
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
} from "lucide-react";
import { cn } from "@/lib/utils";

const navItems = [
  { title: "Dashboard", path: "/", icon: LayoutDashboard },
  { title: "Clients", path: "/clients", icon: Users },
  { title: "TDS Filings", path: "/tds-filings", icon: Receipt },
  { title: "IT Returns", path: "/it-returns", icon: FileText },
  { title: "Billing", path: "/billing", icon: CreditCard },
  { title: "ERP Ledger", path: "/erp-ledger", icon: BookOpen },
  { title: "Audit Intelligence", path: "/audit-intelligence", icon: Search, premium: true },
];

const settingsItem = { title: "Settings", path: "/settings", icon: Settings };

interface AppSidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

export function AppSidebar({ collapsed, onToggle }: AppSidebarProps) {
  const location = useLocation();

  const isActive = (path: string) =>
    path === "/" ? location.pathname === "/" : location.pathname.startsWith(path);

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
          <span className="text-sidebar-gold font-display font-bold text-xl tracking-tight shrink-0">CA</span>
          {!collapsed && (
            <span className="text-sidebar-foreground font-display font-semibold text-lg tracking-tight">Flow</span>
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
      <nav className="flex-1 py-4 flex flex-col gap-1 px-2 overflow-hidden">
        {navItems.map((item) => (
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
            <item.icon
              size={20}
              className={cn(
                "shrink-0 transition-colors",
                item.premium && "text-sidebar-gold",
                isActive(item.path) && "text-sidebar-gold"
              )}
            />
            {!collapsed && (
              <span className="truncate">
                {item.title}
                {item.premium && (
                  <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-sidebar-gold/20 text-sidebar-gold font-semibold uppercase tracking-wider">
                    Pro
                  </span>
                )}
              </span>
            )}
          </Link>
        ))}

        <div className="flex-1" />

        {/* Settings */}
        <Link
          to={settingsItem.path}
          className={cn(
            "flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-all duration-200",
            isActive(settingsItem.path)
              ? "bg-sidebar-gold/15 text-sidebar-gold"
              : "text-sidebar-foreground hover:bg-sidebar-hover hover:text-sidebar-gold-foreground"
          )}
        >
          <settingsItem.icon size={20} className="shrink-0" />
          {!collapsed && <span>Settings</span>}
        </Link>
      </nav>

      {/* User section */}
      <div className="border-t border-sidebar-border p-3">
        <div className="flex items-center gap-3 overflow-hidden">
          <div className="w-9 h-9 rounded-full bg-sidebar-gold/20 flex items-center justify-center text-sidebar-gold font-semibold text-sm shrink-0">
            RS
          </div>
          {!collapsed && (
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-sidebar-foreground truncate">Rajesh Sharma</p>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-sidebar-gold/20 text-sidebar-gold font-semibold uppercase tracking-wider">
                Admin
              </span>
            </div>
          )}
          {!collapsed && (
            <button className="text-sidebar-foreground hover:text-destructive transition-colors shrink-0">
              <LogOut size={16} />
            </button>
          )}
        </div>
      </div>
    </aside>
  );
}
