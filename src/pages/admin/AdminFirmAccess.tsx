import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { Search, Building2, Users, ShieldCheck, Home } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface UserRow {
  id: string;
  name: string | null;
  email: string | null;
  role: string | null;
  firm_id: string | null;
  firm_name: string | null;
}

interface FirmRow {
  id: string;
  name: string;
}

interface AccessRow {
  firm_id: string;
  can_view: boolean;
  can_create: boolean;
  can_edit: boolean;
  can_delete: boolean;
  can_export: boolean;
}

type PermAction = "can_view" | "can_create" | "can_edit" | "can_delete" | "can_export";
const PERM_COLS: { key: PermAction; label: string }[] = [
  { key: "can_view",   label: "View"   },
  { key: "can_create", label: "Create" },
  { key: "can_edit",   label: "Edit"   },
  { key: "can_delete", label: "Delete" },
  { key: "can_export", label: "Export" },
];

const ROLE_LABELS: Record<string, string> = {
  firm_admin:     "Firm Admin",
  partner_ca:     "Partner CA",
  manager:        "Manager",
  staff_article:  "Staff / Article",
  client:         "Client",
};

// ─── Component ────────────────────────────────────────────────────────────────

const AdminFirmAccess = () => {
  const navigate   = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const { toast }  = useToast();

  const [users,      setUsers]      = useState<UserRow[]>([]);
  const [firms,      setFirms]      = useState<FirmRow[]>([]);
  const [access,     setAccess]     = useState<AccessRow[]>([]); // grants for selected user
  const [selected,   setSelected]   = useState<UserRow | null>(null);
  const [userSearch, setUserSearch] = useState("");
  const [loadingUsers,  setLoadingUsers]  = useState(true);
  const [loadingAccess, setLoadingAccess] = useState(false);
  const [toggling, setToggling] = useState<string | null>(null); // "<firm_id>.<perm>"

  // Guard: superadmin only — wait for role to resolve (null = optimistic JWT phase)
  useEffect(() => {
    if (!authLoading && user?.role && user.role !== "superadmin") {
      navigate("/", { replace: true });
    }
  }, [authLoading, user, navigate]);

  // ── Load users + firms ────────────────────────────────────────────────────
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
        id:        u.id,
        name:      u.name,
        email:     u.email,
        role:      u.role,
        firm_id:   u.firm_id,
        firm_name: u.firms?.name ?? "—",
      }))
    );
    setFirms((fData || []).map((f: any) => ({ id: f.id, name: f.name })));
    setLoadingUsers(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // ── Load access for selected user ─────────────────────────────────────────
  const loadAccess = useCallback(async (userId: string) => {
    setLoadingAccess(true);
    const { data } = await (supabase as any)
      .from("user_firm_access")
      .select("firm_id, can_view, can_create, can_edit, can_delete, can_export")
      .eq("user_id", userId);
    setAccess(data || []);
    setLoadingAccess(false);
  }, []);

  const selectUser = (u: UserRow) => {
    setSelected(u);
    loadAccess(u.id);
  };

  // ── Helpers ──────────────────────────────────────────────────────────────
  const getAccess = (firmId: string): AccessRow | undefined =>
    access.find(a => a.firm_id === firmId);

  const grantCount = (u: UserRow) =>
    /* will be slightly stale until user is selected — good enough for badge */
    selected?.id === u.id ? access.length : 0;

  // ── Toggle a single permission ────────────────────────────────────────────
  const togglePerm = async (firmId: string, perm: PermAction, currentValue: boolean) => {
    if (!selected) return;
    const key = `${firmId}.${perm}`;
    setToggling(key);

    const existing = getAccess(firmId);
    const newValue = !currentValue;

    try {
      if (!existing) {
        // No row yet — insert with this perm true, rest false
        const payload: Record<string, any> = {
          user_id: selected.id,
          firm_id: firmId,
          granted_by: user?.id,
          can_view: false, can_create: false, can_edit: false,
          can_delete: false, can_export: false,
          [perm]: true,
        };
        const { error } = await (supabase as any)
          .from("user_firm_access")
          .insert(payload);
        if (error) throw error;
        setAccess(prev => [...prev, {
          firm_id: firmId,
          can_view: false, can_create: false, can_edit: false,
          can_delete: false, can_export: false,
          [perm]: true,
        } as AccessRow]);
      } else {
        const updated = { ...existing, [perm]: newValue };
        const allOff = !updated.can_view && !updated.can_create &&
                       !updated.can_edit  && !updated.can_delete && !updated.can_export;

        if (allOff) {
          // Remove the row entirely
          const { error } = await (supabase as any)
            .from("user_firm_access")
            .delete()
            .eq("user_id", selected.id)
            .eq("firm_id", firmId);
          if (error) throw error;
          setAccess(prev => prev.filter(a => a.firm_id !== firmId));
        } else {
          const { error } = await (supabase as any)
            .from("user_firm_access")
            .update({ [perm]: newValue })
            .eq("user_id", selected.id)
            .eq("firm_id", firmId);
          if (error) throw error;
          setAccess(prev =>
            prev.map(a => a.firm_id === firmId ? { ...a, [perm]: newValue } : a)
          );
        }
      }
      toast({ title: newValue ? "Access granted" : "Access revoked" });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setToggling(null);
    }
  };

  // ── Grant All View ────────────────────────────────────────────────────────
  const grantAllView = async () => {
    if (!selected) return;
    setLoadingAccess(true);
    try {
      const otherFirms = firms.filter(f => f.id !== selected.firm_id);
      for (const f of otherFirms) {
        const existing = getAccess(f.id);
        if (existing) {
          await (supabase as any)
            .from("user_firm_access")
            .update({ can_view: true })
            .eq("user_id", selected.id)
            .eq("firm_id", f.id);
        } else {
          await (supabase as any)
            .from("user_firm_access")
            .insert({
              user_id: selected.id, firm_id: f.id, granted_by: user?.id,
              can_view: true, can_create: false, can_edit: false,
              can_delete: false, can_export: false,
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

  // ── Revoke All ────────────────────────────────────────────────────────────
  const revokeAll = async () => {
    if (!selected) return;
    setLoadingAccess(true);
    try {
      const { error } = await (supabase as any)
        .from("user_firm_access")
        .delete()
        .eq("user_id", selected.id);
      if (error) throw error;
      setAccess([]);
      toast({ title: "All cross-firm access revoked" });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setLoadingAccess(false);
    }
  };

  // ── Filtered users ────────────────────────────────────────────────────────
  const filteredUsers = users.filter(u => {
    const q = userSearch.toLowerCase();
    return (
      (u.name || "").toLowerCase().includes(q) ||
      (u.email || "").toLowerCase().includes(q) ||
      (u.firm_name || "").toLowerCase().includes(q)
    );
  });

  // ── Other firms (excluding user's home firm) ──────────────────────────────
  const otherFirms = selected
    ? firms.filter(f => f.id !== selected.firm_id)
    : firms;

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <ShieldCheck className="text-primary" size={22} />
          Cross-Firm Access
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Grant users configurable access to Billing data of other firms.
          Changes take effect immediately.
        </p>
      </div>

      {/* Body */}
      <div className="flex gap-4 h-[calc(100vh-200px)] min-h-[500px]">

        {/* ── Left panel: user list ─────────────────────────────────────── */}
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
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-14 w-full rounded" />
                ))}
              </div>
            ) : filteredUsers.length === 0 ? (
              <div className="p-6 text-center text-sm text-muted-foreground">
                No users found
              </div>
            ) : (
              filteredUsers.map(u => {
                const isSelected = selected?.id === u.id;
                const grants = isSelected ? access.length : 0;
                return (
                  <button
                    key={u.id}
                    onClick={() => selectUser(u)}
                    className={cn(
                      "w-full text-left px-3 py-2.5 border-b last:border-0 transition-colors",
                      isSelected
                        ? "bg-primary/10 border-l-2 border-l-primary"
                        : "hover:bg-muted/50"
                    )}
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-sm font-medium text-foreground truncate">
                        {u.name || "—"}
                      </span>
                      {isSelected && grants > 0 && (
                        <Badge variant="secondary" className="text-[10px] shrink-0">
                          +{grants}
                        </Badge>
                      )}
                    </div>
                    <div className="text-[11px] text-muted-foreground truncate">
                      {u.firm_name}
                    </div>
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

        {/* ── Right panel: firm access matrix ──────────────────────────── */}
        <div className="flex-1 border rounded-lg bg-card overflow-hidden flex flex-col">
          {!selected ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 text-muted-foreground">
              <Users size={40} className="opacity-30" />
              <p className="text-sm">Select a user on the left to manage their firm access</p>
            </div>
          ) : (
            <>
              {/* Panel header */}
              <div className="p-4 border-b flex items-center justify-between gap-4">
                <div>
                  <h2 className="font-semibold text-foreground">{selected.name}</h2>
                  <p className="text-xs text-muted-foreground">
                    {selected.email} · {ROLE_LABELS[selected.role || ""] || selected.role}
                  </p>
                </div>
                <div className="flex gap-2 shrink-0">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={grantAllView}
                    disabled={loadingAccess}
                    className="text-xs"
                  >
                    Grant All View
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={revokeAll}
                    disabled={loadingAccess || access.length === 0}
                    className="text-xs"
                  >
                    Revoke All
                  </Button>
                </div>
              </div>

              {/* Home firm row */}
              <div className="px-4 py-2.5 bg-muted/30 border-b flex items-center gap-2">
                <Home size={14} className="text-primary shrink-0" />
                <span className="text-sm font-medium text-foreground">{selected.firm_name}</span>
                <Badge variant="secondary" className="text-[10px] ml-1">Home Firm — always accessible</Badge>
              </div>

              {/* Access table */}
              <div className="flex-1 overflow-y-auto">
                {loadingAccess ? (
                  <div className="p-4 space-y-3">
                    {Array.from({ length: 4 }).map((_, i) => (
                      <Skeleton key={i} className="h-10 w-full rounded" />
                    ))}
                  </div>
                ) : otherFirms.length === 0 ? (
                  <div className="p-6 text-center text-sm text-muted-foreground">
                    No other firms available
                  </div>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/20 text-xs text-muted-foreground">
                        <th className="text-left px-4 py-2 font-medium w-full">Firm</th>
                        {PERM_COLS.map(p => (
                          <th key={p.key} className="px-4 py-2 font-medium text-center whitespace-nowrap">
                            {p.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {otherFirms.map(firm => {
                        const row = getAccess(firm.id);
                        const hasAny = !!row;
                        return (
                          <tr
                            key={firm.id}
                            className={cn(
                              "border-b last:border-0 transition-colors",
                              hasAny ? "bg-primary/5" : "hover:bg-muted/30"
                            )}
                          >
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-2">
                                <Building2 size={13} className={cn(
                                  "shrink-0",
                                  hasAny ? "text-primary" : "text-muted-foreground"
                                )} />
                                <span className={cn(
                                  "font-medium",
                                  hasAny ? "text-foreground" : "text-muted-foreground"
                                )}>
                                  {firm.name}
                                </span>
                              </div>
                            </td>
                            {PERM_COLS.map(p => {
                              const val = row ? row[p.key] : false;
                              const key = `${firm.id}.${p.key}`;
                              const isLoading = toggling === key;
                              return (
                                <td key={p.key} className="px-4 py-3 text-center">
                                  <Checkbox
                                    checked={val}
                                    disabled={isLoading}
                                    onCheckedChange={() => togglePerm(firm.id, p.key, val)}
                                    className={cn(
                                      "mx-auto",
                                      val && "data-[state=checked]:bg-primary"
                                    )}
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
};

export default AdminFirmAccess;
