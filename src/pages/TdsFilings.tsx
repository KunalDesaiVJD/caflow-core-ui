import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  FileText, LayoutDashboard, PenLine,
  ShieldCheck, BarChart3, Settings, Database,
} from "lucide-react";
import { TdsRateMaster } from "@/components/tds/TdsRateMaster";
import { TdsDashboard } from "@/components/tds/TdsDashboard";
import { TdsFilingsManager } from "@/components/tds/TdsFilingsManager";
import { TdsDataEntry } from "@/components/tds/TdsDataEntry";
import { TdsValidateFinalise } from "@/components/tds/TdsValidateFinalise";
import { TdsReports } from "@/components/tds/TdsReports";

// ─── Types ───
interface ClientOption { id: string; name: string | null; pan: string | null; tan_number?: string | null; }
interface UserOption { id: string; name: string | null; }

// ─── Sidebar Navigation Items ───
const NAV_ITEMS = [
  { key: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { key: "filings", label: "Filings", icon: FileText },
  { key: "data-entry", label: "Data Entry", icon: PenLine },
  { key: "validate", label: "Validate & Finalise", icon: ShieldCheck },
  { key: "reports", label: "Reports", icon: BarChart3 },
  { key: "rate-master", label: "Rate Master", icon: Settings },
] as const;

type NavKey = typeof NAV_ITEMS[number]["key"];

// ═══════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════
const TdsFilings = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [activeSection, setActiveSection] = useState<NavKey>("dashboard");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [migrationOpen, setMigrationOpen] = useState(false);
  const [migrating, setMigrating] = useState(false);
  const [migrationResult, setMigrationResult] = useState<{ challans: number; deductees: number; entries: number } | null>(null);

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

  // ─── Legacy Migration ───
  const runMigration = async () => {
    setMigrating(true);
    setMigrationResult(null);
    try {
      const firmId = await resolveFirmId();
      // Fetch unmigrated entries
      let q = supabase.from("tds_entries").select("*").eq("migrated", false).limit(1000);
      if (!isSuperadmin && firmId) q = q.eq("firm_id", firmId);
      const { data: entries, error: fetchErr } = await q;
      if (fetchErr) throw fetchErr;
      if (!entries || entries.length === 0) {
        toast({ title: "No unmigrated entries found" });
        setMigrating(false);
        return;
      }

      // Group by challan key
      const challanGroups = new Map<string, any[]>();
      for (const e of entries) {
        const key = `${e.client_id}|${e.form_type}|${e.challan_bsr_code || ""}|${e.challan_serial_no || ""}|${e.challan_date || ""}`;
        if (!challanGroups.has(key)) challanGroups.set(key, []);
        challanGroups.get(key)!.push(e);
      }

      let challanCount = 0;
      let deducteeCount = 0;

      for (const [, group] of challanGroups) {
        const first = group[0];
        // Find or create filing
        const { data: existingFilings } = await supabase.from("tds_filings").select("id")
          .eq("client_id", first.client_id)
          .eq("financial_year", first.financial_year || "2025-26")
          .limit(1);
        
        let filingId: string;
        if (existingFilings && existingFilings.length > 0) {
          filingId = existingFilings[0].id;
        } else {
          const { data: newFiling, error: fErr } = await supabase.from("tds_filings").insert({
            client_id: first.client_id,
            firm_id: first.firm_id || firmId,
            financial_year: first.financial_year || "2025-26",
            quarter: "Q1",
            tds_forms: [first.form_type || "26Q"],
            work_status: "Data Entry in Progress",
            tan: first.tan || null,
            last_updated_by: user?.id,
            last_updated_at: new Date().toISOString(),
          } as any).select("id").single();
          if (fErr) continue;
          filingId = newFiling.id;
        }

        // Create challan
        const totalChallanAmount = first.challan_amount || group.reduce((s: number, e: any) => s + (e.tds_amount || 0), 0);
        const { data: challan, error: cErr } = await supabase.from("tds_challans").insert({
          filing_id: filingId,
          client_id: first.client_id,
          firm_id: first.firm_id || firmId,
          form_type: first.form_type || "26Q",
          financial_year: first.financial_year || "2025-26",
          quarter: "Q1",
          bsr_code: first.challan_bsr_code || null,
          challan_serial_no: first.challan_serial_no || null,
          deposit_date: first.challan_date || null,
          total_challan_amount: totalChallanAmount,
          total_tax_deposited: totalChallanAmount,
        } as any).select("id").single();
        if (cErr) continue;
        challanCount++;

        // Create deductees
        for (const e of group) {
          await supabase.from("tds_deductees").insert({
            challan_id: challan.id,
            filing_id: filingId,
            client_id: e.client_id,
            firm_id: e.firm_id || firmId,
            form_type: e.form_type || "26Q",
            financial_year: e.financial_year || "2025-26",
            quarter: "Q1",
            deductee_name: e.party_name || "",
            deductee_pan: e.deductee_pan || e.pan || null,
            section_code: e.section_code || e.section || "",
            amount_paid_credited: e.amount || null,
            date_of_payment: e.date || null,
            rate_of_tds: e.tds_rate || null,
            tds_amount: e.tds_amount || null,
            total_tax_deducted: e.tds_amount || null,
            pan_not_available: false,
          } as any);
          deducteeCount++;

          // Mark as migrated
          await supabase.from("tds_entries").update({
            migrated: true,
            migrated_at: new Date().toISOString(),
          } as any).eq("id", e.id);
        }
      }

      setMigrationResult({ challans: challanCount, deductees: deducteeCount, entries: entries.length });
      toast({ title: `Migration complete: ${entries.length} entries → ${challanCount} challans + ${deducteeCount} deductees` });
    } catch (err: any) {
      toast({ title: "Migration error", description: err.message, variant: "destructive" });
    }
    setMigrating(false);
  };

  return (
    <div className="flex h-[calc(100vh-4rem)] overflow-hidden">
      {/* Left Sidebar */}
      <div className={cn(
        "border-r bg-muted/30 flex flex-col shrink-0 transition-all duration-200",
        sidebarCollapsed ? "w-14" : "w-48"
      )}>
        <div className="p-3 border-b flex items-center justify-between">
          {!sidebarCollapsed && <span className="text-sm font-semibold text-foreground">TDS Module</span>}
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setSidebarCollapsed(!sidebarCollapsed)}>
            <FileText size={14} />
          </Button>
        </div>
        <nav className="flex-1 py-2 space-y-0.5 px-2">
          {NAV_ITEMS.map(item => (
            <button
              key={item.key}
              onClick={() => setActiveSection(item.key)}
              className={cn(
                "w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-sm transition-colors",
                activeSection === item.key
                  ? "bg-primary text-primary-foreground font-medium"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              <item.icon size={16} className="shrink-0" />
              {!sidebarCollapsed && <span>{item.label}</span>}
            </button>
          ))}
        </nav>
        {/* Legacy Migration Button */}
        {!sidebarCollapsed && (
          <div className="p-2 border-t">
            <Button variant="ghost" size="sm" className="w-full text-xs gap-1 text-muted-foreground" onClick={() => setMigrationOpen(true)}>
              <Database size={12} /> Migrate Legacy Data
            </Button>
          </div>
        )}
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-[1400px] mx-auto">
          {activeSection === "dashboard" && (
            <TdsDashboard
              clients={clients}
              users={users}
              isSuperadmin={isSuperadmin}
              resolveFirmId={resolveFirmId}
              onNavigate={(section, filters) => setActiveSection(section as NavKey)}
            />
          )}
          {activeSection === "filings" && (
            <TdsFilingsManager
              clients={clients}
              users={users}
              isSuperadmin={isSuperadmin}
              resolveFirmId={resolveFirmId}
              onNavigateDataEntry={() => setActiveSection("data-entry")}
            />
          )}
          {activeSection === "data-entry" && (
            <TdsDataEntry clients={clients} users={users} isSuperadmin={isSuperadmin} resolveFirmId={resolveFirmId} />
          )}
          {activeSection === "validate" && (
            <TdsValidateFinalise
              clients={clients}
              isSuperadmin={isSuperadmin}
              resolveFirmId={resolveFirmId}
              onNavigateDataEntry={() => setActiveSection("data-entry")}
            />
          )}
          {activeSection === "reports" && (
            <TdsReports clients={clients} isSuperadmin={isSuperadmin} resolveFirmId={resolveFirmId} />
          )}
          {activeSection === "rate-master" && (
            <TdsRateMaster resolveFirmId={resolveFirmId} isSuperadmin={isSuperadmin} />
          )}
        </div>
      </div>

      {/* Legacy Migration Dialog */}
      <Dialog open={migrationOpen} onOpenChange={setMigrationOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Migrate Legacy TDS Data</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              This will migrate data from the old <code className="bg-muted px-1 rounded">tds_entries</code> table
              into the new <code className="bg-muted px-1 rounded">tds_challans</code> + <code className="bg-muted px-1 rounded">tds_deductees</code> structure.
            </p>
            <ul className="text-xs text-muted-foreground space-y-1 list-disc pl-4">
              <li>Groups entries by client + form + challan details</li>
              <li>Creates one challan per unique group</li>
              <li>Creates one deductee per entry under its challan</li>
              <li>Marks old entries as migrated (does not delete them)</li>
            </ul>
            {migrationResult && (
              <div className="p-3 bg-emerald-50 dark:bg-emerald-950/30 rounded-lg border border-emerald-200 dark:border-emerald-800">
                <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-300">Migration Complete</p>
                <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-1">
                  {migrationResult.entries} entries → {migrationResult.challans} challans + {migrationResult.deductees} deductees
                </p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMigrationOpen(false)}>Close</Button>
            <Button onClick={runMigration} disabled={migrating}>
              {migrating ? "Migrating..." : "Run Migration"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

// ═══════════════════════════════════════
// LEGACY COMPONENTS (COMMENTED OUT FOR 30 DAYS — DO NOT DELETE UNTIL 2026-04-28)
// ═══════════════════════════════════════

/*
// OLD TdsEntriesTab — replaced by TdsDataEntry (challan-first design)
// function TdsEntriesTab({ clients, users, isSuperadmin, resolveFirmId }: TabProps) {
//   ... old entries tab code was here ...
// }

// OLD TdsReportsTab — replaced by TdsReports (9-card report grid)
// function TdsReportsTab({ ... }) {
//   ... old reports tab code was here ...
// }
*/

export default TdsFilings;
