import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import {
  ALL_MODULES, ALL_ROLES, DEFAULT_PERMISSIONS, usePermissions,
  type ModuleName, type RoleName,
} from "@/hooks/usePermissions";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Shield, RotateCcw, Loader2, Save, Clock, Lock, Search,
  Building2, Users, ShieldCheck, Home, KeyRound,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";

// ─── Shared constants ─────────────────────────────────────────────────────────

const PERM_FIELDS = ["can_view", "can_create", "can_edit", "can_delete", "can_export"] as const;
const PERM_LABELS: Record<string, string> = {
  can_view: "View", can_create: "Create", can_edit: "Edit",
  can_delete: "Delete", can_export: "Export",
};
type PermAction = typeof PERM_FIELDS[number];

const ROLE_LABELS: Record<string, string> = {
  superadmin: "Super Admin", firm_admin: "Firm Admin", master_admin: "Master Admin",
  partner_ca: "Partner/CA", manager: "Manager", staff_article: "Staff/Article",
  client: "Client",
};
const MODULE_LABELS: Record<string, string> = {
  "Firm Management": "Firm Management",
  "Client Management": "Client Management",
  "Service Masters": "Service Masters",
  "IT Returns": "IT Returns + Compliance",
  "TDS": "TDS Management",
  "Billing": "Billing",
  "Depreciation": "Depreciation Module",
  "Audit Intelligence": "Audit Intelligence (1-10)",
  "Chat": "Chat & Collaboration",
  "Settings": "Settings / Access & Permissions",
  "Theme Studio": "Theme Studio",
};
const ROLE_COLORS: Record<string, string> = {
  superadmin: "bg-destructive/15 text-destructive",
  master_admin: "bg-purple-100 text-purple-800",
  firm_admin: "bg-primary/15 text-primary",
  partner_ca: "bg-amber-100 text-amber-800",
  manager: "bg-blue-100 text-blue-800",
  staff_article: "bg-green-100 text-green-800",
  client: "bg-muted text-muted-foreground",
};

// ─── Tab 1: Roles & Modules ───────────────────────────────────────────────────

