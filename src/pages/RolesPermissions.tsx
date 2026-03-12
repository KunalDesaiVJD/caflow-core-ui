import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { ALL_MODULES, ALL_ROLES, DEFAULT_PERMISSIONS, usePermissions, type ModuleName, type RoleName } from "@/hooks/usePermissions";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Shield, RotateCcw, Loader2, Save, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";

interface PermRow {
  id?: string;
  firm_id: string;
  role: string;
  module: string;
  can_view: boolean;
  can_create: boolean;
  can_edit: boolean;
  can_delete: boolean;
  can_export: boolean;
  updated_by?: string | null;
  updated_at?: string | null;
}

const PERM_FIELDS = ["can_view", "can_create", "can_edit", "can_delete", "can_export"] as const;
const PERM_LABELS: Record<string, string> = {
  can_view: "View",
  can_create: "Create",
  can_edit: "Edit",
  can_delete: "Delete",
  can_export: "Export",
};

const ROLE_LABELS: Record<string, string> = {
  superadmin: "Super Admin",
  firm_admin: "Firm Admin",
  partner_ca: "Partner/CA",
  manager: "Manager",
  staff_article: "Staff/Article",
  client: "Client",
};

const MODULE_LABELS: Record<string, string> = {
  "Firm Management": "Firm Management",
  "Client Management": "Client Management",
  "Service Masters": "Service Masters",
  "IT Returns": "IT Returns + Compliance",
  "TDS": "TDS Management",
  "Billing": "Billing & Timesheet",
  "Depreciation": "Depreciation Module",
  "Audit Intelligence": "Audit Intelligence (1-10)",
  "Chat": "Chat & Collaboration",
  "Settings": "Settings / Roles & Permissions",
  "Theme Studio": "Theme Studio",
};

const ROLE_COLORS: Record<string, string> = {
  superadmin: "bg-destructive/15 text-destructive",
  firm_admin: "bg-primary/15 text-primary",
  partner_ca: "bg-amber-100 text-amber-800",
  manager: "bg-blue-100 text-blue-800",
  staff_article: "bg-green-100 text-green-800",
  client: "bg-muted text-muted-foreground",
};

