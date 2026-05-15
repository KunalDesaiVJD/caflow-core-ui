/**
 * PortalLayout — Client-facing shell
 *
 * Theme: matches CA firm employee sidebar — dark navy (#0A131E) + amber/gold
 * accent, consistent with --sidebar-background and --sidebar-gold CSS vars.
 *
 * Multi-entity: entity switcher with live search (critical for accounts with
 * 60+ client entities linked by shared email).
 */

import { useState, useEffect, useMemo } from "react";
import { Outlet, Link, useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { PortalClientProvider, usePortalClient } from "@/contexts/PortalClientContext";
import {
  LogOut, Home, MessageSquareWarning, FolderOpen,
  ChevronDown, Building2, Check, Loader2, Search,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

// ─── Brand constants ───────────────────────────────────────────────────────────

const NAVY  = "#0A131E";   // matches --sidebar-background: 214 48% 8%
const GOLD  = "#C7A24D";   // matches --sidebar-gold: 42 52% 54%

// ─── Nav items ────────────────────────────────────────────────────────────────

const NAV = [
  { to: "/portal",           label: "Home",      icon: Home,                 exact: true  },
  { to: "/portal/queries",   label: "Queries",   icon: MessageSquareWarning, exact: false },
  { to: "/portal/documents", label: "Documents", icon: FolderOpen,           exact: false },
];

// ─── Entity Switcher ──────────────────────────────────────────────────────────

function EntitySwitcher() {
  const { clients, activeClient, setActiveById, loading } = usePortalClient();
  const [search, setSearch] = useState("");
  const [open,   setOpen]   = useState(false);

  const filtered = useMemo(() => {
    if (!search.trim()) return clients;
    const q = search.toLowerCase();
    return clients.filter(c => c.name.toLowerCase().includes(q));
  }, [clients, search]);

  if (loading) {
    return (
      <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-white/10 text-white/60 text-xs">
        <Loader2 size={12} className="animate-spin" />
        <span>Loading…</span>
      </div>
    );
  }

  // Single entity — static badge
  if (clients.length <= 1) {
    return (
      <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-white/10 text-white text-xs font-medium max-w-[200px]">
        <Building2 size={12} className="shrink-0" style={{ color: GOLD }} />
        <span className="truncate">{activeClient?.name || "—"}</span>
      </div>
    );
  }

  // Multiple entities — searchable dropdown
  return (
    <DropdownMenu open={open} onOpenChange={(v) => { setOpen(v); if (!v) setSearch(""); }}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-white/10 hover:bg-white/20 transition-colors text-white text-xs font-medium max-w-[220px] group"
        >
          <Building2 size={12} className="shrink-0 flex-shrink-0" style={{ color: GOLD }} />
          <span className="truncate flex-1 text-left">{activeClient?.name || "Select entity"}</span>
          <span className="shrink-0 text-white/50 text-[10px] font-normal ml-1 hidden sm:inline">
            ({clients.length})
          </span>
          <ChevronDown size={11} className="shrink-0 text-white/50 group-hover:text-white transition-colors ml-0.5" />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="w-80 p-0" sideOffset={6}>
        {/* Search header */}
        <div className="p-2 border-b">
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              autoFocus
              placeholder={`Search ${clients.length} entities…`}
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="h-8 text-xs pl-8"
            />
          </div>
        </div>

        {/* Entity list */}
        <div className="max-h-72 overflow-y-auto py-1">
          {filtered.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-4">No entities found</p>
          ) : (
            filtered.map(client => (
              <button
                key={client.id}
                type="button"
                onClick={() => { setActiveById(client.id); setOpen(false); setSearch(""); }}
                className={cn(
                  "w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-muted transition-colors",
                  activeClient?.id === client.id && "bg-amber-50",
                )}
              >
                <Building2 size={13} className="shrink-0 text-amber-600 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className={cn(
                    "text-sm font-medium truncate",
                    activeClient?.id === client.id ? "text-amber-700" : "text-foreground",
                  )}>
                    {client.name}
                  </p>
                  {client.client_type && (
                    <p className="text-[10px] text-muted-foreground capitalize">
                      {client.client_type.replace(/_/g, " ")}
                    </p>
                  )}
                </div>
                {activeClient?.id === client.id && (
                  <Check size={13} className="shrink-0 text-amber-600" />
                )}
              </button>
            ))
          )}
        </div>

        {filtered.length < clients.length && (
          <div className="border-t px-3 py-1.5">
            <p className="text-[10px] text-muted-foreground">
              Showing {filtered.length} of {clients.length} entities
            </p>
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ─── Pending badge (queries) ──────────────────────────────────────────────────

function PendingBadge() {
  const { allClientIds } = usePortalClient();
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!allClientIds.length) { setCount(0); return; }
    supabase
      .from("audit_client_queries" as any)
      .select("id", { count: "exact", head: true })
      .in("client_id", allClientIds)
      .in("status", ["Open", "Client Acknowledged"])
      .then(({ count: c }) => setCount(c || 0));
  }, [allClientIds]);

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
    <div className="min-h-screen bg-slate-50">

      {/* ── Top navbar: dark navy matching employee sidebar ── */}
      <header
        className="sticky top-0 z-30 h-14 flex items-center px-4 md:px-6 gap-3 shadow-lg"
        style={{ backgroundColor: NAVY, borderBottom: `1px solid rgba(255,255,255,0.06)` }}
      >
        {/* Logo + Firm name */}
        <Link to="/portal" className="flex items-center gap-2.5 shrink-0">
          {firmLogo ? (
            <img src={firmLogo} alt="Firm" className="h-7 w-7 object-contain rounded bg-white/10 p-0.5" />
          ) : (
            <div className="h-7 w-7 rounded flex items-center justify-center font-bold text-sm text-white"
                 style={{ backgroundColor: GOLD }}>
              CA
            </div>
          )}
          <span className="font-semibold text-white text-sm hidden sm:inline truncate max-w-36">
            {firmName || "Client Portal"}
          </span>
        </Link>

        {/* Divider */}
        <div className="h-5 w-px bg-white/15 hidden sm:block" />

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
                    ? "text-white"
                    : "text-white/60 hover:text-white hover:bg-white/8",
                )}
                style={active ? { backgroundColor: GOLD } : undefined}
              >
                <Icon size={14} />
                <span className="hidden md:inline">{label}</span>
                {label === "Queries" && <PendingBadge />}
              </Link>
            );
          })}
        </nav>

        <div className="flex-1" />

        {/* User info */}
        <span className="text-xs text-white/50 hidden lg:inline truncate max-w-36">
          {user?.name || user?.email}
        </span>

        {/* Logout */}
        <Button
          variant="ghost"
          size="sm"
          onClick={handleLogout}
          className="text-white/60 hover:text-white hover:bg-white/10 gap-1.5 text-xs"
        >
          <LogOut size={14} />
          <span className="hidden sm:inline">Logout</span>
        </Button>
      </header>

      {/* ── Page content ── */}
      <main className="max-w-5xl mx-auto px-4 py-6 md:px-6 md:py-8">
        <Outlet />
      </main>

      {/* ── Footer ── */}
      <footer className="border-t bg-white mt-10 py-3 text-center text-[11px] text-muted-foreground">
        Powered by{" "}
        <span className="font-semibold" style={{ color: NAVY }}>CAFlow</span>
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