interface PermRow {
  id?: string;
  firm_id: null;
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

function RolesModulesTab({ canEdit }: { canEdit: boolean }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const { refresh: refreshCtx } = usePermissions();
  const [grid, setGrid] = useState<Record<string, Record<string, PermRow>>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [savedGrid, setSavedGrid] = useState<Record<string, Record<string, PermRow>>>({});
  const [resetRole, setResetRole] = useState<string | null>(null);
  const [lastModified, setLastModified] = useState<Record<string, { by: string; at: string }>>({});

  useEffect(() => { loadGrid(); }, []);

  async function loadGrid() {
    setLoading(true);
    const { data } = await supabase.from("role_permissions").select("*").is("firm_id", null);

    const g: Record<string, Record<string, PermRow>> = {};
    const lm: Record<string, { by: string; at: string }> = {};

    if (data && data.length > 0) {
      for (const row of data as any[]) {
        if (!g[row.role]) g[row.role] = {};
        g[row.role][row.module] = { ...row, firm_id: null };
        if (row.updated_at && row.updated_by) {
          const key = row.role;
          if (!lm[key] || new Date(row.updated_at) > new Date(lm[key].at))
            lm[key] = { by: row.updated_by, at: row.updated_at };
        }
      }
    }

    for (const role of ALL_ROLES) {
      if (!g[role]) g[role] = {};
      for (const mod of ALL_MODULES) {
        if (!g[role][mod]) {
          const def = DEFAULT_PERMISSIONS[role as RoleName]?.[mod as ModuleName]
            || { can_view: false, can_create: false, can_edit: false, can_delete: false, can_export: false };
          g[role][mod] = { firm_id: null, role, module: mod, ...def };
        }
      }
    }

    const userIds = [...new Set(Object.values(lm).map(v => v.by))];
    if (userIds.length > 0) {
      const { data: users } = await supabase.from("users").select("id, name").in("id", userIds);
      if (users) {
        const nameMap: Record<string, string> = {};
        users.forEach((u: any) => { nameMap[u.id] = u.name || "Unknown"; });
        Object.keys(lm).forEach(k => { lm[k].by = nameMap[lm[k].by] || lm[k].by; });
      }
    }

    setGrid(g);
    setSavedGrid(JSON.parse(JSON.stringify(g)));
    setLastModified(lm);
    setDirty(false);
    setLoading(false);
  }

  function togglePerm(role: string, module: string, field: typeof PERM_FIELDS[number]) {
    if (!canEdit) return;
    setGrid(prev => {
      const row = { ...prev[role][module] };
      const newVal = !(row as any)[field];
      (row as any)[field] = newVal;
      if (newVal && field !== "can_view") row.can_view = true;
      if (!newVal && field === "can_view") {
        row.can_create = false; row.can_edit = false;
        row.can_delete = false; row.can_export = false;
      }
      return { ...prev, [role]: { ...prev[role], [module]: row } };
    });
    setDirty(true);
  }

  async function saveAll() {
    if (!canEdit) return;
    setSaving(true);
    try {
      const rows: any[] = [];
      for (const role of ALL_ROLES) {
        for (const mod of ALL_MODULES) {
          const r = grid[role]?.[mod];
          if (!r) continue;
          rows.push({
            firm_id: null, role, module: mod,
            can_view: r.can_view, can_create: r.can_create,
            can_edit: r.can_edit, can_delete: r.can_delete, can_export: r.can_export,
            updated_by: user?.id, updated_at: new Date().toISOString(),
          });
        }
      }
      const { error: delError } = await supabase.from("role_permissions").delete().is("firm_id", null);
      if (delError) throw delError;
      const { error: insError } = await supabase.from("role_permissions").insert(rows);
      if (insError) throw insError;
      toast({ title: "Permissions saved globally" });
      setDirty(false);
      setSavedGrid(JSON.parse(JSON.stringify(grid)));
      await refreshCtx();
      await loadGrid();
    } catch (e: any) {
      toast({ title: "Error saving permissions", description: e?.message ?? String(e), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function handleReset() {
    if (!resetRole) return;
    const savedRoleGrid = savedGrid[resetRole];
    const defaults = DEFAULT_PERMISSIONS[resetRole as RoleName];
    setGrid(prev => {
      const updated = { ...prev };
      updated[resetRole!] = {};
      for (const mod of ALL_MODULES) {
        const savedRow = savedRoleGrid?.[mod];
        const defRow = defaults?.[mod as ModuleName]
          || { can_view: false, can_create: false, can_edit: false, can_delete: false, can_export: false };
        updated[resetRole!][mod] = savedRow
          ? { ...savedRow }
          : { firm_id: null, role: resetRole!, module: mod, ...defRow };
      }
      return updated;
    });
    setDirty(true);
    setResetRole(null);
    toast({
      title: savedGrid[resetRole]
        ? `${ROLE_LABELS[resetRole]} permissions reverted to last saved state`
        : `${ROLE_LABELS[resetRole]} permissions reset to system defaults`,
    });
  }

  if (loading) {
    return (
      <div className="space-y-4 pt-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-[400px] w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {canEdit
            ? "Global permission matrix — applies to all firms. Changes saved here override defaults for every user of that role."
            : "Read-only. Only Super Admins can modify global permissions."}
        </p>
        <div className="flex items-center gap-2">
          {!canEdit && (
            <Badge variant="secondary" className="flex items-center gap-1">
              <Lock className="h-3 w-3" /> Read-only
            </Badge>
          )}
          {canEdit && (
            <Button onClick={saveAll} disabled={saving || !dirty}>
              {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
              Save Changes
            </Button>
          )}
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-auto max-h-[62vh]">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-muted">
                <tr>
                  <th className="sticky left-0 z-20 bg-muted text-left px-4 py-3 font-semibold text-foreground min-w-[160px]">
                    Module
                  </th>
                  {ALL_ROLES.filter(r => r !== "superadmin").map(role => (
                    <th key={role} className="px-3 py-3 text-center min-w-[140px]">
                      <div className="space-y-1">
                        <Badge className={cn("text-xs", ROLE_COLORS[role] ?? "bg-muted text-muted-foreground")}>
                          {ROLE_LABELS[role] || role}
                        </Badge>
                        {canEdit && (
                          <Button
                            variant="ghost" size="sm"
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

      <AlertDialog open={!!resetRole} onOpenChange={() => setResetRole(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset to Defaults?</AlertDialogTitle>
            <AlertDialogDescription>
              This will revert all permissions for {resetRole ? ROLE_LABELS[resetRole] : ""} to the last saved state
              (or system defaults if no save exists yet). You&apos;ll need to click "Save Changes" to persist.
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
}

// ─── Tab 2: Firm Access ───────────────────────────────────────────────────────

interface UserRow {
  id: string;
  name: string | null;
  email: string | null;
  role: string | null;
  firm_id: string | null;
  firm_name: string | null;
}
interface FirmRow { id: string; name: string; }
interface AccessRow {
  firm_id: string;
  can_view: boolean; can_create: boolean; can_edit: boolean;
  can_delete: boolean; can_export: boolean;
}

const PERM_COLS: { key: PermAction; label: string }[] = [
  { key: "can_view", label: "View" }, { key: "can_create", label: "Create" },
  { key: "can_edit", label: "Edit" }, { key: "can_delete", label: "Delete" },
  { key: "can_export", label: "Export" },
];

function FirmAccessTab() {
  const { user } = useAuth();
  const { toast } = useToast();

  const [users, setUsers] = useState<UserRow[]>([]);
  const [firms, setFirms] = useState<FirmRow[]>([]);
  const [access, setAccess] = useState<AccessRow[]>([]);
  const [selected, setSelected] = useState<UserRow | null>(null);
  const [userSearch, setUserSearch] = useState("");
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [loadingAccess, setLoadingAccess] = useState(false);
  const [toggling, setToggling] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoadingUsers(true);
    const [{ data: uData }, { data: fData }] = await Promise.all([
      (supabase as any)
        .from("users")
        .select("id, name, email, role, firm_id, firms(name)")
        .not("role", "in", "(superadmin,client)")
        .eq("is_active", true)
        .order("name"),
      (supabase as any).from("firms").select("id, name").order("name"),
    ]);
    setUsers(
      (uData || []).map((u: any) => ({
        id: u.id, name: u.name, email: u.email,
        role: u.role, firm_id: u.firm_id, firm_name: u.firms?.name ?? "—",
      }))
    );
    setFirms((fData || []).map((f: any) => ({ id: f.id, name: f.name })));
    setLoadingUsers(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const loadAccess = useCallback(async (userId: string) => {
    setLoadingAccess(true);
    const { data } = await (supabase as any)
      .from("user_firm_access")
      .select("firm_id, can_view, can_create, can_edit, can_delete, can_export")
      .eq("user_id", userId);
    setAccess(data || []);
    setLoadingAccess(false);
  }, []);

  const selectUser = (u: UserRow) => { setSelected(u); loadAccess(u.id); };
  const getAccess = (firmId: string) => access.find(a => a.firm_id === firmId);

  const togglePerm = async (firmId: string, perm: PermAction, currentValue: boolean) => {
    if (!selected) return;
    const key = `${firmId}.${perm}`;
    setToggling(key);
    const existing = getAccess(firmId);
    const newValue = !currentValue;
    try {
      if (!existing) {
        const payload: Record<string, any> = {
          user_id: selected.id, firm_id: firmId, granted_by: user?.id,
          can_view: false, can_create: false, can_edit: false, can_delete: false, can_export: false,
          [perm]: true,
        };
        const { error } = await (supabase as any).from("user_firm_access").insert(payload);
        if (error) throw error;
        setAccess(prev => [...prev, {
          firm_id: firmId, can_view: false, can_create: false, can_edit: false,
          can_delete: false, can_export: false, [perm]: true,
        } as AccessRow]);
      } else {
        const updated = { ...existing, [perm]: newValue };
        const allOff = !updated.can_view && !updated.can_create &&
          !updated.can_edit && !updated.can_delete && !updated.can_export;
        if (allOff) {
          const { error } = await (supabase as any).from("user_firm_access").delete()
            .eq("user_id", selected.id).eq("firm_id", firmId);
          if (error) throw error;
          setAccess(prev => prev.filter(a => a.firm_id !== firmId));
        } else {
          const { error } = await (supabase as any).from("user_firm_access").update({ [perm]: newValue })
            .eq("user_id", selected.id).eq("firm_id", firmId);
          if (error) throw error;
          setAccess(prev => prev.map(a => a.firm_id === firmId ? { ...a, [perm]: newValue } : a));
        }
      }
      toast({ title: newValue ? "Access granted" : "Access revoked" });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setToggling(null);
    }
  };

  const grantAllView = async () => {
    if (!selected) return;
    setLoadingAccess(true);
    try {
      const otherFirms = firms.filter(f => f.id !== selected.firm_id);
      for (const f of otherFirms) {
        const existing = getAccess(f.id);
        if (existing) {
          await (supabase as any).from("user_firm_access").update({ can_view: true })
            .eq("user_id", selected.id).eq("firm_id", f.id);
        } else {
          await (supabase as any).from("user_firm_access").insert({
            user_id: selected.id, firm_id: f.id, granted_by: user?.id,
            can_view: true, can_create: false, can_edit: false, can_delete: false, can_export: false,
          });
        }
      }
      await loadAccess(selected.id);
      toast({ title: "View access granted to all firms" });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setLoadingAccess(false);
    }
  };

  const revokeAll = async () => {
    if (!selected) return;
    setLoadingAccess(true);
    try {
      const { error } = await (supabase as any).from("user_firm_access").delete().eq("user_id", selected.id);
      if (error) throw error;
      setAccess([]);
      toast({ title: "All cross-firm access revoked" });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setLoadingAccess(false);
    }
  };

  const filteredUsers = users.filter(u => {
    const q = userSearch.toLowerCase();
    return (
      (u.name || "").toLowerCase().includes(q) ||
      (u.email || "").toLowerCase().includes(q) ||
      (u.firm_name || "").toLowerCase().includes(q)
    );
  });

  const otherFirms = selected ? firms.filter(f => f.id !== selected.firm_id) : firms;
  const isSingleFirm = firms.length <= 1;

  if (isSingleFirm) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[300px] gap-3 text-muted-foreground">
        <Building2 size={40} className="opacity-30" />
        <p className="text-sm text-center">
          Firm Access is available once you have multiple firms in your Practice Group.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Grant users configurable cross-firm access. Changes take effect immediately.
      </p>

      <div className="flex gap-4 h-[calc(100vh-340px)] min-h-[420px]">
        {/* Left: user list */}
        <div className="w-72 shrink-0 flex flex-col border rounded-lg bg-card overflow-hidden">
          <div className="p-3 border-b">
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-2.5 text-muted-foreground" />
              <Input
                placeholder="Search users..."
                value={userSearch}
                onChange={e => setUserSearch(e.target.value)}
                className="pl-8 h-8 text-sm"
              />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {loadingUsers ? (
              <div className="p-3 space-y-2">
                {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-14 w-full rounded" />)}
              </div>
            ) : filteredUsers.length === 0 ? (
              <div className="p-6 text-center text-sm text-muted-foreground">No users found</div>
            ) : (
              filteredUsers.map(u => {
                const isSelected = selected?.id === u.id;
                return (
                  <button
                    key={u.id}
                    onClick={() => selectUser(u)}
                    className={cn(
                      "w-full text-left px-3 py-2.5 border-b last:border-0 transition-colors",
                      isSelected ? "bg-primary/10 border-l-2 border-l-primary" : "hover:bg-muted/50"
                    )}
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-sm font-medium text-foreground truncate">{u.name || "—"}</span>
                      {isSelected && access.length > 0 && (
                        <Badge variant="secondary" className="text-[10px] shrink-0">+{access.length}</Badge>
                      )}
                    </div>
                    <div className="text-[11px] text-muted-foreground truncate">{u.firm_name}</div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">
                      <Badge variant="outline" className="text-[9px] px-1 py-0">
                        {ROLE_LABELS[u.role || ""] || u.role}
                      </Badge>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Right: access matrix */}
        <div className="flex-1 border rounded-lg bg-card overflow-hidden flex flex-col">
          {!selected ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 text-muted-foreground">
              <Users size={40} className="opacity-30" />
              <p className="text-sm">Select a user on the left to manage their firm access</p>
            </div>
          ) : (
            <>
              <div className="p-4 border-b flex items-center justify-between gap-4">
                <div>
                  <h2 className="font-semibold text-foreground">{selected.name}</h2>
                  <p className="text-xs text-muted-foreground">
                    {selected.email} · {ROLE_LABELS[selected.role || ""] || selected.role}
                  </p>
                </div>
                <div className="flex gap-2 shrink-0">
                  <Button variant="outline" size="sm" onClick={grantAllView} disabled={loadingAccess} className="text-xs">
                    Grant All View
                  </Button>
                  <Button variant="destructive" size="sm" onClick={revokeAll} disabled={loadingAccess || access.length === 0} className="text-xs">
                    Revoke All
                  </Button>
                </div>
              </div>

              <div className="px-4 py-2.5 bg-muted/30 border-b flex items-center gap-2">
                <Home size={14} className="text-primary shrink-0" />
                <span className="text-sm font-medium text-foreground">{selected.firm_name}</span>
                <Badge variant="secondary" className="text-[10px] ml-1">Home Firm — always accessible</Badge>
              </div>

              <div className="flex-1 overflow-y-auto">
                {loadingAccess ? (
                  <div className="p-4 space-y-3">
                    {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10 w-full rounded" />)}
                  </div>
                ) : otherFirms.length === 0 ? (
                  <div className="p-6 text-center text-sm text-muted-foreground">No other firms available</div>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/20 text-xs text-muted-foreground">
                        <th className="text-left px-4 py-2 font-medium w-full">Firm</th>
                        {PERM_COLS.map(p => (
                          <th key={p.key} className="px-4 py-2 font-medium text-center whitespace-nowrap">{p.label}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {otherFirms.map(firm => {
                        const row = getAccess(firm.id);
                        const hasAny = !!row;
                        return (
                          <tr key={firm.id} className={cn(
                            "border-b last:border-0 transition-colors",
                            hasAny ? "bg-primary/5" : "hover:bg-muted/30"
                          )}>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-2">
                                <Building2 size={13} className={cn("shrink-0", hasAny ? "text-primary" : "text-muted-foreground")} />
                                <span className={cn("font-medium", hasAny ? "text-foreground" : "text-muted-foreground")}>
                                  {firm.name}
                                </span>
                              </div>
                            </td>
                            {PERM_COLS.map(p => {
                              const val = row ? row[p.key] : false;
                              const key = `${firm.id}.${p.key}`;
                              return (
                                <td key={p.key} className="px-4 py-3 text-center">
                                  <Checkbox
                                    checked={val}
                                    disabled={toggling === key}
                                    onCheckedChange={() => togglePerm(firm.id, p.key, val)}
                                    className={cn("mx-auto", val && "data-[state=checked]:bg-primary")}
                                  />
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

const AccessPermissions = () => {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const { can, loading: permissionsLoading } = usePermissions();

  const isSuperadmin = user?.role === "superadmin";
  const canViewSettings = isSuperadmin || can("Settings", "can_view");
  const canEdit = isSuperadmin;

  useEffect(() => {
    if (!authLoading && !permissionsLoading && !canViewSettings) {
      navigate("/", { replace: true });
    }
  }, [authLoading, permissionsLoading, canViewSettings, navigate]);

  if (permissionsLoading || authLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-[400px] w-full" />
      </div>
    );
  }

  if (!canViewSettings) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 text-center">
        <Lock className="h-12 w-12 text-muted-foreground/40" />
        <div>
          <h2 className="text-lg font-semibold text-foreground">Access Denied</h2>
          <p className="text-sm text-muted-foreground mt-1">
            You don&apos;t have permission to view Access &amp; Permissions.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-display font-bold text-foreground flex items-center gap-2">
            <ShieldCheck className="h-6 w-6" /> Access &amp; Permissions
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage role-based module permissions and cross-firm user access from one place.
          </p>
        </div>
        {!canEdit && (
          <Badge variant="secondary" className="flex items-center gap-1">
            <Lock className="h-3 w-3" /> Read-only
          </Badge>
        )}
      </div>

      <Tabs defaultValue="roles">
        <TabsList>
          <TabsTrigger value="roles" className="flex items-center gap-2">
            <Shield className="h-4 w-4" /> Roles &amp; Modules
          </TabsTrigger>
          <TabsTrigger value="firm-access" className="flex items-center gap-2">
            <KeyRound className="h-4 w-4" /> Firm Access
          </TabsTrigger>
        </TabsList>

        <TabsContent value="roles" className="mt-4">
          <RolesModulesTab canEdit={canEdit} />
        </TabsContent>

        <TabsContent value="firm-access" className="mt-4">
          <FirmAccessTab />
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default AccessPermissions;
