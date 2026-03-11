import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";

// All 11 modules matching v7 Excel matrix
export const ALL_MODULES = [
  "Firm Management", "Client Management", "Service Masters",
  "IT Returns", "TDS", "Billing",
  "Depreciation", "Audit Intelligence", "Chat",
  "Settings", "Theme Studio",
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
  allPermissions: Record<string, PermissionMap>;
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

const FULL: ModulePermission = { can_view: true, can_create: true, can_edit: true, can_delete: true, can_export: true };
const EDIT: ModulePermission = { can_view: true, can_create: true, can_edit: true, can_delete: false, can_export: true };
const VIEW: ModulePermission = { can_view: true, can_create: false, can_edit: false, can_delete: false, can_export: false };
const LIMITED_VIEW: ModulePermission = { can_view: true, can_create: false, can_edit: false, can_delete: false, can_export: false };
const LIMITED_CE: ModulePermission = { can_view: true, can_create: true, can_edit: false, can_delete: false, can_export: false };
const NONE: ModulePermission = { can_view: false, can_create: false, can_edit: false, can_delete: false, can_export: false };

// v7 Excel permission matrix
export const DEFAULT_PERMISSIONS: Record<RoleName, Record<ModuleName, ModulePermission>> = {
  superadmin: Object.fromEntries(ALL_MODULES.map(m => [m, FULL])) as any,
  firm_admin: Object.fromEntries(ALL_MODULES.map(m => [m, FULL])) as any,
  partner_ca: {
    "Firm Management": VIEW,
    "Client Management": FULL,
    "Service Masters": VIEW,
    "IT Returns": FULL,
    "TDS": FULL,
    "Billing": FULL,
    "Depreciation": FULL,
    "Audit Intelligence": FULL,
    "Chat": FULL,
    "Settings": VIEW,
    "Theme Studio": NONE,
  },
  manager: {
    "Firm Management": NONE,
    "Client Management": EDIT,
    "Service Masters": VIEW,
    "IT Returns": FULL,
    "TDS": FULL,
    "Billing": LIMITED_VIEW, // timesheet log + view invoices only
    "Depreciation": EDIT,
    "Audit Intelligence": EDIT, // stages 2-8
    "Chat": FULL,
    "Settings": NONE,
    "Theme Studio": NONE,
  },
  staff_article: {
    "Firm Management": NONE,
    "Client Management": LIMITED_CE, // view + create, no delete
    "Service Masters": NONE,
    "IT Returns": EDIT,
    "TDS": EDIT, // + filing status update
    "Billing": { can_view: true, can_create: false, can_edit: false, can_delete: false, can_export: false }, // timesheet log only
    "Depreciation": EDIT,
    "Audit Intelligence": EDIT, // stages 2-6 only
    "Chat": FULL,
    "Settings": NONE,
    "Theme Studio": NONE,
  },
  client: {
    "Firm Management": NONE,
    "Client Management": LIMITED_VIEW, // own data via portal
    "Service Masters": NONE,
    "IT Returns": LIMITED_VIEW, // own ITR status
    "TDS": NONE,
    "Billing": LIMITED_VIEW, // own invoices
    "Depreciation": NONE,
    "Audit Intelligence": { can_view: true, can_create: false, can_edit: true, can_delete: false, can_export: false }, // query responses
    "Chat": LIMITED_VIEW, // firm↔client only
    "Settings": NONE,
    "Theme Studio": NONE,
  },
};

// Legacy module name mapping for backward compatibility
const MODULE_ALIASES: Record<string, string> = {
  "Dashboard": "Client Management",
  "Clients": "Client Management",
  "Roles": "Settings",
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

    if (role === "superadmin") {
      const fullPerms: PermissionMap = {};
      ALL_MODULES.forEach(m => { fullPerms[m] = FULL; });
      setPermissions(fullPerms);

      if (user.firm_id) {
        const { data } = await supabase.from("role_permissions").select("*").eq("firm_id", user.firm_id);
        if (data && data.length > 0) {
          const all: Record<string, PermissionMap> = {};
          data.forEach((row: any) => {
            if (!all[row.role]) all[row.role] = {};
            all[row.role][row.module] = {
              can_view: row.can_view ?? false, can_create: row.can_create ?? false,
              can_edit: row.can_edit ?? false, can_delete: row.can_delete ?? false, can_export: row.can_export ?? false,
            };
          });
          setAllPermissions(all);
        }
      }
      setLoading(false);
      return;
    }

    if (user.firm_id) {
      const { data } = await supabase.from("role_permissions").select("*").eq("firm_id", user.firm_id).eq("role", role);
      if (data && data.length > 0) {
        const perms: PermissionMap = {};
        data.forEach((row: any) => {
          perms[row.module] = {
            can_view: row.can_view ?? false, can_create: row.can_create ?? false,
            can_edit: row.can_edit ?? false, can_delete: row.can_delete ?? false, can_export: row.can_export ?? false,
          };
        });
        setPermissions(perms);

        if (role === "firm_admin") {
          const { data: allData } = await supabase.from("role_permissions").select("*").eq("firm_id", user.firm_id);
          if (allData) {
            const all: Record<string, PermissionMap> = {};
            allData.forEach((row: any) => {
              if (!all[row.role]) all[row.role] = {};
              all[row.role][row.module] = {
                can_view: row.can_view ?? false, can_create: row.can_create ?? false,
                can_edit: row.can_edit ?? false, can_delete: row.can_delete ?? false, can_export: row.can_export ?? false,
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
    if (defaults) setPermissions(defaults);
    setLoading(false);
  }, [user?.id, user?.role, user?.firm_id]);

  useEffect(() => { refresh(); }, [refresh]);

  const can = useCallback(
    (module: string, action: keyof ModulePermission): boolean => {
      if (user?.role === "superadmin") return true;
      // Resolve aliases for backward compat
      const resolvedModule = MODULE_ALIASES[module] || module;
      const mp = permissions[resolvedModule] || permissions[module];
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
