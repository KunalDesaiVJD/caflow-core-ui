import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  FileText, LayoutDashboard, PenLine,
  ShieldCheck, BarChart3, Settings, ClipboardList, Combine,
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
  { key: "dashboard",  label: "Dashboard",     icon: LayoutDashboard },
  { key: "filings",    label: "Filings",        icon: FileText },
  { key: "workspace",  label: "TDS Workspace",  icon: Combine },
  { key: "reports",    label: "Reports",        icon: BarChart3 },
  { key: "rate-master",label: "Rate Master",    icon: Settings },
  { key: "audit-log",  label: "Audit Log",      icon: ClipboardList },
] as const;

type NavKey = typeof NAV_ITEMS[number]["key"];

const TdsFilings = () => {
  const { user } = useAuth();
  
  const [activeSection, setActiveSection] = useState<NavKey>("dashboard");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  // CP-02: sub-tab inside TDS Workspace
  const [workspaceTab, setWorkspaceTab] = useState<"data-entry" | "validate">("data-entry");
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
    // A client is eligible for the TDS module if EITHER:
    //   (a) they have an active client_services row whose service_category has
    //       linked_module = "tds" (the strict/expected path), OR
    //   (b) they have a non-empty TAN number AND at least one active service
    //       whose category name/code contains "TDS" (fallback for firms whose
    //       service_category rows were created without linked_module properly
    //       wired up, or got its linked_module value overwritten).
    //
    // Without fallback (b), a client whose service was activated but whose
    // service_category.linked_module isn't set to "tds" (due to earlier
    // migration/seed quirks) would silently disappear from this dropdown
    // even though the client-detail "Service Activation" screen shows TDS
    // active. The fallback restores those clients.
    const [svcResp, catResp, clientsResp] = await Promise.all([
      supabase.from("client_services").select("client_id, service_category_id, is_active").eq("is_active", true),
      supabase.from("service_categories").select("id, linked_module, name, category_code"),
      supabase.from("clients").select("id, name, pan, tan_number").eq("is_draft", false).is("deleted_at", null).order("name"),
    ]);

    const allCategories = (catResp.data || []) as Array<{ id: string; linked_module: string | null; name: string | null; category_code: string | null }>;
    const tdsStrictCatIds = new Set(allCategories.filter(c => c.linked_module === "tds").map(c => c.id));
    const tdsNameCatIds = new Set(
      allCategories
        .filter(c => {
          const n = (c.name || "").toLowerCase();
          const cc = (c.category_code || "").toLowerCase();
          return n.includes("tds") || cc === "tds";
        })
        .map(c => c.id),
    );

    const activeSvc = (svcResp.data || []) as Array<{ client_id: string; service_category_id: string; is_active: boolean }>;
    const clientsWithStrictTds = new Set(
      activeSvc.filter(s => tdsStrictCatIds.has(s.service_category_id)).map(s => s.client_id),
    );
    const clientsWithNameMatchTds = new Set(
      activeSvc.filter(s => tdsNameCatIds.has(s.service_category_id)).map(s => s.client_id),
    );

    const allClients = (clientsResp.data || []) as ClientOption[];
    const eligible = allClients.filter(c => {
      // 1. Strict — service linked_module === "tds"  (ideal)
      if (clientsWithStrictTds.has(c.id)) return true;
      // 2. Name/code fallback — active service whose category mentions "TDS"
      //    (catches firms where linked_module was never set or was wiped)
      if (clientsWithNameMatchTds.has(c.id)) return true;
      // 3. TAN fallback — client has a TAN number. TAN is only ever issued
      //    for TDS/TCS purposes, so its presence is a strong TDS signal.
      //    Covers edge cases where the client_services row exists but the
      //    query path above missed it (e.g., RLS, stale cache, etc.).
      if ((c.tan_number || "").trim()) return true;
      return false;
    });

    // Self-heal hint: log clients that matched only via a fallback path so
    // the developer can see which service_category rows need linked_module
    // fixed. Strict path works for correctly-configured firms and doesn't log.
    const fallbackOnly = eligible.filter(c => !clientsWithStrictTds.has(c.id));
    if (fallbackOnly.length > 0) {
      console.warn(
        `[TDS] ${fallbackOnly.length} client(s) matched TDS only via fallback ` +
        `(name match or TAN number). Fix their service_category.linked_module ` +
        `in Service Masters to 'tds':`,
        fallbackOnly.map(c => c.name).filter(Boolean),
      );
    }
    console.log(
      `[TDS] Client dropdown: ${eligible.length} eligible | ` +
      `${clientsWithStrictTds.size} strict | ${clientsWithNameMatchTds.size} name-match | ` +
      `${allClients.filter(c => (c.tan_number || "").trim()).length} with TAN`
    );

    setClients(eligible);
  }, [resolveFirmId]);

  const fetchUsers = useCallback(async () => {
    const firmId = await resolveFirmId();
    let q = supabase.from("users").select("id, name").eq("is_active", true);
    if (!isSuperadmin && firmId) q = q.eq("firm_id", firmId);
    const { data } = await q;
    setUsers((data as UserOption[]) || []);
  }, [isSuperadmin, resolveFirmId]);

  useEffect(() => { fetchClients(); fetchUsers(); }, [fetchClients, fetchUsers]);

  // Re-fetch when the tab becomes visible again (user switches away to
  // activate TDS on a client, then comes back — dropdown should update).
  useEffect(() => {
    const onVisible = () => { if (!document.hidden) fetchClients(); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [fetchClients]);

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
          {activeSection === "dashboard" && (
            <TdsDashboard
              clients={clients} users={users} isSuperadmin={isSuperadmin}
              resolveFirmId={resolveFirmId}
              onNavigate={(section) => {
                // CP-02: "data-entry" and "validate" deep-links now open workspace
                if (section === "data-entry") { setWorkspaceTab("data-entry"); setActiveSection("workspace"); }
                else if (section === "validate") { setWorkspaceTab("validate"); setActiveSection("workspace"); }
                else setActiveSection(section as NavKey);
              }}
            />
          )}
          {activeSection === "filings" && (
            <TdsFilingsManager
              clients={clients} users={users} isSuperadmin={isSuperadmin}
              resolveFirmId={resolveFirmId}
              onNavigateDataEntry={() => { setWorkspaceTab("data-entry"); setActiveSection("workspace"); }}
            />
          )}

          {/* ── CP-02: TDS Workspace — Data Entry + Validate & Finalise in tabs ── */}
          {activeSection === "workspace" && (
            <div>
              {/* Tab bar */}
              <div className="flex border-b mb-4">
                <button
                  onClick={() => setWorkspaceTab("data-entry")}
                  className={cn(
                    "px-5 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors",
                    workspaceTab === "data-entry"
                      ? "border-primary text-primary"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  )}
                >
                  <span className="flex items-center gap-2">
                    <PenLine size={14} /> Data Entry
                  </span>
                </button>
                <button
                  onClick={() => setWorkspaceTab("validate")}
                  className={cn(
                    "px-5 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors",
                    workspaceTab === "validate"
                      ? "border-primary text-primary"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  )}
                >
                  <span className="flex items-center gap-2">
                    <ShieldCheck size={14} /> Validate &amp; Finalise
                  </span>
                </button>
              </div>

              {/* Tab content — rendered but hidden so state is preserved on switch */}
              <div className={workspaceTab === "data-entry" ? "" : "hidden"}>
                <TdsDataEntry
                  clients={clients} users={users}
                  isSuperadmin={isSuperadmin} resolveFirmId={resolveFirmId}
                />
              </div>
              <div className={workspaceTab === "validate" ? "" : "hidden"}>
                <TdsValidateFinalise
                  clients={clients} isSuperadmin={isSuperadmin}
                  resolveFirmId={resolveFirmId}
                  onNavigateDataEntry={() => setWorkspaceTab("data-entry")}
                />
              </div>
            </div>
          )}

          {activeSection === "reports" && <TdsReports clients={clients} isSuperadmin={isSuperadmin} resolveFirmId={resolveFirmId} />}
          {activeSection === "rate-master" && <TdsRateMaster resolveFirmId={resolveFirmId} isSuperadmin={isSuperadmin} />}
          {activeSection === "audit-log" && <TdsAuditLog clients={clients} users={users} isSuperadmin={isSuperadmin} resolveFirmId={resolveFirmId} />}
        </div>
      </div>
    </div>
  );
};

export default TdsFilings;
