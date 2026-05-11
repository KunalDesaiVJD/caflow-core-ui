/**
 * PortalLayout — Client-facing shell
 *
 * Theme: matches CA firm dark-navy (#1A2744) + orange-600 brand colours.
 * Multi-entity: shows an entity switcher in the navbar when the user has
 * more than one client linked (e.g. family / group accounts).
 */

import { useState, useEffect } from "react";
import { Outlet, Link, useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { PortalClientProvider, usePortalClient } from "@/contexts/PortalClientContext";
import {
  LogOut, Home, MessageSquareWarning, FolderOpen,
  ChevronDown, Building2, Check, Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

// ─── Nav items ────────────────────────────────────────────────────────────────

const NAV = [
  { to: "/portal",           label: "Home",      icon: Home,                  exact: true  },
  { to: "/portal/queries",   label: "Queries",   icon: MessageSquareWarning,  exact: false },
  { to: "/portal/documents", label: "Documents", icon: FolderOpen,            exact: false },
];

// ─── Entity Switcher ──────────────────────────────────────────────────────────

function EntitySwitcher() {
  const { clients, activeClient, setActiveById, loading } = usePortalClient();

  if (loading) {
    return (
      <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-white/10 text-white/70 text-xs">
        <Loader2 size={12} className="animate-spin" />
        <span>Loading…</span>
      </div>
    );
  }

  // Single entity — just show name as static badge
  if (clients.length <= 1) {
    return (
      <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-white/10 text-white text-xs font-medium max-w-[180px]">
        <Building2 size={12} className="shrink-0 text-orange-300" />
        <span className="truncate">{activeClient?.name || "—"}</span>
      </div>
    );
  }

  // Multiple entities — dropdown switcher
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-white/10 hover:bg-white/20 transition-colors text-white text-xs font-medium max-w-[220px] group"
        >
          <Building2 size={12} className="shrink-0 text-orange-300 flex-shrink-0" />
          <span className="truncate flex-1 text-left">{activeClient?.name || "Select entity"}</span>
          <ChevronDown size={11} className="shrink-0 text-white/60 group-hover:text-white transition-colors" />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="w-72 max-h-96 overflow-y-auto">
        <DropdownMenuLabel className="text-xs font-semibold text-muted-foreground">
          Your Entities ({clients.length})
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {clients.map(client => (
          <DropdownMenuItem
            key={client.id}
            onClick={() => setActiveById(client.id)}
            className="gap-2 cursor-pointer"
          >
            <Building2 size={13} className="shrink-0 text-orange-600" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{client.name}</p>
              {client.client_type && (
                <p className="text-[10px] text-muted-foreground capitalize">
                  {client.client_type.replace(/_/g, " ")}
                </p>
              )}
            </div>
            {activeClient?.id === client.id && (
              <Check size={13} className="shrink-0 text-orange-600" />
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ─── Pending badge (queries) ──────────────────────────────────────────────────

function PendingBadge() {
  const { activeClient } = usePortalClient();
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!activeClient?.id) { setCount(0); return; }
    supabase
      .from("audit_client_queries" as any)
      .select("id", { count: "exact", head: true })
      .eq("client_id", activeClient.id)
      .in("status", ["Open", "Client Acknowledged"])
      .then(({ count: c }) => setCount(c || 0));
  }, [activeClient?.id]);

  if (!count) return null;
  return (
    <span className="absolute -top-1 -right-1 h-4 min-w-4 px-1 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center">
      {count > 9 ? "9+" : count}
    </span>
  );
}

// ─── Inner shell (has access to PortalClientContext) ─────────────────────────

function PortalShell() {
  const { user, signOut } = useAuth();
  const navigate  = useNavigate();
  const location  = useLocation();
  const [firmName, setFirmName] = useState("");
  const [firmLogo, setFirmLogo] = useState<string | null>(null);
  const { activeClient } = usePortalClient();

  // Load firm branding once we have a firm_id
  useEffect(() => {
    const fid = activeClient?.firm_id || user?.firm_id;
    if (!fid) return;
    supabase
      .from("firms")
      .select("name, settings")
      .eq("id", fid)
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          setFirmName(data.name);
          const s = (data.settings || {}) as { logo_url?: string };
          if (s.logo_url) setFirmLogo(s.logo_url);
        }
      });
  }, [activeClient?.firm_id, user?.firm_id]);

  const handleLogout = async () => {
    await signOut();
    navigate("/login", { replace: true });
  };

  return (
    <div className="min-h-screen bg-gray-50">

      {/* ── Top navbar: CA navy theme ── */}
      <header className="sticky top-0 z-30 h-14 bg-[#1A2744] border-b border-[#1A2744]/80 flex items-center px-4 md:px-6 gap-3 shadow-lg">

        {/* Logo + Firm name */}
        <Link to="/portal" className="flex items-center gap-2 shrink-0">
          {firmLogo ? (
            <img src={firmLogo} alt="Firm" className="h-7 w-7 object-contain rounded bg-white/10 p-0.5" />
          ) : (
            <div className="h-7 w-7 rounded bg-orange-600 flex items-center justify-center">
              <span className="text-white font-bold text-sm">CA</span>
            </div>
          )}
          <span className="font-semibold text-white text-sm hidden sm:inline truncate max-w-32">
            {firmName || "Client Portal"}
          </span>
        </Link>

        {/* Divider */}
        <div className="h-5 w-px bg-white/20 hidden sm:block" />

        {/* Entity switcher */}
        <EntitySwitcher />

        {/* Nav links */}
        <nav className="flex items-center gap-0.5 ml-2">
          {NAV.map(({ to, label, icon: Icon, exact }) => {
            const active = exact
              ? location.pathname === to
              : location.pathname.startsWith(to);
            return (
              <Link
                key={to}
                to={to}
                className={cn(
                  "relative flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
                  active
                    ? "bg-orange-600 text-white"
                    : "text-white/70 hover:text-white hover:bg-white/10",
                )}
              >
                <Icon size={14} />
                <span className="hidden md:inline">{label}</span>
                {label === "Queries" && <PendingBadge />}
              </Link>
            );
          })}
        </nav>

        <div className="flex-1" />

        {/* User name */}
        <span className="text-xs text-white/60 hidden lg:inline truncate max-w-36">
          {user?.name || user?.email}
        </span>

        {/* Logout */}
        <Button
          variant="ghost"
          size="sm"
          onClick={handleLogout}
          className="text-white/70 hover:text-white hover:bg-white/10 gap-1"
        >
          <LogOut size={15} />
          <span className="hidden sm:inline text-xs">Logout</span>
        </Button>
      </header>

      {/* ── Page content ── */}
      <main className="max-w-5xl mx-auto p-4 md:p-6">
        <Outlet />
      </main>

      {/* ── Footer ── */}
      <footer className="border-t bg-white mt-8 py-3 text-center text-[11px] text-muted-foreground">
        Powered by <span className="font-semibold text-[#1A2744]">CAFlow</span>
        {firmName && <> · {firmName}</>}
      </footer>
    </div>
  );
}

// ─── Public export: wraps shell with context provider ─────────────────────────

export function PortalLayout() {
  return (
    <PortalClientProvider>
      <PortalShell />
    </PortalClientProvider>
  );
}
