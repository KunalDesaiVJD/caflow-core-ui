import { useState, useEffect } from "react";
import { Outlet, Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { LogOut, HelpCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

export function PortalLayout() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [firmName, setFirmName] = useState("");
  const [firmLogo, setFirmLogo] = useState<string | null>(null);

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

  const handleLogout = async () => {
    await signOut();
    navigate("/login", { replace: true });
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Top navbar */}
      <header className="sticky top-0 z-30 h-16 bg-card border-b border-border flex items-center px-4 md:px-6 gap-4">
        <Link to="/portal" className="flex items-center gap-2 shrink-0">
          {firmLogo ? (
            <img src={firmLogo} alt="Firm" className="h-8 w-8 object-contain rounded" />
          ) : (
            <span className="text-primary font-bold text-xl">CA</span>
          )}
          <span className="font-semibold text-foreground text-sm hidden sm:inline">{firmName}</span>
        </Link>

        <div className="flex-1" />

        <span className="text-sm text-muted-foreground hidden md:inline truncate max-w-48">
          {user?.name}
        </span>

        <Button variant="ghost" size="sm" asChild>
          <a href="mailto:support@example.com" className="flex items-center gap-1.5 text-muted-foreground">
            <HelpCircle size={16} />
            <span className="hidden sm:inline">Help</span>
          </a>
        </Button>

        <Button variant="ghost" size="sm" onClick={handleLogout} className="text-destructive">
          <LogOut size={16} />
          <span className="hidden sm:inline ml-1.5">Logout</span>
        </Button>
      </header>

      <main className="max-w-5xl mx-auto p-4 md:p-6">
        <Outlet />
      </main>
    </div>
  );
}
