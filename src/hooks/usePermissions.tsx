import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";

// All modules in the system
export const ALL_MODULES = [
  "Dashboard", "Clients", "IT Returns", "TDS", "Billing",
  "Depreciation", "Audit Intelligence", "Chat", "Settings",
  "Roles", "Theme Studio",
] as const;

export type ModuleName = typeof ALL_MODULES[number];

export const ALL_ROLES = [
  "superadmin", "firm_admin", "partner_ca", "manager", "staff_article", "client",
] as const;

export type RoleName = typeof ALL_ROLES[number];

export interface ModulePermission {
  can_view: boolean;
  can_create: boolean;
  can_edit: boolean;
  can_delete: boolean;
  can_export: boolean;
}

type PermissionMap = Record<string, ModulePermission>;

interface PermissionsContextType {
  permissions: PermissionMap;
  allPermissions: Record<string, PermissionMap>; // role -> module -> perms (for admin grid)
  loading: boolean;
  can: (module: string, action: keyof ModulePermission) => boolean;
  refresh: () => Promise<void>;
}

const PermissionsContext = createContext<PermissionsContextType>({
  permissions: {},
  allPermissions: {},
  loading: true,
  can: () => false,
  refresh: async () => {},
});

// Default permission matrix for seeding
export const DEFAULT_PERMISSIONS: Record<RoleName, Record<ModuleName, ModulePermission>> = {
  superadmin: Object.fromEntries(ALL_MODULES.map(m => [m, { can_view: true, can_create: true, can_edit: true, can_delete: true, can_export: true }])) as any,
  firm_admin: Object.fromEntries(ALL_MODULES.map(m => [m, { can_view: true, can_create: true, can_edit: true, can_delete: true, can_export: true }])) as any,
  partner_ca: Object.fromEntries(ALL_MODULES.map(m => {
    if (["Settings", "Roles", "Theme Studio"].includes(m)) return [m, { can_view: true, can_create: false, can_edit: false, can_delete: false, can_export: false }];
    return [m, { can_view: true, can_create: true, can_edit: true, can_delete: true, can_export: true }];
  })) as any,
  manager: Object.fromEntries(ALL_MODULES.map(m => {
    if (["Settings", "Roles", "Theme Studio"].includes(m)) return [m, { can_view: false, can_create: false, can_edit: false, can_delete: false, can_export: false }];
    if (m === "Billing") return [m, { can_view: true, can_create: false, can_edit: false, can_delete: false, can_export: false }];
    return [m, { can_view: true, can_create: true, can_edit: true, can_delete: false, can_export: true }];
  })) as any,
  staff_article: Object.fromEntries(ALL_MODULES.map(m => {
    if (["Settings", "Roles", "Theme Studio"].includes(m)) return [m, { can_view: false, can_create: false, can_edit: false, can_delete: false, can_export: false }];
    if (m === "Billing") return [m, { can_view: true, can_create: false, can_edit: false, can_delete: false, can_export: false }];
    if (["Dashboard", "Chat"].includes(m)) return [m, { can_view: true, can_create: false, can_edit: false, can_delete: false, can_export: false }];
    return [m, { can_view: true, can_create: true, can_edit: true, can_delete: false, can_export: false }];
  })) as any,
  client: Object.fromEntries(ALL_MODULES.map(m => {
    if (["Dashboard", "Clients"].includes(m)) return [m, { can_view: true, can_create: false, can_edit: false, can_delete: false, can_export: false }];
    return [m, { can_view: false, can_create: false, can_edit: false, can_delete: false, can_export: false }];
  })) as any,
};

export function PermissionsProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [permissions, setPermissions] = useState<PermissionMap>({});
  const [allPermissions, setAllPermissions] = useState<Record<string, PermissionMap>>({});
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!user) {
      setPermissions({});
      setAllPermissions({});
      setLoading(false);
      return;
    }

    const role = user.role || "staff_article";

    // Superadmin gets everything
    if (role === "superadmin") {
      const fullPerms: PermissionMap = {};
      ALL_MODULES.forEach(m => {
        fullPerms[m] = { can_view: true, can_create: true, can_edit: true, can_delete: true, can_export: true };
      });
      setPermissions(fullPerms);

      // Also load all roles for the admin grid
      if (user.firm_id) {
        const { data } = await supabase
          .from("role_permissions")
          .select("*")
          .eq("firm_id", user.firm_id);
        if (data && data.length > 0) {
          const all: Record<string, PermissionMap> = {};
          data.forEach((row: any) => {
            if (!all[row.role]) all[row.role] = {};
            all[row.role][row.module] = {
              can_view: row.can_view ?? false,
              can_create: row.can_create ?? false,
              can_edit: row.can_edit ?? false,
              can_delete: row.can_delete ?? false,
              can_export: row.can_export ?? false,
            };
          });
          setAllPermissions(all);
        }
      }
      setLoading(false);
      return;
    }

    // For other roles, try to load from DB
    if (user.firm_id) {
      const { data } = await supabase
        .from("role_permissions")
        .select("*")
        .eq("firm_id", user.firm_id)
        .eq("role", role);

      if (data && data.length > 0) {
        const perms: PermissionMap = {};
        data.forEach((row: any) => {
          perms[row.module] = {
            can_view: row.can_view ?? false,
            can_create: row.can_create ?? false,
            can_edit: row.can_edit ?? false,
            can_delete: row.can_delete ?? false,
            can_export: row.can_export ?? false,
          };
        });
        setPermissions(perms);

        // If firm_admin, also load all roles for admin grid
        if (role === "firm_admin") {
          const { data: allData } = await supabase
            .from("role_permissions")
            .select("*")
            .eq("firm_id", user.firm_id);
          if (allData) {
            const all: Record<string, PermissionMap> = {};
            allData.forEach((row: any) => {
              if (!all[row.role]) all[row.role] = {};
              all[row.role][row.module] = {
                can_view: row.can_view ?? false,
                can_create: row.can_create ?? false,
                can_edit: row.can_edit ?? false,
                can_delete: row.can_delete ?? false,
                can_export: row.can_export ?? false,
              };
            });
            setAllPermissions(all);
          }
        }

        setLoading(false);
        return;
      }
    }

    // Fallback to defaults
    const defaults = DEFAULT_PERMISSIONS[role as RoleName];
    if (defaults) {
      setPermissions(defaults);
    }
    setLoading(false);
  }, [user?.id, user?.role, user?.firm_id]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const can = useCallback(
    (module: string, action: keyof ModulePermission): boolean => {
      if (user?.role === "superadmin") return true;
      const mp = permissions[module];
      if (!mp) return false;
      return mp[action] ?? false;
    },
    [permissions, user?.role]
  );

  return (
    <PermissionsContext.Provider value={{ permissions, allPermissions, loading, can, refresh }}>
      {children}
    </PermissionsContext.Provider>
  );
}

export function usePermissions() {
  return useContext(PermissionsContext);
}
