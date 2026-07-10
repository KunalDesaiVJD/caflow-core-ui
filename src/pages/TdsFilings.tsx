import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard, PenLine,
  ShieldCheck, BarChart3, Settings, ClipboardList, Combine,
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
      supabase.from("client_services").select("client_id, service_category_id, is_active, tds_effective_from_fy, tds_effective_from_q, tds_end_fy, tds_end_quarter, tds_forms_applicable").eq("is_active", true),
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

    const activeSvc = (svcResp.data || []) as Array<{
      client_id: string; service_category_id: string; is_active: boolean;
      tds_effective_from_fy: string | null; tds_effective_from_q: string | null;
      tds_end_fy: string | null; tds_end_quarter: string | null;
      tds_forms_applicable: string[] | null;
    }>;
    const clientsWithStrictTds = new Set(
      activeSvc.filter(s => tdsStrictCatIds.has(s.service_category_id)).map(s => s.client_id),
    );
    const clientsWithNameMatchTds = new Set(
      activeSvc.filter(s => tdsNameCatIds.has(s.service_category_id)).map(s => s.client_id),
    );
    // Compliance period + applicable forms per client, from the strict TDS client_services row.
    const rangeByClient = new Map<string, { tds_start_fy?: string; tds_start_quarter?: string; tds_end_fy?: string; tds_end_quarter?: string; tds_forms_applicable?: string[] }>();
    for (const s of activeSvc) {
      if (!tdsStrictCatIds.has(s.service_category_id)) continue;
      rangeByClient.set(s.client_id, {
        tds_start_fy: s.tds_effective_from_fy || undefined,
        tds_start_quarter: s.tds_effective_from_q || undefined,
        tds_end_fy: s.tds_end_fy || undefined,
        tds_end_quarter: s.tds_end_quarter || undefined,
        tds_forms_applicable: s.tds_forms_applicable && s.tds_forms_applicable.length > 0 ? s.tds_forms_applicable : undefined,
      });
    }

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
    }).map(c => ({ ...c, ...rangeByClient.get(c.id) }));

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
