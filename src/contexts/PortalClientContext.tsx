/**
 * PortalClientContext
 *
 * Loads ALL client records linked to the logged-in portal user.
 * One auth account can be shared by many entities (family / group companies).
 * Provides the full list + an "active" client the user has selected.
 *
 * Persists the last-chosen entity in sessionStorage so page refreshes don't
 * reset the selection.
 */

import {
  createContext, useContext, useState, useEffect, useCallback,
  type ReactNode,
} from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PortalClient {
  id:             string;
  name:           string;
  firm_id:        string | null;
  mobile:         string | null;
  email:          string | null;
  gstin:          string[] | null;
  pan:            string | null;
  client_type:    string | null;
}

interface PortalClientContextValue {
  clients:       PortalClient[];
  activeClient:  PortalClient | null;
  setActiveById: (id: string) => void;
  loading:       boolean;
  reload:        () => void;
}

// ─── Context ──────────────────────────────────────────────────────────────────

const PortalClientContext = createContext<PortalClientContextValue>({
  clients:       [],
  activeClient:  null,
  setActiveById: () => {},
  loading:       true,
  reload:        () => {},
});

const SESSION_KEY = "caflow_portal_active_client";

// ─── Provider ─────────────────────────────────────────────────────────────────

export function PortalClientProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [clients,      setClients]      = useState<PortalClient[]>([]);
  const [activeClient, setActiveClient] = useState<PortalClient | null>(null);
  const [loading,      setLoading]      = useState(true);

  const load = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);

    // Strategy: match clients by BOTH user_id (explicit link) AND email
    // (shared-email families / group accounts where many entities use one address).
    // Run two queries then deduplicate by id.
    const [byIdResult, byEmailResult] = await Promise.all([
      supabase
        .from("clients")
        .select("id, name, firm_id, mobile, email, gstin, pan, client_type")
        .eq("user_id", user.id)
        .eq("is_active", true)
        .order("name"),
      user.email
        ? supabase
            .from("clients")
            .select("id, name, firm_id, mobile, email, gstin, pan, client_type")
            .eq("email", user.email)
            .eq("is_active", true)
            .order("name")
        : Promise.resolve({ data: [], error: null }),
    ]);

    if (byIdResult.error) {
      console.error("PortalClientContext load error:", byIdResult.error);
      setLoading(false);
      return;
    }

    // Merge and deduplicate
    const seen = new Set<string>();
    const merged: PortalClient[] = [];
    for (const c of [...(byIdResult.data || []), ...((byEmailResult as any).data || [])]) {
      if (!seen.has(c.id)) {
        seen.add(c.id);
        merged.push(c as PortalClient);
      }
    }
    merged.sort((a, b) => a.name.localeCompare(b.name));

    setClients(merged);

    // Restore previous selection from sessionStorage
    const savedId = sessionStorage.getItem(SESSION_KEY);
    const saved   = savedId ? merged.find(c => c.id === savedId) : null;
    setActiveClient(saved || merged[0] || null);
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
      clients, activeClient, setActiveById, loading, reload: load,
    }}>
      {children}
    </PortalClientContext.Provider>
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function usePortalClient() {
  return useContext(PortalClientContext);
}
