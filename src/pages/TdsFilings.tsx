import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard, PenLine,
  ShieldCheck, BarChart3, Settings, ClipboardList, Combine, RefreshCw,
} from "lucide-react";
import { TdsRateMaster } from "@/components/tds/TdsRateMaster";
import { TdsDashboard } from "@/components/tds/TdsDashboard";
import { TdsDataEntry } from "@/components/tds/TdsDataEntry";
import { TdsValidateFinalise } from "@/components/tds/TdsValidateFinalise";
import { TdsReports } from "@/components/tds/TdsReports";
import { TdsAuditLog } from "@/components/tds/TdsAuditLog";

interface ClientOption {
  id: string; name: string | null; pan: string | null; tan_number?: string | null;
  // TDS Compliance period — single source of truth for which FY/quarter this
  // client should appear under across the whole TDS module. Undefined start
  // means the client matched only via a fallback path (no proper client_services
  // row) and should not be range-restricted.
  tds_start_fy?: string; tds_start_quarter?: string;
  tds_end_fy?: string; tds_end_quarter?: string;
  // Forms this client is required to file (26Q/24Q/27Q/27EQ). Undefined
  // means no configured range either — never form-restricted either.
  tds_forms_applicable?: string[];
}
interface UserOption { id: string; name: string | null; }

const NAV_ITEMS = [
  { key: "dashboard",  label: "Dashboard",     icon: LayoutDashboard },
  { key: "workspace",  label: "TDS Workspace",  icon: Combine },
  { key: "reports",    label: "Reports",        icon: BarChart3 },
  { key: "rate-master",label: "Rate Master",    icon: Settings },
  { key: "audit-log",  label: "Audit Log",      icon: ClipboardList },
] as const;

type NavKey = typeof NAV_ITEMS[number]["key"];