const RolesPermissions = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const { refresh: refreshCtx } = usePermissions();
  const [grid, setGrid] = useState<Record<string, Record<string, PermRow>>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [resetRole, setResetRole] = useState<string | null>(null);
  const [lastModified, setLastModified] = useState<Record<string, { by: string; at: string }>>({});

  // Firm selector for superadmin
  const [firmsList, setFirmsList] = useState<{ id: string; name: string }[]>([]);
  const [selectedFirmId, setSelectedFirmId] = useState<string | null>(null);
  const isSuperadmin = user?.role === "superadmin";
  const firmId = isSuperadmin ? selectedFirmId : user?.firm_id;
  const canEdit = isSuperadmin || user?.role === "firm_admin";

  // Load firms for superadmin
  useEffect(() => {
    if (!isSuperadmin) return;
    supabase.from("firms").select("id, name").order("name").then(({ data }) => {
      setFirmsList(data || []);
      if (data && data.length > 0 && !selectedFirmId) setSelectedFirmId(data[0].id);
    });
  }, [isSuperadmin]);

  useEffect(() => {
    if (firmId) loadGrid();
  }, [firmId]);

  async function loadGrid() {
    setLoading(true);
    const { data } = await supabase
      .from("role_permissions")
      .select("*")
      .eq("firm_id", firmId!);

    const g: Record<string, Record<string, PermRow>> = {};
    const lm: Record<string, { by: string; at: string }> = {};

    if (data && data.length > 0) {
      for (const row of data as any[]) {
        if (!g[row.role]) g[row.role] = {};
        g[row.role][row.module] = row;
        if (row.updated_at && row.updated_by) {
          const key = row.role;
          if (!lm[key] || new Date(row.updated_at) > new Date(lm[key].at)) {
            lm[key] = { by: row.updated_by, at: row.updated_at };
          }
        }
      }
    }

    // Fill missing with defaults
    for (const role of ALL_ROLES) {
      if (!g[role]) g[role] = {};
      for (const mod of ALL_MODULES) {
        if (!g[role][mod]) {
          const def = DEFAULT_PERMISSIONS[role]?.[mod] || { can_view: false, can_create: false, can_edit: false, can_delete: false, can_export: false };
          g[role][mod] = { firm_id: firmId!, role, module: mod, ...def };
        }
      }
    }

    // Load user names for last modified
    const userIds = [...new Set(Object.values(lm).map(v => v.by))];
    if (userIds.length > 0) {
      const { data: users } = await supabase.from("users").select("id, name").in("id", userIds);
      if (users) {
        const nameMap: Record<string, string> = {};
        users.forEach((u: any) => { nameMap[u.id] = u.name || "Unknown"; });
        Object.keys(lm).forEach(k => {
          lm[k].by = nameMap[lm[k].by] || lm[k].by;
        });
      }
    }

    setGrid(g);
    setLastModified(lm);
    setLoading(false);
  }

  function togglePerm(role: string, module: string, field: typeof PERM_FIELDS[number]) {
    if (!canEdit) return;
    setGrid(prev => {
      const row = { ...prev[role][module] };
      const newVal = !(row as any)[field];
      (row as any)[field] = newVal;
      // Auto-enable can_view when any other permission is turned on
      if (newVal && field !== "can_view") {
        row.can_view = true;
      }
      // Auto-disable downstream when can_view is turned off
      if (!newVal && field === "can_view") {
        row.can_create = false;
        row.can_edit = false;
        row.can_delete = false;
        row.can_export = false;
      }
      return { ...prev, [role]: { ...prev[role], [module]: row } };
    });
    setDirty(true);
  }

  async function saveAll() {
    if (!firmId || !canEdit) return;
    setSaving(true);
    try {
      const rows: any[] = [];
      for (const role of ALL_ROLES) {
        for (const mod of ALL_MODULES) {
          const r = grid[role]?.[mod];
          if (!r) continue;
          rows.push({
            firm_id: firmId,
            role,
            module: mod,
            can_view: r.can_view,
            can_create: r.can_create,
            can_edit: r.can_edit,
            can_delete: r.can_delete,
            can_export: r.can_export,
            updated_by: user?.id,
            updated_at: new Date().toISOString(),
          });
        }
      }

      // Upsert all
      const { error } = await supabase
        .from("role_permissions")
        .upsert(rows, { onConflict: "firm_id,role,module" });

      if (error) throw error;
      toast({ title: "Permissions saved successfully" });
      setDirty(false);
      await refreshCtx();
      await loadGrid();
    } catch (e: any) {
      toast({ title: "Error saving permissions", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function handleReset() {
    if (!resetRole || !firmId) return;
    const defaults = DEFAULT_PERMISSIONS[resetRole as RoleName];
    if (!defaults) return;

    setGrid(prev => {
      const updated = { ...prev };
      updated[resetRole!] = {};
      for (const mod of ALL_MODULES) {
        updated[resetRole!][mod] = {
          firm_id: firmId,
          role: resetRole!,
          module: mod,
          ...defaults[mod],
        };
      }
      return updated;
    });
    setDirty(true);
    setResetRole(null);
    toast({ title: `${ROLE_LABELS[resetRole]} permissions reset to defaults` });
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-[400px] w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-display font-bold text-foreground flex items-center gap-2">
            <Shield className="h-6 w-6" /> Roles & Permissions
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Configure module access for each role in your firm.</p>
        </div>
        {canEdit && (
          <Button onClick={saveAll} disabled={saving || !dirty}>
            {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
            Save Changes
          </Button>
        )}
      </div>

      {isSuperadmin && firmsList.length > 0 && (
        <Select value={selectedFirmId || ""} onValueChange={v => setSelectedFirmId(v)}>
          <SelectTrigger className="w-64"><SelectValue placeholder="Select firm" /></SelectTrigger>
          <SelectContent>
            {firmsList.map(f => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}
          </SelectContent>
        </Select>
      )}

      <Card>
        <CardContent className="p-0">
          <div className="overflow-auto max-h-[70vh]">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-muted">
                <tr>
                  <th className="sticky left-0 z-20 bg-muted text-left px-4 py-3 font-semibold text-foreground min-w-[160px]">
                    Module
                  </th>
                  {ALL_ROLES.filter(r => r !== "superadmin").map(role => (
                    <th key={role} className="px-3 py-3 text-center min-w-[140px]">
                      <div className="space-y-1">
                        <Badge className={cn("text-xs", ROLE_COLORS[role])}>
                          {ROLE_LABELS[role]}
                        </Badge>
                        {canEdit && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 text-[10px] text-muted-foreground"
                            onClick={() => setResetRole(role)}
                          >
                            <RotateCcw className="h-3 w-3 mr-1" /> Reset
                          </Button>
                        )}
                        {lastModified[role] && (
                          <p className="text-[10px] text-muted-foreground flex items-center justify-center gap-1">
                            <Clock className="h-2.5 w-2.5" />
                            {lastModified[role].by} · {format(new Date(lastModified[role].at), "dd MMM")}
                          </p>
                        )}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ALL_MODULES.map(mod => (
                  <tr key={mod} className="border-t border-border hover:bg-muted/50">
                    <td className="sticky left-0 z-10 bg-background px-4 py-3 font-medium text-foreground whitespace-nowrap">
                      {MODULE_LABELS[mod] || mod}
                    </td>
                    {ALL_ROLES.filter(r => r !== "superadmin").map(role => {
                      const row = grid[role]?.[mod];
                      if (!row) return <td key={role} />;
                      return (
                        <td key={role} className="px-3 py-2">
                          <div className="flex flex-wrap gap-x-3 gap-y-1 justify-center">
                            {PERM_FIELDS.map(field => (
                              <label key={field} className="flex items-center gap-1 cursor-pointer">
                                <Switch
                                  checked={(row as any)[field] ?? false}
                                  onCheckedChange={() => togglePerm(role, mod, field)}
                                  disabled={!canEdit}
                                  className="scale-75"
                                />
                                <span className="text-[10px] text-muted-foreground">{PERM_LABELS[field]}</span>
                              </label>
                            ))}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Reset Confirmation */}
      <AlertDialog open={!!resetRole} onOpenChange={() => setResetRole(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset to Defaults?</AlertDialogTitle>
            <AlertDialogDescription>
              This will reset all permissions for {resetRole ? ROLE_LABELS[resetRole] : ""} to system defaults. You'll need to click "Save Changes" to apply.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleReset}>Reset</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default RolesPermissions;
