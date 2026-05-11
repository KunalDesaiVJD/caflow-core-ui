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
    const { data, error } = await supabase
      .from("clients")
      .select("id, name, firm_id, mobile, email, gstin, pan, client_type")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .order("name");

    if (error) {
      console.error("PortalClientContext load error:", error);
      setLoading(false);
      return;
    }

    const list = (data || []) as PortalClient[];
    setClients(list);

    // Restore previous selection from sessionStorage
    const savedId = sessionStorage.getItem(SESSION_KEY);
    const saved   = savedId ? list.find(c => c.id === savedId) : null;
    setActiveClient(saved || list[0] || null);
    setLoading(false);
  }, [user?.id]);

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
