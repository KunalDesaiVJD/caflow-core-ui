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
    let q = supabase
      .from("clients")
      .select("id, name, entity_type")
      .is("deleted_at", null)
      .eq("is_draft", false)
      .order("name");
    if (!isSuperadmin) q = q.eq("firm_id", firmId);
    q.then(({ data, error }) => {
      if (error) console.error("[useClients] query error:", error);
      setClients((data as ClientOption[]) || []);
      setLoading(false);
    });
  }, [firmId, isSuperadmin]);

  return { clients, loading };
}
