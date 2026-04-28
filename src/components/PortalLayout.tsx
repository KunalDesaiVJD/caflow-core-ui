import { useState, useEffect } from "react";
import { Outlet, Link, useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { LogOut, HelpCircle, Home, MessageSquareWarning, FolderOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/portal",         label: "Home",      icon: Home },
  { to: "/portal/queries", label: "Queries",   icon: MessageSquareWarning },
  { to: "/portal/documents", label: "Documents", icon: FolderOpen },
];

export function PortalLayout() {
  const { user, signOut } = useAuth();
  const navigate  = useNavigate();
  const location  = useLocation();
  const [firmName, setFirmName] = useState("");
  const [firmLogo, setFirmLogo] = useState<string | null>(null);
  const [pendingQueryCount, setPendingQueryCount] = useState(0);

  useEffect(() => {
    if (!user?.firm_id) return;
    supabase.from("firms").select("name, settings").eq("id", user.firm_id).maybeSingle().then(({ data }) => {
      if (data) {
        setFirmName(data.name);
        const s = (data.settings || {}) as { logo_url?: string };
        if (s.logo_url) setFirmLogo(s.logo_url);
      }
    });
  }, [user?.firm_id]);

  // Pending query count badge
  useEffect(() => {
    async function fetchCount() {
      const { data: client } = await supabase.from("clients").select("id").eq("user_id", user!.id).maybeSingle();
      if (!client) return;
      const { count } = await supabase
        .from("audit_client_queries")
        .select("id", { count: "exact", head: true })
        .eq("client_id", client.id)
        .in("status", ["Open", "Client Acknowledged"]);
      setPendingQueryCount(count || 0);
    }
    if (user) fetchCount();
  }, [user]);

  const handleLogout = async () => {
    await signOut();
    navigate("/login", { replace: true });
  };

  return (
    <div className="min-h-screen bg-background">
      {/* ── Top navbar ── */}
      <header className="sticky top-0 z-30 h-14 bg-card border-b border-border flex items-center px-4 md:px-6 gap-4">
        <Link to="/portal" className="flex items-center gap-2 shrink-0">
          {firmLogo ? (
            <img src={firmLogo} alt="Firm" className="h-7 w-7 object-contain rounded" />
          ) : (
            <span className="text-primary font-bold text-lg">CA</span>
          )}
          <span className="font-semibold text-foreground text-sm hidden sm:inline">{firmName}</span>
        </Link>

        {/* Navigation tabs */}
        <nav className="flex items-center gap-1 ml-4">
          {NAV.map(({ to, label, icon: Icon }) => {
            const active = to === "/portal"
              ? location.pathname === "/portal"
              : location.pathname.startsWith(to);
            return (
              <Link
                key={to}
                to={to}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors relative",
                  active
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                )}
              >
                <Icon size={14} />
                <span className="hidden sm:inline">{label}</span>
                {label === "Queries" && pendingQueryCount > 0 && (
                  <span className="absolute -top-1 -right-1 h-4 min-w-4 px-1 rounded-full bg-destructive text-destructive-foreground text-[9px] font-bold flex items-center justify-center">
                    {pendingQueryCount > 9 ? "9+" : pendingQueryCount}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        <div className="flex-1" />

        <span className="text-xs text-muted-foreground hidden md:inline truncate max-w-40">
          {user?.name}
        </span>

        <Button variant="ghost" size="sm" onClick={handleLogout} className="text-muted-foreground hover:text-destructive gap-1">
          <LogOut size={15} />
          <span className="hidden sm:inline text-xs">Logout</span>
        </Button>
      </header>

      <main className="max-w-5xl mx-auto p-4 md:p-6">
        <Outlet />
      </main>
    </div>
  );
}
