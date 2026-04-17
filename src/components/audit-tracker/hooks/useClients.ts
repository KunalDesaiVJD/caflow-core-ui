import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface ClientOption {
  id:          string;
  name:        string;
  entity_type: string | null;
}

export function useClients(firmId: string, isSuperadmin?: boolean) {
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!firmId && !isSuperadmin) return;
    setLoading(true);

    async function fetchAuditClients() {
      // 1. Fetch client IDs that have at least one audit engagement for this firm
      let engQ = supabase
        .from("audit_engagements")
        .select("client_id")
        .neq("status", "archived");
      if (!isSuperadmin && firmId) engQ = engQ.eq("firm_id", firmId);
      const { data: engRows } = await engQ;

      if (!engRows?.length) {
        setClients([]);
        setLoading(false);
        return;
      }

      // 2. Unique client IDs
      const clientIds = [...new Set((engRows as any[]).map(e => e.client_id as string))];

      // 3. Fetch only those clients (active, non-draft, non-deleted)
      let q = supabase
        .from("clients")
        .select("id, name, entity_type")
        .is("deleted_at", null)
        .eq("is_draft", false)
        .in("id", clientIds)
        .order("name");
      if (!isSuperadmin && firmId) q = q.eq("firm_id", firmId);
      const { data, error } = await q;
      if (error) console.error("[useClients] query error:", error);
      setClients((data as ClientOption[]) || []);
      setLoading(false);
    }

    fetchAuditClients();
  }, [firmId, isSuperadmin]);

  return { clients, loading };
}
