import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  FileText, LayoutDashboard, PenLine,
  ShieldCheck, BarChart3, Settings, Database, ClipboardList,
} from "lucide-react";
import { TdsRateMaster } from "@/components/tds/TdsRateMaster";
import { TdsDashboard } from "@/components/tds/TdsDashboard";
import { TdsFilingsManager } from "@/components/tds/TdsFilingsManager";
import { TdsDataEntry } from "@/components/tds/TdsDataEntry";
import { TdsValidateFinalise } from "@/components/tds/TdsValidateFinalise";
import { TdsReports } from "@/components/tds/TdsReports";
import { TdsAuditLog } from "@/components/tds/TdsAuditLog";

interface ClientOption { id: string; name: string | null; pan: string | null; tan_number?: string | null; }
interface UserOption { id: string; name: string | null; }

const NAV_ITEMS = [
  { key: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { key: "filings", label: "Filings", icon: FileText },
  { key: "data-entry", label: "Data Entry", icon: PenLine },
  { key: "validate", label: "Validate & Finalise", icon: ShieldCheck },
  { key: "reports", label: "Reports", icon: BarChart3 },
  { key: "rate-master", label: "Rate Master", icon: Settings },
  { key: "audit-log", label: "Audit Log", icon: ClipboardList },
] as const;

type NavKey = typeof NAV_ITEMS[number]["key"];

const TdsFilings = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [activeSection, setActiveSection] = useState<NavKey>("dashboard");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  /* DEPRECATED - migration moved to Filings section Options dropdown */

  const [clients, setClients] = useState<ClientOption[]>([]);
  const [users, setUsers] = useState<UserOption[]>([]);
  const isSuperadmin = user?.role === "superadmin";

  const resolveFirmId = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    const metadataFirmId = session?.user?.user_metadata?.firm_id;
    if (typeof metadataFirmId === "string" && metadataFirmId.length > 0) return metadataFirmId;
    return user?.firm_id ?? null;
  }, [user?.firm_id]);

  const fetchClients = useCallback(async () => {
    const { data: svcData } = await supabase.from("client_services").select("client_id, service_category_id, is_active").eq("is_active", true);
    const { data: categories } = await supabase.from("service_categories").select("id, linked_module").eq("linked_module", "tds");
    const tdsCatIds = new Set((categories || []).map(c => c.id));
    const tdsClientIds = (svcData || []).filter(s => tdsCatIds.has(s.service_category_id)).map(s => s.client_id);
    if (tdsClientIds.length === 0) { setClients([]); return; }
    const q = supabase.from("clients").select("id, name, pan, tan_number").eq("is_draft", false).is("deleted_at", null).in("id", tdsClientIds).order("name");
    const { data } = await q;
    setClients((data as ClientOption[]) || []);
  }, [resolveFirmId]);

  const fetchUsers = useCallback(async () => {
    const firmId = await resolveFirmId();
    let q = supabase.from("users").select("id, name").eq("is_active", true);
    if (!isSuperadmin && firmId) q = q.eq("firm_id", firmId);
    const { data } = await q;
    setUsers((data as UserOption[]) || []);
  }, [isSuperadmin, resolveFirmId]);

  useEffect(() => { fetchClients(); fetchUsers(); }, [fetchClients, fetchUsers]);

  return (
    <div className="flex h-[calc(100vh-4rem)] overflow-hidden">
      <div className={cn("border-r bg-muted/30 flex flex-col shrink-0 transition-all duration-200", sidebarCollapsed ? "w-14" : "w-48")}>
        <div className="p-3 border-b flex items-center justify-between">
          {!sidebarCollapsed && <span className="text-sm font-semibold text-foreground">TDS Module</span>}
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setSidebarCollapsed(!sidebarCollapsed)}>
            <FileText size={14} />
          </Button>
        </div>
        <nav className="flex-1 py-2 space-y-0.5 px-2">
          {NAV_ITEMS.map(item => (
            <button key={item.key} onClick={() => setActiveSection(item.key)}
              className={cn("w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-sm transition-colors",
                activeSection === item.key ? "bg-primary text-primary-foreground font-medium" : "text-muted-foreground hover:bg-muted hover:text-foreground")}>
              <item.icon size={16} className="shrink-0" />
              {!sidebarCollapsed && <span>{item.label}</span>}
            </button>
          ))}
        </nav>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-[1400px] mx-auto">
          {activeSection === "dashboard" && <TdsDashboard clients={clients} users={users} isSuperadmin={isSuperadmin} resolveFirmId={resolveFirmId} onNavigate={(section) => setActiveSection(section as NavKey)} />}
          {activeSection === "filings" && <TdsFilingsManager clients={clients} users={users} isSuperadmin={isSuperadmin} resolveFirmId={resolveFirmId} onNavigateDataEntry={() => setActiveSection("data-entry")} />}
          {activeSection === "data-entry" && <TdsDataEntry clients={clients} users={users} isSuperadmin={isSuperadmin} resolveFirmId={resolveFirmId} />}
          {activeSection === "validate" && <TdsValidateFinalise clients={clients} isSuperadmin={isSuperadmin} resolveFirmId={resolveFirmId} onNavigateDataEntry={() => setActiveSection("data-entry")} />}
          {activeSection === "reports" && <TdsReports clients={clients} isSuperadmin={isSuperadmin} resolveFirmId={resolveFirmId} />}
          {activeSection === "rate-master" && <TdsRateMaster resolveFirmId={resolveFirmId} isSuperadmin={isSuperadmin} />}
          {activeSection === "audit-log" && <TdsAuditLog clients={clients} users={users} isSuperadmin={isSuperadmin} resolveFirmId={resolveFirmId} />}
        </div>
      </div>
    </div>
  );
};

export default TdsFilings;
