/**
 * PortalClientContext
 *
 * Loads ALL client records linked to the logged-in portal user.
 * One auth account can be shared by many entities (family / group companies).
 * Provides the full list + an "active" client the user has selected.
 *
 * Persists the last-chosen entity in sessionStorage so page refreshes don't
 * reset the selection.
 *
 * Client lookup strategy (3 sources, merged + deduplicated):
 *   A. Direct user_id link  — clients.user_id = auth.uid()
 *   B. Email link via RPC   — get_portal_clients_by_email() SECURITY DEFINER
 *      function looks up auth.users.email and returns matching clients,
 *      bypassing RLS entirely. This is necessary because auth.jwt() >> 'email'
 *      is not always present in RLS policy context.
 *   C. Direct email query   — clients.email ILIKE user.email (succeeds when
 *      the portal_clients_by_email RLS policy is effective)
 */

import {
  createContext, useContext, useState, useEffect, useCallback,
  type ReactNode,
} from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PortalClient {
  id:           string;
  name:         string;
  firm_id:      string | null;
  mobile:       string | null;
  email:        string | null;
  gstin:        string[] | null;
  pan:          string | null;
  entity_type:  string | null;
}

interface PortalClientContextValue {
  clients:       PortalClient[];
  allClientIds:  string[];
  activeClient:  PortalClient | null;
  setActiveById: (id: string) => void;
  loading:       boolean;
  reload:        () => void;
}

// ─── Context ──────────────────────────────────────────────────────────────────

const PortalClientContext = createContext<PortalClientContextValue>({
  clients:       [],
  allClientIds:  [],
  activeClient:  null,
  setActiveById: () => {},
  loading:       true,
  reload:        () => {},
});

const SESSION_KEY = "caflow_portal_active_client";

// ─── Provider ─────────────────────────────────────────────────────────────────

export function PortalClientProvider({ children }: { children: ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const [clients,      setClients]      = useState<PortalClient[]>([]);
  const [allClientIds, setAllClientIds] = useState<string[]>([]);
  const [activeClient, setActiveClient] = useState<PortalClient | null>(null);
  const [loading,      setLoading]      = useState(true);

  // When auth finishes but there is no logged-in user, stop showing spinner
  useEffect(() => {
    if (!authLoading && !user?.id) setLoading(false);
  }, [authLoading, user?.id]);

  const load = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);

    // ── Source A: user_id-linked clients (subject to RLS) ─────────────────
    const byIdPromise = supabase
      .from("clients")
      .select("id, name, firm_id, mobile, email, gstin, pan, entity_type")
      .eq("user_id", user.id)
      .neq("is_active", false)
      .is("deleted_at", null)
      .order("name");

    // ── Source B: SECURITY DEFINER RPC — bypasses RLS, uses auth.users email ─
    // Most reliable for shared-email group accounts. The function looks up the
    // calling user's email directly from auth.users (not JWT claims) and returns
    // all clients whose email matches.
    const byRpcPromise = supabase.rpc("get_portal_clients_by_email" as any);

    // ── Source C: direct email query (works when RLS policy is effective) ──
    const byEmailPromise = user.email
      ? supabase
          .from("clients")
          .select("id, name, firm_id, mobile, email, gstin, pan, entity_type")
          .ilike("email", user.email)
          .neq("is_active", false)
          .is("deleted_at", null)
          .order("name")
      : Promise.resolve({ data: [], error: null });

    const [byIdResult, byRpcResult, byEmailResult] = await Promise.all([
      byIdPromise,
      byRpcPromise,
      byEmailPromise,
    ]);

    if (byIdResult.error) {
      console.error("[PortalClientContext] user_id query error:", byIdResult.error);
    }
    if (byRpcResult.error) {
      console.error("[PortalClientContext] RPC query error:", byRpcResult.error);
    }

    // ── Merge and deduplicate across all three sources ─────────────────────
    const seen   = new Set<string>();
    const merged: PortalClient[] = [];

    const addRow = (c: any) => {
      if (!c?.id || seen.has(c.id)) return;
      seen.add(c.id);
      merged.push({
        id:          c.id,
        name:        c.name,
        firm_id:     c.firm_id ?? null,
        mobile:      c.mobile ?? null,
        email:       c.email ?? null,
        gstin:       c.gstin ?? null,
        pan:         c.pan ?? null,
        entity_type: c.entity_type ?? null,
      });
    };

    for (const c of byIdResult.data    || []) addRow(c);
    for (const c of (byRpcResult.data  as any[]) || []) addRow(c);
    for (const c of (byEmailResult as any).data || []) addRow(c);

    merged.sort((a, b) => a.name.localeCompare(b.name));

    setClients(merged);

    const savedId = sessionStorage.getItem(SESSION_KEY);
    const saved   = savedId ? merged.find(c => c.id === savedId) : null;
    setActiveClient(saved || merged[0] || null);
    setAllClientIds(merged.map(c => c.id));
    setLoading(false);
  }, [user?.id, user?.email]);

  useEffect(() => { load(); }, [load]);

  const setActiveById = useCallback((id: string) => {
    const client = clients.find(c => c.id === id);
    if (client) {
      setActiveClient(client);
      sessionStorage.setItem(SESSION_KEY, id);
    }
  }, [clients]);

  return (
    <PortalClientContext.Provider value={{
      clients, allClientIds, activeClient, setActiveById, loading, reload: load,
    }}>
      {children}
    </PortalClientContext.Provider>
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function usePortalClient() {
  return useContext(PortalClientContext);
}