const TdsFilings = () => {
  const { user } = useAuth();
  
  const [activeSection, setActiveSection] = useState<NavKey>("dashboard");
  // CP-02: sub-tab inside TDS Workspace
  const [workspaceTab, setWorkspaceTab] = useState<"data-entry" | "validate">("data-entry");
  // Increment to force TdsDashboard to re-fetch when returning from workspace
  const [dashRefreshKey, setDashRefreshKey] = useState(0);
  const [syncing, setSyncing] = useState(false);

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
    // TDS Compliance (Edit Client → Service Specific → TDS Compliance) is the
    // single source of truth for TDS module membership: only clients with a
    // real, active client_services row whose service_category has
    // linked_module = "tds" are eligible anywhere in the module — Dashboard,
    // Workspace, Reports, Audit Log, everything shares this one client list.
    //
    // A client matched only by name/TAN (no such row — e.g. a
    // service_category whose linked_module was never wired up to "tds") is
    // NOT TDS-compliance-configured and must not appear or be counted. Those
    // fallback matches are still detected below purely to log a self-heal
    // hint for admins to fix the underlying service_category configuration.
    // 1. Resolve TDS-linked service categories (small table).
    const { data: catData } = await supabase
      .from("service_categories")
      .select("id, linked_module")
      .eq("linked_module", "tds");
    const tdsCatIds = (catData || []).map((c: any) => c.id);
    if (tdsCatIds.length === 0) { setClients([]); return; }

    // 2. Fetch ONLY the TDS client_services rows (filtered by category).
    //    CRITICAL: never fetch all active client_services — a firm can have
    //    >1000 of them and PostgREST's default 1000-row cap would silently
    //    drop rows, making clients whose TDS service fell off the end vanish
    //    from the entire module (this was the "not synchronized" bug). Scoping
    //    to TDS categories keeps the result to only the TDS-configured clients.
    const { data: svcData } = await supabase
      .from("client_services")
      .select("client_id, service_category_id, tds_effective_from_fy, tds_effective_from_q, tds_end_fy, tds_end_quarter, tds_forms_applicable")
      .eq("is_active", true)
      .in("service_category_id", tdsCatIds)
      .limit(20000);

    const activeSvc = (svcData || []) as Array<{
      client_id: string;
      tds_effective_from_fy: string | null; tds_effective_from_q: string | null;
      tds_end_fy: string | null; tds_end_quarter: string | null;
      tds_forms_applicable: string[] | null;
    }>;

    // Compliance period + applicable forms per client (single source of truth).
    const rangeByClient = new Map<string, { tds_start_fy?: string; tds_start_quarter?: string; tds_end_fy?: string; tds_end_quarter?: string; tds_forms_applicable?: string[] }>();
    for (const s of activeSvc) {
      rangeByClient.set(s.client_id, {
        tds_start_fy: s.tds_effective_from_fy || undefined,
        tds_start_quarter: s.tds_effective_from_q || undefined,
        tds_end_fy: s.tds_end_fy || undefined,
        tds_end_quarter: s.tds_end_quarter || undefined,
        tds_forms_applicable: s.tds_forms_applicable && s.tds_forms_applicable.length > 0 ? s.tds_forms_applicable : undefined,
      });
    }

    const tdsClientIds = [...rangeByClient.keys()];
    if (tdsClientIds.length === 0) { setClients([]); return; }

    // 3. Fetch only those TDS clients (by id → no truncation), live only.
    const { data: clientsData } = await supabase
      .from("clients")
      .select("id, name, pan, tan_number")
      .in("id", tdsClientIds)
      .eq("is_draft", false)
      .is("deleted_at", null)
      .order("name")
      .limit(20000);

    const eligible = ((clientsData || []) as ClientOption[]).map(c => ({ ...c, ...rangeByClient.get(c.id) }));

    console.log(`[TDS] Client list: ${eligible.length} eligible (TDS Compliance configured, of ${tdsClientIds.length} TDS service rows)`);

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

  // Pull the latest TDS Compliance config + filing rows and force every child
  // screen (Dashboard KPIs, Client Filing Summary, etc.) to re-read.
  const refreshTdsModule = useCallback(() => {
    fetchClients();
    setDashRefreshKey(k => k + 1);
  }, [fetchClients]);

  // ── Real-time sync ──────────────────────────────────────────────────────
  // TDS Compliance (client_services) is the single source of truth; a DB
  // trigger keeps tds_filings in lock-step. Subscribe to changes on BOTH so
  // the whole TDS module updates the instant a client's compliance changes —
  // from this tab, another tab, or another user — with no navigation or
  // manual refresh. RLS scopes each firm to its own rows.
  useEffect(() => {
    const channel = supabase
      .channel("tds-module-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "client_services" }, refreshTdsModule)
      .on("postgres_changes", { event: "*", schema: "public", table: "tds_filings" }, refreshTdsModule)
      .subscribe((status) => {
        // On (re)connect, pull once so any change that happened while the
        // socket was down is picked up immediately.
        if (status === "SUBSCRIBED") refreshTdsModule();
      });
    return () => { supabase.removeChannel(channel); };
  }, [refreshTdsModule]);

  // Fallback for environments without Realtime (or a dropped socket): refetch
  // when the tab regains focus/visibility, and on bfcache restore (back/fwd).
  useEffect(() => {
    const onVisible = () => { if (!document.hidden) refreshTdsModule(); };
    const onPageShow = () => refreshTdsModule();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [refreshTdsModule]);

  // Guaranteed-eventual sync: even where WebSockets/Realtime are blocked (some
  // corporate networks/proxies) AND the user never switches tabs, poll every
  // 45s while the tab is visible so the module can never stay stale relative
  // to the TDS Compliance config. Paused when the tab is hidden to avoid waste.
  useEffect(() => {
    const POLL_MS = 45000;
    const id = window.setInterval(() => {
      if (!document.hidden) refreshTdsModule();
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [refreshTdsModule]);

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] overflow-hidden">
      <div className="border-b bg-muted/30 shrink-0">
        <div className="flex items-center gap-4 px-4 overflow-x-auto">
          <nav className="flex items-center gap-1 shrink-0">
            {NAV_ITEMS.map(item => (
              <button key={item.key} onClick={() => {
                if (item.key === "dashboard") setDashRefreshKey(k => k + 1);
                setActiveSection(item.key);
              }}
                className={cn("flex items-center gap-1.5 px-3 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap",
                  activeSection === item.key ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground")}>
                <item.icon size={14} className="shrink-0" />
                <span>{item.label}</span>
              </button>
            ))}
          </nav>
          <div className="flex-1" />
          {/* Manual re-sync escape hatch — the module already updates live via
              Realtime, but this lets the user force a fresh read on demand. */}
          <button
            onClick={() => { setSyncing(true); refreshTdsModule(); window.setTimeout(() => setSyncing(false), 800); }}
            title="Re-sync from the latest TDS Compliance settings"
            className="flex items-center gap-1.5 px-2 py-1 text-xs font-medium text-muted-foreground hover:text-foreground shrink-0"
          >
            <RefreshCw size={13} className={cn("shrink-0", syncing && "animate-spin")} />
            <span>{syncing ? "Syncing…" : "Sync"}</span>
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="w-full">
          {activeSection === "dashboard" && (
            <TdsDashboard
              clients={clients} users={users} isSuperadmin={isSuperadmin}
              resolveFirmId={resolveFirmId} refreshKey={dashRefreshKey}
              onNavigate={(section) => {
                // CP-02: "data-entry" and "validate" deep-links now open workspace
                if (section === "data-entry") { setWorkspaceTab("data-entry"); setActiveSection("workspace"); }
                else if (section === "validate") { setWorkspaceTab("validate"); setActiveSection("workspace"); }
                else setActiveSection(section as NavKey);
              }}
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
