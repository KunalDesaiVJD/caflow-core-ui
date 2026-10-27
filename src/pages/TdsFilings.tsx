import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { getDefaultTdsQuarter } from "@/lib/tdsQuarter";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import {
  LayoutDashboard, PenLine,
  ShieldCheck, BadgeCheck, BarChart3, Settings, ClipboardList, Combine, RefreshCw, Repeat2,
  FileEdit, Mail, Home,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { TdsRateMaster } from "@/components/tds/TdsRateMaster";
import { TdsDashboard } from "@/components/tds/TdsDashboard";
import { TdsDataEntry, CORRECTION_TDS_SOURCE } from "@/components/tds/TdsDataEntry";
import { TdsValidateFinalise } from "@/components/tds/TdsValidateFinalise";
import { TdsReports } from "@/components/tds/TdsReports";
import { TdsAuditLog } from "@/components/tds/TdsAuditLog";
import { TdsOverrides } from "@/components/tds/TdsOverrides";
import { TdsCorrectionsModule } from "@/components/tds/TdsCorrectionsModule";
import { TdsPortalLoginButtons } from "@/components/tds/TdsPortalLoginButtons";
import { TdsPropertyModule } from "@/components/tds/property/TdsPropertyModule";
import { TdsEmailSettingsPage } from "@/pages/TdsEmailSettingsPage";
import { TdsQueryEmailDialog, type TdsQueryContext } from "@/components/tds/TdsQueryEmailDialog";
import { Button } from "@/components/ui/button";

interface ClientOption {
  id: string; name: string | null; pan: string | null; tan_number?: string | null;
  // Identity fields shown in the Client Filing Summary's Client Name hover
  // card (TAN/PAN/Contact/Mobile/Email).
  contact_person?: string | null; mobile?: string | null; email?: string | null;
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
  // TDS on transfer of immovable property — Form 141 Schedule B, s.393(1).
  // Its OWN section, not a tab inside the Workspace: this is filed under the
  // buyer's PAN (no TAN), the period is a MONTH rather than a quarter, and the
  // challan is the statement. Nothing in the quarterly return spine applies to
  // it, so mixing the two would give every column header two meanings.
  { key: "property",   label: "TDS on Property", icon: Home },
  // Audit Log + Overrides live under ONE nav tab ("Audit & Overrides") with sub-tabs —
  // same pattern as TDS Workspace (Data Entry / Validate & Finalise). Both read
  // the same override/action history, so splitting them across two top-level
  // tabs only made the user hop between them.
  { key: "activity",   label: "Audit & Overrides", icon: ClipboardList },
  // Revises data already FILED for an earlier period. Distinct from Overrides,
  // which records manual verdict overrides during validation.
  { key: "corrections",label: "Recommendations & Corrections",    icon: FileEdit },
  { key: "rate-master",label: "Rate Master",    icon: Settings },
  { key: "email-settings", label: "Email Settings", icon: Mail },
  // Reports sits last — everything above it is data entry/compliance
  // workflow (Dashboard through Email Settings); Reports is the read-only
  // reporting layer over all of it.
  { key: "reports",    label: "Reports",        icon: BarChart3 },
] as const;

type NavKey = typeof NAV_ITEMS[number]["key"];

const TdsFilings = () => {
  const { user } = useAuth();
  
  const [activeSection, setActiveSection] = useState<NavKey>("dashboard");
  // CP-02: sub-tab inside TDS Workspace
  const [workspaceTab, setWorkspaceTab] = useState<"data-entry" | "validate" | "correction">("data-entry");

  // Sub-tab inside Audit & Overrides
  const [activityTab, setActivityTab] = useState<"audit-log" | "overrides">("audit-log");

  // ── Shared Workspace filing context ─────────────────────────────────────────
  // Client / FY / Quarter / Form are selected ONCE and shared by BOTH the Data
  // Entry and Validate & Finalise tabs, so switching tabs never forces the user
  // to re-select the same return. Lifted here (the common parent) and passed to
  // both children as controlled value+setter pairs; a change in one tab is
  // instantly reflected in the other.
  const tdsDefault = useMemo(() => getDefaultTdsQuarter(), []);
  const [ctxClient, setCtxClient] = useState("");
  const [ctxFy, setCtxFy] = useState(tdsDefault.fy);
  const [ctxQuarter, setCtxQuarter] = useState(tdsDefault.quarter);
  const [ctxForm, setCtxForm] = useState("26Q");
  // Bumped whenever the Dashboard's Validate & Finalise "Ready" link navigates
  // to a SPECIFIC filing, so Stage 1 opens regardless of whichever stage the
  // Validate & Finalise tab happened to be left on from a previous visit.
  const [forceStage1Signal, setForceStage1Signal] = useState(0);
  // Increment to force TdsDashboard to re-fetch when returning from workspace
  const [dashRefreshKey, setDashRefreshKey] = useState(0);
  const [syncing, setSyncing] = useState(false);
  // Client query email — Validate & Finalise reports its open points here so
  // the button (visible on every Workspace tab) can pre-fill the email.
  const [queryCtx, setQueryCtx] = useState<TdsQueryContext | null>(null);
  const [queryEmailOpen, setQueryEmailOpen] = useState(false);

  // ── Filed corrections for the CURRENT workspace context ───────────────────
  // A third Workspace tab appears only once at least one correction return has
  // actually been FILED for this client/FY/quarter/form. Data Entry and
  // Validate & Finalise keep showing the ORIGINAL return; the Correction tab
  // shows the full history of filed corrections for this period — each one
  // its own record (filed date, filing reference, status) — with the LATEST
  // one selected by default, since that is what every calculation elsewhere
  // in the app (getEffectiveClientLedger) treats as the current/original
  // dataset. Earlier corrections stay browsable, read-only, for history only.
  const [filedCorrections, setFiledCorrections] = useState<any[]>([]);
  const [selectedCorrectionId, setSelectedCorrectionId] = useState<string | null>(null);
  const filedCorrection = filedCorrections.find(c => c.id === selectedCorrectionId) || filedCorrections[0] || null;

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!ctxClient || !ctxFy || !ctxQuarter || !ctxForm) { setFiledCorrections([]); setSelectedCorrectionId(null); return; }
      const { data } = await supabase
        .from("tds_corrections" as any)
        .select("*")
        .eq("client_id", ctxClient)
        .eq("financial_year", ctxFy)
        .eq("quarter", ctxQuarter)
        .eq("form_type", ctxForm)
        .eq("status", "filed");
      if (cancelled) return;
      // Latest filed first — index 0 is what "current" means throughout.
      const sorted = ((data || []) as any[])
        .slice()
        .sort((a, b) => (b.filed_at || b.signed_at || "").localeCompare(a.filed_at || a.signed_at || ""));
      setFiledCorrections(sorted);
      // Keep the user's current selection if it still exists in the refreshed
      // list (e.g. a live update while they're mid-review); otherwise default
      // to the latest.
      setSelectedCorrectionId(prev => (prev && sorted.some(c => c.id === prev)) ? prev : (sorted[0]?.id ?? null));
      // If the tab is open and the context moved to a period with no filed
      // correction, fall back rather than showing an empty tab.
      if (sorted.length === 0) setWorkspaceTab(t => (t === "correction" ? "data-entry" : t));
    };
    run();
    return () => { cancelled = true; };
    // activeSection: filing a correction happens on the Corrections tab, which
    // changes none of the values below — without this the Workspace would not
    // show the new Correction tab until something else happened to move the
    // context. Re-running when the Workspace is opened closes that gap.
  }, [ctxClient, ctxFy, ctxQuarter, ctxForm, dashRefreshKey, activeSection]);

  // ...and live, so a correction filed in another tab (or by a colleague)
  // surfaces here without navigating away and back. RLS scopes the stream.
  useEffect(() => {
    if (!ctxClient) return;
    const ch = supabase
      .channel(`tds-workspace-corrections-${ctxClient}`)
      .on("postgres_changes",
        { event: "*", schema: "public", table: "tds_corrections", filter: `client_id=eq.${ctxClient}` },
        () => setDashRefreshKey(k => k + 1))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [ctxClient]);

  const [clients, setClients] = useState<ClientOption[]>([]);
  const [users, setUsers] = useState<UserOption[]>([]);
  const isSuperadmin = user?.role === "superadmin";

  const resolveFirmId = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    const metadataFirmId = session?.user?.user_metadata?.firm_id;
    if (typeof metadataFirmId === "string" && metadataFirmId.length > 0) return metadataFirmId;
    return user?.firm_id ?? null;
  }, [user?.firm_id]);

  // Signature of the client list currently in state. Background sync compares
  // against it and returns WITHOUT touching state when nothing changed — see
  // the comment at the setClients call for why a new array identity alone is
  // enough to rebuild whatever screen the user is working on.
  const clientsSigRef = useRef<string>('');
  const setEmptyClients = useCallback(() => {
    if (clientsSigRef.current === '[]') return false;
    clientsSigRef.current = '[]'; setClients([]); return true;
  }, []);

  const fetchClients = useCallback(async (): Promise<boolean> => {
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
    if (tdsCatIds.length === 0) return setEmptyClients();

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
    if (tdsClientIds.length === 0) return setEmptyClients();

    // 3. Fetch only those TDS clients (by id → no truncation), live only.
    const { data: clientsData } = await supabase
      .from("clients")
      .select("id, name, pan, tan_number, contact_person, mobile, email")
      .in("id", tdsClientIds)
      .eq("is_draft", false)
      .is("deleted_at", null)
      .order("name")
      .limit(20000);

    const eligible = ((clientsData || []) as ClientOption[]).map(c => ({ ...c, ...rangeByClient.get(c.id) }));

    console.log(`[TDS] Client list: ${eligible.length} eligible (TDS Compliance configured, of ${tdsClientIds.length} TDS service rows)`);

    // ONLY replace the array when the DATA actually changed.
    //
    // `clients` is a prop of every screen in this module, so a fresh array
    // identity re-runs the useCallback/useEffect chains beneath it and rebuilds
    // whatever the user is looking at — losing filters, opened records, scroll
    // position and in-progress edits. Background sync runs on a 45s poll, on
    // tab visibility, and on every Realtime change (including the ones the
    // user's OWN action causes: resolving a mismatch writes to tds_filings),
    // and it almost always returns byte-identical data. Comparing first turns
    // the common case into a true no-op, so a refresh only ever disturbs the
    // screen when there is genuinely something new to show.
    const sig = JSON.stringify(eligible);
    if (sig === clientsSigRef.current) return false;
    clientsSigRef.current = sig;
    setClients(eligible);
    return true;
  }, [resolveFirmId, setEmptyClients]);

  const fetchUsers = useCallback(async () => {
    const firmId = await resolveFirmId();
    // Excludes client-portal users — the SAME "users" table also holds one row
    // per client (their portal login), so every other user-picker in the app
    // filters these out (Clients.tsx, Billing.tsx, AuditPipeline.tsx, etc.).
    // This query was the one place missing it, which is why the Audit Log's
    // "User" filter (staff who performed an action) was listing client/company
    // names instead of staff names.
    let q = supabase.from("users").select("id, name").eq("is_active", true).neq("role", "client");
    if (!isSuperadmin && firmId) q = q.eq("firm_id", firmId);
    const { data } = await q;
    setUsers((data as UserOption[]) || []);
  }, [isSuperadmin, resolveFirmId]);

  // The latest fetchers/refresher are held in refs so the effects below run
  // ONCE on mount and never tear down + re-run when these callbacks change
  // identity. Previously the effects listed the callbacks as dependencies; an
  // unstable dep made fetchClients re-fire on every render — an infinite async
  // re-fetch loop. It rendered fine on the light Dashboard but the constant
  // re-renders froze the browser once the heavy Workspace mounted, tripping the
  // "Something went wrong" error boundary.
  const fetchClientsRef = useRef(fetchClients); fetchClientsRef.current = fetchClients;
  const fetchUsersRef = useRef(fetchUsers); fetchUsersRef.current = fetchUsers;

  useEffect(() => { fetchClientsRef.current(); fetchUsersRef.current(); }, []);

  // Pull the latest TDS Compliance config + filing rows and force every child
  // screen (Dashboard KPIs, Client Filing Summary, etc.) to re-read.
  const refreshTdsModule = useCallback(() => {
    fetchClients();
    setDashRefreshKey(k => k + 1);
  }, [fetchClients]);
  const refreshRef = useRef(refreshTdsModule); refreshRef.current = refreshTdsModule;

  // ── Real-time sync ──────────────────────────────────────────────────────
  // TDS Compliance (client_services) is the single source of truth; a DB
  // trigger keeps tds_filings in lock-step. Subscribe to changes on BOTH so
  // the whole TDS module updates the instant a client's compliance changes —
  // from this tab, another tab, or another user — with no navigation or
  // manual refresh. RLS scopes each firm to its own rows.
  useEffect(() => {
    const channel = supabase
      .channel("tds-module-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "client_services" }, () => refreshRef.current())
      .on("postgres_changes", { event: "*", schema: "public", table: "tds_filings" }, () => refreshRef.current())
      // The Dashboard's "Ready" badge (TdsFilingsManager's fetchVfStatuses)
      // reads these four tables too — completing Stage 1-3 or signing in
      // Validate & Finalise must reach an already-open Dashboard tab
      // immediately, not only on the next 45s poll or manual tab click.
      // Requires 20260804152100_tds_vf_status_realtime.sql (publication +
      // REPLICA IDENTITY FULL), same pattern as tds_filings above.
      .on("postgres_changes", { event: "*", schema: "public", table: "tds_recon_results" }, () => refreshRef.current())
      .on("postgres_changes", { event: "*", schema: "public", table: "tds_pan_verification_results" }, () => refreshRef.current())
      .on("postgres_changes", { event: "*", schema: "public", table: "tds_tally_results" }, () => refreshRef.current())
      .on("postgres_changes", { event: "*", schema: "public", table: "tds_filing_audit_log" }, () => refreshRef.current())
      .subscribe((status) => {
        // On (re)connect, pull once so any change that happened while the
        // socket was down is picked up immediately.
        if (status === "SUBSCRIBED") refreshRef.current();
      });
    return () => { supabase.removeChannel(channel); };
  }, []);

  // Fallback for environments without Realtime (or a dropped socket): refetch
  // when the tab regains focus/visibility, and on bfcache restore (back/fwd).
  useEffect(() => {
    const onVisible = () => { if (!document.hidden) refreshRef.current(); };
    const onPageShow = () => refreshRef.current();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, []);

  // Guaranteed-eventual sync: even where WebSockets/Realtime are blocked (some
  // corporate networks/proxies) AND the user never switches tabs, poll every
  // 45s while the tab is visible so the module can never stay stale relative
  // to the TDS Compliance config. Paused when the tab is hidden to avoid waste.
  useEffect(() => {
    const POLL_MS = 45000;
    const id = window.setInterval(() => {
      if (!document.hidden) refreshRef.current();
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, []);

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
              onNavigate={(section, filters) => {
                // CP-02: "data-entry" and "validate" deep-links now open workspace
                if (section === "data-entry") {
                  // A specific filing's "Go to Data Entry" action carries its own
                  // client/FY/quarter/form (TdsFilingsManager's row action) — pre-select
                  // the SAME filing here instead of leaving whatever was last selected/
                  // viewed in the Workspace, which used to force re-picking it by hand.
                  if (filters?.clientId) {
                    setCtxClient(filters.clientId);
                    if (filters.financialYear) setCtxFy(filters.financialYear);
                    if (filters.quarter) setCtxQuarter(filters.quarter);
                    if (filters.formType) setCtxForm(filters.formType);
                  }
                  setWorkspaceTab("data-entry"); setActiveSection("workspace");
                }
                else if (section === "validate") {
                  // A specific filing's "Ready" link (Dashboard's Validate & Finalise
                  // column) carries its own client/FY/quarter/form — pre-select the
                  // SAME filing here and force Stage 1 open, instead of leaving
                  // whatever was last selected/viewed in the Workspace.
                  if (filters?.clientId) {
                    setCtxClient(filters.clientId);
                    if (filters.financialYear) setCtxFy(filters.financialYear);
                    if (filters.quarter) setCtxQuarter(filters.quarter);
                    if (filters.formType) setCtxForm(filters.formType);
                    setForceStage1Signal((n) => n + 1);
                  }
                  setWorkspaceTab("validate"); setActiveSection("workspace");
                }
                // Deep-links to the two merged screens open the combined tab on
                // the right sub-tab. NOTE: "corrections" is deliberately NOT an
                // alias here any more — it is now a top-level key of its own
                // (the Correction module), so it must fall through below.
                else if (section === "audit-log" || section === "overrides") {
                  setActivityTab(section === "audit-log" ? "audit-log" : "overrides");
                  setActiveSection("activity");
                }
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

                {/* Only once a correction has actually been FILED for this
                    return. No filed correction → only the two tabs above. */}
                {filedCorrections.length > 0 && (
                  <button
                    onClick={() => setWorkspaceTab("correction")}
                    className={cn(
                      "px-5 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors",
                      workspaceTab === "correction"
                        ? "border-primary text-primary"
                        : "border-transparent text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <span className="flex items-center gap-2">
                      <FileEdit size={14} /> Correction
                      <Badge className="text-[9px] bg-emerald-100 text-emerald-700">
                        {filedCorrections.length > 1 ? `Filed ×${filedCorrections.length}` : "Filed"}
                      </Badge>
                    </span>
                  </button>
                )}

                {/* Quick access to the government portals — stays visible across
                    Data Entry / Validate & Finalise / Correction since it's scoped
                    to the currently-selected client (ctxClient), not to any one
                    sub-tab. See TdsPortalLoginButtons's own header for why this
                    is deliberately NOT full login automation. */}
                <div className="flex-1" />
                <div className="flex items-center gap-2 pr-1">
                  {ctxClient && (
                    <Button
                      variant="outline" size="sm" className="h-7 text-xs gap-1.5"
                      onClick={() => setQueryEmailOpen(true)}
                      title="Email the client about queries raised on this return"
                    >
                      <Mail size={13} /> Email client
                      {(queryCtx?.candidates.length ?? 0) > 0 && (
                        <Badge className="h-4 px-1 text-[10px] bg-destructive/10 text-destructive hover:bg-destructive/10">{queryCtx!.candidates.length}</Badge>
                      )}
                    </Button>
                  )}
                  <TdsPortalLoginButtons clientId={ctxClient || null} />
                </div>
              </div>

              {/* Tab content — rendered but hidden so state is preserved on switch */}
              <div className={workspaceTab === "data-entry" ? "" : "hidden"}>
                <TdsDataEntry
                  clients={clients} users={users}
                  isSuperadmin={isSuperadmin} resolveFirmId={resolveFirmId}
                  selClient={ctxClient} setSelClient={setCtxClient}
                  selFy={ctxFy} setSelFy={setCtxFy}
                  selQuarter={ctxQuarter} setSelQuarter={setCtxQuarter}
                  selForm={ctxForm} setSelForm={setCtxForm}
                />
              </div>
              <div className={workspaceTab === "validate" ? "" : "hidden"}>
                <TdsValidateFinalise
                  clients={clients} isSuperadmin={isSuperadmin}
                  resolveFirmId={resolveFirmId}
                  onNavigateDataEntry={() => setWorkspaceTab("data-entry")}
                  selClient={ctxClient} selFy={ctxFy} selQuarter={ctxQuarter} selForm={ctxForm}
                  forceStage1Signal={forceStage1Signal}
                  onQueryContextChange={setQueryCtx}
                />
              </div>

              {/* The filed correction(s) — the SAME Data Entry engine, pointed
                  at the SELECTED correction's tables and read-only, so any
                  version of the return can be compared in one identical
                  interface. A history list above lets the user pick which
                  filed correction to view; every calculation elsewhere in the
                  app (getEffectiveClientLedger) always treats the latest one
                  — index 0, pre-selected below — as current. */}
              {filedCorrections.length > 0 && (
                <div className={workspaceTab === "correction" ? "" : "hidden"}>
                  {filedCorrections.length > 1 && (
                    <div className="mb-3 rounded-lg border overflow-hidden">
                      <div className="px-3 py-2 bg-muted/50 text-xs font-semibold text-muted-foreground">
                        Correction history — {filedCorrections.length} filed corrections for {ctxForm} · {ctxQuarter} {ctxFy}
                      </div>
                      <div className="divide-y">
                        {filedCorrections.map((c, i) => {
                          const seq = filedCorrections.length - i;
                          const isLatest = i === 0;
                          const isSelected = c.id === selectedCorrectionId;
                          return (
                            <button
                              key={c.id}
                              onClick={() => setSelectedCorrectionId(c.id)}
                              className={cn(
                                "w-full text-left px-3 py-2.5 flex items-center gap-3 text-xs hover:bg-muted/40 transition-colors",
                                isSelected && "bg-primary/5"
                              )}
                            >
                              <span className="font-semibold text-foreground w-24 shrink-0">Correction {seq}</span>
                              <span className="text-muted-foreground w-28 shrink-0">
                                {c.filed_at ? format(new Date(c.filed_at), "dd/MM/yyyy") : "—"}
                              </span>
                              <span className="text-muted-foreground flex-1 truncate">
                                {c.filing_reference ? `Ref ${c.filing_reference}` : "No filing reference recorded"}
                              </span>
                              {isLatest ? (
                                <Badge className="text-[9px] bg-emerald-100 text-emerald-700 shrink-0">Current</Badge>
                              ) : (
                                <Badge variant="outline" className="text-[9px] text-muted-foreground shrink-0">Superseded</Badge>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  <div className="mb-3 rounded-lg border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/20 px-3 py-2 flex items-start gap-2.5">
                    <BadgeCheck size={16} className="text-emerald-600 shrink-0 mt-0.5" />
                    <div className="text-xs">
                      <p className="font-semibold text-emerald-800 dark:text-emerald-300">
                        {filedCorrections.length > 1
                          ? `Viewing Correction ${filedCorrections.length - filedCorrections.findIndex(c => c.id === filedCorrection.id)} of ${filedCorrections.length} — read-only`
                          : "Filed correction — read-only"}
                      </p>
                      <p className="text-emerald-700 dark:text-emerald-400">
                        This is a corrected version of {ctxForm} · {ctxQuarter} {ctxFy}.
                        The Data Entry and Validate &amp; Finalise tabs still show the original filed return.
                      </p>
                    </div>
                  </div>
                  <TdsDataEntry
                    clients={clients} users={users}
                    isSuperadmin={isSuperadmin} resolveFirmId={resolveFirmId}
                    selClient={ctxClient} setSelClient={setCtxClient}
                    selFy={ctxFy} setSelFy={setCtxFy}
                    selQuarter={ctxQuarter} setSelQuarter={setCtxQuarter}
                    selForm={ctxForm} setSelForm={setCtxForm}
                    source={CORRECTION_TDS_SOURCE}
                    filingOverride={{
                      id: filedCorrection.id,
                      client_id: filedCorrection.client_id,
                      firm_id: filedCorrection.firm_id,
                      financial_year: filedCorrection.financial_year,
                      quarter: filedCorrection.quarter,
                      tds_forms: [filedCorrection.form_type],
                      work_status: "Filed",
                      tan: null,
                    } as any}
                    forceReadOnly
                    lockBadgeLabel="Filed"
                    lockNotice="This is the filed correction for this return — read-only. The Data Entry and Validate & Finalise tabs show the original filing."
                  />
                </div>
              )}
            </div>
          )}

          {activeSection === "corrections" && (
            <TdsCorrectionsModule
              clients={clients} users={users}
              isSuperadmin={isSuperadmin} resolveFirmId={resolveFirmId}
            />
          )}

          {activeSection === "property" && (
            <TdsPropertyModule clients={clients} isSuperadmin={isSuperadmin} resolveFirmId={resolveFirmId} />
          )}

          {activeSection === "reports" && <TdsReports clients={clients} isSuperadmin={isSuperadmin} resolveFirmId={resolveFirmId} />}
          {activeSection === "rate-master" && <TdsRateMaster resolveFirmId={resolveFirmId} isSuperadmin={isSuperadmin} />}
          {activeSection === "email-settings" && <TdsEmailSettingsPage />}

          {/* ── Audit & Overrides — Audit Log + Overrides in one tab ────────── */}
          {activeSection === "activity" && (
            <div>
              <div className="mb-4">
                <h2 className="text-xl font-bold text-foreground">Audit &amp; Overrides</h2>
                <p className="text-sm text-muted-foreground">
                  Every action recorded against a filing, and every manual override grouped into patterns — read-only.
                </p>
              </div>

              {/* Tab bar */}
              <div className="flex border-b mb-4">
                <button
                  onClick={() => setActivityTab("audit-log")}
                  className={cn(
                    "px-5 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors",
                    activityTab === "audit-log"
                      ? "border-primary text-primary"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  )}
                >
                  <span className="flex items-center gap-2">
                    <ClipboardList size={14} /> Audit Log
                  </span>
                </button>
                <button
                  onClick={() => setActivityTab("overrides")}
                  className={cn(
                    "px-5 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors",
                    activityTab === "overrides"
                      ? "border-primary text-primary"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  )}
                >
                  <span className="flex items-center gap-2">
                    <Repeat2 size={14} /> Overrides
                  </span>
                </button>
              </div>

              {/* Tab content — rendered but hidden so filters/sort survive a switch */}
              <div className={activityTab === "audit-log" ? "" : "hidden"}>
                <TdsAuditLog clients={clients} users={users} isSuperadmin={isSuperadmin} resolveFirmId={resolveFirmId} />
              </div>
              <div className={activityTab === "overrides" ? "" : "hidden"}>
                <TdsOverrides clients={clients} users={users} isSuperadmin={isSuperadmin} resolveFirmId={resolveFirmId} />
              </div>
            </div>
          )}
        </div>
      </div>
      {ctxClient && (
        <TdsQueryEmailDialog
          open={queryEmailOpen}
          onOpenChange={setQueryEmailOpen}
          clientId={ctxClient}
          formType={ctxForm}
          quarter={ctxQuarter}
          financialYear={ctxFy}
          context={queryCtx}
        />
      )}
    </div>
  );
};

export default TdsFilings;
