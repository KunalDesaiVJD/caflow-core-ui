import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";

export interface FirmAccessEntry {
  firm_id: string;
  firm_name: string;
  can_view: boolean;
  can_create: boolean;
  can_edit: boolean;
  can_delete: boolean;
  can_export: boolean;
}

export interface AccessibleFirm {
  id: string;
  name: string;
}

interface UseUserFirmAccessResult {
  /** Extra firms granted by superadmin (excludes the user's own home firm) */
  grantedAccess: FirmAccessEntry[];
  /** Home firm + all granted firms — use for dropdown options */
  allAccessibleFirms: AccessibleFirm[];
  /** Returns true if the user has a specific action on the given firm.
   *  Always returns true for the user's own home firm (home firm = normal role perms apply). */
  canForFirm: (firmId: string | null, action: "view" | "create" | "edit" | "delete" | "export") => boolean;
  /** true when the user has at least one cross-firm grant */
  hasMultiFirmAccess: boolean;
  loading: boolean;
  /** Re-fetch (call after granting/revoking in admin) */
  refresh: () => Promise<void>;
}

export function useUserFirmAccess(): UseUserFirmAccessResult {
  const { user } = useAuth();
  const [grantedAccess, setGrantedAccess] = useState<FirmAccessEntry[]>([]);
  const [homeFirm, setHomeFirm] = useState<AccessibleFirm | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    // Superadmins use their own isSuperadmin paths — skip this hook
    if (!user || user.role === "superadmin") {
      setGrantedAccess([]);
      setHomeFirm(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      // Load home firm name
      const homeFirmId = user.firm_id;
      if (homeFirmId) {
        const { data: firmData } = await (supabase as any)
          .from("firms")
          .select("id, name")
          .eq("id", homeFirmId)
          .maybeSingle();
        if (firmData) setHomeFirm({ id: firmData.id, name: firmData.name });
      }

      // Load cross-firm grants
      const { data: grants } = await (supabase as any)
        .from("user_firm_access")
        .select("firm_id, can_view, can_create, can_edit, can_delete, can_export, firms(name)")
        .eq("user_id", user.id);

      const entries: FirmAccessEntry[] = (grants || []).map((g: any) => ({
        firm_id: g.firm_id,
        firm_name: g.firms?.name ?? "—",
        can_view: g.can_view ?? false,
        can_create: g.can_create ?? false,
        can_edit: g.can_edit ?? false,
        can_delete: g.can_delete ?? false,
        can_export: g.can_export ?? false,
      }));
      setGrantedAccess(entries);
    } finally {
      setLoading(false);
    }
  }, [user?.id, user?.role, user?.firm_id]);

  useEffect(() => { refresh(); }, [refresh]);

  const allAccessibleFirms: AccessibleFirm[] = [
    ...(homeFirm ? [homeFirm] : []),
    ...grantedAccess
      .filter(g => g.firm_id !== user?.firm_id)
      .map(g => ({ id: g.firm_id, name: g.firm_name })),
  ];

  const canForFirm = useCallback(
    (firmId: string | null, action: "view" | "create" | "edit" | "delete" | "export"): boolean => {
      if (!firmId) return false;
      // Home firm: always true (normal role-level permissions apply separately)
      if (firmId === user?.firm_id) return true;
      const entry = grantedAccess.find(g => g.firm_id === firmId);
      if (!entry) return false;
      switch (action) {
        case "view":   return entry.can_view;
        case "create": return entry.can_create;
        case "edit":   return entry.can_edit;
        case "delete": return entry.can_delete;
        case "export": return entry.can_export;
      }
    },
    [grantedAccess, user?.firm_id]
  );

  return {
    grantedAccess,
    allAccessibleFirms,
    canForFirm,
    hasMultiFirmAccess: grantedAccess.length > 0,
    loading,
    refresh,
  };
}
